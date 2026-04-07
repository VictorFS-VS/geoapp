// src/components/GoogleMapaCoordenadas.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Alert, Spinner, Form, Badge } from "react-bootstrap";

/**
 * ✅ Fix importante:
 * - commit() ahora hace onChange([lat,lng]) (array), NO {lat,lng}
 * - Sigue aceptando value como [lat,lng] o {lat,lng} por compatibilidad
 */

export default function GoogleMapaCoordenadas({
  value = null,
  onChange,
  readOnly = false,
  disabled = false,
  readOnlyGeometry = null,
  height = 260,
  defaultCenter = { lat: -25.28646, lng: -57.647 },
  defaultZoom = 16,
  hideManualControls = false,
}) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const overlayRef = useRef([]);
  const lastFitSigRef = useRef("");
  const hasCoordsRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [mapType, setMapType] = useState("roadmap");
  const [gmError, setGmError] = useState("");
  const [locating, setLocating] = useState(false);

  const [online, setOnline] = useState(navigator.onLine);

  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualError, setManualError] = useState("");

  const apiKey =
    import.meta.env.VITE_GOOGLE_MAPS_KEY ||
    import.meta.env.VITE_GMAPS_API_KEY ||
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    "";

  const mapId =
    import.meta.env.VITE_GOOGLE_MAP_ID ||
    import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ||
    "";

  const BASE = import.meta.env.VITE_API_URL || "https://app.ema.com.py";
  const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

  const coords = useMemo(() => {
    if (Array.isArray(value) && value.length >= 2) {
      const lat = toNum(value[0]);
      const lng = toNum(value[1]);
      if (lat != null && lng != null) return { lat, lng };
      return null;
    }
    if (value && typeof value === "object") {
      const lat = toNum(value.lat ?? value.latitude);
      const lng = toNum(value.lng ?? value.lon ?? value.longitude);
      if (lat != null && lng != null) return { lat, lng };
      return null;
    }
    return null;
  }, [value]);

  const center = useMemo(() => coords ?? defaultCenter, [coords, defaultCenter]);

  // ✅ commit: guarda en parent como [lat,lng]
  const commit = (posOrNull) => {
    if (!posOrNull) {
      setManualLat("");
      setManualLng("");
      setManualError("");
      onChange?.(null);
      return;
    }
    const lat = toNum(posOrNull.lat);
    const lng = toNum(posOrNull.lng);
    if (lat == null || lng == null) return;

    setManualLat(String(lat));
    setManualLng(String(lng));
    setManualError("");
    onChange?.([lat, lng]); // ✅ ARRAY
  };

  useEffect(() => {
    if (!coords) {
      setManualLat("");
      setManualLng("");
      hasCoordsRef.current = false;
      return;
    }
    setManualLat(String(coords.lat));
    setManualLng(String(coords.lng));
    hasCoordsRef.current = true;
  }, [coords?.lat, coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const waitForMapConstructor = async (timeoutMs = 12000) => {
      const start = Date.now();
      while (!cancelled) {
        const g = window.google;
        const ok = !!(g?.maps && typeof g.maps.Map === "function");
        if (ok) return true;
        if (Date.now() - start > timeoutMs) return false;
        await new Promise((r) => setTimeout(r, 80));
      }
      return false;
    };

    const ensure = async () => {
      setGmError("");
      setReady(false);

      if (!online) return;

      if (!apiKey) {
        setGmError("Falta VITE_GOOGLE_MAPS_KEY (o VITE_GMAPS_API_KEY) en tu .env.");
        return;
      }

      window.gm_authFailure = () => {
        if (!cancelled) setGmError("Google Maps: fallo de autenticación (API Key / restricciones / billing).");
      };

      const cbName = "__initGoogleMapsCB__";
      window[cbName] = async () => {
        const ok = await waitForMapConstructor();
        if (!cancelled && ok) setReady(true);
        if (!cancelled && !ok) setGmError("Google Maps cargó pero google.maps.Map no está disponible.");
      };

      if (window.google?.maps && typeof window.google.maps.Map === "function") {
        setReady(true);
        return;
      }

      const existing = document.querySelector('script[data-gmaps="1"]');
      if (existing) {
        const ok = await waitForMapConstructor();
        if (!cancelled && ok) setReady(true);
        if (!cancelled && !ok) setGmError("Google Maps script existe pero Maps no inicializó. Ver consola.");
        return;
      }

      const s = document.createElement("script");
      s.src =
        `https://maps.googleapis.com/maps/api/js` +
        `?key=${encodeURIComponent(apiKey)}` +
        `&v=weekly` +
        `&loading=async` +
        `&libraries=marker` +
        `&callback=${encodeURIComponent(cbName)}`;
      s.async = true;
      s.defer = true;
      s.dataset.gmaps = "1";

      s.onerror = () => {
        if (!cancelled) setGmError("No se pudo cargar Google Maps JS API (red o bloqueo).");
      };

      document.head.appendChild(s);

      setTimeout(async () => {
        if (cancelled) return;
        const ok = await waitForMapConstructor(1);
        if (!ok && !cancelled) setGmError("Google Maps no terminó de inicializar. Revisá consola (Key/Billing/Referer/API).");
      }, 14000);
    };

    ensure();

    return () => {
      cancelled = true;
      try {
        delete window.__initGoogleMapsCB__;
      } catch {}
    };
  }, [apiKey, online]);

  const setMarkerPosition = (pos) => {
    const mk = markerRef.current;
    if (!mk) return;

    if ("position" in mk) {
      try {
        mk.position = pos;
        return;
      } catch {}
    }
    if (typeof mk.setPosition === "function") mk.setPosition(pos);
  };

  const applyPosition = (pos, zoom = 18) => {
    const map = mapRef.current;
    setMarkerPosition(pos);
    map?.panTo?.(pos);
    if (typeof zoom === "number") map?.setZoom?.(zoom);
    commit(pos);
  };

  useEffect(() => {
    if (!ready) return;
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const g = window.google;
    if (!g?.maps || typeof g.maps.Map !== "function") {
      setGmError("Maps listo pero google.maps.Map no está disponible.");
      return;
    }

    const map = new g.maps.Map(mapDivRef.current, {
      center,
      zoom: coords ? Math.max(defaultZoom, 17) : defaultZoom,
      mapTypeId: mapType,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      ...(mapId ? { mapId } : {}),
      gestureHandling: disabled ? "none" : "auto",
      draggable: !disabled,
      scrollwheel: !disabled,
      disableDoubleClickZoom: disabled,
      keyboardShortcuts: !disabled,
    });

    mapRef.current = map;

    const hasAdvanced = !!g.maps.marker && typeof g.maps.marker.AdvancedMarkerElement === "function";

    if (hasAdvanced) {
      const adv = new g.maps.marker.AdvancedMarkerElement({
        map,
        position: center,
        title: "Ubicación",
        gmpDraggable: !(readOnly || disabled),
      });

      markerRef.current = adv;

      if (!(readOnly || disabled)) {
        const commitFromAdv = () => {
          const pos = adv.position;
          const lat = typeof pos?.lat === "function" ? pos.lat() : pos?.lat;
          const lng = typeof pos?.lng === "function" ? pos.lng() : pos?.lng;
          if (lat == null || lng == null) return;
          applyPosition({ lat, lng }, 19);
        };

        // Primary event for AdvancedMarkerElement
        adv.addListener?.("gmp-dragend", commitFromAdv);
        // Fallbacks for environments where gmp-dragend is not emitted
        adv.addListener?.("dragend", commitFromAdv);
        adv.addListener?.("position_changed", commitFromAdv);
      }
    } else {
      const mk = new g.maps.Marker({
        map,
        position: center,
        draggable: !(readOnly || disabled),
        title: "Ubicación",
      });
      markerRef.current = mk;

      if (!(readOnly || disabled)) {
        mk.addListener("dragend", () => {
          const p = mk.getPosition?.();
          const lat = p?.lat?.();
          const lng = p?.lng?.();
          if (lat == null || lng == null) return;
          applyPosition({ lat, lng }, 19);
        });
      }
    }

    map.addListener("click", (ev) => {
      if (readOnly || disabled) return;
      if (hasCoordsRef.current) return;
      const lat = ev?.latLng?.lat?.();
      const lng = ev?.latLng?.lng?.();
      if (lat == null || lng == null) return;
      applyPosition({ lat, lng }, 19);
    });

    if (!coords) {
      map.setCenter(defaultCenter);
      map.setZoom(defaultZoom);
    }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(mapType);
  }, [mapType]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!coords) return;

    const pos = { lat: coords.lat, lng: coords.lng };
    setMarkerPosition(pos);
    map.panTo(pos);
  }, [coords?.lat, coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    overlayRef.current.forEach((p) => p.setMap(null));
    overlayRef.current = [];

    const geom = normalizeGeometry(readOnlyGeometry);
    const g = window.google;
    const hasGmaps = !!g?.maps?.Polygon;
    const pathsList = geom && hasGmaps ? geoToPaths(geom) : [];
    const hasPolygon = pathsList.length > 0;

    if (hasPolygon) {
      for (const paths of pathsList) {
        if (!paths.length) continue;
        const poly = new g.maps.Polygon({
          paths,
          strokeColor: "#2563eb",
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: "#60a5fa",
          fillOpacity: 0.18,
          clickable: false,
          draggable: false,
          editable: false,
        });
        poly.setMap(map);
        overlayRef.current.push(poly);
      }
    }

    const hasMarker = coords?.lat != null && coords?.lng != null;
    const sig = `${hasPolygon ? "P" : ""}${hasMarker ? "M" : ""}`;
    if (sig === lastFitSigRef.current) return;

    if (hasPolygon) {
      const bounds = new g.maps.LatLngBounds();
      for (const paths of pathsList) {
        for (const p of paths) bounds.extend(p);
      }
      if (hasMarker) bounds.extend({ lat: coords.lat, lng: coords.lng });
      map.fitBounds(bounds, 40);
      lastFitSigRef.current = sig;
      return;
    }
    if (hasMarker) {
      map.setCenter({ lat: coords.lat, lng: coords.lng });
      map.setZoom(Math.max(defaultZoom, 17));
      lastFitSigRef.current = sig;
      return;
    }

    if (lastFitSigRef.current !== "") {
      map.setCenter(defaultCenter);
      map.setZoom(defaultZoom);
    }
    lastFitSigRef.current = "";
  }, [readOnlyGeometry, ready, coords?.lat, coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const locateByGPS = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocalización no soportada."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: "gps" }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });

  const locateByIP = async () => {
    const res = await fetch(`${API_URL}/geo/ip`, { method: "GET", cache: "no-store" });
    const txt = await res.text().catch(() => "");

    let data = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      data = {};
    }

    if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);

    const lat = toNum(data?.lat);
    const lng = toNum(data?.lng);
    if (lat == null || lng == null) throw new Error("IP: no se pudo obtener lat/lng.");

    return { lat, lng, accuracy: data?.accuracy || null, source: "ip" };
  };

  const explainGeoError = (err) => {
    const code = err?.code;
    if (code === 1) return "Permiso de ubicación denegado. Activá la ubicación para el navegador/app.";
    if (code === 2) return "No se pudo obtener la posición (GPS/Red).";
    if (code === 3) return "Tiempo de espera agotado obteniendo ubicación.";
    return err?.message || "Error de geolocalización.";
  };

  const handleMiUbicacion = async () => {
    if (readOnly || disabled) return;
    setLocating(true);
    setGmError("");
    setManualError("");

    let gpsErr = null;

    try {
      const gps = await locateByGPS();
      applyPosition({ lat: gps.lat, lng: gps.lng }, 19);
      setLocating(false);
      return;
    } catch (e) {
      gpsErr = e;
    }

    if (!navigator.onLine) {
      setGmError(
        `No se pudo obtener ubicación por GPS. ${explainGeoError(gpsErr)}. Sin internet: no se puede usar IP. Podés cargar lat/lng manualmente.`
      );
      setLocating(false);
      return;
    }

    try {
      const ip = await locateByIP();
      applyPosition({ lat: ip.lat, lng: ip.lng }, 16);
    } catch (e2) {
      setGmError(`No se pudo obtener ubicación. GPS: ${explainGeoError(gpsErr)}. IP: ${e2?.message || "falló"}.`);
    } finally {
      setLocating(false);
    }
  };

  const handleAplicarManual = () => {
    if (readOnly || disabled) return;

    const lat = toNum(manualLat);
    const lng = toNum(manualLng);

    if (lat == null || lng == null) {
      setManualError("Ingresá latitud y longitud válidas.");
      return;
    }
    if (lat < -90 || lat > 90) {
      setManualError("Latitud fuera de rango (-90 a 90).");
      return;
    }
    if (lng < -180 || lng > 180) {
      setManualError("Longitud fuera de rango (-180 a 180).");
      return;
    }

    applyPosition({ lat, lng }, 18);
  };

  const showMap = online && ready && !gmError;

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap" style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>
        <div style={{ fontWeight: 800 }}>
          Ubicación{" "}
          <Badge bg={online ? "success" : "secondary"} style={{ fontSize: 11, verticalAlign: "middle" }}>
            {online ? "Online" : "Offline"}
          </Badge>
        </div>

        <div className="d-flex gap-2 align-items-center">
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleMiUbicacion}
            disabled={readOnly || disabled || locating}
            title="Usa GPS (funciona sin internet). Si falla y estás online, usa IP."
          >
            {locating ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Ubicando…
              </>
            ) : (
              <>📍 Mi ubicación</>
            )}
          </Button>
        </div>
      </div>

      {!hideManualControls && (
      <div style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>
        <div className="d-flex gap-2 align-items-end flex-wrap">
          <Form.Group style={{ minWidth: 180 }}>
            <Form.Label className="mb-1" style={{ fontSize: 12, color: "#6b7280" }}>
              Latitud
            </Form.Label>
            <Form.Control
              size="sm"
              type="text"
              placeholder="-25.28646"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              disabled={readOnly || disabled}
            />
          </Form.Group>

          <Form.Group style={{ minWidth: 180 }}>
            <Form.Label className="mb-1" style={{ fontSize: 12, color: "#6b7280" }}>
              Longitud
            </Form.Label>
            <Form.Control
              size="sm"
              type="text"
              placeholder="-57.647"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              disabled={readOnly || disabled}
            />
          </Form.Group>

          <Button size="sm" variant="success" onClick={handleAplicarManual} disabled={readOnly || disabled} title="Guarda estas coordenadas (y centra el mapa si está online)">
            Aplicar
          </Button>

          <Button
            size="sm"
            variant="outline-secondary"
            onClick={() => {
              setManualError("");
              commit(null);
            }}
            disabled={readOnly || disabled}
            title="Limpiar"
          >
            Limpiar
          </Button>

          <div className="ms-auto d-flex align-items-center gap-2">
            <div style={{ fontSize: 12, color: "#6b7280" }}>Mapa</div>
            <Form.Select
              size="sm"
              value={mapType}
              onChange={(e) => setMapType(e.target.value)}
              disabled={!showMap}
              style={{ width: 150 }}
              title={!showMap ? "Disponible solo cuando hay mapa" : "Cambiar tipo de mapa"}
            >
              <option value="roadmap">Road</option>
              <option value="satellite">Satélite</option>
              <option value="hybrid">Hybrid</option>
              <option value="terrain">Terrain</option>
            </Form.Select>
          </div>
        </div>

        {manualError ? (
          <div style={{ marginTop: 8 }}>
            <Alert variant="warning" className="py-2 mb-0">
              {manualError}
            </Alert>
          </div>
        ) : null}
      </div>
      )}

      {!online ? (
        <div style={{ padding: 12 }}>
          <Alert variant="secondary" className="mb-0">
            Sin internet: Google Maps no puede cargarse. Igual podés usar <b>📍 Mi ubicación (GPS)</b> o cargar lat/lng manualmente.
          </Alert>
        </div>
      ) : gmError ? (
        <div style={{ padding: 12 }}>
          <Alert variant="danger" className="mb-0">
            {gmError}
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
              Si es Google Maps: mirá consola. Si es ubicación: activá permisos de ubicación del navegador/app.
            </div>
          </Alert>
        </div>
      ) : !ready ? (
        <div style={{ padding: 12 }}>
          <Alert variant="light" className="mb-0 d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" /> Cargando mapa…
          </Alert>
        </div>
      ) : (
        <div ref={mapDivRef} style={{ width: "100%", height }} />
      )}

      <div style={{ padding: 10, borderTop: "1px solid #eef2f7", fontSize: 12, color: "#6b7280" }}>
        {readOnly || disabled
          ? "Vista de ubicación (solo lectura)."
          : online && ready && !gmError
            ? "Click en el mapa, mové el pin, usá 📍 Mi ubicación, o cargá lat/lng y Aplicar."
            : "Podés usar 📍 Mi ubicación (GPS) y/o cargar lat/lng manualmente."}
      </div>
    </div>
  );
}

function toNum(x) {
  if (x == null || x === "") return null;
  const n = Number(String(x).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeGeometry(geom) {
  if (!geom || typeof geom !== "object") return null;
  const type = String(geom.type || "").trim();
  if (type === "Polygon" || type === "MultiPolygon") return geom;
  return null;
}

function geoToPaths(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") {
    return (geom.coordinates || []).map((ring) =>
      (ring || [])
        .map((c) => ({ lng: toNum(c?.[0]), lat: toNum(c?.[1]) }))
        .filter((p) => p.lat != null && p.lng != null)
    );
  }
  if (geom.type === "MultiPolygon") {
    const all = [];
    for (const poly of geom.coordinates || []) {
      for (const ring of poly || []) {
        const path = (ring || [])
          .map((c) => ({ lng: toNum(c?.[0]), lat: toNum(c?.[1]) }))
          .filter((p) => p.lat != null && p.lng != null);
        if (path.length) all.push(path);
      }
    }
    return all;
  }
  return [];
}
