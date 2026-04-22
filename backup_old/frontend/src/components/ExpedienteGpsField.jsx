import React, { useMemo, useState, useEffect, useImperativeHandle } from "react";
import { Row, Col, Button, Form, Modal, Badge } from "react-bootstrap";
import GoogleMapaCoordenadas from "@/components/GoogleMapaCoordenadas";
import { parseCoordsString, coordsToString } from "@/utils/coords";

const ExpedienteGpsField = React.forwardRef(function ExpedienteGpsField({
  value = "",
  onChange,
  onOpenMap,
  disabled = false,
  showClear = true,
  readOnlyGeometry = null,
}, ref) {
  const coords = useMemo(() => parseCoordsString(value), [value]);
  const latVal = coords?.[0] ?? "";
  const lngVal = coords?.[1] ?? "";
  const hasCoords = Array.isArray(coords);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCoords, setModalCoords] = useState(coords);

  const applyChange = (nextLat, nextLng) => {
    const normalizedLat = nextLat?.trim() || "";
    const normalizedLng = nextLng?.trim() || "";
    if (!normalizedLat && !normalizedLng) {
      onChange?.("");
      return;
    }
    onChange?.(coordsToString([normalizedLat, normalizedLng]));
  };

  useEffect(() => {
    if (!modalOpen) {
      setModalCoords(coords);
    }
  }, [coords, modalOpen]);

  const handleOpenMap = () => {
    if (disabled) return;
    setModalCoords(coords);
    setModalOpen(true);
    onOpenMap?.();
  };

  const handleConfirm = () => {
    onChange?.(coordsToString(modalCoords || coords || ["", ""]));
    setModalOpen(false);
  };

  const handleHide = () => {
    setModalOpen(false);
  };

  const formatDecimal = (val) => {
    const n = Number(String(val).replace(",", "."));
    if (Number.isFinite(n)) return n.toFixed(6);
    return val;
  };

  const modalLat = modalCoords?.[0] ?? "";
  const modalLng = modalCoords?.[1] ?? "";
  const hasModalCoords =
    Number.isFinite(Number(String(modalLat).replace(",", "."))) &&
    Number.isFinite(Number(String(modalLng).replace(",", ".")));

  useImperativeHandle(ref, () => ({
    openMap: handleOpenMap,
  }));

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-2">
        <div>
          {hasCoords ? (
            <Badge bg="success" pill>
              GPS cargado
            </Badge>
          ) : (
            <Badge bg="secondary" pill>
              Sin ubicación
            </Badge>
          )}
        </div>
        {hasCoords && (
          <div className="text-muted small">
            Lat {formatDecimal(latVal)} · Lng {formatDecimal(lngVal)}
          </div>
        )}
      </div>

      <Row className="g-2 align-items-end mb-2">
        <Col>
          <Form.Group>
            <Form.Label className="mb-1" style={{ fontSize: 12 }}>
              Latitud
            </Form.Label>
            <Form.Control
              size="sm"
              type="text"
              value={latVal}
              placeholder="-25.28646"
              disabled={disabled}
              onChange={(e) => applyChange(e.target.value, lngVal)}
            />
          </Form.Group>
        </Col>
        <Col>
          <Form.Group>
            <Form.Label className="mb-1" style={{ fontSize: 12 }}>
              Longitud
            </Form.Label>
            <Form.Control
              size="sm"
              type="text"
              value={lngVal}
              placeholder="-57.647"
              disabled={disabled}
              onChange={(e) => applyChange(latVal, e.target.value)}
            />
          </Form.Group>
        </Col>
        <Col md="auto">
          <Button
            size="sm"
            variant="outline-primary"
            onClick={handleOpenMap}
            disabled={disabled}
          >
            {hasCoords ? "Editar en mapa" : "Seleccionar en mapa"}
          </Button>
        </Col>
        {showClear && hasCoords && (
          <Col md="auto">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => onChange?.("")}
              disabled={disabled}
            >
              Limpiar
            </Button>
          </Col>
        )}
      </Row>

      <Modal show={modalOpen} onHide={handleHide} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Seleccionar ubicación</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
            <div className="d-flex gap-3 flex-wrap">
              <div className="small text-muted">
                <div className="fw-semibold">Latitud</div>
                <div>{hasModalCoords ? formatDecimal(modalLat) : "Sin coordenada"}</div>
              </div>
              <div className="small text-muted">
                <div className="fw-semibold">Longitud</div>
                <div>{hasModalCoords ? formatDecimal(modalLng) : "Sin coordenada"}</div>
              </div>
            </div>
            {hasModalCoords && (
              <Badge bg="success" pill>
                Punto listo
              </Badge>
            )}
          </div>
          <GoogleMapaCoordenadas
            value={modalCoords}
            onChange={(coords) => setModalCoords(coords)}
            height={320}
            disabled={disabled}
            hideManualControls
            readOnlyGeometry={readOnlyGeometry}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={handleHide}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={!hasModalCoords}
          >
            Confirmar
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
});

export default ExpedienteGpsField;
