"use strict";

const router = require("express").Router();
const ctrl = require("../controllers/expedientes.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// =====================
// ✅ IMPORT EXCEL
// =====================
router.post(
  "/import/:idProyecto",
  verifyToken,
  requirePerm("expedientes.create"),
  ctrl.importExcel
);

// =====================
// CRUD
// =====================
router.get(
  "/proyecto/:idProyecto",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.listByProyecto
);

router.post(
  "/proyecto/:idProyecto/bulk-delete",
  verifyToken,
  requirePerm("expedientes.delete"),
  ctrl.bulkDeleteExpedientesByProyecto
);

router.get(
  "/dbi/estados",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.getDbiEstadosCatalog
);

router.get(
  "/:idExpediente",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.getOne
);

router.post(
  "/",
  verifyToken,
  requirePerm("expedientes.create"),
  ctrl.create
);

router.put(
  "/:idExpediente",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.update
);
router.post(
  "/:idExpediente/clonar",
  verifyToken,
  requirePerm("expedientes.create"),
  ctrl.clonarBase
);

router.delete(
  "/:idExpediente",
  verifyToken,
  requirePerm("expedientes.delete"),
  ctrl.remove
);

// =====================
// Documentos (tumba)
// =====================
router.get(
  "/:idExpediente/documentos",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.listarDocs
);

// =====================
// Historial de visitas
// =====================
router.get(
  "/:idExpediente/visitas",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.listarVisitas
);

router.post(
  "/:idExpediente/visitas",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.crearVisita
);

router.put(
  "/:idExpediente/visitas/:idVisita",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.actualizarVisita
);

router.post(
  "/:idExpediente/documentos/upload",
  verifyToken,
  requirePerm("expedientes.upload"),
  ctrl.subirDocs
);

// CI titular / adicional
router.post(
  "/:idExpediente/ci/upload",
  verifyToken,
  requirePerm("expedientes.upload"),
  ctrl.subirCI
);

router.get(
  "/:idExpediente/mejoras",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.geojsonMejoras
);

router.get(
  "/:idExpediente/terreno",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.geojsonTerreno
);

router.delete(
  "/:idExpediente/poligono/:tipo",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.eliminarPoligonoExpediente
);

// Acciones por id_archivo
router.get(
  "/documentos/ver/:idArchivo",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.verDocInline
);

router.get(
  "/documentos/descargar/:idArchivo",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.descargarDoc
);

router.delete(
  "/documentos/eliminar/:idArchivo",
  verifyToken,
  requirePerm("expedientes.upload"),
  ctrl.eliminarDoc
);

// =====================
// ✅ Elaboración de carpetas (Etapas)
// =====================
router.get(
  "/:idExpediente/etapas/:tipo",
  verifyToken,
  requirePerm("expedientes.read"),
  ctrl.getEtapas
);

router.put(
  "/:idExpediente/etapas/:tipo/:key",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.setEtapa
);

// =====================
// ✅ DBI (código + archivo final)
// =====================
router.post(
  "/:idExpediente/dbi/upload",
  verifyToken,
  requirePerm("expedientes.upload"),
  ctrl.subirDBI
);

router.post(
  "/:idExpediente/dbi/eventos",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.agregarDbiEvento
);

router.post(
  "/:idExpediente/dbi/iniciar",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.iniciarDbi
);

router.put(
  "/:idExpediente/dbi/header",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.actualizarDbiHeader
);

router.put(
  "/:idExpediente/dbi/eventos/:uuid",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.actualizarDbiEvento
);

router.delete(
  "/:idExpediente/dbi/eventos/:uuid",
  verifyToken,
  requirePerm("expedientes.update"),
  ctrl.eliminarDbiEvento
);

module.exports = router;
