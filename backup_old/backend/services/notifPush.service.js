// services/notifPush.service.js
const pool = require("../db");
const { sendToTokens } = require("./fcm.service");

/**
 * Obtiene tokens únicos para una lista de userIds
 */
async function getTokensForUsers(userIds) {
  if (!userIds?.length) return [];

  const r = await pool.query(
    `
    SELECT DISTINCT token
    FROM public.user_fcm_tokens
    WHERE user_id = ANY($1::int[])
    `,
    [userIds]
  );

  return r.rows.map((x) => x.token).filter(Boolean);
}

/**
 * Resuelve userIds a partir de:
 * - id_usuario (directo)
 * - id_consultor (todos los users activos ligados a ese consultor)
 */
async function resolveUserIds({ id_usuario = null, id_consultor = null }) {
  const ids = new Set();

  if (id_usuario) ids.add(Number(id_usuario));

  if (id_consultor) {
    const r = await pool.query(
      `
      SELECT id
      FROM public.users
      WHERE active=1 AND id_consultor=$1
      `,
      [id_consultor]
    );
    r.rows.forEach((u) => ids.add(Number(u.id)));
  }

  return [...ids];
}

/**
 * Limpieza de tokens inválidos (si Firebase devuelve unregistered/invalid)
 */
async function cleanupBadTokens(badTokens) {
  if (!badTokens?.length) return;
  await pool.query(`DELETE FROM public.user_fcm_tokens WHERE token = ANY($1::text[])`, [badTokens]);
}

/**
 * Envía push a los targets de una notificación (user/consultor)
 * - data-only (tu fcm.service ya lo hace)
 */
async function pushNotificacion({
  notif_id = null,
  id_usuario = null,
  id_consultor = null,
  id_proyecto = null,
  tipo = "",
  titulo = "GeoApp",
  mensaje = "",
}) {
  // 1) resolver users
  const userIds = await resolveUserIds({ id_usuario, id_consultor });
  if (!userIds.length) return { ok: true, sent: 0 };

  // 2) tokens
  const tokens = await getTokensForUsers(userIds);
  if (!tokens.length) return { ok: true, sent: 0, note: "no_tokens" };

  // 3) enviar
  const result = await sendToTokens(tokens, {
    title: titulo,
    body: mensaje,
    data: {
      notif_id: notif_id == null ? "" : String(notif_id),
      id_proyecto: id_proyecto == null ? "" : String(id_proyecto),
      tipo: tipo == null ? "" : String(tipo),
    },
  });

  // 4) limpiar tokens inválidos
  if (result?.badTokens?.length) {
    await cleanupBadTokens(result.badTokens);
  }

  return result;
}

module.exports = { pushNotificacion };
