"use strict";

// routes/informeKmz.routes.js
const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const { kmzByInforme, kmzByProyecto } = require("../controllers/informeKmz.controller");

// Descarga KMZ de un informe
// GET /api/informe-kmz/informe/:id/kmz
router.get(
  "/informe/:id/kmz",
  verifyToken,
  requirePerm("informes.export"),
  kmzByInforme
);

// Descarga KMZ de todos los informes de un proyecto (opcional: ?plantilla=ID)
// GET /api/informe-kmz/proyecto/:idProyecto/kmz?plantilla=16
router.get(
  "/proyecto/:idProyecto/kmz",
  verifyToken,
  requirePerm("informes.export"),
  kmzByProyecto
);

module.exports = router;
