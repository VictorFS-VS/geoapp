// backend/utils/roles.js
"use strict";

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getPrimaryRole(user = {}) {
  return toInt(user.tipo_usuario ?? user.group_id ?? 0);
}

function getRoleIds(user = {}) {
  const roles = Array.isArray(user.role_ids) ? user.role_ids : [];
  const set = new Set(roles.map(toInt).filter(Boolean));

  const primary = getPrimaryRole(user);
  if (primary) set.add(primary);

  return Array.from(set);
}

function hasRole(user = {}, roleId) {
  const rid = toInt(roleId);
  if (!rid) return false;
  return getRoleIds(user).includes(rid);
}

module.exports = { getPrimaryRole, getRoleIds, hasRole };
