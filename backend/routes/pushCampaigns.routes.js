// routes/pushCampaigns.routes.js
"use strict";

const express = require("express");
const router = express.Router();

const {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  upsertTargets,
  sendCampaignNow,
} = require("../controllers/pushCampaigns.controller");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// ✅ todo el módulo requiere sesión
router.use(verifyToken);

// CRUD
router.get("/",        requirePerm("push_campaigns.read"),   listCampaigns);
router.get("/:id",     requirePerm("push_campaigns.read"),   getCampaign);
router.post("/",       requirePerm("push_campaigns.create"), createCampaign);
router.put("/:id",     requirePerm("push_campaigns.update"), updateCampaign);
router.delete("/:id",  requirePerm("push_campaigns.delete"), deleteCampaign);

// Targets
router.post("/:id/targets", requirePerm("push_campaigns.targets"), upsertTargets);

// Acción enviar
router.post("/:id/send", requirePerm("push_campaigns.send"), sendCampaignNow);

module.exports = router;
