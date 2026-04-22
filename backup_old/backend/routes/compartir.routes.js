"use strict";

const router = require("express").Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const ctrl = require("../controllers/compartir.controller");

// Ver lista de usuarios con acceso a la plantilla
router.get(
  "/plantillas/:id_plantilla",
  verifyToken,
  requirePerm("plantillas.share.read"),
  ctrl.listarPlantilla
);

// Dar / actualizar acceso (upsert)
router.post(
  "/plantillas/:id_plantilla",
  verifyToken,
  requirePerm("plantillas.share.update"),
  ctrl.upsertCompartir
);

// Quitar acceso
router.delete(
  "/plantillas/:id_plantilla/:id_usuario",
  verifyToken,
  requirePerm("plantillas.share.delete"),
  ctrl.quitarCompartir
);

module.exports = router;
