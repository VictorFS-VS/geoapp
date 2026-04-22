// routes/resoluciones.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const resolucionesCtrl = require("../controllers/resoluciones.controller");

const ensure = (name) => {
  if (typeof resolucionesCtrl?.[name] === "function") return resolucionesCtrl[name];
  console.error(`[resoluciones.routes] ❌ Falta función en el controlador: ${name}`);
  return (_req, res) =>
    res.status(500).json({ message: `Falta función del controlador: ${name}` });
};

// Auth para todas
router.use(verifyToken);

/* =========================
   LECTURA
   ========================= */

// GET /api/resoluciones
router.get(
  "/",
  requirePerm("resoluciones.read"),
  ensure("listarResoluciones")
);

// GET /api/resoluciones/:id   (id = id_proyecto)
router.get(
  "/:id",
  requirePerm("resoluciones.read"),
  ensure("listarResolucionesPorProyecto")
);

/* =========================
   ESCRITURA
   ========================= */

// POST /api/resoluciones
router.post(
  "/",
  requirePerm("resoluciones.create"),
  ensure("crearResolucion")
);

// PUT /api/resoluciones/:id   (id = id_resoluciones)
router.put(
  "/:id",
  requirePerm("resoluciones.update"),
  ensure("actualizarResolucion")
);

// DELETE /api/resoluciones/:id (id = id_resoluciones)
router.delete(
  "/:id",
  requirePerm("resoluciones.delete"),
  ensure("eliminarResolucion")
);

module.exports = router;
