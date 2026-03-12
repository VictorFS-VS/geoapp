// src/map/VisorBaseGoogle.jsx
import React, { useEffect, useRef } from "react";
import { useMapCtx } from "./MapContext";
import { loadGoogleMapsApi } from "@/utils/loadGoogleMapsApi";

// ✅ unificá el nombre (usá el que realmente tengas en .env)
const GMAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY; // <- recomendado
const GMAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;

export default function VisorBaseGoogle({
  initialCenter = { lat: -25.3, lng: -57.6 },
  initialZoom = 7,
}) {
  const divRef = useRef(null);
  const { mapRef, proyectoLayerRef, usoActLayerRef, usoAltLayerRef, setReady } =
    useMapCtx();

  useEffect(() => {
    let cancel = false;

    (async () => {
      try {
        if (!GMAPS_API_KEY) {
          console.error("Falta VITE_GOOGLE_MAPS_KEY en el .env");
          return;
        }

        await loadGoogleMapsApi(GMAPS_API_KEY);
        if (cancel) return;

        const g = window.google;
        if (!g?.maps?.Map || !divRef.current) return;

        // marker library (por si algún módulo usa AdvancedMarker)
        try {
          await g.maps.importLibrary("marker");
        } catch {}

        const map = new g.maps.Map(divRef.current, {
          center: initialCenter,
          zoom: initialZoom,
          mapId: GMAPS_MAP_ID || undefined,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          mapTypeId: "hybrid",
        });

        mapRef.current = map;

        // Data layers para módulos de polígonos
        proyectoLayerRef.current = new g.maps.Data({ map });
        usoActLayerRef.current = new g.maps.Data({ map });
        usoAltLayerRef.current = new g.maps.Data({ map });

        setReady(true);
      } catch (e) {
        console.error("Error inicializando Google Maps:", e);
      }
    })();

    return () => {
      cancel = true;
      setReady(false);

      try {
        proyectoLayerRef.current?.setMap?.(null);
      } catch {}
      try {
        usoActLayerRef.current?.setMap?.(null);
      } catch {}
      try {
        usoAltLayerRef.current?.setMap?.(null);
      } catch {}

      proyectoLayerRef.current = null;
      usoActLayerRef.current = null;
      usoAltLayerRef.current = null;

      mapRef.current = null;
    };
  }, [
    initialCenter,
    initialZoom,
    mapRef,
    proyectoLayerRef,
    usoActLayerRef,
    usoAltLayerRef,
    setReady,
    GMAPS_API_KEY,
    GMAPS_MAP_ID,
  ]);

  return <div ref={divRef} style={{ position: "absolute", inset: 0 }} />;
}
