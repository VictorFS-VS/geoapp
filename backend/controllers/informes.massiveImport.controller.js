// backend/controllers/informes.massiveImport.controller.js
const pool = require("../db");
const path = require("path");
const fs = require("fs-extra");
const AdmZip = require("adm-zip");
// Sanea nombre de archivo (evita traversal y caracteres problemáticos).
function sanitizeFilename(name) {
  if (!name) return "";
  const base = path.basename(String(name)).replace(/[\r\n]+/g, " ").trim();
  const bad = /[<>:"/\\|?*\u0000-\u001F]/g;
  return base.replace(bad, "_");
}

/** Normaliza una cadena para matching (trim, upper, colapsar espacios) */
function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * Controller for Massive Photo Import (ZIP)
 * Logic: Matches filenames with a report key field, saves photos, and appends paths (Pipe Separated).
 */
exports.importPhotosZip = async (req, res) => {
  const { idProyecto } = req.params;
  const { id_plantilla, id_campo_llave, id_campo_destino } = req.body;

  if (!req.files || !req.files.file) {
    return res.status(400).json({ ok: false, error: "No se subió ningún archivo ZIP." });
  }

  const zipFile = req.files.file;
  const tempDir = path.join(__dirname, "../tmp", `import_${Date.now()}`);
  const uploadsRoot = path.join(__dirname, "../uploads");

  const summary = {
    total_files: 0,
    matched: 0,
    omitted_duplicates: 0,
    orphans: 0,
    errors: 0
  };
  const details = [];

  try {
    // 1. Ensure temp dir exists and extract ZIP
    await fs.ensureDir(tempDir);
    
    // ✅ Fix: useTempFiles is true in global config, so data is empty. Use tempFilePath instead.
    const zip = new AdmZip(zipFile.tempFilePath);
    zip.extractAllTo(tempDir, true);

    const extractedFiles = await fs.readdir(tempDir, { recursive: true });
    // Filter only image extensions (jpg, jpeg, png, webp)
    const filesToProcess = extractedFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) && !path.basename(f).startsWith(".");
    });

    summary.total_files = filesToProcess.length;

    // 2. Fetch Universe of Reports
    const rUniverse = await pool.query(
      `
      SELECT id_informe, valor_texto as valor_llave
      FROM ema.informe_respuesta
      WHERE id_pregunta = $1 
        AND id_informe IN (SELECT id_informe FROM ema.informe WHERE id_proyecto = $2 AND id_plantilla = $3)
      `,
      [id_campo_llave, idProyecto, id_plantilla]
    );

    const universe = rUniverse.rows.filter(row => row.valor_llave && String(row.valor_llave).trim().length >= 5);

    // 3. Process each file
    for (const relativeFilePath of filesToProcess) {
      const fileName = path.basename(relativeFilePath);
      const normalizedFileName = normalizeKey(fileName);
      const sanitizedFileName = fileName.replace(/\|/g, "_"); 
      const fullPathTemp = path.join(tempDir, relativeFilePath);
      
      const matches = universe.filter(item => {
        const val = normalizeKey(item.valor_llave);
        return normalizedFileName.includes(val);
      });

      if (matches.length === 0) {
        summary.orphans++;
        details.push({ filename: fileName, status: "orphan", reason: "no_match" });
        continue;
      }

      for (const match of matches) {
        const idInforme = match.id_informe;
        
        // PHYSICAL PATH: uploads/proyectos/{idProyecto}/informes/{id_informe}/
        const destDir = path.join(uploadsRoot, "proyectos", String(idProyecto), "informes", String(idInforme));
        const finalFileName = `${Date.now()}_${sanitizedFileName}`;
        const finalAbs = path.join(destDir, finalFileName);
        
        // Final Relative Path (Standard: proyectos/X/informes/Y/arch.jpg)
        const relativePath = path.relative(uploadsRoot, finalAbs).replace(/\\/g, "/");

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // 3a. MASTER REGISTRY (EMA.TUMBA)
          await client.query(
            `INSERT INTO ema.tumba (id_documento, tipo_documento, id_tipo, url, nombre_archivo, estado)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [idInforme, 'informes', 4, relativePath, finalFileName, 1]
          );

          // 3b. INFORME_FOTO (Primary persistence for report gallery)
          if (id_campo_destino) {
            // Calculate next order
            const orderRes = await client.query(
              `SELECT COALESCE(MAX(orden), 0) + 1 as next_order 
               FROM ema.informe_foto 
               WHERE id_informe = $1 AND id_pregunta = $2`,
              [idInforme, id_campo_destino]
            );
            const nextOrder = orderRes.rows[0].next_order;

            await client.query(
              `INSERT INTO ema.informe_foto (id_informe, id_pregunta, ruta_archivo, orden)
               VALUES ($1, $2, $3, $4)`,
              [idInforme, id_campo_destino, relativePath, nextOrder]
            );
          }

          // 3c. PHYSICAL SAVE (Inside transaction - Rollback on failure)
          await fs.ensureDir(destDir);
          await fs.copy(fullPathTemp, finalAbs);

          await client.query("COMMIT");

          summary.matched++;
          details.push({ filename: fileName, status: "success", id_informe: idInforme });

        } catch (err) {
          await client.query("ROLLBACK");
          console.error(`Error updating report ${idInforme}:`, err);
          summary.errors++;
          details.push({ filename: fileName, status: "error", message: err.message, id_informe: idInforme });
        } finally {
          client.release();
        }
      }
    }

    return res.json({ ok: true, summary, details });

  } catch (error) {
    console.error("Critical error in massive photo import:", error);
    return res.status(500).json({ ok: false, error: "Error interno del servidor durante la importación." });
  } finally {
    // 4. Cleanup temp directory
    await fs.remove(tempDir).catch(e => console.error("Error removing temp dir:", e));
  }
};
