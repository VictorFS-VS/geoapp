"use strict";

// src/routes/declaraciones.routes.js
const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const declaracionesCtrl = require("../controllers/declaraciones.controller");

// ✅ Lectura
router.get("/",      verifyToken, requirePerm("declaraciones.read"), declaracionesCtrl.listarDeclaraciones);
router.get("/:id",   verifyToken, requirePerm("declaraciones.read"), declaracionesCtrl.listarDeclaracionesPorProyecto);

// ✅ Escritura
router.post("/",     verifyToken, requirePerm("declaraciones.create"), declaracionesCtrl.crearDeclaracion);
router.put("/:id",   verifyToken, requirePerm("declaraciones.update"), declaracionesCtrl.actualizarDeclaracion);
router.delete("/:id",verifyToken, requirePerm("declaraciones.delete"), declaracionesCtrl.eliminarDeclaracion);

module.exports = router;
