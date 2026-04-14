const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /const ProjectHomeFeaturedReportCard = \(\{ report, onClick \}\) => \{[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\};/;

const newComponent = `const cleanTechnicalLabel = (str) => {
  if (!str) return "";
  let clean = str;
  clean = clean.replace(/^P\\d+\\s*-\\s*/i, "");
  clean = clean.replace(/^\\[V\\d+\\]\\s*/i, "");
  clean = clean.replace(/^Predomina( en|:)?\\s*/i, "");
  return clean.trim();
};

const ProjectHomeFeaturedReportCard = ({ report, onClick }) => {
  const value = report?.primary_val;
  let title = report?.label || "Resumen ejecutivo";
  if (/^(Informe|Reporte)\\s*\\d*$/i.test(title)) {
    title = "Indicadores principales";
  }

  const rawPrimaryLabel = cleanTechnicalLabel(report?.primary_label) || "Sin datos";
  let contextNode = null;
  let fieldName = "";

  if (report?.primary_context) {
    const ctx = report.primary_context;
    const pctMatch = ctx.match(/\\((\\d+%)\\)/);
    const pct = pctMatch ? pctMatch[1] : "";

    const fieldMatch = ctx.match(/^Predomina en (.*?)\\s*(?:\\(|$)/);
    if (fieldMatch) {
      fieldName = cleanTechnicalLabel(fieldMatch[1]);
    }
    
    if (pct) {
      contextNode = \`\${pct} del total\`;
    } else if (ctx === "Sin KPI configurado") {
      // Ocultar contexto tecnico
      contextNode = "";
    } else {
      contextNode = cleanTechnicalLabel(ctx);
    }
  }

  const finalLabel = fieldName ? \`\${fieldName}: \${rawPrimaryLabel}\` : rawPrimaryLabel;
  const secondary = Array.isArray(report?.secondary_lines) ? report.secondary_lines : [];

  return (
    <button 
      type="button"
      className="ph-card ph-card-compact ph-featured-card" 
      onClick={onClick}
    >
      <div className="ph-card-compact-header">
        <span className="ph-card-compact-title">{title}</span>
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
                <strong>{secLabel} dominante:</strong> {secMeta} <span style={{ opacity: 0.8 }}>({renderNumeric(s.val)})</span>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
};`;

if (regex.test(content)) {
  content = content.replace(regex, newComponent);
  fs.writeFileSync(path, content, 'utf8');
  console.log("UX Card refined");
} else {
  console.log("Card component not found");
}
