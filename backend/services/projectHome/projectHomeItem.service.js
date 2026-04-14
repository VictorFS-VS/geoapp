"use strict";

const pool = require("../../db");
const { getProjectHomeConfigWithFallback } = require("./projectHomeConfig.service");

async function tableExists(fqn) {
  const r = await pool.query("SELECT to_regclass($1) AS oid", [fqn]);
  return !!r.rows?.[0]?.oid;
}

function toInt(v, fallback = null) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTimeGrouping(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "day" || s === "week" || s === "month") return s;
  return null;
}

function normalizeDateFieldId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
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

async function ensureTableOrThrow() {
  if (!(await tableExists("ema.project_home_item"))) {
    const err = new Error("Tabla project_home_item no disponible");
    err.status = 500;
    throw err;
  }
}

function mapConstraintError(err) {
  const code = String(err?.code || "");
  const constraint = String(err?.constraint || "");
  if (code !== "23505") return err;

  if (constraint === "uq_project_home_item_active_template") {
    const mapped = new Error("Duplicado: ya existe item activo para la plantilla");
    mapped.status = 409;
    mapped.code = code;
    mapped.constraint = constraint;
    return mapped;
  }

  if (constraint === "uq_project_home_item_default") {
    const mapped = new Error("Conflicto al definir item default. Reintente.");
    mapped.status = 409;
    mapped.code = code;
    mapped.constraint = constraint;
    return mapped;
  }

  return err;
}

async function getItemsByProject({ req, id_proyecto, include_legacy = false } = {}) {
  const pid = toInt(id_proyecto, null);
  if (!pid) return [];
  if (!(await tableExists("ema.project_home_item"))) return [];

  const r = await pool.query(
    `
    SELECT i.*, p.nombre as plantilla_nombre
    FROM ema.project_home_item i
    LEFT JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    WHERE i.id_proyecto = $1
      AND i.item_type = 'informes'
      AND i.is_active = true
    ORDER BY i.sort_order ASC, i.id_home_item ASC
  `,
    [pid]
  );
  const rows = r.rows || [];

  if (!include_legacy) return rows;

  const resolved = await getProjectHomeConfigWithFallback({
    req,
    id_proyecto: pid,
    id_plantilla: null,
  });
  const effective = resolved?.effective_config || null;
  const legacyPlantillaId = toInt(effective?.id_plantilla, null);
  if (!legacyPlantillaId) return rows;

  const plantillaRes = await pool.query(
    `
    SELECT nombre
    FROM ema.informe_plantilla
    WHERE id_plantilla = $1
    LIMIT 1
  `,
    [legacyPlantillaId]
  );
  const plantillaNombre = plantillaRes.rows?.[0]?.nombre || `Plantilla ${legacyPlantillaId}`;
  const hasDefaultReal = rows.some((item) => item?.is_default === true);
  const virtualLegacy = {
    id_home_item: "legacy-base",
    item_type: "informes",
    source_kind: "legacy",
    is_virtual: true,
    is_active: true,
    is_default: !hasDefaultReal,
    label: null,
    id_plantilla: legacyPlantillaId,
    plantilla_nombre: plantillaNombre,
    kpi_primary_field_id: effective?.kpi_primary_field_id ?? null,
    kpi_secondary_field_ids: Array.isArray(effective?.kpi_secondary_field_ids)
      ? effective.kpi_secondary_field_ids
      : [],
    preferred_date_field_id: effective?.preferred_date_field_id ?? "__created_at",
    preferred_time_grouping: effective?.preferred_time_grouping ?? "week",
    sort_order: 0,
  };

  return [virtualLegacy, ...rows];
}

async function getItemById(id_home_item) {
  const id = toInt(id_home_item, null);
  if (!id) return null;
  if (!(await tableExists("ema.project_home_item"))) return null;

  const r = await pool.query(
    `
    SELECT i.*, p.nombre as plantilla_nombre
    FROM ema.project_home_item i
    LEFT JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    WHERE i.id_home_item = $1
    LIMIT 1
  `,
    [id]
  );
  return r.rows?.[0] || null;
}

async function getDefaultItem(id_proyecto) {
  const pid = toInt(id_proyecto, null);
  if (!pid) return null;
  if (!(await tableExists("ema.project_home_item"))) return null;

  const r = await pool.query(
    `
    SELECT i.*, p.nombre as plantilla_nombre
    FROM ema.project_home_item i
    LEFT JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
    WHERE i.id_proyecto = $1
      AND i.item_type = 'informes'
      AND i.is_active = true
      AND i.is_default = true
    ORDER BY i.sort_order ASC, i.id_home_item ASC
    LIMIT 1
  `,
    [pid]
  );
  return r.rows?.[0] || null;
}

async function createItem(data = {}) {
  await ensureTableOrThrow();

  const id_proyecto = toInt(data.id_proyecto, null);
  if (!id_proyecto) {
    const err = new Error("id_proyecto requerido");
    err.status = 400;
    throw err;
  }

  const id_plantilla = toInt(data.id_plantilla, null);
  if (!id_plantilla) {
    const err = new Error("id_plantilla requerido");
    err.status = 400;
    throw err;
  }

  const label = data.label === undefined || data.label === null || data.label === "" ? null : String(data.label);
  const sort_order = toInt(data.sort_order, 0) ?? 0;
  const is_default = data.is_default === true;

  const kpi_primary_field_id = data.kpi_primary_field_id === null ? null : toInt(data.kpi_primary_field_id, null);
  const kpi_secondary_field_ids = parseSecondaryIds(data.kpi_secondary_field_ids);
  const preferred_date_field_id = normalizeDateFieldId(data.preferred_date_field_id);
  const preferred_time_grouping = normalizeTimeGrouping(data.preferred_time_grouping);
  if (
    data.preferred_time_grouping !== undefined &&
    data.preferred_time_grouping !== null &&
    data.preferred_time_grouping !== "" &&
    !preferred_time_grouping
  ) {
    const err = new Error("preferred_time_grouping invalido");
    err.status = 400;
    throw err;
  }

  await pool.query("BEGIN");
  try {
    const dup = await pool.query(
      `
      SELECT 1
      FROM ema.project_home_item
      WHERE id_proyecto = $1
        AND item_type = 'informes'
        AND id_plantilla = $2::int
        AND is_active = true
      LIMIT 1
    `,
      [id_proyecto, id_plantilla]
    );

    if (dup.rowCount) {
      const err = new Error("Duplicado: ya existe item activo para la plantilla");
      err.status = 409;
      throw err;
    }

    if (is_default) {
      await pool.query(
        `
        UPDATE ema.project_home_item
           SET is_default = false,
               updated_at = now()
         WHERE id_proyecto = $1
           AND item_type = 'informes'
           AND is_active = true
           AND is_default = true
      `,
        [id_proyecto]
      );
    }

    const ins = await pool.query(
      `
      INSERT INTO ema.project_home_item (
        id_proyecto,
        item_type,
        label,
        id_plantilla,
        kpi_primary_field_id,
        kpi_secondary_field_ids,
        preferred_date_field_id,
        preferred_time_grouping,
        sort_order,
        is_active,
        is_default
      )
      VALUES (
        $1,
        'informes',
        $2,
        $3::int,
        $4::int,
        $5::jsonb,
        $6,
        $7,
        $8::int,
        true,
        $9
      )
      RETURNING *
    `,
      [
        id_proyecto,
        label,
        id_plantilla,
        kpi_primary_field_id,
        JSON.stringify(kpi_secondary_field_ids),
        preferred_date_field_id,
        preferred_time_grouping,
        sort_order,
        is_default,
      ]
    );

    await pool.query("COMMIT");
    return ins.rows?.[0] || null;
  } catch (e) {
    await pool.query("ROLLBACK");
    throw mapConstraintError(e);
  }
}

async function updateItem(id_home_item, data = {}) {
  await ensureTableOrThrow();

  const id = toInt(id_home_item, null);
  if (!id) {
    const err = new Error("id invalido");
    err.status = 400;
    throw err;
  }

  const current = await getItemById(id);
  if (!current || String(current.item_type) !== "informes") {
    const err = new Error("Item no encontrado");
    err.status = 404;
    throw err;
  }

  if (data.id_plantilla !== undefined) {
    const nextPlantilla = data.id_plantilla === null ? null : toInt(data.id_plantilla, null);
    const curPlantilla = current.id_plantilla === null ? null : toInt(current.id_plantilla, null);
    if (nextPlantilla !== curPlantilla) {
      const err = new Error("id_plantilla no es editable");
      err.status = 400;
      throw err;
    }
  }

  if (data.id_proyecto !== undefined) {
    const nextProyecto = toInt(data.id_proyecto, null);
    if (nextProyecto && Number(nextProyecto) !== Number(current.id_proyecto)) {
      const err = new Error("id_proyecto no es editable");
      err.status = 400;
      throw err;
    }
  }

  const label =
    data.label === undefined
      ? current.label ?? null
      : data.label === null || data.label === ""
      ? null
      : String(data.label);

  const kpi_primary_field_id =
    data.kpi_primary_field_id === undefined
      ? current.kpi_primary_field_id ?? null
      : data.kpi_primary_field_id === null
      ? null
      : toInt(data.kpi_primary_field_id, null);

  const kpi_secondary_field_ids =
    data.kpi_secondary_field_ids === undefined
      ? Array.isArray(current.kpi_secondary_field_ids)
        ? current.kpi_secondary_field_ids
        : []
      : parseSecondaryIds(data.kpi_secondary_field_ids);

  const preferred_date_field_id =
    data.preferred_date_field_id === undefined
      ? current.preferred_date_field_id ?? null
      : normalizeDateFieldId(data.preferred_date_field_id);

  const preferred_time_grouping =
    data.preferred_time_grouping === undefined
      ? current.preferred_time_grouping ?? null
      : normalizeTimeGrouping(data.preferred_time_grouping);

  if (
    data.preferred_time_grouping !== undefined &&
    data.preferred_time_grouping !== null &&
    data.preferred_time_grouping !== "" &&
    !preferred_time_grouping
  ) {
    const err = new Error("preferred_time_grouping invalido");
    err.status = 400;
    throw err;
  }

  const upd = await pool.query(
    `
    UPDATE ema.project_home_item
       SET label = $1,
           kpi_primary_field_id = $2::int,
           kpi_secondary_field_ids = $3::jsonb,
           preferred_date_field_id = $4,
           preferred_time_grouping = $5,
           updated_at = now()
     WHERE id_home_item = $6
     RETURNING *
  `,
    [
      label,
      kpi_primary_field_id,
      JSON.stringify(kpi_secondary_field_ids),
      preferred_date_field_id,
      preferred_time_grouping,
      id,
    ]
  );

  if (!upd.rowCount) {
    const err = new Error("Item no encontrado");
    err.status = 404;
    throw err;
  }

  return upd.rows[0];
}

async function disableItem(id_home_item) {
  await ensureTableOrThrow();

  const id = toInt(id_home_item, null);
  if (!id) {
    const err = new Error("id invalido");
    err.status = 400;
    throw err;
  }

  const upd = await pool.query(
    `
    UPDATE ema.project_home_item
       SET is_active = false,
           is_default = false,
           updated_at = now()
     WHERE id_home_item = $1
       AND item_type = 'informes'
     RETURNING *
  `,
    [id]
  );

  if (!upd.rowCount) {
    const err = new Error("Item no encontrado");
    err.status = 404;
    throw err;
  }

  return upd.rows[0];
}

async function reorderItems(id_proyecto, items = []) {
  await ensureTableOrThrow();

  const pid = toInt(id_proyecto, null);
  if (!pid) {
    const err = new Error("id_proyecto requerido");
    err.status = 400;
    throw err;
  }

  if (!Array.isArray(items)) {
    const err = new Error("items debe ser array");
    err.status = 400;
    throw err;
  }

  const cleaned = [];
  for (const row of items) {
    const id_home_item = toInt(row?.id_home_item, null);
    const sort_order = toInt(row?.sort_order, null);
    if (!id_home_item || sort_order === null) continue;
    cleaned.push({ id_home_item, sort_order });
  }

  await pool.query("BEGIN");
  try {
    for (const row of cleaned) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
        UPDATE ema.project_home_item
           SET sort_order = $1::int,
               updated_at = now()
         WHERE id_home_item = $2
           AND id_proyecto = $3
           AND item_type = 'informes'
           AND is_active = true
      `,
        [row.sort_order, row.id_home_item, pid]
      );
    }

    await pool.query("COMMIT");
    return await getItemsByProject({ id_proyecto: pid, include_legacy: false });
  } catch (e) {
    await pool.query("ROLLBACK");
    throw mapConstraintError(e);
  }
}

async function setDefaultItem(id_home_item) {
  await ensureTableOrThrow();

  const id = toInt(id_home_item, null);
  if (!id) {
    const err = new Error("id invalido");
    err.status = 400;
    throw err;
  }

  const item = await getItemById(id);
  if (!item || String(item.item_type) !== "informes" || item.is_active === false) {
    const err = new Error("Item no encontrado");
    err.status = 404;
    throw err;
  }

  await pool.query("BEGIN");
  try {
    await pool.query(
      `
      UPDATE ema.project_home_item
         SET is_default = false,
             updated_at = now()
       WHERE id_proyecto = $1
         AND item_type = 'informes'
         AND is_active = true
         AND is_default = true
    `,
      [Number(item.id_proyecto)]
    );

    const upd = await pool.query(
      `
      UPDATE ema.project_home_item
         SET is_default = true,
             updated_at = now()
       WHERE id_home_item = $1
         AND item_type = 'informes'
         AND is_active = true
       RETURNING *
    `,
      [id]
    );

    await pool.query("COMMIT");
    return upd.rows?.[0] || null;
  } catch (e) {
    await pool.query("ROLLBACK");
    throw mapConstraintError(e);
  }
}

module.exports = {
  getItemsByProject,
  getItemById,
  getDefaultItem,
  createItem,
  updateItem,
  disableItem,
  reorderItems,
  setDefaultItem,
};
