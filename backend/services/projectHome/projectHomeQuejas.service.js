"use strict";

const pool = require("../../db");

/**
 * Retorna las métricas ejecutivas de Quejas y Reclamos para el Home de un proyecto.
 */
async function getProjectHomeQuejasResumen({ req, id_proyecto }) {
  if (!id_proyecto) {
    return { total: 0, pendientes: 0, cerradas: 0 };
  }

  try {
    // Nota: Mantenemos el error suprimido a fallback 0 si la tabla no existe 
    // en la BD de algún tenant transicional o si el proyecto no tiene data,
    // para NO romper la carga del Home global.
    const query = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado IN ('abierto', 'en_proceso')) AS pendientes,
        COUNT(*) FILTER (WHERE estado IN ('cerrado', 'respondido')) AS cerradas
      FROM ema.quejas_reclamos
      WHERE id_proyecto = $1
    `;
    const { rows } = await pool.query(query, [id_proyecto]);

    if (!rows || rows.length === 0) {
      return { total: 0, pendientes: 0, cerradas: 0 };
    }

    return {
      total: Number(rows[0].total) || 0,
      pendientes: Number(rows[0].pendientes) || 0,
      cerradas: Number(rows[0].cerradas) || 0,
    };
  } catch (err) {
    console.error("Error en projectHomeQuejas.service.getProjectHomeQuejasResumen:", err);
    // Silent fail to degrade gracefully in the Home payload
    return { total: 0, pendientes: 0, cerradas: 0, error: true };
  }
}

module.exports = {
  getProjectHomeQuejasResumen,
};
