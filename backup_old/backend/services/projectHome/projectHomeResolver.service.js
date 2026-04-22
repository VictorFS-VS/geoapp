"use strict";

const Proyecto = require("../../models/proyecto.model");
const projectHomeInformes = require("./projectHomeInformes.service");
const projectHomeKpiSelector = require("./projectHomeKpiSelector.service");

async function ensureProyectoExists(id_proyecto) {
  const p = await Proyecto.obtenerProyectoPorId(id_proyecto);
  if (!p) {
    const err = new Error("Proyecto no encontrado");
    err.status = 404;
    throw err;
  }
  return p;
}

async function buildResumen({ req, id_proyecto, id_plantilla = null }) {
  await ensureProyectoExists(id_proyecto);

  const informesResumen = await projectHomeInformes.getInformesResumen({
    req,
    id_proyecto,
    id_plantilla,
  });

  const selected = projectHomeKpiSelector.selectKpis(informesResumen.field_summaries);

  const temporal = informesResumen.temporal || {};
  const kpis = informesResumen.kpis || {};

  return {
    ok: true,
    source_mode: "auto",
    scope: {
      id_proyecto,
      id_plantilla,
    },
    general: {
      total_informes: Number(kpis.total_informes) || 0,
      informes_con_geo: Number(kpis.informes_con_geo) || 0,
      informes_sin_geo: Number(kpis.informes_sin_geo) || 0,
    },
    activity: {
      date_field_id: temporal.date_field_id || "__created_at",
      date_field_label: temporal.date_field_label || "Fecha creado",
      time_grouping: temporal.time_grouping || "week",
      range_from: temporal.absolute_min || null,
      range_to: temporal.absolute_max || null,
      period_total: Number(temporal.range_total) || 0,
    },
    kpis: {
      primary: selected.primary,
      secondary: selected.secondary,
    },
  };
}

module.exports = { buildResumen };

