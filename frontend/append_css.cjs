const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\frontend\\src\\modules\\projectHome\\ProjectHomePage.css';
let content = fs.readFileSync(path, 'utf8');

const cssToAppend = `

/* ===== Ejecutive Layout - Resumen Fase 1 ===== */
.ph-home-header-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

@media (max-width: 1100px) {
  .ph-home-header-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 650px) {
  .ph-home-header-grid {
    grid-template-columns: 1fr;
  }
}

.ph-card-compact {
  padding: 1.15rem;
  border-radius: 0.9rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.ph-card-compact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.65rem;
}

.ph-card-compact-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.ph-card-compact-cta {
  font-size: 0.75rem;
  color: #3b82f6;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  font-weight: 700;
  transition: opacity 0.2s;
}

.ph-card-compact-cta:hover {
  text-decoration: underline;
  opacity: 0.8;
}

.ph-card-compact-value {
  font-size: 1.7rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.1;
}

.ph-card-compact-meta {
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 0.3rem;
}

.ph-indicadores-placeholder {
  padding: 3rem;
  border-radius: 1rem;
  border: 2px dashed #e2e8f0;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #64748b;
}
`;

fs.writeFileSync(path, content + cssToAppend, 'utf8');
console.log("Appended successfully.");
