// controllers/usuarios.controller.js
// EMA Group – Usuarios + Avatares + Cartera (RBAC multi-roles friendly)
// - NO pisa roles (users_groups) en crear/actualizar
// - Roles se gestionan SOLO por /api/rbac/users/:id/roles
// - tipo_usuario queda como "rol principal" por compat (columna legacy)

"use strict";

const pool = require("../db");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");

/* =========================
   Helpers de error HTTP
   ========================= */
function pickStatusFromError(err, fallback = 500) {
  if (err?.code === "23505") return 409;
  const m = (err?.message || "").toLowerCase();
  if (
    m.includes("obligatorio") ||
    m.includes("invalido") || m.includes("inválido") ||
    m.includes("no existe") || m.includes("requerido") ||
    m.includes("formato") || m.includes("contraseña") ||
    m.includes("ya existe") || m.includes("duplicado")
  ) return 400;
  return fallback;
}

function sendHttpError(res, err, fallbackMsg = "Error interno") {
  const status = pickStatusFromError(err, 500);
  const payload = { error: err?.message || fallbackMsg };
  if (err?.code) payload.code = err.code;
  if (err?.detail) payload.detail = err.detail;
  return res.status(status).json(payload);
}

/* =========================
   IDs reales según public.groups
   ========================= */
const GROUPS = {
  ADMIN: 1,
  SISTEMAS: 3,
  ADMINISTRADOR_SAAP: 6,
  CLIENTE_OFF_SAAP: 7,
  CONSULTOR_SAAP: 8,
  CLIENTE_SAAP: 9,
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,
  BASE: 13,
  CONSULTOR_VIAL: 14,
  CONSULTOR_VIP: 15,
};

// Roles que deben comportarse como consultor para cartera/proyectos
const CONSULTOR_LIKE = new Set([
  GROUPS.CONSULTOR_SAAP,
  GROUPS.CONSULTOR_VIAL,
  GROUPS.CONSULTOR_VIP,
  GROUPS.BASE, // si BASE no debe comportarse así, sacalo
]);

// Roles que se comportan como cliente
const CLIENTE_LIKE = new Set([
  GROUPS.CLIENTE_SAAP,
  GROUPS.CLIENTE_VIAL,
  GROUPS.CLIENTE_MAPS,
  GROUPS.CLIENTE_OFF_SAAP,
]);

/* =========================
   Tablas de cartera
   ========================= */
const TABLE_CARTERA_ADMIN   = "ema.cliente_admin_miembro";      // (admin_id, miembro_id)
const TABLE_CARTERA_CONS    = "ema.consultor_cliente_miembro";  // (consultor_id, miembro_id)
const TABLE_CARTERA_CLIENTE = "ema.cliente_cartera_miembro";    // (cliente_id, miembro_id)

/* =========================
   Helpers genéricos
   ========================= */
const normalizeInt = (val) => {
  const num = parseInt(val, 10);
  return Number.isFinite(num) ? num : null;
};

// fuerza 0/1, acepta "true/false", "si/no", etc.
const to01 = (v, def = 1) => {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "si", "sí", "on", "y"].includes(s)) return 1;
  if (["0", "false", "no", "off", "n"].includes(s)) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? (n ? 1 : 0) : def;
};

async function existeCliente(idCliente) {
  if (!idCliente) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM ema.cliente WHERE id_cliente = $1 LIMIT 1",
    [idCliente]
  );
  return rows.length > 0;
}

async function existeConsultor(idConsultor) {
  if (!idConsultor) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM ema.consultores WHERE id_consultor = $1 LIMIT 1",
    [idConsultor]
  );
  return rows.length > 0;
}

async function existeGrupo(groupId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM public.groups WHERE id = $1 LIMIT 1",
    [groupId]
  );
  return rows.length > 0;
}

async function validarMiembrosCliente(miembros = []) {
  for (const m of miembros) {
    const id = parseInt(m, 10);
    if (!Number.isFinite(id)) {
      throw new Error(`Miembro de cartera inválido: ${m}`);
    }
    if (!(await existeCliente(id))) {
      throw new Error(`El cliente ${id} no existe`);
    }
  }
}

/* =========================
   RBAC: roles reales del user
   ========================= */
async function getUserRoleIds(clientOrPool, userId) {
  const q = "SELECT group_id FROM public.users_groups WHERE user_id = $1";
  const { rows } = await clientOrPool.query(q, [userId]);
  return rows.map((r) => Number(r.group_id)).filter(Number.isFinite);
}

/* =========================
   Cartera upserts
   ========================= */
async function upsertCarteraAdmin(client, adminClienteId, miembros) {
  await client.query(`DELETE FROM ${TABLE_CARTERA_ADMIN} WHERE admin_id = $1`, [adminClienteId]);

  const validos = (miembros || [])
    .map((v) => parseInt(v, 10))
    .filter(Number.isFinite);

  if (!validos.length) return;

  const values = [];
  const params = [adminClienteId];

  validos.forEach((mid, i) => {
    values.push(`($1, $${i + 2})`);
    params.push(mid);
  });

  const sql = `
    INSERT INTO ${TABLE_CARTERA_ADMIN} (admin_id, miembro_id)
    VALUES ${values.join(", ")}
    ON CONFLICT (admin_id, miembro_id) DO NOTHING
  `;
  await client.query(sql, params);
}

async function upsertCarteraConsultor(client, consultorId, miembros) {
  await client.query(`DELETE FROM ${TABLE_CARTERA_CONS} WHERE consultor_id = $1`, [consultorId]);

  const validos = (miembros || [])
    .map((v) => parseInt(v, 10))
    .filter(Number.isFinite);

  if (!validos.length) return;

  const values = [];
  const params = [consultorId];

  validos.forEach((mid, i) => {
    values.push(`($1, $${i + 2})`);
    params.push(mid);
  });

  const sql = `
    INSERT INTO ${TABLE_CARTERA_CONS} (consultor_id, miembro_id)
    VALUES ${values.join(", ")}
    ON CONFLICT (consultor_id, miembro_id) DO NOTHING
  `;
  await client.query(sql, params);
}

async function upsertCarteraCliente(client, clienteId, miembros) {
  await client.query(`DELETE FROM ${TABLE_CARTERA_CLIENTE} WHERE cliente_id = $1`, [clienteId]);

  const validos = (miembros || [])
    .map((v) => parseInt(v, 10))
    .filter((v) => Number.isFinite(v) && v !== parseInt(clienteId, 10));

  if (!validos.length) return;

  const values = [];
  const params = [clienteId];

  validos.forEach((mid, i) => {
    values.push(`($1, $${i + 2})`);
    params.push(mid);
  });

  const sql = `
    INSERT INTO ${TABLE_CARTERA_CLIENTE} (cliente_id, miembro_id)
    VALUES ${values.join(", ")}
    ON CONFLICT (cliente_id, miembro_id) DO NOTHING
  `;
  await client.query(sql, params);
}

/* =========================
   AVATAR helpers
   ========================= */
const AVATARS_DIR = path.join(__dirname, "..", "uploads", "avatars");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(AVATARS_DIR);

function defaultColorByGroup(gid) {
  switch (parseInt(gid, 10)) {
    case GROUPS.ADMIN:              return "#0d6efd";
    case GROUPS.SISTEMAS:           return "#111827";
    case GROUPS.ADMINISTRADOR_SAAP: return "#f44336";
    case GROUPS.CONSULTOR_SAAP:     return "#20c997";
    case GROUPS.CONSULTOR_VIAL:     return "#382bee";
    case GROUPS.CONSULTOR_VIP:      return "#b4bd32";
    case GROUPS.CLIENTE_SAAP:       return "#6c757d";
    case GROUPS.CLIENTE_VIAL:       return "#31da25";
    case GROUPS.ADMIN_CLIENTE:      return "#3b46de";
    case GROUPS.CLIENTE_MAPS:       return "#65f58b";
    case GROUPS.CLIENTE_OFF_SAAP:   return "#2196f3";
    default:                        return "#adb5bd";
  }
}

function initials(u) {
  const base = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (base) {
    const parts = base.split(/\s+/);
    const init = (parts[0]?.[0] || "").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
    return init || (u.username?.[0] || "U").toUpperCase();
  }
  return (u.username?.[0] || "U").toUpperCase();
}

function svgAvatar(userRow) {
  const color = defaultColorByGroup(userRow?.tipo_usuario);
  const text = initials(userRow || {});
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="160" height="160" rx="80" fill="${color}"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="64" fill="#fff" font-weight="700">${text}</text>
</svg>`;
}

function blankSvg(fill = "#adb5bd") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="160" height="160" rx="80" fill="${fill}"/>
</svg>`;
}

function absoluteAvatarPath(filename) {
  if (!filename) return null;

  const clean = String(filename).trim().replace(/[\r\n]+/g, "");
  let base = path.basename(clean);

  let full = path.join(AVATARS_DIR, base);
  if (fs.existsSync(full)) return full;

  const ensureWithExt = (b) => {
    if (/\.[a-z0-9]+$/i.test(b)) return null;
    for (const ext of [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]) {
      const test = path.join(AVATARS_DIR, b + ext);
      if (fs.existsSync(test)) return test;
    }
    return null;
  };

  const withExt = ensureWithExt(base);
  if (withExt) return withExt;

  if (!/^u/i.test(base)) {
    const alt = "u" + base;
    full = path.join(AVATARS_DIR, alt);
    if (fs.existsSync(full)) return full;

    const withExt2 = ensureWithExt(alt);
    if (withExt2) return withExt2;
  }

  const prefixList = [
    base.replace(/\.[^.]+$/, ""),
    (!/^u/i.test(base) ? "u" + base : base).replace(/\.[^.]+$/, "")
  ];

  try {
    const files = fs.readdirSync(AVATARS_DIR);
    for (const pref of prefixList) {
      const hit = files.find((f) => f.startsWith(pref + "_") || f === pref);
      if (hit) {
        const cand = path.join(AVATARS_DIR, hit);
        if (fs.existsSync(cand)) return cand;
      }
    }
  } catch (_) {}

  return null;
}

/* =========================
   Avatares (ENDPOINTS)
   ========================= */
async function getAvatar(req, res) {
  res.set("Cache-Control", "no-store");

  const m = String(req.params.id || "").match(/^\d+/);
  const id = m ? parseInt(m[0], 10) : null;
  const wantBlank = req.query.blank === "1" || req.query.noInitials === "1";

  try {
    if (!Number.isFinite(id)) {
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      return res.send(wantBlank ? blankSvg() : svgAvatar({ tipo_usuario: null, username: "U" }));
    }

    const { rows } = await pool.query(
      "SELECT id, username, first_name, last_name, tipo_usuario, avatar FROM public.users WHERE id=$1",
      [id]
    );

    if (!rows.length) {
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      return res.send(wantBlank ? blankSvg() : svgAvatar({ tipo_usuario: null, username: "U" }));
    }

    const u = rows[0];
    const full = absoluteAvatarPath(u.avatar);

    if (full) {
      const type = mime.lookup(full) || "image/png";
      res.setHeader("Content-Type", type);
      return fs.createReadStream(full).pipe(res);
    }

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    return res.send(wantBlank ? blankSvg(defaultColorByGroup(u?.tipo_usuario)) : svgAvatar(u));
  } catch (e) {
    console.error("getAvatar:", e);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    return res.send(wantBlank ? blankSvg() : svgAvatar({ tipo_usuario: null, username: "U" }));
  }
}

async function uploadAvatar(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  try {
    const { rows } = await pool.query("SELECT avatar FROM public.users WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo "avatar"' });

    const prev = absoluteAvatarPath(rows[0].avatar);
    if (prev) {
      try { fs.unlinkSync(prev); } catch {}
    }

    const filename = req.file.filename;
    await pool.query(
      "UPDATE public.users SET avatar=$1, fecha_actualizacion=now() WHERE id=$2",
      [filename, id]
    );

    res.json({ success: true, message: "Avatar actualizado", filename });
  } catch (e) {
    console.error("uploadAvatar:", e);
    res.status(500).json({ error: "Error al subir avatar" });
  }
}

async function deleteAvatar(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  try {
    const { rows } = await pool.query("SELECT avatar FROM public.users WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const prev = absoluteAvatarPath(rows[0].avatar);
    if (prev) {
      try { fs.unlinkSync(prev); } catch {}
    }

    await pool.query(
      "UPDATE public.users SET avatar=NULL, fecha_actualizacion=now() WHERE id=$1",
      [id]
    );

    res.json({ success: true, message: "Avatar eliminado" });
  } catch (e) {
    console.error("deleteAvatar:", e);
    res.status(500).json({ error: "Error al eliminar avatar" });
  }
}

/* =========================
   CRUD de usuarios
   ========================= */

// GET /api/usuarios?page=1&limit=10&search=...
const obtenerUsuarios = async (req, res) => {
  const userId = req.user.id;
  const myPrimaryGroupId = normalizeInt(req.user.tipo_usuario) ?? normalizeInt(req.user.group_id);

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const search = (req.query.search || "").trim();

  try {
    let filtros = "";
    let valores = [];

    if (CLIENTE_LIKE.has(myPrimaryGroupId)) {
      filtros = `WHERE id = $1`;
      valores = [userId];
    } else if (search) {
      filtros = `WHERE username ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1`;
      valores.push(`%${search}%`);
    }

    const totalQuery = `SELECT COUNT(*) FROM public.users ${filtros}`;
    const totalResult = await pool.query(totalQuery, valores);
    const total = parseInt(totalResult.rows[0].count, 10);

    const consultaPaginada = `
      SELECT
        u.*,
        COALESCE(
          (SELECT json_agg(ug.group_id ORDER BY ug.group_id)
             FROM public.users_groups ug
            WHERE ug.user_id = u.id),
          '[]'::json
        ) AS role_ids
      FROM public.users u
      ${filtros}
      ORDER BY u.id
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `;
    const result = await pool.query(consultaPaginada, [...valores, limit, offset]);

    res.json({
      data: result.rows,
      page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
    });
  } catch (error) {
    console.error("Error al obtener usuarios:", error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
};

const obtenerUsuarioPorId = async (req, res) => {
  const { id } = req.params;
  const requesterId = req.user.id;
  const myPrimaryGroupId = normalizeInt(req.user.tipo_usuario) ?? normalizeInt(req.user.group_id);

  try {
    if (parseInt(id, 10) !== requesterId && myPrimaryGroupId !== GROUPS.ADMIN) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const result = await pool.query(
      `
      SELECT
        u.*,
        COALESCE(
          (SELECT json_agg(ug.group_id ORDER BY ug.group_id)
             FROM public.users_groups ug
            WHERE ug.user_id = u.id),
          '[]'::json
        ) AS role_ids
      FROM public.users u
      WHERE u.id = $1
      `,
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener usuario:", error);
    res.status(500).json({ error: "Error al obtener usuario" });
  }
};

const crearUsuario = async (req, res) => {
  const client = await pool.connect();

  try {
    let {
      ip_address = "",
      username,
      password,
      salt = "",
      email,
      activation_code = "",
      forgotten_password_code = "",
      forgotten_password_time = "",
      remember_code = "",
      last_login = "",
      active,
      first_name = "",
      last_name = "",
      company = "",
      phone = "",
      group_id,
      tipo_usuario,
      id_cliente,
      id_consultor,
      miembros_cliente,
    } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Usuario, email y contraseña son obligatorios" });
    }

    const initialRoleId = normalizeInt(group_id) ?? normalizeInt(tipo_usuario);
    if (!initialRoleId) {
      return res.status(400).json({ error: "Debe especificar group_id (o tipo_usuario) válido" });
    }

    if (!(await existeGrupo(initialRoleId))) {
      return res.status(400).json({ error: `group_id ${initialRoleId} no existe` });
    }

    const idClienteInt = normalizeInt(id_cliente);
    const idConsultorInt = normalizeInt(id_consultor);

    if (initialRoleId === GROUPS.ADMIN_CLIENTE) {
      if (!idClienteInt) {
        return res.status(400).json({ error: "Para ADMIN_CLIENTE es obligatorio id_cliente" });
      }
      if (!(await existeCliente(idClienteInt))) {
        return res.status(400).json({ error: `id_cliente ${idClienteInt} no existe` });
      }
    }

    if (CONSULTOR_LIKE.has(initialRoleId)) {
      if (idConsultorInt && !(await existeConsultor(idConsultorInt))) {
        return res.status(400).json({ error: `id_consultor ${idConsultorInt} no existe` });
      }
      if (Array.isArray(miembros_cliente) && miembros_cliente.length > 0 && !idConsultorInt) {
        return res.status(400).json({ error: "Para CONSULTOR con cartera es obligatorio id_consultor" });
      }
    }

    if (CLIENTE_LIKE.has(initialRoleId)) {
      if (!idClienteInt) {
        return res.status(400).json({ error: "Para CLIENTE con cartera es obligatorio id_cliente" });
      }
      if (!(await existeCliente(idClienteInt))) {
        return res.status(400).json({ error: `id_cliente ${idClienteInt} no existe` });
      }
    }

    if (Array.isArray(miembros_cliente)) {
      await validarMiembrosCliente(miembros_cliente);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const created_on = Math.floor(Date.now() / 1000);
    const active01 = to01(active, 1);

    await client.query("BEGIN");

    const insertUserSql = `
      INSERT INTO public.users (
        ip_address, username, password, salt, email,
        activation_code, forgotten_password_code, forgotten_password_time,
        remember_code, created_on, last_login, active,
        first_name, last_name, company, phone,
        tipo_usuario, id_cliente, id_consultor,
        fecha_creacion, fecha_actualizacion
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,$19,
        now(), now()
      )
      RETURNING id
    `;

    const { rows: userRows } = await client.query(insertUserSql, [
      ip_address,
      username,
      hashedPassword,
      salt,
      email,
      activation_code,
      forgotten_password_code,
      normalizeInt(forgotten_password_time),
      remember_code,
      created_on,
      normalizeInt(last_login),
      active01,
      first_name,
      last_name,
      company,
      phone,
      initialRoleId,
      idClienteInt,
      idConsultorInt,
    ]);

    const newUserId = userRows[0]?.id;

    await client.query(
      `
      INSERT INTO public.users_groups (user_id, group_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, group_id) DO NOTHING
      `,
      [newUserId, initialRoleId]
    );

    if (initialRoleId === GROUPS.ADMIN_CLIENTE && Array.isArray(miembros_cliente)) {
      await upsertCarteraAdmin(client, idClienteInt, miembros_cliente);
    }

    if (CONSULTOR_LIKE.has(initialRoleId) && Array.isArray(miembros_cliente)) {
      await upsertCarteraConsultor(client, idConsultorInt, miembros_cliente);
    }

    if (CLIENTE_LIKE.has(initialRoleId) && Array.isArray(miembros_cliente)) {
      await upsertCarteraCliente(client, idClienteInt, miembros_cliente);
    }

    await client.query("COMMIT");
    res.status(201).json({ success: true, message: "Usuario creado correctamente", id: newUserId });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error?.code === "23505") error.message = "El usuario o email ya existe";
    console.error("Error al crear usuario:", error);
    return sendHttpError(res, error, "Error al crear usuario");
  } finally {
    client.release();
  }
};

const actualizarUsuario = async (req, res) => {
  const { id } = req.params;
  const targetId = parseInt(id, 10);
  if (!Number.isFinite(targetId)) return res.status(400).json({ error: "id inválido" });

  const myPrimaryGroupId = normalizeInt(req.user.tipo_usuario) ?? normalizeInt(req.user.group_id);
  const requesterId = req.user.id;

  if (CONSULTOR_LIKE.has(myPrimaryGroupId) && requesterId !== targetId) {
    return res.status(403).json({ error: "No tiene permiso para editar este usuario" });
  }

  const client = await pool.connect();

  try {
    const { rows } = await client.query("SELECT * FROM public.users WHERE id = $1", [targetId]);
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
    const existente = rows[0];

    const targetRoles = await getUserRoleIds(client, targetId);

    let finalTipoUsuario = existente.tipo_usuario;

    let {
      ip_address = existente.ip_address,
      username = existente.username,
      salt = existente.salt,
      email = existente.email,
      activation_code = existente.activation_code,
      forgotten_password_code = existente.forgotten_password_code,
      forgotten_password_time = existente.forgotten_password_time,
      remember_code = existente.remember_code,
      created_on = existente.created_on,
      last_login = existente.last_login,
      active = existente.active,
      first_name = existente.first_name,
      last_name = existente.last_name,
      company = existente.company,
      phone = existente.phone,
      id_cliente = existente.id_cliente,
      id_consultor = existente.id_consultor,
      miembros_cliente,
    } = req.body;

    const selfEdit = requesterId === targetId;
    const isAdminRequester = myPrimaryGroupId === GROUPS.ADMIN;

    if (CLIENTE_LIKE.has(myPrimaryGroupId) && selfEdit) {
      email = req.body.email ?? existente.email;
      phone = req.body.phone ?? existente.phone;

      username = existente.username;
      first_name = existente.first_name;
      last_name = existente.last_name;
      company = existente.company;
      ip_address = existente.ip_address;
      salt = existente.salt;

      id_cliente = existente.id_cliente;
      id_consultor = existente.id_consultor;
    }

    const requestedActive = Object.prototype.hasOwnProperty.call(req.body, "active")
      ? to01(req.body.active, existente.active)
      : existente.active;

    if (Object.prototype.hasOwnProperty.call(req.body, "active")) {
      if (!isAdminRequester && !selfEdit) {
        return res.status(403).json({ error: "No tiene permiso para cambiar el estado activo" });
      }
      if (selfEdit && requestedActive === 0) {
        return res.status(400).json({ error: "No puede desactivar su propia cuenta" });
      }
    }

    let newPassword = existente.password;
    const cambiarPassword =
      req.body &&
      (req.body.cambiarPassword === true ||
        req.body.cambiarPassword === "1" ||
        req.body.cambiarPassword === 1);

    if (cambiarPassword && Object.prototype.hasOwnProperty.call(req.body, "password")) {
      const raw = typeof req.body.password === "string" ? req.body.password.trim() : "";
      if (raw) newPassword = await bcrypt.hash(raw, 10);
    }

    const idClienteInt = normalizeInt(id_cliente);
    const idConsultorInt = normalizeInt(id_consultor);

    if (targetRoles.includes(GROUPS.ADMIN_CLIENTE)) {
      if (!idClienteInt) {
        return res.status(400).json({ error: "Para rol ADMIN_CLIENTE es obligatorio id_cliente" });
      }
      if (!(await existeCliente(idClienteInt))) {
        return res.status(400).json({ error: `id_cliente ${idClienteInt} no existe` });
      }
    }

    const targetIsConsultorLike = targetRoles.some((r) => CONSULTOR_LIKE.has(r));
    if (targetIsConsultorLike) {
      if (idConsultorInt && !(await existeConsultor(idConsultorInt))) {
        return res.status(400).json({ error: `id_consultor ${idConsultorInt} no existe` });
      }
      if (Array.isArray(miembros_cliente) && miembros_cliente.length > 0 && !idConsultorInt) {
        return res.status(400).json({ error: "Para CONSULTOR con cartera es obligatorio id_consultor" });
      }
    }

    const targetIsClienteLike = targetRoles.some((r) => CLIENTE_LIKE.has(r));
    if (targetIsClienteLike) {
      if (!idClienteInt) {
        return res.status(400).json({ error: "Para CLIENTE con cartera es obligatorio id_cliente" });
      }
      if (!(await existeCliente(idClienteInt))) {
        return res.status(400).json({ error: `id_cliente ${idClienteInt} no existe` });
      }
    }

    if (Array.isArray(miembros_cliente)) {
      await validarMiembrosCliente(miembros_cliente);
    }

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE public.users SET
        ip_address=$1, username=$2, password=$3, salt=$4, email=$5,
        activation_code=$6, forgotten_password_code=$7, forgotten_password_time=$8,
        remember_code=$9, created_on=$10, last_login=$11, active=$12,
        first_name=$13, last_name=$14, company=$15, phone=$16,
        tipo_usuario=$17, id_cliente=$18, id_consultor=$19,
        fecha_actualizacion = now()
      WHERE id = $20
      `,
      [
        ip_address,
        username,
        newPassword,
        salt,
        email,
        activation_code,
        forgotten_password_code,
        normalizeInt(forgotten_password_time),
        remember_code,
        normalizeInt(created_on),
        normalizeInt(last_login),
        to01(requestedActive, existente.active),
        first_name,
        last_name,
        company,
        phone,
        finalTipoUsuario,
        idClienteInt,
        idConsultorInt,
        targetId,
      ]
    );

    if (Array.isArray(miembros_cliente)) {
      if (targetRoles.includes(GROUPS.ADMIN_CLIENTE) && idClienteInt) {
        await upsertCarteraAdmin(client, idClienteInt, miembros_cliente);
      }

      if (targetIsConsultorLike && idConsultorInt) {
        await upsertCarteraConsultor(client, idConsultorInt, miembros_cliente);
      }

      if (targetIsClienteLike && idClienteInt) {
        await upsertCarteraCliente(client, idClienteInt, miembros_cliente);
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, message: "Usuario actualizado correctamente" });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error?.code === "23505") error.message = "El usuario o email ya existe";
    console.error("Error al actualizar usuario:", error);
    return sendHttpError(res, error, "Error al actualizar usuario");
  } finally {
    client.release();
  }
};

const eliminarUsuario = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM public.users WHERE id = $1", [id]);
    if (!result.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ success: true, message: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar usuario:", error);
    res.status(500).json({ error: "Error al eliminar usuario" });
  }
};

const obtenerUsuarioActual = async (req, res) => {
  const id = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT
        u.id, u.username,
        u.tipo_usuario, u.tipo_usuario AS group_id,
        u.id_cliente, u.email,
        u.first_name, u.last_name, u.phone, u.avatar, u.fecha_actualizacion,
        COALESCE(u.fecha_creacion, to_timestamp(NULLIF(u.created_on,0))) AS fecha_creacion,
        u.id_consultor, u.active,
        COALESCE(
          (SELECT json_agg(ug.group_id ORDER BY ug.group_id)
             FROM public.users_groups ug
            WHERE ug.user_id = u.id),
          '[]'::json
        ) AS role_ids
      FROM public.users u
      WHERE u.id = $1
      `,
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const base = result.rows[0];

    const perms = Array.isArray(req.user?.perms) ? req.user.perms : [];
    const permsScope =
      req.user?.permsScope && typeof req.user.permsScope === "object"
        ? req.user.permsScope
        : {};

    const role_ids =
      Array.isArray(req.user?.role_ids) ? req.user.role_ids :
      Array.isArray(base?.role_ids) ? base.role_ids : [];

    return res.json({
      ...base,
      role_ids,
      perms,
      permsScope,
    });
  } catch (error) {
    console.error("Error al obtener el usuario actual:", error);
    res.status(500).json({ error: "Error al obtener el usuario actual" });
  }
};

async function guardarTokenFcm(req, res) {
  const userId = req.user?.id;
  const { token_fcm } = req.body;

  if (!token_fcm) {
    return res.status(400).json({ message: "Token FCM es requerido" });
  }

  try {
    await pool.query(
      `UPDATE public.users SET token_fcm = $1, fecha_actualizacion = now() WHERE id = $2`,
      [token_fcm, userId]
    );
    res.json({ success: true, message: "Token FCM guardado correctamente" });
  } catch (err) {
    console.error("Error al guardar token FCM:", err);
    res.status(500).json({ message: "Error al guardar el token" });
  }
}

// GET /api/usuarios/:id/cartera
const obtenerCarteraAdmin = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "id inválido" });

  try {
    const { rows } = await pool.query(
      "SELECT id, id_cliente, id_consultor FROM public.users WHERE id=$1",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const u = rows[0];
    const roles = await getUserRoleIds(pool, userId);

    const cartera = new Set();

    if (roles.includes(GROUPS.ADMIN_CLIENTE) && u.id_cliente) {
      const q = `SELECT miembro_id FROM ${TABLE_CARTERA_ADMIN} WHERE admin_id = $1 ORDER BY miembro_id`;
      const { rows: r2 } = await pool.query(q, [u.id_cliente]);
      r2.forEach((x) => cartera.add(x.miembro_id));
    }

    const isConsultorLike = roles.some((r) => CONSULTOR_LIKE.has(r));
    if (isConsultorLike && u.id_consultor) {
      const q = `SELECT miembro_id FROM ${TABLE_CARTERA_CONS} WHERE consultor_id = $1 ORDER BY miembro_id`;
      const { rows: r3 } = await pool.query(q, [u.id_consultor]);
      r3.forEach((x) => cartera.add(x.miembro_id));
    }

    const isClienteLike = roles.some((r) => CLIENTE_LIKE.has(r));
    if (isClienteLike && u.id_cliente) {
      const q = `SELECT miembro_id FROM ${TABLE_CARTERA_CLIENTE} WHERE cliente_id = $1 ORDER BY miembro_id`;
      const { rows: r4 } = await pool.query(q, [u.id_cliente]);
      r4.forEach((x) => cartera.add(x.miembro_id));
    }

    return res.json({ data: Array.from(cartera).sort((a, b) => a - b) });
  } catch (e) {
    console.error("obtenerCartera:", e);
    res.status(500).json({ error: "Error interno" });
  }
};

module.exports = {
  obtenerUsuarios,
  obtenerUsuarioPorId,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  obtenerUsuarioActual,
  guardarTokenFcm,
  obtenerCarteraAdmin,

  // Avatares
  getAvatar,
  uploadAvatar,
  deleteAvatar,
};