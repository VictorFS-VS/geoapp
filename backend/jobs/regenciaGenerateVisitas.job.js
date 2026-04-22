// jobs/regenciaGenerateVisitas.job.js
const pool = require("../db");
const Reg = require("../models/regencia.model");

/**
 * Genera visitas para todos los contratos ACTIVO
 * - seed_date: fecha_inicio si existe, sino hoy (YYYY-MM-DD)
 * - genera months_ahead: 12
 * - crea solo dentro de la vigencia del contrato (lo controla el modelo)
 * - dedupe: lo controla el modelo con ON CONFLICT + índice parcial
 */
async function jobGenerarVisitasMensuales() {
  const { rows: contratos } = await pool.query(`
    SELECT id, id_proyecto, fecha_inicio, fecha_fin
    FROM ema.regencia_contratos
    WHERE estado = 'ACTIVO'
      AND fecha_fin >= CURRENT_DATE
    ORDER BY id ASC
  `);

  const hoyISO = new Date().toISOString().slice(0, 10);

  for (const c of contratos) {
    let seed = hoyISO;

    try {
      if (c.fecha_inicio) {
        const d = new Date(c.fecha_inicio);
        seed = !isNaN(d.getTime())
          ? d.toISOString().slice(0, 10)
          : String(c.fecha_inicio).slice(0, 10);
      }
    } catch {
      seed = hoyISO;
    }

    try {
      await Reg.generarVisitasMensualesDesdeContrato({
        id_contrato: c.id,
        seed_date: seed,
        hour: 9,
        minute: 0,
        months_ahead: 12,
        business_days_only: true,
        shift_if_weekend: "NEXT_BUSINESS_DAY",
        creado_por: "Sistema",
      });
    } catch (e) {
      console.warn(
        "[Regencia] jobGenerarVisitasMensuales error contrato",
        c.id,
        "-",
        e?.message || e
      );
    }
  }
}

module.exports = { jobGenerarVisitasMensuales };