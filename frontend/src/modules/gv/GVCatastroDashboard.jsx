import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { gvGetDashboard, gvGetExpedienteDocs, gvGetExpedienteEtapas, gvGetExpediente, gvGetTramosCensales, gvGetSubtramosCensales } from "./gv_service";
import GVCharts from "./GVCharts";
import GVMapaCatastroGoogle from "./GVMapaCatastroGoogle";
import GvPhaseChip from "./GvPhaseChip";
import { Link } from "react-router-dom";
import GvExpedienteModal from "./GvExpedienteModal";
import { resolveStageOrder, computePhaseMeta, isOk } from "./gv_phase";
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
    hasDBI: ""
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

  // States para Preview Panel
  const [selectedExpId, setSelectedExpId] = useState(null);
  const [selectedExp, setSelectedExp] = useState(null); // Objeto completo del expediente
  const [selectedProps, setSelectedProps] = useState(null);
  const [previewExtra, setPreviewExtra] = useState(null); // { etapas: {}, docs: [] }
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // States para el nuevo Modal Aislado
  const [modalShow, setModalShow] = useState(false);
  const [modalExpId, setModalExpId] = useState(null);
  const [modalSeedProps, setModalSeedProps] = useState(null);

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
        const result = await gvGetDashboard(id);
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
  }, [id]);

  useEffect(() => {
    if (!id) return;
    gvGetTramosCensales(id)
      .then((resp) => setTramosCensales(Array.isArray(resp?.items) ? resp.items : []))
      .catch(() => setTramosCensales([]));
  }, [id]);

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

  // Lógica de fetch para el Preview Panel
  useEffect(() => {
    if (!selectedExpId) {
      setSelectedExp(null);
      setPreviewExtra(null);
      setPreviewError(null);
      return;
    }

    let isSubscribed = true;

    async function fetchPreviewDetails() {
      try {
        setPreviewLoading(true);
        setPreviewError(null);

        // Fetch inicial del expediente para tener el tipoBase
        const expFull = await gvGetExpediente(selectedExpId);
        if (!isSubscribed) return;
        setSelectedExp(expFull);

        // Determinar tipo (mejora/terreno)
        const tipoBase = String(expFull.tipo_proyecto || "").toLowerCase().includes("terreno") ? "terreno" : "mejora";

        const promises = [
          gvGetExpedienteEtapas(selectedExpId, tipoBase).catch(() => ({})),
          gvGetExpedienteDocs(selectedExpId).catch(() => [])
        ];

        const [etapas, docs] = await Promise.all(promises);

        if (isSubscribed) {
          setPreviewExtra({ etapas, docs });
        }
      } catch (err) {
        if (isSubscribed) {
          setPreviewError(err.message || "No se pudo cargar el detalle completo.");
        }
      } finally {
        if (isSubscribed) setPreviewLoading(false);
      }
    }

    fetchPreviewDetails();

    return () => { isSubscribed = false; };
  }, [selectedExpId]);

  const handleSelectExpediente = (expId, props) => {
    setSelectedExpId(expId);
    setSelectedProps(props);

    // Auto-abrir modal al seleccionar feature (opcional según requerimiento)
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
    <div className="container-fluid gv-page">
      <h2 className="mb-4">Catastro Dashboard - Proyecto {id}</h2>

      {/* Guardrails: compute once, safely */}
      {(() => {
        const targetTotal = safeNumber(data?.target_total, 0);
        const censados = safeNumber(data?.censados, 0);
        const hasDenom = targetTotal > 0;
        const rawPct = safeNumber(data?.coverage_pct, null);
        const coveragePct = rawPct !== null && rawPct >= 0 ? rawPct : safePct(censados, targetTotal);
        const gap = hasDenom ? Math.max(targetTotal - censados, 0) : 0;

        return (
          <div className="row g-4 mb-4">
            {/* Card 1: Cobertura */}
            <div className="col-md-4">
              <div className="card shadow-sm h-100 p-3 gv-card" style={{ borderLeftColor: "#198754" }}>
                <h5 className="text-success mb-3">Cobertura</h5>
                <div className="d-flex justify-content-between mb-2">
                  <span className="gv-muted">Meta (Target)</span>
                  <span className="gv-kpi text-dark">{hasDenom ? targetTotal : "—"}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="gv-muted">Censados</span>
                  <span className="gv-kpi text-dark">{censados}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="gv-muted">Brecha</span>
                  <span className="gv-kpi text-secondary">{hasDenom ? gap : "—"}</span>
                </div>
                <div className="d-flex justify-content-between mt-3 pt-3 border-top">
                  <span className="gv-muted fw-bold text-dark">Avance</span>
                  <span className="gv-kpi text-success">
                    {hasDenom ? formatPct01(coveragePct) : <small className="text-muted">Sin universo definido</small>}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Composición */}
            <div className="col-md-4">
              <div className="card shadow-sm h-100 p-3 gv-card" style={{ borderLeftColor: "#0d6efd" }}>
                <h5 className="text-primary mb-3">Composición</h5>
                <div className="d-flex justify-content-between mb-2">
                  <span className="gv-muted">Mejoras</span>
                  <span className="gv-kpi text-dark">{data.by_tipo?.mejora || 0}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="gv-muted">Terrenos</span>
                  <span className="gv-kpi text-dark">{data.by_tipo?.terreno || 0}</span>
                </div>
              </div>
            </div>

            {/* Card 3: Tramos */}
            <div className="col-md-4">
              <div className="card shadow-sm h-100 p-3 gv-card" style={{ borderLeftColor: "#f59e0b" }}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0" style={{ color: "#d97706" }}>Tramos</h5>
                  {selectedHierarchyLevel !== "proyecto" && (
                    <button
                      className="btn btn-sm btn-outline-warning"
                      onClick={() => resetHierarchyToProject()}
                    >
                      Ver todos
                    </button>
                  )}
                </div>
                {tramoCards.length === 0 ? (
                  <div className="text-muted small">Sin tramos censales cargados.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {tramoCards.map((t) => {
                      const isActive = selectedHierarchyLevel === "tramo" && selectedTramo === t.descripcion;
                      return (
                        <button
                          key={t.id}
                          className={`btn btn-sm text-start ${isActive ? "btn-warning" : "btn-outline-warning"}`}
                          onClick={() => handleSelectTramoCard(t.descripcion)}
                        >
                          <div className="fw-semibold">{t.descripcion}</div>
                          <div className="d-flex justify-content-between small">
                            <span>Universo: {t.universo || "--"}</span>
                            <span>Censados: {t.censados}</span>
                          </div>
                          <div className="small text-muted">{t.pct.toFixed(1)}%</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      <GVCharts
        dashboard={data}
        onCompositionSelect={applyCompositionFilter}
        onMejoraPhaseSelect={(idx) => applyBarPhaseFilter("mejora", idx)}
        onTerrenoPhaseSelect={(idx) => applyBarPhaseFilter("terreno", idx)}
        hierarchyBar={hierarchyBar}
      />
      <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
        <span className="badge bg-light text-dark border">Proyecto</span>
        {selectedTramo && (
          <>
            <span className="text-muted">›</span>
            <span className="badge bg-warning text-dark">{selectedTramo}</span>
          </>
        )}
        {selectedSubtramo && (
          <>
            <span className="text-muted">›</span>
            <span className="badge bg-primary">{selectedSubtramo}</span>
          </>
        )}
        <div className="ms-auto d-flex gap-2">
          {selectedHierarchyLevel === "subtramo" && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => handleSelectSubtramo("")}
            >
              Volver a Tramo
            </button>
          )}
          {selectedHierarchyLevel !== "proyecto" && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => resetHierarchyToProject()}
            >
              Volver a Proyecto
            </button>
          )}
        </div>
      </div>

      {/* Distribución Global por fases */}
      <div className="card shadow-sm mt-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="card-title text-secondary mb-0">Distribución por fases (Global)</h5>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setMapFilters(prev => ({ ...prev, tipo: "", faseMin: "", faseMax: "" }))}
            >
              Limpiar filtro de fase
            </button>
          </div>
          <p className="small text-muted mb-3">
            F0 = Censo sin documentación | F1 = Documentación | Final = Carpeta finalizada
          </p>
          <div className="row g-4">
            {/* Tabla Mejora */}
            <div className="col-md-6">
              <h6 className="text-primary border-bottom pb-2">Mejora</h6>
              <div className="table-responsive">
                <table className="table table-sm table-borderless align-middle mb-0 gv-table">
                  <thead className="table-light text-muted small">
                    <tr>
                      <th>Fase</th>
                      <th>Cantidad</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const counts = normalizePhaseCounts(data, 'mejora', 5); // MaxFases de mejora original
                      const totalTipo = data.by_tipo?.mejora || 0;
                      return counts.map((count, i) => {
                        const isActive = mapFilters.tipo === "mejora" && mapFilters.faseMin === String(i) && mapFilters.faseMax === String(i);
                        return (
                          <tr
                            key={`m-${i}`}
                            className={`gv-phase-filter-row ${isActive ? "gv-phase-filter-row--active" : ""}`}
                            onClick={() => applyPhaseFilter("mejora", i)}
                          >
                            <td>
                              <GvPhaseChip phaseIndex={i} phaseTotal={5} label={`F${i}`} />
                            </td>
                            <td className="fw-semibold">{count}</td>
                            <td className="text-muted small">
                              {totalTipo > 0 ? ((count / totalTipo) * 100).toFixed(1) : 0}%
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabla Terreno */}
            <div className="col-md-6">
              <h6 className="text-warning border-bottom pb-2">Terreno</h6>
              <div className="table-responsive">
                <table className="table table-sm table-borderless align-middle mb-0 gv-table">
                  <thead className="table-light text-muted small">
                    <tr>
                      <th>Fase</th>
                      <th>Cantidad</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const counts = normalizePhaseCounts(data, 'terreno', 7); // MaxFases de terreno original
                      const totalTipo = data.by_tipo?.terreno || 0;
                      return counts.map((count, i) => {
                        const isActive = mapFilters.tipo === "terreno" && mapFilters.faseMin === String(i) && mapFilters.faseMax === String(i);
                        return (
                          <tr
                            key={`t-${i}`}
                            className={`gv-phase-filter-row ${isActive ? "gv-phase-filter-row--active" : ""}`}
                            onClick={() => applyPhaseFilter("terreno", i)}
                          >
                            <td>
                              <GvPhaseChip phaseIndex={i} phaseTotal={7} label={`F${i}`} />
                            </td>
                            <td className="fw-semibold">{count}</td>
                            <td className="text-muted small">
                              {totalTipo > 0 ? ((count / totalTipo) * 100).toFixed(1) : 0}%
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row map layout and Filters */}
      <div className="card shadow-sm mt-4 mb-4">
        <div className="card-body bg-light">
          <h5 className="card-title text-secondary mb-3">Filtros del Mapa</h5>
          <div className="mb-2">
            {Object.keys(initialFilters).some((k) => String(mapFilters[k] || "") !== "") ? (
              <small className="text-muted">Filtros activos</small>
            ) : (
              <small className="text-muted">Sin filtros</small>
            )}
          </div>
          <div className="row g-3 gv-filtros">
            <div className="col-md-3">
              <label className="form-label mb-1 text-muted small">Búsqueda</label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (qDebounceRef.current) {
                      clearTimeout(qDebounceRef.current);
                      qDebounceRef.current = null;
                    }
                    setMapFilters((prev) => ({ ...prev, q: e.currentTarget.value }));
                  }
                }}
                placeholder="Buscar por nombre, CI, expediente, DBI o código censo"
              />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1 text-muted small">Tipo</label>
              <select className="form-select form-select-sm" name="tipo" value={mapFilters.tipo} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="mejora">Mejora</option>
                <option value="terreno">Terreno</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1 text-muted small">Fase Min</label>
              <select className="form-select form-select-sm" name="faseMin" value={mapFilters.faseMin} onChange={handleFilterChange}>
                <option value="">Todos</option>
                {[...Array(8).keys()].map(i => <option key={i} value={String(i)}>F{i}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1 text-muted small">Fase Max</label>
              <select className="form-select form-select-sm" name="faseMax" value={mapFilters.faseMax} onChange={handleFilterChange}>
                <option value="">Todos</option>
                {[...Array(8).keys()].map(i => <option key={i} value={String(i)}>F{i}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label mb-1 text-muted small">Tramo</label>
              <select
                className="form-select form-select-sm"
                value={mapFilters.tramo}
                onChange={(e) => {
                  const desc = e.target.value;
                  setMapFilters((prev) => ({ ...prev, tramo: desc, subtramo: "" }));
                  setSelectedTramo(desc);
                  setSelectedSubtramo("");
                  setSelectedHierarchyLevel(desc ? "tramo" : "proyecto");
                  setSubtramosCensales([]);
                  if (desc) {
                    loadSubtramosForTramoDesc(desc);
                  }
                }}
              >
                <option value="">Todos</option>
                {tramosCensales.map((t) => (
                  <option key={t.id_proyecto_tramo} value={t.descripcion}>
                    {t.descripcion}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label mb-1 text-muted small">Subtramo</label>
              <select
                className="form-select form-select-sm"
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

            {/* Booleans Toggle Selects */}
            <div className="col-md-3 mt-3">
              <label className="form-label mb-1 text-muted small">Con Polígono</label>
              <select className="form-select form-select-sm" name="hasPolygon" value={mapFilters.hasPolygon} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <div className="col-md-3 mt-3">
              <label className="form-label mb-1 text-muted small">Con Docs (Tumba)</label>
              <select className="form-select form-select-sm" name="hasDocs" value={mapFilters.hasDocs} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <div className="col-md-3 mt-3">
              <label className="form-label mb-1 text-muted small">Con CI</label>
              <select className="form-select form-select-sm" name="hasCI" value={mapFilters.hasCI} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <div className="col-md-3 mt-3">
              <label className="form-label mb-1 text-muted small">Con DBI</label>
              <select className="form-select form-select-sm" name="hasDBI" value={mapFilters.hasDBI} onChange={handleFilterChange}>
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>

            <div className="col-12 mt-3 text-end pt-2 border-top">
              <button className="btn btn-outline-secondary btn-sm" onClick={handleResetFilters}>Limpiar Filtros</button>
            </div>
          </div>

          <div className="alert alert-secondary py-2 mt-3 mb-0" role="alert">
            <strong>Registros encontrados en el mapa:</strong>{" "}
            {mapStats ? mapStats.totalFeatures : "..."}
          </div>
          {mapStats && mapStats.totalFeatures === 0 && Object.keys(initialFilters).some((k) => String(mapFilters[k] || "") !== "") && (
            <div className="alert alert-warning py-2 mt-2 mb-0" role="alert">
              No se encontraron expedientes con los filtros actuales.
            </div>
          )}
        </div>
      </div>

      <div className="row mt-4">
        {/* Mapa (7 u 8 columnas según si hay selección) */}
        <div className={selectedExpId ? "col-lg-8" : "col-12"}>
          {(mapFilters.tipo === "mejora" || mapFilters.tipo === "terreno") && (() => {
            const isPhaseStrict = mapFilters.faseMin !== "" && mapFilters.faseMin === mapFilters.faseMax;
            const labelTipo = mapFilters.tipo === "mejora" ? "Mejora" : "Terreno";

            return (
              <div className="alert alert-info py-2 d-flex justify-content-between align-items-center">
                <span>
                  Filtro activo: <strong>{labelTipo} {isPhaseStrict ? `/ F${mapFilters.faseMin}` : ""}</strong>
                </span>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => handleResetFilters()}
                >
                  Limpiar filtros
                </button>
              </div>
            );
          })()}
          <GVMapaCatastroGoogle
            proyectoId={id}
            filters={mapFilters}
            onStatsChange={setMapStats}
            onSelectExpediente={handleSelectExpediente}
          />
        </div>

        {/* Panel de Previsualización (4 columnas) */}
        {selectedExpId && (
          <div className="col-lg-4">
            <div className="card shadow-sm gv-preview-card mt-4">
              <div className="card-body p-3">
                <div className="d-flex justify-content-between align-items-start gv-preview-header">
                  <div>
                    <h5 className="mb-0">Expediente #{selectedExpId}</h5>
                    <div className="text-primary fw-bold small">{selectedProps?.codigo_exp || "Sin código"}</div>
                  </div>
                  <button className="btn-close btn-sm" onClick={() => setSelectedExpId(null)}></button>
                </div>

                {previewLoading ? (
                  <div className="py-5 text-center">
                    <div className="spinner-border spinner-border-sm text-primary" role="status"></div>
                    <div className="small text-muted mt-2">Cargando detalles...</div>
                  </div>
                ) : (
                  <div className="gv-preview-body">
                    {previewError && <div className="alert alert-warning py-1 small">{previewError}</div>}

                    {(() => {
                      const tipoRaw = selectedProps?.tipo || (selectedExp ? (String(selectedExp.tipo_proyecto || "").toLowerCase().includes("terreno") ? "terreno" : "mejora") : "mejora");
                      const stages = resolveStageOrder(tipoRaw);
                      const phaseMeta = computePhaseMeta(previewExtra?.etapas || {}, stages);

                      return (
                        <>
                          <div className="mb-3">
                            <div className="gv-muted fw-bold">PROPIETARIO</div>
                            <div>{selectedExp?.propietario_nombre || selectedProps?.propietario_nombre || "—"}</div>
                            {selectedExp?.propietario_ci && (
                              <div className="small text-muted">CI: {selectedExp.propietario_ci}</div>
                            )}
                          </div>

                          <div className="row g-2 mb-3">
                            <div className="col-6">
                              <div className="gv-muted fw-bold">TRAMO</div>
                              <div className="small">{selectedExp?.tramo || selectedProps?.tramo || "—"}</div>
                            </div>
                            <div className="col-6">
                              <div className="gv-muted fw-bold">SUBTRAMO</div>
                              <div className="small">{selectedExp?.subtramo || selectedProps?.subtramo || "—"}</div>
                            </div>
                          </div>

                          <div className="row g-2 mb-3">
                            <div className="col-6">
                              <div className="gv-muted fw-bold">TÉCNICO</div>
                              <div className="small">{selectedExp?.tecnico || "—"}</div>
                            </div>
                            <div className="col-6">
                              <div className="gv-muted fw-bold">FECHA RELEV.</div>
                              <div className="small">
                                {selectedExp?.fecha_relevamiento
                                  ? String(selectedExp.fecha_relevamiento).slice(0, 10)
                                  : "—"}
                              </div>
                            </div>
                          </div>

                          <div className="mb-3">
                            <div className="gv-muted fw-bold mb-1">FASE ACTUAL</div>
                            <div className="d-flex align-items-center gap-2">
                              <GvPhaseChip
                                phaseIndex={phaseMeta.faseIndex}
                                phaseTotal={phaseMeta.totalCount}
                                label={phaseMeta.faseLabel}
                              />
                              {phaseMeta.nextLabel && (
                                <span className="small text-muted">
                                  Siguiente: {phaseMeta.nextLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mb-3">
                            <div className="gv-muted fw-bold mb-2">ETAPAS</div>
                            <div className="table-responsive border rounded bg-white">
                              <table className="table table-sm table-borderless mb-0 align-middle small">
                                <tbody>
                                  {stages.map(key => {
                                    const st = previewExtra?.etapas?.[key] || { ok: false };
                                    const ok = isOk(st.ok);
                                    return (
                                      <tr key={key} className="border-bottom-0">
                                        <td style={{ width: 30 }} className="text-center">
                                          {ok ? <span className="text-success">✓</span> : <span className="text-muted opacity-50">○</span>}
                                        </td>
                                        <td className={ok ? "text-dark" : "text-muted"}>
                                          {key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className="mb-4">
                            <div className="gv-muted fw-bold mb-2">DOCUMENTACIÓN</div>
                            <div className="d-flex flex-wrap gap-2">
                              <span className={`badge ${selectedProps?.has_docs ? "bg-success" : "bg-light text-dark border"}`}>
                                Docs: {previewExtra?.docs?.length || (selectedProps?.has_docs ? "✓" : "0")}
                              </span>
                              <span className={`badge ${selectedProps?.has_ci ? "bg-success" : "bg-light text-dark border"}`}>
                                C.I. {selectedProps?.has_ci ? "✓" : "✖"}
                              </span>
                              <span className={`badge ${selectedProps?.has_dbi ? "bg-success" : "bg-light text-dark border"}`}>
                                DBI {selectedProps?.has_dbi ? "✓" : "✖"}
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    {/* Botón de acción principal: abre el modal aislado */}
                    <div className="d-grid mt-auto gap-2">
                      <button
                        className="btn btn-primary btn-sm py-2"
                        onClick={() => {
                          setModalExpId(selectedExpId);
                          setModalSeedProps(selectedProps);
                          setModalShow(true);
                        }}
                      >
                        Ver detalles completos
                      </button>
                      <Link
                        to={`/proyectos/${id}/expedientes?expId=${selectedExpId}`}
                        className="btn btn-outline-primary btn-sm py-2"
                      >
                        Ir al módulo de expedientes
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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
