// gv/gv_routes.js
const express = require("express");
const { ping, catastroDashboard, catastroMap } = require("./gv_controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const router = express.Router();

router.get("/ping", verifyToken, requirePerm("expedientes.read"), ping);
router.get("/catastro/dashboard", verifyToken, requirePerm("expedientes.read"), catastroDashboard);
router.get("/catastro/map", verifyToken, requirePerm("expedientes.read"), catastroMap);

module.exports = router;
