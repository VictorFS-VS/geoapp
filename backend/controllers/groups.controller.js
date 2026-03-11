// src/controllers/groups.controller.js
const pool = require('../db');

// 1. Listar todos los grupos (paginado + búsqueda)
const listGroups = async (req, res) => {
  const page   = parseInt(req.query.page ) || 1;
  const limit  = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  try {
    let filtro = '';
    let params = [];
    if (search) {
      filtro = `WHERE name ILIKE $1 OR description ILIKE $1`;
      params.push(`%${search}%`);
    }

    // Total de registros
    const totalQ   = `SELECT COUNT(*) FROM public.groups ${filtro}`;
    const totalRes = await pool.query(totalQ, params);
    const total    = parseInt(totalRes.rows[0].count, 10);

    // Datos paginados
    const dataQ = `
      SELECT id, name, description, bgcolor
      FROM public.groups
      ${filtro}
      ORDER BY id
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    const dataRes = await pool.query(dataQ, [...params, limit, offset]);

    res.json({
      data:       dataRes.rows,
      page,
      totalPages: Math.ceil(total / limit),
      totalItems: total
    });
  } catch (err) {
    console.error('Error listGroups:', err);
    res.status(500).json({ error: 'Error al listar grupos' });
  }
};

// 2. Obtener un solo grupo por ID
const getGroup = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      'SELECT id, name, description, bgcolor FROM public.groups WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getGroup:', err);
    res.status(500).json({ error: 'Error al obtener grupo' });
  }
};

// 3. Crear un nuevo grupo
const createGroup = async (req, res) => {
  const { name, description, bgcolor } = req.body;
  try {
    await pool.query(
      `INSERT INTO public.groups (name, description, bgcolor)
       VALUES ($1, $2, $3)`,
      [name, description, bgcolor]
    );
    res.status(201).json({ success: true, message: 'Grupo creado correctamente' });
  } catch (err) {
    console.error('Error createGroup:', err);
    res.status(500).json({ error: 'Error al crear grupo' });
  }
};

// 4. Actualizar un grupo existente
const updateGroup = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, description, bgcolor } = req.body;
  try {
    const result = await pool.query(
      `UPDATE public.groups
       SET name = $1,
           description = $2,
           bgcolor = $3
       WHERE id = $4`,
      [name, description, bgcolor, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }
    res.json({ success: true, message: 'Grupo actualizado correctamente' });
  } catch (err) {
    console.error('Error updateGroup:', err);
    res.status(500).json({ error: 'Error al actualizar grupo' });
  }
};

// 5. Eliminar un grupo
const deleteGroup = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      'DELETE FROM public.groups WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }
    res.json({ success: true, message: 'Grupo eliminado correctamente' });
  } catch (err) {
    console.error('Error deleteGroup:', err);
    res.status(500).json({ error: 'Error al eliminar grupo' });
  }
};

// 6. Solo id+name (para dropdowns, etc.)
const obtenerGrupos = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM public.groups ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error obtenerGrupos:', err);
    res.status(500).json({ error: 'Error al obtener grupos' });
  }
};

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  obtenerGrupos
};
