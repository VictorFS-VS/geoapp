// src/components/Layout.jsx
import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import '../styles/Layout.css';
import AutoLogout from '../AutoLogout';

export default function Layout() {
  const location = useLocation();

  // ✅ visor full
  const isVisorFull = location.pathname.startsWith('/visor-full/');

  // 👉 Estado inicial colapsado si el ancho es menor a 768px
  const [collapsed, setCollapsed] = useState(window.innerWidth < 768);

  const toggleSidebar = () => {
    setCollapsed(prev => !prev);
  };

  // (Opcional) Actualiza colapsado al cambiar tamaño
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className={`layout ${collapsed ? 'collapsed' : ''}`}>
      <AutoLogout />
      <Navbar toggleSidebar={toggleSidebar} collapsed={collapsed} />

      {/* ✅ Ocultar sidebar en visor full */}
      {!isVisorFull && <Sidebar collapsed={collapsed} toggleSidebar={toggleSidebar} />}

      <div className={`main-content ${isVisorFull ? 'visor-activo' : ''}`}>
        {/* ✅ Ocultar breadcrumbs en visor full */}
        {!isVisorFull && <Breadcrumbs />}

        <main className="content">
          <Outlet context={{ toggleSidebar }} />
        </main>
      </div>
    </div>
  );
}
