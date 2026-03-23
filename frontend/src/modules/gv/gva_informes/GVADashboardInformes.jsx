import React, { useMemo, useState } from "react";
import { Modal, Badge } from "react-bootstrap";
import { useInformesDashboard } from "./hooks/useInformesDashboard";
import { useGVATramos } from "../gva_tramos/hooks/useGVATramos";
import GVASubmapa from "../gva_tramos/GVASubmapa";

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
  if (tipo === "bar") return "Barras";
  if (tipo === "donut") return "Dona";
  if (tipo === "list") return "Lista";
  return tipo;
}

export default function GVADashboardInformes() {
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
    applyConfig,
    resetDraftFromApplied,
  } = useInformesDashboard();

  const [showConfig, setShowConfig] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showSubmapa, setShowSubmapa] = useState(false);

  const idProyecto = params?.id_proyecto;
  const kpis = data?.kpis || {};
  const geo = data?.geo || {};
  const plantillasResumen = Array.isArray(data?.plantillas) ? data.plantillas : [];
  const temporalSeries = Array.isArray(temporal?.series) ? temporal.series : [];
  const temporalEnabled = temporal?.enabled !== false;
  const temporalRangeTotal = Number(temporal?.range_total || 0);
  const temporalLabel = temporal?.date_field_label || "Fecha de carga";

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

  const canShowSubmapa = geo?.hasGeo === true && !!linkFields;

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
      link_fields: linkFields,
      limit: 50,
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
    };
    try {
      return JSON.stringify(key);
    } catch {
      return "";
    }
  }, [geoLinksPayload]);

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

  const addDaysUTC = (date, days) => {
    if (!date) return null;
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };

  const monthLabelEs = (date) => {
    if (!date) return "";
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
    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  };

  const formatTemporalLabel = (row) => {
    const start = parseDateYMD(String(row?.bucket_start || ""));
    if (!start) return row?.label || "";
    if (appliedTimeGrouping === "month") {
      return monthLabelEs(start);
    }
    if (appliedTimeGrouping === "week") {
      const end = addDaysUTC(start, 6);
      return `${formatDateShort(start)} al ${formatDateShort(end)}`;
    }
    return formatDateShort(start);
  };

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

  const getSemaforoColor = (colorKey) => {
    const key = String(colorKey || "").trim().toLowerCase();
    if (key === "verde") return "#16a34a";
    if (key === "amarillo") return "#eab308";
    if (key === "naranja") return "#f97316";
    if (key === "rojo") return "#dc2626";
    if (key === "gris") return "#9ca3af";
    return "#94a3b8";
  };

  const getBarItemColor = (index) => {
    const colors = ["#111827", "#2563eb", "#16a34a", "#f97316", "#a855f7"];
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
          <span style={statChip}>Total informes: {kpis.total_informes ?? 0}</span>
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
              Vista base sin geometria (solo vinculaciones).
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
          visible={showSubmapa}
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
            Agrupacion: {groupingLabel}
            <button
              type="button"
              onClick={resetAppliedTimeGrouping}
              title="Volver a Semana"
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
                >
                  <option value="day">Dia</option>
                  <option value="week">Semana</option>
                  <option value="month">Mes</option>
                </select>
              </div>
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
                    style={{
                      border: "none",
                      outline: "none",
                      fontSize: 13,
                      background: "transparent",
                    }}
                  />
                </div>
              </div>
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

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Resumen de configuracion aplicada
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(appliedFiltersSummary || []).map((t, idx) => (
            <Badge key={`f-${idx}`} bg="secondary">
              {t}
            </Badge>
          ))}
          {(appliedFieldLabels || []).map((t, idx) => (
            <Badge key={`c-${idx}`} bg="light" text="dark">
              {t}
            </Badge>
          ))}
          {!appliedFiltersSummary?.length && !appliedFieldLabels?.length ? (
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              No hay configuracion aplicada.
            </span>
          ) : null}
        </div>
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
          <b>{groupingLabel}</b> · Total del rango: <b>{temporalRangeTotal}</b>
        </div>

        {!temporalEnabled || temporalSeries.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No hay datos temporales disponibles para el rango actual.
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
              const percent = Number(row.percent_of_range || 0);
              const width = temporalRangeTotal > 0 ? (count / temporalRangeTotal) * 100 : 0;
              const isActive = isTemporalBucketActive(row, temporal?.time_grouping);
              return (
                <div
                  key={row.key || row.label}
                  onClick={() => applyTemporalBucket(row, temporal?.time_grouping)}
                  style={{
                    border: isActive ? "1px solid #111827" : "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 10,
                    background: isActive ? "#eef2ff" : "#f8fafc",
                    cursor: "pointer",
                    boxShadow: isActive
                      ? "inset 0 0 0 1px rgba(17,24,39,0.08)"
                      : "none",
                  }}
                  title="Aplicar este rango al dashboard"
                >
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    {formatTemporalLabel(row)}
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
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{count}</span>
                    {showPercentages ? (
                      <span style={{ color: "#6b7280" }}>{percent.toFixed(2)}%</span>
                    ) : null}
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
              const totalItems = items.reduce((acc, it) => acc + (Number(it.count) || 0), 0);
              const hasActiveInteractiveSelection = items.some((it) =>
                isInteractiveValueActive(fs.id_pregunta, it.label || "(sin valor)")
              );
              const activeInteractiveValues = getInteractiveValuesForField(fs.id_pregunta);
              const hasInteractiveValues = activeInteractiveValues.length > 0;
              const pctLabel = (count) =>
                totalItems > 0 ? `${((Number(count || 0) / totalItems) * 100).toFixed(1)}%` : "0.0%";
              return (
                <div
                  key={fs.id_pregunta}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fff",
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

                  {isCounts && chartType === "list" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((it, idx) => {
                        const isActive = isInteractiveValueActive(
                          fs.id_pregunta,
                          it.label || "(sin valor)"
                        );
                        return (
                        <div
                          key={`${fs.id_pregunta}-l-${idx}`}
                          style={{
                            border: isActive ? "1px solid #111827" : "1px solid transparent",
                            background: isActive ? "#f3f4f6" : "transparent",
                            borderRadius: 10,
                            padding: "4px 6px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              display: "flex",
                              justifyContent: "space-between",
                              cursor: "pointer",
                              color: isActive ? "#111827" : "#374151",
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
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700 }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isCounts && chartType === "bar" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((it, idx) => {
                        const isActive = isInteractiveValueActive(
                          fs.id_pregunta,
                          it.label || "(sin valor)"
                        );
                        const baseColor = getBarItemColor(idx);
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
                              display: "flex",
                              justifyContent: "space-between",
                              cursor: "pointer",
                              color: isActive ? "#111827" : "#374151",
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
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700 }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
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
                              style={{
                                height: "100%",
                                width:
                                  kpis.total_informes
                                    ? `${Math.min(
                                        100,
                                        (it.count / (kpis.total_informes || 1)) * 100
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
                              }}
                            />
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isCounts && chartType === "traffic" ? (
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
                                const baseColor = getSemaforoColor(it.color_key);
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
                                    gridTemplateColumns: "14px 1fr auto",
                                    gap: 8,
                                    alignItems: "center",
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
                                      background: getSemaforoColor(it.color_key),
                                      boxShadow: isInteractiveValueActive(
                                        fs.id_pregunta,
                                        it.label || "(sin valor)"
                                      )
                                        ? "0 0 0 2px rgba(17,24,39,0.28)"
                                        : "inset 0 0 0 1px rgba(17,24,39,0.08)",
                                    }}
                                  />
                                  <span style={{ color: "#111827", fontWeight: 600 }}>
                                    {it.label || "(sin valor)"}
                                  </span>
                                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                                    {it.count}
                                    {showPercentages
                                      ? ` (${((Number(it.count || 0) / total) * 100).toFixed(1)}%)`
                                      : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}

                  {isCounts && chartType === "donut" ? (
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
                        const donutItems = items.slice(0, 5);
                        const total = donutItems.reduce((acc, it) => acc + (it.count || 0), 0) || 1;
                        const colors = ["#111827", "#2563eb", "#16a34a", "#f97316", "#a855f7"];
                        let acc = 0;
                        const stops = donutItems.map((it, idx) => {
                          const pct = (it.count || 0) / total;
                          const start = acc;
                          acc += pct;
                          const baseColor = colors[idx % colors.length];
                          const isActive = isInteractiveValueActive(
                            fs.id_pregunta,
                            it.label || "(sin valor)"
                          );
                          const color = getActiveTone(
                            baseColor,
                            isActive,
                            hasActiveInteractiveSelection
                          );
                          return `${color} ${Math.round(start * 360)}deg ${Math.round(acc * 360)}deg`;
                        });
                        return (
                          <div
                            style={{
                              width: 110,
                              height: 110,
                              borderRadius: "50%",
                              background: `conic-gradient(${stops.join(", ")})`,
                              position: "relative",
                              display: "grid",
                              placeItems: "center",
                              boxShadow: hasActiveInteractiveSelection
                                ? "inset 0 0 0 2px rgba(17,24,39,0.08)"
                                : "none",
                            }}
                            title={`Total: ${total}`}
                          >
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
                        {items.slice(0, 5).map((it, idx) => (
                          <div
                            key={`${fs.id_pregunta}-d-${idx}`}
                            data-active={isInteractiveValueActive(
                              fs.id_pregunta,
                              it.label || "(sin valor)"
                            )}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              marginBottom: 4,
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
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {isText ? (
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      <div>Con respuesta: {fs.non_empty_count ?? 0}</div>
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
                ) : (
                  <select
                    value={selectedPlantillaId || ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSelectedPlantillaId(Number.isFinite(v) && v > 0 ? v : null);
                    }}
                  >
                    <option value="">-- Seleccionar plantilla --</option>
                    {plantillas.map((p) => (
                      <option key={p.id_plantilla} value={p.id_plantilla}>
                        {p.nombre || `Plantilla #${p.id_plantilla}`}
                      </option>
                    ))}
                  </select>
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
                >
                  {availableTemporalSources.map((src) => (
                    <option key={String(src.id)} value={String(src.id)}>
                      {src.label}
                    </option>
                  ))}
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
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Resultados del dashboard
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Seleccionados: {selectedFieldIds.size}
              </div>
              <ul style={{ marginTop: 6 }}>
                {groupedAvailableFields.results.map((f) => renderFieldRow(f, "results"))}
              </ul>
            </div>
          ) : null}

          {selectedPlantillaId && groupedAvailableFields.filterOnly.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Filtros del dashboard
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Seleccionados:{" "}
                {
                  groupedAvailableFields.filterOnly.filter((f) =>
                    selectedFilterFieldIds.has(f.id_pregunta)
                  ).length
                }
              </div>
              <ul style={{ marginTop: 6 }}>
                {groupedAvailableFields.filterOnly.map((f) => renderFieldRow(f, "filter"))}
              </ul>
            </div>
          ) : null}

          {selectedPlantillaId && availableSearchFields.length > 0 ? (
            <div style={{ marginBottom: 18, ...panelStyle }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Busqueda textual
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Estos campos se usan para la busqueda del subheader.
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Seleccionados: {searchFieldIds.size}
              </div>
              <ul style={{ marginTop: 6 }}>
                {availableSearchFields.map((f) => renderFieldRow(f, "search"))}
              </ul>
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
