"use strict";

const jwt = require("jsonwebtoken");
const pool = require("../db");
const { loadUserPermsAndScope } = require("../utils/rbacToken");

/* ---------- Rutas públicas SIN auth ---------- */
const PUBLIC_NOAUTH = [
  { method: "GET", rx: /^\/api\/usuarios\/\d+\/avatar(?:\?.*)?$/i },
  { method: "GET", rx: /^\/api\/geo\/ip(?:\?.*)?$/i },
  { method: "GET", rx: /^\/api\/geo-public\/ip(?:\?.*)?$/i },
];

function isPublicNoAuth(req) {
  const url = req.originalUrl || req.url || "";
  return PUBLIC_NOAUTH.some((r) => r.method === req.method && r.rx.test(url));
}

function extractToken(authHeader) {
  if (!authHeader) return null;
  const parts = authHeader.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : null;
}

const verifyToken = async (req, res, next) => {
  if (isPublicNoAuth(req)) return next();

  const raw = req.headers["authorization"];
  if (!raw) return res.status(401).json({ error: "Token no proporcionado" });

  const token = extractToken(raw);
  if (!token) return res.status(401).json({ error: "Token faltante" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = Number(decoded.id);
    if (!userId) return res.status(401).json({ error: "Token inválido" });

    req.user = {
      id: userId,
      username: decoded.username,
      email: decoded.email,
      id_cliente: decoded.id_cliente ? Number(decoded.id_cliente) : null,
      id_consultor: decoded.id_consultor ? Number(decoded.id_consultor) : null,
    };

    const { rows: roleRows } = await pool.query(
      `SELECT group_id
         FROM public.users_groups
        WHERE user_id = $1
        ORDER BY group_id ASC`,
      [userId]
    );

    const roleIds = (roleRows || [])
      .map((r) => Number(r.group_id))
      .filter((n) => Number.isFinite(n) && n > 0);

    req.user.role_ids = roleIds;

    const primaryFromToken = Number(decoded.group_id || decoded.tipo_usuario || 0) || null;
    req.user.group_id = primaryFromToken || (roleIds.length ? roleIds[0] : null);
    req.user.tipo_usuario = req.user.group_id;

    const { perms, permsScope } = await loadUserPermsAndScope(userId);

    req.user.perms = Array.isArray(perms) ? perms : [];
    req.user.permsScope = permsScope || {};

    // opcional: objetos completos para debug o uso futuro
    req.user.permObjects = req.user.perms.map((code) => ({
      code,
      scope: req.user.permsScope?.[code] || null,
    }));

    // debug temporal
    console.log("AUTH DEBUG", {
      user: req.user?.username,
      id: req.user?.id,
      group_id: req.user?.group_id,
      role_ids: req.user?.role_ids,
      perms_len: req.user?.perms?.length || 0,
      proponentes_read_scope: req.user?.permsScope?.["proponentes.read"] || null,
    });

    return next();
  } catch (err) {
    console.error("verifyToken error:", err?.message || err);
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

module.exports = { verifyToken };