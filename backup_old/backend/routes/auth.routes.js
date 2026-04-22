// backend/routes/auth.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const { register, login, me } = require("../controllers/auth.controller");
const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

router.post("/login", login);

// ✅ RBAC: registro requiere permiso
router.post("/register", verifyToken, requirePerm("usuarios.create"), register);

router.get("/me", verifyToken, me);

module.exports = router;
