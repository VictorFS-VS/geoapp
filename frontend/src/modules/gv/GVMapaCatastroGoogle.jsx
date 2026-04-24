// src/modules/gv/GVMapaCatastroGoogle.jsx
// Mapa GV usando Google Maps JS (mismo stack que /visor-full)
// Props: proyectoId, filters, onStatsChange
import React, { useEffect, useMemo, useRef, useState } from 'react';
import GVAMapBase from "./components/GVAMapBase";
import GVAMapDataLayer from "./components/GVAMapDataLayer";
import GVAMapPointLayer from "./components/GVAMapPointLayer";
import GVAMapLayerSelector from "./components/GVAMapLayerSelector";
import { fetchCatastroMap } from './gv_map_service';
import { gvGetCatastroVialOverlay } from "./gv_service";
import { fetchProgresivasGeojson, fetchTramosGeojson } from "./gva_tramos/services/gvaTramosService";
import { getPhaseHex, getPhaseBorderHex } from './gv_colors';
import GvLegend from './GvLegend';

/** Agrega bounds a partir de un array de LatLng literales */
function extendBounds(bounds, pts) {
    if (!pts) return;
    for (const p of pts) bounds.extend(p);
}

/** Agrega bounds a partir de un FeatureCollection o Feature individual */
function extendBoundsWithGeojson(featureCollection, bounds, g) {
    if (!featureCollection || !bounds) return;
    const features = Array.isArray(featureCollection?.features) ? featureCollection.features : (featureCollection.type === 'Feature' ? [featureCollection] : []);
    
    for (const feature of features) {
        const geom = feature.geometry;
        if (!geom || !geom.coordinates) continue;
        
        if (geom.type === 'Point') {
            const [lng, lat] = geom.coordinates;
            if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
        } else if (geom.type === 'LineString') {
            geom.coordinates.forEach(([lng, lat]) => {
                if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
            });
        } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(line => line.forEach(([lng, lat]) => {
                if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
            }));
        } else if (geom.type === 'Polygon') {
            geom.coordinates.forEach(ring => ring.forEach(([lng, lat]) => {
                if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
            }));
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(([lng, lat]) => {
                if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
            })));
        }
    }
}

function clearOverlay(overlay) {
    if (!overlay) return;
    try {
        if ("map" in overlay) {
            overlay.map = null;
            return;
        }
    } catch { }
    try {
        if (typeof overlay.setMap === "function") {
            overlay.setMap(null);
        }
    } catch { }
}

function cleanupCatastroOverlays(overlaysRef) {
    if (!overlaysRef?.current) return;
    for (const o of overlaysRef.current) {
        clearOverlay(o);
    }
    overlaysRef.current = [];
}

function getCatastroFeatureVisualContract(props) {
    const phaseIndex = Number(props?.fase_index ?? 0);
    const phaseTotal = Number(props?.fase_total ?? 1);
    const tipoRaw = String(props?.tipo || '').toLowerCase();
    const isKnownTipo = tipoRaw === "mejora" || tipoRaw === "terreno";
    const fillHex = isKnownTipo ? getPhaseHex(phaseIndex, phaseTotal) : "#9ca3af";
    const borderHex = isKnownTipo ? (getPhaseBorderHex(phaseIndex) || fillHex) : "#6b7280";
    return {
        fillHex,
        borderHex,
        tipoRaw,
        phaseIndex,
        polygonStyle: {
            fillColor: fillHex,
            fillOpacity: 0.6,
            strokeColor: borderHex,
            strokeOpacity: 1,
            strokeWeight: 3,
            zIndex: 900,
        },
        pointStyle: {
            color: fillHex,
            borderColor: borderHex,
        },
    };
}

function getCatastroFeatureIdentity(feature) {
    const props = feature?.properties || {};
    const rawId =
        props?.id_expediente ??
        props?.id ??
        props?.padron ??
        feature?.__tmp_id ??
        null;

    return {
        id: Number(rawId) || Number(feature?.__tmp_id) || 0,
        title: String(props?.padron || props?.titulo || props?.id_expediente || "Expediente"),
        expedienteId: props?.id_expediente,
        props,
    };
}

function buildCatastroFeatureBuckets(features = []) {
    const points = [];
    const polygons = [];
    const multipolygons = [];

    for (const feature of features) {
        const geom = feature?.geometry;
        if (!geom) continue;
        if (geom.type === 'Point') points.push(feature);
        else if (geom.type === 'Polygon') polygons.push(feature);
        else if (geom.type === 'MultiPolygon') multipolygons.push(feature);
    }

    return { points, polygons, multipolygons };
}

function buildCatastroPointItems(features = []) {
    const buckets = buildCatastroFeatureBuckets(features);
    return buckets.points.map((feature, index) => ({
        ...feature,
        __tmp_id: index + 1,
    }));
}

function ringToLatLngs(ring) {
    return ring.map(([lng, lat]) => ({ lat, lng }));
}

function computeCatastroStats(features = []) {
    let totalFeatures = 0;
    let hasPolygonCount = 0;
    let hasPointCount = 0;
    const byFaseMejora = {};
    const byFaseTerreno = {};
    let mejoraCnt = 0;
    let terrenoCnt = 0;

    for (const feature of features) {
        const geom = feature?.geometry;
        if (!geom) continue;
        totalFeatures++;

        if (geom.type === 'Point') hasPointCount++;
        else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') hasPolygonCount++;

        const props = feature?.properties || {};
        const tipo = String(props.tipo || '').toLowerCase();
        const phaseIndex = Number(props.fase_index ?? 0);
        if (tipo === 'mejora') {
            mejoraCnt++;
            byFaseMejora[phaseIndex] = (byFaseMejora[phaseIndex] || 0) + 1;
        } else if (tipo === 'terreno') {
            terrenoCnt++;
            byFaseTerreno[phaseIndex] = (byFaseTerreno[phaseIndex] || 0) + 1;
        }
    }

    return {
        totalFeatures,
        hasPolygonCount,
        hasPointCount,
        byTipo: { mejora: mejoraCnt, terreno: terrenoCnt },
        byFaseMejora,
        byFaseTerreno,
    };
}

function renderCatastroPolygons({ polygons, multipolygons, map, g, showPolygons, onSelectExpediente, overlays, bounds, boundsEmpty }) {
    if (!showPolygons) return { boundsEmpty };

    const renderPolygon = (paths, props) => {
        const { polygonStyle } = getCatastroFeatureVisualContract(props);
        const poly = new g.Polygon({
            map,
            paths,
            ...polygonStyle,
        });
        poly.addListener("click", () => {
            if (onSelectExpediente) onSelectExpediente(props.id_expediente, props);
        });
        overlays.push(poly);
        extendBounds(bounds, paths[0]);
        return false;
    };

    for (const feature of polygons) {
        const geom = feature?.geometry;
        if (!geom?.coordinates) continue;
        const paths = geom.coordinates.map(ringToLatLngs);
        boundsEmpty = renderPolygon(paths, feature.properties || {});
    }

    for (const feature of multipolygons) {
        const geom = feature?.geometry;
        if (!geom?.coordinates) continue;
        for (const polygonCoords of geom.coordinates) {
            const paths = polygonCoords.map(ringToLatLngs);
            boundsEmpty = renderPolygon(paths, feature.properties || {});
        }
    }

    return { boundsEmpty };
}

function buildProgresivasPoints(featureCollection) {
    const feats = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
    return feats.map((feature, index) => ({
        ...feature,
        __tmp_id: index + 1,
    }));
}

function parseApiFetchJsonError(err) {
    const raw = String(err?.message || "").trim();
    if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function isRouteNotFoundError(err) {
    const parsed = parseApiFetchJsonError(err);
    const msg = String(parsed?.message || "").toLowerCase();
    return msg.includes("ruta no encontrada") || msg.includes("not found");
}

export default function GVMapaCatastroGoogle({
    proyectoId,
    filters = {},
    tramoId = null,
    subtramoId = null,
    onStatsChange,
    onSelectExpediente,
    ...props
}) {
    const mapRef = useRef(null);
    const googleRef = useRef(null);
    const overlaysRef = useRef([]);
    const [mapObj, setMapObj] = useState(null);
    const [googleObj, setGoogleObj] = useState(null);
    const [mapReady, setMapReady] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [hasResolvedMapRequest, setHasResolvedMapRequest] = useState(false);
    const [mapShellError, setMapShellError] = useState('');
    const [mapType, setMapType] = useState(() => {
        const saved = localStorage.getItem("gv_map_type");
        return (saved === "roadmap" || saved === "satellite") ? saved : "roadmap";
    });
    const [layerVisibility, setLayerVisibility] = useState({
        points: true,
        polygons: true,
        legend: true,
        tramos: false,
        progresivas: false,
    });
    const [localStats, setLocalStats] = useState({
        totalFeatures: 0,
        hasPolygonCount: 0,
        hasPointCount: 0,
    });
    const [catastroFeatures, setCatastroFeatures] = useState([]);
    const [tramosGeo, setTramosGeo] = useState(null);
    const [tramosLoading, setTramosLoading] = useState(false);
    const [tramosError, setTramosError] = useState('');
    const [progresivasGeo, setProgresivasGeo] = useState(null);
    const [progresivasLoading, setProgresivasLoading] = useState(false);
    const [progresivasError, setProgresivasError] = useState('');
    const [overlayResolution, setOverlayResolution] = useState(null);
    const [overlayMetadata, setOverlayMetadata] = useState(null);
    const [overlayWarnings, setOverlayWarnings] = useState([]);

    const showPoints = !!layerVisibility.points;
    const showPolygons = !!layerVisibility.polygons;
    const showLegend = !!layerVisibility.legend;
    const showTramos = !!layerVisibility.tramos;
    const showProgresivas = !!layerVisibility.progresivas;
    const hasStructuredOverlayFilter = Boolean(Number(subtramoId) || Number(tramoId));
    const progresivasPoints = buildProgresivasPoints(progresivasGeo);
    const catastroPointItems = useMemo(
        () => buildCatastroPointItems(catastroFeatures),
        [catastroFeatures]
    );
    const availablePointsCount = Number(localStats?.hasPointCount || 0);
    const availablePolygonsCount = Number(localStats?.hasPolygonCount || 0);
    const availableTramosCount = Array.isArray(tramosGeo?.features) ? tramosGeo.features.length : 0;
    const availableProgresivasCount = Array.isArray(progresivasGeo?.features) ? progresivasGeo.features.length : 0;
    const renderedPointsCount = showPoints ? availablePointsCount : 0;
    const renderedPolygonsCount = showPolygons ? availablePolygonsCount : 0;
    const renderedTramosCount = showTramos ? availableTramosCount : 0;
    const renderedProgresivasCount = showProgresivas ? availableProgresivasCount : 0;
    const progresivasUnavailableStructurally =
        hasStructuredOverlayFilter &&
        showProgresivas &&
        !progresivasLoading &&
        !progresivasError &&
        availableProgresivasCount === 0 &&
        overlayMetadata?.progresivas_structural_filter_supported === false;
    const overlayCoverageSource = overlayResolution?.resolution_source || overlayMetadata?.resolution_source || null;
    const overlayCoverageStatus = overlayResolution?.coverage_status || overlayMetadata?.coverage_status || null;
    const overlayCoverageReason = overlayResolution?.coverage_reason || overlayMetadata?.coverage_reason || null;
    const isProjectScopeFallback =
        overlayResolution?.is_project_scope_fallback ??
        overlayMetadata?.is_project_scope_fallback ??
        false;
    const isGlobalTramoFallback =
        overlayResolution?.is_global_tramo_fallback ??
        overlayMetadata?.is_global_tramo_fallback ??
        false;
    const overlayFallbackFromSubtramos =
        hasStructuredOverlayFilter &&
        isProjectScopeFallback &&
        overlayCoverageReason === "missing_structural_join_from_subtramos";
    const overlayFallbackNoVialLinks =
        hasStructuredOverlayFilter &&
        isProjectScopeFallback &&
        overlayCoverageReason === "no_vial_links";
    const overlayFallbackDirectWithoutOverlay =
        hasStructuredOverlayFilter &&
        isProjectScopeFallback &&
        overlayCoverageReason === "direct_tramo_without_overlay";
    const overlayResolvedFromSubtramosProxy =
        hasStructuredOverlayFilter &&
        overlayCoverageSource === "subtramos_proxy_a_tramo";
    const overlayResolvedFromGlobalTramoFallback =
        hasStructuredOverlayFilter &&
        isGlobalTramoFallback &&
        overlayCoverageSource === "global_tramo_fallback";
    const overlayNoVialLinksWithoutFallback =
        hasStructuredOverlayFilter &&
        !isProjectScopeFallback &&
        overlayCoverageStatus === "none" &&
        overlayCoverageReason === "no_vial_links";
    const [subtramosFallbackNoticeDismissed, setSubtramosFallbackNoticeDismissed] = useState(false);
    const totalAvailableCount =
        availablePointsCount +
        availablePolygonsCount +
        availableTramosCount +
        availableProgresivasCount;
    const hasAnyGeometry = totalAvailableCount > 0;
    const hasVisibleGeometry =
        (showPoints && availablePointsCount > 0) ||
        (showPolygons && availablePolygonsCount > 0) ||
        (showTramos && availableTramosCount > 0) ||
        (showProgresivas && availableProgresivasCount > 0);
    const layerItems = [
        {
            key: "points",
            label: "Puntos",
            visible: showPoints,
            enabled: true,
            count: availablePointsCount,
        },
        {
            key: "polygons",
            label: "Poligonos",
            visible: showPolygons,
            enabled: true,
            count: availablePolygonsCount,
        },
        {
            key: "legend",
            label: "Leyenda",
            visible: showLegend,
            enabled: true,
        },
        {
            key: "tramos",
            label: "Tramos",
            visible: showTramos,
            enabled: true,
            count: availableTramosCount,
        },
        {
            key: "progresivas",
            label: "Progresivas",
            visible: showProgresivas,
            enabled: true,
            count: availableProgresivasCount,
        },
    ];
    const chipStyle = {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "6px 10px",
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(148,163,184,0.35)",
        boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
        color: "#0f172a",
        fontSize: 11,
        fontWeight: 700,
    };
    const toolbarContent = (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 12,
                borderRadius: 14,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(148,163,184,0.28)",
                boxShadow: "0 16px 34px rgba(15,23,42,0.12)",
                backdropFilter: "blur(8px)",
                maxWidth: 560,
            }}
        >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <div className="btn-group btn-group-sm" role="group" aria-label="Tipo de mapa">
                    <button
                        type="button"
                        className={`btn ${mapType === "roadmap" ? "btn-primary" : "btn-outline-primary"}`}
                        onClick={() => setMapType("roadmap")}
                    >
                        Mapa
                    </button>
                    <button
                        type="button"
                        className={`btn ${mapType === "satellite" ? "btn-primary" : "btn-outline-primary"}`}
                        onClick={() => setMapType("satellite")}
                    >
                        Satelite
                    </button>
                </div>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#475569",
                        whiteSpace: "nowrap",
                    }}
                >
                    Poligono si existe, si no punto
                </span>
            </div>
            <GVAMapLayerSelector
                layers={layerItems}
                compact
                onToggleLayer={(key) => {
                    setLayerVisibility((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                    }));
                }}
            />
        </div>
    );
    let topMessage = "";
    let topTone = {
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(148,163,184,0.35)",
        color: "#0f172a",
    };

    if (mapShellError) {
        topMessage = mapShellError;
        topTone = {
            background: "rgba(254,242,242,0.96)",
            border: "1px solid rgba(248,113,113,0.35)",
            color: "#991b1b",
        };
    } else if (error) {
        topMessage = error;
        topTone = {
            background: "rgba(254,242,242,0.96)",
            border: "1px solid rgba(248,113,113,0.35)",
            color: "#991b1b",
        };
    } else if (showTramos && tramosError) {
        topMessage = tramosError;
        topTone = {
            background: "rgba(254,242,242,0.96)",
            border: "1px solid rgba(248,113,113,0.35)",
            color: "#991b1b",
        };
    } else if (showProgresivas && progresivasError) {
        topMessage = progresivasError;
        topTone = {
            background: "rgba(254,242,242,0.96)",
            border: "1px solid rgba(248,113,113,0.35)",
            color: "#991b1b",
        };
    } else if (loading) {
        topMessage = "Cargando geometria base del proyecto...";
    } else if (showTramos && tramosLoading) {
        topMessage = "Cargando capa de tramos...";
    } else if (showProgresivas && progresivasLoading) {
        topMessage = "Cargando capa de progresivas...";
    } else if (overlayResolvedFromSubtramosProxy) {
        topMessage = "La cobertura del tramo fue resuelta usando los vínculos viales asociados a sus subtramos.";
        topTone = {
            background: "rgba(239,246,255,0.95)",
            border: "1px solid rgba(59,130,246,0.3)",
            color: "#1e3a8a",
        };
    } else if (overlayResolvedFromGlobalTramoFallback) {
        topMessage = "La cobertura mostrada fue resuelta por coincidencia global de tramo, no por geometría acotada al proyecto.";
        topTone = {
            background: "rgba(239,246,255,0.95)",
            border: "1px solid rgba(59,130,246,0.3)",
            color: "#1e3a8a",
        };
    } else if (overlayFallbackFromSubtramos && !subtramosFallbackNoticeDismissed) {
        topMessage =
            "No se pudo dibujar cobertura específica del tramo. Se muestra la red vial completa del proyecto como referencia visual.";
        topTone = {
            background: "rgba(255,251,235,0.96)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#92400e",
        };
    } else if (overlayFallbackNoVialLinks) {
        topMessage =
            "Este tramo no tiene vínculo vial resoluble. Se muestra la red vial completa del proyecto como referencia visual.";
        topTone = {
            background: "rgba(255,251,235,0.96)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#92400e",
        };
    } else if (overlayFallbackDirectWithoutOverlay) {
        topMessage =
            "No se encontró cobertura específica del tramo. Se muestra la red vial completa del proyecto como referencia visual.";
        topTone = {
            background: "rgba(255,251,235,0.96)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#92400e",
        };
    } else if (overlayNoVialLinksWithoutFallback) {
        topMessage = "Este tramo no tiene vínculo vial asociado.";
        topTone = {
            background: "rgba(255,251,235,0.96)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#92400e",
        };
    } else if (progresivasUnavailableStructurally) {
        topMessage = "No hay progresivas filtrables estructuralmente para el tramo/subtramo actual.";
        topTone = {
            background: "rgba(255,251,235,0.96)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#92400e",
        };
    } else if (hasResolvedMapRequest && !loading && !hasAnyGeometry) {
        topMessage = "No hay elementos georreferenciados disponibles para los filtros actuales.";
    }

    const overlayTopContent = topMessage ? (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 11,
                fontWeight: 700,
                boxShadow: "0 8px 18px rgba(15,23,42,0.08)",
                ...topTone,
            }}
        >
            <span>{topMessage}</span>
        </div>
    ) : null;

    const overlayBottomContent = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {hasStructuredOverlayFilter && overlayResolution?.resolution_mode && (
                <div style={chipStyle}>
                    <span>Scope vial</span>
                    <span>{overlayResolution.resolution_mode}</span>
                </div>
            )}
            {hasStructuredOverlayFilter && overlayCoverageSource && (
                <div style={chipStyle}>
                    <span>Cobertura</span>
                    <span>{overlayCoverageSource}</span>
                </div>
            )}
            {overlayWarnings.length > 0 && (
                <div style={chipStyle}>
                    <span>Overlay</span>
                    <span>{overlayWarnings.length} aviso(s)</span>
                </div>
            )}
        </div>
    );

    useEffect(() => {
        return () => {
            // Limpiar overlays al desmontar
            cleanupCatastroOverlays(overlaysRef);
            mapRef.current = null;
            googleRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!overlayFallbackFromSubtramos) {
            setSubtramosFallbackNoticeDismissed(false);
            return;
        }
        setSubtramosFallbackNoticeDismissed(false);
        const t = setTimeout(() => setSubtramosFallbackNoticeDismissed(true), 3000);
        return () => clearTimeout(t);
    }, [overlayFallbackFromSubtramos]);

    const handleMapReady = ({ map, google, ready, error: shellError }) => {
        mapRef.current = map || null;
        googleRef.current = google || null;
        setMapObj(map || null);
        setGoogleObj(google || null);
        setMapReady(!!ready && !!map && !!google);
        setMapShellError(shellError || '');

        if (map && google) {
            // Sincronizar estado de panning para la interfaz flotante
            google.maps.event.addListener(map, 'dragstart', () => {
                if (props.onPanningChange) props.onPanningChange(true);
            });
            google.maps.event.addListener(map, 'idle', () => {
                if (props.onPanningChange) props.onPanningChange(false);
            });

            // Sincronizar tipo de mapa para Adaptive Theming
            google.maps.event.addListener(map, 'maptypeid_changed', () => {
                if (props.onMapTypeChange) props.onMapTypeChange(map.getMapTypeId());
            });
            // Emitir inicial
            if (props.onMapTypeChange) props.onMapTypeChange(map.getMapTypeId());
        }
    };

    /* 1.1 Sincronizar tipo de mapa */
    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.setMapTypeId(mapType);
            localStorage.setItem("gv_map_type", mapType);
        }
    }, [mapType]);

    useEffect(() => {
        if ((!showTramos && !showProgresivas) || !proyectoId) return;

        let cancelled = false;
        setOverlayWarnings([]);
        setOverlayResolution(null);
        setOverlayMetadata(null);
        setTramosError('');
        setProgresivasError('');
        setTramosLoading(showTramos);
        setProgresivasLoading(showProgresivas);

        (async () => {
            try {
                const response = await gvGetCatastroVialOverlay({
                    proyectoId,
                    tramoId: tramoId || undefined,
                    subtramoId: subtramoId || undefined,
                });
                if (cancelled) return;

                setTramosGeo(response?.tramos || { type: "FeatureCollection", features: [] });
                setProgresivasGeo(response?.progresivas || { type: "FeatureCollection", features: [] });
                setOverlayResolution(response?.resolution || null);
                setOverlayMetadata(response?.metadata || null);
                setOverlayWarnings(Array.isArray(response?.warnings) ? response.warnings : []);
            } catch (e) {
                if (cancelled) return;

                // Degradacion segura:
                // - Sin filtro estructural: fallback a endpoints por proyecto completo
                // - Con filtro estructural: no inventar filtrado; reportar error
                if (isRouteNotFoundError(e) && !hasStructuredOverlayFilter) {
                    try {
                        const [tramosFc, progFc] = await Promise.all([
                            showTramos ? fetchTramosGeojson(proyectoId) : Promise.resolve(null),
                            showProgresivas ? fetchProgresivasGeojson(proyectoId) : Promise.resolve(null),
                        ]);

                        if (cancelled) return;
                        if (showTramos) setTramosGeo(tramosFc || { type: "FeatureCollection", features: [] });
                        if (showProgresivas)
                            setProgresivasGeo(progFc || { type: "FeatureCollection", features: [] });
                        setOverlayResolution({ resolution_mode: "project" });
                        setOverlayMetadata({
                            tramos_scope_mode: "project_full_legacy",
                            progresivas_scope_mode: "project_full_legacy",
                            progresivas_structural_filter_supported: true,
                        });
                        setOverlayWarnings([]);
                        return;
                    } catch (fallbackError) {
                        const message = String(fallbackError?.message || fallbackError);
                        if (showTramos) setTramosError(message);
                        if (showProgresivas) setProgresivasError(message);
                    }
                } else {
                    const message = String(e?.message || e);
                    if (showTramos) setTramosError(message);
                    if (showProgresivas) setProgresivasError(message);
                }

                setTramosGeo({ type: "FeatureCollection", features: [] });
                setProgresivasGeo({ type: "FeatureCollection", features: [] });
                setOverlayResolution(null);
                setOverlayMetadata(null);
                setOverlayWarnings([]);
            } finally {
                if (!cancelled) {
                    setTramosLoading(false);
                    setProgresivasLoading(false);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [showTramos, showProgresivas, proyectoId, tramoId, subtramoId]);

    /* 2. Cargar y renderizar features cuando cambian filtros */
    // Construimos una clave estable para el efecto
    const filtersKey = JSON.stringify(filters);

    useEffect(() => {
        if (!mapReady || !mapRef.current || !proyectoId || !googleRef.current?.maps) return;

        let cancelled = false;

        // Limpiar overlays anteriores
        cleanupCatastroOverlays(overlaysRef);
        setCatastroFeatures([]);
        setHasResolvedMapRequest(false);

        setLoading(true);
        setError('');

        (async () => {
            try {
                const geojson = await fetchCatastroMap({ proyectoId, filters });
                if (cancelled) return;

                const features = geojson?.features || [];
                const map = mapRef.current;
                const g = googleRef.current.maps;
                const bounds = new g.LatLngBounds();
                const buckets = buildCatastroFeatureBuckets(features);
                const stats = computeCatastroStats(features);
                
                // 1. Incluir Notificaciones (Puntos y Polígonos)
                extendBoundsWithGeojson(geojson, bounds, g);

                // 2. Incluir Capas Viales (Tramos y Progresivas) para encuadre contextual
                if (showTramos) extendBoundsWithGeojson(tramosGeo, bounds, g);
                if (showProgresivas) extendBoundsWithGeojson(progresivasGeo, bounds, g);

                if (!bounds.isEmpty()) {
                    // Transición fluida con padding
                    map.fitBounds(bounds, {
                        top: 50,
                        right: 50,
                        bottom: 50,
                        left: 50
                    });

                    // SMART ZOOM: Evitar zoom extremo en registros únicos
                    const idleListener = g.event.addListenerOnce(map, 'idle', () => {
                        if (map.getZoom() > 16) {
                            map.setZoom(16);
                        }
                    });
                }

                setCatastroFeatures(features);
                setLocalStats({
                    totalFeatures: stats.totalFeatures,
                    hasPolygonCount: stats.hasPolygonCount,
                    hasPointCount: stats.hasPointCount,
                });
                if (onStatsChange) {
                    onStatsChange(stats);
                }

            } catch (e) {
                if (!cancelled) setError(e?.message || 'Error cargando features del mapa');
                if (!cancelled && onStatsChange) {
                    onStatsChange({ totalFeatures: 0, hasPolygonCount: 0, hasPointCount: 0, byTipo: { mejora: 0, terreno: 0 } });
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setHasResolvedMapRequest(true);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [mapReady, proyectoId, filtersKey, showPoints, showPolygons, tramosGeo, progresivasGeo]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <GVAMapBase
            height={450}
            mapTypeId={mapType}
            fullscreenEnabled
            toolbar={toolbarContent}
            overlayTop={overlayTopContent}
            overlayBottom={overlayBottomContent}
            onReady={handleMapReady}
        >
            {() => (
                <>
                    {loading && (
                        <div
                            className="position-absolute top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center"
                            style={{ backgroundColor: 'rgba(255,255,255,0.65)', zIndex: 10 }}
                        >
                            <div className="spinner-border text-primary" role="status">
                                <span className="visually-hidden">Cargando...</span>
                            </div>
                        </div>
                    )}
                    
                    {/* Renderizado de capas viales y puntos (omitted for brevity in this replace call, but keeping logic) */}
                    {showTramos && (
                        <GVAMapDataLayer
                            map={mapObj}
                            google={googleObj}
                            data={tramosGeo}
                            visible={showTramos}
                            defaultStyle={{
                                strokeColor: "#1d4ed8",
                                strokeOpacity: 0.85,
                                strokeWeight: 3,
                                fillColor: "#93c5fd",
                                fillOpacity: 0.18,
                                clickable: false,
                            }}
                            activeStyle={{
                                strokeColor: "#1e3a8a",
                                strokeOpacity: 1,
                                strokeWeight: 4,
                                fillColor: "#60a5fa",
                                fillOpacity: 0.28,
                            }}
                            zIndex={700}
                        />
                    )}

                    <GVAMapPointLayer
                        map={mapObj}
                        google={googleObj}
                        points={catastroPointItems}
                        visible={showPoints}
                        enablePopup={false}
                        onPointClick={(feature) => {
                            if (!onSelectExpediente) return;
                            onSelectExpediente(feature?.properties?.id_expediente, feature?.properties);
                        }}
                        getPointInfo={(feature) => {
                            const geom = feature?.geometry;
                            const coords = Array.isArray(geom?.coordinates) ? geom.coordinates : [];
                            const lng = coords?.[0];
                            const lat = coords?.[1];
                            const identity = getCatastroFeatureIdentity(feature);
                            const { pointStyle } = getCatastroFeatureVisualContract(identity.props);
                            return {
                                id: identity.id,
                                lat,
                                lng,
                                title: identity.title,
                                color: pointStyle.color,
                                borderColor: pointStyle.borderColor,
                                rows: [],
                                actionLabel: null,
                            };
                        }}
                    />

                    {showProgresivas && (
                        <GVAMapPointLayer
                            map={mapObj}
                            google={googleObj}
                            points={progresivasPoints}
                            visible={showProgresivas}
                            showLabel
                            labelMinZoom={16}
                            getPointInfo={(feature) => {
                                const geom = feature?.geometry;
                                const coords = Array.isArray(geom?.coordinates) ? geom.coordinates : [];
                                const lng = coords?.[0];
                                const lat = coords?.[1];
                                const props = feature?.properties || {};
                                return {
                                    id: Number(props?.id_progresiva || props?.id || feature?.__tmp_id || 0),
                                    lat,
                                    lng,
                                    title: props?.nombre || "Progresiva",
                                    color: "#f97316",
                                    rows: [],
                                    actionLabel: null,
                                };
                            }}
                        />
                    )}

                    {/* Leyenda integrada como overlay flotante si está activa */}
                    {showLegend && (
                        <div 
                            className="position-absolute shadow-lg bg-white rounded-3 p-3 gv-scrollbar" 
                            style={{ 
                                bottom: 65, 
                                right: 15, 
                                zIndex: 10, 
                                maxWidth: '280px', 
                                maxHeight: '300px', 
                                overflowY: 'auto',
                                border: '1px solid rgba(0,0,0,0.05)'
                            }}
                        >
                            <h6 className="small fw-bold border-bottom pb-2 mb-2 text-dark">Leyenda Notificaciones</h6>
                            <GvLegend phaseTotalMejora={5} phaseTotalTerreno={7} compact />
                        </div>
                    )}
                </>
            )}
        </GVAMapBase>
    );
}



