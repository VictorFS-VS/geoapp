import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import GVAMapBase from "../components/GVAMapBase";
import GVAMapDataLayer from "../components/GVAMapDataLayer";
import GVAMapLayerSelector from "../components/GVAMapLayerSelector";
import GVAMapPointLayer from "../components/GVAMapPointLayer";

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

function asFeatureCollection(fc, kind, ids) {
  if (!fc?.features || !Array.isArray(fc.features)) {
    return { type: "FeatureCollection", features: [] };
  }
  if (!ids || !ids.size) {
    return { type: "FeatureCollection", features: [] };
  }

  const filtered = fc.features.filter((feature) => {
    const props = feature?.properties || {};
    const rawId =
      kind === "tramo" ? getTramoIdFromProps(props) : getProgresivaIdFromProps(props);
    const id = toIdString(rawId);
    return id ? ids.has(id) : false;
  });

  return { type: "FeatureCollection", features: filtered };
}

function buildBoundsFromFeatureCollection(google, fc) {
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

export default function GVASubmapa({
  loading,
  error,
  data,
  onRetry,
  tramosGeo,
  progresivasGeo,
  geometryLoading,
  geometryError,
  visible = true,
}) {
  const navigate = useNavigate();
  const [activeKey, setActiveKey] = useState("");
  const [showTramos, setShowTramos] = useState(true);
  const [showProgresivas, setShowProgresivas] = useState(true);
  const mapRef = useRef(null);
  const googleRef = useRef(null);
  const lastFitKeyRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const [mapShellError, setMapShellError] = useState("");
  const [tramosBounds, setTramosBounds] = useState(null);
  const [progresivasBounds, setProgresivasBounds] = useState(null);

  const submapa = data?.submapa || {};
  const informesPoints = safeArray(data?.informes_points);
  const tramos = safeArray(submapa.tramos);
  const progresivas = safeArray(submapa.progresivas);
  const subtramos = safeArray(submapa.subtramos);
  const selection = submapa.selection_summary || {};

  const selectionSummary = useMemo(
    () => ({
      tramo_ids: safeArray(selection.tramo_ids),
      progresiva_ids: safeArray(selection.progresiva_ids),
      subtramo_ids: safeArray(selection.subtramo_ids),
    }),
    [selection]
  );

  const tramoIdSet = useMemo(() => {
    const set = new Set();
    for (const id of selectionSummary.tramo_ids) {
      const key = toIdString(id);
      if (key) set.add(key);
    }
    return set;
  }, [selectionSummary.tramo_ids]);

  const progresivaIdSet = useMemo(() => {
    const set = new Set();
    for (const id of selectionSummary.progresiva_ids) {
      const key = toIdString(id);
      if (key) set.add(key);
    }
    return set;
  }, [selectionSummary.progresiva_ids]);

  const filteredTramosGeo = useMemo(
    () => asFeatureCollection(tramosGeo, "tramo", tramoIdSet),
    [tramosGeo, tramoIdSet]
  );

  const filteredProgresivasGeo = useMemo(
    () => asFeatureCollection(progresivasGeo, "progresiva", progresivaIdSet),
    [progresivasGeo, progresivaIdSet]
  );

  const visibleTramosGeo = useMemo(
    () => (showTramos ? filteredTramosGeo : { type: "FeatureCollection", features: [] }),
    [filteredTramosGeo, showTramos]
  );

  const visibleProgresivasGeo = useMemo(
    () =>
      showProgresivas
        ? filteredProgresivasGeo
        : { type: "FeatureCollection", features: [] },
    [filteredProgresivasGeo, showProgresivas]
  );

  const hasResults =
    tramos.length > 0 ||
    progresivas.length > 0 ||
    subtramos.length > 0 ||
    informesPoints.length > 0;

  const renderedTramosCount = visibleTramosGeo.features.length;
  const renderedProgresivasCount = visibleProgresivasGeo.features.length;
  const renderedInformesCount = informesPoints.length;

  const hasAnyGeometry =
    filteredTramosGeo.features.length > 0 ||
    filteredProgresivasGeo.features.length > 0 ||
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

  const sectionTitleStyle = {
    fontSize: 12,
    fontWeight: 800,
    color: "#475569",
    marginBottom: 6,
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

  const itemStyle = (isActive) => ({
    border: isActive ? "1px solid #111827" : "1px solid #e5e7eb",
    background: isActive ? "#eef2ff" : "#f8fafc",
    borderRadius: 10,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  });

  const toggleActive = (kind, id) => {
    const key = `${kind}:${String(id)}`;
    setActiveKey((prev) => (prev === key ? "" : key));
  };

  const clearSelection = () => setActiveKey("");
  const getTramoFeatureId = useCallback((props) => getTramoIdFromProps(props), []);
  const getProgresivaFeatureId = useCallback((props) => getProgresivaIdFromProps(props), []);

  const handleTramoFeatureClick = useCallback(({ id }) => {
    if (!id) return;
    setActiveKey((prev) => (prev === `tramo:${id}` ? "" : `tramo:${id}`));
  }, []);

  const handleProgresivaFeatureClick = useCallback(({ id }) => {
    if (!id) return;
    setActiveKey((prev) => (prev === `progresiva:${id}` ? "" : `progresiva:${id}`));
  }, []);

  const handleInformePointClick = useCallback((point) => {
    const id = Number(point?.id_informe);
    if (!id) return;
    setActiveKey((prev) => (prev === `informe:${id}` ? "" : `informe:${id}`));
  }, []);

  const handleOpenInforme = useCallback(
    (point) => {
      const idInforme = Number(point?.id_informe);
      const idProyecto = Number(point?.id_proyecto);
      if (!idInforme || !idProyecto) return;
      navigate(`/proyectos/${idProyecto}/informes/${idInforme}/editar`);
    },
    [navigate]
  );

  const handleMapReady = useCallback(({ map, google, ready, error: shellError }) => {
    mapRef.current = map || null;
    googleRef.current = google || null;
    setMapReady(!!ready && !!map && !!google);
    setMapShellError(String(shellError || ""));
  }, []);

  const layerItems = useMemo(
    () => [
      {
        key: "tramos",
        label: "Tramos",
        visible: showTramos,
        enabled: filteredTramosGeo.features.length > 0,
        count: renderedTramosCount,
      },
      {
        key: "progresivas",
        label: "Progresivas",
        visible: showProgresivas,
        enabled: filteredProgresivasGeo.features.length > 0,
        count: renderedProgresivasCount,
      },
    ],
    [
      showTramos,
      showProgresivas,
      filteredTramosGeo.features.length,
      filteredProgresivasGeo.features.length,
      renderedTramosCount,
      renderedProgresivasCount,
    ]
  );

  const handleToggleLayer = useCallback((layerKey) => {
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
    ? { tone: "#6b7280", text: "Cargando geometria del submapa..." }
    : !hasAnyGeometry
    ? {
        tone: "#6b7280",
        text: "Hay vinculaciones, pero no hay geometria utilizable para renderizar.",
      }
    : !hasVisibleGeometry
    ? {
        tone: "#6b7280",
        text: "Las capas visibles no tienen geometria para mostrar.",
      }
    : null;

  const activeLabel = useMemo(() => {
    if (!activeKey) return "";
    const [kind, id] = activeKey.split(":");
    const collections = {
      tramo: tramos,
      progresiva: progresivas,
      subtramo: subtramos,
      informe: informesPoints,
    };
    const items = collections[kind] || [];
    const match = items.find((item) => {
      const itemId =
        item?.id_tramo ??
        item?.id_progresiva ??
        item?.id_subtramo ??
        item?.id_informe ??
        item?.id;
      return String(itemId) === String(id);
    });
    return match?.label || match?.titulo || match?.nombre || match?.descripcion || `${kind} ${id}`;
  }, [activeKey, tramos, progresivas, subtramos, informesPoints]);

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
      <span style={{ ...chipStyle, background: "#eff6ff", borderColor: "#bfdbfe" }}>
        Submapa de tramos
      </span>
      <span style={chipStyle}>Tramos: {renderedTramosCount}</span>
      <span style={chipStyle}>Progresivas: {renderedProgresivasCount}</span>
      <span style={chipStyle}>Informes: {renderedInformesCount}</span>
      <span style={chipStyle}>Subtramos: {selectionSummary.subtramo_ids.length}</span>
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
        Capas: {showTramos ? "Tramos" : "Sin tramos"} ·{" "}
        {showProgresivas ? "Progresivas" : "Sin progresivas"} · Informes
      </span>
      {activeKey ? (
        <span style={{ ...chipStyle, background: "#eef2ff", borderColor: "#c7d2fe" }}>
          Activo: {activeLabel}
        </span>
      ) : null}
    </div>
  );

  const renderList = (items, kind, emptyLabel) => {
    if (!items.length) {
      return <div style={{ fontSize: 12, color: "#6b7280" }}>{emptyLabel}</div>;
    }
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.map((item) => {
          const id =
            item?.id_tramo ??
            item?.id_progresiva ??
            item?.id_subtramo ??
            item?.id_informe ??
            item?.id;
          const label =
            item?.label ||
            item?.titulo ||
            item?.nombre ||
            item?.descripcion ||
            `Item ${String(id || "")}`;
          const isActive = activeKey === `${kind}:${String(id)}`;
          return (
            <button
              key={`${kind}-${id}-${label}`}
              type="button"
              onClick={() => toggleActive(kind, id)}
              style={itemStyle(isActive)}
              title={label}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    return () => {
      mapRef.current = null;
      googleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const google = googleRef.current;
    if (!visible || !mapReady || !map || !google) return;

    const fitKey = JSON.stringify({
      tramoIds: showTramos ? selectionSummary.tramo_ids : [],
      progresivaIds: showProgresivas ? selectionSummary.progresiva_ids : [],
      informeIds: informesPoints.map((point) => point?.id_informe).filter(Boolean),
    });

    if (fitKey !== lastFitKeyRef.current) {
      const bounds = buildBoundsFromFeatureCollection(google, {
        type: "FeatureCollection",
        features: [
          ...(tramosBounds ? visibleTramosGeo?.features || [] : []),
          ...(progresivasBounds ? visibleProgresivasGeo?.features || [] : []),
        ],
      });
      const pointBounds = buildBoundsFromPoints(google, informesPoints);

      if (bounds) {
        map.fitBounds(bounds);
        lastFitKeyRef.current = fitKey;
      } else if (pointBounds) {
        map.fitBounds(pointBounds);
        lastFitKeyRef.current = fitKey;
      }
    }
  }, [
    visibleTramosGeo,
    visibleProgresivasGeo,
    selectionSummary.tramo_ids,
    selectionSummary.progresiva_ids,
    showTramos,
    showProgresivas,
    visible,
    mapReady,
    tramosBounds,
    progresivasBounds,
    informesPoints,
  ]);

  useEffect(() => {
    if (!activeKey) return;
    const [kind, id] = activeKey.split(":");
    if (!kind || !id) return;

    if (kind === "tramo" && !tramoIdSet.has(id)) {
      setActiveKey("");
      return;
    }
    if (kind === "progresiva" && !progresivaIdSet.has(id)) {
      setActiveKey("");
      return;
    }
    if (kind === "subtramo") {
      const has = selectionSummary.subtramo_ids.map((v) => toIdString(v)).includes(id);
      if (!has) setActiveKey("");
      return;
    }
    if (kind === "informe") {
      const has = informesPoints.some((point) => String(point?.id_informe) === id);
      if (!has) setActiveKey("");
    }
  }, [activeKey, tramoIdSet, progresivaIdSet, selectionSummary.subtramo_ids, informesPoints]);

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
              height: 320,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#f8fafc",
              overflow: "hidden",
              position: "relative",
              marginBottom: 12,
            }}
          >
            <GVAMapBase
              height="100%"
              initialCenter={{ lat: -25.3, lng: -57.6 }}
              initialZoom={8}
              mapTypeId="roadmap"
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
                      activeIds={activeKey.startsWith("tramo:") ? [activeKey.split(":")[1]] : []}
                      defaultStyle={{
                        strokeColor: "#1d4ed8",
                        strokeOpacity: 0.9,
                        strokeWeight: 3,
                        fillColor: "#93c5fd",
                        fillOpacity: 0.35,
                        clickable: true,
                      }}
                      activeStyle={{
                        strokeColor: "#0f172a",
                        strokeWeight: 5,
                      }}
                      onFeatureClick={handleTramoFeatureClick}
                      onDataBounds={setTramosBounds}
                      zIndex={10}
                    />
                    <GVAMapDataLayer
                      map={map}
                      google={google}
                      data={visibleProgresivasGeo}
                      visible={showProgresivas}
                      getFeatureId={getProgresivaFeatureId}
                      activeIds={
                        activeKey.startsWith("progresiva:") ? [activeKey.split(":")[1]] : []
                      }
                      defaultStyle={{
                        strokeColor: "#f97316",
                        strokeOpacity: 0.9,
                        strokeWeight: 3,
                        fillColor: "#fdba74",
                        fillOpacity: 0.5,
                        clickable: true,
                      }}
                      activeStyle={{
                        strokeColor: "#7c2d12",
                        strokeWeight: 5,
                      }}
                      onFeatureClick={handleProgresivaFeatureClick}
                      onDataBounds={setProgresivasBounds}
                      zIndex={20}
                    />
                    <GVAMapPointLayer
                      map={map}
                      google={google}
                      points={informesPoints}
                      visible
                      activeId={activeKey.startsWith("informe:") ? activeKey.split(":")[1] : null}
                      onPointClick={handleInformePointClick}
                      onOpenPoint={handleOpenInforme}
                    />
                  </>
                ) : null
              }
            </GVAMapBase>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...chipStyle, fontSize: 12 }}>Tramos: {tramos.length}</span>
            <span style={{ ...chipStyle, fontSize: 12 }}>Progresivas: {progresivas.length}</span>
            <span style={{ ...chipStyle, fontSize: 12 }}>Informes: {informesPoints.length}</span>
            <span style={{ ...chipStyle, fontSize: 12 }}>Subtramos: {subtramos.length}</span>
            <span style={{ ...chipStyle, fontSize: 12 }}>
              Renderizados: {renderedTramosCount} tramos · {renderedProgresivasCount} progresivas ·{" "}
              {renderedInformesCount} informes
            </span>
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280" }}>
            Resueltos: {selectionSummary.tramo_ids.length} tramos,{" "}
            {selectionSummary.progresiva_ids.length} progresivas,{" "}
            {selectionSummary.subtramo_ids.length} subtramos y {informesPoints.length} informes
            georreferenciados. La seleccion sigue siendo local al submapa.
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={sectionTitleStyle}>Informes</div>
            {renderList(
              informesPoints.map((point) => ({
                id_informe: point.id_informe,
                titulo: point.titulo || `Informe #${point.id_informe}`,
              })),
              "informe",
              "Sin informes georreferenciados."
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={sectionTitleStyle}>Tramos</div>
            {renderList(tramos, "tramo", "Sin tramos resueltos.")}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={sectionTitleStyle}>Progresivas</div>
            {renderList(progresivas, "progresiva", "Sin progresivas resueltas.")}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={sectionTitleStyle}>Subtramos</div>
            {renderList(subtramos, "subtramo", "Sin subtramos resueltos.")}
          </div>
        </div>
      )}
    </div>
  );
}
