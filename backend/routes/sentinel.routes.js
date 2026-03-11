// routes/sentinel.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const {
  getSentinelToken,
  forceRefresh,
  cloudPctAOI,
} = require("../controllers/sentinel.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

/* =========================
   TOKEN
   ========================= */

// GET /api/sentinel/token
router.get(
  "/token",
  requirePerm("sentinel.token.read"),
  getSentinelToken
);

// POST /api/sentinel/token/refresh
router.post(
  "/token/refresh",
  requirePerm("sentinel.token.refresh"),
  forceRefresh
);

/* =========================
   CLOUD% (AOI)
   ========================= */

// POST /api/sentinel/cloudpct
router.post(
  "/cloudpct",
  requirePerm("sentinel.cloudpct"),
  cloudPctAOI
);

module.exports = router;
