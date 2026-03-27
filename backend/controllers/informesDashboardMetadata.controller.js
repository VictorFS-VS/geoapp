"use strict";

const pool = require("../db");
const { buildInformeVisibleScope } = require("../helpers/informesDashboardScope");
const {
  collectFieldTemporalStats,
  collectCreatedAtTemporalStats,
  buildTemporalCapabilities,
} = require("../helpers/informesDashboardTemporal");
const { getTemporalBehaviorForFieldId } = require("../services/projectHome/projectHomeTemporalBehavior.service");

function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normType(t) {
  return String(t || "").trim().toLowerCase();
}

function isFilterableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  if (t.includes("mapa") || t.includes("coord")) return false;
  if (t.includes("imagen") || t.includes("foto") || t.includes("archivo") || t.includes("upload")) return false;
  if (t.includes("json")) return false;
  if (t.includes("numero") || t.includes("num") || t.includes("decimal") || t.includes("rango")) return false;
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "multi",
    "multiselect",
    "check",
    "checkbox",
    "bool",
    "boolean",
    "si_no",
    "sino",
    "yesno",
    "texto",
    "text",
    "textarea",
  ].includes(t);
}

function isSearchableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  if (t.includes("mapa") || t.includes("coord")) return false;
  if (t.includes("imagen") || t.includes("foto") || t.includes("archivo") || t.includes("upload")) return false;
  if (t.includes("json")) return false;
  if (t.includes("fecha") || t === "date" || t === "datetime") return false;
  if (t.includes("numero") || t.includes("num") || t.includes("decimal") || t.includes("rango")) return false;
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "semaforo",
    "bool",
    "boolean",
    "si_no",
    "sino",
    "yesno",
    "texto",
    "text",
    "textarea",
    "string",
  ].includes(t);
}

function isStructuredFilterableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "semaforo",
    "bool",
    "boolean",
    "si_no",
    "sino",
    "yesno",
  ].includes(t);
}

function isChartableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  if (t.includes("mapa") || t.includes("coord")) return false;
  if (t.includes("imagen") || t.includes("foto") || t.includes("archivo") || t.includes("upload")) return false;
  if (t.includes("json")) return false;
  if (t.includes("numero") || t.includes("num") || t.includes("decimal") || t.includes("rango")) return false;
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "semaforo",
    "bool",
    "boolean",
    "si_no",
    "sino",
    "yesno",
  ].includes(t);
}

function isDateableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  return [
    "fecha",
    "date",
    "datetime",
    "fecha_hora",
    "timestamp",
  ].includes(t);
}

function isResultableType(tipo) {
  const t = normType(tipo);
  if (!t) return false;
  return [
    "select",
    "combo",
    "opcion",
    "opciones",
    "radio",
    "semaforo",
    "bool",
    "boolean",
    "si_no",
    "sino",
    "yesno",
  ].includes(t);
}

function resultAvailabilityLabel({ resultable, filterable }) {
  if (resultable) return "Disponible para resultado";
  if (filterable) return "Solo filtro";
  return "No disponible en esta version";
}

async function getPlantillaDashboardMetadata(req, res) {
  const id_proyecto = toInt(req.query.id_proyecto, null);
  const idPlantilla = toInt(req.params.idPlantilla, null);

  if (!id_proyecto) {
    return res.status(400).json({ ok: false, error: "id_proyecto es requerido" });
  }
  if (!idPlantilla) {
    return res.status(400).json({ ok: false, error: "id_plantilla inválida" });
  }

  const { id: userId, tipo_usuario } = req.user || {};
  const isAdmin = Number(tipo_usuario) === 1;

  try {
    const baseParams = [id_proyecto, idPlantilla];
    const scope = buildInformeVisibleScope({
      userId,
      isAdmin,
      plantillaId: null,
      startIndex: baseParams.length + 1,
    });
    const params = baseParams.concat(scope.params);

    const qScope = `
      SELECT 1
      FROM ema.informe i
      JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
       AND pu.id_usuario = $${scope.userParamIndex}
      WHERE i.id_proyecto = $1
        AND i.id_plantilla = $2
      ${scope.whereSql}
      LIMIT 1
    `;

    const scopeRes = await pool.query(qScope, params);
    if (!scopeRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Plantilla no visible en el proyecto" });
    }

    const plRes = await pool.query(
      `
      SELECT id_plantilla, nombre, descripcion, activo, id_creador
      FROM ema.informe_plantilla
      WHERE id_plantilla = $1
      `,
      [idPlantilla]
    );

    if (!plRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Plantilla no encontrada" });
    }

    const seccionesRes = await pool.query(
      `
      SELECT id_seccion, titulo, orden, visible_if
      FROM ema.informe_seccion
      WHERE id_plantilla = $1
      ORDER BY orden ASC, id_seccion ASC
      `,
      [idPlantilla]
    );

    const preguntasRes = await pool.query(
      `
      SELECT id_pregunta, id_seccion, etiqueta, tipo, orden, opciones_json, obligatorio, permite_foto
      FROM ema.informe_pregunta
      WHERE id_seccion = ANY($1::int[])
      ORDER BY id_seccion ASC, orden ASC, id_pregunta ASC
      `,
      [seccionesRes.rows.map((s) => s.id_seccion)]
    );

    const preguntasBySeccion = new Map();
    const dateableFields = [];
    for (const q of preguntasRes.rows || []) {
      const dateable = isDateableType(q.tipo);
      const searchable = isSearchableType(q.tipo);
      const filterable = isFilterableType(q.tipo);
      const structuredFilterable = isStructuredFilterableType(q.tipo);
      const resultable = isResultableType(q.tipo);
      const list = preguntasBySeccion.get(q.id_seccion) || [];
      list.push({
        id_pregunta: Number(q.id_pregunta),
        etiqueta: q.etiqueta || `Pregunta ${q.id_pregunta}`,
        tipo: q.tipo,
        orden: q.orden ?? null,
        opciones: Array.isArray(q.opciones_json) ? q.opciones_json : [],
        obligatorio: !!q.obligatorio,
        permite_foto: !!q.permite_foto,
        filterable,
        structured_filterable: structuredFilterable,
        searchable,
        chartable: isChartableType(q.tipo),
        resultable,
        dateable,
        availability_label: resultAvailabilityLabel({
          resultable,
          filterable,
        }),
      });
      preguntasBySeccion.set(q.id_seccion, list);

      if (dateable) {
        dateableFields.push({
          id_pregunta: Number(q.id_pregunta),
          label: q.etiqueta || `Pregunta ${q.id_pregunta}`,
        });
      }
    }

    const baseParamsWithScope = baseParams.concat(scope.params);
    const baseQuery = `
      SELECT
        i.id_informe,
        i.fecha_creado::date AS created_date
      FROM ema.informe i
      JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
      LEFT JOIN ema.informe_plantilla_usuario pu
        ON pu.id_plantilla = p.id_plantilla
        AND pu.id_usuario = $${scope.userParamIndex}
      WHERE i.id_proyecto = $1
        AND i.id_plantilla = $2
      ${scope.whereSql}
    `;
    const [fieldStats, createdAtStats] = await Promise.all([
      collectFieldTemporalStats(pool, baseQuery, baseParamsWithScope, dateableFields.map((f) => f.id_pregunta)),
      collectCreatedAtTemporalStats(pool, baseQuery, baseParamsWithScope),
    ]);

    const temporalSources = [];
    const createdAtCapabilities = buildTemporalCapabilities(createdAtStats);
    temporalSources.push({
      id: "__created_at",
      label: "Fecha de carga",
      kind: "created_at",
      dateable: true,
      default: true,
      temporal_behavior: getTemporalBehaviorForFieldId("__created_at"),
      ...createdAtCapabilities,
    });
    for (const field of dateableFields) {
      const stats = fieldStats.get(field.id_pregunta) || {};
      temporalSources.push({
        id: field.id_pregunta,
        label: field.label,
        kind: "field",
        dateable: true,
        default: false,
        temporal_behavior: getTemporalBehaviorForFieldId(field.id_pregunta),
        ...buildTemporalCapabilities(stats),
      });
    }

    const secciones = (seccionesRes.rows || []).map((s) => ({
      id_seccion: Number(s.id_seccion),
      nombre: s.titulo || "Sin sección",
      orden: s.orden ?? null,
      visible_if: s.visible_if ?? null,
      preguntas: preguntasBySeccion.get(s.id_seccion) || [],
    }));

    return res.json({
      ok: true,
      plantilla: {
        id_plantilla: Number(plRes.rows[0].id_plantilla),
        nombre: plRes.rows[0].nombre,
        descripcion: plRes.rows[0].descripcion ?? null,
        activo: plRes.rows[0].activo !== false,
        id_creador: plRes.rows[0].id_creador ?? null,
        id_proyecto,
      },
      secciones,
      temporal_sources: temporalSources,
    });
  } catch (err) {
    console.error("getPlantillaDashboardMetadata:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

module.exports = { getPlantillaDashboardMetadata };
