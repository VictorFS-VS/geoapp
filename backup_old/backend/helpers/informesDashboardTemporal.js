"use strict";

function normalizeDateValue(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getInformesDateFieldExpr(alias = "r_d", isStrictDateKind = false) {
  const normalizedTextDate = `regexp_replace(split_part(TRIM(COALESCE(${alias}.valor_texto, '')), ' ', 1), '[/-]', '-', 'g')`;
  const firstPart = `split_part(${normalizedTextDate}, '-', 1)::int`;
  const secondPart = `split_part(${normalizedTextDate}, '-', 2)::int`;
  const year4 = `split_part(${normalizedTextDate}, '-', 3)::int`;
  const yyPart = `split_part(${normalizedTextDate}, '-', 3)::int`;
  const currentYear = `EXTRACT(YEAR FROM CURRENT_DATE)::int`;

  // resolvedMonth y resolvedDay: si el primer componente > 12 es el día (formato D/M/...), sino es el mes (M/D/...)
  const resolvedMonth = `
    CASE
      WHEN ${firstPart} > 12 THEN ${secondPart}
      ELSE ${firstPart}
    END
  `;
  const resolvedDay = `
    CASE
      WHEN ${firstPart} > 12 THEN ${firstPart}
      ELSE ${secondPart}
    END
  `;

  // Lógica de pivote dinámico: Se elige el siglo que resulte en el año más cercano a (current_year - 30)
  // Esto permite que '26' sea 2026 pero '49' sea 1949 (ventana hacia el pasado para fechas dudosas)
  const resolvedYear2 = `
    CASE
      WHEN (
        CASE
          WHEN ${yyPart} BETWEEN 0 AND 49 THEN 2000 + ${yyPart}
          ELSE 1900 + ${yyPart}
        END
      ) > ${currentYear}
        THEN (
          CASE
            WHEN ${yyPart} BETWEEN 0 AND 49 THEN 1900 + ${yyPart}
            ELSE 1800 + ${yyPart}
          END
        )
      ELSE (
        CASE
          WHEN ${yyPart} BETWEEN 0 AND 49 THEN 2000 + ${yyPart}
          ELSE 1900 + ${yyPart}
        END
      )
    END
  `;

  const excelLogic = isStrictDateKind
    ? `
      -- 3. Serial Excel en valor_texto (Solo si el campo es estrictamente de fecha)
      WHEN TRIM(COALESCE(${alias}.valor_texto, '')) ~ '^[0-9]+(\\.[0-9]+)?$' 
           AND CAST(NULLIF(TRIM(${alias}.valor_texto), '') AS DOUBLE PRECISION) >= 20000 
           AND CAST(NULLIF(TRIM(${alias}.valor_texto), '') AS DOUBLE PRECISION) <= 100000 
           THEN '1970-01-01'::date + (floor(CAST(NULLIF(TRIM(${alias}.valor_texto), '') AS DOUBLE PRECISION))::int - 25569)

      -- 4. Serial Excel en valor_json numérico (Solo si el campo es estrictamente de fecha)
      WHEN jsonb_typeof(${alias}.valor_json) = 'number'
           AND (${alias}.valor_json::text)::double precision >= 20000
           AND (${alias}.valor_json::text)::double precision <= 100000
           THEN '1970-01-01'::date + (floor((${alias}.valor_json::text)::double precision))::int - 25569
  `
    : "";

  return `(
    CASE
      -- 1. ISO (YYYY-MM-DD...) en valor_texto o valor_json
      WHEN COALESCE(${alias}.valor_texto, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(${alias}.valor_texto, 1, 10)::date
      WHEN COALESCE(${alias}.valor_json::text, '') ~ '^"\\d{4}-\\d{2}-\\d{2}' THEN substring(${alias}.valor_json::text, 2, 10)::date

      -- 2. Formato manual con separadores y año de 4 dígitos (Solo en valor_texto)
      WHEN TRIM(COALESCE(${alias}.valor_texto, '')) ~ '^\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}(\\s|T|$)' 
           AND ${resolvedMonth} BETWEEN 1 AND 12 AND ${resolvedDay} BETWEEN 1 AND 31 THEN
        make_date(
          ${year4},
          ${resolvedMonth},
          ${resolvedDay}
        )

      -- 2.1 Formato corto con separadores y año de 2 dígitos (Pivote Dinámico)
      WHEN TRIM(COALESCE(${alias}.valor_texto, '')) ~ '^\\d{1,2}[/-]\\d{1,2}[/-]\\d{2}(\\s|$)' 
           AND ${resolvedMonth} BETWEEN 1 AND 12 AND ${resolvedDay} BETWEEN 1 AND 31 THEN
        make_date(
          ${resolvedYear2},
          ${resolvedMonth},
          ${resolvedDay}
        )

      ${excelLogic}

      ELSE NULL
    END
  )`;
}

async function collectFieldTemporalStats(pool, baseQuery, baseParams, fieldIds) {
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
    return new Map();
  }
  const params = [...baseParams, fieldIds];
  const paramIndex = baseParams.length + 1;
  const dateExpr = getInformesDateFieldExpr("r", true);
  const query = `
WITH filtered AS (
${baseQuery}
)
SELECT
  r.id_pregunta,
  COUNT(*)::int AS valid_count,
  COUNT(DISTINCT ${dateExpr})::int AS distinct_valid_count,
  MIN(${dateExpr})::date AS absolute_min,
  MAX(${dateExpr})::date AS absolute_max
FROM filtered
JOIN ema.informe_respuesta r ON r.id_informe = filtered.id_informe
WHERE r.id_pregunta = ANY($${paramIndex}::int[])
  AND ${dateExpr} IS NOT NULL
GROUP BY r.id_pregunta
`;
  const result = await pool.query(query, params);
  const map = new Map();
  for (const row of result.rows || []) {
    map.set(Number(row.id_pregunta), {
      valid_count: Number(row.valid_count) || 0,
      distinct_valid_count: Number(row.distinct_valid_count) || 0,
      absolute_min: normalizeDateValue(row.absolute_min),
      absolute_max: normalizeDateValue(row.absolute_max),
    });
  }
  return map;
}

async function collectCreatedAtTemporalStats(pool, baseQuery, baseParams) {
  const query = `
WITH filtered AS (
${baseQuery}
)
SELECT
  COUNT(filtered.id_informe)::int AS valid_count,
  COUNT(DISTINCT filtered.created_date)::int AS distinct_valid_count,
  MIN(filtered.created_date)::date AS absolute_min,
  MAX(filtered.created_date)::date AS absolute_max
FROM filtered
WHERE filtered.created_date IS NOT NULL
`;
  const result = await pool.query(query, baseParams);
  const row = result.rows[0] || {};
  return {
    valid_count: Number(row.valid_count) || 0,
    distinct_valid_count: Number(row.distinct_valid_count) || 0,
    absolute_min: normalizeDateValue(row.absolute_min),
    absolute_max: normalizeDateValue(row.absolute_max),
  };
}

function buildTemporalCapabilities({ valid_count, distinct_valid_count, absolute_min, absolute_max }) {
  const validCount = Number(valid_count || 0);
  const timelineEnabled =
    validCount >= 2 && absolute_min && absolute_max && absolute_min < absolute_max;
  return {
    valid_count: validCount,
    distinct_valid_count: Number(distinct_valid_count || 0),
    absolute_min: absolute_min || null,
    absolute_max: absolute_max || null,
    filterable: validCount >= 1,
    timeline_enabled: Boolean(timelineEnabled),
    grouping_enabled: Boolean(timelineEnabled),
  };
}

module.exports = {
  getInformesDateFieldExpr,
  collectFieldTemporalStats,
  collectCreatedAtTemporalStats,
  buildTemporalCapabilities,
};
