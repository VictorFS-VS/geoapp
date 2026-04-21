// jobs/regenciaContratos.job.js
const pool = require("../db");
const {
  insertarNotificacion,
  notificarClientePorIdCliente,
} = require("../services/regenciaNotifs");

/**
 * Obtiene id_cliente e id_consultor del proyecto (ema.proyectos.gid)
 */
async function getProyectoInfo(id_proyecto) {
  const q = `
    SELECT gid AS id_proyecto, id_cliente, id_consultor
    FROM ema.proyectos
    WHERE gid = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [id_proyecto]);
  return rows[0] || null;
}

/**
 * Job: detecta contratos vencidos (estado ACTIVO y fecha_fin < hoy),
 * notifica consultor + cliente,
 * marca contrato como VENCIDO y cancela alertas operativas pendientes.
 */
async function jobContratosVencidos() {
  const vencidosQ = `
    SELECT id, id_proyecto, fecha_fin
    FROM ema.regencia_contratos
    WHERE estado = 'ACTIVO'
      AND fecha_fin < CURRENT_DATE;
  `;

  const { rows: contratosVencidos } = await pool.query(vencidosQ);

  for (const c of contratosVencidos) {
    const { id: id_contrato, id_proyecto, fecha_fin } = c;

    try {
      const proyecto = await getProyectoInfo(id_proyecto);
      if (!proyecto) continue;

      const { id_cliente, id_consultor } = proyecto;

      // 1) Notificar consultor
      if (id_consultor) {
        await insertarNotificacion({
          id_proyecto,
          id_consultor,
          titulo: "Contrato vencido",
          mensaje: `El contrato del proyecto venció el ${fecha_fin}. Regencia suspendida: no corresponde realizar visitas/actividades hasta renovar.`,
          tipo: "REG_CONTRATO_VENCIDO",
          dedupe_key: `REG_CONTRATO_VENCIDO:proy=${id_proyecto}:fin=${fecha_fin}:consultor=${id_consultor}`,
        });
      }

      // 2) Notificar cliente
      if (id_cliente) {
        await notificarClientePorIdCliente({
          id_cliente,
          id_proyecto,
          titulo: "Contrato vencido",
          mensaje: `Tu contrato de regencia venció el ${fecha_fin}. Para continuar con visitas e informes, por favor renovar el contrato.`,
          tipo: "REG_CONTRATO_VENCIDO",
          dedupe_base: `REG_CONTRATO_VENCIDO:proy=${id_proyecto}:fin=${fecha_fin}`,
        });
      }

      // 3) Marcar contrato como VENCIDO
      await pool.query(
        `UPDATE ema.regencia_contratos SET estado='VENCIDO' WHERE id=$1`,
        [id_contrato]
      );

      // 4) Cancelar alertas operativas pendientes
      await pool.query(
        `
        UPDATE ema.regencia_alertas_queue q
        SET estado='CANCELADA'
        FROM ema.regencia_alertas a
        JOIN ema.regencia_actividades act ON act.id = a.id_actividad
        WHERE q.id_alerta = a.id
          AND q.estado='PENDIENTE'
          AND act.id_proyecto = $1
          AND act.tipo IN ('VISITA','ENTREGA_INFORME','AUDITORIA');
        `,
        [id_proyecto]
      );
    } catch (e) {
      console.warn(
        "[Regencia] jobContratosVencidos error contrato",
        id_contrato,
        "-",
        e?.message || e
      );
    }
  }
}

module.exports = { jobContratosVencidos };