// routes/tramos.routes.js
"use strict";

// Montaje: app.use("/api/tramos", router);

const express = require("express");
const router = express.Router();

const tramosController = require("../controllers/tramos.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

/* =========================
   LECTURA
   ========================= */

// LISTAR TRAMOS (ARRAY) - ema.tramos
router.get(
  "/proyectos/:id/tramos",
  requirePerm("tramos.read"),
  tramosController.obtenerTramosPorProyecto
);

// GEOJSON TRAMOS (FeatureCollection) - ema.bloques_tramo
// Query opcional: ?bbox=minLng,minLat,maxLng,maxLat&z=12&limit=8000
router.get(
  "/proyectos/:id/tramos/geojson",
  requirePerm("tramos.read"),
  tramosController.obtenerTramosGeojsonPorProyecto
);

/* =========================
   ESCRITURA
   ========================= */

// CREAR TRAMO
router.post(
  "/proyectos/:id/tramos",
  requirePerm("tramos.create"),
  tramosController.crearTramo
);

// ACTUALIZAR TRAMO
router.put(
  "/tramos/:id",
  requirePerm("tramos.update"),
  tramosController.actualizarTramo
);

// ELIMINAR TRAMO
router.delete(
  "/tramos/:id",
  requirePerm("tramos.delete"),
  tramosController.eliminarTramo
);

// CERRAR TRAMO
router.patch(
  "/tramos/:id/cerrar",
  requirePerm("tramos.update"),
  tramosController.cerrarTramo
);

module.exports = router;
