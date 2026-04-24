"use strict";

const pool = require("../db");
const ExcelJS = require("exceljs");

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

function sanitizeForXLS(v) {
  if (v === null || v === undefined) return "";
  let str = String(v);
  const XML_CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
  str = str.replace(XML_CONTROL_CHAR_REGEX, "");
  if (str.length > 32000) str = str.slice(0, 32000) + "... [Truncado]";
  return str.trim();
}

function formatExcelDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return "";
}

function normalizeStringArray(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((v) => String(v).trim())
        .filter(Boolean)
    )
  );
}

function normalizeIntArray(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((v) => Number.parseInt(String(v).trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
}

const BASE_EXPORT_FIELDS = [
  {
    key: "id_informe",
    label: "id_informe",
    order: 1,
    width: 12,
    getter: (inf) => inf.id_informe ?? "",
  },
  {
    key: "fecha",
    label: "fecha",
    order: 2,
    width: 22,
    getter: (inf) => (inf.fecha_creado ? new Date(inf.fecha_creado) : ""),
  },
  {
    key: "plantilla",
    label: "plantilla",
    order: 3,
    width: 25,
    getter: (inf) => sanitizeForXLS(inf.nombre_plantilla || inf.id_plantilla),
  },
];

const DIAGNOSTIC_EXPORT_FIELDS = [
  {
    key: "id_registro",
    label: "id_registro",
    order: 1,
    width: 12,
    getter: (inf) => inf.id_registro ?? "",
  },
  {
    key: "score_total",
    label: "Puntaje",
    order: 2,
    width: 12,
    getter: (inf) => (inf.score_total != null ? Number(inf.score_total) : ""),
  },
  {
    key: "clasificacion",
    label: "Autodiagnóstico (Sistema)",
    order: 3,
    width: 25,
    getter: (inf) => sanitizeForXLS(inf.clasificacion || ""),
  },
  {
    key: "clasificacion_auto",
    label: "Clasificación Automática",
    order: 4,
    width: 25,
    getter: (inf) => sanitizeForXLS(inf.clasificacion || ""),
  },
  {
    key: "resultado_consultor",
    label: "Resultado Consultor",
    order: 5,
    width: 25,
    getter: (inf) => sanitizeForXLS(inf.resultado_consultor || ""),
  },
  {
    key: "resultado_final",
    label: "Resultado Final (Auditado)",
    order: 6,
    width: 25,
    getter: (inf) => sanitizeForXLS(firstNonEmpty(inf.resultado_consultor, inf.clasificacion || "N/A")),
  },
  {
    key: "version_formula",
    label: "Versión Fórmula",
    order: 7,
    width: 14,
    getter: (inf) => (inf.version_formula != null ? Number(inf.version_formula) : ""),
  },
  {
    key: "manual_override",
    label: "Override Manual",
    order: 8,
    width: 14,
    getter: (inf) => (inf.manual_override == null ? "" : inf.manual_override ? "SÍ" : "NO"),
  },
  {
    key: "manual_comment",
    label: "Comentario Consultor",
    order: 9,
    width: 40,
    getter: (inf) => sanitizeForXLS(inf.manual_comment),
  },
  {
    key: "comentario",
    label: "Justificación Consultor",
    order: 10,
    width: 40,
    getter: (inf) => sanitizeForXLS(inf.manual_comment),
  },
  {
    key: "fecha_manual_evaluacion",
    label: "Fecha Evaluación Manual",
    order: 11,
    width: 22,
    getter: (inf) => formatExcelDateTime(inf.fecha_manual_evaluacion),
  },
  {
    key: "fecha_recalculo",
    label: "Fecha Recalculo",
    order: 12,
    width: 22,
    getter: (inf) => formatExcelDateTime(inf.fecha_recalculo),
  },
  {
    key: "evaluador",
    label: "Consultor",
    order: 13,
    width: 25,
    getter: (inf) => sanitizeForXLS(inf.evaluador_nombre),
  },
  {
    key: "id_usuario_evaluador",
    label: "ID Consultor",
    order: 14,
    width: 14,
    getter: (inf) => (inf.id_usuario_evaluador != null ? Number(inf.id_usuario_evaluador) : ""),
  },
  {
    key: "descripcion_rango",
    label: "Descripción Rango",
    order: 15,
    width: 40,
    getter: (inf) => sanitizeForXLS(inf.descripcion_rango),
  },
  {
    key: "cambio_detectado",
    label: "Alerta Cambio",
    order: 16,
    width: 15,
    getter: (inf) => (inf.cambio_detectado ? "SÍ" : "NO"),
  },
  {
    key: "etiquetas",
    label: "Etiquetas Detección",
    order: 17,
    width: 30,
    getter: (inf) =>
      Array.isArray(inf.etiquetas_json)
        ? sanitizeForXLS(inf.etiquetas_json.join(", "))
        : sanitizeForXLS(inf.etiquetas_json),
  },
];

const DEFAULT_BASE_EXPORT_KEYS = ["id_informe", "fecha", "plantilla"];
const DEFAULT_DIAGNOSTIC_EXPORT_KEYS = [
  "id_registro",
  "score_total",
  "clasificacion",
  "clasificacion_auto",
  "resultado_consultor",
  "resultado_final",
  "version_formula",
  "manual_override",
  "comentario",
  "fecha_manual_evaluacion",
  "fecha_recalculo",
  "evaluador",
  "id_usuario_evaluador",
  "descripcion_rango",
  "cambio_detectado",
  "etiquetas",
];

function pickFields(allowlist, selectedKeys, defaultKeys) {
  const keys = selectedKeys === null ? defaultKeys : selectedKeys;
  const set = new Set(Array.isArray(keys) ? keys : []);
  return allowlist
    .filter((field) => set.has(field.key))
    .sort((a, b) => a.order - b.order);
}

function normalizeSelection(raw = {}) {
  return {
    baseKeys: normalizeStringArray(raw.base_fields),
    diagnosticKeys: normalizeStringArray(raw.diagnostic_fields),
    questionIds: normalizeIntArray(raw.question_ids),
  };
}

async function buildDiagnosticoWorkbook({ req, client, idProyecto, idPlantilla, selection }) {
  const proyQ = await client.query(
    "SELECT gid, nombre, codigo FROM ema.proyectos WHERE gid = $1",
    [idProyecto]
  );
  const proy = proyQ.rows?.[0];
  const proyectoLabel = proy
    ? `${proy.codigo ? proy.codigo + " - " : ""}${proy.nombre || ""}`.trim()
    : String(idProyecto);

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
      fr.manual_override,
      fr.cambio_detectado,
      fr.version_formula,
      fr.fecha_manual_evaluacion,
      fr.fecha_recalculo,
      fr.id_usuario_evaluador,
      CONCAT(u.first_name, ' ', u.last_name) AS evaluador_nombre,
      (
        SELECT r.descripcion
        FROM ema.formula_rango r
        WHERE r.id_formula = fr.id_formula
          AND r.min_valor <= fr.score_total
          AND r.max_valor >= fr.score_total
        ORDER BY r.prioridad DESC
        LIMIT 1
      ) AS descripcion_rango
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

  const params = idPlantilla && !Number.isNaN(idPlantilla) ? [idProyecto, idPlantilla] : [idProyecto];
  const { rows: informes } = await client.query(mainQuery, params);

  if (!informes.length) {
    const err = new Error("No hay informes para exportar.");
    err.status = 404;
    throw err;
  }

  const informeIds = Array.from(
    new Set(
      informes
        .map((x) => Number.parseInt(x.id_informe, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  const plantillasIds = Array.from(
    new Set(
      informes
        .map((i) => Number.parseInt(i.id_plantilla, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  if (informeIds.length === 0 || plantillasIds.length === 0) {
    const err = new Error("No se encontraron IDs de plantillas o informes válidos para exportar.");
    err.status = 404;
    throw err;
  }

  const preguntasAll = [];
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
    preguntasAll.push(
      ...pq.rows.map((q) => ({
        id_pregunta: Number(q.id_pregunta),
        id_plantilla: Number(q.id_plantilla),
        etiqueta: sanitizeForXLS(q.etiqueta),
        seccion: sanitizeForXLS(q.seccion_titulo),
        tipo: sanitizeForXLS(q.tipo),
      }))
    );
  }

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
        v = Array.isArray(parsed)
          ? parsed.join(", ")
          : typeof parsed === "object"
            ? JSON.stringify(parsed)
            : String(parsed);
      } catch {
        v = String(r.valor_json);
      }
    } else if (r.valor_texto != null) {
      v = String(r.valor_texto);
    }

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

  const selectedBaseFields = pickFields(
    BASE_EXPORT_FIELDS,
    selection.baseKeys,
    DEFAULT_BASE_EXPORT_KEYS
  );
  const selectedDiagnosticFields = pickFields(
    DIAGNOSTIC_EXPORT_FIELDS,
    selection.diagnosticKeys,
    DEFAULT_DIAGNOSTIC_EXPORT_KEYS
  );
  const selectedQuestionCols =
    selection.questionIds === null
      ? preguntasAll.map((p) => p)
      : preguntasAll.filter((p) => selection.questionIds.includes(p.id_pregunta));

  const preguntaCols = selectedQuestionCols.map((p) => {
    const normHeader = (s) =>
      sanitizeForXLS(s).replace(/\s+/g, "_").replace(/[^\w]/g, "").slice(0, 80) || "col";
    const multiPlantilla = plantillasIds.length > 1;
    const base = multiPlantilla
      ? `P${p.id_plantilla}_${normHeader(p.seccion)}_${normHeader(p.etiqueta)}`
      : `${normHeader(p.seccion)}_${normHeader(p.etiqueta)}`;
    return {
      ...p,
      colName: base,
    };
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("data", { views: [{ state: "frozen", ySplit: 1 }] });

  const baseCols = [
    ...selectedBaseFields.map((field) => ({
      header: field.label,
      key: field.key,
      width: field.width,
    })),
    ...selectedDiagnosticFields.map((field) => ({
      header: field.label,
      key: field.key,
      width: field.width,
    })),
  ];
  const dynamicCols = preguntaCols.map((q) => ({ header: q.colName, key: q.colName, width: 28 }));
  const fotoCols = preguntaCols.map((q) => ({ header: `Fotos_${q.colName}`, key: `Fotos_${q.colName}`, width: 35 }));

  ws.columns = [...baseCols, ...dynamicCols, ...fotoCols];
  ws.getRow(1).font = { bold: true };

  for (const inf of informes) {
    const idInf = Number(inf.id_informe);
    const respMap = respByInforme.get(idInf) || new Map();
    const fotosMap = fotosByInforme.get(idInf) || new Map();
    const row = {};

    for (const field of selectedBaseFields) {
      row[field.key] = field.getter(inf, { proyectoLabel });
    }
    for (const field of selectedDiagnosticFields) {
      row[field.key] = field.getter(inf, { proyectoLabel });
    }
    for (const q of preguntaCols) {
      row[q.colName] = respMap.get(q.id_pregunta) || "";
      row[`Fotos_${q.colName}`] = sanitizeForXLS(fotosMap.get(q.id_pregunta));
    }

    ws.addRow(row).alignment = { vertical: "top", wrapText: true };
  }

  const wsQ = wb.addWorksheet("questions");
  wsQ.columns = [
    { header: "colName", key: "colName", width: 40 },
    { header: "plantilla", key: "id_plantilla", width: 12 },
    { header: "seccion", key: "seccion", width: 30 },
    { header: "pregunta", key: "etiqueta", width: 45 },
  ];
  preguntaCols.forEach((q) =>
    wsQ.addRow({
      colName: q.colName,
      id_plantilla: q.id_plantilla,
      seccion: sanitizeForXLS(q.seccion),
      etiqueta: sanitizeForXLS(q.etiqueta),
    })
  );

  const wsInfo = wb.addWorksheet("info");
  wsInfo.addRow(["Proyecto", sanitizeForXLS(proyectoLabel)]);
  wsInfo.addRow(["Tipo Exportación", "diagnostico"]);
  wsInfo.addRow(["Fecha Generado", new Date()]);

  const fileName = `Diagnostico_Proyecto_${idProyecto}_${Date.now()}.xlsx`.replace(/[^\w\.-]/g, "_");
  return { workbook: wb, fileName };
}

async function sendWorkbook(res, workbook, fileName) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(buffer);
}

async function exportDiagnosticoProyectoExcel(req, res) {
  const idProyecto = parseInt(req.params.idProyecto, 10);
  if (!idProyecto || Number.isNaN(idProyecto)) {
    return res.status(400).json({ ok: false, error: "idProyecto inválido" });
  }

  const isPost = req.method === "POST";
  const rawSource = isPost ? (req.body || {}) : {};
  const rawPlantilla =
    (isPost ? rawSource.id_plantilla : null) ?? req.query.plantilla ?? req.query.id_plantilla ?? null;
  const idPlantilla = rawPlantilla ? parseInt(rawPlantilla, 10) : null;
  const selection = normalizeSelection(rawSource);

  const client = await pool.connect();
  try {
    const { workbook, fileName } = await buildDiagnosticoWorkbook({
      req,
      client,
      idProyecto,
      idPlantilla: Number.isFinite(idPlantilla) && idPlantilla > 0 ? idPlantilla : null,
      selection,
    });
    await sendWorkbook(res, workbook, fileName);
  } catch (err) {
    if (err?.status === 404) {
      return res.status(404).json({ ok: false, error: err.message });
    }
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
  exportDiagnosticoProyectoExcel,
};
