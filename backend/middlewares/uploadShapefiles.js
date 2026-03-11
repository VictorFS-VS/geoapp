// middlewares/uploadShapefiles.js
const path = require("path");
const fs = require("fs");

// Carpeta unificada
const BASE_DIR = path.join(__dirname, "../uploads/mantenimiento");

// Permitimos comprimidos y KML/KMZ además de SHP + otros formatos convertibles
const ALLOWED_EXT = new Set([
  ".shp",
  ".shx",
  ".dbf",
  ".prj",
  ".cpg",
  ".sbn",
  ".sbx",
  ".zip",
  ".kmz",
  ".kml",
  ".rar",

  // ✅ convertibles (se convierten con ogr2ogr en controller)
  ".geojson",
  ".json",
  ".gpkg",
  ".gpx",
  ".gml",
  ".dxf",
]);

const MAX_FILE_BYTES = 500 * 1024 * 1024; // 500MB

function sanitizeName(name) {
  // basename evita path traversal; reemplaza espacios
  return path.basename(String(name || "file")).replace(/\s+/g, "_");
}

function makeBatchDir(inboxBase) {
  const ts = Date.now();
  const rnd = Math.random().toString(16).slice(2, 8);
  const dir = path.join(inboxBase, `lote_${ts}_${rnd}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeUnlinkDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn("⚠️ No se pudo limpiar lote:", dir, e?.message);
  }
}

function uniquePath(destDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(destDir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  let i = 1;
  while (true) {
    const next = path.join(destDir, `${base}(${i})${ext}`);
    if (!fs.existsSync(next)) return next;
    i++;
  }
}

/**
 * Guarda archivos en uploads/mantenimiento/:id/_inbox/lote_xxx
 * expone:
 *   req.uploadedShapefiles = [{ filename, path, size, ext }]
 *   req.inboxBatchDir = "....../_inbox/lote_xxx"
 */
async function uploadShapefiles(req, res, next) {
  const idProyecto = req.params.id;

  if (!idProyecto) {
    return res.status(400).json({ message: "Falta el parámetro 'id' del proyecto en la ruta." });
  }

  // express-fileupload suele ponerlos en req.files.<fieldName>
  // Tu frontend usa fd.append("files", f) => fieldName = "files"
  const raw = req.files?.files || req.files?.["files"];

  if (!raw) {
    return res.status(400).json({ message: "No se enviaron archivos en el campo 'files'." });
  }

  const enviados = Array.isArray(raw) ? raw : [raw];

  if (!enviados.length) {
    return res.status(400).json({ message: "No se recibieron archivos (files vacío)." });
  }

  const inboxBase = path.join(BASE_DIR, String(idProyecto), "_inbox");
  try {
    fs.mkdirSync(inboxBase, { recursive: true });
  } catch (e) {
    console.error("❌ Error creando carpeta _inbox:", e);
    return res.status(500).json({ message: "No se pudo preparar carpeta de carga (_inbox)." });
  }

  // ✅ subcarpeta por lote (evita re-procesar cargas viejas)
  let batchDir = null;
  try {
    batchDir = makeBatchDir(inboxBase);
  } catch (e) {
    console.error("❌ Error creando carpeta de lote:", e);
    return res.status(500).json({ message: "No se pudo preparar carpeta de carga (lote)." });
  }

  try {
    // 1) VALIDAR TODO antes de mover (evita cargas parciales)
    for (const f of enviados) {
      const originalName = f?.name || "file";
      const ext = path.extname(originalName).toLowerCase();
      const size = Number(f?.size || 0);

      if (!ALLOWED_EXT.has(ext)) {
        throw Object.assign(new Error(`Extensión no permitida en "${originalName}".`), {
          status: 400,
        });
      }

      if (!Number.isFinite(size) || size <= 0) {
        throw Object.assign(new Error(`Archivo inválido o vacío: "${originalName}".`), { status: 400 });
      }

      if (size > MAX_FILE_BYTES) {
        throw Object.assign(
          new Error(`El archivo "${originalName}" supera el límite de ${MAX_FILE_BYTES} bytes.`),
          { status: 400 }
        );
      }

      if (typeof f?.mv !== "function") {
        // Esto pasaría si no estás usando express-fileupload (o si llega mal)
        throw Object.assign(new Error(`El archivo "${originalName}" no es movible (f.mv no existe).`), {
          status: 500,
        });
      }
    }

    // 2) MOVER (guardar)
    const guardados = [];
    for (const f of enviados) {
      const originalName = f.name;
      const ext = path.extname(originalName).toLowerCase();

      const safeName = sanitizeName(originalName);
      const destPath = uniquePath(batchDir, safeName);
      const finalName = path.basename(destPath);

      await f.mv(destPath);

      guardados.push({
        filename: finalName,
        path: destPath,
        size: Number(f.size || 0),
        ext,
      });
    }

    req.uploadedShapefiles = guardados;
    req.inboxBatchDir = batchDir;

    return next();
  } catch (e) {
    // Limpieza del lote si falló algo
    safeUnlinkDir(batchDir);

    const status = e?.status || 500;
    console.error("❌ uploadShapefiles:", e);
    return res.status(status).json({ message: e.message || "Error al guardar archivos." });
  }
}

module.exports = uploadShapefiles;
