"use strict";

// src/routes/groups.routes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/groups.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// endpoint ligero para dropdowns u otros listados simples
router.get(
  "/simple",
  verifyToken,
  requirePerm("roles.read"),
  ctrl.obtenerGrupos
);

// listado paginado + búsqueda
router.get(
  "/",
  verifyToken,
  requirePerm("roles.read"),
  ctrl.listGroups
);

// obtener un solo grupo
router.get(
  "/:id",
  verifyToken,
  requirePerm("roles.read"),
  ctrl.getGroup
);

// crear nuevo grupo
router.post(
  "/",
  verifyToken,
  requirePerm("roles.create"),
  ctrl.createGroup
);

// actualizar grupo
router.put(
  "/:id",
  verifyToken,
  requirePerm("roles.update"),
  ctrl.updateGroup
);

// eliminar grupo
router.delete(
  "/:id",
  verifyToken,
  requirePerm("roles.delete"),
  ctrl.deleteGroup
);

module.exports = router;
