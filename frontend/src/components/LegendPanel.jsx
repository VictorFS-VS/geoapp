// src/components/LegendPanel.jsx
import React from 'react';
import '@/styles/LegendPanel.css';

export default function LegendPanel({ title = 'Leyenda', sections = [] }) {
  // si no hay items en ninguna sección, no renderizar
  const hasAny = sections.some(s => (s.items?.length ?? 0) > 0);
  if (!hasAny) return null;

  return (
    <div className="legendpanel-root">
      <div className="legendpanel-title">{title}</div>

      {sections.map((sec, idx) => {
        const items = sec.items || [];
        if (!items.length) return null;

        return (
          <div key={idx} className="legendpanel-section">
            <div className="legendpanel-subtitle">{sec.subtitle}</div>
            <ul className="legendpanel-list">
              {items.map((it, i) => (
                <li className="legendpanel-item" key={`${idx}-${i}`}>
                  <span
                    className={`legendpanel-chip ${it.shape === 'circle' ? 'circle' : ''}`}
                    style={{ background: it.color }}
                    aria-hidden
                  />
                  <span className="legendpanel-label">{it.label}</span>
                </li>
              ))}
            </ul>
            {idx < sections.length - 1 && <hr className="legendpanel-divider" />}
          </div>
        );
      })}
    </div>
  );
}
