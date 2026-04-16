import React from 'react';
import { Badge, Button, Card } from 'react-bootstrap';
import { getHumanOperator } from './LanguageMapper';
import Swal from 'sweetalert2';

/**
 * Visualización de reglas en lenguaje natural
 */
const RuleList = ({ reglas, preguntas, onEdit, onRemove }) => {
  if (reglas.length === 0) {
    return (
      <div className="border rounded p-5 text-center bg-white shadow-sm">
        <div className="text-muted mb-3"><i className="bi bi-robot fs-1"></i></div>
        <div className="fw-bold fs-5">Sin reglas automáticas</div>
        <div className="small text-muted">Aún no has definido cómo calificar este informe.</div>
      </div>
    );
  }

  return (
    <div className="rule-cards-container d-flex flex-column gap-2">
      {reglas.map((regla, idx) => {
        const pregunta = preguntas.find(p => p.id_pregunta === Number(regla.id_pregunta));
        const puntos = parseFloat(regla.puntos) || 0;
        const opLabel = getHumanOperator(regla.operador);
        
        const handleRemove = () => {
          Swal.fire({
            title: '¿Eliminar regla?',
            text: "Esta acción quitará este criterio del cálculo automático.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
          }).then((result) => {
            if (result.isConfirmed) onRemove(idx);
          });
        };

        return (
          <Card key={idx} className="border-0 shadow-sm overflow-hidden mb-1" style={{ borderLeft: `4px solid ${puntos >= 0 ? '#198754' : '#dc3545'}` }}>
            <Card.Body className="p-2">
              <div className="d-flex align-items-center gap-2 mb-2">
                <Badge bg="light" text="dark" className="border fw-normal" style={{ fontSize: '0.65rem' }}>#{idx + 1}</Badge>
                {regla.etiqueta && <span className="fw-bold text-uppercase text-muted" style={{ fontSize: '0.7rem', letterSpacing: '0.5px' }}>{regla.etiqueta}</span>}
                <span className={`ms-auto fw-bold ${puntos >= 0 ? 'text-success' : 'text-danger'}`} style={{ fontSize: '0.85rem' }}>
                    {puntos > 0 ? `+${puntos}` : puntos} pts
                </span>
              </div>

              <div className="px-1 mb-2" style={{ fontSize: '0.88rem', lineHeight: '1.3' }}>
                <span className="text-muted small me-1">Si</span>
                <span className="fw-bold border-bottom border-primary border-opacity-25">{pregunta?.etiqueta || `Pregunta ${regla.id_pregunta}`}</span>
                <span className="mx-1 text-muted italic">{opLabel}</span>
                <span className="fw-bold px-1 bg-light rounded border">{regla.valor_ref_1} {regla.valor_ref_2 ? ` y ${regla.valor_ref_2}` : ''}</span>
              </div>

              <div className="d-flex gap-2 border-top pt-2 mt-1">
                <Button 
                  variant="light" 
                  size="sm" 
                  className="py-0 text-primary border px-2" 
                  style={{ fontSize: '0.68rem', height: '22px', flex: '1' }} 
                  onClick={() => onEdit(idx)}
                >
                  <i className="bi bi-pencil me-1"></i> Editar lógica
                </Button>
                <Button 
                  variant="light" 
                  size="sm" 
                  className="py-0 text-danger border px-2" 
                  style={{ fontSize: '0.68rem', height: '22px', flex: '1' }} 
                  onClick={handleRemove}
                >
                  <i className="bi bi-trash me-1"></i> Eliminar
                </Button>
              </div>
            </Card.Body>
          </Card>
        );
      })}
    </div>
  );
};

export default RuleList;
