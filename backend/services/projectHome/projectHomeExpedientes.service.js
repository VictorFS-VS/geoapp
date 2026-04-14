"use strict";

const pool = require("../../db");

async function tableExists(fqn) {
  const r = await pool.query("SELECT to_regclass($1) AS oid", [fqn]);
  return !!r.rows?.[0]?.oid;
}

function safeInt(v) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Minimal expedientes summary for Project Home.
 *
 * Rules V1:
 * - total: total expedientes for project
 * - con_geo: gps non-empty OR at least one geom present in any bloque table
 * - con_avance: at least one stage ok===true in carpeta_mejora OR carpeta_terreno
 * - missing tables/data -> return zeros (do not throw)
 */
async function getProjectHomeExpedientesResumen({ _req, id_proyecto }) {
  try {
    if (!(await tableExists("ema.expedientes"))) {
      return { total: 0, con_geo: 0, sin_geo: 0, con_avance: 0, sin_avance: 0 };
    }

    const geomTables = [
      { fqn: "ema.bloque_mejoras", alias: "bm" },
      { fqn: "ema.bloque_terreno", alias: "bt" },
      { fqn: "ema.bloque_expediente", alias: "be" },
    ];

    const geomExistsParts = [];
    for (const t of geomTables) {
      // If the table doesn't exist, skip that condition entirely.
      // This avoids runtime failures in installations without those módulos.
      // eslint-disable-next-line no-await-in-loop
      if (!(await tableExists(t.fqn))) continue;
      geomExistsParts.push(
        `EXISTS (SELECT 1 FROM ${t.fqn} ${t.alias} WHERE ${t.alias}.id_expediente = e.id_expediente AND ${t.alias}.geom IS NOT NULL)`
      );
    }

    const geomOkSql = geomExistsParts.length ? `(${geomExistsParts.join(" OR ")})` : "false";

    const q = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE (
            TRIM(COALESCE(e.gps, '')) <> ''
            OR ${geomOkSql}
          )
        )::int AS con_geo,
        COUNT(*)::int AS con_avance
      FROM ema.expedientes e
      WHERE e.id_proyecto = $1
    `;

    const r = await pool.query(q, [Number(id_proyecto)]);
    const row = r.rows?.[0] || {};
    const total = safeInt(row.total);
    const con_geo = safeInt(row.con_geo);
    const con_avance = safeInt(row.con_avance);

    return {
      total,
      con_geo,
      sin_geo: Math.max(0, total - con_geo),
      con_avance,
      sin_avance: Math.max(0, total - con_avance),
    };
  } catch (_e) {
    return { total: 0, con_geo: 0, sin_geo: 0, con_avance: 0, sin_avance: 0 };
  }
}

module.exports = { getProjectHomeExpedientesResumen };

