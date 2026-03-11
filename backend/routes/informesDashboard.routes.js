// routes/informesDashboard.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const {
  getPlantillasPorProyecto,
  getChartsAgregados,
} = require("../controllers/informesDashboard.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ sesión requerida para todo el módulo
router.use(verifyToken);

// GET /api/informes-dashboard/plantillas?id_proyecto=123
router.get(
  "/plantillas",
  requirePerm("informes.dashboard.read"),
  getPlantillasPorProyecto
);

// GET /api/informes-dashboard/charts?id_proyecto=123&id_plantilla=5&desde=...&hasta=...
router.get(
  "/charts",
  requirePerm("informes.dashboard.charts.read"),
  getChartsAgregados
);

module.exports = router;
