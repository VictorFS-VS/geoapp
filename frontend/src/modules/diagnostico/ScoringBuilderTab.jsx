// frontend/src/modules/diagnostico/ScoringBuilderTab.jsx
import React, { useState, useEffect } from 'react';
import { Card, Button, Row, Col, Badge, Spinner, Alert, Form } from 'react-bootstrap';
import axios from 'axios';
import Swal from 'sweetalert2';
import RuleList from './RuleList';
import RuleForm from './RuleForm';
import RangeEditor from './RangeEditor';

/* =========================
   API base (robusto)
   ========================= */
const RAW_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

function buildApiBase(raw) {
  const b = String(raw || "").trim().replace(/\/+$/, "");
  if (/\/api$/i.test(b)) return b;
  return b + "/api";
}

const API_BASE = buildApiBase(RAW_BASE);

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Tab Principal: Configuración de Scoring (UX Business-Oriented)
 * Aplica: PRODUCT SENSIBILITY & UX INTEGRITY
 */
const ScoringBuilderTab = ({ idPlantilla, preguntas = [] }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    formula: null,
    reglas: [],
    rangos: []
  });

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = useState(null);

  useEffect(() => {
    if (idPlantilla) loadFormula();
  }, [idPlantilla]);

  const loadFormula = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/diagnostico/plantilla/${idPlantilla}`, {
        headers: getAuthHeaders()
      });
      if (res.data.ok) {
        setData({
          formula: res.data.formula,
          reglas: res.data.reglas || [],
          rangos: res.data.rangos || []
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire('Error', 'No se pudo cargar la configuración de puntos', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAll = async () => {
    if (data.rangos.length === 0) {
        return Swal.fire('Atención', 'Debés configurar al menos 1 rango de resultado', 'warning');
    }
    setSaving(true);
    try {
      const payload = {
        id_plantilla: idPlantilla,
        nombre: data.formula?.nombre?.trim() || `Puntaje Plantilla #${idPlantilla}`,
        reglas: data.reglas,
        rangos: data.rangos
      };
      const res = await axios.post(`${API_BASE}/diagnostico`, payload, {
        headers: getAuthHeaders()
      });
      if (res.data.ok) {
        Swal.fire({
            icon: 'success',
            title: 'Configuración guardada',
            timer: 1500,
            showConfirmButton: false
        });
        loadFormula();
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al guardar configuración';
      Swal.fire('Error', msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const formulaNombre = data.formula?.nombre || '';

  if (loading) return (
    <div className="text-center p-5 text-muted">
      <Spinner animation="border" size="sm" className="me-2" />
      Cargando configuración de negocio...
    </div>
  );

  return (
    <div className="scoring-builder-container">
      <Card className="border-0 shadow-sm mb-4">
        <Card.Body className="bg-light rounded border">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div className="flex-grow-1">
              <h5 className="mb-2 text-primary"><i className="bi bi-award me-2"></i>Lógica de Calificación</h5>
              <div className="d-flex align-items-center gap-2">
                <Form.Control
                  size="sm"
                  placeholder="Nombre de la fórmula..."
                  value={data.formula?.nombre ?? ''}
                  onChange={e => setData(prev => ({ ...prev, formula: { ...prev.formula, nombre: e.target.value } }))}
                  style={{ maxWidth: 360 }}
                />
                {data.formula && <Badge bg="dark" className="ms-1">v{data.formula.version}</Badge>}
              </div>
            </div>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={loadFormula} disabled={saving}>
                <i className="bi bi-arrow-clockwise me-1"></i> Recargar
              </Button>
              <Button variant="success" onClick={handleSaveAll} disabled={saving}>
                {saving ? 'Guardando...' : '✔ Aplicar Cambios'}
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Row>
        <Col lg={8}>
          <div className="mb-4">
            <div className="d-flex justify-content-between align-items-end mb-3">
              <h6 className="mb-0 fw-bold">1. Reglas Automáticas</h6>
              <Button size="sm" variant="primary" onClick={() => { setEditingRuleIndex(null); setShowRuleForm(true); }}>
                 + Nueva Regla de Puntos
              </Button>
            </div>
            <RuleList 
              reglas={data.reglas} 
              preguntas={preguntas} 
              onEdit={(idx) => { setEditingRuleIndex(idx); setShowRuleForm(true); }}
              onRemove={(idx) => {
                const updated = [...data.reglas];
                updated.splice(idx, 1);
                setData({ ...data, reglas: updated });
              }}
            />
          </div>
        </Col>

        <Col lg={4}>
          <div className="mb-4">
            <h6 className="mb-3 fw-bold">2. Interpretación de Resultados</h6>
            <RangeEditor 
                rangos={data.rangos} 
                onChange={(newRangos) => setData({ ...data, rangos: newRangos })} 
            />
          </div>
        </Col>
      </Row>

      {showRuleForm && (
        <RuleForm 
          show={showRuleForm}
          onHide={() => setShowRuleForm(false)}
          preguntas={preguntas}
          initialData={editingRuleIndex !== null ? data.reglas[editingRuleIndex] : null}
          onSave={(rule) => {
            const updated = [...data.reglas];
            if (editingRuleIndex !== null) updated[editingRuleIndex] = rule;
            else updated.push({ ...rule, orden: updated.length + 1 });
            setData({ ...data, reglas: updated });
            setShowRuleForm(false);
          }}
        />
      )}
    </div>
  );
};

export default ScoringBuilderTab;
