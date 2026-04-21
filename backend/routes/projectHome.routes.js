"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requireAny } = require("../middlewares/requirePerm");
const projectHomeCtrl = require("../controllers/projectHome.controller");

// Keep consistent with other modules (even though backend/index.js already guards globally)
router.use(verifyToken);

// GET /api/project-home/resumen?id_proyecto=...&id_plantilla=...
router.get(
  "/resumen",
  requireAny(["informes.read", "expedientes.read", "quejas_reclamos.read"]),
  projectHomeCtrl.getResumen
);

// GET /api/project-home/resumen-ejecutivo?id_proyecto=...
router.get(
  "/resumen-ejecutivo",
  requireAny(["informes.read", "expedientes.read", "quejas_reclamos.read"]),
  projectHomeCtrl.getExecutiveResumen
);

module.exports = router;
