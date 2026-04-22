"use strict";

const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const pool = require("../db");

const MAX_IMPORT_BYTES = 25 * 1024 * 1024; // 25MB, limite prudente para iteracion 1
const MAX_IMPORT_ROWS = 20000;

/* =========================================================
   Helpers copiados del legacy (aislamiento iteracion 1)
   Refactorizar luego si se decide compartir helpers
   ========================================================= */
function normKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

const ALIAS = {
  [normKey("FECHA DE RELEVAMIENTO")]: normKey("FECHA DEL RELEVAMIENTO"),
  [normKey("FECHA DEL RELEVAMIENTO")]: normKey("FECHA DEL RELEVAMIENTO"),
  [normKey("NOMBRE Y APELLIDO")]: normKey("NOMBRE Y APELLIDO"),
  [normKey("NOMBRE DEL CENSISTA")]: normKey("NOMBRE DEL CENSISTA"),
  [normKey("NRO DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("N DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("NRO DE CI")]: normKey("N DE CI"),
  [normKey("N DE CI")]: normKey("N DE CI"),
  [normKey("CEDULA")]: normKey("N DE CI"),
  [normKey("CEDULA DE IDENTIDAD")]: normKey("N DE CI"),
  [normKey("TIPO DE INMUEBLE")]: normKey("TIPO DE INMUEBLE"),
  [normKey("AFECTACION")]: normKey("AFECTACION"),
  [normKey("TRAMO")]: normKey("TRAMOS"),
  [normKey("TRAMOS")]: normKey("TRAMOS"),
  [normKey("CODIGO")]: normKey("CODIGO"),
  [normKey("CIUDAD")]: normKey("CIUDAD"),
  [normKey("BARRIO")]: normKey("BARRIO"),
  [normKey("ESPECIFICAR OTRO")]: normKey("ESPECIFICAR OTRO"),
  [normKey("ESPECIFIQUE OTRO")]: normKey("ESPECIFICAR OTRO"),
};

const STOP_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e"]);

function removeStopWords(s) {
  const parts = normKey(s)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !STOP_WORDS.has(x));
  return parts.join(" ").trim();
}

function canonicalKey(raw) {
  const base = normKey(raw);
  if (!base) return "";
  const aliased = ALIAS[base] || base;
  const noStops = removeStopWords(aliased);
  return noStops || aliased || base;
}

function buildNormalizedVariants(raw) {
  const base = normKey(raw);
  const out = new Set();
  if (!base) return [];

  const aliased1 = ALIAS[base] || base;
  const aliased2 = ALIAS[aliased1] || aliased1;

  const variants = [
    base,
    aliased1,
    aliased2,
    removeStopWords(base),
    removeStopWords(aliased1),
    removeStopWords(aliased2),
    canonicalKey(base),
    canonicalKey(aliased1),
    canonicalKey(aliased2),
  ];

  variants
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .forEach((v) => out.add(v));

  return Array.from(out);
}

function parsePreguntaIdFromHeader(header) {
  const h = String(header || "").trim();
  const m1 = h.match(/^#\s*(\d+)\s*$/i);
  if (m1) return Number(m1[1]);
  const m2 = h.match(/^p\s*(\d+)\s*$/i);
  if (m2) return Number(m2[1]);
  const m3 = h.match(/id[_\s-]*pregunta[:\s-]*(\d+)/i);
  if (m3) return Number(m3[1]);
  const m4 = h.match(/pregunta[:\s-]*(\d+)/i);
  if (m4) return Number(m4[1]);
  return null;
}

function tokensOf(s) {
  const nk = canonicalKey(s);
  if (!nk) return [];
  return nk.split(" ").filter(Boolean);
}

function bigrams(s) {
  const t = canonicalKey(s).replace(/\s+/g, " ");
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

function fuzzyScore(excelLabel, plantillaLabel) {
  const a = canonicalKey(excelLabel);
  const b = canonicalKey(plantillaLabel);
  const tok = jaccard(tokensOf(a), tokensOf(b));
  const bi = jaccard(bigrams(a), bigrams(b));
  const prefix = a && b && (a.startsWith(b) || b.startsWith(a)) ? 0.12 : 0;
  const exact = a === b && a !== "" ? 0.25 : 0;
  return 0.65 * tok + 0.35 * bi + prefix + exact;
}

function getTopCandidates(excelCol, preguntasLista, max = 8) {
  const excelNorm = canonicalKey(excelCol);
  if (!excelNorm) return [];

  const scored = (preguntasLista || [])
    .map((q) => {
      const label = q?.etiqueta || q?.titulo || "";
      const score = fuzzyScore(excelCol, label);
      return {
        id_pregunta: Number(q.id_pregunta),
        etiqueta: q?.etiqueta || q?.titulo || `#${q?.id_pregunta}`,
        score,
      };
    })
    .filter((x) => Number.isFinite(x.id_pregunta))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  const best = scored[0]?.score ?? 0;
  return best >= 0.18 ? scored : [];
}

function isGpsLatitudeColumn(col) {
  const n = normKey(col);
  return (
    n.includes("coordenadas gps latitude") ||
    n.includes("coordenada gps latitude") ||
    n.includes("gps latitude") ||
    n.includes("gps latitud") ||
    n.endsWith(" latitude") ||
    n.endsWith(" latitud") ||
    n.includes(" latitude ") ||
    n.includes(" latitud ") ||
    n.includes("latitude") ||
    n.includes("latitud")
  );
}

function isGpsLongitudeColumn(col) {
  const n = normKey(col);
  return (
    n.includes("coordenadas gps longitude") ||
    n.includes("coordenada gps longitude") ||
    n.includes("gps longitude") ||
    n.includes("gps longitud") ||
    n.endsWith(" longitude") ||
    n.endsWith(" longitud") ||
    n.includes(" longitude ") ||
    n.includes(" longitud ") ||
    n.includes("longitude") ||
    n.includes("longitud")
  );
}

function normalizeUniqueValue(v) {
  if (Array.isArray(v)) return v.map((x) => normalizeUniqueValue(x)).join("|");
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isEmptyAnswer(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

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
    if (sl === "si") return true;
    if (sl === "no") return false;
    if (s !== "" && /^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    return s;
  }
  return v;
}

function _getAnswerValueFromObj(answersObj, idPregunta) {
  const obj = answersObj || {};
  const k = String(idPregunta);
  if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  const n = Number(idPregunta);
  if (Number.isFinite(n) && Object.prototype.hasOwnProperty.call(obj, n)) return obj[n];
  return undefined;
}

function evalCond(cond, answersObj) {
  if (!cond) return true;

  let c = cond;
  if (typeof c === "string") {
    try {
      c = JSON.parse(c);
    } catch {
      return true;
    }
  }
  if (!c || typeof c !== "object") return true;

  if (Array.isArray(c.all)) return c.all.every((x) => evalCond(x, answersObj));
  if (Array.isArray(c.any)) return c.any.some((x) => evalCond(x, answersObj));

  const idSrc = Number(c.id ?? c.id_pregunta ?? c.pregunta_id);
  if (!idSrc) return true;

  const op = String(c.op ?? "eq").trim().toLowerCase();
  const expectedRaw = c.value;

  const actualRaw = _getAnswerValueFromObj(answersObj, idSrc);
  const has = actualRaw !== undefined;
  const actual = _coerceValue(actualRaw);
  const expected = expectedRaw === undefined ? undefined : _coerceValue(expectedRaw);
  const toArr = (v) => (Array.isArray(v) ? v.map(_coerceValue) : v == null ? [] : [_coerceValue(v)]);

  if (op === "exists") return has;
  if (op === "not_exists") return !has;
  if (op === "truthy") return has && !isEmptyAnswer(actual) && actual !== false;
  if (op === "falsy") return !has || isEmptyAnswer(actual) || actual === false;

  if (op === "in") {
    const expectedArr = Array.isArray(expectedRaw) ? expectedRaw.map(_coerceValue) : toArr(expected);
    if (Array.isArray(actual)) return actual.map(_coerceValue).some((x) => expectedArr.includes(x));
    return expectedArr.includes(actual);
  }

  if (op === "not_in") {
    const expectedArr = Array.isArray(expectedRaw) ? expectedRaw.map(_coerceValue) : toArr(expected);
    if (Array.isArray(actual)) return !actual.map(_coerceValue).some((x) => expectedArr.includes(x));
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

function computeVisibility(q, answersObj) {
  const secVisible = q?.sec_visible_if ? evalCond(q.sec_visible_if, answersObj) : true;
  const qHidden = q?.hide_if ? evalCond(q.hide_if, answersObj) : false;
  const qVisibleByRule = q?.visible_if ? evalCond(q.visible_if, answersObj) : true;
  return secVisible && !qHidden && qVisibleByRule;
}

function normalizeCoordLike(v) {
  if (v == null) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return v;
    if (/^-?\d+(\.\d+)?\s*[,;]\s*-?\d+(\.\d+)?$/.test(s)) {
      const [a, b] = s.split(/[,;]/).map((x) => Number(String(x).trim().replace(",", ".")));
      if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
      return v;
    }
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

/**
 * Normaliza un valor para ser guardado como fecha YYYY-MM-DD.
 * Soporta seriales Excel (números > 20000) y strings ISO o DD/MM/YYYY.
 */
function _normalizeDateForSave(v) {
  if (v === null || v === undefined || v === "") return "";

  // Caso A: Serial Excel (numérico) o string numérico
  let n = NaN;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    const s = v.trim();
    if (s !== "" && /^\d+(\.\d+)?$/.test(s)) {
      n = Number(s);
    }
  }

  // Rango razonable Excel: 20000 (~1954) hasta 100000 (~2173)
  if (Number.isFinite(n) && n >= 20000 && n <= 100000) {
    try {
      // Ignoramos la parte fraccionaria (hora) para la fecha
      const serial = Math.floor(n);
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split("T")[0];
      }
    } catch (e) {
      // fallback
    }
  }

  const s = String(v).trim();
  if (!s) return "";

  // Caso B: Texto ISO (YYYY-MM-DD...)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }

  // Caso C: Formatos manuales DD/MM/YYYY o DD-MM-YYYY
  const dm = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dm) {
    const day = dm[1].padStart(2, "0");
    const month = dm[2].padStart(2, "0");
    const year = dm[3];
    return `${year}-${month}-${day}`;
  }

  return s;
}

function normalizeAnswerForSaveByTipo(tipo, valorRaw) {
  const t = String(tipo || "").trim().toLowerCase();
  
  if (["fecha", "date", "datetime", "fecha_hora", "timestamp"].includes(t)) {
    return _normalizeDateForSave(valorRaw);
  }

  if (t === "select" || t === "texto" || t === "semaforo") {
    if (valorRaw === null || valorRaw === undefined) return "";
    return String(valorRaw);
  }
  if (t === "multiselect") {
    if (Array.isArray(valorRaw)) return valorRaw.map((x) => String(x).trim()).filter(Boolean);
    if (typeof valorRaw === "string") {
      const s = valorRaw.trim();
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
  if (t === "numero") {
    return _coerceValue(valorRaw);
  }
  return normalizeCoordLike(_coerceValue(valorRaw));
}

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

function sanitizeFilename(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "archivo";
}

function pickSafeImageExt(name = "", mimetype = "") {
  const n = String(name || "").toLowerCase().trim();
  const mt = String(mimetype || "").toLowerCase().trim();
  if (mt === "image/jpeg" || mt === "image/jpg") return ".jpg";
  if (mt === "image/png") return ".png";
  if (mt === "image/webp") return ".webp";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return ".jpg";
  if (n.endsWith(".png")) return ".png";
  if (n.endsWith(".webp")) return ".webp";
  return "";
}

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map((x) => Number(x));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function looksLikeImageField(q, col) {
  const tipo = String(q?.tipo || "").toLowerCase().trim();
  if (tipo === "imagen") return true;
  const label = String(q?.etiqueta || q?.titulo || "").toLowerCase();
  const header = String(col || "").toLowerCase();
  const key = `${label} ${header}`;
  return (
    key.includes("foto") ||
    key.includes("imagen") ||
    key.includes("url foto") ||
    key.includes("url imagen") ||
    key.includes("fotografia") ||
    key.includes("evidencia fotografica")
  );
}

function isLikelyImageSource(raw) {
  if (typeof raw !== "string") return false;
  return /^https?:\/\//i.test(raw.trim());
}

function canPersistPhotoByLegacyRule(q) {
  return !!q?.permite_foto || String(q?.tipo || "").trim().toLowerCase() === "imagen";
}

async function downloadImageToFile(urlStr, destAbs, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const maxBytes = opts.maxBytes || 8 * 1024 * 1024;

  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("url_invalid");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("url_invalid");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("url_blocked");
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url.toString(), { signal: ac.signal });
  } catch {
    clearTimeout(t);
    throw new Error("download_failed");
  }
  clearTimeout(t);

  if (!res.ok) throw new Error("download_failed");
  const ct = String(res.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("image/")) throw new Error("content_type_not_allowed");

  const ext = pickSafeImageExt(url.pathname, ct);
  if (!ext) throw new Error("content_type_not_allowed");

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("image_too_large");

  const dir = path.dirname(destAbs);
  await fs.promises.mkdir(dir, { recursive: true });
  const base = sanitizeFilename(path.basename(destAbs, path.extname(destAbs)));
  const finalAbs = path.join(dir, `${base}${ext}`);
  await fs.promises.writeFile(finalAbs, buf);

  return { finalAbs, ext, size: buf.length };
}

function fileExt(name = "") {
  const clean = String(name || "")
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/["']/g, "");

  const ext = path.extname(clean).toLowerCase();
  return ext.replace(".", "");
}

function validateExcelFileOrThrow(file) {
  const filename = String(file?.originalname || file?.name || "").trim();
  if (!filename) {
    throw new Error(
      "Nombre de archivo inválido. Debe tener formato xxxx.xls o xxxx.xlsx"
    );
  }
  const ext = fileExt(filename);
  if (!ext) {
    throw new Error(
      `Nombre de archivo inválido (${filename}). Debe tener formato xxxx.xls o xxxx.xlsx`
    );
  }
  const mime = String(file?.mimetype || "").toLowerCase().trim();
  const allowedMime = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ];

  if (ext !== "xlsx") {
    if (ext === "xls") {
      throw new Error("Formato XLS no soportado. Use Excel .xlsx");
    }
    throw new Error("Formato no permitido. Use .xlsx");
  }

  if (mime && !allowedMime.includes(mime)) {
    throw new Error("MIME no permitido para Excel .xlsx");
  }

  return { ext, mime };
}

function pickSingleFile(req) {
  const files = req.files || {};
  const first = Object.values(files)[0];
  if (!first) return null;
  return Array.isArray(first) ? first[0] : first;
}

function cellToValue(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (v.text) return String(v.text);
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.result !== undefined && v.result !== null) return String(v.result);
  }
  return v;
}

async function parseXlsxBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets?.[0] || null;
  if (!sheet) throw new Error("El Excel no tiene hojas.");

  const headerRow = sheet.getRow(1);
  const headerCount = Math.max(headerRow.cellCount || 0, sheet.actualColumnCount || 0);
  if (!headerCount) throw new Error("No se detectaron encabezados en la primera fila.");

  const headers = [];
  for (let i = 1; i <= headerCount; i++) {
    const cell = headerRow.getCell(i);
    const raw = cellToValue(cell);
    headers.push(String(raw ?? "").trim());
  }

  if (!headers.some((h) => String(h || "").trim())) {
    throw new Error("Los encabezados estan vacios.");
  }

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj = {};
    let hasAny = false;
    for (let c = 1; c <= headers.length; c++) {
      const key = headers[c - 1] || `COL_${c}`;
      const val = cellToValue(row.getCell(c));
      const normalized = val === undefined || val === null ? "" : val;
      if (String(normalized).trim() !== "") hasAny = true;
      obj[key] = normalized;
    }
    if (hasAny) rows.push(obj);
  }

  return { headers, rows };
}

function buildPreguntasIndex(preguntas = []) {
  const byId = new Map();
  const byEtiqueta = new Map();

  for (const q of preguntas) {
    const id = Number(q.id_pregunta);
    if (!Number.isFinite(id)) continue;
    byId.set(id, q);

    const raw = q.etiqueta || q.titulo || "";
    const variants = buildNormalizedVariants(raw);
    const canon = canonicalKey(raw);

    variants.forEach((k) => {
      if (k) byEtiqueta.set(k, id);
    });
    if (canon) byEtiqueta.set(canon, id);
  }

  return { byId, byEtiqueta };
}

function suggestMapping(headers = [], preguntas = []) {
  const { byId, byEtiqueta } = buildPreguntasIndex(preguntas);

  let gpsPreguntaId = null;
  for (const q of preguntas || []) {
    const id = Number(q.id_pregunta);
    if (!Number.isFinite(id)) continue;
    const raw = q.etiqueta || q.titulo || "";
    const variants = buildNormalizedVariants(raw);
    if (
      variants.includes(normKey("COORDENADAS GPS")) ||
      variants.includes(canonicalKey("COORDENADAS GPS")) ||
      variants.includes(normKey("COORDENADA GPS")) ||
      variants.includes(canonicalKey("COORDENADA GPS")) ||
      normKey(raw).includes(normKey("COORDENADAS GPS")) ||
      normKey(raw).includes(normKey("COORDENADA GPS"))
    ) {
      gpsPreguntaId = id;
      break;
    }
  }

  return headers.map((col) => {
    if (isGpsLatitudeColumn(col)) {
      return {
        col,
        ok: !!gpsPreguntaId,
        id_pregunta: gpsPreguntaId,
        etiqueta: gpsPreguntaId ? "COORDENADAS GPS (latitud)" : null,
        via: gpsPreguntaId ? "gps_latitude_to_json" : "gps_latitude_no_question",
        excelNorm: normKey(col),
        lookupNorm: canonicalKey(col),
        candidates: [],
      };
    }

    if (isGpsLongitudeColumn(col)) {
      return {
        col,
        ok: !!gpsPreguntaId,
        id_pregunta: gpsPreguntaId,
        etiqueta: gpsPreguntaId ? "COORDENADAS GPS (longitud)" : null,
        via: gpsPreguntaId ? "gps_longitude_to_json" : "gps_longitude_no_question",
        excelNorm: normKey(col),
        lookupNorm: canonicalKey(col),
        candidates: [],
      };
    }

    const explicitId = parsePreguntaIdFromHeader(col);
    if (explicitId && byId.has(explicitId)) {
      const q = byId.get(explicitId);
      return {
        col,
        ok: true,
        id_pregunta: explicitId,
        etiqueta: q?.etiqueta || `#${explicitId}`,
        via: "header_id",
        excelNorm: normKey(col),
        lookupNorm: canonicalKey(col),
        candidates: [],
      };
    }

    const variants = buildNormalizedVariants(col);
    const canonCol = canonicalKey(col);

    let byLabel = null;
    let matchedVariant = null;
    for (const v of [canonCol, ...variants]) {
      const found = byEtiqueta.get(v);
      if (found && byId.has(found)) {
        byLabel = found;
        matchedVariant = v;
        break;
      }
    }

    if (byLabel && byId.has(byLabel)) {
      const q = byId.get(byLabel);
      const excelNorm = normKey(col);
      const aliasDirect = ALIAS[excelNorm] || excelNorm;
      const canon = canonicalKey(col);
      return {
        col,
        ok: true,
        id_pregunta: byLabel,
        etiqueta: q?.etiqueta || q?.titulo || col,
        via:
          matchedVariant === canon
            ? "canonica_etiqueta"
            : matchedVariant && matchedVariant !== excelNorm
              ? matchedVariant === aliasDirect
                ? "alias_etiqueta"
                : "normalizado_etiqueta"
              : "etiqueta",
        excelNorm,
        lookupNorm: matchedVariant || canon,
        candidates: [],
      };
    }

    const candidates = getTopCandidates(col, preguntas, 8);
    return {
      col,
      ok: false,
      id_pregunta: null,
      etiqueta: null,
      via: candidates.length ? "no_match_suggested" : "no_match",
      excelNorm: normKey(col),
      lookupNorm: canonicalKey(col),
      candidates,
    };
  });
}

function suggestUniqueField(headers, preguntas, mappingSuggested) {
  const keywords = [
    "id",
    "id_unico",
    "codigo",
    "uuid",
    "identificador",
    "folio",
    "nro_formulario",
    "nro formulario",
    "numero formulario",
  ];

  const { byId, byEtiqueta } = buildPreguntasIndex(preguntas);

  const candidates = [];
  const seen = new Set();

  for (const h of headers || []) {
    const n = canonicalKey(h);
    if (!n) continue;
    const hit = keywords.find((k) => n.includes(canonicalKey(k)));
    if (!hit) continue;

    let qid = null;
    const mapped = (mappingSuggested || []).find((m) => m.col === h && m.ok);
    if (mapped?.id_pregunta) qid = Number(mapped.id_pregunta);

    if (!qid) {
      const found = byEtiqueta.get(n);
      if (found) qid = Number(found);
    }

    if (qid && byId.has(qid) && !seen.has(qid)) {
      const q = byId.get(qid);
      candidates.push({
        id_pregunta: qid,
        etiqueta: q?.etiqueta || q?.titulo || `#${qid}`,
        reason: "header_keyword",
      });
      seen.add(qid);
    }
  }

  for (const q of preguntas || []) {
    const id = Number(q.id_pregunta);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    const label = canonicalKey(q.etiqueta || q.titulo || "");
    if (!label) continue;
    const hit = keywords.find((k) => label.includes(canonicalKey(k)));
    if (!hit) continue;
    candidates.push({
      id_pregunta: id,
      etiqueta: q?.etiqueta || q?.titulo || `#${id}`,
      reason: "label_keyword",
    });
    seen.add(id);
  }

  return {
    candidates,
    suggestedId: candidates[0]?.id_pregunta || null,
  };
}

async function loadPreguntasByPlantilla(idPlantilla) {
  const qRes = await pool.query(
    `
    SELECT
      q.id_pregunta,
      q.etiqueta,
      q.opciones_json,
      q.tipo,
      q.obligatorio,
      q.permite_foto,
      q.visible_if,
      q.hide_if,
      q.activo
      ,s.visible_if AS sec_visible_if
    FROM ema.informe_pregunta q
    JOIN ema.informe_seccion s ON s.id_seccion = q.id_seccion
    WHERE s.id_plantilla = $1
    ORDER BY s.orden, q.orden
    `,
    [Number(idPlantilla)]
  );
  return qRes.rows || [];
}

function normalizeHex(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s.toUpperCase();
  if (/^#([0-9a-fA-F]{3})$/.test(s)) return s.toUpperCase();
  return null;
}

function normColorName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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

function semaforoToObj(input, paletteMap) {
  if (input === undefined || input === null) return null;
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
      let foundName = null;
      if (paletteMap && paletteMap.size) {
        for (const [k, v] of paletteMap.entries()) {
          if (String(v).toUpperCase() === hex) {
            foundName = k;
            break;
          }
        }
      }
      return { nombre: foundName || null, hex };
    }
    return null;
  }
  const s = String(input).trim();
  if (!s) return null;
  const hexDirect = normalizeHex(s);
  if (hexDirect) {
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
  const niceName = s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  return { nombre: niceName, hex: String(hex).toUpperCase() };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = new Array(limit).fill(0).map(async () => {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  return async (fn) => {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

/* =========================================================
   POST /api/informes/import-xlsx/profile
   ========================================================= */
async function profileImportXlsx(req, res) {
  try {
    const idProyecto = Number(req.body?.id_proyecto);
    const idPlantilla = Number(req.body?.id_plantilla);

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto invalido" });
    }
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "id_plantilla invalido" });
    }

    const file = pickSingleFile(req);
    if (!file) return res.status(400).json({ ok: false, error: "Archivo requerido" });

    if (file.size != null && Number(file.size) > MAX_IMPORT_BYTES) {
      return res.status(413).json({ ok: false, error: "Archivo demasiado grande" });
    }

    const { ext } = validateExcelFileOrThrow(file);

    const { headers, rows } = await parseXlsxBuffer(file.data);
    const uploadsRoot = path.join(__dirname, "..", "uploads");
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "El Excel no tiene filas validas" });
    }

    const preguntas = await loadPreguntasByPlantilla(idPlantilla);
    const mappingSuggested = suggestMapping(headers, preguntas);
    const unique = suggestUniqueField(headers, preguntas, mappingSuggested);

    return res.json({
      ok: true,
      file: {
        name: file.name,
        size: file.size,
        ext,
      },
      headers,
      previewRows: rows.slice(0, 8),
      totalRows: rows.length,
      preguntas,
      mappingSuggested,
      uniqueFieldCandidates: unique.candidates,
      uniqueFieldSuggestedId: unique.suggestedId,
    });
  } catch (err) {
    console.error("profileImportXlsx error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Error al perfilar el Excel",
    });
  }
}

/* =========================================================
   POST /api/informes/import-xlsx/prepare
   ========================================================= */
async function prepareImportXlsx(req, res) {
  try {
    const idProyecto = Number(req.body?.id_proyecto);
    const idPlantilla = Number(req.body?.id_plantilla);
    const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
    const previewRows = Array.isArray(req.body?.previewRows) ? req.body.previewRows : [];
    const totalRowsRaw = req.body?.totalRows;
    const totalRows =
      Number.isFinite(Number(totalRowsRaw)) && Number(totalRowsRaw) >= 0
        ? Number(totalRowsRaw)
        : previewRows.length;

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto invalido" });
    }
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "id_plantilla invalido" });
    }
    if (!headers.length) {
      return res.status(400).json({ ok: false, error: "Headers requeridos" });
    }

    const mappingRaw = req.body?.mapping;
    if (!mappingRaw) {
      return res.status(400).json({ ok: false, error: "Mapping requerido" });
    }

    let mapping = null;
    try {
      mapping = typeof mappingRaw === "string" ? JSON.parse(mappingRaw) : mappingRaw;
    } catch {
      return res.status(400).json({ ok: false, error: "Mapping invalido" });
    }

    const mappingArr = Array.isArray(mapping)
      ? mapping
      : Object.entries(mapping || {}).map(([col, id_pregunta]) => ({
          col,
          id_pregunta,
        }));

    const preguntas = await loadPreguntasByPlantilla(idPlantilla);
    const { byId } = buildPreguntasIndex(preguntas);

    const invalid = [];
    const used = new Map();
    const mappedCols = [];

    for (const m of mappingArr) {
      const col = String(m.col || "").trim();
      const idPreg = Number(m.id_pregunta);
      if (!col || !Number.isFinite(idPreg)) continue;
      if (!byId.has(idPreg)) {
        invalid.push({ col, id_pregunta: idPreg, reason: "pregunta_fuera_de_plantilla" });
        continue;
      }
      mappedCols.push(col);
      if (used.has(idPreg)) {
        invalid.push({ col, id_pregunta: idPreg, reason: "pregunta_duplicada" });
      } else {
        used.set(idPreg, col);
      }
    }

    if (invalid.length) {
      return res.status(400).json({
        ok: false,
        error: "Mapping invalido",
        details: invalid,
      });
    }

    const idPreguntaUnicidad =
      req.body?.id_pregunta_unicidad !== undefined && req.body?.id_pregunta_unicidad !== ""
        ? Number(req.body?.id_pregunta_unicidad)
        : null;

    if (idPreguntaUnicidad != null) {
      if (!byId.has(idPreguntaUnicidad)) {
        return res.status(400).json({ ok: false, error: "Campo unico fuera de plantilla" });
      }
      const isMapped = mappingArr.some(
        (m) => Number(m.id_pregunta) === Number(idPreguntaUnicidad)
      );
      if (!isMapped) {
        return res.status(400).json({
          ok: false,
          error: "El campo unico elegido no esta en el mapping",
        });
      }
    }

    const unmapped = headers.filter((h) => !mappedCols.includes(h));

    const mappingSuggested = suggestMapping(headers, preguntas);
    const unique = suggestUniqueField(headers, preguntas, mappingSuggested);

    return res.json({
      ok: true,
      resumen: "Preparacion OK. Listo para la siguiente iteracion.",
      totalRows,
      totalColumns: headers.length,
      totalMapped: mappedCols.length,
      columnasSinMatch: unmapped,
      id_pregunta_unicidad: idPreguntaUnicidad,
      preguntas,
      mappingSuggested,
      uniqueFieldCandidates: unique.candidates,
      uniqueFieldSuggestedId: unique.suggestedId,
    });
  } catch (err) {
    console.error("prepareImportXlsx error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Error al preparar import",
    });
  }
}

/* =========================================================
   GET /api/informes/import-xlsx/catalog
   ========================================================= */
async function catalogImportXlsx(req, res) {
  try {
    const idPlantilla = Number(req.body?.id_plantilla);
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "id_plantilla requerido" });
    }

    const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];

    const preguntas = await loadPreguntasByPlantilla(idPlantilla);
    const mappingSuggested = suggestMapping(headers, preguntas);
    const unique = suggestUniqueField(headers, preguntas, mappingSuggested);

    return res.json({
      ok: true,
      preguntas,
      mappingSuggested,
      uniqueFieldCandidates: unique.candidates,
      uniqueFieldSuggestedId: unique.suggestedId,
    });
  } catch (err) {
    console.error("catalogImportXlsx error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Error al cargar catalogo",
    });
  }
}

/* =========================================================
   POST /api/informes/import-xlsx/run
   ========================================================= */
async function runImportXlsx(req, res) {
  try {
    const idProyecto = Number(req.body?.id_proyecto);
    const idPlantilla = Number(req.body?.id_plantilla);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const totalRowsRaw = req.body?.totalRows;
    const totalRows =
      Number.isFinite(Number(totalRowsRaw)) && Number(totalRowsRaw) >= 0
        ? Number(totalRowsRaw)
        : rows.length;

    if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto invalido" });
    }
    if (!Number.isFinite(idPlantilla) || idPlantilla <= 0) {
      return res.status(400).json({ ok: false, error: "id_plantilla invalido" });
    }
    if (totalRows > MAX_IMPORT_ROWS) {
      return res.status(400).json({
        ok: false,
        error: `Excel demasiado grande. Maximo permitido: ${MAX_IMPORT_ROWS} filas`,
      });
    }

    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Rows requeridas" });
    }

    const mappingRaw = req.body?.mapping;
    if (!mappingRaw) {
      return res.status(400).json({ ok: false, error: "Mapping requerido" });
    }

    let mapping = null;
    try {
      mapping = typeof mappingRaw === "string" ? JSON.parse(mappingRaw) : mappingRaw;
    } catch {
      return res.status(400).json({ ok: false, error: "Mapping invalido" });
    }

    if (!Array.isArray(mapping) || !mapping.length) {
      return res.status(400).json({ ok: false, error: "Mapping requerido" });
    }

    const mappingArr = Array.isArray(mapping)
      ? mapping
      : Object.entries(mapping || {}).map(([col, id_pregunta]) => ({
          col,
          id_pregunta,
        }));

    const idPreguntaUnicidad =
      req.body?.id_pregunta_unicidad !== undefined && req.body?.id_pregunta_unicidad !== ""
        ? Number(req.body?.id_pregunta_unicidad)
        : null;

    if (!idPreguntaUnicidad) {
      return res.status(400).json({
        ok: false,
        error: "id_pregunta_unicidad requerido para ejecutar en esta iteracion",
      });
    }

    const preguntas = await loadPreguntasByPlantilla(idPlantilla);
    const { byId } = buildPreguntasIndex(preguntas);
    const semaforoPaletteMap = buildSemaforoPaletteMap(preguntas);

    const invalid = [];
    const used = new Map();
    const colByPregunta = new Map();

    for (const m of mappingArr) {
      const col = String(m.col || "").trim();
      const idPreg = Number(m.id_pregunta);
      if (!col || !Number.isFinite(idPreg)) continue;
      if (!byId.has(idPreg)) {
        invalid.push({ col, id_pregunta: idPreg, reason: "pregunta_fuera_de_plantilla" });
        continue;
      }
      if (used.has(idPreg)) {
        invalid.push({ col, id_pregunta: idPreg, reason: "pregunta_duplicada" });
      } else {
        used.set(idPreg, col);
        colByPregunta.set(idPreg, col);
      }
    }

    if (invalid.length) {
      return res.status(400).json({
        ok: false,
        error: "Mapping invalido",
        details: invalid,
      });
    }

    if (!byId.has(idPreguntaUnicidad)) {
      return res.status(400).json({ ok: false, error: "Campo unico fuera de plantilla" });
    }
    if (!colByPregunta.has(idPreguntaUnicidad)) {
      return res.status(400).json({
        ok: false,
        error: "El campo unico elegido no esta en el mapping",
      });
    }

    const chunkSize = 100;
    const concurrency = 3;
    const runImage = createLimiter(2);
    const results = [];

    const summary = {
      totalRows,
      created: 0,
      updated: 0,
      skipped: 0,
      errored: 0,
      hiddenSkipped: 0,
      imageFieldSkippedByRule: 0,
      imagesDownloaded: 0,
      imagesSkipped: 0,
      imagesErrored: 0,
    };

    const seenUniqueValues = new Set();

    const chunks = chunkArray(rows, chunkSize);
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      console.info(
        `[IMPORT INFORMES] chunk ${ci + 1}/${chunks.length} rows=${chunk.length}`
      );
      const colUnique = colByPregunta.get(idPreguntaUnicidad);

      const uniqueSet = new Set();
      const rowMeta = chunk.map((row) => {
        const rawUnique = row?.[colUnique];
        const uniqueNorm = normalizeUniqueValue(rawUnique);
        let isDuplicate = false;
        if (uniqueNorm) {
          if (seenUniqueValues.has(uniqueNorm)) {
            isDuplicate = true;
          } else {
            seenUniqueValues.add(uniqueNorm);
            uniqueSet.add(uniqueNorm);
          }
        }
        return { uniqueNorm, isDuplicate };
      });

      const uniqueList = Array.from(uniqueSet.values());
      const candidatesRes = uniqueList.length
        ? await pool.query(
            `
            SELECT i.id_informe, r.valor_texto, r.valor_bool, r.valor_json
            FROM ema.informe i
            JOIN ema.informe_respuesta r ON r.id_informe = i.id_informe
            WHERE i.id_plantilla = $1
              AND i.id_proyecto = $2
              AND r.id_pregunta = $3
              AND (
                (r.valor_texto IS NOT NULL AND regexp_replace(lower(trim(r.valor_texto)), '\\s+', ' ', 'g') = ANY($4))
                OR (r.valor_bool IS NOT NULL AND lower(r.valor_bool::text) = ANY($4))
                OR (r.valor_json IS NOT NULL AND regexp_replace(lower(trim(r.valor_json::text)), '\\s+', ' ', 'g') = ANY($4))
              )
            `,
            [idPlantilla, idProyecto, idPreguntaUnicidad, uniqueList]
          )
        : { rows: [] };

      const matchMap = new Map();
      for (const r of candidatesRes.rows || []) {
        const val = extractComparableAnswerValue(r);
        const norm = normalizeUniqueValue(val);
        if (!norm || !uniqueSet.has(norm)) continue;
        if (!matchMap.has(norm)) matchMap.set(norm, []);
        matchMap.get(norm).push(Number(r.id_informe));
      }

      const updateTargets = new Set();
      for (const row of chunk) {
        const rawUnique = row?.[colUnique];
        const uniqueNorm = normalizeUniqueValue(rawUnique);
        if (!uniqueNorm) continue;
        const matches = matchMap.get(uniqueNorm) || [];
        if (matches.length === 1) updateTargets.add(matches[0]);
      }

      const existingRespMap = new Map();
      if (updateTargets.size) {
        const ids = Array.from(updateTargets.values());
        const respRes = await pool.query(
          `
          SELECT id_informe, id_pregunta, valor_texto, valor_bool, valor_json
          FROM ema.informe_respuesta
          WHERE id_informe = ANY($1::int[])
          `,
          [ids]
        );
        for (const r of respRes.rows || []) {
          const idInf = Number(r.id_informe);
          if (!existingRespMap.has(idInf)) existingRespMap.set(idInf, new Map());
          existingRespMap.get(idInf).set(Number(r.id_pregunta), r);
        }
      }

      const existingFotoMap = new Map();
      if (updateTargets.size) {
        const ids = Array.from(updateTargets.values());
        const fotoRes = await pool.query(
          `
          SELECT id_informe, id_pregunta
          FROM ema.informe_foto
          WHERE id_informe = ANY($1::int[])
          `,
          [ids]
        );
        for (const r of fotoRes.rows || []) {
          const idInf = Number(r.id_informe);
          if (!existingFotoMap.has(idInf)) existingFotoMap.set(idInf, new Set());
          existingFotoMap.get(idInf).add(Number(r.id_pregunta));
        }
      }

      const chunkResults = await runWithConcurrency(chunk, concurrency, async (row, idx) => {
        const rowNumber = 2 + ci * chunkSize + idx;
        try {
          const answersForRules = {};
          for (const [idPreg, col] of colByPregunta.entries()) {
            answersForRules[idPreg] = row?.[col];
          }
          const visibleSet = new Set();
          for (const [idPreg, q] of byId.entries()) {
            if (computeVisibility(q, answersForRules)) visibleSet.add(Number(idPreg));
          }

          const rawUnique = row?.[colUnique];
          const uniqueNorm = normalizeUniqueValue(rawUnique);
          if (rowMeta[idx]?.isDuplicate) {
            summary.skipped += 1;
            return { rowNumber, action: "skipped", reason: "duplicate_in_import" };
          }
          if (!uniqueNorm) {
            summary.skipped += 1;
            return { rowNumber, action: "skipped", reason: "unique_value_missing" };
          }

          const matches = matchMap.get(uniqueNorm) || [];
          if (matches.length > 1) {
            summary.errored += 1;
            return { rowNumber, action: "error", reason: "match_ambiguous" };
          }

          if (matches.length === 0) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              const inf = await client.query(
                `
                INSERT INTO ema.informe (id_plantilla, id_proyecto, titulo)
                VALUES ($1, $2, $3)
                RETURNING id_informe
                `,
                [idPlantilla, idProyecto, null]
              );
              const idInforme = Number(inf.rows[0].id_informe);

              for (const [idPreg, col] of colByPregunta.entries()) {
                const q = byId.get(idPreg);
                if (!q) continue;
                if (!visibleSet.has(Number(idPreg))) {
                  summary.hiddenSkipped += 1;
                  continue;
                }
                const raw = row?.[col];
                const photoAllowed = canPersistPhotoByLegacyRule(q);
                const imageSource = isLikelyImageSource(raw);
                const persistAsPhotoOnly = photoAllowed && imageSource;
                const isImageQuestion = String(q.tipo || "").trim().toLowerCase() === "imagen";

                if (!persistAsPhotoOnly && isImageQuestion && !isEmptyAnswer(raw)) {
                  summary.imageFieldSkippedByRule += 1;
                }

                if (!persistAsPhotoOnly && !isImageQuestion) {
                  const normalized = normalizeAnswerForSaveByTipo(q.tipo, raw);
                  if (!isEmptyAnswer(normalized)) {
                    let valor_texto = null;
                    let valor_bool = null;
                    let valor_json = null;

                    if (String(q.tipo || "").trim().toLowerCase() === "semaforo") {
                      const obj = semaforoToObj(normalized, semaforoPaletteMap);
                      if (obj && obj.hex) {
                        valor_texto = obj.nombre || null;
                        valor_json = { nombre: obj.nombre || null, hex: obj.hex };
                      } else {
                        const t = toJsonbOrText(normalized);
                        valor_texto = t.valor_texto;
                        valor_bool = t.valor_bool;
                        valor_json = t.valor_json;
                      }
                    } else {
                      const t = toJsonbOrText(normalized);
                      valor_texto = t.valor_texto;
                      valor_bool = t.valor_bool;
                      valor_json = t.valor_json;
                    }

                    await client.query(
                      `
                      INSERT INTO ema.informe_respuesta
                        (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
                      VALUES ($1, $2, $3, $4, $5::jsonb)
                      `,
                      [idInforme, idPreg, valor_texto, valor_bool, valor_json]
                    );
                  }
                }

                if (persistAsPhotoOnly) {
                  try {
                    const saved = await runImage(async () => {
                      const baseDir = path.join(
                        uploadsRoot,
                        "proyectos",
                        String(idProyecto || "sin_proyecto"),
                        "informes",
                        String(idInforme)
                      );
                      const safeName = sanitizeFilename(`preg_${idPreg}_foto_1`);
                      const destAbs = path.join(baseDir, safeName);
                      return downloadImageToFile(raw.trim(), destAbs);
                    });
                    const rel = path.relative(uploadsRoot, saved.finalAbs).replace(/\\/g, "/");
                    await client.query(
                      `
                      INSERT INTO ema.informe_foto
                        (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
                      VALUES ($1, $2, $3, $4, $5)
                      `,
                      [idInforme, idPreg, null, rel, 1]
                    );
                    summary.imagesDownloaded += 1;
                  } catch {
                    summary.imagesErrored += 1;
                  }
                }
              }

              await client.query("COMMIT");
              summary.created += 1;
              return { rowNumber, action: "created", id_informe: idInforme };
            } catch (e) {
              await client.query("ROLLBACK");
              throw e;
            } finally {
              client.release();
            }
          }

          const idInforme = matches[0];
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const existing = existingRespMap.get(idInforme) || new Map();
            const fotos = existingFotoMap.get(idInforme) || new Set();

            for (const [idPreg, col] of colByPregunta.entries()) {
              const q = byId.get(idPreg);
              if (!q) continue;
              if (!visibleSet.has(Number(idPreg))) {
                summary.hiddenSkipped += 1;
                continue;
              }
              const raw = row?.[col];
              const photoAllowed = canPersistPhotoByLegacyRule(q);
              const imageSource = isLikelyImageSource(raw);
              const persistAsPhotoOnly = photoAllowed && imageSource;
              const isImageQuestion = String(q.tipo || "").trim().toLowerCase() === "imagen";

              if (!persistAsPhotoOnly && isImageQuestion && !isEmptyAnswer(raw)) {
                summary.imageFieldSkippedByRule += 1;
              }

              if (!persistAsPhotoOnly && !isImageQuestion) {
                const normalized = normalizeAnswerForSaveByTipo(q.tipo, raw);
                if (!isEmptyAnswer(normalized)) {
                  let valor_texto = null;
                  let valor_bool = null;
                  let valor_json = null;

                  if (String(q.tipo || "").trim().toLowerCase() === "semaforo") {
                    const obj = semaforoToObj(normalized, semaforoPaletteMap);
                    if (obj && obj.hex) {
                      valor_texto = obj.nombre || null;
                      valor_json = { nombre: obj.nombre || null, hex: obj.hex };
                    } else {
                      const t = toJsonbOrText(normalized);
                      valor_texto = t.valor_texto;
                      valor_bool = t.valor_bool;
                      valor_json = t.valor_json;
                    }
                  } else {
                    const t = toJsonbOrText(normalized);
                    valor_texto = t.valor_texto;
                    valor_bool = t.valor_bool;
                    valor_json = t.valor_json;
                  }

                  if (existing.has(idPreg)) {
                    await client.query(
                      `
                      UPDATE ema.informe_respuesta
                      SET valor_texto = $3, valor_bool = $4, valor_json = $5::jsonb
                      WHERE id_informe = $1 AND id_pregunta = $2
                      `,
                      [idInforme, idPreg, valor_texto, valor_bool, valor_json]
                    );
                  } else {
                    await client.query(
                      `
                      INSERT INTO ema.informe_respuesta
                        (id_informe, id_pregunta, valor_texto, valor_bool, valor_json)
                      VALUES ($1, $2, $3, $4, $5::jsonb)
                      `,
                      [idInforme, idPreg, valor_texto, valor_bool, valor_json]
                    );
                  }
                }
              }

              if (persistAsPhotoOnly) {
                if (fotos.has(idPreg)) {
                  summary.imagesSkipped += 1;
                } else {
                  try {
                    const saved = await runImage(async () => {
                      const baseDir = path.join(
                        uploadsRoot,
                        "proyectos",
                        String(idProyecto || "sin_proyecto"),
                        "informes",
                        String(idInforme)
                      );
                      const safeName = sanitizeFilename(`preg_${idPreg}_foto_1`);
                      const destAbs = path.join(baseDir, safeName);
                      return downloadImageToFile(raw.trim(), destAbs);
                    });
                    const rel = path.relative(uploadsRoot, saved.finalAbs).replace(/\\/g, "/");
                    await client.query(
                      `
                      INSERT INTO ema.informe_foto
                        (id_informe, id_pregunta, descripcion, ruta_archivo, orden)
                      VALUES ($1, $2, $3, $4, $5)
                      `,
                      [idInforme, idPreg, null, rel, 1]
                    );
                    summary.imagesDownloaded += 1;
                  } catch {
                    summary.imagesErrored += 1;
                  }
                }
              }
            }

            await client.query("COMMIT");
            summary.updated += 1;
            return { rowNumber, action: "updated", id_informe: idInforme };
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        } catch (e) {
          summary.errored += 1;
          return { rowNumber, action: "error", reason: e?.message || "error" };
        }
      });

      results.push(...chunkResults);
    }

    const limit = 200;
    const rowsOut = results.length > limit ? results.slice(0, limit) : results;

    return res.json({
      ok: true,
      summary,
      rows: rowsOut,
      rowsLimit: limit,
      rowsTruncated: results.length > limit,
    });
  } catch (err) {
    console.error("runImportXlsx error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Error al ejecutar import",
    });
  }
}

module.exports = {
  profileImportXlsx,
  catalogImportXlsx,
  prepareImportXlsx,
  runImportXlsx,
};
