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
  keys.forEach((k) => {
    obj[k] = { ok: false, obs: "" };
  });
  return obj;
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
    `SELECT id_proyecto, carpeta_mejora, carpeta_terreno, carpeta_dbi
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

  const needMejora = ETAPAS_MEJORA.some((k) => !cm?.[k] || typeof cm[k]?.ok !== "boolean");
  const needTerreno = ETAPAS_TERRENO.some((k) => !ct?.[k] || typeof ct[k]?.ok !== "boolean");

  let newCm = cm;
  let newCt = ct;

  if (needMejora) newCm = { ...emptyState(ETAPAS_MEJORA), ...cm };
  if (needTerreno) newCt = { ...emptyState(ETAPAS_TERRENO), ...ct };

  if (needMejora || needTerreno) {
    await pool.query(
      `UPDATE ema.expedientes
          SET carpeta_mejora = $1,
              carpeta_terreno = $2,
              updated_at = now()
        WHERE id_expediente = $3`,
      [newCm, newCt, Number(idExpediente)]
    );
  }

  const newCd = {
    codigo: cd.codigo || "",
    ok: Boolean(cd.ok),
    obs: cd.obs || "",
  };

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

function cleanDateYMD(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s;
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
  const b = req.body || {};
  const resTramo = await resolveTramoInfo(b);

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
       ci_propietario_frente_url,
       ci_propietario_dorso_url,
       ci_adicional_frente_url,
       ci_adicional_dorso_url
     )
     VALUES
     (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
     )
     RETURNING *`,
    [
      Number(b.id_proyecto),
      b.fecha_relevamiento || null,
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
      b.ci_propietario_frente_url || null,
      b.ci_propietario_dorso_url || null,
      b.ci_adicional_frente_url || null,
      b.ci_adicional_dorso_url || null,
    ]
  );

  await ensureEtapas(rows[0].id_expediente);

  const { rows: rows2 } = await pool.query(
    `SELECT * FROM ema.expedientes WHERE id_expediente = $1`,
    [rows[0].id_expediente]
  );

  res.json(rows2[0]);
};

exports.update = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  const b = req.body || {};
  const resTramo = await resolveTramoInfo(b);

  const { rows } = await pool.query(
    `UPDATE ema.expedientes SET
      fecha_relevamiento = $1,
      gps = $2,
      tecnico = $3,
      codigo_exp = $4,
      propietario_nombre = $5,
      propietario_ci = $6,
      tramo = $7,
      subtramo = $8,
      id_tramo = $9,
      id_sub_tramo = $10,
      codigo_censo = $11,
      ci_propietario_frente_url = $12,
      ci_propietario_dorso_url = $13,
      ci_adicional_frente_url = $14,
      ci_adicional_dorso_url = $15,
      updated_at = now()
     WHERE id_expediente = $16
     RETURNING *`,
    [
      b.fecha_relevamiento || null,
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
      b.ci_propietario_frente_url || null,
      b.ci_propietario_dorso_url || null,
      b.ci_adicional_frente_url || null,
      b.ci_adicional_dorso_url || null,
      idExp,
    ]
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
};

exports.remove = async (req, res) => {
  const idExp = Number(req.params.idExpediente);
  await pool.query(`DELETE FROM ema.expedientes WHERE id_expediente = $1`, [idExp]);
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

  if (tipo === "dbi") {
    const curr = rec.carpeta_dbi || {};
    const out = { ...curr, ok, obs };
    await pool.query(
      `UPDATE ema.expedientes
          SET carpeta_dbi = $1,
              updated_at = now()
        WHERE id_expediente = $2`,
      [out, idExp]
    );
    return res.json(out);
  }

  const list = tipo === "mejora" ? ETAPAS_MEJORA : ETAPAS_TERRENO;
  if (!list.includes(key)) {
    return res.status(400).json({ message: "key inválida para ese tipo" });
  }

  const col = tipo === "mejora" ? "carpeta_mejora" : "carpeta_terreno";
  const current = tipo === "mejora" ? rec.carpeta_mejora : rec.carpeta_terreno;

  const updated = {
    ...current,
    [key]: { ...(current?.[key] || { ok: false, obs: "" }), ok, obs },
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
  const { carpeta = "" } = req.query;
  const subcarpeta = sanitizeFolder(carpeta);

  const { rows } = await pool.query(
    `SELECT id_archivo,
            tipo_documento,
            subcarpeta,
            url,
            nombre_archivo,
            to_char(fecha_reg,'YYYY-MM-DD HH24:MI') AS fecha
       FROM ema.tumba
      WHERE id_documento = $1
        AND tipo_documento = 'expedientes'
        AND estado = 1
        AND COALESCE(subcarpeta,'') = COALESCE($2,'')
      ORDER BY fecha_reg DESC`,
    [idExp, subcarpeta || ""]
  );

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

async function markPlanoGeoref(idExpediente, tipo, ok) {
  const rec = await ensureEtapas(idExpediente);
  if (!rec) return;

  const col = tipo === "mejora" ? "carpeta_mejora" : "carpeta_terreno";
  const current = tipo === "mejora" ? rec.carpeta_mejora : rec.carpeta_terreno;

  const updated = {
    ...current,
    plano_georef: { ...(current?.plano_georef || { ok: false, obs: "" }), ok: Boolean(ok) },
  };

  await pool.query(
    `UPDATE ema.expedientes
        SET ${col} = $1,
            updated_at = now()
      WHERE id_expediente = $2`,
    [updated, Number(idExpediente)]
  );
}

async function markPlanoGeorefOK(idExpediente, tipo) {
  return markPlanoGeoref(idExpediente, tipo, true);
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
  const out = { ...(rec?.carpeta_dbi || {}), codigo, ok: true };

  await pool.query(
    `UPDATE ema.expedientes
        SET carpeta_dbi = $1,
            updated_at = now()
      WHERE id_expediente = $2`,
    [out, idExp]
  );

  res.json({ ok: true, codigo, url: rel, nombre_archivo: finalName });
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