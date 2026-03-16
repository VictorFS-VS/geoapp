// gv/gv_routes.js
const express = require("express");
const { ping, catastroDashboard, catastroMap } = require("./gv_controller");
const { avanceTemporal, detalleTemporal, economico } = require("./gv_analytics_controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const router = express.Router();

router.get("/ping", verifyToken, requirePerm("expedientes.read"), ping);
router.get("/catastro/dashboard", verifyToken, requirePerm("expedientes.read"), catastroDashboard);
router.get("/catastro/map", verifyToken, requirePerm("expedientes.read"), catastroMap);
router.get(
  "/catastro/analytics/avance-temporal",
  verifyToken,
  requirePerm("expedientes.read"),
  avanceTemporal
);
router.get(
  "/catastro/analytics/detalle-temporal",
  verifyToken,
  requirePerm("expedientes.read"),
  detalleTemporal
);
router.get(
  "/catastro/analytics/economico",
  verifyToken,
  requirePerm("expedientes.read"),
  economico
);

module.exports = router;
