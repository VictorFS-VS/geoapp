// src/components/Breadcrumbs.jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import './Breadcrumbs.css';

// Mapa de “slug” → etiqueta bonita (añade los que necesites)
const labelMap = {
  configuracion: 'Configuración',
  conceptos:     'Conceptos',
  usuarios:      'Usuarios',
  grupos:        'Grupos',
  'tipo-alertas':'Tipo Alertas',
  alertas:       'Alertas',
  actividades:   'Actividades',
  proyectos:     'Proyectos',
  '':            'Inicio'
};

export default function Breadcrumbs() {
  const { pathname } = useLocation();
  // dividimos y filtramos "/", p.ej. ["configuracion","usuarios"]
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav className="breadcrumbs">
      {/* Siempre mostramos Inicio */}
      <span className="bc-item">{labelMap['']}</span>
      {segments.map((seg, idx) => {
        const label = labelMap[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
        return (
          <React.Fragment key={idx}>
            <span className="bc-sep">/</span>
            <span className="bc-item">{label}</span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
