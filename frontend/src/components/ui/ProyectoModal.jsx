/* =========================
   ✅ ProyectoModal.jsx (PERMISOS/RBAC)
   - Ya NO usa tipo_usuario
   - Agrega botón: ➕ Expedientes (pasa gid por URL)
   ========================= */
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Modal, Button, Spinner } from "react-bootstrap";
import Swal from "sweetalert2";

import { useAuth } from "@/auth/AuthContext";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/** Clasifica el proyecto a partir de tipo_estudio. Ajustá el regex si necesitás. */
function clasificarPorTipoEstudio(raw) {
  const s = (raw || "").toString().trim().toUpperCase();
  if (!s) return null;
  const esVial = /(C\/?DS|VIAL|TRAM|RUTA|CAMIN|VIA(?!BLE)|VÍA)/i.test(s);
  return esVial ? "VIAL" : "AMBIENTAL";
}

function authHeader() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: "Bearer " + token } : {};
}

// ✅ fetch que trata 409 como respuesta normal
async function fetchJSON409(url, options = {}) {
  const res = await fetch(url, options);

  if (res.status === 409) {
    let data = {};
    try {
      data = await res.json();
    } catch {}
    return { _status: 409, ...data };
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status} ${res.statusText}`;
    try {
      msg = (await res.text()) || msg;
    } catch {}
    throw new Error(msg);
  }

  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function eliminarProyecto(id, { force = false } = {}) {
  const url = `${API_URL}/proyectos/${id}${force ? "?force=1" : ""}`;
  return fetchJSON409(url, { method: "DELETE", headers: authHeader() });
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
  const [tipoProyecto, setTipoProyecto] = useState(null); // 'VIAL' | 'AMBIENTAL' | null
  const [deleting, setDeleting] = useState(false);
  const [checkingTramos, setCheckingTramos] = useState(false);

  const navigate = useNavigate();

  // ✅ Obtener contexto de Layout de forma segura
  const outletCtx = useOutletContext() || {};
  const toggleSidebar = outletCtx.toggleSidebar || (() => {});

  const open = () => setShow(true);
  const close = () => !deleting && !checkingTramos && setShow(false);

  const gid = proyecto?.gid ?? null;

  // ✅ RBAC front
  const { loading, can } = useAuth();

  // Trae el proyecto y clasifica por tipo_estudio
  const cargarTipoProyecto = useCallback(async () => {
    if (!gid) return;
    try {
      const res = await fetch(`${API_URL}/proyectos/${gid}`, {
        headers: authHeader(),
      });
      const data = await res.json();
      const clasif = clasificarPorTipoEstudio(data?.tipo_estudio);
      setTipoProyecto(clasif);
    } catch {
      setTipoProyecto(null);
    }
  }, [gid]);

  useEffect(() => {
    if (show) cargarTipoProyecto();
  }, [show, cargarTipoProyecto]);

  const goTo = (path) => {
    close();

    if (gid) {
      localStorage.setItem("proyectoActualId", String(gid));
      localStorage.setItem("proyectoSeleccionado", JSON.stringify({ gid }));
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
    if (!gid) return;
    try {
      setCheckingTramos(true);
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
      setCheckingTramos(false);
    }
  };

  // =========================
  // ✅ Permisos (sin tipo_usuario)
  // =========================
  const soloLectura = !can("proyectos.update");

  const puedeReportes = can("reportes.read") || can("reportes.manage_bloques") || can("reportes.create");

  const puedeVerInformes = can("informes.read");
  const puedeCrearInforme = can("informes.create");

  const puedeMantenimiento = can("mantenimiento.import") || can("mantenimiento.create");

  const puedeActasPreconstruccion = can("actas.create") || can("actas.update") || can("actas.generate");
  const puedeActasListado = can("actas.read");

  const puedeTramos = can("tramos.read");
  const puedePoi = can("poi.read");

  const puedePGA = can("pga.read");
  const puedeDIA = can("declaraciones.read");
  const puedeResoluciones = can("resoluciones.read");

  const puedeEvaluaciones = can("evaluaciones.read");

  const puedeEliminar = can("proyectos.delete");

  const puedeVerMapa = can("proyectos.read");
  const puedeNDVI = can("use_change.read") || can("use_change.create");
  const puedeRegencia =
    can("regencia.contratos.read") || can("regencia.actividades.read") || can("regencia.responsables.read");

  // ✅ NUEVO: Expedientes (ajustá el permiso al que definiste)
  const puedeExpedientes =
    can("expedientes.read") || can("expedientes.create") || can("expedientes.update") || can("expedientes.upload");

  // =========================
  // ✅ Visibilidad por categoría (funcional)
  // =========================
  const esVial = (tipoProyecto || "").toUpperCase() === "VIAL";
  const esAmbiental = (tipoProyecto || "").toUpperCase() === "AMBIENTAL";
  const tipoDetectado = tipoProyecto !== null;

  const showTramosGroup = !tipoDetectado || esVial;
  const showAmbientalMap = !tipoDetectado || esAmbiental;
  const showAmbientalDocs = esAmbiental;
  const showNDVI = esAmbiental;

  const nombre = proyecto?.nombre || `Proyecto #${gid ?? "—"}`;
  const codigo = proyecto?.codigo ? `#${proyecto.codigo}` : "";

  // ✅ Eliminar proyecto con confirmación y dependencias
  const handleEliminar = async () => {
    if (!gid) return;

    setDeleting(true);

    try {
      const r = await eliminarProyecto(gid, { force: false });

      if (r?._status !== 409) {
        if (r?.success || r?.ok || r?.bloqueado === false) {
          await Swal.fire({
            icon: "success",
            title: "Eliminado",
            text: "Proyecto eliminado correctamente.",
            timer: 1200,
            showConfirmButton: false,
          });
          window.location.reload();
          return;
        }
        throw new Error(r?.message || r?.error || "No se pudo eliminar.");
      }

      const detalles = r?.detalles || [];
      const dependencias = r?.dependencias || {};

      const listaHtml =
        detalles.length
          ? `<ul style="margin-left:16px">${detalles.map((d) => `<li>${d}</li>`).join("")}</ul>`
          : `<ul style="margin-left:16px">${Object.entries(dependencias)
              .map(([k, v]) => `<li>${k} (${v})</li>`)
              .join("")}</ul>`;

      setShow(false);

      const ask = await Swal.fire({
        icon: "warning",
        title: "Eliminar proyecto",
        html: `
          <div style="text-align:left">
            <p><b>Este proyecto tiene datos relacionados:</b></p>
            ${listaHtml}
            <p style="margin-top:10px"><b>Si confirmás, se eliminará todo lo relacionado.</b></p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Sí, eliminar todo",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#dc2626",
        allowOutsideClick: false,
      });

      if (!ask.isConfirmed) {
        setShow(true);
        return;
      }

      const r2 = await eliminarProyecto(gid, { force: true });

      if (r2?.success || r2?.ok || r2?.bloqueado === false) {
        await Swal.fire({
          icon: "success",
          title: "Eliminado",
          text: "Proyecto eliminado correctamente.",
          timer: 1200,
          showConfirmButton: false,
        });
        window.location.reload();
        return;
      }

      throw new Error(r2?.message || r2?.error || "No se pudo eliminar.");
    } catch (e) {
      await Swal.fire({
        icon: "error",
        title: "Error",
        text: e?.message || "Error al intentar eliminar el proyecto.",
      });
      setShow(true);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <>
        <span onClick={open} style={{ cursor: "pointer" }}>
          {children}
        </span>
      </>
    );
  }

  return (
    <>
      <span onClick={open} style={{ cursor: "pointer" }}>
        {children}
      </span>

      <Modal show={show} onHide={close} centered>
        <Modal.Header closeButton={!deleting && !checkingTramos}>
          <Modal.Title>
            {nombre}
            {gid && <> · ID: {gid}</>}
            {codigo && <> · {codigo}</>}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {/* === BLOQUE SUPERIOR: Mapas / Tramos / Actas === */}
          <div className="d-grid gap-2 mb-3">
            {/* Ambiental map */}
            {showAmbientalMap && puedeVerMapa && (
              <Button
                variant="primary"
                className="w-100"
                onClick={() => goTo(`/visor-full/${gid}`)}
                disabled={deleting || checkingTramos}
              >
                🗺️ Ver Mapa
              </Button>
            )}

            {/* NDVI */}
            {showNDVI && puedeNDVI && (
              <Button
                variant="success"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/analisis-ndvi`)}
                disabled={deleting || checkingTramos}
              >
                🌱 Análisis Cambio de Uso
              </Button>
            )}

            {/* Vial group */}
            {showTramosGroup && (
              <>
                {puedeVerMapa && (
                  <Button
                    variant="primary"
                    className="w-100"
                    onClick={() => goTo(`/visor-full/${gid}`)}
                    disabled={deleting || checkingTramos}
                  >
                    🛣️ Ver Mapa
                  </Button>
                )}

                {(puedeTramos || puedePoi) && (
                  <Button
                    variant="warning"
                    className="w-100"
                    onClick={goToTramosOrPoi}
                    disabled={deleting || checkingTramos}
                  >
                    {checkingTramos ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Verificando tramos...
                      </>
                    ) : (
                      "🛣️ Tramos / 📍 POI"
                    )}
                  </Button>
                )}

                {puedeActasPreconstruccion && (
                  <Button
                    variant="success"
                    className="w-100"
                    onClick={() => goTo(`/proyectos/${gid}/actas-preconstruccion`)}
                    disabled={deleting || checkingTramos}
                  >
                    📝 Actas de Preconstrucción
                  </Button>
                )}

                {puedeActasListado && (
                  <Button
                    variant="outline-secondary"
                    className="w-100"
                    onClick={() => goTo(`/proyectos/${gid}/actas`)}
                    disabled={deleting || checkingTramos}
                  >
                    📄 Listado de Actas
                  </Button>
                )}
              </>
            )}
          </div>

          <hr />

          {/* === BLOQUE INFERIOR === */}
          <div className="d-grid gap-2">
            <Button
              variant="outline-primary"
              className="w-100"
              onClick={() => (soloLectura ? goTo(`/proyectos/${gid}/ver`) : goTo(`/proyectos/${gid}/editar`))}
              disabled={deleting || checkingTramos}
            >
              {soloLectura ? "👁️ Ver Proyecto" : "✏️ Editar Proyecto"}
            </Button>

            {/* ✅ NUEVO: EXPEDIENTES */}
            {puedeExpedientes && (
              <Button
                variant="dark"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/expedientes`)}
                disabled={deleting || checkingTramos}
              >
                ➕ Expedientes
              </Button>
            )}

            {puedeMantenimiento && !soloLectura && (
              <Button
                variant="success"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/mantenimiento`)}
                disabled={deleting || checkingTramos}
              >
                🛠️ Mantenimiento
              </Button>
            )}

            {puedeRegencia && (
              <Button
                variant="success"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/regencia`)}
                disabled={deleting || checkingTramos}
              >
                🧾 Regencia
              </Button>
            )}

            {showAmbientalDocs && (
              <>
                {puedePGA && (
                  <Button
                    variant="success"
                    className="w-100"
                    onClick={() => goTo(`/proyectos/${gid}/pga`)}
                    disabled={deleting || checkingTramos}
                  >
                    📘 PGA
                  </Button>
                )}

                {puedeDIA && (
                  <Button
                    variant="success"
                    className="w-100"
                    onClick={() => goTo(`/proyectos/${gid}/declaraciones`)}
                    disabled={deleting || checkingTramos}
                  >
                    📗 DIA
                  </Button>
                )}

                {puedeResoluciones && (
                  <Button
                    variant="success"
                    className="w-100"
                    onClick={() => goTo(`/proyectos/${gid}/resoluciones`)}
                    disabled={deleting || checkingTramos}
                  >
                    📙 Resoluciones
                  </Button>
                )}
              </>
            )}

            {puedeEvaluaciones && (
              <Button
                variant="info"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/evaluaciones`)}
                disabled={deleting || checkingTramos}
              >
                📈 Evaluaciones de proyectos
              </Button>
            )}

            {puedeReportes && (
              <Button
                variant="dark"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/reportes`)}
                disabled={deleting || checkingTramos}
              >
                🧩 Reportes (Builder)
              </Button>
            )}

            {puedeVerInformes && (
              <Button
                variant="secondary"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/informes`)}
                disabled={deleting || checkingTramos}
              >
                📄 Informes por proyecto
              </Button>
            )}

            {puedeCrearInforme && (
              <Button
                variant="outline-secondary"
                className="w-100"
                onClick={() => goTo(`/proyectos/${gid}/informes/nuevo`)}
                disabled={deleting || checkingTramos}
              >
                ➕ Nuevo informe dinámico
              </Button>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          {puedeEliminar && !soloLectura && (
            <Button
              variant="danger"
              className="w-100"
              onClick={handleEliminar}
              disabled={deleting || checkingTramos}
            >
              {deleting ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </>
  );
}