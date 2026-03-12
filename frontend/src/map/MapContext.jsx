// src/map/MapContext.jsx
import React, { createContext, useContext, useMemo, useRef, useState } from "react";

const MapCtx = createContext(null);

export function MapProvider({ children }) {
  const mapRef = useRef(null);

  // Data layers (Google Maps Data) para polígonos
  const proyectoLayerRef = useRef(null);
  const usoActLayerRef = useRef(null);
  const usoAltLayerRef = useRef(null);

  // Overlays/markers etc
  const markersRef = useRef([]);

  // UI shared
  const [ready, setReady] = useState(false);

  const value = useMemo(
    () => ({
      mapRef,
      proyectoLayerRef,
      usoActLayerRef,
      usoAltLayerRef,
      markersRef,
      ready,
      setReady,
    }),
    [ready]
  );

  return <MapCtx.Provider value={value}>{children}</MapCtx.Provider>;
}

export function useMapCtx() {
  const ctx = useContext(MapCtx);
  if (!ctx) throw new Error("useMapCtx debe usarse dentro de <MapProvider />");
  return ctx;
}
