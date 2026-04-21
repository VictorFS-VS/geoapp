import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import PqrDashboardView from "@/modules/projectHome/PqrDashboardView";
import { FaArrowLeft } from "react-icons/fa";
import { Button, Form, Table, Modal, Row, Col, Spinner, Badge } from "react-bootstrap";
import { loadGoogleMapsApi } from "@/utils/loadGoogleMapsApi";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

function authHeader(isJson = true) {
  const token = localStorage.getItem("token");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (isJson) headers["Content-Type"] = "application/json";
  return headers;
}

const ESTADOS = ["abierto", "en_proceso", "respondido", "cerrado", "anulado"];

const LINEAS_NEGOCIO = [
  "corporativo",
  "concesiones",
  "infraestructura",
  "servicios",
];

const VIAS_RECEPCION = [
  "telefonica",
  "oficinas",
  "correo_electronico",
];

const DESEA_FORMULAR = [
  "quejas",
  "consultas",
  "solicitud",
  "sugerencias",
];

const EN_CALIDAD = [
  "ocupante",
  "propietario",
  "usuario",
  "otros",
];

const NIVELES = ["alto", "medio", "bajo"];

const TIPOLOGIAS = [
  "fisura",
  "accesos",
  "construccion_y_otros",
  "colocacion_de_carteles",
  "construccion_en_fd",
  "mantenimiento_en_fd",
  "oportunidad_laboral",
  "expropiaciones",
  "siniestros_en_peaje",
  "consulta_facturacion_peaje",
  "otros",
];

const SATISFACCION = [
  "satisfactorio",
  "parcialmente_satisfactorio",
  "insatisfactorio",
];

const CONFORMIDAD = ["si", "no", "otro"];

const LABELS = {
  abierto: "Abierto",
  en_proceso: "En proceso",
  respondido: "Respondido",
  cerrado: "Cerrado",
  anulado: "Anulado",

  corporativo: "Corporativo",
  concesiones: "Concesiones",
  infraestructura: "Infraestructura",
  servicios: "Servicios",

  telefonica: "Telefónica",
  oficinas: "Oficinas",
  correo_electronico: "Correo electrónico",

  quejas: "Quejas",
  consultas: "Consultas",
  solicitud: "Solicitud",
  sugerencias: "Sugerencias",

  ocupante: "Ocupante",
  propietario: "Propietario",
  usuario: "Usuario",
  otros: "Otros",

  alto: "Alto",
  medio: "Medio",
  bajo: "Bajo",

  fisura: "Fisura",
  accesos: "Accesos",
  construccion_y_otros: "Construcción y otros",
  colocacion_de_carteles: "Colocación de carteles",
  construccion_en_fd: "Construcción en FD",
  mantenimiento_en_fd: "Mantenimiento en FD",
  oportunidad_laboral: "Oportunidad laboral",
  expropiaciones: "Expropiaciones",
  siniestros_en_peaje: "Siniestros en peaje",
  consulta_facturacion_peaje: "Consulta facturación - peaje",

  satisfactorio: "Satisfactorio",
  parcialmente_satisfactorio: "Parcialmente satisfactorio",
  insatisfactorio: "Insatisfactorio",

  si: "Sí",
  no: "No",
  otro: "Otro",
};

const initialForm = {
  id_proyecto: "",
  id_tramo: "",
  id_expediente: "",
  id_cliente: "",
  id_consultor: "",

  centro_trabajo: "",
  empresa: "",
  fecha_reclamo: "",
  pais: "",
  linea_negocio: "",

  via_recepcion: "",
  codigo: "",
  desea_formular: "",

  reclamante_nombre: "",
  direccion: "",
  pk: "",
  ciudad: "",
  telefono: "",
  email: "",
  en_calidad: "",
  nivel_riesgo: "",
  tipo_vehiculo: "",
  matricula: "",
  descripcion: "",
  firma_reclamante: "",

  latitud: "",
  longitud: "",

  responsable_respuesta: "",
  tipologia: "",
  recibido_por: "",
  aclaracion_recibido: "",
  fecha_recibido: "",
  resolucion: "",

  conformidad_respuesta: "",
  nivel_satisfaccion: "",
  firma_responsable: "",
  aclaracion_reclamante: "",
  aclaracion_responsable: "",
  ci_afectado: "",
  ci_responsable: "",
  fecha_cierre: "",

  estado: "abierto",
};

function safeString(v) {
  return v === null || v === undefined ? "" : String(v);
}

function normalizeDate(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function normalizeFormData(data = {}) {
  return {
    ...initialForm,
    id_proyecto: safeString(data.id_proyecto),
    id_tramo: safeString(data.id_tramo),
    id_expediente: safeString(data.id_expediente),
    id_cliente: safeString(data.id_cliente),
    id_consultor: safeString(data.id_consultor),

    centro_trabajo: safeString(data.centro_trabajo),
    empresa: safeString(data.empresa),
    fecha_reclamo: normalizeDate(data.fecha_reclamo),
    pais: safeString(data.pais),
    linea_negocio: safeString(data.linea_negocio),

    via_recepcion: safeString(data.via_recepcion),
    codigo: safeString(data.codigo || data.numero),
    desea_formular: safeString(data.desea_formular),

    reclamante_nombre: safeString(data.reclamante_nombre),
    direccion: safeString(data.direccion),
    pk: safeString(data.pk),
    ciudad: safeString(data.ciudad),
    telefono: safeString(data.telefono),
    email: safeString(data.email),
    en_calidad: safeString(data.en_calidad || data.categoria_persona),
    nivel_riesgo: safeString(data.nivel_riesgo),
    tipo_vehiculo: safeString(data.tipo_vehiculo),
    matricula: safeString(data.matricula),
    descripcion: safeString(data.descripcion),
    firma_reclamante: safeString(data.firma_reclamante),

    latitud: safeString(data.latitud),
    longitud: safeString(data.longitud),

    responsable_respuesta: safeString(data.responsable_respuesta),
    tipologia: safeString(data.tipologia),
    recibido_por: safeString(data.recibido_por),
    aclaracion_recibido: safeString(data.aclaracion_recibido),
    fecha_recibido: normalizeDate(data.fecha_recibido || data.fecha_respuesta),
    resolucion: safeString(data.resolucion),

    conformidad_respuesta: safeString(data.conformidad_respuesta),
    nivel_satisfaccion: safeString(data.nivel_satisfaccion),
    firma_responsable: safeString(data.firma_responsable),
    aclaracion_reclamante: safeString(data.aclaracion_reclamante),
    aclaracion_responsable: safeString(data.aclaracion_responsable),
    ci_afectado: safeString(data.ci_afectado || data.reclamante_ci),
    ci_responsable: safeString(data.ci_responsable),
    fecha_cierre: normalizeDate(data.fecha_cierre),

    estado: safeString(data.estado) || "abierto",
  };
}

function EstadoBadge({ estado }) {
  const bg =
    estado === "cerrado"
      ? "success"
      : estado === "respondido"
      ? "info"
      : estado === "en_proceso"
      ? "warning"
      : estado === "anulado"
      ? "secondary"
      : "danger";

  return <Badge bg={bg}>{labelOf(estado)}</Badge>;
}

function labelOf(value) {
  return LABELS[value] || value || "-";
}

function SectionTitle({ children, className = "" }) {
  return (
    <div className={`mt-4 ${className}`}>
      <h5 className="mb-1 fw-bold">{children}</h5>
      <hr className="mt-1 mb-3" />
    </div>
  );
}

function RadioGroup({ name, value, options, onChange, disabled, inline = false }) {
  return (
    <div className={`border rounded p-2 ${inline ? "d-flex flex-wrap gap-3" : ""}`}>
      {options.map((opt) => (
        <Form.Check
          key={opt}
          type="radio"
          className={inline ? "mb-0" : "mb-1"}
          label={labelOf(opt)}
          name={name}
          value={opt}
          checked={value === opt}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SignaturePreview({ value, label }) {
  return (
    <div className="border rounded p-2 bg-light">
      <div className="small text-muted mb-2">{label}</div>
      {value ? (
        <img
          src={value}
          alt={label}
          style={{
            width: "100%",
            maxHeight: 140,
            objectFit: "contain",
            background: "#fff",
            border: "1px solid #ddd",
          }}
        />
      ) : (
        <div
          className="d-flex align-items-center justify-content-center text-muted"
          style={{ height: 120, background: "#fff", border: "1px solid #ddd" }}
        >
          Sin firma
        </div>
      )}
    </div>
  );
}

function SignatureModal({ show, onHide, onSave, title }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    if (!show) return;

    const t = setTimeout(() => {
      setupCanvas();
      clearCanvas();
    }, 50);

    return () => clearTimeout(t);
  }, [show]);

  function setupCanvas() {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    canvas.width = Math.max(Math.floor(rect.width * ratio), 300);
    canvas.height = Math.max(Math.floor(260 * ratio), 160);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `260px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, 260);
  }

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function startDraw(e) {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e);

    drawingRef.current = true;
    hasDrawnRef.current = true;

    if (canvas.setPointerCapture && e.pointerId != null) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function moveDraw(e) {
    if (!drawingRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e);

    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw(e) {
    drawingRef.current = false;

    const canvas = canvasRef.current;
    if (canvas?.releasePointerCapture && e.pointerId != null) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    }
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, 260);
    ctx.beginPath();
    hasDrawnRef.current = false;
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!hasDrawnRef.current) {
      alert("Primero dibuje una firma.");
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
    onHide();
  }

  return (
    <Modal show={show} onHide={onHide} centered size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="mb-2 text-muted small">
          Dibuje la firma con mouse, dedo o lápiz táctil.
        </div>

        <div
          ref={wrapperRef}
          className="border rounded bg-white"
          style={{ width: "100%", touchAction: "none" }}
        >
          <canvas
            ref={canvasRef}
            style={{
              display: "block",
              width: "100%",
              height: 260,
              cursor: "crosshair",
              touchAction: "none",
            }}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline-secondary" onClick={clearCanvas}>
          Limpiar
        </Button>
        <Button variant="secondary" onClick={onHide}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={saveSignature}>
          Guardar firma
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function CoordinatePickerModal({
  show,
  onHide,
  onSave,
  initialLat,
  initialLng,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const [selected, setSelected] = useState({
    lat: initialLat ? Number(initialLat) : -25.3,
    lng: initialLng ? Number(initialLng) : -57.6,
  });

  useEffect(() => {
    if (!show) return;

    const startLat = initialLat ? Number(initialLat) : -25.3;
    const startLng = initialLng ? Number(initialLng) : -57.6;
    setSelected({ lat: startLat, lng: startLng });

    let cancelled = false;

    async function initMap() {
      try {
        await loadGoogleMapsApi();
        if (cancelled) return;

        const g = window.google;
        if (!g?.maps || !mapRef.current) return;

        const center = { lat: startLat, lng: startLng };

        const map = new g.maps.Map(mapRef.current, {
          center,
          zoom: initialLat && initialLng ? 16 : 7,
          mapTypeId: "hybrid",
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
        });

        mapInstanceRef.current = map;

        const marker = new g.maps.Marker({
          position: center,
          map,
          draggable: true,
        });

        markerRef.current = marker;

        map.addListener("click", (e) => {
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();

          marker.setPosition({ lat, lng });
          setSelected({ lat, lng });
        });

        marker.addListener("dragend", (e) => {
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          setSelected({ lat, lng });
        });
      } catch (err) {
        console.error("Error cargando mapa:", err);
        alert(err?.message || "No se pudo cargar el mapa");
      }
    }

    const t = setTimeout(initMap, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [show, initialLat, initialLng]);

  function usarUbicacionActual() {
    if (!navigator.geolocation) {
      alert("El navegador no soporta geolocalización.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        setSelected({ lat, lng });

        if (markerRef.current) {
          markerRef.current.setPosition({ lat, lng });
        }

        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter({ lat, lng });
          mapInstanceRef.current.setZoom(17);
        }
      },
      (err) => {
        console.error(err);
        alert("No se pudo obtener la ubicación actual.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function guardar() {
    onSave({
      lat: Number(selected.lat).toFixed(6),
      lng: Number(selected.lng).toFixed(6),
    });
    onHide();
  }

  return (
    <Modal show={show} onHide={onHide} centered size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>Seleccionar coordenadas</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Row className="g-3">
          <Col md={12}>
            <div
              ref={mapRef}
              style={{
                width: "100%",
                height: 420,
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #ddd",
              }}
            />
          </Col>

          <Col md={6}>
            <Form.Label>Latitud</Form.Label>
            <Form.Control value={selected.lat || ""} readOnly />
          </Col>

          <Col md={6}>
            <Form.Label>Longitud</Form.Label>
            <Form.Control value={selected.lng || ""} readOnly />
          </Col>
        </Row>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="outline-secondary" onClick={usarUbicacionActual}>
          Usar ubicación actual
        </Button>
        <Button variant="secondary" onClick={onHide}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={guardar}>
          Guardar coordenadas
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function QuejasReclamos({ idProyectoExternal = null, embedded = false }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const proyectoDesdeUrl = searchParams.get("id_proyecto") || "";
  const initialIdProyecto = idProyectoExternal || proyectoDesdeUrl;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState("");
  const [tipologia, setTipologia] = useState("");
  const [nivelRiesgo, setNivelRiesgo] = useState("");
  const [idProyecto, setIdProyecto] = useState(initialIdProyecto);

  const [showModal, setShowModal] = useState(false);
  const [mode, setMode] = useState("crear");
  const [selectedId, setSelectedId] = useState(null);
  const [formData, setFormData] = useState(initialForm);

  const [tramos, setTramos] = useState([]);
  const [loadingTramos, setLoadingTramos] = useState(false);
  const [nombreProyecto, setNombreProyecto] = useState("");

  const [showFirmaReclamante, setShowFirmaReclamante] = useState(false);
  const [showFirmaResponsable, setShowFirmaResponsable] = useState(false);
  const [showCoordsModal, setShowCoordsModal] = useState(false);

  const isView = useMemo(() => mode === "ver", [mode]);
  const proyectoActualFormulario = formData.id_proyecto || idProyecto || "";
  const hayTramos = Array.isArray(tramos) && tramos.length > 0;

  useEffect(() => {
    setIdProyecto(initialIdProyecto);
  }, [initialIdProyecto]);

  async function fetchData(currentPage = page) {
    try {
      setLoading(true);

      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(limit),
      });

      if (search.trim()) params.append("search", search.trim());
      if (estado) params.append("estado", estado);
      if (tipologia) params.append("tipologia", tipologia);
      if (nivelRiesgo) params.append("nivel_riesgo", nivelRiesgo);
      if (idProyecto) params.append("id_proyecto", idProyecto);

      const res = await fetch(`${API_URL}/quejas-reclamos?${params.toString()}`, {
        headers: authHeader(false),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "No se pudo cargar el listado");
      }

      setItems(Array.isArray(data?.data) ? data.data : []);
      setTotalPages(Number(data?.pagination?.totalPages || 1));
      setPage(Number(data?.pagination?.page || 1));
    } catch (err) {
      console.error("Error cargando quejas y reclamos:", err);
      alert(err.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  async function cargarTramosPorProyecto(idProj) {
    const id = String(idProj || "").trim();

    if (!id) {
      setTramos([]);
      return;
    }

    try {
      setLoadingTramos(true);

      const res = await fetch(`${API_URL}/tramos/proyectos/${id}/tramos`, {
        headers: authHeader(false),
      });

      if (!res.ok) {
        setTramos([]);
        return;
      }

      const data = await res.json();
      const arr = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
        ? data.data
        : [];

      setTramos(arr);
    } catch (err) {
      console.error("Error cargando tramos:", err);
      setTramos([]);
    } finally {
      setLoadingTramos(false);
    }
  }

  async function cargarNombreProyecto(idProj) {
    const id = String(idProj || "").trim();

    if (!id) {
      setNombreProyecto("");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/proyectos/${id}`, {
        headers: authHeader(false),
      });

      if (!res.ok) {
        setNombreProyecto(`Proyecto ${id}`);
        return;
      }

      const data = await res.json();

      setNombreProyecto(
        data?.nombre ||
          data?.proyecto ||
          data?.nombre_proyecto ||
          data?.data?.nombre ||
          data?.data?.proyecto ||
          data?.data?.nombre_proyecto ||
          `Proyecto ${id}`
      );
    } catch (err) {
      console.error("Error cargando nombre del proyecto:", err);
      setNombreProyecto(`Proyecto ${id}`);
    }
  }

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, idProyecto]);

  useEffect(() => {
    cargarTramosPorProyecto(proyectoActualFormulario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoActualFormulario]);

  useEffect(() => {
    cargarNombreProyecto(proyectoActualFormulario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoActualFormulario]);

  async function handleBuscar(e) {
    e?.preventDefault?.();
    fetchData(1);
  }

  function openCrear() {
    const nuevoProyecto = idProyecto || "";

    setMode("crear");
    setSelectedId(null);
    setFormData(
      normalizeFormData({
        ...initialForm,
        id_proyecto: nuevoProyecto,
        id_tramo: "",
      })
    );
    setNombreProyecto("");
    setTramos([]);
    setShowModal(true);

    if (nuevoProyecto) {
      cargarTramosPorProyecto(nuevoProyecto);
      cargarNombreProyecto(nuevoProyecto);
    }
  }

  async function openVer(id) {
    await cargarUno(id, "ver");
  }

  async function openEditar(id) {
    await cargarUno(id, "editar");
  }

  async function cargarUno(id, openMode) {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/quejas-reclamos/${id}`, {
        headers: authHeader(false),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "No se pudo obtener el registro");
      }

      const proyectoRegistro = data?.id_proyecto ? String(data.id_proyecto) : "";

      setSelectedId(id);
      setMode(openMode);
      setFormData(normalizeFormData(data));
      setShowModal(true);

      if (proyectoRegistro) {
        await cargarTramosPorProyecto(proyectoRegistro);
        await cargarNombreProyecto(proyectoRegistro);
      } else {
        setTramos([]);
        setNombreProyecto("");
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Error al cargar el registro");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    if (saving) return;
    setShowModal(false);
    setSelectedId(null);
    setFormData(normalizeFormData(initialForm));
    setMode("crear");
    setTramos([]);
    setNombreProyecto("");
  }

  function handleChange(e) {
    const { name, value } = e.target;

    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      return next;
    });
  }

  function buildPayload() {
    return {
      ...formData,
      id_proyecto: formData.id_proyecto || null,
      id_tramo: formData.id_tramo || null,
      id_expediente: formData.id_expediente || null,
      id_cliente: formData.id_cliente || null,
      id_consultor: formData.id_consultor || null,
      firma_reclamante: formData.firma_reclamante || null,
      firma_responsable: formData.firma_responsable || null,
      latitud: formData.latitud || null,
      longitud: formData.longitud || null,
      numero: formData.codigo || null,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!formData.descripcion?.trim()) {
      alert("La descripción es obligatoria");
      return;
    }

    try {
      setSaving(true);

      const payload = buildPayload();
      const isEdit = mode === "editar";
      const url = isEdit
        ? `${API_URL}/quejas-reclamos/${selectedId}`
        : `${API_URL}/quejas-reclamos`;

      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: authHeader(true),
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "No se pudo guardar");
      }

      alert(data?.message || "Guardado correctamente");
      closeModal();
      fetchData(page);
    } catch (err) {
      console.error(err);
      alert(err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleEliminar(id) {
    if (!window.confirm("¿Deseás eliminar este registro?")) return;

    try {
      const res = await fetch(`${API_URL}/quejas-reclamos/${id}`, {
        method: "DELETE",
        headers: authHeader(false),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "No se pudo eliminar");
      }

      alert(data?.message || "Eliminado correctamente");
      fetchData(page);
    } catch (err) {
      console.error(err);
      alert(err.message || "Error al eliminar");
    }
  }

  async function handleCambiarEstado(id, nuevoEstado) {
    try {
      const res = await fetch(`${API_URL}/quejas-reclamos/${id}/estado`, {
        method: "PATCH",
        headers: authHeader(true),
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "No se pudo cambiar el estado");
      }

      fetchData(page);
    } catch (err) {
      console.error(err);
      alert(err.message || "Error al cambiar estado");
    }
  }

  function guardarFirmaReclamante(dataUrl) {
    setFormData((prev) => ({ ...prev, firma_reclamante: dataUrl }));
  }

  function guardarFirmaResponsable(dataUrl) {
    setFormData((prev) => ({ ...prev, firma_responsable: dataUrl }));
  }

  function limpiarFirma(campo) {
    setFormData((prev) => ({ ...prev, [campo]: "" }));
  }

  function guardarCoordenadas({ lat, lng }) {
    setFormData((prev) => ({
      ...prev,
      latitud: String(lat),
      longitud: String(lng),
    }));
  }

  function limpiarCoordenadas() {
    setFormData((prev) => ({
      ...prev,
      latitud: "",
      longitud: "",
    }));
  }

  return (
    <div className={`container-fluid ${embedded ? "px-0" : "py-3"}`}>
      {!embedded && (
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div className="d-flex align-items-center gap-3">
            <Button variant="outline-secondary" onClick={() => navigate(`/project-home/${idProyecto}`)}>
              <FaArrowLeft /> Volver
            </Button>
            <div>
              <h3 className="mb-0">Quejas y Reclamos</h3>
              <small className="text-muted">
                {nombreProyecto ? `Proyecto: ${nombreProyecto}` : "Gestión de quejas, reclamos y seguimiento"}
              </small>
            </div>
          </div>
          <div className="d-flex gap-3">
            <Button variant="success" onClick={openCrear}>
              + Nueva Queja
            </Button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="d-flex justify-content-end mb-3">
           <Button variant="success" onClick={openCrear}>
            + Nueva Queja
           </Button>
        </div>
      )}

      <div style={{ display: 'block' }}>
        <div className="card shadow-sm border-0 mb-3">
          <div className="card-body">
            <Form onSubmit={handleBuscar}>
              <Row className="g-2">
                <Col md={2}>
                  <Form.Control
                    value={nombreProyecto || (idProyecto ? `Proyecto ${idProyecto}` : "")}
                    readOnly
                  />
                </Col>

                <Col md={3}>
                  <Form.Control
                    placeholder="Buscar por código, nombre o descripción"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Col>

                <Col md={2}>
                  <Form.Select value={estado} onChange={(e) => setEstado(e.target.value)}>
                    <option value="">Todos los estados</option>
                    {ESTADOS.map((x) => (
                      <option key={x} value={x}>
                        {labelOf(x)}
                      </option>
                    ))}
                  </Form.Select>
                </Col>

                <Col md={2}>
                  <Form.Select value={tipologia} onChange={(e) => setTipologia(e.target.value)}>
                    <option value="">Todas las tipologías</option>
                    {TIPOLOGIAS.map((x) => (
                      <option key={x} value={x}>
                        {labelOf(x)}
                      </option>
                    ))}
                  </Form.Select>
                </Col>

                <Col md={2}>
                  <Form.Select value={nivelRiesgo} onChange={(e) => setNivelRiesgo(e.target.value)}>
                    <option value="">Todo riesgo</option>
                    {NIVELES.map((x) => (
                      <option key={x} value={x}>
                        {labelOf(x)}
                      </option>
                    ))}
                  </Form.Select>
                </Col>

                <Col md={1} className="d-grid">
                  <Button type="submit">Buscar</Button>
                </Col>
              </Row>
            </Form>
          </div>
        </div>

      <div className="card shadow-sm border-0">
        <div className="card-body">
          {loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <Table striped hover bordered align="middle">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Código</th>
                      <th>Fecha</th>
                      <th>Nombre y Apellido</th>
                      <th>Tipología</th>
                      <th>Riesgo</th>
                      <th>Estado</th>
                      <th>Proyecto</th>
                      <th>Coords</th>
                      <th style={{ width: 260 }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="text-center text-muted py-4">
                          No hay registros
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr key={item.id_queja}>
                          <td>{item.id_queja}</td>
                          <td>{item.codigo || item.numero || "-"}</td>
                          <td>
                            {item.fecha_reclamo
                              ? new Date(item.fecha_reclamo).toLocaleDateString()
                              : "-"}
                          </td>
                          <td>{item.reclamante_nombre || "-"}</td>
                          <td>{labelOf(item.tipologia)}</td>
                          <td>{labelOf(item.nivel_riesgo)}</td>
                          <td>
                            <EstadoBadge estado={item.estado} />
                          </td>
                          <td>{item.nombre_proyecto || item.proyecto || item.id_proyecto || "-"}</td>
                          <td>
                            {item.latitud && item.longitud
                              ? `${item.latitud}, ${item.longitud}`
                              : "-"}
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              <Button size="sm" variant="secondary" onClick={() => openVer(item.id_queja)}>
                                Ver
                              </Button>

                              <Button size="sm" variant="warning" onClick={() => openEditar(item.id_queja)}>
                                Editar
                              </Button>

                              {item.estado !== "cerrado" && (
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() => handleCambiarEstado(item.id_queja, "cerrado")}
                                >
                                  Cerrar
                                </Button>
                              )}

                              <Button size="sm" variant="danger" onClick={() => handleEliminar(item.id_queja)}>
                                Eliminar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>

              <div className="d-flex justify-content-between align-items-center mt-3">
                <div className="d-flex align-items-center gap-2">
                  <span>Filas por página:</span>
                  <Form.Select
                    style={{ width: 90 }}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  >
                    {[10, 20, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Form.Select>
                </div>

                <div className="d-flex align-items-center gap-2">
                  <Button disabled={page <= 1} onClick={() => fetchData(page - 1)}>
                    Anterior
                  </Button>
                  <span>
                    Página {page} de {totalPages}
                  </span>
                  <Button disabled={page >= totalPages} onClick={() => fetchData(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>

      <Modal show={showModal} onHide={closeModal} size="xl" backdrop="static">
        <Form onSubmit={handleSubmit}>
          <Modal.Header closeButton={!saving}>
            <Modal.Title>
              {mode === "crear"
                ? "Nueva Queja / Reclamo"
                : mode === "editar"
                ? "Editar Queja / Reclamo"
                : "Ver Queja / Reclamo"}
            </Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <SectionTitle className="mt-0">Primera sección</SectionTitle>

            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Centro de trabajo</Form.Label>
                <Form.Control
                  name="centro_trabajo"
                  value={formData.centro_trabajo}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Empresa</Form.Label>
                <Form.Control
                  name="empresa"
                  value={formData.empresa}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Fecha</Form.Label>
                <Form.Control
                  type="date"
                  name="fecha_reclamo"
                  value={formData.fecha_reclamo}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>País</Form.Label>
                <Form.Control
                  name="pais"
                  value={formData.pais}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>Línea de negocios</Form.Label>
                <Form.Select
                  name="linea_negocio"
                  value={formData.linea_negocio}
                  onChange={handleChange}
                  disabled={isView}
                >
                  <option value="">Seleccione</option>
                  {LINEAS_NEGOCIO.map((x) => (
                    <option key={x} value={x}>
                      {labelOf(x)}
                    </option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <SectionTitle>Segunda sección</SectionTitle>

            <Row className="g-3">
              <Col md={6}>
                <Form.Label>Vía de recepción</Form.Label>
                <Form.Select
                  name="via_recepcion"
                  value={formData.via_recepcion}
                  onChange={handleChange}
                  disabled={isView}
                >
                  <option value="">Seleccione</option>
                  {VIAS_RECEPCION.map((x) => (
                    <option key={x} value={x}>
                      {labelOf(x)}
                    </option>
                  ))}
                </Form.Select>
              </Col>

              <Col md={6}>
                <Form.Label>Código</Form.Label>
                <Form.Control
                  name="codigo"
                  value={formData.codigo}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={12}>
                <Form.Label>Desea formular</Form.Label>
                <RadioGroup
                  name="desea_formular"
                  value={formData.desea_formular}
                  options={DESEA_FORMULAR}
                  onChange={handleChange}
                  disabled={isView}
                  inline
                />
              </Col>
            </Row>

            <SectionTitle>Datos personales</SectionTitle>

            <Row className="g-3">
              <Col md={6}>
                <Form.Label>Nombre y Apellido</Form.Label>
                <Form.Control
                  name="reclamante_nombre"
                  value={formData.reclamante_nombre}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>Dirección</Form.Label>
                <Form.Control
                  name="direccion"
                  value={formData.direccion}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>
                  Tramo
                  {loadingTramos && <Spinner animation="border" size="sm" className="ms-2" />}
                </Form.Label>

                {hayTramos ? (
                  <Form.Select
                    name="id_tramo"
                    value={formData.id_tramo}
                    onChange={handleChange}
                    disabled={isView}
                  >
                    <option value="">Seleccione un tramo</option>
                    {tramos.map((t) => (
                      <option key={t.id_tramo} value={t.id_tramo}>
                        {t.nombre_tramo || `Tramo ${t.id_tramo}`}
                      </option>
                    ))}
                  </Form.Select>
                ) : (
                  <Form.Control
                    name="id_tramo"
                    value={formData.id_tramo}
                    onChange={handleChange}
                    disabled={isView}
                    placeholder="ID Tramo"
                  />
                )}
              </Col>

              <Col md={4}>
                <Form.Label>PK</Form.Label>
                <Form.Control
                  name="pk"
                  value={formData.pk}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Ciudad</Form.Label>
                <Form.Control
                  name="ciudad"
                  value={formData.ciudad}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>Celular</Form.Label>
                <Form.Control
                  name="telefono"
                  value={formData.telefono}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>Email</Form.Label>
                <Form.Control
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>Proyecto</Form.Label>
                <Form.Control
                  value={nombreProyecto || (formData.id_proyecto ? `Proyecto ${formData.id_proyecto}` : "")}
                  readOnly
                />
                {!!formData.id_proyecto && (
                  <Form.Text className="text-muted">
                    ID: {formData.id_proyecto}
                  </Form.Text>
                )}
              </Col>

              <Col md={3}>
                <Form.Label>ID Expediente</Form.Label>
                <Form.Control
                  name="id_expediente"
                  value={formData.id_expediente}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Latitud</Form.Label>
                <Form.Control
                  name="latitud"
                  value={formData.latitud}
                  onChange={handleChange}
                  disabled={isView}
                  placeholder="-25.123456"
                />
              </Col>

              <Col md={4}>
                <Form.Label>Longitud</Form.Label>
                <Form.Control
                  name="longitud"
                  value={formData.longitud}
                  onChange={handleChange}
                  disabled={isView}
                  placeholder="-57.654321"
                />
              </Col>

              <Col md={4}>
                <Form.Label>Mapa</Form.Label>
                <div className="d-flex gap-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowCoordsModal(true)}
                    disabled={isView}
                    className="w-100"
                  >
                    Seleccionar en mapa
                  </Button>

                  {!!formData.latitud && !!formData.longitud && !isView && (
                    <Button variant="outline-danger" onClick={limpiarCoordenadas}>
                      Limpiar
                    </Button>
                  )}
                </div>
              </Col>

              <Col md={12}>
                <Form.Label>En calidad de</Form.Label>
                <RadioGroup
                  name="en_calidad"
                  value={formData.en_calidad}
                  options={EN_CALIDAD}
                  onChange={handleChange}
                  disabled={isView}
                  inline
                />
              </Col>

              <Col md={12}>
                <Form.Label>Nivel de riesgo</Form.Label>
                <RadioGroup
                  name="nivel_riesgo"
                  value={formData.nivel_riesgo}
                  options={NIVELES}
                  onChange={handleChange}
                  disabled={isView}
                  inline
                />
              </Col>

              <Col md={6}>
                <Form.Label>Tipo de vehículo</Form.Label>
                <Form.Control
                  name="tipo_vehiculo"
                  value={formData.tipo_vehiculo}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>Matrícula</Form.Label>
                <Form.Control
                  name="matricula"
                  value={formData.matricula}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={12}>
                <Form.Label>Descripción</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  name="descripcion"
                  value={formData.descripcion}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={12}>
                <Form.Label>Firma del reclamante</Form.Label>
                <div className="d-flex gap-2 mb-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowFirmaReclamante(true)}
                    disabled={isView}
                  >
                    {formData.firma_reclamante ? "Volver a firmar" : "Firmar reclamante"}
                  </Button>
                  {!!formData.firma_reclamante && !isView && (
                    <Button
                      variant="outline-danger"
                      onClick={() => limpiarFirma("firma_reclamante")}
                    >
                      Quitar firma
                    </Button>
                  )}
                </div>
                <SignaturePreview
                  value={formData.firma_reclamante}
                  label="Firma del reclamante"
                />
              </Col>
            </Row>

            <SectionTitle>Gestión y respuesta</SectionTitle>

            <Row className="g-3">
              <Col md={6}>
                <Form.Label>Responsable de dar respuesta</Form.Label>
                <Form.Control
                  name="responsable_respuesta"
                  value={formData.responsable_respuesta}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>Tipología de queja</Form.Label>
                <Form.Select
                  name="tipologia"
                  value={formData.tipologia}
                  onChange={handleChange}
                  disabled={isView}
                >
                  <option value="">Seleccione</option>
                  {TIPOLOGIAS.map((x) => (
                    <option key={x} value={x}>
                      {labelOf(x)}
                    </option>
                  ))}
                </Form.Select>
              </Col>

              <Col md={4}>
                <Form.Label>Recibido por</Form.Label>
                <Form.Control
                  name="recibido_por"
                  value={formData.recibido_por}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Aclaración</Form.Label>
                <Form.Control
                  name="aclaracion_recibido"
                  value={formData.aclaracion_recibido}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Fecha</Form.Label>
                <Form.Control
                  type="date"
                  name="fecha_recibido"
                  value={formData.fecha_recibido}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={12}>
                <Form.Label>Resolución de queja, reclamo y/o sugerencia</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={5}
                  name="resolucion"
                  value={formData.resolucion}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>
            </Row>

            <SectionTitle>Cierre y conformidad</SectionTitle>

            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Conformidad en la respuesta</Form.Label>
                <RadioGroup
                  name="conformidad_respuesta"
                  value={formData.conformidad_respuesta}
                  options={CONFORMIDAD}
                  onChange={handleChange}
                  disabled={isView}
                  inline
                />
              </Col>

              <Col md={8}>
                <Form.Label>Nivel de satisfacción</Form.Label>
                <RadioGroup
                  name="nivel_satisfaccion"
                  value={formData.nivel_satisfaccion}
                  options={SATISFACCION}
                  onChange={handleChange}
                  disabled={isView}
                  inline
                />
              </Col>

              <Col md={4}>
                <Form.Label>Estado</Form.Label>
                <Form.Select
                  name="estado"
                  value={formData.estado}
                  onChange={handleChange}
                  disabled={isView}
                >
                  {ESTADOS.map((x) => (
                    <option key={x} value={x}>
                      {labelOf(x)}
                    </option>
                  ))}
                </Form.Select>
              </Col>

              <Col md={4}>
                <Form.Label>Fecha de cierre</Form.Label>
                <Form.Control
                  type="date"
                  name="fecha_cierre"
                  value={formData.fecha_cierre}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={4}>
                <Form.Label>Código</Form.Label>
                <Form.Control
                  name="codigo"
                  value={formData.codigo}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={6}>
                <Form.Label>Firma del afectado</Form.Label>
                <div className="d-flex gap-2 mb-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowFirmaReclamante(true)}
                    disabled={isView}
                  >
                    {formData.firma_reclamante ? "Volver a firmar" : "Firmar afectado"}
                  </Button>
                  {!!formData.firma_reclamante && !isView && (
                    <Button
                      variant="outline-danger"
                      onClick={() => limpiarFirma("firma_reclamante")}
                    >
                      Quitar firma
                    </Button>
                  )}
                </div>
                <SignaturePreview
                  value={formData.firma_reclamante}
                  label="Firma del afectado"
                />
              </Col>

              <Col md={6}>
                <Form.Label>Firma del responsable de cierre</Form.Label>
                <div className="d-flex gap-2 mb-2">
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowFirmaResponsable(true)}
                    disabled={isView}
                  >
                    {formData.firma_responsable ? "Volver a firmar" : "Firmar responsable"}
                  </Button>
                  {!!formData.firma_responsable && !isView && (
                    <Button
                      variant="outline-danger"
                      onClick={() => limpiarFirma("firma_responsable")}
                    >
                      Quitar firma
                    </Button>
                  )}
                </div>
                <SignaturePreview
                  value={formData.firma_responsable}
                  label="Firma del responsable"
                />
              </Col>

              <Col md={3}>
                <Form.Label>Aclaración afectado</Form.Label>
                <Form.Control
                  name="aclaracion_reclamante"
                  value={formData.aclaracion_reclamante}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>CI afectado</Form.Label>
                <Form.Control
                  name="ci_afectado"
                  value={formData.ci_afectado}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>Aclaración responsable</Form.Label>
                <Form.Control
                  name="aclaracion_responsable"
                  value={formData.aclaracion_responsable}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>

              <Col md={3}>
                <Form.Label>CI responsable</Form.Label>
                <Form.Control
                  name="ci_responsable"
                  value={formData.ci_responsable}
                  onChange={handleChange}
                  disabled={isView}
                />
              </Col>
            </Row>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cerrar
            </Button>
            {!isView && (
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </Modal.Footer>
        </Form>
      </Modal>

      <SignatureModal
        show={showFirmaReclamante}
        onHide={() => setShowFirmaReclamante(false)}
        onSave={guardarFirmaReclamante}
        title="Firma del reclamante"
      />

      <SignatureModal
        show={showFirmaResponsable}
        onHide={() => setShowFirmaResponsable(false)}
        onSave={guardarFirmaResponsable}
        title="Firma del responsable"
      />

      <CoordinatePickerModal
        show={showCoordsModal}
        onHide={() => setShowCoordsModal(false)}
        onSave={guardarCoordenadas}
        initialLat={formData.latitud}
        initialLng={formData.longitud}
      />
    </div>
  );
}