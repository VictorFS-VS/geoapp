// backend/routes/proyecto_jerarquia.routes.js
// Rutas para la jerarquía Proyecto → Tramo → Subtramo y catálogo vial.
//
// Montaje en index.js:
//   const jerarquiaRoutes = require("./routes/proyecto_jerarquia.routes");
//   app.use("/api", jerarquiaRoutes);  // cubre ambos prefijos /api/proyectos y /api/vial
"use strict";

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/proyecto_jerarquia.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

/* ─── Jerarquía Tramos/Subtramos por Proyecto ─── */

// GET /api/proyectos/:id/jerarquia-tramos
router.get(
    "/proyectos/:id/jerarquia-tramos",
    requirePerm("proyectos.read"),
    ctrl.getJerarquia
);

// PUT /api/proyectos/:id/jerarquia-tramos
router.put(
    "/proyectos/:id/jerarquia-tramos",
    requirePerm("proyectos.update"),
    ctrl.saveJerarquia
);

// GET /api/proyectos/:proyectoId/tramos-censales
router.get(
    "/proyectos/:proyectoId/tramos-censales",
    requirePerm("proyectos.read"),
    ctrl.getTramosCensales
);

// GET /api/proyectos/:proyectoId/tramos-censales/:tramoId/subtramos
router.get(
    "/proyectos/:proyectoId/tramos-censales/:tramoId/subtramos",
    requirePerm("proyectos.read"),
    ctrl.getSubtramosCensales
);


/* ─── Catálogo Vial ─── */

// GET /api/vial/tramos-catalogo
router.get(
    "/vial/tramos-catalogo",
    requirePerm("tramos.read"),
    ctrl.getVialCatalogo
);

module.exports = router;
