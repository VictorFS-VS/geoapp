// controllers/pushCampaigns.controller.js
"use strict";

const pool = require("../db");
const { runSendCampaign } = require("../services/pushCampaigns.service");

/* =========================
   Helpers auth/perms
========================= */
function getUserId(req) {
  return (
    req.user?.id ||
    req.user?.user_id ||
    req.user?.id_usuario ||
    req.userId ||
    null
  );
}

function hasPerm(req, code) {
  const perms = req.user?.perms || [];
  return Array.isArray(perms) && perms.includes(code);
}

function deny(res) {
  return res.status(403).json({ error: "Acceso denegado" });
}

/* =========================
   Scopes
========================= */
const VALID_SCOPES = [
  "GLOBAL",
  "CLIENTE",
  "CONSULTOR",
  "USERS",
  "CARTERA_CLIENTE",
  "CARTERA_CONSULTOR",
];

function normScope(scope) {
  const sc = (scope || "GLOBAL").toString().toUpperCase();
  return VALID_SCOPES.includes(sc) ? sc : "GLOBAL";
}

/* =========================
   POST /api/push-campaigns
========================= */
async function createCampaign(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.create")) return deny(res);

    const userId = getUserId(req);
    const { title, body, data_json, scope, send_at } = req.body || {};

    if (!userId) return res.status(401).json({ error: "No autenticado" });
    if (!title || !body) {
      return res.status(400).json({ error: "title y body requeridos" });
    }

    const scopeFinal = normScope(scope);

    const r = await pool.query(
      `
      INSERT INTO public.push_campaigns (title, body, data_json, scope, created_by, status, send_at)
      VALUES ($1, $2, COALESCE($3::jsonb,'{}'::jsonb), $4, $5, 'DRAFT', $6)
      RETURNING *
      `,
      [
        title,
        body,
        JSON.stringify(data_json || {}),
        scopeFinal,
        userId,
        send_at || null,
      ]
    );

    return res.json({ ok: true, campaign: r.rows[0] });
  } catch (e) {
    console.error("createCampaign:", e);
    return res.status(500).json({ error: "Error creando campaña" });
  }
}

/* =========================
   GET /api/push-campaigns
========================= */
async function listCampaigns(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.read")) return deny(res);

    const r = await pool.query(
      `SELECT * FROM public.push_campaigns ORDER BY created_at DESC LIMIT 200`
    );
    return res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error("listCampaigns:", e);
    return res.status(500).json({ error: "Error listando campañas" });
  }
}

/* =========================
   GET /api/push-campaigns/:id
========================= */
async function getCampaign(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.read")) return deny(res);

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const c = await pool.query(
      `SELECT * FROM public.push_campaigns WHERE id=$1`,
      [id]
    );
    if (!c.rows.length) return res.status(404).json({ error: "No existe campaña" });

    // Si todavía no creaste estas tablas, comentá estos 2 bloques.
    const targets = await pool.query(
      `SELECT * FROM public.push_campaign_targets WHERE campaign_id=$1 ORDER BY id ASC`,
      [id]
    );

    const deliveriesStats = await pool.query(
      `SELECT status, count(*)::int as qty
       FROM public.push_campaign_deliveries
       WHERE campaign_id=$1
       GROUP BY status
       ORDER BY status`,
      [id]
    );

    return res.json({
      ok: true,
      campaign: c.rows[0],
      targets: targets.rows,
      deliveries_stats: deliveriesStats.rows,
    });
  } catch (e) {
    console.error("getCampaign:", e);
    return res.status(500).json({ error: "Error obteniendo campaña" });
  }
}

/* =========================
   PUT /api/push-campaigns/:id
========================= */
async function updateCampaign(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.update")) return deny(res);

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const { title, body, data_json, scope, send_at, status } = req.body || {};
    const scopeFinal = scope ? normScope(scope) : null;

    const r = await pool.query(
      `
      UPDATE public.push_campaigns
      SET
        title     = COALESCE($2, title),
        body      = COALESCE($3, body),
        data_json = COALESCE($4::jsonb, data_json),
        scope     = COALESCE($5, scope),
        send_at   = COALESCE($6, send_at),
        status    = COALESCE($7, status)
      WHERE id=$1
      RETURNING *
      `,
      [
        id,
        title ?? null,
        body ?? null,
        data_json ? JSON.stringify(data_json) : null,
        scopeFinal,
        send_at ?? null,
        status ?? null,
      ]
    );

    if (!r.rows.length) return res.status(404).json({ error: "No existe campaña" });
    return res.json({ ok: true, campaign: r.rows[0] });
  } catch (e) {
    console.error("updateCampaign:", e);
    return res.status(500).json({ error: "Error actualizando campaña" });
  }
}

/* =========================
   DELETE /api/push-campaigns/:id
========================= */
async function deleteCampaign(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.delete")) return deny(res);

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const r = await pool.query(
      `DELETE FROM public.push_campaigns WHERE id=$1 RETURNING id`,
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "No existe campaña" });

    return res.json({ ok: true, deleted: r.rows[0].id });
  } catch (e) {
    console.error("deleteCampaign:", e);
    return res.status(500).json({ error: "Error eliminando campaña" });
  }
}

/* =========================
   POST /api/push-campaigns/:id/targets
========================= */
async function upsertTargets(req, res) {
  try {
    // ✅ editar targets = update (o create). Elegí uno. Yo uso update.
    if (!hasPerm(req, "push_campaigns.update")) return deny(res);

    const campaignId = Number(req.params.id);
    if (!campaignId) return res.status(400).json({ error: "id inválido" });

    const sc = normScope(req.body?.scope);

    const c = await pool.query(
      `SELECT id, status FROM public.push_campaigns WHERE id=$1`,
      [campaignId]
    );
    if (!c.rows.length) return res.status(404).json({ error: "No existe campaña" });

    if (c.rows[0].status !== "DRAFT") {
      return res.status(400).json({ error: "Solo se pueden editar targets en estado DRAFT" });
    }

    await pool.query(
      `DELETE FROM public.push_campaign_targets WHERE campaign_id=$1`,
      [campaignId]
    );

    if (sc === "GLOBAL") {
      await pool.query(
        `UPDATE public.push_campaigns SET scope='GLOBAL' WHERE id=$1`,
        [campaignId]
      );
      return res.json({ ok: true, scope: "GLOBAL", targets: [] });
    }

    const inserts = [];
    const pushMany = (targetType, ids) => {
      (ids || []).forEach((x) => {
        const id = Number(x);
        if (id) inserts.push({ targetType, targetId: id });
      });
    };

    if (sc === "CLIENTE") pushMany("CLIENTE", req.body.cliente_ids);
    if (sc === "CONSULTOR") pushMany("CONSULTOR", req.body.consultor_ids);
    if (sc === "USERS") pushMany("USER", req.body.user_ids);
    if (sc === "CARTERA_CLIENTE") pushMany("CARTERA_CLIENTE", req.body.admin_cliente_ids);
    if (sc === "CARTERA_CONSULTOR") pushMany("CARTERA_CONSULTOR", req.body.consultor_ids);

    if (inserts.length === 0) {
      return res.status(400).json({ error: "No hay destinatarios (ids) para este scope" });
    }

    const values = [];
    const placeholders = [];
    let p = 1;

    for (const it of inserts) {
      placeholders.push(`($${p++}, $${p++}, $${p++})`);
      values.push(campaignId, it.targetType, it.targetId);
    }

    await pool.query(
      `INSERT INTO public.push_campaign_targets (campaign_id, target_type, target_id)
       VALUES ${placeholders.join(",")}`,
      values
    );

    await pool.query(
      `UPDATE public.push_campaigns SET scope=$1 WHERE id=$2`,
      [sc, campaignId]
    );

    const t = await pool.query(
      `SELECT * FROM public.push_campaign_targets WHERE campaign_id=$1 ORDER BY id ASC`,
      [campaignId]
    );

    return res.json({ ok: true, scope: sc, targets: t.rows });
  } catch (e) {
    console.error("upsertTargets:", e);
    return res.status(500).json({ error: "Error guardando targets" });
  }
}

/* =========================
   POST /api/push-campaigns/:id/send
========================= */
async function sendCampaignNow(req, res) {
  try {
    if (!hasPerm(req, "push_campaigns.send")) return deny(res);

    const campaignId = Number(req.params.id);
    if (!campaignId) return res.status(400).json({ error: "id inválido" });

    const result = await runSendCampaign(campaignId, { force: true });
    return res.json({ ok: true, campaign_id: campaignId, result });
  } catch (e) {
    console.error("sendCampaignNow:", e);
    return res.status(500).json({ error: e?.message || "Error enviando campaña" });
  }
}

// Alias
async function sendNow(req, res) {
  return sendCampaignNow(req, res);
}

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaign,
  updateCampaign,
  deleteCampaign,
  upsertTargets,
  sendCampaignNow,
  sendNow,
};