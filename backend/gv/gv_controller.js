// gv/gv_controller.js
const pool = require("../db");

/**
 * Helpers para filtros por querystring
 */
function parseBool(v) {
    if (v === undefined) return undefined;
    const s = String(v).toLowerCase().trim();
    if (["1", "true", "t", "yes", "y"].includes(s)) return true;
    if (["0", "false", "f", "no", "n"].includes(s)) return false;
    return undefined;
}

function parseIntOrUndef(v) {
    if (v === undefined) return undefined;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Retorna las llaves ordenadas de las etapas según el tipo.
 */
function getOrderedStageKeys(tipo) {
    if (tipo === "mejora") {
        return [
            "documentacion",
            "plano_georef",
            "avaluo",
            "notif_conformidad",
            "documentacion_final",
        ];
    }
    if (tipo === "terreno") {
        return [
            "documentacion",
            "plano_georef",
            "informe_pericial",
            "plantilla",
            "avaluo",
            "notif_conformidad",
            "documentacion_final",
        ];
    }
    return [];
}

/**
 * Parsea una cadena GeoJSON de forma defensiva.
 * Retorna null si la cadena es nula, no-string o JSON inválido.
 */
function safeParseGeoJSON(maybeJson) {
    if (!maybeJson || typeof maybeJson !== "string") return null;
    try { return JSON.parse(maybeJson); } catch { return null; }
}

/**
 * Helpers para inferir tipo por expediente
 */
function normalizeOk(value) {
    if (value === true || value === 1 || value === "1" || value === "true") return true;
    return false;
}

function countTrueStages(carpetaObj) {
    if (!carpetaObj || typeof carpetaObj !== "object") return 0;
    let count = 0;
    for (const key of Object.keys(carpetaObj)) {
        if (carpetaObj[key] && normalizeOk(carpetaObj[key].ok)) {
            count++;
        }
    }
    return count;
}

function inferTipoExpediente(row) {
    const cm = row.carpeta_mejora || {};
    const ct = row.carpeta_terreno || {};
    const mejoraCount = countTrueStages(cm);
    const terrenoCount = countTrueStages(ct);

    if (mejoraCount > 0 && terrenoCount === 0) return "mejora";
    if (terrenoCount > 0 && mejoraCount === 0) return "terreno";

    if (mejoraCount > 0 && terrenoCount > 0) {
        if (terrenoCount > mejoraCount) return "terreno";
        return "mejora"; // empate => fallback a mejora
    }

    const cmKeys = Object.keys(cm);
    const ctKeys = Object.keys(ct);

    if (cmKeys.length >= 5 && ctKeys.length === 0) return "mejora";
    if (ctKeys.length >= 7 && cmKeys.length === 0) return "terreno";

    return "mejora";
}


async function catastroDashboard(req, res) {
    const proyectoId = parseInt(req.query.proyectoId || req.query.idProyecto);
    if (isNaN(proyectoId)) {
        return res.status(400).json({ ok: false, error: "INVALID_PROYECTO_ID" });
    }

    try {
        // 1. Obtener datos del proyecto
        const { rows: proyRows } = await pool.query(
            "SELECT catastro_target_total, tipo_proyecto FROM ema.proyectos WHERE gid = $1",
            [proyectoId]
        );

        if (proyRows.length === 0) {
            return res.status(404).json({ ok: false, error: "PROYECTO_NOT_FOUND" });
        }

        const project = proyRows[0];
        const dbTarget = project.catastro_target_total;

        const { rows } = await pool.query(
            "SELECT * FROM ema.expedientes WHERE id_proyecto=$1 ORDER BY created_at DESC",
            [proyectoId]
        );

        const ids = rows.map(r => r.id_expediente);

        let docs_summary = {
            expedientes_con_docs: 0,
            expedientes_con_ci: 0,
            expedientes_con_dbi: 0,
            archivos_total: 0,
            archivos_ci_total: 0,
            archivos_dbi_total: 0
        };

        if (ids.length > 0) {
            const { rows: tumbaRows } = await pool.query(
                `SELECT
                  id_documento,
                  LOWER(COALESCE(subcarpeta, '')) AS subcarpeta,
                  COUNT(*)::int AS c
                FROM ema.tumba
                WHERE tipo_documento = 'expedientes'
                  AND id_documento = ANY($1)
                GROUP BY id_documento, LOWER(COALESCE(subcarpeta, ''))`,
                [ids]
            );

            const docsByExp = {};
            for (const r of tumbaRows) {
                const docId = r.id_documento;
                const sub = r.subcarpeta;
                const c = r.c;

                if (!docsByExp[docId]) docsByExp[docId] = { total: 0, ci: 0, dbi: 0 };

                docsByExp[docId].total += c;
                if (sub === 'ci') docsByExp[docId].ci += c;
                else if (sub === 'dbi') docsByExp[docId].dbi += c;
            }

            for (const id of ids) {
                const d = docsByExp[id];
                if (d && d.total > 0) {
                    docs_summary.expedientes_con_docs++;
                    docs_summary.archivos_total += d.total;
                }
                if (d && d.ci > 0) {
                    docs_summary.expedientes_con_ci++;
                    docs_summary.archivos_ci_total += d.ci;
                }
                if (d && d.dbi > 0) {
                    docs_summary.expedientes_con_dbi++;
                    docs_summary.archivos_dbi_total += d.dbi;
                }
            }

            // --- Novedad: Obtener polígonos para Métricas Geo ---
            const GEOM_SQL_DASH = (table) =>
                `SELECT id_expediente,
                   CASE
                     WHEN geom IS NULL OR ST_IsEmpty(geom) OR ST_SRID(geom) = 0 THEN NULL
                     ELSE ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), 4326))
                   END AS geometry
                 FROM ema.${table}
                 WHERE id_expediente = ANY($1)
                   AND geom IS NOT NULL`;

            const [mejorasRes, terrenoRes] = await Promise.all([
                pool.query(GEOM_SQL_DASH("bloque_mejoras"), [ids]),
                pool.query(GEOM_SQL_DASH("bloque_terreno"), [ids])
            ]);

            const geomMap = {};
            mejorasRes.rows.forEach(r => {
                const g = safeParseGeoJSON(r.geometry);
                if (g) geomMap[r.id_expediente] = g;
            });
            terrenoRes.rows.forEach(r => {
                const g = safeParseGeoJSON(r.geometry);
                if (g) geomMap[r.id_expediente] = g;
            });

            // Parsear también a nivel scope local para el summaryList
            req.dashGeomMap = geomMap;
        }

        const censados = rows.length;

        // Normalización de target_total (GV5)
        let target_total = dbTarget;
        if (!target_total || target_total <= 0) {
            target_total = censados;
        }

        const by_tipo = { mejora: 0, terreno: 0 };
        const geo_stats = { con_poligono: 0, solo_punto: 0 };

        // Inicializar contadores de fases
        const stagesMejora = getOrderedStageKeys("mejora");
        const stagesTerreno = getOrderedStageKeys("terreno");
        const phases = {
            mejora: { N: stagesMejora.length, counts: new Array(stagesMejora.length + 1).fill(0) },
            terreno: { N: stagesTerreno.length, counts: new Array(stagesTerreno.length + 1).fill(0) },
        };

        let invalid_sequence_total = 0;

        const summaryList = rows.map((row) => {
            const tipoExp = inferTipoExpediente(row);
            by_tipo[tipoExp]++;

            const carpeta = tipoExp === "mejora" ? (row.carpeta_mejora || {}) : (row.carpeta_terreno || {});
            const stagesExp = tipoExp === "mejora" ? stagesMejora : stagesTerreno;

            let completed = 0;
            let invalid_sequence = false;
            let stopCounting = false;

            for (const key of stagesExp) {
                const isOk = !!carpeta[key]?.ok;
                if (isOk) {
                    if (stopCounting) {
                        invalid_sequence = true;
                    } else {
                        completed++;
                    }
                } else {
                    stopCounting = true;
                }
            }

            if (invalid_sequence) invalid_sequence_total++;
            phases[tipoExp].counts[completed]++;

            let has_polygon = false;
            let has_point = false;

            if (req.dashGeomMap && req.dashGeomMap[row.id_expediente]) {
                has_polygon = true;
                geo_stats.con_poligono++;
            } else if (row.gps && typeof row.gps === "string" && row.gps.includes(",")) {
                const parts = row.gps.split(",").map(p => parseFloat(p.trim()));
                if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    has_point = true;
                    geo_stats.solo_punto++;
                }
            }

            return {
                id_expediente: row.id_expediente,
                tipo: tipoExp,
                tramo: row.tramo,
                subtramo: row.subtramo,
                gps: row.gps,
                fase: completed,
                N: stagesExp.length,
                is_complete: completed === stagesExp.length,
                invalid_sequence,
                created_at: row.created_at,
                updated_at: row.updated_at,
                codigo_exp: row.codigo_exp,
            };
        });

        res.status(200).json({
            ok: true,
            proyectoId,
            target_total,
            censados,
            coverage_pct: target_total === 0 ? 0 : censados / target_total,
            by_tipo,
            phases,
            geo_stats,
            invalid_sequence_total,
            docs_summary,
            expedientes: summaryList,
        });
    } catch (error) {
        const traceId = `gv-dash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            console.error(`[GV][catastroDashboard][${traceId}]`, {
                proyectoId: req.query.proyectoId || req.query.idProyecto,
                query: req.query,
                message: error?.message,
                code: error?.code,
                stack: error?.stack,
            });
        } catch (_) {
            // nada (catch-only policy)
        }

        const payload = { ok: false, error: "INTERNAL_SERVER_ERROR", traceId };
        if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === undefined) {
            payload.details = { message: String(error?.message || ""), code: error?.code || null };
        }
        return res.status(500).json(payload);
    }
}

async function catastroMap(req, res) {
    const proyectoId = parseInt(req.query.proyectoId || req.query.idProyecto);
    if (isNaN(proyectoId)) {
        return res.status(400).json({ ok: false, error: "INVALID_PROYECTO_ID" });
    }

    const filtroTipo = req.query.tipo ? String(req.query.tipo).toLowerCase().trim() : undefined;
    const filtroTramo = req.query.tramo !== undefined ? String(req.query.tramo).trim() : undefined;
    const filtroSubtramo = req.query.subtramo !== undefined ? String(req.query.subtramo).trim() : undefined;
    const filtroQ = req.query.q !== undefined ? String(req.query.q).trim() : undefined;

    const filtroFase = parseIntOrUndef(req.query.fase);
    const filtroFaseMin = parseIntOrUndef(req.query.faseMin);
    const filtroFaseMax = parseIntOrUndef(req.query.faseMax);

    const filtroHasPolygon = parseBool(req.query.hasPolygon);
    const filtroHasPoint = parseBool(req.query.hasPoint);
    const filtroHasCI = parseBool(req.query.hasCI);
    const filtroHasDBI = parseBool(req.query.hasDBI);
    const filtroHasDocs = parseBool(req.query.hasDocs);

    try {
        const { rows: proyRows } = await pool.query(
            "SELECT tipo_proyecto FROM ema.proyectos WHERE gid = $1",
            [proyectoId]
        );
        if (proyRows.length === 0) {
            return res.status(404).json({ ok: false, error: "PROYECTO_NOT_FOUND" });
        }

        // 1. Obtener expedientes e inferir tipo individualmente
        const params = [proyectoId];
        let sql = `SELECT id_expediente, tramo, subtramo, gps,
                    carpeta_mejora, carpeta_terreno, codigo_exp,
                    propietario_nombre, propietario_ci, codigo_censo, carpeta_dbi
             FROM ema.expedientes
             WHERE id_proyecto=$1`;

        if (filtroQ) {
            params.push(`%${filtroQ}%`);
            sql += ` AND (` +
                `propietario_nombre ILIKE $2 OR ` +
                `propietario_ci ILIKE $2 OR ` +
                `codigo_exp ILIKE $2 OR ` +
                `codigo_censo ILIKE $2 OR ` +
                `COALESCE(carpeta_dbi->>'codigo','') ILIKE $2` +
                `)`;
        }

        const { rows: expedientesRaw } = await pool.query(sql, params);

        let expedientes = expedientesRaw.map(e => ({ ...e, tipo: inferTipoExpediente(e) }));

        // FILTROS TEMPRANOS: aplicados sobre los registros antes de buscar geometrías (optimiza el query ANY)
        if (filtroTipo) {
            expedientes = expedientes.filter(e => e.tipo === filtroTipo);
        }
        if (filtroTramo !== undefined) {
            expedientes = expedientes.filter(e => String(e.tramo) === filtroTramo);
        }
        if (filtroSubtramo !== undefined) {
            expedientes = expedientes.filter(e => String(e.subtramo) === filtroSubtramo);
        }

        if (expedientes.length === 0) {
            return res.status(200).json({ type: "FeatureCollection", features: [] });
        }

        const ids = expedientes.map(e => e.id_expediente);

        const docsByExp = {};
        if (ids.length > 0) {
            const { rows: tumbaRows } = await pool.query(
                `SELECT
                  id_documento,
                  LOWER(COALESCE(subcarpeta, '')) AS subcarpeta,
                  COUNT(*)::int AS c
                FROM ema.tumba
                WHERE tipo_documento = 'expedientes'
                  AND id_documento = ANY($1)
                GROUP BY id_documento, LOWER(COALESCE(subcarpeta, ''))`,
                [ids]
            );

            for (const r of tumbaRows) {
                const docId = r.id_documento;
                const sub = r.subcarpeta;
                const c = r.c;

                if (!docsByExp[docId]) docsByExp[docId] = { total: 0, ci: 0, dbi: 0 };

                docsByExp[docId].total += c;
                if (sub === 'ci') docsByExp[docId].ci += c;
                else if (sub === 'dbi') docsByExp[docId].dbi += c;
            }
        }

        // 2. Obtener polígonos en lote (sin N+1)
        // CASE WHEN ST_SRID(geom) > 0: evita que ST_Transform falle si geom tiene SRID=0
        const GEOM_SQL = (table) =>
            `SELECT id_expediente,
               CASE
                 WHEN geom IS NULL OR ST_IsEmpty(geom) OR ST_SRID(geom) = 0 THEN NULL
                 ELSE ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), 4326))
               END AS geometry
             FROM ema.${table}
             WHERE id_expediente = ANY($1)
               AND geom IS NOT NULL`;

        const [mejorasRes, terrenoRes] = await Promise.all([
            pool.query(GEOM_SQL("bloque_mejoras"), [ids]),
            pool.query(GEOM_SQL("bloque_terreno"), [ids])
        ]);

        const geomMap = {};
        mejorasRes.rows.forEach(r => {
            const g = safeParseGeoJSON(r.geometry);
            if (g) geomMap[r.id_expediente] = g;
        });
        terrenoRes.rows.forEach(r => {
            const g = safeParseGeoJSON(r.geometry);
            if (g) geomMap[r.id_expediente] = g;
        });

        // 3. Construir Features — fase calculada por expediente
        const features = expedientes.map(exp => {
            // Tipo y stages por expediente individual
            const stages = getOrderedStageKeys(exp.tipo);
            const carpeta = exp.tipo === "mejora"
                ? (exp.carpeta_mejora || {})
                : (exp.carpeta_terreno || {});

            let completed = 0;
            let stopCounting = false;
            for (const key of stages) {
                if (!!carpeta[key]?.ok) {
                    if (!stopCounting) completed++;
                } else {
                    stopCounting = true;
                }
            }

            const fase_pct = stages.length > 0 ? completed / stages.length : 0;

            let geometry = null;
            let has_polygon = false;
            let has_point = false;

            if (geomMap[exp.id_expediente]) {
                geometry = geomMap[exp.id_expediente];
                has_polygon = true;
            } else if (exp.gps && typeof exp.gps === "string" && exp.gps.includes(",")) {
                // Parsing GPS string: "Lat, Lng" -> GeoJSON [Lng, Lat]
                const parts = exp.gps.split(",").map(p => parseFloat(p.trim()));
                if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    geometry = {
                        type: "Point",
                        coordinates: [parts[1], parts[0]] // [Lng, Lat]
                    };
                    has_point = true;
                }
            }

            const dMap = docsByExp[exp.id_expediente] || { total: 0, ci: 0, dbi: 0 };

            return {
                type: "Feature",
                geometry,
                properties: {
                    id_expediente: exp.id_expediente,
                    tipo: exp.tipo,
                    tramo: exp.tramo,
                    subtramo: exp.subtramo,
                    codigo_exp: exp.codigo_exp,
                    fase_index: completed,
                    fase_total: stages.length,
                    fase_pct,
                    has_polygon,
                    has_point,
                    has_docs: dMap.total > 0,
                    has_ci: dMap.ci > 0,
                    has_dbi: dMap.dbi > 0,
                    docs_count_total: dMap.total,
                    docs_count_ci: dMap.ci,
                    docs_count_dbi: dMap.dbi
                }
            };
        });

        let resultFeatures = features.filter(f => f.geometry !== null);

        // FILTROS TARDÍOS: aplicados sobre properties calculadas
        if (filtroFase !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.fase_index === filtroFase);
        }
        if (filtroFaseMin !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.fase_index >= filtroFaseMin);
        }
        if (filtroFaseMax !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.fase_index <= filtroFaseMax);
        }
        if (filtroHasPolygon !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.has_polygon === filtroHasPolygon);
        }
        if (filtroHasPoint !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.has_point === filtroHasPoint);
        }
        if (filtroHasCI !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.has_ci === filtroHasCI);
        }
        if (filtroHasDBI !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.has_dbi === filtroHasDBI);
        }
        if (filtroHasDocs !== undefined) {
            resultFeatures = resultFeatures.filter(f => f.properties.has_docs === filtroHasDocs);
        }

        res.status(200).json({
            type: "FeatureCollection",
            features: resultFeatures
        });

    } catch (error) {
        const traceId = `gv-map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            console.error(`[GV][catastroMap][${traceId}]`, {
                proyectoId: req.query.proyectoId || req.query.idProyecto,
                query: req.query,
                message: error?.message,
                code: error?.code,
                stack: error?.stack,
            });
        } catch (_) {
            // nada (catch-only policy)
        }

        const payload = { ok: false, error: "INTERNAL_SERVER_ERROR", traceId };
        if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === undefined) {
            payload.details = { message: String(error?.message || ""), code: error?.code || null };
        }
        return res.status(500).json(payload);
    }
}

function ping(req, res) {
    res.status(200).json({
        ok: true,
        module: "GV",
        status: "online",
        timestamp: new Date().toISOString(),
    });
}

module.exports = { ping, catastroDashboard, catastroMap };
