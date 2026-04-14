"use strict";

const projectHomeItemSvc = require("../services/projectHome/projectHomeItem.service");

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

function sendError(res, err) {
  const status = Number(err?.status) || 500;
  const message = err?.message || "Error interno";
  return res.status(status).json({ ok: false, error: message });
}

async function listItems(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    const include_legacy = toBool(req.query.include_legacy, false);
    if (!id_proyecto) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const items = await projectHomeItemSvc.getItemsByProject({
      req,
      id_proyecto,
      include_legacy,
    });
    return res.json({ ok: true, data: items });
  } catch (err) {
    return sendError(res, err);
  }
}

async function createItem(req, res) {
  try {
    const body = req.body || {};
    const data = {
      id_proyecto: body.id_proyecto,
      id_plantilla: body.id_plantilla,
      label: body.label,
      kpi_primary_field_id: body.kpi_primary_field_id,
      kpi_secondary_field_ids: body.kpi_secondary_field_ids,
      preferred_date_field_id: body.preferred_date_field_id,
      preferred_time_grouping: body.preferred_time_grouping,
      sort_order: body.sort_order,
      is_default: body.is_default === true,
    };

    const row = await projectHomeItemSvc.createItem(data);
    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    return sendError(res, err);
  }
}

async function updateItem(req, res) {
  try {
    const id_home_item = toInt(req.params.id_home_item, null);
    if (!id_home_item) {
      return res.status(400).json({ ok: false, error: "id invalido" });
    }

    const body = req.body || {};
    const data = {
      id_proyecto: body.id_proyecto,
      id_plantilla: body.id_plantilla,
      label: body.label,
      kpi_primary_field_id: body.kpi_primary_field_id,
      kpi_secondary_field_ids: body.kpi_secondary_field_ids,
      preferred_date_field_id: body.preferred_date_field_id,
      preferred_time_grouping: body.preferred_time_grouping,
    };

    const row = await projectHomeItemSvc.updateItem(id_home_item, data);
    return res.json({ ok: true, data: row });
  } catch (err) {
    return sendError(res, err);
  }
}

async function disableItem(req, res) {
  try {
    const id_home_item = toInt(req.params.id_home_item, null);
    if (!id_home_item) {
      return res.status(400).json({ ok: false, error: "id invalido" });
    }

    const row = await projectHomeItemSvc.disableItem(id_home_item);
    return res.json({ ok: true, data: row });
  } catch (err) {
    return sendError(res, err);
  }
}

async function reorderItems(req, res) {
  try {
    const body = req.body || {};
    const id_proyecto = toInt(body.id_proyecto, null);
    const items = body.items;

    const rows = await projectHomeItemSvc.reorderItems(id_proyecto, items);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    return sendError(res, err);
  }
}

async function setDefault(req, res) {
  try {
    const id_home_item = toInt(req.params.id_home_item, null);
    if (!id_home_item) {
      return res.status(400).json({ ok: false, error: "id invalido" });
    }

    const row = await projectHomeItemSvc.setDefaultItem(id_home_item);
    return res.json({ ok: true, data: row });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  listItems,
  createItem,
  updateItem,
  disableItem,
  reorderItems,
  setDefault,
};
