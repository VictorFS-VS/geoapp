"use strict";

const express = require("express");
const router = express.Router();

const encuestas = require("../controllers/encuestas.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// Aplico verifyToken a todo
router.use(verifyToken);

/**
 * Permisos sugeridos:
 * - encuestas.read
 * - encuestas.create
 * - encuestas.update
 * - encuestas.delete
 * - encuestas.import
 * - encuestas.export
 */

// 🟡 Importación JSON
router.post(
  "/importar-json/:id(\\d+)",
  requirePerm("encuestas.import"),
  encuestas.importarEncuestasDesdeJSON
);

// 🟡 Comisiones (lectura)
router.get(
  "/comisiones",
  requirePerm("encuestas.read"),
  encuestas.comisionesPorProyecto
);

// 🗺️ GeoJSON para mapa
router.get(
  "/mapa/:id_proyecto(\\d+)",
  requirePerm("encuestas.read"),
  encuestas.obtenerPuntosEncuestaPorProyecto
);

// 📊 Campos graficables
router.get(
  "/campos",
  requirePerm("encuestas.read"),
  encuestas.camposEncuesta
);

// 📈 Frecuencias
router.get(
  "/frecuencias",
  requirePerm("encuestas.read"),
  encuestas.frecuenciasEncuesta
);

// ⬇️⬇️⬇️ Exportar KML / KMZ
router.get(
  "/export/kml",
  requirePerm("encuestas.export"),
  encuestas.exportEncuestasKml
);

router.get(
  "/export/kmz",
  requirePerm("encuestas.export"),
  encuestas.exportEncuestasKmz
);

// 📄 Informe/detalle extendido de encuesta (⚠️ fijo antes de "/:id")
router.get(
  "/informe/:id(\\d+)",
  requirePerm("encuestas.read"),
  encuestas.obtenerInformeEncuesta
);

// 🔁 Por proyecto y tramo (más específica primero)
router.get(
  "/proyecto/:id_proyecto(\\d+)/tramo/:id_tramo(\\d+)",
  requirePerm("encuestas.read"),
  encuestas.obtenerEncuestasPorProyectoYTramo
);

// 🔁 Por proyecto
router.get(
  "/proyecto/:id_proyecto(\\d+)",
  requirePerm("encuestas.read"),
  encuestas.obtenerEncuestasPorProyecto
);

// ❌ Eliminar TODAS por proyecto+tramo (⚠️ antes de "/:id")
router.delete(
  "/proyecto/:id_proyecto(\\d+)/tramo/:id_tramo(\\d+)",
  requirePerm("encuestas.delete"),
  encuestas.eliminarEncuestasPorProyectoYTramo
);

// 📄 Listado general
router.get(
  "/",
  requirePerm("encuestas.read"),
  encuestas.obtenerEncuestas
);

// ➕ Crear
router.post(
  "/",
  requirePerm("encuestas.create"),
  encuestas.crearEncuesta
);

// 📄 Una encuesta por id (numérica)
router.get(
  "/:id(\\d+)",
  requirePerm("encuestas.read"),
  encuestas.obtenerEncuestaPorId
);

// ✏️ Actualizar
router.put(
  "/:id(\\d+)",
  requirePerm("encuestas.update"),
  encuestas.actualizarEncuesta
);

// ❌ Eliminar UNA
router.delete(
  "/:id(\\d+)",
  requirePerm("encuestas.delete"),
  encuestas.eliminarEncuesta
);

module.exports = router;
