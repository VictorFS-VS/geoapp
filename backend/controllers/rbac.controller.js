// backend/controllers/rbac.controller.js
"use strict";

const pool = require("../db");

/* =========================
   Helpers
   ========================= */
const asInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const allowedScopes = ["own", "project", "all"]; // ajustá si tu enum es distinto

function ok(res, data) {
  return res.json({ ok: true, data });
}

function bad(res, msg, extra = {}) {
  return res.status(400).json({ ok: false, error: msg, ...extra });
}

/**
 * ✅ SYNC legacy: users.tipo_usuario = rol principal
 * Regla:
 * - si viene primaryRoleId y el user lo tiene => usar ese
 * - si no => menor id para que sea estable
 */
async function syncUserPrimaryRoleId(userId, primaryRoleId = null, client = pool) {
  const uid = asInt(userId);
  if (!uid) throw new Error("userId inválido");

  const { rows } = await client.query(
    `SELECT group_id
       FROM public.users_groups
      WHERE user_id = $1
      ORDER BY group_id ASC`,
    [uid]
  );

  const roleIds = rows.map((r) => asInt(r.group_id)).filter(Boolean);

  let picked = null;
  const pr = asInt(primaryRoleId);
  if (pr && roleIds.includes(pr)) picked = pr;
  if (!picked && roleIds.length) picked = roleIds[0];

  await client.query(
    `UPDATE public.users
        SET tipo_usuario = $2,
            fecha_actualizacion = now()
      WHERE id = $1`,
    [uid, picked]
  );

  return { primary_role_id: picked, role_ids: roleIds };
}

/**
 * Para UI: intentar inferir group del permiso desde su code:
 * "proyectos.read" => group "proyectos"
 * "usuarios.edit"  => group "usuarios"
 */
function inferPermGroup(code = "") {
  const s = String(code || "").trim();
  const idx = s.indexOf(".");
  if (idx > 0) return s.slice(0, idx);
  return "General";
}

function inferPermLabel(code = "", description = "") {
  // si hay description, usarla
  if (description && String(description).trim()) return String(description).trim();
  // fallback simple
  return String(code || "").trim();
}

/* =========================
   A) Roles (groups)
   ========================= */

// GET /api/rbac/roles?page=1&limit=10&search=...
async function listRoles(req, res) {
  const page = Math.max(1, asInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, asInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim();

  try {
    let where = "";
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE name ILIKE $1 OR description ILIKE $1`;
    }

    const totalQ = `SELECT COUNT(*)::int AS total FROM public.groups ${where}`;
    const totalR = await pool.query(totalQ, params);
    const total = totalR.rows?.[0]?.total || 0;

    const q = `
      SELECT id, name, description, bgcolor
        FROM public.groups
        ${where}
       ORDER BY id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const r = await pool.query(q, [...params, limit, offset]);

    // ✅ si el front legacy espera {data,page,totalPages} podés devolverlo así,
    // pero para no romper tus pantallas actuales dejamos ok({data,...})
    return ok(res, {
      data: r.rows,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      totalItems: total,
    });
  } catch (e) {
    console.error("listRoles:", e);
    return res.status(500).json({ ok: false, error: "Error listRoles" });
  }
}

// GET /api/rbac/roles/:id  (rol + permisos)
async function getRole(req, res) {
  const id = asInt(req.params.id);
  if (!id) return bad(res, "ID inválido");

  try {
    const r1 = await pool.query(
      `SELECT id, name, description, bgcolor
         FROM public.groups
        WHERE id = $1`,
      [id]
    );
    if (!r1.rowCount) return res.status(404).json({ ok: false, error: "Rol no encontrado" });

    const r2 = await pool.query(
      `
      SELECT rp.permission_id,
             p.code,
             p.description,
             rp.scope
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.code ASC
      `,
      [id]
    );

    const permission_items = r2.rows.map((x) => ({
      permission_id: x.permission_id,
      code: x.code,
      description: x.description,
      scope: x.scope,
      key: x.code, // para UI
      label: inferPermLabel(x.code, x.description),
      group: inferPermGroup(x.code),
    }));

    const permission_codes = permission_items.map((x) => x.code);

    return ok(res, {
      ...r1.rows[0],
      permission_items,
      permission_codes,
    });
  } catch (e) {
    console.error("getRole:", e);
    return res.status(500).json({ ok: false, error: "Error getRole" });
  }
}

// POST /api/rbac/roles
async function createRole(req, res) {
  const { name, description, bgcolor, permission_codes, permission_items } = req.body || {};
  if (!name || String(name).trim().length < 2) return bad(res, "Nombre inválido");
  if (!description || String(description).trim().length < 2) return bad(res, "Descripción inválida");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const q = `
      INSERT INTO public.groups(name, description, bgcolor)
      VALUES ($1, $2, COALESCE($3, '#607D8B'))
      RETURNING id, name, description, bgcolor
    `;
    const r = await client.query(q, [String(name).trim(), String(description).trim(), bgcolor || null]);
    const role = r.rows[0];

    // ✅ si vienen permisos, setearlos (reemplazo total, como tu setRolePerms)
    const roleId = role.id;

    // Normalizar a "items" [{permission_id|code, scope}]
    const items = [];
    if (Array.isArray(permission_items)) {
      for (const it of permission_items) items.push(it);
    } else if (Array.isArray(permission_codes)) {
      for (const c of permission_codes) items.push({ code: c, scope: "all" });
    }

    if (items.length) {
      await _setRolePermsInternal(client, roleId, items);
    }

    await client.query("COMMIT");
    return ok(res, role);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("createRole:", e);
    return res.status(500).json({ ok: false, error: "Error createRole" });
  } finally {
    client.release();
  }
}

// PUT /api/rbac/roles/:id
async function updateRole(req, res) {
  const id = asInt(req.params.id);
  if (!id) return bad(res, "ID inválido");

  const { name, description, bgcolor, permission_codes, permission_items } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const q = `
      UPDATE public.groups
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             bgcolor = COALESCE($4, bgcolor)
       WHERE id = $1
       RETURNING id, name, description, bgcolor
    `;
    const r = await client.query(q, [
      id,
      name !== undefined ? String(name).trim() : null,
      description !== undefined ? String(description).trim() : null,
      bgcolor !== undefined ? bgcolor : null,
    ]);

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Rol no encontrado" });
    }

    // ✅ si vienen permisos => set completo
    const items = [];
    if (Array.isArray(permission_items)) {
      for (const it of permission_items) items.push(it);
    } else if (Array.isArray(permission_codes)) {
      for (const c of permission_codes) items.push({ code: c, scope: "all" });
    }

    if (items.length) {
      await _setRolePermsInternal(client, id, items);
    }

    await client.query("COMMIT");
    return ok(res, r.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("updateRole:", e);
    return res.status(500).json({ ok: false, error: "Error updateRole" });
  } finally {
    client.release();
  }
}

// DELETE /api/rbac/roles/:id
async function deleteRole(req, res) {
  const id = asInt(req.params.id);
  if (!id) return bad(res, "ID inválido");

  // ⚠️ recomendable evitar borrar rol 1 (admin)
  if (id === 1) return bad(res, "No se puede eliminar el rol ADMIN");

  try {
    const q = `DELETE FROM public.groups WHERE id = $1`;
    const r = await pool.query(q, [id]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Rol no encontrado" });
    return ok(res, { deleted: true });
  } catch (e) {
    console.error("deleteRole:", e);
    return res.status(500).json({ ok: false, error: "Error deleteRole" });
  }
}

/* =========================
   B) Permisos (permissions)
   ========================= */

// GET /api/rbac/perms
async function listPerms(_req, res) {
  try {
    const q = `SELECT id, code, description FROM public.permissions ORDER BY code ASC`;
    const r = await pool.query(q);

    // ✅ extra para UI (no rompe compat)
    const mapped = r.rows.map((p) => ({
      ...p,
      key: p.code,
      label: inferPermLabel(p.code, p.description),
      group: inferPermGroup(p.code),
    }));

    return ok(res, mapped);
  } catch (e) {
    console.error("listPerms:", e);
    return res.status(500).json({ ok: false, error: "Error listPerms" });
  }
}

// POST /api/rbac/perms
async function createPerm(req, res) {
  const { code, description } = req.body || {};
  if (!code || String(code).trim().length < 3) return bad(res, "Code inválido");

  try {
    const q = `
      INSERT INTO public.permissions(code, description)
      VALUES ($1, $2)
      RETURNING id, code, description
    `;
    const r = await pool.query(q, [String(code).trim(), description ?? null]);
    return ok(res, r.rows[0]);
  } catch (e) {
    console.error("createPerm:", e);
    return res.status(500).json({ ok: false, error: "Error createPerm" });
  }
}

// PUT /api/rbac/perms/:id
async function updatePerm(req, res) {
  const id = asInt(req.params.id);
  if (!id) return bad(res, "ID inválido");

  const { code, description } = req.body || {};

  try {
    const q = `
      UPDATE public.permissions
         SET code = COALESCE($2, code),
             description = COALESCE($3, description)
       WHERE id = $1
       RETURNING id, code, description
    `;
    const r = await pool.query(q, [
      id,
      code !== undefined ? String(code).trim() : null,
      description !== undefined ? description : null,
    ]);

    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Permiso no encontrado" });
    return ok(res, r.rows[0]);
  } catch (e) {
    console.error("updatePerm:", e);
    return res.status(500).json({ ok: false, error: "Error updatePerm" });
  }
}

// DELETE /api/rbac/perms/:id
async function deletePerm(req, res) {
  const id = asInt(req.params.id);
  if (!id) return bad(res, "ID inválido");

  try {
    const q = `DELETE FROM public.permissions WHERE id = $1`;
    const r = await pool.query(q, [id]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: "Permiso no encontrado" });
    return ok(res, { deleted: true });
  } catch (e) {
    console.error("deletePerm:", e);
    return res.status(500).json({ ok: false, error: "Error deletePerm" });
  }
}

/* =========================
   C) Permisos por rol (role_permissions)
   ========================= */

// GET /api/rbac/roles/:id/perms
async function getRolePerms(req, res) {
  const roleId = asInt(req.params.id);
  if (!roleId) return bad(res, "roleId inválido");

  try {
    const q = `
      SELECT rp.id, rp.role_id, rp.permission_id, p.code, p.description, rp.scope
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
       ORDER BY p.code ASC
    `;
    const r = await pool.query(q, [roleId]);
    return ok(res, r.rows);
  } catch (e) {
    console.error("getRolePerms:", e);
    return res.status(500).json({ ok: false, error: "Error getRolePerms" });
  }
}

/**
 * Interno: set completo de permisos del rol
 * items puede ser:
 * - [{ permission_id, scope }]
 * - [{ code, scope }]
 */
async function _setRolePermsInternal(client, roleId, items) {
  const normalized = [];

  for (const it of items) {
    const scope = String(it?.scope || "all");
    if (!allowedScopes.includes(scope)) {
      throw new Error(`scope inválido: ${scope}`);
    }

    const pid = asInt(it?.permission_id);
    const code = it?.code ? String(it.code).trim() : null;

    if (!pid && !code) throw new Error("permission_id o code requerido");

    normalized.push({ pid, code, scope });
  }

  // borrar actuales
  await client.query(`DELETE FROM public.role_permissions WHERE role_id = $1`, [roleId]);

  for (const n of normalized) {
    let permissionId = n.pid;

    if (!permissionId && n.code) {
      const r = await client.query(`SELECT id FROM public.permissions WHERE code = $1 LIMIT 1`, [n.code]);
      permissionId = r.rows?.[0]?.id ? asInt(r.rows[0].id) : null;
      if (!permissionId) throw new Error(`Permiso code no existe: ${n.code}`);
    }

    await client.query(
      `INSERT INTO public.role_permissions(role_id, permission_id, scope)
       VALUES ($1, $2, $3::perm_scope)`,
      [roleId, permissionId, n.scope]
    );
  }

  return { role_id: roleId, count: normalized.length };
}

/**
 * PUT /api/rbac/roles/:id/perms
 * body:
 *  - { items: [{ permission_id, scope }, ...] }
 *  - o { items: [{ code, scope }, ...] }
 */
async function setRolePerms(req, res) {
  const roleId = asInt(req.params.id);
  if (!roleId) return bad(res, "roleId inválido");

  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return bad(res, "items requerido (array)");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await _setRolePermsInternal(client, roleId, items);
    await client.query("COMMIT");
    return ok(res, out);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("setRolePerms error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Error setRolePerms" });
  } finally {
    client.release();
  }
}

/* =========================
   D) Roles por usuario (users_groups)
   ========================= */

// GET /api/rbac/users/:id/roles
async function getUserRoles(req, res) {
  const userId = asInt(req.params.id);
  if (!userId) return bad(res, "userId inválido");

  try {
    const q = `
      SELECT ug.group_id AS role_id, g.name, g.description, g.bgcolor
        FROM public.users_groups ug
        JOIN public.groups g ON g.id = ug.group_id
       WHERE ug.user_id = $1
       ORDER BY g.id ASC
    `;
    const r = await pool.query(q, [userId]);
    return ok(res, r.rows);
  } catch (e) {
    console.error("getUserRoles:", e);
    return res.status(500).json({ ok: false, error: "Error getUserRoles" });
  }
}

/**
 * PUT /api/rbac/users/:id/roles
 * body: { role_ids: [1,8,9], primary_role_id?: 1 }
 * - Reemplaza set completo del usuario
 * - ✅ sync legacy users.tipo_usuario al rol principal
 */
async function setUserRoles(req, res) {
  const userId = asInt(req.params.id);
  if (!userId) return bad(res, "userId inválido");

  const roleIds = Array.isArray(req.body?.role_ids) ? req.body.role_ids : null;
  if (!roleIds) return bad(res, "role_ids requerido (array)");

  const normalized = [...new Set(roleIds.map(asInt).filter(Boolean))];
  if (!normalized.length) return bad(res, "role_ids vacío");

  const primaryRoleId = asInt(req.body?.primary_role_id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM public.users_groups WHERE user_id = $1`, [userId]);

    for (const rid of normalized) {
      await client.query(
        `INSERT INTO public.users_groups(user_id, group_id) VALUES ($1, $2)
         ON CONFLICT (user_id, group_id) DO NOTHING`,
        [userId, rid]
      );
    }

    // ✅ sync legacy (tipo_usuario)
    const sync = await syncUserPrimaryRoleId(userId, primaryRoleId, client);

    await client.query("COMMIT");
    return ok(res, { user_id: userId, roles: normalized, ...sync });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("setUserRoles error:", e);
    return res.status(500).json({ ok: false, error: "Error setUserRoles" });
  } finally {
    client.release();
  }
}

module.exports = {
  // roles
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,

  // perms
  listPerms,
  createPerm,
  updatePerm,
  deletePerm,

  // role perms
  getRolePerms,
  setRolePerms,

  // user roles
  getUserRoles,
  setUserRoles,
};
