import React, { useMemo, useState, useEffect, useRef } from "react";
import { Modal, Badge } from "react-bootstrap";
import { useInformesDashboard } from "./hooks/useInformesDashboard";
import { useGVATramos } from "../gva_tramos/hooks/useGVATramos";
import GVASubmapa from "../gva_tramos/GVASubmapa";
import { useSearchParams } from "react-router-dom";
import { useProjectContext } from "@/context/ProjectContext";
import { resolveProjectId } from "@/utils/projectResolver";

function traducirTipoCampo(tipo) {
  const t = String(tipo || "").trim().toLowerCase();
  if (["select", "combo", "radio", "opcion", "opciones"].includes(t)) return "Seleccion";
  if (["boolean", "bool", "si_no", "sino", "yesno"].includes(t)) return "Si / No";
  if (["multiselect", "multi", "checkbox", "check"].includes(t)) return "Seleccion multiple";
  if (["text", "texto", "textarea", "string"].includes(t)) return "Texto";
  if (["fecha", "date", "datetime", "fecha_hora", "timestamp"].includes(t)) return "Fecha";
  if (t === "semaforo") return "Semaforo";
  if (t.includes("coord") || t.includes("coordenada") || t.includes("mapa")) {
    return "Coordenadas";
  }
  if (
    t.includes("imagen") ||
    t.includes("foto") ||
    t.includes("archivo") ||
    t.includes("upload")
  ) {
    return "Imagen / Archivo";
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "-";
}

function traducirTipoGrafico(tipo) {
  if (tipo === "traffic") return "Semaforo";
  if (tipo === "bar") return "Lista";
  if (tipo === "donut") return "Dona";
  if (tipo === "list") return "Barra";
  return tipo;
}

export default function GVADashboardInformes() {
  const { currentProjectId, setCurrentProjectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const queryProjectId =
    searchParams.get("id_proyecto") || searchParams.get("idProyecto") || "";

  const {
    params,
    data,
    loading,
    error,
    plantillas,
    plantillasLoading,
    plantillasError,
    selectedPlantillaId,
    setSelectedPlantillaId,
    metadata,
    metadataLoading,
    metadataError,
    availableFields,
    availableSearchFields,
    availableTemporalSources,
    groupedAvailableFields,
    selectedFieldIds,
    selectedFilterFieldIds,
    searchFieldIds,
    dateFieldId,
    dynamicFilters,
    activeFilterFields,
    activeFiltersPayload,
    appliedPlantillaId,
    appliedPlantillaLabel,
    appliedSelectedFieldIds,
    appliedFiltersPayload,
    appliedFieldLabels,
    appliedFiltersSummary,
    temporal,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    appliedTimeGrouping,
    appliedSearchText,
    appliedSearchFieldIds,
    appliedInteractiveFilters,
    isInteractiveValueActive,
    fieldSummaries,
    fieldChartTypes,
    setFieldChartType,
    showPercentages,
    setShowPercentages,
    toggleFieldSelected,
    toggleFilterSelected,
    toggleSearchFieldSelected,
    setDateFieldId,
    setDynamicFilterValue,
    clearDynamicFilterValue,
    clearAllDynamicFilters,
    draftDateFrom,
    draftDateTo,
    draftTimeGrouping,
    draftSearchText,
    setDraftDateFrom,
    setDraftDateTo,
    setDraftTimeGrouping,
    setDraftSearchText,
    applyFilters,
    clearFilters,
    resetDraftFiltersFromApplied,
    clearAppliedDateFrom,
    clearAppliedDateTo,
    clearAppliedSearchText,
    resetAppliedTimeGrouping,
    addInteractiveFilter,
    clearInteractiveFilterField,
    clearInteractiveFilters,
    applyTemporalBucket,
    isTemporalBucketActive,
    applyTemporalRange,
    applyConfig,
    resetDraftFromApplied,
  } = useInformesDashboard();

  const paramProjectId = resolveProjectId({ params: params?.id_proyecto, query: null, context: null });
  const queryProjectIdNum = resolveProjectId({ params: null, query: queryProjectId, context: null });
  const contextProjectId = resolveProjectId({ params: null, query: null, context: currentProjectId });
  const resolvedProjectId = resolveProjectId({
    params: params?.id_proyecto,
    query: queryProjectId,
    context: currentProjectId,
  });

  useEffect(() => {
    if (paramProjectId && paramProjectId !== contextProjectId) {
      setCurrentProjectId(paramProjectId);
      return;
    }
    if (!paramProjectId && queryProjectIdNum && queryProjectIdNum !== contextProjectId) {
      setCurrentProjectId(queryProjectIdNum);
    }
  }, [paramProjectId, queryProjectIdNum, contextProjectId, setCurrentProjectId]);

  if (!resolvedProjectId) {
    return <div className="container py-3">Proyecto no definido</div>;
  }

  const timelineRangeRef = useRef({ from: "", to: "" });
  
  const parseDateYMD = (value) => {
    if (!value || typeof value !== "string") return null;
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    return new Date(Date.UTC(year, month - 1, day));
  };

  const formatDateShort = (date) => {
    if (!date) return "";
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const formatDateYMD = (date) => {
    if (!date) return "";
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    return `${yyyy}-${mm}-${dd}`;
  };

  const monthLabelEs = (date) => {
    if (!date) return "";
    const months = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  };

  const formatDateLabelLong = (iso) => {
    const d = parseDateYMD(iso);
    if (!d) return iso || "";
    const dd = d.getUTCDate();
    const mmFull = monthLabelEs(d);
    return `${dd} ${mmFull}`;
  };

  const addDaysUTC = (date, days) => {
    if (!date) return null;
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };

  const formatTemporalLabel = (row) => {
    const start = parseDateYMD(String(row?.bucket_start || ""));
    if (!start) return row?.label || "";
    if (appliedTimeGrouping === "month") {
      const months = [
        "Enero",
        "Febrero",
        "Marzo",
        "Abril",
        "Mayo",
        "Junio",
        "Julio",
        "Agosto",
        "Septiembre",
        "Octubre",
        "Noviembre",
        "Diciembre",
      ];
      return `${months[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    }
    if (appliedTimeGrouping === "week") {
      const end = addDaysUTC(start, 6);
      return `${formatDateYMD(start)} al ${formatDateYMD(end)}`;
    }
    return formatDateShort(start);
  };

  const getBucketRange = (bucket_start, grouping) => {
    const start = parseDateYMD(String(bucket_start || ""));
    if (!start) return { start: 0, end: 0 };
    const startTs = start.getTime();
    let endTs = startTs;
    const g = grouping || appliedTimeGrouping || "week";
    if (g === "month") {
      const endMonth = new Date(start.getTime());
      endMonth.setUTCMonth(endMonth.getUTCMonth() + 1);
      endTs = endMonth.getTime();
    } else if (g === "week") {
      endTs = startTs + 7 * 86400000;
    } else {
      endTs = startTs + 86400000;
    }
    return { start: startTs, end: endTs };
  };

  const [showConfig, setShowConfig] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showSubmapa, setShowSubmapa] = useState(false);
  const [selectedMapKpiId, setSelectedMapKpiId] = useState(null);
  const [selectedMapKpiLabel, setSelectedMapKpiLabel] = useState("");
  const [includeAllPoints, setIncludeAllPoints] = useState(false);
  const [resultsQuery, setResultsQuery] = useState("");
  const [filtersQuery, setFiltersQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [resultsOpen, setResultsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const idProyecto = params?.id_proyecto;
  const kpis = data?.kpis || {};
  const geo = data?.geo || {};
  const plantillasResumen = Array.isArray(data?.plantillas) ? data.plantillas : [];
  const temporalSeries = Array.isArray(temporal?.series_absolute) && temporal.series_absolute.length > 0 
    ? temporal.series_absolute 
    : Array.isArray(temporal?.series) ? temporal.series : [];
  const temporalRangeTotal = Number(temporal?.range_total || 0);
  const temporalLabel = temporal?.date_field_label || "Fecha de carga";
  const absoluteMin = temporal?.absolute_min;
  const absoluteMax = temporal?.absolute_max;

  const appliedTemporalSource = useMemo(() => {
    return availableTemporalSources.find((s) => String(s.id) === String(appliedDateFieldId)) || null;
  }, [availableTemporalSources, appliedDateFieldId]);

  const temporalFilterable = appliedTemporalSource ? !!appliedTemporalSource.filterable : true;
  const temporalTimelineEnabled = appliedTemporalSource ? !!appliedTemporalSource.timeline_enabled : false;
  const temporalGroupingEnabled = appliedTemporalSource ? !!appliedTemporalSource.grouping_enabled : temporalTimelineEnabled;
  const hasAbsoluteRange = !!(absoluteMin && absoluteMax);
  const absoluteRangeDegenerate = useMemo(() => {
    if (!absoluteMin || !absoluteMax) return false;
    const d1 = parseDateYMD(absoluteMin);
    const d2 = parseDateYMD(absoluteMax);
    if (!d1 || !d2) return false;
    return d1.getTime() === d2.getTime();
  }, [absoluteMin, absoluteMax]);
  const showTimeline = temporalFilterable && temporalTimelineEnabled && hasAbsoluteRange && !absoluteRangeDegenerate;

  const temporalState = useMemo(() => {
    if (!temporalFilterable) {
      return {
        status: "not_filterable",
        message: "La fuente temporal seleccionada no es usable para filtro temporal.",
      };
    }
    if (!temporalTimelineEnabled || absoluteRangeDegenerate) {
      return {
        status: "no_timeline",
        message:
          "La fuente temporal seleccionada tiene fechas validas, pero no suficiente variacion para evolucion temporal.",
      };
    }
    if (!hasAbsoluteRange) {
      return {
        status: "no_range",
        message: "No hay rango temporal absoluto disponible para esta fuente.",
      };
    }
    if (temporalSeries.length === 0) {
      return {
        status: "empty_range",
        message: "No hay datos temporales para el rango actual.",
      };
    }
    return { status: "ok", message: "" };
  }, [
    temporalFilterable,
    temporalTimelineEnabled,
    absoluteRangeDegenerate,
    hasAbsoluteRange,
    temporalSeries.length,
  ]);
  const temporalDiagnostic = useMemo(() => {
    const baseCount = Number(appliedTemporalSource?.valid_count || 0);
    const distinctCount = Number(appliedTemporalSource?.distinct_valid_count || 0);
    const distinctLabel = distinctCount === 1 ? "distinta" : "distintas";

    if (!temporalFilterable) {
      return baseCount > 0
        ? `${baseCount} fechas validas, ${distinctCount} ${distinctLabel}; fuente no usable para filtro temporal.`
        : "Sin fechas validas para esta fuente.";
    }
    if (!temporalTimelineEnabled) {
      return baseCount > 0
        ? `${baseCount} fechas validas, ${distinctCount} ${distinctLabel}; sirve para filtro pero no para evolucion temporal.`
        : "Sin fechas validas para esta fuente.";
    }
    if (absoluteRangeDegenerate) {
      return "Rango temporal degenerado (min = max); agrupacion no disponible.";
    }
    if (temporalSeries.length === 0) {
      return `${baseCount} fechas validas, ${distinctCount} ${distinctLabel}; sin datos para el rango actual.`;
    }
    return "";
  }, [
    appliedTemporalSource,
    temporalFilterable,
    temporalTimelineEnabled,
    absoluteRangeDegenerate,
    temporalSeries.length,
  ]);
  const canUseTemporalBuckets =
    temporalFilterable &&
    temporalTimelineEnabled &&
    temporalGroupingEnabled &&
    temporalSeries.length > 0 &&
    temporalState.status === "ok";

  const activeMapKpiId = Number(selectedMapKpiId);
  const activeMapKpiField = useMemo(() => {
    if (!activeMapKpiId) return null;
    return availableFields.find((f) => Number(f.id_pregunta) === activeMapKpiId);
  }, [availableFields, activeMapKpiId]);

  const activeMapKpiTipo = activeMapKpiField?.tipo || "";

  const { minTs, maxTs, dFromTs, dToTs } = useMemo(() => {
    if (!absoluteMin || !absoluteMax) return { minTs: 0, maxTs: 0, dFromTs: 0, dToTs: 0 };
    const min = parseDateYMD(absoluteMin).getTime();
    const max = parseDateYMD(absoluteMax).getTime();
    let f = parseDateYMD(draftDateFrom || absoluteMin)?.getTime() || min;
    let t = parseDateYMD(draftDateTo || absoluteMax)?.getTime() || max;
    f = Math.max(min, Math.min(max, f));
    t = Math.max(min, Math.min(max, t));
    if (f > t) {
      const tmp = f;
      f = t;
      t = tmp;
    }
    return { minTs: min, maxTs: max, dFromTs: f, dToTs: t };
  }, [absoluteMin, absoluteMax, draftDateFrom, draftDateTo]);

  useEffect(() => {
    timelineRangeRef.current = {
      from: String(draftDateFrom || ""),
      to: String(draftDateTo || ""),
    };
  }, [draftDateFrom, draftDateTo]);

  const linkFields = useMemo(() => {
    const raw =
      (data?.link_fields && typeof data.link_fields === "object" ? data.link_fields : null) ||
      (metadata?.link_fields && typeof metadata.link_fields === "object"
        ? metadata.link_fields
        : null) ||
      (metadata?.plantilla?.link_fields &&
      typeof metadata.plantilla.link_fields === "object"
        ? metadata.plantilla.link_fields
        : null);

    if (!raw) return null;

    const toId = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const normalized = {
      tramo_field_id: toId(raw.tramo_field_id),
      progresiva_field_id: toId(raw.progresiva_field_id),
      subtramo_field_id: toId(raw.subtramo_field_id),
    };

    const hasAny = Object.values(normalized).some(Boolean);
    return hasAny ? normalized : null;
  }, [data?.link_fields, metadata?.link_fields, metadata?.plantilla?.link_fields]);

  const canShowSubmapa = geo?.hasGeo === true;
  const hasLinkFields = !!linkFields;

  const geoLinksPayload = useMemo(() => {
    if (!canShowSubmapa) return null;
    return {
      id_proyecto: params?.id_proyecto,
      id_plantilla: appliedPlantillaId || params?.id_plantilla,
      solo_cerrados: params?.solo_cerrados,
      filters: appliedFiltersPayload,
      interactive_filters: appliedInteractiveFilters,
      search_text: appliedSearchText || undefined,
      search_field_ids: Array.from(appliedSearchFieldIds || []),
      date_field_id: appliedDateFieldId || undefined,
      date_from: appliedDateFrom || undefined,
      date_to: appliedDateTo || undefined,
      link_fields: linkFields || undefined,
      selected_map_field_id: selectedMapKpiId || undefined,
      include_all_points: includeAllPoints,
      limit: 5000,
    };
  }, [
    canShowSubmapa,
    params?.id_proyecto,
    params?.id_plantilla,
    params?.solo_cerrados,
    appliedPlantillaId,
    appliedFiltersPayload,
    appliedInteractiveFilters,
    appliedSearchText,
    appliedSearchFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    linkFields,
    selectedMapKpiId,
    includeAllPoints,
  ]);

  const geoLinksCacheKey = useMemo(() => {
    if (!geoLinksPayload) return "";
    const key = {
      id_proyecto: geoLinksPayload.id_proyecto || null,
      id_plantilla: geoLinksPayload.id_plantilla || null,
      solo_cerrados:
        geoLinksPayload.solo_cerrados === undefined
          ? null
          : geoLinksPayload.solo_cerrados,
      filters: Array.isArray(geoLinksPayload.filters) ? geoLinksPayload.filters : [],
      interactive_filters: Array.isArray(geoLinksPayload.interactive_filters)
        ? geoLinksPayload.interactive_filters
        : [],
      search_text: geoLinksPayload.search_text || "",
      search_field_ids: Array.isArray(geoLinksPayload.search_field_ids)
        ? [...geoLinksPayload.search_field_ids].sort((a, b) => a - b)
        : [],
      date_field_id: geoLinksPayload.date_field_id || "",
      date_from: geoLinksPayload.date_from || "",
      date_to: geoLinksPayload.date_to || "",
      link_fields: geoLinksPayload.link_fields || {},
      selected_map_field_id: geoLinksPayload.selected_map_field_id || null,
      include_all_points: geoLinksPayload.include_all_points || false,
    };
    try {
      return JSON.stringify(key);
    } catch {
      return "";
    }
  }, [geoLinksPayload]);

  useEffect(() => {
    setIncludeAllPoints(false);
  }, [
    appliedPlantillaId,
    appliedFiltersPayload,
    appliedInteractiveFilters,
    appliedSearchText,
    appliedSearchFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
  ]);

  const {
    data: geoLinksData,
    loading: geoLinksLoading,
    error: geoLinksError,
    refetch: refetchGeoLinks,
    tramosGeo,
    progresivasGeo,
    geometryLoading,
    geometryError,
  } = useGVATramos({
    enabled: showSubmapa && canShowSubmapa,
    payload: geoLinksPayload,
    cacheKey: geoLinksCacheKey,
  });

  const appliedFiltersCount = Array.isArray(appliedFiltersPayload)
    ? appliedFiltersPayload.length
    : 0;
  const appliedFieldsCount =
    appliedSelectedFieldIds && typeof appliedSelectedFieldIds.size === "number"
      ? appliedSelectedFieldIds.size
      : 0;

  const appliedSearchFieldsLabels = availableSearchFields
    .filter((f) => appliedSearchFieldIds?.has?.(f.id_pregunta))
    .map((f) => f.etiqueta);

  const appliedTemporalLabel =
    availableTemporalSources.find((s) => String(s.id) === String(appliedDateFieldId))
      ?.label || "Fecha de carga";

  const getInteractiveValuesForField = (id) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return [];
    const entry = (appliedInteractiveFilters || []).find(
      (f) => Number(f.id_pregunta) === pid
    );
    if (!entry) return [];
    const values = Array.isArray(entry.values)
      ? entry.values
      : entry.value !== undefined
      ? [entry.value]
      : [];
    return values
      .map((v) => String(v ?? "").trim())
      .filter((v) => v);
  };

  const groupingLabel =
    appliedTimeGrouping === "day"
      ? "Dia"
      : appliedTimeGrouping === "month"
      ? "Mes"
      : "Semana";
  const groupingLabelDisplay = temporalGroupingEnabled ? groupingLabel : "No disponible";


  if (!idProyecto) {
    return (
      <div style={{ padding: 20 }}>
        <h3>Dashboard Informes</h3>
        <div style={{ color: "#6b7280" }}>
          Falta <code>id_proyecto</code> en query param.
        </div>
      </div>
    );
  }

  const openConfig = () => {
    resetDraftFromApplied();
    setShowConfig(true);
  };

  const clearGroupResults = () => {
    [...selectedFieldIds].forEach((id) => toggleFieldSelected(id, false));
  };

  const clearGroupFilters = () => {
    [...selectedFilterFieldIds].forEach((id) => toggleFilterSelected(id, false));
  };

  const clearGroupSearch = () => {
    availableSearchFields
      .filter((f) => searchFieldIds.has(f.id_pregunta))
      .forEach((f) => toggleSearchFieldSelected(f.id_pregunta, false));
  };

  const cancelConfig = () => {
    resetDraftFromApplied();
    setShowConfig(false);
  };

  const applyAndClose = () => {
    applyConfig();
    setShowConfig(false);
  };

  const headerStyle = {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
  };

  const buttonStyle = {
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    borderRadius: 10,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: "#111827",
    color: "#ffffff",
    border: "1px solid #111827",
  };

  const panelStyle = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    background: "#ffffff",
  };

  const statChip = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
  };

  const subtleBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #dbe3ee",
    background: "#f8fafc",
    fontSize: 11,
    fontWeight: 700,
    color: "#475569",
  };

  const filterInputStyle = {
    width: "100%",
    border: "1px solid #dbe3ee",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 13,
    background: "#ffffff",
    outline: "none",
  };

  const renderFieldRow = (f, mode) => {
    const selected = selectedFieldIds.has(f.id_pregunta);
    const filterSelected = selectedFilterFieldIds.has(f.id_pregunta);
    const compactMode = mode === "none";

    return (
      <li
        key={f.id_pregunta}
        style={{
          marginBottom: compactMode ? 6 : 10,
          padding: compactMode ? "8px 10px" : "10px 12px",
          border: "1px solid #edf2f7",
          borderRadius: 12,
          background: compactMode ? "#fafafa" : "#fcfdff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, color: "#111827" }}>{f.etiqueta}</div>
            <div
              style={{
                marginTop: 5,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span style={subtleBadgeStyle}>{traducirTipoCampo(f.tipo)}</span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{f.seccion}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <Badge
              bg={mode === "results" ? "success" : mode === "filter" ? "warning" : "secondary"}
            >
              {f.availability_label || "Sin clasificacion"}
            </Badge>
          </div>
        </div>

        {mode === "results" ? (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => toggleFieldSelected(f.id_pregunta, e.target.checked)}
              />{" "}
              Mostrar
            </label>
            <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
              Al mostrarlo, queda habilitado para filtro interactivo desde el grafico.
            </span>
          </div>
        ) : null}

        {mode === "filter" ? (
          <label style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={filterSelected}
              onChange={(e) => toggleFilterSelected(f.id_pregunta, e.target.checked)}
            />{" "}
            Usar como filtro
          </label>
        ) : null}

        {mode === "search" ? (
          <label style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={searchFieldIds.has(f.id_pregunta)}
              onChange={(e) => toggleSearchFieldSelected(f.id_pregunta, e.target.checked)}
            />{" "}
            Buscar aqui
          </label>
        ) : null}
      </li>
    );
  };

  const renderDynamicFilterControl = (f) => {
    const tipo = String(f.tipo || "").toLowerCase();
    const key = String(f.id_pregunta);
    const value = dynamicFilters[key] ?? "";
    const opciones = Array.isArray(f.opciones) ? f.opciones : [];
    const isSelect = ["select", "radio", "combo"].includes(tipo) || opciones.length > 0;
    const isBool = ["bool", "boolean", "si_no", "sino", "yesno"].includes(tipo);

    return (
      <div
        key={f.id_pregunta}
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#ffffff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{f.etiqueta}</div>
            <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={subtleBadgeStyle}>{traducirTipoCampo(f.tipo)}</span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{f.seccion}</span>
            </div>
          </div>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => clearDynamicFilterValue(f.id_pregunta)}
            disabled={value === "" || value === null || value === undefined}
          >
            Limpiar
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          {isSelect ? (
            <select
              value={value}
              onChange={(e) => setDynamicFilterValue(f.id_pregunta, e.target.value)}
              style={filterInputStyle}
            >
              <option value="">Seleccionar...</option>
              {opciones.map((opt, idx) => (
                <option key={`${f.id_pregunta}-${idx}`} value={opt}>
                  {String(opt)}
                </option>
              ))}
            </select>
          ) : isBool ? (
            <select
              value={value}
              onChange={(e) => setDynamicFilterValue(f.id_pregunta, e.target.value)}
              style={filterInputStyle}
            >
              <option value="">Seleccionar...</option>
              <option value="true">Si</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => setDynamicFilterValue(f.id_pregunta, e.target.value)}
              placeholder="Ingresar valor"
              style={filterInputStyle}
            />
          )}
        </div>
      </div>
    );
  };

  const getSemaforoColor = (colorKey, itemHex) => {
    if (itemHex) return itemHex;
    const key = String(colorKey || "").trim().toLowerCase();
    if (key === "verde") return "#16a34a";
    if (key === "amarillo") return "#eab308";
    if (key === "naranja") return "#f97316";
    if (key === "rojo") return "#dc2626";
    return "#94a3b8";
  };

  const getBarItemColor = (index, itemHex) => {
    if (itemHex) return itemHex;
    const colors = [
      "#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", 
      "#8b5cf6", "#fb923c", "#3b82f6", "#22c55e", "#64748b"
    ];
    return colors[index % colors.length];
  };

  const getActiveTone = (baseColor, active, hasActiveSelection) => {
    if (active) {
      const dark = {
        "#111827": "#020617",
        "#2563eb": "#1d4ed8",
        "#16a34a": "#15803d",
        "#f97316": "#ea580c",
        "#a855f7": "#9333ea",
        "#16a34a_sem": "#15803d",
      };
      return dark[baseColor] || baseColor;
    }
    if (hasActiveSelection) {
      return `${baseColor}99`;
    }
    return baseColor;
  };

  const polarToCartesian = (cx, cy, radius, angleInDegrees) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians),
    };
  };

  const describeArc = (cx, cy, radius, startAngle, endAngle) => {
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
  };

  const getNiceTickStep = (maxValue, targetIntervals = 4) => {
    if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
    const rawStep = maxValue / Math.max(1, targetIntervals);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const residual = rawStep / magnitude;

    if (residual <= 1) return magnitude;
    if (residual <= 2) return 2 * magnitude;
    if (residual <= 5) return 5 * magnitude;
    return 10 * magnitude;
  };

  const buildNiceTicks = (maxValue, targetIntervals = 4) => {
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      return { chartMax: 1, ticks: [0, 1] };
    }

    const step = getNiceTickStep(maxValue, targetIntervals);
    const chartMax = Math.max(step, Math.ceil(maxValue / step) * step);
    const ticks = [];

    for (let value = 0; value <= chartMax; value += step) {
      ticks.push(value);
    }

    if (ticks[ticks.length - 1] !== chartMax) {
      ticks.push(chartMax);
    }

    return { chartMax, ticks };
  };

  const renderIndicatorMeta = ({
    label,
    count,
    total,
    showPercentages,
    align = "left",
  }) => {
    const safeCount = Number(count || 0);
    const safeTotal = Number(total || 0);
    const pct = safeTotal > 0 ? ((safeCount / safeTotal) * 100).toFixed(1) : "0.0";

    return (
      <div style={{ minWidth: 0, textAlign: align }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#111827",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={label}
        >
          {label}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: "#6b7280" }}>
          {safeCount} informes
        </div>
        {showPercentages ? (
          <div style={{ fontSize: 11, color: "#6b7280" }}>{pct}% del universo</div>
        ) : null}
      </div>
    );
  };

  const buildSummaryRenderItems = (items, totalUniverse) => {
    const realItems = Array.isArray(items) ? items : [];
    const sumRealCounts = realItems.reduce(
      (acc, it) => acc + Math.max(0, Number(it?.count || 0)),
      0
    );
    const missingCount =
      Number(totalUniverse || 0) > 0
        ? Math.max(0, Number(totalUniverse || 0) - sumRealCounts)
        : 0;

    return missingCount > 0
      ? [
          ...realItems,
          {
            label: "Sin responder",
            count: missingCount,
            isSynthetic: true,
          },
        ]
      : realItems;
  };

  const ListAsBars = ({
    fs,
    items,
    kpis,
    totalUniverse,
    addInteractiveFilter,
    isInteractiveValueActive,
    hasActiveInteractiveSelection,
    getBarItemColor,
    getActiveTone,
  }) => {
    const effectiveUniverse = Number(totalUniverse ?? (kpis?.total_informes || 0));
    const renderItems = buildSummaryRenderItems(items, effectiveUniverse);
    const itemCount = Math.max(renderItems.length, 1);
    const columnGap = itemCount > 8 ? 6 : 10;
    const maxCount = renderItems.reduce(
      (acc, it) => Math.max(acc, Number(it?.count || 0)),
      0
    );
    const { chartMax, ticks } = buildNiceTicks(maxCount, 4);
    const axisLabelWidth = 30;

    return (
      <div
        style={{
          position: "relative",
          minHeight: 190,
          paddingTop: 8,
          paddingLeft: axisLabelWidth,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: `8px 0 54px ${axisLabelWidth}px`,
            pointerEvents: "none",
            display: "grid",
            gridTemplateRows: `repeat(${ticks.length}, 1fr)`,
          }}
        >
          {ticks
            .slice()
            .reverse()
            .map((tick) => (
              <div
                key={`grid-${tick}`}
                style={{
                  position: "relative",
                  borderTop: "1px solid rgba(148,163,184,0.25)",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: -8,
                    left: -axisLabelWidth,
                    fontSize: 10,
                    color: "#94a3b8",
                    background: "rgba(255,255,255,0.9)",
                    paddingRight: 4,
                    minWidth: axisLabelWidth - 4,
                    textAlign: "right",
                  }}
                >
                  {tick}
                </span>
              </div>
            ))}
        </div>
        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: `repeat(${itemCount}, minmax(0, 1fr))`,
            gap: columnGap,
            alignItems: "end",
            minHeight: 190,
          }}
        >
          {renderItems.map((it, idx) => {
            const value = it.label || "(sin valor)";
            const count = Number(it.count || 0);
            const isSynthetic = it.isSynthetic === true;
            const isActive = !isSynthetic && isInteractiveValueActive(fs.id_pregunta, value);
            const heightPct =
              chartMax > 0 ? Math.max(8, Math.min(100, (count / chartMax) * 100)) : 0;
            const baseColor = getBarItemColor(idx, it.color_hex);
            return (
              <div
                key={`${fs.id_pregunta}-lb-${idx}`}
                style={{
                  border: isActive ? "1px solid #111827" : "1px solid transparent",
                  background: isActive ? "#f3f4f6" : "#ffffff",
                  borderRadius: 10,
                  padding: "6px 6px 8px",
                  cursor: isSynthetic ? "default" : "pointer",
                }}
                onClick={
                  isSynthetic
                    ? undefined
                    : () =>
                        addInteractiveFilter({
                          id_pregunta: fs.id_pregunta,
                          label: fs.etiqueta,
                          tipo: fs.tipo,
                          value,
                        })
                }
                title={
                  isSynthetic ? "Categoria informativa" : "Filtrar por este valor"
                }
              >
                <div
                  style={{
                    height: 110,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                  }}
                >
                  <div
                    onClick={
                      isSynthetic
                        ? undefined
                        : (event) => {
                            event.stopPropagation();
                            addInteractiveFilter({
                              id_pregunta: fs.id_pregunta,
                              label: fs.etiqueta,
                              tipo: fs.tipo,
                              value,
                            });
                          }
                    }
                    style={{
                      width: itemCount > 8 ? 18 : itemCount > 5 ? 22 : 26,
                      height: `${heightPct}%`,
                      minHeight: count > 0 ? 8 : 0,
                      borderRadius: 8,
                      background: isSynthetic
                        ? baseColor
                        : getActiveTone(
                            baseColor,
                            isActive,
                            hasActiveInteractiveSelection
                          ),
                      boxShadow: isActive
                        ? "inset 0 0 0 1px rgba(15,23,42,0.18)"
                        : "none",
                      opacity: isSynthetic ? 0.9 : 1,
                      cursor: isSynthetic ? "default" : "pointer",
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, color: isActive ? "#111827" : "#374151" }}>
                  {renderIndicatorMeta({
                    label: value,
                    count,
                    total: totalUniverse,
                    showPercentages,
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={headerStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>Dashboard Informes</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Proyecto #{idProyecto}
            </div>
          </div>
          <button type="button" onClick={openConfig} style={primaryButtonStyle}>
            Configurar dashboard
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
          Formulario activo:{" "}
          <b>{appliedPlantillaLabel || "No seleccionado"}</b>
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "#374151",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showPercentages}
              onChange={(e) => setShowPercentages(e.target.checked)}
            />
            Mostrar porcentajes
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <span style={statChip}>Total registros: {kpis.total_informes ?? 0}</span>
          <span style={statChip}>Total plantillas: {kpis.total_plantillas ?? 0}</span>
          <span style={statChip}>Con geo: {geo.total_geo ?? 0}</span>
          <span style={statChip}>Sin geo: {geo.total_sin_geo ?? 0}</span>
          <span style={statChip}>Filtros activos: {appliedFiltersCount}</span>
          <span style={statChip}>Campos visibles: {appliedFieldsCount}</span>
        </div>

        {canShowSubmapa ? (
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowSubmapa((prev) => !prev)}
              style={buttonStyle}
            >
              {showSubmapa ? "Ocultar mapa" : "Mostrar mapa"}
            </button>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {hasLinkFields
                ? "Vista de puntos y capas vinculadas del dashboard."
                : "Vista base de puntos georreferenciados del dashboard."}
            </span>
          </div>
        ) : null}
      </div>

      {canShowSubmapa ? (
        <GVASubmapa
          loading={geoLinksLoading}
          error={geoLinksError}
          data={geoLinksData}
          onRetry={refetchGeoLinks}
          tramosGeo={tramosGeo}
          progresivasGeo={progresivasGeo}
          geometryLoading={geometryLoading}
          geometryError={geometryError}
          selectedMapKpiId={selectedMapKpiId}
          selectedMapKpiLabel={selectedMapKpiLabel}
          selectedMapKpiTipo={activeMapKpiTipo}
          addInteractiveFilter={addInteractiveFilter}
          isInteractiveValueActive={isInteractiveValueActive}
          visible={showSubmapa}
          totalUniverseGeo={geo?.total_geo || 0}
          isLoadedAll={includeAllPoints}
          onLoadAll={() => setIncludeAllPoints(true)}
        />
      ) : null}

      {loading ? (
        <div style={{ marginTop: 16 }}>Cargando resumen...</div>
      ) : error ? (
        <div style={{ marginTop: 16, color: "#b91c1c" }}>{error}</div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#ffffff",
          padding: 12,
        }}
      >
        {showTimeline ? (
          <div
            style={{
              marginBottom: 16,
              borderBottom: "1px solid #f1f5f9",
              paddingBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div>
                <span style={{ fontWeight: 800, fontSize: 12, color: "#1e293b" }}>
                  Periodo analizado
                </span>
                <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
                  Fuente: {temporalLabel}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#2563eb",
                  background: "#eff6ff",
                  padding: "2px 8px",
                  borderRadius: 6,
                }}
              >
                {formatDateLabelLong(draftDateFrom || absoluteMin)} -{" "}
                {formatDateLabelLong(draftDateTo || absoluteMax)}
              </div>
            </div>

            <div
              style={{
                position: "relative",
                height: 36,
                display: "flex",
                alignItems: "flex-end",
                paddingBottom: 4,
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 4,
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 1,
                  zIndex: 0,
                }}
              >
                {temporalSeries.map((b, i) => {
                  const maxCount = Math.max(...temporalSeries.map(s => s.count), 1);
                  const h = (b.count / maxCount) * 100;

                  const { start: bStart, end: bEnd } = getBucketRange(b?.bucket_start, temporal?.time_grouping);
                  const isInRange = bStart <= dToTs && bEnd > dFromTs;

                  return (
                    <div
                      key={`bar-${i}`}
                      style={{
                        flex: 1,
                        height: `${Math.max(4, h)}%`,
                        background: "#2563eb",
                        borderRadius: "1px 1px 0 0",
                        opacity: isInRange ? 0.4 : 0.08,
                        transition: "opacity 0.2s ease",
                      }}
                    />
                  );
                })}
              </div>

              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 4,
                  background: "#f1f5f9",
                  borderRadius: 99,
                  zIndex: 1,
                }}
              >
                {(() => {
                  const leftPct = ((dFromTs - minTs) / (maxTs - minTs)) * 100;
                  const rightPct = ((dToTs - minTs) / (maxTs - minTs)) * 100;

                  return (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          left: `${leftPct}%`,
                          width: `${rightPct - leftPct}%`,
                          height: "100%",
                          background: "#2563eb",
                          borderRadius: 99,
                        }}
                      />
                      <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        <input
                          type="range"
                          min={minTs}
                          max={maxTs}
                          step={86400000}
                          value={dFromTs}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const currentTo = parseDateYMD(draftDateTo || absoluteMax).getTime();
                            const next = new Date(Math.min(val, currentTo - 86400000));
                            const nextFrom = next.toISOString().slice(0, 10);
                            timelineRangeRef.current = {
                              from: nextFrom,
                              to: timelineRangeRef.current.to || String(draftDateTo || ""),
                            };
                            setDraftDateFrom(nextFrom);
                          }}
                          onMouseUp={() =>
                            applyTemporalRange(
                              timelineRangeRef.current.from,
                              timelineRangeRef.current.to
                            )
                          }
                          onTouchEnd={() =>
                            applyTemporalRange(
                              timelineRangeRef.current.from,
                              timelineRangeRef.current.to
                            )
                          }
                          style={{
                            position: "absolute",
                            width: "100%",
                            top: -6,
                            left: 0,
                            pointerEvents: "none",
                            appearance: "none",
                            background: "transparent",
                            zIndex: 3,
                          }}
                          className="tl-slider-input"
                        />
                        <input
                          type="range"
                          min={minTs}
                          max={maxTs}
                          step={86400000}
                          value={dToTs}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const currentFrom = parseDateYMD(draftDateFrom || absoluteMin).getTime();
                            const next = new Date(Math.max(val, currentFrom + 86400000));
                            const nextTo = next.toISOString().slice(0, 10);
                            timelineRangeRef.current = {
                              from: timelineRangeRef.current.from || String(draftDateFrom || ""),
                              to: nextTo,
                            };
                            setDraftDateTo(nextTo);
                          }}
                          onMouseUp={() =>
                            applyTemporalRange(
                              timelineRangeRef.current.from,
                              timelineRangeRef.current.to
                            )
                          }
                          onTouchEnd={() =>
                            applyTemporalRange(
                              timelineRangeRef.current.from,
                              timelineRangeRef.current.to
                            )
                          }
                          style={{
                            position: "absolute",
                            width: "100%",
                            top: -6,
                            left: 0,
                            pointerEvents: "none",
                            appearance: "none",
                            background: "transparent",
                            zIndex: 4,
                          }}
                          className="tl-slider-input"
                        />
                        <style>{`
                          .tl-slider-input::-webkit-slider-thumb {
                            pointer-events: auto;
                            appearance: none;
                            width: 14px;
                            height: 14px;
                            background: #2563eb;
                            border: 2px solid #ffffff;
                            border-radius: 50%;
                            cursor: grab;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                          }
                          .tl-slider-input::-moz-range-thumb {
                            pointer-events: auto;
                            width: 14px;
                            height: 14px;
                            background: #2563eb;
                            border: 2px solid #ffffff;
                            border-radius: 50%;
                            cursor: grab;
                            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                          }
                        `}</style>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                width: "100%",
                borderTop: "1px solid #f1f5f9",
                paddingTop: 4,
              }}
            >
              {temporalSeries.slice(0, 12).map((bucket, i) => {
                const label = formatTemporalLabel(bucket);
                const { start: bStart, end: bEnd } = getBucketRange(bucket?.bucket_start, temporal?.time_grouping);

                const isActive = bStart <= dToTs && bEnd > dFromTs;

                return (
                  <div
                    key={`bucket-tl-${i}`}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "2px 4px",
                      borderRight: i < Math.min(temporalSeries.length, 12) - 1 ? "1px solid #f1f5f9" : "none",
                      minWidth: 0,
                      background: isActive ? "#eff6ff" : "transparent",
                      transition: "background 0.2s ease",
                    }}
                    onClick={
                      canUseTemporalBuckets
                        ? () => applyTemporalBucket(bucket, temporal?.time_grouping)
                        : undefined
                    }
                    title={
                      canUseTemporalBuckets
                        ? "Click para ver solo este periodo"
                        : "Fuente temporal no apta para agrupacion"
                    }
                  >
                    <div
                      style={{
                        fontSize: "9px",
                        color: isActive ? "#1e40af" : "#64748b",
                        fontWeight: isActive ? 800 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 800 }}>Filtros aplicados</div>
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            style={buttonStyle}
          >
            {showFilters ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Fuente: {appliedTemporalLabel}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Agrupacion: {groupingLabelDisplay}
            <button
              type="button"
              onClick={resetAppliedTimeGrouping}
              title="Volver a Semana"
              disabled={!temporalGroupingEnabled}
              style={{
                border: "none",
                background: "transparent",
                cursor: temporalGroupingEnabled ? "pointer" : "not-allowed",
                fontWeight: 900,
                opacity: temporalGroupingEnabled ? 1 : 0.5,
              }}
            >
              ×
            </button>
          </span>
          {appliedDateFrom ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Desde: {appliedDateFrom}
              <button
                type="button"
                onClick={clearAppliedDateFrom}
                title="Quitar desde"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ×
              </button>
            </span>
          ) : null}
          {appliedDateTo ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Hasta: {appliedDateTo}
              <button
                type="button"
                onClick={clearAppliedDateTo}
                title="Quitar hasta"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ×
              </button>
            </span>
          ) : null}
          {appliedSearchText ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Busqueda: {appliedSearchText}
              <button
                type="button"
                onClick={clearAppliedSearchText}
                title="Quitar busqueda"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ×
              </button>
            </span>
          ) : null}
          {appliedSearchFieldsLabels.length > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#f8fafc",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Campos de busqueda: {appliedSearchFieldsLabels.join(", ")}
            </span>
          ) : null}
          {(appliedInteractiveFilters || []).length > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Filtros interactivos: {(appliedInteractiveFilters || []).length}
              <button
                type="button"
                onClick={clearInteractiveFilters}
                title="Limpiar filtros interactivos"
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ×
              </button>
            </span>
          ) : null}
          {!appliedDateFrom &&
          !appliedDateTo &&
          !appliedSearchText &&
          appliedSearchFieldsLabels.length === 0 &&
          (appliedInteractiveFilters || []).length === 0 ? (
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              No hay filtros aplicados.
            </span>
          ) : null}
        </div>

        {showFilters ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Fuente temporal
                </div>
                <div style={{ fontWeight: 700 }}>{appliedTemporalLabel}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                  Agrupacion temporal
                </div>
                <select
                  value={draftTimeGrouping}
                  onChange={(e) => setDraftTimeGrouping(e.target.value)}
                  disabled={!temporalGroupingEnabled}
                >
                  <option value="day">Dia</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                </select>
              </div>
              {!showTimeline && (
                <>
                  <div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                      Desde
                    </div>
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: "6px 10px",
                        background: "#ffffff",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Fecha</span>
                      <input
                        type="date"
                        value={draftDateFrom}
                        onChange={(e) => setDraftDateFrom(e.target.value)}
                        disabled={!temporalFilterable}
                        style={{
                          border: "none",
                          outline: "none",
                          fontSize: 13,
                          background: "transparent",
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                      Hasta
                    </div>
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: "6px 10px",
                        background: "#ffffff",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Fecha</span>
                      <input
                        type="date"
                        value={draftDateTo}
                        onChange={(e) => setDraftDateTo(e.target.value)}
                        disabled={!temporalFilterable}
                        style={{
                          border: "none",
                          outline: "none",
                          fontSize: 13,
                          background: "transparent",
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                Busqueda
              </div>
              {appliedSearchFieldsLabels.length > 0 ? (
                <div>
                  <input
                    type="text"
                    placeholder="Buscar texto en los campos seleccionados"
                    value={draftSearchText}
                    onChange={(e) => setDraftSearchText(e.target.value)}
                    style={{
                      width: "100%",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "6px 10px",
                      fontSize: 13,
                    }}
                  />
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {appliedSearchFieldsLabels.map((label) => (
                      <span
                        key={`search-chip-${label}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid #e5e7eb",
                          background: "#f8fafc",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Busqueda en: {label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  No hay campos de busqueda seleccionados en la configuracion.
                </div>
              )}
            </div>

            {activeFilterFields.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                  Filtros dinamicos
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
                  Define los valores concretos para los campos marcados como filtro.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: 10,
                  }}
                >
                  {activeFilterFields.map((f) => renderDynamicFilterControl(f))}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...subtleBadgeStyle, background: "#ffffff" }}>
                    Activos: {activeFiltersPayload.length}
                  </span>
                  <button
                    type="button"
                    onClick={clearAllDynamicFilters}
                    disabled={activeFiltersPayload.length === 0}
                    style={buttonStyle}
                  >
                    Limpiar todos
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button type="button" onClick={applyFilters} style={primaryButtonStyle}>
                Aplicar filtros
              </button>
              <button type="button" onClick={clearFilters} style={buttonStyle}>
                Limpiar filtros
              </button>
              {(appliedInteractiveFilters || []).length > 0 ? (
                <button type="button" onClick={clearInteractiveFilters} style={buttonStyle}>
                  Limpiar interactivos
                </button>
              ) : null}
              <button type="button" onClick={resetDraftFiltersFromApplied} style={buttonStyle}>
                Deshacer cambios
              </button>
            </div>
            {(appliedInteractiveFilters || []).length > 0 ? (
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(appliedInteractiveFilters || []).map((f) => (
                  <span
                    key={`if-${f.id_pregunta}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  >
                    {f.label}: {getInteractiveValuesForField(f.id_pregunta).join(", ")}
                    <button
                      type="button"
                      onClick={() => clearInteractiveFilterField(f.id_pregunta)}
                      title="Quitar filtro"
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>


      <div
        style={{
          marginTop: 18,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#ffffff",
          padding: 12,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Evolucion temporal</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Fuente temporal: <b>{temporalLabel}</b> · Agrupacion:{" "}
          <b>{groupingLabelDisplay}</b> · Total del rango: <b>{temporalRangeTotal}</b>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
          Min absoluto: {absoluteMin || "—"} · Max absoluto: {absoluteMax || "—"} ·
          {" "}timeline_enabled: {temporalTimelineEnabled ? "true" : "false"} ·
          {" "}grouping_enabled: {temporalGroupingEnabled ? "true" : "false"} ·
          {" "}range_total: {temporalRangeTotal}
        </div>

        {temporalState.status !== "ok" ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {temporalState.message}
            {temporalDiagnostic ? (
              <div style={{ marginTop: 6 }}>
                {temporalDiagnostic}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
            }}
          >
            {temporalSeries.map((row) => {
              const count = Number(row.count || 0);
              const width = temporalRangeTotal > 0 ? (count / temporalRangeTotal) * 100 : 0;
              const isActive =
                canUseTemporalBuckets && isTemporalBucketActive(row, temporal?.time_grouping);
              const label = formatTemporalLabel(row);
              return (
                <div
                  key={row.key || row.label}
                  onClick={
                    canUseTemporalBuckets
                      ? () => applyTemporalBucket(row, temporal?.time_grouping)
                      : undefined
                  }
                  style={{
                    border: isActive ? "1px solid #111827" : "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 10,
                    background: isActive ? "#eef2ff" : "#f8fafc",
                    cursor: canUseTemporalBuckets ? "pointer" : "not-allowed",
                    boxShadow: isActive
                      ? "inset 0 0 0 1px rgba(17,24,39,0.08)"
                      : "none",
                  }}
                  title={
                    canUseTemporalBuckets
                      ? "Aplicar este rango al dashboard"
                      : "Fuente temporal no apta para agrupacion"
                  }
                >
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    {label}
                  </div>
                  <div
                    style={{
                      height: 8,
                      background: "#e5e7eb",
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, Math.max(0, width))}%`,
                        background: isActive ? "#1d4ed8" : "#111827",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {renderIndicatorMeta({
                      label,
                      count,
                      total: temporalRangeTotal,
                      showPercentages,
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Resultados</div>
        {appliedFieldsCount === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No hay campos visibles aplicados.
          </div>
        ) : fieldSummaries.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No hay resultados para los campos seleccionados.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {fieldSummaries.map((fs) => {
              const isCounts = fs.summary_type === "counts";
              const isText = fs.summary_type === "text_basic";
              const allowed = Array.isArray(fs.allowed_chart_types)
                ? fs.allowed_chart_types
                : [];
              const isEligible = !!fs.kpi_eligible && allowed.length > 0;
              const chartType = fieldChartTypes[String(fs.id_pregunta)] || "list";
              const items = Array.isArray(fs.items) ? fs.items : [];
              const questionUniverse = Number(fs.total_universe ?? kpis.total_informes ?? 0);
              const respondedCount = Number(fs.responded_count ?? fs.non_empty_count ?? 0);
              const notRespondedCount = Number(
                fs.not_responded_count ?? Math.max(0, questionUniverse - respondedCount)
              );
              const responseRateRaw = Number(fs.response_rate);
              const responseRateLabel = Number.isFinite(responseRateRaw)
                ? `${(responseRateRaw * 100).toFixed(1)}%`
                : questionUniverse > 0
                  ? `${((respondedCount / questionUniverse) * 100).toFixed(1)}%`
                  : "0.0%";
              const totalItems = items.reduce((acc, it) => acc + (Number(it.count) || 0), 0);
              const hasActiveInteractiveSelection = items.some((it) =>
                isInteractiveValueActive(fs.id_pregunta, it.label || "(sin valor)")
              );
              const isMapKpiActive = Number(selectedMapKpiId) === Number(fs.id_pregunta);
              const activeInteractiveValues = getInteractiveValuesForField(fs.id_pregunta);
              const hasInteractiveValues = activeInteractiveValues.length > 0;
              const pctLabel = (count) =>
                totalItems > 0 ? `${((Number(count || 0) / totalItems) * 100).toFixed(1)}%` : "0.0%";
              return (
                <div
                  key={fs.id_pregunta}
                  style={{
                    border: isMapKpiActive ? "1px solid #1d4ed8" : "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: isMapKpiActive ? "#eff6ff" : "#fff",
                    minHeight: 260,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{fs.etiqueta}</div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        marginTop: 6,
                        fontSize: 12,
                        color: "#6b7280",
                      }}
                    >
                      <span>Total registros: {questionUniverse.toLocaleString()}</span>
                      <span>Con respuesta: {respondedCount.toLocaleString()}</span>
                      <span>Sin responder: {notRespondedCount.toLocaleString()}</span>
                      <span>Tasa de respuesta: {responseRateLabel}</span>
                    </div>
                    {isEligible ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isMapKpiActive) {
                            setSelectedMapKpiId(null);
                            setSelectedMapKpiLabel("");
                          } else {
                            setSelectedMapKpiId(Number(fs.id_pregunta));
                            setSelectedMapKpiLabel(fs.etiqueta || `Pregunta ${fs.id_pregunta}`);
                            if (!showSubmapa && canShowSubmapa) setShowSubmapa(true);
                          }
                        }}
                        style={{
                          border: isMapKpiActive ? "1px solid #1d4ed8" : "1px solid #d1d5db",
                          background: isMapKpiActive ? "#1d4ed8" : "#ffffff",
                          color: isMapKpiActive ? "#ffffff" : "#374151",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        title="Usar este KPI para colorear el mapa"
                      >
                        {isMapKpiActive ? "KPI mapa activo" : "Usar en mapa"}
                      </button>
                    ) : null}
                    {hasInteractiveValues ? (
                      <button
                        type="button"
                        onClick={() => clearInteractiveFilterField(fs.id_pregunta)}
                        style={{
                          border: "1px solid #e5e7eb",
                          background: "#ffffff",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                        title="Limpiar seleccion"
                      >
                        Limpiar seleccion
                      </button>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                    Tipo: {traducirTipoCampo(fs.tipo)}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {fs.kpi_eligible ? "Apto para KPI" : "No apto para KPI"}
                  </div>

                  {isEligible ? (
                    <div
                      style={{
                        marginBottom: 8,
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {allowed.map((t) => {
                        const active = chartType === t;
                        return (
                          <button
                            key={`${fs.id_pregunta}-${t}`}
                            type="button"
                            onClick={() => setFieldChartType(fs.id_pregunta, t)}
                            style={{
                              border: active
                                ? "1px solid #111827"
                                : "1px solid #d1d5db",
                              background: active ? "#111827" : "#ffffff",
                              color: active ? "#ffffff" : "#374151",
                              borderRadius: 999,
                              padding: "4px 10px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                            title={`Ver como ${traducirTipoGrafico(t)}`}
                          >
                            {traducirTipoGrafico(t)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {isCounts && !isEligible ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {buildSummaryRenderItems(items, questionUniverse)
                        .slice()
                        .sort((a, b) => (b.count || 0) - (a.count || 0))
                        .map((it, idx) => {
                          const value = it.label || "(sin valor)";
                          const count = Number(it.count || 0);
                          const isSynthetic = it.isSynthetic === true;
                          const isActive = !isSynthetic && isInteractiveValueActive(
                            fs.id_pregunta,
                            value
                          );
                          const pctValue = questionUniverse > 0 
                            ? ((count / questionUniverse) * 100).toFixed(1) 
                            : "0.0";
                          return (
                            <div
                              key={`${fs.id_pregunta}-nolist-${idx}`}
                              style={{
                                border: isActive ? "1px solid #111827" : "1px solid #e5e7eb",
                                background: isActive ? "#f8fafc" : "#ffffff",
                                borderRadius: 8,
                                padding: "6px 8px",
                                cursor: isSynthetic ? "default" : "pointer",
                              }}
                              onClick={
                                isSynthetic
                                  ? undefined
                                  : () =>
                                      addInteractiveFilter({
                                        id_pregunta: fs.id_pregunta,
                                        label: fs.etiqueta,
                                        tipo: fs.tipo,
                                        value,
                                      })
                              }
                              title={isSynthetic ? "Categoria informativa" : "Filtrar por este valor"}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#111827" : "#374151" }}>
                                  {value}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280" }}>
                                  {pctValue}%
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                                {count} informes
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : null}

                  {isCounts && isEligible && chartType === "list" ? (
                    <ListAsBars
                      fs={fs}
                      items={items}
                      kpis={kpis}
                      totalUniverse={questionUniverse}
                      addInteractiveFilter={addInteractiveFilter}
                      isInteractiveValueActive={isInteractiveValueActive}
                      hasActiveInteractiveSelection={hasActiveInteractiveSelection}
                      getBarItemColor={getBarItemColor}
                      getActiveTone={getActiveTone}
                    />
                  ) : null}

                  {isCounts && isEligible && chartType === "bar" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {buildSummaryRenderItems(items, questionUniverse).map((it, idx) => {
                        const value = it.label || "(sin valor)";
                        const count = Number(it.count || 0);
                        const isSynthetic = it.isSynthetic === true;
                        const isActive = !isSynthetic && isInteractiveValueActive(
                          fs.id_pregunta,
                          value
                        );
                        const baseColor = isSynthetic ? "#94a3b8" : getBarItemColor(idx, it.color_hex);
                        return (
                        <div
                          key={`${fs.id_pregunta}-b-${idx}`}
                          style={{
                            border: isActive ? "1px solid #111827" : "1px solid transparent",
                            background: isActive ? "#f8fafc" : "transparent",
                            borderRadius: 10,
                            padding: "4px 6px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              cursor: isSynthetic ? "default" : "pointer",
                              color: isActive ? "#111827" : "#374151",
                            }}
                            onClick={
                              isSynthetic
                                ? undefined
                                : () =>
                                    addInteractiveFilter({
                                      id_pregunta: fs.id_pregunta,
                                      label: fs.etiqueta,
                                      tipo: fs.tipo,
                                      value,
                                    })
                            }
                            title={
                              isSynthetic ? "Categoria informativa" : "Filtrar por este valor"
                            }
                          >
                            {renderIndicatorMeta({
                              label: value,
                              count,
                                total: questionUniverse,
                              showPercentages,
                            })}
                          </div>
                          <div
                            style={{
                              height: 6,
                              background: "#eef2f7",
                              borderRadius: 999,
                              overflow: "hidden",
                              marginTop: 2,
                            }}
                          >
                            <div
                              onClick={
                                isSynthetic
                                  ? undefined
                                  : (event) => {
                                      event.stopPropagation();
                                      addInteractiveFilter({
                                        id_pregunta: fs.id_pregunta,
                                        label: fs.etiqueta,
                                        tipo: fs.tipo,
                                        value,
                                      });
                                    }
                              }
                              style={{
                                height: "100%",
                                width:
                                    questionUniverse
                                    ? `${Math.min(
                                        100,
                                        (it.count / (questionUniverse || 1)) * 100
                                      )}%`
                                    : "0%",
                                background: getActiveTone(
                                  baseColor,
                                  isActive,
                                  hasActiveInteractiveSelection
                                ),
                                boxShadow: isActive
                                  ? "inset 0 0 0 1px rgba(15,23,42,0.18)"
                                  : "none",
                                cursor: isSynthetic ? "default" : "pointer",
                                opacity: isSynthetic ? 0.9 : 1,
                              }}
                            />
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isCounts && isEligible && chartType === "traffic" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {(() => {
                        const total = items.reduce((acc, it) => acc + (it.count || 0), 0) || 1;
                        return (
                          <>
                            <div
                              style={{
                                display: "flex",
                                width: "100%",
                                minHeight: 20,
                                borderRadius: 999,
                                overflow: "hidden",
                                background: "#e5e7eb",
                              }}
                            >
                              {items.map((it, idx) => {
                                const widthPct = total > 0 ? ((it.count || 0) / total) * 100 : 0;
                                const isActive = isInteractiveValueActive(
                                  fs.id_pregunta,
                                  it.label || "(sin valor)"
                                );
                                const baseColor = getSemaforoColor(it.color_key, it.color_hex);
                                return (
                                  <button
                                    key={`${fs.id_pregunta}-tbar-${idx}`}
                                    type="button"
                                    onClick={() =>
                                      addInteractiveFilter({
                                        id_pregunta: fs.id_pregunta,
                                        label: fs.etiqueta,
                                        tipo: fs.tipo,
                                        value: it.label || "(sin valor)",
                                      })
                                    }
                                    title={`Filtrar por ${it.label || "(sin valor)"}`}
                                    style={{
                                      width: `${Math.max(widthPct, widthPct > 0 ? 8 : 0)}%`,
                                      minWidth: widthPct > 0 ? 18 : 0,
                                      border: isActive ? "2px solid #111827" : "none",
                                      padding: 0,
                                      margin: 0,
                                      background: getActiveTone(
                                        baseColor,
                                        isActive,
                                        hasActiveInteractiveSelection
                                      ),
                                      cursor: "pointer",
                                    }}
                                  />
                                );
                              })}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {items.map((it, idx) => (
                                <div
                                  key={`${fs.id_pregunta}-traffic-${idx}`}
                                  data-active={isInteractiveValueActive(
                                    fs.id_pregunta,
                                    it.label || "(sin valor)"
                                  )}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "14px 1fr",
                                    gap: 8,
                                    alignItems: "start",
                                    fontSize: 12,
                                    cursor: "pointer",
                                    border: isInteractiveValueActive(
                                      fs.id_pregunta,
                                      it.label || "(sin valor)"
                                    )
                                      ? "1px solid #111827"
                                      : "1px solid transparent",
                                    background: isInteractiveValueActive(
                                      fs.id_pregunta,
                                      it.label || "(sin valor)"
                                    )
                                      ? "#f8fafc"
                                      : "transparent",
                                    borderRadius: 10,
                                    padding: "4px 6px",
                                  }}
                                  onClick={() =>
                                    addInteractiveFilter({
                                      id_pregunta: fs.id_pregunta,
                                      label: fs.etiqueta,
                                      tipo: fs.tipo,
                                      value: it.label || "(sin valor)",
                                    })
                                  }
                                  title="Filtrar por este valor"
                                  >
                                  <span
                                    style={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: "50%",
                                      background: getSemaforoColor(it.color_key, it.color_hex),
                                      boxShadow: isInteractiveValueActive(
                                        fs.id_pregunta,
                                        it.label || "(sin valor)"
                                      )
                                        ? "0 0 0 2px rgba(17,24,39,0.28)"
                                        : "inset 0 0 0 1px rgba(17,24,39,0.08)",
                                    }}
                                  />
                                  {renderIndicatorMeta({
                                    label: it.label || "(sin valor)",
                                    count: it.count,
                                    total: questionUniverse,
                                    showPercentages,
                                  })}
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}

                  {isCounts && isEligible && chartType === "donut" ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        gap: 14,
                        alignItems: "center",
                        minHeight: 150,
                      }}
                    >
                      {(() => {
                        const donutItems = buildSummaryRenderItems(
                          items,
                          questionUniverse
                        ).slice(0, 6);
                        const total = donutItems.reduce((acc, it) => acc + (it.count || 0), 0) || 1;
                        const colors = ["#111827", "#2563eb", "#16a34a", "#f97316", "#a855f7"];
                        let acc = 0;
                        const segments = donutItems.map((it, idx) => {
                          const pct = (it.count || 0) / total;
                          const start = acc;
                          acc += pct;
                          const isSynthetic = it.isSynthetic === true;
                          const baseColor = isSynthetic ? "#94a3b8" : getBarItemColor(idx, it.color_hex);
                          const isActive = !isSynthetic && isInteractiveValueActive(
                            fs.id_pregunta,
                            it.label || "(sin valor)"
                          );
                          const color = getActiveTone(
                            baseColor,
                            isActive,
                            hasActiveInteractiveSelection
                          );
                          return {
                            item: it,
                            color,
                            isActive,
                            isSynthetic,
                            startAngle: start * 360,
                            endAngle: acc * 360,
                          };
                        });
                        return (
                          <div
                            style={{
                              width: 110,
                              height: 110,
                              position: "relative",
                              display: "grid",
                              placeItems: "center",
                            }}
                            title={`Total: ${total}`}
                          >
                            <svg
                              width="110"
                              height="110"
                              viewBox="0 0 110 110"
                              style={{ position: "absolute", inset: 0, overflow: "visible" }}
                            >
                              {segments.map((segment, idx) => (
                                <path
                                  key={`${fs.id_pregunta}-donut-${idx}`}
                                  d={describeArc(
                                    55,
                                    55,
                                    55,
                                    segment.startAngle,
                                    segment.endAngle
                                  )}
                                  fill={segment.color}
                                  stroke={segment.isActive ? "#111827" : "#ffffff"}
                                  strokeWidth={segment.isActive ? 2.5 : 1.5}
                                  style={{
                                    cursor: segment.isSynthetic ? "default" : "pointer",
                                    opacity: segment.isSynthetic ? 0.9 : 1,
                                  }}
                                  onClick={
                                    segment.isSynthetic
                                      ? undefined
                                      : () =>
                                          addInteractiveFilter({
                                            id_pregunta: fs.id_pregunta,
                                            label: fs.etiqueta,
                                            tipo: fs.tipo,
                                            value: segment.item.label || "(sin valor)",
                                          })
                                  }
                                />
                              ))}
                            </svg>
                            <div
                              style={{
                                width: 54,
                                height: 54,
                                borderRadius: "50%",
                                background: "#fff",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 11,
                                fontWeight: 800,
                                color: "#111827",
                              }}
                            >
                              {total}
                            </div>
                          </div>
                        );
                      })()}
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        {buildSummaryRenderItems(items, questionUniverse)
                          .slice(0, 6)
                          .map((it, idx) => (
                          <div
                            key={`${fs.id_pregunta}-d-${idx}`}
                            data-active={it.isSynthetic !== true && isInteractiveValueActive(
                              fs.id_pregunta,
                              it.label || "(sin valor)"
                            )}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              marginBottom: 4,
                              border: it.isSynthetic !== true && isInteractiveValueActive(
                                fs.id_pregunta,
                                it.label || "(sin valor)"
                              )
                                ? "1px solid #111827"
                                : "1px solid transparent",
                              background: it.isSynthetic !== true && isInteractiveValueActive(
                                fs.id_pregunta,
                                it.label || "(sin valor)"
                              )
                                ? "#f8fafc"
                                : "transparent",
                              borderRadius: 10,
                              padding: "4px 6px",
                              cursor: it.isSynthetic ? "default" : "pointer",
                            }}
                            onClick={
                              it.isSynthetic
                                ? undefined
                                : () =>
                                    addInteractiveFilter({
                                      id_pregunta: fs.id_pregunta,
                                      label: fs.etiqueta,
                                      tipo: fs.tipo,
                                      value: it.label || "(sin valor)",
                                    })
                            }
                            title={
                              it.isSynthetic ? "Categoria informativa" : "Filtrar por este valor"
                            }
                          >
                            {renderIndicatorMeta({
                              label: it.label || "(sin valor)",
                              count: it.count,
                               total: questionUniverse,
                              showPercentages,
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {isText ? (
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      <div>Con respuesta: {respondedCount}</div>
                      <div>Sin responder: {notRespondedCount}</div>
                      <div>Tasa de respuesta: {responseRateLabel}</div>
                      <div style={{ marginTop: 6 }}>
                        {(fs.sample_values || []).map((v, idx) => (
                          <div key={`${fs.id_pregunta}-s-${idx}`}>{v}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Plantillas en resumen: {plantillasResumen.length}
        </div>
      </div>

      <Modal show={showConfig} onHide={cancelConfig} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Configurar dashboard</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div style={{ marginBottom: 16, ...panelStyle }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Configuracion general</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              Selecciona plantilla, fuente temporal y revisa el resumen actual.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Plantilla</div>
                {plantillasLoading ? (
                  <div>Cargando plantillas...</div>
                ) : plantillasError ? (
                  <div style={{ color: "#b91c1c" }}>{plantillasError}</div>
                ) : !plantillas.length ? (
                  <div style={{ fontSize: 13, color: "#6b7280" }}>
                    No hay plantillas disponibles para este proyecto.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      maxHeight: 250,
                      overflowY: "auto",
                      paddingRight: 4,
                    }}
                  >
                    {plantillas.map((p) => (
                      <button
                        key={p.id_plantilla}
                        type="button"
                        onClick={() => {
                          const v = Number(p.id_plantilla);
                          setSelectedPlantillaId(Number.isFinite(v) && v > 0 ? v : null);
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 4,
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 12,
                          border:
                            Number(selectedPlantillaId) === Number(p.id_plantilla)
                              ? "1px solid #2563eb"
                              : "1px solid #d1d5db",
                          background:
                            Number(selectedPlantillaId) === Number(p.id_plantilla)
                              ? "linear-gradient(180deg, rgba(219,234,254,0.95) 0%, rgba(239,246,255,0.95) 100%)"
                              : "#ffffff",
                          boxShadow:
                            Number(selectedPlantillaId) === Number(p.id_plantilla)
                              ? "0 0 0 2px rgba(37,99,235,0.12)"
                              : "0 1px 2px rgba(15,23,42,0.05)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#111827" }}>
                          {p.nombre || `Plantilla #${p.id_plantilla}`}
                        </div>
                        <div style={{ fontSize: 12, color: "#4b5563" }}>
                          {Number(p.dashboard_indicators_count) || 0} indicadores ·{" "}
                          {Number(p.total_informes) || 0} informes
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {metadataLoading ? (
                  <div style={{ marginTop: 6 }}>Cargando metadata...</div>
                ) : metadataError ? (
                  <div style={{ marginTop: 6, color: "#b91c1c" }}>{metadataError}</div>
                ) : null}
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Fuente temporal del analisis
                </div>
                <select
                  value={dateFieldId || "__created_at"}
                  onChange={(e) => setDateFieldId(String(e.target.value || "__created_at"))}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "14px" }}
                >
                  {availableTemporalSources.map((src) => {
                    const countsFiltered = data?.temporal?.sources_counts_filtered || null;
                    const baseCount = Number(src?.valid_count || 0);
                    const distinctCount = Number(src?.distinct_valid_count || 0);
                    const distinctLabel = distinctCount === 1 ? "distinta" : "distintas";
                    const hasFiltered =
                      countsFiltered &&
                      Object.prototype.hasOwnProperty.call(countsFiltered, src.id);
                    const filteredCount = hasFiltered ? Number(countsFiltered[src.id]) || 0 : null;
                    const countStr = ` (${baseCount} · ${distinctCount} ${distinctLabel})`;
                    const filteredStr =
                      filteredCount !== null &&
                      Number(filteredCount) !== Number(baseCount)
                        ? ` · en rango: ${filteredCount}`
                        : "";
                    const hasZeroCount = baseCount === 0;
                    return (
                      <option
                        key={String(src.id)}
                        value={String(src.id)}
                        style={hasZeroCount ? { color: "#9ca3af" } : {}}
                      >
                        {src.label}{countStr}{filteredStr}
                      </option>
                    );
                  })}
                </select>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Resultados: {selectedFieldIds.size} · Filtros: {selectedFilterFieldIds.size} ·
                  Busqueda: {searchFieldIds.size}
                </div>
              </div>
            </div>
          </div>

          

          

          {selectedPlantillaId && groupedAvailableFields.results.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>Resultados del dashboard</div>
                  {selectedFieldIds.size > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#111827", color: "#fff" }}>
                      {selectedFieldIds.size}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {selectedFieldIds.size > 0 ? (
                    <button type="button" onClick={clearGroupResults} style={buttonStyle}>
                      Limpiar selección
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setResultsOpen((v) => !v)}
                    style={{ ...buttonStyle, minWidth: 28, padding: "4px 8px" }}
                    title={resultsOpen ? "Colapsar" : "Expandir"}
                  >
                    {resultsOpen ? "▲" : "▼"}
                  </button>
                </div>
              </div>
              {resultsOpen ? (
                <>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                    Seleccionados: {selectedFieldIds.size}
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar campo..."
                    value={resultsQuery}
                    onChange={(e) => setResultsQuery(e.target.value)}
                    style={{ ...filterInputStyle, marginBottom: 8 }}
                  />
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.results
                      .filter((f) => {
                        const q = resultsQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          f.etiqueta.toLowerCase().includes(q) ||
                          (f.seccion || "").toLowerCase().includes(q)
                        );
                      })
                      .map((f) => renderFieldRow(f, "results"))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {selectedPlantillaId && groupedAvailableFields.filterOnly.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>Filtros del dashboard</div>
                  {selectedFilterFieldIds.size > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#111827", color: "#fff" }}>
                      {selectedFilterFieldIds.size}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {selectedFilterFieldIds.size > 0 ? (
                    <button type="button" onClick={clearGroupFilters} style={buttonStyle}>
                      Limpiar selección
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((v) => !v)}
                    style={{ ...buttonStyle, minWidth: 28, padding: "4px 8px" }}
                    title={filtersOpen ? "Colapsar" : "Expandir"}
                  >
                    {filtersOpen ? "▲" : "▼"}
                  </button>
                </div>
              </div>
              {filtersOpen ? (
                <>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                    Seleccionados:{" "}
                    {
                      groupedAvailableFields.filterOnly.filter((f) =>
                        selectedFilterFieldIds.has(f.id_pregunta)
                      ).length
                    }
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar campo..."
                    value={filtersQuery}
                    onChange={(e) => setFiltersQuery(e.target.value)}
                    style={{ ...filterInputStyle, marginBottom: 8 }}
                  />
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.filterOnly
                      .filter((f) => {
                        const q = filtersQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          f.etiqueta.toLowerCase().includes(q) ||
                          (f.seccion || "").toLowerCase().includes(q)
                        );
                      })
                      .map((f) => renderFieldRow(f, "filter"))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {selectedPlantillaId && availableSearchFields.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>Busqueda textual</div>
                  {searchFieldIds.size > 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#111827", color: "#fff" }}>
                      {searchFieldIds.size}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {searchFieldIds.size > 0 ? (
                    <button type="button" onClick={clearGroupSearch} style={buttonStyle}>
                      Limpiar selección
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setSearchOpen((v) => !v)}
                    style={{ ...buttonStyle, minWidth: 28, padding: "4px 8px" }}
                    title={searchOpen ? "Colapsar" : "Expandir"}
                  >
                    {searchOpen ? "▲" : "▼"}
                  </button>
                </div>
              </div>
              {searchOpen ? (
                <>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                    Estos campos se usan para la busqueda del subheader.
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                    Seleccionados: {searchFieldIds.size}
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar campo..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ ...filterInputStyle, marginBottom: 8 }}
                  />
                  <ul style={{ marginTop: 6 }}>
                    {availableSearchFields
                      .filter((f) => {
                        const q = searchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          f.etiqueta.toLowerCase().includes(q) ||
                          (f.seccion || "").toLowerCase().includes(q)
                        );
                      })
                      .map((f) => renderFieldRow(f, "search"))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {selectedPlantillaId && groupedAvailableFields.unavailable.length > 0 ? (
            <div
              style={{
                marginBottom: 18,
                ...panelStyle,
                opacity: 0.82,
                background: "#fafafa",
                borderStyle: "dashed",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                No disponibles en esta version
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Referencia rapida de campos que todavia no participan del dashboard visual.
              </div>
              <ul style={{ marginTop: 6 }}>
                {groupedAvailableFields.unavailable.map((f) => renderFieldRow(f, "none"))}
              </ul>
            </div>
          ) : null}


          {false && selectedPlantillaId && availableFields.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Campos disponibles</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Seleccionados: {selectedFieldIds.size} · Filtros:{" "}
                {selectedFilterFieldIds.size}
              </div>
              {groupedAvailableFields.results.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    Resultados disponibles
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.results.map((f) => renderFieldRow(f, "results"))}
                  </ul>
                </div>
              ) : null}

              {groupedAvailableFields.filterOnly.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    Solo filtro
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.filterOnly.map((f) => renderFieldRow(f, "filter"))}
                  </ul>
                </div>
              ) : null}

              {groupedAvailableFields.unavailable.length > 0 ? (
                <div style={{ marginTop: 10, opacity: 0.85 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    No disponibles en esta version
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.unavailable.map((f) => renderFieldRow(f, "none"))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {false && selectedPlantillaId && activeFilterFields.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Filtros dinamicos</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Activos: {activeFiltersPayload.length}
              </div>
              {activeFilterFields.map((f) => {
                const tipo = String(f.tipo || "").toLowerCase();
                const key = String(f.id_pregunta);
                const value = dynamicFilters[key] ?? "";
                const opciones = Array.isArray(f.opciones) ? f.opciones : [];
                const isSelect =
                  ["select", "radio", "combo"].includes(tipo) || opciones.length > 0;
                const isBool = tipo.includes("bool");

                return (
                  <div key={f.id_pregunta} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {f.etiqueta}{" "}
                      <span style={{ fontWeight: 400, color: "#6b7280" }}>
                        ({traducirTipoCampo(f.tipo)})
                      </span>
                    </div>

                    {isSelect ? (
                      <select
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                      >
                        <option value="">--</option>
                        {opciones.map((opt, idx) => (
                          <option key={`${f.id_pregunta}-${idx}`} value={opt}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    ) : isBool ? (
                      <select
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                      >
                        <option value="">--</option>
                        <option value="true">Si</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                        placeholder="Ingresar texto"
                      />
                    )}

                    <button
                      type="button"
                      style={{ marginLeft: 8 }}
                      onClick={() => clearDynamicFilterValue(f.id_pregunta)}
                      disabled={value === "" || value === null || value === undefined}
                    >
                      Limpiar
                    </button>
                  </div>
                );
              })}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={clearAllDynamicFilters}
                  disabled={activeFiltersPayload.length === 0}
                >
                  Limpiar todos
                </button>
              </div>
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <button type="button" onClick={cancelConfig} style={buttonStyle}>
            Cancelar
          </button>
          <button type="button" onClick={applyAndClose} style={primaryButtonStyle}>
            Aplicar
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
