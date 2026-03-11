// controllers/documentos.controller.js
const path = require("path");
const fs = require("fs-extra");
const mime = require("mime-types");
const pool = require("../db"); // pg Pool

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   CONFIG                                                         ║
   ╚══════════════════════════════════════════════════════════════════╝ */
const BASE_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "documentosproyecto");

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   HELPERS                                                        ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/**
 * Corrige "mojibake" típico (ResoluciÃ³n -> Resolución) y normaliza unicode.
 * Esto evita que se guarde con símbolos raros por problemas de encoding.
 */
function fixUtf8Filename(name) {
  if (!name) return "";
  let s = String(name);

  // Mojibake típico: UTF-8 leído como latin1
  if (/[Ã�Â]/.test(s)) {
    try {
      s = Buffer.from(s, "latin1").toString("utf8");
    } catch {}
  }

  // Normalizar unicode (evita combinaciones raras)
  try {
    s = s.normalize("NFC");
  } catch {}

  // Quitar controles/invisibles
  s = s.replace(/[\u0000-\u001F\u007F]/g, "");

  return s.trim();
}

/** Sanea nombre de archivo (evita traversal y caracteres problemáticos). */
function sanitizeFilename(name) {
  if (!name) return "";
  name = path.basename(String(name)).replace(/[\r\n]+/g, " ").trim();
  const bad = /[<>:"/\\|?*\u0000-\u001F]/g; // windows + control chars
  name = name.replace(bad, "_");
  if (name === "." || name === "..") name = `archivo_${Date.now()}`;
  return name || `archivo_${Date.now()}`;
}

/** Sanea nombre de carpeta (sin barras ni traversal). */
function sanitizeFolder(folder) {
  if (!folder) return "";
  folder = String(folder).replace(/^\.+/g, "").replace(/[\\/]+/g, " ").trim();
  folder = folder.replace(/[\u0000-\u001F]/g, "");
  if (!folder || folder === "." || folder === "..") return "";
  return folder;
}

/** Genera un nombre único si existe conflicto. */
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

/**
 * Normaliza archivos subidos para soportar:
 * - express-fileupload: {archivo} o {archivo: [..]}
 * - nombres alternativos: archivo[] / archivos
 * - objeto indexado {0:...,1:...}
 */
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

/**
 * Resuelve la ruta absoluta a partir de lo que haya en `url`.
 * Soporta:
 *   - rutas absolutas antiguas tipo "C:\uploads\documentosproyecto\..."
 *   - rutas absolutas con "/" tipo "C:/uploads/documentosproyecto/..."
 *   - "/uploads/documentosproyecto/..."
 *   - "/documentosproyecto/..."
 *   - "documentosproyecto/..."
 *   - "proyecto_123/otros/archivo.pdf"
 */
function resolveAbsolutePath(url) {
  if (!url) return null;

  const raw = String(url).trim();
  if (!raw) return null;

  const normalized = raw.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();

  // ================== CASO 1: ruta ABSOLUTA ==================
  if (path.isAbsolute(raw)) {
    if (fs.existsSync(raw)) return raw;

    const markerUploads = "/uploads/";
    const idxUploads = lower.indexOf(markerUploads);
    if (idxUploads !== -1) {
      const relFromUploads = normalized.slice(idxUploads + markerUploads.length);
      return path.join(__dirname, "..", "uploads", relFromUploads);
    }

    const markerDocs = "/documentosproyecto/";
    const idxDocs = lower.indexOf(markerDocs);
    if (idxDocs !== -1) {
      const relDoc = normalized.slice(idxDocs + markerDocs.length);
      return path.join(BASE_UPLOAD_DIR, relDoc);
    }

    return path.join(__dirname, "..", "uploads", path.basename(raw));
  }

  // ================== CASO 2: ruta NO absoluta ==================
  let p = normalized.replace(/^[/]+/, "");
  const lowerP = p.toLowerCase();

  if (lowerP.startsWith("uploads/")) {
    const rel = p.slice("uploads/".length);
    return path.join(__dirname, "..", "uploads", rel);
  }

  if (lowerP.startsWith("documentosproyecto/")) {
    const relDoc = p.slice("documentosproyecto/".length);
    return path.join(BASE_UPLOAD_DIR, relDoc);
  }

  if (lowerP.startsWith("proyecto_")) {
    return path.join(BASE_UPLOAD_DIR, p);
  }

  return path.join(__dirname, "..", "uploads", p);
}

/** Enviar inline (preview) con content-type correcto. */
function sendInline(res, absPath, filename) {
  const ctype = mime.lookup(absPath) || "application/octet-stream";

  res.setHeader("Content-Type", ctype);

  // Mejor header para UTF-8 en nombres (evita problemas con acentos)
  const safeName = String(filename || path.basename(absPath));
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );

  // ✅ Importante para PDF viewers (requests parciales / streaming)
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  return res.sendFile(absPath);
}

/** Descargar con filename sugerido. */
function sendDownload(res, absPath, filename) {
  const ctype = mime.lookup(absPath) || "application/octet-stream";
  res.setHeader("Content-Type", ctype);

  const safeName = String(filename || path.basename(absPath));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`
  );

  return res.sendFile(absPath);
}

/** Busca el id_proyecto de una resolución. */
async function getProyectoIdByResolucion(idResolucion) {
  const q = await pool.query(
    `SELECT id_proyecto
       FROM ema.resoluciones
      WHERE id_resoluciones = $1`,
    [parseInt(idResolucion, 10)]
  );
  return q.rows?.[0]?.id_proyecto || null;
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   LEGACY: Documentos por PROYECTO (formulario)                   ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/**
 * GET /documentos/listar/:idProyecto/:formulario
 * Devuelve archivos de ema.tumba con id_documento = idProyecto y tipo_documento = formulario.
 */
async function listarDocumentos(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  const formulario = String(req.params.formulario || "").trim();
  const { carpeta = "" } = req.query;

  try {
    const { rows } = await pool.query(
      `SELECT id_archivo, tipo_documento, subcarpeta, url, nombre_archivo,
              to_char(fecha_reg,'YYYY-MM-DD HH24:MI') AS fecha
         FROM ema.tumba
        WHERE id_documento = $1
          AND tipo_documento = $2
          AND estado = 1
          AND COALESCE(subcarpeta,'') = COALESCE($3,'')
        ORDER BY fecha_reg DESC`,
      [idProyecto, formulario, carpeta || ""]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ listarDocumentos:", err);
    res.status(500).json({ message: "Error al listar documentos" });
  }
}

/**
 * POST /documentos/upload/:idProyecto/:formulario
 * Guarda en: /uploads/documentosproyecto/proyecto_{idProyecto}/{formulario}/(subcarpeta?)/archivo.ext
 * Registra en ema.tumba con id_documento = idProyecto, tipo_documento = formulario.
 */
async function subirDocumento(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  const formulario = String(req.params.formulario || "").trim();
  const subcarpetaRaw = req.body?.subcarpeta ?? req.query?.subcarpeta ?? "";
  const subcarpeta = sanitizeFolder(subcarpetaRaw);

  const files = pickFilesFromReq(req);

  if (!files.length) {
    return res.status(400).json({ message: "No se subió ningún archivo." });
  }

  try {
    // id_tipo según tu regla
    let id_tipo = 4;
    const tf = (formulario || "").toLowerCase();
    if (tf === "pga") id_tipo = 1;
    else if (tf === "resoluciones") id_tipo = 2;
    else if (tf === "declaraciones") id_tipo = 3;

    const baseDir = path.join(
      BASE_UPLOAD_DIR,
      `proyecto_${idProyecto}`,
      formulario,
      subcarpeta || ""
    );
    await fs.ensureDir(baseDir);

    const subidos = [];
    const fallidos = [];

    for (const f of files) {
      let destPath = null;

      try {
        if (!isExpressFileUploadFile(f)) {
          throw new Error(
            "Formato de archivo no compatible (mv no existe). Verifique middleware de upload (express-fileupload) y el nombre del campo."
          );
        }

        // ✅ arregla encoding + sanitiza
        const originalName = sanitizeFilename(fixUtf8Filename(f.name));
        const finalName = await uniqueFilename(baseDir, originalName);
        destPath = path.join(baseDir, finalName);

        await f.mv(destPath);

        const rel = path.posix.join(
          "/uploads/documentosproyecto",
          `proyecto_${idProyecto}`,
          formulario,
          ...(subcarpeta ? [subcarpeta] : []),
          finalName
        );

        await pool.query(
          `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, subcarpeta, url, nombre_archivo)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [idProyecto, formulario, id_tipo, subcarpeta || null, rel, finalName]
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

    if (!subidos.length) {
      return res.status(500).json({
        message: "No se pudo subir ningún archivo.",
        ok: 0,
        fail: fallidos.length,
        subidos,
        fallidos,
      });
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
  } catch (err) {
    console.error("❌ subirDocumento:", err);
    return res.status(500).json({
      message: "Error interno al subir documento",
      error: err?.message || String(err),
    });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   NUEVO: Documentos por RESOLUCIÓN                               ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/**
 * GET /documentos/resolucion/:idResolucion
 * Lista documentos con id_documento = idResolucion y tipo_documento = 'resolucion'
 */
async function listarDocumentosResolucion(req, res) {
  const idResolucion = parseInt(req.params.idResolucion, 10);
  try {
    const { rows } = await pool.query(
      `SELECT id_archivo, tipo_documento, subcarpeta, url, nombre_archivo,
              to_char(fecha_reg,'YYYY-MM-DD HH24:MI') AS fecha
         FROM ema.tumba
        WHERE id_documento = $1
          AND tipo_documento = 'resolucion'
          AND estado = 1
        ORDER BY fecha_reg DESC`,
      [idResolucion]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ listarDocumentosResolucion:", err);
    res.status(500).json({ message: "Error al listar documentos" });
  }
}

/**
 * POST /documentos/resolucion/:idResolucion/upload
 * Guarda en: /uploads/documentosproyecto/proyecto_{idProyecto}/resoluciones/{idResolucion}/(subcarpeta?)/archivo
 * Registra en ema.tumba con id_documento = idResolucion, tipo_documento = 'resolucion'
 */
async function subirDocumentoResolucion(req, res) {
  const idResolucion = parseInt(req.params.idResolucion, 10);
  const subcarpetaRaw = req.body?.subcarpeta ?? req.query?.subcarpeta ?? "";
  const subcarpeta = sanitizeFolder(subcarpetaRaw);

  const files = pickFilesFromReq(req);

  if (!files.length) {
    return res.status(400).json({ message: "No se subió ningún archivo." });
  }

  try {
    const idProyecto = await getProyectoIdByResolucion(idResolucion);
    if (!idProyecto) {
      return res.status(404).json({ message: "Resolución o proyecto no encontrado." });
    }

    const baseDir = path.join(
      BASE_UPLOAD_DIR,
      `proyecto_${idProyecto}`,
      "resoluciones",
      String(idResolucion),
      subcarpeta || ""
    );
    await fs.ensureDir(baseDir);

    const subidos = [];
    const fallidos = [];

    for (const f of files) {
      let destPath = null;

      try {
        if (!isExpressFileUploadFile(f)) {
          throw new Error(
            "Formato de archivo no compatible (mv no existe). Revisar middleware (express-fileupload) o el nombre del campo."
          );
        }

        // ✅ arregla encoding + sanitiza
        const originalName = sanitizeFilename(fixUtf8Filename(f.name));
        if (!originalName) throw new Error("Nombre de archivo inválido");

        const finalName = await uniqueFilename(baseDir, originalName);
        destPath = path.join(baseDir, finalName);

        await f.mv(destPath);

        const rel = path.posix.join(
          "/uploads/documentosproyecto",
          `proyecto_${idProyecto}`,
          "resoluciones",
          String(idResolucion),
          ...(subcarpeta ? [subcarpeta] : []),
          finalName
        );

        await pool.query(
          `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, subcarpeta, url, nombre_archivo)
           VALUES ($1,'resolucion',2,$2,$3,$4)`,
          [idResolucion, subcarpeta || null, rel, finalName]
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

    if (!subidos.length) {
      return res.status(500).json({
        message: "No se pudo subir ningún archivo.",
        ok: 0,
        fail: fallidos.length,
        subidos,
        fallidos,
      });
    }

    return res.json({
      message: fallidos.length
        ? `Subidos ${subidos.length} archivo(s). ${fallidos.length} fallaron.`
        : `Subidos ${subidos.length} archivo(s).`,
      ok: subidos.length,
      fail: fallidos.length,
      subidos,
      fallidos,
    });
  } catch (err) {
    console.error("❌ subirDocumentoResolucion:", err);
    return res.status(500).json({
      message: "Error interno al subir documento",
      error: err?.message || String(err),
      code: err?.code,
      detail: err?.detail,
    });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   ACCIONES POR id_archivo                                        ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/** GET /documentos/ver/:idArchivo (inline) */
async function verInline(req, res) {
  const idArchivo = parseInt(req.params.idArchivo, 10);
  try {
    const { rows } = await pool.query(
      `SELECT url, nombre_archivo FROM ema.tumba WHERE id_archivo = $1`,
      [idArchivo]
    );
    if (!rows.length) return res.status(404).json({ message: "No encontrado" });

    const rec = rows[0];
    const abs = resolveAbsolutePath(rec.url);
    if (!abs || !(await fs.pathExists(abs))) {
      return res.status(404).json({ message: "Archivo no existe en disco" });
    }
    return sendInline(res, abs, rec.nombre_archivo || path.basename(abs));
  } catch (err) {
    console.error("❌ verInline:", err);
    res.status(500).json({ message: "Error al abrir archivo" });
  }
}

/** GET /documentos/descargar/:idArchivo */
async function descargarPorId(req, res) {
  const idArchivo = parseInt(req.params.idArchivo, 10);
  try {
    const { rows } = await pool.query(
      `SELECT url, nombre_archivo FROM ema.tumba WHERE id_archivo = $1`,
      [idArchivo]
    );
    if (!rows.length) return res.status(404).json({ message: "No encontrado" });

    const rec = rows[0];
    const abs = resolveAbsolutePath(rec.url);
    if (!abs || !(await fs.pathExists(abs))) {
      return res.status(404).json({ message: "Archivo no existe en disco" });
    }
    return sendDownload(res, abs, rec.nombre_archivo || path.basename(abs));
  } catch (err) {
    console.error("❌ descargarPorId:", err);
    res.status(500).json({ message: "Error al descargar" });
  }
}

/**
 * PATCH /documentos/renombrar/:idArchivo
 * Body: { nuevoNombre: string, nuevaSubcarpeta?: string }
 * Soporta tipo_documento 'resolucion' (mueve dentro de su árbol) y legacy por proyecto.
 */
async function renombrarDocumento(req, res) {
  const { idArchivo } = req.params;
  const { nuevoNombre, nuevaSubcarpeta } = req.body || {};

  // ✅ arregla encoding + sanitiza
  const cleanName = sanitizeFilename(fixUtf8Filename(nuevoNombre || ""));
  const cleanFolder = sanitizeFolder(nuevaSubcarpeta || "");
  if (!cleanName) return res.status(400).json({ message: "Nombre de archivo inválido." });

  try {
    const { rows } = await pool.query(
      `SELECT id_documento, tipo_documento, url, nombre_archivo, subcarpeta
         FROM ema.tumba
        WHERE id_archivo = $1`,
      [parseInt(idArchivo, 10)]
    );
    if (!rows.length) return res.status(404).json({ message: "Documento no encontrado." });
    const rec = rows[0];

    let baseProyectoDir;
    if (rec.tipo_documento === "resolucion") {
      const idProyecto = await getProyectoIdByResolucion(rec.id_documento);
      if (!idProyecto) return res.status(404).json({ message: "Proyecto de la resolución no encontrado." });
      baseProyectoDir = path.join(
        BASE_UPLOAD_DIR,
        `proyecto_${idProyecto}`,
        "resoluciones",
        String(rec.id_documento)
      );
    } else {
      baseProyectoDir = path.join(BASE_UPLOAD_DIR, `proyecto_${rec.id_documento}`, rec.tipo_documento);
    }

    const targetFolder = path.join(baseProyectoDir, cleanFolder || "");
    await fs.ensureDir(targetFolder);

    const finalName = await uniqueFilename(targetFolder, cleanName);
    const newAbs = path.join(targetFolder, finalName);

    const oldAbs = resolveAbsolutePath(rec.url);
    await fs.move(oldAbs, newAbs, { overwrite: false });

    const uploadsRoot = path.join(__dirname, "..", "uploads");
    const relFromUploads = path.relative(uploadsRoot, newAbs).replace(/\\/g, "/");
    const newRel = `/uploads/${relFromUploads}`;

    await pool.query(
      `UPDATE ema.tumba
          SET nombre_archivo=$1, url=$2, subcarpeta=$3
        WHERE id_archivo=$4`,
      [finalName, newRel, cleanFolder || null, parseInt(idArchivo, 10)]
    );

    res.json({ message: "Documento renombrado.", nombre_archivo: finalName, subcarpeta: cleanFolder });
  } catch (err) {
    console.error("❌ renombrarDocumento:", err);
    res.status(500).json({ message: "No se pudo renombrar/mover el documento" });
  }
}

/**
 * DELETE /documentos/eliminar/:idArchivo
 * Borra físico y registro.
 */
async function eliminarDocumento(req, res) {
  const { idArchivo } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id_documento, tipo_documento, url
         FROM ema.tumba
        WHERE id_archivo = $1`,
      [parseInt(idArchivo, 10)]
    );
    if (!rows.length) return res.status(404).json({ message: "Documento no encontrado." });
    const rec = rows[0];

    const filePath = resolveAbsolutePath(rec.url);
    if (filePath && (await fs.pathExists(filePath))) {
      await fs.remove(filePath);
    }
    await pool.query(`DELETE FROM ema.tumba WHERE id_archivo = $1`, [parseInt(idArchivo, 10)]);

    res.json({ message: "Documento eliminado." });
  } catch (err) {
    console.error("❌ eliminarDocumento:", err);
    res.status(500).json({ message: "Error interno al eliminar" });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   (Opcional) Carpetas por proyecto                               ║
   ╚══════════════════════════════════════════════════════════════════╝ */

/**
 * GET /documentos/carpetas/:idProyecto
 */
async function listarCarpetas(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  const base = path.join(BASE_UPLOAD_DIR, `proyecto_${idProyecto}`);
  try {
    if (!(await fs.pathExists(base))) return res.json([]);
    const entries = await fs.readdir(base, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    res.json(dirs);
  } catch (err) {
    console.error("❌ listarCarpetas:", err);
    res.status(500).json({ message: "Error al listar carpetas" });
  }
}

/**
 * POST /documentos/carpetas/:idProyecto
 * Body: { nombre: string }
 */
async function crearCarpeta(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  const nombre = sanitizeFolder(req.body?.nombre || "");
  if (!nombre) return res.status(400).json({ message: "Nombre de carpeta inválido." });

  try {
    const dest = path.join(BASE_UPLOAD_DIR, `proyecto_${idProyecto}`, nombre);
    await fs.ensureDir(dest);
    res.json({ message: "Carpeta creada." });
  } catch (err) {
    console.error("❌ crearCarpeta:", err);
    res.status(500).json({ message: "Error al crear carpeta" });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║   EXPORTS                                                        ║
   ╚══════════════════════════════════════════════════════════════════╝ */
module.exports = {
  // Carpetas por proyecto
  listarCarpetas,
  crearCarpeta,

  // Legacy por proyecto/formulario
  listarDocumentos,
  subirDocumento,

  // Nuevas por resolución
  listarDocumentosResolucion,
  subirDocumentoResolucion,

  // Acciones por id_archivo
  verInline,
  descargarPorId,
  renombrarDocumento,
  eliminarDocumento,
};
