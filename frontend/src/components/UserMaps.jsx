// src/components/UserMaps.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { GROUPS, getTipoUsuario } from '@/utils/auth';

const isAllowedFor12 = (pathname) => {
  const allow = [
    /^\/dashboardtramos\/?$/,
    /^\/visor-tramo\/\d+\/?$/,
    /^\/proyectos\/\d+\/tramos\/?$/,
    /^\/encuestas\/\d+\/\d+\/?$/,
    /^\/proyecto\/\d+\/encuestas\/?$/,
    /^\/poi\/\d+\/\d+\/?$/,
  ];
  return allow.some((re) => re.test(pathname));
};

export default function UserMaps({ children }) {
  const loc = useLocation();
  const tipo = getTipoUsuario();

  if (tipo === GROUPS.CLIENTE_MAPS && !isAllowedFor12(loc.pathname)) {
    const lastTramoId = localStorage.getItem('last_tramo_id');
    return (
      <Navigate
        to={lastTramoId ? `/visor-tramo/${lastTramoId}` : '/dashboardtramos'}
        replace
      />
    );
  }

  return children;
}
