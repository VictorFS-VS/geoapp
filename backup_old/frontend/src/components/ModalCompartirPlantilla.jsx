import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Form, Table, Alert, Spinner, Badge } from "react-bootstrap";

// Ajustá a tu forma real de llamar a la API (VITE_API_BASE_URL = "/api")
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function apiFetch(url, { method = "GET", token, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function nombreCompleto(u) {
  const n = `${u.first_name || ""} ${u.last_name || ""}`.trim();
  return n || u.username || u.email || `#${u.id}`;
}

/**
 * ModalCompartirPlantilla
 * Props:
 * - show
 * - onHide
 * - idPlantilla
 * - token
 */
export function ModalCompartirPlantilla({ show, onHide, idPlantilla, token }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [shared, setShared] = useState([]); // rows del backend compartir
  const [term, setTerm] = useState("");
  const [usersFound, setUsersFound] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [rol, setRol] = useState("view");

  const canSubmit = useMemo(() => !!selectedUser && !!idPlantilla, [selectedUser, idPlantilla]);

  async function loadShared() {
    if (!idPlantilla) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch(`${API_BASE}/compartir/plantillas/${idPlantilla}`, { token });
      setShared(data.rows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Cuando abre el modal, carga la lista
  useEffect(() => {
    if (show) {
      setSelectedUser(null);
      setUsersFound([]);
      setTerm("");
      setRol("view");
      loadShared();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, idPlantilla]);

  async function buscar() {
    setError("");
    try {
      const data = await apiFetch(`${API_BASE}/usuarios/buscar?term=${encodeURIComponent(term)}`, { token });
      setUsersFound(data.rows || []);
    } catch (e) {
      setError(e.message);
    }
  }

  async function compartir() {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`${API_BASE}/compartir/plantillas/${idPlantilla}`, {
        method: "POST",
        token,
        body: { id_usuario: selectedUser.id, rol },
      });
      // refresca
      await loadShared();
      // limpia selección
      setSelectedUser(null);
      setUsersFound([]);
      setTerm("");
      setRol("view");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function quitar(id_usuario) {
    if (!idPlantilla || !id_usuario) return;
    if (!confirm("¿Quitar acceso a este usuario?")) return;
    setError("");
    try {
      await apiFetch(`${API_BASE}/compartir/plantillas/${idPlantilla}/${id_usuario}`, {
        method: "DELETE",
        token,
      });
      await loadShared();
    } catch (e) {
      setError(e.message);
    }
  }

  async function cambiarRol(id_usuario, newRol) {
    setError("");
    try {
      await apiFetch(`${API_BASE}/compartir/plantillas/${idPlantilla}`, {
        method: "POST",
        token,
        body: { id_usuario, rol: newRol },
      });
      await loadShared();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Compartir Plantilla #{idPlantilla}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error ? <Alert variant="danger" className="mb-3">{error}</Alert> : null}

        {/* Buscar usuario */}
        <div className="border rounded p-3 mb-3">
          <div className="d-flex gap-2 align-items-end">
            <Form.Group className="flex-grow-1">
              <Form.Label>Buscar usuario (username / email / nombre)</Form.Label>
              <Form.Control
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Ej: juan, juan@mail.com"
              />
            </Form.Group>

            <Button variant="secondary" onClick={buscar} disabled={!term.trim()}>
              Buscar
            </Button>
          </div>

          {usersFound.length > 0 && (
            <div className="mt-3">
              <Form.Label>Resultados</Form.Label>
              <Form.Select
                value={selectedUser?.id || ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const u = usersFound.find((x) => x.id === id);
                  setSelectedUser(u || null);
                }}
              >
                <option value="">-- Seleccionar usuario --</option>
                {usersFound.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nombreCompleto(u)} — {u.email || ""} (id {u.id})
                  </option>
                ))}
              </Form.Select>

              <div className="d-flex gap-2 mt-2 align-items-end">
                <Form.Group>
                  <Form.Label>Rol</Form.Label>
                  <Form.Select value={rol} onChange={(e) => setRol(e.target.value)}>
                    <option value="view">view (solo ver)</option>
                    <option value="edit">edit (puede editar)</option>
                  </Form.Select>
                </Form.Group>

                <Button variant="primary" onClick={compartir} disabled={!canSubmit || saving}>
                  {saving ? <Spinner animation="border" size="sm" /> : "Compartir"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Lista compartidos */}
        <div className="border rounded p-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-semibold">Usuarios con acceso</div>
            <Button size="sm" variant="outline-secondary" onClick={loadShared} disabled={loading}>
              {loading ? "Actualizando..." : "Refrescar"}
            </Button>
          </div>

          {loading ? (
            <div className="py-3"><Spinner animation="border" size="sm" /> Cargando...</div>
          ) : (
            <Table striped bordered hover responsive className="mb-0">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th style={{ width: 220 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {shared.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-muted py-3">
                      Nadie compartido todavía.
                    </td>
                  </tr>
                ) : (
                  shared.map((r) => (
                    <tr key={r.id_usuario}>
                      <td>
                        <div className="fw-semibold">{nombreCompleto(r)}</div>
                        <div className="text-muted small">id {r.id_usuario}</div>
                      </td>
                      <td>{r.email || "-"}</td>
                      <td>
                        <Badge bg={r.rol === "edit" ? "success" : "secondary"}>{r.rol}</Badge>
                      </td>
                      <td>
                        <div className="d-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => cambiarRol(r.id_usuario, r.rol === "edit" ? "view" : "edit")}
                          >
                            Cambiar a {r.rol === "edit" ? "view" : "edit"}
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => quitar(r.id_usuario)}>
                            Quitar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Cerrar</Button>
      </Modal.Footer>
    </Modal>
  );
}
