import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { projectHomeApi } from "./projectHome.service";
import { useProjectContext } from "@/context/ProjectContext";
import { useAuth } from "@/auth/AuthContext";
import { FaGlobeAmericas, FaTools, FaShieldAlt, FaHardHat, FaBullhorn, FaChartLine, FaCheckCircle, FaTrashAlt, FaEdit, FaEye, FaFileAlt, FaCog, FaChartBar, FaMapMarked, FaExclamationTriangle, FaClock } from "react-icons/fa";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import "./ProjectHomePage.css";
import ProjectHomeConfigPanel from "./ProjectHomeConfigPanel";
import ProjectHomeKpiChart from "./ProjectHomeKpiChart";
import QuejasReclamos from "@/pages/QuejasReclamos";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;
const EMPTY_VALUE = "N/D";

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

const timeAgo = (date) => {
  if (!date) return "Sin actividad registrada";
  const now = new Date();
  const past = new Date(date);
  if (isNaN(past.getTime())) return "Sin actividad registrada";
  
  const diffInMs = now - past;
  const diffInMins = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMins < 1) return "recientemente";
  if (diffInMins < 60) return `hace ${diffInMins} min`;
  if (diffInHours < 24) return `hace ${diffInHours} ${diffInHours === 1 ? 'hora' : 'horas'}`;
  if (diffInDays < 7) return `hace ${diffInDays} ${diffInDays === 1 ? 'día' : 'días'}`;
  
  return past.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

const authHeader = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const ProjectHomeFeaturedReportCard = ({ report, onClick, compact = false }) => {
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
      className={`ph-card ph-card-compact ph-featured-card ${compact ? 'ph-featured-card--compact' : ''}`} 
      onClick={onClick}
    >
      <div className="ph-card-compact-header">
        <span className="ph-card-compact-title">{title}</span>
        {report?.base_total !== undefined && report?.base_total !== null && (
          <div className="ph-card-subheader">Base: {report.base_total.toLocaleString()}</div>
        )}
      </div>
      <div className="ph-card-compact-value ph-featured-primary-value">
        {value !== undefined && value !== null ? renderNumeric(value) : EMPTY_VALUE}
      </div>
      <div className="ph-card-compact-meta ph-featured-primary-meta" data-has-secondary={!compact && secondary.length > 0}>
        <div className="ph-featured-main-label">{finalLabel}</div>
        {contextNode && <div className="ph-featured-context-label">{contextNode}</div>}
      </div>
      {!compact && secondary.length > 0 && (
        <div className="ph-featured-secondary-stack">
          {secondary.slice(0, 2).map((s, idx) => {
            const secLabel = cleanTechnicalLabel(s.label) || "Atributo";
            const secMeta = cleanTechnicalLabel(s.meta);
            return (
              <div key={idx} className="ph-featured-secondary-item">
                <strong>{secLabel}:</strong> {secMeta} <span className="ph-secondary-val">({s.pct}%)</span>
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

const ExecutiveHealthCard = ({ title, data, icon, unitLabel, onClick, color, ctaUrl, ctaLabel = "Ver Dashboard", lastActivityLabel = "Última actividad", stats }) => {
  const navigate = useNavigate();
  if (!data) return null;

  const handleCta = (e) => {
    if (ctaUrl) {
      e.stopPropagation();
      navigate(ctaUrl);
    }
  };

  const activityText = timeAgo(data.lastActivity);

  return (
    <div 
      className="ph-health-card ph-health-card--executive ph-health-card--interactive"
      style={{ borderTop: `4px solid ${color}` }}
      onClick={onClick}
    >
      <div className="ph-health-header">
        <span className="ph-health-title">{title}</span>
        <span className="ph-health-badge" style={{ background: `${color}15`, color: color }}>
          {icon}
        </span>
      </div>
      
      <div className="ph-health-body">
        <div className="ph-health-hero">
          <span className="ph-health-value">{renderNumeric(data.totalGlobal)}</span>
          <span className="ph-health-label">Total Global</span>
        </div>

        {data.focoLabel && (
          <div className="ph-health-foco">
            <strong>{data.focoLabel}:</strong> {renderNumeric(data.foco)}
          </div>
        )}

        {Array.isArray(data.desglose) && data.desglose.length > 0 && (
          <div className="ph-health-desglose">
            {data.desglose.slice(0, 4).map((item, idx) => (
              <div key={idx} className="ph-desglose-item">
                <span className="ph-desglose-label">{item.label}:</span>
                <span className="ph-desglose-val">
                  {renderNumeric(item.valor)} <small>({item.pct}%)</small>
                </span>
              </div>
            ))}
          </div>
        )}

        {stats && (
          <div className="ph-health-embedded-stats mt-3">
             <div className="d-flex align-items-center gap-3 mb-2">
                <div style={{ width: 60, height: 60 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={stats.estados.map(s => ({ value: s.count }))}
                        innerRadius={15}
                        outerRadius={25}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {stats.estados.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? "#ef4444" : "#22c55e"} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="small flex-grow-1">
                  <div className="fw-bold text-muted mb-1" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Motivos principales</div>
                  {(() => {
                    const criticalTerms = ["tramos", "afectacion", "vial", "obra"];
                    const sortedTipologias = [...stats.tipologias].sort((a, b) => {
                      const aCritical = criticalTerms.some(t => (a.tipologia || "").toLowerCase().includes(t));
                      const bCritical = criticalTerms.some(t => (b.tipologia || "").toLowerCase().includes(t));
                      if (aCritical && !bCritical) return -1;
                      if (!aCritical && bCritical) return 1;
                      return b.count - a.count;
                    });
                    
                    return sortedTipologias.slice(0, 2).map((t, i) => (
                      <div key={i} className="text-truncate" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        • {t.tipologia}: <strong>{t.count}</strong>
                      </div>
                    ));
                  })()}
                </div>
             </div>
          </div>
        )}
      </div>

      <div className="ph-health-pulso">
        <FaClock /> <span>{lastActivityLabel}: <strong>{activityText}</strong></span>
      </div>

      <div className="ph-health-footer">
        {ctaUrl ? (
          <button type="button" className="ph-health-cta-link" onClick={handleCta}>
            {ctaLabel} &rarr;
          </button>
        ) : (
          <span className="ph-health-cta-mock">Ver detalle &rarr;</span>
        )}
      </div>
    </div>
  );
};

const ProjectHomePage = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { setCurrentProjectId, currentProjectId } = useProjectContext();

  const [searchParams, setSearchParams] = useSearchParams();
  const idProyecto = params.id_proyecto || params.idProyecto;
  const idPlantilla = searchParams.get("id_plantilla") || searchParams.get("idPlantilla");

  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [executiveData, setExecutiveData] = useState(null);

  const { can, user: authUser } = useAuth();
  const esAdminUser = authUser?.group_id === 1 || authUser?.tipo_usuario === 1;

  const effectiveProjectId = useMemo(() => {
    const id = Number(currentProjectId || idProyecto || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [currentProjectId, idProyecto]);

  const projectInfo = executiveData?.project || data?.project || {};
  const projectId = Number(projectInfo?.id || effectiveProjectId || idProyecto || 0);

  // Pure RBAC Logic: Strictly permissions-based
  const canSeeInformes = can("informes.read");
  const canSeeQuejas = can("quejas_reclamos.read");
  const canSeeExpedientes = can("expedientes.read");
  const canDIA = can("declaraciones.read");
  const canPGA = can("pga.read");
  const canResoluciones = can("resoluciones.read");
  const canRegencia = can("regencia.contratos.read") || can("regencia.actividades.read");
  const canEvaluaciones = can("evaluaciones.read");
  const canReportes = can("reportes.read");
  const canActasPreconstruccion = can("actas.create") || can("actas.update") || can("actas.generate");
  const canActasListado = can("actas.read");
  const canNDVI = can("use_change.read") || can("use_change.create");
  const canPOI = can("poi.read");
  const canConfigurePanel = can("proyectos.update") || esAdminUser;
  const canVerMapa = can("proyectos.read");
  const canTramos = can("tramos.read");
  const canMantenimiento = can("mantenimiento.import") || can("mantenimiento.create");
  const canCrearInforme = can("informes.create");
  const canViewProject = can("proyectos.read");
  const canDeleteProject = can("proyectos.delete");

  // Multi-Nature Hub: Show anything allowed
  const showLegalTools = canDIA || canPGA || canResoluciones;
  const showTerritorialTools = canPOI || canSeeExpedientes || canNDVI || canTramos;
  const showFollowUpTools = canRegencia || canEvaluaciones || canActasListado;
  const showReportsTools = canSeeInformes || canReportes;
  const showAdditionalTools =
    canTramos ||
    canActasListado ||
    canMantenimiento ||
    canCrearInforme ||
    canSeeExpedientes;
  const [error, setError] = useState("");
  const [activeTab, setActiveTabBase] = useState(searchParams.get("tab") || "resumen");
  const [showActionHub, setShowActionHub] = useState(false);
  
  const setActiveTab = useCallback((tab) => {
    setActiveTabBase(tab);
    setSearchParams(prev => {
      prev.set("tab", tab);
      return prev;
    }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

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
  const [pqrStats, setPqrStats] = useState(null);
  const childReqRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (!idProyecto) {
      setStatus("missing");
      setError("Falta seleccionar un proyecto");
      return undefined;
    }

    setStatus("loading");
    Promise.all([
      projectHomeApi.getProjectHomeResumen({
        id_proyecto: effectiveProjectId,
        id_plantilla: idPlantilla,
        skip_temporal: true,
      }),
      projectHomeApi.getProjectHomeExecutiveResumen({
        id_proyecto: effectiveProjectId
      }),
      canSeeQuejas ? fetch(`${window.location.origin}/api/quejas-reclamos/stats?id_proyecto=${effectiveProjectId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      }).then(r => r.json()).catch(() => null) : Promise.resolve(null)
    ])
      .then(([payload, execPayload, pqrPayload]) => {
        if (!active) return;
        if (!payload?.ok) {
          setStatus("empty");
          setError("No se encontraron datos");
          return;
        }
        setData(payload);
        setExecutiveData(execPayload);
        setPqrStats(pqrPayload);
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
  const catastroSummary = data?.catastro_summary || null;
  const activity = data?.activity || {};
  const plantillas = Array.isArray(data?.plantillas) ? data.plantillas : [];
  const fieldSummaries = Array.isArray(data?.field_summaries) ? data.field_summaries : [];
  const temporalSources = Array.isArray(data?.temporal_sources) ? data.temporal_sources : [];
  const focus = data?.focus || null;
  const plantillaFocus = data?.informes?.plantilla_focus || null;

  const catastroHomeCard = useMemo(() => {
    if (!catastroSummary) return null;

    const hero = catastroSummary.hero || {};
    const totalRelevados = Number(hero.total_relevados || 0);
    const totalTarget = Number(hero.total_target || 0);
    const coberturaPctRaw = Number(hero.cobertura_pct);
    const coberturaPct = Number.isFinite(coberturaPctRaw)
      ? coberturaPctRaw
      : (totalTarget > 0 ? (totalRelevados / totalTarget) * 100 : 0);
    const pendientesRaw = Number(hero.pendientes);
    const pendientes = Number.isFinite(pendientesRaw)
      ? pendientesRaw
      : Math.max(0, totalTarget - totalRelevados);

    const isHealthySummary =
      catastroSummary._error !== true &&
      catastroSummary._fallback !== true &&
      catastroSummary._forced !== true;

    if (!isHealthySummary) {
      return {
        totalGlobal: null,
        focoLabel: "Cobertura",
        foco: null,
        desglose: [],
        lastActivity: null,
      };
    }

    return {
      totalGlobal: totalRelevados,
      focoLabel: "Cobertura (%)",
      foco: Number(coberturaPct.toFixed(1)),
      desglose: [
        {
          label: "Pendientes",
          valor: pendientes,
          pct: totalTarget > 0 ? Math.round((pendientes / totalTarget) * 100) : 0,
        },
      ],
      lastActivity: hero.last_activity || null,
    };
  }, [catastroSummary]);

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
    ].filter(Boolean);
  }, [data, canSeeInformes, canSeeExpedientes, informeStats, expedienteStats, quejasStats, effectiveProjectId]);

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

  const goToTramosOrPoi = useCallback(async () => {
    if (!effectiveProjectId) return;

    try {
      const res = await fetch(`${API_URL}/tramos/proyectos/${effectiveProjectId}/tramos`, {
        headers: authHeader(),
      });
      if (!res.ok) {
        navigate(`/proyectos/${effectiveProjectId}/tramos`);
        return;
      }

      const data = await res.json();
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      navigate((arr.length > 0 && canTramos) ? `/proyectos/${effectiveProjectId}/tramos` : `/proyectos/${effectiveProjectId}/poi`);
    } catch {
      navigate(`/proyectos/${effectiveProjectId}/tramos`);
    }
  }, [canTramos, effectiveProjectId, navigate]);

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

    const { hero, operativa, economico, stats_estados, stats_dbi } = catastro;
    const lastActivityText = timeAgo(hero?.last_activity);

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
            <span>Última actividad: <strong>{lastActivityText}</strong></span>
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
                      <span className="ph-dot-separator">â€¢</span>
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
            { key: "informes", label: "Gestión Socioambiental" },
            { key: "expedientes", label: "Expedientes Catastrales" },
            { key: "quejas", label: "Quejas y Reclamos" },
          ].filter(t => (
            t.key === 'resumen' || 
            (t.key === 'informes' && canSeeInformes) || 
            (t.key === 'expedientes' && canSeeExpedientes) ||
            (t.key === 'quejas' && canSeeQuejas)
          )).map((tab) => (
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
        <div className="ph-header-actions">
          {canConfigurePanel && (
            <button 
              type="button" 
              className="ph-config-minimal-btn"
              onClick={() => setShowConfig(!showConfig)}
              title="Personalizar Vista"
            >
              <FaCog />
              <span className="ph-btn-label">Personalizar</span>
            </button>
          )}
          <button 
            type="button" 
            className="ph-hero-map-btn"
            onClick={() => navigate(`/visor-full/${effectiveProjectId}`)}
            title="Abrir Visor Geográfico"
          >
            <FaGlobeAmericas /> Ver Mapa
          </button>
          <button 
            type="button" 
            className="ph-action-hub-toggle"
            onClick={() => setShowActionHub(true)}
          >
            <FaTools /> Acciones
          </button>
        </div>
      </header>

      {showConfig && (
        <ProjectHomeConfigPanel
          projectId={idProyecto ? Number(idProyecto) : null}
          plantillaId={idPlantilla ? Number(idPlantilla) : null}
          fieldSummaries={fieldSummaries}
          temporalSources={temporalSources}
          plantillas={plantillas}
          onClose={() => setShowConfig(false)}
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
              {status === "loading" ? (
                <div className="ph-health-hub">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="ph-health-card ph-card-skeleton" style={{ height: '320px' }}></div>
                  ))}
                </div>
              ) : executiveData ? (
                <div className="ph-health-hub">
                  {canSeeInformes && executiveData.socioambiental && (
                    <ExecutiveHealthCard 
                      title="Gestión Socioambiental"
                      data={{
                        ...executiveData.socioambiental,
                        focoLabel: executiveData.socioambiental.focoLabel || "Indicador Principal",
                      }}
                      color="#3b82f6"
                      icon="Socioambiental"
                      onClick={() => setActiveTab("informes")}
                      ctaUrl={`/dashboardinformes?id_proyecto=${effectiveProjectId}`}
                      ctaLabel="Ver Gestión"
                      lastActivityLabel="Último informe"
                    />
                  )}

                  {canSeeExpedientes && catastroHomeCard && (
                    <ExecutiveHealthCard 
                      title="Catastro y Expedientes"
                      data={catastroHomeCard}
                      color="#22c55e"
                      icon="Expedientes"
                      onClick={() => setActiveTab("expedientes")}
                      ctaUrl={`/proyectos/${effectiveProjectId}/gv-catastro`}
                      ctaLabel="Ver Detalle"
                      lastActivityLabel="Última actividad"
                    />
                  )}

                  {canSeeQuejas && executiveData.quejas && (
                    <ExecutiveHealthCard 
                      title="Quejas y Reclamos"
                      data={{
                        ...executiveData.quejas,
                        focoLabel: "Pendientes",
                        foco: executiveData.quejas.foco
                      }}
                      color="#ef4444"
                      icon="PQR"
                      onClick={() => setActiveTab("quejas")}
                      ctaUrl={`/quejas-reclamos?id_proyecto=${effectiveProjectId}`}
                      ctaLabel="Gestión Operativa"
                      lastActivityLabel="Último reclamo"
                      stats={pqrStats}
                    />
                  )}

                </div>
              ) : (
                <div className="ph-status">No se pudo cargar el resumen ejecutivo.</div>
              )}
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

          {activeTab === "quejas" && (
            <div className="ph-quejas-public-layout px-4">
               {!canSeeQuejas && (
                <div className="ph-status ph-status-error">No tienes permisos para ver Quejas y Reclamos.</div>
              )}
              {canSeeQuejas && (
                <QuejasReclamos 
                  idProyectoExternal={effectiveProjectId} 
                  embedded={true} 
                />
              )}
            </div>
          )}

        </>
      )}

      {/* Right Action Hub Drawer with Intelligence & Glossary */}
      {showActionHub && (
        <div className="ph-drawer-overlay" onClick={() => setShowActionHub(false)}>
          <div className="ph-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <header className="ph-drawer-header">
              <div className="ph-drawer-title-stack">
                <span className="ph-drawer-title">Centro de Mando</span>
                <span className="ph-drawer-subtitle">{executiveData?.project?.nombre || "Proyecto"}</span>
              </div>
              <button className="ph-drawer-close" onClick={() => setShowActionHub(false)}>&times;</button>
            </header>
            <div className="ph-drawer-content">
              {/* Grupo Operación Territorial */}
              {(canVerMapa || canNDVI || canSeeExpedientes || canTramos || canPOI) && (
                <div className="ph-drawer-group">
                  <div className="ph-drawer-group-title">
                    <FaHardHat /> Operación Territorial
                  </div>
                  <div className="ph-drawer-grid">
                    {canVerMapa && (
                      <button className="ph-hub-btn ph-hub-btn--blue" onClick={() => navigate(`/visor-full/${effectiveProjectId}`)}>
                        <FaGlobeAmericas /> <span>Ver Mapa</span>
                      </button>
                    )}
                    {canNDVI && (
                      <button className="ph-hub-btn ph-hub-btn--green" onClick={() => navigate(`/proyectos/${effectiveProjectId}/analisis-ndvi`)}>
                        <FaChartLine /> <span>Análisis Cambio de Uso</span>
                      </button>
                    )}
                    {canSeeExpedientes && (
                      <button className="ph-hub-btn ph-hub-btn--blue" onClick={() => navigate(`/proyectos/${effectiveProjectId}/gv-catastro`)}>
                        <FaHardHat /> <span>Expedientes</span>
                      </button>
                    )}
                    {(canTramos || canPOI) && (
                      <button className="ph-hub-btn ph-hub-btn--yellow" onClick={goToTramosOrPoi}>
                        <FaMapMarked /> <span>Tramos/POI</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Grupo Gestión y Seguimiento */}
              {(canRegencia || canActasPreconstruccion || canActasListado) && (
                <div className="ph-drawer-group">
                  <div className="ph-drawer-group-title">
                    <FaBullhorn /> Gestión y Seguimiento
                  </div>
                  <div className="ph-drawer-grid">
                    {canRegencia && (
                      <button className="ph-hub-btn ph-hub-btn--indigo" onClick={() => navigate(`/proyectos/${effectiveProjectId}/regencia`)}>
                        <FaCheckCircle /> <span>Regencia</span>
                      </button>
                    )}
                    {canActasPreconstruccion && (
                      <button className="ph-hub-btn ph-hub-btn--teal" onClick={() => navigate(`/proyectos/${effectiveProjectId}/actas-preconstruccion`)}>
                        <FaCheckCircle /> <span>Actas de Preconstrucción</span>
                      </button>
                    )}
                    {canActasListado && (
                      <button className="ph-hub-btn ph-hub-btn--slate" onClick={() => navigate(`/proyectos/${effectiveProjectId}/actas`)}>
                        <FaFileAlt /> <span>Listado de Actas</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Grupo Informes */}
              {canSeeInformes && (
                <div className="ph-drawer-group">
                  <div className="ph-drawer-group-title">
                    <FaChartLine /> Gestión de Informes
                  </div>
                  <div className="ph-drawer-grid">
                    <button className="ph-hub-btn ph-hub-btn--slate" onClick={() => navigate(`/proyectos/${effectiveProjectId}/informes`)}>
                      <FaChartBar /> <span>Informes - Dashboard</span>
                    </button>
                    <button className="ph-hub-btn ph-hub-btn--slate" onClick={() => navigate(`/proyectos/${effectiveProjectId}/informes/lista`)}>
                      <FaFileAlt /> <span>Informes por proyecto</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Grupo Administración */}
              <div className="ph-drawer-group ph-drawer-group--bottom">
                <div className="ph-drawer-group-title">Administración</div>
                <div className="ph-drawer-grid">
                  {can("proyectos.read") && (
                    <button className="ph-hub-btn ph-hub-btn--slate" onClick={() => navigate(`/proyectos/${effectiveProjectId}/ver`)}>
                      <FaEye /> <span>Ver Proyecto</span>
                    </button>
                  )}
                  {canDeleteProject && (
                    <button className="ph-hub-btn ph-hub-btn--red" onClick={() => alert("Función protegida administrativamente.")}>
                      <FaTrashAlt /> <span>Eliminar</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectHomePage;


