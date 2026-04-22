"use strict";

const path = require("path");
const fs = require("fs-extra");
const mime = require("mime-types");
const pool = require("../db");

// MISMA BASE que tu documentos.controller
const BASE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "documentosproyecto");
const BASE_UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

// =====================
// helpers
// =====================
function sanitizeFilename(name) {
  if (!name) return "";
  name = path.basename(String(name)).replace(/[\r\n]+/g, " ").trim();
  const bad = /[<>:"/\\|?*\u0000-\u001F]/g;
  name = name.replace(bad, "_");
  if (name === "." || name === "..") name = `archivo_${Date.now()}`;
  return name || `archivo_${Date.now()}`;
}

function sanitizeFolder(folder) {
  if (!folder) return "";
  folder = String(folder).replace(/^\.+/g, "").replace(/[\\/]+/g, " ").trim();
  folder = folder.replace(/[\u0000-\u001F]/g, "");
  if (!folder || folder === "." || folder === "..") return "";
  return folder;
}

async function uniqueFilename(dir, desired) {
  await fs.ensureDir(dir);
  const full = path.join(dir, desired);
  if (!(await fs.pathExists(full))) return desired;

  const { name, ext } = path.parse(desired);
  let i = 1;
  while (true) {
    const candidate = `${name} (${i})${ext}`;
    const full2 = path.join(dir, candidate);
    if (!(await fs.pathExists(full2))) return candidate;
    i++;
  }
}

function normalizeUploadedFiles(filesField) {
  if (!filesField) return [];
  if (Array.isArray(filesField)) return filesField;
  if (typeof filesField === "object") {
    const keys = Object.keys(filesField);
    const looksIndexed = keys.length && keys.every((k) => /^\d+$/.test(k));
    if (looksIndexed) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => filesField[k])
        .filter(Boolean);
    }
  }
  return [filesField];
}

function pickFilesFromReq(req) {
  const raw =
    req.files?.archivo ??
    req.files?.["archivo[]"] ??
    req.files?.archivos ??
    req.files?.["archivos[]"];
  return normalizeUploadedFiles(raw);
}

function isExpressFileUploadFile(f) {
  return f && typeof f === "object" && typeof f.mv === "function" && typeof f.name === "string";
}

function parseOptionalNonNegNumeric(raw, fieldName) {
  const present = Object.prototype.hasOwnProperty.call(raw || {}, fieldName);
  if (!present) return { present: false, value: null };

  const v = raw[fieldName];
  if (v === null) return { present: true, value: null };

  const s = String(v ?? "").trim();
  if (!s) return { present: true, value: null };

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${fieldName} invalido (debe ser null o >= 0)`);
    err.statusCode = 400;
    throw err;
  }

  // Se conserva como string para no perder precisión si el campo es NUMERIC en PG
  return { present: true, value: s };
}

function parseOptionalBoolean(raw, fieldName) {
  const present = Object.prototype.hasOwnProperty.call(raw || {}, fieldName);
  if (!present) return { present: false, value: false };

  const v = raw[fieldName];
  if (typeof v === "boolean") return { present: true, value: v };
  if (typeof v === "number" && (v === 0 || v === 1)) return { present: true, value: Boolean(v) };
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return { present: true, value: true };
    if (s === "false" || s === "0" || s === "") return { present: true, value: false };
  }

  const err = new Error(`${fieldName} invalido (debe ser boolean)`);
  err.statusCode = 400;
  throw err;
}

function parseOptionalJsonb(raw, fieldName) {
  const present = Object.prototype.hasOwnProperty.call(raw || {}, fieldName);
  if (!present) return { present: false, value: null };

  const v = raw[fieldName];
  if (v === null) return { present: true, value: null };
  if (typeof v === "object") return { present: true, value: v };
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return { present: true, value: null };
    try {
      return { present: true, value: JSON.parse(s) };
    } catch (e) {
      const err = new Error(`${fieldName} invalido (debe ser JSON)`);
      err.statusCode = 400;
      throw err;
    }
  }

  const err = new Error(`${fieldName} invalido (debe ser JSON)`);
  err.statusCode = 400;
  throw err;
}

function toJsonbParam(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parseOptionalString(raw, fieldName) {
  const present = Object.prototype.hasOwnProperty.call(raw || {}, fieldName);
  if (!present) return { present: false, value: null };
  return { present: true, value: cleanStr(raw[fieldName]) };
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

function resolveAbsolutePath(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;
  if (isRemoteUrl(raw)) return null;

  const normalized = raw.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();

  if (path.isAbsolute(raw)) {
    if (fs.existsSync(raw)) return raw;

    const idxDocs = lower.indexOf("/documentosproyecto/");
    if (idxDocs !== -1) {
      const relDoc = normalized.slice(idxDocs + "/documentosproyecto/".length);
      return path.join(BASE_UPLOAD_DIR, relDoc);
    }

    const idxUploads = lower.indexOf("/uploads/");
    if (idxUploads !== -1) {
      const rel = normalized.slice(idxUploads + "/uploads/".length);
      return path.join(__dirname, "..", "uploads", rel);
    }

    return path.join(__dirname, "..", "uploads", path.basename(raw));
  }

  let p = normalized.replace(/^[/]+/, "");
  const lowerP = p.toLowerCase();

  if (lowerP.startsWith("uploads/")) {
    return path.join(__dirname, "..", p);
  }

  if (lowerP.startsWith("documentosproyecto/")) {
    return path.join(BASE_UPLOAD_DIR, p.slice("documentosproyecto/".length));
  }

  return path.join(__dirname, "..", "uploads", p);
}

function resolveRecoveredRemotePath(url) {
  if (!isRemoteUrl(url)) return null;
  try {
    const parsed = new URL(String(url).trim());
    const pathname = parsed.pathname.replace(/\\/g, "/");
    const segments = pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => sanitizeFilename(segment));
    const filename = segments.length ? segments.pop() : "archivo_remoto";
    return path.join(
      BASE_UPLOAD_DIR,
      "recovered",
      sanitizeFolder(parsed.hostname) || "host",
      ...segments,
      sanitizeFilename(filename)
    );
  } catch {
    return null;
  }
}

function buildExpedientesListFilter({ idProyecto, q, tramoId, subtramoId }) {
  const params = [idProyecto];
  let idx = 2;
  let whereSql = `WHERE id_proyecto = $1`;

  if (q) {
    params.push(`%${q}%`);
    whereSql +=
      ` AND (` +
      `propietario_nombre ILIKE $${idx} OR ` +
      `propietario_ci ILIKE $${idx} OR ` +
      `pareja_nombre ILIKE $${idx} OR ` +
      `pareja_ci ILIKE $${idx} OR ` +
      `codigo_exp ILIKE $${idx} OR ` +
      `codigo_censo ILIKE $${idx} OR ` +
      `COALESCE(carpeta_dbi->>'codigo','') ILIKE $${idx}` +
      `)`;
    idx += 1;
  }

  if (Number.isFinite(tramoId) && tramoId > 0) {
    params.push(tramoId);
    whereSql += ` AND id_tramo = $${idx}`;
    idx += 1;
  }

  if (Number.isFinite(subtramoId) && subtramoId > 0) {
    params.push(subtramoId);
    whereSql += ` AND id_sub_tramo = $${idx}`;
    idx += 1;
  }

  return { whereSql, params };
}

async function cleanupExpedienteFiles(fileRows = []) {
  const total = Array.isArray(fileRows) ? fileRows.length : 0;
  let deleted = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (const row of fileRows || []) {
    const ruta = row?.url ?? row?.ruta ?? row?.ruta_archivo ?? null;
    if (!ruta) continue;

    try {
      const abs = resolveAbsolutePath(ruta) || resolveRecoveredRemotePath(ruta);
      if (!abs) {
        failed += 1;
        errors.push({ ruta, error: "ruta inválida" });
        continue;
      }

      const absNorm = path.resolve(abs);
      const baseDocs = path.resolve(BASE_UPLOAD_DIR);
      const baseUploads = path.resolve(BASE_UPLOADS_ROOT);
      const absLower = absNorm.toLowerCase();
      const baseDocsLower = (baseDocs + path.sep).toLowerCase();
      const baseUploadsLower = (baseUploads + path.sep).toLowerCase();

      if (!absLower.startsWith(baseDocsLower) && !absLower.startsWith(baseUploadsLower)) {
        failed += 1;
        errors.push({ ruta, error: "fuera de directorios permitidos" });
        continue;
      }

      if (await fs.pathExists(absNorm)) {
        await fs.remove(absNorm);
        deleted += 1;
      } else {
        skipped += 1;
      }
    } catch (e) {
      if (String(e?.code) === "ENOENT") {
        skipped += 1;
      } else {
        failed += 1;
        errors.push({ ruta, error: e?.message || String(e) });
      }
    }
  }

  console.info("[cleanupExpedienteFiles] summary", {
    total,
    deleted,
    failed,
    skipped,
    sample_errors: failed > 0 ? errors.slice(0, 5) : [],
  });

  return { total, deleted, skipped, failed, errors };
}

async function deleteExpedientesTx(client, ids) {
  const { rows: docs } = await client.query(
    `SELECT url
       FROM ema.tumba
      WHERE tipo_documento = 'expedientes'
        AND id_documento = ANY($1::int[])`,
    [ids]
  );

  await client.query(
    `DELETE FROM ema.bloque_mejoras WHERE id_expediente = ANY($1::int[])`,
    [ids]
  );
  await client.query(
    `DELETE FROM ema.bloque_terreno WHERE id_expediente = ANY($1::int[])`,
    [ids]
  );

  await client.query(
    `DELETE FROM ema.tumba
      WHERE tipo_documento = 'expedientes'
        AND id_documento = ANY($1::int[])`,
    [ids]
  );

  const del = await client.query(
    `DELETE FROM ema.expedientes WHERE id_expediente = ANY($1::int[])`,
    [ids]
  );

  return { fileRows: docs || [], deletedCount: del.rowCount };
}

function sendInline(res, absPath, filename) {
  const ctype = mime.lookup(absPath) || "application/octet-stream";
  res.setHeader("Content-Type", ctype);
  const safeName = String(filename || path.basename(absPath));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(absPath);
}

function sendDownload(res, absPath, filename) {
  const ctype = mime.lookup(absPath) || "application/octet-stream";
  res.setHeader("Content-Type", ctype);
  const safeName = String(filename || path.basename(absPath));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  return res.sendFile(absPath);
}

// =====================
// ✅ ETAPAS: defaults
// =====================
const ETAPAS_MEJORA = [
  "documentacion",
  "plano_georef",
  "avaluo",
  "notif_conformidad",
  "documentacion_final",
];

const ETAPAS_TERRENO = [
  "documentacion",
  "plano_georef",
  "informe_pericial",
  "plantilla",
  "avaluo",
  "notif_conformidad",
  "documentacion_final",
];

function emptyState(keys) {
  const obj = {};
  keys.forEach((k) => (obj[k] = { ok: false, obs: "", date: null }));
  return obj;
}

function nowIso() {
  return new Date().toISOString();
}

function parseToIsoOrNull(raw) {
  if (!raw) return null;
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseYmdToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseOptionalDateYMD(raw, fieldName) {
  const present = Object.prototype.hasOwnProperty.call(raw || {}, fieldName);
  if (!present) return { present: false, value: null };
  const v = raw?.[fieldName];
  if (v === null) return { present: true, value: null };
  const s = String(v ?? "").trim();
  if (!s) return { present: true, value: null };
  if (!isYmd(s)) {
    const err = new Error(`${fieldName} debe tener formato YYYY-MM-DD o ser null`);
    err.statusCode = 400;
    throw err;
  }
  return { present: true, value: s };
}

function normalizeStageEntry(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return {
      ...entry,
      ok: Boolean(entry.ok),
      obs: typeof entry.obs === "string" ? entry.obs : "",
      date: entry.date || null,
    };
  }

  if (typeof entry === "boolean") {
    return { ok: entry, obs: "", date: null };
  }

  return { ok: false, obs: "", date: null };
}

function normalizeStageFolder(keys, folder) {
  const src = folder && typeof folder === "object" && !Array.isArray(folder) ? folder : {};
  const out = { ...src };
  for (const key of keys) {
    out[key] = normalizeStageEntry(src[key]);
  }
  return out;
}

function normalizeDbiState(dbi) {
  const src = dbi && typeof dbi === "object" && !Array.isArray(dbi) ? dbi : {};
  const estadosRaw = Array.isArray(src.estados) ? src.estados : [];

  return {
    ...src,
    codigo: src.codigo || "",
    ok: Boolean(src.ok),
    obs: typeof src.obs === "string" ? src.obs : "",
    fecha_ingreso: src.fecha_ingreso || null,
    estado: src.estado || null,
    estados: estadosRaw
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        ...item,
        estado: item.estado ? String(item.estado) : "",
        fecha: item.fecha || null,
        obs: typeof item.obs === "string" ? item.obs : "",
      }))
      .filter((item) => item.estado || item.fecha || item.obs),
  };
}

function appendDbiEventIfNeeded(dbi, event) {
  const curr = normalizeDbiState(dbi);
  const normalizedEvent = {
    estado: event?.estado ? String(event.estado) : "",
    fecha: parseToIsoOrNull(event?.fecha) || nowIso(),
    obs: typeof event?.obs === "string" ? event.obs : "",
  };

  if (!normalizedEvent.estado) return curr;

  const exists = curr.estados.some(
    (item) =>
      item.estado === normalizedEvent.estado &&
      item.fecha === normalizedEvent.fecha &&
      item.obs === normalizedEvent.obs
  );

  if (exists) return curr;
  return { ...curr, estados: [...curr.estados, normalizedEvent] };
}

function normalizeTipo(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  if (t === "mejora" || t === "mejoras") return "mejora";
  if (t === "terreno") return "terreno";
  if (t === "dbi") return "dbi";
  return null;
}

function normalizeTipoPoligono(raw) {
  const t = String(raw || "").toLowerCase().trim();
  if (t === "afectacion") return "afectacion";
  return "proyecto";
}

async function getProyectoByExpediente(idExpediente) {
  const q = await pool.query(
    `SELECT id_proyecto, fecha_relevamiento, carpeta_mejora, carpeta_terreno, carpeta_dbi
       FROM ema.expedientes
      WHERE id_expediente = $1`,
    [Number(idExpediente)]
  );
  if (!q.rows.length) return null;
  return q.rows[0];
}

async function ensureEtapas(idExpediente) {
  const rec = await getProyectoByExpediente(idExpediente);
  if (!rec) return null;

  const cm = rec.carpeta_mejora || {};
  const ct = rec.carpeta_terreno || {};
  const cd = rec.carpeta_dbi || {};

  const newCm = normalizeStageFolder(ETAPAS_MEJORA, cm);
  const newCt = normalizeStageFolder(ETAPAS_TERRENO, ct);
  const newCd = normalizeDbiState(cd);

  if (JSON.stringify(newCm) !== JSON.stringify(cm) || JSON.stringify(newCt) !== JSON.stringify(ct)) {
    await pool.query(
      `UPDATE ema.expedientes
          SET carpeta_mejora = $1,
              carpeta_terreno = $2,
              updated_at = now()
        WHERE id_expediente = $3`,
      [newCm, newCt, Number(idExpediente)]
    );
  }

  if (JSON.stringify(newCd) !== JSON.stringify(cd)) {
    await pool.query(
      `UPDATE ema.expedientes
          SET carpeta_dbi = $1,
              updated_at = now()
        WHERE id_expediente = $2`,
      [newCd, Number(idExpediente)]
    );
  }

  return { ...rec, carpeta_mejora: newCm, carpeta_terreno: newCt, carpeta_dbi: newCd };
}

// =====================
// helpers import / CRUD
// =====================
function cleanStr(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function isYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanDateYMD(v) {
  const s = String(v ?? "").trim();
  if (!s) {
    const fallback = todayYMD();
    console.warn(`[EXP IMPORT] fecha_relevamiento faltante; se asigna today (${fallback})`);
    return fallback;
  }
  return s;
}

function requireFechaRelevamiento(b) {
  const raw = String(b?.fecha_relevamiento ?? "").trim();
  if (!raw || !isYmd(raw)) {
    const err = new Error("fecha_relevamiento es obligatoria y debe tener formato YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

async function resolveTramoInfo(b) {
  let finalTramo = b.tramo || null;
  let finalSubtramo = b.subtramo || null;

  let finalIdTramo =
    Number.isFinite(Number(b.id_tramo)) && Number(b.id_tramo) > 0 ? Number(b.id_tramo) : null;

  let finalIdSubTramo =
    Number.isFinite(Number(b.id_sub_tramo)) && Number(b.id_sub_tramo) > 0
      ? Number(b.id_sub_tramo)
      : null;

  let finalCodigoCenso = b.codigo_censo ? String(b.codigo_censo).trim() : null;

  if (finalIdTramo) {
    const { rows: tRows } = await pool.query(
      `SELECT descripcion
         FROM ema.proyecto_tramos
        WHERE id_proyecto_tramo = $1`,
      [finalIdTramo]
    );
    if (tRows.length) {
      finalTramo = tRows[0].descripcion;
    } else {
      finalIdTramo = null;
    }
  }

  if (finalIdSubTramo) {
    const { rows: stRows } = await pool.query(
      `SELECT descripcion
         FROM ema.proyecto_subtramos
        WHERE id_proyecto_subtramo = $1`,
      [finalIdSubTramo]
    );
    if (stRows.length) {
      finalSubtramo = stRows[0].descripcion;
    } else {
      finalIdSubTramo = null;
    }
  }

  return {
    tramo: finalTramo,
    subtramo: finalSubtramo,
    id_tramo: finalIdTramo,
    id_sub_tramo: finalIdSubTramo,
    codigo_censo: finalCodigoCenso || null,
  };
}

// =====================
// CRUD
// =====================
exports.listByProyecto = async (req, res) => {
  const idProyecto = Number(req.params.idProyecto);
  const q = String(req.query.q || "").trim();
  const tramoId = Number(req.query.tramoId);
  const subtramoId = Number(req.query.subtramoId);

  const { whereSql, params } = buildExpedientesListFilter({
    idProyecto,
    q,
    tramoId,
    subtramoId,
  });
  const sql = `SELECT * FROM ema.expedientes ${whereSql} ORDER BY created_at DESC`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
};

exports.getOne = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const { rows } = await pool.query(
    `SELECT * FROM ema.expedientes WHERE id_expediente = $1`,
    [idExp]
  );
  if (!rows.length) return res.status(404).json({ error: "Expediente no encontrado" });
  res.json(rows[0]);
};

exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const fechaRelevamiento = requireFechaRelevamiento(b);
    const resTramo = await resolveTramoInfo(b);

    const parteA = parseOptionalNonNegNumeric(b, "parte_a");
    const parteB = parseOptionalNonNegNumeric(b, "parte_b");
    const premioAplica = parseOptionalBoolean(b, "premio_aplica");

    const superficie = parseOptionalNonNegNumeric(b, "superficie");
    const superficieAfectada = parseOptionalNonNegNumeric(b, "superficie_afectada");
    const porcentajeAfectacion = parseOptionalNonNegNumeric(b, "porcentaje_afectacion");
    const desafectado = parseOptionalBoolean(b, "desafectado");
    const desafectadoDetalle = parseOptionalJsonb(b, "desafectado_detalle");
    const documentacionPresentada = parseOptionalJsonb(b, "documentacion_presentada");
    const progresivaIni = parseOptionalString(b, "progresiva_ini");
    const progresivaFin = parseOptionalString(b, "progresiva_fin");
    const margen = parseOptionalString(b, "margen");
    const percepcionNotificador = parseOptionalString(b, "percepcion_notificador");
    const observacionNotificador = parseOptionalString(b, "observacion_notificador");

    const { rows } = await pool.query(
      `INSERT INTO ema.expedientes
       (
         id_proyecto,
         fecha_relevamiento,
         gps,
         tecnico,
         codigo_exp,
         propietario_nombre,
         propietario_ci,
         pareja_nombre,
         pareja_ci,
         tramo,
         subtramo,
         id_tramo,
         id_sub_tramo,
         codigo_censo,
         parte_a,
         parte_b,
         premio_aplica,
         superficie,
         superficie_afectada,
         progresiva_ini,
         progresiva_fin,
         margen,
         porcentaje_afectacion,
         desafectado,
         desafectado_detalle,
         documentacion_presentada,
         percepcion_notificador,
         observacion_notificador
       )
       VALUES
       (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
       )
       RETURNING *`,
      [
        Number(b.id_proyecto),
        fechaRelevamiento,
        b.gps || null,
        b.tecnico || null,
        b.codigo_exp || null,
        b.propietario_nombre || null,
        b.propietario_ci || null,
        cleanStr(b.pareja_nombre),
        cleanStr(b.pareja_ci),
        resTramo.tramo,
        resTramo.subtramo,
        resTramo.id_tramo,
        resTramo.id_sub_tramo,
        resTramo.codigo_censo,
        parteA.present ? parteA.value : null,
        parteB.present ? parteB.value : null,
        premioAplica.present ? premioAplica.value : false,
        superficie.present ? superficie.value : null,
        superficieAfectada.present ? superficieAfectada.value : null,
        progresivaIni.present ? progresivaIni.value : null,
        progresivaFin.present ? progresivaFin.value : null,
        margen.present ? margen.value : null,
        porcentajeAfectacion.present ? porcentajeAfectacion.value : null,
        desafectado.present ? desafectado.value : false,
        desafectadoDetalle.present ? toJsonbParam(desafectadoDetalle.value) : toJsonbParam({}),
        documentacionPresentada.present ? toJsonbParam(documentacionPresentada.value) : toJsonbParam([]),
        percepcionNotificador.present ? percepcionNotificador.value : null,
        observacionNotificador.present ? observacionNotificador.value : null,
      ]
    );

    await ensureEtapas(rows[0].id_expediente);

    const { rows: rows2 } = await pool.query(
      `SELECT * FROM ema.expedientes WHERE id_expediente = $1`,
      [rows[0].id_expediente]
    );

    res.json(rows2[0]);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ message: e?.message || String(e) });
  }
};

exports.update = async (req, res) => {
  try {
    const idExp = Number(req.params.idExpediente);
    const b = req.body || {};
    const fechaRelevamiento = requireFechaRelevamiento(b);
    const resTramo = await resolveTramoInfo(b);

    const parteA = parseOptionalNonNegNumeric(b, "parte_a");
    const parteB = parseOptionalNonNegNumeric(b, "parte_b");
    const premioAplica = parseOptionalBoolean(b, "premio_aplica");

    const superficie = parseOptionalNonNegNumeric(b, "superficie");
    const superficieAfectada = parseOptionalNonNegNumeric(b, "superficie_afectada");
    const porcentajeAfectacion = parseOptionalNonNegNumeric(b, "porcentaje_afectacion");
    const desafectado = parseOptionalBoolean(b, "desafectado");
    const desafectadoDetalle = parseOptionalJsonb(b, "desafectado_detalle");
    const documentacionPresentada = parseOptionalJsonb(b, "documentacion_presentada");
    const progresivaIni = parseOptionalString(b, "progresiva_ini");
    const progresivaFin = parseOptionalString(b, "progresiva_fin");
    const margen = parseOptionalString(b, "margen");
    const percepcionNotificador = parseOptionalString(b, "percepcion_notificador");
    const observacionNotificador = parseOptionalString(b, "observacion_notificador");

    const sets = [
      "fecha_relevamiento=$1",
      "gps=$2",
      "tecnico=$3",
      "codigo_exp=$4",
      "propietario_nombre=$5",
      "propietario_ci=$6",
      "pareja_nombre=$7",
      "pareja_ci=$8",
      "tramo=$9",
      "subtramo=$10",
      "id_tramo=$11",
      "id_sub_tramo=$12",
      "codigo_censo=$13",
    ];

    const params = [
      fechaRelevamiento,
      b.gps || null,
      b.tecnico || null,
      b.codigo_exp || null,
      b.propietario_nombre || null,
      b.propietario_ci || null,
      cleanStr(b.pareja_nombre),
      cleanStr(b.pareja_ci),
      resTramo.tramo,
      resTramo.subtramo,
      resTramo.id_tramo,
      resTramo.id_sub_tramo,
      resTramo.codigo_censo,
    ];

    // reset to 14 because we added 2 columns
    let idx = 14;

    if (parteA.present) {
      sets.push(`parte_a=$${idx}`);
      params.push(parteA.value);
      idx += 1;
    }
    if (parteB.present) {
      sets.push(`parte_b=$${idx}`);
      params.push(parteB.value);
      idx += 1;
    }
    if (premioAplica.present) {
      sets.push(`premio_aplica=$${idx}`);
      params.push(premioAplica.value);
      idx += 1;
    }
    if (superficie.present) {
      sets.push(`superficie=$${idx}`);
      params.push(superficie.value);
      idx += 1;
    }
    if (superficieAfectada.present) {
      sets.push(`superficie_afectada=$${idx}`);
      params.push(superficieAfectada.value);
      idx += 1;
    }
    if (progresivaIni.present) {
      sets.push(`progresiva_ini=$${idx}`);
      params.push(progresivaIni.value);
      idx += 1;
    }
    if (progresivaFin.present) {
      sets.push(`progresiva_fin=$${idx}`);
      params.push(progresivaFin.value);
      idx += 1;
    }
    if (margen.present) {
      sets.push(`margen=$${idx}`);
      params.push(margen.value);
      idx += 1;
    }
    if (porcentajeAfectacion.present) {
      sets.push(`porcentaje_afectacion=$${idx}`);
      params.push(porcentajeAfectacion.value);
      idx += 1;
    }
    if (desafectado.present) {
      sets.push(`desafectado=$${idx}`);
      params.push(desafectado.value);
      idx += 1;
    }
    if (desafectadoDetalle.present) {
      sets.push(`desafectado_detalle=$${idx}`);
      params.push(toJsonbParam(desafectadoDetalle.value));
      idx += 1;
    }
    if (documentacionPresentada.present) {
      sets.push(`documentacion_presentada=$${idx}`);
      params.push(toJsonbParam(documentacionPresentada.value));
      idx += 1;
    }
    if (percepcionNotificador.present) {
      sets.push(`percepcion_notificador=$${idx}`);
      params.push(percepcionNotificador.value);
      idx += 1;
    }
    if (observacionNotificador.present) {
      sets.push(`observacion_notificador=$${idx}`);
      params.push(observacionNotificador.value);
      idx += 1;
    }

    sets.push("updated_at=now()");

    const { rows } = await pool.query(
      `UPDATE ema.expedientes SET
        ${sets.join(", ")}
       WHERE id_expediente=$${idx}
       RETURNING *`,
      [...params, idExp]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Expediente no encontrado" });
    }

    await ensureEtapas(idExp);

    const { rows: rows2 } = await pool.query(
      `SELECT * FROM ema.expedientes WHERE id_expediente = $1`,
      [idExp]
    );

    res.json(rows2[0]);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ message: e?.message || String(e) });
  }
};

exports.remove = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  if (!Number.isFinite(idExp) || idExp <= 0) {
    return res.status(400).json({ message: "idExpediente inválido" });
  }

  const client = await pool.connect();
  let fileRows = [];

  try {
    await client.query("BEGIN");

    const { rows: expRows } = await client.query(
      `SELECT id_expediente, id_proyecto
         FROM ema.expedientes
        WHERE id_expediente = $1
        FOR UPDATE`,
      [idExp]
    );

    if (!expRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Expediente no encontrado" });
    }

    const out = await deleteExpedientesTx(client, [idExp]);
    fileRows = out.fileRows || [];

    await client.query("COMMIT");

    const cleanup = await cleanupExpedienteFiles(fileRows);
    return res.json({
      ok: true,
      deleted_id: idExp,
      deleted: out.deletedCount,
      cleanup: {
        total: cleanup.total,
        deleted: cleanup.deleted,
        skipped: cleanup.skipped,
        failed: cleanup.failed,
      },
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    if (String(e?.code) === "23503") {
      return res.status(409).json({ message: "Conflicto de integridad al eliminar expediente." });
    }
    return res.status(500).json({ message: e?.message || String(e) });
  } finally {
    client.release();
  }
};

exports.bulkDeleteExpedientesByProyecto = async (req, res) => {
  const idProyecto = Number(req.params.idProyecto);
  if (!Number.isFinite(idProyecto) || idProyecto <= 0) {
    return res.status(400).json({ message: "idProyecto inválido" });
  }

  const isAdmin = Number(req.user?.tipo_usuario ?? req.user?.group_id) === 1;
  if (!isAdmin) return res.status(403).json({ message: "Solo admin puede borrar en masa" });

  const mode = req.body?.all === true ? "all" : "ids";
  let ids = [];

  if (mode === "ids") {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    ids = Array.from(
      new Set(rawIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))
    );

    if (!ids.length) return res.status(400).json({ message: "ids inválidos o vacíos" });
    if (ids.length > 5000) {
      return res.status(400).json({ message: "Límite de ids excedido (max 5000)" });
    }
  }

  const client = await pool.connect();
  let fileRows = [];

  try {
    await client.query("BEGIN");

    if (mode === "all") {
      const q = String(req.body?.filters?.q || "").trim();
      const tramoId = Number(req.body?.filters?.tramoId);
      const subtramoId = Number(req.body?.filters?.subtramoId);

      const { whereSql, params } = buildExpedientesListFilter({
        idProyecto,
        q,
        tramoId,
        subtramoId,
      });
      const sql = `SELECT id_expediente FROM ema.expedientes ${whereSql} FOR UPDATE`;
      const { rows } = await client.query(sql, params);
      ids = rows.map((r) => Number(r.id_expediente)).filter((n) => Number.isFinite(n) && n > 0);

      if (!ids.length) {
        await client.query("COMMIT");
        return res.json({
          ok: true,
          mode,
          deleted_count: 0,
          cleanup: { total: 0, deleted: 0, skipped: 0, failed: 0 },
        });
      }

      if (ids.length > 10000) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "El resultado excede el límite de seguridad (max 10000).",
          count: ids.length,
        });
      }
    }

    const { rows: found } = await client.query(
      `SELECT id_expediente
         FROM ema.expedientes
        WHERE id_expediente = ANY($1::int[])
          AND id_proyecto = $2
        FOR UPDATE`,
      [ids, idProyecto]
    );

    if (!found.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "No se encontraron expedientes" });
    }

    if (found.length !== ids.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "ids fuera de proyecto o conjunto inconsistente",
        requested_count: ids.length,
        found_count: found.length,
      });
    }

    const out = await deleteExpedientesTx(client, ids);
    fileRows = out.fileRows || [];

    await client.query("COMMIT");

    const cleanup = await cleanupExpedienteFiles(fileRows);
    const payload = {
      ok: true,
      mode,
      deleted_count: out.deletedCount,
      cleanup: {
        total: cleanup.total,
        deleted: cleanup.deleted,
        skipped: cleanup.skipped,
        failed: cleanup.failed,
      },
    };
    if (mode === "ids") payload.deleted_ids = ids;

    console.info("[expedientes.bulkDelete] summary", {
      idProyecto,
      mode,
      requested_count: mode === "ids" ? ids.length : undefined,
      deleted_count: out.deletedCount,
      cleanup_total: cleanup.total,
      cleanup_deleted: cleanup.deleted,
      cleanup_skipped: cleanup.skipped,
      cleanup_failed: cleanup.failed,
    });

    return res.json(payload);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    if (String(e?.code) === "23503") {
      return res.status(409).json({ message: "Conflicto de integridad al eliminar expedientes." });
    }
    return res.status(500).json({ message: e?.message || String(e) });
  } finally {
    client.release();
  }
};

// =====================
// Historial de visitas
// =====================
exports.listarVisitas = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  if (!Number.isFinite(idExp) || idExp <= 0) {
    return res.status(400).json({ message: "idExpediente invalido" });
  }

  const { rows } = await pool.query(
    `SELECT id_historial_visita,
            id_expediente,
            fecha,
            consultor,
            motivo,
            respuesta,
            documentos_recibidos,
            created_at
       FROM ema.expediente_historial_visitas
      WHERE id_expediente = $1
      ORDER BY fecha DESC NULLS LAST, id_historial_visita DESC`,
    [idExp]
  );

  return res.json(rows);
};

exports.crearVisita = async (req, res) => {
  try {
    const idExp = Number(req.params.idExpediente);
    if (!Number.isFinite(idExp) || idExp <= 0) {
      return res.status(400).json({ message: "idExpediente invalido" });
    }

    const b = req.body || {};
    const fecha = parseOptionalDateYMD(b, "fecha");
    const consultor = parseOptionalString(b, "consultor");
    const motivo = parseOptionalString(b, "motivo");
    const respuesta = parseOptionalString(b, "respuesta");
    const documentosRecibidos = parseOptionalJsonb(b, "documentos_recibidos");

    const { rows } = await pool.query(
      `INSERT INTO ema.expediente_historial_visitas
        (id_expediente, fecha, consultor, motivo, respuesta, documentos_recibidos)
       VALUES
        ($1, $2::date, $3, $4, $5, $6)
       RETURNING *`,
      [
        idExp,
        fecha.present ? fecha.value : null,
        consultor.present ? consultor.value : null,
        motivo.present ? motivo.value : null,
        respuesta.present ? respuesta.value : null,
        documentosRecibidos.present ? toJsonbParam(documentosRecibidos.value) : toJsonbParam([]),
      ]
    );

    return res.json(rows[0]);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ message: e?.message || String(e) });
  }
};

exports.actualizarVisita = async (req, res) => {
  try {
    const idExp = Number(req.params.idExpediente);
    const idVisita = Number(req.params.idVisita);
    if (!Number.isFinite(idExp) || idExp <= 0) {
      return res.status(400).json({ message: "idExpediente invalido" });
    }
    if (!Number.isFinite(idVisita) || idVisita <= 0) {
      return res.status(400).json({ message: "idVisita invalido" });
    }

    const b = req.body || {};
    const fecha = parseOptionalDateYMD(b, "fecha");
    const consultor = parseOptionalString(b, "consultor");
    const motivo = parseOptionalString(b, "motivo");
    const respuesta = parseOptionalString(b, "respuesta");
    const documentosRecibidos = parseOptionalJsonb(b, "documentos_recibidos");

    const sets = [];
    const params = [];
    let idx = 1;

    if (fecha.present) {
      sets.push(`fecha=$${idx++}::date`);
      params.push(fecha.value);
    }
    if (consultor.present) {
      sets.push(`consultor=$${idx++}`);
      params.push(consultor.value);
    }
    if (motivo.present) {
      sets.push(`motivo=$${idx++}`);
      params.push(motivo.value);
    }
    if (respuesta.present) {
      sets.push(`respuesta=$${idx++}`);
      params.push(respuesta.value);
    }
    if (documentosRecibidos.present) {
      sets.push(`documentos_recibidos=$${idx++}`);
      params.push(toJsonbParam(documentosRecibidos.value));
    }

    if (!sets.length) {
      return res.status(400).json({ message: "Sin campos para actualizar" });
    }

    params.push(idVisita);
    params.push(idExp);

    const { rows } = await pool.query(
      `UPDATE ema.expediente_historial_visitas
          SET ${sets.join(", ")}
        WHERE id_historial_visita = $${idx++}
          AND id_expediente = $${idx}
        RETURNING *`,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Visita no encontrada para este expediente" });
    }

    return res.json(rows[0]);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ message: e?.message || String(e) });
  }
};

// =====================
// ✅ ETAPAS endpoints
// =====================
exports.getEtapas = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipo = normalizeTipo(req.params.tipo);

  if (!tipo) return res.status(400).json({ message: "tipo inválido (mejora|terreno|dbi)" });

  const rec = await ensureEtapas(idExp);
  if (!rec) return res.status(404).json({ message: "Expediente no encontrado" });

  if (tipo === "mejora") return res.json(rec.carpeta_mejora || {});
  if (tipo === "terreno") return res.json(rec.carpeta_terreno || {});
  return res.json(rec.carpeta_dbi || {});
};

exports.setEtapa = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipo = normalizeTipo(req.params.tipo);
  const key = String(req.params.key || "").trim();

  if (!tipo) return res.status(400).json({ message: "tipo inválido (mejora|terreno|dbi)" });

  const rec = await ensureEtapas(idExp);
  if (!rec) return res.status(404).json({ message: "Expediente no encontrado" });

  const body = req.body || {};
  const ok = Boolean(body.ok);
  const obs = String(body.obs || "");

  let dateOverride = null;
  if (typeof body.date === "string" && body.date.trim()) {
    const parsed = new Date(body.date);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ message: "date inválida" });
    }
    dateOverride = parsed.toISOString();
  }

  if (tipo === "dbi") {
    const curr = normalizeDbiState(rec.carpeta_dbi);
    const wasOk = Boolean(curr.ok);
    const out = {
      ...curr,
      ok,
      obs,
      fecha_ingreso: !wasOk && ok ? curr.fecha_ingreso || nowIso() : curr.fecha_ingreso || null,
      estado: !wasOk && ok ? curr.estado || "ingresado" : curr.estado || null,
      estados: Array.isArray(curr.estados) ? curr.estados : [],
    };

    await pool.query(
      `UPDATE ema.expedientes SET carpeta_dbi=$1, updated_at=now() WHERE id_expediente=$2`,
      [out, idExp]
    );
    return res.json(out);
  }

  const list = tipo === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;
  if (!list.includes(key)) {
    return res.status(400).json({ message: "key inválida para ese tipo" });
  }

  const col = tipo === "mejora" ? "carpeta_mejora" : "carpeta_terreno";
  const current = normalizeStageFolder(list, tipo === "mejora" ? rec.carpeta_mejora : rec.carpeta_terreno);
  const previous = normalizeStageEntry(current?.[key]);

  let nextDate = previous.date || null;
  if (dateOverride) {
    nextDate = dateOverride;
  } else if (ok && !nextDate) {
    const fallbackRelev = parseYmdToIso(rec?.fecha_relevamiento);
    nextDate = fallbackRelev || nowIso();
  }

  const updated = {
    ...current,
    [key]: {
      ...previous,
      ok,
      obs,
      date: nextDate,
    },
  };

  await pool.query(
    `UPDATE ema.expedientes
        SET ${col} = $1,
            updated_at = now()
      WHERE id_expediente = $2`,
    [updated, idExp]
  );

  res.json(updated);
};

// =====================
// Documentos (tumba)
// =====================
exports.listarDocs = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const hasCarpetaFilter = Object.prototype.hasOwnProperty.call(req.query || {}, "carpeta");
  const subcarpeta = sanitizeFolder(req.query?.carpeta ?? "");
  const params = [idExp];

  let sql = `SELECT id_archivo, tipo_documento, subcarpeta, url, nombre_archivo,
                    to_char(fecha_reg,'YYYY-MM-DD HH24:MI') AS fecha
               FROM ema.tumba
              WHERE id_documento = $1
                AND tipo_documento = 'expedientes'
                AND estado = 1`;

  if (hasCarpetaFilter) {
    params.push(subcarpeta || "");
    sql += ` AND COALESCE(subcarpeta,'') = COALESCE($${params.length},'')`;
  }

  sql += ` ORDER BY fecha_reg DESC`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
};

exports.subirDocs = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const exp = await getProyectoByExpediente(idExp);
  if (!exp?.id_proyecto) {
    return res.status(404).json({ message: "Expediente/proyecto no encontrado" });
  }

  const idProyecto = exp.id_proyecto;
  const subcarpetaRaw = req.body?.subcarpeta ?? req.query?.subcarpeta ?? "";
  const subcarpeta = sanitizeFolder(subcarpetaRaw);
  const files = pickFilesFromReq(req);

  if (!files.length) {
    return res.status(400).json({ message: "No se subió ningún archivo." });
  }

  const baseDir = path.join(
    BASE_UPLOAD_DIR,
    `proyecto_${idProyecto}`,
    "expedientes",
    String(idExp),
    subcarpeta || ""
  );

  await fs.ensureDir(baseDir);

  const subidos = [];
  const fallidos = [];

  for (const f of files) {
    let destPath = null;
    try {
      if (!isExpressFileUploadFile(f)) {
        throw new Error("Formato no compatible (mv no existe).");
      }

      const originalName = sanitizeFilename(f.name);
      const finalName = await uniqueFilename(baseDir, originalName);
      destPath = path.join(baseDir, finalName);

      await f.mv(destPath);

      const rel = path.posix.join(
        "/uploads/documentosproyecto",
        `proyecto_${idProyecto}`,
        "expedientes",
        String(idExp),
        ...(subcarpeta ? [subcarpeta] : []),
        finalName
      );

      await pool.query(
        `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, subcarpeta, url, nombre_archivo)
         VALUES ($1, 'expedientes', 5, $2, $3, $4)`,
        [idExp, subcarpeta || null, rel, finalName]
      );

      subidos.push({ nombre_archivo: finalName, url: rel });
    } catch (e) {
      if (destPath) {
        try {
          await fs.remove(destPath);
        } catch {}
      }
      fallidos.push({
        nombre: f?.name || "archivo",
        error: e?.message || "Error subiendo archivo",
      });
    }
  }

  return res.json({
    message: fallidos.length
      ? `Subidos ${subidos.length}. Fallaron ${fallidos.length}.`
      : `Subidos ${subidos.length} archivo(s).`,
    ok: subidos.length,
    fail: fallidos.length,
    subidos,
    fallidos,
  });
};

exports.subirCI = async (req, res) => {
  const frente = req.files?.ci_frente ? normalizeUploadedFiles(req.files.ci_frente)[0] : null;
  const dorso = req.files?.ci_dorso ? normalizeUploadedFiles(req.files.ci_dorso)[0] : null;

  if (!frente && !dorso) {
    return res.status(400).json({ message: "Faltan archivos ci_frente y/o ci_dorso" });
  }

  const allowed = new Set(["ci", "ci_adicional"]);
  const querySubcarpeta = String(req.query?.subcarpeta ?? "").trim();
  const bodySubcarpeta = String(req.body?.subcarpeta ?? "").trim();

  const subcarpeta =
    (allowed.has(querySubcarpeta) && querySubcarpeta) ||
    (allowed.has(bodySubcarpeta) && bodySubcarpeta) ||
    "ci";

  console.log(
    `[EXP CI UPLOAD] query=${querySubcarpeta || "-"} body=${bodySubcarpeta || "-"} final=${subcarpeta}`
  );

  req.body = { ...(req.body || {}), subcarpeta };

  const pack = [];
  if (frente) pack.push(frente);
  if (dorso) pack.push(dorso);
  req.files = { ...req.files, archivo: pack };

  return exports.subirDocs(req, res);
};

exports.verDocInline = async (req, res) => {
  const idArchivo = Number(req.params.idArchivo);
  const { rows } = await pool.query(
    `SELECT url, nombre_archivo
       FROM ema.tumba
      WHERE id_archivo = $1`,
    [idArchivo]
  );

  if (!rows.length) return res.status(404).json({ message: "No encontrado" });

  const rec = rows[0];
  const abs = resolveAbsolutePath(rec.url) || resolveRecoveredRemotePath(rec.url);
  if (!abs || !(await fs.pathExists(abs))) {
    return res.status(404).json({ message: "Archivo no existe en disco" });
  }

  return sendInline(res, abs, rec.nombre_archivo || path.basename(abs));
};

exports.descargarDoc = async (req, res) => {
  const idArchivo = Number(req.params.idArchivo);
  const { rows } = await pool.query(
    `SELECT url, nombre_archivo
       FROM ema.tumba
      WHERE id_archivo = $1`,
    [idArchivo]
  );

  if (!rows.length) return res.status(404).json({ message: "No encontrado" });

  const rec = rows[0];
  const abs = resolveAbsolutePath(rec.url) || resolveRecoveredRemotePath(rec.url);
  if (!abs || !(await fs.pathExists(abs))) {
    return res.status(404).json({ message: "Archivo no existe en disco" });
  }

  return sendDownload(res, abs, rec.nombre_archivo || path.basename(abs));
};

exports.eliminarDoc = async (req, res) => {
  const idArchivo = Number(req.params.idArchivo);
  const { rows } = await pool.query(`SELECT url FROM ema.tumba WHERE id_archivo = $1`, [idArchivo]);

  if (!rows.length) return res.status(404).json({ message: "Documento no encontrado." });

  const abs = resolveAbsolutePath(rows[0].url) || resolveRecoveredRemotePath(rows[0].url);
  if (abs && (await fs.pathExists(abs))) {
    try {
      await fs.remove(abs);
    } catch {}
  }

  await pool.query(`DELETE FROM ema.tumba WHERE id_archivo = $1`, [idArchivo]);
  res.json({ message: "Documento eliminado." });
};

// =====================
// ✅ Polígonos + auto-check
// =====================
const DB_SRID = 32721;
const IN_SRID = 4326;
const OUT_SRID = 4326;

async function markPlanoGeorefOK(idExpediente, tipo) {
  return markPlanoGeoref(idExpediente, tipo, true);
}

async function markPlanoGeoref(idExpediente, tipo, ok) {
  const rec = await ensureEtapas(idExpediente);
  if (!rec) return;

  const col = tipo === "mejora" ? "carpeta_mejora" : "carpeta_terreno";
  const keys = tipo === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;
  const current = normalizeStageFolder(keys, tipo === "mejora" ? rec.carpeta_mejora : rec.carpeta_terreno);
  const previous = normalizeStageEntry(current?.plano_georef);

  const updated = {
    ...current,
    plano_georef: {
      ...previous,
      ok: Boolean(ok),
      date: !previous.ok && Boolean(ok) ? previous.date || nowIso() : previous.date || null,
    },
  };

  await pool.query(
    `UPDATE ema.expedientes
        SET ${col} = $1,
            updated_at = now()
      WHERE id_expediente = $2`,
    [updated, Number(idExpediente)]
  );
}

exports.subirPoligonoMejoras = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const body = req.body || {};
  const geo = body.geojson;
  const tipoPoligono = normalizeTipoPoligono(body?.tipo_poligono || req.query?.tipo_poligono);

  if (!geo) return res.status(400).json({ message: "Falta geojson" });

  const name = body.name || "Mejora";
  const descripcion = body.descripcion || null;

  await pool.query(
    `INSERT INTO ema.bloque_mejoras (id_expediente, name, descripcion, tipo_poligono, geom)
     VALUES (
       $1,$2,$3,$4,
       ST_Transform(
         ST_SetSRID(
           ST_MakeValid(ST_GeomFromGeoJSON($4)),
           $5
         ),
         $6
       )
     )`,
    [idExp, name, descripcion, tipoPoligono, JSON.stringify(geo), IN_SRID, DB_SRID]
  );

  await markPlanoGeorefOK(idExp, "mejora");
  res.json({ ok: true });
};

exports.subirPoligonoTerreno = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const body = req.body || {};
  const geo = body.geojson;
  const tipoPoligono = normalizeTipoPoligono(body?.tipo_poligono || req.query?.tipo_poligono);

  if (!geo) return res.status(400).json({ message: "Falta geojson" });

  const name = body.name || "Terreno";
  const descripcion = body.descripcion || null;

  await pool.query(
    `INSERT INTO ema.bloque_terreno (id_expediente, name, descripcion, tipo_poligono, geom)
     VALUES (
       $1,$2,$3,$4,
       ST_Transform(
         ST_SetSRID(
           ST_MakeValid(ST_GeomFromGeoJSON($4)),
           $5
         ),
         $6
       )
     )`,
    [idExp, name, descripcion, tipoPoligono, JSON.stringify(geo), IN_SRID, DB_SRID]
  );

  await markPlanoGeorefOK(idExp, "terreno");
  res.json({ ok: true });
};

exports.eliminarPoligonoExpediente = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipo = normalizeTipo(req.params.tipo);
  const tipoPoligono = normalizeTipoPoligono(req.query?.tipo_poligono || req.body?.tipo_poligono);

  if (!idExp) return res.status(400).json({ message: "idExpediente inválido" });
  if (tipo !== "mejora" && tipo !== "terreno") {
    return res.status(400).json({ message: "tipo inválido" });
  }

  const tabla = tipo === "mejora" ? "ema.bloque_mejoras" : "ema.bloque_terreno";
  const result = await pool.query(
    `DELETE FROM ${tabla} WHERE id_expediente = $1 AND COALESCE(tipo_poligono,'proyecto') = $2`,
    [idExp, tipoPoligono]
  );

  await markPlanoGeoref(idExp, tipo, false);

  res.json({ ok: true, deleted: result.rowCount });
};

exports.subirDBI = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const exp = await getProyectoByExpediente(idExp);

  if (!exp?.id_proyecto) {
    return res.status(404).json({ message: "Expediente/proyecto no encontrado" });
  }

  const idProyecto = exp.id_proyecto;
  const codigo = String(req.body?.codigo || "").trim();
  if (!codigo) return res.status(400).json({ message: "Falta codigo" });

  const file = pickFilesFromReq(req)[0];
  if (!file) return res.status(400).json({ message: "Falta archivo" });
  if (!isExpressFileUploadFile(file)) {
    return res.status(400).json({ message: "Archivo inválido" });
  }

  const subcarpeta = "dbi";
  const baseDir = path.join(
    BASE_UPLOAD_DIR,
    `proyecto_${idProyecto}`,
    "expedientes",
    String(idExp),
    subcarpeta
  );

  await fs.ensureDir(baseDir);

  const originalName = sanitizeFilename(file.name);
  const finalName = await uniqueFilename(baseDir, originalName);
  const destPath = path.join(baseDir, finalName);

  await file.mv(destPath);

  const rel = path.posix.join(
    "/uploads/documentosproyecto",
    `proyecto_${idProyecto}`,
    "expedientes",
    String(idExp),
    subcarpeta,
    finalName
  );

  await pool.query(
    `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, subcarpeta, url, nombre_archivo)
     VALUES ($1,'expedientes',5,$2,$3,$4)`,
    [idExp, subcarpeta, rel, finalName]
  );

  const rec = await ensureEtapas(idExp);
  const curr = normalizeDbiState(rec?.carpeta_dbi);
  const fechaIngreso = curr.fecha_ingreso || nowIso();

  let out = {
    ...curr,
    codigo,
    ok: true,
    fecha_ingreso: fechaIngreso,
    estado: curr.estado || "ingresado",
  };

  if (!curr.fecha_ingreso) {
    out = appendDbiEventIfNeeded(out, {
      estado: out.estado || "ingresado",
      fecha: fechaIngreso,
      obs: out.obs || "",
    });
  }

  await pool.query(
    `UPDATE ema.expedientes SET carpeta_dbi=$1, updated_at=now() WHERE id_expediente=$2`,
    [out, idExp]
  );

  res.json({ ok: true, codigo, url: rel, nombre_archivo: finalName });
};

exports.agregarDbiEvento = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  if (!Number.isFinite(idExp) || idExp <= 0) {
    return res.status(400).json({ message: "idExpediente inválido" });
  }

  const estadoRaw = String(req.body?.estado || "").trim();
  if (!estadoRaw) {
    return res.status(400).json({ message: "estado es requerido" });
  }

  const fechaRaw = req.body?.fecha ? String(req.body.fecha).trim() : "";
  const obsRaw = req.body?.obs ? String(req.body.obs) : "";

  const rec = await ensureEtapas(idExp);
  if (!rec) return res.status(404).json({ message: "Expediente no encontrado" });

  let fechaIso = null;
  if (fechaRaw) {
    fechaIso = parseToIsoOrNull(fechaRaw);
    if (!fechaIso) {
      return res.status(400).json({ message: "fecha invalida (debe ser ISO o Date parseable)" });
    }
  }

  let dbi = normalizeDbiState(rec.carpeta_dbi);

  const event = {
    estado: estadoRaw,
    fecha: fechaIso || nowIso(),
    obs: obsRaw,
  };

  dbi = appendDbiEventIfNeeded(dbi, event);
  dbi.estado = estadoRaw;

  await pool.query(`UPDATE ema.expedientes SET carpeta_dbi=$1, updated_at=now() WHERE id_expediente=$2`, [
    dbi,
    idExp,
  ]);

  return res.json(dbi);
};

exports.iniciarDbi = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  if (!Number.isFinite(idExp) || idExp <= 0) {
    return res.status(400).json({ message: "idExpediente inválido" });
  }

  const codigo = String(req.body?.codigo || "").trim();
  if (!codigo) {
    return res.status(400).json({ message: "codigo es requerido" });
  }

  const fechaIngresoRaw = String(req.body?.fecha_ingreso || "").trim();
  if (!fechaIngresoRaw) {
    return res.status(400).json({ message: "fecha_ingreso es requerido" });
  }

  const fechaIngresoDate = new Date(fechaIngresoRaw);
  if (Number.isNaN(fechaIngresoDate.getTime())) {
    return res.status(400).json({ message: "fecha_ingreso inválido" });
  }

  const obs = req.body?.obs ? String(req.body.obs) : "";

  const rec = await ensureEtapas(idExp);
  if (!rec) return res.status(404).json({ message: "Expediente no encontrado" });

  let dbi = normalizeDbiState(rec.carpeta_dbi);
  if (dbi.fecha_ingreso || dbi.codigo) {
    return res.status(400).json({ message: "DBI ya fue iniciado para este expediente." });
  }

  const fechaIngreso = fechaIngresoDate.toISOString();
  dbi = {
    ...dbi,
    codigo,
    fecha_ingreso: fechaIngreso,
    estado: "mesa de entrada",
    obs,
    ok: true,
  };

  dbi = appendDbiEventIfNeeded(dbi, {
    estado: "mesa de entrada",
    fecha: fechaIngreso,
    obs,
  });

  await pool.query(`UPDATE ema.expedientes SET carpeta_dbi=$1, updated_at=now() WHERE id_expediente=$2`, [
    dbi,
    idExp,
  ]);

  return res.json(dbi);
};

// =====================
// GeoJSON (visor)
// =====================
exports.geojsonTerreno = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipoPoligono = normalizeTipoPoligono(req.query?.tipo_poligono);
  const { rows } = await pool.query(
    `SELECT id,
            name,
            descripcion,
            ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_terreno
      WHERE id_expediente = $1
        AND COALESCE(tipo_poligono,'proyecto') = $2
      ORDER BY id DESC`,
    [idExp, tipoPoligono]
  );

  res.json({
    type: "FeatureCollection",
    features: rows
      .filter((r) => r.geometry)
      .map((r) => ({
        type: "Feature",
        geometry: JSON.parse(r.geometry),
        properties: { id: r.id, name: r.name, descripcion: r.descripcion },
      })),
  });
};

exports.geojsonMejoras = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipoPoligono = normalizeTipoPoligono(req.query?.tipo_poligono);
  const { rows } = await pool.query(
    `SELECT id,
            name,
            descripcion,
            ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_mejoras
      WHERE id_expediente = $1
        AND COALESCE(tipo_poligono,'proyecto') = $2
      ORDER BY id DESC`,
    [idExp, tipoPoligono]
  );

  res.json({
    type: "FeatureCollection",
    features: rows
      .filter((r) => r.geometry)
      .map((r) => ({
        type: "Feature",
        geometry: JSON.parse(r.geometry),
        properties: { id: r.id, name: r.name, descripcion: r.descripcion },
      })),
  });
};

// =====================
// ✅ IMPORT EXCEL
// =====================
exports.importExcel = async (req, res) => {
  const idProyecto = Number(req.params.idProyecto);
  const { rows } = req.body || {};

  if (!idProyecto) {
    return res.status(400).json({ message: "idProyecto inválido" });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "Body inválido: rows vacío" });
  }

  function isNonSignificant(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    const s = String(v).trim();
    if (!s) return true;
    return /^0+$/.test(s);
  }

  function normalizeSignificant(v) {
    if (Array.isArray(v)) {
      return v
        .map((x) => String(x ?? "").trim())
        .filter(Boolean);
    }
    return isNonSignificant(v) ? null : String(v).trim();
  }

  function normalizeImportDateDefensive(raw) {
    if (raw === null || raw === undefined || raw === "") return null;

    const str = String(raw).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    const num = Number(raw);
    if (Number.isFinite(num) && num > 30000 && num < 80000) {
      const ms = Math.round((Math.floor(num) - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString().split("T")[0];
      }
    }

    const dStr = new Date(str);
    if (!Number.isNaN(dStr.getTime())) {
      const y = dStr.getUTCFullYear();
      if (y > 1900 && y < 2100) {
        return dStr.toISOString().split("T")[0];
      }
    }

    const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const y = parseInt(m[3], 10);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y > 1900 && y < 2100) {
        return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }

    return null;
  }

  function normalizeUrlsField(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map((x) => String(x ?? "").trim())
        .filter(Boolean);
    }

    const s = String(raw ?? "").trim();
    if (!s) return [];

    return s
      .split(/\r?\n|;|,|\|/g)
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }

  const normalized = rows.map((r, idx) => ({
    _rowIndex: idx + 1,
    id_proyecto: idProyecto,
    fecha_relevamiento: normalizeImportDateDefensive(r.fecha_relevamiento),
    gps: cleanStr(r.gps),
    tecnico: cleanStr(r.tecnico),
    codigo_exp: normalizeSignificant(r.codigo_exp),
    codigo_censo: normalizeSignificant(r.codigo_censo),
    propietario_nombre: cleanStr(r.propietario_nombre),
    propietario_ci: normalizeSignificant(r.propietario_ci),
    pareja_nombre: cleanStr(r.pareja_nombre),
    pareja_ci: normalizeSignificant(r.pareja_ci),
    id_import: normalizeSignificant(r.id_import ?? r.id_informe),
    tramo: cleanStr(r.tramo),
    subtramo: cleanStr(r.subtramo),

    ci_propietario_frente_url: normalizeSignificant(r.ci_propietario_frente_url),
    ci_propietario_dorso_url: normalizeSignificant(r.ci_propietario_dorso_url),
    ci_adicional_frente_url: normalizeSignificant(r.ci_adicional_frente_url),
    ci_adicional_dorso_url: normalizeSignificant(r.ci_adicional_dorso_url),

    // ✅ NUEVO: documentos desde Excel
    documentos_urls: normalizeUrlsField(r.documentos_urls),
    documentos_subcarpeta: cleanStr(r.documentos_subcarpeta) || "documentacion",
  }));

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertSql = `
      INSERT INTO ema.expedientes
      (
        id_proyecto,
        id_import,
        fecha_relevamiento,
        gps,
        tecnico,
        codigo_exp,
        codigo_censo,
        propietario_nombre,
        propietario_ci,
        pareja_nombre,
        pareja_ci,
        id_tramo,
        id_sub_tramo,
        tramo,
        subtramo
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      RETURNING id_expediente
    `;

    let inserted = 0;
    let updated_by_id_import = 0;
    let updated_by_codigo_exp = 0;
    let updated_by_codigo_censo = 0;
    let rejected = 0;
    const errors = [];
    const warnings = [];
    const postCommitWarnings = [];
    let documentsInserted = 0;
    let documentsSkippedExisting = 0;
    let documentsRecovered = 0;
    const affectedExpedientes = new Set();
    const attemptedRemoteRecoveries = new Set();

    function normalizeCatalogText(v) {
      if (!v) return "";
      return v
        .toString()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    const tramosByName = new Map();
    const subtramosByName = new Map();

    const { rows: tramos } = await client.query(
      `SELECT id_proyecto_tramo, descripcion
         FROM ema.proyecto_tramos
        WHERE id_proyecto = $1`,
      [idProyecto]
    );

    const { rows: subtramos } = await client.query(
      `SELECT st.id_proyecto_subtramo, st.id_proyecto_tramo, st.descripcion
         FROM ema.proyecto_subtramos st
         JOIN ema.proyecto_tramos t ON t.id_proyecto_tramo = st.id_proyecto_tramo
        WHERE t.id_proyecto = $1`,
      [idProyecto]
    );

    const pushToMap = (map, key, value) => {
      if (!key) return;
      const list = map.get(key) || [];
      list.push(value);
      map.set(key, list);
    };

    tramos.forEach((t) =>
      pushToMap(tramosByName, normalizeCatalogText(t.descripcion), {
        id: t.id_proyecto_tramo,
        descripcion: t.descripcion,
      })
    );

    subtramos.forEach((st) =>
      pushToMap(subtramosByName, normalizeCatalogText(st.descripcion), {
        id: st.id_proyecto_subtramo,
        id_tramo: st.id_proyecto_tramo,
        descripcion: st.descripcion,
      })
    );

    const resolveTramoSubtramo = (rawTramo, rawSubtramo, rowIndex) => {
      const tramoKey = normalizeCatalogText(rawTramo);
      const subKey = normalizeCatalogText(rawSubtramo);
      const tramoMatches = tramoKey ? tramosByName.get(tramoKey) || [] : [];
      const subMatches = subKey ? subtramosByName.get(subKey) || [] : [];
      const hasExplicitTramo = Boolean(tramoKey);

      let tramoResolved = null;
      let subResolved = null;
      let shouldClearSubtramo = false;

      if (tramoMatches.length > 1) {
        warnings.push({
          row: rowIndex,
          type: "ambiguous_tramo",
          message: "Tramo ambiguo (más de una coincidencia)",
          value: rawTramo,
        });
      } else if (tramoMatches.length === 1) {
        tramoResolved = tramoMatches[0];
      } else if (rawTramo) {
        warnings.push({
          row: rowIndex,
          type: "unresolved_tramo",
          message: "Tramo no resuelto en catálogo",
          value: rawTramo,
        });
      }

      if (subMatches.length > 1) {
        warnings.push({
          row: rowIndex,
          type: "ambiguous_subtramo",
          message: "Subtramo ambiguo (más de una coincidencia)",
          value: rawSubtramo,
        });
      } else if (subMatches.length === 1) {
        subResolved = subMatches[0];
      } else if (rawSubtramo) {
        warnings.push({
          row: rowIndex,
          type: "unresolved_subtramo",
          message: "Subtramo no resuelto en catálogo",
          value: rawSubtramo,
        });
      }

      if (subResolved && tramoResolved) {
        if (subResolved.id_tramo !== tramoResolved.id) {
          shouldClearSubtramo = true;
          warnings.push({
            row: rowIndex,
            type: "corrected_hierarchy",
            message: "Subtramo descartado por inconsistencia jerárquica. Se conserva solo el tramo.",
            value: { tramo: rawTramo, subtramo: rawSubtramo },
          });
          subResolved = null;
        }
      } else if (subResolved && !tramoResolved && !hasExplicitTramo) {
        tramoResolved = tramos.find((t) => t.id_proyecto_tramo === subResolved.id_tramo) || null;
        if (tramoResolved) {
          warnings.push({
            row: rowIndex,
            type: "inferred_tramo",
            message: "Tramo inferido desde subtramo",
            value: rawSubtramo,
          });
        }
      } else if (subResolved && !tramoResolved && hasExplicitTramo) {
        shouldClearSubtramo = true;
        warnings.push({
          row: rowIndex,
          type: "corrected_hierarchy",
          message: "Subtramo descartado por inconsistencia jerárquica. Se conserva el tramo textual sin ID de subtramo.",
          value: { tramo: rawTramo, subtramo: rawSubtramo },
        });
        subResolved = null;
      }

      if (!subResolved && rawSubtramo) {
        shouldClearSubtramo = true;
      }

      if (!tramoResolved && !subResolved && (rawTramo || rawSubtramo)) {
        warnings.push({
          row: rowIndex,
          type: "unresolved_tramo_subtramo",
          message: "No se resolvió tramo/subtramo en catálogo",
          value: { tramo: rawTramo, subtramo: rawSubtramo },
        });
      }

      return {
        id_tramo: tramoResolved ? tramoResolved.id : null,
        id_sub_tramo: subResolved ? subResolved.id : null,
        resolvedTramo: Boolean(tramoResolved),
        resolvedSubtramo: Boolean(subResolved),
        shouldClearSubtramo,
      };
    };

    const buildDocNameFromUrl = (url, fallbackLabel) => {
      const raw = String(url || "").trim();
      if (!raw) return sanitizeFilename(fallbackLabel);
      const noQuery = raw.split("?")[0];
      const base = path.basename(noQuery);
      if (base && base !== "." && base !== "..") return sanitizeFilename(base);
      return sanitizeFilename(fallbackLabel);
    };

    const downloadRemoteDocument = async (url, absolutePath) => {
      if (!absolutePath) {
        return { ok: false, reason: "Ruta local de recuperacion no disponible" };
      }
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return { ok: false, reason: `Descarga remota fallida (${response.status})` };
        }

        const arrayBuffer = await response.arrayBuffer();
        await fs.ensureDir(path.dirname(absolutePath));
        await fs.writeFile(absolutePath, Buffer.from(arrayBuffer));
        documentsRecovered += 1;
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) };
      }
    };

    const upsertImportDoc = async (idExpediente, subcarpeta, url, fallbackLabel) => {
      if (!url) return;

      const { rows: existingDocs } = await client.query(
        `SELECT id_archivo
           FROM ema.tumba
          WHERE tipo_documento = 'expedientes'
            AND id_documento = $1
            AND COALESCE(subcarpeta,'') = COALESCE($2,'')
            AND url = $3
          LIMIT 1`,
        [idExpediente, subcarpeta || null, url]
      );

      if (existingDocs.length) {
        const abs = resolveAbsolutePath(url);
        const recoveredAbs = resolveRecoveredRemotePath(url);
        const existsOnDisk =
          (abs ? await fs.pathExists(abs) : false) ||
          (recoveredAbs ? await fs.pathExists(recoveredAbs) : false);

        if (existsOnDisk) {
          documentsSkippedExisting += 1;
          return;
        }

        if (isRemoteUrl(url)) {
          if (!attemptedRemoteRecoveries.has(url)) {
            attemptedRemoteRecoveries.add(url);
            const recovered = await downloadRemoteDocument(url, recoveredAbs);
            if (recovered.ok) {
              documentsSkippedExisting += 1;
              return;
            }
            warnings.push({
              row: fallbackLabel,
              type: "missing_existing_document",
              message: "Documento existente en BD sin archivo local; no se pudo recrear desde URL remota",
              value: { url, detail: recovered.reason || null },
            });
            return;
          }

          if (recoveredAbs && (await fs.pathExists(recoveredAbs))) {
            documentsSkippedExisting += 1;
            return;
          }

          warnings.push({
            row: fallbackLabel,
            type: "missing_existing_document",
            message: "Documento existente en BD sin archivo local; la descarga remota no dejó archivo recuperado",
            value: { url },
          });
          return;
        }

        warnings.push({
          row: fallbackLabel,
          type: "missing_existing_document",
          message: "Documento registrado en BD pero archivo no encontrado",
          value: { url },
        });
        return;
      }

      const nombre = buildDocNameFromUrl(url, fallbackLabel);
      await client.query(
        `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, subcarpeta, url, nombre_archivo)
         VALUES ($1, 'expedientes', 5, $2, $3, $4)`,
        [idExpediente, subcarpeta || null, url, nombre]
      );
      documentsInserted += 1;
    };

    for (const r of normalized) {
      if (!r.fecha_relevamiento) {
        rejected += 1;
        errors.push({
          row: r._rowIndex,
          reason: "fecha_relevamiento es obligatoria y debe tener formato YYYY-MM-DD",
          identity: {
            id_import: r.id_import,
            codigo_exp: r.codigo_exp,
            codigo_censo: r.codigo_censo,
          },
        });
        continue;
      }

      const hasIdentity = Boolean(r.id_import || r.codigo_exp || r.codigo_censo);
      if (!hasIdentity) {
        rejected += 1;
        errors.push({
          row: r._rowIndex,
          reason: "Sin identidad suficiente (id_import/codigo_exp/codigo_censo)",
          identity: {
            id_import: r.id_import,
            codigo_exp: r.codigo_exp,
            codigo_censo: r.codigo_censo,
          },
        });
        continue;
      }

      const tramoResolution = resolveTramoSubtramo(r.tramo, r.subtramo, r._rowIndex);

      let matchType = null;
      let existing = null;

      if (r.id_import) {
        const { rows: found } = await client.query(
          `SELECT id_expediente, id_import, codigo_exp, codigo_censo
             FROM ema.expedientes
            WHERE id_proyecto = $1 AND id_import = $2`,
          [r.id_proyecto, r.id_import]
        );
        if (found.length > 1) {
          rejected += 1;
          errors.push({
            row: r._rowIndex,
            reason: "id_import ambiguo (más de un expediente)",
            identity: { id_import: r.id_import },
          });
          continue;
        }
        if (found.length === 1) {
          matchType = "id_import";
          existing = found[0];
        }
      }

      if (!existing && r.codigo_exp) {
        const { rows: found } = await client.query(
          `SELECT id_expediente, id_import, codigo_exp, codigo_censo
             FROM ema.expedientes
            WHERE id_proyecto = $1 AND codigo_exp = $2`,
          [r.id_proyecto, r.codigo_exp]
        );
        if (found.length > 0) {
          matchType = "codigo_exp";
          existing = found[0];
        }
      }

      if (!existing && r.codigo_censo) {
        const { rows: found } = await client.query(
          `SELECT id_expediente, id_import, codigo_exp, codigo_censo
             FROM ema.expedientes
            WHERE id_proyecto = $1 AND codigo_censo = $2`,
          [r.id_proyecto, r.codigo_censo]
        );
        if (found.length > 1) {
          rejected += 1;
          errors.push({
            row: r._rowIndex,
            reason: "codigo_censo ambiguo (más de un expediente)",
            identity: { codigo_censo: r.codigo_censo },
          });
          continue;
        }
        if (found.length === 1) {
          matchType = "codigo_censo";
          existing = found[0];
        }
      }

      if (!existing) {
        const q = await client.query(insertSql, [
          r.id_proyecto,
          r.id_import,
          r.fecha_relevamiento,
          r.gps,
          r.tecnico,
          r.codigo_exp,
          r.codigo_censo,
          r.propietario_nombre,
          r.propietario_ci,
          r.pareja_nombre,
          r.pareja_ci,
          tramoResolution.id_tramo,
          tramoResolution.id_sub_tramo,
          r.tramo,
          r.subtramo,
        ]);

        if (q.rowCount > 0) {
          inserted += 1;
          const idExpediente = q.rows[0]?.id_expediente;

          if (idExpediente) {
            affectedExpedientes.add(Number(idExpediente));

            await upsertImportDoc(
              idExpediente,
              "ci",
              r.ci_propietario_frente_url,
              `ci_titular_frente_${r._rowIndex}`
            );
            await upsertImportDoc(
              idExpediente,
              "ci",
              r.ci_propietario_dorso_url,
              `ci_titular_dorso_${r._rowIndex}`
            );
            await upsertImportDoc(
              idExpediente,
              "ci_adicional",
              r.ci_adicional_frente_url,
              `ci_cotitular_frente_${r._rowIndex}`
            );
            await upsertImportDoc(
              idExpediente,
              "ci_adicional",
              r.ci_adicional_dorso_url,
              `ci_cotitular_dorso_${r._rowIndex}`
            );

            // ✅ NUEVO: documentos generales desde Excel
            if (Array.isArray(r.documentos_urls) && r.documentos_urls.length > 0) {
              for (const docUrl of r.documentos_urls) {
                await upsertImportDoc(
                  idExpediente,
                  r.documentos_subcarpeta || "documentacion",
                  docUrl,
                  `documento_${r._rowIndex}`
                );
              }
            }
          }
        }
        continue;
      }

      if (r.id_import && existing.id_import && String(existing.id_import) !== String(r.id_import)) {
        rejected += 1;
        errors.push({
          row: r._rowIndex,
          reason: "Conflicto de identidad: id_import distinto en expediente existente",
          identity: {
            id_import: r.id_import,
            existing_id_import: existing.id_import,
          },
        });
        continue;
      }

      const sets = ["fecha_relevamiento=$1", "updated_at=now()"];
      const params = [r.fecha_relevamiento];
      let idx = 2;

      if (r.gps) {
        sets.push(`gps=$${idx}`);
        params.push(r.gps);
        idx += 1;
      }
      if (r.tecnico) {
        sets.push(`tecnico=$${idx}`);
        params.push(r.tecnico);
        idx += 1;
      }
      if (r.propietario_nombre) {
        sets.push(`propietario_nombre=$${idx}`);
        params.push(r.propietario_nombre);
        idx += 1;
      }
      if (r.propietario_ci) {
        sets.push(`propietario_ci=$${idx}`);
        params.push(r.propietario_ci);
        idx += 1;
      }
      if (r.pareja_nombre) {
        sets.push(`pareja_nombre=$${idx}`);
        params.push(r.pareja_nombre);
        idx += 1;
      }
      if (r.pareja_ci) {
        sets.push(`pareja_ci=$${idx}`);
        params.push(r.pareja_ci);
        idx += 1;
      }
      if (r.codigo_exp) {
        sets.push(`codigo_exp=$${idx}`);
        params.push(r.codigo_exp);
        idx += 1;
      }
      if (r.codigo_censo) {
        sets.push(`codigo_censo=$${idx}`);
        params.push(r.codigo_censo);
        idx += 1;
      }

      if (tramoResolution.id_tramo) {
        sets.push(`id_tramo=$${idx}`);
        params.push(tramoResolution.id_tramo);
        idx += 1;

        if (r.tramo) {
          sets.push(`tramo=$${idx}`);
          params.push(r.tramo);
          idx += 1;
        }
      }

      if (tramoResolution.id_sub_tramo) {
        sets.push(`id_sub_tramo=$${idx}`);
        params.push(tramoResolution.id_sub_tramo);
        idx += 1;

        if (r.subtramo) {
          sets.push(`subtramo=$${idx}`);
          params.push(r.subtramo);
          idx += 1;
        }
      } else if (tramoResolution.shouldClearSubtramo) {
        sets.push(`id_sub_tramo=$${idx}`);
        params.push(null);
        idx += 1;

        sets.push(`subtramo=$${idx}`);
        params.push(null);
        idx += 1;
      }

      if (r.id_import && isNonSignificant(existing.id_import)) {
        sets.push(`id_import=$${idx}`);
        params.push(r.id_import);
        idx += 1;
      }

      const q = await client.query(
        `UPDATE ema.expedientes
            SET ${sets.join(", ")}
          WHERE id_expediente=$${idx}
          RETURNING id_expediente`,
        [...params, existing.id_expediente]
      );

      if (q.rowCount > 0) {
        const idExpediente = q.rows[0]?.id_expediente;

        if (idExpediente) {
          affectedExpedientes.add(Number(idExpediente));

          await upsertImportDoc(
            idExpediente,
            "ci",
            r.ci_propietario_frente_url,
            `ci_titular_frente_${r._rowIndex}`
          );
          await upsertImportDoc(
            idExpediente,
            "ci",
            r.ci_propietario_dorso_url,
            `ci_titular_dorso_${r._rowIndex}`
          );
          await upsertImportDoc(
            idExpediente,
            "ci_adicional",
            r.ci_adicional_frente_url,
            `ci_cotitular_frente_${r._rowIndex}`
          );
          await upsertImportDoc(
            idExpediente,
            "ci_adicional",
            r.ci_adicional_dorso_url,
            `ci_cotitular_dorso_${r._rowIndex}`
          );

          // ✅ NUEVO: documentos generales desde Excel
          if (Array.isArray(r.documentos_urls) && r.documentos_urls.length > 0) {
            for (const docUrl of r.documentos_urls) {
              await upsertImportDoc(
                idExpediente,
                r.documentos_subcarpeta || "documentacion",
                docUrl,
                `documento_${r._rowIndex}`
              );
            }
          }
        }

        if (matchType === "id_import") updated_by_id_import += 1;
        if (matchType === "codigo_exp") updated_by_codigo_exp += 1;
        if (matchType === "codigo_censo") updated_by_codigo_censo += 1;
      }
    }

    await client.query("COMMIT");

    for (const idExpediente of affectedExpedientes) {
      try {
        await ensureEtapas(idExpediente);
      } catch (e) {
        const message = `ensureEtapas falló para expediente ${idExpediente}`;
        console.warn(`[EXP IMPORT] ${message}: ${String(e?.message || e)}`);
        postCommitWarnings.push({
          type: "ensure_etapas_failed",
          id_expediente: idExpediente,
          message,
          detail: String(e?.message || e),
        });
      }
    }

    return res.json({
      ok: true,
      id_proyecto: idProyecto,
      recibidos: rows.length,
      validos: normalized.length - rejected,
      inserted,
      updated_by_id_import,
      updated_by_codigo_exp,
      updated_by_codigo_censo,
      rejected,
      errors,
      warnings,
      postCommitWarnings,
      documentsInserted,
      documentsSkippedExisting,
      documentsRecovered,
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({
      message: "Error importando",
      detail: String(e?.message || e),
    });
  } finally {
    client.release();
  }
};

exports.importExcelLegacy = async (req, res) => {
  const idProyecto = Number(req.params.idProyecto);
  const { rows } = req.body || {};

  if (!idProyecto) {
    return res.status(400).json({ message: "idProyecto inválido" });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: "Body inválido: rows vacío" });
  }

  const normalized = rows
    .map((r) => ({
      id_proyecto: idProyecto,
      fecha_relevamiento: cleanDateYMD(r.fecha_relevamiento),
      gps: cleanStr(r.gps),
      tecnico: cleanStr(r.tecnico),
      codigo_exp: cleanStr(r.codigo_exp),
      propietario_nombre: cleanStr(r.propietario_nombre),
      propietario_ci: cleanStr(r.propietario_ci),
      tramo: cleanStr(r.tramo),
      subtramo: cleanStr(r.subtramo),
      codigo_censo: cleanStr(r.codigo_censo),

      ci_propietario_frente_url: cleanStr(r.ci_propietario_frente_url),
      ci_propietario_dorso_url: cleanStr(r.ci_propietario_dorso_url),
      ci_adicional_frente_url: cleanStr(r.ci_adicional_frente_url),
      ci_adicional_dorso_url: cleanStr(r.ci_adicional_dorso_url),
    }))
    .filter((x) => x.codigo_exp || x.propietario_nombre);

  if (normalized.length === 0) {
    return res.status(400).json({ message: "No quedaron filas válidas para importar" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sql = `
      INSERT INTO ema.expedientes
      (
        id_proyecto,
        fecha_relevamiento,
        gps,
        tecnico,
        codigo_exp,
        propietario_nombre,
        propietario_ci,
        tramo,
        subtramo,
        codigo_censo,
        ci_propietario_frente_url,
        ci_propietario_dorso_url,
        ci_adicional_frente_url,
        ci_adicional_dorso_url
      )
      VALUES
      (
        $1,
        COALESCE($2::date, CURRENT_DATE),
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14
      )
      ON CONFLICT (id_proyecto, codigo_exp)
      DO UPDATE SET
        fecha_relevamiento = EXCLUDED.fecha_relevamiento,
        gps = EXCLUDED.gps,
        tecnico = EXCLUDED.tecnico,
        propietario_nombre = EXCLUDED.propietario_nombre,
        propietario_ci = EXCLUDED.propietario_ci,
        tramo = EXCLUDED.tramo,
        subtramo = EXCLUDED.subtramo,
        codigo_censo = EXCLUDED.codigo_censo,
        ci_propietario_frente_url = EXCLUDED.ci_propietario_frente_url,
        ci_propietario_dorso_url = EXCLUDED.ci_propietario_dorso_url,
        ci_adicional_frente_url = EXCLUDED.ci_adicional_frente_url,
        ci_adicional_dorso_url = EXCLUDED.ci_adicional_dorso_url,
        updated_at = now()
      RETURNING id_expediente
    `;

    let procesados = 0;

    for (const r of normalized) {
      const q = await client.query(sql, [
        r.id_proyecto,
        r.fecha_relevamiento,
        r.gps,
        r.tecnico,
        r.codigo_exp,
        r.propietario_nombre,
        r.propietario_ci,
        r.tramo,
        r.subtramo,
        r.codigo_censo,
        r.ci_propietario_frente_url,
        r.ci_propietario_dorso_url,
        r.ci_adicional_frente_url,
        r.ci_adicional_dorso_url,
      ]);

      if (q.rowCount > 0) {
        procesados += 1;
        const idExpediente = q.rows[0]?.id_expediente;
        if (idExpediente) {
          await ensureEtapas(idExpediente);
        }
      }
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id_proyecto: idProyecto,
      recibidos: rows.length,
      validos: normalized.length,
      procesados,
      omitidos: normalized.length - procesados,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({
      message: "Error importando",
      detail: String(e?.message || e),
    });
  } finally {
    client.release();
  }
};
