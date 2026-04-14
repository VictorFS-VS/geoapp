const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Inyectar componente
const componentToInject = `
const ProjectHomeFeaturedReportCard = ({ report, onClick }) => {
  const primary = report.primary;
  const secondary = report.secondary || [];

  return (
    <div 
      className="ph-card ph-card-compact ph-featured-card" 
      onClick={onClick} 
      style={{ cursor: 'pointer', transition: 'all 0.2s' }}
      onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'; }}
      onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div className="ph-card-compact-header">
        <span className="ph-card-compact-title">{report.label}</span>
      </div>
      <div className="ph-card-compact-value" style={{marginBottom: "0.25rem", marginTop: "0.5rem"}}>
        {primary ? renderNumeric(primary.value_numeric) : EMPTY_VALUE}
      </div>
      <div className="ph-card-compact-meta" style={{marginBottom: secondary.length ? "0.75rem" : "0"}}>
        {primary?.label || "Sin indicador principal"}
      </div>
      {secondary.length > 0 && (
        <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: "0.5rem", marginTop: "0.5rem", display: "flex", gap: "1rem", fontSize: "0.75rem", color: "#64748b" }}>
          {secondary.slice(0, 2).map((s, idx) => (
            <div key={idx}>
              <strong>{s.label}:</strong> {renderNumeric(s.value_numeric)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
`;

if (!content.includes('ProjectHomeFeaturedReportCard')) {
  // Replace just before const ProjectHomeInformesResumen = ...
  content = content.replace(
    /const ProjectHomeInformesResumen = \(\{ payload \}\) => \{/,
    `${componentToInject}\n$&`
  );
}

// 2. Reemplazar la grilla placeholder en resumen
const placeholderRegex = /<div className="ph-indicadores-placeholder">[\s\S]*?<\/div>\s*<\/div>/;
const replacement = `{data?.featured_reports && data.featured_reports.length > 0 ? (
                  <div className="ph-featured-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
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
                ) : (
                  <div className="ph-indicadores-placeholder" style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '0.5rem', color: '#64748b' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Próximamente</div>
                    <div style={{ fontSize: '0.85rem' }}>Añade o configura informes destacados para visualizarlos aquí.</div>
                  </div>
                )}
              </div>`;

if(placeholderRegex.test(content)) {
  content = content.replace(placeholderRegex, replacement);
  console.log('Replaced placeholder with featured grid.');
} else {
  console.log('Could not find placeholder to replace.');
}

fs.writeFileSync(path, content, 'utf8');
