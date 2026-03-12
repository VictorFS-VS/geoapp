// controllers/informesDashboard.controller.js
const pool = require("../db");

/* =========================
   Helpers
   ========================= */
function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "si", "sí", "y", "yes"].includes(s)) return true;
  if (["0", "false", "f", "no", "n"].includes(s)) return false;
  return fallback;
}

function toDateISO(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function isCategorical(tipo) {
  const t = String(tipo || "").toLowerCase();
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "semáforo",
    "semaforo",
    "multi",
    "multiselect",
    "check",
    "checkbox",
    "boolean",
  ].includes(t);
}

function isBoolean(tipo) {
  const t = String(tipo || "").toLowerCase();
  return ["bool", "boolean", "si_no", "sino", "yesno"].includes(t);
}

function isNumeric(tipo) {
  const t = String(tipo || "").toLowerCase();
  return ["numero", "num", "number", "decimal", "int", "integer", "rango"].includes(t);
}

function normalizeLabel(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const lo = s.toLowerCase();
  if (lo === "-" || lo === "null" || lo === "undefined") return null;

  const u = s.toUpperCase();
  if (["VERDE", "GREEN"].includes(u)) return "Verde";
  if (["AMARILLO", "YELLOW"].includes(u)) return "Amarillo";
  if (["ROJO", "RED"].includes(u)) return "Rojo";
  if (["SI", "SÍ", "YES", "TRUE"].includes(u)) return "Sí";
  if (["NO", "FALSE"].includes(u)) return "No";
  return s;
}

function chartTypeForPregunta(tipo) {
  const t = String(tipo || "").toLowerCase();
  if (isNumeric(t)) return "bar";
  if (isBoolean(t)) return "pie";
  return "bar";
}

/* =========================
   Heurísticas para excluir "numéricos"
   que en realidad no conviene graficar
   ========================= */
function normText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function shouldSkipNumericQuestion(p) {
  const txt = normText(`${p?.etiqueta || ""} ${p?.seccion_titulo || ""}`);

  const blacklist = [
    "sujeto",
    "telefono",
    "celular",
    "documento",
    "cedula",
    "c.i",
    "ci ",
    "ruc",
    "codigo",
    "codigo censo",
    "progresiva",
    "latitud",
    "longitud",
    "coordenada",
    "coordenadas",
    "gps",
    "fecha",
    "hora",
    "ip",
    "url",
    "foto",
    "version",
    "navegador",
    "direccion ip",
    "geolocalizacion",
  ];

  return blacklist.some((x) => txt.includes(x));
}

/* =========================
   SQL builder para filtros comunes
   ========================= */
function buildInformeFilters({ id_proyecto, id_plantilla, desde, hasta, solo_cerrados = false }) {
  const params = [];
  let idx = 1;

  let where = `WHERE i.id_proyecto = $${idx++}`;
  params.push(id_proyecto);

  if (id_plantilla) {
    where += ` AND i.id_plantilla = $${idx++}`;
    params.push(id_plantilla);
  }

  if (desde) {
    where += ` AND i.fecha_creado::date >= $${idx++}::date`;
    params.push(desde);
  }

  if (hasta) {
    where += ` AND i.fecha_creado::date <= $${idx++}::date`;
    params.push(hasta);
  }

  // Dejá este filtro solo si la columna existe en ema.informe
  if (solo_cerrados) {
    where += ` AND COALESCE(i.cerrado, false) = true`;
  }

  return { whereSql: where, params };
}

/* =========================================================
   GET /api/informes-dashboard/plantillas?id_proyecto=123
   ========================================================= */
async function getPlantillasPorProyecto(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    if (!id_proyecto) {
      return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
    }

    const q = `
      SELECT
        i.id_plantilla,
        COALESCE(p.nombre, 'Plantilla ' || i.id_plantilla) AS nombre,
        COUNT(*)::int AS total_informes,
        MAX(i.fecha_creado)::date AS ultimo
      FROM ema.informe i
      LEFT JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      WHERE i.id_proyecto = $1
      GROUP BY i.id_plantilla, p.nombre
      ORDER BY total_informes DESC, ultimo DESC NULLS LAST, i.id_plantilla ASC
    `;
    const r = await pool.query(q, [id_proyecto]);
    return res.json({ ok: true, plantillas: r.rows });
  } catch (err) {
    console.error("getPlantillasPorProyecto:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

/* =========================================================
   GET /api/informes-dashboard/charts
   ?id_proyecto=123&id_plantilla=5&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
   ========================================================= */
async function getChartsAgregados(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    if (!id_proyecto) {
      return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
    }

    const id_plantilla = toInt(req.query.id_plantilla, null);
    const desde = toDateISO(req.query.desde);
    const hasta = toDateISO(req.query.hasta);
    const solo_cerrados = toBool(req.query.solo_cerrados, false);

    const { whereSql, params } = buildInformeFilters({
      id_proyecto,
      id_plantilla,
      desde,
      hasta,
      solo_cerrados,
    });

    // 1) Conteo
    const qCount = `SELECT COUNT(*)::int AS n FROM ema.informe i ${whereSql}`;
    const rCount = await pool.query(qCount, params);
    const n_informes = rCount.rows[0]?.n || 0;

    if (n_informes === 0) {
      return res.json({
        ok: true,
        scope: { id_proyecto, id_plantilla, desde, hasta, solo_cerrados, n_informes },
        charts: [],
      });
    }

    // 2) Plantillas target
    let plantillasTarget = [];
    if (id_plantilla) {
      plantillasTarget = [id_plantilla];
    } else {
      const qPl = `
        SELECT DISTINCT i.id_plantilla
        FROM ema.informe i
        ${whereSql}
        ORDER BY i.id_plantilla ASC
      `;
      const rPl = await pool.query(qPl, params);
      plantillasTarget = rPl.rows.map((x) => Number(x.id_plantilla)).filter(Boolean);
    }

    if (!plantillasTarget.length) {
      return res.json({
        ok: true,
        scope: { id_proyecto, id_plantilla, desde, hasta, solo_cerrados, n_informes },
        charts: [],
      });
    }

    // 3) Catálogo de preguntas
    const qPreg = `
      SELECT
        q.id_pregunta,
        q.id_seccion,
        s.id_plantilla,
        COALESCE(NULLIF(BTRIM(s.titulo), ''), 'Sin sección') AS seccion_titulo,
        q.etiqueta,
        q.tipo,
        q.opciones_json
      FROM ema.informe_pregunta q
      JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
      WHERE s.id_plantilla = ANY($1::int[])
      ORDER BY s.id_plantilla ASC, s.orden ASC, q.orden ASC, q.id_pregunta ASC
    `;
    const rPreg = await pool.query(qPreg, [plantillasTarget]);
    const preguntas = rPreg.rows || [];

    if (!preguntas.length) {
      return res.json({
        ok: true,
        scope: { id_proyecto, id_plantilla, desde, hasta, solo_cerrados, n_informes },
        charts: [],
        warning: "No se encontraron preguntas para esas plantillas.",
      });
    }

    // 4) Separar por tipo
    const catIds = [];
    const boolIds = [];
    const numIds = [];

    for (const p of preguntas) {
      const pid = Number(p.id_pregunta);
      if (!pid) continue;

      if (isNumeric(p.tipo)) {
        if (!shouldSkipNumericQuestion(p)) {
          numIds.push(pid);
        }
      } else if (isBoolean(p.tipo)) {
        boolIds.push(pid);
      } else if (isCategorical(p.tipo)) {
        catIds.push(pid);
      } else {
        catIds.push(pid);
      }
    }

    // 5A) Categóricos
    let catAgg = [];
    if (catIds.length) {
      const qCat = `
        SELECT
          r.id_pregunta,
          BTRIM(r.valor_texto) AS valor,
          COUNT(*)::int AS cantidad
        FROM ema.informe i
        JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
        ${whereSql}
          AND r.id_pregunta = ANY($${params.length + 1}::int[])
          AND NULLIF(BTRIM(r.valor_texto), '') IS NOT NULL
          AND LOWER(BTRIM(r.valor_texto)) NOT IN ('-', 'null', 'undefined')
        GROUP BY r.id_pregunta, BTRIM(r.valor_texto)
        ORDER BY r.id_pregunta ASC, cantidad DESC
      `;
      const rCat = await pool.query(qCat, [...params, catIds]);
      catAgg = rCat.rows || [];
    }

    // 5B) Boolean
    let boolAgg = [];
    if (boolIds.length) {
      const qBool = `
        SELECT
          r.id_pregunta,
          CASE
            WHEN r.valor_bool IS TRUE THEN 'Sí'
            WHEN r.valor_bool IS FALSE THEN 'No'
            ELSE BTRIM(r.valor_texto)
          END AS valor,
          COUNT(*)::int AS cantidad
        FROM ema.informe i
        JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
        ${whereSql}
          AND r.id_pregunta = ANY($${params.length + 1}::int[])
          AND (
            r.valor_bool IS NOT NULL
            OR (
              NULLIF(BTRIM(r.valor_texto), '') IS NOT NULL
              AND LOWER(BTRIM(r.valor_texto)) NOT IN ('-', 'null', 'undefined')
            )
          )
        GROUP BY r.id_pregunta, CASE
          WHEN r.valor_bool IS TRUE THEN 'Sí'
          WHEN r.valor_bool IS FALSE THEN 'No'
          ELSE BTRIM(r.valor_texto)
        END
        ORDER BY r.id_pregunta ASC, cantidad DESC
      `;
      const rBool = await pool.query(qBool, [...params, boolIds]);
      boolAgg = rBool.rows || [];
    }

    // 5C) Numéricos seguros
    let numAgg = [];
    if (numIds.length) {
      const qNum = `
        WITH num_base AS (
          SELECT
            r.id_pregunta,
            BTRIM(r.valor_texto) AS raw_valor
          FROM ema.informe i
          JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
          ${whereSql}
            AND r.id_pregunta = ANY($${params.length + 1}::int[])
        ),
        num_parse AS (
          SELECT
            nb.id_pregunta,
            nb.raw_valor,
            CASE
              WHEN nb.raw_valor IS NULL OR nb.raw_valor = '' THEN NULL
              WHEN LOWER(nb.raw_valor) IN ('-', 'null', 'undefined', 'nan', '..') THEN NULL

              -- excluir coordenadas "lat,lng"
              WHEN nb.raw_valor ~ '^\\s*[+-]?\\d+(\\.\\d+)?\\s*,\\s*[+-]?\\d+(\\.\\d+)?\\s*$' THEN NULL

              -- excluir progresivas tipo 0+100, 12+450
              WHEN nb.raw_valor ~ '^\\s*\\d+\\s*\\+\\s*\\d+\\s*$' THEN NULL

              -- excluir fechas tipo 2026-03-12
              WHEN nb.raw_valor ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN NULL

              -- excluir urls
              WHEN LOWER(nb.raw_valor) ~ '^(https?|ftp)://' THEN NULL

              -- excluir IDs numéricos largos (sujeto, códigos, etc.)
              WHEN nb.raw_valor ~ '^\\s*\\d{10,}\\s*$' THEN NULL

              ELSE (
                CASE
                  WHEN REPLACE(REGEXP_REPLACE(nb.raw_valor, '[^0-9\\.,+-]', '', 'g'), ',', '.') ~ '^[+-]?\\d+(\\.\\d+)?$'
                  THEN REPLACE(REGEXP_REPLACE(nb.raw_valor, '[^0-9\\.,+-]', '', 'g'), ',', '.')::numeric
                  ELSE NULL
                END
              )
            END AS num_val
          FROM num_base nb
        ),
        num_bucket AS (
          SELECT
            np.id_pregunta,
            np.num_val,
            CASE
              WHEN np.num_val IS NULL THEN NULL
              WHEN np.num_val = TRUNC(np.num_val)
                THEN TRUNC(np.num_val)::text
              ELSE TO_CHAR(ROUND(np.num_val, 2), 'FM999999999999999999999999990.00')
            END AS bucket_label
          FROM num_parse np
          WHERE np.num_val IS NOT NULL
        )
        SELECT
          nb.id_pregunta,
          nb.bucket_label AS valor,
          COUNT(*)::int AS cantidad,
          MIN(nb.num_val) AS orden_num
        FROM num_bucket nb
        GROUP BY nb.id_pregunta, nb.bucket_label
        ORDER BY nb.id_pregunta ASC, orden_num ASC, nb.bucket_label ASC
      `;
      const rNum = await pool.query(qNum, [...params, numIds]);
      numAgg = rNum.rows || [];
    }

    // 6) Armado
    const byPregunta = new Map();

    function pushAgg(pid, rawValor, cantidad) {
      const label = normalizeLabel(rawValor);
      const cnt = Number(cantidad) || 0;
      if (!label) return;
      if (!Number.isFinite(cnt) || cnt <= 0) return;

      if (!byPregunta.has(pid)) byPregunta.set(pid, { labels: [], data: [] });
      byPregunta.get(pid).labels.push(label);
      byPregunta.get(pid).data.push(cnt);
    }

    for (const row of catAgg) {
      pushAgg(Number(row.id_pregunta), row.valor, row.cantidad);
    }

    for (const row of boolAgg) {
      pushAgg(Number(row.id_pregunta), row.valor, row.cantidad);
    }

    for (const row of numAgg) {
      pushAgg(Number(row.id_pregunta), row.valor, row.cantidad);
    }

    const charts = [];

    for (const p of preguntas) {
      const pid = Number(p.id_pregunta);
      if (!pid) continue;

      const seccion = p.seccion_titulo || "Sin sección";
      const etiqueta = p.etiqueta || `Pregunta ${pid}`;
      const type = chartTypeForPregunta(p.tipo);

      const agg = byPregunta.get(pid);
      if (!agg || !agg.labels.length) continue;

      let labels = agg.labels.slice();
      let data = agg.data.slice();

      if (p.opciones_json && Array.isArray(p.opciones_json) && !isNumeric(p.tipo)) {
        const wanted = p.opciones_json.map((x) => normalizeLabel(x)).filter(Boolean);
        const map = new Map(labels.map((l, i) => [l, data[i]]));

        labels = wanted.filter((l) => map.has(l));
        data = labels.map((l) => map.get(l));

        for (const [l, v] of map.entries()) {
          if (!wanted.includes(l)) {
            labels.push(l);
            data.push(v);
          }
        }
      }

      const filtered = [];
      for (let i = 0; i < labels.length; i++) {
        const l = normalizeLabel(labels[i]);
        const v = Number(data[i] || 0);
        if (!l) continue;
        if (!Number.isFinite(v) || v <= 0) continue;
        filtered.push([l, v]);
      }
      if (!filtered.length) continue;

      charts.push({
        key: `preg_${pid}`,
        id_pregunta: pid,
        id_seccion: p.id_seccion,
        seccion,
        etiqueta,
        tipo_pregunta: p.tipo,
        type: isNumeric(p.tipo) ? "bar" : type,
        labels: filtered.map((x) => x[0]),
        datasets: [
          {
            label: "Cantidad",
            data: filtered.map((x) => x[1]),
          },
        ],
      });
    }

    return res.json({
      ok: true,
      scope: { id_proyecto, id_plantilla, desde, hasta, solo_cerrados, n_informes },
      charts,
    });
  } catch (err) {
    console.error("getChartsAgregados:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

module.exports = {
  getPlantillasPorProyecto,
  getChartsAgregados,
};