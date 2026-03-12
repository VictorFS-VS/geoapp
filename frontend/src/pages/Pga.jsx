// src/pages/Pga.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Modal,
  Button,
  Form,
  Table,
  Row,
  Col,
  Spinner,
  Alert,
  Badge,
} from "react-bootstrap";
import Select from "react-select";
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
   Utils multi-select
========================= */
const toArr = (v) =>
  Array.isArray(v)
    ? v.filter(Boolean)
    : typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

const toCsv = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).join(",") : arr || "");

const toOptions = (rows = []) =>
  rows.map((o) => ({ value: String(o.concepto), label: `${o.concepto} - ${o.nombre}` }));

const pickOptions = (options, values = []) => {
  const set = new Set(values.map(String));
  return options.filter((o) => set.has(String(o.value)));
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
   Endpoints docs (RAÍZ REAL)
   -> Igual que VerProyecto/EditarProyecto:
   - carpetas: /documentos/carpetas/:id_proyecto
   - listar:   /documentos/listar/:id_proyecto/otros?carpeta=...
   - upload:   /documentos/upload/:id_proyecto/otros  (FormData con subcarpeta)
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

/* =========================
   Componente
========================= */
export default function Pga() {
  const { id } = useParams(); // id del proyecto
  const token = localStorage.getItem("token");

  // ===== PGA =====
  const [pgaList, setPgaList] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [modo, setModo] = useState("crear");
  const [formData, setFormData] = useState({
    id: null,
    tipo_riesgo: [],
    tipo_plan: [],
    descript_plan: "",
    fecha_reg: "",
    estado: "",
  });

  // permisos
  const [tipoUsuario, setTipoUsuario] = useState(null);
  const puedeCrearEditar = [1, 8, 11].includes(Number(tipoUsuario));
  const puedeEliminar = Number(tipoUsuario) === 1;

  // selects conceptos
  const [opEstados, setOpEstados] = useState([]);
  const [opRiesgos, setOpRiesgos] = useState([]);
  const [opPlanes, setOpPlanes] = useState([]);

  // alerts simples
  const [mensaje, setMensaje] = useState(null);

  // busy flags pga
  const [guardando, setGuardando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState(null);

  // ===== Documentación (RAÍZ REAL DEL PROYECTO) =====
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [carpetas, setCarpetas] = useState([]); // string[]
  const [carpetaSel, setCarpetaSel] = useState(""); // '' raíz
  const [documentos, setDocumentos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [busyDocId, setBusyDocId] = useState(null);

  // Preview (blob)
  const [preview, setPreview] = useState(null); // { url, nombre, mime }
  const isPreviewImage = useMemo(() => isImageMime(preview?.mime), [preview?.mime]);
  const isPreviewPdf = useMemo(() => isPdfMime(preview?.mime), [preview?.mime]);

  const fileInputRef = useRef(null);
  const didLoadRefs = useRef({ pga: false, conceptos: false });

  const cerrarPreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  /* =========================
     Carga inicial: PGA + permisos
========================= */
  useEffect(() => {
    if (!didLoadRefs.current.pga) {
      didLoadRefs.current.pga = true;
      cargarPga();

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1] || ""));
          const tu = Number(payload?.tipo_usuario);
          if (Number.isFinite(tu)) setTipoUsuario(tu);
        } catch {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  /* =========================
     Carga conceptos
========================= */
  useEffect(() => {
    if (didLoadRefs.current.conceptos) return;
    didLoadRefs.current.conceptos = true;

    (async () => {
      const headers = authHeaders();
      try {
        const [est, rie, pla] = await Promise.all([
          fetch(`${API_URL}/conceptos/por-tipo/PGA_ESTADO`, { headers })
            .then(jsonOrRedirect401)
            .catch(() => []),
          fetch(`${API_URL}/conceptos/por-tipo/TIPO_RIESGO`, { headers })
            .then(jsonOrRedirect401)
            .catch(() => []),
          fetch(`${API_URL}/conceptos/por-tipo/TIPO_PLAN`, { headers })
            .then(jsonOrRedirect401)
            .catch(() => []),
        ]);
        setOpEstados(Array.isArray(est) ? est : []);
        setOpRiesgos(Array.isArray(rie) ? rie : []);
        setOpPlanes(Array.isArray(pla) ? pla : []);
      } catch {}
    })();
  }, []);

  /* =========================
     API: PGA
========================= */
  const cargarPga = async () => {
    try {
      const res = await fetch(`${API_URL}/pga/${id}`, { headers: authHeaders() });
      const data = await jsonOrRedirect401(res);
      if (!data) return;
      setPgaList(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setMensaje({ type: "error", text: "No se pudo cargar la lista de PGA." });
      setPgaList([]);
    }
  };

  /* =========================
     CRUD PGA
========================= */
  const abrirModal = (nuevoModo, pga = null) => {
    if ((nuevoModo === "crear" || nuevoModo === "editar") && !puedeCrearEditar) return;

    setModo(nuevoModo);
    setFormData(
      pga
        ? {
            id: pga.id,
            tipo_riesgo: toArr(pga.tipo_riesgo),
            tipo_plan: toArr(pga.tipo_plan),
            descript_plan: pga.descript_plan || "",
            fecha_reg: pga.fecha_reg?.split("T")?.[0] || "",
            estado: pga.estado || "",
          }
        : {
            id: null,
            tipo_riesgo: [],
            tipo_plan: [],
            descript_plan: "",
            fecha_reg: "",
            estado: "",
          }
    );
    setShowModal(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    if (!puedeCrearEditar) return;

    if (!formData.estado || formData.tipo_riesgo.length === 0 || formData.tipo_plan.length === 0) {
      setMensaje({
        type: "error",
        text: "Debe seleccionar al menos un Tipo de riesgo y un Tipo de plan.",
      });
      return;
    }

    const url = formData.id ? `${API_URL}/pga/${formData.id}` : `${API_URL}/pga`;
    const method = formData.id ? "PUT" : "POST";

    setGuardando(true);
    setMensaje(null);

    try {
      // Enviamos CSV para compatibilidad (si tu backend ya acepta arrays, puedes enviar arrays).
      const payload = {
        ...formData,
        id_proyecto: Number(id),
        tipo_riesgo: toCsv(formData.tipo_riesgo),
        tipo_plan: toCsv(formData.tipo_plan),
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      const ok = await jsonOrRedirect401(res);
      if (!ok) return;

      alerts.toast.success("PGA guardado correctamente.");
      setShowModal(false);
      cargarPga();
    } catch {
      alerts.toast.error("Error al guardar el PGA.");
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (idPga) => {
    if (!puedeEliminar) return;

    const ok = await alerts.confirmDelete("¿Desea eliminar este registro?");
    if (!ok) return;

    setEliminandoId(idPga);
    try {
      const res = await fetch(`${API_URL}/pga/${idPga}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const good = await jsonOrRedirect401(res);
      if (!good) return;

      alerts.toast.success("PGA eliminado.");
      cargarPga();
    } catch {
      alerts.toast.error("Error al eliminar el PGA.");
    } finally {
      setEliminandoId(null);
    }
  };

  /* =========================
     Documentación: RAÍZ REAL
     (misma UI “mejorada” estilo VerProyecto)
========================= */
  const abrirDocs = async () => {
    setDocsModalOpen(true);
    cerrarPreview();
    setArchivo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

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
      alerts.toast?.error?.("Error cargando carpetas");
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
      alerts.toast?.error?.("Error cargando documentos");
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
      fd.append("subcarpeta", carpetaSel || "");

      alerts.loading?.("Subiendo documento...");
      const res = await fetch(PROY_DOCS.upload(id), {
        method: "POST",
        headers: { ...authHeaders() }, // no Content-Type con FormData
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      alerts.close?.();

      if (res.status === 401) return redirect401();
      if (!res.ok) throw new Error(j?.message || "Error al subir documento");

      setArchivo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await cargarDocs();

      alerts.toast?.success?.("Documento subido");
    } catch (e) {
      alerts.close?.();
      alerts.toast?.error?.(e.message || "Error al subir documento");
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

      setPreview({
        url,
        nombre: displayName(doc),
        mime: blob.type || "",
      });
    } catch (e) {
      console.error(e);
      alerts.toast?.error?.(e.message || "No se pudo previsualizar");
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
      alerts.toast?.error?.(e.message || "Error al descargar");
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
      alerts.toast?.success?.("Documento eliminado");
    } catch (e) {
      alerts.close?.();
      console.error(e);
      alerts.toast?.error?.(e.message || "Error al eliminar");
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
      alerts.toast?.success?.("Documento actualizado");
    } catch (e) {
      alerts.close?.();
      console.error(e);
      alerts.toast?.error?.(e.message || "Error al actualizar");
    } finally {
      setBusyDocId(null);
    }
  };

  /* =========================
     Render
========================= */
  const riesgoOptions = toOptions(opRiesgos);
  const planOptions = toOptions(opPlanes);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <h2 className="mb-0">Planes de Gestión Ambiental</h2>
          <Badge bg="secondary">Proyecto {id}</Badge>
        </div>

        <div className="d-flex gap-2">
          <Button variant="outline-primary" onClick={abrirDocs} title="Documentación del Proyecto (raíz real)">
            📁 Documentación
          </Button>

          {puedeCrearEditar && (
            <Button variant="success" onClick={() => abrirModal("crear")}>
              ➕ Nuevo
            </Button>
          )}
        </div>
      </div>

      {mensaje && (
        <Alert
          variant={
            mensaje.type === "error"
              ? "danger"
              : mensaje.type === "success"
                ? "success"
                : "info"
          }
          onClose={() => setMensaje(null)}
          dismissible
        >
          {mensaje.text}
        </Alert>
      )}

      <div className="table-responsive">
        <Table bordered hover>
          <thead className="table-primary">
            <tr>
              <th>ID</th>
              <th>Estado</th>
              <th>Tipo Riesgo</th>
              <th>Tipo Plan</th>
              <th>Descripción</th>
              <th>Fecha Reg</th>
              <th style={{ width: 240 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pgaList.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>
                  <span
                    className={`badge ${
                      item.des_pga_estado === "Cumplido" ? "bg-success" : "bg-warning"
                    }`}
                  >
                    {item.des_pga_estado || item.estado}
                  </span>
                </td>

                <td>
                  {toArr(item.tipo_riesgo).length > 0
                    ? toArr(item.tipo_riesgo).map((v) => (
                        <span key={v} className="badge bg-info text-dark me-1">
                          {v}
                        </span>
                      ))
                    : item.des_tipo_riesgo || "-"}
                </td>

                <td>
                  {toArr(item.tipo_plan).length > 0
                    ? toArr(item.tipo_plan).map((v) => (
                        <span key={v} className="badge bg-secondary me-1">
                          {v}
                        </span>
                      ))
                    : item.des_tipo_plan || "-"}
                </td>

                <td>{item.descript_plan}</td>
                <td>{item.fecha_reg?.split?.("T")?.[0] || item.fecha_reg}</td>

                <td>
                  <div className="btn-group btn-group-sm">
                    {puedeCrearEditar && (
                      <Button variant="warning" onClick={() => abrirModal("editar", item)}>
                        Editar
                      </Button>
                    )}

                    {puedeEliminar && (
                      <Button
                        variant="danger"
                        onClick={() => eliminar(item.id)}
                        disabled={eliminandoId === item.id}
                      >
                        {eliminandoId === item.id ? (
                          <>
                            <Spinner size="sm" className="me-1" />
                            Eliminando…
                          </>
                        ) : (
                          "Eliminar"
                        )}
                      </Button>
                    )}

                    <Button variant="info" className="text-white" onClick={() => abrirModal("ver", item)}>
                      Ver
                    </Button>
                  </div>
                </td>
              </tr>
            ))}

            {pgaList.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center">
                  Sin registros
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      {/* ================= Modal PGA (crear/editar/ver) ================= */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>
            {modo === "crear" ? "Nuevo PGA" : modo === "editar" ? "Editar PGA" : "Ver PGA"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Form className="row g-3">
            <Row>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Tipo de Riesgo</Form.Label>
                  <Select
                    isMulti
                    options={riesgoOptions}
                    value={pickOptions(riesgoOptions, formData.tipo_riesgo)}
                    onChange={(vals) =>
                      setFormData((prev) => ({ ...prev, tipo_riesgo: (vals || []).map((v) => v.value) }))
                    }
                    isDisabled={modo === "ver" || !puedeCrearEditar || guardando}
                    placeholder="Seleccione uno o varios…"
                    closeMenuOnSelect={false}
                    hideSelectedOptions={false}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Tipo de Plan</Form.Label>
                  <Select
                    isMulti
                    options={planOptions}
                    value={pickOptions(planOptions, formData.tipo_plan)}
                    onChange={(vals) =>
                      setFormData((prev) => ({ ...prev, tipo_plan: (vals || []).map((v) => v.value) }))
                    }
                    isDisabled={modo === "ver" || !puedeCrearEditar || guardando}
                    placeholder="Seleccione uno o varios…"
                    closeMenuOnSelect={false}
                    hideSelectedOptions={false}
                  />
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group>
                  <Form.Label>Descripción</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    name="descript_plan"
                    value={formData.descript_plan}
                    onChange={handleChange}
                    disabled={modo === "ver" || !puedeCrearEditar || guardando}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Fecha</Form.Label>
                  <Form.Control
                    type="date"
                    name="fecha_reg"
                    value={formData.fecha_reg}
                    onChange={handleChange}
                    disabled={modo === "ver" || !puedeCrearEditar || guardando}
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group>
                  <Form.Label>Estado</Form.Label>
                  <Form.Select
                    name="estado"
                    value={formData.estado}
                    onChange={handleChange}
                    disabled={modo === "ver" || !puedeCrearEditar || guardando}
                  >
                    <option value="">Seleccione un Estado</option>
                    {opEstados.map((opt) => (
                      <option key={opt.concepto} value={opt.concepto}>
                        {`${opt.concepto} - ${opt.nombre}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>

        {modo !== "ver" && puedeCrearEditar && (
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardar} disabled={guardando}>
              {guardando ? (
                <>
                  <Spinner size="sm" className="me-2" />
                  Guardando…
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </Modal.Footer>
        )}
      </Modal>

      {/* ================= Modal: Documentación del PROYECTO (raíz real) ================= */}
      <Modal show={docsModalOpen} onHide={() => setDocsModalOpen(false)} centered size="xl" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>📁 Documentación del Proyecto {id}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {/* controles carpetas + upload */}
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

          {/* tabla docs */}
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
            </table>
          </div>

          {/* Modal preview embebido (igual que VerProyecto) */}
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
