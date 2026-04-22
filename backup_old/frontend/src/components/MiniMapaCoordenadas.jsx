// src/components/MiniMapaCoordenadas.jsx
// RUTAS / API:
//  - (Este componente NO consume backend)
//  - Usa OpenLayers + Geolocation del navegador (navigator.geolocation)
//  - Devuelve coordenadas al padre con onChange([lat, lng])

import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat, toLonLat } from 'ol/proj';

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const clampLatLng = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return [lat, lng];
};

const MiniMapaCoordenadas = ({ value, onChange }) => {
  const mapRef = useRef(null);
  const mapObjRef = useRef(null);
  const markerLayerRef = useRef(null);
  const vectorSourceRef = useRef(null);

  // ✅ Inputs editables
  const [latTxt, setLatTxt] = useState(value?.[0] != null ? String(value[0]) : '');
  const [lngTxt, setLngTxt] = useState(value?.[1] != null ? String(value[1]) : '');

  // ✅ estado de geolocalización
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [geoAccuracy, setGeoAccuracy] = useState(null);

  // ✅ seguimiento (watchPosition)
  const watchIdRef = useRef(null);
  const [watching, setWatching] = useState(false);

  // sincroniza inputs cuando value cambia desde afuera
  useEffect(() => {
    setLatTxt(value?.[0] != null ? String(value[0]) : '');
    setLngTxt(value?.[1] != null ? String(value[1]) : '');
  }, [value?.[0], value?.[1]]);

  const setMarker = (lat, lng, { center = true, zoom = 14 } = {}) => {
    const map = mapObjRef.current;
    const markerLayer = markerLayerRef.current;
    const vectorSource = vectorSourceRef.current;
    if (!map || !markerLayer || !vectorSource) return;

    const ok = clampLatLng(lat, lng);
    if (!ok) return;

    const coord3857 = fromLonLat([ok[1], ok[0]]); // [lon,lat] -> 3857

    vectorSource.clear();
    vectorSource.addFeature(new Feature(new Point(coord3857)));

    if (center) {
      map.getView().setCenter(coord3857);
      map.getView().setZoom(zoom);
    }
  };

  useEffect(() => {
    if (!mapRef.current) return;

    // Capa base
    const baseLayer = new TileLayer({ source: new OSM() });

    const vectorSource = new VectorSource();
    vectorSourceRef.current = vectorSource;

    const markerLayer = new VectorLayer({ source: vectorSource });
    markerLayerRef.current = markerLayer;

    // Centro inicial (Paraguay)
    const initialCenter = fromLonLat([-57.6359, -25.2637]);

    const map = new Map({
      target: mapRef.current,
      layers: [baseLayer, markerLayer],
      view: new View({
        center: initialCenter,
        zoom: 7,
      }),
    });

    mapObjRef.current = map;

    // Si ya hay coordenadas, dibujar marker
    if (value && Array.isArray(value) && value.length === 2) {
      const [lat, lng] = value;
      setMarker(Number(lat), Number(lng), { center: true, zoom: 14 });
    }

    // Click en el mapa → seleccionar punto
    map.on('singleclick', (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate);

      // marker
      vectorSource.clear();
      vectorSource.addFeature(new Feature(new Point(evt.coordinate)));

      // ✅ actualizar inputs
      setGeoError('');
      setGeoAccuracy(null);
      setLatTxt(String(lat));
      setLngTxt(String(lon));

      // devolvemos [lat, lng]
      if (onChange) onChange([lat, lon]);
    });

    return () => {
      map.setTarget(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si value cambia desde afuera, actualizar marker (sin recrear mapa)
  useEffect(() => {
    if (!value || !Array.isArray(value) || value.length !== 2) return;

    const lat = toNum(value[0]);
    const lng = toNum(value[1]);
    const ok = clampLatLng(lat, lng);
    if (!ok) return;

    setMarker(ok[0], ok[1], { center: false }); // no “salta” el mapa si viene de afuera
  }, [value]);

  const aplicarManual = () => {
    const lat = toNum(latTxt);
    const lng = toNum(lngTxt);
    const ok = clampLatLng(lat, lng);

    if (!ok) {
      alert('Lat/Lng inválidos. Ej: -21.802199 y -57.515253');
      return;
    }

    setGeoError('');
    setGeoAccuracy(null);

    // ✅ mover marker + centrar
    setMarker(ok[0], ok[1], { center: true, zoom: 14 });

    // ✅ notificar al padre (guarda como [lat,lng])
    if (onChange) onChange(ok);
  };

  const getPos = (opts) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });

  const humanGeoError = (err) => {
    let msg = 'No se pudo obtener tu ubicación.';
    if (err?.code === 1) msg = 'Permiso denegado para acceder a tu ubicación.';
    if (err?.code === 2) msg = 'Ubicación no disponible (señal débil / GPS apagado).';
    if (err?.code === 3) msg = 'Tiempo de espera agotado obteniendo ubicación.';
    return msg;
  };

  // ✅ NUEVO: tomar ubicación actual con "mejor esfuerzo": alta precisión -> fallback baja
  const aplicarMiUbicacion = async () => {
    setGeoError('');
    setGeoAccuracy(null);

    if (!navigator.geolocation) {
      setGeoError('Este navegador no soporta geolocalización.');
      return;
    }

    setGeoLoading(true);

    const highOpts = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000, // permite cache corto
    };

    const lowOpts = {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 60000,
    };

    try {
      // 1) intento GPS / alta precisión
      const pos = await getPos(highOpts);
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy ?? null;

      setLatTxt(String(lat));
      setLngTxt(String(lng));
      setGeoAccuracy(acc);

      setMarker(lat, lng, { center: true, zoom: 16 });
      if (onChange) onChange([lat, lng]);

      setGeoLoading(false);
      return;
    } catch (e1) {
      // 2) fallback baja precisión
      try {
        const pos = await getPos(lowOpts);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy ?? null;

        setLatTxt(String(lat));
        setLngTxt(String(lng));
        setGeoAccuracy(acc);

        setMarker(lat, lng, { center: true, zoom: 15 });
        if (onChange) onChange([lat, lng]);

        setGeoLoading(false);
        return;
      } catch (e2) {
        setGeoError(humanGeoError(e2));
        setGeoLoading(false);
      }
    }
  };

  // ✅ opcional: seguir ubicación para que vaya mejorando precisión
  const iniciarSeguimiento = () => {
    setGeoError('');
    setGeoAccuracy(null);

    if (!navigator.geolocation) {
      setGeoError('Este navegador no soporta geolocalización.');
      return;
    }
    if (watchIdRef.current != null) return;

    setWatching(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy ?? null;

        setLatTxt(String(lat));
        setLngTxt(String(lng));
        setGeoAccuracy(acc);

        setMarker(lat, lng, { center: true, zoom: 16 });
        if (onChange) onChange([lat, lng]);
      },
      (err) => {
        setGeoError(humanGeoError(err));
        setWatching(false);
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    );
  };

  const detenerSeguimiento = () => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setWatching(false);
  };

  useEffect(() => {
    return () => detenerSeguimiento();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lat = value?.[0] ?? '';
  const lng = value?.[1] ?? '';

  return (
    <div>
      {/* ✅ Inputs editables */}
      <div className="d-flex gap-2 align-items-center flex-wrap mb-2">
        <div className="d-flex align-items-center gap-1">
          <small><strong>Lat:</strong></small>
          <input
            type="text"
            className="form-control form-control-sm"
            style={{ width: 170 }}
            value={latTxt}
            onChange={(e) => setLatTxt(e.target.value)}
            placeholder="-21.802199"
          />
        </div>

        <div className="d-flex align-items-center gap-1">
          <small><strong>Lng:</strong></small>
          <input
            type="text"
            className="form-control form-control-sm"
            style={{ width: 170 }}
            value={lngTxt}
            onChange={(e) => setLngTxt(e.target.value)}
            placeholder="-57.515253"
          />
        </div>

        <button type="button" className="btn btn-sm btn-outline-primary" onClick={aplicarManual}>
          Aplicar
        </button>

        {/* ✅ Mi ubicación (mejor esfuerzo) */}
        <button
          type="button"
          className="btn btn-sm btn-outline-success"
          onClick={aplicarMiUbicacion}
          disabled={geoLoading}
          title="Toma tu ubicación actual (GPS/WiFi/Red). Offline igual funciona GPS."
        >
          {geoLoading ? 'Ubicando…' : 'Mi ubicación'}
        </button>

        {/* ✅ Opcional: seguimiento */}
        {!watching ? (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={iniciarSeguimiento}
            disabled={geoLoading}
            title="Mantiene el GPS actualizando y puede mejorar la precisión"
          >
            Seguir
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-outline-danger"
            onClick={detenerSeguimiento}
            title="Detener seguimiento"
          >
            Parar
          </button>
        )}
      </div>

      {/* ✅ error de geolocalización */}
      {geoError ? (
        <div className="alert alert-warning py-2 px-2 mb-2" style={{ fontSize: 13 }}>
          {geoError}
        </div>
      ) : null}

      {/* ✅ precisión */}
      {geoAccuracy != null ? (
        <div className="alert alert-info py-2 px-2 mb-2" style={{ fontSize: 13 }}>
          Precisión estimada: <b>±{Math.round(geoAccuracy)} m</b>
        </div>
      ) : null}

      {/* Mapa */}
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: 220,
          borderRadius: 4,
          border: '1px solid #ccc',
          overflow: 'hidden',
        }}
      />

      <small className="text-muted d-block mt-1">
        Hacé clic en el mapa o escribí Lat/Lng y presioná <b>Aplicar</b>. También podés usar <b>Mi ubicación</b>.
        {watching ? ' (Seguimiento activo)' : ''}
      </small>

      {value && (
        <div className="mt-1">
          <small>
            <strong>Lat:</strong>{' '}
            {typeof lat === 'number' ? lat.toFixed(6) : lat}{' '}
            <strong>Lng:</strong>{' '}
            {typeof lng === 'number' ? lng.toFixed(6) : lng}
          </small>
        </div>
      )}
    </div>
  );
};

export default MiniMapaCoordenadas;
