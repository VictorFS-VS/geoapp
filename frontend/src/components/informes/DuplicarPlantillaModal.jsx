// src/components/informes/DuplicarPlantillaModal.jsx
import React, { useEffect, useState } from "react";
import { Modal, Button, Form, Alert, Spinner } from "react-bootstrap";

export default function DuplicarPlantillaModal({
  show,
  onHide,
  plantilla,
  apiUrl,
  authHeaders,
  onSuccess,
}) {
  const [nombre, setNombre] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (show && plantilla) {
      setNombre(`${plantilla.nombre || "Plantilla"} (Copia)`);
      setError("");
      setLoading(false);
    }
  }, [show, plantilla]);

  async function handleDuplicar() {
    if (!plantilla?.id_plantilla) {
      setError("No hay plantilla seleccionada.");
      return;
    }

    if (!String(nombre || "").trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(
        `${apiUrl}/informes/plantillas/${plantilla.id_plantilla}/duplicar`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(typeof authHeaders === "function" ? authHeaders() : {}),
          },
          body: JSON.stringify({
            nombre: String(nombre).trim(),
          }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || data?.message || `Error HTTP ${res.status}`);
      }

      if (onSuccess) {
        await onSuccess(data);
      }

      onHide?.();
    } catch (e) {
      setError(e.message || "No se pudo duplicar la plantilla.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal show={show} onHide={loading ? undefined : onHide} centered>
      <Modal.Header closeButton={!loading}>
        <Modal.Title>Copiar plantilla</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {plantilla ? (
          <>
            <div className="mb-2">
              <div className="small text-muted">Plantilla original</div>
              <div className="fw-semibold">{plantilla.nombre}</div>
              <div className="small text-muted">{plantilla.descripcion || "Sin descripción"}</div>
            </div>

            <Alert variant="info" className="py-2">
              Se copiarán:
              <br />
              • plantilla
              <br />
              • secciones
              <br />
              • preguntas
              <br />
              • usuarios compartidos
              <br />
              <br />
              No se copiarán los proyectos permitidos.
            </Alert>

            <Form.Label>Nombre de la nueva plantilla</Form.Label>
            <Form.Control
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Inspección Ambiental (Copia)"
              disabled={loading}
              autoFocus
            />

            {error ? (
              <Alert variant="danger" className="mt-3 mb-0 py-2">
                {error}
              </Alert>
            ) : null}
          </>
        ) : (
          <Alert variant="warning" className="mb-0">
            No hay plantilla seleccionada.
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          Cancelar
        </Button>

        <Button variant="primary" onClick={handleDuplicar} disabled={loading || !plantilla}>
          {loading ? (
            <>
              <Spinner size="sm" className="me-2" />
              Copiando...
            </>
          ) : (
            "Copiar plantilla"
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}