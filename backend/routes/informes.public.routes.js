// routes/publicInforme.routes.js
"use strict";

const express = require("express");
const router = express.Router();
const informesCtrl = require("../controllers/informes.controller");

const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");

// tmp para uploads
const tmpDir = path.join(__dirname, "..", "tmp");
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

// EFU SOLO para el submit (multipart)
const efuPublic = fileUpload({
  useTempFiles: true,
  tempFileDir: tmpDir,
  createParentPath: true,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB (ajustá si querés)
  abortOnLimit: true,
});

// ✅ health-check (antes del :token)
router.get("/ping", (_req, res) => res.json({ ok: true, scope: "public-informe" }));

// ✅ Validador simple de token para evitar basura
function tokenParam(req, res, next) {
  const token = String(req.params.token || "").trim();

  // Acepta tokens tipo uuid / hex / base64url. Ajustá si tu token es diferente.
  // - mínimo 12 chars para evitar tokens demasiado cortos
  if (!token || token.length < 12) {
    return res.status(400).json({ error: "Token inválido" });
  }
  if (!/^[A-Za-z0-9_-]+$/i.test(token)) {
    return res.status(400).json({ error: "Token inválido" });
  }

  req.shareToken = token; // opcional por si querés usarlo directo en controllers
  next();
}

// ✅ Ver formulario público por token
// GET /api/public-informe/:token
router.get("/:token", tokenParam, informesCtrl.publicGetShareForm);

// ✅ Enviar respuestas por token (multipart)
// POST /api/public-informe/:token/enviar
router.post("/:token/enviar", tokenParam, efuPublic, informesCtrl.publicSubmitShareForm);

module.exports = router;
