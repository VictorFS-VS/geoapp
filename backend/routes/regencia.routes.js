// routes/regencia.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const C = require("../controllers/regencia.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

/* =========================
   CONTRATOS
   ========================= */

// Ver contrato activo de un proyecto
router.get(
  "/contratos/:id_proyecto/activo",
  requirePerm("regencia.contratos.read"),
  C.getContratoActivo
);

// Listar contratos por proyecto
router.get(
  "/contratos/:id_proyecto",
  requirePerm("regencia.contratos.read"),
  C.listarContratos
);

// Crear contrato
router.post(
  "/contratos",
  requirePerm("regencia.contratos.create"),
  C.crearContrato
);

// Editar contrato
router.put(
  "/contratos/:id",
  requirePerm("regencia.contratos.update"),
  C.actualizarContrato
);

// Generar visitas mensuales (acción)
router.post(
  "/contratos/:id/generar-visitas",
  requirePerm("regencia.contratos.generate_visitas"),
  C.generarVisitasMensuales
);

/* =========================
   ACTIVIDADES
   ========================= */

// Listar actividades (filtros)
router.get(
  "/actividades",
  requirePerm("regencia.actividades.read"),
  C.listarActividades
);

// Obtener una actividad
router.get(
  "/actividades/:id",
  requirePerm("regencia.actividades.read"),
  C.getActividad
);

// Crear actividad
router.post(
  "/actividades",
  requirePerm("regencia.actividades.create"),
  C.crearActividad
);

// Editar actividad
router.put(
  "/actividades/:id",
  requirePerm("regencia.actividades.update"),
  C.actualizarActividad
);

// Cambiar estado
router.patch(
  "/actividades/:id/estado",
  requirePerm("regencia.actividades.update_estado"),
  C.setEstadoActividad
);

/* =========================
   RESPONSABLES
   ========================= */

// Ver responsables de actividad
router.get(
  "/actividades/:id_actividad/responsables",
  requirePerm("regencia.responsables.read"),
  C.listarResponsables
);

// Set responsables (acción)
router.post(
  "/actividades/:id_actividad/responsables",
  requirePerm("regencia.responsables.manage"),
  C.setResponsables
);

/* =========================
   ALERTAS
   ========================= */

// Generar alertas estándar (acción)
router.post(
  "/actividades/:id_actividad/generar-alertas",
  requirePerm("regencia.alertas.generate"),
  C.generarAlertasEstandar
);

module.exports = router;
