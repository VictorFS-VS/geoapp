const pool = require("../db");

function normRol(rol) {
  const r = String(rol || "").toLowerCase();
  return r === "edit" || r === "editar" ? "edit" : "view";
}

function isAdmin(req) {
  return Number(req.user?.tipo_usuario ?? req.user?.group_id ?? req.user?.tipo) === 1;
}

/** Verifica si el usuario puede administrar (dueño o admin) */
async function requireOwnerOrAdmin(req, idPlantilla) {
  const userId = Number(req.user?.id);
  const admin = isAdmin(req);

  if (!Number.isFinite(userId)) {
    return { ok: false, status: 401, message: "Usuario no autenticado" };
  }

  const q = `SELECT id_creador FROM ema.informe_plantilla WHERE id_plantilla=$1 LIMIT 1`;
  const { rows } = await pool.query(q, [idPlantilla]);

  if (!rows.length) {
    return { ok: false, status: 404, message: "Plantilla no encontrada" };
  }

  const id_creador = Number(rows[0].id_creador);
  const owner = id_creador === userId;

  if (!owner && !admin) {
    return { ok: false, status: 403, message: "Sin permisos" };
  }

  return { ok: true, owner, admin, id_creador };
}

/**
 * GET /api/compartir/plantillas/:id_plantilla
 * Lista usuarios compartidos con rol + nombre/email
 */
exports.listarPlantilla = async (req, res) => {
  try {
    const idPlantilla = Number(req.params.id_plantilla);
    if (!Number.isFinite(idPlantilla)) {
      return res.status(400).json({ ok: false, message: "id_plantilla inválido" });
    }

    const perm = await requireOwnerOrAdmin(req, idPlantilla);
    if (!perm.ok) return res.status(perm.status).json({ ok: false, message: perm.message });

    const q = `
      SELECT
        pu.id_usuario,
        pu.rol,
        u.username,
        u.email,
        u.first_name,
        u.last_name
      FROM ema.informe_plantilla_usuario pu
      JOIN public.users u ON u.id = pu.id_usuario
      WHERE pu.id_plantilla = $1
      ORDER BY u.username ASC
    `;
    const { rows } = await pool.query(q, [idPlantilla]);

    return res.json({ ok: true, rows });
  } catch (e) {
    console.error("listarPlantilla error:", e);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};

/**
 * POST /api/compartir/plantillas/:id_plantilla
 * body: { id_usuario, rol }  => inserta o actualiza
 */
exports.upsertCompartir = async (req, res) => {
  try {
    const idPlantilla = Number(req.params.id_plantilla);
    const idUsuario = Number(req.body?.id_usuario);
    const rol = normRol(req.body?.rol);

    if (!Number.isFinite(idPlantilla)) {
      return res.status(400).json({ ok: false, message: "id_plantilla inválido" });
    }
    if (!Number.isFinite(idUsuario)) {
      return res.status(400).json({ ok: false, message: "id_usuario inválido" });
    }

    const perm = await requireOwnerOrAdmin(req, idPlantilla);
    if (!perm.ok) return res.status(perm.status).json({ ok: false, message: perm.message });

    // evitar compartir al dueño (opcional)
    if (perm.id_creador === idUsuario) {
      return res.status(400).json({ ok: false, message: "No hace falta compartir con el dueño" });
    }

    const q = `
      INSERT INTO ema.informe_plantilla_usuario (id_plantilla, id_usuario, rol)
      VALUES ($1,$2,$3)
      ON CONFLICT (id_plantilla, id_usuario)
      DO UPDATE SET rol = EXCLUDED.rol
      RETURNING id_plantilla, id_usuario, rol
    `;
    const { rows } = await pool.query(q, [idPlantilla, idUsuario, rol]);

    return res.json({ ok: true, row: rows[0] });
  } catch (e) {
    console.error("upsertCompartir error:", e);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};

/**
 * DELETE /api/compartir/plantillas/:id_plantilla/:id_usuario
 */
exports.quitarCompartir = async (req, res) => {
  try {
    const idPlantilla = Number(req.params.id_plantilla);
    const idUsuario = Number(req.params.id_usuario);

    if (!Number.isFinite(idPlantilla)) {
      return res.status(400).json({ ok: false, message: "id_plantilla inválido" });
    }
    if (!Number.isFinite(idUsuario)) {
      return res.status(400).json({ ok: false, message: "id_usuario inválido" });
    }

    const perm = await requireOwnerOrAdmin(req, idPlantilla);
    if (!perm.ok) return res.status(perm.status).json({ ok: false, message: perm.message });

    await pool.query(
      `DELETE FROM ema.informe_plantilla_usuario WHERE id_plantilla=$1 AND id_usuario=$2`,
      [idPlantilla, idUsuario]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("quitarCompartir error:", e);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};
