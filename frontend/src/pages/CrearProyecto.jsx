// src/pages/CrearProyecto.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Form, Button, Container, Row, Col } from "react-bootstrap";
import { alerts } from "@/utils/alerts";
import GoogleMapaCoordenadas from "@/components/GoogleMapaCoordenadas";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   ✅ Validaciones según ema.proyectos
========================= */
const LIMITS = {
  expediente: 40,
  nombre: 100,
  codigo: 50,
  descripcion: 550,
  expediente_hidrico: 20,
  estado: 20,
  tipo_estudio: 150,
  actividad: 200,
  tipo_proyecto: 30,
  dpto: 150,
  distrito: 150,
  barrio: 150,
  sector_proyecto: 100,
  padron: 100,
  cta_cte: 500,
  finca: 20,
  matricula: 100,
};

const COOR_MAX_ABS = 999.999999999;

function tooLong(label, value, max) {
  const v = (value ?? "").toString();
  if (!v) return null;
  return v.length > max ? `${label} supera el máximo de ${max} caracteres.` : null;
}

function isNumberLike(v) {
  if (v === "" || v === null || v === undefined) return true;
  return /^-?\d+(\.\d+)?$/.test(String(v).trim());
}

function validateCoords(label, raw) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (!isNumberLike(v)) return `${label} debe ser numérico (usar punto "." para decimales).`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} no es un número válido.`;
  if (Math.abs(n) > COOR_MAX_ABS) return `${label} fuera de rango (máx ±${COOR_MAX_ABS}).`;
  const decimals = (v.split(".")[1] || "").length;
  if (decimals > 9) return `${label} admite hasta 9 decimales.`;
  return null;
}

function validateForm(fd) {
  const e = {};

  if (!String(fd.codigo || "").trim()) e.codigo = "Código es obligatorio.";
  if (!String(fd.nombre || "").trim()) e.nombre = "Nombre del proyecto es obligatorio.";
  if (!String(fd.tipo_estudio || "").trim()) e.tipo_estudio = "Seleccione Tipo de Estudio.";

  const rules = [
    ["nro_expediente", "Nro Expediente", fd.nro_expediente, LIMITS.expediente],
    ["codigo", "Código", fd.codigo, LIMITS.codigo],
    ["nombre", "Nombre", fd.nombre, LIMITS.nombre],
    ["descripcion", "Descripción", fd.descripcion, LIMITS.descripcion],
    ["expediente_hidrico", "Expediente Hídrico", fd.expediente_hidrico, LIMITS.expediente_hidrico],
    ["estado", "Estado", fd.estado, LIMITS.estado],
    ["tipo_proyecto", "Tipo de Proyecto", fd.tipo_proyecto, LIMITS.tipo_proyecto],
    ["departamento", "Departamento", fd.departamento, LIMITS.dpto],
    ["distrito", "Distrito", fd.distrito, LIMITS.distrito],
    ["barrio", "Barrio/Localidad", fd.barrio, LIMITS.barrio],
    ["sector", "Sector", fd.sector, LIMITS.sector_proyecto],
    ["padron", "Padrón", fd.padron, LIMITS.padron],
    ["cta_cte", "Cta. Cte.", fd.cta_cte, LIMITS.cta_cte],
    ["finca", "Finca", fd.finca, LIMITS.finca],
    ["matricula", "Matrícula", fd.matricula, LIMITS.matricula],
  ];

  for (const [key, label, val, max] of rules) {
    const msg = tooLong(label, val, max);
    if (msg) e[key] = msg;
  }

  const cx = validateCoords("Coordenada X", fd.coordenada_x);
  const cy = validateCoords("Coordenada Y", fd.coordenada_y);
  if (cx) e.coordenada_x = cx;
  if (cy) e.coordenada_y = cy;

  if (fd.fecha_inicio && fd.fecha_final) {
    const a = new Date(fd.fecha_inicio);
    const b = new Date(fd.fecha_final);
    if (a.toString() !== "Invalid Date" && b.toString() !== "Invalid Date" && a > b) {
      e.fecha_final = "Fecha Final no puede ser menor que Fecha Inicio.";
    }
  }

  if (fd.id_consultor && !/^\d+$/.test(String(fd.id_consultor))) e.id_consultor = "Consultor inválido.";
  if (fd.id_proponente && !/^\d+$/.test(String(fd.id_proponente))) e.id_proponente = "Proponente inválido.";

  return e;
}

export default function CrearProyecto() {
  const navigate = useNavigate();

  const rawToken = localStorage.getItem("token");
  const bearer = rawToken ? (rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`) : null;
  const authHeaders = bearer ? { Authorization: bearer } : {};

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
    fecha_registro: new Date().toISOString().split("T")[0],
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
  });

  const [errors, setErrors] = useState({});

  // ✅ usuario logueado
  const [me, setMe] = useState(null);
  const [lockedConsultor, setLockedConsultor] = useState(false);

  const refs = {
    nro_expediente: useRef(null),
    tipo_estudio: useRef(null),
    codigo: useRef(null),
    tipo_proyecto: useRef(null),
    nombre: useRef(null),
    actividad: useRef(null),
    estado: useRef(null),
    id_consultor: useRef(null),
    id_proponente: useRef(null),
    sector: useRef(null),
    fecha_inicio: useRef(null),
    fecha_final: useRef(null),
    fecha_registro: useRef(null),
    expediente_hidrico: useRef(null),
    departamento: useRef(null),
    distrito: useRef(null),
    barrio: useRef(null),
    descripcion: useRef(null),
    padron: useRef(null),
    cta_cte: useRef(null),
    finca: useRef(null),
    matricula: useRef(null),
  };

  const focusField = (name) => {
    const el = refs?.[name]?.current;
    if (el?.focus) el.focus();
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const [tiposEstudio, setTiposEstudio] = useState([]);
  const [tiposProyecto, setTiposProyecto] = useState([]);
  const [actividades, setActividades] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [proponentes, setProponentes] = useState([]);
  const [sectores, setSectores] = useState([]);

  const [showModal, setShowModal] = useState(false);
  const [nuevaActividad, setNuevaActividad] = useState("");

  const [showModalSector, setShowModalSector] = useState(false);
  const [nuevoSectorId, setNuevoSectorId] = useState("");
  const [nuevoSectorNombre, setNuevoSectorNombre] = useState("");

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  const toArray = (x) =>
    Array.isArray(x?.data) ? x.data : Array.isArray(x?.rows) ? x.rows : Array.isArray(x) ? x : [];

  const fetchList = async (url, setter) => {
    try {
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setter(toArray(json));
    } catch (e) {
      console.error("GET", url, e);
      setter([]);
    }
  };

  // ✅ traer usuario logueado
  const fetchMe = async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const user = await res.json();
      setMe(user);

      if (user?.id_consultor) {
        setFormData((prev) => ({
          ...prev,
          id_consultor: String(user.id_consultor),
        }));
        setLockedConsultor(true);
      } else {
        setLockedConsultor(false);
      }
    } catch (err) {
      console.error("Error obteniendo usuario logueado:", err);
      setMe(null);
      setLockedConsultor(false);
    }
  };

  useEffect(() => {
    fetchMe();
    fetchList(`${API_URL}/conceptos/tipo-estudio`, setTiposEstudio);
    fetchList(`${API_URL}/conceptos/tipo-proyecto`, setTiposProyecto);
    fetchList(`${API_URL}/conceptos/actividad`, setActividades);
    fetchList(`${API_URL}/conceptos/sector-proyecto`, setSectores);
    fetchList(`${API_URL}/consultores`, setConsultores);
    fetchList(`${API_URL}/proponentes/dropdown`, setProponentes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawToken]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    // ✅ si el consultor viene del usuario logueado, no permitir cambiarlo
    if (name === "id_consultor" && lockedConsultor) return;

    setFormData((prev) => ({ ...prev, [name]: value }));

    setErrors((prev) => {
      if (!prev?.[name]) return prev;
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const mapaValue = (() => {
    const lat = Number(formData.coordenada_y);
    const lng = Number(formData.coordenada_x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const frontErrors = validateForm(formData);
    if (Object.keys(frontErrors).length) {
      setErrors(frontErrors);
      const firstKey = Object.keys(frontErrors)[0];
      const msg = frontErrors[firstKey];
      alerts?.toast?.warning ? alerts.toast.warning(msg) : console.warn(msg);
      focusField(firstKey);
      return;
    }

    try {
      const payload = {
        expediente: formData.nro_expediente || null,
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

        // ✅ prioridad al consultor del usuario logueado si existe
        id_consultor: me?.id_consultor
          ? Number(me.id_consultor)
          : formData.id_consultor
          ? parseInt(formData.id_consultor, 10)
          : null,

        id_proponente: formData.id_proponente ? parseInt(formData.id_proponente, 10) : null,
        sector_proyecto: formData.sector || null,
        coor_x: formData.coordenada_x ? Number(formData.coordenada_x) : null,
        coor_y: formData.coordenada_y ? Number(formData.coordenada_y) : null,
        dpto: formData.departamento || null,
        distrito: formData.distrito || null,
        barrio: formData.barrio || null,
        padron: formData.padron || null,
        cta_cte: formData.cta_cte || null,
        finca: formData.finca || null,
        matricula: formData.matricula || null,
        estado: formData.estado || null,
      };

      const res = await fetch(`${API_URL}/proyectos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const low = String(raw || "").toLowerCase();

        if (res.status === 409 || low.includes("llave duplicada") || /duplicate|unique/i.test(raw)) {
          const e2 = { codigo: "El código del proyecto ya existe. Ingrese uno diferente." };
          setErrors((prev) => ({ ...prev, ...e2 }));
          alerts?.toast?.warning ? alerts.toast.warning(e2.codigo) : console.warn(e2.codigo);
          focusField("codigo");
          return;
        }

        if (/value too long|character varying/i.test(raw)) {
          const e2 = {
            descripcion:
              "Algún texto es demasiado largo. Revisá Código/Nombre/Descripción y campos catastrales.",
          };
          setErrors((prev) => ({ ...prev, ...e2 }));
          alerts?.toast?.warning ? alerts.toast.warning(e2.descripcion) : console.warn(e2.descripcion);
          focusField("descripcion");
          return;
        }

        if (
          /invalid input syntax for type numeric|numeric/i.test(raw) &&
          (low.includes("coor") || low.includes("coor_x") || low.includes("coor_y"))
        ) {
          const e2 = {
            coordenada_x: "Coordenadas inválidas. Usá números y punto para decimales.",
            coordenada_y: "Coordenadas inválidas.",
          };
          setErrors((prev) => ({ ...prev, ...e2 }));
          alerts?.toast?.warning
            ? alerts.toast.warning("Coordenadas inválidas.")
            : console.warn("Coordenadas inválidas.");
          return;
        }

        if (res.status === 401 || low.includes("401")) {
          alerts?.toast?.warning
            ? alerts.toast.warning("Sesión expirada o no autorizada. Inicia sesión nuevamente.")
            : console.warn("Sesión expirada o no autorizada.");
          return;
        }

        throw new Error(raw || `HTTP ${res.status}`);
      }

      alerts?.toast?.success
        ? alerts.toast.success("Proyecto creado con éxito.")
        : console.info("Proyecto creado con éxito");

      navigate("/proyectos");
    } catch (err) {
      console.error(err);
      alerts?.toast?.error
        ? alerts.toast.error("Error al crear el proyecto.")
        : console.error("Error al crear el proyecto");
    }
  };

  const getNextActividadIdLocal = (lista) => {
    const nums = (Array.isArray(lista) ? lista : [])
      .map((a) => parseInt(String(a.concepto).trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const max = nums.length ? Math.max(...nums) : 0;
    return String(max + 1);
  };

  const fetchActividades = async () => {
    try {
      const res = await fetch(`${API_URL}/conceptos/actividad`, { headers: authHeaders });
      if (!res.ok) return [];
      const j = await res.json();
      return toArray(j);
    } catch {
      return [];
    }
  };

  const agregarActividad = async () => {
    const nombre = (nuevaActividad || "").trim();
    if (!nombre) {
      alerts?.toast?.warning ? alerts.toast.warning("Ingrese un nombre válido.") : console.warn("Ingrese un nombre válido");
      return;
    }
    if (nombre.length > LIMITS.actividad) {
      alerts?.toast?.warning
        ? alerts.toast.warning(`El nombre de la actividad supera ${LIMITS.actividad} caracteres.`)
        : console.warn(`El nombre de la actividad supera ${LIMITS.actividad} caracteres.`);
      return;
    }

    let concepto = getNextActividadIdLocal(actividades);
    const existeLocal = actividades.some((a) => String(a.concepto) === concepto);
    if (existeLocal) concepto = getNextActividadIdLocal(actividades);

    try {
      let res = await fetch(`${API_URL}/conceptos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ concepto, nombre, tipoconcepto: "ACTIVIDAD" }),
      });

      if (!res.ok) {
        const txt = await res.text();
        const conflict = res.status === 409 || /duplicate|unique|conflict/i.test(txt);
        if (conflict) {
          const listaSrv = await fetchActividades();
          concepto = getNextActividadIdLocal(listaSrv);
          res = await fetch(`${API_URL}/conceptos`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ concepto, nombre, tipoconcepto: "ACTIVIDAD" }),
          });
        }
      }

      if (!res.ok) throw new Error(await res.text());

      const nuevo = { concepto, nombre };
      setActividades((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setFormData((prev) => ({ ...prev, actividad: concepto }));
      setShowModal(false);
      setNuevaActividad("");

      alerts?.toast?.success ? alerts.toast.success("Actividad añadida con éxito.") : console.info("Actividad añadida con éxito");
    } catch (err) {
      console.error(err);
      alerts?.toast?.error ? alerts.toast.error("Error al guardar la actividad.") : console.error("Error al guardar la actividad");
    }
  };

  const agregarSector = async () => {
    const idRaw = (nuevoSectorId || "").trim();
    const nombre = (nuevoSectorNombre || "").trim();

    if (!idRaw) {
      alerts?.toast?.warning
        ? alerts.toast.warning("Ingrese el ID (concepto) del sector.")
        : console.warn("Ingrese el ID (concepto) del sector.");
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(idRaw)) {
      alerts?.toast?.warning
        ? alerts.toast.warning('El ID debe ser alfanumérico (puedes usar "-" y "_"), sin espacios.')
        : console.warn('El ID debe ser alfanumérico (puedes usar "-" y "_"), sin espacios.');
      return;
    }
    if (idRaw.length > LIMITS.sector_proyecto) {
      alerts?.toast?.warning
        ? alerts.toast.warning(`El ID del sector supera ${LIMITS.sector_proyecto} caracteres.`)
        : console.warn(`El ID del sector supera ${LIMITS.sector_proyecto} caracteres.`);
      return;
    }
    if (!nombre) {
      alerts?.toast?.warning ? alerts.toast.warning("Ingrese el nombre del sector.") : console.warn("Ingrese el nombre del sector.");
      return;
    }
    if (nombre.length > LIMITS.sector_proyecto) {
      alerts?.toast?.warning
        ? alerts.toast.warning(`El nombre del sector supera ${LIMITS.sector_proyecto} caracteres.`)
        : console.warn(`El nombre del sector supera ${LIMITS.sector_proyecto} caracteres.`);
      return;
    }

    const idLower = idRaw.toLowerCase();
    const existente = sectores.find((s) => String(s.concepto).toLowerCase() === idLower);
    if (existente) {
      if (confirm(`El ID ${idRaw} ya existe (${existente.nombre}). ¿Desea usar este sector?`)) {
        setFormData((prev) => ({ ...prev, sector: existente.concepto }));
        setShowModalSector(false);
        setNuevoSectorId("");
        setNuevoSectorNombre("");
      }
      return;
    }

    try {
      const nueva = { concepto: idRaw, nombre, tipoconcepto: "SECTORE_PROYECTOS" };

      const res = await fetch(`${API_URL}/conceptos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(nueva),
      });
      if (!res.ok) throw new Error(await res.text());

      setSectores((prev) => [...prev, nueva]);
      setFormData((prev) => ({ ...prev, sector: nueva.concepto }));
      setShowModalSector(false);
      setNuevoSectorId("");
      setNuevoSectorNombre("");

      alerts?.toast?.success ? alerts.toast.success("Sector añadido con éxito.") : console.info("Sector añadido con éxito");
    } catch (err) {
      console.error(err);
      alerts?.toast?.error ? alerts.toast.error("Error al guardar el sector.") : console.error("Error al guardar el sector");
    }
  };

  const consultorSeleccionado = consultores.find(
    (c) => Number(c.id_consultor) === Number(formData.id_consultor)
  );

  return (
    <>
      <Container className="py-4">
        <h2 className="mb-4">Crear Nuevo Proyecto</h2>

        <Form onSubmit={handleSubmit} noValidate>
          <Row className="mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Nro Expediente</Form.Label>
                <Form.Control
                  ref={refs.nro_expediente}
                  name="nro_expediente"
                  value={formData.nro_expediente}
                  onChange={handleChange}
                  maxLength={LIMITS.expediente}
                  isInvalid={!!errors.nro_expediente}
                />
                <Form.Control.Feedback type="invalid">{errors.nro_expediente}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Tipo de Estudio</Form.Label>
                <Form.Select
                  ref={refs.tipo_estudio}
                  name="tipo_estudio"
                  value={formData.tipo_estudio}
                  onChange={handleChange}
                  required
                  isInvalid={!!errors.tipo_estudio}
                >
                  <option value="">Seleccione Tipo Estudio</option>
                  {tiposEstudio.map((t) => (
                    <option key={t.concepto} value={t.concepto}>
                      {t.concepto} - {t.nombre}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{errors.tipo_estudio}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Código</Form.Label>
                <Form.Control
                  ref={refs.codigo}
                  name="codigo"
                  value={formData.codigo}
                  onChange={handleChange}
                  required
                  maxLength={LIMITS.codigo}
                  isInvalid={!!errors.codigo}
                />
                <Form.Control.Feedback type="invalid">{errors.codigo}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Tipo de Proyecto</Form.Label>
                <Form.Select
                  ref={refs.tipo_proyecto}
                  name="tipo_proyecto"
                  value={formData.tipo_proyecto}
                  onChange={handleChange}
                  isInvalid={!!errors.tipo_proyecto}
                >
                  <option value="">Seleccione Tipo Proyecto</option>
                  {tiposProyecto.map((t) => (
                    <option key={t.concepto} value={t.concepto}>
                      {t.concepto} - {t.nombre}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{errors.tipo_proyecto}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Nombre del Proyecto</Form.Label>
                <Form.Control
                  ref={refs.nombre}
                  name="nombre"
                  value={formData.nombre}
                  onChange={handleChange}
                  required
                  maxLength={LIMITS.nombre}
                  isInvalid={!!errors.nombre}
                />
                <Form.Control.Feedback type="invalid">{errors.nombre}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Actividad</Form.Label>
                <div className="d-flex">
                  <Form.Select
                    ref={refs.actividad}
                    name="actividad"
                    value={formData.actividad}
                    onChange={handleChange}
                    className="me-2"
                    isInvalid={!!errors.actividad}
                  >
                    <option value="">Seleccione Actividad</option>
                    {actividades.map((a) => (
                      <option key={a.concepto} value={a.concepto}>
                        {a.concepto} - {a.nombre}
                      </option>
                    ))}
                  </Form.Select>
                  <Button variant="success" type="button" onClick={() => setShowModal(true)}>
                    + Añadir
                  </Button>
                </div>
                <Form.Control.Feedback type="invalid">{errors.actividad}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Estado</Form.Label>
                <Form.Control
                  ref={refs.estado}
                  name="estado"
                  value={formData.estado}
                  onChange={handleChange}
                  maxLength={LIMITS.estado}
                  isInvalid={!!errors.estado}
                />
                <Form.Control.Feedback type="invalid">{errors.estado}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Consultor</Form.Label>
                <Form.Select
                  ref={refs.id_consultor}
                  name="id_consultor"
                  value={formData.id_consultor}
                  onChange={handleChange}
                  isInvalid={!!errors.id_consultor}
                  disabled={lockedConsultor}
                >
                  <option value="">Seleccione el Consultor</option>
                  {consultores.map((c) => (
                    <option key={c.id_consultor} value={c.id_consultor}>
                      {c.nombre}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{errors.id_consultor}</Form.Control.Feedback>

                {lockedConsultor && (
                  <Form.Text className="text-muted">
                    Se asignó automáticamente el consultor del usuario logueado
                    {consultorSeleccionado?.nombre ? `: ${consultorSeleccionado.nombre}` : ""}.
                  </Form.Text>
                )}
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Proponente</Form.Label>
                <Form.Select
                  ref={refs.id_proponente}
                  name="id_proponente"
                  value={formData.id_proponente}
                  onChange={handleChange}
                  isInvalid={!!errors.id_proponente}
                >
                  <option value="">Seleccione un Proponente</option>
                  {proponentes.map((p) => (
                    <option key={p.id_proponente} value={p.id_proponente}>
                      {p.nombre}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">{errors.id_proponente}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Sector</Form.Label>
                <div className="d-flex">
                  <Form.Select
                    ref={refs.sector}
                    name="sector"
                    value={formData.sector}
                    onChange={handleChange}
                    className="me-2"
                    isInvalid={!!errors.sector}
                  >
                    <option value="">Seleccione Sector</option>
                    {sectores.map((s) => (
                      <option key={s.concepto} value={s.concepto}>
                        {s.concepto} - {s.nombre}
                      </option>
                    ))}
                  </Form.Select>
                  <Button variant="success" type="button" onClick={() => setShowModalSector(true)}>
                    + Añadir
                  </Button>
                </div>
                <Form.Control.Feedback type="invalid">{errors.sector}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Fecha Inicio</Form.Label>
                <Form.Control
                  ref={refs.fecha_inicio}
                  type="date"
                  name="fecha_inicio"
                  value={formData.fecha_inicio}
                  onChange={handleChange}
                  isInvalid={!!errors.fecha_inicio}
                />
                <Form.Control.Feedback type="invalid">{errors.fecha_inicio}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Fecha Final</Form.Label>
                <Form.Control
                  ref={refs.fecha_final}
                  type="date"
                  name="fecha_final"
                  value={formData.fecha_final}
                  onChange={handleChange}
                  isInvalid={!!errors.fecha_final}
                />
                <Form.Control.Feedback type="invalid">{errors.fecha_final}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>Fecha Registro</Form.Label>
                <Form.Control
                  ref={refs.fecha_registro}
                  type="date"
                  name="fecha_registro"
                  value={formData.fecha_registro}
                  onChange={handleChange}
                  isInvalid={!!errors.fecha_registro}
                />
                <Form.Control.Feedback type="invalid">{errors.fecha_registro}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>Expediente Hídrico</Form.Label>
                <Form.Control
                  ref={refs.expediente_hidrico}
                  name="expediente_hidrico"
                  value={formData.expediente_hidrico}
                  onChange={handleChange}
                  maxLength={LIMITS.expediente_hidrico}
                  isInvalid={!!errors.expediente_hidrico}
                />
                <Form.Control.Feedback type="invalid">{errors.expediente_hidrico}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={12}>
              <Form.Group>
                <Form.Label>Ubicación (Lat/Lng)</Form.Label>

                <GoogleMapaCoordenadas
                  value={mapaValue}
                  onChange={(pos) => {
                    setFormData((prev) => ({
                      ...prev,
                      coordenada_x: pos?.lng != null ? String(pos.lng) : "",
                      coordenada_y: pos?.lat != null ? String(pos.lat) : "",
                    }));

                    setErrors((prev) => {
                      const copy = { ...prev };
                      delete copy.coordenada_x;
                      delete copy.coordenada_y;
                      return copy;
                    });
                  }}
                />

                <Form.Text className="text-muted">
                  Click en el mapa para colocar el punto. También podés usar “Mi ubicación”.
                </Form.Text>

                {(errors.coordenada_x || errors.coordenada_y) && (
                  <div className="mt-2">
                    {errors.coordenada_x ? <div className="text-danger small">• {errors.coordenada_x}</div> : null}
                    {errors.coordenada_y ? <div className="text-danger small">• {errors.coordenada_y}</div> : null}
                  </div>
                )}
              </Form.Group>
            </Col>
          </Row>

          <Row className="mb-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Departamento</Form.Label>
                <Form.Control
                  ref={refs.departamento}
                  name="departamento"
                  value={formData.departamento}
                  onChange={handleChange}
                  maxLength={LIMITS.dpto}
                  isInvalid={!!errors.departamento}
                />
                <Form.Control.Feedback type="invalid">{errors.departamento}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Distrito</Form.Label>
                <Form.Control
                  ref={refs.distrito}
                  name="distrito"
                  value={formData.distrito}
                  onChange={handleChange}
                  maxLength={LIMITS.distrito}
                  isInvalid={!!errors.distrito}
                />
                <Form.Control.Feedback type="invalid">{errors.distrito}</Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group>
                <Form.Label>Barrio/Localidad</Form.Label>
                <Form.Control
                  ref={refs.barrio}
                  name="barrio"
                  value={formData.barrio}
                  onChange={handleChange}
                  maxLength={LIMITS.barrio}
                  isInvalid={!!errors.barrio}
                />
                <Form.Control.Feedback type="invalid">{errors.barrio}</Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>Descripción</Form.Label>
            <Form.Control
              ref={refs.descripcion}
              as="textarea"
              rows={3}
              name="descripcion"
              value={formData.descripcion}
              onChange={handleChange}
              maxLength={LIMITS.descripcion}
              isInvalid={!!errors.descripcion}
            />
            <Form.Control.Feedback type="invalid">{errors.descripcion}</Form.Control.Feedback>
          </Form.Group>

          <fieldset className="border p-3 mb-3">
            <legend className="w-auto px-2">Información Catastral</legend>
            <Row>
              <Col md={3}>
                <Form.Group>
                  <Form.Label>Padrón</Form.Label>
                  <Form.Control
                    ref={refs.padron}
                    name="padron"
                    value={formData.padron}
                    onChange={handleChange}
                    maxLength={LIMITS.padron}
                    isInvalid={!!errors.padron}
                  />
                  <Form.Control.Feedback type="invalid">{errors.padron}</Form.Control.Feedback>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>Cta. Cte.</Form.Label>
                  <Form.Control
                    ref={refs.cta_cte}
                    name="cta_cte"
                    value={formData.cta_cte}
                    onChange={handleChange}
                    maxLength={LIMITS.cta_cte}
                    isInvalid={!!errors.cta_cte}
                  />
                  <Form.Control.Feedback type="invalid">{errors.cta_cte}</Form.Control.Feedback>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>Finca</Form.Label>
                  <Form.Control
                    ref={refs.finca}
                    name="finca"
                    value={formData.finca}
                    onChange={handleChange}
                    maxLength={LIMITS.finca}
                    isInvalid={!!errors.finca}
                  />
                  <Form.Control.Feedback type="invalid">{errors.finca}</Form.Control.Feedback>
                </Form.Group>
              </Col>

              <Col md={3}>
                <Form.Group>
                  <Form.Label>Matrícula</Form.Label>
                  <Form.Control
                    ref={refs.matricula}
                    name="matricula"
                    value={formData.matricula}
                    onChange={handleChange}
                    maxLength={LIMITS.matricula}
                    isInvalid={!!errors.matricula}
                  />
                  <Form.Control.Feedback type="invalid">{errors.matricula}</Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>
          </fieldset>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" type="button" onClick={() => navigate("/proyectos")}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Guardar
            </Button>
          </div>
        </Form>
      </Container>

      {showModal && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Nueva Actividad</h5>
                <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
              </div>

              <div className="modal-body">
                <Form.Group>
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    value={nuevaActividad}
                    onChange={(e) => setNuevaActividad(e.target.value)}
                    placeholder="Ingrese el nombre de la nueva actividad"
                    maxLength={LIMITS.actividad}
                  />
                  <Form.Text className="text-muted">
                    El ID (concepto) se asignará automáticamente como un número correlativo.
                  </Form.Text>
                </Form.Group>
              </div>

              <div className="modal-footer">
                <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" type="button" onClick={agregarActividad}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModalSector && (
        <div className="modal d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Nuevo Sector</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowModalSector(false);
                    setNuevoSectorId("");
                    setNuevoSectorNombre("");
                  }}
                />
              </div>

              <div className="modal-body">
                <Form.Group className="mb-3">
                  <Form.Label>ID (concepto)</Form.Label>
                  <Form.Control
                    value={nuevoSectorId}
                    onChange={(e) => setNuevoSectorId(e.target.value.replace(/\s+/g, ""))}
                    placeholder="Ej: SEC_01 o AREA-VERDE"
                    inputMode="text"
                    pattern="[A-Za-z0-9_-]+"
                    title='Usa letras, números, "-" o "_" (sin espacios).'
                    maxLength={LIMITS.sector_proyecto}
                  />
                  <Form.Text className="text-muted">
                    Alfanumérico; se guardará como <code>concepto</code>.
                  </Form.Text>
                </Form.Group>

                <Form.Group>
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    value={nuevoSectorNombre}
                    onChange={(e) => setNuevoSectorNombre(e.target.value)}
                    placeholder="Ingrese el nombre del nuevo sector"
                    maxLength={LIMITS.sector_proyecto}
                  />
                </Form.Group>
              </div>

              <div className="modal-footer">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setShowModalSector(false);
                    setNuevoSectorId("");
                    setNuevoSectorNombre("");
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" type="button" onClick={agregarSector}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}