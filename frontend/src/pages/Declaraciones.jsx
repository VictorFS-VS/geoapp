// src/pages/Declaraciones.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Modal,
  Button,
  Form,
  Table,
  Row,
  Col,
  Container,
  Spinner,
  Placeholder,
  Badge,
  Alert,
} from "react-bootstrap";
import Swal from "sweetalert2";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ==== helpers auth/fetch ==== */
const authHeaders = () => {
  const t = localStorage.getItem("token");
  const bearer = t?.startsWith("Bearer ") ? t : t ? `Bearer ${t}` : null;
  return bearer ? { Authorization: bearer } : {};
};

const redirect401 = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/login");
};

// Para endpoints JSON
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return null;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Nombre “bonito” de archivos
const displayName = (doc) => (doc?.display_name || doc?.nombre_archivo || "").replace(/^\d+_/, "");

/* Trae conceptos con token; si falla por-tipo, usa fallback protegido */
async function fetchConceptos(tipo) {
  const headers = authHeaders();

  // 1) por-tipo (con token)
  try {
    const r = await fetch(`${API_URL}/conceptos/por-tipo/${encodeURIComponent(tipo)}`, { headers });
    const rows = await jsonOrRedirect401(r);
    if (rows && Array.isArray(rows)) return rows;
  } catch {}

  // 2) fallback protegido
  try {
    const r2 = await fetch(`${API_URL}/conceptos?tipoconcepto=${encodeURIComponent(tipo)}&simple=1`, { headers });
    const rows2 = await jsonOrRedirect401(r2);
    if (rows2 && Array.isArray(rows2)) return rows2;
  } catch {}

  return [];
}

export default function Declaraciones() {
  const { id } = useParams();
  const token = localStorage.getItem("token");
  const bearer = token ? (token.startsWith("Bearer ") ? token : `Bearer ${token}`) : null;
  const auth = bearer ? { headers: { Authorization: bearer } } : {};

  const [loading, setLoading] = useState(true);

  // ----- Proyecto (para mostrar nombre en el encabezado) -----
  const [nombreProyecto, setNombreProyecto] = useState("");

  // ----- Declaraciones -----
  const [declaraciones, setDeclaraciones] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [modo, setModo] = useState("crear");

  const [formData, setFormData] = useState({
    id_declaracion: null,
    nro_declaracion: "",
    gestion_declaracion: "",
    fecha_declaracion: "",
    fecha_declaracion_vto: "",
    fecha_prox_vto_aa: "",
    estado: "",
    observacion: "",
  });

  const [tipoUsuario, setTipoUsuario] = useState(null);

  // Opciones para el select de ESTADO (DECLA_ESTADO)
  const [opEstados, setOpEstados] = useState([]);

  // Diccionario código -> nombre
  const estadoDict = useMemo(() => {
    const m = {};
    (opEstados || []).forEach((o) => {
      m[o.concepto] = o.nombre;
    });
    return m;
  }, [opEstados]);

  // Guards para evitar dobles llamadas en StrictMode
  const didLoadDeclRef = useRef(false);
  const didLoadEstadosRef = useRef(false);

  // ----- Documentos (categoría: declaraciones) -----
  const [archivo, setArchivo] = useState(null);
  const [documentos, setDocumentos] = useState([]);

  const [carpetas, setCarpetas] = useState([]);
  const [carpetaSel, setCarpetaSel] = useState(""); // '' = raíz del proyecto
  const [nuevaCarpeta, setNuevaCarpeta] = useState("");

  const [busyId, setBusyId] = useState(null); // id_archivo en acción
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState("");

  const [preview, setPreview] = useState(null); // { url, nombre, mime }
  const isPreviewImage = useMemo(() => (preview?.mime || "").startsWith("image/"), [preview]);
  const isPreviewPdf = useMemo(() => (preview?.mime || "").toLowerCase().includes("pdf"), [preview]);

  // ------------------- Carga inicial -------------------
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        setLoading(true);

        // Proyecto → para encabezado con nombre
        try {
          const r = await fetch(`${API_URL}/proyectos/${id}`, auth);
          const proyecto = await jsonOrRedirect401(r);
          if (proyecto && isMounted) {
            const nombre = proyecto?.nombre || proyecto?.codigo || `Proyecto ${id}`;
            setNombreProyecto(nombre);
          }
        } catch {
          if (isMounted) setNombreProyecto(`Proyecto ${id}`);
        }

        // Cargar declaraciones
        if (!didLoadDeclRef.current) {
          didLoadDeclRef.current = true;
          await cargarDeclaraciones();
        }

        // Decodificar tipo de usuario
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1] || ""));
            const tu = Number(payload?.tipo_usuario);
            if (Number.isFinite(tu)) setTipoUsuario(tu);
          } catch {}
        }

        // Estados de declaraciones
        if (!didLoadEstadosRef.current) {
          didLoadEstadosRef.current = true;
          const rows = await fetchConceptos("DECLA_ESTADO");
          setOpEstados(rows);
        }

        // Docs: carpetas + lista raíz
        await cargarCarpetas();
        setCarpetaSel("");
        await cargarDocs("");
      } catch (e) {
        alerts.toast?.error?.("Error al cargar datos");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // Re-cargar lista al cambiar carpeta
  useEffect(() => {
    cargarDocs(carpetaSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carpetaSel]);

  // ---- API ----
  const cargarDeclaraciones = async () => {
    try {
      const res = await fetch(`${API_URL}/declaraciones/${id}`, { headers: authHeaders() });
      const data = await jsonOrRedirect401(res);
      if (!data) return;
      setDeclaraciones(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error cargando declaraciones:", err);
      setDeclaraciones([]);
    }
  };

  // ---- UI actions declaraciones ----
  const abrirModal = (nuevoModo, dec = null) => {
    setModo(nuevoModo);
    setFormData(
      dec
        ? {
            id_declaracion: dec.id_declaracion,
            nro_declaracion: dec.nro_declaracion,
            gestion_declaracion: dec.gestion_declaracion,
            fecha_declaracion: dec.fecha_declaracion?.split("T")[0] || "",
            fecha_declaracion_vto: dec.fecha_declaracion_vto?.split("T")[0] || "",
            fecha_prox_vto_aa: dec.fecha_prox_vto_aa?.split("T")[0] || "",
            estado: dec.estado || "",
            observacion: dec.observacion || "",
          }
        : {
            id_declaracion: null,
            nro_declaracion: "",
            gestion_declaracion: "",
            fecha_declaracion: "",
            fecha_declaracion_vto: "",
            fecha_prox_vto_aa: "",
            estado: "",
            observacion: "",
          }
    );
    setShowModal(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    const url = formData.id_declaracion
      ? `${API_URL}/declaraciones/${formData.id_declaracion}`
      : `${API_URL}/declaraciones`;
    const method = formData.id_declaracion ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...formData, id_proyecto: id }),
      });
      const json = await jsonOrRedirect401(res);
      if (!json) return;

      alerts.toast?.success?.("Declaración guardada");
      setShowModal(false);
      cargarDeclaraciones();
    } catch (err) {
      console.error("Error al guardar declaración:", err);
      alerts.toast?.error?.("Error al guardar");
    }
  };

  const eliminar = async (idDecl) => {
    const ok = await Swal.fire({
      title: "¿Eliminar esta declaración?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
    });
    if (!ok.isConfirmed) return;

    try {
      const res = await fetch(`${API_URL}/declaraciones/${idDecl}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const j = await jsonOrRedirect401(res);
      if (!j) return;

      alerts.toast?.success?.("Declaración eliminada");
      cargarDeclaraciones();
    } catch (e) {
      console.error("Error al eliminar declaración:", e);
      alerts.toast?.error?.("Error al eliminar");
    }
  };

  // ---------------- Documentos (categoría: declaraciones) ----------------
  const cargarCarpetas = async () => {
    try {
      setDocsError("");
      const r = await fetch(`${API_URL}/documentos/carpetas/${id}`, auth);
      const j = await jsonOrRedirect401(r);
      if (!j) return;
      setCarpetas(Array.isArray(j) ? j : []);
    } catch {
      setCarpetas([]);
      setDocsError("Error cargando carpetas.");
    }
  };

  const cargarDocs = async (subcarpeta = carpetaSel) => {
    try {
      setLoadingDocs(true);
      setDocsError("");

      const url = new URL(`${API_URL}/documentos/listar/${id}/otros`);
      if (subcarpeta) url.searchParams.set("carpeta", subcarpeta);

      const r = await fetch(url, auth);
      const j = await jsonOrRedirect401(r);
      if (!j) return;

      setDocumentos(Array.isArray(j) ? j : []);
    } catch (e) {
      setDocumentos([]);
      setDocsError(e?.message || "Error cargando documentos.");
    } finally {
      setLoadingDocs(false);
    }
  };

  const crearCarpeta = async () => {
    const nombre = (nuevaCarpeta || "").trim();
    if (!nombre) return alerts.toast?.warn?.("Ingrese un nombre de carpeta");

    try {
      alerts.loading?.("Creando carpeta...");
      const r = await fetch(`${API_URL}/documentos/carpetas/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: bearer } : {}) },
        body: JSON.stringify({ nombre }),
      });
      const j = await r.json().catch(() => ({}));
      alerts.close?.();

      if (!r.ok) throw new Error(j?.message || "No se pudo crear la carpeta");

      setNuevaCarpeta("");
      await cargarCarpetas();
      setCarpetaSel(nombre);
      alerts.toast?.success?.("Carpeta creada");
    } catch (e) {
      alerts.close?.();
      alerts.toast?.error?.(e.message || "Error creando carpeta");
    }
  };

  const subirDocumento = async () => {
    if (!archivo) return alerts.toast?.warn?.("Debe seleccionar un archivo");

    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("subcarpeta", carpetaSel);

      alerts.loading?.("Subiendo documento...");
      const res = await fetch(`${API_URL}/documentos/upload/${id}/otros`, {
        method: "POST",
        headers: { ...(bearer ? { Authorization: bearer } : {}) },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      alerts.close?.();

      if (!res.ok) throw new Error(json?.message || "Error al subir documento");

      setArchivo(null);
      await cargarDocs(carpetaSel);
      alerts.toast?.success?.("Documento subido");
    } catch (err) {
      alerts.close?.();
      alerts.toast?.error?.(err.message || "Error al subir documento");
    }
  };

  const eliminarDocumento = async (idArchivo) => {
    const ok = await Swal.fire({
      title: "¿Eliminar el documento?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
    });
    if (!ok.isConfirmed) return;

    try {
      alerts.loading?.("Eliminando...");
      const res = await fetch(`${API_URL}/documentos/eliminar/${idArchivo}`, {
        method: "DELETE",
        headers: { ...(bearer ? { Authorization: bearer } : {}) },
      });
      const text = res.ok ? "" : await res.text();
      alerts.close?.();
      if (!res.ok) throw new Error(text || "No se pudo eliminar");

      await cargarDocs(carpetaSel);
      alerts.toast?.success?.("Documento eliminado");
    } catch (err) {
      alerts.close?.();
      alerts.toast?.error?.(err.message || "Error al eliminar");
    }
  };

  const descargarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyId) return;

    setBusyId(idArchivo);
    try {
      const res = await fetch(`${API_URL}/documentos/descargar/${idArchivo}`, {
        headers: { ...(bearer ? { Authorization: bearer } : {}) },
      });
      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename\*?=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
      const suggested = decodeURIComponent(match?.[1] || match?.[2] || displayName(doc) || "archivo");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggested;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alerts.toast?.error?.(err.message || "Error al descargar");
    } finally {
      setBusyId(null);
    }
  };

  const verPreview = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyId) return;

    setBusyId(idArchivo);
    try {
      alerts.loading?.("Cargando vista previa...");
      const res = await fetch(`${API_URL}/documentos/ver/${idArchivo}`, {
        headers: { ...(bearer ? { Authorization: bearer } : {}) },
      });
      alerts.close?.();
      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // cerrar anterior si existía
      if (preview?.url) URL.revokeObjectURL(preview.url);

      setPreview({ url, nombre: displayName(doc), mime: blob.type || "" });
    } catch (e) {
      alerts.close?.();
      alerts.toast?.error?.(e.message || "No se pudo previsualizar");
    } finally {
      setBusyId(null);
    }
  };

  const cerrarPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const renombrar = async (doc) => {
    const actual = displayName(doc);

    const { value: pedido, isConfirmed } = await Swal.fire({
      title: "Renombrar / Mover",
      text: "El archivo se guardará en la carpeta seleccionada",
      input: "text",
      inputLabel: "Nuevo nombre (incluya la extensión)",
      inputValue: actual,
      showCancelButton: true,
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
      inputValidator: (v) => (!v?.trim() ? "Ingrese un nombre" : undefined),
    });
    if (!isConfirmed) return;

    try {
      alerts.loading?.("Guardando cambios...");
      const r = await fetch(`${API_URL}/documentos/renombrar/${doc.id_archivo}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: bearer } : {}) },
        body: JSON.stringify({ nuevoNombre: pedido, nuevaSubcarpeta: carpetaSel }),
      });
      const text = r.ok ? "" : await r.text();
      alerts.close?.();
      if (!r.ok) throw new Error(text || "No se pudo renombrar/mover");

      await cargarDocs(carpetaSel);
      alerts.toast?.success?.("Documento actualizado");
    } catch (e) {
      alerts.close?.();
      alerts.toast?.error?.(e.message || "Error al actualizar");
    }
  };

  // ---------------- Render ----------------
  return (
    <Container className="py-4">
      {/* Header (muestra nombre del proyecto) */}
      <div className="d-flex justify-content-between align-items-center mb-3" style={{ minHeight: 44 }}>
        <h2 className="mb-0 d-flex align-items-center gap-2">
          {loading ? (
            <Placeholder as="span" animation="wave">
              <Placeholder xs={6} />
            </Placeholder>
          ) : (
            <span>Declaraciones — {nombreProyecto}</span>
          )}
          {loading ? (
            <Placeholder as="span" animation="wave">
              <Placeholder xs={2} />
            </Placeholder>
          ) : declaraciones?.length > 0 ? (
            <Badge bg="primary" pill>
              {declaraciones.length}
            </Badge>
          ) : null}
        </h2>

        {tipoUsuario !== 9 && (
          <Button variant="primary" onClick={() => abrirModal("crear")}>
            ➕ Nueva
          </Button>
        )}
      </div>

      {/* Tabla declaraciones */}
      {loading ? (
        <div className="py-5 text-center">
          <Spinner animation="border" role="status" />
        </div>
      ) : (
        <div className="table-responsive">
          <Table bordered hover>
            <thead className="table-primary">
              <tr>
                <th>ID</th>
                <th>Estado</th>
                <th>Nro Decl.</th>
                <th>Gestión</th>
                <th>Fecha</th>
                <th style={{ width: 220 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {declaraciones.map((dec) => (
                <tr key={dec.id_declaracion}>
                  <td>{dec.id_declaracion}</td>
                  <td>{estadoDict[dec.estado] ? `${dec.estado} - ${estadoDict[dec.estado]}` : dec.estado}</td>
                  <td>{dec.nro_declaracion}</td>
                  <td>{dec.gestion_declaracion}</td>
                  <td>{dec.fecha_declaracion?.split("T")[0]}</td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      {tipoUsuario !== 9 && (
                        <Button variant="warning" onClick={() => abrirModal("editar", dec)}>
                          Editar
                        </Button>
                      )}
                      {tipoUsuario === 1 && (
                        <Button variant="danger" onClick={() => eliminar(dec.id_declaracion)}>
                          Eliminar
                        </Button>
                      )}
                      <Button variant="info" className="text-white" onClick={() => abrirModal("ver", dec)}>
                        Ver
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {declaraciones.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center">
                    Sin registros
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {/* ==================== Documentos (UI mejorado como VerProyecto) ==================== */}
      <div className="mt-5">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
          <h4 className="mb-0">📁 Documentación del Proyecto</h4>

          <div className="d-flex align-items-center gap-2">
            <Badge bg="secondary">{carpetaSel ? `Carpeta: ${carpetaSel}` : "Carpeta: (raíz)"}</Badge>
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

        {/* Crear carpeta + subir */}
        <Row className="g-2 align-items-end mb-3">
          <Col md={5}>
            <Form.Label className="mb-1">Nueva carpeta</Form.Label>
            <div className="d-flex gap-2">
              <Form.Control
                placeholder="Ej: DIA / Resolución / 2026"
                value={nuevaCarpeta}
                onChange={(e) => setNuevaCarpeta(e.target.value)}
              />
              <Button variant="outline-success" onClick={crearCarpeta}>
                Crear
              </Button>
            </div>
          </Col>

          <Col md={7}>
            <Form.Label className="mb-1">Subir archivo a: {carpetaSel ? `"${carpetaSel}"` : "(raíz)"}</Form.Label>
            <div className="d-flex gap-2 flex-wrap">
              <Form.Control type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
              <Button onClick={subirDocumento} variant="primary">
                Subir
              </Button>
            </div>
          </Col>
        </Row>

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
              <th style={{ width: 380 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(documentos) ? documentos : []).map((doc) => (
              <tr key={doc.id_archivo}>
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

                  <Button size="sm" variant="outline-primary" onClick={() => renombrar(doc)} disabled={busyId === doc.id_archivo}>
                    Renombrar / Mover
                  </Button>

                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => eliminarDocumento(doc.id_archivo)}
                    disabled={busyId === doc.id_archivo}
                  >
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}

            {!loadingDocs && (!documentos || documentos.length === 0) && (
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
                    <iframe title="preview" src={preview.url} style={{ width: "100%", height: "100%", border: 0 }} />
                  )}
                </div>

                <div className="modal-footer">
                  {!isPreviewPdf ? null : (
                    <small className="text-muted me-auto">
                      Si el PDF no se ve, revisá que el backend responda Content-Type: application/pdf y Content-Disposition: inline.
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

      {/* Modal Declaración */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>
            {modo === "crear" ? "Nueva Declaración" : modo === "editar" ? "Editar Declaración" : "Ver Declaración"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Form className="row g-3">
            <Row>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Nro Declaración</Form.Label>
                  <Form.Control
                    name="nro_declaracion"
                    value={formData.nro_declaracion}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Gestión</Form.Label>
                  <Form.Control
                    name="gestion_declaracion"
                    value={formData.gestion_declaracion}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Fecha Decl.</Form.Label>
                  <Form.Control
                    type="date"
                    name="fecha_declaracion"
                    value={formData.fecha_declaracion}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Fecha Vto.</Form.Label>
                  <Form.Control
                    type="date"
                    name="fecha_declaracion_vto"
                    value={formData.fecha_declaracion_vto}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Próx. Vto. AA</Form.Label>
                  <Form.Control
                    type="date"
                    name="fecha_prox_vto_aa"
                    value={formData.fecha_prox_vto_aa}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Estado</Form.Label>
                  <Form.Select name="estado" value={formData.estado} onChange={handleChange} disabled={modo === "ver"}>
                    <option value="">Seleccione un Estado</option>
                    {opEstados.map((opt) => (
                      <option key={opt.concepto} value={opt.concepto}>
                        {`${opt.concepto} - ${opt.nombre}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group>
                  <Form.Label>Observación</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    name="observacion"
                    value={formData.observacion}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>

        {modo !== "ver" && tipoUsuario !== 9 && (
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardar}>
              Guardar
            </Button>
          </Modal.Footer>
        )}
      </Modal>
    </Container>
  );
}
