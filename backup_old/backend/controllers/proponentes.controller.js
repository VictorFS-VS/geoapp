"use strict";

const pool = require("../db");

/* ================= helpers ================= */

const toNullableNumber = (value) =>
  value === "" || value === null || typeof value === "undefined"
    ? null
    : Number(value);

// Normalize any date input to "YYYY-MM-DD" or "" if missing
const normalizeDateInput = (value) => {
  if (value === "" || value === null || typeof value === "undefined") return "";

  const s = String(value).trim();
  const base = s.includes("T") ? s.split("T")[0] : s;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(base)) {
    const [d, m, y] = base.split("/");
    return `${y}-${m}-${d}`;
  }

  return base;
};

const toNullableDate = (value) => {
  const norm = normalizeDateInput(value);
  return norm === "" ? null : norm;
};

async function tableExists(fqn) {
  const { rows } = await pool.query("SELECT to_regclass($1) AS oid", [fqn]);
  return !!rows?.[0]?.oid;
}

function hasPerm(user, code) {
  const perms = user?.perms || [];
  return Array.isArray(perms) && perms.includes(code);
}

function isAdmin(user) {
  const primary = Number(user?.tipo_usuario ?? user?.group_id ?? 0);
  if (primary === 1) return true;
  const roleIds = Array.isArray(user?.role_ids)
    ? user.role_ids
    : Array.isArray(user?.roleIds)
      ? user.roleIds
      : [];
  return roleIds.some((id) => Number(id) === 1);
}

async function getClientesPermitidosRBAC(user = {}) {
  const ids = new Set();

  const idCliente = user.id_cliente ? parseInt(user.id_cliente, 10) : null;
  const idConsultor = user.id_consultor ? parseInt(user.id_consultor, 10) : null;
  const userId = user.id ? parseInt(user.id, 10) : null;

  if (idCliente) ids.add(idCliente);

  const tableAdmin = "ema.cliente_admin_miembro";
  const tableCons = "ema.consultor_cliente_miembro";

  if (hasPerm(user, "cartera.admin.read")) {
    if (userId && (await tableExists(tableAdmin))) {
      const rUser = await pool.query(
        `SELECT miembro_id FROM ${tableAdmin} WHERE admin_id = $1`,
        [userId]
      );
      (rUser.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
    }
    if (idCliente && (await tableExists(tableAdmin))) {
      const rCliente = await pool.query(
        `SELECT miembro_id FROM ${tableAdmin} WHERE admin_id = $1`,
        [idCliente]
      );
      (rCliente.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
    }
  }

  if (hasPerm(user, "cartera.consultor.read") && idConsultor && (await tableExists(tableCons))) {
    const rCons = await pool.query(
      `SELECT miembro_id FROM ${tableCons} WHERE consultor_id = $1`,
      [idConsultor]
    );
    (rCons.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
  }

  return ids.size ? Array.from(ids) : [];
}

/** Validate proponente input: returns { ok, errores } */
function validarProponenteInput(body) {
  const errores = {};
  const { cedularuc, nombre, apellido, email, fecha_nac, sexo, tipo_persona } = body;

  if (!cedularuc || String(cedularuc).trim() === "") {
    errores.cedularuc = "La cedula/RUC es obligatoria.";
  } else if (!/^[0-9]{5,12}$/.test(String(cedularuc))) {
    errores.cedularuc = "La cedula/RUC debe tener solo numeros (5 a 12 digitos).";
  }

  if (!nombre || String(nombre).trim() === "") {
    errores.nombre = "El nombre es obligatorio.";
  }

  if (tipo_persona === "F" && (!apellido || String(apellido).trim() === "")) {
    errores.apellido = "El apellido es obligatorio para persona fisica.";
  }

  if (!tipo_persona || !["F", "J"].includes(tipo_persona)) {
    errores.tipo_persona = "Debe seleccionar Tipo de Persona (Fisica o Juridica).";
  }

  if (sexo && !["F", "M"].includes(sexo)) {
    errores.sexo = "El sexo debe ser F (Femenino) o M (Masculino).";
  }

  if (fecha_nac && fecha_nac !== "") {
    const f = normalizeDateInput(fecha_nac);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
      errores.fecha_nac = "La fecha de nacimiento debe tener formato AAAA-MM-DD.";
    }
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errores.email = "El email no tiene un formato valido.";
  }

  return { ok: Object.keys(errores).length === 0, errores };
}

/* ================= controllers ================= */

const obtenerProponentesDropdown = async (req, res) => {
  try {
    const user = req.user || {};
    let where = "";
    let params = [];

    if (!isAdmin(user)) {
      const ids = await getClientesPermitidosRBAC(user);
      if (!ids.length) return res.json({ data: [] });
      where = "WHERE c.id_cliente = ANY($1::int[])";
      params = [ids];
    }

    const q = `
      SELECT
        c.id_cliente AS id_proponente,
        TRIM(CONCAT_WS(' ', c.nombre, c.apellido)) AS nombre
      FROM ema.cliente c
      ${where}
      ORDER BY c.id_cliente
    `;
    const { rows } = await pool.query(q, params);
    return res.json({ data: rows });
  } catch (err) {
    console.error("Error al obtener proponentes dropdown:", err);
    return res.status(500).json({ error: "Error al obtener proponentes" });
  }
};

const obtenerProponentes = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || "";

  const user = req.user || {};

  try {
    const filtros = [];
    const valores = [];

    if (search) {
      filtros.push(
        `(c.nombre ILIKE $${valores.length + 1} OR c.apellido ILIKE $${valores.length + 1} OR CAST(c.cedularuc AS TEXT) ILIKE $${valores.length + 1})`
      );
      valores.push(`%${search}%`);
    }

    if (!isAdmin(user)) {
      const ids = await getClientesPermitidosRBAC(user);
      if (!ids.length) {
        return res.json({ data: [], page, totalPages: 1, totalItems: 0 });
      }
      filtros.push(`c.id_cliente = ANY($${valores.length + 1}::int[])`);
      valores.push(ids);
    }

    const whereClause = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const totalQuery = `SELECT COUNT(*) FROM ema.cliente c ${whereClause}`;
    const totalResult = await pool.query(totalQuery, valores);
    const total = parseInt(totalResult.rows[0].count, 10) || 0;

    const consultaPaginada = `
      SELECT *
      FROM ema.cliente c
      ${whereClause}
      ORDER BY id_cliente
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `;
    const result = await pool.query(consultaPaginada, [...valores, limit, offset]);

    res.json({
      data: result.rows,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      totalItems: total,
    });
  } catch (error) {
    console.error("Error al obtener proponentes:", error);
    res.status(500).json({ error: "Error al obtener proponentes" });
  }
};

const obtenerProponentePorId = async (req, res) => {
  const { id } = req.params;
  const user = req.user || {};

  try {
    if (!isAdmin(user)) {
      const ids = await getClientesPermitidosRBAC(user);
      const idNum = parseInt(id, 10);
      if (!ids.includes(idNum)) {
        return res.status(403).json({ error: "Sin permiso para ver este proponente" });
      }
    }

    const result = await pool.query("SELECT * FROM ema.cliente WHERE id_cliente = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Proponente no encontrado" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener proponente:", error);
    res.status(500).json({ error: "Error al obtener proponente" });
  }
};

const crearProponente = async (req, res) => {
  let {
    cedularuc,
    nombre,
    apellido,
    email,
    fecha_nac,
    sexo,
    tipo_persona,
    telefono,
    direccion,
    tipo_empresa,
    nacionalidad,
    rlegal_cedula,
    rlegal_nombre,
    rlegal_apellido,
    rlegal_sexo,
    dvi,
  } = req.body;

  const { ok, errores } = validarProponenteInput(req.body);
  if (!ok) {
    return res.status(400).json({ error: "Hay errores en el formulario.", fields: errores });
  }

  dvi = toNullableNumber(dvi);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  fecha_nac = toNullableDate(fecha_nac);

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
      cedularuc,
      nombre,
      apellido,
      email,
      fecha_nac,
      sexo,
      tipo_persona,
      telefono,
      direccion,
      tipo_empresa,
      nacionalidad,
      rlegal_cedula,
      rlegal_nombre,
      rlegal_apellido,
      rlegal_sexo,
      dvi,
    ]);

    const nuevoId = result.rows[0].id_cliente;

    res.status(201).json({
      success: true,
      message: "Proponente creado correctamente",
      id_cliente: nuevoId,
    });
  } catch (error) {
    console.error("Error al crear proponente:", error);

    if (error.code === "23505") {
      return res.status(400).json({ error: "Ya existe un proponente con esa cedula/RUC." });
    }
    if (error.code === "22001") {
      return res.status(400).json({ error: "Uno de los campos excede el tamano permitido." });
    }
    if (error.code === "22007") {
      return res.status(400).json({ error: "La fecha tiene un formato invalido." });
    }
    if (error.code === "23502") {
      return res.status(400).json({ error: "Un campo obligatorio no puede ser nulo." });
    }

    res.status(500).json({ error: "Error al crear proponente" });
  }
};

const actualizarProponente = async (req, res) => {
  const { id } = req.params;
  let {
    cedularuc,
    nombre,
    apellido,
    email,
    fecha_nac,
    sexo,
    tipo_persona,
    telefono,
    direccion,
    tipo_empresa,
    nacionalidad,
    rlegal_cedula,
    rlegal_nombre,
    rlegal_apellido,
    rlegal_sexo,
    dvi,
  } = req.body;

  const { ok, errores } = validarProponenteInput(req.body);
  if (!ok) {
    return res.status(400).json({ error: "Hay errores en el formulario.", fields: errores });
  }

  dvi = toNullableNumber(dvi);
  rlegal_cedula = toNullableNumber(rlegal_cedula);
  fecha_nac = toNullableDate(fecha_nac);

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
      cedularuc,
      nombre,
      apellido,
      email,
      fecha_nac,
      sexo,
      tipo_persona,
      telefono,
      direccion,
      tipo_empresa,
      nacionalidad,
      rlegal_cedula,
      rlegal_nombre,
      rlegal_apellido,
      rlegal_sexo,
      dvi,
      id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Proponente no encontrado" });
    }

    res.json({ success: true, message: "Proponente actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar proponente:", error);

    if (error.code === "23505") {
      return res.status(400).json({ error: "Ya existe un proponente con esa cedula/RUC." });
    }
    if (error.code === "22001") {
      return res.status(400).json({ error: "Uno de los campos excede el tamano permitido." });
    }
    if (error.code === "22007") {
      return res.status(400).json({ error: "La fecha tiene un formato invalido." });
    }
    if (error.code === "23502") {
      return res.status(400).json({ error: "Un campo obligatorio no puede ser nulo." });
    }

    res.status(500).json({ error: "Error al actualizar proponente" });
  }
};

const eliminarProponente = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM ema.cliente WHERE id_cliente = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Proponente no encontrado" });
    }
    res.json({ success: true, message: "Proponente eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar proponente:", error);
    res.status(500).json({ error: "Error al eliminar proponente" });
  }
};

module.exports = {
  obtenerProponentesDropdown,
  obtenerProponentes,
  obtenerProponentePorId,
  crearProponente,
  actualizarProponente,
  eliminarProponente,
};
