// src/map/modules/ModuloTramos.jsx
// ✅ COMPLETO
// ✅ FIX labels de progresivas que quedaban “pegados”
// ✅ Ya NO usa OverlayView para progresivas
// ✅ Usa marker de punto + marker de texto
// ✅ Filtra progresivas por cercanía al tramo activo
// ✅ Oculta labels con zoom bajo
// ✅ Mucho más estable
// ✅ NUEVO: mini leyenda por tramo usando el campo Uso
// ✅ NUEVO: leyenda siempre activa, estética y pequeña

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Button, Form, Badge } from "react-bootstrap";

/* =========================
   API base
========================= */
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   Config progresivas
========================= */
const PROG_MARKER_SCALE = 3.2;
const PROG_LABEL_MIN_ZOOM = 16;
const PROG_MARKER_MIN_ZOOM = 13;
const PROG_DISTANCE_METERS = 120;
const PROG_SAMPLE_STEP = 6;
const PROG_LABEL_OFFSET_X = 14;
const PROG_LABEL_OFFSET_Y = -8;

/* =========================
   Config mini leyenda tramos
========================= */
const TRAMO_LABEL_MIN_ZOOM = 0; // siempre visible
const TRAMO_LABEL_OFFSET_Y = 0;

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* =========================
   Helpers (texto)
========================= */
const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   Orden “humano” para tramos
========================= */
function partsFromNumberString(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)*$/.test(s)) return null;
  return s.split(".").map((x) => Number(x));
}

function partsFromLabel(label) {
  const s = String(label ?? "");
  const m = s.match(/tramo\s*([0-9]+(?:\.[0-9]+)*)/i);
  return m ? partsFromNumberString(m[1]) : null;
}

function compareParts(A, B) {
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const av = A[i] ?? 0;
    const bv = B[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return A.length - B.length;
}

function compareTramosHuman(a, b) {
  const aP = partsFromLabel(a?.label);
  const bP = partsFromLabel(b?.label);

  if (aP && bP) return compareParts(aP, bP);
  if (aP && !bP) return -1;
  if (!aP && bP) return 1;

  const aIdP = partsFromNumberString(a?.id_tramo);
  const bIdP = partsFromNumberString(b?.id_tramo);
  if (aIdP && bIdP) return compareParts(aIdP, bIdP);
  if (aIdP && !bIdP) return -1;
  if (!aIdP && bIdP) return 1;

  return String(a?.label || "").localeCompare(String(b?.label || ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

/* =========================
   GeoJSON normalizers
========================= */
function toFeatureFromRow(r) {
  if (!r || typeof r !== "object") return null;

  let geom =
    r.geometry ??
    r.geom ??
    r.geojson ??
    r.GEOMETRY ??
    r.GEOM ??
    r.GEOJSON ??
    null;

  if (geom && typeof geom === "object" && geom.type === "Feature") return geom;
  if (!geom && r.type === "Feature" && r.geometry) return r;
  if (!geom) return null;

  if (typeof geom === "string") {
    try {
      geom = JSON.parse(geom);
    } catch {
      return null;
    }
  }

  if (geom?.type === "FeatureCollection") return null;
  if (geom?.type === "Feature" && geom.geometry) return geom;

  const props =
    r.properties && typeof r.properties === "object"
      ? r.properties
      : Object.fromEntries(
          Object.entries(r).filter(
            ([k]) =>
              !["geometry", "geom", "geojson", "GEOMETRY", "GEOM", "GEOJSON"].includes(k)
          )
        );

  return { type: "Feature", geometry: geom, properties: props };
}

function asFeatureCollection(payload) {
  if (!payload) return null;

  const p =
    payload?.geojson ||
    payload?.GeoJSON ||
    payload?.data?.geojson ||
    payload?.data?.GeoJSON ||
    payload?.data ||
    payload;

  if (!p) return null;

  if (p?.type === "FeatureCollection" && Array.isArray(p.features)) {
    const fixed = p.features
      .map((f) => (f?.type === "Feature" ? f : toFeatureFromRow(f)))
      .filter(Boolean);
    return { type: "FeatureCollection", features: fixed };
  }

  if (Array.isArray(p?.features)) {
    const fixed = p.features
      .map((f) => (f?.type === "Feature" ? f : toFeatureFromRow(f)))
      .filter(Boolean);
    return { type: "FeatureCollection", features: fixed };
  }

  if (Array.isArray(p?.rows)) {
    const feats = p.rows.map(toFeatureFromRow).filter(Boolean);
    return { type: "FeatureCollection", features: feats };
  }

  if (Array.isArray(p)) {
    const feats = p.map((x) => (x?.type === "Feature" ? x : toFeatureFromRow(x))).filter(Boolean);
    return { type: "FeatureCollection", features: feats };
  }

  return null;
}

/* =========================
   WGS84 check (lon/lat)
========================= */
function isLngLatPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return false;
  const x = Number(pair[0]);
  const y = Number(pair[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x) <= 180 && Math.abs(y) <= 90;
}

function geomLooksWGS84(geom) {
  if (!geom) return true;
  const c = geom.coordinates;
  if (!c) return true;

  const walk = (node) => {
    if (!Array.isArray(node)) return true;

    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      return isLngLatPair(node);
    }

    for (const it of node) {
      if (!walk(it)) return false;
    }
    return true;
  };

  return walk(c);
}

function featureCollectionLooksWGS84(fc) {
  const feats = fc?.features || [];
  for (let i = 0; i < Math.min(feats.length, 30); i++) {
    const g = feats[i]?.geometry;
    if (!geomLooksWGS84(g)) return false;
  }
  return true;
}

/* =========================
   Helpers progresivas
========================= */
function getProgresivaLabel(props = {}) {
  return (
    props?.name ||
    props?.nombre ||
    props?.label ||
    props?.progresiva ||
    props?.pk ||
    "S/N"
  );
}

function getFeatureCenterLatLng(google, feature) {
  if (!google || !feature?.geometry) return null;
  const g = feature.geometry;

  if (g.type === "Point" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const [lng, lat] = g.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  const bounds = new google.maps.LatLngBounds();

  const walk = (node) => {
    if (!Array.isArray(node)) return;

    if (
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
      const lng = Number(node[0]);
      const lat = Number(node[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        bounds.extend({ lat, lng });
      }
      return;
    }

    for (const child of node) walk(child);
  };

  walk(g.coordinates);

  if (bounds.isEmpty()) return null;

  const c = bounds.getCenter();
  return { lat: c.lat(), lng: c.lng() };
}

/* =========================
   Distancias / cercanía
========================= */
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;

  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);

  const aa =
    s1 * s1 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;

  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function sampleLatLngsFromFeature(feature, step = PROG_SAMPLE_STEP) {
  const pts = [];
  try {
    const geom = feature?.getGeometry?.();
    if (!geom) return pts;

    let i = 0;
    geom.forEachLatLng((latLng) => {
      if (i % step === 0) {
        pts.push({ lat: latLng.lat(), lng: latLng.lng() });
      }
      i += 1;
    });

    if (pts.length === 0) {
      geom.forEachLatLng((latLng) => {
        pts.push({ lat: latLng.lat(), lng: latLng.lng() });
      });
    }
  } catch {}

  return pts;
}

function isPointNearSamples(point, samples, maxMeters = PROG_DISTANCE_METERS) {
  if (!point || !Array.isArray(samples) || samples.length === 0) return false;

  for (const s of samples) {
    if (haversineMeters(point, s) <= maxMeters) return true;
  }
  return false;
}

/* =========================
   Fetch helpers (+ timeout)
========================= */
async function fetchJsonOptional(url, signal, timeoutMs = 15000) {
  if (!url) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const onAbort = () => ctrl.abort();
  try {
    signal?.addEventListener?.("abort", onAbort, { once: true });
  } catch {}

  try {
    const res = await fetch(url, { headers: { ...authHeaders() }, signal: ctrl.signal });
    if (res.status === 404) return null;

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");

    if (!res.ok) {
      const txt = isJson
        ? JSON.stringify(await res.json().catch(() => ({})))
        : await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${url} ${txt?.slice?.(0, 400) || ""}`);
    }

    return isJson ? res.json() : null;
  } finally {
    clearTimeout(t);
    try {
      signal?.removeEventListener?.("abort", onAbort);
    } catch {}
  }
}

async function fetchFirstGeoJson(urls, signal) {
  let lastErr = null;

  for (const url of (urls || []).filter(Boolean)) {
    try {
      const json = await fetchJsonOptional(url, signal, 15000);
      if (!json) continue;

      const fc = asFeatureCollection(json);
      const has = !!fc?.features?.length;
      if (has) return { url, json, fc };
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

/* =========================
   Feature props helpers
========================= */
function featureProps(feature) {
  const props = {};
  try {
    feature.forEachProperty((v, k) => (props[k] = v));
  } catch {}
  return props;
}

function getIdTramo(props) {
  const v =
    props?.id_tramo ??
    props?.ID_TRAMO ??
    props?.idTramo ??
    props?.IDTRAMO ??
    props?.tramo_id ??
    props?.TRAMO_ID ??
    props?.gid_tramo ??
    props?.GID_TRAMO ??
    props?.id_tramo_key ??
    props?.ID_TRAMO_KEY ??
    props?.gid ??
    props?.GID ??
    props?.id ??
    props?.ID ??
    null;

  if (v === null || v === undefined || String(v).trim() === "") return "";
  return String(v).trim();
}

function getLabelTramo(props) {
  return (
    props?.tramo_nombre ||
    props?.nombre_tramo ||
    props?.label ||
    props?.tramo ||
    props?.name ||
    props?.nombre ||
    ""
  );
}

function getUsoValue(props) {
  return String(props?.uso ?? props?.USO ?? props?.Uso ?? "").trim();
}

function getUsoText(props = {}) {
  const uso = String(props?.uso ?? props?.USO ?? props?.Uso ?? "").trim();
  if (!uso) return "Sin uso";
  return uso;
}

function getUsoCategory(props) {
  const usoRaw = getUsoValue(props);
  const u = norm(usoRaw);
  const lbl = norm(getLabelTramo(props));

  // ✅ FC = Franja de construcción => tratar como CAMINO
  if (
    u === "fc" ||
    u.includes("franja de construccion") ||
    u.includes("franja construccion")
  ) {
    return "camino";
  }

  // ✅ FD = Franja de dominio => tratar como OTROS USOS
  if (
    u === "fd" ||
    u.includes("franja de dominio")
  ) {
    return "otros";
  }

  // ✅ Otros casos normales de camino
  if (
    u.includes("camino") ||
    u.includes("ruta") ||
    u.includes("carretera") ||
    lbl.includes("ruta")
  ) {
    return "camino";
  }

  return "otros";
}

function isCamino(props) {
  return getUsoCategory(props) === "camino";
}

function buildTramoMiniLabelHtml({ label, uso }) {
  const div = document.createElement("div");
  div.className = "tramo-mini-label";

  div.innerHTML = `
    <div style="
      display:inline-flex;
      align-items:center;
      gap:6px;
      max-width:160px;
      padding:3px 7px;
      border-radius:999px;
      background:rgba(20,20,24,.68);
      border:1px solid rgba(255,255,255,.10);
      color:#fff;
      font-size:10px;
      font-weight:800;
      line-height:1.1;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,.16);
      backdrop-filter:blur(4px);
      pointer-events:none;
      user-select:none;
    ">
      <span style="
        overflow:hidden;
        text-overflow:ellipsis;
      ">${esc(label || "Tramo")}</span>
      <span style="
        opacity:.8;
        font-weight:600;
      ">· ${esc(uso || "Sin uso")}</span>
    </div>
  `;

  return div;
}

/* =========================
   COMPONENTE
========================= */
export default function ModuloTramos({
  google,
  map,
  idProyecto,
  visible = true,

  uiRef,
  onHasData,
  onHasCharts,

  endpointTramosGeojson,
  endpointProgresivasGeojson,
  onSelectTramo,
  onClearTramo,
}) {
  const pid = Number(idProyecto);

  const didInitRef = useRef({ pid: null });

  const tramosLayerRef = useRef(null);
  const progresivasEntriesRef = useRef([]); // [{ marker, textMarker, position, feature, name }]
  const tramoLabelsRef = useRef([]); // [{ marker, id_tramo }]
  const iwRef = useRef(null);
  const progFilterRafRef = useRef(0);

  const abortRef = useRef({ tramosGeo: null, progresivasGeo: null });

  const loadLockRef = useRef(false);
  const loadProgLockRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const lastLoadPidRef = useRef(null);

  const boundsAllRef = useRef(null);
  const tramoBoundsMapRef = useRef(new Map());
  const tramoFeatureMapRef = useRef(new Map());
  const tramoSamplesMapRef = useRef(new Map());

  const [panelOpen, setPanelOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const [enabledTramos, setEnabledTramos] = useState(false);
  const [loadingTramos, setLoadingTramos] = useState(false);
  const [errTramos, setErrTramos] = useState("");
  const [srcTramos, setSrcTramos] = useState("");

  const [enabledProgresivas, setEnabledProgresivas] = useState(false);
  const [loadingProgresivas, setLoadingProgresivas] = useState(false);
  const [errProgresivas, setErrProgresivas] = useState("");
  const [srcProgresivas, setSrcProgresivas] = useState("");

  const [tramosList, setTramosList] = useState([]);
  const tramosListRef = useRef([]);
  useEffect(() => {
    tramosListRef.current = Array.isArray(tramosList) ? tramosList : [];
  }, [tramosList]);

  const [activeIdTramo, setActiveIdTramo] = useState("");
  const [soloActivo, setSoloActivo] = useState(false);

  const enabledRef = useRef(false);
  const activeRef = useRef("");
  const soloRef = useRef(false);
  const enabledProgRef = useRef(false);

  useEffect(() => {
    enabledRef.current = !!enabledTramos;
  }, [enabledTramos]);
  useEffect(() => {
    activeRef.current = String(activeIdTramo || "");
  }, [activeIdTramo]);
  useEffect(() => {
    soloRef.current = !!soloActivo;
  }, [soloActivo]);
  useEffect(() => {
    enabledProgRef.current = !!enabledProgresivas;
  }, [enabledProgresivas]);

  const onHasDataRef = useRef(onHasData);
  const onHasChartsRef = useRef(onHasCharts);
  const onSelectTramoRef = useRef(onSelectTramo);
  const onClearTramoRef = useRef(onClearTramo);

  useEffect(() => {
    onHasDataRef.current = onHasData;
  }, [onHasData]);
  useEffect(() => {
    onHasChartsRef.current = onHasCharts;
  }, [onHasCharts]);
  useEffect(() => {
    onSelectTramoRef.current = onSelectTramo;
  }, [onSelectTramo]);
  useEffect(() => {
    onClearTramoRef.current = onClearTramo;
  }, [onClearTramo]);

  const tramosGeojsonUrls = useMemo(() => {
    if (!pid) return [];
    return [
      endpointTramosGeojson,
      `${API_URL}/tramos/proyectos/${pid}/tramos/geojson`,
      `${API_URL}/tramos/proyectos/${pid}/tramos/geojson?limit=30000`,
    ].filter(Boolean);
  }, [pid, endpointTramosGeojson]);

  const progresivasGeojsonUrls = useMemo(() => {
    if (!pid) return [];
    return [
      endpointProgresivasGeojson,
      `${API_URL}/mantenimiento/${pid}/progresivas`,
    ].filter(Boolean);
  }, [pid, endpointProgresivasGeojson]);

  const ensureInfoWindow = useCallback(() => {
    if (!google || !map) return null;
    if (!iwRef.current) iwRef.current = new google.maps.InfoWindow();
    return iwRef.current;
  }, [google, map]);

  const ensureTramosLayer = useCallback(() => {
    if (!google || !map) return null;
    if (tramosLayerRef.current) return tramosLayerRef.current;

    const layer = new google.maps.Data({ map: null });
    tramosLayerRef.current = layer;

    layer.addListener("click", (ev) => {
      const props = featureProps(ev.feature);
      const idt = getIdTramo(props) || "—";
      const title = getLabelTramo(props) || `Tramo ${idt}`;
      const uso = props?.uso ?? props?.USO ?? props?.Uso ?? "";

      const html = `
        <div style="min-width:240px;max-width:340px;">
          <div style="font-weight:900;margin-bottom:6px;">${esc(title)}</div>
          <div style="font-size:12px;opacity:.8;margin-bottom:10px;">
            <b>id_tramo:</b> ${esc(idt)} ${uso ? ` · <b>Uso:</b> ${esc(uso)}` : ""}
          </div>
        </div>
      `;

      const iw = ensureInfoWindow();
      if (!iw) return;
      iw.setContent(html);
      iw.setPosition(ev.latLng);
      iw.open({ map });
    });

    layer.setStyle((feature) => {
      const props = featureProps(feature);
      const category = getUsoCategory(props);
      const road = category === "camino";

      return {
        strokeColor: road ? "#000000" : "#facc15",
        strokeOpacity: 1,
        strokeWeight: road ? 3 : 2,
        fillColor: road ? "#000000" : "#facc15",
        fillOpacity: road ? 0.18 : 0.12,
        clickable: true,
        visible: true,
        zIndex: road ? 120 : 70,
      };
    });

    return layer;
  }, [google, map, ensureInfoWindow]);

  const setTramosVisibility = useCallback(
    (show) => {
      const layer = tramosLayerRef.current;
      if (!layer) return;
      layer.setMap(show ? map : null);
    },
    [map]
  );

  const clearProgresivas = useCallback(() => {
    for (const entry of progresivasEntriesRef.current) {
      try {
        if ("map" in (entry.marker || {})) entry.marker.map = null;
        else entry.marker?.setMap?.(null);
      } catch {}
      try {
        if ("map" in (entry.textMarker || {})) entry.textMarker.map = null;
        else entry.textMarker?.setMap?.(null);
      } catch {}
    }
    progresivasEntriesRef.current = [];
  }, []);

  const clearTramoLabels = useCallback(() => {
    for (const entry of tramoLabelsRef.current) {
      try {
        if ("map" in (entry.marker || {})) entry.marker.map = null;
        else entry.marker?.setMap?.(null);
      } catch {}
    }
    tramoLabelsRef.current = [];
  }, []);

  const applyTramoLabelsFilterNow = useCallback(() => {
    if (!map) return;

    const zoom = Number(map.getZoom?.() ?? 0);
    const showByZoom = zoom >= TRAMO_LABEL_MIN_ZOOM;

    for (const entry of tramoLabelsRef.current) {
      let visible = !!enabledRef.current && showByZoom;

      if (visible && soloRef.current && activeRef.current) {
        visible = String(entry.id_tramo) === String(activeRef.current);
      }

      try {
        if ("map" in (entry.marker || {})) entry.marker.map = visible ? map : null;
        else entry.marker?.setMap?.(visible ? map : null);
      } catch {}
    }
  }, [map]);

  const applyProgresivasFilterNow = useCallback(() => {
    if (!map) return;

    const zoom = Number(map.getZoom?.() ?? 0);
    const hasSelectedTramo = !!(soloRef.current && activeRef.current);
    const activeTramoSamples = hasSelectedTramo
      ? tramoSamplesMapRef.current.get(String(activeRef.current)) || []
      : [];

    const showLabels = zoom >= PROG_LABEL_MIN_ZOOM;
    const showMarkersNoSelection = zoom >= PROG_MARKER_MIN_ZOOM;

    for (const entry of progresivasEntriesRef.current) {
      let visible = false;

      if (!enabledProgRef.current) {
        visible = false;
      } else if (hasSelectedTramo) {
        visible = isPointNearSamples(entry.position, activeTramoSamples, PROG_DISTANCE_METERS);
      } else {
        visible = showMarkersNoSelection;
      }

      try {
        if ("map" in (entry.marker || {})) entry.marker.map = visible ? map : null;
        else entry.marker?.setMap?.(visible ? map : null);
      } catch {}

      try {
        if ("map" in (entry.textMarker || {}))
          entry.textMarker.map = visible && showLabels ? map : null;
        else entry.textMarker?.setMap?.(visible && showLabels ? map : null);
      } catch {}
    }
  }, [map]);

  const scheduleApplyProgresivasFilter = useCallback(() => {
    if (progFilterRafRef.current) {
      cancelAnimationFrame(progFilterRafRef.current);
    }
    progFilterRafRef.current = requestAnimationFrame(() => {
      progFilterRafRef.current = 0;
      applyProgresivasFilterNow();
    });
  }, [applyProgresivasFilterNow]);

  const renderTramoLabels = useCallback(
    async (list, boundsMap) => {
      if (!google || !map) return false;

      clearTramoLabels();

      if (!Array.isArray(list) || !list.length) return false;

      let markerLib = null;
      try {
        markerLib = await google.maps.importLibrary("marker");
      } catch {}

      const AdvancedMarker =
        markerLib?.AdvancedMarkerElement || google?.maps?.marker?.AdvancedMarkerElement;

      if (!AdvancedMarker) return false;

      const entries = [];

      for (const tramo of list) {
        const idt = String(tramo?.id_tramo || "").trim();
        if (!idt) continue;

        const b = boundsMap.get(idt);
        if (!b || b.isEmpty?.()) continue;

        const c = b.getCenter?.();
        if (!c) continue;

        const pos = { lat: c.lat(), lng: c.lng() };
        const html = buildTramoMiniLabelHtml({
          label: tramo?.label || `Tramo ${idt}`,
          uso: tramo?.uso || "Sin uso",
        });

        try {
          html.style.transform = `translateY(${TRAMO_LABEL_OFFSET_Y}px)`;
        } catch {}

        const marker = new AdvancedMarker({
          map: null,
          position: pos,
          content: html,
        });

        try {
          marker.zIndex = 2200;
        } catch {}

        entries.push({
          marker,
          id_tramo: idt,
        });
      }

      tramoLabelsRef.current = entries;
      applyTramoLabelsFilterNow();

      return entries.length > 0;
    },
    [google, map, clearTramoLabels, applyTramoLabelsFilterNow]
  );

  const renderProgresivas = useCallback(
    async (fc) => {
      if (!google || !map) return false;

      clearProgresivas();

      const feats = fc?.features || [];
      if (!feats.length) return false;

      let markerLib = null;
      try {
        markerLib = await google.maps.importLibrary("marker");
      } catch {}

      const AdvancedMarker =
        markerLib?.AdvancedMarkerElement || google?.maps?.marker?.AdvancedMarkerElement;

      const entries = [];

      for (const f of feats) {
        const props = f?.properties || {};
        const pos = getFeatureCenterLatLng(google, f);
        if (!pos) continue;

        const nombre = getProgresivaLabel(props);
        const descripcion = props?.descripcion || props?.description || "";

        let marker = null;
        let textMarker = null;

        if (AdvancedMarker) {
          const markerContent = document.createElement("div");
          markerContent.style.width = "8px";
          markerContent.style.height = "8px";
          markerContent.style.borderRadius = "999px";
          markerContent.style.background = "#ffd400";
          markerContent.style.border = "1.2px solid #ffffff";
          markerContent.style.boxShadow = "0 2px 6px rgba(0,0,0,.22)";
          markerContent.style.pointerEvents = "none";

          marker = new AdvancedMarker({
            map: null,
            position: pos,
            content: markerContent,
            title: nombre,
          });

          try {
            marker.zIndex = 3000;
          } catch {}

          const labelEl = document.createElement("div");
          labelEl.className = "prog-label-marker";
          labelEl.textContent = nombre;
          labelEl.style.color = "#f8fafc";
          labelEl.style.fontSize = "11px";
          labelEl.style.fontWeight = "800";
          labelEl.style.whiteSpace = "nowrap";
          labelEl.style.pointerEvents = "none";
          labelEl.style.transform = `translate(${PROG_LABEL_OFFSET_X}px, ${PROG_LABEL_OFFSET_Y}px)`;

          textMarker = new AdvancedMarker({
            map: null,
            position: pos,
            content: labelEl,
          });

          try {
            textMarker.zIndex = 3001;
          } catch {}

          marker.addListener("gmp-click", () => {
            const html = `
              <div style="min-width:180px;max-width:280px;">
                <div style="font-weight:900;margin-bottom:6px;">${esc(nombre)}</div>
                ${
                  descripcion
                    ? `<div style="font-size:12px;opacity:.85;"><b>Descripcion:</b> ${esc(descripcion)}</div>`
                    : `<div style="font-size:12px;opacity:.75;">Sin descripcion</div>`
                }
              </div>
            `;

            const iw = ensureInfoWindow();
            if (!iw) return;
            iw.setContent(html);
            iw.setPosition(pos);
            iw.open({ map });
          });
        } else {
          continue;
        }

        if (!marker || !textMarker) continue;
        if (AdvancedMarker) {
          try {
            if (textMarker?.content) textMarker.content.style.pointerEvents = "none";
          } catch {}
        }

        entries.push({
          marker,
          textMarker,
          position: pos,
          feature: f,
          name: nombre,
        });
      }

      progresivasEntriesRef.current = entries;
      scheduleApplyProgresivasFilter();

      return entries.length > 0;
    },
    [google, map, clearProgresivas, ensureInfoWindow, scheduleApplyProgresivasFilter]
  );

  const setProgresivasVisibility = useCallback(
    (show) => {
      enabledProgRef.current = !!show;
      scheduleApplyProgresivasFilter();
    },
    [scheduleApplyProgresivasFilter]
  );

  const fitBoundsSafe = useCallback(
    (bounds) => {
      if (!map || !bounds) return;
      try {
        map.fitBounds(bounds, 80);
      } catch {}
    },
    [map]
  );

  const centrarTodo = useCallback(() => {
    fitBoundsSafe(boundsAllRef.current);
  }, [fitBoundsSafe]);

  const centrarTramo = useCallback(
    (idTramo) => {
      const b = tramoBoundsMapRef.current.get(String(idTramo));
      fitBoundsSafe(b);
    },
    [fitBoundsSafe]
  );

  const buildGroupsFromLayer = useCallback(() => {
    const layer = tramosLayerRef.current;
    if (!google || !layer) {
      return { list: [], boundsAll: null, boundsMap: new Map(), samplesMap: new Map() };
    }

    const mapCounts = new Map();
    const boundsMap = new Map();
    const boundsAll = new google.maps.LatLngBounds();
    const samplesMap = new Map();

    let hasAny = false;

    layer.forEach((feature) => {
      const props = featureProps(feature);
      const idt = getIdTramo(props);
      if (!idt) return;

      const label = getLabelTramo(props) || `Tramo ${idt}`;
      const key = String(idt);
      const uso = getUsoText(props);

      const prev = mapCounts.get(key);
      mapCounts.set(key, {
        id_tramo: key,
        label,
        uso: prev?.uso || uso,
        count: (prev?.count || 0) + 1,
      });

      let b = boundsMap.get(key);
      if (!b) b = new google.maps.LatLngBounds();

      const geom = feature.getGeometry();
      if (geom) {
        geom.forEachLatLng((latLng) => {
          b.extend(latLng);
          boundsAll.extend(latLng);
          hasAny = true;
        });
      }

      boundsMap.set(key, b);

      const prevSamples = samplesMap.get(key) || [];
      const sampled = sampleLatLngsFromFeature(feature, PROG_SAMPLE_STEP);
      if (sampled.length) {
        samplesMap.set(key, prevSamples.concat(sampled));
      }
    });

    const list = Array.from(mapCounts.values()).sort((a, b) => {
      const byHuman = compareTramosHuman(a, b);
      if (byHuman !== 0) return byHuman;
      return String(a.id_tramo).localeCompare(String(b.id_tramo), "es", {
        numeric: true,
        sensitivity: "base",
      });
    });

    return { list, boundsAll: hasAny ? boundsAll : null, boundsMap, samplesMap };
  }, [google]);

  const applyFilterNow = useCallback((solo, active) => {
    const layer = tramosLayerRef.current;
    if (!layer) return;

    try {
      layer.revertStyle();
    } catch {}

    const soloX = !!solo;
    const activeX = String(active || "");

    if (!soloX || !activeX) {
      layer.forEach((feature) => layer.overrideStyle(feature, { visible: true }));
      return;
    }

    layer.forEach((feature) => {
      const props = featureProps(feature);
      const idt = String(getIdTramo(props) || "");
      const keep = idt === activeX;

      if (!keep) {
        layer.overrideStyle(feature, { visible: false });
      } else {
        const category = getUsoCategory(props);
        const road = category === "camino";

        layer.overrideStyle(feature, {
          visible: true,
          strokeColor: road ? "#000000" : "#facc15",
          fillColor: road ? "#000000" : "#facc15",
          strokeWeight: road ? 4 : 3,
          fillOpacity: road ? 0.25 : 0.18,
          zIndex: road ? 160 : 120,
        });
      }
    });
  }, []);

  const buildFeatureMapFromFC = useCallback((fc) => {
    const fm = new Map();
    const feats = fc?.features || [];
    for (const f of feats) {
      if (!f || f.type !== "Feature" || !f.geometry) continue;
      const props = f.properties || {};
      const idt = String(getIdTramo(props)).trim();
      if (!idt) continue;
      if (!fm.has(idt)) fm.set(idt, f);
    }
    return fm;
  }, []);

  const getLabelFromId = useCallback((idt) => {
    const id = String(idt || "");
    if (!id) return "";
    const found = tramosListRef.current.find((x) => String(x.id_tramo) === id);
    return found?.label || `Tramo ${id}`;
  }, []);

  const notifyParentSelect = useCallback(
    (idt) => {
      const id = String(idt || "");
      if (!id) {
        onSelectTramoRef.current?.("", null);
        onClearTramoRef.current?.();
        return;
      }

      const feature = tramoFeatureMapRef.current.get(id) || null;
      const label = getLabelFromId(id);

      onSelectTramoRef.current?.(id, { id_tramo: id, label, feature });
    },
    [getLabelFromId]
  );

  const loadTramosGeojson = useCallback(async () => {
    if (!pid || !google || !map) return tramosListRef.current.length > 0;
    if (loadLockRef.current) return tramosListRef.current.length > 0;

    const now = Date.now();
    if (lastLoadPidRef.current === pid && now - lastLoadAtRef.current < 900) {
      return tramosListRef.current.length > 0;
    }
    lastLoadPidRef.current = pid;
    lastLoadAtRef.current = now;

    loadLockRef.current = true;
    setLoadingTramos(true);
    setErrTramos("");

    abortRef.current.tramosGeo?.abort?.();
    abortRef.current.tramosGeo = new AbortController();

    const hadBefore = tramosListRef.current.length > 0;

    try {
      const got = await fetchFirstGeoJson(tramosGeojsonUrls, abortRef.current.tramosGeo.signal);

      if (!got?.fc?.features?.length) {
        if (!hadBefore) {
          onHasDataRef.current?.(false);
          setTramosVisibility(false);
          setEnabledTramos(false);
          enabledRef.current = false;
          clearTramoLabels();
        }
        return hadBefore;
      }

      if (!featureCollectionLooksWGS84(got.fc)) {
        setErrTramos(
          "GeoJSON de tramos NO está en EPSG:4326 (lon/lat). Backend debe ST_Transform(...,4326)."
        );
        if (!hadBefore) onHasDataRef.current?.(false);
        return hadBefore;
      }

      tramoFeatureMapRef.current = buildFeatureMapFromFC(got.fc);

      const layer = ensureTramosLayer();
      if (!layer) return hadBefore;

      setSrcTramos(got?.url || "");

      try {
        layer.setMap(map);
      } catch {}

      layer.forEach((f) => layer.remove(f));

      boundsAllRef.current = null;
      tramoBoundsMapRef.current = new Map();
      tramoSamplesMapRef.current = new Map();

      layer.addGeoJson(got.fc);

      const { list, boundsAll, boundsMap, samplesMap } = buildGroupsFromLayer();

      setTramosList(list);
      tramosListRef.current = list;

      boundsAllRef.current = boundsAll;
      tramoBoundsMapRef.current = boundsMap;
      tramoSamplesMapRef.current = samplesMap;

      await renderTramoLabels(list, boundsMap);

      const has = list.length > 0;
      onHasDataRef.current?.(has);
      onHasChartsRef.current?.(false);

      if (has) {
        const first = String(list[0].id_tramo);
        setActiveIdTramo((prev) => prev || first);
        activeRef.current = activeRef.current || first;

        setEnabledTramos(true);
        enabledRef.current = true;
        setTramosVisibility(true);

        applyFilterNow(soloRef.current, activeRef.current);
        applyTramoLabelsFilterNow();

        if (soloRef.current && activeRef.current) notifyParentSelect(activeRef.current);
      }

      scheduleApplyProgresivasFilter();

      return has;
    } catch (e) {
      if (e?.name === "AbortError") return hadBefore;
      console.error(e);
      setErrTramos(e?.message || "No se pudieron cargar los tramos.");
      if (!hadBefore) onHasDataRef.current?.(false);
      return hadBefore;
    } finally {
      setLoadingTramos(false);
      loadLockRef.current = false;
    }
  }, [
    pid,
    google,
    map,
    tramosGeojsonUrls,
    ensureTramosLayer,
    buildGroupsFromLayer,
    setTramosVisibility,
    applyFilterNow,
    applyTramoLabelsFilterNow,
    buildFeatureMapFromFC,
    notifyParentSelect,
    scheduleApplyProgresivasFilter,
    renderTramoLabels,
    clearTramoLabels,
  ]);

  const loadProgresivasGeojson = useCallback(async () => {
    if (!pid || !google || !map) return false;
    if (loadProgLockRef.current) return true;

    loadProgLockRef.current = true;
    setLoadingProgresivas(true);
    setErrProgresivas("");

    abortRef.current.progresivasGeo?.abort?.();
    abortRef.current.progresivasGeo = new AbortController();

    try {
      const got = await fetchFirstGeoJson(
        progresivasGeojsonUrls,
        abortRef.current.progresivasGeo.signal
      );

      if (!got?.fc?.features?.length) {
        setProgresivasVisibility(false);
        clearProgresivas();
        return false;
      }

      if (!featureCollectionLooksWGS84(got.fc)) {
        setErrProgresivas(
          "GeoJSON de progresivas NO está en EPSG:4326 (lon/lat). Backend debe ST_Transform(...,4326)."
        );
        return false;
      }

      setSrcProgresivas(got?.url || "");

      const ok = await renderProgresivas(got.fc);
      if (!ok) return false;

      scheduleApplyProgresivasFilter();
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return false;
      console.error(e);
      setErrProgresivas(e?.message || "No se pudieron cargar las progresivas.");
      return false;
    } finally {
      setLoadingProgresivas(false);
      loadProgLockRef.current = false;
    }
  }, [
    pid,
    google,
    map,
    progresivasGeojsonUrls,
    renderProgresivas,
    setProgresivasVisibility,
    clearProgresivas,
    scheduleApplyProgresivasFilter,
  ]);

  const toggleLayer = useCallback(
    async (next) => {
      setEnabledTramos(!!next);
      enabledRef.current = !!next;

      if (next) {
        let hasAny = tramosListRef.current.length > 0;
        if (!hasAny) hasAny = await loadTramosGeojson();

        if (hasAny) {
          setTramosVisibility(true);
          applyFilterNow(soloRef.current, activeRef.current);
          applyTramoLabelsFilterNow();

          if (soloRef.current && activeRef.current) {
            notifyParentSelect(activeRef.current);
          }
        } else {
          setTramosVisibility(false);
          clearTramoLabels();
        }
      } else {
        setTramosVisibility(false);
        clearTramoLabels();
        ensureInfoWindow()?.close?.();
      }

      scheduleApplyProgresivasFilter();
    },
    [
      applyFilterNow,
      applyTramoLabelsFilterNow,
      clearTramoLabels,
      ensureInfoWindow,
      loadTramosGeojson,
      setTramosVisibility,
      notifyParentSelect,
      scheduleApplyProgresivasFilter,
    ]
  );

  const toggleProgresivas = useCallback(
    async (next) => {
      setEnabledProgresivas(!!next);
      enabledProgRef.current = !!next;

      if (next) {
        const has = await loadProgresivasGeojson();
        if (has) {
          setProgresivasVisibility(true);
        } else {
          setProgresivasVisibility(false);
        }
      } else {
        setProgresivasVisibility(false);
        ensureInfoWindow()?.close?.();
      }

      scheduleApplyProgresivasFilter();
    },
    [loadProgresivasGeojson, setProgresivasVisibility, ensureInfoWindow, scheduleApplyProgresivasFilter]
  );

  useEffect(() => {
    if (!map || !google) return;

    const onZoomChanged = () => {
      scheduleApplyProgresivasFilter();
      applyTramoLabelsFilterNow();
    };

    const zoomListener = map.addListener("zoom_changed", onZoomChanged);
    const idleListener = map.addListener("idle", onZoomChanged);

    return () => {
      try {
        google.maps.event.removeListener(zoomListener);
      } catch {}
      try {
        google.maps.event.removeListener(idleListener);
      } catch {}
    };
  }, [map, google, scheduleApplyProgresivasFilter, applyTramoLabelsFilterNow]);

  useEffect(() => {
    scheduleApplyProgresivasFilter();
  }, [enabledProgresivas, soloActivo, activeIdTramo, scheduleApplyProgresivasFilter]);

  useEffect(() => {
    applyTramoLabelsFilterNow();
  }, [enabledTramos, soloActivo, activeIdTramo, applyTramoLabelsFilterNow]);

  useEffect(() => {
    if (!uiRef) return;

    uiRef.current = {
      openTramos: () => setPanelOpen(true),
      closeAll: () => setPanelOpen(false),

      setEnabled: (v) => toggleLayer(!!v),
      getEnabled: () => !!enabledRef.current,
      hasTramos: () => tramosListRef.current.length > 0,
      getActiveTramoGeojson: () => tramoFeatureMapRef.current.get(String(activeRef.current)) || null,

      setEnabledProgresivas: (v) => toggleProgresivas(!!v),
      getEnabledProgresivas: () => !!enabledProgRef.current,
    };

    return () => {
      try {
        if (uiRef.current) uiRef.current = null;
      } catch {}
    };
  }, [uiRef, toggleLayer, toggleProgresivas]);

  useEffect(() => {
    if (!pid || !google || !map) return;
    if (didInitRef.current.pid === pid) return;
    didInitRef.current.pid = pid;

    setPanelOpen(false);
    setSelectorOpen(false);

    setEnabledTramos(false);
    enabledRef.current = false;

    setEnabledProgresivas(false);
    enabledProgRef.current = false;

    setErrTramos("");
    setSrcTramos("");

    setErrProgresivas("");
    setSrcProgresivas("");

    setTramosList([]);
    tramosListRef.current = [];
    setActiveIdTramo("");
    activeRef.current = "";

    setSoloActivo(false);
    soloRef.current = false;

    try {
      tramosLayerRef.current?.setMap?.(null);
    } catch {}

    clearProgresivas();
    clearTramoLabels();

    boundsAllRef.current = null;
    tramoBoundsMapRef.current = new Map();
    tramoFeatureMapRef.current = new Map();
    tramoSamplesMapRef.current = new Map();

    (async () => {
      const has = await loadTramosGeojson();
      if (!has) {
        setEnabledTramos(false);
        enabledRef.current = false;
        setTramosVisibility(false);
      }
    })();
  }, [pid, google, map, loadTramosGeojson, setTramosVisibility, clearProgresivas, clearTramoLabels]);

  useEffect(() => {
    if (!enabledTramos) return;
    applyFilterNow(soloActivo, activeIdTramo);
  }, [enabledTramos, soloActivo, activeIdTramo, applyFilterNow]);

  useEffect(() => {
    return () => {
      abortRef.current.tramosGeo?.abort?.();
      abortRef.current.progresivasGeo?.abort?.();

      if (progFilterRafRef.current) {
        cancelAnimationFrame(progFilterRafRef.current);
        progFilterRafRef.current = 0;
      }

      try {
        tramosLayerRef.current?.setMap?.(null);
      } catch {}

      clearProgresivas();
      clearTramoLabels();

      try {
        iwRef.current?.close?.();
      } catch {}

      tramosLayerRef.current = null;
      iwRef.current = null;

      didInitRef.current = { pid: null };
      loadLockRef.current = false;
      loadProgLockRef.current = false;
      tramoFeatureMapRef.current = new Map();
      tramoSamplesMapRef.current = new Map();
    };
  }, [clearProgresivas, clearTramoLabels]);

  if (!visible || !google || !map || !pid) return null;

  const tramoCount = tramosList.length;
  const activeLabel =
    tramosList.find((t) => String(t.id_tramo) === String(activeRef.current))?.label ||
    (activeRef.current ? `Tramo ${activeRef.current}` : "Seleccionar tramo");

  return (
    <>
      {panelOpen && (
        <div
          style={{
            position: "absolute",
            top: 70,
            left: 14,
            width: 360,
            maxWidth: "calc(100vw - 20px)",
            height: 560,
            maxHeight: "calc(100vh - 110px)",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 12px 30px rgba(0,0,0,.22)",
            border: "1px solid rgba(0,0,0,.08)",
            zIndex: 9999,
            overflow: "hidden",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid rgba(0,0,0,.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Tramos</div>
              {tramoCount ? <Badge bg="secondary">{tramoCount}</Badge> : null}
            </div>

            <button
              onClick={() => setPanelOpen(false)}
              style={{
                border: 0,
                background: "transparent",
                fontSize: 22,
                lineHeight: 1,
                padding: "0 4px",
                cursor: "pointer",
              }}
              aria-label="Cerrar"
              title="Cerrar"
            >
              ×
            </button>
          </div>

          <div style={{ padding: 12, overflow: "auto" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>Mostrar/Ocultar tramos</span>
                <Form.Check
                  type="switch"
                  checked={!!enabledTramos}
                  onChange={(e) => toggleLayer(e.target.checked)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>Mostrar/Ocultar progresivas</span>
                <Form.Check
                  type="switch"
                  checked={!!enabledProgresivas}
                  onChange={(e) => toggleProgresivas(e.target.checked)}
                />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  style={{ flex: 1 }}
                  disabled={loadingTramos}
                  onClick={async () => {
                    const has = await loadTramosGeojson();
                    if (has) {
                      setEnabledTramos(true);
                      enabledRef.current = true;
                      setTramosVisibility(true);
                      applyFilterNow(soloRef.current, activeRef.current);
                      applyTramoLabelsFilterNow();

                      if (soloRef.current && activeRef.current) {
                        notifyParentSelect(activeRef.current);
                      }
                    }
                  }}
                >
                  {loadingTramos ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Cargando…
                    </>
                  ) : (
                    "Recargar tramos"
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="outline-secondary"
                  style={{ flex: 1 }}
                  disabled={loadingProgresivas}
                  onClick={async () => {
                    const has = await loadProgresivasGeojson();
                    if (has) {
                      setEnabledProgresivas(true);
                      enabledProgRef.current = true;
                      setProgresivasVisibility(true);
                    }
                  }}
                >
                  {loadingProgresivas ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Cargando…
                    </>
                  ) : (
                    "Recargar progresivas"
                  )}
                </Button>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  style={{ flex: 1 }}
                  onClick={centrarTodo}
                  disabled={!boundsAllRef.current}
                >
                  Centrar
                </Button>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>
                  {soloActivo ? "Solo tramo seleccionado" : "Mostrar todos"}
                </span>
                <Form.Check
                  type="switch"
                  checked={!!soloActivo}
                  onChange={(e) => {
                    const next = !!e.target.checked;
                    setSoloActivo(next);
                    soloRef.current = next;

                    if (!next) {
                      onSelectTramoRef.current?.("", null);
                      onClearTramoRef.current?.();
                    } else if (activeRef.current) {
                      notifyParentSelect(activeRef.current);
                    }

                    if (enabledRef.current) applyFilterNow(next, activeRef.current);
                    applyTramoLabelsFilterNow();
                    scheduleApplyProgresivasFilter();
                  }}
                  disabled={!tramoCount}
                />
              </div>

              <div style={{ fontSize: 11, opacity: 0.75 }}>
                Progresivas: etiquetas desde zoom {PROG_LABEL_MIN_ZOOM}, puntos desde zoom {PROG_MARKER_MIN_ZOOM}, cercanía {PROG_DISTANCE_METERS}m.
              </div>

              {errTramos ? (
                <div className="alert alert-warning mb-0" style={{ fontSize: 12 }}>
                  <b>⚠️</b> {errTramos}
                  {srcTramos ? (
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>
                      <b>Fuente:</b> {srcTramos}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {errProgresivas ? (
                <div className="alert alert-warning mb-0" style={{ fontSize: 12 }}>
                  <b>⚠️</b> {errProgresivas}
                  {srcProgresivas ? (
                    <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>
                      <b>Fuente:</b> {srcProgresivas}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ height: 10 }} />

            <div
              style={{
                border: "1px solid rgba(0,0,0,.08)",
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setSelectorOpen((v) => !v)}
                style={{
                  width: "100%",
                  border: 0,
                  background: "#f8fafc",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 900 }}>
                    {selectorOpen ? "▾" : "▸"} Tramos{" "}
                    {tramoCount ? <span style={{ opacity: 0.75 }}>({tramoCount})</span> : null}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {soloRef.current ? activeLabel : "Todos"}
                </div>
              </button>

              {selectorOpen && (
                <div style={{ padding: 10 }}>
                  {tramoCount === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>No hay tramos para mostrar.</div>
                  ) : (
                    <div
                      style={{
                        maxHeight: 260,
                        overflow: "auto",
                        display: "grid",
                        gap: 8,
                        paddingRight: 4,
                      }}
                    >
                      {tramosList.map((t) => {
                        const idt = String(t.id_tramo);
                        const isActive = String(activeRef.current) === idt;

                        return (
                          <button
                            key={idt}
                            type="button"
                            onClick={async () => {
                              if (!enabledRef.current) {
                                await toggleLayer(true);
                              } else {
                                setTramosVisibility(true);
                              }

                              setActiveIdTramo(idt);
                              activeRef.current = idt;

                              notifyParentSelect(idt);

                              setSoloActivo(true);
                              soloRef.current = true;

                              applyFilterNow(true, idt);
                              applyTramoLabelsFilterNow();

                              requestAnimationFrame(() => {
                                centrarTramo(idt);
                                scheduleApplyProgresivasFilter();
                              });
                            }}
                            style={{
                              width: "100%",
                              border: "1px solid rgba(0,0,0,.10)",
                              borderRadius: 12,
                              padding: "10px 12px",
                              textAlign: "left",
                              background: isActive ? "rgba(59,130,246,.10)" : "#fff",
                              boxShadow: isActive ? "0 0 0 2px rgba(59,130,246,.25) inset" : "none",
                            }}
                          >
                            <div style={{ fontWeight: 900 }}>{t.label || `Tramo ${t.id_tramo}`}</div>
                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                              <b>id_tramo:</b> {t.id_tramo}
                              {t.uso ? <> · <b>Uso:</b> {t.uso}</> : null}
                              {Number(t.count) > 0 ? <> · features: {t.count}</> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ height: 10 }} />

                  <Button
                    size="sm"
                    variant="outline-primary"
                    disabled={!tramoCount || !enabledTramos}
                    onClick={() => {
                      setSoloActivo(false);
                      soloRef.current = false;
                      applyFilterNow(false, activeRef.current);
                      applyTramoLabelsFilterNow();

                      onSelectTramoRef.current?.("", null);
                      onClearTramoRef.current?.();

                      requestAnimationFrame(() => {
                        centrarTodo();
                        scheduleApplyProgresivasFilter();
                      });
                    }}
                    style={{ width: "100%" }}
                  >
                    Mostrar todos
                  </Button>
                </div>
              )}
            </div>

            <div style={{ height: 6 }} />
          </div>
        </div>
      )}
    </>
  );
}