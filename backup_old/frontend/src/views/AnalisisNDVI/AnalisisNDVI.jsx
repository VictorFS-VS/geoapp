// src/views/AnalisisNDVI/AnalisisNDVI.jsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './AnalisisNDVI.css';
import '@/styles/FullScreenVisor.theme.css';

import Navbar from '@/components/Navbar';
import LegendPanel from '@/components/LegendPanel';

import { Box, Typography, Slider, LinearProgress } from '@mui/material';

import GeoJSONFormat from 'ol/format/GeoJSON';
import WKT from 'ol/format/WKT';

import * as turf from '@turf/turf';

import { loadGoogleMapsApi } from '@/utils/loadGoogleMapsApi';

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";
const GMAPS_API_KEY = import.meta.env.VITE_GMAPS_API_KEY;     // ✅ coincide con .env
const GMAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;      // ✅ estilo de mapa

/* ===== Rutas ===== */
const VISOR_ROUTE_BASE = '/visor-full';

/* ===== Sentinel ===== */
const instanceId = '0baff9f5-a1a3-4238-9387-2779558d8633';
const agricolaLayerName = '2_TONEMAPPED_NATURAL_COLOR';
const ndviLayerName = 'B08_B04_RGB';
const wmsBaseUrl = `https://services.sentinel-hub.com/ogc/wms/${instanceId}`;
const catalogBaseUrl = 'https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search';

/* Parámetros base */
const searchWindowDays = 45;
const maxCloudCoverageForBest = 15;

// ✅ NUEVO (lógica de nubes por AOI)
const MAX_CLOUD_PCT_AOI = 5;           // objetivo “casi 0 nubes” sobre el área real
const AOI_CLOUD_SAMPLE_SIZE = 256;     // muestreo (rápido) para estimar nubes sobre AOI
const AOI_MAX_CANDIDATES = 18;         // cuántas escenas probamos por mes/año (ordenadas por escena-cloud)
const AOI_FALLBACK_PCT = 12;           // si no hay ninguna <=5%, intenta hasta 12% (con aviso)

/* Tamaño de imagen ADAPTATIVO */
const IMG_SIZE = (() => {
  const cores = navigator?.hardwareConcurrency || 4;
  if (cores >= 8) return 1200;
  if (cores >= 6) return 1000;
  return 900;
})();

/* 👇 Nombres de meses para el select */
const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/* ======================= Normalización + colores ======================= */
const normalizeString = (str = '') =>
  str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');

const TARGET_USES = [
  'bosques de reserva forestal',
  'bosque de reserva forestal',
  'bosques protectores de cauces hidricos',
  'zonas de proteccion de cauces hidricos',
  'zonas de restriccion en margenes de cauces hidricos',
  'area silvestre protegida',
  'servicios ambientales'
].map(normalizeString);

const WATER_KEYS = [
  'cuerpos de agua','canales','esteros','manantiales','zona inundable','isletas',
  'rio','río','rios','ríos','arroyo','arroyos','laguna','lagunas','lago','lagos',
  'cauce','cauce hidrico','cauce hídrico','cauces hidricos','cauces hídricos'
].map(normalizeString);

const WATER_BUFFER_M = 25;
const EDGE_EROSION_M = 15;
const MIN_CLUSTER_AREA_HA = 0.25;

const COLORS = {
  "bosques de reserva forestal": [38,115,0],
  "bosques excedentes de reserva forestal": [112,168,0],
  "bosques de reserva forestal bajo manejo": [92,137,68],
  "bosques protectores de cauces hidricos": [190,232,255],
  "zonas de proteccion de cauces hidricos": [122,245,202],
  "zona de restriccion en margenes de cauces hidricos": [0,230,169],
  "barreras vivas de proteccion": [230,152,0],
  "franjas de separacion": [230,152,0],
  "caminos cortafuego": [245,202,122],
  "area en regeneracion": [165,245,122],
  "area a reforestar": [137,205,102],
  "area silvestre protegida": [115,76,0],
  "uso agricola": [255,255,0],
  "uso ganadero": [205,102,153],
  "uso agropecuario": [255,211,127],
  arrozales:[255,255,190],
  canales:[0,132,168],
  "plantaciones forestales":[0,168,132],
  "uso silvopastoril":[163,255,115],
  "campo natural":[205,245,122],
  matorrales:[114,137,68],
  "cuerpos de agua":[0,92,230],
  esteros:[0,169,230],
  manantiales:[0,76,115],
  "zona inundable":[115,223,255],
  "cultivos ilegales":[169,0,230],
  "area invadida":[202,122,245],
  "area siniestrada":[230,0,169],
  loteamientos:[130,130,130],
  "contribucion inmobiliaria obligatoria":[115,115,0],
  "construcciones edilicias":[225,225,225],
  cementerio:[190,210,255],
  "area de destape":[205,137,102],
  oleria:[245,122,182],
  "area de prestamo":[215,176,158],
  arenera:[245,245,122],
  "area de nivelacion":[215,215,158],
  polvorin:[178,178,178],
  "planta trituradora":[230,230,0],
  "planta asfaltica":[115,0,0],
  "area de maniobra y estacionamiento":[255,255,255],
  caminos:[225,190,190],
  "pista de aterrizaje":[232,190,255],
  "estacion de servicio":[223,115,255],
  silo:[68,79,137],
  deposito:[122,182,245],
  "area de acopio":[102,119,205],
  corrales:[245,202,122],
  galpones:[68,101,137],
  "abastecimiento de agua":[190,255,232],
  canchadas:[205,102,102],
  puerto:[137,68,101],
  "area industrial":[255,127,127],
  infraestructura:[168,0,0],
  "fosa o trinchera":[168,0,132],
  "area de segregacion":[122,142,245],
  "pileta de agregar uso":[102,205,171],
  "area de servidumbre":[112,68,137],
  "resto de propiedad":[255,255,255],
  "servicios ambientales":[170,255,0],
  "comunidades indigenas":[137,90,68],
  "otros usos":[158,187,215],
  isletas:[152,230,0],
};

const DEFAULT_ACT = [255,165,0];
const DEFAULT_ALT = [0,128,0];

/* ============================ KPI ============================ */
function KpiDonut({ pct, color }) {
  const r = 18, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return (
    <div className="kpi-donut">
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle className="bg" cx="22" cy="22" r={r} />
        <circle
          className="ring"
          cx="22" cy="22" r={r}
          style={{ strokeDasharray: `${(p / 100) * c} ${c}`, stroke: color }}
        />
      </svg>
    </div>
  );
}

function KpiBar({ show, data }) {
  if (!show || !data) return null;
  const { total, gt2, oneToTwo, halfToOne, lte05, pGt2, pOneToTwo, pHalfToOne, pLte05 } = data;
  return (
    <div className="fsv-kpibar">
      <div className="kpi-card kpi-total">
        <div className="kpi-top">Total</div><div className="kpi-sub">Áreas de cambio</div>
        <div className="kpi-val">({total.toLocaleString('es')})</div>
      </div>
      <div className="kpi-card">
        <KpiDonut pct={pGt2} color="#ff2600" />
        <div className="kpi-body"><div className="kpi-top">{pGt2}%</div><div className="kpi-sub">Cambio &gt; 2ha</div><div className="kpi-val">({gt2.toLocaleString('es')})</div></div>
      </div>
      <div className="kpi-card">
        <KpiDonut pct={pOneToTwo} color="#ffa500" />
        <div className="kpi-body"><div className="kpi-top">{pOneToTwo}%</div><div className="kpi-sub">Cambio 1–2ha</div><div className="kpi-val">({oneToTwo.toLocaleString('es')})</div></div>
      </div>
      <div className="kpi-card">
        <KpiDonut pct={pHalfToOne} color="#ffee00" />
        <div className="kpi-body"><div className="kpi-top">{pHalfToOne}%</div><div className="kpi-sub">Cambio 0.5–1ha</div><div className="kpi-val">({halfToOne.toLocaleString('es')})</div></div>
      </div>
      <div className="kpi-card">
        <KpiDonut pct={pLte05} color="#00e5ff" />
        <div className="kpi-body"><div className="kpi-top">{pLte05}%</div><div className="kpi-sub">Cambio ≤ 0.5ha</div><div className="kpi-val">({lte05.toLocaleString('es')})</div></div>
      </div>
    </div>
  );
}

/* ============================ Helpers Google ============================ */

// Convierte geometría GeoJSON (4326) a array de google.maps.Polygon
function createPolygonsFromGeometry(google, map, geom, optionsBase = {}) {
  const polys = [];
  const mkPaths = (coords) =>
    coords.map(ring =>
      ring.map(([lon, lat]) => ({ lat, lng: lon }))
    );

  if (geom.type === 'Polygon') {
    const paths = mkPaths(geom.coordinates);
    const poly = new google.maps.Polygon({
      ...optionsBase,
      paths,
      map: optionsBase.visible === false ? null : map,
    });
    polys.push(poly);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(polyCoords => {
      const paths = mkPaths(polyCoords);
      const poly = new google.maps.Polygon({
        ...optionsBase,
        paths,
        map: optionsBase.visible === false ? null : map,
      });
      polys.push(poly);
    });
  }
  return polys;
}

/* ============================ Componente ============================ */
const AnalisisNDVI = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const cancelFlagRef = useRef(false);

  const layersRef = useRef([]); // espejo del estado para callbacks
  const [layers, setLayers] = useState([]);

  // Para exportar KML y payload, guardamos las features de análisis en GeoJSON 4326
  const analysisFeaturesRef = useRef({
    gt_2ha: [],
    one_to_two: [],
    half_to_one: [],
    lte_0_5ha: [],
  });

  /* UI */
  const [menuOpen, setMenuOpen] = useState(true);
  const [activeBasemap, setActiveBasemap] = useState('map'); // 'map' | 'sat'
  const [showCategoriesLegend, setShowCategoriesLegend] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  /* Estado análisis */
  const [status, setStatus] = useState('Listo para analizar.');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDataReady, setIsDataReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dates, setDates] = useState({ oldest: 'N/A', latest: 'N/A' });
  const [ndviThreshold, setNdviThreshold] = useState(0.2);

  // 🔁 Multitemporal (auto por meses/años)
  const [yearsBack, setYearsBack] = useState(1);
  const [maxYearsBack, setMaxYearsBack] = useState(1);
  const ALL_MONTHS = useMemo(() => [1,2,3,4,5,6,7,8,9,10,11,12], []);
  const [months, setMonths] = useState(ALL_MONTHS);

  // 🆕 Modo manual por MES/AÑO
  const YEAR_MIN = 2017;
  const YEAR_MAX = new Date().getUTCFullYear();
  const [manualByMonth, setManualByMonth] = useState(false);
  const [oldYM, setOldYM] = useState({ year: Math.max(YEAR_MIN, YEAR_MAX - 1), month: 1 });
  const [newYM, setNewYM] = useState({ year: YEAR_MAX, month: new Date().getUTCMonth() + 1 });
  const isValidYearMonth = (ym) =>
    ym && Number.isInteger(ym.year) && Number.isInteger(ym.month) &&
    ym.year >= YEAR_MIN && ym.year <= YEAR_MAX &&
    ym.month >= 1 && ym.month <= 12;
  const compareYM = (a, b) => (a.year - b.year) || (a.month - b.month);

  /* KPI */
  const [kpiData, setKpiData] = useState(null);

  /* Categorías */
  const altCatsRef = useRef({});
  const actCatsRef = useRef({});
  const [altCatsUI, setAltCatsUI] = useState([]);
  const [actCatsUI, setActCatsUI] = useState([]);
  const [altCatsOpen, setAltCatsOpen] = useState(false);
  const [actCatsOpen, setActCatsOpen] = useState(false);

  /* Features crudos (GeoJSON 4326) */
  const altRawRef = useRef([]);
  const actRawRef = useRef([]);
  const projRawRef = useRef([]);

  const countActive = (arr) => arr.filter(c => !!c.active).length;
  const byLabel = (a,b) => a.label.localeCompare(b.label, 'es');
  const pushCatsUI = () => {
    setAltCatsUI(Object.values(altCatsRef.current).sort(byLabel));
    setActCatsUI(Object.values(actCatsRef.current).sort(byLabel));
  };

  const buildCatsFromGeojson = (features, defRGB, dstRef) => {
    const cats = { ...dstRef.current };
    features.forEach((gf) => {
      const raw = gf.properties?.categoria || gf.properties?.uso || '';
      const key = normalizeString(raw);
      const rgb = COLORS[key] || defRGB;
      if (!cats[key]) cats[key] = { key, label: raw, color: rgb, active: true };
    });
    dstRef.current = cats;
  };

  const [targetUseGeometries, setTargetUseGeometries] = useState([]);

  const recomputeTargets = () => {
    const activeAlt = new Set(
      Object.values(altCatsRef.current)
        .filter(c => c.active)
        .map(c => c.key)
    );

    const candidates = altRawRef.current.filter(
      f =>
        activeAlt.has(f.properties._catKey) &&
        TARGET_USES.includes(normalizeString(f.properties?.uso))
    );

    const waterFeatures = [...altRawRef.current, ...actRawRef.current].filter(
      f => WATER_KEYS.includes(f.properties._catKey)
    );

    let waterUnion = null;
    try {
      for (const g of waterFeatures) {
        waterUnion = waterUnion ? turf.union(waterUnion, g) : g;
      }
      if (waterUnion) {
        waterUnion = turf.buffer(waterUnion, WATER_BUFFER_M, { units: 'meters' });
      }
    } catch {
      waterUnion = null;
    }

    const mask = [];

    for (const g of candidates) {
      let geom = g;

      if (waterUnion) {
        try {
          const diff = turf.difference(geom, waterUnion);
          if (diff && diff.geometry) geom = diff;
        } catch {}
      }

      try {
        const eroded = turf.buffer(geom, -EDGE_EROSION_M, { units: 'meters' });
        if (eroded && eroded.geometry) {
          eroded.properties = { ...g.properties };
          mask.push(eroded);
        }
      } catch {
        try {
          const fixed = turf.buffer(
            turf.buffer(geom, 0.01, { units: 'meters' }),
            -EDGE_EROSION_M,
            { units: 'meters' }
          );
          if (fixed && fixed.geometry) {
            fixed.properties = { ...g.properties };
            mask.push(fixed);
          }
        } catch {}
      }
    }

    // 1) Caso normal: usar Uso Alternativo filtrado
    if (mask.length > 0) {
      setTargetUseGeometries(mask);
      setIsDataReady(true);
      setStatus(
        `Se usarán ${mask.length.toLocaleString('es')} polígonos objetivo ` +
        `(excluyendo agua +${WATER_BUFFER_M}m y con erosión interna ${EDGE_EROSION_M}m).`
      );
      return;
    }

    // 2) Fallback: usar Polígono del Proyecto
    if (projRawRef.current?.length > 0) {
      setTargetUseGeometries(projRawRef.current);
      setIsDataReady(true);
      setStatus(
        "No hay zonas objetivo activas en 'Uso Alternativo'. " +
        "Se usará el Polígono del Proyecto para el análisis."
      );
      return;
    }

    // 3) Si no hay nada, bloquear
    setTargetUseGeometries([]);
    setIsDataReady(false);
    setStatus(
      "No hay geometrías disponibles para analizar " +
      "(sin Uso Alternativo válido y sin Polígono del Proyecto)."
    );
  };

  /* ======= Helpers BBOX ======= */
  const bboxOf = (features) => {
    try {
      if (!features || !features.length) return null;
      return turf.bbox({ type: 'FeatureCollection', features });
    } catch { return null; }
  };
  const getAnalysisBbox4326 = () => {
    const bProj = bboxOf(projRawRef.current);
    if (bProj) return bProj;
    const allUses = [...altRawRef.current, ...actRawRef.current];
    const bUses = bboxOf(allUses);
    if (bUses) return bUses;
    if (targetUseGeometries.length) {
      return turf.bbox({ type: 'FeatureCollection', features: targetUseGeometries });
    }
    return null;
  };
  const padBbox = (bbox, pct = 0.01) => {
    const [minX,minY,maxX,maxY] = bbox;
    const dx = (maxX - minX) * pct;
    const dy = (maxY - minY) * pct;
    return [minX - dx, minY - dy, maxX + dx, maxY + dy];
  };

  // Límite de años (2017..actual)
  useEffect(() => {
    const currentYear = new Date().getUTCFullYear();
    const earliest = 2017;
    const maxN = Math.max(1, currentYear - earliest);
    setMaxYearsBack(maxN);
    if (yearsBack > maxN) setYearsBack(maxN);
  }, [yearsBack]);

  // Mantener layersRef sincronizado
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  /* =================== Init Google Maps =================== */
  useEffect(() => {
    let cancelled = false;
    if (!mapContainerRef.current || mapRef.current) return;

    (async () => {
      try {
        const google = await loadGoogleMapsApi(GMAPS_API_KEY);
        if (cancelled) return;

        const map = new google.maps.Map(mapContainerRef.current, {
          center: { lat: -23.5, lng: -57.5 },
          zoom: 6,
          minZoom: 4,          // 👈 NO dejar alejar más que esto
          mapTypeId: 'roadmap',
          mapId: GMAPS_MAP_ID || undefined,   // ✅ aplica tu estilo de mapa
        });
        mapRef.current = map;
        setActiveBasemap('map');
        setMapReady(true);          // 👈 avisamos que el mapa ya está listo
      } catch (e) {
        console.error('Error cargando Google Maps:', e);
        setStatus('Error cargando Google Maps API.');
      }
    })();

    return () => {
      cancelled = true;
      setMapReady(false);          // opcional, por limpieza
    };
  }, []);

  /* =================== Cargar capas del proyecto =================== */
  useEffect(() => {
    if (!mapRef.current || !id) return;
    let isMounted = true;

    const google = window.google;

    const fetchAndDrawLayers = async () => {
      setIsDataReady(false);
      setStatus(`Cargando capas del proyecto ${id}...`);
      setKpiData(null);

      // limpiar capas previas (polígonos + overlays)
      layersRef.current.forEach(l => {
        l.polygons?.forEach(p => p.setMap(null));
        l.overlay?.setMap(null);
      });
      setLayers([]);
      layersRef.current = [];

      setTargetUseGeometries([]);
      altCatsRef.current = {};
      actCatsRef.current = {};
      altRawRef.current = [];
      actRawRef.current = [];
      projRawRef.current = [];
      pushCatsUI();

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/proyectos/${id}/capas`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!isMounted || !response.ok) throw new Error(`Error del servidor: ${response.status}`);
        const projectLayersData = await response.json();
        if (!isMounted) return;

        if (projectLayersData?.length > 0) {
          const allFeaturesRaw = [];
          const newLayers = [];

          projectLayersData.forEach(({ nombre, geojson }) => {
            if (!geojson?.features?.length) return;

            // limpiar CRS si viene
            if (geojson.crs) delete geojson.crs;

            // normalizar features y _catKey
            const rawWithKey = geojson.features.map((gf) => {
              const uso = gf.properties?.uso || gf.properties?.categoria || '';
              const key = normalizeString(uso);
              return { ...gf, properties: { ...gf.properties, _catKey: key } };
            });

            if (nombre === 'Poligono del Proyecto') {
              projRawRef.current = rawWithKey;
            }

            allFeaturesRaw.push(...rawWithKey);

            const isAlt = nombre === 'Uso Alternativo';
            const isAct = nombre === 'Uso Actual';

            if (isAlt) {
              altRawRef.current = rawWithKey;
              buildCatsFromGeojson(rawWithKey, DEFAULT_ALT, altCatsRef);
              pushCatsUI();
            } else if (isAct) {
              actRawRef.current = rawWithKey;
              buildCatsFromGeojson(rawWithKey, DEFAULT_ACT, actCatsRef);
              pushCatsUI();
            }

            // Crear polígonos Google Maps
            const polygons = [];
            rawWithKey.forEach((gf) => {
              const uso = gf.properties?.uso || gf.properties?.categoria || '';
              const key = gf.properties._catKey;
              const rgb = COLORS[key] || (isAlt ? DEFAULT_ALT : isAct ? DEFAULT_ACT : [44,62,80]);
              const color = `rgb(${rgb.join(',')})`;

              const polyOptsBase = {
                strokeColor: color,
                strokeOpacity: 0.9,
                strokeWeight: 1.2,
                fillColor: color,
                fillOpacity: (nombre === 'Poligono del Proyecto') ? 0.2 : 0.28,
                visible: true,
              };

              const polys = createPolygonsFromGeometry(
                google,
                mapRef.current,
                gf.geometry,
                polyOptsBase
              );

              polys.forEach(p => {
                p.__catKey = key;
                p.__catRGB = rgb;
                p.__usoRaw = uso;
                p.__layerName = nombre;
                p.__baseFillOpacity = polyOptsBase.fillOpacity;
                polygons.push(p);
              });
            });

            const shouldBeVisible =
              nombre === 'Uso Alternativo'
                ? true
                : nombre === 'Uso Actual'
                  ? false
                  : (nombre === 'Poligono del Proyecto');

            // si alguna capa no debe ser visible por defecto, la ocultamos
            if (!shouldBeVisible) {
              polygons.forEach(p => p.setMap(null));
            }

            newLayers.push({
              id: `project-${nombre.replace(/\s/g,'-')}-${id}`,
              name: nombre,
              type: 'project',
              visible: shouldBeVisible,
              opacity: 1,
              polygons,
              isAlt,
              isAct,
            });
          });

          // Ajustar vista al proyecto
          if (allFeaturesRaw.length > 0) {
            const bbox = bboxOf(allFeaturesRaw);
            if (bbox) {
              const [minX, minY, maxX, maxY] = bbox;
              const bounds = new google.maps.LatLngBounds(
                { lat: minY, lng: minX },
                { lat: maxY, lng: maxX }
              );
              mapRef.current.fitBounds(bounds, 80);
            }
          }

          setLayers(newLayers);
          layersRef.current = newLayers;
          recomputeTargets();
        } else {
          setStatus(`El proyecto ${id} no tiene capas para mostrar.`);
          setIsDataReady(false);
        }
      } catch (error) {
        if (isMounted) {
          setStatus(`Error al cargar capas: ${error.message}`);
          setIsDataReady(false);
        }
      }
    };

    fetchAndDrawLayers();
    return () => { isMounted = false; };
  }, [id, mapReady]);

  /* ============ helpers de capas ============ */
  const addLayer = useCallback((cfg) => {
    setLayers(prev => {
      const next = [...prev, cfg];
      layersRef.current = next;
      return next;
    });
  }, []);

  const cleanUpAnalysisLayers = useCallback(() => {
    setLayers(curr => {
      const keep = curr.filter(l => l.type !== 'analysis');
      curr
        .filter(l => l.type === 'analysis')
        .forEach(l => {
          l.polygons?.forEach(p => p.setMap(null));
          l.overlay?.setMap(null);
        });
      layersRef.current = keep;
      return keep;
    });
    setDates({ oldest: 'N/A', latest: 'N/A' });
    setKpiData(null);
    analysisFeaturesRef.current = {
      gt_2ha: [],
      one_to_two: [],
      half_to_one: [],
      lte_0_5ha: [],
    };
  }, []);

  const appendStatus = (msg) => setStatus(prev => `${prev}\n${msg}`);

  /* ================= visibilidad / opacidad ================= */
  const handleVisibilityChange = (layerId, visible) => {
    setLayers(prev => {
      const next = prev.map(l => {
        if (l.id === layerId) {
          // para usos con categorías, respetamos categorías activas
          if (l.isAlt) {
            l.polygons?.forEach(p => {
              const cat = altCatsRef.current[p.__catKey];
              const catActive = !cat || cat.active;
              p.setMap(visible && catActive ? mapRef.current : null);
            });
          } else if (l.isAct) {
            l.polygons?.forEach(p => {
              const cat = actCatsRef.current[p.__catKey];
              const catActive = !cat || cat.active;
              p.setMap(visible && catActive ? mapRef.current : null);
            });
          } else {
            l.polygons?.forEach(p => p.setMap(visible ? mapRef.current : null));
          }
          l.overlay?.setMap(visible ? mapRef.current : null);
          return { ...l, visible };
        }
        return l;
      });
      layersRef.current = next;
      return next;
    });
  };

  const handleOpacityChange = (layerId, opacity) => {
    setLayers(prev => {
      const next = prev.map(l => {
        if (l.id === layerId) {
          l.polygons?.forEach(p => {
            const base = p.__baseFillOpacity ?? 0.3;
            p.setOptions({
              fillOpacity: base * opacity,
              strokeOpacity: 0.9 * opacity,
            });
          });
          // para GroundOverlay no hay forma limpia de cambiar opacidad sin recrear.
          return { ...l, opacity };
        }
        return l;
      });
      layersRef.current = next;
      return next;
    });
  };

  const toggleBasemap = useCallback(() => {
    if (!mapRef.current || !window.google) return;
    setActiveBasemap(prev => {
      const next = prev === 'map' ? 'sat' : 'map';
      mapRef.current.setMapTypeId(next === 'map' ? 'roadmap' : 'hybrid');
      return next;
    });
  }, []);

  /* ================= Sentinel helpers ================= */

  const getAccessToken = async () => {
    appendStatus('Obteniendo token de autenticación...');
    setProgress(2);
    try {
      const response = await fetch(`${API_URL}/sentinel/token`, {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
      });
      if (!response.ok) throw new Error('El backend no devolvió token Sentinel.');
      const data = await response.json();
      if (!data.token) throw new Error('Respuesta inválida del backend (sin token).');
      return data.token;
    } catch (error) {
      appendStatus(`Error de token: ${error.message}`);
      return null;
    }
  };

  // ✅ NUEVO: geometría AOI real (prioridad: polígono del proyecto; luego máscara objetivo)
  const buildAOIGeometry4326 = useCallback(() => {
    const tryUnion = (features) => {
      if (!features?.length) return null;
      let acc = null;
      for (const f of features) {
        try {
          acc = acc ? turf.union(acc, f) : f;
        } catch {
          acc = acc || f;
        }
      }
      if (!acc?.geometry) return null;

      let g = acc.geometry;
      if (g.type === 'Polygon') g = { type: 'MultiPolygon', coordinates: [g.coordinates] };
      if (g.type === 'MultiPolygon') return g;

      // fallback: convex hull
      try {
        const hull = turf.convex(turf.featureCollection(features));
        if (hull?.geometry?.type === 'Polygon') {
          return { type: 'MultiPolygon', coordinates: [hull.geometry.coordinates] };
        }
      } catch {}
      return null;
    };

    // 1) Polígono del proyecto (mejor)
    const gProj = tryUnion(projRawRef.current);
    if (gProj) return gProj;

    // 2) máscara objetivo (si existe)
    const gMask = tryUnion(targetUseGeometries);
    if (gMask) return gMask;

    // 3) fallback: todos los usos
    const all = [...altRawRef.current, ...actRawRef.current];
    const gAll = tryUnion(all);
    if (gAll) return gAll;

    return null;
  }, [targetUseGeometries]);

  // ✅ NUEVO: pide al backend el % de nube sobre AOI (no por escena completa)
  const getCloudPctAOIFromBackend = async ({ date, bbox, aoiGeom, token }) => {
    if (!aoiGeom) return null;

    try {
      const res = await fetch(`${API_URL}/sentinel/cloudpct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('token'),
        },
        body: JSON.stringify({
          instanceId,
          date,
          bbox,                 // [minX,minY,maxX,maxY] en EPSG:4326
          geometry: aoiGeom,    // GeoJSON geometry (MultiPolygon) EPSG:4326
          sampleWidth: AOI_CLOUD_SAMPLE_SIZE,
          sampleHeight: AOI_CLOUD_SAMPLE_SIZE,
          // opcional: qué layer usar para detección (backend puede ignorar)
          layer: agricolaLayerName,
          shToken: token, // por si tu backend quiere usarlo (si no, lo ignora)
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        console.warn('cloudpct backend error:', res.status, t);
        return null;
      }
      const data = await res.json().catch(() => null);
      const v =
        data?.cloud_pct ??
        data?.cloudPct ??
        data?.cloud ??
        data?.pct ??
        null;

      const num = Number(v);
      return Number.isFinite(num) ? num : null;
    } catch (e) {
      console.warn('cloudpct exception:', e);
      return null;
    }
  };

  // ✅ ACTUALIZADO: ahora filtra por nube en AOI (<=5%) además de scene-cloud
  const findBestImageryWithinMonths = async (yearTarget, monthsSel, bbox, token, label, _extraDays = 0, cloudSlack = 0) => {
    const minMonth = Math.min(...monthsSel);
    const maxMonth = Math.max(...monthsSel);
    const startISO = new Date(Date.UTC(yearTarget, minMonth - 1, 1)).toISOString();
    const endISO = new Date(Date.UTC(yearTarget, maxMonth, 0, 23, 59, 59)).toISOString();

    appendStatus(`Buscando imágenes (${label}) en meses ${monthsSel.join(', ')} de ${yearTarget}...`);

    // AOI real
    const aoiGeom = buildAOIGeometry4326();

    try {
      const response = await fetch(catalogBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          collections: ['sentinel-2-l2a'],
          datetime: `${startISO}/${endISO}`,
          bbox,
          limit: 100
        })
      });

      if (!response.ok) {
        const t = await response.text();
        throw new Error(`Error ${response.status} Catalog: ${t}`);
      }

      const data = await response.json();
      let feats = (data.features || []);

      const setMonths = new Set(monthsSel);
      feats = feats.filter(f => setMonths.has(new Date(f.properties.datetime).getUTCMonth() + 1));

      const maxCloud = maxCloudCoverageForBest + (cloudSlack || 0);
      feats = feats.filter(f => f.properties['eo:cloud_cover'] <= maxCloud);

      if (!feats.length) {
        appendStatus(`No se encontraron imágenes válidas (${label}).`);
        return null;
      }

      feats.sort((a,b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']);

      // Si no hay AOI (raro), volvemos a la lógica vieja
      if (!aoiGeom) {
        const best = feats[0];
        return {
          date: best.properties.datetime.split('T')[0],
          cloudCover: best.properties['eo:cloud_cover']
        };
      }

      // Probar candidatos y medir nube SOLO en AOI
      const candidates = feats.slice(0, AOI_MAX_CANDIDATES);

      appendStatus(`Calculando nubes sobre AOI (${label})… objetivo ≤ ${MAX_CLOUD_PCT_AOI}% (muestra ${AOI_CLOUD_SAMPLE_SIZE}px).`);

      const evaluated = [];
      for (let i = 0; i < candidates.length; i++) {
        if (cancelFlagRef.current) return null;

        const f = candidates[i];
        const date = f.properties.datetime.split('T')[0];
        const sceneCloud = f.properties['eo:cloud_cover'];

        const aoiCloud = await getCloudPctAOIFromBackend({ date, bbox, aoiGeom, token });
        if (aoiCloud == null) {
          evaluated.push({ date, sceneCloud, aoiCloud: null });
          appendStatus(` • ${date} (escena ${sceneCloud}%) → AOI: ? (no disponible)`);
          continue;
        }

        evaluated.push({ date, sceneCloud, aoiCloud });
        appendStatus(` • ${date} (escena ${sceneCloud}%) → AOI: ${aoiCloud}%`);

        if (aoiCloud <= MAX_CLOUD_PCT_AOI) {
          appendStatus(`✅ Seleccionada ${date} (${label}) por AOI ${aoiCloud}% ≤ ${MAX_CLOUD_PCT_AOI}%`);
          return { date, cloudCover: sceneCloud, aoiCloudPct: aoiCloud };
        }

        // soltá el event-loop cada tanto
        if ((i & 3) === 0) await new Promise(r => setTimeout(r, 0));
      }

      // Fallback (si no encontramos <=5%): probar mejor <=12% (con aviso)
      const evalWithNum = evaluated.filter(e => Number.isFinite(e.aoiCloud));
      if (evalWithNum.length) {
        evalWithNum.sort((a,b) => a.aoiCloud - b.aoiCloud);
        const bestAOI = evalWithNum[0];

        if (bestAOI.aoiCloud <= AOI_FALLBACK_PCT) {
          appendStatus(
            `⚠️ No hubo escenas con AOI ≤ ${MAX_CLOUD_PCT_AOI}%. Se usa la mejor disponible: ${bestAOI.date} (AOI ${bestAOI.aoiCloud}%).`
          );
          return { date: bestAOI.date, cloudCover: bestAOI.sceneCloud, aoiCloudPct: bestAOI.aoiCloud };
        }

        appendStatus(
          `⚠️ No hubo escenas con AOI ≤ ${AOI_FALLBACK_PCT}%. Se usa la mejor disponible: ${bestAOI.date} (AOI ${bestAOI.aoiCloud}%).`
        );
        return { date: bestAOI.date, cloudCover: bestAOI.sceneCloud, aoiCloudPct: bestAOI.aoiCloud };
      }

      // último fallback: mejor por escena
      const best = feats[0];
      appendStatus(`⚠️ No se pudo calcular AOI cloud%. Se usa mejor por escena: ${best.properties.datetime.split('T')[0]} (${best.properties['eo:cloud_cover']}%).`);
      return {
        date: best.properties.datetime.split('T')[0],
        cloudCover: best.properties['eo:cloud_cover'],
        aoiCloudPct: null
      };
    } catch (e) {
      appendStatus(`Error buscando imagen (${label}).`);
      console.error(e);
      return null;
    }
  };

  const buildSentinelImageUrl = (date, bbox, layerName) =>
    `${wmsBaseUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layerName}` +
    `&BBOX=${bbox.join(',')}&WIDTH=${IMG_SIZE}&HEIGHT=${IMG_SIZE}` +
    `&FORMAT=image/png&TIME=${date}&CRS=EPSG:4326&SHOWLOGO=false`;

  // Obtiene pixels NDVI desde WMS vía backend (igual que antes)
  const getWMSPixelDataForNDVICalc = (date, bbox, layerName, width, height) => {
    const imageUrl =
      `${wmsBaseUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layerName}` +
      `&BBOX=${bbox.join(',')}&WIDTH=${width}&HEIGHT=${height}` +
      `&FORMAT=image/png&TIME=${date}&CRS=EPSG:4326&SHOWLOGO=false`;
    const proxyUrl = `${API_URL}/proxy?url=${encodeURIComponent(imageUrl)}`;

    return fetch(proxyUrl, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })
      .then(async (res) => {
        if (!res.ok) throw new Error('Proxy failed');
        const blob = await res.blob();

        if ('createImageBitmap' in window) {
          try {
            const bmp = await createImageBitmap(blob);
            if ('OffscreenCanvas' in window) {
              const oc = new OffscreenCanvas(width, height);
              const ctx = oc.getContext('2d', { willReadFrequently: true });
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(bmp, 0, 0, width, height);
              const { data } = ctx.getImageData(0, 0, width, height);
              bmp.close?.();
              return data;
            }
          } catch {
            // sigue al fallback
          }
        }

        return new Promise((resolve) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, width, height);
            const data = ctx.getImageData(0, 0, width, height).data;
            URL.revokeObjectURL(url);
            resolve(data);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
          };
          img.src = url;
        });
      })
      .catch((err) => {
        console.error('Error en getWMSPixelDataForNDVICalc:', err);
        return null;
      });
  };

  const calculateNDVI = (pixelData) => {
    const ndviArray = [];
    for (let i = 0; i < pixelData.length; i += 4) {
      const nir = pixelData[i];       // canal R => B08
      const red = pixelData[i + 1];   // canal G => B04
      const sum = nir + red;
      ndviArray.push(sum === 0 ? 0 : (nir - red) / sum);
    }
    return ndviArray;
  };

  const groupAdjacentPixels = (pixels) => {
    const visited = new Set();
    const clusters = [];
    const pixelMap = new Map(pixels.map(p => [`${p.x},${p.y}`, p]));
    for (const pixel of pixels) {
      const key = `${pixel.x},${pixel.y}`;
      if (visited.has(key)) continue;
      const cluster = [];
      const queue = [pixel];
      visited.add(key);
      while (queue.length > 0) {
        const current = queue.shift();
        cluster.push(current);
        const neighbors = [
          { x: current.x + 1, y: current.y },
          { x: current.x - 1, y: current.y },
          { x: current.x, y: current.y + 1 },
          { x: current.x, y: current.y - 1 }
        ];
        for (const n of neighbors) {
          const nk = `${n.x},${n.y}`;
          if (pixelMap.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            queue.push(pixelMap.get(nk));
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  };

  const bboxToWKT = (bbox) => {
    const [minX, minY, maxX, maxY] = bbox;
    return `POLYGON((${minX} ${minY},${minX} ${maxY},${maxX} ${maxY},${maxX} ${minY},${minX} ${minY}))`;
  };

  const buildMaskWKT = (maskFeatures = []) => {
    if (!maskFeatures.length) return null;
    try {
      let acc = null;
      for (const f of maskFeatures) {
        acc = acc ? turf.union(acc, f) : f;
      }
      if (acc && acc.geometry) {
        let geom = acc.geometry;
        if (geom.type === 'Polygon') geom = { type: 'MultiPolygon', coordinates: [geom.coordinates] };
        else if (geom.type !== 'MultiPolygon') {
          const hull = turf.convex(turf.featureCollection(maskFeatures));
          if (hull?.geometry?.type === 'Polygon') geom = { type: 'MultiPolygon', coordinates: [hull.geometry.coordinates] };
        }
        const olGeom = new GeoJSONFormat().readGeometry(
          { type: geom.type, coordinates: geom.coordinates },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' }
        );
        return new WKT().writeGeometry(olGeom);
      }
    } catch {}
    const multiCoords = [];
    for (const f of maskFeatures) {
      const g = f.geometry;
      if (g?.type === 'Polygon') multiCoords.push(g.coordinates);
      else if (g?.type === 'MultiPolygon') multiCoords.push(...g.coordinates);
    }
    if (multiCoords.length) {
      const olGeom = new GeoJSONFormat().readGeometry(
        { type: 'MultiPolygon', coordinates: multiCoords },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' }
      );
      return new WKT().writeGeometry(olGeom);
    }
    return null;
  };

  const buildAnalysisPayload = ({ mainBbox4326, bestOldest, bestLatest, featuresByClass, manualDatesUsed }) => {
    const wktWriter = new WKT();
    const gjFormatter = new GeoJSONFormat();

    const packClass = (arr, className) => arr.map((feat) => {
      const olGeom = gjFormatter.readGeometry(feat.geometry, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:4326'
      });
      const geom_wkt = wktWriter.writeGeometry(olGeom);
      return {
        class: className,
        area_ha: Number(feat.properties.area_ha ?? 0),
        pixel_count: Number(feat.properties.pixel_count ?? 0),
        geom_wkt
      };
    });

    const features = [
      ...packClass(featuresByClass.gt_2ha, 'gt_2ha'),
      ...packClass(featuresByClass['1_to_2ha'], '1_to_2ha'),
      ...packClass(featuresByClass['0_5_to_1ha'], '0_5_to_1ha'),
      ...packClass(featuresByClass.lte_0_5ha, 'lte_0_5ha'),
    ];

    const mask_wkt = buildMaskWKT(targetUseGeometries);

    const imagery = [
      {
        role:'old',
        source:'Sentinel-2 L2A',
        wms_layer: ndviLayerName,
        wms_time: bestOldest.date,
        acquisition_date: bestOldest.date,
        cloud_pct: bestOldest.cloudCover ?? null,
        aoi_cloud_pct: bestOldest.aoiCloudPct ?? null, // ✅ NUEVO
        raw_meta:{instanceId, trueColorLayer: agricolaLayerName}
      },
      {
        role:'new',
        source:'Sentinel-2 L2A',
        wms_layer: ndviLayerName,
        wms_time: bestLatest.date,
        acquisition_date: bestLatest.date,
        cloud_pct: bestLatest.cloudCover ?? null,
        aoi_cloud_pct: bestLatest.aoiCloudPct ?? null, // ✅ NUEVO
        raw_meta:{instanceId, trueColorLayer: agricolaLayerName}
      },
    ];

    const gt2 = featuresByClass.gt_2ha.length;
    const oneToTwo = featuresByClass['1_to_2ha'].length;
    const halfToOne = featuresByClass['0_5_to_1ha'].length;
    const lte05 = featuresByClass.lte_0_5ha.length;
    const total = gt2 + oneToTwo + halfToOne + lte05;

    const today = new Date().toISOString().slice(0,10);
    return {
      project_gid: Number(id),
      payload: {
        ndvi_threshold: ndviThreshold,
        search_window_days: searchWindowDays,
        img_size: IMG_SIZE,
        bbox_wkt: bboxToWKT(mainBbox4326),
        notes: manualDatesUsed
          ? `Análisis NDVI multitemporal con MESES/AÑOS MANUALES. Proyecto ${id}.`
          : `Análisis NDVI multitemporal desde visor. Proyecto ${id}. Comparado contra ${yearsBack} año(s) atrás. Meses seleccionados: ${months.join(', ')}.`,
        label: `NDVI multi ${today}`,
        date_old: bestOldest.date,
        cloud_old_pct: bestOldest.cloudCover ?? null,
        aoi_cloud_old_pct: bestOldest.aoiCloudPct ?? null, // ✅ NUEVO
        date_new: bestLatest.date,
        cloud_new_pct: bestLatest.cloudCover ?? null,
        aoi_cloud_new_pct: bestLatest.aoiCloudPct ?? null, // ✅ NUEVO
        total_clusters: total,
        gt2_count: gt2,
        one_to_two_count: oneToTwo,
        half_to_one_count: halfToOne,
        lte05_count: lte05,
        features,
        mask_wkt: mask_wkt || null,
        imagery
      }
    };
  };

  // ===== Nuevo helper para detectar duplicado
  const isDuplicateSaveError = (status, text = '') => {
    if (status === 409) return true;
    const t = (text || '').toLowerCase();
    return (
      t.includes('duplicate key value') ||
      t.includes('llave duplicada') ||
      t.includes('uca_uniq_project_dates_notnull')
    );
  };

  // Buscar análisis existente por project + fechas
  const fetchExistingAnalysisIdByDates = async ({ project_gid, date_old, date_new }) => {
    const tok = localStorage.getItem('token');

    const qs = new URLSearchParams({
      project_gid,
      date_old,
      date_new,
    }).toString();

    const res = await fetch(`${API_URL}/use-change/analyses/by-project-dates?${qs}`, {
      headers: { Authorization: 'Bearer ' + tok },
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data?.analysis_id || null; // ⚠️ UUID string
  };

  // Fallback: trae el último del proyecto (menos preciso, pero sirve si repetís fechas siempre)
  // ✅ Solo si no tenés endpoint por fechas
  const fetchLatestAnalysisIdByProject = async (project_gid) => {
    const tok = localStorage.getItem('token');

    const res = await fetch(`${API_URL}/use-change/analyses/latest/by-project?project_gid=${project_gid}`, {
      headers: { Authorization: 'Bearer ' + tok },
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`No se pudo obtener análisis latest. HTTP ${res.status} - ${t}`);
    }

    const data = await res.json();
    const id = Number(data?.analysis_id ?? data?.id ?? data?.analysis?.id);
    return Number.isFinite(id) ? id : null;
  };

  const saveUseChangeAnalysis = async (payload) => {
    try {
      appendStatus('Guardando historial del análisis…');

      const res = await fetch(`${API_URL}/use-change/analyses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('token'),
        },
        body: JSON.stringify(payload),
      });

      // ✅ 201 - creado nuevo
      if (res.ok) {
        const data = await res.json();
        const id = data?.analysis_id;
        appendStatus(`Historial guardado ✓ (analysis_id: ${id})`);
        return id;
      }

      // ❗ Puede ser 409
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}

      if (res.status === 409) {
        appendStatus('ℹ️ Ya existe un análisis para esas fechas. Recuperando historial…');

        // 1️⃣ Si backend ya mandó analysis_id en el 409
        if (parsed?.analysis_id) {
          appendStatus(`✅ Historial existente (analysis_id: ${parsed.analysis_id})`);
          return parsed.analysis_id;
        }

        // 2️⃣ Fallback: buscar por project + fechas
        const existingId = await fetchExistingAnalysisIdByDates({
          project_gid: payload.project_gid,
          date_old: payload.payload.date_old,
          date_new: payload.payload.date_new,
        });

        if (existingId) {
          appendStatus(`✅ Historial existente (analysis_id: ${existingId})`);
          return existingId;
        }

        appendStatus('⚠️ El análisis ya existía pero no se pudo recuperar el ID.');
        return null;
      }

      throw new Error(`HTTP ${res.status} - ${text}`);
    } catch (e) {
      console.warn('No se pudo guardar/abrir historial:', e?.message || e);
      appendStatus('⚠️ No se pudo guardar/abrir el historial (los resultados siguen visibles).');
      return null;
    }
  };

  /* ============================ Análisis (multitemporal) ============================ */
  const handleStartAnalysis = async () => {
    if (!isDataReady || targetUseGeometries.length === 0) {
      setStatus(
        "No hay geometrías válidas para analizar " +
        "(ni Uso Alternativo ni Polígono del Proyecto)."
      );
      setMenuOpen(true);
      return;
    }

    if (!mapRef.current || !window.google) {
      setStatus('Google Maps aún no está listo.');
      return;
    }

    const google = window.google;

    setIsAnalyzing(true);
    setProgress(0);
    cancelFlagRef.current = false;
    cleanUpAnalysisLayers();
    setStatus('Iniciando análisis multitemporal...');

    const mainBboxRaw = getAnalysisBbox4326();
    if (!mainBboxRaw) {
      setStatus('No fue posible determinar el área del análisis (sin geometrías).');
      setIsAnalyzing(false);
      return;
    }
    const mainBbox = padBbox(mainBboxRaw, 0.01);

    let bestLatest = null;
    let bestOldest = null;

    if (manualByMonth) {
      if (!isValidYearMonth(oldYM) || !isValidYearMonth(newYM)) {
        setStatus('⚠️ Selección inválida (mes/año fuera de rango).');
        setIsAnalyzing(false);
        return;
      }
      if (compareYM(oldYM, newYM) >= 0) {
        setStatus('⚠️ La fecha antigua debe ser anterior a la reciente (por mes/año).');
        setIsAnalyzing(false);
        return;
      }

      const shTokenManual = await getAccessToken();
      if (!shTokenManual) {
        setStatus('Análisis detenido: Fallo de token.');
        setIsAnalyzing(false);
        return;
      }
      setProgress(5);

      bestOldest = await findBestImageryWithinMonths(
        oldYM.year,
        [oldYM.month],
        mainBbox,
        shTokenManual,
        `antigua (${oldYM.year}/${String(oldYM.month).padStart(2,'0')})`,
        0,
        0
      );
      if (cancelFlagRef.current || !bestOldest) { handleCancelAnalysis(); return; }
      setProgress(12);

      bestLatest = await findBestImageryWithinMonths(
        newYM.year,
        [newYM.month],
        mainBbox,
        shTokenManual,
        `reciente (${newYM.year}/${String(newYM.month).padStart(2,'0')})`,
        0,
        0
      );
      if (cancelFlagRef.current || !bestLatest) { handleCancelAnalysis(); return; }
      setProgress(20);

      appendStatus(
        `Usando meses manuales:
    • Antigua: ${oldYM.year}/${String(oldYM.month).padStart(2,'0')} ⇒ ${bestOldest.date} (escena ${bestOldest.cloudCover ?? '?'}% | AOI ${bestOldest.aoiCloudPct ?? '?'}%)
    • Reciente: ${newYM.year}/${String(newYM.month).padStart(2,'0')} ⇒ ${bestLatest.date} (escena ${bestLatest.cloudCover ?? '?'}% | AOI ${bestLatest.aoiCloudPct ?? '?'}%)`
      );
    } else {
      const shToken = await getAccessToken();
      if (!shToken) {
        setStatus('Análisis detenido: Fallo de token.');
        setIsAnalyzing(false);
        return;
      }
      setProgress(5);

      const nowUTC = new Date();
      const latestYear = nowUTC.getUTCFullYear();
      const oldestYear = latestYear - yearsBack;

      bestLatest = await findBestImageryWithinMonths(latestYear, months, mainBbox, shToken, 'reciente', 0, 0);
      if (cancelFlagRef.current || !bestLatest) { handleCancelAnalysis(); return; }
      setProgress(15);

      bestOldest = await findBestImageryWithinMonths(oldestYear, months, mainBbox, shToken, 'antigua', 30, 5);
      if (cancelFlagRef.current || !bestOldest) { handleCancelAnalysis(); return; }
      setProgress(20);
    }

    setDates({ oldest: bestOldest.date, latest: bestLatest.date });

    const [minX, minY, maxX, maxY] = mainBbox;
    const bounds = new google.maps.LatLngBounds(
      { lat: minY, lng: minX },
      { lat: maxY, lng: maxX }
    );

    const urlOld = buildSentinelImageUrl(bestOldest.date, mainBbox, agricolaLayerName);
    const urlNew = buildSentinelImageUrl(bestLatest.date, mainBbox, agricolaLayerName);

    const overlayOld = new google.maps.GroundOverlay(urlOld, bounds, { opacity: 0.9 });
    overlayOld.setMap(null);
    const overlayNew = new google.maps.GroundOverlay(urlNew, bounds, { opacity: 1 });
    overlayNew.setMap(mapRef.current);

    addLayer({
      id: 'sat-old',
      name: `Imagen satelital (${bestOldest.date})`,
      type: 'analysis',
      visible: false,
      opacity: 0.9,
      overlay: overlayOld,
      legend: { color: '#7ED957', label: `Imagen satelital ${bestOldest.date}` },
    });
    addLayer({
      id: 'sat-new',
      name: `Imagen satelital (${bestLatest.date})`,
      type: 'analysis',
      visible: true,
      opacity: 1,
      overlay: overlayNew,
      legend: { color: '#4CAF50', label: `Imagen satelital ${bestLatest.date}` },
    });

    setProgress(30);

    setStatus(`Descargando datos de píxeles para el área completa (${IMG_SIZE}px)…`);
    const bandsOld = await getWMSPixelDataForNDVICalc(bestOldest.date, mainBbox, ndviLayerName, IMG_SIZE, IMG_SIZE);
    setProgress(45);
    if (cancelFlagRef.current) { handleCancelAnalysis(); return; }

    const bandsNew = await getWMSPixelDataForNDVICalc(bestLatest.date, mainBbox, ndviLayerName, IMG_SIZE, IMG_SIZE);
    setProgress(60);
    if (cancelFlagRef.current || !bandsNew || !bandsOld) { handleCancelAnalysis(); return; }

    setStatus('Calculando NDVI y ΔNDVI...');
    const ndviOld = calculateNDVI(bandsOld);
    const ndviNew = calculateNDVI(bandsNew);

    setStatus('Detectando píxeles de cambio...');
    const maskEntries = targetUseGeometries.map(g => ({ bbox: turf.bbox(g), geom: g }));
    const allChangedPixels = [];
    const lonPerPixel = (mainBbox[2] - mainBbox[0]) / IMG_SIZE;
    const latPerPixel = (mainBbox[3] - mainBbox[1]) / IMG_SIZE;

    for (let y = 0; y < IMG_SIZE; y++) {
      for (let x = 0; x < IMG_SIZE; x++) {
        const idx = y * IMG_SIZE + x;
        if ((ndviOld[idx] - ndviNew[idx]) <= ndviThreshold) continue;
        const pt = [
          mainBbox[0] + (x + 0.5) * lonPerPixel,
          mainBbox[3] - (y + 0.5) * latPerPixel
        ];
        let inside = false;
        for (let i = 0; i < maskEntries.length; i++) {
          const b = maskEntries[i].bbox;
          if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
          if (turf.booleanPointInPolygon(turf.point(pt), maskEntries[i].geom)) {
            inside = true;
            break;
          }
        }
        if (inside) allChangedPixels.push({ x, y });
      }
      if ((y & 15) === 0) await new Promise(r => setTimeout(r, 0));
    }

    setProgress(75);
    setStatus('Agrupando píxeles contiguos...');
    const pixelClusters = groupAdjacentPixels(allChangedPixels);
    setProgress(85);

    const featuresByClass = {
      gt_2ha: [],
      '1_to_2ha': [],
      '0_5_to_1ha': [],
      lte_0_5ha: [],
    };

    setStatus('Creando polígonos de cambio y clasificando...');
    pixelClusters.forEach(cluster => {
      if (!cluster.length) return;

      const pixelPolygons = cluster.map(p => {
        const startLon = mainBbox[0] + p.x * lonPerPixel;
        const endLon = startLon + lonPerPixel;
        const startLat = mainBbox[3] - p.y * latPerPixel;
        const endLat = startLat - latPerPixel;
        return turf.polygon([[
          [startLon, startLat], [endLon, startLat],
          [endLon, endLat], [startLon, endLat], [startLon, startLat]
        ]]);
      });

      let clusterPolygon;
      if (pixelPolygons.length > 1) {
        try { clusterPolygon = turf.union(...pixelPolygons); }
        catch {
          try { clusterPolygon = turf.convex(turf.featureCollection(pixelPolygons)); }
          catch { return; }
        }
      } else {
        clusterPolygon = pixelPolygons[0];
      }
      if (!clusterPolygon) return;

      try { clusterPolygon = turf.buffer(clusterPolygon, 0, { units: 'meters' }); } catch {}
      try { clusterPolygon = turf.simplify(clusterPolygon, { tolerance: 0.00003, highQuality: false }); } catch {}

      const areaHa = turf.area(clusterPolygon) / 10000;
      if (areaHa < MIN_CLUSTER_AREA_HA) return;

      const gjFeat = {
        type: 'Feature',
        geometry: clusterPolygon.geometry,
        properties: {
          area_ha: areaHa.toFixed(2),
          pixel_count: cluster.length,
        }
      };

      if (areaHa > 2) featuresByClass.gt_2ha.push(gjFeat);
      else if (areaHa > 1) featuresByClass['1_to_2ha'].push(gjFeat);
      else if (areaHa > 0.5) featuresByClass['0_5_to_1ha'].push(gjFeat);
      else featuresByClass.lte_0_5ha.push(gjFeat);
    });

    analysisFeaturesRef.current = {
      gt_2ha: featuresByClass.gt_2ha,
      one_to_two: featuresByClass['1_to_2ha'],
      half_to_one: featuresByClass['0_5_to_1ha'],
      lte_0_5ha: featuresByClass.lte_0_5ha,
    };

    setProgress(95);

    const makeChangeLayer = (id, name, feats, strokeColor) => {
      if (!feats.length) return;
      const polys = [];
      feats.forEach((f) => {
        const optsBase = {
          strokeColor,
          strokeWeight: 2,
          strokeOpacity: 0.95,
          fillColor: strokeColor,
          fillOpacity: 0.05,
          visible: true,
        };
        const ps = createPolygonsFromGeometry(google, mapRef.current, f.geometry, optsBase);
        ps.forEach(p => { p.__baseFillOpacity = optsBase.fillOpacity; polys.push(p); });
      });
      addLayer({
        id,
        name,
        type: 'analysis',
        visible: true,
        opacity: 1,
        polygons: polys,
        legend: { color: strokeColor, label: name.replace('Cambios ', 'Cambio ') },
      });
    };

    makeChangeLayer('changes-gt-2ha', 'Cambios > 2ha', featuresByClass.gt_2ha, '#ff2600');
    makeChangeLayer('changes-1-to-2ha', 'Cambios 1-2ha', featuresByClass['1_to_2ha'], '#ffa500');
    makeChangeLayer('changes-0.5-to-1ha', 'Cambios 0.5-1ha', featuresByClass['0_5_to_1ha'], '#ffee00');
    makeChangeLayer('changes-lte-0.5ha', 'Cambios ≤ 0.5ha', featuresByClass.lte_0_5ha, '#00e5ff');

    const totalChanges =
      featuresByClass.gt_2ha.length +
      featuresByClass['1_to_2ha'].length +
      featuresByClass['0_5_to_1ha'].length +
      featuresByClass.lte_0_5ha.length;

    setStatus(`Análisis completado. Se encontraron ${totalChanges.toLocaleString('es')} áreas de cambio.`);
    setProgress(100);

    const total = totalChanges;
    const gt2 = featuresByClass.gt_2ha.length;
    const oneToTwo = featuresByClass['1_to_2ha'].length;
    const halfToOne = featuresByClass['0_5_to_1ha'].length;
    const lte05 = featuresByClass.lte_0_5ha.length;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    setKpiData({
      total, gt2, oneToTwo, halfToOne, lte05,
      pGt2: pct(gt2), pOneToTwo: pct(oneToTwo), pHalfToOne: pct(halfToOne), pLte05: pct(lte05)
    });

    const payload = buildAnalysisPayload({
      mainBbox4326: mainBbox,
      bestOldest,
      bestLatest,
      featuresByClass,
      manualDatesUsed: manualByMonth
    });
    await saveUseChangeAnalysis(payload);

    setTimeout(() => setIsAnalyzing(false), 400);
  };

  const handleCancelAnalysis = () => {
    cancelFlagRef.current = true;
    setIsAnalyzing(false);
    setStatus('Análisis cancelado.');
    setProgress(0);
    setKpiData(null);
  };

  const handleDownloadKML = async () => {
    const { gt_2ha, one_to_two, half_to_one, lte_0_5ha } = analysisFeaturesRef.current;
    const feats = [
      ...gt_2ha,
      ...one_to_two,
      ...half_to_one,
      ...lte_0_5ha,
    ];
    if (!feats.length) {
      setStatus('No hay cambios para exportar.');
      return;
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features: feats,
    };

    try {
      const res = await fetch(`${API_URL}/export/kml/geojson`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('token')
        },
        body: JSON.stringify({ name: `Cambios NDVI Proyecto ${id}`, featureCollection })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Error servidor: ${res.status} ${txt}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cambios_ndvi_proyecto_${id}.kml`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('KML exportado correctamente.');
    } catch (e) {
      console.error(e);
      setStatus('Error al exportar KML.');
    }
  };

  const altLayer = layers.find(l => l.name === 'Uso Alternativo');
  const actLayer = layers.find(l => l.name === 'Uso Actual');

  const nonBaseLayers = useMemo(
    () => layers.filter(l => l.name !== 'Uso Alternativo' && l.name !== 'Uso Actual'),
    [layers]
  );

  const ndviLegendItems = useMemo(
    () => layers
      .filter(l => l.type === 'analysis' && l.visible && l.legend)
      .map(l => ({ ...l.legend, shape: 'square' })),
    [layers]
  );

  const categoriesLegendItems = useMemo(() => {
    const byKey = new Map();
    const push = (arr, isAlt) => {
      arr.forEach(c => {
        if (!c.active) return;
        const k = c.key;
        const acc = byKey.get(k) || { label: c.label, color: `rgb(${c.color.join(',')})`, alt: false, act: false };
        if (isAlt) acc.alt = true; else acc.act = true;
        byKey.set(k, acc);
      });
    };
    if (altLayer?.visible) push(altCatsUI, true);
    if (actLayer?.visible) push(actCatsUI, false);

    const items = Array.from(byKey.values())
      .map(v => ({
        color: v.color,
        label: `${v.label} (${v.alt ? 'Alt' : ''}${v.alt && v.act ? '/' : ''}${v.act ? 'Act' : ''})`,
        shape: 'circle'
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));

    const MAX = 14;
    if (items.length > MAX) {
      const rest = items.length - MAX;
      return [...items.slice(0, MAX), { color: '#999', label: `y ${rest} más…`, shape: 'circle' }];
    }
    return items;
  }, [altCatsUI, actCatsUI, altLayer?.visible, actLayer?.visible]);

  const legendSections = useMemo(() => ([
    { subtitle: 'Categorías', items: showCategoriesLegend ? categoriesLegendItems : [] },
    { subtitle: 'Análisis', items: ndviLegendItems }
  ]), [showCategoriesLegend, categoriesLegendItems, ndviLegendItems]);

  /* ============================ Render ============================ */
  return (
    <div className="fsv-root">
      <div className="fsv-navbar"><Navbar /></div>

      {isAnalyzing && (
        <Box sx={{ position: 'absolute', top: 60, left: 0, right: 0, zIndex: 11 }}>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      <KpiBar show={!isAnalyzing && !!kpiData} data={kpiData} />

      <aside className={`fsv-sidebar ${menuOpen ? 'open' : ''}`}>
        <header className="sb-hdr">
          <h5 className="sb-title">Análisis multitemporal NDVI</h5>
          <button className="sb-close" title="Cerrar" onClick={() => setMenuOpen(false)}>✕</button>
        </header>

        <div className="fsv-sidebar__body">
          {/* Basemap */}
          <button onClick={toggleBasemap} className="btn-alt" style={{ marginTop: 8 }}>
            {activeBasemap === 'map' ? 'Vista Satélite' : 'Vista Mapa'}
          </button>

          {/* Ir a proyectos */}
          <button onClick={() => navigate('/proyectos')} className="btn-ghost">
            ⬅ Ir a Proyectos
          </button>

          {/* Parámetros del análisis */}
          <div className="sb-group" style={{ marginTop: 12 }}>
            <div style={{ display:'grid', gap:8 }}>

              {/* 🆕 Selector de modo manual por MES/AÑO */}
              <label className="switch-row" style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                <span>Elegir por mes/año</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={manualByMonth}
                    onChange={(e)=> setManualByMonth(e.target.checked)}
                    disabled={isAnalyzing}
                  />
                  <span className="slider" />
                </label>
              </label>

              {manualByMonth && (
                <div style={{display:'grid', gap:8}}>
                  <div style={{display:'grid', gap:6}}>
                    <strong>Fecha antigua</strong>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                      <select
                        value={oldYM.year}
                        onChange={e=> setOldYM(v=> ({...v, year: parseInt(e.target.value,10)}))}
                        disabled={isAnalyzing}
                        title="Año (antigua)"
                      >
                        {Array.from({length: YEAR_MAX - YEAR_MIN + 1}, (_,i)=> YEAR_MAX - i).map(y=>(
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <select
                        value={oldYM.month}
                        onChange={e=> setOldYM(v=> ({...v, month: parseInt(e.target.value,10)}))}
                        disabled={isAnalyzing}
                        title="Mes (antigua)"
                      >
                        {MONTH_NAMES.map((m, i)=>(
                          <option key={i+1} value={i+1}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{display:'grid', gap:6}}>
                    <strong>Fecha reciente</strong>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                      <select
                        value={newYM.year}
                        onChange={e=> setNewYM(v=> ({...v, year: parseInt(e.target.value,10)}))}
                        disabled={isAnalyzing}
                        title="Año (reciente)"
                      >
                        {Array.from({length: YEAR_MAX - YEAR_MIN + 1}, (_,i)=> YEAR_MAX - i).map(y=>(
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <select
                        value={newYM.month}
                        onChange={e=> setNewYM(v=> ({...v, month: parseInt(e.target.value,10)}))}
                        disabled={isAnalyzing}
                        title="Mes (reciente)"
                      >
                        {MONTH_NAMES.map((m, i)=>(
                          <option key={i+1} value={i+1}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {!manualByMonth && (
                <>
                  <div className="duo-row">
                    <label className="duo-field">
                      <span className="duo-label">Año</span>
                      <select
                        className="duo-select"
                        value={yearsBack}
                        onChange={(e)=> setYearsBack(parseInt(e.target.value,10))}
                        disabled={isAnalyzing}
                        title="Año (se calcula como año actual - años atrás)"
                      >
                        {Array.from({ length: maxYearsBack }, (_,i)=> i+1).map(n=>{
                          const y = new Date().getUTCFullYear() - n;
                          return <option key={n} value={n}>{y}</option>;
                        })}
                      </select>
                    </label>

                    <label className="duo-field">
                      <span className="duo-label">Mes</span>
                      <select
                        className="duo-select"
                        multiple
                        size={1}
                        value={months.map(String)}
                        onChange={(e)=>{
                          const vals = Array.from(e.target.selectedOptions).map(o=> parseInt(o.value,10));
                          setMonths(vals.length ? vals : ALL_MONTHS);
                        }}
                        disabled={isAnalyzing}
                        title="Meses (podés elegir varios con Ctrl/Shift)"
                      >
                        {MONTH_NAMES.map((m, i)=>(
                          <option key={i+1} value={i+1}>{m}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </>
              )}

              <div style={{ marginTop: 4 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Umbral de diferencia NDVI: <strong>{ndviThreshold.toFixed(2)}</strong>
                </Typography>
                <Slider
                  value={ndviThreshold}
                  onChange={(e, val) => setNdviThreshold(val)}
                  min={0.05} max={0.5} step={0.01}
                  valueLabelDisplay="auto"
                  disabled={isAnalyzing}
                />
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <button className="btn-main" onClick={handleStartAnalysis} disabled={!isDataReady || isAnalyzing}>
                  {isAnalyzing ? 'Analizando…' : 'Ejecutar análisis'}
                </button>
                <button className="btn-alt" onClick={handleCancelAnalysis} disabled={!isAnalyzing}>Cancelar</button>
                <button className="btn-main" onClick={handleDownloadKML} disabled={isAnalyzing}>Descargar KML</button>
                <button className="btn-ghost" onClick={() => navigate(`/historial-ndvi/${id}`)} disabled={isAnalyzing}>
                  Ver historial
                </button>
              </div>
            </div>
          </div>

          {(dates.oldest !== 'N/A' || dates.latest !== 'N/A') && (
            <details className="sb-group" open>
              <summary className="sb-summary">Fechas seleccionadas</summary>
              <div style={{ padding: '0 .25rem .5rem' }}>
                <div><strong>Antigua:</strong> {dates.oldest}</div>
                <div><strong>Reciente:</strong> {dates.latest}</div>
              </div>
            </details>
          )}

          {/* ======= Capas del análisis ======= */}
          <details className="sb-group" open>
            <summary className="sb-summary">Capas del análisis</summary>

            {/* Uso Alternativo */}
            {altCatsUI.length > 0 && (
              <>
                <div className="section-row" style={{ marginTop: 8 }}>
                  <span>Uso Alternativo</span>
                  <label className="switch" title="Mostrar/Ocultar 'Uso Alternativo'">
                    <input
                      type="checkbox"
                      checked={layers.find(l => l.name === 'Uso Alternativo')?.visible ?? true}
                      onChange={(e) => {
                        const altLayer = layersRef.current.find(l => l.name === 'Uso Alternativo');
                        if (!altLayer) return;
                        handleVisibilityChange(altLayer.id, e.target.checked);
                      }}
                      disabled={!layers.find(l => l.name === 'Uso Alternativo')}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="collapsible">
                  <button type="button" className="collapsible__hdr" onClick={() => setAltCatsOpen(v => !v)}>
                    <div className="collapsible__left">
                      <span className="collapsible__title">Categorías del Uso Alternativo</span>
                      <span className="collapsible__pill">{countActive(altCatsUI)}/{altCatsUI.length}</span>
                    </div>
                    <span className={`collapsible__chev ${altCatsOpen ? 'open' : ''}`}>▾</span>
                  </button>

                  {altCatsOpen && (
                    <div className="collapsible__body">
                      <div className="btn-grid-2" style={{ marginTop: 6 }}>
                        <button
                          className="btn-alt"
                          onClick={() => {
                            const altLayer = layersRef.current.find(l => l.name === 'Uso Alternativo');
                            if (!altLayer) return;
                            const m = { ...altCatsRef.current };
                            Object.keys(m).forEach(k => m[k] = { ...m[k], active: true });
                            altCatsRef.current = m;
                            pushCatsUI();
                            // actualizar visibilidad por categoría
                            altLayer.polygons?.forEach(p => {
                              const cat = altCatsRef.current[p.__catKey];
                              const catActive = !cat || cat.active;
                              p.setMap(altLayer.visible && catActive ? mapRef.current : null);
                            });
                            recomputeTargets();
                          }}
                        >Todos</button>

                        <button
                          className="btn-alt"
                          onClick={() => {
                            const altLayer = layersRef.current.find(l => l.name === 'Uso Alternativo');
                            if (!altLayer) return;
                            const m = { ...altCatsRef.current };
                            Object.keys(m).forEach(k => m[k] = { ...m[k], active: false });
                            altCatsRef.current = m;
                            pushCatsUI();
                            altLayer.polygons?.forEach(p => p.setMap(null));
                            recomputeTargets();
                          }}
                        >Ninguno</button>
                      </div>

                      <div className="cat-list">
                        {altCatsUI.map(c => (
                          <div key={c.key} className="cat-item">
                            <span className="color-chip" style={{ background: `rgb(${c.color.join(',')})` }} />
                            <span className="cat-name">{c.label}</span>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={!!c.active}
                                onChange={() => {
                                  const altLayer = layersRef.current.find(l => l.name === 'Uso Alternativo');
                                  if (!altLayer) return;
                                  const m = { ...altCatsRef.current };
                                  m[c.key] = { ...m[c.key], active: !m[c.key].active };
                                  altCatsRef.current = m;
                                  pushCatsUI();
                                  altLayer.polygons?.forEach(p => {
                                    if (p.__catKey !== c.key) return;
                                    const cat = altCatsRef.current[c.key];
                                    const catActive = !cat || cat.active;
                                    p.setMap(altLayer.visible && catActive ? mapRef.current : null);
                                  });
                                  recomputeTargets();
                                }}
                              />
                              <span className="slider" />
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Uso Actual (solo visual) */}
            {actCatsUI.length > 0 && (
              <>
                <div className="section-row" style={{ marginTop: 10 }}>
                  <span>Uso Actual</span>
                  <label className="switch" title="Mostrar/Ocultar 'Uso Actual'">
                    <input
                      type="checkbox"
                      checked={layers.find(l => l.name === 'Uso Actual')?.visible ?? false}
                      onChange={(e) => {
                        const actLayer = layersRef.current.find(l => l.name === 'Uso Actual');
                        if (!actLayer) return;
                        handleVisibilityChange(actLayer.id, e.target.checked);
                      }}
                      disabled={!layers.find(l => l.name === 'Uso Actual')}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="collapsible">
                  <button type="button" className="collapsible__hdr" onClick={() => setActCatsOpen(v => !v)}>
                    <div className="collapsible__left">
                      <span className="collapsible__title">Categorías del Uso Actual</span>
                      <span className="collapsible__pill">{countActive(actCatsUI)}/{actCatsUI.length}</span>
                    </div>
                    <span className={`collapsible__chev ${actCatsOpen ? 'open' : ''}`}>▾</span>
                  </button>

                  {actCatsOpen && (
                    <div className="collapsible__body">
                      <div className="cat-list">
                        {actCatsUI.map(c => (
                          <div key={c.key} className="cat-item">
                            <span className="color-chip" style={{ background: `rgb(${c.color.join(',')})` }} />
                            <span className="cat-name">{c.label}</span>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={!!c.active}
                                onChange={() => {
                                  const actLayerObj = layersRef.current.find(l => l.name === 'Uso Actual');
                                  if (!actLayerObj) return;
                                  const m = { ...actCatsRef.current };
                                  m[c.key] = { ...m[c.key], active: !m[c.key].active };
                                  actCatsRef.current = m;
                                  pushCatsUI();
                                  actLayerObj.polygons?.forEach(p => {
                                    if (p.__catKey !== c.key) return;
                                    const cat = actCatsRef.current[c.key];
                                    const catActive = !cat || cat.active;
                                    p.setMap(actLayerObj.visible && catActive ? mapRef.current : null);
                                  });
                                }}
                              />
                              <span className="slider" />
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Lista de capas (sin los “Uso ...”) */}
            <div style={{ padding: '8px 4px 10px' }}>
              {nonBaseLayers.map((l) => (
                <div key={l.id} className="layer-item">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={!!l.visible}
                      onChange={(e) => handleVisibilityChange(l.id, e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                  <span className="layer-name">{l.name}</span>
                  {l.polygons && (
                    <input
                      className="opacity-range" type="range" min={0} max={1} step={0.05}
                      value={l.opacity ?? 1}
                      onChange={(e) => handleOpacityChange(l.id, Number(e.target.value))}
                      title={`Opacidad: ${Math.round((l.opacity ?? 1) * 100)}%`}
                    />
                  )}
                </div>
              ))}
            </div>
          </details>

          {/* Estado */}
          <details className="sb-group" open>
            <summary className="sb-summary">Estado del proceso</summary>
            <div className="note-box" style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{status}</div>
          </details>
        </div>
      </aside>

      {!isAnalyzing && (
        <LegendPanel title="Leyenda" sections={legendSections} />
      )}

      {/* Toolbar flotante */}
      <div className="fsv-toolbar">
        <button title="Capas" aria-label="Capas" onClick={() => navigate(`${VISOR_ROUTE_BASE}/${id}`)} className="fsv-pill">
          <span className="fsv-pill__icon">🗺️</span><span className="fsv-pill__text">Capas</span>
        </button>
        <button title="Historial de análisis" aria-label="Historial de análisis" onClick={() => navigate(`/historial-ndvi/${id}`)} className="fsv-pill">
          <span className="fsv-pill__icon">🕓</span><span className="fsv-pill__text">Historial</span>
        </button>
        <button title="Menú de análisis" aria-label="Menú de análisis" onClick={() => setMenuOpen(true)} disabled={isAnalyzing} className="fsv-pill">
          <span className="fsv-pill__icon">📈</span><span className="fsv-pill__text">Análisis</span>
        </button>
        <button
          title={activeBasemap === 'map' ? 'Vista Satélite' : 'Vista Mapa'}
          aria-label={activeBasemap === 'map' ? 'Vista Satélite' : 'Vista Mapa'}
          onClick={toggleBasemap}
          className="fsv-pill"
        >
          <span className="fsv-pill__icon">🛰️</span><span className="fsv-pill__text">{activeBasemap === 'map' ? 'Satélite' : 'Mapa'}</span>
        </button>
        <button
          title={showCategoriesLegend ? 'Ocultar leyenda' : 'Mostrar leyenda'}
          aria-label="Leyenda"
          onClick={() => setShowCategoriesLegend(v => !v)}
          className="fsv-pill"
        >
          <span className="fsv-pill__icon">🏷️</span><span className="fsv-pill__text">Leyenda</span>
        </button>
        <button title="Ir a proyectos" aria-label="Ir a proyectos" onClick={() => navigate('/proyectos')} className="fsv-pill">
          <span className="fsv-pill__icon">↩</span><span className="fsv-pill__text">Proyectos</span>
        </button>
      </div>

      <div id="map" ref={mapContainerRef} className="fsv-map" />
    </div>
  );
};

export default AnalisisNDVI;
