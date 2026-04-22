// controllers/tramos.controller.js ✅ COMPLETO + CORREGIDO
// - bbox params OK
// - simplify AHORA ES OPT-IN: por defecto NO simplifica (preserva curvas)
// - simplify en METROS (3857) si se activa
// - agrega npts_in / npts_out para debug visual
// - GeoJSON con precisión alta

const pool = require("../db");
const { crearNotificacion } = require("./notificaciones.controller");

function parseNullableNumber(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const TRAMOS_GEO_TABLE = "ema.bloques_tramo";
const DB_SRID = 32721;
const OUT_SRID = 4326;

/* =======================================================
   GET: /api/tramos/proyectos/:id/tramos
   ======================================================= */
const obtenerTramosPorProyecto = async (req, res) => {
  const pid = parseInt(req.params.id, 10);
  if (!pid) return res.status(400).json({ error: "id proyecto inválido" });

  try {
    const result = await pool.query(
      `
      SELECT
        id_tramo,
        id_proyecto,
        nombre_tramo,
        ubicacion,
        universo,
        pk_inicio,
        puntos_inicio,
        x_inicio,
        y_inicio,
        pk_final,
        puntos_final,
        x_final,
        y_final,
        cerrado
      FROM ema.tramos
      WHERE id_proyecto = $1
      ORDER BY id_tramo
      `,
      [pid]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Error al obtener tramos (ema.tramos):", err);
    return res.status(500).json({
      error: "Error al obtener tramos",
      detalle: err.message,
    });
  }
};

/* =======================================================
   ✅ GET: /api/tramos/proyectos/:id/tramos/geojson
   - bbox=minLng,minLat,maxLng,maxLat (EPSG:4326)
   - simplify: OPT-IN (por defecto NO simplifica)
     * activar: ?simplify=1
     * desactivar: ?simplify=0
   - z y limit
   ======================================================= */
const obtenerTramosGeojsonPorProyecto = async (req, res) => {
  const pid = parseInt(req.params.id, 10);
  if (!pid) return res.status(400).json({ error: "id proyecto inválido" });

  try {
    const bboxStr = String(req.query.bbox || "").trim();
    const z = Math.max(0, Math.min(parseInt(req.query.z || "12", 10) || 12, 22));
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "5000", 10) || 5000, 200),
      20000
    );

    let bbox = null;
    if (bboxStr) {
      const parts = bboxStr.split(",").map((x) => Number(x));
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        const [minLng, minLat, maxLng, maxLat] = parts;
        const a = Math.min(minLng, maxLng);
        const b = Math.min(minLat, maxLat);
        const c = Math.max(minLng, maxLng);
        const d = Math.max(minLat, maxLat);
        bbox = { minLng: a, minLat: b, maxLng: c, maxLat: d };
      }
    }

    // ✅ CAMBIO CLAVE: simplify es OPT-IN
    // Default: NO simplifica (preserva curvas)
    const simplifyOn = String(req.query.simplify ?? "0") === "1";

    // tolerancia EN METROS (solo si simplify=1)
    // 👉 la bajo para que no te “octagonice” rotondas
    const tolM = simplifyOn
      ? (z >= 18 ? 0 : z >= 17 ? 0.02 : z >= 16 ? 0.05 : z >= 15 ? 0.1 : z >= 14 ? 0.2 : z >= 13 ? 0.3 : z >= 12 ? 0.4 : 0.6)
      : 0;

    // params base: pid, tolM, limit
    const params = [pid, tolM, limit];

    let bboxWhere = "";
    if (bbox) {
      params.push(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat);
      bboxWhere = `
        AND ST_Intersects(
          t.geom,
          ST_Transform(ST_MakeEnvelope($4, $5, $6, $7, ${OUT_SRID}), ${DB_SRID})
        )
      `;
    }

    const q = `
      WITH base AS (
        SELECT
          t.*,
          COALESCE(
            NULLIF(trim(t.tramo_nombre::text), ''),
            NULLIF(trim(t.tramo_desc::text), ''),
            CASE
              WHEN t.id_tramo IS NOT NULL THEN 'Tramo ' || t.id_tramo::text
              WHEN t.gid IS NOT NULL THEN 'Tramo ' || t.gid::text
              ELSE 'Tramo'
            END
          ) AS _label
        FROM ${TRAMOS_GEO_TABLE} t
        WHERE t.id_proyecto = $1
          AND t.geom IS NOT NULL
          ${bboxWhere}
        LIMIT $3::int
      ),
      prep AS (
        SELECT
          b.*,
          ST_MakeValid(ST_Force2D(b.geom)) AS geom_2d_valid,
          ST_NPoints(b.geom) AS npts_in
        FROM base b
      ),
      simp AS (
        SELECT
          p.*,
          CASE
            WHEN $2::float8 > 0 THEN
              ST_Transform(
                ST_SimplifyPreserveTopology(
                  ST_Transform(p.geom_2d_valid, 3857),
                  $2::float8
                ),
                ${OUT_SRID}
              )
            ELSE
              ST_Transform(p.geom_2d_valid, ${OUT_SRID})
          END AS geom_out
        FROM prep p
      )
      SELECT jsonb_build_object(
        'type','FeatureCollection',
        'features', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'type','Feature',
              'geometry', ST_AsGeoJSON(s.geom_out, 15, 0)::jsonb,
              'properties',
                (to_jsonb(s) - 'geom' - 'geom_out' - 'geom_2d_valid')
                || jsonb_build_object(
                    'label', s._label,
                    'npts_in', COALESCE(s.npts_in, 0),
                    'npts_out', COALESCE(ST_NPoints(s.geom_out), 0),
                    'simplify_on', (${simplifyOn ? "true" : "false"})::boolean,
                    'tol_m', $2::float8
                  )
            )
          ),
          '[]'::jsonb
        )
      ) AS fc
      FROM simp s;
    `;

    const r = await pool.query(q, params);
    return res.json(r.rows[0]?.fc || { type: "FeatureCollection", features: [] });
  } catch (err) {
    console.error("Error tramos geojson:", err);
    return res.status(500).json({
      error: "Error al obtener tramos geojson",
      detalle: err.message,
    });
  }
};

/* =======================================================
   POST: /api/tramos/proyectos/:id/tramos
   ======================================================= */
const crearTramo = async (req, res) => {
  const id_proyecto = parseInt(req.params.id, 10);
  if (!id_proyecto) return res.status(400).json({ error: "id proyecto inválido" });

  const {
    nombre_tramo,
    ubicacion,
    universo,
    pk_inicio,
    puntos_inicio,
    x_inicio,
    y_inicio,
    pk_final,
    puntos_final,
    x_final,
    y_final,
  } = req.body;

  try {
    await pool.query(
      `INSERT INTO ema.tramos (
        id_proyecto, nombre_tramo, ubicacion, universo,
        pk_inicio, puntos_inicio, x_inicio, y_inicio,
        pk_final, puntos_final, x_final, y_final
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12
      )`,
      [
        id_proyecto,
        nombre_tramo || null,
        ubicacion || null,
        parseNullableNumber(universo),
        parseNullableNumber(pk_inicio),
        parseNullableNumber(puntos_inicio),
        parseNullableNumber(x_inicio),
        parseNullableNumber(y_inicio),
        parseNullableNumber(pk_final),
        parseNullableNumber(puntos_final),
        parseNullableNumber(x_final),
        parseNullableNumber(y_final),
      ]
    );

    const proyectoRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [id_proyecto]
    );
    const { id_cliente, id_consultor, nombre: nombreProyecto = "Proyecto desconocido" } =
      proyectoRes.rows[0] || {};

    try {
      await crearNotificacion({
        proponenteId: id_cliente || null,
        consultorId: id_consultor || null,
        id_proyecto,
        titulo: "Tramo creado",
        mensaje: `Se creó el tramo "${nombre_tramo || "(sin nombre)"}" en el proyecto "${nombreProyecto}".`,
        creado_por: req.user?.username || "Sistema",
        es_global: false,
      });
    } catch (notifErr) {
      console.warn("Error notificando creación de tramo:", notifErr);
    }

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error("Error al crear tramo:", err);
    return res.status(500).json({ error: "Error al crear tramo", detalle: err.message });
  }
};

/* =======================================================
   PUT: /api/tramos/tramos/:id
   ======================================================= */
const actualizarTramo = async (req, res) => {
  const id_tramo = parseInt(req.params.id, 10);
  if (!id_tramo) return res.status(400).json({ error: "id_tramo inválido" });

  const {
    nombre_tramo,
    ubicacion,
    universo,
    pk_inicio,
    puntos_inicio,
    x_inicio,
    y_inicio,
    pk_final,
    puntos_final,
    x_final,
    y_final,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ema.tramos SET
        nombre_tramo = $1,
        ubicacion = $2,
        universo = $3,
        pk_inicio = $4,
        puntos_inicio = $5,
        x_inicio = $6,
        y_inicio = $7,
        pk_final = $8,
        puntos_final = $9,
        x_final = $10,
        y_final = $11
      WHERE id_tramo = $12`,
      [
        nombre_tramo || null,
        ubicacion || null,
        parseNullableNumber(universo),
        parseNullableNumber(pk_inicio),
        parseNullableNumber(puntos_inicio),
        parseNullableNumber(x_inicio),
        parseNullableNumber(y_inicio),
        parseNullableNumber(pk_final),
        parseNullableNumber(puntos_final),
        parseNullableNumber(x_final),
        parseNullableNumber(y_final),
        id_tramo,
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Tramo no encontrado" });

    const tramoRes = await pool.query(
      "SELECT id_proyecto FROM ema.tramos WHERE id_tramo = $1",
      [id_tramo]
    );
    const id_proyecto = tramoRes.rows[0]?.id_proyecto;

    const proyectoRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [parseInt(id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombreProyecto = "Proyecto desconocido" } =
      proyectoRes.rows[0] || {};

    try {
      await crearNotificacion({
        proponenteId: id_cliente || null,
        consultorId: id_consultor || null,
        id_proyecto: parseInt(id_proyecto, 10),
        titulo: "Tramo actualizado",
        mensaje: `Se actualizó el tramo "${nombre_tramo || "(sin nombre)"}" en el proyecto "${nombreProyecto}".`,
        creado_por: req.user?.username || "Sistema",
        es_global: false,
      });
    } catch (notifErr) {
      console.warn("Error notificando actualización de tramo:", notifErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Error al actualizar tramo:", err);
    return res.status(500).json({ error: "Error al actualizar tramo", detalle: err.message });
  }
};

/* =======================================================
   DELETE: /api/tramos/tramos/:id
   ======================================================= */
const eliminarTramo = async (req, res) => {
  const id_tramo = parseInt(req.params.id, 10);
  if (!id_tramo) return res.status(400).json({ error: "id_tramo inválido" });

  try {
    const existing = await pool.query(
      "SELECT id_proyecto, nombre_tramo FROM ema.tramos WHERE id_tramo = $1",
      [id_tramo]
    );
    if (existing.rowCount === 0) return res.status(404).json({ error: "Tramo no encontrado" });

    const { id_proyecto, nombre_tramo } = existing.rows[0];

    const result = await pool.query("DELETE FROM ema.tramos WHERE id_tramo = $1", [id_tramo]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Tramo no encontrado" });

    const proyectoRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [parseInt(id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombreProyecto = "Proyecto desconocido" } =
      proyectoRes.rows[0] || {};

    try {
      await crearNotificacion({
        proponenteId: id_cliente || null,
        consultorId: id_consultor || null,
        id_proyecto: parseInt(id_proyecto, 10),
        titulo: "Tramo eliminado",
        mensaje: `Se eliminó el tramo "${nombre_tramo || "(sin nombre)"}" del proyecto "${nombreProyecto}".`,
        creado_por: req.user?.username || "Sistema",
        es_global: false,
      });
    } catch (notifErr) {
      console.warn("Error notificando eliminación de tramo:", notifErr);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Error al eliminar tramo:", err);
    return res.status(500).json({ error: "Error al eliminar tramo", detalle: err.message });
  }
};

/* =======================================================
   PATCH: /api/tramos/tramos/:id/cerrar
   ======================================================= */
const cerrarTramo = async (req, res) => {
  try {
    const id_tramo = parseInt(req.params.id, 10);
    if (!id_tramo) return res.status(400).json({ error: "id_tramo requerido" });

    const ex = await pool.query(
      `SELECT id_proyecto, nombre_tramo, cerrado, estado
       FROM ema.tramos
       WHERE id_tramo = $1`,
      [id_tramo]
    );
    if (ex.rowCount === 0) return res.status(404).json({ error: "Tramo no encontrado" });

    const { id_proyecto, nombre_tramo, cerrado, estado } = ex.rows[0];

    if (cerrado === true || (estado || "").toUpperCase() === "CERRADO") {
      return res.status(409).json({ error: "El tramo ya está cerrado" });
    }

    const sqlA = `
      UPDATE ema.tramos
      SET cerrado = TRUE,
          fecha_cierre = NOW(),
          cerrado_por = $2
      WHERE id_tramo = $1
      RETURNING id_tramo
    `;

    const cerrador = req.user?.id || null;
    const { rows } = await pool.query(sqlA, [id_tramo, cerrador]);

    if (!rows.length) return res.status(404).json({ error: "No se pudo cerrar el tramo" });

    const p = await pool.query(
      `SELECT id_cliente, id_consultor, nombre
         FROM ema.proyectos
        WHERE gid = $1`,
      [parseInt(id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombreProyecto = "Proyecto" } = p.rows[0] || {};

    try {
      await crearNotificacion({
        proponenteId: id_cliente || null,
        consultorId: id_consultor || null,
        id_proyecto: parseInt(id_proyecto, 10),
        titulo: "Tramo cerrado",
        mensaje: `Se cerró el tramo "${nombre_tramo || "(sin nombre)"}" del proyecto "${nombreProyecto}".`,
        creado_por: req.user?.username || "Sistema",
        es_global: false,
      });
    } catch (notifErr) {
      console.warn("Error notificando cierre de tramo:", notifErr);
    }

    return res.json({ success: true, id_tramo });
  } catch (err) {
    console.error("Error al cerrar tramo:", err);
    return res.status(500).json({ error: "Error interno", detalle: err.message });
  }
};

module.exports = {
  obtenerTramosPorProyecto,
  obtenerTramosGeojsonPorProyecto,
  crearTramo,
  actualizarTramo,
  eliminarTramo,
  cerrarTramo,
};