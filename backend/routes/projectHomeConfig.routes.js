"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requireAdmin, requireAny } = require("../middlewares/requirePerm");
const ctrl = require("../controllers/projectHomeConfig.controller");

router.use(verifyToken);

// GET /api/project-home/config?id_proyecto=...&id_plantilla=...
router.get("/config", requireAny(["informes.read", "expedientes.read", "quejas_reclamos.read"]), ctrl.getConfig);

// POST /api/project-home/config
router.post("/config", requireAdmin(), ctrl.createConfig);

// PUT /api/project-home/config/:id
router.put("/config/:id(\\d+)", requireAdmin(), ctrl.updateConfig);

// PATCH /api/project-home/config/:id/disable
router.patch("/config/:id(\\d+)/disable", requireAdmin(), ctrl.disableConfig);

module.exports = router;
