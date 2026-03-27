import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { projectHomeApi } from "./projectHome.service";
import { useProjectContext } from "@/context/ProjectContext";
import { hasPerm, esAdmin } from "@/utils/auth";
import "./ProjectHomePage.css";
import ProjectHomeConfigPanel from "./ProjectHomeConfigPanel";
import ProjectHomeKpiChart from "./ProjectHomeKpiChart";

const EMPTY_VALUE = "—";

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
  const effectiveProjectId = currentProjectId || idProyecto;

  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("resumen");
  const [showConfig, setShowConfig] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    if (!idProyecto) {
      setStatus("missing");
      setError("Falta seleccionar un proyecto");
      return undefined;
    }

    setStatus("loading");
    projectHomeApi
      .getProjectHomeResumen({ id_proyecto: effectiveProjectId, id_plantilla: idPlantilla })
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

  const headerLabel = useMemo(() => {
    if (data?.general?.project_label) return data.general.project_label;
    return "Panel del proyecto";
  }, [data]);

  const informeStats = data?.general || {};
  const expedienteStats = data?.expedientes || {};
  const activity = data?.activity || {};
  const primaryKpi = data?.kpis?.primary || null;
  const secondaryKpis = Array.isArray(data?.kpis?.secondary) ? data.kpis.secondary : [];
  const configResolution = data?.config_resolution || {};
  const plantillaFocus = data?.informes?.plantilla_focus || null;
  const focus = data?.focus || null;
  const plantillas = Array.isArray(data?.plantillas) ? data.plantillas : [];
  const fieldSummaries = Array.isArray(data?.field_summaries) ? data.field_summaries : [];
  const temporalSources = Array.isArray(data?.temporal_sources) ? data.temporal_sources : [];

  const topPlantillas = useMemo(() => {
    const list = Array.isArray(plantillas) ? [...plantillas] : [];
    return list
      .sort(
        (a, b) =>
          (Number(b.total_informes) || 0) - (Number(a.total_informes) || 0)
      )
      .slice(0, 3);
  }, [plantillas]);
  const focusPlantillaId = focus?.id_plantilla;
  const totalInformes = Number(informeStats.total_informes) || 0;
  const totalConGeo = Number(informeStats.informes_con_geo) || 0;
  const totalSinGeo = Number(informeStats.informes_sin_geo) || 0;
  const porcentajeConGeo = totalInformes ? Math.round((totalConGeo / totalInformes) * 100) : 0;
  const maxPlantillaTotal = Math.max(
    ...topPlantillas.map((item) => Number(item.total_informes) || 0),
    1
  );

  const renderValue = (value) =>
    value === undefined || value === null || value === "" ? EMPTY_VALUE : value;

  const focusName = focus?.nombre || plantillaFocus?.nombre || "Sin plantilla";
  const isConfiguredMode = Boolean(configResolution.has_config);
  const modeLabel = isConfiguredMode ? "Configurado" : "Automatico";
  const primaryDefaultChartType = useMemo(() => {
    const count = Array.isArray(primaryKpi?.items) ? primaryKpi.items.length : 0;
    return count > 6 ? "bar" : "donut";
  }, [primaryKpi]);
  const getSecondaryDefaultChartType = (summary) => {
    const count = Array.isArray(summary?.items) ? summary.items.length : 0;
    if (count > 10) return "list";
    return "bar";
  };
  const timeGroupingLabel = (value) => {
    const v = String(value || "").toLowerCase();
    if (v === "day") return "Dia";
    if (v === "week") return "Semana";
    if (v === "month") return "Mes";
    return renderValue(value);
  };

  const visibleSecondaryKpis = secondaryKpis.slice(0, 2);
  const hasPrimaryKpi = Boolean(primaryKpi);
  const hasSecondaryKpis = visibleSecondaryKpis.length > 0;
  const kpiLayoutVariant = hasPrimaryKpi && hasSecondaryKpis
    ? "split"
    : hasPrimaryKpi
      ? "primary-only"
      : "secondary-only";

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
    />
    ) : null;

  const renderKpiLayout = () => {
    if (!hasPrimaryKpi && !hasSecondaryKpis) return null;
    return (
      <div
        className={`ph-kpi-home-layout ph-kpi-home-layout--resumen ph-kpi-home-layout--${kpiLayoutVariant}`}
      >
        {hasPrimaryKpi && (
          <div className="ph-kpi-home-primary">{renderPrimaryCard()}</div>
        )}
        {hasSecondaryKpis && (
          <div className="ph-kpi-home-secondary-stack">{renderSecondaryCards()}</div>
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
          ].map((tab) => (
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
          onSaved={() => {
            setShowConfig(false);
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
            <>
              <div className="ph-home-summary">
                <div className="ph-home-summary-row ph-home-summary-global">
                  <div className="ph-card ph-card--informes">
                    <div className="ph-card-title">Informes</div>
                    <div className="ph-card-value">
                      {(informeStats.total_informes || 0).toLocaleString()}
                    </div>
                    <div className="ph-card-meta">
                      <span>Con ubicación: {(informeStats.informes_con_geo || 0).toLocaleString()}</span>
                      <span>Sin ubicación: {(informeStats.informes_sin_geo || 0).toLocaleString()}</span>
                    </div>
                    {topPlantillas.length > 0 && (
                      <div className="ph-informes-plantillas">
                        <div className="ph-informes-plantillas-title">Plantillas (top {topPlantillas.length})</div>
                        <ul>
                          {topPlantillas.map((plantilla) => (
                            <li
                              key={plantilla.id_plantilla}
                              className={plantilla.id_plantilla === focusPlantillaId ? "ph-informes-plantilla--focus" : ""}
                            >
                              <span>{plantilla.nombre}</span>
                              <span>{(plantilla.total_informes || 0).toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {canSeeInformes && effectiveProjectId && (
                      <div className="ph-card-cta-group">
                        <button
                          className="ph-card-cta ph-card-cta--primary"
                          onClick={() => navigate(`/dashboardinformes?id_proyecto=${effectiveProjectId}`)}
                        >
                          Explorar analisis y mapas <span aria-hidden="true">&rarr;</span>
                        </button>
                        <span className="ph-card-cta-note">Analiza distribucion y mapas</span>
                      </div>
                    )}
                  </div>
                  <div className="ph-card ph-card--expedientes">
                    <div className="ph-card-title">Expedientes</div>
                    <div className="ph-card-value">
                      {(expedienteStats.total || 0).toLocaleString()}
                    </div>
                    <div className="ph-card-meta">
                      <span>Con avance: {(expedienteStats.con_avance || 0).toLocaleString()}</span>
                      <span>Sin avance: {(expedienteStats.sin_avance || 0).toLocaleString()}</span>
                    </div>
                    {canSeeExpedientes && effectiveProjectId && (
                      <div className="ph-card-cta-group">
                        <button
                          className="ph-card-cta ph-card-cta--primary"
                          onClick={() => navigate(`/proyectos/${effectiveProjectId}/expedientes`)}
                        >
                          Explorar expedientes y mapa <span aria-hidden="true">&rarr;</span>
                        </button>
                        <span className="ph-card-cta-note">Visualiza ubicacion y estado</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ph-home-summary-row ph-home-summary-operative">
                  <div className="ph-card ph-card--activity">
                    <div className="ph-card-title">Actividad del proyecto</div>
                    <div className="ph-card-value">
                      {Number(activity.period_total)
                        ? activity.period_total.toLocaleString()
                        : EMPTY_VALUE}
                    </div>
                    <div className="ph-activity-meta">
                      <span>
                        <strong>Rango:</strong> {`${renderValue(activity.range_from)} → ${renderValue(activity.range_to)}`}
                      </span>
                      <span>
                        <strong>Agrupación:</strong> {timeGroupingLabel(activity.time_grouping)}
                      </span>
                      <span>
                        <strong>Plantilla foco:</strong> {focusName}
                      </span>
                      <span>
                        <strong>Modo:</strong> {modeLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="ph-kpi-section">
                <div className="ph-card-title">Indicadores de la plantilla</div>
                {renderKpiLayout()}
              </div>
            </>
          )}

          {activeTab === "informes" && (
            <div className="ph-tab-informes-content">
              <div className="ph-informes-fullwidth">
                <div className="ph-informes-summary">
                  <div className="ph-card-title">Resumen de informes</div>
                  <div className="ph-informes-summary-metrics">
                    <div className="ph-informes-summary-metric">
                      <span>Total informes</span>
                      <strong>{totalInformes.toLocaleString()}</strong>
                    </div>
                    <div className="ph-informes-summary-metric">
                      <span>Con ubicación</span>
                      <strong>{totalConGeo.toLocaleString()}</strong>
                      <small>{porcentajeConGeo}%</small>
                    </div>
                    <div className="ph-informes-summary-metric">
                      <span>Sin ubicación</span>
                      <strong>{totalSinGeo.toLocaleString()}</strong>
                    </div>
                  </div>
                  {topPlantillas.length > 0 && (
                    <div className="ph-informes-summary-plantillas">
                      <div className="ph-informes-summary-plantillas-title">
                        Plantillas principales
                      </div>
                      <ul>
                        {topPlantillas.map((plantilla) => {
                          const cantidad = Number(plantilla.total_informes) || 0;
                          const width = Math.round((cantidad / maxPlantillaTotal) * 100);
                          const isFocus = Number(plantilla.id_plantilla) === Number(focusPlantillaId);
                          return (
                            <li
                              key={plantilla.id_plantilla}
                              className={`ph-informes-summary-item ${isFocus ? "ph-informes-summary-item--focus" : ""}`}
                            >
                              <div className="ph-informes-summary-item-label">
                                <span>{plantilla.nombre || `Plantilla ${plantilla.id_plantilla}`}</span>
                                <strong>{cantidad.toLocaleString()}</strong>
                              </div>
                              <div className="ph-informes-summary-bar">
                                <div
                                  className="ph-informes-summary-bar-fill"
                                  style={{ width: `${width}%` }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="ph-informes-context-row">
                  <div className="ph-card">
                    <div className="ph-card-title">Actividad del proyecto</div>
                    <div className="ph-card-value">
                      {Number(activity.period_total)
                        ? activity.period_total.toLocaleString()
                        : EMPTY_VALUE}
                    </div>
                    <div className="ph-card-meta ph-card-meta-column">
                      <span>{`Rango: ${renderValue(activity.range_from)} -> ${renderValue(activity.range_to)}`}</span>
                      <span className="ph-card-meta-muted">
                        {`Agrupacion: ${timeGroupingLabel(activity.time_grouping)}`}
                      </span>
                      <span>{`Indicadores desde: ${focusName}`}</span>
                    </div>
                  </div>
                  <div className="ph-card">
                    <div className="ph-card-title">Modo del panel</div>
                    <div className="ph-card-meta ph-card-meta-column">
                      <span>Modo: {modeLabel}</span>
                      <span>
                        {isConfiguredMode
                          ? "La plantilla principal fue definida manualmente."
                          : "La plantilla principal se elige automaticamente."}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="ph-kpi-section ph-kpi-section--informes">
                  <div className="ph-card-title">Indicadores de la plantilla</div>
                  {renderKpiLayout()}
                </div>
              </div>
            </div>
          )}

          {activeTab === "expedientes" && (
            <div className="ph-card-row">
              <div className="ph-card">
                <div className="ph-card-title">Total</div>
                <div className="ph-card-value">{(expedienteStats.total || 0).toLocaleString()}</div>
                <div className="ph-card-meta">
                  <span>Con ubicacion: {(expedienteStats.con_geo || 0).toLocaleString()}</span>
                  <span>Sin ubicacion: {(expedienteStats.sin_geo || 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="ph-card">
                <div className="ph-card-title">Avance</div>
                <div className="ph-card-value">
                  {(expedienteStats.con_avance || 0).toLocaleString()}
                </div>
                <div className="ph-card-meta">
                  <span>Sin avance: {(expedienteStats.sin_avance || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ProjectHomePage;
