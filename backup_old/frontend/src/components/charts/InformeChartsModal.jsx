// src/components/InformeChartsModal.jsx ✅ COMPLETO (dashboard + legacy) + SECCIONES
// ✅ FIX REAL para backend /informes-dashboard:
// - Dashboard consume payload.charts (NO rows)
// - ALL funciona y “namespacia” id_pregunta => "PLID:PID"
// - Excluye Coordenadas/Fotos por tipo_pregunta (y fallback por etiqueta)
// - Legacy queda intacto
// - PDF real captura charts via refs por key string
//
// ✅ NUEVO (TU PEDIDO):
// - Respeta ORDEN REAL de Secciones + Preguntas (modal + PDF)
// - PDF respeta filtros (selección + switches) y respeta Vista por pregunta (Torta/Barras/Texto)
// - En ALL: carga plantilla por id (cache) para poder ordenar por seccion_orden/orden reales

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Modal,
  Button,
  Container,
  Row,
  Col,
  Card,
  Spinner,
  Badge,
  Alert,
  Form,
  InputGroup,
} from "react-bootstrap";

import { Bar, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

import "@/styles/MapChartsModal.theme.css";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels
);

/* =========================
   Paleta (fallback)
   ========================= */
const PASTEL_COLORS = [
  "#A7D7C5",
  "#A9C5EB",
  "#F4D6A0",
  "#D9B7E8",
  "#F2B5B5",
  "#A7E3E1",
  "#B9B7F4",
  "#F7C7A6",
  "#D6C2B8",
  "#BFE6B8",
  "#BFE0F7",
  "#E6C7F2",
  "#E9E8A8",
  "#F4B7D1",
  "#C7D1D8",
];

const ALPHA_FILL = 0.72;
const ALPHA_BORDER = 0.95;

const hexToRgba = (hex, a = 1) => {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
};

const pickColors = (n) =>
  Array.from({ length: n }, (_, i) => PASTEL_COLORS[i % PASTEL_COLORS.length]);

const norm = (v) => String(v ?? "").trim();

const isMissing = (v) => {
  const s = norm(v).toLowerCase();
  return !s || s === "-" || s === "null" || s === "undefined";
};

/* =========================================================
   ✅ Normalizador plantilla (LEGACY)
   ========================================================= */
const normalizePlantilla = (p) => {
  if (!p) return null;

  const root = p?.data ?? p;

  if (root?.ok && (root?.plantilla || root?.data?.plantilla)) {
    const pl = root.plantilla ?? root.data.plantilla ?? {};
    const secciones =
      root.secciones ??
      root.seccionesConPreguntas ??
      root.data?.secciones ??
      root.data?.seccionesConPreguntas ??
      pl.secciones ??
      pl.seccionesConPreguntas ??
      [];

    const preguntas =
      root.preguntas ??
      root.data?.preguntas ??
      pl.preguntas ??
      pl.questions ??
      [];

    if (Array.isArray(secciones) && secciones.some((s) => s?.preguntas || s?.preguntas_json)) {
      return { ...pl, secciones: secciones };
    }

    if (Array.isArray(secciones) && Array.isArray(preguntas) && preguntas.length) {
      const bySec = new Map();
      for (const q of preguntas) {
        const sid = Number(q.id_seccion ?? q.seccion_id ?? q.section_id);
        if (!Number.isFinite(sid)) continue;
        if (!bySec.has(sid)) bySec.set(sid, []);
        bySec.get(sid).push(q);
      }
      const merged = secciones.map((s) => {
        const sid = Number(s.id_seccion ?? s.id ?? s.seccion_id);
        const qs = bySec.get(sid) || [];
        return { ...s, preguntas: qs };
      });
      return { ...pl, secciones: merged };
    }

    if (Array.isArray(secciones)) return { ...pl, secciones };
  }

  if (root?.plantilla) {
    const pl = root.plantilla;
    const secciones = root.secciones ?? root.seccionesConPreguntas ?? pl.secciones ?? pl.seccionesConPreguntas ?? [];
    const preguntas = root.preguntas ?? pl.preguntas ?? pl.questions ?? [];

    if (Array.isArray(secciones) && secciones.some((s) => s?.preguntas || s?.preguntas_json)) {
      return { ...pl, secciones };
    }

    if (Array.isArray(secciones) && Array.isArray(preguntas) && preguntas.length) {
      const bySec = new Map();
      for (const q of preguntas) {
        const sid = Number(q.id_seccion ?? q.seccion_id ?? q.section_id);
        if (!Number.isFinite(sid)) continue;
        if (!bySec.has(sid)) bySec.set(sid, []);
        bySec.get(sid).push(q);
      }
      const merged = secciones.map((s) => {
        const sid = Number(s.id_seccion ?? s.id ?? s.seccion_id);
        const qs = bySec.get(sid) || [];
        return { ...s, preguntas: qs };
      });
      return { ...pl, secciones: merged };
    }

    if (Array.isArray(secciones)) return { ...pl, secciones };
  }

  if (Array.isArray(root?.secciones)) {
    const preguntas = root.preguntas ?? root.questions ?? [];
    if (Array.isArray(preguntas) && preguntas.length && !root.secciones.some((s) => s?.preguntas || s?.preguntas_json)) {
      const bySec = new Map();
      for (const q of preguntas) {
        const sid = Number(q.id_seccion ?? q.seccion_id ?? q.section_id);
        if (!Number.isFinite(sid)) continue;
        if (!bySec.has(sid)) bySec.set(sid, []);
        bySec.get(sid).push(q);
      }
      const merged = root.secciones.map((s) => {
        const sid = Number(s.id_seccion ?? s.id ?? s.seccion_id);
        return { ...s, preguntas: bySec.get(sid) || [] };
      });
      return { ...root, secciones: merged };
    }
    return root;
  }

  if (Array.isArray(root?.seccionesConPreguntas)) {
    return { ...(root.plantilla || root), secciones: root.seccionesConPreguntas };
  }

  if (root?.data) return normalizePlantilla(root.data);

  return null;
};

/* =========================================================
   ✅ API helpers
   ========================================================= */
const BASE_RAW = import.meta.env.VITE_API_URL || "http://localhost:4000";
const BASE = BASE_RAW.replace(/\/+$/g, "");
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { ...authHeaders() } });
  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : null;

  if (resp.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.replace("/login");
    throw new Error("Sesión expirada.");
  }

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

/* =========================================================
   ✅ Legacy helpers (rows)
   ========================================================= */
function pickRows(payload) {
  if (!payload) return [];
  const root = payload.data ?? payload;

  const r =
    root.rows ??
    root.respuestas ??
    root.data?.rows ??
    root.data?.respuestas ??
    root.informe?.rows ??
    root.informe?.data?.rows ??
    root.informe?.data?.respuestas ??
    root?.informe?.respuestas ??
    root?.respuestas ??
    [];

  return Array.isArray(r) ? r : [];
}

/* =========================================================
   ✅ Dashboard helpers (charts)
   ========================================================= */
function pickPlantillasRows(payload) {
  const root = payload?.data ?? payload ?? {};
  const r =
    root.plantillas ??
    root.rows ??
    root.data?.plantillas ??
    root.data?.rows ??
    [];
  return Array.isArray(r) ? r : [];
}

function pickDashboardCharts(payload) {
  const root = payload?.data ?? payload ?? {};
  const arr = root.charts ?? root.data?.charts ?? [];
  return Array.isArray(arr) ? arr : [];
}

async function fetchProjectPlantillas(idProyecto) {
  return fetchJson(`${API_URL}/informes-dashboard/plantillas?id_proyecto=${Number(idProyecto)}`);
}

async function fetchAgregadoCharts(idProyecto, idPlantilla, limit = 300) {
  const qp = new URLSearchParams();
  qp.set("id_proyecto", String(Number(idProyecto)));
  qp.set("id_plantilla", String(Number(idPlantilla)));
  qp.set("limit", String(Number(limit)));
  return fetchJson(`${API_URL}/informes-dashboard/charts?${qp.toString()}`);
}

async function fetchPlantillaById(idPlantilla) {
  return fetchJson(`${API_URL}/informes/plantillas/${idPlantilla}`);
}

/* =========================================================
   ✅ Dashboard normalización a formato de render
   ========================================================= */
const makeQKey = (plantillaId, preguntaId) => `${String(plantillaId)}:${String(preguntaId)}`;

function isExcludedDashboardChart(ch) {
  const tipo = norm(ch?.tipo_pregunta).toLowerCase();
  const et = norm(ch?.etiqueta).toLowerCase();

  if (tipo.includes("coord")) return true;
  if (tipo.includes("coorden")) return true;
  if (tipo.includes("ubic")) return true;

  if (tipo.includes("imagen")) return true;
  if (tipo.includes("foto")) return true;
  if (tipo.includes("file")) return true;
  if (tipo.includes("archivo")) return true;
  if (tipo.includes("upload")) return true;

  // fallback por etiqueta
  if (et.includes("coorden")) return true;
  if (et.includes("ubicac")) return true;
  if (et.includes("foto")) return true;
  if (et.includes("imagen")) return true;

  return false;
}

function chartToData(ch) {
  let labels = Array.isArray(ch?.labels) ? ch.labels : [];
  const ds0 =
    (Array.isArray(ch?.datasets) ? ch.datasets : [])[0] || { label: "Cantidad", data: [] };
  let values = Array.isArray(ds0.data) ? ds0.data : [];

  // ✅ filtra labels vacíos / '-' / null / undefined y valores <= 0
  const filtered = [];
  for (let i = 0; i < labels.length; i++) {
    const l = String(labels[i] ?? "").trim();
    const lo = l.toLowerCase();
    if (!l || l === "-" || lo === "null" || lo === "undefined") continue;

    const v = Number(values[i] ?? 0);
    if (!Number.isFinite(v) || v <= 0) continue;

    filtered.push([l, v]);
  }

  labels = filtered.map((x) => x[0]);
  values = filtered.map((x) => x[1]);

  const colors = pickColors(labels.length);

  const barData = {
    labels,
    datasets: [
      {
        label: ds0.label || "Cantidad",
        data: values,
        backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
        borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
        borderWidth: 1,
      },
    ],
  };

  const pieData = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
        borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
        borderWidth: 1,
      },
    ],
  };

  const total = values.reduce((a, b) => a + (Number(b) || 0), 0);

  // ✅ para vista Texto (si alguna pregunta texto viene como buckets)
  const textItems = labels
    .map((t, i) => ({ text: String(t ?? "").trim(), count: Number(values[i] || 0) }))
    .filter((x) => x.text && x.text !== "-" && x.text.toLowerCase() !== "null" && x.count > 0);

  return { barData, pieData, total, textItems };
}

/* =========================================================
   ✅ Helpers: Concurrency
   ========================================================= */
async function mapLimit(items, limit, fn) {
  const arr = Array.isArray(items) ? items : [];
  const out = new Array(arr.length);
  let i = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, arr.length)) }, async () => {
    while (i < arr.length) {
      const idx = i++;
      out[idx] = await fn(arr[idx], idx);
    }
  });

  await Promise.all(workers);
  return out;
}

/* =========================================================
   ✅ Permisos + Utils
   ========================================================= */
function getTipoUsuario() {
  const direct = localStorage.getItem("tipo_usuario");
  if (direct && Number.isFinite(Number(direct))) return Number(direct);

  const u =
    localStorage.getItem("user") ||
    localStorage.getItem("usuario") ||
    localStorage.getItem("auth_user");
  if (!u) return null;

  try {
    const obj = JSON.parse(u);
    const t = obj?.tipo_usuario ?? obj?.tipo ?? obj?.group ?? obj?.id_group;
    return Number.isFinite(Number(t)) ? Number(t) : null;
  } catch {
    return null;
  }
}

function canExportExcelWord(tipo) {
  return tipo === 1 || tipo === 8;
}

const waitRaf = () => new Promise((r) => requestAnimationFrame(() => r()));
const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

function safeFilename(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

function fmtNow() {
  return new Date().toLocaleString();
}

/* =========================================================
   ✅ LEGACY: agregación (sin cambios) — usa rows
   ========================================================= */
function coalesceValor(r) {
  if (r == null) return null;

  if (r.valor_json != null) {
    const j = r.valor_json;

    if (Array.isArray(j)) return j;

    if (typeof j === "object") {
      const label =
        j.label ??
        j.titulo ??
        j.title ??
        j.text ??
        j.valor ??
        j.value ??
        j.name ??
        "";
      const color = j.color ?? j.hex ?? j.colour ?? "";
      if (label && color) return `${label}||${color}`;
      if (label) return String(label);

      const lat = j.lat ?? j.latitude ?? j.y;
      const lng = j.lng ?? j.lon ?? j.longitud ?? j.longitude ?? j.x;
      if (lat != null && lng != null) return `${lat},${lng}`;

      return j;
    }

    return j;
  }

  const s1 = norm(r.valor);
  if (!isMissing(s1)) return r.valor;

  const s2 = norm(r.valor_texto);
  if (!isMissing(s2)) return r.valor_texto;

  if (typeof r.valor_bool === "boolean") return r.valor_bool ? "Sí" : "No";
  if (r.valor_numero != null && String(r.valor_numero).trim() !== "") return Number(r.valor_numero);
  if (r.valor_fecha != null && String(r.valor_fecha).trim() !== "") return String(r.valor_fecha);

  return null;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    try {
      const keys = v && typeof v === "object" ? Object.keys(v).slice(0, 12) : [];
      return keys.length ? `[obj:${keys.join(",")}]` : "[obj]";
    } catch {
      return "[obj]";
    }
  }
}

const classifyValor = (raw) => {
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => norm(x)).filter((x) => !isMissing(x));
    return { kind: "multi", value: parts };
  }
  if (raw && typeof raw === "object") {
    const label =
      raw.label ?? raw.titulo ?? raw.title ?? raw.text ?? raw.valor ?? raw.value ?? raw.name ?? "";
    const color = raw.color ?? raw.hex ?? raw.colour ?? "";
    if (label && color) return { kind: "semaforo", value: { label: String(label), color: String(color) } };
    return { kind: "categorical", value: safeStringify(raw) };
  }

  const v = norm(raw);
  if (isMissing(v)) return { kind: "missing", value: null };

  const lo = v.toLowerCase();
  if (lo === "si" || lo === "sí") return { kind: "boolean", value: "Sí" };
  if (lo === "no") return { kind: "boolean", value: "No" };

  if (v.includes("||")) {
    const [label, color] = v.split("||").map((x) => x.trim());
    if (label && color) return { kind: "semaforo", value: { label, color } };
  }

  const n = Number(v.replace(",", "."));
  if (Number.isFinite(n)) return { kind: "numeric", value: n };

  if (typeof raw === "string" && v.includes(",")) {
    const parts = v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return { kind: "multi", value: parts.length ? parts : [] };
  }

  return { kind: "categorical", value: v };
};

function asArrayMaybeJson(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pickPreguntaId(p) {
  const id =
    p?.id_pregunta ??
    p?.idPregunta ??
    p?.id_preg ??
    p?.id ??
    p?.pregunta_id ??
    p?.question_id;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function buildMetaFromPlantilla(plantillaRaw) {
  const plantilla = normalizePlantilla(plantillaRaw);

  const byId = new Map();
  const secOrder = new Map();

  if (!plantilla?.secciones?.length) return { byId, secOrder };

  for (const sec of plantilla.secciones) {
    const secTitulo = norm(sec.titulo || sec.nombre || "Sin sección");
    const secOrden = Number(sec.orden ?? sec.order ?? 0);
    if (!secOrder.has(secTitulo)) secOrder.set(secTitulo, secOrden);

    const preguntas =
      asArrayMaybeJson(sec.preguntas).length ? asArrayMaybeJson(sec.preguntas) :
      asArrayMaybeJson(sec.preguntas_json).length ? asArrayMaybeJson(sec.preguntas_json) :
      asArrayMaybeJson(sec.items).length ? asArrayMaybeJson(sec.items) :
      asArrayMaybeJson(sec.questions);

    for (const p of preguntas) {
      const id = pickPreguntaId(p);
      if (!id) continue;

      byId.set(id, {
        id_pregunta: id,
        etiqueta: norm(p.etiqueta ?? p.label ?? p.titulo ?? p.title ?? `Pregunta ${id}`),
        seccion: secTitulo,
        seccion_orden: secOrden,
        orden: Number(p.orden ?? p.order ?? 0),
        tipo: norm(p.tipo ?? p.type ?? ""),
        opciones_json: p.opciones_json ?? p.opciones ?? p.options ?? null,
      });
    }
  }

  return { byId, secOrder };
}

const isTextLike = (tipo) => {
  const t = norm(tipo).toLowerCase();
  return t.includes("texto") || t.includes("text") || t.includes("textarea") || t.includes("observ");
};

// legacy exclude
const rawLooksCoord = (raw) => {
  if (!raw) return false;
  if (raw && typeof raw === "object") {
    const lat = raw.lat ?? raw.latitude ?? raw.y;
    const lng = raw.lng ?? raw.lon ?? raw.longitud ?? raw.longitude ?? raw.x;
    return lat != null && lng != null;
  }
  const s = norm(raw);
  if (!s.includes(",")) return false;
  const [a, b] = s.split(",").map((x) => Number(String(x).trim().replace(",", ".")));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a) <= 90 && Math.abs(b) <= 180;
};

const rawLooksPhoto = (raw) => {
  const s = norm(raw).toLowerCase();
  if (!s) return false;
  return (
    s.startsWith("data:image/") ||
    s.includes("/uploads/") ||
    s.includes("documentos") ||
    s.endsWith(".jpg") || s.endsWith(".jpeg") || s.endsWith(".png") || s.endsWith(".webp") ||
    s.endsWith(".pdf")
  );
};

const isCoordLike = (meta) => {
  const etiqueta = norm(meta?.etiqueta).toLowerCase();
  const tipo = norm(meta?.tipo).toLowerCase();
  if (tipo.includes("coorden")) return true;
  const needles = ["coorden", "coord", "lat", "lng", "longitud", "latitude", "ubicacion", "ubicación", "mapa", "gps"];
  return needles.some((k) => etiqueta.includes(k));
};

const isPhotoLike = (meta) => {
  const etiqueta = norm(meta?.etiqueta).toLowerCase();
  const tipo = norm(meta?.tipo).toLowerCase();

  if (
    tipo.includes("foto") ||
    tipo.includes("imagen") ||
    tipo.includes("image") ||
    tipo.includes("file") ||
    tipo.includes("archivo") ||
    tipo.includes("upload")
  ) return true;

  const needles = ["foto", "imagen", "image", "archivo", "adjunto", "upload", "selfie", "firma", "pdf"];
  return needles.some((k) => etiqueta.includes(k));
};

function aggregateRows(informesRows, metaById) {
  const out = new Map();

  const ensure = (id, metaFallback) => {
    if (!out.has(id)) {
      out.set(id, {
        id_pregunta: id,
        etiqueta: metaFallback.etiqueta || `Pregunta ${id}`,
        seccion: metaFallback.seccion || "Sin sección",
        seccion_orden: Number(metaFallback.seccion_orden ?? 0),
        orden: Number(metaFallback.orden ?? 0),
        tipo: metaFallback.tipo || "",
        counts: new Map(),
        sema: new Map(),
        nums: [],
        texts: [],
      });
    }
    return out.get(id);
  };

  for (const inf of informesRows) {
    const rows = Array.isArray(inf?.rows) ? inf.rows : [];

    for (const r of rows) {
      const id = Number(r.id_pregunta);
      if (!Number.isFinite(id)) continue;

      const meta = metaById.get(id) || {
        id_pregunta: id,
        etiqueta: `Pregunta ${id}`,
        seccion: "Sin sección",
        seccion_orden: 0,
        orden: 0,
        tipo: "",
      };

      const raw = coalesceValor(r);

      if (isCoordLike(meta) || rawLooksCoord(raw)) continue;
      if (isPhotoLike(meta) || rawLooksPhoto(raw)) continue;

      const a = ensure(id, meta);

      const c = classifyValor(raw);
      if (c.kind === "missing") continue;

      if (isTextLike(a.tipo)) {
        const s = norm(
          Array.isArray(raw)
            ? raw.join(", ")
            : raw && typeof raw === "object"
            ? safeStringify(raw)
            : raw
        );
        if (!isMissing(s)) a.texts.push(s);
        continue;
      }

      if (c.kind === "numeric") {
        a.nums.push(c.value);
      } else if (c.kind === "multi") {
        for (const it of c.value) {
          const k = norm(it);
          if (!isMissing(k)) a.counts.set(k, (a.counts.get(k) || 0) + 1);
        }
      } else {
        const k = norm(c.value);
        if (!isMissing(k)) a.counts.set(k, (a.counts.get(k) || 0) + 1);
      }
    }
  }

  return Array.from(out.values());
}

function sortAgg(a, b) {
  const sa = Number(a.seccion_orden ?? 0);
  const sb = Number(b.seccion_orden ?? 0);
  if (sa !== sb) return sa - sb;

  const pa = Number(a.orden ?? 0);
  const pb = Number(b.orden ?? 0);
  if (pa !== pb) return pa - pb;

  return norm(a.etiqueta).localeCompare(norm(b.etiqueta), "es");
}

/* =========================================================
   ✅ COMPONENTE
   ========================================================= */
export default function InformeChartsModal({
  show,
  onHide,
  titulo = "Centro_de_control_de_graficos",

  // LEGACY
  informeIds = [],
  fetchInformeDetalle,
  plantilla,
  plantillaId,

  // ✅ NUEVO: si lo pasás, usa /informes-dashboard
  idProyecto = null,

  maxAgregados = 300,
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [exporting, setExporting] = useState(false);

  // LEGACY agg
  const [agg, setAgg] = useState([]);

  // ✅ DASHBOARD charts ya listos para render
  const [dashItems, setDashItems] = useState([]);

  const [seleccion, setSeleccion] = useState([]);

  const [filtroTexto, setFiltroTexto] = useState("");
  const [soloSeleccionadas, setSoloSeleccionadas] = useState(false);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [secOpen, setSecOpen] = useState({});

  const [showTipoTexto, setShowTipoTexto] = useState(true);
  const [showTipoNum, setShowTipoNum] = useState(true);
  const [showTipoOpc, setShowTipoOpc] = useState(true);

  // ✅ Preferencia por pregunta (key: id_pregunta puede ser string en ALL)
  const [chartPrefByQ, setChartPrefByQ] = useState({});
  const getChartPref = (id_pregunta) => chartPrefByQ[String(id_pregunta)] || "pie";
  const setChartPref = (id_pregunta, pref) => {
    const k = String(id_pregunta);
    setChartPrefByQ((prev) => ({ ...prev, [k]: pref }));
  };

  // ✅ refs de charts para export real (key string)
  const chartRef = useRef({});
  const setChartInstanceRef = (id) => (instance) => {
    const k = String(id || "");
    if (!k) return;
    if (instance) chartRef.current[k] = instance;
    else delete chartRef.current[k];
  };

  const [renderAllForExport, setRenderAllForExport] = useState(false);
  const [exportPrefSnapshot, setExportPrefSnapshot] = useState({});

  const [plantillaLocal, setPlantillaLocal] = useState(null);
  const [plantillaIdLocal, setPlantillaIdLocal] = useState(null);

  const plantillaEff = plantilla ?? plantillaLocal;
  const plantillaIdEff = plantillaId ?? plantillaIdLocal;

  const plantillaNorm = useMemo(() => normalizePlantilla(plantillaEff), [plantillaEff]);

  // ✅ meta de la plantilla efectiva (sirve para “1 plantilla” dashboard y legacy)
  const metaPack = useMemo(() => buildMetaFromPlantilla(plantillaEff), [plantillaEff]);
  const metaById = metaPack.byId;

  // ✅ Dashboard: plantillas del proyecto
  const [plantillasProyecto, setPlantillasProyecto] = useState([]);
  const [plantillasLoading, setPlantillasLoading] = useState(false);

  // ✅ Selector: ALL o una plantilla
  const [selectedPlantillaId, setSelectedPlantillaId] = useState("ALL");

  const useDashboard = Number(idProyecto || 0) > 0;

  const plantillaCacheRef = useRef(new Map()); // id_plantilla -> plantillaRaw

  // =========================
  // Cargar plantillas del proyecto (dashboard)
  // =========================
  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!show) return;
      if (!useDashboard) return;

      setPlantillasLoading(true);
      setErr(null);

      try {
        const data = await fetchProjectPlantillas(Number(idProyecto));
        if (cancel) return;
        const rows = pickPlantillasRows(data);
        setPlantillasProyecto(rows);

        if (rows.length === 1) {
          setSelectedPlantillaId(String(rows[0].id_plantilla));
        } else if (selectedPlantillaId !== "ALL") {
          const exists = rows.some((r) => String(r.id_plantilla) === String(selectedPlantillaId));
          if (!exists) setSelectedPlantillaId("ALL");
        }
      } catch (e) {
        if (!cancel) setErr(e?.message || "No se pudieron cargar las plantillas del proyecto.");
      } finally {
        if (!cancel) setPlantillasLoading(false);
      }
    };

    run();
    return () => { cancel = true; };
  }, [show, useDashboard, idProyecto]); // eslint-disable-line

  // =========================
  // Cargar la plantilla seleccionada (dashboard “1 plantilla”)
  // =========================
  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!show) return;
      if (!useDashboard) return;
      if (selectedPlantillaId === "ALL") return;

      const pid = Number(selectedPlantillaId);
      if (!pid) return;

      if (Number(plantillaIdLocal) === pid && normalizePlantilla(plantillaLocal)?.secciones?.length) return;

      try {
        const pl = await fetchPlantillaById(pid);
        if (cancel) return;
        const plRaw = pl?.data ?? pl;
        setPlantillaLocal(plRaw);
        setPlantillaIdLocal(pid);
        plantillaCacheRef.current.set(pid, plRaw);
      } catch (e) {
        if (!cancel) setErr(e?.message || "No se pudo cargar la plantilla seleccionada.");
      }
    };

    run();
    return () => { cancel = true; };
  }, [show, useDashboard, selectedPlantillaId, plantillaIdLocal, plantillaLocal]); // eslint-disable-line

  // =========================
  // Cargar datos (dashboard o legacy)
  // =========================
  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!show) return;
      setErr(null);
      setLoading(true);

      try {
        // =========================
        // ✅ DASHBOARD (consume charts)
        // =========================
        if (useDashboard) {
          const pid = Number(idProyecto);
          if (!pid) {
            setDashItems([]);
            setSeleccion([]);
            setLoading(false);
            return;
          }

          // ====== UNA PLANTILLA ======
          if (selectedPlantillaId !== "ALL") {
            const plid = Number(selectedPlantillaId);
            if (!plid) {
              setDashItems([]);
              setSeleccion([]);
              setLoading(false);
              return;
            }

            const data = await fetchAgregadoCharts(pid, plid, maxAgregados);
            if (cancel) return;

            const charts = pickDashboardCharts(data)
              .filter((ch) => ch && !isExcludedDashboardChart(ch))
              .map((ch) => {
                const { barData, pieData, total, textItems } = chartToData(ch);
                const isText = norm(ch.tipo_pregunta || "").toLowerCase().includes("texto");

                // ✅ ORDEN REAL (si tenemos plantilla cargada, usamos metaById)
                const pidNum = Number(ch.id_pregunta);
                const meta = Number.isFinite(pidNum) ? metaById.get(pidNum) : null;

                return {
                  id_pregunta: String(ch.id_pregunta),
                  etiqueta: norm(ch.etiqueta || meta?.etiqueta || `Pregunta ${ch.id_pregunta}`),
                  seccion: norm(ch.seccion || meta?.seccion || "Sin sección"),

                  // ✅ orden real de sección + pregunta
                  seccion_orden: Number(meta?.seccion_orden ?? ch.orden_seccion ?? ch.id_seccion ?? 0) || 0,
                  orden: Number(meta?.orden ?? ch.orden ?? ch.orden_pregunta ?? 0) || 0,

                  tipo: norm(ch.tipo_pregunta || meta?.tipo || ""),
                  kind: isText ? "text" : "categorical",
                  barData,
                  pieData,
                  total,
                  textItems,
                };
              })
              .sort(sortAgg);

            setDashItems(charts);

            const ids = charts.map((c) => String(c.id_pregunta));
            setSeleccion(ids);

            const sec = {};
            for (const c of charts) {
              const s = norm(c.seccion || "Sin sección");
              if (!(s in sec)) sec[s] = true;
            }
            setSecOpen(sec);

            setChartPrefByQ((prev) => {
              const next = { ...prev };
              for (const c of charts) {
                const id = String(c.id_pregunta);
                if (!next[id]) next[id] = (c.kind === "text" ? "text" : "pie");
              }
              return next;
            });

            setLoading(false);
            return;
          }

          // ====== ALL (todas las plantillas) ======
          const pls = (plantillasProyecto || []).filter((x) => x && x.id_plantilla != null);
          if (!pls.length) {
            setDashItems([]);
            setSeleccion([]);
            setLoading(false);
            return;
          }

          const results = await mapLimit(pls, 3, async (plRow, idx) => {
            const plid = Number(plRow.id_plantilla);
            if (!plid) return { ok: false, items: [] };

            // ✅ traer plantilla por id (cache) para ordenar real
            let plRaw = plantillaCacheRef.current.get(plid);
            if (!plRaw) {
              try {
                const plResp = await fetchPlantillaById(plid);
                plRaw = plResp?.data ?? plResp;
                plantillaCacheRef.current.set(plid, plRaw);
              } catch {
                plRaw = null;
              }
            }

            const metaLocal = buildMetaFromPlantilla(plRaw);
            const metaByIdLocal = metaLocal.byId;

            const data = await fetchAgregadoCharts(pid, plid, maxAgregados);
            const charts = pickDashboardCharts(data);

            const plName = norm(plRow.nombre || `Plantilla #${plid}`);

            const items = charts
              .filter((ch) => ch && !isExcludedDashboardChart(ch))
              .map((ch) => {
                const { barData, pieData, total, textItems } = chartToData(ch);
                const isText = norm(ch.tipo_pregunta || "").toLowerCase().includes("texto");
                const key = makeQKey(plid, ch.id_pregunta);

                const pidNum = Number(ch.id_pregunta);
                const meta = Number.isFinite(pidNum) ? metaByIdLocal.get(pidNum) : null;

                return {
                  id_pregunta: key,
                  etiqueta: norm(ch.etiqueta || meta?.etiqueta || `Pregunta ${ch.id_pregunta}`),
                  seccion: `${plName} — ${norm(ch.seccion || meta?.seccion || "Sin sección")}`,

                  // ✅ orden real (sección y pregunta), con offset por plantilla
                  seccion_orden: idx * 100000 + (Number(meta?.seccion_orden ?? ch.orden_seccion ?? ch.id_seccion ?? 0) || 0),
                  orden: Number(meta?.orden ?? ch.orden ?? ch.orden_pregunta ?? 0) || 0,

                  tipo: norm(ch.tipo_pregunta || meta?.tipo || ""),
                  kind: isText ? "text" : "categorical",
                  barData,
                  pieData,
                  total,
                  textItems,
                  __plantilla_id: plid,
                  __plantilla_nombre: plName,
                };
              });

            return { ok: true, items };
          });

          if (cancel) return;

          const combined = results
            .filter((r) => r?.ok)
            .flatMap((r) => r.items || [])
            .sort(sortAgg);

          setDashItems(combined);

          const ids = combined.map((c) => String(c.id_pregunta));
          setSeleccion(ids);

          const sec = {};
          for (const c of combined) {
            const s = norm(c.seccion || "Sin sección");
            if (!(s in sec)) sec[s] = true;
          }
          setSecOpen(sec);

          setChartPrefByQ((prev) => {
            const next = { ...prev };
            for (const c of combined) {
              const id = String(c.id_pregunta);
              if (!next[id]) next[id] = (c.kind === "text" ? "text" : "pie");
            }
            return next;
          });

          setLoading(false);
          return;
        }

        // =========================
        // ✅ LEGACY (igual que antes)
        // =========================
        if (!plantillaNorm?.secciones?.length) {
          setAgg([]);
          setSeleccion([]);
          setLoading(false);
          return;
        }

        const ids = (informeIds || []).filter(Boolean);
        if (!ids.length) {
          setAgg([]);
          setSeleccion([]);
          setLoading(false);
          return;
        }
        if (typeof fetchInformeDetalle !== "function") {
          throw new Error("fetchInformeDetalle no fue provisto (modo legacy).");
        }

        const concurrency = 4;
        const results = [];
        let idx = 0;

        const worker = async () => {
          while (idx < ids.length) {
            const my = ids[idx++];
            const data = await fetchInformeDetalle(my);
            const rows = pickRows(data);
            results.push({ id_informe: my, rows });
          }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
        if (cancel) return;

        const aggregated = aggregateRows(results, metaById).sort(sortAgg);

        setAgg(aggregated);

        const idsPreg = aggregated
          .filter((p) => {
            const isTxt = isTextLike(p.tipo);
            if (isTxt) return (p.texts?.length || 0) > 0;
            const isNum = (p.nums?.length || 0) > 0;
            const hasCounts = (p.counts?.size || 0) > 0;
            return isNum || hasCounts;
          })
          .map((p) => String(p.id_pregunta));

        setSeleccion(idsPreg);

        const sec = {};
        for (const p of aggregated) {
          const s = norm(p.seccion || "Sin sección");
          if (!(s in sec)) sec[s] = true;
        }
        setSecOpen(sec);

        setChartPrefByQ((prev) => {
          const next = { ...prev };
          for (const id of idsPreg) if (!next[id]) next[id] = "pie";
          return next;
        });
      } catch (e) {
        if (!cancel) setErr(e?.message || "No se pudieron cargar los gráficos.");
      } finally {
        if (!cancel) setLoading(false);
      }
    };

    run();
    return () => { cancel = true; };
  }, [
    show,
    useDashboard,
    idProyecto,
    selectedPlantillaId,
    maxAgregados,
    informeIds,
    fetchInformeDetalle,
    metaById,
    plantillaNorm,
    plantillaEff,
    plantillasProyecto,
  ]);

  // =========================
  // Fuente de items para UI (dashboard vs legacy)
  // =========================
  const uiItems = useMemo(() => (useDashboard ? dashItems : []), [useDashboard, dashItems]);

  const tipoUsuario = useMemo(() => getTipoUsuario(), []);
  const allowExcelWord = useMemo(() => canExportExcelWord(tipoUsuario), [tipoUsuario]);

  const plantillaName = useMemo(() => {
    if (useDashboard) {
      if (selectedPlantillaId === "ALL") return "Todas las plantillas";
      const found = plantillasProyecto.find((p) => String(p.id_plantilla) === String(selectedPlantillaId));
      return norm(found?.nombre || `Plantilla #${selectedPlantillaId}`);
    }
    const n2 = plantillaNorm?.nombre ?? plantillaNorm?.titulo;
    return norm(n2 || "Plantilla");
  }, [useDashboard, selectedPlantillaId, plantillasProyecto, plantillaNorm]);

  const headerCount = useMemo(() => {
    if (useDashboard) {
      if (selectedPlantillaId === "ALL") {
        return (plantillasProyecto || []).reduce((acc, r) => acc + (Number(r?.total_informes ?? r?.informes_count ?? r?.n ?? 0) || 0), 0);
      }
      const found = plantillasProyecto.find((p) => String(p.id_plantilla) === String(selectedPlantillaId));
      return Number(found?.total_informes ?? found?.informes_count ?? found?.n ?? 0) || 0;
    }
    return (informeIds || []).filter(Boolean).length;
  }, [useDashboard, selectedPlantillaId, plantillasProyecto, informeIds]);

  const buildExportFileBase = () => {
    const groupName =
      useDashboard
        ? (selectedPlantillaId === "ALL" ? "ALL" : `PL${selectedPlantillaId}`)
        : "Todos";
    const base = `${titulo}__${groupName}__${headerCount}_informes`;
    return safeFilename(base) || "graficos";
  };

  const toggleSeleccion = (id) => {
    const k = String(id);
    setSeleccion((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  // ✅ usa chartsBySection (definido más abajo) para abrir/cerrar todas
  const setAllSectionsOpen = (open) => {
    const next = {};
    for (const s of chartsBySection.map((x) => x.sec)) next[s] = open;
    setSecOpen((prev) => ({ ...prev, ...next }));
  };

  const seleccionTodo = () => {
    if (useDashboard) setSeleccion(uiListaPreguntasBase.map((p) => String(p.id_pregunta)));
    else setSeleccion(listaPreguntasBase.map((p) => String(p.id_pregunta)));
  };
  const limpiarSeleccion = () => setSeleccion([]);

  // =========================
  // Opciones charts
  // =========================
  const barOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 150 },
      layout: { padding: { top: 8, right: 12, bottom: 20, left: 12 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "end",
          clamp: true,
          formatter: (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v) || "",
        },
      },
      scales: {
        y: { beginAtZero: true, grace: "14%" },
        x: { ticks: { maxRotation: 18, minRotation: 0 } },
      },
    }),
    []
  );

  const pieOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 150 },
      layout: { padding: { top: 10, right: 18, bottom: 18, left: 18 } },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 18, padding: 14, font: { size: 11 } },
        },
        datalabels: {
          clamp: true,
          formatter: (value, ctx) => {
            const dataArr = ctx?.chart?.data?.datasets?.[0]?.data || [];
            const total = dataArr.reduce((a, b) => a + (Number(b) || 0), 0);
            if (!total) return "";
            const pct = Math.round(((Number(value) || 0) / total) * 100);
            return pct ? `${pct}%` : "";
          },
        },
      },
    }),
    []
  );

  // =========================
  // ✅ Lista preguntas (dashboard)
  // =========================
  const uiListaPreguntasBase = useMemo(() => {
    if (!useDashboard) return [];
    return uiItems
      .slice()
      .sort(sortAgg)
      .map((c) => {
        const total = Number(c.total ?? 0) || 0;
        const badge =
          c.kind === "text"
            ? `txt: ${total}`
            : `opc: ${total}`;
        return {
          ...c,
          _isTxt: c.kind === "text",
          _isNum: false,
          _isSem: false,
          badge,
        };
      });
  }, [useDashboard, uiItems]);

  const uiListaPreguntas = useMemo(() => {
    if (!useDashboard) return [];
    const q = filtroTexto.trim().toLowerCase();
    let out = uiListaPreguntasBase;

    if (q) out = out.filter((p) => (p.etiqueta || "").toLowerCase().includes(q));

    out = out.filter((p) => {
      if (p._isTxt) return showTipoTexto;
      return showTipoOpc; // dashboard no separa num
    });

    if (soloSeleccionadas) out = out.filter((p) => seleccion.includes(String(p.id_pregunta)));
    return out;
  }, [
    useDashboard,
    uiListaPreguntasBase,
    filtroTexto,
    soloSeleccionadas,
    seleccion,
    showTipoTexto,
    showTipoOpc,
  ]);

  const uiListaPreguntasPorSeccion = useMemo(() => {
    if (!useDashboard) return [];
    const map = new Map();
    for (const p of uiListaPreguntas) {
      const sec = norm(p.seccion || "Sin sección");
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(p);
    }
    const out = Array.from(map.entries()).map(([sec, items]) => ({
      sec,
      items: items.slice().sort(sortAgg),
    }));

    // ✅ secciones en orden REAL (no alfabético)
    out.sort((a, b) => {
      const oa = Number(a.items?.[0]?.seccion_orden ?? 0);
      const ob = Number(b.items?.[0]?.seccion_orden ?? 0);
      if (oa !== ob) return oa - ob;
      return a.sec.localeCompare(b.sec, "es");
    });

    return out;
  }, [useDashboard, uiListaPreguntas]);

  // =========================
  // ✅ chartsBySection (dashboard o legacy)
  // =========================
  const chartsBySection = useMemo(() => {
    // DASHBOARD
    if (useDashboard) {
      const map = new Map();

      for (const c of uiItems.slice().sort(sortAgg)) {
        const idKey = String(c.id_pregunta);
        if (!seleccion.includes(idKey)) continue;

        if (c.kind === "text" && !showTipoTexto) continue;
        if (c.kind !== "text" && !showTipoOpc) continue;

        const sec = norm(c.seccion || "Sin sección");
        if (!map.has(sec)) map.set(sec, []);
        map.get(sec).push({
          id_pregunta: String(c.id_pregunta),
          etiqueta: c.etiqueta,
          subtitle: sec,
          type: "chart",
          kind: c.kind,
          barData: c.barData,
          pieData: c.pieData,
          textItems: c.textItems || [],

          // ✅ ORDEN para ordenar dentro de sección y ordenar secciones
          orden: Number(c.orden ?? 0),
          seccion_orden: Number(c.seccion_orden ?? 0),
        });
      }

      const sections = Array.from(map.entries()).map(([sec, items]) => ({
        sec,
        // ✅ ORDEN REAL dentro de sección (no por etiqueta)
        items: items.slice().sort((a, b) => {
          const oa = Number(a.orden ?? 0);
          const ob = Number(b.orden ?? 0);
          if (oa !== ob) return oa - ob;
          return norm(a.etiqueta).localeCompare(norm(b.etiqueta), "es");
        }),
      }));

      // ✅ ORDEN REAL de secciones
      sections.sort((a, b) => {
        const oa = Number(a.items?.[0]?.seccion_orden ?? 0);
        const ob = Number(b.items?.[0]?.seccion_orden ?? 0);
        if (oa !== ob) return oa - ob;
        return a.sec.localeCompare(b.sec, "es");
      });

      return sections;
    }

    // LEGACY (tu lógica previa por agg)
    const map = new Map();

    for (const p of agg.slice().sort(sortAgg)) {
      const idKey = String(p.id_pregunta);
      if (!seleccion.includes(idKey)) continue;

      const isTxt = isTextLike(p.tipo);
      const hasTxt = (p.texts?.length || 0) > 0;

      const hasNums = (p.nums?.length || 0) > 0;
      const hasCounts = (p.counts?.size || 0) > 0;

      if (isTxt && !showTipoTexto) continue;
      if (!isTxt && hasNums && !showTipoNum) continue;
      if (!isTxt && !hasNums && !showTipoOpc) continue;

      if (isTxt) {
        if (!hasTxt) continue;
      } else {
        if (!hasNums && !hasCounts) continue;
      }

      const sec = norm(p.seccion || "Sin sección");
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(p);
    }

    const sections = Array.from(map.entries()).map(([sec, itemsAgg]) => {
      const items = itemsAgg
        .slice()
        .sort(sortAgg)
        .map((p) => {
          const entries = Array.from(p.counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
          const labels = entries.map(([k]) => k);
          const values = entries.map(([, v]) => v);
          const colors = pickColors(labels.length);

          const barData = {
            labels,
            datasets: [
              {
                label: "Cantidad",
                data: values,
                backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
                borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
                borderWidth: 1,
              },
            ],
          };
          const pieData = {
            labels,
            datasets: [
              {
                data: values,
                backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
                borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
                borderWidth: 1,
              },
            ],
          };

          return {
            id_pregunta: String(p.id_pregunta),
            etiqueta: p.etiqueta,
            subtitle: sec,
            type: "chart",
            kind: isTextLike(p.tipo) ? "text" : "categorical",
            barData,
            pieData,
            // legacy text no tiene buckets; lo dejamos sin textItems
          };
        })
        .filter(Boolean);

      return { sec, items };
    });

    sections.sort((a, b) => a.sec.localeCompare(b.sec, "es"));
    return sections;
  }, [useDashboard, uiItems, agg, seleccion, showTipoTexto, showTipoNum, showTipoOpc]);

  // =========================
  // PDF REAL (respeta orden + filtros + vista por pregunta)
  // =========================
  const exportPDFReal = async () => {
    const prevSecOpen = { ...secOpen };

    try {
      setErr(null);
      setExporting(true);

      // snapshot de pref para que export no cambie si el usuario toca botones
      setExportPrefSnapshot({ ...chartPrefByQ });

      setAllSectionsOpen(true);
      setRenderAllForExport(true);

      await waitRaf();
      await waitRaf();
      await waitMs(550);

      const pdf = new jsPDF("p", "pt", "a4");

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 40;
      const contentW = pageW - margin * 2;

      const headerH = 74;
      const slotGap = 18;
      const slotH = Math.floor((pageH - margin * 2 - headerH - slotGap) / 2);

      const setFont = (bold) => pdf.setFont("helvetica", bold ? "bold" : "normal");

      const drawHeader = () => {
        let y = margin;

        setFont(true);
        pdf.setFontSize(15);
        pdf.text(plantillaName, pageW / 2, y + 18, { align: "center" });

        setFont(false);
        pdf.setFontSize(10);
        pdf.setTextColor(90, 90, 90);
        pdf.text(fmtNow(), pageW - margin, y + 36, { align: "right" });
        pdf.text(`Informes: ${headerCount}`, margin, y + 36, { align: "left" });

        pdf.setDrawColor(210, 210, 210);
        pdf.setLineWidth(0.6);
        pdf.line(margin, y + 52, pageW - margin, y + 52);

        pdf.setTextColor(0, 0, 0);
      };

      const newPage = (isFirst = false) => {
        if (!isFirst) pdf.addPage();
        drawHeader();
      };

      // ✅ drawCard ahora soporta pref === "text" y respeta pref por pregunta
      const drawCard = (item, pref, boxX, boxY, boxW, boxH) => {
        pdf.setDrawColor(210, 210, 210);
        pdf.setLineWidth(1);
        pdf.roundedRect(boxX, boxY, boxW, boxH, 10, 10);

        const pad = 16;
        let y = boxY + pad;

        setFont(true);
        pdf.setFontSize(11);
        pdf.setTextColor(0, 0, 0);

        const titleLines = pdf.splitTextToSize(String(item.etiqueta || ""), boxW - pad * 2);
        pdf.text(titleLines, boxX + pad, y);
        y += titleLines.length * 14;

        if (item.subtitle) {
          setFont(false);
          pdf.setFontSize(9);
          pdf.setTextColor(90, 90, 90);
          const subLines = pdf.splitTextToSize(String(item.subtitle), boxW - pad * 2);
          pdf.text(subLines, boxX + pad, y);
          y += subLines.length * 12 + 6;
          pdf.setTextColor(0, 0, 0);
        } else {
          y += 4;
        }

        const chartY = y + 2;
        const chartH = boxY + boxH - pad - chartY;

        // ✅ si es Texto => dibuja lista en PDF (no necesita chart)
        if (pref === "text" && Array.isArray(item.textItems) && item.textItems.length) {
          setFont(false);
          pdf.setFontSize(10);
          pdf.setTextColor(30, 30, 30);

          const maxItems = 14;
          const list = item.textItems
            .slice()
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, maxItems);

          let ty = chartY + 6;

          for (const it of list) {
            const line = `${Number(it.count || 0)} — ${String(it.text || "").trim()}`;
            const lines = pdf.splitTextToSize(line, boxW - pad * 2);
            pdf.text(lines, boxX + pad, ty);
            ty += lines.length * 12;
            if (ty > boxY + boxH - pad) break;
          }

          const rest = item.textItems.length - list.length;
          if (rest > 0 && ty < boxY + boxH - pad) {
            pdf.setTextColor(90, 90, 90);
            pdf.text(`(+${rest} más…)`, boxX + pad, ty + 10);
            pdf.setTextColor(0, 0, 0);
          }

          return;
        }

        // ✅ caso chart (pie/bar): captura canvas renderizado por el contenedor oculto
        const key = String(item.id_pregunta);
        const chartInstance = chartRef.current[key]?.chart || chartRef.current[key];

        let imgData = "";
        try {
          if (chartInstance?.toBase64Image) imgData = chartInstance.toBase64Image("image/png", 1);
        } catch {
          imgData = "";
        }

        if (imgData) {
          pdf.addImage(imgData, "PNG", boxX + pad, chartY, boxW - pad * 2, chartH);
        } else {
          setFont(false);
          pdf.setFontSize(10);
          pdf.setTextColor(150, 0, 0);
          pdf.text("(No se pudo capturar el gráfico)", boxX + pad, chartY + 14);
          pdf.setTextColor(0, 0, 0);
        }
      };

      const flat = [];
      for (const sec of chartsBySection) {
        for (const it of sec.items) flat.push({ ...it, __sec: sec.sec });
      }

      newPage(true);

      let slotIndex = 0;
      let lastSec = null;

      for (let i = 0; i < flat.length; i++) {
        const item = flat[i];

        if (lastSec && item.__sec !== lastSec && slotIndex === 1) {
          newPage(false);
          slotIndex = 0;
        }
        lastSec = item.__sec;

        const boxX = margin;
        const boxY = margin + headerH + (slotIndex === 0 ? 0 : slotH + slotGap);
        const boxW = contentW;
        const boxH = slotH;

        const key = String(item.id_pregunta);
        const pref = exportPrefSnapshot[key] || getChartPref(key); // ✅ respeta vista por pregunta

        drawCard(item, pref, boxX, boxY, boxW, boxH);

        slotIndex++;
        if (slotIndex >= 2 && i < flat.length - 1) {
          newPage(false);
          slotIndex = 0;
        }
      }

      pdf.save(`${buildExportFileBase()}.pdf`);
    } catch (e) {
      console.error("[exportPDFReal] ERROR:", e);
      setErr(e?.message || "No se pudo exportar el PDF real.");
    } finally {
      setRenderAllForExport(false);
      setSecOpen(prevSecOpen);
      setExporting(false);
    }
  };

  // =========================
  // Excel/Word (solo legacy)
  // =========================
  async function buildPerInformeTable(ids) {
    const metaList = Array.from(metaById.values()).slice().sort(sortAgg);

    const concurrency = 4;
    const results = [];
    let idx = 0;

    const worker = async () => {
      while (idx < ids.length) {
        const id = ids[idx++];
        const data = await fetchInformeDetalle(id);
        results.push({ id_informe: id, rows: pickRows(data) });
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));

    const columns = [{ key: "id_informe", label: "id_informe" }];
    for (const q of metaList) columns.push({ key: `q${q.id_pregunta}`, label: q.etiqueta });

    const dataRows = [];
    for (const inf of results) {
      const id = Number(inf.id_informe);
      const row = { id_informe: id };

      const ans = new Map();
      for (const r of Array.isArray(inf.rows) ? inf.rows : []) {
        const pid = Number(r.id_pregunta);
        if (!Number.isFinite(pid)) continue;
        ans.set(pid, coalesceValor(r));
      }

      for (const q of metaList) {
        const val = ans.get(Number(q.id_pregunta));
        const c = classifyValor(val);
        if (c.kind === "multi") row[`q${q.id_pregunta}`] = (c.value || []).join(" | ");
        else if (c.kind === "numeric") row[`q${q.id_pregunta}`] = c.value;
        else if (c.kind === "boolean") row[`q${q.id_pregunta}`] = c.value;
        else if (c.kind === "categorical") row[`q${q.id_pregunta}`] = c.value;
        else row[`q${q.id_pregunta}`] = "";
      }

      dataRows.push(row);
    }

    return { columns, dataRows };
  }

  const exportExcel = async () => {
    try {
      setErr(null);
      setExporting(true);

      if (!allowExcelWord) throw new Error("No tenés permisos para exportar Excel.");
      if (useDashboard) throw new Error("Excel por ahora exporta por-informe (modo legacy).");

      const ids = (informeIds || []).filter(Boolean);
      if (!ids.length) throw new Error("No hay informes para exportar.");

      const wb = XLSX.utils.book_new();

      const resumenAOA = [];
      resumenAOA.push([plantillaName, "", "", fmtNow()]);
      resumenAOA.push([`Informes: ${headerCount}`, "", "", ""]);
      resumenAOA.push(["", "", "", ""]);

      const shResumen = XLSX.utils.aoa_to_sheet(resumenAOA);
      XLSX.utils.book_append_sheet(wb, shResumen, "Resumen");

      const { columns, dataRows } = await buildPerInformeTable(ids);

      const header = columns.map((c) => c.label);
      const aoa = [header];
      for (const r of dataRows) aoa.push(columns.map((c) => r[c.key] ?? ""));

      const shDatos = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, shDatos, "Datos");

      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      saveAs(new Blob([out], { type: "application/octet-stream" }), `${buildExportFileBase()}.xlsx`);
    } catch (e) {
      console.error("[exportExcel] ERROR:", e);
      setErr(e?.message || "No se pudo exportar el Excel.");
    } finally {
      setExporting(false);
    }
  };

  const exportWord = async () => {
    try {
      setErr(null);
      setExporting(true);

      if (!allowExcelWord) throw new Error("No tenés permisos para exportar Word.");
      if (useDashboard) throw new Error("Word por ahora exporta resumen en legacy.");

      const children = [];

      children.push(
        new Paragraph({
          children: [new TextRun({ text: plantillaName, bold: true })],
          heading: HeadingLevel.HEADING_1,
        })
      );

      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Fecha: ${fmtNow()}   Informes: ${headerCount}` })],
        })
      );

      children.push(new Paragraph({ text: "" }));

      for (const sec of chartsBySection) {
        children.push(new Paragraph({ text: sec.sec, heading: HeadingLevel.HEADING_2 }));

        const rows = [];
        rows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: "Pregunta" })] }),
              new TableCell({ children: [new Paragraph({ text: "Tipo" })] }),
              new TableCell({ children: [new Paragraph({ text: "Resumen" })] }),
            ],
          })
        );

        for (const item of sec.items) {
          const labels = item.pieData?.labels || [];
          const dataArr = item.pieData?.datasets?.[0]?.data || [];
          const pairs = labels.map((lbl, i) => `${lbl}: ${dataArr?.[i] ?? 0}`);

          rows.push(
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: item.etiqueta })] }),
                new TableCell({ children: [new Paragraph({ text: item.kind === "text" ? "Texto" : "Opciones" })] }),
                new TableCell({ children: [new Paragraph({ text: pairs.join(" | ") })] }),
              ],
            })
          );
        }

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          })
        );

        children.push(new Paragraph({ text: "" }));
      }

      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${buildExportFileBase()}.docx`);
    } catch (e) {
      console.error("[exportWord] ERROR:", e);
      setErr(e?.message || "No se pudo exportar el Word.");
    } finally {
      setExporting(false);
    }
  };

  const headerLeftTitle = "Centro de control de graficos";

  // =========================
  // Legacy placeholders (para no romper tu seleccionTodo)
  // (si no los usás, podés borrarlos)
  // =========================
  const listaPreguntasBase = useMemo(() => [], []);

  return (
    <Modal show={show} onHide={onHide} fullscreen scrollable backdrop="static" keyboard>
      <Modal.Header className="geo-header">
        <Modal.Title className="mb-0 geo-title" style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 20, fontWeight: 900 }}>{headerLeftTitle}</span>
                <span style={{ fontSize: 18, fontWeight: 800, opacity: 0.9 }}>
                  • {plantillaName}
                </span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                {headerCount} informe(s) •{" "}
                {useDashboard
                  ? selectedPlantillaId === "ALL"
                    ? "Todas (dashboard)"
                    : "Plantilla (dashboard)"
                  : "Legacy"}
              </div>
            </div>

            <div className="d-flex gap-2">
              <Button
                size="sm"
                variant="dark"
                onClick={exportPDFReal}
                disabled={exporting || loading || plantillasLoading || !chartsBySection?.length}
                title="Exportar PDF"
              >
                {exporting ? "Generando..." : "PDF"}
              </Button>

              {allowExcelWord && (
                <>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={exportExcel}
                    disabled={exporting || loading || plantillasLoading || !chartsBySection?.length}
                  >
                    Excel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={exportWord}
                    disabled={exporting || loading || plantillasLoading || !chartsBySection?.length}
                  >
                    Word
                  </Button>
                </>
              )}

              <Button
                size="sm"
                onClick={() => setSelectorOpen((v) => !v)}
                style={{
                  borderRadius: 10,
                  fontWeight: 600,
                  paddingInline: 14,
                  background: selectorOpen ? "#2F3A3D" : "transparent",
                  color: selectorOpen ? "#fff" : "#2F3A3D",
                  border: "2px solid #2F3A3D",
                }}
              >
                {selectorOpen ? "Ocultar filtros" : "Filtros"}
              </Button>

              <Button size="sm" onClick={onHide} className="geo-btn-close">
                Cerrar
              </Button>
            </div>
          </div>
        </Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ background: "#F3F6EA" }}>
        {loading ? (
          <div className="d-flex align-items-center justify-content-center py-5">
            <Spinner animation="border" role="status" className="me-2" />
            Cargando datos…
          </div>
        ) : err ? (
          <Alert variant="danger" className="mb-3">
            {err}
          </Alert>
        ) : (
          <Container fluid className="p-0">
            {selectorOpen && (
              <Card className="geo-card mb-3">
                <Card.Body className="geo-card__body">
                  <Row className="g-2 align-items-end">
                    <Col xs={12} md={6}>
                      <Form.Label className="mb-1">
                        Plantilla {useDashboard ? "(dashboard)" : "(legacy)"}
                      </Form.Label>

                      {useDashboard ? (
                        <Form.Select
                          value={selectedPlantillaId}
                          onChange={(e) => setSelectedPlantillaId(e.target.value)}
                          disabled={plantillasLoading}
                        >
                          <option value="ALL">Todas (sin filtro de plantilla)</option>
                          {plantillasProyecto.map((pl) => (
                            <option key={pl.id_plantilla} value={String(pl.id_plantilla)}>
                              {pl.nombre || `Plantilla #${pl.id_plantilla}`} • {pl.total_informes || 0} informe(s)
                            </option>
                          ))}
                        </Form.Select>
                      ) : (
                        <Alert variant="secondary" className="mb-0">
                          Modo legacy: el filtrado por plantilla viene de <code>informeIds</code>.
                          (Si querés dashboard, pasá <code>idProyecto</code> al modal)
                        </Alert>
                      )}

                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                        {useDashboard
                          ? selectedPlantillaId === "ALL"
                            ? `Mostrando charts agregados de todas las plantillas (secciones prefijadas por plantilla).`
                            : `Charts agregados (según backend).`
                          : `Se agregan los informes del array actual.`}
                      </div>
                    </Col>

                    <Col xs={12} md={6}>
                      <Form.Label className="mb-1">Buscar por etiqueta</Form.Label>
                      <InputGroup>
                        <Form.Control
                          value={filtroTexto}
                          onChange={(e) => setFiltroTexto(e.target.value)}
                          placeholder="Buscar..."
                        />
                        <Button variant="outline-secondary" onClick={() => setFiltroTexto("")}>
                          Limpiar
                        </Button>
                      </InputGroup>

                      <div className="d-flex gap-2 mt-2">
                        <Form.Check
                          type="switch"
                          id="soloSeleccionadas"
                          label="Mostrar solo seleccionadas"
                          checked={soloSeleccionadas}
                          onChange={(e) => setSoloSeleccionadas(e.target.checked)}
                        />
                        <Button size="sm" variant="outline-primary" onClick={seleccionTodo}>
                          Seleccionar todo
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={limpiarSeleccion}>
                          Limpiar selección
                        </Button>
                      </div>
                    </Col>
                  </Row>

                  <hr />

                  <Row className="g-2">
                    <Col xs={12}>
                      <div className="d-flex flex-wrap gap-3">
                        <Form.Check
                          type="switch"
                          id="showTipoTexto"
                          label="Texto"
                          checked={showTipoTexto}
                          onChange={(e) => setShowTipoTexto(e.target.checked)}
                        />
                        {!useDashboard && (
                          <Form.Check
                            type="switch"
                            id="showTipoNum"
                            label="Numéricas"
                            checked={showTipoNum}
                            onChange={(e) => setShowTipoNum(e.target.checked)}
                          />
                        )}
                        <Form.Check
                          type="switch"
                          id="showTipoOpc"
                          label="Opciones / Semáforo"
                          checked={showTipoOpc}
                          onChange={(e) => setShowTipoOpc(e.target.checked)}
                        />
                      </div>
                    </Col>
                  </Row>

                  <hr />

                  <div style={{ maxHeight: 260, overflow: "auto" }}>
                    {useDashboard ? (
                      uiListaPreguntasPorSeccion.length ? (
                        uiListaPreguntasPorSeccion.map((g) => (
                          <div key={g.sec} style={{ marginBottom: 12 }}>
                            <div
                              style={{
                                fontWeight: 800,
                                color: "#2F3A3D",
                                marginBottom: 8,
                                paddingBottom: 8,
                                borderBottom: "1px solid rgba(0,0,0,.10)",
                              }}
                            >
                              {g.sec}{" "}
                              <span style={{ fontWeight: 600, opacity: 0.7, fontSize: 12 }}>
                                ({g.items.length})
                              </span>
                            </div>

                            {g.items.map((p) => {
                              const key = String(p.id_pregunta);
                              const checked = seleccion.includes(key);
                              return (
                                <div
                                  key={key}
                                  className="d-flex align-items-center justify-content-between py-2"
                                  style={{ borderBottom: "1px dashed rgba(0,0,0,.08)" }}
                                >
                                  <Form.Check
                                    type="checkbox"
                                    id={`chk-${key}`}
                                    checked={checked}
                                    onChange={() => toggleSeleccion(key)}
                                    label={
                                      <span style={{ color: "#2D3B2F" }}>
                                        {p.etiqueta}{" "}
                                        <span style={{ color: "#6B746A", fontSize: 12 }}>
                                          ({p.badge})
                                        </span>
                                      </span>
                                    }
                                  />
                                  <Badge bg={p._isTxt ? "secondary" : "success"}>{p.badge}</Badge>
                                </div>
                              );
                            })}
                          </div>
                        ))
                      ) : (
                        <div className="text-muted">No hay resultados con ese filtro.</div>
                      )
                    ) : (
                      <div className="text-muted">
                        (Legacy: la lista se arma desde la plantilla + respuestas)
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            )}

            <Row className="g-3 mb-3">
              {chartsBySection.length ? (
                chartsBySection.map((sec) => {
                  const open = secOpen[sec.sec] ?? true;
                  return (
                    <Col key={sec.sec} xs={12}>
                      <Card className="geo-card">
                        <Card.Body className="geo-card__body">
                          <div
                            role="button"
                            onClick={() => setSecOpen((p) => ({ ...p, [sec.sec]: !p[sec.sec] }))}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              cursor: "pointer",
                              userSelect: "none",
                              gap: 10,
                            }}
                          >
                            <div>
                              <h5 className="geo-card__title mb-0">{sec.sec}</h5>
                              <div style={{ color: "#6B746A", fontSize: 12, marginTop: 6 }}>
                                {open ? "Minimizar sección" : "Expandir sección"} • {sec.items.length} item(s)
                              </div>
                            </div>

                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                background: "rgba(255,255,255,.75)",
                                border: "1px solid rgba(0,0,0,.08)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform .15s ease",
                                fontSize: 18,
                              }}
                            >
                              ▾
                            </div>
                          </div>

                          {open && (
                            <div className="mt-3">
                              <Row className="g-4">
                                {sec.items.map((c) => {
                                  const pref = getChartPref(c.id_pregunta);
                                  const isText = c.kind === "text";

                                  return (
                                    <Col key={String(c.id_pregunta)} xs={12} md={6}>
                                      <Card className="geo-card" style={{ height: 600 }}>
                                        <Card.Body className="geo-card__body">
                                          <h6 className="geo-card__title" style={{ marginBottom: 10 }}>
                                            {c.etiqueta}
                                          </h6>

                                          {c.subtitle ? (
                                            <div style={{ color: "#6B746A", fontSize: 12, marginBottom: 10 }}>
                                              {c.subtitle}
                                            </div>
                                          ) : null}

                                          <div className="d-flex gap-2 align-items-center mb-3">
                                            <div style={{ fontSize: 12, color: "#6B746A", fontWeight: 800 }}>
                                              Vista:
                                            </div>

                                            <Button
                                              size="sm"
                                              variant={pref === "pie" ? "dark" : "outline-dark"}
                                              onClick={() => setChartPref(c.id_pregunta, "pie")}
                                              style={{ borderRadius: 10, paddingInline: 12 }}
                                            >
                                              Torta
                                            </Button>

                                            <Button
                                              size="sm"
                                              variant={pref === "bar" ? "dark" : "outline-dark"}
                                              onClick={() => setChartPref(c.id_pregunta, "bar")}
                                              style={{ borderRadius: 10, paddingInline: 12 }}
                                            >
                                              Barras
                                            </Button>

                                            {isText && (
                                              <Button
                                                size="sm"
                                                variant={pref === "text" ? "dark" : "outline-dark"}
                                                onClick={() => setChartPref(c.id_pregunta, "text")}
                                                style={{ borderRadius: 10, paddingInline: 12 }}
                                              >
                                                Texto
                                              </Button>
                                            )}
                                          </div>

                                          <div style={{ height: 470 }}>
                                            {pref === "text" ? (
                                              <div
                                                style={{
                                                  height: "100%",
                                                  overflow: "auto",
                                                  background: "rgba(255,255,255,.75)",
                                                  border: "1px solid rgba(0,0,0,.08)",
                                                  borderRadius: 12,
                                                  padding: 12,
                                                }}
                                              >
                                                {(c.textItems || []).length ? (
                                                  (c.textItems || [])
                                                    .slice()
                                                    .sort((a, b) => (b.count || 0) - (a.count || 0))
                                                    .map((it, idx) => (
                                                      <div
                                                        key={idx}
                                                        style={{
                                                          padding: "8px 10px",
                                                          borderBottom: "1px dashed rgba(0,0,0,.12)",
                                                          display: "flex",
                                                          gap: 10,
                                                          alignItems: "flex-start",
                                                        }}
                                                      >
                                                        <Badge bg="dark" style={{ minWidth: 44, textAlign: "center" }}>
                                                          {it.count}
                                                        </Badge>
                                                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.25 }}>
                                                          {it.text}
                                                        </div>
                                                      </div>
                                                    ))
                                                ) : (
                                                  <div className="text-muted">No hay textos para mostrar.</div>
                                                )}
                                              </div>
                                            ) : pref === "bar" ? (
                                              <Bar
                                                data={c.barData}
                                                options={barOptions}
                                                ref={setChartInstanceRef(c.id_pregunta)}
                                              />
                                            ) : (
                                              <Pie
                                                data={c.pieData}
                                                options={pieOptions}
                                                ref={setChartInstanceRef(c.id_pregunta)}
                                              />
                                            )}
                                          </div>
                                        </Card.Body>
                                      </Card>
                                    </Col>
                                  );
                                })}
                              </Row>
                            </div>
                          )}
                        </Card.Body>
                      </Card>
                    </Col>
                  );
                })
              ) : (
                <Col xs={12}>
                  <Alert variant="info">No hay items seleccionados o no hay datos suficientes.</Alert>
                </Col>
              )}
            </Row>

            {/* ✅ CONTENEDOR OCULTO SOLO PARA EXPORT REAL */}
            {renderAllForExport && (
              <div
                style={{
                  position: "fixed",
                  left: -10000,
                  top: 0,
                  width: 1200,
                  height: "auto",
                  opacity: 0,
                  pointerEvents: "none",
                }}
              >
                {chartsBySection.map((sec) => (
                  <div key={`export-sec-${sec.sec}`}>
                    {sec.items.map((c) => {
                      if (c.type !== "chart") return null;

                      const key = String(c.id_pregunta);
                      const pref = exportPrefSnapshot[key] || getChartPref(key);

                      // ✅ si es Texto: NO render chart (PDF escribe texto directo)
                      if (pref === "text") return null;

                      const prefForPdf = pref === "bar" ? "bar" : "pie";

                      return (
                        <div key={`export-chart-${key}`} style={{ width: 780, height: 520 }}>
                          {prefForPdf === "bar" ? (
                            <Bar data={c.barData} options={barOptions} ref={setChartInstanceRef(key)} />
                          ) : (
                            <Pie data={c.pieData} options={pieOptions} ref={setChartInstanceRef(key)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Container>
        )}
      </Modal.Body>
    </Modal>
  );
}