// routes/notificaciones.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/notificaciones.controller");
const fcmCtrl = require("../controllers/fcm.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

/* =========================
   NOTIFICACIONES
========================= */

// 🔔 Recientes
router.get(
  "/recientes",
  requirePerm("notificaciones.read"),
  ctrl.obtenerRecientes
);

// 📄 Todas (usuario)
router.get(
  "/todas",
  requirePerm("notificaciones.read"),
  ctrl.obtenerTodas
);

// 🛠 Todas (admin / gestor)
router.get(
  "/admin/todas",
  requirePerm("notificaciones.read.admin"),
  ctrl.obtenerTodasAdmin
);

// ✅ NUEVA RUTA → marcar UNA por ID
router.put(
  "/:id/marcar-leida",
  requirePerm("notificaciones.update"),
  ctrl.marcarLeidaPorId
);

// ✅ Marcar TODAS (según usuario)
router.put(
  "/marcar-leidas",
  requirePerm("notificaciones.update"),
  ctrl.marcarComoLeidas
);

// 🧪 Test crear
router.post(
  "/test",
  requirePerm("notificaciones.test.create"),
  ctrl.testCrear
);

/* =========================
   FCM
========================= */

router.post(
  "/fcm/register",
  requirePerm("fcm.register"),
  fcmCtrl.registerFcmToken
);

router.post(
  "/fcm/test",
  requirePerm("fcm.test"),
  fcmCtrl.testPushToMe
);

module.exports = router;