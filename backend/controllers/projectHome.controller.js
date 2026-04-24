"use strict";

const projectHomeInformes = require("../services/projectHome/projectHomeInformes.service");
const projectHomeExecutive = require("../services/projectHome/projectHomeExecutive.service");
const { getItemById } = require("../services/projectHome/projectHomeItem.service");

function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "t", "si", "s\u00ed", "y", "yes"].includes(s)) return true;
  if (["0", "false", "f", "no", "n"].includes(s)) return false;
  return fallback;
}

async function getResumen(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    const id_plantilla = toInt(req.query.id_plantilla, null);
    const id_home_item = toInt(req.query.id_home_item, null);
    const skip_temporal = toBool(req.query.skip_temporal, false);

    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    if (id_home_item) {
      const item = await getItemById(id_home_item);
      if (!item || Number(item.id_proyecto) !== Number(id_proyecto) || String(item.item_type) !== "informes") {
        return res.status(404).json({ ok: false, error: "Home item no encontrado" });
      }
      if (item.is_active === false) {
        return res.status(404).json({ ok: false, error: "Home item inactivo" });
      }

      const payload = await projectHomeInformes.getProjectHomeResumen({
        req,
        id_proyecto,
        id_plantilla: item.id_plantilla === null ? null : toInt(item.id_plantilla, null),
        homeItem: item,
        skip_temporal,
      });

      return res.json(payload);
    }

    const payload = await projectHomeInformes.getProjectHomeResumen({
      req,
      id_proyecto,
      id_plantilla,
      skip_temporal,
    });

    return res.json(payload);
  } catch (err) {
    const status = Number(err?.status) || 500;
    const msg = err?.message || "Error interno";
    if (status >= 500) console.error("projectHome.getResumen:", err);
    return res.status(status).json({ ok: false, error: msg });
  }
}

async function getExecutiveResumen(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const payload = await projectHomeExecutive.getProjectHomeExecutiveResumen({
      req,
      id_proyecto
    });

    return res.json(payload);
  } catch (err) {
    console.error("projectHome.getExecutiveResumen:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Error interno" });
  }
}

module.exports = { getResumen, getExecutiveResumen };
