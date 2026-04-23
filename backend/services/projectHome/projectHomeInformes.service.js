"use strict";

const pool = require("../../db");

const { getInformesResumenBase } = require("../../controllers/informesDashboardResumen.controller");
const { getPlantillaDashboardMetadata } = require("../../controllers/informesDashboardMetadata.controller");
const { selectProjectHomeKpis } = require("./projectHomeKpiSelector.service");
const { getProjectHomeSelectedFields } = require("./projectHomeMetadata.service");
const { getProjectHomeFocusPlantilla } = require("./projectHomeFocus.service");
const { getProjectHomeExpedientesResumen } = require("./projectHomeExpedientes.service");
const { getProjectHomeQuejasResumen } = require("./projectHomeQuejas.service");
const { getItemsByProject } = require("./projectHomeItem.service");
const { getCatastroSummary } = require("../../gv/gv_summary.service");
const {
  getProjectHomeConfig,
  resolveProjectHomeConfigOverrides,
  resolveProjectHomeKpiOverridesFromSummaries,
  buildProjectHomeConfigResolutionTrace,
} = require("./projectHomeConfig.service");
const {
  DEFAULT_TEMPORAL_BEHAVIOR,
  normalizeTemporalBehavior,
  resolveTemporalBehavior,
} = require("./projectHomeTemporalBehavior.service");

function createJsonCaptureRes(resolve) {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolve({ statusCode: this.statusCode, payload });
      return payload;
    },
  };
  return res;
}

async function callController(controllerFn, req) {
  return await new Promise((resolve, reject) => {
    const res = createJsonCaptureRes(resolve);
    Promise.resolve(controllerFn(req, res)).catch(reject);
  });
}

async function getProjectGlobalTotal(id_proyecto) {
  const r = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM ema.informe
    WHERE id_proyecto = $1
  `,
    [id_proyecto]
  );
  return Number(r.rows?.[0]?.total) || 0;
}

function sumSummaryItems(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (acc, item) => acc + (Number(item?.count) || 0),
    0
  );
}

function withPlantillaUniverse(summary, selectedPlantillaTotal) {
  if (!summary || typeof summary !== "object") return summary;
  const total_universe = Math.max(0, Number(selectedPlantillaTotal) || 0);
  const existingResponded = Number(summary.responded_count);
  const existingNonEmpty = Number(summary.non_empty_count);
  const responded_count = Number.isFinite(existingResponded)
    ? Math.max(0, existingResponded)
    : Number.isFinite(existingNonEmpty)
      ? Math.max(0, existingNonEmpty)
      : sumSummaryItems(summary.items);
  const not_responded_count = Math.max(0, total_universe - responded_count);
  const response_rate = total_universe > 0 ? responded_count / total_universe : 0;

  return {
    ...summary,
    total_universe,
    responded_count,
    not_responded_count,
    response_rate,
  };
}

function withPlantillaUniverseList(summaries, selectedPlantillaTotal) {
  return (Array.isArray(summaries) ? summaries : []).map((summary) =>
    withPlantillaUniverse(summary, selectedPlantillaTotal)
  );
}

async function getPlantillaTemporalSources({ req, id_proyecto, id_plantilla }) {
  if (!id_plantilla) return null;
  const metaReq = {
    ...req,
    query: { id_proyecto },
    params: { ...(req.params || {}), idPlantilla: String(id_plantilla) },
  };
  const r = await callController(getPlantillaDashboardMetadata, metaReq);
  if (r.statusCode >= 400 || r.payload?.ok === false) return null;
  return Array.isArray(r.payload?.temporal_sources) ? r.payload.temporal_sources : null;
}

async function getInformesResumenRaw({
  req,
  id_proyecto,
  id_plantilla = null,
  date_field_id = "__created_at",
  time_grouping = "week",
  date_from = null,
  date_to = null,
  skip_temporal = true,
  config = null,
}) {
  // EXEC 2.2:
  // - reuse getInformesResumenBase
  // - force date field + grouping (optionally overridden by persisted config)
  // - ignore any incoming filters/config
  let selected_fields = [];
  if (id_plantilla) {
    try {
      selected_fields = await getProjectHomeSelectedFields({ req, id_proyecto, id_plantilla, config });
    } catch (_e) {
      selected_fields = [];
    }
  }

  const resumenReq = {
    ...req,
    query: {
      id_proyecto,
      id_plantilla,
      selected_fields,
      date_field_id,
      time_grouping,
      date_from,
      date_to,
      skip_temporal,
    },
  };

  const r = await callController(getInformesResumenBase, resumenReq);
  if (r.statusCode >= 400 || r.payload?.ok === false) {
    const err = new Error(r.payload?.error || "No se pudo obtener resumen de informes");
    err.status = r.statusCode >= 400 ? r.statusCode : 500;
    throw err;
  }

  return r.payload || {};
}

function parseDateOnly(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfMonth(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return lastDay.toISOString().slice(0, 10);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getLocalTodayString() {
  const today = new Date();
  const local = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;
}

function startOfWeek(dateStr) {
  const normalized = parseDateOnly(dateStr);
  if (!normalized) return null;
  const d = new Date(`${normalized}T00:00:00Z`);
  const weekday = d.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(normalized, offset);
}

function startOfMonth(dateStr) {
  const normalized = parseDateOnly(dateStr);
  if (!normalized) return null;
  const d = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return `${year}-${pad2(month + 1)}-01`;
}

function sumSeriesInRange(temporal, dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return 0;
  const series = Array.isArray(temporal?.series) ? temporal.series : [];
  let total = 0;
  for (const bucket of series) {
    const start = parseDateOnly(bucket?.bucket_start);
    if (!start) continue;
    if (start < dateFrom || start > dateTo) continue;
    total += Number(bucket?.count) || 0;
  }
  return total;
}

function buildRangeWindow(dateFrom, dateTo, temporal) {
  if (!dateFrom || !dateTo) return null;
  return {
    date_from: dateFrom,
    date_to: dateTo,
    period_total: sumSeriesInRange(temporal, dateFrom, dateTo),
  };
}

function resolveHistoricalWindow(temporal, grouping) {
  const series = Array.isArray(temporal?.series) ? temporal.series : [];
  if (!series.length) return null;
  const last = series[series.length - 1];
  const bucketStart = parseDateOnly(last?.bucket_start);
  if (!bucketStart) return null;
  const today = getLocalTodayString();
  const bucketInFuture = today && bucketStart > today;

  if (grouping === "week") {
    if (bucketInFuture) {
      return {
        date_from: addDays(today, -6),
        date_to: today,
        period_total: Number(last?.count) || 0,
      };
    }
    return {
      date_from: bucketStart,
      date_to: addDays(bucketStart, 6),
      period_total: Number(last?.count) || 0,
    };
  }

  if (grouping === "month") {
    if (bucketInFuture) {
      return {
        date_from: addDays(today, -29),
        date_to: today,
        period_total: Number(last?.count) || 0,
      };
    }
    return {
      date_from: bucketStart,
      date_to: endOfMonth(bucketStart),
      period_total: Number(last?.count) || 0,
    };
  }

  if (grouping === "day") {
    if (bucketInFuture) {
      return {
        date_from: today,
        date_to: today,
        period_total: Number(last?.count) || 0,
      };
    }
    return {
      date_from: bucketStart,
      date_to: bucketStart,
      period_total: Number(last?.count) || 0,
    };
  }

  return null;
}

function resolveActiveWindow(temporal, timeGrouping, behavior = DEFAULT_TEMPORAL_BEHAVIOR) {
  const grouping = String(timeGrouping || "").toLowerCase();
  const normalizedBehavior = normalizeTemporalBehavior(behavior) || DEFAULT_TEMPORAL_BEHAVIOR;

  if (normalizedBehavior === "historical") {
    return resolveHistoricalWindow(temporal, grouping);
  }

  const today = getLocalTodayString();
  if (!today) return null;

  if (normalizedBehavior === "current_period") {
    if (grouping === "week") {
      const start = startOfWeek(today);
      const end = start ? addDays(start, 6) : null;
      return buildRangeWindow(start, end, temporal);
    }
    if (grouping === "month") {
      const start = startOfMonth(today);
      const end = start ? endOfMonth(start) : null;
      return buildRangeWindow(start, end, temporal);
    }
    if (grouping === "day") {
      return buildRangeWindow(today, today, temporal);
    }
    return null;
  }

  if (normalizedBehavior === "rolling_future") {
    if (grouping === "week") {
      return buildRangeWindow(today, addDays(today, 6), temporal);
    }
    if (grouping === "month") {
      return buildRangeWindow(today, addDays(today, 29), temporal);
    }
    if (grouping === "day") {
      return buildRangeWindow(today, today, temporal);
    }
    return null;
  }

  if (normalizedBehavior === "rolling_past") {
    if (grouping === "week") {
      return buildRangeWindow(addDays(today, -6), today, temporal);
    }
    if (grouping === "month") {
      return buildRangeWindow(addDays(today, -29), today, temporal);
    }
    if (grouping === "day") {
      return buildRangeWindow(today, today, temporal);
    }
    return null;
  }

  return null;
}

async function getProjectHomeResumen({
  req,
  id_proyecto,
  id_plantilla = null,
  homeItem = null,
  skip_temporal = true,
}) {
  const can = (p) => {
    const roles = Array.isArray(req.user?.roleIds) ? req.user.roleIds : [];
    const isAdmin = Number(req.user?.tipo_usuario) === 1 || Number(req.user?.group_id) === 1 || roles.some(rid => Number(rid) === 1);
    if (isAdmin) return true;
    return (req.user?.perms || []).includes(p);
  };

  // 0) Metadata del proyecto
  const projectResult = await pool.query(
    "SELECT gid as id, nombre, estado FROM ema.proyectos WHERE gid = $1",
    [id_proyecto]
  );
  const project = projectResult.rows[0] || { id: id_proyecto, nombre: `Proyecto ${id_proyecto}`, estado: null };

  const hasInformes = can("informes.read");
  const hasExpedientes = can("expedientes.read");
  const hasQuejas = can("quejas_reclamos.read");
  const hasCatastro = can("expedientes.read") || can("catastro.read");

  // 1) Load persisted config (if any) for the exact combo requested.
  // We load this EARLIER to inform the metadata selection.
  const configRow = (hasInformes && !homeItem) 
    ? await getProjectHomeConfig({ req, id_proyecto, id_plantilla }) 
    : homeItem;

  const configuredPlantillaId = configRow?.id_plantilla || null;

  // 2) Global summary is computed over the whole project universe (Informes).
  // Config can inform focus/KPIs, but not the canonical universe total.
  const rawGlobalBase = hasInformes
    ? await getInformesResumenRaw({
        req,
        id_proyecto,
        id_plantilla: null,
        skip_temporal,
        config: null,
      })
    : { ok: true, general: {}, kpis: {}, geo: {}, temporal: {}, plantillas: [], field_summaries: [] };
  const total_global = hasInformes ? await getProjectGlobalTotal(id_proyecto) : 0;

  // 3) Determine plantilla focus (manual config > explicit param > auto focus)
  const autopPlantilla = getProjectHomeFocusPlantilla(rawGlobalBase);

  const requestedPlantillaId = id_plantilla || null;
  const focusPlantillaId =
    configuredPlantillaId || requestedPlantillaId || autopPlantilla?.id_plantilla || null;

  let rawForKpisBase = rawGlobalBase;
  if (hasInformes && focusPlantillaId) {
    rawForKpisBase = await getInformesResumenRaw({
      req,
      id_proyecto,
      id_plantilla: focusPlantillaId,
      skip_temporal: true,
      config: configRow,
    });
  }
  const selected_plantilla_total_records = hasInformes
    ? (Number(rawForKpisBase?.kpis?.total_informes) || 0)
    : 0;
  rawForKpisBase = {
    ...rawForKpisBase,
    field_summaries: withPlantillaUniverseList(
      rawForKpisBase.field_summaries,
      selected_plantilla_total_records
    ),
  };

  const focusSource = configuredPlantillaId ? "configured" : (requestedPlantillaId ? "requested" : "auto");
  const plantillaFocus = !configuredPlantillaId && !requestedPlantillaId ? autopPlantilla : null;

  const temporalSources = null;
  // skip_temporal already true by parameter/assignment
  const overrides = resolveProjectHomeConfigOverrides(configRow, {
    field_summaries: rawForKpisBase.field_summaries,
    temporal_sources: temporalSources,
  });

  // 4) Apply temporal overrides (if valid) to the global summary used for activity.
  const effectiveDateFieldId = skip_temporal
    ? null
    : overrides?.preferred_date_field_id || "__created_at";
  const effectiveTimeGrouping = skip_temporal
    ? null
    : overrides?.preferred_time_grouping || "week";
  const needsTemporalOverride = hasInformes 
    && !skip_temporal
    && (effectiveDateFieldId !== "__created_at" || effectiveTimeGrouping !== "week");
  const rawGlobal = needsTemporalOverride
    ? await getInformesResumenRaw({
        req,
        id_proyecto,
        id_plantilla: null,
        date_field_id: effectiveDateFieldId,
        time_grouping: effectiveTimeGrouping,
        skip_temporal,
      })
    : rawGlobalBase;

  const explicitBehavior =
    needsTemporalOverride &&
    configRow?.preferred_date_field_id &&
    String(configRow.preferred_date_field_id) === String(effectiveDateFieldId) &&
    effectiveDateFieldId !== "__created_at"
      ? "current_period"
      : null;

  const effectiveTemporalBehavior = resolveTemporalBehavior({
    fieldId: effectiveDateFieldId,
    temporalSources,
    explicitBehavior,
  });

  const rawForKpis = rawForKpisBase;
  const isPlantillaScopedResponse = Boolean(homeItem || requestedPlantillaId);
  const responseTotalRecords = isPlantillaScopedResponse
    ? selected_plantilla_total_records
    : total_global;
  const focusPlantillaInfo =
    Array.isArray(rawForKpis?.plantillas) && focusPlantillaId
      ? rawForKpis.plantillas.find((p) => Number(p.id_plantilla) === Number(focusPlantillaId))
      : null;

  const focus = (hasInformes && focusPlantillaId)
    ? {
        id_plantilla: focusPlantillaId,
        nombre:
          focusPlantillaInfo?.nombre || autopPlantilla?.nombre || `Plantilla ${focusPlantillaId}`,
        source: focusSource,
        is_configured: Boolean(configuredPlantillaId),
      }
    : null;

  const kpis = hasInformes ? (rawGlobal.kpis || {}) : {};
  const geo = hasInformes ? (rawGlobal.geo || {}) : {};
  const temporal = hasInformes ? (rawGlobal.temporal || {}) : {};

  const autoSelected = selectProjectHomeKpis(rawForKpis.field_summaries);
  const resolvedKpis = configRow
    ? resolveProjectHomeKpiOverridesFromSummaries(overrides || configRow, rawForKpis.field_summaries, autoSelected)
    : { primary: autoSelected.primary, secondary: autoSelected.secondary, has_any_kpi_override: false };

  let source_mode = "auto";
  if (configRow) {
    const appliedTemporalOverride = Boolean(
      overrides?.preferred_date_field_id || overrides?.preferred_time_grouping
    );
    const appliedKpiOverride = Boolean(resolvedKpis?.has_any_kpi_override);
    source_mode = appliedTemporalOverride || appliedKpiOverride ? "config" : "auto_fallback";
  }

  const expedientes = hasExpedientes ? await getProjectHomeExpedientesResumen({ req, id_proyecto }) : null;
  const quejas = hasQuejas ? await getProjectHomeQuejasResumen({ req, id_proyecto }) : null;
  
  let catastro_summary = null;
  if (hasCatastro) {
    catastro_summary = await getCatastroSummary(id_proyecto);
    if (!catastro_summary) {
      console.warn("[projectHome] catastro_summary vino null, forzando fallback");
      catastro_summary = {
        has_access: true,
        hero: {
          pendientes: 0,
          cobertura_pct: 0,
          geolocalizacion_pct: 0,
          insight: "Sin datos"
        },
        calidad: null,
        operativa: null,
        economico: null,
        _forced: true
      };
    }
  }

  const trace = buildProjectHomeConfigResolutionTrace(configRow, overrides, resolvedKpis);
  const fallbackPeriodTotal = Number(temporal.range_total) || 0;
  const lightweightPeriodTotal = total_global;

  const featuredRaw = hasInformes ? await getItemsByProject({ req, id_proyecto, include_legacy: true }) : [];
  const featured = featuredRaw.slice(0, 4);
  const featured_reports = await Promise.all(featured.map(async (item) => {
    let focusRaw = rawForKpisBase;
    if (Number(item.id_plantilla) !== Number(focusPlantillaId)) {
      focusRaw = await getInformesResumenRaw({
        req,
        id_proyecto,
        id_plantilla: item.id_plantilla,
        skip_temporal: true,
      });
    }
    const baseTotal = Number(focusRaw?.kpis?.total_informes) || 0;
    focusRaw = {
      ...focusRaw,
      field_summaries: withPlantillaUniverseList(focusRaw.field_summaries, baseTotal),
    };

    const autoSelected = selectProjectHomeKpis(focusRaw.field_summaries || []);
    const resolvedKpisItem = resolveProjectHomeKpiOverridesFromSummaries(
      item, 
      focusRaw.field_summaries || [], 
      autoSelected
    );
    
    // Process Primary
    let primary_val = baseTotal;
    let primary_label = "Registros totales";
    let primary_context = "Sin KPI configurado";
    
    if (resolvedKpisItem.primary && Array.isArray(resolvedKpisItem.primary.items) && resolvedKpisItem.primary.items.length > 0) {
      const itemsCopy = [...resolvedKpisItem.primary.items].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
      const top1 = itemsCopy[0];
      const topCount = Number(top1.count) || 0;
      
      let localBase = 0;
      for (const t of itemsCopy) localBase += (Number(t.count) || 0);
      
      primary_val = topCount;
      primary_label = String(top1.label || "Indefinido");
      
      const pct = baseTotal > 0 ? Math.round((topCount / baseTotal) * 100) : 0;
      primary_context = `Predomina en ${resolvedKpisItem.primary.etiqueta} (${pct}%)`;
    }

    // Process Secondary
    const secondary_lines = [];
    if (Array.isArray(resolvedKpisItem.secondary)) {
      for (const sec of resolvedKpisItem.secondary) {
        if (!sec || !Array.isArray(sec.items) || sec.items.length === 0) continue;
        const itemsCopy = [...sec.items].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
        const top1 = itemsCopy[0];
        const secPct = baseTotal > 0 ? Math.round((Number(top1.count) / baseTotal) * 100) : 0;

        secondary_lines.push({
          label: sec.etiqueta || "Secundario",
          val: Number(top1.count) || 0,
          pct: secPct,
          meta: `Predomina: ${top1.label || "Indefinido"}`
        });
        if (secondary_lines.length >= 2) break;
      }
    }

    let display_title = "Informe destacado";
    if (item.label && !/^(Informe|Reporte)\s*\d*$/i.test(String(item.label).trim())) {
      display_title = String(item.label).trim();
    } else if (item.plantilla_nombre) {
      display_title = String(item.plantilla_nombre).trim();
    }

    return {
      key: item.id_home_item === 'legacy-base' ? 'legacy' : String(item.id_home_item),
      source_kind: item.source_kind || 'item',
      id_home_item: item.id_home_item === 'legacy-base' ? null : Number(item.id_home_item),
      id_plantilla: Number(item.id_plantilla),
      label: item.label || item.plantilla_nombre || `Reporte ${item.id_plantilla}`,
      display_title,
      primary_val,
      primary_label,
      primary_context,
      secondary_lines,
      base_total: baseTotal
    };
  }));

  return {
    ok: true,
    source_mode,
    scope: { id_proyecto, id_plantilla },
    project,
    general: hasInformes ? {
      total_informes: responseTotalRecords,
      project_total_records: total_global,
      selected_plantilla_total_records,
      informes_con_geo: Number(geo.total_geo ?? kpis.informes_con_geo) || 0,
      informes_sin_geo: Number(geo.total_sin_geo ?? kpis.informes_sin_geo) || 0,
    } : null,
    activity: hasInformes ? {
      date_field_id: skip_temporal ? null : effectiveDateFieldId,
      date_field_label: skip_temporal
        ? null
        : effectiveDateFieldId === "__created_at"
          ? "Fecha de carga"
          : temporal.date_field_label,
      time_grouping: skip_temporal ? null : effectiveTimeGrouping,
      range_from: skip_temporal ? null : (temporal.absolute_min || null),
      range_to: skip_temporal ? null : (temporal.absolute_max || null),
      period_total: skip_temporal
        ? responseTotalRecords
        : (temporal.range_total || 0),
      mode: skip_temporal ? "lightweight" : "full",
    } : null,
    kpis: hasInformes ? {
      primary: resolvedKpis.primary,
      secondary: resolvedKpis.secondary,
    } : null,
    informes: hasInformes ? {
      plantilla_focus: plantillaFocus,
    } : null,
    expedientes,
    quejas,
    catastro_summary,
    featured_reports: hasInformes ? featured_reports : null,
    field_summaries: hasInformes && Array.isArray(rawForKpis.field_summaries) ? rawForKpis.field_summaries : [],
    temporal_sources: hasInformes && Array.isArray(temporalSources) ? temporalSources : [],
    plantillas: hasInformes && Array.isArray(rawGlobalBase.plantillas) ? rawGlobalBase.plantillas : [],
    focus: hasInformes ? focus : null,
    config_resolution: {
      has_config: trace.has_config,
      source_mode,
      applied_overrides: trace.applied_overrides,
      rejected_overrides: trace.rejected_overrides,
    },
  };

  console.log("[projectHome] catastro_summary:", JSON.stringify(finalPayload.catastro_summary, null, 2));
  return finalPayload;
}

module.exports = { getProjectHomeResumen };
