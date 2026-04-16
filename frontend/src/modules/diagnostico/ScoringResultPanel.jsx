// frontend/src/modules/diagnostico/ScoringResultPanel.jsx
import React, { useState, useEffect } from 'react';
import { Card, Table, Badge, Button, Form, Spinner, Alert, Row, Col } from 'react-bootstrap';
import { getHumanOperator } from './LanguageMapper';
import Swal from 'sweetalert2';

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

const ScoringResultPanel = ({ idRegistro, canEditOverride = true }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [consultores, setConsultores] = useState([]);
  
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    manual_override: false,
    manual_comment: '',
    resultado_consultor: '',
    id_usuario_evaluador: ''
  });

  const token = localStorage.getItem("token");
  const headers = { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  useEffect(() => {
    if (idRegistro) {
      fetchData();
      cargarEvaluadores();
    }
  }, [idRegistro]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/diagnostico/resultado/${idRegistro}`, { headers });
      if (!res.ok) throw new Error("No se encontró resultado de scoring");
      const json = await res.json();
      setResultado(json.data);
      
      setFormData({
        manual_override: json.data.manual_override || false,
        manual_comment: json.data.manual_comment || '',
        resultado_consultor: json.data.resultado_consultor || json.data.clasificacion || '',
        id_usuario_evaluador: json.data.id_usuario_evaluador || ''
      });
    } catch (err) {
      console.error(err);
      setResultado(null);
    } finally {
      setLoading(false);
    }
  };

  const cargarEvaluadores = async () => {
    try {
      const res = await fetch(`${API_URL}/usuarios?limit=200`, { headers });
      if (res.ok) {
        const json = await res.json();
        setConsultores(json.data || []);
      }
    } catch (err) {
      console.error("Error cargando evaluadores:", err);
    }
  };

  const handleSaveOverride = async (options = {}) => {
    try {
      setSaving(true);
      const isRevert = options.revert === true;
      
      const payload = isRevert ? {
        manual_override: false,
        resultado_consultor: null,
        id_usuario_evaluador: null,
        manual_comment: "Evaluación manual revertida a cálculo automático."
      } : {
        ...formData,
        manual_override: true
      };

      const res = await fetch(`${API_URL}/diagnostico/override/${idRegistro}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Error al guardar evaluación");
      
      Swal.fire({
        icon: 'success',
        title: 'Evaluación Guardada',
        timer: 1500,
        showConfirmButton: false
      });
      
      setEditMode(false);
      fetchData();
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center p-4"><Spinner /> <div className="mt-2 text-muted small">Cargando diagnóstico...</div></div>;
  if (!resultado) return <Alert variant="light" className="border">No hay un diagnóstico calculado para este informe.</Alert>;

  return (
    <Card className="border-0 shadow-sm scoring-result-main mb-4 overflow-hidden">
      <Card.Body className="p-0">
        {/* HERO SUMMARY */}
        <div className="bg-primary text-white p-4 rounded-top d-flex justify-content-between align-items-center">
            <div>
                <div className="text-uppercase small fw-bold opacity-75 mb-1">Puntaje Vulnerabilidad</div>
                <div className="d-flex align-items-baseline gap-2">
                    <span className="display-4 fw-bold">{resultado.score_total}</span>
                    <span className="fs-5 opacity-75">puntos</span>
                </div>
            </div>
            <div className="text-end">
                {resultado.manual_override ? (
                  <div className="d-flex flex-column align-items-end gap-1">
                    <div className="small fw-bold opacity-75 text-uppercase">Detectado: {resultado.clasificacion}</div>
                    <i className="bi bi-arrow-down small opacity-50"></i>
                    <Badge bg="warning" text="dark" className="fs-5 px-3 py-2 mb-1 shadow-sm border border-white border-opacity-50">
                        {resultado.resultado_consultor}
                    </Badge>
                    <div className="small fw-bold text-warning-emphasis bg-white bg-opacity-10 px-2 rounded">
                        <i className="bi bi-person-check-fill me-1"></i> EVALUACIÓN MANUAL
                    </div>
                  </div>
                ) : (
                  <>
                    <Badge bg="light" text="dark" className="fs-5 px-3 py-2 mb-2 shadow-sm">
                        {resultado.clasificacion || 'SIN CALIFICAR'}
                    </Badge>
                    <div className="small opacity-75">
                        <span className="badge bg-info"><i className="bi bi-cpu-fill me-1"></i> CÁLCULO AUTOMÁTICO</span>
                    </div>
                  </>
                )}
            </div>
        </div>

        {/* ETIQUETAS BAR */}
        {resultado.etiquetas && resultado.etiquetas.length > 0 && (
            <div className="px-4 py-2 bg-light border-bottom d-flex gap-2 align-items-center flex-wrap">
                <span className="small fw-bold text-muted text-uppercase me-2">Detecciones:</span>
                {resultado.etiquetas.map((et, i) => (
                    <Badge key={i} bg="dark" className="fw-normal">{et}</Badge>
                ))}
            </div>
        )}

        {/* INTERPRETACIÓN / DESCRIPCIÓN DEL RANGO */}
        {resultado.descripcion_rango && (
            <div className="px-4 py-3 border-bottom bg-light">
                <div className="d-flex align-items-start gap-2">
                    <i className="bi bi-info-circle-fill text-primary mt-1"></i>
                    <div>
                        <div className="small fw-bold text-muted text-uppercase mb-1">Interpretación del Resultado</div>
                        <div className="text-dark" style={{ fontSize: '0.9rem' }}>{resultado.descripcion_rango}</div>
                    </div>
                </div>
            </div>
        )}

        <div className="p-4">
            <h6 className="fw-bold mb-3 text-muted text-uppercase small">Desglose de la Calificación</h6>
            <Table hover responsive className="align-middle border rounded overflow-hidden">
                <thead className="bg-light">
                    <tr>
                        <th className="ps-3 border-0 py-3">Criterio Evaluado</th>
                        <th className="border-0 py-3">Valor Real</th>
                        <th className="text-center border-0 py-3">Cumplimiento</th>
                        <th className="pe-3 text-end border-0 py-3">Puntos</th>
                    </tr>
                </thead>
                <tbody>
                    {resultado.detalle?.map((item, idx) => (
                        <tr key={idx}>
                            <td className="ps-3 py-3">
                                <div className="fw-bold text-dark mb-1">{item.pregunta_label}</div>
                                <div className="text-muted small italic">Regla: {getHumanOperator(item.operador)} {item.valor_ref}</div>
                            </td>
                            <td>
                                <Badge bg="light" text="dark" className="border fw-normal fs-6">
                                    {Array.isArray(item.valor_respuesta) ? item.valor_respuesta.join(', ') : String(item.valor_respuesta)}
                                </Badge>
                            </td>
                            <td className="text-center">
                                {item.condicion_cumplida ? (
                                    <Badge pill bg="success" className="px-3" title="Cumple criterio">APLICA</Badge>
                                ) : (
                                    <span className="text-muted opacity-50">—</span>
                                )}
                            </td>
                            <td className="pe-3 text-end fw-bold">
                                {item.puntos_aplicados > 0 ? (
                                    <span className="text-success fs-5">+{item.puntos_aplicados}</span>
                                ) : (
                                    <span className="text-muted">{item.puntos_aplicados}</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>

        {/* MODO AUDITORIA / OVERRIDE */}
        <div className="mt-4 pt-3 border-top px-4 pb-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0 fw-bold text-muted text-uppercase small">Auditoría / Evaluación Manual</h6>
                {!editMode && canEditOverride && (
                    <Button variant="link" size="sm" className="p-0" onClick={() => setEditMode(true)}>
                        {resultado.manual_override ? 'Editar Evaluación' : 'Realizar Evaluación Manual'}
                    </Button>
                )}
            </div>

            {editMode ? (
                <div className="bg-light p-3 rounded border">
                    <Row className="g-3">
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold">Resultado Final (Clasificación Manual)</Form.Label>
                                <Form.Select 
                                    value={formData.resultado_consultor}
                                    onChange={e => setFormData({ ...formData, resultado_consultor: e.target.value })}
                                >
                                    <option value="">Seleccione nivel...</option>
                                    {(resultado.opciones_clasificacion || []).length > 0 ? (
                                        resultado.opciones_clasificacion.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))
                                    ) : (
                                        <>
                                            <option value="CRÍTICO">CRÍTICO</option>
                                            <option value="ALTO">ALTO</option>
                                            <option value="MEDIO">MEDIO</option>
                                            <option value="BAJO">BAJO</option>
                                        </>
                                    )}
                                </Form.Select>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label className="small fw-bold">Consultor Evaluador</Form.Label>
                                <Form.Select 
                                    value={formData.id_usuario_evaluador}
                                    onChange={e => setFormData({ ...formData, id_usuario_evaluador: e.target.value })}
                                >
                                    <option value="">Seleccione consultor...</option>
                                    {consultores.map(c => (
                                        <option key={c.id} value={c.id}>
                                          {c.first_name || c.nombre || ''} {c.last_name || c.apellido || ''} {c.username ? `(${c.username})` : ''}
                                        </option>
                                    ))}
                                </Form.Select>
                            </Form.Group>
                        </Col>
                        <Col md={12}>
                            <Form.Group className="mb-2">
                                <Form.Label className="small fw-bold">Comentarios del Auditor</Form.Label>
                                <Form.Control 
                                    as="textarea" rows={3}
                                    value={formData.manual_comment}
                                    onChange={e => setFormData({ ...formData, manual_comment: e.target.value })}
                                    placeholder="Justifique la evaluación manual..."
                                />
                            </Form.Group>
                        </Col>
                    </Row>
                    <div className="d-flex justify-content-end gap-2 mt-2">
                        <Button variant="link" size="sm" className="text-muted" onClick={() => setEditMode(false)}>Cancelar</Button>
                        {resultado.manual_override && (
                            <Button variant="outline-danger" size="sm" onClick={() => handleSaveOverride({ revert: true })} disabled={saving}>
                                Revertir a Automático
                            </Button>
                        )}
                        <Button variant="primary" size="sm" onClick={() => handleSaveOverride()} disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar Evaluación Definitiva'}
                        </Button>
                    </div>
                </div>
            ) : (
                resultado.manual_override ? (
                    <div className="bg-light-yellow p-3 rounded border shadow-sm" style={{ borderLeft: '4px solid #ffc107', backgroundColor: '#fffdf5' }}>
                        <div className="fw-bold mb-1">Nota del Auditor:</div>
                        <div className="italic text-dark mb-2">{resultado.manual_comment || 'Sin comentarios.'}</div>
                        <div className="small text-muted d-flex gap-3">
                            <span>
                                👤 {(() => {
                                    const u = consultores.find(c => String(c.id) === String(resultado.id_usuario_evaluador));
                                    if (!u) return 'Auditor';
                                    return `${u.first_name || u.nombre || ''} ${u.last_name || u.apellido || ''}`.trim() || u.username || 'Auditor';
                                })()}
                            </span>
                            <span>📅 {new Date(resultado.fecha_manual_evaluacion).toLocaleDateString()}</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-muted small">No se han realizado ajustes manuales en este registro. El score es puramente algorítmico.</div>
                )
            )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default ScoringResultPanel;
