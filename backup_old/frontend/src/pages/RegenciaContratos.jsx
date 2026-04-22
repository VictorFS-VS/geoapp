// src/pages/RegenciaContratos.jsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Table, Form, Row, Col, Badge } from "react-bootstrap";
import {
  obtenerContratoActivo,
  listarContratos,
  crearContrato,
  actualizarContrato,
} from "@/services/regencia.service";
import { alerts } from "@/utils/alerts";

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

function badgeEstado(estado) {
  if (estado === "ACTIVO") return <Badge bg="success">ACTIVO</Badge>;
  if (estado === "VENCIDO") return <Badge bg="danger">VENCIDO</Badge>;
  if (estado === "CERRADO") return <Badge bg="secondary">CERRADO</Badge>;
  return <Badge bg="secondary">{estado || "—"}</Badge>;
}

export default function RegenciaContratos() {
  const navigate = useNavigate();
  const { id } = useParams(); // /proyectos/:id/regencia/contratos
  const id_proyecto = id;

  // ✅ detectar si es cliente (solo lectura)
  const me = useMemo(() => getUserFromStorage(), []);
  const tipo = useMemo(() => Number(me?.tipo_usuario), [me]);
  const isClientReadOnly = useMemo(
    () => [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipo),
    [tipo]
  );

  const [loading, setLoading] = useState(false);
  const [contratoActivo, setContratoActivo] = useState(null);
  const [rows, setRows] = useState([]);

  // form crear/renovar
  const [titulo, setTitulo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [fecha_inicio, setFechaInicio] = useState("");
  const [fecha_fin, setFechaFin] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [activo, lista] = await Promise.all([
        obtenerContratoActivo(id_proyecto),
        listarContratos(id_proyecto),
      ]);
      setContratoActivo(activo || null);
      setRows(Array.isArray(lista) ? lista : []);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error
        ? alerts.toast.error(e?.message || "Error cargando contratos")
        : alert(e?.message || "Error cargando contratos");
    } finally {
      setLoading(false);
    }
  }, [id_proyecto]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCrear() {
    // ✅ clientes NO crean
    if (isClientReadOnly) return;
    if (!id_proyecto) return;

    if (!fecha_fin) {
      alerts?.toast?.warning
        ? alerts.toast.warning("fecha_fin es obligatoria")
        : alert("fecha_fin es obligatoria");
      return;
    }

    try {
      await crearContrato({
        id_proyecto: Number(id_proyecto),
        titulo: titulo || null,
        observacion: observacion || null,
        fecha_inicio: fecha_inicio || null,
        fecha_fin,
      });

      setTitulo("");
      setObservacion("");
      setFechaInicio("");
      setFechaFin("");

      await load();

      alerts?.toast?.success
        ? alerts.toast.success("Contrato creado/renovado ✅")
        : alert("Contrato creado/renovado ✅");
    } catch (e) {
      console.error(e);
      alerts?.toast?.error
        ? alerts.toast.error(e?.message || "Error creando contrato")
        : alert(e?.message || "Error creando contrato");
    }
  }

  async function handleSetEstado(row, estado) {
    // ✅ clientes NO cambian estado
    if (isClientReadOnly) return;

    if (!row?.id) return;
    const ok = confirm(`¿Cambiar estado del contrato ${row.id} a ${estado}?`);
    if (!ok) return;

    try {
      await actualizarContrato(row.id, { estado });
      await load();
      alerts?.toast?.success
        ? alerts.toast.success(`Estado actualizado a ${estado}.`)
        : null;
    } catch (e) {
      console.error(e);
      alerts?.toast?.error
        ? alerts.toast.error(e?.message || "Error actualizando contrato")
        : alert(e?.message || "Error actualizando contrato");
    }
  }

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0">Contratos de Regencia</h4>
          <div className="text-muted">Proyecto: {id_proyecto}</div>
          {isClientReadOnly && (
            <div className="text-muted small mt-1">Modo cliente: solo lectura.</div>
          )}
        </div>

        <div className="d-flex gap-2">
          <Button
            variant="outline-primary"
            onClick={() => navigate(`/proyectos/${id_proyecto}/regencia`)}
          >
            ⬅ Volver a Regencia
          </Button>

          <Button variant="outline-secondary" onClick={load} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      </div>

      {/* Contrato activo */}
      <div className="card mb-3">
        <div className="card-body">
          <div className="fw-semibold mb-2">Contrato activo</div>
          {contratoActivo ? (
            <div className="d-flex flex-column gap-1">
              <div className="d-flex gap-3 align-items-center flex-wrap">
                <div>ID: {contratoActivo.id}</div>
                <div>Inicio: {contratoActivo.fecha_inicio || "-"}</div>
                <div>Fin: {contratoActivo.fecha_fin}</div>
                <div>{badgeEstado(contratoActivo.estado)}</div>
              </div>

              {contratoActivo.titulo ? (
                <div>
                  <strong>Título:</strong> {contratoActivo.titulo}
                </div>
              ) : null}

              {contratoActivo.observacion ? (
                <div className="text-muted small">
                  <strong>Obs:</strong> {contratoActivo.observacion}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted">No hay contrato ACTIVO.</div>
          )}
        </div>
      </div>

      {/* Crear / Renovar (oculto para clientes) */}
      {!isClientReadOnly && (
        <div className="card mb-3">
          <div className="card-body">
            <div className="fw-semibold mb-2">Crear / Renovar contrato</div>

            <Row className="g-2">
              <Col md={3}>
                <Form.Control
                  type="text"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Título (opcional) ej: Regencia 2026"
                  title="titulo (opcional)"
                />
              </Col>

              <Col md={3}>
                <Form.Control
                  type="date"
                  value={fecha_inicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  placeholder="Fecha inicio"
                  title="fecha_inicio (opcional)"
                />
              </Col>

              <Col md={3}>
                <Form.Control
                  type="date"
                  value={fecha_fin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  placeholder="Fecha fin"
                  title="fecha_fin (obligatorio)"
                />
              </Col>

              <Col md={3} className="d-grid">
                <Button variant="primary" onClick={handleCrear} disabled={loading}>
                  Guardar contrato
                </Button>
              </Col>

              <Col md={12}>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Observación (opcional)"
                />
              </Col>
            </Row>

            <div className="text-muted small mt-2">
              Al crear un contrato nuevo, el backend cierra el ACTIVO anterior y deja este como ACTIVO.
            </div>
          </div>
        </div>
      )}

      {/* Tabla contratos */}
      <div className="card">
        <div className="card-body p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th style={{ width: 90 }}>ID</th>
                <th style={{ minWidth: 220 }}>Título</th>
                <th style={{ width: 140 }}>Inicio</th>
                <th style={{ width: 140 }}>Fin</th>
                <th style={{ width: 140 }}>Estado</th>
                <th style={{ width: 260 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center p-4 text-muted">
                    {loading ? "Cargando..." : "Sin contratos"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>
                      <div className="fw-semibold">{r.titulo || "-"}</div>
                      {r.observacion ? (
                        <div className="text-muted small">{r.observacion}</div>
                      ) : null}
                    </td>
                    <td>{r.fecha_inicio || "-"}</td>
                    <td>{r.fecha_fin}</td>
                    <td>{badgeEstado(r.estado)}</td>
                    <td>
                      {isClientReadOnly ? (
                        <span className="text-muted small">Solo lectura</span>
                      ) : (
                        <div className="btn-group">
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => handleSetEstado(r, "CERRADO")}
                            disabled={r.estado === "CERRADO"}
                          >
                            Cerrar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            onClick={() => handleSetEstado(r, "VENCIDO")}
                            disabled={r.estado === "VENCIDO"}
                          >
                            Vencer
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
