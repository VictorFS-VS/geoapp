// routes/useChange.routes.js
const express = require("express");
const router = express.Router();

const {
  createUseChangeAnalysis,
  listUseChangeAnalyses,
  getUseChangeAnalysis,
  getFeaturesGeoJSON,
  getMaskGeoJSON,
  getImageryByAnalysis,
  getAnalysisSummary,
  getLatestAnalysisByProject,
  getAnalysisByProjectDates, // ✅ NUEVO
  deleteUseChangeAnalysis,
} = require("../controllers/useChange.controller");

const requirePermModule = require("../middlewares/requirePerm");
const requirePerm = requirePermModule.requirePerm || requirePermModule;

/* =========================
   CREATE
========================= */
router.post(
  "/use-change/analyses",
  requirePerm("use_change.create"),
  createUseChangeAnalysis
);

/* =========================
   READ
========================= */
router.get(
  "/use-change/analyses",
  requirePerm("use_change.read"),
  listUseChangeAnalyses
);

// ✅ NUEVO: buscar por (project_id, date_old, date_new)
// ⚠️ IMPORTANTE: va ANTES de /:id
router.get(
  "/use-change/analyses/by-project-dates",
  requirePerm("use_change.read"),
  getAnalysisByProjectDates
);

router.get(
  "/use-change/analyses/:id",
  requirePerm("use_change.read"),
  getUseChangeAnalysis
);

router.get(
  "/use-change/analyses/:id/features",
  requirePerm("use_change.read"),
  getFeaturesGeoJSON
);

router.get(
  "/use-change/analyses/:id/mask",
  requirePerm("use_change.read"),
  getMaskGeoJSON
);

router.get(
  "/use-change/analyses/:id/imagery",
  requirePerm("use_change.read"),
  getImageryByAnalysis
);

router.get(
  "/use-change/analyses/:id/summary",
  requirePerm("use_change.read"),
  getAnalysisSummary
);

router.get(
  "/use-change/analyses/latest/by-project",
  requirePerm("use_change.read"),
  getLatestAnalysisByProject
);

/* =========================
   DELETE
========================= */
router.delete(
  "/use-change/analyses/:id",
  requirePerm("use_change.delete"),
  deleteUseChangeAnalysis
);

module.exports = router;