const fs = require('fs');

const oldPath = 'c:\\geoapp\\geoapp\\frontend\\ProjectHomePage_old_fixed.jsx';
const oldContent = fs.readFileSync(oldPath, 'utf8');

// We need to build ProjectHomeInformesResumen
let newComponent = `const ProjectHomeInformesResumen = ({ payload }) => {
  const EMPTY_VALUE = "—";
  const renderValue = (value) => value === undefined || value === null || value === "" ? EMPTY_VALUE : value;
  
  const informeStats = payload?.general || {};
  const activity = payload?.activity || {};
  const configResolution = payload?.config_resolution || {};
  const plantillaFocus = payload?.informes?.plantilla_focus || null;
  const focus = payload?.focus || null;
  const plantillas = Array.isArray(payload?.plantillas) ? payload.plantillas : [];

  const topPlantillas = [...plantillas]
    .sort((a, b) => (Number(b.total_informes) || 0) - (Number(a.total_informes) || 0))
    .slice(0, 3);

  const focusPlantillaId = focus?.id_plantilla;
  const focusName = focus?.nombre || plantillaFocus?.nombre || "Sin plantilla";
  const isConfiguredMode = Boolean(configResolution.has_config);
  const modeLabel = isConfiguredMode ? "Configurado" : "Automatico";

  const totalInformes = Number(informeStats.total_informes) || 0;
  const totalConGeo = Number(informeStats.informes_con_geo) || 0;
  const totalSinGeo = Number(informeStats.informes_sin_geo) || 0;
  const porcentajeConGeo = totalInformes ? Math.round((totalConGeo / totalInformes) * 100) : 0;
  const maxPlantillaTotal = Math.max(...topPlantillas.map(item => Number(item.total_informes) || 0), 1);

  const primaryKpi = payload?.kpis?.primary || null;
  const secondaryKpis = Array.isArray(payload?.kpis?.secondary) ? payload.kpis.secondary : [];

  const primaryDefaultChartType = Array.isArray(primaryKpi?.items) && primaryKpi.items.length > 6 ? "bar" : "donut";
  const getSecondaryDefaultChartType = (summary) => Array.isArray(summary?.items) && summary.items.length > 10 ? "list" : "bar";

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
        key={summary.id_pregunta || summary.etiqueta || \`secondary-\${index}\`}
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
        className={\`ph-kpi-home-layout ph-kpi-home-layout--resumen ph-kpi-home-layout--\${kpiLayoutVariant}\`}
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
                      className={\`ph-informes-summary-item \${isFocus ? "ph-informes-summary-item--focus" : ""}\`}
                    >
                      <div className="ph-informes-summary-item-label">
                        <span>{plantilla.nombre || \`Plantilla \${plantilla.id_plantilla}\`}</span>
                        <strong>{cantidad.toLocaleString()}</strong>
                      </div>
                      <div className="ph-informes-summary-bar">
                        <div
                          className="ph-informes-summary-bar-fill"
                          style={{ width: \`\${width}%\` }}
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
              <span>{\`Rango: \${renderValue(activity.range_from)} -> \${renderValue(activity.range_to)}\`}</span>
              <span className="ph-card-meta-muted">
                {\`Agrupacion: \${timeGroupingLabel(activity.time_grouping)}\`}
              </span>
              <span>{\`Indicadores desde: \${focusName}\`}</span>
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
  );
};
`;

const destPath = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let targetContent = fs.readFileSync(destPath, 'utf8');

targetContent = targetContent.replace('const ProjectHomePage = () => {', newComponent + '\\n\\nconst ProjectHomePage = () => {');

fs.writeFileSync(destPath, targetContent, 'utf8');
console.log("Restored ProjectHomeInformesResumen successfully");
