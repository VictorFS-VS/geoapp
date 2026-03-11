// server/routes/proyectos.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const {
  crearProyecto,
  actualizarProyecto,
  listarProyectos,
  obtenerProyectoPorId,
  obtenerGeomProyecto,
  obtenerPoligonosPorProyecto,
  obtenerUsoActualPorProyecto,
  obtenerUsoAlternativoPorProyecto,
  obtenerUso1986PorProyecto,
  obtenerPlanoPorProyecto,
  obtenerAreaInfluenciaPorProyecto,
  eliminarProyecto,
  obtenerPrimeroPorProponente,
  obtenerCapasProyecto,
  obtenerPoligonosSmart,
  obtenerHermanos,
  obtenerComIndigenaPorProyecto,
  actualizarEstadoProyectoController,
} = require("../controllers/proyectos.controller");

const { procesarArchivosMantenimiento } = require("../controllers/mantenimiento.controller");

// ✅ Middleware base: todo proyectos requiere JWT
router.use(verifyToken);

/* =========================
   RBAC por permisos
   =========================
   proyectos.read
   proyectos.create
   proyectos.update
   proyectos.delete
   proyectos.mantenimiento   (opcional, recomendado)
   proyectos.estado.update   (opcional, recomendado)
*/

// =======================
// Crear / Actualizar / Eliminar / Mantenimiento
// =======================

// Crear proyecto
router.post("/", requirePerm("proyectos.create"), crearProyecto);

// Actualizar proyecto
router.put("/:id", requirePerm("proyectos.update"), actualizarProyecto);

// Eliminar proyecto
router.delete("/:id", requirePerm("proyectos.delete"), eliminarProyecto);

// Mantenimiento shapefiles por proyecto
router.post(
  "/:id/mantenimiento",
  requirePerm("proyectos.mantenimiento"),
  procesarArchivosMantenimiento
);

// Cambiar estado por etapa (para el modal)
router.patch(
  "/:id/estado",
  requirePerm("proyectos.estado.update"),
  actualizarEstadoProyectoController
);

// =======================
// Lectura
// =======================

// Listado paginado de proyectos (la cartera / onlyMyProjects se filtra en controller)
router.get("/", requirePerm("proyectos.read"), listarProyectos);

// Capas generales de un proyecto
router.get("/:id/capas", requirePerm("proyectos.read"), obtenerCapasProyecto);

// Geometría principal del proyecto
router.get("/:id/geom", requirePerm("proyectos.read"), obtenerGeomProyecto);

// Polígonos del proyecto
router.get("/:id/poligonos", requirePerm("proyectos.read"), obtenerPoligonosPorProyecto);

// ✅ Área de Influencia por proyecto
router.get(
  "/area-influencia/:id",
  requirePerm("proyectos.read"),
  obtenerAreaInfluenciaPorProyecto
);

// Uso actual por proyecto
router.get("/uso-actual/:id", requirePerm("proyectos.read"), obtenerUsoActualPorProyecto);

// Uso alternativo por proyecto
router.get(
  "/uso-alternativo/:id",
  requirePerm("proyectos.read"),
  obtenerUsoAlternativoPorProyecto
);

// Uso 1986 por proyecto
router.get("/uso-1986/:id", requirePerm("proyectos.read"), obtenerUso1986PorProyecto);

// Plano del proyecto
router.get("/plano/:id", requirePerm("proyectos.read"), obtenerPlanoPorProyecto);

// Primer proyecto por proponente/cliente
router.get(
  "/primero-por-proponente/:idCliente",
  requirePerm("proyectos.read"),
  obtenerPrimeroPorProponente
);

// Comunidad indígena asociada al proyecto
router.get("/com-indigena/:id", requirePerm("proyectos.read"), obtenerComIndigenaPorProyecto);

// Polígonos “smart”
router.get("/:id/poligonos-smart", requirePerm("proyectos.read"), obtenerPoligonosSmart);

// Proyectos “hermanos”
router.get("/:id/hermanos", requirePerm("proyectos.read"), obtenerHermanos);

// ⚠️ El GET genérico por id va al final
router.get("/:id", requirePerm("proyectos.read"), obtenerProyectoPorId);

module.exports = router;
