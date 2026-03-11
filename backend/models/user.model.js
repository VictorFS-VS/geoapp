// src/models/user.model.js
const pool = require('../db');
const bcrypt = require('bcrypt');

/** Devuelve el usuario por username (incluye active) */
async function findUserByUsername(username) {
  const { rows } = await pool.query(
    `
    SELECT
      id, username, password, email,
      tipo_usuario, id_cliente, id_consultor,
      active
    FROM public.users
    WHERE username = $1
    LIMIT 1
    `,
    [username]
  );
  return rows[0] || null;
}

/** Crea usuario (active=1 por defecto por seguridad) */
async function createUser(username, rawPassword, ip, email) {
  const hash = await bcrypt.hash(rawPassword, 10);
  const created_on = Math.floor(Date.now() / 1000);

  const { rows } = await pool.query(
    `
    INSERT INTO public.users (
      ip_address, username, password, email, created_on, active
    ) VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    [ip || '', username, hash, email || '', created_on, 1]
  );
  return rows[0];
}

module.exports = { findUserByUsername, createUser };
