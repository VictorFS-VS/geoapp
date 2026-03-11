// jobs/regenciaAlertas.job.js
const pool = require("../db");
const { crearNotif } = require("../services/regenciaNotifs");

async function contratoVigenteOK(id_proyecto) {
  const q = `
    SELECT 1
    FROM ema.regencia_contratos
    WHERE id_proyecto=$1 AND estado='ACTIVO' AND fecha_fin >= CURRENT_DATE
    ORDER BY fecha_fin DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [id_proyecto]);
  return rows.length > 0;
}

async function jobDispararAlertas() {
  const q = `
    SELECT
      q.id as id_queue,
      q.disparar_at,
      a.id as id_alerta,
      a.canal,
      act.id as id_actividad,
      act.id_proyecto,
      act.titulo,
      act.tipo,
      act.inicio_at
    FROM ema.regencia_alertas_queue q
    JOIN ema.regencia_alertas a ON a.id = q.id_alerta
    JOIN ema.regencia_actividades act ON act.id = a.id_actividad
    WHERE q.estado='PENDIENTE'
      AND q.disparar_at <= now()
      AND a.activo = true
      AND act.estado='PENDIENTE'
    ORDER BY q.disparar_at ASC
    LIMIT 200;
  `;
  const { rows } = await pool.query(q);

  for (const item of rows) {
    const {
      id_queue,
      id_proyecto,
      id_actividad,
      titulo,
      tipo,
      inicio_at,
    } = item;

    // Bloqueo por contrato vencido (excepto tipo CONTRATO)
    if (tipo !== "CONTRATO") {
      const ok = await contratoVigenteOK(id_proyecto);
      if (!ok) {
        await pool.query(`UPDATE ema.regencia_alertas_queue SET estado='CANCELADA' WHERE id=$1`, [id_queue]);
        continue;
      }
    }

    // Responsables: por actividad (si no hay, podés caer a responsables del proyecto)
    const respQ = `
      SELECT id_usuario, id_consultor, email_externo
      FROM ema.regencia_responsables
      WHERE id_actividad=$1;
    `;
    const { rows: responsables } = await pool.query(respQ, [id_actividad]);

    const dedupeBase = `REG_ALERTA:act=${id_actividad}:at=${new Date(inicio_at).toISOString()}`;

    for (const r of responsables) {
      await crearNotif({
        id_proyecto,
        id_usuario: r.id_usuario || null,
        id_consultor: r.id_consultor || null,
        titulo: `Recordatorio: ${titulo}`,
        mensaje: `Actividad (${tipo}) programada para ${inicio_at}.`,
        tipo: `REG_${tipo}`,
        dedupe_key: `${dedupeBase}:u=${r.id_usuario || "null"}:c=${r.id_consultor || "null"}`,
      });
    }

    await pool.query(`UPDATE ema.regencia_alertas_queue SET estado='ENVIADA' WHERE id=$1`, [id_queue]);
  }
}

module.exports = { jobDispararAlertas };
