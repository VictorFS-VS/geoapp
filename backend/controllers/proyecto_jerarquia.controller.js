// backend/controllers/proyecto_jerarquia.controller.js
// CRUD mínimo para Proyecto → Tramo → Subtramo y catálogo vial
"use strict";

const model = require("../models/proyecto_jerarquia.model");

/* ─────────────────────────────────────────────
   GET /api/proyectos/:id/jerarquia-tramos
───────────────────────────────────────────── */
const getJerarquia = async (req, res) => {
    const idProyecto = parseInt(req.params.id, 10);
    if (!Number.isFinite(idProyecto) || idProyecto <= 0)
        return res.status(400).json({ ok: false, message: "id proyecto inválido" });

    try {
        const data = await model.getJerarquia(idProyecto);
        return res.json({ ok: true, ...data });
    } catch (err) {
        console.error("getJerarquia error:", err);
        return res.status(500).json({ ok: false, message: "Error interno al leer jerarquía" });
    }
};

/* ─────────────────────────────────────────────
   PUT /api/proyectos/:id/jerarquia-tramos
   Body: { tramos: [...] }
───────────────────────────────────────────── */
const saveJerarquia = async (req, res) => {
    const idProyecto = parseInt(req.params.id, 10);
    if (!Number.isFinite(idProyecto) || idProyecto <= 0)
        return res.status(400).json({ ok: false, message: "id proyecto inválido" });

    const tramos = req.body?.tramos;
    if (!Array.isArray(tramos))
        return res.status(400).json({ ok: false, message: "Se espera { tramos: [] }" });

    try {
        await model.saveJerarquia(idProyecto, tramos);
        const data = await model.getJerarquia(idProyecto);
        return res.json({ ok: true, ...data });
    } catch (err) {
        console.error("saveJerarquia error:", err);
        const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
        return res.status(status).json({
            ok: false,
            message: status === 500 ? "Error interno al guardar jerarquía" : (err?.message || "Datos inválidos")
        });
    }
};

/* ─────────────────────────────────────────────
   GET /api/vial/tramos-catalogo
───────────────────────────────────────────── */
const getVialCatalogo = async (_req, res) => {
    try {
        const items = await model.getVialCatalogo();
        return res.json({ ok: true, items });
    } catch (err) {
        console.error("getVialCatalogo error:", err);
        return res.status(500).json({ ok: false, message: "Error interno al obtener catálogo vial" });
    }
};

/* ─────────────────────────────────────────────
   GET /api/proyectos/:proyectoId/tramos-censales
───────────────────────────────────────────── */
const getTramosCensales = async (req, res) => {
    const idProyecto = parseInt(req.params.proyectoId, 10);
    if (!Number.isFinite(idProyecto) || idProyecto <= 0)
        return res.status(400).json({ ok: false, message: "id proyecto inválido" });

    try {
        const items = await model.getTramosCensales(idProyecto);
        return res.json({ ok: true, proyectoId: idProyecto, items });
    } catch (err) {
        console.error("getTramosCensales error:", err);
        return res.status(500).json({ ok: false, message: "Error interno al obtener tramos censales" });
    }
};

/* ─────────────────────────────────────────────
   GET /api/proyectos/:proyectoId/tramos-censales/:tramoId/subtramos
───────────────────────────────────────────── */
const getSubtramosCensales = async (req, res) => {
    const idProyecto = parseInt(req.params.proyectoId, 10);
    const idTramo = parseInt(req.params.tramoId, 10);

    if (!Number.isFinite(idProyecto) || idProyecto <= 0)
        return res.status(400).json({ ok: false, message: "id proyecto inválido" });
    if (!Number.isFinite(idTramo) || idTramo <= 0)
        return res.status(400).json({ ok: false, message: "id tramo inválido" });

    try {
        const items = await model.getSubtramosCensales(idProyecto, idTramo);
        if (items === null) {
            return res.status(404).json({ ok: false, message: "El tramo no pertenece al proyecto indicado o no existe" });
        }
        return res.json({ ok: true, proyectoId: idProyecto, tramoId: idTramo, items });
    } catch (err) {
        console.error("getSubtramosCensales error:", err);
        return res.status(500).json({ ok: false, message: "Error interno al obtener subtramos censales" });
    }
};

module.exports = {
    getJerarquia,
    saveJerarquia,
    getVialCatalogo,
    getTramosCensales,
    getSubtramosCensales
};
