// backend/routes/diagnostico.routes.js
"use strict";

const express = require("express");
const router = express.Router();
const diagnosticoCtrl = require("../controllers/diagnostico.controller");
const diagnosticoExportCtrl = require("../controllers/diagnostico.export.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

router.get(
  "/proyecto/:idProyecto/export/excel",
  verifyToken,
  requirePerm("informes.read"),
  diagnosticoExportCtrl.exportDiagnosticoProyectoExcel
);

router.get(
  "/plantilla/:idPlantilla",
  verifyToken,
  requirePerm("informes.plantillas.read"),
  diagnosticoCtrl.getFormulaByPlantilla
);

router.post(
  "/",
  verifyToken,
  requirePerm("informes.plantillas.update"),
  diagnosticoCtrl.saveFormula
);

router.get("/resultado/:idRegistro", diagnosticoCtrl.getDetalleScoring);

router.patch(
  "/override/:idRegistro",
  verifyToken,
  requirePerm("informes.update"), // Permiso para editar informes
  diagnosticoCtrl.saveScoringOverride
);

router.post(
  "/evaluar-plantilla",
  verifyToken,
  requirePerm("informes.update"),
  diagnosticoCtrl.evaluarPlantilla
);

router.post(
  "/evaluar-individual/:idInforme",
  verifyToken,
  requirePerm("informes.update"),
  diagnosticoCtrl.evaluarIndividual
);

router.patch(
  "/revisado/:idRegistro",
  verifyToken,
  requirePerm("informes.update"),
  diagnosticoCtrl.marcarRevisado
);

router.post(
  "/reset-cambios",
  verifyToken,
  requirePerm("informes.update"),
  diagnosticoCtrl.resetCambios
);

module.exports = router;
