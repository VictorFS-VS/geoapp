// src/pages/InformeBuilder.jsx
// ✅ BUILDER COMPLETO (Plantillas + Secciones + Preguntas + Share Links)
// ✅ SECCIONES: dependencia usando SOLO `visible_if` (jsonb) — modo simple/avanzado
// ✅ PREGUNTAS: visible_if + required_if (modo simple/avanzado)
// ✅ FIX CLAVE: sincroniza correctamente Simple <-> Avanzado (para NO “perder” visible_if / required_if)
// ✅ FIX: en dependencia de sección NO permite elegir preguntas de la MISMA sección (evita condición imposible)
// ✅ NUEVO: tipo "semaforo" (color) con opciones_json (palette) y condiciones como select
// ✅ NUEVO (UX): Semáforo editable con CHECKBOXES + “Agregar color” (sin JSON técnico)
// ✅ FIX (UX): En "Links existentes" muestra CODIGO - NOMBRE (ID) en vez de solo id_proyecto
// ✅ NUEVO: Generar QR del mismo link público

import React, { useEffect, useMemo, useState } from "react";
import { Button, Modal, Form, Table, Alert, Badge, Spinner } from "react-bootstrap";
import * as XLSX from "xlsx";
import { listarProyectosParaSelect } from "@/services/proyectosService";
import Swal from "sweetalert2";
import { alerts } from "@/utils/alerts";
import QRCode from "qrcode";
import ImportarRespuestasExcelModal from "@/components/informes/ImportarRespuestasExcelModal";
import ImportarInformesNuevoModal from "@/modules/informes/ImportarInformesNuevoModal";
import DuplicarPlantillaModal from "@/components/informes/DuplicarPlantillaModal";
import { hasPerm as hasUserPerm } from "@/utils/auth";

/* =========================
   API base (robusto)
   ========================= */
// Soporta:
// - VITE_API_URL = "http://localhost:4000"        (sin /api)
// - VITE_API_URL = "http://localhost:4000/api"    (con /api)
// - VITE_API_URL = "https://api.tudominio.com"    (reverse-proxy)
const RAW_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

function buildApiBase(raw) {
  const b = String(raw || "").trim().replace(/\/+$/, "");
  // si ya termina en /api -> usar tal cual
  if (/\/api$/i.test(b)) return b;
  // si NO termina en /api -> agregar /api
  return b + "/api";
}

const API_URL = buildApiBase(RAW_BASE);

const authHeaders = () => {
  const token = localStorage.getItem("token");
  const h = { Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
};

/* =========================
   Auth helpers
   ========================= */
const GROUPS = {
  ADMIN: 1,
  CONSULTOR: 8,
  CLIENTE: 9,
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,
};

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

function isAdminUser(u) {
  const tipo = Number(u?.tipo_usuario ?? u?.group_id ?? u?.tipo);
  return tipo === GROUPS.ADMIN;
}

/* =========================
   Labels
   ========================= */
const tiposLabel = {
  texto: "Texto",
  numero: "Número",
  fecha: "Fecha",
  si_no: "Sí / No",
  select: "Opción única",
  multiselect: "Opción múltiple",
  semaforo: "Semáforo (color)", // ✅ NUEVO
  coordenada: "Coordenadas",
  imagen: "Imagen",
};

/* =========================
   Defaults
   ========================= */
const emptyPlantilla = { nombre: "", descripcion: "", activo: true };
const emptySeccion = { titulo: "", orden: 1, visible_if: null };
const emptyPregunta = {
  etiqueta: "",
  tipo: "texto",
  opciones_json: null,
  obligatorio: false,
  orden: 1,
  permite_foto: false,
  id_unico: false,
  visible_if: null,
  required_if: null,
};

/* =========================
   Semáforo defaults
   ========================= */
const SEMAFORO_PALETTE = [
  { value: "verde", label: "Verde", color: "#2ECC71" },
  { value: "amarillo", label: "Amarillo", color: "#FACC15" },
  { value: "naranja", label: "Naranja", color: "#FB923C" },
  { value: "rojo", label: "Rojo", color: "#EF4444" },
  { value: "azul", label: "Azul", color: "#3B82F6" },
  { value: "celeste", label: "Celeste", color: "#22D3EE" },
  { value: "morado", label: "Morado", color: "#A855F7" },
  { value: "gris", label: "Gris", color: "#9CA3AF" },
  { value: "negro", label: "Negro", color: "#111827" },
  { value: "blanco", label: "Blanco", color: "#F9FAFB" },
];

function isSemaforoTipo(t) {
  return String(t || "").toLowerCase() === "semaforo";
}
function isSelectLikeTipo(t) {
  const tt = String(t || "").toLowerCase();
  return tt === "select" || tt === "semaforo";
}
function isMultiTipo(t) {
  return String(t || "").toLowerCase() === "multiselect";
}

function optionValuesFromOpcionesJson(opciones_json) {
  if (!Array.isArray(opciones_json)) return [];
  // strings
  if (opciones_json.length && typeof opciones_json[0] === "string") {
    return opciones_json.map((v) => String(v));
  }
  // objects (semaforo)
  return opciones_json
    .map((o) => {
      if (o == null) return "";
      if (typeof o === "string") return o;
      if (typeof o === "object") return String(o.value ?? o.label ?? "");
      return "";
    })
    .filter(Boolean);
}

/* =========================
   Semáforo UI helpers (NO JSON)
   ========================= */
function slugifyValue(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sin acentos
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeHexColor(c) {
  const s = String(c || "").trim();
  if (!s) return "";
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  return m ? s.toUpperCase() : "";
}

function buildSemaforoOpcionesFromUI({ selectedValues, customItems }) {
  const selectedSet = new Set((selectedValues || []).map(String));

  const fromDefaults = SEMAFORO_PALETTE.filter((o) => selectedSet.has(String(o.value))).map((o) => ({
    value: String(o.value),
    label: String(o.label),
    color: String(o.color),
  }));

  const fromCustom = (customItems || [])
    .map((x) => {
      const label = String(x.label || "").trim();
      const color = normalizeHexColor(x.color);
      if (!label || !color) return null;
      const value = slugifyValue(x.value || label);
      if (!value) return null;
      return { value, label, color };
    })
    .filter(Boolean);

  // evitar duplicados por value (custom pisa a default si repite)
  const map = new Map();
  for (const o of fromDefaults) map.set(o.value, o);
  for (const o of fromCustom) map.set(o.value, o);

  return Array.from(map.values());
}

/* =========================
   Toast / Confirm
   ========================= */
function toastOk(msg) {
  if (alerts?.toast?.success) return alerts.toast.success(msg);
  return Swal.fire({
    toast: true,
    position: "top-end",
    icon: "success",
    title: msg,
    showConfirmButton: false,
    timer: 1800,
    timerProgressBar: true,
  });
}
function toastWarn(msg) {
  if (alerts?.toast?.warning) return alerts.toast.warning(msg);
  return Swal.fire({
    toast: true,
    position: "top-end",
    icon: "warning",
    title: msg,
    showConfirmButton: false,
    timer: 2200,
    timerProgressBar: true,
  });
}
function toastErr(msg) {
  if (alerts?.toast?.error) return alerts.toast.error(msg);
  return Swal.fire({
    toast: true,
    position: "top-end",
    icon: "error",
    title: msg,
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
  });
}

async function confirmSwal({
  title,
  text,
  html,
  icon = "warning",
  confirmButtonText = "Aceptar",
  cancelButtonText = "Cancelar",
  confirmButtonColor,
}) {
  if (alerts?.confirm) {
    try {
      const r = await alerts.confirm({
        title,
        text,
        html,
        icon,
        confirmButtonText,
        cancelButtonText,
        confirmButtonColor,
      });
      if (typeof r === "boolean") return { isConfirmed: r };
      if (r && typeof r === "object" && "isConfirmed" in r) return r;
      return { isConfirmed: false };
    } catch {}
  }

  const r2 = await Swal.fire({
    title,
    text,
    html,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    ...(confirmButtonColor ? { confirmButtonColor } : {}),
  });

  return { isConfirmed: !!r2.isConfirmed };
}

/* =========================
   Date helpers (share links)
   ========================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDatetimeLocalValue(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/* =========================
   URL helpers
   ========================= */
function normalizeUrl(u) {
  if (!u) return "";
  return String(u).trim().replace(/([^:]\/)\/+/g, "$1");
}

/* =========================
   JSON helpers
   ========================= */
function safeStringifyJson(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function parseJsonOrNull(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    return { __error: e?.message || "JSON inválido" };
  }
}

function asCondObject(cond) {
  if (cond == null) return null;
  if (typeof cond === "object") return cond;
  if (typeof cond === "string") {
    const p = parseJsonOrNull(cond);
    if (p && p.__error) return null;
    return p;
  }
  return null;
}

/* =========================
   Simple rules by type
   ========================= */
function allowedWhenByParentType(parentTipo) {
  const t = String(parentTipo || "").toLowerCase();

  if (t === "si_no") {
    return [
      { value: "EQ_TRUE", label: "Es “Sí”" },
      { value: "EQ_FALSE", label: "Es “No”" },
    ];
  }

  if (t === "texto" || t === "fecha" || t === "coordenada") {
    return [
      { value: "NOT_EMPTY", label: "Tiene valor" },
      { value: "EMPTY", label: "Está vacío" },
    ];
  }

  if (t === "numero") {
    return [
      { value: "NOT_EMPTY", label: "Tiene valor" },
      { value: "EMPTY", label: "Está vacío" },
      { value: "EQ_VALUE", label: "Es igual a…" },
      { value: "IN_VALUE", label: "Es igual a (uno de…)" },
    ];
  }

  // ✅ select-like (incluye semaforo)
  if (t === "select" || t === "semaforo") {
    return [
      { value: "NOT_EMPTY", label: "Tiene valor" },
      { value: "EMPTY", label: "Está vacío" },
      { value: "EQ_VALUE", label: "Es igual a…" },
      { value: "IN_VALUE", label: "Es igual a (uno de…)" },
    ];
  }

  if (t === "multiselect") {
    return [
      { value: "NOT_EMPTY", label: "Tiene valor" },
      { value: "EMPTY", label: "Está vacío" },
      { value: "IN_VALUE", label: "Incluye (uno de…)" },
    ];
  }

  return [
    { value: "NOT_EMPTY", label: "Tiene valor" },
    { value: "EMPTY", label: "Está vacío" },
  ];
}

function defaultWhenForParentType(parentTipo) {
  const t = String(parentTipo || "").toLowerCase();
  if (t === "si_no") return "EQ_TRUE";
  if (t === "texto" || t === "fecha" || t === "coordenada") return "NOT_EMPTY";
  if (t === "multiselect") return "NOT_EMPTY";
  if (t === "select" || t === "semaforo") return "EQ_VALUE"; // ✅
  if (t === "numero") return "EQ_VALUE";
  return "NOT_EMPTY";
}

/* =========================
   Builders de condición
   ========================= */
function buildCondOnlyFromUI(ui, parentTipo) {
  const pid = Number(ui.parentId);
  if (!ui?.enabled || !pid) return null;

  let op = "eq";
  let value = true;

  switch (ui.when) {
    case "EQ_TRUE":
      op = "eq";
      value = true;
      break;
    case "EQ_FALSE":
      op = "eq";
      value = false;
      break;
    case "EMPTY":
      op = "falsy";
      value = undefined;
      break;
    case "NOT_EMPTY":
      op = "truthy";
      value = undefined;
      break;
    case "EQ_VALUE":
      op = "eq";
      if (String(parentTipo || "").toLowerCase() === "numero") {
        const n = ui.valueText === "" ? null : Number(ui.valueText);
        value = Number.isFinite(n) ? n : ui.valueText;
      } else {
        value = ui.valueText;
      }
      break;
    case "IN_VALUE":
      op = "in";
      if (Array.isArray(ui.valueList) && ui.valueList.length > 0) value = ui.valueList;
      else value = ui.valueText ? [ui.valueText] : [];
      break;
    default:
      op = "eq";
      value = true;
  }

  return value === undefined ? { id_pregunta: pid, op } : { id_pregunta: pid, op, value };
}

function buildPreguntaCondFromUI(ui, parentTipo) {
  const cond = buildCondOnlyFromUI(ui, parentTipo);
  if (!cond) return { visible_if: null, required_if: null };
  return {
    visible_if: ui.applyVisible ? cond : null,
    required_if: ui.applyRequired ? cond : null,
  };
}

function tryLoadRuleUIFromCond(cond, applyVisible, applyRequired) {
  const c = asCondObject(cond);
  if (!c || typeof c !== "object") return null;
  if (!c.id_pregunta || !c.op) return null;

  let when = "EQ_VALUE";
  let valueText = "";
  let valueList = [];

  if (c.op === "eq" && c.value === true) when = "EQ_TRUE";
  else if (c.op === "eq" && c.value === false) when = "EQ_FALSE";
  else if (c.op === "truthy") when = "NOT_EMPTY";
  else if (c.op === "falsy") when = "EMPTY";
  else if (c.op === "in") {
    when = "IN_VALUE";
    if (Array.isArray(c.value)) valueList = c.value.map((v) => String(v));
    else if (c.value != null && c.value !== "") valueList = [String(c.value)];
  } else if (c.op === "eq") {
    when = "EQ_VALUE";
    valueText = c.value != null ? String(c.value) : "";
  }

  return {
    enabled: true,
    parentId: String(c.id_pregunta),
    when,
    valueText,
    valueList,
    applyVisible: !!applyVisible,
    applyRequired: !!applyRequired,
  };
}

/* =========================
   Component
   ========================= */
export default function InformeBuilder() {
  /* ───────────────────────── Plantillas ───────────────────────── */
  const [plantillas, setPlantillas] = useState([]);
  const [loadingPlantillas, setLoadingPlantillas] = useState(true);
  const [plantillaSelId, setPlantillaSelId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showNewImportModal, setShowNewImportModal] = useState(false);
  const [plantillaSearch, setPlantillaSearch] = useState("");
  const [plantillasPage, setPlantillasPage] = useState(1);
  const PLANTILLAS_PER_PAGE = 8;

  const plantillaSeleccionada = useMemo(
    () => plantillas.find((p) => Number(p.id_plantilla) === Number(plantillaSelId)) || null,
    [plantillas, plantillaSelId]
  );

  const plantillasFiltradas = useMemo(() => {
    const term = String(plantillaSearch || "").trim().toLowerCase();

    let arr = Array.isArray(plantillas) ? [...plantillas] : [];

    // ordenar: activas arriba, luego por nombre
    arr.sort((a, b) => {
      const actA = a?.activo ? 1 : 0;
      const actB = b?.activo ? 1 : 0;

      if (actA !== actB) return actB - actA;

      return String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es", {
        sensitivity: "base",
        numeric: true,
      });
    });

    if (!term) return arr;

    return arr.filter((p) => {
      const nombre = String(p?.nombre || "").toLowerCase();
      const descripcion = String(p?.descripcion || "").toLowerCase();
      const estado = p?.activo ? "activa" : "inactiva";
      return (
        nombre.includes(term) ||
        descripcion.includes(term) ||
        estado.includes(term) ||
        String(p?.id_plantilla || "").includes(term)
      );
    });
  }, [plantillas, plantillaSearch]);

  const totalPlantillasPages = Math.max(
    1,
    Math.ceil(plantillasFiltradas.length / PLANTILLAS_PER_PAGE)
  );

  const plantillasPaginadas = useMemo(() => {
    const start = (plantillasPage - 1) * PLANTILLAS_PER_PAGE;
    return plantillasFiltradas.slice(start, start + PLANTILLAS_PER_PAGE);
  }, [plantillasFiltradas, plantillasPage]);

  useEffect(() => {
    setPlantillasPage(1);
  }, [plantillaSearch]);

  useEffect(() => {
    if (plantillasPage > totalPlantillasPages) {
      setPlantillasPage(totalPlantillasPages);
    }
  }, [plantillasPage, totalPlantillasPages]);

  /* ───────────────────────── Permisos por rol ───────────────────────── */
  const currentUser = useMemo(() => getCurrentUser(), []);

  function canEditPlantilla(p) {
    if (!p) return false;

    if (isAdminUser(currentUser)) return true;
    if (Number(p.id_creador) === Number(currentUser?.id)) return true;
    return String(p.mi_rol || "").toLowerCase() === "edit";
  }

  function canDeletePlantilla(p) {
    if (!p) return false;

    const esDueno = Number(p.id_creador) === Number(currentUser?.id);
    const esAdmin = isAdminUser(currentUser);
    const tienePermisoDelete =
      hasUserPerm("informes.delete", currentUser) ||
      hasUserPerm("informes.plantillas.delete", currentUser);

    return (esAdmin || esDueno) && tienePermisoDelete;
  }

  const miRol = useMemo(() => {
    const r = String(plantillaSeleccionada?.mi_rol || "").toLowerCase();
    return r; // 'edit' | 'view' | ''
  }, [plantillaSeleccionada?.mi_rol]);

  const esOwner = useMemo(() => {
    if (!plantillaSeleccionada) return false;
    return Number(plantillaSeleccionada.id_creador) === Number(currentUser?.id);
  }, [plantillaSeleccionada, currentUser?.id]);

  const esAdmin = useMemo(() => isAdminUser(currentUser), [currentUser]);

  const canEditSelected = useMemo(() => {
    if (!plantillaSeleccionada) return false;
    if (esAdmin) return true;
    if (esOwner) return true;
    return miRol === "edit";
  }, [plantillaSeleccionada, esAdmin, esOwner, miRol]);

  const canManageShare = useMemo(() => {
    if (!plantillaSeleccionada) return false;
    if (esAdmin) return true;
    return esOwner;
  }, [plantillaSeleccionada, esAdmin, esOwner]);

  /* ───────────────────────── Estructura ───────────────────────── */
  const [estructura, setEstructura] = useState(null);
  const [loadingEstructura, setLoadingEstructura] = useState(false);

  // preguntas planas para el mapeo de etiquetas
  const preguntasLista = useMemo(() => {
    if (!estructura || !Array.isArray(estructura.secciones)) return [];
    return estructura.secciones.flatMap((s) => s.preguntas || []);
  }, [estructura]);

  /* ===== importación desde Excel ===== */
  const [fileImport, setFileImport] = useState(null);
  const [importPreviewRaw, setImportPreviewRaw] = useState([]);
  const [importPreviewMapped, setImportPreviewMapped] = useState([]);
  const [importPayload, setImportPayload] = useState({});
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  const handleImportFile = async (e) => {
    setImportError("");
    setImportPreviewRaw([]);
    setImportPreviewMapped([]);
    setImportPayload({});

    const f = e.target.files[0];
    if (!f) return;
    setFileImport(f);

    try {
      const arrayBuffer = await f.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("El Excel no contiene filas válidas o el encabezado no está bien ubicado.");
      }

      // detectar columna de ID informe buscando valores mayoritariamente numéricos
      const keys = Object.keys(raw[0]);
      let colInf = null;

      // helper para fracción de valores numéricos
      function numericFraction(col) {
        let count = 0, total = 0;
        raw.forEach((r) => {
          const v = r[col];
          if (v !== null && v !== undefined && v !== "") {
            total += 1;
            if (Number.isFinite(Number(v))) count += 1;
          }
        });
        return total ? count / total : 0;
      }

      // prioridad a columnas con nombres evidentes
      keys.forEach((k) => {
        const t = String(k || "").toLowerCase();
        if (t.includes("informe") || t === "id" || t.includes("codigo")) {
          colInf = k;
        }
      });

      // si no se encontró nada explícito, buscar la que tenga mayor fracción numérica
      if (!colInf) {
        let best = "";
        let bestFrac = 0;
        keys.forEach((k) => {
          const frac = numericFraction(k);
          if (frac > bestFrac) {
            bestFrac = frac;
            best = k;
          }
        });
        if (bestFrac >= 0.5) colInf = best; // al menos mitad numérica
      }

      if (!colInf) {
        throw new Error(`No pude detectar la columna de informe/id. Columnas encontradas: ${keys.join(", ")}`);
      }

      // crear mapa titulo -> id de pregunta (case-insensitive)
      const titleToId = {};
      preguntasLista.forEach((q) => {
        const key = String(q.etiqueta || q.titulo || "").trim().toLowerCase();
        if (key) titleToId[key] = q.id_pregunta;
      });

      // columnas de respuestas = todas excepto la columna informe
      const colsRespuesta = keys.filter((k) => k !== colInf);

      // crear mapa de qué columna mapea a qué pregunta
      const colMapeo = {};
      colsRespuesta.forEach((colKey) => {
        const colTitleNorm = String(colKey || "").trim().toLowerCase();
        const idPreg = titleToId[colTitleNorm];
        colMapeo[colKey] = { 
          encontrada: !!idPreg, 
          idPreg, 
          titulo_pregunta: idPreg ? preguntasLista.find(q => q.id_pregunta === idPreg)?.etiqueta : null
        };
      });

      const payload = {};
      const mappedPreview = [];

      raw.forEach((row) => {
        const infRaw = row[colInf];
        const idInf = Number(infRaw);
        if (!Number.isFinite(idInf)) return; // ignorar filas sin ID válido

        if (!payload[idInf]) payload[idInf] = {};

        const preview = { 
          __id_informe: idInf,
          __respuestas_mapeadas: [] 
        };

        // para cada columna de respuesta, buscar la pregunta por título
        colsRespuesta.forEach((colKey) => {
          const mapeo = colMapeo[colKey];
          const val = row[colKey];

          if (mapeo.encontrada && val !== undefined && val !== null && val !== "") {
            payload[idInf][mapeo.idPreg] = val;
            preview.__respuestas_mapeadas.push({
              columna_excel: colKey,
              titulo_pregunta: mapeo.titulo_pregunta,
              id_pregunta: mapeo.idPreg,
              valor: val
            });
          } else if (!mapeo.encontrada && val) {
            preview.__respuestas_mapeadas.push({
              columna_excel: colKey,
              titulo_pregunta: "⚠️ NO ENCONTRADA",
              id_pregunta: null,
              valor: val,
              error: "No hay pregunta con este titulo"
            });
          }
        });

        mappedPreview.push(preview);
      });

      setImportPreviewRaw(raw.slice(0, 5));
      setImportPreviewMapped(mappedPreview.slice(0, 5));
      setImportPayload(payload);

      toastOk(`Archivo "${f.name}" listo. Filas: ${mappedPreview.length}.`);
    } catch (err) {
      const msg = err.message || "Error al procesar el archivo Excel.";
      setImportError(msg);
      toastErr(msg);
    }
  };

  const ejecutarImport = async () => {
    if (!fileImport) {
      const msg = "No hay archivo seleccionado.";
      setImportError(msg);
      toastWarn(msg);
      return;
    }

    setImporting(true);
    for (const [idInf, resps] of Object.entries(importPayload)) {
      try {
        await apiSend(`${API_URL}/informes/${idInf}`, "PUT", { respuestas: resps });
      } catch (e) {
        console.error("error update informe", idInf, e);
      }
    }
    setImporting(false);
    toastOk("Importación finalizada");
  };

  // acordeón por sección
  const [collapsedBySection, setCollapsedBySection] = useState({});
  const toggleSection = (idSeccion) => {
    setCollapsedBySection((prev) => ({
      ...prev,
      [idSeccion]: !prev[idSeccion],
    }));
  };

  /* ───────────────────────── Modals ───────────────────────── */
  const [showPlantillaModal, setShowPlantillaModal] = useState(false);
  const [plantillaForm, setPlantillaForm] = useState(emptyPlantilla);
  const [plantillaEditId, setPlantillaEditId] = useState(null);
  const [showDuplicarModal, setShowDuplicarModal] = useState(false);

  // ✅ SECCIÓN
  const [showSeccionModal, setShowSeccionModal] = useState(false);
  const [seccionForm, setSeccionForm] = useState(emptySeccion);
  const [seccionEditId, setSeccionEditId] = useState(null);

  // modo simple/avanzado sección
  const [useSimpleRulesSeccion, setUseSimpleRulesSeccion] = useState(true);
  const [seccionRuleUI, setSeccionRuleUI] = useState({
    enabled: false,
    parentId: "",
    when: "EQ_TRUE",
    valueText: "",
    valueList: [],
  });
  const [seccionVisibleIfText, setSeccionVisibleIfText] = useState("");

  // ✅ PREGUNTA
  const [showPreguntaModal, setShowPreguntaModal] = useState(false);
  const [preguntaForm, setPreguntaForm] = useState(emptyPregunta);
  const [preguntaEditId, setPreguntaEditId] = useState(null);
  const [preguntaSeccionId, setPreguntaSeccionId] = useState(null);

  // inputs reglas pregunta (avanzado)
  const [visibleIfText, setVisibleIfText] = useState("");
  const [requiredIfText, setRequiredIfText] = useState("");

  // modo simple/avanzado pregunta
  const [useSimpleRules, setUseSimpleRules] = useState(true);
  const [ruleUI, setRuleUI] = useState({
    enabled: false,
    parentId: "",
    when: "EQ_TRUE",
    valueText: "",
    valueList: [],
    applyVisible: true,
    applyRequired: true,
  });

  // ✅ UI amigable para Semáforo (en vez de editar JSON)
  const [semaforoUI, setSemaforoUI] = useState({
    selectedValues: SEMAFORO_PALETTE.map((x) => x.value), // por defecto todos
    customLabel: "",
    customColor: "#2ECC71",
    customItems: [], // {value?, label, color}
    showAdvancedJson: false, // opcional: dejar JSON escondido (solo lectura)
  });

  /* ───────────────────────── Share links ───────────────────────── */
  const [proyectos, setProyectos] = useState([]);
  const [shareLinks, setShareLinks] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");

  const defaultExp = toDatetimeLocalValue(addMonths(new Date(), 1));
  const [shareForm, setShareForm] = useState({
    id_proyecto: "",
    titulo: "",
    expira_en_local: defaultExp,
    max_envios: "",
  });

  const [showEditShareModal, setShowEditShareModal] = useState(false);
  const [editingShareId, setEditingShareId] = useState(null);
  const [editShareForm, setEditShareForm] = useState({
    id_proyecto: "",
    titulo: "",
    expira_en_local: "",
    max_envios: "",
  });

  /* ───────────────────────── QR (Share link) ───────────────────────── */
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  /* ✅ FIX UX: Map id_proyecto -> proyecto (para mostrar CODIGO - NOMBRE en Links existentes) */
  const proyectoById = useMemo(() => {
    const m = new Map();
    for (const p of proyectos || []) {
      const id = Number(p?.id);
      if (!Number.isNaN(id) && id) m.set(id, p);
    }
    return m;
  }, [proyectos]);

  function proyectoLabel(idProyecto) {
    const id = Number(idProyecto);
    if (!id) return "-";

    const p = proyectoById.get(id);
    if (!p) return `#${id}`; // fallback si aún no cargó proyectos

    const cod = p.codigo ? `${p.codigo} - ` : "";
    const nom = p.nombre || `Proyecto #${id}`;
    return `${cod}${nom} (ID: ${id})`;
  }


  /* ───────────────────────── Compartir plantillas ───────────────────────── */
  const [showShareModal, setShowShareModal] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);
  const [compartidos, setCompartidos] = useState([]);
  const [loadingCompartidos, setLoadingCompartidos] = useState(false);

  const [shareUserId, setShareUserId] = useState("");
  const [shareRol, setShareRol] = useState("view"); // view | edit


  /* ───────────────────────── API helpers ───────────────────────── */
  async function apiGet(url) {
    const res = await fetch(url, { headers: { ...authHeaders() } });

    // intentar leer JSON, pero sin romper si viene vacío
    const data = await res
      .json()
      .catch(() => ({}));

    if (!res.ok) {
      const msg = data?.error || data?.message || `Error HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function apiSend(url, method, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    const data = await res
      .json()
      .catch(() => ({}));

    if (!res.ok) {
      const msg = data?.error || data?.message || `Error HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  /* ───────────────────────── Compartir: API ───────────────────────── */
  async function loadUsuariosParaCompartir() {
    setLoadingUsuarios(true);
    try {
      // tu backend: GET /api/usuarios/?page=1&limit=500
      const data = await apiGet(`${API_URL}/usuarios?page=1&limit=500`);

      // soporta:
      // - { rows: [...] }
      // - { data: [...] }
      // - [...] (si algún día devolvés array directo)
      const rows = data?.rows || data?.data || (Array.isArray(data) ? data : []);
      setUsuarios(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.warn(e.message);
      setUsuarios([]);
    } finally {
      setLoadingUsuarios(false);
    }
  }


  async function loadCompartidos(idPlantilla) {
    setLoadingCompartidos(true);
    try {
      const pid = Number(idPlantilla);
      if (!pid) return setCompartidos([]);

      const data = await apiGet(`${API_URL}/compartir/plantillas/${pid}`);
      setCompartidos(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.warn(e.message);
      setCompartidos([]);
    } finally {
      setLoadingCompartidos(false);
    }
  }

  async function openCompartirModal() {
    if (!plantillaSelId) return;
    if (!canManageShare) return toastWarn("Solo el dueño o admin puede compartir.");

    setShareUserId("");
    setShareRol("view");
    setShowShareModal(true);

    await Promise.all([loadUsuariosParaCompartir(), loadCompartidos(plantillaSelId)]);
  }

  async function onGuardarCompartir() {
    if (!plantillaSelId) return;

    const id_usuario = Number(shareUserId);
    if (!id_usuario) return toastWarn("Seleccioná un usuario");

    try {
      await apiSend(`${API_URL}/compartir/plantillas/${plantillaSelId}`, "POST", {
        id_usuario,
        rol: shareRol,
      });
      toastOk("Compartido actualizado");
      await loadCompartidos(plantillaSelId);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function onQuitarCompartir(idUsuario) {
    if (!plantillaSelId) return;

    const r = await confirmSwal({
      title: "Quitar acceso",
      text: "Este usuario ya no podrá ver/editar la plantilla.",
      icon: "warning",
      confirmButtonText: "Quitar",
      confirmButtonColor: "#d33",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/compartir/plantillas/${plantillaSelId}/${idUsuario}`, "DELETE");
      toastOk("Acceso quitado");
      await loadCompartidos(plantillaSelId);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function copyToClipboard(text) {
    const t = normalizeUrl(text);
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      toastOk("Link copiado");
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toastOk("Link copiado");
      } catch {
        toastErr("No se pudo copiar el link");
      }
    }
  }

  function openUrl(u) {
    const url = normalizeUrl(u);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function openQrForUrl(url) {
    const u = normalizeUrl(url);
    if (!u) return toastWarn("No hay URL para generar QR");

    setQrLoading(true);
    setQrValue(u);
    setQrDataUrl("");
    setShowQrModal(true);

    try {
      const dataUrl = await QRCode.toDataURL(u, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      console.error(e);
      toastErr("No se pudo generar el QR");
      setShowQrModal(false);
    } finally {
      setQrLoading(false);
    }
  }

  function downloadQrPng() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "link_qr.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ───────────────────────── Load inicial ───────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        setLoadingPlantillas(true);
        const data = await apiGet(`${API_URL}/informes/plantillas`);
        setPlantillas(data?.rows || data?.data || data || []);
      } catch (e) {
        console.error(e);
        toastErr(e.message);
      } finally {
        setLoadingPlantillas(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cargar proyectos (share links)
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const list = await listarProyectosParaSelect({ limit: 500 });
        if (!alive) return;
        setProyectos(Array.isArray(list) ? list : []);
      } catch (e) {
        console.warn("No se pudieron cargar proyectos:", e.message);
        if (!alive) return;
        setProyectos([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  /* ───────────────────────── Load estructura plantilla ───────────────────────── */
  useEffect(() => {
    if (!plantillaSelId) {
      setEstructura(null);
      setShareLinks([]);
      setPublicUrl("");
      setCollapsedBySection({});
      return;
    }

    (async () => {
      try {
        setLoadingEstructura(true);
        const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
        setEstructura(data);

        const secs = data?.secciones || [];
        setCollapsedBySection((prev) => {
          const next = { ...prev };
          for (const s of secs) {
            if (next[s.id_seccion] === undefined) next[s.id_seccion] = true;
          }
          return next;
        });

        await refreshShareLinks(plantillaSelId);
      } catch (e) {
        console.error(e);
        toastErr(e.message);
        setEstructura(null);
      } finally {
        setLoadingEstructura(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantillaSelId]);

  async function refreshShareLinks(idPlantilla) {
    try {
      const data = await apiGet(`${API_URL}/informes/plantillas/${idPlantilla}/share-links`);
      setShareLinks(data?.links || data?.rows || []);
    } catch (e) {
      console.warn(e.message);
      setShareLinks([]);
    }
  }

  /* ───────────────────────── Preguntas para "padre" ───────────────────────── */
  const preguntasParaPadre = useMemo(() => {
    const secs = estructura?.secciones || [];

    // ✅ anotamos de qué sección es cada pregunta
    const all = secs.flatMap((s) =>
      (s.preguntas || []).map((p) => ({
        ...p,
        id_seccion: s.id_seccion, // ✅ clave para filtrar en dependencia de sección
      }))
    );

    // ✅ para dependencia de PREGUNTA: excluir la misma pregunta si estás editando
    return all.filter((p) => !preguntaEditId || Number(p.id_pregunta) !== Number(preguntaEditId));
  }, [estructura, preguntaEditId]);

  // ✅ Para dependencia de SECCIÓN: NO permitir preguntas de la MISMA sección (si se está editando una sección)
  const preguntasParaPadreSeccion = useMemo(() => {
    if (!seccionEditId) return preguntasParaPadre; // creando sección → no hay nada que excluir
    return preguntasParaPadre.filter((p) => Number(p.id_seccion) !== Number(seccionEditId));
  }, [preguntasParaPadre, seccionEditId]);

  const parentById = useMemo(() => {
    const m = new Map();
    for (const p of preguntasParaPadre) m.set(String(p.id_pregunta), p);
    return m;
  }, [preguntasParaPadre]);

  // Pregunta modal
  const selectedParent = useMemo(() => {
    if (!ruleUI.parentId) return null;
    return parentById.get(String(ruleUI.parentId)) || null;
  }, [ruleUI.parentId, parentById]);

  const allowedWhens = useMemo(() => allowedWhenByParentType(selectedParent?.tipo), [selectedParent?.tipo]);

  useEffect(() => {
    if (!useSimpleRules) return;
    if (!ruleUI.enabled) return;
    if (!ruleUI.parentId) return;

    const parentTipo = selectedParent?.tipo;
    const allowed = allowedWhenByParentType(parentTipo).map((x) => x.value);

    setRuleUI((prev) => {
      let nextWhen = prev.when;
      if (!allowed.includes(nextWhen)) nextWhen = defaultWhenForParentType(parentTipo);

      const usesValue = nextWhen === "EQ_VALUE" || nextWhen === "IN_VALUE";
      const isGroup = nextWhen === "IN_VALUE";

      const nextValueText = usesValue && !isGroup ? prev.valueText : "";
      const nextValueList = usesValue && isGroup ? prev.valueList || [] : [];

      return { ...prev, when: nextWhen, valueText: nextValueText, valueList: nextValueList };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleUI.parentId, selectedParent?.tipo, useSimpleRules, ruleUI.enabled]);

  // Sección modal
  const selectedParentSeccion = useMemo(() => {
    if (!seccionRuleUI.parentId) return null;
    return parentById.get(String(seccionRuleUI.parentId)) || null;
  }, [seccionRuleUI.parentId, parentById]);

  const allowedWhensSeccion = useMemo(
    () => allowedWhenByParentType(selectedParentSeccion?.tipo),
    [selectedParentSeccion?.tipo]
  );

  useEffect(() => {
    if (!useSimpleRulesSeccion) return;
    if (!seccionRuleUI.enabled) return;
    if (!seccionRuleUI.parentId) return;

    const parentTipo = selectedParentSeccion?.tipo;
    const allowed = allowedWhenByParentType(parentTipo).map((x) => x.value);

    setSeccionRuleUI((prev) => {
      let nextWhen = prev.when;
      if (!allowed.includes(nextWhen)) nextWhen = defaultWhenForParentType(parentTipo);

      const usesValue = nextWhen === "EQ_VALUE" || nextWhen === "IN_VALUE";
      const isGroup = nextWhen === "IN_VALUE";

      const nextValueText = usesValue && !isGroup ? prev.valueText : "";
      const nextValueList = usesValue && isGroup ? prev.valueList || [] : [];

      return { ...prev, when: nextWhen, valueText: nextValueText, valueList: nextValueList };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccionRuleUI.parentId, selectedParentSeccion?.tipo, useSimpleRulesSeccion, seccionRuleUI.enabled]);

  // ✅ Si ya estaba elegida una pregunta inválida (misma sección), limpiamos parentId automáticamente
  useEffect(() => {
    if (!showSeccionModal) return;
    if (!seccionEditId) return;
    if (!seccionRuleUI.enabled) return;
    if (!seccionRuleUI.parentId) return;

    const parent = preguntasParaPadre.find((p) => String(p.id_pregunta) === String(seccionRuleUI.parentId));
    if (parent && Number(parent.id_seccion) === Number(seccionEditId)) {
      setSeccionRuleUI((s) => ({ ...s, parentId: "" }));
    }
  }, [showSeccionModal, seccionEditId, seccionRuleUI.enabled, seccionRuleUI.parentId, preguntasParaPadre]);

  /* ───────────────────────── FIX: Sync Simple <-> Avanzado (Sección) ───────────────────────── */
  useEffect(() => {
    if (!showSeccionModal) return;

    // Si pasa a MODO SIMPLE => intentar cargar UI desde el JSON del textarea
    if (useSimpleRulesSeccion) {
      const parsed = parseJsonOrNull(seccionVisibleIfText);
      if (parsed && parsed.__error) return;

      const ui = tryLoadRuleUIFromCond(parsed, true, false);
      if (ui) {
        setSeccionRuleUI({
          enabled: true,
          parentId: ui.parentId,
          when: ui.when,
          valueText: ui.valueText,
          valueList: ui.valueList,
        });
      } else {
        if (!String(seccionVisibleIfText || "").trim()) {
          setSeccionRuleUI({ enabled: false, parentId: "", when: "EQ_TRUE", valueText: "", valueList: [] });
        }
      }
      return;
    }

    // Si pasa a MODO AVANZADO => volcar el UI actual al textarea
    const parentTipo = selectedParentSeccion?.tipo;
    const cond = buildCondOnlyFromUI(seccionRuleUI, parentTipo);
    setSeccionVisibleIfText(safeStringifyJson(cond));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSimpleRulesSeccion]);

  /* ───────────────────────── FIX: Sync Simple <-> Avanzado (Pregunta) ───────────────────────── */
  useEffect(() => {
    if (!showPreguntaModal) return;

    // Si pasa a MODO SIMPLE => intentar cargar UI desde JSON visible_if / required_if
    if (useSimpleRules) {
      const visParsed = parseJsonOrNull(visibleIfText);
      const reqParsed = parseJsonOrNull(requiredIfText);
      if (visParsed && visParsed.__error) return;
      if (reqParsed && reqParsed.__error) return;

      const ui = tryLoadRuleUIFromCond(visParsed, true, false) || tryLoadRuleUIFromCond(reqParsed, false, true);

      if (ui) {
        setRuleUI(ui);
      } else {
        if (!String(visibleIfText || "").trim() && !String(requiredIfText || "").trim()) {
          setRuleUI({
            enabled: false,
            parentId: "",
            when: "EQ_TRUE",
            valueText: "",
            valueList: [],
            applyVisible: true,
            applyRequired: true,
          });
        }
      }
      return;
    }

    // Si pasa a MODO AVANZADO => volcar el UI actual a los textareas
    const parentTipo = selectedParent?.tipo;
    const built = buildPreguntaCondFromUI(ruleUI, parentTipo);
    setVisibleIfText(safeStringifyJson(built.visible_if));
    setRequiredIfText(safeStringifyJson(built.required_if));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSimpleRules]);

  /* ───────────────────────── Si cambian a tipo semáforo mientras está abierto ───────────────────────── */
  useEffect(() => {
    if (!showPreguntaModal) return;
    if (!isSemaforoTipo(preguntaForm.tipo)) return;

    // si no hay UI armada, usar defaults (no pisa si ya hay algo)
    setSemaforoUI((s) => {
      const hasSelected = Array.isArray(s.selectedValues) && s.selectedValues.length > 0;
      const hasCustom = Array.isArray(s.customItems) && s.customItems.length > 0;
      if (hasSelected || hasCustom) return s;
      return {
        ...s,
        selectedValues: SEMAFORO_PALETTE.map((x) => x.value),
        customLabel: "",
        customColor: "#2ECC71",
        customItems: [],
        showAdvancedJson: false,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preguntaForm.tipo, showPreguntaModal]);

  /* ───────────────────────── Plantillas CRUD ───────────────────────── */
  function openCrearPlantilla() {
  setPlantillaEditId(null);
  setPlantillaForm(emptyPlantilla);
  setShowPlantillaModal(true);
  }

  function openEditarPlantilla(p) {
    if (!canEditPlantilla(p)) {
      return toastWarn("Solo lectura: no tenés permiso para editar.");
    }

    setPlantillaEditId(p.id_plantilla);
    setPlantillaForm({
      nombre: p.nombre || "",
      descripcion: p.descripcion || "",
      activo: p.activo !== false,
    });
    setShowPlantillaModal(true);
  }

  async function savePlantilla() {
    try {
      if (!canEditSelected && plantillaSelId) return toastWarn("Solo lectura: no tenés permiso para editar.");
      if (!plantillaForm.nombre?.trim()) {
        toastWarn("El nombre es obligatorio");
        return;
      }

      if (plantillaEditId) {
        await apiSend(`${API_URL}/informes/plantillas/${plantillaEditId}`, "PUT", plantillaForm);
        toastOk("Plantilla actualizada");
      } else {
        const created = await apiSend(`${API_URL}/informes/plantillas`, "POST", plantillaForm);
        toastOk("Plantilla creada");
        const newId = created?.id_plantilla || created?.plantilla?.id_plantilla;
        if (newId) setPlantillaSelId(newId);
      }

      const data = await apiGet(`${API_URL}/informes/plantillas`);
      setPlantillas(data?.rows || data?.data || data || []);
      setShowPlantillaModal(false);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function toggleActivaPlantilla(p) {
    if (!canEditPlantilla(p)) return toastWarn("Solo lectura: no tenés permiso para editar.");
    if (!p?.id_plantilla) return;

    const willActivate = !p.activo;
    const r = await confirmSwal({
      title: willActivate ? "Activar plantilla" : "Desactivar plantilla",
      text: willActivate ? "La plantilla volverá a estar disponible." : "La plantilla quedará inactiva (no se borra).",
      icon: "question",
      confirmButtonText: willActivate ? "Sí, activar" : "Sí, desactivar",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/plantillas/${p.id_plantilla}`, "PUT", { activo: willActivate });
      toastOk(willActivate ? "Plantilla activada" : "Plantilla desactivada");

      const data = await apiGet(`${API_URL}/informes/plantillas`);
      setPlantillas(data?.rows || data?.data || data || []);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function handleDuplicarPlantillaSuccess(data) {
    toastOk("Plantilla copiada correctamente");

    const listado = await apiGet(`${API_URL}/informes/plantillas`);
    const rows = listado?.rows || listado?.data || listado || [];
    setPlantillas(rows);

    const nuevaId = data?.id_plantilla || data?.plantilla?.id_plantilla;
    if (nuevaId) {
      setPlantillaSelId(nuevaId);
    }
  }

  async function eliminarDefinitivoPlantilla(idPlantilla) {
    const p = plantillas.find((x) => Number(x.id_plantilla) === Number(idPlantilla));

    if (!canDeletePlantilla(p)) {
      return toastWarn("No tenés permiso para eliminar definitivamente esta plantilla.");
    }

    const r = await confirmSwal({
      title: "Eliminar DEFINITIVAMENTE",
      html: `
        <div style="text-align:left">
          <p><b>Esto borra TODO:</b> plantilla, secciones, preguntas, links públicos, informes llenados, respuestas y fotos.</p>
          <p>¿Seguro que querés continuar?</p>
        </div>
      `,
      icon: "warning",
      confirmButtonText: "Sí, eliminar definitivo",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/plantillas/${idPlantilla}/hard`, "DELETE");
      toastOk("Plantilla eliminada definitivamente");

      setLoadingPlantillas(true);
      const data = await apiGet(`${API_URL}/informes/plantillas`);
      setPlantillas(data?.rows || data?.data || data || []);
      setPlantillaSelId(null);
      setEstructura(null);
    } catch (e) {
      toastErr(e.message);
    } finally {
      setLoadingPlantillas(false);
    }
  }

  /* ───────────────────────── Secciones CRUD ───────────────────────── */
  function resetSeccionRules(initVisibleIf) {
    setUseSimpleRulesSeccion(true);

    setSeccionRuleUI({
      enabled: false,
      parentId: "",
      when: "EQ_TRUE",
      valueText: "",
      valueList: [],
    });

    setSeccionVisibleIfText(safeStringifyJson(initVisibleIf));

    const ui = tryLoadRuleUIFromCond(initVisibleIf, true, false);
    if (ui) {
      setSeccionRuleUI({
        enabled: true,
        parentId: ui.parentId,
        when: ui.when,
        valueText: ui.valueText,
        valueList: ui.valueList,
      });
    }
  }

  function openCrearSeccion() {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    if (!plantillaSelId) return;
    setSeccionEditId(null);
    const init = {
      ...emptySeccion,
      orden: (estructura?.secciones?.length || 0) + 1,
      visible_if: null,
    };
    setSeccionForm(init);
    resetSeccionRules(init.visible_if);
    setShowSeccionModal(true);
  }

  function openEditarSeccion(sec) {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    setSeccionEditId(sec.id_seccion);
    const init = {
      titulo: sec.titulo || "",
      orden: sec.orden || 1,
      visible_if: sec.visible_if ?? null,
    };
    setSeccionForm(init);
    resetSeccionRules(init.visible_if);
    setShowSeccionModal(true);
  }

  function handleSeccionMultiSelectChange(e) {
    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
    setSeccionRuleUI((s) => ({ ...s, valueList: values }));
  }

  async function saveSeccion() {
    try {
      if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
      if (!seccionForm.titulo?.trim()) {
        toastWarn("El título es obligatorio");
        return;
      }

      // ✅ calcular visible_if de sección
      let visible_if = null;

      if (useSimpleRulesSeccion) {
        const parentTipo = selectedParentSeccion?.tipo;
        const cond = buildCondOnlyFromUI(seccionRuleUI, parentTipo);
        visible_if = cond; // null si no enabled / no parentId

        setSeccionVisibleIfText(safeStringifyJson(visible_if));
      } else {
        const visParsed = parseJsonOrNull(seccionVisibleIfText);
        if (visParsed && visParsed.__error) {
          toastWarn(`JSON inválido (visible_if sección): ${visParsed.__error}`);
          return;
        }
        visible_if = visParsed; // null si vacío
      }

      const payload = {
        titulo: seccionForm.titulo,
        orden: Number(seccionForm.orden || 1),
        visible_if,
      };

      if (seccionEditId) {
        await apiSend(`${API_URL}/informes/secciones/${seccionEditId}`, "PUT", payload);
        toastOk("Sección actualizada");
      } else {
        await apiSend(`${API_URL}/informes/plantillas/${plantillaSelId}/secciones`, "POST", payload);
        toastOk("Sección creada");
      }

      const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
      setEstructura(data);

      const secs = data?.secciones || [];
      setCollapsedBySection((prev) => {
        const next = { ...prev };
        for (const s of secs) {
          if (next[s.id_seccion] === undefined) next[s.id_seccion] = true;
        }
        return next;
      });

      setShowSeccionModal(false);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function borrarSeccion(idSeccion) {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    const r = await confirmSwal({
      title: "Eliminar sección",
      text: "Se eliminarán también las preguntas (cascade). ¿Continuar?",
      icon: "warning",
      confirmButtonText: "Eliminar",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/secciones/${idSeccion}`, "DELETE");
      toastOk("Sección eliminada");

      const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
      setEstructura(data);

      setCollapsedBySection((prev) => {
        const next = { ...prev };
        delete next[idSeccion];
        return next;
      });
    } catch (e) {
      toastErr(e.message);
    }
  }

  /* ───────────────────────── Preguntas CRUD ───────────────────────── */
  function openCrearPregunta(idSeccion) {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    setPreguntaEditId(null);
    setPreguntaSeccionId(idSeccion);

    const sec = (estructura?.secciones || []).find((s) => Number(s.id_seccion) === Number(idSeccion));
    const nextOrden = (sec?.preguntas?.length || 0) + 1;

    const init = { ...emptyPregunta, orden: nextOrden };
    setPreguntaForm(init);

    // ✅ reset reglas dependencia
    setUseSimpleRules(true);
    setRuleUI({
      enabled: false,
      parentId: "",
      when: "EQ_TRUE",
      valueText: "",
      valueList: [],
      applyVisible: true,
      applyRequired: true,
    });

    setVisibleIfText(safeStringifyJson(init.visible_if));
    setRequiredIfText(safeStringifyJson(init.required_if));

    // ✅ reset semáforo UI
    setSemaforoUI({
      selectedValues: SEMAFORO_PALETTE.map((x) => x.value),
      customLabel: "",
      customColor: "#2ECC71",
      customItems: [],
      showAdvancedJson: false,
    });

    setShowPreguntaModal(true);
    setCollapsedBySection((prev) => ({ ...prev, [idSeccion]: false }));
  }

  function openEditarPregunta(idSeccion, preg) {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    setPreguntaEditId(preg.id_pregunta);
    setPreguntaSeccionId(idSeccion);

    const init = {
      etiqueta: preg.etiqueta || "",
      tipo: preg.tipo || "texto",
      opciones_json: preg.opciones_json ?? null,
      obligatorio: !!preg.obligatorio,
      orden: preg.orden || 1,
      permite_foto: !!preg.permite_foto,
      id_unico: !!preg.id_unico,
      visible_if: preg.visible_if ?? null,
      required_if: preg.required_if ?? null,
    };

    setPreguntaForm(init);
    setVisibleIfText(safeStringifyJson(init.visible_if));
    setRequiredIfText(safeStringifyJson(init.required_if));

    const ui =
      tryLoadRuleUIFromCond(init.visible_if, true, false) || tryLoadRuleUIFromCond(init.required_if, false, true);

    if (ui) {
      setUseSimpleRules(true);
      setRuleUI(ui);
    } else {
      setUseSimpleRules(true);
      setRuleUI({
        enabled: false,
        parentId: "",
        when: "EQ_TRUE",
        valueText: "",
        valueList: [],
        applyVisible: true,
        applyRequired: true,
      });
    }

    // ✅ cargar semáforo UI desde opciones_json existente
    if (String(init.tipo).toLowerCase() === "semaforo") {
      const arr = Array.isArray(init.opciones_json) ? init.opciones_json : SEMAFORO_PALETTE;
      const defaultsSet = new Set(SEMAFORO_PALETTE.map((x) => String(x.value)));

      const selectedDefaults = (arr || [])
        .filter((o) => o && typeof o === "object" && defaultsSet.has(String(o.value)))
        .map((o) => String(o.value));

      const customItems = (arr || [])
        .filter((o) => o && typeof o === "object" && !defaultsSet.has(String(o.value)))
        .map((o) => ({
          value: String(o.value || ""),
          label: String(o.label || o.value || ""),
          color: String(o.color || ""),
        }));

      setSemaforoUI((s) => ({
        ...s,
        selectedValues: selectedDefaults.length ? selectedDefaults : SEMAFORO_PALETTE.map((x) => x.value),
        customItems,
        customLabel: "",
        customColor: "#2ECC71",
        showAdvancedJson: false,
      }));
    }

    setShowPreguntaModal(true);
    setCollapsedBySection((prev) => ({ ...prev, [idSeccion]: false }));
  }

  function parseOpciones(tipo, raw) {
    const t = (tipo || "").toLowerCase();

    if (t === "select" || t === "multiselect") {
      const lines = (raw || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines.length ? lines : null;
    }

    // semáforo ya NO se edita por JSON para usuarios (se arma desde semaforoUI)
    if (t === "semaforo") {
      if (Array.isArray(raw) && raw.length) return raw;
      return SEMAFORO_PALETTE;
    }

    return null;
  }

  async function savePregunta() {
    try {
      if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
      if (!preguntaForm.etiqueta?.trim()) {
        toastWarn("La etiqueta es obligatoria");
        return;
      }

      let visible_if = null;
      let required_if = null;

      if (useSimpleRules) {
        const parentTipo = selectedParent?.tipo;
        const built = buildPreguntaCondFromUI(ruleUI, parentTipo);
        visible_if = built.visible_if;
        required_if = built.required_if;

        setVisibleIfText(safeStringifyJson(visible_if));
        setRequiredIfText(safeStringifyJson(required_if));
      } else {
        const visParsed = parseJsonOrNull(visibleIfText);
        if (visParsed && visParsed.__error) {
          toastWarn(`JSON inválido (visible_if): ${visParsed.__error}`);
          return;
        }
        const reqParsed = parseJsonOrNull(requiredIfText);
        if (reqParsed && reqParsed.__error) {
          toastWarn(`JSON inválido (required_if): ${reqParsed.__error}`);
          return;
        }
        visible_if = visParsed;
        required_if = reqParsed;
      }

      let payload = {
        ...preguntaForm,
        visible_if,
        required_if,
      };

      // ✅ opciones_json por tipo
      if (isSemaforoTipo(payload.tipo)) {
        payload.opciones_json = buildSemaforoOpcionesFromUI({
          selectedValues: semaforoUI.selectedValues,
          customItems: semaforoUI.customItems,
        });

        // si el usuario dejó todo vacío, cae a default
        if (!payload.opciones_json?.length) payload.opciones_json = SEMAFORO_PALETTE;
      } else if (typeof payload.opciones_json === "string") {
        payload.opciones_json = parseOpciones(payload.tipo, payload.opciones_json);
      }

      // ✅ mantener opciones_json para select/multiselect/semaforo
      if (payload.tipo !== "select" && payload.tipo !== "multiselect" && payload.tipo !== "semaforo") {
        payload.opciones_json = null;
      }

      // tipo imagen => solo carga de imágenes
      if (String(payload.tipo).toLowerCase() === "imagen") {
        payload.opciones_json = null;
        payload.permite_foto = false;
      }

      if (preguntaEditId) {
        await apiSend(`${API_URL}/informes/preguntas/${preguntaEditId}`, "PUT", payload);
        toastOk("Pregunta actualizada");
      } else {
        await apiSend(`${API_URL}/informes/secciones/${preguntaSeccionId}/preguntas`, "POST", payload);
        toastOk("Pregunta creada");
      }

      const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
      setEstructura(data);
      setShowPreguntaModal(false);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function borrarPregunta(idPregunta) {
    if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
    const r = await confirmSwal({
      title: "Eliminar pregunta",
      text: "¿Seguro?",
      icon: "warning",
      confirmButtonText: "Eliminar",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/preguntas/${idPregunta}`, "DELETE");
      toastOk("Pregunta eliminada");
      const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
      setEstructura(data);
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function moverPregunta(idPregunta, payload) {
    try {
      if (!canEditSelected) return toastWarn("Solo lectura: no tenés permiso para editar.");
      await apiSend(`${API_URL}/informes/preguntas/${idPregunta}/mover`, "PUT", payload);
      const data = await apiGet(`${API_URL}/informes/plantillas/${plantillaSelId}`);
      setEstructura(data);
    } catch (e) {
      toastErr(e.message);
    }
  }

  /* ───────────────────────── Share Links ───────────────────────── */
  async function onCreateShareLink() {
    if (!plantillaSelId) {
      toastWarn("Seleccioná una plantilla primero");
      return;
    }

    if (!shareForm.id_proyecto) {
      toastWarn("Debés seleccionar un proyecto antes de crear el link");
      return;
    }

    if (!shareForm.expira_en_local) {
      toastWarn("Elegí una fecha/hora de expiración");
      return;
    }

    const exp = new Date(shareForm.expira_en_local);
    if (Number.isNaN(exp.getTime())) {
      toastWarn("La fecha de expiración no es válida");
      return;
    }
    if (exp.getTime() <= Date.now()) {
      toastWarn("La expiración debe ser en el futuro");
      return;
    }

    setShareLoading(true);
    setPublicUrl("");
    try {
      const payload = {
        id_plantilla: Number(plantillaSelId),
        id_proyecto: Number(shareForm.id_proyecto), // ← ahora obligatorio
        titulo: shareForm.titulo?.trim() ? shareForm.titulo.trim() : null,
        expira_en: exp.toISOString(),
        max_envios: shareForm.max_envios ? Number(shareForm.max_envios) : null,
      };

      const data = await apiSend(`${API_URL}/informes/share-links`, "POST", payload);

      const url = normalizeUrl(data?.publicUrl || "");
      setPublicUrl(url);

      await refreshShareLinks(plantillaSelId);
      toastOk("Link creado");
    } catch (e) {
      toastErr(e.message);
    } finally {
      setShareLoading(false);
    }
  }

  async function onCloseShareLink(idShare) {
    const r = await confirmSwal({
      title: "Cerrar link",
      text: "Una vez cerrado, ya no se podrá acceder.",
      icon: "warning",
      confirmButtonText: "Cerrar",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/share-links/${idShare}/cerrar`, "PUT");
      await refreshShareLinks(plantillaSelId);
      toastOk("Link cerrado");
    } catch (e) {
      toastErr(e.message);
    }
  }

  async function onDeleteShareLink(idShare) {
    const r = await confirmSwal({
      title: "Eliminar link",
      html: `
        <div style="text-align:left">
          <p>Esto borrará el link definitivamente.</p>
          <p class="mb-0"><b>No</b> se podrá recuperar.</p>
        </div>
      `,
      icon: "warning",
      confirmButtonText: "Sí, eliminar",
      confirmButtonColor: "#d33",
    });
    if (!r.isConfirmed) return;

    try {
      await apiSend(`${API_URL}/informes/share-links/${idShare}`, "DELETE");
      toastOk("Link eliminado");
      await refreshShareLinks(plantillaSelId);
    } catch (e) {
      toastErr(e.message);
    }
  }

  function setExpInMonths(m) {
    const d = addMonths(new Date(), m);
    setShareForm((s) => ({ ...s, expira_en_local: toDatetimeLocalValue(d) }));
  }

  function handleMultiSelectChange(e) {
    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
    setRuleUI((s) => ({ ...s, valueList: values }));
  }

  function openEditarShareLink(link) {
    if (!link) return;

    setEditingShareId(link.id_share || link.id || null);
    setEditShareForm({
      id_proyecto: link.id_proyecto ? String(link.id_proyecto) : "",
      titulo: link.titulo || "",
      expira_en_local: link.expira_en ? toDatetimeLocalValue(link.expira_en) : defaultExp,
      max_envios:
        link.max_envios === null || link.max_envios === undefined
          ? ""
          : String(link.max_envios),
    });
    setShowEditShareModal(true);
  }

  async function onUpdateShareLink() {
    if (!editingShareId) {
      toastWarn("No hay link seleccionado para editar");
      return;
    }

    if (!editShareForm.id_proyecto) {
      toastWarn("Debés seleccionar un proyecto");
      return;
    }

    if (!editShareForm.expira_en_local) {
      toastWarn("Elegí una fecha/hora de expiración");
      return;
    }

    const exp = new Date(editShareForm.expira_en_local);
    if (Number.isNaN(exp.getTime())) {
      toastWarn("La fecha de expiración no es válida");
      return;
    }

    if (exp.getTime() <= Date.now()) {
      toastWarn("La expiración debe ser en el futuro");
      return;
    }

    try {
      setShareLoading(true);

      await apiSend(`${API_URL}/informes/share-links/${editingShareId}`, "PUT", {
        id_proyecto: Number(editShareForm.id_proyecto),
        titulo: editShareForm.titulo?.trim() ? editShareForm.titulo.trim() : null,
        expira_en: exp.toISOString(),
        max_envios: editShareForm.max_envios
          ? Number(editShareForm.max_envios)
          : null,
      });

      toastOk("Link actualizado");
      setShowEditShareModal(false);
      setEditingShareId(null);
      await refreshShareLinks(plantillaSelId);
    } catch (e) {
      toastErr(e.message);
    } finally {
      setShareLoading(false);
    }
  }

  /* ───────────────────────── Render ───────────────────────── */
  return (
    <>
      <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0">Informe Builder</h4>
          <div className="text-muted">Plantillas • Secciones • Preguntas • Links públicos</div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="primary" onClick={openCrearPlantilla}>
            + Nueva Plantilla
          </Button>
        </div>
      </div>

      <div className="row g-3">
        {/* Columna izquierda */}
        <div className="col-md-4 col-lg-3">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <b>Plantillas</b>
              {loadingPlantillas ? <Spinner size="sm" /> : null}
            </div>

            <div className="card-body p-2">
              <div className="mb-2">
                <Form.Control
                  size="sm"
                  type="text"
                  placeholder="Buscar plantilla por nombre, descripción, estado o ID..."
                  value={plantillaSearch}
                  onChange={(e) => setPlantillaSearch(e.target.value)}
                />
              </div>

              <div className="d-flex justify-content-between align-items-center mb-2 small text-muted">
                <span>
                  {plantillasFiltradas.length} plantilla{plantillasFiltradas.length === 1 ? "" : "s"}
                </span>
                <span>
                  Página {plantillasPage} / {totalPlantillasPages}
                </span>
              </div>

              {loadingPlantillas ? (
                <div className="p-3 text-muted">Cargando...</div>
              ) : (
                <>
                  <div className="list-group">
                    {plantillasPaginadas.map((p) => {
                      const selected = Number(p.id_plantilla) === Number(plantillaSelId);

                      return (
                        <div
                          key={p.id_plantilla}
                          className={`list-group-item p-0 border rounded mb-2 overflow-hidden ${
                            selected ? "border-primary shadow-sm" : ""
                          }`}
                        >
                          <button
                            className={`btn w-100 text-start border-0 rounded-0 d-flex justify-content-between align-items-center ${
                              selected ? "btn-primary" : "btn-light"
                            }`}
                            onClick={() => setPlantillaSelId(p.id_plantilla)}
                            type="button"
                          >
                            <div className="me-2">
                              <div className="fw-semibold">{p.nombre}</div>
                              <div className={`small ${selected ? "text-white-50" : "text-muted"}`}>
                                {p.descripcion || "—"}
                              </div>
                            </div>

                            <div className="d-flex gap-2 align-items-center">
                              <Badge bg={p.activo ? "success" : "secondary"}>
                                {p.activo ? "Activa" : "Inactiva"}
                              </Badge>
                            </div>
                          </button>

                          {selected && (
                            <div className="p-2 bg-white border-top">
                              <div className="d-flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={() => openEditarPlantilla(p)}
                                >
                                  Editar
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => setShowDuplicarModal(true)}
                                >
                                  Copiar plantilla
                                </Button>

                                <Button
                                  size="sm"
                                  variant={p.activo ? "warning" : "success"}
                                  onClick={() => toggleActivaPlantilla(p)}
                                >
                                  {p.activo ? "Desactivar" : "Activar"}
                                </Button>

                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={openCompartirModal}
                                  title="Compartir esta plantilla con otros usuarios"
                                >
                                  Compartir
                                </Button>

                                {canDeletePlantilla(p) && (
                                  <Button
                                    size="sm"
                                    variant="outline-danger"
                                    onClick={() => eliminarDefinitivoPlantilla(p.id_plantilla)}
                                    title="Borra plantilla + secciones + preguntas + links + informes + respuestas + fotos"
                                  >
                                    Eliminar definitivo
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!plantillasPaginadas.length ? (
                    <div className="p-3 text-muted">Sin plantillas.</div>
                  ) : null}

                  {plantillasFiltradas.length > 0 && (
                    <div className="d-flex justify-content-between align-items-center mt-3 gap-2">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={plantillasPage <= 1}
                        onClick={() => setPlantillasPage((prev) => Math.max(1, prev - 1))}
                      >
                        Anterior
                      </Button>

                      <div className="small text-muted text-center flex-grow-1">
                        Mostrando{" "}
                        {Math.min(
                          (plantillasPage - 1) * PLANTILLAS_PER_PAGE + 1,
                          plantillasFiltradas.length
                        )}{" "}
                        a{" "}
                        {Math.min(
                          plantillasPage * PLANTILLAS_PER_PAGE,
                          plantillasFiltradas.length
                        )}{" "}
                        de {plantillasFiltradas.length}
                      </div>

                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={plantillasPage >= totalPlantillasPages}
                        onClick={() =>
                          setPlantillasPage((prev) =>
                            Math.min(totalPlantillasPages, prev + 1)
                          )
                        }
                      >
                        Siguiente
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Columna derecha */}
        <div className="col-md-8 col-lg-9">
          {!plantillaSelId ? (
            <Alert variant="info">Seleccioná una plantilla para editar secciones/preguntas y generar links públicos.</Alert>
          ) : loadingEstructura ? (
            <div className="card">
              <div className="card-body">
                <Spinner /> Cargando estructura...
              </div>
            </div>
          ) : (
            <>            
            {/* importación de respuestas */}
            <div className="card mb-3">
              <div className="card-header d-flex align-items-center justify-content-between">
                <b>Importación</b>
                <Button
                  variant="outline-primary"
                  onClick={() => setShowImportModal(true)}
                  disabled={!plantillaSelId || !preguntasLista.length}
                  title={!plantillaSelId ? "Seleccioná una plantilla" : (!preguntasLista.length ? "La plantilla no tiene preguntas" : "")}
                >
                  Importar respuestas (Excel)
                </Button>
                <Button
                  variant="outline-info"
                  onClick={() => setShowNewImportModal(true)}
                  disabled={!plantillaSelId}
                  title={!plantillaSelId ? "Seleccioná una plantilla" : "Canal nuevo de importación XLSX"}
                >
                  Importación nueva (XLSX)
                </Button>
              </div>
              <div className="card-body text-muted">
                Importá respuestas masivamente desde Excel con vista previa y mapeo automático de columnas.                
              </div>
            </div>

            {/* ESTRUCTURA */}
              <div className="card mb-3">
                <div className="card-header d-flex align-items-center justify-content-between">
                  <b>Estructura</b>
                  <Button size="sm" variant="success" onClick={openCrearSeccion}>
                    + Sección
                  </Button>
                </div>

                <div className="card-body">
                  {(estructura?.secciones || []).length === 0 ? (
                    <div className="text-muted">No hay secciones. Creá la primera.</div>
                  ) : (
                    (estructura?.secciones || [])
                      .slice()
                      .sort((a, b) => (a.orden || 0) - (b.orden || 0))
                      .map((sec) => {
                        const collapsed = !!collapsedBySection[sec.id_seccion];
                        return (
                          <div key={sec.id_seccion} className="border rounded p-2 mb-3">
                            <div className="d-flex align-items-center justify-content-between">
                              <div
                                className="d-flex align-items-center gap-2"
                                style={{ cursor: "pointer", userSelect: "none" }}
                                onClick={() => toggleSection(sec.id_seccion)}
                                title={collapsed ? "Mostrar preguntas" : "Ocultar preguntas"}
                              >
                                <div className="fw-semibold">
                                  {sec.orden}. {sec.titulo}
                                </div>

                                <Badge bg="secondary">{sec?.preguntas?.length || 0} preguntas</Badge>

                                {sec.visible_if ? (
                                  <Badge bg="info" title="Esta sección se muestra según condición (visible_if)">
                                    Visible_if (Sección)
                                  </Badge>
                                ) : null}

                                <span className="ms-1">{collapsed ? "▸" : "▾"}</span>
                              </div>

                              <div className="d-flex gap-2">
                                <Button size="sm" variant="outline-primary" onClick={() => openCrearPregunta(sec.id_seccion)}>
                                  + Pregunta
                                </Button>
                                <Button size="sm" variant="outline-secondary" onClick={() => openEditarSeccion(sec)}>
                                  Editar
                                </Button>
                                <Button size="sm" variant="outline-danger" onClick={() => borrarSeccion(sec.id_seccion)}>
                                  Eliminar
                                </Button>
                              </div>
                            </div>

                            {!collapsed && (
                              <div className="mt-2">
                                {!sec.preguntas?.length ? (
                                  <div className="text-muted small">Sin preguntas.</div>
                                ) : (
                                  <Table bordered hover size="sm" className="mb-0">
                                    <thead>
                                      <tr>
                                        <th style={{ width: 80 }}>Orden</th>
                                        <th>Etiqueta</th>
                                        <th style={{ width: 160 }}>Tipo</th>
                                        <th style={{ width: 120 }}>Oblig.</th>
                                        <th style={{ width: 120 }}>Foto</th>
                                        <th style={{ width: 220 }} className="text-end">
                                          Acciones
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sec.preguntas
                                        .slice()
                                        .sort((a, b) => (a.orden || 0) - (b.orden || 0))
                                        .map((preg, idx, arr) => {
                                          const optVals = optionValuesFromOpcionesJson(preg.opciones_json);
                                          return (
                                            <tr key={preg.id_pregunta}>
                                              <td>{preg.orden}</td>
                                              <td>
                                                <div className="fw-semibold">{preg.etiqueta}</div>

                                                <div className="mt-1 d-flex flex-wrap gap-1">
                                                  {preg.visible_if ? <Badge bg="info">Visible_if</Badge> : null}
                                                  {preg.required_if ? (
                                                    <Badge bg="warning" text="dark">
                                                      Required_if
                                                    </Badge>
                                                  ) : null}
                                                  {preg.id_unico ? <Badge bg="dark">ID único</Badge> : null}
                                                </div>

                                                {(isSelectLikeTipo(preg.tipo) || isMultiTipo(preg.tipo)) && preg.opciones_json ? (
                                                  <div className="small text-muted">
                                                    Opciones: {optVals.length ? optVals.join(" | ") : "(json)"}
                                                  </div>
                                                ) : null}
                                              </td>
                                              <td>{tiposLabel[preg.tipo] || preg.tipo}</td>
                                              <td>{preg.obligatorio ? "Sí" : "No"}</td>
                                              <td>{preg.permite_foto ? "Sí" : "No"}</td>
                                              <td className="text-end">
                                                <div className="btn-group btn-group-sm">
                                                  <Button
                                                    variant="outline-secondary"
                                                    disabled={idx === 0}
                                                    onClick={() =>
                                                      moverPregunta(preg.id_pregunta, {
                                                        to_seccion_id: sec.id_seccion,
                                                        to_orden: idx,
                                                      })
                                                    }
                                                  >
                                                    ↑
                                                  </Button>

                                                  <Button
                                                    variant="outline-secondary"
                                                    disabled={idx === arr.length - 1}
                                                    onClick={() =>
                                                      moverPregunta(preg.id_pregunta, {
                                                        to_seccion_id: sec.id_seccion,
                                                        to_orden: idx + 2,
                                                      })
                                                    }
                                                  >
                                                    ↓
                                                  </Button>

                                                  <Button
                                                    variant="outline-secondary"
                                                    onClick={() => openEditarPregunta(sec.id_seccion, preg)}
                                                  >
                                                    Editar
                                                  </Button>

                                                  <Button variant="outline-danger" onClick={() => borrarPregunta(preg.id_pregunta)}>
                                                    Eliminar
                                                  </Button>
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                    </tbody>
                                  </Table>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              {/* SHARE LINK */}
              <div className="card">
                <div className="card-header d-flex align-items-center justify-content-between">
                  <b>Link público</b>
                  {publicUrl ? (
                    <Button size="sm" variant="outline-primary" onClick={() => copyToClipboard(publicUrl)}>
                      Copiar URL
                    </Button>
                  ) : null}
                </div>

                <div className="card-body">
                  <div className="row g-2">
                    <div className="col-md-4">
                      <Form.Label>Proyecto</Form.Label>
                      <Form.Select
                        value={shareForm.id_proyecto ?? ""}
                        onChange={(e) => setShareForm((s) => ({ ...s, id_proyecto: e.target.value }))}
                      >
                        <option value="">Seleccione un proyecto</option>
                        {(proyectos || []).map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.codigo ? `${p.codigo} - ` : ""}
                            {p.nombre || `Proyecto #${p.id}`}
                          </option>
                        ))}
                      </Form.Select>

                      <div className="small text-muted mt-1">
                        El link guardará ese <b>id_proyecto</b> al crear el informe público.
                      </div>
                    </div>

                    <div className="col-md-4">
                      <Form.Label>Título (opcional)</Form.Label>
                      <Form.Control value={shareForm.titulo} onChange={(e) => setShareForm((s) => ({ ...s, titulo: e.target.value }))} />
                    </div>

                    <div className="col-md-3">
                      <Form.Label>Expira en</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        value={shareForm.expira_en_local}
                        onChange={(e) => setShareForm((s) => ({ ...s, expira_en_local: e.target.value }))}
                      />
                      <div className="d-flex gap-2 mt-2">
                        <Button size="sm" variant="outline-secondary" onClick={() => setExpInMonths(1)}>
                          +1 mes
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => setExpInMonths(3)}>
                          +3 meses
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => setExpInMonths(6)}>
                          +6 meses
                        </Button>
                      </div>
                    </div>

                    <div className="col-md-1">
                      <Form.Label>Máx</Form.Label>
                      <Form.Control
                        type="number"
                        value={shareForm.max_envios}
                        placeholder="∞"
                        onChange={(e) => setShareForm((s) => ({ ...s, max_envios: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="mt-3 d-flex gap-2">
                    <Button variant="success" onClick={onCreateShareLink} disabled={shareLoading}>
                      {shareLoading ? "Creando..." : "Crear link"}
                    </Button>

                    {publicUrl ? (
                      <>
                        <Button variant="outline-secondary" onClick={() => openUrl(publicUrl)}>
                          Abrir
                        </Button>

                        <Button variant="outline-dark" onClick={() => openQrForUrl(publicUrl)}>
                          QR
                        </Button>
                      </>
                    ) : null}
                  </div>

                  {publicUrl ? (
                    <Alert variant="info" className="mt-3 mb-0">
                      <div>
                        <b>URL pública:</b>
                      </div>
                      <div style={{ wordBreak: "break-all" }}>{publicUrl}</div>
                    </Alert>
                  ) : null}
                </div>

                <div className="card-footer">
                  <b>Links existentes</b>
                  <div className="table-responsive mt-2">
                    <Table bordered hover size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Proyecto</th>
                          <th>Título</th>
                          <th>Expira</th>
                          <th>Envíos</th>
                          <th>Estado</th>
                          <th className="text-end">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(shareLinks || []).map((l) => {
                          const url = normalizeUrl(l.publicUrl || l.public_url || "");
                          return (
                            <tr key={l.id_share}>
                              <td>{l.id_share}</td>
                              <td title={proyectoLabel(l.id_proyecto)}>
                                {proyectoLabel(l.id_proyecto)}
                              </td>
                              <td>{l.titulo ?? "-"}</td>
                              <td>{l.expira_en ? new Date(l.expira_en).toLocaleString() : "-"}</td>
                              <td>
                                {l.envios_count ?? 0}
                                {l.max_envios != null ? ` / ${l.max_envios}` : ""}
                              </td>
                              <td>
                                {l.cerrado_en ? (
                                  <Badge bg="secondary">Cerrado</Badge>
                                ) : (
                                  <Badge bg="success">Abierto</Badge>
                                )}
                              </td>
                              <td className="text-end">
                                <div className="btn-group btn-group-sm">
                                  <Button
                                    variant="outline-primary"
                                    disabled={!url}
                                    onClick={() => copyToClipboard(url)}
                                  >
                                    Copiar
                                  </Button>

                                  <Button
                                    variant="outline-secondary"
                                    disabled={!url}
                                    onClick={() => openUrl(url)}
                                  >
                                    Abrir
                                  </Button>

                                  <Button
                                    variant="outline-dark"
                                    disabled={!url}
                                    onClick={() => openQrForUrl(url)}
                                  >
                                    QR
                                  </Button>

                                  {!l.cerrado_en ? (
                                    <Button
                                      size="sm"
                                      variant="outline-danger"
                                      onClick={() => onCloseShareLink(l.id_share)}
                                    >
                                      Cerrar
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline-secondary" disabled>
                                      Cerrado
                                    </Button>
                                  )}

                                  <Button
                                    size="sm"
                                    variant="outline-primary"
                                    onClick={() => openEditarShareLink(l)}
                                    disabled={!!l.cerrado_en}
                                  >
                                    Editar
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => onDeleteShareLink(l.id_share)}
                                  >
                                    Eliminar
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        {!shareLinks?.length ? (
                          <tr>
                            <td colSpan={7} className="text-muted">
                              Sin links aún.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </Table>
                  </div>
                </div>
              </div>

            </>
          )}
        </div>
      </div>
    </div>

      {/* ✅ MODAL SECCIÓN - FUERA DEL CONDICIONAL */}
      <Modal show={showSeccionModal} onHide={() => setShowSeccionModal(false)} centered size="lg">
                <Modal.Header closeButton>
                  <Modal.Title>{seccionEditId ? "Editar sección" : "Nueva sección"}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  <div className="row g-2">
                    <div className="col-md-8">
                      <Form.Label>Título</Form.Label>
                      <Form.Control value={seccionForm.titulo} onChange={(e) => setSeccionForm((s) => ({ ...s, titulo: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <Form.Label>Orden</Form.Label>
                      <Form.Control
                        type="number"
                        value={seccionForm.orden}
                        onChange={(e) => setSeccionForm((s) => ({ ...s, orden: Number(e.target.value || 1) }))}
                      />
                    </div>
                  </div>

                  <hr className="my-3" />

                  <div className="d-flex align-items-center justify-content-between">
                    <div className="fw-semibold">Dependencia de sección (opcional)</div>
                    <Form.Check
                      type="switch"
                      label={useSimpleRulesSeccion ? "Modo simple" : "Modo avanzado"}
                      checked={useSimpleRulesSeccion}
                      onChange={(e) => setUseSimpleRulesSeccion(e.target.checked)}
                    />
                  </div>

                  {useSimpleRulesSeccion ? (
                    <div className="mt-2">
                      <Form.Check
                        type="checkbox"
                        label="Esta sección depende de una pregunta"
                        checked={seccionRuleUI.enabled}
                        onChange={(e) => {
                          const en = e.target.checked;
                          setSeccionRuleUI((s) => ({
                            ...s,
                            enabled: en,
                            ...(en ? {} : { parentId: "", when: "EQ_TRUE", valueText: "", valueList: [] }),
                          }));
                          if (!en) setSeccionVisibleIfText("");
                        }}
                      />

                      {seccionRuleUI.enabled ? (
                        <div className="row g-2 mt-1">
                          <div className="col-md-6">
                            <Form.Label>Pregunta padre</Form.Label>
                            <Form.Select value={seccionRuleUI.parentId} onChange={(e) => setSeccionRuleUI((s) => ({ ...s, parentId: e.target.value }))}>
                              <option value="">Seleccionar...</option>

                              {/* ✅ NO incluir preguntas de la misma sección cuando se edita una sección */}
                              {preguntasParaPadreSeccion.map((p) => (
                                <option key={p.id_pregunta} value={String(p.id_pregunta)}>
                                  #{p.id_pregunta} — {p.etiqueta} ({tiposLabel[p.tipo] || p.tipo})
                                </option>
                              ))}
                            </Form.Select>
                            <div className="small text-muted mt-1">Elegí la pregunta que controla la visibilidad.</div>
                          </div>

                          <div className="col-md-6">
                            <Form.Label>Condición</Form.Label>
                            <Form.Select
                              value={seccionRuleUI.when}
                              onChange={(e) =>
                                setSeccionRuleUI((s) => ({
                                  ...s,
                                  when: e.target.value,
                                  valueText: e.target.value === "EQ_VALUE" ? s.valueText : "",
                                  valueList: e.target.value === "IN_VALUE" ? s.valueList || [] : [],
                                }))
                              }
                              disabled={!seccionRuleUI.parentId}
                            >
                              {allowedWhensSeccion.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Form.Select>

                            {seccionRuleUI.when === "EQ_VALUE" || seccionRuleUI.when === "IN_VALUE" ? (
                              <>
                                {(() => {
                                  const parentTipo = String(selectedParentSeccion?.tipo || "").toLowerCase();
                                  const opts = optionValuesFromOpcionesJson(selectedParentSeccion?.opciones_json);

                                  // IN_VALUE con select-like (incluye semaforo) => multiple
                                  if (isSelectLikeTipo(parentTipo) && seccionRuleUI.when === "IN_VALUE") {
                                    return (
                                      <Form.Select className="mt-2" multiple value={seccionRuleUI.valueList} onChange={handleSeccionMultiSelectChange}>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  // EQ_VALUE con select-like (incluye semaforo) => single select
                                  if (isSelectLikeTipo(parentTipo) && seccionRuleUI.when === "EQ_VALUE") {
                                    return (
                                      <Form.Select
                                        className="mt-2"
                                        value={seccionRuleUI.valueText}
                                        onChange={(e) => setSeccionRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      >
                                        <option value="">Seleccionar valor…</option>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  // multiselect (incluye IN_VALUE) => single selector para "incluye"
                                  if (parentTipo === "multiselect") {
                                    return (
                                      <Form.Select
                                        className="mt-2"
                                        value={seccionRuleUI.valueText}
                                        onChange={(e) => setSeccionRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      >
                                        <option value="">Seleccionar opción…</option>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  if (parentTipo === "numero") {
                                    return (
                                      <Form.Control
                                        className="mt-2"
                                        type="number"
                                        placeholder="Número exacto"
                                        value={seccionRuleUI.valueText}
                                        onChange={(e) => setSeccionRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      />
                                    );
                                  }

                                  return (
                                    <Form.Control
                                      className="mt-2"
                                      placeholder="Valor exacto"
                                      value={seccionRuleUI.valueText}
                                      onChange={(e) => setSeccionRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                    />
                                  );
                                })()}

                                {seccionRuleUI.when === "IN_VALUE" && isSelectLikeTipo(String(selectedParentSeccion?.tipo || "").toLowerCase()) ? (
                                  <div className="small text-muted mt-1">
                                    Podés seleccionar <b>varias</b> respuestas. Con Ctrl/Shift.
                                  </div>
                                ) : null}
                              </>
                            ) : null}

                            {seccionRuleUI.parentId ? (
                              <div className="small text-muted mt-1">
                                Tipo padre: <b>{tiposLabel[selectedParentSeccion?.tipo] || selectedParentSeccion?.tipo || "-"}</b>
                              </div>
                            ) : (
                              <div className="small text-muted mt-1">Seleccioná una pregunta padre para habilitar condiciones.</div>
                            )}
                          </div>

                          <div className="col-12">
                            <Alert variant="info" className="mb-0">
                              Esta sección se mostrará <b>solo si</b> se cumple la condición. Si no, se oculta completa.
                            </Alert>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="row g-2 mt-2">
                        <div className="col-12">
                          <Form.Label>
                            Visible si (JSON) <span className="text-muted">(opcional)</span>
                          </Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={7}
                            value={seccionVisibleIfText}
                            onChange={(e) => setSeccionVisibleIfText(e.target.value)}
                            placeholder={`Ej:
                            {
                              "id_pregunta": 123,
                              "op": "eq",
                              "value": true
                            }`}
                          />
                          <div className="small text-muted mt-1">Si se cumple, la sección se muestra. Si no, la sección se oculta completa.</div>
                        </div>
                      </div>

                      <Alert variant="secondary" className="mt-3 mb-0">
                        <div className="fw-semibold mb-1">Tips rápidos</div>
                        <div className="small">
                          <div>
                            <code>op</code> soporta: <code>eq</code>, <code>neq</code>, <code>in</code>, <code>not_in</code>,{" "}
                            <code>truthy</code>, <code>falsy</code>
                          </div>
                          <div>
                            Compuesto: <code>{"{ all: [ ... ] }"}</code> o <code>{"{ any: [ ... ] }"}</code>
                          </div>
                        </div>
                      </Alert>
                    </>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onClick={() => setShowSeccionModal(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={saveSeccion}>
                    Guardar
                  </Button>
                </Modal.Footer>
              </Modal>

              {/* MODAL PREGUNTA */}
              <Modal show={showPreguntaModal} onHide={() => setShowPreguntaModal(false)} centered size="lg">
                <Modal.Header closeButton>
                  <Modal.Title>{preguntaEditId ? "Editar pregunta" : "Nueva pregunta"}</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                  <div className="row g-2">
                    <div className="col-md-8">
                      <Form.Label>Etiqueta</Form.Label>
                      <Form.Control value={preguntaForm.etiqueta} onChange={(e) => setPreguntaForm((s) => ({ ...s, etiqueta: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <Form.Label>Tipo</Form.Label>
                      <Form.Select value={preguntaForm.tipo} onChange={(e) => setPreguntaForm((s) => ({ ...s, tipo: e.target.value }))}>
                        <option value="texto">Texto</option>
                        <option value="numero">Número</option>
                        <option value="fecha">Fecha</option>
                        <option value="si_no">Sí/No</option>
                        <option value="select">Opción única</option>
                        <option value="multiselect">Opción múltiple</option>
                        <option value="semaforo">Semáforo (color)</option>
                        <option value="coordenada">Coordenadas</option>
                        <option value="imagen">Imagen</option>
                      </Form.Select>
                    </div>
                  </div>

                  <div className="row g-2 mt-1">
                    <div className="col-md-2">
                      <Form.Label>Orden</Form.Label>
                      <Form.Control
                        type="number"
                        value={preguntaForm.orden}
                        onChange={(e) =>
                          setPreguntaForm((s) => ({
                            ...s,
                            orden: Number(e.target.value || 1),
                          }))
                        }
                      />
                    </div>

                    <div className="col-md-3 d-flex align-items-end">
                      <Form.Check
                        type="checkbox"
                        label="Obligatorio"
                        checked={!!preguntaForm.obligatorio}
                        onChange={(e) =>
                          setPreguntaForm((s) => ({
                            ...s,
                            obligatorio: e.target.checked,
                          }))
                        }
                      />
                    </div>

                    <div className="col-md-3 d-flex align-items-end">
                      <Form.Check
                        type="checkbox"
                        label="ID único"
                        checked={!!preguntaForm.id_unico}
                        onChange={(e) =>
                          setPreguntaForm((s) => ({
                            ...s,
                            id_unico: e.target.checked,
                          }))
                        }
                      />
                    </div>

                    <div className="col-md-4 d-flex align-items-end">
                      {String(preguntaForm.tipo).toLowerCase() !== "imagen" ? (
                        <Form.Check
                          type="checkbox"
                          label="Permite foto"
                          checked={!!preguntaForm.permite_foto}
                          onChange={(e) =>
                            setPreguntaForm((s) => ({
                              ...s,
                              permite_foto: e.target.checked,
                            }))
                          }
                        />
                      ) : (
                        <div className="text-muted small">
                          Tipo <b>Imagen</b>: esta pregunta ya es solo para adjuntar imágenes.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ✅ Opciones por tipo */}
                  {(preguntaForm.tipo === "select" || preguntaForm.tipo === "multiselect" || preguntaForm.tipo === "semaforo") ? (
                    <>
                      {String(preguntaForm.tipo).toLowerCase() === "semaforo" ? (
                        <>
                          <Form.Label className="mt-3">Semáforo: colores disponibles</Form.Label>

                          <div className="d-flex gap-2 flex-wrap mb-2">
                            <Button size="sm" variant="outline-secondary" onClick={() => setSemaforoUI((s) => ({ ...s, selectedValues: SEMAFORO_PALETTE.map((x) => x.value) }))}>
                              Seleccionar todos
                            </Button>
                            <Button size="sm" variant="outline-secondary" onClick={() => setSemaforoUI((s) => ({ ...s, selectedValues: [] }))}>
                              Ninguno
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() =>
                                setSemaforoUI((s) => ({
                                  ...s,
                                  selectedValues: SEMAFORO_PALETTE.map((x) => x.value),
                                  customItems: [],
                                  customLabel: "",
                                  customColor: "#2ECC71",
                                }))
                              }
                            >
                              Reset default
                            </Button>
                          </div>

                          <div className="row g-2">
                            {SEMAFORO_PALETTE.map((opt) => {
                              const checked = semaforoUI.selectedValues.includes(opt.value);
                              return (
                                <div className="col-12 col-md-6" key={opt.value}>
                                  <div className="border rounded p-2 d-flex align-items-center justify-content-between">
                                    <Form.Check
                                      type="checkbox"
                                      id={`sem-${opt.value}`}
                                      label={opt.label}
                                      checked={checked}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setSemaforoUI((s) => {
                                          const set = new Set(s.selectedValues);
                                          if (on) set.add(opt.value);
                                          else set.delete(opt.value);
                                          return { ...s, selectedValues: Array.from(set) };
                                        });
                                      }}
                                    />

                                    <div className="d-flex align-items-center gap-2">
                                      <span className="small text-muted">{opt.color}</span>
                                      <span
                                        title={opt.color}
                                        style={{
                                          width: 22,
                                          height: 22,
                                          borderRadius: 6,
                                          border: "1px solid rgba(0,0,0,.15)",
                                          background: opt.color,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <hr className="my-3" />

                          <Form.Label>Agregar color personalizado</Form.Label>
                          <div className="row g-2 align-items-end">
                            <div className="col-md-6">
                              <Form.Label className="small text-muted mb-1">Título</Form.Label>
                              <Form.Control
                                value={semaforoUI.customLabel}
                                placeholder="Ej: Riesgo Alto"
                                onChange={(e) => setSemaforoUI((s) => ({ ...s, customLabel: e.target.value }))}
                              />
                            </div>

                            <div className="col-md-3">
                              <Form.Label className="small text-muted mb-1">Color</Form.Label>
                              <Form.Control
                                type="color"
                                value={semaforoUI.customColor}
                                onChange={(e) => setSemaforoUI((s) => ({ ...s, customColor: e.target.value }))}
                                style={{ height: 38 }}
                              />
                            </div>

                            <div className="col-md-3">
                              <Button
                                className="w-100"
                                variant="primary"
                                onClick={() => {
                                  const label = String(semaforoUI.customLabel || "").trim();
                                  const color = normalizeHexColor(semaforoUI.customColor);
                                  if (!label) return toastWarn("Escribí un título para el color personalizado.");
                                  if (!color) return toastWarn("Color inválido. Usá formato #RRGGBB.");

                                  setSemaforoUI((s) => ({
                                    ...s,
                                    customItems: [...s.customItems, { value: slugifyValue(label), label, color }],
                                    customLabel: "",
                                  }));
                                }}
                              >
                                Agregar
                              </Button>
                            </div>
                          </div>

                          {semaforoUI.customItems?.length ? (
                            <div className="mt-2">
                              <div className="small text-muted mb-1">Personalizados:</div>
                              <div className="d-flex flex-wrap gap-2">
                                {semaforoUI.customItems.map((c, idx) => (
                                  <span
                                    key={`${c.value}-${idx}`}
                                    className="badge text-bg-light border d-inline-flex align-items-center gap-2"
                                  >
                                    <span
                                      style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: 4,
                                        border: "1px solid rgba(0,0,0,.15)",
                                        background: c.color,
                                        display: "inline-block",
                                      }}
                                    />
                                    {c.label}
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-danger py-0 px-1"
                                      onClick={() =>
                                        setSemaforoUI((s) => ({
                                          ...s,
                                          customItems: s.customItems.filter((_, i) => i !== idx),
                                        }))
                                      }
                                      title="Quitar"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="mt-3">
                            <Form.Check
                              type="switch"
                              label="Mostrar edición avanzada (JSON)"
                              checked={!!semaforoUI.showAdvancedJson}
                              onChange={(e) => setSemaforoUI((s) => ({ ...s, showAdvancedJson: e.target.checked }))}
                            />

                            {semaforoUI.showAdvancedJson ? (
                              <>
                                <Form.Control
                                  className="mt-2"
                                  as="textarea"
                                  rows={8}
                                  value={safeStringifyJson(
                                    buildSemaforoOpcionesFromUI({
                                      selectedValues: semaforoUI.selectedValues,
                                      customItems: semaforoUI.customItems,
                                    })
                                  )}
                                  readOnly
                                />
                                <div className="small text-muted mt-1">
                                  Esto se guarda como <code>opciones_json</code> (jsonb).
                                </div>
                              </>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <Form.Label className="mt-3">Opciones (una por línea)</Form.Label>

                          <Form.Control
                            as="textarea"
                            rows={5}
                            value={
                              Array.isArray(preguntaForm.opciones_json)
                                ? preguntaForm.opciones_json.join("\n")
                                : preguntaForm.opciones_json || ""
                            }
                            onChange={(e) => setPreguntaForm((s) => ({ ...s, opciones_json: e.target.value }))}
                            placeholder={"Ej:\nOpción 1\nOpción 2\nOpción 3"}
                          />

                          <div className="small text-muted mt-1">
                            Se guardará como <code>jsonb</code> array en <code>opciones_json</code>.
                          </div>
                        </>
                      )}
                    </>
                  ) : null}

                  <hr className="my-3" />

                  <div className="d-flex align-items-center justify-content-between">
                    <div className="fw-semibold">Dependencia (opcional)</div>
                    <Form.Check type="switch" label={useSimpleRules ? "Modo simple" : "Modo avanzado"} checked={useSimpleRules} onChange={(e) => setUseSimpleRules(e.target.checked)} />
                  </div>

                  {useSimpleRules ? (
                    <div className="mt-2">
                      <Form.Check
                        type="checkbox"
                        label="Esta pregunta depende de otra"
                        checked={ruleUI.enabled}
                        onChange={(e) =>
                          setRuleUI((s) => ({
                            ...s,
                            enabled: e.target.checked,
                            ...(e.target.checked ? {} : { parentId: "", when: "EQ_TRUE", valueText: "", valueList: [] }),
                          }))
                        }
                      />

                      {ruleUI.enabled ? (
                        <div className="row g-2 mt-1">
                          <div className="col-md-6">
                            <Form.Label>Pregunta padre</Form.Label>
                            <Form.Select value={ruleUI.parentId} onChange={(e) => setRuleUI((s) => ({ ...s, parentId: e.target.value }))}>
                              <option value="">Seleccionar...</option>
                              {preguntasParaPadre.map((p) => (
                                <option key={p.id_pregunta} value={String(p.id_pregunta)}>
                                  #{p.id_pregunta} — {p.etiqueta} ({tiposLabel[p.tipo] || p.tipo})
                                </option>
                              ))}
                            </Form.Select>
                            <div className="small text-muted mt-1">Elegí la pregunta que se responde primero (ej: “¿Tiene hijos?”).</div>
                          </div>

                          <div className="col-md-6">
                            <Form.Label>Condición</Form.Label>
                            <Form.Select
                              value={ruleUI.when}
                              onChange={(e) =>
                                setRuleUI((s) => ({
                                  ...s,
                                  when: e.target.value,
                                  valueText: e.target.value === "EQ_VALUE" ? s.valueText : "",
                                  valueList: e.target.value === "IN_VALUE" ? s.valueList || [] : [],
                                }))
                              }
                              disabled={!ruleUI.parentId}
                            >
                              {allowedWhens.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </Form.Select>

                            {ruleUI.when === "EQ_VALUE" || ruleUI.when === "IN_VALUE" ? (
                              <>
                                {(() => {
                                  const parentTipo = String(selectedParent?.tipo || "").toLowerCase();
                                  const opts = optionValuesFromOpcionesJson(selectedParent?.opciones_json);

                                  if (isSelectLikeTipo(parentTipo) && ruleUI.when === "IN_VALUE") {
                                    return (
                                      <Form.Select className="mt-2" multiple value={ruleUI.valueList} onChange={handleMultiSelectChange}>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  if (isSelectLikeTipo(parentTipo) && ruleUI.when === "EQ_VALUE") {
                                    return (
                                      <Form.Select
                                        className="mt-2"
                                        value={ruleUI.valueText}
                                        onChange={(e) => setRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      >
                                        <option value="">Seleccionar valor…</option>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  if (parentTipo === "multiselect") {
                                    return (
                                      <Form.Select
                                        className="mt-2"
                                        value={ruleUI.valueText}
                                        onChange={(e) => setRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      >
                                        <option value="">Seleccionar opción…</option>
                                        {opts.map((opt) => (
                                          <option key={String(opt)} value={String(opt)}>
                                            {String(opt)}
                                          </option>
                                        ))}
                                      </Form.Select>
                                    );
                                  }

                                  if (parentTipo === "numero") {
                                    return (
                                      <Form.Control
                                        className="mt-2"
                                        type="number"
                                        placeholder="Número exacto"
                                        value={ruleUI.valueText}
                                        onChange={(e) => setRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                      />
                                    );
                                  }

                                  return (
                                    <Form.Control
                                      className="mt-2"
                                      placeholder="Valor exacto"
                                      value={ruleUI.valueText}
                                      onChange={(e) => setRuleUI((s) => ({ ...s, valueText: e.target.value }))}
                                    />
                                  );
                                })()}

                                {ruleUI.when === "IN_VALUE" && isSelectLikeTipo(String(selectedParent?.tipo || "").toLowerCase()) ? (
                                  <div className="small text-muted mt-1">
                                    Podés seleccionar <b>varias</b> respuestas (grupo). Con Ctrl/Shift.
                                  </div>
                                ) : null}
                              </>
                            ) : null}

                            {ruleUI.parentId ? (
                              <div className="small text-muted mt-1">
                                Tipo padre: <b>{tiposLabel[selectedParent?.tipo] || selectedParent?.tipo || "-"}</b>
                              </div>
                            ) : (
                              <div className="small text-muted mt-1">Seleccioná una pregunta padre para habilitar condiciones.</div>
                            )}
                          </div>

                          <div className="col-md-6">
                            <Form.Check
                              type="checkbox"
                              label="Mostrar esta pregunta solo si se cumple"
                              checked={ruleUI.applyVisible}
                              onChange={(e) => setRuleUI((s) => ({ ...s, applyVisible: e.target.checked }))}
                            />
                          </div>

                          <div className="col-md-6">
                            <Form.Check
                              type="checkbox"
                              label="Hacer esta pregunta obligatoria solo si se cumple"
                              checked={ruleUI.applyRequired}
                              onChange={(e) => setRuleUI((s) => ({ ...s, applyRequired: e.target.checked }))}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="row g-2 mt-2">
                        <div className="col-md-6">
                          <Form.Label>
                            Visible si (JSON) <span className="text-muted">(opcional)</span>
                          </Form.Label>
                          <Form.Control as="textarea" rows={6} value={visibleIfText} onChange={(e) => setVisibleIfText(e.target.value)} />
                          <div className="small text-muted mt-1">Si se cumple, se muestra. Si no, se oculta y el backend ignora la respuesta.</div>
                        </div>

                        <div className="col-md-6">
                          <Form.Label>
                            Obligatorio si (JSON) <span className="text-muted">(opcional)</span>
                          </Form.Label>
                          <Form.Control as="textarea" rows={6} value={requiredIfText} onChange={(e) => setRequiredIfText(e.target.value)} />
                          <div className="small text-muted mt-1">Si se cumple, se exige respuesta (además de “Obligatorio” base).</div>
                        </div>
                      </div>

                      <Alert variant="secondary" className="mt-3 mb-0">
                        <div className="fw-semibold mb-1">Tips rápidos</div>
                        <div className="small">
                          <div>
                            <code>op</code> soporta: <code>eq</code>, <code>neq</code>, <code>in</code>, <code>not_in</code>,{" "}
                            <code>truthy</code>, <code>falsy</code>
                          </div>
                          <div>
                            Compuesto: <code>{"{ all: [ ... ] }"}</code> o <code>{"{ any: [ ... ] }"}</code>
                          </div>
                        </div>
                      </Alert>
                    </>
                  )}
                </Modal.Body>

                <Modal.Footer>
                  <Button variant="secondary" onClick={() => setShowPreguntaModal(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={savePregunta}>
                    Guardar
                  </Button>
                </Modal.Footer>
              </Modal>

              {/* MODAL CREAR/EDITAR PLANTILLA */}
              <Modal show={showPlantillaModal} onHide={() => setShowPlantillaModal(false)} centered>
                <Modal.Header closeButton>
                  <Modal.Title>{plantillaEditId ? "Editar plantilla" : "Nueva plantilla"}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control value={plantillaForm.nombre} onChange={(e) => setPlantillaForm((s) => ({ ...s, nombre: e.target.value }))} />
                  <Form.Label className="mt-2">Descripción</Form.Label>
                  <Form.Control as="textarea" rows={3} value={plantillaForm.descripcion} onChange={(e) => setPlantillaForm((s) => ({ ...s, descripcion: e.target.value }))} />
                  <Form.Check
                    className="mt-2"
                    type="checkbox"
                    label="Activa"
                    checked={!!plantillaForm.activo}
                    onChange={(e) => setPlantillaForm((s) => ({ ...s, activo: e.target.checked }))}
                  />
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onClick={() => setShowPlantillaModal(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={savePlantilla}>
                    Guardar
                  </Button>
                </Modal.Footer>
              </Modal>

              {/* MODAL QR */}
              <Modal show={showQrModal} onHide={() => setShowQrModal(false)} centered>
                <Modal.Header closeButton>
                  <Modal.Title>QR del link público</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                  <div className="text-muted small mb-2" style={{ wordBreak: "break-all" }}>
                    {qrValue || "-"}
                  </div>

                  <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 340 }}>
                    {qrLoading ? (
                      <div className="text-center">
                        <Spinner /> <div className="mt-2 text-muted">Generando QR...</div>
                      </div>
                    ) : qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="QR"
                        style={{
                          width: 320,
                          height: 320,
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,.15)",
                        }}
                      />
                    ) : (
                      <div className="text-muted">Sin QR</div>
                    )}
                  </div>
                </Modal.Body>

                <Modal.Footer>
                  <Button variant="outline-secondary" onClick={() => copyToClipboard(qrValue)} disabled={!qrValue}>
                    Copiar link
                  </Button>
                  <Button variant="outline-primary" onClick={downloadQrPng} disabled={!qrDataUrl}>
                    Descargar PNG
                  </Button>
                  <Button variant="secondary" onClick={() => setShowQrModal(false)}>
                    Cerrar
                  </Button>
                </Modal.Footer>
              </Modal>

              <Modal show={showShareModal} onHide={() => setShowShareModal(false)} centered size="lg">
                <Modal.Header closeButton>
                  <Modal.Title>Compartir plantilla</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                  {!canManageShare ? (
                    <Alert variant="warning" className="mb-0">
                      Solo el <b>dueño</b> o <b>admin</b> puede compartir esta plantilla.
                    </Alert>
                  ) : (
                    <>
                      <div className="row g-2">
                        <div className="col-md-7">
                          <Form.Label>Usuario</Form.Label>
                          <Form.Select value={shareUserId} onChange={(e) => setShareUserId(e.target.value)} disabled={loadingUsuarios}>
                            <option value="">{loadingUsuarios ? "Cargando..." : "Seleccionar usuario..."}</option>
                            {(usuarios || [])
                              .filter((u) => Number(u.id) !== Number(currentUser?.id)) // opcional: no mostrarme a mí
                              .map((u) => (
                                <option key={u.id} value={String(u.id)}>
                                  {u.username} — {u.first_name || ""} {u.last_name || ""} {u.email ? `(${u.email})` : ""}
                                </option>
                              ))}
                          </Form.Select>
                        </div>

                        <div className="col-md-3">
                          <Form.Label>Rol</Form.Label>
                          <Form.Select value={shareRol} onChange={(e) => setShareRol(e.target.value)}>
                            <option value="view">Ver</option>
                            <option value="edit">Editar</option>
                          </Form.Select>
                        </div>

                        <div className="col-md-2 d-flex align-items-end">
                          <Button className="w-100" variant="primary" onClick={onGuardarCompartir} disabled={!shareUserId}>
                            Guardar
                          </Button>
                        </div>
                      </div>

                      <hr className="my-3" />

                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <div className="fw-semibold">Usuarios con acceso</div>
                        {loadingCompartidos ? <Spinner size="sm" /> : null}
                      </div>

                      {loadingCompartidos ? (
                        <div className="text-muted">Cargando...</div>
                      ) : !(compartidos || []).length ? (
                        <div className="text-muted">Todavía no compartiste con nadie.</div>
                      ) : (
                        <Table bordered hover size="sm" className="mb-0">
                          <thead>
                            <tr>
                              <th>Usuario</th>
                              <th>Email</th>
                              <th>Rol</th>
                              <th style={{ width: 120 }} className="text-end">
                                Acción
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {(compartidos || []).map((r) => (
                              <tr key={r.id_usuario}>
                                <td>
                                  <div className="fw-semibold">{r.username}</div>
                                  <div className="small text-muted">
                                    {(r.first_name || "") + " " + (r.last_name || "")}
                                  </div>
                                </td>
                                <td>{r.email || "-"}</td>
                                <td>
                                  <Badge bg={String(r.rol).toLowerCase() === "edit" ? "warning" : "secondary"} text={String(r.rol).toLowerCase() === "edit" ? "dark" : undefined}>
                                    {String(r.rol).toLowerCase() === "edit" ? "Editar" : "Ver"}
                                  </Badge>
                                </td>
                                <td className="text-end">
                                  <Button variant="outline-danger" size="sm" onClick={() => onQuitarCompartir(r.id_usuario)}>
                                    Quitar
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      )}
                    </>
                  )}
                </Modal.Body>

                <Modal.Footer>
                  <Button variant="secondary" onClick={() => setShowShareModal(false)}>
                    Cerrar
                  </Button>
                </Modal.Footer>
              </Modal>

              <ImportarRespuestasExcelModal
                show={showImportModal}
                onHide={() => setShowImportModal(false)}
                API_URL={API_URL}
                authHeaders={authHeaders}
                idPlantilla={Number(plantillaSelId) || null}
                nombrePlantilla={plantillaSeleccionada?.nombre || ""}
                preguntasLista={preguntasLista}
                linksDestino={shareLinks || []}
              />

              <ImportarInformesNuevoModal
                show={showNewImportModal}
                onHide={() => setShowNewImportModal(false)}
                API_URL={API_URL}
                authHeaders={authHeaders}
                idPlantilla={Number(plantillaSelId) || null}
                nombrePlantilla={plantillaSeleccionada?.nombre || ""}
                linksDestino={shareLinks || []}
              />

              <DuplicarPlantillaModal
                show={showDuplicarModal}
                onHide={() => setShowDuplicarModal(false)}
                plantilla={plantillaSeleccionada}
                apiUrl={API_URL}
                authHeaders={authHeaders}
                onSuccess={handleDuplicarPlantillaSuccess}
              />

              <Modal
                show={showEditShareModal}
                onHide={() => setShowEditShareModal(false)}
                centered
              >
                <Modal.Header closeButton>
                  <Modal.Title>Editar link público</Modal.Title>
                </Modal.Header>

                <Modal.Body>
                  <Form.Group className="mb-3">
                    <Form.Label>Proyecto</Form.Label>
                    <Form.Select
                      value={editShareForm.id_proyecto}
                      onChange={(e) =>
                        setEditShareForm((s) => ({ ...s, id_proyecto: e.target.value }))
                      }
                    >
                      <option value="">Seleccionar...</option>
                      {(proyectos || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo ? `${p.codigo} - ` : ""}{p.nombre}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Título</Form.Label>
                    <Form.Control
                      type="text"
                      value={editShareForm.titulo}
                      onChange={(e) =>
                        setEditShareForm((s) => ({ ...s, titulo: e.target.value }))
                      }
                      placeholder="Opcional"
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Expira en</Form.Label>
                    <Form.Control
                      type="datetime-local"
                      value={editShareForm.expira_en_local}
                      onChange={(e) =>
                        setEditShareForm((s) => ({ ...s, expira_en_local: e.target.value }))
                      }
                    />
                  </Form.Group>

                  <Form.Group className="mb-2">
                    <Form.Label>Máx. envíos</Form.Label>
                    <Form.Control
                      type="number"
                      min="1"
                      value={editShareForm.max_envios}
                      onChange={(e) =>
                        setEditShareForm((s) => ({ ...s, max_envios: e.target.value }))
                      }
                      placeholder="Vacío = sin límite"
                    />
                  </Form.Group>
                </Modal.Body>

                <Modal.Footer>
                  <Button
                    variant="secondary"
                    onClick={() => setShowEditShareModal(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    onClick={onUpdateShareLink}
                    disabled={shareLoading}
                  >
                    {shareLoading ? "Guardando..." : "Guardar cambios"}
                  </Button>
                </Modal.Footer>
              </Modal>
    </>
  );
}
