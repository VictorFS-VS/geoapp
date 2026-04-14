const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Limpiar el Componente ProjectHomeFeaturedReportCard
const oldComponentMatch = /const ProjectHomeFeaturedReportCard = \(\{ report, onClick \}\) => \{[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\};/;
const cleanComponent = `const ProjectHomeFeaturedReportCard = ({ report, onClick }) => {
  const primary = report?.primary || null;
  const secondary = Array.isArray(report?.secondary) ? report.secondary : [];

  return (
    <button 
      type="button"
      className="ph-card ph-card-compact ph-featured-card" 
      onClick={onClick}
    >
      <div className="ph-card-compact-header">
        <span className="ph-card-compact-title">{report?.label || "Reporte"}</span>
      </div>
      <div className="ph-card-compact-value ph-featured-primary-value">
        {primary ? renderNumeric(primary.value_numeric) : EMPTY_VALUE}
      </div>
      <div className="ph-card-compact-meta ph-featured-primary-meta" data-has-secondary={secondary.length > 0}>
        {primary?.label || "Sin indicador principal"}
      </div>
      {secondary.length > 0 && (
        <div className="ph-featured-secondary-stack">
          {secondary.slice(0, 2).map((s, idx) => (
            <div key={idx} className="ph-featured-secondary-item">
              <strong>{s.label}:</strong> {renderNumeric(s.value_numeric)}
            </div>
          ))}
        </div>
      )}
    </button>
  );
};`;

if (oldComponentMatch.test(content)) {
  content = content.replace(oldComponentMatch, cleanComponent);
}

// 2. Limpiar inline styles de las cards del header
content = content.replace(/className="ph-card-compact-value" style=\{\{marginBottom: "0\.25rem"\}\}/g, 'className="ph-card-compact-value"');

// 3. Limpiar inline styles del layout general
content = content.replace(/className="ph-kpi-section" style=\{\{ marginTop: '0\.5rem' \}\}/g, 'className="ph-kpi-section ph-kpi-section--featured"');
content = content.replace(/<div className="ph-card-title" style={{ marginBottom: '0\.25rem' }}>/g, '<div className="ph-card-title ph-card-title--featured">');

// 4. Limpiar inline styles de la grilla featured
content = content.replace(/className="ph-featured-grid" style=\{\{ display: 'grid', gridTemplateColumns: 'repeat\(auto-fit, minmax\(280px, 1fr\)\)', gap: '1rem' \}\}/g, 'className="ph-featured-grid"');

// 5. Limpiar placeholder inline styles
content = content.replace(/<div className="ph-indicadores-placeholder" style=\{\{[\s\S]*?\}\}>/g, '<div className="ph-indicadores-placeholder ph-indicadores-placeholder--empty">');
content = content.replace(/<div style=\{\{ fontWeight: 600, marginBottom: '0\.25rem' \}\}>/g, '<div className="ph-indicadores-title">');
content = content.replace(/<div style=\{\{ fontSize: '0\.85rem' \}\}>/g, '<div className="ph-indicadores-subtitle">');

fs.writeFileSync(path, content, 'utf8');
console.log('Cleanup Frontend JSX OK');
