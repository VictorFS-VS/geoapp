// src/routes/pga.routes.js
const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const pgaCtrl = require("../controllers/pga.controller");

router.get("/:id_proyecto", verifyToken, requirePerm("pga.read"), pgaCtrl.listarPGA);
router.post("/",            verifyToken, requirePerm("pga.create"), pgaCtrl.crearPGA);
router.put("/:id",          verifyToken, requirePerm("pga.update"), pgaCtrl.actualizarPGA);
router.delete("/:id",       verifyToken, requirePerm("pga.delete"), pgaCtrl.eliminarPGA);

module.exports = router;
