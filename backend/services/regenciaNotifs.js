// services/regenciaNotifs.js
const pool = require("../db");
const { pushNotificacion } = require("./notifPush.service");

/**
 * IMPORTANTE:
 * - public.notificaciones.id_usuario   = public.users.id_cliente
 * - public.notificaciones.id_consultor = public.users.id_consultor
 *
 * Tu tabla actual NO tiene:
 * - tipo
 * - dedupe_key
 *
 * Entonces este servicio NO debe insertarlos.
 */

async function existeNotificacionParecida({
  id_proyecto = null,
  id_usuario = null,
  id_consultor = null,
  titulo,
  mensaje,
  minutosVentana = 5,
}) {
  const { rows } = await pool.query(
    `
    SELECT id
    FROM public.notificaciones
    WHERE COALESCE(id_proyecto, 0) = COALESCE($1, 0)
      AND COALESCE(id_usuario, 0) = COALESCE($2, 0)
      AND COALESCE(id_consultor, 0) = COALESCE($3, 0)
      AND COALESCE(titulo, '') = COALESCE($4, '')
      AND COALESCE(mensaje, '') = COALESCE($5, '')
      AND creado_en >= (now() - make_interval(mins => $6))
    LIMIT 1
    `,
    [
      id_proyecto,
      id_usuario,
      id_consultor,
      titulo || "",
      mensaje || "",
      minutosVentana,
    ]
  );

  return rows.length > 0;
}

async function insertarNotificacion({
  id_proyecto,
  id_usuario = null,     // ✅ debe venir id_cliente
  id_consultor = null,   // ✅ debe venir id_consultor
  titulo,
  mensaje,
  creado_por = "SYSTEM_REG",
  tipo = "REG",          // se acepta por compatibilidad, pero NO se guarda
  dedupe_key = null,     // se acepta por compatibilidad, pero NO se guarda
}) {
  // Evitar duplicados inmediatos, ya que tu tabla aún no tiene dedupe_key
  const yaExiste = await existeNotificacionParecida({
    id_proyecto,
    id_usuario,
    id_consultor,
    titulo,
    mensaje,
    minutosVentana: 5,
  });

  if (yaExiste) {
    return null;
  }

  const q = `
    INSERT INTO public.notificaciones
      (
        id_usuario,
        titulo,
        mensaje,
        leido_usuario,
        creado_en,
        es_global,
        id_proyecto,
        creado_por,
        id_consultor,
        leido_consultor
      )
    VALUES
      (
        $1, $2, $3, false, now(), false,
        $4, $5, $6, false
      )
    RETURNING *;
  `;

  const { rows } = await pool.query(q, [
    id_usuario,
    titulo,
    mensaje,
    id_proyecto,
    creado_por,
    id_consultor,
  ]);

  const notifRow = rows[0] || null;
  if (!notifRow) return null;

  try {
    await pushNotificacion({
      notif_id: notifRow.id,
      id_usuario,     // ✅ id_cliente
      id_consultor,   // ✅ id_consultor
      id_proyecto,
      tipo,           // se puede seguir mandando al push como metadata
      titulo,
      mensaje,
    });
  } catch (e) {
    console.warn("[Push] Error enviando FCM (regenciaNotifs):", e?.message || e);
  }

  return notifRow.id;
}

async function crearNotif(args) {
  return insertarNotificacion(args);
}

async function notificarClientePorIdCliente({
  id_cliente,
  id_proyecto,
  titulo,
  mensaje,
  tipo = "REG",
  dedupe_base,
}) {
  if (!id_cliente) return null;

  return insertarNotificacion({
    id_proyecto,
    id_usuario: id_cliente, // ✅ guardar id_cliente
    titulo,
    mensaje,
    tipo,
  });
}

module.exports = {
  insertarNotificacion,
  crearNotif,
  notificarClientePorIdCliente,
};