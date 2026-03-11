// routes/usuarios.routes.js
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const {
  obtenerUsuarios,
  obtenerUsuarioPorId,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  obtenerUsuarioActual,
  guardarTokenFcm,
  obtenerCarteraAdmin,
  uploadAvatar,
  deleteAvatar,
} = require("../controllers/usuarios.controller");

const { requirePerm } = require("../middlewares/requirePerm");

const router = express.Router();

/* ========= Multer para AVATAR ========= */
const AVATARS_DIR = path.join(__dirname, "..", "uploads", "avatars");
try {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
} catch {}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => {
    const id = String(req.params.id || "user");
    const ext = (file.mimetype?.split("/")[1] || "png").replace("jpeg", "jpg");
    cb(null, `u${id}_${Date.now()}.${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) {
    return cb(new Error("Formato no permitido"), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
/* ===================================== */

/* =========================
   RBAC por permisos
   =========================
   usuarios.read
   usuarios.create
   usuarios.update
   usuarios.delete
*/

// ---- Rutas de usuario ----
router.get("/", requirePerm("usuarios.read"), obtenerUsuarios);
router.get("/me", requirePerm("usuarios.read"), obtenerUsuarioActual);

// Crear usuario: normalmente solo admin, pero ahora lo controla el permiso
router.post("/", requirePerm("usuarios.create"), crearUsuario);

router.get("/:id", requirePerm("usuarios.read"), obtenerUsuarioPorId);
router.put("/:id", requirePerm("usuarios.update"), actualizarUsuario);
router.delete("/:id", requirePerm("usuarios.delete"), eliminarUsuario);

// ---- Cartera ----
// Si querés separar permisos, creá usuarios.cartera.read, pero por ahora:
router.get("/:id/cartera", requirePerm("usuarios.read"), obtenerCarteraAdmin);

// ---- Token FCM ----
// Esto es "mi propio token", lo dejo con usuarios.update (o podés crear usuarios.tokenfcm)
router.post("/me/token-fcm", requirePerm("usuarios.update"), guardarTokenFcm);

// ---- Avatares ----
// GET /api/usuarios/:id/avatar lo dejás público con PUBLIC_NOAUTH en auth.middleware.js
router.post(
  "/:id/avatar",
  requirePerm("usuarios.update"),
  upload.single("avatar"),
  uploadAvatar
);

router.delete(
  "/:id/avatar",
  requirePerm("usuarios.update"),
  deleteAvatar
);

module.exports = router;
