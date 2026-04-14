const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Inyectar quejasStats
content = content.replace(
  /const expedienteStats = data\?.expedientes \|\| \{\};/,
  `$&
  const quejasStats = data?.quejas || {};`
);

// 2. Reemplazar la card de quejas
const quejasRegex = /<div className="ph-card ph-card-compact">\s*<div className="ph-card-compact-header">\s*<span className="ph-card-compact-title">Quejas \/ Reclamos<\/span>[\s\S]*?sin actividad[\s\S]*?<\/div>\s*<\/div>/i;

// Si por alguna razón está como "Próximamente", buscamos genérico:
const fallbackRegex = /<div className="ph-card ph-card-compact">\s*<div className="ph-card-compact-header">\s*<span className="ph-card-compact-title">Quejas \/ Reclamos<\/span>[\s\S]*?<\/div>[\s\S]*?<\/div>\s*<\/div>/i;

const replacement = `<div className="ph-card ph-card-compact">
                  <div className="ph-card-compact-header">
                    <span className="ph-card-compact-title">Quejas / Reclamos</span>
                    {effectiveProjectId && (
                      <button 
                        type="button" 
                        className="ph-card-compact-cta"
                        onClick={() => navigate(\`/quejas-reclamos?id_proyecto=\${effectiveProjectId}\`)}
                      >
                        Ir a módulo &rarr;
                      </button>
                    )}
                  </div>
                  <div className="ph-card-compact-value" style={{marginBottom: "0.25rem"}}>
                    {(quejasStats.total || 0).toLocaleString()}
                  </div>
                  <div className="ph-card-compact-meta">
                    {quejasStats.pendientes > 0 ? \`\${quejasStats.pendientes} pendientes de resolución\` : quejasStats.total === 0 ? "Sin actividad" : "Todas resueltas"}
                  </div>
                </div>`;

if(quejasRegex.test(content)) {
  content = content.replace(quejasRegex, replacement);
  console.log('Replaced quejas card.');
} else if (fallbackRegex.test(content)) {
  content = content.replace(fallbackRegex, replacement);
  console.log('Replaced quejas card (fallback regex).');
} else {
  console.log('Could not find Quejas card to replace.');
}

fs.writeFileSync(path, content, 'utf8');
