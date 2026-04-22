// src/components/PanelNotificaciones.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { Badge, Spinner, ListGroup, Button, Alert } from 'react-bootstrap';
import { FaBell, FaExclamationTriangle, FaTrash, FaCheckCircle } from 'react-icons/fa';
import { alerts } from '@/utils/alerts';
import '@/styles/PanelNotificaciones.css';

const API_URL = import.meta.env.VITE_API_URL;

const authHeaders = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('access_token') || localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function PanelNotificaciones({ onViewAll }) {
  const [notificaciones, setNotificaciones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [marcandoLeidas, setMarcandoLeidas] = useState(false);

  // Cargar notificaciones
  const cargarNotificaciones = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/notificaciones/todas`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotificaciones(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error cargando notificaciones:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarNotificaciones();
  }, []);

  // Filtrar solo no leídas
  const noLeidas = useMemo(() => {
    return notificaciones.filter(n => 
      (n.leido_usuario === false || n.leido_usuario === 0) || 
      (n.leido_consultor === false || n.leido_consultor === 0)
    );
  }, [notificaciones]);

  // Marcar todas como leídas
  const marcarTodasLeidas = async () => {
    try {
      setMarcandoLeidas(true);
      const res = await fetch(`${API_URL}/notificaciones/marcar-leidas`, {
        method: 'PUT',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotificaciones([]);
      alerts.toast.success('Notificaciones marcadas como leídas.');
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al marcar como leídas.');
    } finally {
      setMarcandoLeidas(false);
    }
  };

  // Detectar tipo de notificación
  const getNotificationType = (titulo = '') => {
    const t = titulo.toLowerCase();
    if (t.includes('vencimiento') || t.includes('vence')) return 'vencimiento';
    if (t.includes('creado')) return 'success';
    if (t.includes('actualizado')) return 'info';
    return 'secondary';
  };

  return (
    <div className="panel-notificaciones">
      {/* Header */}
      <div className="panel-header">
        <h6 className="mb-0">
          <FaBell className="me-2" />
          Notificaciones
          {noLeidas.length > 0 && (
            <Badge bg="danger" className="ms-2">{noLeidas.length}</Badge>
          )}
        </h6>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-3">
          <Spinner animation="border" size="sm" />
        </div>
      )}

      {/* Content */}
      {!loading && (
        <>
          {noLeidas.length === 0 ? (
            <Alert variant="info" className="mb-0">
              No hay notificaciones nuevas
            </Alert>
          ) : (
            <>
              <div className="panel-content">
                <ListGroup variant="flush">
                  {noLeidas.slice(0, 5).map((n, idx) => {
                    const type = getNotificationType(n.titulo);
                    const isUrgent = n.titulo?.toLowerCase().includes('vencida') || 
                                    (n.titulo?.toLowerCase().includes('vence en') && 
                                     parseInt(n.titulo?.match(/\d+/)?.[0] || 0) <= 7);
                    
                    return (
                      <ListGroup.Item 
                        key={n.id_notificacion ?? idx} 
                        className={`notification-item ${isUrgent ? 'urgent' : ''}`}
                      >
                        <div className="d-flex gap-2">
                          <div className="flex-shrink-0">
                            {isUrgent ? (
                              <FaExclamationTriangle className="text-danger mt-1" />
                            ) : (
                              <FaBell className="text-primary mt-1" />
                            )}
                          </div>
                          <div className="flex-grow-1">
                            <strong className="d-block">{n.titulo}</strong>
                            <small className="text-muted d-block mt-1">{n.mensaje}</small>
                            <small className="text-secondary d-block mt-1">
                              {n.creado_en ? new Date(n.creado_en).toLocaleString('es-PY') : ''}
                            </small>
                          </div>
                          <div className="flex-shrink-0">
                            <Badge bg={type === 'vencimiento' ? 'warning' : type} className="mt-1">
                              {type === 'vencimiento' ? '⚠️' : '●'}
                            </Badge>
                          </div>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              </div>

              {/* Acciones */}
              <div className="panel-footer">
                {noLeidas.length > 5 && (
                  <Button 
                    variant="outline-primary" 
                    size="sm" 
                    className="w-100 mb-2"
                    onClick={onViewAll}
                  >
                    Ver todas ({noLeidas.length})
                  </Button>
                )}
                <Button 
                  variant="primary" 
                  size="sm" 
                  className="w-100"
                  onClick={marcarTodasLeidas}
                  disabled={marcandoLeidas}
                >
                  {marcandoLeidas ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Marcando...
                    </>
                  ) : (
                    `✓ Marcar ${noLeidas.length} como leída${noLeidas.length === 1 ? '' : 's'}`
                  )}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
