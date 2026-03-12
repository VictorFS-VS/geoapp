// src/pages/Resoluciones.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Modal,
  Button,
  Form,
  Table,
  Row,
  Col,
  Alert,
  Spinner,
  Badge,
} from "react-bootstrap";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

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
  if (!res.ok) {
    let msg = "";
    try {
      const txt = await res.text();
      try {
        const j = txt ? JSON.parse(txt) : null;
        msg = j?.message || j?.error || txt || `HTTP ${res.status}`;
      } catch {
        msg = txt || `HTTP ${res.status}`;
      }
    } catch {
      msg = `HTTP ${res.status}`;
    }
    throw new Error(msg);
  }
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

const toArray = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.data) ? x.data : []);

/* =========================
   UI docs helpers
========================= */
const displayName = (doc) =>
  String(doc?.display_name || doc?.nombre_archivo || doc?.nombre || "archivo").replace(/^\d+_/, "");

const isImageMime = (mime = "") => String(mime).toLowerCase().startsWith("image/");
const isPdfMime = (mime = "") => String(mime).toLowerCase().includes("pdf");

/* =========================
   Docs (RAÍZ REAL DEL PROYECTO)
   - carpetas: /documentos/carpetas/:id_proyecto
   - listar:   /documentos/listar/:id_proyecto/otros?carpeta=...
   - upload:   /documentos/upload/:id_proyecto/otros  (FormData subcarpeta)
   - ver/descargar/eliminar/renombrar: por id_archivo
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

export default function Resoluciones() {
  const { id } = useParams(); // id_proyecto

  const [resoluciones, setResoluciones] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear");

  const [alertVenc, setAlertVenc] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [tipoUsuario, setTipoUsuario] = useState(null);

  // selects
  const [opEstados, setOpEstados] = useState([]);
  const [opTipos, setOpTipos] = useState([]);

  const dictEstado = useMemo(
    () => Object.fromEntries((opEstados || []).map((o) => [o.concepto, o.nombre])),
    [opEstados]
  );
  const dictTipo = useMemo(
    () => Object.fromEntries((opTipos || []).map((o) => [o.concepto, o.nombre])),
    [opTipos]
  );

  // ===== Documentación (RAÍZ REAL) =====
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [carpetas, setCarpetas] = useState([]);
  const [carpetaSel, setCarpetaSel] = useState(""); // '' raíz
  const [documentos, setDocumentos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [busyDocId, setBusyDocId] = useState(null);

  // Preview (blob)
  const [preview, setPreview] = useState(null); // { url, nombre, mime }
  const isPreviewImage = useMemo(() => isImageMime(preview?.mime), [preview?.mime]);
  const isPreviewPdf = useMemo(() => isPdfMime(preview?.mime), [preview?.mime]);

  const fileInputRef = useRef(null);

  const toast = {
    success: (t) => (alerts?.toast?.success ? alerts.toast.success(t) : Swal.fire({ toast: true, icon: "success", title: t, position: "top-end", showConfirmButton: false, timer: 2500 })),
    error: (t) => (alerts?.toast?.error ? alerts.toast.error(t) : Swal.fire({ toast: true, icon: "error", title: t, position: "top-end", showConfirmButton: false, timer: 2600 })),
    warning: (t) => (alerts?.toast?.warning ? alerts.toast.warning(t) : Swal.fire({ toast: true, icon: "warning", title: t, position: "top-end", showConfirmButton: false, timer: 2600 })),
    info: (t) => (alerts?.toast?.info ? alerts.toast.info(t) : Swal.fire({ toast: true, icon: "info", title: t, position: "top-end", showConfirmButton: false, timer: 2600 })),
  };

  useEffect(() => {
    // tipo usuario desde token
    const t = localStorage.getItem("token");
    if (t) {
      try {
        const payload = JSON.parse(atob(t.split(".")[1] || ""));
        const n = Number(payload?.tipo_usuario);
        if (Number.isFinite(n)) setTipoUsuario(n);
      } catch {}
    }
    cargarResoluciones();
    cargarCombos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const puedeCrear = tipoUsuario === 1 || tipoUsuario === 8;
  const puedeEditar = tipoUsuario === 1 || tipoUsuario === 8;
  const puedeEliminar = tipoUsuario === 1;

  /* ---------- combos ---------- */
  async function cargarCombos() {
    await Promise.all([cargarEstados(), cargarTipos()]);
  }
  async function cargarEstados() {
    const headers = authHeaders();
    try {
      const r = await fetch(`${API_URL}/conceptos/por-tipo/RESOL_ESTADO`, { headers });
      setOpEstados(toArray(await jsonOrRedirect401(r)) || []);
    } catch {
      try {
        const r2 = await fetch(`${API_URL}/conceptos?tipoconcepto=RESOL_ESTADO&simple=1`, { headers });
        setOpEstados(toArray(await jsonOrRedirect401(r2)) || []);
      } catch {
        setOpEstados([]);
      }
    }
  }
  async function cargarTipos() {
    const headers = authHeaders();
    try {
      const r = await fetch(`${API_URL}/conceptos/por-tipo/TIPO_RESOLUCIONES`, { headers });
      setOpTipos(toArray(await jsonOrRedirect401(r)) || []);
    } catch {
      try {
        const r2 = await fetch(`${API_URL}/conceptos?tipoconcepto=TIPO_RESOLUCIONES&simple=1`, { headers });
        setOpTipos(toArray(await jsonOrRedirect401(r2)) || []);
      } catch {
        setOpTipos([]);
      }
    }
  }

  /* ---------- resoluciones ---------- */
  async function cargarResoluciones() {
    const headers = authHeaders();
    try {
      setLoading(true);
      setMensaje(null);
      const res = await fetch(`${API_URL}/resoluciones/${id}`, { headers });
      const arr = toArray(await jsonOrRedirect401(res)) || [];
      setResoluciones(arr);
      comprobarVencimientos(arr);
    } catch (err) {
      console.error(err);
      setResoluciones([]);
      setAlertVenc(null);
      setMensaje({ type: "danger", text: "No se pudieron cargar las resoluciones." });
      toast.error(err?.message || "No se pudieron cargar las resoluciones.");
    } finally {
      setLoading(false);
    }
  }

  function comprobarVencimientos(arr) {
    const hoy = dayjs();
    const proximas = (arr || [])
      .map((r) => (r?.fecha_prox_vto_aa ? { ...r, dias: dayjs(r.fecha_prox_vto_aa).diff(hoy, "day") } : null))
      .filter((r) => r && r.dias >= 0 && r.dias <= 15);

    setAlertVenc(
      proximas.length
        ? proximas
            .map((r) => `La resolución ${r.nro_resolucion} vence en ${r.dias} día${r.dias !== 1 ? "s" : ""}`)
            .join(". ")
        : null
    );
  }

  /* ---------- modal CRUD ---------- */
  const [formData, setFormData] = useState({
    id_resoluciones: null,
    nro_resolucion: "",
    gestion_resolucion: "",
    fecha_resolucion: "",
    fecha_prox_vto_aa: "",
    estado: "",
    observacion: "",
    tipo_resoluciones: "",
  });

  function abrirModal(accion, r = null) {
    setModo(accion);
    setMensaje(null);
    setFormData(
      r
        ? {
            id_resoluciones: r.id_resoluciones,
            nro_resolucion: r.nro_resolucion,
            gestion_resolucion: r.gestion_resolucion,
            fecha_resolucion: r.fecha_resolucion?.split("T")[0] || "",
            fecha_prox_vto_aa: r.fecha_prox_vto_aa?.split("T")[0] || "",
            estado: r.estado || "",
            observacion: r.observacion || "",
            tipo_resoluciones: r.tipo_resoluciones || "",
          }
        : {
            id_resoluciones: null,
            nro_resolucion: "",
            gestion_resolucion: "",
            fecha_resolucion: "",
            fecha_prox_vto_aa: "",
            estado: "",
            observacion: "",
            tipo_resoluciones: "",
          }
    );
    setModalOpen(true);
  }

  const handleChange = (e) => setFormData((p) => ({ ...p, [e.target.name]: e.target.value }));

  async function guardar() {
    if (tipoUsuario === 9) return;

    for (const k of ["nro_resolucion", "gestion_resolucion", "fecha_resolucion"]) {
      if (!formData[k]) {
        const txt = `Debe completar ${k.replace("_", " ")}.`;
        setMensaje({ type: "danger", text: txt });
        toast.warning(txt);
        return;
      }
    }

    const url = formData.id_resoluciones ? `${API_URL}/resoluciones/${formData.id_resoluciones}` : `${API_URL}/resoluciones`;
    const method = formData.id_resoluciones ? "PUT" : "POST";

    try {
      setSaving(true);
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...formData, id_proyecto: +id }),
      });
      const ok = await jsonOrRedirect401(r);
      if (!ok) return;

      setModalOpen(false);
      setMensaje({ type: "success", text: "Resolución guardada correctamente." });
      toast.success("Resolución guardada correctamente.");
      cargarResoluciones();
    } catch (e) {
      setMensaje({ type: "danger", text: "Error al guardar resolución." });
      toast.error(e?.message || "Error al guardar resolución.");
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(id_res) {
    if (!puedeEliminar) return;

    let confirmed = window.confirm("¿Eliminar esta resolución?");
    if (alerts?.confirm?.danger) {
      try {
        confirmed = await alerts.confirm.danger({
          title: "Eliminar resolución",
          text: "¿Seguro que desea eliminar esta resolución?",
          confirmText: "Eliminar",
          cancelText: "Cancelar",
        });
      } catch {}
    }
    if (!confirmed) return;

    try {
      setDeletingId(id_res);
      const r = await fetch(`${API_URL}/resoluciones/${id_res}`, { method: "DELETE", headers: authHeaders() });
      const ok = await jsonOrRedirect401(r);
      if (!ok) return;

      setMensaje({ type: "success", text: "Resolución eliminada." });
      toast.success("Resolución eliminada.");
      cargarResoluciones();
    } catch (e) {
      setMensaje({ type: "danger", text: "Error al eliminar resolución." });
      toast.error(e?.message || "Error al eliminar resolución.");
    } finally {
      setDeletingId(null);
    }
  }

  /* =========================
     DOCUMENTACIÓN: RAÍZ REAL
========================= */
  const abrirDocsRaiz = async () => {
    setDocsModalOpen(true);
    setMensaje(null);
    setArchivo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    cerrarPreview();

    await cargarCarpetas();
    await cargarDocs();
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
      toast.error("Error cargando carpetas");
    }
  };

  const cargarDocs = async (carpeta = carpetaSel) => {
    try {
      const r = await fetch(PROY_DOCS.listDocs(id, carpeta || ""), { headers: authHeaders() });
      const j = await jsonOrRedirect401(r);
      if (!j) return;
      setDocumentos(Array.isArray(j) ? j : []);
    } catch (e) {
      console.error(e);
      setDocumentos([]);
      toast.error("Error cargando documentos");
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
      inputValidator: (v) => (!v?.trim() ? "Ingrese un nombre" : undefined),
    });
    if (!isConfirmed) return;

    const n = (nombre || "").trim();
    if (!n) return;

    try {
      alerts.loading?.("Creando carpeta...");
      const res = await fetch(PROY_DOCS.listCarpetas(id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ nombre: n }),
      });
      const j = await res.json().catch(() => ({}));
      alerts.close?.();

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(j?.message || "No se pudo crear la carpeta");

      await cargarCarpetas();
      setCarpetaSel(n);
      await cargarDocs(n);

      toast.success("Carpeta creada");
    } catch (e) {
      alerts.close?.();
      toast.error(e.message || "Error creando carpeta");
    }
  };

  const subirDocumento = async () => {
    if (!archivo) return toast.warning("Debe seleccionar un archivo");

    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("subcarpeta", carpetaSel || "");

      alerts.loading?.("Subiendo documento...");
      const res = await fetch(PROY_DOCS.upload(id), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      alerts.close?.();

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(j?.message || "Error al subir documento");

      setArchivo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await cargarDocs();

      toast.success("Documento subido");
    } catch (e) {
      alerts.close?.();
      toast.error(e.message || "Error al subir documento");
    }
  };

  const verPreview = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyDocId) return;

    setBusyDocId(idArchivo);
    try {
      const res = await fetch(PROY_DOCS.ver(idArchivo), { headers: authHeaders() });
      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (preview?.url) URL.revokeObjectURL(preview.url);

      setPreview({ url, nombre: displayName(doc), mime: blob.type || "" });
    } catch (e) {
      console.error(e);
      toast.error(e.message || "No se pudo previsualizar");
    } finally {
      setBusyDocId(null);
    }
  };

  const descargarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo || busyDocId) return;

    setBusyDocId(idArchivo);
    try {
      const res = await fetch(PROY_DOCS.descargar(idArchivo), { headers: authHeaders() });
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
      toast.error(e.message || "Error al descargar");
    } finally {
      setBusyDocId(null);
    }
  };

  const eliminarDocumento = async (doc) => {
    const idArchivo = doc?.id_archivo;
    if (!idArchivo) return;

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
      setBusyDocId(idArchivo);
      alerts.loading?.("Eliminando...");
      const res = await fetch(PROY_DOCS.eliminar(idArchivo), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      alerts.close?.();

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(await res.text());

      await cargarDocs();
      toast.success("Documento eliminado");
    } catch (e) {
      alerts.close?.();
      console.error(e);
      toast.error(e.message || "Error al eliminar");
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
      inputValidator: (v) => (!v?.trim() ? "Ingrese un nombre" : undefined),
    });

    if (!isConfirmed) return;

    try {
      setBusyDocId(idArchivo);
      alerts.loading?.("Guardando cambios...");
      const res = await fetch(PROY_DOCS.renombrar(idArchivo), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ nuevoNombre: pedido, nuevaSubcarpeta: carpetaSel || "" }),
      });
      const text = res.ok ? "" : await res.text();
      alerts.close?.();

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(text || "No se pudo renombrar/mover");

      await cargarDocs();
      toast.success("Documento actualizado");
    } catch (e) {
      alerts.close?.();
      console.error(e);
      toast.error(e.message || "Error al actualizar");
    } finally {
      setBusyDocId(null);
    }
  };

  const cerrarPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  /* ---------- UI ---------- */
  const renderConcept = (codigo, dict) => (codigo ? (dict[codigo] ? `${codigo} - ${dict[codigo]}` : codigo) : "-");

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0 d-flex align-items-center gap-2">
          Resoluciones del Proyecto {id}
          {alertVenc && (
            <Badge bg="warning" text="dark">
              ⚠ Vencimientos
            </Badge>
          )}
        </h2>

        <div className="d-flex gap-2">
          <Button variant="outline-primary" onClick={abrirDocsRaiz} title="Documentación del Proyecto (raíz real)">
            📁 Documentación
          </Button>

          {puedeCrear && (
            <Button variant="primary" onClick={() => abrirModal("crear")}>
              ➕ Nueva
            </Button>
          )}
        </div>
      </div>

      {alertVenc && <Alert variant="warning" className="mb-2">⚠ {alertVenc}</Alert>}
      {mensaje && (
        <Alert variant={mensaje.type} dismissible onClose={() => setMensaje(null)} className="mb-3">
          {mensaje.text}
        </Alert>
      )}

      <div className="table-responsive">
        <Table bordered hover>
          <thead className="table-light">
            <tr>
              <th>Nro Resolución</th>
              <th>Gestión</th>
              <th>Fecha Resolución</th>
              <th>Vto. AA</th>
              <th>Estado</th>
              <th>Tipo</th>
              <th>Observación</th>
              <th style={{ width: 240 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Cargando…
                </td>
              </tr>
            ) : (resoluciones || []).length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center">
                  Sin resoluciones
                </td>
              </tr>
            ) : (
              (resoluciones || []).map((r) => (
                <tr key={r.id_resoluciones}>
                  <td>{r.nro_resolucion}</td>
                  <td>{r.gestion_resolucion}</td>
                  <td>{r.fecha_resolucion ? dayjs(r.fecha_resolucion).format("DD/MM/YYYY") : "-"}</td>
                  <td>{r.fecha_prox_vto_aa ? dayjs(r.fecha_prox_vto_aa).format("DD/MM/YYYY") : "-"}</td>
                  <td>{renderConcept(r.estado, dictEstado)}</td>
                  <td>{renderConcept(r.tipo_resoluciones, dictTipo)}</td>
                  <td>{r.observacion || "-"}</td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      {puedeEditar && (
                        <Button variant="warning" onClick={() => abrirModal("editar", r)} disabled={deletingId === r.id_resoluciones}>
                          Editar
                        </Button>
                      )}
                      {puedeEliminar && (
                        <Button variant="danger" onClick={() => eliminar(r.id_resoluciones)} disabled={deletingId === r.id_resoluciones}>
                          {deletingId === r.id_resoluciones ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-1" />
                              Eliminando…
                            </>
                          ) : (
                            "Eliminar"
                          )}
                        </Button>
                      )}
                      <Button variant="info" className="text-white" onClick={() => abrirModal("ver", r)} disabled={deletingId === r.id_resoluciones}>
                        Ver
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>

      {/* Modal crear/editar/ver */}
      <Modal show={modalOpen} onHide={() => setModalOpen(false)} centered backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>
            {modo === "crear" ? "Nueva Resolución" : modo === "editar" ? "Editar Resolución" : "Ver Resolución"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form className="row g-3">
            <Row>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Nro Resolución</Form.Label>
                  <Form.Control name="nro_resolucion" value={formData.nro_resolucion} onChange={handleChange} disabled={modo === "ver" || saving} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Gestión</Form.Label>
                  <Form.Control name="gestion_resolucion" value={formData.gestion_resolucion} onChange={handleChange} disabled={modo === "ver" || saving} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Fecha Resolución</Form.Label>
                  <Form.Control type="date" name="fecha_resolucion" value={formData.fecha_resolucion} onChange={handleChange} disabled={modo === "ver" || saving} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Vto. AA</Form.Label>
                  <Form.Control type="date" name="fecha_prox_vto_aa" value={formData.fecha_prox_vto_aa} onChange={handleChange} disabled={modo === "ver" || saving} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Estado</Form.Label>
                  <Form.Select name="estado" value={formData.estado} onChange={handleChange} disabled={modo === "ver" || saving}>
                    <option value="">Seleccione un Estado</option>
                    {(opEstados || []).map((opt) => (
                      <option key={opt.concepto} value={opt.concepto}>
                        {`${opt.concepto} - ${opt.nombre}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Tipo</Form.Label>
                  <Form.Select name="tipo_resoluciones" value={formData.tipo_resoluciones} onChange={handleChange} disabled={modo === "ver" || saving}>
                    <option value="">Seleccione un Tipo</option>
                    {(opTipos || []).map((opt) => (
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
                  <Form.Control as="textarea" rows={3} name="observacion" value={formData.observacion} onChange={handleChange} disabled={modo === "ver" || saving} />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        {modo !== "ver" && (puedeCrear || puedeEditar) && (
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardar} disabled={saving}>
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Guardando…
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </Modal.Footer>
        )}
      </Modal>

      {/* Modal Documentación (RAÍZ REAL) */}
      <Modal show={docsModalOpen} onHide={() => setDocsModalOpen(false)} centered size="xl" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>📁 Documentación del Proyecto {id}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
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
            <table className="table table-bordered align-middle">
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
                      <Button size="sm" variant="outline-secondary" onClick={() => verPreview(doc)} disabled={busyDocId === doc.id_archivo}>
                        {busyDocId === doc.id_archivo ? "Cargando..." : "Vista previa"}
                      </Button>

                      <Button size="sm" variant="outline-success" onClick={() => descargarDocumento(doc)} disabled={busyDocId === doc.id_archivo}>
                        {busyDocId === doc.id_archivo ? "Descargando..." : "Descargar"}
                      </Button>

                      <Button size="sm" variant="outline-primary" onClick={() => renombrarMover(doc)} disabled={busyDocId === doc.id_archivo}>
                        Renombrar / Mover
                      </Button>

                      <Button size="sm" variant="outline-danger" onClick={() => eliminarDocumento(doc)} disabled={busyDocId === doc.id_archivo}>
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
            </table>
          </div>

          {/* Preview embebido */}
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
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDocsModalOpen(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
