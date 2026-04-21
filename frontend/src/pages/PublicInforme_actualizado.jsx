// src/pages/PublicInforme.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Swal from "sweetalert2";
import GoogleMapaCoordenadas from "@/components/GoogleMapaCoordenadas";

const MAX_FOTOS_POR_PREGUNTA = 4;
const MAX_PENDIENTES = 200;

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2600,
  timerProgressBar: true,
  width: 440,
  didOpen: (popup) => {
    popup.style.wordBreak = "break-word";
    popup.style.overflowWrap = "anywhere";
    popup.style.whiteSpace = "normal";
  },
});

/**
 * ✅ IMPORTANTE (fix):
 * VITE_API_URL debe ser base host (sin /api) o con /api, da igual.
 * Este bloque evita dobles "/api/api".
 */
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;


function buildClientRequestId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/* ------------------------ Helpers ------------------------ */
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      data?.error || data?.message || data?.raw || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* ------------------------ ✅ Cache local (form por token) ------------------------ */
const CACHE_KEY = (token) => `public_informe_cache_${token}`;
function cacheSet(token, data) {
  try {
    localStorage.setItem(CACHE_KEY(token), JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}
function cacheGet(token) {
  try {
    const raw = localStorage.getItem(CACHE_KEY(token));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j?.data || null;
  } catch {
    return null;
  }
}

/* ------------------------ IndexedDB (cola offline) ------------------------ */
const IDB_DB = "ema_public_informes";
const IDB_VER = 1;
const IDB_STORE = "queue";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, IDB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "idLocal" });
        store.createIndex("token", "token", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB"));
  });
}

async function idbAdd(item) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put(item);

    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Error guardando en IndexedDB"));
    };
  });
}

async function idbDelete(idLocal) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.delete(idLocal);

    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Error borrando en IndexedDB"));
    };
  });
}

async function idbListByToken(token) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const idx = store.index("token");
    const req = idx.getAll(IDBKeyRange.only(token));

    req.onsuccess = () => {
      const rows = Array.isArray(req.result) ? req.result : [];
      rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      db.close();
      resolve(rows);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error("Error leyendo cola de IndexedDB"));
    };
  });
}

async function idbCountByToken(token) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const idx = store.index("token");
    const req = idx.count(IDBKeyRange.only(token));

    req.onsuccess = () => {
      db.close();
      resolve(Number(req.result || 0));
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error("Error contando cola en IndexedDB"));
    };
  });
}

/* ------------------------ Condicionales visible_if / required_if / hide_if ------------------------ */
function parseCondMaybe(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      const j = JSON.parse(s);
      return j && typeof j === "object" ? j : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeMultiFromText(val) {
  if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean);
  if (val == null) return [];
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j)) return j.map((x) => String(x).trim()).filter(Boolean);
      } catch {}
    }
    return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function isCoordsTipo(tipo) {
  const t = String(tipo || "").toLowerCase();
  return t === "coordenada" || t === "coordenadas";
}

/** ✅ acepta coordenadas como [lat,lng] o {lat,lng} o "lat,lng" */
function normalizeCoordsValue(v) {
  if (v == null) return null;

  if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];

  if (typeof v === "object") {
    if (v.lat != null && v.lng != null) return [v.lat, v.lng];
    if (v.latitude != null && v.longitude != null) return [v.latitude, v.longitude];
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const parts = s.split(/[,;| ]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts[1]];
  }

  return null;
}

function isAnsweredByTipo(tipo, val) {
  const t = String(tipo || "").toLowerCase();
  switch (t) {
    case "multiselect":
      return Array.isArray(val) && val.length > 0;
    case "si_no":
      return val === true || val === false;
    case "semaforo":
      return typeof val === "string" && val.trim() !== "";
    default:
      if (isCoordsTipo(t)) {
        const arr = normalizeCoordsValue(val);
        return Array.isArray(arr) && arr.length >= 2 && arr[0] != null && arr[1] != null;
      }
      return !(val == null || String(val).trim() === "");
  }
}

function normalizeForCompare(tipo, v) {
  const t = String(tipo || "").toLowerCase();

  if (t === "si_no") {
    if (v === "SI") return true;
    if (v === "NO") return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true") return true;
      if (s === "false") return false;
    }
    return v;
  }

  if (t === "numero") {
    if (v == null || v === "") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }

  if (t === "multiselect") {
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : normalizeMultiFromText(v);
  }

  return v;
}

function hasValueByTipo(tipo, actualRaw) {
  const t = String(tipo || "").toLowerCase();
  if (t === "multiselect") return Array.isArray(actualRaw) && actualRaw.length > 0;

  if (isCoordsTipo(t)) {
    const arr = normalizeCoordsValue(actualRaw);
    return Array.isArray(arr) && arr.length >= 2 && arr[0] != null && arr[1] != null;
  }

  if (t === "si_no") return actualRaw === true || actualRaw === false || actualRaw === "SI" || actualRaw === "NO";
  if (t === "semaforo") return typeof actualRaw === "string" && actualRaw.trim() !== "";
  return !(actualRaw == null || String(actualRaw).trim() === "");
}

function evalCond(condAny, respuestas, preguntasById) {
  if (!condAny) return true;

  const cond = parseCondMaybe(condAny) || (typeof condAny === "object" ? condAny : null);
  if (!cond || typeof cond !== "object") return true;

  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCond(c, respuestas, preguntasById));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCond(c, respuestas, preguntasById));

  const id = Number(cond.id_pregunta);
  const op = String(cond.op || "eq").toLowerCase();
  const expectedRaw = cond.value;

  if (!id || !op) return true;

  const parent = preguntasById?.get?.(id) || null;
  const parentTipo = parent?.tipo;

  const actualRaw = respuestas?.[id];

  const actual = normalizeForCompare(parentTipo, actualRaw);
  const expected = normalizeForCompare(parentTipo, expectedRaw);

  if (op === "has_value" || op === "truthy") return hasValueByTipo(parentTipo, actualRaw);
  if (op === "empty" || op === "falsy") return !hasValueByTipo(parentTipo, actualRaw);

  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;

  if (op === "in") {
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) return expected.some((x) => actual.includes(x));
      return actual.includes(expected);
    }
    if (Array.isArray(expected)) return expected.includes(actual);
    return false;
  }

  if (op === "not_in") {
    if (Array.isArray(actual)) {
      if (Array.isArray(expected)) return !expected.some((x) => actual.includes(x));
      return !actual.includes(expected);
    }
    if (Array.isArray(expected)) return !expected.includes(actual);
    return true;
  }

  return true;
}

/* ------------------------ Opciones (select/multi/semaforo) ------------------------ */
function normalizeSelectOptions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((o) => {
      if (typeof o === "string") {
        const s = o.trim();
        if (!s) return null;
        return { value: s, label: s };
      }
      if (o && typeof o === "object") {
        const value = String(o.value ?? o.id ?? "").trim();
        const label = String(o.label ?? o.text ?? value).trim();
        if (!value) return null;
        return { value, label: label || value };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeSemaforoOptions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((o) => {
      if (typeof o === "string") {
        const s = o.trim();
        if (!s) return null;
        return { value: s, label: s, color: "#e9ecef" };
      }
      if (o && typeof o === "object") {
        const value = String(o.value ?? "").trim();
        const label = String(o.label ?? o.text ?? value).trim();
        const color = String(o.color ?? o.hex ?? "").trim();
        if (!value) return null;
        return { value, label: label || value, color: color || "#e9ecef" };
      }
      return null;
    })
    .filter(Boolean);
}

/* ------------------------ Mini preview de fotos con revokeObjectURL ------------------------ */
function PhotoPreview({ file, alt = "img", size = 80 }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    };
  }, [file]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: size,
        height: size,
        objectFit: "cover",
        borderRadius: 6,
        border: "1px solid #ddd",
      }}
    />
  );
}

/* ------------------------ Page ------------------------ */
export default function PublicInforme() {
  const { token } = useParams();

  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const [respuestas, setRespuestas] = useState({});
  const [fotosPorPregunta, setFotosPorPregunta] = useState({});
  const [enviando, setEnviando] = useState(false);

  const [pendientes, setPendientes] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  const secciones = useMemo(() => data?.secciones || [], [data]);

  const allPreguntas = useMemo(() => {
    const list = [];
    (secciones || []).forEach((sec) => (sec.preguntas || []).forEach((p) => list.push(p)));
    return list;
  }, [secciones]);

  const preguntasById = useMemo(() => {
    const m = new Map();
    allPreguntas.forEach((p) => m.set(Number(p.id_pregunta), p));
    return m;
  }, [allPreguntas]);

  const buildInitialRespuestas = (secs) => {
    const inicial = {};
    (secs || []).forEach((sec) => {
      (sec.preguntas || []).forEach((p) => {
        const id = Number(p.id_pregunta);
        if (!(id in inicial)) {
          const t = String(p.tipo || "").toLowerCase();
          if (t === "multiselect") inicial[id] = [];
          else if (isCoordsTipo(t)) inicial[id] = null;
          else if (t === "si_no") inicial[id] = null;
          else if (t === "semaforo") inicial[id] = "";
          else inicial[id] = "";
        }
      });
    });
    return inicial;
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetchJSON(`${API_URL}/informes-public/${token}`);
        setData(r);
        cacheSet(token, r);

        setRespuestas(buildInitialRespuestas(r.secciones || []));
        setFotosPorPregunta({});
        const c = await idbCountByToken(token);
        setPendientes(c);
      } catch (e) {
        console.warn("Fallo fetch, intento cache local:", e?.message || e);
        const cached = cacheGet(token);
        if (cached) {
          setData(cached);
          setRespuestas(buildInitialRespuestas(cached.secciones || []));
          setFotosPorPregunta({});
          const c = await idbCountByToken(token);
          setPendientes(c);
          Toast.fire({ icon: "info", title: "Sin internet: usando formulario guardado en el dispositivo." });
        } else {
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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

  const parseOpciones = (pregunta) => {
    const raw = pregunta?.opciones_json;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.options)) return parsed.options;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    if (raw && typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.options)) return raw.options;
    return [];
  };

  /* ========================= VISIBILIDAD ========================= */
  const isHiddenByHideIf = (p, resp) => {
    if (!p?.hide_if) return false;
    return evalCond(p.hide_if, resp, preguntasById) === true;
  };

  const isVisiblePregunta = (p, resp) => {
    const baseVisible = evalCond(p.visible_if, resp, preguntasById) === true;
    if (!baseVisible) return false;
    if (isHiddenByHideIf(p, resp)) return false;
    return true;
  };

  const isVisibleSeccion = (sec, resp) => {
    if (!sec?.visible_if) return true;
    return evalCond(sec.visible_if, resp, preguntasById);
  };

  const isRequiredNow = (p, resp) => {
    const base = !!p.obligatorio;
    const cond = p.required_if ? evalCond(p.required_if, resp, preguntasById) : false;
    return base || cond;
  };

  const seccionesVisibles = useMemo(() => {
    return (secciones || [])
      .map((sec) => {
        const secVisible = isVisibleSeccion(sec, respuestas);
        if (!secVisible) return null;

        const preguntas = (sec.preguntas || []).filter((p) => isVisiblePregunta(p, respuestas));
        if (!preguntas.length) return null;

        return { ...sec, preguntas };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secciones, respuestas, preguntasById]);

  /* ========================= Limpieza automática ========================= */
  useEffect(() => {
    if (!secciones?.length || !allPreguntas.length) return;

    let changed = false;
    const nextResp = { ...respuestas };
    const nextFotos = { ...fotosPorPregunta };

    // 1) limpiar por secciones ocultas
    for (const sec of secciones || []) {
      const secVisible = isVisibleSeccion(sec, respuestas);
      if (secVisible) continue;

      for (const p of sec.preguntas || []) {
        const idP = Number(p.id_pregunta);
        const t = String(p.tipo || "").toLowerCase();
        const emptyVal =
          t === "multiselect" ? [] :
          isCoordsTipo(t) ? null :
          t === "si_no" ? null :
          t === "semaforo" ? "" : "";

        const cur = nextResp[idP];
        const needClear =
          t === "multiselect"
            ? Array.isArray(cur) && cur.length > 0
            : isCoordsTipo(t)
              ? !!normalizeCoordsValue(cur)
              : t === "si_no"
                ? cur === true || cur === false
                : t === "semaforo"
                  ? typeof cur === "string" && cur.trim() !== ""
                  : !(cur == null || String(cur).trim() === "");

        if (needClear) {
          nextResp[idP] = emptyVal;
          changed = true;
        }

        if (nextFotos[idP] && nextFotos[idP].length) {
          delete nextFotos[idP];
          changed = true;
        }
      }
    }

    // 2) limpiar por preguntas ocultas
    for (const p of allPreguntas) {
      const idP = Number(p.id_pregunta);
      const vis = isVisiblePregunta(p, respuestas);
      if (vis) continue;

      const t = String(p.tipo || "").toLowerCase();
      const emptyVal =
        t === "multiselect" ? [] :
        isCoordsTipo(t) ? null :
        t === "si_no" ? null :
        t === "semaforo" ? "" : "";

      const cur = nextResp[idP];
      const needClear =
        t === "multiselect"
          ? Array.isArray(cur) && cur.length > 0
          : isCoordsTipo(t)
            ? !!normalizeCoordsValue(cur)
            : t === "si_no"
              ? cur === true || cur === false
              : t === "semaforo"
                ? typeof cur === "string" && cur.trim() !== ""
                : !(cur == null || String(cur).trim() === "");

      if (needClear) {
        nextResp[idP] = emptyVal;
        changed = true;
      }

      if (nextFotos[idP] && nextFotos[idP].length) {
        delete nextFotos[idP];
        changed = true;
      }
    }

    if (changed) {
      setRespuestas(nextResp);
      setFotosPorPregunta(nextFotos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respuestas, secciones?.length, allPreguntas.length]);

  /* ========================= Cambios de respuestas ========================= */
  const handleChangeRespuesta = (idPregunta, tipo, value) => {
    const id = Number(idPregunta);
    const t = String(tipo || "").toLowerCase();

    setRespuestas((prev) => {
      const nuevo = { ...prev };

      if (t === "multiselect") {
        nuevo[id] = Array.isArray(value) ? value.map((x) => String(x).trim()).filter(Boolean) : [];
      } else if (isCoordsTipo(t)) {
        // ✅ SIEMPRE guardamos coords como [lat,lng]
        if (value == null) {
          nuevo[id] = null;
        } else if (Array.isArray(value)) {
          nuevo[id] = value;
        } else if (typeof value === "object") {
          const lat = value.lat ?? value.latitude ?? null;
          const lng = value.lng ?? value.lon ?? value.longitude ?? null;
          nuevo[id] = lat != null && lng != null ? [lat, lng] : null;
        } else {
          nuevo[id] = null;
        }
      } else if (t === "si_no") {
        if (value === "SI") nuevo[id] = true;
        else if (value === "NO") nuevo[id] = false;
        else if (typeof value === "boolean") nuevo[id] = value;
        else nuevo[id] = null;
      } else if (t === "semaforo") {
        nuevo[id] = typeof value === "string" ? value : String(value ?? "");
      } else {
        nuevo[id] = value;
      }

      return nuevo;
    });
  };

  const handleFotosPreguntaChange = (idPregunta, e) => {
    const id = Number(idPregunta);
    let files = Array.from(e.target.files || []);
    if (files.length > MAX_FOTOS_POR_PREGUNTA) {
      Toast.fire({ icon: "warning", title: `Solo hasta ${MAX_FOTOS_POR_PREGUNTA} fotos por pregunta.` });
      files = files.slice(0, MAX_FOTOS_POR_PREGUNTA);
    }
    setFotosPorPregunta((prev) => ({ ...prev, [id]: files }));
  };

  const validarObligatorios = () => {
    const faltantes = [];

    (secciones || []).forEach((sec) => {
      if (!isVisibleSeccion(sec, respuestas)) return;

      (sec.preguntas || []).forEach((p) => {
        if (!isVisiblePregunta(p, respuestas)) return;

        const requiredNow = isRequiredNow(p, respuestas);
        if (!requiredNow) return;

        if (String(p.tipo || "").toLowerCase() === "imagen") {
          const fotos = fotosPorPregunta?.[Number(p.id_pregunta)] || [];
          if (fotos.length === 0) faltantes.push(p.etiqueta);
          return;
        }

        const val = respuestas[Number(p.id_pregunta)];
        if (!isAnsweredByTipo(p.tipo, val)) faltantes.push(p.etiqueta);
      });
    });

    return { ok: faltantes.length === 0, faltantes };
  };

  const resetFormUI = (formEl) => {
    setRespuestas(buildInitialRespuestas(secciones));
    setFotosPorPregunta({});
    if (formEl?.reset) formEl.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* ------------------------ Cola Offline (IndexedDB) ------------------------ */
  const enqueueLocalSubmit = async ({ titulo, respuestasObj, fotosObj, clientRequestId }) => {
    const count = await idbCountByToken(token);
    if (count >= MAX_PENDIENTES) {
      throw new Error(`Se alcanzó el máximo de formularios pendientes (${MAX_PENDIENTES}).`);
    }

    const idLocal = clientRequestId || buildClientRequestId();

    const fotos = [];
    for (const [idPreg, arr] of Object.entries(fotosObj || {})) {
      const filesArr = Array.isArray(arr) ? arr : [];
      for (const f of filesArr) {
        fotos.push({
          idPregunta: Number(idPreg),
          name: f?.name || `preg_${idPreg}.jpg`,
          type: f?.type || "image/jpeg",
          blob: f,
        });
      }
    }

    const payload = {
      idLocal,
      client_request_id: idLocal,
      token,
      createdAt: new Date().toISOString(),
      titulo: titulo || "",
      respuestas: respuestasObj || {},
      fotos,
    };

    await idbAdd(payload);
    const c = await idbCountByToken(token);
    setPendientes(c);
    return payload;
  };

  const sendQueuedItem = async (item) => {
    const hasPhotos = Array.isArray(item?.fotos) && item.fotos.length > 0;
    const clientRequestId = item?.client_request_id || item?.idLocal || buildClientRequestId();

    if (!hasPhotos) {
      await fetchJSON(`${API_URL}/informes-public/${token}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: item.titulo || null,
          respuestas: item.respuestas || {},
          client_request_id: clientRequestId,
        }),
      });
      return;
    }

    const formData = new FormData();
    formData.append("titulo", item.titulo || "");
    formData.append("respuestas", JSON.stringify(item.respuestas || {}));
    formData.append("client_request_id", clientRequestId);

    for (const f of item.fotos) {
      const file = new File([f.blob], f.name || "foto.jpg", { type: f.type || "image/jpeg" });
      formData.append(`fotos_${f.idPregunta}`, file);
    }

    await fetchJSON(`${API_URL}/informes-public/${token}/enviar`, {
      method: "POST",
      body: formData,
    });
  };

  const syncQueue = async () => {
    if (!navigator.onLine) return;

    const q = await idbListByToken(token);
    if (!q.length) {
      setPendientes(0);
      return;
    }

    for (const item of q) {
      try {
        await sendQueuedItem(item);
        await idbDelete(item.idLocal);
        const c = await idbCountByToken(token);
        setPendientes(c);
      } catch (e) {
        console.warn("Sync queue error:", e?.message || e);

        // ✅ si es 400/422, ese envío no va a funcionar -> descartarlo
        if (e?.status === 400 || e?.status === 422) {
          await idbDelete(item.idLocal);
          const c = await idbCountByToken(token);
          setPendientes(c);

          Toast.fire({
            icon: "error",
            title: "Se descartó un envío pendiente (datos inválidos). Reintentá completando el formulario.",
          });

          continue;
        }

        // otros errores: parar (se reintentará luego)
        break;
      }
    }

    const cFinal = await idbCountByToken(token);
    if (cFinal === 0) {
      Toast.fire({ icon: "success", title: "Se sincronizaron envíos pendientes." });
    }
  };

  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => {
      syncQueue().catch(() => {});
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /* ------------------------ Submit ------------------------ */
  const handleSubmit = async (e) => {
    e.preventDefault();

    const { ok, faltantes } = validarObligatorios();
    if (!ok) {
      const htmlLista =
        '<ul style="text-align:left; margin:0; padding-left:1.2rem;">' +
        faltantes.map((f) => `<li>${f}</li>`).join("") +
        "</ul>";

      await Swal.fire({
        icon: "warning",
        title: "Faltan completar campos obligatorios",
        html: htmlLista,
        confirmButtonText: "Entendido",
      });
      return;
    }

    const tituloEnvio = data?.share?.titulo || data?.plantilla?.nombre || null;
    const clientRequestId = buildClientRequestId();

    // ✅ SOLO respuestas visibles
    const respuestasObj = {};

    for (const sec of secciones || []) {
      if (!isVisibleSeccion(sec, respuestas)) continue;

      for (const p of sec.preguntas || []) {
        const id = Number(p.id_pregunta);
        if (!isVisiblePregunta(p, respuestas)) continue;

        const t = String(p.tipo || "").toLowerCase();
        const raw = respuestas[id];

        if (t === "multiselect") {
          respuestasObj[id] = Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
          continue;
        }

        if (t === "si_no") {
          if (raw === true || raw === false) respuestasObj[id] = raw;
          else if (raw === "SI") respuestasObj[id] = true;
          else if (raw === "NO") respuestasObj[id] = false;
          else respuestasObj[id] = null;
          continue;
        }

        // ✅ COORDENADAS: SIEMPRE [lat,lng] numérico
        if (isCoordsTipo(t)) {
          const arr = normalizeCoordsValue(raw);
          if (Array.isArray(arr) && arr.length >= 2) {
            const lat = Number(String(arr[0]).trim().replace(",", "."));
            const lng = Number(String(arr[1]).trim().replace(",", "."));
            respuestasObj[id] = Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
          } else {
            respuestasObj[id] = null;
          }
          continue;
        }

        if (t === "semaforo") {
          // ✅ mandamos el VALUE elegido (backend lo mapea a {nombre,hex} con opciones_json)
          respuestasObj[id] = typeof raw === "string" ? raw : String(raw ?? "");
          continue;
        }

        respuestasObj[id] = raw ?? "";
      }
    }

    // ✅ fotos visibles
    const fotosObj = {};
    Object.entries(fotosPorPregunta || {}).forEach(([idP, arr]) => {
      const p = preguntasById.get(Number(idP));
      if (!p) return;

      const sec = (secciones || []).find((s) =>
        (s.preguntas || []).some((x) => Number(x.id_pregunta) === Number(idP))
      );

      if (sec && !isVisibleSeccion(sec, respuestas)) return;
      if (!isVisiblePregunta(p, respuestas)) return;
      if ((arr || []).length) fotosObj[idP] = arr;
    });

    const hasPhotos = Object.values(fotosObj).some((arr) => (arr || []).length > 0);

    try {
      setEnviando(true);

      if (!navigator.onLine) {
        await enqueueLocalSubmit({ titulo: tituloEnvio, respuestasObj, fotosObj, clientRequestId });
        Toast.fire({ icon: "info", title: "Sin internet: guardado localmente. Se enviará al recuperar conexión." });
        resetFormUI(e.target);
        return;
      }

      if (!hasPhotos) {
        await fetchJSON(`${API_URL}/informes-public/${token}/enviar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titulo: tituloEnvio, respuestas: respuestasObj, client_request_id: clientRequestId }),
        });

        Toast.fire({ icon: "success", title: "Formulario enviado correctamente" });
        resetFormUI(e.target);
        return;
      }

      const formData = new FormData();
      formData.append("titulo", tituloEnvio || "");
      // ✅ backend espera req.body.respuestas (string JSON) o objeto
      formData.append("respuestas", JSON.stringify(respuestasObj));
      formData.append("client_request_id", clientRequestId);

      Object.entries(fotosObj).forEach(([idPreg, archivos]) => {
        (archivos || []).forEach((file) => {
          formData.append(`fotos_${idPreg}`, file);
        });
      });

      await fetchJSON(`${API_URL}/informes-public/${token}/enviar`, {
        method: "POST",
        body: formData,
      });

      Toast.fire({ icon: "success", title: "Formulario enviado correctamente" });
      resetFormUI(e.target);
    } catch (e2) {
      console.error("❌ Submit error:", e2);

      // ✅ 400/422: inválido -> NO guardar offline, no resetear
      if (e2?.status === 400 || e2?.status === 422) {
        const detalles = e2?.data?.detalles || [];
        const msg = e2?.data?.error || e2?.message || "Datos inválidos";

        const htmlLista =
          Array.isArray(detalles) && detalles.length
            ? '<div style="text-align:left">' +
              "<p style='margin:0 0 .5rem 0'><b>Faltan obligatorios:</b></p>" +
              "<ul style='margin:0; padding-left:1.2rem'>" +
              detalles
                .map((d) => `<li>${d?.etiqueta || `Pregunta ${d?.id_pregunta}`}</li>`)
                .join("") +
              "</ul></div>"
            : `<div style="text-align:left">${msg}</div>`;

        await Swal.fire({
          icon: "warning",
          title: "No se pudo enviar",
          html: htmlLista,
          confirmButtonText: "Entendido",
        });

        return;
      }

      // ✅ otros errores (red/500): guardar offline para no perder
      try {
        await enqueueLocalSubmit({ titulo: tituloEnvio, respuestasObj, fotosObj, clientRequestId });
        Toast.fire({
          icon: "info",
          title: "No se pudo enviar: guardado localmente. Se enviará cuando vuelva la conexión.",
        });
        resetFormUI(e.target);
      } catch (e3) {
        await Swal.fire({
          icon: "error",
          title: "No se pudo guardar offline",
          text: e3?.message || "Error guardando en el dispositivo",
        });
      }
    } finally {
      setEnviando(false);
    }
  };

  if (loading) return <div className="container my-4">Cargando…</div>;
  if (!data?.ok) return <div className="container my-4">Link inválido / expirado / cerrado.</div>;

  const titulo = data?.share?.titulo || data?.plantilla?.nombre || "Formulario";
  const idProyecto = data?.share?.id_proyecto;

  return (
    <div className="public-scroll">
      <div
        className="container my-4"
        style={{
          maxWidth: 980,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        }}
      >
        <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
          <div>
            <h3 className="mb-1">{titulo}</h3>
            <div className="text-muted">
              {idProyecto ? (
                <>
                  Proyecto: <b>{idProyecto}</b>
                </>
              ) : (
                "Sin proyecto asignado"
              )}
            </div>
            <div className="small text-muted">
              Límite offline: <b>{MAX_PENDIENTES}</b> pendientes
            </div>
          </div>

          <div className="text-end">
            <div className={`badge ${online ? "bg-success" : "bg-secondary"} mb-1`}>
              {online ? "Online" : "Offline"}
            </div>
            <div className="small text-muted">
              Pendientes: <b>{pendientes}</b>
            </div>

            {online && pendientes > 0 ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary mt-2"
                onClick={() => syncQueue().catch(() => {})}
              >
                Sincronizar ahora
              </button>
            ) : null}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {(seccionesVisibles || []).map((sec) => (
            <div key={sec.id_seccion} className="card mb-3">
              <div className="card-header">
                <b>{sec.titulo}</b>
              </div>

              <div className="card-body">
                {(sec.preguntas || []).map((p) => {
                  const idP = Number(p.id_pregunta);
                  const visible = isVisiblePregunta(p, respuestas);
                  if (!visible) return null;

                  const val = respuestas[idP];
                  const opcRaw = parseOpciones(p);
                  const requiredNow = isRequiredNow(p, respuestas);

                  const fotosCount = (fotosPorPregunta?.[idP] || []).length;
                  const answered =
                    String(p.tipo || "").toLowerCase() === "imagen"
                      ? fotosCount > 0
                      : isAnsweredByTipo(p.tipo, val);

                  const iconReq =
                    requiredNow && !answered ? (
                      <span title="Obligatorio incompleto" className="ms-2">
                        🔴
                      </span>
                    ) : null;
                  const iconOk = answered ? (
                    <span title="Completado" className="ms-1">
                      🟢
                    </span>
                  ) : null;
                  const iconFoto =
                    fotosCount > 0 ? (
                      <span title={`Fotos cargadas: ${fotosCount}`} className="ms-1">
                        📷
                      </span>
                    ) : null;

                  const tipo = String(p.tipo || "").toLowerCase();

                  return (
                    <div key={idP} className="mb-3">
                      <label className="form-label d-flex align-items-center gap-1">
                        <span>
                          {p.etiqueta}{" "}
                          {requiredNow ? <span className="text-danger">*</span> : null}
                        </span>
                        <span className="ms-auto">
                          {iconReq}
                          {iconOk}
                          {iconFoto}
                        </span>
                      </label>

                      {tipo === "imagen" ? (
                        <div className="mt-2">
                          <div className="small text-muted mb-1">
                            Imagen(es) (máx {MAX_FOTOS_POR_PREGUNTA})
                          </div>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            multiple
                            onChange={(e) => handleFotosPreguntaChange(idP, e)}
                          />
                          {(fotosPorPregunta?.[idP] || []).length > 0 ? (
                            <div className="mt-2 d-flex flex-wrap gap-2">
                              {fotosPorPregunta[idP].map((file, idx) => (
                                <PhotoPreview
                                  key={`${idP}-${idx}`}
                                  file={file}
                                  alt={`img-${idP}-${idx}`}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {tipo === "texto" ? (
                        <input
                          className="form-control"
                          value={val ?? ""}
                          onChange={(e) => handleChangeRespuesta(idP, p.tipo, e.target.value)}
                        />
                      ) : null}

                      {tipo === "numero" ? (
                        <input
                          type="number"
                          className="form-control"
                          value={val ?? ""}
                          onChange={(e) => handleChangeRespuesta(idP, p.tipo, e.target.value)}
                        />
                      ) : null}

                      {tipo === "fecha" ? (
                        <input
                          type="date"
                          className="form-control"
                          value={val ?? ""}
                          onChange={(e) => handleChangeRespuesta(idP, p.tipo, e.target.value)}
                        />
                      ) : null}

                      {tipo === "si_no" ? (
                        <div className="d-flex gap-3">
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`si_no_${idP}`}
                              checked={val === true}
                              onChange={() => handleChangeRespuesta(idP, p.tipo, true)}
                            />
                            <label className="form-check-label">Sí</label>
                          </div>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="radio"
                              name={`si_no_${idP}`}
                              checked={val === false}
                              onChange={() => handleChangeRespuesta(idP, p.tipo, false)}
                            />
                            <label className="form-check-label">No</label>
                          </div>
                        </div>
                      ) : null}

                      {tipo === "select" ? (
                        (() => {
                          const opts = normalizeSelectOptions(opcRaw);
                          return (
                            <select
                              className="form-select"
                              value={val ?? ""}
                              onChange={(e) => handleChangeRespuesta(idP, p.tipo, e.target.value)}
                            >
                              <option value="">— Seleccionar —</option>
                              {opts.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          );
                        })()
                      ) : null}

                      {tipo === "semaforo" ? (
                        (() => {
                          const opts = normalizeSemaforoOptions(opcRaw);
                          const selected = typeof val === "string" ? val : "";
                          const selectedOpt = opts.find((o) => o.value === selected) || null;
                          const selectedColor = selectedOpt?.color || "";

                          return (
                            <div>
                              <div className="d-flex flex-wrap gap-2">
                                {opts.map((o) => {
                                  const active = selected === o.value;
                                  return (
                                    <button
                                      key={o.value}
                                      type="button"
                                      className={`btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`}
                                      onClick={() => handleChangeRespuesta(idP, "semaforo", o.value)}
                                      style={{
                                        borderColor: o.color || undefined,
                                        boxShadow: active ? "inset 0 0 0 2px rgba(255,255,255,.6)" : undefined,
                                      }}
                                      title={`${o.label} (${o.value})`}
                                    >
                                      <span
                                        className="me-2 align-middle d-inline-block border rounded"
                                        style={{ width: 14, height: 14, background: o.color || "#e9ecef" }}
                                      />
                                      {o.label}
                                    </button>
                                  );
                                })}

                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => handleChangeRespuesta(idP, "semaforo", "")}
                                  disabled={!selected}
                                  title="Quitar selección"
                                >
                                  Limpiar
                                </button>
                              </div>

                              <div className="mt-2 d-flex align-items-center gap-2 small text-muted">
                                <span>Seleccionado:</span>
                                <strong>{selectedOpt?.label || (selected ? selected : "—")}</strong>
                                <span className="ms-2">Valor:</span>
                                <code>{selected || "—"}</code>
                                <span
                                  className="ms-2 border rounded"
                                  title={selectedColor || "Sin color"}
                                  style={{ width: 18, height: 18, background: selectedColor || "#e9ecef" }}
                                />
                              </div>
                            </div>
                          );
                        })()
                      ) : null}

                      {tipo === "multiselect" ? (
                        <div className="d-flex flex-wrap gap-2">
                          {normalizeSelectOptions(opcRaw).map((o) => {
                            const arr = Array.isArray(val) ? val : [];
                            const checked = arr.includes(o.value);
                            return (
                              <label key={o.value} className="form-check form-check-inline">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(arr);
                                    if (e.target.checked) next.add(o.value);
                                    else next.delete(o.value);
                                    handleChangeRespuesta(idP, p.tipo, Array.from(next));
                                  }}
                                />
                                <span className="form-check-label">{o.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}

                      {/* ✅ Coordenadas: SIEMPRE se guardan como [lat,lng] */}
                      {isCoordsTipo(p.tipo) ? (
                        online ? (
                          <GoogleMapaCoordenadas
                            value={Array.isArray(val) ? val : normalizeCoordsValue(val)}
                            onChange={(coordsArr) => handleChangeRespuesta(idP, "coordenadas", coordsArr)}
                            height={260}
                          />
                        ) : (
                          <div className="border rounded p-2 bg-light">
                            <div className="small text-muted mb-2">
                              Sin internet: ingresá coordenadas manualmente
                            </div>
                            <div className="row g-2">
                              <div className="col">
                                <input
                                  className="form-control"
                                  placeholder="Latitud"
                                  value={Array.isArray(val) ? (val[0] ?? "") : ""}
                                  onChange={(e) => {
                                    const lat = e.target.value;
                                    const lng = Array.isArray(val) ? val[1] : "";
                                    handleChangeRespuesta(idP, "coordenadas", [lat, lng]);
                                  }}
                                />
                              </div>
                              <div className="col">
                                <input
                                  className="form-control"
                                  placeholder="Longitud"
                                  value={Array.isArray(val) ? (val[1] ?? "") : ""}
                                  onChange={(e) => {
                                    const lng = e.target.value;
                                    const lat = Array.isArray(val) ? val[0] : "";
                                    handleChangeRespuesta(idP, "coordenadas", [lat, lng]);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )
                      ) : null}

                      {p.permite_foto && tipo !== "imagen" ? (
                        <div className="mt-2">
                          <div className="small text-muted mb-1">
                            Fotos (máx {MAX_FOTOS_POR_PREGUNTA})
                          </div>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            multiple
                            onChange={(e) => handleFotosPreguntaChange(idP, e)}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="d-flex justify-content-end">
            <button className="btn btn-primary" type="submit" disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
