"use strict";

const pool = require("../../db");

async function tableExists(fqn) {
  const r = await pool.query("SELECT to_regclass($1) AS oid", [fqn]);
  return !!r.rows?.[0]?.oid;
}

function toInt(v, fallback = null) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTimeGrouping(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "day" || s === "week" || s === "month") return s;
  return null;
}

function normalizeDateFieldId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
}

function normalizeIdList(v) {
  const arr = Array.isArray(v) ? v : [];
  const out = [];
  for (const item of arr) {
    const id = toInt(item, null);
    if (id && id > 0) out.push(id);
  }
  // stable unique
  return Array.from(new Set(out));
}

function isKpiSummaryCandidate(summary) {
  if (!summary) return false;
  if (summary.summary_type !== "counts") return false;
  const distinct = Number(summary.distinct_count) || 0;
  if (!(distinct > 1 && distinct <= 10)) return false;
  if (!Array.isArray(summary.items) || summary.items.length === 0) return false;
  const total = summary.items.reduce((acc, it) => acc + (Number(it?.count) || 0), 0);
  return total > 0;
}

/**
 * Reads the active Home config.
 * - If id_plantilla is provided, matches the exact (project, plantilla) combo.
 * - If id_plantilla is null, returns the most recent active config for the project.
 */
async function getProjectHomeConfig({ _req, id_proyecto, id_plantilla = null }) {
  if (!id_proyecto) return null;

  // Defensive: allow running without migration applied yet.
  if (!(await tableExists("ema.project_home_config"))) return null;

  if (id_plantilla !== null && id_plantilla !== undefined) {
    const q = `
      SELECT *
      FROM ema.project_home_config
      WHERE id_proyecto = $1
        AND id_plantilla = $2::int
        AND is_active = true
      ORDER BY updated_at DESC, created_at DESC, id_home_config DESC
      LIMIT 1
    `;
    const r = await pool.query(q, [Number(id_proyecto), Number(id_plantilla)]);
    return r.rows?.[0] || null;
  }

  const qAny = `
    SELECT *
    FROM ema.project_home_config
    WHERE id_proyecto = $1
      AND is_active = true
    ORDER BY updated_at DESC, created_at DESC, id_home_config DESC
    LIMIT 1
  `;
  const rAny = await pool.query(qAny, [Number(id_proyecto)]);
  return rAny.rows?.[0] || null;
}

/**
 * Normalizes/validates config values against what's available for the current context.
 *
 * Input:
 * - configRow: row from ema.project_home_config (or null)
 * - field_summaries: summaries available for KPI selection (single plantilla context)
 * - temporal_sources: optional metadata.temporal_sources for current plantilla context
 *
 * Output:
 * {
 *   kpi_primary_field_id,
 *   kpi_secondary_field_ids,
 *   preferred_date_field_id,
 *   preferred_time_grouping,
 *   has_valid_overrides
 * }
 * or null (if no configRow).
 */
function resolveProjectHomeConfigOverrides(configRow, { field_summaries, temporal_sources } = {}) {
  if (!configRow) return null;

  const summaries = Array.isArray(field_summaries) ? field_summaries : [];
  const byId = new Map();
  for (const s of summaries) {
    const id = toInt(s?.id_pregunta, null);
    if (!id) continue;
    byId.set(id, s);
  }

  // KPI primary
  let kpi_primary_field_id = toInt(configRow.kpi_primary_field_id, null);
  if (kpi_primary_field_id && !isKpiSummaryCandidate(byId.get(kpi_primary_field_id))) {
    kpi_primary_field_id = null;
  }

  // KPI secondary (max 2, valid and distinct)
  const rawSecondary = normalizeIdList(configRow.kpi_secondary_field_ids);
  let kpi_secondary_field_ids = rawSecondary
    .filter((id) => id !== kpi_primary_field_id)
    .filter((id) => isKpiSummaryCandidate(byId.get(id)))
    .slice(0, 2);

  // preferred date field
  let preferred_date_field_id = normalizeDateFieldId(configRow.preferred_date_field_id);
  if (preferred_date_field_id && preferred_date_field_id !== "__created_at") {
    const sources = Array.isArray(temporal_sources) ? temporal_sources : null;
    if (!sources) {
      preferred_date_field_id = null;
    } else {
      const match = sources.find((s) => String(s?.id) === preferred_date_field_id);
      // Valid for this iteration:
      // - must exist in metadata.temporal_sources
      // - if the shape provides dateable, require dateable === true
      if (!match) preferred_date_field_id = null;
      else if (Object.prototype.hasOwnProperty.call(match, "dateable") && match.dateable !== true) {
        preferred_date_field_id = null;
      }
    }
  }

  // preferred grouping
  const preferred_time_grouping = normalizeTimeGrouping(configRow.preferred_time_grouping);

  const has_valid_overrides = Boolean(
    kpi_primary_field_id ||
      (kpi_secondary_field_ids && kpi_secondary_field_ids.length) ||
      preferred_date_field_id ||
      preferred_time_grouping
  );

  return {
    kpi_primary_field_id,
    kpi_secondary_field_ids,
    preferred_date_field_id,
    preferred_time_grouping,
    has_valid_overrides,
  };
}

/**
 * Applies KPI overrides (if any) against REAL field_summaries availability.
 *
 * Input:
 * - configOrOverrides: config row OR normalized overrides object that has:
 *     kpi_primary_field_id, kpi_secondary_field_ids
 * - field_summaries: summaries from the effective resumen run (single plantilla context)
 * - autoKpis: optional { primary, secondary } from the auto selector
 *
 * Output:
 * {
 *   primary, secondary,
 *   applied_overrides: string[],
 *   rejected_overrides: string[],
 *   has_any_kpi_override: boolean
 * }
 */
function resolveProjectHomeKpiOverridesFromSummaries(
  configOrOverrides,
  field_summaries,
  autoKpis = null
) {
  const summaries = Array.isArray(field_summaries) ? field_summaries : [];
  const byId = new Map();
  for (const s of summaries) {
    const id = toInt(s?.id_pregunta, null);
    if (!id) continue;
    byId.set(id, s);
  }

  const applied_overrides = [];
  const rejected_overrides = [];

  const cfgPrimaryId = toInt(configOrOverrides?.kpi_primary_field_id, null);
  const cfgSecondaryIds = normalizeIdList(configOrOverrides?.kpi_secondary_field_ids).slice(0, 2);

  const resolved = {
    primary: autoKpis?.primary ?? null,
    secondary: Array.isArray(autoKpis?.secondary) ? autoKpis.secondary : [],
    applied_overrides,
    rejected_overrides,
    has_any_kpi_override: false,
  };

  // primary
  if (cfgPrimaryId) {
    const s = byId.get(cfgPrimaryId);
    if (isKpiSummaryCandidate(s)) {
      resolved.primary = s;
      resolved.has_any_kpi_override = true;
      applied_overrides.push("kpi_primary_field_id");
    } else {
      rejected_overrides.push("kpi_primary_field_id");
    }
  }

  // secondary
  if (cfgSecondaryIds.length) {
    const sec = [];
    for (const id of cfgSecondaryIds) {
      if (resolved.primary && toInt(resolved.primary?.id_pregunta, null) === id) continue;
      const s = byId.get(id);
      if (!isKpiSummaryCandidate(s)) continue;
      sec.push(s);
      if (sec.length >= 2) break;
    }

    if (sec.length) {
      resolved.secondary = sec;
      resolved.has_any_kpi_override = true;
      applied_overrides.push("kpi_secondary_field_ids");
    } else {
      rejected_overrides.push("kpi_secondary_field_ids");
    }
  }

  return resolved;
}

function hasNonEmptyJsonArray(v) {
  return Array.isArray(v) ? v.length > 0 : false;
}

/**
 * Minimal trace builder for Home config resolution.
 * Does not expose values, only which override keys were applied/rejected.
 *
 * Override keys:
 * - kpi_primary_field_id
 * - kpi_secondary_field_ids
 * - preferred_date_field_id
 * - preferred_time_grouping
 */
function buildProjectHomeConfigResolutionTrace(configRow, overrides, kpiResolution) {
  const applied = new Set();
  const rejected = new Set();

  if (!configRow) {
    return { has_config: false, applied_overrides: [], rejected_overrides: [] };
  }

  // temporal
  if (configRow.preferred_date_field_id) {
    if (overrides?.preferred_date_field_id) applied.add("preferred_date_field_id");
    else rejected.add("preferred_date_field_id");
  }
  if (configRow.preferred_time_grouping) {
    if (overrides?.preferred_time_grouping) applied.add("preferred_time_grouping");
    else rejected.add("preferred_time_grouping");
  }

  // kpis
  if (configRow.kpi_primary_field_id) {
    if (kpiResolution?.applied_overrides?.includes("kpi_primary_field_id")) applied.add("kpi_primary_field_id");
    else rejected.add("kpi_primary_field_id");
  }
  if (hasNonEmptyJsonArray(configRow.kpi_secondary_field_ids)) {
    if (kpiResolution?.applied_overrides?.includes("kpi_secondary_field_ids")) applied.add("kpi_secondary_field_ids");
    else rejected.add("kpi_secondary_field_ids");
  }

  return {
    has_config: true,
    applied_overrides: Array.from(applied),
    rejected_overrides: Array.from(rejected),
  };
}

module.exports = {
  getProjectHomeConfig,
  resolveProjectHomeConfigOverrides,
  resolveProjectHomeKpiOverridesFromSummaries,
  buildProjectHomeConfigResolutionTrace,
};
