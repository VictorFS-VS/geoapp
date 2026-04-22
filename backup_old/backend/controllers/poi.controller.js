// controllers/poi.controller.js  ✅ ACTUALIZADO (categorias + atributos dinámicos)
const pool = require("../db");

/* =========================
 * Helpers
 * ========================= */

// ✅ Feature flexible (si mañana agregás columnas, salen solas)
const toFeature = (row) => {
  const { geometry, geom, ...rest } = row; // evitamos duplicar
  return {
    type: "Feature",
    id: row.id,
    geometry: row.geometry,
    properties: {
      ...rest, // incluye categoria_obj, atributos, etc.
    },
  };
};

function parsePageLimit(req, defLimit = 50) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || `${defLimit}`, 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/* =========================
 * SQL base: trae POI + categoría resuelta + geometry
 * - Soporta esquema nuevo (categoria_id, atributos)
 * - Mantiene compatibilidad: si NO existe categoria_id en tu tabla,
 *   esto va a fallar. (Debés agregar esas columnas antes)
 * ========================= */
function sqlSelectPoi(whereSql) {
  return `
    SELECT
      p.*,
      p.atributos,
      jsonb_build_object(
        'id', c.id,
        'nombre', c.nombre,
        'slug', c.slug,
        'icon_type', c.icon_type,
        'icon_key', c.icon_key,
        'icon_url', c.icon_url,
        'color', c.color
      ) AS categoria_obj,
      COALESCE(
        ST_AsGeoJSON(p.geom)::json,
        CASE
          WHEN p.lat IS NOT NULL AND p.lng IS NOT NULL THEN
            ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))::json
          ELSE NULL
        END
      ) AS geometry
    FROM ema.poi_tramo p
    LEFT JOIN ema.poi_categoria c ON c.id = p.categoria_id
    ${whereSql}
  `;
}

/* =========================
 * GET /poi/:id  (uno)
 * ?format=geojson opcional
 * ========================= */
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;
    const asGeoJSON = String(req.query.format || "").toLowerCase() === "geojson";

    const q = sqlSelectPoi(`WHERE p.id = $1`);
    const { rows } = await pool.query(q, [Number(id)]);
    if (!rows.length) return res.status(404).json({ error: "POI no encontrado" });

    return asGeoJSON ? res.json(toFeature(rows[0])) : res.json(rows[0]);
  } catch (e) {
    console.error("poi.getOne:", e);
    res.status(500).json({ error: "Error al obtener POI", detalle: e.message });
  }
};

/* =========================
 * GET /poi/tramo/:id_tramo
 * ?format=geojson opcional
 * ========================= */
exports.getByTramo = async (req, res) => {
  try {
    const { id_tramo } = req.params;
    const asGeoJSON = String(req.query.format || "").toLowerCase() === "geojson";
    const { limit, offset, page } = parsePageLimit(req);

    const baseWhere = `WHERE p.id_tramo = $1`;

    const qData = `
      ${sqlSelectPoi(baseWhere)}
      ORDER BY p.titulo ASC
      LIMIT $2 OFFSET $3
    `;
    const qCount = `SELECT COUNT(*) AS total FROM ema.poi_tramo p ${baseWhere}`;

    const [{ rows }, countRes] = await Promise.all([
      pool.query(qData, [Number(id_tramo), limit, offset]),
      pool.query(qCount, [Number(id_tramo)]),
    ]);

    const paging = { page, limit, total: Number(countRes.rows[0].total) };

    if (asGeoJSON) {
      return res.json({
        type: "FeatureCollection",
        features: rows.map(toFeature),
        paging,
      });
    }
    return res.json({ data: rows, paging });
  } catch (e) {
    console.error("poi.getByTramo:", e);
    res.status(500).json({ error: "Error al listar POI del tramo", detalle: e.message });
  }
};

/* =========================
 * GET /poi/proyecto/:id_proyecto
 * ✅ Soporta:
 *   - ?tramo=all   (default) => todos
 *   - ?tramo=none  => POI libres (id_tramo IS NULL)
 *   - ?tramo=123   => POI de ese tramo
 * ?format=geojson opcional
 * ========================= */
exports.getByProyecto = async (req, res) => {
  try {
    const { id_proyecto } = req.params;
    const tramo = String(req.query.tramo || "all"); // all | none | <id>
    const asGeoJSON = String(req.query.format || "").toLowerCase() === "geojson";
    const { limit, offset, page } = parsePageLimit(req);

    let where = `p.id_proyecto = $1`;
    const params = [Number(id_proyecto)];

    if (tramo === "none") {
      where += ` AND p.id_tramo IS NULL`;
    } else if (tramo !== "all") {
      where += ` AND p.id_tramo = $2`;
      params.push(parseInt(tramo, 10));
    }

    const baseWhere = `WHERE ${where}`;

    const qData = `
      ${sqlSelectPoi(baseWhere)}
      ORDER BY COALESCE(p.id_tramo, 0), p.titulo ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const qCount = `SELECT COUNT(*) AS total FROM ema.poi_tramo p ${baseWhere}`;

    const [{ rows }, countRes] = await Promise.all([
      pool.query(qData, [...params, limit, offset]),
      pool.query(qCount, params),
    ]);

    const paging = { page, limit, total: Number(countRes.rows[0].total) };

    if (asGeoJSON) {
      return res.json({
        type: "FeatureCollection",
        features: rows.map(toFeature),
        paging,
      });
    }
    return res.json({ data: rows, paging });
  } catch (e) {
    console.error("poi.getByProyecto:", e);
    res.status(500).json({ error: "Error al listar POI del proyecto", detalle: e.message });
  }
};

/* =========================
 * POST /poi  (crear)
 * Body (nuevo):
 *  {
 *    id_proyecto, id_tramo? (null),
 *    categoria_id?,         // ✅ nuevo
 *    categoria?,            // legacy opcional (si aún lo usás)
 *    titulo, descripcion?, foto_url?, fuente?,
 *    lat, lng,
 *    atributos?             // ✅ json con campos nuevos
 *  }
 * ========================= */
exports.create = async (req, res) => {
  try {
    const {
      id_proyecto,
      id_tramo = null,
      categoria_id = null,   // ✅ nuevo
      categoria = null,      // legacy opcional
      titulo,
      descripcion = null,
      foto_url = null,
      fuente = null,
      lat,
      lng,
      atributos = {},        // ✅ nuevo
    } = req.body;

    if (!id_proyecto || !titulo) {
      return res.status(400).json({ error: "id_proyecto y titulo son obligatorios" });
    }

    const _lat = parseFloat(lat);
    const _lng = parseFloat(lng);
    if (Number.isNaN(_lat) || Number.isNaN(_lng)) {
      return res.status(400).json({ error: "lat/lng inválidos (WGS84)" });
    }

    // ✅ Si mandan categoria_id, usamos ese.
    // ✅ Si NO mandan categoria_id pero mandan categoria (legacy),
    //    intentamos encontrar/crear categoria en ema.poi_categoria.
    let catId = categoria_id ? Number(categoria_id) : null;

    if (!catId && categoria) {
      const nombre = String(categoria).trim();
      const slug = nombre
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const upsertCat = `
        INSERT INTO ema.poi_categoria (nombre, slug, icon_type, icon_key, color)
        VALUES ($1,$2,'builtin','marker','#6c757d')
        ON CONFLICT (nombre) DO UPDATE SET nombre=EXCLUDED.nombre
        RETURNING id
      `;
      const catRes = await pool.query(upsertCat, [nombre, slug]);
      catId = catRes.rows[0]?.id || null;
    }

    const q = `
      INSERT INTO ema.poi_tramo (
        id_proyecto, id_tramo,
        categoria_id,
        titulo, descripcion, foto_url, fuente,
        lat, lng,
        atributos
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      RETURNING id
    `;

    const { rows } = await pool.query(q, [
      Number(id_proyecto),
      id_tramo === null || id_tramo === "" ? null : Number(id_tramo),
      catId,
      titulo,
      descripcion,
      foto_url,
      fuente,
      _lat,
      _lng,
      JSON.stringify(atributos || {}),
    ]);

    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    console.error("poi.create:", e);
    res.status(500).json({ error: "Error al crear POI", detalle: e.message });
  }
};

/* =========================
 * PUT /poi/:id  (actualizar)
 * Body: campos a actualizar
 * - soporta categoria_id y atributos (merge)
 * ========================= */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      id_proyecto,
      id_tramo,
      categoria_id,   // ✅ nuevo
      categoria,      // legacy opcional
      titulo,
      descripcion,
      foto_url,
      fuente,
      lat,
      lng,
      atributos,      // ✅ nuevo (merge)
    } = req.body;

    const sets = [];
    const params = [];
    let i = 1;

    if (id_proyecto !== undefined) {
      sets.push(`id_proyecto=$${i++}`);
      params.push(Number(id_proyecto));
    }

    if (id_tramo !== undefined) {
      sets.push(`id_tramo=$${i++}`);
      params.push(id_tramo === null || id_tramo === "" ? null : Number(id_tramo));
    }

    // ✅ categoria_id directo
    if (categoria_id !== undefined) {
      sets.push(`categoria_id=$${i++}`);
      params.push(categoria_id === null || categoria_id === "" ? null : Number(categoria_id));
    }

    // ✅ legacy: si mandan "categoria" texto y NO mandan categoria_id,
    //    intentamos resolver/crear en poi_categoria y setear categoria_id.
    if (categoria !== undefined && (categoria_id === undefined)) {
      if (categoria === null || String(categoria).trim() === "") {
        sets.push(`categoria_id=$${i++}`);
        params.push(null);
      } else {
        const nombre = String(categoria).trim();
        const slug = nombre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        const upsertCat = `
          INSERT INTO ema.poi_categoria (nombre, slug, icon_type, icon_key, color)
          VALUES ($1,$2,'builtin','marker','#6c757d')
          ON CONFLICT (nombre) DO UPDATE SET nombre=EXCLUDED.nombre
          RETURNING id
        `;
        const catRes = await pool.query(upsertCat, [nombre, slug]);
        const catId = catRes.rows[0]?.id || null;

        sets.push(`categoria_id=$${i++}`);
        params.push(catId);
      }
    }

    if (titulo !== undefined) {
      sets.push(`titulo=$${i++}`);
      params.push(titulo);
    }
    if (descripcion !== undefined) {
      sets.push(`descripcion=$${i++}`);
      params.push(descripcion);
    }
    if (foto_url !== undefined) {
      sets.push(`foto_url=$${i++}`);
      params.push(foto_url);
    }
    if (fuente !== undefined) {
      sets.push(`fuente=$${i++}`);
      params.push(fuente);
    }

    // ✅ lat/lng
    if (lat !== undefined && lng !== undefined) {
      const _lat = parseFloat(lat);
      const _lng = parseFloat(lng);
      if (Number.isNaN(_lat) || Number.isNaN(_lng)) {
        return res.status(400).json({ error: "lat/lng inválidos" });
      }
      sets.push(`lat=$${i++}`);
      params.push(_lat);
      sets.push(`lng=$${i++}`);
      params.push(_lng);
    }

    // ✅ atributos dinámicos: merge (no pisa todo)
    if (atributos !== undefined) {
      sets.push(`atributos = COALESCE(atributos,'{}'::jsonb) || $${i++}::jsonb`);
      params.push(JSON.stringify(atributos || {}));
    }

    if (!sets.length) return res.json({ ok: true, updated: 0 });

    const q = `UPDATE ema.poi_tramo SET ${sets.join(", ")} WHERE id=$${i} RETURNING id`;
    params.push(Number(id));

    const { rows } = await pool.query(q, params);
    return res.json({ ok: true, id: rows[0]?.id || null });
  } catch (e) {
    console.error("poi.update:", e);
    res.status(500).json({ error: "Error al actualizar POI", detalle: e.message });
  }
};

/* =========================
 * DELETE /poi/:id
 * ========================= */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM ema.poi_tramo WHERE id=$1`, [Number(id)]);
    res.json({ ok: true });
  } catch (e) {
    console.error("poi.remove:", e);
    res.status(500).json({ error: "Error al eliminar POI", detalle: e.message });
  }
};
