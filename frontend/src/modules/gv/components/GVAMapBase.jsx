import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMapsApi } from "@/utils/loadGoogleMapsApi";

const GMAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_GMAPS_API_KEY;
const GMAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;

export default function GVAMapBase({
  className = "",
  style,
  height = 320,
  initialCenter = { lat: -25.3, lng: -57.6 },
  initialZoom = 8,
  mapTypeId = "roadmap",
  fullscreenEnabled = false,
  defaultFullscreen = false,
  toolbar = null,
  overlayTop = null,
  overlayBottom = null,
  onReady,
  children,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const googleRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(!!defaultFullscreen);

  const wrapperStyle = useMemo(() => {
    const base = {
      position: isFullscreen ? "fixed" : "relative",
      inset: isFullscreen ? 16 : "auto",
      zIndex: isFullscreen ? 1100 : "auto",
      borderRadius: 14,
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      background: "#f8fafc",
      minHeight: isFullscreen ? "calc(100vh - 32px)" : height,
      height: isFullscreen ? "calc(100vh - 32px)" : height,
      boxShadow: isFullscreen ? "0 24px 60px rgba(15, 23, 42, 0.22)" : "none",
      ...style,
    };
    return base;
  }, [height, isFullscreen, style]);

  useEffect(() => {
    if (!isFullscreen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (mapRef.current || !hostRef.current) return;
      if (!GMAPS_API_KEY) {
        const nextError = "Falta configurar Google Maps.";
        setError(nextError);
        onReady?.({ map: null, google: null, ready: false, error: nextError });
        return;
      }

      try {
        setError("");
        const g = await loadGoogleMapsApi(GMAPS_API_KEY);
        if (cancelled || !hostRef.current) return;
        if (!g?.maps?.Map) {
          throw new Error("Google Maps no esta disponible.");
        }

        const map = new g.maps.Map(hostRef.current, {
          center: initialCenter,
          zoom: initialZoom,
          mapId: GMAPS_MAP_ID || undefined,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          mapTypeId,
        });

        mapRef.current = map;
        googleRef.current = g;
        setReady(true);
        onReady?.({ map, google: g, ready: true, error: "" });
      } catch (err) {
        if (!cancelled) {
          const nextError = String(err?.message || err);
          setError(nextError);
          onReady?.({ map: null, google: null, ready: false, error: nextError });
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [initialCenter, initialZoom, mapTypeId, onReady]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    try {
      mapRef.current.setMapTypeId(mapTypeId);
    } catch {}
  }, [mapTypeId, ready]);

  useEffect(() => {
    if (!ready || !mapRef.current || !googleRef.current?.maps) return;
    const map = mapRef.current;
    const center = map.getCenter ? map.getCenter() : null;
    window.setTimeout(() => {
      try {
        googleRef.current.maps.event.trigger(map, "resize");
        if (center) {
          map.setCenter(center);
        }
      } catch {}
    }, 0);
  }, [isFullscreen, ready]);

  useEffect(() => {
    return () => {
      mapRef.current = null;
      googleRef.current = null;
      setReady(false);
    };
  }, []);

  const childArgs = {
    map: mapRef.current,
    google: googleRef.current,
    ready,
    error,
    isFullscreen,
    setFullscreen: setIsFullscreen,
    toggleFullscreen: () => setIsFullscreen((prev) => !prev),
  };

  const childContent =
    typeof children === "function"
      ? children(childArgs)
      : children || null;

  return (
    <div className={className} style={wrapperStyle}>
      {(toolbar || fullscreenEnabled) && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            zIndex: 2,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            pointerEvents: "none",
            flexWrap: "wrap",
          }}
        >
          <div style={{ pointerEvents: "auto", flex: "1 1 320px", minWidth: 0 }}>{toolbar}</div>
          {fullscreenEnabled ? (
            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              style={{
                pointerEvents: "auto",
                border: "1px solid #dbe3ee",
                background: "#ffffff",
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isFullscreen ? "Salir de pantalla completa" : "Expandir"}
            </button>
          ) : null}
        </div>
      )}

      {overlayTop ? (
        <div
          style={{
            position: "absolute",
            top: toolbar || fullscreenEnabled ? 54 : 10,
            left: 10,
            right: 10,
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{overlayTop}</div>
        </div>
      ) : null}

      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />

      {error ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(248, 250, 252, 0.92)",
            color: "#b91c1c",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      ) : null}

      {overlayBottom ? (
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10,
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{overlayBottom}</div>
        </div>
      ) : null}

      {childContent}
    </div>
  );
}
