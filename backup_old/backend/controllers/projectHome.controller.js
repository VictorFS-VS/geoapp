"use strict";

const projectHomeInformes = require("../services/projectHome/projectHomeInformes.service");

function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function getResumen(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    const id_plantilla = toInt(req.query.id_plantilla, null);

    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const payload = await projectHomeInformes.getProjectHomeResumen({
      req,
      id_proyecto,
      id_plantilla,
    });

    return res.json(payload);
  } catch (err) {
    const status = Number(err?.status) || 500;
    const msg = err?.message || "Error interno";
    if (status >= 500) console.error("projectHome.getResumen:", err);
    return res.status(status).json({ ok: false, error: msg });
  }
}

module.exports = { getResumen };
