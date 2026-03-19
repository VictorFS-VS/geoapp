// src/modules/gv/GVMapaCatastroGoogle.jsx
// Mapa GV usando Google Maps JS (mismo stack que /visor-full)
// Props: proyectoId, filters, onStatsChange
import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMapsApi } from '@/utils/loadGoogleMapsApi';
import { fetchCatastroMap } from './gv_map_service';
import { getPhaseHex, getPhaseBorderHex } from './gv_colors';
import GvLegend from './GvLegend';

const API_KEY =
    import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_GMAPS_API_KEY;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;

/** Convierte un anillo GeoJSON [[lng,lat],...] a array de LatLng literales */
function ringToLatLngs(ring) {
    return ring.map(([lng, lat]) => ({ lat, lng }));
}

/** Agrega bounds a partir de un array de LatLng literales */
function extendBounds(bounds, pts) {
    for (const p of pts) bounds.extend(p);
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

export default function GVMapaCatastroGoogle({ proyectoId, filters = {}, onStatsChange, onSelectExpediente }) {
    const mapDivRef = useRef(null);
    const mapRef = useRef(null);
    const overlaysRef = useRef([]);
    const [mapReady, setMapReady] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mapType, setMapType] = useState(() => {
        const saved = localStorage.getItem("gv_map_type");
        return (saved === "roadmap" || saved === "satellite") ? saved : "roadmap";
    });

    /* ── 1. Inicializar Google Maps (una sola vez) ── */
    useEffect(() => {
        if (!API_KEY) {
            setError('Falta VITE_GOOGLE_MAPS_KEY en .env');
            return;
        }
        let cancelled = false;

        (async () => {
            try {
                await loadGoogleMapsApi(API_KEY);
                if (cancelled || !mapDivRef.current) return;

                const map = new window.google.maps.Map(mapDivRef.current, {
                    center: { lat: -25.3, lng: -57.6 },
                    zoom: 9,
                    mapId: MAP_ID || undefined,
                    mapTypeId: mapType,
                    clickableIcons: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    mapTypeControl: false,
                });

                mapRef.current = map;
                setMapReady(true);
            } catch (e) {
                if (!cancelled) setError(e?.message || 'Error inicializando Google Maps');
            }
        })();

        return () => {
            cancelled = true;
            // Limpiar overlays al desmontar
            for (const o of overlaysRef.current) {
                clearOverlay(o);
            }
            overlaysRef.current = [];
            mapRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ── 1.1 Sincronizar tipo de mapa ── */
    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.setMapTypeId(mapType);
            localStorage.setItem("gv_map_type", mapType);
        }
    }, [mapType]);

    /* ── 2. Cargar y renderizar features cuando cambian filtros ── */
    // Construimos una clave estable para el efecto
    const filtersKey = JSON.stringify(filters);

    useEffect(() => {
        if (!mapReady || !mapRef.current || !proyectoId) return;

        let cancelled = false;

        // Limpiar overlays anteriores
        for (const o of overlaysRef.current) {
            clearOverlay(o);
        }
        overlaysRef.current = [];

        setLoading(true);
        setError('');

        (async () => {
            try {
                const geojson = await fetchCatastroMap({ proyectoId, filters });
                if (cancelled) return;

                const features = geojson?.features || [];
                const map = mapRef.current;
                const g = window.google.maps;
                const markerLib = await g.importLibrary("marker");
                const { AdvancedMarkerElement } = markerLib || {};
                const bounds = new g.LatLngBounds();
                let boundsEmpty = true;

                let totalFeatures = 0;
                let hasPolygonCount = 0;
                let hasPointCount = 0;
                const byFaseMejora = {};
                const byFaseTerreno = {};
                let mejoraCnt = 0;
                let terrenoCnt = 0;

                for (const feature of features) {
                    const geom = feature.geometry;
                    if (!geom) continue;

                    const props = feature.properties || {};
                    const phaseIndex = Number(props.fase_index ?? 0);
                    const phaseTotal = Number(props.fase_total ?? 1);
                    const tipoRaw = String(props.tipo || '').toLowerCase();
                    const isKnownTipo = tipoRaw === "mejora" || tipoRaw === "terreno";
                    const tipo = tipoRaw || "sin_iniciar";

                    const fillHex = isKnownTipo ? getPhaseHex(phaseIndex, phaseTotal) : "#9ca3af";
                    const borderHex = isKnownTipo ? (getPhaseBorderHex(phaseIndex) || fillHex) : "#6b7280";

                    // Stats
                    totalFeatures++;
                    if (tipo === 'mejora') {
                        mejoraCnt++;
                        byFaseMejora[phaseIndex] = (byFaseMejora[phaseIndex] || 0) + 1;
                    } else if (tipo === 'terreno') {
                        terrenoCnt++;
                        byFaseTerreno[phaseIndex] = (byFaseTerreno[phaseIndex] || 0) + 1;
                    }

                    if (geom.type === 'Point') {
                        hasPointCount++;
                        const [lng, lat] = geom.coordinates;
                        if (!AdvancedMarkerElement) continue;

                        const markerEl = document.createElement("div");
                        markerEl.style.width = "12px";
                        markerEl.style.height = "12px";
                        markerEl.style.borderRadius = "999px";
                        markerEl.style.background = fillHex;
                        markerEl.style.border = `2px solid ${borderHex}`;
                        markerEl.style.boxShadow = "0 2px 8px rgba(0,0,0,.22)";
                        markerEl.style.pointerEvents = "none";

                        const marker = new AdvancedMarkerElement({
                            map,
                            position: { lat, lng },
                            content: markerEl,
                            title: String(props?.padron || props?.titulo || props?.id_expediente || "Expediente"),
                        });
                        marker.addListener('gmp-click', () => {
                            if (onSelectExpediente) onSelectExpediente(feature.properties.id_expediente, feature.properties);
                        });
                        overlaysRef.current.push(marker);
                        bounds.extend({ lat, lng });
                        boundsEmpty = false;

                    } else if (geom.type === 'Polygon') {
                        hasPolygonCount++;
                        // coordinates: [outerRing, ...holeRings]
                        const paths = geom.coordinates.map(ringToLatLngs);
                        const poly = new g.Polygon({
                            map,
                            paths,
                            fillColor: fillHex,
                            fillOpacity: 0.6,
                            strokeColor: borderHex,
                            strokeOpacity: 1,
                            strokeWeight: 3,
                            zIndex: 900,
                        });
                        poly.addListener("click", () => {
                            if (onSelectExpediente) onSelectExpediente(feature.properties.id_expediente, feature.properties);
                        });
                        overlaysRef.current.push(poly);
                        extendBounds(bounds, paths[0]);
                        boundsEmpty = false;

                    } else if (geom.type === 'MultiPolygon') {
                        hasPolygonCount++;
                        // Each entry is a polygon (array of rings)
                        for (const polygonCoords of geom.coordinates) {
                            const paths = polygonCoords.map(ringToLatLngs);
                            const poly = new g.Polygon({
                                map,
                                paths,
                                fillColor: fillHex,
                                fillOpacity: 0.6,
                                strokeColor: borderHex,
                                strokeOpacity: 1,
                                strokeWeight: 3,
                                zIndex: 900,
                            });
                            poly.addListener("click", () => {
                                if (onSelectExpediente) onSelectExpediente(feature.properties.id_expediente, feature.properties);
                            });
                            overlaysRef.current.push(poly);
                            extendBounds(bounds, paths[0]);
                            boundsEmpty = false;
                        }
                    }
                }

                if (!boundsEmpty) {
                    map.fitBounds(bounds, 40);
                }

                if (onStatsChange) {
                    onStatsChange({
                        totalFeatures,
                        hasPolygonCount,
                        hasPointCount,
                        byTipo: { mejora: mejoraCnt, terreno: terrenoCnt },
                        byFaseMejora,
                        byFaseTerreno,
                    });
                }

            } catch (e) {
                if (!cancelled) setError(e?.message || 'Error cargando features del mapa');
                if (!cancelled && onStatsChange) {
                    onStatsChange({ totalFeatures: 0, hasPolygonCount: 0, hasPointCount: 0, byTipo: { mejora: 0, terreno: 0 } });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [mapReady, proyectoId, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="card shadow-sm mt-4">
            <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                    <h5 className="mb-0">Mapa Catastro</h5>
                    <div className="d-flex align-items-center gap-3">
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
                                Satélite
                            </button>
                        </div>
                        <small className="gv-muted">Polígono si existe, si no punto</small>
                    </div>
                </div>

                {error && <div className="alert alert-danger py-2">{error}</div>}

                <div className="position-relative" style={{ width: '100%', height: 520 }}>
                    {/* Spinner overlay mientras carga */}
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
                    {/* Contenedor del mapa Google */}
                    <div
                        ref={mapDivRef}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>

                <div className="mt-3">
                    <GvLegend phaseTotalMejora={5} phaseTotalTerreno={7} />
                </div>
            </div>
        </div>
    );
}
