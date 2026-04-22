// src/controllers/pga.controller.js
const pool = require('../db');
const { crearNotificacion } = require('./notificaciones.controller');

const fechaValida = (valor) => (valor && valor !== '' ? valor : null);

// === Handlers ===

// GET /api/pga/:id_proyecto
const listarPGA = async (req, res) => {
  try {
    const { id_proyecto } = req.params;
    const result = await pool.query(
      'SELECT * FROM ema.v_pga_index WHERE id_proyecto = $1 ORDER BY fecha_reg DESC',
      [id_proyecto]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener PGA:', err);
    res.status(500).json({ message: 'Error al obtener datos del PGA' });
  }
};

// POST /api/pga
const crearPGA = async (req, res) => {
  try {
    const { id_proyecto, tipo_riesgo, tipo_plan, descript_plan, fecha_reg, estado } = req.body;

    const result = await pool.query(
      `INSERT INTO ema.pga (
        id_proyecto, tipo_riesgo, tipo_plan, descript_plan, fecha_reg, estado
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        parseInt(id_proyecto, 10),
        tipo_riesgo,
        tipo_plan,
        descript_plan,
        fechaValida(fecha_reg),
        estado
      ]
    );

    // Destinatarios
    const proyecto = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [parseInt(id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = proyecto.rows[0] || {};

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(id_proyecto, 10),
      titulo:       'Nuevo PGA agregado',
      mensaje:      `Se agregó un nuevo registro PGA al proyecto "${nombre_proyecto || 'desconocido'}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear PGA:', err);
    res.status(500).json({ message: 'Error al crear PGA' });
  }
};

// PUT /api/pga/:id
const actualizarPGA = async (req, res) => {
  try {
    const { id } = req.params;
    const { id_proyecto, tipo_riesgo, tipo_plan, descript_plan, fecha_reg, estado } = req.body;

    const result = await pool.query(
      `UPDATE ema.pga SET
        id_proyecto = $1,
        tipo_riesgo = $2,
        tipo_plan = $3,
        descript_plan = $4,
        fecha_reg = $5,
        estado = $6
      WHERE id = $7 RETURNING *`,
      [
        parseInt(id_proyecto, 10),
        tipo_riesgo,
        tipo_plan,
        descript_plan,
        fechaValida(fecha_reg),
        estado,
        parseInt(id, 10)
      ]
    );

    const proyecto = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [parseInt(id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = proyecto.rows[0] || {};

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(id_proyecto, 10),
      titulo:       'PGA actualizado',
      mensaje:      `Se actualizó un registro de PGA en el proyecto "${nombre_proyecto || 'desconocido'}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar PGA:', err);
    res.status(500).json({ message: 'Error al actualizar PGA' });
  }
};

// DELETE /api/pga/:id
const eliminarPGA = async (req, res) => {
  try {
    const { id } = req.params;

    const consulta = await pool.query(
      'SELECT id_proyecto FROM ema.pga WHERE id = $1',
      [parseInt(id, 10)]
    );
    const pga = consulta.rows[0];

    if (!pga) {
      return res.status(404).json({ message: 'PGA no encontrado' });
    }

    await pool.query('DELETE FROM ema.pga WHERE id = $1', [parseInt(id, 10)]);

    const proyecto = await pool.query(
      `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
      [parseInt(pga.id_proyecto, 10)]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = proyecto.rows[0] || {};

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(pga.id_proyecto, 10),
      titulo:       'PGA eliminado',
      mensaje:      `Se eliminó un registro PGA del proyecto "${nombre_proyecto || 'desconocido'}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.json({ message: 'PGA eliminado correctamente' });
  } catch (err) {
    console.error('Error al eliminar PGA:', err);
    res.status(500).json({ message: 'Error al eliminar PGA' });
  }
};

module.exports = {
  listarPGA,
  crearPGA,
  actualizarPGA,
  eliminarPGA,
};
