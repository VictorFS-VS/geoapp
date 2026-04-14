const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /{activeTab === "resumen" && \(\s*<>\s*<div className="ph-home-summary">[\s\S]*?<ProjectHomeKpiLayout kpis={data\?\.kpis} \/>\s*<\/div>\s*<\/>\s*\)}/;

const replacement = `{activeTab === "resumen" && (
            <div className="ph-home-summary">
              <div className="ph-home-header-grid">
                
                <div className="ph-card ph-card-compact">
                  <div className="ph-card-compact-header">
                    <span className="ph-card-compact-title">Proyecto</span>
                  </div>
                  <div className="ph-card-compact-value" style={{marginBottom: "0.25rem"}}>
                    Activo
                  </div>
                  <div className="ph-card-compact-meta">
                    Visión consolidada
                  </div>
                </div>

                <div className="ph-card ph-card-compact">
                  <div className="ph-card-compact-header">
                    <span className="ph-card-compact-title">Informes</span>
                    {canSeeInformes && effectiveProjectId && (
                      <button 
                        type="button" 
                        className="ph-card-compact-cta"
                        onClick={() => navigate(\`/dashboardinformes?id_proyecto=\${effectiveProjectId}\`)}
                      >
                        Ver dashboard &rarr;
                      </button>
                    )}
                  </div>
                  <div className="ph-card-compact-value" style={{marginBottom: "0.25rem"}}>
                    {(informeStats.total_informes || 0).toLocaleString()}
                  </div>
                  <div className="ph-card-compact-meta">
                    Registrados en total
                  </div>
                </div>

                <div className="ph-card ph-card-compact">
                  <div className="ph-card-compact-header">
                    <span className="ph-card-compact-title">Catastro / Puntos</span>
                    {canSeeExpedientes && effectiveProjectId && (
                      <button 
                        type="button" 
                        className="ph-card-compact-cta"
                        onClick={() => navigate(\`/proyectos/\${effectiveProjectId}/expedientes\`)}
                      >
                        Ver mapa &rarr;
                      </button>
                    )}
                  </div>
                  <div className="ph-card-compact-value" style={{marginBottom: "0.25rem"}}>
                    {(expedienteStats.total || 0).toLocaleString()}
                  </div>
                  <div className="ph-card-compact-meta">
                    {expedienteStats.con_avance > 0 ? \`\${expedienteStats.con_avance} con avance registrado\` : "Total general"}
                  </div>
                </div>

                <div className="ph-card ph-card-compact">
                  <div className="ph-card-compact-header">
                    <span className="ph-card-compact-title">Quejas / Reclamos</span>
                  </div>
                  <div className="ph-card-compact-value" style={{marginBottom: "0.25rem"}}>
                    —
                  </div>
                  <div className="ph-card-compact-meta">
                    Próximamente disponible
                  </div>
                </div>

              </div>

              <div className="ph-kpi-section" style={{ marginTop: '0.5rem' }}>
                <div className="ph-card-title" style={{ marginBottom: '0.25rem' }}>Indicadores Destacados</div>
                <div className="ph-indicadores-placeholder">
                  <div style={{ fontWeight: 600, color: '#475569', marginBottom: '0.25rem' }}>Próximamente</div>
                  <div style={{ fontSize: '0.85rem' }}>Las tarjetas de rendimiento de los informes aparecerán aquí en modo lectura rápida.</div>
                </div>
              </div>
            </div>
          )}`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log("Replaced successfully.");
} else {
    console.log("Could not find regex match.");
}
