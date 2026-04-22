// backend/routes/rbac.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const C = require("../controllers/rbac.controller");

// ✅ todo RBAC requiere sesión
router.use(verifyToken);

/* =========================
   A) Roles (groups)
   ========================= */
router.get("/roles",      requirePerm("rbac.roles.read"),   C.listRoles);
router.post("/roles",     requirePerm("rbac.roles.create"), C.createRole);
router.put("/roles/:id",  requirePerm("rbac.roles.update"), C.updateRole);
router.delete("/roles/:id", requirePerm("rbac.roles.delete"), C.deleteRole);

/* =========================
   B) Permisos (permissions)
   ========================= */
router.get("/perms",      requirePerm("rbac.perms.read"),   C.listPerms);
router.post("/perms",     requirePerm("rbac.perms.create"), C.createPerm);
router.put("/perms/:id",  requirePerm("rbac.perms.update"), C.updatePerm);
router.delete("/perms/:id", requirePerm("rbac.perms.delete"), C.deletePerm);


/* =========================
   C) Permisos por rol
   ========================= */
router.get("/roles/:id/perms",     requirePerm("rbac.role_perms.read"),   C.getRolePerms);
router.put("/roles/:id/perms",     requirePerm("rbac.role_perms.update"), C.setRolePerms);

/* =========================
   D) Roles por usuario
   ========================= */
router.get("/users/:id/roles",     requirePerm("rbac.user_roles.read"),   C.getUserRoles);
router.put("/users/:id/roles",     requirePerm("rbac.user_roles.update"), C.setUserRoles);

module.exports = router;
