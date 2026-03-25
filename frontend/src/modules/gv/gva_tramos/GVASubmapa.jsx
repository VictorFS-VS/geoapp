import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GVAMapBase from "../components/GVAMapBase";
import GVAMapDataLayer from "../components/GVAMapDataLayer";
import GVAMapLayerSelector from "../components/GVAMapLayerSelector";
import GVAMapPointLayer from "../components/GVAMapPointLayer";
import InformeModal from "../../../components/InformeModal";
import {
  fetchInformeDetalle,
  resolveInformeFotoUrl,
} from "./services/gvaTramosService";

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toIdString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getTramoIdFromProps(props = {}) {
  return (
    props?.id_tramo ??
    props?.ID_TRAMO ??
    props?.idTramo ??
    props?.IDTRAMO ??
    props?.tramo_id ??
    props?.TRAMO_ID ??
    props?.gid_tramo ??
    props?.GID_TRAMO ??
    props?.gid ??
    props?.GID ??
    props?.id ??
    props?.ID ??
    null
  );
}

function getProgresivaIdFromProps(props = {}) {
  return (
    props?.id_progresiva ??
    props?.ID_PROGRESIVA ??
    props?.id_bloque ??
    props?.ID_BLOQUE ??
    props?.id ??
    props?.ID ??
    null
  );
}

function asFeatureCollection(fc) {
  if (fc?.type === "FeatureCollection" && Array.isArray(fc.features)) {
    return fc;
  }
  return { type: "FeatureCollection", features: [] };
}

function buildBoundsFromFeatureCollection(google, fc) {
  if (!google?.maps?.LatLngBounds) return null;
  const bounds = new google.maps.LatLngBounds();
  let hasAny = false;

  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      const lng = Number(node[0]);
      const lat = Number(node[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        bounds.extend({ lat, lng });
        hasAny = true;
      }
      return;
    }
    for (const child of node) walk(child);
  };

  for (const feature of fc?.features || []) {
    walk(feature?.geometry?.coordinates);
  }

  return hasAny ? bounds : null;
}

function buildBoundsFromPoints(google, points = []) {
  if (!google?.maps?.LatLngBounds) return null;
  const bounds = new google.maps.LatLngBounds();
  let hasAny = false;

  for (const point of points) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    bounds.extend({ lat, lng });
    hasAny = true;
  }

  return hasAny ? bounds : null;
}

function getBoundsSignature(bounds) {
  if (!bounds) return "";
  try {
    const ne = bounds.getNorthEast?.();
    const sw = bounds.getSouthWest?.();
    if (!ne || !sw) return "";
    return [
      Number(sw.lat?.() ?? 0).toFixed(6),
      Number(sw.lng?.() ?? 0).toFixed(6),
      Number(ne.lat?.() ?? 0).toFixed(6),
      Number(ne.lng?.() ?? 0).toFixed(6),
    ].join("|");
  } catch {
    return "";
  }
}

function combineBounds(google, boundsList = []) {
  if (!google?.maps?.LatLngBounds) return null;
  const bounds = new google.maps.LatLngBounds();
  let hasAny = false;

  for (const item of boundsList) {
    if (!item) continue;
    try {
      const ne = item.getNorthEast?.();
      const sw = item.getSouthWest?.();
      if (!ne || !sw) continue;
      bounds.extend(sw);
      bounds.extend(ne);
      hasAny = true;
    } catch {}
  }

  return hasAny ? bounds : null;
}

function findFeatureLabel(fc, id, kind) {
  const target = toIdString(id);
  if (!target) return "";
  for (const feature of fc?.features || []) {
    const props = feature?.properties || {};
    const rawId = kind === "tramo" ? getTramoIdFromProps(props) : getProgresivaIdFromProps(props);
    if (toIdString(rawId) !== target) continue;
    return (
      props?.label ||
      props?.tramo_nombre ||
      props?.tramo_desc ||
      props?.name ||
      props?.descripcion ||
      `${kind} ${target}`
    );
  }
  return "";
}

function featureCollectionLooksWgs84(fc, sampleSize = 30) {
  const feats = fc?.features || [];
  const limit = Math.min(feats.length, sampleSize);
  for (let i = 0; i < limit; i += 1) {
    const geom = feats[i]?.geometry;
    if (!geom?.coordinates) return false;
    const coords = geom.coordinates;
    if (geom.type === "Point") {
      if (!Array.isArray(coords) || coords.length < 2) return false;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    }
  }
  return true;
}

function toProgresivasPoints(fc) {
  const feats = fc?.features || [];
  const points = [];
  for (let i = 0; i < feats.length; i += 1) {
    const feature = feats[i];
    const geom = feature?.geometry;
    if (!geom || geom.type !== "Point") continue;
    const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
    if (coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const props = feature?.properties || {};
    const id =
      props?.id_bloque ??
      props?.id ??
      props?.ID ??
      props?.gid ??
      props?.GID ??
      i + 1;
    points.push({
      id,
      lat,
      lng,
      nombre: props?.name || props?.nombre || props?.label || "Progresiva",
      descripcion: props?.descripcion || props?.description || "",
    });
  }
  return points;
}

export default function GVASubmapa({
  loading,
  error,
  data,
  onRetry,
  tramosGeo,
  progresivasGeo,
  geometryLoading,
  geometryError,
  selectedMapKpiId = null,
  selectedMapKpiLabel = "",
  visible = true,
}) {
  const [activeKey, setActiveKey] = useState("");
  const [selectedInformeId, setSelectedInformeId] = useState(null);
  const [showInformeModal, setShowInformeModal] = useState(false);
  const [informePopupCache, setInformePopupCache] = useState({});
  const [popupPhotoIndexByInforme, setPopupPhotoIndexByInforme] = useState({});
  const [showInformes, setShowInformes] = useState(true);
  const [showTramos, setShowTramos] = useState(false);
  const [showProgresivas, setShowProgresivas] = useState(false);
  const mapRef = useRef(null);
  const googleRef = useRef(null);
  const lastFitKeyRef = useRef("");
  const lastTramosBoundsSignatureRef = useRef("");
  const autoInitializedTramosRef = useRef(false);
  const informePopupInflightRef = useRef(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [mapShellError, setMapShellError] = useState("");
  const [tramosBounds, setTramosBounds] = useState(null);
  const [mapTypeId, setMapTypeId] = useState("roadmap");

  const submapa = data?.submapa || {};
  const informesPoints = safeArray(data?.informes_points);
  const tramos = safeArray(submapa.tramos);
  const progresivas = safeArray(submapa.progresivas);
  const selection = submapa.selection_summary || {};
  const baseTramosGeo = useMemo(() => asFeatureCollection(tramosGeo), [tramosGeo]);
  const baseProgresivasGeo = useMemo(
    () => asFeatureCollection(progresivasGeo),
    [progresivasGeo]
  );

  const progresivasWgs84Ok = useMemo(
    () =>
      baseProgresivasGeo.features.length
        ? featureCollectionLooksWgs84(baseProgresivasGeo)
        : true,
    [baseProgresivasGeo]
  );

  const progresivasPoints = useMemo(() => {
    if (!progresivasWgs84Ok) {
      if (import.meta.env.DEV) {
        console.warn(
          "[gva_tramos] Progresivas ignoradas: GeoJSON no parece estar en EPSG:4326."
        );
      }
      return [];
    }
    return toProgresivasPoints(baseProgresivasGeo);
  }, [baseProgresivasGeo, progresivasWgs84Ok]);

  const selectionSummary = useMemo(
    () => ({
      tramo_ids: safeArray(selection.tramo_ids),
      progresiva_ids: safeArray(selection.progresiva_ids),
      subtramo_ids: safeArray(selection.subtramo_ids),
    }),
    [selection]
  );

  const tramoFeatureIdSet = useMemo(() => {
    const set = new Set();
    for (const feature of baseTramosGeo.features) {
      const key = toIdString(getTramoIdFromProps(feature?.properties || {}));
      if (key) set.add(key);
    }
    return set;
  }, [baseTramosGeo]);

  const progresivaFeatureIdSet = useMemo(() => {
    const set = new Set();
    for (const feature of baseProgresivasGeo.features) {
      const key = toIdString(getProgresivaIdFromProps(feature?.properties || {}));
      if (key) set.add(key);
    }
    return set;
  }, [baseProgresivasGeo]);

  const visibleTramosGeo = useMemo(
    () => (showTramos ? baseTramosGeo : { type: "FeatureCollection", features: [] }),
    [baseTramosGeo, showTramos]
  );

  const activeTramoIds = useMemo(
    () => (activeKey.startsWith("tramo:") ? [activeKey.split(":")[1]] : []),
    [activeKey]
  );

  const tramoDefaultStyle = useMemo(
    () => ({
      strokeColor: "#1d4ed8",
      strokeOpacity: 0.9,
      strokeWeight: 3,
      fillColor: "#93c5fd",
      fillOpacity: 0.24,
      clickable: true,
    }),
    []
  );

  const tramoActiveStyle = useMemo(
    () => ({
      strokeColor: "#1e3a8a",
      strokeOpacity: 1,
      strokeWeight: 5,
      fillColor: "#60a5fa",
      fillOpacity: 0.38,
    }),
    []
  );

  const linkedTramosCount = tramos.length;
  const linkedProgresivasCount = progresivas.length;
  const linkedSubtramosCount = selectionSummary.subtramo_ids.length;
  const availableInformesCount = informesPoints.length;
  const availableTramosCount = baseTramosGeo.features.length;
  const availableProgresivasCount = progresivasPoints.length;

  const renderedTramosCount = visibleTramosGeo.features.length;
  const renderedProgresivasCount = showProgresivas ? progresivasPoints.length : 0;
  const renderedInformesCount = showInformes ? informesPoints.length : 0;

  const hasResults =
    informesPoints.length > 0 ||
    baseTramosGeo.features.length > 0 ||
    baseProgresivasGeo.features.length > 0 ||
    linkedTramosCount > 0 ||
    linkedProgresivasCount > 0 ||
    linkedSubtramosCount > 0;

  const hasLinkedLayers =
    linkedTramosCount > 0 || linkedProgresivasCount > 0 || linkedSubtramosCount > 0;

  const hasAnyGeometry =
    baseTramosGeo.features.length > 0 ||
    progresivasPoints.length > 0 ||
    informesPoints.length > 0;

  const hasVisibleGeometry =
    renderedTramosCount > 0 || renderedProgresivasCount > 0 || renderedInformesCount > 0;

  const containerStyle = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 12,
    background: "#ffffff",
    marginTop: 12,
    display: visible ? "block" : "none",
  };

  const chipStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid #dbe3ee",
    background: "#ffffff",
    fontSize: 11,
    fontWeight: 700,
    color: "#334155",
  };

  const clearSelection = () => setActiveKey("");
  const getTramoFeatureId = useCallback((props) => getTramoIdFromProps(props), []);

  const handleTramoFeatureClick = useCallback(({ id }) => {
    if (!id) return;
    setActiveKey((prev) => (prev === `tramo:${id}` ? "" : `tramo:${id}`));
  }, []);

  const handleInformePointClick = useCallback((point) => {
    const id = Number(point?.id_informe);
    if (!id) return;
    setActiveKey((prev) => (prev === `informe:${id}` ? "" : `informe:${id}`));
  }, []);

  const getInformePointInfo = useCallback((point) => {
    return {
      id: Number(point?.id_informe),
      lat: point?.lat,
      lng: point?.lng,
      title: point?.titulo || `Informe #${point?.id_informe}`,
      color:
        String(point?.map_kpi_color_hex || "").trim() ||
        point?.semaforo_color ||
        "#16a34a",
      rows: [
        ["ID", `#${point?.id_informe ?? "-"}`],
        ["Fecha", point?.fecha_creado ? String(point.fecha_creado).slice(0, 10) : "-"],
        point?.map_kpi_field_label && point?.map_kpi_value_label
          ? [point.map_kpi_field_label, point.map_kpi_value_label]
          : null,
        point?.summary_text
          ? [point?.summary_label || "Resumen", point.summary_text]
          : null,
      ].filter(Boolean),
      actionLabel: "Ver informe completo",
    };
  }, []);

  const ensureInformePopupData = useCallback(async (point) => {
    const idInforme = Number(point?.id_informe);
    if (!idInforme) return;

    const cached = informePopupCache[idInforme];
    if (cached?.loaded || cached?.loading) return;

    if (informePopupInflightRef.current.has(idInforme)) {
      return informePopupInflightRef.current.get(idInforme);
    }

    setInformePopupCache((prev) => ({
      ...prev,
      [idInforme]: {
        loaded: false,
        loading: true,
        error: "",
        photos: prev?.[idInforme]?.photos || [],
      },
    }));

    const promise = fetchInformeDetalle(idInforme)
      .then((payload) => {
        const fotos = safeArray(payload?.fotos).map((foto, index) => ({
          id: Number(foto?.id_foto ?? foto?.id ?? index + 1),
          ruta_archivo: foto?.ruta_archivo || "",
          descripcion: foto?.descripcion || "",
          url: resolveInformeFotoUrl(foto?.ruta_archivo),
        }));

        setInformePopupCache((prev) => ({
          ...prev,
          [idInforme]: {
            loaded: true,
            loading: false,
            error: "",
            photos: fotos,
          },
        }));

        setPopupPhotoIndexByInforme((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, idInforme)) return prev;
          return { ...prev, [idInforme]: 0 };
        });
      })
      .catch((err) => {
        setInformePopupCache((prev) => ({
          ...prev,
          [idInforme]: {
            loaded: true,
            loading: false,
            error: String(err?.message || err || "No se pudieron cargar las fotos."),
            photos: [],
          },
        }));
      })
      .finally(() => {
        informePopupInflightRef.current.delete(idInforme);
      });

    informePopupInflightRef.current.set(idInforme, promise);
    return promise;
  }, [informePopupCache]);

  const handleOpenInforme = useCallback(
    (point) => {
      const idInforme = Number(point?.id_informe);
      if (!idInforme) return;
      setSelectedInformeId(idInforme);
      setShowInformeModal(true);
    },
    []
  );

  const handleMapReady = useCallback(({ map, google, ready, error: shellError }) => {
    mapRef.current = map || null;
    googleRef.current = google || null;
    setMapReady(!!ready && !!map && !!google);
    setMapShellError(String(shellError || ""));
  }, []);

  const handleTramosBounds = useCallback((bounds) => {
    const signature = getBoundsSignature(bounds);
    if (signature === lastTramosBoundsSignatureRef.current) return;
    lastTramosBoundsSignatureRef.current = signature;
    setTramosBounds(bounds || null);
  }, []);

  const layerItems = useMemo(
    () => [
      {
        key: "informes",
        label: "Informes",
        visible: showInformes,
        enabled: informesPoints.length > 0,
        count: availableInformesCount,
      },
      {
        key: "tramos",
        label: "Tramos",
        visible: showTramos,
        enabled: baseTramosGeo.features.length > 0,
        count: availableTramosCount,
      },
      {
        key: "progresivas",
        label: "Progresivas",
        visible: showProgresivas,
        enabled: progresivasPoints.length > 0,
        count: availableProgresivasCount,
      },
    ],
    [
      showInformes,
      showTramos,
      showProgresivas,
      informesPoints.length,
      baseTramosGeo.features.length,
      progresivasPoints.length,
      availableInformesCount,
      availableTramosCount,
      availableProgresivasCount,
    ]
  );

  const handleToggleLayer = useCallback((layerKey) => {
    if (layerKey === "informes") {
      setShowInformes((prev) => !prev);
      return;
    }
    if (layerKey === "tramos") {
      setShowTramos((prev) => !prev);
      return;
    }
    if (layerKey === "progresivas") {
      setShowProgresivas((prev) => !prev);
    }
  }, []);

  const mapStatus = mapShellError
    ? { tone: "#6b7280", text: mapShellError }
    : geometryError
    ? { tone: "#b91c1c", text: geometryError }
    : geometryLoading
    ? { tone: "#6b7280", text: "Cargando geometria base del proyecto..." }
    : !hasAnyGeometry
    ? {
        tone: "#6b7280",
        text: "No hay elementos georreferenciados disponibles para esta vista.",
      }
    : !hasVisibleGeometry
    ? {
        tone: "#6b7280",
        text: "Las capas activas no tienen elementos para mostrar.",
      }
    : null;

  const activeLabel = useMemo(() => {
    if (!activeKey) return "";
    const [kind, id] = activeKey.split(":");
    if (kind === "informe") {
      const match = informesPoints.find((point) => String(point?.id_informe) === String(id));
      return match?.titulo || `Informe #${id}`;
    }
    if (kind === "tramo") {
      return findFeatureLabel(baseTramosGeo, id, "tramo") || `Tramo ${id}`;
    }
    if (kind === "progresiva") {
      return findFeatureLabel(baseProgresivasGeo, id, "progresiva") || `Progresiva ${id}`;
    }
    return `${kind} ${id}`;
  }, [activeKey, informesPoints, baseTramosGeo, baseProgresivasGeo]);

  const getInformePopupState = useCallback((point) => {
    const idInforme = Number(point?.id_informe);
    if (!idInforme) return { loadingPhotos: false, photos: [], photosError: "" };
    const cached = informePopupCache[idInforme];
    return {
      loadingPhotos: !!cached?.loading,
      photosError: cached?.error || "",
      photos: safeArray(cached?.photos),
      activePhotoIndex: popupPhotoIndexByInforme[idInforme] || 0,
    };
  }, [informePopupCache, popupPhotoIndexByInforme]);

  const handleSelectInformePopupPhoto = useCallback((point, index) => {
    const idInforme = Number(point?.id_informe);
    const photoIndex = Number(index);
    if (!idInforme || !Number.isFinite(photoIndex) || photoIndex < 0) return;
    setPopupPhotoIndexByInforme((prev) => ({ ...prev, [idInforme]: photoIndex }));
  }, []);

  const toolbarContent = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        padding: 8,
        borderRadius: 12,
        background: "rgba(255,255,255,0.94)",
        border: "1px solid rgba(219, 227, 238, 0.95)",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <GVAMapLayerSelector layers={layerItems} onToggleLayer={handleToggleLayer} compact />
      {activeKey ? (
        <button
          type="button"
          onClick={clearSelection}
          style={{
            border: "1px solid #e5e7eb",
            background: "#ffffff",
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Limpiar seleccion
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setMapTypeId((prev) => (prev === "roadmap" ? "hybrid" : "roadmap"))}
        style={{
          border: "1px solid #e5e7eb",
          background: "#ffffff",
          borderRadius: 999,
          padding: "5px 12px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: mapTypeId === "hybrid" ? "#1d4ed8" : "#334155",
          borderColor: mapTypeId === "hybrid" ? "#bfdbfe" : "#e5e7eb",
        }}
        title="Cambiar tipo de mapa"
      >
        {mapTypeId === "hybrid" ? "Satélite activo" : "Ver satélite"}
      </button>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            border: "1px solid #e5e7eb",
            background: "#ffffff",
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );

  const overlayTopContent = mapStatus ? (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.94)",
        border: "1px solid rgba(219, 227, 238, 0.95)",
        color: mapStatus.tone,
        fontSize: 12,
        fontWeight: 700,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      {mapStatus.text}
    </div>
  ) : null;

  const activeMapKpiLegend = useMemo(() => {
    if (!selectedMapKpiId) return [];

    const grouped = new Map();
    for (const point of informesPoints) {
      const pointFieldId = Number(point?.map_kpi_field_id);
      if (!pointFieldId || pointFieldId !== Number(selectedMapKpiId)) continue;

      const colorHex = String(point?.map_kpi_color_hex || "").trim();
      const colorKey = String(point?.map_kpi_color_key || "").trim().toLowerCase();
      const valueLabel = String(point?.map_kpi_value_label || "").trim();
      const legendItem =
        point?.map_kpi_legend_item && typeof point.map_kpi_legend_item === "object"
          ? point.map_kpi_legend_item
          : null;

      const finalLabel =
        String(
          legendItem?.label || valueLabel || point?.map_kpi_field_label || "Sin dato"
        ).trim() || "Sin dato";
      const finalColorHex =
        String(legendItem?.color_hex || colorHex || "").trim() || "#9ca3af";
      const finalColorKey =
        String(legendItem?.color_key || colorKey || finalLabel).trim().toLowerCase() || "sin-dato";

      const groupKey = finalColorKey || finalLabel.toLowerCase() || finalColorHex.toLowerCase();
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          label: finalLabel,
          colorHex: finalColorHex,
          count: 0,
        });
      }
      grouped.get(groupKey).count += 1;
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "es");
    });
  }, [informesPoints, selectedMapKpiId]);

  const overlayBottomContent = (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        padding: 8,
        borderRadius: 12,
        background: "rgba(255,255,255,0.94)",
        border: "1px solid rgba(219, 227, 238, 0.95)",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <span style={chipStyle}>
        Disponibles: {availableInformesCount} informes / {availableTramosCount} tramos /{" "}
        {availableProgresivasCount} progresivas
      </span>
      <span style={chipStyle}>
        Visibles: {renderedInformesCount} informes / {renderedTramosCount} tramos /{" "}
        {renderedProgresivasCount} progresivas
      </span>
      {hasLinkedLayers ? (
        <span style={chipStyle}>
          Linkage: {selectionSummary.tramo_ids.length} tramos /{" "}
          {selectionSummary.progresiva_ids.length} progresivas /{" "}
          {selectionSummary.subtramo_ids.length} subtramos
        </span>
      ) : (
        <span style={chipStyle}>Sin linkage resuelto: se muestran capas base del proyecto</span>
      )}
      {activeKey ? (
        <span style={{ ...chipStyle, background: "#eef2ff", borderColor: "#c7d2fe" }}>
          Activo: {activeLabel}
        </span>
      ) : null}
      {selectedMapKpiId && activeMapKpiLegend.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            width: "100%",
          }}
        >
          <span style={{ ...chipStyle, background: "#eff6ff", borderColor: "#bfdbfe" }}>
            KPI mapa: {selectedMapKpiLabel || "KPI seleccionado"}
          </span>
          {activeMapKpiLegend.map((item) => (
            <span
              key={`kpi-legend-${item.key}`}
              style={{ ...chipStyle, gap: 8 }}
              title={`${item.label}: ${item.count}`}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "999px",
                  background: item.colorHex,
                  boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.12)",
                  flex: "0 0 auto",
                }}
              />
              <span>
                {item.label} · {item.count}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  useEffect(() => {
    return () => {
      mapRef.current = null;
      googleRef.current = null;
    };
  }, []);

  useEffect(() => {
    autoInitializedTramosRef.current = false;
    setShowInformes(true);
    setShowTramos(false);
    setShowProgresivas(false);
  }, [data?.id_proyecto]);

  useEffect(() => {
    if (autoInitializedTramosRef.current) return;
    if (geometryLoading) return;
    autoInitializedTramosRef.current = true;
    if (availableTramosCount > 0) {
      setShowTramos(true);
    }
  }, [geometryLoading, availableTramosCount]);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!visible || !mapReady || !map || !google) return;

    const fitKey = JSON.stringify({
      showInformes,
      showTramos,
      showProgresivas,
      tramosBounds: showTramos ? getBoundsSignature(tramosBounds) : "",
      informesBounds: showInformes
        ? informesPoints
            .map((point) => `${point?.id_informe}:${point?.lat}:${point?.lng}`)
            .join("|")
        : "",
      informes: renderedInformesCount,
      tramos: renderedTramosCount,
      progresivas: renderedProgresivasCount,
    });

    if (fitKey === lastFitKeyRef.current) return;

    const featureBounds = combineBounds(google, [showTramos ? tramosBounds : null]);
    const pointBounds = showInformes ? buildBoundsFromPoints(google, informesPoints) : null;

    if (featureBounds) {
      map.fitBounds(featureBounds);
      lastFitKeyRef.current = fitKey;
      return;
    }

    if (pointBounds) {
      map.fitBounds(pointBounds);
      lastFitKeyRef.current = fitKey;
    }
  }, [
    visible,
    mapReady,
    showInformes,
    showTramos,
    showProgresivas,
    tramosBounds,
    informesPoints,
    renderedInformesCount,
    renderedTramosCount,
    renderedProgresivasCount,
  ]);

  useEffect(() => {
    if (!activeKey) return;
    const [kind, id] = activeKey.split(":");
    if (!kind || !id) return;

    if (kind === "tramo" && !tramoFeatureIdSet.has(id)) {
      setActiveKey("");
      return;
    }
    if (kind === "progresiva" && !progresivaFeatureIdSet.has(id)) {
      setActiveKey("");
      return;
    }
    if (kind === "informe") {
      const has = informesPoints.some((point) => String(point?.id_informe) === id);
      if (!has) setActiveKey("");
    }
  }, [activeKey, tramoFeatureIdSet, progresivaFeatureIdSet, informesPoints]);

  return (
    <div style={containerStyle}>
      {loading ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Cargando vinculaciones...
        </div>
      ) : error ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>{error}</div>
      ) : !hasResults ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          No hay vinculaciones disponibles para el submapa.
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              height: 500,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <GVAMapBase
              height="100%"
              initialCenter={{ lat: -25.3, lng: -57.6 }}
              initialZoom={8}
              mapTypeId={mapTypeId}
              fullscreenEnabled
              toolbar={toolbarContent}
              overlayTop={overlayTopContent}
              overlayBottom={overlayBottomContent}
              onReady={handleMapReady}
            >
              {({ map, google, ready }) =>
                ready && map && google ? (
                  <>
                    <GVAMapDataLayer
                      map={map}
                      google={google}
                      data={visibleTramosGeo}
                      visible={showTramos}
                      getFeatureId={getTramoFeatureId}
                      activeIds={activeTramoIds}
                      defaultStyle={tramoDefaultStyle}
                      activeStyle={tramoActiveStyle}
                      onFeatureClick={handleTramoFeatureClick}
                      onDataBounds={handleTramosBounds}
                      zIndex={10}
                    />
                    <GVAMapPointLayer
                      map={map}
                      google={google}
                      points={progresivasPoints}
                      visible={showProgresivas}
                      activeId={
                        activeKey.startsWith("progresiva:") ? activeKey.split(":")[1] : null
                      }
                      onPointClick={(point) => {
                        const id = Number(point?.id);
                        if (!id) return;
                        setActiveKey((prev) => (prev === `progresiva:${id}` ? "" : `progresiva:${id}`));
                      }}
                      showLabel
                      labelMinZoom={16}
                      labelOffsetX={14}
                      labelOffsetY={-8}
                      activeLabelOnly={false}
                      getPointInfo={(point) => ({
                        id: point?.id,
                        lat: point?.lat,
                        lng: point?.lng,
                        title: point?.nombre || "Progresiva",
                        color: "#f97316",
                        rows: [
                          ["Nombre", point?.nombre || "-"],
                          ["Descripcion", point?.descripcion || "-"],
                        ],
                      })}
                      getPointLabel={(point) =>
                        point?.nombre ||
                        point?.label ||
                        point?.progresiva ||
                        point?.pk ||
                        "S/N"
                      }
                    />
                    <GVAMapPointLayer
                      map={map}
                      google={google}
                      points={informesPoints}
                      visible={showInformes}
                      activeId={
                        activeKey.startsWith("informe:") ? activeKey.split(":")[1] : null
                      }
                      onPointClick={handleInformePointClick}
                      onPopupOpen={ensureInformePopupData}
                      onOpenPoint={handleOpenInforme}
                      getPointPopupState={getInformePopupState}
                      onSelectPopupPhoto={handleSelectInformePopupPhoto}
                      getPointInfo={getInformePointInfo}
                    />
                  </>
                ) : null
              }
            </GVAMapBase>
          </div>
          <InformeModal
            show={showInformeModal}
            onHide={() => {
              setShowInformeModal(false);
              setSelectedInformeId(null);
            }}
            idInforme={selectedInformeId}
            mode="view"
          />
        </div>
      )}
    </div>
  );
}
