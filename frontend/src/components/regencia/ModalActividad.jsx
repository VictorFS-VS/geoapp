// src/components/regencia/ModalActividad.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Form, Row, Col, Alert, Spinner } from "react-bootstrap";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   AUTH HEADERS (JWT)
   ========================= */
function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.message || data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

function getUserFromStorage() {
  try {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

const TIPOS = [
  { value: "VISITA", label: "Visita" },
  { value: "ENTREGA_INFORME", label: "Entrega de informe" },
  { value: "AUDITORIA", label: "Auditoría" },
  { value: "UNICA", label: "Actividad única" },
];

const ESTADOS = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "REALIZADA", label: "Realizada" },
  { value: "CANCELADA", label: "Cancelada" },
];

function toLocalDT(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toISOStringFromLocalDT(local) {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function userLabel(u) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (name) return `${name} (${u.username || u.email || u.id})`;
  return u.username || u.email || `Usuario #${u.id}`;
}

export default function ModalActividad({
  show,
  onHide,
  mode = "crear", // crear | editar | ver
  initialData = null,
  id_proyecto,
  onSubmit,
}) {
  const readOnly = mode === "ver";

  const me = useMemo(() => getUserFromStorage(), []);
  const meId = useMemo(() => (me?.id ? Number(me.id) : null), [me]);

  // usuarios
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState([]);

  // responsable seleccionado
  const [idResponsable, setIdResponsable] = useState(meId);

  const initialForm = useMemo(() => {
    return {
      id_proyecto: id_proyecto ? Number(id_proyecto) : null,
      titulo: "",
      descripcion: "",
      tipo: "VISITA",
      inicio_at: "",
      fin_at: "",
      estado: "PENDIENTE",
    };
  }, [id_proyecto]);

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");

  // cargar usuarios al abrir
  useEffect(() => {
    if (!show) return;

    let alive = true;
    (async () => {
      setUsersLoading(true);
      try {
        const data = await apiFetch(`${API_URL}/usuarios?limit=500`);
        const list = Array.isArray(data) ? data : data?.rows || data?.data || [];
        if (!alive) return;
        setUsers(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("load users:", e);
        if (!alive) return;
        setUsers([]);
      } finally {
        if (alive) setUsersLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [show]);

  // cuando abre modal: setear form + responsable default / responsable existente
  useEffect(() => {
    if (!show) return;

    setError("");

    if (mode === "crear") {
      const now = new Date();
      now.setHours(9, 0, 0, 0);

      setForm({
        ...initialForm,
        inicio_at: toLocalDT(now),
        fin_at: "",
      });

      // ✅ por defecto: usuario logueado
      setIdResponsable(meId || null);
      return;
    }

    // editar/ver
    const r = initialData || {};
    setForm({
      id_proyecto: id_proyecto ? Number(id_proyecto) : null,
      titulo: r.titulo || "",
      descripcion: r.descripcion || "",
      tipo: r.tipo || "VISITA",
      inicio_at: toLocalDT(r.inicio_at),
      fin_at: toLocalDT(r.fin_at),
      estado: r.estado || "PENDIENTE",
    });

    // ✅ tomar responsable desde r.responsables[0].id_usuario (si viene)
    const respId =
      (Array.isArray(r?.responsables) && r.responsables[0]?.id_usuario) ||
      r?.responsable?.id_usuario ||
      r?.id_usuario_responsable ||
      meId ||
      null;

    setIdResponsable(respId ? Number(respId) : null);
  }, [show, mode, initialData, id_proyecto, initialForm, meId]);

  // si aún no hay seleccionado y ya tenemos meId, setearlo (por si me cargó después)
  useEffect(() => {
    if (!show) return;
    if (!idResponsable && meId) setIdResponsable(meId);
  }, [show, idResponsable, meId]);

  function setField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSave() {
    setError("");

    if (!form.id_proyecto) return setError("Falta id_proyecto");
    if (!form.titulo?.trim()) return setError("El título es obligatorio");
    if (!form.tipo) return setError("El tipo es obligatorio");
    if (!form.inicio_at) return setError("La fecha/hora de inicio es obligatoria");
    if (!idResponsable) return setError("Seleccioná un responsable");

    const payload = {
      id_proyecto: Number(form.id_proyecto),
      titulo: form.titulo.trim(),
      descripcion: form.descripcion?.trim() || null,
      tipo: form.tipo,
      inicio_at: toISOStringFromLocalDT(form.inicio_at),
      fin_at: form.fin_at ? toISOStringFromLocalDT(form.fin_at) : null,
      estado: form.estado || "PENDIENTE",

      // ✅ backend: soporta body.responsables
      responsables: [{ id_usuario: Number(idResponsable), rol: "RESPONSABLE" }],
    };

    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e?.message || "Error guardando");
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {mode === "crear" ? "Nueva actividad" : mode === "editar" ? "Editar actividad" : "Ver actividad"}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}

        <Row className="g-3">
          {/* ✅ Responsable */}
          <Col md={12}>
            <Form.Group>
              <Form.Label>Responsable</Form.Label>
              <div className="d-flex gap-2 align-items-center">
                <Form.Select
                  value={idResponsable || ""}
                  onChange={(e) => setIdResponsable(e.target.value ? Number(e.target.value) : null)}
                  disabled={readOnly || usersLoading}
                >
                  <option value="">— Seleccionar responsable —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                    </option>
                  ))}
                </Form.Select>

                {usersLoading ? <Spinner animation="border" size="sm" /> : null}
              </div>
              <div className="text-muted small mt-1">Por defecto se selecciona el usuario logueado.</div>
            </Form.Group>
          </Col>

          <Col md={8}>
            <Form.Group>
              <Form.Label>Título</Form.Label>
              <Form.Control
                value={form.titulo}
                onChange={(e) => setField("titulo", e.target.value)}
                disabled={readOnly}
                placeholder="Ej: Visita mensual"
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Tipo</Form.Label>
              <Form.Select value={form.tipo} onChange={(e) => setField("tipo", e.target.value)} disabled={readOnly}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={12}>
            <Form.Group>
              <Form.Label>Descripción</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={form.descripcion}
                onChange={(e) => setField("descripcion", e.target.value)}
                disabled={readOnly}
                placeholder="Opcional"
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Estado</Form.Label>
              <Form.Select value={form.estado} onChange={(e) => setField("estado", e.target.value)} disabled={readOnly}>
                {ESTADOS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Inicio</Form.Label>
              <Form.Control
                type="datetime-local"
                value={form.inicio_at}
                onChange={(e) => setField("inicio_at", e.target.value)}
                disabled={readOnly}
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Fin</Form.Label>
              <Form.Control
                type="datetime-local"
                value={form.fin_at}
                onChange={(e) => setField("fin_at", e.target.value)}
                disabled={readOnly}
              />
              <div className="text-muted small mt-1">Opcional</div>
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>
          Cerrar
        </Button>

        {!readOnly && (
          <Button variant="primary" onClick={handleSave} disabled={usersLoading}>
            Guardar
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
