import React, { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Modal, Button, Spinner } from "react-bootstrap";
import { useAuth } from "@/auth/AuthContext";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: "Bearer " + token } : {};
}

/** ✅ Detecta si el proyecto tiene tramos */
async function hasTramos(idProyecto) {
  const res = await fetch(`${API_URL}/tramos/proyectos/${idProyecto}/tramos`, {
    headers: authHeader(),
  });

  if (!res.ok) return { ok: false, count: null };

  const data = await res.json();
  const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return { ok: true, count: arr.length };
}

export default function ProyectoModal({ proyecto, children }) {
  const [show, setShow] = useState(false);
  const [tipoUsuario, setTipoUsuario] = useState(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const outletCtx = useOutletContext() || {};
  const toggleSidebar = outletCtx.toggleSidebar || (() => {});
  const { can } = useAuth();

  const open = () => setShow(true);
  const close = () => !busy && setShow(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    fetch(`${API_URL}/usuarios/me`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setTipoUsuario(data?.tipo_usuario ?? null))
      .catch(() => setTipoUsuario(null));
  }, []);

  const goTo = (path) => {
    close();

    if (proyecto?.gid) {
      localStorage.setItem("proyectoActualId", String(proyecto.gid));
      localStorage.setItem("proyectoSeleccionado", JSON.stringify({ gid: proyecto.gid }));
    }

    const isFullScreen =
      path.startsWith("/visor-tramo") ||
      path.startsWith("/visor-encuestas") ||
      path.includes("/analisis-ndvi");

    if (isFullScreen) {
      try {
        toggleSidebar();
      } catch {}
    }

    navigate(path);
  };

  /** ✅ Si hay tramos -> /tramos, si no -> /poi */
  const goToTramosOrPoi = async () => {
    const gid = proyecto?.gid;
    if (!gid) return;

    try {
      setBusy(true);
      const r = await hasTramos(gid);

      setShow(false);

      if (r.ok && (r.count || 0) > 0) {
        navigate(`/proyectos/${gid}/tramos`);
      } else {
        navigate(`/proyectos/${gid}/poi`);
      }
    } catch {
      setShow(false);
      navigate(`/proyectos/${gid}/tramos`);
    } finally {
      setBusy(false);
    }
  };

  const esUsuario10 = tipoUsuario === 10; // CLIENTE_VIAL
  const esUsuario9 = tipoUsuario === 9;   // CLIENTE
  const esUsuario11 = tipoUsuario === 11; // ADMIN_CLIENTE
  const soloLectura = esUsuario9 || esUsuario10 || esUsuario11;
  const puedeVerInformes = can("informes.read");
  const puedeExpedientes =
    can("expedientes.read") ||
    can("expedientes.create") ||
    can("expedientes.update") ||
    can("expedientes.upload");

  const nombre = proyecto?.nombre || `Proyecto #${proyecto?.gid ?? "—"}`;
  const codigo = proyecto?.codigo ? `#${proyecto.codigo}` : "";

  return (
    <>
      <span onClick={open} style={{ cursor: "pointer" }}>
        {children}
      </span>

      <Modal show={show} onHide={close} centered>
        <Modal.Header closeButton={!busy}>
          <Modal.Title>
            {nombre}
            {proyecto?.gid && <> · ID: {proyecto.gid}</>}
            {codigo && <> · {codigo}</>}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="d-grid gap-2">
            <Button
              variant="primary"
              className="w-100"
              disabled={busy}
              onClick={() => goTo(`/visor-full/${proyecto?.gid}`)}
            >
              🗺️ Ver Mapa
            </Button>

            <Button
              variant="success"
              className="w-100"
              disabled={busy}
              onClick={() => goTo(`/proyectos/${proyecto?.gid}/analisis-ndvi`)}
            >
              🌱 Análisis Cambio de Uso
            </Button>

            {tipoUsuario !== null && (
              <Button
                variant="outline-primary"
                className="w-100"
                disabled={busy}
                onClick={() =>
                  soloLectura
                    ? goTo(`/proyectos/${proyecto?.gid}/ver`)
                    : goTo(`/proyectos/${proyecto?.gid}/editar`)
                }
              >
                {soloLectura ? "👁️ Ver Proyecto" : "✏️ Editar Proyecto"}
              </Button>
            )}

            {puedeExpedientes && (
              <Button
                variant="dark"
                className="w-100"
                disabled={busy}
                onClick={() => goTo(`/proyectos/${proyecto?.gid}/expedientes`)}
              >
                ➕ Expedientes
              </Button>
            )}

            {/* ✅ Regencia visible para todos por ahora */}
            <Button
              variant="success"
              className="w-100"
              disabled={busy}
              onClick={() => goTo(`/proyectos/${proyecto?.gid}/regencia`)}
            >
              🧾 Regencia
            </Button>

            {tipoUsuario === 10 && (
              <>
                {/* ✅ Tramos / POI inteligente */}
                <Button
                  variant="warning"
                  className="w-100"
                  disabled={busy}
                  onClick={goToTramosOrPoi}
                >
                  {busy ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Verificando tramos...
                    </>
                  ) : (
                    "🛣️ Tramos / 📍 POI"
                  )}
                </Button>

                <Button
                  variant="success"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/actas-preconstruccion`)}
                >
                  📝 Actas de Preconstrucción
                </Button>

                <Button
                  variant="outline-secondary"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/actas`)}
                >
                  📄 Listado de Actas
                </Button>
              </>
            )}

            {tipoUsuario !== 10 && (
              <>
                <Button
                  variant="success"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/pga`)}
                >
                  📘 PGA
                </Button>

                <Button
                  variant="success"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/declaraciones`)}
                >
                  📗 DIA
                </Button>

                <Button
                  variant="success"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/resoluciones`)}
                >
                  📙 Resoluciones
                </Button>

                <Button
                  variant="info"
                  className="w-100"
                  disabled={busy}
                  onClick={() => goTo(`/proyectos/${proyecto?.gid}/evaluaciones`)}
                >
                  📈 Evaluaciones
                </Button>
              </>
            )}

            {puedeVerInformes && (
              <Button
                variant="outline-secondary"
                className="w-100"
                disabled={busy}
                onClick={() => goTo(`/dashboardinformes?id_proyecto=${proyecto?.gid}`)}
              >
                Informes - Dashboard
              </Button>
            )}

            <Button
              variant="secondary"
              className="w-100"
              disabled={busy}
              onClick={() => goTo(`/proyectos/${proyecto?.gid}/informes`)}
            >
              📄 Informes por proyecto
            </Button>

            {tipoUsuario !== 10 && (
              <Button
                variant="outline-secondary"
                className="w-100"
                disabled={busy}
                onClick={() => goTo(`/proyectos/${proyecto?.gid}/informes/nuevo`)}
              >
                ➕ Nuevo informe dinámico
              </Button>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button
            variant="outline-secondary"
            className="w-100"
            onClick={close}
            disabled={busy}
          >
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
