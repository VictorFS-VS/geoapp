"use strict";

// routes/documentos.routes.js
const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");
const documentosCtrl = require("../controllers/documentos.controller");

/* === Resoluciones === */
router.get(
  "/resolucion/:idResolucion",
  verifyToken,
  requirePerm("documentos.read"),
  documentosCtrl.listarDocumentosResolucion
);

router.post(
  "/resolucion/:idResolucion/upload",
  verifyToken,
  requirePerm("documentos.upload"),
  documentosCtrl.subirDocumentoResolucion
);

/* === Carpetas por proyecto === */
router.get(
  "/carpetas/:idProyecto",
  verifyToken,
  requirePerm("documentos.read"),
  documentosCtrl.listarCarpetas
);

router.post(
  "/carpetas/:idProyecto",
  verifyToken,
  requirePerm("documentos.create_folder"),
  documentosCtrl.crearCarpeta
);

/* === Legacy por proyecto/formulario === */
router.get(
  "/listar/:idProyecto/:formulario",
  verifyToken,
  requirePerm("documentos.read"),
  documentosCtrl.listarDocumentos
);

router.post(
  "/upload/:idProyecto/:formulario",
  verifyToken,
  requirePerm("documentos.upload"),
  documentosCtrl.subirDocumento
);

/* === Acciones por archivo === */
router.get(
  "/descargar/:idArchivo",
  verifyToken,
  requirePerm("documentos.read"),
  documentosCtrl.descargarPorId
);

router.get(
  "/ver/:idArchivo",
  verifyToken,
  requirePerm("documentos.read"),
  documentosCtrl.verInline
);

router.patch(
  "/renombrar/:idArchivo",
  verifyToken,
  requirePerm("documentos.rename"),
  documentosCtrl.renombrarDocumento
);

router.delete(
  "/eliminar/:idArchivo",
  verifyToken,
  requirePerm("documentos.delete"),
  documentosCtrl.eliminarDocumento
);

module.exports = router;
