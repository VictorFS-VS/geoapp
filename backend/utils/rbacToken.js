// backend/utils/rbacToken.js
"use strict";

const pool = require("../db");

/**
 * Scope ranking (para resolver conflictos si hay varios roles):
 * all > project > own > none
 */
function rankScope(scope) {
  const s = String(scope || "none").toLowerCase();
  if (s === "all") return 4;
  if (s === "project") return 3;
  if (s === "own") return 2;
  return 1; // none
}

function normalizeScope(scope) {
  const s = String(scope || "none").toLowerCase();
  if (s === "all" || s === "project" || s === "own" || s === "none") return s;
  return "none";
}

/**
 * Obtiene TODOS los roles del usuario (multi-rol):
 * public.users_groups (fuente principal)
 * + fallback opcional: users.tipo_usuario/group_id (por compat)
 */
async function loadUserRoleIds(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return [];

  const r = await pool.query(
    `SELECT DISTINCT group_id
       FROM public.users_groups
      WHERE user_id = $1
      ORDER BY group_id`,
    [uid]
  );

  const roleIds = (r.rows || []).map((x) => Number(x.group_id)).filter((n) => Number.isFinite(n) && n > 0);
  if (roleIds.length) return roleIds;

  // fallback (por si todavía hay users sin users_groups cargado)
  const r2 = await pool.query(
    `SELECT COALESCE(tipo_usuario, group_id) AS role_id
       FROM public.users
      WHERE id = $1`,
    [uid]
  );
  const rid = Number(r2.rows?.[0]?.role_id || 0);
  return rid > 0 ? [rid] : [];
}

/**
 * Carga permisos desde:
 * public.role_permissions rp
 * join public.permissions p
 * para TODOS los roles del usuario
 *
 * Devuelve:
 * - perms: string[]
 * - permsScope: { [code]: "all"|"project"|"own"|"none" }
 * - roleIds: number[]
 */
async function loadUserPermsAndScope(userId) {
  const roleIds = await loadUserRoleIds(userId);
  if (!roleIds.length) return { perms: [], permsScope: {}, roleIds: [] };

  const r = await pool.query(
    `SELECT p.code, rp.scope
       FROM public.role_permissions rp
       JOIN public.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ANY($1::int[])
      ORDER BY p.code`,
    [roleIds]
  );

  const permsSet = new Set();
  const permsScope = {}; // code -> bestScope

  for (const row of r.rows || []) {
    const code = String(row.code || "").trim();
    if (!code) continue;

    const scope = normalizeScope(row.scope);
    permsSet.add(code);

    const prev = permsScope[code];
    if (!prev || rankScope(scope) > rankScope(prev)) {
      permsScope[code] = scope;
    }
  }

  return { perms: Array.from(permsSet), permsScope, roleIds };
}

module.exports = { loadUserPermsAndScope, loadUserRoleIds };