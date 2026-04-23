// backend/controllers/informes.controller.js
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const pool = require("../db");
const scoringEngine = require("../src/modules/scoring/scoring.engine");

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, PageOrientation } = require("docx");
const { parseInformeLatLng } = require("../helpers/informesGeoSummary");

const BASE_UPLOAD_PATH = path.resolve(path.join(__dirname, "..", "uploads"));

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* bÃ¡sicos */
function safe(v) {
  return v ?? "";
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function generateClientRequestId() {
  return crypto.randomUUID();
}

function asPositiveInt(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}

function sanitizeExcelText(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value;

  if (typeof value === "boolean") return value ? "Sí" : "No";

  if (typeof value === "number") return Number.isFinite(value) ? value : "";

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExcelText(item)).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    const labelLike =
      value.label ?? value.nombre ?? value.name ?? value.titulo ?? value.text ?? value.value ?? value.valor ?? null;
    if (labelLike !== null && labelLike !== undefined && String(labelLike).trim() !== "") {
      return sanitizeExcelText(labelLike);
    }

    const nested =
      Array.isArray(value.items) ? value.items :
      Array.isArray(value.values) ? value.values :
      Array.isArray(value.options) ? value.options :
      null;
    if (nested) {
      const nestedText = nested.map((item) => sanitizeExcelText(item)).filter(Boolean).join(", ");
      if (nestedText) return nestedText;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  const text = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE\uFFFF]/g, "");
  return text.trim();
}

function resolveExcelResponseValue(row = {}, question = {}) {
  const tipo = String(question?.tipo || "").trim().toLowerCase();

  const resolveJsonLike = (raw) => {
    if (raw === null || raw === undefined) return "";

    if (typeof raw === "boolean") return raw ? "Sí" : "No";
    if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";
    if (Array.isArray(raw)) return raw.map((item) => resolveJsonLike(item)).filter(Boolean).join(", ");

    if (typeof raw === "object") {
      if (tipo === "semaforo") {
        const nombre = raw.nombre ?? raw.label ?? raw.text ?? raw.name ?? raw.titulo ?? null;
        if (nombre !== null && nombre !== undefined && String(nombre).trim() !== "") {
          return sanitizeExcelText(nombre);
        }
      }

      const labelLike =
        raw.label ?? raw.nombre ?? raw.name ?? raw.titulo ?? raw.text ?? raw.value ?? raw.valor ?? null;
      if (labelLike !== null && labelLike !== undefined && String(labelLike).trim() !== "") {
        return sanitizeExcelText(labelLike);
      }

      const nested =
        Array.isArray(raw.items) ? raw.items :
        Array.isArray(raw.values) ? raw.values :
        Array.isArray(raw.options) ? raw.options :
        null;
      if (nested) {
        const nestedText = nested.map((item) => resolveJsonLike(item)).filter(Boolean).join(", ");
        if (nestedText) return nestedText;
      }

      try {
        return sanitizeExcelText(JSON.stringify(raw));
      } catch {
        return "";
      }
    }

    if (typeof raw === "string") {
      const s = sanitizeExcelText(raw);
      if (!s) return "";

      const parsed = parseJsonMaybe(s);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
        return resolveJsonLike(parsed);
      }
      if (typeof parsed === "boolean") return parsed ? "Sí" : "No";
      if (typeof parsed === "number") return String(parsed);
      if (typeof parsed === "string") return sanitizeExcelText(parsed);

      return s;
    }

    return sanitizeExcelText(raw);
  };

  if (row?.valor_bool !== null && row?.valor_bool !== undefined) {
    return row.valor_bool ? "Sí" : "No";
  }

  if (row?.valor_texto !== null && row?.valor_texto !== undefined) {
    const text = sanitizeExcelText(row.valor_texto);
    if (text !== "") return text;
  }

  if (row?.valor_json !== null && row?.valor_json !== undefined) {
    const resolved = resolveJsonLike(row.valor_json);
    if (resolved !== "") return resolved;
  }

  return "";
}

/**
 * Normaliza input para columnas JSONB:
 * - undefined => "no tocar" (para UPDATE)
 * - null / "" => setear NULL en DB
 * - string => parse JSON (si falla => {__json_error})
 * - object/array => directo
 */
function normalizeJsonbInput(v, { mode = "update" } = {}) {
  if (v === undefined) return mode === "create" ? null : undefined;
  if (v === null) return null;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    try {
      return JSON.parse(s);
    } catch (e) {
      return { __json_error: e?.message || "JSON invÃ¡lido" };
    }
  }

  if (typeof v === "object") return v;

  return null;
}

function resolveAbsolutePath(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const normalized = s.replace(/\\/g, "/");

  if (path.isAbsolute(s)) {
    return path.resolve(s);
  }

  let rel = normalized.replace(/^\/+/, "");
  if (rel.toLowerCase().startsWith("uploads/")) {
    rel = rel.slice("uploads/".length);
  }

  return path.resolve(path.join(BASE_UPLOAD_PATH, rel.replace(/\//g, path.sep)));
}

async function cleanupInformeFiles(fileRows = []) {
  const errors = [];
  let deleted = 0;
  let failed = 0;
  let skipped = 0;
  const total = Array.isArray(fileRows) ? fileRows.length : 0;

  for (const row of fileRows || []) {
    const ruta = row?.ruta_archivo ?? row?.ruta ?? row?.url ?? null;
    if (!ruta) continue;

    try {
      const abs = resolveAbsolutePath(ruta);
      if (!abs) {
        failed += 1;
        errors.push({ ruta, error: "ruta inválida" });
        continue;
      }

      if (!abs.startsWith(BASE_UPLOAD_PATH + path.sep)) {
        failed += 1;
        errors.push({ ruta, error: "fuera de BASE_UPLOAD_PATH" });
        continue;
      }

      // Corte de seguridad: NO borrar fÃ­sico desde Informes.
      skipped += 1;
    } catch (e) {
      if (String(e?.code) === "ENOENT") {
        skipped += 1;
      } else {
        failed += 1;
        errors.push({ ruta, error: e?.message || String(e) });
      }
    }
  }

  console.info("[cleanupInformeFiles] summary", {
    total,
    deleted,
    skipped,
    failed,
    sample_errors: failed > 0 ? errors.slice(0, 5) : [],
  });

  return { total, deleted, skipped, failed, errors };
}

function normalizeAnswerForSaveByTipo(tipo, valorRaw) {
  const t = String(tipo || "").trim().toLowerCase();

  // SELECT / TEXTO / SEMAFORO: siempre string (evita "1" => 1)
  if (t === "select" || t === "texto" || t === "semaforo") {
    if (valorRaw === null || valorRaw === undefined) return "";
    return String(valorRaw);
  }

  // MULTISELECT: siempre array de strings
  if (t === "multiselect") {
    if (Array.isArray(valorRaw)) return valorRaw.map((x) => String(x).trim()).filter(Boolean);

    if (typeof valorRaw === "string") {
      const s = valorRaw.trim();
      if (!s) return [];
      // soporta JSON "[...]" o "a,b,c"
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

  // NÃšMERO: acÃ¡ sÃ­ coerce a Number cuando se pueda
  if (t === "numero") {
    return _coerceValue(valorRaw);
  }

  // Coordenadas / resto: tu flujo actual robusto
  return normalizeCoordLike(_coerceValue(valorRaw));
}

/**
 * Normaliza coordenadas de distintas formas a [lat, lng]
 * Acepta:
 * - "lat,lng"
 * - "[lat,lng]" (string)
 * - [lat,lng]
 * - {lat,lng} / {latitude,longitude}
 */
function normalizeCoordLike(v) {
  if (v == null) return v;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return v;

    // "lat,lng"
    if (/^-?\d+(\.\d+)?\s*[,;]\s*-?\d+(\.\d+)?$/.test(s)) {
      const [a, b] = s.split(/[,;]/).map((x) => Number(String(x).trim().replace(",", ".")));
      if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
      return v;
    }

    // "[lat,lng]"
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const j = JSON.parse(s);
        if (Array.isArray(j) && j.length >= 2) {
          const lat = Number(String(j[0]).trim().replace(",", "."));
          const lng = Number(String(j[1]).trim().replace(",", "."));
          if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
        }
      } catch {}
    }

    return v;
  }

  if (Array.isArray(v) && v.length >= 2) {
    const lat = Number(String(v[0]).trim().replace(",", "."));
    const lng = Number(String(v[1]).trim().replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    return v;
  }

  if (typeof v === "object") {
    const lat0 = v.lat ?? v.latitude ?? null;
    const lng0 = v.lng ?? v.lon ?? v.longitude ?? null;
    const lat = Number(String(lat0).trim().replace(",", "."));
    const lng = Number(String(lng0).trim().replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }

  return v;
}

/* required helpers */
function isEmptyAnswer(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

// leer respuesta por id (acepta "49" o 49)
function _getAnswerValueFromObj(answersObj, idPregunta) {
  const obj = answersObj || {};
  const k = String(idPregunta);
  if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  const n = Number(idPregunta);
  if (Number.isFinite(n) && Object.prototype.hasOwnProperty.call(obj, n)) return obj[n];
  return undefined;
}

/* imÃ¡genes (si ya lo usÃ¡s en PDF/Word) */
function fileToDataUri(absPath) {
  if (!absPath) return null;
  try {
    const buf = fs.readFileSync(absPath);
    const b64 = buf.toString("base64");
    const ext = path.extname(absPath).slice(1).toLowerCase() || "jpeg";
    const kind = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${kind};base64,${b64}`;
  } catch {
    return null;
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SemÃ¡foro (robusto) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function normalizeHex(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s.toUpperCase();
  // soporta #RGB (lo pasamos a #RRGGBB si querÃ©s, pero por ahora lo aceptamos)
  if (/^#([0-9a-fA-F]{3})$/.test(s)) return s.toUpperCase();
  return null;
}

// normaliza nombre (saca acentos, trim, lower)
function normColorName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// arma map: "amarillo" -> "#FACC15"
function buildSemaforoPaletteMap(preguntas = []) {
  const map = new Map();

  for (const q of preguntas) {
    if (String(q.tipo || "").trim().toLowerCase() !== "semaforo") continue;

    let opts = q.opciones_json;
    if (!opts) continue;

    try {
      if (typeof opts === "string") opts = JSON.parse(opts);
    } catch {
      continue;
    }
    if (!Array.isArray(opts)) continue;

    for (const it of opts) {
      const label = it?.label ?? it?.titulo ?? it?.name ?? null;
      const color = it?.color ?? it?.hex ?? it?.value ?? null;
      const hex = normalizeHex(color);
      if (!label || !hex) continue;
      map.set(normColorName(label), hex);
    }
  }

  return map;
}

/**
 * Devuelve: { nombre: "Amarillo", hex:"#FACC15" } o null
 * Soporta input:
 * - "#FACC15"
 * - "amarillo"
 * - {nombre:"Amarillo", hex:"#FACC15"}  (o {label,color,value})
 */
function semaforoToObj(input, paletteMap) {
  if (input === undefined || input === null) return null;

  // objeto
  if (typeof input === "object" && !Array.isArray(input)) {
    const nombreRaw =
      input.nombre ?? input.label ?? input.color_name ?? input.name ?? input.titulo ?? null;
    const hexRaw = input.hex ?? input.color ?? input.value ?? null;

    const hex = normalizeHex(hexRaw);

    if (nombreRaw) {
      const key = normColorName(nombreRaw);
      const hexFromName = paletteMap?.get(key) || null;
      return {
        nombre: String(nombreRaw).trim(),
        hex: hex || (hexFromName ? String(hexFromName).toUpperCase() : null),
      };
    }

    if (hex) {
      // buscar nombre por hex (si existe)
      let foundName = null;
      if (paletteMap && paletteMap.size) {
        for (const [k, v] of paletteMap.entries()) {
          if (String(v).toUpperCase() === hex) {
            foundName = k; // normalizado
            break;
          }
        }
      }
      return { nombre: foundName || null, hex };
    }

    return null;
  }

  // string
  const s = String(input).trim();
  if (!s) return null;

  const hexDirect = normalizeHex(s);
  if (hexDirect) {
    // opcional: buscar nombre por hex
    let foundName = null;
    if (paletteMap && paletteMap.size) {
      for (const [k, v] of paletteMap.entries()) {
        if (String(v).toUpperCase() === hexDirect) {
          foundName = k;
          break;
        }
      }
    }
    return { nombre: foundName || null, hex: hexDirect };
  }

  const key = normColorName(s);
  const hex = paletteMap?.get(key) || null;
  if (!hex) return null;

  // â€œnombre lindoâ€ para guardar como texto
  const niceName = s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  return { nombre: niceName, hex: String(hex).toUpperCase() };
}

function _pad2(n) {
  return String(n).padStart(2, "0");
}

function _formatFechaPY(value) {
  if (!value) return "-";

  let d;
  if (value instanceof Date) d = value;
  else d = new Date(value);

  if (Number.isNaN(d.getTime())) return String(value);

  const dd = _pad2(d.getDate());
  const mm = _pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();

  const hh = _pad2(d.getHours());
  const mi = _pad2(d.getMinutes());
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;

  return hasTime ? `${dd}/${mm}/${yyyy} ${hh}:${mi}` : `${dd}/${mm}/${yyyy}`;
}

function buildRespuestasMap(respuestas) {
  const map = {};
  for (const r of (respuestas || [])) {
    let val = r.valor_texto;

    if (r.valor_bool !== null && r.valor_bool !== undefined) {
      val = r.valor_bool ? "SÃ­" : "No";
    } else if (r.valor_json !== null && r.valor_json !== undefined) {
      try {
        const parsed =
          typeof r.valor_json === "string" ? JSON.parse(r.valor_json) : r.valor_json;

        if (Array.isArray(parsed)) {
          val = parsed.join(", ");
        } else if (parsed && typeof parsed === "object") {
          // âœ… ubicaciÃ³n {lat,lng}
          if ("lat" in parsed && "lng" in parsed) val = `${parsed.lat}, ${parsed.lng}`;
          else val = JSON.stringify(parsed, null, 2);
        } else {
          val = String(parsed);
        }
      } catch {
        val = String(r.valor_json);
      }
    }

    map[r.id_pregunta] = val || "-";
  }
  return map;
}

// âœ… base pÃºblica para armar URLs de fotos
// Recomendado en .env del backend (SIN /api):
// PUBLIC_BASE_URL=https://api.emagroup.com.py
function getPublicBaseUrl(req) {
  const envBase =
    (process.env.PUBLIC_BASE_URL || process.env.VITE_PUBLIC_API_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function normalizeSlashes(p) {
  return String(p || "").replace(/\\/g, "/");
}

/**
 * âœ… Usa tus estÃ¡ticos existentes:
 * - /uploads   (recomendado)
 * - /api/uploads (alternativa)
 */
function toPublicPhotoUrl(req, ruta_archivo) {
  const raw = String(ruta_archivo || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = getPublicBaseUrl(req);

  // elegÃ­ UNO (sin tocar index.js)
  const PUBLIC_PREFIX = "/uploads";      // âœ… recomendado
  // const PUBLIC_PREFIX = "/api/uploads"; // alternativa

  const p0 = normalizeSlashes(raw);

  // Si ya viene con /uploads o /api/uploads, respetar
  if (p0.startsWith("/uploads/") || p0.startsWith("/api/uploads/")) {
    return `${base}${p0}`;
  }

  // Si viene relativo "uploads/..."
  if (p0.startsWith("uploads/")) return `${base}${PUBLIC_PREFIX}/${p0.slice("uploads/".length)}`;

  // Si viene relativo "proyectos/..." (TU CASO)
  if (p0.startsWith("proyectos/")) return `${base}${PUBLIC_PREFIX}/${p0}`;

  // Si viene Windows abs y contiene \uploads\ o /uploads/
  const pLower = p0.toLowerCase();
  const idx = pLower.indexOf("/uploads/");
  if (idx >= 0) return `${base}${p0.slice(idx)}`;

  // Fallback: lo colgamos igual bajo /uploads
  const rel = p0.replace(/^\/+/, "");
  return `${base}${PUBLIC_PREFIX}/${rel}`;
}

// âœ… lÃ­mites y helpers (ponÃ© esto arriba del archivo o arriba de safeSaveUpload)
const MAX_UPLOAD_BYTES =
  (typeof globalThis.MAX_UPLOAD_BYTES === "number" && globalThis.MAX_UPLOAD_BYTES > 0
    ? globalThis.MAX_UPLOAD_BYTES
    : (typeof process !== "undefined" && Number(process.env.MAX_UPLOAD_BYTES) > 0
      ? Number(process.env.MAX_UPLOAD_BYTES)
      : 10 * 1024 * 1024)); // 10MB default

function pickSafeImageExt(name = "", mimetype = "") {
  const n = String(name || "").toLowerCase().trim();
  const mt = String(mimetype || "").toLowerCase().trim();

  // 1) por mimetype (mÃ¡s confiable)
  if (mt === "image/jpeg" || mt === "image/jpg") return ".jpg";
  if (mt === "image/png") return ".png";
  if (mt === "image/webp") return ".webp";

  // 2) fallback por extensiÃ³n (si mimetype viene vacÃ­o)
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return ".jpg";
  if (n.endsWith(".png")) return ".png";
  if (n.endsWith(".webp")) return ".webp";

  return "";
}

function sanitizeFilename(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^a-zA-Z0-9._-]+/g, "_") // deja seguro
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "archivo";
}

// âœ… HTML para UN informe (fotos por pregunta) â€” MISMO FORMATO LIMPIO (sirve para single y multi)
function htmlTemplateInforme(informe, secciones, preguntas, respuestasMap, fotosPorPregunta) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Informe dinÃ¡mico</title>
<style>
  :root { --teal:#0e7a7a; --muted:#666; --band:#eeeeee; }
  body { font-family: Arial, sans-serif; font-size: 12px; color:#222; line-height: 1.45; }

  h1 { font-size: 20px; color: var(--teal); margin: 6px 0 4px; }
  .hr { border-top: 2px solid var(--teal); margin: 6px 0 16px; }
  .meta { font-size: 11px; color: var(--muted); margin-bottom: 8px; }

  /* âœ… Secciones mÃ¡s â€œlimpiasâ€ */
  .sec { margin: 14px 0; page-break-inside: avoid; break-inside: avoid; }
  .band {
    background: var(--band);
    padding: 6px 10px;
    font-weight: 800;
    color: var(--teal);
    border-left: 4px solid var(--teal);
    margin-bottom: 8px;
  }

  .preg { margin: 6px 0; break-inside: avoid; page-break-inside: avoid; }
  .label { font-weight: bold; display:inline-block; min-width: 260px; vertical-align: top; }
  .valor { display:inline-block; margin-left: 10px; max-width: 420px; white-space: pre-wrap; word-break: break-word; }

  /* âœ… GalerÃ­a: que se vea bien en PDF (3 columnas) */
  .gal-preg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 8px; }
  .gal-preg img { width: 100%; height: 110px; object-fit: cover; border: 1px solid #ccc; border-radius: 4px; }

  .muted { color: var(--muted); font-size: 10px; }
  pre { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
  <h1>${safe(informe.titulo || informe.nombre_plantilla || "INFORME")}</h1>
  <div class="hr"></div>

  <div class="meta">
    <div><b>ID Informe:</b> ${informe.id_informe}</div>
    <div><b>Plantilla:</b> ${safe(informe.nombre_plantilla || informe.id_plantilla)}</div>
    <div><b>ID Proyecto:</b> ${safe(informe.id_proyecto || "-")}</div>
    <div><b>Fecha:</b> ${_formatFechaPY(informe.fecha_creado)}</div>
  </div>

  ${secciones
    .map((sec) => {
      const preguntasSec = preguntas.filter((p) => p.id_seccion === sec.id_seccion);

      const bloque = preguntasSec
        .map((p) => {
          const valor = respuestasMap[p.id_pregunta] ?? "-";
          const fotos = fotosPorPregunta[p.id_pregunta] || [];

          const fotosHtml = fotos.length
            ? `
        <div class="gal-preg">
          ${fotos
            .map(
              (f) => `
            <div>
              <img src="${f.dataUri}"/>
              ${f.descripcion ? `<div class="muted">${safe(f.descripcion)}</div>` : ""}
            </div>
          `
            )
            .join("")}
        </div>
      `
            : "";

          return `
        <div class="preg">
          <div>
            <span class="label">${safe(p.etiqueta)}</span>
            <span class="valor">${safe(valor)}</span>
          </div>
          ${fotosHtml}
        </div>
      `;
        })
        .join("");

      return `
      <div class="sec">
        <div class="band">${safe(sec.titulo)}</div>
        ${bloque || '<div class="preg muted">Sin preguntas en esta secciÃ³n.</div>'}
      </div>
    `;
    })
    .join("")}
</body>
</html>`;
}

// âœ… HTML para VARIOS informes en un solo PDF â€” MISMO FORMATO QUE EL INDIVIDUAL
function htmlTemplateMultiInformes({ proyectoLabel, informesBlocks }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Informes del Proyecto</title>
<style>
  :root { --teal:#0e7a7a; --muted:#666; --band:#eeeeee; }
  body { font-family: Arial, sans-serif; font-size: 12px; color:#222; line-height: 1.45; }

  /* Cover */
  .cover h1 { font-size: 22px; color: var(--teal); margin: 8px 0 6px; }
  .cover .meta { color: var(--muted); font-size: 11px; margin: 2px 0; }
  .cover .hr { border-top: 2px solid var(--teal); margin: 8px 0 16px; }

  /* âœ… separaciÃ³n por informe */
  .report { page-break-after: always; }
  .report:last-child { page-break-after: auto; }

  /* âœ… Reusar las MISMAS clases del individual (para que quede idÃ©ntico) */
  h1 { font-size: 20px; color: var(--teal); margin: 6px 0 4px; }
  .hr { border-top: 2px solid var(--teal); margin: 6px 0 16px; }
  .meta { font-size: 11px; color: var(--muted); margin-bottom: 8px; }

  .sec { margin: 14px 0; page-break-inside: avoid; break-inside: avoid; }
  .band {
    background: var(--band);
    padding: 6px 10px;
    font-weight: 800;
    color: var(--teal);
    border-left: 4px solid var(--teal);
    margin-bottom: 8px;
  }
  .preg { margin: 6px 0; break-inside: avoid; page-break-inside: avoid; }
  .label { font-weight: bold; display:inline-block; min-width: 260px; vertical-align: top; }
  .valor { display:inline-block; margin-left: 10px; max-width: 420px; white-space: pre-wrap; word-break: break-word; }

  .gal-preg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 8px; }
  .gal-preg img { width: 100%; height: 110px; object-fit: cover; border: 1px solid #ccc; border-radius: 4px; }

  .muted { color: var(--muted); font-size: 10px; }
  pre { white-space: pre-wrap; word-break: break-word; }

  @page { margin: 12mm; }
</style>
</head>
<body>
  <div class="cover">
    <h1>INFORMES DEL PROYECTO</h1>
    <div class="meta"><b>Proyecto:</b> ${safe(proyectoLabel)}</div>
    <div class="meta"><b>Generado:</b> ${_formatFechaPY(new Date())}</div>
    <div class="hr"></div>
  </div>

  ${informesBlocks.map((b) => `<div class="report">${b}</div>`).join("\n")}
</body>
</html>`;
}

/**
 * âœ… Normaliza valores para comparar:
 * - booleans reales
 * - strings "true"/"false"
 * - strings "SI"/"SÃ"/"NO"
 * - nÃºmeros en string ("12" -> 12)
 * - arrays (normaliza elementos)
 * - deja objetos tal cual
 */
function _coerceValue(v) {
  if (Array.isArray(v)) return v.map(_coerceValue);
  if (v === null || v === undefined) return v;

  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v;

  if (typeof v === "string") {
    const s = v.trim();
    const sl = s.toLowerCase();

    if (sl === "true") return true;
    if (sl === "false") return false;

    if (sl === "si" || sl === "sÃ­") return true;
    if (sl === "no") return false;

    if (s !== "" && /^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }

    return s;
  }

  return v;
}

// âœ… evalCond ROBUSTO
function evalCond(cond, answersObj) {
  if (!cond) return true;

  let c = cond;
  if (typeof c === "string") {
    try {
      c = JSON.parse(c);
    } catch {
      return true; // string no-json => no cortar flujo
    }
  }
  if (!c || typeof c !== "object") return true;

  if (Array.isArray(c.all)) return c.all.every((x) => evalCond(x, answersObj));
  if (Array.isArray(c.any)) return c.any.some((x) => evalCond(x, answersObj));

  const idSrc = Number(c.id ?? c.id_pregunta ?? c.pregunta_id);
  if (!idSrc) return true;

  const op = String(c.op ?? "eq").trim().toLowerCase();
  const expectedRaw = c.value;

  const key = String(idSrc);
  const obj = answersObj || {};
  const has = Object.prototype.hasOwnProperty.call(obj, key);

  const actualRaw = has ? obj[key] : undefined;
  const actual = _coerceValue(actualRaw);
  const expected = expectedRaw === undefined ? undefined : _coerceValue(expectedRaw);

  const toArr = (v) => (Array.isArray(v) ? v.map(_coerceValue) : v == null ? [] : [_coerceValue(v)]);

  if (op === "exists") return has;
  if (op === "not_exists") return !has;

  if (op === "truthy") return has && !isEmptyAnswer(actual) && actual !== false;
  if (op === "falsy") return !has || isEmptyAnswer(actual) || actual === false;

  if (op === "in") {
    const expectedArr = Array.isArray(expectedRaw) ? expectedRaw.map(_coerceValue) : toArr(expected);
    if (Array.isArray(actual)) {
      const actualArr = actual.map(_coerceValue);
      return actualArr.some((x) => expectedArr.includes(x));
    }
    return expectedArr.includes(actual);
  }

  if (op === "not_in") {
    const expectedArr = Array.isArray(expectedRaw) ? expectedRaw.map(_coerceValue) : toArr(expected);
    if (Array.isArray(actual)) {
      const actualArr = actual.map(_coerceValue);
      return !actualArr.some((x) => expectedArr.includes(x));
    }
    return !expectedArr.includes(actual);
  }

  if (op === "eq" || op === "==") return actual === expected;
  if (op === "neq" || op === "!=") return actual !== expected;

  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    const a = Number(actual);
    const e = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    if (op === ">") return a > e;
    if (op === ">=") return a >= e;
    if (op === "<") return a < e;
    if (op === "<=") return a <= e;
  }

  return false;
}

// âœ… FUNCIÃ“N ACTUALIZADA
async function safeSaveUpload(uploadFile, destAbs) {
  if (!uploadFile) throw new Error("Archivo vacÃ­o");

  // âœ… usa un maxBytes local (evita ReferenceError + ts6133 si lo usÃ¡s)
  const maxBytes =
    typeof MAX_UPLOAD_BYTES === "number" && MAX_UPLOAD_BYTES > 0
      ? MAX_UPLOAD_BYTES
      : 10 * 1024 * 1024;

  const size = uploadFile.size != null ? Number(uploadFile.size) : null;
  if (size != null && Number.isFinite(size) && size > maxBytes) {
    throw new Error(`Archivo demasiado grande (> ${maxBytes} bytes)`);
  }

  const safeExt = pickSafeImageExt(uploadFile.name, uploadFile.mimetype);
  if (!safeExt) throw new Error("Tipo de archivo no permitido (solo jpg/png/webp)");

  const dir = path.dirname(destAbs);
  await fs.promises.mkdir(dir, { recursive: true });

  // âœ… fuerza nombre seguro + extensiÃ³n segura (evita raros como .jpg.exe)
  const base = sanitizeFilename(path.basename(destAbs, path.extname(destAbs)));
  const finalAbs = path.join(dir, `${base}${safeExt}`);

  // âœ… express-fileupload: mv devuelve promesa si no pasÃ¡s callback
  await uploadFile.mv(finalAbs);

  return finalAbs;
}

// âœ… Guardar respuesta en (texto/bool/jsonb)
function toJsonbOrText(valor) {
  let valor_texto = null;
  let valor_bool = null;
  let valor_json = null;

  if (typeof valor === "boolean") {
    valor_bool = valor;
    return { valor_texto, valor_bool, valor_json };
  }

  if (valor === null || valor === undefined) {
    return { valor_texto, valor_bool, valor_json };
  }

  if (Array.isArray(valor)) {
    valor_json = JSON.stringify(valor);
    return { valor_texto, valor_bool, valor_json };
  }

  if (typeof valor === "object") {
    valor_json = JSON.stringify(valor);
    return { valor_texto, valor_bool, valor_json };
  }

  if (typeof valor === "string") {
    const s = valor.trim();
    if (s) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
          valor_json = JSON.stringify(parsed);
          return { valor_texto, valor_bool, valor_json };
        }
      } catch {}
      valor_texto = s;
    }
    return { valor_texto, valor_bool, valor_json };
  }

  valor_texto = String(valor);
  return { valor_texto, valor_bool, valor_json };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PLANTILLAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// GET /api/informes/plantillas
async function getPlantillas(req, res) {
  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  try {
    const q = `
      SELECT
        p.*,
        u.username AS creador_username,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS creador_nombre,
        CASE
          WHEN $2 = true THEN 'edit'
          WHEN p.id_creador = $1 THEN 'edit'
          ELSE pu.rol
        END AS mi_rol
      FROM ema.informe_plantilla p
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
       AND pu.id_usuario = $1
      LEFT JOIN public.users u
        ON u.id = p.id_creador
      WHERE
        ($2 = true)
        OR (p.id_creador = $1)
        OR (
          COALESCE(p.activo, true) = true
          AND pu.id_usuario IS NOT NULL
        )
      ORDER BY p.id_plantilla DESC
    `;

    const { rows } = await pool.query(q, [userId, isAdmin]);
    return res.json(rows);
  } catch (err) {
    console.error("❌ getPlantillas error:", err.message);
    return res.json([]);
  }
}

// GET /api/informes/plantillas/:id
async function getPlantillaById(req, res) {
  const { id } = req.params;
  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  try {
    const plantRes = await pool.query(
      `
      SELECT
        p.*,
        pu.rol AS mi_rol_db,
        u.username AS creador_username,
        NULLIF(
          TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))),
          ''
        ) AS creador_nombre
      FROM ema.informe_plantilla p
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
       AND pu.id_usuario = $2
      LEFT JOIN public.users u
        ON u.id = p.id_creador
      WHERE p.id_plantilla = $1
      LIMIT 1
      `,
      [Number(id), Number(userId)]
    );

    if (!plantRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    }

    const plantilla = plantRes.rows[0];

    const isOwner = Number(plantilla.id_creador) === Number(userId);
    const isShared = !!plantilla.mi_rol_db;
    const isActive = (plantilla.activo ?? true) === true;

    const canRead = isAdmin || isOwner || (isActive && isShared);
    if (!canRead) {
      return res.status(403).json({ ok: false, error: "Sin acceso a la plantilla" });
    }

    const mi_rol = isAdmin || isOwner ? "edit" : plantilla.mi_rol_db;

    const { rows: secciones } = await pool.query(
      `SELECT * FROM ema.informe_seccion WHERE id_plantilla = $1 ORDER BY orden`,
      [id]
    );

    const { rows: preguntas } = await pool.query(
      `SELECT * FROM ema.informe_pregunta
       WHERE id_seccion IN (
         SELECT id_seccion
         FROM ema.informe_seccion
         WHERE id_plantilla = $1
       )
       ORDER BY orden`,
      [id]
    );

    const seccionesConPreguntas = secciones.map((sec) => ({
      ...sec,
      preguntas: preguntas.filter((p) => p.id_seccion === sec.id_seccion),
    }));

    return res.json({
      ...plantilla,
      mi_rol,
      secciones: seccionesConPreguntas,
    });
  } catch (err) {
    console.error("getPlantillaById error:", err);
    return res.status(500).json({ ok: false, error: "Error al obtener plantilla" });
  }
}

// POST /api/informes/plantillas
async function createPlantilla(req, res) {
  const { nombre, descripcion, activo = true, proyectos_permitidos = null, usuarios_compartidos = null } = req.body;
  const { id: userId } = req.user || {};
  try {
    let result = await pool
      .query(
        `INSERT INTO ema.informe_plantilla (nombre, descripcion, activo, id_creador, proyectos_permitidos, usuarios_compartidos)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          nombre,
          descripcion || null,
          activo,
          userId || null,
          proyectos_permitidos ? JSON.stringify(proyectos_permitidos) : null,
          usuarios_compartidos ? JSON.stringify(usuarios_compartidos) : null,
        ]
      )
      .catch(async (e) => {
        console.warn("⚠️ createPlantilla: campos extendidos no disponibles, usando fallback", e.message);
        return pool.query(
          `INSERT INTO ema.informe_plantilla (nombre, descripcion, activo, id_creador)
          VALUES ($1, $2, $3, $4)
          RETURNING *`,
          [nombre, descripcion || null, activo, userId || null]
        );
      });

    const { rows } = await result;
    return res.status(201).json({ ok: true, plantilla: rows[0] });
  } catch (err) {
    console.error("âŒ createPlantilla error:", err.message);
    return res.status(500).json({ ok: false, error: "Error al crear plantilla", details: err.message });
  }
}

// PUT /api/informes/plantillas/:id
async function updatePlantilla(req, res) {
  const { id } = req.params;
  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  const { nombre, descripcion, activo, proyectos_permitidos, usuarios_compartidos } = req.body;

  try {
    const checkRes = await pool
      .query(`SELECT id_creador FROM ema.informe_plantilla WHERE id_plantilla = $1`, [id])
      .catch(async () => ({ rowCount: 1, rows: [{ id_creador: null }] }));

    if (!checkRes.rowCount) return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });

    const plantilla = checkRes.rows[0];
    const isOwner = plantilla.id_creador ? Number(plantilla.id_creador) === Number(userId) : true;

    if (!isAdmin && !isOwner) return res.status(403).json({ ok: false, error: "Sin permisos para editar" });

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (nombre !== undefined) {
      updates.push(`nombre = $${paramCount++}`);
      params.push(nombre);
    }
    if (descripcion !== undefined) {
      updates.push(`descripcion = $${paramCount++}`);
      params.push(descripcion || null);
    }
    if (activo !== undefined) {
      updates.push(`activo = $${paramCount++}`);
      params.push(activo);
    }
    if (proyectos_permitidos !== undefined) {
      updates.push(`proyectos_permitidos = $${paramCount++}`);
      params.push(proyectos_permitidos ? JSON.stringify(proyectos_permitidos) : null);
    }
    if (usuarios_compartidos !== undefined) {
      updates.push(`usuarios_compartidos = $${paramCount++}`);
      params.push(usuarios_compartidos ? JSON.stringify(usuarios_compartidos) : null);
    }

    if (!updates.length) return res.json({ ok: true });

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE ema.informe_plantilla
       SET ${updates.join(", ")}
       WHERE id_plantilla = $${paramCount}
       RETURNING *`,
      params
    );

    return res.json({ ok: true, plantilla: rows[0] });
  } catch (err) {
    console.error("âŒ updatePlantilla error:", err.message);
    return res.status(500).json({ ok: false, error: "Error al actualizar plantilla", details: err.message });
  }
}

// DELETE lÃ³gico /api/informes/plantillas/:id
async function deletePlantilla(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE ema.informe_plantilla
       SET activo = FALSE
       WHERE id_plantilla = $1
       RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    return res.json({ ok: true, plantilla: rows[0] });
  } catch (err) {
    console.error("deletePlantilla error:", err);
    return res.status(500).json({ ok: false, error: "Error al eliminar plantilla" });
  }
}

// DELETE DEFINITIVO (SOLO ADMIN)
async function hardDeletePlantilla(req, res) {
  const idPlantilla = Number(req.params.id);
  const tipo = Number(req.user?.tipo_usuario ?? req.user?.tipo ?? req.user?.group_id);
  if (tipo !== 1) return res.status(403).json({ ok: false, error: "Solo administrador puede eliminar definitivamente" });
  if (!idPlantilla) return res.status(400).json({ ok: false, error: "ID invÃ¡lido" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inf = await client.query(
      `SELECT id_informe
         FROM ema.informe
        WHERE id_plantilla = $1
        FOR UPDATE`,
      [idPlantilla]
    );
    const ids = inf.rows.map((r) => r.id_informe);

    if (ids.length) {
      await client.query(`DELETE FROM ema.informe_foto WHERE id_informe = ANY($1::bigint[])`, [ids]);
      await client.query(`DELETE FROM ema.informe_respuesta WHERE id_informe = ANY($1::bigint[])`, [ids]);
      await client.query(`DELETE FROM ema.informe WHERE id_informe = ANY($1::bigint[])`, [ids]);
    }

    await client.query(`DELETE FROM ema.informe_share_link WHERE id_plantilla = $1`, [idPlantilla]);

    await client.query(
      `DELETE FROM ema.informe_pregunta
        WHERE id_seccion IN (SELECT id_seccion FROM ema.informe_seccion WHERE id_plantilla = $1)`,
      [idPlantilla]
    );

    await client.query(`DELETE FROM ema.informe_seccion WHERE id_plantilla = $1`, [idPlantilla]);

    const del = await client.query(`DELETE FROM ema.informe_plantilla WHERE id_plantilla = $1`, [idPlantilla]);

    await client.query("COMMIT");

    if (!del.rowCount) return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("hardDeletePlantilla error:", err);
    return res.status(500).json({ ok: false, error: "Error al eliminar definitivamente" });
  } finally {
    client.release();
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SECCIONES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// POST /api/informes/plantillas/:idPlantilla/secciones
async function createSeccion(req, res) {
  const { idPlantilla } = req.params;
  const { titulo, orden = 1, visible_if } = req.body;

  try {
    const visibleIfJson = normalizeJsonbInput(visible_if, { mode: "create" });

    if (visibleIfJson && visibleIfJson.__json_error) {
      return res.status(400).json({ ok: false, error: `visible_if invÃ¡lido: ${visibleIfJson.__json_error}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO ema.informe_seccion (id_plantilla, titulo, orden, visible_if)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [idPlantilla, titulo, Number(orden || 1), visibleIfJson === null ? null : JSON.stringify(visibleIfJson)]
    );

    return res.status(201).json({ ok: true, seccion: rows[0] });
  } catch (err) {
    console.error("createSeccion error:", err);
    return res.status(500).json({ ok: false, error: "Error al crear secciÃ³n" });
  }
}

// PUT /api/informes/secciones/:idSeccion
async function updateSeccion(req, res) {
  const { idSeccion } = req.params;
  const { titulo, orden } = req.body;

  const visibleIfJson = normalizeJsonbInput(req.body.visible_if, { mode: "update" });

  if (visibleIfJson && visibleIfJson.__json_error) {
    return res.status(400).json({ ok: false, error: `visible_if invÃ¡lido: ${visibleIfJson.__json_error}` });
  }

  try {
    const sets = [];
    const params = [];

    if (titulo !== undefined) {
      params.push(titulo || null);
      sets.push(`titulo = COALESCE($${params.length}, titulo)`);
    }

    if (orden !== undefined) {
      params.push(Number(orden));
      sets.push(`orden = COALESCE($${params.length}, orden)`);
    }

    if (visibleIfJson !== undefined) {
      params.push(visibleIfJson === null ? null : JSON.stringify(visibleIfJson));
      sets.push(`visible_if = $${params.length}::jsonb`);
    }

    if (!sets.length) return res.status(400).json({ ok: false, error: "Nada para actualizar" });

    params.push(Number(idSeccion));

    const { rows } = await pool.query(
      `UPDATE ema.informe_seccion
       SET ${sets.join(", ")}
       WHERE id_seccion = $${params.length}
       RETURNING *`,
      params
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: "SecciÃ³n no encontrada" });
    return res.json({ ok: true, seccion: rows[0] });
  } catch (err) {
    console.error("updateSeccion error:", err);
    return res.status(500).json({ ok: false, error: "Error al actualizar secciÃ³n" });
  }
}

// DELETE /api/informes/secciones/:idSeccion
async function deleteSeccion(req, res) {
  const idSeccion = Number(req.params.idSeccion);
  if (!Number.isFinite(idSeccion) || idSeccion <= 0) {
    return res.status(400).json({ ok: false, error: "idSeccion invÃ¡lido" });
  }

  const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pq = await client.query(
      `SELECT id_pregunta
         FROM ema.informe_pregunta
        WHERE id_seccion = $1
        FOR UPDATE`,
      [idSeccion]
    );
    const idsPreg = pq.rows.map((r) => Number(r.id_pregunta)).filter(Boolean);

    let rutas = [];
    if (idsPreg.length) {
      const fotos = await client.query(
        `SELECT f.ruta_archivo
           FROM ema.informe_foto f
          WHERE f.id_pregunta = ANY($1::int[])`,
        [idsPreg]
      );
      rutas = fotos.rows.map((x) => x.ruta_archivo).filter(Boolean);

      await client.query(`DELETE FROM ema.informe_foto WHERE id_pregunta = ANY($1::int[])`, [idsPreg]);
      await client.query(`DELETE FROM ema.informe_respuesta WHERE id_pregunta = ANY($1::int[])`, [idsPreg]);
      await client.query(`DELETE FROM ema.informe_pregunta WHERE id_pregunta = ANY($1::int[])`, [idsPreg]);
    }

    const delSec = await client.query(`DELETE FROM ema.informe_seccion WHERE id_seccion = $1`, [idSeccion]);

    await client.query("COMMIT");

    // Corte de seguridad: NO borrar fÃ­sico desde Informes.

    if (!delSec.rowCount) return res.status(404).json({ ok: false, error: "SecciÃ³n no encontrada" });
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteSeccion error:", err);
    return res.status(500).json({ ok: false, error: err?.detail || err?.message || "Error al eliminar secciÃ³n" });
  } finally {
    client.release();
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PREGUNTAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

// POST /api/informes/secciones/:idSeccion/preguntas
async function createPregunta(req, res) {
  const { idSeccion } = req.params;

  let {
    etiqueta,
    tipo,
    opciones,
    opciones_json,
    obligatorio = false,
    orden = 1,
    permite_foto = false,
    visible_if,
    required_if,
    hide_if,
  } = req.body;

  if (!etiqueta?.trim()) {
    return res.status(400).json({ ok: false, error: "La etiqueta es obligatoria" });
  }

  if (!tipo?.trim()) {
    return res.status(400).json({ ok: false, error: "El tipo es obligatorio" });
  }

  const tipoNorm = String(tipo).trim().toLowerCase();

  if (tipoNorm === "imagen") {
    permite_foto = true;
    opciones = null;
    opciones_json = null;
  }

  const opcionesInput = opciones_json !== undefined ? opciones_json : opciones;

  let opcionesJson = null;
  if (opcionesInput !== undefined && opcionesInput !== null && opcionesInput !== "") {
    if (Array.isArray(opcionesInput)) {
      opcionesJson = JSON.stringify(opcionesInput);
    } else {
      try {
        opcionesJson = JSON.stringify(JSON.parse(opcionesInput));
      } catch {
        opcionesJson = null;
      }
    }
  }

  const visibleIfJson = normalizeJsonbInput(visible_if);
  const requiredIfJson = normalizeJsonbInput(required_if);
  const hideIfJson = normalizeJsonbInput(hide_if);

  const secId = asPositiveInt(idSeccion, 0);
  const newOrden = asPositiveInt(orden, 1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `SELECT id_pregunta
         FROM ema.informe_pregunta
        WHERE id_seccion = $1
        FOR UPDATE`,
      [secId]
    );

    await client.query(
      `UPDATE ema.informe_pregunta
          SET orden = orden + 1
        WHERE id_seccion = $1
          AND orden >= $2`,
      [secId, newOrden]
    );

    const { rows } = await client.query(
      `INSERT INTO ema.informe_pregunta
        (
          id_seccion,
          etiqueta,
          tipo,
          opciones_json,
          obligatorio,
          orden,
          permite_foto,
          visible_if,
          required_if,
          hide_if
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        secId,
        etiqueta.trim(),
        tipo.trim(),
        opcionesJson,
        !!obligatorio,
        newOrden,
        !!permite_foto,
        visibleIfJson,
        requiredIfJson,
        hideIfJson,
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json({ ok: true, pregunta: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createPregunta error:", err);

    if (String(err?.code) === "23505") {
      return res.status(409).json({ ok: false, error: "Conflicto de orden. Reintente." });
    }

    return res.status(500).json({ ok: false, error: "Error al crear pregunta" });
  } finally {
    client.release();
  }
}

// PUT /api/informes/preguntas/:idPregunta
async function updatePregunta(req, res) {
  const { idPregunta } = req.params;

  let {
    etiqueta,
    tipo,
    opciones,
    opciones_json,
    obligatorio,
    orden,
    permite_foto,
    id_seccion,
    visible_if,
    required_if,
    hide_if,
  } = req.body;

  const pregId = asPositiveInt(idPregunta, 0);
  if (!pregId) {
    return res.status(400).json({ ok: false, error: "idPregunta invÃ¡lido" });
  }

  const tipoNorm =
    tipo !== undefined && tipo !== null
      ? String(tipo).trim().toLowerCase()
      : null;

  if (tipoNorm === "imagen") {
    permite_foto = true;
    opciones = null;
    opciones_json = null;
  }

  const opcionesInput = opciones_json !== undefined ? opciones_json : opciones;

  let opcionesJson = undefined;
  if (opcionesInput !== undefined) {
    if (opcionesInput === null || opcionesInput === "") {
      opcionesJson = null;
    } else if (Array.isArray(opcionesInput)) {
      opcionesJson = JSON.stringify(opcionesInput);
    } else {
      try {
        opcionesJson = JSON.stringify(JSON.parse(opcionesInput));
      } catch {
        opcionesJson = null;
      }
    }
  }

  if (tipoNorm === "imagen") opcionesJson = null;

  const visibleIfJson = normalizeJsonbInput(visible_if);
  const requiredIfJson = normalizeJsonbInput(required_if);
  const hideIfJson = normalizeJsonbInput(hide_if);

  const newOrden = orden !== undefined ? asPositiveInt(orden, 1) : undefined;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query(
      `SELECT id_seccion, orden
         FROM ema.informe_pregunta
        WHERE id_pregunta = $1
        FOR UPDATE`,
      [pregId]
    );

    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Pregunta no encontrada" });
    }

    const oldSeccion = Number(cur.rows[0].id_seccion);
    const oldOrden = Number(cur.rows[0].orden);

    const newSeccion =
      id_seccion !== undefined && id_seccion !== null && id_seccion !== ""
        ? asPositiveInt(id_seccion, oldSeccion)
        : oldSeccion;

    await client.query(
      `SELECT id_pregunta
         FROM ema.informe_pregunta
        WHERE id_seccion = $1
        FOR UPDATE`,
      [oldSeccion]
    );

    if (newSeccion !== oldSeccion) {
      await client.query(
        `SELECT id_pregunta
           FROM ema.informe_pregunta
          WHERE id_seccion = $1
          FOR UPDATE`,
        [newSeccion]
      );
    }

    if (newSeccion === oldSeccion && newOrden !== undefined && newOrden !== oldOrden) {
      if (newOrden < oldOrden) {
        await client.query(
          `UPDATE ema.informe_pregunta
              SET orden = orden + 1
            WHERE id_seccion = $1
              AND orden >= $2
              AND orden < $3
              AND id_pregunta <> $4`,
          [oldSeccion, newOrden, oldOrden, pregId]
        );
      } else {
        await client.query(
          `UPDATE ema.informe_pregunta
              SET orden = orden - 1
            WHERE id_seccion = $1
              AND orden <= $2
              AND orden > $3
              AND id_pregunta <> $4`,
          [oldSeccion, newOrden, oldOrden, pregId]
        );
      }
    }

    if (newSeccion !== oldSeccion) {
      const targetOrden = newOrden !== undefined ? newOrden : 1;

      await client.query(
        `UPDATE ema.informe_pregunta
            SET orden = orden - 1
          WHERE id_seccion = $1
            AND orden > $2
            AND id_pregunta <> $3`,
        [oldSeccion, oldOrden, pregId]
      );

      await client.query(
        `UPDATE ema.informe_pregunta
            SET orden = orden + 1
          WHERE id_seccion = $1
            AND orden >= $2`,
        [newSeccion, targetOrden]
      );
    }

    const sets = [];
    const params = [];

    if (etiqueta !== undefined) {
      sets.push(`etiqueta = $${sets.length + 1}`);
      params.push(etiqueta);
    }

    if (tipo !== undefined) {
      sets.push(`tipo = $${sets.length + 1}`);
      params.push(tipo);
    }

    if (opcionesJson !== undefined) {
      sets.push(`opciones_json = $${sets.length + 1}`);
      params.push(opcionesJson);
    }

    if (obligatorio !== undefined) {
      sets.push(`obligatorio = $${sets.length + 1}`);
      params.push(!!obligatorio);
    }

    if (newSeccion !== oldSeccion) {
      sets.push(`id_seccion = $${sets.length + 1}`);
      params.push(newSeccion);

      if (newOrden === undefined) {
        sets.push(`orden = $${sets.length + 1}`);
        params.push(1);
      }
    }

    if (newOrden !== undefined) {
      sets.push(`orden = $${sets.length + 1}`);
      params.push(newOrden);
    }

    if (permite_foto !== undefined) {
      sets.push(`permite_foto = $${sets.length + 1}`);
      params.push(!!permite_foto);
    }

    if (visibleIfJson !== undefined) {
      sets.push(`visible_if = $${sets.length + 1}`);
      params.push(visibleIfJson);
    }

    if (requiredIfJson !== undefined) {
      sets.push(`required_if = $${sets.length + 1}`);
      params.push(requiredIfJson);
    }

    if (hideIfJson !== undefined) {
      sets.push(`hide_if = $${sets.length + 1}`);
      params.push(hideIfJson);
    }

    if (!sets.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "Nada para actualizar" });
    }

    params.push(pregId);

    const query = `
      UPDATE ema.informe_pregunta
         SET ${sets.join(", ")}
       WHERE id_pregunta = $${params.length}
       RETURNING *`;

    const upd = await client.query(query, params);

    await client.query("COMMIT");
    return res.json({ ok: true, pregunta: upd.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updatePregunta error:", err);

    if (String(err?.code) === "23505") {
      return res.status(409).json({ ok: false, error: "Conflicto de orden. Reintente." });
    }

    return res.status(500).json({ ok: false, error: "Error al actualizar pregunta" });
  } finally {
    client.release();
  }
}

// PUT /api/informes/preguntas/:idPregunta/mover
async function moverPregunta(req, res) {
  const { idPregunta } = req.params;
  const { to_seccion_id, to_orden } = req.body;

  const idPreg = Number(idPregunta);
  const toSec = Number(to_seccion_id);
  let toOrd = Number(to_orden);

  if (!idPreg || !toSec || !toOrd) return res.status(400).json({ ok: false, error: "ParÃ¡metros invÃ¡lidos" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const curRes = await client.query(
      `SELECT id_pregunta, id_seccion, orden
       FROM ema.informe_pregunta
       WHERE id_pregunta = $1
       FOR UPDATE`,
      [idPreg]
    );
    if (!curRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Pregunta no encontrada" });
    }

    const fromSec = Number(curRes.rows[0].id_seccion);
    const fromOrd = Number(curRes.rows[0].orden);

    const cntRes = await client.query(
      `SELECT COALESCE(MAX(orden), 0) AS max_orden
       FROM ema.informe_pregunta
       WHERE id_seccion = $1`,
      [toSec]
    );
    const maxDest = Number(cntRes.rows[0].max_orden || 0);

    const maxAllowed = toSec === fromSec ? maxDest : maxDest + 1;
    if (toOrd < 1) toOrd = 1;
    if (toOrd > maxAllowed) toOrd = maxAllowed;

    const tempOrden = -1000000 - idPreg;

    await client.query(
      `UPDATE ema.informe_pregunta
       SET id_seccion = $1,
           orden = $2
       WHERE id_pregunta = $3`,
      [toSec, tempOrden, idPreg]
    );

    if (fromSec !== toSec) {
      await client.query(
        `UPDATE ema.informe_pregunta
         SET orden = orden - 1
         WHERE id_seccion = $1
           AND orden > $2`,
        [fromSec, fromOrd]
      );
    } else {
      if (toOrd > fromOrd) {
        await client.query(
          `UPDATE ema.informe_pregunta
           SET orden = orden - 1
           WHERE id_seccion = $1
             AND orden > $2
             AND orden <= $3`,
          [toSec, fromOrd, toOrd]
        );
      } else if (toOrd < fromOrd) {
        await client.query(
          `UPDATE ema.informe_pregunta
           SET orden = orden + 1
           WHERE id_seccion = $1
             AND orden >= $2
             AND orden < $3`,
          [toSec, toOrd, fromOrd]
        );
      }
    }

    if (fromSec !== toSec) {
      await client.query(
        `UPDATE ema.informe_pregunta
         SET orden = orden + 1
         WHERE id_seccion = $1
           AND orden >= $2`,
        [toSec, toOrd]
      );
    }

    await client.query(`UPDATE ema.informe_pregunta SET orden = $1 WHERE id_pregunta = $2`, [toOrd, idPreg]);

    await client.query("COMMIT");
    return res.json({ ok: true, id_pregunta: idPreg, id_seccion: toSec, orden: toOrd });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("moverPregunta error:", err);
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Conflicto de orden en la secciÃ³n destino" });
    return res.status(500).json({ ok: false, error: "Error al mover pregunta" });
  } finally {
    client.release();
  }
}

// DELETE /api/informes/preguntas/:id  (o :idPregunta)
async function deletePregunta(req, res) {
  const rawId = req.params.idPregunta ?? req.params.id;
  const idPregunta = Number(rawId);

  if (!Number.isFinite(idPregunta) || idPregunta <= 0) {
    return res.status(400).json({ ok: false, error: "ID invÃ¡lido" });
  }

  const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r1 = await client.query(
      `SELECT id_seccion, orden
         FROM ema.informe_pregunta
        WHERE id_pregunta = $1
        FOR UPDATE`,
      [idPregunta]
    );

    if (!r1.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Pregunta no encontrada" });
    }

    const idSeccion = Number(r1.rows[0].id_seccion);
    const orden = Number(r1.rows[0].orden);

    const fotos = await client.query(`SELECT ruta_archivo FROM ema.informe_foto WHERE id_pregunta = $1`, [idPregunta]);

    await client.query(`DELETE FROM ema.informe_respuesta WHERE id_pregunta = $1`, [idPregunta]);
    await client.query(`DELETE FROM ema.informe_foto WHERE id_pregunta = $1`, [idPregunta]);
    await client.query(`DELETE FROM ema.informe_pregunta WHERE id_pregunta = $1`, [idPregunta]);

    const OFFSET = 100000;

    await client.query(
      `UPDATE ema.informe_pregunta
          SET orden = orden + $3::int
        WHERE id_seccion = $1::int
          AND orden > $2::int`,
      [idSeccion, orden, OFFSET]
    );

    await client.query(
      `UPDATE ema.informe_pregunta
          SET orden = orden - ($3::int + 1)
        WHERE id_seccion = $1::int
          AND orden > ($2::int + $3::int)`,
      [idSeccion, orden, OFFSET]
    );

    await client.query("COMMIT");

    // Corte de seguridad: NO borrar fÃ­sico desde Informes.

    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    const msg = err?.detail || err?.message || "Error al eliminar pregunta";
    console.error("deletePregunta error:", err);
    return res.status(500).json({ ok: false, error: msg });
  } finally {
    client.release();
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ INFORMES LLENADOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  /**
   * âœ… Regla final de visibilidad:
   * - secVisible = evalCond(sec_visible_if) (si no hay => true)
   * - qHidden   = evalCond(q.hide_if)       (si no hay => false)
   * - qVisible  = evalCond(q.visible_if)    (si no hay => true)
   * - isVisible = secVisible && !qHidden && qVisible
   */
  function computeVisibility(q, answersObj) {
    const secVisible = q.sec_visible_if ? evalCond(q.sec_visible_if, answersObj) : true;
    const qHidden = q.hide_if ? evalCond(q.hide_if, answersObj) : false;
    const qVisibleByRule = q.visible_if ? evalCond(q.visible_if, answersObj) : true;
    return secVisible && !qHidden && qVisibleByRule;
  }

  function normalizeUniqueValue(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    return v.map((x) => normalizeUniqueValue(x)).join("|");
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).trim().toLowerCase();
    } catch {
      return String(v).trim().toLowerCase();
    }
  }
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

  function extractComparableAnswerValue(row) {
    if (row?.valor_texto !== null && row?.valor_texto !== undefined && row?.valor_texto !== "") {
      return row.valor_texto;
    }

    if (row?.valor_bool !== null && row?.valor_bool !== undefined) {
      return row.valor_bool;
    }

    if (row?.valor_json !== null && row?.valor_json !== undefined) {
      return row.valor_json;
    }

    return null;
  }

  async function validarPreguntasUnicas({
    client,
    idPlantilla,
    preguntasById,
    visibleSet,
    respuestasObj,
    excludeInformeId = null,
  }) {
    const errores = [];

    for (const qid of visibleSet) {
      const q = preguntasById.get(Number(qid));
      if (!q) continue;
      const isUniqueField = !!q?.es_unico;
      if (!isUniqueField) continue;

      const raw = _getAnswerValueFromObj(respuestasObj, qid);
      const val = _coerceValue(raw);

      if (raw === undefined || isEmptyAnswer(val)) continue;

      const valorNormalizado = normalizeUniqueValue(val);
      if (!valorNormalizado) continue;

      const params = [Number(idPlantilla), Number(qid)];
      let sql = `
        SELECT
          r.id_informe,
          r.id_pregunta,
          r.valor_texto,
          r.valor_bool,
          r.valor_json
        FROM ema.informe_respuesta r
        JOIN ema.informe i ON i.id_informe = r.id_informe
        WHERE i.id_plantilla = $1
          AND r.id_pregunta = $2
      `;

      if (excludeInformeId) {
        params.push(Number(excludeInformeId));
        sql += ` AND r.id_informe <> $3`;
      }

      const dupRes = await client.query(sql, params);

      const repetido = (dupRes.rows || []).find((row) => {
        const existente = extractComparableAnswerValue(row);
        const existenteNorm = normalizeUniqueValue(existente);
        return existenteNorm && existenteNorm === valorNormalizado;
      });

      if (repetido) {
        errores.push({
          id_pregunta: Number(qid),
          etiqueta: q?.etiqueta || null,
          valor: val,
          reason: "unique_field",
        });
      }
    }

    if (errores.length) {
      const e = new Error("Hay valores duplicados en campos marcados como unicos");
      e.statusCode = 409;
      e.details = errores;
      throw e;
    }
  }

  // POST /api/informes (crear)
  async function crearInforme(req, res) {
    const { id_plantilla, id_proyecto, titulo, respuestas } = req.body;
    
    let clientRequestId = String(req.body?.client_request_id || "").trim();
    if (!clientRequestId) {
      clientRequestId = generateClientRequestId();
      console.warn(`[Private Submit] client_request_id generado para request legacy: ${clientRequestId}`);
    }

    const idPlantilla = Number(id_plantilla);
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "id_plantilla inválido" });
    }

    const idProyecto = id_proyecto ? Number(id_proyecto) : null;
    if (id_proyecto && (!Number.isFinite(idProyecto) || idProyecto <= 0)) {
      return res.status(400).json({ ok: false, error: "id_proyecto inválido" });
    }

    let respuestasObj = {};
    try {
      if (respuestas) {
        respuestasObj = typeof respuestas === "string" ? JSON.parse(respuestas) : respuestas;
        if (!respuestasObj || typeof respuestasObj !== "object" || Array.isArray(respuestasObj)) {
          respuestasObj = {};
        }
      }
    } catch {
      respuestasObj = {};
    }

    const files = req.files || {};

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const qRes = await client.query(
        `
        SELECT
          q.id_pregunta,
          q.etiqueta,
          q.tipo,
          q.obligatorio,
          q.permite_foto,
          q.opciones_json,
          q.visible_if,
          q.required_if,
          q.hide_if,
          s.visible_if AS sec_visible_if
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ORDER BY s.orden, q.orden
        `,
        [idPlantilla]
      );

      const preguntas = qRes.rows || [];
      const preguntasById = new Map(preguntas.map((q) => [Number(q.id_pregunta), q]));

      const labelToId = {};
      for (const q of preguntas) {
        const key = String(q.etiqueta || q.titulo || "").trim().toLowerCase();
        if (key) labelToId[key] = Number(q.id_pregunta);
      }

      const semaforoPaletteMap = buildSemaforoPaletteMap(preguntas);

      function normText(s) {
        return String(s || "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      }

      function isPreguntaImagenLike(q) {
        const tipo = normText(q?.tipo);
        const etiqueta = normText(q?.etiqueta || q?.titulo || "");

        return (
          tipo === "imagen" ||
          tipo === "image" ||
          tipo === "foto" ||
          tipo === "photoupload" ||
          tipo === "vphoto" ||
          tipo === "archivo_imagen" ||
          etiqueta.includes("foto") ||
          etiqueta.includes("imagen") ||
          etiqueta.includes("capturada en movil") ||
          etiqueta.includes("capturada en móvil")
        );
      }

      const answersForRules = {};
      for (const [k, v] of Object.entries(respuestasObj || {})) {
        let idNum = Number(k);
        if (!Number.isFinite(idNum) || idNum <= 0) {
          const key = String(k || "").trim().toLowerCase();
          idNum = labelToId[key] || NaN;
        }
        if (Number.isFinite(idNum) && idNum > 0) answersForRules[idNum] = v;
      }

      const visibleSet = new Set();
      const requiredSet = new Set();
      const invalid = [];

      for (const q of preguntas) {
        const qid = Number(q.id_pregunta);

        const isVisible = computeVisibility(q, answersForRules);
        if (isVisible) visibleSet.add(qid);

        const requiredByRule = q.required_if ? evalCond(q.required_if, answersForRules) : false;
        const isRequired = isVisible && (!!q.obligatorio || requiredByRule);
        if (isRequired) requiredSet.add(qid);
      }

      function getRespuestaRawPorPregunta(qid) {
        if (Object.prototype.hasOwnProperty.call(respuestasObj, String(qid))) {
          return respuestasObj[String(qid)];
        }
        return _getAnswerValueFromObj(respuestasObj, qid);
      }

      function isNonEmptyImageLink(val) {
        if (val === null || val === undefined) return false;

        if (Array.isArray(val)) {
          return val.some((x) => isNonEmptyImageLink(x));
        }

        if (typeof val === "object") {
          if (typeof val.url === "string" && val.url.trim()) return true;
          if (typeof val.ruta === "string" && val.ruta.trim()) return true;
          if (typeof val.path === "string" && val.path.trim()) return true;
          return false;
        }

        if (typeof val === "string") {
          return !!val.trim();
        }

        return false;
      }

      function extractImageLinks(val) {
        if (val === null || val === undefined) return [];

        if (Array.isArray(val)) {
          return val
            .flatMap((x) => extractImageLinks(x))
            .map((x) => String(x || "").trim())
            .filter(Boolean);
        }

        if (typeof val === "object") {
          const candidates = [val.url, val.ruta, val.path];
          return candidates
            .flatMap((x) =>
              String(x || "")
                .split(/\r?\n|,/)
                .map((s) => s.trim())
            )
            .filter(Boolean);
        }

        if (typeof val === "string") {
          return val
            .split(/\r?\n|,/)
            .map((s) => s.trim())
            .filter(Boolean);
        }

        return [];
      }

      // required no-imagen
      for (const qid of requiredSet) {
        const q = preguntasById.get(qid);
        if (!q) continue;

        if (isPreguntaImagenLike(q)) continue;

        const raw = getRespuestaRawPorPregunta(qid);
        const val = _coerceValue(raw);

        if (raw === undefined || isEmptyAnswer(val)) {
          invalid.push({ id_pregunta: qid, etiqueta: q?.etiqueta, reason: "required" });
        }
      }

      // required imagen
      for (const qid of requiredSet) {
        const q = preguntasById.get(qid);
        if (!q) continue;
        if (!isPreguntaImagenLike(q)) continue;

        const field = `fotos_${qid}`;
        const tieneArchivos = !!files?.[field];

        const raw = getRespuestaRawPorPregunta(qid);
        const tieneLink = isNonEmptyImageLink(raw);

        if (!tieneArchivos && !tieneLink) {
          invalid.push({ id_pregunta: qid, etiqueta: q?.etiqueta, reason: "required_imagen" });
        }
      }

      if (invalid.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "Faltan respuestas obligatorias (incluye condicionales)",
          detalles: invalid,
        });
      }

      await validarPreguntasUnicas({
        client,
        idPlantilla,
        preguntasById,
        visibleSet,
        respuestasObj,
        excludeInformeId: null,
      });

      const infRes = await client.query(
        `
        INSERT INTO ema.informe (id_plantilla, id_proyecto, titulo, client_request_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [idPlantilla, idProyecto, titulo || null, clientRequestId]
      );

      const informe = infRes.rows[0];
      const idInforme = informe.id_informe;

      // guardar respuestas normales
      for (const [idPreguntaStr, valorRaw] of Object.entries(respuestasObj || {})) {
        const idPregunta = Number(idPreguntaStr);
        if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

        const q = preguntasById.get(idPregunta);
        if (!q) continue;
        if (!visibleSet.has(idPregunta)) continue;

        if (isPreguntaImagenLike(q)) {
          continue;
        }

        const valor = normalizeAnswerForSaveByTipo(q.tipo, valorRaw);

        let valorTexto = null;
        let valorBool = null;
        let valorJson = null;

        if (String(q.tipo || "").trim().toLowerCase() === "semaforo") {
          const obj = semaforoToObj(valor, semaforoPaletteMap);
          if (obj && obj.hex) {
            valorTexto = obj.nombre || null;
            valorJson = { nombre: obj.nombre || null, hex: obj.hex };
          } else {
            const t = toJsonbOrText(valor);
            valorTexto = t.valor_texto;
            valorBool = t.valor_bool;
            valorJson = t.valor_json;
          }
        } else {
          const t = toJsonbOrText(valor);
          valorTexto = t.valor_texto;
          valorBool = t.valor_bool;
          valorJson = t.valor_json;
        }

        await client.query(
          `
          INSERT INTO ema.informe_respuesta
            (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [idInforme, idPregunta, valorTexto, valorBool, valorJson]
        );
      }

      // carpeta archivos físicos
      const uploadsRoot = path.join(__dirname, "..", "uploads");
      const baseDir = path.join(
        uploadsRoot,
        "proyectos",
        String(idProyecto || "sin_proyecto"),
        "informes",
        String(idInforme)
      );
      await fs.promises.mkdir(baseDir, { recursive: true });

      // guardar links/rutas en informe_foto
      for (const [idPreguntaStr, valorRaw] of Object.entries(respuestasObj || {})) {
        const idPregunta = Number(idPreguntaStr);
        if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

        const q = preguntasById.get(idPregunta);
        if (!q) continue;
        if (!visibleSet.has(idPregunta)) continue;

        const esImagen = isPreguntaImagenLike(q);
        const permite = !!q.permite_foto || esImagen;
        if (!permite) continue;

        const links = extractImageLinks(valorRaw);
        if (!links.length) continue;

        let ordenFoto = 1;

        for (const link of links) {
          await client.query(
            `
            INSERT INTO ema.informe_foto
              (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [idInforme, idPregunta, null, link, ordenFoto]
          );

          ordenFoto++;
        }
      }

      // subir fotos físicas
      for (const [fieldName, fileOrFiles] of Object.entries(files)) {
        if (!fieldName.startsWith("fotos_")) continue;

        const idPregunta = Number(fieldName.replace("fotos_", ""));
        if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

        const q = preguntasById.get(idPregunta);
        if (!q) continue;
        if (!visibleSet.has(idPregunta)) continue;

        const permite = !!q.permite_foto || isPreguntaImagenLike(q);
        if (!permite) continue;

        const countPrev = await client.query(
          `
          SELECT COUNT(*)::int AS total
          FROM ema.informe_foto
          WHERE id_informe = $1 AND id_pregunta = $2
          `,
          [idInforme, idPregunta]
        );

        let ordenFoto = Number(countPrev.rows?.[0]?.total || 0) + 1;

        const archivos = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];

        for (const f of archivos) {
          const safeName = sanitizeFilename(f.name || "foto.jpg");
          const safeExt = pickSafeImageExt(safeName, f.mimetype);
          if (!safeExt) throw new Error("Tipo de archivo no permitido (solo jpg/png/webp)");

          const nombreArchivo = `preg_${idPregunta}_foto_${ordenFoto}${safeExt}`;
          const destinoAbs = path.join(baseDir, nombreArchivo);

          const finalAbs = await safeSaveUpload(f, destinoAbs);
          const destinoRel = path.relative(uploadsRoot, finalAbs).replace(/\\/g, "/");

          await client.query(
            `
            INSERT INTO ema.informe_foto
              (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [idInforme, idPregunta, null, destinoRel, ordenFoto]
          );

          ordenFoto++;
        }
      }
      
      // =========================
      // MOTOR DE SCORING (DINÁMICO)
      // =========================
      // Auditoría: Resolvemos id_registro internamente para asegurar que el scoring corra 
      // siempre que exista una fórmula activa, sin depender del body.
      try {
        const regRes = await client.query(
          `INSERT INTO ema.informe_registro (id_informe) VALUES ($1) RETURNING id_registro`,
          [idInforme]
        );
        const idRegistro = regRes.rows[0].id_registro;
        await scoringEngine.runScoring(idRegistro, client);
      } catch (scoringErr) {
        console.error("Scoring engine error (create):", scoringErr.message);
      }

      await client.query("COMMIT");

      return res.status(201).json({ ok: true, id_informe: idInforme });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("crearInforme error:", err);

      const status = Number(err?.statusCode) || 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Error al crear informe",
        ...(err?.details ? { detalles: err.details } : {}),
      });
    } finally {
      client.release();
    }
  }

  // GET /api/informes/:id (detalle)
  async function getInforme(req, res) {
    const { id } = req.params;
    try {
      const infRes = await pool.query(
        `SELECT i.*, p.nombre AS nombre_plantilla
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        WHERE i.id_informe = $1`,
        [id]
      );
      if (!infRes.rowCount) return res.status(404).json({ ok: false, error: "Informe no encontrado" });
      const informe = infRes.rows[0];

      const { rows: secciones } = await pool.query(
        `SELECT *
        FROM ema.informe_seccion
        WHERE id_plantilla = $1
        ORDER BY orden`,
        [informe.id_plantilla]
      );

      const { rows: preguntas } = await pool.query(
        `SELECT q.*
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ORDER BY s.orden, q.orden`,
        [informe.id_plantilla]
      );

      const { rows: respuestas } = await pool.query(
        `SELECT r.*, q.id_seccion
        FROM ema.informe_respuesta r
        JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
        WHERE r.id_informe = $1`,
        [id]
      );

      const { rows: fotos } = await pool.query(
        `SELECT *
        FROM ema.informe_foto
        WHERE id_informe = $1
        ORDER BY orden`,
        [id]
      );

      return res.json({ ok: true, informe, secciones, preguntas, respuestas, fotos });
    } catch (err) {
      console.error("getInforme error:", err);
      return res.status(500).json({ ok: false, error: "Error al obtener informe" });
    }
  }

  // GET /api/informes/:id/pdf
  async function generarPdf(req, res) {
    const { id } = req.params;
    try {
      const infRes = await pool.query(
        `SELECT i.*, p.nombre AS nombre_plantilla
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        WHERE i.id_informe = $1`,
        [id]
      );
      if (!infRes.rowCount) return res.status(404).send("Informe no encontrado");
      const informe = infRes.rows[0];

      const { rows: secciones } = await pool.query(
        `SELECT *
        FROM ema.informe_seccion
        WHERE id_plantilla = $1
        ORDER BY orden`,
        [informe.id_plantilla]
      );

      const { rows: preguntas } = await pool.query(
        `SELECT q.*
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ORDER BY s.orden, q.orden`,
        [informe.id_plantilla]
      );

      const { rows: respuestas } = await pool.query(
        `SELECT r.*, q.id_seccion
        FROM ema.informe_respuesta r
        JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
        WHERE r.id_informe = $1`,
        [id]
      );

      const { rows: fotos } = await pool.query(
        `SELECT * FROM ema.informe_foto
        WHERE id_informe = $1
        ORDER BY orden`,
        [id]
      );

      const respuestasMap = {};
      for (const r of respuestas) {
        let val = r.valor_texto;

        if (r.valor_bool !== null && r.valor_bool !== undefined) {
          val = r.valor_bool ? "SÃ­" : "No";
        } else if (r.valor_json !== null && r.valor_json !== undefined) {
          try {
            const parsed = typeof r.valor_json === "string" ? JSON.parse(r.valor_json) : r.valor_json;
            val = Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
          } catch {
            val = String(r.valor_json);
          }
        }

        respuestasMap[r.id_pregunta] = val || "-";
      }

      const uploadsRoot = path.join(__dirname, "..", "uploads");

      const fotosPorPregunta = {};
      for (const f of fotos) {
        if (!f.id_pregunta) continue;

        const abs = path.join(uploadsRoot, String(f.ruta_archivo || "").replace(/\//g, path.sep));
        const dataUri = fileToDataUri(abs);
        if (!dataUri) continue;

        if (!fotosPorPregunta[f.id_pregunta]) fotosPorPregunta[f.id_pregunta] = [];
        fotosPorPregunta[f.id_pregunta].push({ descripcion: f.descripcion, dataUri });
      }

      const html = htmlTemplateInforme(informe, secciones, preguntas, respuestasMap, fotosPorPregunta);

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      try {
        const page = await browser.newPage();
        await page.emulateMediaType("screen");
        await page.setContent(html, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="Informe_${id}.pdf"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        return res.end(pdfBuffer);
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.error("generarPdf informe error:", err);
      return res.status(500).send("Error al generar PDF");
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    GET /api/informes/proyecto/:idProyecto/por-plantilla
    Devuelve plantillas usadas en el proyecto + sus informes
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function listPlantillasByProyecto(req, res) {
    const { idProyecto } = req.params;

    try {
      const idP = Number(idProyecto);
      if (!Number.isFinite(idP) || idP <= 0) {
        return res.status(400).json({ ok: false, error: "idProyecto inválido" });
      }

      // 1) Plantillas usadas (conteo + último + creador)
      const q1 = await pool.query(
        `
        SELECT
          p.id_plantilla,
          p.nombre,
          p.descripcion,
          p.id_creador,
          u.username AS creador_username,
          NULLIF(
            TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))),
            ''
          ) AS creador_nombre,
          COUNT(i.id_informe)::int AS total,
          MAX(i.fecha_creado) AS ultimo_informe
        FROM ema.informe i
        JOIN ema.informe_plantilla p
          ON p.id_plantilla = i.id_plantilla
        LEFT JOIN public.users u
          ON u.id = p.id_creador
        WHERE i.id_proyecto = $1
        GROUP BY
          p.id_plantilla,
          p.nombre,
          p.descripcion,
          p.id_creador,
          u.username,
          u.first_name,
          u.last_name
        ORDER BY MAX(i.fecha_creado) DESC NULLS LAST, p.id_plantilla DESC
        `,
        [idP]
      );

      if (!q1.rowCount) {
        return res.json({ ok: true, items: [] });
      }

      // 2) Informes por plantilla
      const q2 = await pool.query(
        `
        SELECT
          i.id_informe,
          i.id_plantilla,
          i.titulo,
          i.fecha_creado
        FROM ema.informe i
        WHERE i.id_proyecto = $1
        ORDER BY i.fecha_creado DESC NULLS LAST, i.id_informe DESC
        `,
        [idP]
      );

      const map = new Map();

      for (const r of q1.rows) {
        map.set(Number(r.id_plantilla), {
          id_plantilla: Number(r.id_plantilla),
          nombre: r.nombre,
          descripcion: r.descripcion || null,
          id_creador: r.id_creador ? Number(r.id_creador) : null,
          creador_username: r.creador_username || null,
          creador_nombre: r.creador_nombre || null,
          total: Number(r.total || 0),
          ultimo_informe: r.ultimo_informe,
          informes: [],
        });
      }

      for (const inf of q2.rows) {
        const idPl = Number(inf.id_plantilla);
        const bucket = map.get(idPl);
        if (!bucket) continue;

        bucket.informes.push({
          id_informe: Number(inf.id_informe),
          titulo: inf.titulo || `Informe #${inf.id_informe}`,
          fecha_creado: inf.fecha_creado,
        });
      }

      return res.json({ ok: true, items: Array.from(map.values()) });
    } catch (err) {
      console.error("listPlantillasByProyecto error:", err);
      return res.status(500).json({
        ok: false,
        error: "Error al listar plantillas por proyecto",
      });
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    2) GET /api/informes/proyecto/:idProyecto?plantilla=ID
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function listInformesByProyecto(req, res) {
    const { idProyecto } = req.params;
    const { id: userId, tipo_usuario } = req.user || {};
    const isAdmin = Number(tipo_usuario) === 1;
    const { plantilla } = req.query;

    try {
      const { buildInformeVisibleScope } = require("../helpers/informesDashboardScope");
      const baseParams = [idProyecto];
      const scope = buildInformeVisibleScope({
        userId,
        isAdmin,
        plantillaId: plantilla,
        startIndex: baseParams.length + 1,
      });
      const params = baseParams.concat(scope.params);

      const q = `
        SELECT
          i.*,
          p.nombre AS nombre_plantilla,
          ir.id_registro,
          fr.score_total,
          COALESCE(fr.resultado_consultor, fr.clasificacion) as clasificacion,
          fr.manual_override,
          fr.cambio_detectado,
          fr.fecha_recalculo,
          (
            SELECT jsonb_object_agg(q_vis.etiqueta, 
              CASE 
                WHEN q_vis.tipo IN ('semaforo', 'select') THEN 
                  COALESCE(r_vis.valor_json->>'label', r_vis.valor_texto, r_vis.valor_json::text)
                WHEN q_vis.tipo = 'multiselect' THEN 
                  (
                    SELECT string_agg(item->>'label', ', ')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r_vis.valor_json) = 'array' THEN r_vis.valor_json ELSE '[]'::jsonb END) AS item
                  )
                ELSE COALESCE(r_vis.valor_texto, r_vis.valor_json::text)
              END
            )
            FROM ema.informe_respuesta r_vis
            JOIN ema.informe_pregunta q_vis ON q_vis.id_pregunta = r_vis.id_pregunta
            WHERE r_vis.id_informe = i.id_informe 
              AND q_vis.visible_en_listado = true
          ) as respuestas_clave
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
        LEFT JOIN ema.formula_resultado fr ON fr.id_registro = ir.id_registro
          AND fr.id_formula = (SELECT id_formula FROM ema.formula f WHERE f.id_plantilla = p.id_plantilla AND f.activo = true ORDER BY f.version DESC LIMIT 1)
        LEFT JOIN ema.informe_plantilla_usuario pu
          ON pu.id_plantilla = p.id_plantilla
        AND pu.id_usuario = $${scope.userParamIndex}
        WHERE i.id_proyecto = $1
        ${scope.whereSql}
        ORDER BY i.fecha_creado DESC, i.id_informe DESC
      `;

      const { rows } = await pool.query(q, params);
      return res.json({ ok: true, informes: rows });
    } catch (err) {
      console.error("âŒ listInformesByProyecto error:", err.message);
      return res.json({ ok: true, informes: [] });
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    GET /api/informes/proyecto/:idProyecto/puntos?plantilla=ID&informe=ID
    âœ… Incluye: id_plantilla + nombre_plantilla
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function getInformesPuntosGeojson(req, res) {
    const { idProyecto } = req.params;
      const { plantilla, informe } = req.query;

      try {
        const idP = Number(idProyecto);
        if (!Number.isFinite(idP) || idP <= 0) {
          return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });
        }

        const params = [idP];
        let whereExtra = "";

        // filtro por plantilla
        if (plantilla != null && String(plantilla).trim() !== "") {
          const idPlant = Number(plantilla);
          if (!Number.isFinite(idPlant) || idPlant <= 0) {
            return res.status(400).json({ ok: false, error: "plantilla invÃ¡lida" });
          }
          params.push(idPlant);
          whereExtra += ` AND i.id_plantilla = $${params.length} `;
        }

        // filtro por informe
        if (informe != null && String(informe).trim() !== "") {
          const idInf = Number(informe);
          if (!Number.isFinite(idInf) || idInf <= 0) {
            return res.status(400).json({ ok: false, error: "informe invÃ¡lido" });
          }
          params.push(idInf);
          whereExtra += ` AND i.id_informe = $${params.length} `;
        }

        const { rows } = await pool.query(
          `
          SELECT
            i.id_informe,
            i.id_proyecto,
            i.id_plantilla,
            i.titulo,
            i.fecha_creado,

            p.nombre AS nombre_plantilla,

            MAX(
              CASE
                WHEN UPPER(q.etiqueta) LIKE '%LAT%' OR UPPER(q.etiqueta) LIKE '%LATITUD%'
                THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
              END
            ) AS lat_raw,

            MAX(
              CASE
                WHEN UPPER(q.etiqueta) LIKE '%LON%'
                  OR UPPER(q.etiqueta) LIKE '%LONG%'
                  OR UPPER(q.etiqueta) LIKE '%LONGITUD%'
                THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
              END
            ) AS lng_raw,

            MAX(
              CASE
                WHEN UPPER(q.etiqueta) LIKE '%UBICAC%'
                  OR UPPER(q.etiqueta) LIKE '%UBICACION%'
                  OR UPPER(q.etiqueta) LIKE '%MAPA%'
                  OR LOWER(TRIM(q.tipo)) IN ('mapa','coordenadas','coordenada')
                THEN r.valor_json::text
              END
            ) AS ubic_map_json_text,

            MAX(
              CASE
                WHEN UPPER(q.etiqueta) LIKE '%UBICAC%'
                  OR UPPER(q.etiqueta) LIKE '%UBICACION%'
                  OR UPPER(q.etiqueta) LIKE '%MAPA%'
                  OR LOWER(TRIM(q.tipo)) IN ('mapa','coordenadas','coordenada')
                THEN r.valor_texto
              END
            ) AS ubic_map_text,

            MAX(
              CASE
                WHEN LOWER(TRIM(q.tipo)) = 'semaforo'
                  OR UPPER(q.etiqueta) LIKE '%SEMAFORO%'
                THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
              END
            ) AS semaforo_raw

          FROM ema.informe i
          JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
          JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
          JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
          WHERE i.id_proyecto = $1
          ${whereExtra}
          GROUP BY
            i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado, p.nombre
          ORDER BY i.fecha_creado DESC, i.id_informe DESC
          `,
          params
        );

        const normalizeSemaforo = (raw) => {
          if (raw == null) return { color: null, label: null };

          const s = String(raw).trim();
          if (!s) return { color: null, label: null };

          try {
            const j = JSON.parse(s);

            if (j && typeof j === "object" && !Array.isArray(j)) {
              const color = j.color ?? j.hex ?? j.value ?? j.valor ?? null;
              const label = j.label ?? j.text ?? j.nombre ?? j.name ?? null;
              return {
                color: color != null ? String(color).trim() : null,
                label: label != null ? String(label).trim() : null,
              };
            }

            if (Array.isArray(j) && j.length >= 1) {
              const a = j.map((x) => (x == null ? "" : String(x).trim()));
              const maybeHex = a.find((x) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(x));
              const maybeLabel = a.find((x) => x && x !== maybeHex);
              return { color: maybeHex || null, label: maybeLabel || null };
            }
          } catch {}

          const parts = s.split("|").map((x) => x.trim()).filter(Boolean);
          if (parts.length >= 1) {
            const hex = parts.find((x) => /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(x)) || null;
            const label = parts.find((x) => x && x !== hex) || null;
            return { color: hex || (label ? label : null), label };
          }

          return { color: s, label: null };
        };

        const features = [];

        for (const r of rows) {
          if (Number(r.id_plantilla) === 12) {
    }

        const ubicRaw = r.ubic_map_json_text ?? r.ubic_map_text;
        const parsed = parseInformeLatLng(r.lat_raw, r.lng_raw, ubicRaw);
        if (!parsed) continue;

        const { lat, lng } = parsed;
        if (lat < -90 || lat > 90) continue;
        if (lng < -180 || lng > 180) continue;

        const sem = normalizeSemaforo(r.semaforo_raw);

        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            id_informe: Number(r.id_informe),
            id_proyecto: Number(r.id_proyecto),

            // âœ… lo que pediste:
            id_plantilla: Number(r.id_plantilla),
            nombre_plantilla: r.nombre_plantilla,

            // (compat) si ya usabas "plantilla" en el front:
            plantilla: r.nombre_plantilla,

            titulo: r.titulo,
            fecha_creado: r.fecha_creado,
            lat,
            lng,
            semaforo_color: sem.color,
            semaforo_label: sem.label,
          },
        });
      }

      return res.json({ ok: true, type: "FeatureCollection", features });
    } catch (err) {
      console.error("getInformesPuntosGeojson error:", err);
      return res.status(500).json({
        ok: false,
        error: err?.detail || err?.message || "Error al generar puntos (GeoJSON) de informes",
      });
    }
  }

  // PUT /api/informes/:id
  async function actualizarInforme(req, res) {
    const { id } = req.params;
    const { titulo, respuestas, delete_fotos_json } = req.body;

    const idInforme = Number(id);
    if (!Number.isFinite(idInforme) || idInforme <= 0) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    let respuestasObj = undefined;
    if (respuestas !== undefined) {
      try {
        respuestasObj =
          typeof respuestas === "string" ? JSON.parse(respuestas || "{}") : respuestas || {};
        if (!respuestasObj || typeof respuestasObj !== "object" || Array.isArray(respuestasObj)) {
          respuestasObj = {};
        }
      } catch {
        respuestasObj = {};
      }
    }

    let deleteIds = [];
    try {
      if (delete_fotos_json) {
        deleteIds =
          typeof delete_fotos_json === "string"
            ? JSON.parse(delete_fotos_json)
            : delete_fotos_json;

        if (!Array.isArray(deleteIds)) deleteIds = [];

        deleteIds = deleteIds
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);
      }
    } catch {
      deleteIds = [];
    }

    const files = req.files || {};
    const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const infRes = await client.query(
        "SELECT * FROM ema.informe WHERE id_informe = $1 FOR UPDATE",
        [idInforme]
      );

      if (!infRes.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Informe no encontrado" });
      }

      const informe = infRes.rows[0];

      if (titulo !== undefined) {
        await client.query(
          `
          UPDATE ema.informe
            SET titulo = COALESCE($1, titulo)
          WHERE id_informe = $2
          `,
          [titulo || null, idInforme]
        );
      }

      const qRes = await client.query(
        `
        SELECT
          q.id_pregunta,
          q.etiqueta,
          q.tipo,
          q.obligatorio,
          q.permite_foto,
          q.opciones_json,
          q.visible_if,
          q.required_if,
          q.hide_if,
          s.id_seccion,
          s.titulo AS seccion_titulo,
          s.orden AS seccion_orden,
          s.visible_if AS sec_visible_if
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ORDER BY s.orden, q.orden
        `,
        [Number(informe.id_plantilla)]
      );

      const preguntas = qRes.rows || [];
      const preguntasById = new Map(preguntas.map((q) => [Number(q.id_pregunta), q]));

      const labelToId = {};
      for (const q of preguntas) {
        const key = String(q.etiqueta || q.titulo || "").trim().toLowerCase();
        if (key) labelToId[key] = Number(q.id_pregunta);
      }

      const semaforoPaletteMap = buildSemaforoPaletteMap(preguntas);

      function normText(s) {
        return String(s || "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      }

      function isPreguntaImagenLike(q) {
        const tipo = normText(q?.tipo);
        const etiqueta = normText(q?.etiqueta || q?.titulo || "");

        return (
          tipo === "imagen" ||
          tipo === "image" ||
          tipo === "foto" ||
          tipo === "photoupload" ||
          tipo === "vphoto" ||
          tipo === "archivo_imagen" ||
          etiqueta.includes("foto") ||
          etiqueta.includes("imagen") ||
          etiqueta.includes("capturada en movil") ||
          etiqueta.includes("capturada en móvil")
        );
      }

      const answersForRules = {};
      if (respuestasObj !== undefined) {
        for (const [k, v] of Object.entries(respuestasObj || {})) {
          let idNum = Number(k);
          if (!Number.isFinite(idNum) || idNum <= 0) {
            const key = String(k || "").trim().toLowerCase();
            idNum = labelToId[key] || NaN;
          }
          if (Number.isFinite(idNum) && idNum > 0) {
            answersForRules[idNum] = v;
          }
        }
      }

      const visibleSet = new Set();
      const requiredSet = new Set();

      for (const q of preguntas) {
        const qid = Number(q.id_pregunta);

        const isVisible = computeVisibility(q, answersForRules);
        if (isVisible) visibleSet.add(qid);

        const requiredByRule = q.required_if ? evalCond(q.required_if, answersForRules) : false;
        const isRequired = isVisible && (!!q.obligatorio || requiredByRule);
        if (isRequired) requiredSet.add(qid);
      }

      function getRespuestaRawPorPregunta(qid) {
        if (respuestasObj === undefined) return undefined;

        if (Object.prototype.hasOwnProperty.call(respuestasObj, String(qid))) {
          return respuestasObj[String(qid)];
        }

        return _getAnswerValueFromObj(respuestasObj, qid);
      }

      function isNonEmptyImageLink(val) {
        if (val === null || val === undefined) return false;

        if (Array.isArray(val)) {
          return val.some((x) => isNonEmptyImageLink(x));
        }

        if (typeof val === "object") {
          if (typeof val.url === "string" && val.url.trim()) return true;
          if (typeof val.ruta === "string" && val.ruta.trim()) return true;
          if (typeof val.path === "string" && val.path.trim()) return true;
          return false;
        }

        if (typeof val === "string") {
          return !!val.trim();
        }

        return false;
      }

      function extractImageLinks(val) {
        if (val === null || val === undefined) return [];

        if (Array.isArray(val)) {
          return val
            .flatMap((x) => extractImageLinks(x))
            .map((x) => String(x || "").trim())
            .filter(Boolean);
        }

        if (typeof val === "object") {
          const candidates = [val.url, val.ruta, val.path];
          return candidates
            .flatMap((x) =>
              String(x || "")
                .split(/\r?\n|,/)
                .map((s) => s.trim())
            )
            .filter(Boolean);
        }

        if (typeof val === "string") {
          return val
            .split(/\r?\n|,/)
            .map((s) => s.trim())
            .filter(Boolean);
        }

        return [];
      }

      function isExternalUrl(value) {
        return /^https?:\/\//i.test(String(value || "").trim());
      }

      // =========================
      // VALIDACIÓN REQUIRED
      // =========================
      if (respuestasObj !== undefined) {
        const invalid = [];

        // Required no imagen
        for (const qid of requiredSet) {
          const q = preguntasById.get(qid);
          if (!q) continue;
          if (isPreguntaImagenLike(q)) continue;

          const raw = getRespuestaRawPorPregunta(qid);
          const val = _coerceValue(raw);

          if (raw === undefined || isEmptyAnswer(val)) {
            invalid.push({ id_pregunta: qid, etiqueta: q?.etiqueta, reason: "required" });
          }
        }

        // Required imagen = existentes no borradas + links nuevos + archivos nuevos
        for (const qid of requiredSet) {
          const q = preguntasById.get(qid);
          if (!q) continue;
          if (!isPreguntaImagenLike(q)) continue;

          const curFotos = await client.query(
            `
            SELECT id_foto
            FROM ema.informe_foto
            WHERE id_informe = $1 AND id_pregunta = $2
            `,
            [idInforme, qid]
          );

          const actuales = (curFotos.rows || []).map((r) => Number(r.id_foto));
          const borradas = new Set(deleteIds);

          const quedanDespuesDeBorrar = actuales.filter((fid) => !borradas.has(fid)).length;

          const field = `fotos_${qid}`;
          const newUploads = files?.[field]
            ? (Array.isArray(files[field]) ? files[field].length : 1)
            : 0;

          const raw = getRespuestaRawPorPregunta(qid);
          const nuevosLinks = extractImageLinks(raw).length;

          const totalFinal = quedanDespuesDeBorrar + newUploads + nuevosLinks;

          if (totalFinal <= 0) {
            invalid.push({ id_pregunta: qid, etiqueta: q?.etiqueta, reason: "required_imagen" });
          }
        }

        if (invalid.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            error: "Faltan respuestas obligatorias (incluye condicionales)",
            detalles: invalid,
          });
        }

        await validarPreguntasUnicas({
          client,
          idPlantilla: Number(informe.id_plantilla),
          preguntasById,
          visibleSet,
          respuestasObj,
          excludeInformeId: idInforme,
        });
      }

      // =========================
      // BORRADO DE FOTOS (DB + FS)
      // =========================
      if (deleteIds.length) {
        const { rows: fotosDel } = await client.query(
          `
          SELECT id_foto, ruta_archivo
          FROM ema.informe_foto
          WHERE id_informe = $1 AND id_foto = ANY($2::int[])
          `,
          [idInforme, deleteIds]
        );

        await client.query(
          `
          DELETE FROM ema.informe_foto
          WHERE id_informe = $1 AND id_foto = ANY($2::int[])
          `,
          [idInforme, deleteIds]
        );

        // Corte de seguridad: NO borrar fÃ­sico desde Informes.
      }

      // =========================
      // REEMPLAZO DE RESPUESTAS
      // =========================
      if (respuestasObj !== undefined) {
        await client.query("DELETE FROM ema.informe_respuesta WHERE id_informe = $1", [idInforme]);

        for (const [idPreguntaStr, valorRaw] of Object.entries(respuestasObj || {})) {
          let idPregunta = Number(idPreguntaStr);
          if (!Number.isFinite(idPregunta) || idPregunta <= 0) {
            const key = String(idPreguntaStr || "").trim().toLowerCase();
            idPregunta = labelToId[key] || NaN;
          }
          if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

          const q = preguntasById.get(idPregunta);
          if (!q) continue;
          if (!visibleSet.has(idPregunta)) continue;

          if (isPreguntaImagenLike(q)) {
            continue;
          }

          const valor = normalizeAnswerForSaveByTipo(q.tipo, valorRaw);

          let valorTexto = null;
          let valorBool = null;
          let valorJson = null;

          if (String(q.tipo || "").trim().toLowerCase() === "semaforo") {
            const obj = semaforoToObj(valor, semaforoPaletteMap);
            if (obj && obj.hex) {
              valorTexto = obj.nombre || null;
              valorJson = { nombre: obj.nombre || null, hex: obj.hex };
            } else {
              const t = toJsonbOrText(valor);
              valorTexto = t.valor_texto;
              valorBool = t.valor_bool;
              valorJson = t.valor_json;
            }
          } else {
            const t = toJsonbOrText(valor);
            valorTexto = t.valor_texto;
            valorBool = t.valor_bool;
            valorJson = t.valor_json;
          }

          await client.query(
            `
            INSERT INTO ema.informe_respuesta
              (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            `,
            [idInforme, idPregunta, valorTexto, valorBool, valorJson]
          );
        }
      }

      // =========================
      // CARPETA BASE
      // =========================
      const baseDir = path.join(
        uploadsRoot,
        "proyectos",
        String(informe.id_proyecto || "sin_proyecto"),
        "informes",
        String(idInforme)
      );
      await fs.promises.mkdir(baseDir, { recursive: true });

      // =========================
      // LINKS / RUTAS DE IMAGEN
      // =========================
      if (respuestasObj !== undefined) {
        for (const [idPreguntaStr, valorRaw] of Object.entries(respuestasObj || {})) {
          let idPregunta = Number(idPreguntaStr);
          if (!Number.isFinite(idPregunta) || idPregunta <= 0) {
            const key = String(idPreguntaStr || "").trim().toLowerCase();
            idPregunta = labelToId[key] || NaN;
          }
          if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

          const q = preguntasById.get(idPregunta);
          if (!q) continue;
          if (!visibleSet.has(idPregunta)) continue;

          const esImagen = isPreguntaImagenLike(q);
          const permite = !!q.permite_foto || esImagen;
          if (!permite) continue;

          const links = extractImageLinks(valorRaw);
          if (!links.length) continue;

          const last = await client.query(
            `
            SELECT COALESCE(MAX(orden),0) AS max_orden
            FROM ema.informe_foto
            WHERE id_informe = $1 AND id_pregunta = $2
            `,
            [idInforme, idPregunta]
          );

          let ordenFoto = Number(last.rows?.[0]?.max_orden || 0) + 1;

          for (const link of links) {
            await client.query(
              `
              INSERT INTO ema.informe_foto
                (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
              VALUES ($1, $2, $3, $4, $5)
              `,
              [idInforme, idPregunta, null, link, ordenFoto]
            );

            ordenFoto++;
          }
        }
      }

      // =========================
      // SUBIDA DE FOTOS FÍSICAS
      // =========================
      for (const [fieldName, fileOrFiles] of Object.entries(files)) {
        if (!fieldName.startsWith("fotos_")) continue;

        const idPregunta = Number(fieldName.replace("fotos_", ""));
        if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

        const q = preguntasById.get(idPregunta);
        if (!q) continue;
        if (!visibleSet.has(idPregunta)) continue;

        const permite = !!q.permite_foto || isPreguntaImagenLike(q);
        if (!permite) continue;

        const last = await client.query(
          `
          SELECT COALESCE(MAX(orden),0) AS max_orden
          FROM ema.informe_foto
          WHERE id_informe = $1 AND id_pregunta = $2
          `,
          [idInforme, idPregunta]
        );

        let ordenFoto = Number(last.rows?.[0]?.max_orden || 0) + 1;

        const archivos = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];

        for (const f of archivos) {
          const safeName = sanitizeFilename(f.name || "foto.jpg");
          const safeExt = pickSafeImageExt(safeName, f.mimetype);
          if (!safeExt) throw new Error("Tipo de archivo no permitido (solo jpg/png/webp)");

          const nombreArchivo = `preg_${idPregunta}_foto_${ordenFoto}${safeExt}`;
          const destinoAbs = path.join(baseDir, nombreArchivo);

          const finalAbs = await safeSaveUpload(f, destinoAbs);
          const destinoRel = path.relative(uploadsRoot, finalAbs).replace(/\\/g, "/");

          await client.query(
            `
            INSERT INTO ema.informe_foto
              (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [idInforme, idPregunta, null, destinoRel, ordenFoto]
          );

          ordenFoto++;
        }
      }

      // =========================
      // MOTOR DE SCORING (DINÁMICO)
      // =========================
      // Auditoría: Aseguramos que el registro exista y recalculamos el scoring.
      try {
        const regRes = await client.query(
          `SELECT id_registro FROM ema.informe_registro WHERE id_informe = $1 LIMIT 1`,
          [idInforme]
        );
        let idReg;
        if (regRes.rowCount > 0) {
          idReg = regRes.rows[0].id_registro;
        } else {
          const insReg = await client.query(
            `INSERT INTO ema.informe_registro (id_informe) VALUES ($1) RETURNING id_registro`,
            [idInforme]
          );
          idReg = insReg.rows[0].id_registro;
        }
        await scoringEngine.runScoring(idReg, client);
      } catch (scoringErr) {
        console.error("Scoring engine error (update):", scoringErr.message);
      }

      await client.query("COMMIT");

      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("actualizarInforme error:", err);

      const status = Number(err?.statusCode) || 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Error al actualizar informe",
        ...(err?.details ? { detalles: err.details } : {}),
      });
    } finally {
      client.release();
    }
  }

function firstNonEmpty(values = []) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return v;
    }
  }
  return "";
}

const CONSOLIDACION_DESTINO_TEXTUAL_TIPOS = new Set([
  "texto",
  "textarea",
  "text",
  "string",
  "short_text",
  "shorttext",
  "select",
  "radio",
  "select_single",
]);

const CONSOLIDACION_ORIGEN_BLOQUEADOS = new Set([
  "imagen",
  "image",
  "foto",
  "galeria",
  "gallery",
  "photoupload",
  "vphoto",
  "archivo_imagen",
]);

const CONSOLIDACION_CHOICES_TIPOS = new Set([
  "select",
  "radio",
  "select_single",
  "semaforo",
  "multiselect",
  "checkbox",
  "select_multiple",
]);

function normalizeConsolidacionTipo(tipo) {
  return String(tipo || "").trim().toLowerCase();
}

function isBlankConsolidacionText(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function parseJsonMaybe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeConsolidacionOptions(opcionesJson) {
  const parsed = parseJsonMaybe(opcionesJson);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((opt) => {
      if (typeof opt === "string") {
        const s = opt.trim();
        return s ? { value: s, label: s } : null;
      }

      if (!opt || typeof opt !== "object") return null;

      const value = String(
        opt.value ?? opt.valor ?? opt.id ?? opt.codigo ?? opt.label ?? opt.nombre ?? opt.titulo ?? ""
      ).trim();
      const label = String(
        opt.label ?? opt.nombre ?? opt.titulo ?? opt.text ?? opt.value ?? opt.valor ?? opt.id ?? ""
      ).trim();

      if (!value && !label) return null;

      return {
        value: value || label,
        label: label || value,
      };
    })
    .filter(Boolean)
    .filter((opt) => !isBlankConsolidacionText(opt.value));
}

function normalizeConsolidacionTextoLibre(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Sí" : "No";
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";

  if (Array.isArray(raw)) {
    return raw.map((x) => normalizeConsolidacionTextoLibre(x)).filter(Boolean).join(", ");
  }

  if (typeof raw === "object") {
    if ("lat" in raw || "lng" in raw || "latitude" in raw || "longitude" in raw) {
      const lat = raw.lat ?? raw.latitude ?? null;
      const lng = raw.lng ?? raw.longitude ?? null;
      const latTxt = normalizeConsolidacionTextoLibre(lat);
      const lngTxt = normalizeConsolidacionTextoLibre(lng);
      const out = [latTxt, lngTxt].filter(Boolean).join(", ");
      return out || "";
    }

    const labelLike =
      raw.label ?? raw.nombre ?? raw.name ?? raw.titulo ?? raw.text ?? raw.valor ?? null;
    if (!isBlankConsolidacionText(labelLike)) {
      return String(labelLike).trim();
    }

    const nested =
      Array.isArray(raw.items) ? raw.items :
      Array.isArray(raw.values) ? raw.values :
      Array.isArray(raw.options) ? raw.options :
      null;

    if (nested) {
      const txt = nested.map((x) => normalizeConsolidacionTextoLibre(x)).filter(Boolean).join(", ");
      if (txt) return txt;
    }

    try {
      const jsonTxt = JSON.stringify(raw);
      return jsonTxt === "{}" ? "" : jsonTxt;
    } catch {
      return "";
    }
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "";

    const parsed = parseJsonMaybe(s);
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
      return normalizeConsolidacionTextoLibre(parsed);
    }

    if (typeof parsed === "boolean") return parsed ? "Sí" : "No";
    if (typeof parsed === "number") return String(parsed);
    if (typeof parsed === "string") return parsed.trim();

    return s;
  }

  return String(raw).trim();
}

function normalizeConsolidacionRespuesta(question, row) {
  const opts = normalizeConsolidacionOptions(question?.opciones_json);
  const tipo = normalizeConsolidacionTipo(question?.tipo);

  const resolveAgainstOptions = (raw) => {
    const s = normalizeConsolidacionTextoLibre(raw);
    if (!s) return "";

    const sLower = s.toLowerCase();

    for (const opt of opts) {
      if (String(opt.value || "").trim().toLowerCase() === sLower) {
        return String(opt.label || opt.value || "").trim();
      }
      if (String(opt.label || "").trim().toLowerCase() === sLower) {
        return String(opt.label || opt.value || "").trim();
      }
    }

    if (CONSOLIDACION_CHOICES_TIPOS.has(tipo) && /^-?\d+(\.\d+)?$/.test(s)) {
      return "";
    }

    return s;
  };

  const resolveRaw = (raw) => {
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "boolean") return raw ? "Sí" : "No";
    if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";

    if (Array.isArray(raw)) {
      return raw.map((item) => resolveRaw(item)).filter(Boolean).join(", ");
    }

    if (typeof raw === "object") {
      if (tipo === "semaforo") {
        const nombre = raw.nombre ?? raw.label ?? raw.color_name ?? raw.name ?? raw.titulo ?? null;
        if (!isBlankConsolidacionText(nombre)) return String(nombre).trim();
      }

      const labelLike =
        raw.label ?? raw.nombre ?? raw.name ?? raw.titulo ?? raw.text ?? raw.value ?? raw.valor ?? null;
      if (!isBlankConsolidacionText(labelLike)) {
        const resolved = resolveAgainstOptions(labelLike);
        if (resolved) return resolved;
        if (!CONSOLIDACION_CHOICES_TIPOS.has(tipo)) {
          return String(labelLike).trim();
        }
      }

      if (Array.isArray(raw.items) || Array.isArray(raw.values) || Array.isArray(raw.options)) {
        const arr = raw.items || raw.values || raw.options || [];
        const txt = arr.map((item) => resolveRaw(item)).filter(Boolean).join(", ");
        if (txt) return txt;
      }

      const valueLike = raw.value ?? raw.id ?? raw.codigo ?? raw.valor ?? null;
      if (!isBlankConsolidacionText(valueLike)) {
        const resolved = resolveAgainstOptions(valueLike);
        if (resolved) return resolved;
        if (!CONSOLIDACION_CHOICES_TIPOS.has(tipo)) {
          return String(valueLike).trim();
        }
      }

      return normalizeConsolidacionTextoLibre(raw);
    }

    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return "";

      const parsed = parseJsonMaybe(s);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) {
        return resolveRaw(parsed);
      }

    if (typeof parsed === "boolean") return parsed ? "Sí" : "No";
    if (typeof parsed === "number") {
      if (CONSOLIDACION_CHOICES_TIPOS.has(tipo)) return "";
      return String(parsed);
    }
    if (typeof parsed === "string") {
      const parsedTrim = parsed.trim();
      if (CONSOLIDACION_CHOICES_TIPOS.has(tipo) && /^-?\d+(\.\d+)?$/.test(parsedTrim)) return "";
      return parsedTrim;
    }

      return resolveAgainstOptions(s);
    }

    return normalizeConsolidacionTextoLibre(raw);
  };

  const candidates = [];
  if (row?.valor_bool !== null && row?.valor_bool !== undefined) candidates.push(row.valor_bool);
  if (row?.valor_json !== null && row?.valor_json !== undefined) candidates.push(row.valor_json);
  if (row?.valor_texto !== null && row?.valor_texto !== undefined) candidates.push(row.valor_texto);

  for (const candidate of candidates) {
    const resolved = resolveRaw(candidate);
    if (!isBlankConsolidacionText(resolved)) return String(resolved).trim();
  }

  return "";
}

function isConsolidacionDestinoTextual(question) {
  return CONSOLIDACION_DESTINO_TEXTUAL_TIPOS.has(normalizeConsolidacionTipo(question?.tipo));
}

function isConsolidacionOrigenBloqueado(question) {
  return CONSOLIDACION_ORIGEN_BLOQUEADOS.has(normalizeConsolidacionTipo(question?.tipo));
}

async function buildConsolidacionPlan({
  db,
  req,
  idProyecto,
  idPlantilla,
  sourceFieldIds,
  targetFieldId,
  strategy,
  overwriteMode,
  exampleLimit = 10,
}) {
  const errors = [];

  const projectId = Number(idProyecto);
  const plantillaId = Number(idPlantilla);
  const targetId = Number(targetFieldId);

  let sourceInput = sourceFieldIds;
  if (typeof sourceInput === "string") {
    const parsed = parseJsonMaybe(sourceInput);
    if (Array.isArray(parsed)) {
      sourceInput = parsed;
    } else {
      sourceInput = sourceInput
        .split(/[,;]+/g)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  const sourceIds = [];
  for (const rawId of Array.isArray(sourceInput) ? sourceInput : []) {
    const n = Number(rawId);
    if (Number.isFinite(n) && n > 0 && !sourceIds.includes(n)) sourceIds.push(n);
  }

  const strategyNorm = String(strategy || "").trim().toLowerCase();
  const overwriteNorm = String(overwriteMode || "").trim().toLowerCase();

  if (!Number.isFinite(projectId) || projectId <= 0) {
    errors.push({ code: "invalid_project", message: "idProyecto inválido" });
  }

  if (!Number.isFinite(plantillaId) || plantillaId <= 0) {
    errors.push({ code: "invalid_plantilla", message: "idPlantilla inválido" });
  }

  if (!Number.isFinite(targetId) || targetId <= 0) {
    errors.push({ code: "invalid_target", message: "target_field_id inválido" });
  }

  if (!sourceIds.length) {
    errors.push({ code: "invalid_sources", message: "Debe indicar al menos un campo origen" });
  }

  if (!["first_non_empty", "concat_with_comma"].includes(strategyNorm)) {
    errors.push({ code: "invalid_strategy", message: "Estrategia inválida" });
  }

  if (!["empty_only", "force"].includes(overwriteNorm)) {
    errors.push({ code: "invalid_overwrite_mode", message: "overwrite_mode inválido" });
  }

  const allIds = Array.from(new Set([...sourceIds, targetId].filter((n) => Number.isFinite(n) && n > 0)));

  const { buildInformeVisibleScope } = require("../helpers/informesDashboardScope");
  const userId = req.user?.id ?? null;
  const isAdmin =
    Number(req.user?.tipo_usuario) === 1 || Number(req.user?.group_id) === 1;
  const scope = buildInformeVisibleScope({
    userId,
    isAdmin,
    startIndex: 3,
  });

  const qParams = [plantillaId, allIds];
  const { rows: questions } = await db.query(
    `
    SELECT
      q.*,
      s.id_plantilla
    FROM ema.informe_pregunta q
    JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
    WHERE s.id_plantilla = $1
      AND q.id_pregunta = ANY($2::int[])
    ORDER BY q.orden, q.id_pregunta
    `,
    qParams
  );

  const questionsById = new Map(questions.map((q) => [Number(q.id_pregunta), q]));
  const targetQuestion = questionsById.get(targetId) || null;
  const sourceQuestions = sourceIds.map((id) => questionsById.get(id)).filter(Boolean);

  const missingIds = allIds.filter((id) => !questionsById.has(id));
  if (missingIds.length) {
    errors.push({
      code: "fields_not_in_template",
      message: "Algunos campos no pertenecen a la plantilla activa",
      field_ids: missingIds,
    });
  }

  if (!targetQuestion) {
    errors.push({
      code: "target_not_found",
      message: "El campo destino no pertenece a la plantilla activa",
      field_id: targetId,
    });
  } else {
    if (!isConsolidacionDestinoTextual(targetQuestion)) {
      errors.push({
        code: "target_not_textual",
        message: "El campo destino debe ser textual",
        field_id: targetId,
        tipo: targetQuestion.tipo,
      });
    }

    if (!!targetQuestion.es_unico) {
      errors.push({
        code: "target_unique",
        message: "El campo destino es único y no se puede usar en esta iteración",
        field_id: targetId,
      });
    }
  }

  const sourceMap = new Map(sourceQuestions.map((q) => [Number(q.id_pregunta), q]));
  const blockedSources = sourceQuestions.filter((q) => isConsolidacionOrigenBloqueado(q));
  if (blockedSources.length) {
    errors.push({
      code: "source_not_resolvable",
      message: "Uno o más campos origen no pueden resolverse a texto visible",
      field_ids: blockedSources.map((q) => Number(q.id_pregunta)),
    });
  }

  if (sourceMap.has(targetId)) {
    errors.push({
      code: "target_in_sources",
      message: "El campo destino no puede estar incluido entre los campos origen",
      field_id: targetId,
    });
  }

  if (errors.length) {
    return {
      valid: false,
      errors,
      summary: {
        total_informes: 0,
        eligible: 0,
        with_changes: 0,
        skipped_no_source: 0,
        skipped_target_has_value: 0,
        conflicts: errors.length,
      },
      examples: [],
      rowsToWrite: [],
      targetQuestion,
      sourceQuestions,
    };
  }

  const visibleSql = `
    SELECT
      i.id_informe
    FROM ema.informe i
    JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    LEFT JOIN ema.informe_plantilla_usuario pu
      ON pu.id_plantilla = p.id_plantilla
     AND pu.id_usuario = $${scope.userParamIndex}
    WHERE i.id_proyecto = $1
      AND i.id_plantilla = $2
      ${scope.whereSql}
    ORDER BY i.id_informe ASC
  `;

  const { rows: informeRows } = await db.query(visibleSql, [projectId, plantillaId, ...scope.params]);
  const informeIds = informeRows.map((r) => Number(r.id_informe)).filter((n) => Number.isFinite(n) && n > 0);

  if (!informeIds.length) {
    return {
      valid: true,
      errors: [],
      summary: {
        total_informes: 0,
        eligible: 0,
        with_changes: 0,
        skipped_no_source: 0,
        skipped_target_has_value: 0,
        conflicts: 0,
      },
      examples: [],
      rowsToWrite: [],
      targetQuestion,
      sourceQuestions,
    };
  }

  const responseFieldIds = Array.from(new Set([...sourceIds, targetId]));
  const { rows: responseRows } = await db.query(
    `
    SELECT
      r.id_informe,
      r.id_pregunta,
      r.valor_texto,
      r.valor_bool,
      r.valor_json
    FROM ema.informe_respuesta r
    WHERE r.id_informe = ANY($1::int[])
      AND r.id_pregunta = ANY($2::int[])
    ORDER BY r.id_informe ASC, r.id_pregunta ASC
    `,
    [informeIds, responseFieldIds]
  );

  const responseByInforme = new Map();
  for (const idInf of informeIds) {
    responseByInforme.set(idInf, new Map());
  }

  for (const row of responseRows) {
    const idInf = Number(row.id_informe);
    const idPreg = Number(row.id_pregunta);
    if (!responseByInforme.has(idInf)) responseByInforme.set(idInf, new Map());
    responseByInforme.get(idInf).set(idPreg, row);
  }

  const summary = {
    total_informes: informeIds.length,
    eligible: 0,
    with_changes: 0,
    skipped_no_source: 0,
    skipped_target_has_value: 0,
    conflicts: 0,
  };

  const examples = [];
  const rowsToWrite = [];

  for (const idInforme of informeIds) {
    const rowMap = responseByInforme.get(idInforme) || new Map();
    const targetRow = rowMap.get(targetId) || null;
    const targetCurrentValue = normalizeConsolidacionRespuesta(targetQuestion, targetRow);

    const resolvedSources = sourceIds
      .map((idPregunta) => {
        const question = sourceMap.get(idPregunta);
        const row = rowMap.get(idPregunta) || null;
        const resolved = normalizeConsolidacionRespuesta(question, row);
        return {
          id_pregunta: idPregunta,
          label: question?.etiqueta || `Pregunta #${idPregunta}`,
          resolved,
        };
      })
      .filter((x) => !isBlankConsolidacionText(x.resolved));

    if (!resolvedSources.length) {
      summary.skipped_no_source += 1;
      continue;
    }

    summary.eligible += 1;

    if (overwriteNorm === "empty_only" && !isBlankConsolidacionText(targetCurrentValue)) {
      summary.skipped_target_has_value += 1;
      continue;
    }

    const resolvedValue =
      strategyNorm === "concat_with_comma"
        ? resolvedSources.map((x) => x.resolved).join(", ")
        : resolvedSources[0].resolved;

    if (isBlankConsolidacionText(resolvedValue)) {
      summary.skipped_no_source += 1;
      summary.eligible -= 1;
      continue;
    }

    summary.with_changes += 1;

    const item = {
      id_informe: idInforme,
      target_current_value: targetCurrentValue,
      resolved_value: resolvedValue,
      sources_used: resolvedSources.map(({ id_pregunta, label }) => ({ id_pregunta, label })),
      target_question_id: targetId,
    };

    rowsToWrite.push(item);

    if (examples.length < Number(exampleLimit || 10)) {
      examples.push({
        id_informe: idInforme,
        target_current_value: targetCurrentValue,
        resolved_value: resolvedValue,
        sources_used: resolvedSources.map(({ id_pregunta, label }) => ({ id_pregunta, label })),
      });
    }
  }

  return {
    valid: true,
    errors: [],
    summary,
    examples,
    rowsToWrite,
    targetQuestion,
    sourceQuestions,
  };
}

function normalizeExcelHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function valueFromCell(cell) {
  if (!cell) return null;

  const v = cell.value;

  if (v === null || v === undefined) return null;

  if (typeof v === "object") {
    if (v.text != null) return v.text;
    if (v.result != null) return v.result;
    if (v.richText && Array.isArray(v.richText)) {
      return v.richText.map((x) => x.text || "").join("");
    }
    if (v.hyperlink != null) return v.text || v.hyperlink;
  }

  return v;
}

// POST /api/informes/proyecto/:idProyecto/plantilla/:idPlantilla/import-excel-update
async function importExcelUpdateRespuestas(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = Number(req.params.idPlantilla);

  if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
    return res.status(400).json({ ok: false, error: "idProyecto inválido" });
  }

  if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
    return res.status(400).json({ ok: false, error: "idPlantilla inválido" });
  }

  // Se espera multipart/form-data
  // archivo Excel: req.file
  // campos:
  // match_mode: "id_informe" | "pregunta_referencia"
  // excel_match_column: nombre columna excel que contiene el identificador
  // id_pregunta_referencia: requerido si match_mode = "pregunta_referencia"
  // destination_mode: "pregunta_existente" | "nueva_pregunta"
  // id_pregunta_destino: requerido si destination_mode = "pregunta_existente"
  // id_seccion_destino, etiqueta_nueva_pregunta, tipo_nueva_pregunta: requeridos si destination_mode = "nueva_pregunta"
  // excel_columns_source: JSON array o string separado por coma con columnas a combinar
  // overwrite_empty_only: "1" | "0" opcional
  // order_nueva_pregunta: opcional

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({
      ok: false,
      error: "Debe adjuntar un archivo Excel",
    });
  }

  const matchMode = String(req.body?.match_mode || "id_informe").trim().toLowerCase();
  const excelMatchColumn = String(req.body?.excel_match_column || "").trim();
  const destinationMode = String(req.body?.destination_mode || "pregunta_existente")
    .trim()
    .toLowerCase();

  const idPreguntaReferencia = Number(req.body?.id_pregunta_referencia || 0);
  const idPreguntaDestinoBody = Number(req.body?.id_pregunta_destino || 0);

  const idSeccionDestino = Number(req.body?.id_seccion_destino || 0);
  const etiquetaNuevaPregunta = String(req.body?.etiqueta_nueva_pregunta || "").trim();
  const tipoNuevaPregunta = String(req.body?.tipo_nueva_pregunta || "texto").trim();

  const overwriteEmptyOnly =
    String(req.body?.overwrite_empty_only || "0").trim() === "1";

  let orderNuevaPregunta = Number(req.body?.order_nueva_pregunta || 0);

  let excelColumnsSource = req.body?.excel_columns_source;

  if (typeof excelColumnsSource === "string") {
    try {
      const parsed = JSON.parse(excelColumnsSource);
      if (Array.isArray(parsed)) {
        excelColumnsSource = parsed;
      } else {
        excelColumnsSource = excelColumnsSource
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
    } catch {
      excelColumnsSource = excelColumnsSource
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  if (!Array.isArray(excelColumnsSource) || excelColumnsSource.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Debe indicar al menos una columna origen del Excel",
    });
  }

  if (!excelMatchColumn) {
    return res.status(400).json({
      ok: false,
      error: "Debe indicar la columna del Excel para el cruce",
    });
  }

  if (!["id_informe", "pregunta_referencia"].includes(matchMode)) {
    return res.status(400).json({
      ok: false,
      error: "match_mode inválido. Use 'id_informe' o 'pregunta_referencia'",
    });
  }

  if (!["pregunta_existente", "nueva_pregunta"].includes(destinationMode)) {
    return res.status(400).json({
      ok: false,
      error: "destination_mode inválido. Use 'pregunta_existente' o 'nueva_pregunta'",
    });
  }

  if (matchMode === "pregunta_referencia" && (!Number.isFinite(idPreguntaReferencia) || idPreguntaReferencia <= 0)) {
    return res.status(400).json({
      ok: false,
      error: "Debe indicar id_pregunta_referencia",
    });
  }

  if (destinationMode === "pregunta_existente" && (!Number.isFinite(idPreguntaDestinoBody) || idPreguntaDestinoBody <= 0)) {
    return res.status(400).json({
      ok: false,
      error: "Debe indicar id_pregunta_destino",
    });
  }

  if (destinationMode === "nueva_pregunta") {
    if (!Number.isFinite(idSeccionDestino) || idSeccionDestino <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Debe indicar id_seccion_destino",
      });
    }

    if (!etiquetaNuevaPregunta) {
      return res.status(400).json({
        ok: false,
        error: "Debe indicar etiqueta_nueva_pregunta",
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) cargar secciones y preguntas de la plantilla
    const { rows: secciones } = await client.query(
      `
      SELECT id_seccion, titulo, orden
      FROM ema.informe_seccion
      WHERE id_plantilla = $1
      ORDER BY orden
      `,
      [idPlantilla]
    );

    const idSecciones = secciones.map((s) => Number(s.id_seccion)).filter(Boolean);
    const seccionesSet = new Set(idSecciones);

    const { rows: preguntas } = await client.query(
      `
      SELECT *
      FROM ema.informe_pregunta
      WHERE id_seccion = ANY($1::int[])
      ORDER BY id_seccion, orden, id_pregunta
      `,
      [idSecciones.length ? idSecciones : [0]]
    );

    const preguntasById = new Map(
      (preguntas || []).map((p) => [Number(p.id_pregunta), p])
    );

    const semaforoPaletteMap = buildSemaforoPaletteMap(preguntas || []);

    if (matchMode === "pregunta_referencia" && !preguntasById.has(idPreguntaReferencia)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: `La pregunta referencia ${idPreguntaReferencia} no pertenece a la plantilla`,
      });
    }

    let idPreguntaDestino = idPreguntaDestinoBody;

    if (destinationMode === "pregunta_existente") {
      const qDestino = preguntasById.get(idPreguntaDestino);
      if (!qDestino) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: `La pregunta destino ${idPreguntaDestino} no pertenece a la plantilla`,
        });
      }

      const tipoDestino = String(qDestino.tipo || "").trim().toLowerCase();
      if (["imagen", "foto", "galeria"].includes(tipoDestino)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "La pregunta destino no puede ser de tipo imagen/foto/galería",
        });
      }
    } else {
      if (!seccionesSet.has(idSeccionDestino)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: `La sección ${idSeccionDestino} no pertenece a la plantilla`,
        });
      }

      if (!Number.isFinite(orderNuevaPregunta) || orderNuevaPregunta <= 0) {
        const { rows: maxOrdRows } = await client.query(
          `
          SELECT COALESCE(MAX(orden), 0) AS max_orden
          FROM ema.informe_pregunta
          WHERE id_seccion = $1
          `,
          [idSeccionDestino]
        );
        orderNuevaPregunta = Number(maxOrdRows?.[0]?.max_orden || 0) + 1;
      }

      const insertPregunta = await client.query(
        `
        INSERT INTO ema.informe_pregunta
          (id_seccion, etiqueta, tipo, obligatorio, orden, permite_foto, activo)
        VALUES
          ($1, $2, $3, false, $4, false, true)
        RETURNING id_pregunta
        `,
        [idSeccionDestino, etiquetaNuevaPregunta, tipoNuevaPregunta, orderNuevaPregunta]
      );

      idPreguntaDestino = Number(insertPregunta.rows?.[0]?.id_pregunta || 0);

      if (!idPreguntaDestino) {
        await client.query("ROLLBACK");
        return res.status(500).json({
          ok: false,
          error: "No se pudo crear la nueva pregunta destino",
        });
      }

      preguntasById.set(idPreguntaDestino, {
        id_pregunta: idPreguntaDestino,
        id_seccion: idSeccionDestino,
        etiqueta: etiquetaNuevaPregunta,
        tipo: tipoNuevaPregunta,
      });
    }

    const preguntaDestino = preguntasById.get(idPreguntaDestino);

    // 2) cargar todos los informes de la plantilla
    const { rows: informesRows } = await client.query(
      `
      SELECT i.id_informe
      FROM ema.informe i
      WHERE i.id_proyecto = $1
        AND i.id_plantilla = $2
      ORDER BY i.id_informe
      `,
      [idProyecto, idPlantilla]
    );

    const idsInformesPlantilla = informesRows.map((r) => Number(r.id_informe)).filter(Boolean);

    if (!idsInformesPlantilla.length) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        error: null,
        message: "No hay informes para la plantilla",
        total_informes_plantilla: 0,
        total_filas_excel: 0,
        total_match: 0,
        total_actualizados: 0,
        id_pregunta_destino: idPreguntaDestino,
      });
    }

    // 3) si el match es por pregunta referencia, construir mapa valor -> id_informe
    const referenciaMap = new Map();

    if (matchMode === "pregunta_referencia") {
      const { rows: respRefRows } = await client.query(
        `
        SELECT
          r.id_informe,
          r.valor_texto,
          r.valor_bool,
          r.valor_json
        FROM ema.informe_respuesta r
        WHERE r.id_informe = ANY($1::int[])
          AND r.id_pregunta = $2
        `,
        [idsInformesPlantilla, idPreguntaReferencia]
      );

      for (const row of respRefRows) {
        let raw = null;

        if (row.valor_bool !== null && row.valor_bool !== undefined) {
          raw = row.valor_bool;
        } else if (row.valor_json !== null && row.valor_json !== undefined) {
          raw = row.valor_json;
        } else {
          raw = row.valor_texto;
        }

        const key = String(raw ?? "").trim().toLowerCase();
        if (!key) continue;

        if (!referenciaMap.has(key)) {
          referenciaMap.set(key, Number(row.id_informe));
        }
      }
    }

    // 4) leer Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "El archivo Excel no contiene hojas",
      });
    }

    const headerRow = worksheet.getRow(1);
    const headerMap = new Map();

    headerRow.eachCell((cell, colNumber) => {
      const raw = valueFromCell(cell);
      const norm = normalizeExcelHeader(raw);
      if (norm) {
        headerMap.set(norm, colNumber);
      }
    });

    const matchColumnKey = normalizeExcelHeader(excelMatchColumn);
    const matchColIndex = headerMap.get(matchColumnKey);

    if (!matchColIndex) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: `No se encontró la columna de cruce '${excelMatchColumn}' en el Excel`,
      });
    }

    const sourceColumnsNorm = excelColumnsSource.map((c) => normalizeExcelHeader(c));
    const sourceColumnsResolved = sourceColumnsNorm.map((norm, idx) => ({
      original: excelColumnsSource[idx],
      normalized: norm,
      colIndex: headerMap.get(norm) || null,
    }));

    const missingSources = sourceColumnsResolved.filter((x) => !x.colIndex);
    if (missingSources.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: `No se encontraron columnas origen en Excel: ${missingSources.map((x) => x.original).join(", ")}`,
      });
    }

    // 5) si overwriteEmptyOnly, traer respuestas actuales destino
    const respuestasDestinoActuales = new Map();

    if (overwriteEmptyOnly) {
      const { rows: existingRows } = await client.query(
        `
        SELECT
          r.id_informe,
          r.valor_texto,
          r.valor_bool,
          r.valor_json
        FROM ema.informe_respuesta r
        WHERE r.id_informe = ANY($1::int[])
          AND r.id_pregunta = $2
        `,
        [idsInformesPlantilla, idPreguntaDestino]
      );

      for (const row of existingRows) {
        let currentValue = null;

        if (row.valor_bool !== null && row.valor_bool !== undefined) {
          currentValue = row.valor_bool;
        } else if (row.valor_json !== null && row.valor_json !== undefined) {
          currentValue = row.valor_json;
        } else {
          currentValue = row.valor_texto;
        }

        respuestasDestinoActuales.set(Number(row.id_informe), currentValue);
      }
    }

    // 6) recorrer filas y actualizar
    let totalFilasExcel = 0;
    let totalMatch = 0;
    let totalActualizados = 0;
    const noEncontrados = [];
    const omitidosPorDestinoNoVacio = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);

      // saltar filas totalmente vacías
      const rowHasValues = Array.isArray(row.values)
        ? row.values.some((v, idx) => idx > 0 && v !== null && v !== undefined && String(valueFromCell({ value: v }) ?? "").trim() !== "")
        : false;

      if (!rowHasValues) continue;

      totalFilasExcel++;

      const matchRaw = valueFromCell(row.getCell(matchColIndex));
      const matchValue = String(matchRaw ?? "").trim();

      if (!matchValue) {
        noEncontrados.push({
          row: rowNumber,
          reason: "match vacío",
        });
        continue;
      }

      let idInformeMatch = null;

      if (matchMode === "id_informe") {
        const n = Number(matchValue);
        if (Number.isFinite(n) && idsInformesPlantilla.includes(n)) {
          idInformeMatch = n;
        }
      } else {
        const refKey = matchValue.toLowerCase();
        idInformeMatch = referenciaMap.get(refKey) || null;
      }

      if (!idInformeMatch) {
        noEncontrados.push({
          row: rowNumber,
          match: matchValue,
          reason: "sin informe asociado",
        });
        continue;
      }

      totalMatch++;

      if (overwriteEmptyOnly) {
        const current = respuestasDestinoActuales.get(Number(idInformeMatch));
        const currentIsEmpty =
          current === null ||
          current === undefined ||
          String(
            typeof current === "object" ? JSON.stringify(current) : current
          ).trim() === "";

        if (!currentIsEmpty) {
          omitidosPorDestinoNoVacio.push({
            row: rowNumber,
            id_informe: idInformeMatch,
          });
          continue;
        }
      }

      const sourceValues = sourceColumnsResolved.map((src) =>
        valueFromCell(row.getCell(src.colIndex))
      );

      const valorCombinado = firstNonEmpty(sourceValues);

      const tipoDestino = String(preguntaDestino?.tipo || "").trim().toLowerCase();
      const valorNormalizado = normalizeAnswerForSaveByTipo(preguntaDestino?.tipo, valorCombinado);

      let valorTexto = null;
      let valorBool = null;
      let valorJson = null;

      if (tipoDestino === "semaforo") {
        const obj = semaforoToObj(valorNormalizado, semaforoPaletteMap);
        if (obj && obj.hex) {
          valorTexto = obj.nombre || null;
          valorJson = obj;
        } else {
          const t = toJsonbOrText(valorNormalizado);
          valorTexto = t.valor_texto;
          valorBool = t.valor_bool;
          valorJson = t.valor_json;
        }
      } else {
        const t = toJsonbOrText(valorNormalizado);
        valorTexto = t.valor_texto;
        valorBool = t.valor_bool;
        valorJson = t.valor_json;
      }

      await client.query(
        `
        INSERT INTO ema.informe_respuesta
          (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (id_informe, id_pregunta)
        DO UPDATE SET
          valor_texto = EXCLUDED.valor_texto,
          valor_bool  = EXCLUDED.valor_bool,
          valor_json  = EXCLUDED.valor_json
        `,
        [
          idInformeMatch,
          idPreguntaDestino,
          valorTexto,
          valorBool,
          valorJson ? JSON.stringify(valorJson) : null,
        ]
      );

      totalActualizados++;
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      match_mode: matchMode,
      destination_mode: destinationMode,
      total_informes_plantilla: idsInformesPlantilla.length,
      total_filas_excel: totalFilasExcel,
      total_match: totalMatch,
      total_actualizados: totalActualizados,
      total_no_encontrados: noEncontrados.length,
      total_omitidos_destino_no_vacio: omitidosPorDestinoNoVacio.length,
      id_pregunta_destino: idPreguntaDestino,
      pregunta_destino: {
        id_pregunta: idPreguntaDestino,
        etiqueta: preguntaDestino?.etiqueta || etiquetaNuevaPregunta || null,
        tipo: preguntaDestino?.tipo || tipoNuevaPregunta || null,
      },
      sample_no_encontrados: noEncontrados.slice(0, 20),
      sample_omitidos_destino_no_vacio: omitidosPorDestinoNoVacio.slice(0, 20),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ importExcelUpdateRespuestas error:", err);
    return res.status(500).json({
      ok: false,
      error: "Error al importar Excel y actualizar respuestas",
      details: err.message,
    });
  } finally {
    client.release();
  }
}

async function previewConsolidacionCampos(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = Number(req.params.idPlantilla);
  const sourceFieldIds = Array.isArray(req.body?.source_field_ids)
    ? req.body.source_field_ids
    : [];
  const targetFieldId = req.body?.target_field_id;
  const strategy = String(req.body?.strategy || "").trim();
  const overwriteMode = String(req.body?.overwrite_mode || "").trim();

  try {
    const plan = await buildConsolidacionPlan({
      db: pool,
      req,
      idProyecto,
      idPlantilla,
      sourceFieldIds,
      targetFieldId,
      strategy,
      overwriteMode,
    });

    if (!plan.valid) {
      return res.status(400).json({
        ok: false,
        valid: false,
        summary: plan.summary,
        examples: [],
        errors: plan.errors,
      });
    }

    return res.json({
      ok: true,
      valid: true,
      summary: plan.summary,
      examples: plan.examples,
      errors: [],
    });
  } catch (err) {
    console.error("previewConsolidacionCampos error:", err);
    return res.status(500).json({
      ok: false,
      valid: false,
      error: "Error al generar el preview de consolidación",
      details: err.message,
    });
  }
}

async function applyConsolidacionCampos(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = Number(req.params.idPlantilla);
  const sourceFieldIds = Array.isArray(req.body?.source_field_ids)
    ? req.body.source_field_ids
    : [];
  const targetFieldId = req.body?.target_field_id;
  const strategy = String(req.body?.strategy || "").trim();
  const overwriteMode = String(req.body?.overwrite_mode || "").trim();
  const applyStartedAtIso = new Date().toISOString();
  const logPrefix = "[CONSOLIDACION_APPLY]";

  console.log(
    `${logPrefix} request_in ${applyStartedAtIso} params=${JSON.stringify({
      idProyecto,
      idPlantilla,
    })} body=${JSON.stringify(req.body || {})}`
  );
  console.log(
    `${logPrefix} payload_parseado ${JSON.stringify({
      source_field_ids: sourceFieldIds,
      target_field_id: targetFieldId,
      strategy,
      overwrite_mode: overwriteMode,
    })}`
  );

  try {
    console.log(`${logPrefix} planner_start`);
    const plan = await buildConsolidacionPlan({
      db: pool,
      req,
      idProyecto,
      idPlantilla,
      sourceFieldIds,
      targetFieldId,
      strategy,
      overwriteMode,
    });

    console.log(
      `${logPrefix} planner_result ${JSON.stringify({
        valid: !!plan?.valid,
        summary: plan?.summary || null,
        rowsToWriteLength: Array.isArray(plan?.rowsToWrite) ? plan.rowsToWrite.length : 0,
        examplesLength: Array.isArray(plan?.examples) ? plan.examples.length : 0,
        rowsToWriteSample: Array.isArray(plan?.rowsToWrite)
          ? plan.rowsToWrite.slice(0, 3).map((item) => ({
              id_informe: item?.id_informe,
              target_question_id: item?.target_question_id,
              resolved_value: item?.resolved_value,
            }))
          : [],
      })}`
    );

    if (!plan.valid) {
      console.log(`${logPrefix} planner_invalid response=400`);
      return res.status(400).json({
        ok: false,
        valid: false,
        summary: plan.summary,
        errors: plan.errors,
      });
    }

    console.log(`${logPrefix} iniciando_persistencia rowsToWrite=${plan.rowsToWrite.length}`);

    let updated = 0;
    let errorsCount = 0;
    const errorExamples = [];

    // Iteramos sobre las filas a escribir de forma aislada
    for (const item of plan.rowsToWrite || []) {
      const itemLog = {
        id_informe: item?.id_informe,
        target_question_id: item?.target_question_id,
        resolved_value: item?.resolved_value,
      };
      try {
        console.log(`${logPrefix} persist_start ${JSON.stringify(itemLog)}`);
        const idInforme = Number(item.id_informe);
        const targetQId = Number(item.target_question_id);
        let resolved = item.resolved_value;

        // 1. Validaciones previas al guardado
        if (!Number.isFinite(idInforme) || idInforme <= 0) {
          throw new Error("id_informe_invalido");
        }
        if (!Number.isFinite(targetQId) || targetQId <= 0) {
          throw new Error("target_field_id_invalido");
        }

        // El valor debe ser string y no ser un objeto complejo
        if (typeof resolved !== "string" || resolved === null) {
          throw new Error("valor_resuelto_tipo_invalido");
        }

        // 2. Saneamiento y Normalización
        // Quitamos espacios extra y normalizamos whitespace interno
        resolved = resolved.trim().replace(/\s+/g, " ");

        // Si tras normalizar queda vacío, omitimos (buildConsolidacionPlan ya debería filtrar esto, pero aseguramos)
        if (!resolved) {
          continue; 
        }

        // 3. Persistencia aislada (sin transacción global)
        // Destino textual -> solo valor_texto, limpiando bool y json
        await pool.query(
          `
          INSERT INTO ema.informe_respuesta
            (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
          VALUES ($1, $2, $3, NULL, NULL)
          ON CONFLICT (id_informe, id_pregunta)
          DO UPDATE SET
            valor_texto = EXCLUDED.valor_texto,
            valor_bool = NULL,
            valor_json = NULL
          `,
          [idInforme, targetQId, resolved]
        );

        updated++;
        console.log(
          `${logPrefix} persist_ok ${JSON.stringify({
            id_informe: idInforme,
            target_question_id: targetQId,
            resolved_value: resolved,
          })}`
        );
      } catch (err) {
        errorsCount++;
        if (errorExamples.length < 20) {
          errorExamples.push({
            id_informe: item.id_informe,
            reason: err.message || "error_escritura",
          });
        }
        console.error(
          `${logPrefix} persist_error ${JSON.stringify({
            id_informe: item?.id_informe,
            target_question_id: item?.target_question_id,
            resolved_value: item?.resolved_value,
            error: err?.message || String(err),
          })}`
        );
      }
    }

    const processed = Number(plan.summary?.eligible || 0);
    // skipped son los que eran elegibles pero no se actualizaron ni dieron error
    const skipped = Math.max(0, processed - updated - errorsCount);

    console.log(
      `${logPrefix} success ${JSON.stringify({
        started_at: applyStartedAtIso,
        finished_at: new Date().toISOString(),
        summary: {
          processed,
          updated,
          skipped,
          errors: errorsCount,
        },
        target7775Included: Array.isArray(plan?.rowsToWrite)
          ? plan.rowsToWrite.some((item) => Number(item?.id_informe) === 7775)
          : false,
      })}`
    );

    return res.json({
      ok: true,
      summary: {
        processed,
        updated,
        skipped,
        errors: errorsCount,
      },
      error_examples: errorExamples,
    });
  } catch (err) {
    console.error(`${logPrefix} fatal_error`, err);
    return res.status(500).json({
      ok: false,
      error: "Error fatal al aplicar la consolidación",
      details: err.message,
    });
  }
}


  /* 5) DELETE /api/informes/:id/fotos/:idFoto */
  async function deleteInformeFoto(req, res) {
    const idInforme = Number(req.params.id);
    const idFoto = Number(req.params.idFoto);

    if (!idInforme || !idFoto) return res.status(400).json({ ok: false, error: "ParÃ¡metros invÃ¡lidos" });

    const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const r = await client.query(
        `SELECT id_foto, ruta_archivo
        FROM ema.informe_foto
        WHERE id_foto = $1 AND id_informe = $2
        FOR UPDATE`,
        [idFoto, idInforme]
      );

      if (!r.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Foto no encontrada" });
      }

      const ruta = r.rows[0].ruta_archivo;
      const cleaned = String(ruta || "").replace(/^uploads[\\/]/i, "");
      const abs = path.resolve(path.join(uploadsRoot, cleaned));

      await client.query(`DELETE FROM ema.informe_foto WHERE id_foto = $1 AND id_informe = $2`, [idFoto, idInforme]);
      await client.query("COMMIT");

      // Corte de seguridad: NO borrar fÃ­sico desde Informes.
      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("deleteInformeFoto error:", err);
      return res.status(500).json({ ok: false, error: "Error al eliminar foto" });
    } finally {
      client.release();
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    6) DELETE /api/informes/:id
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  async function deleteInforme(req, res) {
    const idInforme = Number(req.params.id);

    if (!Number.isFinite(idInforme) || idInforme <= 0) {
      return res.status(400).json({ ok: false, error: "ID invÃ¡lido" });
    }

    const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));
    const client = await pool.connect();
    let fotosRows = [];

    try {
      await client.query("BEGIN");

      const inf = await client.query(
        `SELECT id_informe, id_proyecto
          FROM ema.informe
          WHERE id_informe = $1
          FOR UPDATE`,
        [idInforme]
      );

      if (!inf.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Informe no encontrado" });
      }

      const fotos = await client.query(`SELECT ruta_archivo FROM ema.informe_foto WHERE id_informe = $1`, [idInforme]);
      fotosRows = fotos.rows || [];

      await client.query(`DELETE FROM ema.informe_foto WHERE id_informe = $1`, [idInforme]);
      await client.query(`DELETE FROM ema.informe_respuesta WHERE id_informe = $1`, [idInforme]);

      const del = await client.query(`DELETE FROM ema.informe WHERE id_informe = $1`, [idInforme]);

      await client.query("COMMIT");

      const cleanup = await cleanupInformeFiles(fotosRows);

      return res.json({
        ok: true,
        deleted: del.rowCount,
        cleanup: {
          total: cleanup.total,
          deleted: cleanup.deleted,
          skipped: cleanup.skipped,
          failed: cleanup.failed,
        },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("deleteInforme error:", err);

      if (err?.code === "23503") {
        return res.status(409).json({
          ok: false,
          error: err?.detail || "No se puede eliminar: existen registros relacionados.",
          code: "FK_VIOLATION",
        });
      }

      return res.status(500).json({
        ok: false,
        error: err?.detail || err?.message || "Error al eliminar informe",
      });
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------
     POST /api/informes/proyecto/:idProyecto/plantilla/:idPlantilla/bulk-delete
     Borrado masivo (admin + informes.delete)
  --------------------------------------------------------- */
  async function bulkDeleteInformesByProyectoPlantilla(req, res) {
    const idProyecto = Number(req.params.idProyecto);
    const idPlantilla = Number(req.params.idPlantilla);

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ ok: false, error: "idProyecto inválido" });
    }
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "idPlantilla inválido" });
    }

    const adminRoleId = Number(req.user?.tipo_usuario ?? req.user?.group_id);
    if (adminRoleId !== 1) {
      return res.status(403).json({ ok: false, error: "Solo admin puede borrar en masa" });
    }

    const mode = req.body?.all === true ? "all" : "ids";
    let ids = [];

    if (mode === "ids") {
      const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
      ids = Array.from(
        new Set(
          rawIds
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      );

      if (!ids.length) {
        return res.status(400).json({ ok: false, error: "ids vacío o inválido" });
      }
      if (ids.length > 5000) {
        return res.status(400).json({ ok: false, error: "Límite de ids excedido (max 5000)" });
      }
    }

    const client = await pool.connect();
    let fotosRows = [];

    try {
      await client.query("BEGIN");

      if (mode === "all") {
        const { rows } = await client.query(
          `
          SELECT id_informe
          FROM ema.informe
          WHERE id_proyecto = $1
            AND id_plantilla = $2
          FOR UPDATE
          `,
          [idProyecto, idPlantilla]
        );
        ids = rows.map((r) => Number(r.id_informe)).filter((n) => Number.isFinite(n) && n > 0);
      } else {
        const { rows: foundRows } = await client.query(
          `
          SELECT id_informe
          FROM ema.informe
          WHERE id_informe = ANY($1::int[])
            AND id_proyecto = $2
            AND id_plantilla = $3
          FOR UPDATE
          `,
          [ids, idProyecto, idPlantilla]
        );

        if (foundRows.length !== ids.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            error: "ids fuera de proyecto/plantilla o conjunto inconsistente",
            found_count: foundRows.length,
            requested_count: ids.length,
          });
        }
      }

      if (!ids.length) {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          mode,
          deleted_count: 0,
          deleted_ids: [],
          cleanup: { total: 0, deleted: 0, skipped: 0, failed: 0 },
        });
      }

      const fotos = await client.query(
        `SELECT ruta_archivo FROM ema.informe_foto WHERE id_informe = ANY($1::int[])`,
        [ids]
      );
      fotosRows = fotos.rows || [];

      await client.query(`DELETE FROM ema.informe_foto WHERE id_informe = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM ema.informe_respuesta WHERE id_informe = ANY($1::int[])`, [ids]);
      const del = await client.query(`DELETE FROM ema.informe WHERE id_informe = ANY($1::int[])`, [ids]);

      await client.query("COMMIT");

      const cleanup = await cleanupInformeFiles(fotosRows);

      return res.json({
        ok: true,
        mode,
        deleted_count: del.rowCount,
        deleted_ids: ids,
        cleanup: {
          total: cleanup.total,
          deleted: cleanup.deleted,
          skipped: cleanup.skipped,
          failed: cleanup.failed,
        },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("bulkDeleteInformesByProyectoPlantilla error:", err);
      return res.status(500).json({
        ok: false,
        error: err?.detail || err?.message || "Error al eliminar informes",
      });
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------
   POST /api/informes/proyecto/:idProyecto/plantilla/:idPlantilla/bulk-delete-fotos
   Borra SOLO las fotos de todos los informes de esa plantilla/proyecto
   (admin)
  --------------------------------------------------------- */
  async function bulkDeleteFotosByProyectoPlantilla(req, res) {
    const idProyecto = Number(req.params.idProyecto);
    const idPlantilla = Number(req.params.idPlantilla);

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ ok: false, error: "idProyecto inválido" });
    }

    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "idPlantilla inválido" });
    }

    const adminRoleId = Number(req.user?.tipo_usuario ?? req.user?.group_id);
    if (adminRoleId !== 1) {
      return res.status(403).json({ ok: false, error: "Solo admin puede borrar fotos en masa" });
    }

    const client = await pool.connect();
    let fotosRows = [];

    try {
      await client.query("BEGIN");

      const informesRes = await client.query(
        `
        SELECT id_informe
        FROM ema.informe
        WHERE id_proyecto = $1
          AND id_plantilla = $2
        FOR UPDATE
        `,
        [idProyecto, idPlantilla]
      );

      const idsInforme = informesRes.rows
        .map((r) => Number(r.id_informe))
        .filter((n) => Number.isFinite(n) && n > 0);

      if (!idsInforme.length) {
        await client.query("COMMIT");
        return res.json({
          ok: true,
          deleted_count: 0,
          informes_count: 0,
          cleanup: { total: 0, deleted: 0, skipped: 0, failed: 0 },
        });
      }

      const fotosRes = await client.query(
        `
        SELECT id_foto, id_informe, id_pregunta, ruta_archivo
        FROM ema.informe_foto
        WHERE id_informe = ANY($1::bigint[])
        ORDER BY id_informe, id_pregunta, orden, id_foto
        `,
        [idsInforme]
      );

      fotosRows = fotosRes.rows || [];

      const delRes = await client.query(
        `
        DELETE FROM ema.informe_foto
        WHERE id_informe = ANY($1::bigint[])
        `,
        [idsInforme]
      );

      await client.query("COMMIT");

      const cleanup = await cleanupInformeFiles(fotosRows);

      return res.json({
        ok: true,
        deleted_count: delRes.rowCount || 0,
        informes_count: idsInforme.length,
        cleanup: {
          total: cleanup.total,
          deleted: cleanup.deleted,
          skipped: cleanup.skipped,
          failed: cleanup.failed,
        },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error("bulkDeleteFotosByProyectoPlantilla error:", err);

      return res.status(500).json({
        ok: false,
        error: err?.detail || err?.message || "Error al borrar fotos en masa",
      });
    } finally {
      client.release();
    }
  }

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SHARE LINKS (PRIVADO) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function buildPublicUrl(req, token) {
    const baseRaw = process.env.PUBLIC_FORM_BASE_URL || "";
    const base = String(baseRaw).trim().replace(/\/+$/, "");
    if (base) return `${base}/${token}`;
    return `${req.protocol}://${req.get("host")}/api/informes-public/${token}`;
  }

  async function createShareLink(req, res) {
    try {
      const { id_plantilla, id_proyecto = null, titulo = null, expira_en, minutos = 60, max_envios = null } = req.body;
      if (!id_plantilla) return res.status(400).json({ ok: false, error: "id_plantilla es obligatorio" });

      const token = crypto.randomBytes(32).toString("hex");
      const userId = req.user?.id ?? req.user?.id_user ?? null;

      let expira;
      if (expira_en) expira = new Date(expira_en);
      else expira = new Date(Date.now() + Number(minutos) * 60 * 1000);
      if (Number.isNaN(expira.getTime())) return res.status(400).json({ ok: false, error: "expira_en invÃ¡lido" });

      const { rows } = await pool.query(
        `INSERT INTO ema.informe_share_link
          (id_plantilla, id_proyecto, token, titulo, expira_en, max_envios, creado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *`,
        [
          Number(id_plantilla),
          id_proyecto ? Number(id_proyecto) : null,
          token,
          titulo,
          expira,
          max_envios != null && max_envios !== "" ? Number(max_envios) : null,
          userId,
        ]
      );

      const publicUrl = buildPublicUrl(req, token);
      return res.status(201).json({ ok: true, share: rows[0], publicUrl });
    } catch (err) {
      console.error("createShareLink error:", err);
      return res.status(500).json({ ok: false, error: "Error al crear share link" });
    }
  }

  async function listShareLinksByPlantilla(req, res) {
    try {
      const { idPlantilla } = req.params;

      const { rows } = await pool.query(
        `SELECT *
        FROM ema.informe_share_link
        WHERE id_plantilla = $1
        ORDER BY abierto_desde DESC, id_share DESC`,
        [Number(idPlantilla)]
      );

      const links = rows.map((r) => ({ ...r, publicUrl: buildPublicUrl(req, r.token) }));
      return res.json({ ok: true, links });
    } catch (err) {
      console.error("listShareLinksByPlantilla error:", err);
      return res.status(500).json({ ok: false, error: "Error al listar links" });
    }
  }

  async function updateShareLink(req, res) {
    try {
      const { idShare } = req.params;
      const sid = Number(idShare);

      if (!sid) {
        return res.status(400).json({ ok: false, error: "idShare inválido" });
      }

      const {
        id_proyecto,
        titulo,
        expira_en,
        max_envios,
      } = req.body || {};

      const userId = req.user?.id ?? req.user?.id_user ?? null;
      const tipoUsuario = Number(req.user?.tipo_usuario ?? req.user?.group_id ?? req.user?.tipo ?? 0);
      const esAdmin = tipoUsuario === 1;

      // 1) buscar link actual
      const linkRes = await pool.query(
        `
        SELECT *
        FROM ema.informe_share_link
        WHERE id_share = $1
        LIMIT 1
        `,
        [sid]
      );

      if (!linkRes.rowCount) {
        return res.status(404).json({ ok: false, error: "Link no encontrado" });
      }

      const actual = linkRes.rows[0];

      // 2) permiso básico: admin o creador
      if (!esAdmin && Number(actual.creado_por) !== Number(userId)) {
        return res.status(403).json({ ok: false, error: "No tenés permiso para editar este link" });
      }

      // 3) no editar link cerrado
      if (actual.cerrado_en) {
        return res.status(400).json({ ok: false, error: "No se puede editar un link cerrado" });
      }

      // 4) normalizar valores
      let nuevoProyecto = actual.id_proyecto;
      if (id_proyecto !== undefined) {
        if (id_proyecto === null || String(id_proyecto).trim() === "") {
          nuevoProyecto = null;
        } else {
          nuevoProyecto = Number(id_proyecto);
          if (!Number.isFinite(nuevoProyecto) || nuevoProyecto <= 0) {
            return res.status(400).json({ ok: false, error: "id_proyecto inválido" });
          }
        }
      }

      let nuevoTitulo = actual.titulo;
      if (titulo !== undefined) {
        const t = String(titulo ?? "").trim();
        nuevoTitulo = t || null;
      }

      let nuevaExpira = actual.expira_en;
      if (expira_en !== undefined) {
        const d = new Date(expira_en);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ ok: false, error: "expira_en inválido" });
        }
        if (d.getTime() <= Date.now()) {
          return res.status(400).json({ ok: false, error: "La expiración debe ser futura" });
        }
        nuevaExpira = d;
      }

      let nuevoMaxEnvios = actual.max_envios;
      if (max_envios !== undefined) {
        if (max_envios === null || String(max_envios).trim() === "") {
          nuevoMaxEnvios = null;
        } else {
          nuevoMaxEnvios = Number(max_envios);
          if (!Number.isFinite(nuevoMaxEnvios) || nuevoMaxEnvios <= 0) {
            return res.status(400).json({ ok: false, error: "max_envios inválido" });
          }
        }
      }

      // 5) update
      const upd = await pool.query(
        `
        UPDATE ema.informe_share_link
        SET
          id_proyecto = $2,
          titulo = $3,
          expira_en = $4,
          max_envios = $5
        WHERE id_share = $1
        RETURNING *
        `,
        [sid, nuevoProyecto, nuevoTitulo, nuevaExpira, nuevoMaxEnvios]
      );

      const row = upd.rows[0];

      return res.json({
        ok: true,
        link: {
          ...row,
          publicUrl: buildPublicUrl(req, row.token),
        },
      });
    } catch (err) {
      console.error("updateShareLink error:", err);
      return res.status(500).json({ ok: false, error: "Error al actualizar link" });
    }
  }

  async function closeShareLink(req, res) {
    try {
      const { idShare } = req.params;
      const userId = req.user?.id ?? req.user?.id_user ?? null;

      const { rows } = await pool.query(
        `UPDATE ema.informe_share_link
        SET cerrado_en = now(),
            cerrado_por = $2
        WHERE id_share = $1
          AND cerrado_en IS NULL
        RETURNING *`,
        [Number(idShare), userId]
      );

      if (!rows.length) return res.status(404).json({ ok: false, error: "Link no encontrado o ya cerrado" });
      return res.json({ ok: true, link: rows[0] });
    } catch (err) {
      console.error("closeShareLink error:", err);
      return res.status(500).json({ ok: false, error: "Error al cerrar link" });
    }
  }

  async function reopenShareLink(req, res) {
    try {
      const { idShare } = req.params;

      const { rows } = await pool.query(
        `UPDATE ema.informe_share_link
        SET cerrado_en = NULL,
            cerrado_por = NULL
        WHERE id_share = $1
        RETURNING *`,
        [Number(idShare)]
      );

      if (!rows.length) return res.status(404).json({ ok: false, error: "Link no encontrado" });
      return res.json({ ok: true, link: rows[0] });
    } catch (err) {
      console.error("reopenShareLink error:", err);
      return res.status(500).json({ ok: false, error: "Error al reabrir link" });
    }
  }

  async function eliminarShareLink(req, res) {
    const { idShare } = req.params;
    const sid = Number(idShare);
    if (!sid) return res.status(400).json({ ok: false, error: "idShare invÃ¡lido" });

    try {
      const r = await pool.query(
        `DELETE FROM ema.informe_share_link
        WHERE id_share = $1
        RETURNING id_share`,
        [sid]
      );

      if (!r.rowCount) return res.status(404).json({ ok: false, error: "Link no encontrado" });
      return res.json({ ok: true, id_share: r.rows[0].id_share });
    } catch (e) {
      console.error("eliminarShareLink:", e);
      return res.status(500).json({ ok: false, error: "Error eliminando link" });
    }
  }

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ SHARE LINKS (PÃšBLICO) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function _getValidShareByToken(token) {
  const { rows } = await pool.query(`SELECT * FROM ema.informe_share_link WHERE token = $1`, [token]);
  if (!rows.length) return { ok: false, status: 404, error: "Link invÃ¡lido" };

  const link = rows[0];
  const now = new Date();

  if (link.cerrado_en) return { ok: false, status: 410, error: "Link cerrado" };
  if (new Date(link.expira_en) <= now) return { ok: false, status: 410, error: "Link expirado" };
  if (link.max_envios != null && Number(link.envios_count) >= Number(link.max_envios)) {
    return { ok: false, status: 429, error: "LÃ­mite de envÃ­os alcanzado" };
  }

  return { ok: true, link };
}

// GET /api/informes-public/:token
async function publicGetShareForm(req, res) {
  try {
    const { token } = req.params;

    const valid = await _getValidShareByToken(token);
    if (!valid.ok) return res.status(valid.status).json({ ok: false, error: valid.error });

    const link = valid.link;

    const plantRes = await pool.query(
      `SELECT * FROM ema.informe_plantilla WHERE id_plantilla = $1`,
      [Number(link.id_plantilla)]
    );
    if (!plantRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    }
    const plantilla = plantRes.rows[0];

    const { rows: secciones } = await pool.query(
      `SELECT * FROM ema.informe_seccion
       WHERE id_plantilla = $1
       ORDER BY orden`,
      [Number(link.id_plantilla)]
    );

    // âœ… incluye opciones_json porque es q.*
    const { rows: preguntas } = await pool.query(
      `SELECT q.*
       FROM ema.informe_pregunta q
       JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
       WHERE s.id_plantilla = $1
       ORDER BY s.orden, q.orden`,
      [Number(link.id_plantilla)]
    );

    const seccionesConPreguntas = secciones.map((sec) => ({
      ...sec,
      preguntas: preguntas.filter((p) => p.id_seccion === sec.id_seccion),
    }));

    return res.json({
      ok: true,
      share: {
        id_share: link.id_share,
        id_plantilla: link.id_plantilla,
        id_proyecto: link.id_proyecto,
        titulo: link.titulo,
        expira_en: link.expira_en,
        max_envios: link.max_envios,
        envios_count: link.envios_count,
      },
      plantilla,
      secciones: seccionesConPreguntas,
    });
  } catch (err) {
    console.error("publicGetShareForm error:", err);
    return res.status(500).json({ ok: false, error: "Error al cargar formulario pÃºblico" });
  }
}

// POST /api/informes-public/:token/enviar
async function publicSubmitShareForm(req, res) {
  const token = String(req.params.token || "").trim();
  const titulo = req.body?.titulo ? String(req.body.titulo).trim() : null;
  let clientRequestId = String(req.body?.client_request_id || "").trim();

  if (!clientRequestId) {
    clientRequestId = generateClientRequestId();
    console.warn(`[Public Submit] client_request_id generado para request legacy: ${clientRequestId}`);
  }

  let respuestasObj = {};
  try {
    const raw = req.body?.respuestas;
    respuestasObj =
      typeof raw === "string"
        ? JSON.parse(raw || "{}")
        : raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
  } catch {
    return res.status(400).json({ ok: false, error: "respuestas inválidas" });
  }

  if (!token) {
    return res.status(400).json({ ok: false, error: "Token vacío" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) Buscar share link válido por token
    const linkRes = await client.query(
      `
      SELECT
        s.id_share,
        s.id_plantilla,
        s.id_proyecto,
        s.token,
        s.titulo,
        s.abierto_desde,
        s.expira_en,
        s.cerrado_en,
        s.cerrado_por,
        s.max_envios,
        s.envios_count,
        s.creado_por
      FROM ema.informe_share_link s
      WHERE s.token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!linkRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Link público no encontrado" });
    }

    const link = linkRes.rows[0];

    if (link.cerrado_en) {
      await client.query("ROLLBACK");
      return res.status(410).json({ ok: false, error: "El link ya fue cerrado" });
    }

    if (link.expira_en && new Date(link.expira_en).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ ok: false, error: "El link expiró" });
    }

    if (
      link.max_envios !== null &&
      link.max_envios !== undefined &&
      Number(link.envios_count || 0) >= Number(link.max_envios)
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error: "Se alcanzó el máximo de envíos permitido",
      });
    }

    // 2) Idempotencia: si ya existe este mismo envío, devolver OK sin duplicar
    const existRes = await client.query(
      `
      SELECT id_informe
      FROM ema.informe
      WHERE client_request_id = $1
      LIMIT 1
      `,
      [clientRequestId]
    );

    if (existRes.rowCount) {
      const idInforme = existRes.rows[0].id_informe;

      await client.query("COMMIT");
      return res.json({
        ok: true,
        duplicated: true,
        id_informe: idInforme,
        share: {
          id_share: link.id_share,
          envios_count: link.envios_count,
          cerrado_en: link.cerrado_en,
        },
        message: "Este envío ya fue procesado anteriormente.",
      });
    }

    // 3) Leer preguntas + reglas
    const qRes = await client.query(
      `
      SELECT
        q.id_pregunta,
        q.etiqueta,
        q.tipo,
        q.obligatorio,
        q.permite_foto,
        q.opciones_json,
        q.visible_if,
        q.required_if,
        q.hide_if,
        s.visible_if AS sec_visible_if
      FROM ema.informe_pregunta q
      JOIN ema.informe_seccion s
        ON s.id_seccion = q.id_seccion
      WHERE s.id_plantilla = $1
      ORDER BY s.orden, q.orden, q.id_pregunta
      `,
      [Number(link.id_plantilla)]
    );

    const preguntas = qRes.rows || [];
    const preguntasById = new Map(preguntas.map((q) => [Number(q.id_pregunta), q]));

    // 3b) Mapeo etiquetas -> IDs para compatibilidad con mobile legacy
    const labelToId = {};
    for (const q of preguntas) {
      const key = String(q.etiqueta || "").trim().toLowerCase();
      if (key) labelToId[key] = Number(q.id_pregunta);
    }

    const answersForRules = {};
    const rawR = respuestasObj || {};
    for (const [k, v] of Object.entries(rawR)) {
      let idNum = Number(k);
      if (!Number.isFinite(idNum) || idNum <= 0) {
        const key = String(k || "").trim().toLowerCase();
        idNum = labelToId[key] || NaN;
      }
      if (Number.isFinite(idNum) && idNum > 0) {
        answersForRules[idNum] = v;
      }
    }

    // Helpers locales (reutilizados de crearInforme)
    const isPreguntaImagenLike = (q) => {
      const t = String(q?.tipo || "").trim().toLowerCase();
      const e = String(q?.etiqueta || "").trim().toLowerCase();
      return t === "imagen" || t === "image" || e.includes("foto") || e.includes("imagen");
    };

    const isNonEmptyImageLink = (val) => {
      if (val === null || val === undefined) return false;
      if (Array.isArray(val)) return val.some(x => isNonEmptyImageLink(x));
      if (typeof val === "object") {
        return !!(val.url?.trim() || val.ruta?.trim() || val.path?.trim());
      }
      if (typeof val === "string") return !!val.trim();
      return false;
    };

    // 4) Resolver preguntas visibles (usar answersForRules)
    const visibleSet = new Set();

    for (const q of preguntas) {
      const secVisible = evalCond(q.sec_visible_if, answersForRules);
      const qVisible = evalCond(q.visible_if, answersForRules);
      const qHidden = q.hide_if ? evalCond(q.hide_if, answersForRules) : false;

      if (secVisible && qVisible && !qHidden) {
        visibleSet.add(Number(q.id_pregunta));
      }
    }

    // 5) Validar obligatorios visibles
    const faltantes = [];

    for (const q of preguntas) {
      const idPregunta = Number(q.id_pregunta);
      if (!visibleSet.has(idPregunta)) continue;

      const requiredByRule = q.required_if ? evalCond(q.required_if, answersForRules) : false;
      const requiredNow = !!q.obligatorio || requiredByRule;

      if (!requiredNow) continue;

      const raw = answersForRules[idPregunta];
      const val = normalizeAnswerForSaveByTipo(q.tipo, raw);

      const field = `fotos_${idPregunta}`;
      const hasFiles = !!(req.files?.[field]);
      const hasLink = isNonEmptyImageLink(raw);

      if (isPreguntaImagenLike(q)) {
        if (!hasFiles && !hasLink) {
          faltantes.push({
            id_pregunta: idPregunta,
            etiqueta: q.etiqueta || `Pregunta ${idPregunta}`,
            reason: "required_image",
          });
        }
        continue;
      }

      if (isEmptyAnswer(val)) {
        faltantes.push({
          id_pregunta: idPregunta,
          etiqueta: q.etiqueta || `Pregunta ${idPregunta}`,
          reason: "required_answer",
        });
      }
    }

    if (faltantes.length) {
      const err = new Error("Faltan respuestas obligatorias");
      err.statusCode = 400;
      err.details = faltantes;
      throw err;
    }

    // 6) Crear cabecera informe
    const insInforme = await client.query(
      `
      INSERT INTO ema.informe (
        id_plantilla,
        id_proyecto,
        titulo,
        fecha_creado,
        creado_por,
        client_request_id
      )
      VALUES ($1, $2, $3, NOW(), NULL, $4)
      RETURNING id_informe
      `,
      [
        Number(link.id_plantilla),
        link.id_proyecto ? Number(link.id_proyecto) : null,
        titulo || link.titulo || null,
        clientRequestId,
      ]
    );

    const idInforme = Number(insInforme.rows[0].id_informe);

    // 7) Guardar respuestas visibles
    for (const q of preguntas) {
      const idPregunta = Number(q.id_pregunta);
      if (!visibleSet.has(idPregunta)) continue;

      const raw = answersForRules[idPregunta];
      if (raw === undefined) continue;

      const valorNormalizado = normalizeAnswerForSaveByTipo(q.tipo, raw);
      if (isEmptyAnswer(valorNormalizado)) continue;

      const { valor_texto, valor_bool, valor_json } = toJsonbOrText(valorNormalizado);

      await client.query(
        `
        INSERT INTO ema.informe_respuesta
          (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (id_informe, id_pregunta)
        DO UPDATE SET
          valor_texto = EXCLUDED.valor_texto,
          valor_bool  = EXCLUDED.valor_bool,
          valor_json  = EXCLUDED.valor_json
        `,
        [idInforme, idPregunta, valor_texto, valor_bool, valor_json]
      );
    }

    // 8) Guardar fotos
    const uploadsRoot = path.resolve(path.join(__dirname, "..", "uploads"));
    const baseDir = path.join(
      uploadsRoot,
      "proyectos",
      String(link.id_proyecto || "sin_proyecto"),
      "informes",
      String(idInforme)
    );

    await fs.promises.mkdir(baseDir, { recursive: true });

    for (const [fieldName, fileOrFiles] of Object.entries(req.files || {})) {
      const m = /^fotos_(\d+)$/.exec(String(fieldName));
      if (!m) continue;

      const idPregunta = Number(m[1]);
      if (!Number.isFinite(idPregunta) || idPregunta <= 0) continue;

      const q = preguntasById.get(idPregunta);
      if (!q) continue;
      if (!visibleSet.has(idPregunta)) continue;

      const permite = !!q.permite_foto || String(q.tipo).toLowerCase() === "imagen";
      if (!permite) continue;

      const archivos = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
      let ordenFoto = 1;

      for (const f of archivos) {
        const safeName = sanitizeFilename(f.name || "foto.jpg");
        const safeExt = pickSafeImageExt(safeName, f.mimetype);
        if (!safeExt) throw new Error("Tipo de archivo no permitido (solo jpg/png/webp)");

        const nombreArchivo = `preg_${idPregunta}_foto_${ordenFoto}${safeExt}`;
        const destinoAbs = path.join(baseDir, nombreArchivo);

        const finalAbs = await safeSaveUpload(f, destinoAbs);
        const destinoRel = path.relative(uploadsRoot, finalAbs).replace(/\\/g, "/");

        await client.query(
          `
          INSERT INTO ema.informe_foto
            (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [idInforme, idPregunta, null, destinoRel, ordenFoto]
        );

        ordenFoto++;
      }
    }

    // 9) Actualizar contador de envíos del share
    const upd = await client.query(
      `
      UPDATE ema.informe_share_link
         SET envios_count = envios_count + 1,
             cerrado_en = CASE
               WHEN max_envios IS NOT NULL AND (envios_count + 1) >= max_envios THEN NOW()
               ELSE cerrado_en
             END
       WHERE id_share = $1
       RETURNING envios_count, max_envios, cerrado_en
      `,
      [link.id_share]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      duplicated: false,
      id_informe: idInforme,
      share: {
        id_share: link.id_share,
        envios_count: upd.rows[0]?.envios_count,
        cerrado_en: upd.rows[0]?.cerrado_en,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("publicSubmitShareForm error:", err);

    if (err?.code === "23505") {
      // unique violation por client_request_id
      return res.json({
        ok: true,
        duplicated: true,
        message: "Este envío ya fue procesado.",
      });
    }

    const status = Number(err?.statusCode || 500);
    return res.status(status).json({
      ok: false,
      error: err?.message || "Error al enviar formulario público",
      details: err?.details || undefined,
    });
  } finally {
    client.release();
  }
}

// 7) GET /api/informes/proyecto/:idProyecto/export/excel?plantilla=ID
// Excel tipo KoBo: 1 fila = 1 informe, 1 columna = 1 pregunta (+ columnas fotos)
// GET /api/informes/proyecto/:idProyecto/export/excel?kobo=1
// (opcional) ?plantilla=ID  (si querÃ©s mantenerlo)
async function exportProyectoInformesExcel(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = req.query.plantilla ? Number(req.query.plantilla) : null;

  if (!idProyecto) return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });

  const client = await pool.connect();
  try {
    // âœ… proy label (PK gid)
    const proyQ = await client.query(
      `SELECT gid, nombre, codigo
       FROM ema.proyectos
       WHERE gid = $1`,
      [idProyecto]
    );
    const proy = proyQ.rows?.[0];
    const proyectoLabel = proy
      ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
      : String(idProyecto);

    // 1) informes del proyecto
    const informesQ = await client.query(
      `SELECT i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado,
              p.nombre AS nombre_plantilla
       FROM ema.informe i
       JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
       WHERE i.id_proyecto = $1
       ${idPlantilla ? "AND i.id_plantilla = $2" : ""}
       ORDER BY i.fecha_creado DESC, i.id_informe DESC`,
      idPlantilla ? [idProyecto, idPlantilla] : [idProyecto]
    );

    const informes = informesQ.rows || [];
    if (!informes.length) {
      return res.status(404).json({ ok: false, error: "No hay informes para exportar." });
    }

    const informeIds = informes.map((x) => Number(x.id_informe)).filter(Boolean);

    // 2) Respuestas de todos los informes
    const respAllQ = await client.query(
      `SELECT id_informe, id_pregunta, valor_texto, valor_bool, valor_json
       FROM ema.informe_respuesta
       WHERE id_informe = ANY($1::int[])`,
      [informeIds]
    );

    // respByInformeRaw: Map(idInforme -> Map(idPregunta -> raw row))
    const respByInformeRaw = new Map();
    for (const r of respAllQ.rows || []) {
      const idInf = Number(r.id_informe);
      const idPreg = Number(r.id_pregunta);
      if (!respByInformeRaw.has(idInf)) respByInformeRaw.set(idInf, new Map());
      respByInformeRaw.get(idInf).set(idPreg, r);
    }

    // 3) Fotos (opcional) por informe+p pregunta
    const fotosQ = await client.query(
      `SELECT id_informe, id_pregunta, descripcion, ruta_archivo, orden
       FROM ema.informe_foto
       WHERE id_informe = ANY($1::int[])
       ORDER BY id_informe, id_pregunta, orden`,
      [informeIds]
    );

    // fotosByInforme: Map(idInforme -> Map(idPregunta -> string "ruta|ruta..."))
    const fotosByInforme = new Map();
    for (const f of fotosQ.rows || []) {
      const idInf = Number(f.id_informe);
      const idPreg = Number(f.id_pregunta);
      if (!idPreg) continue;

      if (!fotosByInforme.has(idInf)) fotosByInforme.set(idInf, new Map());
      const mp = fotosByInforme.get(idInf);

      const publicUrl = toPublicPhotoUrl(req, f.ruta_archivo);
      if (!publicUrl) continue;

      const prev = mp.get(idPreg) || "";
      mp.set(idPreg, prev ? `${prev} | ${publicUrl}` : publicUrl);
    }

    // 4) Preguntas (diccionario de columnas) - unimos plantillas presentes
    const plantillasIds = Array.from(new Set(informes.map((i) => Number(i.id_plantilla)).filter(Boolean)));

    const preguntasAll = [];
    for (const pid of plantillasIds) {
      const pq = await client.query(
        `SELECT p.id_pregunta, p.etiqueta, p.tipo, p.orden,
                s.titulo AS seccion_titulo, s.orden AS seccion_orden,
                s.id_plantilla
         FROM ema.informe_pregunta p
         JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
         WHERE s.id_plantilla = $1
         ORDER BY s.orden, p.orden, p.id_pregunta`,
        [pid]
      );
      preguntasAll.push(...(pq.rows || []));
    }

    const preguntasById = new Map();
    for (const p of preguntasAll) {
      preguntasById.set(Number(p.id_pregunta), p);
    }

    // helper: sanitizar header tipo Kobo
    const normHeader = (s) =>
      String(s || "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s._:-]/gu, "") // deja letras/nÃºmeros/espacios y algunos signos
        .replace(/\s/g, "_")
        .slice(0, 80) || "campo";

    // evitar duplicados (cuando hay mismas etiquetas)
    const used = new Map();
    const uniqueHeader = (base) => {
      const k = base.toLowerCase();
      const n = (used.get(k) || 0) + 1;
      used.set(k, n);
      return n === 1 ? base : `${base}__${n}`;
    };

    // columnas de preguntas (y opcional fotos por pregunta)
    // Si hay mÃºltiples plantillas, prefijamos para que no choque:
    const multiPlantilla = plantillasIds.length > 1;

    const preguntaCols = preguntasAll.map((p) => {
      const seccion = p.seccion_titulo || "";
      const etiqueta = p.etiqueta || `pregunta_${p.id_pregunta}`;
      const base = multiPlantilla
        ? `P${p.id_plantilla}_${normHeader(seccion)}_${normHeader(etiqueta)}`
        : `${normHeader(seccion)}_${normHeader(etiqueta)}`;

      const colName = uniqueHeader(base);

      return {
        colName,
        id_pregunta: Number(p.id_pregunta),
        id_plantilla: Number(p.id_plantilla),
        seccion,
        etiqueta,
        tipo: p.tipo,
      };
    });

    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "EMA GeoApp";
    wb.created = new Date();

    // âœ… Hoja principal tipo Kobo
    const ws = wb.addWorksheet("data", { views: [{ state: "frozen", ySplit: 1 }] });

    // columnas base (tipo Kobo â€œstart/endâ€ no aplica si no tenÃ©s esos campos)
    const baseCols = [
      { header: "id_informe", key: "id_informe", width: 12 },
      { header: "fecha_creado", key: "fecha_creado", width: 22 },
      { header: "id_proyecto", key: "id_proyecto", width: 12 },
      { header: "id_plantilla", key: "id_plantilla", width: 12 },
      { header: "plantilla", key: "plantilla", width: 26 },
      { header: "titulo", key: "titulo", width: 34 },
    ];

    // âœ… columnas preguntas
    const questionCols = preguntaCols.map((q) => ({
      header: q.colName,
      key: q.colName,
      width: 28,
    }));

    // âœ… columnas fotos por pregunta (opcional)
    const fotoCols = preguntaCols.map((q) => ({
      header: `Fotos:${q.colName}`,
      key: `Fotos:${q.colName}`,
      width: 35,
    }));

    ws.columns = [...baseCols, ...questionCols, ...fotoCols];

    // header style
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };

    // 5) cargar filas (una por informe)
    for (const inf of informes) {
      const idInf = Number(inf.id_informe);
      const respMap = respByInformeRaw.get(idInf) || new Map();
      const fotosMap = fotosByInforme.get(idInf) || new Map();

      const row = {
        id_informe: idInf,
        fecha_creado: inf.fecha_creado ? new Date(inf.fecha_creado) : "",
        id_proyecto: Number(inf.id_proyecto) || idProyecto,
        id_plantilla: Number(inf.id_plantilla) || "",
        plantilla: sanitizeExcelText(inf.nombre_plantilla || String(inf.id_plantilla || "")),
        titulo: sanitizeExcelText(inf.titulo || ""),
      };

      // completar respuestas por columna (solo las preguntas de esa plantilla tienen valor)
      for (const q of preguntaCols) {
        const rawResp = respMap.get(q.id_pregunta) || null;
        const pregunta = preguntasById.get(q.id_pregunta) || q;
        row[q.colName] = resolveExcelResponseValue(rawResp, pregunta);
        row[`Fotos:${q.colName}`] = sanitizeExcelText(fotosMap.get(q.id_pregunta) || "");
      }

      const r = ws.addRow(row);
      r.alignment = { vertical: "top", wrapText: true };
    }

    // âœ… Hoja diccionario (opcional, sÃºper Ãºtil)
    const wsQ = wb.addWorksheet("questions", { views: [{ state: "frozen", ySplit: 1 }] });
    wsQ.columns = [
      { header: "colName", key: "colName", width: 40 },
      { header: "id_plantilla", key: "id_plantilla", width: 12 },
      { header: "id_pregunta", key: "id_pregunta", width: 12 },
      { header: "seccion", key: "seccion", width: 30 },
      { header: "etiqueta", key: "etiqueta", width: 45 },
      { header: "tipo", key: "tipo", width: 14 },
    ];
    wsQ.getRow(1).font = { bold: true };

    for (const q of preguntaCols) {
      wsQ.addRow({
        colName: q.colName,
        id_plantilla: q.id_plantilla,
        id_pregunta: q.id_pregunta,
        seccion: sanitizeExcelText(q.seccion),
        etiqueta: sanitizeExcelText(q.etiqueta),
        tipo: sanitizeExcelText(q.tipo),
      });
    }

    // âœ… hoja info
    const wsInfo = wb.addWorksheet("info");
    wsInfo.addRow(["Proyecto", sanitizeExcelText(proyectoLabel)]);
    wsInfo.addRow(["ID Proyecto", idProyecto]);
    wsInfo.addRow(["Filtro plantilla", idPlantilla ? String(idPlantilla) : "Todas"]);
    wsInfo.addRow(["Total informes", informes.length]);
    wsInfo.addRow(["Generado", new Date()]);

    const fileName = `Proyecto_${idProyecto}_Informes_KOBO${idPlantilla ? `_Plantilla_${idPlantilla}` : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("exportProyectoInformesExcel (KOBO) error:", e);
    res.status(500).json({ ok: false, error: e.message || "Error exportando Excel" });
  } finally {
    client.release();
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   8) GET /api/informes/proyecto/:idProyecto/personas?...
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function buscarPersonasProyecto(req, res) {
  const { idProyecto } = req.params;
  const { by = "all", q = "", plantilla } = req.query;

  try {
    const idP = Number(idProyecto);
    if (!Number.isFinite(idP) || idP <= 0) {
      return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });
    }

    const qTxt = String(q || "").trim();
    const byNorm = String(by || "all").trim().toLowerCase();
    const isNumericQ = /^\d+$/.test(qTxt);

    const params = [idP];
    let wherePlant = "";

    if (plantilla != null && String(plantilla).trim() !== "") {
      const idPlant = Number(plantilla);
      if (!Number.isFinite(idPlant) || idPlant <= 0) {
        return res.status(400).json({ ok: false, error: "plantilla invÃ¡lida" });
      }
      params.push(idPlant);
      wherePlant = ` AND i.id_plantilla = $${params.length} `;
    }

    const baseParams = [...params];
    let filterSql = "";

    if (qTxt) {
      const wantsId = byNorm === "id" || (byNorm === "all" && isNumericQ);

      if (wantsId) {
        const idInf = Number(qTxt);
        if (!Number.isFinite(idInf) || idInf <= 0) {
          return res.status(400).json({ ok: false, error: "ID invÃ¡lido" });
        }
        baseParams.push(idInf);
        const pId = `$${baseParams.length}`;
        filterSql = `WHERE y.id_informe = ${pId}`;
      } else {
        baseParams.push(`%${qTxt}%`);
        const pQ = `$${baseParams.length}`;

        if (byNorm === "ci") filterSql = `WHERE COALESCE(y.ci,'') ILIKE ${pQ}`;
        else if (byNorm === "codigo") filterSql = `WHERE COALESCE(y.codigo,'') ILIKE ${pQ}`;
        else if (byNorm === "nombre") {
          filterSql = `WHERE
            (COALESCE(y.nombre,'') || ' ' || COALESCE(y.apellido,'')) ILIKE ${pQ}
            OR COALESCE(y.nombre,'') ILIKE ${pQ}
            OR COALESCE(y.apellido,'') ILIKE ${pQ}`;
        } else {
          filterSql = `WHERE
            COALESCE(y.ci,'') ILIKE ${pQ}
            OR COALESCE(y.codigo,'') ILIKE ${pQ}
            OR COALESCE(y.nombre,'') ILIKE ${pQ}
            OR COALESCE(y.apellido,'') ILIKE ${pQ}
            OR COALESCE(y.titulo,'') ILIKE ${pQ}`;
        }
      }
    }

    const { rows } = await pool.query(
      `
      WITH x AS (
        SELECT
          i.id_informe,
          i.id_proyecto,
          i.id_plantilla,
          i.titulo,
          i.fecha_creado,
          p.nombre AS nombre_plantilla,

          MAX(
            CASE
              WHEN UPPER(q.etiqueta) LIKE '%CI%'
                OR UPPER(q.etiqueta) LIKE '%CEDULA%'
                OR UPPER(q.etiqueta) LIKE '%CÃ‰DULA%'
                OR UPPER(q.etiqueta) LIKE '%DOCUMENTO%'
              THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
            END
          ) AS ci_raw,

          MAX(
            CASE
              WHEN UPPER(q.etiqueta) LIKE '%CODIGO%'
                OR UPPER(q.etiqueta) LIKE '%CÃ“DIGO%'
                OR UPPER(q.etiqueta) LIKE '%CÃ“D%'
              THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
            END
          ) AS codigo_raw,

          MAX(
            CASE
              WHEN UPPER(q.etiqueta) LIKE '%NOMBRE%'
              THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
            END
          ) AS nombre_raw,

          MAX(
            CASE
              WHEN UPPER(q.etiqueta) LIKE '%APELLIDO%'
              THEN COALESCE(r.valor_texto, r.valor_json::text, NULL)
            END
          ) AS apellido_raw

        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
        JOIN ema.informe_pregunta  q ON q.id_pregunta = r.id_pregunta
        WHERE i.id_proyecto = $1
        ${wherePlant}
        GROUP BY
          i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado, p.nombre
      ),
      y AS (
        SELECT
          x.*,
          NULLIF(TRIM(REPLACE(REPLACE(COALESCE(x.ci_raw,''),'"',''),'\\n',' ')),'') AS ci,
          NULLIF(TRIM(REPLACE(REPLACE(COALESCE(x.codigo_raw,''),'"',''),'\\n',' ')),'') AS codigo,
          NULLIF(TRIM(REPLACE(REPLACE(COALESCE(x.nombre_raw,''),'"',''),'\\n',' ')),'') AS nombre,
          NULLIF(TRIM(REPLACE(REPLACE(COALESCE(x.apellido_raw,''),'"',''),'\\n',' ')),'') AS apellido
        FROM x
      )
      SELECT
        y.id_informe,
        y.id_proyecto,
        y.id_plantilla,
        y.nombre_plantilla,
        y.titulo,
        y.fecha_creado,
        y.ci,
        y.codigo,
        y.nombre,
        y.apellido
      FROM y
      ${filterSql}
      ORDER BY y.fecha_creado DESC, y.id_informe DESC
      LIMIT 200
      `,
      baseParams
    );

    const out = rows.map((r) => {
      const nombreFull = [r.nombre, r.apellido].filter(Boolean).join(" ").trim();
      return {
        id_informe: r.id_informe,
        id_proyecto: r.id_proyecto,
        id_plantilla: r.id_plantilla,
        plantilla: r.nombre_plantilla,
        titulo: r.titulo || "",
        fecha_creado: r.fecha_creado,
        ci: r.ci || "",
        codigo: r.codigo || "",
        nombre: nombreFull || r.nombre || "",
        lat: null,
        lng: null,
        props: {
          id_informe: r.id_informe,
          id_proyecto: r.id_proyecto,
          id_plantilla: r.id_plantilla,
          plantilla: r.nombre_plantilla,
          titulo: r.titulo,
          fecha_creado: r.fecha_creado,
          ci: r.ci || null,
          codigo: r.codigo || null,
          nombre: nombreFull || null,
        },
      };
    });

    return res.json({ ok: true, items: out, personas: out });
  } catch (err) {
    console.error("buscarPersonasProyecto error:", err);
    return res.status(500).json({ ok: false, error: err?.detail || err?.message || "Error buscando personas" });
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   9) GET /api/informes/proyecto/:idProyecto/pdf?plantilla=ID
   âœ… PDF individual y PDF completo: mismo formato limpio
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function generarPdfProyecto(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = req.query.plantilla ? Number(req.query.plantilla) : null;

  const orderBy = String(req.query.orderBy || "fecha").toLowerCase();
  const orderDir = String(req.query.orderDir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const orderPreguntaId = Number(req.query.orderPreguntaId || 0);

  const modo = String(req.query.modo || "normal").toLowerCase();
  const isTabla = modo === "tabla" || modo === "excel" || modo === "table";

  const preguntasIds = String(req.query.preguntas || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const seccionesIds = String(req.query.secciones || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const incluirFotos = String(req.query.incluirFotos ?? "1") !== "0";
  const maxFotos = Math.max(0, Number(req.query.maxFotos || 2));

  if (!idProyecto) return res.status(400).send("idProyecto inválido");

  try {
    const proyQ = await pool.query(
      `
      SELECT gid, nombre, codigo
      FROM ema.proyectos
      WHERE gid = $1
      `,
      [idProyecto]
    );

    const proy = proyQ.rows?.[0];
    const proyectoLabel = proy
      ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
      : String(idProyecto);

    let informes = [];

    if (orderBy === "pregunta" && orderPreguntaId > 0) {
      const baseParams = [idProyecto];
      let baseWhere = "";

      if (idPlantilla) {
        baseParams.push(idPlantilla);
        baseWhere += ` AND i.id_plantilla = $${baseParams.length} `;
      }

      baseParams.push(orderPreguntaId);
      const idxPregunta = baseParams.length;
      const orderSql = orderDir === "desc" ? "DESC" : "ASC";

      const q = await pool.query(
        `
        SELECT
          i.*,
          p.nombre AS nombre_plantilla,
          COALESCE(
            NULLIF(TRIM(r.valor_texto), ''),
            NULLIF(TRIM(r.valor_json::text), ''),
            CASE
              WHEN r.valor_bool IS TRUE THEN 'SI'
              WHEN r.valor_bool IS FALSE THEN 'NO'
              ELSE ''
            END
          ) AS valor_orden
        FROM ema.informe i
        JOIN ema.informe_plantilla p
          ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_respuesta r
          ON r.id_informe = i.id_informe
         AND r.id_pregunta = $${idxPregunta}
        WHERE i.id_proyecto = $1
        ${baseWhere}
        ORDER BY
          COALESCE(
            NULLIF(TRIM(r.valor_texto), ''),
            NULLIF(TRIM(r.valor_json::text), ''),
            CASE
              WHEN r.valor_bool IS TRUE THEN 'SI'
              WHEN r.valor_bool IS FALSE THEN 'NO'
              ELSE ''
            END
          ) ${orderSql},
          i.id_informe ${orderSql}
        `,
        baseParams
      );

      informes = q.rows || [];
    } else {
      const params = [idProyecto];
      let whereExtra = "";

      if (idPlantilla) {
        params.push(idPlantilla);
        whereExtra = ` AND i.id_plantilla = $${params.length} `;
      }

      let orderClause = "i.fecha_creado ASC, i.id_informe ASC";

      if (orderBy === "fecha") {
        orderClause =
          orderDir === "desc"
            ? "i.fecha_creado DESC, i.id_informe DESC"
            : "i.fecha_creado ASC, i.id_informe ASC";
      } else if (orderBy === "id") {
        orderClause =
          orderDir === "desc"
            ? "i.id_informe DESC"
            : "i.id_informe ASC";
      }

      const q = await pool.query(
        `
        SELECT i.*, p.nombre AS nombre_plantilla
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        WHERE i.id_proyecto = $1
        ${whereExtra}
        ORDER BY ${orderClause}
        `,
        params
      );

      informes = q.rows || [];
    }

    if (!informes.length) {
      return res.status(404).send("No hay informes para exportar.");
    }

    const uploadsRoot = path.join(__dirname, "..", "uploads");
    const informesBlocks = [];

    function escapeHtml(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatRespuesta(r) {
      let val = r?.valor_texto;

      if (r?.valor_bool !== null && r?.valor_bool !== undefined) {
        val = r.valor_bool ? "Sí" : "No";
      } else if (r?.valor_json !== null && r?.valor_json !== undefined) {
        try {
          const parsed = typeof r.valor_json === "string" ? JSON.parse(r.valor_json) : r.valor_json;

          if (Array.isArray(parsed)) {
            val = parsed.join(", ");
          } else if (parsed && typeof parsed === "object") {
            if ("lat" in parsed && "lng" in parsed) {
              val = `${parsed.lat}, ${parsed.lng}`;
            } else {
              val = JSON.stringify(parsed);
            }
          } else {
            val = String(parsed);
          }
        } catch {
          val = String(r.valor_json);
        }
      }

      return val || "-";
    }

    function buildRespuestasMapLocal(respuestas) {
      const map = {};
      for (const r of respuestas) {
        map[Number(r.id_pregunta)] = formatRespuesta(r);
      }
      return map;
    }

    function renderTablaUnicaHTML({
      informeRows,
      preguntasTodas,
      respuestasMapPorInforme,
      fotosPorInformePorPregunta,
    }) {
      const preguntasOrdenadas = [...preguntasTodas].sort((a, b) => {
        const sa = Number(a.id_seccion || 0);
        const sb = Number(b.id_seccion || 0);
        if (sa !== sb) return sa - sb;

        const oa = Number(a.orden || 0);
        const ob = Number(b.orden || 0);
        if (oa !== ob) return oa - ob;

        return Number(a.id_pregunta || 0) - Number(b.id_pregunta || 0);
      });

      const headers = [
        `<th style="white-space:nowrap;">ID</th>`,
        `<th style="white-space:nowrap;">Fecha</th>`,
        ...preguntasOrdenadas.map(
          (p) => `<th>${escapeHtml(p.etiqueta || "")}</th>`
        ),
      ].join("");

      const rows = informeRows
        .map((inf) => {
          const cols = [
            `<td>${escapeHtml(inf.id_informe)}</td>`,
            `<td style="white-space:nowrap;">${escapeHtml(_formatFechaPY(inf.fecha_creado))}</td>`,
          ];

          for (const p of preguntasOrdenadas) {
            const val =
              respuestasMapPorInforme?.[inf.id_informe]?.[p.id_pregunta] ?? "-";

            let html = `<div>${escapeHtml(val)}</div>`;

            if (incluirFotos) {
              const fotosListOriginal =
                fotosPorInformePorPregunta?.[inf.id_informe]?.[p.id_pregunta] || [];
              const fotosList = fotosListOriginal.slice(0, maxFotos);

              for (const f of fotosList) {
                if (!f?.dataUri) continue;

                html += `
                  <div style="margin-top:6px;">
                    <img src="${f.dataUri}" style="max-width:120px; max-height:80px; display:block;" />
                    ${
                      f.descripcion
                        ? `<div style="font-size:10px;color:#666;margin-top:2px;">${escapeHtml(f.descripcion)}</div>`
                        : ""
                    }
                  </div>
                `;
              }
            }

            cols.push(`<td>${html}</td>`);
          }

          return `<tr>${cols.join("")}</tr>`;
        })
        .join("");

      return `
        <table class="tabla-general">
          <thead>
            <tr>${headers}</tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;
    }

    for (const informe of informes) {
      const seccParams = [informe.id_plantilla];
      let seccWhereExtra = "";

      if (seccionesIds.length) {
        seccParams.push(seccionesIds);
        seccWhereExtra += ` AND id_seccion = ANY($${seccParams.length}::int[]) `;
      }

      const { rows: secciones } = await pool.query(
        `
        SELECT *
        FROM ema.informe_seccion
        WHERE id_plantilla = $1
        ${seccWhereExtra}
        ORDER BY orden
        `,
        seccParams
      );

      if (!secciones.length) continue;

      const seccionesFiltradasIds = secciones
        .map((s) => Number(s.id_seccion))
        .filter(Boolean);

      const pregParams = [informe.id_plantilla];
      let pregWhereExtra = "";

      if (seccionesFiltradasIds.length) {
        pregParams.push(seccionesFiltradasIds);
        pregWhereExtra += ` AND s.id_seccion = ANY($${pregParams.length}::int[]) `;
      }

      if (preguntasIds.length) {
        pregParams.push(preguntasIds);
        pregWhereExtra += ` AND q.id_pregunta = ANY($${pregParams.length}::int[]) `;
      }

      const { rows: preguntas } = await pool.query(
        `
        SELECT q.*
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ${pregWhereExtra}
        ORDER BY s.orden, q.orden
        `,
        pregParams
      );

      if (!preguntas.length) continue;

      const preguntasIdsFiltradas = preguntas.map((p) => Number(p.id_pregunta)).filter(Boolean);

      const { rows: respuestas } = await pool.query(
        `
        SELECT *
        FROM ema.informe_respuesta
        WHERE id_informe = $1
          AND id_pregunta = ANY($2::int[])
        `,
        [informe.id_informe, preguntasIdsFiltradas]
      );

      let fotos = [];
      if (incluirFotos && maxFotos > 0) {
        const fotosQ = await pool.query(
          `
          SELECT *
          FROM ema.informe_foto
          WHERE id_informe = $1
            AND id_pregunta = ANY($2::int[])
          ORDER BY id_pregunta, orden
          `,
          [informe.id_informe, preguntasIdsFiltradas]
        );
        fotos = fotosQ.rows || [];
      }

      const respuestasMap = buildRespuestasMapLocal(respuestas);

      const fotosPorPregunta = {};
      for (const f of fotos) {
        if (!f.id_pregunta) continue;

        const abs = path.join(uploadsRoot, String(f.ruta_archivo || "").replace(/\//g, path.sep));
        const dataUri = fileToDataUri(abs);
        if (!dataUri) continue;

        if (!fotosPorPregunta[f.id_pregunta]) fotosPorPregunta[f.id_pregunta] = [];
        if (fotosPorPregunta[f.id_pregunta].length >= maxFotos) continue;

        fotosPorPregunta[f.id_pregunta].push({
          descripcion: f.descripcion || "",
          dataUri,
        });
      }

      let blockHtml = "";

      if (!isTabla) {
        const seccionesConPreguntas = secciones.filter((sec) =>
          preguntas.some((p) => Number(p.id_seccion) === Number(sec.id_seccion))
        );

        const seccionesHtml = seccionesConPreguntas
          .map((sec) => {
            const preguntasSec = preguntas.filter(
              (p) => Number(p.id_seccion) === Number(sec.id_seccion)
            );

            if (!preguntasSec.length) return "";

            const rowsHtml = preguntasSec
              .map((p) => {
                const valor = respuestasMap[p.id_pregunta] ?? "-";

                let fotosHtml = "";
                if (incluirFotos) {
                  const fotosList = (fotosPorPregunta[p.id_pregunta] || []).slice(0, maxFotos);
                  if (fotosList.length) {
                    fotosHtml = `
                      <div class="fotos-wrap">
                        ${fotosList
                          .map(
                            (fx) => `
                              <div class="foto-item">
                                <img src="${fx.dataUri}" />
                                ${fx.descripcion ? `<div class="foto-desc">${escapeHtml(fx.descripcion)}</div>` : ""}
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    `;
                  }
                }

                return `
                  <tr>
                    <td class="pregunta-col">${escapeHtml(p.etiqueta)}</td>
                    <td class="respuesta-col">
                      <div>${escapeHtml(valor)}</div>
                      ${fotosHtml}
                    </td>
                  </tr>
                `;
              })
              .join("");

            return `
              <h3>${escapeHtml(sec.titulo || "Sección")}</h3>
              <table class="detalle-table">
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            `;
          })
          .join("");

        blockHtml = `
          <div class="informe-block">
            <h2>${escapeHtml(informe.titulo || informe.nombre_plantilla || "INFORME")}</h2>
            <div class="meta-line">
              <strong>ID Informe:</strong> ${escapeHtml(informe.id_informe)}
              &nbsp;&nbsp;&nbsp;
              <strong>Fecha:</strong> ${escapeHtml(_formatFechaPY(informe.fecha_creado))}
            </div>
            ${seccionesHtml}
          </div>
        `;
      } else {
        const tablaHtml = renderTablaUnicaHTML({
          informeRows: [informe],
          preguntasTodas: preguntas,
          respuestasMapPorInforme: {
            [informe.id_informe]: respuestasMap,
          },
          fotosPorInformePorPregunta: {
            [informe.id_informe]: fotosPorPregunta,
          },
        });

        blockHtml = `
          <div class="informe-block">
            <h2>${escapeHtml(informe.nombre_plantilla || "Plantilla")}</h2>
            ${tablaHtml}
          </div>
        `;
      }

      informesBlocks.push(blockHtml);
    }

    if (!informesBlocks.length) {
      return res.status(404).send("No hay datos para exportar con esos filtros.");
    }

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Informes del proyecto</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #222;
            margin: 0;
            padding: 0;
          }
          .page {
            padding: 10px 6px;
          }
          h1 {
            margin: 0 0 8px 0;
            font-size: 24px;
          }
          h2 {
            margin: 14px 0 8px 0;
            font-size: 18px;
          }
          h3 {
            margin: 12px 0 6px 0;
            font-size: 14px;
          }
          .top-meta {
            margin-bottom: 12px;
            line-height: 1.5;
          }
          .meta-line {
            margin-bottom: 8px;
          }
          .informe-block {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          .detalle-table,
          .tabla-general {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-bottom: 12px;
          }
          .detalle-table td,
          .tabla-general th,
          .tabla-general td {
            border: 1px solid #999;
            padding: 4px;
            vertical-align: top;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          .tabla-general th {
            background: #f1f1f1;
            font-weight: bold;
          }
          .pregunta-col {
            width: 35%;
            font-weight: bold;
            background: #fafafa;
          }
          .respuesta-col {
            width: 65%;
          }
          .fotos-wrap {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .foto-item img {
            max-width: 180px;
            max-height: 120px;
            display: block;
            border: 1px solid #ccc;
          }
          .foto-desc {
            font-size: 10px;
            color: #666;
            margin-top: 2px;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <h1>INFORMES DEL PROYECTO</h1>
          <div class="top-meta">
            <div><strong>Proyecto:</strong> ${escapeHtml(proyectoLabel)}</div>
            <div><strong>Generado:</strong> ${escapeHtml(_formatFechaPY(new Date()))}</div>
            <div><strong>Formato:</strong> ${escapeHtml(isTabla ? "TABLA (tipo Excel)" : "NORMAL")}</div>
            <div><strong>Fotos:</strong> ${escapeHtml(incluirFotos ? `Sí (máx. ${maxFotos} por pregunta)` : "No")}</div>
            <div><strong>Orden:</strong> ${
              escapeHtml(
                orderBy === "pregunta" && orderPreguntaId > 0
                  ? `pregunta #${orderPreguntaId} (${orderDir})`
                  : `${orderBy} (${orderDir})`
              )
            }</div>
          </div>
          ${informesBlocks.join("")}
        </div>
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      const page = await browser.newPage();
      await page.emulateMediaType("screen");
      await page.setContent(html, { waitUntil: "load" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        landscape: isTabla,
        margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
      });

      const fileName =
        `Proyecto_${idProyecto}_Informes` +
        `${idPlantilla ? `_Plantilla_${idPlantilla}` : ""}` +
        `${isTabla ? `_TABLA` : `_NORMAL`}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      return res.end(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error("generarPdfProyecto error:", err);
    return res.status(500).send("Error al generar PDF del proyecto");
  }
}

// GET /api/informes/proyecto/:idProyecto/plantillas
// Devuelve TODAS las plantillas permitidas para el proyecto (aunque no tengan informes aÃºn)
async function listAllPlantillasByProyecto(req, res) {
  const { idProyecto } = req.params;
  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  try {
    const idP = Number(idProyecto);
    if (!Number.isFinite(idP) || idP <= 0) {
      return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.id_plantilla,
        p.nombre,
        p.activo,
        CASE
          WHEN $3 = true THEN 'edit'
          WHEN p.id_creador = $2 THEN 'edit'
          ELSE pu.rol
        END AS mi_rol,
        (
          SELECT COUNT(*)::int
          FROM ema.informe i
          WHERE i.id_proyecto = $1
            AND i.id_plantilla = p.id_plantilla
        ) AS total_informes,
        (
          SELECT MAX(i.fecha_creado)
          FROM ema.informe i
          WHERE i.id_proyecto = $1
            AND i.id_plantilla = p.id_plantilla
        ) AS ultimo_informe
      FROM ema.informe_plantilla p
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
       AND pu.id_usuario = $2
      WHERE
        (
          -- âœ… plantillas sin restricciÃ³n de proyecto
          p.proyectos_permitidos IS NULL

          -- âœ… proyectos_permitidos es array (de nÃºmeros o strings) y contiene el idProyecto
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(p.proyectos_permitidos) e(val)
            WHERE e.val = $1::text
          )
        )
        AND (
          -- âœ… permisos: admin / creador / compartida (y activa si no es creador/admin)
          $3 = true
          OR p.id_creador = $2
          OR (
            COALESCE(p.activo, true) = true
            AND pu.id_usuario IS NOT NULL
          )
        )
      ORDER BY p.id_plantilla DESC
      `,
      [idP, Number(userId), isAdmin]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("listAllPlantillasByProyecto error:", err);
    return res.status(500).json({ ok: false, error: "Error al listar plantillas del proyecto" });
  }
}

// âœ… opcional (para webp -> png/jpg)
let sharp = null;
try { sharp = require("sharp"); } catch { /* si no estÃ¡, se omite */ }

// =========================
// ✅ generarWordProyecto ACTUALIZADO
//    - selección de preguntas/secciones
//    - exportación por lote
//    - control de fotos
//    - optimización de imágenes
//    - NO muestra secciones vacías
//    - muestra rango real del lote
// =========================

function normalizeTextForSort(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseProgressiveValue(v) {
  const s = String(v || "").trim();
  if (!s) return Number.POSITIVE_INFINITY;

  const cleaned = s.replace(/[^\d+.,-]/g, "");

  if (cleaned.includes("+")) {
    const [a, b] = cleaned.split("+");
    const n1 = Number(String(a || "0").replace(",", "."));
    const n2 = Number(String(b || "0").replace(",", "."));
    if (Number.isFinite(n1) && Number.isFinite(n2)) {
      return n1 * 1000 + n2;
    }
  }

  const n = Number(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function compareMixed(a, b, dir = "asc") {
  const mul = dir === "desc" ? -1 : 1;

  const aNum = typeof a === "number" ? a : Number.NaN;
  const bNum = typeof b === "number" ? b : Number.NaN;

  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    if (aNum < bNum) return -1 * mul;
    if (aNum > bNum) return 1 * mul;
    return 0;
  }

  const sa = normalizeTextForSort(a);
  const sb = normalizeTextForSort(b);

  if (sa < sb) return -1 * mul;
  if (sa > sb) return 1 * mul;
  return 0;
}

function matchPreguntaOrden(etiqueta = "", orderBy = "fecha") {
  const e = normalizeTextForSort(etiqueta);

  if (orderBy === "progresiva") {
    return (
      e.includes("progresiva") ||
      e.includes("pk") ||
      e.includes("abscisa")
    );
  }

  if (orderBy === "tramo") {
    return (
      e === "tramo" ||
      e.includes("tramo ") ||
      e.includes("subtramo")
    );
  }

  return false;
}

async function obtenerInformesOrdenadosProyecto({
  idProyecto,
  idPlantilla,
  orderBy = "fecha",
  orderDir = "asc",
}) {
  const dir = String(orderDir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const order = String(orderBy || "fecha").toLowerCase();

  const baseParams = [idProyecto];
  let whereExtra = "";

  if (idPlantilla) {
    baseParams.push(idPlantilla);
    whereExtra = ` AND i.id_plantilla = $${baseParams.length} `;
  }

  const baseQ = await pool.query(
    `
    SELECT i.*, p.nombre AS nombre_plantilla
    FROM ema.informe i
    JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    WHERE i.id_proyecto = $1
    ${whereExtra}
    `,
    baseParams
  );

  let baseInformes = baseQ.rows || [];
  if (!baseInformes.length) return [];

  if (order === "fecha") {
    baseInformes.sort((a, b) => {
      const fa = new Date(a.fecha_creado).getTime() || 0;
      const fb = new Date(b.fecha_creado).getTime() || 0;

      if (fa !== fb) {
        return dir === "desc" ? fb - fa : fa - fb;
      }

      return dir === "desc"
        ? Number(b.id_informe) - Number(a.id_informe)
        : Number(a.id_informe) - Number(b.id_informe);
    });

    return baseInformes;
  }

  const plantillas = [
    ...new Set(baseInformes.map((x) => Number(x.id_plantilla)).filter(Boolean)),
  ];

  const preguntasOrden = new Map();

  for (const idPlant of plantillas) {
    const pq = await pool.query(
      `
      SELECT q.id_pregunta, q.etiqueta
      FROM ema.informe_pregunta q
      JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
      WHERE s.id_plantilla = $1
      ORDER BY s.orden, q.orden
      `,
      [idPlant]
    );

    const candidata = (pq.rows || []).find((r) => matchPreguntaOrden(r.etiqueta, order));
    preguntasOrden.set(idPlant, candidata ? Number(candidata.id_pregunta) : null);
  }

  const idsInformes = baseInformes.map((x) => Number(x.id_informe)).filter(Boolean);
  const idsPregOrden = [...new Set([...preguntasOrden.values()].filter(Boolean))];

  let respuestasOrdenRows = [];
  if (idsInformes.length && idsPregOrden.length) {
    const rq = await pool.query(
      `
      SELECT id_informe, id_pregunta, valor_texto, valor_json
      FROM ema.informe_respuesta
      WHERE id_informe = ANY($1::int[])
        AND id_pregunta = ANY($2::int[])
      `,
      [idsInformes, idsPregOrden]
    );
    respuestasOrdenRows = rq.rows || [];
  }

  const respuestaOrdenMap = new Map();
  for (const r of respuestasOrdenRows) {
    let valor = r.valor_texto;

    if (!valor && r.valor_json != null) {
      if (typeof r.valor_json === "string") {
        valor = r.valor_json;
      } else if (typeof r.valor_json === "object") {
        valor =
          r.valor_json?.label ??
          r.valor_json?.nombre ??
          r.valor_json?.value ??
          JSON.stringify(r.valor_json);
      }
    }

    respuestaOrdenMap.set(`${r.id_informe}_${r.id_pregunta}`, valor || "");
  }

  baseInformes = baseInformes.map((inf) => {
    const idPlant = Number(inf.id_plantilla);
    const idPregOrden = preguntasOrden.get(idPlant);

    let sortValueRaw = "";
    if (idPregOrden) {
      sortValueRaw = respuestaOrdenMap.get(`${inf.id_informe}_${idPregOrden}`) || "";
    }

    return {
      ...inf,
      __sortValueRaw: sortValueRaw,
      __sortValue:
        order === "progresiva"
          ? parseProgressiveValue(sortValueRaw)
          : normalizeTextForSort(sortValueRaw),
    };
  });

  baseInformes.sort((a, b) => {
    const cmp = compareMixed(a.__sortValue, b.__sortValue, dir);
    if (cmp !== 0) return cmp;

    const fa = new Date(a.fecha_creado).getTime() || 0;
    const fb = new Date(b.fecha_creado).getTime() || 0;

    if (fa !== fb) {
      return dir === "desc" ? fb - fa : fa - fb;
    }

    return dir === "desc"
      ? Number(b.id_informe) - Number(a.id_informe)
      : Number(a.id_informe) - Number(b.id_informe);
  });

  return baseInformes;
}

async function generarWordProyecto(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = req.query.plantilla ? Number(req.query.plantilla) : null;

  const modo = String(req.query.modo || "normal").toLowerCase();
  const isTabla = modo === "tabla" || modo === "excel" || modo === "table";

  const preguntasIds = String(req.query.preguntas || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const seccionesIds = String(req.query.secciones || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const incluirFotos = String(req.query.incluirFotos ?? "1") !== "0";
  const fotosEnTabla = String(req.query.fotosEnTabla ?? "0") === "1";
  const maxFotos = Math.max(0, Number(req.query.maxFotos || 2));

  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
  const offset = (page - 1) * limit;

  if (!idProyecto) {
    return res.status(400).send("idProyecto inválido");
  }

  try {
    const proyQ = await pool.query(
      `
      SELECT gid, nombre, codigo
      FROM ema.proyectos
      WHERE gid = $1
      `,
      [idProyecto]
    );

    const proy = proyQ.rows?.[0];
    const proyectoLabel = proy
      ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
      : String(idProyecto);

    const totalParams = [idProyecto];
    let totalWhereExtra = "";

    if (idPlantilla) {
      totalParams.push(idPlantilla);
      totalWhereExtra += ` AND i.id_plantilla = $${totalParams.length} `;
    }

    const totalQ = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ema.informe i
      WHERE i.id_proyecto = $1
      ${totalWhereExtra}
      `,
      totalParams
    );

    const totalInformes = Number(totalQ.rows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalInformes / limit));
    const desde = totalInformes === 0 ? 0 : offset + 1;

    let informes = [];

    if (orderBy === "pregunta" && orderPreguntaId > 0) {
      const baseParams = [idProyecto];
      let baseWhere = "";

      if (idPlantilla) {
        baseParams.push(idPlantilla);
        baseWhere += ` AND i.id_plantilla = $${baseParams.length} `;
      }

      baseParams.push(orderPreguntaId);
      const idxPregunta = baseParams.length;
      const idxLimit = idxPregunta + 1;
      const idxOffset = idxPregunta + 2;
      const orderSql = orderDir === "desc" ? "DESC" : "ASC";

      const q = await pool.query(
        `
        SELECT
          i.*,
          p.nombre AS nombre_plantilla,
          COALESCE(
            NULLIF(TRIM(ir.valor_texto), ''),
            NULLIF(TRIM(ir.valor_json::text), ''),
            CASE
              WHEN ir.valor_bool IS TRUE THEN 'SI'
              WHEN ir.valor_bool IS FALSE THEN 'NO'
              ELSE ''
            END
          ) AS valor_orden
        FROM ema.informe i
        JOIN ema.informe_plantilla p
          ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_respuesta ir
          ON ir.id_informe = i.id_informe
         AND ir.id_pregunta = $${idxPregunta}
        WHERE i.id_proyecto = $1
        ${baseWhere}
        ORDER BY
          COALESCE(
            NULLIF(TRIM(ir.valor_texto), ''),
            NULLIF(TRIM(ir.valor_json::text), ''),
            CASE
              WHEN ir.valor_bool IS TRUE THEN 'SI'
              WHEN ir.valor_bool IS FALSE THEN 'NO'
              ELSE ''
            END
          ) ${orderSql},
          i.id_informe ${orderSql}
        LIMIT $${idxLimit} OFFSET $${idxOffset}
        `,
        [...baseParams, limit, offset]
      );

      informes = q.rows || [];
    } else {
      const params = [idProyecto];
      let whereExtra = "";

      if (idPlantilla) {
        params.push(idPlantilla);
        whereExtra = ` AND i.id_plantilla = $${params.length} `;
      }

      let orderClause = "i.fecha_creado ASC, i.id_informe ASC";

      if (orderBy === "fecha") {
        orderClause =
          orderDir === "desc"
            ? "i.fecha_creado DESC, i.id_informe DESC"
            : "i.fecha_creado ASC, i.id_informe ASC";
      } else if (orderBy === "id") {
        orderClause =
          orderDir === "desc"
            ? "i.id_informe DESC"
            : "i.id_informe ASC";
      }

      params.push(limit);
      const idxLimit = params.length;

      params.push(offset);
      const idxOffset = params.length;

      const q = await pool.query(
        `
        SELECT i.*, p.nombre AS nombre_plantilla
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        WHERE i.id_proyecto = $1
        ${whereExtra}
        ORDER BY ${orderClause}
        LIMIT $${idxLimit} OFFSET $${idxOffset}
        `,
        params
      );

      informes = q.rows || [];
    }

    if (!informes.length) {
      return res.status(404).send("No hay informes para exportar en ese lote.");
    }

    const hasta = offset + informes.length;
    const uploadsRoot = path.join(__dirname, "..", "uploads");
    const children = [];

    children.push(
      new Paragraph({
        text: "INFORMES DEL PROYECTO",
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Proyecto: ", bold: true }),
          new TextRun({ text: proyectoLabel }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Generado: ", bold: true }),
          new TextRun({ text: _formatFechaPY(new Date()) }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Formato: ", bold: true }),
          new TextRun({ text: isTabla ? "TABLA (tipo Excel)" : "NORMAL" }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Lote: ", bold: true }),
          new TextRun({ text: `${page} / ${totalPages}` }),
          new TextRun({ text: "   Registros en este lote: ", bold: true }),
          new TextRun({ text: `${informes.length}` }),
          new TextRun({ text: "   Rango: ", bold: true }),
          new TextRun({ text: `${desde} - ${hasta}` }),
          new TextRun({ text: "   Total informes: ", bold: true }),
          new TextRun({ text: `${totalInformes}` }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Fotos: ", bold: true }),
          new TextRun({
            text: incluirFotos ? `Sí (máx. ${maxFotos} por pregunta)` : "No",
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Orden: ", bold: true }),
          new TextRun({
            text:
              orderBy === "pregunta" && orderPreguntaId > 0
                ? `pregunta #${orderPreguntaId} (${orderDir})`
                : `${orderBy} (${orderDir})`,
          }),
        ],
      }),
      new Paragraph({ text: " " })
    );

    const informesPorPlantilla = new Map();
    for (const inf of informes) {
      const k = Number(inf.id_plantilla);
      if (!informesPorPlantilla.has(k)) informesPorPlantilla.set(k, []);
      informesPorPlantilla.get(k).push(inf);
    }

    async function readImageForDocx(absPath, maxWidth = 1400) {
      if (!absPath || !fs.existsSync(absPath)) return null;

      const ext = String(path.extname(absPath) || "").toLowerCase();
      const buf = fs.readFileSync(absPath);

      if (!sharp) {
        if (ext === ".jpg" || ext === ".jpeg") return { buffer: buf, ext: "jpg" };
        if (ext === ".png") return { buffer: buf, ext: "png" };
        return null;
      }

      try {
        let pipeline = sharp(buf).rotate().resize({
          width: maxWidth,
          withoutEnlargement: true,
        });

        if (ext === ".png") {
          const out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
          return { buffer: out, ext: "png" };
        }

        const out = await pipeline.jpeg({ quality: 75 }).toBuffer();
        return { buffer: out, ext: "jpg" };
      } catch (e) {
        console.warn("No se pudo optimizar imagen:", absPath, e?.message || e);
        return null;
      }
    }

    async function buildTablaUnica({
      preguntasTodas,
      informesPlantilla,
      respuestasMapPorInforme,
      fotosPorInformePorPregunta,
    }) {
      const preguntasOrdenadas = [...preguntasTodas].sort((a, b) => {
        const sa = Number(a.id_seccion || 0);
        const sb = Number(b.id_seccion || 0);
        if (sa !== sb) return sa - sb;

        const oa = Number(a.orden || 0);
        const ob = Number(b.orden || 0);
        if (oa !== ob) return oa - ob;

        return Number(a.id_pregunta || 0) - Number(b.id_pregunta || 0);
      });

      const headerCells = [
        new TableCell({
          width: { size: 7, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "ID", bold: true })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 13, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Fecha", bold: true })],
            }),
          ],
        }),
      ];

      const perQ = Math.max(1, Math.floor(80 / Math.max(1, preguntasOrdenadas.length)));

      for (const p of preguntasOrdenadas) {
        headerCells.push(
          new TableCell({
            width: { size: perQ, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: safeStr(p.etiqueta || ""),
                    bold: true,
                  }),
                ],
              }),
            ],
          })
        );
      }

      const rows = [new TableRow({ children: headerCells })];

      for (const inf of informesPlantilla) {
        const rowCells = [
          new TableCell({
            width: { size: 7, type: WidthType.PERCENTAGE },
            children: [new Paragraph(String(inf.id_informe))],
          }),
          new TableCell({
            width: { size: 13, type: WidthType.PERCENTAGE },
            children: [new Paragraph(_formatFechaPY(inf.fecha_creado))],
          }),
        ];

        for (const p of preguntasOrdenadas) {
          const val = respuestasMapPorInforme?.[inf.id_informe]?.[p.id_pregunta] ?? "-";

          const cellChildren = [
            new Paragraph({
              children: [new TextRun({ text: safeStr(val) })],
            }),
          ];

          if (incluirFotos && fotosEnTabla) {
            const fotosListOriginal =
              fotosPorInformePorPregunta?.[inf.id_informe]?.[p.id_pregunta] || [];

            const fotosList = fotosListOriginal.slice(0, maxFotos);

            for (const f of fotosList) {
              if (!f?.buffer) continue;

              cellChildren.push(
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: f.buffer,
                      transformation: { width: 120, height: 80 },
                    }),
                  ],
                })
              );

              if (f.descripcion) {
                cellChildren.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: safeStr(f.descripcion),
                        size: 18,
                        color: "666666",
                      }),
                    ],
                  })
                );
              }
            }
          }

          rowCells.push(
            new TableCell({
              width: { size: perQ, type: WidthType.PERCENTAGE },
              children: cellChildren,
            })
          );
        }

        rows.push(new TableRow({ children: rowCells }));
      }

      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
      });
    }

    for (const [idPlant, infosPlantilla] of informesPorPlantilla.entries()) {
      const nombrePlantilla = infosPlantilla[0]?.nombre_plantilla || String(idPlant);

      children.push(
        new Paragraph({
          text: `Plantilla: ${safeStr(nombrePlantilla)}`,
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: " " })
      );

      const seccParams = [idPlant];
      let seccWhereExtra = "";

      if (seccionesIds.length) {
        seccParams.push(seccionesIds);
        seccWhereExtra += ` AND id_seccion = ANY($${seccParams.length}::int[]) `;
      }

      const { rows: secciones } = await pool.query(
        `
        SELECT *
        FROM ema.informe_seccion
        WHERE id_plantilla = $1
        ${seccWhereExtra}
        ORDER BY orden
        `,
        seccParams
      );

      if (!secciones.length) continue;

      const seccionesFiltradasIds = secciones
        .map((s) => Number(s.id_seccion))
        .filter(Boolean);

      const pregParams = [idPlant];
      let pregWhereExtra = "";

      if (seccionesFiltradasIds.length) {
        pregParams.push(seccionesFiltradasIds);
        pregWhereExtra += ` AND s.id_seccion = ANY($${pregParams.length}::int[]) `;
      }

      if (preguntasIds.length) {
        pregParams.push(preguntasIds);
        pregWhereExtra += ` AND q.id_pregunta = ANY($${pregParams.length}::int[]) `;
      }

      const { rows: preguntas } = await pool.query(
        `
        SELECT q.*
        FROM ema.informe_pregunta q
        JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
        WHERE s.id_plantilla = $1
        ${pregWhereExtra}
        ORDER BY s.orden, q.orden
        `,
        pregParams
      );

      const preguntasIdsFiltradas = preguntas
        .map((x) => Number(x.id_pregunta))
        .filter(Boolean);

      const seccionesConPreguntas = secciones.filter((sec) =>
        preguntas.some((p) => Number(p.id_seccion) === Number(sec.id_seccion))
      );

      if (!seccionesConPreguntas.length || !preguntasIdsFiltradas.length) {
        continue;
      }

      const idsInformes = infosPlantilla
        .map((x) => Number(x.id_informe))
        .filter(Boolean);

      let respuestasAll = [];
      if (idsInformes.length && preguntasIdsFiltradas.length) {
        const respQ = await pool.query(
          `
          SELECT *
          FROM ema.informe_respuesta
          WHERE id_informe = ANY($1::int[])
            AND id_pregunta = ANY($2::int[])
          `,
          [idsInformes, preguntasIdsFiltradas]
        );
        respuestasAll = respQ.rows || [];
      }

      let fotosAll = [];
      if (incluirFotos && idsInformes.length && preguntasIdsFiltradas.length && maxFotos > 0) {
        const fotosQ = await pool.query(
          `
          SELECT *
          FROM ema.informe_foto
          WHERE id_informe = ANY($1::int[])
            AND id_pregunta = ANY($2::int[])
          ORDER BY id_informe, id_pregunta, orden
          `,
          [idsInformes, preguntasIdsFiltradas]
        );
        fotosAll = fotosQ.rows || [];
      }

      const respuestasMapPorInforme = {};
      for (const inf of idsInformes) respuestasMapPorInforme[inf] = {};

      for (const r of respuestasAll) {
        const infId = Number(r.id_informe);
        const pId = Number(r.id_pregunta);
        const val = buildRespuestasMap([r])[pId];
        if (!respuestasMapPorInforme[infId]) respuestasMapPorInforme[infId] = {};
        respuestasMapPorInforme[infId][pId] = val || "-";
      }

      const fotosPorInformePorPregunta = {};
      for (const infId of idsInformes) fotosPorInformePorPregunta[infId] = {};

      if (incluirFotos && fotosAll.length && maxFotos > 0) {
        const contadorFotos = {};

        for (const f of fotosAll) {
          const infId = Number(f.id_informe);
          const pId = Number(f.id_pregunta);
          if (!infId || !pId) continue;

          const key = `${infId}_${pId}`;
          contadorFotos[key] = contadorFotos[key] || 0;
          if (contadorFotos[key] >= maxFotos) continue;

          const abs = path.join(
            uploadsRoot,
            String(f.ruta_archivo || "").replace(/\//g, path.sep)
          );

          const img = await readImageForDocx(abs, isTabla ? 900 : 1400);
          if (!img?.buffer) continue;

          if (!fotosPorInformePorPregunta[infId][pId]) {
            fotosPorInformePorPregunta[infId][pId] = [];
          }

          fotosPorInformePorPregunta[infId][pId].push({
            descripcion: f.descripcion || "",
            buffer: img.buffer,
          });

          contadorFotos[key]++;
        }
      }

      if (!isTabla) {
        for (const informe of infosPlantilla) {
          const respuestasMap = respuestasMapPorInforme[informe.id_informe] || {};

          children.push(
            new Paragraph({
              text: safeStr(informe.titulo || nombrePlantilla || "INFORME"),
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "ID Informe: ", bold: true }),
                new TextRun(String(informe.id_informe)),
                new TextRun({ text: "   Fecha: ", bold: true }),
                new TextRun(_formatFechaPY(informe.fecha_creado)),
              ],
            }),
            new Paragraph({ text: " " })
          );

          for (const sec of seccionesConPreguntas) {
            const preguntasSec = preguntas.filter(
              (p) => Number(p.id_seccion) === Number(sec.id_seccion)
            );

            if (!preguntasSec.length) continue;

            children.push(
              new Paragraph({
                text: safeStr(sec.titulo || "Sección"),
                heading: HeadingLevel.HEADING_3,
              })
            );

            const rows = preguntasSec.map((p) => {
              const valor = respuestasMap[p.id_pregunta] ?? "-";

              return new TableRow({
                children: [
                  new TableCell({
                    width: { size: 45, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: safeStr(p.etiqueta),
                            bold: true,
                          }),
                        ],
                      }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 55, type: WidthType.PERCENTAGE },
                    children: [new Paragraph(safeStr(valor))],
                  }),
                ],
              });
            });

            children.push(
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows,
              }),
              new Paragraph({ text: " " })
            );

            if (incluirFotos && maxFotos > 0) {
              for (const p of preguntasSec) {
                const fotosListOriginal =
                  fotosPorInformePorPregunta?.[informe.id_informe]?.[p.id_pregunta] || [];

                const fotosList = fotosListOriginal.slice(0, maxFotos);
                if (!fotosList.length) continue;

                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Fotos - ${safeStr(p.etiqueta)}`,
                        italics: true,
                      }),
                    ],
                  })
                );

                for (const fx of fotosList) {
                  children.push(
                    new Paragraph({
                      children: [
                        new ImageRun({
                          data: fx.buffer,
                          transformation: { width: 460, height: 260 },
                        }),
                      ],
                    })
                  );

                  if (fx.descripcion) {
                    children.push(
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: safeStr(fx.descripcion),
                            size: 18,
                            color: "666666",
                          }),
                        ],
                      })
                    );
                  }
                }

                children.push(new Paragraph({ text: " " }));
              }
            }
          }

          children.push(new Paragraph({ children: [], pageBreakBefore: true }));
        }
      } else {
        const preguntasTodas = [...preguntas];

        if (preguntasTodas.length) {
          const tabla = await buildTablaUnica({
            preguntasTodas,
            informesPlantilla: infosPlantilla,
            respuestasMapPorInforme,
            fotosPorInformePorPregunta,
          });

          children.push(tabla);
          children.push(new Paragraph({ text: " " }));
        }

        children.push(new Paragraph({ children: [], pageBreakBefore: true }));
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: isTabla
            ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
            : {},
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const fileName =
      `Proyecto_${idProyecto}` +
      `${idPlantilla ? `_Plantilla_${idPlantilla}` : ""}` +
      `_Lote_${page}_de_${totalPages}` +
      `_${isTabla ? "TABLA" : "NORMAL"}.docx`;

    res.setHeader("X-Export-Page", String(page));
    res.setHeader("X-Export-Limit", String(limit));
    res.setHeader("X-Export-Total", String(totalInformes));
    res.setHeader("X-Export-Total-Pages", String(totalPages));
    res.setHeader("X-Export-Range-From", String(desde));
    res.setHeader("X-Export-Range-To", String(hasta));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);

    return res.end(buffer);
  } catch (err) {
    console.error("generarWordProyecto error:", err);
    return res.status(500).send("Error al generar Word del proyecto");
  }
}

async function generarWordProyectoRangoUnico(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantilla = req.query.plantilla ? Number(req.query.plantilla) : null;

  const orderBy = String(req.query.orderBy || "fecha").toLowerCase();
  const orderDir = String(req.query.orderDir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const orderPreguntaId = Number(req.query.orderPreguntaId || 0);

  const modo = String(req.query.modo || "normal").toLowerCase();
  const isTabla = modo === "tabla" || modo === "excel" || modo === "table";

  const preguntasIds = String(req.query.preguntas || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const seccionesIds = String(req.query.secciones || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);

  const incluirFotos = String(req.query.incluirFotos ?? "1") !== "0";
  const fotosEnTabla = String(req.query.fotosEnTabla ?? "0") === "1";
  const maxFotos = Math.max(0, Number(req.query.maxFotos || 2));

  let limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
  if (incluirFotos) {
    limit = Math.min(limit, 20);
  }

  const fromPage = Math.max(1, Number(req.query.fromPage || 1));
  let toPage = Math.max(fromPage, Number(req.query.toPage || fromPage));

  if (!idProyecto) {
    return res.status(400).send("idProyecto inválido");
  }

  try {
    const proyQ = await pool.query(
      `
      SELECT gid, nombre, codigo
      FROM ema.proyectos
      WHERE gid = $1
      `,
      [idProyecto]
    );

    const proy = proyQ.rows?.[0];
    const proyectoLabel = proy
      ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
      : String(idProyecto);

    const totalParams = [idProyecto];
    let totalWhereExtra = "";

    if (idPlantilla) {
      totalParams.push(idPlantilla);
      totalWhereExtra += ` AND i.id_plantilla = $${totalParams.length} `;
    }

    const totalQ = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ema.informe i
      WHERE i.id_proyecto = $1
      ${totalWhereExtra}
      `,
      totalParams
    );

    const totalInformes = Number(totalQ.rows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalInformes / limit));

    if (toPage > totalPages) toPage = totalPages;

    const uploadsRoot = path.join(__dirname, "..", "uploads");
    const children = [];

    children.push(
      new Paragraph({
        text: "INFORMES DEL PROYECTO",
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Proyecto: ", bold: true }),
          new TextRun({ text: proyectoLabel }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Generado: ", bold: true }),
          new TextRun({ text: _formatFechaPY(new Date()) }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Formato: ", bold: true }),
          new TextRun({ text: isTabla ? "TABLA (tipo Excel)" : "NORMAL" }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Rango de lotes: ", bold: true }),
          new TextRun({ text: `${fromPage} a ${toPage}` }),
          new TextRun({ text: "   Registros por lote: ", bold: true }),
          new TextRun({ text: `${limit}` }),
          new TextRun({ text: "   Total informes: ", bold: true }),
          new TextRun({ text: `${totalInformes}` }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Fotos: ", bold: true }),
          new TextRun({
            text: incluirFotos ? `Sí (máx. ${maxFotos} por pregunta)` : "No",
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Orden: ", bold: true }),
          new TextRun({
            text:
              orderBy === "pregunta" && orderPreguntaId > 0
                ? `pregunta #${orderPreguntaId} (${orderDir})`
                : `${orderBy} (${orderDir})`,
          }),
        ],
      }),
      new Paragraph({ text: " " })
    );

    async function readImageForDocx(absPath, maxWidth = 1400) {
      if (!absPath || !fs.existsSync(absPath)) return null;

      const ext = String(path.extname(absPath) || "").toLowerCase();
      const buf = fs.readFileSync(absPath);

      if (!sharp) {
        if (ext === ".jpg" || ext === ".jpeg") return { buffer: buf, ext: "jpg" };
        if (ext === ".png") return { buffer: buf, ext: "png" };
        return null;
      }

      try {
        let pipeline = sharp(buf).rotate().resize({
          width: maxWidth,
          withoutEnlargement: true,
        });

        if (ext === ".png") {
          const out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
          return { buffer: out, ext: "png" };
        }

        const out = await pipeline.jpeg({ quality: 75 }).toBuffer();
        return { buffer: out, ext: "jpg" };
      } catch {
        return null;
      }
    }

    async function buildTablaUnica({
      preguntasTodas,
      informesPlantilla,
      respuestasMapPorInforme,
      fotosPorInformePorPregunta,
    }) {
      const preguntasOrdenadas = [...preguntasTodas].sort((a, b) => {
        const sa = Number(a.id_seccion || 0);
        const sb = Number(b.id_seccion || 0);
        if (sa !== sb) return sa - sb;

        const oa = Number(a.orden || 0);
        const ob = Number(b.orden || 0);
        if (oa !== ob) return oa - ob;

        return Number(a.id_pregunta || 0) - Number(b.id_pregunta || 0);
      });

      const headerCells = [
        new TableCell({
          width: { size: 7, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: "ID", bold: true })] })],
        }),
        new TableCell({
          width: { size: 13, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: "Fecha", bold: true })] })],
        }),
      ];

      const perQ = Math.max(1, Math.floor(80 / Math.max(1, preguntasOrdenadas.length)));

      for (const p of preguntasOrdenadas) {
        headerCells.push(
          new TableCell({
            width: { size: perQ, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                children: [new TextRun({ text: safeStr(p.etiqueta || ""), bold: true })],
              }),
            ],
          })
        );
      }

      const rows = [new TableRow({ children: headerCells })];

      for (const inf of informesPlantilla) {
        const rowCells = [];

        rowCells.push(
          new TableCell({
            width: { size: 7, type: WidthType.PERCENTAGE },
            children: [new Paragraph(String(inf.id_informe))],
          }),
          new TableCell({
            width: { size: 13, type: WidthType.PERCENTAGE },
            children: [new Paragraph(_formatFechaPY(inf.fecha_creado))],
          })
        );

        for (const p of preguntasOrdenadas) {
          const val = respuestasMapPorInforme?.[inf.id_informe]?.[p.id_pregunta] ?? "-";

          const cellChildren = [
            new Paragraph({
              children: [new TextRun({ text: safeStr(val) })],
            }),
          ];

          if (incluirFotos && fotosEnTabla) {
            const fotosListOriginal =
              fotosPorInformePorPregunta?.[inf.id_informe]?.[p.id_pregunta] || [];

            const fotosList = fotosListOriginal.slice(0, maxFotos);

            for (const f of fotosList) {
              if (!f?.buffer) continue;

              cellChildren.push(
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: f.buffer,
                      transformation: { width: 120, height: 80 },
                    }),
                  ],
                })
              );

              if (f.descripcion) {
                cellChildren.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: safeStr(f.descripcion),
                        size: 18,
                        color: "666666",
                      }),
                    ],
                  })
                );
              }
            }
          }

          rowCells.push(
            new TableCell({
              width: { size: perQ, type: WidthType.PERCENTAGE },
              children: cellChildren,
            })
          );
        }

        rows.push(new TableRow({ children: rowCells }));
      }

      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
      });
    }

    for (let currentPage = fromPage; currentPage <= toPage; currentPage++) {
      const offset = (currentPage - 1) * limit;
      let infosPagina = [];

      if (orderBy === "pregunta" && orderPreguntaId > 0) {
        const baseParams = [idProyecto];
        let baseWhere = "";

        if (idPlantilla) {
          baseParams.push(idPlantilla);
          baseWhere += ` AND i.id_plantilla = $${baseParams.length} `;
        }

        baseParams.push(orderPreguntaId);
        const idxPregunta = baseParams.length;
        const idxLimit = idxPregunta + 1;
        const idxOffset = idxPregunta + 2;
        const orderSql = orderDir === "desc" ? "DESC" : "ASC";

        const q = await pool.query(
          `
          SELECT
            i.*,
            p.nombre AS nombre_plantilla,
            COALESCE(
              NULLIF(TRIM(ir.valor_texto), ''),
              NULLIF(TRIM(ir.valor_json::text), ''),
              CASE
                WHEN ir.valor_bool IS TRUE THEN 'SI'
                WHEN ir.valor_bool IS FALSE THEN 'NO'
                ELSE ''
              END
            ) AS valor_orden
          FROM ema.informe i
          JOIN ema.informe_plantilla p
            ON p.id_plantilla = i.id_plantilla
          LEFT JOIN ema.informe_respuesta ir
            ON ir.id_informe = i.id_informe
           AND ir.id_pregunta = $${idxPregunta}
          WHERE i.id_proyecto = $1
          ${baseWhere}
          ORDER BY
            COALESCE(
              NULLIF(TRIM(ir.valor_texto), ''),
              NULLIF(TRIM(ir.valor_json::text), ''),
              CASE
                WHEN ir.valor_bool IS TRUE THEN 'SI'
                WHEN ir.valor_bool IS FALSE THEN 'NO'
                ELSE ''
              END
            ) ${orderSql},
            i.id_informe ${orderSql}
          LIMIT $${idxLimit} OFFSET $${idxOffset}
          `,
          [...baseParams, limit, offset]
        );

        infosPagina = q.rows || [];
      } else {
        const params = [idProyecto];
        let whereExtra = "";

        if (idPlantilla) {
          params.push(idPlantilla);
          whereExtra = ` AND i.id_plantilla = $${params.length} `;
        }

        let orderClause = "i.fecha_creado ASC, i.id_informe ASC";

        if (orderBy === "fecha") {
          orderClause =
            orderDir === "desc"
              ? "i.fecha_creado DESC, i.id_informe DESC"
              : "i.fecha_creado ASC, i.id_informe ASC";
        } else if (orderBy === "id") {
          orderClause =
            orderDir === "desc"
              ? "i.id_informe DESC"
              : "i.id_informe ASC";
        }

        params.push(limit);
        const idxLimit = params.length;

        params.push(offset);
        const idxOffset = params.length;

        const q = await pool.query(
          `
          SELECT i.*, p.nombre AS nombre_plantilla
          FROM ema.informe i
          JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
          WHERE i.id_proyecto = $1
          ${whereExtra}
          ORDER BY ${orderClause}
          LIMIT $${idxLimit} OFFSET $${idxOffset}
          `,
          params
        );

        infosPagina = q.rows || [];
      }

      if (!infosPagina.length) continue;

      const informesPorPlantilla = new Map();
      for (const inf of infosPagina) {
        const k = Number(inf.id_plantilla);
        if (!informesPorPlantilla.has(k)) informesPorPlantilla.set(k, []);
        informesPorPlantilla.get(k).push(inf);
      }

      children.push(
        new Paragraph({
          text: `LOTE ${currentPage} (${offset + 1} - ${offset + infosPagina.length})`,
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: " " })
      );

      for (const [idPlant, infosPlantilla] of informesPorPlantilla.entries()) {
        const nombrePlantilla = infosPlantilla[0]?.nombre_plantilla || String(idPlant);

        children.push(
          new Paragraph({
            text: `Plantilla: ${safeStr(nombrePlantilla)}`,
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({ text: " " })
        );

        const seccParams = [idPlant];
        let seccWhereExtra = "";

        if (seccionesIds.length) {
          seccParams.push(seccionesIds);
          seccWhereExtra += ` AND id_seccion = ANY($${seccParams.length}::int[]) `;
        }

        const { rows: secciones } = await pool.query(
          `
          SELECT *
          FROM ema.informe_seccion
          WHERE id_plantilla = $1
          ${seccWhereExtra}
          ORDER BY orden
          `,
          seccParams
        );

        if (!secciones.length) continue;

        const seccionesFiltradasIds = secciones
          .map((s) => Number(s.id_seccion))
          .filter(Boolean);

        const pregParams = [idPlant];
        let pregWhereExtra = "";

        if (seccionesFiltradasIds.length) {
          pregParams.push(seccionesFiltradasIds);
          pregWhereExtra += ` AND s.id_seccion = ANY($${pregParams.length}::int[]) `;
        }

        if (preguntasIds.length) {
          pregParams.push(preguntasIds);
          pregWhereExtra += ` AND q.id_pregunta = ANY($${pregParams.length}::int[]) `;
        }

        const { rows: preguntas } = await pool.query(
          `
          SELECT q.*
          FROM ema.informe_pregunta q
          JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
          WHERE s.id_plantilla = $1
          ${pregWhereExtra}
          ORDER BY s.orden, q.orden
          `,
          pregParams
        );

        const preguntasIdsFiltradas = preguntas
          .map((x) => Number(x.id_pregunta))
          .filter(Boolean);

        const seccionesConPreguntas = secciones.filter((sec) =>
          preguntas.some((p) => Number(p.id_seccion) === Number(sec.id_seccion))
        );

        if (!seccionesConPreguntas.length || !preguntasIdsFiltradas.length) {
          continue;
        }

        const idsInformes = infosPlantilla
          .map((x) => Number(x.id_informe))
          .filter(Boolean);

        let respuestasAll = [];
        if (idsInformes.length && preguntasIdsFiltradas.length) {
          const respQ = await pool.query(
            `
            SELECT *
            FROM ema.informe_respuesta
            WHERE id_informe = ANY($1::int[])
              AND id_pregunta = ANY($2::int[])
            `,
            [idsInformes, preguntasIdsFiltradas]
          );
          respuestasAll = respQ.rows || [];
        }

        let fotosAll = [];
        if (incluirFotos && idsInformes.length && preguntasIdsFiltradas.length && maxFotos > 0) {
          const fotosQ = await pool.query(
            `
            SELECT *
            FROM ema.informe_foto
            WHERE id_informe = ANY($1::int[])
              AND id_pregunta = ANY($2::int[])
            ORDER BY id_informe, id_pregunta, orden
            `,
            [idsInformes, preguntasIdsFiltradas]
          );
          fotosAll = fotosQ.rows || [];
        }

        const respuestasMapPorInforme = {};
        for (const inf of idsInformes) respuestasMapPorInforme[inf] = {};

        for (const r of respuestasAll) {
          const infId = Number(r.id_informe);
          const pId = Number(r.id_pregunta);
          const val = buildRespuestasMap([r])[pId];
          if (!respuestasMapPorInforme[infId]) respuestasMapPorInforme[infId] = {};
          respuestasMapPorInforme[infId][pId] = val || "-";
        }

        const fotosPorInformePorPregunta = {};
        for (const infId of idsInformes) fotosPorInformePorPregunta[infId] = {};

        if (incluirFotos && fotosAll.length && maxFotos > 0) {
          const contadorFotos = {};

          for (const f of fotosAll) {
            const infId = Number(f.id_informe);
            const pId = Number(f.id_pregunta);
            if (!infId || !pId) continue;

            const key = `${infId}_${pId}`;
            contadorFotos[key] = contadorFotos[key] || 0;
            if (contadorFotos[key] >= maxFotos) continue;

            const abs = path.join(
              uploadsRoot,
              String(f.ruta_archivo || "").replace(/\//g, path.sep)
            );

            const img = await readImageForDocx(abs, isTabla ? 900 : 1400);
            if (!img?.buffer) continue;

            if (!fotosPorInformePorPregunta[infId][pId]) {
              fotosPorInformePorPregunta[infId][pId] = [];
            }

            fotosPorInformePorPregunta[infId][pId].push({
              descripcion: f.descripcion || "",
              buffer: img.buffer,
            });

            contadorFotos[key]++;
          }
        }

        if (!isTabla) {
          for (const informe of infosPlantilla) {
            const respuestasMap = respuestasMapPorInforme[informe.id_informe] || {};

            children.push(
              new Paragraph({
                text: safeStr(informe.titulo || nombrePlantilla || "INFORME"),
                heading: HeadingLevel.HEADING_3,
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: "ID Informe: ", bold: true }),
                  new TextRun(String(informe.id_informe)),
                  new TextRun({ text: "   Fecha: ", bold: true }),
                  new TextRun(_formatFechaPY(informe.fecha_creado)),
                ],
              }),
              new Paragraph({ text: " " })
            );

            for (const sec of seccionesConPreguntas) {
              const preguntasSec = preguntas.filter(
                (p) => Number(p.id_seccion) === Number(sec.id_seccion)
              );
              if (!preguntasSec.length) continue;

              children.push(
                new Paragraph({
                  text: safeStr(sec.titulo || "Sección"),
                  heading: HeadingLevel.HEADING_4,
                })
              );

              const rows = preguntasSec.map((p) => {
                const valor = respuestasMap[p.id_pregunta] ?? "-";

                return new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 45, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: safeStr(p.etiqueta), bold: true })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 55, type: WidthType.PERCENTAGE },
                      children: [new Paragraph(safeStr(valor))],
                    }),
                  ],
                });
              });

              children.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows,
                }),
                new Paragraph({ text: " " })
              );

              if (incluirFotos && maxFotos > 0) {
                for (const p of preguntasSec) {
                  const fotosListOriginal =
                    fotosPorInformePorPregunta?.[informe.id_informe]?.[p.id_pregunta] || [];
                  const fotosList = fotosListOriginal.slice(0, maxFotos);
                  if (!fotosList.length) continue;

                  children.push(
                    new Paragraph({
                      children: [new TextRun({ text: `Fotos - ${safeStr(p.etiqueta)}`, italics: true })],
                    })
                  );

                  for (const fx of fotosList) {
                    children.push(
                      new Paragraph({
                        children: [
                          new ImageRun({
                            data: fx.buffer,
                            transformation: { width: 460, height: 260 },
                          }),
                        ],
                      })
                    );

                    if (fx.descripcion) {
                      children.push(
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: safeStr(fx.descripcion),
                              size: 18,
                              color: "666666",
                            }),
                          ],
                        })
                      );
                    }
                  }

                  children.push(new Paragraph({ text: " " }));
                }
              }
            }

            children.push(new Paragraph({ text: " " }));
          }
        } else {
          const preguntasTodas = [...preguntas];

          if (preguntasTodas.length) {
            const tabla = await buildTablaUnica({
              preguntasTodas,
              informesPlantilla: infosPlantilla,
              respuestasMapPorInforme,
              fotosPorInformePorPregunta,
            });

            children.push(tabla);
            children.push(new Paragraph({ text: " " }));
          }
        }
      }

      children.push(new Paragraph({ children: [], pageBreakBefore: true }));
    }

    const doc = new Document({
      sections: [
        {
          properties: isTabla
            ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
            : {},
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const fileName =
      `Proyecto_${idProyecto}` +
      `${idPlantilla ? `_Plantilla_${idPlantilla}` : ""}` +
      `_Lotes_${fromPage}_a_${toPage}` +
      `_${isTabla ? "TABLA" : "NORMAL"}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);

    return res.end(buffer);
  } catch (err) {
    console.error("generarWordProyectoRangoUnico error:", err);
    return res.status(500).send("Error al generar Word único del rango");
  }
}

// âœ… GET /api/informes/proyecto/:idProyecto/preguntas
// Devuelve preguntas (id + etiqueta) usadas en informes del proyecto.
// Opcional: ?plantilla=ID  (para filtrar por plantilla)
async function getPreguntasByProyecto(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const idPlantillaRaw = req.query.plantilla;
  const idPlantilla = idPlantillaRaw ? Number(idPlantillaRaw) : null;

  if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
    return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });
  }

  try {
    const params = [idProyecto];
    let whereExtra = "";

    if (Number.isFinite(idPlantilla) && idPlantilla > 0) {
      params.push(idPlantilla);
      whereExtra = ` AND i.id_plantilla = $${params.length} `;
    }

    const sql = `
      SELECT DISTINCT
        q.id_pregunta,
        COALESCE(NULLIF(TRIM(q.etiqueta), ''), 'Pregunta #' || q.id_pregunta) AS etiqueta
      FROM ema.informe i
      JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
      JOIN ema.informe_pregunta  q ON q.id_pregunta = r.id_pregunta
      WHERE i.id_proyecto = $1
      ${whereExtra}
      ORDER BY etiqueta ASC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("getPreguntasByProyecto error:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

async function buscarRespuestasProyecto(req, res) {
  const idProyecto = Number(req.params.idProyecto);
  const q = String(req.query.q || "").trim();
  const preguntaRaw = req.query.pregunta;
  const idPregunta = preguntaRaw ? Number(preguntaRaw) : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));

  if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
    return res.status(400).json({ ok: false, error: "idProyecto invÃ¡lido" });
  }
  if (q.length < 2) {
    return res.json({ ok: true, items: [] });
  }

  try {
    const params = [idProyecto, `%${q}%`, limit];
    let whereExtra = "";

    if (Number.isFinite(idPregunta) && idPregunta > 0) {
      params.push(idPregunta);
      whereExtra = ` AND r.id_pregunta = $${params.length} `;
    }

    const sql = `
      SELECT
        i.id_informe,
        COALESCE(NULLIF(TRIM(i.titulo), ''), 'Informe #' || i.id_informe) AS titulo,
        r.id_pregunta,
        COALESCE(NULLIF(TRIM(q.etiqueta), ''), 'Pregunta #' || r.id_pregunta) AS etiqueta,
        CASE
          WHEN r.valor_texto IS NOT NULL AND TRIM(r.valor_texto) <> '' THEN r.valor_texto
          WHEN r.valor_bool IS NOT NULL THEN CASE WHEN r.valor_bool THEN 'SÃ­' ELSE 'No' END
          WHEN r.valor_json IS NOT NULL THEN r.valor_json::text
          ELSE ''
        END AS valor
      FROM ema.informe i
      JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
      LEFT JOIN ema.informe_pregunta q ON q.id_pregunta = r.id_pregunta
      WHERE i.id_proyecto = $1
        AND (
          (r.valor_texto IS NOT NULL AND r.valor_texto ILIKE $2)
          OR (r.valor_bool IS NOT NULL AND (CASE WHEN r.valor_bool THEN 'SÃ­' ELSE 'No' END) ILIKE $2)
          OR (r.valor_json IS NOT NULL AND (r.valor_json::text) ILIKE $2)
        )
        ${whereExtra}
      ORDER BY i.fecha_creado DESC NULLS LAST, i.id_informe DESC
      LIMIT $3
    `;

    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("buscarRespuestasProyecto error:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;

  const s = String(value).trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parsePgArrayString(str) {
  if (str == null) return null;

  const s = String(str).trim();
  if (!s) return null;

  // ejemplo: {"A","B","C"}
  if (!(s.startsWith("{") && s.endsWith("}"))) return null;

  const inner = s.slice(1, -1).trim();
  if (!inner) return [];

  const result = [];
  let current = "";
  let inQuotes = false;
  let escaping = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length || inner.endsWith(",")) {
    result.push(current.trim());
  }

  return result
    .map((x) => x.replace(/\\"/g, '"').trim())
    .filter((x) => x !== "");
}

function normalizeJsonb(value) {
  if (value == null) return null;

  if (typeof value === "object") return value;

  const s = String(value).trim();
  if (!s) return null;

  // 1) JSON normal
  const parsedJson = tryParseJson(s);
  if (parsedJson !== null) return parsedJson;

  // 2) array estilo PostgreSQL: {"A","B"}
  const pgArray = parsePgArrayString(s);
  if (pgArray !== null) return pgArray;

  // 3) string plano
  return s;
}

function toJsonbParam(value) {
  const normalized = normalizeJsonb(value);
  return normalized == null ? null : JSON.stringify(normalized);
}

function remapCondIds(value, preguntaIdMap) {
  if (value == null) return null;

  const normalized = normalizeJsonb(value);

  if (Array.isArray(normalized)) {
    return normalized.map((item) => remapCondIds(item, preguntaIdMap));
  }

  if (normalized && typeof normalized === "object") {
    const out = {};
    for (const [k, v] of Object.entries(normalized)) {
      if (k === "id_pregunta" && v != null) {
        const mapped = preguntaIdMap.get(Number(v));
        out[k] = mapped || v;
      } else {
        out[k] = remapCondIds(v, preguntaIdMap);
      }
    }
    return out;
  }

  return normalized;
}

// POST /api/informes/plantillas/:id/duplicar
async function duplicarPlantilla(req, res) {
  const { id } = req.params;
  const idPlantilla = Number(id);

  if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
    return res.status(400).json({ ok: false, error: "ID de plantilla inválido" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) leer plantilla original
    const plantillaRes = await client.query(
      `
      SELECT *
      FROM ema.informe_plantilla
      WHERE id_plantilla = $1
      `,
      [idPlantilla]
    );

    if (!plantillaRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    }

    const plantillaOriginal = plantillaRes.rows[0];
    const nuevoNombre =
      String(req.body?.nombre || "").trim() || `${plantillaOriginal.nombre} (Copia)`;

    // 2) crear nueva plantilla
    const nuevaPlantillaRes = await client.query(
      `
      INSERT INTO ema.informe_plantilla
        (
          nombre,
          descripcion,
          activo,
          id_creador,
          proyectos_permitidos,
          usuarios_compartidos
        )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      RETURNING *
      `,
      [
        nuevoNombre,
        plantillaOriginal.descripcion || null,
        plantillaOriginal.activo !== false,
        req.user?.id || plantillaOriginal.id_creador || null,
        null, // NO copiar proyectos
        toJsonbParam(plantillaOriginal.usuarios_compartidos), // SÍ copiar compartidos
      ]
    );

    const nuevaPlantilla = nuevaPlantillaRes.rows[0];

    // 3) leer secciones originales
    const seccionesRes = await client.query(
      `
      SELECT *
      FROM ema.informe_seccion
      WHERE id_plantilla = $1
      ORDER BY orden, id_seccion
      `,
      [idPlantilla]
    );

    const seccionesOriginales = seccionesRes.rows || [];

    // 4) copiar secciones
    const seccionIdMap = new Map();

    for (const sec of seccionesOriginales) {
      const insSec = await client.query(
        `
        INSERT INTO ema.informe_seccion
          (id_plantilla, titulo, orden, visible_if)
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING *
        `,
        [
          nuevaPlantilla.id_plantilla,
          sec.titulo,
          sec.orden,
          toJsonbParam(sec.visible_if),
        ]
      );

      const nuevaSec = insSec.rows[0];
      seccionIdMap.set(Number(sec.id_seccion), Number(nuevaSec.id_seccion));
    }

    // 5) leer preguntas originales
    const preguntasRes = await client.query(
      `
      SELECT q.*
      FROM ema.informe_pregunta q
      JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
      WHERE s.id_plantilla = $1
      ORDER BY s.orden, q.orden, q.id_pregunta
      `,
      [idPlantilla]
    );

    const preguntasOriginales = preguntasRes.rows || [];

    // 6) copiar preguntas
    const preguntaIdMap = new Map();
    const preguntasNuevasPendientes = [];

    for (const preg of preguntasOriginales) {
      const newSeccionId = seccionIdMap.get(Number(preg.id_seccion));
      if (!newSeccionId) continue;

      const opcionesJson = normalizeJsonb(preg.opciones_json);
      const visibleIf = normalizeJsonb(preg.visible_if);
      const requiredIf = normalizeJsonb(preg.required_if);
      const hideIf = normalizeJsonb(preg.hide_if);

      // debug temporal
      console.log("Duplicando pregunta:", {
        id_pregunta: preg.id_pregunta,
        etiqueta: preg.etiqueta,
        tipo: preg.tipo,
        opciones_json_original: preg.opciones_json,
        opciones_json_normalizado: opcionesJson,
      });

      const insPreg = await client.query(
        `
        INSERT INTO ema.informe_pregunta
          (
            id_seccion,
            etiqueta,
            tipo,
            opciones_json,
            obligatorio,
            orden,
            permite_foto,
            visible_if,
            required_if,
            activo,
            hide_if
          )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::jsonb)
        RETURNING *
        `,
        [
          newSeccionId,
          preg.etiqueta,
          preg.tipo,
          opcionesJson == null ? null : JSON.stringify(opcionesJson),
          !!preg.obligatorio,
          preg.orden,
          !!preg.permite_foto,
          visibleIf == null ? null : JSON.stringify(visibleIf),
          requiredIf == null ? null : JSON.stringify(requiredIf),
          preg.activo !== false,
          hideIf == null ? null : JSON.stringify(hideIf),
        ]
      );

      const nuevaPreg = insPreg.rows[0];

      preguntaIdMap.set(Number(preg.id_pregunta), Number(nuevaPreg.id_pregunta));

      preguntasNuevasPendientes.push({
        old: preg,
        neu: nuevaPreg,
      });
    }

    // 7) remapear condiciones de preguntas
    for (const item of preguntasNuevasPendientes) {
      const oldPreg = item.old;
      const newPreg = item.neu;

      const visibleIfRemap = remapCondIds(oldPreg.visible_if, preguntaIdMap);
      const requiredIfRemap = remapCondIds(oldPreg.required_if, preguntaIdMap);
      const hideIfRemap = remapCondIds(oldPreg.hide_if, preguntaIdMap);

      await client.query(
        `
        UPDATE ema.informe_pregunta
        SET
          visible_if = $1::jsonb,
          required_if = $2::jsonb,
          hide_if = $3::jsonb
        WHERE id_pregunta = $4
        `,
        [
          visibleIfRemap == null ? null : JSON.stringify(visibleIfRemap),
          requiredIfRemap == null ? null : JSON.stringify(requiredIfRemap),
          hideIfRemap == null ? null : JSON.stringify(hideIfRemap),
          newPreg.id_pregunta,
        ]
      );
    }

    // 8) remapear visible_if de secciones
    const nuevasSeccionesRes = await client.query(
      `
      SELECT *
      FROM ema.informe_seccion
      WHERE id_plantilla = $1
      ORDER BY orden, id_seccion
      `,
      [nuevaPlantilla.id_plantilla]
    );

    const nuevasSecciones = nuevasSeccionesRes.rows || [];

    for (const oldSec of seccionesOriginales) {
      const newSecId = seccionIdMap.get(Number(oldSec.id_seccion));
      const newSec = nuevasSecciones.find(
        (s) => Number(s.id_seccion) === Number(newSecId)
      );
      if (!newSec) continue;

      const visibleIfRemap = remapCondIds(oldSec.visible_if, preguntaIdMap);

      await client.query(
        `
        UPDATE ema.informe_seccion
        SET visible_if = $1::jsonb
        WHERE id_seccion = $2
        `,
        [
          visibleIfRemap == null ? null : JSON.stringify(visibleIfRemap),
          newSec.id_seccion,
        ]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      ok: true,
      plantilla: nuevaPlantilla,
      id_plantilla: nuevaPlantilla.id_plantilla,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("duplicarPlantilla error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Error al duplicar plantilla",
    });
  } finally {
    client.release();
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ EXPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  /* ──────────────────────────────────────────────────────────────────────────── 
    GET /api/informes/query
    Endpoint unificado con paginación, búsqueda global, y filtro diagnóstico.
  ──────────────────────────────────────────────────────────────────────────── */
  async function queryInformes(req, res) {
    try {
      const { id_proyecto, id_plantilla, search, con_diagnostico, sort_by, sort_order } = req.query;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const offset = (page - 1) * limit;

      const idP = Number(id_proyecto);
      if (!Number.isFinite(idP) || idP <= 0) {
        return res.status(400).json({ error: "id_proyecto inválido" });
      }

      const { buildInformeVisibleScope } = require("../helpers/informesDashboardScope");
      const userId = req.user.id;
      const isAdmin =
        Number(req.user.tipo_usuario) === 1 || Number(req.user.group_id) === 1;

      const baseParams = [idP];
      const scope = buildInformeVisibleScope({
        userId,
        isAdmin,
        plantillaId: id_plantilla,
        startIndex: baseParams.length + 1,
      });

      const whereConditions = ["i.id_proyecto = $1"];
      const scopeWhere = scope.whereSql.replace(/^\s*AND\s*/i, "");
      if (scopeWhere) whereConditions.push(scopeWhere);
      
      const params = [...baseParams, ...scope.params];

      if (id_plantilla) {
        params.push(Number(id_plantilla));
        whereConditions.push(`i.id_plantilla = $${params.length}`);
      }

      if (con_diagnostico !== undefined && con_diagnostico !== '') {
        const hasDiag = con_diagnostico === 'true';
        if (hasDiag) {
          whereConditions.push("fr.id_resultado IS NOT NULL");
        } else {
          whereConditions.push("fr.id_resultado IS NULL");
        }
      }

      const searchValue = String(search || "").trim();
      if (searchValue) {
        params.push(`%${searchValue}%`);
        const searchIdx = params.length;

        const searchPredicates = [`
          EXISTS (
            SELECT 1 
            FROM ema.informe_respuesta r2 
            WHERE r2.id_informe = i.id_informe
            AND (
              r2.valor_texto ILIKE $${searchIdx}
              OR r2.valor_json::text ILIKE $${searchIdx}
              OR r2.valor_bool::text ILIKE $${searchIdx}
            )
          )
        `];

        if (/^\d+$/.test(searchValue)) {
          params.push(Number(searchValue));
          const idIdx = params.length;
          searchPredicates.push(`i.id_informe = $${idIdx}`);
        }

        whereConditions.push(`(${searchPredicates.join(" OR ")})`);
      }

      const whereClause = whereConditions.map(c => `(${c})`).join(" AND ");

      const countQuery = `
        SELECT COUNT(DISTINCT i.id_informe) as total
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
        LEFT JOIN ema.formula_resultado fr ON fr.id_resultado = (
          SELECT fr2.id_resultado 
          FROM ema.formula_resultado fr2 
          WHERE fr2.id_registro = ir.id_registro 
          ORDER BY fr2.id_resultado DESC 
          LIMIT 1
        )
        LEFT JOIN ema.informe_plantilla_usuario pu
          ON pu.id_plantilla = p.id_plantilla
          AND pu.id_usuario = $${scope.userParamIndex}
        ${whereClause ? `WHERE ${whereClause}` : ""}
      `;

      // --- ORDENAMIENTO DINÁMICO ---
      let sortSql = "ORDER BY fr.cambio_detectado DESC NULLS LAST, fr.score_total DESC NULLS LAST, i.id_informe DESC";
      
      if (sort_by) {
        let col = "";
        let secondary = ", i.id_informe DESC";
        
        switch (sort_by) {
          case 'score_total': col = "fr.score_total"; break;
          case 'clasificacion': col = "COALESCE(fr.resultado_consultor, fr.clasificacion)"; break;
          case 'evaluador_nombre': col = "CONCAT(u.first_name, ' ', u.last_name)"; break;
          case 'fecha': col = "i.fecha_creado"; break;
          case 'diferencia': 
            col = "(fr.resultado_consultor IS NOT NULL AND fr.resultado_consultor != fr.clasificacion)"; 
            secondary = ", fr.score_total DESC, i.id_informe DESC";
            break;
          default: col = "i.fecha_creado";
        }
        const dir = (sort_order || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
        sortSql = `ORDER BY ${col} ${dir}${secondary}`;
      }

      const dataQuery = `
        SELECT 
          i.*,
          p.nombre AS nombre_plantilla,
          ir.id_registro,
          fr.score_total,
          fr.clasificacion,
          fr.resultado_consultor,
          fr.cambio_detectado,
          fr.manual_override,
          fr.fecha_recalculo,
          fr.fecha_manual_evaluacion,
          fr.fecha_revision_usuario,
          fr.version_formula,
          CONCAT(u.first_name, ' ', u.last_name) AS evaluador_nombre,
          (
            SELECT jsonb_object_agg(q_vis.etiqueta, 
              CASE 
                WHEN q_vis.tipo IN ('semaforo', 'select', 'radio', 'select_single') THEN 
                  COALESCE(r_vis.valor_json->>'label', r_vis.valor_texto, r_vis.valor_json::text)
                WHEN q_vis.tipo IN ('multiselect', 'checkbox', 'select_multiple') THEN 
                  (
                    SELECT string_agg(item->>'label', ', ')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r_vis.valor_json) = 'array' THEN r_vis.valor_json ELSE '[]'::jsonb END) AS item
                  )
                ELSE COALESCE(r_vis.valor_texto, r_vis.valor_json::text)
              END
            )
            FROM ema.informe_respuesta r_vis
            JOIN ema.informe_pregunta q_vis ON q_vis.id_pregunta = r_vis.id_pregunta
            WHERE r_vis.id_informe = i.id_informe 
              AND q_vis.visible_en_listado = true
          ) as respuestas_clave
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
        LEFT JOIN ema.formula_resultado fr ON fr.id_resultado = (
          SELECT fr2.id_resultado 
          FROM ema.formula_resultado fr2 
          WHERE fr2.id_registro = ir.id_registro 
          ORDER BY fr2.id_resultado DESC 
          LIMIT 1
        )
        LEFT JOIN ema.informe_plantilla_usuario pu
          ON pu.id_plantilla = p.id_plantilla
          AND pu.id_usuario = $${scope.userParamIndex}
        LEFT JOIN public.users u ON u.id = fr.id_usuario_evaluador
        ${whereClause ? `WHERE ${whereClause}` : ""}
        ${sortSql}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const dataParams = [...params, limit, offset];

      const [countRes, dataRes] = await Promise.all([
        pool.query(countQuery, params),
        pool.query(dataQuery, dataParams)
      ]);

      const total = parseInt(countRes.rows[0].total, 10);
      const total_pages = Math.ceil(total / limit);

      // Compatibilidad y nueva estructura
      return res.json({ 
        ok: true, 
        informes: dataRes.rows, 
        data: dataRes.rows,
        meta: {
          total,
          page,
          limit,
          total_pages
        }
      });
    } catch (err) {
      console.error("❌ queryInformes error:", err.message);
      return res.status(500).json({ ok: false, error: "Error en paginación", data: [], informes: [] });
    }
  }


module.exports = {
  // Plantillas
  getPlantillas,
  getPlantillaById,
  createPlantilla,
  updatePlantilla,
  deletePlantilla,
  hardDeletePlantilla,
  listAllPlantillasByProyecto,
  duplicarPlantilla,

  // Secciones
  createSeccion,
  updateSeccion,
  deleteSeccion,

  // Preguntas
  createPregunta,
  updatePregunta,
  moverPregunta,
  deletePregunta,
  getPreguntasByProyecto,

  // Respuestas
  buscarRespuestasProyecto,

  // Informes
  crearInforme,
  getInforme,
  generarPdf,
  actualizarInforme,
  importExcelUpdateRespuestas,
  previewConsolidacionCampos,
  applyConsolidacionCampos,
  deleteInformeFoto,
  deleteInforme,
  bulkDeleteInformesByProyectoPlantilla,
  bulkDeleteFotosByProyectoPlantilla,

  // Proyecto helpers
  listPlantillasByProyecto,
  listInformesByProyecto,
  queryInformes,
  getInformesPuntosGeojson,
  exportProyectoInformesExcel,
  buscarPersonasProyecto,
  generarPdfProyecto,
  generarWordProyecto,
  generarWordProyectoRangoUnico,

  // Share links (privado)
  createShareLink,
  listShareLinksByPlantilla,
  updateShareLink,
  closeShareLink,
  reopenShareLink,
  eliminarShareLink,

  // Share links (pÃºblico)
  publicGetShareForm,
  publicSubmitShareForm,
};
