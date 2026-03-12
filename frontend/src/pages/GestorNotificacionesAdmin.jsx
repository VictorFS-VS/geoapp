// src/pages/GestorNotificacionesAdmin.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { Card, Form, Button, Table, Modal, Spinner, Badge, Alert, ListGroup, Accordion, Pagination } from 'react-bootstrap';
import { FaPlus, FaEdit, FaTrash, FaTimes, FaPaperPlane, FaUsers, FaChevronDown } from 'react-icons/fa';
import { alerts } from '@/utils/alerts';
import '@/styles/GestorNotificacionesAdmin.css';

const API_URL = import.meta.env.VITE_API_URL;
const ITEMS_POR_PAGINA = 10;

const authHeaders = () => {
  const token = localStorage.getItem('token') || localStorage.getItem('access_token') || localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function GestorNotificacionesAdmin() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('todas'); // todas, leidas, noLeidas

  const [formData, setFormData] = useState({
    titulo: '',
    mensaje: '',
    id_proyecto: '',
    es_global: false,
  });

  const [proyectos, setProyectos] = useState([]);
  const [paginaActual, setPaginaActual] = useState(1);
  const [tipoUsuario, setTipoUsuario] = useState(null);
  const [usuarioId, setUsuarioId] = useState(null);

  // Obtener tipo de usuario
  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          const stored = JSON.parse(localStorage.getItem('user') || '{}');
          setTipoUsuario(Number(stored?.tipo_usuario));
          setUsuarioId(stored?.id);
          return;
        }

        const res = await fetch(`${API_URL}/usuarios/me`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          setTipoUsuario(Number(data?.tipo_usuario));
          setUsuarioId(data?.id);
        }
      } catch (err) {
        console.error('Error:', err);
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        setTipoUsuario(Number(stored?.tipo_usuario));
        setUsuarioId(stored?.id);
      }
    };

    loadUserInfo();
  }, []);

  // Cargar proyectos
  const cargarProyectos = async () => {
    try {
      const res = await fetch(`${API_URL}/proyectos`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProyectos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  // Cargar todas las notificaciones (para admin = ver todas)
  const cargarTodasLasNotificaciones = async () => {
    try {
      setLoading(true);
      
      // Para admin: obtener TODAS las notificaciones sin filtro
      // Para consultores: obtener notificaciones de sus proyectos
      const res = await fetch(`${API_URL}/notificaciones/admin/todas`, {
        headers: authHeaders(),
      });

      // Si el endpoint admin/todas no existe, intentar con /todas
      if (res.status === 404) {
        const resFallback = await fetch(`${API_URL}/notificaciones/todas`, {
          headers: authHeaders(),
        });
        if (resFallback.ok) {
          const data = await resFallback.json();
          setNotificaciones(Array.isArray(data) ? data : []);
        }
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotificaciones(Array.isArray(data) ? data : []);
      setPaginaActual(1);
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al cargar notificaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tipoUsuario !== null) {
      cargarProyectos();
      cargarTodasLasNotificaciones();
    }
  }, [tipoUsuario]);

  // Filtrar notificaciones según estado
  const notificacionesFiltradas = useMemo(() => {
    if (filtroEstado === 'todas') return notificaciones;
    if (filtroEstado === 'leidas') {
      return notificaciones.filter(n => (n.leido_usuario && n.leido_consultor));
    }
    if (filtroEstado === 'noLeidas') {
      return notificaciones.filter(n => (!n.leido_usuario || !n.leido_consultor));
    }
    return notificaciones;
  }, [notificaciones, filtroEstado]);

  // Agrupar por proyecto
  const notificacionesPorProyecto = useMemo(() => {
    const grouped = {};

    // Inicializar con todos los proyectos disponibles
    proyectos.forEach(p => {
      grouped[p.id_proyecto] = {
        proyecto: p,
        notificaciones: []
      };
    });

    // Agregar grupo de globales
    grouped['global'] = {
      proyecto: { id_proyecto: 'global', nombre: '🌍 Notificaciones Globales', codigo: '' },
      notificaciones: []
    };

    // Distribuir notificaciones en sus proyectos correspondientes
    notificacionesFiltradas.forEach(n => {
      if (n.es_global) {
        grouped['global'].notificaciones.push(n);
      } else if (n.id_proyecto && grouped[n.id_proyecto]) {
        grouped[n.id_proyecto].notificaciones.push(n);
      } else if (n.id_proyecto) {
        // Si no existe el proyecto en nuestro listado, crear entrada para él
        // Usar nombre y código que vienen del backend (LEFT JOIN)
        if (!grouped[n.id_proyecto]) {
          grouped[n.id_proyecto] = {
            proyecto: { 
              id_proyecto: n.id_proyecto,
              nombre: n.proyecto_nombre || `Proyecto #${n.id_proyecto}`,
              codigo: n.proyecto_codigo || ''
            },
            notificaciones: []
          };
        }
        grouped[n.id_proyecto].notificaciones.push(n);
      }
    });

    // Filtrar grupos vacíos y ordenar
    return Object.values(grouped)
      .filter(g => g.notificaciones.length > 0)
      .sort((a, b) => {
        if (a.proyecto.id_proyecto === 'global') return -1;
        if (b.proyecto.id_proyecto === 'global') return 1;
        return (a.proyecto.nombre || '').localeCompare(b.proyecto.nombre || '');
      });
  }, [notificacionesFiltradas, proyectos]);

  // Paginación
  const totalPages = Math.ceil(notificacionesPorProyecto.length / ITEMS_POR_PAGINA);
  const indexStart = (paginaActual - 1) * ITEMS_POR_PAGINA;
  const indexEnd = indexStart + ITEMS_POR_PAGINA;
  const notificacionesPaginadas = notificacionesPorProyecto.slice(indexStart, indexEnd);

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
        id_proyecto: formData.id_proyecto ? Number(formData.id_proyecto) : null,
        es_global: formData.es_global,
        creado_por: 'Admin',
      };

      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      alerts.toast.success(editingId ? 'Notificación actualizada.' : 'Notificación creada.');
      setShowForm(false);
      setEditingId(null);
      setFormData({ titulo: '', mensaje: '', id_proyecto: '', es_global: false });
      cargarTodasLasNotificaciones();
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
      id_proyecto: notif.id_proyecto || '',
      es_global: notif.es_global || false,
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
      cargarTodasLasNotificaciones();
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al eliminar.');
    }
  };

  // Reenviar a cliente
  const reenviarAlCliente = async (id) => {
    try {
      const res = await fetch(`${API_URL}/notificaciones/${id}/reenviar`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino: 'cliente' }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      alerts.toast.success('Notificación reenviada al cliente.');
    } catch (err) {
      console.error('Error:', err);
      alerts.toast.error('Error al reenviar.');
    }
  };

  const renderFilaPaginacion = (num) => (
    <Pagination.Item
      key={num}
      active={num === paginaActual}
      onClick={() => setPaginaActual(num)}
    >
      {num}
    </Pagination.Item>
  );

  return (
    <div className="container-fluid py-4">
      <Card className="shadow-lg">
        <Card.Header className="bg-primary text-white d-flex align-items-center justify-content-between">
          <div>
            <h4 className="mb-0">
              <FaUsers className="me-2" />
              Gestor de Notificaciones
            </h4>
            <small>Crear, editar y reenviar notificaciones a clientes • Total: {notificacionesFiltradas.length}</small>
          </div>
        </Card.Header>

        <Card.Body>
          {/* Botón crear nueva */}
          <div className="mb-4">
            <Button
              variant="primary"
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setFormData({ titulo: '', mensaje: '', id_proyecto: '', es_global: false });
              }}
            >
              <FaPlus className="me-2" />
              Crear nueva notificación
            </Button>
          </div>

          {/* Formulario */}
          {showForm && (
            <div className="card mb-4 p-4" style={{ borderLeft: '4px solid #007bff', backgroundColor: '#f8f9fa' }}>
              <h6 className="mb-3">{editingId ? '✏️ Editar' : '➕ Nueva'} notificación</h6>

              <Form.Group className="mb-3">
                <Form.Label>Título *</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Ej: Resolución vence en 5 días"
                  value={formData.titulo}
                  onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Mensaje *</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Describe el contenido de la notificación..."
                  value={formData.mensaje}
                  onChange={(e) => setFormData({ ...formData, mensaje: e.target.value })}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Proyecto (opcional)</Form.Label>
                <Form.Select
                  value={formData.id_proyecto}
                  onChange={(e) => setFormData({ ...formData, id_proyecto: e.target.value })}
                >
                  <option value="">Selecciona un proyecto (Dejar vacío para global)</option>
                  {proyectos.map((p) => (
                    <option key={p.id_proyecto} value={p.id_proyecto}>
                      {p.nombre}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Check
                  type="checkbox"
                  label="Enviar a TODOS (Global)"
                  checked={formData.es_global}
                  onChange={(e) => setFormData({ ...formData, es_global: e.target.checked })}
                />
                <small className="text-muted d-block mt-1">
                  Si está activo, se enviará a todos los clientes. Si no, solo al cliente del proyecto.
                </small>
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
                    setFormData({ titulo: '', mensaje: '', id_proyecto: '', es_global: false });
                  }}
                >
                  <FaTimes className="me-2" />
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Filtros */}
          <div className="mb-4">
            <Form.Group>
              <Form.Label>Filtrar por estado</Form.Label>
              <Form.Select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                style={{ maxWidth: '300px' }}
              >
                <option value="todas">Todas las notificaciones</option>
                <option value="noLeidas">Solo sin leer</option>
                <option value="leidas">Solo leídas</option>
              </Form.Select>
            </Form.Group>
          </div>

          {/* Notificaciones agrupadas por proyecto */}
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" className="me-2" />
              Cargando...
            </div>
          ) : notificacionesFiltradas.length === 0 ? (
            <Alert variant="info">No hay notificaciones para mostrar.</Alert>
          ) : (
            <>
              <Accordion>
                {notificacionesPaginadas.map((grupo, idx) => (
                  <Accordion.Item eventKey={String(idx)} key={grupo.proyecto.id_proyecto}>
                    <Accordion.Header>
                      <div className="d-flex align-items-center justify-content-between w-100 pe-3">
                        <div>
                          <strong>
                            {grupo.proyecto.codigo && `[${grupo.proyecto.codigo}] `}
                            {grupo.proyecto.nombre}
                          </strong>
                          <small className="text-muted ms-2">
                            ({grupo.notificaciones.length} notificación{grupo.notificaciones.length !== 1 ? 'es' : ''})
                          </small>
                        </div>
                        <Badge bg="info">{grupo.notificaciones.length}</Badge>
                      </div>
                    </Accordion.Header>
                    <Accordion.Body className="p-0">
                      <div className="table-responsive">
                        <Table striped hover className="mb-0">
                          <thead className="table-light">
                            <tr>
                              <th style={{ width: '15%' }}>Título</th>
                              <th style={{ width: '25%' }}>Mensaje</th>
                              <th style={{ width: '12%' }}>Estado</th>
                              <th style={{ width: '12%' }}>Creado</th>
                              <th style={{ width: '36%' }}>Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grupo.notificaciones.map((n) => (
                              <tr key={n.id_notificacion}>
                                <td>
                                  <strong className="text-truncate d-inline-block" style={{ maxWidth: '150px' }} title={n.titulo}>
                                    {n.titulo}
                                  </strong>
                                </td>
                                <td>
                                  <small className="text-truncate d-inline-block" style={{ maxWidth: '200px' }} title={n.mensaje}>
                                    {n.mensaje}
                                  </small>
                                </td>
                                <td>
                                  {(n.leido_usuario && n.leido_consultor) ? (
                                    <Badge bg="secondary">✓ Leída</Badge>
                                  ) : (
                                    <Badge bg="success">● Nueva</Badge>
                                  )}
                                </td>
                                <td>
                                  <small>
                                    {n.creado_en
                                      ? new Date(n.creado_en).toLocaleDateString('es-PY')
                                      : ''}
                                  </small>
                                </td>
                                <td>
                                  <div className="d-flex gap-1 flex-wrap">
                                    <Button
                                      variant="outline-primary"
                                      size="sm"
                                      onClick={() => editarNotificacion(n)}
                                      title="Editar"
                                    >
                                      <FaEdit />
                                    </Button>

                                    <Button
                                      variant="outline-info"
                                      size="sm"
                                      onClick={() => reenviarAlCliente(n.id_notificacion)}
                                      title="Reenviar al cliente"
                                    >
                                      <FaPaperPlane /> 
                                    </Button>

                                    <Button
                                      variant="outline-danger"
                                      size="sm"
                                      onClick={() => eliminarNotificacion(n.id_notificacion)}
                                      title="Eliminar"
                                    >
                                      <FaTrash />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    </Accordion.Body>
                  </Accordion.Item>
                ))}
              </Accordion>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="d-flex justify-content-center mt-4">
                  <Pagination>
                    <Pagination.First
                      onClick={() => setPaginaActual(1)}
                      disabled={paginaActual === 1}
                    />
                    <Pagination.Prev
                      onClick={() => setPaginaActual(Math.max(1, paginaActual - 1))}
                      disabled={paginaActual === 1}
                    />

                    {/* Números de página */}
                    {paginaActual > 2 && renderFilaPaginacion(1)}
                    {paginaActual > 3 && <Pagination.Ellipsis disabled />}

                    {paginaActual - 1 > 0 && renderFilaPaginacion(paginaActual - 1)}
                    {renderFilaPaginacion(paginaActual)}
                    {paginaActual + 1 <= totalPages && renderFilaPaginacion(paginaActual + 1)}

                    {paginaActual < totalPages - 2 && <Pagination.Ellipsis disabled />}
                    {paginaActual < totalPages - 1 && renderFilaPaginacion(totalPages)}

                    <Pagination.Next
                      onClick={() => setPaginaActual(Math.min(totalPages, paginaActual + 1))}
                      disabled={paginaActual === totalPages}
                    />
                    <Pagination.Last
                      onClick={() => setPaginaActual(totalPages)}
                      disabled={paginaActual === totalPages}
                    />
                  </Pagination>
                </div>
              )}

              <div className="text-center mt-3 text-muted">
                <small>
                  Página {paginaActual} de {totalPages} • Mostrando {notificacionesPaginadas.length} de{' '}
                  {notificacionesPorProyecto.length} grupos de proyectos
                </small>
              </div>
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
