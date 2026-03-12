// src/pages/Regencia.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Table, Form, Row, Col, Badge, Alert } from "react-bootstrap";

import {
  listarActividades,
  obtenerContratoActivo,
  listarContratos,
  crearActividad,
  actualizarActividad,
  listarResponsables, // ✅ NUEVO (agregar en regencia.service.js)
} from "@/services/regencia.service";

import ModalActividad from "@/components/regencia/ModalActividad";

// ✅ roles helper (tomamos del localStorage como ya usás en App)
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

const TIPOS = [
  { value: "", label: "Todos" },
  { value: "VISITA", label: "Visita" },
  { value: "ENTREGA_INFORME", label: "Entrega de informe" },
  { value: "AUDITORIA", label: "Auditoría" },
  { value: "UNICA", label: "Actividad única" },
];

const ESTADOS = [
  { value: "", label: "Todos" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "REALIZADA", label: "Realizada" },
  { value: "CANCELADA", label: "Cancelada" },
];

function fmt(dt) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function estadoBadge(estado) {
  if (estado === "REALIZADA") return <Badge bg="success">Realizada</Badge>;
  if (estado === "CANCELADA") return <Badge bg="secondary">Cancelada</Badge>;
  return (
    <Badge bg="warning" text="dark">
      Pendiente
    </Badge>
  );
}

function contratoVigente(contrato) {
  if (!contrato) return false;
  if (String(contrato.estado || "").toUpperCase() !== "ACTIVO") return false;
  const fin = new Date(contrato.fecha_fin);
  if (isNaN(fin.getTime())) return false;
  const hoy = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const fin0 = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate());
  return fin0.getTime() >= hoy0.getTime();
}

export default function Regencia() {
  const { id } = useParams(); // /proyectos/:id/regencia
  const id_proyecto = id;
  const navigate = useNavigate();

  // ✅ detectar si es cliente (solo lectura)
  const me = useMemo(() => getUserFromStorage(), []);
  const tipo = useMemo(() => Number(me?.tipo_usuario), [me]);
  const isClientReadOnly = useMemo(
    () => [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipo),
    [tipo]
  );

  const storageKey = useMemo(() => `regencia:${id_proyecto}:contrato_sel`, [id_proyecto]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  // contratos
  const [loadingContrato, setLoadingContrato] = useState(false);
  const [contratoActivo, setContratoActivo] = useState(null);
  const [contratos, setContratos] = useState([]);
  const [id_contrato, setIdContrato] = useState(() => {
    const v = localStorage.getItem(storageKey);
    return v ? Number(v) : null;
  });

  // modal
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState("crear"); // crear|editar|ver
  const [selected, setSelected] = useState(null);

  // ✅ responsables del registro seleccionado (para editar/ver)
  const [selectedResponsables, setSelectedResponsables] = useState([]);

  // filtros
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const canLoad = useMemo(() => !!id_proyecto, [id_proyecto]);

  const contratoSeleccionado = useMemo(() => {
    if (!id_contrato) return null;
    return contratos.find((c) => Number(c.id) === Number(id_contrato)) || null;
  }, [contratos, id_contrato]);

  const hasContratoVigente = useMemo(
    () => contratoVigente(contratoSeleccionado || contratoActivo),
    [contratoSeleccionado, contratoActivo]
  );

  const loadContratos = useCallback(async () => {
    if (!canLoad) return;

    setLoadingContrato(true);
    try {
      const [activo, lista] = await Promise.all([
        obtenerContratoActivo(id_proyecto),
        listarContratos(id_proyecto),
      ]);

      const arr = Array.isArray(lista) ? lista : [];
      setContratos(arr);
      setContratoActivo(activo || null);

      // restaurar selección
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setIdContrato(Number(stored));
      } else if (activo?.id) {
        setIdContrato(Number(activo.id));
        localStorage.setItem(storageKey, String(activo.id));
      } else {
        setIdContrato(null);
      }
    } catch (e) {
      console.error("Contratos load error:", e);
      setContratos([]);
      setContratoActivo(null);
      setIdContrato(null);
      localStorage.removeItem(storageKey);
    } finally {
      setLoadingContrato(false);
    }
  }, [canLoad, id_proyecto, storageKey]);

  const load = useCallback(async () => {
    if (!canLoad) return;

    setLoading(true);
    try {
      const data = await listarActividades({
        id_proyecto,
        id_contrato: id_contrato || null,
        estado: fEstado || null,
        tipo: fTipo || null,
        q: q || null,
        desde: desde || null,
        hasta: hasta || null,
      });

      const list = Array.isArray(data) ? data : data?.rows || data?.data || [];
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("Regencia load error:", e);
      alert(e?.message || "Error cargando actividades");
    } finally {
      setLoading(false);
    }
  }, [canLoad, id_proyecto, id_contrato, fEstado, fTipo, q, desde, hasta]);

  useEffect(() => {
    loadContratos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id_proyecto]);

  useEffect(() => {
    if (!id_proyecto) return;
    if (!id_contrato) {
      setRows([]);
      return;
    }
    load();
  }, [id_proyecto, id_contrato, load]);

  const goContratos = () => navigate(`/proyectos/${id_proyecto}/regencia/contratos`);

  const onNuevaActividad = () => {
    if (isClientReadOnly) return;
    if (!hasContratoVigente) return;
    if (!id_contrato) return;

    setSelected(null);
    setSelectedResponsables([]); // ✅ limpiar
    setModalMode("crear");
    setOpenModal(true);
  };

  const headerContrato = () => {
    if (loadingContrato) return <span className="text-muted">Cargando contratos…</span>;
    if (!contratos.length) return <Badge bg="danger">Sin contratos</Badge>;
    if (!id_contrato) return <Badge bg="warning" text="dark">Elegí un contrato</Badge>;

    const c = contratoSeleccionado;
    if (!c) return <Badge bg="warning" text="dark">Elegí un contrato</Badge>;

    const vigente = contratoVigente(c);
    return (
      <span className="d-inline-flex align-items-center gap-2">
        <Badge bg={vigente ? "success" : "danger"}>
          {vigente ? "Contrato vigente" : "Contrato vencido"}
        </Badge>
        <span className="text-muted small">
          #{c.id} • <strong>{c.titulo || "Sin título"}</strong> • Vence:{" "}
          <strong>{c.fecha_fin}</strong>
        </span>
      </span>
    );
  };

  function handleChangeContrato(e) {
    const v = e.target.value ? Number(e.target.value) : null;
    setIdContrato(v);
    if (v) localStorage.setItem(storageKey, String(v));
    else localStorage.removeItem(storageKey);
  }

  // ✅ abrir ver/editar cargando responsables
  async function openVerEditar(row, mode) {
    setSelected(row);
    setModalMode(mode);

    try {
      const resp = await listarResponsables(row.id);
      const list = Array.isArray(resp) ? resp : resp?.rows || resp?.data || [];
      setSelectedResponsables(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("No se pudieron cargar responsables:", e?.message);
      setSelectedResponsables([]);
    }

    setOpenModal(true);
  }

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0">Actividades de Regencia</h4>
          <div className="text-muted">Proyecto: {id_proyecto}</div>
          <div className="mt-1">{headerContrato()}</div>

          {isClientReadOnly && (
            <div className="text-muted small mt-1">Modo cliente: solo lectura.</div>
          )}
        </div>

        <div className="d-flex gap-2">
          <Button
            variant="outline-secondary"
            onClick={() => {
              loadContratos();
              load();
            }}
            disabled={loading}
          >
            {loading || loadingContrato ? "Actualizando…" : "Actualizar"}
          </Button>

          <Button
            variant={contratos.length ? "outline-primary" : "primary"}
            onClick={goContratos}
          >
            Ver contratos
          </Button>

          {!isClientReadOnly && (
            <Button
              variant="success"
              onClick={onNuevaActividad}
              disabled={!hasContratoVigente || !id_contrato || loading}
            >
              + Nueva actividad
            </Button>
          )}
        </div>
      </div>

      {!hasContratoVigente && (
        <Alert variant="warning">
          <div className="fw-semibold">Regencia bloqueada</div>
          <div className="small">
            Para crear o ejecutar actividades, el proyecto debe tener un{" "}
            <strong>contrato ACTIVO y vigente</strong> seleccionado.
            {!isClientReadOnly && (
              <>
                {" "}
                Entrá a <strong>Contratos</strong> para crear o renovar.
              </>
            )}
          </div>
        </Alert>
      )}

      {/* selector contrato */}
      <div className="card mb-3">
        <div className="card-body">
          <Row className="g-2 align-items-end">
            <Col md={8}>
              <Form.Label className="fw-semibold mb-1">Contrato</Form.Label>
              <Form.Select value={id_contrato || ""} onChange={handleChangeContrato}>
                <option value="">— Seleccionar contrato —</option>
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} • {c.titulo || "Sin título"} • {c.fecha_inicio || "-"} →{" "}
                    {c.fecha_fin} • {c.estado}
                  </option>
                ))}
              </Form.Select>
              <div className="text-muted small mt-1">Se guarda automáticamente para este proyecto.</div>
            </Col>

            <Col md={4} className="text-end">
              {contratoSeleccionado ? (
                <>
                  <div className="fw-semibold">{contratoSeleccionado.titulo || "Sin título"}</div>
                  <div className="text-muted small">{contratoSeleccionado.observacion || "—"}</div>
                </>
              ) : (
                <div className="text-muted">Seleccioná un contrato para ver actividades.</div>
              )}
            </Col>
          </Row>
        </div>
      </div>

      {/* Filtros */}
      <div className="card mb-3">
        <div className="card-body">
          <Row className="g-2">
            <Col md={3}>
              <Form.Control
                placeholder="Buscar (título/desc)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </Col>

            <Col md={2}>
              <Form.Select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Form.Select>
            </Col>

            <Col md={2}>
              <Form.Select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                {ESTADOS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Form.Select>
            </Col>

            <Col md={2}>
              <Form.Control type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </Col>

            <Col md={2}>
              <Form.Control type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </Col>

            <Col md={1} className="d-grid">
              <Button
                variant="success"
                onClick={load}
                disabled={loading || !id_contrato}
                title={!id_contrato ? "Seleccioná un contrato" : ""}
              >
                {loading ? "..." : "Filtrar"}
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-body p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th style={{ width: 90 }}>ID</th>
                <th>Título</th>
                <th style={{ width: 150 }}>Tipo</th>
                <th style={{ width: 220 }}>Inicio</th>
                <th style={{ width: 220 }}>Fin</th>
                <th style={{ width: 140 }}>Estado</th>
                <th style={{ width: isClientReadOnly ? 140 : 220 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!id_contrato ? (
                <tr>
                  <td colSpan={7} className="text-center p-4 text-muted">
                    Seleccioná un contrato para ver las actividades.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center p-4 text-muted">
                    {loading ? "Cargando..." : "Sin actividades"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id ?? `${r.titulo}-${r.inicio_at}`}>
                    <td>{r.id}</td>
                    <td>
                      <div className="fw-semibold">{r.titulo}</div>
                      {r.descripcion ? <div className="text-muted small">{r.descripcion}</div> : null}
                    </td>
                    <td>{r.tipo}</td>
                    <td>{fmt(r.inicio_at)}</td>
                    <td>{fmt(r.fin_at)}</td>
                    <td>{estadoBadge(r.estado)}</td>
                    <td>
                      <div className="btn-group">
                        <Button size="sm" variant="outline-primary" onClick={() => openVerEditar(r, "ver")}>
                          Ver
                        </Button>

                        {!isClientReadOnly && (
                          <>
                            <Button
                              size="sm"
                              variant="outline-warning"
                              disabled={!hasContratoVigente}
                              onClick={() => openVerEditar(r, "editar")}
                            >
                              Editar
                            </Button>

                            <Button size="sm" variant="outline-success" disabled={!hasContratoVigente}>
                              Realizada
                            </Button>

                            <Button size="sm" variant="outline-secondary" disabled={!hasContratoVigente}>
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>

      {/* ✅ MODAL: para clientes siempre abrir en "ver" */}
      <ModalActividad
        show={openModal}
        onHide={() => setOpenModal(false)}
        mode={isClientReadOnly ? "ver" : modalMode}
        id_proyecto={id_proyecto}
        initialData={{
          ...(selected || null),
          responsables: selectedResponsables, // ✅ pasa responsables cargados
        }}
        onSubmit={async (payload) => {
          if (modalMode === "editar" && selected?.id) {
            await actualizarActividad(selected.id, { ...payload, id_contrato });
          } else {
            await crearActividad({ ...payload, id_contrato });
          }
          setOpenModal(false);
          await load();
        }}
      />
    </div>
  );
}
