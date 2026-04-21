import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams } from "react-router-dom";
import { gvGetDashboard, gvGetTramosCensales, gvGetSubtramosCensales, gvGetAvanceTemporal, gvGetDetalleTemporal, gvGetEconomico } from "./gv_service";
import GVCharts from "./GVCharts";
import GVMapaCatastroGoogle from "./GVMapaCatastroGoogle";
import GVTemporalCharts from "./GVTemporalCharts";
import GVEconomicPanel from "./GVEconomicPanel";
import GvExpedienteModal from "./GvExpedienteModal";
import GvPhaseChip from "./GvPhaseChip";
import { getPhaseHex } from "./gv_colors";
import { Collapse, Button } from "react-bootstrap";
import "./gv.css";

function normalizePhaseCounts(dashboard, tipo, maxFases = 7) {
  if (!dashboard) return Array(maxFases + 1).fill(0);

  const countsRaw = dashboard.phases?.[tipo]?.counts || dashboard.by_phase?.[tipo] || dashboard.counts_by_phase?.[tipo];

  let result = Array(maxFases + 1).fill(0);

  if (Array.isArray(countsRaw)) {
    for (let i = 0; i < countsRaw.length && i <= maxFases; i++) {
      result[i] = Number(countsRaw[i]) || 0;
    }
  } else if (countsRaw && typeof countsRaw === "object") {
    Object.keys(countsRaw).forEach((key) => {
      const i = Number(key);
      if (i >= 0 && i <= maxFases) {
        result[i] = Number(countsRaw[key]) || 0;
      }
    });
  }

  return result;
}

function safeNumber(x, fallback = 0) {
  if (x === null || x === undefined) return fallback;
  const n = Number(x);
  return isNaN(n) ? fallback : n;
}

function safePct(numer, denom) {
  if (!denom || denom <= 0) return 0;
  return numer / denom;
}

function formatPct01(p01) {
  const clamped = Math.min(1, Math.max(0, p01 || 0));
  return (clamped * 100).toFixed(1) + "%";
}

function toYmd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, days) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatYmdToShort(ymd) {
  const s = String(ymd || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function humanizeTipo(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  if (t === "mejora") return "Mejora";
  if (t === "terreno") return "Terreno";
  if (t === "legacy") return "Legacy";
  if (t === "sin_iniciar") return "Sin iniciar";
  return t || "Sin iniciar";
}

export default function GVCatastroDashboard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMapVisible, setIsMapVisible] = useState(true);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const initialFilters = {
    q: "",
    tipo: "",
    faseMin: "",
    faseMax: "",
    tramo: "",
    subtramo: "",
    hasPolygon: "",
    hasDocs: "",
    hasCI: "",
    hasDBI: "",
    fechaInicio: "",
    fechaFin: ""
  };

  const [mapFilters, setMapFilters] = useState(initialFilters);
  const [mapStats, setMapStats] = useState(null);
  const [qInput, setQInput] = useState("");
  const qDebounceRef = useRef(null);
  const [tramosCensales, setTramosCensales] = useState([]);
  const [subtramosCensales, setSubtramosCensales] = useState([]);
  const [selectedHierarchyLevel, setSelectedHierarchyLevel] = useState("proyecto");
  const [selectedTramo, setSelectedTramo] = useState("");
  const [selectedSubtramo, setSelectedSubtramo] = useState("");

  const [modalShow, setModalShow] = useState(false);
  const [modalExpId, setModalExpId] = useState(null);
  const [modalSeedProps, setModalSeedProps] = useState(null);

  const today = new Date();
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [tempGranularidad, setTempGranularidad] = useState("semana");
  const [tempSelectedCategoria, setTempSelectedCategoria] = useState("");
  const [tempModoDetalle, setTempModoDetalle] = useState("fases");
  const [tempAvance, setTempAvance] = useState(null);
  const [tempDetalle, setTempDetalle] = useState(null);
  const [tempLoadingAvance, setTempLoadingAvance] = useState(false);
  const [tempLoadingDetalle, setTempLoadingDetalle] = useState(false);
  const [tempErrorAvance, setTempErrorAvance] = useState("");
  const [tempErrorDetalle, setTempErrorDetalle] = useState("");

  const [ecoData, setEcoData] = useState(null);
  const [ecoLoading, setEcoLoading] = useState(false);
  const [ecoError, setEcoError] = useState("");
  const [phaseTab, setPhaseTab] = useState("global"); // Fase 3: Tabs de composición
  const [isPanning, setIsPanning] = useState(false);
  const [mapType, setMapType] = useState('roadmap'); // Roadmap or Satellite
  const [activeWidgets, setActiveWidgets] = useState({
    cobertura: true,
    temporal: true,
    operativa: true,
    economico: true
  });
  const closeButtonColor = mapType === 'satellite' ? '#FFFFFF' : '#0F172A';
  const closeButtonBackground = mapType === 'satellite' ? 'rgba(255,255,255,0.12)' : 'rgba(15, 23, 42, 0.05)';

  const toggleWidget = (w) => setActiveWidgets(prev => ({ ...prev, [w]: !prev[w] }));

  // FASE 2: Lógica de Persistencia y Drag & Drop
  const mapContainerRef = useRef(null);
  const [widgetPositions, setWidgetPositions] = useState(() => {
    const saved = localStorage.getItem('gv_dashboard_layout');
    try {
      return saved ? JSON.parse(saved) : {
        cobertura: { x: 0, y: 0 },
        temporal: { x: 0, y: 0 },
        operativa: { x: 0, y: 0 },
        economico: { x: 0, y: 0 }
      };
    } catch {
      return { cobertura: { x: 0, y: 0 }, temporal: { x: 0, y: 0 }, operativa: { x: 0, y: 0 }, economico: { x: 0, y: 0 } };
    }
  });

  const [widgetZIndexes, setWidgetZIndexes] = useState({
    cobertura: 21,
    temporal: 21,
    operativa: 21,
    economico: 21
  });

  const widgetVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { delay: i * 0.15, duration: 0.5, ease: "easeOut" }
    })
  };

  const GVEmptyState = ({ message = "Sin datos disponibles" }) => (
    <div className="gv-empty-state my-auto">
      <i className="bi bi-clipboard-x"></i>
      <p>{message}</p>
    </div>
  );

  const renderHeroKpiGrid = () => (
    <div className="row g-4 mb-4">
      <div className="col-md-3">
        <div className="card gv-card border-0 shadow-sm p-4 h-100">
          <h6 className="text-secondary fw-bold text-uppercase mb-3" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>Avance Físico</h6>
          <div className="display-5 fw-bold text-dark mb-1">
            {formatPct01(safePct(mapStats?.totalFeatures || data?.censados || 0, data?.target_total || 0))}
          </div>
          <div className="text-muted small fw-bold">
            {mapStats?.totalFeatures || data?.censados || 0} DE {data?.target_total || 0} RELEVADOS
          </div>
        </div>
      </div>
      <div className="col-md-5">
        <div className="card gv-card border-0 shadow-sm p-4 overflow-hidden" style={{ minHeight: '160px' }}>
          <h6 className="text-secondary fw-bold text-uppercase mb-3" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>Ritmo de Ejecución</h6>
          <div style={{ height: "100px" }}>
            {!tempAvance ? <GVEmptyState /> : <GVTemporalCharts avance={tempAvance} detalle={tempDetalle} selectedCategoria={tempSelectedCategoria} modoDetalle={tempModoDetalle} onSelectCategoria={setTempSelectedCategoria} compact />}
          </div>
        </div>
      </div>
      <div className="col-md-4">
        <div className="card gv-card border-0 shadow-sm p-4 h-100">
          <h6 className="text-secondary fw-bold text-uppercase mb-3" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>Consola Financiera</h6>
          <div className="row g-2">
            <div className="col-12">
              <div className="text-secondary small fw-bold" style={{ fontSize: '0.6rem' }}>TOTAL FINAL ESTIMADO</div>
              <div className="h4 fw-bold text-primary mb-0">${(ecoData?.total_final || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const bringToFront = (w) => {
    setWidgetZIndexes(prev => {
      const maxZ = Math.max(...Object.values(prev));
      return { ...prev, [w]: maxZ + 1 };
    });
  };

  const handleDragEnd = (widget, info) => {
    const updated = { 
      ...widgetPositions, 
      [widget]: { 
        x: widgetPositions[widget].x + info.offset.x, 
        y: widgetPositions[widget].y + info.offset.y 
      } 
    };
    setWidgetPositions(updated);
    localStorage.setItem('gv_dashboard_layout', JSON.stringify(updated));
  };

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setMapFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleResetFilters = () => {
    if (qDebounceRef.current) {
      clearTimeout(qDebounceRef.current);
      qDebounceRef.current = null;
    }
    setMapFilters(initialFilters);
    setQInput("");
    setSubtramosCensales([]);
    setSelectedHierarchyLevel("proyecto");
    setSelectedTramo("");
    setSelectedSubtramo("");
  };

  const applyPhaseFilter = (tipo, faseIndex) => {
    setMapFilters((prev) => ({
      ...prev,
      tipo,
      faseMin: String(faseIndex),
      faseMax: String(faseIndex),
    }));
  };

  const applyCompositionFilter = (tipo) => {
    setMapFilters({
      tipo,
      faseMin: "",
      faseMax: "",
      tramo: "",
      subtramo: "",
      hasPolygon: "",
      hasDocs: "",
      hasCI: "",
      hasDBI: ""
    });
  };

  const applyBarPhaseFilter = (tipo, faseIndex) => {
    setMapFilters({
      ...initialFilters,
      tipo,
      faseMin: String(faseIndex),
      faseMax: String(faseIndex)
    });
  };

  const loadSubtramosForTramoDesc = (desc) => {
    if (!desc) {
      setSubtramosCensales([]);
      return;
    }
    const sel = tramosCensales.find((t) => String(t.descripcion) === desc);
    const tramoId = sel?.id_proyecto_tramo;
    if (!tramoId) {
      setSubtramosCensales([]);
      return;
    }
    gvGetSubtramosCensales(id, tramoId)
      .then((resp) => setSubtramosCensales(Array.isArray(resp?.items) ? resp.items : []))
      .catch(() => setSubtramosCensales([]));
  };

  const handleSelectTramoCard = (desc) => {
    const isSame = selectedTramo === desc && selectedHierarchyLevel === "tramo";
    const nextDesc = isSame ? "" : desc;
    setSelectedHierarchyLevel(isSame ? "proyecto" : "tramo");
    setSelectedTramo(nextDesc);
    setSelectedSubtramo("");
    setMapFilters((prev) => ({
      ...prev,
      tramo: nextDesc,
      subtramo: ""
    }));
    setSubtramosCensales([]);
    if (nextDesc) {
      loadSubtramosForTramoDesc(nextDesc);
    }
  };

  const handleSelectSubtramo = (desc) => {
    setSelectedSubtramo(desc);
    setSelectedHierarchyLevel(desc ? "subtramo" : "tramo");
    setMapFilters((prev) => ({
      ...prev,
      subtramo: desc
    }));
  };

  const resetHierarchyToProject = () => {
    setSelectedHierarchyLevel("proyecto");
    setSelectedTramo("");
    setSelectedSubtramo("");
    setMapFilters((prev) => ({
      ...prev,
      tramo: "",
      subtramo: ""
    }));
    setSubtramosCensales([]);
  };

  useEffect(() => {
    async function fetchDashboard() {
      try {
        setLoading(true);
        const result = await gvGetDashboard(id, { fechaInicio, fechaFin });
        setData(result);
      } catch (err) {
        setError(err.message || "Error al cargar dashboard GV");
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchDashboard();
    }
  }, [id, fechaInicio, fechaFin]);

  useEffect(() => {
    if (!id) return;
    gvGetTramosCensales(id)
      .then((resp) => setTramosCensales(Array.isArray(resp?.items) ? resp.items : []))
      .catch(() => setTramosCensales([]));
  }, [id]);

  const selectedTramoId = (() => {
    if (!mapFilters.tramo) return null;
    const sel = tramosCensales.find((t) => String(t.descripcion) === mapFilters.tramo);
    return sel?.id_proyecto_tramo || null;
  })();

  const selectedSubtramoId = (() => {
    if (!mapFilters.subtramo) return null;
    const sel = subtramosCensales.find((t) => String(t.descripcion) === mapFilters.subtramo);
    return sel?.id_proyecto_subtramo || null;
  })();

  const selectedTipoFilter = mapFilters.tipo ? mapFilters.tipo : null;

  const mapFilterBadges = [];
  if (fechaInicio || fechaFin) {
    mapFilterBadges.push(
      `Rango: ${formatYmdToShort(fechaInicio) || "—"} - ${formatYmdToShort(fechaFin) || "—"}`
    );
  }
  if (mapFilters.tramo) mapFilterBadges.push(`Tramo: ${mapFilters.tramo}`);
  if (mapFilters.subtramo) mapFilterBadges.push(`Subtramo: ${mapFilters.subtramo}`);
  if (mapFilters.tipo) mapFilterBadges.push(`Tipo: ${humanizeTipo(mapFilters.tipo)}`);
  if (mapFilters.q) mapFilterBadges.push(`Busqueda: ${mapFilters.q}`);

  const temporalFilterBadges = [];
  if (fechaInicio || fechaFin) {
    temporalFilterBadges.push(
      `Rango ${formatYmdToShort(fechaInicio) || "—"} - ${formatYmdToShort(fechaFin) || "—"}`
    );
  }
  if (mapFilters.tramo) temporalFilterBadges.push(`Tramo ${mapFilters.tramo}`);
  if (mapFilters.subtramo) temporalFilterBadges.push(`Subtramo ${mapFilters.subtramo}`);
  if (mapFilters.tipo) temporalFilterBadges.push(`Tipo ${humanizeTipo(mapFilters.tipo)}`);

  const temporalSecondaryBadges = [];
  if (mapFilters.q) temporalSecondaryBadges.push(`Busqueda "${mapFilters.q}"`);

  const economicoContext = [];
  if (fechaInicio || fechaFin) {
    economicoContext.push(
      `Rango ${formatYmdToShort(fechaInicio) || "—"} - ${formatYmdToShort(fechaFin) || "—"}`
    );
  }
  if (mapFilters.tramo) economicoContext.push(`Tramo ${mapFilters.tramo}`);
  if (mapFilters.subtramo) economicoContext.push(`Subtramo ${mapFilters.subtramo}`);
  if (mapFilters.tipo) economicoContext.push(`Tipo ${humanizeTipo(mapFilters.tipo)}`);

  const economicoContextLabel = economicoContext.length ? economicoContext.join(" • ") : "Visión Global";

  const economicoParamsKey = JSON.stringify({
    proyectoId: id,
    tramoId: selectedTramoId,
    subtramoId: selectedSubtramoId,
    tipo: selectedTipoFilter,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setEcoLoading(true);
    setEcoError("");
    gvGetEconomico({
      proyectoId: id,
      fechaInicio,
      fechaFin,
      tramoId: selectedTramoId || undefined,
      subtramoId: selectedSubtramoId || undefined,
      tipo: selectedTipoFilter || undefined,
    })
      .then((resp) => {
        if (cancelled) return;
        setEcoData(resp || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setEcoError(String(e?.message || e));
        setEcoData(null);
      })
      .finally(() => {
        if (!cancelled) setEcoLoading(false);
      });
    return () => { cancelled = true; };
  }, [economicoParamsKey, id]);

  const temporalParamsKey = JSON.stringify({
    proyectoId: id,
    fechaInicio: fechaInicio,
    fechaFin: fechaFin,
    granularidad: tempGranularidad,
    tramoId: selectedTramoId,
    subtramoId: selectedSubtramoId,
  });

  useEffect(() => {
    if (!id || !fechaInicio || !fechaFin || !tempGranularidad) return;
    let cancelled = false;
    setTempLoadingAvance(true);
    setTempErrorAvance("");
    gvGetAvanceTemporal({
      proyectoId: id,
      fechaInicio: fechaInicio,
      fechaFin: fechaFin,
      granularidad: tempGranularidad,
      tramoId: selectedTramoId || undefined,
      subtramoId: selectedSubtramoId || undefined,
    })
      .then((resp) => {
        if (cancelled) return;
        setTempAvance(resp || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setTempErrorAvance(String(e?.message || e));
        setTempAvance(null);
      })
      .finally(() => {
        if (!cancelled) setTempLoadingAvance(false);
      });
    return () => { cancelled = true; };
  }, [id, temporalParamsKey]);

  useEffect(() => {
    const buckets = Array.isArray(tempAvance?.buckets) ? tempAvance.buckets : [];
    const totalMejora = buckets.reduce((acc, b) => acc + (Number(b.mejora) || 0), 0);
    const totalTerreno = buckets.reduce((acc, b) => acc + (Number(b.terreno) || 0), 0);
    if (!tempSelectedCategoria) {
      if (totalMejora > 0) setTempSelectedCategoria("mejora");
      else if (totalTerreno > 0) setTempSelectedCategoria("terreno");
    }
  }, [tempAvance, tempSelectedCategoria]);

  const detalleParamsKey = JSON.stringify({
    proyectoId: id,
    fechaInicio: fechaInicio,
    fechaFin: fechaFin,
    granularidad: tempGranularidad,
    categoria: tempSelectedCategoria,
    modo: tempModoDetalle,
    tramoId: selectedTramoId,
    subtramoId: selectedSubtramoId,
  });

  useEffect(() => {
    if (!id || !tempSelectedCategoria) {
      setTempDetalle(null);
      return;
    }
    let cancelled = false;
    setTempLoadingDetalle(true);
    setTempErrorDetalle("");
    gvGetDetalleTemporal({
      proyectoId: id,
      fechaInicio: fechaInicio,
      fechaFin: fechaFin,
      granularidad: tempGranularidad,
      categoria: tempSelectedCategoria,
      modo: tempModoDetalle,
      tramoId: selectedTramoId || undefined,
      subtramoId: selectedSubtramoId || undefined,
    })
      .then((resp) => {
        if (cancelled) return;
        setTempDetalle(resp || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setTempErrorDetalle(String(e?.message || e));
        setTempDetalle(null);
      })
      .finally(() => {
        if (!cancelled) setTempLoadingDetalle(false);
      });
    return () => { cancelled = true; };
  }, [id, detalleParamsKey]);

  useEffect(() => {
    setMapFilters((prev) => ({
      ...prev,
      fechaInicio,
      fechaFin,
    }));
  }, [fechaInicio, fechaFin]);

  useEffect(() => {
    if (qDebounceRef.current) {
      clearTimeout(qDebounceRef.current);
    }
    qDebounceRef.current = setTimeout(() => {
      setMapFilters((prev) => ({ ...prev, q: qInput }));
    }, 400);
    return () => {
      if (qDebounceRef.current) {
        clearTimeout(qDebounceRef.current);
        qDebounceRef.current = null;
      }
    };
  }, [qInput]);
  const handleSelectExpediente = (expId, props) => {
    setModalExpId(expId);
    setModalSeedProps(props);
    setModalShow(true);
  };

  if (loading) return <div className="p-4">Cargando métricas GV...</div>;
  if (error) return <div className="p-4 text-danger">Error: {error}</div>;
  if (!data) return null;

  const expedientes = Array.isArray(data?.expedientes) ? data.expedientes : [];
  const expByTramo = expedientes.reduce((acc, exp) => {
    const key = String(exp?.tramo || "").trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const expBySubtramo = expedientes.reduce((acc, exp) => {
    if (selectedTramo && String(exp?.tramo || "").trim() !== selectedTramo) return acc;
    const key = String(exp?.subtramo || "").trim();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const tramoCards = tramosCensales.map((t) => {
    const desc = String(t.descripcion || "").trim();
    const universo = safeNumber(t.cantidad_universo, 0);
    const censados = safeNumber(expByTramo[desc], 0);
    const pct = universo > 0 ? (censados / universo) * 100 : 0;
    return {
      id: t.id_proyecto_tramo,
      descripcion: desc || `Tramo ${t.id_proyecto_tramo}`,
      universo,
      censados,
      pct
    };
  });
  const subtramoCards = subtramosCensales.map((t) => {
    const desc = String(t.descripcion || "").trim();
    const universo = safeNumber(t.cantidad_universo, 0);
    const censados = safeNumber(expBySubtramo[desc], 0);
    const pct = universo > 0 ? (censados / universo) * 100 : 0;
    return {
      id: t.id_proyecto_subtramo,
      descripcion: desc || `Subtramo ${t.id_proyecto_subtramo}`,
      universo,
      censados,
      pct
    };
  });
  return (
    <div className="container-fluid gv-page px-4 py-3">
      {/* FASE 1: CABECERA & FILTRO MAESTRO */}
      <div className="gv-toolbar sticky-top shadow-sm border-0 mb-4 px-4 py-3 d-flex align-items-center justify-content-between" style={{ zIndex: 1020, top: '10px' }}>
        <div>
          <h2 className="fw-bold mb-0 text-dark" style={{ letterSpacing: "-0.03em" }}>Gestión de Notificaciones Catastrales</h2>
          <div className="text-secondary small fw-medium mt-1">Proyecto ID: {id} • {data?.proponente_nombre || 'Dashboard Elite v2.1'}</div>
        </div>
        
        <div className="d-flex align-items-center gap-3">
          <button 
            className={`btn btn-sm rounded-pill px-3 fw-bold ${isMapVisible ? 'btn-primary' : 'btn-light'}`} 
            onClick={() => setIsMapVisible((current) => !current)}
            style={{ border: '1px solid #e2e8f0' }}
          >
            <i className={`bi ${isMapVisible ? 'bi-arrows-collapse' : 'bi-arrows-expand'} me-1`}></i>
            {isMapVisible ? 'Colapsar Mapa' : 'Expandir Mapa'}
          </button>

          <Button 
            variant="outline-primary" 
            size="sm" 
            className="rounded-pill px-3 fw-bold border-2" 
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            aria-controls="filters-collapse"
            aria-expanded={filtersExpanded}
          >
            <i className={`bi ${filtersExpanded ? 'bi-chevron-up' : 'bi-gear-fill'} me-1`}></i> 
            Ajustar Filtros
          </Button>
          <button className="btn btn-outline-secondary btn-sm rounded-pill px-3 fw-bold" onClick={handleResetFilters}>
            <i className="bi bi-arrow-counterclockwise me-1"></i> Limpiar
          </button>
        </div>
      </div>

      {/* Panel de Filtros Colapsable (The Brain) */}
      <Collapse in={filtersExpanded}>
        <div id="filters-collapse">
          <div className="card gv-card border-0 shadow-sm bg-light mb-4">
              <div className="card-body py-4 px-4">
                  <div className="row g-3">
                     <div className="col-md-5">
                        <label className="form-label small fw-bold text-secondary">Búsqueda amplia</label>
                        <div className="position-relative">
                           <span className="position-absolute top-50 start-0 translate-middle-y ps-3 text-muted"><i className="bi bi-search"></i></span>
                           <input 
                            type="text" 
                            className="form-control ps-5 shadow-none border-0 rounded-3" 
                            style={{ background: '#fff' }}
                            value={qInput} 
                            onChange={(e) => setQInput(e.target.value)} 
                            placeholder="Buscar por Titular, CI, Expediente, DBI o Código Censo..." 
                           />
                        </div>
                     </div>
                     <div className="col-sm-6 col-md-3">
                        <label className="form-label small fw-bold text-secondary">Fecha Inicio</label>
                        <input type="date" className="form-control border-0 rounded-3" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                     </div>
                     <div className="col-sm-6 col-md-3">
                        <label className="form-label small fw-bold text-secondary">Fecha Fin</label>
                        <input type="date" className="form-control border-0 rounded-3" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                     </div>
                     <div className="col-md-2 mt-3">
                        <label className="form-label small fw-bold text-secondary">Tipo Carpeta</label>
                        <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="tipo" value={mapFilters.tipo} onChange={handleFilterChange}>
                           <option value="">Todos</option>
                           <option value="mejora">Mejora</option>
                           <option value="terreno">Terreno</option>
                        </select>
                     </div>
                     <div className="col-md-2 mt-3">
                        <label className="form-label small fw-bold text-secondary">Fase Mínima</label>
                        <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="faseMin" value={mapFilters.faseMin} onChange={handleFilterChange}>
                          <option value="">Todos</option>
                          {[...Array(8).keys()].map(i => <option key={i} value={String(i)}>F{i}</option>)}
                        </select>
                     </div>
                     <div className="col-md-2 mt-3">
                        <label className="form-label small fw-bold text-secondary">Fase Máxima</label>
                        <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="faseMax" value={mapFilters.faseMax} onChange={handleFilterChange}>
                          <option value="">Todos</option>
                          {[...Array(8).keys()].map(i => <option key={i} value={String(i)}>F{i}</option>)}
                        </select>
                     </div>
                     <div className="col-md-3 mt-3">
                        <label className="form-label small fw-bold text-secondary">Tramo</label>
                        <select
                          className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }}
                          value={mapFilters.tramo}
                          onChange={(e) => {
                            const desc = e.target.value;
                            setMapFilters((prev) => ({ ...prev, tramo: desc, subtramo: "" }));
                            setSelectedTramo(desc);
                            setSelectedSubtramo("");
                            setSelectedHierarchyLevel(desc ? "tramo" : "proyecto");
                            setSubtramosCensales([]);
                            if (desc) loadSubtramosForTramoDesc(desc);
                          }}
                        >
                          <option value="">Todos</option>
                          {tramosCensales.map((t) => (
                            <option key={t.id_proyecto_tramo} value={t.descripcion}>{t.descripcion}</option>
                          ))}
                        </select>
                     </div>
                     <div className="col-md-3 mt-3">
                        <label className="form-label small fw-bold text-secondary">Subtramo</label>
                        <select
                          className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }}
                          value={mapFilters.subtramo}
                          onChange={(e) => {
                            const next = e.target.value;
                            setMapFilters((prev) => ({ ...prev, subtramo: next }));
                            setSelectedSubtramo(next);
                            setSelectedHierarchyLevel(next ? "subtramo" : (selectedTramo ? "tramo" : "proyecto"));
                          }}
                          disabled={!mapFilters.tramo}
                        >
                          <option value="">Todos</option>
                          {subtramosCensales.map((st) => (
                            <option key={st.id_proyecto_subtramo} value={st.descripcion}>
                              {st.descripcion}
                            </option>
                          ))}
                        </select>
                     </div>
                  </div>
                  
                  {/* Fila de Filtros Booleanos */}
                  <div className="row g-3 mt-1">
                    <div className="col-md-3">
                      <label className="form-label small fw-bold text-secondary">Geometría (Polígono)</label>
                      <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="hasPolygon" value={mapFilters.hasPolygon} onChange={handleFilterChange}>
                        <option value="">Todos</option>
                        <option value="true">Sí (Mapeado)</option>
                        <option value="false">No (Sin Mapeo)</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold text-secondary">Documentación Tumba</label>
                      <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="hasDocs" value={mapFilters.hasDocs} onChange={handleFilterChange}>
                        <option value="">Todos</option>
                        <option value="true">Con Documentos</option>
                        <option value="false">Sin Documentos</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold text-secondary">Cédula de Identidad (CI)</label>
                      <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="hasCI" value={mapFilters.hasCI} onChange={handleFilterChange}>
                        <option value="">Todos</option>
                        <option value="true">Validado</option>
                        <option value="false">Pendiente</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-bold text-secondary">Inscripción DBI</label>
                      <select className="form-select shadow-none border-0 rounded-3" style={{ background: '#fff' }} name="hasDBI" value={mapFilters.hasDBI} onChange={handleFilterChange}>
                        <option value="">Todos</option>
                        <option value="true">SÍ Aplica</option>
                        <option value="false">NO Aplica</option>
                      </select>
                    </div>
                  </div>
              </div>
          </div>
        </div>
      </Collapse>

      {!isMapVisible && (
        <>
          <GVEconomicPanel data={ecoData} loading={ecoLoading} error={ecoError} contextLabel={economicoContextLabel} />
          {renderHeroKpiGrid()}
        </>
      )}

      {/* NIVEL 1: VISOR TERRITORIAL & FLOATING UI (SITUATIONAL CONSOLE - ONLY VISIBLE IF isMapVisible is true) */}
      <div 
        ref={mapContainerRef}
        className={`card gv-card border-0 shadow-sm mb-4 overflow-hidden rounded-4 position-relative ${mapType === 'satellite' || mapType === 'hybrid' ? 'is-satellite-mode' : ''}`}
        style={{ height: isMapVisible ? '620px' : '0px', opacity: isMapVisible ? 1 : 0, transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)', marginBottom: isMapVisible ? '1.5rem' : '0' }}
      >
        {isMapVisible && (
          <>
            <div className="gv-map-container h-100">
               <GVMapaCatastroGoogle
                 proyectoId={id}
                 filters={mapFilters}
                 tramoId={selectedTramoId}
                 subtramoId={selectedSubtramoId}
                 onStatsChange={setMapStats}
                 onSelectExpediente={handleSelectExpediente}
                 onPanningChange={setIsPanning}
                 onMapTypeChange={setMapType}
               />
            </div>

            {/* FLOATING OVERLAY LAYER */}
            <div className="gv-map-overlay-wrapper">
               <AnimatePresence>
                 {/* 1. Cobertura (Top Left) */}
                 {activeWidgets.cobertura && (
                   <motion.div 
                     key="widget-cobertura"
                     drag dragListener={false} dragConstraints={mapContainerRef} dragMomentum={false} dragElastic={0}
                     variants={widgetVariants} initial="hidden" animate="visible" exit="hidden" custom={0}
                     onDragStart={() => bringToFront('cobertura')}
                     onDragEnd={(e, info) => handleDragEnd('cobertura', info)}
                     className={`gv-floating-card p-4 d-flex flex-column ${isPanning ? 'is-map-panning' : ''}`}
                     style={{ top: 20, left: 20, width: '320px', x: widgetPositions.cobertura.x, y: widgetPositions.cobertura.y, zIndex: widgetZIndexes.cobertura }}
                     onClick={(e) => { e.stopPropagation(); bringToFront('cobertura'); }}
                   >
                     <div className="gv-drag-handle d-flex align-items-center justify-content-between" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                       <h6 className="text-secondary fw-bold text-uppercase mb-0" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>
                         <i className="bi bi-grip-vertical me-1"></i> Avance Físico
                       </h6>
                       <button className="gv-card-close-btn position-static" onClick={() => toggleWidget('cobertura')} style={{ color: closeButtonColor, background: closeButtonBackground }}><i className="bi bi-x-lg" style={{ color: closeButtonColor }}></i></button>
                     </div>
                     {(() => {
                       const targetTotal = safeNumber(data?.target_total, 0);
                       const censados = mapStats ? safeNumber(mapStats.totalFeatures, 0) : safeNumber(data?.censados, 0);
                       if (targetTotal === 0 && !loading) return <GVEmptyState message="Sin meta definida" />;
                       const coveragePct = safePct(censados, targetTotal);
                       return (
                         <div className="text-center mt-3">
                           <div className="display-6 fw-bold text-dark mb-1">{formatPct01(coveragePct)}</div>
                           <div className="progress mb-2 bg-secondary bg-opacity-10" style={{ height: "6px" }}>
                             <div className="progress-bar rounded-pill bg-primary" role="progressbar" style={{ width: `${coveragePct * 100}%` }}></div>
                           </div>
                           <div className="d-flex justify-content-between text-secondary small fw-bold">
                             <span>{censados} RELEVADOS</span>
                             <span>META: {targetTotal}</span>
                           </div>
                         </div>
                       );
                     })()}
                   </motion.div>
                 )}

                 {/* 2. Temporal (Top Right) */}
                 {activeWidgets.temporal && (
                   <motion.div 
                     key="widget-temporal"
                     drag dragListener={false} dragConstraints={mapContainerRef} dragMomentum={false} dragElastic={0}
                     variants={widgetVariants} initial="hidden" animate="visible" exit="hidden" custom={1}
                     onDragStart={() => bringToFront('temporal')}
                     onDragEnd={(e, info) => handleDragEnd('temporal', info)}
                     className={`gv-floating-card p-4 d-flex flex-column ${isPanning ? 'is-map-panning' : ''}`}
                     style={{ top: 20, right: 20, width: '380px', x: widgetPositions.temporal.x, y: widgetPositions.temporal.y, zIndex: widgetZIndexes.temporal }}
                     onClick={(e) => { e.stopPropagation(); bringToFront('temporal'); }}
                   >
                     <div className="gv-drag-handle d-flex align-items-center justify-content-between mb-2" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <h6 className="text-secondary fw-bold text-uppercase mb-0" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>
                           <i className="bi bi-grip-vertical me-1"></i> Ritmo de Ejecución
                        </h6>
                        <div className="d-flex align-items-center gap-2">
                           <div className="dropdown">
                              <button className="btn btn-sm btn-light border-0 rounded-pill bg-dark bg-opacity-5 text-secondary fw-bold dropdown-toggle" type="button" data-bs-toggle="dropdown" style={{ fontSize: "0.65rem" }}>
                                <i className="bi bi-calendar-event me-1"></i> Rango
                              </button>
                              <div className="dropdown-menu dropdown-menu-end p-3 shadow-lg border-0 rounded-4" style={{ minWidth: "260px", zIndex: 1050 }}>
                                 <div className="mb-2">
                                    <label className="form-label small text-secondary fw-medium mb-1">Inicio</label>
                                    <input type="date" className="form-control form-control-sm border-light" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
                                 </div>
                                 <div className="mb-3">
                                    <label className="form-label small text-secondary fw-medium mb-1">Fin</label>
                                    <input type="date" className="form-control form-control-sm border-light" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
                                 </div>
                                 <div className="row g-2">
                                   <div className="col-6">
                                     <label className="form-label small text-secondary fw-medium mb-1">Agrupar</label>
                                     <select className="form-select form-select-sm border-light" value={tempGranularidad} onChange={(e) => setTempGranularidad(e.target.value)}>
                                       <option value="dia">Dia</option>
                                       <option value="semana">Semana</option>
                                       <option value="mes">Mes</option>
                                     </select>
                                   </div>
                                 </div>
                              </div>
                           </div>
                           <button className="gv-card-close-btn position-static" onClick={() => toggleWidget('temporal')} style={{ color: closeButtonColor, background: closeButtonBackground }}><i className="bi bi-x-lg" style={{ color: closeButtonColor }}></i></button>
                        </div>
                     </div>
                     <div style={{ height: "180px" }}>
                        {(!tempAvance || tempAvance.buckets?.length === 0) && !tempLoadingAvance ? (
                           <GVEmptyState message="Sin actividad en este rango" />
                        ) : (
                           <GVTemporalCharts
                             avance={tempAvance || []}
                             detalle={tempDetalle || []}
                             selectedCategoria={tempSelectedCategoria}
                             modoDetalle={tempModoDetalle}
                             onSelectCategoria={setTempSelectedCategoria}
                             loadingAvance={tempLoadingAvance}
                             errorAvance={tempErrorAvance}
                             compact
                           />
                        )}
                     </div>
                   </motion.div>
                 )}

                 {/* 3. Operativa (Middle Right) */}
                 {activeWidgets.operativa && (
                   <motion.div 
                     key="widget-operativa"
                     drag dragListener={false} dragConstraints={mapContainerRef} dragMomentum={false} dragElastic={0}
                     variants={widgetVariants} initial="hidden" animate="visible" exit="hidden" custom={2}
                     onDragStart={() => bringToFront('operativa')}
                     onDragEnd={(e, info) => handleDragEnd('operativa', info)}
                     className={`gv-floating-card p-4 d-flex flex-column ${isPanning ? 'is-map-panning' : ''}`}
                     style={{ top: 250, right: 20, width: '320px', maxHeight: '320px', x: widgetPositions.operativa.x, y: widgetPositions.operativa.y, zIndex: widgetZIndexes.operativa }}
                     onClick={(e) => { e.stopPropagation(); bringToFront('operativa'); }}
                   >
                     <div className="gv-drag-handle d-flex align-items-center justify-content-between mb-2" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <h6 className="text-secondary fw-bold text-uppercase mb-0" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>
                           <i className="bi bi-grip-vertical me-1"></i> {selectedTramo ? "Subtramos" : "Tramos"}
                        </h6>
                        <div className="d-flex align-items-center gap-2">
                           {selectedHierarchyLevel !== "proyecto" && (
                              <button className="btn btn-sm btn-link text-decoration-none p-0 text-primary small fw-bold" onClick={() => resetHierarchyToProject()}>
                                Volver
                              </button>
                           )}
                           <button className="gv-card-close-btn position-static" onClick={() => toggleWidget('operativa')} style={{ color: closeButtonColor, background: closeButtonBackground }}><i className="bi bi-x-lg" style={{ color: closeButtonColor }}></i></button>
                        </div>
                     </div>
                     <div className="overflow-y-auto gv-scrollbar pe-1" style={{ flexGrow: 1, gap: "6px" }}>
                        {(selectedTramo ? subtramoCards : tramoCards).length === 0 ? (
                           <GVEmptyState message="Sin tramos registrados" />
                        ) : (
                           (selectedTramo ? subtramoCards : tramoCards).map(t => (
                              <div 
                                 key={t.id} 
                                 className="card-internal px-3 py-2 mb-2 rounded-3 border border-secondary border-opacity-10 bg-white hover-shadow-sm transition-all text-dark"
                                 onClick={() => selectedTramo ? handleSelectSubtramo(t.descripcion) : handleSelectTramoCard(t.descripcion)}
                                 style={{ cursor: 'pointer' }}
                              >
                                 <div className="d-flex justify-content-between align-items-center small">
                                    <span className="text-truncate pe-1 fw-bold">{t.descripcion}</span>
                                    <span className="badge bg-primary bg-opacity-10 text-primary rounded-pill">{t.pct.toFixed(0)}%</span>
                                 </div>
                                 <div className="progress mt-2 mb-1" style={{ height: '4px' }}>
                                    <div className="progress-bar rounded-pill" style={{ width: `${t.pct}%` }}></div>
                                 </div>
                              </div>
                           ))
                        )}
                     </div>
                   </motion.div>
                 )}

                 {/* 4. Económico (Bottom Left - The Financial Console) */}
                 {activeWidgets.economico && (
                   <motion.div 
                     key="widget-economico"
                     drag dragListener={false} dragConstraints={mapContainerRef} dragMomentum={false} dragElastic={0}
                     variants={widgetVariants} initial="hidden" animate="visible" exit="hidden" custom={3}
                     onDragStart={() => bringToFront('economico')}
                     onDragEnd={(e, info) => handleDragEnd('economico', info)}
                     className={`gv-floating-card p-4 ${isPanning ? 'is-map-panning' : ''}`}
                     style={{ bottom: 20, left: 20, width: '480px', x: widgetPositions.economico.x, y: widgetPositions.economico.y, zIndex: widgetZIndexes.economico }}
                     onClick={(e) => { e.stopPropagation(); bringToFront('economico'); }}
                   >
                     <div className="gv-drag-handle d-flex align-items-center justify-content-between mb-3" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <h6 className="text-secondary fw-bold text-uppercase mb-0" style={{ fontSize: "0.65rem", letterSpacing: "0.1em" }}>
                           <i className="bi bi-grip-vertical me-1"></i> Consola Financiera {selectedTramo ? `/ ${selectedTramo}` : ""}
                        </h6>
                        <button className="gv-card-close-btn position-static" onClick={() => toggleWidget('economico')} style={{ color: closeButtonColor, background: closeButtonBackground }}><i className="bi bi-x-lg" style={{ color: closeButtonColor }}></i></button>
                     </div>

                     {ecoLoading ? <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary"></div></div> : (
                        <div className="row g-3">
                           {/* Lado Izquierdo: Inversión */}
                           <div className="col-6 border-end">
                              <div className="mb-3">
                                 <div className="text-secondary small fw-bold mb-1" style={{ fontSize: '0.6rem' }}>TOTAL PARTE A (MEJORAS)</div>
                                 <div className="h5 fw-bold text-dark mb-0">${(ecoData?.total_parte_a || 0).toLocaleString()}</div>
                              </div>
                              <div className="mb-3">
                                 <div className="text-secondary small fw-bold mb-1" style={{ fontSize: '0.6rem' }}>TOTAL PARTE B (EDILICIA)</div>
                                 <div className="h5 fw-bold text-dark mb-0">${(ecoData?.total_parte_b || 0).toLocaleString()}</div>
                              </div>
                              <div className="p-2 rounded-3 bg-primary bg-opacity-10 border border-primary border-opacity-20">
                                 <div className="text-primary small fw-bold mb-0" style={{ fontSize: '0.6rem' }}>TOTAL FINAL ESTIMADO</div>
                                 <div className="h4 fw-bold text-primary mb-0">${(ecoData?.total_final || 0).toLocaleString()}</div>
                              </div>
                           </div>
                           {/* Lado Derecho: Eficiencia */}
                           <div className="col-6 ps-3">
                              <div className="mb-3">
                                 <div className="text-secondary small fw-bold mb-1" style={{ fontSize: '0.6rem' }}>PROM. BASE / EXPEDIENTE</div>
                                 <div className="fw-bold text-dark mb-0">${(ecoData?.avg_base || 0).toLocaleString()}</div>
                              </div>
                              <div className="mb-3">
                                 <div className="text-secondary small fw-bold mb-1" style={{ fontSize: '0.6rem' }}>PROM. FINAL / EXPEDIENTE</div>
                                 <div className="fw-bold text-dark mb-0">${(ecoData?.avg_final || 0).toLocaleString()}</div>
                              </div>
                              <div>
                                 <div className="text-secondary small fw-bold mb-1" style={{ fontSize: '0.6rem' }}>COSTO X UNIDAD CENSAL</div>
                                 <div className="fw-bold text-dark mb-0">${(ecoData?.cost_per_unit || 0).toLocaleString()}</div>
                              </div>
                           </div>
                        </div>
                     )}
                   </motion.div>
                 )}
               </AnimatePresence>

               {/* DOCK FOR MINIMIZED WIDGETS */}
               <div className="gv-widget-dock">
                  {!activeWidgets.cobertura && <div className="gv-dock-pill" onClick={() => toggleWidget('cobertura')}><i className="bi bi-circle-fill text-primary me-2" style={{ fontSize: '6px' }}></i> Cobertura</div>}
                  {!activeWidgets.temporal && <div className="gv-dock-pill" onClick={() => toggleWidget('temporal')}><i className="bi bi-circle-fill text-success me-2" style={{ fontSize: '6px' }}></i> Ejecución</div>}
                  {!activeWidgets.operativa && <div className="gv-dock-pill" onClick={() => toggleWidget('operativa')}><i className="bi bi-circle-fill text-warning me-2" style={{ fontSize: '6px' }}></i> Operativa</div>}
                  {!activeWidgets.economico && <div className="gv-dock-pill" onClick={() => toggleWidget('economico')}><i className="bi bi-circle-fill text-danger me-2" style={{ fontSize: '6px' }}></i> Económico</div>}
               </div>
            </div>

            {/* Footer Información contextual (Territorio) */}
            <div className="position-absolute bottom-0 start-0 w-100 p-2 bg-white bg-opacity-90 border-top text-center" style={{ fontSize: '10px', pointerEvents: 'none', zIndex: 5 }}>
               <span className="text-secondary fw-bold px-3">
                  <i className="bi bi-pin-map-fill me-1"></i> {mapStats?.totalFeatures || 0} Expedientes en el visor actual
               </span>
               <span className="text-secondary fw-bold px-3 border-start">
                  <i className="bi bi-layers-fill me-1"></i> Modo: {mapType.toUpperCase()}
               </span>
            </div>
          </>
        )}
      </div>

      {/* NIVEL 2: COMPOSICIÓN TÉCNICA (Análisis de Fases) */}
      <div className="card shadow-sm border-0 rounded-4 overflow-hidden mb-4 bg-white">
        <div className="card-header bg-white border-0 py-4 px-4 d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-1 fw-bold text-dark">Detalle de Composición Operativa</h5>
            <p className="text-muted small mb-0">Seguimiento de fases {selectedTramo ? `en ${selectedTramo}` : "globales"}</p>
          </div>
          <div className="d-flex bg-light p-1 rounded-pill">
            <button className={`btn btn-sm rounded-pill px-4 transition-all ${phaseTab === 'global' ? 'bg-white shadow-sm text-primary fw-bold' : 'text-secondary border-0'}`} onClick={() => setPhaseTab("global")}>Global</button>
            <button className={`btn btn-sm rounded-pill px-4 transition-all ${phaseTab === 'mejora' ? 'bg-white shadow-sm text-primary fw-bold' : 'text-secondary border-0'}`} onClick={() => setPhaseTab("mejora")}>Mejoras</button>
            <button className={`btn btn-sm rounded-pill px-4 transition-all ${phaseTab === 'terreno' ? 'bg-white shadow-sm text-primary fw-bold' : 'text-secondary border-0'}`} onClick={() => setPhaseTab("terreno")}>Terrenos</button>
          </div>
        </div>
        
        <div className="card-body px-4 pb-4">
          <div className="row g-4">
            <div className="col-md-7">
              <GVCharts
                dashboard={data}
                onCompositionSelect={applyCompositionFilter}
                onMejoraPhaseSelect={(idx) => applyBarPhaseFilter("mejora", idx)}
                onTerrenoPhaseSelect={(idx) => applyBarPhaseFilter("terreno", idx)}
              />
            </div>
            <div className="col-md-5">
              <div className="d-flex flex-column h-100">
                <div className="flex-grow-1">
                  {(() => {
                    const sinIniciarCount = Number(data?.phases?.sin_iniciar?.counts?.[0]) || 0;
                    const showSinIniciar = sinIniciarCount > 0;
                    
                    const renderPhaseTable = (tipo, maxFases, title) => {
                      const counts = normalizePhaseCounts(data, tipo, maxFases);
                      const totalTipo = data?.by_tipo?.[tipo] || 0;
                      
                      return (
                        <div className="table-responsive">
                          <table className="table table-sm table-hover table-borderless align-middle gv-table mb-0">
                            <thead className="table-light text-muted small">
                              <tr>
                                <th>Etapa {title}</th>
                                <th className="text-end">Cant.</th>
                                <th className="text-end">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {counts.map((count, i) => {
                                const isActive = mapFilters.tipo === tipo && mapFilters.faseMin === String(i) && mapFilters.faseMax === String(i);
                                return (
                                  <tr
                                    key={`${tipo}-${i}`}
                                    className={`gv-phase-filter-row ${isActive ? "gv-phase-filter-row--active" : ""}`}
                                    onClick={() => applyPhaseFilter(tipo, i)}
                                    style={{ cursor: "pointer" }}
                                  >
                                    <td>
                                      <div className="d-flex align-items-center gap-2">
                                        <div className="gv-dot" style={{ background: getPhaseHex(i, maxFases) }}></div>
                                        <span className={isActive ? "fw-bold" : ""}>{i === maxFases ? 'FINAL' : `Fase ${i}`}</span>
                                      </div>
                                    </td>
                                    <td className="text-end fw-bold">{count}</td>
                                    <td className="text-end text-muted small">
                                      {totalTipo > 0 ? ((count / totalTipo) * 100).toFixed(1) : "0.0"}%
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    };

                    if (phaseTab === 'global') {
                      return (
                        <div className="d-flex flex-column gap-3">
                           <div className="p-3 bg-light rounded-3">
                               <h6 className="small fw-bold text-secondary mb-2">Resumen de Composición</h6>
                               <div className="d-flex justify-content-between mb-1 small">
                                  <span>Catastro Mejora:</span>
                                  <span className="fw-bold">{data?.by_tipo?.mejora || 0}</span>
                                </div>
                                <div className="d-flex justify-content-between small">
                                  <span>Catastro Terreno:</span>
                                  <span className="fw-bold">{data?.by_tipo?.terreno || 0}</span>
                                </div>
                           </div>
                           {showSinIniciar && (
                              <div className="gv-alert-soft">
                                <p className="mb-0 small">Hay <strong>{sinIniciarCount}</strong> registros sin tipo definido.</p>
                              </div>
                           )}
                           <div className="text-muted small mt-auto">Seleccione una categoría para filtrar el visor.</div>
                        </div>
                      );
                    }
                    if (phaseTab === 'mejora') return renderPhaseTable('mejora', 5, 'Mejora');
                    if (phaseTab === 'terreno') return renderPhaseTable('terreno', 7, 'Terreno');
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <GvExpedienteModal
        show={modalShow}
        onHide={() => setModalShow(false)}
        proyectoId={id}
        expedienteId={modalExpId}
        seedProps={modalSeedProps}
      />
    </div>
  );
}

