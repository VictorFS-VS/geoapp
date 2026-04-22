// routes/mantenimiento.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const uploadShapefiles = require("../middlewares/uploadShapefiles");
const { requirePerm } = require("../middlewares/requirePerm");

const ctrl = require("../controllers/mantenimiento.controller");

// =====================================================
// ✅ MANTENIMIENTO (IMPORT / STATUS / DELETE / EXPORT)
// =====================================================

// ✅ Import / upload (shp/zip/kmz/rar/kml/geojson/etc)
// (mantengo tu path actual)
router.post(
  "/upload/:id",
  verifyToken,
  requirePerm("mantenimiento.create"),
  uploadShapefiles,
  ctrl.procesarArchivosMantenimiento
);

// ✅ (Opcional) Alias “más REST” por si querés usarlo en el futuro
router.post(
  "/:id/upload",
  verifyToken,
  requirePerm("mantenimiento.create"),
  uploadShapefiles,
  ctrl.procesarArchivosMantenimiento
);

// ✅ Status de capas
router.get(
  "/status-capas/:id",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerStatusCapas
);

// ✅ Alias REST
router.get(
  "/:id/status-capas",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerStatusCapas
);

// ✅ Eliminar datos por tabla (por proyecto)
router.delete(
  "/eliminar-poligono/:tabla/:id",
  verifyToken,
  requirePerm("mantenimiento.delete"),
  ctrl.eliminarPoligono
);

// ✅ Alias REST
router.delete(
  "/:id/:tabla",
  verifyToken,
  requirePerm("mantenimiento.delete"),
  (req, res, next) => {
    // re-mapea params al controller actual
    req.params.tabla = req.params.tabla;
    req.params.id = req.params.id;
    next();
  },
  ctrl.eliminarPoligono
);

// =====================================================
// ✅ EXPORTS
// =====================================================

// ✅ Exportar SHP crudos desde _inbox
router.get(
  "/export/:id",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportarShapefiles
);

// ✅ Alias REST
router.get(
  "/:id/export",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportarShapefiles
);

// ✅ Export KML / KMZ (capas por query ?capas=POLIGONO_PROYECTO,TRAMO,...)
router.get(
  "/export-kml/:id",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportKML
);

router.get(
  "/export-kmz/:id",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportKMZ
);

// ✅ Alias REST
router.get(
  "/:id/export.kml",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportKML
);

router.get(
  "/:id/export.kmz",
  verifyToken,
  requirePerm("mantenimiento.export"),
  ctrl.exportKMZ
);

// =====================================================
// ✅ CAPAS (GeoJSON SIEMPRE 4326) para visores
// =====================================================

// ✅ OJO: en tu frontend ya usás "/api/mantenimiento/plano/:id"
router.get(
  "/plano/:id",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerPlanoProyecto
);

router.get(
  "/tramos/:id",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerTramos
);

router.get(
  "/progresivas/:id",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerProgresivas
);

router.get(
  "/poligonos-extra/:id",
  verifyToken,
  requirePerm("mantenimiento.read"),
  ctrl.obtenerPoligonosExtra
);

// ✅ Alias REST (por si querés consumir: /:id/plano, etc.)
router.get(
  "/:id/plano",
  verifyToken,
  requirePerm("mantenimiento.read"),
  (req, res, next) => {
    req.params.id = req.params.id;
    next();
  },
  ctrl.obtenerPlanoProyecto
);

router.get(
  "/:id/tramos",
  verifyToken,
  requirePerm("mantenimiento.read"),
  (req, res, next) => {
    req.params.id = req.params.id;
    next();
  },
  ctrl.obtenerTramos
);

router.get(
  "/:id/progresivas",
  verifyToken,
  requirePerm("mantenimiento.read"),
  (req, res, next) => {
    req.params.id = req.params.id;
    next();
  },
  ctrl.obtenerProgresivas
);

router.get(
  "/:id/poligonos-extra",
  verifyToken,
  requirePerm("mantenimiento.read"),
  (req, res, next) => {
    req.params.id = req.params.id;
    next();
  },
  ctrl.obtenerPoligonosExtra
);

module.exports = router;