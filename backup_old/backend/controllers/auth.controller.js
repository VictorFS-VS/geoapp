//controllers/auth.controller.js
"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../db"); // ✅ necesario para consultar permissions
const { createUser, findUserByUsername } = require("../models/user.model");

/* =========================
   Helpers RBAC
   ========================= */

// Trae permisos + (opcional) scope desde role_permissions
async function getPermsByRole(roleId) {
  const r = await pool.query(
    `
    SELECT
      p.code,
      COALESCE(rp.scope::text, 'all') AS scope
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1
    ORDER BY p.code
    `,
    [roleId]
  );

  const perms = r.rows.map((x) => x.code);

  // mapa { permCode: scope } ej: { "proyectos.read": "own" }
  const permsScope = {};
  for (const x of r.rows) permsScope[x.code] = x.scope || "all";

  return { perms, permsScope };
}

function mustJwtSecret(res) {
  if (!process.env.JWT_SECRET) {
    console.error("❌ JWT_SECRET no definido");
    res.status(500).json({ error: "Clave JWT no configurada" });
    return false;
  }
  return true;
}

/**
 * POST /api/auth/register
 */
const register = async (req, res) => {
  const { username, password, email } = req.body;
  const ip = req.ip || req.connection?.remoteAddress || "";

  try {
    const exists = await findUserByUsername(username);
    if (exists) return res.status(400).json({ error: "Usuario ya existe" });

    await createUser(username, password, ip, email);
    res.json({ message: "Usuario creado correctamente" });
  } catch (err) {
    console.error("Error en register:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const valid = await bcrypt.compare(password, user.password || "");
    if (!valid) return res.status(401).json({ error: "Contraseña incorrecta" });

    // ⛔ Bloquea login si el usuario está inactivo
    if (Number(user.active) !== 1) {
      return res.status(403).json({ error: "Usuario desactivado. Contacte al administrador." });
    }

    if (!mustJwtSecret(res)) return;

    const roleId = Number(user.tipo_usuario);

    // ✅ RBAC: permisos por rol
    const { perms, permsScope } = await getPermsByRole(roleId);

    // ✅ payload
    const payload = {
      id: Number(user.id),
      username: user.username,
      email: user.email,
      tipo_usuario: roleId,
      group_id: roleId, // por compatibilidad
      id_cliente: user.id_cliente ? Number(user.id_cliente) : null,
      id_consultor: user.id_consultor ? Number(user.id_consultor) : null,
      default_proyecto_id: user.default_proyecto_id ? Number(user.default_proyecto_id) : null,

      // ✅ RBAC
      perms,
      permsScope,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.json({ token, user: payload });
  } catch (err) {
    console.error("❌ Error en login:", err);
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
};

/**
 * GET /api/auth/me
 */
const me = (req, res) => {
  // devolvemos lo que viene en el JWT (ya normalizado por middleware)
  const {
    id,
    username,
    email,
    tipo_usuario,
    group_id,
    id_cliente,
    id_consultor,
    default_proyecto_id,
    perms,
    permsScope,
  } = req.user;

  res.json({
    id,
    username,
    email,
    tipo_usuario,
    group_id,
    id_cliente,
    id_consultor,
    default_proyecto_id,
    perms,
    permsScope,
  });
};

module.exports = { register, login, me };
