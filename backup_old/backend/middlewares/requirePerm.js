// middlewares/requirePerm.js
"use strict";

const { loadUserPermsAndScope } = require("../utils/rbacToken");

const ADMIN_ROLE_ID = 1;

function getUserPerms(req) {
  const perms = req.user?.perms;
  return Array.isArray(perms) ? perms : [];
}

function isAdmin(req) {
  const primaryRole = Number(req.user?.tipo_usuario ?? req.user?.group_id ?? 0);
  if (primaryRole === ADMIN_ROLE_ID) return true;

  const roleIds = Array.isArray(req.user?.role_ids)
    ? req.user.role_ids
    : Array.isArray(req.user?.roleIds)
      ? req.user.roleIds
      : [];

  return roleIds.some((roleId) => Number(roleId) === ADMIN_ROLE_ID);
}

async function ensurePermsLoaded(req) {
  if (!req.user) return;
  const perms = getUserPerms(req);
  if (perms.length) return;

  const uid = Number(req.user?.id);
  if (!uid) return;

  const loaded = await loadUserPermsAndScope(uid);
  req.user.perms = loaded.perms;
  req.user.permsScope = loaded.permsScope;
  req.user.roleIds = loaded.roleIds;

  if (!req.user.group_id && loaded.roleIds?.length) req.user.group_id = loaded.roleIds[0];
}

function deny(res, payload) {
  return res.status(403).json(payload);
}

function requireAdmin() {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (isAdmin(req)) return next();
    return deny(res, { error: "Solo administradores" });
  };
}

function requirePerm(perm) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (isAdmin(req)) return next();

    await ensurePermsLoaded(req);

    const perms = getUserPerms(req);
    if (!perms.includes(perm)) return deny(res, { error: "Sin permiso", perm });

    next();
  };
}

function requireAny(permsRequired = []) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (isAdmin(req)) return next();

    await ensurePermsLoaded(req);

    const list = Array.isArray(permsRequired) ? permsRequired : [];
    if (!list.length) return deny(res, { error: "Sin permiso", permsRequired: list });

    const perms = getUserPerms(req);
    const ok = list.some((p) => perms.includes(p));
    if (!ok) return deny(res, { error: "Sin permiso", permsRequired: list });

    next();
  };
}

function requireAll(permsRequired = []) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    if (isAdmin(req)) return next();

    await ensurePermsLoaded(req);

    const list = Array.isArray(permsRequired) ? permsRequired : [];
    if (!list.length) return deny(res, { error: "Sin permiso", missing: list });

    const perms = getUserPerms(req);
    const missing = list.filter((p) => !perms.includes(p));
    if (missing.length) return deny(res, { error: "Sin permiso", missing });

    next();
  };
}

module.exports = { requirePerm, requireAny, requireAll, requireAdmin, ADMIN_ROLE_ID };
