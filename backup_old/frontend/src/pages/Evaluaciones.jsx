// src/pages/Evaluacion.jsx
// ✅ Estado (etapa) desde Conceptos PROYECTO_ESTADO + “Nuevo estado” dentro del modal
// ✅ Cliente (9/10/12): SOLO LECTURA

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Form, Table, Spinner, Alert } from "react-bootstrap";
import Modal from "@/components/Modal";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ==== helpers auth/fetch ==== */
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

export default function EvaluacionProyecto() {
  const { id } = useParams(); // id del proyecto
  const navigate = useNavigate();

  const me = useMemo(() => getUserFromStorage(), []);
  const tipo = useMemo(() => Number(me?.tipo_usuario), [me]);
  const isClientReadOnly = useMemo(
    () => [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipo),
    [tipo]
  );

  const [evaluaciones, setEvaluaciones] = useState([]);
  const [modalShow, setModalShow] = useState(false);
  const [modo, setModo] = useState("crear");
  const [guardandoEval, setGuardandoEval] = useState(false);

  // ✅ estados (PROYECTO_ESTADO)
  const [estados, setEstados] = useState([]);
  const [loadingEstados, setLoadingEstados] = useState(false);

  // ✅ modal nuevo estado
  const [modalNuevoEstado, setModalNuevoEstado] = useState(false);
  const [nuevoEstado, setNuevoEstado] = useState({ concepto: "", nombre: "" });
  const [guardandoEstado, setGuardandoEstado] = useState(false);
  const [msgEstado, setMsgEstado] = useState("");

  const [formData, setFormData] = useState({
    id: null,
    categoria: "",
    etapa: "",       // ✅ antes era "estado" texto -> ahora es etapa
    si_no: false,
    fecha: "",
    observaciones: "",
    fecha_final: "",
  });

  useEffect(() => {
    fetchEvaluaciones();
    fetchEstados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchEvaluaciones = async () => {
    try {
      const res = await fetch(`${API_URL}/evaluaciones/${id}`, {
        headers: { ...authHeaders() },
      });
      const data = await jsonOrRedirect401(res);
      if (!data) return;

      const rows = Array.isArray(data) ? data : data.data || [];
      setEvaluaciones(rows);
    } catch (err) {
      console.error("Error al obtener evaluaciones:", err);
      setEvaluaciones([]);
    }
  };

  const fetchEstados = async () => {
    setLoadingEstados(true);
    try {
      const res = await fetch(`${API_URL}/conceptos?simple=1&tipoconcepto=PROYECTO_ESTADO`, {
        headers: { ...authHeaders() },
      });
      const data = await jsonOrRedirect401(res);
      if (!data) return;
      setEstados(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error al obtener estados:", err);
      setEstados([]);
    } finally {
      setLoadingEstados(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((s) => ({ ...s, [name]: type === "checkbox" ? checked : value }));
  };

  const abrirModal = (nuevoModo, item = null) => {
    if (isClientReadOnly) nuevoModo = "ver";
    setModo(nuevoModo);
    setMsgEstado("");

    if (item) {
      setFormData({
        ...item,
        // compat: si tu API aún devuelve "estado" texto, lo mapeamos a etapa
        etapa: item.etapa ?? item.estado ?? "",
        fecha: item.fecha ? String(item.fecha).split("T")[0] : "",
        fecha_final: item.fecha_final ? String(item.fecha_final).split("T")[0] : "",
      });
    } else {
      setFormData({
        id: null,
        categoria: "",
        etapa: "",
        si_no: false,
        fecha: "",
        observaciones: "",
        fecha_final: "",
      });
    }
    setModalShow(true);
  };

  const crearNuevoEstado = async () => {
    if (isClientReadOnly) return;

    const concepto = String(nuevoEstado.concepto || "").trim();
    const nombre = String(nuevoEstado.nombre || "").trim();
    if (!concepto || !nombre) {
      setMsgEstado("❌ Completá Código y Nombre.");
      return;
    }

    setGuardandoEstado(true);
    setMsgEstado("");

    try {
      const res = await fetch(`${API_URL}/conceptos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          concepto,
          nombre,
          tipoconcepto: "PROYECTO_ESTADO",
        }),
      });

      const data = await jsonOrRedirect401(res);
      if (!data) return;

      await fetchEstados();
      // ✅ seleccionar el recién creado
      setFormData((s) => ({ ...s, etapa: `${concepto}. ${nombre}`.includes(`${concepto}.`) ? `${concepto}. ${nombre}` : nombre }));
      // si vos guardás exactamente el "nombre", entonces:
      setFormData((s) => ({ ...s, etapa: nombre }));

      setModalNuevoEstado(false);
      setNuevoEstado({ concepto: "", nombre: "" });

      setMsgEstado("✅ Estado creado y seleccionado.");
      setTimeout(() => setMsgEstado(""), 2500);
    } catch (err) {
      console.error("Error al crear estado:", err);
      setMsgEstado("❌ No se pudo crear el estado.");
    } finally {
      setGuardandoEstado(false);
    }
  };

  const guardar = async () => {
    if (isClientReadOnly) return;

    const isEdit = !!formData.id;
    const url = isEdit ? `${API_URL}/evaluaciones/${formData.id}` : `${API_URL}/evaluaciones`;
    const method = isEdit ? "PUT" : "POST";

    const payload = {
      ...formData,
      proyecto_id: Number(id),
      // backend viejo espera "estado" texto:
      estado: formData.etapa,
    };

    setGuardandoEval(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      let data = null;
      try { data = await res.json(); } catch {}

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(data?.error || data?.message || "Error HTTP al guardar");

      await fetchEvaluaciones();
      setModalShow(false);
    } catch (err) {
      console.error("Error al guardar evaluación:", err);
    } finally {
      setGuardandoEval(false);
    }
  };

  const volverAEditar = () => navigate(`/proyectos/${id}/editar`);
  const isVer = modo === "ver" || isClientReadOnly;

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3" style={{ rowGap: 8 }}>
        <div>
          <h2 className="mb-0">Evaluaciones del Proyecto {id}</h2>
          {isClientReadOnly && <div className="text-muted small">Modo cliente: solo lectura.</div>}
        </div>

        <div className="btn-group">
          <Button variant="outline-info" size="sm" onClick={() => navigate(`/proyectos/${id}/tabs?tab=bpm`)}>
            BPM Estadístico
          </Button>

          {!isClientReadOnly && (
            <Button variant="outline-secondary" size="sm" onClick={volverAEditar}>
              Volver a Editar
            </Button>
          )}

          {!isClientReadOnly && (
            <Button onClick={() => abrirModal("crear")} variant="success" size="sm">
              ➕ Nueva Evaluación
            </Button>
          )}
        </div>
      </div>

      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Etapa</th>
            <th>Sí/No</th>
            <th>Fecha</th>
            <th>Finalización</th>
            <th>Observaciones</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(evaluaciones) && evaluaciones.length > 0 ? (
            evaluaciones.map((item) => (
              <tr key={item.id}>
                <td>{item.categoria}</td>
                <td>{item.etapa ?? item.estado}</td>
                <td>{item.si_no ? "Sí" : "No"}</td>
                <td>{item.fecha ? String(item.fecha).split("T")[0] : ""}</td>
                <td>{item.fecha_final ? String(item.fecha_final).split("T")[0] : ""}</td>
                <td>{item.observaciones}</td>
                <td>
                  {isClientReadOnly ? (
                    <Button size="sm" variant="outline-primary" onClick={() => abrirModal("ver", item)}>
                      Ver
                    </Button>
                  ) : (
                    <Button size="sm" variant="warning" onClick={() => abrirModal("editar", item)}>
                      Editar
                    </Button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="7" className="text-center">Sin registros</td>
            </tr>
          )}
        </tbody>
      </Table>

      {/* MODAL EVALUACIÓN */}
      <Modal
        open={modalShow}
        onClose={() => setModalShow(false)}
        title={isVer ? "Ver Evaluación" : `${modo === "crear" ? "Nueva" : "Editar"} Evaluación`}
      >
        <Form>
          <Form.Group className="mb-2">
            <Form.Label>Categoría</Form.Label>
            <Form.Control name="categoria" value={formData.categoria} onChange={handleChange} disabled={isVer} />
          </Form.Group>

          <Form.Group className="mb-2">
            <div className="d-flex justify-content-between align-items-center">
              <Form.Label className="mb-1">Etapa</Form.Label>

              {!isVer && (
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={() => {
                    setNuevoEstado({ concepto: "", nombre: "" });
                    setMsgEstado("");
                    setModalNuevoEstado(true);
                  }}
                >
                  ➕ Nuevo estado
                </Button>
              )}
            </div>

            <Form.Select
              name="etapa"
              value={formData.etapa || ""}
              onChange={handleChange}
              disabled={isVer || loadingEstados}
            >
              <option value="">-- Seleccionar --</option>
              {estados.map((x) => (
                <option key={`${x.tipoconcepto}-${x.concepto}`} value={x.nombre}>
                  {x.concepto} - {x.nombre}
                </option>
              ))}
            </Form.Select>

            {loadingEstados && (
              <div className="small text-muted mt-1">
                <Spinner size="sm" /> Cargando estados...
              </div>
            )}

            {!!msgEstado && (
              <Alert className="mt-2 mb-0 py-2" variant={msgEstado.includes("✅") ? "success" : "danger"}>
                {msgEstado}
              </Alert>
            )}
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
            <Form.Control type="date" name="fecha" value={formData.fecha || ""} onChange={handleChange} disabled={isVer} />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label>Fecha Final</Form.Label>
            <Form.Control type="date" name="fecha_final" value={formData.fecha_final || ""} onChange={handleChange} disabled={isVer} />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label>Observaciones</Form.Label>
            <Form.Control as="textarea" name="observaciones" value={formData.observaciones} onChange={handleChange} disabled={isVer} />
          </Form.Group>

          <div className="d-flex justify-content-end gap-2 mt-3">
            <Button variant="secondary" onClick={() => setModalShow(false)}>
              {isVer ? "Cerrar" : "Cancelar"}
            </Button>

            {!isVer && (
              <Button variant="primary" onClick={guardar} disabled={guardandoEval}>
                {guardandoEval ? (
                  <>
                    <Spinner size="sm" className="me-2" /> Guardando...
                  </>
                ) : (
                  "Guardar"
                )}
              </Button>
            )}
          </div>
        </Form>
      </Modal>

      {/* MODAL NUEVO ESTADO */}
      <Modal
        open={modalNuevoEstado}
        onClose={() => setModalNuevoEstado(false)}
        title="Nuevo Estado (PROYECTO_ESTADO)"
      >
        <Form>
          <Form.Group className="mb-2">
            <Form.Label>Código (concepto)</Form.Label>
            <Form.Control
              placeholder="Ej: 09.1"
              value={nuevoEstado.concepto}
              onChange={(e) => setNuevoEstado((s) => ({ ...s, concepto: e.target.value }))}
              disabled={guardandoEstado}
            />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label>Nombre</Form.Label>
            <Form.Control
              placeholder="Ej: Reingreso a Mesa de Entrada"
              value={nuevoEstado.nombre}
              onChange={(e) => setNuevoEstado((s) => ({ ...s, nombre: e.target.value }))}
              disabled={guardandoEstado}
            />
          </Form.Group>

          <div className="d-flex justify-content-end gap-2 mt-3">
            <Button variant="secondary" onClick={() => setModalNuevoEstado(false)} disabled={guardandoEstado}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={crearNuevoEstado} disabled={guardandoEstado}>
              {guardandoEstado ? (
                <>
                  <Spinner size="sm" className="me-2" /> Creando...
                </>
              ) : (
                "Crear"
              )}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
