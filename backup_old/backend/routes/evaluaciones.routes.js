"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const evaluacionesCtrl = require("../controllers/evaluaciones.controller");

// Aplico verifyToken a todo
router.use(verifyToken);

// ---- PROYECTO (desde Evaluaciones) ----
// Ver proyecto + evaluaciones
router.get(
  "/proyecto/:id",
  requirePerm("proyectos.read"),
  evaluacionesCtrl.getProyectoConEvaluaciones
);

// Actualizar proyecto desde evaluaciones
router.put(
  "/proyecto/:id",
  requirePerm("proyectos.update"),
  evaluacionesCtrl.updateProyectoDesdeEvaluaciones
);

// ---- EVALUACIONES CRUD ----

// Ver evaluación por id
router.get(
  "/ver/:id",
  requirePerm("evaluaciones.read"),
  evaluacionesCtrl.verEvaluacionPorId
);

// Listar evaluaciones por proyecto
router.get(
  "/:proyecto_id",
  requirePerm("evaluaciones.read"),
  evaluacionesCtrl.listarEvaluacionesPorProyecto
);

// Crear evaluación
router.post(
  "/",
  requirePerm("evaluaciones.create"),
  evaluacionesCtrl.crearEvaluacion
);

// Actualizar evaluación
router.put(
  "/:id",
  requirePerm("evaluaciones.update"),
  evaluacionesCtrl.actualizarEvaluacion
);

module.exports = router;
