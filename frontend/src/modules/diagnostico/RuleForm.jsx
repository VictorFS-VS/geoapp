// frontend/src/modules/diagnostico/RuleForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Form, Button, Row, Col, Alert, InputGroup } from 'react-bootstrap';
import Select from 'react-select';
import { getAvailableOperators, mapQuestionType } from './LanguageMapper';

/**
 * Formulario de Regla con UX Adaptativa por Tipo de Pregunta
 * Aplica: PRODUCT SENSIBILITY
 */
const RuleForm = ({ show, onHide, onSave, preguntas, initialData }) => {
  const [formData, setFormData] = useState({
    id_pregunta: '',
    operador: 'EQ',
    valor_ref_1: '',
    valor_ref_2: '',
    puntos: 0,
    etiqueta: '',
    orden: 0
  });

  // Efecto para hidratar si estamos editando
  useEffect(() => {
    if (initialData) setFormData({ ...initialData });
    else setFormData({ id_pregunta: '', operador: 'EQ', valor_ref_1: '', valor_ref_2: '', puntos: 0, etiqueta: '', orden: 0 });
  }, [show, initialData]);

  // Encontrar metadata de la pregunta seleccionada
  const selectedPregunta = useMemo(() => {
    return preguntas.find(p => p.id_pregunta === Number(formData.id_pregunta));
  }, [formData.id_pregunta, preguntas]);

  const qType = useMemo(() => mapQuestionType(selectedPregunta?.tipo), [selectedPregunta]);
  const availableOps = useMemo(() => getAvailableOperators(qType), [qType]);

  // Si cambia la pregunta, reiniciamos el operador a uno válido para su tipo
  useEffect(() => {
    if (formData.id_pregunta && qType) {
        const ops = getAvailableOperators(qType);
        if (!ops.some(o => o.value === formData.operador)) {
            setFormData(prev => ({ ...prev, operador: ops[0].value }));
        }
    }
  }, [formData.id_pregunta, qType]);

  const sentencePreview = useMemo(() => {
    if (!formData.id_pregunta) return 'Seleccione una pregunta para comenzar...';
    const op = availableOps.find(o => o.value === formData.operador)?.label || formData.operador;

    let val1Display = formData.valor_ref_1 || '____';
    // Para el operador IN con opciones, mostrar los labels legibles
    if (formData.operador === 'IN' && selectedPregunta?.opciones_json) {
      const opcMap = Object.fromEntries(
        selectedPregunta.opciones_json.map(opt => [
          opt.valor || opt.nombre || String(opt),
          opt.nombre || opt.label || String(opt)
        ])
      );
      const vals = (formData.valor_ref_1 || '').split(',').map(v => v.trim()).filter(Boolean);
      val1Display = vals.length > 0 ? vals.map(v => opcMap[v] || v).join(' o ') : '____';
    }

    const val2 = formData.valor_ref_2 || '____';
    const p = formData.puntos || 0;

    let text = `Si "${selectedPregunta?.etiqueta || '...'}" ${op} ${val1Display}`;
    if (formData.operador === 'RANGE') text += ` y ${val2}`;
    text += ` entonces se sumarán ${p} puntos.`;
    return text;
  }, [formData, selectedPregunta, availableOps]);

  const handleSave = () => {
    onSave(formData);
  };

  // ✅ Opciones para el buscador de react-select
  const questionOptions = useMemo(() => {
    return (preguntas || []).map(p => ({
      value: p.id_pregunta,
      label: `${p.etiqueta} (${p.tipo})`,
      original: p
    }));
  }, [preguntas]);

  const selectedOption = useMemo(() => {
    return questionOptions.find(o => o.value === Number(formData.id_pregunta)) || null;
  }, [formData.id_pregunta, questionOptions]);

  const renderValueInput = () => {
    if (!formData.id_pregunta) return <div className="text-muted small p-2 border rounded bg-light">Primero seleccioná una pregunta</div>;

    const hasOptions = selectedPregunta?.opciones_json && Array.isArray(selectedPregunta.opciones_json);

    // Operador IN con opciones disponibles → react-select multivalue
    if (hasOptions && formData.operador === 'IN') {
      const opcOptions = selectedPregunta.opciones_json.map((opt, i) => ({
        value: opt.valor || opt.nombre || String(opt),
        label: opt.nombre || opt.label || String(opt),
      }));

      // valor_ref_1 se guarda como "val1,val2,val3"
      const currentValues = formData.valor_ref_1
        ? formData.valor_ref_1.split(',').map(v => v.trim()).filter(Boolean)
        : [];
      const selectedMulti = opcOptions.filter(o => currentValues.includes(o.value));

      return (
        <Select
          isMulti
          options={opcOptions}
          value={selectedMulti}
          placeholder="Seleccione una o más opciones..."
          onChange={(selected) => {
            const joined = (selected || []).map(s => s.value).join(',');
            setFormData(prev => ({ ...prev, valor_ref_1: joined }));
          }}
          styles={{
            control: (base) => ({
              ...base,
              minHeight: '40px',
              borderRadius: '0.375rem',
              border: '1px solid #dee2e6',
            })
          }}
          noOptionsMessage={() => "Sin opciones disponibles"}
        />
      );
    }

    // Operador EQ/NEQ con opciones → select simple
    if (hasOptions && ['EQ', 'NEQ', 'CONTAINS'].includes(formData.operador)) {
      return (
        <Form.Select
          value={formData.valor_ref_1}
          onChange={e => setFormData({ ...formData, valor_ref_1: e.target.value })}
        >
          <option value="">Seleccione una opción...</option>
          {selectedPregunta.opciones_json.map((opt, i) => (
            <option key={i} value={opt.valor || opt.nombre || opt}>{opt.nombre || opt.label || opt}</option>
          ))}
        </Form.Select>
      );
    }

    // Default: campo numérico o texto libre
    return (
      <Form.Control
        type={qType === 'NUMBER' ? 'number' : 'text'}
        placeholder="Ingrese valor..."
        value={formData.valor_ref_1}
        onChange={e => setFormData({ ...formData, valor_ref_1: e.target.value })}
      />
    );
  };


  return (
    <Modal show={show} onHide={onHide} size="lg" centered backdrop="static">
      <Modal.Header closeButton className="bg-light border-0">
        <Modal.Title className="fs-5 fw-bold text-primary">
            <i className="bi bi-magic me-2"></i>
            {initialData ? 'Editor de Regla de Puntos' : 'Nueva Configuración Automática'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-4 pt-2">
        <Form>
          <div className="mb-4">
            <div className="d-flex align-items-center mb-3">
                <span className="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center me-2" style={{ width: '24px', height: '24px', fontSize: '0.8rem' }}>1</span>
                <h6 className="text-dark mb-0 fw-bold">Elegir variable de la encuesta</h6>
            </div>
            
            <Select
                options={questionOptions}
                placeholder="🔍 Buscar variable por nombre..."
                isSearchable
                isClearable
                value={selectedOption}
                onChange={(opt) => setFormData(prev => ({ 
                    ...prev, 
                    id_pregunta: opt ? opt.value : '' 
                }))}
                noOptionsMessage={() => "No se encontraron campos"}
                styles={{
                    control: (base) => ({
                        ...base,
                        minHeight: '48px',
                        borderRadius: '0.5rem',
                        border: '2px solid #dee2e6',
                        boxShadow: 'none',
                        '&:hover': { border: '#3b82f6' }
                    })
                }}
            />
          </div>

          <div className="mb-4">
            <div className="d-flex align-items-center mb-3">
                <span className="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center me-2" style={{ width: '24px', height: '24px', fontSize: '0.8rem' }}>2</span>
                <h6 className="text-dark mb-0 fw-bold">¿Cuándo debe sumar puntos?</h6>
            </div>
            <Row className="g-2">
                <Col md={5}>
                    <Form.Select 
                        value={formData.operador} 
                        onChange={e => setFormData({ ...formData, operador: e.target.value })}
                        disabled={!formData.id_pregunta}
                    >
                        {availableOps.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                    </Form.Select>
                </Col>
                <Col md={formData.operador === 'RANGE' ? 3 : 7}>
                    {renderValueInput()}
                </Col>
                {formData.operador === 'RANGE' && (
                    <Col md={4}>
                        <Form.Control 
                            type="number"
                            placeholder="Valor hasta..."
                            value={formData.valor_ref_2}
                            onChange={e => setFormData({ ...formData, valor_ref_2: e.target.value })}
                        />
                    </Col>
                )}
            </Row>
          </div>

          <div className="mb-1">
             <div className="d-flex align-items-center mb-3">
                <span className="bg-primary text-white rounded-circle d-inline-flex align-items-center justify-content-center me-2" style={{ width: '24px', height: '24px', fontSize: '0.8rem' }}>3</span>
                <h6 className="text-dark mb-0 fw-bold">Resultado</h6>
            </div>
            <Row className="g-3">
                <Col md={4}>
                    <Form.Label className="small text-muted fw-bold">PUNTOS</Form.Label>
                    <Form.Control 
                        type="number" step="0.5" 
                        value={formData.puntos} 
                        onChange={e => setFormData({ ...formData, puntos: parseFloat(e.target.value) })}
                        className="fw-bold"
                    />
                </Col>
                <Col md={8}>
                    <Form.Label className="small text-muted fw-bold">ETIQUETA (Opcional)</Form.Label>
                    <Form.Control 
                        value={formData.etiqueta} 
                        onChange={e => setFormData({ ...formData, etiqueta: e.target.value.toUpperCase() })}
                        placeholder="Ej: DISCAPACIDAD MOTOR"
                    />
                </Col>
            </Row>
          </div>

          <Alert variant="primary" className="mt-4 border-0 border-start border-4 border-primary">
              <div className="small text-muted text-uppercase fw-bold mb-1">Vista previa de la Lógica:</div>
              <div className="fs-6 italic text-dark fw-semibold">
                  "{sentencePreview}"
              </div>
          </Alert>
        </Form>
      </Modal.Body>
      <Modal.Footer className="bg-light border-0">
        <Button variant="link" className="text-muted text-decoration-none" onClick={onHide}>Cancelar</Button>
        <Button variant="primary" onClick={handleSave} disabled={!formData.id_pregunta} className="px-4 fw-bold">
            <i className="bi bi-check-circle me-2"></i>
            {initialData ? 'Guardar Cambios' : 'Incluir en la Fórmula'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default RuleForm;
