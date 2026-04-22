// backend/routes/actas.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// Controladores de generación (PDF/DOCX) y borrado
const {
  generarActaPreconstruccion,      // deprecado
  generarActaPreconstruccionPDF,   // PDF desde HTML
  generarActaPreconstruccionDOCX,  // DOCX desde HTML
  eliminarActa,
} = require("../controllers/acta.controller");

// Controladores de listado / lectura / edición
const {
  listarActasPorProyecto,
  obtenerActa,
  actualizarActa,
} = require("../controllers/actaPdf.controller");

/* ───────────────────────────────────────────────
   Rutas de consulta (lectura)
   ─────────────────────────────────────────────── */

// Listar actas de un proyecto
router.get(
  "/proyectos/:id/actas-preconstruccion",
  verifyToken,
  requirePerm("actas.read"),
  listarActasPorProyecto
);

// Obtener una acta por id
router.get(
  "/actas-preconstruccion/:id_acta",
  verifyToken,
  requirePerm("actas.read"),
  obtenerActa
);

/* ───────────────────────────────────────────────
   Rutas de actualización / eliminación
   ─────────────────────────────────────────────── */

// Actualizar acta (meta + descripciones/orden de fotos)
router.put(
  "/actas-preconstruccion/:id_acta",
  verifyToken,
  requirePerm("actas.update"),
  actualizarActa
);

// Eliminar acta (y sus archivos)
router.delete(
  "/actas-preconstruccion/:id_acta",
  verifyToken,
  requirePerm("actas.delete"),
  eliminarActa
);

/* ───────────────────────────────────────────────
   Rutas de generación de documentos
   ─────────────────────────────────────────────── */

// Generar / reimprimir PDF
router.post(
  "/proyectos/:id/actas-preconstruccion-pdf",
  verifyToken,
  requirePerm("actas.generate"),
  generarActaPreconstruccionPDF
);

// Generar / reimprimir DOCX
router.post(
  "/proyectos/:id/actas-preconstruccion-docx",
  verifyToken,
  requirePerm("actas.generate"),
  generarActaPreconstruccionDOCX
);

// (Deprecado) viejo endpoint con plantilla
router.post(
  "/proyectos/:id/actas-preconstruccion",
  verifyToken,
  requirePerm("actas.generate"),
  generarActaPreconstruccion
);

module.exports = router;
