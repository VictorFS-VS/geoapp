"use strict";

const pool = require("../db");
const { buildInformeVisibleScope } = require("../helpers/informesDashboardScope");
const { computeInformeGeoSummary } = require("../helpers/informesGeoSummary");

function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "si", "s\u00ed", "y", "yes"].includes(s)) return true;
  if (["0", "false", "f", "no", "n"].includes(s)) return false;
  return fallback;
}

function toDateISO(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseBooleanValue(v) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "si", "s\u00ed", "y", "yes"].includes(s)) return true;
  if (["0", "false", "f", "no", "n"].includes(s)) return false;
  return null;
}

function parseDynamicFilters(raw) {
  if (raw === undefined || raw === null || raw === "") return { filters: [], error: null };

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { filters: [], error: "filters invalido" };
    }
  }

  if (!Array.isArray(parsed)) {
    return { filters: [], error: "filters debe ser un array" };
  }

  if (parsed.length > 50) {
    return { filters: [], error: "filters excede el limite" };
  }

  const supported = new Set(["select", "radio", "combo", "boolean", "text"]);
  const cleaned = [];

  for (const f of parsed) {
    if (!f || typeof f !== "object") continue;
    const id = toInt(f.id_pregunta, null);
    if (!id) continue;
    const tipo = String(f.tipo || "").trim().toLowerCase();
    if (!supported.has(tipo)) continue;
    const valueRaw = f.value;
    if (valueRaw === null || valueRaw === undefined || valueRaw === "") continue;

    if (tipo === "boolean") {
      const b = parseBooleanValue(valueRaw);
      if (b === null) continue;
      cleaned.push({ id_pregunta: id, tipo, value: b });
    } else {
      const val = String(valueRaw).trim();
      if (!val) continue;
      cleaned.push({ id_pregunta: id, tipo, value: val });
    }
  }

  return { filters: cleaned, error: null };
}

function buildDynamicFiltersSql(filters, startIndex = 1) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return { whereSql: "", params: [] };
  }

  const params = [];
  let idx = startIndex;
  let whereSql = "";

  for (const f of filters) {
    const idParam = idx++;
    params.push(f.id_pregunta);

    if (f.tipo === "select" || f.tipo === "radio" || f.tipo === "combo") {
      const valParam = idx++;
      params.push(f.value);
      whereSql += `
        AND EXISTS (
          SELECT 1
          FROM ema.informe_respuesta r_f
          WHERE r_f.id_informe = i.id_informe
            AND r_f.id_pregunta = $${idParam}
            AND LOWER(TRIM(COALESCE(r_f.valor_texto, r_f.valor_json::text, ''))) =
                LOWER(TRIM($${valParam}))
        )
      `;
      continue;
    }

    if (f.tipo === "boolean") {
      const valParam = idx++;
      params.push(Boolean(f.value));
      whereSql += `
        AND EXISTS (
          SELECT 1
          FROM ema.informe_respuesta r_f
          WHERE r_f.id_informe = i.id_informe
            AND r_f.id_pregunta = $${idParam}
            AND (
              r_f.valor_bool = $${valParam}
              OR (
                $${valParam} = true
                AND LOWER(TRIM(COALESCE(r_f.valor_texto, ''))) IN ('si','s\u00ed','true','1','s','y','yes')
              )
              OR (
                $${valParam} = false
                AND LOWER(TRIM(COALESCE(r_f.valor_texto, ''))) IN ('no','false','0','n')
              )
            )
        )
      `;
      continue;
    }

    if (f.tipo === "text") {
      const valParam = idx++;
      params.push(f.value);
      whereSql += `
        AND EXISTS (
          SELECT 1
          FROM ema.informe_respuesta r_f
          WHERE r_f.id_informe = i.id_informe
            AND r_f.id_pregunta = $${idParam}
            AND COALESCE(r_f.valor_texto, '') ILIKE '%' || $${valParam} || '%'
        )
      `;
    }
  }

  return { whereSql, params };
}

function parseSelectedFields(raw) {
  if (raw === undefined || raw === null || raw === "") return { ids: [], error: null };

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ids: [], error: "selected_fields invalido" };
    }
  }

  if (!Array.isArray(parsed)) {
    return { ids: [], error: "selected_fields debe ser un array" };
  }

  const ids = Array.from(
    new Set(
      parsed
        .map((v) => toInt(v, null))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  if (ids.length > 20) {
    return { ids: [], error: "selected_fields excede el limite" };
  }

  return { ids, error: null };
}

function buildDashboardFilters({ id_proyecto, id_plantilla, desde, hasta, solo_cerrados }) {
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

  if (solo_cerrados) {
    where += ` AND COALESCE(i.cerrado, false) = true`;
  }

  return { whereSql: where, params };
}

async function getInformesResumenBase(req, res) {
  const id_proyecto = toInt(req.query.id_proyecto, null);
  if (!id_proyecto) {
    return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
  }

  const id_plantilla = toInt(req.query.id_plantilla, null);
  const desde = toDateISO(req.query.desde);
  const hasta = toDateISO(req.query.hasta);
  const solo_cerrados = toBool(req.query.solo_cerrados, false);
  const filtersParsed = parseDynamicFilters(req.query.filters);
  if (filtersParsed.error) {
    return res.status(400).json({ ok: false, error: filtersParsed.error });
  }
  const dynamicFilters = filtersParsed.filters;
  const selectedFieldsParsed = parseSelectedFields(req.query.selected_fields);
  if (selectedFieldsParsed.error) {
    return res.status(400).json({ ok: false, error: selectedFieldsParsed.error });
  }
  const selectedFieldIds = selectedFieldsParsed.ids;

  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  try {
    const base = buildDashboardFilters({
      id_proyecto,
      id_plantilla,
      desde,
      hasta,
      solo_cerrados,
    });

    const scope = buildInformeVisibleScope({
      userId,
      isAdmin,
      plantillaId: null,
      startIndex: base.params.length + 1,
    });

    const dynamic = buildDynamicFiltersSql(
      dynamicFilters,
      base.params.length + scope.params.length + 1
    );

    const whereSql = `${base.whereSql} ${scope.whereSql} ${dynamic.whereSql}`;
    const params = base.params.concat(scope.params, dynamic.params);

    const joinSql = `
      FROM ema.informe i
      JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
       AND pu.id_usuario = $${scope.userParamIndex}
    `;

    const qCount = `
      SELECT
        COUNT(*)::int AS n_informes,
        MAX(i.fecha_creado) AS ultimo_informe
      ${joinSql}
      ${whereSql}
    `;

    const rCount = await pool.query(qCount, params);
    const n_informes = rCount.rows[0]?.n_informes || 0;
    const ultimo_informe = rCount.rows[0]?.ultimo_informe || null;

    const qPlantillasCount = `
      SELECT COUNT(DISTINCT i.id_plantilla)::int AS total_plantillas
      ${joinSql}
      ${whereSql}
    `;
    const rPlantillasCount = await pool.query(qPlantillasCount, params);
    const total_plantillas = rPlantillasCount.rows[0]?.total_plantillas || 0;

    const qPlantillas = `
      SELECT
        i.id_plantilla,
        COALESCE(p.nombre, 'Plantilla ' || i.id_plantilla) AS nombre,
        COUNT(*)::int AS total_informes,
        MAX(i.fecha_creado)::date AS ultimo
      ${joinSql}
      ${whereSql}
      GROUP BY i.id_plantilla, p.nombre
      ORDER BY total_informes DESC, ultimo DESC NULLS LAST, i.id_plantilla ASC
    `;
    const rPlantillas = await pool.query(qPlantillas, params);
    const plantillas = rPlantillas.rows || [];

    const qGeo = `
      SELECT
        i.id_informe,
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
        ) AS ubic_map_text
      ${joinSql}
      JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
      JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
      ${whereSql}
      GROUP BY i.id_informe
    `;

    const rGeo = await pool.query(qGeo, params);
    const geo = computeInformeGeoSummary(rGeo.rows || []);

    const porcentaje_con_geo =
      n_informes > 0 ? Number(((geo.total_geo / n_informes) * 100).toFixed(2)) : 0;

    let field_summaries = [];

    if (selectedFieldIds.length > 0) {
      const selectedFieldsParamIndex = params.length + 1;
      const summaryParams = params.concat([selectedFieldIds]);

      const filteredCte = `
        WITH filtered AS (
          SELECT i.id_informe
          ${joinSql}
          ${whereSql}
        )
      `;

      const qMeta = `
        SELECT q.id_pregunta, q.etiqueta, LOWER(TRIM(q.tipo)) AS tipo
        FROM ema.informe_pregunta q
        WHERE q.id_pregunta = ANY($1::int[])
      `;
      const rMeta = await pool.query(qMeta, [selectedFieldIds]);
      const metaMap = new Map();
      for (const row of rMeta.rows || []) {
        metaMap.set(Number(row.id_pregunta), {
          id_pregunta: Number(row.id_pregunta),
          etiqueta: row.etiqueta || `Pregunta ${row.id_pregunta}`,
          tipo: row.tipo || "",
        });
      }

      const qDistinct = `
        ${filteredCte}
        SELECT
          r.id_pregunta,
          COUNT(DISTINCT LOWER(TRIM(COALESCE(
            CASE
              WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Si' ELSE 'No' END
              ELSE NULL
            END,
            r.valor_texto,
            r.valor_json::text,
            ''
          ))))::int AS distinct_count
        FROM ema.informe_respuesta r
        JOIN filtered f ON f.id_informe = r.id_informe
        JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
        WHERE r.id_pregunta = ANY($${selectedFieldsParamIndex}::int[])
          AND LOWER(TRIM(q.tipo)) IN ('select','radio','combo','boolean','si_no','sino','bool','semaforo')
          AND TRIM(COALESCE(
            CASE
              WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Si' ELSE 'No' END
              ELSE NULL
            END,
            r.valor_texto,
            r.valor_json::text,
            ''
          )) <> ''
        GROUP BY r.id_pregunta
      `;
      const rDistinct = await pool.query(qDistinct, summaryParams);
      const distinctMap = new Map();
      for (const row of rDistinct.rows || []) {
        distinctMap.set(Number(row.id_pregunta), Number(row.distinct_count) || 0);
      }

      const qCounts = `
        ${filteredCte}
        SELECT
          r.id_pregunta,
          LOWER(TRIM(COALESCE(
            CASE
              WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Si' ELSE 'No' END
              ELSE NULL
            END,
            r.valor_texto,
            r.valor_json::text,
            ''
          ))) AS norm_val,
          MIN(TRIM(COALESCE(
            CASE
              WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Si' ELSE 'No' END
              ELSE NULL
            END,
            r.valor_texto,
            r.valor_json::text,
            ''
          ))) AS label,
          COUNT(*)::int AS count
        FROM ema.informe_respuesta r
        JOIN filtered f ON f.id_informe = r.id_informe
        JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
        WHERE r.id_pregunta = ANY($${selectedFieldsParamIndex}::int[])
          AND LOWER(TRIM(q.tipo)) IN ('select','radio','combo','boolean','si_no','sino','bool','semaforo')
          AND TRIM(COALESCE(
            CASE
              WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'Si' ELSE 'No' END
              ELSE NULL
            END,
            r.valor_texto,
            r.valor_json::text,
            ''
          )) <> ''
        GROUP BY r.id_pregunta, norm_val
      `;
      const rCounts = await pool.query(qCounts, summaryParams);
      const countsMap = new Map();
      for (const row of rCounts.rows || []) {
        const pid = Number(row.id_pregunta);
        if (!countsMap.has(pid)) countsMap.set(pid, []);
        countsMap.get(pid).push({
          label: row.label || row.norm_val || "",
          count: Number(row.count) || 0,
        });
      }

      const qText = `
        ${filteredCte}
        SELECT
          r.id_pregunta,
          COUNT(*) FILTER (
            WHERE TRIM(COALESCE(r.valor_texto, '')) <> ''
          )::int AS non_empty_count,
          ARRAY_AGG(DISTINCT LEFT(TRIM(r.valor_texto), 140)) FILTER (
            WHERE TRIM(COALESCE(r.valor_texto, '')) <> ''
          ) AS sample_values
        FROM ema.informe_respuesta r
        JOIN filtered f ON f.id_informe = r.id_informe
        JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
        WHERE r.id_pregunta = ANY($${selectedFieldsParamIndex}::int[])
          AND LOWER(TRIM(q.tipo)) IN ('text','texto','textarea','string')
        GROUP BY r.id_pregunta
      `;
      const rText = await pool.query(qText, summaryParams);
      const textMap = new Map();
      for (const row of rText.rows || []) {
        textMap.set(Number(row.id_pregunta), {
          non_empty_count: Number(row.non_empty_count) || 0,
          sample_values: Array.isArray(row.sample_values)
            ? row.sample_values.filter(Boolean).slice(0, 5)
            : [],
        });
      }

      field_summaries = selectedFieldIds.map((id) => {
        const meta = metaMap.get(id) || {
          id_pregunta: id,
          etiqueta: `Pregunta ${id}`,
          tipo: "",
        };
        const tipo = String(meta.tipo || "").toLowerCase();
        const isText = ["text", "texto", "textarea", "string"].includes(tipo);
        const isCat = [
          "select",
          "radio",
          "combo",
          "boolean",
          "si_no",
          "sino",
          "bool",
          "semaforo",
        ].includes(tipo);

        if (isText) {
          const t = textMap.get(id) || { non_empty_count: 0, sample_values: [] };
          return {
            id_pregunta: id,
            etiqueta: meta.etiqueta,
            tipo,
            distinct_count: 0,
            kpi_eligible: false,
            allowed_chart_types: [],
            summary_type: "text_basic",
            non_empty_count: t.non_empty_count,
            sample_values: t.sample_values,
          };
        }

        if (isCat) {
          const distinct = distinctMap.get(id) || 0;
          const items = (countsMap.get(id) || [])
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          const kpiEligible = distinct > 0 && distinct <= 10;
          return {
            id_pregunta: id,
            etiqueta: meta.etiqueta,
            tipo,
            distinct_count: distinct,
            kpi_eligible: kpiEligible,
            allowed_chart_types: kpiEligible ? ["bar", "donut", "list"] : [],
            summary_type: "counts",
            items,
          };
        }

        return {
          id_pregunta: id,
          etiqueta: meta.etiqueta,
          tipo,
          distinct_count: 0,
          kpi_eligible: false,
          allowed_chart_types: [],
          summary_type: "unsupported",
          items: [],
        };
      });
    }

    return res.json({
      ok: true,
      scope: {
        id_proyecto,
        id_plantilla,
        desde,
        hasta,
        solo_cerrados,
        n_informes,
      },
      kpis: {
        total_informes: n_informes,
        total_plantillas,
        ultimo_informe,
        informes_con_geo: geo.total_geo,
        informes_sin_geo: geo.total_sin_geo,
        porcentaje_con_geo,
      },
      plantillas,
      field_summaries,
      geo,
    });
  } catch (err) {
    console.error("getInformesResumenBase:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

module.exports = { getInformesResumenBase };
