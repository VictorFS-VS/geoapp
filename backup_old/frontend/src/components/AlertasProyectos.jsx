// src/components/AlertasProyectos.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Spinner, Alert, ListGroup } from "react-bootstrap";
import {
  FaBell,
  FaFileAlt,
  FaBullhorn,
  FaThumbtack,
  FaEnvelope,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { alerts } from "@/utils/alerts";
import "@/styles/AlertasProyectos.css";

const ENV_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const HOST_BASE = ENV_BASE.replace(/\/api\/?$/i, "");
const API_URL = HOST_BASE.endsWith("/api") ? HOST_BASE : HOST_BASE + "/api";

const iconMap = {
  auditoría: <FaBell className="text-warning" />,
  licencia: <FaFileAlt className="text-secondary" />,
  solicita: <FaBullhorn className="text-primary" />,
  requiere: <FaThumbtack className="text-danger" />,
  notificación: <FaEnvelope className="text-info" />,
  emisión: <FaCheckCircle className="text-success" />,
  resolución: <FaFileAlt className="text-info" />,
  declaración: <FaFileAlt className="text-warning" />,
  vencimiento: <FaExclamationTriangle className="text-danger" />,
  vencida: <FaExclamationTriangle className="text-danger" />,
  vence: <FaExclamationTriangle className="text-warning" />,
  default: <FaBell />,
};

function renderIcon(titulo = "") {
  const key = Object.keys(iconMap).find((k) =>
    titulo?.toLowerCase?.().includes(k)
  );
  return iconMap[key] || iconMap.default;
}

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: "Bearer " + token } : {};
}

function hasToken() {
  return Boolean(
    localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("jwt")
  );
}

function fmtFecha(isoOrDate) {
  try {
    const d = new Date(isoOrDate);
    return d.toLocaleDateString("es-PY");
  } catch {
    return String(isoOrDate || "");
  }
}

function badgeColorByDias(dias) {
  const n = Number(dias ?? 0);
  if (n < 0) return "danger"; // vencido
  if (n <= 7) return "danger"; // urgente
  if (n <= 30) return "warning"; // próximo
  return "secondary"; // lejos
}

function etiquetaVto(it) {
  const dias = Number(it?.dias ?? 0);
  const abs = Math.abs(dias);

  // <= 30 días (o vencido) => mostramos días
  if (abs <= 30) {
    if (dias < 0) return `Vencida hace ${abs} día${abs === 1 ? "" : "s"}`;
    if (dias === 0) return "Vence hoy";
    return `Faltan ${dias} día${dias === 1 ? "" : "s"}`;
  }

  // > 30 => mostramos fecha
  return `Vence: ${fmtFecha(it?.fecha_vto)}`;
}

function tipoBadge(tipo) {
  const t = String(tipo || "").toUpperCase();
  if (t === "DIA") return { text: "DIA", bg: "warning", textColor: "dark" };
  return { text: "RESOLUCIÓN", bg: "info", textColor: "dark" };
}

/**
 * ✅ Helper: lee JSON (o texto) incluso cuando hay error HTTP
 * y tira un Error con .status y .data (si hay).
 */
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);

  let data = null;
  const ct = res.headers.get("content-type") || "";
  try {
    data = ct.includes("application/json") ? await res.json() : await res.text();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.message || data.error)) ||
      (typeof data === "string" && data) ||
      `HTTP ${res.status}`;

    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export default function AlertasProyectos() {
  const [notificaciones, setNotificaciones] = useState([]);
  const [vencLoading, setVencLoading] = useState(true);
  const [vencErr, setVencErr] = useState("");
  const [vencimientos, setVencimientos] = useState([]);
  const [marcandoLeidas, setMarcandoLeidas] = useState(false);

  // ✅ evita re-marcar la misma notificación si re-renderiza
  const autoReadOnceRef = useRef(new Set());

  // ===== 1) Vencimientos =====
  useEffect(() => {
    if (!hasToken()) {
      setVencLoading(false);
      setVencErr("Iniciá sesión para ver vencimientos.");
      setVencimientos([]);
      return;
    }

    let alive = true;

    (async () => {
      try {
        setVencErr("");
        setVencLoading(true);

        const url = `${API_URL}/dashboard/vencimientos?limit=8`;
        const data = await fetchJson(url, { headers: { ...authHeaders() } });

        if (!alive) return;
        setVencimientos(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("🔔 fallo fetch vencimientos:", err);
        if (!alive) return;

        const msg =
          err.status === 401 || err.status === 403
            ? "Sesión vencida. Volvé a iniciar sesión."
            : err.message || "No se pudieron cargar los vencimientos.";

        setVencErr(msg);
        setVencimientos([]);
      } finally {
        if (alive) setVencLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const rows = Array.isArray(vencimientos) ? vencimientos : [];
    const dia = rows.filter((r) => String(r.tipo).toUpperCase() === "DIA").length;
    const res = rows.filter((r) => String(r.tipo).toUpperCase() !== "DIA").length;
    return { dia, res };
  }, [vencimientos]);

  // ===== 2) Notificaciones =====
  useEffect(() => {
    if (!hasToken()) return;

    let alive = true;

    (async () => {
      try {
        const data = await fetchJson(`${API_URL}/notificaciones/todas`, {
          headers: { ...authHeaders() },
        });
        if (!alive) return;
        setNotificaciones(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("🔔 fallo fetch notificaciones:", err);
        if (!alive) return;

        const msg =
          err.status === 401 || err.status === 403
            ? "Sesión vencida. Volvé a iniciar sesión."
            : err.message || "No se pudieron cargar las notificaciones.";

        alerts.toast.error(msg);
        setNotificaciones([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Marcar todas como leídas (botón)
  const marcarTodasLeidas = async () => {
    try {
      setMarcandoLeidas(true);

      if (!hasToken()) {
        alerts.toast.error("No hay sesión activa.");
        return;
      }

      const data = await fetchJson(`${API_URL}/notificaciones/marcar-leidas`, {
        method: "PUT",
        headers: { ...authHeaders() },
      });

      const msg =
        (data && typeof data === "object" && data.message) ||
        "Notificaciones marcadas como leídas.";

      setNotificaciones([]);
      alerts.toast.success(msg);
    } catch (err) {
      console.error("Error al marcar como leídas:", err);

      const msg =
        err.status === 401 || err.status === 403
          ? "Sesión vencida. Volvé a iniciar sesión."
          : err.message || "Error al marcar notificaciones como leídas.";

      alerts.toast.error(msg);
    } finally {
      setMarcandoLeidas(false);
    }
  };

  // Filtrar NO leídas
  const notificacionesNoLeidas = useMemo(() => {
    if (!hasToken()) return [];
    return (Array.isArray(notificaciones) ? notificaciones : []).filter((n) => {
      return (
        n.leido_usuario === false ||
        n.leido_usuario === 0 ||
        n.leido_consultor === false ||
        n.leido_consultor === 0
      );
    });
  }, [notificaciones]);

  // ✅ Solo la más nueva
  const notificacionesParaMostrar = useMemo(() => {
    const rows = Array.isArray(notificacionesNoLeidas) ? [...notificacionesNoLeidas] : [];

    rows.sort((a, b) => {
      const ta = a?.creado_en ? new Date(a.creado_en).getTime() : 0;
      const tb = b?.creado_en ? new Date(b.creado_en).getTime() : 0;
      if (tb !== ta) return tb - ta;

      const ia = Number(a?.id_notificacion ?? 0);
      const ib = Number(b?.id_notificacion ?? 0);
      return ib - ia;
    });

    return rows.slice(0, 1);
  }, [notificacionesNoLeidas]);

  // ✅ Auto-marcar como leída al mostrar la más nueva (una sola vez)
  useEffect(() => {
    if (!hasToken()) return;

    const n = notificacionesParaMostrar?.[0];
    const id = n?.id_notificacion;
    if (!id) return;

    if (autoReadOnceRef.current.has(id)) return;
    autoReadOnceRef.current.add(id);

    (async () => {
      try {
        // Requiere endpoint: PUT /notificaciones/:id/marcar-leida
        await fetchJson(`${API_URL}/notificaciones/${id}/marcar-leida`, {
          method: "PUT",
          headers: { ...authHeaders() },
        });

        // actualizar estado local para que deje de aparecer como no leída
        setNotificaciones((prev) =>
          (Array.isArray(prev) ? prev : []).map((x) =>
            x.id_notificacion === id
              ? { ...x, leido_usuario: 1, leido_consultor: 1 }
              : x
          )
        );
      } catch (err) {
        console.error("Auto marcar leída falló:", err);
        // sin toast, para no molestar
      }
    })();
  }, [notificacionesParaMostrar]);

  return (
    <Card className="shadow-sm rounded-4 mb-4">
      <Card.Body>
        <Card.Title className="mb-3">📢 Alertas</Card.Title>

        {/* ===================== VENCIMIENTOS (FIJO) ===================== */}
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
          <div className="fw-bold d-flex align-items-center gap-2">
            <FaExclamationTriangle className="text-danger" />
            Vencimientos importantes
          </div>

          <div className="d-flex gap-2">
            <Badge bg="warning" text="dark">
              DIA: {counts.dia}
            </Badge>
            <Badge bg="info" text="dark">
              Resol.: {counts.res}
            </Badge>
          </div>
        </div>

        {vencLoading && (
          <div className="d-flex align-items-center gap-2 text-muted small mb-3">
            <Spinner size="sm" /> Cargando vencimientos...
          </div>
        )}

        {!vencLoading && vencErr && (
          <Alert variant="danger" className="mb-3">
            {vencErr}
          </Alert>
        )}

        {!vencLoading && !vencErr && (
          <ListGroup variant="flush" className="mb-3">
            {vencimientos.length > 0 ? (
              vencimientos.map((it, idx) => {
                const t = tipoBadge(it.tipo);
                const color = badgeColorByDias(it.dias);
                return (
                  <ListGroup.Item
                    key={`vto-${it.tipo}-${it.id_proyecto}-${idx}`}
                    className="px-0"
                  >
                    <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Badge bg={t.bg} text={t.textColor}>
                          {t.text}
                        </Badge>
                        <div className="fw-semibold">
                          {it.nombre_proyecto || `Proyecto ${it.id_proyecto}`}
                        </div>
                      </div>

                      <Badge
                        bg={color}
                        text={color === "warning" ? "dark" : "light"}
                      >
                        {etiquetaVto(it)}
                      </Badge>
                    </div>
                  </ListGroup.Item>
                );
              })
            ) : (
              <ListGroup.Item className="text-muted px-0">
                No hay vencimientos para mostrar.
              </ListGroup.Item>
            )}
          </ListGroup>
        )}

        <hr className="my-3" />

        {/* ===================== NOTIFICACIONES (solo 1) ===================== */}
        <div className="d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap">
          <div className="fw-bold">🔔 Notificaciones</div>

          {notificacionesNoLeidas.length > 0 && (
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={marcarTodasLeidas}
              disabled={marcandoLeidas}
              title="Marca todas las notificaciones como leídas"
            >
              {marcandoLeidas ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Marcando...
                </>
              ) : (
                `✓ Marcar ${notificacionesNoLeidas.length} como leída${
                  notificacionesNoLeidas.length === 1 ? "" : "s"
                }`
              )}
            </button>
          )}
        </div>

        <div className="alertas-list">
          <ListGroup variant="flush">
            {notificacionesParaMostrar.length > 0 ? (
              notificacionesParaMostrar.map((n, idx) => {
                const titulo = String(n.titulo || "");
                const mensaje = String(n.mensaje || "");

                const esVencimiento =
                  titulo.toLowerCase().includes("vencimiento") ||
                  titulo.toLowerCase().includes("vencida") ||
                  titulo.toLowerCase().includes("vence") ||
                  mensaje.toLowerCase().includes("vencimiento");

                let badgeVariant = "secondary";
                if (esVencimiento) {
                  if (titulo.toLowerCase().includes("vencida")) {
                    badgeVariant = "danger";
                  } else if (titulo.toLowerCase().includes("vence en")) {
                    badgeVariant = "warning";
                  }
                }

                return (
                  <ListGroup.Item
                    key={n.id_notificacion ?? `alerta-${idx}`}
                    className="d-flex align-items-start py-2 alerta-chat alerta-no-leida"
                    style={{
                      backgroundColor: esVencimiento
                        ? "rgba(255, 193, 7, 0.05)"
                        : "rgba(0, 123, 255, 0.02)",
                      borderLeft: esVencimiento
                        ? "4px solid #ffc107"
                        : "4px solid #007bff",
                    }}
                  >
                    <div className="me-3 icono" style={{ minWidth: "24px" }}>
                      {renderIcon(titulo)}
                    </div>

                    <div className="flex-grow-1">
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div>
                          <strong>{titulo}</strong>
                          <div
                            className="small"
                            style={{ marginTop: "4px", lineHeight: "1.4" }}
                          >
                            {mensaje}
                          </div>
                          <small
                            className="text-muted"
                            style={{ marginTop: "6px", display: "block" }}
                          >
                            {n.creado_en
                              ? new Date(n.creado_en).toLocaleString()
                              : ""}
                          </small>
                        </div>

                        <div
                          className="d-flex gap-2 flex-wrap"
                          style={{ whiteSpace: "nowrap", alignItems: "flex-start" }}
                        >
                          <span className="badge bg-success" style={{ height: "fit-content" }}>
                            ● NUEVA
                          </span>

                          {esVencimiento && (
                            <Badge
                              bg={badgeVariant}
                              text={badgeVariant === "warning" ? "dark" : "light"}
                              style={{ height: "fit-content" }}
                            >
                              {badgeVariant === "danger"
                                ? "⚠️ URGENTE"
                                : "⏰ PRÓXIMO"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </ListGroup.Item>
                );
              })
            ) : (
              <ListGroup.Item key="no-alertas" className="text-center text-muted">
                No hay notificaciones nuevas
              </ListGroup.Item>
            )}
          </ListGroup>
        </div>
      </Card.Body>
    </Card>
  );
}