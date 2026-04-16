// frontend/src/modules/diagnostico/DiagnosticoTab.jsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Form, Table, Row, Col, Badge, Modal, Spinner, Alert } from 'react-bootstrap';
import axios from 'axios';
import { toast } from 'react-toastify';

import RuleList from './RuleList';
import RuleForm from './RuleForm';
import RangeEditor from './RangeEditor';

const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * Componente para configurar el Motor de Scoring Dinámico
 */
const DiagnosticoTab = ({ idPlantilla, preguntas = [] }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    formula: null,
    reglas: [],
    rangos: []
  });

  const [showReglaModal, setShowReglaModal] = useState(false);
  const [editingRegla, setEditingRegla] = useState(null);

  const [showRangoModal, setShowRangoModal] = useState(false);
  const [editingRango, setEditingRango] = useState(null);

  useEffect(() => {
    if (idPlantilla) {
      loadConfig();
    }
  }, [idPlantilla]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/diagnostico/plantilla/${idPlantilla}`);
      if (res.data.ok) {
        setConfig({
          formula: res.data.formula,
          reglas: res.data.reglas || [],
          rangos: res.data.rangos || []
        });
      }
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar configuración de scoring');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        id_plantilla: idPlantilla,
        nombre: config.formula?.nombre || `Scoring P${idPlantilla}`,
        activo: true,
        reglas: config.reglas,
        rangos: config.rangos
      };
      const res = await axios.post(`${API_BASE}/api/diagnostico`, payload);
      if (res.data.ok) {
        toast.success('Configuración guardada correctamente');
        loadConfig();
      }
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar configuración');
    } finally {
      setSaving(false);
    }
  };

  const addRegla = (regla) => {
    if (editingRegla !== null && typeof editingRegla === 'number') {
        const newReglas = [...config.reglas];
        newReglas[editingRegla] = regla;
        setConfig({ ...config, reglas: newReglas });
    } else {
        setConfig({ ...config, reglas: [...config.reglas, regla] });
    }
    setShowReglaModal(false);
    setEditingRegla(null);
  };

  const removeRegla = (index) => {
    const newReglas = [...config.reglas];
    newReglas.splice(index, 1);
    setConfig({ ...config, reglas: newReglas });
  };

  const addRango = (rango) => {
    if (editingRango !== null && typeof editingRango === 'number') {
        const newRangos = [...config.rangos];
        newRangos[editingRango] = rango;
        setConfig({ ...config, rangos: newRangos });
    } else {
        setConfig({ ...config, rangos: [...config.rangos, rango] });
    }
    setShowRangoModal(false);
    setEditingRango(null);
  };

  const removeRango = (index) => {
    const newRangos = [...config.rangos];
    newRangos.splice(index, 1);
    setConfig({ ...config, rangos: newRangos });
  };

  if (loading) return <Spinner animation="border" />;

  return (
    <div className="diagnostico-container">
      <Alert variant="info" className="mb-3 d-flex justify-content-between align-items-center">
        <div>
          <i className="bi bi-info-circle me-2"></i>
          Configura las reglas de puntaje y rangos de interpretación para esta plantilla.
          {config.formula && <Badge bg="dark" className="ms-2">Versión {config.formula.version}</Badge>}
        </div>
        <Button variant="success" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </Button>
      </Alert>

      <Row>
        <Col lg={8}>
          <Card className="mb-3 shadow-sm border-0">
            <Card.Header className="bg-white border-bottom-0 pt-3 d-flex justify-content-between align-items-center">
              <h6 className="mb-0 fw-bold text-muted text-uppercase small">1. Reglas de Puntaje Automático</h6>
              <Button variant="primary" size="sm" className="rounded-pill px-3" onClick={() => { setEditingRegla(null); setShowReglaModal(true); }}>
                <i className="bi bi-plus-circle me-1"></i> Agregar Regla
              </Button>
            </Card.Header>
            <Card.Body>
              <RuleList 
                reglas={config.reglas}
                preguntas={preguntas}
                onEdit={(idx) => { setEditingRegla(idx); setShowReglaModal(true); }}
                onRemove={removeRegla}
              />
            </Card.Body>
          </Card>
        </Col>

        <Col lg={4}>
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-white border-bottom-0 pt-3">
              <h6 className="mb-0 fw-bold text-muted text-uppercase small">2. Interpretación de Resultados</h6>
            </Card.Header>
            <Card.Body>
              <RangeEditor 
                rangos={config.rangos} 
                onChange={(newRangos) => setConfig({ ...config, rangos: newRangos })}
              />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Modal Regla Dinámico */}
      <RuleForm 
        show={showReglaModal} 
        onHide={() => setShowReglaModal(false)} 
        onSave={addRegla}
        preguntas={preguntas}
        initialData={editingRegla !== null ? config.reglas[editingRegla] : null}
      />
    </div>
  );
};

export default DiagnosticoTab;
