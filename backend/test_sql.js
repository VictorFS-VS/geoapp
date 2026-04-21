const pool = require('./db');
const { buildInformeVisibleScope } = require('./helpers/informesDashboardScope');

async function testQuery(reqQuery, reqUser) {
    try {
      const { id_proyecto, id_plantilla, search, con_diagnostico } = reqQuery;
      const page = parseInt(reqQuery.page, 10) || 1;
      const limit = parseInt(reqQuery.limit, 10) || 20;
      const offset = (page - 1) * limit;

      const idP = Number(id_proyecto);
      if (!Number.isFinite(idP) || idP <= 0) {
        throw new Error("id_proyecto inválido");
      }

      const userId = reqUser.id;
      const isAdmin =
        Number(reqUser.tipo_usuario) === 1 || Number(reqUser.group_id) === 1;

      const baseParams = [idP];
      const scope = buildInformeVisibleScope({
        userId,
        isAdmin,
        plantillaId: id_plantilla,
        startIndex: baseParams.length + 1,
      });

      const whereConditions = ["i.id_proyecto = $1"];
      const scopeWhere = scope.whereSql.replace(/^\s*AND\s*/i, "");
      if (scopeWhere) whereConditions.push(scopeWhere);
      
      const params = [...baseParams, ...scope.params];

      if (id_plantilla) {
        params.push(Number(id_plantilla));
        whereConditions.push(`i.id_plantilla = $${params.length}`);
      }

      if (con_diagnostico !== undefined && con_diagnostico !== '') {
        const hasDiag = con_diagnostico === 'true';
        if (hasDiag) {
          whereConditions.push("fr.id_resultado IS NOT NULL");
        } else {
          whereConditions.push("fr.id_resultado IS NULL");
        }
      }

      if (search) {
        params.push(`%${search}%`);
        const searchIdx = params.length;
        whereConditions.push(`
          EXISTS (
            SELECT 1 
            FROM ema.informe_respuesta r2 
            WHERE r2.id_informe = i.id_informe
            AND (
              r2.valor_texto ILIKE $${searchIdx}
              OR r2.valor_json::text ILIKE $${searchIdx}
              OR r2.valor_bool::text ILIKE $${searchIdx}
            )
          )
        `);
      }

      const whereClause = whereConditions.map(c => `(${c})`).join(" AND ");

      const countQuery = `
        SELECT COUNT(DISTINCT i.id_informe) as total
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
        LEFT JOIN ema.formula_resultado fr ON fr.id_registro = ir.id_registro
          AND fr.id_formula = (SELECT id_formula FROM ema.formula f WHERE f.id_plantilla = p.id_plantilla AND f.activo = true ORDER BY f.version DESC LIMIT 1)
        LEFT JOIN ema.informe_plantilla_usuario pu
          ON pu.id_plantilla = p.id_plantilla
          AND pu.id_usuario = $${scope.userParamIndex}
        ${whereClause ? `WHERE ${whereClause}` : ""}
      `;

      const dataQuery = `
        SELECT 
          i.*,
          p.nombre AS nombre_plantilla,
          ir.id_registro,
          fr.score_total,
          COALESCE(fr.resultado_consultor, fr.clasificacion) as clasificacion,
          fr.cambio_detectado,
          fr.manual_override,
          fr.fecha_recalculo,
          (
            SELECT jsonb_object_agg(q_vis.etiqueta, 
              CASE 
                WHEN q_vis.tipo IN ('semaforo', 'select') THEN 
                  COALESCE(r_vis.valor_json->>'label', r_vis.valor_texto, r_vis.valor_json::text)
                WHEN q_vis.tipo = 'multiselect' THEN 
                  (
                    SELECT string_agg(item->>'label', ', ')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r_vis.valor_json) = 'array' THEN r_vis.valor_json ELSE '[]'::jsonb END) AS item
                  )
                ELSE COALESCE(r_vis.valor_texto, r_vis.valor_json::text)
              END
            )
            FROM ema.informe_respuesta r_vis
            JOIN ema.informe_pregunta q_vis ON q_vis.id_pregunta = r_vis.id_pregunta
            WHERE r_vis.id_informe = i.id_informe 
              AND q_vis.visible_en_listado = true
          ) as respuestas_clave
        FROM ema.informe i
        JOIN ema.informe_plantilla p ON p.id_plantilla = i.id_plantilla
        LEFT JOIN ema.informe_registro ir ON ir.id_informe = i.id_informe
        LEFT JOIN ema.formula_resultado fr ON fr.id_registro = ir.id_registro
          AND fr.id_formula = (SELECT id_formula FROM ema.formula f WHERE f.id_plantilla = p.id_plantilla AND f.activo = true ORDER BY f.version DESC LIMIT 1)
        LEFT JOIN ema.informe_plantilla_usuario pu
          ON pu.id_plantilla = p.id_plantilla
          AND pu.id_usuario = $${scope.userParamIndex}
        ${whereClause ? `WHERE ${whereClause}` : ""}
        ORDER BY i.fecha_creado DESC, i.id_informe DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const dataParams = [...params, limit, offset];
      
      const [countRes, dataRes] = await Promise.all([
        pool.query(countQuery, params),
        pool.query(dataQuery, dataParams)
      ]);
      console.log("SUCCESS! Row count:", dataRes.rows.length);
    } catch (err) {
      console.error("❌ queryInformes error:", err.message);
    }
}

testQuery({ id_proyecto: '279', page: '1', limit: '20', id_plantilla: '35', search: 'jor' }, { id: 70, group_id: 1, tipo_usuario: 1 }).then(()=>process.exit(0));
