"use strict";

const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requireAny, requireAdmin } = require("../middlewares/requirePerm");
const ctrl = require("../controllers/projectHomeItem.controller");

router.use(verifyToken);

// GET /api/project-home/items?id_proyecto=...
router.get("/items", requireAny(["informes.read"]), ctrl.listItems);

// POST /api/project-home/items
router.post("/items", requireAdmin(), ctrl.createItem);

// PUT /api/project-home/items/:id_home_item
router.put("/items/:id_home_item(\\d+)", requireAdmin(), ctrl.updateItem);

// PATCH /api/project-home/items/:id_home_item/disable
router.patch("/items/:id_home_item(\\d+)/disable", requireAdmin(), ctrl.disableItem);

// PATCH /api/project-home/items/reorder
router.patch("/items/reorder", requireAdmin(), ctrl.reorderItems);

// PATCH /api/project-home/items/:id_home_item/default
router.patch("/items/:id_home_item(\\d+)/default", requireAdmin(), ctrl.setDefault);

module.exports = router;

