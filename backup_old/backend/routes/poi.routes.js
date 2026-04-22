// routes/poi.routes.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const poi = require("../controllers/poi.controller");
const poiCategory = require("../controllers/poiCategory.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

/* =========================
   Upload imagen POI
========================= */
router.post(
  "/poi/upload",
  verifyToken,
  requirePerm("poi.upload"),
  async (req, res) => {
    try {
      if (!req.files || !req.files.foto) {
        return res.status(400).json({ error: "No se recibió archivo (campo: foto)" });
      }

      const { id_proyecto } = req.body || {};
      if (!id_proyecto) return res.status(400).json({ error: "id_proyecto es requerido" });

      const rawTramo = (req.body?.id_tramo ?? "").toString().trim();
      const tramoFolder = rawTramo && rawTramo !== "null" ? `tramo_${rawTramo}` : "libre";

      const destDir = path.join(__dirname, "..", "uploads", "poi", `proyecto_${id_proyecto}`, tramoFolder);
      fs.mkdirSync(destDir, { recursive: true });

      const file = req.files.foto;

      const MAX_MB = 8;
      if (file.size > MAX_MB * 1024 * 1024) {
        return res.status(400).json({ error: `Archivo muy grande. Máx ${MAX_MB}MB` });
      }

      const orig = file.name || "imagen";
      const ext = path.extname(orig).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        return res.status(400).json({ error: "Formato no permitido. Use PNG, JPG/JPEG o WEBP" });
      }

      const base = path.basename(orig, ext).replace(/[^a-z0-9_\-]+/gi, "_");
      const filename = `${base}_${Date.now()}${ext}`;
      const absPath = path.join(destDir, filename);

      await file.mv(absPath);

      const relUrl = `/uploads/poi/proyecto_${id_proyecto}/${tramoFolder}/${filename}`.replace(/\\/g, "/");
      return res.json({ ok: true, url: relUrl });
    } catch (e) {
      console.error("poi.upload error:", e);
      return res.status(500).json({ error: "Error al subir la imagen", detalle: e.message });
    }
  }
);

/* =========================
   Upload icono categoría POI
========================= */
router.post(
  "/poi-categorias/upload-icon",
  verifyToken,
  requirePerm("poi.categories.upload"),
  async (req, res) => {
    try {
      if (!req.files || !req.files.icon) {
        return res.status(400).json({ error: "No se recibió archivo (campo: icon)" });
      }

      const destDir = path.join(__dirname, "..", "uploads", "poi_categorias");
      fs.mkdirSync(destDir, { recursive: true });

      const file = req.files.icon;

      const MAX_MB = 3;
      if (file.size > MAX_MB * 1024 * 1024) {
        return res.status(400).json({ error: `Archivo muy grande. Máx ${MAX_MB}MB` });
      }

      const orig = file.name || "icon";
      const ext = path.extname(orig).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) {
        return res.status(400).json({ error: "Formato no permitido. Use PNG, JPG/JPEG, WEBP o SVG" });
      }

      const base = path.basename(orig, ext).replace(/[^a-z0-9_\-]+/gi, "_");
      const filename = `${base}_${Date.now()}${ext}`;
      const absPath = path.join(destDir, filename);

      await file.mv(absPath);

      const relUrl = `/uploads/poi_categorias/${filename}`.replace(/\\/g, "/");
      return res.json({ ok: true, url: relUrl });
    } catch (e) {
      console.error("poi-categorias.upload-icon error:", e);
      return res.status(500).json({ error: "Error al subir el ícono", detalle: e.message });
    }
  }
);

/* =========================
   Lecturas POI
========================= */
router.get("/poi/tramo/:id_tramo",       verifyToken, requirePerm("poi.read"), poi.getByTramo);
router.get("/poi/proyecto/:id_proyecto", verifyToken, requirePerm("poi.read"), poi.getByProyecto);
router.get("/poi/:id(\\d+)",             verifyToken, requirePerm("poi.read"), poi.getOne);

/* =========================
   CRUD POI
========================= */
router.post("/poi",              verifyToken, requirePerm("poi.create"), poi.create);
router.put("/poi/:id(\\d+)",     verifyToken, requirePerm("poi.update"), poi.update);
router.delete("/poi/:id(\\d+)",  verifyToken, requirePerm("poi.delete"), poi.remove);

/* =========================
   Categorías POI (CRUD)
========================= */
router.get("/poi-categorias",            verifyToken, requirePerm("poi.categories.read"), poiCategory.list);
router.post("/poi-categorias",           verifyToken, requirePerm("poi.categories.create"), poiCategory.create);
router.put("/poi-categorias/:id(\\d+)",  verifyToken, requirePerm("poi.categories.update"), poiCategory.update);
router.delete("/poi-categorias/:id(\\d+)",verifyToken, requirePerm("poi.categories.delete"), poiCategory.remove);

module.exports = router;
