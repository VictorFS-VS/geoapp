// backend/src/modules/scoring/scoring.engine.js
const pool = require("../../../db");

/**
 * Motor de Scoring Dinámico (V1.2)
 * Fixes:
 *  - _normalizeValue no confunde valor_bool=false con ausencia de dato numérico
 *  - getDetalleRegistro enriquece detalle_json al vuelo con etiquetas/valores actuales
 */
class ScoringEngine {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 1000 * 60 * 5;
  }

  async runScoring(idRegistro, client = pool, preConfig = null) {
    try {
      // 0. Resultado previo para comparar cambios
      const prevResultRes = await client.query(
        `SELECT score_total, clasificacion FROM ema.formula_resultado WHERE id_registro = $1`,
        [idRegistro]
      );
      const prevResult = prevResultRes.rowCount > 0 ? prevResultRes.rows[0] : null;

      // 1. Check override manual
      const checkOverride = await client.query(
        `SELECT manual_override FROM ema.formula_resultado WHERE id_registro = $1`,
        [idRegistro]
      );
      if (checkOverride.rowCount > 0 && checkOverride.rows[0].manual_override) {
        return { skipped: true, reason: 'manual_override' };
      }

      // 1.1 Contexto del registro
      const regRes = await client.query(
        `SELECT r.id_registro, r.id_informe, i.id_plantilla 
         FROM ema.informe_registro r
         JOIN ema.informe i ON i.id_informe = r.id_informe
         WHERE r.id_registro = $1`,
        [idRegistro]
      );
      if (regRes.rowCount === 0) return null;
      const { id_plantilla, id_informe } = regRes.rows[0];

      // 2. Preguntas de la plantilla
      const allPreguntasRes = await client.query(
        `SELECT p.id_pregunta, p.etiqueta, p.tipo 
         FROM ema.informe_pregunta p
         JOIN ema.informe_seccion s ON s.id_seccion = p.id_seccion
         WHERE s.id_plantilla = $1`,
        [id_plantilla]
      );
      const preguntasMetadata = {};
      for (const p of allPreguntasRes.rows) {
        preguntasMetadata[p.id_pregunta] = {
          etiqueta: p.etiqueta,
          tipo: this._mapQuestionType(p.tipo)
        };
      }

      // 3. Respuestas del informe
      const respsRes = await client.query(
        `SELECT id_pregunta, valor_texto, valor_bool, valor_json
         FROM ema.informe_respuesta 
         WHERE id_informe = $1`,
        [id_informe]
      );
      const respuestasMap = {};
      for (const row of respsRes.rows) {
        respuestasMap[row.id_pregunta] = row;
      }

      // 4. Configuración de fórmula
      const config = preConfig || await this._getFormulaConfig(id_plantilla, client);
      if (!config) return null;
      const { formula, reglas, rangos } = config;

      // 5. Evaluar reglas
      let scoreTotal = 0;
      const etiquetas = [];
      const detalle = [];

      for (const regla of reglas) {
        const meta = preguntasMetadata[regla.id_pregunta] || {};
        const qLabel = meta.etiqueta || `Pregunta ${regla.id_pregunta}`;
        const qTipo = meta.tipo || 'STRING';

        const respRow = respuestasMap[regla.id_pregunta];
        const valorRespondido = this._normalizeValue(respRow, qTipo);

        const cumplida = this._evaluarConTipado(regla, valorRespondido, qTipo);
        const puntosAplicados = cumplida ? (parseFloat(regla.puntos) || 0) : 0;

        if (cumplida) {
          scoreTotal += puntosAplicados;
          if (regla.etiqueta) etiquetas.push(regla.etiqueta);
        }

        detalle.push({
          id_regla: regla.id_regla,
          id_pregunta: regla.id_pregunta,
          pregunta_label: qLabel,
          puntos_aplicados: puntosAplicados,
          condicion_cumplida: cumplida,
          operador: regla.operador,
          valor_ref: regla.operador === 'RANGE'
            ? `${regla.valor_ref_1} y ${regla.valor_ref_2}`
            : regla.valor_ref_1,
          valor_respuesta: this._getReadableValue(respRow, qTipo)
        });
      }

      const clasificacion = this.calcularClasificacion(scoreTotal, rangos);

      // 6. Cambios
      let cambio_detectado = false;
      if (prevResult) {
        const scoreDiff = Math.abs(parseFloat(prevResult.score_total) - scoreTotal) > 0.01;
        const classDiff = prevResult.clasificacion !== clasificacion;
        cambio_detectado = scoreDiff || classDiff;
      }

      // 7. Persistir
      await client.query(
        `INSERT INTO ema.formula_resultado 
          (id_registro, id_formula, score_total, etiquetas_json, reglas_json, detalle_json, clasificacion, version_formula, fecha_calculo, cambio_detectado, fecha_recalculo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9, CURRENT_TIMESTAMP)
        ON CONFLICT (id_registro, id_formula) DO UPDATE SET
          score_total = EXCLUDED.score_total,
          etiquetas_json = EXCLUDED.etiquetas_json,
          reglas_json = EXCLUDED.reglas_json,
          detalle_json = EXCLUDED.detalle_json,
          clasificacion = EXCLUDED.clasificacion,
          version_formula = EXCLUDED.version_formula,
          fecha_calculo = EXCLUDED.fecha_calculo,
          cambio_detectado = EXCLUDED.cambio_detectado,
          fecha_recalculo = CURRENT_TIMESTAMP
        WHERE ema.formula_resultado.manual_override = false`,
        [
          idRegistro,
          formula.id_formula,
          scoreTotal,
          JSON.stringify(etiquetas),
          JSON.stringify(detalle.filter(d => d.condicion_cumplida)),
          JSON.stringify(detalle),
          clasificacion,
          formula.version,
          cambio_detectado
        ]
      );

      return { scoreTotal, clasificacion, etiquetas, cambio_detectado };
    } catch (err) {
      console.error(`[Scoring Engine] Error registro ${idRegistro}:`, err.message);
      return null;
    }
  }

  /**
   * Obtiene el detalle para la UI, enriqueciéndolo al vuelo.
   * Garantiza que registros con detalle_json viejo muestren etiquetas y valores correctos.
   */
  async getDetalleRegistro(idRegistro) {
    const res = await pool.query(
      `SELECT fr.score_total, fr.clasificacion, fr.etiquetas_json as etiquetas, fr.detalle_json as detalle,
              fr.version_formula, fr.fecha_calculo, fr.id_formula,
              fr.manual_override, fr.manual_comment, fr.resultado_consultor, 
              fr.id_usuario_evaluador, fr.fecha_manual_evaluacion,
              ir.id_informe
       FROM ema.formula_resultado fr
       JOIN ema.informe_registro ir ON ir.id_registro = fr.id_registro
       WHERE fr.id_registro = $1
       ORDER BY fr.version_formula DESC, fr.fecha_calculo DESC
       LIMIT 1`,
      [idRegistro]
    );
    if (res.rowCount === 0) return null;

    const row = res.rows[0];
    const detalleRaw = row.detalle || [];
    if (detalleRaw.length === 0) return row;

    // IDs referenciados en el detalle
    const preguntaIds = [...new Set(detalleRaw.map(d => d.id_pregunta).filter(Boolean))];
    const reglaIds    = [...new Set(detalleRaw.map(d => d.id_regla).filter(Boolean))];

    // Cargar datos frescos de BD en paralelo
    const [pregRes, reglaRes, respRes] = await Promise.all([
      preguntaIds.length > 0
        ? pool.query(
            `SELECT id_pregunta, etiqueta, tipo FROM ema.informe_pregunta WHERE id_pregunta = ANY($1::int[])`,
            [preguntaIds]
          )
        : Promise.resolve({ rows: [] }),
      reglaIds.length > 0
        ? pool.query(
            `SELECT id_regla, operador, valor_ref_1, valor_ref_2 FROM ema.formula_regla WHERE id_regla = ANY($1::int[])`,
            [reglaIds]
          )
        : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT id_pregunta, valor_texto, valor_bool, valor_json
         FROM ema.informe_respuesta 
         WHERE id_informe = $1`,
        [row.id_informe]
      )
    ]);

    const pregMap  = new Map(pregRes.rows.map(p => [p.id_pregunta, p]));
    const reglaMap = new Map(reglaRes.rows.map(r => [r.id_regla, r]));
    const respMap  = new Map(respRes.rows.map(r => [r.id_pregunta, r]));

    // Enriquecer cada item
    const detalleEnriquecido = detalleRaw.map(item => {
      const preg    = pregMap.get(item.id_pregunta);
      const regla   = reglaMap.get(item.id_regla);
      const respRow = respMap.get(item.id_pregunta);
      const qTipo   = preg ? this._mapQuestionType(preg.tipo) : 'STRING';

      const operador = regla?.operador || item.operador;
      const valor_ref = regla
        ? (operador === 'RANGE'
            ? `${regla.valor_ref_1} y ${regla.valor_ref_2}`
            : regla.valor_ref_1)
        : item.valor_ref;

      return {
        ...item,
        pregunta_label: preg?.etiqueta || item.pregunta_label || `Pregunta ${item.id_pregunta}`,
        operador,
        valor_ref,
        valor_respuesta: respRow
          ? this._getReadableValue(respRow, qTipo)
          : (item.valor_respuesta ?? '—')
      };
    });

    const [descripcion_rango, rangosRes] = await Promise.all([
      this._getDescripcionRango(row.id_formula, row.score_total),
      pool.query(`SELECT DISTINCT etiqueta_final FROM ema.formula_rango WHERE id_formula = $1 ORDER BY etiqueta_final`, [row.id_formula])
    ]);

    const opciones_clasificacion = rangosRes.rows.map(r => r.etiqueta_final);

    return { ...row, detalle: detalleEnriquecido, descripcion_rango, opciones_clasificacion };
  }

  async _getDescripcionRango(idFormula, score) {
    try {
      const res = await pool.query(
        `SELECT descripcion, etiqueta_final FROM ema.formula_rango
         WHERE id_formula = $1 AND min_valor <= $2 AND max_valor >= $2
         ORDER BY prioridad DESC LIMIT 1`,
        [idFormula, parseFloat(score)]
      );
      return res.rowCount > 0 ? res.rows[0].descripcion : null;
    } catch {
      return null;
    }
  }

  // ─── Evaluación ───────────────────────────────────────────────────────────

  _evaluarConTipado(regla, valor, tipo) {
    if (valor === undefined || valor === null || valor === "") return false;

    const { operador, valor_ref_1, valor_ref_2 } = regla;

    // Para operadores numéricos, forzar parseFloat independientemente del tipo mapeado
    const numOps = ["GT", "GTE", "LT", "LTE", "RANGE"];
    if (numOps.includes(operador)) {
      const n = parseFloat(valor);
      if (isNaN(n)) return false;
      switch (operador) {
        case "GT":    return n > parseFloat(valor_ref_1);
        case "GTE":   return n >= parseFloat(valor_ref_1);
        case "LT":    return n < parseFloat(valor_ref_1);
        case "LTE":   return n <= parseFloat(valor_ref_1);
        case "RANGE": return n >= parseFloat(valor_ref_1) && n <= parseFloat(valor_ref_2);
      }
    }

    let vActual = valor;
    switch (operador) {
      case "EQ":  return vActual == valor_ref_1;
      case "NEQ": return vActual != valor_ref_1;
      case "IN": {
        const list = String(valor_ref_1).split(",").map(i => String(i).trim().toLowerCase());
        
        // Si vActual es un array (valor_json limpio)
        if (Array.isArray(vActual)) {
          return vActual.some(item => list.includes(String(item).trim().toLowerCase()));
        }
        
        // Si vActual es un string separado por comas (ej: "Paja, Madera" o "Teja,") guardado en valor_texto
        const vActualStr = String(vActual);
        if (vActualStr.includes(',')) {
           const actualItems = vActualStr.split(",").map(i => i.trim().toLowerCase()).filter(Boolean);
           return actualItems.some(item => list.includes(item));
        }
        
        return list.includes(vActualStr.trim().toLowerCase());
      }
      case "CONTAINS":
        return String(vActual).trim().toLowerCase().includes(String(valor_ref_1).trim().toLowerCase());
      default: return false;
    }
  }

  calcularClasificacion(score, rangos) {
    for (const r of rangos) {
      if (score >= parseFloat(r.min_valor) && score <= parseFloat(r.max_valor)) {
        return r.etiqueta_final;
      }
    }
    return "Sin Clasificación";
  }

  // ─── Normalización ────────────────────────────────────────────────────────

  /**
   * Para tipos NUMBER: prioriza valor_texto (donde el form guarda números como string).
   * Para otros tipos: prioriza valor_json, luego valor_texto.
   * valor_bool sólo se usa si nada más está disponible, para no enmascarar numéricos con false.
   */
  _normalizeValue(row, tipo) {
    if (!row) return null;

    if (tipo === 'NUMBER') {
      if (row.valor_texto !== null && row.valor_texto !== undefined && row.valor_texto !== '') return row.valor_texto;
      if (row.valor_json !== null && row.valor_json !== undefined) {
        if (typeof row.valor_json === 'object' && !Array.isArray(row.valor_json)) {
           return String(row.valor_json.valor || row.valor_json.value || row.valor_json.nombre || row.valor_json);
        }
        return String(row.valor_json);
      }
      return null;
    }

    if (row.valor_json !== null && row.valor_json !== undefined) {
      let v = row.valor_json;
      if (Array.isArray(v)) {
        return v.map(item => {
           if (item && typeof item === 'object') return String(item.valor || item.value || item.nombre || item.label || item);
           return String(item);
        });
      } else if (typeof v === 'object') {
        return String(v.valor || v.value || v.nombre || v.label || v);
      }
      return v;
    }

    if (row.valor_texto !== null && row.valor_texto !== undefined) return row.valor_texto;
    if (row.valor_bool !== null && row.valor_bool !== undefined) return row.valor_bool;
    return null;
  }

  _getReadableValue(row, tipo) {
    if (!row) return "—";

    if (tipo === 'NUMBER') {
      const v = row.valor_texto ?? row.valor_json;
      return (v !== null && v !== undefined) ? String(v) : "—";
    }

    if (row.valor_json && typeof row.valor_json === 'object' && !Array.isArray(row.valor_json)) {
      return row.valor_json.label || row.valor_json.value || JSON.stringify(row.valor_json);
    }
    if (Array.isArray(row.valor_json)) {
      return row.valor_json.map(item => item.label || item.value || String(item)).join(", ");
    }
    if (row.valor_texto !== null && row.valor_texto !== undefined) return row.valor_texto;
    if (row.valor_bool !== null && row.valor_bool !== undefined) return row.valor_bool ? "SÍ" : "NO";
    return "—";
  }

  // ─── Config con caché ─────────────────────────────────────────────────────

  _mapQuestionType(tipoOriginal) {
    const t = String(tipoOriginal || "").toLowerCase().trim();
    if (['numero', 'integer', 'decimal', 'entero', 'float', 'number'].includes(t)) return 'NUMBER';
    if (['select', 'radio', 'semaforo', 'select_single'].includes(t)) return 'SELECT_SINGLE';
    if (['checkbox', 'multiselect', 'select_multiple'].includes(t)) return 'SELECT_MULTIPLE';
    return 'STRING';
  }

  async _getFormulaConfig(idPlantilla, client) {
    const cached = this.cache.get(idPlantilla);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) return cached.data;

    const formulaRes = await client.query(
      `SELECT * FROM ema.formula WHERE id_plantilla = $1 AND activo = true ORDER BY version DESC LIMIT 1`,
      [idPlantilla]
    );
    if (formulaRes.rowCount === 0) return null;
    const formula = formulaRes.rows[0];

    const [reglasRes, rangosRes] = await Promise.all([
      client.query(`SELECT * FROM ema.formula_regla WHERE id_formula = $1 AND activo = true ORDER BY orden ASC`, [formula.id_formula]),
      client.query(`SELECT * FROM ema.formula_rango WHERE id_formula = $1 ORDER BY prioridad DESC`, [formula.id_formula])
    ]);

    const data = { formula, reglas: reglasRes.rows, rangos: rangosRes.rows };
    this.cache.set(idPlantilla, { data, timestamp: Date.now() });
    return data;
  }
}

module.exports = new ScoringEngine();
