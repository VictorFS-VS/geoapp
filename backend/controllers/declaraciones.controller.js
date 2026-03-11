// src/controllers/declaraciones.controller.js
const pool = require('../db');
const { crearNotificacion } = require('./notificaciones.controller');

const fechaValida = (valor) => (valor && valor !== '' ? valor : null);

// === Handlers ===

// GET /api/declaraciones
const listarDeclaraciones = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
         FROM ema.declaraciones
        ORDER BY id_declaracion DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener declaraciones:', err);
    res.status(500).json({ message: 'Error al obtener declaraciones' });
  }
};

// GET /api/declaraciones/:id (por proyecto)
const listarDeclaracionesPorProyecto = async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      `SELECT *
         FROM ema.declaraciones
        WHERE id_proyecto = $1
        ORDER BY fecha_declaracion DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener declaración por proyecto:', err);
    res.status(500).json({ message: 'Error al obtener declaración' });
  }
};

// POST /api/declaraciones
const crearDeclaracion = async (req, res) => {
  try {
    const {
      id_proyecto,
      nro_declaracion,
      gestion_declaracion,
      fecha_declaracion,
      fecha_declaracion_vto,
      fecha_prox_vto_aa,
      estado,
      observacion
    } = req.body;

    const result = await pool.query(
      `INSERT INTO ema.declaraciones (
         id_proyecto, nro_declaracion, gestion_declaracion,
         fecha_declaracion, fecha_declaracion_vto, fecha_prox_vto_aa,
         estado, observacion
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        parseInt(id_proyecto, 10),
        parseInt(nro_declaracion, 10),
        gestion_declaracion,
        fechaValida(fecha_declaracion),
        fechaValida(fecha_declaracion_vto),
        fechaValida(fecha_prox_vto_aa),
        estado,
        observacion
      ]
    );

    // Obtener datos de proyecto para notificar
    const projRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre
         FROM ema.proyectos
        WHERE gid = $1`,
      [id_proyecto]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = projRes.rows[0] || {};

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(id_proyecto, 10),
      titulo:       'Nueva declaración creada',
      mensaje:      `Se creó la declaración N° ${nro_declaracion} en el proyecto "${nombre_proyecto}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear declaración:', err);
    if (err.code === '23505') {
      if (err.constraint === 'declaraciones_id_proyecto_key') {
        return res.status(400).json({ message: 'Ya existe una declaración para este proyecto' });
      }
      if (err.constraint === 'declaraciones_nro_gestion_ukey') {
        return res.status(400).json({ message: 'Ya existe una declaración con ese número y gestión' });
      }
    }
    return res.status(500).json({ message: err.message || 'Error interno del servidor' });
  }
};

// PUT /api/declaraciones/:id
const actualizarDeclaracion = async (req, res) => {
  try {
    const {
      id_proyecto,
      nro_declaracion,
      gestion_declaracion,
      fecha_declaracion,
      fecha_declaracion_vto,
      fecha_prox_vto_aa,
      estado,
      observacion
    } = req.body;

    const result = await pool.query(
      `UPDATE ema.declaraciones SET
         id_proyecto           = $1,
         nro_declaracion       = $2,
         gestion_declaracion   = $3,
         fecha_declaracion     = $4,
         fecha_declaracion_vto = $5,
         fecha_prox_vto_aa     = $6,
         estado                = $7,
         observacion           = $8
       WHERE id_declaracion = $9
       RETURNING *`,
      [
        parseInt(id_proyecto, 10),
        parseInt(nro_declaracion, 10),
        gestion_declaracion,
        fechaValida(fecha_declaracion),
        fechaValida(fecha_declaracion_vto),
        fechaValida(fecha_prox_vto_aa),
        estado,
        observacion,
        parseInt(req.params.id, 10)
      ]
    );

    const projRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre
         FROM ema.proyectos
        WHERE gid = $1`,
      [id_proyecto]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = projRes.rows[0] || {};

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(id_proyecto, 10),
      titulo:       'Declaración actualizada',
      mensaje:      `Se actualizó la declaración N° ${nro_declaracion} en el proyecto "${nombre_proyecto}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al actualizar declaración:', err);
    res.status(500).json({ message: 'Error al actualizar declaración' });
  }
};

// DELETE /api/declaraciones/:id
const eliminarDeclaracion = async (req, res) => {
  try {
    const idDecl = parseInt(req.params.id, 10);

    const antRes = await pool.query(
      `SELECT id_proyecto, nro_declaracion
         FROM ema.declaraciones
        WHERE id_declaracion = $1`,
      [idDecl]
    );
    const decl = antRes.rows[0];
    if (!decl) {
      return res.status(404).json({ message: 'Declaración no encontrada' });
    }

    const projRes = await pool.query(
      `SELECT id_cliente, id_consultor, nombre
         FROM ema.proyectos
        WHERE gid = $1`,
      [decl.id_proyecto]
    );
    const { id_cliente, id_consultor, nombre: nombre_proyecto } = projRes.rows[0] || {};

    await pool.query(
      `DELETE
         FROM ema.declaraciones
        WHERE id_declaracion = $1`,
      [idDecl]
    );

    await crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId:  id_consultor || null,
      id_proyecto:  parseInt(decl.id_proyecto, 10),
      titulo:       'Declaración eliminada',
      mensaje:      `Se eliminó la declaración N° ${decl.nro_declaracion} del proyecto "${nombre_proyecto}".`,
      creado_por:   req.user?.username || 'Sistema',
      es_global:    false
    });

    res.json({ message: 'Declaración eliminada' });
  } catch (err) {
    console.error('Error al eliminar declaración:', err);
    res.status(500).json({ message: 'Error al eliminar declaración' });
  }
};

module.exports = {
  listarDeclaraciones,
  listarDeclaracionesPorProyecto,
  crearDeclaracion,
  actualizarDeclaracion,
  eliminarDeclaracion,
};
