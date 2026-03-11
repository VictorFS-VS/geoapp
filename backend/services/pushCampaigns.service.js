// services/pushCampaigns.service.js
const pool = require("../db");
const { sendToTokens } = require("./fcm.service");

/**
 * Resuelve user_ids desde targets (según scope) y devuelve lista única.
 */
async function resolveUserIdsForCampaign(campaignId) {
  const c = await pool.query(`SELECT id, scope FROM public.push_campaigns WHERE id=$1`, [campaignId]);
  if (!c.rows.length) throw new Error("Campaña no existe");
  const scope = (c.rows[0].scope || "GLOBAL").toUpperCase();

  if (scope === "GLOBAL") {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM public.users u
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1
      `
    );
    return r.rows.map((x) => x.user_id);
  }

  const targets = await pool.query(
    `SELECT target_type, target_id FROM public.push_campaign_targets WHERE campaign_id=$1`,
    [campaignId]
  );

  if (!targets.rows.length) return [];

  const idsByType = {
    CLIENTE: [],
    CONSULTOR: [],
    USER: [],
    CARTERA_CLIENTE: [],
    CARTERA_CONSULTOR: [],
  };

  for (const row of targets.rows) {
    const tt = (row.target_type || "").toUpperCase();
    if (idsByType[tt]) idsByType[tt].push(Number(row.target_id));
  }

  const userIds = new Set();

  // CLIENTE
  if (idsByType.CLIENTE.length) {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM public.users u
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1 AND u.id_cliente = ANY($1::int[])
      `,
      [idsByType.CLIENTE]
    );
    r.rows.forEach((x) => userIds.add(x.user_id));
  }

  // CONSULTOR
  if (idsByType.CONSULTOR.length) {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM public.users u
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1 AND u.id_consultor = ANY($1::int[])
      `,
      [idsByType.CONSULTOR]
    );
    r.rows.forEach((x) => userIds.add(x.user_id));
  }

  // USERS (USER)
  if (idsByType.USER.length) {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM public.users u
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1 AND u.id = ANY($1::int[])
      `,
      [idsByType.USER]
    );
    r.rows.forEach((x) => userIds.add(x.user_id));
  }

  // CARTERA_CLIENTE (usa ema.cliente_admin_miembro)
  if (idsByType.CARTERA_CLIENTE.length) {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM ema.cliente_admin_miembro cam
      JOIN public.users u ON u.id_cliente = cam.miembro_id
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1 AND cam.admin_id = ANY($1::int[])
      `,
      [idsByType.CARTERA_CLIENTE]
    );
    r.rows.forEach((x) => userIds.add(x.user_id));
  }

  // CARTERA_CONSULTOR (usa ema.consultor_cliente_miembro)
  if (idsByType.CARTERA_CONSULTOR.length) {
    const r = await pool.query(
      `
      SELECT DISTINCT u.id AS user_id
      FROM ema.consultor_cliente_miembro ccm
      JOIN public.users u ON u.id_cliente = ccm.miembro_id
      JOIN public.user_fcm_tokens t ON t.user_id = u.id
      WHERE u.active = 1 AND ccm.consultor_id = ANY($1::int[])
      `,
      [idsByType.CARTERA_CONSULTOR]
    );
    r.rows.forEach((x) => userIds.add(x.user_id));
  }

  return [...userIds];
}

/**
 * Obtiene tokens (únicos) para una lista de users.
 * También devuelve un mapa token->user_id para log.
 */
async function getTokensForUsers(userIds) {
  if (!userIds.length) return { tokens: [], tokenToUser: new Map() };

  const r = await pool.query(
    `
    SELECT user_id, token
    FROM public.user_fcm_tokens
    WHERE user_id = ANY($1::int[])
    ORDER BY last_seen_at DESC
    `,
    [userIds]
  );

  const seen = new Set();
  const tokens = [];
  const tokenToUser = new Map();

  for (const row of r.rows) {
    const t = row.token;
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
    tokenToUser.set(t, row.user_id);
  }

  return { tokens, tokenToUser };
}

/**
 * Inserta deliveries PENDING (para auditoría)
 */
async function createPendingDeliveries(campaignId, tokens, tokenToUser) {
  if (!tokens.length) return;

  const values = [];
  const params = [];
  let p = 1;

  for (const tok of tokens) {
    const uid = tokenToUser.get(tok) || null;
    params.push(`($${p++}, $${p++}, $${p++}, 'PENDING')`);
    values.push(campaignId, uid, tok);
  }

  await pool.query(
    `
    INSERT INTO public.push_campaign_deliveries (campaign_id, user_id, token, status)
    VALUES ${params.join(",")}
    `,
    values
  );
}

/**
 * Marca deliveries por token
 */
async function markDeliveryStatus(campaignId, tokenList, status, errorText = null) {
  if (!tokenList?.length) return;
  await pool.query(
    `
    UPDATE public.push_campaign_deliveries
    SET status=$3, error=$4, sent_at = CASE WHEN $3 IN ('SENT','UNREGISTERED') THEN now() ELSE sent_at END
    WHERE campaign_id=$1 AND token = ANY($2::text[])
    `,
    [campaignId, tokenList, status, errorText]
  );
}

/**
 * Ejecuta envío (batch) y actualiza stats.
 */
async function runSendCampaign(campaignId, { force = false } = {}) {
  // lock simple para evitar doble click simultáneo
  const cur = await pool.query(`SELECT * FROM public.push_campaigns WHERE id=$1`, [campaignId]);
  if (!cur.rows.length) throw new Error("Campaña no existe");

  const camp = cur.rows[0];
  const status = (camp.status || "DRAFT").toUpperCase();

  if (!force && status !== "QUEUED" && status !== "DRAFT") {
    throw new Error(`No se puede enviar en estado ${status}`);
  }

  // set status SENDING
  await pool.query(
    `UPDATE public.push_campaigns SET status='SENDING' WHERE id=$1`,
    [campaignId]
  );

  // 1) resolver users
  const userIds = await resolveUserIdsForCampaign(campaignId);

  // 2) tokens
  const { tokens, tokenToUser } = await getTokensForUsers(userIds);

  // 3) crear deliveries pending (auditoría)
  await createPendingDeliveries(campaignId, tokens, tokenToUser);

  if (!tokens.length) {
    await pool.query(
      `UPDATE public.push_campaigns SET status='SENT', sent_at=now(), stats=jsonb_build_object('sent',0,'note','no_tokens') WHERE id=$1`,
      [campaignId]
    );
    return { sent: 0, successCount: 0, failureCount: 0, badTokens: [] };
  }

  // 4) enviar (usa tu service existente)
  const result = await sendToTokens(tokens, {
    title: camp.title,
    body: camp.body,
    data: camp.data_json || {},
  });

  // 5) actualizar deliveries
  // sendToTokens devuelve badTokens (UNREGISTERED/INVALID) + success/fail counts
  const badTokens = result.badTokens || [];

  // marcar UNREGISTERED
  if (badTokens.length) {
    await markDeliveryStatus(campaignId, badTokens, "UNREGISTERED", "UNREGISTERED");
    // borrar tokens inválidos del sistema (igual que tu test)
    await pool.query(`DELETE FROM public.user_fcm_tokens WHERE token = ANY($1::text[])`, [badTokens]);
  }

  // marcar SENT para el resto (aprox)
  const goodTokens = tokens.filter((t) => !badTokens.includes(t));
  if (goodTokens.length) {
    await markDeliveryStatus(campaignId, goodTokens, "SENT", null);
  }

  // 6) stats + status final
  const stats = {
    scope: camp.scope,
    users_resolved: userIds.length,
    tokens: tokens.length,
    successCount: result.successCount ?? null,
    failureCount: result.failureCount ?? null,
    badTokens: badTokens.length,
  };

  await pool.query(
    `UPDATE public.push_campaigns SET status='SENT', sent_at=now(), stats=$2::jsonb WHERE id=$1`,
    [campaignId, JSON.stringify(stats)]
  );

  return { ...result, stats };
}

module.exports = {
  runSendCampaign,
};
