// controllers/useChange.controller.js
const Joi = require("joi");
const pool = require("../db");
const { crearNotificacion } = require("./notificaciones.controller");

/* =========================
   Validaciones
========================= */
const featureSchema = Joi.object({
  class: Joi.string()
    .valid("gt_2ha", "1_to_2ha", "0_5_to_1ha", "lte_0_5ha")
    .required(),
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

  // nube sobre AOI (opcional)
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
  aoi_cloud_old_pct: Joi.number().allow(null),

  date_new: Joi.string().required(),
  cloud_new_pct: Joi.number().allow(null),
  aoi_cloud_new_pct: Joi.number().allow(null),

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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function safeDiv(a, b) {
  const na = Number(a) || 0;
  const nb = Number(b) || 0;
  if (!nb) return 0;
  return na / nb;
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

async function getProyectoNotifData(client, projectId) {
  const sql = `
    SELECT
      p.gid,
      p.nombre,
      p.codigo,
      p.id_consultor,
      p.id_proponente,
      COALESCE(
        NULLIF(p.area_m2, 0),
        ST_Area(ST_Transform(pp.geom, 32721))
      ) AS area_m2
    FROM ema.proyectos p
    LEFT JOIN ema.poligono_proyecto pp
      ON pp.id_proyecto = p.gid
    WHERE p.gid = $1
    GROUP BY
      p.gid, p.nombre, p.codigo, p.id_consultor, p.id_proponente, p.area_m2
    LIMIT 1
  `;

  const { rows } = await client.query(sql, [Number(projectId)]);
  return rows?.[0] || null;
}

function buildUseChangeNotificationMessage({ proyecto, payload }) {
  const totalCambios = Number(payload?.total_clusters || 0);

  const hectareasCambiadas = round2(
    (payload?.features || []).reduce((acc, f) => acc + (Number(f?.area_ha) || 0), 0)
  );

  const hectareasProyecto = round2((Number(proyecto?.area_m2 || 0)) / 10000);
  const cambiosPorHa = round2(safeDiv(totalCambios, hectareasProyecto));
  const haCambiadasPorHa = round2(safeDiv(hectareasCambiadas, hectareasProyecto));

  const codigoTxt = proyecto?.codigo ? ` (${proyecto.codigo})` : "";
  const nombreProyecto = proyecto?.nombre || `Proyecto ${proyecto?.gid || ""}`;

  const fechaOld = payload?.date_old || "-";
  const fechaNew = payload?.date_new || "-";

  const titulo = "Cambio de uso detectado";

  const mensaje = [
    `Se detectaron ${totalCambios} cambio(s) de uso en ${nombreProyecto}${codigoTxt}.`,
    `Superficie del proyecto: ${hectareasProyecto.toLocaleString("es-ES")} ha.`,
    `Superficie total con cambios: ${hectareasCambiadas.toLocaleString("es-ES")} ha.`,
    `Cantidad de cambios por hectárea: ${cambiosPorHa.toLocaleString("es-ES")} cambio(s)/ha.`,
    `Hectáreas con cambio por hectárea del proyecto: ${haCambiadasPorHa.toLocaleString("es-ES")} ha/ha.`,
    `Detalle: >2ha=${payload?.gt2_count || 0}, 1-2ha=${payload?.one_to_two_count || 0}, 0.5-1ha=${payload?.half_to_one_count || 0}, <=0.5ha=${payload?.lte05_count || 0}.`,
    `Periodo analizado: ${fechaOld} vs ${fechaNew}.`,
  ].join(" ");

  return { titulo, mensaje };
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

  let analysisId = null;
  let proyectoNotif = null;

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

    analysisId = aRows[0].id;

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

    // Obtener ids reales para la notificación:
    // id_usuario = id_proponente / id_cliente
    // id_consultor = id_consultor
    proyectoNotif = await getProyectoNotifData(client, project_gid);

    await client.query("COMMIT");

    // Crear notificación fuera de la transacción principal
    try {
      if (proyectoNotif) {
        const { titulo, mensaje } = buildUseChangeNotificationMessage({
          proyecto: proyectoNotif,
          payload,
        });

        await crearNotificacion({
          id_proyecto: Number(project_gid),
          proponenteId: proyectoNotif.id_proponente || null,
          consultorId: proyectoNotif.id_consultor || null,
          titulo,
          mensaje,
          creado_por:
            req.user?.username ||
            req.user?.email ||
            req.user?.first_name ||
            "Sistema",
          es_global: false,
        });
      }
    } catch (notifErr) {
      console.warn(
        "No se pudo crear notificación de cambio de uso:",
        notifErr?.message || notifErr
      );
    }

    return res.status(201).json({ analysis_id: analysisId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createUseChangeAnalysis error:", err);

    // duplicado -> 409 + analysis_id (si se puede resolver)
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
        a.id,
        a.project_id,
        a.created_at,
        a.date_old,
        a.date_new,
        a.total_clusters,
        a.gt2_count,
        a.one_to_two_count,
        a.half_to_one_count,
        a.lte05_count,
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

// buscar por project + fechas
exports.getAnalysisByProjectDates = async (req, res) => {
  try {
    const { project_gid, date_old, date_new } = req.query;

    if (!project_gid || !date_old || !date_new) {
      return res.status(400).json({
        message: "Faltan parámetros requeridos: project_gid, date_old, date_new",
      });
    }

    const analysisId = await findExistingAnalysisIdByDates({
      project_gid,
      date_old,
      date_new,
    });

    if (!analysisId) {
      return res.status(404).json({ message: "No encontrado" });
    }

    return res.json({ analysis_id: analysisId });
  } catch (err) {
    console.error("getAnalysisByProjectDates:", err);
    return res.status(500).json({ message: "Error consultando análisis por fechas" });
  }
};

exports.getLatestAnalysisByProject = async (req, res) => {
  try {
    const project_gid = Number(req.query.project_gid);
    if (!Number.isFinite(project_gid)) {
      return res.status(400).json({ message: "project_gid inválido" });
    }

    const sql = `
      SELECT a.id AS analysis_id
      FROM ema.use_change_analysis a
      WHERE a.project_id = $1
      ORDER BY a.created_at DESC
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [project_gid]);

    if (!rows.length) {
      return res.status(404).json({ message: "No hay análisis para este proyecto" });
    }

    return res.json({ analysis_id: rows[0].analysis_id });
  } catch (err) {
    console.error("getLatestAnalysisByProject:", err);
    return res.status(500).json({ message: "Error obteniendo último análisis" });
  }
};

exports.getUseChangeAnalysis = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const sql = `
      SELECT
        a.*,
        ST_AsText(a.bbox_wgs84) AS bbox_wkt
      FROM ema.use_change_analysis a
      WHERE a.id = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) {
      return res.status(404).json({ message: "Análisis no encontrado" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("getUseChangeAnalysis:", err);
    return res.status(500).json({ message: "Error obteniendo análisis" });
  }
};

exports.getFeaturesGeoJSON = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const sql = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(f.geom)::jsonb,
            'properties', jsonb_build_object(
              'id', f.id,
              'class', f.class,
              'area_ha', f.area_ha,
              'pixel_count', f.pixel_count,
              'created_at', f.created_at
            ) || COALESCE(f.properties, '{}'::jsonb)
          )
        ), '[]'::jsonb)
      ) AS geojson
      FROM ema.use_change_feature f
      WHERE f.analysis_id = $1
    `;

    const { rows } = await pool.query(sql, [id]);
    return res.json(rows[0]?.geojson || { type: "FeatureCollection", features: [] });
  } catch (err) {
    console.error("getFeaturesGeoJSON:", err);
    return res.status(500).json({ message: "Error obteniendo features" });
  }
};

exports.getMaskGeoJSON = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const sql = `
      SELECT jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(m.geom)::jsonb,
        'properties', jsonb_build_object(
          'id', m.id,
          'analysis_id', m.analysis_id
        )
      ) AS geojson
      FROM ema.use_change_mask m
      WHERE m.analysis_id = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Máscara no encontrada" });
    }

    return res.json(rows[0].geojson);
  } catch (err) {
    console.error("getMaskGeoJSON:", err);
    return res.status(500).json({ message: "Error obteniendo máscara" });
  }
};

exports.getImageryByAnalysis = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const sql = `
      SELECT
        i.id,
        i.analysis_id,
        i.role,
        i.source,
        i.wms_layer,
        i.wms_time,
        i.acquisition_date,
        i.cloud_pct,
        i.raw_meta
      FROM ema.use_change_imagery i
      WHERE i.analysis_id = $1
      ORDER BY CASE WHEN i.role = 'old' THEN 1 ELSE 2 END, i.acquisition_date ASC
    `;

    const { rows } = await pool.query(sql, [id]);
    return res.json(rows);
  } catch (err) {
    console.error("getImageryByAnalysis:", err);
    return res.status(500).json({ message: "Error obteniendo imagery" });
  }
};

exports.getAnalysisSummary = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const sql = `
      SELECT
        a.id,
        a.project_id,
        a.created_at,
        a.date_old,
        a.date_new,
        a.total_clusters,
        a.gt2_count,
        a.one_to_two_count,
        a.half_to_one_count,
        a.lte05_count,
        COALESCE(SUM(f.area_ha), 0) AS total_area_ha
      FROM ema.use_change_analysis a
      LEFT JOIN ema.use_change_feature f
        ON f.analysis_id = a.id
      WHERE a.id = $1
      GROUP BY
        a.id, a.project_id, a.created_at, a.date_old, a.date_new,
        a.total_clusters, a.gt2_count, a.one_to_two_count, a.half_to_one_count, a.lte05_count
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Análisis no encontrado" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("getAnalysisSummary:", err);
    return res.status(500).json({ message: "Error obteniendo resumen" });
  }
};

exports.deleteUseChangeAnalysis = async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const { rowCount } = await pool.query(
      `DELETE FROM ema.use_change_analysis WHERE id = $1`,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ message: "Análisis no encontrado" });
    }

    return res.json({ success: true, message: "Análisis eliminado correctamente" });
  } catch (err) {
    console.error("deleteUseChangeAnalysis:", err);
    return res.status(500).json({ message: "Error eliminando análisis" });
  }
};