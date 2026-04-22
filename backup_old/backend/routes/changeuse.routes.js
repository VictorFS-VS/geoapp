// routes/changeuse.routes.js
const express = require('express');
const { s2DiffYearsBack } = require('../controllers/changeuse_s2.controller');

const router = express.Router();

// Nuevo análisis (no toca los existentes)
router.post('/changeuse/s2/diff', s2DiffYearsBack);

module.exports = router;
