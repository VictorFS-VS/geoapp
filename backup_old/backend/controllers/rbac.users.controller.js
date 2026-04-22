// backend/controllers/rbac.users.controller.js
"use strict";

const pool = require("../db");
const { syncUserPrimaryRoleId } = require("../utils/rbacSync");

const setUserRoles = async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: "id inválido" });

  const role_ids = Array.isArray(req.body.role_ids) ? req.body.role_ids : [];
  const primary_role_id = req.body.primary_role_id ?? null;

  // normalizar ids
  const roles = role_ids.map(n => Number(n)).filter(Number.isFinite);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ✅ reemplaza roles del usuario (set)
    await client.query("DELETE FROM public.users_groups WHERE user_id = $1", [userId]);

    if (roles.length) {
      const values = roles.map((_, i) => `($1, $${i + 2})`).join(", ");
      await client.query(
        `INSERT INTO public.users_groups (user_id, group_id)
         VALUES ${values}
         ON CONFLICT (user_id, group_id) DO NOTHING`,
        [userId, ...roles]
      );
    }

    // ✅ sync legacy
    const sync = await syncUserPrimaryRoleId(userId, primary_role_id, client);

    await client.query("COMMIT");
    return res.json({ success: true, ...sync });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("setUserRoles:", e);
    return res.status(500).json({ error: "Error al asignar roles" });
  } finally {
    client.release();
  }
};

module.exports = { setUserRoles };
