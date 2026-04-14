"use strict";

const pool = require("../db");
const {
  getProjectHomeConfigWithFallback,
} = require("../services/projectHome/projectHomeConfig.service");
const {
  getProjectHomePlantillaValidationData,
} = require("../services/projectHome/projectHomeMetadata.service");

function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTimeGrouping(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "day" || s === "week" || s === "month") return s;
  return null;
}

function parseSecondaryIds(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    const err = new Error("kpi_secondary_field_ids debe ser array");
    err.status = 400;
    throw err;
  }
  const ids = Array.from(
    new Set(
      v
        .map((x) => toInt(x, null))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  if (ids.length > 2) {
    const err = new Error("kpi_secondary_field_ids excede el maximo (2)");
    err.status = 400;
    throw err;
  }
  return ids;
}

async function validateWriteAgainstMetadata({
  req,
  id_proyecto,
  id_plantilla,
  kpi_primary_field_id,
  kpi_secondary_field_ids,
  preferred_date_field_id,
}) {
  // If no plantilla: do not allow KPI fields; only allow created_at temporal (or null).
  if (id_plantilla === null) {
    if (kpi_primary_field_id) {
      const err = new Error("kpi_primary_field_id no permitido sin id_plantilla");
      err.status = 400;
      throw err;
    }
    if (Array.isArray(kpi_secondary_field_ids) && kpi_secondary_field_ids.length) {
      const err = new Error("kpi_secondary_field_ids no permitido sin id_plantilla");
      err.status = 400;
      throw err;
    }

    if (preferred_date_field_id && preferred_date_field_id !== "__created_at") {
      const err = new Error("preferred_date_field_id invalido sin id_plantilla");
      err.status = 400;
      throw err;
    }

    return;
  }

  const v = await getProjectHomePlantillaValidationData({
    req,
    id_proyecto,
    id_plantilla,
  });

  if (kpi_primary_field_id && !v.eligible_kpi_field_ids.has(Number(kpi_primary_field_id))) {
    const err = new Error("kpi_primary_field_id invalido para la plantilla");
    err.status = 400;
    throw err;
  }

  const sec = Array.isArray(kpi_secondary_field_ids) ? kpi_secondary_field_ids : [];
  if (kpi_primary_field_id && sec.includes(Number(kpi_primary_field_id))) {
    const err = new Error("kpi_secondary_field_ids no puede duplicar primary");
    err.status = 400;
    throw err;
  }
  for (const id of sec) {
    if (!v.eligible_kpi_field_ids.has(Number(id))) {
      const err = new Error("kpi_secondary_field_ids contiene ids invalidos para la plantilla");
      err.status = 400;
      throw err;
    }
  }

  if (preferred_date_field_id && preferred_date_field_id !== "__created_at") {
    if (!v.temporal_source_ids.has(String(preferred_date_field_id))) {
      const err = new Error("preferred_date_field_id no existe en temporal_sources");
      err.status = 400;
      throw err;
    }
  }
}

async function getConfig(req, res) {
  try {
    const id_proyecto = toInt(req.query.id_proyecto, null);
    const id_plantilla = toInt(req.query.id_plantilla, null);
    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const resolved = await getProjectHomeConfigWithFallback({
      req,
      id_proyecto,
      id_plantilla,
    });
    return res.json({
      ok: true,
      config: resolved?.config ?? null,
      effective_config: resolved?.effective_config ?? null,
      source_mode: resolved?.source_mode || "auto",
    });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("projectHomeConfig.getConfig:", err);
    return res.status(status).json({ ok: false, error: err?.message || "Error interno" });
  }
}

async function createConfig(req, res) {
  try {
    const b = req.body || {};

    const id_proyecto = toInt(b.id_proyecto, null);
    const id_plantilla = b.id_plantilla === null ? null : toInt(b.id_plantilla, null);
    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const kpi_primary_field_id = b.kpi_primary_field_id === null ? null : toInt(b.kpi_primary_field_id, null);
    const kpi_secondary_field_ids = parseSecondaryIds(b.kpi_secondary_field_ids);
    const preferred_date_field_id =
      b.preferred_date_field_id === undefined || b.preferred_date_field_id === null || b.preferred_date_field_id === ""
        ? null
        : String(b.preferred_date_field_id).trim();
    const preferred_time_grouping = normalizeTimeGrouping(b.preferred_time_grouping);

    // If provided but invalid, reject (controller validation).
    if (b.preferred_time_grouping !== undefined && b.preferred_time_grouping !== null && b.preferred_time_grouping !== "") {
      if (!preferred_time_grouping) {
        return res.status(400).json({ ok: false, error: "preferred_time_grouping invalido" });
      }
    }

    const is_active = b.is_active === undefined ? true : Boolean(b.is_active);
    const uid = toInt(req.user?.id, null);

    await validateWriteAgainstMetadata({
      req,
      id_proyecto,
      id_plantilla,
      kpi_primary_field_id,
      kpi_secondary_field_ids,
      preferred_date_field_id,
    });

    await pool.query("BEGIN");
    try {
      if (is_active) {
        // Ensure only one active config per (id_proyecto, id_plantilla)
        await pool.query(
          `
          UPDATE ema.project_home_config
             SET is_active = false,
                 updated_at = now(),
                 updated_by = $3
           WHERE id_proyecto = $1
             AND (
               ($2::int IS NULL AND id_plantilla IS NULL)
               OR (id_plantilla = $2::int)
             )
             AND is_active = true
        `,
          [id_proyecto, id_plantilla, uid]
        );
      }

      const ins = await pool.query(
        `
        INSERT INTO ema.project_home_config
          (id_proyecto, id_plantilla, kpi_primary_field_id, kpi_secondary_field_ids, preferred_date_field_id, preferred_time_grouping,
           is_active, created_by, updated_by)
        VALUES
          ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8)
        RETURNING *
      `,
        [
          id_proyecto,
          id_plantilla,
          kpi_primary_field_id,
          JSON.stringify(kpi_secondary_field_ids),
          preferred_date_field_id,
          preferred_time_grouping,
          is_active,
          uid,
        ]
      );

      await pool.query("COMMIT");
      return res.status(201).json({ ok: true, config: ins.rows[0] });
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("projectHomeConfig.createConfig:", err);
    return res.status(status).json({ ok: false, error: err?.message || "Error interno" });
  }
}

async function updateConfig(req, res) {
  try {
    const id_home_config = toInt(req.params.id, null);
    if (!id_home_config) return res.status(400).json({ ok: false, error: "id invalido" });

    const b = req.body || {};
    const id_proyecto = toInt(b.id_proyecto, null);
    const id_plantilla = b.id_plantilla === null ? null : toInt(b.id_plantilla, null);
    if (!id_proyecto || id_proyecto <= 0) {
      return res.status(400).json({ ok: false, error: "id_proyecto requerido" });
    }

    const kpi_primary_field_id = b.kpi_primary_field_id === null ? null : toInt(b.kpi_primary_field_id, null);
    const kpi_secondary_field_ids = parseSecondaryIds(b.kpi_secondary_field_ids);
    const preferred_date_field_id =
      b.preferred_date_field_id === undefined || b.preferred_date_field_id === null || b.preferred_date_field_id === ""
        ? null
        : String(b.preferred_date_field_id).trim();
    const preferred_time_grouping = normalizeTimeGrouping(b.preferred_time_grouping);

    if (b.preferred_time_grouping !== undefined && b.preferred_time_grouping !== null && b.preferred_time_grouping !== "") {
      if (!preferred_time_grouping) {
        return res.status(400).json({ ok: false, error: "preferred_time_grouping invalido" });
      }
    }

    const is_active = b.is_active === undefined ? true : Boolean(b.is_active);
    const uid = toInt(req.user?.id, null);

    await validateWriteAgainstMetadata({
      req,
      id_proyecto,
      id_plantilla,
      kpi_primary_field_id,
      kpi_secondary_field_ids,
      preferred_date_field_id,
    });

    await pool.query("BEGIN");
    try {
      if (is_active) {
        await pool.query(
          `
          UPDATE ema.project_home_config
             SET is_active = false,
                 updated_at = now(),
                 updated_by = $3
           WHERE id_proyecto = $1
             AND (
               ($2::int IS NULL AND id_plantilla IS NULL)
               OR (id_plantilla = $2::int)
             )
             AND is_active = true
             AND id_home_config <> $4
        `,
          [id_proyecto, id_plantilla, uid, id_home_config]
        );
      }

      const upd = await pool.query(
        `
        UPDATE ema.project_home_config
           SET id_proyecto = $1,
               id_plantilla = $2,
               kpi_primary_field_id = $3,
               kpi_secondary_field_ids = $4::jsonb,
               preferred_date_field_id = $5,
               preferred_time_grouping = $6,
               is_active = $7,
               updated_at = now(),
               updated_by = $8
         WHERE id_home_config = $9
         RETURNING *
      `,
        [
          id_proyecto,
          id_plantilla,
          kpi_primary_field_id,
          JSON.stringify(kpi_secondary_field_ids),
          preferred_date_field_id,
          preferred_time_grouping,
          is_active,
          uid,
          id_home_config,
        ]
      );

      if (!upd.rowCount) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Config no encontrada" });
      }

      await pool.query("COMMIT");
      return res.json({ ok: true, config: upd.rows[0] });
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("projectHomeConfig.updateConfig:", err);
    return res.status(status).json({ ok: false, error: err?.message || "Error interno" });
  }
}

async function disableConfig(req, res) {
  try {
    const id_home_config = toInt(req.params.id, null);
    if (!id_home_config) return res.status(400).json({ ok: false, error: "id invalido" });

    const uid = toInt(req.user?.id, null);
    const upd = await pool.query(
      `
      UPDATE ema.project_home_config
         SET is_active = false,
             updated_at = now(),
             updated_by = $2
       WHERE id_home_config = $1
       RETURNING *
    `,
      [id_home_config, uid]
    );

    if (!upd.rowCount) return res.status(404).json({ ok: false, error: "Config no encontrada" });
    return res.json({ ok: true, config: upd.rows[0] });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("projectHomeConfig.disableConfig:", err);
    return res.status(status).json({ ok: false, error: err?.message || "Error interno" });
  }
}

module.exports = { getConfig, createConfig, updateConfig, disableConfig };
