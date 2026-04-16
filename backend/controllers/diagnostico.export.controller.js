// controllers/diagnostico.export.controller.js
"use strict";

const pool = require("../db");
const ExcelJS = require("exceljs");
const path = require("path");

/* ----- Helpers Reutilizados (Espejo de informes.controller) ----- */
function getPublicBaseUrl(req) {
  const envBase = (process.env.PUBLIC_BASE_URL || process.env.VITE_PUBLIC_API_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function normalizeSlashes(p) {
  return String(p || "").replace(/\\/g, "/");
}

function toPublicPhotoUrl(req, ruta_archivo) {
  const raw = String(ruta_archivo || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getPublicBaseUrl(req);
  const PUBLIC_PREFIX = "/uploads";
  let rel = normalizeSlashes(raw).replace(/^\/+/, "");
  if (rel.toLowerCase().startsWith("uploads/")) rel = rel.slice("uploads/".length).replace(/^\/+/, "");
  return `${base}${PUBLIC_PREFIX}/${rel}`;
}

/**
 * Sanitizador de Strings para Excel (OpenXML)
 * Elimina caracteres de control que corrompen el archivo y truncado de seguridad.
 */
function sanitizeForXLS(v) {
  if (v === null || v === undefined) return "";
  let str = String(v);
  // Limpiar caracteres de control XML invalidos (\x00-\x1F excepto \t, \n \r que Excel sí soporta en celdas)
  const XML_CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
  str = str.replace(XML_CONTROL_CHAR_REGEX, "");
  // Truncado de seguridad (Límite de celdas de Excel)
  if (str.length > 32000) str = str.slice(0, 32000) + "... [Truncado]";
  return str.trim();
}

/**
 * Endpoint de exportación Excel EXCLUSIVO para diagnóstico.
 * GET /api/diagnostico/proyecto/:idProyecto/export/excel
 */
async function exportDiagnosticoProyectoExcel(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  const idPlantilla = req.query.plantilla ? parseInt(req.query.plantilla, 10) : null;

  if (!idProyecto || isNaN(idProyecto)) {
    return res.status(400).json({ ok: false, error: "idProyecto inválido" });
  }

  const client = await pool.connect();
  try {
    // 1) Metadatos del proyecto
    const proyQ = await client.query(
      "SELECT gid, nombre, codigo FROM ema.proyectos WHERE gid = $1",
      [idProyecto]
    );
    const proy = proyQ.rows?.[0];
    const proyectoLabel = proy
      ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
      : String(idProyecto);

    // 2) Consulta unificada: Informe + Registro + Resultado Fórmula + Auditoría
    const mainQuery = `
      SELECT 
        i.id_informe, i.fecha_creado, i.id_proyecto, i.id_plantilla, i.titulo,
        p.nombre AS nombre_plantilla,
        ir.id_registro,
        fr.score_total,
        fr.clasificacion,
        fr.etiquetas_json,
        fr.resultado_consultor,
        fr.manual_comment,
        fr.cambio_detectado,
        fr.fecha_recalculo,
        CONCAT(u.first_name, ' ', u.last_name) AS evaluador_nombre
      FROM ema.informe i
      JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
      LEFT JOIN ema.formula_resultado fr ON fr.id_registro = ir.id_registro
        AND fr.id_formula = (
           SELECT id_formula FROM ema.formula f 
           WHERE f.id_plantilla = i.id_plantilla AND f.activo = true 
           ORDER BY version DESC LIMIT 1
        )
      LEFT JOIN public.users u ON u.id = fr.id_usuario_evaluador
      WHERE i.id_proyecto = $1
      ${idPlantilla ? "AND i.id_plantilla = $2" : ""}
      ORDER BY i.fecha_creado DESC, i.id_informe DESC
    `;
    const params = idPlantilla && !isNaN(idPlantilla) ? [idProyecto, idPlantilla] : [idProyecto];
    const { rows: informes } = await client.query(mainQuery, params);

    if (!informes.length) {
      return res.status(404).json({ ok: false, error: "No hay informes para exportar." });
    }

    // --- 1. SANEAMIENTO DE IDs ---
    // Sanitización estricta de IDs para evitar NaN o tipos inválidos en PostgreSQL
    const informeIds = Array.from(new Set(informes.map((x) => parseInt(x.id_informe, 10)).filter(n => !isNaN(n) && n > 0)));
    const plantillasIds = Array.from(new Set(informes.map((i) => parseInt(i.id_plantilla, 10)).filter(n => !isNaN(n) && n > 0)));

    if (informeIds.length === 0 || plantillasIds.length === 0) {
       console.error('[XLS Export Error] Sin IDs válidos:', { idProyecto, informes: informes.length });
       return res.status(404).json({ ok: false, error: "No se encontraron IDs de plantillas o informes válidos para exportar." });
    }

    console.log('[XLS Export] IDs Saneados:', { informes: informeIds.length, plantillas: plantillasIds.length });

    // --- 2. RECOLECCIÓN DE PREGUNTAS (PROTEGIDA) ---
    const preguntasAll = [];
    try {
      const pq = await client.query(
        `SELECT p.id_pregunta, p.etiqueta, p.tipo,
                s.titulo AS seccion_titulo, s.id_plantilla
         FROM ema.informe_pregunta p
         JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
         WHERE s.id_plantilla = ANY($1::int[])
         ORDER BY s.id_plantilla, s.orden, p.orden`,
        [plantillasIds]
      );

      if (pq.rows && Array.isArray(pq.rows)) {
        // --- 3. SANITIZACIÓN ANTES DE INTEGRAR ---
        const sanitizedQuestions = pq.rows.map(q => ({
          colName: "", // Se asigna luego
          id_pregunta: Number(q.id_pregunta),
          id_plantilla: Number(q.id_plantilla),
          etiqueta: sanitizeForXLS(q.etiqueta),
          seccion: sanitizeForXLS(q.seccion_titulo),
          tipo: sanitizeForXLS(q.tipo)
        }));
        preguntasAll.push(...sanitizedQuestions);
      }
    } catch (err) {
      console.error('[XLS Export SQL Error] preguntas:', err.message);
      throw new Error(`Error al recolectar preguntas: ${err.message}`);
    }

    const normHeader = (s) => {
        let h = sanitizeForXLS(s).replace(/\s+/g, "_").replace(/[^\w]/g, "").slice(0, 80);
        return h || "col";
    };

    const usedHeaders = new Map();
    const uniqueHeader = (base) => {
      const k = base.toLowerCase();
      const n = (usedHeaders.get(k) || 0) + 1;
      usedHeaders.set(k, n);
      return n === 1 ? base : `${base}_${n}`;
    };

    const multiPlantilla = plantillasIds.length > 1;
    const preguntaCols = preguntasAll.map((p) => {
      const base = multiPlantilla 
         ? `P${p.id_plantilla}_${normHeader(p.seccion)}_${normHeader(p.etiqueta)}`
         : `${normHeader(p.seccion)}_${normHeader(p.etiqueta)}`;
      
      const colName = uniqueHeader(base);
      p.colName = colName; // Actualizar el objeto original
      return { colName, ...p };
    });

    // 3) Respuestas y Fotos
    const respAllQ = await client.query(
      `SELECT id_informe, id_pregunta, valor_texto, valor_bool, valor_json
       FROM ema.informe_respuesta
       WHERE id_informe = ANY($1::int[])`,
      [informeIds]
    );

    const respByInforme = new Map();
    for (const r of respAllQ.rows || []) {
      const idInf = Number(r.id_informe);
      const idPreg = Number(r.id_pregunta);
      if (!respByInforme.has(idInf)) respByInforme.set(idInf, new Map());

      let v = "";
      if (r.valor_bool !== null && r.valor_bool !== undefined) v = r.valor_bool ? "Sí" : "No";
      else if (r.valor_json !== null && r.valor_json !== undefined) {
        try {
          const parsed = typeof r.valor_json === "string" ? JSON.parse(r.valor_json) : r.valor_json;
          v = Array.isArray(parsed) ? parsed.join(", ") : (typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed));
        } catch { v = String(r.valor_json); }
      } else if (r.valor_texto != null) v = String(r.valor_texto);

      respByInforme.get(idInf).set(idPreg, sanitizeForXLS(v));
    }

    const fotosQ = await client.query(
      `SELECT id_informe, id_pregunta, ruta_archivo 
       FROM ema.informe_foto 
       WHERE id_informe = ANY($1::int[])
       ORDER BY id_informe, id_pregunta, orden`,
      [informeIds]
    );
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

    // 4) Armado de ExcelJS
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("data", { views: [{ state: "frozen", ySplit: 1 }] });

    const baseCols = [
      { header: "id_informe", key: "id_informe", width: 12 },
      { header: "fecha", key: "fecha", width: 22 },
      { header: "plantilla", key: "plantilla", width: 25 },
      
      // BLOQUE DIAGNÓSTICO
      { header: "Puntaje", key: "score_total", width: 12 },
      { header: "Autodiagnóstico (Sistema)", key: "clasificacion", width: 25 },
      { header: "Resultado Final (Auditado)", key: "resultado_final", width: 25 },
      { header: "Etiquetas Detección", key: "etiquetas", width: 30 },
      { header: "Justificación Consultor", key: "comentario", width: 40 },
      { header: "Consultor", key: "evaluador", width: 25 },
      { header: "Alerta Cambio", key: "cambio_detectado", width: 15 },
    ];

    const dynamicCols = preguntaCols.map(q => ({ header: q.colName, key: q.colName, width: 28 }));
    const fotoCols = preguntaCols.map(q => ({ header: `Fotos_${q.colName}`, key: `Fotos_${q.colName}`, width: 35 }));
    
    ws.columns = [...baseCols, ...dynamicCols, ...fotoCols];
    ws.getRow(1).font = { bold: true };

    for (const inf of informes) {
      const idInf = Number(inf.id_informe);
      const respMap = respByInforme.get(idInf) || new Map();
      const fotosMap = fotosByInforme.get(idInf) || new Map();

      const row = {
        id_informe: idInf,
        fecha: inf.fecha_creado ? new Date(inf.fecha_creado) : "",
        plantilla: sanitizeForXLS(inf.nombre_plantilla || inf.id_plantilla),
        
        score_total: inf.score_total != null ? Number(inf.score_total) : 0,
        clasificacion: sanitizeForXLS(inf.clasificacion || "N/A"),
        resultado_final: sanitizeForXLS(inf.resultado_consultor || inf.clasificacion || "N/A"),
        etiquetas: Array.isArray(inf.etiquetas_json) ? sanitizeForXLS(inf.etiquetas_json.join(", ")) : sanitizeForXLS(inf.etiquetas_json),
        comentario: sanitizeForXLS(inf.manual_comment),
        evaluador: sanitizeForXLS(inf.evaluador_nombre),
        cambio_detectado: inf.cambio_detectado ? "SÍ" : "NO"
      };

      for (const q of preguntaCols) {
        row[q.colName] = respMap.get(q.id_pregunta) || "";
        row[`Fotos_${q.colName}`] = sanitizeForXLS(fotosMap.get(q.id_pregunta));
      }

      ws.addRow(row).alignment = { vertical: "top", wrapText: true };
    }

    // 5) Hojas extra
    const wsQ = wb.addWorksheet("questions");
    wsQ.columns = [
      { header: "colName", key: "colName", width: 40 },
      { header: "plantilla", key: "id_plantilla", width: 12 },
      { header: "seccion", key: "seccion", width: 30 },
      { header: "pregunta", key: "etiqueta", width: 45 }
    ];
    preguntaCols.forEach(q => wsQ.addRow({
        colName: q.colName,
        id_plantilla: q.id_plantilla,
        seccion: sanitizeForXLS(q.seccion),
        etiqueta: sanitizeForXLS(q.etiqueta)
    }));

    const wsInfo = wb.addWorksheet("info");
    wsInfo.addRow(["Proyecto", sanitizeForXLS(proyectoLabel)]);
    wsInfo.addRow(["Tipo Exportación", "diagnostico"]);
    wsInfo.addRow(["Fecha Generado", new Date()]);

    const fileName = `Diagnostico_Proyecto_${idProyecto}_${Date.now()}.xlsx`.replace(/[^\w\.-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);

  } catch (err) {
    console.error("Error en exportDiagnosticoProyectoExcel:", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "Error interno al generar Excel" });
    } else {
      res.end();
    }
  } finally {
    client.release();
  }
}

module.exports = {
  exportDiagnosticoProyectoExcel
};
