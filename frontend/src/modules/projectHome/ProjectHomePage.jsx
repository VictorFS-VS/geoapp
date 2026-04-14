import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { projectHomeApi } from "./projectHome.service";
import { useProjectContext } from "@/context/ProjectContext";
import { hasPerm, esAdmin } from "@/utils/auth";
import "./ProjectHomePage.css";
import ProjectHomeConfigPanel from "./ProjectHomeConfigPanel";
import ProjectHomeKpiChart from "./ProjectHomeKpiChart";

const EMPTY_VALUE = "—";

const renderValue = (value) =>
  value === undefined || value === null || value === "" ? EMPTY_VALUE : value;

const renderNumeric = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString() : EMPTY_VALUE;
};

const cleanTechnicalLabel = (str) => {
  if (!str) return "";
  let clean = str;
  clean = clean.replace(/^P\d+\s*-\s*/i, "");
  clean = clean.replace(/^\[V\d+\]\s*/i, "");
  clean = clean.replace(/^Predomina( en|:)?\s*/i, "");
  return clean.trim();
};

const ProjectHomeFeaturedReportCard = ({ report, onClick }) => {
  const value = report?.primary_val;
  const title = report?.display_title || report?.label || "Resumen ejecutivo";

  const rawPrimaryLabel = cleanTechnicalLabel(report?.primary_label) || "Sin datos";
  let contextNode = null;
  let fieldName = "";

  if (report?.primary_context) {
    const ctx = report.primary_context;
    const pctMatch = ctx.match(/\((\d+%)\)/);
    const pct = pctMatch ? pctMatch[1] : "";

    const fieldMatch = ctx.match(/^Predomina en (.*?)\s*(?:\(|$)/);
    if (fieldMatch) {
      fieldName = cleanTechnicalLabel(fieldMatch[1]);
    }
    
    if (pct) {
      contextNode = `${pct} del total`;
    } else if (ctx === "Sin KPI configurado") {
      contextNode = "";
    } else {
      contextNode = cleanTechnicalLabel(ctx);
    }
  }

  const finalLabel = fieldName ? `${fieldName}: ${rawPrimaryLabel}` : rawPrimaryLabel;
  const secondary = Array.isArray(report?.secondary_lines) ? report.secondary_lines : [];

  return (
    <button 
      type="button"
      className="ph-card ph-card-compact ph-featured-card" 
      onClick={onClick}
    >
      <div className="ph-card-compact-header">
        <span className="ph-card-compact-title">{title}</span>
        {report?.base_total !== undefined && report?.base_total !== null && (
          <div className="ph-card-subheader">Base analizada: {report.base_total.toLocaleString()}</div>
        )}
      </div>
      <div className="ph-card-compact-value ph-featured-primary-value">
        {value !== undefined && value !== null ? renderNumeric(value) : EMPTY_VALUE}
      </div>
      <div className="ph-card-compact-meta ph-featured-primary-meta" data-has-secondary={secondary.length > 0}>
        <div style={{ color: "#0f172a", fontWeight: 500 }}>{finalLabel}</div>
        {contextNode && <div style={{ marginTop: '0.15rem' }}>{contextNode}</div>}
      </div>
      {secondary.length > 0 && (
        <div className="ph-featured-secondary-stack">
          {secondary.slice(0, 2).map((s, idx) => {
            const secLabel = cleanTechnicalLabel(s.label) || "Atributo";
            const secMeta = cleanTechnicalLabel(s.meta);
            return (
              <div key={idx} className="ph-featured-secondary-item">
                <strong>{secLabel} dominante:</strong> {secMeta} <span style={{ opacity: 0.8 }}>({s.pct}% - {renderNumeric(s.val)})</span>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
};

const ProjectHomeInformesResumen = ({ payload }) => {
  const informeStats = payload?.general || {};
  const configResolution = payload?.config_resolution || {};
  const plantillas = Array.isArray(payload?.plantillas) ? payload.plantillas : [];

  const primaryKpi = payload?.kpis?.primary
    ? { ...payload.kpis.primary, etiqueta: cleanTechnicalLabel(payload.kpis.primary.etiqueta) }
    : null;
  const secondaryKpis = (Array.isArray(payload?.kpis?.secondary) ? payload.kpis.secondary : []).map(k => ({
    ...k,
    etiqueta: cleanTechnicalLabel(k.etiqueta)
  }));

  const primaryDefaultChartType = Array.isArray(primaryKpi?.items) && primaryKpi.items.length > 6 ? "bar" : "donut";
  const getSecondaryDefaultChartType = (summary) => Array.isArray(summary?.items) && summary.items.length > 10 ? "list" : "bar";

  const visibleSecondaryKpis = secondaryKpis.slice(0, 2);
  const hasPrimaryKpi = Boolean(primaryKpi);
  const hasSecondaryKpis = visibleSecondaryKpis.length > 0;

  const renderSecondaryCards = () =>
    visibleSecondaryKpis.map((summary, index) => (
      <div
        key={summary.id_pregunta || summary.etiqueta || `secondary-${index}`}
        className="ph-kpi-home-secondary-item"
      >
        <ProjectHomeKpiChart
          title="Indicador secundario"
          summary={summary}
          defaultType={getSecondaryDefaultChartType(summary)}
          compact
          variant="secondary"
          modern={true}
        />
      </div>
    ));

  const renderPrimaryCard = () =>
    hasPrimaryKpi ? (
    <ProjectHomeKpiChart
      title="Indicador principal"
      summary={primaryKpi}
      defaultType={primaryDefaultChartType}
      emptyLabel="Sin indicador principal disponible"
      variant="primary"
      modern={true}
    />
    ) : null;

  const renderKpiLayout = () => {
    if (!hasPrimaryKpi && !hasSecondaryKpis) return null;
    return (
      <div className="ph-kpi-modern-view">
        {hasPrimaryKpi && (
          <div className="ph-kpi-modern-main">
            {renderPrimaryCard()}
          </div>
        )}
        {hasSecondaryKpis && (
          <div className="ph-kpi-modern-side">
            {renderSecondaryCards()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ph-tab-informes-content">
      <div className="ph-informes-fullwidth">
        <div className="ph-kpi-section ph-kpi-section--informes">
          {renderKpiLayout()}
        </div>
      </div>
    </div>
  );
};

const ProjectHomePage = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { setCurrentProjectId, currentProjectId } = useProjectContext();

  const idProyecto = params.id_proyecto || params.idProyecto;
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const idPlantilla = searchParams.get("id_plantilla") || searchParams.get("idPlantilla");

  const canConfigurePanel = useMemo(() => esAdmin(), []);
  const canSeeInformes = useMemo(() => hasPerm("informes.read"), []);
  const canSeeExpedientes = useMemo(() => hasPerm("expedientes.read"), []);
  const canSeeQuejas = useMemo(() => hasPerm("quejas_reclamos.read"), []);
  const effectiveProjectId = useMemo(() => {
    const id = Number(currentProjectId || idProyecto || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [currentProjectId, idProyecto]);

  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("resumen");
  const [showConfig, setShowConfig] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fullTemporalStatus, setFullTemporalStatus] = useState("idle"); 
  const [fullTemporalError, setFullTemporalError] = useState("");

  const [homeItemsLoading, setHomeItemsLoading] = useState(false);
  const [homeItemsError, setHomeItemsError] = useState("");
  const [homeItems, setHomeItems] = useState([]);
  const [selectedHomeItemId, setSelectedHomeItemId] = useState(null);
  const [childStatus, setChildStatus] = useState("idle"); 
  const [childData, setChildData] = useState(null);
  const [childError, setChildError] = useState("");
  const childReqRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (!idProyecto) {
      setStatus("missing");
      setError("Falta seleccionar un proyecto");
      return undefined;
    }

    setStatus("loading");
    projectHomeApi
      .getProjectHomeResumen({
        id_proyecto: effectiveProjectId,
        id_plantilla: idPlantilla,
        skip_temporal: true,
      })
      .then((payload) => {
        if (!active) return;
        if (!payload?.ok) {
          setStatus("empty");
          setError("No se encontraron datos");
          return;
        }
        setData(payload);
        setStatus("success");
      })
      .catch((err) => {
        if (!active) return;
        setStatus("error");
        setError(err?.message || "Error cargando el resumen");
      });

    return () => {
      active = false;
    };
  }, [effectiveProjectId, idPlantilla, idProyecto, refreshKey]);

  useEffect(() => {
    if (!idProyecto) return;
    setCurrentProjectId(Number(idProyecto));
  }, [idProyecto, setCurrentProjectId]);

  useEffect(() => {
    setSelectedHomeItemId(null);
    setChildStatus("idle");
    setChildData(null);
    setChildError("");
  }, [idProyecto]);

  const headerLabel = useMemo(() => {
    if (data?.project?.nombre) return data.project.nombre;
    if (data?.general?.project_label) return data.general.project_label;
    return "Panel del proyecto";
  }, [data]);

  const informeStats = data?.general || {};
  const expedienteStats = data?.expedientes || {};
  const quejasStats = data?.quejas || {};
  const activity = data?.activity || {};
  const plantillas = Array.isArray(data?.plantillas) ? data.plantillas : [];
  const fieldSummaries = Array.isArray(data?.field_summaries) ? data.field_summaries : [];
  const temporalSources = Array.isArray(data?.temporal_sources) ? data.temporal_sources : [];
  const focus = data?.focus || null;
  const plantillaFocus = data?.informes?.plantilla_focus || null;

  const visibleHeaderCards = useMemo(() => {
    if (!data) return [];
    return [
      canSeeInformes && data.general && {
        id: "informes",
        title: "Informes",
        value: (informeStats.total_informes || 0).toLocaleString(),
        meta: "Registrados en total",
        cta: {
          label: "Ver dashboard",
          url: `/dashboardinformes?id_proyecto=${effectiveProjectId}`,
        },
      },
      canSeeExpedientes && data.expedientes && {
        id: "expedientes",
        title: "Catastro / Puntos",
        value: (expedienteStats.total || 0).toLocaleString(),
        meta: expedienteStats.con_avance > 0 
          ? `${expedienteStats.con_avance} con avance registrado` 
          : "Total general",
        cta: {
          label: "Ver mapa",
          url: `/proyectos/${effectiveProjectId}/gv-catastro`,
        },
      },
      canSeeQuejas && data.quejas && {
        id: "quejas",
        title: "Quejas / Reclamos",
        value: (quejasStats.total || 0).toLocaleString(),
        meta: quejasStats.pendientes > 0 
          ? `${quejasStats.pendientes} pendientes de resolución` 
          : quejasStats.total === 0 ? "Sin actividad" : "Todas resueltas",
        cta: {
          label: "Ir a módulo",
          url: `/quejas-reclamos?id_proyecto=${effectiveProjectId}`,
        },
      },
    ].filter(Boolean);
  }, [data, canSeeInformes, canSeeExpedientes, canSeeQuejas, informeStats, expedienteStats, quejasStats, effectiveProjectId]);

  const plantillaById = useMemo(() => {
    const map = new Map();
    (Array.isArray(plantillas) ? plantillas : []).forEach((p) => {
      if (p?.id_plantilla === undefined || p?.id_plantilla === null) return;
      map.set(Number(p.id_plantilla), p);
    });
    return map;
  }, [plantillas]);

  const resolvePlantillaName = useCallback(
    (id) => {
      const p = plantillaById.get(Number(id));
      return p?.nombre || (id ? `Plantilla ${id}` : "Sin plantilla");
    },
    [plantillaById]
  );

  const loadHomeItems = useCallback(() => {
    if (!effectiveProjectId || !canSeeInformes) {
      setHomeItems([]);
      setHomeItemsError("");
      setHomeItemsLoading(false);
      return;
    }

    setHomeItemsLoading(true);
    setHomeItemsError("");
    projectHomeApi
      .listHomeItems({ id_proyecto: effectiveProjectId, include_legacy: true })
      .then((items) => {
        setHomeItems(Array.isArray(items) ? items : []);
      })
      .catch((err) => {
        setHomeItemsError(err?.response?.data?.message || err?.message || "Error cargando informes");
      })
      .finally(() => {
        setHomeItemsLoading(false);
      });
  }, [canSeeInformes, effectiveProjectId]);

  const selectedHomeItem = useMemo(
    () =>
      (Array.isArray(homeItems) ? homeItems : []).find(
        (item) => String(item?.id_home_item) === String(selectedHomeItemId)
      ) || null,
    [homeItems, selectedHomeItemId]
  );

  useEffect(() => {
    loadHomeItems();
  }, [loadHomeItems, refreshKey]);

  useEffect(() => {
    if (!selectedHomeItemId) return;
    const exists = homeItems.some(
      (item) => String(item?.id_home_item) === String(selectedHomeItemId)
    );
    if (!exists) {
      setSelectedHomeItemId(null);
      setChildStatus("idle");
      setChildData(null);
      setChildError("");
    }
  }, [homeItems, selectedHomeItemId]);

  useEffect(() => {
    if (!effectiveProjectId || !selectedHomeItemId) {
      setChildStatus("idle");
      setChildData(null);
      setChildError("");
      return;
    }

    const reqId = (childReqRef.current += 1);
    setChildStatus("loading");
    setChildData(null);
    setChildError("");

    const isLegacyVirtual =
      selectedHomeItem?.is_virtual === true || String(selectedHomeItem?.source_kind) === "legacy";
    const resumenParams = isLegacyVirtual
      ? { id_proyecto: effectiveProjectId }
      : {
          id_proyecto: effectiveProjectId,
          id_home_item: selectedHomeItemId,
        };

    projectHomeApi
      .getProjectHomeResumen(resumenParams)
      .then((payload) => {
        if (reqId !== childReqRef.current) return;
        if (!payload?.ok) {
          setChildStatus("empty");
          setChildData(payload || null);
          return;
        }
        setChildData(payload);
        setChildStatus("success");
      })
      .catch((err) => {
        if (reqId !== childReqRef.current) return;
        const statusCode = err?.response?.status;
        const message =
          statusCode === 404
            ? "El informe seleccionado no existe o fue desactivado."
            : err?.response?.data?.message || err?.message || "Error cargando el informe";
        setChildStatus("error");
        setChildError(message);
        if (statusCode === 404) setSelectedHomeItemId(null);
      });
  }, [effectiveProjectId, selectedHomeItemId, selectedHomeItem, refreshKey]);

  const StackedProgressBar = ({ states, total, scheme = 'operational' }) => {
    if (!total) return null;
    
    if (scheme === 'dbi') {
      const pCon = (states.con_dbi / total) * 100;
      const pSin = (states.sin_dbi / total) * 100;
      return (
        <div className="ph-stacked-bar-container">
          <div className="ph-stacked-bar">
            <div className="ph-stacked-bar-segment dbi-con" style={{ width: `${pCon}%` }} title={`Con DBI: ${states.con_dbi}`} />
            <div className="ph-stacked-bar-segment dbi-sin" style={{ width: `${pSin}%` }} title={`Sin DBI: ${states.sin_dbi}`} />
          </div>
          <div className="ph-stacked-bar-legend">
            <div className="ph-legend-item"><span className="ph-dot dbi-con"></span> Con Expediente DBI ({states.con_dbi})</div>
            <div className="ph-legend-item"><span className="ph-dot dbi-sin"></span> Pendiente DBI ({states.sin_dbi})</div>
          </div>
        </div>
      );
    }

    const pDbi = (states.listo_dbi / total) * 100;
    const pProc = (states.en_proceso / total) * 100;
    const p0 = (states.fase_0 / total) * 100;

    return (
      <div className="ph-stacked-bar-container">
        <div className="ph-stacked-bar">
          <div className="ph-stacked-bar-segment listo-dbi" style={{ width: `${pDbi}%` }} title={`Listo DBI: ${states.listo_dbi}`} />
          <div className="ph-stacked-bar-segment en-proceso" style={{ width: `${pProc}%` }} title={`En Proceso: ${states.en_proceso}`} />
          <div className="ph-stacked-bar-segment fase-0" style={{ width: `${p0}%` }} title={`Fase 0: ${states.fase_0}`} />
        </div>
        <div className="ph-stacked-bar-legend">
          <div className="ph-legend-item"><span className="ph-dot dbi"></span> Validado ({states.listo_dbi})</div>
          <div className="ph-legend-item"><span className="ph-dot proc"></span> Proceso ({states.en_proceso})</div>
          <div className="ph-legend-item"><span className="ph-dot f0"></span> Sin Datos ({states.fase_0})</div>
        </div>
      </div>
    );
  };

  const renderCatastroBlock = () => {
    const catastro = data?.catastro_summary;
    if (!catastro) return null;

    const { hero, calidad, operativa, economico, stats_estados, stats_dbi } = catastro;

    return (
      <div className="ph-catastro-section">
        <div className="ph-card ph-catastro-unified-card" style={{ padding: '1.25rem' }}>
          <div className="ph-catastro-header-flex">
            <div className="ph-catastro-header-main-text">
              Análisis de Catastro — <strong>{hero.total_relevados}</strong> de <strong>{hero.total_target}</strong> relevados ({hero.cobertura_pct?.toFixed(1)}%)
            </div>
            <button 
              type="button" 
              className="ph-card-compact-cta"
              onClick={() => navigate(`/proyectos/${effectiveProjectId}/gv-catastro`)}
            >
              Explorar catastro &rarr;
            </button>
          </div>

          <div className="ph-catastro-bars-stack">
            {stats_estados && (
              <StackedProgressBar states={stats_estados} total={hero.total_target} scheme="operational" />
            )}
            {stats_dbi && (
              <StackedProgressBar states={stats_dbi} total={hero.total_target} scheme="dbi" />
            )}
          </div>

          <div className="ph-catastro-footer-metrics-line">
            <span>Ubicación Geo: <strong>{hero.geolocalizacion_pct?.toFixed(1)}%</strong></span>
            <span className="ph-metric-sep">|</span>
            {calidad && (
              <span>Calidad Cartográfica: <strong>{calidad.precision_cartografica_pct.toFixed(1)}%</strong></span>
            )}
          </div>

          {economico && (
            <div className="ph-catastro-economico-inline">
              <span className="ph-dot-eco"></span>
              Desviación Económica: <span style={{ color: '#10b981', fontWeight: 700, marginLeft: '0.25rem' }}>
                {economico.desviacion_pct > 0 ? '+' : ''}{economico.desviacion_pct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {operativa?.top_tramos?.length > 0 && (
          <div className="ph-card ph-catastro-operativa">
            <div className="ph-card-compact-header">
              <span className="ph-card-compact-title">Tramos Críticos</span>
            </div>
            <div className="ph-catastro-operativa-list">
              {operativa.top_tramos.map((t, idx) => (
                <div key={idx} className="ph-catastro-operativa-item">
                  <div className="ph-catastro-operativa-info" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span className="ph-catastro-operativa-name" title={t.nombre}>
                      {t.nombre.substring(0, 12)}
                    </span>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      <span style={{ fontWeight: 800, color: '#ef4444' }}>{renderNumeric(t.pendientes)}</span> pendientes
                      <span className="ph-dot-separator">•</span>
                      <span style={{ fontWeight: 800 }}>{t.cobertura_pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="ph-catastro-operativa-bar-wrapper">
                    <div className="ph-catastro-operativa-bar-bg">
                      <div className="ph-catastro-operativa-bar-fill" style={{ width: `${t.cobertura_pct}%` }}>
                        <span className="ph-bar-inline-label">{t.cobertura_pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="project-home">
      <header className="ph-header">
        <div>
          <p className="ph-header-subtitle">Resumen ejecutivo del proyecto</p>
          <h1 className="ph-header-title">{headerLabel}</h1>
        </div>
        <nav className="ph-tabs">
          {[
            { key: "resumen", label: "Resumen" },
            { key: "informes", label: "Informes" },
            { key: "expedientes", label: "Expedientes" },
          ].filter(t => (t.key === 'resumen' || (t.key === 'informes' && canSeeInformes) || (t.key === 'expedientes' && canSeeExpedientes))).map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`ph-tab ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {canConfigurePanel && (
          <button
            className="pc-btn pc-btn-outline pc-btn-small"
            onClick={() => setShowConfig((prev) => !prev)}
          >
            Configurar panel
          </button>
        )}
      </header>

      {showConfig && (
        <ProjectHomeConfigPanel
          projectId={idProyecto ? Number(idProyecto) : null}
          plantillaId={idPlantilla ? Number(idPlantilla) : null}
          fieldSummaries={fieldSummaries}
          temporalSources={temporalSources}
          plantillas={plantillas}
          focus={focus}
          onSaved={(options = {}) => {
            if (options?.closePanel) {
              setShowConfig(false);
            }
            setRefreshKey((value) => value + 1);
          }}
        />
      )}

      {status === "loading" && <div className="ph-status">Cargando panel...</div>}
      {status === "error" && <div className="ph-status ph-status-error">{error}</div>}
      {status === "missing" && <div className="ph-status ph-status-error">{error}</div>}
      {status === "empty" && <div className="ph-status">Sin datos disponibles</div>}

      {status === "success" && (
        <>
          {activeTab === "resumen" && (
            <div className="ph-home-summary">
              <div 
                className="ph-home-header-grid"
                style={visibleHeaderCards.length > 0 ? {
                  gridTemplateColumns: `repeat(${visibleHeaderCards.length}, 1fr)`
                } : {}}
              >
                {visibleHeaderCards.map((card) => (
                  <div key={card.id} className="ph-card ph-card-compact">
                    <div className="ph-card-compact-header">
                      <span className="ph-card-compact-title">{card.title}</span>
                      {card.cta && (
                        <button 
                          type="button" 
                          className="ph-card-compact-cta"
                          onClick={() => navigate(card.cta.url)}
                        >
                          {card.cta.label} &rarr;
                        </button>
                      )}
                    </div>
                    <div className="ph-card-compact-value">{card.value}</div>
                    <div className="ph-card-compact-meta">{card.meta}</div>
                  </div>
                ))}
              </div>

              {canSeeInformes && data?.featured_reports && data.featured_reports.length > 0 && (
                <div className="ph-kpi-section ph-kpi-section--featured">
                  <div className="ph-card-title ph-card-title--featured">Indicadores Destacados</div>
                  <div className="ph-featured-grid">
                    {data.featured_reports.map((report) => (
                      <ProjectHomeFeaturedReportCard 
                        key={report.key} 
                        report={report} 
                        onClick={() => {
                          setActiveTab("informes");
                          setSelectedHomeItemId(report.source_kind === 'legacy' ? 'legacy-base' : report.id_home_item);
                        }} 
                      />
                    ))}
                  </div>
                </div>
              )}

              {renderCatastroBlock()}
            </div>
          )}

          {activeTab === "informes" && (
            <div className="ph-informes-public-layout">
              {!canSeeInformes && (
                <div className="ph-status ph-status-error">No tienes permisos para ver Informes.</div>
              )}

              {canSeeInformes && (
                <>
                  <header className="ph-informes-public-header">
                    <div className="ph-informes-header-top">
                      <div>
                        <div className="ph-card-title">Informes del proyecto</div>
                        <div className="ph-informes-public-list-subtitle">
                          {selectedHomeItemId 
                            ? `Viendo: ${selectedHomeItem?.label || resolvePlantillaName(selectedHomeItem?.id_plantilla)}`
                            : "Selecciona un informe para ver su análisis detallado."
                          }
                        </div>
                      </div>
                      <div className="ph-informes-header-actions">
                        {selectedHomeItemId && childStatus === "success" && childData && (
                          <div className="ph-informes-compact-meta">
                            <div className="ph-meta-item">
                              <span className="ph-meta-label">Base:</span>
                              <strong className="ph-meta-val">
                                {Number(childData?.general?.total_informes || 0).toLocaleString()}
                              </strong>
                            </div>
                            {(childData?.activity?.range_from || childData?.activity?.range_to) && (
                              <div className="ph-meta-item">
                                <span className="ph-meta-label">Periodo:</span>
                                <strong className="ph-meta-val">
                                  {`${childData?.activity?.range_from || '?'} - ${childData?.activity?.range_to || '?'}`}
                                </strong>
                              </div>
                            )}
                          </div>
                        )}
                        {selectedHomeItemId && (
                          <button
                            type="button"
                            className="pc-btn pc-btn-outline pc-btn-small"
                            onClick={() => setSelectedHomeItemId(null)}
                          >
                            Cerrar informe
                          </button>
                        )}
                      </div>
                    </div>

                    <nav className="ph-informes-selector-area">
                      {homeItemsLoading && <div className="ph-status">Cargando informes...</div>}
                      {!homeItemsLoading && homeItemsError && (
                        <div className="ph-status ph-status-error">
                          {homeItemsError}{" "}
                          <button type="button" className="ph-link" onClick={loadHomeItems}>
                            Reintentar
                          </button>
                        </div>
                      )}

                      {!homeItemsLoading && !homeItemsError && homeItems.length === 0 && (
                        <div className="ph-empty-state">
                          <div className="ph-empty-state-title">No hay informes configurados</div>
                          <div className="ph-empty-state-subtitle">
                            Puedes crear informes desde el panel de configuración.
                          </div>
                        </div>
                      )}

                      {!homeItemsLoading && !homeItemsError && homeItems.length > 0 && (
                        <ul className="ph-home-items-list">
                          {homeItems.map((item) => {
                            const id = String(item?.id_home_item || "");
                            if (!id) return null;
                            const isSelected = String(selectedHomeItemId) === id;
                            const label =
                              item?.label?.trim() ||
                              `Informe - ${resolvePlantillaName(item?.id_plantilla)}`;
                            const plantillaName =
                              item?.plantilla_nombre || resolvePlantillaName(item?.id_plantilla);
                            return (
                              <li key={id}>
                                <button
                                  type="button"
                                  className={`ph-home-item ${isSelected ? "ph-home-item--selected" : ""}`}
                                  onClick={() => setSelectedHomeItemId(id)}
                                >
                                  <div className="ph-home-item-title">
                                    <span>{label}</span>
                                    {item?.is_default && (
                                      <span className="ph-home-item-badge">Default</span>
                                    )}
                                  </div>
                                  <div className="ph-home-item-subtitle">{plantillaName}</div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </nav>
                  </header>

                  <main className="ph-informes-public-detail">
                    {!selectedHomeItemId && (
                      <div className="ph-card ph-informes-public-landing">
                        <div className="ph-card-title">Selección de Informe</div>
                        <div className="ph-card-meta ph-card-meta-column">
                          <span>
                            Selecciona uno de los informes de arriba para cargar el tablero analítico.
                          </span>
                          <span className="ph-card-meta-muted">
                            Cada informe presenta indicadores clave y distribuciones específicas.
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedHomeItemId && childStatus === "loading" && (
                      <div className="ph-status">Cargando resumen del informe...</div>
                    )}

                    {selectedHomeItemId && childStatus === "error" && (
                      <div className="ph-status ph-status-error">{childError}</div>
                    )}

                    {selectedHomeItemId && childStatus === "empty" && (
                      <div className="ph-status">Sin datos disponibles para este informe.</div>
                    )}

                    {selectedHomeItemId && childStatus === "success" && childData && (
                      <ProjectHomeInformesResumen payload={childData} />
                    )}
                  </main>
                </>
              )}
            </div>
          )}

          {activeTab === "expedientes" && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {renderCatastroBlock()}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ProjectHomePage;
