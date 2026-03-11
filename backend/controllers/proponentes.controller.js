// backend/controllers/proponentes.controller.js
const pool = require('../db');

const toNullableNumber = (value) =>
  value === '' || value === null || typeof value === 'undefined' ? null : Number(value);

const obtenerProponentes = async (req, res) => {
  const { id_cliente, id_consultor, tipo_usuario } = req.user || {};
  const page   = parseInt(req.query.page)  || 1;
  const limit  = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  const esCliente       = tipo_usuario === 9 || tipo_usuario === 10; // CLIENTE_SAAP o CLIENTE_VIAL
  const esAdminCliente  = tipo_usuario === 11;                       // ADMIN_CLIENTE
  const esConsultor     = tipo_usuario === 8;                        // CONSULTOR

  try {
    const filtros = [];
    const valores = [];
    let withCartera = '';

    // 🔹 ADMIN_CLIENTE: filtra por su propio id_cliente + miembros en ema.cliente_admin_miembro
    if (esAdminCliente && id_cliente) {
      withCartera = `
        WITH cartera AS (
          SELECT $${valores.length + 1}::int AS id_cliente
          UNION
          SELECT miembro_id FROM ema.cliente_admin_miembro WHERE admin_id = $${valores.length + 1}
        )
      `;
      valores.push(id_cliente);
      filtros.push(`c.id_cliente IN (SELECT id_cliente FROM cartera)`);
    }

    // 🔹 CLIENTE (9/10): sólo su registro
    if (esCliente && id_cliente) {
      filtros.push(`c.id_cliente = $${valores.length + 1}`);
      valores.push(id_cliente);
    }

    // 🔹 CONSULTOR (8): clientes de SUS PROYECTOS + (opcional) cartera propia si existe tabla ema.consultor_cartera
    if (esConsultor && id_consultor) {
      // ¿existe tabla de cartera de consultor?
      const { rows: ex } = await pool.query('SELECT to_regclass($1) AS oid', ['ema.consultor_cartera']);
      const carteraExiste = !!ex?.[0]?.oid;

      const baseIdx = valores.length + 1;
      const unionIdx = carteraExiste ? baseIdx + 1 : null;

      let sub = `
        SELECT DISTINCT COALESCE(p.id_proponente, p.id_cliente) AS id_cliente
        FROM ema.proyectos p
        WHERE p.id_consultor = $${baseIdx}
      `;
      if (carteraExiste) {
        sub += `
          UNION
          SELECT cc.cliente_id
          FROM ema.consultor_cartera cc
          WHERE cc.consultor_id = $${unionIdx}
        `;
      }

      filtros.push(`c.id_cliente IN (${sub})`);
      valores.push(id_consultor);
      if (carteraExiste) valores.push(id_consultor);
    }

    // 🔹 Búsqueda libre
    if (search) {
      filtros.push(
        `(c.nombre ILIKE $${valores.length + 1} OR c.apellido ILIKE $${valores.length + 1} OR CAST(c.cedularuc AS TEXT) ILIKE $${valores.length + 1})`
      );
      valores.push(`%${search}%`);
    }

    const whereClause = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    // total
    const totalQuery = `
      ${withCartera}
      SELECT COUNT(*) FROM ema.cliente c
      ${whereClause}
    `;
    const totalResult = await pool.query(totalQuery, valores);
    const total = parseInt(totalResult.rows[0].count || '0', 10);

    // página
    const limitIdx  = valores.length + 1;
    const offsetIdx = valores.length + 2;

    const consulta = `
      ${withCartera}
      SELECT 
        c.id_cliente, c.cedularuc, c.nombre, c.apellido, c.email, 
        c.fecha_nac, c.sexo, c.tipo_persona, c.telefono, c.direccion, 
        c.tipo_empresa, c.nacionalidad, c.rlegal_cedula, 
        c.rlegal_nombre, c.rlegal_apellido, c.rlegal_sexo, c.dvi
      FROM ema.cliente c
      ${whereClause}
      ORDER BY c.id_cliente
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const { rows } = await pool.query(consulta, [...valores, limit, offset]);

    res.json({
      data: rows,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total
    });
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
};

const obtenerProponentePorId = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        id_cliente, cedularuc, nombre, apellido, email, 
        fecha_nac, sexo, tipo_persona, telefono, direccion, 
        tipo_empresa, nacionalidad, rlegal_cedula, 
        rlegal_nombre, rlegal_apellido, rlegal_sexo, dvi
      FROM ema.cliente WHERE id_cliente = $1
    `, [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener cliente:', error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
};

const crearProponente = async (req, res) => {
  let {
    cedularuc, nombre, apellido, email, fecha_nac,
    sexo, tipo_persona, telefono, direccion, tipo_empresa,
    nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
    rlegal_sexo, dvi
  } = req.body;

  // Normalización a números / null
  dvi = toNullableNumber(dvi);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  cedularuc = toNullableNumber(cedularuc);
  telefono = toNullableNumber(telefono);

  try {
    const query = `
      INSERT INTO ema.cliente (
        cedularuc, nombre, apellido, email, fecha_nac,
        sexo, tipo_persona, telefono, direccion, tipo_empresa,
        nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
        rlegal_sexo, dvi
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16
      )
      RETURNING id_cliente
    `;

    const result = await pool.query(query, [
      cedularuc, nombre, apellido, email, fecha_nac,
      sexo, tipo_persona, telefono, direccion, tipo_empresa,
      nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
      rlegal_sexo, dvi
    ]);

    return res.status(201).json({
      success: true,
      message: "Cliente creado correctamente",
      id_cliente: result.rows?.[0]?.id_cliente ?? null,
    });
  } catch (error) {
    console.error("Error al crear cliente:", error);

    // ✅ Duplicado (PostgreSQL)
    if (error?.code === "23505") {
      return res.status(409).json({
        error: "Registro duplicado",
        detail: error.detail,          // ej: Ya existe la llave (id_cliente)=(29).
        constraint: error.constraint,  // ej: cliente_pk
      });
    }

    return res.status(500).json({ error: "Error al crear cliente" });
  }
};

const actualizarProponente = async (req, res) => {
  const { id } = req.params;
  let {
    cedularuc, nombre, apellido, email, fecha_nac,
    sexo, tipo_persona, telefono, direccion, tipo_empresa,
    nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
    rlegal_sexo, dvi
  } = req.body;

  dvi = toNullableNumber(dvi);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  cedularuc = toNullableNumber(cedularuc);
  telefono = toNullableNumber(telefono);

  try {
    const query = `
      UPDATE ema.cliente SET
        cedularuc=$1, nombre=$2, apellido=$3, email=$4, fecha_nac=$5,
        sexo=$6, tipo_persona=$7, telefono=$8, direccion=$9, tipo_empresa=$10,
        nacionalidad=$11, rlegal_cedula=$12, rlegal_nombre=$13, rlegal_apellido=$14,
        rlegal_sexo=$15, dvi=$16
      WHERE id_cliente = $17
    `;
    const result = await pool.query(query, [
      cedularuc, nombre, apellido, email, fecha_nac,
      sexo, tipo_persona, telefono, direccion, tipo_empresa,
      nacionalidad, rlegal_cedula, rlegal_nombre, rlegal_apellido,
      rlegal_sexo, dvi, id
    ]);

    if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    res.json({ success: true, message: 'Cliente actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
};

const eliminarProponente = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM ema.cliente WHERE id_cliente = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ success: true, message: 'Cliente eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
};

const obtenerProponentesDropdown = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id_cliente AS id_proponente,
             nombre || ' ' || COALESCE(apellido, '') AS nombre
      FROM ema.cliente
      ORDER BY nombre
    `);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error al obtener proponentes para dropdown:', error);
    res.status(500).json({ error: 'Error al obtener proponentes' });
  }
};

module.exports = {
  obtenerProponentes,
  obtenerProponentePorId,
  crearProponente,
  actualizarProponente,
  eliminarProponente,
  obtenerProponentesDropdown
};
