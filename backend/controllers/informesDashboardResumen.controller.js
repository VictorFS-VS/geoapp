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

function normalizeLooseText(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function titleCaseLabel(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeSemaforoValue(raw) {
  const norm = normalizeLooseText(raw);
  if (!norm) {
    return { key: "gris", label: "Gris", color_key: "gris", sort_order: 5 };
  }
  if (["verde", "green"].includes(norm)) {
    return { key: "verde", label: "Verde", color_key: "verde", sort_order: 1 };
  }
  if (["amarillo", "yellow", "ambar", "amber"].includes(norm)) {
    return { key: "amarillo", label: "Amarillo", color_key: "amarillo", sort_order: 2 };
  }
  if (["naranja", "orange"].includes(norm)) {
    return { key: "naranja", label: "Naranja", color_key: "naranja", sort_order: 3 };
  }
  if (["rojo", "red"].includes(norm)) {
    return { key: "rojo", label: "Rojo", color_key: "rojo", sort_order: 4 };
  }
  if (["gris", "gray", "grey"].includes(norm)) {
    return { key: "gris", label: "Gris", color_key: "gris", sort_order: 5 };
  }
  return {
    key: norm,
    label: titleCaseLabel(String(raw || "").trim() || norm),
    color_key: "gris",
    sort_order: 99,
  };
}

function buildSemaforoSummaryItems(items) {
  const merged = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const meta = normalizeSemaforoValue(item?.label);
    const key = meta.key;
    if (!merged.has(key)) {
      merged.set(key, {
        key,
        label: meta.label,
        count: 0,
        color_key: meta.color_key,
        sort_order: meta.sort_order,
      });
    }
    merged.get(key).count += Number(item?.count) || 0;
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.label.localeCompare(b.label, "es");
    })
    .slice(0, 10);
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

function parseInteractiveFilters(raw) {
  if (raw === undefined || raw === null || raw === "") return { filters: [], error: null };

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { filters: [], error: "interactive_filters invalido" };
    }
  }

  if (!Array.isArray(parsed)) {
    return { filters: [], error: "interactive_filters debe ser un array" };
  }

  if (parsed.length > 50) {
    return { filters: [], error: "interactive_filters excede el limite" };
  }

  const supported = new Set([
    "select",
    "radio",
    "combo",
    "boolean",
    "si_no",
    "sino",
    "bool",
    "semaforo",
  ]);
  const cleaned = [];

  for (const f of parsed) {
    if (!f || typeof f !== "object") continue;
    const id = toInt(f.id_pregunta, null);
    if (!id) continue;
    const tipo = String(f.tipo || "").trim().toLowerCase();
    if (!supported.has(tipo)) continue;
    const rawValues = Array.isArray(f.values)
      ? f.values
      : f.value !== undefined
      ? [f.value]
      : [];
    if (!Array.isArray(rawValues) || rawValues.length === 0) continue;

    if (tipo === "boolean" || tipo === "si_no" || tipo === "sino" || tipo === "bool") {
      const boolSet = new Set();
      for (const raw of rawValues) {
        const b = parseBooleanValue(raw);
        if (b === null) continue;
        boolSet.add(Boolean(b));
      }
      const values = [...boolSet];
      if (!values.length) continue;
      cleaned.push({ id_pregunta: id, tipo, values });
      continue;
    }

    const valSet = new Set();
    for (const raw of rawValues) {
      if (raw === null || raw === undefined || raw === "") continue;
      const val = String(raw).trim();
      if (!val) continue;
      valSet.add(val);
    }
    const values = [...valSet];
    if (!values.length) continue;
    cleaned.push({ id_pregunta: id, tipo, values });
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

function buildInteractiveFiltersSql(filters, startIndex = 1) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return { whereSql: "", params: [] };
  }

  const params = [];
  let idx = startIndex;
  let whereSql = "";

  for (const f of filters) {
    const idParam = idx++;
    params.push(f.id_pregunta);

    if (["select", "radio", "combo", "semaforo"].includes(f.tipo)) {
      const values = Array.isArray(f.values) ? f.values : [];
      if (!values.length) continue;
      const valueParams = values.map((val) => {
        const p = idx++;
        params.push(val);
        return p;
      });
      const orSql = valueParams
        .map(
          (p) =>
            `LOWER(TRIM(COALESCE(r_i.valor_texto, r_i.valor_json::text, ''))) = LOWER(TRIM($${p}))`
        )
        .join(" OR ");
      whereSql += `
        AND EXISTS (
          SELECT 1
          FROM ema.informe_respuesta r_i
          WHERE r_i.id_informe = i.id_informe
            AND r_i.id_pregunta = $${idParam}
            AND (${orSql})
        )
      `;
      continue;
    }

    if (["boolean", "si_no", "sino", "bool"].includes(f.tipo)) {
      const values = Array.isArray(f.values) ? f.values : [];
      if (!values.length) continue;
      const boolVals = [...new Set(values.map((v) => Boolean(v)))];
      if (!boolVals.length) continue;
      const orSql = boolVals
        .map((val) => {
          const p = idx++;
          params.push(Boolean(val));
          return `
              (
                r_i.valor_bool = $${p}
                OR (
                  $${p} = true
                  AND LOWER(TRIM(COALESCE(r_i.valor_texto, ''))) IN ('si','s\u00ed','true','1','s','y','yes')
                )
                OR (
                  $${p} = false
                  AND LOWER(TRIM(COALESCE(r_i.valor_texto, ''))) IN ('no','false','0','n')
                )
              )
          `;
        })
        .join(" OR ");
      whereSql += `
        AND EXISTS (
          SELECT 1
          FROM ema.informe_respuesta r_i
          WHERE r_i.id_informe = i.id_informe
            AND r_i.id_pregunta = $${idParam}
            AND (${orSql})
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

function parseSearchFieldIds(raw) {
  if (raw === undefined || raw === null || raw === "") return { ids: [], error: null };

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ids: [], error: "search_field_ids invalido" };
    }
  }

  if (!Array.isArray(parsed)) {
    return { ids: [], error: "search_field_ids debe ser un array" };
  }

  const ids = Array.from(
    new Set(
      parsed
        .map((v) => toInt(v, null))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  if (ids.length > 50) {
    return { ids: [], error: "search_field_ids excede el limite" };
  }

  return { ids, error: null };
}

function parseTimeGrouping(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "week";
  if (["day", "week", "month"].includes(s)) return s;
  return "week";
}

function isDateableTipo(tipo) {
  const t = String(tipo || "").trim().toLowerCase();
  return ["fecha", "date", "datetime", "fecha_hora", "timestamp"].includes(t);
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

async function buildDashboardUniverseContext(options = {}) {
  const id_proyecto = toInt(options.id_proyecto, null);
  if (!id_proyecto) {
    return { error: "id_proyecto es requerido" };
  }

  const id_plantilla = toInt(options.id_plantilla, null);
  const date_from = toDateISO(options.date_from || options.desde || options.dateFrom);
  const date_to = toDateISO(options.date_to || options.hasta || options.dateTo);
  const solo_cerrados = toBool(options.solo_cerrados, false);

  const filtersParsed = parseDynamicFilters(options.filters);
  if (filtersParsed.error) return { error: filtersParsed.error };
  const dynamicFilters = filtersParsed.filters;

  const interactiveParsed = parseInteractiveFilters(options.interactive_filters);
  if (interactiveParsed.error) return { error: interactiveParsed.error };
  const interactiveFilters = interactiveParsed.filters;

  const searchFieldsParsed = parseSearchFieldIds(options.search_field_ids);
  if (searchFieldsParsed.error) return { error: searchFieldsParsed.error };
  const searchFieldIds = searchFieldsParsed.ids;

  const search_text = String(options.search_text || "").trim();
  const rawDateFieldId = String(options.date_field_id || "__created_at").trim();

  const { id: userId, tipo_usuario } = options.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  let dateFieldKind = "created_at";
  let dateFieldId = "__created_at";
  let dateFieldLabel = "Fecha de carga";

  if (rawDateFieldId && rawDateFieldId !== "__created_at") {
    const idDateField = toInt(rawDateFieldId, null);
    if (idDateField) {
      const qDate = `
        SELECT id_pregunta, etiqueta, tipo
        FROM ema.informe_pregunta
        WHERE id_pregunta = $1
        LIMIT 1
      `;
      const rDate = await pool.query(qDate, [idDateField]);
      const row = rDate.rows[0];
      if (row && isDateableTipo(row.tipo)) {
        dateFieldKind = "field";
        dateFieldId = String(idDateField);
        dateFieldLabel = row.etiqueta || `Pregunta ${idDateField}`;
      }
    }
  }

  const createdAtFrom = dateFieldKind === "created_at" ? date_from : null;
  const createdAtTo = dateFieldKind === "created_at" ? date_to : null;

  const base = buildDashboardFilters({
    id_proyecto,
    id_plantilla,
    desde: createdAtFrom,
    hasta: createdAtTo,
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
  const interactive = buildInteractiveFiltersSql(
    interactiveFilters,
    base.params.length + scope.params.length + dynamic.params.length + 1
  );

  let whereSql = `${base.whereSql} ${scope.whereSql} ${dynamic.whereSql} ${interactive.whereSql}`;
  const params = base.params.concat(scope.params, dynamic.params, interactive.params);
  let idx = params.length + 1;

  if (dateFieldKind === "field" && (date_from || date_to)) {
    const dateIdParam = idx++;
    params.push(toInt(dateFieldId, null));
    const dateFromParam = date_from ? idx++ : null;
    const dateToParam = date_to ? idx++ : null;
    if (date_from) params.push(date_from);
    if (date_to) params.push(date_to);

    const dateExprSql = `(
      CASE
        WHEN COALESCE(r_d.valor_texto, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(r_d.valor_texto, 1, 10)::date
        WHEN COALESCE(r_d.valor_json::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(r_d.valor_json::text, 1, 10)::date
        WHEN TRIM(COALESCE(r_d.valor_texto, '')) ~ '^[0-9]+(\\.[0-9]+)?$' 
             AND CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION) >= 20000 
             AND CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION) <= 100000 
             THEN '1970-01-01'::date + (floor(CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION))::int - 25569)
        ELSE NULL
      END
    )`;

    whereSql += `
      AND EXISTS (
        SELECT 1
        FROM ema.informe_respuesta r_d
        WHERE r_d.id_informe = i.id_informe
          AND r_d.id_pregunta = $${dateIdParam}
          AND ${dateExprSql} IS NOT NULL
          ${date_from ? `AND ${dateExprSql} >= $${dateFromParam}::date` : ""}
          ${date_to ? `AND ${dateExprSql} <= $${dateToParam}::date` : ""}
      )
    `;
  }

  if (search_text && searchFieldIds.length > 0) {
    const idsParam = idx++;
    const textParam = idx++;
    params.push(searchFieldIds);
    params.push(search_text);
    whereSql += `
      AND EXISTS (
        SELECT 1
        FROM ema.informe_respuesta r_s
        WHERE r_s.id_informe = i.id_informe
          AND r_s.id_pregunta = ANY($${idsParam}::int[])
          AND COALESCE(r_s.valor_texto, r_s.valor_json::text, '') ILIKE '%' || $${textParam} || '%'
      )
    `;
  }

  const joinSql = `
    FROM ema.informe i
    JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    LEFT JOIN ema.informe_plantilla_usuario pu
      ON pu.id_plantilla = p.id_plantilla
     AND pu.id_usuario = $${scope.userParamIndex}
  `;

  return {
    whereSql,
    params,
    joinSql,
    scope,
    dateFieldKind,
    dateFieldId,
    dateFieldLabel,
    searchFieldIds,
    search_text,
    dynamicFilters,
    interactiveFilters,
  };
}

async function getDashboardInformeUniverseIds(options = {}) {
  const ctx = await buildDashboardUniverseContext(options);
  if (ctx.error) return { error: ctx.error };

  const limit = toInt(options.limit, 50) || 50;
  const maxLimit = toInt(options.maxLimit, 200) || 200;
  const safeLimit = Math.min(Math.max(limit, 1), maxLimit);

  const params = ctx.params.slice();
  const limitParam = params.length + 1;
  params.push(safeLimit);

  const qIds = `
    SELECT i.id_informe
    ${ctx.joinSql}
    ${ctx.whereSql}
    ORDER BY i.fecha_creado DESC, i.id_informe DESC
    LIMIT $${limitParam}
  `;
  const rIds = await pool.query(qIds, params);
  const ids = rIds.rows.map((r) => Number(r.id_informe)).filter(Boolean);

  return { ids, ctx, limit: safeLimit };
}

async function getInformesResumenBase(req, res) {
  const id_proyecto = toInt(req.query.id_proyecto, null);
  if (!id_proyecto) {
    return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
  }

  const id_plantilla = toInt(req.query.id_plantilla, null);
  const date_from = toDateISO(req.query.date_from || req.query.desde);
  const date_to = toDateISO(req.query.date_to || req.query.hasta);
  const solo_cerrados = toBool(req.query.solo_cerrados, false);
  const selectedFieldsParsed = parseSelectedFields(req.query.selected_fields);
  if (selectedFieldsParsed.error) {
    return res.status(400).json({ ok: false, error: selectedFieldsParsed.error });
  }
  const selectedFieldIds = selectedFieldsParsed.ids;
  const time_grouping = parseTimeGrouping(req.query.time_grouping);

  try {
    const universe = await buildDashboardUniverseContext({
      id_proyecto,
      id_plantilla,
      date_from,
      date_to,
      solo_cerrados,
      filters: req.query.filters,
      interactive_filters: req.query.interactive_filters,
      search_text: req.query.search_text,
      search_field_ids: req.query.search_field_ids,
      date_field_id: req.query.date_field_id,
      user: req.user,
    });
    if (universe.error) {
      return res.status(400).json({ ok: false, error: universe.error });
    }

    const {
      whereSql,
      params,
      joinSql,
      dateFieldKind,
      dateFieldId,
      dateFieldLabel,
      searchFieldIds,
      search_text,
      dynamicFilters,
      interactiveFilters,
    } = universe;

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
          const rawItems = (countsMap.get(id) || []).sort((a, b) => b.count - a.count);
          const isSemaforo = tipo === "semaforo";
          const items = isSemaforo
            ? buildSemaforoSummaryItems(rawItems)
            : rawItems.slice(0, 10);
          const distinct = isSemaforo ? items.length : distinctMap.get(id) || 0;
          const kpiEligible = distinct > 0 && distinct <= 10;
          return {
            id_pregunta: id,
            etiqueta: meta.etiqueta,
            tipo,
            distinct_count: distinct,
            kpi_eligible: kpiEligible,
            allowed_chart_types: kpiEligible
              ? isSemaforo
                ? ["traffic", "donut", "list"]
                : ["bar", "donut", "list"]
              : [],
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

    let temporal = {
      enabled: true,
      date_field_id: dateFieldId,
      date_field_label: dateFieldLabel,
      time_grouping,
      series: [],
    };

    try {
      const filteredCte = `
        WITH filtered AS (
          SELECT i.id_informe
          ${joinSql}
          ${whereSql}
        )
      `;

      let temporalDateExpr = "i.fecha_creado::date";
      let temporalJoin = "";
      let temporalParams = params.slice();

      if (dateFieldKind === "field") {
        const temporalFieldParam = temporalParams.length + 1;
        temporalParams.push(toInt(dateFieldId, null));
        temporalJoin = `
          JOIN ema.informe_respuesta r_d
            ON r_d.id_informe = i.id_informe
           AND r_d.id_pregunta = $${temporalFieldParam}
        `;
        temporalDateExpr = `(
          CASE
            WHEN COALESCE(r_d.valor_texto, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(r_d.valor_texto, 1, 10)::date
            WHEN COALESCE(r_d.valor_json::text, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(r_d.valor_json::text, 1, 10)::date
            WHEN TRIM(COALESCE(r_d.valor_texto, '')) ~ '^[0-9]+(\\.[0-9]+)?$' 
                 AND CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION) >= 20000 
                 AND CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION) <= 100000 
                 THEN '1970-01-01'::date + (floor(CAST(NULLIF(TRIM(r_d.valor_texto), '') AS DOUBLE PRECISION))::int - 25569)
            ELSE NULL
          END
        )`;
      }

      const temporalBase = `
        ${filteredCte}
        SELECT
          i.id_informe,
          ${temporalDateExpr} AS date_value
        ${joinSql}
        ${temporalJoin}
        ${whereSql}
      `;

      let bucketStartExpr = "date_value::date";
      let labelExpr = "to_char(date_value::date, 'YYYY-MM-DD')";
      if (time_grouping === "month") {
        bucketStartExpr = "date_trunc('month', date_value)::date";
        labelExpr = "to_char(date_trunc('month', date_value), 'YYYY-MM')";
      } else if (time_grouping === "week") {
        bucketStartExpr = "date_trunc('week', date_value)::date";
        labelExpr = "to_char(date_value::date, 'IYYY \"W\"IW')";
      }

      const qTemporal = `
        WITH temporal_base AS (
          ${temporalBase}
        )
        SELECT
          ${bucketStartExpr} AS bucket_start,
          ${labelExpr} AS label,
          COUNT(*)::int AS count
        FROM temporal_base
        WHERE date_value IS NOT NULL
        GROUP BY bucket_start, label
        ORDER BY bucket_start ASC
      `;

      const rTemporal = await pool.query(qTemporal, temporalParams);
      const temporalRows = rTemporal.rows || [];
      const rangeTotal = temporalRows.reduce(
        (acc, row) => acc + (Number(row.count) || 0),
        0
      );
      temporal.range_total = rangeTotal;
      temporal.series = temporalRows.map((row) => {
        const count = Number(row.count) || 0;
        const percent =
          rangeTotal > 0 ? Number(((count / rangeTotal) * 100).toFixed(2)) : 0;
        return {
        key: row.label,
        label: row.label,
        bucket_start: row.bucket_start
          ? new Date(row.bucket_start).toISOString().slice(0, 10)
          : null,
          count,
          percent_of_range: percent,
        };
      });
    } catch (err) {
      temporal = {
        enabled: false,
        date_field_id: dateFieldId,
        date_field_label: dateFieldLabel,
        time_grouping,
        range_total: 0,
        series: [],
      };
    }

    return res.json({
      ok: true,
      scope: {
        id_proyecto,
        id_plantilla,
        date_from,
        date_to,
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
      temporal,
      applied_filters: {
        dynamic_filters: dynamicFilters,
        search_text: search_text || "",
        search_field_ids: searchFieldIds,
        date_from,
        date_to,
        date_field_id: dateFieldId,
        time_grouping,
        interactive_filters: interactiveFilters,
      },
    });
  } catch (err) {
    console.error("getInformesResumenBase:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

module.exports = { getInformesResumenBase, getDashboardInformeUniverseIds };
