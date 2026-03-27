import { useEffect, useMemo, useState } from "react";

const CHART_TYPES = [
  { key: "donut", label: "Dona" },
  { key: "bar", label: "Barras" },
  { key: "list", label: "Lista" },
];

const COLOR_PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#8b5cf6",
  "#fb923c",
  "#3b82f6",
  "#22c55e",
  "#64748b",
];

const EMPTY_VALUE = "—";

const getItemColor = (index, hex, isOther) => {
  if (hex) return hex;
  if (isOther) return "#94a3b8";
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
};

const normalizeItems = (rawItems) =>
  (Array.isArray(rawItems) ? rawItems : [])
    .map((item, idx) => ({
      label: String(item?.label ?? "").trim() || "(sin valor)",
      count: Math.max(0, Number(item?.count || 0)),
      color_hex: item?.color_hex || "",
      _idx: idx,
    }))
    .filter((item) => item.label);

const limitItems = (items, maxItems) => {
  if (!maxItems || items.length <= maxItems) return items;
  const head = items.slice(0, maxItems - 1);
  const rest = items.slice(maxItems - 1);
  const restCount = rest.reduce((acc, it) => acc + (it.count || 0), 0);
  if (restCount <= 0) return head;
  return [
    ...head,
    {
      label: "Otros",
      count: restCount,
      color_hex: "",
      isOther: true,
    },
  ];
};

const polarToCartesian = (cx, cy, radius, angleInDegrees) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
};

const describeArc = (cx, cy, radius, startAngle, endAngle) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

const buildTechnicalLabel = (summary) => {
  const parts = [];
  const preguntaCode =
    summary?.pregunta_codigo ||
    summary?.codigo_pregunta ||
    summary?.pregunta_code ||
    summary?.pregunta;
  const variableCode =
    summary?.variable_codigo ||
    summary?.codigo_variable ||
    summary?.variable_code ||
    summary?.variable;

  if (preguntaCode) parts.push(String(preguntaCode).trim());
  if (variableCode) parts.push(String(variableCode).trim());
  if (summary?.id_pregunta) parts.push(`ID ${summary.id_pregunta}`);

  return parts.filter(Boolean).join(" | ");
};

const ProjectHomeKpiChart = ({
  summary,
  defaultType = "donut",
  compact = false,
  emptyLabel = "Sin indicador disponible",
  variant = "default",
}) => {
  const [chartType, setChartType] = useState(defaultType);

  useEffect(() => {
    setChartType(defaultType);
  }, [defaultType, summary?.id_pregunta]);

  const normalizedItems = useMemo(() => normalizeItems(summary?.items), [summary?.items]);
  const limitedItems = useMemo(() => {
    const maxItems = compact ? 6 : 8;
    return limitItems(normalizedItems, maxItems);
  }, [normalizedItems, compact]);
  const total = useMemo(
    () => limitedItems.reduce((acc, item) => acc + (item.count || 0), 0),
    [limitedItems]
  );
  const technicalLabel = useMemo(() => buildTechnicalLabel(summary), [summary]);
  const baseLabel = "Base del indicador";

  if (!summary) {
    return (
      <div className="ph-card kpi-card">
        <div className="ph-kpi-empty">{emptyLabel}</div>
      </div>
    );
  }

  if (limitedItems.length === 0) {
    return (
      <div className="ph-card kpi-card">
        <div className="ph-kpi-header">
          <div className="ph-kpi-header-main">
            <div className="ph-kpi-title">{summary.etiqueta}</div>
            {technicalLabel ? (
              <div className="ph-kpi-subtitle">{technicalLabel}</div>
            ) : null}
          </div>
        </div>
        <div className="ph-kpi-empty">Sin datos para este indicador</div>
      </div>
    );
  }

  const renderSelector = () => (
    <div className="ph-kpi-selector">
      {CHART_TYPES.map((type) => (
        <button
          key={type.key}
          type="button"
          className={`ph-kpi-selector-btn ${chartType === type.key ? "active" : ""}`}
          onClick={() => setChartType(type.key)}
        >
          {type.label}
        </button>
      ))}
    </div>
  );

  const renderDonut = () => {
    const donutItems = limitItems(limitedItems, compact ? 5 : 6);
    const totalValue =
      donutItems.reduce((acc, item) => acc + (item.count || 0), 0) || 1;
    let acc = 0;
    const segments = donutItems.map((item, idx) => {
      const pct = (item.count || 0) / totalValue;
      const start = acc;
      acc += pct;
      return {
        ...item,
        startAngle: start * 360,
        endAngle: acc * 360,
        color: getItemColor(idx, item.color_hex, item.isOther),
      };
    });

    const legendSegments = variant === "secondary" ? segments.slice(0, 2) : segments;
    const legendOverflow = variant === "secondary" ? segments.length - legendSegments.length : 0;

    const legendRows = legendSegments.map((segment, idx) => {
      const pct = totalValue > 0 ? ((segment.count / totalValue) * 100).toFixed(1) : "0.0";
      return (
        <div
          key={`donut-legend-${idx}`}
          className={`ph-kpi-legend-row ${variant === "secondary" ? "ph-kpi-legend-row--compact" : ""}`}
        >
          <span
            className="ph-kpi-legend-swatch"
            style={{ background: segment.color }}
          />
          <span className="ph-kpi-legend-label">{segment.label}</span>
          <span className="ph-kpi-legend-value">
            {segment.count.toLocaleString()} ({pct}%)
          </span>
        </div>
      );
    });

    const overflowRow =
      variant === "secondary" && legendOverflow > 0 ? (
        <div className="ph-kpi-legend-row ph-kpi-legend-row--compact ph-kpi-legend-row--overflow">
          <span className="ph-kpi-legend-label">{`+${legendOverflow} más`}</span>
        </div>
      ) : null;

    return (
      <>
        <div
          className={`ph-kpi-donut-chart ph-kpi-v2-chart ph-kpi-v2-chart--donut ph-kpi-donut-chart--${variant}`}
          title={`Total: ${totalValue}`}
        >
          <svg width="110" height="110" viewBox="0 0 110 110">
            {segments.map((segment, idx) => (
              <path
                key={`donut-${idx}`}
                d={describeArc(55, 55, 55, segment.startAngle, segment.endAngle)}
                fill={segment.color}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            ))}
          </svg>
        </div>
        <div className={`ph-kpi-legend ph-kpi-donut-legend--${variant}`}>
          {legendRows}
          {overflowRow}
        </div>
      </>
    );
  };

  const renderBars = () => {
    const maxValue = Math.max(...limitedItems.map((item) => item.count || 0), 1);
    return (
      <div className="ph-kpi-bars">
        {limitedItems.map((item, idx) => {
          const pct = total > 0 ? ((item.count / total) * 100).toFixed(0) : "0";
          const widthPct = Math.max(6, Math.min(100, (item.count / maxValue) * 100));
          const color = getItemColor(idx, item.color_hex, item.isOther);
          return (
            <div key={`bar-${idx}`} className="ph-kpi-bar-row">
              <div className="ph-kpi-bar-label">
                <span>{item.label}</span>
                <span className="ph-kpi-bar-count">
                  {item.count.toLocaleString()} ({pct}%)
                </span>
              </div>
              <div className="ph-kpi-bar-track">
                <div
                  className="ph-kpi-bar-fill"
                  style={{ width: `${widthPct}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderList = () => (
    <ul className="ph-kpi-list">
      {limitedItems.map((item, idx) => {
        const pct = total > 0 ? ((item.count / total) * 100).toFixed(0) : "0";
        return (
          <li key={`list-${idx}`}>
            <span className="ph-kpi-list-label">{item.label}</span>
            <span className="ph-kpi-list-value">
              {item.count.toLocaleString()} ({pct}%)
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
      <div
        className={`ph-card kpi-card ${compact ? "kpi-compact" : ""} ph-kpi-card--${variant}`}
      >
      <header className="ph-kpi-v2-header">
        <div className="ph-kpi-v2-header-row ph-kpi-v2-header-row--title">
          <div className="ph-kpi-title">{summary.etiqueta}</div>
          {technicalLabel ? (
            <div className="ph-kpi-subtitle ph-kpi-v2-subtitle">{technicalLabel}</div>
          ) : null}
        </div>
        <div className="ph-kpi-v2-header-row ph-kpi-v2-header-row--metrics">
          <div className="ph-kpi-total-block">
            <span className="ph-kpi-total-label">{baseLabel}</span>
            <strong className="ph-kpi-total-value">
              {total ? total.toLocaleString() : EMPTY_VALUE}
            </strong>
          </div>
          <div className="ph-kpi-v2-selector-row">
            <span className="ph-kpi-selector-label">Ver como</span>
            {renderSelector()}
          </div>
        </div>
      </header>
      <section className={`ph-kpi-v2-body ph-kpi-v2-body--${chartType} ${compact ? "compact" : ""}`}>
        {chartType === "donut" && renderDonut()}
        {chartType === "bar" && (
          <div className="ph-kpi-v2-chart ph-kpi-v2-chart--full">{renderBars()}</div>
        )}
        {chartType === "list" && (
          <div className="ph-kpi-v2-chart ph-kpi-v2-chart--full">{renderList()}</div>
        )}
      </section>
    </div>
  );
};

export default ProjectHomeKpiChart;
