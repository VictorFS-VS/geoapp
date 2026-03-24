// controllers/informesDashboard.controller.js
const pool = require("../db");
const {
  resolveDashboardGeoLinks,
  buildTramoCatalog,
  buildProgresivaCatalog,
  buildSubtramoCatalog,
  buildInformesSubmapPayload,
} = require("../services/dashboardGeoLinks.service");
const { getDashboardInformeUniverseIds } = require("./informesDashboardResumen.controller");
const { parseInformeLatLng } = require("../helpers/informesGeoSummary");

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

function isSummaryCandidateType(tipo) {
  const t = String(tipo || "").trim().toLowerCase();
  if (!t) return false;
  if (
    t.includes("mapa") ||
    t.includes("coord") ||
    t.includes("imagen") ||
    t.includes("foto") ||
    t.includes("archivo") ||
    t.includes("upload") ||
    t.includes("json") ||
    t.includes("fecha") ||
    t === "date" ||
    t === "datetime" ||
    isNumeric(t)
  ) {
    return false;
  }
  return true;
}

function shouldSkipSummaryLabel(label) {
  const txt = normText(label || "");
  if (!txt) return true;
  const blacklist = [
    "lat",
    "latitud",
    "lon",
    "long",
    "longitud",
    "coordenada",
    "coordenadas",
    "mapa",
    "ubicacion",
    "ubicac",
    "gps",
    "foto",
    "fotos",
    "imagen",
    "archivo",
    "fecha",
    "hora",
    "titulo",
    "nombre de plantilla",
    "plantilla",
  ];
  return blacklist.some((token) => txt.includes(token));
}

function normalizeSummaryText(rawValue, tipo) {
  if (rawValue === null || rawValue === undefined) return null;
  const t = String(tipo || "").trim().toLowerCase();

  if (isBoolean(t)) {
    const normalized = normalizeLabel(rawValue);
    return normalized || null;
  }

  if (t === "semaforo" || t.includes("semaforo")) {
    const sem = normalizeSemaforoRaw(rawValue);
    return sem.semaforo_label || sem.semaforo_color || null;
  }

  const text = String(rawValue).trim();
  if (!text) return null;

  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const joined = parsed
          .map((value) => normalizeLabel(value))
          .filter(Boolean)
          .join(", ");
        return joined || null;
      }
      if (parsed && typeof parsed === "object") {
        const candidate =
          parsed.label ??
          parsed.nombre ??
          parsed.name ??
          parsed.value ??
          parsed.descripcion ??
          null;
        return normalizeLabel(candidate);
      }
    } catch {}
  }

  return normalizeLabel(text);
}

function summaryPriority(tipo, etiqueta) {
  const t = String(tipo || "").trim().toLowerCase();
  const label = normText(etiqueta || "");

  if (label.includes("descripcion") || label.includes("descripción")) return 1;
  if (label.includes("detalle") || label.includes("observacion") || label.includes("observación")) return 2;
  if (label.includes("tipo")) return 3;
  if (["texto", "text", "textarea", "string"].includes(t)) return 4;
  if (["select", "combo", "opcion", "opciones", "radio"].includes(t)) return 5;
  if (["multi", "multiselect", "check", "checkbox"].includes(t)) return 6;
  if (t === "semaforo" || t.includes("semaforo")) return 7;
  if (isBoolean(t)) return 8;
  return 20;
}

async function buildDashboardInformesSummaryMap({ ids, db }) {
  const informeIds = Array.isArray(ids)
    ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  if (!informeIds.length) return new Map();

  const rSummary = await db.query(
    `
    SELECT
      r.id_informe,
      q.id_pregunta,
      q.etiqueta,
      q.tipo,
      q.orden AS pregunta_orden,
      s.orden AS seccion_orden,
      COALESCE(
        NULLIF(BTRIM(r.valor_texto), ''),
        CASE
          WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Sí' ELSE 'No' END
          WHEN r.valor_json IS NOT NULL THEN r.valor_json::text
          ELSE NULL
        END
      ) AS raw_value
    FROM ema.informe_respuesta r
    JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
    JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
    WHERE r.id_informe = ANY($1::int[])
    ORDER BY r.id_informe ASC, s.orden ASC, q.orden ASC, q.id_pregunta ASC
    `,
    [informeIds]
  );

  const bestByInforme = new Map();

  for (const row of rSummary.rows || []) {
    if (!isSummaryCandidateType(row.tipo)) continue;
    if (shouldSkipSummaryLabel(row.etiqueta)) continue;

    const summaryText = normalizeSummaryText(row.raw_value, row.tipo);
    if (!summaryText) continue;

    const idInforme = Number(row.id_informe);
    if (!idInforme) continue;

    const candidate = {
      summary_field_id: Number(row.id_pregunta) || null,
      summary_label: row.etiqueta || "Resumen",
      summary_text: summaryText,
      priority: summaryPriority(row.tipo, row.etiqueta),
      seccion_orden: Number(row.seccion_orden) || 9999,
      pregunta_orden: Number(row.pregunta_orden) || 9999,
    };

    const prev = bestByInforme.get(idInforme);
    if (!prev) {
      bestByInforme.set(idInforme, candidate);
      continue;
    }

    const wins =
      candidate.priority < prev.priority ||
      (candidate.priority === prev.priority &&
        (candidate.seccion_orden < prev.seccion_orden ||
          (candidate.seccion_orden === prev.seccion_orden &&
            candidate.pregunta_orden < prev.pregunta_orden)));

    if (wins) bestByInforme.set(idInforme, candidate);
  }

  return bestByInforme;
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

function clampLimit(value, fallback = 50, max = 200) {
  const n = toInt(value, null);
  if (!n || n <= 0) return fallback;
  return Math.min(n, max);
}

function normalizeSemaforoRaw(raw) {
  if (raw === null || raw === undefined) {
    return { semaforo_color: null, semaforo_label: null };
  }

  const text = String(raw).trim();
  if (!text) {
    return { semaforo_color: null, semaforo_label: null };
  }

  const pickFromObject = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const color =
      obj.color ??
      obj.hex ??
      obj.value ??
      obj.valor ??
      obj.semaforo_color ??
      obj.semaforoColor ??
      null;
    const label =
      obj.label ?? obj.text ?? obj.nombre ?? obj.name ?? obj.semaforo_label ?? null;
    return {
      semaforo_color: color != null ? String(color).trim() || null : null,
      semaforo_label: label != null ? String(label).trim() || null : null,
    };
  };

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const values = parsed
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
      const semaforo_color =
        values.find((v) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) || null;
      const semaforo_label = values.find((v) => v !== semaforo_color) || null;
      return { semaforo_color, semaforo_label };
    }
    const fromObject = pickFromObject(parsed);
    if (fromObject) return fromObject;
  } catch {}

  if (text.includes("|")) {
    const values = text
      .split("|")
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);
    const semaforo_color =
      values.find((v) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) || null;
    const semaforo_label = values.find((v) => v !== semaforo_color) || null;
    if (semaforo_color || semaforo_label) {
      return { semaforo_color, semaforo_label };
    }
  }

  return { semaforo_color: text, semaforo_label: null };
}

async function buildDashboardInformesPoints({ ids, db }) {
  const informeIds = Array.isArray(ids)
    ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  if (!informeIds.length) return [];

  const [rPoints, summaryByInforme] = await Promise.all([
    db.query(
    `
    SELECT
      i.id_informe,
      i.id_proyecto,
      i.id_plantilla,
      i.titulo,
      i.fecha_creado,
      p.nombre AS nombre_plantilla,
      MAX(
        CASE
          WHEN UPPER(q.etiqueta) LIKE '%LAT%' OR UPPER(q.etiqueta) LIKE '%LATITUD%'
          THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
        END
      ) AS lat_raw,
      MAX(
        CASE
          WHEN UPPER(q.etiqueta) LIKE '%LON%'
            OR UPPER(q.etiqueta) LIKE '%LONG%'
            OR UPPER(q.etiqueta) LIKE '%LONGITUD%'
          THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
        END
      ) AS lng_raw,
      MAX(
        CASE
          WHEN UPPER(q.etiqueta) LIKE '%UBICAC%'
            OR UPPER(q.etiqueta) LIKE '%UBICACION%'
            OR UPPER(q.etiqueta) LIKE '%MAPA%'
            OR LOWER(TRIM(q.tipo)) IN ('mapa','coordenadas','coordenada')
          THEN r.valor_json::text
        END
      ) AS ubic_map_json_text,
      MAX(
        CASE
          WHEN UPPER(q.etiqueta) LIKE '%UBICAC%'
            OR UPPER(q.etiqueta) LIKE '%UBICACION%'
            OR UPPER(q.etiqueta) LIKE '%MAPA%'
            OR LOWER(TRIM(q.tipo)) IN ('mapa','coordenadas','coordenada')
          THEN r.valor_texto
        END
      ) AS ubic_map_text,
      MAX(
        CASE
          WHEN LOWER(TRIM(q.tipo)) = 'semaforo'
            OR UPPER(q.etiqueta) LIKE '%SEMAFORO%'
          THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
        END
      ) AS semaforo_raw
    FROM ema.informe i
    JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    LEFT JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
    LEFT JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
    WHERE i.id_informe = ANY($1::int[])
    GROUP BY i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado, p.nombre
    ORDER BY i.fecha_creado DESC, i.id_informe DESC
    `,
    [informeIds]
    ),
    buildDashboardInformesSummaryMap({ ids: informeIds, db }),
  ]);

  const points = [];
  for (const row of rPoints.rows || []) {
    const ubicRaw = row.ubic_map_json_text ?? row.ubic_map_text;
    const coords = parseInformeLatLng(row.lat_raw, row.lng_raw, ubicRaw);
    if (!coords) continue;

    const { semaforo_color, semaforo_label } = normalizeSemaforoRaw(row.semaforo_raw);
    const summary = summaryByInforme.get(Number(row.id_informe)) || null;
    points.push({
      id_informe: Number(row.id_informe),
      id_proyecto: Number(row.id_proyecto) || null,
      lat: Number(coords.lat),
      lng: Number(coords.lng),
      titulo: row.titulo || null,
      fecha_creado: row.fecha_creado || null,
      id_plantilla: Number(row.id_plantilla) || null,
      nombre_plantilla: row.nombre_plantilla || null,
      summary_field_id: summary?.summary_field_id || null,
      summary_label: summary?.summary_label || null,
      summary_text: summary?.summary_text || null,
      semaforo_color,
      semaforo_label,
    });
  }

  return points;
}

async function getDashboardGeoLinks(req, res) {
  try {
    const id_proyecto = toInt(req.body?.id_proyecto, null);
    if (!id_proyecto) {
      return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
    }

  const id_plantilla = toInt(req.body?.id_plantilla, null);
  const date_from = toDateISO(req.body?.date_from);
  const date_to = toDateISO(req.body?.date_to);
  const limit = clampLimit(req.body?.limit, 50, 200);

    const linkFields = req.body?.link_fields || {};
    const tramoFieldId = toInt(linkFields?.tramo_field_id, null);
    const progresivaFieldId = toInt(linkFields?.progresiva_field_id, null);
    const subtramoFieldId = toInt(linkFields?.subtramo_field_id, null);
    const linkIds = Array.from(
      new Set([tramoFieldId, progresivaFieldId, subtramoFieldId].filter(Boolean))
    );

    const universe = await getDashboardInformeUniverseIds({
      id_proyecto,
      id_plantilla,
      date_from,
      date_to,
      solo_cerrados: req.body?.solo_cerrados,
      filters: req.body?.filters,
      interactive_filters: req.body?.interactive_filters,
      search_text: req.body?.search_text,
      search_field_ids: req.body?.search_field_ids,
      date_field_id: req.body?.date_field_id,
      user: req.user,
      limit,
      maxLimit: 200,
    });

    if (universe.error) {
      return res.status(400).json({ ok: false, error: universe.error });
    }

    const ids = universe.ids || [];

    if (!ids.length) {
      const empty = await resolveDashboardGeoLinks({ sourceType: "informes" });
      return res.json({
        ok: true,
        items: [],
        informes_points: [],
        submapa: {
          tramos: [],
          progresivas: [],
          subtramos: [],
          selection_summary: {
            tramo_ids: [],
            progresiva_ids: [],
            subtramo_ids: [],
          },
        },
        meta: { count: 0, resolver_version: empty.meta?.resolver_version || "gva_tramos_v1" },
      });
    }

    const valuesByInforme = new Map();
    for (const id of ids) valuesByInforme.set(id, {});

    if (linkIds.length) {
      const rVals = await pool.query(
        `
        SELECT
          r.id_informe,
          r.id_pregunta,
          COALESCE(r.valor_texto, r.valor_json::text, r.valor_bool::text) AS valor
        FROM ema.informe_respuesta r
        WHERE r.id_informe = ANY($1::int[])
          AND r.id_pregunta = ANY($2::int[])
        `,
        [ids, linkIds]
      );

      for (const row of rVals.rows || []) {
        const idInf = Number(row.id_informe);
        const idPreg = Number(row.id_pregunta);
        if (!idInf || !idPreg) continue;
        const map = valuesByInforme.get(idInf);
        if (!map) continue;
        if (map[idPreg] === undefined) {
          map[idPreg] = row.valor;
        }
      }
    }

    const catalogs = {
      tramo: await buildTramoCatalog({ idProyecto: id_proyecto, db: pool }),
      progresiva: await buildProgresivaCatalog({ idProyecto: id_proyecto, db: pool }),
      subtramo: await buildSubtramoCatalog({ idProyecto: id_proyecto, db: pool }),
    };

    let firstMeta = null;
    const items = [];
    for (const id_informe of ids) {
      const sourceValues = valuesByInforme.get(id_informe) || {};
      const linkageRes = await resolveDashboardGeoLinks({
        sourceType: "informes",
        idProyecto: id_proyecto,
        linkFields,
        sourceValues,
        catalogs,
        db: pool,
      });
      if (!firstMeta) firstMeta = linkageRes.meta || null;

      const source_values_found = {
        tramo:
          tramoFieldId != null ? sourceValues[String(tramoFieldId)] ?? sourceValues[tramoFieldId] : null,
        progresiva:
          progresivaFieldId != null
            ? sourceValues[String(progresivaFieldId)] ?? sourceValues[progresivaFieldId]
            : null,
        subtramo:
          subtramoFieldId != null
            ? sourceValues[String(subtramoFieldId)] ?? sourceValues[subtramoFieldId]
            : null,
      };

      items.push({
        id_informe,
        linkage: linkageRes.linkage,
        meta_local: { source_values_found },
      });
    }

    const resolverVersion = firstMeta?.resolver_version || "gva_tramos_v1";
    const informes_points = await buildDashboardInformesPoints({
      ids,
      db: pool,
    });

    const submapa = await buildInformesSubmapPayload({
      idProyecto: id_proyecto,
      items,
      db: pool,
    });

    return res.json({
      ok: true,
      items,
      informes_points,
      submapa,
      meta: { count: items.length, resolver_version: resolverVersion },
    });
  } catch (err) {
    console.error("getDashboardGeoLinks:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
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
      WITH plantilla_dashboard_meta AS (
        SELECT
          s.id_plantilla,
          COUNT(q.id_pregunta)::int AS dashboard_indicators_count
        FROM ema.informe_seccion s
        JOIN ema.informe_pregunta q ON q.id_seccion = s.id_seccion
        WHERE LOWER(TRIM(COALESCE(q.tipo, ''))) IN (
          'select',
          'combo',
          'opcion',
          'opciones',
          'radio',
          'semaforo',
          'bool',
          'boolean',
          'si_no',
          'sino',
          'yesno'
        )
        GROUP BY s.id_plantilla
      )
      SELECT
        i.id_plantilla,
        COALESCE(p.nombre, 'Plantilla ' || i.id_plantilla) AS nombre,
        COUNT(*)::int AS total_informes,
        MAX(i.fecha_creado)::date AS ultimo,
        COALESCE(meta.dashboard_indicators_count, 0)::int AS dashboard_indicators_count
      FROM ema.informe i
      LEFT JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      LEFT JOIN plantilla_dashboard_meta meta ON meta.id_plantilla = i.id_plantilla
      WHERE i.id_proyecto = $1
      GROUP BY i.id_plantilla, p.nombre, meta.dashboard_indicators_count
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
  getDashboardGeoLinks,
};
