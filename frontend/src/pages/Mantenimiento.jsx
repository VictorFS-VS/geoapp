// src/pages/Mantenimiento.jsx ✅ COMPLETO + FIX MULTIUPLOAD + BUFFER por archivo (buff_dist)
// ✅ FIX MULTIUPLOAD: enviar defaultTabla repetido (array) por CADA "single"
// ✅ FIX: bug setMapping vs setSetMapping (ahora los selects guardan bien)
// ✅ NUEVO: Select "Buffer" (500/700/1000) por archivo/set cuando destino = Área de Influencia
//          Envía bufferByBaseNorm (JSON) al backend para guardar buff_dist aunque el nombre no lo tenga
// ✅ Mantiene mapping para triads y singles + export + delete

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

const EXT_REQ = [".shp", ".dbf", ".shx"];
const ARCHIVE_EXTS = [".zip", ".kml", ".kmz", ".rar"];
const CONVERTIBLE_EXTS = [".geojson", ".json", ".gpkg", ".gpx", ".gml", ".dxf"];

/* ===== Buffer (Área de Influencia) ===== */
const BUFFER_OPTS = [500, 700, 1000];
function detectBufferFromName(nameOrBase) {
  const s = String(nameOrBase || "");
  const m = s.match(/(?:^|[^0-9])(500|700|1000)(?:[^0-9]|$)/);
  return m ? Number(m[1]) : null;
}

/* ===== Helpers auth / fetch / descarga ===== */
const getBearer = () => {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  if (!t) return null;
  return t.startsWith("Bearer ") ? t : `Bearer ${t}`;
};
const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
};
const redirect401 = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("access_token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
  window.location.replace("/login");
};
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return null;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

function getFilenameFromDisposition(cd, fallback) {
  try {
    if (!cd) return fallback;
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
    const raw = decodeURIComponent(m?.[1] || m?.[2] || "");
    return raw || fallback;
  } catch {
    return fallback;
  }
}
async function downloadWithName(url, fallbackName) {
  const res = await fetch(url, { headers: { ...authHeaders() } });
  if (res.status === 401) {
    redirect401();
    return;
  }
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    let msg = "Error de descarga";
    try {
      if (ct.includes("application/json")) {
        const j = await res.json();
        msg = j?.message || j?.error || msg;
      } else {
        msg = (await res.text()) || msg;
      }
    } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition");
  const name = getFilenameFromDisposition(cd, fallbackName);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ===== Capas conocidas (clave → etiqueta/tabla) ===== */
const CAPAS = [
  { key: "PLANO_PROYECTO", label: "Plano Proyecto", tabla: "plano_proyecto" },
  { key: "POLIGONO_PROYECTO", label: "Polígono del Proyecto", tabla: "poligono_proyecto" },
  { key: "AREA_INFLUENSIA", label: "Área de Influencia", tabla: "bloques_area_influensia" },
  { key: "USO_ACTUAL", label: "Uso Actual", tabla: "bloques_uso_actual" },
  { key: "USO_ALTERNATIVO", label: "Uso Alternativo", tabla: "bloques_uso_alternativo" },
  { key: "USO_1986", label: "Uso 1986/1987", tabla: "bloques_uso86" },
  { key: "TRAMO", label: "Tramos del Proyecto", tabla: "bloques_tramo" },
  { key: "PROGRESIVA", label: "Progresivas del Proyecto", tabla: "bloques_progresivas" },
  { key: "COMUNIDADES_INDI", label: "Comunidades Indígenas", tabla: "bloques_comu_ind" },
  { key: "POLIGONOS_EXTRA", label: "Otros Polígonos (Genéricos)", tabla: "poligonos_extra" },
];

/* =========================================================
   ✅ Normalización y detección tolerante (como backend)
   ========================================================= */
function normalizeBaseForMatch(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function baseUpper(name) {
  const i = name.lastIndexOf(".");
  return (i >= 0 ? name.slice(0, i) : name).trim().toUpperCase();
}
function extLower(name) {
  const m = name.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : "";
}

// Matchers tolerantes
const MATCHERS = [
  { key: "POLIGONO_PROYECTO", re: /(^|_)POLIGONO_PROYECTO([A-Z0-9]|_|$)/ },
  {
    key: "AREA_INFLUENSIA",
    re: /(^|_)(AREA(_)?(DE_)?INFLU(EN)?(C|S)IA|INFLU)([A-Z0-9]|_|$)/,
  },
  { key: "USO_ACTUAL", re: /(^|_)USO_ACTUAL([A-Z0-9]|_|$)/ },
  { key: "USO_ALTERNATIVO", re: /(^|_)USO_ALTERNATIVO([A-Z0-9]|_|$)/ },
  { key: "USO_1986", re: /(^|_)USO(_)?(1986|86|1987|87)([A-Z0-9]|_|$)/ },
  { key: "TRAMO", re: /(^|_)TRAMO(S)?([A-Z0-9]|_|$)/ },
  { key: "PROGRESIVA", re: /(^|_)PROGRESIVA(S)?([A-Z0-9]|_|$)/ },
  { key: "PLANO_PROYECTO", re: /(^|_)PLANO_PROYECTO([A-Z0-9]|_|$)/ },
  { key: "COMUNIDADES_INDI", re: /(^|_)COMUNIDADES?_INDI([A-Z0-9]|_|$)/ },
  { key: "POLIGONOS_EXTRA", re: /(^|_)POLIGONOS?_EXTRA([A-Z0-9]|_|$)/ },
];

const HINT_RULES = [
  { key: "TRAMO", label: "TRAMO", loose: /TRAMO(S)?[A-Z0-9]+/ },
  { key: "PROGRESIVA", label: "PROGRESIVA", loose: /PROGRESIVA(S)?[A-Z0-9]+/ },
  { key: "USO_ACTUAL", label: "USO_ACTUAL", loose: /USO_ACTUAL[A-Z0-9]+/ },
  { key: "USO_ALTERNATIVO", label: "USO_ALTERNATIVO", loose: /USO_ALTERNATIVO[A-Z0-9]+/ },
  { key: "USO_1986", label: "USO_1986", loose: /USO(_)?(1986|86|1987|87)[A-Z0-9]+/ },
  { key: "POLIGONO_PROYECTO", label: "POLIGONO_PROYECTO", loose: /POLIGONO_PROYECTO[A-Z0-9]+/ },
  { key: "PLANO_PROYECTO", label: "PLANO_PROYECTO", loose: /PLANO_PROYECTO[A-Z0-9]+/ },
  { key: "COMUNIDADES_INDI", label: "COMUNIDADES_INDI", loose: /COMUNIDADES?_INDI[A-Z0-9]+/ },
  {
    key: "AREA_INFLUENSIA",
    label: "AREA_INFLUENCIA",
    loose: /(AREA(_)?(DE_)?INFLU(EN)?(C|S)IA|INFLU)[A-Z0-9]+/,
  },
  { key: "POLIGONOS_EXTRA", label: "POLIGONOS_EXTRA", loose: /POLIGONOS?_EXTRA[A-Z0-9]+/ },
];

function detectKeyByNormalizedBase(base) {
  const norm = normalizeBaseForMatch(base);
  for (const m of MATCHERS) if (m.re.test(norm)) return m.key;
  return null;
}
function detectionHint(base) {
  const norm = normalizeBaseForMatch(base);
  const official = detectKeyByNormalizedBase(base);
  if (!official) return null;

  for (const r of HINT_RULES) {
    if (r.key !== official) continue;
    if (
      r.loose.test(norm) &&
      !norm.includes("_" + r.label + "_") &&
      !norm.startsWith(r.label + "_") &&
      !norm.endsWith("_" + r.label)
    ) {
      return `Se detectó por palabra clave '${r.label}' (nombre pegado).`;
    }
  }
  return null;
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

function capaLabelFromKey(key) {
  return CAPAS.find((c) => c.key === key)?.label || key;
}

/* ✅ Key -> tabla fq para backend */
function keyToTablaFQ(k) {
  if (k === "POLIGONOS_EXTRA") return "ema.poligonos_extra";
  if (k === "POLIGONO_PROYECTO") return "ema.poligono_proyecto";
  if (k === "USO_ACTUAL") return "ema.bloques_uso_actual";
  if (k === "USO_ALTERNATIVO") return "ema.bloques_uso_alternativo";
  if (k === "USO_1986") return "ema.bloques_uso86";
  if (k === "TRAMO") return "ema.bloques_tramo";
  if (k === "PROGRESIVA") return "ema.bloques_progresivas";
  if (k === "PLANO_PROYECTO") return "ema.plano_proyecto";
  if (k === "COMUNIDADES_INDI") return "ema.bloques_comu_ind";
  if (k === "AREA_INFLUENSIA") return "ema.bloques_area_influensia";
  return "";
}

export default function Mantenimiento() {
  const { id } = useParams();
  const fileInputRef = useRef(null);

  const [archivos, setArchivos] = useState([]);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [statusCapas, setStatusCapas] = useState({});
  const [exportando, setExportando] = useState(false);

  const [selectedLayers, setSelectedLayers] = useState([]);
  const [showLayerPicker, setShowLayerPicker] = useState(false);

  // ✅ importante: el estado real se llama setMapping
  const [setMapping, setSetMapping] = useState({});
  const [tipoExtra, setTipoExtra] = useState("");

  // ✅ NUEVO: buffer por set/archivo (baseNorm -> 500/700/1000)
  const [bufferMap, setBufferMap] = useState({});

  useEffect(() => {
    fetchStatusCapas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchStatusCapas() {
    try {
      const res = await fetch(`${API_URL}/mantenimiento/status-capas/${id}`, {
        headers: { ...authHeaders() },
      });
      const data = await jsonOrRedirect401(res);
      if (!data) return;

      setStatusCapas(data);
      const conDatos = Object.keys(data).filter((k) => data[k]);
      setSelectedLayers(conDatos);
    } catch (err) {
      alerts.toast.error(err.message || "Falló obtener estado de capas");
    }
  }

  function handleFileChange(e) {
    const list = Array.from(e.target.files || []);
    const valids = list.filter((f) =>
      /\.(shp|dbf|shx|zip|kml|kmz|rar|geojson|json|gpkg|gpx|gml|dxf)$/i.test(f.name)
    );
    setArchivos(valids);
    setUploadNotice(null);
  }

  const sets = useMemo(() => {
    const byBase = new Map();
    const singles = [];

    for (const f of archivos) {
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
          detected: detectKeyByNormalizedBase(b),
          hint: detectionHint(b),
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
            detected: detectKeyByNormalizedBase(b),
            hint: detectionHint(b),
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
  }, [archivos]);

  // Prefill mapping por set
  useEffect(() => {
    setSetMapping((prev) => {
      const next = { ...prev };
      for (const s of sets) {
        const bn = s.baseNorm;
        if (next[bn]) continue;
        next[bn] = s.detected || "POLIGONOS_EXTRA";
      }
      const live = new Set(sets.map((s) => s.baseNorm));
      for (const k of Object.keys(next)) {
        if (!live.has(k)) delete next[k];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets]);

  // Prefill buffer por set (si detecta 500/700/1000 en el nombre)
  useEffect(() => {
    setBufferMap((prev) => {
      const next = { ...prev };
      for (const s of sets) {
        const bn = s.baseNorm;
        if (next[bn]) continue;

        const auto =
          detectBufferFromName(s.base) ||
          detectBufferFromName(s.file?.name) ||
          detectBufferFromName(bn) ||
          null;

        if (auto) next[bn] = auto;
      }

      const live = new Set(sets.map((s) => s.baseNorm));
      for (const k of Object.keys(next)) {
        if (!live.has(k)) delete next[k];
      }
      return next;
    });
  }, [sets]);

  function setBufferForSet(baseNorm, value) {
    setBufferMap((prev) => ({
      ...prev,
      [baseNorm]: value ? Number(value) : "",
    }));
  }

  const invalidTriads = useMemo(
    () => sets.some((s) => s.kind === "triad" && !s.validTriad),
    [sets]
  );
  const hasAnyFile = archivos.length > 0;

  // mapping backend: baseNorm → tabla fq (ema.*)
  const mappingPayload = useMemo(() => {
    const out = {};
    for (const s of sets) {
      const capaKey = setMapping[s.baseNorm] || s.detected || "POLIGONOS_EXTRA";
      const forced = keyToTablaFQ(capaKey);
      if (forced) out[s.baseNorm] = forced;
    }
    return out;
  }, [sets, setMapping]);

  function setCapaForSet(baseNorm, capaKey) {
    setSetMapping((prev) => ({ ...prev, [baseNorm]: capaKey }));
  }

  async function handleUpload() {
    if (!hasAnyFile) {
      setUploadNotice({
        tone: "warning",
        message: "No seleccionaste archivos.",
      });
      return;
    }

    if (invalidTriads) {
      setUploadNotice({
        tone: "warning",
        message: "Hay sets incompletos (.shp/.dbf/.shx). Completá o subí un ZIP/KMZ.",
      });
      return;
    }

    const fd = new FormData();
    archivos.forEach((f) => fd.append("files", f));

    // ✅ mapping general (sirve para triads y singles cuando el nombre coincide)
    if (Object.keys(mappingPayload).length > 0) {
      fd.append("mapping", JSON.stringify(mappingPayload));
    }

    if (tipoExtra?.trim()) fd.append("tipoExtra", tipoExtra.trim());

    // ✅ FIX MULTIUPLOAD: enviar defaultTabla repetido por cada SINGLE
    const singles = sets.filter((s) => s.kind === "single");
    for (const s of singles) {
      const capaKey = setMapping[s.baseNorm] || s.detected || "POLIGONOS_EXTRA";
      const tabla = keyToTablaFQ(capaKey);
      if (tabla) fd.append("defaultTabla", tabla);
    }

    // ✅ NUEVO: buff_dist por set/archivo (solo si destino = Área de Influencia)
    const bufferByBaseNorm = {};
    for (const s of sets) {
      const capaKey = setMapping[s.baseNorm] || s.detected || "POLIGONOS_EXTRA";
      if (capaKey !== "AREA_INFLUENSIA") continue;

      const v = Number(bufferMap[s.baseNorm]);
      if (BUFFER_OPTS.includes(v)) bufferByBaseNorm[s.baseNorm] = v;
    }
    if (Object.keys(bufferByBaseNorm).length > 0) {
      fd.append("bufferByBaseNorm", JSON.stringify(bufferByBaseNorm));
    }

    try {
      setUploadNotice(null);
      alerts.loading("Subiendo archivos...");
      const res = await fetch(`${API_URL}/mantenimiento/upload/${id}`, {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });

      if (res.status === 401) {
        alerts.close();
        redirect401();
        return;
      }

      const json = await res.json().catch(() => ({}));

      alerts.close();
      if (!res.ok) {
        const err = new Error(json.message || json.error || "Error al subir.");
        err.payload = json;
        throw err;
      }

      setUploadNotice({
        tone: "success",
        message: json.message || "Subido correctamente.",
        ok: Boolean(json.ok ?? json.success ?? true),
        inserted: Number(json.inserted || json.total_inserted || json.count || 0) || 0,
        byTable: json.byTable || {},
        details: Array.isArray(json.tablesTouched) ? json.tablesTouched : [],
      });
      setArchivos([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchStatusCapas();
    } catch (err) {
      alerts.close();
      setUploadNotice({
        tone: "warning",
        ok: Boolean(err?.payload?.ok ?? err?.payload?.success ?? false),
        message: err.message || "Error inesperado al subir archivos",
        inserted: Number(err?.payload?.inserted || err?.payload?.total_inserted || err?.payload?.count || 0) || 0,
        byTable: err?.payload?.byTable || {},
        details: Array.isArray(err?.payload?.debug)
          ? err.payload.debug
              .map((item) => item?.baseUnique || item?.base || item?.logicalBase || "")
              .filter(Boolean)
          : [],
      });
    }
  }

  async function handleDelete(capa) {
    const ok = await alerts.confirmDelete(`Se eliminará la capa "${capa.label}".`);
    if (!ok) return;

    try {
      alerts.loading("Eliminando capa...");
      const res = await fetch(
        `${API_URL}/mantenimiento/eliminar-poligono/${capa.tabla}/${id}`,
        {
          method: "DELETE",
          headers: { ...authHeaders() },
        }
      );
      if (res.status === 401) {
        alerts.close();
        redirect401();
        return;
      }
      const data = await res.json().catch(() => ({}));
      alerts.close();

      if (!res.ok) throw new Error(data.message || data.error || "Error al eliminar");
      alerts.toast.success(data.message || "Eliminado correctamente");
      fetchStatusCapas();
    } catch (err) {
      alerts.close();
      alerts.toast.error(err.message || "Error al eliminar");
    }
  }

  // -------- Descargas --------
  function buildLayersQuery() {
    if (!selectedLayers || selectedLayers.length === 0) return "";
    return `?layers=${selectedLayers.join(",")}`;
  }

  async function handleExportShapes() {
    setExportando(true);
    try {
      alerts.loading("Generando ZIP de shapes...");
      await downloadWithName(`${API_URL}/mantenimiento/export/${id}`, `ShapeProyecto_${id}.zip`);
      alerts.close();
      alerts.toast.success("ZIP de shapes generado.");
    } catch (err) {
      alerts.close();
      alerts.toast.error(err.message || "Error al exportar");
    } finally {
      setExportando(false);
    }
  }

  async function handleExportKML() {
    setExportando(true);
    try {
      alerts.loading("Generando KML...");
      const q = buildLayersQuery();
      await downloadWithName(`${API_URL}/mantenimiento/export-kml/${id}${q}`, `proyecto_${id}.kml`);
      alerts.close();
      alerts.toast.success("KML generado.");
    } catch (err) {
      alerts.close();
      alerts.toast.error(err.message || "Error al exportar KML");
    } finally {
      setExportando(false);
    }
  }

  async function handleExportKMZ() {
    setExportando(true);
    try {
      alerts.loading("Generando KMZ...");
      const q = buildLayersQuery();
      await downloadWithName(`${API_URL}/mantenimiento/export-kmz/${id}${q}`, `proyecto_${id}.kmz`);
      alerts.close();
      alerts.toast.success("KMZ generado.");
    } catch (err) {
      alerts.close();
      alerts.toast.error(err.message || "Error al exportar KMZ");
    } finally {
      setExportando(false);
    }
  }

  // UI selección de capas (KML/KMZ)
  function toggleLayer(k) {
    setSelectedLayers((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    );
  }
  function selectAllLoaded() {
    const allLoaded = CAPAS.map((c) => c.key).filter((k) => statusCapas[k]);
    setSelectedLayers(allLoaded);
  }
  function clearSelection() {
    setSelectedLayers([]);
  }
  const selectedCount = selectedLayers.length;

  return (
    <div className="p-4">
      <h2>Mantenimiento Proyecto {id}</h2>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".shp,.dbf,.shx,.zip,.kml,.kmz,.rar,.geojson,.json,.gpkg,.gpx,.gml,.dxf"
        onChange={handleFileChange}
        className="form-control mb-2"
      />

      <div className="mb-3">
        <label className="form-label">Tipo para “Otros Polígonos (Genéricos)” (opcional)</label>
        <input
          className="form-control"
          placeholder="Ej: ESCUELAS / PUESTOS_SALUD / POZOS / INFRA / etc."
          value={tipoExtra}
          onChange={(e) => setTipoExtra(e.target.value)}
        />
        <small className="text-muted">
          Esto se guarda como <b>tipo</b> en <code>ema.poligonos_extra</code> cuando el destino es genérico.
        </small>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <button
          className="btn btn-success"
          onClick={handleUpload}
          disabled={!hasAnyFile || invalidTriads}
          title="Subir archivos seleccionados"
        >
          Subir Archivos
        </button>

        <div className="btn-group" role="group" aria-label="Descargas">
          <button className="btn btn-primary" onClick={handleExportShapes} disabled={exportando}>
            {exportando ? "Exportando…" : "Exportar Shapes (ZIP)"}
          </button>
          <button className="btn btn-outline-primary" onClick={handleExportKML} disabled={exportando}>
            KML
          </button>
          <button className="btn btn-outline-primary" onClick={handleExportKMZ} disabled={exportando}>
            KMZ
          </button>
        </div>

        <button
          type="button"
          className="btn btn-light ms-auto"
          onClick={() => setShowLayerPicker((v) => !v)}
          aria-expanded={showLayerPicker}
          aria-controls="layer-picker"
          title="Elegir qué capas incluir en KML/KMZ"
        >
          Capas a incluir… {selectedCount > 0 ? `(${selectedCount} seleccionadas)` : "(todas)"}
        </button>
      </div>

      {uploadNotice && (
        <div
          className="mb-3"
          style={{
            background: uploadNotice.tone === "success" ? "#eef8e8" : "#fff8db",
            border: `1px solid ${uploadNotice.tone === "success" ? "#b7d7a8" : "#f3d36a"}`,
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap">
            <div className="d-flex align-items-center gap-2">
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: uploadNotice.tone === "success" ? "#d9ead3" : "#fce5a3",
                  color: "#6b5200",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                !
              </span>
              <div className="fw-semibold" style={{ color: "#6b5200" }}>
                {uploadNotice.tone === "success" ? "Carga procesada" : "Atención de carga"}
              </div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              <span className={`badge ${uploadNotice.ok ? "bg-success" : "bg-warning text-dark"}`}>
                {uploadNotice.ok ? "OK" : "Aviso"}
              </span>
              {Number.isFinite(Number(uploadNotice.inserted)) && Number(uploadNotice.inserted) > 0 && (
                <span className="badge bg-warning text-dark">Insertadas: {Number(uploadNotice.inserted)}</span>
              )}
              {Object.keys(uploadNotice.byTable || {}).map((table) => (
                <span key={table} className="badge rounded-pill bg-light text-dark">
                  {table.split(".").pop()}: {uploadNotice.byTable[table]}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-1" style={{ color: "#5c4a00" }}>
            {uploadNotice.message}
          </div>
          {Array.isArray(uploadNotice.details) && uploadNotice.details.length > 0 && (
            <details className="mt-2">
              <summary style={{ cursor: "pointer", color: "#6b5200" }}>Ver detalle técnico</summary>
              <div className="d-flex gap-2 flex-wrap mt-2">
                {uploadNotice.details.slice(0, 8).map((detail) => (
                  <span key={detail} className="badge rounded-pill bg-warning text-dark">
                    {detail}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {archivos.length > 0 && (
        <div className="mb-3">
          <h6 className="mb-2">Archivos / Sets detectados</h6>

          {invalidTriads && (
            <div className="alert alert-warning">
              Tenés sets SHP incompletos. Completá <b>.shp + .dbf + .shx</b> o subí un ZIP/KMZ.
            </div>
          )}

          <div className="list-group">
            {sets.map((s) => {
              const detectedLabel = s.detected ? capaLabelFromKey(s.detected) : "No reconocido";
              const selectedKey = setMapping[s.baseNorm] || s.detected || "POLIGONOS_EXTRA";

              if (s.kind === "single") {
                return (
                  <div key={s.id} className="list-group-item">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <strong>{s.file.name}</strong>{" "}
                        <span className="badge bg-secondary ms-1">{s.ext}</span>{" "}
                        {s.detected ? (
                          <span className="badge bg-info ms-1">{detectedLabel}</span>
                        ) : (
                          <span className="badge bg-dark ms-1">No reconocido</span>
                        )}
                        {s.hint && (
                          <span className="badge bg-warning text-dark ms-2" title={s.hint}>
                            Detectado por keyword
                          </span>
                        )}
                      </div>

                      <div className="d-flex align-items-center gap-2">
                        <span className="text-muted" style={{ fontSize: 13 }}>
                          Destino:
                        </span>
                        <select
                          className="form-select form-select-sm"
                          style={{ width: 260 }}
                          value={selectedKey}
                          onChange={(e) => setCapaForSet(s.baseNorm, e.target.value)}
                          title="Forzar tabla de destino (ZIP/KML/KMZ/RAR/convertibles)"
                        >
                          <option value="POLIGONO_PROYECTO">Polígono del Proyecto</option>
                          <option value="PLANO_PROYECTO">Plano Proyecto</option>
                          <option value="AREA_INFLUENSIA">Área de Influencia</option>
                          <option value="USO_ACTUAL">Uso Actual</option>
                          <option value="USO_ALTERNATIVO">Uso Alternativo</option>
                          <option value="USO_1986">Uso 1986</option>
                          <option value="TRAMO">Tramos del Proyecto</option>
                          <option value="PROGRESIVA">Progresivas del Proyecto</option>
                          <option value="COMUNIDADES_INDI">Comunidades Indígenas</option>
                          <option value="POLIGONOS_EXTRA">Otros Polígonos (Genéricos)</option>
                        </select>

                        {/* ✅ Buffer por archivo cuando es Área de Influencia */}
                        {selectedKey === "AREA_INFLUENSIA" && (
                          <div className="d-flex align-items-center gap-2">
                            <span className="text-muted" style={{ fontSize: 13 }}>
                              Buffer:
                            </span>
                            <select
                              className="form-select form-select-sm"
                              style={{ width: 120 }}
                              value={bufferMap[s.baseNorm] || ""}
                              onChange={(e) => setBufferForSet(s.baseNorm, e.target.value)}
                              title="Guardar buff_dist (500/700/1000) para este archivo"
                            >
                              <option value="">(auto)</option>
                              {BUFFER_OPTS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <span className="badge bg-success">OK</span>
                      </div>
                    </div>

                    <small className="text-muted d-block mt-1">
                      ZIP/KML/KMZ/RAR o convertibles: si elegís destino acá, el front manda{" "}
                      <code>defaultTabla</code> (uno por archivo) para que el backend rutee bien cuando adentro viene{" "}
                      <code>DOC.*</code>. Si es Área de Influencia, podés setear <code>Buffer</code> (buff_dist).
                    </small>
                  </div>
                );
              }

              // Triad SHP
              return (
                <div key={s.baseNorm} className="list-group-item">
                  <div className="d-flex justify-content-between align-items-center gap-3">
                    <div style={{ minWidth: 220 }}>
                      <strong>{s.base}</strong>{" "}
                      {s.detected ? (
                        <span className="badge bg-info ms-1">{detectedLabel}</span>
                      ) : (
                        <span className="badge bg-secondary ms-1">No reconocido</span>
                      )}
                      {s.hint && (
                        <span className="badge bg-warning text-dark ms-2" title={s.hint}>
                          Detectado por keyword
                        </span>
                      )}
                    </div>

                    <div className="d-flex align-items-center gap-2">
                      {s.validTriad ? (
                        <span className="badge bg-success">OK (.shp/.dbf/.shx)</span>
                      ) : (
                        <span className="badge bg-danger">Faltan partes</span>
                      )}

                      <span className="text-muted" style={{ fontSize: 13 }}>
                        Destino:
                      </span>
                      <select
                        className="form-select form-select-sm"
                        style={{ width: 260 }}
                        value={selectedKey}
                        onChange={(e) => setCapaForSet(s.baseNorm, e.target.value)}
                        disabled={!s.validTriad}
                        title="Forzar tabla de destino"
                      >
                        <option value="POLIGONO_PROYECTO">Polígono del Proyecto</option>
                        <option value="PLANO_PROYECTO">Plano Proyecto</option>
                        <option value="AREA_INFLUENSIA">Área de Influencia</option>
                        <option value="USO_ACTUAL">Uso Actual</option>
                        <option value="USO_ALTERNATIVO">Uso Alternativo</option>
                        <option value="USO_1986">Uso 1986</option>
                        <option value="TRAMO">Tramos del Proyecto</option>
                        <option value="PROGRESIVA">Progresivas del Proyecto</option>
                        <option value="COMUNIDADES_INDI">Comunidades Indígenas</option>
                        <option value="POLIGONOS_EXTRA">Otros Polígonos (Genéricos)</option>
                      </select>

                      {/* ✅ Buffer por set cuando es Área de Influencia */}
                      {s.validTriad && selectedKey === "AREA_INFLUENSIA" && (
                        <div className="d-flex align-items-center gap-2 ms-2">
                          <span className="text-muted" style={{ fontSize: 13 }}>
                            Buffer:
                          </span>
                          <select
                            className="form-select form-select-sm"
                            style={{ width: 120 }}
                            value={bufferMap[s.baseNorm] || ""}
                            onChange={(e) => setBufferForSet(s.baseNorm, e.target.value)}
                            title="Guardar buff_dist (500/700/1000) para este set SHP"
                          >
                            <option value="">(auto)</option>
                            {BUFFER_OPTS.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {!s.validTriad && (
                    <small className="text-danger d-block mt-1">Faltan: {s.missing.join(", ")}</small>
                  )}

                  {s.validTriad && !s.detected && selectedKey === "POLIGONOS_EXTRA" && (
                    <small className="text-muted d-block mt-1">
                      Como no coincide con una capa oficial, se enviará a <code>ema.poligonos_extra</code>.
                    </small>
                  )}
                </div>
              );
            })}
          </div>

          {Object.keys(mappingPayload).length > 0 && (
            <small className="text-muted d-block mt-2">
              Mapping enviado al backend: <code>{JSON.stringify(mappingPayload)}</code>
            </small>
          )}
        </div>
      )}

      {showLayerPicker && (
        <div id="layer-picker" className="card mb-3">
          <div className="card-header">Capas a incluir en KML / KMZ</div>
          <div className="card-body">
            <p className="text-muted mb-2">
              Si no marcás ninguna, se exportarán <b>todas</b> las capas con datos.
            </p>
            <div className="mb-2 d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAllLoaded}>
                Seleccionar todas (con datos)
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearSelection}>
                Limpiar selección
              </button>
            </div>
            <div className="d-flex flex-wrap" style={{ gap: 12 }}>
              {CAPAS.map((c) => {
                const checked = selectedLayers.includes(c.key);
                const hasData = !!statusCapas[c.key];
                return (
                  <label
                    key={c.key}
                    className="form-check form-check-inline"
                    title={!hasData ? "Sin datos cargados" : ""}
                  >
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={checked}
                      onChange={() => toggleLayer(c.key)}
                      disabled={!hasData}
                    />
                    <span className="ms-1">
                      {c.label} {!hasData && <span className="badge bg-secondary ms-1">Sin datos</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <h4 className="mt-4">Estado de Capas</h4>
      <ul className="list-group">
        {CAPAS.map((c) => (
          <li key={c.key} className="list-group-item d-flex justify-content-between align-items-center">
            {c.label}
            <div>
              {statusCapas[c.key] ? (
                <span className="badge bg-success me-2">Cargado</span>
              ) : (
                <span className="badge bg-secondary me-2">Sin datos</span>
              )}
              <button
                className="btn btn-sm btn-outline-danger"
                onClick={() => handleDelete(c)}
                disabled={!statusCapas[c.key]}
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
