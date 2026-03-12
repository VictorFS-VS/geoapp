// src/pages/VerProyecto.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Form, Button, Row, Col, Container, Spinner, Badge, Alert } from "react-bootstrap";
import GoogleMapaCoordenadas from "@/components/GoogleMapaCoordenadas";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ───────────────── Helpers ───────────────── */
const getBearer = () => {
  const raw = localStorage.getItem("token");
  if (!raw) return null;
  return raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
};

const authHeaders = () => {
  const bearer = getBearer();
  return bearer ? { Authorization: bearer } : {};
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

const toArray = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.data) ? x.data : []);

const displayName = (doc) =>
  String(doc?.display_name || doc?.nombre_archivo || "archivo").replace(/^\d+_/, "");

/* ───────────────── Page ───────────────── */
export default function VerProyecto() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({});
  const [tiposEstudio, setTiposEstudio] = useState([]);
  const [tiposProyecto, setTiposProyecto] = useState([]);
  const [actividades, setActividades] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [proponentes, setProponentes] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [estados, setEstados] = useState([]);

  // Docs
  const [carpetas, setCarpetas] = useState([]);
  const [carpetaSel, setCarpetaSel] = useState(""); // '' = raíz
  const [documentos, setDocumentos] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busyId, setBusyId] = useState(null); // id_archivo descargando/previsualizando
  const [docsError, setDocsError] = useState("");

  // Preview
  const [preview, setPreview] = useState(null); // { url, nombre, mime }
  const isPreviewImage = useMemo(() => (preview?.mime || "").startsWith("image/"), [preview]);
  const isPreviewPdf = useMemo(
    () => (preview?.mime || "").toLowerCase().includes("pdf"),
    [preview]
  );

  const cerrarPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  // Utilidades para opciones de <select>
  const optKey = (o) => o?.concepto ?? o?.id ?? o?.valor ?? o?.nombre ?? JSON.stringify(o);
  const optVal = (o) => o?.concepto ?? o?.id ?? o?.valor ?? "";
  const optLabel = (o) => o?.nombre ?? o?.descripcion ?? o?.etiqueta ?? String(optVal(o));

  /* ───────────── Docs loaders ───────────── */
  const cargarCarpetas = async () => {
    const headers = authHeaders();
    setDocsError("");
    try {
      const r = await fetch(`${API_URL}/documentos/carpetas/${id}`, { headers });
      const j = await jsonOrRedirect401(r);
      if (!j) return;
      setCarpetas(Array.isArray(j) ? j : []);
    } catch (e) {
      setCarpetas([]);
      setDocsError("No se pudieron cargar las carpetas.");
    }
  };

  const cargarDocs = async (subcarpeta = carpetaSel) => {
    const headers = authHeaders();
    setLoadingDocs(true);
    setDocsError("");
    try {
      const url = new URL(`${API_URL}/documentos/listar/${id}/otros`);
      if (subcarpeta) url.searchParams.set("carpeta", subcarpeta);

      const r = await fetch(url, { headers });
      const j = await jsonOrRedirect401(r);
      if (!j) return;

      const docsArr = Array.isArray(j) ? j : toArray(j);
      setDocumentos(docsArr);
    } catch (e) {
      setDocumentos([]);
      setDocsError(e?.message || "No se pudieron cargar los documentos.");
    } finally {
      setLoadingDocs(false);
    }
  };

  /* ───────────── Page load ───────────── */
  useEffect(() => {
    const headers = authHeaders();

    const load = async () => {
      try {
        setLoading(true);

        // Proyecto + catálogos (paralelo)
        const [
          proyectoRes,
          tipoEstudioRes,
          tipoProyectoRes,
          actividadRes,
          sectorRes,
          estadoRes,
          consultoresRes,
          proponentesRes,
        ] = await Promise.all([
          fetch(`${API_URL}/proyectos/${id}`, { headers }),

          fetch(`${API_URL}/conceptos/tipo-estudio`, { headers }),
          fetch(`${API_URL}/conceptos/tipo-proyecto`, { headers }),
          fetch(`${API_URL}/conceptos/actividad`, { headers }),
          fetch(`${API_URL}/conceptos/sector-proyecto`, { headers }),
          fetch(`${API_URL}/conceptos/proyecto-estado`, { headers }),

          fetch(`${API_URL}/consultores`, { headers }),
          fetch(`${API_URL}/proponentes`, { headers }),
        ]);

        const proyecto = await jsonOrRedirect401(proyectoRes);
        if (!proyecto) return;

        // normalizar proyecto como en EditarProyecto
        setFormData({
          ...proyecto,
          expediente: proyecto.expediente || "",
          fecha_inicio: proyecto.fecha_inicio?.split("T")?.[0] || "",
          fecha_final: proyecto.fecha_final?.split("T")?.[0] || "",
          fecha_registro: proyecto.fecha_registro?.split("T")?.[0] || "",
          sector: proyecto.sector_proyecto || "",
          coordenada_x: proyecto.coor_x ?? "",
          coordenada_y: proyecto.coor_y ?? "",
          departamento: proyecto.dpto || "",
        });

        // catálogos
        setTiposEstudio(toArray(await jsonOrRedirect401(tipoEstudioRes)));
        setTiposProyecto(toArray(await jsonOrRedirect401(tipoProyectoRes)));
        setActividades(toArray(await jsonOrRedirect401(actividadRes)));
        setSectores(toArray(await jsonOrRedirect401(sectorRes)));
        setEstados(toArray(await jsonOrRedirect401(estadoRes)));

        const cons = await jsonOrRedirect401(consultoresRes);
        setConsultores(toArray(cons));

        const props = await jsonOrRedirect401(proponentesRes);
        setProponentes(toArray(props));

        // docs UI (carpetas + docs raíz)
        await cargarCarpetas();
        await cargarDocs("");
        setCarpetaSel("");
      } catch (e) {
        console.error("No se pudo cargar VerProyecto:", e);
        alert("No se pudo cargar el proyecto");
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cuando cambia carpeta seleccionada => recargar docs
  useEffect(() => {
    cargarDocs(carpetaSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carpetaSel]);

  /* ───────────── Docs actions ───────────── */
  const descargarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyId) return;

    setBusyId(idArchivo);
    try {
      const res = await fetch(`${API_URL}/documentos/descargar/${idArchivo}`, {
        headers: authHeaders(),
      });

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      // nombre sugerido desde Content-Disposition
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename\*?=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
      const suggested = decodeURIComponent(match?.[1] || match?.[2] || displayName(doc));

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = suggested || displayName(doc);
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error("Fallo en la descarga:", e);
      alert(e?.message || "Error al descargar");
    } finally {
      setBusyId(null);
    }
  };

  const verPreview = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyId) return;

    setBusyId(idArchivo);
    try {
      const res = await fetch(`${API_URL}/documentos/ver/${idArchivo}`, {
        headers: authHeaders(),
      });

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // cerrar anterior si existía
      if (preview?.url) URL.revokeObjectURL(preview.url);

      setPreview({
        url,
        nombre: displayName(doc),
        mime: blob.type || "",
      });
    } catch (e) {
      console.error("Fallo preview:", e);
      alert(e?.message || "No se pudo previsualizar");
    } finally {
      setBusyId(null);
    }
  };

  /* ───────────── Render ───────────── */
  return (
    <Container className="mt-5">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="mb-0">Ver Proyecto</h2>
        <Button variant="secondary" onClick={() => navigate("/proyectos")}>
          Volver
        </Button>
      </div>

      {loading ? (
        <div className="py-5 text-center">
          <Spinner animation="border" role="status" />
        </div>
      ) : (
        <>
          <Form>
            <Row className="mb-3">
              <Col md={6}>
                <Form.Label>Nro Expediente</Form.Label>
                <Form.Control value={formData.expediente || ""} readOnly />
              </Col>
              <Col md={6}>
                <Form.Label>Tipo de Estudio</Form.Label>
                <Form.Select value={formData.tipo_estudio || ""} disabled>
                  <option value="">Seleccione</option>
                  {(tiposEstudio || []).map((t) => (
                    <option key={optKey(t)} value={optVal(t)}>
                      {optLabel(t)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={6}>
                <Form.Label>Código</Form.Label>
                <Form.Control value={formData.codigo || ""} readOnly />
              </Col>
              <Col md={6}>
                <Form.Label>Tipo de Proyecto</Form.Label>
                <Form.Select value={formData.tipo_proyecto || ""} disabled>
                  <option value="">Seleccione</option>
                  {(tiposProyecto || []).map((t) => (
                    <option key={optKey(t)} value={optVal(t)}>
                      {optLabel(t)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={6}>
                <Form.Label>Nombre</Form.Label>
                <Form.Control value={formData.nombre || ""} readOnly />
              </Col>
              <Col md={6}>
                <Form.Label>Actividad</Form.Label>
                <Form.Select value={formData.actividad || ""} disabled>
                  <option value="">Seleccione</option>
                  {(actividades || []).map((a) => (
                    <option key={optKey(a)} value={optVal(a)}>
                      {optLabel(a)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={4}>
                <Form.Label>Estado</Form.Label>
                <Form.Select value={formData.estado || ""} disabled>
                  <option value="">Seleccione</option>
                  {(estados || []).map((e) => (
                    <option key={optKey(e)} value={optVal(e)}>
                      {optLabel(e)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Consultor</Form.Label>
                <Form.Select value={formData.id_consultor || ""} disabled>
                  <option value="">Seleccione</option>
                  {(consultores || []).map((c) => (
                    <option
                      key={c.id_consultor ?? optKey(c)}
                      value={c.id_consultor ?? optVal(c)}
                    >
                      {c.nombre ?? optLabel(c)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Proponente</Form.Label>
                <Form.Select value={formData.id_proponente || ""} disabled>
                  <option value="">Seleccione</option>
                  {(proponentes || []).map((p) => (
                    <option key={p.id_cliente ?? optKey(p)} value={p.id_cliente ?? optVal(p)}>
                      {p.nombre ?? optLabel(p)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={4}>
                <Form.Label>Departamento</Form.Label>
                <Form.Control value={formData.departamento || ""} readOnly />
              </Col>
              <Col md={4}>
                <Form.Label>Distrito</Form.Label>
                <Form.Control value={formData.distrito || ""} readOnly />
              </Col>
              <Col md={4}>
                <Form.Label>Barrio</Form.Label>
                <Form.Control value={formData.barrio || ""} readOnly />
              </Col>
            </Row>

            {/* ✅ Mapa visor (solo lectura) */}
            <Row className="mb-3">
              <Col md={12}>
                <Form.Label>Ubicación (Lat/Lng)</Form.Label>
                <GoogleMapaCoordenadas
                  height={320}
                  value={(() => {
                    const lat = Number(formData.coordenada_y); // coor_y = lat
                    const lng = Number(formData.coordenada_x); // coor_x = lng
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    return { lat, lng };
                  })()}
                  onChange={() => {}}
                  readOnly={true}
                  disabled={true}
                />
                <Form.Text className="text-muted">Vista de ubicación (solo lectura).</Form.Text>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>Descripción</Form.Label>
              <Form.Control as="textarea" rows={3} value={formData.descripcion || ""} readOnly />
            </Form.Group>
          </Form>

          {/* ==================== Documentación (UI mejorado) ==================== */}
          <div className="mt-5">
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
              <h4 className="mb-0">📁 Documentación</h4>

              <div className="d-flex align-items-center gap-2">
                <Badge bg="secondary">
                  {carpetaSel ? `Carpeta: ${carpetaSel}` : "Carpeta: (raíz)"}
                </Badge>
                {loadingDocs ? (
                  <span className="text-muted d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" /> Cargando…
                  </span>
                ) : null}
              </div>
            </div>

            {/* Botones de carpetas (reemplaza selector) */}
            <div className="d-flex flex-wrap gap-2 mb-3">
              <Button
                size="sm"
                variant={carpetaSel === "" ? "primary" : "outline-primary"}
                onClick={() => setCarpetaSel("")}
                title="Mostrar documentos en la raíz"
              >
                (Raíz)
              </Button>

              {(Array.isArray(carpetas) ? carpetas : []).map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={carpetaSel === c ? "primary" : "outline-primary"}
                  onClick={() => setCarpetaSel(c)}
                  title={`Ver documentos de: ${c}`}
                >
                  {c}
                </Button>
              ))}

              <div className="ms-auto d-flex gap-2">
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    cargarCarpetas();
                    cargarDocs(carpetaSel);
                  }}
                  title="Recargar carpetas y documentos"
                >
                  ↻ Recargar
                </Button>
              </div>
            </div>

            {docsError ? (
              <Alert variant="warning" className="py-2">
                {docsError}
              </Alert>
            ) : null}

            <table className="table table-bordered align-middle">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Carpeta</th>
                  <th>Fecha</th>
                  <th style={{ width: 260 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {(documentos || []).map((doc) => (
                  <tr key={doc.id_archivo ?? doc.nombre_archivo}>
                    <td>{displayName(doc)}</td>
                    <td>{doc.subcarpeta || "(raíz)"}</td>
                    <td>{doc.fecha || ""}</td>
                    <td className="d-flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => verPreview(doc)}
                        disabled={busyId === doc.id_archivo}
                      >
                        {busyId === doc.id_archivo ? "Cargando..." : "Vista previa"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline-success"
                        onClick={() => descargarDocumento(doc)}
                        disabled={busyId === doc.id_archivo}
                      >
                        {busyId === doc.id_archivo ? "Descargando..." : "Descargar"}
                      </Button>
                    </td>
                  </tr>
                ))}

                {!loadingDocs && (documentos || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted">
                      No hay documentos en {carpetaSel ? `"${carpetaSel}"` : "la raíz"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Modal preview */}
            {preview && (
              <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.5)" }}>
                <div className="modal-dialog modal-xl">
                  <div className="modal-content">
                    <div className="modal-header">
                      <h5 className="modal-title">Vista previa – {preview.nombre}</h5>
                      <button type="button" className="btn-close" onClick={cerrarPreview} />
                    </div>

                    <div
                      className="modal-body"
                      style={{
                        height: "75vh",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#f8f9fa",
                      }}
                    >
                      {isPreviewImage ? (
                        <img
                          src={preview.url}
                          alt={preview.nombre}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            boxShadow: "0 0 10px rgba(0,0,0,0.2)",
                          }}
                        />
                      ) : (
                        <iframe
                          title="preview"
                          src={preview.url}
                          style={{ width: "100%", height: "100%", border: 0 }}
                        />
                      )}
                    </div>

                    <div className="modal-footer">
                      {!isPreviewPdf ? null : (
                        <small className="text-muted me-auto">
                          Si el PDF no se ve, revisá que el backend responda Content-Type: application/pdf y
                          Content-Disposition: inline.
                        </small>
                      )}
                      <Button variant="secondary" onClick={cerrarPreview}>
                        Cerrar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Container>
  );
}
