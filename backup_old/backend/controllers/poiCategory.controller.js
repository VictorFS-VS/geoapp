// controllers/poiCategory.controller.js
const pool = require("../db");

function slugify(str = "") {
  return String(str)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* =========================
 * GET /poi-categorias
 * ?activa=true|false|all
 * ========================= */
exports.list = async (req, res) => {
  try {
    const activa = String(req.query.activa || "true").toLowerCase();
    let where = "";
    const params = [];

    if (activa === "true") {
      where = "WHERE activo = true";
    } else if (activa === "false") {
      where = "WHERE activo = false";
    } // "all" => sin where

    const q = `
      SELECT id, nombre, slug, icon_type, icon_key, icon_url, color, activo, created_at
      FROM ema.poi_categoria
      ${where}
      ORDER BY nombre ASC
    `;
    const { rows } = await pool.query(q, params);
    res.json({ data: rows });
  } catch (e) {
    console.error("poiCategory.list:", e);
    res.status(500).json({ error: "Error al listar categorías", detalle: e.message });
  }
};

/* =========================
 * POST /poi-categorias
 * Body: { nombre, icon_type?, icon_key?, icon_url?, color?, activo? }
 * ========================= */
exports.create = async (req, res) => {
  try {
    const {
      nombre,
      icon_type = "builtin",
      icon_key = "marker",
      icon_url = null,
      color = "#6c757d",
      activo = true,
    } = req.body || {};

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: "nombre es requerido" });
    }

    const slug = slugify(nombre);

    const q = `
      INSERT INTO ema.poi_categoria (nombre, slug, icon_type, icon_key, icon_url, color, activo)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (nombre) DO UPDATE
        SET slug = EXCLUDED.slug
      RETURNING id
    `;
    const { rows } = await pool.query(q, [String(nombre).trim(), slug, icon_type, icon_key, icon_url, color, !!activo]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    console.error("poiCategory.create:", e);
    res.status(500).json({ error: "Error al crear categoría", detalle: e.message });
  }
};

/* =========================
 * PUT /poi-categorias/:id
 * ========================= */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      icon_type,
      icon_key,
      icon_url,
      color,
      activo,
    } = req.body || {};

    const sets = [];
    const params = [];
    let i = 1;

    if (nombre !== undefined) {
      const n = String(nombre || "").trim();
      if (!n) return res.status(400).json({ error: "nombre no puede ser vacío" });
      sets.push(`nombre=$${i++}`);
      params.push(n);

      sets.push(`slug=$${i++}`);
      params.push(slugify(n));
    }
    if (icon_type !== undefined) { sets.push(`icon_type=$${i++}`); params.push(icon_type); }
    if (icon_key !== undefined)  { sets.push(`icon_key=$${i++}`);  params.push(icon_key); }
    if (icon_url !== undefined)  { sets.push(`icon_url=$${i++}`);  params.push(icon_url); }
    if (color !== undefined)     { sets.push(`color=$${i++}`);     params.push(color); }
    if (activo !== undefined)    { sets.push(`activo=$${i++}`);    params.push(!!activo); }

    if (!sets.length) return res.json({ ok: true, updated: 0 });

    const q = `UPDATE ema.poi_categoria SET ${sets.join(", ")} WHERE id=$${i} RETURNING id`;
    params.push(Number(id));

    const { rows } = await pool.query(q, params);
    res.json({ ok: true, id: rows[0]?.id || null });
  } catch (e) {
    console.error("poiCategory.update:", e);
    res.status(500).json({ error: "Error al actualizar categoría", detalle: e.message });
  }
};

/* =========================
 * DELETE /poi-categorias/:id
 * - (simple) borra categoría
 * - si querés “soft delete”, usá update activo=false
 * ========================= */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM ema.poi_categoria WHERE id=$1`, [Number(id)]);
    res.json({ ok: true });
  } catch (e) {
    console.error("poiCategory.remove:", e);
    res.status(500).json({ error: "Error al eliminar categoría", detalle: e.message });
  }
};
