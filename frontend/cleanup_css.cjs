const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.css';
let content = fs.readFileSync(path, 'utf8');

const cssToAppend = `

/* ===== Ejecutive Layout - Pulido Fase 4 ===== */
.ph-card-compact {
  height: 100%;
}

.ph-card-compact-value {
  margin-bottom: 0.25rem;
}

.ph-kpi-section--featured {
  margin-top: 1rem;
}

.ph-card-title--featured {
  margin-bottom: 0.5rem;
}

/* Grilla Featured */
.ph-featured-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

/* Card Interactiva */
button.ph-featured-card {
  text-align: left;
  border: 1px solid #e2e8f0;
  background-color: #ffffff;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  height: 100%;
}

button.ph-featured-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border-color: #cbd5e1;
}

.ph-featured-primary-value {
  margin-top: 0.5rem;
}

.ph-featured-primary-meta {
  margin-bottom: 0;
}

.ph-featured-primary-meta[data-has-secondary="true"] {
  margin-bottom: 0.75rem;
}

.ph-featured-secondary-stack {
  border-top: 1px dashed #e2e8f0;
  padding-top: 0.75rem;
  margin-top: auto; /* Empuja el stack al fondo si la card crece */
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: #64748b;
}

.ph-featured-secondary-item strong {
  color: #475569;
  font-weight: 600;
}

/* Placeholder Featured */
.ph-indicadores-placeholder--empty {
  padding: 3rem;
  text-align: center;
  background-color: #f8fafc;
  border-radius: 0.75rem;
  border: 2px dashed #e2e8f0;
  color: #64748b;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.ph-indicadores-title {
  font-weight: 600;
  color: #475569;
  margin-bottom: 0.35rem;
  font-size: 0.95rem;
}

.ph-indicadores-subtitle {
  font-size: 0.85rem;
}
`;

fs.writeFileSync(path, content + cssToAppend, 'utf8');
console.log('Cleanup CSS OK');
