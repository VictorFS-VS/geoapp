// src/pages/Expedientes.jsx
// ✅ CRUD expedientes + Documentos (tumba) + IMPORT EXCEL + ✅ Elaboración de Carpetas (Mejora/Terreno) + ✅ DBI
// ✅ Plano georeferenciado: sube polígono (SHP triad / ZIP / KML / KMZ / GeoJSON) usando /api/mantenimiento/upload/:idProyecto (fieldName="files")
// ✅ Inserta en ema.bloque_mejoras / ema.bloque_terreno + pasa id_expediente
// ✅ REGLA NUEVA: ✅ SOLO marca etapa "plano_georef" si el backend confirma ok=true y inserted>0
// ✅ Soporta: .shp+.dbf+.shx (seleccionados juntos), .zip, .kml, .kmz (y opcional .geojson/.json)
// ✅ REGLA: si estás en "terreno" el nombre debe contener TERRENO; si estás en "mejora" debe contener MEJORA/MEJORAS
// ✅ Preview muestra si hay SHP incompletos y si el nombre NO cumple la regla del tipo

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Button, Modal, Form, Table, Row, Col, Badge, Alert } from "react-bootstrap";
import ExpedienteGpsField from "@/components/ExpedienteGpsField";
import { alerts } from "@/utils/alerts";
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
  const [docsCIPareja, setDocsCIPareja] = useState([]);
  const ciSubcarpetas = useMemo(() => new Set(["ci", "ci_pareja"]), []);

  const [planoGeoCache, setPlanoGeoCache] = useState({});
  const [planoGeoLoading, setPlanoGeoLoading] = useState(false);
  const [planoGeoError, setPlanoGeoError] = useState("");

  const [catastroFeatures, setCatastroFeatures] = useState(null);
  const [catastroLoadedFor, setCatastroLoadedFor] = useState(null);
  const [catastroLoading, setCatastroLoading] = useState(false);
  const [catastroError, setCatastroError] = useState("");

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
  });

  // Catálogos Censales
  const [tramosCensales, setTramosCensales] = useState([]);
  const [subtramosCensales, setSubtramosCensales] = useState([]);

  // uploads (tumba)
  const [uploadFiles, setUploadFiles] = useState([]);
  const [ciFrente, setCiFrente] = useState(null);
  const [ciDorso, setCiDorso] = useState(null);
  const [ciParejaFrente, setCiParejaFrente] = useState(null);
  const [ciParejaDorso, setCiParejaDorso] = useState(null);
  const [subcarpeta, setSubcarpeta] = useState("");

  // carpeta activa (mejora | terreno)
  const [tipoCarpeta, setTipoCarpeta] = useState("mejora");

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

  const etapasList = tipoCarpeta === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;

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
    if (st?.ok) return true; // si ya está ok, puede editar obs
    const pending = firstPendingKey();
    return pending === key; // solo el primero pendiente
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

  async function setEtapa(key, ok, obs) {
    if (!current) return;
    if ((tipoCarpeta === "mejora" && onlyTerrenoActive) || (tipoCarpeta === "terreno" && onlyMejoraActive)) {
      return;
    }
    setSavingEtapa(true);
    try {
      const data = await apiJson(
        `${API}/expedientes/${current.id_expediente}/etapas/${tipoCarpeta}/${key}`,
        "PUT",
        { ok, obs }
      );
      setEtapas(data || {});
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

      // single: zip/kml/kmz/rar o convertibles
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

      // triad: shp/dbf/shx
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
        if (!matchesTipoRule(s.file?.name, tipoCarpeta))
          bad.push({ kind: "single", name: s.file?.name || "archivo" });
      }
    }
    return bad;
  }, [polySets, tipoCarpeta]);

  /**
   * ✅ SUBIR POLÍGONO (SHP triad / ZIP / KML / KMZ / GeoJSON) POR MANTENIMIENTO
   * - middleware uploadShapefiles espera campo 'files'
   * - manda id_expediente
   * - manda defaultTabla repetido por cada SINGLE (ZIP/KML/KMZ/GeoJSON) para ruteo determinístico
   * - manda mapping (baseNorm -> tablaDestino) por si tu backend ya lo soporta
   * - ✅ valida regla de nombre según tipoCarpeta
   * - ✅ SOLO marca etapa plano_georef si backend devuelve ok=true e inserted>0
   */
  async function subirPoligono() {
    if (!current) return;

    if (!polyFiles.length) {
      return alert("Seleccioná archivos: SHP+DBF+SHX (juntos) o ZIP/KML/KMZ (y opcional GeoJSON).");
    }

    if (polyInvalidTriads) {
      return alert("Tenés sets SHP incompletos. Completá .shp + .dbf + .shx o subí un ZIP/KMZ.");
    }

    // ✅ Regla nombre por tipo
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

      // 👇 IMPORTANTE: tu middleware usa req.files.files => fieldName = "files"
      polyFiles.forEach((f) => fd.append("files", f));

      // ✅ tu controller lee id_expediente del body
      fd.append("id_expediente", String(current.id_expediente));

      // ✅ tabla destino determinística por tipoCarpeta
      const tablaDestino = tipoCarpeta === "mejora" ? "ema.bloque_mejoras" : "ema.bloque_terreno";

      // ✅ defaultTabla repetido por cada SINGLE
      const singles = polySets.filter((s) => s.kind === "single");
      for (const _s of singles) fd.append("defaultTabla", tablaDestino);

      // ✅ mapping por baseNorm (opcional, pero ayuda)
      const mapping = {};
      for (const s of polySets) mapping[s.baseNorm] = tablaDestino;
      fd.append("mapping", JSON.stringify(mapping));

      // ✅ respuesta esperada (ideal):
      // { ok:true, inserted: N, ... }  ó  { success:true, count:N }
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

      // ✅ recién aquí marcamos el check
      await setEtapa("plano_georef", true, etapas?.plano_georef?.obs || "");

      await loadEtapas(current.id_expediente, tipoCarpeta);
      setPlanoGeoCache((prev) => ({
        ...prev,
        [current.id_expediente]: { ...(prev[current.id_expediente] || { mejora: null, terreno: null }), [tipoCarpeta]: null },
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
      await loadDocs(current.id_expediente);
      alert("DBI subido OK.");
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setDbiBusy(false);
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
    { key: "propietario_nombre", label: "Propietario nombre", type: "text" },
    { key: "propietario_ci", label: "Propietario CI", type: "text" },
    { key: "tramo", label: "Tramo", type: "text" },
    { key: "subtramo", label: "Subtramo", type: "text" },
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
        const hit = H.find((x) => x.n === cn) || H.find((x) => x.n.includes(cn));
        if (hit) return hit.raw;
      }
      return "";
    };
    return {
      fecha_relevamiento: pick("fecha", "fecha relevamiento", "fecha_relevamiento"),
      gps: pick("gps", "coordenadas", "ubicacion"),
      tecnico: pick("tecnico", "técnico", "inspector"),
      codigo_exp: pick("codigo", "codigo exp", "codigo expediente", "codigo_exp"),
      propietario_nombre: pick("propietario", "nombre propietario", "propietario nombre", "propietario_nombre"),
      propietario_ci: pick("ci", "c i", "cedula", "cedula identidad", "propietario ci", "propietario_ci"),
      tramo: pick("tramo"),
      subtramo: pick("subtramo", "sub tramo", "sub_tramo"),
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
    for (const k of required) if (!mapCols[k]) errs.push(`Falta mapear: ${k}`);
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
    const data = await apiGet(
      `${API}/expedientes/${idExp}/documentos?carpeta=${encodeURIComponent(subcarpeta || "")}`
    );
    setDocs(Array.isArray(data) ? data : []);
  };

  const loadDocsBySubcarpeta = async (idExp, carpeta) => {
    const data = await apiGet(
      `${API}/expedientes/${idExp}/documentos?carpeta=${encodeURIComponent(carpeta || "")}`
    );
    return Array.isArray(data) ? data : [];
  };

  const loadCIDocs = async (idExp) => {
    const [titular, pareja] = await Promise.all([
      loadDocsBySubcarpeta(idExp, "ci"),
      loadDocsBySubcarpeta(idExp, "ci_pareja"),
    ]);
    setDocsCI(titular);
    setDocsCIPareja(pareja);
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

    const found = rows.find(
      (r) => Number(r.id_expediente) === expId
    );

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
    setDocsCIPareja([]);
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
    });

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiParejaFrente(null);
    setCiParejaDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
    setDbiFile(null);

    setShow(true);
  };

  const openVer = async (row) => {
    const freshRow = await apiGet(`${API}/expedientes/${row.id_expediente}`);
    setMode("ver");
    setCurrent(freshRow);
    setSubcarpeta("");

    const hasMejora = Object.values(freshRow?.carpeta_mejora || {}).some((s) => s?.ok);
    const hasTerreno = Object.values(freshRow?.carpeta_terreno || {}).some((s) => s?.ok);
    setTipoCarpeta(hasTerreno && !hasMejora ? "terreno" : "mejora");
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiParejaFrente(null);
    setCiParejaDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
    setDbiFile(null);

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

    const hasMejora = Object.values(freshRow?.carpeta_mejora || {}).some((s) => s?.ok);
    const hasTerreno = Object.values(freshRow?.carpeta_terreno || {}).some((s) => s?.ok);
    setTipoCarpeta(hasTerreno && !hasMejora ? "terreno" : "mejora");
    setEtapas({});
    setEtapasErr("");

    setForm(hydrateFormFromRow(freshRow));

    setUploadFiles([]);
    setCiFrente(null);
    setCiDorso(null);
    setCiParejaFrente(null);
    setCiParejaDorso(null);

    setPolyFiles([]);
    setDbiCodigo("");
    setDbiFile(null);

    await loadDocs(freshRow.id_expediente);
    await loadCIDocs(freshRow.id_expediente);
    await loadEtapas(freshRow.id_expediente, "mejora");
    setShow(true);
  };

  const save = async () => {
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

  const uploadCIPareja = async () => {
    if (!current) return;
    if (!ciParejaFrente && !ciParejaDorso) {
      alert("Seleccioná CI pareja frente y/o dorso.");
      return;
    }
    const fd = new FormData();
    if (ciParejaFrente) fd.append("ci_frente", ciParejaFrente);
    if (ciParejaDorso) fd.append("ci_dorso", ciParejaDorso);
    fd.append("subcarpeta", "ci_pareja");

    await apiForm(
      `${API}/expedientes/${current.id_expediente}/ci/upload?subcarpeta=${encodeURIComponent("ci_pareja")}`,
      "POST",
      fd
    );
    setCiParejaFrente(null);
    setCiParejaDorso(null);
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
              <th>SubTramo</th>
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
                <td>{r.subtramo}</td>
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
                  disabled={readonly}
                  onChange={(e) => setForm({ ...form, fecha_relevamiento: e.target.value })}
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
                          id_sub_tramo: null, // resetear al cambiar tramo
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
                        setPolyFiles([]); // ✅ evita mezclar archivos del otro tipo
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
                        setPolyFiles([]); // ✅ evita mezclar archivos del otro tipo
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
                        <th style={{ width: 260 }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {etapasList.map((e) => {
                        const st = etapas?.[e.key] || { ok: false, obs: "" };
                        const editable = canEditKey(e.key);

                        const isPlano = e.key === "plano_georef";
                        const disableCheck =
                          readonly || savingEtapa || !editable || isPlano || currentGroupBlocked;
                        const disableObs =
                          readonly || savingEtapa || (!editable && !st.ok) || currentGroupBlocked;

                        return (
                          <tr key={e.key}>
                            <td className="text-center">
                              <Form.Check
                                checked={!!st.ok}
                                disabled={disableCheck}
                                onChange={(ev) => setEtapa(e.key, ev.target.checked, st.obs || "")}
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
                                  if (!readonly) setEtapa(e.key, !!st.ok, st.obs || "");
                                }}
                              />
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

                                  {/* Preview */}
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

                                      {/* mini listado sets */}
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
                <div className="text-muted">Primero guardá el expediente para subir DBI.</div>
              ) : (
                <Row className="g-2 align-items-end">
                  <Col md={4}>
                    <Form.Group>
                      <Form.Label>Código</Form.Label>
                      <Form.Control
                        value={dbiCodigo}
                        disabled={readonly || dbiBusy}
                        onChange={(e) => setDbiCodigo(e.target.value)}
                        placeholder="Ej: DBI-2026-001"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Archivo final (carpeta finalizada)</Form.Label>
                      <Form.Control
                        type="file"
                        disabled={readonly || dbiBusy}
                        onChange={(e) => setDbiFile(e.target.files?.[0] || null)}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={2} className="text-end">
                    {!readonly && (
                      <Button variant="primary" disabled={dbiBusy} onClick={subirDBI}>
                        {dbiBusy ? "Subiendo..." : "Subir DBI"}
                      </Button>
                    )}
                  </Col>
                  <Col md={12}>
                    <div className="text-muted small">
                      * Se guarda en tumba con subcarpeta <b>dbi</b> dentro del expediente.
                    </div>
                  </Col>
                </Row>
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
                          </Col>
                        </Row>
                      </div>
                    </Col>

                    <Col md={6}>
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">C.I. Pareja</div>
                        <Row className="g-2">
                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Pareja Frente</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly}
                                onChange={(e) => setCiParejaFrente(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>
                          <Col md={12}>
                            <Form.Group>
                              <Form.Label>C.I. Pareja Dorso</Form.Label>
                              <Form.Control
                                type="file"
                                accept="image/*"
                                disabled={readonly}
                                onChange={(e) => setCiParejaDorso(e.target.files?.[0] || null)}
                              />
                            </Form.Group>
                          </Col>
                          <Col md={12} className="text-end">
                            {!readonly && (
                              <Button variant="outline-success" onClick={uploadCIPareja}>
                                Subir CI pareja
                              </Button>
                            )}
                          </Col>
                          <Col md={12}>
                            {docsCIPareja.length ? (
                              <Table bordered size="sm" className="mt-2">
                                <thead>
                                  <tr>
                                    <th>Archivo</th>
                                    <th>Fecha</th>
                                    <th style={{ width: 200 }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {docsCIPareja.map((d) => (
                                    <tr key={`ci-pareja-${d.id_archivo}`}>
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
                              <div className="text-muted small mt-2">Sin C.I. pareja cargada</div>
                            )}
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
                Tip: asegurá encabezados en la primera fila del Excel. <br />
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

              <div className="mt-2 text-muted small">* Se muestran solo 8 columnas para que entre en pantalla.</div>
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
