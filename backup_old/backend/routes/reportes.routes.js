// routes/reportes.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const reportes = require("../controllers/reportes.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ sesión requerida
router.use(verifyToken);

/* =========================
   CREACIÓN (acciones)
   ========================= */

router.post(
  "/from-proyecto/:idProyecto",
  requirePerm("reportes.create"),
  reportes.createFromProyecto
);

router.post(
  "/from-informe/:idInforme",
  requirePerm("reportes.create"),
  reportes.createFromInforme
);

router.post(
  "/from-proyecto-agregado/:idProyecto",
  requirePerm("reportes.create_agregado"),
  reportes.createFromProyectoAgregado
);

/* =========================
   LECTURA
   ========================= */

router.get(
  "/",
  requirePerm("reportes.read"),
  reportes.list
);

router.get(
  "/:idReporte",
  requirePerm("reportes.read"),
  reportes.getOne
);

/* =========================
   EDICIÓN (header / bloques)
   ========================= */

router.put(
  "/:idReporte",
  requirePerm("reportes.update"),
  reportes.updateHeader
);

router.put(
  "/:idReporte/bloques/:idBloque",
  requirePerm("reportes.update_bloques"),
  reportes.updateBloque
);

router.post(
  "/:idReporte/secciones/:idReporteSeccion/bloques",
  requirePerm("reportes.manage_bloques"),
  reportes.addBloqueManual
);

router.delete(
  "/:idReporte/bloques/:idBloque",
  requirePerm("reportes.manage_bloques"),
  reportes.deleteBloque
);

module.exports = router;
