"use strict";

const { getPlantillaDashboardMetadata } = require("../../controllers/informesDashboardMetadata.controller");

function createJsonCaptureRes(resolve) {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolve({ statusCode: this.statusCode, payload });
      return payload;
    },
  };
  return res;
}

async function callController(controllerFn, req) {
  return await new Promise((resolve, reject) => {
    const res = createJsonCaptureRes(resolve);
    Promise.resolve(controllerFn(req, res)).catch(reject);
  });
}

function cmpNum(a, b) {
  const aa = Number.isFinite(a) ? a : 0;
  const bb = Number.isFinite(b) ? b : 0;
  return aa - bb;
}

/**
 * Builds selected_fields for Project Home (max 20), using plantilla metadata.
 * - eligible: pregunta.resultable === true OR pregunta.chartable === true
 * - prioritizes tipo === "semaforo" if present
 * - stable ordering by (seccion.orden, pregunta.orden, id_pregunta)
 */
async function getProjectHomeSelectedFields({ req, id_proyecto, id_plantilla }) {
  if (!id_plantilla) return [];

  const metaReq = {
    ...req,
    query: { id_proyecto },
    params: { ...(req.params || {}), idPlantilla: String(id_plantilla) },
  };

  const r = await callController(getPlantillaDashboardMetadata, metaReq);
  const meta = r.payload;
  if (r.statusCode >= 400 || !meta?.ok || !Array.isArray(meta.secciones)) return [];

  const eligibles = [];
  for (const sec of meta.secciones) {
    const secOrden = sec?.orden ?? 0;
    for (const p of Array.isArray(sec?.preguntas) ? sec.preguntas : []) {
      if (!p) continue;
      if (!p.resultable && !p.chartable) continue;

      const id = Number(p.id_pregunta);
      if (!Number.isFinite(id) || id <= 0) continue;

      eligibles.push({
        id,
        tipo: String(p.tipo || "").toLowerCase(),
        secOrden,
        pregOrden: p?.orden ?? 0,
      });
    }
  }

  // stable sort by location within plantilla
  eligibles.sort((a, b) => {
    if (a.secOrden !== b.secOrden) return cmpNum(a.secOrden, b.secOrden);
    if (a.pregOrden !== b.pregOrden) return cmpNum(a.pregOrden, b.pregOrden);
    return cmpNum(a.id, b.id);
  });

  const semaforos = [];
  const rest = [];
  const seen = new Set();

  for (const e of eligibles) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (e.tipo === "semaforo") semaforos.push(e.id);
    else rest.push(e.id);
  }

  return semaforos.concat(rest).slice(0, 20);
}

/**
 * Returns a minimal snapshot to validate admin config writes against real metadata.
 *
 * Output:
 * {
 *   eligible_kpi_field_ids: Set<number>,
 *   temporal_source_ids: Set<string>
 * }
 *
 * Rules:
 * - KPI-eligible (for this validation): pregunta.resultable === true OR pregunta.chartable === true
 * - temporal_source_ids: metadata.temporal_sources[].id
 */
async function getProjectHomePlantillaValidationData({ req, id_proyecto, id_plantilla }) {
  if (!id_plantilla) {
    return { eligible_kpi_field_ids: new Set(), temporal_source_ids: new Set(["__created_at"]) };
  }

  const metaReq = {
    ...req,
    query: { id_proyecto },
    params: { ...(req.params || {}), idPlantilla: String(id_plantilla) },
  };

  const r = await callController(getPlantillaDashboardMetadata, metaReq);
  const meta = r.payload;
  if (r.statusCode >= 400 || !meta?.ok) {
    const err = new Error("No se pudo cargar metadata de la plantilla");
    err.status = 400;
    throw err;
  }

  const eligible = new Set();
  for (const sec of Array.isArray(meta.secciones) ? meta.secciones : []) {
    for (const p of Array.isArray(sec?.preguntas) ? sec.preguntas : []) {
      if (!p) continue;
      if (!p.resultable && !p.chartable) continue;
      const id = Number(p.id_pregunta);
      if (!Number.isFinite(id) || id <= 0) continue;
      eligible.add(id);
    }
  }

  const temporalIds = new Set(["__created_at"]);
  for (const s of Array.isArray(meta.temporal_sources) ? meta.temporal_sources : []) {
    if (s?.id === undefined || s?.id === null) continue;
    const id = String(s.id);
    if (id) temporalIds.add(id);
  }

  return { eligible_kpi_field_ids: eligible, temporal_source_ids: temporalIds };
}

module.exports = { getProjectHomeSelectedFields, getProjectHomePlantillaValidationData };
