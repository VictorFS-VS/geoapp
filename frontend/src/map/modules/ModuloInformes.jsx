// src/map/modules/ModuloInformes.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InformeModal from "@/components/InformeModal";
import { Modal, Button, Spinner, Form } from "react-bootstrap";
import { alerts } from "@/utils/alerts";
import GestorNotificacionesProyecto from "@/components/GestorNotificacionesProyecto";

/* =========================
 * Config
 * ========================= */
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";
const HOST_BASE = BASE.replace(/\/api\/?$/i, "");

// ✅ default actual (si NO hay semáforo)
const DEFAULT_POINT_COLOR = "#db1732ff";

/* =========================================================
   ✅ Paleta estable para colores por plantilla
   ========================================================= */
const PLANTILLA_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#a855f7",
  "#0ea5e9",
  "#ef4444",
  "#14b8a6",
  "#f59e0b",
  "#84cc16",
  "#db2777",
  "#64748b",
  "#7c3aed",
];

function plantillaColorOf(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || !n) return null;
  const h = (n * 2654435761) >>> 0;
  return PLANTILLA_COLORS[h % PLANTILLA_COLORS.length];
}

const authHeaders = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

function handle401(resp) {
  if (resp?.status === 401) {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("access_token");
      localStorage.removeItem("jwt");
      localStorage.removeItem("user");
    } catch {}
    if (!String(window.location.pathname || "").includes("/login")) {
      window.location.replace("/login");
    }
    return true;
  }
  return false;
}

const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/* =========================================================
   ✅ Helpers de texto / tramo
   ========================================================= */
function normTxt(v = "") {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTramoKey(v) {
  if (v == null) return "";

  let s = String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (!s) return "";

  s = s
    .replace(/\btramo\b/g, "")
    .replace(/\bsub\s*tramo\b/g, "")
    .replace(/\bsubtramo\b/g, "")
    .replace(/\s+/g, "")
    .replace(/[_./\\-]+/g, "");

  const m = s.match(/[0-9]+[a-z0-9]*/g);
  if (!m || !m.length) return "";

  return m.join("");
}

function getActiveTramoKeyFromFilter(tramoFilter) {
  return normalizeTramoKey(
    tramoFilter?.activeTramoKey || tramoFilter?.activeTramoLabel || ""
  );
}

function isPreguntaTramo(etiqueta = "") {
  const e = normTxt(etiqueta);
  return (
    e === "tramo" ||
    e === "tramos" ||
    e === "sub tramo" ||
    e === "sub tramos" ||
    e === "subtramo" ||
    e === "subtramos" ||
    e.includes("tramo")
  );
}

function extractTramoKeysFromText(valor = "") {
  const raw = String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (!raw) return [];

  const found = new Set();

  const addCandidate = (txt) => {
    const k = normalizeTramoKey(txt);
    if (k) found.add(k);
  };

  addCandidate(raw);

  const patterns = [
    /\b(?:sub\s*tramo|subtramo|tramo)\s*[:#-]?\s*([0-9a-z]+(?:[\s._/-]*[0-9a-z]+)*)\b/gi,
    /\b([0-9]+(?:[\s._/-]*[a-z0-9]+)+)\b/gi,
    /\b([0-9]+[a-z]+[0-9a-z]*)\b/gi,
    /\b([a-z]*[0-9]+[a-z0-9-]*)\b/gi,
  ];

  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      if (m[1]) addCandidate(m[1]);
    }
  }

  return Array.from(found);
}

function informeRowsMatchTramo(rows = [], tramoFilter = {}) {
  if (!tramoFilter?.enabled) return true;

  const activeKey = getActiveTramoKeyFromFilter(tramoFilter);
  if (!activeKey) return true;

  for (const row of rows || []) {
    const etiqueta = row?.etiqueta || row?.pregunta || row?.label || "";
    const valor = row?.valor || row?.respuesta || row?.value || "";

    if (!isPreguntaTramo(etiqueta)) continue;

    const keys = extractTramoKeysFromText(valor);
    if (keys.includes(activeKey)) return true;
  }

  return false;
}

/* =========================================================
   ✅ HEX helpers
   ========================================================= */
function normalizeHexColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s;
  return null;
}

const SEMAFORO_NAME_TO_HEX = {
  verde: "#2ECC71",
  amarillo: "#FACC15",
  naranja: "#FB923C",
  rojo: "#EF4444",
};

function hexToRgba(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return null;

  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);

  if (h.length === 7) return { r, g, b, a: 1 };

  const a255 = parseInt(h.slice(7, 9), 16);
  const a = Math.max(0, Math.min(1, a255 / 255));
  return { r, g, b, a };
}

function hexToCssColor(hex) {
  const h = normalizeHexColor(hex);
  if (!h) return null;
  if (h.length === 7) return h;
  const rgba = hexToRgba(h);
  if (!rgba) return null;
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a.toFixed(3)})`;
}

function normColorName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseSemaforoAny(x) {
  if (x == null) return null;

  if (typeof x === "string") {
    const s = x.trim();
    const hx = normalizeHexColor(s);
    if (hx) return { nombre: null, hex: hx };

    const key = normColorName(s);
    const hx2 = SEMAFORO_NAME_TO_HEX[key] || null;
    return hx2 ? { nombre: s, hex: hx2 } : null;
  }

  if (typeof x === "object" && !Array.isArray(x)) {
    const nombre = x.nombre ?? x.name ?? x.label ?? x.color_name ?? null;
    const hexRaw = x.hex ?? x.color ?? x.value ?? x.semaforo_hex ?? null;

    const hx = normalizeHexColor(hexRaw);
    if (hx) return { nombre: nombre ? String(nombre).trim() : null, hex: hx };

    if (nombre) {
      const key = normColorName(nombre);
      const hx2 = SEMAFORO_NAME_TO_HEX[key] || null;
      return hx2 ? { nombre: String(nombre).trim(), hex: hx2 } : null;
    }
  }

  return null;
}

function getSemaforoFromProps(props) {
  const p = props || {};

  let s = parseSemaforoAny(p.semaforo);
  if (s?.hex) return s;

  const semJsonRaw = p.semaforo_json ?? p.semaforoJson ?? null;
  if (semJsonRaw != null) {
    let val = semJsonRaw;
    if (typeof val === "string") {
      const st = val.trim();
      if (st.startsWith("{") || st.startsWith("[")) {
        try {
          val = JSON.parse(st);
        } catch {}
      }
    }
    s = parseSemaforoAny(val);
    if (s?.hex) return s;
  }

  const vj = p.valor_json ?? p.valorJson ?? null;
  if (vj != null) {
    let val = vj;
    if (typeof val === "string") {
      const st = val.trim();
      if (st.startsWith("{") || st.startsWith("[")) {
        try {
          val = JSON.parse(st);
        } catch {}
      }
    }
    s = parseSemaforoAny(val);
    if (s?.hex) return s;
  }

  const raw =
    p.semaforo_hex ??
    p.semaforoHex ??
    p.semaforo_color ??
    p.semaforoColor ??
    p.color ??
    null;

  s = parseSemaforoAny(raw);
  return s?.hex ? s : null;
}

function getMarkerColorCssFromProps(props) {
  const sem = getSemaforoFromProps(props);
  if (sem?.hex) return hexToCssColor(sem.hex);
  return null;
}
const getMarkerColorFromProps = getMarkerColorCssFromProps;

function normalizeCoordsValue(v) {
  if (v == null || v === "") return null;

  if (typeof v === "object") {
    if (Array.isArray(v) && v.length >= 2) {
      const lat = toNum(v[0]);
      const lng = toNum(v[1]);
      return lat != null && lng != null ? { lat, lng } : null;
    }
    const lat = toNum(v.lat ?? v.latitude);
    const lng = toNum(v.lng ?? v.lon ?? v.longitude);
    return lat != null && lng != null ? { lat, lng } : null;
  }

  const s = String(v).trim();
  if (!s) return null;

  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      return normalizeCoordsValue(JSON.parse(s));
    } catch {}
  }

  if (s.includes(",")) {
    const [a, b] = s.split(",").map((x) => x.trim());
    const lat = toNum(a);
    const lng = toNum(b);
    return lat != null && lng != null ? { lat, lng } : null;
  }

  return null;
}

const fotoUrl = (ruta_archivo) => {
  if (!ruta_archivo) return "";
  const s = String(ruta_archivo).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  const clean = s.replace(/^\/+/, "");
  if (clean.startsWith("api/uploads/")) return `${HOST_BASE}/${clean}`;
  if (clean.startsWith("uploads/")) return `${HOST_BASE}/${clean}`;

  return `${HOST_BASE}/uploads/${clean}`;
};

const groupFotosByPregunta = (fotos = []) => {
  const m = {};
  for (const f of fotos || []) {
    const idp = Number(f?.id_pregunta);
    if (!idp) continue;
    if (!m[idp]) m[idp] = [];
    m[idp].push(f);
  }
  Object.values(m).forEach((arr) =>
    arr.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  );
  return m;
};

const computeBoundsFromPoints = (google, features) => {
  try {
    const b = new google.maps.LatLngBounds();
    let has = false;
    for (const f of features || []) {
      if (f?.geometry?.type !== "Point") continue;
      const [lng, lat] = f.geometry.coordinates || [];
      const la = toNum(lat);
      const ln = toNum(lng);
      if (la == null || ln == null) continue;
      has = true;
      b.extend(new google.maps.LatLng(la, ln));
    }
    return has ? b : null;
  } catch {
    return null;
  }
};

/* =========================================================
   ✅ DEDUPE de puntos
   ========================================================= */
function dedupePointFeatures(features = []) {
  const map = new Map();

  for (const f of features || []) {
    if (f?.geometry?.type !== "Point") continue;

    const p = f.properties || {};
    const idInf =
      Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;

    const [lngRaw, latRaw] = f.geometry.coordinates || [];
    const lat = toNum(latRaw);
    const lng = toNum(lngRaw);

    if (lat == null || lng == null) continue;

    const key = idInf
      ? `INF:${idInf}`
      : `XY:${lat.toFixed(6)},${lng.toFixed(6)}`;

    if (!map.has(key)) map.set(key, f);
  }

  return Array.from(map.values());
}

function buildChartStatsFromRows(rows = []) {
  const stats = {
    total: 0,
    si: 0,
    no: 0,
    vacio: 0,
    numericos: 0,
    sumaNumericos: 0,
  };

  for (const r of rows || []) {
    stats.total += 1;
    const v = (r?.valor ?? "").toString().trim();

    if (!v || v === "-" || v.toLowerCase() === "null") {
      stats.vacio += 1;
      continue;
    }
    if (
      v === "Sí" ||
      v === "Si" ||
      v.toLowerCase() === "sí" ||
      v.toLowerCase() === "si"
    ) {
      stats.si += 1;
      continue;
    }
    if (v === "No" || v.toLowerCase() === "no") {
      stats.no += 1;
      continue;
    }

    const n = toNum(v);
    if (n != null) {
      stats.numericos += 1;
      stats.sumaNumericos += n;
    }
  }

  const avg = stats.numericos ? stats.sumaNumericos / stats.numericos : null;
  return { ...stats, promedioNumericos: avg };
}

function extractInformeIdsFromFeatures(features = []) {
  const set = new Set();
  for (const f of features || []) {
    if (f?.geometry?.type !== "Point") continue;
    const p = f.properties || {};
    const idInf =
      Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
    if (idInf) set.add(idInf);
  }
  return Array.from(set);
}

function getPlantillaIdFromPointProps(props, metaMap, idInf) {
  const pidDirect =
    Number(
      props?.id_plantilla ??
        props?.plantilla_id ??
        props?.plantillaId ??
        props?.idPlantilla ??
        props?.__plantillaId
    ) || null;

  if (pidDirect) return pidDirect;

  const m = metaMap?.[idInf] || null;
  return Number(m?.plantillaId) || null;
}

async function fetchJsonSafe(url, signal) {
  try {
    const resp = await fetch(url, { headers: { ...authHeaders() }, signal });
    if (handle401(resp)) return null;

    const ct = resp.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    if (!resp.ok) return null;
    if (!isJson) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function tryGetPlantillaFromInformeIds(informeIds = [], signal) {
  const ids = (informeIds || []).filter(Boolean).slice(0, 5);
  if (!ids.length) return { plantilla: null, plantillaId: null };

  const pickPlantillaFromInforme = (data) => {
    const root = data?.data ?? data ?? {};

    const plantilla =
      root?.plantilla ??
      root?.data?.plantilla ??
      root?.share?.plantilla ??
      root?.informe?.plantilla ??
      null;

    const plantillaId =
      Number(
        root?.plantillaId ??
          root?.id_plantilla ??
          root?.idPlantilla ??
          root?.share?.id_plantilla ??
          root?.plantilla?.id_plantilla ??
          root?.plantilla?.idPlantilla ??
          root?.informe?.id_plantilla ??
          root?.informe?.plantillaId ??
          root?.item?.id_plantilla ??
          root?.item?.plantillaId
      ) || null;

    return { plantilla, plantillaId };
  };

  for (const idInf of ids) {
    const data = await fetchJsonSafe(`${API_URL}/informes/${idInf}`, signal);
    if (!data) continue;

    const { plantilla, plantillaId } = pickPlantillaFromInforme(data);

    if (plantilla) return { plantilla, plantillaId: plantillaId ?? null };

    if (plantillaId) {
      const pl = await fetchJsonSafe(
        `${API_URL}/informes/plantillas/${plantillaId}`,
        signal
      );
      if (pl) return { plantilla: pl?.data ?? pl, plantillaId };
      return { plantilla: null, plantillaId };
    }
  }

  return { plantilla: null, plantillaId: null };
}

function parseValorJson(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;

  const s = String(v).trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function formatRespuestaValue(r) {
  if (!r) return "";

  if (r.valor_bool !== null && r.valor_bool !== undefined)
    return r.valor_bool ? "Sí" : "No";

  if (r.valor_json != null && r.valor_json !== "") {
    const parsed = parseValorJson(r.valor_json);

    const coords = normalizeCoordsValue(parsed);
    if (coords) return `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;

    if (Array.isArray(parsed)) return parsed.join(", ");

    if (parsed && typeof parsed === "object") {
      try {
        return JSON.stringify(parsed);
      } catch {
        return String(r.valor_json);
      }
    }

    return String(parsed);
  }

  if (r.valor_texto != null) return String(r.valor_texto);

  return "";
}

export default function ModuloInformes({
  google,
  map,
  idProyecto,
  enabled = false,
  panelOpen = false,
  onPanelOpenChange,
  onDisable,
  onHasData,
  onHasCharts,
  onChartsInfo,
  tramoFilter,
}) {
  const pid = Number(idProyecto);
  const loadSeqRef = useRef(0);

  const markersRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const selectedMarkerOriginalContentRef = useRef(null);
  const lastFeaturesRef = useRef([]);
  const didLoadRef = useRef(false);
  const loadPointsAbortRef = useRef(null);

  const autoFitEnabledRef = useRef(true);
  const detalleTramoCacheRef = useRef(new Map());

  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);

  const [listOpen, setListOpen] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [rightOpen, setRightOpen] = useState(false);

  const [verInformeOpen, setVerInformeOpen] = useState(false);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleError, setDetalleError] = useState(null);
  const [detalleData, setDetalleData] = useState(null);
  const [detalleIdInforme, setDetalleIdInforme] = useState(null);

  const [fotosModalOpen, setFotosModalOpen] = useState(false);
  const [gestorNotificacionesOpen, setGestorNotificacionesOpen] = useState(false);

  const [chartsOpen, setChartsOpen] = useState(false);
  const [chartsStats, setChartsStats] = useState(null);
  const [chartsError, setChartsError] = useState(null);

  const [showViewInformeModal, setShowViewInformeModal] = useState(false);
  const [showEditInformeModal, setShowEditInformeModal] = useState(false);
  const [idInformeSelModal, setIdInformeSelModal] = useState(null);

  const abrirVerInforme = (idInforme) => {
    const id = Number(idInforme);
    if (!id) return;
    setIdInformeSelModal(id);
    setShowViewInformeModal(true);
    autoFitEnabledRef.current = false;
  };

  const abrirEditarInforme = (idInforme) => {
    const id = Number(idInforme);
    if (!id) return;
    setIdInformeSelModal(id);
    setShowEditInformeModal(true);
    autoFitEnabledRef.current = false;
  };

  const chartsReportedRef = useRef({
    pid: null,
    has: null,
    idsKey: "",
    plantillaId: null,
  });

  const chartsPayloadRef = useRef({
    ids: [],
    plantilla: null,
    plantillaId: null,
  });

  const allInformeIdsRef = useRef({
    pid: null,
    ids: [],
    ts: 0,
  });

  const [menuOpen, setMenuOpen] = useState(false);

  const [busqPreguntaId, setBusqPreguntaId] = useState("all");
  const [busqQ, setBusqQ] = useState("");
  const [busqLoading, setBusqLoading] = useState(false);
  const [busqError, setBusqError] = useState(null);
  const [busqResults, setBusqResults] = useState([]);
  const [preguntasOptions, setPreguntasOptions] = useState([]);
  const [busqApplyToMap, setBusqApplyToMap] = useState(true);

  const busqDebounceRef = useRef(null);
  const busqAbortRef = useRef(null);

  const setMarkerMap = (mk, m) => {
    if (!mk) return;
    if ("map" in mk) {
      try {
        mk.map = m;
        return;
      } catch {}
    }
    if (typeof mk.setMap === "function") mk.setMap(m);
  };

  const [filtroPlantillaId, setFiltroPlantillaId] = useState("all");
  const [filtroInformeId, setFiltroInformeId] = useState("all");
  const [filtrosOpen, setFiltrosOpen] = useState(false);

  const [filtroData, setFiltroData] = useState({
    map: {},
    plantillas: [],
    informes: [],
  });

  const informesMetaRef = useRef({ pid: null, map: {}, ts: 0 });
  const plantillaNameCacheRef = useRef({});

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        loadPointsAbortRef.current?.abort?.();
      } catch {}
      try {
        busqAbortRef.current?.abort?.();
      } catch {}
    };
  }, []);

  function pickMetaFromInformeDetail(data) {
    const root = data?.data ?? data ?? {};

    const plantilla =
      root?.plantilla ??
      root?.data?.plantilla ??
      root?.share?.plantilla ??
      root?.informe?.plantilla ??
      root?.item?.plantilla ??
      null;

    const plantillaId =
      Number(
        root?.plantillaId ??
          root?.id_plantilla ??
          root?.idPlantilla ??
          root?.share?.id_plantilla ??
          root?.plantilla?.id_plantilla ??
          root?.plantilla?.idPlantilla ??
          root?.informe?.id_plantilla ??
          root?.informe?.plantillaId ??
          root?.item?.id_plantilla ??
          root?.item?.plantillaId
      ) || null;

    const plantillaNombre =
      plantilla?.nombre ??
      plantilla?.titulo ??
      plantilla?.descripcion ??
      root?.plantilla_nombre ??
      (plantillaId ? `Plantilla #${plantillaId}` : null);

    const titulo =
      root?.titulo ??
      root?.nombre ??
      root?.encabezado ??
      root?.informe?.titulo ??
      root?.informe?.nombre ??
      root?.item?.titulo ??
      null;

    return { plantillaId, plantillaNombre, titulo };
  }

  const fetchGeoJSON = useCallback(async (url, parentSignal) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);

    const onAbort = () => ctrl.abort();
    try {
      parentSignal?.addEventListener?.("abort", onAbort, { once: true });
    } catch {}

    try {
      const resp = await fetch(url, {
        headers: { ...authHeaders() },
        signal: ctrl.signal,
      });

      if (handle401(resp)) throw new Error("Sesión expirada. Iniciá sesión de nuevo.");

      const ct = resp.headers.get("content-type") || "";
      const isJson =
        ct.includes("application/json") || ct.includes("application/geo+json");

      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          if (isJson) {
            const j = await resp.json();
            msg = j?.error || j?.message || msg;
          } else {
            msg = (await resp.text()) || msg;
          }
        } catch {}
        throw new Error(msg);
      }

      if (isJson) return await resp.json();

      const txt = await resp.text();
      return txt ? JSON.parse(txt) : {};
    } finally {
      clearTimeout(timer);
      try {
        parentSignal?.removeEventListener?.("abort", onAbort);
      } catch {}
    }
  }, []);

  const fetchInformeIdsByProyecto = useCallback(async (pidIn) => {
    const p = Number(pidIn || 0);
    if (!p) return [];

    const now = Date.now();
    if (
      allInformeIdsRef.current.pid === p &&
      Array.isArray(allInformeIdsRef.current.ids) &&
      allInformeIdsRef.current.ids.length &&
      now - (allInformeIdsRef.current.ts || 0) < 60_000
    ) {
      return allInformeIdsRef.current.ids;
    }

    const url = `${API_URL}/informes/proyecto/${p}`;

    try {
      const resp = await fetch(url, { headers: { ...authHeaders() } });
      if (handle401(resp)) return [];

      const ct = resp.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const data = isJson ? await resp.json() : null;

      if (!resp.ok || data?.ok === false) return [];

      const list =
        (Array.isArray(data?.informes) && data.informes) ||
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data?.rows) && data.rows) ||
        (Array.isArray(data?.data) && data.data) ||
        [];

      const ids = list
        .map((x) => Number(x.id_informe ?? x.id))
        .filter((n) => Number.isFinite(n) && n > 0);

      allInformeIdsRef.current = { pid: p, ids, ts: now };
      return ids;
    } catch {
      return [];
    }
  }, []);

  function buildPlantillasFromMetaMap(map) {
    const m = new Map();
    for (const it of Object.values(map || {})) {
      if (!it?.plantillaId) continue;
      const id = Number(it.plantillaId);
      if (!m.has(id)) {
        m.set(id, {
          id,
          nombre: it.plantillaNombre || `Plantilla #${id}`,
          color: it.plantillaColor || plantillaColorOf(id),
        });
      }
    }
    return Array.from(m.values()).sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""))
    );
  }

  function buildInformesFromMetaMap(map) {
    const arr = Object.values(map || {})
      .map((x) => ({
        id: Number(x.id_informe),
        titulo: x.titulo || `Informe #${x.id_informe}`,
        plantillaId: x.plantillaId ? Number(x.plantillaId) : null,
      }))
      .filter((x) => Number.isFinite(x.id) && x.id > 0);

    arr.sort((a, b) =>
      String(a.titulo || "").localeCompare(String(b.titulo || ""))
    );
    return arr;
  }

  const ensureInformesMeta = useCallback(async () => {
    if (!pid) return { map: {}, plantillas: [], informes: [] };

    const now = Date.now();
    if (
      informesMetaRef.current.pid === pid &&
      now - (informesMetaRef.current.ts || 0) < 60_000
    ) {
      const map = informesMetaRef.current.map || {};
      return {
        map,
        plantillas: buildPlantillasFromMetaMap(map),
        informes: buildInformesFromMetaMap(map),
      };
    }

    const ids = await fetchInformeIdsByProyecto(pid);
    if (!ids.length) {
      informesMetaRef.current = { pid, map: {}, ts: now };
      return { map: {}, plantillas: [], informes: [] };
    }

    const metaMap = {};
    const CONC = 6;
    let cursor = 0;

    async function worker(signal) {
      while (cursor < ids.length) {
        const idx = cursor++;
        const idInf = ids[idx];

        try {
          const data = await fetchJsonSafe(`${API_URL}/informes/${idInf}`, signal);
          const { plantillaId, plantillaNombre, titulo } =
            pickMetaFromInformeDetail(data);

          let nombreFinal = plantillaNombre || null;

          if (plantillaId) {
            const plId = Number(plantillaId);

            if (plantillaNameCacheRef.current[plId]) {
              nombreFinal = plantillaNameCacheRef.current[plId];
            } else {
              const looksGeneric =
                !nombreFinal ||
                String(nombreFinal).trim().toLowerCase().startsWith("plantilla #");

              if (looksGeneric) {
                const pl = await fetchJsonSafe(
                  `${API_URL}/informes/plantillas/${plId}`,
                  signal
                );
                const plRoot = pl?.data ?? pl ?? {};
                const n = plRoot?.nombre ?? plRoot?.titulo ?? null;

                if (n) {
                  nombreFinal = String(n).trim();
                  plantillaNameCacheRef.current[plId] = nombreFinal;
                } else {
                  nombreFinal = nombreFinal || `Plantilla #${plId}`;
                  plantillaNameCacheRef.current[plId] = nombreFinal;
                }
              } else {
                nombreFinal = String(nombreFinal).trim();
                plantillaNameCacheRef.current[plId] = nombreFinal;
              }
            }
          }

          metaMap[idInf] = {
            id_informe: idInf,
            titulo: titulo || `Informe #${idInf}`,
            plantillaId: plantillaId || null,
            plantillaNombre:
              nombreFinal || (plantillaId ? `Plantilla #${plantillaId}` : null),
            plantillaColor: plantillaId ? plantillaColorOf(plantillaId) : null,
          };
        } catch {
          metaMap[idInf] = {
            id_informe: idInf,
            titulo: `Informe #${idInf}`,
            plantillaId: null,
            plantillaNombre: null,
            plantillaColor: null,
          };
        }
      }
    }

    const ac = new AbortController();
    await Promise.all(
      Array.from({ length: Math.min(CONC, ids.length) }, () => worker(ac.signal))
    );

    informesMetaRef.current = { pid, map: metaMap, ts: now };

    return {
      map: metaMap,
      plantillas: buildPlantillasFromMetaMap(metaMap),
      informes: buildInformesFromMetaMap(metaMap),
    };
  }, [pid, fetchInformeIdsByProyecto]);

  const loadFiltroData = useCallback(async () => {
    if (!pid) {
      const empty = { map: {}, plantillas: [], informes: [] };
      if (mountedRef.current) setFiltroData(empty);
      return empty;
    }

    const meta = await ensureInformesMeta();
    const metaMap = meta?.map || {};

    let featuresAll = [];
    try {
      const urlPts = `${API_URL}/informes/proyecto/${pid}/puntos?_ts=${Date.now()}`;
      const dataPts = await fetchGeoJSON(urlPts);
      featuresAll = dedupePointFeatures(
        Array.isArray(dataPts?.features) ? dataPts.features : []
      );
    } catch {
      featuresAll = [];
    }

    const informeIdsConPuntos = new Set();
    const plantillaIdsConPuntos = new Set();

    for (const f of featuresAll) {
      if (f?.geometry?.type !== "Point") continue;

      const p = f.properties || {};
      const idInf =
        Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
      if (!idInf) continue;

      const [lng, lat] = f.geometry.coordinates || [];
      const la = toNum(lat);
      const ln = toNum(lng);

      if (la == null || ln == null) continue;

      informeIdsConPuntos.add(idInf);

      const plId = getPlantillaIdFromPointProps(p, metaMap, idInf);
      if (plId) plantillaIdsConPuntos.add(Number(plId));
    }

    let plantillas = meta?.plantillas || [];
    let informes = meta?.informes || [];

    if (plantillaIdsConPuntos.size > 0) {
      plantillas = plantillas.filter((pl) =>
        plantillaIdsConPuntos.has(Number(pl.id))
      );
    } else {
      plantillas = [];
    }

    if (informeIdsConPuntos.size > 0) {
      informes = informes.filter((it) => informeIdsConPuntos.has(Number(it.id)));
    } else {
      informes = [];
    }

    const safe = { map: metaMap, plantillas, informes };
    if (mountedRef.current) setFiltroData(safe);
    return safe;
  }, [pid, ensureInformesMeta, fetchGeoJSON]);

  const reportChartsAvailability = useCallback(
    async (features) => {
      if (typeof onHasCharts !== "function") return;
      if (!pid) return;

      const idsFromPoints = extractInformeIdsFromFeatures(features);

      const idsFromProyecto = await fetchInformeIdsByProyecto(pid);
      const ids =
        idsFromProyecto && idsFromProyecto.length
          ? idsFromProyecto
          : idsFromPoints;

      const has = ids.length > 0;

      chartsPayloadRef.current = { ids, plantilla: null, plantillaId: null };

      if (!has) {
        const prev = chartsReportedRef.current;
        if (prev.pid !== pid || prev.has !== false) {
          chartsReportedRef.current = {
            pid,
            has: false,
            idsKey: "",
            plantillaId: null,
          };
          try {
            onHasCharts({
              has: false,
              ids: [],
              plantilla: null,
              plantillaId: null,
            });
          } catch {}
        }
        return;
      }

      const ac = new AbortController();
      const { plantilla, plantillaId } = await tryGetPlantillaFromInformeIds(ids, ac.signal);

      chartsPayloadRef.current = {
        ids,
        plantilla: plantilla ?? null,
        plantillaId: plantillaId ?? null,
      };

      const idsKey = ids.join(",");
      const prev = chartsReportedRef.current;

      const changed =
        prev.pid !== pid ||
        prev.has !== true ||
        prev.idsKey !== idsKey ||
        (prev.plantillaId ?? null) !== (plantillaId ?? null);

      if (!changed) return;

      chartsReportedRef.current = {
        pid,
        has: true,
        idsKey,
        plantillaId: plantillaId ?? null,
      };

      try {
        onHasCharts({
          has: true,
          ids,
          plantilla: plantilla ?? null,
          plantillaId: plantillaId ?? null,
        });
      } catch (e) {
        console.warn("onHasCharts error:", e);
      }
    },
    [pid, onHasCharts, fetchInformeIdsByProyecto]
  );

  const checkHasPuntos = useCallback(async () => {
    if (!pid) return;
    try {
      const url = `${API_URL}/informes/proyecto/${pid}/puntos`;
      const data = await fetchGeoJSON(url);

      const features = dedupePointFeatures(
        Array.isArray(data?.features) ? data.features : []
      );
      const pointCount = features.filter((f) => f?.geometry?.type === "Point").length;

      if (typeof onHasData === "function") onHasData(pointCount > 0);
      lastFeaturesRef.current = features;

      Promise.resolve()
        .then(() => reportChartsAvailability(features))
        .catch((e) => {
          console.warn("reportChartsAvailability error:", e);
        });
    } catch (e) {
      console.warn("checkHasPuntos error:", e);
      if (typeof onHasData === "function") onHasData(true);
    }
  }, [pid, fetchGeoJSON, onHasData, reportChartsAvailability]);

  useEffect(() => {
    if (!pid) return;
    checkHasPuntos();
  }, [pid, checkHasPuntos]);

  useEffect(() => {
    if (typeof onPanelOpenChange === "function") {
      onPanelOpenChange(!!panelOpen);
    }
  }, [panelOpen, onPanelOpenChange]);

  const clearMarkers = useCallback(() => {
    for (const m of markersRef.current || []) {
      if (!m) continue;
      try {
        if ("map" in m) {
          m.map = null;
        } else if (typeof m.setMap === "function") {
          m.setMap(null);
        }
      } catch {}
    }

    markersRef.current = [];
    lastFeaturesRef.current = [];
    selectedMarkerRef.current = null;
    selectedMarkerOriginalContentRef.current = null;
    setCount(0);
  }, []);

  const highlightMarker = useCallback(
    (idInforme) => {
      const prev = selectedMarkerRef.current;
      const prevOriginal = selectedMarkerOriginalContentRef.current;

      if (prev && prevOriginal) {
        try {
          if ("content" in prev) prev.content = prevOriginal;
        } catch {}
      }

      selectedMarkerRef.current = null;
      selectedMarkerOriginalContentRef.current = null;

      if (!idInforme) return;

      const targetMarker = (markersRef.current || []).find(
        (m) => m && Number(m.__idInforme) === Number(idInforme)
      );

      if (!targetMarker) return;

      selectedMarkerRef.current = targetMarker;

      if ("content" in targetMarker) {
        const originalEl = targetMarker.content;
        if (originalEl) {
          selectedMarkerOriginalContentRef.current = originalEl.cloneNode(true);
        }

        const el = document.createElement("div");
        el.className = "emapoint-selected";

        const cRaw = targetMarker.__markerColor || DEFAULT_POINT_COLOR;
        const c = hexToCssColor(cRaw) || cRaw;

        el.style.width = "22px";
        el.style.height = "22px";
        el.style.borderRadius = "999px";
        el.style.background = c;
        el.style.border = "4px solid #fff";
        el.style.boxShadow = "0 10px 22px rgba(0,0,0,.28)";

        targetMarker.content = el;

        try {
          targetMarker.zIndex = 999999;
        } catch {}
        return;
      }

      if (typeof targetMarker.setZIndex === "function") {
        targetMarker.setZIndex(999999);
      }

      if (
        typeof targetMarker.setAnimation === "function" &&
        google?.maps?.Animation
      ) {
        targetMarker.setAnimation(google.maps.Animation.BOUNCE);
        window.setTimeout(() => {
          try {
            targetMarker.setAnimation(null);
          } catch {}
        }, 2500);
      }
    },
    [google]
  );

  useEffect(() => {
    const m = map;
    if (!m) return;

    markersRef.current.forEach((mk) => {
      if (!mk) return;
      if ("map" in mk) {
        try {
          mk.map = enabled ? m : null;
          return;
        } catch {}
      }
      if (typeof mk.setMap === "function") mk.setMap(enabled ? m : null);
    });
  }, [enabled, map]);

  const openPointPanel = useCallback(
    (props) => {
      setSelectedPoint(props || null);
      setRightOpen(true);

      setVerInformeOpen(false);
      setDetalleLoading(false);
      setDetalleError(null);
      setDetalleData(null);
      setDetalleIdInforme(null);
      setFotosModalOpen(false);

      setChartsOpen(false);
      setChartsStats(null);
      setChartsError(null);

      setMenuOpen(false);

      const idInf = props?.id_informe ?? props?.idInforme ?? props?.id ?? null;
      highlightMarker(idInf);
    },
    [highlightMarker]
  );

  const pointsIndexByInformeId = useMemo(() => {
    const feats = lastFeaturesRef.current || [];
    const metaMap = informesMetaRef.current?.map || {};
    const m = new Map();

    for (const f of feats) {
      if (f?.geometry?.type !== "Point") continue;

      const p = f.properties || {};
      const idInf =
        Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
      if (!idInf) continue;

      const [lng, lat] = f.geometry.coordinates || [];
      const la = toNum(lat);
      const ln = toNum(lng);
      if (la == null || ln == null) continue;

      const metaInf = metaMap[idInf] || null;
      const plantillaId = getPlantillaIdFromPointProps(p, metaMap, idInf);

      const plantillaNombre =
        p?.nombre_plantilla ??
        p?.plantilla_nombre ??
        p?.plantilla ??
        metaInf?.plantillaNombre ??
        (plantillaId ? `Plantilla #${plantillaId}` : null);

      const plantillaColor = plantillaId
        ? metaInf?.plantillaColor || plantillaColorOf(plantillaId)
        : null;

      const semaforoColorCss = getMarkerColorFromProps(p);
      const markerColorCss =
        semaforoColorCss ||
        plantillaColor ||
        hexToCssColor(DEFAULT_POINT_COLOR) ||
        DEFAULT_POINT_COLOR;

      const propsEnriched = {
        ...p,
        id_informe: idInf ?? p.id_informe,
        __plantillaId: plantillaId,
        __plantillaNombre: plantillaNombre,
        __plantillaColor: plantillaColor,
        __markerColor: markerColorCss,
      };

      if (!m.has(idInf)) {
        m.set(idInf, { lat: la, lng: ln, props: propsEnriched });
      }
    }

    return m;
  }, [pid, count]);

  const puntosList = useMemo(() => {
    const feats = lastFeaturesRef.current || [];
    const metaMap = informesMetaRef.current?.map || {};

    return feats
      .filter((f) => f?.geometry?.type === "Point")
      .map((f, idx) => {
        const p = f.properties || {};
        const idInf =
          Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;

        const titulo = String(
          p.titulo ||
            p.nombre ||
            (idInf ? `Informe #${idInf}` : `Punto ${idx + 1}`)
        );

        const [lng, lat] = f.geometry.coordinates || [];

        const metaInf = idInf ? metaMap[idInf] : null;
        const plantillaId = getPlantillaIdFromPointProps(p, metaMap, idInf);

        const plantillaColor = plantillaId
          ? metaInf?.plantillaColor || plantillaColorOf(plantillaId)
          : null;

        const semaforoColorCss = getMarkerColorFromProps(p);
        const markerColorCss =
          semaforoColorCss ||
          plantillaColor ||
          hexToCssColor(DEFAULT_POINT_COLOR) ||
          DEFAULT_POINT_COLOR;

        const propsEnriched = {
          ...p,
          id_informe: idInf ?? p.id_informe,
          __plantillaId: plantillaId,
          __plantillaNombre:
            metaInf?.plantillaNombre ||
            (plantillaId ? `Plantilla #${plantillaId}` : null),
          __plantillaColor: plantillaColor,
          __markerColor: markerColorCss,
        };

        return {
          key: `${idInf || "p"}-${idx}`,
          id_informe: idInf,
          titulo,
          lat: toNum(lat),
          lng: toNum(lng),
          props: propsEnriched,
        };
      });
  }, [pid, count]);

  const zoomToPoint = useCallback(
    (lat, lng, zoom = 19) => {
      if (!map) return;
      if (lat == null || lng == null) return;

      const pos = { lat: Number(lat), lng: Number(lng) };
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;

      autoFitEnabledRef.current = false;
      map.panTo(pos);

      try {
        map.setZoom(zoom);
      } catch {}
    },
    [map]
  );

  const focusSearchResult = useCallback(
    (item) => {
      if (!item) return;

      const idInf = Number(item?.id_informe) || null;

      openPointPanel(item.props);

      if (item.lat != null && item.lng != null) {
        zoomToPoint(item.lat, item.lng, 19);
        return;
      }

      const mk = (markersRef.current || []).find(
        (m) => Number(m?.__idInforme) === idInf
      );

      if (mk?.position) {
        const pos =
          typeof mk.position?.toJSON === "function"
            ? mk.position.toJSON()
            : mk.position;

        if (pos?.lat != null && pos?.lng != null) {
          zoomToPoint(pos.lat, pos.lng, 19);
        }
      }
    },
    [openPointPanel, zoomToPoint]
  );

  const buscarRespuestas = useCallback(async () => {
    const q = String(busqQ || "").trim();
    if (q.length < 2) {
      setBusqResults([]);
      setBusqError(null);
      return;
    }

    try {
      busqAbortRef.current?.abort?.();
    } catch {}
    busqAbortRef.current = new AbortController();
    const signal = busqAbortRef.current.signal;

    setBusqLoading(true);
    setBusqError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("q", q);
      if (busqPreguntaId !== "all") qs.set("pregunta", String(busqPreguntaId));
      qs.set("limit", "80");
      qs.set("_ts", String(Date.now()));

      const url = `${API_URL}/informes/proyecto/${pid}/buscar-respuestas?${qs.toString()}`;
      const resp = await fetch(url, { headers: { ...authHeaders() }, signal });
      if (handle401(resp)) return;

      const data = await resp.json().catch(() => null);
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `Error ${resp.status}`);
      }

      const items = (Array.isArray(data?.items) && data.items) || [];
      const uniq = new Map();

      for (const it of items) {
        const idInf = Number(it.id_informe) || null;
        const idPregunta = Number(it.id_pregunta) || null;
        const valorTxt = String(it.valor ?? "").trim().toLowerCase();

        const found = idInf ? pointsIndexByInformeId.get(idInf) : null;

        const row = {
          id_informe: idInf,
          titulo:
            it.titulo ||
            found?.props?.titulo ||
            (idInf ? `Informe #${idInf}` : ""),
          id_pregunta: idPregunta,
          etiqueta:
            it.etiqueta ||
            (idPregunta ? `Pregunta #${idPregunta}` : ""),
          valor: it.valor ?? "",
          lat: found?.lat ?? null,
          lng: found?.lng ?? null,
          props: found?.props ?? { id_informe: idInf, titulo: it.titulo },
        };

        const key = `${idInf || 0}-${idPregunta || 0}-${valorTxt}`;
        if (!uniq.has(key)) uniq.set(key, row);
      }

      const mapped = Array.from(uniq.values());
      setBusqResults(mapped);
    } catch (e) {
      if (String(e?.name) === "AbortError") return;
      setBusqError(e?.message || "No se pudo buscar.");
      setBusqResults([]);
    } finally {
      if (mountedRef.current) setBusqLoading(false);
    }
  }, [busqQ, busqPreguntaId, pid, pointsIndexByInformeId]);

  useEffect(() => {
    const q = String(busqQ || "").trim();

    if (q.length < 2) {
      setBusqResults([]);
      setBusqError(null);
      return;
    }

    if (busqDebounceRef.current) clearTimeout(busqDebounceRef.current);
    busqDebounceRef.current = setTimeout(() => {
      autoFitEnabledRef.current = false;
      buscarRespuestas();
    }, 300);

    return () => {
      if (busqDebounceRef.current) clearTimeout(busqDebounceRef.current);
    };
  }, [busqQ, busqPreguntaId, buscarRespuestas]);

  useEffect(() => {
    if (!map) return;

    const q = String(busqQ || "").trim();
    const searching = q.length >= 2;

    if (!enabled) {
      (markersRef.current || []).forEach((mk) => setMarkerMap(mk, null));
      return;
    }

    if (!busqApplyToMap) {
      (markersRef.current || []).forEach((mk) => setMarkerMap(mk, map));
      return;
    }

    if (!searching) {
      (markersRef.current || []).forEach((mk) => setMarkerMap(mk, map));
      return;
    }

    if (busqLoading) return;

    const ids = new Set(
      (busqResults || [])
        .map((r) => Number(r?.id_informe))
        .filter((n) => Number.isFinite(n) && n > 0)
    );

    (markersRef.current || []).forEach((mk) => {
      const idInf = Number(mk?.__idInforme) || null;
      const visible = ids.has(idInf);
      setMarkerMap(mk, visible ? map : null);
    });
  }, [busqQ, busqResults, busqLoading, busqApplyToMap, enabled, map]);

  const loadPreguntasOptions = useCallback(async () => {
    if (!pid) return [];
    try {
      const url = `${API_URL}/informes/proyecto/${pid}/preguntas`;
      const resp = await fetch(url, { headers: { ...authHeaders() } });
      if (handle401(resp)) return [];

      const data = await resp.json().catch(() => null);
      const items = (Array.isArray(data?.items) && data.items) || [];

      const opts = items
        .map((x) => ({
          id: Number(x.id_pregunta),
          etiqueta: x.etiqueta || `Pregunta #${x.id_pregunta}`,
        }))
        .filter((x) => x.id);

      setPreguntasOptions(opts);
      return opts;
    } catch {
      setPreguntasOptions([]);
      return [];
    }
  }, [pid]);

  const flyToItem = (item) => {
    if (!map || !item) return;
    if (item.lat == null || item.lng == null) return;
    map.panTo({ lat: item.lat, lng: item.lng });
    map.setZoom(Math.max(map.getZoom() || 7, 16));
    openPointPanel(item.props);
    autoFitEnabledRef.current = false;
  };

  const fetchInformeRowsLite = useCallback(async (idInforme, parentSignal) => {
    if (!idInforme) return [];

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

    const onAbort = () => ctrl.abort();
    try {
      parentSignal?.addEventListener?.("abort", onAbort, { once: true });
    } catch {}

    try {
      const resp = await fetch(`${API_URL}/informes/${idInforme}`, {
        headers: { ...authHeaders() },
        signal: ctrl.signal,
      });

      if (handle401(resp)) return [];

      const ct = resp.headers.get("content-type") || "";
      const isJson = ct.includes("application/json");
      const data = isJson ? await resp.json() : null;

      if (!resp.ok || data?.ok === false) return [];

      if (Array.isArray(data?.rows)) return data.rows;
      if (Array.isArray(data?.data?.rows)) return data.data.rows;

      const preguntas = data?.preguntas || data?.data?.preguntas || [];
      const respuestas = data?.respuestas || data?.data?.respuestas || [];

      const mapResp = new Map();
      for (const r of respuestas) {
        const idp = r?.id_pregunta;
        if (!idp) continue;
        const v = formatRespuestaValue(r);
        mapResp.set(idp, v || "");
      }

      return preguntas.map((p) => ({
        id_pregunta: p.id_pregunta,
        etiqueta: p.etiqueta || `Pregunta ${p.id_pregunta}`,
        valor: mapResp.get(p.id_pregunta) || "-",
      }));
    } catch (e) {
      if (String(e?.name) === "AbortError") return [];
      return [];
    } finally {
      clearTimeout(timer);
      try {
        parentSignal?.removeEventListener?.("abort", onAbort);
      } catch {}
    }
  }, []);

  const doesInformeMatchTramo = useCallback(
    async (idInforme, props, signal) => {
      if (!tramoFilter?.enabled) return true;

      const activeKey = getActiveTramoKeyFromFilter(tramoFilter);
      if (!activeKey) return true;

      const idInf = Number(idInforme) || null;
      if (!idInf) return false;

      const cacheKey = `${idInf}|${activeKey}`;
      if (detalleTramoCacheRef.current.has(cacheKey)) {
        return !!detalleTramoCacheRef.current.get(cacheKey);
      }

      const directCandidates = [
        props?.tramo,
        props?.TRAMO,
        props?.subtramo,
        props?.sub_tramo,
        props?.subTramo,
        props?.tramos,
        props?.subtramos,
        props?.label_tramo,
        props?.tramo_label,
        props?.nombre_tramo,
        props?.descripcion_tramo,
      ].filter((x) => x != null && x !== "");

      for (const candidate of directCandidates) {
        const keys = extractTramoKeysFromText(candidate);
        if (keys.includes(activeKey)) {
          detalleTramoCacheRef.current.set(cacheKey, true);
          return true;
        }
      }

      const rows = await fetchInformeRowsLite(idInf, signal);
      const ok = informeRowsMatchTramo(rows, tramoFilter);

      detalleTramoCacheRef.current.set(cacheKey, !!ok);
      return !!ok;
    },
    [tramoFilter, fetchInformeRowsLite]
  );

  const filterFeaturesByTramoSelection = useCallback(
    async (features, signal) => {
      if (!tramoFilter?.enabled) return features;

      const activeKey = getActiveTramoKeyFromFilter(tramoFilter);
      if (!activeKey) return features;

      const ids = Array.from(
        new Set(
          (features || [])
            .filter((f) => f?.geometry?.type === "Point")
            .map((f) => {
              const p = f.properties || {};
              return Number(
                p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk
              ) || null;
            })
            .filter(Boolean)
        )
      );

      if (!ids.length) return [];

      const resultMap = new Map();
      const CONC = 3;
      let cursor = 0;

      async function worker() {
        while (cursor < ids.length) {
          if (signal?.aborted) return;

          const idx = cursor++;
          const idInf = ids[idx];

          const feature = (features || []).find((f) => {
            const p = f?.properties || {};
            const n =
              Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
            return n === idInf;
          });

          const props = feature?.properties || {};

          try {
            const ok = await doesInformeMatchTramo(idInf, props, signal);
            resultMap.set(idInf, !!ok);
          } catch (e) {
            console.warn("doesInformeMatchTramo error:", idInf, e);
            resultMap.set(idInf, true);
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONC, ids.length) }, () => worker())
      );

      return (features || []).filter((f) => {
        if (f?.geometry?.type !== "Point") return false;
        const p = f.properties || {};
        const idInf =
          Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
        return !!resultMap.get(idInf);
      });
    },
    [tramoFilter, doesInformeMatchTramo]
  );

  const loadInformesPoints = useCallback(async () => {
    if (!google || !map || !pid) return;

    const seq = ++loadSeqRef.current;

    try {
      loadPointsAbortRef.current?.abort?.();
    } catch {}

    const ac = new AbortController();
    loadPointsAbortRef.current = ac;

    setLoading(true);

    try {
      clearMarkers();

      let metaMap = {};
      if (informesMetaRef.current?.pid === pid) {
        metaMap = informesMetaRef.current.map || {};
      }

      Promise.resolve()
        .then(() => ensureInformesMeta())
        .then((meta) => {
          if (!mountedRef.current || !meta) return;

          informesMetaRef.current = {
            pid,
            map: meta?.map || {},
            ts: Date.now(),
          };

          setFiltroData({
            map: meta?.map || {},
            plantillas: meta?.plantillas || [],
            informes: meta?.informes || [],
          });
        })
        .catch(() => {});

      const qs = new URLSearchParams();
      if (filtroInformeId !== "all") qs.set("informe", String(filtroInformeId));
      if (filtroPlantillaId !== "all") qs.set("plantilla", String(filtroPlantillaId));
      qs.set("_ts", String(Date.now()));

      const url = `${API_URL}/informes/proyecto/${pid}/puntos?${qs.toString()}`;
      const data = await fetchGeoJSON(url, ac.signal);
      if (ac.signal.aborted || seq !== loadSeqRef.current) return;

      if (data?.ok === false) {
        throw new Error(data?.error || "No se pudieron cargar los puntos.");
      }

      let features = Array.isArray(data?.features) ? data.features : [];
      features = dedupePointFeatures(features);

      const infId =
        filtroInformeId === "all" ? null : Number(filtroInformeId) || null;

      if (infId) {
        features = features.filter((f) => {
          if (f?.geometry?.type !== "Point") return false;
          const p = f.properties || {};
          const idInf =
            Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) || null;
          return idInf && Number(idInf) === Number(infId);
        });
      }

      const tramoActivoKey = getActiveTramoKeyFromFilter(tramoFilter);

      if (tramoFilter?.enabled && tramoActivoKey) {
        try {
          features = await filterFeaturesByTramoSelection(features, ac.signal);
        } catch {
          features = [];
        }
      }

      if (ac.signal.aborted || seq !== loadSeqRef.current) return;

      lastFeaturesRef.current = features;

      const pointCount = features.filter((f) => f?.geometry?.type === "Point").length;
      if (typeof onHasData === "function") onHasData(pointCount > 0);

      try {
        await google.maps.importLibrary("marker");
      } catch {}

      const AdvancedMarker = google?.maps?.marker?.AdvancedMarkerElement;
      const PinElement = google?.maps?.marker?.PinElement;

      const created = [];

      for (const f of features) {
        if (ac.signal.aborted || seq !== loadSeqRef.current) break;
        if (f?.geometry?.type !== "Point") continue;

        const [lng, lat] = f.geometry.coordinates || [];
        const props = f.properties || {};

        const pos = { lat: toNum(lat), lng: toNum(lng) };
        if (pos.lat == null || pos.lng == null) continue;

        const idInf =
          Number(
            props.id_informe ?? props.idInforme ?? props.id ?? props.id_informe_fk
          ) || null;

        const title = props.titulo || (idInf ? `Informe #${idInf}` : "Informe");

        const plantillaId = getPlantillaIdFromPointProps(props, metaMap, idInf);
        const metaInf = idInf ? metaMap[idInf] : null;

        const plantillaNombre =
          props?.nombre_plantilla ??
          props?.plantilla_nombre ??
          props?.plantilla ??
          metaInf?.plantillaNombre ??
          (plantillaId ? `Plantilla #${plantillaId}` : null);

        const plantillaColor = plantillaId
          ? metaInf?.plantillaColor || plantillaColorOf(plantillaId)
          : null;

        const semaforoColorCss = getMarkerColorFromProps(props);

        const forcedPlantColor =
          filtroPlantillaId !== "all"
            ? plantillaColorOf(filtroPlantillaId)
            : null;

        const markerColorCss =
          semaforoColorCss ||
          forcedPlantColor ||
          plantillaColor ||
          hexToCssColor(DEFAULT_POINT_COLOR) ||
          DEFAULT_POINT_COLOR;

        const propsEnriched = {
          ...props,
          id_informe: idInf ?? props.id_informe,
          __plantillaId: plantillaId,
          __plantillaNombre: plantillaNombre,
          __plantillaColor: plantillaColor,
          __markerColor: markerColorCss,
        };

        let mk = null;

        if (AdvancedMarker && PinElement) {
          const pin = new PinElement({
            background: markerColorCss,
            borderColor: "#ffffff",
            glyphColor: "#ffffff",
            glyph: "📍",
            scale: 1.1,
          });

          mk = new AdvancedMarker({
            map: enabled ? map : null,
            position: pos,
            content: pin.element,
            title,
          });

          mk.addListener("gmp-click", () => openPointPanel(propsEnriched));
        } else if (AdvancedMarker) {
          const el = document.createElement("div");
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.borderRadius = "999px";
          el.style.background = markerColorCss;
          el.style.border = "3px solid #fff";
          el.style.boxShadow = "0 6px 16px rgba(0,0,0,.22)";

          mk = new AdvancedMarker({
            map: enabled ? map : null,
            position: pos,
            content: el,
            title,
          });

          mk.addListener("gmp-click", () => openPointPanel(propsEnriched));
        } else {
          mk = new google.maps.Marker({
            map: enabled ? map : null,
            position: pos,
            title,
          });

          mk.addListener("click", () => openPointPanel(propsEnriched));
        }

        if (!mk) continue;

        mk.__idInforme = idInf;
        mk.__plantillaId = plantillaId;
        mk.__markerColor = markerColorCss;
        mk.__baseMap = map;

        try {
          if ("zIndex" in mk) mk.zIndex = 999999;
          else if (typeof mk.setZIndex === "function") mk.setZIndex(999999);
        } catch {}

        created.push(mk);
      }

      if (ac.signal.aborted || seq !== loadSeqRef.current) {
        for (const mk of created) {
          try {
            if ("map" in mk) mk.map = null;
            else if (typeof mk.setMap === "function") mk.setMap(null);
          } catch {}
        }
        return;
      }

      markersRef.current = created;
      setCount(created.length);

      const b = computeBoundsFromPoints(google, features);
      if (b && autoFitEnabledRef.current) map.fitBounds(b);

      Promise.resolve()
        .then(() => reportChartsAvailability(features))
        .catch((e) => {
          console.warn("reportChartsAvailability error:", e);
        });

      didLoadRef.current = true;
    } catch (e) {
      if (String(e?.name) === "AbortError") return;
      console.error("loadInformesPoints error:", e);
      alerts.toast.error(e?.message || "No se pudieron cargar los puntos.");
      if (typeof onHasData === "function") onHasData(true);
    } finally {
      if (mountedRef.current && seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [
    google,
    map,
    pid,
    enabled,
    fetchGeoJSON,
    openPointPanel,
    clearMarkers,
    onHasData,
    reportChartsAvailability,
    filtroPlantillaId,
    filtroInformeId,
    tramoFilter,
    filterFeaturesByTramoSelection,
    ensureInformesMeta,
  ]);

  // ✅ Carga inicial solo cuando NO hay filtro por tramo activo
  useEffect(() => {
    if (!enabled) return;
    if (!google || !map || !pid) return;
    if (tramoFilter?.enabled) return;
    if (didLoadRef.current) return;
    loadInformesPoints();
  }, [enabled, google, map, pid, tramoFilter?.enabled, loadInformesPoints]);

  useEffect(() => {
    autoFitEnabledRef.current = true;
    didLoadRef.current = false;
    clearMarkers();

    setSelectedPoint(null);
    setRightOpen(false);
    setVerInformeOpen(false);
    setDetalleData(null);
    setDetalleError(null);
    setDetalleIdInforme(null);

    setChartsOpen(false);
    setChartsStats(null);
    setChartsError(null);

    chartsReportedRef.current = {
      pid: null,
      has: null,
      idsKey: "",
      plantillaId: null,
    };
    chartsPayloadRef.current = { ids: [], plantilla: null, plantillaId: null };

    allInformeIdsRef.current = { pid: null, ids: [], ts: 0 };
    informesMetaRef.current = { pid: null, map: {}, ts: 0 };
    detalleTramoCacheRef.current = new Map();

    setMenuOpen(false);
    setBusqQ("");
    setBusqResults([]);
    setBusqError(null);
    setBusqPreguntaId("all");
    setPreguntasOptions([]);

    setFiltroInformeId("all");
    setFiltroPlantillaId("all");
    setFiltrosOpen(false);

    setFiltroData({ map: {}, plantillas: [], informes: [] });
  }, [pid, clearMarkers]);

  const tramoReloadKey = `${tramoFilter?.enabled ? 1 : 0}|${getActiveTramoKeyFromFilter(tramoFilter)}`;
  const lastTramoReloadKeyRef = useRef("");

  useEffect(() => {
    if (!enabled || !google || !map || !pid) return;

    if (lastTramoReloadKeyRef.current === tramoReloadKey) return;
    lastTramoReloadKeyRef.current = tramoReloadKey;

    didLoadRef.current = false;
    autoFitEnabledRef.current = true;
    setSelectedPoint(null);
    setRightOpen(false);
    setVerInformeOpen(false);
    setDetalleData(null);
    setDetalleError(null);
    setDetalleIdInforme(null);
    setBusqResults([]);

    loadInformesPoints();
  }, [enabled, google, map, pid, tramoReloadKey, loadInformesPoints]);

  const loadDetalleInforme = useCallback(
    async (idInforme) => {
      if (!idInforme) return;
      if (detalleIdInforme === idInforme && detalleData?.rows?.length) return;

      const ac = new AbortController();

      setDetalleLoading(true);
      setDetalleError(null);
      setDetalleData(null);

      try {
        const resp = await fetch(`${API_URL}/informes/${idInforme}`, {
          headers: { ...authHeaders() },
          signal: ac.signal,
        });

        if (handle401(resp)) return;

        const ct = resp.headers.get("content-type") || "";
        const isJson = ct.includes("application/json");
        const data = isJson ? await resp.json() : null;

        if (!resp.ok || data?.ok === false) {
          const msg =
            data?.error ||
            data?.message ||
            (isJson ? `Error ${resp.status}` : await resp.text());
          throw new Error(msg || `Error ${resp.status}`);
        }

        const preguntas = data?.preguntas || data?.data?.preguntas || [];
        const respuestas = data?.respuestas || data?.data?.respuestas || [];
        const fotos = data?.fotos || data?.data?.fotos || [];

        const preguntasById = new Map();
        for (const p of preguntas) preguntasById.set(Number(p.id_pregunta), p);

        const mapResp = new Map();
        for (const r of respuestas) {
          const idp = r?.id_pregunta;
          if (!idp) continue;
          const v = formatRespuestaValue(r);
          mapResp.set(idp, v || "");
        }

        const rows = preguntas.map((p) => ({
          id_pregunta: p.id_pregunta,
          etiqueta: p.etiqueta || `Pregunta ${p.id_pregunta}`,
          valor: mapResp.get(p.id_pregunta) || "-",
        }));

        const fotosByPregunta = groupFotosByPregunta(fotos);
        const fotosCount = (fotos || []).length;

        setDetalleIdInforme(idInforme);
        setDetalleData({ rows, fotosByPregunta, preguntasById, fotosCount });
      } catch (e) {
        const msg = e?.message || "No se pudo cargar el detalle.";
        setDetalleError(msg);
        alerts.toast.error(msg);
      } finally {
        if (mountedRef.current) setDetalleLoading(false);
      }

      return () => ac.abort();
    },
    [detalleIdInforme, detalleData]
  );

  const onClickVerInforme = async () => {
    const idInforme = selectedPoint?.id_informe;
    if (!idInforme) return;

    if (!verInformeOpen) {
      setVerInformeOpen(true);
      await loadDetalleInforme(idInforme);
      return;
    }
    setVerInformeOpen(false);
  };

  const onClickVerFotos = async () => {
    const idInforme = selectedPoint?.id_informe;
    if (!idInforme) return;

    if (!detalleData || detalleIdInforme !== idInforme) {
      await loadDetalleInforme(idInforme);
    }
    setFotosModalOpen(true);
  };

  const onClickVerCharts = async () => {
    const idInforme = selectedPoint?.id_informe;
    if (!idInforme) return;

    setChartsError(null);

    if (!detalleData || detalleIdInforme !== idInforme) {
      await loadDetalleInforme(idInforme);
    }

    const rows =
      (detalleIdInforme === idInforme ? detalleData?.rows : null) ||
      detalleData?.rows ||
      [];
    const stats = buildChartStatsFromRows(rows);

    if (typeof onChartsInfo === "function") {
      let ids = chartsPayloadRef.current?.ids || [];

      const allIds = await fetchInformeIdsByProyecto(pid);
      if (Array.isArray(allIds) && allIds.length) ids = allIds;

      if (!ids.length)
        ids = extractInformeIdsFromFeatures(lastFeaturesRef.current || []);

      const pl = chartsPayloadRef.current?.plantilla ?? null;
      const plId = chartsPayloadRef.current?.plantillaId ?? null;

      try {
        onChartsInfo({
          open: true,
          id_informe: idInforme,
          titulo:
            selectedPoint?.titulo ||
            (idInforme ? `Informe #${idInforme}` : "Informe"),
          informeIds: ids,
          ids,
          plantilla: pl,
          plantillaId: plId,
          rows,
          stats,
        });
      } catch (e) {
        console.warn("onChartsInfo error:", e);
      }
      return;
    }

    setChartsStats(stats);
    setChartsOpen(true);
  };

  const plantillasOptions = useMemo(() => filtroData.plantillas || [], [filtroData]);

  const informesOptions = useMemo(() => {
    let arr = filtroData.informes || [];
    const selPlant =
      filtroPlantillaId === "all" ? null : Number(filtroPlantillaId) || null;
    if (selPlant) arr = arr.filter((x) => Number(x.plantillaId) === selPlant);
    return arr.slice().sort((a, b) => String(a.titulo).localeCompare(String(b.titulo)));
  }, [filtroData, filtroPlantillaId]);

  useEffect(() => {
    if (!enabled) return;
    if (!panelOpen) return;
    (async () => {
      try {
        await loadFiltroData();
        await loadPreguntasOptions();
      } catch {}
    })();
  }, [enabled, panelOpen, loadFiltroData, loadPreguntasOptions]);

  if (!enabled) return null;

  return (
    <>
      {panelOpen ? (
        <div
          style={{
            position: "absolute",
            left: 14,
            top: 90,
            width: 340,
            maxWidth: "calc(100vw - 28px)",
            background: "#fff",
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,.08)",
            boxShadow: "0 14px 40px rgba(0,0,0,.18)",
            zIndex: 1200,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              borderBottom: "1px solid rgba(0,0,0,.06)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.1 }}>
                Puntos de informes
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Proyecto #{pid}
                {tramoFilter?.enabled && getActiveTramoKeyFromFilter(tramoFilter) ? (
                  <>
                    {" · "}
                    <b>{tramoFilter?.activeTramoLabel || `Tramo ${getActiveTramoKeyFromFilter(tramoFilter)}`}</b>
                  </>
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setListOpen((v) => !v);
                  autoFitEnabledRef.current = false;
                }}
                title={listOpen ? "Ocultar lista" : "Mostrar lista"}
                style={btnIconStyle}
              >
                {listOpen ? "▾" : "▸"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen((v) => !v);
                  autoFitEnabledRef.current = false;
                }}
                title="Más opciones"
                style={btnIconStyle}
              >
                ⋯
              </button>

              <button
                type="button"
                onClick={() => {
                  autoFitEnabledRef.current = false;
                  setMenuOpen(false);
                  if (typeof onPanelOpenChange === "function")
                    onPanelOpenChange(false);
                }}
                title="Ocultar panel (puntos siguen activos)"
                style={btnIconStyle}
              >
                —
              </button>

              <button
                type="button"
                onClick={() => {
                  autoFitEnabledRef.current = false;
                  setMenuOpen(false);
                  if (typeof onDisable === "function") onDisable();
                }}
                title="Ocultar puntos (apagar)"
                style={{ ...btnIconStyle, fontWeight: 900 }}
              >
                ⦿
              </button>
            </div>

            {menuOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: 54,
                  width: 220,
                  background: "#fff",
                  border: "1px solid rgba(0,0,0,.10)",
                  borderRadius: 12,
                  boxShadow: "0 12px 30px rgba(0,0,0,.18)",
                  padding: 6,
                  zIndex: 1300,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBusqQ("");
                    setBusqResults([]);
                    setBusqError(null);
                    setBusqPreguntaId("all");
                    setMenuOpen(false);
                    autoFitEnabledRef.current = false;
                    (markersRef.current || []).forEach((mk) =>
                      setMarkerMap(mk, enabled ? map : null)
                    );
                  }}
                  style={menuItemStyle}
                >
                  🧹 Limpiar búsqueda
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setGestorNotificacionesOpen(true);
                    setMenuOpen(false);
                    autoFitEnabledRef.current = false;
                  }}
                  style={menuItemStyle}
                >
                  📬 Gestionar notificaciones
                </button>
              </div>
            ) : null}
          </div>

          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => {
                  autoFitEnabledRef.current = false;
                  loadInformesPoints();
                }}
                disabled={loading}
                style={btnMainStyle}
              >
                {loading ? "Cargando…" : "🔄 Recargar"}
              </button>

              <button
                type="button"
                onClick={() => {
                  const b = computeBoundsFromPoints(google, lastFeaturesRef.current);
                  if (b) map.fitBounds(b);
                  autoFitEnabledRef.current = false;
                }}
                style={btnGhostStyle}
                title="Centrar puntos"
              >
                🎯 Centrar
              </button>
            </div>

            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Total puntos: <b>{count}</b>
              {loading ? (
                <span style={{ marginLeft: 8 }}>
                  <Spinner size="sm" />
                </span>
              ) : null}
            </div>

            {tramoFilter?.enabled && getActiveTramoKeyFromFilter(tramoFilter) ? (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #dbeafe",
                  background: "#eff6ff",
                  color: "#1e3a8a",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                Filtro por tramo activo:{" "}
                {tramoFilter?.activeTramoLabel || `Tramo ${getActiveTramoKeyFromFilter(tramoFilter)}`}
              </div>
            ) : null}

            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                onClick={async () => {
                  setFiltrosOpen((v) => !v);
                  autoFitEnabledRef.current = false;
                  try {
                    await loadFiltroData();
                    await loadPreguntasOptions();
                  } catch {}
                }}
                style={{ ...btnGhostStyle, width: "100%" }}
                title="Filtrar puntos por plantilla o por informe"
              >
                🧩 Filtro de puntos {filtrosOpen ? "▾" : "▸"}
              </button>

              {filtrosOpen ? (
                <div
                  style={{
                    marginTop: 8,
                    border: "1px solid #eef2f7",
                    borderRadius: 12,
                    padding: 10,
                    background: "#fff",
                  }}
                >
                  <Form.Label style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>
                    Plantilla (color por plantilla)
                  </Form.Label>

                  <Form.Select
                    size="sm"
                    value={filtroPlantillaId}
                    onChange={(e) => {
                      setFiltroPlantillaId(e.target.value);
                      setFiltroInformeId("all");
                      autoFitEnabledRef.current = false;
                    }}
                    style={{ borderRadius: 10, marginBottom: 8 }}
                  >
                    <option value="all">Todas</option>
                    {plantillasOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.nombre}
                      </option>
                    ))}
                  </Form.Select>

                  <Form.Label style={{ fontSize: 12, fontWeight: 900, marginBottom: 4 }}>
                    Informe
                  </Form.Label>

                  <Form.Select
                    size="sm"
                    value={filtroInformeId}
                    onChange={(e) => {
                      setFiltroInformeId(e.target.value);
                      autoFitEnabledRef.current = false;
                    }}
                    style={{ borderRadius: 10, marginBottom: 10 }}
                  >
                    <option value="all">Todos</option>
                    {informesOptions.map((it) => (
                      <option key={it.id} value={String(it.id)}>
                        {it.titulo} (#{it.id})
                      </option>
                    ))}
                  </Form.Select>

                  <div className="d-flex gap-2">
                    <Button
                      size="sm"
                      variant="dark"
                      onClick={async () => {
                        autoFitEnabledRef.current = true;
                        didLoadRef.current = false;
                        await loadInformesPoints();
                      }}
                      style={{ borderRadius: 10, fontWeight: 900, flex: 1 }}
                      disabled={loading}
                    >
                      ✅ Aplicar
                    </Button>

                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={async () => {
                        setFiltroPlantillaId("all");
                        setFiltroInformeId("all");
                        autoFitEnabledRef.current = true;
                        didLoadRef.current = false;
                        await loadInformesPoints();
                      }}
                      style={{ borderRadius: 10, fontWeight: 900 }}
                      disabled={loading}
                    >
                      ↩︎ Reset
                    </Button>
                  </div>

                  {plantillasOptions.length ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>
                        Leyenda
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {plantillasOptions.slice(0, 10).map((p) => (
                          <span
                            key={p.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid #e5e7eb",
                              borderRadius: 999,
                              padding: "3px 8px",
                              fontSize: 11,
                              fontWeight: 800,
                              background: "#fff",
                            }}
                            title={p.nombre}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: p.color || "#999",
                                border: "1px solid rgba(0,0,0,.12)",
                              }}
                            />
                            <span
                              style={{
                                maxWidth: 190,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {p.nombre}
                            </span>
                          </span>
                        ))}
                        {plantillasOptions.length > 10 ? (
                          <span style={{ fontSize: 11, color: "#6b7280" }}>
                            +{plantillasOptions.length - 10} más…
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                        *Si un punto trae color de <b>Semáforo</b>, ese color tiene prioridad.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
                      No se detectaron plantillas (todavía).
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {listOpen ? (
              <>
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div style={{ fontSize: 12, fontWeight: 900 }}>Buscar</div>
                  <Form.Check
                    type="switch"
                    id="busq-apply-map"
                    label="Filtrar mapa"
                    checked={busqApplyToMap}
                    onChange={(e) => {
                      setBusqApplyToMap(e.target.checked);
                      autoFitEnabledRef.current = false;
                    }}
                  />
                </div>

                <div className="d-flex gap-2 mb-2">
                  <Form.Select
                    size="sm"
                    value={busqPreguntaId}
                    onChange={(e) => {
                      setBusqPreguntaId(e.target.value);
                      autoFitEnabledRef.current = false;
                    }}
                    style={{ borderRadius: 10 }}
                    title="Filtrar por pregunta"
                  >
                    <option value="all">Todas las preguntas</option>
                    {preguntasOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.etiqueta}
                      </option>
                    ))}
                  </Form.Select>

                  <Button
                    size="sm"
                    variant="dark"
                    onClick={() => {
                      autoFitEnabledRef.current = false;
                      buscarRespuestas();
                    }}
                    disabled={busqLoading}
                    style={{ borderRadius: 10, fontWeight: 900, minWidth: 92 }}
                    title="Opcional (la búsqueda es en vivo)"
                  >
                    {busqLoading ? "…" : "Buscar"}
                  </Button>
                </div>

                <Form.Control
                  size="sm"
                  placeholder="Buscar texto en respuestas… (mín 2 letras)"
                  value={busqQ}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBusqQ(v);
                    setBusqError(null);

                    if (!String(v || "").trim()) {
                      setBusqResults([]);
                      (markersRef.current || []).forEach((mk) =>
                        setMarkerMap(mk, enabled ? map : null)
                      );
                    }

                    autoFitEnabledRef.current = false;
                  }}
                  style={{ borderRadius: 10, marginBottom: 10 }}
                />

                {busqError ? (
                  <div className="alert alert-danger" style={{ padding: 10, marginBottom: 10 }}>
                    {busqError}
                  </div>
                ) : null}

                <div
                  style={{
                    maxHeight: 320,
                    overflow: "auto",
                    border: "1px solid #eef2f7",
                    borderRadius: 12,
                  }}
                >
                  {String(busqQ || "").trim().length >= 2 ? (
                    busqLoading ? (
                      <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>
                        <Spinner size="sm" className="me-2" />
                        Buscando…
                      </div>
                    ) : busqResults.length === 0 ? (
                      <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>
                        Sin resultados.
                      </div>
                    ) : (
                      busqResults.map((r, idx) => (
                        <button
                          key={`${r.id_informe}-${r.id_pregunta}-${idx}`}
                          type="button"
                          onClick={() => {
                            focusSearchResult(r);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: 0,
                            background: "transparent",
                            borderBottom: "1px solid #eef2f7",
                          }}
                          title={r.lat != null ? "Ir al punto" : "El informe no tiene coordenadas"}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <div
                              style={{
                                fontWeight: 900,
                                fontSize: 13,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {r.titulo || "(Sin título)"}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                              {r.id_informe ? `#${r.id_informe}` : ""}
                            </div>
                          </div>

                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                            <b>{r.etiqueta || "Respuesta"}</b>
                            {r.id_pregunta ? <span> • P#{r.id_pregunta}</span> : null}
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              color: "#111827",
                              marginTop: 4,
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {String(r.valor || "").slice(0, 180)}
                            {String(r.valor || "").length > 180 ? "…" : ""}
                          </div>

                          {r.lat != null && r.lng != null ? (
                            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                              {Number(r.lat).toFixed(6)}, {Number(r.lng).toFixed(6)}
                            </div>
                          ) : null}
                        </button>
                      ))
                    )
                  ) : puntosList.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: "#6b7280" }}>
                      No hay puntos para mostrar.
                    </div>
                  ) : (
                    puntosList.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        onClick={() => flyToItem(it)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 12px",
                          border: "0",
                          background: "transparent",
                          borderBottom: "1px solid #eef2f7",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 800,
                              fontSize: 13,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {it.titulo}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {it.props?.__plantillaId ? (
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 999,
                                  background:
                                    it.props?.__markerColor ||
                                    it.props?.__plantillaColor ||
                                    (it.props?.__plantillaId
                                      ? plantillaColorOf(it.props.__plantillaId)
                                      : "#999"),
                                }}
                                title={
                                  it.props?.__plantillaNombre ||
                                  `Plantilla #${it.props?.__plantillaId}`
                                }
                              />
                            ) : null}

                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                              {it.id_informe ? `#${it.id_informe}` : ""}
                            </div>
                          </div>
                        </div>

                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                          {it.lat != null && it.lng != null
                            ? `${it.lat.toFixed(6)}, ${it.lng.toFixed(6)}`
                            : ""}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {rightOpen ? (
        <div
          style={{
            position: "absolute",
            right: 14,
            top: 90,
            width: 420,
            maxWidth: "calc(100vw - 28px)",
            background: "#fff",
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,.08)",
            boxShadow: "0 14px 40px rgba(0,0,0,.18)",
            zIndex: 1201,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 12px",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              borderBottom: "1px solid rgba(0,0,0,.06)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
                Detalle
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.15 }}>
                {selectedPoint?.titulo ||
                  (selectedPoint?.id_informe
                    ? `Informe #${selectedPoint.id_informe}`
                    : "Punto")}
              </div>

              {selectedPoint?.__plantillaId ? (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background:
                        selectedPoint?.__markerColor ||
                        selectedPoint?.__plantillaColor ||
                        (selectedPoint?.__plantillaId
                          ? plantillaColorOf(selectedPoint.__plantillaId)
                          : "#999"),
                    }}
                  />
                  <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                    {selectedPoint?.__plantillaNombre ||
                      `Plantilla #${selectedPoint.__plantillaId}`}
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                setRightOpen(false);
                autoFitEnabledRef.current = false;
              }}
              title="Cerrar"
              style={btnIconStyle}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: 12, fontSize: 14 }}>
            {!selectedPoint ? (
              <div style={{ color: "#6b7280" }}>
                Seleccioná un punto en el mapa.
              </div>
            ) : (
              <>
                <div>
                  <b>ID informe:</b> {selectedPoint.id_informe || "-"}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button
                    size="sm"
                    variant={verInformeOpen ? "primary" : "outline-primary"}
                    onClick={onClickVerInforme}
                  >
                    {verInformeOpen ? "Cerrar informe" : "Ver informe"}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline-dark"
                    onClick={onClickVerFotos}
                    disabled={detalleLoading}
                  >
                    📷 Ver fotos{" "}
                    {typeof detalleData?.fotosCount === "number"
                      ? `(${detalleData.fotosCount})`
                      : ""}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline-success"
                    onClick={onClickVerCharts}
                    disabled={detalleLoading}
                    title="Abrir gráficos del informe"
                  >
                    📊 Gráficos
                  </Button>
                  <Button
                    size="sm"
                    variant="warning"
                    onClick={() => abrirEditarInforme(selectedPoint?.id_informe)}
                    disabled={!selectedPoint?.id_informe}
                  >
                    Editar
                  </Button>
                </div>

                {verInformeOpen ? (
                  <>
                    <hr style={{ margin: "12px 0" }} />

                    {detalleLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Spinner size="sm" />
                        <span>Cargando respuestas…</span>
                      </div>
                    ) : null}

                    {detalleError ? (
                      <div className="alert alert-danger" style={{ padding: 10, margin: 0 }}>
                        {detalleError}
                      </div>
                    ) : null}

                    {detalleData?.rows?.length ? (
                      <div
                        style={{
                          maxHeight: "58vh",
                          overflow: "auto",
                          border: "1px solid #e5e7eb",
                          borderRadius: 10,
                        }}
                      >
                        <table className="table table-sm table-striped mb-0">
                          <thead
                            style={{
                              position: "sticky",
                              top: 0,
                              background: "white",
                              zIndex: 2,
                            }}
                          >
                            <tr>
                              <th style={{ width: "55%" }}>Pregunta</th>
                              <th>Respuesta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detalleData.rows.map((r) => (
                              <tr key={r.id_pregunta}>
                                <td style={{ fontWeight: 800 }}>{r.etiqueta}</td>
                                <td style={{ whiteSpace: "pre-wrap" }}>{r.valor}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      <Modal
        show={fotosModalOpen}
        onHide={() => {
          setFotosModalOpen(false);
          autoFitEnabledRef.current = false;
        }}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>Fotos del informe</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detalleLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner size="sm" />
              <span>Cargando fotos…</span>
            </div>
          ) : null}

          {!detalleLoading &&
          (!detalleData?.fotosByPregunta ||
            Object.keys(detalleData.fotosByPregunta).length === 0) ? (
            <div className="text-muted">Este informe no tiene fotos.</div>
          ) : null}

          {!detalleLoading &&
            detalleData?.fotosByPregunta &&
            Object.entries(detalleData.fotosByPregunta).map(([idp, arr]) => {
              const p = detalleData?.preguntasById?.get?.(Number(idp));
              const titulo = p?.etiqueta ? p.etiqueta : `Pregunta ${idp}`;

              return (
                <div key={idp} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>{titulo}</div>

                  <div className="d-flex flex-wrap gap-2">
                    {(arr || []).map((f) => {
                      const idFoto = Number(f.id_foto || f.id);
                      const url = fotoUrl(f.ruta_archivo);

                      return (
                        <a
                          key={idFoto}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "block",
                            width: 170,
                            border: "1px solid #e5e7eb",
                            borderRadius: 10,
                            padding: 6,
                            background: "#fff",
                            textDecoration: "none",
                          }}
                          title="Abrir imagen"
                        >
                          <div
                            style={{
                              width: "100%",
                              height: 110,
                              overflow: "hidden",
                              borderRadius: 8,
                            }}
                          >
                            <img
                              src={url}
                              alt="foto"
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </Modal.Body>

        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setFotosModalOpen(false);
              autoFitEnabledRef.current = false;
            }}
          >
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={chartsOpen}
        onHide={() => {
          setChartsOpen(false);
          autoFitEnabledRef.current = false;
        }}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Gráficos del informe</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {chartsError ? <div className="alert alert-danger mb-2">{chartsError}</div> : null}

          {!chartsStats ? (
            <div className="text-muted">No hay datos para graficar.</div>
          ) : (
            <div style={{ fontSize: 14 }}>
              <div>
                <b>Total respuestas:</b> {chartsStats.total}
              </div>
              <div>
                <b>Sí:</b> {chartsStats.si} &nbsp; <b>No:</b> {chartsStats.no}
              </div>
              <div>
                <b>Vacías:</b> {chartsStats.vacio}
              </div>
              <div style={{ marginTop: 8 }}>
                <b>Numéricas:</b> {chartsStats.numericos}
              </div>
              <div>
                <b>Promedio numéricos:</b>{" "}
                {chartsStats.promedioNumericos == null
                  ? "-"
                  : chartsStats.promedioNumericos.toFixed(2)}
              </div>

              <div className="text-muted" style={{ marginTop: 10, fontSize: 12 }}>
                *Este modal es “fallback”. Si ya tenés tu modal de Chart.js, pasá{" "}
                <code>onChartsInfo</code> desde el parent para abrir el modal real.
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setChartsOpen(false);
              autoFitEnabledRef.current = false;
            }}
          >
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      <GestorNotificacionesProyecto
        proyectoId={pid}
        proyectoNombre={`Proyecto #${pid}`}
        show={gestorNotificacionesOpen}
        onHide={() => setGestorNotificacionesOpen(false)}
      />

      <InformeModal
        show={showViewInformeModal}
        onHide={() => setShowViewInformeModal(false)}
        idInforme={idInformeSelModal}
        mode="view"
      />

      <InformeModal
        show={showEditInformeModal}
        onHide={() => setShowEditInformeModal(false)}
        idInforme={idInformeSelModal}
        mode="edit"
        onSaved={() => {
          didLoadRef.current = false;
          loadInformesPoints();
        }}
      />
    </>
  );
}

/* styles inline */
const btnIconStyle = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,.10)",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
  lineHeight: "32px",
};

const btnMainStyle = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,.10)",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGhostStyle = {
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,.10)",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};

const menuItemStyle = {
  width: "100%",
  textAlign: "left",
  padding: "10px 10px",
  border: 0,
  background: "transparent",
  borderRadius: 10,
  cursor: "pointer",
  fontWeight: 800,
};