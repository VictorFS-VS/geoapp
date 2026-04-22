// backend/controllers/consultores.controller.js
const pool = require('../db');

/* ================= helpers ================= */

const toNullableNumber = (value) =>
  value === '' || value === null || typeof value === 'undefined'
    ? null
    : Number(value);

// Normaliza cualquier entrada de fecha a 'YYYY-MM-DD' o '' si no hay valor
const normalizeDateInput = (value) => {
  if (value === '' || value === null || typeof value === 'undefined') return '';

  const s = String(value).trim();

  // Caso: viene con hora -> '1956-05-27T00:00:00.000Z'
  const base = s.includes('T') ? s.split('T')[0] : s;

  // Caso: viene como '27/05/1956' -> convertir a '1956-05-27'
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(base)) {
    const [d, m, y] = base.split('/');
    return `${y}-${m}-${d}`;
  }

  // Si ya está como '1956-05-27' lo devolvemos igual
  return base;
};

const toNullableDate = (value) => {
  const norm = normalizeDateInput(value);
  return norm === '' ? null : norm;
};

/** chequea existencia de tabla (evita 42P01) */
async function tableExists(fqn) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS oid', [fqn]);
  return !!rows?.[0]?.oid;
}

/** obtiene miembros (array<int>) de la cartera de un Admin_Cliente */
async function obtenerMiembrosDeAdminCliente(adminId) {
  const fqn = 'ema.admin_cliente_miembros'; // ajusta si tu tabla se llama distinto
  if (!(await tableExists(fqn))) return [];
  const { rows } = await pool.query(
    `SELECT miembro_id::int AS id FROM ${fqn} WHERE admin_id = $1`,
    [adminId]
  );
  return (rows || []).map(r => r.id).filter(Number.isFinite);
}

/** Validación de datos de consultor: devuelve { ok, errores } */
function validarConsultorInput(body) {
  const errores = {};

  const {
    cedularuc,
    nombre,
    apellido,
    email,
    fecha_nac,
    sexo,
    tipo_persona
  } = body;

  // Cédula / RUC
  if (!cedularuc || String(cedularuc).trim() === '') {
    errores.cedularuc = 'La cédula/RUC es obligatoria.';
  } else if (!/^[0-9]{5,12}$/.test(String(cedularuc))) {
    errores.cedularuc = 'La cédula/RUC debe tener solo números (5 a 12 dígitos).';
  }

  // Nombre
  if (!nombre || String(nombre).trim() === '') {
    errores.nombre = 'El nombre es obligatorio.';
  }

  // Apellido solo obligatorio si es persona física
  if (tipo_persona === 'F' && (!apellido || String(apellido).trim() === '')) {
    errores.apellido = 'El apellido es obligatorio para persona física.';
  }

  // Tipo de persona
  if (!tipo_persona || !['F', 'J'].includes(tipo_persona)) {
    errores.tipo_persona = 'Debe seleccionar Tipo de Persona (Física o Jurídica).';
  }

  // Sexo (opcional, pero si viene tiene que ser válido)
  if (sexo && !['F', 'M'].includes(sexo)) {
    errores.sexo = 'El sexo debe ser F (Femenino) o M (Masculino).';
  }

  // Fecha de nacimiento (si viene, normalizar y validar formato)
  if (fecha_nac && fecha_nac !== '') {
    const f = normalizeDateInput(fecha_nac);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      errores.fecha_nac = 'La fecha de nacimiento debe tener formato AAAA-MM-DD.';
    }
  }

  // Email (si viene, validar forma básica)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errores.email = 'El email no tiene un formato válido.';
  }

  return {
    ok: Object.keys(errores).length === 0,
    errores
  };
}

/* ================= controladores ================= */

const obtenerConsultores = async (req, res) => {
  const page   = parseInt(req.query.page, 10)  || 1;
  const limit  = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  const usuario = req.user;
  const esCliente       = usuario?.tipo_usuario === 9 || usuario?.tipo_usuario === 10;
  const esAdminCliente  = usuario?.tipo_usuario === 11;
  const idCliente       = usuario?.id_cliente;

  try {
    const filtros = [];
    const valores = [];

    if (search) {
      filtros.push(
        `(c.nombre ILIKE $${valores.length + 1} OR c.apellido ILIKE $${valores.length + 1} OR CAST(c.cedularuc AS TEXT) ILIKE $${valores.length + 1})`
      );
      valores.push(`%${search}%`);
    }

    if (esCliente && idCliente) {
      // Cliente ve consultores que aparezcan en SUS proyectos
      filtros.push(`c.id_consultor IN (
        SELECT DISTINCT p.id_consultor
        FROM ema.proyectos p
        WHERE (p.id_proponente = $${valores.length + 1} OR p.id_cliente = $${valores.length + 1})
      )`);
      valores.push(idCliente);
    }

    if (esAdminCliente) {
      // Admin_Cliente ve consultores de su cartera de clientes (miembros + propio id_cliente)
      const miembros = await obtenerMiembrosDeAdminCliente(idCliente);
      const set = new Set(miembros);
      if (idCliente) set.add(idCliente);
      const ids = Array.from(set);

      if (ids.length > 0) {
        filtros.push(`c.id_consultor IN (
          SELECT DISTINCT p.id_consultor
          FROM ema.proyectos p
          WHERE COALESCE(p.id_proponente, p.id_cliente) = ANY($${valores.length + 1}::int[])
        )`);
        valores.push(ids);
      } else {
        filtros.push('1=0');
      }
    }

    const whereClause = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    // total
    const totalQuery  = `SELECT COUNT(*) FROM ema.consultores c ${whereClause}`;
    const totalResult = await pool.query(totalQuery, valores);
    const total       = parseInt(totalResult.rows[0].count, 10) || 0;

    // page
    const consultaPaginada = `
      SELECT *
      FROM ema.consultores c
      ${whereClause}
      ORDER BY id_consultor
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `;
    const result = await pool.query(consultaPaginada, [...valores, limit, offset]);

    res.json({
      data: result.rows,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      totalItems: total
    });
  } catch (error) {
    console.error('Error al obtener consultores paginados:', error);
    res.status(500).json({ error: 'Error al obtener consultores' });
  }
};

const obtenerConsultorPorId = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM ema.consultores WHERE id_consultor = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Consultor no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener consultor:', error);
    res.status(500).json({ error: 'Error al obtener consultor' });
  }
};

const crearConsultor = async (req, res) => {
  let {
    cedularuc, nombre, apellido, email, fecha_nac,
    sexo, tipo_persona, telefono, direccion, tipo_empresa,
    nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
    rlegal_sexo, dvi, id_cliente
  } = req.body;

  // 1) Validación
  const { ok, errores } = validarConsultorInput(req.body);
  if (!ok) {
    return res.status(400).json({
      error: 'Hay errores en el formulario.',
      fields: errores
    });
  }

  dvi           = toNullableNumber(dvi);
  id_cliente    = toNullableNumber(id_cliente);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  fecha_nac     = toNullableDate(fecha_nac);

  try {
    const query = `
      INSERT INTO ema.consultores (
        cedularuc, nombre, apellido, email, fecha_nac,
        sexo, tipo_persona, telefono, direccion, tipo_empresa,
        nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
        rlegal_sexo, dvi, id_cliente
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17
      )
      RETURNING id_consultor
    `;

    const result = await pool.query(query, [
      cedularuc, nombre, apellido, email, fecha_nac,
      sexo, tipo_persona, telefono, direccion, tipo_empresa,
      nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
      rlegal_sexo, dvi, id_cliente
    ]);

    const nuevoId = result.rows[0].id_consultor;

    res.status(201).json({
      success: true,
      message: 'Consultor creado correctamente',
      id_consultor: nuevoId
    });
  } catch (error) {
    console.error('Error al crear consultor:', error);

    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un consultor con esa cédula/RUC y tipo de persona.' });
    }
    if (error.code === '22001') {
      return res.status(400).json({ error: 'Uno de los campos excede el tamaño permitido.' });
    }
    if (error.code === '22007') {
      return res.status(400).json({ error: 'La fecha tiene un formato inválido.' });
    }
    if (error.code === '23502') {
      return res.status(400).json({ error: 'Un campo obligatorio no puede ser nulo.' });
    }

    res.status(500).json({ error: 'Error al crear consultor' });
  }
};

const actualizarConsultor = async (req, res) => {
  const { id } = req.params;
  let {
    cedularuc, nombre, apellido, email, fecha_nac,
    sexo, tipo_persona, telefono, direccion, tipo_empresa,
    nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
    rlegal_sexo, dvi, id_cliente
  } = req.body;

  const { ok, errores } = validarConsultorInput(req.body);
  if (!ok) {
    return res.status(400).json({
      error: 'Hay errores en el formulario.',
      fields: errores
    });
  }

  dvi           = toNullableNumber(dvi);
  id_cliente    = toNullableNumber(id_cliente);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  fecha_nac     = toNullableDate(fecha_nac);

  try {
    const query = `
      UPDATE ema.consultores SET
        cedularuc=$1, nombre=$2, apellido=$3, email=$4, fecha_nac=$5,
        sexo=$6, tipo_persona=$7, telefono=$8, direccion=$9, tipo_empresa=$10,
        nacionalidad=$11, rlegal_cedula=$12, rlegal_nombre=$13, rlegal_apellido=$14,
        rlegal_sexo=$15, dvi=$16, id_cliente=$17
      WHERE id_consultor = $18
    `;

    const result = await pool.query(query, [
      cedularuc, nombre, apellido, email, fecha_nac,
      sexo, tipo_persona, telefono, direccion, tipo_empresa,
      nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
      rlegal_sexo, dvi, id_cliente, id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Consultor no encontrado' });
    }

    res.json({ success: true, message: 'Consultor actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar consultor:', error);

    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un consultor con esa cédula/RUC y tipo de persona.' });
    }
    if (error.code === '22001') {
      return res.status(400).json({ error: 'Uno de los campos excede el tamaño permitido.' });
    }
    if (error.code === '22007') {
      return res.status(400).json({ error: 'La fecha tiene un formato inválido.' });
    }
    if (error.code === '23502') {
      return res.status(400).json({ error: 'Un campo obligatorio no puede ser nulo.' });
    }

    res.status(500).json({ error: 'Error al actualizar consultor' });
  }
};

const eliminarConsultor = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM ema.consultores WHERE id_consultor = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Consultor no encontrado' });
    }
    res.json({ success: true, message: 'Consultor eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar consultor:', error);
    res.status(500).json({ error: 'Error al eliminar consultor' });
  }
};

module.exports = {
  obtenerConsultores,
  obtenerConsultorPorId,
  crearConsultor,
  actualizarConsultor,
  eliminarConsultor
};
