// controllers/resoluciones.controller.js
const pool = require('../db');

/* ============ Helpers ============ */
function toInt(v, def = null) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function normText(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s.slice(0, max) : null;
}
function normDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function sqlLikeOrEq(col, val) {
  // si es numérico: igualdad, si es texto: ILIKE
  return typeof val === 'number'
    ? { clause: `${col} = $X`, value: val }
    : { clause: `${col} ILIKE $X`, value: `%${val}%` };
}

/* ============ Listado global / paginado ============ */
/**
 * GET /api/resoluciones?search=&page=1&limit=20&proyecto=123
 * - search busca en nro_resolucion, gestion_resolucion, observacion
 * - proyecto filtra por id_proyecto
 */
async function listarResoluciones(req, res) {
  try {
    const page  = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const off   = (page - 1) * limit;

    const filtros = [];
    const params  = [];
    let i = 1;

    const idProyecto = toInt(req.query.proyecto, null);
    if (idProyecto) {
      filtros.push(`r.id_proyecto = $${i++}`);
      params.push(idProyecto);
    }

    const search = normText(req.query.search, 200);
    if (search) {
      filtros.push(`(
        r.nro_resolucion ILIKE $${i} OR
        r.gestion_resolucion ILIKE $${i} OR
        r.observacion ILIKE $${i}
      )`);
      params.push(`%${search}%`); i++;
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const sqlData = `
      SELECT r.id_resoluciones, r.id_declaracion, r.id_proyecto,
             r.nro_resolucion, r.gestion_resolucion,
             r.fecha_resolucion, r.fecha_prox_vto_aa,
             r.estado, r.observacion, r.tipo_resoluciones
      FROM ema.resoluciones r
      ${where}
      ORDER BY r.fecha_resolucion DESC NULLS LAST, r.id_resoluciones DESC
      LIMIT ${limit} OFFSET ${off}
    `;
    const sqlCount = `
      SELECT COUNT(*)::int AS c
      FROM ema.resoluciones r
      ${where}
    `;

    const { rows } = await pool.query(sqlData, params);
    const { rows: crows } = await pool.query(sqlCount, params);
    return res.json({ page, limit, total: crows[0]?.c || 0, data: rows });
  } catch (err) {
    console.error('❌ listarResoluciones:', err);
    return res.status(500).json({ message: 'Error al listar resoluciones' });
  }
}

/* ============ Listado por proyecto ============ */
/** GET /api/resoluciones/:id  → id = id_proyecto */
async function listarResolucionesPorProyecto(req, res) {
  try {
    const idProyecto = toInt(req.params.id, null);
    if (!idProyecto) return res.status(400).json({ message: 'id_proyecto inválido' });

    const { rows } = await pool.query(
      `SELECT id_resoluciones, id_declaracion, id_proyecto,
              nro_resolucion, gestion_resolucion,
              fecha_resolucion, fecha_prox_vto_aa,
              estado, observacion, tipo_resoluciones
         FROM ema.resoluciones
        WHERE id_proyecto = $1
        ORDER BY fecha_resolucion DESC NULLS LAST, id_resoluciones DESC`,
      [idProyecto]
    );
    return res.json(rows);
  } catch (err) {
    console.error('❌ listarResolucionesPorProyecto:', err);
    return res.status(500).json({ message: 'Error al listar por proyecto' });
  }
}

/* ============ Crear ============ */
/**
 * POST /api/resoluciones
 * body: {
 *   id_declaracion?, id_proyecto*, nro_resolucion?, gestion_resolucion?,
 *   fecha_resolucion?, fecha_prox_vto_aa?, estado?, observacion?, tipo_resoluciones?
 * }
 */
async function crearResolucion(req, res) {
  try {
    const b = req.body || {};
    const id_proyecto        = toInt(b.id_proyecto, null);
    if (!id_proyecto) return res.status(400).json({ message: 'id_proyecto es requerido' });

    const id_declaracion     = toInt(b.id_declaracion, null);
    const nro_resolucion     = normText(b.nro_resolucion, 100);
    const gestion_resolucion = normText(b.gestion_resolucion, 100);
    const fecha_resolucion   = normDate(b.fecha_resolucion);
    const fecha_prox_vto_aa  = normDate(b.fecha_prox_vto_aa);
    const estado             = toInt(b.estado, 1);
    const observacion        = normText(b.observacion, 1000);
    const tipo_resoluciones  = normText(b.tipo_resoluciones, 100);

    const { rows } = await pool.query(
      `INSERT INTO ema.resoluciones
         (id_declaracion, id_proyecto, nro_resolucion, gestion_resolucion,
          fecha_resolucion, fecha_prox_vto_aa, estado, observacion, tipo_resoluciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id_resoluciones`,
      [
        id_declaracion, id_proyecto, nro_resolucion, gestion_resolucion,
        fecha_resolucion, fecha_prox_vto_aa, estado, observacion, tipo_resoluciones
      ]
    );

    return res.status(201).json({ id_resoluciones: rows[0].id_resoluciones });
  } catch (err) {
    console.error('❌ crearResolucion:', err);
    return res.status(500).json({ message: 'Error al crear resolución' });
  }
}

/* ============ Actualizar ============ */
/**
 * PUT /api/resoluciones/:id   → id = id_resoluciones
 * body: (mismos campos que crear; todos opcionales)
 */
async function actualizarResolucion(req, res) {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ message: 'id_resoluciones inválido' });

    const b = req.body || {};
    // valores normalizados
    const patch = {
      id_declaracion:     toInt(b.id_declaracion, null),
      id_proyecto:        toInt(b.id_proyecto, null),
      nro_resolucion:     normText(b.nro_resolucion, 100),
      gestion_resolucion: normText(b.gestion_resolucion, 100),
      fecha_resolucion:   normDate(b.fecha_resolucion),
      fecha_prox_vto_aa:  normDate(b.fecha_prox_vto_aa),
      estado:             toInt(b.estado, null),
      observacion:        normText(b.observacion, 1000),
      tipo_resoluciones:  normText(b.tipo_resoluciones, 100),
    };

    // construir SET dinámico
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== null && v !== undefined) {
        sets.push(`${k} = $${i++}`);
        vals.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ message: 'Sin campos para actualizar' });

    vals.push(id);
    const sql = `UPDATE ema.resoluciones SET ${sets.join(', ')} WHERE id_resoluciones = $${i} RETURNING id_resoluciones`;
    const { rows } = await pool.query(sql, vals);
    if (!rows.length) return res.status(404).json({ message: 'Resolución no encontrada' });

    return res.json({ message: 'Actualizado', id_resoluciones: rows[0].id_resoluciones });
  } catch (err) {
    console.error('❌ actualizarResolucion:', err);
    return res.status(500).json({ message: 'Error al actualizar resolución' });
  }
}

/* ============ Eliminar ============ */
/** DELETE /api/resoluciones/:id  → id = id_resoluciones */
async function eliminarResolucion(req, res) {
  try {
    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ message: 'id_resoluciones inválido' });

    // Si necesitás validar dependencias en tumba, hacelo aquí (sugerido).
    // Por ejemplo: impedir borrar si hay documentos enlazados a esta resolución en tu esquema.

    const { rowCount } = await pool.query(
      `DELETE FROM ema.resoluciones WHERE id_resoluciones = $1`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Resolución no encontrada' });

    return res.json({ message: 'Eliminado' });
  } catch (err) {
    console.error('❌ eliminarResolucion:', err);
    return res.status(500).json({ message: 'Error al eliminar resolución' });
  }
}

module.exports = {
  listarResoluciones,
  listarResolucionesPorProyecto,
  crearResolucion,
  actualizarResolucion,
  eliminarResolucion,
};
