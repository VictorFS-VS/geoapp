// controllers/reportes.controller.js
const pool = require("../db");

function asInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function pickRespuesta(row) {
  if (!row) return null;
  if (row.valor_json !== null && row.valor_json !== undefined) return row.valor_json;
  if (row.valor_texto !== null && row.valor_texto !== undefined) return row.valor_texto;
  if (row.valor_bool !== null && row.valor_bool !== undefined) return row.valor_bool;
  return null;
}

/**
 * ✅ Normaliza valores para JSONB evitando undefined
 */
function normalizeJsonb(v) {
  if (v === undefined) return null;
  return v;
}

/**
 * ✅ contenido DEBE ser objeto en DB.
 * Acepta:
 * - objeto -> OK
 * - string plano -> { texto: string }
 * - otros tipos -> { respuesta: v }
 * - string JSON válido -> se parsea y se guarda como objeto/valor
 */
function normalizeContenido(v, { prefer = "texto" } = {}) {
  if (v === undefined) return null;

  if (v && typeof v === "object") return v;

  if (typeof v === "string") {
    const s = v.trim();

    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]")) ||
      s === "null" ||
      s === "true" ||
      s === "false" ||
      /^-?\d+(\.\d+)?$/.test(s) ||
      (s.startsWith('"') && s.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object") return parsed;
        return { respuesta: parsed };
      } catch {
        // sigue abajo
      }
    }

    if (prefer === "texto") return { texto: v };
    return { respuesta: v };
  }

  return { respuesta: v };
}

/* =========================================================
   SNAPSHOT (modo viejo: 1 informe)
   ========================================================= */
async function snapshotFromInforme(client, { idInforme, creadoPor }) {
  // 1) Traer informe base
  const infQ = await client.query(
    `SELECT id_informe, id_plantilla, id_proyecto, COALESCE(titulo,'') AS titulo
     FROM ema.informe
     WHERE id_informe = $1::int`,
    [idInforme]
  );

  if (infQ.rowCount === 0) {
    const err = new Error("No existe el informe base.");
    err.status = 404;
    throw err;
  }

  const informe = infQ.rows[0];

  // 2) Crear cabecera de reporte
  const repQ = await client.query(
    `INSERT INTO ema.reporte
      (id_proyecto, id_plantilla, titulo, descripcion, estado, fuente, fuente_ref, creado_por)
     VALUES
      ($1::int, $2::int, $3::varchar, NULL, 'borrador', 'informe',
       jsonb_build_object('id_informe', $4::int), $5::int)
     RETURNING id_reporte`,
    [informe.id_proyecto, informe.id_plantilla, informe.titulo, informe.id_informe, creadoPor]
  );

  const idReporte = repQ.rows[0].id_reporte;

  // 3) Copiar secciones
  const secQ = await client.query(
    `SELECT id_seccion, titulo, orden, visible_if, hide_if
     FROM ema.informe_seccion
     WHERE id_plantilla = $1::int
     ORDER BY orden ASC`,
    [informe.id_plantilla]
  );

  const seccionMap = new Map();
  for (const s of secQ.rows) {
    const insS = await client.query(
      `INSERT INTO ema.reporte_seccion
        (id_reporte, id_seccion_origen, titulo, orden, visible_if, hide_if)
       VALUES
        ($1::int, $2::int, $3::varchar, $4::int, $5::jsonb, $6::jsonb)
       RETURNING id_reporte_seccion`,
      [
        idReporte,
        s.id_seccion,
        s.titulo,
        s.orden,
        normalizeJsonb(s.visible_if),
        normalizeJsonb(s.hide_if),
      ]
    );
    seccionMap.set(s.id_seccion, insS.rows[0].id_reporte_seccion);
  }

  // 4) Traer preguntas
  const pregQ = await client.query(
    `SELECT p.id_pregunta, p.id_seccion, p.etiqueta, p.tipo,
            p.obligatorio, p.orden, p.permite_foto, p.activo
     FROM ema.informe_pregunta p
     JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
     WHERE s.id_plantilla = $1::int
       AND p.activo = true
     ORDER BY s.orden ASC, p.orden ASC`,
    [informe.id_plantilla]
  );

  // 5) Traer respuestas del informe
  const respQ = await client.query(
    `SELECT id_pregunta, valor_texto, valor_bool, valor_json
     FROM ema.informe_respuesta
     WHERE id_informe = $1::int`,
    [informe.id_informe]
  );

  const respMap = new Map();
  for (const r of respQ.rows) respMap.set(r.id_pregunta, r);

  // 6) Insertar bloques
  for (const p of pregQ.rows) {
    const idReporteSeccion = seccionMap.get(p.id_seccion);
    if (!idReporteSeccion) continue;

    const r = respMap.get(p.id_pregunta);
    const respuesta = pickRespuesta(r);

    const contenido = {
      original: respuesta,
      respuesta,
      obs: "",
      formato: {},
      coordenadas: null,
      imagenes: [],
    };

    await client.query(
      `INSERT INTO ema.reporte_bloque
        (id_reporte, id_reporte_seccion, tipo, origen, id_pregunta_origen,
         etiqueta, pregunta_tipo, obligatorio, permite_foto,
         contenido, config_grafico, oculto, orden)
       VALUES
        ($1::int, $2::int, 'pregunta', 'plantilla', $3::int,
         $4::varchar, $5::varchar, $6::boolean, $7::boolean,
         $8::jsonb, NULL, false, $9::int)`,
      [
        idReporte,
        idReporteSeccion,
        p.id_pregunta,
        p.etiqueta,
        p.tipo,
        !!p.obligatorio,
        !!p.permite_foto,
        contenido,
        p.orden,
      ]
    );
  }

  return idReporte;
}

/* =========================================================
   NUEVO: AGREGADO (reporte general de todos los informes)
   ========================================================= */
function isAnsweredValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function addExample(arr, value, max = 6) {
  if (arr.length >= max) return;

  let s = "";
  try {
    s = typeof value === "string" ? value.trim() : JSON.stringify(value);
  } catch {
    s = String(value);
  }

  if (!s) return;
  if (arr.includes(s)) return;

  arr.push(s.length > 160 ? s.slice(0, 157) + "…" : s);
}

function inc(obj, key) {
  const k = String(key);
  obj[k] = (obj[k] || 0) + 1;
}

async function snapshotFromProyectoAgregado(client, { idProyecto, idPlantilla, creadoPor, tituloReporte }) {
  // 1) Secciones de la plantilla
  const secQ = await client.query(
    `SELECT id_seccion, titulo, orden, visible_if, hide_if
     FROM ema.informe_seccion
     WHERE id_plantilla = $1::int
     ORDER BY orden ASC`,
    [idPlantilla]
  );

  if (secQ.rowCount === 0) {
    const err = new Error("La plantilla no tiene secciones o no existe.");
    err.status = 404;
    throw err;
  }

  // 2) Preguntas activas de la plantilla
  const pregQ = await client.query(
    `SELECT p.id_pregunta, p.id_seccion, p.etiqueta, p.tipo, p.opciones_json,
            p.obligatorio, p.orden, p.permite_foto, p.activo
     FROM ema.informe_pregunta p
     JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
     WHERE s.id_plantilla = $1::int
       AND p.activo = true
     ORDER BY s.orden ASC, p.orden ASC`,
    [idPlantilla]
  );

  const preguntas = pregQ.rows;

  // 3) Todos los informes (censados) del proyecto para esa plantilla
  const infsQ = await client.query(
    `SELECT id_informe, COALESCE(titulo,'') AS titulo, fecha_creado
     FROM ema.informe
     WHERE id_proyecto = $1::int AND id_plantilla = $2::int
     ORDER BY fecha_creado DESC, id_informe DESC`,
    [idProyecto, idPlantilla]
  );

  const informes = infsQ.rows;
  const ids = informes.map((x) => x.id_informe);

  if (ids.length === 0) {
    const err = new Error("El proyecto no tiene informes para esa plantilla.");
    err.status = 404;
    throw err;
  }

  // 4) Respuestas de todos los informes (1 query)
  const respQ = await client.query(
    `SELECT id_informe, id_pregunta, valor_texto, valor_bool, valor_json
     FROM ema.informe_respuesta
     WHERE id_informe = ANY($1::int[])`,
    [ids]
  );

  // 5) Fotos totales (opcional)
  let totalFotos = 0;
  try {
    const fotosQ = await client.query(
      `SELECT COUNT(*)::int AS fotos
       FROM ema.informe_foto
       WHERE id_informe = ANY($1::int[])`,
      [ids]
    );
    totalFotos = fotosQ.rows[0]?.fotos || 0;
  } catch {
    totalFotos = 0;
  }

  // 6) Agregación por pregunta
  // statsByPregunta[id_pregunta] = { total_informes, respondidas, vacias, distribucion, ejemplos }
  const statsByPregunta = new Map();
  for (const p of preguntas) {
    statsByPregunta.set(p.id_pregunta, {
      modo: "agregado",
      tipo: p.tipo,
      total_informes: ids.length,
      respondidas: 0,
      vacias: 0,
      distribucion: {},
      ejemplos: [],
    });
  }

  for (const r of respQ.rows) {
    const v = pickRespuesta(r);
    const st = statsByPregunta.get(r.id_pregunta);
    if (!st) continue;

    if (isAnsweredValue(v)) {
      st.respondidas += 1;

      // ejemplos
      addExample(st.ejemplos, v, 6);

      // distribución
      if (typeof v === "boolean") {
        inc(st.distribucion, v ? "SI" : "NO");
      } else if (typeof v === "number") {
        inc(st.distribucion, "NUM");
      } else if (typeof v === "string") {
        const s = v.trim();
        if (s.length <= 32) inc(st.distribucion, s);
        else inc(st.distribucion, "TEXTO");
      } else if (Array.isArray(v)) {
        for (const item of v) inc(st.distribucion, item);
      } else if (v && typeof v === "object") {
        inc(st.distribucion, "OBJ");
      } else {
        inc(st.distribucion, "OTRO");
      }
    }
  }

  // vacías por pregunta
  for (const st of statsByPregunta.values()) {
    st.vacias = Math.max(0, st.total_informes - st.respondidas);
  }

  // 7) Cabecera de reporte (fuente: agregado)
  const titulo = tituloReporte || `Reporte general (${ids.length} censados)`;

  const repQ = await client.query(
    `INSERT INTO ema.reporte
      (id_proyecto, id_plantilla, titulo, descripcion, estado, fuente, fuente_ref, creado_por)
     VALUES
      ($1::int, $2::int, $3::varchar, NULL, 'borrador', 'agregado',
       jsonb_build_object('id_proyecto',$1::int,'id_plantilla',$2::int,'total_informes',$4::int,'fotos',$5::int),
       $6::int)
     RETURNING id_reporte`,
    [idProyecto, idPlantilla, titulo, ids.length, totalFotos, creadoPor]
  );

  const idReporte = repQ.rows[0].id_reporte;

  // 8) Copiar secciones al reporte
  const seccionMap = new Map();
  for (const s of secQ.rows) {
    const insS = await client.query(
      `INSERT INTO ema.reporte_seccion
        (id_reporte, id_seccion_origen, titulo, orden, visible_if, hide_if)
       VALUES
        ($1::int, $2::int, $3::varchar, $4::int, $5::jsonb, $6::jsonb)
       RETURNING id_reporte_seccion`,
      [
        idReporte,
        s.id_seccion,
        s.titulo,
        s.orden,
        normalizeJsonb(s.visible_if),
        normalizeJsonb(s.hide_if),
      ]
    );
    seccionMap.set(s.id_seccion, insS.rows[0].id_reporte_seccion);
  }

  // 9) Insertar bloques con contenido agregado
  for (const p of preguntas) {
    const idReporteSeccion = seccionMap.get(p.id_seccion);
    if (!idReporteSeccion) continue;

    const st = statsByPregunta.get(p.id_pregunta);

    const contenido = {
      modo: "agregado",
      stats: st,
      texto: "", // análisis/conclusión editable
      obs: "",
      formato: {},
    };

    await client.query(
      `INSERT INTO ema.reporte_bloque
        (id_reporte, id_reporte_seccion, tipo, origen, id_pregunta_origen,
         etiqueta, pregunta_tipo, obligatorio, permite_foto,
         contenido, config_grafico, oculto, orden)
       VALUES
        ($1::int, $2::int, 'pregunta', 'agregado', $3::int,
         $4::varchar, $5::varchar, $6::boolean, $7::boolean,
         $8::jsonb, NULL, false, $9::int)`,
      [
        idReporte,
        idReporteSeccion,
        p.id_pregunta,
        p.etiqueta,
        p.tipo,
        !!p.obligatorio,
        !!p.permite_foto,
        contenido,
        p.orden,
      ]
    );
  }

  // 10) Resumen global para UI (guía agregada)
  const totalPreguntas = preguntas.length;
  const totalCeldas = totalPreguntas * ids.length;

  let totalRespondidas = 0;
  for (const st of statsByPregunta.values()) totalRespondidas += st.respondidas;

  const porcentaje = totalCeldas ? Math.round((totalRespondidas / totalCeldas) * 100) : 0;

  const guia_agregada = {
    modo: "agregado",
    id_proyecto: idProyecto,
    id_plantilla: idPlantilla,
    total_informes: ids.length,
    total_preguntas: totalPreguntas,
    total_celdas: totalCeldas,
    respondidas: totalRespondidas,
    vacias: Math.max(0, totalCeldas - totalRespondidas),
    porcentaje,
    fotos: totalFotos,
  };

  return { idReporte, guia_agregada };
}

/* =========================
   ENDPOINTS
   ========================= */

exports.createFromProyecto = async (req, res) => {
  const idProyecto = asInt(req.params.idProyecto);
  const creadoPor = req.user?.id || req.user?.userId || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const infQ = await client.query(
      `SELECT id_informe
       FROM ema.informe
       WHERE id_proyecto = $1::int
       ORDER BY fecha_creado DESC, id_informe DESC
       LIMIT 1`,
      [idProyecto]
    );

    if (infQ.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "El proyecto no tiene informes para generar el reporte.",
      });
    }

    const idInforme = infQ.rows[0].id_informe;
    const idReporte = await snapshotFromInforme(client, { idInforme, creadoPor });

    await client.query("COMMIT");
    return res.json({ ok: true, id_reporte: idReporte, id_informe_base: idInforme });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createFromProyecto error:", err);
    return res
      .status(err.status || 500)
      .json({ ok: false, error: err.message || "Error creando reporte" });
  } finally {
    client.release();
  }
};

/**
 * ✅ NUEVO: crea un reporte general (AGREGADO) de todos los censados del proyecto
 * POST /api/reportes/from-proyecto-agregado/:idProyecto?id_plantilla=3&titulo=...
 */
exports.createFromProyectoAgregado = async (req, res) => {
  const idProyecto = asInt(req.params.idProyecto);
  const creadoPor = req.user?.id || req.user?.userId || null;
  const idPlantilla = asInt(req.query.id_plantilla);
  const titulo = (req.query.titulo || "").trim() || null;

  if (!idProyecto) return res.status(400).json({ ok: false, error: "Falta idProyecto" });
  if (!idPlantilla) return res.status(400).json({ ok: false, error: "Falta query ?id_plantilla=ID" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { idReporte, guia_agregada } = await snapshotFromProyectoAgregado(client, {
      idProyecto,
      idPlantilla,
      creadoPor,
      tituloReporte: titulo,
    });

    await client.query("COMMIT");
    return res.json({ ok: true, id_reporte: idReporte, guia_agregada });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createFromProyectoAgregado error:", err);
    return res
      .status(err.status || 500)
      .json({ ok: false, error: err.message || "Error creando reporte agregado" });
  } finally {
    client.release();
  }
};

exports.createFromInforme = async (req, res) => {
  const idInforme = asInt(req.params.idInforme);
  const creadoPor = req.user?.id || req.user?.userId || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const idReporte = await snapshotFromInforme(client, { idInforme, creadoPor });
    await client.query("COMMIT");
    return res.json({ ok: true, id_reporte: idReporte, id_informe_base: idInforme });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("createFromInforme error:", err);
    return res
      .status(err.status || 500)
      .json({ ok: false, error: err.message || "Error creando reporte" });
  } finally {
    client.release();
  }
};

exports.list = async (req, res) => {
  const idProyecto = asInt(req.query.proyecto);
  if (!idProyecto) return res.status(400).json({ ok: false, error: "Falta query ?proyecto=ID" });

  try {
    const q = await pool.query(
      `SELECT id_reporte, id_proyecto, id_plantilla, titulo, estado, fuente, fuente_ref, fecha_creado, fecha_editado
       FROM ema.reporte
       WHERE id_proyecto = $1::int
       ORDER BY fecha_creado DESC, id_reporte DESC`,
      [idProyecto]
    );
    return res.json({ ok: true, reportes: q.rows });
  } catch (err) {
    console.error("list reportes error:", err);
    return res.status(500).json({ ok: false, error: "Error listando reportes" });
  }
};

exports.getOne = async (req, res) => {
  const idReporte = asInt(req.params.idReporte);

  try {
    const repQ = await pool.query(`SELECT * FROM ema.reporte WHERE id_reporte = $1::int`, [idReporte]);
    if (repQ.rowCount === 0) return res.status(404).json({ ok: false, error: "Reporte no encontrado" });

    const reporte = repQ.rows[0];

    const secQ = await pool.query(
      `SELECT *
       FROM ema.reporte_seccion
       WHERE id_reporte = $1::int
       ORDER BY orden ASC, id_reporte_seccion ASC`,
      [idReporte]
    );

    const bloQ = await pool.query(
      `SELECT *
       FROM ema.reporte_bloque
       WHERE id_reporte = $1::int
       ORDER BY id_reporte_seccion ASC, orden ASC, id_bloque ASC`,
      [idReporte]
    );

    const assQ = await pool.query(
      `SELECT *
       FROM ema.reporte_asset
       WHERE id_reporte = $1::int
       ORDER BY orden ASC, id_asset ASC`,
      [idReporte]
    );

    // ✅ GUIA (según fuente)
    let informe_base = null;
    let guia_agregada = null;

    // fuente: informe (viejo)
    if (reporte?.fuente === "informe") {
      try {
        const idInformeBase = reporte?.fuente_ref?.id_informe;

        if (idInformeBase) {
          const totQ = await pool.query(
            `
            SELECT COUNT(p.id_pregunta)::int AS total_preguntas
            FROM ema.informe_pregunta p
            JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
            WHERE s.id_plantilla = $1::int AND p.activo = true
            `,
            [reporte.id_plantilla]
          );

          const respCountQ = await pool.query(
            `
            SELECT COUNT(*)::int AS respondidas
            FROM ema.informe_respuesta r
            WHERE r.id_informe = $1::int
              AND (
                r.valor_json IS NOT NULL
                OR r.valor_bool IS NOT NULL
                OR (r.valor_texto IS NOT NULL AND btrim(r.valor_texto) <> '')
              )
            `,
            [idInformeBase]
          );

          let fotos = 0;
          try {
            const fotosQ = await pool.query(
              `SELECT COUNT(*)::int AS fotos FROM ema.informe_foto WHERE id_informe = $1::int`,
              [idInformeBase]
            );
            fotos = fotosQ.rows[0]?.fotos || 0;
          } catch {
            fotos = 0;
          }

          const infMeta = await pool.query(
            `SELECT id_informe, id_proyecto, id_plantilla, COALESCE(titulo,'') AS titulo, fecha_creado, creado_por
             FROM ema.informe
             WHERE id_informe = $1::int`,
            [idInformeBase]
          );

          const total = totQ.rows[0]?.total_preguntas || 0;
          const respondidas = respCountQ.rows[0]?.respondidas || 0;
          const vacias = Math.max(0, total - respondidas);
          const porcentaje = total ? Math.round((respondidas / total) * 100) : 0;

          informe_base = {
            meta: infMeta.rows[0] || null,
            total_preguntas: total,
            respondidas,
            vacias,
            porcentaje,
            fotos,
          };
        }
      } catch (e) {
        console.warn("No se pudo armar informe_base:", e?.message || e);
        informe_base = null;
      }
    }

    // fuente: agregado (nuevo)
    if (reporte?.fuente === "agregado") {
      try {
        const total_informes = asInt(reporte?.fuente_ref?.total_informes, 0);
        const fotos = asInt(reporte?.fuente_ref?.fotos, 0);

        const total_preguntas = bloQ.rows.filter((b) => b.tipo === "pregunta" && !!b.id_pregunta_origen).length;
        const total_celdas = total_informes * total_preguntas;

        let respondidas = 0;
        for (const b of bloQ.rows) {
          const st = b?.contenido?.stats;
          if (st && Number.isFinite(Number(st.respondidas))) respondidas += Number(st.respondidas);
        }

        const vacias = Math.max(0, total_celdas - respondidas);
        const porcentaje = total_celdas ? Math.round((respondidas / total_celdas) * 100) : 0;

        guia_agregada = {
          modo: "agregado",
          total_informes,
          total_preguntas,
          total_celdas,
          respondidas,
          vacias,
          porcentaje,
          fotos,
        };
      } catch (e) {
        console.warn("No se pudo armar guia_agregada:", e?.message || e);
        guia_agregada = null;
      }
    }

    return res.json({
      ok: true,
      reporte,
      secciones: secQ.rows,
      bloques: bloQ.rows,
      assets: assQ.rows,
      informe_base,
      guia_agregada,
    });
  } catch (err) {
    console.error("getOne reporte error:", err);
    return res.status(500).json({ ok: false, error: "Error obteniendo reporte" });
  }
};

exports.updateHeader = async (req, res) => {
  const idReporte = asInt(req.params.idReporte);
  const { titulo, descripcion, estado } = req.body || {};

  try {
    const q = await pool.query(
      `UPDATE ema.reporte
       SET titulo = COALESCE($2::varchar, titulo),
           descripcion = COALESCE($3::text, descripcion),
           estado = COALESCE($4::varchar, estado),
           fecha_editado = now()
       WHERE id_reporte = $1::int
       RETURNING *`,
      [idReporte, titulo ?? null, descripcion ?? null, estado ?? null]
    );

    if (q.rowCount === 0) return res.status(404).json({ ok: false, error: "Reporte no encontrado" });
    return res.json({ ok: true, reporte: q.rows[0] });
  } catch (err) {
    console.error("updateHeader error:", err);
    return res.status(500).json({ ok: false, error: "Error actualizando cabecera" });
  }
};

exports.updateBloque = async (req, res) => {
  const idReporte = asInt(req.params.idReporte);
  const idBloque = asInt(req.params.idBloque);

  const { contenido, config_grafico, oculto, orden, etiqueta } = req.body || {};

  const contNorm = contenido !== undefined ? normalizeContenido(contenido, { prefer: "texto" }) : undefined;
  const grafNorm = config_grafico !== undefined ? normalizeJsonb(config_grafico) : undefined;

  try {
    const q = await pool.query(
      `UPDATE ema.reporte_bloque
       SET contenido = COALESCE($3::jsonb, contenido),
           config_grafico = COALESCE($4::jsonb, config_grafico),
           oculto = COALESCE($5::boolean, oculto),
           orden = COALESCE($6::int, orden),
           etiqueta = COALESCE($7::varchar, etiqueta),
           editado_en = now()
       WHERE id_reporte = $1::int AND id_bloque = $2::int
       RETURNING *`,
      [
        idReporte,
        idBloque,
        contNorm !== undefined ? contNorm : null,
        grafNorm !== undefined ? grafNorm : null,
        typeof oculto === "boolean" ? oculto : null,
        Number.isFinite(Number(orden)) ? Number(orden) : null,
        etiqueta ?? null,
      ]
    );

    if (q.rowCount === 0) return res.status(404).json({ ok: false, error: "Bloque no encontrado" });
    return res.json({ ok: true, bloque: q.rows[0] });
  } catch (err) {
    console.error("updateBloque error:", err);
    return res.status(500).json({ ok: false, error: "Error actualizando bloque" });
  }
};

exports.addBloqueManual = async (req, res) => {
  const idReporte = asInt(req.params.idReporte);
  const idReporteSeccion = asInt(req.params.idReporteSeccion);

  const { tipo, etiqueta, contenido, config_grafico, orden } = req.body || {};
  if (!tipo) return res.status(400).json({ ok: false, error: "Falta tipo de bloque" });

  const contNorm = normalizeContenido(contenido ?? { texto: "" }, { prefer: "texto" });
  const grafNorm = config_grafico !== undefined ? normalizeJsonb(config_grafico) : null;

  try {
    const q = await pool.query(
      `INSERT INTO ema.reporte_bloque
        (id_reporte, id_reporte_seccion, tipo, origen, etiqueta, contenido, config_grafico, orden)
       VALUES
        ($1::int, $2::int, $3::varchar, 'manual', $4::varchar, $5::jsonb, $6::jsonb, COALESCE($7::int, 1))
       RETURNING *`,
      [
        idReporte,
        idReporteSeccion,
        tipo,
        etiqueta ?? null,
        contNorm,
        grafNorm,
        Number.isFinite(Number(orden)) ? Number(orden) : 1,
      ]
    );

    return res.json({ ok: true, bloque: q.rows[0] });
  } catch (err) {
    console.error("addBloqueManual error:", err);
    return res.status(500).json({ ok: false, error: "Error agregando bloque manual" });
  }
};

exports.deleteBloque = async (req, res) => {
  const idReporte = asInt(req.params.idReporte);
  const idBloque = asInt(req.params.idBloque);

  try {
    const q = await pool.query(
      `DELETE FROM ema.reporte_bloque
       WHERE id_reporte = $1::int AND id_bloque = $2::int
       RETURNING id_bloque`,
      [idReporte, idBloque]
    );

    if (q.rowCount === 0) return res.status(404).json({ ok: false, error: "Bloque no encontrado" });
    return res.json({ ok: true, deleted: q.rows[0].id_bloque });
  } catch (err) {
    console.error("deleteBloque error:", err);
    return res.status(500).json({ ok: false, error: "Error eliminando bloque" });
  }
};
