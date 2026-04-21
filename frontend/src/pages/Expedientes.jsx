// src/pages/Expedientes.jsx
// ✅ CRUD expedientes + Documentos (tumba) + IMPORT EXCEL + ✅ Elaboración de Carpetas (Mejora/Terreno) + ✅ DBI
// ✅ Plano georeferenciado: sube polígono (SHP triad / ZIP / KML / KMZ / GeoJSON) usando /api/mantenimiento/upload/:idProyecto (fieldName="files")
// ✅ Inserta en ema.bloque_mejoras / ema.bloque_terreno + pasa id_expediente
// ✅ REGLA NUEVA: ✅ SOLO marca etapa "plano_georef" si el backend confirma ok=true y inserted>0
// ✅ Soporta: .shp+.dbf+.shx (seleccionados juntos), .zip, .kml, .kmz (y opcional .geojson/.json)
// ✅ REGLA: si estás en "terreno" el nombre debe contener TERRENO; si estás en "mejora" debe contener MEJORA/MEJORAS
// ✅ Preview muestra si hay SHP incompletos y si el nombre NO cumple la regla del tipo
// ✅ Importación Excel con mapeo de URLs públicas de imágenes para CI propietario / adicional
// ✅ Vista previa pequeña de imágenes importadas

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Button, Modal, Form, Table, Row, Col, Badge, Alert, Collapse } from "react-bootstrap";
import ExpedienteGpsField from "@/components/ExpedienteGpsField";
import { useAuth } from "@/auth/AuthContext";
import { alerts } from "@/utils/alerts";
import { parseCoordsString } from "@/utils/coords";
import { useProjectContext } from "@/context/ProjectContext";
import * as XLSX from "xlsx";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

/* =========================
   ✅ Helpers auth / fetch
   ========================= */
function authHeaders() {
  const raw = localStorage.getItem("token") || localStorage.getItem("access_token") || "";
  const token = raw.trim().replace(/^Bearer\s+/i, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet(url) {
  const r = await fetch(url, { headers: { ...authHeaders() }, cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiJson(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiForm(url, method, formData) {
  const r = await fetch(url, { method, headers: { ...authHeaders() }, body: formData });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiDelete(url) {
  const r = await fetch(url, { method: "DELETE", headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function normalizeDocName(doc) {
  return String(
    doc?.nombre_archivo ||
    doc?.nombre ||
    doc?.filename ||
    doc?.file_name ||
    ""
  ).trim();
}

function normalizeDocUrl(doc) {
  return String(
    doc?.ruta_archivo ||
    doc?.ruta ||
    doc?.url ||
    doc?.link ||
    ""
  ).trim();
}

function docsToNames(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((d) => normalizeDocName(d))
    .filter(Boolean)
    .join(" | ");
}

function docsToUrls(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((d) => normalizeDocUrl(d))
    .filter(Boolean)
    .join(" | ");
}

function findDocByKeywords(arr, keywords = []) {
  const docs = Array.isArray(arr) ? arr : [];
  const keys = keywords.map((k) => String(k).toLowerCase());

  return (
    docs.find((doc) => {
      const name = normalizeDocName(doc).toLowerCase();
      const url = normalizeDocUrl(doc).toLowerCase();
      return keys.some((k) => name.includes(k) || url.includes(k));
    }) || null
  );
}

async function getAllDocsOfExpediente(idExpediente) {
  try {
    const data = await apiGet(`${API}/expedientes/${idExpediente}/documentos`);
    return Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
  } catch {
    return [];
  }
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizePositiveId(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractSimpleBase(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  const basePart = raw.split("/")[0];
  const digits = basePart.replace(/\D/g, "");
  if (!digits) return "";
  return String(parseInt(digits, 10));
}

function isCodigoUnicoValid(code) {
  if (!code) return true;
  return /^\d+-\d+-(T|M)$/.test(String(code).trim().toUpperCase());
}

function isCodigoUnicoConsistent(code, baseNotificacion) {
  if (!code || !baseNotificacion) return true;
  const normalizedBase = extractSimpleBase(baseNotificacion);
  if (!normalizedBase) return true;

  const codeBase = String(code).split("-")[0];
  return codeBase === normalizedBase;
}

function isCodigoUnicoTypeConsistent(code, type) {
  if (!code || !type) return true;
  const suffix = String(code).toUpperCase().split("-").pop();
  return suffix === type.toUpperCase();
}

function formatLocalDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function isoToDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function isoToDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function datetimeLocalToIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeSegEstadoValue(value) {
  return String(value || "").trim();
}

function mapSegEstadoToCatalogCodigo(catalog, value) {
  const raw = normalizeSegEstadoValue(value);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const list = Array.isArray(catalog) ? catalog : [];
  const byCodigo = list.find((item) => normalizeSegEstadoValue(item?.codigo).toLowerCase() === lower);
  if (byCodigo?.codigo) return byCodigo.codigo;
  const byDescripcion = list.find(
    (item) => normalizeSegEstadoValue(item?.descripcion).toLowerCase() === lower
  );
  return byDescripcion?.codigo || "";
}

function getSegEstadoDescripcion(catalog, value) {
  const raw = normalizeSegEstadoValue(value);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const list = Array.isArray(catalog) ? catalog : [];
  const byCodigo = list.find((item) => normalizeSegEstadoValue(item?.codigo).toLowerCase() === lower);
  if (byCodigo?.descripcion) return byCodigo.descripcion;
  const byDescripcion = list.find(
    (item) => normalizeSegEstadoValue(item?.descripcion).toLowerCase() === lower
  );
  return byDescripcion?.descripcion || raw;
}

function cleanSegEstadoDescripcion(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^\d+(?:\.\d+)*\.\s*/g, "");
}

function getDbiEstadoActual(dbiInfo) {
  const rawEstados = Array.isArray(dbiInfo?.estados) ? dbiInfo.estados : [];
  if (rawEstados.length) {
    const ordered = rawEstados
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => {
        const ta = Date.parse(a.item?.fecha || "");
        const tb = Date.parse(b.item?.fecha || "");
        const va = Number.isNaN(ta) ? null : ta;
        const vb = Number.isNaN(tb) ? null : tb;
        if (va === null && vb === null) return a.idx - b.idx;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (va === vb) return a.idx - b.idx;
        return va - vb;
      })
      .map((x) => x.item);
    return ordered[ordered.length - 1]?.estado || "";
  }
  return dbiInfo?.estado || "";
}

function nowLocalDateTimeInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function ymdToIsoStart(ymd) {
  if (!ymd) return "";
  const s = String(ymd).trim();
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeJsonInput(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function normalizeDocList(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string" && v.trim());
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => typeof v === "string" && v.trim());
      }
    } catch {}
  }
  return [];
}

function parseDesafectadoDetalle(value) {
  const empty = { fecha: "", motivo: "", tipo: "", observacion: "" };
  if (value === null || value === undefined) return empty;

  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      fecha: String(value.fecha || "").trim(),
      motivo: String(value.motivo || "").trim(),
      tipo: String(value.tipo || "").trim(),
      observacion: String(value.observacion || "").trim(),
    };
  }

  const raw = String(value || "").trim();
  if (!raw) return empty;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        fecha: String(parsed.fecha || "").trim(),
        motivo: String(parsed.motivo || "").trim(),
        tipo: String(parsed.tipo || "").trim(),
        observacion: String(parsed.observacion || "").trim(),
      };
    }
  } catch {}

  return { ...empty, observacion: raw };
}

function buildDesafectadoDetalle(value) {
  const parsed = parseDesafectadoDetalle(value);
  const payload = {};

  if (parsed.fecha) payload.fecha = parsed.fecha;
  if (parsed.motivo) payload.motivo = parsed.motivo;
  if (parsed.tipo) payload.tipo = parsed.tipo;
  if (parsed.observacion) payload.observacion = parsed.observacion;

  return Object.keys(payload).length ? payload : null;
}

const DOCS_CATALOG = [
  { value: "notificacion_afectacion", label: "Notificación de afectación" },
  { value: "autorizacion", label: "Autorización" },
  { value: "titulo_propiedad", label: "Título de propiedad" },
  { value: "condicion_dominio", label: "Condición de dominio" },
  { value: "acta_defuncion", label: "Acta de defunción" },
  { value: "certificado_adjudicacion", label: "Certificado de adjudicación" },
  { value: "poder_especial", label: "Poder especial" },
  { value: "vigencia_poder", label: "Vigencia del poder" },
  { value: "cedula_propietario", label: "Cédula de identidad del propietario" },
  { value: "cedula_conyugue", label: "Cédula de identidad del cónyuge" },
  { value: "cedula_sucesor", label: "Cédula de identidad del sucesor" },
  { value: "cedula_otros_propietarios", label: "Cédula de identidad de otros propietarios" },
  { value: "cedula_usufructuarios", label: "Cédula de identidad de usufructuarios" },
  { value: "cedula_apoderado", label: "Cédula de identidad del apoderado" },
  {
    value: "cedula_participantes_firma_social",
    label: "Cédula de identidad participantes firma social",
  },
  { value: "escritura_constitucion_sociedad", label: "Escritura pública de constitución de sociedad" },
  { value: "acta_asamblea", label: "Acta de asamblea" },
  { value: "cedula_ocupante", label: "Cédula de identidad del ocupante" },
  { value: "certificado_vida_residencia", label: "Certificado de vida y residencia" },
  { value: "solicitud_ocupacion", label: "Solicitud de ocupación" },
  { value: "constancia_ocupacion", label: "Constancia de ocupación" },
  {
    value: "constancia_solicitud_compra_terreno",
    label: "Constancia de solicitud de compra de terreno",
  },
  { value: "declaracion_sumaria_testigos", label: "Declaración sumaria de testigos ante el juez local" },
  { value: "boleta_pago_patente", label: "Boleta de pago de patente" },
  { value: "contrato_privado_partes", label: "Contrato privado entre partes" },
];

function hasMeaningfulStageValue(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function hasRealStageData(stage) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
    return Boolean(stage);
  }

  if (stage.ok) return true;
  if (typeof stage.obs === "string" && stage.obs.trim()) return true;
  if (stage.date) return true;

  return Object.entries(stage).some(([key, value]) => {
    if (key === "ok" || key === "obs" || key === "date") return false;
    return hasMeaningfulStageValue(value);
  });
}

function hasRealFolderActivity(carpeta) {
  if (!carpeta || typeof carpeta !== "object" || Array.isArray(carpeta)) return false;
  return Object.values(carpeta).some((stage) => hasRealStageData(stage));
}

function resolveTipoCarpetaFromExpediente(row) {
  // Si el campo persistido ya existe, usarlo directamente
  if (row?.tipo_expediente === "T") return { tipo: "terreno", locked: true, legacyBothActive: false };
  if (row?.tipo_expediente === "M") return { tipo: "mejora", locked: true, legacyBothActive: false };

  const mejoraHasActivity = hasRealFolderActivity(row?.carpeta_mejora);
  const terrenoHasActivity = hasRealFolderActivity(row?.carpeta_terreno);

  if (terrenoHasActivity && !mejoraHasActivity) {
    return { tipo: "terreno", locked: true, legacyBothActive: false };
  }
  if (mejoraHasActivity && !terrenoHasActivity) {
    return { tipo: "mejora", locked: true, legacyBothActive: false };
  }
  if (mejoraHasActivity && terrenoHasActivity) {
    return { tipo: "terreno", locked: true, legacyBothActive: true };
  }
  return { tipo: "mejora", locked: false, legacyBothActive: false };
}

/* =========================
   ✅ Helpers polígono (Mantenimiento-like)
   ========================= */
const EXT_REQ = [".shp", ".dbf", ".shx"];
const ARCHIVE_EXTS = [".zip", ".kml", ".kmz", ".rar"];
const CONVERTIBLE_EXTS = [".geojson", ".json", ".gpkg", ".gpx", ".gml", ".dxf"];

function baseUpper(name) {
  const i = name.lastIndexOf(".");
  return (i >= 0 ? name.slice(0, i) : name).trim().toUpperCase();
}
function extLower(name) {
  const m = name.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : "";
}
function normalizeBaseForMatch(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function isSHPPartExt(ext) {
  return EXT_REQ.includes(ext);
}
function isArchiveExt(ext) {
  return ARCHIVE_EXTS.includes(ext);
}
function isConvertibleExt(ext) {
  return CONVERTIBLE_EXTS.includes(ext);
}

/* =========================
   ✅ Regla: nombre debe incluir TERRENO o MEJORA(S)
   ========================= */
function normNameForRule(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_");
}
function ruleKeywords(tipoCarpeta) {
  return tipoCarpeta === "terreno" ? ["TERRENO"] : ["MEJORA", "MEJORAS"];
}
function matchesTipoRule(nameOrBase, tipoCarpeta) {
  const N = normNameForRule(nameOrBase);
  const keys = ruleKeywords(tipoCarpeta);
  return keys.some((k) => N.includes(k));
}

const POLY_TYPES = [
  { key: "proyecto", label: "Polígono proyecto" },
  { key: "afectacion", label: "Polígono afectación" },
];

function getPolygonGeometry(features) {
  const list = Array.isArray(features) ? features : [];
  const found = list.find(
    (f) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"
  );
  return found?.geometry || null;
}

function normalizePlanoFuente(fuente) {
  return fuente === "mejora" ? "mejoras" : fuente === "terreno" ? "terreno" : fuente;
}

export default function Expedientes() {
  const { id } = useParams(); // id_proyecto
  const { currentProjectId, setCurrentProjectId } = useProjectContext();
  const { can } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoOpenRef = useRef(false);
  const paramProjectId = normalizePositiveId(id);
  const queryProjectId = normalizePositiveId(
    searchParams.get("id_proyecto") || searchParams.get("idProyecto")
  );
  const contextProjectId = normalizePositiveId(currentProjectId);
  const idProyecto = paramProjectId || queryProjectId || contextProjectId || null;

  useEffect(() => {
    if (paramProjectId && paramProjectId !== contextProjectId) {
      setCurrentProjectId(paramProjectId);
      return;
    }
    if (!paramProjectId && queryProjectId && queryProjectId !== contextProjectId) {
      setCurrentProjectId(queryProjectId);
    }
  }, [paramProjectId, queryProjectId, contextProjectId, setCurrentProjectId]);



  if (!idProyecto) {
    return <div className="container mt-4">Proyecto no definido</div>;
  }

  const [rows, setRows] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filterQ, setFilterQ] = useState("");
  const [filterTramoId, setFilterTramoId] = useState("");
  const [filterSubtramoId, setFilterSubtramoId] = useState("");
  const [filterDateStart, setFilterDateStart] = useState("");
  const [filterDateEnd, setFilterDateEnd] = useState("");
  const [filterEstado, setFilterEstado] = useState("todos"); // todos | activo | inactivo
  const [filterTipoExp, setFilterTipoExp] = useState(null); // null | M | T
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);

  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const qDebounceRef = useRef(null);

  const [show, setShow] = useState(false);
  const [mode, setMode] = useState("ver"); // ver | crear | editar
  const [current, setCurrent] = useState(null);

  // docs existentes (ema.tumba) para expediente
  const [docs, setDocs] = useState([]);
  const [docsCI, setDocsCI] = useState([]);
  const [docsCIAdicional, setDocsCIAdicional] = useState([]);
  const ciSubcarpetas = useMemo(() => new Set(["ci", "ci_adicional"]), []);

  const [visitas, setVisitas] = useState([]);
  const [visitasLoading, setVisitasLoading] = useState(false);
  const [visitasError, setVisitasError] = useState("");
  const [showVisitaModal, setShowVisitaModal] = useState(false);
  const [visitMode, setVisitMode] = useState("crear"); // crear | editar
  const [visitSaving, setVisitSaving] = useState(false);
  const [visitDocsOpen, setVisitDocsOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({
    id_historial_visita: null,
    fecha: "",
    consultor: "",
    motivo: "",
    respuesta: "",
    documentos_recibidos: [],
  });

  const [planoGeoCache, setPlanoGeoCache] = useState({});
  const [planoGeoLoading, setPlanoGeoLoading] = useState(false);
  const [planoGeoError, setPlanoGeoError] = useState("");
  const [planoViewTipo, setPlanoViewTipo] = useState("proyecto");

  const [catastroFeatures, setCatastroFeatures] = useState(null);
  const [catastroLoadedFor, setCatastroLoadedFor] = useState(null);
  const [catastroLoading, setCatastroLoading] = useState(false);
  const [catastroError, setCatastroError] = useState("");

  const canCreate = can("expedientes.create");
  const canUpdate = can("expedientes.update");
  const canDelete = can("expedientes.delete");
  const canUpload = can("expedientes.upload");
  const canDeleteTotal = canDelete;
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const headerCheckboxRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allIds = useMemo(
    () => rows.map((r) => Number(r.id_expediente)).filter((n) => Number.isFinite(n) && n > 0),
    [rows]
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));

  const [form, setForm] = useState({
    id_proyecto: idProyecto,
    fecha_relevamiento: "",
    gps: "",
    tecnico: "",
    codigo_exp: "",
    codigo_unico: "",
    propietario_nombre: "",
    propietario_ci: "",
    pareja_nombre: "",
    pareja_ci: "",
    telefono: "",
    id_tramo: null,
    id_sub_tramo: null,
    codigo_censo: "",
    padron: "",
    cta_cte_catastral: "",
    ci_propietario_frente_url: "",
    ci_propietario_dorso_url: "",
    ci_adicional_frente_url: "",
    ci_adicional_dorso_url: "",
    parte_a: "",
    parte_b: "",
    premio_aplica: false,
    superficie: "",
    superficie_afectada: "",
    progresiva_ini: "",
    progresiva_fin: "",
    margen: "",
    porcentaje_afectacion: "",
    desafectado: false,
    desafectado_detalle: "",
    percepcion_notificador: "",
    observacion_notificador: "",
    documentacion_presentada: [],
  });

  // Catálogos Censales
  const [tramosCensales, setTramosCensales] = useState([]);
  const [subtramosCensales, setSubtramosCensales] = useState([]);

  // uploads (tumba)
  const [uploadFiles, setUploadFiles] = useState([]);
  const [ciFrente, setCiFrente] = useState(null);
  const [ciDorso, setCiDorso] = useState(null);
  const [ciAdicionalFrente, setCiAdicionalFrente] = useState(null);
  const [ciAdicionalDorso, setCiAdicionalDorso] = useState(null);
  const [subcarpeta, setSubcarpeta] = useState("");

  // carpeta activa (mejora | terreno)
  const [tipoCarpeta, setTipoCarpeta] = useState("mejora");
  const [avaluoOpen, setAvaluoOpen] = useState(true);
  const [docsChecklistOpen, setDocsChecklistOpen] = useState(false);

  const [baseAvailability, setBaseAvailability] = useState({
    checked: false,
    available: true,
    existing: [],
  });

  // Verificar disponibilidad de base
  useEffect(() => {
    // Si hay codigo_exp usemos eso, si no, intentemos extraer del unico que estan tipeando
    const rawBase = form.codigo_exp || String(form.codigo_unico || "").split("-")[0];
    const base = extractSimpleBase(rawBase);

    if (!base || mode === "ver") {
      setBaseAvailability({ checked: false, available: true, existing: [] });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await apiGet(
          `${API}/expedientes/proyecto/${idProyecto}/check-base?base=${encodeURIComponent(base)}`
        );
        // Filtrar coincidencias:
        // 1. No mostrar el expediente actual que estamos editando.
        // 2. No mostrar si el propietario es el mismo (es normal tener múltiples carpetas p/ el mismo dueño).
        const currentOwner = String(form.propietario_nombre || "").trim().toLowerCase();

        const realExisting = (data.existing || []).filter((e) => {
          const isSameRecord = Number(e.id_expediente) === Number(current?.id_expediente);
          const eOwner = String(e.propietario_nombre || "").trim().toLowerCase();
          const isSameOwner = currentOwner && eOwner === currentOwner;
          return !isSameRecord && !isSameOwner;
        });

        setBaseAvailability({
          checked: true,
          available: realExisting.length === 0,
          existing: realExisting,
        });
      } catch (e) {
        console.error("Error al verificar base:", e);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [form.codigo_exp, idProyecto, current?.id_expediente, mode]);


  const readonly =
    mode === "ver" ||
    (mode === "crear" && !canCreate) ||
    (mode === "editar" && !canUpdate);
  const geometryEditable =
    (mode === "editar" || mode === "crear") && canUpdate;
  const gpsFieldRef = useRef(null);
  const planoGeoReqSeqRef = useRef(0);
  const planoGeoReqKeyRef = useRef({});
  const planoGeoLoadingRef = useRef(0);
  const gpsCoords = useMemo(() => parseCoordsString(form.gps), [form.gps]);
  const hasGpsCoords = Array.isArray(gpsCoords);

  const formatGpsDecimal = (val) => {
    const n = Number(String(val).replace(",", "."));
    if (Number.isFinite(n)) return n.toFixed(6);
    return val;
  };

  // Sugerir código único automáticamente si está vacío
  useEffect(() => {
    if (!show || mode === "ver") return;
    const hasManualCode = current?.codigo_unico && String(current.codigo_unico).trim();
    if (hasManualCode) return; // No sobreescribir si ya tiene uno en DB

    const base = extractSimpleBase(form.codigo_exp);
    if (!base) return;

    const tipo = form.tipo_expediente || (tipoCarpeta === "terreno" ? "T" : "M");

    // Verificar si el código actual ya coincide con el tipo
    const currentCode = String(form.codigo_unico || "").trim();
    const needsUpdate =
      !currentCode ||
      (tipo === "T" && currentCode.endsWith("-M")) ||
      (tipo === "M" && currentCode.endsWith("-T"));

    if (!needsUpdate) return;


    const timer = setTimeout(async () => {
      try {
        const data = await apiGet(
          `${API}/expedientes/proyecto/${idProyecto}/suggest-codigo?base=${encodeURIComponent(
            base
          )}&tipo=${tipo}`
        );
        if (data?.codigo_unico) {
          setForm((prev) => ({ ...prev, codigo_unico: data.codigo_unico }));
        }
      } catch (e) {
        console.error("Error sugiriendo código:", e);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    show,
    mode,
    form.codigo_exp,
    tipoCarpeta,
    form.tipo_expediente,
    idProyecto,
    current?.codigo_unico,
  ]);

  const loadCatastroFeatures = async (force = false) => {
    if (!idProyecto) return;
    if (!force && catastroLoadedFor === idProyecto && Array.isArray(catastroFeatures)) return;
    if (catastroLoading) return;
    setCatastroLoading(true);
    try {
      const data = await apiGet(`${API}/gv/catastro/map?proyectoId=${idProyecto}`);
      setCatastroFeatures(Array.isArray(data?.features) ? data.features : []);
      setCatastroLoadedFor(idProyecto);
      setCatastroError("");
    } catch (e) {
      setCatastroError(String(e?.message || e));
    } finally {
      setCatastroLoading(false);
    }
  };

  const loadVisitas = async (idExpediente, force = false) => {
    if (!idExpediente) return;
    if (visitasLoading && !force) return;
    setVisitasLoading(true);
    setVisitasError("");
    try {
      const data = await apiGet(`${API}/expedientes/${idExpediente}/visitas`);
      const rows = Array.isArray(data) ? data : [];
      setVisitas(
        rows.map((r) => ({
          ...r,
          documentos_recibidos: normalizeDocList(r.documentos_recibidos),
        }))
      );
    } catch (e) {
      setVisitasError(String(e?.message || e));
    } finally {
      setVisitasLoading(false);
    }
  };

  const openCrearVisita = () => {
    setVisitMode("crear");
    setVisitDocsOpen(false);
    setVisitForm({
      id_historial_visita: null,
      fecha: todayYMD(),
      consultor: "",
      motivo: "",
      respuesta: "",
      documentos_recibidos: [],
    });
    setShowVisitaModal(true);
  };

  const openEditarVisita = (visita) => {
    setVisitMode("editar");
    setVisitDocsOpen(false);
    setVisitForm({
      id_historial_visita: visita?.id_historial_visita ?? null,
      fecha: visita?.fecha ? String(visita.fecha).slice(0, 10) : "",
      consultor: visita?.consultor || "",
      motivo: visita?.motivo || "",
      respuesta: visita?.respuesta || "",
      documentos_recibidos: normalizeDocList(visita?.documentos_recibidos),
    });
    setShowVisitaModal(true);
  };

  const saveVisita = async () => {
    if (!current?.id_expediente || visitSaving) return;
    setVisitSaving(true);
    try {
      const payload = {
        fecha: visitForm.fecha || null,
        consultor: visitForm.consultor || "",
        motivo: visitForm.motivo || "",
        respuesta: visitForm.respuesta || "",
        documentos_recibidos: Array.isArray(visitForm.documentos_recibidos)
          ? visitForm.documentos_recibidos
          : [],
      };

      if (visitMode === "crear") {
        await apiJson(`${API}/expedientes/${current.id_expediente}/visitas`, "POST", payload);
      } else if (visitForm.id_historial_visita) {
        await apiJson(
          `${API}/expedientes/${current.id_expediente}/visitas/${visitForm.id_historial_visita}`,
          "PUT",
          payload
        );
      }

      await loadVisitas(current.id_expediente, true);
      setShowVisitaModal(false);
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setVisitSaving(false);
    }
  };

  const loadPlanoGeo = async (idExpediente, fuente, tipoPoligono, force = false) => {
    if (!idExpediente) return;
    const normalizedFuente = normalizePlanoFuente(fuente);
    const normalizedTipoPoligono =
      tipoPoligono === "afectacion" ? "afectacion" : "proyecto";
    const cached = planoGeoCache?.[idExpediente]?.[normalizedFuente]?.[normalizedTipoPoligono];
    if (!force && cached !== null && cached !== undefined) return cached;
    planoGeoLoadingRef.current += 1;
    setPlanoGeoLoading(true);
    const key = `${idExpediente}:${normalizedFuente}:${normalizedTipoPoligono}`;
    const seq = ++planoGeoReqSeqRef.current;
    planoGeoReqKeyRef.current[key] = seq;
    try {
      const data = await apiGet(
        `${API}/expedientes/${idExpediente}/${normalizedFuente}?tipo_poligono=${encodeURIComponent(normalizedTipoPoligono)}`
      );
      const feats = Array.isArray(data?.features) ? data.features : [];
      if (planoGeoReqKeyRef.current[key] !== seq) return;
      setPlanoGeoCache((prev) => ({
        ...prev,
        [idExpediente]: {
          ...(prev[idExpediente] || {}),
          [normalizedFuente]: {
            ...((prev[idExpediente] || {})[normalizedFuente] || { proyecto: null, afectacion: null }),
            [normalizedTipoPoligono]: feats,
          },
        },
      }));
      setPlanoGeoError("");
      return feats;
    } catch (e) {
      setPlanoGeoError(String(e?.message || e));
      return null;
    } finally {
      planoGeoLoadingRef.current -= 1;
      if (planoGeoLoadingRef.current <= 0) {
        planoGeoLoadingRef.current = 0;
        setPlanoGeoLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!current?.id_expediente) return;
    loadPlanoGeo(current.id_expediente, "mejoras", "proyecto");
    loadPlanoGeo(current.id_expediente, "mejoras", "afectacion");
    loadPlanoGeo(current.id_expediente, "terreno", "proyecto");
    loadPlanoGeo(current.id_expediente, "terreno", "afectacion");
  }, [current?.id_expediente]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLastPlanoGeometry(null);
  }, [current?.id_expediente]);

  const planoFeaturesProyectoMejoras =
    planoGeoCache?.[current?.id_expediente]?.mejoras?.proyecto;
  const planoFeaturesAfectacionMejoras =
    planoGeoCache?.[current?.id_expediente]?.mejoras?.afectacion;
  const planoFeaturesProyectoTerreno =
    planoGeoCache?.[current?.id_expediente]?.terreno?.proyecto;
  const planoFeaturesAfectacionTerreno =
    planoGeoCache?.[current?.id_expediente]?.terreno?.afectacion;

  const planoFeaturesProyecto = [
    ...(Array.isArray(planoFeaturesProyectoMejoras) ? planoFeaturesProyectoMejoras : []),
    ...(Array.isArray(planoFeaturesProyectoTerreno) ? planoFeaturesProyectoTerreno : []),
  ];
  const planoFeaturesAfectacion = [
    ...(Array.isArray(planoFeaturesAfectacionMejoras) ? planoFeaturesAfectacionMejoras : []),
    ...(Array.isArray(planoFeaturesAfectacionTerreno) ? planoFeaturesAfectacionTerreno : []),
  ];

  const planoHasGeomProyecto = planoFeaturesProyecto.length > 0;
  const planoHasGeomAfectacion = planoFeaturesAfectacion.length > 0;
  const planoFeatureCountProyecto = planoFeaturesProyecto.length;
  const planoFeatureCountAfectacion = planoFeaturesAfectacion.length;

  const [lastPlanoGeometry, setLastPlanoGeometry] = useState(null);

  const planoGeometry = useMemo(() => {
    if (planoHasGeomProyecto) {
      return getPolygonGeometry(planoFeaturesProyecto);
    }
    return null;
  }, [planoHasGeomProyecto, planoFeaturesProyecto]);

  useEffect(() => {
    if (planoGeometry) {
      setLastPlanoGeometry(planoGeometry);
    }
  }, [planoGeometry]);

  const readOnlyGeometry = useMemo(() => {
    const expId = current?.id_expediente;
    if (!expId) return null;
    const preferFeatures = planoViewTipo === "afectacion" ? planoFeaturesAfectacion : planoFeaturesProyecto;
    const preferGeometry = getPolygonGeometry(preferFeatures);
    if (preferGeometry) return preferGeometry;
    if (lastPlanoGeometry) return lastPlanoGeometry;
    if (!Array.isArray(catastroFeatures)) return null;
    const feature = catastroFeatures.find(
      (f) => Number(f?.properties?.id_expediente) === Number(expId)
    );
    const geom = feature?.geometry || null;
    if (!geom) return null;
    if (geom.type === "Polygon" || geom.type === "MultiPolygon") return geom;
    return null;
  }, [
    current?.id_expediente,
    planoViewTipo,
    planoFeaturesProyecto,
    planoFeaturesAfectacion,
    lastPlanoGeometry,
    catastroFeatures,
  ]);

  const handleVerPlanoEnMapa = async (tipoPoligono) => {
    if (!current?.id_expediente) return;
    setPlanoViewTipo(tipoPoligono);
    const featsMejoras = await loadPlanoGeo(current.id_expediente, "mejoras", tipoPoligono);
    const featsTerreno = await loadPlanoGeo(current.id_expediente, "terreno", tipoPoligono);
    const combined = [
      ...(Array.isArray(featsMejoras) ? featsMejoras : []),
      ...(Array.isArray(featsTerreno) ? featsTerreno : []),
    ];
    const geom = getPolygonGeometry(combined);
    if (geom) setLastPlanoGeometry(geom);
    gpsFieldRef.current?.openMap?.();
  };

  const handleResetCodigoUnico = async () => {
    if (!current?.id_expediente) return;
    if (
      !window.confirm(
        "¿Estás seguro de que deseas regenerar el código único? Esto cambiará el IDENTIFICADOR del expediente."
      )
    )
      return;
    try {
      const res = await apiJson(`${API}/expedientes/${current.id_expediente}/reset-codigo-unico`, "POST", {});
      if (res.ok) {
        setForm((prev) => ({ ...prev, codigo_unico: res.codigo_unico }));
        setRows((prev) =>
          prev.map((r) =>
            r.id_expediente === current.id_expediente ? { ...r, codigo_unico: res.codigo_unico } : r
          )
        );
        alerts.success("Código único regenerado: " + res.codigo_unico);
      }
    } catch (e) {
      alerts.error(String(e?.message || e));
    }
  };

  const handleEliminarPlano = async (tipoPoligono) => {
    if (!current?.id_expediente) return;
    if (!geometryEditable || currentGroupBlocked) return;
    const label = tipoPoligono === "afectacion" ? "afectación" : "proyecto";
    const ok = window.confirm(`¿Eliminar el polígono de ${label}?`);
    if (!ok) return;
    try {
      await apiDelete(
        `${API}/expedientes/${current.id_expediente}/poligono/${tipoCarpeta}?tipo_poligono=${encodeURIComponent(tipoPoligono)}`
      );
      setPlanoGeoCache((prev) => {
        const cacheFuente = normalizePlanoFuente(tipoCarpeta);
        return {
          ...prev,
          [current.id_expediente]: {
            ...(prev[current.id_expediente] || {}),
            [cacheFuente]: {
              ...((prev[current.id_expediente] || {})[cacheFuente] || { proyecto: null, afectacion: null }),
              [tipoPoligono]: [],
            },
          },
        };
      });
      await loadEtapas(current.id_expediente, tipoCarpeta);
      await loadCatastroFeatures(true);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const hydrateFormFromRow = (row) => ({
    id_proyecto: row.id_proyecto,
    fecha_relevamiento: row.fecha_relevamiento ? String(row.fecha_relevamiento).slice(0, 10) : "",
    gps: row.gps || "",
    tecnico: row.tecnico || "",
    codigo_exp: row.codigo_exp || "",
    codigo_unico: row.codigo_unico || "",
    propietario_nombre: row.propietario_nombre || "",
    propietario_ci: row.propietario_ci || "",
    pareja_nombre: row.pareja_nombre || "",
    pareja_ci: row.pareja_ci || "",
    telefono: row.telefono || "",
    id_tramo: normalizePositiveId(row.id_tramo),
    id_sub_tramo: normalizePositiveId(row.id_sub_tramo),
    codigo_censo: row.codigo_censo || "",
    padron: row.padron || "",
    cta_cte_catastral: row.cta_cte_catastral || "",
    ci_propietario_frente_url: row.ci_propietario_frente_url || "",
    ci_propietario_dorso_url: row.ci_propietario_dorso_url || "",
    ci_adicional_frente_url: row.ci_adicional_frente_url || "",
    ci_adicional_dorso_url: row.ci_adicional_dorso_url || "",
    parte_a: row.parte_a === null || row.parte_a === undefined ? "" : String(row.parte_a),
    parte_b: row.parte_b === null || row.parte_b === undefined ? "" : String(row.parte_b),
    premio_aplica: Boolean(row.premio_aplica),
    superficie: row.superficie === null || row.superficie === undefined ? "" : String(row.superficie),
    superficie_afectada:
      row.superficie_afectada === null || row.superficie_afectada === undefined
        ? ""
        : String(row.superficie_afectada),
    progresiva_ini: row.progresiva_ini || "",
    progresiva_fin: row.progresiva_fin || "",
    margen: row.margen || "",
    porcentaje_afectacion:
      row.porcentaje_afectacion === null || row.porcentaje_afectacion === undefined
        ? ""
        : String(row.porcentaje_afectacion),
    desafectado: Boolean(row.desafectado),
    desafectado_detalle: parseDesafectadoDetalle(row.desafectado_detalle),
    percepcion_notificador: row.percepcion_notificador || "",
    observacion_notificador: row.observacion_notificador || "",
    documentacion_presentada: normalizeDocList(row.documentacion_presentada),
    // tipo_expediente: campo persistido tiene prioridad.
    // Si es null (legacy), derivar desde la inferencia de carpetas para mantener
    // UI y form alineados desde la apertura.
    tipo_expediente:
      row.tipo_expediente ||
      (() => {
        const resolved = resolveTipoCarpetaFromExpediente(row);
        return resolved.tipo === "terreno" ? "T" : "M";
      })(),
  });

  const mergeRow = (nextRow) => {
    setRows((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex((item) => item.id_expediente === nextRow.id_expediente);
      if (idx === -1) return [nextRow, ...list];
      const copy = [...list];
      copy[idx] = nextRow;
      return copy;
    });
  };

  // =========================
  // ✅ PARTE 2: Elaboración de carpetas
  // =========================
  const ETAPAS_MEJORA = [
    { key: "documentacion", label: "Documentación" },
    { key: "plano_georef", label: "Plano ref. / inf. pericial" },
    { key: "avaluo", label: "Avalúo" },
    { key: "notif_conformidad", label: "Notificación y conformidad" },
    { key: "documentacion_final", label: "Documentación final" },
  ];

  const ETAPAS_TERRENO = [
    { key: "documentacion", label: "Documentación" },
    { key: "plano_georef", label: "Plano ref. / inf. pericial" },
    { key: "informe_pericial", label: "Informe pericial" },
    { key: "plantilla", label: "Planilla de calculo" },
    { key: "avaluo", label: "Avalúo" },
    { key: "notif_conformidad", label: "Notificación y conformidad" },
    { key: "documentacion_final", label: "Documentación final" },
  ];

  const getEtapaLabel = (key, label) => {
    if (key === "plano_georef") return "Plano ref. / inf. pericial";
    if (key === "plantilla") return "Planilla de calculo";
    return label;
  };

  const [etapas, setEtapas] = useState({});
  const [etapasErr, setEtapasErr] = useState("");
  const [savingEtapa, setSavingEtapa] = useState(false);

  // ✅ subir polígono (multi)
  const [polyFilesByTipo, setPolyFilesByTipo] = useState({ proyecto: [], afectacion: [] });
  const [polyBusy, setPolyBusy] = useState(false);
  const [polyUploadNoticeByTipo, setPolyUploadNoticeByTipo] = useState({ proyecto: null, afectacion: null });

  // DBI
  const [dbiCodigo, setDbiCodigo] = useState("");
  const [dbiCodigoMeu, setDbiCodigoMeu] = useState("");
  const [dbiSegEstado, setDbiSegEstado] = useState("");
  const [dbiResolNumero, setDbiResolNumero] = useState("");
  const [dbiResolFecha, setDbiResolFecha] = useState("");
  const [dbiDecretoNumero, setDbiDecretoNumero] = useState("");
  const [dbiDecretoFecha, setDbiDecretoFecha] = useState("");
  const [dbiHeaderOpen, setDbiHeaderOpen] = useState(false);
  const [dbiHeaderBusy, setDbiHeaderBusy] = useState(false);
  const [dbiHeaderError, setDbiHeaderError] = useState("");
  const [dbiEstadosCatalog, setDbiEstadosCatalog] = useState([]);
  const [dbiEstadosLoading, setDbiEstadosLoading] = useState(false);
  const [dbiEstadosError, setDbiEstadosError] = useState("");
  const [dbiFile, setDbiFile] = useState(null);
  const [dbiBusy, setDbiBusy] = useState(false);
  const [dbiEventoEstado, setDbiEventoEstado] = useState("");
  const [dbiEventoFecha, setDbiEventoFecha] = useState("");
  const [dbiEventoObs, setDbiEventoObs] = useState("");
  const [dbiEventoBusy, setDbiEventoBusy] = useState(false);
  const [dbiEventoError, setDbiEventoError] = useState("");
  const [dbiExpandedRows, setDbiExpandedRows] = useState({});
  const [dbiInicioFecha, setDbiInicioFecha] = useState("");
  const [dbiInicioObs, setDbiInicioObs] = useState("");
  const [dbiInicioBusy, setDbiInicioBusy] = useState(false);
  const [dbiInicioError, setDbiInicioError] = useState("");

  const [dbiEditUuid, setDbiEditUuid] = useState(null);
  const [dbiEditForm, setDbiEditForm] = useState({
    estado: "",
    fecha: "",
    obs: "",
  });

  async function guardarEdicionDbi() {
    if (!current?.id_expediente || !dbiEditUuid) return;
    if (!dbiEditForm.estado || !dbiEditForm.fecha) {
      setDbiEstadosError("Estado y fecha son requeridos para editar");
      return;
    }

    setDbiEventoBusy(true);
    setDbiEstadosError("");
    try {
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/eventos/${dbiEditUuid}`,
        "PUT",
        dbiEditForm
      );
      if (data && typeof data === "object") {
        setCurrent((prev) => (prev ? { ...prev, carpeta_dbi: data } : prev));
        const updated = { ...current, carpeta_dbi: data };
        mergeRow(updated);
        setDbiEditUuid(null);
      }
    } catch (e) {
      console.error("Error editando hito DBI:", e);
      setDbiEstadosError(e.message || "Error al guardar edición");
    } finally {
      setDbiEventoBusy(false);
    }
  }

  async function eliminarDbiEvento(ev) {
    if (!current?.id_expediente || !ev) return;
    if (
      !window.confirm(
        "¿Eliminar este hito DBI? Esta acción no se puede deshacer y el estado actual se recalculará."
      )
    ) {
      return;
    }

    const { uuid, estado, fecha, obs } = ev;
    const target = uuid || "legacy";
    const payload = uuid ? undefined : { estado, fecha, obs };

    console.log("Eliminando hito DBI:", { target, payload });

    setDbiEventoBusy(true);
    setDbiEventoError("");
    try {
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/eventos/${target}`,
        "DELETE",
        payload
      );
      if (data && typeof data === "object") {
        setCurrent((prev) => (prev ? { ...prev, carpeta_dbi: data } : prev));
        mergeRow({ ...current, carpeta_dbi: data });
      } else {
        const fresh = await apiGet(`${API}/expedientes/${current.id_expediente}`);
        setCurrent(fresh);
        mergeRow(fresh);
      }
    } catch (e) {
      console.error("Error eliminando hito DBI:", e);
      setDbiEventoError(String(e?.message || e));
    } finally {
      setDbiEventoBusy(false);
    }
  }

  // delete total
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneTipo, setCloneTipo] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [tipoLockedLocal, setTipoLockedLocal] = useState(false);
  const [tipoLockedValue, setTipoLockedValue] = useState(null);

  const deleteToken = (current?.codigo_exp || "").trim() || "ELIMINAR";
  const deleteTokenLabel = (current?.codigo_exp || "").trim()
    ? `Escriba el código del expediente (${deleteToken}) para confirmar.`
    : `Escriba ELIMINAR para confirmar.`;
  const deleteConfirmOk = deleteConfirm.trim() === deleteToken;

  const openCloneModal = () => {
    if (!current?.id_expediente) return;
    setCloneTipo("");
    setCloneError("");
    setShowCloneModal(true);
  };

  const confirmClone = async () => {
    if (!current?.id_expediente || cloneBusy) return;
    if (!cloneTipo) return;
    setCloneBusy(true);
    setCloneError("");
    try {
      const created = await apiJson(
        `${API}/expedientes/${current.id_expediente}/clonar`,
        "POST",
        { tipo_destino: cloneTipo }
      );
      setShowCloneModal(false);
      await openEditar(created);
    } catch (e) {
      setCloneError(String(e?.message || e));
    } finally {
      setCloneBusy(false);
    }
  };

  const etapasList = tipoCarpeta === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;

  function getEtapaFallbackIso() {
    const relIso = ymdToIsoStart(current?.fecha_relevamiento);
    if (relIso) return relIso;
    const localNow = nowLocalDateTimeInput();
    return datetimeLocalToIso(localNow);
  }

  const hasActiveStages = (carpeta) => hasRealFolderActivity(carpeta);

  const mejoraHasActivity = hasActiveStages(current?.carpeta_mejora);
  const terrenoHasActivity = hasActiveStages(current?.carpeta_terreno);
  const onlyMejoraActive = mejoraHasActivity && !terrenoHasActivity;
  const onlyTerrenoActive = terrenoHasActivity && !mejoraHasActivity;
  const legacyBothActive = mejoraHasActivity && terrenoHasActivity;
  const isTipoCarpetaLocked = Boolean(current?.id_expediente) && (mejoraHasActivity || terrenoHasActivity);
  const persistedTipo =
    current?.tipo_expediente === "T" ? "terreno" : current?.tipo_expediente === "M" ? "mejora" : null;
  const isTipoLocked = Boolean(persistedTipo || tipoLockedLocal);
  const lockedTipo = persistedTipo || tipoLockedValue;
  const currentGroupBlocked = Boolean(lockedTipo) && tipoCarpeta !== lockedTipo;

  useEffect(() => {
    let alive = true;
    setDbiEstadosLoading(true);
    setDbiEstadosError("");
    apiGet(`${API}/expedientes/dbi/estados`)
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data) ? data : [];
        const ordered = [...list].sort((a, b) => (a?.orden || 0) - (b?.orden || 0));
        setDbiEstadosCatalog(ordered);
      })
      .catch((e) => {
        if (!alive) return;
        setDbiEstadosCatalog([]);
        setDbiEstadosError(String(e?.message || e));
      })
      .finally(() => {
        if (!alive) return;
        setDbiEstadosLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function firstPendingKey() {
    for (const e of etapasList) {
      const st = etapas?.[e.key];
      if (!st?.ok) return e.key;
    }
    return null;
  }

  function canEditKey(key) {
    const st = etapas?.[key];
    if (st?.ok) return true;
    const pending = firstPendingKey();
    return pending === key;
  }

  async function loadEtapas(idExp, tipo) {
    try {
      setEtapasErr("");
      const data = await apiGet(`${API}/expedientes/${idExp}/etapas/${tipo}`);
      setEtapas(data || {});
    } catch (e) {
      setEtapasErr(String(e?.message || e));
      setEtapas({});
    }
  }

  async function setEtapa(key, ok, obs, date) {
    if (!current) return;
    if (currentGroupBlocked) {
      return;
    }
    setSavingEtapa(true);
    try {
      const payload = { ok, obs };
      if (typeof date === "string" && date.trim()) payload.date = date;
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/etapas/${tipoCarpeta}/${key}`,
        "PUT",
        payload
      );
      setEtapas(data || {});
      if (ok && !current?.tipo_expediente && !tipoLockedLocal) {
        const nextTipoCode = tipoCarpeta === "terreno" ? "T" : "M";
        setTipoLockedLocal(true);
        setTipoLockedValue(tipoCarpeta);
        setForm((prev) => ({ ...prev, tipo_expediente: nextTipoCode }));
        alerts.toast.info(
          `Se fijó la carpeta como ${tipoCarpeta === "terreno" ? "Terreno" : "Mejora"} para esta edición. Guardá los cambios para confirmarlo.`
        );
      }
      if (ok && data && !data?.[key]?.date) {
        await loadEtapas(current.id_expediente, tipoCarpeta);
      }
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setSavingEtapa(false);
    }
  }

  /* =========================
     ✅ Sets detectados (como Mantenimiento)
     ========================= */
  const buildPolySets = (files) => {
    const byBase = new Map();
    const singles = [];
    const list = Array.isArray(files) ? files : [];

    for (const f of list) {
      const ext = extLower(f.name);

      if (isArchiveExt(ext) || isConvertibleExt(ext)) {
        const b = baseUpper(f.name);
        singles.push({
          kind: "single",
          id: `${f.name}__${f.size}`,
          file: f,
          ext,
          base: b,
          baseNorm: normalizeBaseForMatch(b),
        });
        continue;
      }

      if (isSHPPartExt(ext)) {
        const b = baseUpper(f.name);
        const bn = normalizeBaseForMatch(b);
        if (!byBase.has(bn)) {
          byBase.set(bn, {
            kind: "triad",
            base: b,
            baseNorm: bn,
            files: {},
          });
        }
        byBase.get(bn).files[ext] = f;
      }
    }

    const triads = Array.from(byBase.values()).map((g) => {
      const missing = EXT_REQ.filter((x) => !g.files[x]);
      return { ...g, missing, validTriad: missing.length === 0 };
    });

    triads.sort((a, b) => Number(a.validTriad) - Number(b.validTriad));
    return [...triads, ...singles];
  };

  const buildPolyRuleViolations = (sets) => {
    const bad = [];
    for (const s of sets) {
      if (s.kind === "triad") {
        if (!matchesTipoRule(s.base, tipoCarpeta)) bad.push({ kind: "triad", name: s.base });
      } else {
        if (!matchesTipoRule(s.file?.name, tipoCarpeta)) {
          bad.push({ kind: "single", name: s.file?.name || "archivo" });
        }
      }
    }
    return bad;
  };

  const polySetsByTipo = useMemo(
    () => ({
      proyecto: buildPolySets(polyFilesByTipo.proyecto),
      afectacion: buildPolySets(polyFilesByTipo.afectacion),
    }),
    [polyFilesByTipo]
  );

  const polyInvalidTriadsByTipo = useMemo(
    () => ({
      proyecto: polySetsByTipo.proyecto.some((s) => s.kind === "triad" && !s.validTriad),
      afectacion: polySetsByTipo.afectacion.some((s) => s.kind === "triad" && !s.validTriad),
    }),
    [polySetsByTipo]
  );

  const polyRuleViolationsByTipo = useMemo(
    () => ({
      proyecto: buildPolyRuleViolations(polySetsByTipo.proyecto),
      afectacion: buildPolyRuleViolations(polySetsByTipo.afectacion),
    }),
    [polySetsByTipo, tipoCarpeta]
  );

  async function subirPoligono(tipoPoligono) {
    if (!current) return;
    const polyFiles = polyFilesByTipo?.[tipoPoligono] || [];
    const polySets = polySetsByTipo?.[tipoPoligono] || [];
    const polyInvalidTriads = Boolean(polyInvalidTriadsByTipo?.[tipoPoligono]);
    const polyRuleViolations = polyRuleViolationsByTipo?.[tipoPoligono] || [];

    if (!polyFiles.length) {
      setPolyUploadNoticeByTipo((prev) => ({
        ...prev,
        [tipoPoligono]: {
          tone: "warning",
          message: "Seleccioná archivos: SHP+DBF+SHX (juntos) o ZIP/KML/KMZ (y opcional GeoJSON).",
        },
      }));
      return;
    }

    if (polyInvalidTriads) {
      setPolyUploadNoticeByTipo((prev) => ({
        ...prev,
        [tipoPoligono]: {
          tone: "warning",
          message: "Tenés sets SHP incompletos. Completá .shp + .dbf + .shx o subí un ZIP/KMZ.",
        },
      }));
      return;
    }

    if (polyRuleViolations.length) {
      const need = tipoCarpeta === "terreno" ? "TERRENO" : "MEJORA o MEJORAS";
      setPolyUploadNoticeByTipo((prev) => ({
        ...prev,
        [tipoPoligono]: {
          tone: "warning",
          message:
            `Estás en "${tipoCarpeta.toUpperCase()}" y el/los archivos deben contener "${need}" en el nombre.`,
          details: polyRuleViolations.map((x) => x.name).filter(Boolean),
        },
      }));
      return;
    }

    setPolyBusy(true);
    setPolyUploadNoticeByTipo((prev) => ({ ...prev, [tipoPoligono]: null }));
    try {
      const fd = new FormData();
      polyFiles.forEach((f) => fd.append("files", f));
      fd.append("id_expediente", String(current.id_expediente));
      fd.append("tipo_poligono", tipoPoligono);

      const tablaDestino = tipoCarpeta === "mejora" ? "ema.bloque_mejoras" : "ema.bloque_terreno";
      const singles = polySets.filter((s) => s.kind === "single");
      for (const _s of singles) fd.append("defaultTabla", tablaDestino);

      const mapping = {};
      for (const s of polySets) mapping[s.baseNorm] = tablaDestino;
      fd.append("mapping", JSON.stringify(mapping));

      const resp = await apiForm(`${API}/mantenimiento/upload/${idProyecto}`, "POST", fd);

      const ok = resp?.ok === true || resp?.success === true || resp?.status === "ok";
      const inserted =
        Number(resp?.inserted || resp?.total_inserted || resp?.count || 0) ||
        Number(resp?.summary?.inserted || 0);

      if (!ok) {
        const err = new Error(resp?.message || "Falló la carga del polígono (backend no confirmó OK).");
        err.payload = resp;
        throw err;
      }
      if (inserted <= 0) {
        const err = new Error(resp?.message || "No se insertaron geometrías. No se marcará la etapa.");
        err.payload = resp;
        throw err;
      }

      await setEtapa("plano_georef", true, etapas?.plano_georef?.obs || "");
      await loadEtapas(current.id_expediente, tipoCarpeta);

      setPlanoGeoCache((prev) => {
        const cacheFuente = normalizePlanoFuente(tipoCarpeta);
        return {
          ...prev,
          [current.id_expediente]: {
            ...(prev[current.id_expediente] || {}),
            [cacheFuente]: {
              ...((prev[current.id_expediente] || {})[cacheFuente] || { proyecto: null, afectacion: null }),
              [tipoPoligono]: null,
            },
          },
        };
      });

      await loadPlanoGeo(current.id_expediente, tipoCarpeta, tipoPoligono, true);
      setPolyFilesByTipo((prev) => ({ ...prev, [tipoPoligono]: [] }));
      setPolyUploadNoticeByTipo((prev) => ({
        ...prev,
        [tipoPoligono]: {
          tone: "success",
          message: "Plano ref. / inf. pericial cargado OK. Se marcó la etapa.",
          ok: true,
          inserted,
          byTable: resp?.byTable || {},
        },
      }));
    } catch (e) {
      setPolyUploadNoticeByTipo((prev) => ({
        ...prev,
        [tipoPoligono]: {
          tone: "warning",
          ok: false,
          message: String(e?.message || e),
          inserted: Number(e?.payload?.inserted || e?.payload?.total_inserted || e?.payload?.count || 0) || 0,
          byTable: e?.payload?.byTable || {},
          details: Array.isArray(e?.payload?.debug)
            ? e.payload.debug
                .map((item) => item?.baseUnique || item?.base || item?.logicalBase || "")
                .filter(Boolean)
            : [],
        },
      }));
    } finally {
      setPolyBusy(false);
    }
  }

  async function subirDBI() {
    if (!current) return;
    if (!dbiCodigo.trim()) return alert("Ingresá el código DBI.");
    if (!dbiFile) return alert("Seleccioná el archivo final DBI.");

    setDbiBusy(true);
    try {
      const fd = new FormData();
      fd.append("codigo", dbiCodigo.trim());
      fd.append("archivo", dbiFile);

      await apiForm(`${API}/expedientes/${current.id_expediente}/dbi/upload`, "POST", fd);

      setDbiFile(null);
      const fresh = await apiGet(`${API}/expedientes/${current.id_expediente}`);
      setCurrent(fresh);
      mergeRow(fresh);
      await loadDocs(current.id_expediente);
      alert("DBI subido OK.");
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setDbiBusy(false);
    }
  }

  async function agregarDbiEvento() {
    if (!current) return;
    const estado = String(dbiEventoEstado || "").trim();
    if (!estado) {
      setDbiEventoError("Estado es requerido.");
      return;
    }

    setDbiEventoBusy(true);
    setDbiEventoError("");
    try {
      const payload = {
        estado,
        obs: dbiEventoObs ? String(dbiEventoObs) : undefined,
      };
      if (dbiEventoFecha) {
        const iso = new Date(dbiEventoFecha);
        if (!Number.isNaN(iso.getTime())) {
          payload.fecha = iso.toISOString();
        }
      }

      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/eventos`,
        "POST",
        payload
      );

      if (data && typeof data === "object") {
        setCurrent((prev) => (prev ? { ...prev, carpeta_dbi: data } : prev));
      } else {
        const fresh = await apiGet(`${API}/expedientes/${current.id_expediente}`);
        setCurrent(fresh);
        mergeRow(fresh);
      }

      setDbiEventoEstado("");
      setDbiEventoFecha("");
      setDbiEventoObs("");
    } catch (e) {
      setDbiEventoError(String(e?.message || e));
    } finally {
      setDbiEventoBusy(false);
    }
  }

  async function iniciarDbi() {
    if (!current) return;
    const codigo = String(dbiCodigo || "").trim();
    if (!codigo) {
      setDbiInicioError("Código es requerido.");
      return;
    }
    const fechaRaw = String(dbiInicioFecha || "").trim();
    if (!fechaRaw) {
      setDbiInicioError("Fecha de ingreso es requerida.");
      return;
    }
    const fecha = new Date(fechaRaw);
    if (Number.isNaN(fecha.getTime())) {
      setDbiInicioError("Fecha de ingreso inválida.");
      return;
    }

    setDbiInicioBusy(true);
    setDbiInicioError("");
    try {
      const codigoMeu = String(dbiCodigoMeu || "").trim();
      const segEstado = String(dbiSegEstado || "").trim();
      const resolucionNumero = String(dbiResolNumero || "").trim();
      const resolucionFecha = String(dbiResolFecha || "").trim();
      const decretoNumero = String(dbiDecretoNumero || "").trim();
      const decretoFecha = String(dbiDecretoFecha || "").trim();

      const payload = {
        codigo,
        fecha_ingreso: fecha.toISOString(),
        obs: dbiInicioObs ? String(dbiInicioObs) : undefined,
      };
      if (codigoMeu) payload.codigo_meu = codigoMeu;
      if (segEstado) payload.seg_estado = segEstado;
      if (resolucionNumero || resolucionFecha) {
        payload.resolucion = {
          numero: resolucionNumero || undefined,
          fecha: ymdToIsoStart(resolucionFecha) || undefined,
        };
      }
      if (decretoNumero || decretoFecha) {
        payload.decreto = {
          numero: decretoNumero || undefined,
          fecha: ymdToIsoStart(decretoFecha) || undefined,
        };
      }
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/iniciar`,
        "POST",
        payload
      );
      if (data && typeof data === "object") {
        setCurrent((prev) => (prev ? { ...prev, carpeta_dbi: data } : prev));
        setDbiCodigo(data?.codigo || "");
        setDbiCodigoMeu(data?.codigo_meu || "");
        setDbiSegEstado(mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, data?.seg_estado) || data?.seg_estado || "");
        setDbiResolNumero(data?.resolucion?.numero || "");
        setDbiResolFecha(data?.resolucion?.fecha ? isoToDateInput(data.resolucion.fecha) : "");
        setDbiDecretoNumero(data?.decreto?.numero || "");
        setDbiDecretoFecha(data?.decreto?.fecha ? isoToDateInput(data.decreto.fecha) : "");
        setDbiInicioFecha(data?.fecha_ingreso ? isoToDatetimeLocal(data.fecha_ingreso) : fechaRaw);
        setDbiInicioObs(data?.obs || "");
      } else {
        const fresh = await apiGet(`${API}/expedientes/${current.id_expediente}`);
        setCurrent(fresh);
        mergeRow(fresh);
      }
      setDbiInicioError("");
    } catch (e) {
      setDbiInicioError(String(e?.message || e));
    } finally {
      setDbiInicioBusy(false);
    }
  }

  async function guardarDbiHeader() {
    if (!current?.id_expediente) return;
    setDbiHeaderBusy(true);
    setDbiHeaderError("");
    try {
      const normalizeDbiDate = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return null;
        const iso = ymdToIsoStart(raw);
        return iso || null;
      };
      const payload = {
        seg_estado: String(dbiSegEstado || "").trim(),
        obs: String(dbiInicioObs || ""),
        resolucion: {
          numero: String(dbiResolNumero || "").trim() || null,
          fecha: normalizeDbiDate(dbiResolFecha),
        },
        decreto: {
          numero: String(dbiDecretoNumero || "").trim() || null,
          fecha: normalizeDbiDate(dbiDecretoFecha),
        },
      };

      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/header`,
        "PUT",
        payload
      );

      if (data && typeof data === "object") {
        setCurrent((prev) => (prev ? { ...prev, carpeta_dbi: data } : prev));
        setDbiSegEstado(mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, data?.seg_estado) || data?.seg_estado || "");
        setDbiResolNumero(data?.resolucion?.numero || "");
        setDbiResolFecha(data?.resolucion?.fecha ? isoToDateInput(data.resolucion.fecha) : "");
        setDbiDecretoNumero(data?.decreto?.numero || "");
        setDbiDecretoFecha(data?.decreto?.fecha ? isoToDateInput(data.decreto.fecha) : "");
        setDbiInicioObs(data?.obs || "");
        setDbiHeaderOpen(false);
      } else {
        setDbiHeaderError("No se pudo actualizar la cabecera DBI.");
      }
    } catch (e) {
      setDbiHeaderError(String(e?.message || e));
    } finally {
      setDbiHeaderBusy(false);
    }
  }

  // =========================
  // IMPORT EXCEL
  // =========================
  const EXP_FIELDS = [
    { key: "id_import", label: "Código importación", type: "text" },
    { key: "fecha_relevamiento", label: "Fecha relevamiento", type: "date" },
    { key: "gps", label: "GPS", type: "text" },
    { key: "tecnico", label: "Técnico", type: "text" },
    { key: "codigo_exp", label: "Código expediente", type: "text" },
    { key: "codigo_censo", label: "Código censo", type: "text" },
    { key: "propietario_nombre", label: "Propietario nombre", type: "text" },
    { key: "propietario_ci", label: "Propietario CI", type: "text" },
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "subtramo", label: "Subtramo", type: "text" },
    { key: "telefono", label: "Teléfono", type: "text" },
    { key: "pareja_nombre", label: "Nombre del co-titular", type: "text" },
    { key: "pareja_ci", label: "C.I. del co-titular", type: "text" },

    { key: "ci_propietario_frente_url", label: "CI Propietario Frente URL", type: "text" },
    { key: "ci_propietario_dorso_url", label: "CI Propietario Dorso URL", type: "text" },
    { key: "ci_adicional_frente_url", label: "CI Adicional Frente URL", type: "text" },
    { key: "ci_adicional_dorso_url", label: "CI Adicional Dorso URL", type: "text" },

    { key: "superficie", label: "Superficie", type: "number" },
    { key: "superficie_afectada", label: "Superficie afectada", type: "number" },
    { key: "progresiva_ini", label: "Progresiva inicio", type: "text" },
    { key: "progresiva_fin", label: "Progresiva fin", type: "text" },
    { key: "margen", label: "Margen", type: "text" },
    { key: "percepcion_notificador", label: "Percepción notificador", type: "text" },
    { key: "observacion_notificador", label: "Observación notificador", type: "text" },

    // ✅ NUEVOS: documentos generales desde Excel
    { key: "documentos_urls", label: "Documentos URL(s)", type: "text" },
    { key: "documentos_subcarpeta", label: "Subcarpeta documentos", type: "text" },
  ];

  const [showImport, setShowImport] = useState(false);
  const [excelCols, setExcelCols] = useState([]);
  const [excelColumns, setExcelColumns] = useState([]);
  const [excelRows, setExcelRows] = useState([]);
  const [excelPreview, setExcelPreview] = useState([]);
  const [excelWarnings, setExcelWarnings] = useState([]);
  const [mapCols, setMapCols] = useState({});
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [showImportDetails, setShowImportDetails] = useState(false);

  // =========================
  // EXPORT EXCEL
  // =========================
  const EXPORT_FIELDS = [
    // =========================
    // BASE & IDENTIFICACIÓN
    // =========================
    { key: "codigo_unico", label: "Nro. Notificación Único", group: "base" },
    { key: "codigo_exp", label: "Nro. de Notificación", group: "base" },
    { key: "tipo_expediente_label", label: "Tipo de Carpeta", group: "base" },
    { key: "propietario_nombre", label: "Propietario nombre", group: "base" },
    { key: "propietario_ci", label: "Propietario CI", group: "base" },
    { key: "pareja_nombre", label: "Pareja nombre", group: "base" },
    { key: "pareja_ci", label: "Pareja CI", group: "base" },
    { key: "telefono", label: "Teléfono", group: "base" },

    // =========================
    // UBICACIÓN & CONTEXTO
    // =========================
    { key: "tramo_nombre", label: "Tramo", group: "base" },
    { key: "subtramo_nombre", label: "Subtramo", group: "base" },
    { key: "gps_clean", label: "Coordenadas (Lat, Lon)", group: "base" },
    { key: "padrón", label: "Padrón", group: "base" },
    { key: "cta_cte_catastral", label: "Cta. Cte. Catastral", group: "base" },
    { key: "superficie", label: "Superficie", group: "base" },
    { key: "superficie_afectada", label: "Superficie afectada", group: "base" },
    { key: "porcentaje_afectacion", label: "% Afectación", group: "base" },

    // =========================
    // GESTIÓN TÉCNICA (FLATTENED)
    // =========================
    { key: "estado_ok", label: "Estado Gestión (OK)", group: "base" },
    { key: "codigo_dbi", label: "Código DBI", group: "base" },
    { key: "desafectado_label", label: "¿Desafectado?", group: "base" },
    { key: "premio_aplica_label", label: "¿Premio Aplica?", group: "base" },
    { key: "fecha_relevamiento", label: "Fecha relevamiento", group: "base" },
    { key: "created_at_fmt", label: "Fecha Registro", group: "base" },
    { key: "tecnico", label: "Técnico", group: "base" },
    { key: "observaciones_gestion", label: "Observaciones de Gestión", group: "base" },

    // =========================
    // DOCUMENTACIÓN
    // =========================
    { key: "doc_total", label: "Cantidad total documentos", group: "docs" },
    { key: "doc_nombres", label: "Todos los documentos - nombres", group: "docs" },
    { key: "doc_urls", label: "Todos los documentos - links/rutas", group: "docs" },

    { key: "ci_frente", label: "CI propietario frente", group: "docs" },
    { key: "ci_dorso", label: "CI propietario dorso", group: "docs" },
    { key: "ci_adicional_frente", label: "CI adicional frente", group: "docs" },
    { key: "ci_adicional_dorso", label: "CI adicional dorso", group: "docs" },

    { key: "docs_documentacion_nombres", label: "Documentación - nombres", group: "docs" },
    { key: "docs_documentacion_urls", label: "Documentación - links/rutas", group: "docs" },

    { key: "docs_documentacion_final_nombres", label: "Documentación final - nombres", group: "docs" },
    { key: "docs_documentacion_final_urls", label: "Documentación final - links/rutas", group: "docs" },

    { key: "docs_avaluo_nombres", label: "Avalúo - nombres", group: "docs" },
    { key: "docs_avaluo_urls", label: "Avalúo - links/rutas", group: "docs" },

    { key: "docs_informe_pericial_nombres", label: "Informe pericial - nombres", group: "docs" },
    { key: "docs_informe_pericial_urls", label: "Informe pericial - links/rutas", group: "docs" },

    { key: "docs_plantilla_nombres", label: "Planilla de calculo - nombres", group: "docs" },
    { key: "docs_plantilla_urls", label: "Planilla de calculo - links/rutas", group: "docs" },

    { key: "docs_notif_conformidad_nombres", label: "Notif. conformidad - nombres", group: "docs" },
    { key: "docs_notif_conformidad_urls", label: "Notif. conformidad - links/rutas", group: "docs" },
  ];

  const DEFAULT_EXPORT_SELECTION = {
    codigo_unico: true,
    codigo_exp: true,
    tipo_expediente_label: true,
    propietario_nombre: true,
    propietario_ci: true,
    tramo_nombre: true,
    subtramo_nombre: true,
    gps_clean: true,
    estado_ok: true,
    codigo_dbi: true,
    desafectado_label: true,
    fecha_relevamiento: true,
    doc_total: true,
  };

  const [showExport, setShowExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportSelection, setExportSelection] = useState(DEFAULT_EXPORT_SELECTION);

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function guessMapping(headers) {
    const H = headers.map((h) => ({ raw: h, n: norm(h) }));

    const pickMulti = (...cands) => {
      const found = [];
      for (const c of cands) {
        const cn = norm(c);
        const exact = H.find((x) => x.n === cn);
        if (exact) {
          if (!found.includes(exact.raw)) found.push(exact.raw);
          continue;
        }
        const partial = H.filter((x) => x.n.includes(cn));
        partial.forEach((p) => {
          if (!found.includes(p.raw)) found.push(p.raw);
        });
      }
      return found;
    };

    const pick = (...cands) => {
      for (const c of cands) {
        const cn = norm(c);
        const exact = H.find((x) => x.n === cn);
        if (exact) return exact.raw;

        const partial = H.find((x) => x.n.includes(cn));
        if (partial) return partial.raw;
      }
      return "";
    };

    return {
      id_import: pick(
        "id_informe",
        "id informe",
        "id del informe",
        "id_import",
        "id import",
        "codigo importacion",
        "codigo de importacion",
        "codigo importacion",
        "codigo de importacion",
        "codigo importacion",
        "codigo de importacion"
      ),

      fecha_relevamiento: pick(
        "Datos_Relevamiento_Fecha",
        "fecha",
        "fecha relevamiento",
        "fecha_relevamiento"
      ),

      gps: pick(
        "Datos_Relevamiento_Ubicación",
        "Datos_Relevamiento_Ubicacion",
        "ubicacion",
        "ubicación",
        "gps",
        "coordenadas"
      ),

      tecnico: pick(
        "Datos_Relevamiento_Técnico_Encargado",
        "Datos_Relevamiento_Tecnico_Encargado",
        "tecnico encargado",
        "técnico encargado",
        "tecnico",
        "técnico",
        "inspector"
      ),

      codigo_exp: pick(
        "nro de notificación",
        "nro de notificacion",
        "nro. de notificación",
        "nro. de notificacion",
        "Datos_del_Expediente_Código_Expediente_Notificación",
        "Datos_del_Expediente_Codigo_Expediente_Notificacion",
        "codigo expediente notificacion",
        "código expediente notificación",
        "codigo exp",
        "codigo expediente"
      ),

      codigo_unico: pick(
        "nro notificación único",
        "nro notificacion unico",
        "nro. notificación único",
        "nro. notificacion unico",
        "codigo unico",
        "código único",
        "id unico"
      ),

      codigo_censo: pick(
        "Datos_del_Expediente_Código_Censo_socioeconómico_carga_posterior",
        "Datos_del_Expediente_Codigo_Censo_socioeconomico_carga_posterior",
        "codigo censo socioeconomico carga posterior",
        "código censo socioeconómico carga posterior",
        "codigo censo"
      ),

      propietario_nombre: pick(
        "Datos_del_Expediente_Nombre_Propietario",
        "nombre propietario",
        "propietario nombre",
        "propietario"
      ),

      propietario_ci: pick(
        "Datos_del_Expediente_Número_C.I._Propietario",
        "Datos_del_Expediente_Numero_C_I_Propietario",
        "numero ci propietario",
        "número ci propietario",
        "propietario ci",
        "cedula propietario"
      ),

      tramo: pick(
        "Datos_del_Expediente_Tramo",
        "tramo"
      ),

      telefono: pick(
        "Datos_del_Expediente_Número_de_teléfono",
        "telefono",
        "n de telefono",
        "nro de telefono"
      ),

      pareja_ci: pick(
        "Datos_del_Expediente_Número_C.I._Adicional",
        "pareja ci",
        "co-titular ci",
        "ci adicional"
      ),

      superficie: pick(
        "superficie"
      ),

      superficie_afectada: pick(
        "superficie afectada",
        "superficie_afectada"
      ),

      progresiva_ini: pick(
        "progresiva inicio",
        "progresiva inicial",
        "progresiva_inicio",
        "progresiva_ini"
      ),

      progresiva_fin: pick(
        "progresiva fin",
        "progresiva_fin"
      ),

      margen: pick(
        "margen"
      ),

      percepcion_notificador: pick(
        "Datos_del_Expediente_Percepcion_del_Notificador",
        "percepcion notificador",
        "percepcion del notificador"
      ),

      observacion_notificador: pick(
        "observacion notificador",
        "observaciones del notificador",
        "observaciones generales",
        "observacion"
      ),

      subtramo: pickMulti(
        "Datos_del_Expediente_Subtramo_1",
        "Datos_del_Expediente_Subtramo_2",
        "Datos_del_Expediente_Subtramo_3",
        "subtramo 1",
        "subtramo"
      ),

      ci_propietario_frente_url: pick(
        "Fotos:Datos_del_Expediente_C.I_Propietario_Frente",
        "Fotos Datos del Expediente C I Propietario Frente",
        "fotos datos del expediente ci propietario frente",
        "ci propietario frente",
        "cedula propietario frente"
      ),

      ci_propietario_dorso_url: pick(
        "Fotos:Datos_del_Expediente_C.I._Propietario_Dorso",
        "Fotos Datos del Expediente C I Propietario Dorso",
        "fotos datos del expediente ci propietario dorso",
        "ci propietario dorso",
        "cedula propietario dorso"
      ),

      ci_adicional_frente_url: pick(
        "Fotos:Datos_del_Expediente_C.I_Adicional_Frente",
        "Fotos Datos del Expediente C I Adicional Frente",
        "fotos datos del expediente ci adicional frente",
        "ci adicional frente",
        "cedula adicional frente"
      ),

      ci_adicional_dorso_url: pick(
        "Fotos:Datos_del_Expediente_C.I._Adicional_Dorso",
        "Fotos Datos del Expediente C I Adicional Dorso",
        "fotos datos del expediente ci adicional dorso",
        "ci adicional dorso",
        "cedula adicional dorso"
      ),

      documentos_urls: pickMulti(
        "Fotos:Datos_Relevamiento_Foto_3",
        "Fotos:Datos_Relevamiento_Foto1",
        "Fotos:Datos_Relevamiento_Foto2",

        "documentos",
        "documentos url",
        "documentos urls",
        "documento",
        "documento url",
        "documento urls",
        "links documentos",
        "links de documentos",
        "url documentos",
        "url documento",
        "adjuntos",
        "adjunto",
        "archivos",
        "links archivos"
      ),

      documentos_subcarpeta: pick(
        "subcarpeta documentos",
        "subcarpeta",
        "carpeta documentos",
        "carpeta",
        "tipo documento",
        "categoria documento",
        "categoría documento"
      ),
    };
  }

  function excelDateToYMD(v) {
    if (!v) return "";
    if (v instanceof Date && !isNaN(v)) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    if (typeof v === "number") {
      const dt = XLSX.SSF.parse_date_code(v);
      if (!dt) return "";
      const y = dt.y;
      const m = String(dt.m).padStart(2, "0");
      const d = String(dt.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const s = String(v).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m1) {
      const dd = String(m1[1]).padStart(2, "0");
      const mm = String(m1[2]).padStart(2, "0");
      const yyyy = m1[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    return s;
  }

  function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array", cellDates: true });
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
          const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
          const headers = headerRow.map((h) => String(h ?? "").trim());
          const rows = matrix.slice(1).map((r) => {
            const obj = {};
            for (let i = 0; i < headers.length; i += 1) {
              const key = headers[i] || `__col_${i}`;
              obj[key] = r?.[i] ?? "";
            }
            return obj;
          });
          resolve({ headers, rows });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (file) {
      onExcelPicked(file);
      e.target.value = "";
    }
  };

  async function onExcelPicked(file) {
    setImportErrors([]);
    setExcelWarnings([]);
    setImportResult(null);
    setShowImportDetails(false);
    try {
      const { headers, rows } = await parseExcelFile(file);
      if (!headers.length) {
        setImportErrors(["El Excel no tiene encabezados (primera fila)."]);
        return;
      }
      if (!rows.length) {
        setImportErrors(["El Excel no tiene filas de datos."]);
        return;
      }
      const columns = headers.map((h, index) => {
        const headerOriginal = String(h ?? "").trim();
        const sampleValue = rows.find((r) => {
          const v = r[headerOriginal || `__col_${index}`];
          return String(v ?? "").trim() !== "";
        });
        return {
          index,
          headerOriginal,
          headerNormalized: norm(headerOriginal),
          sampleValue: sampleValue ? sampleValue[headerOriginal || `__col_${index}`] : "",
        };
      });
      const emptyHeaders = columns.filter((c) => !c.headerOriginal).map((c) => c.index + 1);
      const headerCounts = new Map();
      columns.forEach((c) => {
        const key = c.headerOriginal.toLowerCase();
        if (!key) return;
        headerCounts.set(key, (headerCounts.get(key) || 0) + 1);
      });
      const duplicatedHeaders = Array.from(headerCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([header]) => header);
      const warnings = [];
      if (emptyHeaders.length) {
        warnings.push(`Se detectaron columnas sin encabezado (columnas: ${emptyHeaders.join(", ")}).`);
      }
      if (duplicatedHeaders.length) {
        warnings.push(`Se detectaron encabezados duplicados: ${duplicatedHeaders.join(", ")}.`);
      }
      if (warnings.length) setExcelWarnings(warnings);

      setExcelCols(headers);
      setExcelColumns(columns);
      setExcelRows(rows);
      setExcelPreview(rows.slice(0, 10));

      const auto = guessMapping(headers);
      setMapCols(auto);
      setShowImport(true);
    } catch (e) {
      setImportErrors([String(e?.message || e)]);
      setShowImport(true);
    }
  }

  function buildMappedPayload() {
    const isSignificant = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return false;
      return !/^0+$/.test(raw);
    };

    const splitLinks = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return [];

      return raw
        .split(/\r?\n|;|,|\|/g)
        .map((x) => String(x || "").trim())
        .filter(Boolean);
    };

    const getMultiSelectedColumns = (value) => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (!value) return [];
      return [value].filter(Boolean);
    };

    const mapped = excelRows.map((r) => {
      const obj = { id_proyecto: idProyecto };

      for (const f of EXP_FIELDS) {
        if (f.key === "documentos_urls") {
          const cols = getMultiSelectedColumns(mapCols[f.key]);
          const allLinks = cols.flatMap((col) => splitLinks(r[col]));
          obj[f.key] = [...new Set(allLinks)];
          continue;
        }

        if (f.key === "subtramo") {
          const cols = getMultiSelectedColumns(mapCols[f.key]);
          let val = "";
          for (const c of cols) {
            const v = String(r[c] ?? "").trim();
            if (v && !/^0+$/.test(v)) {
              val = v;
              break;
            }
          }
          obj[f.key] = val || null;
          continue;
        }

        if (f.type === "number") {
          const col = mapCols[f.key];
          const raw = String(col ? (r[col] ?? "") : "")
            .trim()
            .replace(",", ".");
          const n = raw === "" ? NaN : parseFloat(raw);
          obj[f.key] = Number.isFinite(n) ? n : null;
          continue;
        }

        const col = mapCols[f.key];
        const val = col ? r[col] : "";

        if (f.key === "fecha_relevamiento") {
          const ymd = excelDateToYMD(val);
          obj[f.key] = ymd ? ymd : todayYMD();
        } else {
          obj[f.key] = String(val ?? "").trim() || null;
        }
      }

      if (!obj.documentos_subcarpeta) {
        obj.documentos_subcarpeta = "documentacion";
      }

      return obj;
    });

    const cleaned = mapped.filter((x) => {
      const hasCi = isSignificant(x.propietario_ci);
      const hasCiImage =
        isSignificant(x.ci_propietario_frente_url) ||
        isSignificant(x.ci_propietario_dorso_url);

      const hasDocumentos =
        Array.isArray(x.documentos_urls) && x.documentos_urls.length > 0;

      return (
        isSignificant(x.fecha_relevamiento) &&
        isSignificant(x.propietario_nombre) &&
        isSignificant(x.gps) &&
        (hasCi || hasCiImage || hasDocumentos)
      );
    });

    return { ok: true, rows: cleaned };
  }

  async function confirmarImport() {
    const out = buildMappedPayload();
    if (!out.ok) {
      setImportErrors(out.errs);
      return;
    }
    if (!out.rows.length) {
      setImportErrors(["No quedaron filas válidas luego del filtrado."]);
      return;
    }

    setImportBusy(true);
    setImportErrors([]);
    setImportResult(null);
    setShowImportDetails(false);
    try {
      const result = await apiJson(`${API}/expedientes/import/${idProyecto}`, "POST", {
        rows: out.rows,
        mapping: mapCols,
        total: out.rows.length,
      });

      setImportResult(result || {});
      setShowImportDetails(false);
      await load();
    } catch (e) {
      setImportErrors([String(e?.message || e)]);
    } finally {
      setImportBusy(false);
    }
    }

  async function exportarExcelConDocumentacion() {
    try {
      setExportBusy(true);

      const selectedFields = EXPORT_FIELDS.filter((f) => exportSelection[f.key]);

      if (!selectedFields.length) {
        alert("Seleccioná al menos una columna para exportar.");
        return;
      }

      const dataForExcel = await Promise.all(
        (rows || []).map(async (r) => {
          const item = {};
          const needsDocs = selectedFields.some((f) => f.group === "docs");
          const docs = needsDocs ? await collectExportDocs(r.id_expediente) : null;

          // Flattening y Transformación Elite
          const isOK = r.tipo_expediente === 'M' 
            ? r.carpeta_mejora?.documentacion_final?.ok === true 
            : r.carpeta_terreno?.documentacion_final?.ok === true;

          const gpsClean = String(r.gps || "").replace(/\(|\)|\[|\]|lat:|lon:/gi, "").trim();
          
          const obsArr = [];
          if (r.carpeta_mejora?.observaciones) obsArr.push(`Mejora: ${r.carpeta_mejora.observaciones}`);
          if (r.carpeta_terreno?.observaciones) obsArr.push(`Terreno: ${r.carpeta_terreno.observaciones}`);
          if (r.carpeta_dbi?.obs) obsArr.push(`DBI: ${r.carpeta_dbi.obs}`);

          for (const f of selectedFields) {
            let value = "";

            switch (f.key) {
              case "tipo_expediente_label":
                value = r.tipo_expediente === "M" ? "Mejora" : "Terreno";
                break;
              case "desafectado_label":
                value = r.desafectado ? "SÍ" : "NO";
                break;
              case "premio_aplica_label":
                value = r.premio_aplica ? "SÍ" : "NO";
                break;
              case "estado_ok":
                value = isOK ? "COMPLETADO (OK)" : "PENDIENTE";
                break;
              case "gps_clean":
                value = gpsClean || "N/A";
                break;
              case "codigo_dbi":
                value = r.carpeta_dbi?.codigo || "N/A";
                break;
              case "observaciones_gestion":
                value = obsArr.join(" | ");
                break;
              case "fecha_relevamiento":
                value = r.fecha_relevamiento ? String(r.fecha_relevamiento).slice(0, 10) : "";
                break;
              case "created_at_fmt":
                value = r.created_at ? new Date(r.created_at).toLocaleDateString() : "";
                break;
              case "tramo_nombre":
                value = r.tramo_nombre || (r.tramo ? String(r.tramo) : "N/A");
                break;
              case "subtramo_nombre":
                value = r.subtramo_nombre || (r.subtramo ? String(r.subtramo) : "N/A");
                break;
              case "doc_total":
                value = docs?.allDocs?.length ?? 0;
                break;
              case "doc_nombres":
                value = docsToNames(docs?.allDocs);
                break;
              case "doc_urls":
                value = docsToUrls(docs?.allDocs);
                break;
              case "ci_frente":
                value = docs?.ciFrente || "";
                break;
              case "ci_dorso":
                value = docs?.ciDorso || "";
                break;
              default:
                value = r?.[f.key] ?? "";
                break;
            }

            item[f.label] = value ?? "";
          }

          return item;
        })
      );

      const ws = XLSX.utils.json_to_sheet(dataForExcel);
      const totalCols = Object.keys(dataForExcel?.[0] || {}).length;
      ws["!cols"] = Array.from({ length: totalCols }, () => ({ wch: 28 }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Expedientes");
      XLSX.writeFile(wb, `expedientes_${idProyecto}_con_documentacion.xlsx`);

      setShowExport(false);
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setExportBusy(false);
    }
  }

  // =========================
  // LOAD LIST + DOCS
  // =========================
  async function collectExportDocs(idExpediente) {
    const [
      allDocs,
      ciDocs,
      ciAdicionalDocs,
      docsDocumentacion,
      docsDocumentacionFinal,
      docsAvaluo,
      docsInformePericial,
      docsPlantilla,
      docsNotifConformidad,
    ] = await Promise.all([
      getAllDocsOfExpediente(idExpediente),
      loadDocsBySubcarpeta(idExpediente, "ci"),
      loadDocsBySubcarpeta(idExpediente, "ci_adicional"),
      loadDocsBySubcarpeta(idExpediente, "documentacion"),
      loadDocsBySubcarpeta(idExpediente, "documentacion_final"),
      loadDocsBySubcarpeta(idExpediente, "avaluo"),
      loadDocsBySubcarpeta(idExpediente, "informe_pericial"),
      loadDocsBySubcarpeta(idExpediente, "plantilla"),
      loadDocsBySubcarpeta(idExpediente, "notif_conformidad"),
    ]);

    const ciFrente = findDocByKeywords(ciDocs, ["frente"]);
    const ciDorso = findDocByKeywords(ciDocs, ["dorso", "reverso"]);
    const ciAdicionalFrente = findDocByKeywords(ciAdicionalDocs, ["frente"]);
    const ciAdicionalDorso = findDocByKeywords(ciAdicionalDocs, ["dorso", "reverso"]);

    return {
      allDocs,
      docsDocumentacion,
      docsDocumentacionFinal,
      docsAvaluo,
      docsInformePericial,
      docsPlantilla,
      docsNotifConformidad,
      ciFrente: normalizeDocUrl(ciFrente),
      ciDorso: normalizeDocUrl(ciDorso),
      ciAdicionalFrente: normalizeDocUrl(ciAdicionalFrente),
      ciAdicionalDorso: normalizeDocUrl(ciAdicionalDorso),
    };
  }

  const load = async (overrides = null) => {
    setLoading(true);
    try {
      const q = String(overrides?.q !== undefined ? overrides.q : (filterQ ?? "")).trim();
      const tramoId = String(overrides?.tramoId !== undefined ? overrides.tramoId : (filterTramoId ?? "")).trim();
      const subtramoId = String(overrides?.subtramoId !== undefined ? overrides.subtramoId : (filterSubtramoId ?? "")).trim();
      const dateStart = overrides?.dateStart !== undefined ? overrides.dateStart : (filterDateStart ?? "");
      const dateEnd = overrides?.dateEnd !== undefined ? overrides.dateEnd : (filterDateEnd ?? "");
      const estado = overrides?.estado !== undefined ? overrides.estado : (filterEstado ?? "todos");
      const tipoExp = overrides?.tipoExp !== undefined ? overrides.tipoExp : (filterTipoExp ?? "");

      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (tramoId) params.set("tramoId", tramoId);
      if (subtramoId) params.set("subtramoId", subtramoId);
      if (dateStart) params.set("dateStart", dateStart);
      if (dateEnd) params.set("dateEnd", dateEnd);
      if (estado && estado !== "todos") params.set("estado", estado);
      if (tipoExp) params.set("tipoExp", tipoExp);

      const qs = params.toString();
      const url = qs
        ? `${API}/expedientes/proyecto/${idProyecto}?${qs}`
        : `${API}/expedientes/proyecto/${idProyecto}`;
      const data = await apiGet(url);
      setRows(data);
      
      // Si no hay filtros, este es el total del proyecto
      if (!qs) {
        setTotalRecords(data.length);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTotalCount = async () => {
    try {
      const data = await apiGet(`${API}/expedientes/proyecto/${idProyecto}`);
      setTotalRecords(Array.isArray(data) ? data.length : 0);
    } catch (e) {
      console.error("Error loading total count", e);
    }
  };

  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? allIds : []);
  };

  const toggleSelectOne = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return Array.from(next);
    });
  };

  const eliminar = async (r) => {
    if (!canDelete || bulkDeleting) return;
    const ok = await alerts.confirm({
      title: "¿Estás seguro?",
      text: `Se eliminará el expediente "${r.codigo_unico || r.codigo_exp || r.id_expediente}". Esta acción no se puede deshacer.`,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      icon: "warning",
    });
    if (!ok) return;

    setBulkDeleting(true);
    try {
      await apiDelete(`${API}/expedientes/${r.id_expediente}`);
      alerts.toast.success("Expediente eliminado correctamente");
      await load();
    } catch (e) {
      alerts.toast.error(String(e?.message || e));
    } finally {
      setBulkDeleting(false);
    }
  };

  const eliminarSeleccionados = async () => {
    if (!canDelete || !selectedIds.length || bulkDeleting) return;

    const ok = await alerts.confirm({
      title: "Eliminar expedientes seleccionados",
      text: `Se eliminarán ${selectedIds.length} expedientes de este proyecto. Esta acción no se puede deshacer.`,
      confirmButtonText: "Sí, eliminar",
      icon: "warning",
    });
    if (!ok) return;

    setBulkDeleting(true);
    alerts.loading("Eliminando expedientes...");

    try {
      const resp = await fetch(`${API}/expedientes/proyecto/${idProyecto}/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ids: selectedIds }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.message || data?.error || `Error ${resp.status}`);
      }

      alerts.toast.success(
        `Eliminados ${data?.deleted_count ?? selectedIds.length} expedientes`
      );
      setSelectedIds([]);
      await load();
    } catch (e) {
      alerts.toast.error(String(e?.message || e));
    } finally {
      alerts.close();
      setBulkDeleting(false);
    }
  };

  const eliminarTodosContextual = async () => {
    if (!canDelete || bulkDeleting) return;

    const parts = [];
    if (String(filterQ || "").trim()) parts.push(`Busqueda: "${String(filterQ).trim()}"`);
    if (String(filterTramoId || "").trim()) parts.push(`TramoId: ${String(filterTramoId).trim()}`);
    if (String(filterSubtramoId || "").trim()) parts.push(`SubtramoId: ${String(filterSubtramoId).trim()}`);

    const scopeTxt = parts.length
      ? `Se eliminarán todos los expedientes del resultado actual (${parts.join(" / ")}).`
      : "Se eliminarán todos los expedientes del proyecto (sin filtros activos).";

    const ok = await alerts.confirm({
      title: "Eliminar todos los expedientes del listado",
      text: `${scopeTxt} Esta acción no se puede deshacer.`,
      confirmButtonText: "Sí, eliminar",
      icon: "warning",
    });
    if (!ok) return;

    setBulkDeleting(true);
    alerts.loading("Eliminando expedientes...");

    try {
      const resp = await fetch(`${API}/expedientes/proyecto/${idProyecto}/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          all: true,
          filters: {
            q: String(filterQ || "").trim(),
            tramoId: String(filterTramoId || "").trim(),
            subtramoId: String(filterSubtramoId || "").trim(),
          },
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || data?.ok === false) {
        throw new Error(data?.message || data?.error || `Error ${resp.status}`);
      }

      alerts.toast.success(`Eliminados ${data?.deleted_count ?? 0} expedientes`);
      setSelectedIds([]);
      await load();
    } catch (e) {
      alerts.toast.error(String(e?.message || e));
    } finally {
      alerts.close();
      setBulkDeleting(false);
    }
  };

  const loadDocs = async (idExp) => {
    const data = await apiGet(`${API}/expedientes/${idExp}/documentos`);
    setDocs(Array.isArray(data) ? data : []);
  };

  const loadDocsBySubcarpeta = async (idExp, carpeta) => {
    const data = await apiGet(
      `${API}/expedientes/${idExp}/documentos?carpeta=${encodeURIComponent(carpeta || "")}`
    );
    return Array.isArray(data) ? data : [];
  };

  const loadCIDocs = async (idExp) => {
    const [titular, adicional] = await Promise.all([
      loadDocsBySubcarpeta(idExp, "ci"),
      loadDocsBySubcarpeta(idExp, "ci_adicional"),
    ]);
    setDocsCI(titular);
    setDocsCIAdicional(adicional);
  };

  const loadTramosCensales = async () => {
    try {
      const data = await apiGet(`${API}/proyectos/${idProyecto}/tramos-censales`);
      setTramosCensales(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setTramosCensales([]);
    }
  };

  useEffect(() => {
    load();
    loadTotalCount();
    loadTramosCensales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProyecto]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => allIds.includes(id)));
  }, [allIds]);

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = selectedIds.length > 0 && !allSelected;
  }, [selectedIds, allSelected]);

  useEffect(() => {
    if (qDebounceRef.current) {
      clearTimeout(qDebounceRef.current);
    }
    qDebounceRef.current = setTimeout(() => {
      load({ q: filterQ });
    }, 400);
    return () => {
      if (qDebounceRef.current) {
        clearTimeout(qDebounceRef.current);
        qDebounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQ]);

  useEffect(() => {
    let active = true;

    const fetchSubtramos = async () => {
      const tramoId = normalizePositiveId(form.id_tramo);
      if (!tramoId) {
        if (active) setSubtramosCensales([]);
        return;
      }

      if (active) setSubtramosCensales([]);

      try {
        const data = await apiGet(
          `${API}/proyectos/${idProyecto}/tramos-censales/${tramoId}/subtramos`
        );
        if (!active) return;
        setSubtramosCensales(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (active) setSubtramosCensales([]);
      }
    };

    fetchSubtramos();

    return () => {
      active = false;
    };
  }, [form.id_tramo, idProyecto]);

  // Deep-link: auto-open modal if expId is in URL
  useEffect(() => {
    if (didAutoOpenRef.current) return;

    const expIdRaw = searchParams.get("expId");
    if (!expIdRaw) return;

    if (!Array.isArray(rows) || rows.length === 0) return;

    const expId = Number(expIdRaw);
    if (!Number.isFinite(expId)) {
      searchParams.delete("expId");
      setSearchParams(searchParams, { replace: true });
      didAutoOpenRef.current = true;
      return;
    }

    const found = rows.find((r) => Number(r.id_expediente) === expId);
    if (!found) return;

    didAutoOpenRef.current = true;

    Promise.resolve(openVer(found)).finally(() => {
      searchParams.delete("expId");
      setSearchParams(searchParams, { replace: true });
    });
  }, [rows, searchParams, setSearchParams]);

  // =========================
  // MODAL ACTIONS
  // =========================
  const openCrear = () => {
    setMode("crear");
    setCurrent(null);
    setTipoLockedLocal(false);
    setTipoLockedValue(null);
    setDocs([]);
    setDocsCI([]);
    setDocsCIAdicional([]);
    setVisitas([]);
    setVisitasError("");
    setSubcarpeta("");
    setDocsChecklistOpen(false);
    setPlanoViewTipo("proyecto");

    setTipoCarpeta("mejora");
    setEtapas({});
    setEtapasErr("");

    setForm({
      id_proyecto: idProyecto,
      fecha_relevamiento: todayYMD(),
      gps: "",
      tecnico: "",
      codigo_exp: "",
      codigo_unico: "",
      propietario_nombre: "",
      propietario_ci: "",
      pareja_nombre: "",
      pareja_ci: "",
      id_tramo: null,
      id_sub_tramo: null,
      codigo_censo: "",
      ci_propietario_frente_url: "",
      ci_propietario_dorso_url: "",
      ci_adicional_frente_url: "",
      ci_adicional_dorso_url: "",
      parte_a: "",
      parte_b: "",
      premio_aplica: false,
      superficie: "",
      superficie_afectada: "",
      progresiva_ini: "",
      progresiva_fin: "",
      margen: "",
      porcentaje_afectacion: "",
      desafectado: false,
      desafectado_detalle: "",
      percepcion_notificador: "",
      observacion_notificador: "",
      documentacion_presentada: [],
      tipo_expediente: null,
    });

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFilesByTipo({ proyecto: [], afectacion: [] });
    setPolyUploadNoticeByTipo({ proyecto: null, afectacion: null });
    setDbiCodigo("");
    setDbiCodigoMeu("");
    setDbiSegEstado("");
    setDbiResolNumero("");
    setDbiResolFecha("");
    setDbiDecretoNumero("");
    setDbiDecretoFecha("");
    setDbiHeaderOpen(false);
    setDbiHeaderBusy(false);
    setDbiHeaderError("");
    setDbiFile(null);
    setDbiInicioObs("");
    setDbiInicioError("");
    setDbiInicioFecha(nowLocalDateTimeInput());
    setDbiEventoFecha(nowLocalDateTimeInput());
    setAvaluoOpen(true);

    setShow(true);
  };

  const openVer = async (row) => {
    const freshRow = await apiGet(`${API}/expedientes/${row.id_expediente}`);
    const resolvedTipo = resolveTipoCarpetaFromExpediente(freshRow).tipo;
    setMode("ver");
    setCurrent(freshRow);
    setTipoLockedLocal(false);
    setTipoLockedValue(null);
    setSubcarpeta("");
    setDocsChecklistOpen(false);
    setPlanoViewTipo("proyecto");
    setTipoCarpeta(resolvedTipo);
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFilesByTipo({ proyecto: [], afectacion: [] });
    setPolyUploadNoticeByTipo({ proyecto: null, afectacion: null });
    setDbiCodigo(freshRow?.carpeta_dbi?.codigo || "");
    setDbiCodigoMeu(freshRow?.carpeta_dbi?.codigo_meu || "");
    setDbiSegEstado(
      mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, freshRow?.carpeta_dbi?.seg_estado) ||
        freshRow?.carpeta_dbi?.seg_estado ||
        ""
    );
    setDbiResolNumero(freshRow?.carpeta_dbi?.resolucion?.numero || "");
    setDbiResolFecha(
      freshRow?.carpeta_dbi?.resolucion?.fecha
        ? isoToDateInput(freshRow.carpeta_dbi.resolucion.fecha)
        : ""
    );
    setDbiDecretoNumero(freshRow?.carpeta_dbi?.decreto?.numero || "");
    setDbiDecretoFecha(
      freshRow?.carpeta_dbi?.decreto?.fecha
        ? isoToDateInput(freshRow.carpeta_dbi.decreto.fecha)
        : ""
    );
    setDbiHeaderOpen(false);
    setDbiHeaderBusy(false);
    setDbiHeaderError("");
    setDbiFile(null);
    setDbiInicioObs(freshRow?.carpeta_dbi?.obs || "");
    setDbiInicioError("");
    setDbiInicioFecha(
      freshRow?.carpeta_dbi?.fecha_ingreso
        ? isoToDatetimeLocal(freshRow.carpeta_dbi.fecha_ingreso)
        : nowLocalDateTimeInput()
    );
    setDbiEventoFecha(nowLocalDateTimeInput());
    setAvaluoOpen(true);

    await loadDocs(freshRow.id_expediente);
    await loadCIDocs(freshRow.id_expediente);
    await loadEtapas(freshRow.id_expediente, resolvedTipo);
    await loadVisitas(freshRow.id_expediente, true);
    setShow(true);
  };

  const openEditar = async (row) => {
    const freshRow = await apiGet(`${API}/expedientes/${row.id_expediente}`);
    const resolvedTipo = resolveTipoCarpetaFromExpediente(freshRow).tipo;
    setMode("editar");
    setCurrent(freshRow);
    setTipoLockedLocal(false);
    setTipoLockedValue(null);
    setSubcarpeta("");
    setDocsChecklistOpen(false);
    setPlanoViewTipo("proyecto");
    setTipoCarpeta(resolvedTipo);
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFilesByTipo({ proyecto: [], afectacion: [] });
    setPolyUploadNoticeByTipo({ proyecto: null, afectacion: null });
    setDbiCodigo(freshRow?.carpeta_dbi?.codigo || "");
    setDbiCodigoMeu(freshRow?.carpeta_dbi?.codigo_meu || "");
    setDbiSegEstado(
      mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, freshRow?.carpeta_dbi?.seg_estado) ||
        freshRow?.carpeta_dbi?.seg_estado ||
        ""
    );
    setDbiResolNumero(freshRow?.carpeta_dbi?.resolucion?.numero || "");
    setDbiResolFecha(
      freshRow?.carpeta_dbi?.resolucion?.fecha
        ? isoToDateInput(freshRow.carpeta_dbi.resolucion.fecha)
        : ""
    );
    setDbiDecretoNumero(freshRow?.carpeta_dbi?.decreto?.numero || "");
    setDbiDecretoFecha(
      freshRow?.carpeta_dbi?.decreto?.fecha
        ? isoToDateInput(freshRow.carpeta_dbi.decreto.fecha)
        : ""
    );
    setDbiHeaderOpen(false);
    setDbiHeaderBusy(false);
    setDbiHeaderError("");
    setDbiFile(null);
    setDbiInicioObs(freshRow?.carpeta_dbi?.obs || "");
    setDbiInicioError("");
    setDbiInicioFecha(
      freshRow?.carpeta_dbi?.fecha_ingreso
        ? isoToDatetimeLocal(freshRow.carpeta_dbi.fecha_ingreso)
        : nowLocalDateTimeInput()
    );
    setDbiEventoFecha(nowLocalDateTimeInput());
    setAvaluoOpen(true);

    await loadDocs(freshRow.id_expediente);
    await loadCIDocs(freshRow.id_expediente);
    await loadEtapas(freshRow.id_expediente, resolvedTipo);
    await loadVisitas(freshRow.id_expediente, true);
    setShow(true);
  };

  const buildExpedientePayload = (nextForm = form, nextTipoCarpeta = tipoCarpeta) => {
    const resolvedTipoCode =
      nextForm.tipo_expediente ||
      (nextTipoCarpeta === "terreno" ? "T" : "M");

    return {
      ...nextForm,
      tipo_expediente: resolvedTipoCode,
      documentacion_presentada: normalizeDocList(nextForm.documentacion_presentada),
      porcentaje_afectacion: porcentajeAfectacionCalc || "",
      desafectado_detalle: nextForm.desafectado
        ? buildDesafectadoDetalle(nextForm.desafectado_detalle)
        : null,
    };
  };

  const save = async () => {
    if (!form.fecha_relevamiento || !String(form.fecha_relevamiento).trim()) {
      alert("Fecha relevamiento es obligatoria.");
      return;
    }
    const sup = Number(String(form?.superficie ?? "").trim());
    const supA = Number(String(form?.superficie_afectada ?? "").trim());
    if (Number.isFinite(sup) && Number.isFinite(supA) && supA > sup) {
      alert("La superficie afectada no puede ser mayor que la superficie.");
      return;
    }
  // tipo_expediente: form ya tiene el valor resuelto desde hydrate.
  // El fallback a tipoCarpeta cubre el caso de expedientes recién creados en la
  // misma sesión (mode === "crear") donde hydrateFormFromRow aún no corrió.
    const payload = buildExpedientePayload(form, tipoCarpeta);
    try {
      if (mode === "crear") {
        const created = await apiJson(`${API}/expedientes`, "POST", payload);
        setCurrent(created);
        mergeRow(created);
        setMode("editar");
        await load();
        await loadDocs(created.id_expediente);
        await loadEtapas(created.id_expediente, tipoCarpeta);
        alerts.toast.success("Datos guardados");
        setShow(false);
        return;
      }
      if (mode === "editar" && current) {
        const upd = await apiJson(`${API}/expedientes/${current.id_expediente}`, "PUT", payload);
        setCurrent(upd);
        mergeRow(upd);
        await load();
        alerts.toast.success("Datos guardados");
        setShow(false);
      }
    } catch (e) {
      console.error("Error saving expediente:", e);
      // Usar alert o toast para el error
      const msg = e?.message || String(e);
      if (typeof alerts?.toast?.error === "function") {
        alerts.toast.error(msg);
      } else {
        alert(msg);
      }
    }

  };

  const openDeleteModal = () => {
    if (!current || !canDeleteTotal || readonly) return;
    setDeleteConfirm("");
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const deleteExpediente = async () => {
    if (!current || !canDeleteTotal) return;
    if (!deleteConfirmOk) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const resp = await apiDelete(`${API}/expedientes/${current.id_expediente}`);
      alerts.toast.success("Expediente eliminado");
      if (resp?.warnings?.length) {
        alerts.toast.warning(`Eliminado con advertencias: ${resp.warnings.length}`);
      }
      setShowDeleteModal(false);
      setShow(false);
      setCurrent(null);
      await load();
    } catch (e) {
      setDeleteError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  // =========================
  // UPLOAD DOCUMENTOS / CI
  // =========================
  const uploadDocs = async () => {
    if (!current) return;
    if (!uploadFiles.length) {
      alert("Seleccioná al menos un archivo.");
      return;
    }
    const fd = new FormData();
    uploadFiles.forEach((f) => fd.append("archivo", f));
    fd.append("subcarpeta", subcarpeta || "");
    await apiForm(`${API}/expedientes/${current.id_expediente}/documentos/upload`, "POST", fd);
    setUploadFiles([]);
    await loadDocs(current.id_expediente);
  };

  const uploadCI = async () => {
    if (!current) return;
    if (!ciFrente && !ciDorso) {
      alert("Seleccioná CI frente y/o dorso.");
      return;
    }
    const fd = new FormData();
    if (ciFrente) fd.append("ci_frente", ciFrente);
    if (ciDorso) fd.append("ci_dorso", ciDorso);
    fd.append("subcarpeta", "ci");

    await apiForm(
      `${API}/expedientes/${current.id_expediente}/ci/upload?subcarpeta=${encodeURIComponent("ci")}`,
      "POST",
      fd
    );
    setCiFrente(null);
    setCiDorso(null);
    await loadDocs(current.id_expediente);
    await loadCIDocs(current.id_expediente);
  };

  const uploadCIAdicional = async () => {
    if (!current) return;
    if (!ciAdicionalFrente && !ciAdicionalDorso) {
      alert("Seleccioná CI adicional frente y/o dorso.");
      return;
    }
    const fd = new FormData();
    if (ciAdicionalFrente) fd.append("ci_frente", ciAdicionalFrente);
    if (ciAdicionalDorso) fd.append("ci_dorso", ciAdicionalDorso);
    fd.append("subcarpeta", "ci_adicional");

    await apiForm(
      `${API}/expedientes/${current.id_expediente}/ci/upload?subcarpeta=${encodeURIComponent("ci_adicional")}`,
      "POST",
      fd
    );
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);
    await loadDocs(current.id_expediente);
    await loadCIDocs(current.id_expediente);
  };

  const delDoc = async (idArchivo) => {
    if (!confirm("¿Eliminar documento?")) return;
    await fetch(`${API}/expedientes/documentos/eliminar/${idArchivo}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (current) {
      await loadDocs(current.id_expediente);
      await loadCIDocs(current.id_expediente);
    }
  };

  function isExternalUrl(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    return /^https?:\/\//i.test(s);
  }

  function isImageLikeUrl(value) {
    const s = String(value || "").trim().toLowerCase();
    if (!s) return false;

    if (!/^https?:\/\//i.test(s)) return false;

    // imágenes directas
    if (/\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?|#|$)/i.test(s)) return true;

    // hosts comunes donde el link puede no terminar en .jpg pero igual es imagen
    if (
      s.includes("drive.google.com") ||
      s.includes("docs.google.com") ||
      s.includes("dropbox.com") ||
      s.includes("dl.dropboxusercontent.com") ||
      s.includes("cloudinary.com") ||
      s.includes("amazonaws.com") ||
      s.includes("storage.googleapis.com") ||
      s.includes("supabase.co") ||
      s.includes("firebase")
    ) {
      return true;
    }

    return false;
  }

  function openExternalUrl(url) {
    const clean = String(url || "").trim();
    if (!clean) return;
    window.open(clean, "_blank", "noopener,noreferrer");
  }

  function getDocUrl(doc) {
    return String(
      doc?.ruta_archivo ||
      doc?.ruta ||
      doc?.url ||
      doc?.link ||
      ""
    ).trim();
  }

  function isExternalDoc(doc) {
    const url = getDocUrl(doc);
    return /^https?:\/\//i.test(url);
  }

  async function handleOpenDoc(doc) {
    if (!doc) return;

    const externalUrl = getDocUrl(doc);

    if (/^https?:\/\//i.test(externalUrl)) {
      openExternalUrl(externalUrl);
      return;
    }

    if (doc.id_archivo) {
      await viewDoc(doc);
      return;
    }

    alert("El documento no tiene archivo físico ni URL externa.");
  }

  const viewDoc = async (doc) => {
    if (!doc) return;

    const externalUrl = getDocUrl(doc);
    if (/^https?:\/\//i.test(externalUrl)) {
      openExternalUrl(externalUrl);
      return;
    }

    if (!doc.id_archivo) {
      throw new Error("El documento no tiene archivo local asociado.");
    }

    const resp = await fetch(`${API}/expedientes/documentos/ver/${doc.id_archivo}`, {
      headers: { ...authHeaders() },
    });

    if (!resp.ok) throw new Error(await resp.text());

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");

    if (!w) {
      URL.revokeObjectURL(url);
      return;
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const downloadDoc = async (doc) => {
    if (!doc) return;

    const externalUrl = getDocUrl(doc);
    if (/^https?:\/\//i.test(externalUrl)) {
      openExternalUrl(externalUrl);
      return;
    }

    if (!doc.id_archivo) {
      throw new Error("El documento no tiene archivo local asociado.");
    }

    const resp = await fetch(`${API}/expedientes/documentos/descargar/${doc.id_archivo}`, {
      headers: { ...authHeaders() },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.nombre_archivo || "documento";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  function isPublicImageUrl(value) {
    const s = String(value || "").trim().toLowerCase();
    return (
      (s.startsWith("http://") || s.startsWith("https://")) &&
      (s.endsWith(".jpg") ||
        s.endsWith(".jpeg") ||
        s.endsWith(".png") ||
        s.endsWith(".webp") ||
        s.endsWith(".gif") ||
        s.endsWith(".bmp"))
    );
  }

  const renderImportedImageBox = (url, title) => {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl) return null;

    const looksLikeImage = isImageLikeUrl(cleanUrl);

    return (
      <div
        className="border rounded p-2 mt-2"
        style={{ background: "#fff", width: 220 }}
      >
        <div className="small fw-semibold mb-2">{title}</div>

        {looksLikeImage ? (
          <>
            <div
              role="button"
              onClick={() => openExternalUrl(cleanUrl)}
              style={{
                cursor: "pointer",
                border: "1px solid #ddd",
                borderRadius: 6,
                overflow: "hidden",
                background: "#f8f9fa",
              }}
            >
              <img
                src={cleanUrl}
                alt={title}
                style={{
                  width: "100%",
                  height: 130,
                  objectFit: "cover",
                  display: "block",
                }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  const fallback = e.currentTarget.parentElement?.nextSibling;
                  if (fallback) fallback.style.display = "block";
                }}
              />
            </div>

            <div style={{ display: "none" }} className="small text-muted mt-2">
              No se pudo previsualizar. Abr? el enlace.
            </div>

            <div className="mt-2 d-flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => openExternalUrl(cleanUrl)}
              >
                Ver
              </Button>

              <a
                href={cleanUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-outline-primary"
              >
                Abrir link
              </a>
            </div>
          </>
        ) : (
          <div className="d-flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => openExternalUrl(cleanUrl)}
            >
              Ver archivo
            </Button>

            <a
              href={cleanUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-primary"
            >
              Abrir link
            </a>
          </div>
        )}
      </div>
    );
  };

  const docsBySubcarpeta = useMemo(() => {
    const g = {};
    (docs || []).forEach((d) => {
      const k = d.subcarpeta || "";
      (g[k] ||= []).push(d);
    });
    return g;
  }, [docs]);

  const otherDocs = useMemo(
    () => (docs || []).filter((d) => !ciSubcarpetas.has((d.subcarpeta || "").trim())),
    [docs, ciSubcarpetas]
  );

  const otherDocsBySubcarpeta = useMemo(() => {
    const g = {};
    otherDocs.forEach((d) => {
      const k = d.subcarpeta || "";
      (g[k] ||= []).push(d);
    });
    return g;
  }, [otherDocs]);

  const filtersActive = Boolean(
    String(filterQ || "").trim() ||
      filterTramoId ||
      filterSubtramoId ||
      filterDateStart ||
      filterDateEnd ||
      (filterEstado && filterEstado !== "todos") ||
      filterTipoExp
  );

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;

    const dir = sortDir === "desc" ? -1 : 1;
    const getValue = (r) => {
      switch (sortKey) {
        case "id_expediente":
          return Number(r.id_expediente) || 0;
        case "codigo_exp":
          return String(r.codigo_unico || r.codigo_exp || "").toLowerCase();
        case "propietario_nombre":
          return String(r.propietario_nombre || "").toLowerCase();
        case "propietario_ci":
          return String(r.propietario_ci || "").toLowerCase();
        case "codigo_dbi":
          return String(r?.carpeta_dbi?.codigo || "").toLowerCase();
        case "tramo":
          return String(r.tramo || "").toLowerCase();
        case "fecha_relevamiento": {
          const d = new Date(r.fecha_relevamiento);
          return Number.isNaN(d.getTime()) ? 0 : d.getTime();
        }
        default:
          return "";
      }
    };

    return [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (!key) return;
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const avaluoLabels = useMemo(() => {
    if (tipoCarpeta === "terreno") {
      return { a: "Fracción afectada", b: "Gastos de transferencia" };
    }
    return { a: "Mejoras agroforestales", b: "Mejoras edilicias" };
  }, [tipoCarpeta]);

  const avaluoCalc = useMemo(() => {
    const toNum = (v) => {
      if (v === null || v === undefined) return 0;
      const s = String(v).trim();
      if (!s) return 0;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const parteA = toNum(form?.parte_a);
    const parteB = toNum(form?.parte_b);
    const subtotal = parteA + parteB;
    const premio = form?.premio_aplica ? subtotal * 0.1 : 0;
    const total = subtotal + premio;

    const fmt = (n) =>
      Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return { parteA, parteB, subtotal, premio, total, fmt };
  }, [form?.parte_a, form?.parte_b, form?.premio_aplica]);

  const porcentajeAfectacionCalc = useMemo(() => {
    const rawSup = String(form?.superficie ?? "").trim();
    const rawSupA = String(form?.superficie_afectada ?? "").trim();
    if (!rawSup || !rawSupA) return "";

    const sup = Number(rawSup);
    const supA = Number(rawSupA);
    if (!Number.isFinite(sup) || sup <= 0) return "";
    if (!Number.isFinite(supA) || supA < 0) return "";

    const raw = (supA / sup) * 100;
    if (!Number.isFinite(raw)) return "";
    const rounded = Math.round(raw * 100) / 100;
    return String(rounded);
  }, [form?.superficie, form?.superficie_afectada]);

  const desafectadoDetalleFields = useMemo(
    () => parseDesafectadoDetalle(form?.desafectado_detalle),
    [form?.desafectado_detalle]
  );

  const updateDesafectadoDetalleField = (key, nextValue) => {
    const nextDetail = {
      ...desafectadoDetalleFields,
      [key]: nextValue,
    };
    setForm({
      ...form,
      desafectado_detalle: buildDesafectadoDetalle(nextDetail),
    });
  };

  const isExpedienteOK = (exp) => {
    if (exp?.tipo_expediente === 'M') return exp?.carpeta_mejora?.documentacion_final?.ok === true;
    if (exp?.tipo_expediente === 'T') return exp?.carpeta_terreno?.documentacion_final?.ok === true;
    return false;
  };

  const stats = useMemo(() => {
    const filtered = rows.length;
    const ok = rows.filter(isExpedienteOK).length;
    return { 
      filtered, 
      total: totalRecords || filtered, 
      ok, 
      pending: filtered - ok 
    };
  }, [rows, totalRecords]);

  const dateRangeInvalid = Boolean(filterDateStart && filterDateEnd && filterDateEnd < filterDateStart);

  return (
    <div className="container-fluid px-4 py-3" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* HEADER SECTION - GeoApp Elite Minimalist */}
      <div className="d-flex align-items-center justify-content-between mb-4 mt-2">
        <div>
          <h2 className="fw-bold mb-0 text-dark" style={{ letterSpacing: "-0.02em" }}>Expedientes</h2>
          <div className="d-flex align-items-center gap-2 mt-1">
            <span className="badge bg-light text-secondary border fw-normal py-1 px-3 shadow-sm" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-folder2-open me-2 text-primary"></i>Proyecto: {idProyecto}
            </span>
            <div className="text-muted small border-start ps-2 d-none d-md-block" style={{ fontSize: '0.8rem' }}>
              <span className="fw-bold">{stats.filtered}/{stats.total}</span> Expedientes | <span className="text-success fw-bold">{stats.ok} OK</span> | <span className="text-warning fw-bold">{stats.pending}</span> Pendientes
              {stats.filtered < stats.total && (
                <Badge bg="info" className="ms-2 bg-opacity-10 text-info border border-info border-opacity-25 fw-normal">Filtrado activo</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="d-flex gap-2">
          {canUpload && (
            <Button
              variant="light"
              className="shadow-sm border-0 d-flex align-items-center bg-white text-secondary btn-sm px-3"
              onClick={() => document.getElementById("excel-import-input").click()}
            >
              📥 <span className="ms-2 d-none d-sm-inline">Importar</span>
            </Button>
          )}

          <Button
            variant="light"
            className="shadow-sm border-0 d-flex align-items-center bg-white text-secondary btn-sm px-3"
            onClick={() => setShowExport(true)}
            disabled={!rows.length}
          >
            📊 <span className="ms-2 d-none d-sm-inline">Exportar</span>
          </Button>

          {canCreate && (
            <Button
              variant="primary"
              className="shadow-sm border-0 px-4 fw-semibold btn-sm d-flex align-items-center"
              style={{ backgroundColor: "#0047AB" }} // Cobalt Blue
              onClick={openCrear}
            >
              <i className="bi bi-plus-lg me-2"></i> Nuevo
            </Button>
          )}

          <Link
            className="btn btn-outline-success border-0 bg-white btn-sm shadow-sm d-flex align-items-center px-3"
            to={`/proyectos/${id}/gv-catastro`}
          >
            🗺️ <span className="ms-1 d-none d-sm-inline">Mapa</span>
          </Link>
        </div>
      </div>

      {/* SEARCH PANEL - GeoApp Elite */}
      <div
        className="p-4 rounded-4 mb-4 shadow-sm border-0"
        style={{ background: "#F9FAFB", border: "1px solid #F0F2F5" }}
      >
        <Row className="g-3 align-items-center">
          {/* Main Search Minimalist */}
          <Col lg={7}>
            <div className="position-relative">
              <Form.Control
                size="lg"
                placeholder="Buscar por Nro. Notificación Único o nombre..."
                className="ps-5 border-0 shadow-sm rounded-3"
                style={{ height: "50px", fontSize: "1rem" }}
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (qDebounceRef.current) {
                      clearTimeout(qDebounceRef.current);
                      qDebounceRef.current = null;
                    }
                    load({ q: e.currentTarget.value });
                  }
                }}
              />
              <span
                className="position-absolute translate-middle-y top-50 start-0 ps-3 text-muted opacity-50"
                style={{ fontSize: "1.1rem" }}
              >
                🔍
              </span>
            </div>
          </Col>

          {/* Quick Stats & Filters Toggle */}
          <Col lg={5}>
            <div className="d-flex gap-2 justify-content-lg-end">
              <Button
                variant={dateRangeInvalid ? "secondary" : "white"}
                size="lg"
                className="border-0 shadow-sm rounded-3 fw-bold bg-white text-dark w-100"
                style={{ height: "50px", fontSize: "0.9rem", backgroundColor: dateRangeInvalid ? "#E5E7EB !important" : "white" }}
                onClick={() => load()}
                disabled={loading || dateRangeInvalid}
              >
                {loading ? "Cargando..." : dateRangeInvalid ? "FECHAS INVÁLIDAS" : "BUSCAR"}
              </Button>
              <Button
                variant="light"
                size="lg"
                className="border-0 shadow-sm rounded-3 bg-white text-muted px-4 d-flex align-items-center justify-content-center gap-2"
                style={{ height: "50px", fontSize: "0.9rem", fontWeight: "500" }}
                onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              >
                <i className={`bi bi-sliders2${showAdvancedSearch ? '-vertical' : ''}`}></i>
                <span className="d-none d-sm-inline">Filtros Avanzados</span>
              </Button>
            </div>
          </Col>
        </Row>

        <Collapse in={showAdvancedSearch}>
          <div className="pt-4 border-top mt-4" style={{ transition: "all 300ms ease-in-out" }}>
            <Row className="g-4">
              {/* Bloque A: Identificación & Carpeta */}
              <Col md={4}>
                <Form.Label className="fw-medium text-uppercase mb-2" style={{ letterSpacing: '0.05em', color: '#64748B', fontSize: '12px' }}>Tipo de Carpeta</Form.Label>
                <div className="d-flex gap-1 bg-white p-1 rounded-3 shadow-sm border">
                  {['todo', 'M', 'T'].map((tipo) => (
                    <Button
                      key={tipo}
                      size="sm"
                      variant={(!filterTipoExp && tipo === 'todo') || (filterTipoExp === tipo) ? 'primary' : 'white'}
                      className={`flex-grow-1 border-0 py-2 rounded-2 ${((!filterTipoExp && tipo === 'todo') || (filterTipoExp === tipo)) ? 'shadow-sm' : 'text-muted'}`}
                      style={{ 
                        fontSize: '11px', 
                        fontWeight: '600', 
                        backgroundColor: ((!filterTipoExp && tipo === 'todo') || (filterTipoExp === tipo)) ? '#0047AB' : 'transparent', 
                        color: ((!filterTipoExp && tipo === 'todo') || (filterTipoExp === tipo)) ? '#FFFFFF' : '#64748B' 
                      }}
                      onClick={() => {
                        const next = tipo === 'todo' ? null : tipo;
                        setFilterTipoExp(next);
                        load({ tipoExp: next });
                      }}
                    >
                      {tipo === 'todo' ? 'TODAS' : tipo === 'M' ? 'MEJORA' : 'TERRENO'}
                    </Button>
                  ))}
                </div>
              </Col>

              {/* Bloque B: Cronología (Fechas de Proceso) */}
              <Col md={5}>
                <Form.Label className="fw-medium text-uppercase mb-2" style={{ letterSpacing: '0.05em', color: dateRangeInvalid ? '#DC2626' : '#64748B', fontSize: '12px' }}>
                  Rango de Relevamiento {dateRangeInvalid && <span style={{ fontSize: '10px' }}>(REVISAR RANGO)</span>}
                </Form.Label>
                <div className="d-flex gap-2 align-items-center">
                  <Form.Control
                    type="date"
                    size="sm"
                    className="border-0 shadow-sm rounded-2 py-2"
                    style={{ border: dateRangeInvalid ? '1px solid #DC2626' : '1px solid #E2E8F0', padding: '0.5rem' }}
                    value={filterDateStart}
                    onChange={(e) => {
                      const start = e.target.value;
                      setFilterDateStart(start);
                      load({ dateStart: start });
                    }}
                  />
                  <span className="text-muted small">→</span>
                  <Form.Control
                    type="date"
                    size="sm"
                    className="border-0 shadow-sm rounded-2 py-2"
                    style={{ border: dateRangeInvalid ? '1px solid #DC2626' : '1px solid #E2E8F0', padding: '0.5rem' }}
                    value={filterDateEnd}
                    onChange={(e) => {
                      const end = e.target.value;
                      setFilterDateEnd(end);
                      if (!filterDateStart || end >= filterDateStart) {
                        load({ dateEnd: end });
                      }
                    }}
                  />
                </div>
              </Col>

              {/* Bloque C: Estado Operativo */}
              <Col md={3}>
                <Form.Label className="fw-medium text-uppercase mb-2" style={{ letterSpacing: '0.05em', color: '#64748B', fontSize: '12px' }}>Situación</Form.Label>
                <Form.Select
                  size="sm"
                  className="border-0 shadow-sm rounded-2 py-2 text-secondary"
                  style={{ border: '1px solid #E2E8F0' }}
                  value={filterEstado}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilterEstado(v);
                    load({ estado: v });
                  }}
                >
                  <option value="todos">Todos los estados</option>
                  <option value="activo">Solo Activos</option>
                  <option value="inactivo">Desafectados</option>
                </Form.Select>
              </Col>
            </Row>

            <Row className="g-4 mt-1">
              <Col md={4}>
                <Form.Label className="fw-medium text-uppercase mb-2" style={{ color: '#64748B', fontSize: '12px' }}>Tramo</Form.Label>
                <Form.Select
                  size="sm"
                  className="border-0 shadow-sm rounded-2 py-2 text-secondary"
                  style={{ border: '1px solid #E2E8F0' }}
                  value={filterTramoId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilterTramoId(v);
                    setFilterSubtramoId("");
                    if (v) {
                      const tramoId = normalizePositiveId(v);
                      if (tramoId) {
                        apiGet(`${API}/proyectos/${idProyecto}/tramos-censales/${tramoId}/subtramos`)
                          .then((data) => setSubtramosCensales(Array.isArray(data?.items) ? data.items : []))
                          .catch(() => setSubtramosCensales([]));
                      } else {
                        setSubtramosCensales([]);
                      }
                    } else {
                      setSubtramosCensales([]);
                    }
                    load({ tramoId: v, subtramoId: "" });
                  }}
                >
                  <option value="">Cualquiera</option>
                  {tramosCensales.map((t) => (
                    <option key={t.id_proyecto_tramo} value={t.id_proyecto_tramo}>
                      {t.descripcion}
                    </option>
                  ))}
                </Form.Select>
              </Col>

              <Col md={4}>
                <Form.Label className="fw-medium text-uppercase mb-2" style={{ color: '#64748B', fontSize: '12px' }}>Subtramo</Form.Label>
                <Form.Select
                  size="sm"
                  className="border-0 shadow-sm rounded-2 py-2 text-secondary"
                  style={{ border: '1px solid #E2E8F0' }}
                  value={filterSubtramoId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFilterSubtramoId(v);
                    load({ subtramoId: v });
                  }}
                  disabled={!filterTramoId}
                >
                  <option value="">Cualquiera</option>
                  {subtramosCensales.map((st) => (
                    <option key={st.id_proyecto_subtramo} value={st.id_proyecto_subtramo}>
                      {st.descripcion}
                    </option>
                  ))}
                </Form.Select>
              </Col>

              <Col md={4} className="d-flex align-items-end">
                <Button
                  variant="outline-danger"
                  className="w-100 border-0 bg-white shadow-sm rounded-2 py-2 fw-bold"
                  style={{ fontSize: '0.8rem' }}
                  onClick={() => {
                    setFilterQ("");
                    setFilterTramoId("");
                    setFilterSubtramoId("");
                    setFilterDateStart("");
                    setFilterDateEnd("");
                    setFilterEstado("todos");
                    setFilterTipoExp(null);
                    setSubtramosCensales([]);
                    load({ q: "", tramoId: "", subtramoId: "", dateStart: "", dateEnd: "", estado: "todos", tipoExp: null });
                  }}
                  disabled={loading}
                >
                  RESETEAR FILTROS
                </Button>
              </Col>
            </Row>
          </div>
        </Collapse>

        {/* ACTIVE FILTER BADGES - GeoApp Elite Style */}
        {filtersActive && (
          <div className="mt-4 d-flex flex-wrap gap-2 align-items-center border-top pt-3">
            <span className="small text-secondary fw-bold text-uppercase me-2" style={{ fontSize: "0.65rem", letterSpacing: '0.1em' }}>
              Filtros Aplicados:
            </span>
            {filterQ && (
              <Badge bg="white" text="dark" className="shadow-sm border-0 px-3 py-2 fw-normal rounded-pill d-flex align-items-center" style={{ background: '#F0F9FF', color: '#0369A1' }}>
                <span className="opacity-50 me-1">Búsqueda:</span> "{filterQ}" 
                <span role="button" className="ms-2 text-danger fw-bold px-2 py-1" style={{ fontSize: '1.2rem', lineHeight: '1' }} onClick={() => { setFilterQ(""); load({ q: "" }); }}>×</span>
              </Badge>
            )}
            {(filterDateStart || filterDateEnd) && (
              <Badge bg="white" text="dark" className="shadow-sm border-0 px-3 py-2 fw-normal rounded-pill d-flex align-items-center" style={{ background: '#F0F9FF', color: '#0369A1' }}>
                📅 {filterDateStart || "..."} — {filterDateEnd || "..."}
                <span role="button" className="ms-2 text-danger fw-bold px-2 py-1" style={{ fontSize: '1.2rem', lineHeight: '1' }} onClick={() => { setFilterDateStart(""); setFilterDateEnd(""); load({ dateStart: "", dateEnd: "" }); }}>×</span>
              </Badge>
            )}
            {filterEstado !== "todos" && (
              <Badge bg="white" text="dark" className="shadow-sm border-0 px-3 py-2 fw-normal rounded-pill d-flex align-items-center" style={{ background: '#F0F9FF', color: '#0369A1' }}>
                <span className="opacity-50 me-1">Estado:</span> {filterEstado === "activo" ? "Activo" : "Desafectado"}
                <span role="button" className="ms-2 text-danger fw-bold px-2 py-1" style={{ fontSize: '1.2rem', lineHeight: '1' }} onClick={() => { setFilterEstado("todos"); load({ estado: "todos" }); }}>×</span>
              </Badge>
            )}
            {filterTipoExp && (
              <Badge bg="white" text="dark" className="shadow-sm border-0 px-3 py-2 fw-normal rounded-pill d-flex align-items-center" style={{ background: '#F0F9FF', color: '#0369A1' }}>
                <span className="opacity-50 me-1">Carpeta:</span> {filterTipoExp === "M" ? "Mejora" : "Terreno"}
                <span role="button" className="ms-2 text-danger fw-bold px-2 py-1" style={{ fontSize: '1.2rem', lineHeight: '1' }} onClick={() => { setFilterTipoExp(null); load({ tipoExp: null }); }}>×</span>
              </Badge>
            )}
            <Button
              variant="link"
              className="p-0 small text-danger text-decoration-none fw-bold ms-auto"
              style={{ fontSize: '0.75rem' }}
              onClick={() => {
                setFilterQ("");
                setFilterTramoId("");
                setFilterSubtramoId("");
                setFilterDateStart("");
                setFilterDateEnd("");
                setFilterEstado("todos");
                setFilterTipoExp(null);
                setSubtramosCensales([]);
                load({ q: "", tramoId: "", subtramoId: "", dateStart: "", dateEnd: "", estado: "todos", tipoExp: null });
              }}
            >
              LIMPIAR TODO
            </Button>
          </div>
        )}
      </div>

      {/* SMART COUNT & BULK ACTIONS */}
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div className="text-secondary small fw-medium" style={{ fontSize: '0.85rem' }}>
          Mostrando <span className="text-primary fw-bold">{stats.filtered}</span> de <span className="text-dark fw-bold">{stats.total}</span> expedientes
          {stats.filtered < stats.total && (
            <span className="ms-2 text-info opacity-75">(Viendo una parte del universo)</span>
          )}
        </div>
        {selectedIds.length > 0 && (
          <Button
            variant="outline-danger"
            size="sm"
            className="rounded-pill px-3 fw-bold shadow-sm d-flex align-items-center gap-2"
            onClick={eliminarSeleccionados}
            disabled={bulkDeleting}
            style={{ fontSize: '0.8rem' }}
          >
            <i className="bi bi-trash3-fill"></i>
            Eliminar Seleccionados ({selectedIds.length})
          </Button>
        )}
      </div>

      <div className="table-responsive rounded-4 shadow-sm border" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", background: "#fff" }}>
        <Table hover size="sm" className="align-middle mb-0" style={{ minWidth: 980 }}>
          <thead className="bg-light sticky-top" style={{ zIndex: 10 }}>
            <tr style={{ height: "54px", backgroundColor: '#F8FAFC' }}>
              <th className="px-3" style={{ width: 44 }}>
                <Form.Check
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={allSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  disabled={!rows.length || bulkDeleting}
                  aria-label="Seleccionar todos"
                />
              </th>
              <th role="button" className="small text-uppercase text-secondary fw-bold" onClick={() => toggleSort("codigo_exp")}>
                Nro. Notif. Único{sortIndicator("codigo_exp")}
              </th>
              <th role="button" className="small text-uppercase text-secondary fw-bold" onClick={() => toggleSort("codigo_dbi")}>
                DBI{sortIndicator("codigo_dbi")}
              </th>
              <th role="button" className="small text-uppercase text-secondary fw-bold" onClick={() => toggleSort("propietario_nombre")}>
                Titular{sortIndicator("propietario_nombre")}
              </th>
              <th role="button" className="small text-uppercase text-secondary fw-bold" onClick={() => toggleSort("propietario_ci")}>
                Documento{sortIndicator("propietario_ci")}
              </th>
              <th role="button" className="small text-uppercase text-secondary fw-bold" onClick={() => toggleSort("tramo")}>
                Tramo{sortIndicator("tramo")}
              </th>
              <th className="small text-uppercase text-secondary fw-bold">Carpeta</th>
              <th role="button" className="small text-uppercase text-secondary fw-bold text-center" onClick={() => toggleSort("fecha_relevamiento")}>
                📅 Fecha{sortIndicator("fecha_relevamiento")}
              </th>
              <th className="small text-uppercase text-secondary fw-bold text-center" style={{ width: 140 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={9} className="text-center text-muted py-5 mx-auto">
                  {loading ? (
                    <div className="d-flex flex-column align-items-center">
                      <div className="spinner-border spinner-border-sm text-primary mb-2" role="status"></div>
                      <span>Sincronizando registros...</span>
                    </div>
                  ) : (
                    <div className="py-4">
                      <span className="d-block fs-2 mb-2">📂</span>
                      <span className="fw-semibold">No se encontraron expedientes</span>
                      <p className="small text-muted mb-0">Intenta ajustar los criterios de búsqueda</p>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {sortedRows.map((r) => (
              <tr 
                key={r.id_expediente} 
                className={r.desafectado ? "opacity-70 grayscale-row" : ""} 
                style={r.desafectado ? { background: '#F9FAFB', borderLeft: '4px dotted #CBD5E1' } : {}}
              >
                <td className="px-3">
                  <Form.Check
                    type="checkbox"
                    checked={selectedSet.has(Number(r.id_expediente))}
                    onChange={(e) =>
                      toggleSelectOne(Number(r.id_expediente), e.target.checked)
                    }
                    disabled={bulkDeleting}
                  />
                </td>
                <td className="fw-bold text-dark" style={{ fontSize: '0.9rem' }}>
                  {r.codigo_unico || r.codigo_exp || "—"}
                  {r.desafectado && <span className="ms-2 badge bg-secondary" style={{ fontSize: '0.6rem' }}>DESAFECTADO</span>}
                </td>
                <td className="small text-muted">{r?.carpeta_dbi?.codigo || "—"}</td>
                <td className="fw-medium">{r.propietario_nombre}</td>
                <td className="small text-muted font-monospace">{r.propietario_ci}</td>
                <td className="small text-secondary">{r.tramo}</td>
                <td>
                  {(() => {
                    const hasMejora = hasActiveStages(r?.carpeta_mejora);
                    const hasTerreno = hasActiveStages(r?.carpeta_terreno);
                    if (hasMejora && !hasTerreno) return <Badge bg="light" text="primary" className="border fw-normal px-2 py-1">Mejora</Badge>;
                    if (hasTerreno && !hasMejora) return <Badge bg="light" text="success" className="border fw-normal px-2 py-1">Terreno</Badge>;
                    if (hasMejora && hasTerreno) return <Badge bg="light" text="warning" className="border fw-normal px-2 py-1">Legacy</Badge>;
                    return <Badge bg="light" text="secondary" className="border fw-normal px-2 py-1 opacity-50">S/I</Badge>;
                  })()}
                </td>
                <td className="text-center small text-muted">
                  {r.fecha_relevamiento ? String(r.fecha_relevamiento).slice(0, 10) : "—"}
                </td>
                <td className="text-center px-4">
                  <div className="d-flex gap-2 justify-content-center">
                    <Button 
                      variant="outline-primary" 
                      className="d-flex align-items-center gap-2 px-3 border-0 bg-transparent text-primary hover-bg-light"
                      style={{ fontSize: '13px', fontWeight: '500' }}
                      onClick={() => openVer(r)} 
                    >
                      <i className="bi bi-eye"></i>
                      <span>Ver</span>
                    </Button>
                    {canUpdate && (
                      <Button 
                        variant="outline-secondary" 
                        className="d-flex align-items-center gap-2 px-3 border-0 bg-transparent text-secondary hover-bg-light"
                        style={{ fontSize: '13px', fontWeight: '500' }}
                        onClick={() => openEditar(r)}
                      >
                        <i className="bi bi-pencil-square"></i>
                        <span>Editar</span>
                      </Button>
                    )}
                    {canDelete && (
                      <Button 
                        variant="outline-danger" 
                        className="d-flex align-items-center gap-2 px-3 border-0 bg-transparent text-danger hover-bg-light"
                        style={{ fontSize: '13px', fontWeight: '500' }}
                        onClick={() => eliminar(r)}
                        disabled={bulkDeleting}
                      >
                        <i className="bi bi-trash"></i>
                        <span>Eliminar</span>
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {/* =========================
          MODAL CRUD
        ========================= */}
      <Modal
        show={show}
        onHide={() => {
          setShow(false);
          setDocsChecklistOpen(false);
          setShowVisitaModal(false);
        }}
        size="xl"
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {mode === "crear" ? "Nuevo Expediente" : mode === "editar" ? "Editar Expediente" : "Ver Expediente"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {/* --- datos básicos --- */}
          <Row className="g-3">
            <Col md={3}>
              <Form.Group>
                <Form.Label>Fecha</Form.Label>
                <Form.Control
                  type="date"
                  value={form.fecha_relevamiento}
                  required
                  disabled={readonly}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setForm({ ...form, fecha_relevamiento: v });
                  }}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Técnico</Form.Label>
                <Form.Control
                  value={form.tecnico}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, tecnico: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={3} style={{ display: "none" }}>
              <Form.Group>
                <Form.Label>Nro. Notificación Base (Oculto)</Form.Label>
                <Form.Control value={form.codigo_exp} readOnly disabled={readonly} />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Nro. Notificación Único</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={form.codigo_unico || ""}
                    placeholder="Se genera al guardar"
                    disabled={readonly}
                    isInvalid={
                      (form.codigo_unico && !isCodigoUnicoValid(form.codigo_unico)) ||
                      (form.codigo_unico && !isCodigoUnicoConsistent(form.codigo_unico, form.codigo_exp)) ||
                      (form.codigo_unico && !isCodigoUnicoTypeConsistent(form.codigo_unico, form.tipo_expediente || (tipoCarpeta === "terreno" ? "T" : "M")))
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      const base = val.split("-")[0];
                      // Sincronizamos la base (aunque esté oculta) para que el estado
                      // del formulario sea consistente para el guardado.
                      setForm((prev) => ({ ...prev, codigo_unico: val, codigo_exp: base }));
                    }}
                  />
                  {can("admin") && current?.id_expediente && (
                    <Button
                      variant="outline-warning"
                      size="sm"
                      title="Resetear código único (Admin)"
                      onClick={handleResetCodigoUnico}
                    >
                      Reset
                    </Button>
                  )}
                </div>
                <Form.Control.Feedback type="invalid" style={{ display: (form.codigo_unico && !isCodigoUnicoValid(form.codigo_unico)) || (form.codigo_unico && !isCodigoUnicoConsistent(form.codigo_unico, form.codigo_exp)) || (form.codigo_unico && !isCodigoUnicoTypeConsistent(form.codigo_unico, form.tipo_expediente || (tipoCarpeta === "terreno" ? "T" : "M"))) ? 'block' : 'none' }}>
                  {form.codigo_unico && !isCodigoUnicoValid(form.codigo_unico)
                    ? "Formato inválido. Debe ser BASE-N-TIPO (ej: 55-1-T) sin ceros a la izquierda."
                    : (form.codigo_unico && !isCodigoUnicoConsistent(form.codigo_unico, form.codigo_exp))
                      ? "Inconsistencia: La base del código único no coincide con la notificación base."
                      : "Inconsistencia: El sufijo del código (-T/-M) no coincide con el tipo de carpeta seleccionado."}
                </Form.Control.Feedback>

                {!baseAvailability.available && (
                  <div className="text-warning x-small mt-1" style={{ fontSize: '0.8rem', fontWeight: '500' }}>
                    ℹ️ Existen otras carpetas con esta base: {baseAvailability.existing.map(e => `${e.propietario_nombre} (${e.codigo_unico})`).join(", ")}
                  </div>
                )}
              </Form.Group>
            </Col>

            <Col md={12}>
              <Form.Group>
                <Form.Label>GPS</Form.Label>
                <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap">
                  <div className="text-muted small">
                    {Array.isArray(gpsCoords) ? (
                      <>
                        Lat: {formatGpsDecimal(gpsCoords[0])} · Lng: {formatGpsDecimal(gpsCoords[1])}
                      </>
                    ) : (
                      <>Lat: — · Lng: —</>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Button
                      size="sm"
                      variant={readonly ? "outline-secondary" : "outline-primary"}
                      disabled={!geometryEditable && !hasGpsCoords}
                      onClick={() => gpsFieldRef.current?.openMap?.()}
                    >
                      {readonly ? "Ver en mapa" : hasGpsCoords ? "Editar en mapa" : "Seleccionar en mapa"}
                    </Button>
                    {hasGpsCoords && geometryEditable && (
                      <Button
                        size="sm"
                        variant="link"
                        className="p-0 text-muted"
                        onClick={() => setForm({ ...form, gps: "" })}
                      >
                        Limpiar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="d-none">
                  <ExpedienteGpsField
                    ref={gpsFieldRef}
                    value={form.gps}
                    onChange={(gps) => setForm({ ...form, gps })}
                    onOpenMap={() => {
                      if (!geometryEditable) return;
                      if (current?.id_expediente) {
                        loadPlanoGeo(current.id_expediente, tipoCarpeta, "proyecto");
                        loadCatastroFeatures();
                      }
                    }}
                    readOnlyGeometry={readOnlyGeometry}
                    readOnly={readonly}
                    disabled={readonly ? false : !geometryEditable}
                  />
                </div>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Nombre del Propietario</Form.Label>
                <Form.Control
                  value={form.propietario_nombre}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, propietario_nombre: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Teléfono</Form.Label>
                <Form.Control
                  value={form.telefono || ""}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>C.I.</Form.Label>
                <Form.Control
                  value={form.propietario_ci}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, propietario_ci: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={8}>
              <Form.Group>
                <Form.Label>Nombre del co-titular</Form.Label>
                <Form.Control
                  value={form.pareja_nombre}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, pareja_nombre: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>C.I. del co-titular</Form.Label>
                <Form.Control
                  value={form.pareja_ci}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, pareja_ci: e.target.value })}
                />
              </Form.Group>
            </Col>

            <Col md={12}>
              <Row className="g-2">
                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Tramo Censal</Form.Label>
                    <Form.Select
                      value={form.id_tramo ?? ""}
                      disabled={readonly}
                      onChange={(e) => {
                        const tramoId = normalizePositiveId(e.target.value);
                        setForm({
                          ...form,
                          id_tramo: tramoId,
                          id_sub_tramo: null,
                        });
                      }}
                    >
                      <option value="">— Sin tramo (legacy) —</option>
                      {tramosCensales.map((t, idx) => (
                        <option key={`tramo-${t.id_proyecto_tramo}-${idx}`} value={t.id_proyecto_tramo}>
                          {t.descripcion}
                        </option>
                      ))}
                    </Form.Select>
                    {form.id_tramo != null && (
                      <div className="text-muted small mt-1">
                        Universo censal: {tramosCensales.find((t) => t.id_proyecto_tramo === form.id_tramo)?.cantidad_universo || 0}
                      </div>
                    )}
                  </Form.Group>
                </Col>

                <Col md={4}>
                  <Form.Group>
                    <Form.Label>SubTramo Censal</Form.Label>
                    <Form.Select
                      value={form.id_sub_tramo ?? ""}
                      disabled={readonly || !form.id_tramo}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          id_sub_tramo: normalizePositiveId(e.target.value),
                        })
                      }
                    >
                      <option value="">— Ninguno —</option>
                      {subtramosCensales.map((st, idx) => (
                        <option key={`subtramo-${st.id_proyecto_subtramo}-${idx}`} value={st.id_proyecto_subtramo}>
                          {st.descripcion}
                        </option>
                      ))}
                    </Form.Select>
                    {form.id_sub_tramo != null && (
                      <div className="text-muted small mt-1">
                        Universo censal: {subtramosCensales.find((st) => st.id_proyecto_subtramo === form.id_sub_tramo)?.cantidad_universo || 0}
                      </div>
                    )}
                  </Form.Group>
                </Col>

                <Col md={4}>
                  <Form.Group>
                    <Form.Label>Código Censal (Asignado)</Form.Label>
                    <Form.Control
                      value={form.codigo_censo || ""}
                      disabled={readonly}
                      onChange={(e) => setForm({ ...form, codigo_censo: e.target.value })}
                      placeholder="Ej: CEN-001"
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group>
                    <Form.Label>Padrón</Form.Label>
                    <Form.Control
                      value={form.padron || ""}
                      disabled={readonly}
                      onChange={(e) => setForm({ ...form, padron: e.target.value })}
                      placeholder="Ej: 12345"
                    />
                  </Form.Group>
                </Col>

                <Col md={6}>
                  <Form.Group>
                    <Form.Label>CTA Cte Catastral</Form.Label>
                    <Form.Control
                      value={form.cta_cte_catastral || ""}
                      disabled={readonly}
                      onChange={(e) => setForm({ ...form, cta_cte_catastral: e.target.value })}
                      placeholder="Ej: 00-0000-0000"
                    />
                  </Form.Group>
                </Col>

                <div className="text-muted small mt-2">
                  * La descripción de tramo se resolverá dinámicamente al guardar; el input libre fue depreciado.
                </div>

                {(onlyMejoraActive || onlyTerrenoActive || legacyBothActive) && (
                  <div className="mt-2">
                    {legacyBothActive && (
                      <Badge bg="warning" className="me-2">
                        Expediente histórico (Mejora + Terreno)
                      </Badge>
                    )}
                    {!legacyBothActive && onlyMejoraActive && (
                      <Badge bg="info">Expediente tipo Mejora</Badge>
                    )}
                    {!legacyBothActive && onlyTerrenoActive && (
                      <Badge bg="info">Expediente tipo Terreno</Badge>
                    )}
                  </div>
                )}
              </Row>
            </Col>
          </Row>

          {/* --- datos operativos / afectación --- */}
          <Row className="g-3">
            <Col md={12}>
              <div className="border rounded p-3">
                <h5 className="mb-3">Datos operativos / afectación</h5>
                <Row className="g-3">
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Superficie</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.superficie}
                        disabled={readonly}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (String(v).startsWith("-")) return;
                          let nextSuperficieAfectada = form.superficie_afectada;
                          const sup = Number(String(v || "").trim());
                          const supA = Number(String(form.superficie_afectada || "").trim());
                          if (
                            Number.isFinite(sup) &&
                            sup > 0 &&
                            Number.isFinite(supA) &&
                            supA > sup
                          ) {
                            nextSuperficieAfectada = String(sup);
                          }
                          setForm({
                            ...form,
                            superficie: v,
                            superficie_afectada: nextSuperficieAfectada,
                          });
                        }}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Superficie afectada</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        max={form.superficie || undefined}
                        value={form.superficie_afectada}
                        disabled={readonly}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (String(v).startsWith("-")) return;
                          const sup = Number(String(form.superficie || "").trim());
                          const supA = Number(String(v || "").trim());
                          const nextValue =
                            Number.isFinite(sup) && sup > 0 && Number.isFinite(supA) && supA > sup
                              ? String(sup)
                              : v;
                          setForm({ ...form, superficie_afectada: nextValue });
                        }}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Progresiva inicio</Form.Label>
                      <Form.Control
                        value={form.progresiva_ini}
                        disabled={readonly}
                        onChange={(e) => setForm({ ...form, progresiva_ini: e.target.value })}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Progresiva fin</Form.Label>
                      <Form.Control
                        value={form.progresiva_fin}
                        disabled={readonly}
                        onChange={(e) => setForm({ ...form, progresiva_fin: e.target.value })}
                      />
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Margen</Form.Label>
                      <Form.Select
                        value={form.margen || ""}
                        disabled={readonly}
                        onChange={(e) => setForm({ ...form, margen: e.target.value })}
                      >
                        <option value="">— Seleccionar —</option>
                        <option value="izquierda">izquierda</option>
                        <option value="derecha">derecha</option>
                        <option value="centro">centro</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>% afectación</Form.Label>
                      <Form.Control
                        type="number"
                        min="0"
                        step="0.01"
                        value={porcentajeAfectacionCalc}
                        readOnly
                        disabled={readonly}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3} className="d-flex align-items-end">
                    <Form.Check
                      type="checkbox"
                      id="exp-desafectado"
                      label="Desafectado"
                      checked={!!form.desafectado}
                      disabled={readonly}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          desafectado: e.target.checked,
                          desafectado_detalle: e.target.checked
                            ? buildDesafectadoDetalle(form.desafectado_detalle)
                            : null,
                        })
                      }
                    />
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Percepción notificador</Form.Label>
                      <Form.Select
                        value={form.percepcion_notificador || ""}
                        disabled={readonly}
                        onChange={(e) => setForm({ ...form, percepcion_notificador: e.target.value })}
                      >
                        <option value="">— Seleccionar —</option>
                        <option value="buena">buena</option>
                        <option value="neutra">neutra</option>
                        <option value="mala">mala</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>

                  <Col md={12}>
                    <Form.Group>
                      <Form.Label>Observación notificador</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        value={form.observacion_notificador}
                        disabled={readonly}
                        onChange={(e) =>
                          setForm({ ...form, observacion_notificador: e.target.value })
                        }
                      />
                    </Form.Group>
                  </Col>
                  {form.desafectado && (
                    <>
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label>Fecha desafectación</Form.Label>
                          <Form.Control
                            type="date"
                            value={desafectadoDetalleFields.fecha}
                            disabled={readonly}
                            onChange={(e) => updateDesafectadoDetalleField("fecha", e.target.value)}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={5}>
                        <Form.Group>
                          <Form.Label>Motivo desafectación</Form.Label>
                          <Form.Control
                            value={desafectadoDetalleFields.motivo}
                            disabled={readonly}
                            onChange={(e) => updateDesafectadoDetalleField("motivo", e.target.value)}
                            placeholder="Ej: Cambio de trazado"
                          />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Tipo desafectación</Form.Label>
                          <Form.Select
                            value={desafectadoDetalleFields.tipo}
                            disabled={readonly}
                            onChange={(e) => updateDesafectadoDetalleField("tipo", e.target.value)}
                          >
                            <option value="">— Seleccionar —</option>
                            <option value="total">total</option>
                            <option value="parcial">parcial</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={12}>
                        <Form.Group>
                          <Form.Label>Observación</Form.Label>
                          <Form.Control
                            as="textarea"
                            rows={3}
                            value={desafectadoDetalleFields.observacion}
                            disabled={readonly}
                            onChange={(e) => updateDesafectadoDetalleField("observacion", e.target.value)}
                            placeholder="Detalle de la desafectación"
                          />
                        </Form.Group>
                      </Col>
                    </>
                  )}
                </Row>
              </div>
            </Col>
          </Row>

          {/* --- documentación presentada --- */}
          <Row className="g-3">
            <Col md={12}>
              <div className="border rounded p-3">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <h5 className="mb-0">Documentación presentada</h5>
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => setDocsChecklistOpen(true)}
                  >
                    {readonly ? "Ver documentación" : "Editar documentación"}
                  </Button>
                </div>
                <div className="text-muted small mt-1">
                  Checklist operativo (no son archivos físicos).
                </div>
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {(form.documentacion_presentada || []).length === 0 && (
                    <span className="text-muted small">Sin documentos marcados</span>
                  )}
                  {(form.documentacion_presentada || []).map((key) => {
                    const item = DOCS_CATALOG.find((d) => d.value === key);
                    return (
                      <Badge bg="secondary" key={`doc-presentada-${key}`}>
                        {item?.label || key}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </Col>
          </Row>

          {/* --- historial de visitas --- */}
          <Row className="g-3">
            <Col md={12}>
              <div className="border rounded p-3">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <h5 className="mb-0">Historial de visitas</h5>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={openCrearVisita}
                    disabled={!current?.id_expediente || !canUpdate}
                  >
                    Agregar visita
                  </Button>
                </div>

                {!current?.id_expediente && (
                  <div className="text-muted small mt-2">
                    Guardá el expediente para habilitar el historial de visitas.
                  </div>
                )}

                {!!current?.id_expediente && (
                  <>
                    {visitasLoading && (
                      <div className="text-muted small mt-2">Cargando visitas…</div>
                    )}
                    {visitasError && (
                      <div className="text-danger small mt-2">{visitasError}</div>
                    )}

                    {!visitasLoading && !visitasError && (
                      <>
                        {(!visitas || visitas.length === 0) ? (
                          <div className="text-muted small mt-2">Sin visitas registradas</div>
                        ) : (
                          <div className="table-responsive mt-2">
                            <Table bordered size="sm" className="align-middle">
                              <thead>
                                <tr>
                                  <th style={{ width: 120 }}>Fecha</th>
                                  <th style={{ width: 180 }}>Consultor</th>
                                  <th>Motivo</th>
                                  <th>Respuesta</th>
                                  <th style={{ width: 220 }}>Documentos recibidos</th>
                                  <th style={{ width: 110 }}>Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visitas.map((v) => (
                                  <tr key={`visita-${v.id_historial_visita || v.fecha || Math.random()}`}>
                                    <td>{v.fecha ? String(v.fecha).slice(0, 10) : "—"}</td>
                                    <td>{v.consultor || "—"}</td>
                                    <td>{v.motivo || "—"}</td>
                                    <td>{v.respuesta || "—"}</td>
                                    <td>
                                      {(v.documentos_recibidos || []).length === 0 && (
                                        <span className="text-muted small">Sin documentos</span>
                                      )}
                                      <div className="d-flex flex-wrap gap-1">
                                        {(v.documentos_recibidos || []).map((key) => {
                                          const item = DOCS_CATALOG.find((d) => d.value === key);
                                          return (
                                            <Badge bg="secondary" key={`visita-doc-${v.id_historial_visita}-${key}`}>
                                              {item?.label || key}
                                            </Badge>
                                          );
                                        })}
                                      </div>
                                    </td>
                                    <td>
                                      <Button
                                        size="sm"
                                        variant="outline-secondary"
                                        onClick={() => openEditarVisita(v)}
                                        disabled={!canUpdate}
                                      >
                                        Editar
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </Col>
          </Row>

          {/* --- geografía (polígonos) --- */}
          <Row className="g-3">
            <Col md={12}>
              <div className="border rounded p-3">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <h5 className="mb-0">Geografía</h5>
                  {!current?.id_expediente && (
                    <span className="text-muted small">
                      Guardá el expediente para habilitar polígonos.
                    </span>
                  )}
                </div>

                <div className="row g-3 mt-1">
                  {[
                    { key: "proyecto", label: "Polígono proyecto" },
                    { key: "afectacion", label: "Polígono afectación" },
                  ].map((item) => {
                    const tipoPoligono = item.key;
                    const polyFiles = polyFilesByTipo?.[tipoPoligono] || [];
                    const polySets = polySetsByTipo?.[tipoPoligono] || [];
                    const polyInvalidTriads = Boolean(polyInvalidTriadsByTipo?.[tipoPoligono]);
                    const polyRuleViolations = polyRuleViolationsByTipo?.[tipoPoligono] || [];
                    const planoHasGeom =
                      tipoPoligono === "proyecto" ? planoHasGeomProyecto : planoHasGeomAfectacion;
                    const planoFeatureCount =
                      tipoPoligono === "proyecto" ? planoFeatureCountProyecto : planoFeatureCountAfectacion;
                    const canAct = Boolean(current?.id_expediente) && geometryEditable && !currentGroupBlocked;

                    return (
                      <div className="col-md-6" key={`geo-${tipoPoligono}`}>
                        <div className="border rounded p-3 h-100">
                          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                            <h6 className="mb-0">{item.label}</h6>
                            <Badge bg={planoHasGeom ? "success" : "secondary"}>
                              {planoHasGeom ? "Polígono cargado" : "Sin polígono"}
                            </Badge>
                          </div>

                          <div className="text-muted small mt-1">
                            {planoHasGeom
                              ? `Features: ${planoFeatureCount}`
                              : "No hay geometría cargada"}
                          </div>

                          <div className="d-flex gap-2 align-items-center mt-2">
                            <Form.Control
                              type="file"
                              multiple
                              accept=".shp,.dbf,.shx,.zip,.kml,.kmz,.rar,.geojson,.json,.gpkg,.gpx,.gml,.dxf"
                              disabled={!canAct || polyBusy}
                              onChange={(ev) =>
                                setPolyFilesByTipo((prev) => ({
                                  ...prev,
                                  [tipoPoligono]: Array.from(ev.target.files || []),
                                }))
                              }
                            />
                            <Button
                              variant="success"
                              disabled={!canAct || polyBusy || !polyFiles.length}
                              onClick={() => subirPoligono(tipoPoligono)}
                            >
                              {polyBusy ? "Subiendo..." : `Agregar / reemplazar`}
                            </Button>
                          </div>

                          {polyFiles.length > 0 && (
                            <div className="small mt-2">
                              {polyInvalidTriads && (
                                <div className="text-danger">
                                  ⚠️ Hay SHP incompletos: debe venir <b>.shp + .dbf + .shx</b> (mismo nombre base), o
                                  subí un ZIP/KMZ.
                                </div>
                              )}

                              {polyRuleViolations.length > 0 && (
                                <div className="text-danger mt-1">
                                  ⚠️ Regla nombre: en <b>{tipoCarpeta.toUpperCase()}</b> el nombre debe contener{" "}
                                  <b>{tipoCarpeta === "terreno" ? "TERRENO" : "MEJORA/MEJORAS"}</b>.
                                  <div className="mt-1">
                                    No cumplen:
                                    <ul className="mb-0">
                                      {polyRuleViolations.map((x) => (
                                        <li key={`${tipoPoligono}-${x.name}`}>{x.name}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              )}

                              <div className="text-muted mt-1">
                                Seleccionados: <b>{polyFiles.length}</b>
                              </div>

                              <div className="mt-1">
                                {polySets.map((s) => {
                                  const okName =
                                    s.kind === "triad"
                                      ? matchesTipoRule(s.base, tipoCarpeta)
                                      : matchesTipoRule(s.file?.name, tipoCarpeta);

                                  if (s.kind === "triad") {
                                    return (
                                      <div key={`${tipoPoligono}-${s.baseNorm}`} className="d-flex align-items-center gap-2">
                                        <span className={`badge ${s.validTriad ? "bg-success" : "bg-danger"}`}>
                                          {s.validTriad ? "SHP OK" : "SHP incompleto"}
                                        </span>
                                        <span className={`badge ${okName ? "bg-success" : "bg-danger"}`}>
                                          {okName ? "Nombre OK" : "Nombre inválido"}
                                        </span>
                                        <span className="text-muted">{s.base}</span>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div key={`${tipoPoligono}-${s.id}`} className="d-flex align-items-center gap-2">
                                      <span className="badge bg-secondary">{s.ext}</span>
                                      <span className={`badge ${okName ? "bg-success" : "bg-danger"}`}>
                                        {okName ? "Nombre OK" : "Nombre inválido"}
                                      </span>
                                      <span className="text-muted">{s.file?.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {planoGeoError && (
                            <div className="text-danger small mt-2">{planoGeoError}</div>
                          )}

                          <div className="d-flex gap-2 mt-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline-primary"
                              onClick={() => handleVerPlanoEnMapa(tipoPoligono)}
                              disabled={!planoHasGeom}
                            >
                              Ver en mapa
                            </Button>
                            <Button
                              size="sm"
                              variant="outline-danger"
                              onClick={() => handleEliminarPlano(tipoPoligono)}
                              disabled={!planoHasGeom || !canAct}
                            >
                              Eliminar
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Col>
          </Row>

          <Row className="g-3">
            <Col md={12}>
              <div className="border rounded p-3">
                <div className="d-flex align-items-center">
                  <h5 className="mb-0">Avalúo</h5>
                  <Button
                    className="ms-auto"
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => setAvaluoOpen((v) => !v)}
                    aria-controls="exp-avaluo-collapse"
                    aria-expanded={avaluoOpen}
                  >
                    {avaluoOpen ? "Ocultar" : "Mostrar"}
                  </Button>
                </div>

                <Collapse in={avaluoOpen}>
                  <div id="exp-avaluo-collapse" className="mt-3">
                    <Row className="g-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>{avaluoLabels.a}</Form.Label>
                          {readonly ? (
                            <div className="fw-semibold">
                              {String(form.parte_a || "").trim() ? avaluoCalc.fmt(avaluoCalc.parteA) : "—"}
                            </div>
                          ) : (
                            <Form.Control
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.parte_a}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (String(v).startsWith("-")) return;
                                setForm({ ...form, parte_a: v });
                              }}
                              placeholder="0.00"
                            />
                          )}
                        </Form.Group>
                      </Col>

                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>{avaluoLabels.b}</Form.Label>
                          {readonly ? (
                            <div className="fw-semibold">
                              {String(form.parte_b || "").trim() ? avaluoCalc.fmt(avaluoCalc.parteB) : "—"}
                            </div>
                          ) : (
                            <Form.Control
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.parte_b}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (String(v).startsWith("-")) return;
                                setForm({ ...form, parte_b: v });
                              }}
                              placeholder="0.00"
                            />
                          )}
                        </Form.Group>
                      </Col>

                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Conformidad 10%</Form.Label>
                          {readonly ? (
                            <div className="fw-semibold">{form.premio_aplica ? "Aplica 10%" : "No aplica"}</div>
                          ) : (
                            <Form.Check
                              type="checkbox"
                              label="Aplicar conformidad 10%"
                              checked={!!form.premio_aplica}
                              onChange={(e) => setForm({ ...form, premio_aplica: e.target.checked })}
                            />
                          )}
                        </Form.Group>
                      </Col>

                      <Col md={12}>
                        <Table bordered size="sm" className="mb-0">
                          <tbody>
                            <tr>
                              <td className="fw-semibold">Subtotal</td>
                              <td className="text-end">{avaluoCalc.fmt(avaluoCalc.subtotal)}</td>
                            </tr>
                            <tr>
                              <td className="fw-semibold">Conformidad 10%</td>
                              <td className="text-end">{avaluoCalc.fmt(avaluoCalc.premio)}</td>
                            </tr>
                            <tr>
                              <td className="fw-semibold">Total a desembolsar</td>
                              <td className="text-end">{avaluoCalc.fmt(avaluoCalc.total)}</td>
                            </tr>
                          </tbody>
                        </Table>
                      </Col>
                    </Row>
                  </div>
                </Collapse>
              </div>
            </Col>
          </Row>

          <hr />

          {/* =========================
              ✅ PARTE 2: Elaboración de carpetas
             ========================= */}
          <Row className="g-3">
            <div className="text-muted small">
              * El check es secuencial: no te deja marcar el siguiente si el anterior no está OK.
              <br />
              * El "Plano ref. / inf. pericial" se completa al <b>subir el polígono</b>.
              <br />
              * Formatos aceptados: <b>SHP+DBF+SHX</b> (juntos) / <b>ZIP</b> / <b>KML</b> / <b>KMZ</b> (y opcional GeoJSON).
              <br />
              * Regla de nombre: <b>Terreno</b> ⇒ debe contener <b>TERRENO</b>; <b>Mejora</b> ⇒ debe contener <b>MEJORA/MEJORAS</b>.
            </div>

            <Col md={12}>
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h5 className="mb-0">Elaboración de carpetas</h5>

                <div className="btn-group">
                  <Button
                    variant={tipoCarpeta === "mejora" ? "primary" : "outline-primary"}
                    disabled={!geometryEditable || !current || isTipoLocked}
                    onClick={async () => {
                      setTipoCarpeta("mejora");
                      setForm((prev) => ({ ...prev, tipo_expediente: "M" }));
                      setPolyFilesByTipo({ proyecto: [], afectacion: [] });
                      if (current) await loadEtapas(current.id_expediente, "mejora");
                    }}
                  >
                    Mejora
                  </Button>
                  <Button
                    variant={tipoCarpeta === "terreno" ? "primary" : "outline-primary"}
                    disabled={!geometryEditable || !current || isTipoLocked}
                    onClick={async () => {
                      setTipoCarpeta("terreno");
                      setForm((prev) => ({ ...prev, tipo_expediente: "T" }));
                      setPolyFilesByTipo({ proyecto: [], afectacion: [] });
                      if (current) await loadEtapas(current.id_expediente, "terreno");
                    }}
                  >
                    Terreno
                  </Button>
                </div>
              </div>

              {!current && (
                <Alert variant="info" className="mt-2 mb-0">
                  Primero guardá el expediente para habilitar la elaboración de carpetas.
                </Alert>
              )}

              {etapasErr && (
                <Alert variant="danger" className="mt-2">
                  {etapasErr}
                </Alert>
              )}

              {!!current && (
                <div className="mt-3">
                  <Table bordered size="sm" className="align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>OK</th>
                        <th>Estado</th>
                        <th>Observación</th>
                        <th style={{ width: 160 }}>Fecha</th>
                        <th style={{ width: 260 }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {etapasList.map((e) => {
                        const st = etapas?.[e.key] || { ok: false, obs: "" };
                        const editable = canEditKey(e.key);
                        const stageDate = formatLocalDateTime(st?.date);
                        const stageDateLocal = isoToDatetimeLocal(st?.date);

                        const isPlano = e.key === "plano_georef";
                        const tipoPoligono = "proyecto";
                        const polyFiles = polyFilesByTipo?.[tipoPoligono] || [];
                        const polySets = polySetsByTipo?.[tipoPoligono] || [];
                        const polyInvalidTriads = Boolean(polyInvalidTriadsByTipo?.[tipoPoligono]);
                        const polyRuleViolations = polyRuleViolationsByTipo?.[tipoPoligono] || [];
                        const planoHasGeom =
                          tipoPoligono === "proyecto" ? planoHasGeomProyecto : planoHasGeomAfectacion;
                        const planoFeatureCount =
                          tipoPoligono === "proyecto" ? planoFeatureCountProyecto : planoFeatureCountAfectacion;
                        const disableCheck =
                          readonly || savingEtapa || !editable || isPlano || currentGroupBlocked;
                        const disableObs =
                          readonly || savingEtapa || (!editable && !st.ok) || currentGroupBlocked;
                        const disableDate =
                          readonly ||
                          savingEtapa ||
                          currentGroupBlocked ||
                          ((!editable && !st.ok) && !st?.date) ||
                          (isPlano && !st.ok && !st?.date);

                        return (
                          <tr key={e.key}>
                            <td className="text-center">
                              <Form.Check
                                checked={!!st.ok}
                                disabled={disableCheck}
                                onChange={(ev) => {
                                  const checked = ev.target.checked;
                                  let nextDateIso = undefined;

                                  if (checked && !st?.date) {
                                    const iso = getEtapaFallbackIso();
                                    if (iso) {
                                      nextDateIso = iso;
                                      setEtapas((prev) => ({
                                        ...prev,
                                        [e.key]: { ...(prev?.[e.key] || {}), ok: true, date: iso },
                                      }));
                                    }
                                  }

                                  setEtapa(e.key, checked, st.obs || "", nextDateIso);
                                }}
                              />
                            </td>
                            <td>
                              <b>{getEtapaLabel(e.key, e.label)}</b>
                              {!st.ok && editable && <div className="text-muted small">Pendiente (debe completarse para seguir)</div>}
                              {!st.ok && !editable && <div className="text-muted small">Bloqueado (completá el paso anterior)</div>}
                            </td>
                            <td>
                              <Form.Control
                                as="textarea"
                                rows={2}
                                value={st.obs || ""}
                                disabled={disableObs}
                                placeholder="Observación..."
                                onChange={(ev) => {
                                  const v = ev.target.value;
                                  setEtapas((prev) => ({
                                    ...prev,
                                    [e.key]: { ...(prev[e.key] || {}), obs: v },
                                  }));
                                }}
                                onBlur={() => {
                                  if (!readonly) setEtapa(e.key, !!st.ok, st.obs || "", st?.date || "");
                                }}
                              />
                            </td>
                            <td className="text-nowrap">
                              {readonly ? (
                                stageDate || "—"
                              ) : (
                                <Form.Control
                                  type="datetime-local"
                                  value={stageDateLocal}
                                  disabled={disableDate}
                                  required={!!st.ok}
                                  onChange={(ev) => {
                                    const local = ev.target.value;
                                    const iso = datetimeLocalToIso(local);
                                    setEtapas((prev) => ({
                                      ...prev,
                                      [e.key]: { ...(prev?.[e.key] || {}), date: iso || (prev?.[e.key]?.date ?? null) },
                                    }));
                                  }}
                                  onBlur={(ev) => {
                                    const local = ev.target.value;
                                    let iso = datetimeLocalToIso(local);
                                    if (!iso && st?.ok) {
                                      iso = getEtapaFallbackIso();
                                      setEtapas((prev) => ({
                                        ...prev,
                                        [e.key]: { ...(prev?.[e.key] || {}), date: iso || (prev?.[e.key]?.date ?? null) },
                                      }));
                                    }
                                    if (iso && !readonly) setEtapa(e.key, !!st.ok, st.obs || "", iso);
                                  }}
                                />
                              )}
                              {!!st.ok && !stageDateLocal && !readonly && (
                                <div className="text-danger small mt-1">Fecha requerida para etapa OK.</div>
                              )}
                            </td>
                                                                                    <td>
                              {isPlano ? (
                                <div className="text-muted small">
                                  El polígono se gestiona en la sección Geografía.
                                </div>
                              ) : (
                                <div className="text-muted small">Sin acciones</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              )}
            </Col>
          </Row>

          <hr />

          {/* =========================
              ✅ Carpeta DBI
             ========================= */}
          <Row className="g-3">
            <Col md={12}>
              <h5 className="mb-2">Carpeta DBI</h5>
              {!current ? (
                <div className="text-muted">Primero guardá el expediente para ver DBI.</div>
              ) : (
                <>
                  {(() => {
                    const dbiInfo = current?.carpeta_dbi || {};
                    const dbiIniciado = Boolean(dbiInfo.codigo || dbiInfo.fecha_ingreso);
                    if (dbiIniciado) return null;
                    return (
                      <Col md={12}>
                        <div className="mt-1">
                          <h6 className="mb-2">Registrar ingreso DBI</h6>
                          {dbiInicioError && (
                            <div className="text-danger small mb-2">{dbiInicioError}</div>
                          )}
                          <Row className="g-2 align-items-end">
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Código DBI</Form.Label>
                                <Form.Control
                                  value={dbiCodigo}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiCodigo(e.target.value)}
                                  placeholder="Ej: DBI-2026-001"
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Código MEU</Form.Label>
                                <Form.Control
                                  value={dbiCodigoMeu}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiCodigoMeu(e.target.value)}
                                  placeholder="Ej: MEU-001"
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Fecha ingreso</Form.Label>
                                <Form.Control
                                  type="datetime-local"
                                  value={dbiInicioFecha}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiInicioFecha(e.target.value)}
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Estado inicial del trámite (opcional)</Form.Label>
                                <Form.Select
                                  value={mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, dbiSegEstado) || ""}
                                  disabled={dbiInicioBusy || dbiEstadosLoading}
                                  onChange={(e) => setDbiSegEstado(e.target.value)}
                                >
                                  <option value="">Sin seleccionar</option>
                                  {dbiEstadosCatalog.map((item) => (
                                    <option key={item.codigo} value={item.codigo}>
                                      {cleanSegEstadoDescripcion(item.descripcion)}
                                    </option>
                                  ))}
                                </Form.Select>
                                <div className="text-muted small mt-1">
                                  Define el estado del primer hito. Si no selecciona uno, se usará Mesa de entrada.
                                </div>
                                {!mapSegEstadoToCatalogCodigo(dbiEstadosCatalog, dbiSegEstado) &&
                                  normalizeSegEstadoValue(dbiSegEstado) && (
                                    <div className="text-muted small mt-1">
                                      Valor actual: {dbiSegEstado}
                                    </div>
                                  )}
                              </Form.Group>
                          </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Resolución número</Form.Label>
                                <Form.Control
                                  value={dbiResolNumero}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiResolNumero(e.target.value)}
                                  placeholder="Ej: 123/2026"
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Resolución fecha</Form.Label>
                                <Form.Control
                                  type="date"
                                  value={dbiResolFecha}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiResolFecha(e.target.value)}
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Decreto número</Form.Label>
                                <Form.Control
                                  value={dbiDecretoNumero}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiDecretoNumero(e.target.value)}
                                  placeholder="Ej: 456/2026"
                                />
                              </Form.Group>
                            </Col>
                            <Col md={4}>
                              <Form.Group>
                                <Form.Label>Decreto fecha</Form.Label>
                                <Form.Control
                                  type="date"
                                  value={dbiDecretoFecha}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiDecretoFecha(e.target.value)}
                                />
                              </Form.Group>
                            </Col>
                            <Col md={12}>
                              <Form.Group>
                                <Form.Label>Observación general (opcional)</Form.Label>
                                <Form.Control
                                  value={dbiInicioObs}
                                  disabled={dbiInicioBusy}
                                  onChange={(e) => setDbiInicioObs(e.target.value)}
                                  placeholder="detalle..."
                                />
                              </Form.Group>
                            </Col>
                            <Col md={12} className="text-end">
                              <Button
                                variant="primary"
                                disabled={dbiInicioBusy || !dbiCodigo.trim() || !dbiInicioFecha}
                                onClick={iniciarDbi}
                              >
                                {dbiInicioBusy ? "Registrando..." : "Registrar ingreso DBI"}
                              </Button>
                            </Col>
                          </Row>
                          <div className="text-muted small mt-1">
                            Registrá el ingreso DBI para habilitar cabecera y seguimiento.
                          </div>
                        </div>
                      </Col>
                    );
                  })()}
                  <Row className="g-3">
                    {(() => {
                      const dbiInfo = current?.carpeta_dbi || {};
                      const dbiIniciado = Boolean(dbiInfo.codigo || dbiInfo.fecha_ingreso);
                      if (!dbiIniciado) return null;
                      return (
                    <Col md={12}>
                      <div className="border rounded p-3">
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                          <h5 className="mb-0">Cabecera DBI</h5>
                          {!readonly && canUpdate && (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setDbiHeaderOpen((v) => !v)}
                            >
                              {dbiHeaderOpen ? "Cerrar edición" : "Editar cabecera"}
                            </Button>
                          )}
                        </div>
                        {(() => {
                          const dbiInfo = current?.carpeta_dbi || {};
                          const dbiFecha = formatLocalDateTime(dbiInfo.fecha_ingreso);
                          const resolucion = dbiInfo.resolucion || {};
                          const decreto = dbiInfo.decreto || {};
                          const estadoActualRaw = getDbiEstadoActual(dbiInfo);
                          const estadoActualLabel = getSegEstadoDescripcion(
                            dbiEstadosCatalog,
                            estadoActualRaw
                          );
                          const estadoActualCodigo = mapSegEstadoToCatalogCodigo(
                            dbiEstadosCatalog,
                            estadoActualRaw
                          );
                          const resolucionFecha =
                            formatLocalDateTime(resolucion.fecha) ||
                            formatLocalDateTime(dbiResolFecha);
                          const decretoFecha =
                            formatLocalDateTime(decreto.fecha) ||
                            formatLocalDateTime(dbiDecretoFecha);
                          return (
                            <>
                              <Row className="g-2">
                                <Col md={3}>
                                  <div className="text-muted small">Código DBI</div>
                                  <div className="fw-semibold">{dbiInfo.codigo || "—"}</div>
                                </Col>
                                <Col md={3}>
                                  <div className="text-muted small">Código MEU</div>
                                  <div className="fw-semibold">{dbiInfo.codigo_meu || "—"}</div>
                                </Col>
                                <Col md={3}>
                                  <div className="text-muted small">Fecha ingreso</div>
                                  <div className="fw-semibold">{dbiFecha || "—"}</div>
                                </Col>
                                <Col md={3}>
                                  <div className="text-muted small">Estado actual</div>
                                  <div className="fw-semibold">
                                    {cleanSegEstadoDescripcion(estadoActualLabel) || "—"}
                                  </div>
                                  {!estadoActualRaw && dbiInfo.seg_estado && (
                                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                      Referencia administrativa: {dbiInfo.seg_estado}
                                    </div>
                                  )}
                                </Col>
                                <Col md={6}>
                                  <div className="border rounded p-2 h-100">
                                    <div className="text-muted small">Resolución</div>
                                    <div className="d-flex flex-wrap gap-3">
                                      <div>
                                        <div className="text-muted small">Número</div>
                                        <div className="fw-semibold">{resolucion.numero || "—"}</div>
                                      </div>
                                      <div>
                                        <div className="text-muted small">Fecha</div>
                                        <div className="fw-semibold">
                                          {resolucionFecha || "—"}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </Col>
                                <Col md={6}>
                                  <div className="border rounded p-2 h-100">
                                    <div className="text-muted small">Decreto</div>
                                    <div className="d-flex flex-wrap gap-3">
                                      <div>
                                        <div className="text-muted small">Número</div>
                                        <div className="fw-semibold">{decreto.numero || "—"}</div>
                                      </div>
                                      <div>
                                        <div className="text-muted small">Fecha</div>
                                        <div className="fw-semibold">
                                          {decretoFecha || "—"}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </Col>
                                <Col md={12}>
                                  <div className="text-muted small">Observación general</div>
                                  <div>{dbiInfo.obs || "—"}</div>
                                </Col>
                              </Row>
                            </>
                          );
                        })()}
                        {!readonly && canUpdate && (
                          <Collapse in={dbiHeaderOpen}>
                            <div>
                              <div className="mt-3">
                                <h6 className="mb-2">Edición administrativa</h6>
                                {dbiHeaderError && (
                                  <div className="text-danger small mb-2">{dbiHeaderError}</div>
                                )}
                                <Row className="g-2 align-items-end">
                                  <Col md={4}>
                                    <Form.Group>
                                      <Form.Label>Resolución número</Form.Label>
                                      <Form.Control
                                        value={dbiResolNumero}
                                        disabled={dbiHeaderBusy}
                                        onChange={(e) => setDbiResolNumero(e.target.value)}
                                        placeholder="Ej: 123/2026"
                                      />
                                    </Form.Group>
                                  </Col>
                                  <Col md={4}>
                                    <Form.Group>
                                      <Form.Label>Resolución fecha</Form.Label>
                                      <Form.Control
                                        type="date"
                                        value={dbiResolFecha}
                                        disabled={dbiHeaderBusy}
                                        onChange={(e) => setDbiResolFecha(e.target.value)}
                                      />
                                    </Form.Group>
                                  </Col>
                                  <Col md={4}>
                                    <Form.Group>
                                      <Form.Label>Decreto número</Form.Label>
                                      <Form.Control
                                        value={dbiDecretoNumero}
                                        disabled={dbiHeaderBusy}
                                        onChange={(e) => setDbiDecretoNumero(e.target.value)}
                                        placeholder="Ej: 456/2026"
                                      />
                                    </Form.Group>
                                  </Col>
                                  <Col md={4}>
                                    <Form.Group>
                                      <Form.Label>Decreto fecha</Form.Label>
                                      <Form.Control
                                        type="date"
                                        value={dbiDecretoFecha}
                                        disabled={dbiHeaderBusy}
                                        onChange={(e) => setDbiDecretoFecha(e.target.value)}
                                      />
                                    </Form.Group>
                                  </Col>
                                  <Col md={12}>
                                    <Form.Group>
                                      <Form.Label>Observación general</Form.Label>
                                      <Form.Control
                                        value={dbiInicioObs}
                                        disabled={dbiHeaderBusy}
                                        onChange={(e) => setDbiInicioObs(e.target.value)}
                                        placeholder="detalle..."
                                      />
                                    </Form.Group>
                                  </Col>
                                  <Col md={12} className="text-end">
                                    <Button
                                      variant="primary"
                                      disabled={dbiHeaderBusy}
                                      onClick={guardarDbiHeader}
                                    >
                                      {dbiHeaderBusy ? "Guardando..." : "Guardar cabecera"}
                                    </Button>
                                  </Col>
                                </Row>
                              </div>
                            </div>
                          </Collapse>
                        )}
                      </div>
                    </Col>
                      );
                    })()}

                    {(() => {
                      const dbiInfo = current?.carpeta_dbi || {};
                      const dbiIniciado = Boolean(dbiInfo.codigo || dbiInfo.fecha_ingreso);
                      if (!dbiIniciado) return null;
                      return (
                    <Col md={12}>
                      <div className="border rounded p-3">
                        {(() => {
                          const dbiInfo = current?.carpeta_dbi || {};
                          const estadoActualRaw = getDbiEstadoActual(dbiInfo);
                          const estadoActualLabel = getSegEstadoDescripcion(
                            dbiEstadosCatalog,
                            estadoActualRaw
                          );
                          const estadoActualCodigo = mapSegEstadoToCatalogCodigo(
                            dbiEstadosCatalog,
                            estadoActualRaw
                          );
                          return (
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                              <h5 className="mb-0">Seguimiento DBI</h5>
                            </div>
                          );
                        })()}
                        <div className="mt-3">
                          <h6 className="mb-2">Historial de estados</h6>
                          {(() => {
                            const dbiInfo = current?.carpeta_dbi || {};
                            const raw = Array.isArray(dbiInfo.estados) ? dbiInfo.estados : [];
                            if (!raw.length) {
                              return <div className="text-muted small">Sin hitos DBI registrados</div>;
                            }
                            const ordered = raw
                              .map((item, idx) => ({ item, idx }))
                              .sort((a, b) => {
                                const ta = Date.parse(a.item?.fecha || "");
                                const tb = Date.parse(b.item?.fecha || "");
                                const va = Number.isNaN(ta) ? null : ta;
                                const vb = Number.isNaN(tb) ? null : tb;
                                if (va === null && vb === null) return a.idx - b.idx;
                                if (va === null) return 1;
                                if (vb === null) return -1;
                                if (va === vb) return a.idx - b.idx;
                                return va - vb;
                              })
                              .map((x) => x.item);

                            return (
                              <Table bordered size="sm" className="mt-2">
                                <thead>
                                  <tr>
                                    <th style={{ width: "25%" }}>Estado</th>
                                    <th style={{ width: "20%" }}>Fecha</th>
                                    <th>Observación</th>
                                    {!readonly && canUpdate && <th style={{ width: "80px" }} className="text-center">Acciones</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {ordered.map((ev, i) => {
                                    const isEditing = dbiEditUuid !== null && dbiEditUuid === ev.uuid;
                                    const fecha = formatLocalDateTime(ev?.fecha);
                                    const estadoLabel = getSegEstadoDescripcion(
                                      dbiEstadosCatalog,
                                      ev?.estado
                                    );
                                    return (
                                      <tr key={`dbi-evt-${i}`}>
                                        {isEditing ? (
                                          <>
                                            <td>
                                              <Form.Select
                                                size="sm"
                                                value={dbiEditForm.estado}
                                                onChange={(e) =>
                                                  setDbiEditForm((p) => ({ ...p, estado: e.target.value }))
                                                }
                                              >
                                                <option value="">Selección...</option>
                                                {dbiEstadosCatalog.map((c) => (
                                                  <option key={c.codigo} value={c.codigo}>
                                                    {c.descripcion}
                                                  </option>
                                                ))}
                                              </Form.Select>
                                            </td>
                                            <td>
                                              <Form.Control
                                                size="sm"
                                                type="datetime-local"
                                                value={dbiEditForm.fecha}
                                                onChange={(e) =>
                                                  setDbiEditForm((p) => ({ ...p, fecha: e.target.value }))
                                                }
                                              />
                                            </td>
                                            <td>
                                              <Form.Control
                                                size="sm"
                                                as="textarea"
                                                rows={1}
                                                value={dbiEditForm.obs}
                                                onChange={(e) =>
                                                  setDbiEditForm((p) => ({ ...p, obs: e.target.value }))
                                                }
                                              />
                                            </td>
                                            <td className="text-center align-middle border-start">
                                              <div className="d-flex gap-2 justify-content-center mt-1">
                                                <Button
                                                  variant="success"
                                                  size="sm"
                                                  className="px-2"
                                                  title="Guardar"
                                                  disabled={dbiEventoBusy}
                                                  onClick={guardarEdicionDbi}
                                                >
                                                  Guardar
                                                </Button>
                                                <Button
                                                  variant="outline-secondary"
                                                  size="sm"
                                                  className="px-2"
                                                  title="Cancelar"
                                                  onClick={() => setDbiEditUuid(null)}
                                                >
                                                  Cancelar
                                                </Button>
                                              </div>
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td>{cleanSegEstadoDescripcion(estadoLabel) || "—"}</td>
                                            <td>{fecha || "—"}</td>
                                            <td>
                                              <div
                                                className={!dbiExpandedRows[i] && ev?.obs?.length > 80 ? "text-truncate" : ""}
                                                style={!dbiExpandedRows[i] && ev?.obs?.length > 80 ? { maxWidth: "400px" } : {}}
                                              >
                                                {ev?.obs || "—"}
                                              </div>
                                              {ev?.obs?.length > 80 && (
                                                <button
                                                  className="btn btn-link btn-sm p-0 mt-1 d-block text-decoration-none"
                                                  onClick={() =>
                                                    setDbiExpandedRows((prev) => ({
                                                      ...prev,
                                                      [i]: !prev[i],
                                                    }))
                                                  }
                                                >
                                                  {dbiExpandedRows[i] ? "Ver menos" : "Ver más..."}
                                                </button>
                                              )}
                                            </td>
                                            {!readonly && canUpdate && (
                                              <td className="text-center align-middle">
                                                <div className="d-flex gap-2 justify-content-center">
                                                  {ev.uuid && (
                                                    <Button
                                                      variant="link"
                                                      className="text-primary text-decoration-none p-0 fw-semibold"
                                                      title="Editar hito"
                                                      onClick={() => {
                                                        setDbiEditUuid(ev.uuid);
                                                        setDbiEditForm({
                                                          estado: ev.estado || "",
                                                          fecha: ev.fecha ? ev.fecha.substring(0, 16) : "",
                                                          obs: ev.obs || "",
                                                        });
                                                      }}
                                                    >
                                                      Editar
                                                    </Button>
                                                  )}
                                                  <Button
                                                    variant="link"
                                                    className="text-danger text-decoration-none p-0 fw-semibold"
                                                    title="Eliminar hito"
                                                    disabled={dbiEventoBusy}
                                                    onClick={() => eliminarDbiEvento(ev)}
                                                  >
                                                      Eliminar
                                                  </Button>
                                                </div>
                                              </td>
                                            )}
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </Table>
                            );
                          })()}
                        </div>
                        {!readonly && canUpdate && (() => {
                          const dbiInfo = current?.carpeta_dbi || {};
                          const dbiIniciado = Boolean(dbiInfo.codigo || dbiInfo.fecha_ingreso);
                          if (!dbiIniciado) return null;
                          return (
                            <div className="mt-3">
                              <h6 className="mb-2">Agregar hito DBI</h6>
                              {dbiEventoError && (
                                <div className="text-danger small mb-2">{dbiEventoError}</div>
                              )}
                              <Row className="g-2 align-items-end">
                                <Col md={4}>
                                  <Form.Group>
                                    <Form.Label>Estado</Form.Label>
                                    <Form.Select
                                      value={dbiEventoEstado}
                                      disabled={dbiEventoBusy || dbiEstadosLoading}
                                      onChange={(e) => setDbiEventoEstado(e.target.value)}
                                    >
                                      <option value="">Seleccioná un estado</option>
                                      {dbiEstadosCatalog.map((item) => (
                                        <option key={item.codigo} value={item.codigo}>
                                          {cleanSegEstadoDescripcion(item.descripcion)}
                                        </option>
                                      ))}
                                    </Form.Select>
                                  </Form.Group>
                                </Col>
                                <Col md={4}>
                                  <Form.Group>
                                    <Form.Label>Fecha (opcional)</Form.Label>
                                    <Form.Control
                                      type="datetime-local"
                                      value={dbiEventoFecha}
                                      disabled={dbiEventoBusy}
                                      onChange={(e) => setDbiEventoFecha(e.target.value)}
                                    />
                                  </Form.Group>
                                </Col>
                                <Col md={4}>
                                  <Form.Group>
                                    <Form.Label>Observación (opcional)</Form.Label>
                                    <Form.Control
                                      value={dbiEventoObs}
                                      disabled={dbiEventoBusy}
                                      onChange={(e) => setDbiEventoObs(e.target.value)}
                                      placeholder="detalle..."
                                    />
                                  </Form.Group>
                                </Col>
                                <Col md={12} className="text-end">
                                  <Button
                                    variant="outline-success"
                                    disabled={
                                      dbiEventoBusy ||
                                      !dbiEventoEstado.trim() ||
                                      !dbiEventoFecha
                                    }
                                    onClick={agregarDbiEvento}
                                  >
                                    {dbiEventoBusy ? "Guardando..." : "Agregar hito"}
                                  </Button>
                                </Col>
                              </Row>
                            </div>
                          );
                        })()}
                      </div>
                    </Col>
                      );
                    })()}
                  </Row>
                </>
              )}
            </Col>
          </Row>

          <hr />

          {/* =========================
              Documentos del expediente
             ========================= */}
          <Row className="g-3">
            <Col md={12}>
              <h6 className="mb-2">Documentos del expediente</h6>

              {current ? (
                <>
                  <Row className="g-2 align-items-end">
                    <Col md={5}>
                      <Form.Group>
                        <Form.Label>Subcarpeta (opcional)</Form.Label>
                        <Form.Control
                          placeholder="ej: fotos, planos, actas..."
                          value={subcarpeta}
                          disabled={readonly || !canUpload}
                          onChange={(e) => setSubcarpeta(e.target.value)}
                        />
                      </Form.Group>
                    </Col>

                    <Col md={7}>
                      <Form.Group>
                        <Form.Label>Archivos (varios)</Form.Label>
                        <Form.Control
                          type="file"
                          multiple
                          disabled={readonly || !canUpload}
                          onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                        />
                      </Form.Group>
                    </Col>

                    <Col md={12} className="text-end">
                      {!readonly && canUpload && (
                        <Button variant="outline-primary" onClick={uploadDocs}>
                          Subir documentos
                        </Button>
                      )}
                    </Col>
                    <Col md={6}>
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">C.I. Titular</div>
                        <Row className="g-2">
                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Titular Frente</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly || !canUpload}
                                onChange={(e) => setCiFrente(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Titular Dorso</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly || !canUpload}
                                onChange={(e) => setCiDorso(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12} className="text-end">
                            {!readonly && canUpload && (
                              <Button variant="outline-success" onClick={uploadCI}>
                                Subir CI titular
                              </Button>
                            )}
                          </Col>

                          <Col md={12}>
                            {docsCI.length ? (
                              <Table bordered size="sm" className="mt-2">
                                <thead>
                                  <tr>
                                    <th>Archivo</th>
                                    <th>Fecha</th>
                                    <th style={{ width: 200 }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {docsCI.map((d) => (
                                    <tr key={`ci-${d.id_archivo}`}>
                                      <td>{d.nombre_archivo}</td>
                                      <td>{d.fecha}</td>
                                      <td>
                                        <div className="btn-group">
                                          <Button
                                            variant="outline-secondary"
                                            size="sm"
                                            onClick={() => viewDoc(d)}
                                          >
                                            Ver
                                          </Button>
                                          <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={() => downloadDoc(d)}
                                          >
                                            Descargar
                                          </Button>
                                          {!readonly && canUpload && (
                                            <Button variant="danger" size="sm" onClick={() => delDoc(d.id_archivo)}>
                                              Eliminar
                                            </Button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </Table>
                            ) : (
                              <div className="text-muted small mt-2">Sin C.I. titular cargada</div>
                            )}

                            <div className="d-flex flex-wrap gap-2 mt-2">
                              {renderImportedImageBox(form.ci_propietario_frente_url, "CI Propietario Frente (Excel)")}
                              {renderImportedImageBox(form.ci_propietario_dorso_url, "CI Propietario Dorso (Excel)")}
                            </div>
                          </Col>
                        </Row>
                      </div>
                    </Col>

                    <Col md={6}>
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">C.I. Adicional</div>
                        <Row className="g-2">
                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Adicional Frente</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly || !canUpload}
                                onChange={(e) => setCiAdicionalFrente(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Adicional Dorso</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly || !canUpload}
                                onChange={(e) => setCiAdicionalDorso(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12} className="text-end">
                            {!readonly && canUpload && (
                              <Button variant="outline-success" onClick={uploadCIAdicional}>
                                Subir CI adicional
                              </Button>
                            )}
                          </Col>

                          <Col md={12}>
                            {docsCIAdicional.length ? (
                              <Table bordered size="sm" className="mt-2">
                                <thead>
                                  <tr>
                                    <th>Archivo</th>
                                    <th>Fecha</th>
                                    <th style={{ width: 200 }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {docsCIAdicional.map((d) => (
                                    <tr key={`ci-adicional-${d.id_archivo}`}>
                                      <td>{d.nombre_archivo}</td>
                                      <td>{d.fecha}</td>
                                      <td>
                                        <div className="btn-group">
                                          <Button
                                            variant="outline-secondary"
                                            size="sm"
                                            onClick={() => viewDoc(d)}
                                          >
                                            Ver
                                          </Button>
                                          <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={() => downloadDoc(d)}
                                          >
                                            Descargar
                                          </Button>
                                          {!readonly && canUpload && (
                                            <Button variant="danger" size="sm" onClick={() => delDoc(d.id_archivo)}>
                                              Eliminar
                                            </Button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </Table>
                            ) : (
                              <div className="text-muted small mt-2">Sin C.I. adicional cargada</div>
                            )}

                            <div className="d-flex flex-wrap gap-2 mt-2">
                              {renderImportedImageBox(form.ci_adicional_frente_url, "CI Adicional Frente (Excel)")}
                              {renderImportedImageBox(form.ci_adicional_dorso_url, "CI Adicional Dorso (Excel)")}
                            </div>
                          </Col>
                        </Row>
                      </div>
                    </Col>
                  </Row>

                  <div className="mt-3">
                    <h6 className="mb-2">Cargados (otros)</h6>

                    <div className="d-flex flex-wrap gap-2 mb-2">
                      <Badge bg="secondary">Total: {otherDocs.length}</Badge>
                      <Badge bg="secondary">Subcarpetas: {Object.keys(otherDocsBySubcarpeta).length}</Badge>
                    </div>

                    <Table bordered size="sm" className="mt-2">
                      <thead>
                        <tr>
                          <th>Subcarpeta</th>
                          <th>Archivo</th>
                          <th>Fecha</th>
                          <th style={{ width: 200 }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!otherDocs.length && (
                          <tr>
                            <td colSpan={4} className="text-center text-muted">
                              Sin documentos adicionales
                            </td>
                          </tr>
                        )}

                        {otherDocs.map((d) => (
                          <tr key={`other-${d.id_archivo}`}>
                            <td>{d.subcarpeta || ""}</td>
                            <td>{d.nombre_archivo}</td>
                            <td>{d.fecha}</td>
                            <td>
                              <div className="btn-group">
                                <Button
                                  variant="outline-secondary"
                                  size="sm"
                                  onClick={() => viewDoc(d)}
                                >
                                  Ver
                                </Button>
                                <Button
                                  variant="outline-primary"
                                  size="sm"
                                  onClick={() => downloadDoc(d)}
                                >
                                  Descargar
                                </Button>
                                {!readonly && canUpload && (
                                  <Button variant="danger" size="sm" onClick={() => delDoc(d.id_archivo)}>
                                    Eliminar
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </>
              ) : (
                <div className="text-muted">Primero guardá el expediente para poder subir documentos.</div>
              )}
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          {!readonly && mode === "editar" && canCreate && current && (
            <Button variant="outline-primary" onClick={openCloneModal}>
              Clonar expediente
            </Button>
          )}
          {!readonly && canDeleteTotal && current && (
            <Button variant="danger" onClick={openDeleteModal}>
              Eliminar expediente
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShow(false)}>
            Cerrar
          </Button>
          {!readonly && ((mode === "crear" && canCreate) || (mode === "editar" && canUpdate)) && (
            <Button variant="primary" onClick={save}>
              {mode === "crear" ? "Guardar" : "Actualizar"}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      <Modal show={showDeleteModal} onHide={() => !deleteBusy && setShowDeleteModal(false)} centered>
        <Modal.Header closeButton={!deleteBusy}>
          <Modal.Title>Eliminar expediente definitivamente</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            Se eliminara el expediente, sus etapas, geometrias, documentos y archivos fisicos asociados. Esta accion no se puede deshacer.
          </div>
          <div className="mb-2 text-muted small">{deleteTokenLabel}</div>
          <Form.Control
            value={deleteConfirm}
            disabled={deleteBusy}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={deleteToken}
          />
          {deleteError && <div className="text-danger small mt-2">{deleteError}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" disabled={deleteBusy} onClick={() => setShowDeleteModal(false)}>
            Cancelar
          </Button>
          <Button variant="danger" disabled={deleteBusy || !deleteConfirmOk} onClick={deleteExpediente}>
            {deleteBusy ? "Eliminando..." : "Eliminar definitivamente"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showCloneModal} onHide={() => !cloneBusy && setShowCloneModal(false)} centered>
        <Modal.Header closeButton={!cloneBusy}>
          <Modal.Title>Clonar expediente</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Tipo destino</Form.Label>
            <Form.Select
              value={cloneTipo}
              disabled={cloneBusy}
              onChange={(e) => setCloneTipo(e.target.value)}
            >
              <option value="">Seleccionar</option>
              <option value="M">Mejora</option>
              <option value="T">Terreno</option>
            </Form.Select>
          </Form.Group>
          {cloneError && <div className="text-danger small mt-2">{cloneError}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" disabled={cloneBusy} onClick={() => setShowCloneModal(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={cloneBusy || !cloneTipo}
            onClick={confirmClone}
          >
            {cloneBusy ? "Clonando..." : "Confirmar"}
          </Button>
        </Modal.Footer>
      </Modal>
      {/* =========================
          MODAL DOCUMENTACION PRESENTADA
        ========================= */}
      <Modal show={docsChecklistOpen} onHide={() => setDocsChecklistOpen(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Documentación presentada</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="text-muted small mb-2">
            Marcá los documentos disponibles. Se guardan solo las claves seleccionadas.
          </div>
          <div className="row g-2">
            {DOCS_CATALOG.map((doc) => {
              const checked = (form.documentacion_presentada || []).includes(doc.value);
              return (
                <div className="col-md-6" key={`doc-opt-${doc.value}`}>
                  <Form.Check
                    type="checkbox"
                    id={`doc-presentada-${doc.value}`}
                    label={doc.label}
                    checked={checked}
                    disabled={readonly}
                    onChange={(e) => {
                      const next = new Set(form.documentacion_presentada || []);
                      if (e.target.checked) next.add(doc.value);
                      else next.delete(doc.value);
                      setForm({ ...form, documentacion_presentada: Array.from(next) });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDocsChecklistOpen(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      {/* =========================
          MODAL HISTORIAL DE VISITAS
        ========================= */}
      <Modal show={showVisitaModal} onHide={() => setShowVisitaModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {visitMode === "crear" ? "Agregar visita" : "Editar visita"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="g-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Fecha</Form.Label>
                <Form.Control
                  type="date"
                  value={visitForm.fecha}
                  disabled={!canUpdate}
                  onChange={(e) => setVisitForm({ ...visitForm, fecha: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={8}>
              <Form.Group>
                <Form.Label>Consultor</Form.Label>
                <Form.Control
                  value={visitForm.consultor}
                  disabled={!canUpdate}
                  onChange={(e) => setVisitForm({ ...visitForm, consultor: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Motivo</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={visitForm.motivo}
                  disabled={!canUpdate}
                  onChange={(e) => setVisitForm({ ...visitForm, motivo: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Respuesta</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={visitForm.respuesta}
                  disabled={!canUpdate}
                  onChange={(e) => setVisitForm({ ...visitForm, respuesta: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={12}>
              <div className="d-flex align-items-center mb-2">
                <Form.Label className="mb-0">Documentos recibidos</Form.Label>
                <Button
                  className="ms-auto"
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => setVisitDocsOpen((v) => !v)}
                >
                  {visitDocsOpen ? "Ocultar" : "Ver / editar"}
                </Button>
              </div>
              <div className="d-flex flex-wrap gap-2 mb-2">
                {(visitForm.documentos_recibidos || []).length === 0 && (
                  <span className="text-muted small">Sin documentos marcados</span>
                )}
                {(visitForm.documentos_recibidos || []).map((key) => {
                  const item = DOCS_CATALOG.find((d) => d.value === key);
                  return (
                    <Badge bg="secondary" key={`visit-doc-${key}`}>
                      {item?.label || key}
                    </Badge>
                  );
                })}
              </div>
              <Collapse in={visitDocsOpen}>
                <div>
                  <div className="row g-2">
                    {DOCS_CATALOG.map((doc) => {
                      const checked = (visitForm.documentos_recibidos || []).includes(doc.value);
                      return (
                        <div className="col-md-6" key={`visit-doc-opt-${doc.value}`}>
                          <Form.Check
                            type="checkbox"
                            id={`visit-doc-${doc.value}`}
                            label={doc.label}
                            checked={checked}
                            disabled={!canUpdate}
                            onChange={(e) => {
                              const next = new Set(visitForm.documentos_recibidos || []);
                              if (e.target.checked) next.add(doc.value);
                              else next.delete(doc.value);
                              setVisitForm({ ...visitForm, documentos_recibidos: Array.from(next) });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Collapse>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowVisitaModal(false)} disabled={visitSaving}>
            Cancelar
          </Button>
          {canUpdate && (
            <Button variant="primary" onClick={saveVisita} disabled={visitSaving}>
              {visitSaving ? "Guardando..." : "Guardar"}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* =========================
          MODAL IMPORT EXCEL
        ========================= */}
      <Modal show={showImport} onHide={() => setShowImport(false)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>Importar Expedientes desde Excel</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {importErrors.length > 0 && (
            <div className="alert alert-danger">
              <ul className="mb-0">
                {importErrors.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {importResult && (
            <div className="alert alert-success">
              <div className="fw-semibold mb-2">Resumen de importación</div>
              <Row className="g-2">
                <Col md={4}>
                  <div>Insertados: <b>{Number(importResult.inserted || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Actualizados (id_import): <b>{Number(importResult.updated_by_id_import || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Actualizados (código exp): <b>{Number(importResult.updated_by_codigo_exp || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Actualizados (código censo): <b>{Number(importResult.updated_by_codigo_censo || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Rechazados: <b>{Number(importResult.rejected || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Docs insertados: <b>{Number(importResult.documentsInserted || 0)}</b></div>
                </Col>
                <Col md={4}>
                  <div>Docs omitidos: <b>{Number(importResult.documentsSkippedExisting || 0)}</b></div>
                </Col>
              </Row>

              {((importResult.errors && importResult.errors.length) ||
                (importResult.warnings && importResult.warnings.length)) && (
                <div className="mt-3">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setShowImportDetails((v) => !v)}
                  >
                    {showImportDetails ? "Ocultar detalles" : "Ver detalles"}
                  </Button>

                  <Collapse in={showImportDetails}>
                    <div className="mt-2">
                      {Array.isArray(importResult.warnings) && importResult.warnings.length > 0 && (
                        <>
                          <div className="fw-semibold">Advertencias</div>
                          <ul className="mb-2">
                            {importResult.warnings.slice(0, 50).map((w, i) => (
                              <li key={`warn-${i}`}>
                                {w?.row ? `Fila ${w.row}: ` : ""}{w?.message || JSON.stringify(w)}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                        <>
                          <div className="fw-semibold">Errores</div>
                          <ul className="mb-0">
                            {importResult.errors.slice(0, 50).map((e, i) => (
                              <li key={`err-${i}`}>
                                {e?.row ? `Fila ${e.row}: ` : ""}{e?.reason || JSON.stringify(e)}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {(importResult.warnings?.length > 50 || importResult.errors?.length > 50) && (
                        <div className="text-muted small">Mostrando solo 50 ítems por sección.</div>
                      )}
                    </div>
                  </Collapse>
                </div>
              )}
            </div>
          )}

          <Row className="g-3">
            <Col md={5}>
              <h6 className="mb-2">Mapeo de columnas</h6>

              {EXP_FIELDS.map((f) => {
                const isMulti = f.key === "documentos_urls" || f.key === "subtramo";
                return (
                <Form.Group className={f.key === "documentos_subcarpeta" ? "d-none" : "mb-2"} key={f.key}>
                  <Form.Label className="mb-1">{f.label}</Form.Label>
                  <Form.Select
                    multiple={isMulti}
                    value={
                      isMulti
                        ? Array.isArray(mapCols[f.key]) ? mapCols[f.key] : []
                        : mapCols[f.key] || ""
                    }
                    onChange={(e) => {
                      if (isMulti) {
                        const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                        setMapCols((prev) => ({ ...prev, [f.key]: selected }));
                      } else {
                        setMapCols((prev) => ({ ...prev, [f.key]: e.target.value }));
                      }
                    }}
                  >
                    {!isMulti && <option value="">— No mapear —</option>}
                    {excelColumns.map((c) => (
                      <option key={`mapcol-${c.headerOriginal}-${c.index}`} value={c.headerOriginal}>
                        {c.headerOriginal
                          ? `${c.headerOriginal} (col ${c.index + 1})`
                          : `(Sin encabezado) col ${c.index + 1}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                );
              })}

              <div className="text-muted small mt-2">
                Filas detectadas: <b>{excelRows.length}</b>
              </div>
              {excelWarnings.length > 0 && (
                <Alert variant="warning" className="mt-2 py-2">
                  <ul className="mb-0">
                    {excelWarnings.map((w, i) => (
                      <li key={`warn-${i}`}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <div className="text-muted small">
                Tip: asegurá encabezados en la primera fila del Excel.
                <br />
                * Si la fecha viene vacía, se usa <b>HOY</b>.
              </div>
            </Col>

            <Col md={7}>
              <h6 className="mb-2">Vista previa (primeras 10 filas)</h6>
              <div className="table-responsive" style={{ maxHeight: 420 }}>
                <Table bordered size="sm" className="align-middle">
                  <thead>
                    <tr>
                      {excelColumns.slice(0, 8).map((h) => (
                        <th key={`prev-${h.headerOriginal}-${h.index}`}>
                          {h.headerOriginal ? h.headerOriginal : "(Sin encabezado)"}{" "}
                          <span className="text-muted">[{h.index + 1}]</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excelPreview.map((r, idx) => (
                      <tr key={idx}>
                        {excelColumns.slice(0, 8).map((h) => {
                          const key = h.headerOriginal || `__col_${h.index}`;
                          return <td key={`prev-cell-${h.index}`}>{String(r[key] ?? "")}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div className="mt-2 text-muted small">
                * Se muestran solo 8 columnas para que entre en pantalla.
              </div>
            </Col>
          </Row>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImport(false)} disabled={importBusy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={confirmarImport} disabled={importBusy}>
            {importBusy ? "Importando..." : "Confirmar importación"}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* =========================
          MODAL EXPORT EXCEL
        ========================= */}
      <Modal show={showExport} onHide={() => !exportBusy && setShowExport(false)} size="lg" centered>
        <Modal.Header closeButton={!exportBusy}>
          <Modal.Title>Exportar Excel con documentación</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Row className="g-3">
            <Col md={6}>
              <div className="border rounded p-3 h-100">
                <div className="fw-bold mb-2">Columnas base</div>
                {EXPORT_FIELDS.filter((f) => f.group === "base").map((f) => (
                  <Form.Check
                    key={f.key}
                    type="checkbox"
                    id={`exp-base-${f.key}`}
                    label={f.label}
                    checked={!!exportSelection[f.key]}
                    onChange={(e) =>
                      setExportSelection((prev) => ({
                        ...prev,
                        [f.key]: e.target.checked,
                      }))
                    }
                    className="mb-2"
                  />
                ))}
              </div>
            </Col>

            <Col md={6}>
              <div className="border rounded p-3 h-100">
                <div className="fw-bold mb-2">Documentación</div>
                {EXPORT_FIELDS.filter((f) => f.group === "docs").map((f) => (
                  <Form.Check
                    key={f.key}
                    type="checkbox"
                    id={`exp-doc-${f.key}`}
                    label={f.label}
                    checked={!!exportSelection[f.key]}
                    onChange={(e) =>
                      setExportSelection((prev) => ({
                        ...prev,
                        [f.key]: e.target.checked,
                      }))
                    }
                    className="mb-2"
                  />
                ))}
              </div>
            </Col>
          </Row>
        </Modal.Body>

        <Modal.Footer className="d-flex justify-content-between flex-wrap gap-2">
          <div className="d-flex gap-2 flex-wrap">
            <Button
              variant="outline-secondary"
              disabled={exportBusy}
              onClick={() => setExportSelection(DEFAULT_EXPORT_SELECTION)}
            >
              Restaurar sugeridas
            </Button>

            <Button
              variant="outline-dark"
              disabled={exportBusy}
              onClick={() => {
                const all = {};
                EXPORT_FIELDS.forEach((f) => {
                  all[f.key] = true;
                });
                setExportSelection(all);
              }}
            >
              Marcar todo
            </Button>

            <Button
              variant="outline-danger"
              disabled={exportBusy}
              onClick={() => {
                const none = {};
                EXPORT_FIELDS.forEach((f) => {
                  none[f.key] = false;
                });
                setExportSelection(none);
              }}
            >
              Limpiar
            </Button>
          </div>

          <div className="d-flex gap-2">
            <Button
              variant="secondary"
              disabled={exportBusy}
              onClick={() => setShowExport(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="success"
              onClick={exportarExcelConDocumentacion}
              disabled={exportBusy || !rows.length}
            >
              {exportBusy ? "Exportando..." : "Exportar"}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

      <input
        id="excel-import-input"
        type="file"
        style={{ display: "none" }}
        accept=".xlsx, .xls"
        onChange={handleExcelImport}
      />
    </div>
  );
}

















