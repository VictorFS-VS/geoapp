// backend/routes/informes.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const informesCtrl = require("../controllers/informes.controller");
const informesImportCtrl = require("../controllers/informes.import.controller");
const massiveImportCtrl = require("../controllers/informes.massiveImport.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

/* =========================================================
   ✅ IMPORTANTE
   - Este router es PRIVADO (con JWT)
   - Las rutas PÚBLICAS por token van en OTRO router:
     /api/public-informe/:token
   ========================================================= */

/* =========================================================
   PLANTILLAS
   ========================================================= */
router.get(
  "/plantillas",
  verifyToken,
  requirePerm("informes.plantillas.read"),
  informesCtrl.getPlantillas
);

router.get(
  "/plantillas/:id",
  verifyToken,
  requirePerm("informes.plantillas.read"),
  informesCtrl.getPlantillaById
);

router.get(
  "/proyecto/:idProyecto/plantillas",
  verifyToken,
  requirePerm("informes.plantillas.read"),
  informesCtrl.listAllPlantillasByProyecto
);

router.post(
  "/plantillas",
  verifyToken,
  requirePerm("informes.plantillas.create"),
  informesCtrl.createPlantilla
);

// ✅ NUEVO: duplicar plantilla completa (plantilla + secciones + preguntas)
router.post(
  "/plantillas/:id/duplicar",
  verifyToken,
  requirePerm("informes.plantillas.create"),
  informesCtrl.duplicarPlantilla
);

router.put(
  "/plantillas/:id",
  verifyToken,
  requirePerm("informes.plantillas.update"),
  informesCtrl.updatePlantilla
);

router.delete(
  "/plantillas/:id",
  verifyToken,
  requirePerm("informes.plantillas.delete"),
  informesCtrl.deletePlantilla
);

// ✅ Hard delete
router.delete(
  "/plantillas/:id/hard",
  verifyToken,
  requirePerm("informes.plantillas.hard_delete"),
  informesCtrl.hardDeletePlantilla
);

/* =========================================================
   IMPORT XLSX (NUEVO / AISLADO DEL LEGACY)
   ========================================================= */
router.post(
  "/import-xlsx/catalog",
  verifyToken,
  requirePerm("informes.create"),
  informesImportCtrl.catalogImportXlsx
);

router.post(
  "/import-xlsx/profile",
  verifyToken,
  requirePerm("informes.create"),
  informesImportCtrl.profileImportXlsx
);

router.post(
  "/import-xlsx/prepare",
  verifyToken,
  requirePerm("informes.create"),
  informesImportCtrl.prepareImportXlsx
);

router.post(
  "/import-xlsx/run",
  verifyToken,
  requirePerm("informes.create"),
  informesImportCtrl.runImportXlsx
);

/* =========================================================
   SECCIONES
   ========================================================= */
router.post(
  "/plantillas/:idPlantilla/secciones",
  verifyToken,
  requirePerm("informes.secciones.create"),
  informesCtrl.createSeccion
);

router.put(
  "/secciones/:idSeccion",
  verifyToken,
  requirePerm("informes.secciones.update"),
  informesCtrl.updateSeccion
);

router.delete(
  "/secciones/:idSeccion",
  verifyToken,
  requirePerm("informes.secciones.delete"),
  informesCtrl.deleteSeccion
);

/* =========================================================
   PREGUNTAS
   ========================================================= */
router.post(
  "/secciones/:idSeccion/preguntas",
  verifyToken,
  requirePerm("informes.preguntas.create"),
  informesCtrl.createPregunta
);

router.put(
  "/preguntas/:idPregunta",
  verifyToken,
  requirePerm("informes.preguntas.update"),
  informesCtrl.updatePregunta
);

router.put(
  "/preguntas/:idPregunta/mover",
  verifyToken,
  requirePerm("informes.preguntas.update"),
  informesCtrl.moverPregunta
);

router.delete(
  "/preguntas/:idPregunta",
  verifyToken,
  requirePerm("informes.preguntas.delete"),
  informesCtrl.deletePregunta
);

/* =========================================================
   SHARE LINKS (PRIVADO)
   ========================================================= */
router.post(
  "/share-links",
  verifyToken,
  requirePerm("informes.sharelinks.manage"),
  informesCtrl.createShareLink
);

router.get(
  "/plantillas/:idPlantilla/share-links",
  verifyToken,
  requirePerm("informes.sharelinks.manage"),
  informesCtrl.listShareLinksByPlantilla
);

router.put(
  "/share-links/:idShare/cerrar",
  verifyToken,
  requirePerm("informes.sharelinks.manage"),
  informesCtrl.closeShareLink
);

router.delete(
  "/share-links/:idShare",
  verifyToken,
  requirePerm("informes.sharelinks.manage"),
  informesCtrl.eliminarShareLink
);

/* =========================================================
   INFORMES LLENADOS (LISTADOS / GEO / BUSQUEDAS)
   ========================================================= */

// Plantillas usadas por proyecto
router.get(
  "/proyecto/:idProyecto/por-plantilla",
  verifyToken,
  requirePerm("informes.read"),
  informesCtrl.listPlantillasByProyecto
);

// Puntos geojson (mapa)
router.get(
  "/proyecto/:idProyecto/puntos",
  verifyToken,
  requirePerm("informes.geo.read"),
  informesCtrl.getInformesPuntosGeojson
);

// Buscar personas por proyecto
router.get(
  "/proyecto/:idProyecto/personas",
  verifyToken,
  requirePerm("informes.search.personas"),
  informesCtrl.buscarPersonasProyecto
);

// Preguntas usadas
router.get(
  "/proyecto/:idProyecto/preguntas",
  verifyToken,
  requirePerm("informes.read"),
  informesCtrl.getPreguntasByProyecto
);

// Buscar texto en respuestas
router.get(
  "/proyecto/:idProyecto/buscar-respuestas",
  verifyToken,
  requirePerm("informes.search.respuestas"),
  informesCtrl.buscarRespuestasProyecto
);

// Listar informes del proyecto
router.get(
  "/proyecto/:idProyecto",
  verifyToken,
  requirePerm("informes.read"),
  informesCtrl.listInformesByProyecto
);

// Borrado masivo (admin + informes.delete)
router.post(
  "/proyecto/:idProyecto/plantilla/:idPlantilla/bulk-delete",
  verifyToken,
  requirePerm("informes.delete"),
  informesCtrl.bulkDeleteInformesByProyectoPlantilla
);

/* =========================================================
   IMPORTADOR MASIVO (ZIP)
   ========================================================= */
router.post(
  "/proyecto/:idProyecto/import-photos-zip",
  verifyToken,
  requirePerm("informes.update"),
  massiveImportCtrl.importPhotosZip
);

/* =========================================================
   EXPORTS POR PROYECTO (PDF / DOCX / EXCEL)
   ========================================================= */
router.get(
  "/proyecto/:idProyecto/pdf",
  verifyToken,
  requirePerm("informes.export.pdf"),
  informesCtrl.generarPdfProyecto
);

router.get(
  "/proyecto/:idProyecto/docx",
  verifyToken,
  requirePerm("informes.export.docx"),
  informesCtrl.generarWordProyecto
);

// ✅ compat antigua
router.get(
  "/proyecto/:idProyecto/export/excel",
  verifyToken,
  requirePerm("informes.export.xlsx"),
  informesCtrl.exportProyectoInformesExcel
);

/* =========================================================
   INFORME INDIVIDUAL (CRUD + EXPORT)
   ⚠️ orden: rutas específicas antes del "/:id"
   ========================================================= */
router.get(
  "/:id/pdf",
  verifyToken,
  requirePerm("informes.export.pdf"),
  informesCtrl.generarPdf
);

router.post(
  "/",
  verifyToken,
  requirePerm("informes.create"),
  informesCtrl.crearInforme
);

router.put(
  "/:id",
  verifyToken,
  requirePerm("informes.update"),
  informesCtrl.actualizarInforme
);

router.delete(
  "/:id/fotos/:idFoto",
  verifyToken,
  requirePerm("informes.update"),
  informesCtrl.deleteInformeFoto
);

router.delete(
  "/:id",
  verifyToken,
  requirePerm("informes.delete"),
  informesCtrl.deleteInforme
);

router.get(
  "/:id",
  verifyToken,
  requirePerm("informes.read"),
  informesCtrl.getInforme
);

module.exports = router;
