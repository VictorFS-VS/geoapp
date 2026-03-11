// controllers/dashboard.controller.js
const pool = require("../db");

/** ---------------------------------------------------------------------
 *  Helpers
 * --------------------------------------------------------------------*/
function dbg(name, payload) {
  if (process.env.NODE_ENV !== "production") {
    try {
      console.log("[DBG]", name, payload);
    } catch {}
  }
}

/**
 * Filtros por tipo de usuario + (futuro) cartera
 *
 * tipos:
 * 1  = ADMIN  -> ve todo
 * 8  = CONSULTOR
 * 9  = CLIENTE
 * 10 = CLIENTE_VIAL
 * 11 = ADMIN_CLIENTE
 * 12 = CLIENTE_MAPS
 */
function buildProjectConds(req) {
  const { tipo_usuario, id_cliente, id_consultor, id } = req.user || {};

  const conds = [];
  const params = [];

  // ===== ADMIN: ve todo =====
  if (tipo_usuario === 1) {
    return { conds, params };
  }

  // ===== CONSULTOR (8) =====
  if (tipo_usuario === 8) {
    const ref = id_consultor || id;
    if (ref) {
      params.push(ref);
      const idx = params.length;

      conds.push(`
        (
          p.id_consultor = $${idx}
          OR p.id_proponente IN (
            SELECT ccm.miembro_id
            FROM ema.consultor_cliente_miembro ccm
            WHERE ccm.consultor_id = $${idx}
          )
        )
      `);
    }
    return { conds, params };
  }

  // ===== CLIENTE (9,10,12) =====
  if (tipo_usuario === 9 || tipo_usuario === 10 || tipo_usuario === 12) {
    if (id_cliente) {
      params.push(id_cliente);
      const idx = params.length;

      conds.push(`(
        p.id_proponente = $${idx}
        OR p.id_cliente = $${idx}
      )`);
    }
    return { conds, params };
  }

  // ===== ADMIN CLIENTE (11) =====
  if (tipo_usuario === 11) {
    const refCli = id_cliente || null;
    if (refCli) {
      params.push(refCli);
      const idx = params.length;

      conds.push(`
        p.id_proponente IN (
          SELECT cam.miembro_id
          FROM ema.cliente_admin_miembro cam
          WHERE cam.admin_id = $${idx}
        )
      `);
    }
    return { conds, params };
  }

  return { conds, params };
}

/** Clasificador NORMAL/ESPECIAL/SIN DATO usando solo e.tipo_inmueble */
const CLASE_EXPR = `
  CASE
    WHEN e.tipo_inmueble IS NULL OR btrim(e.tipo_inmueble) = '' THEN 'SIN DATO'
    WHEN regexp_replace(upper(e.tipo_inmueble), '[^A-Z0-9]', '', 'g') ~ '(ESPECIAL|ESPEC|ESP)$' THEN 'ESPECIAL'
    ELSE 'NORMAL'
  END
`;

/**
 * Construye WHERE y params para endpoints que usan e.* (encuestas)
 * Aplica SIEMPRE el filtro tipo_clase si viene (NORMAL | ESPECIAL | SIN DATO),
 * independientemente de withTramo.
 */
function buildWhere(req, { withTramo = false } = {}) {
  const { conds, params } = buildProjectConds(req);

  const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
  if (id_proyecto) {
    params.push(id_proyecto);
    conds.push(`p.gid = $${params.length}`);
  }

  const id_tramo = req?.query?.id_tramo ? Number(req.query.id_tramo) : null;
  if (withTramo && id_tramo) {
    params.push(id_tramo);
    conds.push(`e.id_tramo = $${params.length}`);
  }

  const tipo_clase_raw = (req?.query?.tipo_clase || "").toString().trim().toUpperCase();
  const tipo_clase = tipo_clase_raw === "SINDATO" ? "SIN DATO" : tipo_clase_raw;
  if (tipo_clase === "NORMAL" || tipo_clase === "ESPECIAL" || tipo_clase === "SIN DATO") {
    params.push(tipo_clase);
    conds.push(`(${CLASE_EXPR}) = $${params.length}`);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return { where, params };
}

/** Expresión de año segura (usa fecha_registro como respaldo) */
const YEAR_EXPR = `EXTRACT(YEAR FROM COALESCE(p.fecha_inicio, p.fecha_registro))::int`;

/** ---------------------------------------------------------------------
 *  NUEVO: Estado base (1..10) desde p.estado (texto con subestados)
 *  Ej: '01.3' -> 1, '06.2' -> 6, '10' -> 10, null -> 0
 * --------------------------------------------------------------------*/
const ESTADO_BASE_INT = `
  COALESCE(
    NULLIF(
      regexp_replace(
        split_part(COALESCE(p.estado::text, ''), '.', 1),
        '\\D', '', 'g'
      ),
      ''
    )::int,
    0
  )
`;

/** Nombre “padre” para gráficos (coherente con tu trigger real) */
const DES_ESTADO_PADRE = `
  CASE ${ESTADO_BASE_INT}
    WHEN 1  THEN 'Ingreso de Proyecto EMA'
    WHEN 2  THEN 'Mesa de Entrada'
    WHEN 3  THEN 'Dirección DGCCARN'
    WHEN 4  THEN 'Geomática'
    WHEN 5  THEN 'Análisis Técnico'
    WHEN 6  THEN 'RIMA'
    WHEN 7  THEN 'DVIA'
    WHEN 8  THEN 'Dirección General'
    WHEN 9  THEN 'Licencia (DIA)'
    WHEN 10 THEN 'Resolución (A.A.)'
    ELSE COALESCE(NULLIF(btrim(p.des_estado), ''), 'Sin estado')
  END
`;

/** ---------------------------------------------------------------------
 *  BLOQUE 1: métricas de proyectos (no dependen de e.*)
 * --------------------------------------------------------------------*/
const proyectosPorEstado = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    dbg("proyectosPorEstado", { where, params, query: req.query });

    // Devuelve labels “padre” ya unificados (1..10)
    const sql = `
      SELECT
        ${DES_ESTADO_PADRE} AS estado,
        COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY ${DES_ESTADO_PADRE}
      ORDER BY
        CASE ${DES_ESTADO_PADRE}
          WHEN 'Ingreso de Proyecto EMA' THEN 1
          WHEN 'Mesa de Entrada'         THEN 2
          WHEN 'Dirección DGCCARN'       THEN 3
          WHEN 'Geomática'               THEN 4
          WHEN 'Análisis Técnico'        THEN 5
          WHEN 'RIMA'                    THEN 6
          WHEN 'DVIA'                    THEN 7
          WHEN 'Dirección General'       THEN 8
          WHEN 'Licencia (DIA)'          THEN 9
          WHEN 'Resolución (A.A.)'       THEN 10
          ELSE 99
        END;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("proyectosPorEstado:", err);
    res.status(500).json({ error: "Error al obtener datos de estados" });
  }
};

const proyectosPorEstadoNumerico = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    dbg("proyectosPorEstadoNumerico", { where, params, query: req.query });

    // Agrupado por estado base 1..10
    const sql = `
      SELECT
        ${ESTADO_BASE_INT} AS estado,
        ${DES_ESTADO_PADRE} AS des_estado,
        COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY ${ESTADO_BASE_INT}, ${DES_ESTADO_PADRE}
      ORDER BY ${ESTADO_BASE_INT};
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("proyectosPorEstadoNumerico:", err);
    res.status(500).json({ error: "Error al obtener estados" });
  }
};

const proyectosPorAnioSector = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);
    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    dbg("proyectosPorAnioSector", { where, params, query: req.query });

    const sql = `
      SELECT ${YEAR_EXPR} AS anio,
             COALESCE(NULLIF(btrim(p.sector_proyecto), ''), 'Sin dato') AS sector,
             COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY anio, sector
      ORDER BY anio, sector;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("proyectosPorAnioSector:", err);
    res.status(500).json({ error: "Error al obtener datos de sector" });
  }
};

const proyectosPorAnioTipoEstudio = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);
    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    dbg("proyectosPorAnioTipoEstudio", { where, params, query: req.query });

    const sql = `
      SELECT ${YEAR_EXPR} AS anio,
             CASE
               WHEN p.tipo_estudio IS NULL OR btrim(p.tipo_estudio) = '' THEN 'Sin dato'
               WHEN upper(regexp_replace(p.tipo_estudio, '\\s+', '', 'g')) IN
                    ('EIA','ESTUDIODEIMPACTOAMBIENTAL') THEN 'EIA'
               WHEN upper(regexp_replace(p.tipo_estudio, '\\s+', '', 'g')) IN
                    ('EIAP','EIAPRELIMINAR','EIA PRELIMINAR','ESTUDIODEIMPACTOAMBIENTALPRELIMINAR') THEN 'EIAP'
               WHEN upper(regexp_replace(p.tipo_estudio, '[\\s/]+', '', 'g')) IN
                    ('CDS','C/DS','CONSULTAYODESCRIPCION','CONSULTADESCRIPCION') THEN 'C/DS'
               WHEN upper(p.tipo_estudio) LIKE 'AJU%' THEN 'AJU'
               WHEN upper(p.tipo_estudio) LIKE 'AA%'  THEN 'AA'
               ELSE p.tipo_estudio
             END AS tipo_estudio,
             COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY anio, tipo_estudio
      ORDER BY anio, tipo_estudio;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("proyectosPorAnioTipoEstudio:", err);
    res.status(500).json({ error: "Error al obtener datos de estudio" });
  }
};

const proyectosPorAnioImpacto = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);
    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    dbg("proyectosPorAnioImpacto", { where, params, query: req.query });

    const sql = `
      SELECT ${YEAR_EXPR} AS anio,
             COALESCE(NULLIF(btrim(p.tipo_proyecto), ''), 'Sin dato') AS impacto,
             COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY anio, impacto
      ORDER BY anio, impacto;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("proyectosPorAnioImpacto:", err);
    res.status(500).json({ error: "Error al obtener datos de impacto" });
  }
};

const tiposEstudioTotales = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);
    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    dbg("tiposEstudioTotales", { where, params, query: req.query });

    const sql = `
      SELECT
        CASE
          WHEN p.tipo_estudio IS NULL OR btrim(p.tipo_estudio) = '' THEN 'Sin dato'
          WHEN upper(regexp_replace(p.tipo_estudio, '\\s+', '', 'g')) IN
               ('EIA','ESTUDIODEIMPACTOAMBIENTAL') THEN 'EIA'
          WHEN upper(regexp_replace(p.tipo_estudio, '\\s+', '', 'g')) IN
               ('EIAP','EIAPRELIMINAR','EIA PRELIMINAR','ESTUDIODEIMPACTOAMBIENTALPRELIMINAR') THEN 'EIAP'
          WHEN upper(regexp_replace(p.tipo_estudio, '[\\s/]+', '', 'g')) IN
               ('CDS','C/DS','CONSULTAYODESCRIPCION','CONSULTADESCRIPCION') THEN 'C/DS'
          WHEN upper(p.tipo_estudio) LIKE 'AJU%' THEN 'AJU'
          WHEN upper(p.tipo_estudio) LIKE 'AA%'  THEN 'AA'
          ELSE p.tipo_estudio
        END AS tipo_estudio,
        COUNT(*)::int AS cantidad
      FROM ema.proyectos p
      ${where}
      GROUP BY tipo_estudio
      ORDER BY tipo_estudio;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("tiposEstudioTotales:", err);
    res.status(500).json({ error: "Error al obtener datos de tipos de estudio" });
  }
};

/** ---------------------------------------------------------------------
 *  ✅ ACTUALIZADO: resumenProyectos ahora devuelve:
 *  - total, evaluacion, licencia (como antes)
 *  - diaProx, resProx (contadores)
 *  - minDiasDia, minDiasRes (mínimo días restantes; negativo = vencido)
 * --------------------------------------------------------------------*/
const resumenProyectos = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    dbg("resumenProyectos", { where, params, query: req.query });

    const totalSQL = `
      SELECT COUNT(*)::int AS total
      FROM ema.proyectos p
      ${where};
    `;

    // Con licencia = 9 (Licencia DIA) + 10 (Resolución AA)
    const licenciaSQL = `
      SELECT COUNT(*)::int AS total
      FROM ema.proyectos p
      ${where} ${where ? "AND" : "WHERE"} ${ESTADO_BASE_INT} IN (9, 10);
    `;

    const evaluacionSQL = `
      SELECT COUNT(*)::int AS total
      FROM ema.proyectos p
      ${where} ${where ? "AND" : "WHERE"} ${ESTADO_BASE_INT} NOT IN (9, 10);
    `;

    // ✅ DIA próximas (<= 180 días)
    const diaProxSQL = `
      SELECT COUNT(*)::int AS diaprox
      FROM ema.declaraciones d
      JOIN ema.proyectos p ON p.gid = d.id_proyecto
      ${where ? where + " AND" : "WHERE"}
        d.fecha_prox_vto_aa IS NOT NULL
        AND (d.fecha_prox_vto_aa::date - CURRENT_DATE) <= 180;
    `;

    // ✅ Resoluciones próximas: tomamos la última por proyecto, y contamos <= 183 días
    const resProxSQL = `
      WITH latest_res AS (
        SELECT DISTINCT ON (id_proyecto)
          id_resoluciones,
          id_proyecto,
          fecha_prox_vto_aa
        FROM ema.resoluciones
        WHERE fecha_prox_vto_aa IS NOT NULL
        ORDER BY id_proyecto, fecha_prox_vto_aa DESC
      )
      SELECT COUNT(*)::int AS resprox
      FROM latest_res lr
      JOIN ema.proyectos p ON p.gid = lr.id_proyecto
      ${where ? where + " AND" : "WHERE"}
        (lr.fecha_prox_vto_aa::date - CURRENT_DATE) <= 183;
    `;

    // ✅ Mínimo días restantes (DIA)
    const minDiasDiaSQL = `
      SELECT MIN((d.fecha_prox_vto_aa::date - CURRENT_DATE))::int AS mindiasdia
      FROM ema.declaraciones d
      JOIN ema.proyectos p ON p.gid = d.id_proyecto
      ${where ? where + " AND" : "WHERE"}
        d.fecha_prox_vto_aa IS NOT NULL;
    `;

    // ✅ Mínimo días restantes (Resolución) usando última resolución por proyecto
    const minDiasResSQL = `
      WITH latest_res AS (
        SELECT DISTINCT ON (id_proyecto)
          id_resoluciones,
          id_proyecto,
          fecha_prox_vto_aa
        FROM ema.resoluciones
        WHERE fecha_prox_vto_aa IS NOT NULL
        ORDER BY id_proyecto, fecha_prox_vto_aa DESC
      )
      SELECT MIN((lr.fecha_prox_vto_aa::date - CURRENT_DATE))::int AS mindiasres
      FROM latest_res lr
      JOIN ema.proyectos p ON p.gid = lr.id_proyecto
      ${where ? where + " AND" : "WHERE"}
        lr.fecha_prox_vto_aa IS NOT NULL;
    `;

    const [
      totalRes,
      licRes,
      evalRes,
      diaProxRes,
      resProxRes,
      minDiaRes,
      minResRes,
    ] = await Promise.all([
      pool.query(totalSQL, params),
      pool.query(licenciaSQL, params),
      pool.query(evaluacionSQL, params),
      pool.query(diaProxSQL, params),
      pool.query(resProxSQL, params),
      pool.query(minDiasDiaSQL, params),
      pool.query(minDiasResSQL, params),
    ]);

    res.json({
      total: Number(totalRes.rows?.[0]?.total || 0),
      evaluacion: Number(evalRes.rows?.[0]?.total || 0),
      licencia: Number(licRes.rows?.[0]?.total || 0),

      diaProx: Number(diaProxRes.rows?.[0]?.diaprox || 0),
      resProx: Number(resProxRes.rows?.[0]?.resprox || 0),

      // null si no hay fechas cargadas
      minDiasDia: minDiaRes.rows?.[0]?.mindiasdia ?? null,
      minDiasRes: minResRes.rows?.[0]?.mindiasres ?? null,
    });
  } catch (err) {
    console.error("resumenProyectos:", err);
    res.status(500).json({ error: "Error al obtener resumen", detail: err.message });
  }
};

/** ---------------------------------------------------------------------
 *  BLOQUE 2: Dashboard encuestas
 * --------------------------------------------------------------------*/
const tramosPorProyecto = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (id_proyecto) {
      params.push(id_proyecto);
      conds.push(`p.gid = $${params.length}`);
    }

    const tramoParam = req?.query?.id_tramo ? Number(req.query.id_tramo) : null;
    const tipo_clase_raw = (req?.query?.tipo_clase || "").toString().trim().toUpperCase();
    const tipo_clase = tipo_clase_raw === "SINDATO" ? "SIN DATO" : tipo_clase_raw;

    let eConds = [`e.id_proyecto = p.gid`];
    if (tramoParam) {
      params.push(tramoParam);
      eConds.push(`e.id_tramo = $${params.length}`);
    }
    if (["NORMAL", "ESPECIAL", "SIN DATO"].includes(tipo_clase)) {
      params.push(tipo_clase);
      eConds.push(`(${CLASE_EXPR}) = $${params.length}`);
    }

    const whereP = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    dbg("tramosPorProyecto", { eConds, whereP, params, query: req.query });

    const sql = `
      SELECT
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        COALESCE(COUNT(e.id_encuesta), 0)::int AS total_encuestas,
        COALESCE((SELECT COUNT(*) FROM ema.tramos t
                   WHERE t.id_proyecto = p.gid AND t.cerrado = true), 0)::int AS tramos_cerrados
      FROM ema.proyectos p
      LEFT JOIN ema.encuestas e
        ON ${eConds.join(" AND ")}
      ${whereP}
      GROUP BY p.gid, p.nombre
      ORDER BY p.nombre;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("tramosPorProyecto:", err);
    res.status(500).json({ error: "Error al obtener datos del dashboard" });
  }
};

const encuestasPorProyecto = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("encuestasPorProyecto", { where, params, query: req.query });

    const sql = `
      SELECT p.nombre AS nombre_proyecto,
             p.gid    AS id_proyecto,
             COUNT(*)::int AS total
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre
      ORDER BY p.nombre;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("encuestasPorProyecto:", err);
    res.status(500).json({ error: "Error interno" });
  }
};

const encuestasPorTramo = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("encuestasPorTramo", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT
          e.id_tramo,
          COALESCE(
            NULLIF(t.nombre_tramo, ''),
            NULLIF(e.tramo, ''),
            'Tramo ' || e.id_tramo::text
          ) AS nombre_tramo
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        LEFT JOIN ema.tramos t
               ON t.id_tramo    = e.id_tramo
              AND t.id_proyecto = e.id_proyecto
        ${where}
      )
      SELECT id_tramo, nombre_tramo, COUNT(*)::int AS total
      FROM base
      GROUP BY id_tramo, nombre_tramo
      ORDER BY id_tramo;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("encuestasPorTramo:", err);
    res.status(500).json({ error: "Error interno" });
  }
};

/** === incluyen filtro de clase vía buildWhere === */
const afectacionPorTramo = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("afectacionPorTramo", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid      AS id_proyecto,
        p.nombre   AS nombre_proyecto,
        e.id_tramo,
        e.afectacion AS afectacion,
        COUNT(*)::int AS total
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where ? where + " AND" : "WHERE"} e.afectacion IS NOT NULL
      GROUP BY p.gid, p.nombre, e.id_tramo, e.afectacion
      ORDER BY p.nombre, e.id_tramo, e.afectacion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("afectacionPorTramo:", err);
    res.status(500).json({ error: "Error al obtener datos de afectación" });
  }
};

const caracteristicasPredioPorTramo = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("caracteristicasPredioPorTramo", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        e.id_tramo,
        e.caracteristicas_predio,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where ? where + " AND" : "WHERE"} e.caracteristicas_predio IS NOT NULL
      GROUP BY p.gid, p.nombre, e.id_tramo, e.caracteristicas_predio
      ORDER BY p.nombre, e.id_tramo, e.caracteristicas_predio;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("caracteristicasPredioPorTramo:", err);
    res.status(500).json({ error: "Error interno al obtener características" });
  }
};

const condicionOcupacionPorTramo = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("condicionOcupacionPorTramo", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        e.id_tramo,
        e.condicion_ocupacion,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where ? where + " AND" : "WHERE"} e.condicion_ocupacion IS NOT NULL
      GROUP BY p.gid, p.nombre, e.id_tramo, e.condicion_ocupacion
      ORDER BY p.nombre, e.id_tramo, e.condicion_ocupacion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("condicionOcupacionPorTramo:", err);
    res.status(500).json({ error: "Error interno al obtener condición de ocupación" });
  }
};

const interesReubicacion = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("interesReubicacion", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        CASE
          WHEN e.interes_reubicacion = TRUE  THEN 'SI'
          WHEN e.interes_reubicacion = FALSE THEN 'NO'
          ELSE 'SIN DATO'
        END AS opcion,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre, opcion
      ORDER BY p.nombre, opcion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("interesReubicacion:", err);
    res.status(500).json({ error: "Error interno al obtener interés de reubicación" });
  }
};

const percepcionCensista = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("percepcionCensista", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        UPPER(e.percepcion) AS opcion,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where ? where + " AND" : "WHERE"} e.percepcion IS NOT NULL
      GROUP BY p.gid, p.nombre, UPPER(e.percepcion)
      ORDER BY p.nombre, opcion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("percepcionCensista:", err);
    res.status(500).json({ error: "Error interno al obtener percepción del censista" });
  }
};

const poseeDocumento = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("poseeDocumento", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        CASE
          WHEN TRIM(UPPER(e.posee_documento)) IN ('SI','SÍ','YES','TRUE','1') THEN 'SI'
          WHEN TRIM(UPPER(e.posee_documento)) IN ('NO','FALSE','0')           THEN 'NO'
          ELSE 'SIN DATO'
        END AS opcion,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where ? where + " AND" : "WHERE"} e.posee_documento IS NOT NULL
      GROUP BY p.gid, p.nombre, opcion
      ORDER BY p.nombre, opcion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("poseeDocumento:", err);
    res.status(500).json({ error: "Error interno al obtener documentación del terreno" });
  }
};

/** ---------------------------------------------------------------------
 *  BLOQUE 3: Endpoints NUEVOS
 * --------------------------------------------------------------------*/
const ciudad = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("ciudad", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        NULLIF(TRIM(e.ciudad), '') AS ciudad,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre, NULLIF(TRIM(e.ciudad), '')
      ORDER BY p.nombre, ciudad;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("ciudad:", err);
    res.status(500).json({ error: "Error interno al obtener ciudad" });
  }
};

const tiempoArraigo = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("tiempoArraigo", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT 
          p.gid AS id_proyecto,
          p.nombre AS nombre_proyecto,
          NULLIF(regexp_replace(COALESCE(e.especificar_anhos, ''), '[^0-9]', '', 'g'), '')::int AS anhos,
          UPPER(NULLIF(TRIM(e.tiempo_arraigo), '')) AS tiempo_txt
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        ${where}
      ),
      rangos AS (
        SELECT id_proyecto, nombre_proyecto,
               CASE
                 WHEN anhos IS NOT NULL THEN
                   CASE
                     WHEN anhos <= 10 THEN '0 a 10 años'
                     WHEN anhos <= 20 THEN '11 a 20 años'
                     WHEN anhos <= 30 THEN '21 a 30 años'
                     ELSE 'Más de 30 años'
                   END
                 WHEN tiempo_txt IN ('MENOS DE 1 AÑO','<1 AÑO','MENOS DE UN AÑO') THEN '0 a 10 años'
                 WHEN tiempo_txt IS NULL THEN 'Sin dato'
                 ELSE '0 a 10 años'
               END AS rango
        FROM base
      )
      SELECT id_proyecto, nombre_proyecto, rango, COUNT(*)::int AS cantidad
      FROM rangos
      GROUP BY id_proyecto, nombre_proyecto, rango
      ORDER BY nombre_proyecto, rango;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("tiempoArraigo:", err);
    res.status(500).json({ error: "Error interno al obtener tiempo de arraigo" });
  }
};

const ocupacionRubro = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("ocupacionRubro", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT 
          p.gid    AS id_proyecto,
          p.nombre AS nombre_proyecto,
          COALESCE(
            NULLIF(btrim(e.ocupacion), ''),
            NULLIF(btrim(e.ocupacion_otro), ''),
            'Sin dato'
          ) AS ocupacion
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        ${where}
      )
      SELECT id_proyecto, nombre_proyecto, ocupacion, COUNT(*)::int AS cantidad
      FROM base
      GROUP BY id_proyecto, nombre_proyecto, ocupacion
      ORDER BY nombre_proyecto, ocupacion;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("ocupacionRubro:", err);
    res.status(500).json({ error: "Error interno al obtener ocupación/rubro" });
  }
};

const medioSubsistencia = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("medioSubsistencia", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT 
          p.gid AS id_proyecto,
          p.nombre AS nombre_proyecto,
          NULLIF(TRIM(e.medio_subsistencia), '') AS txt,
          e.medio_subsistencia_familiares AS fam,
          e.medio_subsistencia_subsidio   AS sub,
          e.medio_subsistencia_jubilacion AS jub,
          e.medio_subsistencia_ahorros    AS aho,
          e.medio_subsistencia_sin_ingresos AS sining,
          e.medio_subsistencia_otro       AS otro
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        ${where}
      ),
      directos AS (
        SELECT id_proyecto, nombre_proyecto, INITCAP(txt) AS categoria
        FROM base WHERE txt IS NOT NULL
      ),
      flags AS (
        SELECT id_proyecto, nombre_proyecto, 'Familiares'  AS categoria FROM base WHERE txt IS NULL AND fam = TRUE
        UNION ALL SELECT id_proyecto, nombre_proyecto, 'Subsidio'       FROM base WHERE txt IS NULL AND sub = TRUE
        UNION ALL SELECT id_proyecto, nombre_proyecto, 'Jubilación'     FROM base WHERE txt IS NULL AND jub = TRUE
        UNION ALL SELECT id_proyecto, nombre_proyecto, 'Ahorros'        FROM base WHERE txt IS NULL AND aho = TRUE
        UNION ALL SELECT id_proyecto, nombre_proyecto, 'Sin ingresos'   FROM base WHERE txt IS NULL AND sining = TRUE
        UNION ALL SELECT id_proyecto, nombre_proyecto, 'Otro'           FROM base WHERE txt IS NULL AND otro = TRUE
      ),
      union_all AS (
        SELECT * FROM directos
        UNION ALL
        SELECT * FROM flags
      )
      SELECT id_proyecto, nombre_proyecto,
             COALESCE(categoria, 'Sin dato') AS medio_subsistencia,
             COUNT(*)::int AS cantidad
      FROM union_all
      GROUP BY id_proyecto, nombre_proyecto, COALESCE(categoria, 'Sin dato')
      ORDER BY nombre_proyecto, medio_subsistencia;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("medioSubsistencia:", err);
    res.status(500).json({ error: "Error interno al obtener medio de subsistencia" });
  }
};

const predioServicios = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("predioServicios", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        COALESCE(NULLIF(TRIM(e.caracteristicas_predio), ''), 'Sin dato') AS caracteristica,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre, caracteristica
      ORDER BY p.nombre, caracteristica;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("predioServicios:", err);
    res.status(500).json({ error: "Error interno al obtener características/servicios" });
  }
};

const discapacidadSalud = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("discapacidadSalud", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT 
          p.gid AS id_proyecto,
          p.nombre AS nombre_proyecto,
          COALESCE(e.personas_discapacidad, 0)::int   AS discap,
          COALESCE(e.personas_req_esp_salud, 0)::int  AS reqesp
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        ${where}
      )
      SELECT id_proyecto, nombre_proyecto, 'Discapacidad' AS tipo, SUM(discap)::int AS cantidad
      FROM base GROUP BY id_proyecto, nombre_proyecto
      UNION ALL
      SELECT id_proyecto, nombre_proyecto, 'Requerimientos especiales' AS tipo, SUM(reqesp)::int AS cantidad
      FROM base GROUP BY id_proyecto, nombre_proyecto
      ORDER BY nombre_proyecto, tipo;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("discapacidadSalud:", err);
    res.status(500).json({ error: "Error interno al obtener discapacidad/salud" });
  }
};

const instalacionesUso = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("instalacionesUso", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        CASE
          WHEN e.finalidad_instalacion IS NULL OR TRIM(e.finalidad_instalacion) = '' THEN 'Sin dato'
          WHEN UPPER(e.finalidad_instalacion) LIKE '%CONSUMO%' THEN 'Consumo'
          WHEN UPPER(e.finalidad_instalacion) LIKE '%VENTA%'   THEN 'Venta'
          ELSE 'Otro'
        END AS uso,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre, uso
      ORDER BY p.nombre, uso;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("instalacionesUso:", err);
    res.status(500).json({ error: "Error interno al obtener instalaciones/uso" });
  }
};

const ingresoMensualCategoria = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("ingresoMensualCategoria", { where, params, query: req.query });

    const sql = `
      WITH base AS (
        SELECT 
          p.gid    AS id_proyecto,
          p.nombre AS nombre_proyecto,
          COALESCE(
            NULLIF(TRIM(e.ingreso_mensual_microempresa), ''),
            NULLIF(TRIM(e.ingreso_mensual_comercio), ''),
            NULLIF(TRIM(e.ingreso_mensual), '')
          ) AS raw
        FROM ema.encuestas e
        JOIN ema.proyectos p ON p.gid = e.id_proyecto
        ${where}
      ),
      cat AS (
        SELECT
          id_proyecto,
          nombre_proyecto,
          CASE
            WHEN raw IS NULL OR raw = '' THEN 'Sin dato'
            WHEN UPPER(raw) LIKE '%MICRO%' THEN 'Microempresa'
            WHEN UPPER(raw) LIKE '%PEQUE%' THEN 'Pequeña'
            WHEN UPPER(raw) LIKE '%MEDIAN%' THEN 'Mediana'
            WHEN UPPER(raw) LIKE '%GRAND%' OR UPPER(raw) LIKE '%A MÁS%' THEN 'Grande'
            ELSE 'Sin dato'
          END AS categoria_ingreso
        FROM base
      )
      SELECT id_proyecto, nombre_proyecto, categoria_ingreso, COUNT(*)::int AS cantidad
      FROM cat
      GROUP BY id_proyecto, nombre_proyecto, categoria_ingreso
      ORDER BY nombre_proyecto,
        CASE categoria_ingreso
          WHEN 'Microempresa' THEN 1
          WHEN 'Pequeña'      THEN 2
          WHEN 'Mediana'      THEN 3
          WHEN 'Grande'       THEN 4
          ELSE 5
        END;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("ingresoMensualCategoria:", err);
    res.status(500).json({ error: "Error interno al obtener ingreso mensual (categoría)" });
  }
};

const pertenenciaOrganizacion = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("pertenenciaOrganizacion", { where, params, query: req.query });

    const sql = `
      SELECT 
        p.gid AS id_proyecto,
        p.nombre AS nombre_proyecto,
        CASE
          WHEN e.pertenece_comision = TRUE  THEN 'SI'
          WHEN e.pertenece_comision = FALSE THEN 'NO'
          ELSE 'SIN DATO'
        END AS pertenece,
        COUNT(*)::int AS cantidad
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      GROUP BY p.gid, p.nombre, pertenece
      ORDER BY p.nombre, pertenece;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("pertenenciaOrganizacion:", err);
    res.status(500).json({ error: "Error interno al obtener pertenencia a organización" });
  }
};

const organizacion = pertenenciaOrganizacion;

/** ---------------------------------------------------------------------
 *  NUEVO: Crudo por clase / tramo
 * --------------------------------------------------------------------*/
const encuestasRawPorClaseTramo = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const id_proyecto = req?.query?.id_proyecto ? Number(req.query.id_proyecto) : null;
    if (!id_proyecto) {
      return res.status(400).json({ error: "Falta id_proyecto" });
    }
    params.push(id_proyecto);
    conds.push(`p.gid = $${params.length}`);

    const id_tramo = req?.query?.id_tramo ? Number(req.query.id_tramo) : null;
    if (id_tramo) {
      params.push(id_tramo);
      conds.push(`e.id_tramo = $${params.length}`);
    }

    const tipo_clase_raw = (req?.query?.tipo_clase || "").toString().trim().toUpperCase();
    const tipo_clase = tipo_clase_raw === "SINDATO" ? "SIN DATO" : tipo_clase_raw;
    if (["NORMAL", "ESPECIAL", "SIN DATO"].includes(tipo_clase)) {
      params.push(tipo_clase);
      conds.push(`(${CLASE_EXPR}) = $${params.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    dbg("encuestasRawPorClaseTramo", { where, params, query: req.query });

    const sql = `
      SELECT
        e.*,
        (${CLASE_EXPR}) AS clase_norm,
        COALESCE(
          NULLIF(t.nombre_tramo, ''),
          NULLIF(e.tramo, ''),
          'Tramo ' || e.id_tramo::text
        ) AS nombre_tramo
      FROM ema.encuestas e
      JOIN ema.proyectos p
        ON p.gid = e.id_proyecto
      LEFT JOIN ema.tramos t
        ON t.id_proyecto = e.id_proyecto
       AND t.id_tramo    = e.id_tramo
      ${where}
      ORDER BY e.id_tramo NULLS LAST, e.id_encuesta;
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("encuestasRawPorClaseTramo:", err);
    res.status(500).json({ error: "Error al obtener encuestas por clase/tramo", detail: err.message });
  }
};

/** ---------------------------------------------------------------------
 *  TEST público: ver qué está clasificando el backend
 * --------------------------------------------------------------------*/
const testClasePublic = async (req, res) => {
  try {
    const { where, params } = buildWhere(req, { withTramo: true });
    dbg("testClasePublic", { where, params, query: req.query });

    const sql = `
      SELECT e.id_encuesta,
             ${CLASE_EXPR} AS clase_norm,
             e.tipo_inmueble,
             e.id_tramo, e.id_proyecto
      FROM ema.encuestas e
      JOIN ema.proyectos p ON p.gid = e.id_proyecto
      ${where}
      ORDER BY e.id_encuesta DESC
      LIMIT 50;
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("testClasePublic:", err);
    res.status(500).json({ error: "Error en testClase", detail: err.message });
  }
};

// ✅ NUEVO: lista de vencimientos (DIA + Resolución) con nombre proyecto y días
// ✅ NUEVO: lista de vencimientos (prioriza Resolución sobre DIA)
const vencimientosProximos = async (req, res) => {
  try {
    const { conds, params } = buildProjectConds(req);

    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50);
    params.push(limit);
    const limitIdx = params.length;

    const whereP = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const sql = `
      WITH
      -- DIA: fecha más cercana por proyecto
      dia AS (
        SELECT
          p.gid AS id_proyecto,
          p.nombre AS nombre_proyecto,
          MIN(d.fecha_prox_vto_aa::date) AS fecha_vto
        FROM ema.declaraciones d
        JOIN ema.proyectos p ON p.gid = d.id_proyecto
        ${whereP ? whereP + " AND" : "WHERE"}
          d.fecha_prox_vto_aa IS NOT NULL
        GROUP BY p.gid, p.nombre
      ),

      -- RES: última resolución por proyecto
      latest_res AS (
        SELECT DISTINCT ON (r.id_proyecto)
          r.id_proyecto,
          r.fecha_prox_vto_aa::date AS fecha_vto
        FROM ema.resoluciones r
        WHERE r.fecha_prox_vto_aa IS NOT NULL
        ORDER BY r.id_proyecto, r.fecha_prox_vto_aa DESC
      ),
      reso AS (
        SELECT
          p.gid AS id_proyecto,
          p.nombre AS nombre_proyecto,
          lr.fecha_vto
        FROM latest_res lr
        JOIN ema.proyectos p ON p.gid = lr.id_proyecto
        ${whereP}
      ),

      -- ✅ Prioridad: si hay resolución, ocultar DIA
      unioned AS (
        -- Resoluciones siempre entran
        SELECT
          'RESOLUCION'::text AS tipo,
          id_proyecto,
          nombre_proyecto,
          fecha_vto,
          (fecha_vto - CURRENT_DATE)::int AS dias
        FROM reso

        UNION ALL

        -- DIA solo si NO existe resolución para ese proyecto
        SELECT
          'DIA'::text AS tipo,
          d.id_proyecto,
          d.nombre_proyecto,
          d.fecha_vto,
          (d.fecha_vto - CURRENT_DATE)::int AS dias
        FROM dia d
        LEFT JOIN reso r ON r.id_proyecto = d.id_proyecto
        WHERE r.id_proyecto IS NULL
      )

      SELECT *
      FROM unioned
      ORDER BY
        CASE WHEN dias < 0 THEN 0 ELSE 1 END,  -- vencidas primero
        dias ASC,
        nombre_proyecto ASC
      LIMIT $${limitIdx};
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("vencimientosProximos:", err);
    res.status(500).json({ error: "Error al obtener vencimientos", detail: err.message });
  }
};

/** ---------------------------------------------------------------------
 *  EXPORTS
 * --------------------------------------------------------------------*/
module.exports = {
  // Métricas de proyectos
  proyectosPorEstado,
  proyectosPorAnioSector,
  proyectosPorAnioTipoEstudio,
  proyectosPorAnioImpacto,
  tiposEstudioTotales,
  resumenProyectos,
  proyectosPorEstadoNumerico,

  // Dashboard encuestas
  tramosPorProyecto,
  encuestasPorProyecto,
  encuestasPorTramo,

  afectacionPorTramo,
  caracteristicasPredioPorTramo,
  condicionOcupacionPorTramo,
  interesReubicacion,
  percepcionCensista,
  poseeDocumento,

  // Nuevos
  ciudad,
  tiempoArraigo,
  ocupacionRubro,
  medioSubsistencia,
  predioServicios,
  discapacidadSalud,
  instalacionesUso,
  ingresoMensualCategoria,
  pertenenciaOrganizacion,
  vencimientosProximos,

  // Alias
  organizacion,

  // Crudo
  encuestasRawPorClaseTramo,

  // Test
  testClasePublic,
};
