// routes/informesDashboard.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const {
  getPlantillasPorProyecto,
  getChartsAgregados,
} = require("../controllers/informesDashboard.controller");
const {
  getPlantillaDashboardMetadata,
} = require("../controllers/informesDashboardMetadata.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const { getInformesResumenBase } = require("../controllers/informesDashboardResumen.controller");

// ✅ sesión requerida para todo el módulo
router.use(verifyToken);

// GET /api/informes-dashboard/plantillas?id_proyecto=123
router.get(
  "/plantillas",
  requirePerm("informes.dashboard.read"),
  getPlantillasPorProyecto
);

// GET /api/informes-dashboard/resumen?id_proyecto=123&id_plantilla=...&desde=...&hasta=...&solo_cerrados=...
router.get(
  "/resumen",
  requirePerm("informes.read"),
  getInformesResumenBase
);

// GET /api/informes-dashboard/plantillas/:idPlantilla/metadata?id_proyecto=123
router.get(
  "/plantillas/:idPlantilla/metadata",
  requirePerm("informes.read"),
  getPlantillaDashboardMetadata
);

// GET /api/informes-dashboard/charts?id_proyecto=123&id_plantilla=5&desde=...&hasta=...
router.get(
  "/charts",
  requirePerm("informes.dashboard.charts.read"),
  getChartsAgregados
);

module.exports = router;
