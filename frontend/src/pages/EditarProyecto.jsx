// src/pages/EditarProyecto.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Form,
  Button,
  Row,
  Col,
  Container,
  Modal,
  Table,
} from "react-bootstrap";
import Swal from "sweetalert2";
import ProyectoTramosManager from "@/components/gv/ProyectoTramosManager";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

/* =========================
   Helpers auth / fetch
========================= */
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

const ensureOkOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return false;
  }
  if (!res.ok) throw new Error(await res.text());
  return true;
};

/* =========================
   UI docs helpers
========================= */
const displayName = (doc) => {
  const n = String(doc?.display_name || doc?.nombre_archivo || doc?.nombre || "archivo");
  return n.replace(/^\d+_/, "");
};

const isImageMime = (mime = "") => String(mime).toLowerCase().startsWith("image/");
const isPdfMime = (mime = "") => String(mime).toLowerCase().includes("pdf");

/* =========================
   Endpoints docs
========================= */
const PROY_DOCS = {
  listCarpetas: (idProyecto) => `${API_URL}/documentos/carpetas/${idProyecto}`,
  listDocs: (idProyecto, carpeta = "") => {
    const url = new URL(`${API_URL}/documentos/listar/${idProyecto}/otros`);
    if (carpeta) url.searchParams.set("carpeta", carpeta);
    return url.toString();
  },
  upload: (idProyecto) => `${API_URL}/documentos/upload/${idProyecto}/otros`,
  ver: (idArchivo) => `${API_URL}/documentos/ver/${idArchivo}`,
  descargar: (idArchivo) => `${API_URL}/documentos/descargar/${idArchivo}`,
  eliminar: (idArchivo) => `${API_URL}/documentos/eliminar/${idArchivo}`,
  renombrar: (idArchivo) => `${API_URL}/documentos/renombrar/${idArchivo}`,
};

export default function EditarProyecto() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    nro_expediente: "",
    codigo: "",
    nombre: "",
    estado: "",
    tipo_estudio: "",
    tipo_proyecto: "",
    actividad: "",
    id_consultor: "",
    id_proponente: "",
    sector: "",
    fecha_inicio: "",
    fecha_final: "",
    fecha_registro: "",
    expediente_hidrico: "",
    coordenada_x: "",
    coordenada_y: "",
    departamento: "",
    distrito: "",
    barrio: "",
    descripcion: "",
    padron: "",
    cta_cte: "",
    finca: "",
    matricula: "",
    geom: "",
    catastro_target_total: "",
  });

  const [tiposEstudio, setTiposEstudio] = useState([]);
  const [tiposProyecto, setTiposProyecto] = useState([]);
  const [actividades, setActividades] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [proponentes, setProponentes] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [estados, setEstados] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [nuevaActividad, setNuevaActividad] = useState("");

  // ===== Documentación =====
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [carpetas, setCarpetas] = useState([]);
  const [carpetaSel, setCarpetaSel] = useState("");
  const [documentos, setDocumentos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [busyDocId, setBusyDocId] = useState(null);
  const [preview, setPreview] = useState(null);

  const fileInputRef = useRef(null);
  const docsModalContentRef = useRef(null);

  const isPreviewImage = useMemo(() => isImageMime(preview?.mime), [preview?.mime]);
  const isPreviewPdf = useMemo(() => isPdfMime(preview?.mime), [preview?.mime]);

  const cerrarPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  /* =========================
     Proyecto
  ========================= */
  const fetchProyecto = async () => {
    try {
      const res = await fetch(`${API_URL}/proyectos/${id}`, {
        headers: authHeaders(),
      });
      const data = await jsonOrRedirect401(res);
      if (!data) return;

      setFormData((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v == null ? "" : v])
        ),
        fecha_inicio: data.fecha_inicio?.split("T")[0] || "",
        fecha_final: data.fecha_final?.split("T")[0] || "",
        fecha_registro: data.fecha_registro?.split("T")[0] || "",
        sector: data.sector_proyecto || "",
        coordenada_x: data.coor_x || "",
        coordenada_y: data.coor_y || "",
        departamento: data.dpto || "",
        catastro_target_total:
          data.catastro_target_total != null ? String(data.catastro_target_total) : "",
      }));
    } catch (err) {
      console.error(err);
      alert(err.message || "No se pudo cargar el proyecto");
    }
  };

  useEffect(() => {
    fetchProyecto();

    const safeJson = async (res) => {
      if (res.status === 401) {
        redirect401();
        return [];
      }
      const j = await res.json().catch(() => []);
      return Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
    };

    Promise.all([
      fetch(`${API_URL}/conceptos/tipo-estudio`, { headers: authHeaders() })
        .then(safeJson)
        .then(setTiposEstudio),

      fetch(`${API_URL}/conceptos/tipo-proyecto`, { headers: authHeaders() })
        .then(safeJson)
        .then(setTiposProyecto),

      fetch(`${API_URL}/conceptos/actividad`, { headers: authHeaders() })
        .then(safeJson)
        .then(setActividades),

      fetch(`${API_URL}/conceptos/sector-proyecto`, { headers: authHeaders() })
        .then(safeJson)
        .then(setSectores),

      fetch(`${API_URL}/conceptos/proyecto-estado`, { headers: authHeaders() })
        .then(safeJson)
        .then(setEstados),

      fetch(`${API_URL}/consultores`, { headers: authHeaders() })
        .then((r) => r.json().catch(() => ({})))
        .then((d) => setConsultores(Array.isArray(d?.data) ? d.data : [])),

      fetch(`${API_URL}/proponentes/dropdown`, { headers: authHeaders() })
        .then((r) => r.json().catch(() => ({})))
        .then((d) => setProponentes(Array.isArray(d?.data) ? d.data : [])),
    ]).catch(() => {});
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const payload = {
        nombre: formData.nombre || null,
        codigo: formData.codigo || null,
        descripcion: formData.descripcion || null,
        expediente_hidrico: formData.expediente_hidrico || null,
        fecha_inicio: formData.fecha_inicio || null,
        fecha_final: formData.fecha_final || null,
        fecha_registro: formData.fecha_registro || null,
        tipo_estudio: formData.tipo_estudio || null,
        tipo_proyecto: formData.tipo_proyecto || null,
        actividad: formData.actividad || null,
        estado: formData.estado || null,
        id_consultor: formData.id_consultor ? parseInt(formData.id_consultor, 10) : null,
        id_proponente: formData.id_proponente ? parseInt(formData.id_proponente, 10) : null,
        sector_proyecto: formData.sector ? parseInt(formData.sector, 10) : null,
        coor_x: formData.coordenada_x ? parseFloat(formData.coordenada_x) : null,
        coor_y: formData.coordenada_y ? parseFloat(formData.coordenada_y) : null,
        dpto: formData.departamento || null,
        distrito: formData.distrito || null,
        barrio: formData.barrio || null,
        padron: formData.padron ? parseInt(formData.padron, 10) : null,
        cta_cte: formData.cta_cte || null,
        finca: formData.finca || null,
        matricula: formData.matricula || null,
        catastro_target_total:
          formData.catastro_target_total !== ""
            ? Number(formData.catastro_target_total)
            : null,
        geom: formData.geom || null,
      };

      const res = await fetch(`${API_URL}/proyectos/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      const ok = await ensureOkOrRedirect401(res);
      if (!ok) return;

      await Swal.fire({
        icon: "success",
        title: "Proyecto actualizado",
        confirmButtonText: "Aceptar",
      });

      navigate("/proyectos");
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Error al actualizar el proyecto",
        confirmButtonText: "Aceptar",
      });
    }
  };

  const agregarActividad = async () => {
    if (!nuevaActividad.trim()) {
      Swal.fire({
        icon: "warning",
        title: "Atención",
        text: "Ingrese un nombre válido",
        confirmButtonText: "Aceptar",
      });
      return;
    }

    try {
      const maxConcepto = Math.max(
        0,
        ...actividades
          .map((a) => parseInt(a.concepto, 10))
          .filter((n) => Number.isFinite(n))
      );

      const nuevoCodigo = String(maxConcepto + 1);

      const nueva = {
        concepto: nuevoCodigo,
        nombre: nuevaActividad,
        tipoconcepto: "ACTIVIDAD",
      };

      const res = await fetch(`${API_URL}/conceptos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(nueva),
      });

      const ok = await ensureOkOrRedirect401(res);
      if (!ok) return;

      setActividades((prev) => [...prev, nueva]);
      setFormData((prev) => ({ ...prev, actividad: nueva.concepto }));
      setNuevaActividad("");
      setShowModal(false);

      Swal.fire({
        icon: "success",
        title: "Actividad añadida",
        confirmButtonText: "Aceptar",
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Error al guardar actividad",
        confirmButtonText: "Aceptar",
      });
    }
  };

  /* =========================
     Documentación
  ========================= */
  const abrirDocs = async () => {
    setDocsModalOpen(true);
    cerrarPreview();
    setArchivo(null);
    setCarpetaSel("");
    if (fileInputRef.current) fileInputRef.current.value = "";

    await cargarCarpetas();
    await cargarDocs("");
  };

  const cargarCarpetas = async () => {
    try {
      const r = await fetch(PROY_DOCS.listCarpetas(id), { headers: authHeaders() });
      const j = await jsonOrRedirect401(r);
      if (!j) return;
      setCarpetas(Array.isArray(j) ? j : []);
    } catch (e) {
      console.error(e);
      setCarpetas([]);
    }
  };

  const cargarDocs = async (carpeta = carpetaSel) => {
    try {
      const r = await fetch(PROY_DOCS.listDocs(id, carpeta || ""), {
        headers: authHeaders(),
      });
      const j = await jsonOrRedirect401(r);
      if (!j) return;
      setDocumentos(Array.isArray(j) ? j : []);
    } catch (e) {
      console.error(e);
      setDocumentos([]);
    }
  };

  const crearCarpeta = async () => {
    const { value: nombre, isConfirmed } = await Swal.fire({
      title: "Nueva carpeta",
      input: "text",
      inputLabel: "Nombre de carpeta",
      inputAutoTrim: true,
      showCancelButton: true,
      confirmButtonText: "Crear",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
      allowOutsideClick: false,
      allowEscapeKey: true,
      width: 520,
      target: docsModalContentRef.current || document.body,
      customClass: {
        popup: "shadow",
        confirmButton: "btn btn-primary ms-2",
        cancelButton: "btn btn-secondary",
      },
      buttonsStyling: false,
      inputAttributes: {
        style: "max-width:100%; box-sizing:border-box;",
      },
      inputValidator: (v) => {
        if (!v?.trim()) return "Ingrese un nombre";
        return undefined;
      },
    });

    if (!isConfirmed) return;

    const n = (nombre || "").trim();
    if (!n) return;

    try {
      const res = await fetch(PROY_DOCS.listCarpetas(id), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ nombre: n }),
      });

      if (res.status === 401) return redirect401();

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "No se pudo crear la carpeta");

      await cargarCarpetas();
      setCarpetaSel(n);
      await cargarDocs(n);

      await Swal.fire({
        icon: "success",
        title: "Carpeta creada",
        text: `La carpeta "${n}" fue creada correctamente.`,
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    } catch (e) {
      console.error(e);

      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "Error creando carpeta",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    }
  };

  const subirDocumento = async () => {
    if (!archivo) {
      Swal.fire({
        icon: "warning",
        title: "Atención",
        text: "Debe seleccionar un archivo",
        confirmButtonText: "Aceptar",
      });
      return;
    }

    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("subcarpeta", carpetaSel || "");

      const res = await fetch(PROY_DOCS.upload(id), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });

      if (res.status === 401) return redirect401();
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "Error al subir documento");

      setArchivo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await cargarDocs();

      Swal.fire({
        icon: "success",
        title: "Documento subido",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "Error al subir documento",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    }
  };

  const verPreview = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyDocId) return;

    setBusyDocId(idArchivo);
    try {
      const res = await fetch(PROY_DOCS.ver(idArchivo), {
        headers: authHeaders(),
      });

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (preview?.url) URL.revokeObjectURL(preview.url);

      setPreview({
        url,
        nombre: displayName(doc),
        mime: blob.type || "",
      });
    } catch (e) {
      console.error(e);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "No se pudo previsualizar",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const descargarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyDocId) return;

    setBusyDocId(idArchivo);
    try {
      const res = await fetch(PROY_DOCS.descargar(idArchivo), {
        headers: authHeaders(),
      });
      const ok = await ensureOkOrRedirect401(res);
      if (!ok) return;

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
      console.error(e);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "Error al descargar",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const eliminarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo) return;

    const result = await Swal.fire({
      title: "¿Eliminar el documento?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
      reverseButtons: true,
      target: docsModalContentRef.current || document.body,
      customClass: {
        confirmButton: "btn btn-danger ms-2",
        cancelButton: "btn btn-secondary",
      },
      buttonsStyling: false,
    });

    if (!result.isConfirmed) return;

    try {
      setBusyDocId(idArchivo);

      const res = await fetch(PROY_DOCS.eliminar(idArchivo), {
        method: "DELETE",
        headers: {
          ...authHeaders(),
        },
      });

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      await cargarDocs();

      Swal.fire({
        icon: "success",
        title: "Documento eliminado",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "Error al eliminar",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
      });
    } finally {
      setBusyDocId(null);
    }
  };

  const renombrarMover = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo) return;

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
      allowOutsideClick: false,
      width: 560,
      target: docsModalContentRef.current || document.body,
      customClass: {
        confirmButton: "btn btn-primary ms-2",
        cancelButton: "btn btn-secondary",
      },
      buttonsStyling: false,
      inputAttributes: {
        style: "max-width:100%; box-sizing:border-box;",
      },
      inputValidator: (v) => (!v?.trim() ? "Ingrese un nombre" : undefined),
    });

    if (!isConfirmed) return;

    try {
      setBusyDocId(idArchivo);

      const res = await fetch(PROY_DOCS.renombrar(idArchivo), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          nuevoNombre: pedido.trim(),
          nuevaSubcarpeta: carpetaSel || "",
        }),
      });

      if (res.status === 401) return redirect401();
      const text = res.ok ? "" : await res.text();
      if (!res.ok) throw new Error(text || "No se pudo renombrar/mover");

      await cargarDocs();

      Swal.fire({
        icon: "success",
        title: "Documento actualizado",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
        customClass: {
          confirmButton: "btn btn-primary",
        },
        buttonsStyling: false,
      });
    } catch (e) {
      console.error(e);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: e.message || "Error al actualizar documento",
        confirmButtonText: "Aceptar",
        target: docsModalContentRef.current || document.body,
      });
    } finally {
      setBusyDocId(null);
    }
  };

  return (
    <Container className="mt-5 mb-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Editar Proyecto</h2>

        <Button variant="outline-primary" onClick={abrirDocs}>
          📁 Documentación
        </Button>
      </div>

      <Form onSubmit={handleSubmit}>
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Nro Expediente</Form.Label>
              <Form.Control
                name="nro_expediente"
                value={formData.nro_expediente}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group>
              <Form.Label>Tipo de Estudio</Form.Label>
              <Form.Select
                name="tipo_estudio"
                value={formData.tipo_estudio}
                onChange={handleChange}
              >
                <option value="">Seleccione Tipo Estudio</option>
                {tiposEstudio.map((t) => (
                  <option key={t.concepto} value={t.concepto}>
                    {t.concepto} - {t.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Código</Form.Label>
              <Form.Control
                name="codigo"
                value={formData.codigo}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group>
              <Form.Label>Tipo de Proyecto</Form.Label>
              <Form.Select
                name="tipo_proyecto"
                value={formData.tipo_proyecto}
                onChange={handleChange}
              >
                <option value="">Seleccione Tipo Proyecto</option>
                {tiposProyecto.map((t) => (
                  <option key={t.concepto} value={t.concepto}>
                    {t.concepto} - {t.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Nombre del Proyecto</Form.Label>
              <Form.Control
                name="nombre"
                value={formData.nombre}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group>
              <Form.Label>Actividad</Form.Label>
              <div className="d-flex">
                <Form.Select
                  name="actividad"
                  value={formData.actividad}
                  onChange={handleChange}
                  className="me-2"
                >
                  <option value="">Seleccione Actividad</option>
                  {actividades.map((a) => (
                    <option key={a.concepto} value={a.concepto}>
                      {a.concepto} - {a.nombre}
                    </option>
                  ))}
                </Form.Select>

                <Button variant="success" onClick={() => setShowModal(true)}>
                  + Añadir
                </Button>
              </div>
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Estado</Form.Label>
              <Form.Select
                name="estado"
                value={formData.estado}
                onChange={handleChange}
              >
                <option value="">Seleccione Estado</option>
                {estados.map((e) => (
                  <option key={e.concepto} value={e.concepto}>
                    {e.concepto} - {e.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Consultor</Form.Label>
              <Form.Select
                name="id_consultor"
                value={formData.id_consultor}
                onChange={handleChange}
              >
                <option value="">Seleccione Consultor</option>
                {consultores.map((c) => (
                  <option key={c.id_consultor} value={c.id_consultor}>
                    {c.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Proponente</Form.Label>
              <Form.Select
                name="id_proponente"
                value={formData.id_proponente}
                onChange={handleChange}
              >
                <option value="">Seleccione Proponente</option>
                {proponentes.map((p) => (
                  <option key={p.id_proponente} value={p.id_proponente}>
                    {p.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Sector</Form.Label>
              <Form.Select
                name="sector"
                value={formData.sector}
                onChange={handleChange}
              >
                <option value="">Seleccione Sector</option>
                {sectores.map((s) => (
                  <option key={s.concepto} value={s.concepto}>
                    {s.concepto} - {s.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Fecha Inicio</Form.Label>
              <Form.Control
                type="date"
                name="fecha_inicio"
                value={formData.fecha_inicio}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Fecha Final</Form.Label>
              <Form.Control
                type="date"
                name="fecha_final"
                value={formData.fecha_final}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Fecha Registro</Form.Label>
              <Form.Control
                type="date"
                name="fecha_registro"
                value={formData.fecha_registro}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group>
              <Form.Label>Expediente Hídrico</Form.Label>
              <Form.Control
                name="expediente_hidrico"
                value={formData.expediente_hidrico}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Coordenada X</Form.Label>
              <Form.Control
                name="coordenada_x"
                value={formData.coordenada_x}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={6}>
            <Form.Group>
              <Form.Label>Coordenada Y</Form.Label>
              <Form.Control
                name="coordenada_y"
                value={formData.coordenada_y}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Departamento</Form.Label>
              <Form.Control
                name="departamento"
                value={formData.departamento}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Distrito</Form.Label>
              <Form.Control
                name="distrito"
                value={formData.distrito}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>

          <Col md={4}>
            <Form.Group>
              <Form.Label>Barrio</Form.Label>
              <Form.Control
                name="barrio"
                value={formData.barrio}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        <Form.Group className="mb-3">
          <Form.Label>Descripción</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            name="descripcion"
            value={formData.descripcion}
            onChange={handleChange}
          />
        </Form.Group>

        <fieldset className="border p-3 mb-4">
          <legend className="w-auto px-2">Información Catastral</legend>
          <Row>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Padrón</Form.Label>
                <Form.Control
                  name="padron"
                  value={formData.padron}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>Cta. Cte.</Form.Label>
                <Form.Control
                  name="cta_cte"
                  value={formData.cta_cte}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>Finca</Form.Label>
                <Form.Control
                  name="finca"
                  value={formData.finca}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group>
                <Form.Label>Matrícula</Form.Label>
                <Form.Control
                  name="matricula"
                  value={formData.matricula}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
          </Row>
        </fieldset>

        <div className="d-flex justify-content-end gap-2">
          <Button variant="secondary" onClick={() => navigate("/proyectos")}>
            Cancelar
          </Button>

          <Button variant="primary" type="submit">
            Guardar
          </Button>
        </div>
      </Form>

      <div className="mt-5">
        <ProyectoTramosManager
          idProyecto={Number(id)}
          total={formData.catastro_target_total}
          onTotalChange={(value) =>
            setFormData((prev) => ({
              ...prev,
              catastro_target_total: value === null ? "" : String(value),
            }))
          }
        />
      </div>

      {showModal && (
        <div
          className="modal d-block"
          tabIndex="-1"
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Nueva Actividad</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowModal(false)}
                />
              </div>

              <div className="modal-body">
                <Form.Group>
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    value={nuevaActividad}
                    onChange={(e) => setNuevaActividad(e.target.value)}
                    placeholder="Ingrese nombre de actividad"
                  />
                </Form.Group>
              </div>

              <div className="modal-footer">
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={agregarActividad}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        show={docsModalOpen}
        onHide={() => {
          cerrarPreview();
          setDocsModalOpen(false);
        }}
        centered
        size="xl"
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>📁 Documentación del Proyecto {id}</Modal.Title>
        </Modal.Header>

        <Modal.Body ref={docsModalContentRef}>
          <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div style={{ minWidth: 260 }}>
              <Form.Label className="mb-1">Carpeta</Form.Label>
              <Form.Select
                value={carpetaSel}
                onChange={async (e) => {
                  const v = e.target.value;
                  setCarpetaSel(v);
                  await cargarDocs(v);
                }}
              >
                <option value="">(Raíz del proyecto)</option>
                {carpetas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Form.Select>
            </div>

            <div className="pb-1">
              <Button variant="outline-success" onClick={crearCarpeta}>
                ➕ Nueva carpeta
              </Button>
            </div>

            <div className="ms-auto" style={{ minWidth: 320 }}>
              <Form.Label className="mb-1">Subir archivo</Form.Label>
              <Form.Control
                ref={fileInputRef}
                type="file"
                onChange={(e) => setArchivo(e.target.files?.[0] || null)}
              />
            </div>

            <div className="pb-1">
              <Button variant="secondary" onClick={subirDocumento} disabled={!archivo}>
                Subir
              </Button>
            </div>
          </div>

          <div className="table-responsive">
            <Table bordered className="align-middle">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Carpeta</th>
                  <th>Fecha</th>
                  <th style={{ width: 360 }}>Acciones</th>
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
                        disabled={busyDocId === doc.id_archivo}
                      >
                        {busyDocId === doc.id_archivo ? "Cargando..." : "Vista previa"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline-success"
                        onClick={() => descargarDocumento(doc)}
                        disabled={busyDocId === doc.id_archivo}
                      >
                        {busyDocId === doc.id_archivo ? "Descargando..." : "Descargar"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => renombrarMover(doc)}
                        disabled={busyDocId === doc.id_archivo}
                      >
                        Renombrar / Mover
                      </Button>

                      <Button
                        size="sm"
                        variant="outline-danger"
                        onClick={() => eliminarDocumento(doc)}
                        disabled={busyDocId === doc.id_archivo}
                      >
                        Eliminar
                      </Button>
                    </td>
                  </tr>
                ))}

                {(documentos || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-muted">
                      No hay documentos en esta carpeta.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>

          {preview && (
            <div
              className="modal d-block"
              tabIndex="-1"
              style={{ background: "rgba(0,0,0,0.5)" }}
            >
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
                    {isPreviewPdf && (
                      <small className="text-muted me-auto">
                        Si el PDF no se ve, revisá que el backend responda Content-Type:
                        application/pdf y Content-Disposition: inline.
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
        </Modal.Body>

        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              cerrarPreview();
              setDocsModalOpen(false);
            }}
          >
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}