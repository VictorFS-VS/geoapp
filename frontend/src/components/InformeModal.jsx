// src/components/InformeModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, Row, Col, Form, Spinner, Alert, Badge } from "react-bootstrap";
import Swal from "sweetalert2";

import GoogleMapaCoordenadas from "./GoogleMapaCoordenadas";
import ScoringResultPanel from "@/modules/diagnostico/ScoringResultPanel";

const ENV_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const HOST_BASE = ENV_BASE.replace(/\/api\/?$/i, "");
const API_URL = HOST_BASE.endsWith("/api") ? HOST_BASE : HOST_BASE + "/api";

const DEFAULT_SEMAFORO = [
  { value: "verde", label: "Verde", color: "#2ECC71" },
  { value: "amarillo", label: "Amarillo", color: "#F1C40F" },
  { value: "rojo", label: "Rojo", color: "#E74C3C" },
];

/* =========================
   Helpers generales
========================= */
function authHeaders(extra = {}) {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const txt = await res.text().catch(() => "");
  let data = {};
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { raw: txt };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || data?.raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function getTopModalEl() {
  return document.querySelector(".modal.show") || document.body;
}

async function swalFire(opts) {
  const target = getTopModalEl();
  return Swal.fire({
    target,
    ...opts,
    didOpen: () => {
      const c = Swal.getContainer();
      const b = document.querySelector(".swal2-backdrop-show");
      if (c) c.style.zIndex = "20000";
      if (b) b.style.zIndex = "19999";
      opts?.didOpen?.();
    },
  });
}

function isAnsweredByTipo(tipoRaw, val) {
  const tipo = String(tipoRaw || "").toLowerCase();

  switch (tipo) {
    case "si_no":
      return val === true || val === false;

    case "multiselect":
      return Array.isArray(val) && val.length > 0;

    case "coordenadas":
    case "coordenada":
    case "coords":
      return (
        val &&
        typeof val === "object" &&
        val.lat != null &&
        val.lng != null &&
        String(val.lat) !== "" &&
        String(val.lng) !== ""
      );

    case "semaforo":
      return typeof val === "string" && val.trim() !== "";

    default:
      if (val === null || val === undefined) return false;
      return String(val).trim() !== "";
  }
}

/* =========================
   Condiciones / visibilidad
========================= */
function parseCondMaybe(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      return j && typeof j === "object" ? j : null;
    } catch {
      return null;
    }
  }
  return null;
}

function evalCond(cond, respuestas) {
  if (!cond) return true;

  if (typeof cond === "string") {
    const parsed = parseCondMaybe(cond);
    if (!parsed) return true;
    return evalCond(parsed, respuestas);
  }

  if (cond.all && Array.isArray(cond.all)) return cond.all.every((c) => evalCond(c, respuestas));
  if (cond.any && Array.isArray(cond.any)) return cond.any.some((c) => evalCond(c, respuestas));

  const id = Number(cond.id_pregunta);
  const op = String(cond.op || "eq").toLowerCase();
  const v = cond.value;
  const r = respuestas?.[id];

  const hasValue = (() => {
    if (r === null || r === undefined) return false;
    if (Array.isArray(r)) return r.length > 0;
    if (typeof r === "object") {
      if ("lat" in r || "lng" in r) {
        return r.lat != null && r.lng != null && String(r.lat) !== "" && String(r.lng) !== "";
      }
      return Object.keys(r).length > 0;
    }
    return String(r).trim() !== "";
  })();

  const norm = (x) => {
    if (x === true || x === false) return x;
    if (x === null || x === undefined) return x;
    if (Array.isArray(x)) return x.map(norm);
    const s = String(x).trim();
    if (s.toLowerCase() === "si") return true;
    if (s.toLowerCase() === "no") return false;
    const n = Number(s);
    if (!Number.isNaN(n) && s !== "") return n;
    return s;
  };

  const rn = norm(r);
  const vn = norm(v);

  switch (op) {
    case "has_value":
      return hasValue;
    case "empty":
      return !hasValue;
    case "eq":
      return rn === vn;
    case "neq":
      return rn !== vn;
    case "in":
      return Array.isArray(vn) ? vn.includes(rn) : false;
    case "not_in":
      return Array.isArray(vn) ? !vn.includes(rn) : true;
    case "truthy":
      return Boolean(rn) === true;
    case "falsy":
      return Boolean(rn) === false;
    default:
      return true;
  }
}

function isVisible(p, respuestas) {
  const c = parseCondMaybe(p?.visible_if) ?? p?.visible_if ?? null;
  if (!c) return true;
  return evalCond(c, respuestas);
}

function isRequiredNow(p, respuestas) {
  const base = !!p?.obligatorio;
  const c = parseCondMaybe(p?.required_if) ?? p?.required_if ?? null;
  const cond = c ? evalCond(c, respuestas) : false;
  return base || cond;
}

/* =========================
   Fotos / archivos
========================= */
function groupFotosByPregunta(fotos = []) {
  const m = {};
  for (const f of fotos || []) {
    const id = Number(f.id_pregunta);
    if (!m[id]) m[id] = [];
    m[id].push(f);
  }
  Object.values(m).forEach((arr) => arr.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
  return m;
}

function fotoUrl(ruta_archivo) {
  if (!ruta_archivo) return "";
  const s = String(ruta_archivo).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  const clean = s.replace(/^\/+/, "");
  if (clean.startsWith("api/uploads/")) return `${HOST_BASE}/${clean}`;
  if (clean.startsWith("uploads/")) return `${HOST_BASE}/${clean}`;

  return `${HOST_BASE}/uploads/${clean}`;
}

function splitImageLinksText(value) {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }

  const s = String(value || "").trim();
  if (!s) return [];

  return s
    .split(/\r?\n|[,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeImageLinksText(value) {
  return splitImageLinksText(value).join("\n");
}

function isExternalUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

/* =========================
   Opciones / formatos
========================= */
function parseOpciones(opciones_json) {
  if (!opciones_json) return [];
  if (Array.isArray(opciones_json)) return opciones_json;
  try {
    const j = typeof opciones_json === "string" ? JSON.parse(opciones_json) : opciones_json;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function fmtDate(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString("es-PY");
  } catch {
    return String(v);
  }
}

/* =========================
   Coordenadas
========================= */
function isValidCoordPair(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  const la = Number(String(lat).trim().replace(",", "."));
  const ln = Number(String(lng).trim().replace(",", "."));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la < -90 || la > 90) return false;
  if (ln < -180 || ln > 180) return false;
  return true;
}

function normalizeCoordObj(v) {
  if (!v || typeof v !== "object") return null;
  const lat = v.lat ?? v.latitude ?? null;
  const lng = v.lng ?? v.lon ?? v.longitude ?? null;
  if (!isValidCoordPair(lat, lng)) return null;
  return {
    lat: Number(String(lat).trim().replace(",", ".")),
    lng: Number(String(lng).trim().replace(",", ".")),
  };
}

/* =========================
   Multiselect
========================= */
function normalizeMultiFromText(val) {
  if (Array.isArray(val)) return val.filter((x) => String(x).trim() !== "");
  if (val === null || val === undefined) return [];
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j)) return j.filter((x) => String(x).trim() !== "");
      } catch {}
    }
    return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/* =========================
   Semáforo
========================= */
function normalizeSemaforoOptions(rawOpciones) {
  const arr = parseOpciones(rawOpciones);

  if (!arr || !arr.length) {
    return DEFAULT_SEMAFORO.map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    }));
  }

  if (typeof arr[0] === "string") {
    return arr
      .map((s) => {
        const label = String(s).trim();
        if (!label) return null;
        const value = label.toLowerCase().replace(/\s+/g, "_");
        const l = value;
        const color =
          l.includes("verde")
            ? "#2ECC71"
            : l.includes("amar")
              ? "#F1C40F"
              : l.includes("rojo")
                ? "#E74C3C"
                : "#e9ecef";
        return { value, label, color };
      })
      .filter(Boolean);
  }

  return arr
    .map((o) => {
      if (!o || typeof o !== "object") return null;

      const value = String(o.value ?? "").trim();
      const label = String(o.label ?? o.text ?? value).trim();
      const color = String(o.color ?? o.hex ?? "").trim();

      if (!value) return null;

      return {
        value,
        label: label || value,
        color: color || "#e9ecef",
      };
    })
    .filter(Boolean);
}

function normalizeSemaforoAnswer(valueFromDb, opciones_json) {
  const opts = normalizeSemaforoOptions(opciones_json);

  if (valueFromDb == null) return "";

  if (typeof valueFromDb === "string") {
    const s = valueFromDb.trim();
    if (!s) return "";

    const byValue = opts.find((o) => String(o.value).toLowerCase() === s.toLowerCase());
    if (byValue) return byValue.value;

    const byLabel = opts.find((o) => String(o.label).toLowerCase() === s.toLowerCase());
    if (byLabel) return byLabel.value;

    return s;
  }

  if (typeof valueFromDb === "object" && !Array.isArray(valueFromDb)) {
    const nombre = String(valueFromDb.nombre || valueFromDb.label || "").trim();
    const hex = String(valueFromDb.hex || valueFromDb.color || "").trim();

    if (hex) {
      const byHex = opts.find((o) => String(o.color).toLowerCase() === hex.toLowerCase());
      if (byHex) return byHex.value;
    }

    if (nombre) {
      const byLabel = opts.find((o) => String(o.label).toLowerCase() === nombre.toLowerCase());
      if (byLabel) return byLabel.value;
    }
  }

  return "";
}

/* =========================
   Component
========================= */
export default function InformeModal({
  show,
  onHide,
  idInforme = null,
  initialData = null,
  mode = "view",
  onSaved = null,
}) {
  const readOnly = mode === "view";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState(null);
  const [idRegistro, setIdRegistro] = useState(null);
  const [titulo, setTitulo] = useState("");

  const [respuestas, setRespuestas] = useState({});
  const [fotosActuales, setFotosActuales] = useState({});
  const [fotosNuevas, setFotosNuevas] = useState({});
  const [linksNuevos, setLinksNuevos] = useState({});
  const [fotosAEliminar, setFotosAEliminar] = useState([]);

  const [deletingFotoId, setDeletingFotoId] = useState(null);

  const fileInputRefs = useRef({});
  const originalRespuestasRef = useRef({});

  useEffect(() => {
    if (!show) return;

    const run = async () => {
      try {
        setLoading(true);

        const payload = (() => {
          if (!initialData) return null;
          return initialData?.ok ? initialData : { ok: true, ...initialData };
        })();

        const applyPayload = (p0) => {
          setData(p0);
          setTitulo(p0?.informe?.titulo || "");
          
          const regId = p0?.respuestas?.[0]?.id_registro || p0?.informe?.id_registro;
          if (regId) setIdRegistro(Number(regId));

          const preguntasById = new Map(
            (p0?.preguntas || []).map((p) => [Number(p.id_pregunta), p])
          );

          const mapResp = {};
          (p0?.respuestas || []).forEach((r) => {
            const idP = Number(r.id_pregunta);
            const p = preguntasById.get(idP);
            const tipo = String(p?.tipo || "").toLowerCase();

            if (r.valor_bool !== null && r.valor_bool !== undefined) {
              mapResp[idP] = r.valor_bool;
              return;
            }

            if (r.valor_json !== null && r.valor_json !== undefined) {
              try {
                const obj = typeof r.valor_json === "string" ? JSON.parse(r.valor_json) : r.valor_json;

                if (
                  Array.isArray(obj) &&
                  obj.length >= 2 &&
                  (tipo === "coordenadas" || tipo === "coordenada" || tipo === "coords")
                ) {
                  const lat = obj[0];
                  const lng = obj[1];
                  const norm = normalizeCoordObj({ lat, lng });
                  mapResp[idP] = norm ? norm : { lat, lng };
                  return;
                }

                if (tipo === "semaforo") {
                  mapResp[idP] = normalizeSemaforoAnswer(obj, p?.opciones_json);
                  return;
                }

                if (obj && typeof obj === "object") {
                  const norm = normalizeCoordObj(obj);
                  mapResp[idP] = norm ? norm : obj;
                  return;
                }

                if (tipo === "multiselect") {
                  mapResp[idP] = normalizeMultiFromText(obj);
                } else {
                  mapResp[idP] = obj;
                }
              } catch {
                if (tipo === "multiselect") {
                  mapResp[idP] = normalizeMultiFromText(r.valor_texto);
                } else if (tipo === "semaforo") {
                  mapResp[idP] = normalizeSemaforoAnswer(r.valor_texto, p?.opciones_json);
                } else {
                  mapResp[idP] = r.valor_texto ?? "";
                }
              }
              return;
            }

            if (tipo === "multiselect") {
              mapResp[idP] = normalizeMultiFromText(r.valor_texto);
              return;
            }

            if (tipo === "semaforo") {
              mapResp[idP] = normalizeSemaforoAnswer(r.valor_texto, p?.opciones_json);
              return;
            }

            mapResp[idP] = r.valor_texto ?? "";
          });

          setRespuestas(mapResp);
          originalRespuestasRef.current = { ...(mapResp || {}) };

          setFotosActuales(groupFotosByPregunta(p0?.fotos || []));
          setFotosNuevas({});
          setLinksNuevos({});
          setFotosAEliminar([]);
        };

        if (payload) {
          applyPayload(payload);
          return;
        }

        if (!idInforme) return;

        const r = await fetchJSON(`${API_URL}/informes/${idInforme}`, { headers: authHeaders() });
        const p = r?.ok ? r : { ok: true, ...r };
        applyPayload(p);
      } catch (e) {
        await swalFire({ icon: "error", title: "Error", text: e.message });
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [show, idInforme, initialData]);

  const secciones = useMemo(() => {
    if (!data) return [];
    const secs = data.secciones || [];
    const preguntas = data.preguntas || [];

    const alreadyNested = secs.length && Array.isArray(secs[0]?.preguntas);
    if (alreadyNested) return [...secs].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

    return secs
      .map((s) => ({
        ...s,
        preguntas: preguntas
          .filter((p) => Number(p.id_seccion) === Number(s.id_seccion))
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)),
      }))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  }, [data]);

  const setResp = (idPreg, value) => {
    setRespuestas((prev) => ({ ...prev, [Number(idPreg)]: value }));
  };

  const onPickFotos = (idPregunta, files) => {
    const arr = Array.from(files || []).filter(Boolean);
    setFotosNuevas((prev) => ({ ...prev, [Number(idPregunta)]: arr }));

    const ref = fileInputRefs.current?.[Number(idPregunta)];
    if (ref) ref.value = "";
  };

  const onChangeLinks = (idPregunta, text) => {
    setLinksNuevos((prev) => ({
      ...prev,
      [Number(idPregunta)]: normalizeImageLinksText(text),
    }));
  };

  const eliminarFoto = async (idFoto) => {
    if (!idInforme) {
      await swalFire({ icon: "warning", title: "Atención", text: "No hay idInforme." });
      return;
    }

    const confirm = await swalFire({
      icon: "warning",
      title: "Eliminar foto",
      text: "Se eliminará ahora mismo. ¿Continuar?",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    try {
      setDeletingFotoId(Number(idFoto));

      await fetchJSON(`${API_URL}/informes/${idInforme}/fotos/${idFoto}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      setFotosActuales((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = (next[k] || []).filter((f) => Number(f.id_foto || f.id) !== Number(idFoto));
        }
        return next;
      });

      setFotosAEliminar((prev) => prev.filter((x) => Number(x) !== Number(idFoto)));

      await swalFire({
        icon: "success",
        title: "Eliminada",
        text: "La foto fue eliminada correctamente.",
        timer: 900,
        showConfirmButton: false,
      });
    } catch (e) {
      await swalFire({ icon: "error", title: "Error al eliminar", text: e.message });
    } finally {
      setDeletingFotoId(null);
    }
  };

  const validarAntesDeGuardar = () => {
    const faltantes = [];
    const delSet = new Set((fotosAEliminar || []).map((x) => Number(x)).filter(Boolean));

    (secciones || []).forEach((sec) => {
      (sec.preguntas || []).forEach((p) => {
        if (!isVisible(p, respuestas)) return;

        const reqNow = isRequiredNow(p, respuestas);
        if (!reqNow) return;

        const idP = Number(p.id_pregunta);

        if (String(p.tipo || "").toLowerCase() === "imagen") {
          const actuales = (fotosActuales?.[idP] || []).filter((f) => {
            const fid = Number(f.id_foto || f.id);
            return !delSet.has(fid);
          });

          const nuevas = fotosNuevas?.[idP] || [];
          const links = splitImageLinksText(linksNuevos?.[idP]);

          if ((actuales.length || 0) + (nuevas.length || 0) + (links.length || 0) === 0) {
            faltantes.push(p.etiqueta);
          }
          return;
        }

        const val = respuestas?.[idP];
        if (!isAnsweredByTipo(p.tipo, val)) faltantes.push(p.etiqueta);
      });
    });

    return { ok: faltantes.length === 0, faltantes };
  };

  const handleGuardar = async () => {
    const { ok, faltantes } = validarAntesDeGuardar();

    if (!ok) {
      const htmlLista =
        '<ul style="text-align:left; margin:0; padding-left:1.2rem;">' +
        faltantes.map((f) => `<li>${f}</li>`).join("") +
        "</ul>";

      await swalFire({ icon: "warning", title: "Faltan obligatorios", html: htmlLista });
      return;
    }

    try {
      setSaving(true);

      const fd = new FormData();
      fd.append("titulo", titulo || "");

      const respuestasPayload = { ...(respuestas || {}) };
      const preguntasById = new Map((data?.preguntas || []).map((p) => [Number(p.id_pregunta), p]));

      Object.keys(respuestasPayload).forEach((k) => {
        const idP = Number(k);
        const p = preguntasById.get(idP);
        const tipo = String(p?.tipo || "").toLowerCase();
        const v = respuestasPayload[k];

        if (v && typeof v === "object" && !Array.isArray(v) && ("lat" in v || "lng" in v)) {
          const norm = normalizeCoordObj(v);
          if (!norm) {
            const original = originalRespuestasRef.current?.[Number(k)];
            const origNorm = normalizeCoordObj(original);
            if (origNorm) {
              respuestasPayload[k] = [origNorm.lat, origNorm.lng];
            } else {
              delete respuestasPayload[k];
            }
          } else {
            respuestasPayload[k] = [norm.lat, norm.lng];
          }
        }

        if (Array.isArray(respuestasPayload[k])) {
          respuestasPayload[k] = respuestasPayload[k].map((x) => String(x).trim()).filter(Boolean);
        }

        if (tipo === "semaforo") {
          respuestasPayload[k] = typeof v === "string" ? v : String(v ?? "");
        }
      });

      Object.entries(linksNuevos || {}).forEach(([idPreg, text]) => {
        const idP = Number(idPreg);
        if (!Number.isFinite(idP) || idP <= 0) return;

        const p = preguntasById.get(idP);
        const tipo = String(p?.tipo || "").toLowerCase();
        if (tipo !== "imagen") return;

        const links = splitImageLinksText(text);
        if (!links.length) return;

        respuestasPayload[idP] = links;
      });

      fd.append("respuestas", JSON.stringify(respuestasPayload));

      if ((fotosAEliminar || []).length > 0) {
        fd.append("delete_fotos_json", JSON.stringify(fotosAEliminar.map(Number)));
      }

      Object.entries(fotosNuevas || {}).forEach(([idPreg, arr]) => {
        (arr || []).forEach((file) => {
          if (!file) return;
          fd.append(`fotos_${idPreg}`, file);
        });
      });

      await fetchJSON(`${API_URL}/informes/${idInforme}`, {
        method: "PUT",
        headers: authHeaders(),
        body: fd,
      });

      await swalFire({
        icon: "success",
        title: "OK",
        text: "Informe actualizado",
        timer: 900,
        showConfirmButton: false,
      });

      onSaved?.();
      onHide?.();
    } catch (e) {
      await swalFire({ icon: "error", title: "Error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const renderSemaforo = (p) => {
    const id = Number(p.id_pregunta);
    const opts = normalizeSemaforoOptions(p.opciones_json);

    const current = typeof respuestas?.[id] === "string" ? respuestas[id] : "";

    return (
      <div>
        <div className="d-flex flex-wrap gap-2">
          {opts.map((o) => {
            const selected = current === o.value;

            return (
              <button
                key={`${o.value}_${o.color}`}
                type="button"
                disabled={readOnly}
                onClick={() => setResp(id, o.value)}
                style={{
                  border: selected ? "2px solid #111827" : "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "10px 12px",
                  minWidth: 140,
                  background: "#fff",
                  cursor: readOnly ? "not-allowed" : "pointer",
                }}
                title={`${o.label} (${o.value})`}
              >
                <div className="d-flex align-items-center gap-2">
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: o.color || "#64748b",
                      border: "1px solid rgba(0,0,0,.12)",
                      display: "inline-block",
                    }}
                  />
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{o.label}</div>
                </div>

                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {o.value || "\u00A0"}
                </div>

                <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {selected ? "Seleccionado" : "\u00A0"}
                </div>
              </button>
            );
          })}
        </div>

        {!readOnly && current ? (
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline-danger"
              onClick={() => setResp(id, "")}
            >
              Limpiar
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderControl = (p) => {
    const id = Number(p.id_pregunta);
    const tipo = String(p.tipo || "").toLowerCase();
    const val = respuestas?.[id];
    const requiredNow = isRequiredNow(p, respuestas);
    const opts = parseOpciones(p.opciones_json);

    const boxStyle = {
      border: "1px solid #e5e7eb",
      borderRadius: 8,
      padding: 10,
      background: "#fff",
      maxHeight: 240,
      overflowY: "auto",
    };

    const header = (
      <div className="fw-semibold">
        {p.etiqueta}{" "}
        <span className="text-muted" style={{ fontSize: 12 }}>
          ({tipo})
        </span>
        {requiredNow ? <span className="text-danger"> *</span> : null}
      </div>
    );

    const rightControl = (() => {
      switch (tipo) {
        case "semaforo":
          return renderSemaforo(p);

        case "texto":
          return (
            <Form.Control
              as="textarea"
              rows={2}
              value={val ?? ""}
              disabled={readOnly}
              onChange={(e) => setResp(id, e.target.value)}
            />
          );

        case "si_no":
          return (
            <div style={boxStyle}>
              {["SI", "NO"].map((o) => {
                const checked = (o === "SI" && val === true) || (o === "NO" && val === false);
                return (
                  <Form.Check
                    key={o}
                    type="radio"
                    name={`sino_${id}`}
                    label={o}
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => setResp(id, o === "SI")}
                    className="mb-1"
                  />
                );
              })}
            </div>
          );

        case "select":
          return (
            <div style={boxStyle}>
              {opts.map((o, idx) => (
                <Form.Check
                  key={idx}
                  type="radio"
                  name={`sel_${id}`}
                  label={o}
                  checked={val === o}
                  disabled={readOnly}
                  onChange={() => setResp(id, o)}
                  className="mb-1"
                />
              ))}
            </div>
          );

        case "multiselect": {
          const arr = Array.isArray(val) ? val : normalizeMultiFromText(val);
          return (
            <div style={boxStyle}>
              {opts.map((o, idx) => (
                <Form.Check
                  key={idx}
                  type="checkbox"
                  label={o}
                  checked={arr.includes(o)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const on = e.target.checked;
                    const next = on ? [...new Set([...arr, o])] : arr.filter((x) => x !== o);
                    setResp(id, next);
                  }}
                  className="mb-1"
                />
              ))}
            </div>
          );
        }

        case "coordenadas":
        case "coordenada":
        case "coords": {
          const obj = val && typeof val === "object" ? val : null;
          const norm = normalizeCoordObj(obj);

          return (
            <div>
              <GoogleMapaCoordenadas
                value={norm ? [norm.lat, norm.lng] : null}
                onChange={(coords) => {
                  if (readOnly) return;

                  let lat;
                  let lng;

                  if (Array.isArray(coords) && coords.length >= 2) {
                    lat = coords[0];
                    lng = coords[1];
                  } else if (coords && typeof coords === "object") {
                    lat = coords.lat ?? coords.latitude ?? null;
                    lng = coords.lng ?? coords.lon ?? coords.longitude ?? null;
                  } else {
                    return;
                  }

                  if (!isValidCoordPair(lat, lng)) return;

                  setResp(id, {
                    lat: Number(String(lat).trim().replace(",", ".")),
                    lng: Number(String(lng).trim().replace(",", ".")),
                  });
                }}
                height={280}
                defaultZoom={16}
                readOnly={readOnly}
                disabled={readOnly}
              />

              <div className="text-muted mt-2" style={{ fontSize: 12 }}>
                {norm ? `Lat: ${norm.lat.toFixed(6)} | Lng: ${norm.lng.toFixed(6)}` : "Sin coordenadas"}
              </div>
            </div>
          );
        }

        case "imagen": {
          const linksText = linksNuevos?.[id] ?? "";

          return (
            <div>
              <div className="text-muted mb-2" style={{ fontSize: 13 }}>
                {readOnly
                  ? "Imágenes adjuntas."
                  : "Podés adjuntar archivos abajo o pegar links directos a imágenes."}
              </div>

              {!readOnly && (
                <>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    placeholder={"Pegá uno o varios links de imagen.\nUno por línea o separados por coma."}
                    value={linksText}
                    onChange={(e) => onChangeLinks(id, e.target.value)}
                  />
                  <div className="text-muted mt-1" style={{ fontSize: 12 }}>
                    Ejemplo:
                    <br />
                    https://sitio.com/foto1.jpg
                    <br />
                    https://sitio.com/foto2.png
                  </div>
                </>
              )}
            </div>
          );
        }

        default:
          return (
            <Form.Control
              value={val ?? ""}
              disabled={readOnly}
              onChange={(e) => setResp(id, e.target.value)}
            />
          );
      }
    })();

    return (
      <Row className="mb-3">
        <Col md={5} className="pe-md-4">
          {header}
          {p.permite_foto ? (
            <div className="mt-1">
              <Badge bg="info">Permite foto</Badge>
            </div>
          ) : null}
        </Col>
        <Col md={7}>{rightControl}</Col>
      </Row>
    );
  };

  const renderFotosPregunta = (p) => {
    const idPreg = Number(p.id_pregunta);
    const tipo = String(p.tipo || "").toLowerCase();
    const permiteFotos = !!p.permite_foto || tipo === "imagen";
    if (!permiteFotos) return null;

    const actuales = fotosActuales?.[idPreg] || [];
    const nuevas = fotosNuevas?.[idPreg] || [];
    const linksPreview = splitImageLinksText(linksNuevos?.[idPreg]);

    return (
      <Row className="mb-4">
        <Col md={5} className="pe-md-4">
          <div className="fw-semibold">Fotos / links</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {(actuales?.length || 0) > 0 ? `Adjuntas: ${actuales.length}` : "Sin recursos guardados"}
          </div>
        </Col>

        <Col md={7}>
          {!readOnly && (
            <div className="mb-2">
              <Form.Control
                type="file"
                accept="image/*"
                multiple
                ref={(el) => (fileInputRefs.current[idPreg] = el)}
                onChange={(e) => onPickFotos(idPreg, e.target.files)}
              />
              <div className="text-muted mt-1" style={{ fontSize: 12 }}>
                Los archivos nuevos se suben al guardar.
              </div>
            </div>
          )}

          {actuales.length > 0 ? (
            <div className="d-flex flex-wrap gap-2 mb-2">
              {actuales.map((f) => {
                const idFoto = Number(f.id_foto || f.id);
                const url = fotoUrl(f.ruta_archivo);
                const deletingThis = Number(deletingFotoId) === Number(idFoto);
                const externa = isExternalUrl(f.ruta_archivo);

                return (
                  <div
                    key={idFoto}
                    style={{
                      width: 170,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: 6,
                      background: "#fff",
                      opacity: deletingThis ? 0.6 : 1,
                    }}
                  >
                    <a href={url} target="_blank" rel="noreferrer">
                      <div
                        style={{
                          width: "100%",
                          height: 100,
                          overflow: "hidden",
                          borderRadius: 6,
                          background: "#f8fafc",
                        }}
                      >
                        <img
                          src={url}
                          alt="foto"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </div>
                    </a>

                    <div className="mt-2 text-muted" style={{ fontSize: 11 }}>
                      {externa ? "Link externo" : "Archivo interno"}
                    </div>

                    {!readOnly && (
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="w-100 mt-2"
                        disabled={saving || loading || deletingThis}
                        onClick={() => eliminarFoto(idFoto)}
                      >
                        {deletingThis ? "Eliminando..." : "Eliminar"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted mb-2">-</div>
          )}

          {!readOnly && nuevas.length > 0 && (
            <Alert variant="info" className="mt-2 py-2">
              Se seleccionaron <b>{nuevas.length}</b> archivos nuevos.
            </Alert>
          )}

          {!readOnly && linksPreview.length > 0 && (
            <div className="mt-2">
              <div className="fw-semibold mb-2" style={{ fontSize: 13 }}>
                Links a agregar
              </div>

              <div className="d-flex flex-wrap gap-2">
                {linksPreview.map((link, idx) => {
                  const url = fotoUrl(link);
                  return (
                    <div
                      key={`${idPreg}_link_${idx}`}
                      style={{
                        width: 170,
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: 6,
                        background: "#fff",
                      }}
                    >
                      <a href={url} target="_blank" rel="noreferrer">
                        <div
                          style={{
                            width: "100%",
                            height: 100,
                            overflow: "hidden",
                            borderRadius: 6,
                            background: "#f8fafc",
                          }}
                        >
                          <img
                            src={url}
                            alt="preview link"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        </div>
                      </a>

                      <div
                        className="mt-2 text-muted"
                        style={{
                          fontSize: 11,
                          wordBreak: "break-all",
                          maxHeight: 36,
                          overflow: "hidden",
                        }}
                        title={link}
                      >
                        {link}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Col>
      </Row>
    );
  };

  const modalTitle = useMemo(() => {
    if (!data?.informe) return readOnly ? "Ver informe" : "Editar informe";
    const baseT = data?.informe?.titulo || data?.informe?.nombre_plantilla || "Informe";
    return readOnly ? baseT : `Editar informe #${data?.informe?.id_informe ?? idInforme}`;
  }, [data, readOnly, idInforme]);

  const headerInfo = data?.informe ? (
    <div className="small text-muted" style={{ lineHeight: 1.35 }}>
      <div>
        <b>ID Informe:</b> {data.informe.id_informe}
      </div>
      <div>
        <b>Proyecto:</b> {data.informe.id_proyecto ?? "-"}
      </div>
      <div>
        <b>Plantilla:</b> {data.informe.nombre_plantilla ?? "-"}
      </div>
      <div>
        <b>Fecha:</b> {fmtDate(data.informe.fecha_creado)}
      </div>
    </div>
  ) : null;

  return (
    <Modal
      show={show}
      onHide={saving ? undefined : onHide}
      size="lg"
      centered
      scrollable
      backdrop="static"
      keyboard={!saving}
    >
      <Modal.Header closeButton={!saving}>
        <Modal.Title style={{ fontSize: 18 }}>{modalTitle}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {loading ? (
          <div className="d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" />
            <span>Cargando...</span>
          </div>
        ) : !data ? (
          <Alert variant="warning" className="mb-0">
            No se pudo cargar el informe.
          </Alert>
        ) : (
          <>
            {headerInfo}

            {idRegistro && (
              <div className="mt-4">
                <ScoringResultPanel idRegistro={idRegistro} canEditOverride={!readOnly} />
              </div>
            )}

            {!readOnly && (
              <div className="mb-3 mt-3">
                <Form.Label className="fw-semibold">Título</Form.Label>
                <Form.Control
                  value={titulo ?? ""}
                  onChange={(e) => setTitulo(e.target.value)}
                  disabled={saving}
                />
              </div>
            )}

            {(secciones || []).map((sec) => {
              const visiblePreguntas = (sec.preguntas || []).filter((p) => isVisible(p, respuestas));
              if (!visiblePreguntas.length) return null;

              return (
                <div key={sec.id_seccion} className="mb-4">
                  <div
                    className="fw-bold mb-3"
                    style={{
                      fontSize: 16,
                      borderBottom: "1px solid #e5e7eb",
                      paddingBottom: 8,
                    }}
                  >
                    {sec.titulo || sec.nombre || `Sección ${sec.id_seccion}`}
                  </div>

                  {visiblePreguntas.map((p) => (
                    <div key={p.id_pregunta}>
                      {renderControl(p)}
                      {renderFotosPregunta(p)}
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={saving}>
          Cerrar
        </Button>

        {!readOnly && (
          <Button variant="primary" onClick={handleGuardar} disabled={saving || loading}>
            {saving ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Guardando...
              </>
            ) : (
              "Guardar cambios"
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}