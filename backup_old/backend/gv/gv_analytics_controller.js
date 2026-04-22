"use strict";

const pool = require("../db");
const { normalizeGranularity, getBucketLabel, getOrderedStageKeys, humanizeStageKey } = require("./analytics_helpers");

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function parseOptionalId(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeTipo(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "mejora" || v === "terreno") return v;
  return null;
}

function titleCaseWords(s) {
  return String(s || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();
}

exports.avanceTemporal = async (req, res) => {
  const proyectoId = Number.parseInt(String(req.query.proyectoId || ""), 10);
  if (!Number.isFinite(proyectoId) || proyectoId <= 0) {
    return res.status(400).json({ message: "proyectoId invalido" });
  }

  const fechaInicio = String(req.query.fechaInicio || "").trim();
  const fechaFin = String(req.query.fechaFin || "").trim();
  if (fechaInicio && !isYmd(fechaInicio)) {
    return res.status(400).json({ message: "fechaInicio invalida (YYYY-MM-DD)" });
  }
  if (fechaFin && !isYmd(fechaFin)) {
    return res.status(400).json({ message: "fechaFin invalida (YYYY-MM-DD)" });
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return res.status(400).json({ message: "fechaFin debe ser >= fechaInicio" });
  }

  const granularidad = normalizeGranularity(req.query.granularidad);
  const tramoId = parseOptionalId(req.query.tramoId);
  const subtramoId = parseOptionalId(req.query.subtramoId);
  const tipoFilter = req.query.tipo ? normalizeTipo(req.query.tipo) : null;
  if (req.query.tipo && !tipoFilter) {
    return res.status(400).json({ message: "tipo invalido (mejora|terreno)" });
  }

  const params = [proyectoId, fechaInicio || null, fechaFin || null, granularidad];
  let idx = 5;

  let whereBase = `WHERE id_proyecto = $1`;
  if (tramoId) {
    params.push(tramoId);
    whereBase += ` AND id_tramo = $${idx++}`;
  }
  if (subtramoId) {
    params.push(subtramoId);
    whereBase += ` AND id_sub_tramo = $${idx++}`;
  }
  if (fechaInicio) {
    whereBase += ` AND fecha_relevamiento >= $2`;
  }
  if (fechaFin) {
    whereBase += ` AND fecha_relevamiento <= $3`;
  }

  let whereTipo = `tipo IN ('mejora','terreno')`;
  if (tipoFilter) {
    params.push(tipoFilter);
    whereTipo = `tipo = $${idx++}`;
  }

  const sql = `
    WITH base AS (
      SELECT id_expediente, id_tramo, id_sub_tramo, fecha_relevamiento, carpeta_mejora, carpeta_terreno
      FROM ema.expedientes
      ${whereBase}
    ),
    counts AS (
      SELECT
        b.*,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_mejora) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS mejora_ok,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_terreno) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS terreno_ok
      FROM base b
    ),
    typed AS (
      SELECT
        *,
        CASE
          WHEN mejora_ok > 0 AND terreno_ok = 0 THEN 'mejora'
          WHEN terreno_ok > 0 AND mejora_ok = 0 THEN 'terreno'
          WHEN mejora_ok > 0 AND terreno_ok > 0 THEN 'legacy'
          ELSE 'sin_iniciar'
        END AS tipo
      FROM counts
    ),
    events AS (
      SELECT
        t.id_expediente,
        t.tipo,
        e.value->>'date' AS date_raw,
        lower(coalesce(e.value->>'ok','')) AS ok_raw,
        t.fecha_relevamiento AS fecha_relevamiento
      FROM typed t
      JOIN LATERAL jsonb_each(
        CASE WHEN t.tipo = 'mejora' THEN t.carpeta_mejora ELSE t.carpeta_terreno END
      ) e ON true
      WHERE ${whereTipo}
      UNION ALL
      SELECT
        t.id_expediente,
        t.tipo,
        NULL AS date_raw,
        'true' AS ok_raw,
        t.fecha_relevamiento AS fecha_relevamiento
      FROM typed t
      WHERE ${whereTipo}
        AND t.fecha_relevamiento IS NOT NULL
    ),
    parsed AS (
      SELECT
        id_expediente,
        tipo,
        CASE
          WHEN ok_raw IN ('true','1','t','yes','y')
           AND date_raw ~ '^\\d{4}-\\d{2}-\\d{2}T'
          THEN (date_raw)::timestamptz
          WHEN ok_raw IN ('true','1','t','yes','y')
           AND (date_raw IS NULL OR date_raw = '')
           AND fecha_relevamiento IS NOT NULL
          THEN fecha_relevamiento::timestamptz
          ELSE NULL
        END AS event_ts
      FROM events
    ),
    filtered AS (
      SELECT id_expediente, tipo, event_ts::date AS event_date
      FROM parsed
      WHERE event_ts IS NOT NULL
        AND event_ts::date BETWEEN $2::date AND $3::date
    ),
    bucketed AS (
      SELECT
        CASE
          WHEN $4 = 'dia' THEN to_char(event_date, 'YYYY-MM-DD')
          WHEN $4 = 'mes' THEN to_char(event_date, 'YYYY-MM')
          ELSE to_char(event_date, 'IYYY-"W"IW')
        END AS bucket_key,
        tipo,
        MIN(event_date) AS anchor_date,
        COUNT(DISTINCT id_expediente) AS c
      FROM filtered
      GROUP BY bucket_key, tipo
    )
    SELECT bucket_key, tipo, anchor_date, c
    FROM bucketed
    ORDER BY bucket_key ASC;
  `;

  const { rows } = await pool.query(sql, params);

  const bucketsMap = new Map();
  for (const r of rows) {
    const key = r.bucket_key;
    const bucket = bucketsMap.get(key) || {
      key,
      label: getBucketLabel(r.anchor_date, granularidad),
      mejora: 0,
      terreno: 0,
    };
    if (r.tipo === "mejora") bucket.mejora = Number(r.c) || 0;
    if (r.tipo === "terreno") bucket.terreno = Number(r.c) || 0;
    bucketsMap.set(key, bucket);
  }

  const buckets = Array.from(bucketsMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  res.json({
    range: {
      proyectoId,
      fechaInicio,
      fechaFin,
      granularidad,
      tramoId: tramoId || null,
      subtramoId: subtramoId || null,
      tipo: tipoFilter || null,
    },
    buckets,
  });
};

exports.detalleTemporal = async (req, res) => {
  const proyectoId = Number.parseInt(String(req.query.proyectoId || ""), 10);
  if (!Number.isFinite(proyectoId) || proyectoId <= 0) {
    return res.status(400).json({ message: "proyectoId invalido" });
  }

  const fechaInicio = String(req.query.fechaInicio || "").trim();
  const fechaFin = String(req.query.fechaFin || "").trim();
  if (fechaInicio && !isYmd(fechaInicio)) {
    return res.status(400).json({ message: "fechaInicio invalida (YYYY-MM-DD)" });
  }
  if (fechaFin && !isYmd(fechaFin)) {
    return res.status(400).json({ message: "fechaFin invalida (YYYY-MM-DD)" });
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return res.status(400).json({ message: "fechaFin debe ser >= fechaInicio" });
  }

  const granularidad = normalizeGranularity(req.query.granularidad);
  const tramoId = parseOptionalId(req.query.tramoId);
  const subtramoId = parseOptionalId(req.query.subtramoId);
  const categoria = normalizeTipo(req.query.categoria);
  if (!categoria) {
    return res.status(400).json({ message: "categoria invalida (mejora|terreno)" });
  }

  const modoRaw = String(req.query.modo || "").trim().toLowerCase();
  if (modoRaw !== "fases" && modoRaw !== "dbi") {
    return res.status(400).json({ message: "modo invalido (fases|dbi)" });
  }

  const params = [proyectoId, fechaInicio || null, fechaFin || null, granularidad, categoria];
  let idx = 6;

  let whereBase = `WHERE id_proyecto = $1`;
  if (tramoId) {
    params.push(tramoId);
    whereBase += ` AND id_tramo = $${idx++}`;
  }
  if (subtramoId) {
    params.push(subtramoId);
    whereBase += ` AND id_sub_tramo = $${idx++}`;
  }
  if (fechaInicio) {
    whereBase += ` AND fecha_relevamiento >= $2`;
  }
  if (fechaFin) {
    whereBase += ` AND fecha_relevamiento <= $3`;
  }

  const commonCte = `
    WITH base AS (
      SELECT id_expediente, id_tramo, id_sub_tramo, fecha_relevamiento, carpeta_mejora, carpeta_terreno, carpeta_dbi
      FROM ema.expedientes
      ${whereBase}
    ),
    counts AS (
      SELECT
        b.*,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_mejora) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS mejora_ok,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_terreno) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS terreno_ok
      FROM base b
    ),
    typed AS (
      SELECT
        *,
        CASE
          WHEN mejora_ok > 0 AND terreno_ok = 0 THEN 'mejora'
          WHEN terreno_ok > 0 AND mejora_ok = 0 THEN 'terreno'
          WHEN mejora_ok > 0 AND terreno_ok > 0 THEN 'legacy'
          ELSE 'sin_iniciar'
        END AS tipo
      FROM counts
    )
  `;

  let sql = "";
  if (modoRaw === "fases") {
    sql = `
      ${commonCte},
      events AS (
        SELECT
          t.id_expediente,
          t.tipo,
          e.key AS stage_key,
          e.value->>'date' AS date_raw,
          lower(coalesce(e.value->>'ok','')) AS ok_raw,
          t.fecha_relevamiento AS fecha_relevamiento
        FROM typed t
        JOIN LATERAL jsonb_each(
          CASE WHEN t.tipo = 'mejora' THEN t.carpeta_mejora ELSE t.carpeta_terreno END
        ) e ON true
        WHERE t.tipo = $5
        UNION ALL
        SELECT
          t.id_expediente,
          t.tipo,
          'relevamiento' AS stage_key,
          NULL AS date_raw,
          'true' AS ok_raw,
          t.fecha_relevamiento AS fecha_relevamiento
        FROM typed t
        WHERE t.tipo = $5
          AND t.fecha_relevamiento IS NOT NULL
      ),
      parsed AS (
        SELECT
          id_expediente,
          stage_key,
          CASE
            WHEN ok_raw IN ('true','1','t','yes','y')
             AND date_raw ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN (date_raw)::timestamptz
            WHEN ok_raw IN ('true','1','t','yes','y')
             AND (date_raw IS NULL OR date_raw = '')
             AND fecha_relevamiento IS NOT NULL
            THEN fecha_relevamiento::timestamptz
            ELSE NULL
          END AS event_ts
        FROM events
      ),
      filtered AS (
        SELECT id_expediente, stage_key, event_ts::date AS event_date
        FROM parsed
        WHERE event_ts IS NOT NULL
          AND event_ts::date BETWEEN $2::date AND $3::date
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN $4 = 'dia' THEN to_char(event_date, 'YYYY-MM-DD')
            WHEN $4 = 'mes' THEN to_char(event_date, 'YYYY-MM')
            ELSE to_char(event_date, 'IYYY-"W"IW')
          END AS bucket_key,
          stage_key,
          MIN(event_date) AS anchor_date,
          COUNT(*) AS c
        FROM filtered
        GROUP BY bucket_key, stage_key
      )
      SELECT bucket_key, stage_key, anchor_date, c
      FROM bucketed
      ORDER BY bucket_key ASC;
    `;
  } else {
    sql = `
      ${commonCte},
      events AS (
        SELECT
          t.id_expediente,
          t.tipo,
          lower(trim(coalesce(e->>'estado',''))) AS estado_key,
          e->>'fecha' AS date_raw
        FROM typed t
        JOIN LATERAL jsonb_array_elements(coalesce(t.carpeta_dbi->'estados','[]'::jsonb)) e ON true
        WHERE t.tipo = $5
      ),
      parsed AS (
        SELECT
          id_expediente,
          estado_key,
          CASE
            WHEN date_raw ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN (date_raw)::timestamptz
            ELSE NULL
          END AS event_ts
        FROM events
        WHERE estado_key <> ''
      ),
      filtered AS (
        SELECT id_expediente, estado_key, event_ts::date AS event_date
        FROM parsed
        WHERE event_ts IS NOT NULL
          AND event_ts::date BETWEEN $2::date AND $3::date
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN $4 = 'dia' THEN to_char(event_date, 'YYYY-MM-DD')
            WHEN $4 = 'mes' THEN to_char(event_date, 'YYYY-MM')
            ELSE to_char(event_date, 'IYYY-"W"IW')
          END AS bucket_key,
          estado_key,
          MIN(event_date) AS anchor_date,
          COUNT(*) AS c
        FROM filtered
        GROUP BY bucket_key, estado_key
      )
      SELECT bucket_key, estado_key, anchor_date, c
      FROM bucketed
      ORDER BY bucket_key ASC;
    `;
  }

  const { rows } = await pool.query(sql, params);

  const seriesMap = new Map();
  const bucketLabelCache = new Map();

  const allowedStages = new Set(getOrderedStageKeys(categoria));

  for (const r of rows) {
    const bucket = r.bucket_key;
    if (!bucketLabelCache.has(bucket)) {
      bucketLabelCache.set(bucket, getBucketLabel(r.anchor_date, granularidad));
    }

    if (modoRaw === "fases") {
      const key = String(r.stage_key || "").trim();
      if (!allowedStages.has(key)) continue;
      const label = humanizeStageKey(key);
      const series = seriesMap.get(key) || { key, label, data: [] };
      series.data.push({
        bucket,
        label: bucketLabelCache.get(bucket) || "",
        count: Number(r.c) || 0,
      });
      seriesMap.set(key, series);
    } else {
      const key = String(r.estado_key || "").trim();
      if (!key) continue;
      const label = titleCaseWords(key);
      const series = seriesMap.get(key) || { key, label, data: [] };
      series.data.push({
        bucket,
        label: bucketLabelCache.get(bucket) || "",
        count: Number(r.c) || 0,
      });
      seriesMap.set(key, series);
    }
  }

  const series = Array.from(seriesMap.values()).map((s) => ({
    ...s,
    data: s.data.sort((a, b) => a.bucket.localeCompare(b.bucket)),
  }));

  if (modoRaw === "fases") {
    const order = getOrderedStageKeys(categoria);
    series.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else {
    series.sort((a, b) => a.key.localeCompare(b.key));
  }

  res.json({
    range: {
      proyectoId,
      fechaInicio,
      fechaFin,
      granularidad,
      categoria,
      modo: modoRaw,
      tramoId: tramoId || null,
      subtramoId: subtramoId || null,
    },
    series,
  });
};

exports.economico = async (req, res) => {
  const proyectoId = Number.parseInt(String(req.query.proyectoId || ""), 10);
  if (!Number.isFinite(proyectoId) || proyectoId <= 0) {
    return res.status(400).json({ message: "proyectoId invalido" });
  }

  const tramoId = parseOptionalId(req.query.tramoId);
  const subtramoId = parseOptionalId(req.query.subtramoId);
  const fechaInicio = String(req.query.fechaInicio || "").trim();
  const fechaFin = String(req.query.fechaFin || "").trim();
  if (fechaInicio && !isYmd(fechaInicio)) {
    return res.status(400).json({ message: "fechaInicio invalida (YYYY-MM-DD)" });
  }
  if (fechaFin && !isYmd(fechaFin)) {
    return res.status(400).json({ message: "fechaFin invalida (YYYY-MM-DD)" });
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return res.status(400).json({ message: "fechaFin debe ser >= fechaInicio" });
  }

  const tipoRaw = String(req.query.tipo || "").trim().toLowerCase();
  const tipoFilter = tipoRaw ? tipoRaw : null;
  if (tipoFilter && !["mejora", "terreno", "legacy", "sin_iniciar"].includes(tipoFilter)) {
    return res.status(400).json({ message: "tipo invalido (mejora|terreno|legacy|sin_iniciar)" });
  }

  const params = [proyectoId];
  let idx = 2;

  let whereBase = `WHERE id_proyecto = $1`;
  if (tramoId) {
    params.push(tramoId);
    whereBase += ` AND id_tramo = $${idx++}`;
  }
  if (subtramoId) {
    params.push(subtramoId);
    whereBase += ` AND id_sub_tramo = $${idx++}`;
  }
  if (fechaInicio) {
    params.push(fechaInicio);
    whereBase += ` AND fecha_relevamiento >= $${idx++}`;
  }
  if (fechaFin) {
    params.push(fechaFin);
    whereBase += ` AND fecha_relevamiento <= $${idx++}`;
  }

  let tipoFilterClause = "";
  if (tipoFilter) {
    params.push(tipoFilter);
    tipoFilterClause = ` AND tipo = $${idx++}`;
  }

  const sql = `
    WITH base AS (
      SELECT id_expediente, id_tramo, id_sub_tramo, tramo, subtramo, parte_a, parte_b, premio_aplica,
             carpeta_mejora, carpeta_terreno
      FROM ema.expedientes
      ${whereBase}
    ),
    counts AS (
      SELECT
        b.*,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_mejora) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS mejora_ok,
        (SELECT COUNT(*) FROM jsonb_each(b.carpeta_terreno) e
         WHERE lower(coalesce(e.value->>'ok','')) IN ('true','1','t','yes','y')) AS terreno_ok
      FROM base b
    ),
    typed AS (
      SELECT
        *,
        CASE
          WHEN mejora_ok > 0 AND terreno_ok = 0 THEN 'mejora'
          WHEN terreno_ok > 0 AND mejora_ok = 0 THEN 'terreno'
          WHEN mejora_ok > 0 AND terreno_ok > 0 THEN 'legacy'
          ELSE 'sin_iniciar'
        END AS tipo
      FROM counts
    ),
    filtered AS (
      SELECT * FROM typed
      ${tipoFilterClause ? `WHERE 1=1 ${tipoFilterClause}` : ""}
    ),
    valued AS (
      SELECT
        id_expediente,
        id_tramo,
        id_sub_tramo,
        tramo,
        subtramo,
        tipo,
        COALESCE(parte_a, 0) AS parte_a_num,
        COALESCE(parte_b, 0) AS parte_b_num,
        COALESCE(premio_aplica, false) AS premio_aplica,
        (COALESCE(parte_a, 0) + COALESCE(parte_b, 0)) AS total_base,
        CASE
          WHEN COALESCE(premio_aplica, false) THEN (COALESCE(parte_a, 0) + COALESCE(parte_b, 0)) * 0.10
          ELSE 0
        END AS total_incentivo,
        CASE
          WHEN COALESCE(premio_aplica, false) THEN (COALESCE(parte_a, 0) + COALESCE(parte_b, 0)) * 1.10
          ELSE (COALESCE(parte_a, 0) + COALESCE(parte_b, 0))
        END AS total_final,
        CASE
          WHEN (COALESCE(parte_a, 0) + COALESCE(parte_b, 0)) > 0 THEN 1 ELSE 0
        END AS con_avaluo
      FROM filtered
    ),
    totales AS (
      SELECT
        COUNT(*)::int AS expedientes_total,
        COALESCE(SUM(con_avaluo), 0)::int AS expedientes_con_avaluo,
        COALESCE(SUM(parte_a_num), 0) AS total_parte_a,
        COALESCE(SUM(parte_b_num), 0) AS total_parte_b,
        COALESCE(SUM(total_base), 0) AS total_base,
        COALESCE(SUM(total_incentivo), 0) AS total_incentivo,
        COALESCE(SUM(total_final), 0) AS total_final
      FROM valued
    ),
    by_tramo AS (
      SELECT
        id_tramo,
        COALESCE(NULLIF(trim(tramo),''), CASE WHEN id_tramo IS NULL THEN 'Sin tramo' ELSE 'Tramo ' || id_tramo END) AS label,
        COUNT(*)::int AS expedientes_total,
        COALESCE(SUM(con_avaluo), 0)::int AS expedientes_con_avaluo,
        COALESCE(SUM(parte_a_num), 0) AS total_parte_a,
        COALESCE(SUM(parte_b_num), 0) AS total_parte_b,
        COALESCE(SUM(total_base), 0) AS total_base,
        COALESCE(SUM(total_incentivo), 0) AS total_incentivo,
        COALESCE(SUM(total_final), 0) AS total_final
      FROM valued
      GROUP BY id_tramo, label
    ),
    by_subtramo AS (
      SELECT
        id_sub_tramo,
        COALESCE(NULLIF(trim(subtramo),''), CASE WHEN id_sub_tramo IS NULL THEN 'Sin subtramo' ELSE 'Subtramo ' || id_sub_tramo END) AS label,
        COUNT(*)::int AS expedientes_total,
        COALESCE(SUM(con_avaluo), 0)::int AS expedientes_con_avaluo,
        COALESCE(SUM(parte_a_num), 0) AS total_parte_a,
        COALESCE(SUM(parte_b_num), 0) AS total_parte_b,
        COALESCE(SUM(total_base), 0) AS total_base,
        COALESCE(SUM(total_incentivo), 0) AS total_incentivo,
        COALESCE(SUM(total_final), 0) AS total_final
      FROM valued
      GROUP BY id_sub_tramo, label
    ),
    by_tipo AS (
      SELECT
        tipo AS key,
        CASE
          WHEN tipo = 'mejora' THEN 'Mejora'
          WHEN tipo = 'terreno' THEN 'Terreno'
          WHEN tipo = 'legacy' THEN 'Legacy'
          WHEN tipo = 'sin_iniciar' THEN 'Sin iniciar'
          ELSE tipo
        END AS label,
        COUNT(*)::int AS expedientes_total,
        COALESCE(SUM(con_avaluo), 0)::int AS expedientes_con_avaluo,
        COALESCE(SUM(parte_a_num), 0) AS total_parte_a,
        COALESCE(SUM(parte_b_num), 0) AS total_parte_b,
        COALESCE(SUM(total_base), 0) AS total_base,
        COALESCE(SUM(total_incentivo), 0) AS total_incentivo,
        COALESCE(SUM(total_final), 0) AS total_final
      FROM valued
      GROUP BY tipo
    )
    SELECT
      (SELECT row_to_json(t) FROM totales t) AS totales,
      (SELECT json_agg(t ORDER BY label) FROM by_tramo t) AS group_by_tramo,
      (SELECT json_agg(t ORDER BY label) FROM by_subtramo t) AS group_by_subtramo,
      (SELECT json_agg(t ORDER BY label) FROM by_tipo t) AS group_by_tipo;
  `;

  const { rows } = await pool.query(sql, params);
  const payload = rows?.[0] || {};

  const tot = payload.totales || {
    expedientes_total: 0,
    expedientes_con_avaluo: 0,
    total_parte_a: 0,
    total_parte_b: 0,
    total_base: 0,
    total_incentivo: 0,
    total_final: 0,
  };

  const totalParteA = Number(tot.total_parte_a) || 0;
  const totalParteB = Number(tot.total_parte_b) || 0;
  const totalBase = Number(tot.total_base) || 0;
  const totalIncentivo = Number(tot.total_incentivo) || 0;
  const totalFinal = Number(tot.total_final) || 0;
  const denom = Number(tot.expedientes_con_avaluo) || 0;

  res.json({
    filters: {
      proyectoId,
      tramoId: tramoId || null,
      subtramoId: subtramoId || null,
      tipo: tipoFilter || null,
    },
    totales: {
      expedientes_total: Number(tot.expedientes_total) || 0,
      expedientes_con_avaluo: Number(tot.expedientes_con_avaluo) || 0,
      total_parte_a: totalParteA,
      total_parte_b: totalParteB,
      total_base: totalBase,
      total_incentivo: totalIncentivo,
      total_final: totalFinal,
      promedio_base_por_expediente_con_avaluo: denom > 0 ? totalBase / denom : 0,
      promedio_final_por_expediente_con_avaluo: denom > 0 ? totalFinal / denom : 0,
    },
    groupByTramo: Array.isArray(payload.group_by_tramo) ? payload.group_by_tramo.map((r) => ({
      id_tramo: r.id_tramo ?? null,
      label: r.label,
      expedientes_total: Number(r.expedientes_total) || 0,
      expedientes_con_avaluo: Number(r.expedientes_con_avaluo) || 0,
      total_parte_a: Number(r.total_parte_a) || 0,
      total_parte_b: Number(r.total_parte_b) || 0,
      total_base: Number(r.total_base) || 0,
      total_incentivo: Number(r.total_incentivo) || 0,
      total_final: Number(r.total_final) || 0,
    })) : [],
    groupBySubtramo: Array.isArray(payload.group_by_subtramo) ? payload.group_by_subtramo.map((r) => ({
      id_sub_tramo: r.id_sub_tramo ?? null,
      label: r.label,
      expedientes_total: Number(r.expedientes_total) || 0,
      expedientes_con_avaluo: Number(r.expedientes_con_avaluo) || 0,
      total_parte_a: Number(r.total_parte_a) || 0,
      total_parte_b: Number(r.total_parte_b) || 0,
      total_base: Number(r.total_base) || 0,
      total_incentivo: Number(r.total_incentivo) || 0,
      total_final: Number(r.total_final) || 0,
    })) : [],
    groupByTipo: Array.isArray(payload.group_by_tipo) ? payload.group_by_tipo.map((r) => ({
      key: r.key,
      label: r.label,
      expedientes_total: Number(r.expedientes_total) || 0,
      expedientes_con_avaluo: Number(r.expedientes_con_avaluo) || 0,
      total_parte_a: Number(r.total_parte_a) || 0,
      total_parte_b: Number(r.total_parte_b) || 0,
      total_base: Number(r.total_base) || 0,
      total_incentivo: Number(r.total_incentivo) || 0,
      total_final: Number(r.total_final) || 0,
    })) : [],
  });
};
