// src/pages/ReportesProyecto.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Spinner,
  Badge,
  Table,
  Row,
  Col,
  Form,
  InputGroup,
} from "react-bootstrap";
import Swal from "sweetalert2";
import { reportesApi } from "@/services/reportesService";

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2200,
  timerProgressBar: true,
  width: 460,
  didOpen: (popup) => {
    popup.style.wordBreak = "break-word";
    popup.style.overflowWrap = "anywhere";
    popup.style.whiteSpace = "normal";
  },
});

function asInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function fmtFecha(v) {
  if (!v) return "-";
  try {
    // si viene ISO con zona, lo dejamos simple
    return String(v).replace("T", " ").slice(0, 19);
  } catch {
    return String(v);
  }
}

export default function ReportesProyecto() {
  const nav = useNavigate();

  // ✅ FIX: tu ruta es /proyectos/:id/reportes
  // pero por compatibilidad aceptamos también /proyectos/:idProyecto/reportes
  const { id, idProyecto } = useParams();
  const pid = useMemo(() => asInt(idProyecto ?? id), [idProyecto, id]);

  const [loading, setLoading] = useState(true);
  const [creatingOld, setCreatingOld] = useState(false);
  const [creatingAgregado, setCreatingAgregado] = useState(false);

  const [reportes, setReportes] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [plantillaSel, setPlantillaSel] = useState("");
  const [tituloAgregado, setTituloAgregado] = useState("");

  const load = async () => {
    if (!pid) return;

    setLoading(true);
    try {
      const data = await reportesApi.listByProyecto(pid);
      setReportes(Array.isArray(data?.reportes) ? data.reportes : []);

      // para crear agregado necesitamos plantillas del proyecto
      // endpoint ya lo tenés en tu backend: /api/informes/proyecto/:idProyecto/por-plantilla
      const pl = await reportesApi.listPlantillasByProyecto(pid);
      const arr = Array.isArray(pl?.plantillas) ? pl.plantillas : [];
      setPlantillas(arr);

      // set default plantilla si no hay elegida
      if (!plantillaSel && arr.length) {
        setPlantillaSel(String(arr[0].id_plantilla));
      }
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "No se pudo cargar reportes" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!pid) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    load();
  }, [pid]);

  const goBuilder = (idReporte) => {
    if (!idReporte) return;
    nav(`/reportes/${idReporte}`);
  };

  const crearViejoDesdeUltimoInforme = async () => {
    if (!pid) return;

    setCreatingOld(true);
    try {
      const r = await reportesApi.createFromProyecto(pid);
      const idRep = r?.id_reporte;
      Toast.fire({ icon: "success", title: `Reporte creado (#${idRep})` });
      await load();
      if (idRep) goBuilder(idRep);
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "No se pudo crear reporte" });
    } finally {
      setCreatingOld(false);
    }
  };

  const crearAgregado = async () => {
    if (!pid) return;

    const idPlantilla = asInt(plantillaSel);
    if (!idPlantilla) {
      Toast.fire({ icon: "warning", title: "Seleccioná una plantilla" });
      return;
    }

    setCreatingAgregado(true);
    try {
      const r = await reportesApi.createFromProyectoAgregado(
        pid,
        idPlantilla,
        tituloAgregado?.trim() || null
      );
      const idRep = r?.id_reporte;
      Toast.fire({ icon: "success", title: `Reporte agregado creado (#${idRep})` });
      await load();
      if (idRep) goBuilder(idRep);
    } catch (e) {
      Toast.fire({
        icon: "error",
        title: e.message || "No se pudo crear reporte agregado",
      });
    } finally {
      setCreatingAgregado(false);
    }
  };

  const plantillaLabel = (p) => {
    const nombre = p?.nombre_plantilla || `Plantilla #${p?.id_plantilla}`;
    const tot = Number.isFinite(Number(p?.total_informes)) ? ` (${p.total_informes})` : "";
    return nombre + tot;
  };

  if (!pid) {
    return (
      <div className="container py-4">
        <div className="alert alert-danger">Falta idProyecto</div>
        <Button variant="secondary" onClick={() => nav(-1)}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h3 className="mb-0">Reportes</h3>
          <div className="text-muted">Proyecto #{pid}</div>
        </div>

        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={() => nav(-1)}>
            Volver
          </Button>
          <Button variant="outline-secondary" onClick={load} disabled={loading}>
            Recargar
          </Button>
        </div>
      </div>

      {/* Crear reportes */}
      <Row className="g-3 mb-3">
        <Col md={6}>
          <Card>
            <Card.Body>
              <div className="fw-semibold mb-1">Crear reporte (modo clásico)</div>
              <div className="text-muted mb-2">
                Crea un reporte desde el <b>último informe</b> del proyecto (snapshot).
              </div>

              <Button
                variant="primary"
                onClick={crearViejoDesdeUltimoInforme}
                disabled={creatingOld || loading}
              >
                {creatingOld ? (
                  <>
                    <Spinner size="sm" className="me-2" /> Creando...
                  </>
                ) : (
                  "➕ Crear desde último informe"
                )}
              </Button>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Card>
            <Card.Body>
              <div className="fw-semibold mb-1">Crear reporte general (agregado)</div>
              <div className="text-muted mb-2">
                Agrega estadísticas/resumen de <b>todos los censados</b> de una plantilla.
              </div>

              <Row className="g-2">
                <Col md={6}>
                  <Form.Label className="mb-1">Plantilla</Form.Label>
                  <Form.Select
                    value={plantillaSel}
                    onChange={(e) => setPlantillaSel(e.target.value)}
                    disabled={creatingAgregado || loading}
                  >
                    {plantillas.length ? (
                      plantillas.map((p) => (
                        <option key={p.id_plantilla} value={String(p.id_plantilla)}>
                          {plantillaLabel(p)}
                        </option>
                      ))
                    ) : (
                      <option value="">(Sin plantillas)</option>
                    )}
                  </Form.Select>
                </Col>

                <Col md={6}>
                  <Form.Label className="mb-1">Título (opcional)</Form.Label>
                  <InputGroup>
                    <Form.Control
                      value={tituloAgregado}
                      onChange={(e) => setTituloAgregado(e.target.value)}
                      placeholder="Ej: Reporte general – Ruta 1"
                      disabled={creatingAgregado || loading}
                    />
                  </InputGroup>
                </Col>

                <Col md={12} className="d-grid">
                  <Button
                    variant="dark"
                    onClick={crearAgregado}
                    disabled={creatingAgregado || loading || !plantillas.length}
                  >
                    {creatingAgregado ? (
                      <>
                        <Spinner size="sm" className="me-2" /> Creando...
                      </>
                    ) : (
                      "➕ Crear reporte agregado"
                    )}
                  </Button>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Listado */}
      <Card>
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="fw-semibold">Listado de reportes</div>
            <div className="text-muted small">
              {loading ? "Cargando..." : `${reportes.length} reporte(s)`}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-4">
              <Spinner /> <div className="mt-2">Cargando...</div>
            </div>
          ) : reportes.length === 0 ? (
            <div className="text-muted">Aún no hay reportes para este proyecto.</div>
          ) : (
            <div className="table-responsive">
              <Table hover size="sm" className="align-middle">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>ID</th>
                    <th>Título</th>
                    <th style={{ width: 120 }}>Estado</th>
                    <th style={{ width: 120 }}>Fuente</th>
                    <th style={{ width: 190 }}>Creado</th>
                    <th style={{ width: 190 }}>Editado</th>
                    <th style={{ width: 160 }} className="text-end">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reportes.map((r) => (
                    <tr key={r.id_reporte}>
                      <td>
                        <Badge bg="light" text="dark">
                          #{r.id_reporte}
                        </Badge>
                      </td>
                      <td>
                        <div className="fw-semibold">{r.titulo || "(sin título)"}</div>
                        <div className="text-muted small">
                          Plantilla: {r.id_plantilla} · Proyecto: {r.id_proyecto}
                        </div>
                      </td>
                      <td>
                        <Badge bg={r.estado === "final" ? "success" : "warning"}>
                          {r.estado || "borrador"}
                        </Badge>
                      </td>
                      <td>
                        <Badge bg={r.fuente === "agregado" ? "dark" : "info"}>
                          {r.fuente || "informe"}
                        </Badge>
                      </td>
                      <td className="text-muted">{fmtFecha(r.fecha_creado)}</td>
                      <td className="text-muted">{fmtFecha(r.fecha_editado)}</td>
                      <td className="text-end">
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => goBuilder(r.id_reporte)}
                        >
                          Abrir builder
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
