// controllers/useChange.controller.js
const Joi = require("joi");
const pool = require("../db");

/* =========================
   Validaciones
========================= */
const featureSchema = Joi.object({
  class: Joi.string().valid("gt_2ha", "1_to_2ha", "0_5_to_1ha", "lte_0_5ha").required(),
  area_ha: Joi.number().required(),
  pixel_count: Joi.number().integer().required(),
  geom_wkt: Joi.string().required(), // WKT EPSG:4326
});

const imagerySchema = Joi.object({
  role: Joi.string().valid("old", "new").required(),
  source: Joi.string().required(),
  wms_layer: Joi.string().allow(null, ""),
  wms_time: Joi.string().allow(null, ""),
  acquisition_date: Joi.string().required(), // YYYY-MM-DD
  cloud_pct: Joi.number().allow(null),

  // ✅ NUEVO: nube sobre AOI (opcional)
  aoi_cloud_pct: Joi.number().allow(null),

  raw_meta: Joi.any().optional(),
}).unknown(true);

const payloadSchema = Joi.object({
  ndvi_threshold: Joi.number().required(),
  search_window_days: Joi.number().integer().required(),
  img_size: Joi.number().integer().required(),
  bbox_wkt: Joi.string().required(), // Polygon WKT EPSG:4326
  notes: Joi.string().allow(null, ""),
  label: Joi.string().allow(null, ""),

  date_old: Joi.string().required(),
  cloud_old_pct: Joi.number().allow(null),
  aoi_cloud_old_pct: Joi.number().allow(null), // ✅ NUEVO

  date_new: Joi.string().required(),
  cloud_new_pct: Joi.number().allow(null),
  aoi_cloud_new_pct: Joi.number().allow(null), // ✅ NUEVO

  total_clusters: Joi.number().integer().required(),
  gt2_count: Joi.number().integer().required(),
  one_to_two_count: Joi.number().integer().required(),
  half_to_one_count: Joi.number().integer().required(),
  lte05_count: Joi.number().integer().required(),

  features: Joi.array().items(featureSchema).default([]),
  mask_wkt: Joi.string().allow(null, ""),
  imagery: Joi.array().items(imagerySchema).default([]),
}).unknown(true);

const bodySchema = Joi.object({
  project_gid: Joi.number().integer().required(),
  payload: payloadSchema.required(),
});

/* =========================
   Helpers
========================= */
function isDuplicateErr(err) {
  const code = String(err?.code || "");
  const constraint = String(err?.constraint || "");
  const msg = String(err?.message || "").toLowerCase();

  return (
    code === "23505" ||
    constraint === "uca_uniq_project_dates_notnull" ||
    msg.includes("duplicate key value") ||
    msg.includes("llave duplicada")
  );
}

async function findExistingAnalysisIdByDates({ project_gid, date_old, date_new }) {
  const sql = `
    SELECT a.id AS analysis_id
    FROM ema.use_change_analysis a
    WHERE a.project_id = $1
      AND a.date_old = $2::date
      AND a.date_new = $3::date
    ORDER BY a.created_at DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [Number(project_gid), date_old, date_new]);
  return rows?.[0]?.analysis_id || null;
}

/* =========================
   Controllers
========================= */
exports.createUseChangeAnalysis = async (req, res) => {
  const { error, value } = bodySchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      message: "Body inválido",
      details: error.details.map((d) => d.message),
    });
  }

  const { project_gid, payload } = value;
  const runByUserId = req.user?.id ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertAnalysisSQL = `
      INSERT INTO ema.use_change_analysis (
        id, project_id, run_by_user_id, created_at,
        ndvi_threshold, search_window_days, img_size, bbox_wgs84, notes,
        date_old, cloud_old_pct, date_new, cloud_new_pct,
        total_clusters, gt2_count, one_to_two_count, half_to_one_count, lte05_count,
        status, label
      )
      VALUES (
        uuid_generate_v4(), $1, $2, now(),
        $3, $4, $5, ST_GeomFromText($6, 4326), NULLIF($7,'')::text,
        $8::date, $9, $10::date, $11,
        $12, $13, $14, $15, $16,
        'completed', NULLIF($17,'')::text
      )
      RETURNING id
    `;

    const { rows: aRows } = await client.query(insertAnalysisSQL, [
      project_gid,
      runByUserId,
      payload.ndvi_threshold,
      payload.search_window_days,
      payload.img_size,
      payload.bbox_wkt,
      payload.notes ?? null,
      payload.date_old,
      payload.cloud_old_pct ?? null,
      payload.date_new,
      payload.cloud_new_pct ?? null,
      payload.total_clusters,
      payload.gt2_count,
      payload.one_to_two_count,
      payload.half_to_one_count,
      payload.lte05_count,
      payload.label ?? null,
    ]);

    const analysisId = aRows[0].id;

    // Máscara (opcional)
    if (payload.mask_wkt && payload.mask_wkt.trim() !== "") {
      const insertMaskSQL = `
        INSERT INTO ema.use_change_mask (id, analysis_id, geom)
        VALUES (uuid_generate_v4(), $1, ST_Multi(ST_GeomFromText($2, 4326)))
      `;
      await client.query(insertMaskSQL, [analysisId, payload.mask_wkt]);
    }

    // Features
    if (payload.features?.length) {
      const insertFeatSQL = `
        INSERT INTO ema.use_change_feature
          (id, analysis_id, class, area_ha, pixel_count, properties, geom, created_at)
        VALUES
          (uuid_generate_v4(), $1, $2, $3, $4, $5::jsonb, ST_Multi(ST_GeomFromText($6, 4326)), now())
      `;
      for (const f of payload.features) {
        await client.query(insertFeatSQL, [
          analysisId,
          f.class,
          f.area_ha,
          f.pixel_count,
          JSON.stringify({ source: "ndvi", version: 1 }),
          f.geom_wkt,
        ]);
      }
    }

    // Imagery usada (opcional)
    if (payload.imagery?.length) {
      const insertImgSQL = `
        INSERT INTO ema.use_change_imagery
          (id, analysis_id, role, source, wms_layer, wms_time, acquisition_date, cloud_pct, raw_meta)
        VALUES
          (uuid_generate_v4(), $1, $2, $3, $4, $5, $6::date, $7, $8::jsonb)
      `;

      for (const im of payload.imagery) {
        // ✅ Guardamos aoi_cloud_pct dentro de raw_meta (tabla sin columna dedicada)
        const mergedMeta =
          im.raw_meta && typeof im.raw_meta === "object"
            ? { ...im.raw_meta, aoi_cloud_pct: im.aoi_cloud_pct ?? null }
            : { aoi_cloud_pct: im.aoi_cloud_pct ?? null };

        await client.query(insertImgSQL, [
          analysisId,
          im.role,
          im.source,
          im.wms_layer || null,
          im.wms_time || null,
          im.acquisition_date,
          im.cloud_pct ?? null,
          JSON.stringify(mergedMeta),
        ]);
      }
    }

    await client.query("COMMIT");
    return res.status(201).json({ analysis_id: analysisId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createUseChangeAnalysis error:", err);

    // ✅ duplicado -> 409 + analysis_id (si se puede resolver)
    if (isDuplicateErr(err)) {
      try {
        const existingId = await findExistingAnalysisIdByDates({
          project_gid,
          date_old: payload.date_old,
          date_new: payload.date_new,
        });
        if (existingId) {
          return res.status(409).json({
            message: "Análisis ya existe (duplicado)",
            analysis_id: existingId,
          });
        }
      } catch (e) {
        console.warn("No se pudo resolver analysis_id del duplicado:", e?.message || e);
      }
      return res.status(409).json({ message: "Análisis ya existe (duplicado)" });
    }

    return res.status(500).json({
      message: "Error guardando análisis",
      error: String(err?.message || err),
    });
  } finally {
    client.release();
  }
};

exports.listUseChangeAnalyses = async (req, res) => {
  try {
    const { project_gid } = req.query;
    const args = [];
    let where = "";
    if (project_gid) {
      args.push(Number(project_gid));
      where = "WHERE a.project_id = $1";
    }

    const sql = `
      SELECT
        a.id, a.project_id, a.created_at, a.date_old, a.date_new,
        a.total_clusters, a.gt2_count, a.one_to_two_count, a.half_to_one_count, a.lte05_count,
        COALESCE(a.label, '') AS label
      FROM ema.use_change_analysis a
      ${where}
      ORDER BY a.created_at DESC
      LIMIT 200
    `;
    const { rows } = await pool.query(sql, args);
    res.json(rows);
  } catch (err) {
    console.error("listUseChangeAnalyses:", err);
    res.status(500).json({ message: "Error listando" });
  }
};

// ✅ NUEVO: buscar por project + fechas
exports.getAnalysisByProjectDates = async (req, res) => {
  try {
    const { project_gid, date_old, date_new } = req.query;
    if (!project_gid || !date_old || !date_new) {
      return res.status(400).json({ message: "project_gid, date_old y date_new son requeridos" });
    }

    const analysisId = await findExistingAnalysisIdByDates({ project_gid, date_old, date_new });
    if (!analysisId) return res.status(404).json({ message: "No encontrado" });

    return res.json({ analysis_id: analysisId });
  } catch (err) {
    console.error("getAnalysisByProjectDates:", err);
    return res.status(500).json({ message: "Error buscando análisis" });
  }
};

exports.getUseChangeAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT a.*,
             ST_AsGeoJSON(a.bbox_wgs84)::json AS bbox_geojson
      FROM ema.use_change_analysis a
      WHERE a.id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) return res.status(404).json({ message: "No encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("getUseChangeAnalysis:", err);
    res.status(500).json({ message: "Error obteniendo análisis" });
  }
};

exports.getFeaturesGeoJSON = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT jsonb_build_object(
        'type','FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type','Feature',
            'properties', jsonb_build_object(
              'id', f.id,
              'class', f.class,
              'area_ha', f.area_ha,
              'pixel_count', f.pixel_count
            ),
            'geometry', ST_AsGeoJSON(f.geom)::jsonb
          )
        ), '[]'::jsonb)
      ) AS fc
      FROM ema.use_change_feature f
      WHERE f.analysis_id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    res.json(rows[0].fc || { type: "FeatureCollection", features: [] });
  } catch (err) {
    console.error("getFeaturesGeoJSON:", err);
    res.status(500).json({ message: "Error obteniendo features" });
  }
};

exports.getMaskGeoJSON = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT jsonb_build_object(
        'type','FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type','Feature',
            'properties', jsonb_build_object('id', m.id),
            'geometry', ST_AsGeoJSON(m.geom)::jsonb
          )
        ), '[]'::jsonb)
      ) AS fc
      FROM ema.use_change_mask m
      WHERE m.analysis_id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    res.json(rows[0].fc || { type: "FeatureCollection", features: [] });
  } catch (err) {
    console.error("getMaskGeoJSON:", err);
    res.status(500).json({ message: "Error obteniendo máscara" });
  }
};

exports.getImageryByAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT id, role, source, wms_layer, wms_time, acquisition_date, cloud_pct, raw_meta
      FROM ema.use_change_imagery
      WHERE analysis_id = $1
      ORDER BY CASE WHEN role='old' THEN 0 WHEN role='new' THEN 1 ELSE 2 END, acquisition_date
    `;
    const { rows } = await pool.query(sql, [id]);
    res.json(rows);
  } catch (err) {
    console.error("getImageryByAnalysis:", err);
    res.status(500).json({ message: "Error obteniendo imagery" });
  }
};

exports.getAnalysisSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT class,
             COUNT(*) AS features,
             ROUND(SUM(area_ha)::numeric, 4) AS area_ha
      FROM ema.use_change_feature
      WHERE analysis_id = $1
      GROUP BY class
      ORDER BY class
    `;
    const { rows } = await pool.query(sql, [id]);
    res.json(rows);
  } catch (err) {
    console.error("getAnalysisSummary:", err);
    res.status(500).json({ message: "Error obteniendo resumen" });
  }
};

exports.getLatestAnalysisByProject = async (req, res) => {
  try {
    const { project_gid } = req.query;
    if (!project_gid) return res.status(400).json({ message: "project_gid requerido" });

    const sql = `
      SELECT a.id, a.project_id, a.created_at, a.date_old, a.date_new,
             a.total_clusters, a.gt2_count, a.one_to_two_count, a.half_to_one_count, a.lte05_count,
             COALESCE(a.label,'') AS label
      FROM ema.use_change_analysis a
      WHERE a.project_id = $1
      ORDER BY a.created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(sql, [Number(project_gid)]);
    if (!rows.length) return res.status(404).json({ message: "Sin análisis para el proyecto" });
    res.json(rows[0]);
  } catch (err) {
    console.error("getLatestAnalysisByProject:", err);
    res.status(500).json({ message: "Error obteniendo último análisis" });
  }
};

exports.deleteUseChangeAnalysis = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      "DELETE FROM ema.use_change_analysis WHERE id = $1",
      [id]
    );
    await client.query("COMMIT");
    if (!rowCount) return res.status(404).json({ message: "No encontrado" });
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteUseChangeAnalysis:", err);
    res.status(500).json({ message: "Error eliminando" });
  } finally {
    client.release();
  }
};