// jobs/regenciaAlertas.job.js
const pool = require("../db");
const { crearNotif, notificarClientePorIdCliente } = require("../services/regenciaNotifs");

async function contratoVigenteOK(id_proyecto) {
  const q = `
    SELECT 1
    FROM ema.regencia_contratos
    WHERE id_proyecto = $1
      AND estado = 'ACTIVO'
      AND fecha_fin >= CURRENT_DATE
    ORDER BY fecha_fin DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(q, [id_proyecto]);
  return rows.length > 0;
}

/**
 * Convierte public.users.id -> id_cliente
 */
async function getIdClienteByUserId(userId) {
  if (!userId) return null;

  const { rows } = await pool.query(
    `
    SELECT id_cliente
    FROM public.users
    WHERE id = $1
      AND active = 1
    LIMIT 1
    `,
    [userId]
  );

  return rows[0]?.id_cliente || null;
}

/**
 * Convierte public.users.id -> id_consultor
 * (por si alguna vez regencia_responsables.id_consultor viniera mal cargado como users.id)
 */
async function getIdConsultorByUserId(userId) {
  if (!userId) return null;

  const { rows } = await pool.query(
    `
    SELECT id_consultor
    FROM public.users
    WHERE id = $1
      AND active = 1
    LIMIT 1
    `,
    [userId]
  );

  return rows[0]?.id_consultor || null;
}

/**
 * Obtiene cliente/consultor del proyecto como fallback.
 */
async function getProyectoDestinatarios(id_proyecto) {
  const { rows } = await pool.query(
    `
    SELECT gid AS id_proyecto, id_cliente, id_consultor
    FROM ema.proyectos
    WHERE gid = $1
    LIMIT 1
    `,
    [id_proyecto]
  );
  return rows[0] || null;
}

function formatFechaHora(value) {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value || "");
    return d.toLocaleString("es-PY");
  } catch {
    return String(value || "");
  }
}

async function jobDispararAlertas() {
  const q = `
    SELECT
      q.id AS id_queue,
      q.disparar_at,
      a.id AS id_alerta,
      a.canal,
      act.id AS id_actividad,
      act.id_proyecto,
      act.titulo,
      act.tipo,
      act.inicio_at
    FROM ema.regencia_alertas_queue q
    JOIN ema.regencia_alertas a ON a.id = q.id_alerta
    JOIN ema.regencia_actividades act ON act.id = a.id_actividad
    WHERE q.estado = 'PENDIENTE'
      AND q.disparar_at <= now()
      AND a.activo = true
      AND act.estado = 'PENDIENTE'
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

    try {
      // Bloqueo por contrato vencido (excepto tipo CONTRATO)
      if (tipo !== "CONTRATO") {
        const ok = await contratoVigenteOK(id_proyecto);
        if (!ok) {
          await pool.query(
            `UPDATE ema.regencia_alertas_queue SET estado='CANCELADA' WHERE id=$1`,
            [id_queue]
          );
          continue;
        }
      }

      // Responsables directos de la actividad
      const respQ = `
        SELECT id_usuario, id_consultor, email_externo
        FROM ema.regencia_responsables
        WHERE id_actividad = $1;
      `;
      const { rows: responsables } = await pool.query(respQ, [id_actividad]);

      const dedupeBase = `REG_ALERTA:act=${id_actividad}:at=${new Date(inicio_at).toISOString()}`;
      const fechaLegible = formatFechaHora(inicio_at);

      let enviados = 0;

      for (const r of responsables) {
        let idClienteNotif = null;
        let idConsultorNotif = null;

        // Si id_usuario viene como public.users.id -> traducir a id_cliente
        if (r.id_usuario) {
          idClienteNotif = await getIdClienteByUserId(r.id_usuario);
        }

        // Si id_consultor ya es id_consultor real, se usa directo
        // Si por error viene como users.id, intentamos traducir
        if (r.id_consultor) {
          idConsultorNotif = r.id_consultor;

          // opcional: si querés validar existencia real en users, podrías mapear acá.
          // Lo dejamos directo porque tu esquema general usa id_consultor real.
        }

        // Notificación al cliente
        if (idClienteNotif) {
          await crearNotif({
            id_proyecto,
            id_usuario: idClienteNotif, // ✅ id_cliente
            titulo: `Recordatorio: ${titulo}`,
            mensaje: `Actividad (${tipo}) programada para ${fechaLegible}.`,
            tipo: `REG_${String(tipo || "").toUpperCase()}`,
            dedupe_key: `${dedupeBase}:cliente=${idClienteNotif}`,
          });
          enviados++;
        }

        // Notificación al consultor
        if (idConsultorNotif) {
          await crearNotif({
            id_proyecto,
            id_consultor: idConsultorNotif, // ✅ id_consultor
            titulo: `Recordatorio: ${titulo}`,
            mensaje: `Actividad (${tipo}) programada para ${fechaLegible}.`,
            tipo: `REG_${String(tipo || "").toUpperCase()}`,
            dedupe_key: `${dedupeBase}:consultor=${idConsultorNotif}`,
          });
          enviados++;
        }
      }

      /**
       * Fallback:
       * si la actividad no tenía responsables o ninguno resolvió bien,
       * notificar al cliente/consultor del proyecto.
       */
      if (enviados === 0) {
        const proyecto = await getProyectoDestinatarios(id_proyecto);

        if (proyecto?.id_cliente) {
          await notificarClientePorIdCliente({
            id_cliente: proyecto.id_cliente,
            id_proyecto,
            titulo: `Recordatorio: ${titulo}`,
            mensaje: `Actividad (${tipo}) programada para ${fechaLegible}.`,
            tipo: `REG_${String(tipo || "").toUpperCase()}`,
            dedupe_base: `${dedupeBase}:fallback`,
          });
        }

        if (proyecto?.id_consultor) {
          await crearNotif({
            id_proyecto,
            id_consultor: proyecto.id_consultor,
            titulo: `Recordatorio: ${titulo}`,
            mensaje: `Actividad (${tipo}) programada para ${fechaLegible}.`,
            tipo: `REG_${String(tipo || "").toUpperCase()}`,
            dedupe_key: `${dedupeBase}:fallback:consultor=${proyecto.id_consultor}`,
          });
        }
      }

      await pool.query(
        `UPDATE ema.regencia_alertas_queue SET estado='ENVIADA' WHERE id=$1`,
        [id_queue]
      );
    } catch (e) {
      console.warn(
        "[Regencia] jobDispararAlertas error queue",
        id_queue,
        "-",
        e?.message || e
      );
    }
  }
}

module.exports = { jobDispararAlertas };