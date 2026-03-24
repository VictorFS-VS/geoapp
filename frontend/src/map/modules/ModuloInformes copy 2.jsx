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

// ✅ default actual (si NO hay semáforo) (puede ser #RRGGBBAA)
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
   ✅ TRAMOS helpers
   - Normaliza "10,1" => "10.1"
   - Extrae el primer número válido de label/valor
   ========================================================= */
function normalizeTramoKey(v) {
  if (v == null) return null;
  const s = String(v)
    .trim()
    .replace(/\s+/g, " ")
    .replace(",", ".");
  if (!s) return null;

  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function tramoKeyFromLabel(label) {
  return normalizeTramoKey(label);
}

function tramoKeyFromRespuesta(valor) {
  return normalizeTramoKey(valor);
}

function isEtiquetaTramo(etiqueta) {
  const s = String(etiqueta || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return s === "tramo" || s === "tramos" || s.includes("tramo");
}

/* =========================================================
   ✅ HEX helpers (FIX ALPHA)
   - Acepta #RRGGBB y #RRGGBBAA
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

// ✅ alias
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
}) {
  const pid = Number(idProyecto);

  // markers
  const markersRef = useRef([]);
  const selectedMarkerRef = useRef(null);
  const selectedMarkerOriginalContentRef = useRef(null);
  const lastFeaturesRef = useRef([]);
  const didLoadRef = useRef(false);

  // ✅ evita re-centrar por cambios de UI
  const autoFitEnabledRef = useRef(true);

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

  // ✅ Gestor de notificaciones del proyecto
  const [gestorNotificacionesOpen, setGestorNotificacionesOpen] =
    useState(false);

  /* =========================
     Charts fallback interno
     ========================= */
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

  /* =========================
     ✅ cache para disponibilidad charts
     ========================= */
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

  /* =========================
     ✅ menú ⋯ + buscador respuestas INLINE
     ========================= */
  const [menuOpen, setMenuOpen] = useState(false);

  // ✅ BUSCADOR por respuestas
  const [busqPreguntaId, setBusqPreguntaId] = useState("all"); // "all" | "<id_pregunta>"
  const [busqQ, setBusqQ] = useState("");
  const [busqLoading, setBusqLoading] = useState(false);
  const [busqError, setBusqError] = useState(null);
  const [busqResults, setBusqResults] = useState([]);
  const [preguntasOptions, setPreguntasOptions] = useState([]); // [{id, etiqueta}]

  // ✅ aplicar resultados al mapa (ocultar otros puntos)
  const [busqApplyToMap, setBusqApplyToMap] = useState(true);

  // ✅ debounce + abort para búsquedas
  const busqDebounceRef = useRef(null);
  const busqAbortRef = useRef(null);

  // =========================
  // ✅ Filtro por TRAMO (desde pregunta Tramo/Tramos)
  // =========================
  const [tramoFilterLabel, setTramoFilterLabel] = useState("all"); // "all" | "Tramo 10"
  const [tramoFilterKey, setTramoFilterKey] = useState(null); // "10" | "10.1"
  const [tramoLoading, setTramoLoading] = useState(false);

  const tramoPreguntaIds = useMemo(() => {
    return (preguntasOptions || [])
      .filter((p) => isEtiquetaTramo(p.etiqueta))
      .map((p) => Number(p.id))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, [preguntasOptions]);

  // id_informe -> tramoKey detectado
  const informeTramoKeyRef = useRef(new Map());

  // helper setMap universal (AdvancedMarker / Marker)
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

  /* =========================
     ✅ filtros por plantilla / informe
     ========================= */
  const [filtroPlantillaId, setFiltroPlantillaId] = useState("all");
  const [filtroInformeId, setFiltroInformeId] = useState("all");
  const [filtrosOpen, setFiltrosOpen] = useState(false);

  // ✅ DATA combos
  const [filtroData, setFiltroData] = useState({
    map: {},
    plantillas: [],
    informes: [],
  });

  // meta cache: { pid, map, ts }
  const informesMetaRef = useRef({ pid: null, map: {}, ts: 0 });

  // ✅ cache nombre plantilla
  const plantillaNameCacheRef = useRef({});

  // mounted guard
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* =========================
     ✅ Helpers internos para meta
     ========================= */
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

  const fetchGeoJSON = useCallback(async (url, signal) => {
    const resp = await fetch(url, { headers: { ...authHeaders() }, signal });
    if (handle401(resp))
      throw new Error("Sesión expirada. Iniciá sesión de nuevo.");

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
  }, []);

  /* ======================================================
   * ✅ traer TODOS los informes del proyecto
   * ====================================================== */
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

  /* ======================================================
   * ✅ META de informes
   * ====================================================== */
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
                String(nombreFinal)
                  .trim()
                  .toLowerCase()
                  .startsWith("plantilla #");

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

  /* ======================================================
   * ✅ loadFiltroData
   * ====================================================== */
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
      featuresAll = Array.isArray(dataPts?.features) ? dataPts.features : [];
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

  /* ======================================================
   * ✅ availability charts reporter
   * ====================================================== */
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
      const { plantilla, plantillaId } = await tryGetPlantillaFromInformeIds(
        ids,
        ac.signal
      );

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

  /* ======================================================
   * ✅ CHEQUEO DE DATA
   * ====================================================== */
  const checkHasPuntos = useCallback(async () => {
    if (!pid) return;
    try {
      const url = `${API_URL}/informes/proyecto/${pid}/puntos`;
      const data = await fetchGeoJSON(url);

      const features = Array.isArray(data?.features) ? data.features : [];
      const pointCount = features.filter((f) => f?.geometry?.type === "Point")
        .length;

      if (typeof onHasData === "function") onHasData(pointCount > 0);

      lastFeaturesRef.current = features;

      await reportChartsAvailability(features);
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
    markersRef.current.forEach((m) => {
      if (!m) return;
      if ("map" in m) {
        try {
          m.map = null;
          return;
        } catch {}
      }
      if (typeof m.setMap === "function") m.setMap(null);
    });
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

  /* =========================================================
     ✅ IMPORTANTÍSIMO (FIX TDZ):
     pointsIndexByInformeId / puntosList DEBEN existir antes de buscarRespuestas
     ========================================================= */
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

  /* =========================
     ✅ BUSCAR RESPUESTAS (backend)
     ========================= */
  const buscarRespuestas = useCallback(async () => {
    const q = String(busqQ || "").trim();
    if (q.length < 2) {
      setBusqResults([]);
      setBusqError(null);
      return;
    }

    // ✅ abort request anterior si existe
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

      // ✅ endpoint
      const url = `${API_URL}/informes/proyecto/${pid}/buscar-respuestas?${qs.toString()}`;

      const resp = await fetch(url, { headers: { ...authHeaders() }, signal });
      if (handle401(resp)) return;

      const data = await resp.json().catch(() => null);
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `Error ${resp.status}`);
      }

      const items = (Array.isArray(data?.items) && data.items) || [];

      // ✅ Enriquecer con coords desde pointsIndexByInformeId
      const mapped = items.map((it) => {
        const idInf = Number(it.id_informe) || null;
        const found = idInf ? pointsIndexByInformeId.get(idInf) : null;

        return {
          id_informe: idInf,
          titulo:
            it.titulo ||
            found?.props?.titulo ||
            (idInf ? `Informe #${idInf}` : ""),
          id_pregunta: Number(it.id_pregunta) || null,
          etiqueta:
            it.etiqueta ||
            (it.id_pregunta ? `Pregunta #${it.id_pregunta}` : ""),
          valor: it.valor ?? "",
          lat: found?.lat ?? null,
          lng: found?.lng ?? null,
          props: found?.props ?? { id_informe: idInf, titulo: it.titulo },
        };
      });

      setBusqResults(mapped);

      // ✅ si estamos buscando por pregunta Tramo/Tramos, guardamos mapping id_informe -> tramoKey
      const pidSel = busqPreguntaId !== "all" ? Number(busqPreguntaId) : null;
      const isTramoSearch =
        (pidSel && tramoPreguntaIds.includes(pidSel)) ||
        (mapped?.[0]?.etiqueta && isEtiquetaTramo(mapped[0].etiqueta));

      if (isTramoSearch) {
        const mm = new Map();
        for (const it of mapped) {
          const idInf = Number(it?.id_informe) || null;
          if (!idInf) continue;
          const k = tramoKeyFromRespuesta(it?.valor);
          if (!k) continue;
          mm.set(idInf, k);
        }
        informeTramoKeyRef.current = mm;
      }
    } catch (e) {
      if (String(e?.name) === "AbortError") return;
      setBusqError(e?.message || "No se pudo buscar.");
      setBusqResults([]);
    } finally {
      if (mountedRef.current) setBusqLoading(false);
    }
  }, [
    busqQ,
    busqPreguntaId,
    pid,
    pointsIndexByInformeId,
    tramoPreguntaIds,
  ]);

  // ✅ búsqueda en vivo (debounce)
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

  // ✅ aplicar filtro TRAMO: fuerza búsqueda por pregunta Tramo/Tramos + key
  const aplicarFiltroPorTramo = useCallback(
    async (labelOrKey) => {
      const key = tramoKeyFromLabel(labelOrKey) || normalizeTramoKey(labelOrKey);

      setTramoFilterLabel(labelOrKey || "all");
      setTramoFilterKey(key);

      if (!key) {
        informeTramoKeyRef.current = new Map();
        return;
      }

      const pidPregunta =
        tramoPreguntaIds.length > 0 ? Number(tramoPreguntaIds[0]) : null;

      if (!pidPregunta) {
        alerts.toast.error(
          'No encontré una pregunta "Tramo/Tramos" en la lista de preguntas.'
        );
        return;
      }

      try {
        setTramoLoading(true);

        // setea búsqueda por pregunta tramo + key (ej 10 / 10.1)
        setBusqPreguntaId(String(pidPregunta));
        setBusqQ(String(key));

        // fuerza búsqueda inmediata (no esperar debounce)
        await buscarRespuestas();
      } finally {
        if (mountedRef.current) setTramoLoading(false);
      }
    },
    [tramoPreguntaIds, buscarRespuestas]
  );

  // ✅ aplicar filtro de búsqueda + tramo al mapa (ocultar puntos)
  useEffect(() => {
    if (!enabled) return;
    if (!map) return;

    const q = String(busqQ || "").trim();
    const searching = q.length >= 2;

    if (!busqApplyToMap) {
      (markersRef.current || []).forEach((mk) =>
        setMarkerMap(mk, enabled ? map : null)
      );
      return;
    }

    if (busqLoading) return;

    // set por búsqueda (texto)
    let idsFromSearch = null;
    if (searching) {
      idsFromSearch = new Set(
        (busqResults || [])
          .map((r) => Number(r?.id_informe))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
    }

    // set por tramo seleccionado
    let idsFromTramo = null;
    if (tramoFilterKey) {
      const mm = informeTramoKeyRef.current || new Map();
      idsFromTramo = new Set();
      for (const [idInf, k] of mm.entries()) {
        if (String(k) === String(tramoFilterKey)) idsFromTramo.add(Number(idInf));
      }
      // si todavía no hay mapping, no forzamos vacío
      if (idsFromTramo.size === 0) idsFromTramo = null;
    }

    const hasAnyFilter = !!idsFromSearch || !!idsFromTramo;

    if (!hasAnyFilter) {
      (markersRef.current || []).forEach((mk) =>
        setMarkerMap(mk, enabled ? map : null)
      );
      return;
    }

    (markersRef.current || []).forEach((mk) => {
      const idInf = Number(mk?.__idInforme);
      if (!idInf) return setMarkerMap(mk, null);

      let visible = true;
      if (idsFromSearch) visible = visible && idsFromSearch.has(idInf);
      if (idsFromTramo) visible = visible && idsFromTramo.has(idInf);

      setMarkerMap(mk, visible && enabled ? map : null);
    });
  }, [
    busqQ,
    busqResults,
    busqLoading,
    busqApplyToMap,
    enabled,
    map,
    tramoFilterKey,
  ]);

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

  /* ======================================================
   * ✅ cargar puntos (con filtro y color por plantilla)
   * ====================================================== */
  const loadInformesPoints = useCallback(async () => {
    if (!google || !map || !pid) return;

    const ac = new AbortController();

    setLoading(true);
    try {
      clearMarkers();

      // ✅ aseguramos combos/meta antes de pintar
      const meta = await loadFiltroData();
      const metaMap = meta?.map || {};

      const qs = new URLSearchParams();
      if (filtroInformeId !== "all") qs.set("informe", String(filtroInformeId));
      if (filtroPlantillaId !== "all")
        qs.set("plantilla", String(filtroPlantillaId));
      qs.set("_ts", String(Date.now()));

      const url = `${API_URL}/informes/proyecto/${pid}/puntos?${qs.toString()}`;

      const data = await fetchGeoJSON(url, ac.signal);
      if (data?.ok === false) {
        throw new Error(data?.error || "No se pudieron cargar los puntos.");
      }

      let features = Array.isArray(data?.features) ? data.features : [];
      lastFeaturesRef.current = features;

      const infId =
        filtroInformeId === "all" ? null : Number(filtroInformeId) || null;

      // ✅ FILTRO LOCAL SOLO por informe
      if (infId) {
        features = features.filter((f) => {
          if (f?.geometry?.type !== "Point") return false;
          const p = f.properties || {};
          const idInf =
            Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk) ||
            null;
          return idInf && Number(idInf) === Number(infId);
        });
        lastFeaturesRef.current = features;
      }

      const pointCount = features.filter((f) => f?.geometry?.type === "Point")
        .length;
      if (typeof onHasData === "function") onHasData(pointCount > 0);

      await reportChartsAvailability(features);

      try {
        await google.maps.importLibrary("marker");
      } catch {}

      const AdvancedMarker = google?.maps?.marker?.AdvancedMarkerElement;
      const PinElement = google?.maps?.marker?.PinElement;

      const created = [];

      for (const f of features) {
        if (f?.geometry?.type !== "Point") continue;

        const [lng, lat] = f.geometry.coordinates || [];
        const props = f.properties || {};

        const pos = { lat: toNum(lat), lng: toNum(lng) };
        if (pos.lat == null || pos.lng == null) continue;

        const idInf =
          Number(
            props.id_informe ??
              props.idInforme ??
              props.id ??
              props.id_informe_fk
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

        if (AdvancedMarker && PinElement) {
          const pin = new PinElement({
            background: markerColorCss,
            borderColor: "#ffffff",
            glyphColor: "#ffffff",
            glyph: "📍",
            scale: 1.1,
          });

          const mk = new AdvancedMarker({
            map: enabled ? map : null,
            position: pos,
            content: pin.element,
            title,
          });

          mk.__idInforme = idInf;
          mk.__plantillaId = plantillaId;
          mk.__markerColor = markerColorCss;
          mk.__baseMap = map;

          try {
            mk.zIndex = 999999;
          } catch {}

          mk.addListener("gmp-click", () => openPointPanel(propsEnriched));
          created.push(mk);
          continue;
        }

        if (AdvancedMarker) {
          const el = document.createElement("div");
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.borderRadius = "999px";
          el.style.background = markerColorCss;
          el.style.border = "3px solid #fff";
          el.style.boxShadow = "0 6px 16px rgba(0,0,0,.22)";

          const mk = new AdvancedMarker({
            map: enabled ? map : null,
            position: pos,
            content: el,
            title,
          });

          mk.__idInforme = idInf;
          mk.__plantillaId = plantillaId;
          mk.__markerColor = markerColorCss;
          mk.__baseMap = map;

          try {
            mk.zIndex = 999999;
          } catch {}

          mk.addListener("gmp-click", () => openPointPanel(propsEnriched));
          created.push(mk);
          continue;
        }

        const mk = new google.maps.Marker({
          map: enabled ? map : null,
          position: pos,
          title,
        });

        mk.__idInforme = idInf;
        mk.__plantillaId = plantillaId;
        mk.__markerColor = markerColorCss;
        mk.__baseMap = map;

        if (typeof mk.setZIndex === "function") mk.setZIndex(999999);

        mk.addListener("click", () => openPointPanel(propsEnriched));
        created.push(mk);
      }

      markersRef.current = created;
      setCount(created.length);

      const b = computeBoundsFromPoints(google, features);
      if (b && autoFitEnabledRef.current) map.fitBounds(b);

      didLoadRef.current = true;
    } catch (e) {
      console.error("loadInformesPoints error:", e);
      alerts.toast.error(e?.message || "No se pudieron cargar los puntos.");
      if (typeof onHasData === "function") onHasData(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }

    return () => ac.abort();
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
    loadFiltroData,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!google || !map || !pid) return;
    if (didLoadRef.current) return;
    loadInformesPoints();
  }, [enabled, google, map, pid, loadInformesPoints]);

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

    setMenuOpen(false);
    setBusqQ("");
    setBusqResults([]);
    setBusqError(null);
    setBusqPreguntaId("all");
    setPreguntasOptions([]);

    setTramoFilterLabel("all");
    setTramoFilterKey(null);
    setTramoLoading(false);
    informeTramoKeyRef.current = new Map();

    setFiltroInformeId("all");
    setFiltroPlantillaId("all");
    setFiltrosOpen(false);

    setFiltroData({ map: {}, plantillas: [], informes: [] });
  }, [pid, clearMarkers]);

  /* =========================
     Detalle informe
     ========================= */
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

  // ✅ combos filtros (derivados del meta cache)
  const plantillasOptions = useMemo(
    () => filtroData.plantillas || [],
    [filtroData]
  );

  const informesOptions = useMemo(() => {
    let arr = filtroData.informes || [];
    const selPlant =
      filtroPlantillaId === "all" ? null : Number(filtroPlantillaId) || null;
    if (selPlant) arr = arr.filter((x) => Number(x.plantillaId) === selPlant);
    return arr
      .slice()
      .sort((a, b) => String(a.titulo).localeCompare(String(b.titulo)));
  }, [filtroData, filtroPlantillaId]);

  // ✅ cuando abrís el panel, precarga meta + preguntas
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
                    setTramoFilterLabel("all");
                    setTramoFilterKey(null);
                    informeTramoKeyRef.current = new Map();
                    setMenuOpen(false);
                    autoFitEnabledRef.current = false;
                  }}
                  style={menuItemStyle}
                >
                  🧹 Limpiar filtros
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
                  const b = computeBoundsFromPoints(
                    google,
                    lastFeaturesRef.current
                  );
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

            {/* ✅ FILTRO POR PLANTILLA / INFORME */}
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
                  <Form.Label
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      marginBottom: 4,
                    }}
                  >
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

                  <Form.Label
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      marginBottom: 4,
                    }}
                  >
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
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          marginBottom: 6,
                        }}
                      >
                        Leyenda
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
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
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          marginTop: 6,
                        }}
                      >
                        *Si un punto trae color de <b>Semáforo</b>, ese color
                        tiene prioridad.
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
                {/* ✅ FILTRO POR TRAMO */}
                <div style={{ marginBottom: 10 }}>
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div style={{ fontSize: 12, fontWeight: 900 }}>Tramo</div>
                    {tramoLoading ? (
                      <span style={{ fontSize: 12, color: "#6b7280" }}>
                        <Spinner size="sm" className="me-2" />
                        Filtrando…
                      </span>
                    ) : null}
                  </div>

                  <div className="d-flex gap-2">
                    <Form.Control
                      size="sm"
                      placeholder='Ej: "Tramo 10" o "10.1"'
                      value={
                        tramoFilterLabel === "all"
                          ? ""
                          : String(tramoFilterLabel || "")
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setTramoFilterLabel(v);
                        setTramoFilterKey(tramoKeyFromLabel(v));
                        autoFitEnabledRef.current = false;
                      }}
                      style={{ borderRadius: 10 }}
                    />

                    <Button
                      size="sm"
                      variant="dark"
                      onClick={async () => {
                        autoFitEnabledRef.current = false;
                        await aplicarFiltroPorTramo(tramoFilterLabel);
                      }}
                      style={{ borderRadius: 10, fontWeight: 900, minWidth: 96 }}
                      disabled={tramoLoading || busqLoading}
                      title='Busca por la pregunta "Tramo/Tramos" y filtra puntos'
                    >
                      Aplicar
                    </Button>

                    <Button
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => {
                        setTramoFilterLabel("all");
                        setTramoFilterKey(null);
                        informeTramoKeyRef.current = new Map();
                        autoFitEnabledRef.current = false;

                        // opcional: limpiar búsqueda
                        setBusqQ("");
                        setBusqResults([]);
                        setBusqError(null);
                        setBusqPreguntaId("all");
                      }}
                      style={{ borderRadius: 10, fontWeight: 900 }}
                      title="Quitar filtro tramo"
                    >
                      Reset
                    </Button>
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      marginTop: 6,
                    }}
                  >
                    Usa la pregunta <b>Tramo/Tramos</b>. Acepta <b>10</b>,{" "}
                    <b>10.1</b> o <b>10,1</b>.
                  </div>
                </div>

                {/* ✅ BUSCAR RESPUESTAS (inline) */}
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
                    if (!String(v || "").trim()) setBusqResults([]);
                    autoFitEnabledRef.current = false;
                  }}
                  style={{ borderRadius: 10, marginBottom: 10 }}
                />

                {busqError ? (
                  <div
                    className="alert alert-danger"
                    style={{ padding: 10, marginBottom: 10 }}
                  >
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
                            if (r.lat != null && r.lng != null) {
                              map.panTo({ lat: r.lat, lng: r.lng });
                              map.setZoom(Math.max(map.getZoom() || 7, 16));
                            }
                            openPointPanel(r.props);
                            autoFitEnabledRef.current = false;
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 12px",
                            border: 0,
                            background: "transparent",
                            borderBottom: "1px solid #eef2f7",
                          }}
                          title={
                            r.lat != null
                              ? "Ir al punto"
                              : "El informe no tiene coordenadas"
                          }
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
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

      {/* Panel derecho */}
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
              <div style={{ color: "#6b7280" }}>Seleccioná un punto en el mapa.</div>
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

      {/* Modal fotos */}
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

      {/* Fallback modal charts */}
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
          {chartsError ? (
            <div className="alert alert-danger mb-2">{chartsError}</div>
          ) : null}

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

      {/* ✅ Gestor de notificaciones del proyecto */}
      <GestorNotificacionesProyecto
        proyectoId={pid}
        proyectoNombre={`Proyecto #${pid}`}
        show={gestorNotificacionesOpen}
        onHide={() => setGestorNotificacionesOpen(false)}
      />

      {/* ✅ MODAL VER INFORME */}
      <InformeModal
        show={showViewInformeModal}
        onHide={() => setShowViewInformeModal(false)}
        idInforme={idInformeSelModal}
        mode="view"
      />

      {/* ✅ MODAL EDITAR INFORME */}
      <InformeModal
        show={showEditInformeModal}
        onHide={() => setShowEditInformeModal(false)}
        idInforme={idInformeSelModal}
        mode="edit"
        onSaved={() => {
          // opcional: si querés refrescar después de guardar
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