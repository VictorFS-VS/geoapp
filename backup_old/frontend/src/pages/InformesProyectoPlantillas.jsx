// src/pages/InformesProyectoPlantillas.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Table, Button, Badge, Spinner, Alert } from "react-bootstrap";
import Swal from "sweetalert2";
import ImportarRespuestasExcelModal from "@/components/informes/ImportarRespuestasExcelModal";
import ImportarInformesNuevoModal from "@/modules/informes/ImportarInformesNuevoModal";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

const authHeaders = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");

  const headers = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
  width: 420,
  didOpen: (popup) => {
    popup.style.wordBreak = "break-word";
    popup.style.overflowWrap = "anywhere";
    popup.style.whiteSpace = "normal";
  },
});

function formatearFecha(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("es-PY");
}

function firstArray(...candidates) {
  for (const x of candidates) {
    if (Array.isArray(x)) return x;
  }
  return [];
}

const InformesProyectoPlantillas = () => {
  const { idProyecto } = useParams();
  const navigate = useNavigate();

  const [plantillas, setPlantillas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [showNewImportModal, setShowNewImportModal] = useState(false);
  const [plantillaImportSel, setPlantillaImportSel] = useState(null);
  const [preguntasLista, setPreguntasLista] = useState([]);
  const [loadingPreguntas, setLoadingPreguntas] = useState(false);

  async function apiGet(url) {
    const resp = await fetch(url, { headers: authHeaders() });

    const ct = resp.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await resp.json().catch(() => ({})) : null;

    if (!resp.ok || data?.ok === false) {
      const msg =
        data?.error ||
        data?.message ||
        (isJson ? `Error ${resp.status}` : await resp.text());
      throw new Error(msg || `Error ${resp.status}`);
    }

    return data;
  }

  const cargar = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await apiGet(
        `${API_URL}/informes/proyecto/${idProyecto}/por-plantilla`
      );

      const root = data?.body ?? data?.data ?? data ?? {};
      const arr = firstArray(root.items, root.plantillas);

      setPlantillas(arr);
    } catch (err) {
      console.error("Error cargando plantillas agrupadas:", err);
      setError("No se pudieron cargar las plantillas del proyecto.");
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudieron cargar las plantillas.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (idProyecto) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProyecto]);

  const total = useMemo(
    () => plantillas.reduce((acc, p) => acc + (Number(p.total) || 0), 0),
    [plantillas]
  );

  const irAInformesDePlantilla = (idPlantilla) => {
    navigate(`/proyectos/${idProyecto}/informes/lista?plantilla=${idPlantilla}`);
  };

  async function cargarPreguntasDePlantilla(idPlantilla) {
    try {
      setLoadingPreguntas(true);

      const data = await apiGet(`${API_URL}/informes/plantillas/${idPlantilla}`);
      const secciones = Array.isArray(data?.secciones) ? data.secciones : [];
      const preguntas = secciones.flatMap((s) =>
        Array.isArray(s?.preguntas) ? s.preguntas : []
      );

      setPreguntasLista(preguntas);
    } catch (err) {
      console.error("Error cargando estructura de plantilla:", err);
      setPreguntasLista([]);
      Toast.fire({
        icon: "error",
        title:
          err?.message || "No se pudieron cargar las preguntas de la plantilla.",
      });
    } finally {
      setLoadingPreguntas(false);
    }
  }

  async function abrirImportacion(plantilla) {
    const idPlantilla = Number(plantilla?.id_plantilla);
    if (!idPlantilla) {
      Toast.fire({ icon: "warning", title: "Plantilla inválida." });
      return;
    }

    setPlantillaImportSel(plantilla);
    await cargarPreguntasDePlantilla(idPlantilla);
    setShowImportModal(true);
  }

  function abrirNuevoImport(plantilla) {
    const idPlantilla = Number(plantilla?.id_plantilla);
    if (!idPlantilla) {
      Toast.fire({ icon: "warning", title: "Plantilla invalida." });
      return;
    }
    setPlantillaImportSel(plantilla);
    setShowNewImportModal(true);
  }

  return (
    <>
      <div className="container mt-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h4 className="mb-0">Informes del proyecto #{idProyecto}</h4>
            <small className="text-muted">
              Agrupado por plantilla para evitar confusión cuando un proyecto usa varias.
            </small>
          </div>

          <div className="d-flex gap-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Volver
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate(`/proyectos/${idProyecto}/informes/nuevo`)}
            >
              ➕ Nuevo informe
            </Button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" /> Cargando plantillas...
          </div>
        )}

        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}

        {!loading && !error && plantillas.length === 0 && (
          <Alert variant="info" className="py-2">
            Este proyecto aún no tiene informes generados.
          </Alert>
        )}

        {!loading && !error && plantillas.length > 0 && (
          <>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="text-muted small">
                Total informes: <b>{total}</b> • Plantillas usadas:{" "}
                <b>{plantillas.length}</b>
              </div>

              <div className="d-flex gap-2">
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => cargar()}
                  title="Recargar"
                >
                  🔄 Recargar
                </Button>

                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => navigate(`/proyectos/${idProyecto}/informes/lista`)}
                  title="Ver todos los informes sin agrupar"
                >
                  Ver todo (sin agrupar)
                </Button>
              </div>
            </div>

            <Table striped bordered hover size="sm" responsive>
              <thead className="table-light">
                <tr>
                  <th style={{ width: 90 }}>ID</th>
                  <th>Plantilla</th>
                  <th style={{ width: 140 }}>Total</th>
                  <th style={{ width: 220 }}>Último informe</th>
                  <th style={{ width: 360 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plantillas.map((p) => (
                  <tr key={p.id_plantilla}>
                    <td>
                      <Badge bg="secondary">{p.id_plantilla}</Badge>
                    </td>

                    <td>{p.nombre || `Plantilla ${p.id_plantilla}`}</td>

                    <td>
                      <Badge bg="info">{Number(p.total) || 0}</Badge>
                    </td>

                    <td>{formatearFecha(p.ultimo_informe)}</td>

                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => irAInformesDePlantilla(p.id_plantilla)}
                        >
                          Ver
                        </Button>

                        <Button
                          size="sm"
                          variant="outline-success"
                          onClick={() => abrirImportacion(p)}
                          title="Importar Excel creando un informe nuevo por cada fila"
                          disabled={loadingPreguntas}
                        >
                          {loadingPreguntas &&
                          Number(plantillaImportSel?.id_plantilla) === Number(p.id_plantilla)
                            ? "Preparando..."
                            : "Importar"}
                        </Button>

                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => abrirNuevoImport(p)}
                          title="Canal nuevo de importacion XLSX con preview, mapeo y control de duplicados"
                        >
                          Importacion nueva (XLSX)
                        </Button>

                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() =>
                            navigate(
                              `/proyectos/${idProyecto}/informes/nuevo?idPlantilla=${p.id_plantilla}`
                            )
                          }
                          title="(Opcional) preseleccionar plantilla al crear"
                        >
                          ➕
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>

      <ImportarRespuestasExcelModal
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        API_URL={API_URL}
        authHeaders={authHeaders}
        idProyecto={Number(idProyecto)}
        idPlantilla={Number(plantillaImportSel?.id_plantilla || 0) || null}
        nombrePlantilla={plantillaImportSel?.nombre || ""}
        preguntasLista={preguntasLista}
      />

      <ImportarInformesNuevoModal
        show={showNewImportModal}
        onHide={() => setShowNewImportModal(false)}
        API_URL={API_URL}
        authHeaders={authHeaders}
        idProyecto={Number(idProyecto)}
        idPlantilla={Number(plantillaImportSel?.id_plantilla || 0) || null}
        nombrePlantilla={plantillaImportSel?.nombre || ""}
      />
    </>
  );
};

export default InformesProyectoPlantillas;
