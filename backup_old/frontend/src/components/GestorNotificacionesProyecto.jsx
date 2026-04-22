// src/components/GestorNotificacionesProyecto.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Form, Button, Table, Spinner, Badge, Alert, ListGroup } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaPaperPlane } from 'react-icons/fa';
import { alerts } from '@/utils/alerts';
import '@/styles/GestorNotificaciones.css';

const API_URL = import.meta.env.VITE_API_URL;

const authHeaders = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('access_token') || localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function GestorNotificacionesProyecto({ proyectoId, proyectoNombre, show, onHide }) {
  const [notificaciones, setNotificaciones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    titulo: '',
    mensaje: '',
    enviarA: 'ambos', // 'cliente', 'consultor', 'ambos'
  });

  // Cargar notificaciones del proyecto
  const cargarNotificaciones = async () => {
    if (!proyectoId) return;
    try {
      setLoading(true);
      const res = await fetch(
        `${API_URL}/notificaciones/proyecto/${proyectoId}`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotificaciones(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al cargar notificaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (show) {
      cargarNotificaciones();
    }
  }, [show, proyectoId]);

  // Crear o editar notificación
  const guardarNotificacion = async () => {
    if (!formData.titulo.trim() || !formData.mensaje.trim()) {
      alerts.toast.error('Completa título y mensaje.');
      return;
    }

    try {
      const url = editingId
        ? `${API_URL}/notificaciones/${editingId}`
        : `${API_URL}/notificaciones/crear`;

      const method = editingId ? 'PUT' : 'POST';

      const body = {
        titulo: formData.titulo,
        mensaje: formData.mensaje,
        id_proyecto: proyectoId,
        es_global: false,
        creado_por: 'Admin',
      };

      // Determinar destinatarios según enviarA
      if (formData.enviarA === 'cliente') {
        body.id_cliente = true; // Indicador para backend
      } else if (formData.enviarA === 'consultor') {
        body.id_consultor = true;
      } else {
        body.id_cliente = true;
        body.id_consultor = true;
      }

      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      alerts.toast.success(editingId ? 'Notificación actualizada.' : 'Notificación creada.');
      setShowForm(false);
      setEditingId(null);
      setFormData({ titulo: '', mensaje: '', enviarA: 'ambos' });
      cargarNotificaciones();
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al guardar notificación.');
    }
  };

  // Editar notificación
  const editarNotificacion = (notif) => {
    setFormData({
      titulo: notif.titulo,
      mensaje: notif.mensaje,
      enviarA: 'ambos',
    });
    setEditingId(notif.id_notificacion);
    setShowForm(true);
  };

  // Eliminar notificación
  const eliminarNotificacion = async (id) => {
    if (!window.confirm('¿Eliminar notificación?')) return;

    try {
      const res = await fetch(`${API_URL}/notificaciones/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      alerts.toast.success('Notificación eliminada.');
      cargarNotificaciones();
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al eliminar.');
    }
  };

  // Reenviar notificación
  const reenviarNotificacion = async (id, destino) => {
    try {
      const res = await fetch(`${API_URL}/notificaciones/${id}/reenviar`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino }), // 'cliente', 'consultor', 'ambos'
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      alerts.toast.success(`Notificación reenviada a ${destino}.`);
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al reenviar.');
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          📬 Gestionar Notificaciones - {proyectoNombre}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* Botón para crear nueva */}
        <div className="mb-3">
          <Button
            variant="primary"
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setFormData({ titulo: '', mensaje: '', enviarA: 'ambos' });
            }}
          >
            <FaPlus className="me-2" />
            Crear nueva notificación
          </Button>
        </div>

        {/* Formulario */}
        {showForm && (
          <div className="card mb-3 p-3" style={{ borderLeft: '4px solid #007bff' }}>
            <h6>{editingId ? 'Editar' : 'Nueva'} notificación</h6>

            <Form.Group className="mb-3">
              <Form.Label>Título</Form.Label>
              <Form.Control
                type="text"
                placeholder="Ej: Resolución vence en 5 días"
                value={formData.titulo}
                onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Mensaje</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Describe el contenido de la notificación..."
                value={formData.mensaje}
                onChange={(e) => setFormData({ ...formData, mensaje: e.target.value })}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Enviar a</Form.Label>
              <Form.Select
                value={formData.enviarA}
                onChange={(e) => setFormData({ ...formData, enviarA: e.target.value })}
              >
                <option value="ambos">Ambos (Consultor + Cliente)</option>
                <option value="cliente">Solo Cliente</option>
                <option value="consultor">Solo Consultor</option>
              </Form.Select>
            </Form.Group>

            <div className="d-flex gap-2">
              <Button variant="success" onClick={guardarNotificacion}>
                {editingId ? 'Actualizar' : 'Crear'}
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setFormData({ titulo: '', mensaje: '', enviarA: 'ambos' });
                }}
              >
                <FaTimes className="me-2" />
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Lista de notificaciones */}
        {loading ? (
          <div className="text-center">
            <Spinner animation="border" />
          </div>
        ) : notificaciones.length === 0 ? (
          <Alert variant="info">No hay notificaciones para este proyecto.</Alert>
        ) : (
          <div className="notification-list">
            {notificaciones.map((n) => (
              <div key={n.id_notificacion} className="notification-card mb-3 p-3">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <strong>{n.titulo}</strong>
                  <div className="d-flex gap-2">
                    <Badge bg={n.leido_usuario ? 'secondary' : 'success'}>
                      {n.leido_usuario ? '✓ Leído' : '● Nuevo'}
                    </Badge>
                  </div>
                </div>

                <p className="mb-2 text-muted">{n.mensaje}</p>

                <small className="text-secondary d-block mb-3">
                  {n.creado_en ? new Date(n.creado_en).toLocaleString('es-PY') : ''}
                </small>

                {/* Acciones */}
                <div className="d-flex gap-2 flex-wrap">
                  <Button
                    variant="sm"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => editarNotificacion(n)}
                  >
                    <FaEdit className="me-1" />
                    Editar
                  </Button>

                  <div className="btn-group btn-group-sm" role="group">
                    <Button
                      variant="outline-info"
                      size="sm"
                      onClick={() => reenviarNotificacion(n.id_notificacion, 'cliente')}
                      title="Reenviar al cliente"
                    >
                      <FaPaperPlane className="me-1" />
                      Cliente
                    </Button>
                    <Button
                      variant="outline-info"
                      size="sm"
                      onClick={() => reenviarNotificacion(n.id_notificacion, 'consultor')}
                      title="Reenviar al consultor"
                    >
                      <FaPaperPlane className="me-1" />
                      Consultor
                    </Button>
                  </div>

                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => eliminarNotificacion(n.id_notificacion)}
                  >
                    <FaTrash className="me-1" />
                    Eliminar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cerrar
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
