// src/map/modules/ModuloPoligonos.jsx
import React, { 
  useCallback, 
  useEffect, 
  useLayoutEffect,   // 👈 agregado
  useMemo, 
  useRef, 
  useState 
} from "react";
import {
  fetchGeoJSONSmart,
  getUsoLabelFromFeature,
  getColorForUso,
  rgbCss,
  normKey,
} from "@/map/utils/usoColors";

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

  // tolera "Bearer Bearer xxx"
  const token = raw.trim().replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${token}` };
}

function aiZIndex(v) {
  const n = Number(v);
  if (n === 1000) return 115;
  if (n === 700) return 116;
  if (n === 500) return 117;
  return 115;
}

/* =========================================================
 *  FIT / BOUNDS HELPERS
 * =======================================================*/
function isValidLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}
function extendBoundsSafe(bounds, latLng) {
  try {
    const lat = typeof latLng.lat === "function" ? latLng.lat() : latLng.lat;
    const lng = typeof latLng.lng === "function" ? latLng.lng() : latLng.lng;
    if (isValidLatLng(Number(lat), Number(lng))) bounds.extend(latLng);
  } catch {}
}
function fitToDataLayer(google, map, dataLayer, padding = 30) {
  try {
    const bounds = new google.maps.LatLngBounds();
    let hasAny = false;

    dataLayer.forEach((feature) => {
      const geom = feature.getGeometry?.();
      if (!geom) return;

      if (typeof geom.forEachLatLng === "function") {
        geom.forEachLatLng((latLng) => {
          extendBoundsSafe(bounds, latLng);
          hasAny = true;
        });
      } else {
        const pt = geom.get?.();
        if (pt) {
          extendBoundsSafe(bounds, pt);
          hasAny = true;
        }
      }
    });

    if (hasAny && !bounds.isEmpty()) {
      map.fitBounds(bounds, padding);
      return true;
    }
  } catch (e) {
    console.warn("fitToDataLayer error:", e);
  }
  return false;
}

function fitProyectoLayerByPid(google, map, dataLayer, { pid = null, padding = 30 } = {}) {
  try {
    const bounds = new google.maps.LatLngBounds();
    let hasAny = false;

    dataLayer.forEach((feature) => {
      if (pid !== null) {
        const p =
          feature?.getProperty?.("id_proyecto") ??
          feature?.getProperty?.("idProyecto") ??
          feature?.getProperty?.("pid") ??
          feature?.getProperty?.("ID_PROYECTO") ??
          feature?.getProperty?.("proyecto_id") ??
          null;

        if (p != null && Number(p) !== Number(pid)) return;
        // ✅ si p es null, no filtramos (para no “desaparecer” si el backend no trae id_proyecto)
      }

      const geom = feature.getGeometry?.();
      if (!geom) return;

      if (typeof geom.forEachLatLng === "function") {
        geom.forEachLatLng((latLng) => {
          extendBoundsSafe(bounds, latLng);
          hasAny = true;
        });
      } else {
        const pt = geom.get?.();
        if (pt) {
          extendBoundsSafe(bounds, pt);
          hasAny = true;
        }
      }
    });

    if (hasAny && !bounds.isEmpty()) {
      map.fitBounds(bounds, padding);
      return true;
    }
  } catch (e) {
    console.warn("fitProyectoLayerByPid error:", e);
  }
  return false;
}

function fitProyectoLayerAll(google, map, dataLayer, padding = 30) {
  try {
    const bounds = new google.maps.LatLngBounds();
    let hasAny = false;

    dataLayer.forEach((feature) => {
      const geom = feature.getGeometry?.();
      if (!geom) return;

      if (typeof geom.forEachLatLng === "function") {
        geom.forEachLatLng((latLng) => {
          extendBoundsSafe(bounds, latLng);
          hasAny = true;
        });
      } else {
        const pt = geom.get?.();
        if (pt) {
          extendBoundsSafe(bounds, pt);
          hasAny = true;
        }
      }
    });

    if (hasAny && !bounds.isEmpty()) {
      map.fitBounds(bounds, padding);
      return true;
    }
  } catch (e) {
    console.warn("fitProyectoLayerAll error:", e);
  }
  return false;
}

function safeNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function uniqById(arr, getId) {
  const out = [];
  const seen = new Set();
  for (const it of arr || []) {
    const id = getId(it);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}
async function mapLimit(list, limit, fn) {
  const ret = [];
  const executing = [];
  for (const item of list) {
    const p = Promise.resolve().then(() => fn(item));
    ret.push(p);

    if (limit <= list.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

/* =========================================================
 *  Helpers: “resto de propiedad” (NO en ver todos)
 * =======================================================*/
function isRestoDePropiedadProps(props) {
  if (!props) return false;
  const needle = "resto de propiedad";
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
  }
  return false;
}
function stripRestoDePropiedad(geojson) {
  try {
    if (!geojson || !geojson.features || !Array.isArray(geojson.features)) return geojson;
    return {
      ...geojson,
      features: geojson.features.filter((f) => !isRestoDePropiedadProps(f?.properties)),
    };
  } catch {
    return geojson;
  }
}

/* =========================================================
 *  Helpers: normalización texto (mojibake + canon)
 * =======================================================*/
const MOJI = new Map([
  ["Ã¡", "á"],
  ["Ã©", "é"],
  ["Ã­", "í"],
  ["Ã³", "ó"],
  ["Ãº", "ú"],
  ["Ãñ", "ñ"],
  ["Ã\u0081", "Á"],
  ["Ã\u0089", "É"],
  ["Ã\u008d", "Í"],
  ["Ã\u0093", "Ó"],
  ["Ã\u009a", "Ú"],
  ["Ã\u0091", "Ñ"],
  ["Âº", "º"],
  ["Âª", "ª"],
  ["Â", ""],
]);
function fixMojibake(s = "") {
  let out = String(s ?? "");
  MOJI.forEach((to, from) => {
    out = out.split(from).join(to);
  });
  return out
    .replace(/[\r\n]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}
function stripAccents(s = "") {
  try {
    return String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  } catch {
    return String(s ?? "")
      .replace(/[áàäâ]/gi, "a")
      .replace(/[éèëê]/gi, "e")
      .replace(/[íìïî]/gi, "i")
      .replace(/[óòöô]/gi, "o")
      .replace(/[úùüû]/gi, "u")
      .replace(/ñ/gi, "n");
  }
}
function norm(s = "") {
  return stripAccents(fixMojibake(s)).toLowerCase().trim();
}

const CANON_RULES_LOCAL = [
  [/^uso\s*agri/i, "uso agricola"],
  [/^uso\s*ganad/i, "uso ganadero"],
  [/^uso\s*agropecu/i, "uso agropecuario"],
  [/^comunidades?\s+indigenas?/i, "comunidades indigenas"],
];

const DISPLAY_MAP = {
  "uso agricola": "Uso Agrícola",
  "uso ganadero": "Uso Ganadero",
  "uso agropecuario": "Uso Agropecuario",
  "comunidades indigenas": "Comunidades Indígenas",
};

function titleCaseBasic(s = "") {
  return String(s ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function canonizeUso(raw = "") {
  let s = fixMojibake(raw);
  const n = norm(s);
  if (/\bagrocola\b/i.test(n)) s = s.replace(/agrocola/gi, "agrícola");
  if (/\bagricola\b/i.test(n)) s = s.replace(/agricola/gi, "agrícola");

  const nk = norm(s);
  for (const [re, out] of CANON_RULES_LOCAL) {
    if (re.test(nk)) return out;
  }
  return nk || "sin categoria";
}
function prettyUsoLabel(canonKey, fallbackLabel = "") {
  if (DISPLAY_MAP[canonKey]) return DISPLAY_MAP[canonKey];
  if (fallbackLabel) return fixMojibake(fallbackLabel);
  return titleCaseBasic(canonKey);
}
function getUsoCanonAndPretty(feature) {
  const raw = getUsoLabelFromFeature(feature);
  const canon = canonizeUso(raw);
  return { raw, canon, pretty: prettyUsoLabel(canon, raw) };
}

/* =========================================================
 *  ✅ helpers para área
 * =======================================================*/
function pickFirstNum(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function fmtNumberPY(n) {
  try {
    return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}
function fmtAreaM2(area) {
  const n = Number(area);
  if (!Number.isFinite(n)) return "";
  const ha = n / 10000;
  return `${fmtNumberPY(n)} m²${ha ? ` (${fmtNumberPY(ha)} ha)` : ""}`;
}

/* =========================================================
 *  ✅ Área de Influencia (500/700/1000)
 * =======================================================*/
const AI_COLORS = {
  500: { stroke: "#ef4444", fill: "#ef4444" },
  700: { stroke: "#f97316", fill: "#f97316" },
  1000: { stroke: "#86efac", fill: "#86efac" },
};

function detectAIValueFromFeature(feature) {
  try {
    const p = feature?.getProperty?.bind(feature);

    const v = pickFirstNum(
      p ? p("buff_dist") : null,
      p ? p("BUFF_DIST") : null,
      p ? p("buffer") : null,
      p ? p("BUFFER") : null,
      p ? p("distancia") : null,
      p ? p("DISTANCIA") : null,
      p ? p("metros") : null,
      p ? p("METROS") : null,
      p ? p("radio") : null,
      p ? p("RADIO") : null,
      p ? p("valor") : null,
      p ? p("VALOR") : null
    );

    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;

    if (n === 500 || n === 700 || n === 1000) return n;
    if (Math.abs(n - 0.5) < 0.0001) return 500;
    if (Math.abs(n - 0.7) < 0.0001) return 700;
    if (Math.abs(n - 1.0) < 0.0001) return 1000;

    return null;
  } catch {
    return null;
  }
}
function aiLabel(n) {
  if (n === 500) return "Área de Influencia 500";
  if (n === 700) return "Área de Influencia 700";
  if (n === 1000) return "Área de Influencia 1000";
  return "Área de Influencia";
}

/* =========================================================
 *  COMPONENTE
 * =======================================================*/
export default function ModuloPoligonos({
  google,
  map,
  idProyecto,
  visible = true,

  panelOpen = true,
  onOpenChange,
  onClose,

  onHasData,
  onHasUsos,
}) {
  const pidBase = Number(idProyecto);

  const proyectoLayerRef = useRef(null);
  const usoActLayerRef = useRef(null);
  const usoAltLayerRef = useRef(null);
  const comunidadLayerRef = useRef(null);
  const planoLayerRef = useRef(null);
  const areaInfluenciaLayerRef = useRef(null);

  const infoWindowRef = useRef(null);
  const proyectosNameByIdRef = useRef(new Map());

  const listenersRef = useRef({
    proyecto: null,
    comunidad: null,
    usoAct: null,
    usoAlt: null,
    areaInfluencia: null,
  });

  const loadedRef = useRef({
    hermanos: false,
    proyectoSmart: false,
    comunidadKey: "",
    actSel: false,
    altSel: false,
    actAll: false,
    altAll: false,
    plano: false,
    aiSel: false,
    aiAll: false,
  });

  const comunidadReqIdRef = useRef(0);
  const aiReqIdRef = useRef(0);

  const hasDataRef = useRef({
    proyecto: false,
    comunidad: false,
    usoActual: false,
    usoAlternativo: false,
    plano: false,
    areaInfluencia: false,
  });

  // ✅ NUEVO: qué proyectos realmente tienen Polígono del Proyecto
  const proyectosConPoligonoRef = useRef(new Set());
  const firstPidWithPoligonoRef = useRef(null);

  // ✅ disponibilidad para UI
  const [available, setAvailable] = useState({
    proyecto: false,
    comunidad: false,
    usoActual: false,
    usoAlternativo: false,
    plano: false,
    areaInfluencia: false,
  });

  const syncAvailability = useCallback(() => {
    const next = {
      proyecto: !!hasDataRef.current.proyecto,
      comunidad: !!hasDataRef.current.comunidad,
      usoActual: !!hasDataRef.current.usoActual,
      usoAlternativo: !!hasDataRef.current.usoAlternativo,
      plano: !!hasDataRef.current.plano,
      areaInfluencia: !!hasDataRef.current.areaInfluencia,
    };
    setAvailable((prev) => {
      const same =
        prev.proyecto === next.proyecto &&
        prev.comunidad === next.comunidad &&
        prev.usoActual === next.usoActual &&
        prev.usoAlternativo === next.usoAlternativo &&
        prev.plano === next.plano &&
        prev.areaInfluencia === next.areaInfluencia;
      return same ? prev : next;
    });
  }, []);

  const reportHasDataAny = useCallback(() => {
    const any =
      !!hasDataRef.current.proyecto ||
      !!hasDataRef.current.comunidad ||
      !!hasDataRef.current.usoActual ||
      !!hasDataRef.current.usoAlternativo ||
      !!hasDataRef.current.plano ||
      !!hasDataRef.current.areaInfluencia;

    if (typeof onHasData === "function") onHasData(any);

    const anyUsos = !!hasDataRef.current.usoActual || !!hasDataRef.current.usoAlternativo;
    if (typeof onHasUsos === "function") onHasUsos(anyUsos);

    syncAvailability();
  }, [onHasData, onHasUsos, syncAvailability]);

  const layerHasAnyFeature = useCallback((layer) => {
    try {
      if (!layer) return false;
      let any = false;
      layer.forEach(() => {
        any = true;
      });
      return any;
    } catch {
      return false;
    }
  }, []);

  const clearLayer = useCallback((layer) => {
    if (!layer) return;
    layer.forEach((f) => layer.remove(f));
  }, []);

  const didFitRef = useRef(false);

  const [actCatsOpen, setActCatsOpen] = useState(false);
  const [altCatsOpen, setAltCatsOpen] = useState(false);

  const [toggles, setToggles] = useState({
    proyecto: true,
    comunidad: false,
    usoActual: false,
    usoAlternativo: false,
    plano: false,
    areaInfluencia: false,
  });

  const [aiToggles, setAiToggles] = useState({ 500: true, 700: true, 1000: true });

  const [op, setOp] = useState({
    proyecto: 0.25,
    comunidad: 0.25,
    act: 0.85,
    alt: 0.85,
    plano: 0.35,
    ai: 0.18,
  });

  const [catsActUI, setCatsActUI] = useState([]);
  const [catsAltUI, setCatsAltUI] = useState([]);
  const catsActRef = useRef({});
  const catsAltRef = useRef({});

  const [proyectos, setProyectos] = useState([]);
  const [selPid, setSelPid] = useState(pidBase);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (typeof onOpenChange === "function") onOpenChange(!!panelOpen);
  }, [panelOpen, onOpenChange]);

  useEffect(() => {
    setSelPid(pidBase);
    setShowAll(false);
    setProyectos([]);

    catsActRef.current = {};
    catsAltRef.current = {};
    setCatsActUI([]);
    setCatsAltUI([]);

    loadedRef.current = {
      hermanos: false,
      proyectoSmart: false,
      comunidadKey: "",
      actSel: false,
      altSel: false,
      actAll: false,
      altAll: false,
      plano: false,
      aiSel: false,
      aiAll: false,
    };

    hasDataRef.current = {
      proyecto: false,
      comunidad: false,
      usoActual: false,
      usoAlternativo: false,
      plano: false,
      areaInfluencia: false,
    };

    proyectosConPoligonoRef.current = new Set();
    firstPidWithPoligonoRef.current = null;

    setAvailable({
      proyecto: false,
      comunidad: false,
      usoActual: false,
      usoAlternativo: false,
      plano: false,
      areaInfluencia: false,
    });

    // ✅ por defecto dejamos el proyecto ON (fallback para no quedar en blanco)
    setToggles({
      proyecto: true,
      comunidad: false,
      usoActual: false,
      usoAlternativo: false,
      plano: false,
      areaInfluencia: false,
    });

    didFitRef.current = false;
    reportHasDataAny();

    if (proyectoLayerRef.current) clearLayer(proyectoLayerRef.current);
    if (comunidadLayerRef.current) clearLayer(comunidadLayerRef.current);
    if (usoActLayerRef.current) clearLayer(usoActLayerRef.current);
    if (usoAltLayerRef.current) clearLayer(usoAltLayerRef.current);
    if (planoLayerRef.current) clearLayer(planoLayerRef.current);
    if (areaInfluenciaLayerRef.current) clearLayer(areaInfluenciaLayerRef.current);
  }, [pidBase, reportHasDataAny, clearLayer]);

  const ensureInfoWindow = useCallback(() => {
    if (!google || !map) return null;
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();
    return infoWindowRef.current;
  }, [google, map]);

  const getFeaturePid = useCallback((feature) => {
    try {
      const p = feature?.getProperty?.bind(feature);
      const v =
        (p &&
          (p("id_proyecto") ??
            p("ID_PROYECTO") ??
            p("idProyecto") ??
            p("pid") ??
            p("proyecto_id") ??
            p("idproyecto"))) ??
        feature?.getProperty?.("id_proyecto") ??
        feature?.getProperty?.("ID_PROYECTO") ??
        feature?.getProperty?.("proyecto_id") ??
        null;

      return safeNumOrNull(v);
    } catch {
      return null;
    }
  }, []);

  const setUsoExclusive = useCallback((which) => {
    setToggles((prev) => {
      if (which === "act") {
        const nextAct = !prev.usoActual;
        return { ...prev, usoActual: nextAct, usoAlternativo: nextAct ? false : prev.usoAlternativo };
      }
      const nextAlt = !prev.usoAlternativo;
      return { ...prev, usoAlternativo: nextAlt, usoActual: nextAlt ? false : prev.usoActual };
    });
  }, []);

  /* ================== STYLES ================== */
  const applyStyles = useCallback(() => {
    if (!google || !map) return;

    if (proyectoLayerRef.current) {
      proyectoLayerRef.current.setStyle((feature) => {
        const fPid = getFeaturePid(feature);

        // ✅ Si no viene id_proyecto en props, NO lo ocultes.
        const isSel =
          fPid == null ? true : Number(fPid) === Number(selPid);

        const shouldBeVisible = !!toggles.proyecto && (showAll ? true : isSel);
        if (!shouldBeVisible) return { visible: false };

        if (showAll) {
          const BLUE = "#1e90ff";
          return {
            strokeColor: BLUE,
            strokeOpacity: isSel ? 1 : 0.85,
            strokeWeight: isSel ? 3 : 2,
            fillColor: BLUE,
            fillOpacity: isSel ? 0.35 : 0.20,
            clickable: true,
            visible: true,
            zIndex: isSel ? 10 : 9,
          };
        }

        return {
          strokeColor: "#7c3aed",
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: "#7c3aed",
          fillOpacity: op.proyecto,
          clickable: true,
          visible: true,
          zIndex: 10,
        };
      });
    }

    if (areaInfluenciaLayerRef.current) {
      areaInfluenciaLayerRef.current.setStyle((feature) => {
        const vRaw = detectAIValueFromFeature(feature);
        const v = Number(vRaw);
        const col = Number.isFinite(v) && AI_COLORS[v] ? AI_COLORS[v] : AI_COLORS[500];

        const isVisible =
          !!toggles.areaInfluencia && (!Number.isFinite(v) ? true : !!aiToggles[v]);

        return {
          strokeColor: col.stroke,
          strokeOpacity: isVisible ? 1 : 0,
          strokeWeight: 2,
          fillColor: col.fill,
          fillOpacity: isVisible ? op.ai : 0,
          clickable: true,
          visible: isVisible,
          zIndex: aiZIndex(v),
        };
      });
    }

    if (comunidadLayerRef.current) {
      const isVisible = !!toggles.comunidad;
      comunidadLayerRef.current.setStyle(() => ({
        strokeColor: "#ef4444",
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: "#ef4444",
        fillOpacity: isVisible ? op.comunidad : 0,
        clickable: true,
        visible: isVisible,
        zIndex: 20,
      }));
    }

    if (planoLayerRef.current) {
      const isVisible = !!toggles.plano;
      planoLayerRef.current.setStyle(() => ({
        strokeColor: "#7c3aed",
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: "#7c3aed",
        fillOpacity: isVisible ? op.plano : 0,
        clickable: true,
        visible: isVisible,
        zIndex: 25,
      }));
    }

    if (usoActLayerRef.current) {
      usoActLayerRef.current.setStyle((feature) => {
        const { canon } = getUsoCanonAndPretty(feature);
        const { key, rgb } = getColorForUso(canon);
        const k = normKey(key) || "sin-categoria";

        const active = showAll ? true : catsActRef.current?.[k]?.active ?? true;
        const isVisible = !!toggles.usoActual && active;

        return {
          strokeColor: rgbCss(rgb, 1),
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: rgbCss(rgb, 1),
          fillOpacity: isVisible ? op.act : 0,
          clickable: true,
          visible: isVisible,
          zIndex: 30,
        };
      });
    }

    if (usoAltLayerRef.current) {
      usoAltLayerRef.current.setStyle((feature) => {
        const { canon } = getUsoCanonAndPretty(feature);
        const { key, rgb } = getColorForUso(canon);
        const k = normKey(key) || "sin-categoria";

        const active = showAll ? true : catsAltRef.current?.[k]?.active ?? true;
        const isVisible = !!toggles.usoAlternativo && active;

        return {
          strokeColor: rgbCss(rgb, 1),
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: rgbCss(rgb, 1),
          fillOpacity: isVisible ? op.alt : 0,
          clickable: true,
          visible: isVisible,
          zIndex: 40,
        };
      });
    }
  }, [google, map, toggles, op, getFeaturePid, selPid, showAll, aiToggles]);

  /* ================== POPUPS ================== */
  const attachClickPopupUso = useCallback(
    (layer, title, keyName) => {
      if (!google || !map || !layer) return;
      if (listenersRef.current[keyName]) return;

      const l = layer.addListener("click", (e) => {
        const iw = ensureInfoWindow();
        if (!iw) return;

        const { canon, pretty } = getUsoCanonAndPretty(e.feature);
        const { rgb } = getColorForUso(canon);
        const col = rgbCss(rgb, 1);

        const html = `
          <div style="min-width:180px;padding:2px 0;">
            <div style="font-weight:800;margin-bottom:8px;">${title}</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.2);background:${col};display:inline-block;"></span>
              <span style="font-weight:600;">${pretty}</span>
            </div>
          </div>
        `;
        iw.setContent(html);
        iw.setPosition(e.latLng);
        iw.open({ map });
      });

      listenersRef.current[keyName] = l;
    },
    [google, map, ensureInfoWindow]
  );

  const attachClickPopupProyecto = useCallback(() => {
    const layer = proyectoLayerRef.current;
    if (!google || !map || !layer) return;
    if (listenersRef.current.proyecto) return;

    const l = layer.addListener("click", (e) => {
      const iw = ensureInfoWindow();
      if (!iw) return;

      const p = e.feature?.getProperty?.bind(e.feature);
      const fPid = getFeaturePid(e.feature) ?? selPid ?? pidBase;

      const codigo = p ? fixMojibake(p("codigo")) : null;

      let nombre = p ? fixMojibake(p("nombre") || p("proyecto")) : null;
      if (!nombre) nombre = proyectosNameByIdRef.current?.get(Number(fPid)) || null;

      const areaM2 = pickFirstNum(
        p ? p("area_m2") : null,
        p ? p("AREA_M2") : null,
        p ? p("area") : null,
        p ? p("AREA") : null
      );

      const html = `
        <div style="min-width:240px;padding:2px 0;">
          <div style="font-weight:800;margin-bottom:8px;">Datos del Proyecto</div>
          <div style="line-height:1.35;">
            <div><b>ID:</b> ${fPid}</div>
            ${codigo ? `<div><b>Código:</b> ${codigo}</div>` : ""}
            ${nombre ? `<div><b>Nombre:</b> ${nombre}</div>` : ""}
            ${areaM2 != null ? `<div><b>Área:</b> ${fmtAreaM2(areaM2)}</div>` : ""}
          </div>
        </div>
      `;
      iw.setContent(html);
      iw.setPosition(e.latLng);
      iw.open({ map });
    });

    listenersRef.current.proyecto = l;
  }, [google, map, ensureInfoWindow, getFeaturePid, selPid, pidBase]);

  const attachClickPopupComunidad = useCallback(() => {
    const layer = comunidadLayerRef.current;
    if (!google || !map || !layer) return;
    if (listenersRef.current.comunidad) return;

    const l = layer.addListener("click", (e) => {
      const iw = ensureInfoWindow();
      if (!iw) return;

      const p = e.feature?.getProperty?.bind(e.feature);
      const gid = p ? p("gid") ?? p("id") : null;
      const idp = p ? p("id_proyecto") : null;
      const cat = p ? fixMojibake(p("categoria")) : "Comunidad Indígena";
      const nombre = p ? fixMojibake(p("name") || p("nombre") || p("comunidad")) : null;
      const desc = p ? fixMojibake(p("descripcion") || p("observacion") || p("detalle")) : null;

      const html = `
        <div style="min-width:220px;padding:2px 0;">
          <div style="font-weight:800;margin-bottom:8px;">${cat || "Comunidad Indígena"}</div>
          <div style="line-height:1.35;">
            ${idp ? `<div><b>Proyecto:</b> ${idp}</div>` : ""}
            ${gid ? `<div><b>ID:</b> ${gid}</div>` : ""}
            <div><b>Nombre:</b> ${nombre || "Sin nombre"}</div>
            ${desc ? `<div style="margin-top:6px;opacity:.9">${desc}</div>` : ""}
          </div>
        </div>
      `;
      iw.setContent(html);
      iw.setPosition(e.latLng);
      iw.open({ map });
    });

    listenersRef.current.comunidad = l;
  }, [google, map, ensureInfoWindow]);

  const attachClickPopupAreaInfluencia = useCallback(() => {
    const layer = areaInfluenciaLayerRef.current;
    if (!google || !map || !layer) return;
    if (listenersRef.current.areaInfluencia) return;

    const l = layer.addListener("click", (e) => {
      const iw = ensureInfoWindow();
      if (!iw) return;

      const v = detectAIValueFromFeature(e.feature);
      const col = v && AI_COLORS[v] ? AI_COLORS[v] : AI_COLORS[500];
      const title = aiLabel(v);

      const p = e.feature?.getProperty?.bind(e.feature);
      const pid = p ? p("id_proyecto") ?? p("ID_PROYECTO") : null;

      const html = `
        <div style="min-width:240px;padding:2px 0;">
          <div style="font-weight:800;margin-bottom:8px;">${title}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="width:14px;height:14px;border-radius:3px;border:1px solid rgba(0,0,0,.2);background:${col.fill};display:inline-block;"></span>
            <span style="font-weight:800;">${v ? `${v} m` : ""}</span>
          </div>
          ${pid ? `<div style="margin-top:8px;opacity:.9"><b>Proyecto:</b> ${pid}</div>` : ""}
          ${v ? `<div style="margin-top:6px;opacity:.85">Buffer / área de influencia a ${v} metros.</div>` : ""}
        </div>
      `;

      iw.setContent(html);
      iw.setPosition(e.latLng);
      iw.open({ map });
    });

    listenersRef.current.areaInfluencia = l;
  }, [google, map, ensureInfoWindow]);

  /* ================== INIT LAYERS ================== */
  const initLayers = useCallback(() => {
    if (!google || !map) return;

    if (!proyectoLayerRef.current) proyectoLayerRef.current = new google.maps.Data({ map });
    if (!comunidadLayerRef.current) comunidadLayerRef.current = new google.maps.Data({ map });
    if (!usoActLayerRef.current) usoActLayerRef.current = new google.maps.Data({ map });
    if (!usoAltLayerRef.current) usoAltLayerRef.current = new google.maps.Data({ map });
    if (!planoLayerRef.current) planoLayerRef.current = new google.maps.Data({ map });
    if (!areaInfluenciaLayerRef.current) areaInfluenciaLayerRef.current = new google.maps.Data({ map });

    const targetMap = visible ? map : null;
    proyectoLayerRef.current.setMap(targetMap);
    comunidadLayerRef.current.setMap(targetMap);
    usoActLayerRef.current.setMap(targetMap);
    usoAltLayerRef.current.setMap(targetMap);
    planoLayerRef.current.setMap(targetMap);
    areaInfluenciaLayerRef.current.setMap(targetMap);

    attachClickPopupProyecto();
    attachClickPopupComunidad();
    attachClickPopupUso(usoActLayerRef.current, "Uso Actual", "usoAct");
    attachClickPopupUso(usoAltLayerRef.current, "Uso Alternativo", "usoAlt");
    attachClickPopupAreaInfluencia();

    applyStyles();
  }, [
    google,
    map,
    visible,
    attachClickPopupProyecto,
    attachClickPopupComunidad,
    attachClickPopupUso,
    attachClickPopupAreaInfluencia,
    applyStyles,
  ]);

  const buildCatsFromLayer = useCallback((layer) => {
    const cats = {};
    layer.forEach((feature) => {
      const { canon, pretty } = getUsoCanonAndPretty(feature);
      const { key, rgb } = getColorForUso(canon);
      const k = normKey(key) || "sin-categoria";
      if (!cats[k]) cats[k] = { key: k, label: pretty, rgb, active: true };
    });
    return cats;
  }, []);

  /* ================== FIT ================== */
  const tryFitOnce = useCallback(() => {
    if (didFitRef.current) return;
    if (!google || !map) return;

    const MAX_TRIES = 40;
    const DELAY_MS = 200;

    const attempt = (n) => {
      if (didFitRef.current) return;

      let ok = false;

      if (proyectoLayerRef.current && toggles.proyecto) {
        ok = showAll
          ? fitProyectoLayerAll(google, map, proyectoLayerRef.current, 40)
          : fitProyectoLayerByPid(google, map, proyectoLayerRef.current, { pid: selPid, padding: 30 });
      }

      if (!ok && toggles.areaInfluencia && areaInfluenciaLayerRef.current) {
        ok = fitToDataLayer(google, map, areaInfluenciaLayerRef.current, 30);
      }

      if (!ok && toggles.plano && planoLayerRef.current) ok = fitToDataLayer(google, map, planoLayerRef.current, 30);
      if (!ok && toggles.comunidad && comunidadLayerRef.current) ok = fitToDataLayer(google, map, comunidadLayerRef.current, 30);
      if (!ok && toggles.usoActual && usoActLayerRef.current) ok = fitToDataLayer(google, map, usoActLayerRef.current, 30);
      if (!ok && toggles.usoAlternativo && usoAltLayerRef.current) ok = fitToDataLayer(google, map, usoAltLayerRef.current, 30);

      if (ok) {
        didFitRef.current = true;
        return;
      }

      if (n < MAX_TRIES) setTimeout(() => attempt(n + 1), DELAY_MS);
    };

    google.maps.event.addListenerOnce(map, "idle", () => attempt(0));
    setTimeout(() => attempt(0), 0);
  }, [google, map, toggles, showAll, selPid]);

  const freezeAutoFitRef = useRef(false);

  const requestFit = useCallback(
    (mode = "soft") => {
      if (freezeAutoFitRef.current) return;
      didFitRef.current = false;

      if (mode === "soft") {
        setTimeout(() => tryFitOnce(), 0);
        setTimeout(() => tryFitOnce(), 250);
        setTimeout(() => tryFitOnce(), 700);
        return;
      }

      setTimeout(() => tryFitOnce(), 0);
      setTimeout(() => tryFitOnce(), 350);
      setTimeout(() => tryFitOnce(), 900);
    },
    [tryFitOnce]
  );

  /* ================== LOADERS ================== */
  const loadHermanos = useCallback(async () => {
    if (!pidBase) return;
    if (loadedRef.current.hermanos) return;

    try {
      const url = `${API_URL}/proyectos/${pidBase}/hermanos`;
      const resp = await fetch(url, { headers: { ...authHeaders() } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const rows = await resp.json().catch(() => []);
      const list = Array.isArray(rows)
        ? rows
            .map((r) => ({
              id: Number(r?.id ?? r?.id_proyecto ?? r?.gid),
              nombre: fixMojibake(r?.nombre || `Proyecto ${r?.id}`),
            }))
            .filter((x) => Number.isFinite(x.id) && x.id > 0)
        : [];

      if (!list.some((x) => Number(x.id) === Number(pidBase))) {
        list.push({ id: pidBase, nombre: `Proyecto ${pidBase}` });
      }

      setProyectos((prev) => {
        const merged = uniqById([...(list || []), ...(prev || [])], (x) => x?.id);
        merged.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return merged;
      });

      loadedRef.current.hermanos = true;
    } catch {
      setProyectos((prev) => {
        const base = { id: pidBase, nombre: `Proyecto ${pidBase}` };
        const merged = uniqById([base, ...(prev || [])], (x) => x?.id);
        merged.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return merged;
      });
      loadedRef.current.hermanos = true;
    }
  }, [pidBase]);

  const loadPoligonoProyectoSmart = useCallback(async () => {
    if (!google || !map || !pidBase) return;
    if (loadedRef.current.proyectoSmart) return;

    const layer = proyectoLayerRef.current;
    if (!layer) return;

    const URLS_SMART = [
      `${API_URL}/proyectos/${pidBase}/poligonos-smart`,
      `${API_URL}/proyectos/${pidBase}/poligonos`,
      `${API_URL}/proyectos/${pidBase}/capas/poligono`,
      `${API_URL}/proyectos/${pidBase}/capas/poligono-proyecto`,
    ];

    try {
      const { data } = await fetchGeoJSONSmart(URLS_SMART);

      clearLayer(layer);
      try {
        layer.addGeoJson(data, { idPropertyName: "gid" });
      } catch {
        layer.addGeoJson(data);
      }

      // ✅ detectar qué PIDs tienen polígono
      const pidSet = new Set();
      let anyFeature = false;

      const pidMap = new Map();

      layer.forEach((f) => {
        anyFeature = true;

        const fPid = getFeaturePid(f);
        if (fPid != null) pidSet.add(Number(fPid));

        const p = f.getProperty?.bind(f);
        const name = fixMojibake((p && (p("nombre") || p("proyecto"))) || `Proyecto ${fPid ?? pidBase}`);
        if (fPid != null) pidMap.set(Number(fPid), name);
      });

      proyectosConPoligonoRef.current = pidSet;
      firstPidWithPoligonoRef.current = pidSet.size ? Array.from(pidSet)[0] : null;

      if (!pidMap.has(pidBase)) pidMap.set(pidBase, `Proyecto ${pidBase}`);

      hasDataRef.current.proyecto = !!anyFeature;
      reportHasDataAny();

      const listFromPol = Array.from(pidMap.entries()).map(([id, nombre]) => ({ id, nombre }));

      setProyectos((prev) => {
        const merged = uniqById([...(prev || []), ...listFromPol], (x) => x?.id);
        merged.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return merged;
      });

      loadedRef.current.proyectoSmart = true;

      // ✅ si selPid no tiene polígono, elegimos uno que sí tenga
      const sel = Number(selPid);
      const base = Number(pidBase);
      const fallback = firstPidWithPoligonoRef.current;

      const hasSel = sel && proyectosConPoligonoRef.current.has(sel);
      const hasBase = base && proyectosConPoligonoRef.current.has(base);

      let nextPid = null;
      if (hasSel) nextPid = sel;
      else if (hasBase) nextPid = base;
      else if (fallback) nextPid = Number(fallback);

      if (nextPid && nextPid !== selPid) {
        setSelPid(nextPid);
        setShowAll(false);
        setToggles((p) => ({ ...p, proyecto: true }));
        // re-aplicar estilo después del setState
        setTimeout(() => requestFit("soft"), 0);
      } else {
        applyStyles();
        if (toggles.proyecto) requestFit("soft");
      }
    } catch (e) {
      console.warn("No se pudo cargar polígono smart:", e?.message || e);

      hasDataRef.current.proyecto = false;
      reportHasDataAny();

      setProyectos((prev) => {
        const base = { id: pidBase, nombre: `Proyecto ${pidBase}` };
        const merged = uniqById([base, ...(prev || [])], (x) => x?.id);
        merged.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
        return merged;
      });

      loadedRef.current.proyectoSmart = true;
      applyStyles();
    }
  }, [
    google,
    map,
    pidBase,
    selPid,
    getFeaturePid,
    applyStyles,
    requestFit,
    reportHasDataAny,
    clearLayer,
    toggles.proyecto,
  ]);

  const loadPlanoProyecto = useCallback(async () => {
    if (!google || !map || !pidBase) return;
    if (loadedRef.current.plano) return;

    const layer = planoLayerRef.current;
    if (!layer) return;

    const URLS = [
      `${API_URL}/mantenimiento/plano/${pidBase}`,
      `${API_URL}/proyectos/${pidBase}/capas/plano`,
      `${API_URL}/proyectos/${pidBase}/capas/plano-proyecto`,
      `${API_URL}/proyectos/${pidBase}/plano`,
    ];

    try {
      const { data } = await fetchGeoJSONSmart(URLS);
      clearLayer(layer);
      layer.addGeoJson(data);

      loadedRef.current.plano = true;

      hasDataRef.current.plano = layerHasAnyFeature(layer);
      reportHasDataAny();

      applyStyles();
      if (toggles.plano) requestFit("soft");
    } catch {
      loadedRef.current.plano = true;
      hasDataRef.current.plano = false;
      reportHasDataAny();
      applyStyles();
    }
  }, [
    google,
    map,
    pidBase,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    clearLayer,
    toggles.plano,
  ]);

  const loadAreaInfluenciaSelected = useCallback(async () => {
    if (!google || !map || !selPid) return;
    if (loadedRef.current.aiSel) return;

    const layer = areaInfluenciaLayerRef.current;
    if (!layer) return;

    const URLS = [
      `${API_URL}/proyectos/area-influencia/${selPid}`,
      `${API_URL}/proyectos/area-influencia/${pidBase}`,
    ];

    try {
      const { data } = await fetchGeoJSONSmart(URLS);
      clearLayer(layer);
      layer.addGeoJson(data);

      loadedRef.current.aiSel = true;

      hasDataRef.current.areaInfluencia = layerHasAnyFeature(layer);
      reportHasDataAny();

      applyStyles();
      if (toggles.areaInfluencia) requestFit("soft");
    } catch {
      loadedRef.current.aiSel = true;
      hasDataRef.current.areaInfluencia = false;
      reportHasDataAny();
      applyStyles();
    }
  }, [
    google,
    map,
    selPid,
    pidBase,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    clearLayer,
    toggles.areaInfluencia,
  ]);

  const loadAreaInfluenciaAll = useCallback(async () => {
    if (!google || !map) return;
    if (loadedRef.current.aiAll) return;

    const layer = areaInfluenciaLayerRef.current;
    if (!layer) return;

    const ids = proyectos?.map((p) => p.id).filter(Boolean) || [];
    if (!ids.length) {
      loadedRef.current.aiAll = true;
      hasDataRef.current.areaInfluencia = false;
      reportHasDataAny();
      return;
    }

    const reqId = ++aiReqIdRef.current;
    clearLayer(layer);

    await mapLimit(ids, 4, async (pid) => {
      if (aiReqIdRef.current !== reqId) return;

      const URLS = [`${API_URL}/proyectos/area-influencia/${pid}`];

      try {
        const { data } = await fetchGeoJSONSmart(URLS);
        const patched = {
          ...data,
          features: (data?.features || []).map((f) => ({
            ...f,
            properties: { ...(f.properties || {}), id_proyecto: f?.properties?.id_proyecto ?? pid },
          })),
        };
        layer.addGeoJson(patched);
      } catch {}
    });

    loadedRef.current.aiAll = true;

    hasDataRef.current.areaInfluencia = layerHasAnyFeature(layer);
    reportHasDataAny();

    applyStyles();
    if (toggles.areaInfluencia) requestFit("soft");
  }, [
    google,
    map,
    proyectos,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    clearLayer,
    toggles.areaInfluencia,
  ]);

  const loadUsoActualSelected = useCallback(async () => {
    if (!google || !map || !selPid) return;
    if (loadedRef.current.actSel) return;

    const layer = usoActLayerRef.current;
    if (!layer) return;

    const URLS = [
      `${API_URL}/proyectos/uso-actual/${selPid}`,
      `${API_URL}/proyectos/${selPid}/capas/uso-actual`,
    ];

    try {
      const { data } = await fetchGeoJSONSmart(URLS);
      clearLayer(layer);
      layer.addGeoJson(data);

      const cats = buildCatsFromLayer(layer);
      catsActRef.current = cats;
      setCatsActUI(Object.values(cats).sort((a, b) => a.label.localeCompare(b.label)));

      loadedRef.current.actSel = true;

      hasDataRef.current.usoActual = layerHasAnyFeature(layer);
      reportHasDataAny();

      applyStyles();
      if (toggles.usoActual) requestFit("soft");
    } catch {
      loadedRef.current.actSel = true;
      hasDataRef.current.usoActual = false;
      reportHasDataAny();
      applyStyles();
    }
  }, [
    google,
    map,
    selPid,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    buildCatsFromLayer,
    clearLayer,
    toggles.usoActual,
  ]);

  const loadUsoAlternativoSelected = useCallback(async () => {
    if (!google || !map || !selPid) return;
    if (loadedRef.current.altSel) return;

    const layer = usoAltLayerRef.current;
    if (!layer) return;

    const URLS = [
      `${API_URL}/proyectos/uso-alternativo/${selPid}`,
      `${API_URL}/proyectos/${selPid}/capas/uso-alternativo`,
    ];

    try {
      const { data } = await fetchGeoJSONSmart(URLS);
      clearLayer(layer);
      layer.addGeoJson(data);

      const cats = buildCatsFromLayer(layer);
      catsAltRef.current = cats;
      setCatsAltUI(Object.values(cats).sort((a, b) => a.label.localeCompare(b.label)));

      loadedRef.current.altSel = true;

      hasDataRef.current.usoAlternativo = layerHasAnyFeature(layer);
      reportHasDataAny();

      applyStyles();
      if (toggles.usoAlternativo) requestFit("soft");
    } catch {
      loadedRef.current.altSel = true;
      hasDataRef.current.usoAlternativo = false;
      reportHasDataAny();
      applyStyles();
    }
  }, [
    google,
    map,
    selPid,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    buildCatsFromLayer,
    clearLayer,
    toggles.usoAlternativo,
  ]);

  const loadUsoActualAll = useCallback(async () => {
    if (!google || !map) return;
    if (loadedRef.current.actAll) return;

    const layer = usoActLayerRef.current;
    if (!layer) return;

    const ids = proyectos?.map((p) => p.id).filter(Boolean) || [];
    if (!ids.length) {
      loadedRef.current.actAll = true;
      hasDataRef.current.usoActual = false;
      reportHasDataAny();
      return;
    }

    clearLayer(layer);

    await mapLimit(ids, 4, async (pid) => {
      const URLS = [
        `${API_URL}/proyectos/uso-actual/${pid}`,
        `${API_URL}/proyectos/${pid}/capas/uso-actual`,
      ];
      try {
        const { data } = await fetchGeoJSONSmart(URLS);
        const clean = stripRestoDePropiedad(data);
        layer.addGeoJson(clean);
      } catch {}
    });

    loadedRef.current.actAll = true;

    hasDataRef.current.usoActual = layerHasAnyFeature(layer);
    reportHasDataAny();

    applyStyles();
    if (toggles.usoActual) requestFit("soft");
  }, [
    google,
    map,
    proyectos,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    clearLayer,
    toggles.usoActual,
  ]);

  const loadUsoAlternativoAll = useCallback(async () => {
    if (!google || !map) return;
    if (loadedRef.current.altAll) return;

    const layer = usoAltLayerRef.current;
    if (!layer) return;

    const ids = proyectos?.map((p) => p.id).filter(Boolean) || [];
    if (!ids.length) {
      loadedRef.current.altAll = true;
      hasDataRef.current.usoAlternativo = false;
      reportHasDataAny();
      return;
    }

    clearLayer(layer);

    await mapLimit(ids, 4, async (pid) => {
      const URLS = [
        `${API_URL}/proyectos/uso-alternativo/${pid}`,
        `${API_URL}/proyectos/${pid}/capas/uso-alternativo`,
      ];
      try {
        const { data } = await fetchGeoJSONSmart(URLS);
        const clean = stripRestoDePropiedad(data);
        layer.addGeoJson(clean);
      } catch {}
    });

    loadedRef.current.altAll = true;

    hasDataRef.current.usoAlternativo = layerHasAnyFeature(layer);
    reportHasDataAny();

    applyStyles();
    if (toggles.usoAlternativo) requestFit("soft");
  }, [
    google,
    map,
    proyectos,
    applyStyles,
    requestFit,
    layerHasAnyFeature,
    reportHasDataAny,
    clearLayer,
    toggles.usoAlternativo,
  ]);

  const loadComunidadIndigena = useCallback(async () => {
    if (!google || !map) return;

    const layer = comunidadLayerRef.current;
    if (!layer) return;

    const ids = showAll
      ? proyectos?.map((p) => Number(p.id)).filter(Boolean) || []
      : [Number(selPid)].filter(Boolean);

    const key = showAll
      ? `all:${ids.slice().sort((a, b) => a - b).join(",")}`
      : `sel:${Number(selPid)}`;

    if (loadedRef.current.comunidadKey === key) return;

    const reqId = ++comunidadReqIdRef.current;
    loadedRef.current.comunidadKey = key;

    clearLayer(layer);

    if (!ids.length) {
      hasDataRef.current.comunidad = false;
      reportHasDataAny();
      applyStyles();
      return;
    }

    let totalAdded = 0;
    let hadAuthError = false;

    await mapLimit(ids, 4, async (pid) => {
      if (comunidadReqIdRef.current !== reqId) return;

      const url = `${API_URL}/proyectos/com-indigena/${pid}`;

      try {
        const resp = await fetch(url, { headers: { ...authHeaders() } });
        if (resp.status === 401 || resp.status === 403) {
          hadAuthError = true;
          return;
        }
        if (!resp.ok) return;

        const data = await resp.json().catch(() => null);
        const feats = Array.isArray(data?.features) ? data.features : [];
        if (!feats.length) return;

        const patched = {
          ...data,
          features: feats.map((f) => ({
            ...f,
            properties: { ...(f.properties || {}), id_proyecto: f?.properties?.id_proyecto ?? pid },
          })),
        };

        if (comunidadReqIdRef.current !== reqId) return;

        try {
          layer.addGeoJson(patched, { idPropertyName: "gid" });
        } catch {
          layer.addGeoJson(patched);
        }
        totalAdded += patched.features.length;
      } catch {}
    });

    if (comunidadReqIdRef.current !== reqId) return;

    if (hadAuthError) loadedRef.current.comunidadKey = "";

    hasDataRef.current.comunidad = totalAdded > 0 || layerHasAnyFeature(layer);
    reportHasDataAny();
    applyStyles();

    if (hasDataRef.current.comunidad && toggles.comunidad) requestFit("soft");
  }, [
    google,
    map,
    selPid,
    showAll,
    proyectos,
    toggles.comunidad,
    clearLayer,
    applyStyles,
    requestFit,
    reportHasDataAny,
    layerHasAnyFeature,
  ]);

  /* ================== INIT + MAIN EFFECT ================== */
  useEffect(() => {
    initLayers();
  }, [initLayers]);

  useEffect(() => {
    loadedRef.current.actSel = false;
    loadedRef.current.altSel = false;
    loadedRef.current.actAll = false;
    loadedRef.current.altAll = false;
    loadedRef.current.aiSel = false;
    loadedRef.current.aiAll = false;

    if (usoActLayerRef.current) clearLayer(usoActLayerRef.current);
    if (usoAltLayerRef.current) clearLayer(usoAltLayerRef.current);
    if (areaInfluenciaLayerRef.current) clearLayer(areaInfluenciaLayerRef.current);

    hasDataRef.current.usoActual = false;
    hasDataRef.current.usoAlternativo = false;
    hasDataRef.current.areaInfluencia = false;
    reportHasDataAny();

    if (!showAll) {
      catsActRef.current = {};
      catsAltRef.current = {};
      setCatsActUI([]);
      setCatsAltUI([]);
    }
  }, [showAll, clearLayer, reportHasDataAny]);

  useEffect(() => {
    loadedRef.current.comunidadKey = "";
    comunidadReqIdRef.current += 1;
    if (comunidadLayerRef.current) clearLayer(comunidadLayerRef.current);
  }, [selPid, showAll, clearLayer]);

  useEffect(() => {
    if (!visible) {
      const t = null;
      proyectoLayerRef.current?.setMap?.(t);
      comunidadLayerRef.current?.setMap?.(t);
      usoActLayerRef.current?.setMap?.(t);
      usoAltLayerRef.current?.setMap?.(t);
      planoLayerRef.current?.setMap?.(t);
      areaInfluenciaLayerRef.current?.setMap?.(t);
      return;
    }

    proyectoLayerRef.current?.setMap?.(map);
    comunidadLayerRef.current?.setMap?.(map);
    usoActLayerRef.current?.setMap?.(map);
    usoAltLayerRef.current?.setMap?.(map);
    planoLayerRef.current?.setMap?.(map);
    areaInfluenciaLayerRef.current?.setMap?.(map);
  }, [visible, map]);

  // ✅ si NO hay uso actual ni alternativo, mantenemos proyecto ON para no “quedar en blanco”
  useEffect(() => {
    const noUsos = !available.usoActual && !available.usoAlternativo;
    if (noUsos && available.proyecto) {
      setToggles((p) => ({ ...p, proyecto: true }));
    }
  }, [available.usoActual, available.usoAlternativo, available.proyecto]);

  // ✅ MAIN: PRELOAD
  useEffect(() => {
    if (!visible) return;
    if (!google || !map || !pidBase) return;

    loadHermanos();

    // ✅ PRELOAD SIEMPRE
    loadPoligonoProyectoSmart();
    loadPlanoProyecto();

    loadComunidadIndigena();

    if (showAll) {
      if (proyectos.length) {
        loadAreaInfluenciaAll();
        loadUsoActualAll();
        loadUsoAlternativoAll();
      }
    } else {
      loadAreaInfluenciaSelected();
      loadUsoActualSelected();
      loadUsoAlternativoSelected();
    }

    requestFit("soft");
  }, [
    visible,
    google,
    map,
    pidBase,
    showAll,
    proyectos,
    selPid,
    loadHermanos,
    loadPoligonoProyectoSmart,
    loadPlanoProyecto,
    loadComunidadIndigena,
    loadUsoActualSelected,
    loadUsoAlternativoSelected,
    loadUsoActualAll,
    loadUsoAlternativoAll,
    requestFit,
    loadAreaInfluenciaSelected,
    loadAreaInfluenciaAll,
  ]);

  useLayoutEffect(() => {
    applyStyles();
  }, [applyStyles]);

  const proyectosOpts = useMemo(() => {
    const base = proyectos?.length ? proyectos : [{ id: pidBase, nombre: `Proyecto ${pidBase}` }];
    return uniqById(base, (x) => x?.id);
  }, [proyectos, pidBase]);

  useEffect(() => {
    const m = new Map();
    (proyectos || []).forEach((p) => {
      const id = Number(p?.id);
      if (!Number.isFinite(id) || id <= 0) return;
      m.set(id, fixMojibake(p?.nombre || `Proyecto ${id}`));
    });
    proyectosNameByIdRef.current = m;
  }, [proyectos]);

  const hasMulti = proyectosOpts.length > 1;

  useEffect(() => {
    if (!hasMulti && showAll) setShowAll(false);
  }, [hasMulti, showAll]);

  const selectedName = useMemo(() => {
    const f = proyectosOpts.find((p) => Number(p.id) === Number(selPid));
    return f?.nombre || `Proyecto ${selPid || pidBase}`;
  }, [proyectosOpts, selPid, pidBase]);

  if (!google || !map) return null;
  if (!visible) return null;
  if (!panelOpen) return null;

  const closeModal = () => {
    if (typeof onClose === "function") return onClose();
    if (typeof onOpenChange === "function") onOpenChange(false);
  };

  const onChangeSelPid = (e) => {
    const v = Number(e.target.value);
    if (!v) return;

    // ✅ si el elegido no tiene polígono, caemos a uno que sí tenga
    const hasPoly = proyectosConPoligonoRef.current?.has(Number(v));
    if (!hasPoly) {
      const fb = firstPidWithPoligonoRef.current;
      if (fb) {
        setSelPid(Number(fb));
        setShowAll(false);
        setToggles((p) => ({ ...p, proyecto: true }));
        requestFit("hard");
        return;
      }
    }

    setSelPid(v);
    setShowAll(false);

    loadedRef.current.actSel = false;
    loadedRef.current.altSel = false;
    loadedRef.current.aiSel = false;

    requestFit("hard");
  };

  const countActive = (arr) => arr.reduce((n, c) => n + (c.active ? 1 : 0), 0);

  const setAllCats = (which, on) => {
    if (which === "act") {
      const m = { ...catsActRef.current };
      Object.keys(m).forEach((k) => (m[k] = { ...m[k], active: on }));
      catsActRef.current = m;
      setCatsActUI(Object.values(m).sort((a, b) => a.label.localeCompare(b.label)));
    } else {
      const m = { ...catsAltRef.current };
      Object.keys(m).forEach((k) => (m[k] = { ...m[k], active: on }));
      catsAltRef.current = m;
      setCatsAltUI(Object.values(m).sort((a, b) => a.label.localeCompare(b.label)));
    }
    applyStyles();
  };

  const toggleCat = (which, key) => {
    if (which === "act") {
      const m = { ...catsActRef.current };
      if (m[key]) m[key] = { ...m[key], active: !m[key].active };
      catsActRef.current = m;
      setCatsActUI(Object.values(m).sort((a, b) => a.label.localeCompare(b.label)));
    } else {
      const m = { ...catsAltRef.current };
      if (m[key]) m[key] = { ...m[key], active: !m[key].active };
      catsAltRef.current = m;
      setCatsAltUI(Object.values(m).sort((a, b) => a.label.localeCompare(b.label)));
    }
    applyStyles();
  };

  const aiLegend = [
    { k: 500, label: "500", color: AI_COLORS[500].fill },
    { k: 700, label: "700", color: AI_COLORS[700].fill },
    { k: 1000, label: "1000", color: AI_COLORS[1000].fill },
  ];

  // ✅ OCULTAR capas sin data (para no confundir)
  const HIDE_EMPTY_LAYERS = true;
  const showLayer = (key) => !HIDE_EMPTY_LAYERS || !!available[key];

  return (
    <div className="vf-panel-wrap">
      <div className="vf-panel">
        <div className="vf-menu-header">
          <div className="vf-menu-titles">
            <div className="vf-menu-top">Menú</div>
            <div className="vf-menu-sub">Capas</div>
          </div>

          <button className="vf-x" type="button" onClick={closeModal} title="Cerrar">
            ✕
          </button>
        </div>

        <div className="vf-panel-body">
          {/* ===================== PROYECTO ===================== */}
          {showLayer("proyecto") && (
            <>
              <RowSwitch
                label="Polígono del Proyecto"
                checked={toggles.proyecto}
                onChange={() => {
                  setToggles((p) => ({ ...p, proyecto: !p.proyecto }));
                  requestFit("soft");
                }}
              />

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#374151" }}>
                  Seleccionado: <span style={{ fontWeight: 900 }}>{selectedName}</span>
                </div>

                {hasMulti && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <select
                      className="vf-select"
                      value={selPid || ""}
                      onChange={onChangeSelPid}
                      style={{
                        borderRadius: 10,
                        padding: "8px 10px",
                        border: "1px solid rgba(0,0,0,.12)",
                        background: "white",
                        fontSize: 13,
                      }}
                      title="Seleccionar proyecto"
                    >
                      {proyectosOpts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>

                    <button
                      className="vf-btn"
                      type="button"
                      onClick={() => {
                        setShowAll((v) => {
                          const next = !v;

                          loadedRef.current.actSel = false;
                          loadedRef.current.altSel = false;
                          loadedRef.current.actAll = false;
                          loadedRef.current.altAll = false;
                          loadedRef.current.aiSel = false;
                          loadedRef.current.aiAll = false;

                          if (usoActLayerRef.current) clearLayer(usoActLayerRef.current);
                          if (usoAltLayerRef.current) clearLayer(usoAltLayerRef.current);
                          if (areaInfluenciaLayerRef.current) clearLayer(areaInfluenciaLayerRef.current);

                          if (next) {
                            setToggles((p) => ({ ...p, proyecto: true }));

                            freezeAutoFitRef.current = true;

                            const MAX_TRIES = 40;
                            const DELAY_MS = 200;

                            const attempt = (n) => {
                              const layer = proyectoLayerRef.current;
                              if (google && map && layer) {
                                const ok = fitProyectoLayerAll(google, map, layer, 40);
                                if (ok) {
                                  setTimeout(() => {
                                    freezeAutoFitRef.current = false;
                                  }, 700);
                                  return;
                                }
                              }
                              if (n < MAX_TRIES) setTimeout(() => attempt(n + 1), DELAY_MS);
                              else freezeAutoFitRef.current = false;
                            };

                            setTimeout(() => attempt(0), 0);
                          } else {
                            freezeAutoFitRef.current = false;
                            requestFit("hard");
                          }

                          return next;
                        });
                      }}
                      style={{
                        borderRadius: 10,
                        padding: "8px 10px",
                        border: "1px solid rgba(0,0,0,.12)",
                        background: showAll ? "#111827" : "#f3f4f6",
                        color: showAll ? "white" : "#111827",
                        fontWeight: 800,
                        fontSize: 13,
                        whiteSpace: "nowrap",
                      }}
                      title="Ver todos los polígonos relacionados"
                    >
                      {showAll ? "✓ Ver todos" : "Ver todos"}
                    </button>
                  </div>
                )}
              </div>

              {!showAll && (
                <>
                  <OpacityRow
                    value={op.proyecto}
                    onChange={(v) => {
                      setOp((p) => ({ ...p, proyecto: v }));
                      // ✅ asegura repaint
                    }}
                  />
                  <div className="vf-legend-row">
                    <span className="vf-chip" style={{ background: "#7c3aed" }} />
                    <span className="vf-legend-txt">Proyecto</span>
                  </div>
                </>
              )}

              {hasMulti && showAll && (
                <div className="vf-legend-row" style={{ marginTop: 8 }}>
                  <span className="vf-chip" style={{ background: "#1e90ff" }} />
                  <span className="vf-legend-txt">Seleccionado (35%)</span>
                  <span style={{ width: 12 }} />
                  <span className="vf-chip" style={{ background: "#1e90ff" }} />
                  <span className="vf-legend-txt">Otros (20%)</span>
                </div>
              )}

              <div style={{ marginTop: 14 }} />
            </>
          )}

          {/* ===================== ÁREA INFLUENCIA ===================== */}
          {showLayer("areaInfluencia") && (
            <>
              <RowSwitch
                label="Área de Influencia"
                checked={toggles.areaInfluencia}
                onChange={() => {
                  setToggles((p) => ({ ...p, areaInfluencia: !p.areaInfluencia }));
                  requestFit("soft");
                }}
              />

              {toggles.areaInfluencia && (
                <>
                  <OpacityRow
                    value={op.ai}
                    onChange={(v) => {
                      setOp((p) => ({ ...p, ai: v }));
                    }}
                  />

                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {aiLegend.map((it) => (
                      <div
                        key={it.k}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,.10)",
                          background: "white",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="vf-chip" style={{ background: it.color }} />
                          <span style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>
                            {it.label} m
                          </span>
                        </div>

                        <label className="vf-switch" title={`Mostrar ${it.label}m`}>
                          <input
                            type="checkbox"
                            checked={!!aiToggles[it.k]}
                            onChange={() => {
                              setAiToggles((p) => ({ ...p, [it.k]: !p[it.k] }));
                            }}
                          />
                          <span className="vf-switch-track" />
                          <span className="vf-switch-thumb" />
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ marginTop: 14 }} />
            </>
          )}

          {/* ===================== PLANO ===================== */}
          {showLayer("plano") && (
            <>
              <RowSwitch
                label="Plano del Proyecto"
                checked={toggles.plano}
                onChange={() => {
                  setToggles((p) => ({ ...p, plano: !p.plano }));
                  requestFit("soft");
                }}
              />
              <OpacityRow
                value={op.plano}
                onChange={(v) => {
                  setOp((p) => ({ ...p, plano: v }));
                }}
              />
              <div className="vf-legend-row" style={{ marginTop: 6 }}>
                <span className="vf-chip" style={{ background: "#7c3aed" }} />
                <span className="vf-legend-txt">Plano (morado)</span>
              </div>

              <div style={{ marginTop: 14 }} />
            </>
          )}

          {/* ===================== COMUNIDAD ===================== */}
          {showLayer("comunidad") && (
            <>
              <RowSwitch
                label="Comunidad Indígena"
                checked={toggles.comunidad}
                onChange={() => {
                  setToggles((p) => ({ ...p, comunidad: !p.comunidad }));
                  requestFit("soft");
                }}
                
              />
              <OpacityRow
                value={op.comunidad}
                onChange={(v) => {
                  setOp((p) => ({ ...p, comunidad: v }));
                }}
              />
              <div className="vf-legend-row" style={{ marginTop: 6 }}>
                <span className="vf-chip" style={{ background: "#ef4444" }} />
                <span className="vf-legend-txt">Comunidad</span>
              </div>

              <div style={{ marginTop: 14 }} />
            </>
          )}

          {/* ===================== USO ACTUAL ===================== */}
          {showLayer("usoActual") && (
            <>
              <RowSwitch
                label="Uso Actual"
                checked={toggles.usoActual}
                onChange={() => {
                  setUsoExclusive("act");
                  requestFit("hard");
                }}
              />

              {toggles.usoActual && (
                <>
                  <OpacityRow
                    value={op.act}
                    onChange={(v) => {
                      setOp((p) => ({ ...p, act: v }));
                    }}
                  />

                  {!showAll && (
                    <>
                      <CollapsibleHeader
                        title="Categorías del Uso Actual"
                        pill={`${countActive(catsActUI)}/${catsActUI.length}`}
                        open={actCatsOpen}
                        onToggle={() => setActCatsOpen((v) => !v)}
                      />
                      {actCatsOpen && (
                        <div style={{ marginTop: 10 }}>
                          <div className="vf-two-btn">
                            <Btn onClick={() => setAllCats("act", true)}>Todos</Btn>
                            <Btn onClick={() => setAllCats("act", false)}>Ninguno</Btn>
                          </div>
                          <div className="vf-cats-scroll">
                            {catsActUI.map((c) => (
                              <CatItem key={c.key} item={c} onToggle={() => toggleCat("act", c.key)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <div style={{ marginTop: 14 }} />
            </>
          )}

          {/* ===================== USO ALTERNATIVO ===================== */}
          {showLayer("usoAlternativo") && (
            <>
              <RowSwitch
                label="Uso Alternativo"
                checked={toggles.usoAlternativo}
                onChange={() => {
                  setUsoExclusive("alt");
                  requestFit("hard");
                }}
              />

              {toggles.usoAlternativo && (
                <>
                  <OpacityRow
                    value={op.alt}
                    onChange={(v) => {
                      setOp((p) => ({ ...p, alt: v }));
                    }}
                  />

                  {!showAll && (
                    <>
                      <CollapsibleHeader
                        title="Categorías del Uso Alternativo"
                        pill={`${countActive(catsAltUI)}/${catsAltUI.length}`}
                        open={altCatsOpen}
                        onToggle={() => setAltCatsOpen((v) => !v)}
                      />
                      {altCatsOpen && (
                        <div style={{ marginTop: 10 }}>
                          <div className="vf-two-btn">
                            <Btn onClick={() => setAllCats("alt", true)}>Todos</Btn>
                            <Btn onClick={() => setAllCats("alt", false)}>Ninguno</Btn>
                          </div>
                          <div className="vf-cats-scroll">
                            {catsAltUI.map((c) => (
                              <CatItem key={c.key} item={c} onToggle={() => toggleCat("alt", c.key)} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <div style={{ marginTop: 14 }} />
            </>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              className="vf-btn"
              type="button"
              onClick={() => requestFit("hard")}
              style={{
                width: "100%",
                borderRadius: 10,
                padding: "10px 12px",
                border: "1px solid rgba(0,0,0,.12)",
                background: "blue",
                fontWeight: 900,
                color: "white",
              }}
            >
              Centrar capas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================== UI helpers ================== */
function RowSwitch({ label, checked, onChange }) {
  return (
    <div className="vf-row-switch">
      <span className="vf-row-label">{label}</span>
      <label className="vf-switch">
        <input type="checkbox" checked={!!checked} onChange={onChange} />
        <span className="vf-switch-track" />
        <span className="vf-switch-thumb" />
      </label>
    </div>
  );
}

function OpacityRow({ value, onChange }) {
  return (
    <div className="vf-opacity-row">
      <span className="vf-opacity-label">Opacidad</span>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="vf-opacity-pct">{Math.round(value * 100)}%</span>
    </div>
  );
}

function CollapsibleHeader({ title, pill, open, onToggle }) {
  return (
    <button className="vf-collapsible" type="button" onClick={onToggle}>
      <span className="vf-coll-title">{title}</span>
      <span className="vf-pill">{pill}</span>
      <span className="vf-coll-ico">{open ? "▾" : "▸"}</span>
    </button>
  );
}

function Btn({ children, onClick }) {
  return (
    <button className="vf-mini-btn" type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function CatItem({ item, onToggle }) {
  const col = `rgb(${(item.rgb || [156, 163, 175]).join(",")})`;
  return (
    <button className={`vf-cat ${item.active ? "on" : "off"}`} type="button" onClick={onToggle}>
      <span className="vf-chip" style={{ background: col }} />
      <span className="vf-cat-label">{item.label}</span>
      <span className="vf-cat-state">{item.active ? "✓" : ""}</span>
    </button>
  );
}