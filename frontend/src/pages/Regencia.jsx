import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Table,
  Form,
  Row,
  Col,
  Badge,
  Alert,
  Card,
  InputGroup,
  ButtonGroup,
  Spinner,
} from "react-bootstrap";

import {
  listarActividades,
  obtenerContratoActivo,
  listarContratos,
  crearActividad,
  actualizarActividad,
  listarResponsables,
} from "@/services/regencia.service";

import ModalActividad from "@/components/regencia/ModalActividad";

const GROUPS = {
  ADMIN: 1,
  CONSULTOR: 8,
  CLIENTE: 9,
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,
};

const TIPOS = [
  { value: "", label: "Todos los tipos" },
  { value: "VISITA", label: "Visita" },
  { value: "ENTREGA_INFORME", label: "Entrega de informe" },
  { value: "AUDITORIA", label: "Auditoría" },
  { value: "UNICA", label: "Actividad única" },
];

const ESTADOS = [
  { value: "", label: "Todos los estados" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "REALIZADA", label: "Realizada" },
  { value: "CANCELADA", label: "Cancelada" },
];

const DAY_NAMES_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function getUserFromStorage() {
  try {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toDateSafe(v) {
  if (!v) return null;
  const d = v instanceof Date ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtHour(dateValue) {
  const d = toDateSafe(dateValue);
  if (!d) return "-";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTime(dateValue) {
  const d = toDateSafe(dateValue);
  if (!d) return "-";
  return d.toLocaleString("es-PY", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function fmtMonthYear(dateValue) {
  const d = toDateSafe(dateValue);
  if (!d) return "-";
  const raw = d.toLocaleDateString("es-PY", {
    month: "long",
    year: "numeric",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function fmtDayLabel(dateValue) {
  const d = toDateSafe(dateValue);
  if (!d) return "-";
  return d.toLocaleDateString("es-PY", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function sameDay(dateValue, selectedDate) {
  const d = toDateSafe(dateValue);
  if (!d || !selectedDate) return false;

  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}` === selectedDate;
}

function startOfWeek(dateValue) {
  const d = toDateSafe(dateValue) || new Date();
  const copy = new Date(d);
  const day = copy.getDay(); // 0 dom, 1 lun...
  const diff = day === 0 ? -6 : 1 - day; // lunes
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function endOfWeek(dateValue) {
  const start = startOfWeek(dateValue);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfMonth(dateValue) {
  const d = toDateSafe(dateValue) || new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(dateValue) {
  const d = toDateSafe(dateValue) || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isInWeek(dateValue, selectedDate) {
  const d = toDateSafe(dateValue);
  if (!d || !selectedDate) return false;
  const start = startOfWeek(selectedDate);
  const end = endOfWeek(selectedDate);
  return d >= start && d <= end;
}

function isSameMonth(dateValue, selectedDate) {
  const d = toDateSafe(dateValue);
  const s = toDateSafe(selectedDate);
  if (!d || !s) return false;
  return d.getFullYear() === s.getFullYear() && d.getMonth() === s.getMonth();
}

function contratoVigente(contrato) {
  if (!contrato) return false;
  if (String(contrato.estado || "").toUpperCase() !== "ACTIVO") return false;

  const fin = new Date(contrato.fecha_fin);
  if (Number.isNaN(fin.getTime())) return false;

  const hoy = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const fin0 = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate());

  return fin0 >= hoy0;
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

function estadoClass(estado) {
  if (estado === "REALIZADA") return "estado-realizada";
  if (estado === "CANCELADA") return "estado-cancelada";
  return "estado-pendiente";
}

function resumenEstados(rows) {
  return {
    total: rows.length,
    pendientes: rows.filter((x) => x.estado === "PENDIENTE").length,
    realizadas: rows.filter((x) => x.estado === "REALIZADA").length,
    canceladas: rows.filter((x) => x.estado === "CANCELADA").length,
  };
}

function extractResponsableNombre(r) {
  if (!r) return null;

  const full = [
    r.first_name || r.firstname || r.nombres,
    r.last_name || r.lastname || r.apellidos,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (full) return full;

  const direct =
    r.nombre ||
    r.full_name ||
    r.display_name ||
    r.name ||
    r.label ||
    r.responsable;

  if (direct) return String(direct).trim();

  const fallback = r.usuario || r.username || r.user_name || r.email;
  return fallback ? String(fallback).trim() : null;
}

function getResponsableNombre(actividad) {
  if (!actividad) return "Sin responsable";
  if (actividad.responsable_nombre) return actividad.responsable_nombre;

  if (Array.isArray(actividad.responsables) && actividad.responsables.length > 0) {
    return extractResponsableNombre(actividad.responsables[0]) || "Sin responsable";
  }

  return "Sin responsable";
}

function getCardBorderClass(estado) {
  if (estado === "REALIZADA") return "actividad-card-realizada";
  if (estado === "CANCELADA") return "actividad-card-cancelada";
  return "actividad-card-pendiente";
}

function getViewTitle(viewMode) {
  if (viewMode === "mes") return "Regencia · Actividades del mes";
  if (viewMode === "semana") return "Regencia · Actividades de la semana";
  if (viewMode === "dia") return "Regencia · Actividades del día";
  return "Regencia · Listado de actividades";
}

export default function Regencia() {
  const { id } = useParams();
  const id_proyecto = id;
  const navigate = useNavigate();

  const me = useMemo(() => getUserFromStorage(), []);
  const tipoUsuario = useMemo(() => Number(me?.tipo_usuario), [me]);

  const isClientReadOnly = useMemo(
    () =>
      [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipoUsuario),
    [tipoUsuario]
  );

  const storageKey = useMemo(
    () => `regencia:${id_proyecto}:contrato_sel`,
    [id_proyecto]
  );

  const [viewMode, setViewMode] = useState("mes");
  const [loading, setLoading] = useState(false);
  const [loadingContrato, setLoadingContrato] = useState(false);

  const [rows, setRows] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [contratoActivo, setContratoActivo] = useState(null);
  const [id_contrato, setIdContrato] = useState(() => {
    const v = localStorage.getItem(
      `regencia:${window.location.pathname.split("/")[2]}:contrato_sel`
    );
    return v ? Number(v) : null;
  });

  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState("crear");
  const [selected, setSelected] = useState(null);
  const [selectedResponsables, setSelectedResponsables] = useState([]);

  const [selectedDate, setSelectedDate] = useState(fmtDateInput(new Date()));
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [q, setQ] = useState("");

  const contratoSeleccionado = useMemo(() => {
    return contratos.find((c) => Number(c.id) === Number(id_contrato)) || null;
  }, [contratos, id_contrato]);

  const hasContratoVigente = useMemo(
    () => contratoVigente(contratoSeleccionado || contratoActivo),
    [contratoSeleccionado, contratoActivo]
  );

  const resumen = useMemo(() => resumenEstados(rows), [rows]);

  const selectedDateObj = useMemo(
    () => toDateSafe(`${selectedDate}T00:00:00`) || new Date(),
    [selectedDate]
  );

  const loadContratos = useCallback(async () => {
    if (!id_proyecto) return;

    setLoadingContrato(true);
    try {
      const [activo, lista] = await Promise.all([
        obtenerContratoActivo(id_proyecto),
        listarContratos(id_proyecto),
      ]);

      const arr = Array.isArray(lista) ? lista : [];
      setContratos(arr);
      setContratoActivo(activo || null);

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
      console.error("Error cargando contratos:", e);
      setContratos([]);
      setContratoActivo(null);
      setIdContrato(null);
      localStorage.removeItem(storageKey);
    } finally {
      setLoadingContrato(false);
    }
  }, [id_proyecto, storageKey]);

  const load = useCallback(async () => {
    if (!id_proyecto || !id_contrato) {
      setRows([]);
      return;
    }

    setLoading(true);
    try {
      const data = await listarActividades({
        id_proyecto,
        id_contrato,
        estado: fEstado || null,
        tipo: fTipo || null,
        q: q || null,
      });

      const list = Array.isArray(data) ? data : data?.rows || data?.data || [];
      const baseRows = Array.isArray(list) ? list : [];

      const enriched = await Promise.all(
        baseRows.map(async (r) => {
          try {
            const resp = await listarResponsables(r.id);
            const responsables = Array.isArray(resp)
              ? resp
              : resp?.rows || resp?.data || [];

            const primerResponsable =
              Array.isArray(responsables) && responsables.length > 0
                ? extractResponsableNombre(responsables[0])
                : null;

            return {
              ...r,
              responsables,
              responsable_nombre: primerResponsable || null,
            };
          } catch (e) {
            console.warn("No se pudieron cargar responsables para actividad", r.id, e);
            return {
              ...r,
              responsables: [],
              responsable_nombre: null,
            };
          }
        })
      );

      setRows(enriched);
    } catch (e) {
      console.error("Error cargando actividades:", e);
      alert(e?.message || "Error cargando actividades");
    } finally {
      setLoading(false);
    }
  }, [id_proyecto, id_contrato, fEstado, fTipo, q]);

  useEffect(() => {
    loadContratos();
  }, [loadContratos]);

  useEffect(() => {
    if (id_contrato) load();
    else setRows([]);
  }, [id_contrato, load]);

  function handleChangeContrato(e) {
    const v = e.target.value ? Number(e.target.value) : null;
    setIdContrato(v);
    if (v) localStorage.setItem(storageKey, String(v));
    else localStorage.removeItem(storageKey);
  }

  async function openVerEditar(row, mode) {
    if (!row) return;

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

  function onNuevaActividad(prefill = null) {
    if (isClientReadOnly || !hasContratoVigente || !id_contrato) return;

    setSelected(prefill || null);
    setSelectedResponsables([]);
    setModalMode("crear");
    setOpenModal(true);
  }

  function movePeriod(step) {
    const base = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();

    if (viewMode === "mes") {
      base.setMonth(base.getMonth() + step);
    } else if (viewMode === "semana") {
      base.setDate(base.getDate() + step * 7);
    } else {
      base.setDate(base.getDate() + step);
    }

    setSelectedDate(fmtDateInput(base));
  }

  const rowsForSelectedDay = useMemo(() => {
    return rows
      .filter((r) => sameDay(r.inicio_at, selectedDate))
      .sort((a, b) => {
        const da = toDateSafe(a.inicio_at)?.getTime() || 0;
        const db = toDateSafe(b.inicio_at)?.getTime() || 0;
        return da - db;
      });
  }, [rows, selectedDate]);

  const rowsForSelectedWeek = useMemo(() => {
    return rows
      .filter((r) => isInWeek(r.inicio_at, selectedDate))
      .sort((a, b) => {
        const da = toDateSafe(a.inicio_at)?.getTime() || 0;
        const db = toDateSafe(b.inicio_at)?.getTime() || 0;
        return da - db;
      });
  }, [rows, selectedDate]);

  const rowsForSelectedMonth = useMemo(() => {
    return rows
      .filter((r) => isSameMonth(r.inicio_at, selectedDate))
      .sort((a, b) => {
        const da = toDateSafe(a.inicio_at)?.getTime() || 0;
        const db = toDateSafe(b.inicio_at)?.getTime() || 0;
        return da - db;
      });
  }, [rows, selectedDate]);

  const groupedByHour = useMemo(() => {
    const map = new Map();

    rowsForSelectedDay.forEach((item) => {
      const key = fmtHour(item.inicio_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });

    return Array.from(map.entries()).map(([hora, items]) => ({
      hora,
      items,
    }));
  }, [rowsForSelectedDay]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDateObj);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDateObj]);

  const weekDaysWithItems = useMemo(() => {
    return weekDays.map((day) => {
      const key = fmtDateInput(day);
      return {
        date: day,
        key,
        items: rowsForSelectedWeek.filter((r) => sameDay(r.inicio_at, key)),
      };
    });
  }, [weekDays, rowsForSelectedWeek]);

  const monthGrid = useMemo(() => {
    const monthStart = startOfMonth(selectedDateObj);
    const monthEnd = endOfMonth(selectedDateObj);

    const gridStart = startOfWeek(monthStart);
    const gridEnd = endOfWeek(monthEnd);

    const cells = [];
    const cursor = new Date(gridStart);

    while (cursor <= gridEnd) {
      const current = new Date(cursor);
      const key = fmtDateInput(current);

      cells.push({
        date: current,
        key,
        inCurrentMonth:
          current.getMonth() === monthStart.getMonth() &&
          current.getFullYear() === monthStart.getFullYear(),
        isToday: sameDay(current, fmtDateInput(new Date())),
        isSelected: sameDay(current, selectedDate),
        items: rowsForSelectedMonth.filter((r) => sameDay(r.inicio_at, key)),
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return cells;
  }, [selectedDateObj, rowsForSelectedMonth, selectedDate]);

  function renderTopRangeLabel() {
    if (viewMode === "mes") {
      return (
        <>
          Mes seleccionado:{" "}
          <span className="text-primary">{fmtMonthYear(selectedDateObj)}</span>
        </>
      );
    }

    if (viewMode === "semana") {
      const ini = weekDays[0];
      const fin = weekDays[6];
      return (
        <>
          Semana:{" "}
          <span className="text-primary">
            {fmtDateInput(ini)} al {fmtDateInput(fin)}
          </span>
        </>
      );
    }

    return (
      <>
        Día seleccionado: <span className="text-primary">{selectedDate || "-"}</span>
      </>
    );
  }

  return (
    <div className="container-fluid py-3">
      <Card className="shadow-sm border-0 mb-3">
        <Card.Body>
          <div className="d-flex flex-column flex-lg-row justify-content-between align-items-lg-center gap-3">
            <div>
              <h3 className="mb-1">{getViewTitle(viewMode)}</h3>
              <div className="text-muted">
                Proyecto: <strong>{id_proyecto}</strong>
              </div>

              {contratoSeleccionado && (
                <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                  <Badge bg={hasContratoVigente ? "success" : "danger"}>
                    {hasContratoVigente ? "Contrato vigente" : "Contrato vencido"}
                  </Badge>
                  <span className="text-muted small">
                    #{contratoSeleccionado.id} ·{" "}
                    <strong>{contratoSeleccionado.titulo || "Sin título"}</strong>
                    {" · "}Vence: <strong>{contratoSeleccionado.fecha_fin || "-"}</strong>
                  </span>
                </div>
              )}

              {isClientReadOnly && (
                <div className="small text-muted mt-2">Modo cliente: solo lectura.</div>
              )}
            </div>

            <div className="d-flex flex-wrap gap-2">
              <ButtonGroup>
                <Button
                  variant={viewMode === "mes" ? "primary" : "outline-primary"}
                  onClick={() => setViewMode("mes")}
                >
                  Mes
                </Button>
                <Button
                  variant={viewMode === "semana" ? "primary" : "outline-primary"}
                  onClick={() => setViewMode("semana")}
                >
                  Semana
                </Button>
                <Button
                  variant={viewMode === "dia" ? "primary" : "outline-primary"}
                  onClick={() => setViewMode("dia")}
                >
                  Día
                </Button>
                <Button
                  variant={viewMode === "table" ? "primary" : "outline-primary"}
                  onClick={() => setViewMode("table")}
                >
                  Tabla
                </Button>
              </ButtonGroup>

              <Button
                variant="outline-secondary"
                onClick={() => {
                  loadContratos();
                  load();
                }}
                disabled={loading || loadingContrato}
              >
                {loading || loadingContrato ? "Actualizando..." : "Actualizar"}
              </Button>

              <Button
                variant="outline-dark"
                onClick={() => navigate(`/proyectos/${id_proyecto}/regencia/contratos`)}
              >
                Contratos
              </Button>

              {!isClientReadOnly && (
                <Button
                  variant="success"
                  onClick={() =>
                    onNuevaActividad({
                      inicio_at: `${selectedDate}T09:00:00`,
                      fin_at: `${selectedDate}T10:00:00`,
                    })
                  }
                  disabled={!hasContratoVigente || !id_contrato}
                >
                  + Nueva actividad
                </Button>
              )}
            </div>
          </div>
        </Card.Body>
      </Card>

      {!hasContratoVigente && (
        <Alert variant="warning" className="shadow-sm">
          <div className="fw-semibold">Regencia bloqueada</div>
          <div className="small">
            Para crear o ejecutar actividades, el proyecto debe tener un contrato
            <strong> ACTIVO y vigente</strong>.
          </div>
        </Alert>
      )}

      <Row className="g-3 mb-3">
        <Col lg={4}>
          <Card className="shadow-sm border-0 h-100">
            <Card.Body>
              <div className="fw-semibold mb-2">Contrato de trabajo</div>
              <Form.Select
                value={id_contrato || ""}
                onChange={handleChangeContrato}
                disabled={loadingContrato}
              >
                <option value="">— Seleccionar contrato —</option>
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.id} · {c.titulo || "Sin título"} · {c.fecha_fin || "-"} · {c.estado}
                  </option>
                ))}
              </Form.Select>

              <div className="small text-muted mt-2">
                El contrato seleccionado queda guardado para este proyecto.
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={8}>
          <Card className="shadow-sm border-0 h-100">
            <Card.Body>
              <Row className="g-2">
                <Col md={4}>
                  <Form.Label className="small fw-semibold mb-1">Buscar actividad</Form.Label>
                  <InputGroup>
                    <Form.Control
                      placeholder="Título o descripción"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") load();
                      }}
                    />
                    <Button variant="primary" onClick={load} disabled={!id_contrato}>
                      Buscar
                    </Button>
                  </InputGroup>
                </Col>

                <Col md={3}>
                  <Form.Label className="small fw-semibold mb-1">Fecha base</Form.Label>
                  <Form.Control
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </Col>

                <Col md={2}>
                  <Form.Label className="small fw-semibold mb-1">Tipo</Form.Label>
                  <Form.Select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                    {TIPOS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Form.Select>
                </Col>

                <Col md={2}>
                  <Form.Label className="small fw-semibold mb-1">Estado</Form.Label>
                  <Form.Select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                    {ESTADOS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Form.Select>
                </Col>

                <Col md={1} className="d-grid">
                  <Form.Label className="small fw-semibold mb-1 invisible">x</Form.Label>
                  <Button
                    variant="outline-secondary"
                    onClick={() => {
                      setQ("");
                      setFTipo("");
                      setFEstado("");
                    }}
                    title="Limpiar filtros"
                  >
                    ×
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col md={3}>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="text-muted small">Total</div>
              <div className="fs-3 fw-bold">{resumen.total}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="text-muted small">Pendientes</div>
              <div className="fs-3 fw-bold text-warning">{resumen.pendientes}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="text-muted small">Realizadas</div>
              <div className="fs-3 fw-bold text-success">{resumen.realizadas}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="text-muted small">Canceladas</div>
              <div className="fs-3 fw-bold text-secondary">{resumen.canceladas}</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {viewMode !== "table" && (
        <Card className="shadow-sm border-0 mb-3">
          <Card.Body className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div className="fw-semibold">{renderTopRangeLabel()}</div>

            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={() => movePeriod(-1)}>
                ← Anterior
              </Button>
              <Button
                variant="outline-primary"
                onClick={() => setSelectedDate(fmtDateInput(new Date()))}
              >
                Hoy
              </Button>
              <Button variant="outline-secondary" onClick={() => movePeriod(1)}>
                Siguiente →
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {viewMode === "mes" && (
        <Card className="shadow-sm border-0">
          <Card.Body>
            {!id_contrato ? (
              <div className="text-center text-muted py-5">
                Seleccioná un contrato para visualizar actividades.
              </div>
            ) : loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" />
                <div className="mt-2 text-muted">Cargando actividades...</div>
              </div>
            ) : (
              <>
                <div className="calendar-month-header">
                  {DAY_NAMES_SHORT.map((day) => (
                    <div key={day} className="calendar-month-weekday">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="calendar-month-grid">
                  {monthGrid.map((cell) => (
                    <div
                      key={cell.key}
                      className={[
                        "calendar-month-cell",
                        cell.inCurrentMonth ? "" : "calendar-month-cell-muted",
                        cell.isToday ? "calendar-month-cell-today" : "",
                        cell.isSelected ? "calendar-month-cell-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedDate(cell.key)}
                    >
                      <div className="calendar-month-cell-top">
                        <span className="calendar-month-daynum">{cell.date.getDate()}</span>
                        {!isClientReadOnly && cell.inCurrentMonth && (
                          <button
                            type="button"
                            className="mini-add-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDate(cell.key);
                              onNuevaActividad({
                                inicio_at: `${cell.key}T09:00:00`,
                                fin_at: `${cell.key}T10:00:00`,
                              });
                            }}
                            disabled={!hasContratoVigente || !id_contrato}
                            title="Nueva actividad"
                          >
                            +
                          </button>
                        )}
                      </div>

                      <div className="calendar-month-events">
                        {cell.items.slice(0, 3).map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`calendar-event-pill ${estadoClass(item.estado)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openVerEditar(item, "ver");
                            }}
                            title={`${fmtHour(item.inicio_at)} · ${item.titulo || "Sin título"}`}
                          >
                            <span className="calendar-event-hour">{fmtHour(item.inicio_at)}</span>
                            <span className="calendar-event-title">
                              {item.titulo || "Sin título"}
                            </span>
                          </button>
                        ))}

                        {cell.items.length > 3 && (
                          <div className="calendar-more">+{cell.items.length - 3} más</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card.Body>
        </Card>
      )}

      {viewMode === "semana" && (
        <Card className="shadow-sm border-0">
          <Card.Body>
            {!id_contrato ? (
              <div className="text-center text-muted py-5">
                Seleccioná un contrato para visualizar actividades.
              </div>
            ) : loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" />
                <div className="mt-2 text-muted">Cargando actividades...</div>
              </div>
            ) : (
              <div className="week-grid">
                {weekDaysWithItems.map((day) => (
                  <div key={day.key} className="week-col">
                    <div
                      className={`week-col-header ${sameDay(day.date, selectedDate) ? "active" : ""}`}
                      onClick={() => setSelectedDate(day.key)}
                    >
                      <div className="week-col-name">{fmtDayLabel(day.date)}</div>
                      <div className="week-col-count">{day.items.length} act.</div>
                    </div>

                    <div className="week-col-body">
                      {day.items.length === 0 ? (
                        <div className="text-muted small py-3 text-center">Sin actividades</div>
                      ) : (
                        day.items.map((item) => (
                          <div
                            key={item.id}
                            className={`actividad-card compact ${getCardBorderClass(item.estado)}`}
                            onClick={() => openVerEditar(item, "ver")}
                          >
                            <div className="actividad-card-header">
                              <div className="actividad-card-title">
                                {item.titulo || "Sin título"}
                              </div>
                              <div>{estadoBadge(item.estado)}</div>
                            </div>

                            <div className="actividad-card-meta">
                              <strong>Hora:</strong> {fmtHour(item.inicio_at)} -{" "}
                              {item.fin_at ? fmtHour(item.fin_at) : "-"}
                            </div>

                            <div className="actividad-card-meta">
                              <strong>Responsable:</strong> {getResponsableNombre(item)}
                            </div>

                            <div className="actividad-card-meta">
                              <strong>Tipo:</strong> {item.tipo || "-"}
                            </div>

                            {!isClientReadOnly && (
                              <div className="actividad-card-actions">
                                <Button
                                  size="sm"
                                  variant="outline-warning"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openVerEditar(item, "editar");
                                  }}
                                  disabled={!hasContratoVigente}
                                >
                                  Editar
                                </Button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {viewMode === "dia" && (
        <Card className="shadow-sm border-0">
          <Card.Body>
            {!id_contrato ? (
              <div className="text-center text-muted py-5">
                Seleccioná un contrato para visualizar actividades.
              </div>
            ) : loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" />
                <div className="mt-2 text-muted">Cargando actividades...</div>
              </div>
            ) : groupedByHour.length === 0 ? (
              <div className="text-center text-muted py-5">
                No hay actividades para esta fecha.
              </div>
            ) : (
              <div className="dia-groups">
                {groupedByHour.map((group) => (
                  <div key={group.hora} className="dia-group">
                    <div className="dia-group-hour">{group.hora}</div>

                    <div className="dia-group-items">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className={`actividad-card ${getCardBorderClass(item.estado)}`}
                          onClick={() => openVerEditar(item, "ver")}
                        >
                          <div className="actividad-card-header">
                            <div className="actividad-card-title">
                              {item.titulo || "Sin título"}
                            </div>
                            <div>{estadoBadge(item.estado)}</div>
                          </div>

                          <div className="actividad-card-meta">
                            <strong>Horario:</strong> {fmtHour(item.inicio_at)} -{" "}
                            {item.fin_at ? fmtHour(item.fin_at) : "-"}
                          </div>

                          <div className="actividad-card-meta">
                            <strong>Responsable:</strong> {getResponsableNombre(item)}
                          </div>

                          <div className="actividad-card-meta">
                            <strong>Tipo:</strong> {item.tipo || "-"}
                          </div>

                          {item.descripcion ? (
                            <div className="actividad-card-desc">{item.descripcion}</div>
                          ) : null}

                          {!isClientReadOnly && (
                            <div className="actividad-card-actions">
                              <Button
                                size="sm"
                                variant="outline-warning"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVerEditar(item, "editar");
                                }}
                                disabled={!hasContratoVigente}
                              >
                                Editar
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {viewMode === "table" && (
        <Card className="shadow-sm border-0">
          <Card.Body className="p-0">
            <Table responsive hover className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 80 }}>ID</th>
                  <th>Título</th>
                  <th style={{ width: 180 }}>Responsable</th>
                  <th style={{ width: 150 }}>Tipo</th>
                  <th style={{ width: 180 }}>Inicio</th>
                  <th style={{ width: 180 }}>Fin</th>
                  <th style={{ width: 130 }}>Estado</th>
                  <th style={{ width: 180 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {!id_contrato ? (
                  <tr>
                    <td colSpan={8} className="text-center p-4 text-muted">
                      Seleccioná un contrato para ver actividades.
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-4 text-muted">
                      {loading ? "Cargando..." : "Sin actividades"}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>
                        <div className="fw-semibold">{r.titulo}</div>
                        {r.descripcion ? (
                          <div className="text-muted small">{r.descripcion}</div>
                        ) : null}
                      </td>
                      <td>{getResponsableNombre(r)}</td>
                      <td>{r.tipo}</td>
                      <td>{fmtDateTime(r.inicio_at)}</td>
                      <td>{fmtDateTime(r.fin_at)}</td>
                      <td>{estadoBadge(r.estado)}</td>
                      <td>
                        <div className="d-flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline-primary"
                            onClick={() => openVerEditar(r, "ver")}
                          >
                            Ver
                          </Button>

                          {!isClientReadOnly && (
                            <Button
                              size="sm"
                              variant="outline-warning"
                              onClick={() => openVerEditar(r, "editar")}
                              disabled={!hasContratoVigente}
                            >
                              Editar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      <ModalActividad
        show={openModal}
        onHide={() => setOpenModal(false)}
        mode={isClientReadOnly ? "ver" : modalMode}
        id_proyecto={id_proyecto}
        initialData={{
          ...(selected || null),
          id_contrato,
          responsables: selectedResponsables,
        }}
        onSubmit={async (payload) => {
          try {
            if (modalMode === "editar" && selected?.id) {
              await actualizarActividad(selected.id, {
                ...payload,
                id_contrato,
              });
            } else {
              await crearActividad({
                ...payload,
                id_proyecto,
                id_contrato,
              });
            }

            setOpenModal(false);
            await load();
          } catch (e) {
            console.error(e);
            alert(e?.message || "No se pudo guardar la actividad");
          }
        }}
      />

      <style>{`
        .dia-groups {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .dia-group {
          display: grid;
          grid-template-columns: 100px 1fr;
          gap: 14px;
          align-items: start;
        }

        .dia-group-hour {
          position: sticky;
          top: 12px;
          background: #f6efe4;
          color: #6a4c2f;
          border: 1px solid #eadfce;
          border-radius: 14px;
          padding: 12px 10px;
          text-align: center;
          font-weight: 800;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }

        .dia-group-items {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .actividad-card {
          border: 1px solid #ece7df;
          border-left: 5px solid transparent;
          border-radius: 16px;
          padding: 14px;
          background: #fff;
          box-shadow: 0 3px 12px rgba(0,0,0,0.05);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .actividad-card.compact {
          padding: 12px;
        }

        .actividad-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(0,0,0,0.08);
        }

        .actividad-card-pendiente {
          background: #fffaf0;
          border-left-color: #d39e00;
        }

        .actividad-card-realizada {
          background: #eefbf3;
          border-left-color: #198754;
        }

        .actividad-card-cancelada {
          background: #f7f7f8;
          border-left-color: #6c757d;
        }

        .actividad-card-header {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 12px;
          margin-bottom: 10px;
        }

        .actividad-card-title {
          font-size: 1rem;
          font-weight: 800;
          color: #2f241a;
        }

        .actividad-card-meta {
          font-size: 0.92rem;
          color: #5f5b57;
          margin-bottom: 6px;
        }

        .actividad-card-desc {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed #ddd2c4;
          color: #4b4b4b;
          font-size: 0.92rem;
        }

        .actividad-card-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }

        .calendar-month-header {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 10px;
        }

        .calendar-month-weekday {
          text-align: center;
          font-weight: 700;
          color: #6a4c2f;
          background: #f6efe4;
          border: 1px solid #eadfce;
          border-radius: 12px;
          padding: 10px 6px;
        }

        .calendar-month-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
        }

        .calendar-month-cell {
          min-height: 150px;
          border: 1px solid #ece7df;
          border-radius: 16px;
          background: #fff;
          padding: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .calendar-month-cell:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(0,0,0,0.08);
        }

        .calendar-month-cell-muted {
          background: #fafafa;
          opacity: 0.7;
        }

        .calendar-month-cell-today {
          border-color: #0d6efd;
        }

        .calendar-month-cell-selected {
          box-shadow: 0 0 0 2px rgba(13,110,253,0.2);
        }

        .calendar-month-cell-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .calendar-month-daynum {
          font-size: 0.95rem;
          font-weight: 800;
          color: #2f241a;
        }

        .calendar-month-events {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .calendar-event-pill {
          border: 0;
          width: 100%;
          text-align: left;
          border-radius: 10px;
          padding: 6px 8px;
          font-size: 0.78rem;
          display: flex;
          gap: 6px;
          align-items: center;
          cursor: pointer;
        }

        .calendar-event-hour {
          font-weight: 800;
          white-space: nowrap;
        }

        .calendar-event-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .estado-pendiente {
          background: #fff3cd;
          color: #6b4e00;
        }

        .estado-realizada {
          background: #d1e7dd;
          color: #0f5132;
        }

        .estado-cancelada {
          background: #e2e3e5;
          color: #41464b;
        }

        .calendar-more {
          font-size: 0.78rem;
          color: #6c757d;
          font-weight: 700;
          padding-left: 4px;
        }

        .mini-add-btn {
          border: 0;
          background: #198754;
          color: #fff;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          font-weight: 800;
          line-height: 1;
          cursor: pointer;
        }

        .mini-add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .week-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 12px;
        }

        .week-col {
          min-width: 0;
          border: 1px solid #ece7df;
          border-radius: 16px;
          overflow: hidden;
          background: #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }

        .week-col-header {
          background: #f6efe4;
          border-bottom: 1px solid #eadfce;
          padding: 12px;
          cursor: pointer;
        }

        .week-col-header.active {
          background: #e9f2ff;
          border-bottom-color: #cfe2ff;
        }

        .week-col-name {
          font-weight: 800;
          color: #2f241a;
        }

        .week-col-count {
          font-size: 0.82rem;
          color: #6c757d;
          margin-top: 2px;
        }

        .week-col-body {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 220px;
        }

        @media (max-width: 1200px) {
          .week-grid,
          .calendar-month-header,
          .calendar-month-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (max-width: 992px) {
          .week-grid,
          .calendar-month-header,
          .calendar-month-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          .dia-group {
            grid-template-columns: 1fr;
          }

          .dia-group-hour {
            position: static;
            width: fit-content;
          }

          .actividad-card-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .week-grid,
          .calendar-month-header,
          .calendar-month-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}