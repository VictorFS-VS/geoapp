// src/components/TodasLasNotificaciones.jsx
import React, { useEffect, useState } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { alerts } from '@/utils/alerts';

const API_URL = import.meta.env.VITE_API_URL;

export default function TodasLasNotificaciones() {
  const [notificaciones, setNotificaciones] = useState(null);
  const [error, setError]                   = useState(null);

  useEffect(() => {
    const cargar = async () => {
      try {
        const token = localStorage.getItem('token');
        const res   = await fetch(`${API_URL}/notificaciones/todas`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        setNotificaciones(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error cargando notificaciones:', err);
        alerts.toast.error('No se pudieron cargar las notificaciones.');
        setError(err);
      }
    };
    cargar();
  }, []);

  if (error) {
    return <div className="text-danger">No se pudieron cargar las notificaciones.</div>;
  }

  if (notificaciones === null) {
    return <Spinner animation="border" />;
  }

  const getVariant = (titulo = '') => {
    if (titulo.startsWith('Resolución vencida'))       return 'warning';
    if (titulo.startsWith('Resolución vence en'))      return 'warning';
    if (/(creado|Nueva|agregado)/i.test(titulo))       return 'success';
    if (/actualizado|actualizada/i.test(titulo))       return 'info';
    if (/Carga/i.test(titulo))                         return 'primary';
    if (/subido/i.test(titulo))                        return 'success';
    if (/eliminada|eliminado/i.test(titulo))           return 'danger';
    return 'secondary';
  };

  return (
    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
      {notificaciones.length === 0 ? (
        <div className="text-center py-2">No hay notificaciones.</div>
      ) : (
        notificaciones.map(n => {
          const variant = getVariant(n.titulo || '');
          return (
            <Alert
              key={n.id_notificacion ?? n.id}
              variant={variant}
              dismissible
              onClose={() => {}}
              className="mb-3"
            >
              <strong>{n.titulo}</strong>
              <div className="mt-1">{n.mensaje}</div>
              <div className="text-muted small mt-1">
                {n.creado_en ? new Date(n.creado_en).toLocaleString() : ''}
              </div>
            </Alert>
          );
        })
      )}
    </div>
  );
}
