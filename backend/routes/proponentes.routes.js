const express = require("express");
const router = express.Router();
const proponentesController = require("../controllers/proponentes.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// 👇 IMPORTANTE: esta ruta debe ir antes de `/:id`
router.get(
  "/dropdown",
  verifyToken,
  requirePerm("proponentes.read"),
  proponentesController.obtenerProponentesDropdown
);

// Listado (el controller ya filtra por rol)
router.get(
  "/",
  verifyToken,
  requirePerm("proponentes.read"),
  proponentesController.obtenerProponentes
);

// Ver un proponente por ID
router.get(
  "/:id",
  verifyToken,
  requirePerm("proponentes.read"),
  proponentesController.obtenerProponentePorId
);

// Crear / editar
router.post(
  "/",
  verifyToken,
  requirePerm("proponentes.create"),
  proponentesController.crearProponente
);

router.put(
  "/:id",
  verifyToken,
  requirePerm("proponentes.update"),
  proponentesController.actualizarProponente
);

// Eliminar
router.delete(
  "/:id",
  verifyToken,
  requirePerm("proponentes.delete"),
  proponentesController.eliminarProponente
);

module.exports = router;
