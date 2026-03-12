// src/pages/EvaluacionProyecto.jsx  (VERSIÓN TAB / EMBEBIDA)
// ✅ Cliente (9/10/12): SOLO LECTURA (no crea / no edita / no guarda)

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Form, Table, Modal, Spinner, Alert } from "react-bootstrap";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ==== helpers auth/fetch (estándar) ==== */
const getBearer = () => {
  const t = localStorage.getItem("token");
  return t?.startsWith("Bearer ") ? t : (t ? `Bearer ${t}` : null);
};
const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
};
const redirect401 = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/login");
};
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return null;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// ✅ roles
const GROUPS = {
  ADMIN: 1,
  CONSULTOR: 8,
  CLIENTE: 9,
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,
};

function getUserFromStorage() {
  try {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export default function EvaluacionProyecto({ onChange }) {
  const { id } = useParams(); // proyecto_id

  // ✅ detectar cliente (solo lectura)
  const me = useMemo(() => getUserFromStorage(), []);
  const tipo = useMemo(() => Number(me?.tipo_usuario), [me]);
  const isClientReadOnly = useMemo(
    () => [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipo),
    [tipo]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [evaluaciones, setEvaluaciones] = useState([]);

  const [show, setShow] = useState(false);
  const [modo, setModo] = useState("crear");

  const [formData, setFormData] = useState({
    id: null,
    categoria: "",
    estado: "",
    si_no: false,
    fecha: "",
    observaciones: "",
    fecha_final: "",
  });

  const fetchEvaluaciones = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_URL}/evaluaciones/${id}`, { headers: { ...authHeaders() } });
      const data = await jsonOrRedirect401(res);
      if (!data) return;
      const rows = Array.isArray(data) ? data : data.data || [];
      setEvaluaciones(rows);
      console.info(`Evaluaciones cargadas (${rows.length}) para proyecto #${id}.`);
    } catch (e) {
      console.error("No se pudieron obtener las evaluaciones:", e);
      setError("No se pudieron obtener las evaluaciones.");
      setEvaluaciones([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvaluaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openModal = (nuevoModo, item = null) => {
    // ✅ cliente: solo permite ver
    if (isClientReadOnly) nuevoModo = "ver";

    setModo(nuevoModo);

    if (item) {
      setFormData({
        id: item.id,
        categoria: item.categoria || "",
        estado: item.estado || "",
        si_no: !!item.si_no,
        fecha: item.fecha ? String(item.fecha).split("T")[0] : "",
        observaciones: item.observaciones || "",
        fecha_final: item.fecha_final ? String(item.fecha_final).split("T")[0] : "",
      });
    } else {
      setFormData({
        id: null,
        categoria: "",
        estado: "",
        si_no: false,
        fecha: "",
        observaciones: "",
        fecha_final: "",
      });
    }
    setShow(true);
  };

  const handleChange = (e) => {
    const { name, type, value, checked } = e.target;
    setFormData((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const guardar = async () => {
    // ✅ cliente: no guarda
    if (isClientReadOnly) return;

    const isEdit = !!formData.id;
    const url = isEdit ? `${API_URL}/evaluaciones/${formData.id}` : `${API_URL}/evaluaciones`;
    const method = isEdit ? "PUT" : "POST";

    const payload = {
      proyecto_id: Number(id),
      categoria: formData.categoria || null,
      estado: formData.estado || null,
      si_no: !!formData.si_no,
      fecha: formData.fecha || null,
      observaciones: formData.observaciones || null,
      fecha_final: formData.fecha_final || null,
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      let js = null;
      try {
        js = await res.json();
      } catch {}

      if (res.status === 401) {
        redirect401();
        return;
      }
      if (!res.ok) throw new Error(js?.error || js?.message || `HTTP ${res.status}`);

      setShow(false);
      await fetchEvaluaciones();
      onChange?.();
      console.info(isEdit ? "Evaluación actualizada." : "Evaluación creada.");
    } catch (e) {
      console.error("Error al guardar evaluación:", e);
    }
  };

  const isVer = modo === "ver" || isClientReadOnly;

  if (loading) return <div className="py-4 text-center"><Spinner /></div>;
  if (error) return <Alert variant="danger">{error}</Alert>;

  return (
    <>
      {/* ✅ cliente: no ve crear */}
      {!isClientReadOnly && (
        <div className="d-flex justify-content-end mb-2">
          <Button variant="success" size="sm" onClick={() => openModal("crear")}>
            ➕ Nueva evaluación
          </Button>
        </div>
      )}

      <Table striped bordered hover responsive size="sm">
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Estado</th>
            <th>Sí/No</th>
            <th>Fecha</th>
            <th>Finalización</th>
            <th>Observaciones</th>
            <th style={{ width: 120 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {evaluaciones.length ? (
            evaluaciones.map((item) => (
              <tr key={item.id}>
                <td>{item.categoria}</td>
                <td>{item.estado}</td>
                <td>{item.si_no ? "Sí" : "No"}</td>
                <td>{item.fecha ? String(item.fecha).split("T")[0] : ""}</td>
                <td>{item.fecha_final ? String(item.fecha_final).split("T")[0] : ""}</td>
                <td>{item.observaciones}</td>
                <td className="text-center">
                  {isClientReadOnly ? (
                    <Button size="sm" variant="outline-primary" onClick={() => openModal("ver", item)}>
                      Ver
                    </Button>
                  ) : (
                    <Button size="sm" variant="warning" onClick={() => openModal("editar", item)}>
                      Editar
                    </Button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="7" className="text-center text-muted">
                Sin registros
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {isVer ? "Ver Evaluación" : (modo === "crear" ? "Nueva" : "Editar") + " Evaluación"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Form>
            <Form.Group className="mb-2">
              <Form.Label>Categoría</Form.Label>
              <Form.Control
                name="categoria"
                value={formData.categoria}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Estado</Form.Label>
              <Form.Control
                name="estado"
                value={formData.estado}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Check
                label="¿Sí o No?"
                name="si_no"
                checked={!!formData.si_no}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Fecha</Form.Label>
              <Form.Control
                type="date"
                name="fecha"
                value={formData.fecha || ""}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Fecha Final</Form.Label>
              <Form.Control
                type="date"
                name="fecha_final"
                value={formData.fecha_final || ""}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Observaciones</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                name="observaciones"
                value={formData.observaciones}
                onChange={handleChange}
                disabled={isVer}
              />
            </Form.Group>
          </Form>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShow(false)}>
            {isVer ? "Cerrar" : "Cancelar"}
          </Button>

          {/* ✅ cliente: no guarda */}
          {!isVer && (
            <Button variant="primary" onClick={guardar}>
              Guardar
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
}
