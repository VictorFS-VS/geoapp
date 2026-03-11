// controllers/fcm.controller.js
const pool = require("../db");
const { sendToTokens } = require("../services/fcm.service");

function getUserId(req) {
  return (
    req.user?.id ||
    req.user?.user_id ||
    req.user?.id_usuario ||
    req.userId ||
    null
  );
}

// POST /api/notificaciones/fcm/register
async function registerFcmToken(req, res) {
  try {
    const userId = getUserId(req);
    const { token, platform, device_id, device_name } = req.body || {};

    if (!userId) return res.status(401).json({ error: "No autenticado" });
    if (!token) return res.status(400).json({ error: "token requerido" });

    const plat = platform || "android";
    const did = device_id || null;
    const dname = device_name || null;

    // (OPCIONAL) Si querés que el usuario tenga 1 solo token activo:
    // await pool.query(`DELETE FROM public.user_fcm_tokens WHERE user_id=$1 AND token <> $2`, [userId, token]);

    const q = await pool.query(
      `
      INSERT INTO public.user_fcm_tokens
        (user_id, token, platform, device_id, device_name, last_seen_at)
      VALUES
        ($1, $2, $3, $4, $5, now())
      ON CONFLICT (token)
      DO UPDATE SET
        user_id      = EXCLUDED.user_id,
        platform     = EXCLUDED.platform,
        device_id    = EXCLUDED.device_id,
        device_name  = EXCLUDED.device_name,
        last_seen_at = now()
      RETURNING id, user_id, token, last_seen_at
      `,
      [userId, token, plat, did, dname]
    );

    const row = q.rows?.[0] || null;
    // Log útil para debug:
    console.log("✅ FCM register OK:", {
      userId,
      token: token?.slice(0, 18) + "...",
      id: row?.id,
      last_seen_at: row?.last_seen_at,
    });

    return res.json({ ok: true, row });
  } catch (e) {
    // si llega a fallar por UNIQUE(token), acá te daría 23505
    console.error("registerFcmToken error:", e);
    return res.status(500).json({ error: "Error registrando token FCM" });
  }
}

// POST /api/notificaciones/fcm/test
async function testPushToMe(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { title = "GeoApp ✅", body = "Push de prueba desde backend" } = req.body || {};

    const r = await pool.query(
      `SELECT token FROM public.user_fcm_tokens WHERE user_id=$1 ORDER BY last_seen_at DESC`,
      [userId]
    );

    const tokens = r.rows.map((x) => x.token).filter(Boolean);

    const result = await sendToTokens(tokens, {
      title,
      body,
      data: { tipo: "test", ts: Date.now().toString() },
    });

    // borrar tokens inválidos
    if (result.badTokens?.length) {
      await pool.query(
        `DELETE FROM public.user_fcm_tokens WHERE token = ANY($1::text[])`,
        [result.badTokens]
      );
    }

    return res.json({ ok: true, tokens: tokens.length, result });
  } catch (e) {
    console.error("testPushToMe error:", e);
    return res.status(500).json({ error: "Error enviando push test" });
  }
}

module.exports = { registerFcmToken, testPushToMe };
