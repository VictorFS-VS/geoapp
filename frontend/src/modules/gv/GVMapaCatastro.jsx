import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { getPhaseHex, getPhaseBorderHex } from './gv_colors';
import { fetchCatastroMap } from './gv_map_service';
import GvLegend from './GvLegend';

export default function GVMapaCatastro({ proyectoId, filters = {}, onStatsChange }) {
    const mapRef = useRef(null);
    const [map, setMap] = useState(null);
    const [vectorSource] = useState(new VectorSource());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // 1. Inicializar mapa una sola vez
    useEffect(() => {
        if (!mapRef.current) return;

        const baseLayer = new TileLayer({
            source: new OSM(),
        });

        const vLayer = new VectorLayer({
            source: vectorSource,
            style: (feature) => {
                const props = feature.getProperties();
                const geomType = feature.getGeometry().getType();
                const i = Number(props.fase_index ?? 0);
                const total = Number(props.fase_total ?? 1);

                const hexBg = getPhaseHex(i, total);
                const hexBorder = getPhaseBorderHex(i) || hexBg;

                if (geomType === 'Point' || geomType === 'MultiPoint') {
                    return new Style({
                        image: new CircleStyle({
                            radius: 6,
                            fill: new Fill({ color: hexBg }),
                            stroke: new Stroke({ color: hexBorder, width: 2 })
                        })
                    });
                }

                // Polygons
                return new Style({
                    fill: new Fill({ color: hexBg + '2E' }), // hex + 18% approx opacity
                    stroke: new Stroke({ color: hexBorder, width: 2 })
                });
            }
        });

        const initialMap = new Map({
            target: mapRef.current,
            layers: [baseLayer, vLayer],
            view: new View({
                center: [0, 0],
                zoom: 2,
                projection: 'EPSG:3857'
            })
        });

        setMap(initialMap);

        return () => {
            initialMap.setTarget(null);
        };
    }, [vectorSource]);

    // 2. Fetch de datos cuando cambian los filtros o proyectoId
    useEffect(() => {
        if (!proyectoId || !map) return;

        let isSubscribed = true;

        async function loadMapData() {
            try {
                setLoading(true);
                setError(null);
                vectorSource.clear();

                const fc = await fetchCatastroMap({ proyectoId, filters });

                if (!isSubscribed) return;

                if (fc && fc.features && fc.features.length > 0) {
                    const format = new GeoJSON();
                    const features = format.readFeatures(fc, {
                        dataProjection: 'EPSG:4326',
                        featureProjection: 'EPSG:3857'
                    });

                    vectorSource.addFeatures(features);

                    // Ajustar vista
                    const extent = vectorSource.getExtent();
                    map.getView().fit(extent, { padding: [50, 50, 50, 50], maxZoom: 18 });

                    // Opcional: Calcular stats básicos
                    if (onStatsChange) {
                        let polyCount = 0;
                        let ptCount = 0;
                        const byMejora = {};
                        const byTerreno = {};
                        let countMejora = 0;
                        let countTerreno = 0;

                        features.forEach(f => {
                            const p = f.getProperties();
                            if (p.has_polygon) polyCount++;
                            else if (p.has_point) ptCount++;

                            const fi = p.fase_index || 0;
                            if (p.tipo === 'mejora') {
                                countMejora++;
                                byMejora[fi] = (byMejora[fi] || 0) + 1;
                            } else if (p.tipo === 'terreno') {
                                countTerreno++;
                                byTerreno[fi] = (byTerreno[fi] || 0) + 1;
                            }
                        });

                        onStatsChange({
                            totalFeatures: features.length,
                            hasPolygonCount: polyCount,
                            hasPointCount: ptCount,
                            byTipo: { mejora: countMejora, terreno: countTerreno },
                            byFaseMejora: byMejora,
                            byFaseTerreno: byTerreno
                        });
                    }
                } else {
                    // Vacío
                    if (onStatsChange) {
                        onStatsChange({
                            totalFeatures: 0, hasPolygonCount: 0, hasPointCount: 0,
                            byTipo: { mejora: 0, terreno: 0 }
                        });
                    }
                }
            } catch (err) {
                if (isSubscribed) setError(err.message || "Error al cargar features del mapa");
            } finally {
                if (isSubscribed) setLoading(false);
            }
        }

        loadMapData();

        return () => { isSubscribed = false; };
    }, [proyectoId, filters, map, vectorSource, onStatsChange]);

    return (
        <div className="card shadow-sm mt-4">
            <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                    <h5 className="mb-0">Mapa Catastro</h5>
                    <small className="gv-muted">Polígono si existe, si no punto</small>
                </div>

                {error && <div className="alert alert-danger py-2">{error}</div>}

                <div
                    ref={mapRef}
                    className="gv-map-container position-relative"
                    style={{ height: 520 }}
                >
                    {loading && (
                        <div className="position-absolute top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center" style={{ backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 10 }}>
                            <div className="spinner-border text-primary" role="status">
                                <span className="visually-hidden">Cargando...</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-3">
                    <GvLegend phaseTotalMejora={5} phaseTotalTerreno={7} />
                </div>
            </div>
        </div>
    );
}
