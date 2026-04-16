// backend/controllers/diagnostico.controller.js
"use strict";

const pool = require("../db");
const scoringEngine = require("../src/modules/scoring/scoring.engine");

// Helper para validar operadores por tipo de pregunta
const VALID_OPERATORS = {
  NUMBER: ["GT", "GTE", "LT", "LTE", "RANGE", "EQ", "NEQ"],
  SELECT_SINGLE: ["EQ", "NEQ", "IN"],
  SELECT_MULTIPLE: ["IN", "CONTAINS"],
  STRING: ["EQ", "NEQ", "IN", "CONTAINS"]
};

function _mapQuestionType(tipoOriginal) {
  const t = String(tipoOriginal || "").toLowerCase().trim();
  if (['numero', 'integer', 'decimal', 'entero', 'float'].includes(t)) return 'NUMBER';
  if (['select', 'radio', 'semaforo', 'select_single'].includes(t)) return 'SELECT_SINGLE';
  if (['checkbox', 'multiselect', 'select_multiple'].includes(t)) return 'SELECT_MULTIPLE';
  return 'STRING';
}

/**
 * Controlador para la configuración del Motor de Scoring (Diagnóstico)
 */
async function getFormulaByPlantilla(req, res) {
  const { idPlantilla } = req.params;
  try {
    const formulaRes = await pool.query(
      `SELECT * FROM ema.formula WHERE id_plantilla = $1 AND activo = true ORDER BY version DESC LIMIT 1`,
      [idPlantilla]
    );

    if (formulaRes.rowCount === 0) {
      return res.json({ ok: true, formula: null, reglas: [], rangos: [] });
    }

    const formula = formulaRes.rows[0];

    const [reglasRes, rangosRes] = await Promise.all([
      pool.query(
        `SELECT * FROM ema.formula_regla WHERE id_formula = $1 AND activo = true ORDER BY orden ASC`,
        [formula.id_formula]
      ),
      pool.query(
        `SELECT * FROM ema.formula_rango WHERE id_formula = $1 ORDER BY min_valor ASC`,
        [formula.id_formula]
      ),
    ]);

    return res.json({
      ok: true,
      formula,
      reglas: reglasRes.rows,
      rangos: rangosRes.rows,
    });
  } catch (err) {
    console.error("getFormulaByPlantilla error:", err);
    return res.status(500).json({ ok: false, error: "Error al obtener configuración de diagnóstico" });
  }
}

async function saveFormula(req, res) {
  const { id_plantilla, nombre, activo, reglas, rangos } = req.body;
  const client = await pool.connect();

  // --- VALIDACIONES DE NEGOCIO ---
    
  // 1. Validar Operadores por Tipo de Pregunta
  const idsPreguntas = reglas.map(r => r.id_pregunta);
  if (idsPreguntas.length > 0) {
    const preguntasRes = await client.query(
      `SELECT id_pregunta, etiqueta, tipo FROM ema.informe_pregunta WHERE id_pregunta = ANY($1::int[])`,
      [idsPreguntas]
    );
    const pregMap = new Map(preguntasRes.rows.map(p => [p.id_pregunta, p]));
    
    for (const r of reglas) {
      const p = pregMap.get(Number(r.id_pregunta));
      const tipo = _mapQuestionType(p?.tipo);
      const validos = VALID_OPERATORS[tipo] || [];
      if (!validos.includes(r.operador)) {
        throw new Error(`Operador '${r.operador}' no es válido para pregunta '${p?.etiqueta}' de tipo ${tipo}`);
      }
    }
  }

  // 2. Validar Solapamiento de Rangos
  const sortedRangos = [...rangos].sort((a,b) => a.min_valor - b.min_valor);
  for (let i = 0; i < sortedRangos.length - 1; i++) {
      if (sortedRangos[i].max_valor > sortedRangos[i+1].min_valor) {
          throw new Error(`Solapamiento detectado entre rangos: ${sortedRangos[i].etiqueta_final} y ${sortedRangos[i+1].etiqueta_final}`);
      }
  }

  // --- PROCEDER CON GUARDADO ---

  try {
    await client.query("BEGIN");

    // 1. Obtener versión actual o crear nueva
    const currentRes = await client.query(
      `SELECT version FROM ema.formula WHERE id_plantilla = $1 ORDER BY version DESC LIMIT 1`,
      [id_plantilla]
    );

    let nextVersion = 1;
    if (currentRes.rowCount > 0) {
      nextVersion = currentRes.rows[0].version + 1;
      // Desactivar versiones anteriores
      await client.query(
        `UPDATE ema.formula SET activo = false WHERE id_plantilla = $1`,
        [id_plantilla]
      );
    }

    // 2. Insertar nueva cabecera de fórmula
    const formulaRes = await client.query(
      `INSERT INTO ema.formula (id_plantilla, nombre, version, activo)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id_plantilla, nombre || "Fórmula " + id_plantilla, nextVersion, activo !== false]
    );
    const formula = formulaRes.rows[0];

    // 3. Insertar Reglas
    if (Array.isArray(reglas) && reglas.length > 0) {
      for (const r of reglas) {
        await client.query(
          `INSERT INTO ema.formula_regla 
            (id_formula, id_pregunta, operador, valor_ref_1, valor_ref_2, puntos, etiqueta, orden)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            formula.id_formula,
            r.id_pregunta,
            r.operador,
            r.valor_ref_1,
            r.valor_ref_2 || null,
            r.puntos || 0,
            r.etiqueta,
            r.orden || 0,
          ]
        );
      }
    }

    // 4. Insertar Rangos
    if (Array.isArray(rangos) && rangos.length > 0) {
      for (const ra of rangos) {
        await client.query(
          `INSERT INTO ema.formula_rango 
            (id_formula, min_valor, max_valor, etiqueta_final, prioridad, color_hex)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            formula.id_formula,
            ra.min_valor,
            ra.max_valor,
            ra.etiqueta_final,
            ra.prioridad || 1,
            ra.color_hex || "#666666",
          ]
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ ok: true, id_formula: formula.id_formula, version: nextVersion });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("saveFormula error:", err);
    return res.status(500).json({ ok: false, error: "Error al guardar configuración de diagnóstico" });
  } finally {
    client.release();
  }
};

/**
 * Obtener detalle de scoring para un registro específico
 * GET /api/diagnostico/resultado/:idRegistro
 */
const getDetalleScoring = async (req, res) => {
  try {
    const { idRegistro } = req.params;
    const detalle = await scoringEngine.getDetalleRegistro(idRegistro);
    if (!detalle) {
      return res.status(404).json({ ok: false, message: "Resultado no encontrado para este registro" });
    }
    return res.json({ ok: true, data: detalle });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * Guardar evaluación manual (Override)
 * PATCH /api/diagnostico/override/:idRegistro
 */
async function saveScoringOverride(req, res) {
  const { idRegistro } = req.params;
  const { id_usuario_evaluador, manual_comment, resultado_consultor, manual_override } = req.body;
  const evaluatorId = id_usuario_evaluador === '' ? null : id_usuario_evaluador;
  
  try {
    const resUpdate = await pool.query(
      `UPDATE ema.formula_resultado 
       SET manual_override = $1,
           manual_comment = $2,
           resultado_consultor = $3,
           id_usuario_evaluador = $4,
           fecha_manual_evaluacion = CURRENT_TIMESTAMP,
           fecha_revision_usuario = CURRENT_TIMESTAMP,
           cambio_detectado = false
       WHERE id_registro = $5
       RETURNING *`,
      [manual_override !== false, manual_comment, resultado_consultor, evaluatorId, idRegistro]
    );


    // Si estamos desactivando el override manual, forzamos un recalculo 
    // para que el usuario vea el resultado automático actualizado.
    if (manual_override === false) {
      await scoringEngine.runScoring(idRegistro);
    }

    const finalResult = await pool.query(
      `SELECT * FROM ema.formula_resultado WHERE id_registro = $1`,
      [idRegistro]
    );

    return res.json({ ok: true, data: finalResult.rows[0] });
  } catch (err) {
    console.error("saveScoringOverride error:", err);
    return res.status(500).json({ ok: false, error: "Error al guardar evaluación manual" });
  }
}

/**
 * Evaluación Masiva de Fórmula para un Proyecto y Plantilla
 * POST /api/diagnostico/evaluar-plantilla
 */
async function evaluarPlantilla(req, res) {
  const { id_proyecto, id_plantilla, modo } = req.body;
  if (!id_proyecto || !id_plantilla) {
    return res.status(400).json({ ok: false, error: "Faltan parámetros id_proyecto o id_plantilla" });
  }

  const client = await pool.connect();
  try {
    // 1. Carga de Configuración (Performance: Cache en memoria)
    const formulaRes = await client.query(
      `SELECT * FROM ema.formula WHERE id_plantilla = $1 AND activo = true ORDER BY version DESC LIMIT 1`,
      [id_plantilla]
    );
    if (formulaRes.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "No hay una fórmula activa para esta plantilla" });
    }
    const formula = formulaRes.rows[0];
    const [reglasRes, rangosRes] = await Promise.all([
      client.query(`SELECT * FROM ema.formula_regla WHERE id_formula = $1 AND activo = true ORDER BY orden ASC`, [formula.id_formula]),
      client.query(`SELECT * FROM ema.formula_rango WHERE id_formula = $1 ORDER BY prioridad DESC`, [formula.id_formula])
    ]);
    const config = { formula, reglas: reglasRes.rows, rangos: rangosRes.rows };

    // 2. Obtener informes
    const informesRes = await client.query(
      `SELECT id_informe FROM ema.informe WHERE id_proyecto = $1 AND id_plantilla = $2`,
      [id_proyecto, id_plantilla]
    );
    const informes = informesRes.rows;

    let stats = {
      total_registros: informes.length,
      procesados: 0,
      ignorados_override: 0,
      con_cambios: 0,
      sin_cambios: 0,
      errores: 0
    };

    // 3. Procesamiento en Loop con Batch Updates implicitos vía ScoringEngine
    for (const inf of informes) {
      try {
        // Asegurar id_registro (UPSERT)
        const regRes = await client.query(
          `INSERT INTO ema.informe_registro (id_informe) 
           VALUES ($1) 
           ON CONFLICT (id_informe) DO UPDATE SET id_informe = EXCLUDED.id_informe
           RETURNING id_registro`,
          [inf.id_informe]
        );
        const idRegistro = regRes.rows[0].id_registro;

        // Ejecutar Scoring
        const result = await scoringEngine.runScoring(idRegistro, client, config);

        if (!result) {
            stats.errores++;
            continue;
        }

        if (result.skipped) {
          stats.ignorados_override++;
          continue;
        }

        stats.procesados++;
        if (result.cambio_detectado) stats.con_cambios++;
        else stats.sin_cambios++;

      } catch (e) {
        console.error(`Error procesando informe ${inf.id_informe}:`, e);
        stats.errores++;
      }
    }

    return res.json({ ok: true, stats });
  } catch (err) {
    console.error("evaluarPlantilla error:", err);
    return res.status(500).json({ ok: false, error: "Error en evaluación masiva" });
  } finally {
    client.release();
  }
}

/**
 * Evaluación Individual (manual trigger desde listado)
 * POST /api/diagnostico/evaluar-individual/:idInforme
 */
async function evaluarIndividual(req, res) {
  const { idInforme } = req.params;
  const client = await pool.connect();
  try {
    // 1. Asegurar id_registro
    const regRes = await client.query(
      `INSERT INTO ema.informe_registro (id_informe) 
       VALUES ($1) 
       ON CONFLICT (id_informe) DO UPDATE SET id_informe = EXCLUDED.id_informe
       RETURNING id_registro`,
      [idInforme]
    );
    const idRegistro = regRes.rows[0].id_registro;

    // 2. Ejecutar scoring
    const result = await scoringEngine.runScoring(idRegistro, client);
    
    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error("evaluarIndividual error:", err);
    return res.status(500).json({ ok: false, error: "Error en evaluación individual" });
  } finally {
    client.release();
  }
}

module.exports = {
  getFormulaByPlantilla,
  saveFormula,
  getDetalleScoring,
  saveScoringOverride,
  evaluarPlantilla,
  evaluarIndividual,
  marcarRevisado,
  resetCambios,
};

async function marcarRevisado(req, res) {
  const { idRegistro } = req.params;
  try {
    await pool.query(
      `UPDATE ema.formula_resultado 
       SET fecha_revision_usuario = CURRENT_TIMESTAMP,
           cambio_detectado = false
       WHERE id_registro = $1`,
      [idRegistro]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function resetCambios(req, res) {
  const { id_proyecto, id_plantilla } = req.body;

  if (!id_proyecto || !id_plantilla) {
    return res.status(400).json({ ok: false, error: "id_proyecto e id_plantilla son requeridos para resetear cambios." });
  }

  try {
    // Marcamos todos los resultados de este proyecto + plantilla como NO cambiados
    const resUpdate = await pool.query(
      `UPDATE ema.formula_resultado fr
       SET cambio_detectado = false,
           fecha_revision_usuario = CURRENT_TIMESTAMP
       FROM ema.informe_registro ir
       JOIN ema.informe i ON i.id_informe = ir.id_informe
       WHERE fr.id_registro = ir.id_registro
         AND i.id_proyecto = $1
         AND i.id_plantilla = $2`,
      [id_proyecto, id_plantilla]
    );
    
    console.log(`[Audit] resetCambios ejecutado: Proyecto ${id_proyecto}, Plantilla ${id_plantilla}. Filas afectadas: ${resUpdate.rowCount}`);
    
    res.json({ ok: true, afectadas: resUpdate.rowCount });
  } catch (err) {
    console.error("[Audit Error] resetCambios:", err);
    res.status(500).json({ ok: false, error: "Error al resetear cambios detectados." });
  }
}
