// src/map/modules/ModuloEncuestas.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   AUTH HEADERS (JWT)
========================= */
function authHeaders() {
  const raw =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");

  if (!raw) return {};
  const token = String(raw).trim().replace(/^Bearer\s+/i, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJsonOrThrow(url) {
  const resp = await fetch(url, { headers: { ...authHeaders() } });
  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : await resp.text();

  if (!resp.ok) {
    const msg =
      (isJson && (data?.error || data?.message)) ||
      (!isJson && String(data)) ||
      `Error ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

async function tryFetchFirstOk(urls = []) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const data = await fetchJsonOrThrow(u);
      return { ok: true, data, url: u };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, error: lastErr || new Error("No se pudo obtener datos") };
}

/* =========================
   PERMISOS
========================= */
function getUserPerms() {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    return Array.isArray(u?.perms) ? u.perms : [];
  } catch {
    return [];
  }
}
function canPerm(perms, p) {
  return Array.isArray(perms) && perms.includes(p);
}

/* =========================
   HELPERS
========================= */
function normTxt(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isEspecial(props = {}) {
  const t = normTxt(
    props.tipo_inmueble_clase || props.tipo_inmueble || props.clase_inmueble || ""
  );
  return t.includes("ESPECIAL");
}

function isNormal(props = {}) {
  const t = normTxt(
    props.tipo_inmueble_clase || props.tipo_inmueble || props.clase_inmueble || ""
  );
  return t === "" ? true : !t.includes("ESPECIAL");
}

function pickFirstNonEmpty(obj, keys = []) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s !== "") return s;
  }
  return "";
}

function getFotosCount(obj) {
  const raw = pickFirstNonEmpty(obj, [
    "fotos_count",
    "cant_fotos",
    "cantidad_fotos",
    "total_fotos",
    "n_fotos",
  ]);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function matchSearch(props = {}, txt = "") {
  const q = normTxt(txt);
  if (!q) return true;

  const values = [
    props.nombre_apellido,
    props.nombre,
    props.codigo,
    props.cod,
    props.ci,
    props.documento,
    props.cedula,
    props.nro_documento,
  ];

  return values.some((v) => normTxt(v).includes(q));
}

/* =========================
   COLOR MAPPING
========================= */
function colorFromPercepcion(percepcion) {
  const p = normTxt(percepcion);

  if (p.includes("VERDE")) return "#22c55e";
  if (p.includes("AMARILL")) return "#eab308";
  if (p.includes("NARANJA")) return "#f97316";
  if (p.includes("ROJO")) return "#ef4444";
  if (p.includes("AZUL")) return "#3b82f6";

  if (p.includes("BUEN")) return "#22c55e";
  if (p.includes("REGUL")) return "#eab308";
  if (p.includes("MAL")) return "#ef4444";

  return "#9ca3af";
}

function bucketFromColorHex(hex) {
  const h = String(hex || "").toLowerCase();
  if (h === "#22c55e") return "verde";
  if (h === "#eab308") return "amarillo";
  if (h === "#f97316") return "naranja";
  if (h === "#ef4444") return "rojo";
  if (h === "#3b82f6") return "azul";
  return "indefinido";
}

/* =========================
   UI TOGGLE
========================= */
function ToggleSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange?.(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,.10)",
        background: checked ? "#2563eb" : "#e5e7eb",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .2s ease",
        padding: 0,
        outline: "none",
        boxShadow: checked
          ? "inset 0 0 0 1px rgba(37,99,235,.15)"
          : "inset 0 0 0 1px rgba(0,0,0,.04)",
        opacity: disabled ? 0.6 : 1,
      }}
      title={checked ? "Activado" : "Desactivado"}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.22)",
          transition: "all .2s ease",
        }}
      />
    </button>
  );
}

/* =========================
   PIN SVG (gota) fallback
========================= */
function buildPinEl({ fill, size = 30 }) {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.transform = "translate(-50%, -100%)";
  el.style.cursor = "pointer";
  el.style.filter = "drop-shadow(0 2px 2px rgba(0,0,0,.35))";
  el.style.userSelect = "none";

  el.innerHTML = `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 22s7-5.1 7-12a7 7 0 10-14 0c0 6.9 7 12 7 12z"
          fill="${fill}" stroke="white" stroke-width="2" />
    <path d="M12 22s7-5.1 7-12a7 7 0 10-14 0c0 6.9 7 12 7 12z"
          fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1" />
    <circle cx="12" cy="10" r="3.2" fill="white" opacity="0.95"/>
  </svg>`;
  return el;
}

function getIdEncuesta(props = {}) {
  return props?.id_encuesta ?? props?.id ?? props?.gid ?? null;
}

function pickRowFromAny(data) {
  if (!data) return null;
  if (data.row) return data.row;
  if (data.data?.row) return data.data.row;
  if (Array.isArray(data.rows) && data.rows[0]) return data.rows[0];
  if (Array.isArray(data.data?.rows) && data.data.rows[0]) return data.data.rows[0];
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
  if (typeof data === "object" && !Array.isArray(data)) return data;
  return null;
}

function pickFotosFromAny(data) {
  if (!data) return [];
  const d = data.data ?? data;
  const candidates = [
    d.fotos,
    d.images,
    d.rows,
    d.data?.rows,
    d.data?.fotos,
    d.data?.images,
  ].filter(Boolean);

  let arr = [];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      arr = c;
      break;
    }
  }

  const out = [];
  for (const it of arr) {
    if (!it) continue;
    if (typeof it === "string") out.push(it);
    else if (it.url) out.push(it.url);
    else if (it.path) out.push(it.path);
    else if (it.ruta) out.push(it.ruta);
  }
  return out;
}

function toAbsUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${BASE.replace(/\/+$/, "")}${s}`;
  return `${BASE.replace(/\/+$/, "")}/${s}`;
}

/* =========================
   DETALLE -> Pregunta/Respuesta
========================= */
const HIDE_KEYS = new Set([
  "geom",
  "geometry",
  "geojson",
  "__proto__",
  "updated_at",
  "deleted_at",
]);

const ORDER_KEYS = [
  "nombre_censista",
  "fecha_relevamiento",
  "codigo",
  "tramo_nombre",
  "tramo",
  "progresivas",
  "ciudad",
  "barrio",
  "nombre_apellido",
  "ci",
  "telefono",
  "fecha_nacimiento",
  "es_paraguayo",
  "tiempo_arraigo",
  "especificar_anhos",
  "realiza_actividad_economica",
  "cant_personas",
  "menores_18",
  "adultos_18_64",
  "adultos_65_mas",
  "total_mujeres",
  "total_hombres",
  "embarazadas",
  "personas_discapacidad",
  "percepcion",
  "medio_subsistencia",
  "medio_subsistencia_familiares",
  "medio_subsistencia_subsidio",
  "medio_subsistencia_jubilacion",
  "medio_subsistencia_ahorros",
  "medio_subsistencia_sin_ingresos",
  "medio_subsistencia_otro",
  "caracteristicas_predio",
  "condicion_ocupacion",
  "paredes",
  "tipo_techo",
  "tipo_piso",
  "condicion_estructura",
  "otras_instalaciones",
  "instalaciones_no_posee",
  "instalaciones_huerta",
  "instalaciones_vivero",
  "instalaciones_corral",
  "instalaciones_otros",
  "posee_animales",
  "energia_electrica",
  "agua_potable",
  "fuente_ingreso",
  "ingreso_mensual",
  "egreso_mensual",
  "fuente_ingreso_adicional",
  "pertenece_comision",
  "aspectos_positivos",
  "coordenadas_gps",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "gps_precision",
  "coor_x",
  "coor_y",
  "created_at",
  "afectacion",
  "cerrado",
  "tipo_inmueble",
  "familias_en_predio",
  "tipo_animal_domestico",
  "sistema_excretas",
  "kobo_form_uuid",
  "kobo_uuid",
  "kobo_submission_time",
  "alcantarillado",
  "animal_domestico_ave",
  "animal_domestico_conejo",
  "animal_domestico_gato",
  "animal_domestico_otros",
  "animal_domestico_peces",
  "animal_domestico_perro",
  "animal_domestico_tortuga",
  "cuenta_con_ci",
  "gastos_mensuales_principales",
  "instalaciones_otra_vivienda",
  "personas_req_esp_salud",
];

function prettyKey(k) {
  const key = String(k || "").trim();
  if (!key) return "";
  return key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeBoolString(s) {
  const t = String(s ?? "").trim().toLowerCase();
  if (t === "true") return "Sí";
  if (t === "false") return "No";
  if (t === "si" || t === "sí") return "Sí";
  if (t === "no") return "No";
  return null;
}

function prettyVal(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "-";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "-";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  if (!s) return "-";
  const b = normalizeBoolString(s);
  if (b) return b;
  return s;
}

function buildQAList(base = {}) {
  if (!base || typeof base !== "object") return [];
  const out = [];
  const seen = new Set();

  for (const k of ORDER_KEYS) {
    if (HIDE_KEYS.has(k)) continue;
    if (k in base) {
      out.push({ key: k, q: prettyKey(k), a: prettyVal(base[k]) });
      seen.add(k);
    }
  }

  const rest = Object.keys(base)
    .filter((k) => !seen.has(k) && !HIDE_KEYS.has(k))
    .map((k) => ({ key: k, q: prettyKey(k), a: prettyVal(base[k]) }))
    .sort((x, y) => x.q.localeCompare(y.q, "es", { sensitivity: "base" }));

  return out.concat(rest);
}

export default function ModuloEncuestas({
  google,
  map,
  idProyecto,
  visible = true,

  enabled = false,
  onDisable,
  onEnabledChange,

  panelOpen = false,
  onPanelOpenChange,

  onHasData,
  activeTramoId = "",

  onEditEncuesta,
}) {
  const perms = useMemo(() => getUserPerms(), []);
  const canUpdate = useMemo(() => canPerm(perms, "encuestas.update"), [perms]);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // filtros
  const [searchTxt, setSearchTxt] = useState("");
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);

  const [fNormal, setFNormal] = useState(true);
  const [fEspecial, setFEspecial] = useState(false);

  const [cVerde, setCVerde] = useState(true);
  const [cAmarillo, setCAmarillo] = useState(true);
  const [cRojo, setCRojo] = useState(true);
  const [cAzul, setCAzul] = useState(true);
  const [cIndef, setCIndef] = useState(true);

  // data en memoria (mapa)
  const geoRef = useRef(null);
  const markersRef = useRef(new Map());
  const lastKeyRef = useRef("");

  const pid = Number(idProyecto);

  const tramoFilter = useMemo(() => {
    const t = String(activeTramoId ?? "").trim();
    return t && t !== "0" ? t : "";
  }, [activeTramoId]);

  /* =========================
     Detalle Censo (panel)
  ========================= */
  const [detalleOpen, setDetalleOpen] = useState(false);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleErr, setDetalleErr] = useState("");
  const [detalleBase, setDetalleBase] = useState(null);
  const [detalleFull, setDetalleFull] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [fotosOpen, setFotosOpen] = useState(false);
  const [fotosLoading, setFotosLoading] = useState(false);
  const [fotosErr, setFotosErr] = useState("");
  const [fotos, setFotos] = useState([]);

  const hideAllMarkers = useCallback(() => {
    for (const [, mk] of markersRef.current.entries()) {
      try {
        if (mk && typeof mk.map !== "undefined") mk.map = null;
        else if (mk?.setMap) mk.setMap(null);
      } catch {}
    }
  }, []);

  const clearMarkersHard = useCallback(() => {
    hideAllMarkers();
    markersRef.current.clear();
  }, [hideAllMarkers]);

  const isColorEnabled = useCallback(
    (bucket) => {
      switch (bucket) {
        case "verde":
          return cVerde;
        case "amarillo":
          return cAmarillo;
        case "rojo":
          return cRojo;
        case "azul":
          return cAzul;
        case "indefinido":
        default:
          return cIndef;
      }
    },
    [cVerde, cAmarillo, cRojo, cAzul, cIndef]
  );

  const tipoEnabled = useCallback(
    (props) => {
      const n = isNormal(props);
      const e = isEspecial(props);
      if (n && !fNormal) return false;
      if (e && !fEspecial) return false;
      if (!n && !e) return fNormal;
      return true;
    },
    [fNormal, fEspecial]
  );

  const fetchDetalle = useCallback(async (idEncuesta) => {
    if (!idEncuesta) return null;

    const urls = [
      `${API_URL}/encuestas/${idEncuesta}`,
      `${API_URL}/encuestas/detalle/${idEncuesta}`,
      `${API_URL}/encuestas/${idEncuesta}?full=1`,
    ];

    const res = await tryFetchFirstOk(urls);
    if (!res.ok) throw res.error;

    return pickRowFromAny(res.data) || res.data;
  }, []);

  const fetchFotos = useCallback(async (idEncuesta) => {
    if (!idEncuesta) return [];

    const urls = [
      `${API_URL}/encuestas/${idEncuesta}/fotos`,
      `${API_URL}/encuestas/fotos/${idEncuesta}`,
    ];

    const res = await tryFetchFirstOk(urls);
    if (!res.ok) return [];

    return pickFotosFromAny(res.data);
  }, []);

  const openDetalleFromProps = useCallback(
    async (props, position) => {
      const idEncuesta = getIdEncuesta(props);
      if (!idEncuesta) return;

      setDetalleErr("");
      setDetalleLoading(true);
      setDetalleOpen(true);
      setDetalleBase(props);
      setDetalleFull(null);
      setInfoOpen(false);

      if (position) {
        try {
          map.panTo(position);
          const z = map.getZoom?.();
          const targetZoom = 18;
          if (typeof z === "number") map.setZoom(Math.max(z, targetZoom));
          else map.setZoom?.(targetZoom);
        } catch {}
      }

      try {
        const full = await fetchDetalle(idEncuesta);
        setDetalleFull(full);
      } catch (e) {
        setDetalleErr(e?.message || "No se pudo cargar el detalle del censo");
      } finally {
        setDetalleLoading(false);
      }
    },
    [map, fetchDetalle]
  );

  const openFotos = useCallback(async () => {
    const idEncuesta = getIdEncuesta(detalleFull || detalleBase || {});
    if (!idEncuesta) return;

    setFotosErr("");
    setFotosLoading(true);
    setFotosOpen(true);
    setFotos([]);

    try {
      const arr = await fetchFotos(idEncuesta);
      setFotos(arr);
    } catch (e) {
      setFotosErr(e?.message || "No se pudieron cargar las fotos");
    } finally {
      setFotosLoading(false);
    }
  }, [detalleFull, detalleBase, fetchFotos]);

  const doEdit = useCallback(async () => {
    const base = detalleFull || detalleBase || {};
    const idEncuesta = getIdEncuesta(base);
    if (!idEncuesta) return;

    if (!canUpdate) {
      window.dispatchEvent(
        new CustomEvent("toast:error", {
          detail: "No tenés permiso para editar encuestas.",
        })
      );
      return;
    }

    let full = base;
    try {
      if (!detalleFull) full = await fetchDetalle(idEncuesta);
    } catch {}

    const encuestaForModal = {
      ...(full || base),
      id_encuesta: idEncuesta,
      id_proyecto: pid,
      id_tramo: (full || base)?.id_tramo ?? detalleBase?.id_tramo ?? null,
    };

    if (typeof window.__openEncuestaModal === "function") {
      window.__openEncuestaModal(encuestaForModal, "edit");
      return;
    }

    if (onEditEncuesta) {
      onEditEncuesta({ mode: "edit", encuesta: encuestaForModal });
      return;
    }

    window.dispatchEvent(
      new CustomEvent("encuesta:editar", {
        detail: { mode: "edit", encuesta: encuestaForModal },
      })
    );
  }, [detalleFull, detalleBase, pid, canUpdate, fetchDetalle, onEditEncuesta]);

  const goToSearchResult = useCallback(
    async (item) => {
      const f = item?.feature;
      const props = item?.props || {};
      const lon = safeNum(f?.geometry?.coordinates?.[0]);
      const lat = safeNum(f?.geometry?.coordinates?.[1]);

      if (lon == null || lat == null) return;

      const position = { lat, lng: lon };

      try {
        map.panTo(position);
        const z = map.getZoom?.();
        const targetZoom = 19;
        if (typeof z === "number") map.setZoom(Math.max(z, targetZoom));
        else map.setZoom?.(targetZoom);
      } catch {}

      await openDetalleFromProps(props, position);
    },
    [map, openDetalleFromProps]
  );

  /* =========================
     MARKERS
  ========================= */
  const buildOrReuseMarker = useCallback(
    (props, position) => {
      const Adv = google?.maps?.marker?.AdvancedMarkerElement;
      const Pin = google?.maps?.marker?.PinElement;

      const id = String(getIdEncuesta(props));
      const fill = colorFromPercepcion(props.percepcion);

      const existing = markersRef.current.get(id);
      if (existing) {
        try {
          if (existing.position) existing.position = position;
          else if (existing.setPosition) existing.setPosition(position);
        } catch {}
        existing.__encColor = fill;
        return existing;
      }

      const onClick = () => openDetalleFromProps(props, position);

      if (Adv && Pin) {
        const pin = new Pin({
          background: fill,
          borderColor: "#ffffff",
          glyphColor: "#ffffff",
          scale: 1.0,
        });

        const mk = new Adv({ position, content: pin.element, title: `Censo ${id}` });
        mk.__encColor = fill;
        mk.addListener("gmp-click", onClick);
        markersRef.current.set(id, mk);
        return mk;
      }

      if (Adv) {
        const content = buildPinEl({ fill, size: 30 });
        const mk = new Adv({ position, content, title: `Censo ${id}` });
        mk.__encColor = fill;
        mk.addListener("gmp-click", onClick);
        markersRef.current.set(id, mk);
        return mk;
      }

      const svg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
          <path d="M12 22s7-5.1 7-12a7 7 0 10-14 0c0 6.9 7 12 7 12z"
                fill="${fill}" stroke="white" stroke-width="2"/>
          <path d="M12 22s7-5.1 7-12a7 7 0 10-14 0c0 6.9 7 12 7 12z"
                fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
          <circle cx="12" cy="10" r="3.2" fill="white" opacity="0.95"/>
        </svg>
      `);

      const mk = new google.maps.Marker({
        position,
        title: `Censo ${id}`,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${svg}`,
          scaledSize: new google.maps.Size(30, 30),
          anchor: new google.maps.Point(15, 30),
        },
      });

      mk.__encColor = fill;
      mk.addListener("click", onClick);

      markersRef.current.set(id, mk);
      return mk;
    },
    [google, openDetalleFromProps]
  );

  const renderMarkers = useCallback(() => {
    if (!google?.maps || !map) return;

    if (!enabled) {
      hideAllMarkers();
      return;
    }

    const fc = geoRef.current;
    if (!fc?.features?.length) {
      hideAllMarkers();
      return;
    }

    const wantTramo = tramoFilter ? Number(tramoFilter) : null;
    const usedIds = new Set();

    for (const f of fc.features) {
      const props = f?.properties || {};
      const id = getIdEncuesta(props);

      const lon = safeNum(f?.geometry?.coordinates?.[0]);
      const lat = safeNum(f?.geometry?.coordinates?.[1]);
      if (!id || lon == null || lat == null) continue;

      const idTramo = props.id_tramo != null ? Number(props.id_tramo) : null;
      if (wantTramo != null && idTramo !== wantTramo) continue;

      if (!matchSearch(props, searchTxt)) continue;
      if (!tipoEnabled(props)) continue;

      const fill = colorFromPercepcion(props.percepcion);
      const bucket = bucketFromColorHex(fill);
      if (!isColorEnabled(bucket)) continue;

      const position = { lat, lng: lon };
      const mk = buildOrReuseMarker(props, position);

      usedIds.add(String(id));
      try {
        if (typeof mk.map !== "undefined") mk.map = map;
        else if (mk?.setMap) mk.setMap(map);
      } catch {}
    }

    for (const [id, mk] of markersRef.current.entries()) {
      if (usedIds.has(id)) continue;
      try {
        if (typeof mk.map !== "undefined") mk.map = null;
        else if (mk?.setMap) mk.setMap(null);
      } catch {}
      markersRef.current.delete(id);
    }
  }, [
    google,
    map,
    enabled,
    tramoFilter,
    searchTxt,
    hideAllMarkers,
    buildOrReuseMarker,
    tipoEnabled,
    isColorEnabled,
  ]);

  /* =========================
     FETCH MAPA
  ========================= */
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!visible || !pid || !google?.maps || !map) return;

      const key = String(pid);
      if (lastKeyRef.current === key && geoRef.current) {
        onHasData?.(!!geoRef.current?.features?.length);
        renderMarkers();
        return;
      }

      setErr("");
      setLoading(true);

      try {
        const url = `${API_URL}/encuestas/mapa/${pid}`;
        const data = await fetchJsonOrThrow(url);

        const fc =
          data?.type === "FeatureCollection"
            ? data
            : data?.data?.type === "FeatureCollection"
            ? data.data
            : data?.data;

        geoRef.current =
          fc?.type === "FeatureCollection" ? fc : { type: "FeatureCollection", features: [] };
        lastKeyRef.current = key;

        const has = !!geoRef.current?.features?.length;
        onHasData?.(has);

        renderMarkers();
      } catch (e) {
        if (cancelled) return;
        setErr(e?.message || "Error cargando encuestas");
        onHasData?.(false);
        hideAllMarkers();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [visible, pid, google, map, onHasData, renderMarkers, hideAllMarkers]);

  useEffect(() => {
    if (!visible) return;
    if (geoRef.current) onHasData?.(!!geoRef.current?.features?.length);
    renderMarkers();
  }, [
    visible,
    enabled,
    tramoFilter,
    searchTxt,
    fNormal,
    fEspecial,
    cVerde,
    cAmarillo,
    cRojo,
    cAzul,
    cIndef,
    onHasData,
    renderMarkers,
  ]);

  useEffect(() => {
    setSearchResultsOpen(false);
  }, [searchTxt, tramoFilter]);

  const count = geoRef.current?.features?.length || 0;
  useEffect(() => {
    if (!visible) return;
    if (count > 0) return;

    if (panelOpen) onPanelOpenChange?.(false);
    if (enabled) onEnabledChange?.(false);
  }, [count, visible, panelOpen, enabled, onPanelOpenChange, onEnabledChange]);

  useEffect(() => {
    return () => {
      clearMarkersHard();
      geoRef.current = null;
      lastKeyRef.current = "";
    };
  }, [clearMarkersHard]);

  const setEnabledSafe = (v) => {
    if (onEnabledChange) onEnabledChange(!!v);
    else if (!v) onDisable?.();
  };

  const searchResults = useMemo(() => {
    const q = String(searchTxt || "").trim();
    if (!q) return [];

    const features = geoRef.current?.features || [];
    const wantTramo = tramoFilter ? Number(tramoFilter) : null;

    return features
      .filter((f) => {
        const props = f?.properties || {};
        const lon = safeNum(f?.geometry?.coordinates?.[0]);
        const lat = safeNum(f?.geometry?.coordinates?.[1]);
        if (lon == null || lat == null) return false;

        const idTramo = props.id_tramo != null ? Number(props.id_tramo) : null;
        if (wantTramo != null && idTramo !== wantTramo) return false;

        if (!matchSearch(props, q)) return false;
        if (!tipoEnabled(props)) return false;

        const fill = colorFromPercepcion(props.percepcion);
        const bucket = bucketFromColorHex(fill);
        if (!isColorEnabled(bucket)) return false;

        return true;
      })
      .map((f) => {
        const props = f?.properties || {};
        return {
          feature: f,
          props,
          id: getIdEncuesta(props),
          nombre: pickFirstNonEmpty(props, ["nombre_apellido", "nombre"]) || "Sin nombre",
          codigo: pickFirstNonEmpty(props, ["codigo", "cod"]) || "-",
          ci: pickFirstNonEmpty(props, ["ci", "documento", "cedula", "nro_documento"]) || "-",
          id_tramo: props?.id_tramo ?? null,
          percepcion: props?.percepcion ?? "",
        };
      })
      .slice(0, 30);
  }, [searchTxt, tramoFilter, tipoEnabled, isColorEnabled]);

  if (!visible || !google?.maps || !map || !pid) return null;

  const base = detalleFull || detalleBase || {};

  const val = (k, fallback = "-") => {
    const v = base?.[k];
    if (v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s === "" ? fallback : s;
  };

  const qaList = useMemo(() => buildQAList(base), [base]);

  const pillStyle = (txt) => {
    const t = normTxt(txt);
    if (t.includes("VERDE")) {
      return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" };
    }
    if (t.includes("AMARILL")) {
      return { background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047" };
    }
    if (t.includes("NARANJA")) {
      return { background: "#ffedd5", color: "#9a3412", border: "1px solid #fdba74" };
    }
    if (t.includes("ROJO")) {
      return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" };
    }
    if (t.includes("AZUL")) {
      return { background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" };
    }
    return { background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb" };
  };

  const countFiltered = searchTxt.trim() ? searchResults.length : count;

  return (
    <>
      {/* PANEL FILTROS */}
      {panelOpen && (
        <div
          className="visor-panel visor-panel-encuestas"
          style={{
            position: "absolute",
            top: 70,
            left: 90,
            width: 390,
            maxWidth: "calc(100vw - 110px)",
            height: 560,
            maxHeight: "calc(100vh - 110px)",
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 12px 30px rgba(0,0,0,.22)",
            border: "1px solid rgba(0,0,0,.08)",
            zIndex: 9999,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="visor-panel-header"
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(0,0,0,.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Censados</div>
              <span
                style={{
                  background: "#6b7280",
                  color: "#fff",
                  padding: "2px 10px",
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 12,
                  minWidth: 30,
                  textAlign: "center",
                }}
              >
                {countFiltered}
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {loading ? <span style={{ fontSize: 12, opacity: 0.7 }}>Cargando…</span> : null}
              <button
                className="visor-panel-close"
                onClick={() => onPanelOpenChange?.(false)}
                title="Cerrar"
                style={{
                  border: 0,
                  background: "transparent",
                  fontSize: 22,
                  lineHeight: 1,
                  padding: "0 4px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="visor-panel-body" style={{ padding: 12, overflow: "auto" }}>
            {err ? (
              <div className="visor-panel-error">⚠️ {err}</div>
            ) : (
              <>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {count} punto(s) {tramoFilter ? `— tramo ${tramoFilter}` : ""}
                </div>

                {/* Buscador */}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    border: "1px solid rgba(0,0,0,.10)",
                    borderRadius: 12,
                    background: "#fff",
                  }}
                >
                  <input
                    type="text"
                    placeholder="Buscar por nombre, código o CI..."
                    value={searchTxt}
                    onChange={(e) => setSearchTxt(e.target.value)}
                    style={{
                      width: "100%",
                      border: "1px solid #d1d5db",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                </div>

                {/* Resultados búsqueda */}
                {searchTxt.trim() && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      border: "1px solid rgba(0,0,0,.10)",
                      borderRadius: 12,
                      background: "#f8fafc",
                    }}
                  >
                    <div
                      onClick={() => setSearchResultsOpen((v) => !v)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12 }}>{searchResultsOpen ? "▼" : "▶"}</span>
                        <div style={{ fontWeight: 800 }}>
                          Resultados ({searchResults.length})
                        </div>
                      </div>

                      <div style={{ fontSize: 13, opacity: 0.8 }}>
                        {searchResultsOpen ? "Ocultar" : "Mostrar"}
                      </div>
                    </div>

                    {searchResultsOpen && (
                      <div style={{ marginTop: 10, maxHeight: 250, overflow: "auto" }}>
                        {searchResults.length === 0 ? (
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: 10,
                              background: "#fff",
                              border: "1px solid #e5e7eb",
                              fontSize: 13,
                              opacity: 0.8,
                            }}
                          >
                            No se encontraron coincidencias.
                          </div>
                        ) : (
                          <div style={{ display: "grid", gap: 10 }}>
                            {searchResults.map((item, idx) => {
                              const activeColor = colorFromPercepcion(item.percepcion);

                              return (
                                <div
                                  key={`${item.id || "x"}-${idx}`}
                                  onClick={() => goToSearchResult(item)}
                                  style={{
                                    padding: "12px 12px",
                                    borderRadius: 12,
                                    border: "1px solid #d1d5db",
                                    background: "#fff",
                                    cursor: "pointer",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 8,
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontWeight: 900,
                                        fontSize: 16,
                                        lineHeight: 1.1,
                                      }}
                                    >
                                      {item.nombre}
                                    </div>

                                    <span
                                      style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: 999,
                                        background: activeColor,
                                        flex: "0 0 auto",
                                      }}
                                    />
                                  </div>

                                  <div style={{ marginTop: 6, fontSize: 13, color: "#374151" }}>
                                    <strong>Código:</strong> {item.codigo}
                                  </div>

                                  <div style={{ marginTop: 2, fontSize: 13, color: "#374151" }}>
                                    <strong>CI:</strong> {item.ci}
                                  </div>

                                  <div style={{ marginTop: 2, fontSize: 12, color: "#6b7280" }}>
                                    id_encuesta: {item.id ?? "-"}
                                    {item.id_tramo != null ? ` · tramo: ${item.id_tramo}` : ""}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Mostrar/Ocultar */}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    border: "1px dashed rgba(0,0,0,.15)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Mostrar/Ocultar</div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>Puntos de encuestas</div>
                    <ToggleSwitch
                      checked={!!enabled}
                      onChange={(next) => setEnabledSafe(next)}
                    />
                  </div>
                </div>

                {/* Tipo inmueble */}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    border: "1px dashed rgba(0,0,0,.15)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Tipo de inmueble</div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Normal</div>
                      <ToggleSwitch
                        checked={fNormal}
                        onChange={(next) => setFNormal(next)}
                      />
                    </label>

                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Especial</div>
                      <ToggleSwitch
                        checked={fEspecial}
                        onChange={(next) => setFEspecial(next)}
                      />
                    </label>
                  </div>
                </div>

                {/* Colores */}
                <div
                  style={{
                    marginTop: 12,
                    padding: 10,
                    border: "1px dashed rgba(0,0,0,.15)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Colores</div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Verde</div>
                      <ToggleSwitch
                        checked={cVerde}
                        onChange={(next) => setCVerde(next)}
                      />
                    </label>

                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Amarillo</div>
                      <ToggleSwitch
                        checked={cAmarillo}
                        onChange={(next) => setCAmarillo(next)}
                      />
                    </label>

                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Rojo</div>
                      <ToggleSwitch
                        checked={cRojo}
                        onChange={(next) => setCRojo(next)}
                      />
                    </label>

                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Azul</div>
                      <ToggleSwitch
                        checked={cAzul}
                        onChange={(next) => setCAzul(next)}
                      />
                    </label>

                    <label
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Indefinido</div>
                      <ToggleSwitch
                        checked={cIndef}
                        onChange={(next) => setCIndef(next)}
                      />
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => renderMarkers()}
                  >
                    Refrescar
                  </button>

                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setEnabledSafe(false)}
                  >
                    Desactivar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PANEL DETALLE */}
      {detalleOpen && (
        <div
          style={{
            position: "absolute",
            top: 70,
            right: 14,
            width: 520,
            maxWidth: "calc(100vw - 20px)",
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 12px 30px rgba(0,0,0,.22)",
            border: "1px solid rgba(0,0,0,.08)",
            zIndex: 10000,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(0,0,0,.08)",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.1 }}>Detalle</div>
              <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.1 }}>Censo</div>
            </div>

            <button
              onClick={() => {
                setDetalleOpen(false);
                setDetalleFull(null);
                setDetalleBase(null);
                setDetalleErr("");
                setInfoOpen(false);
              }}
              title="Cerrar"
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,.10)",
                background: "#fff",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                display: "grid",
                placeItems: "center",
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: 14, overflow: "auto" }}>
            {detalleLoading ? (
              <div style={{ fontSize: 13, opacity: 0.75 }}>Cargando detalle…</div>
            ) : detalleErr ? (
              <div style={{ color: "#b91c1c", fontSize: 13 }}>⚠️ {detalleErr}</div>
            ) : (
              (() => {
                const base0 = detalleFull || detalleBase || {};
                const id0 = getIdEncuesta(base0);

                const nombre = val("nombre_apellido", val("nombre", "-"));
                const codigo = val("codigo", "-");
                const ocupacion = val("ocupacion", val("profesion", "—"));

                const tipoClase =
                  pickFirstNonEmpty(base0, [
                    "tipo_inmueble_clase",
                    "clase_inmueble",
                    "tipo_inmueble",
                    "clase",
                    "tipo",
                  ]) || (isEspecial(base0) ? "ESPECIAL" : "NORMAL");

                const percep = val("percepcion", "-");
                const fotosCount = getFotosCount(base0);

                const Row = ({ label, value, extra }) => (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <span style={{ fontWeight: 800 }}>{label}: </span>
                    <span style={{ opacity: 0.95 }}>{value}</span>
                    {extra ? <span style={{ marginLeft: 8 }}>{extra}</span> : null}
                  </div>
                );

                return (
                  <>
                    <Row label="ID" value={id0 ?? "-"} />
                    <Row label="Código" value={codigo} />
                    <Row label="Nombre y Apellido" value={nombre} />
                    <Row label="Ocupación" value={ocupacion} />
                    <Row label="Tipo (clase)" value={tipoClase || "—"} />
                    <Row
                      label="Percepción del censista"
                      value={percep}
                      extra={
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                            marginLeft: 6,
                            ...pillStyle(percep),
                          }}
                        >
                          {percep}
                        </span>
                      }
                    />

                    <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setInfoOpen((v) => !v)}
                      >
                        {infoOpen ? "Ocultar información" : "Ver información"}
                      </button>

                      <button className="btn btn-sm btn-outline-primary" onClick={openFotos}>
                        {fotosCount != null ? `Ver fotos (${fotosCount})` : "Ver fotos"}
                      </button>

                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={doEdit}
                        disabled={!canUpdate}
                        title={!canUpdate ? "No tenés permiso encuestas.update" : "Editar encuesta"}
                      >
                        Editar
                      </button>
                    </div>

                    {infoOpen && (
                      <div style={{ marginTop: 14 }}>
                        <div
                          style={{
                            border: "1px solid rgba(0,0,0,.08)",
                            borderRadius: 14,
                            overflow: "hidden",
                            background: "#fff",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              background: "#f8fafc",
                              borderBottom: "1px solid rgba(0,0,0,.08)",
                              padding: "10px 12px",
                              fontWeight: 800,
                              fontSize: 13,
                            }}
                          >
                            <div>Pregunta</div>
                            <div>Respuesta</div>
                          </div>

                          <div style={{ maxHeight: 420, overflow: "auto" }}>
                            {qaList.map((it, idx) => (
                              <div
                                key={`${it.key}-${idx}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  padding: "10px 12px",
                                  borderBottom:
                                    idx === qaList.length - 1
                                      ? "none"
                                      : "1px solid rgba(0,0,0,.06)",
                                  background: idx % 2 === 0 ? "#fff" : "#fcfcfd",
                                  gap: 10,
                                }}
                              >
                                <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>
                                  {it.q}
                                </div>
                                <div
                                  style={{
                                    fontSize: 13,
                                    color: "#111827",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {it.a}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* MODAL FOTOS */}
      {fotosOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 11000,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 14,
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setFotosOpen(false)}
        >
          <div
            style={{
              width: "min(1100px, 100%)",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 14px 40px rgba(0,0,0,.35)",
              overflow: "hidden",
              border: "1px solid rgba(0,0,0,.10)",
            }}
            onClick={(e) => e.stopPropagation()}
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
              <div style={{ fontWeight: 900 }}>Fotos del censo</div>
              <button
                onClick={() => setFotosOpen(false)}
                title="Cerrar"
                style={{
                  border: 0,
                  background: "transparent",
                  fontSize: 22,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 12 }}>
              {fotosLoading ? (
                <div style={{ opacity: 0.75 }}>Cargando fotos…</div>
              ) : fotosErr ? (
                <div style={{ color: "#b91c1c" }}>⚠️ {fotosErr}</div>
              ) : fotos.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No hay fotos para este censo.</div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                    gap: 12,
                  }}
                >
                  {fotos.map((u, idx) => {
                    const src = toAbsUrl(u);
                    return (
                      <a
                        key={idx}
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "block",
                          borderRadius: 14,
                          overflow: "hidden",
                          border: "1px solid rgba(0,0,0,.08)",
                          boxShadow: "0 10px 18px rgba(0,0,0,.10)",
                        }}
                        title="Abrir en nueva pestaña"
                      >
                        <img
                          src={src}
                          alt={`foto-${idx + 1}`}
                          loading="lazy"
                          style={{
                            width: "100%",
                            height: 180,
                            objectFit: "cover",
                            display: "block",
                            background: "#f3f4f6",
                          }}
                          onError={(e) => {
                            e.currentTarget.style.objectFit = "contain";
                            e.currentTarget.style.padding = "16px";
                            e.currentTarget.alt = "No se pudo cargar la imagen";
                          }}
                        />
                        <div style={{ padding: "8px 10px", fontSize: 12, opacity: 0.75 }}>
                          Foto #{idx + 1}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-sm btn-secondary" onClick={() => setFotosOpen(false)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}