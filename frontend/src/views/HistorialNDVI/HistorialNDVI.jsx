// src/views/HistorialNDVI/HistorialNDVI.jsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '@/views/AnalisisNDVI/AnalisisNDVI.css';
import '@/styles/FullScreenVisor.theme.css';

import Navbar from '@/components/Navbar';
import LegendPanel from '@/components/LegendPanel';
import { Box, LinearProgress } from '@mui/material';

import GeoJSONFormat from 'ol/format/GeoJSON';
import WKT from 'ol/format/WKT';
import * as turf from '@turf/turf';

import { loadGoogleMapsApi } from '@/utils/loadGoogleMapsApi';

const API_URL = import.meta.env.VITE_API_URL;

/** Sentinel Hub WMS */
const instanceId = '0baff9f5-a1a3-4238-9387-2779558d8633';
const wmsBaseUrl = `https://services.sentinel-hub.com/ogc/wms/${instanceId}`;
const TRUE_COLOR = '2_TONEMAPPED_NATURAL_COLOR';

/* ===== Colores de clases de cambio (líneas) ===== */
const COLORS_BY_CLASS = {
  gt_2ha: '#ff2600',
  '1_to_2ha': '#ffa500',
  '0_5_to_1ha': '#ffee00',
  lte_0_5ha: '#00e5ff',
};

/* ===== Paleta categórica (no la usamos mucho aquí, pero la dejo por compatibilidad) ===== */
const COLORS = {
  'bosques de reserva forestal': [38, 115, 0],
  'bosques excedentes de reserva forestal': [112, 168, 0],
  'bosques de reserva forestal bajo manejo': [92, 137, 68],
  'bosques protectores de cauces hidricos': [190, 232, 255],
  'zonas de proteccion de cauces hidricos': [122, 245, 202],
  'zona de restriccion en margenes de cauces hidricos': [0, 230, 169],
  'barreras vivas de proteccion': [230, 152, 0],
  'franjas de separacion': [230, 152, 0],
  'caminos cortafuego': [245, 202, 122],
  'area en regeneracion': [165, 245, 122],
  'area a reforestar': [137, 205, 102],
  'area silvestre protegida': [115, 76, 0],
  'uso agricola': [255, 255, 0],
  'uso ganadero': [205, 102, 153],
  'uso agropecuario': [255, 211, 127],
  arrozales: [255, 255, 190],
  canales: [0, 132, 168],
  'plantaciones forestales': [0, 168, 132],
  'uso silvopastoril': [163, 255, 115],
  'campo natural': [205, 245, 122],
  matorrales: [114, 137, 68],
  'cuerpos de agua': [0, 92, 230],
  esteros: [0, 169, 230],
  manantiales: [0, 76, 115],
  'zona inundable': [115, 223, 255],
  'cultivos ilegales': [169, 0, 230],
  'area invadida': [202, 122, 245],
  'area siniestrada': [230, 0, 169],
  loteamientos: [130, 130, 130],
  'contribucion inmobiliaria obligatoria': [115, 115, 0],
  'construcciones edilicias': [225, 225, 225],
  cementerio: [190, 210, 255],
  'area de destape': [205, 137, 102],
  oleria: [245, 122, 182],
  'area de prestamo': [215, 176, 158],
  arenera: [245, 245, 122],
  'area de nivelacion': [215, 215, 158],
  polvorin: [178, 178, 178],
  'planta trituradora': [230, 230, 0],
  'planta asfaltica': [115, 0, 0],
  'area de maniobra y estacionamiento': [255, 255, 255],
  caminos: [225, 190, 190],
  'pista de aterrizaje': [232, 190, 255],
  'estacion de servicio': [223, 115, 255],
  silo: [68, 79, 137],
  deposito: [122, 182, 245],
  'area de acopio': [102, 119, 205],
  corrales: [245, 202, 122],
  galpones: [68, 101, 137],
  'abastecimiento de agua': [190, 255, 232],
  canchadas: [205, 102, 102],
  puerto: [137, 68, 101],
  'area industrial': [255, 127, 127],
  infraestructura: [168, 0, 0],
  'fosa o trinchera': [168, 0, 132],
  'area de segregacion': [122, 142, 245],
  'pileta de agregar uso': [102, 205, 171],
  'area de servidumbre': [112, 68, 137],
  'resto de propiedad': [255, 255, 255],
  'servicios ambientales': [170, 255, 0],
  'comunidades indigenas': [137, 90, 68],
  'otros usos': [158, 187, 215],
  isletas: [152, 230, 0],
};
const DEFAULT_ACT = [255, 165, 0]; // fallback Uso Actual
const DEFAULT_ALT = [0, 128, 0]; // fallback Uso Alternativo

const rgbToRgba = (rgbArr, alpha = 0.35) =>
  `rgba(${rgbArr[0]}, ${rgbArr[1]}, ${rgbArr[2]}, ${alpha})`;
const rgbToCss = (rgbArr) =>
  `rgb(${rgbArr[0]}, ${rgbArr[1]}, ${rgbArr[2]})`;

/* ===== estilos por nombre de capa ===== */
const projectLayerStyles = {
  'Poligono del Proyecto': {
    strokeColor: '#e74c3c',
    fillColor: 'rgba(231, 76, 60, 0.08)',
  },
  'Polígono del Proyecto': {
    strokeColor: '#e74c3c',
    fillColor: 'rgba(231, 76, 60, 0.08)',
  },
  'Uso Alternativo': {
    strokeColor: '#008000',
    fillColor: 'rgba(0,128,0,0.20)',
  },
  'Uso Actual': {
    strokeColor: '#ff9900',
    fillColor: 'rgba(255,153,0,0.18)',
  },
  default: {
    strokeColor: '#2c3e50',
    fillColor: 'rgba(44, 62, 80, 0.15)',
  },
};

const getStyleForLayerName = (name) => {
  const s = projectLayerStyles[name] || projectLayerStyles.default;
  return s;
};

const norm = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const toYMD = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/* === clave de uso desde la feature (para posible leyenda categórica) === */
const getUsoKeyFromFeature = (feature) => {
  const raw =
    feature.properties?.uso ??
    feature.properties?.uso_actual ??
    feature.properties?.uso_alternativo ??
    feature.properties?.categoria ??
    feature.properties?.clase ??
    feature.properties?.name ??
    feature.properties?.nombre;
  return norm(String(raw || ''));
};

/* ===== helpers Google ===== */
function createPolygonsFromGeometry(google, map, geom, optionsBase = {}) {
  const polys = [];
  if (!geom) return polys;

  const mkPaths = (coords) =>
    coords.map((ring) =>
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
    geom.coordinates.forEach((polyCoords) => {
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

/* ===== helper imagery ===== */
const pickTrueColorLayerName = (im) => {
  const wl = String(im?.wms_layer || '').toLowerCase();
  const looksNdvi =
    wl.includes('ndvi') ||
    wl.includes('b08_b04') ||
    (wl.includes('b08') && wl.includes('b04'));
  if (looksNdvi) return im?.raw_meta?.trueColorLayer || TRUE_COLOR;
  return im?.wms_layer || im?.raw_meta?.trueColorLayer || TRUE_COLOR;
};

const labelFromLayer = (layerName, dateISO) => {
  const lc = (layerName || '').toLowerCase();
  if (layerName === TRUE_COLOR || lc.includes('natural') || lc.includes('true')) {
    return `Vista Color (${toYMD(dateISO)})`;
  }
  if (
    lc.includes('ndvi') ||
    lc.includes('b08_b04') ||
    (lc.includes('b08') && lc.includes('b04')) ||
    lc.includes('swir')
  ) {
    return `NDVI/Índices (${toYMD(dateISO)})`;
  }
  return `${layerName || 'WMS'} ${toYMD(dateISO)}`;
};

const buildImageryUrl = (im, bbox) => {
  const layerName = pickTrueColorLayerName(im);
  const time = im.wms_time || im.acquisition_date || '';
  const [minX, minY, maxX, maxY] = bbox;
  const WIDTH = 1200;
  const HEIGHT = 1200;

  return (
    `${wmsBaseUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(layerName)}` +
    `&BBOX=${minX},${minY},${maxX},${maxY}` +
    `&WIDTH=${WIDTH}&HEIGHT=${HEIGHT}` +
    `&FORMAT=image/png` +
    `&TIME=${encodeURIComponent(time)}` +
    `&CRS=EPSG:4326&SHOWLOGO=false`
  );
};

/* ============================ Componente ============================ */
const HistorialNDVI = () => {
  const { id } = useParams(); // project_gid
  const navigate = useNavigate();

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);

  const projectBboxRef = useRef(null); // [minX,minY,maxX,maxY] en 4326
  const loadedProjectRef = useRef(false);
  const analysisGeojsonRef = useRef(null); // último FeatureCollection de cambios

  const [status, setStatus] = useState('Cargando historial…');
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // Saber cuándo el mapa está listo
  const [mapReady, setMapReady] = useState(false);

  // { id, name, type: 'sat'|'changes'|'project', polygons?, overlay?, visible, opacity, legend? }
  const [layers, setLayers] = useState([]);

  // análisis del backend
  const [analyses, setAnalyses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedMeta, setSelectedMeta] = useState(null);
  const [kpiData, setKpiData] = useState(null);

  const [activeBasemap, setActiveBasemap] = useState('map'); // 'map' | 'sat'

  const appendStatus = (msg) =>
    setStatus((prev) => (prev ? `${prev}\n${msg}` : msg));

  /* ===== helpers de capas ===== */
  const addLayer = useCallback((cfg) => {
    if (!cfg) return;
    setLayers((prev) =>
      prev.some((l) => l.id === cfg.id) ? prev : [...prev, cfg]
    );
  }, []);

  const removeByTypes = useCallback((types) => {
    setLayers((curr) => {
      curr
        .filter((l) => types.includes(l.type))
        .forEach((l) => {
          l.polygons?.forEach((p) => p.setMap(null));
          l.overlay?.setMap(null);
        });
      return curr.filter((l) => !types.includes(l.type));
    });
  }, []);

  const removeAnalysisLayers = useCallback(() => {
    removeByTypes(['sat', 'changes']);
    setKpiData(null);
    analysisGeojsonRef.current = null;
  }, [removeByTypes]);

  const handleVisibilityChange = (layerId, visible) => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id === layerId) {
          l.polygons?.forEach((p) => p.setMap(visible ? mapRef.current : null));
          if (l.overlay) l.overlay.setMap(visible ? mapRef.current : null);
          return { ...l, visible };
        }
        return l;
      })
    );
  };

  const handleOpacityChange = (layerId, opacity) => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id === layerId) {
          l.polygons?.forEach((p) => {
            const base = p.__baseFillOpacity ?? 0.3;
            p.setOptions({
              fillOpacity: base * opacity,
              strokeOpacity: 0.9 * opacity,
            });
          });
          // GroundOverlay no tiene opacidad dinámica fácil; si hace falta se recrea.
          return { ...l, opacity };
        }
        return l;
      })
    );
  };

  /* ===== Agrupar capas para la UI ===== */
  const projectLayers = useMemo(
    () => layers.filter((l) => l.type === 'project'),
    [layers]
  );

  const imageryLayers = useMemo(() => {
    const rx = /\((\d{4}-\d{2}-\d{2})\)/;
    const parseDate = (name) => {
      const m = rx.exec(name || '');
      return m ? m[1] : '';
    };
    return layers
      .filter((l) => l.type === 'sat')
      .map((l) => ({ ...l, _d: parseDate(l.name) }))
      .sort((a, b) => String(b._d).localeCompare(String(a._d)));
  }, [layers]);

  const changeLayers = useMemo(
    () => layers.filter((l) => l.type === 'changes'),
    [layers]
  );

  /* ===== Leyenda ===== */
  const legendSections = useMemo(() => {
    const sections = [];

    // 1) Leyenda de análisis de cambios
    const changeItems = layers
      .filter((l) => l.type === 'changes' && l.visible && l.legend)
      .map((l) => ({ ...l.legend, shape: 'square' }));
    if (changeItems.length)
      sections.push({ subtitle: 'Análisis', items: changeItems });

    return sections;
  }, [layers]);

  const toggleBasemap = useCallback(() => {
    if (!mapRef.current) return;
    setActiveBasemap((prev) => {
      const next = prev === 'map' ? 'sat' : 'map';
      mapRef.current.setMapTypeId(next === 'map' ? 'roadmap' : 'hybrid');
      return next;
    });
  }, []);

  /* ===== botón: Volver a Análisis ===== */
  const goBackToAnalysis = useCallback(() => {
    navigate(`/proyectos/${id}/analisis-ndvi`);
  }, [navigate, id]);

  /* ===== normalización de análisis ===== */
  const makeDisplayLabel = (raw) => {
    const p = raw.payload || raw;
    const dn = p.date_new ?? raw.date_new ?? p.created_at ?? raw.created_at;
    const d = toYMD(dn);
    return d ? `NDVI auto ${d}` : p.label ?? raw.label ?? 'Análisis';
  };

  const normalizeAnalysis = (raw) => {
    const p = raw.payload || raw;
    const analysis_id = raw.analysis_id ?? raw.id ?? raw.use_change_analysis_id;
    const date_old = p.date_old ?? raw.date_old ?? null;
    const date_new = p.date_new ?? raw.date_new ?? null;
    const created_at = raw.created_at ?? p.created_at ?? null;

    const counts = {
      total: p.total_clusters ?? raw.total_clusters ?? null,
      gt2: p.gt2_count ?? raw.gt2_count ?? null,
      oneToTwo: p.one_to_two_count ?? raw.one_to_two_count ?? null,
      halfToOne: p.half_to_one_count ?? raw.half_to_one_count ?? null,
      lte05: p.lte05_count ?? raw.lte05_count ?? null,
    };

    return {
      analysis_id,
      label: makeDisplayLabel(raw),
      date_old,
      date_new,
      created_at,
      counts,
    };
  };

  const fetchAnalyses = useCallback(async () => {
    setIsBusy(true);
    setProgress(10);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `${API_URL}/use-change/analyses?project_gid=${id}`,
        {
          headers: { Authorization: 'Bearer ' + token },
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let list = (Array.isArray(data) ? data : data.items || []).map(
        normalizeAnalysis
      );
      list = list.sort((a, b) =>
        String(b.date_new || b.created_at || '').localeCompare(
          String(a.date_new || a.created_at || '')
        )
      );

      setAnalyses(list);
      if (list.length) setSelectedId(list[0].analysis_id);
      setStatus(
        list.length
          ? 'Seleccione un análisis y presione Cargar.'
          : 'No hay análisis guardados para este proyecto.'
      );
    } catch (e) {
      console.error(e);
      setStatus('Error cargando historial.');
    } finally {
      setIsBusy(false);
      setProgress(0);
    }
  }, [id]);

  /* ===== init Google Map ===== */
  useEffect(() => {
    let cancelled = false;
    if (mapRef.current || !mapContainerRef.current) return;

    (async () => {
      try {
        const google = await loadGoogleMapsApi();
        if (cancelled) return;

        const map = new google.maps.Map(mapContainerRef.current, {
          center: { lat: -23.5, lng: -57.5 },
          zoom: 6,
          minZoom: 4,          // 👈 NO dejar alejar más que esto
          mapTypeId: 'roadmap',
        });
        mapRef.current = map;
        setActiveBasemap('map');
        setMapReady(true); // mapa listo
      } catch (e) {
        console.error('Error cargando Google Maps en Historial NDVI:', e);
        setStatus('Error cargando Google Maps.');
      }
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, []);

  /* ===== capas del proyecto ===== */
  const loadProjectLayers = useCallback(async () => {
    if (!mapRef.current || loadedProjectRef.current) return;

    setIsBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/proyectos/${id}/capas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const google = window.google;
      if (!google) throw new Error('Google Maps no está listo.');

      const allFeatures = [];
      const gjFormatter = new GeoJSONFormat();

      (data || []).forEach(({ nombre, geojson }) => {
        if (!geojson?.features?.length) return;

        if (geojson.crs) delete geojson.crs;

        // acumulamos para bbox
        allFeatures.push(...geojson.features);

        const layerNameNorm = norm(nombre);

        // 👇 detectar capas de uso de forma más flexible
        const isUsoLayer =
          layerNameNorm.includes('uso alternativo') ||
          layerNameNorm.includes('uso actual');

        const isAlt = layerNameNorm.includes('uso alternativo');
        const fallback = isAlt ? DEFAULT_ALT : DEFAULT_ACT;

        // 👇 por defecto visibles: polígono de proyecto + usos
        const visibleDefault =
          (layerNameNorm.includes('poligono') &&
            layerNameNorm.includes('proyecto')) ||
          isUsoLayer;

        const styleLayer = getStyleForLayerName(nombre);

        const polygons = [];

        geojson.features.forEach((f) => {
          const geom = f.geometry;
          if (!geom) return;

          let strokeColor = styleLayer.strokeColor;
          let fillColor = styleLayer.fillColor;

          if (isUsoLayer) {
            const key = getUsoKeyFromFeature(f);
            const rgb = COLORS[key] || fallback;
            strokeColor = 'rgba(0,0,0,0.35)';
            fillColor = rgbToRgba(rgb, 0.35);
          }

          const optsBase = {
            strokeColor,
            strokeOpacity: 0.95,
            strokeWeight: isUsoLayer ? 1 : 2,
            fillColor,
            fillOpacity: isUsoLayer ? 0.35 : 0.12,
            visible: visibleDefault,
          };

          const polys = createPolygonsFromGeometry(
            google,
            mapRef.current,
            geom,
            optsBase
          );
          polys.forEach((p) => {
            p.__baseFillOpacity = optsBase.fillOpacity;
            polygons.push(p);
          });
        });

        addLayer({
          id: `project-${layerNameNorm}-${id}`,
          name: nombre,
          type: 'project',
          polygons,
          visible: visibleDefault,
          opacity: 1,
        });
      });

      if (allFeatures.length) {
        const bbox = turf.bbox({
          type: 'FeatureCollection',
          features: allFeatures,
        });
        projectBboxRef.current = bbox;
        const [minX, minY, maxX, maxY] = bbox;

        const bounds = new window.google.maps.LatLngBounds(
          { lat: minY, lng: minX },
          { lat: maxY, lng: maxX }
        );
        mapRef.current.fitBounds(bounds, { padding: 60 });
      }

      loadedProjectRef.current = true;
    } catch (e) {
      console.warn('Capas del proyecto no cargadas (Historial NDVI):', e);
    } finally {
      setIsBusy(false);
    }
  }, [id, addLayer]);

  // Esperamos a que el mapa esté listo
  useEffect(() => {
    if (!mapReady) return;
    loadProjectLayers();
  }, [mapReady, loadProjectLayers]);

  useEffect(() => {
    fetchAnalyses();
  }, [fetchAnalyses]);

  /* ===== cargar análisis ===== */
  const loadAnalysisById = useCallback(
    async (analysisId) => {
      if (!analysisId || !mapRef.current) return;
      const google = window.google;
      if (!google) {
        setStatus('Google Maps aún no está listo.');
        return;
      }

      setSelectedId(analysisId);
      removeAnalysisLayers();
      setIsBusy(true);
      setProgress(15);
      setStatus('Cargando polígonos del historial…');

      try {
        const token = localStorage.getItem('token');

        // Detalle
        const resDet = await fetch(
          `${API_URL}/use-change/analyses/${analysisId}`,
          {
            headers: { Authorization: 'Bearer ' + token },
          }
        );
        if (!resDet.ok) throw new Error(`HTTP ${resDet.status}`);
        const det = await resDet.json();
        const a = normalizeAnalysis(det);
        setSelectedMeta({
          label: a.label,
          dateNew: toYMD(a.date_new || a.created_at),
          dateOld: toYMD(a.date_old),
        });

        // Área de análisis (mask_wkt) si existe
        const maskWkt = det?.payload?.mask_wkt;
        let analysisBbox = projectBboxRef.current || null;
        const gjFormatter = new GeoJSONFormat();
        const wktFormatter = new WKT();

        if (maskWkt) {
          try {
            const geom = wktFormatter.readGeometry(maskWkt, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:4326',
            });
            const gjGeom = gjFormatter.writeGeometryObject(geom, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:4326',
            });

            const polys = createPolygonsFromGeometry(
              google,
              mapRef.current,
              gjGeom,
              {
                strokeColor: '#2c3e50',
                strokeWeight: 2,
                strokeOpacity: 0.8,
                fillColor: 'rgba(44,62,80,0.08)',
                fillOpacity: 0.08,
                visible: true,
              }
            );

            addLayer({
              id: `project-mask-${analysisId}`,
              name: 'Área de análisis',
              type: 'project',
              polygons: polys,
              visible: true,
              opacity: 1,
            });

            const bbox = turf.bbox({
              type: 'Feature',
              geometry: gjGeom,
            });
            analysisBbox = bbox;
            projectBboxRef.current = projectBboxRef.current || bbox;

            const [minX, minY, maxX, maxY] = bbox;
            const bounds = new google.maps.LatLngBounds(
              { lat: minY, lng: minX },
              { lat: maxY, lng: maxX }
            );
            mapRef.current.fitBounds(bounds, { padding: 60 });
          } catch (e) {
            console.warn('No se pudo dibujar mask_wkt:', e);
          }
        }

        setProgress(40);

        // Features (GeoJSON)
        const resFeats = await fetch(
          `${API_URL}/use-change/analyses/${analysisId}/features`,
          {
            headers: { Authorization: 'Bearer ' + token },
          }
        );
        if (!resFeats.ok) throw new Error(`HTTP ${resFeats.status}`);
        const featsData = await resFeats.json();
        const fc =
          featsData?.type === 'FeatureCollection'
            ? featsData
            : {
                type: 'FeatureCollection',
                features: featsData?.features || featsData || [],
              };

        analysisGeojsonRef.current = fc;

        const byClass = {
          gt_2ha: [],
          '1_to_2ha': [],
          '0_5_to_1ha': [],
          lte_0_5ha: [],
        };

        (fc.features || []).forEach((f) => {
          const klass = f.properties?.class;
          if (!klass) return;
          (byClass[klass] || (byClass[klass] = [])).push(f);
        });

        const extents = [];

        const makeChangesLayer = (arr, klass, label) => {
          if (!arr.length) return;
          const color = COLORS_BY_CLASS[klass];
          const polygons = [];
          arr.forEach((f) => {
            const geom = f.geometry;
            if (!geom) return;
            const optsBase = {
              strokeColor: color,
              strokeOpacity: 0.95,
              strokeWeight:
                klass === 'gt_2ha'
                  ? 2.5
                  : klass === '1_to_2ha'
                  ? 2
                  : klass === '0_5_to_1ha'
                  ? 1.5
                  : 1,
              fillColor: color,
              fillOpacity: 0.05,
              visible: true,
            };
            const polys = createPolygonsFromGeometry(
              google,
              mapRef.current,
              geom,
              optsBase
            );
            polys.forEach((p) => {
              p.__baseFillOpacity = optsBase.fillOpacity;
              polygons.push(p);
            });
          });

          if (polygons.length) {
            // bbox 4326 de esta clase
            try {
              const bbox = turf.bbox({
                type: 'FeatureCollection',
                features: arr,
              });
              extents.push(bbox);
            } catch {}

            addLayer({
              id: `hist-${klass}-${analysisId}`,
              name: label,
              type: 'changes',
              polygons,
              visible: true,
              opacity: 1,
              legend: { color, label },
            });
          }
        };

        makeChangesLayer(byClass.gt_2ha, 'gt_2ha', 'Cambio > 2ha');
        makeChangesLayer(
          byClass['1_to_2ha'],
          '1_to_2ha',
          'Cambio 1–2ha'
        );
        makeChangesLayer(
          byClass['0_5_to_1ha'],
          '0_5_to_1ha',
          'Cambio 0.5–1ha'
        );
        makeChangesLayer(
          byClass.lte_0_5ha,
          'lte_0_5ha',
          'Cambio ≤ 0.5ha'
        );

        // Imágenes Sentinel (GroundOverlay)
        try {
          const resIm = await fetch(
            `${API_URL}/use-change/analyses/${analysisId}/imagery`,
            {
              headers: { Authorization: 'Bearer ' + token },
            }
          );
          if (resIm.ok) {
            const images = await resIm.json();
            const olds = images.filter((i) => i.role === 'old');
            const news = images.filter((i) => i.role === 'new');
            const others = images.filter(
              (i) => !['old', 'new'].includes(i.role)
            );

            const allImagesOrdered = [...news, ...olds, ...others];

            let bboxForImagery =
              analysisBbox || projectBboxRef.current || null;
            if (!bboxForImagery && extents.length) {
              // union de extents
              const xs = extents.map((e) => e[0]);
              const ys = extents.map((e) => e[1]);
              const Xe = extents.map((e) => e[2]);
              const Ye = extents.map((e) => e[3]);
              bboxForImagery = [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...Xe),
                Math.max(...Ye),
              ];
            }
            if (bboxForImagery) {
              const [minX, minY, maxX, maxY] = bboxForImagery;
              const bounds = new google.maps.LatLngBounds(
                { lat: minY, lng: minX },
                { lat: maxY, lng: maxX }
              );

              allImagesOrdered.forEach((im, idx) => {
                const url = buildImageryUrl(im, bboxForImagery);
                const defaultVisible = idx === 0; // primera visible
                const overlay = new google.maps.GroundOverlay(url, bounds, {
                  opacity: defaultVisible ? 1 : 0.9,
                });
                overlay.setMap(defaultVisible ? mapRef.current : null);

                const label = labelFromLayer(
                  pickTrueColorLayerName(im),
                  im.acquisition_date || im.wms_time
                );

                addLayer({
                  id: `img-${im.role}-${
                    im.id || Math.random().toString(36).slice(2)
                  }-${analysisId}`,
                  name: label,
                  type: 'sat',
                  overlay,
                  visible: defaultVisible,
                  opacity: 1,
                });
              });
            }
          }
        } catch (e) {
          console.warn('Error cargando imagery historial NDVI:', e);
        }

        // Fit a extents de cambios si no se ajustó antes
        if (!analysisBbox && extents.length) {
          const xs = extents.map((e) => e[0]);
          const ys = extents.map((e) => e[1]);
          const Xe = extents.map((e) => e[2]);
          const Ye = extents.map((e) => e[3]);
          const bbox = [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...Xe),
            Math.max(...Ye),
          ];
          const [minX, minY, maxX, maxY] = bbox;
          const bounds = new google.maps.LatLngBounds(
            { lat: minY, lng: minX },
            { lat: maxY, lng: maxX } // corregido: lng/lon correcto
          );
          mapRef.current.fitBounds(bounds, { padding: 60 });
        }

        // KPI
        const counts = a.counts || {};
        const totals = {
          gt2: counts.gt2 ?? (byClass.gt_2ha?.length || 0),
          oneToTwo:
            counts.oneToTwo ?? (byClass['1_to_2ha']?.length || 0),
          halfToOne:
            counts.halfToOne ?? (byClass['0_5_to_1ha']?.length || 0),
          lte05: counts.lte05 ?? (byClass.lte_0_5ha?.length || 0),
        };
        const total = Object.values(totals).reduce(
          (s, n) => s + (n || 0),
          0
        );
        const pct = (n) =>
          total ? Math.round(((n || 0) / total) * 100) : 0;
        setKpiData({
          total,
          gt2: totals.gt2,
          oneToTwo: totals.oneToTwo,
          halfToOne: totals.halfToOne,
          lte05: totals.lte05,
          pGt2: pct(totals.gt2),
          pOneToTwo: pct(totals.oneToTwo),
          pHalfToOne: pct(totals.halfToOne),
          pLte05: pct(totals.lte05),
        });

        setStatus(`Historial cargado: ${a.label}`);
      } catch (e) {
        console.error(e);
        setStatus('Error al cargar el análisis.');
      } finally {
        setIsBusy(false);
        setProgress(0);
      }
    },
    [addLayer, removeAnalysisLayers]
  );

  /* ===== UI helpers ===== */
  const nonBaseLayers = useMemo(
    () => layers.filter((l) => l.type !== 'base'),
    [layers]
  );

  const downloadKML = async () => {
    const fc = analysisGeojsonRef.current;
    if (!fc || !fc.features || !fc.features.length) {
      setStatus('No hay cambios a exportar.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/export/kml/geojson`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('token'),
        },
        body: JSON.stringify({
          name: `Cambios NDVI (historial) Proyecto ${id}`,
          featureCollection: fc,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historial_ndvi_${id}.kml`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('KML exportado.');
    } catch (e) {
      console.error(e);
      setStatus('Error exportando KML.');
    }
  };

  /* ============================ Render ============================ */
  return (
    <div className="fsv-root">
      <div className="fsv-navbar">
        <Navbar />
      </div>

      {isBusy && (
        <Box
          sx={{
            position: 'absolute',
            top: 60,
            left: 0,
            right: 0,
            zIndex: 11,
          }}
        >
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {/* KPI */}
      {kpiData && (
        <div className="fsv-kpibar">
          <div className="kpi-card kpi-total">
            <div className="kpi-top">Total</div>
            <div className="kpi-sub">Áreas de cambio</div>
            <div className="kpi-val">
              ({kpiData.total.toLocaleString('es')})
            </div>
          </div>
          {[
            {
              pct: kpiData.pGt2,
              color: COLORS_BY_CLASS.gt_2ha,
              label: 'Cambio > 2ha',
              val: kpiData.gt2,
            },
            {
              pct: kpiData.pOneToTwo,
              color: COLORS_BY_CLASS['1_to_2ha'],
              label: 'Cambio 1–2ha',
              val: kpiData.oneToTwo,
            },
            {
              pct: kpiData.pHalfToOne,
              color: COLORS_BY_CLASS['0_5_to_1ha'],
              label: 'Cambio 0.5–1ha',
              val: kpiData.halfToOne,
            },
            {
              pct: kpiData.pLte05,
              color: COLORS_BY_CLASS.lte_0_5ha,
              label: 'Cambio ≤ 0.5ha',
              val: kpiData.lte05,
            },
          ].map((k, i) => (
            <div key={i} className="kpi-card">
              <div className="kpi-donut">
                <svg viewBox="0 0 44 44" aria-hidden>
                  <circle className="bg" cx="22" cy="22" r="18" />
                  <circle
                    className="ring"
                    cx="22"
                    cy="22"
                    r="18"
                    style={{
                      strokeDasharray: `${
                        (Math.max(0, Math.min(100, k.pct)) / 100) *
                        (2 * Math.PI * 18)
                      } ${2 * Math.PI * 18}`,
                      stroke: k.color,
                    }}
                  />
                </svg>
              </div>
              <div className="kpi-body">
                <div className="kpi-top">{k.pct}%</div>
                <div className="kpi-sub">{k.label}</div>
                <div className="kpi-val">
                  ({(k.val ?? 0).toLocaleString('es')})
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <aside className="fsv-sidebar open">
        <header className="sb-hdr">
          <h5 className="sb-title">Historial de Cambios</h5>
          <button
            className="sb-close"
            onClick={goBackToAnalysis}
            title="Volver a Análisis"
          >
            ✕
          </button>
        </header>

        <div className="fsv-sidebar__body">
          {/* selector de análisis */}
          <details className="sb-group" open>
            <summary className="sb-summary">Análisis guardados</summary>
            <div
              style={{
                padding: '8px 6px 10px',
                display: 'grid',
                gap: 8,
              }}
            >
              <select
                className="input"
                value={selectedId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {(analyses || []).map((a) => (
                  <option key={a.analysis_id} value={a.analysis_id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button
                className="btn-main"
                onClick={() => selectedId && loadAnalysisById(selectedId)}
                disabled={!analyses.length}
              >
                Cargar
              </button>

              {selectedMeta && (
                <div className="note-box" style={{ marginTop: 6 }}>
                  <strong>{selectedMeta.label}</strong>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.9,
                      marginTop: 4,
                    }}
                  >
                    <div>
                      <strong>Reciente:</strong>{' '}
                      {selectedMeta.dateNew || '—'}
                    </div>
                    {selectedMeta.dateOld ? (
                      <div>
                        <strong>Antigua:</strong>{' '}
                        {selectedMeta.dateOld}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* control de capas */}
          <details className="sb-group" open>
            <summary className="sb-summary">Capas</summary>

            {/* Proyecto */}
            {projectLayers.length > 0 && (
              <>
                <div className="sb-subtitle">Proyecto</div>
                <div
                  style={{
                    padding: '8px 4px 10px',
                  }}
                >
                  {projectLayers.map((l) => (
                    <div key={l.id} className="layer-item">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!l.visible}
                          onChange={(e) =>
                            handleVisibilityChange(
                              l.id,
                              e.target.checked
                            )
                          }
                        />
                        <span className="slider" />
                      </label>
                      <span className="layer-name">{l.name}</span>
                      <input
                        className="opacity-range"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={l.opacity ?? 1}
                        onChange={(e) =>
                          handleOpacityChange(
                            l.id,
                            Number(e.target.value)
                          )
                        }
                        title={`Opacidad: ${Math.round(
                          (l.opacity ?? 1) * 100
                        )}%`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Imágenes por fecha */}
            {imageryLayers.length > 0 && (
              <>
                <div className="sb-subtitle">Imágenes (fechas)</div>
                <div
                  style={{
                    padding: '8px 4px 10px',
                  }}
                >
                  {imageryLayers.map((l) => (
                    <div key={l.id} className="layer-item">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!l.visible}
                          onChange={(e) =>
                            handleVisibilityChange(
                              l.id,
                              e.target.checked
                            )
                          }
                        />
                        <span className="slider" />
                      </label>
                      <span className="layer-name">{l.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Cambios */}
            {changeLayers.length > 0 && (
              <>
                <div className="sb-subtitle">Cambios</div>
                <div
                  style={{
                    padding: '8px 4px 10px',
                  }}
                >
                  {changeLayers.map((l) => (
                    <div key={l.id} className="layer-item">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!l.visible}
                          onChange={(e) =>
                            handleVisibilityChange(
                              l.id,
                              e.target.checked
                            )
                          }
                        />
                        <span className="slider" />
                      </label>
                      <span className="layer-name">{l.name}</span>
                      <input
                        className="opacity-range"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={l.opacity ?? 1}
                        onChange={(e) =>
                          handleOpacityChange(
                            l.id,
                            Number(e.target.value)
                          )
                        }
                        title={`Opacidad: ${Math.round(
                          (l.opacity ?? 1) * 100
                        )}%`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </details>

          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn-alt" onClick={goBackToAnalysis}>
              ← Volver a Análisis
            </button>
            {/* Basemap */}
            <button
              onClick={toggleBasemap}
              className="btn-alt"
              style={{ marginTop: 8 }}
            >
              {activeBasemap === 'map'
                ? 'Vista Satélite'
                : 'Vista Mapa'}
            </button>

            <button
              className="btn-main"
              onClick={downloadKML}
              disabled={
                !nonBaseLayers.some((l) => l.type === 'changes')
              }
            >
              Descargar KML
            </button>
          </div>

          <details className="sb-group" open>
            <summary className="sb-summary">Estado</summary>
            <div
              className="note-box"
              style={{ whiteSpace: 'pre-line' }}
            >
              {status}
            </div>
          </details>
        </div>
      </aside>

      <LegendPanel title="Leyenda" sections={legendSections} />

      <div id="map" ref={mapContainerRef} className="fsv-map" />
    </div>
  );
};

export default HistorialNDVI;
