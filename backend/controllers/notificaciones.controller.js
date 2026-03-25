// controllers/notificaciones.controller.js
"use strict";

const pool = require("../db");
const { sendToTokens } = require("../services/fcm.service");

/**
 * ✅ Helpers (FCM)
 * - En tu DB: notificaciones.id_usuario = users.id_cliente (NO users.id)
 * - notificaciones.id_consultor = users.id_consultor (NO users.id)
 * - user_fcm_tokens.user_id -> public.users(id)
 */

/* =========================
   Helpers permisos
========================= */
function hasPerm(user, code) {
  const perms = user?.perms || [];
  return Array.isArray(perms) && perms.includes(code);
}

function isAdminGlobalByPerm(user) {
  return (
    hasPerm(user, "admin.all") ||
    hasPerm(user, "system.admin") ||
    hasPerm(user, "rbac.admin") ||
    hasPerm(user, "roles.admin") ||
    hasPerm(user, "permissions.admin") ||
    hasPerm(user, "users.admin") ||
    hasPerm(user, "notificaciones.read.admin")
  );
}

/* =========================
   FCM helpers
========================= */
async function getUserIdsByIdCliente(client, id_cliente) {
  if (!id_cliente) return [];
  const r = await client.query(
    `SELECT id FROM public.users WHERE active = 1 AND id_cliente = $1`,
    [id_cliente]
  );
  return r.rows.map((x) => x.id).filter(Boolean);
}

async function getUserIdsByIdConsultor(client, id_consultor) {
  if (!id_consultor) return [];
  const r = await client.query(
    `SELECT id FROM public.users WHERE active = 1 AND id_consultor = $1`,
    [id_consultor]
  );
  return r.rows.map((x) => x.id).filter(Boolean);
}

async function getAllActiveUserIdsWithTokens(client) {
  const r = await client.query(`
    SELECT DISTINCT u.id
    FROM public.users u
    JOIN public.user_fcm_tokens t ON t.user_id = u.id
    WHERE u.active = 1
  `);
  return r.rows.map((x) => x.id).filter(Boolean);
}

async function getTokensForUserIds(client, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map((x) => Number(x)))];
  if (!ids.length) return [];

  const { rows } = await client.query(
    `
    SELECT DISTINCT ON (token) token
    FROM public.user_fcm_tokens
    WHERE user_id = ANY($1::int[])
    ORDER BY token, last_seen_at DESC
    `,
    [ids]
  );

  return rows.map((r) => r.token).filter(Boolean);
}

async function cleanupBadTokens(client, badTokens) {
  const bad = [...new Set((badTokens || []).filter(Boolean))];
  if (!bad.length) return;
  await client.query(
    `DELETE FROM public.user_fcm_tokens WHERE token = ANY($1::text[])`,
    [bad]
  );
}

async function enviarPushNotificacion(client, { notifRow }) {
  const {
    id,
    id_proyecto,
    id_usuario,
    id_consultor,
    titulo,
    mensaje,
    es_global,
  } = notifRow;

  let userIds = [];

  if (es_global) {
    userIds = await getAllActiveUserIdsWithTokens(client);
  } else {
    const uIds = await getUserIdsByIdCliente(client, id_usuario);
    const cIds = await getUserIdsByIdConsultor(client, id_consultor);
    userIds = [...uIds, ...cIds];
  }

  const tokens = await getTokensForUserIds(client, userIds);
  if (!tokens.length) return { ok: true, sent: 0, note: "no_tokens" };

  const result = await sendToTokens(tokens, {
    title: titulo,
    body: mensaje,
    data: {
      notif_id: id?.toString?.() || "",
      id_proyecto: id_proyecto?.toString?.() || "",
      tipo: "notificacion",
    },
  });

  if (result?.badTokens?.length) {
    await cleanupBadTokens(client, result.badTokens);
  }

  return result;
}

/* =========================
   Crear notificación
========================= */
async function crearNotificacion({
  id_proyecto = null,
  proponenteId = null,
  consultorId = null,
  titulo,
  mensaje,
  creado_por = "Sistema",
  es_global = false,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const t = String(titulo || "").toLowerCase();

    if (t.startsWith("resolución")) {
      const esVencida = t.includes("vencida");
      const esVenceEn = t.includes("vence en");

      if (esVencida || esVenceEn) {
        await client.query(
          `
          UPDATE public.notificaciones
             SET leido_usuario = true,
                 leido_consultor = true
           WHERE id_proyecto = $1
             AND (
               ($2 = true  AND lower(titulo) LIKE 'resolución % vencida%')
               OR
               ($3 = true  AND lower(titulo) LIKE 'resolución % vence en%')
             )
          `,
          [id_proyecto, esVencida, esVenceEn]
        );
      }
    }

    if (titulo === "DIA vencida hace más de 3 meses") {
      const { rowCount } = await client.query(
        `
        SELECT 1
        FROM public.notificaciones
        WHERE id_proyecto = $1
          AND titulo = 'DIA vencida hace más de 3 meses'
          AND leido_usuario = false
          AND leido_consultor = false
        LIMIT 1
        `,
        [id_proyecto]
      );

      if (rowCount > 0) {
        await client.query("ROLLBACK");
        return null;
      }
    }

    const insertRes = await client.query(
      `
      INSERT INTO public.notificaciones (
        id_usuario, id_consultor, id_proyecto, titulo, mensaje,
        leido_usuario, leido_consultor, es_global, creado_por, creado_en
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
      RETURNING *
      `,
      [
        proponenteId,
        consultorId,
        id_proyecto,
        titulo,
        mensaje,
        false,
        false,
        es_global,
        creado_por,
      ]
    );

    const notifRow = insertRes.rows[0];

    try {
      await enviarPushNotificacion(client, { notifRow });
    } catch (e) {
      console.warn("[Push] Error enviando FCM:", e?.message || e);
    }

    await client.query("COMMIT");
    return notifRow;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error creando notificación:", err);
    throw err;
  } finally {
    client.release();
  }
}

/* =========================
   Obtener recientes
========================= */
async function obtenerRecientes(req, res) {
  const { tipo_usuario, id_cliente, id_consultor } = req.user;
  const condiciones = [];
  const params = [];

  if (tipo_usuario === 9 || tipo_usuario === 10) {
    condiciones.push(`(id_usuario = $1 AND leido_usuario = false)`);
    params.push(id_cliente);
  } else if (tipo_usuario === 8) {
    condiciones.push(`(id_consultor = $1 AND leido_consultor = false)`);
    params.push(id_consultor);
  } else {
    let idx = 1;
    if (id_cliente) {
      condiciones.push(`(id_usuario = $${idx} AND leido_usuario = false)`);
      params.push(id_cliente);
      idx++;
    }
    if (id_consultor) {
      condiciones.push(`(id_consultor = $${idx} AND leido_consultor = false)`);
      params.push(id_consultor);
      idx++;
    }
  }

  const whereClauses = [];
  if (condiciones.length) whereClauses.push(`(${condiciones.join(" OR ")})`);
  whereClauses.push("es_global = true");
  const where = whereClauses.join(" OR ");

  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM public.notificaciones
        WHERE ${where}
        ORDER BY creado_en DESC
        LIMIT 5`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Error notificaciones recientes:", err);
    res.status(500).json({ message: "Error al obtener notificaciones recientes" });
  }
}

/* =========================
   Obtener todas (usuario normal)
   ✅ notificaciones.read
========================= */
async function obtenerTodas(req, res) {
  const { tipo_usuario, id_cliente, id_consultor } = req.user;

  if (!hasPerm(req.user, "notificaciones.read")) {
    return res.status(403).json({ message: "Acceso denegado" });
  }

  try {
    let query = `
      SELECT
        n.id AS id_notificacion,
        n.id_usuario,
        n.id_consultor,
        n.id_proyecto,
        n.titulo,
        n.mensaje,
        n.leido_usuario,
        n.leido_consultor,
        n.es_global,
        n.creado_por,
        n.creado_en,
        p.nombre AS proyecto_nombre,
        p.codigo AS proyecto_codigo
      FROM public.notificaciones n
      LEFT JOIN ema.proyectos p ON n.id_proyecto = p.gid
    `;

    const condiciones = [];
    const params = [];
    let idx = 1;

    // globales
    condiciones.push(`n.es_global = true`);

    // cliente / cliente vial
    if (tipo_usuario === 9 || tipo_usuario === 10) {
      if (id_cliente) {
        condiciones.push(`n.id_usuario = $${idx}`);
        params.push(id_cliente);
        idx++;
      }
    }
    // consultor
    else if (tipo_usuario === 8) {
      if (id_consultor) {
        condiciones.push(`n.id_consultor = $${idx}`);
        params.push(id_consultor);
        idx++;

        condiciones.push(`n.id_proyecto IN (
          SELECT gid
          FROM ema.proyectos
          WHERE id_consultor = $${idx}
        )`);
        params.push(id_consultor);
        idx++;

        condiciones.push(`n.id_usuario IN (
          SELECT id_cliente
          FROM public.users
          WHERE id_consultor = $${idx} AND active = 1
        )`);
        params.push(id_consultor);
        idx++;
      }
    }
    // otros usuarios con permiso normal
    else {
      if (id_cliente) {
        condiciones.push(`n.id_usuario = $${idx}`);
        params.push(id_cliente);
        idx++;
      }

      if (id_consultor) {
        condiciones.push(`n.id_consultor = $${idx}`);
        params.push(id_consultor);
        idx++;

        condiciones.push(`n.id_proyecto IN (
          SELECT gid
          FROM ema.proyectos
          WHERE id_consultor = $${idx}
        )`);
        params.push(id_consultor);
        idx++;
      }
    }

    if (!condiciones.length) {
      return res.json([]);
    }

    query += `
      WHERE (${condiciones.join(" OR ")})
      ORDER BY n.creado_en DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener todas las notificaciones:", err);
    res.status(500).json({
      message: "Error al obtener todas las notificaciones",
      error: err.message,
    });
  }
}

/* =========================
   Obtener todas (admin)
   ✅ notificaciones.read.admin
========================= */
async function obtenerTodasAdmin(req, res) {
  const { id_consultor } = req.user;

  if (!hasPerm(req.user, "notificaciones.read.admin")) {
    return res.status(403).json({ message: "Acceso denegado" });
  }

  const esAdminGlobal = isAdminGlobalByPerm(req.user);

  if (!esAdminGlobal && !id_consultor) {
    return res.status(403).json({ message: "Acceso denegado (sin consultor)" });
  }

  try {
    let query = `
      SELECT n.id AS id_notificacion, n.id_usuario, n.id_consultor, n.id_proyecto,
             n.titulo, n.mensaje, n.leido_usuario, n.leido_consultor,
             n.es_global, n.creado_por, n.creado_en,
             p.nombre AS proyecto_nombre, p.codigo AS proyecto_codigo
        FROM public.notificaciones n
        LEFT JOIN ema.proyectos p ON n.id_proyecto = p.gid
    `;

    const params = [];

    if (!esAdminGlobal) {
      query += `
        WHERE
          (n.es_global = true)
          OR (n.id_consultor = $1)
          OR (n.id_proyecto IN (
            SELECT gid FROM ema.proyectos WHERE id_consultor = $1
          ))
          OR (n.id_usuario IN (
            SELECT id_cliente FROM public.users WHERE id_consultor = $1 AND active = 1
          ))
      `;
      params.push(id_consultor);
    }

    query += ` ORDER BY n.creado_en DESC`;

    const { rows } = await pool.query(query, params);

    console.log(
      `✅ obtenerTodasAdmin: ${rows.length} notificaciones (adminGlobal=${esAdminGlobal}, id_consultor=${id_consultor || "null"})`
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener todas las notificaciones (admin):", err);
    res.status(500).json({
      message: "Error al obtener todas las notificaciones",
      error: err.message,
    });
  }
}

/* =========================
   Marcar todas como leídas
========================= */
async function marcarComoLeidas(req, res) {
  const { tipo_usuario, id_cliente, id_consultor } = req.user;
  let setClause, whereClause, params;

  if (tipo_usuario === 9 || tipo_usuario === 10) {
    setClause = `leido_usuario = true`;
    whereClause = `id_usuario = $1 AND leido_usuario = false`;
    params = [id_cliente];
  } else if (tipo_usuario === 8) {
    setClause = `leido_consultor = true`;
    whereClause = `id_consultor = $1 AND leido_consultor = false`;
    params = [id_consultor];
  } else {
    setClause = `leido_usuario = true, leido_consultor = true`;
    whereClause = `((id_usuario = $1 AND leido_usuario = false) OR (id_consultor = $2 AND leido_consultor = false))`;
    params = [id_cliente || null, id_consultor || null];
  }

  try {
    await pool.query(
      `UPDATE public.notificaciones
          SET ${setClause}
        WHERE ${whereClause}`,
      params
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("Error marcar como leídas:", err);
    res.status(500).json({ message: "Error al marcar notificaciones como leídas" });
  }
}

/* =========================
   Test crear
========================= */
async function testCrear(req, res) {
  const {
    proponenteId = null,
    consultorId = null,
    id_proyecto = null,
    titulo,
    mensaje,
    creado_por = "Sistema",
    es_global = false,
  } = req.body;

  try {
    const noti = await crearNotificacion({
      proponenteId,
      consultorId,
      id_proyecto,
      titulo,
      mensaje,
      creado_por,
      es_global,
    });

    if (!noti) {
      return res.status(200).json({
        success: true,
        message: "Ya existía una notificación activa de ese tipo, no se duplicó.",
      });
    }

    res.json({
      success: true,
      message: "Notificación de prueba creada.",
      notificacion: noti,
    });
  } catch (err) {
    console.error("Error al crear notificación de prueba:", err);
    res.status(500).json({
      message: "Error al crear notificación de prueba",
      error: err.message,
    });
  }
}

/* =========================
   Marcar 1 notificación como leída
========================= */
async function marcarLeidaPorId(req, res) {
  const { tipo_usuario, id_cliente, id_consultor } = req.user;
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "ID inválido" });
  }

  let setClause = "";
  let whereClause = "";
  let params = [];

  if (tipo_usuario === 9 || tipo_usuario === 10) {
    setClause = `leido_usuario = true`;
    whereClause = `(n.id = $1) AND (n.es_global = true OR n.id_usuario = $2)`;
    params = [id, id_cliente];
  } else if (tipo_usuario === 8) {
    setClause = `leido_consultor = true`;
    whereClause = `
      (n.id = $1)
      AND (
        n.es_global = true
        OR n.id_consultor = $2
        OR n.id_proyecto IN (
          SELECT gid FROM ema.proyectos WHERE id_consultor = $2
        )
        OR n.id_usuario IN (
          SELECT id_cliente FROM public.users WHERE id_consultor = $2 AND active = 1
        )
      )
    `;
    params = [id, id_consultor];
  } else {
    setClause = `leido_usuario = true, leido_consultor = true`;
    whereClause = `
      (n.id = $1)
      AND (
        n.es_global = true
        OR (n.id_usuario = $2)
        OR (n.id_consultor = $3)
      )
    `;
    params = [id, id_cliente || null, id_consultor || null];
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE public.notificaciones n
         SET ${setClause}
       WHERE ${whereClause}
       RETURNING n.id AS id_notificacion, n.leido_usuario, n.leido_consultor
      `,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Notificación no encontrada o sin acceso" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("Error marcarLeidaPorId:", err);
    return res.status(500).json({ message: "Error al marcar notificación como leída" });
  }
}

module.exports = {
  crearNotificacion,
  obtenerRecientes,
  obtenerTodas,
  obtenerTodasAdmin,
  marcarComoLeidas,
  testCrear,
  marcarLeidaPorId,
};