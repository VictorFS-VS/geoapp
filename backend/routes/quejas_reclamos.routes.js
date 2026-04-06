"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const quejasCtrl = require("../controllers/quejas_reclamos.controller");

/* =========================================================
   LISTAR
========================================================= */
router.get(
  "/",
  verifyToken,
  requirePerm("quejas_reclamos.read"),
  quejasCtrl.listarQuejasReclamos
);

/* =========================================================
   OBTENER UNO
========================================================= */
router.get(
  "/:id",
  verifyToken,
  requirePerm("quejas_reclamos.read"),
  quejasCtrl.obtenerQuejaReclamo
);

/* =========================================================
   CREAR
========================================================= */
router.post(
  "/",
  verifyToken,
  requirePerm("quejas_reclamos.create"),
  quejasCtrl.crearQuejaReclamo
);

/* =========================================================
   ACTUALIZAR
========================================================= */
router.put(
  "/:id",
  verifyToken,
  requirePerm("quejas_reclamos.update"),
  quejasCtrl.actualizarQuejaReclamo
);

/* =========================================================
   CAMBIAR SOLO ESTADO
========================================================= */
router.patch(
  "/:id/estado",
  verifyToken,
  requirePerm("quejas_reclamos.update"),
  quejasCtrl.cambiarEstadoQuejaReclamo
);

/* =========================================================
   ELIMINAR
========================================================= */
router.delete(
  "/:id",
  verifyToken,
  requirePerm("quejas_reclamos.delete"),
  quejasCtrl.eliminarQuejaReclamo
);

module.exports = router;