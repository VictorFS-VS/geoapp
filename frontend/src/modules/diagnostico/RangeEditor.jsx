import React, { useState } from 'react';
import { Card, Button, Form, Row, Col, Badge } from 'react-bootstrap';
import Swal from 'sweetalert2';

/**
 * Editor de Rangos de Interpretación con descripción y validación de solapamiento
 */
const COLORS_PRESET = [
  { label: 'Verde', hex: '#28a745' },
  { label: 'Amarillo', hex: '#ffc107' },
  { label: 'Naranja', hex: '#fd7e14' },
  { label: 'Rojo', hex: '#dc3545' },
  { label: 'Azul', hex: '#0d6efd' },
  { label: 'Gris', hex: '#6c757d' },
];

const RangeEditor = ({ rangos, onChange }) => {
  const [editingRangoIdx, setEditingRangoIdx] = useState(null);
  const [tempRango, setTempRango] = useState(null);

  const startEdit = (idx) => {
    setEditingRangoIdx(idx);
    setTempRango({ ...rangos[idx] });
  };

  const startNew = () => {
    setEditingRangoIdx(-1);
    const lastMax = rangos.length > 0 ? Math.max(...rangos.map(r => r.max_valor)) : 0;
    setTempRango({
      min_valor: lastMax,
      max_valor: lastMax + 10,
      etiqueta_final: '',
      descripcion: '',
      color_hex: '#28a745',
      prioridad: rangos.length + 1
    });
  };

  const saveRango = () => {
    if (!tempRango.etiqueta_final?.trim()) return;
    const updated = [...rangos];
    if (editingRangoIdx === -1) updated.push(tempRango);
    else updated[editingRangoIdx] = tempRango;

    updated.sort((a, b) => a.min_valor - b.min_valor);

    onChange(updated);
    setEditingRangoIdx(null);
    setTempRango(null);
  };

  const removeRango = (idx) => {
    Swal.fire({
      title: '¿Eliminar nivel?',
      text: "Esta acción quitará este rango de interpretación.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      size: 'sm'
    }).then((result) => {
      if (result.isConfirmed) {
        const updated = [...rangos];
        updated.splice(idx, 1);
        onChange(updated);
      }
    });
  };

  return (
    <div className="range-editor">
      {/* Lista de rangos configurados */}
      {rangos.map((r, idx) => (
        <Card key={idx} className="mb-2 shadow-xs overflow-hidden" style={{ borderLeft: `4px solid ${r.color_hex}` }}>
          <Card.Body className="p-2">
            <div className="d-flex align-items-center gap-2 mb-1">
              <span
                className="rounded-circle d-inline-block border"
                style={{ width: 10, height: 10, backgroundColor: r.color_hex, flexShrink: 0 }}
              />
              <span className="fw-bold text-dark text-truncate" style={{ fontSize: '0.82rem' }}>
                {r.etiqueta_final || '(sin etiqueta)'}
              </span>
              <Badge bg="light" text="dark" className="border fw-normal ms-auto" style={{ fontSize: '0.65rem', padding: '0.2rem 0.4rem' }}>
                {r.min_valor} – {r.max_valor}
              </Badge>
            </div>
            
            {r.descripcion && (
              <div className="text-muted mb-2 px-1" style={{ fontSize: '0.72rem', lineHeight: '1.2', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {r.descripcion}
              </div>
            )}

            <div className="d-flex gap-2 border-top pt-2 mt-1">
              <Button 
                variant="light" 
                size="sm" 
                className="py-0 text-primary border px-2" 
                style={{ fontSize: '0.68rem', height: '22px', flex: '1' }} 
                onClick={() => startEdit(idx)}
              >
                <i className="bi bi-pencil me-1"></i> Editar
              </Button>
              <Button 
                variant="light" 
                size="sm" 
                className="py-0 text-danger border px-2" 
                style={{ fontSize: '0.68rem', height: '22px', borderLeft: '1px solid #dee2e6' }} 
                onClick={() => removeRango(idx)}
              >
                <i className="bi bi-trash me-1"></i> Eliminar
              </Button>
            </div>
          </Card.Body>
        </Card>
      ))}

      {/* Formulario de edición / creación */}
      {editingRangoIdx === null ? (
        <Button variant="outline-primary" className="w-100 btn-sm mt-2" onClick={startNew}>
          <i className="bi bi-plus-circle me-1"></i> Agregar Nivel de Resultado
        </Button>
      ) : (
        <Card className="mt-2 bg-light border-primary shadow-sm">
          <Card.Body className="p-3">
            <h6 className="small fw-bold mb-3 text-primary">
              <i className={`bi bi-${editingRangoIdx === -1 ? 'plus-circle' : 'pencil'} me-1`}></i>
              {editingRangoIdx === -1 ? 'NUEVO NIVEL' : 'EDITAR NIVEL'}
            </h6>

            {/* Min – Max */}
            <Row className="g-2 mb-3">
              <Col>
                <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>Puntaje Mínimo</Form.Label>
                <Form.Control
                  size="sm" type="number"
                  value={tempRango.min_valor}
                  onChange={e => setTempRango({ ...tempRango, min_valor: parseFloat(e.target.value) })}
                />
              </Col>
              <Col>
                <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>Puntaje Máximo</Form.Label>
                <Form.Control
                  size="sm" type="number"
                  value={tempRango.max_valor}
                  onChange={e => setTempRango({ ...tempRango, max_valor: parseFloat(e.target.value) })}
                />
              </Col>
            </Row>

            {/* Etiqueta */}
            <Form.Group className="mb-3">
              <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>
                Etiqueta de Resultado <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                placeholder="Ej: ALTO RIESGO, VULNERABLE, BAJA..."
                value={tempRango.etiqueta_final}
                onChange={e => setTempRango({ ...tempRango, etiqueta_final: e.target.value.toUpperCase() })}
              />
            </Form.Group>

            {/* Descripción */}
            <Form.Group className="mb-3">
              <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>
                Descripción / Interpretación
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                placeholder="Ej: Familia en situación crítica. Requiere intervención inmediata."
                value={tempRango.descripcion || ''}
                onChange={e => setTempRango({ ...tempRango, descripcion: e.target.value })}
              />
              <Form.Text className="text-muted">Se muestra en el diagnóstico como apoyo al evaluador.</Form.Text>
            </Form.Group>

            {/* Color + Prioridad */}
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>Color</Form.Label>
                <div className="d-flex align-items-center gap-2">
                  <Form.Control
                    size="sm" type="color"
                    value={tempRango.color_hex}
                    onChange={e => setTempRango({ ...tempRango, color_hex: e.target.value })}
                    style={{ width: 44, height: 34, padding: 2, cursor: 'pointer' }}
                  />
                  {/* Colores preset */}
                  <div className="d-flex gap-1 flex-wrap">
                    {COLORS_PRESET.map(c => (
                      <button
                        key={c.hex}
                        type="button"
                        title={c.label}
                        onClick={() => setTempRango({ ...tempRango, color_hex: c.hex })}
                        style={{
                          width: 20, height: 20, borderRadius: '50%',
                          backgroundColor: c.hex, border: tempRango.color_hex === c.hex ? '2px solid #000' : '2px solid transparent',
                          cursor: 'pointer', padding: 0
                        }}
                      />
                    ))}
                  </div>
                </div>
              </Col>
              <Col md={8}>
                <Form.Label className="small fw-bold text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>Prioridad (desempate)</Form.Label>
                <Form.Control
                  size="sm" type="number"
                  value={tempRango.prioridad}
                  onChange={e => setTempRango({ ...tempRango, prioridad: parseInt(e.target.value) })}
                />
                <Form.Text className="text-muted">Mayor número = mayor prioridad al clasificar.</Form.Text>
              </Col>
            </Row>

            <div className="d-flex justify-content-end gap-2">
              <Button
                variant="link" size="sm" className="text-muted py-0"
                onClick={() => { setEditingRangoIdx(null); setTempRango(null); }}
              >
                Cancelar
              </Button>
              <Button
                variant="primary" size="sm" className="py-0 px-3"
                onClick={saveRango}
                disabled={!tempRango?.etiqueta_final?.trim()}
              >
                <i className="bi bi-check2 me-1"></i>Guardar Nivel
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Barra de escala visual */}
      {rangos.length > 0 && (
        <div className="mt-4 pt-3 border-top">
          <div className="small text-muted mb-2 text-uppercase fw-bold" style={{ letterSpacing: '1px', fontSize: '0.65rem' }}>
            Escala Visual de Clasificación
          </div>
          <div className="d-flex w-100 rounded overflow-hidden" style={{ height: '6px' }}>
            {rangos.map((r, i) => {
              const width = Math.max(5, r.max_valor - r.min_valor);
              return (
                <div
                  key={i}
                  style={{ backgroundColor: r.color_hex, flex: width }}
                  title={`${r.etiqueta_final}: ${r.min_valor} – ${r.max_valor} pts`}
                />
              );
            })}
          </div>
          <div className="d-flex justify-content-between mt-1" style={{ fontSize: '0.6rem' }}>
            <span className="text-muted">Min: {Math.min(...rangos.map(r => r.min_valor))}</span>
            <div className="d-flex gap-2">
              {rangos.map((r, i) => (
                <span key={i} className="d-flex align-items-center gap-1">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: r.color_hex, display: 'inline-block' }} />
                  <span className="text-muted" style={{ fontSize: '0.58rem' }}>{r.etiqueta_final}</span>
                </span>
              ))}
            </div>
            <span className="text-muted">Max: {Math.max(...rangos.map(r => r.max_valor))}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RangeEditor;
