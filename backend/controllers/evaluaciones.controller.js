// src/controllers/evaluaciones.controller.js
const pool = require('../db');

const fechaValida = (v) => (v && v !== '' ? v : null);

// ================== EVALUACIONES CRUD ==================

// GET /api/evaluaciones/:proyecto_id
const listarEvaluacionesPorProyecto = async (req, res) => {
  const proyecto_id = parseInt(req.params.proyecto_id, 10);
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        proyecto_id,
        categoria,
        etapa,
        estado_registro,
        si_no,
        fecha,
        observaciones,
        fecha_final,
        creado_en
      FROM ema.proyectos_evaluaciones
      WHERE proyecto_id = $1
      ORDER BY
        COALESCE(fecha, creado_en::date) DESC NULLS LAST,
        id DESC
      `,
      [proyecto_id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener evaluaciones:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// POST /api/evaluaciones
const crearEvaluacion = async (req, res) => {
  const {
    proyecto_id,
    categoria,
    // ✅ compat: puede venir como "estado" (texto) desde front viejo, o como "etapa" desde front nuevo
    estado,
    etapa,
    si_no,
    fecha,
    observaciones,
    fecha_final
  } = req.body;

  const etapaFinal = (etapa ?? estado ?? '').toString().trim();

  if (!proyecto_id) return res.status(400).json({ message: 'proyecto_id es requerido' });
  if (!categoria) return res.status(400).json({ message: 'categoria es requerida' });
  if (!etapaFinal) return res.status(400).json({ message: 'etapa/estado es requerido' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO ema.proyectos_evaluaciones
         (proyecto_id, categoria, etapa, si_no, fecha, observaciones, fecha_final, estado_registro)
       VALUES ($1,$2,$3,$4,$5,$6,$7, 1)  -- 1=ACTIVA (el trigger historiza las demás)
       RETURNING *`,
      [
        parseInt(proyecto_id, 10),
        categoria,
        etapaFinal,
        !!si_no,
        fechaValida(fecha),
        observaciones || null,
        fechaValida(fecha_final),
      ]
    );

    // ✅ el trigger AFTER va a:
    // - historizar las anteriores
    // - actualizar proyectos.des_estado/estado
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Error al crear evaluación:', error);
    res.status(500).json({ message: 'Error al crear la evaluación' });
  }
};

// PUT /api/evaluaciones/:id
const actualizarEvaluacion = async (req, res) => {
  const id = parseInt(req.params.id, 10);

  const {
    categoria,
    estado,   // compat texto
    etapa,    // texto
    si_no,
    fecha,
    observaciones,
    fecha_final,
    // opcional: si querés permitir cambiar estado_registro manualmente (no recomendado)
    // estado_registro
  } = req.body;

  const etapaFinal = (etapa ?? estado ?? '').toString().trim();

  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE ema.proyectos_evaluaciones SET
         categoria = $1,
         etapa = $2,
         si_no = $3,
         fecha = $4,
         observaciones = $5,
         fecha_final = $6
       WHERE id = $7
       RETURNING *`,
      [
        categoria,
        etapaFinal,
        !!si_no,
        fechaValida(fecha),
        observaciones || null,
        fechaValida(fecha_final),
        id
      ]
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: 'Evaluación no encontrada' });
    }

    // ✅ si cambiaste etapa/fecha, tu trigger debería recalcular ACTIVA/HISTÓRICA y el estado del proyecto
    res.json(rows[0]);
  } catch (error) {
    console.error('Error al actualizar evaluación:', error);
    res.status(500).json({ message: 'Error al actualizar la evaluación' });
  }
};

// GET /api/evaluaciones/ver/:id  (o como lo tengas)
const verEvaluacionPorId = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const { rows, rowCount } = await pool.query(
      `SELECT
        id,
        proyecto_id,
        categoria,
        etapa,
        estado_registro,
        si_no,
        fecha,
        observaciones,
        fecha_final,
        creado_en
       FROM ema.proyectos_evaluaciones
       WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Evaluación no encontrada' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error al obtener evaluación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// ================== PROYECTO (vía Evaluaciones) ==================

const UPDATABLE = new Set([
  'expediente','nombre','codigo','descripcion',
  'fecha_inicio','fecha_final','fecha_registro',
  'actividad','tipo_proyecto','tipo_estudio',
  'id_consultor','id_proponente',
  'sector_proyecto','coor_x','coor_y',
  // banderas/fechas/obs que disparan el trigger de evaluaciones
  'mesa_control','mesa_fecha_ini','mesa_fecha_pago','mesa_obs',
  'atec_ini','atec_ini_fecha','atec_ini_obs',
  'geomatica','geo_fecha_ini','geo_obs',
  'atecnico','atec_fecha_ini','atec_fecha_fin','atec_obs',
  'direc_mades',
  'rima_p','rima_p_fecha','rima_p_obs',
  'rima_w','rima_w_fecha','rima_w_obs',
  'diva','diva_fecha_ini','diva_obs',
  'dir_gen','dir_gen_fecha_ini','dir_gen_obs',
  'des_estado'
]);

// GET /api/evaluaciones/proyecto/:id  -> proyecto + evaluaciones
const getProyectoConEvaluaciones = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const p = await pool.query('SELECT * FROM ema.proyectos WHERE gid = $1', [id]);
    if (p.rowCount === 0) return res.status(404).json({ message: 'Proyecto no encontrado' });

    const ev = await pool.query(
      `SELECT
         id, categoria, etapa, estado_registro, si_no, fecha, fecha_final, observaciones, creado_en
       FROM ema.proyectos_evaluaciones
       WHERE proyecto_id = $1
       ORDER BY COALESCE(fecha, creado_en::date) DESC NULLS LAST, id DESC`,
      [id]
    );

    res.json({
      proyecto: p.rows[0],
      evaluaciones: ev.rows,
      total_evaluaciones: ev.rowCount
    });
  } catch (err) {
    console.error('Error getProyectoConEvaluaciones:', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PUT /api/evaluaciones/proyecto/:id  -> actualiza campos de proyecto
const updateProyectoDesdeEvaluaciones = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const keys = Object.keys(req.body).filter(k => UPDATABLE.has(k));
    if (keys.length === 0) return res.json({ updated: false });

    const sets = [];
    const vals = [];
    keys.forEach((k, i) => {
      const value = /fecha/i.test(k) ? fechaValida(req.body[k]) : req.body[k];
      sets.push(`${k} = $${i + 1}`);
      vals.push(value);
    });
    vals.push(id);

    const sql = `UPDATE ema.proyectos SET ${sets.join(', ')} WHERE gid = $${vals.length} RETURNING *`;
    const r = await pool.query(sql, vals);
    if (r.rowCount === 0) return res.status(404).json({ message: 'Proyecto no encontrado' });

    res.json({ proyecto: r.rows[0] });
  } catch (err) {
    console.error('Error updateProyectoDesdeEvaluaciones:', err);
    res.status(500).json({ message: 'Error al actualizar proyecto' });
  }
};

module.exports = {
  // evaluaciones
  listarEvaluacionesPorProyecto,
  crearEvaluacion,
  actualizarEvaluacion,
  verEvaluacionPorId,
  // proyecto (vía evaluaciones)
  getProyectoConEvaluaciones,
  updateProyectoDesdeEvaluaciones
};
