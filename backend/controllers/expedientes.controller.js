"use strict";

const path = require("path");
const fs = require("fs-extra");
const mime = require("mime-types");
const pool = require("../db");

// MISMA BASE que tu documentos.controller
const BASE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "documentosproyecto");

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

function resolveAbsolutePath(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;

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

  const params = [idProyecto];
  let idx = 2;
  let sql = `SELECT * FROM ema.expedientes WHERE id_proyecto = $1`;

  if (q) {
    params.push(`%${q}%`);
    sql +=
      ` AND (` +
      `propietario_nombre ILIKE $${idx} OR ` +
      `propietario_ci ILIKE $${idx} OR ` +
      `codigo_exp ILIKE $${idx} OR ` +
      `codigo_censo ILIKE $${idx} OR ` +
      `COALESCE(carpeta_dbi->>'codigo','') ILIKE $${idx}` +
      `)`;
    idx += 1;
  }

  if (Number.isFinite(tramoId) && tramoId > 0) {
    params.push(tramoId);
    sql += ` AND id_tramo = $${idx}`;
    idx += 1;
  }

  if (Number.isFinite(subtramoId) && subtramoId > 0) {
    params.push(subtramoId);
    sql += ` AND id_sub_tramo = $${idx}`;
    idx += 1;
  }

  sql += ` ORDER BY created_at DESC`;

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
         tramo,
         subtramo,
         id_tramo,
         id_sub_tramo,
         codigo_censo,
         parte_a,
         parte_b,
         premio_aplica
       )
       VALUES
       (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
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
        resTramo.tramo,
        resTramo.subtramo,
        resTramo.id_tramo,
        resTramo.id_sub_tramo,
        resTramo.codigo_censo,
        parteA.present ? parteA.value : null,
        parteB.present ? parteB.value : null,
        premioAplica.present ? premioAplica.value : false,
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

    const sets = [
      "fecha_relevamiento=$1",
      "gps=$2",
      "tecnico=$3",
      "codigo_exp=$4",
      "propietario_nombre=$5",
      "propietario_ci=$6",
      "tramo=$7",
      "subtramo=$8",
      "id_tramo=$9",
      "id_sub_tramo=$10",
      "codigo_censo=$11",
    ];

    const params = [
      fechaRelevamiento,
      b.gps || null,
      b.tecnico || null,
      b.codigo_exp || null,
      b.propietario_nombre || null,
      b.propietario_ci || null,
      resTramo.tramo,
      resTramo.subtramo,
      resTramo.id_tramo,
      resTramo.id_sub_tramo,
      resTramo.codigo_censo,
    ];

    // reset to 12 because we removed 4 columns
    let idx = 12;

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
  await pool.query(`DELETE FROM ema.expedientes WHERE id_expediente=$1`, [idExp]);
  res.json({ ok: true });
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
  const abs = resolveAbsolutePath(rec.url);
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
  const abs = resolveAbsolutePath(rec.url);
  if (!abs || !(await fs.pathExists(abs))) {
    return res.status(404).json({ message: "Archivo no existe en disco" });
  }

  return sendDownload(res, abs, rec.nombre_archivo || path.basename(abs));
};

exports.eliminarDoc = async (req, res) => {
  const idArchivo = Number(req.params.idArchivo);
  const { rows } = await pool.query(`SELECT url FROM ema.tumba WHERE id_archivo = $1`, [idArchivo]);

  if (!rows.length) return res.status(404).json({ message: "Documento no encontrado." });

  const abs = resolveAbsolutePath(rows[0].url);
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

  if (!geo) return res.status(400).json({ message: "Falta geojson" });

  const name = body.name || "Mejora";
  const descripcion = body.descripcion || null;

  await pool.query(
    `INSERT INTO ema.bloque_mejoras (id_expediente, name, descripcion, geom)
     VALUES (
       $1,$2,$3,
       ST_Transform(
         ST_SetSRID(
           ST_MakeValid(ST_GeomFromGeoJSON($4)),
           $5
         ),
         $6
       )
     )`,
    [idExp, name, descripcion, JSON.stringify(geo), IN_SRID, DB_SRID]
  );

  await markPlanoGeorefOK(idExp, "mejora");
  res.json({ ok: true });
};

exports.subirPoligonoTerreno = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const body = req.body || {};
  const geo = body.geojson;

  if (!geo) return res.status(400).json({ message: "Falta geojson" });

  const name = body.name || "Terreno";
  const descripcion = body.descripcion || null;

  await pool.query(
    `INSERT INTO ema.bloque_terreno (id_expediente, name, descripcion, geom)
     VALUES (
       $1,$2,$3,
       ST_Transform(
         ST_SetSRID(
           ST_MakeValid(ST_GeomFromGeoJSON($4)),
           $5
         ),
         $6
       )
     )`,
    [idExp, name, descripcion, JSON.stringify(geo), IN_SRID, DB_SRID]
  );

  await markPlanoGeorefOK(idExp, "terreno");
  res.json({ ok: true });
};

exports.eliminarPoligonoExpediente = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const tipo = normalizeTipo(req.params.tipo);

  if (!idExp) return res.status(400).json({ message: "idExpediente inválido" });
  if (tipo !== "mejora" && tipo !== "terreno") {
    return res.status(400).json({ message: "tipo inválido" });
  }

  const tabla = tipo === "mejora" ? "ema.bloque_mejoras" : "ema.bloque_terreno";
  const result = await pool.query(`DELETE FROM ${tabla} WHERE id_expediente = $1`, [idExp]);

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
  const { rows } = await pool.query(
    `SELECT id,
            name,
            descripcion,
            ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_terreno
      WHERE id_expediente = $1
      ORDER BY id DESC`,
    [idExp]
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
  const { rows } = await pool.query(
    `SELECT id,
            name,
            descripcion,
            ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_mejoras
      WHERE id_expediente = $1
      ORDER BY id DESC`,
    [idExp]
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
