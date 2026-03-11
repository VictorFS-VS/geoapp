// backend/models/proyecto_jerarquia.model.js
// Modelo para la jerarquía Proyecto → Tramo → Subtramo
// Tabla: ema.proyecto_tramos, ema.proyecto_subtramos
"use strict";

const pool = require("../db");

/* ─────────────────────────────────────────────
   TRAMOS
───────────────────────────────────────────── */

/**
 * Lee todos los tramos de un proyecto con sus subtramos anidados.
 * @returns { tramos: Array<{ ...tramo, subtramos: Array }> }
 */
const getJerarquia = async (idProyecto) => {
  // 1. Traer tramos
  const tramosRes = await pool.query(
    `SELECT id_proyecto_tramo, id_proyecto, descripcion, cantidad_universo, id_vial_tramo, orden
     FROM ema.proyecto_tramos
     WHERE id_proyecto = $1
     ORDER BY orden ASC, id_proyecto_tramo ASC`,
    [idProyecto]
  );

  if (!tramosRes.rows.length) return { tramos: [] };

  const tramoIds = tramosRes.rows.map((t) => t.id_proyecto_tramo);

  // 2. Traer todos los subtramos de esos tramos en un solo query
  const subtramosRes = await pool.query(
    `SELECT id_proyecto_subtramo, id_proyecto_tramo, descripcion, cantidad_universo, orden
     FROM ema.proyecto_subtramos
     WHERE id_proyecto_tramo = ANY($1::int[])
     ORDER BY id_proyecto_tramo ASC, orden ASC, id_proyecto_subtramo ASC`,
    [tramoIds]
  );

  // 3. Agrupar subtramos por id_proyecto_tramo
  const subsByTramo = {};
  for (const s of subtramosRes.rows) {
    (subsByTramo[s.id_proyecto_tramo] ||= []).push(s);
  }

  const tramos = tramosRes.rows.map((t) => ({
    ...t,
    subtramos: subsByTramo[t.id_proyecto_tramo] || [],
  }));

  return { tramos };
};

const parseOptInt = (val, fallback = null) => {
  if (val === "" || val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Persiste la jerarquía completa de un proyecto con estrategia de sincronización
 * determinística (upsert por ID conocido + insert para IDs faltantes + delete de IDs no presentes).
 */
const saveJerarquia = async (idProyecto, tramos) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ─── IDs entrantes ───
    const tramoIdsEntrantes = tramos
      .map((t) => t.id_proyecto_tramo)
      .filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)
      .map(Number);

    // ─── Eliminar tramos que ya no están ───
    if (tramoIdsEntrantes.length) {
      await client.query(
        `DELETE FROM ema.proyecto_tramos
         WHERE id_proyecto = $1 AND id_proyecto_tramo <> ALL($2::int[])`,
        [idProyecto, tramoIdsEntrantes]
      );
    } else {
      // Si no vienen IDs, borrar todos los tramos del proyecto
      await client.query(
        `DELETE FROM ema.proyecto_tramos WHERE id_proyecto = $1`,
        [idProyecto]
      );
    }

    // ─── Upsert de tramos ───
    for (const t of tramos) {
      const idT = Number.isFinite(Number(t.id_proyecto_tramo)) && Number(t.id_proyecto_tramo) > 0
        ? Number(t.id_proyecto_tramo)
        : null;

      let idTramoReal;

      if (idT) {
        // Actualizar tramo existente
        await client.query(
          `UPDATE ema.proyecto_tramos
           SET descripcion = $1, cantidad_universo = $2, id_vial_tramo = $3, orden = $4
           WHERE id_proyecto_tramo = $5 AND id_proyecto = $6`,
          [
            t.descripcion || "",
            parseOptInt(t.cantidad_universo, null),
            parseOptInt(t.id_vial_tramo, null),
            parseOptInt(t.orden, 0),
            idT,
            idProyecto,
          ]
        );
        idTramoReal = idT;
      } else {
        // Insertar tramo nuevo
        const ins = await client.query(
          `INSERT INTO ema.proyecto_tramos (id_proyecto, descripcion, cantidad_universo, id_vial_tramo, orden)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id_proyecto_tramo`,
          [
            idProyecto,
            t.descripcion || "",
            parseOptInt(t.cantidad_universo, null),
            parseOptInt(t.id_vial_tramo, null),
            parseOptInt(t.orden, 0),
          ]
        );
        idTramoReal = ins.rows[0].id_proyecto_tramo;
      }

      // ─── Subtramos de este tramo ───
      const subtramos = Array.isArray(t.subtramos) ? t.subtramos : [];
      const subIdsEntrantes = subtramos
        .map((s) => s.id_proyecto_subtramo)
        .filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)
        .map(Number);

      if (subIdsEntrantes.length) {
        await client.query(
          `DELETE FROM ema.proyecto_subtramos
           WHERE id_proyecto_tramo = $1 AND id_proyecto_subtramo <> ALL($2::int[])`,
          [idTramoReal, subIdsEntrantes]
        );
      } else {
        await client.query(
          `DELETE FROM ema.proyecto_subtramos WHERE id_proyecto_tramo = $1`,
          [idTramoReal]
        );
      }

      for (const s of subtramos) {
        const idS = Number.isFinite(Number(s.id_proyecto_subtramo)) && Number(s.id_proyecto_subtramo) > 0
          ? Number(s.id_proyecto_subtramo)
          : null;

        if (idS) {
          await client.query(
            `UPDATE ema.proyecto_subtramos
             SET descripcion = $1, cantidad_universo = $2, orden = $3
             WHERE id_proyecto_subtramo = $4 AND id_proyecto_tramo = $5`,
            [s.descripcion || "", parseOptInt(s.cantidad_universo, null), parseOptInt(s.orden, 0), idS, idTramoReal]
          );
        } else {
          await client.query(
            `INSERT INTO ema.proyecto_subtramos (id_proyecto_tramo, descripcion, cantidad_universo, orden)
             VALUES ($1, $2, $3, $4)`,
            [idTramoReal, s.descripcion || "", parseOptInt(s.cantidad_universo, null), parseOptInt(s.orden, 0)]
          );
        }
      }
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/* ─────────────────────────────────────────────
   CATÁLOGO VIAL  (fuente: ema.tramos)
───────────────────────────────────────────── */

/**
 * Devuelve los tramos de ema.tramos como catálogo minimal para select.
 * id = id_tramo, descripcion = nombre_tramo || ubicacion || fallback
 */
const getVialCatalogo = async () => {
  const { rows } = await pool.query(
    `SELECT
       id_tramo AS id,
       COALESCE(
         NULLIF(trim(nombre_tramo), ''),
         NULLIF(trim(ubicacion), ''),
         'Tramo ' || id_tramo
       ) AS descripcion
     FROM ema.tramos
     ORDER BY id_tramo ASC
     LIMIT 2000`
  );
  return rows;
};

/* ─────────────────────────────────────────────
   CENSUS LITE ENDPOINTS
───────────────────────────────────────────── */

/**
 * Devuelve un catálogo liviano de tramos del proyecto con su campo universo_censal.
 */
const getTramosCensales = async (idProyecto) => {
  const { rows } = await pool.query(
    `SELECT
       id_proyecto_tramo,
       descripcion,
       cantidad_universo,
       cantidad_universo AS universo_censal,
       id_vial_tramo
     FROM ema.proyecto_tramos
     WHERE id_proyecto = $1
     ORDER BY orden ASC, descripcion ASC`,
    [idProyecto]
  );
  return rows;
};

/**
 * Devuelve un catálogo liviano de subtramos censales validando que 
 * el tramoId pertenece al proyecto indicado.
 */
const getSubtramosCensales = async (idProyecto, idTramo) => {
  // Validar pertenencia del tramo al proyecto
  const checkRes = await pool.query(
    `SELECT 1 FROM ema.proyecto_tramos WHERE id_proyecto_tramo = $1 AND id_proyecto = $2`,
    [idTramo, idProyecto]
  );
  if (checkRes.rowCount === 0) return null;

  const { rows } = await pool.query(
    `SELECT
       id_proyecto_subtramo,
       descripcion,
       cantidad_universo,
       cantidad_universo AS universo_censal
     FROM ema.proyecto_subtramos
     WHERE id_proyecto_tramo = $1
     ORDER BY orden ASC, descripcion ASC`,
    [idTramo]
  );
  return rows;
};

module.exports = {
  getJerarquia,
  saveJerarquia,
  getVialCatalogo,
  getTramosCensales,
  getSubtramosCensales,
};
