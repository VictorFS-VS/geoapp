"use strict";

const express = require("express");
const router = express.Router();

const dashboard = require("../controllers/dashboard.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// Logger de diagnóstico: confirma que el request entra a este router
router.use((req, _res, next) => {
  try {
    console.log("[dashboard.routes] ->", req.method, req.originalUrl);
  } catch {}
  next();
});

// health-check
router.get("/ping", (req, res) => res.json({ ok: true, scope: "dashboard" }));

/**
 * Todos estos endpoints aceptan (opcionalmente):
 * - id_proyecto=<number>
 * - id_tramo=<number>
 * - tipo_clase=NORMAL|ESPECIAL|SIN DATO
 */

// =======================
// Métricas de proyectos
// =======================
router.get("/estado",           verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.proyectosPorEstado);
router.get("/anio-sector",      verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.proyectosPorAnioSector);
router.get("/anio-estudio",     verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.proyectosPorAnioTipoEstudio);
router.get("/anio-impacto",     verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.proyectosPorAnioImpacto);
router.get("/tipos-estudio",    verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.tiposEstudioTotales);
router.get("/resumen",          verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.resumenProyectos);
router.get("/estado-numerico",  verifyToken, requirePerm("dashboard.proyectos.read"), dashboard.proyectosPorEstadoNumerico);

// ✅ vencimientos (DIA + Resolución)
router.get("/vencimientos",     verifyToken, requirePerm("dashboard.vencimientos.read"), dashboard.vencimientosProximos);

// =======================
// Dashboard encuestas
// =======================
router.get("/tramos-por-proyecto",    verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.tramosPorProyecto);
router.get("/encuestas-por-proyecto", verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.encuestasPorProyecto);
router.get("/encuestas-por-tramo",    verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.encuestasPorTramo);

router.get("/afectacion-por-tramo",   verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.afectacionPorTramo);
router.get("/caracteristicas-predio", verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.caracteristicasPredioPorTramo);
router.get("/condicion-ocupacion",    verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.condicionOcupacionPorTramo);
router.get("/interes-reubicacion",    verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.interesReubicacion);
router.get("/percepcion",             verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.percepcionCensista);
router.get("/posee-documento",        verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.poseeDocumento);

// Nuevos
router.get("/ciudad",                     verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.ciudad);
router.get("/tiempo-arraigo",             verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.tiempoArraigo);
router.get("/ocupacion-rubro",            verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.ocupacionRubro);
router.get("/medio-subsistencia",         verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.medioSubsistencia);
router.get("/predio-servicios",           verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.predioServicios);
router.get("/discapacidad-salud",         verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.discapacidadSalud);
router.get("/instalaciones-uso",          verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.instalacionesUso);
router.get("/ingreso-mensual-categoria",  verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.ingresoMensualCategoria);
router.get("/pertenencia-organizacion",   verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.pertenenciaOrganizacion);

// Alias
router.get("/organizacion",               verifyToken, requirePerm("dashboard.encuestas.read"), dashboard.organizacion);

// 👉 Ruta crudo (también encuestas)
router.get(
  "/encuestas-raw-clase-tramo",
  (req, _res, next) => { try { console.log("[dashboard] encuestas-raw-clase-tramo"); } catch {} next(); },
  verifyToken,
  requirePerm("dashboard.encuestas.read"),
  dashboard.encuestasRawPorClaseTramo
);

// 👉 Ruta pública de prueba (dejala pública solo si querés)
router.get("/test-clase-public", dashboard.testClasePublic);

module.exports = router;
