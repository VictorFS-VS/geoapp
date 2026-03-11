"use strict";

// backend/routes/conceptos.js
const express = require("express");
const router = express.Router();

const pool = require("../db");
const controller = require("../controllers/conceptos.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

/* ------------------------------------------------------------------ */
/* Helper común: lista (concepto, nombre) por tipoconcepto             */
/* ------------------------------------------------------------------ */
async function listarPorTipo(res, tipoconcepto) {
  try {
    const { rows } = await pool.query(
      `SELECT concepto, nombre
         FROM public.conceptos
        WHERE tipoconcepto = $1
        ORDER BY nombre ASC`,
      [tipoconcepto]
    );
    res.json(rows);
  } catch (err) {
    console.error(`Error al obtener conceptos (${tipoconcepto}):`, err);
    res.status(500).json({ message: `Error al obtener conceptos (${tipoconcepto})` });
  }
}

/* ------------------------------------------------------------------ */
/* RUTAS PÚBLICAS (para selects)                                       */
/* ------------------------------------------------------------------ */
router.get("/por-tipo/:tipoconcepto", async (req, res) => {
  const tipo = String(req.params.tipoconcepto || "").toUpperCase();
  if (!tipo) return res.status(400).json({ message: "tipoconcepto requerido" });
  return listarPorTipo(res, tipo);
});

router.get("/tipo-estudio", (req, res) => listarPorTipo(res, "TIPO_ESTUDIO"));
router.get("/tipo-proyecto", (req, res) => listarPorTipo(res, "TIPO_PROYECTO"));
router.get("/actividad", (req, res) => listarPorTipo(res, "ACTIVIDAD"));

// ✅ Unificado para tu caso real:
router.get("/sector-proyecto", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT concepto, nombre
         FROM public.conceptos
        WHERE tipoconcepto IN ('SECTORE_PROYECTOS', 'SECTOR_PROYECTO', 'SECTOR')
        ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener conceptos (SECTORE_PROYECTOS):", err);
    res.status(500).json({ message: "Error al obtener sectores" });
  }
});

router.get("/proyecto-estado", (req, res) => listarPorTipo(res, "PROYECTO_ESTADO"));

// **PGA**
router.get("/pga/estado", (req, res) => listarPorTipo(res, "PGA_ESTADO"));
router.get("/pga/tipo-riesgo", (req, res) => listarPorTipo(res, "TIPO_RIESGO"));
router.get("/pga/tipo-plan", (req, res) => listarPorTipo(res, "TIPO_PLAN"));

/* ------------------------------------------------------------------ */
/* RUTAS PROTEGIDAS (CRUD) - RBAC                                      */
/* ------------------------------------------------------------------ */

// Listar (tabla completa)
router.get(
  "/",
  verifyToken,
  requirePerm("conceptos.read"),
  controller.listarConceptos
);

// Obtener uno
router.get(
  "/:concepto/:tipoconcepto",
  verifyToken,
  requirePerm("conceptos.read"),
  controller.obtenerConcepto
);

// Crear
router.post(
  "/",
  verifyToken,
  requirePerm("conceptos.create"),
  controller.crearConcepto
);

// Actualizar
router.put(
  "/:concepto/:tipoconcepto",
  verifyToken,
  requirePerm("conceptos.update"),
  controller.actualizarConcepto
);

// Eliminar (clave compuesta)
router.delete(
  "/:concepto/:tipoconcepto",
  verifyToken,
  requirePerm("conceptos.delete"),
  controller.eliminarConcepto
);

// fallback compat (si tu controller lo soporta)
router.delete(
  "/:id",
  verifyToken,
  requirePerm("conceptos.delete"),
  controller.eliminarConcepto
);

module.exports = router;
