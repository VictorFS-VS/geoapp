// services/regenciaNotifs.js
const pool = require("../db");
const { pushNotificacion } = require("./notifPush.service");

async function insertarNotificacion({
  id_proyecto,
  id_usuario = null,
  id_consultor = null,
  titulo,
  mensaje,
  creado_por = "SYSTEM_REG",
  tipo = "REG",
  dedupe_key = null,
}) {
  const q = `
    INSERT INTO public.notificaciones
      (id_usuario, titulo, mensaje, leido_usuario, creado_en, es_global,
       id_proyecto, creado_por, id_consultor, leido_consultor, tipo, dedupe_key)
    VALUES
      ($1, $2, $3, false, now(), false,
       $4, $5, $6, false, $7, $8)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id;
  `;

  const { rows } = await pool.query(q, [
    id_usuario,
    titulo,
    mensaje,
    id_proyecto,
    creado_por,
    id_consultor,
    tipo,
    dedupe_key,
  ]);

  const notifId = rows[0]?.id || null;

  // ✅ Si insertó (no fue dedupe), mandá push
  if (notifId) {
    try {
      await pushNotificacion({
        notif_id: notifId,
        id_usuario,
        id_consultor,
        id_proyecto,
        tipo,
        titulo,
        mensaje,
      });
    } catch (e) {
      console.warn("[Push] Error enviando FCM (regenciaNotifs):", e?.message || e);
    }
  }

  return notifId;
}

/**
 * ✅ Alias para no romper jobs viejos:
 */
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
  const { rows: usuarios } = await pool.query(
    `SELECT id FROM public.users WHERE active=1 AND id_cliente=$1`,
    [id_cliente]
  );

  for (const u of usuarios) {
    await insertarNotificacion({
      id_proyecto,
      id_usuario: u.id,
      titulo,
      mensaje,
      tipo,
      dedupe_key: `${dedupe_base}:user=${u.id}`,
    });
  }
}

module.exports = {
  insertarNotificacion,
  crearNotif,
  notificarClientePorIdCliente,
};
