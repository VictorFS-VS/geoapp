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
import { alerts } from "@/utils/alerts";
import { hasPerm } from "@/utils/auth";
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

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizePositiveId(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function datetimeLocalToIso(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
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

export default function Expedientes() {
  const { id } = useParams(); // id_proyecto
  const idProyecto = Number(id);

  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoOpenRef = useRef(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterQ, setFilterQ] = useState("");
  const [filterTramoId, setFilterTramoId] = useState("");
  const [filterSubtramoId, setFilterSubtramoId] = useState("");
  const qDebounceRef = useRef(null);

  const [show, setShow] = useState(false);
  const [mode, setMode] = useState("ver"); // ver | crear | editar
  const [current, setCurrent] = useState(null);

  // docs existentes (ema.tumba) para expediente
  const [docs, setDocs] = useState([]);
  const [docsCI, setDocsCI] = useState([]);
  const [docsCIAdicional, setDocsCIAdicional] = useState([]);
  const ciSubcarpetas = useMemo(() => new Set(["ci", "ci_adicional"]), []);

  const [planoGeoCache, setPlanoGeoCache] = useState({});
  const [planoGeoLoading, setPlanoGeoLoading] = useState(false);
  const [planoGeoError, setPlanoGeoError] = useState("");

  const [catastroFeatures, setCatastroFeatures] = useState(null);
  const [catastroLoadedFor, setCatastroLoadedFor] = useState(null);
  const [catastroLoading, setCatastroLoading] = useState(false);
  const [catastroError, setCatastroError] = useState("");

  const canDeleteTotal = hasPerm("expedientes.delete");

  const [form, setForm] = useState({
    id_proyecto: idProyecto,
    fecha_relevamiento: "",
    gps: "",
    tecnico: "",
    codigo_exp: "",
    propietario_nombre: "",
    propietario_ci: "",
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

  const readonly = mode === "ver";
  const gpsFieldRef = useRef(null);
  const planoGeoReqSeqRef = useRef(0);
  const planoGeoReqKeyRef = useRef({});
  const planoGeoLoadingRef = useRef(0);

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

  const loadPlanoGeo = async (idExpediente, tipo, force = false) => {
    if (!idExpediente) return;
    const cached = planoGeoCache?.[idExpediente] || { mejora: null, terreno: null };
    if (!force && cached?.[tipo] !== null) return;
    planoGeoLoadingRef.current += 1;
    setPlanoGeoLoading(true);
    const key = `${idExpediente}:${tipo}`;
    const seq = ++planoGeoReqSeqRef.current;
    planoGeoReqKeyRef.current[key] = seq;
    try {
      const path = tipo === "mejora" ? "mejoras" : "terreno";
      const data = await apiGet(`${API}/expedientes/${idExpediente}/${path}`);
      const feats = Array.isArray(data?.features) ? data.features : [];
      if (planoGeoReqKeyRef.current[key] !== seq) return;
      setPlanoGeoCache((prev) => ({
        ...prev,
        [idExpediente]: { ...(prev[idExpediente] || { mejora: null, terreno: null }), [tipo]: feats },
      }));
      setPlanoGeoError("");
    } catch (e) {
      setPlanoGeoError(String(e?.message || e));
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
    loadPlanoGeo(current.id_expediente, tipoCarpeta);
  }, [current?.id_expediente, tipoCarpeta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLastPlanoGeometry(null);
  }, [current?.id_expediente, tipoCarpeta]);

  const planoFeatures = planoGeoCache?.[current?.id_expediente]?.[tipoCarpeta];
  const planoHasGeom = Array.isArray(planoFeatures) && planoFeatures.length > 0;
  const planoFeatureCount = Array.isArray(planoFeatures) ? planoFeatures.length : 0;

  const [lastPlanoGeometry, setLastPlanoGeometry] = useState(null);

  const planoGeometry = useMemo(() => {
    if (planoHasGeom) {
      const found = (planoFeatures || []).find(
        (f) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"
      );
      if (found?.geometry) return found.geometry;
    }
    return null;
  }, [planoHasGeom, planoFeatures]);

  useEffect(() => {
    if (planoGeometry) {
      setLastPlanoGeometry(planoGeometry);
    }
  }, [planoGeometry]);

  const readOnlyGeometry = useMemo(() => {
    const expId = current?.id_expediente;
    if (!expId) return null;
    if (planoGeometry) return planoGeometry;
    if (lastPlanoGeometry) return lastPlanoGeometry;
    if (!Array.isArray(catastroFeatures)) return null;
    const feature = catastroFeatures.find(
      (f) => Number(f?.properties?.id_expediente) === Number(expId)
    );
    const geom = feature?.geometry || null;
    if (!geom) return null;
    if (geom.type === "Polygon" || geom.type === "MultiPolygon") return geom;
    return null;
  }, [current?.id_expediente, planoGeometry, lastPlanoGeometry, catastroFeatures]);

  const handleVerPlanoEnMapa = async () => {
    if (!current?.id_expediente) return;
    await loadPlanoGeo(current.id_expediente, tipoCarpeta);
    gpsFieldRef.current?.openMap?.();
  };

  const handleEliminarPlano = async () => {
    if (!current?.id_expediente) return;
    if (readonly || currentGroupBlocked) return;
    const ok = window.confirm("¿Eliminar el polígono del tipo activo?");
    if (!ok) return;
    try {
      await apiDelete(`${API}/expedientes/${current.id_expediente}/poligono/${tipoCarpeta}`);
      setPlanoGeoCache((prev) => ({
        ...prev,
        [current.id_expediente]: { ...(prev[current.id_expediente] || { mejora: null, terreno: null }), [tipoCarpeta]: [] },
      }));
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
    propietario_nombre: row.propietario_nombre || "",
    propietario_ci: row.propietario_ci || "",
    id_tramo: normalizePositiveId(row.id_tramo),
    id_sub_tramo: normalizePositiveId(row.id_sub_tramo),
    codigo_censo: row.codigo_censo || "",
    ci_propietario_frente_url: row.ci_propietario_frente_url || "",
    ci_propietario_dorso_url: row.ci_propietario_dorso_url || "",
    ci_adicional_frente_url: row.ci_adicional_frente_url || "",
    ci_adicional_dorso_url: row.ci_adicional_dorso_url || "",
    parte_a: row.parte_a === null || row.parte_a === undefined ? "" : String(row.parte_a),
    parte_b: row.parte_b === null || row.parte_b === undefined ? "" : String(row.parte_b),
    premio_aplica: Boolean(row.premio_aplica),
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
    { key: "plano_georef", label: "Plano georreferenciado (polígono)" },
    { key: "avaluo", label: "Avalúo" },
    { key: "notif_conformidad", label: "Notificación y conformidad" },
    { key: "documentacion_final", label: "Documentación final" },
  ];

  const ETAPAS_TERRENO = [
    { key: "documentacion", label: "Documentación" },
    { key: "plano_georef", label: "Plano georreferenciado (polígono)" },
    { key: "informe_pericial", label: "Informe pericial" },
    { key: "plantilla", label: "Plantilla" },
    { key: "avaluo", label: "Avalúo" },
    { key: "notif_conformidad", label: "Notificación y conformidad" },
    { key: "documentacion_final", label: "Documentación final" },
  ];

  const [etapas, setEtapas] = useState({});
  const [etapasErr, setEtapasErr] = useState("");
  const [savingEtapa, setSavingEtapa] = useState(false);

  // ✅ subir polígono (multi)
  const [polyFiles, setPolyFiles] = useState([]);
  const [polyBusy, setPolyBusy] = useState(false);

  // DBI
  const [dbiCodigo, setDbiCodigo] = useState("");
  const [dbiFile, setDbiFile] = useState(null);
  const [dbiBusy, setDbiBusy] = useState(false);
  const [dbiEventoEstado, setDbiEventoEstado] = useState("");
  const [dbiEventoEstadoPreset, setDbiEventoEstadoPreset] = useState("");
  const [dbiEventoFecha, setDbiEventoFecha] = useState("");
  const [dbiEventoObs, setDbiEventoObs] = useState("");
  const [dbiEventoBusy, setDbiEventoBusy] = useState(false);
  const [dbiEventoError, setDbiEventoError] = useState("");
  const [dbiInicioFecha, setDbiInicioFecha] = useState("");
  const [dbiInicioObs, setDbiInicioObs] = useState("");
  const [dbiInicioBusy, setDbiInicioBusy] = useState(false);
  const [dbiInicioError, setDbiInicioError] = useState("");

  // delete total
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const deleteToken = (current?.codigo_exp || "").trim() || "ELIMINAR";
  const deleteTokenLabel = (current?.codigo_exp || "").trim()
    ? `Escriba el codigo del expediente (${deleteToken}) para confirmar.`
    : `Escriba ELIMINAR para confirmar.`;
  const deleteConfirmOk = deleteConfirm.trim() === deleteToken;

  const etapasList = tipoCarpeta === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;

  function getEtapaFallbackIso() {
    const relIso = ymdToIsoStart(current?.fecha_relevamiento);
    if (relIso) return relIso;
    const localNow = nowLocalDateTimeInput();
    return datetimeLocalToIso(localNow);
  }

  const hasActiveStages = (carpeta) => {
    if (!carpeta || typeof carpeta !== "object") return false;
    return Object.values(carpeta).some((stage) => stage?.ok);
  };

  const mejoraHasActivity = hasActiveStages(current?.carpeta_mejora);
  const terrenoHasActivity = hasActiveStages(current?.carpeta_terreno);
  const onlyMejoraActive = mejoraHasActivity && !terrenoHasActivity;
  const onlyTerrenoActive = terrenoHasActivity && !mejoraHasActivity;
  const legacyBothActive = mejoraHasActivity && terrenoHasActivity;
  const currentGroupBlocked = tipoCarpeta === "mejora" ? onlyTerrenoActive : onlyMejoraActive;

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
    if ((tipoCarpeta === "mejora" && onlyTerrenoActive) || (tipoCarpeta === "terreno" && onlyMejoraActive)) {
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
  const polySets = useMemo(() => {
    const byBase = new Map();
    const singles = [];

    for (const f of polyFiles) {
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
  }, [polyFiles]);

  const polyInvalidTriads = useMemo(
    () => polySets.some((s) => s.kind === "triad" && !s.validTriad),
    [polySets]
  );

  const polyRuleViolations = useMemo(() => {
    const bad = [];
    for (const s of polySets) {
      if (s.kind === "triad") {
        if (!matchesTipoRule(s.base, tipoCarpeta)) bad.push({ kind: "triad", name: s.base });
      } else {
        if (!matchesTipoRule(s.file?.name, tipoCarpeta)) {
          bad.push({ kind: "single", name: s.file?.name || "archivo" });
        }
      }
    }
    return bad;
  }, [polySets, tipoCarpeta]);

  async function subirPoligono() {
    if (!current) return;

    if (!polyFiles.length) {
      return alert("Seleccioná archivos: SHP+DBF+SHX (juntos) o ZIP/KML/KMZ (y opcional GeoJSON).");
    }

    if (polyInvalidTriads) {
      return alert("Tenés sets SHP incompletos. Completá .shp + .dbf + .shx o subí un ZIP/KMZ.");
    }

    if (polyRuleViolations.length) {
      const need = tipoCarpeta === "terreno" ? "TERRENO" : "MEJORA o MEJORAS";
      return alert(
        `Regla de nombre:\n` +
          `Estás en "${tipoCarpeta.toUpperCase()}" y el/los archivos deben contener "${need}" en el nombre.\n\n` +
          `No cumplen:\n- ${polyRuleViolations.map((x) => x.name).join("\n- ")}`
      );
    }

    setPolyBusy(true);
    try {
      const fd = new FormData();
      polyFiles.forEach((f) => fd.append("files", f));
      fd.append("id_expediente", String(current.id_expediente));

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
        throw new Error(resp?.message || "Falló la carga del polígono (backend no confirmó OK).");
      }
      if (inserted <= 0) {
        throw new Error(resp?.message || "No se insertaron geometrías. No se marcará la etapa.");
      }

      await setEtapa("plano_georef", true, etapas?.plano_georef?.obs || "");
      await loadEtapas(current.id_expediente, tipoCarpeta);

      setPlanoGeoCache((prev) => ({
        ...prev,
        [current.id_expediente]: {
          ...(prev[current.id_expediente] || { mejora: null, terreno: null }),
          [tipoCarpeta]: null,
        },
      }));

      await loadPlanoGeo(current.id_expediente, tipoCarpeta, true);
      setPolyFiles([]);

      alert("Plano georreferenciado cargado OK. Se marcó la etapa.");
    } catch (e) {
      alert(String(e?.message || e));
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
    const estado = String(
      dbiEventoEstadoPreset === "otro" ? dbiEventoEstado : dbiEventoEstadoPreset || dbiEventoEstado
    )
      .trim()
      .toLowerCase();
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
      setDbiEventoEstadoPreset("");
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
      const payload = {
        codigo,
        fecha_ingreso: fecha.toISOString(),
        obs: dbiInicioObs ? String(dbiInicioObs) : undefined,
      };
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/dbi/iniciar`,
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
      setDbiInicioObs("");
      setDbiInicioError("");
    } catch (e) {
      setDbiInicioError(String(e?.message || e));
    } finally {
      setDbiInicioBusy(false);
    }
  }

  // =========================
  // IMPORT EXCEL
  // =========================
  const EXP_FIELDS = [
    { key: "fecha_relevamiento", label: "Fecha relevamiento", type: "date" },
    { key: "gps", label: "GPS", type: "text" },
    { key: "tecnico", label: "Técnico", type: "text" },
    { key: "codigo_exp", label: "Código expediente", type: "text" },
    { key: "codigo_censo", label: "Código censo", type: "text" },
    { key: "propietario_nombre", label: "Propietario nombre", type: "text" },
    { key: "propietario_ci", label: "Propietario CI", type: "text" },
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "subtramo", label: "Subtramo", type: "text" },

    { key: "ci_propietario_frente_url", label: "CI Propietario Frente URL", type: "text" },
    { key: "ci_propietario_dorso_url", label: "CI Propietario Dorso URL", type: "text" },
    { key: "ci_adicional_frente_url", label: "CI Adicional Frente URL", type: "text" },
    { key: "ci_adicional_dorso_url", label: "CI Adicional Dorso URL", type: "text" },
  ];

  const [showImport, setShowImport] = useState(false);
  const [excelCols, setExcelCols] = useState([]);
  const [excelRows, setExcelRows] = useState([]);
  const [excelPreview, setExcelPreview] = useState([]);
  const [mapCols, setMapCols] = useState({});
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

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
        "Datos_del_Expediente_Código_Expediente_Notificación",
        "Datos_del_Expediente_Codigo_Expediente_Notificacion",
        "codigo expediente notificacion",
        "código expediente notificación",
        "codigo exp",
        "codigo expediente"
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

      subtramo: pick(
        "Datos_del_Expediente_Subtramo_1",
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
          const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
          const headers = json.length ? Object.keys(json[0]) : [];
          resolve({ headers, rows: json });
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function onExcelPicked(file) {
    setImportErrors([]);
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
      setExcelCols(headers);
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
    const errs = [];
    const required = ["codigo_exp", "propietario_nombre"];
    for (const k of required) {
      if (!mapCols[k]) errs.push(`Falta mapear: ${k}`);
    }
    if (errs.length) return { ok: false, errs };

    const mapped = excelRows.map((r) => {
      const obj = { id_proyecto: idProyecto };

      for (const f of EXP_FIELDS) {
        const col = mapCols[f.key];
        const val = col ? r[col] : "";

        if (f.key === "fecha_relevamiento") {
          const ymd = excelDateToYMD(val);
          obj[f.key] = ymd ? ymd : todayYMD();
        } else {
          obj[f.key] = String(val ?? "").trim() || null;
        }
      }

      return obj;
    });

    const cleaned = mapped.filter(
      (x) =>
        (x.codigo_exp && String(x.codigo_exp).trim() !== "") ||
        (x.propietario_nombre && String(x.propietario_nombre).trim() !== "")
    );

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
    try {
      await apiJson(`${API}/expedientes/import/${idProyecto}`, "POST", {
        rows: out.rows,
        mapping: mapCols,
        total: out.rows.length,
      });

      setShowImport(false);
      await load();
      alert(`Importación OK: ${out.rows.length} expedientes.`);
    } catch (e) {
      setImportErrors([String(e?.message || e)]);
    } finally {
      setImportBusy(false);
    }
  }

  // =========================
  // LOAD LIST + DOCS
  // =========================
  const load = async (overrides = null) => {
    setLoading(true);
    try {
      const q = String(overrides?.q ?? filterQ ?? "").trim();
      const tramoId = String(overrides?.tramoId ?? filterTramoId ?? "").trim();
      const subtramoId = String(overrides?.subtramoId ?? filterSubtramoId ?? "").trim();
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (tramoId) params.set("tramoId", tramoId);
      if (subtramoId) params.set("subtramoId", subtramoId);
      const qs = params.toString();
      const url = qs
        ? `${API}/expedientes/proyecto/${idProyecto}?${qs}`
        : `${API}/expedientes/proyecto/${idProyecto}`;
      const data = await apiGet(url);
      setRows(data);
    } finally {
      setLoading(false);
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
    loadTramosCensales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProyecto]);

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
    setDocs([]);
    setDocsCI([]);
    setDocsCIAdicional([]);
    setSubcarpeta("");

    setTipoCarpeta("mejora");
    setEtapas({});
    setEtapasErr("");

    setForm({
      id_proyecto: idProyecto,
      fecha_relevamiento: todayYMD(),
      gps: "",
      tecnico: "",
      codigo_exp: "",
      propietario_nombre: "",
      propietario_ci: "",
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
    });

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
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
    setMode("ver");
    setCurrent(freshRow);
    setSubcarpeta("");
    setDbiCodigo(freshRow?.carpeta_dbi?.codigo || "");

    const hasMejora = Object.values(freshRow?.carpeta_mejora || {}).some((s) => s?.ok);
    const hasTerreno = Object.values(freshRow?.carpeta_terreno || {}).some((s) => s?.ok);
    setTipoCarpeta(hasTerreno && !hasMejora ? "terreno" : "mejora");
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
    setDbiFile(null);
    setDbiInicioObs("");
    setDbiInicioError("");
    setDbiInicioFecha(nowLocalDateTimeInput());
    setDbiEventoFecha(nowLocalDateTimeInput());
    setAvaluoOpen(true);

    await loadDocs(freshRow.id_expediente);
    await loadCIDocs(freshRow.id_expediente);
    await loadEtapas(freshRow.id_expediente, "mejora");
    setShow(true);
  };

  const openEditar = async (row) => {
    const freshRow = await apiGet(`${API}/expedientes/${row.id_expediente}`);
    setMode("editar");
    setCurrent(freshRow);
    setSubcarpeta("");
    setDbiCodigo(freshRow?.carpeta_dbi?.codigo || "");

    const hasMejora = Object.values(freshRow?.carpeta_mejora || {}).some((s) => s?.ok);
    const hasTerreno = Object.values(freshRow?.carpeta_terreno || {}).some((s) => s?.ok);
    setTipoCarpeta(hasTerreno && !hasMejora ? "terreno" : "mejora");
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiAdicionalFrente(null);
    setCiAdicionalDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
    setDbiFile(null);
    setDbiInicioObs("");
    setDbiInicioError("");
    setDbiInicioFecha(nowLocalDateTimeInput());
    setDbiEventoFecha(nowLocalDateTimeInput());
    setAvaluoOpen(true);

    await loadDocs(freshRow.id_expediente);
    await loadCIDocs(freshRow.id_expediente);
    await loadEtapas(freshRow.id_expediente, "mejora");
    setShow(true);
  };

  const save = async () => {
    if (!form.fecha_relevamiento || !String(form.fecha_relevamiento).trim()) {
      alert("Fecha relevamiento es obligatoria.");
      return;
    }
    if (mode === "crear") {
      const created = await apiJson(`${API}/expedientes`, "POST", form);
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
      const upd = await apiJson(`${API}/expedientes/${current.id_expediente}`, "PUT", form);
      setCurrent(upd);
      mergeRow(upd);
      await load();
      alerts.toast.success("Datos guardados");
      setShow(false);
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

  const viewDoc = async (idArchivo) => {
    const resp = await fetch(`${API}/expedientes/documentos/ver/${idArchivo}`, {
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

  const downloadDoc = async (idArchivo, filename) => {
    const resp = await fetch(`${API}/expedientes/documentos/descargar/${idArchivo}`, {
      headers: { ...authHeaders() },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename || "documento";
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

    const img = isPublicImageUrl(cleanUrl);

    return (
      <div className="border rounded p-2 mt-2" style={{ background: "#fff" }}>
        <div className="small fw-semibold mb-2">{title}</div>

        {img ? (
          <>
            <a href={cleanUrl} target="_blank" rel="noreferrer">
              <img
                src={cleanUrl}
                alt={title}
                style={{
                  width: "100%",
                  maxWidth: 180,
                  height: 120,
                  objectFit: "cover",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  display: "block",
                  background: "#f8f9fa",
                }}
              />
            </a>
            <div className="mt-2">
              <a href={cleanUrl} target="_blank" rel="noreferrer" className="small">
                Ver imagen completa
              </a>
            </div>
          </>
        ) : (
          <a href={cleanUrl} target="_blank" rel="noreferrer" className="small">
            Abrir archivo
          </a>
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
    String(filterQ || "").trim() || filterTramoId || filterSubtramoId
  );

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

  return (
    <div className="container mt-3">
      <Row className="align-items-center mb-2">
        <Col>
          <h4 className="mb-0">Expedientes</h4>
          <small className="text-muted">Proyecto: {idProyecto}</small>
        </Col>

        <Col className="text-end">
          <Form.Label className="me-2 mb-0">Importar Excel</Form.Label>
          <Form.Control
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "inline-block", width: 260 }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onExcelPicked(f);
              e.target.value = "";
            }}
          />
          <Button className="ms-2" onClick={openCrear}>
            Nuevo
          </Button>
          <Link
            className="btn btn-outline-success btn-sm ms-2"
            to={`/proyectos/${id}/gv-catastro`}
          >
            🗺 Dashboard Catastro
          </Link>
        </Col>
      </Row>

      <Row className="align-items-center mb-2">
        <Col>
          {filtersActive ? (
            <small className="text-muted">Filtros activos</small>
          ) : (
            <small className="text-muted">Sin filtros</small>
          )}
          <span className="ms-2 text-muted">Resultados: {rows.length}</span>
        </Col>
      </Row>

      <Row className="align-items-center mb-2">
        <Col md={6}>
          <Form.Control
            placeholder="Buscar por nombre, CI, expediente, DBI o codigo censo"
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
        </Col>
        <Col md="auto">
          <Button onClick={() => load()} disabled={loading}>
            Buscar
          </Button>
        </Col>
        <Col md="auto">
          <Button
            variant="outline-secondary"
            onClick={() => {
              setFilterQ("");
              setFilterTramoId("");
              setFilterSubtramoId("");
              setSubtramosCensales([]);
              load();
            }}
            disabled={loading}
          >
            Limpiar
          </Button>
        </Col>
      </Row>

      <Row className="align-items-center mb-2">
        <Col md={4}>
          <Form.Select
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
            <option value="">Tramo (todos)</option>
            {tramosCensales.map((t) => (
              <option key={t.id_proyecto_tramo} value={t.id_proyecto_tramo}>
                {t.descripcion}
              </option>
            ))}
          </Form.Select>
        </Col>
        <Col md={4}>
          <Form.Select
            value={filterSubtramoId}
            onChange={(e) => {
              const v = e.target.value;
              setFilterSubtramoId(v);
              load({ subtramoId: v });
            }}
            disabled={!filterTramoId}
          >
            <option value="">Subtramo (todos)</option>
            {subtramosCensales.map((st) => (
              <option key={st.id_proyecto_subtramo} value={st.id_proyecto_subtramo}>
                {st.descripcion}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      <div className="table-responsive">
        <Table bordered hover size="sm" className="align-middle">
          <thead>
            <tr>
              <th>ID</th>
              <th>Código Exp.</th>
              <th>Propietario</th>
              <th>C.I.</th>
              <th>Tramo</th>
              <th>Tipo de carpeta</th>
              <th>Fecha</th>
              <th style={{ width: 160 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={8} className="text-center text-muted py-4">
                  {loading
                    ? "Cargando..."
                    : filtersActive
                      ? "No se encontraron expedientes con los filtros actuales"
                      : "Sin expedientes"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id_expediente}>
                <td>{r.id_expediente}</td>
                <td>{r.codigo_exp}</td>
                <td>{r.propietario_nombre}</td>
                <td>{r.propietario_ci}</td>
                <td>{r.tramo}</td>
                <td>
                  {(() => {
                    const hasMejora = hasActiveStages(r?.carpeta_mejora);
                    const hasTerreno = hasActiveStages(r?.carpeta_terreno);
                    if (hasMejora && !hasTerreno) return "Mejora";
                    if (hasTerreno && !hasMejora) return "Terreno";
                    if (hasMejora && hasTerreno) return "Legacy";
                    return "Sin iniciar";
                  })()}
                </td>
                <td>{r.fecha_relevamiento ? String(r.fecha_relevamiento).slice(0, 10) : ""}</td>
                <td>
                  <div className="btn-group">
                    <Button variant="secondary" size="sm" onClick={() => openVer(r)}>
                      Ver
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => openEditar(r)}>
                      Editar
                    </Button>
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
      <Modal show={show} onHide={() => setShow(false)} size="xl" centered>
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
                <Form.Label>GPS</Form.Label>
                <ExpedienteGpsField
                  ref={gpsFieldRef}
                  value={form.gps}
                  onChange={(gps) => setForm({ ...form, gps })}
                  onOpenMap={() => {
                    if (current?.id_expediente) {
                      loadPlanoGeo(current.id_expediente, tipoCarpeta);
                      loadCatastroFeatures();
                    }
                  }}
                  readOnlyGeometry={readOnlyGeometry}
                  disabled={readonly}
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
            <Col md={3}>
              <Form.Group>
                <Form.Label>Nro. Notificacion</Form.Label>
                <Form.Control
                  value={form.codigo_exp}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, codigo_exp: e.target.value })}
                />
              </Form.Group>
            </Col>

            <Col md={8}>
              <Form.Group>
                <Form.Label>Nombre del Propietario</Form.Label>
                <Form.Control
                  value={form.propietario_nombre}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, propietario_nombre: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>C.I</Form.Label>
                <Form.Control
                  value={form.propietario_ci}
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, propietario_ci: e.target.value })}
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
                          <Form.Label>Premio</Form.Label>
                          {readonly ? (
                            <div className="fw-semibold">{form.premio_aplica ? "Aplica 10%" : "No aplica"}</div>
                          ) : (
                            <Form.Check
                              type="checkbox"
                              label="Aplicar premio 10%"
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
                              <td className="fw-semibold">Premio</td>
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
              * El “Plano georreferenciado” se completa al <b>subir el polígono</b>.
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
                    disabled={!current || onlyTerrenoActive}
                    onClick={async () => {
                      setTipoCarpeta("mejora");
                      setPolyFiles([]);
                      if (current) await loadEtapas(current.id_expediente, "mejora");
                    }}
                  >
                    Mejora
                  </Button>
                  <Button
                    variant={tipoCarpeta === "terreno" ? "primary" : "outline-primary"}
                    disabled={!current || onlyMejoraActive}
                    onClick={async () => {
                      setTipoCarpeta("terreno");
                      setPolyFiles([]);
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
                              <b>{e.label}</b>
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
                                <div className="d-flex flex-column gap-2">
                                  <div className="d-flex gap-2 align-items-center">
                                    <Form.Control
                                      type="file"
                                      multiple
                                      accept=".shp,.dbf,.shx,.zip,.kml,.kmz,.rar,.geojson,.json,.gpkg,.gpx,.gml,.dxf"
                                      disabled={readonly || !editable || polyBusy}
                                      onChange={(ev) => setPolyFiles(Array.from(ev.target.files || []))}
                                    />
                                    <Button
                                      variant="success"
                                      disabled={readonly || !editable || polyBusy || !polyFiles.length}
                                      onClick={subirPoligono}
                                    >
                                      {polyBusy ? "Subiendo..." : "Cargar polígono"}
                                    </Button>
                                  </div>

                                  {polyFiles.length > 0 && (
                                    <div className="small">
                                      {polyInvalidTriads && (
                                        <div className="text-danger">
                                          ⚠️ Hay SHP incompletos: debe venir <b>.shp + .dbf + .shx</b> (mismo nombre base), o subí un ZIP/KMZ.
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
                                                <li key={x.name}>{x.name}</li>
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
                                              <div key={s.baseNorm} className="d-flex align-items-center gap-2">
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
                                            <div key={s.id} className="d-flex align-items-center gap-2">
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

                                  <div className="d-flex align-items-center gap-2 mt-2">
                                    {planoGeoLoading ? (
                                      <span className="text-muted small">Cargando polígono…</span>
                                    ) : (
                                      <Badge bg={planoHasGeom ? "success" : "secondary"}>
                                        {planoHasGeom ? "Polígono cargado" : "Sin polígono"}
                                      </Badge>
                                    )}
                                    {planoHasGeom && (
                                      <span className="text-muted small">Features: {planoFeatureCount}</span>
                                    )}
                                  </div>
                                  {planoGeoError && (
                                    <div className="text-danger small mt-1">{planoGeoError}</div>
                                  )}
                                  <div className="d-flex gap-2 mt-2">
                                    <Button
                                      size="sm"
                                      variant="outline-primary"
                                      onClick={handleVerPlanoEnMapa}
                                      disabled={!planoHasGeom}
                                    >
                                      Ver en mapa
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline-danger"
                                      onClick={handleEliminarPlano}
                                      disabled={!planoHasGeom || readonly || currentGroupBlocked}
                                    >
                                      Eliminar
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-muted small">—</div>
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
                    const dbiFecha = formatLocalDateTime(dbiInfo.fecha_ingreso);
                    const hasCodigo = Boolean(dbiInfo.codigo);
                    const hasEstado = Boolean(dbiInfo.estado);
                    const hasFecha = Boolean(dbiFecha);
                    if (!hasCodigo && !hasEstado && !hasFecha) return null;
                    return (
                      <div className="text-muted small mb-2">
                        {hasCodigo && <span className="me-3">Código: {dbiInfo.codigo}</span>}
                        {hasFecha && <span className="me-3">Fecha ingreso: {dbiFecha}</span>}
                        {hasEstado && <span>Estado: {dbiInfo.estado}</span>}
                      </div>
                    );
                  })()}
                  {!readonly && (() => {
                    const dbiInfo = current?.carpeta_dbi || {};
                    const dbiIniciado = Boolean(dbiInfo.codigo || dbiInfo.fecha_ingreso);
                    if (dbiIniciado) return null;
                    return (
                      <div className="mt-2">
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
                              <Form.Label>Observación (opcional)</Form.Label>
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
                          Primero registrá el ingreso inicial de DBI para habilitar hitos posteriores.
                        </div>
                      </div>
                    );
                  })()}
                  <div className="mt-3">
                    <h6 className="mb-2">Hitos DBI</h6>
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
                              <th>Estado</th>
                              <th>Fecha</th>
                              <th>Observación</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ordered.map((ev, i) => {
                              const fecha = formatLocalDateTime(ev?.fecha);
                              return (
                                <tr key={`dbi-evt-${i}`}>
                                  <td>{ev?.estado || "—"}</td>
                                  <td>{fecha || "—"}</td>
                                  <td>{ev?.obs || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      );
                    })()}
                  </div>
                  {!readonly && (() => {
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
                              value={dbiEventoEstadoPreset}
                              disabled={dbiEventoBusy}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDbiEventoEstadoPreset(val);
                                if (val !== "otro") setDbiEventoEstado("");
                              }}
                            >
                              <option value="">Seleccioná un estado</option>
                              <option value="ingresado">ingresado</option>
                              <option value="devuelto">devuelto</option>
                              <option value="reingresado">reingresado</option>
                              <option value="aprobado">aprobado</option>
                              <option value="observado">observado</option>
                              <option value="rechazado">rechazado</option>
                              <option value="otro">Otro / personalizado</option>
                            </Form.Select>
                          </Form.Group>
                          {dbiEventoEstadoPreset === "otro" && (
                            <Form.Control
                              className="mt-2"
                              value={dbiEventoEstado}
                              disabled={dbiEventoBusy}
                              onChange={(e) => setDbiEventoEstado(e.target.value)}
                              placeholder="estado personalizado"
                            />
                          )}
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
                              (!dbiEventoEstadoPreset &&
                                !dbiEventoEstado.trim())
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
                          disabled={readonly}
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
                          disabled={readonly}
                          onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                        />
                      </Form.Group>
                    </Col>

                    <Col md={12} className="text-end">
                      {!readonly && (
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
                                disabled={readonly}
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
                                disabled={readonly}
                                onChange={(e) => setCiDorso(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12} className="text-end">
                            {!readonly && (
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
                                            onClick={() => viewDoc(d.id_archivo)}
                                          >
                                            Ver
                                          </Button>
                                          <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={() => downloadDoc(d.id_archivo, d.nombre_archivo)}
                                          >
                                            Descargar
                                          </Button>
                                          {!readonly && (
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
                                disabled={readonly}
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
                                disabled={readonly}
                                onChange={(e) => setCiAdicionalDorso(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>

                          <Col md={12} className="text-end">
                            {!readonly && (
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
                                            onClick={() => viewDoc(d.id_archivo)}
                                          >
                                            Ver
                                          </Button>
                                          <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={() => downloadDoc(d.id_archivo, d.nombre_archivo)}
                                          >
                                            Descargar
                                          </Button>
                                          {!readonly && (
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
                                  onClick={() => viewDoc(d.id_archivo)}
                                >
                                  Ver
                                </Button>
                                <Button
                                  variant="outline-primary"
                                  size="sm"
                                  onClick={() => downloadDoc(d.id_archivo, d.nombre_archivo)}
                                >
                                  Descargar
                                </Button>
                                {!readonly && (
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
          {!readonly && canDeleteTotal && current && (
            <Button variant="danger" onClick={openDeleteModal}>
              Eliminar expediente
            </Button>
          )}
          <Button variant="secondary" onClick={() => setShow(false)}>
            Cerrar
          </Button>
          {!readonly && (
            <Button variant="primary" onClick={save}>
              {mode === "crear" ? "Guardar" : "Actualizar"}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* =========================
          MODAL DELETE TOTAL
         ========================= */}
      <Modal show={showDeleteModal} onHide={() => !deleteBusy && setShowDeleteModal(false)} centered>
        <Modal.Header closeButton={!deleteBusy}>
          <Modal.Title>Eliminar expediente definitivamente</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-3">
            Se eliminará el expediente, sus etapas, geometrías, documentos y archivos físicos asociados. Esta acción
            no se puede deshacer.
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

          <Row className="g-3">
            <Col md={5}>
              <h6 className="mb-2">Mapeo de columnas</h6>

              {EXP_FIELDS.map((f) => (
                <Form.Group className="mb-2" key={f.key}>
                  <Form.Label className="mb-1">{f.label}</Form.Label>
                  <Form.Select
                    value={mapCols[f.key] || ""}
                    onChange={(e) => setMapCols((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  >
                    <option value="">— No mapear —</option>
                    {excelCols.map((c, idx) => (
                      <option key={`mapcol-${c}-${idx}`} value={c}>
                        {c}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              ))}

              <div className="text-muted small mt-2">
                Filas detectadas: <b>{excelRows.length}</b>
              </div>
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
                      {excelCols.slice(0, 8).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {excelPreview.map((r, idx) => (
                      <tr key={idx}>
                        {excelCols.slice(0, 8).map((h) => (
                          <td key={h}>{String(r[h] ?? "")}</td>
                        ))}
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
    </div>
  );
}
