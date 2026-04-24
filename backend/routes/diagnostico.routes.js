// backend/routes/diagnostico.routes.js
"use strict";

const express = require("express");
const router = express.Router();
const diagnosticoCtrl = require("../controllers/diagnostico.controller");
const diagnosticoExportCtrl = require("../controllers/diagnostico.export.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm, requireAny } = require("../middlewares/requirePerm");

router.get(
  "/proyecto/:idProyecto/export/excel",
  verifyToken,
  requirePerm("informes.diagnostico.read"),
  diagnosticoExportCtrl.exportDiagnosticoProyectoExcel
);

router.post(
  "/proyecto/:idProyecto/export/excel",
  verifyToken,
  requirePerm("informes.diagnostico.read"),
  diagnosticoExportCtrl.exportDiagnosticoProyectoExcel
);

router.get(
  "/plantilla/:idPlantilla",
  verifyToken,
  requireAny(["informes.diagnostico.read", "informes.plantillas.read"]),
  diagnosticoCtrl.getFormulaByPlantilla
);

router.post(
  "/",
  verifyToken,
  requirePerm("informes.diagnostico.update"),
  diagnosticoCtrl.saveFormula
);

router.get(
  "/resultado/:idRegistro",
  verifyToken,
  requirePerm("informes.diagnostico.read"),
  diagnosticoCtrl.getDetalleScoring
);

router.patch(
  "/override/:idRegistro",
  verifyToken,
  requirePerm("informes.diagnostico.update"),
  diagnosticoCtrl.saveScoringOverride
);

router.post(
  "/evaluar-plantilla",
  verifyToken,
  requirePerm("informes.diagnostico.create"),
  diagnosticoCtrl.evaluarPlantilla
);

router.post(
  "/evaluar-individual/:idInforme",
  verifyToken,
  requirePerm("informes.diagnostico.create"),
  diagnosticoCtrl.evaluarIndividual
);

router.patch(
  "/revisado/:idRegistro",
  verifyToken,
  requirePerm("informes.diagnostico.update"),
  diagnosticoCtrl.marcarRevisado
);

router.post(
  "/reset-cambios",
  verifyToken,
  requirePerm("informes.diagnostico.update"),
  diagnosticoCtrl.resetCambios
);

module.exports = router;
