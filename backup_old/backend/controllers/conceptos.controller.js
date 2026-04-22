// src/controllers/conceptos.controller.js
const pool = require('../db');

/**
 * GET /api/conceptos
 * - ?simple=1        -> lista simple para selects (sin paginar)
 * - ?tipoconcepto=   -> filtra por tipo (ej: PGA_ESTADO, TIPO_RIESGO, TIPO_PLAN)
 * - ?search=         -> busca por concepto/nombre/tipoconcepto
 * - ?page= & ?limit= -> paginado (si no es simple)
 */
const listarConceptos = async (req, res) => {
  const simple = String(req.query.simple || '').toLowerCase();
  const isSimple = simple === '1' || simple === 'true';

  const page  = parseInt(req.query.page, 10)  || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  const search = req.query.search || '';
  const tipo   = req.query.tipoconcepto ? String(req.query.tipoconcepto).toUpperCase() : '';

  try {
    const conds = [];
    const params = [];

    if (tipo) {
      params.push(tipo);
      conds.push(`tipoconcepto = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conds.push(
        `(concepto ILIKE $${params.length} OR nombre ILIKE $${params.length} OR tipoconcepto ILIKE $${params.length})`
      );
    }

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // ---- Modo SIMPLE: sin paginar, ideal para selects ----
    if (isSimple) {
      const sql = `
        SELECT concepto, nombre, tipoconcepto
        FROM public.conceptos
        ${whereSql}
        ORDER BY nombre ASC;
      `;
      const { rows } = await pool.query(sql, params);
      return res.json(rows);
    }

    // ---- Paginado ----
    const totalSql = `SELECT COUNT(*)::int AS c FROM public.conceptos ${whereSql}`;
    const totalRs = await pool.query(totalSql, params);
    const total = totalRs.rows[0]?.c ?? 0;

    const dataSql = `
      SELECT *
      FROM public.conceptos
      ${whereSql}
      ORDER BY concepto ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;
    const dataRs = await pool.query(dataSql, [...params, limit, offset]);

    res.json({
      data: dataRs.rows,
      page,
      totalPages: Math.ceil(total / limit),
      totalItems: total
    });
  } catch (error) {
    console.error('Error al obtener conceptos:', error);
    res.status(500).json({ error: 'Error al obtener conceptos' });
  }
};

const crearConcepto = async (req, res) => {
  // ✅ normaliza: '' -> null (para date/numeric/etc)
  const norm = (v) => (v === "" || v === undefined ? null : v);

  const concepto = norm(req.body.concepto);
  const nombre = norm(req.body.nombre);
  const tipoconcepto = req.body.tipoconcepto ? String(req.body.tipoconcepto).toUpperCase() : null;

  const desde = norm(req.body.desde);
  const hasta = norm(req.body.hasta);
  const descripcion = norm(req.body.descripcion);

  const numero = norm(req.body.numero);
  const porcentaje = norm(req.body.porcentaje);
  const monto = norm(req.body.monto);

  const rango1 = norm(req.body.rango1);
  const rango2 = norm(req.body.rango2);
  const rango3 = norm(req.body.rango3);

  const referencia = norm(req.body.referencia);
  const clase = norm(req.body.clase);

  // ✅ validación básica
  if (!concepto || !tipoconcepto || !nombre) {
    return res.status(400).json({ error: "concepto, tipoconcepto y nombre son obligatorios" });
  }

  try {
    const sql = `
      INSERT INTO public.conceptos
        (concepto, nombre, tipoconcepto, desde, hasta, descripcion, numero,
         porcentaje, monto, rango1, rango2, rango3, referencia, clase)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (concepto, tipoconcepto)
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        desde = EXCLUDED.desde,
        hasta = EXCLUDED.hasta,
        descripcion = EXCLUDED.descripcion,
        numero = EXCLUDED.numero,
        porcentaje = EXCLUDED.porcentaje,
        monto = EXCLUDED.monto,
        rango1 = EXCLUDED.rango1,
        rango2 = EXCLUDED.rango2,
        rango3 = EXCLUDED.rango3,
        referencia = EXCLUDED.referencia,
        clase = EXCLUDED.clase;
    `;

    await pool.query(sql, [
      concepto, nombre, tipoconcepto, desde, hasta, descripcion, numero,
      porcentaje, monto, rango1, rango2, rango3, referencia, clase
    ]);

    res.status(201).json({ success: true, message: "Concepto creado/actualizado" });
  } catch (error) {
    console.error("Error al crear concepto:", error);
    res.status(500).json({ error: "Error al crear concepto" });
  }
};

const obtenerConcepto = async (req, res) => {
  const { concepto, tipoconcepto } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM public.conceptos WHERE concepto = $1 AND tipoconcepto = $2`,
      [concepto, tipoconcepto]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener concepto:', error);
    res.status(500).json({ error: 'Error al obtener concepto' });
  }
};

const actualizarConcepto = async (req, res) => {
  const { concepto, tipoconcepto } = req.params;

  // Limpia '' -> null
  let campos = Object.fromEntries(
    Object.entries(req.body || {}).map(([k, v]) => [k, v === '' ? null : v])
  );

  // Nunca permitir cambiar la PK desde el body
  delete campos.concepto;
  delete campos.tipoconcepto;

  if (!Object.keys(campos).length) {
    return res.status(400).json({ error: 'Sin campos a actualizar' });
  }

  const setQuery = Object.keys(campos)
    .map((key, idx) => `${key} = $${idx + 1}`)
    .join(', ');

  const valores = Object.values(campos);

  try {
    const rs = await pool.query(
      `UPDATE public.conceptos
       SET ${setQuery}
       WHERE concepto = $${valores.length + 1}
         AND tipoconcepto = $${valores.length + 2}`,
      [...valores, concepto, tipoconcepto]
    );

    if (rs.rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ message: 'Concepto actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar concepto:', error);
    res.status(500).json({ error: 'Error al actualizar concepto' });
  }
};

/**
 * DELETE /api/conceptos/:concepto/:tipoconcepto
 * (Si aún tienes rutas antiguas con :id, admite fallback con ?tipoconcepto=)
 */
const eliminarConcepto = async (req, res) => {
  let { concepto, tipoconcepto } = req.params;

  // Fallback para compatibilidad: /api/conceptos/:id?tipoconcepto=...
  if (!concepto && req.params.id) concepto = req.params.id;
  if (!tipoconcepto && req.query.tipoconcepto) {
    tipoconcepto = String(req.query.tipoconcepto);
  }

  if (!concepto || !tipoconcepto) {
    return res.status(400).json({ error: 'Debe indicar concepto y tipoconcepto' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM public.conceptos
       WHERE concepto = $1 AND tipoconcepto = $2`,
      [concepto, tipoconcepto]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Concepto no encontrado' });
    }

    res.json({ success: true, message: 'Concepto eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar concepto:', error);
    res.status(500).json({ error: 'Error al eliminar concepto' });
  }
};

module.exports = {
  listarConceptos,
  crearConcepto,
  obtenerConcepto,
  actualizarConcepto,
  eliminarConcepto
};
