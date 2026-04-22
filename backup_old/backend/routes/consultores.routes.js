"use strict";

const express = require("express");
const router = express.Router();

const consultoresController = require("../controllers/consultores.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// Listar
router.get(
  "/",
  verifyToken,
  requirePerm("consultores.read"),
  consultoresController.obtenerConsultores
);

// Obtener por id
router.get(
  "/:id",
  verifyToken,
  requirePerm("consultores.read"),
  consultoresController.obtenerConsultorPorId
);

// Crear
router.post(
  "/",
  verifyToken,
  requirePerm("consultores.create"),
  consultoresController.crearConsultor
);

// Actualizar
router.put(
  "/:id",
  verifyToken,
  requirePerm("consultores.update"),
  consultoresController.actualizarConsultor
);

// Eliminar
router.delete(
  "/:id",
  verifyToken,
  requirePerm("consultores.delete"),
  consultoresController.eliminarConsultor
);

module.exports = router;
