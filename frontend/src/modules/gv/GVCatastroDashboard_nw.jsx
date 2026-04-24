import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { gvGetDashboard, gvGetTramosCensales, gvGetSubtramosCensales, gvGetAvanceTemporal, gvGetDetalleTemporal, gvGetEconomico } from "./gv_service";
import GVCharts from "./GVCharts";
import GVMapaCatastroGoogle from "./GVMapaCatastroGoogle";
import GVTemporalCharts from "./GVTemporalCharts";
import GVEconomicPanel from "./GVEconomicPanel";
import GvExpedienteModal from "./GvExpedienteModal";
import GvPhaseChip from "./GvPhaseChip";
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

  // States para el nuevo Modal Aislado
  const [modalShow, setModalShow] = useState(false);
  const [modalExpId, setModalExpId] = useState(null);
  const [modalSeedProps, setModalSeedProps] = useState(null);
  
  // Dashboard UI state
  const [isMapVisible, setIsMapVisible] = useState(true);

  // Temporal analytics state (local)
  const today = new Date();
  const [fechaInicio, setFechaInicio] = useState(toYmd(addDays(today, -30)));
  const [fechaFin, setFechaFin] = useState(toYmd(today));
  const [tempGranularidad, setTempGranularidad] = useState("semana");
  const [tempSelectedCategoria, setTempSelectedCategoria] = useState("");
  const [tempModoDetalle, setTempModoDetalle] = useState("fases");
  const [tempAvance, setTempAvance] = useState(null);
  const [tempDetalle, setTempDetalle] = useState(null);
  const [tempLoadingAvance, setTempLoadingAvance] = useState(false);
  const [tempLoadingDetalle, setTempLoadingDetalle] = useState(false);
  const [tempErrorAvance, setTempErrorAvance] = useState("");
  const [tempErrorDetalle, setTempErrorDetalle] = useState("");

  // Economic panel state
  const [ecoData, setEcoData] = useState(null);
  const [ecoLoading, setEcoLoading] = useState(false);
  const [ecoError, setEcoError] = useState("");

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

  const anyMapFiltersActive = Object.keys(initialFilters).some((k) => String(mapFilters[k] || "") !== "");

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
  const isProjectLevel = !selectedTramo || selectedHierarchyLevel === "proyecto";
  const hierarchyBar = (() => {
    if (isProjectLevel) {
      const labels = tramoCards.map((t) => t.descripcion);
      return {
        level: "proyecto",
        title: "Tramos",
        labels,
        censados: tramoCards.map((t) => t.censados),
        universo: tramoCards.map((t) => t.universo),
        pct: tramoCards.map((t) => t.pct),
        selectedIndex: selectedTramo ? labels.indexOf(selectedTramo) : null,
        onBarClick: (idx) => {
          const desc = labels[idx];
          if (desc) handleSelectTramoCard(desc);
        }
      };
    }

    const labels = subtramoCards.map((t) => t.descripcion);
    return {
      level: selectedSubtramo ? "subtramo" : "tramo",
      title: selectedTramo ? `Subtramos de ${selectedTramo}` : "Subtramos",
      labels,
      censados: subtramoCards.map((t) => t.censados),
      universo: subtramoCards.map((t) => t.universo),
      pct: subtramoCards.map((t) => t.pct),
      selectedIndex: selectedSubtramo ? labels.indexOf(selectedSubtramo) : null,
      onBarClick: (idx) => {
        const desc = labels[idx];
        if (desc) handleSelectSubtramo(desc);
      }
    };
  })();

  return (
    <div className="container-fluid gv-page px-4 py-3">
      {/* NIVEL 0: CONTROL MAESTRO (Sticky Toolbar) */}
      <div className="gv-toolbar sticky-top shadow-sm border-0 mb-4 px-4 py-3 d-flex align-items-center justify-content-between" style={{ zIndex: 1020, top: '10px' }}>
        <div>
          <h2 className="fw-bold mb-0 text-dark" style={{ letterSpacing: "-0.03em" }}>Panel de Control de Notificaciones</h2>
          <div className="text-secondary small fw-medium mt-1">Proyecto ID: {id} • {data?.proponente_nombre || 'Visualización Territorial'}</div>
        </div>
        
        <div className="d-flex align-items-center gap-3">
          <div className="d-flex gap-2">
            <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-calendar-event"></i></span>
                <input type="date" className="form-control border-start-0 ps-0" style={{ width: 130 }} value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            </div>
            <div className="input-group input-group-sm">
                <span className="input-group-text bg-white border-end-0"><i className="bi bi-calendar-check"></i></span>
                <input type="date" className="form-control border-start-0 ps-0" style={{ width: 130 }} value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-outline-secondary btn-sm rounded-pill px-3 fw-bold" onClick={handleResetFilters}>
            <i className="bi bi-arrow-counterclockwise me-1"></i> Limpiar
          </button>
        </div>
      </div>

      {/* NIVEL 1: CONTEXTO SITUACIONAL (Mapa Colapsable) */}
      <div className="card gv-card border-0 shadow-sm mb-4 overflow-hidden">
        <div className="card-header bg-white border-0 py-3 d-flex align-items-center justify-content-between">
          <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
            <i className="bi bi-geo-alt-fill text-primary"></i> Visor Territorial de Notificaciones
          </h5>
          <div className="d-flex gap-2">
             <button className="btn btn-light btn-sm rounded-pill px-3 fw-medium text-secondary" onClick={() => setIsMapVisible(!isMapVisible)}>
              {isMapVisible ? (
                  <><i className="bi bi-eye-slash-fill me-1"></i> Minimizar Mapa</>
              ) : (
                  <><i className="bi bi-eye-fill me-1"></i> Expandir Mapa</>
              )}
            </button>
          </div>
        </div>
        <div className={`gv-map-container ${!isMapVisible ? 'gv-map-container--collapsed' : ''}`}>
           <GVMapaCatastroGoogle
            proyectoId={id}
            filters={mapFilters}
            tramoId={selectedTramoId}
            subtramoId={selectedSubtramoId}
            onStatsChange={setMapStats}
            onSelectExpediente={handleSelectExpediente}
          />
        </div>
        {isMapVisible && (
          <div className="card-footer bg-white border-top-0 py-2 px-4 shadow-none">
             <div className="d-flex align-items-center justify-content-between">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span className="text-secondary small fw-medium">Filtros activos:</span>
                  {mapFilterBadges.length > 0 ? (
                    mapFilterBadges.map((label) => (
                      <span key={label} className="badge bg-primary bg-opacity-10 text-primary border-0 rounded-pill px-3 py-1">
                        {label}
                      </span>
                    ))
                  ) : <span className="text-muted small">Sin filtros en territorio</span>}
                </div>
                <div className="text-primary small fw-bold">
                   {mapStats ? `${mapStats.totalFeatures} Notificaciones encontradas` : 'Contando...'}
                </div>
             </div>
          </div>
        )}
      </div>

      {/* NIVEL 2: SALUD DEL PROYECTO (KPIs de Gestión) */}
      <div className="gv-section-title mt-2">
        <i className="bi bi-activity text-success"></i> Estado de Avance y Gestión
      </div>
      {(() => {
        const targetTotal = safeNumber(data?.target_total, 0);
        const censados = safeNumber(data?.censados, 0);
        const hasDenom = targetTotal > 0;
        const coveragePct = hasDenom ? (censados / targetTotal) : 0;

        return (
          <div className="row g-4 mb-5">
            <div className="col-md-3">
              <div className="card gv-card h-100 p-4 shadow-sm border-0">
                <div className="gv-muted text-uppercase mb-2">Total Notificaciones</div>
                <div className="gv-kpi">{hasDenom ? targetTotal : '—'}</div>
                <div className="text-secondary small mt-1">Universo meta definido</div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card gv-card h-100 p-4 shadow-sm border-0" style={{ borderLeft: '4px solid #10B981 !important' }}>
                <div className="gv-muted text-uppercase mb-2">Balance de Notificación</div>
                <div className="d-flex align-items-baseline gap-2">
                  <div className="gv-kpi text-success text-opacity-75">{censados}</div>
                  <div className="text-muted small">relevadas</div>
                </div>
                <div className="progress mt-3" style={{ height: '8px' }}>
                  <div className="progress-bar bg-success" style={{ width: `${coveragePct * 100}%` }}></div>
                </div>
                <div className="text-end small mt-1 fw-bold text-success">{formatPct01(coveragePct)}</div>
              </div>
            </div>
             <div className="col-md-3">
              <div className="card gv-card h-100 p-4 shadow-sm border-0">
                <div className="gv-muted text-uppercase mb-2">Carpeta Mejora</div>
                <div className="gv-kpi text-primary">{data.by_tipo?.mejora || 0}</div>
                <div className="text-secondary small mt-1">En gestión técnica</div>
              </div>
            </div>
             <div className="col-md-3">
              <div className="card gv-card h-100 p-4 shadow-sm border-0">
                <div className="gv-muted text-uppercase mb-2">Carpeta Terreno</div>
                <div className="gv-kpi text-warning">{data.by_tipo?.terreno || 0}</div>
                <div className="text-secondary small mt-1">En gestión técnica</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* NIVEL 3: EL CORAZÓN DE LA OPERACIÓN (Análisis por Tramos) */}
      <div className="gv-section-title">
        <i className="bi bi-map-fill text-primary"></i> Desglose Territorial por Tramos
      </div>
      <div className="card gv-card border-0 shadow-sm p-4 mb-5">
         <div className="row g-4 d-flex align-items-center">
            <div className="col-md-9 border-end">
               <GVCharts
                dashboard={data}
                onCompositionSelect={applyCompositionFilter}
                onMejoraPhaseSelect={(idx) => applyBarPhaseFilter("mejora", idx)}
                onTerrenoPhaseSelect={(idx) => applyBarPhaseFilter("terreno", idx)}
                hierarchyBar={hierarchyBar}
              />
            </div>
            <div className="col-md-3">
               <div className="d-flex justify-content-between align-items-center mb-3">
                  <div className="text-secondary small fw-bold">Selector de Zona</div>
                  {selectedHierarchyLevel !== "proyecto" && (
                    <button className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => resetHierarchyToProject()}>Reiniciar</button>
                  )}
               </div>
               <div className="d-flex flex-column gap-2" style={{ maxHeight: 350, overflowY: 'auto' }}>
                  {tramoCards.map((t) => (
                    <button
                      key={t.id}
                      className={`btn btn-sm text-start rounded-3 p-3 border-0 shadow-none ${selectedTramo === t.descripcion ? "bg-primary bg-opacity-10 text-primary fw-bold" : "bg-light text-secondary"}`}
                      onClick={() => handleSelectTramoCard(t.descripcion)}
                    >
                      <div className="d-flex justify-content-between align-items-center">
                         <span>{t.descripcion}</span>
                         <span className="small opacity-75">{t.pct.toFixed(0)}%</span>
                      </div>
                      <div className="progress mt-2" style={{ height: 4 }}>
                         <div className="progress-bar" style={{ width: `${t.pct}%`, backgroundColor: selectedTramo === t.descripcion ? '#0D6EFD' : '#94A3B8' }}></div>
                      </div>
                    </button>
                  ))}
               </div>
            </div>
         </div>
      </div>

      {/* NIVEL 4: IMPACTO ECONÓMICO (Informes Financieros) */}
      <div className="gv-section-title">
        <i className="bi bi-cash-stack text-warning"></i> Estado de Inversión y Compensaciones
      </div>
      <div className="mb-5" style={{ background: '#F0F9FF', margin: '0 -1.5rem', padding: '2rem 1.5rem', borderTop: '1px solid #BAE6FD', borderBottom: '1px solid #BAE6FD' }}>
        <GVEconomicPanel
          data={ecoData}
          loading={ecoLoading}
          error={ecoError}
          contextLabel={economicoContext.length > 0 ? `Universo actual: ${economicoContext.join(" / ")}` : "Universo completo del proyecto"}
        />
      </div>

      {/* NIVEL 5: ANÁLISIS TEMPORAL Y DETALLE (Tablas) */}
      <div className="row g-4 mb-5">
        <div className="col-md-7">
           <div className="gv-section-title">
              <i className="bi bi-graph-up text-primary"></i> Tendencia de Relevamiento
           </div>
           <div className="card gv-card border-0 shadow-sm p-4">
               <div className="d-flex justify-content-between align-items-center mb-4">
                  <div className="gv-muted text-uppercase">Análisis Cronológico</div>
                  <div className="d-flex gap-2">
                      <select className="form-select form-select-sm rounded-pill" value={tempGranularidad} onChange={(e) => setTempGranularidad(e.target.value)}>
                        <option value="dia">Día</option>
                        <option value="semana">Semana</option>
                        <option value="mes">Mes</option>
                      </select>
                      <select className="form-select form-select-sm rounded-pill" value={tempModoDetalle} onChange={(e) => setTempModoDetalle(e.target.value)}>
                          <option value="fases">Ver Fases</option>
                          <option value="dbi">Ver DBI</option>
                      </select>
                  </div>
               </div>
               <GVTemporalCharts
                avance={tempAvance}
                detalle={tempDetalle}
                selectedCategoria={tempSelectedCategoria}
                modoDetalle={tempModoDetalle}
                onSelectCategoria={setTempSelectedCategoria}
                isFiltered={temporalFilterBadges.length > 0}
                loadingAvance={tempLoadingAvance}
                loadingDetalle={tempLoadingDetalle}
                errorAvance={tempErrorAvance}
                errorDetalle={tempErrorDetalle}
              />
           </div>
        </div>
        <div className="col-md-5">
            <div className="gv-section-title">
              <i className="bi bi-list-check text-secondary"></i> Distribución Técnica por Etapas
            </div>
            <div className="card gv-card border-0 shadow-sm p-0 overflow-hidden">
                <div className="bg-light p-3 border-bottom d-flex justify-content-between align-items-center">
                   <div className="small fw-bold text-secondary text-uppercase">Desglose de Notificaciones</div>
                   <button className="btn btn-link btn-sm text-decoration-none p-0 text-muted" onClick={() => setMapFilters(prev => ({ ...prev, tipo: "", faseMin: "", faseMax: "" }))}>Limpiar Etapa</button>
                </div>
                <div className="p-3">
                   <div className="row g-3">
                      <div className="col-6 border-end">
                         <div className="small fw-bold mb-2 text-primary">Mejora</div>
                         <div className="table-responsive">
                            <table className="table table-sm table-borderless gv-table mb-0">
                               <tbody>
                                  {normalizePhaseCounts(data, 'mejora', 5).map((count, i) => (
                                    <tr key={`m-${i}`} className={`gv-phase-filter-row ${mapFilters.tipo === "mejora" && mapFilters.faseMin === String(i) ? "gv-phase-filter-row--active" : ""}`} onClick={() => applyPhaseFilter("mejora", i)}>
                                      <td><GvPhaseChip phaseIndex={i} phaseTotal={5} label={`F${i}`} /></td>
                                      <td className="text-end fw-bold">{count}</td>
                                    </tr>
                                  ))}
                               </tbody>
                            </table>
                         </div>
                      </div>
                      <div className="col-6">
                         <div className="small fw-bold mb-2 text-warning">Terreno</div>
                         <div className="table-responsive">
                            <table className="table table-sm table-borderless gv-table mb-0">
                               <tbody>
                                  {normalizePhaseCounts(data, 'terreno', 7).map((count, i) => (
                                    <tr key={`t-${i}`} className={`gv-phase-filter-row ${mapFilters.tipo === "terreno" && mapFilters.faseMin === String(i) ? "gv-phase-filter-row--active" : ""}`} onClick={() => applyPhaseFilter("terreno", i)}>
                                      <td><GvPhaseChip phaseIndex={i} phaseTotal={7} label={`F${i}`} /></td>
                                      <td className="text-end fw-bold">{count}</td>
                                    </tr>
                                  ))}
                               </tbody>
                            </table>
                         </div>
                      </div>
                   </div>
                </div>
            </div>
        </div>
      </div>

      <div className="card gv-card border-0 shadow-sm bg-light mb-4">
          <div className="card-body py-4 px-4">
              <div className="gv-section-title mb-3">
                 <i className="bi bi-funnel-fill text-secondary"></i> Filtros de Notificación Territorial
              </div>
              <div className="row g-3">
                 <div className="col-md-5">
                    <div className="position-relative">
                       <span className="position-absolute top-50 start-0 translate-middle-y ps-3 text-muted"><i className="bi bi-search"></i></span>
                       <input type="text" className="form-control ps-5" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Nro. Notificación Único, Titular o CI..." />
                    </div>
                 </div>
                 <div className="col-md-2">
                    <select className="form-select" name="tipo" value={mapFilters.tipo} onChange={handleFilterChange}>
                       <option value="">Tipo de Carpeta</option>
                       <option value="mejora">Mejora</option>
                       <option value="terreno">Terreno</option>
                    </select>
                 </div>
                 <div className="col-md-2">
                    <select className="form-select" name="hasPolygon" value={mapFilters.hasPolygon} onChange={handleFilterChange}>
                       <option value="">Estado Geométrico</option>
                       <option value="true">Con Polígono</option>
                       <option value="false">Sin Polígono</option>
                    </select>
                 </div>
                 <div className="col-md-3">
                     <select className="form-select" name="hasDBI" value={mapFilters.hasDBI} onChange={handleFilterChange}>
                        <option value="">Seguimiento DBI</option>
                        <option value="true">Con DBI</option>
                        <option value="false">Sin DBI</option>
                     </select>
                 </div>
              </div>
          </div>
      </div>

      {/* Modal Aislado */}
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

