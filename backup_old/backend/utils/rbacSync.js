// backend/utils/rbacSync.js
"use strict";

const pool = require("../db");

/**
 * Decide el rol principal (para compat legacy).
 * Regla sugerida:
 * - si viene primaryRoleId y el user lo tiene -> usar ese
 * - si no, usar el menor id (o el primero ordenado) para que sea determinístico
 */
async function syncUserPrimaryRoleId(userId, primaryRoleId = null, client = pool) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error("userId inválido");

  const { rows } = await client.query(
    `SELECT group_id
       FROM public.users_groups
      WHERE user_id = $1
      ORDER BY group_id ASC`,
    [uid]
  );

  const roleIds = rows.map(r => Number(r.group_id)).filter(Number.isFinite);

  // Si no tiene roles, dejamos tipo_usuario NULL (o lo que prefieras)
  let picked = null;

  if (primaryRoleId !== null && primaryRoleId !== undefined && primaryRoleId !== "") {
    const pr = Number(primaryRoleId);
    if (Number.isFinite(pr) && roleIds.includes(pr)) picked = pr;
  }
  if (!picked && roleIds.length) picked = roleIds[0];

  await client.query(
    `UPDATE public.users
        SET tipo_usuario = $2,
            fecha_actualizacion = now()
      WHERE id = $1`,
    [uid, picked]
  );

  return { primaryRoleId: picked, roleIds };
}

module.exports = { syncUserPrimaryRoleId };
