// src/components/Notificaciones.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Dropdown, Badge, Spinner } from 'react-bootstrap';
import { FaBell } from 'react-icons/fa';
import Modal from './Modal';
import TodasLasNotificaciones from './TodasLasNotificaciones';
import PanelNotificaciones from './PanelNotificaciones';
import { alerts } from '@/utils/alerts';

const API_URL = import.meta.env.VITE_API_URL;

export default function Notificaciones() {
  const [recientes, setRecientes]         = useState([]);
  const [totalNoLeidas, setTotalNoLeidas] = useState(0);
  const [cargando, setCargando]           = useState(true);
  const [modalOpen, setModalOpen]         = useState(false);
  const intervalRef                       = useRef(null);

  // para evitar spam de toasts al primer load y deduplicar
  const firstLoadRef  = useRef(true);
  const seenIdsRef    = useRef(new Set());

  const user        = JSON.parse(localStorage.getItem('user') || '{}');
  const isCliente   = user.tipo_usuario === 9;
  const isConsultor = user.tipo_usuario === 8;

  const getVariant = (titulo) => {
    if (titulo?.startsWith?.('Resolución vencida'))  return 'warning';
    if (titulo?.startsWith?.('Resolución vence en')) return 'warning';
    if (/(creado|Nueva|agregado)/i.test(titulo))     return 'success';
    if (/actualizado/i.test(titulo))                 return 'info';
    if (/Carga/i.test(titulo))                       return 'primary';
    if (/subido/i.test(titulo))                      return 'success';
    if (/eliminada/i.test(titulo))                   return 'danger';
    return 'secondary';
  };
  const toneFromVariant = (v) =>
    v === 'danger' ? 'error' :
    v === 'warning' ? 'warn' :
    v === 'success' ? 'success' : 'info';

  const showIncomingToasts = (pendientes) => {
    const currentIds = new Set(pendientes.map(n => n.id_notificacion ?? n.id));
    if (firstLoadRef.current) {
      // no mostrar toasts históricos al primer fetch
      seenIdsRef.current = currentIds;
      firstLoadRef.current = false;
      return;
    }
    pendientes.forEach(n => {
      const id = n.id_notificacion ?? n.id;
      if (!seenIdsRef.current.has(id)) {
        const variant = getVariant(n.titulo || '');
        const tone = toneFromVariant(variant);
        const text = n.titulo ? `${n.titulo}: ${n.mensaje}` : n.mensaje;
        if (tone === 'success') alerts.toast.success(text);
        else if (tone === 'warn') alerts.toast.warn(text);
        else if (tone === 'error') alerts.toast.error(text);
        else alerts.toast.info(text);
      }
    });
    seenIdsRef.current = currentIds;
  };

  const cargarRecientes = async () => {
    if (document.visibilityState !== 'visible') return;

    setCargando(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const res = await fetch(`${API_URL}/notificaciones/recientes`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }

      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      setRecientes(arr);

      const pendientes = arr.filter(n =>
        isCliente
          ? !n.leido_usuario
          : isConsultor
            ? !n.leido_consultor
            : (!n.leido_usuario || !n.leido_consultor)
      );
      setTotalNoLeidas(pendientes.length);

      // 🔔 toasts para nuevas (no repetidas)
      showIncomingToasts(pendientes);
    } catch (err) {
      console.error('Error al cargar recientes:', err);
      alerts.toast.error('No se pudieron cargar las notificaciones.');
      setRecientes([]);
      setTotalNoLeidas(0);
    } finally {
      setCargando(false);
    }
  };

  const marcarLeidas = async (isOpen) => {
    // Solo cuando se abre el dropdown
    if (!isOpen || totalNoLeidas === 0) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/notificaciones/marcar-leidas`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTotalNoLeidas(0);
      alerts.toast.success('Notificaciones marcadas como leídas.');
    } catch (err) {
      console.error('Error al marcar leídas:', err);
      alerts.toast.error('No se pudieron marcar como leídas.');
    }
  };

  useEffect(() => {
    cargarRecientes();
    // refresco cada 60 min
    intervalRef.current = setInterval(cargarRecientes, 60 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, []); // eslint-disable-line

  return (
    <>
      <Dropdown onToggle={marcarLeidas}>
        <Dropdown.Toggle
          variant="link"
          className="text-white position-relative border-0"
          style={{ fontSize: '1.25rem' }}
        >
          <FaBell />
          {cargando ? (
            <Spinner animation="border" size="sm" className="ms-1" />
          ) : (
            totalNoLeidas > 0 && (
              <Badge
                bg="danger"
                pill
                className="position-absolute top-0 start-100 translate-middle"
              >
                {totalNoLeidas}
              </Badge>
            )
          )}
        </Dropdown.Toggle>

        <Dropdown.Menu style={{ width: 320 }}>
          <div>
            <PanelNotificaciones onViewAll={() => {
              setModalOpen(true);
            }} />
          </div>
        </Dropdown.Menu>
      </Dropdown>

      <Modal
        title="Todas las notificaciones"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <TodasLasNotificaciones />
      </Modal>
    </>
  );
}
