// gv/gv_controller.js
const pool = require("../db");
const {
    resolveProyectoToVialOverlayScope,
    fetchOverlayTramosByResolution,
    fetchOverlayProgresivasByResolution,
    finalizeResolutionCoverage,
} = require("./gv_vial_overlay_resolver");

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

function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
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

const { inferTipoCarpeta } = require("./analytics_helpers");

function inferTipoExpediente(row) {
    return inferTipoCarpeta(row);
}


async function catastroDashboard(req, res) {
    const proyectoId = parseInt(req.query.proyectoId || req.query.idProyecto);
    if (isNaN(proyectoId)) {
        return res.status(400).json({ ok: false, error: "INVALID_PROYECTO_ID" });
    }
    const fechaInicio = req.query.fechaInicio !== undefined ? String(req.query.fechaInicio).trim() : "";
    const fechaFin = req.query.fechaFin !== undefined ? String(req.query.fechaFin).trim() : "";
    if (fechaInicio && !isYmd(fechaInicio)) {
        return res.status(400).json({ ok: false, error: "fechaInicio invalida (YYYY-MM-DD)" });
    }
    if (fechaFin && !isYmd(fechaFin)) {
        return res.status(400).json({ ok: false, error: "fechaFin invalida (YYYY-MM-DD)" });
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

        const params = [proyectoId];
        let sql = "SELECT * FROM ema.expedientes WHERE id_proyecto=$1";
        if (fechaInicio) {
            params.push(fechaInicio);
            sql += ` AND fecha_relevamiento >= $${params.length}`;
        }
        if (fechaFin) {
            params.push(fechaFin);
            sql += ` AND fecha_relevamiento <= $${params.length}`;
        }
        sql += " ORDER BY created_at DESC";
        const { rows } = await pool.query(sql, params);

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

        const by_tipo = { mejora: 0, terreno: 0, sin_iniciar: 0 };
        const geo_stats = { con_poligono: 0, solo_punto: 0 };

        // Inicializar contadores de fases
        const stagesMejora = getOrderedStageKeys("mejora");
        const stagesTerreno = getOrderedStageKeys("terreno");
        const phases = {
            mejora: { N: stagesMejora.length, counts: new Array(stagesMejora.length + 1).fill(0) },
            terreno: { N: stagesTerreno.length, counts: new Array(stagesTerreno.length + 1).fill(0) },
            sin_iniciar: { N: 0, counts: [0] },
        };

        let invalid_sequence_total = 0;

        const summaryList = rows.map((row) => {
            const tipoExp = inferTipoExpediente(row);
            if (by_tipo[tipoExp] !== undefined) {
                by_tipo[tipoExp]++;
            }

            const carpeta = tipoExp === "mejora" ? (row.carpeta_mejora || {}) : (row.carpeta_terreno || {});
            const stagesExp = tipoExp === "mejora" ? stagesMejora : stagesTerreno;

            let completed = 0;
            let invalid_sequence = false;
            let stopCounting = false;
            const hasRelevamiento = !!row.fecha_relevamiento;

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

            if (tipoExp === "sin_iniciar") {
                if (hasRelevamiento) {
                    phases.sin_iniciar.counts[0]++;
                }
            } else if (phases[tipoExp] && (completed > 0 || hasRelevamiento)) {
                phases[tipoExp].counts[completed]++;
            }

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
    const fechaInicio = req.query.fechaInicio !== undefined ? String(req.query.fechaInicio).trim() : "";
    const fechaFin = req.query.fechaFin !== undefined ? String(req.query.fechaFin).trim() : "";

    if (fechaInicio && !isYmd(fechaInicio)) {
        return res.status(400).json({ ok: false, error: "fechaInicio invalida (YYYY-MM-DD)" });
    }
    if (fechaFin && !isYmd(fechaFin)) {
        return res.status(400).json({ ok: false, error: "fechaFin invalida (YYYY-MM-DD)" });
    }

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
        let sql = `SELECT id_expediente, tramo, subtramo, gps, fecha_relevamiento,
                    carpeta_mejora, carpeta_terreno, codigo_exp,
                    propietario_nombre, propietario_ci, codigo_censo, carpeta_dbi
             FROM ema.expedientes
             WHERE id_proyecto=$1`;

        if (fechaInicio) {
            params.push(fechaInicio);
            sql += ` AND fecha_relevamiento >= $${params.length}`;
        }
        if (fechaFin) {
            params.push(fechaFin);
            sql += ` AND fecha_relevamiento <= $${params.length}`;
        }

        if (filtroQ) {
            params.push(`%${filtroQ}%`);
            const qIdx = params.length;
            sql += ` AND (` +
                `propietario_nombre ILIKE $${qIdx} OR ` +
                `propietario_ci ILIKE $${qIdx} OR ` +
                `pareja_nombre ILIKE $${qIdx} OR ` +
                `pareja_ci ILIKE $${qIdx} OR ` +
                `codigo_exp ILIKE $${qIdx} OR ` +
                `codigo_censo ILIKE $${qIdx} OR ` +
                `COALESCE(carpeta_dbi->>'codigo','') ILIKE $${qIdx}` +
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

async function catastroVialOverlay(req, res) {
    const proyectoId = parseInt(req.query.proyectoId || req.query.idProyecto, 10);
    const tramoId = parseIntOrUndef(req.query.tramoId);
    const subtramoId = parseIntOrUndef(req.query.subtramoId);

    if (!Number.isFinite(proyectoId) || proyectoId <= 0) {
        return res.status(400).json({ ok: false, error: "INVALID_PROYECTO_ID" });
    }

    try {
        const initialResolution = await resolveProyectoToVialOverlayScope({
            idProyecto: proyectoId,
            idProyectoTramo: tramoId,
            idProyectoSubtramo: subtramoId,
            db: pool,
        });

        let [tramosResult, progresivasResult] = await Promise.all([
            fetchOverlayTramosByResolution({ idProyecto: proyectoId, resolution: initialResolution, db: pool }),
            fetchOverlayProgresivasByResolution({ idProyecto: proyectoId, resolution: initialResolution, db: pool }),
        ]);
        const initialTramosFeatureCount = Array.isArray(tramosResult?.feature_collection?.features)
            ? tramosResult.feature_collection.features.length
            : 0;
        let resolution = finalizeResolutionCoverage({
            resolution: initialResolution,
            overlayFeatureCount: initialTramosFeatureCount,
        });
        let currentTramosFeatureCount = initialTramosFeatureCount;

        const hasDirectVialTramo =
            Array.isArray(initialResolution?.resolved_vial_tramo_ids) &&
            initialResolution.resolved_vial_tramo_ids.length > 0;
        const detectedSubtramoVialIds = Array.isArray(initialResolution?.resolved_vial_subtramo_ids)
            ? initialResolution.resolved_vial_subtramo_ids
            : [];

        if (!hasDirectVialTramo && currentTramosFeatureCount === 0 && detectedSubtramoVialIds.length > 0) {
            const proxyResult = await fetchOverlayTramosByResolution({
                idProyecto: proyectoId,
                resolution: {
                    resolution_mode: "proxy_subtramos",
                    resolved_vial_tramo_ids: detectedSubtramoVialIds,
                },
                db: pool,
            });
            const proxyFeatureCount = Array.isArray(proxyResult?.feature_collection?.features)
                ? proxyResult.feature_collection.features.length
                : 0;
            if (proxyFeatureCount > 0) {
                tramosResult = proxyResult;
                currentTramosFeatureCount = proxyFeatureCount;
                const matchedProxyIds = Array.from(
                    new Set(
                        (proxyResult?.feature_collection?.features || [])
                            .map((f) => Number(f?.properties?.id_tramo))
                            .filter((n) => Number.isFinite(n))
                    )
                ).sort((a, b) => a - b);
                resolution = {
                    ...resolution,
                    resolution_source: "subtramos_proxy_a_tramo",
                    coverage_status: "ok",
                    coverage_reason: "subtramo_ids_used_as_tramo_ids",
                    resolved_proxy_tramo_ids_from_subtramos: matchedProxyIds,
                    overlay_feature_count: proxyFeatureCount,
                    is_project_scope_fallback: false,
                };
            } else {
                resolution = {
                    ...resolution,
                    resolved_proxy_tramo_ids_from_subtramos: [],
                };
            }
        }

        const globalCandidateTramoIds = Array.isArray(resolution?.resolved_proxy_tramo_ids_from_subtramos) &&
            resolution.resolved_proxy_tramo_ids_from_subtramos.length > 0
            ? resolution.resolved_proxy_tramo_ids_from_subtramos
            : hasDirectVialTramo
                ? (initialResolution?.resolved_vial_tramo_ids || [])
                : detectedSubtramoVialIds;
        let globalTramosFeatureCount = 0;

        if (initialResolution?.resolution_mode !== "project" && currentTramosFeatureCount === 0 && globalCandidateTramoIds.length > 0) {
            const globalFallbackResult = await fetchOverlayTramosByResolution({
                idProyecto: proyectoId,
                resolution: {
                    resolution_mode: "global_tramo_fallback",
                    resolved_vial_tramo_ids: globalCandidateTramoIds,
                    skip_project_filter: true,
                },
                db: pool,
            });
            globalTramosFeatureCount = Array.isArray(globalFallbackResult?.feature_collection?.features)
                ? globalFallbackResult.feature_collection.features.length
                : 0;
            if (globalTramosFeatureCount > 0) {
                tramosResult = globalFallbackResult;
                currentTramosFeatureCount = globalTramosFeatureCount;
                const matchedGlobalProjectIds = Array.from(
                    new Set(
                        (globalFallbackResult?.feature_collection?.features || [])
                            .map((f) => Number(f?.properties?.id_proyecto))
                            .filter((n) => Number.isFinite(n))
                    )
                ).sort((a, b) => a - b);
                resolution = {
                    ...resolution,
                    resolution_source: "global_tramo_fallback",
                    coverage_status: "ok",
                    coverage_reason: "global_match_without_project_filter",
                    is_global_tramo_fallback: true,
                    is_project_scope_fallback: false,
                    overlay_feature_count: globalTramosFeatureCount,
                    matched_project_ids: matchedGlobalProjectIds,
                };
            }
        }

        if (initialResolution?.resolution_mode !== "project" && currentTramosFeatureCount === 0) {
            const projectFallbackResult = await fetchOverlayTramosByResolution({
                idProyecto: proyectoId,
                resolution: { resolution_mode: "project" },
                db: pool,
            });
            const projectFeatureCount = Array.isArray(projectFallbackResult?.feature_collection?.features)
                ? projectFallbackResult.feature_collection.features.length
                : 0;
            if (projectFeatureCount > 0) {
                tramosResult = projectFallbackResult;
                currentTramosFeatureCount = projectFeatureCount;
                resolution = {
                    ...resolution,
                    resolution_source: "project_scope_fallback",
                    coverage_status: "partial",
                    is_project_scope_fallback: true,
                    is_global_tramo_fallback: false,
                    overlay_feature_count: projectFeatureCount,
                    coverage_reason: resolution?.coverage_reason || "project_scope_fallback",
                };
            }
        }

        const responseWarnings = [
            ...(Array.isArray(resolution?.warnings) ? resolution.warnings : []),
        ];
        if (progresivasResult?.warning) {
            responseWarnings.push(progresivasResult.warning);
        }

      

        return res.status(200).json({
            ok: true,
            proyectoId,
            filters: {
                tramoId: tramoId || null,
                subtramoId: subtramoId || null,
            },
            resolution,
            tramos: tramosResult?.feature_collection || { type: "FeatureCollection", features: [] },
            progresivas:
                progresivasResult?.feature_collection || { type: "FeatureCollection", features: [] },
            metadata: {
                tramos_scope_mode: tramosResult?.scope_mode || "unknown",
                progresivas_scope_mode: progresivasResult?.scope_mode || "unknown",
                progresivas_structural_filter_supported:
                    !!progresivasResult?.structural_filter_supported,
                overlay_feature_count: resolution?.overlay_feature_count || 0,
                resolution_source: resolution?.resolution_source || null,
                coverage_status: resolution?.coverage_status || null,
                coverage_reason: resolution?.coverage_reason || null,
                is_project_scope_fallback: !!resolution?.is_project_scope_fallback,
                is_global_tramo_fallback: !!resolution?.is_global_tramo_fallback,
                matched_project_ids: resolution?.matched_project_ids || [],
                project_specific_feature_count: initialTramosFeatureCount,
                global_feature_count: globalTramosFeatureCount,
            },
            warnings: responseWarnings,
        });
    } catch (error) {
        const status = Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
        const traceId = `gv-vial-overlay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        try {
            console.error(`[GV][catastroVialOverlay][${traceId}]`, {
                proyectoId: req.query.proyectoId || req.query.idProyecto,
                query: req.query,
                message: error?.message,
                code: error?.code,
                stack: error?.stack,
            });
        } catch (_) {
            // nada
        }

        const payload = {
            ok: false,
            error: status === 500 ? "INTERNAL_SERVER_ERROR" : (error?.message || "BAD_REQUEST"),
            traceId,
        };
        if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === undefined) {
            payload.details = { message: String(error?.message || ""), code: error?.code || null };
        }
        return res.status(status).json(payload);
    }
}

module.exports = { ping, catastroDashboard, catastroMap, catastroVialOverlay };
