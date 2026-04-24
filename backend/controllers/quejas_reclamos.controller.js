"use strict";

const pool = require("../db");

/* =========================================================
   Helpers
========================================================= */
function toInt(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function sanitizeDate(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return String(v).trim();
}

function buildPagination(page, limit) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.max(parseInt(limit, 10) || 10, 1);
  const offset = (p - 1) * l;
  return { page: p, limit: l, offset };
}

function normalizeConformidad(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;

  const s = String(v).trim().toLowerCase();

  if (["si", "sí", "true", "1", "t"].includes(s)) return "si";
  if (["no", "false", "0", "f"].includes(s)) return "no";
  if (["otro", "otros"].includes(s)) return "otro";

  return s;
}

function normalizeEstado(v) {
  const s = sanitizeText(v);
  return s || "abierto";
}

/* =========================================================
   GET /api/quejas-reclamos
========================================================= */
async function listarQuejasReclamos(req, res) {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      estado = "",
      tipologia = "",
      nivel_riesgo = "",
      id_proyecto = "",
      id_tramo = "",
      fecha_desde = "",
      fecha_hasta = "",
    } = req.query;

    const { page: p, limit: l, offset } = buildPagination(page, limit);

    const where = [];
    const params = [];
    let idx = 1;

    if (sanitizeText(search)) {
      where.push(`(
        CAST(qr.id_queja AS TEXT) ILIKE $${idx}
        OR COALESCE(qr.numero, '') ILIKE $${idx}
        OR COALESCE(qr.codigo, '') ILIKE $${idx}
        OR COALESCE(qr.reclamante_nombre, '') ILIKE $${idx}
        OR COALESCE(qr.reclamante_ci, '') ILIKE $${idx}
        OR COALESCE(qr.ci_afectado, '') ILIKE $${idx}
        OR COALESCE(qr.descripcion, '') ILIKE $${idx}
        OR COALESCE(qr.empresa, '') ILIKE $${idx}
        OR COALESCE(qr.centro_trabajo, '') ILIKE $${idx}
        OR COALESCE(qr.ciudad, '') ILIKE $${idx}
      )`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    if (sanitizeText(estado)) {
      where.push(`qr.estado = $${idx}`);
      params.push(estado.trim());
      idx++;
    }

    if (sanitizeText(tipologia)) {
      where.push(`qr.tipologia = $${idx}`);
      params.push(tipologia.trim());
      idx++;
    }

    if (sanitizeText(nivel_riesgo)) {
      where.push(`qr.nivel_riesgo = $${idx}`);
      params.push(nivel_riesgo.trim());
      idx++;
    }

    if (sanitizeText(id_proyecto)) {
      where.push(`qr.id_proyecto = $${idx}`);
      params.push(parseInt(id_proyecto, 10));
      idx++;
    }

    if (sanitizeText(id_tramo)) {
      where.push(`qr.id_tramo = $${idx}`);
      params.push(parseInt(id_tramo, 10));
      idx++;
    }

    if (sanitizeText(fecha_desde)) {
      where.push(`qr.fecha_reclamo::date >= $${idx}::date`);
      params.push(fecha_desde);
      idx++;
    }

    if (sanitizeText(fecha_hasta)) {
      where.push(`qr.fecha_reclamo::date <= $${idx}::date`);
      params.push(fecha_hasta);
      idx++;
    }

    if (Number(req.user?.group_id) === 9 && req.user?.id_cliente) {
      where.push(`qr.id_cliente = $${idx}`);
      params.push(Number(req.user.id_cliente));
      idx++;
    } else if (Number(req.user?.group_id) === 8 && req.user?.id_consultor) {
      where.push(`qr.id_consultor = $${idx}`);
      params.push(Number(req.user.id_consultor));
      idx++;
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM ema.quejas_reclamos qr
      ${whereSQL}
    `;

    const dataSql = `
      SELECT
        qr.id_queja,
        qr.numero,
        qr.codigo,
        qr.fecha_reclamo,
        qr.id_proyecto,
        qr.id_tramo,
        qr.id_expediente,
        qr.id_cliente,
        qr.id_consultor,

        qr.centro_trabajo,
        qr.empresa,
        qr.pais,
        qr.linea_negocio,
        qr.via_recepcion,
        qr.desea_formular,

        qr.reclamante_nombre,
        qr.reclamante_ci,
        qr.direccion,
        qr.pk,
        qr.ciudad,
        qr.telefono,
        qr.email,
        qr.categoria_persona,
        qr.en_calidad,
        qr.nivel_riesgo,
        qr.tipo_vehiculo,
        qr.matricula,

        qr.tipologia,
        qr.descripcion,
        qr.responsable_respuesta,
        qr.recibido_por,
        qr.aclaracion_recibido,
        qr.fecha_recibido,
        qr.fecha_respuesta,
        qr.respuesta,
        qr.resolucion,
        qr.conformidad_respuesta,
        qr.nivel_satisfaccion,
        qr.observacion_cierre,
        qr.estado,
        qr.fecha_cierre,

        qr.aclaracion_reclamante,
        qr.aclaracion_responsable,
        qr.ci_afectado,
        qr.ci_responsable,

        qr.firma_reclamante,
        qr.firma_responsable,
        qr.created_at,
        qr.updated_at
      FROM ema.quejas_reclamos qr
      ${whereSQL}
      ORDER BY qr.id_queja DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const countResult = await pool.query(countSql, params);
    const total = countResult.rows[0]?.total || 0;

    const dataParams = [...params, l, offset];
    const dataResult = await pool.query(dataSql, dataParams);

    return res.json({
      data: dataResult.rows,
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l),
      },
    });
  } catch (err) {
    console.error("❌ listarQuejasReclamos:", err);
    return res.status(500).json({ message: "Error al listar quejas y reclamos" });
  }
}

/* =========================================================
   GET /api/quejas-reclamos/:id
========================================================= */
async function obtenerQuejaReclamo(req, res) {
  try {
    const id = parseInt(req.params.id, 10);

    const sql = `
      SELECT qr.*
      FROM ema.quejas_reclamos qr
      WHERE qr.id_queja = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Queja o reclamo no encontrado" });
    }

    const item = rows[0];

    if (Number(req.user?.group_id) === 9 && req.user?.id_cliente) {
      if (Number(item.id_cliente) !== Number(req.user.id_cliente)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    if (Number(req.user?.group_id) === 8 && req.user?.id_consultor) {
      if (Number(item.id_consultor) !== Number(req.user.id_consultor)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    return res.json(item);
  } catch (err) {
    console.error("❌ obtenerQuejaReclamo:", err);
    return res.status(500).json({ message: "Error al obtener la queja o reclamo" });
  }
}

/* =========================================================
   POST /api/quejas-reclamos
========================================================= */
async function crearQuejaReclamo(req, res) {
  try {
    const body = req.body || {};

    const numero = sanitizeText(body.numero);
    const codigo = sanitizeText(body.codigo) || numero;

    const fecha_reclamo = sanitizeDate(body.fecha_reclamo) || new Date();

    const id_proyecto = toInt(body.id_proyecto);
    const id_tramo = toInt(body.id_tramo);
    const id_expediente = toInt(body.id_expediente);

    let id_cliente = toInt(body.id_cliente);
    let id_consultor = toInt(body.id_consultor);

    const centro_trabajo = sanitizeText(body.centro_trabajo);
    const empresa = sanitizeText(body.empresa);
    const pais = sanitizeText(body.pais);
    const linea_negocio = sanitizeText(body.linea_negocio);
    const via_recepcion = sanitizeText(body.via_recepcion);
    const desea_formular = sanitizeText(body.desea_formular);

    const reclamante_nombre = sanitizeText(body.reclamante_nombre);
    const reclamante_ci = sanitizeText(body.reclamante_ci);
    const direccion = sanitizeText(body.direccion);
    const pk = sanitizeText(body.pk);
    const ciudad = sanitizeText(body.ciudad);
    const telefono = sanitizeText(body.telefono);
    const email = sanitizeText(body.email);

    const categoria_persona = sanitizeText(body.categoria_persona);
    const en_calidad = sanitizeText(body.en_calidad) || categoria_persona;
    const nivel_riesgo = sanitizeText(body.nivel_riesgo);

    const tipo_vehiculo = sanitizeText(body.tipo_vehiculo);
    const matricula = sanitizeText(body.matricula);

    const tipologia = sanitizeText(body.tipologia);
    const descripcion = sanitizeText(body.descripcion);

    const firma_reclamante = sanitizeText(body.firma_reclamante);

    const responsable_respuesta = sanitizeText(body.responsable_respuesta);
    const recibido_por = sanitizeText(body.recibido_por);
    const aclaracion_recibido = sanitizeText(body.aclaracion_recibido);
    const fecha_recibido = sanitizeDate(body.fecha_recibido);

    const fecha_respuesta = sanitizeDate(body.fecha_respuesta);
    const respuesta = sanitizeText(body.respuesta);
    const resolucion = sanitizeText(body.resolucion);

    const conformidad_respuesta = normalizeConformidad(body.conformidad_respuesta);
    const nivel_satisfaccion = sanitizeText(body.nivel_satisfaccion);
    const observacion_cierre = sanitizeText(body.observacion_cierre);

    const estado = normalizeEstado(body.estado);
    const fecha_cierre = sanitizeDate(body.fecha_cierre);

    const aclaracion_reclamante = sanitizeText(body.aclaracion_reclamante);
    const aclaracion_responsable = sanitizeText(body.aclaracion_responsable);
    const ci_afectado = sanitizeText(body.ci_afectado) || reclamante_ci;
    const ci_responsable = sanitizeText(body.ci_responsable);

    const firma_responsable = sanitizeText(body.firma_responsable);

    if (!id_cliente && Number(req.user?.group_id) === 9 && req.user?.id_cliente) {
      id_cliente = Number(req.user.id_cliente);
    }

    if (!id_consultor && Number(req.user?.group_id) === 8 && req.user?.id_consultor) {
      id_consultor = Number(req.user.id_consultor);
    }

    if (!descripcion) {
      return res.status(400).json({ message: "La descripción es obligatoria" });
    }

    const sql = `
      INSERT INTO ema.quejas_reclamos (
        numero,
        codigo,
        fecha_reclamo,
        id_proyecto,
        id_tramo,
        id_expediente,
        id_cliente,
        id_consultor,

        centro_trabajo,
        empresa,
        pais,
        linea_negocio,
        via_recepcion,
        desea_formular,

        reclamante_nombre,
        reclamante_ci,
        direccion,
        pk,
        ciudad,
        telefono,
        email,
        categoria_persona,
        en_calidad,
        nivel_riesgo,
        tipo_vehiculo,
        matricula,

        tipologia,
        descripcion,
        firma_reclamante,

        responsable_respuesta,
        recibido_por,
        aclaracion_recibido,
        fecha_recibido,
        fecha_respuesta,
        respuesta,
        resolucion,

        conformidad_respuesta,
        nivel_satisfaccion,
        observacion_cierre,
        estado,
        fecha_cierre,

        aclaracion_reclamante,
        aclaracion_responsable,
        ci_afectado,
        ci_responsable,
        firma_responsable,

        creado_por,
        actualizado_por,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
        $27,$28,$29,
        $30,$31,$32,$33,$34,$35,$36,
        $37,$38,$39,$40,$41,
        $42,$43,$44,$45,$46,
        $47,$48,NOW(),NOW()
      )
      RETURNING *
    `;

    const params = [
      numero,
      codigo,
      fecha_reclamo,
      id_proyecto,
      id_tramo,
      id_expediente,
      id_cliente,
      id_consultor,

      centro_trabajo,
      empresa,
      pais,
      linea_negocio,
      via_recepcion,
      desea_formular,

      reclamante_nombre,
      reclamante_ci,
      direccion,
      pk,
      ciudad,
      telefono,
      email,
      categoria_persona,
      en_calidad,
      nivel_riesgo,
      tipo_vehiculo,
      matricula,

      tipologia,
      descripcion,
      firma_reclamante,

      responsable_respuesta,
      recibido_por,
      aclaracion_recibido,
      fecha_recibido,
      fecha_respuesta,
      respuesta,
      resolucion,

      conformidad_respuesta,
      nivel_satisfaccion,
      observacion_cierre,
      estado,
      fecha_cierre,

      aclaracion_reclamante,
      aclaracion_responsable,
      ci_afectado,
      ci_responsable,
      firma_responsable,

      req.user?.id || null,
      req.user?.id || null,
    ];

    const { rows } = await pool.query(sql, params);

    return res.status(201).json({
      message: "Queja o reclamo creado correctamente",
      data: rows[0],
    });
  } catch (err) {
    console.error("❌ crearQuejaReclamo:", err);
    return res.status(500).json({
      message: "Error al crear la queja o reclamo",
      error: err?.message || String(err),
    });
  }
}

/* =========================================================
   PUT /api/quejas-reclamos/:id
========================================================= */
async function actualizarQuejaReclamo(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};

    const exists = await pool.query(
      `SELECT * FROM ema.quejas_reclamos WHERE id_queja = $1 LIMIT 1`,
      [id]
    );

    if (!exists.rows.length) {
      return res.status(404).json({ message: "Queja o reclamo no encontrado" });
    }

    const actual = exists.rows[0];

    if (Number(req.user?.group_id) === 9 && req.user?.id_cliente) {
      if (Number(actual.id_cliente) !== Number(req.user.id_cliente)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    if (Number(req.user?.group_id) === 8 && req.user?.id_consultor) {
      if (Number(actual.id_consultor) !== Number(req.user.id_consultor)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    const sql = `
      UPDATE ema.quejas_reclamos
      SET
        numero = $1,
        codigo = $2,
        fecha_reclamo = $3,
        id_proyecto = $4,
        id_tramo = $5,
        id_expediente = $6,
        id_cliente = $7,
        id_consultor = $8,

        centro_trabajo = $9,
        empresa = $10,
        pais = $11,
        linea_negocio = $12,
        via_recepcion = $13,
        desea_formular = $14,

        reclamante_nombre = $15,
        reclamante_ci = $16,
        direccion = $17,
        pk = $18,
        ciudad = $19,
        telefono = $20,
        email = $21,
        categoria_persona = $22,
        en_calidad = $23,
        nivel_riesgo = $24,
        tipo_vehiculo = $25,
        matricula = $26,

        tipologia = $27,
        descripcion = $28,
        firma_reclamante = $29,

        responsable_respuesta = $30,
        recibido_por = $31,
        aclaracion_recibido = $32,
        fecha_recibido = $33,
        fecha_respuesta = $34,
        respuesta = $35,
        resolucion = $36,

        conformidad_respuesta = $37,
        nivel_satisfaccion = $38,
        observacion_cierre = $39,
        estado = $40,
        fecha_cierre = $41,

        aclaracion_reclamante = $42,
        aclaracion_responsable = $43,
        ci_afectado = $44,
        ci_responsable = $45,
        firma_responsable = $46,

        actualizado_por = $47,
        updated_at = NOW()
      WHERE id_queja = $48
      RETURNING *
    `;

    const params = [
      body.numero !== undefined ? sanitizeText(body.numero) : actual.numero,
      body.codigo !== undefined
        ? sanitizeText(body.codigo)
        : (actual.codigo || actual.numero),

      body.fecha_reclamo !== undefined
        ? sanitizeDate(body.fecha_reclamo)
        : actual.fecha_reclamo,

      body.id_proyecto !== undefined ? toInt(body.id_proyecto) : actual.id_proyecto,
      body.id_tramo !== undefined ? toInt(body.id_tramo) : actual.id_tramo,
      body.id_expediente !== undefined ? toInt(body.id_expediente) : actual.id_expediente,
      body.id_cliente !== undefined ? toInt(body.id_cliente) : actual.id_cliente,
      body.id_consultor !== undefined ? toInt(body.id_consultor) : actual.id_consultor,

      body.centro_trabajo !== undefined ? sanitizeText(body.centro_trabajo) : actual.centro_trabajo,
      body.empresa !== undefined ? sanitizeText(body.empresa) : actual.empresa,
      body.pais !== undefined ? sanitizeText(body.pais) : actual.pais,
      body.linea_negocio !== undefined ? sanitizeText(body.linea_negocio) : actual.linea_negocio,
      body.via_recepcion !== undefined ? sanitizeText(body.via_recepcion) : actual.via_recepcion,
      body.desea_formular !== undefined ? sanitizeText(body.desea_formular) : actual.desea_formular,

      body.reclamante_nombre !== undefined ? sanitizeText(body.reclamante_nombre) : actual.reclamante_nombre,
      body.reclamante_ci !== undefined ? sanitizeText(body.reclamante_ci) : actual.reclamante_ci,
      body.direccion !== undefined ? sanitizeText(body.direccion) : actual.direccion,
      body.pk !== undefined ? sanitizeText(body.pk) : actual.pk,
      body.ciudad !== undefined ? sanitizeText(body.ciudad) : actual.ciudad,
      body.telefono !== undefined ? sanitizeText(body.telefono) : actual.telefono,
      body.email !== undefined ? sanitizeText(body.email) : actual.email,
      body.categoria_persona !== undefined ? sanitizeText(body.categoria_persona) : actual.categoria_persona,

      body.en_calidad !== undefined
        ? sanitizeText(body.en_calidad)
        : (actual.en_calidad || actual.categoria_persona),

      body.nivel_riesgo !== undefined ? sanitizeText(body.nivel_riesgo) : actual.nivel_riesgo,
      body.tipo_vehiculo !== undefined ? sanitizeText(body.tipo_vehiculo) : actual.tipo_vehiculo,
      body.matricula !== undefined ? sanitizeText(body.matricula) : actual.matricula,

      body.tipologia !== undefined ? sanitizeText(body.tipologia) : actual.tipologia,
      body.descripcion !== undefined ? sanitizeText(body.descripcion) : actual.descripcion,
      body.firma_reclamante !== undefined ? sanitizeText(body.firma_reclamante) : actual.firma_reclamante,

      body.responsable_respuesta !== undefined
        ? sanitizeText(body.responsable_respuesta)
        : actual.responsable_respuesta,

      body.recibido_por !== undefined ? sanitizeText(body.recibido_por) : actual.recibido_por,
      body.aclaracion_recibido !== undefined
        ? sanitizeText(body.aclaracion_recibido)
        : actual.aclaracion_recibido,

      body.fecha_recibido !== undefined ? sanitizeDate(body.fecha_recibido) : actual.fecha_recibido,
      body.fecha_respuesta !== undefined ? sanitizeDate(body.fecha_respuesta) : actual.fecha_respuesta,
      body.respuesta !== undefined ? sanitizeText(body.respuesta) : actual.respuesta,
      body.resolucion !== undefined ? sanitizeText(body.resolucion) : actual.resolucion,

      body.conformidad_respuesta !== undefined
        ? normalizeConformidad(body.conformidad_respuesta)
        : actual.conformidad_respuesta,

      body.nivel_satisfaccion !== undefined
        ? sanitizeText(body.nivel_satisfaccion)
        : actual.nivel_satisfaccion,

      body.observacion_cierre !== undefined
        ? sanitizeText(body.observacion_cierre)
        : actual.observacion_cierre,

      body.estado !== undefined ? normalizeEstado(body.estado) : actual.estado,
      body.fecha_cierre !== undefined ? sanitizeDate(body.fecha_cierre) : actual.fecha_cierre,

      body.aclaracion_reclamante !== undefined
        ? sanitizeText(body.aclaracion_reclamante)
        : actual.aclaracion_reclamante,

      body.aclaracion_responsable !== undefined
        ? sanitizeText(body.aclaracion_responsable)
        : actual.aclaracion_responsable,

      body.ci_afectado !== undefined
        ? sanitizeText(body.ci_afectado)
        : (actual.ci_afectado || actual.reclamante_ci),

      body.ci_responsable !== undefined ? sanitizeText(body.ci_responsable) : actual.ci_responsable,
      body.firma_responsable !== undefined ? sanitizeText(body.firma_responsable) : actual.firma_responsable,

      req.user?.id || null,
      id,
    ];

    if (!params[27]) {
      return res.status(400).json({ message: "La descripción es obligatoria" });
    }

    const { rows } = await pool.query(sql, params);

    return res.json({
      message: "Queja o reclamo actualizado correctamente",
      data: rows[0],
    });
  } catch (err) {
    console.error("❌ actualizarQuejaReclamo:", err);
    return res.status(500).json({
      message: "Error al actualizar la queja o reclamo",
      error: err?.message || String(err),
    });
  }
}

/* =========================================================
   PATCH /api/quejas-reclamos/:id/estado
========================================================= */
async function cambiarEstadoQuejaReclamo(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { estado, fecha_cierre } = req.body || {};

    if (!sanitizeText(estado)) {
      return res.status(400).json({ message: "El estado es obligatorio" });
    }

    const sql = `
      UPDATE ema.quejas_reclamos
      SET
        estado = $1::varchar,
        fecha_cierre = CASE
          WHEN $1::varchar = 'cerrado' THEN COALESCE($2::timestamp, NOW())
          ELSE fecha_cierre
        END,
        actualizado_por = $3::integer,
        updated_at = NOW()
      WHERE id_queja = $4::integer
      RETURNING *
    `;

    const params = [
      String(estado).trim(),
      fecha_cierre || null,
      req.user?.id || null,
      id,
    ];

    const { rows } = await pool.query(sql, params);

    if (!rows.length) {
      return res.status(404).json({ message: "Queja o reclamo no encontrado" });
    }

    return res.json({
      message: "Estado actualizado correctamente",
      data: rows[0],
    });
  } catch (err) {
    console.error("❌ cambiarEstadoQuejaReclamo:", err);
    return res.status(500).json({
      message: "Error al cambiar el estado",
      error: err?.message || String(err),
    });
  }
}

/* =========================================================
   DELETE /api/quejas-reclamos/:id
========================================================= */
async function eliminarQuejaReclamo(req, res) {
  try {
    const id = parseInt(req.params.id, 10);

    const exists = await pool.query(
      `SELECT id_queja, id_cliente, id_consultor FROM ema.quejas_reclamos WHERE id_queja = $1 LIMIT 1`,
      [id]
    );

    if (!exists.rows.length) {
      return res.status(404).json({ message: "Queja o reclamo no encontrado" });
    }

    const actual = exists.rows[0];

    if (Number(req.user?.group_id) === 9 && req.user?.id_cliente) {
      if (Number(actual.id_cliente) !== Number(req.user.id_cliente)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    if (Number(req.user?.group_id) === 8 && req.user?.id_consultor) {
      if (Number(actual.id_consultor) !== Number(req.user.id_consultor)) {
        return res.status(403).json({ message: "No autorizado" });
      }
    }

    await pool.query(`DELETE FROM ema.quejas_reclamos WHERE id_queja = $1`, [id]);

    return res.json({ message: "Queja o reclamo eliminado correctamente" });
  } catch (err) {
    console.error("❌ eliminarQuejaReclamo:", err);
    return res.status(500).json({ message: "Error al eliminar la queja o reclamo" });
  }
}

/* =========================================================
   GET /api/quejas-reclamos/stats
========================================================= */
async function obtenerEstadisticasQuejas(req, res) {
  try {
    const { id_proyecto } = req.query;
    if (!id_proyecto) return res.status(400).json({ message: "Falta id_proyecto" });

    // 1. Estados
    const qEstados = `
      SELECT estado, COUNT(*)::int as count 
      FROM ema.quejas_reclamos 
      WHERE id_proyecto = $1 
      GROUP BY estado`;
    const rEstados = await pool.query(qEstados, [id_proyecto]);

    // 2. Tipologías (Motivos)
    const qTipos = `
      SELECT tipologia, COUNT(*)::int as count 
      FROM ema.quejas_reclamos 
      WHERE id_proyecto = $1 
      GROUP BY tipologia 
      ORDER BY count DESC 
      LIMIT 10`;
    const rTipos = await pool.query(qTipos, [id_proyecto]);

    // 3. Tiempo promedio de respuesta (en días)
    const qPromedio = `
      SELECT AVG(fecha_cierre::date - fecha_reclamo::date)::float as promedio_respuesta 
      FROM ema.quejas_reclamos 
      WHERE id_proyecto = $1 
        AND fecha_cierre IS NOT NULL 
        AND fecha_reclamo IS NOT NULL
        AND fecha_cierre >= fecha_reclamo`;
    const rPromedio = await pool.query(qPromedio, [id_proyecto]);

    return res.json({
      estados: rEstados.rows,
      tipologias: rTipos.rows,
      promedio_respuesta: Math.round(rPromedio.rows[0]?.promedio_respuesta || 0)
    });
  } catch (err) {
    console.error("❌ obtenerEstadisticasQuejas:", err);
    return res.status(500).json({ message: "Error al obtener estadísticas" });
  }
}

module.exports = {
  listarQuejasReclamos,
  obtenerQuejaReclamo,
  crearQuejaReclamo,
  actualizarQuejaReclamo,
  cambiarEstadoQuejaReclamo,
  eliminarQuejaReclamo,
  obtenerEstadisticasQuejas,
};