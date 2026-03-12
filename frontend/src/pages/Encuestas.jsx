// src/pages/Encuestas.jsx
import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  Row,
  Col,
  Form,
  Button,
  Alert,
  Spinner,
  Table,
  Modal,
} from "react-bootstrap";
import * as XLSX from "xlsx";
import Swal from "sweetalert2";
import "@/styles/tramos.css";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

// Toast genérico para este módulo
const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
});

/* ==== helpers auth/fetch ==== */
const authHeaders = () => {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const token = t ? String(t).trim().replace(/^Bearer\s+/i, "") : "";
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const redirect401 = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/login");
};

// Limpia el mensaje del backend (error/message o texto plano)
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return null;
  }

  if (!res.ok) {
    let text = await res.text();
    let msg = text;

    try {
      const j = JSON.parse(text);
      msg = j.error || j.message || text;
    } catch {
      // no era JSON
    }
    throw new Error(msg);
  }

  return res.json();
};

// ───────── helpers de normalización (igual que antes) ─────────
const normalizeHeader = (txt = "") =>
  String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const toSnake = (txt = "") =>
  String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();

const parseBoolean = (v) => {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["si", "sí", "s", "yes", "y", "true", "1", "✓", "x"].includes(s))
    return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
};

const excelSerialToDate = (serial) => {
  if (serial == null || serial === "") return null;
  const n = Number(serial);
  if (!isNaN(n)) {
    const utcDays = n - 25569;
    const ms = utcDays * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(serial).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [dd, mm, yy] = s.split("/");
    const yyyy = yy.length === 2 ? "20" + yy : yy;
    const iso = new Date(+yyyy, +mm - 1, +dd);
    if (!isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  }
  return s || null;
};

const parseNumberFlexible = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  s = s.replace(/\s/g, "").replace(/\./g, "");
  s = s.replace(/,/, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const IGNORE_HEADERS = new Set([
  "VALIDATION_STATUS",
  "NOTES",
  "STATUS",
  "SUBMITTED_BY",
  "TAGS",
  "INDEX",
]);
const DATE_FIELDS = new Set(["fecha_relevamiento", "fecha_nacimiento"]);
const NUMERIC_FIELDS = new Set([
  "familias_en_predio",
  "cant_personas",
  "menores_18",
  "menores_escolarizados",
  "menores_0_5",
  "adultos_18_64",
  "adultos_65_mas",
  "total_mujeres",
  "total_hombres",
  "embarazadas",
  "personas_discapacidad",
  "personas_req_esp_salud",
  "personal_negocio",
  "miembros_familia_en_negocio",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "gps_precision",
  "coor_x",
  "coor_y",
  "kobo_numeric_id",
]);
const BOOLEAN_FIELDS = new Set([
  "realiza_actividad_economica",
  "medio_subsistencia_familiares",
  "medio_subsistencia_subsidio",
  "medio_subsistencia_jubilacion",
  "medio_subsistencia_ahorros",
  "medio_subsistencia_sin_ingresos",
  "medio_subsistencia_otro",
  "instalaciones_no_posee",
  "instalaciones_huerta",
  "instalaciones_vivero",
  "instalaciones_corral",
  "instalaciones_otros",
  "instalaciones_otra_vivienda",
  "posee_animales",
  "posee_animales_domesticos",
  "animales_domesticos",
  "energia_electrica",
  "agua_potable",
  "alcantarillado",
  "sistema_excretas",
  "pertenece_comision",
  "interes_reubicacion",
  "cerrado",
  "tiene_ci",
  "cuenta_con_ci",
  "animal_domestico_ave",
  "animal_domestico_conejo",
  "animal_domestico_gato",
  "animal_domestico_otros",
  "animal_domestico_peces",
  "animal_domestico_perro",
  "animal_domestico_tortuga",
]);

const header_map = {
  START: "kobo_start",
  END: "kobo_end",
  SUBMISSION_TIME: "kobo_submission_time",
  USERNAME: "kobo_username",
  DEVICEID: "kobo_deviceid",
  PHONENUMBER: "kobo_phonenumber",
  ID: "kobo_numeric_id",
  UUID: "kobo_uuid",
  VERSION: "kobo_form_uuid",
  START_GEOPOINT: "coordenadas_gps",
  START_GEOPOINT_LATITUDE: "gps_latitude",
  START_GEOPOINT_LONGITUDE: "gps_longitude",
  START_GEOPOINT_ALTITUDE: "gps_altitude",
  START_GEOPOINT_PRECISION: "gps_precision",
  NOMBRE_DEL_CENSISTA: "nombre_censista",
  TRAMO: "tramo",
  FECHA_DEL_RELEVAMIENTO: "fecha_relevamiento",
  CODIGO: "codigo",
  AFECTACION: "afectacion",
  CIUDAD: "ciudad",
  BARRIO: "barrio",
  TIPO_DE_INMUEBLE: "tipo_inmueble",
  NOMBRE_Y_APELLIDO: "nombre_apellido",
  CUENTA_CON_CEDULA_DE_IDENTIDAD: "cuenta_con_ci",
  ESPECIFICAR_CI: "especificar_otro_documento",
  N_DE_C_I: "ci",
  N_DE_TELEFONO: "telefono",
  FECHA_DE_NACIMIENTO: "fecha_nacimiento",
  NACIONALIDAD: "es_paraguayo",
  NACIONALIDAD_OTROS: "lugar_origen",
  TIEMPO_DE_ARRAIGO_EN_EL_PREDIO: "tiempo_arraigo",
  ESPECIFICAR_ANOS: "especificar_anhos",
  REALIZA_ALGUNA_ACTIVIDAD_ECONOMICA: "realiza_actividad_economica",
  OCUPACION_RUBRO: "ocupacion",
  ESPECIFICAR_RUBRO: "ocupacion_otro",
  CANTIDAD_DE_PERSONAS_QUE_VIVEN_EN_LA_CASA: "cant_personas",
  N_DE_MENORES_DE_18_ANOS: "menores_18",
  CANTIDAD_DE_MENORES_ESCOLARIZADOS: "menores_escolarizados",
  N_DE_MENORES_ENTRE_0_Y_5_ANOS: "menores_0_5",
  N_DE_ADULTOS_DE_18_A_64_ANOS: "adultos_18_64",
  N_DE_ADULTOS_MAYORES_A_64_ANOS: "adultos_65_mas",
  N_TOTAL_DE_MUJERES: "total_mujeres",
  N_TOTAL_DE_HOMBRES: "total_hombres",
  N_DE_EMBARAZADAS: "embarazadas",
  N_DE_PERSONAS_CON_DISCAPACIDAD: "personas_discapacidad",
  N_DE_PERSONAS_CON_REQUERIMIENTOS_ESPECIALES_DE_ATENCION_DE_SALUD:
    "personas_req_esp_salud",
  MEDIO_DE_SUBSISTENCIA: "medio_subsistencia",
  MEDIO_DE_SUBSISTENCIA_AYUDA_ECONOMICA_DE_FAMILIARES_U_OTRAS_PERSONAS:
    "medio_subsistencia_familiares",
  MEDIO_DE_SUBSISTENCIA_SUBSIDIOS_O_PROGRAMA_SOCIAL_DEL_ESTADO:
    "medio_subsistencia_subsidio",
  MEDIO_DE_SUBSISTENCIA_JUBILACION_O_PENSION: "medio_subsistencia_jubilacion",
  MEDIO_DE_SUBSISTENCIA_VIVE_DE_AHORROS: "medio_subsistencia_ahorros",
  MEDIO_DE_SUBSISTENCIA_NO_RECIBE_INGRESOS_ACTUALMENTE:
    "medio_subsistencia_sin_ingresos",
  MEDIO_DE_SUBSISTENCIA_OTRO: "medio_subsistencia_otro",
  ESPECIFICAR_SUBSISTENCIA: "especificar_medio",
  CARACTERISTICAS_DEL_PREDIO_Y_SERVICIOS_BASICOS: "caracteristicas_predio",
  ESPECIFICAR_PREDIO: "especificar_predio",
  N_DE_FAMILIAS_EN_EL_PREDIO: "familias_en_predio",
  ESPECIFICAR_N_FAMILIA_PREDIO: "especificar_otros_familias",
  CONDICION_DE_LA_OCUPACION: "condicion_ocupacion",
  ESPECIFICAR: "condicion_ocupacion_detalle",
  POSEE_DOCUMENTO_DEL_TERRENO: "posee_documento",
  ESPECIFICAR_DOC_TERRENO: "documento_terreno_detalle",
  PAREDES: "paredes",
  ESPECIFICAR_PAREDES: "especificar_otros_paredes",
  TIPO_DE_TECHO: "tipo_techo",
  OTROS: "especificar_otros_techo",
  TIPO_DE_PISO: "tipo_piso",
  ESPECIFICAR_PISO: "especificar_otros_piso",
  CONDICION_DE_LA_ESTRUCTURA: "condicion_estructura",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO: "otras_instalaciones",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_NO_POSEE_OTRAS_INSTALACIONES_EN_EL_PREDIO:
    "instalaciones_no_posee",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_HUERTA: "instalaciones_huerta",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_VIVERO: "instalaciones_vivero",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_CORRAL: "instalaciones_corral",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_OTROS: "instalaciones_otros",
  OTRAS_INSTALACIONES_EN_EL_TERRENO_O_PREDIO_OTRA_VIVIENDA:
    "instalaciones_otra_vivienda",
  ESPECIFICAR_OTRAS_INSTALACIONES: "especificar_otras_instalaciones",
  FINALIDAD_DE_INSTALACION: "finalidad_instalacion",
  ESPECIFICAR_OTRAS_FINALIDADES_INSTALACIONES: "especificar_otras_finalidades",
  POSEE_ANIMALES_DE_GRANJA: "posee_animales",
  POSEE_ANIMALES_DOMESTICOS: "posee_animales_domesticos",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO: "tipo_animal_domestico",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_PERRO: "animal_domestico_perro",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_GATO: "animal_domestico_gato",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_AVE: "animal_domestico_ave",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_CONEJO: "animal_domestico_conejo",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_TORTUGA: "animal_domestico_tortuga",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_PECES: "animal_domestico_peces",
  ESPECIFICAR_TIPO_DE_ANIMAL_DOMESTICO_OTROS: "animal_domestico_otros",
  ESPECIFICAR_ANIMALES: "animal_domestico_otros_detalle",
  DISPONE_DE_ENERGIA_ELECTRICA: "energia_electrica",
  DISPONE_DE_AGUA_POTABLE: "agua_potable",
  DISPONE_DE_SISTEMA_DE_ALCANTARILLADO_O_SISTEMA_DE_ELIMINACION_DE_EXCRETAS:
    "alcantarillado",
  FUENTE_DEL_INGRESO: "fuente_ingreso",
  INGRESO_MENSUAL: "ingreso_mensual",
  EGRESO_MENSUAL: "egreso_mensual",
  PRINCIPALES_GASTOS_MENSUALES: "gastos_mensuales_principales",
  OTROS_GASTOS: "otros_gastos",
  ESPECIFICAR_OTRO: "especificar_otro_gasto",
  INGRESO_MENSUAL_APROXIMADO_DEL_COMERCIO: "ingreso_mensual_comercio",
  INGRESO_MENSUAL_APROXIMADO_DEL_COMERCIO_MICROEMPRESA:
    "ingreso_mensual_microempresa",
  CANTIDAD_DE_PERSONAL_EN_SU_NEGOCIO: "personal_negocio",
  NEGOCIO_FAMILIAR_O_NO_FAMILIAR: "negocio_familiar",
  CUANTOS_MIEMBROS_DE_LA_FAMILIA_TRABAJA_EN_EL_NEGOCIO:
    "miembros_familia_en_negocio",
  FUENTE_DE_INGRESO_ADICIONAL: "fuente_ingreso_adicional",
  ESPECIFICAR_FUENTE_DEL_INGRESO_ADICIONAL: "especificar_fuente_adicional",
  PERTENECE_A_ALGUNA_COMISION_U_ORGANIZACION: "pertenece_comision",
  ESPECIFICAR_COMISION_U_ORGANIZACION: "especificar_comision",
  ASPECTOS_POSITIVOS_QUE_USTED_RESCATA_DEL_PROYECTO: "aspectos_positivos",
  ESTARIA_INTERESADO_EN_LA_REUBICACION_DE_SU_CASILLA_LOCAL:
    "interes_reubicacion",
  OBSERVACIONES_GENERALES: "observaciones",
  PERCEPCION_DEL_CENSISTA: "percepcion",
  REGISTRO_FOTOGRAFICO_1: "foto_1",
  REGISTRO_FOTOGRAFICO_1_URL: "foto_1_url",
  REGISTRO_FOTOGRAFICO_2: "foto_2",
  REGISTRO_FOTOGRAFICO_2_URL: "foto_2_url",
  REGISTRO_FOTOGRAFICO_3: "foto_3",
  REGISTRO_FOTOGRAFICO_3_URL: "foto_3_url",
  COORDENADAS_GPS: "coordenadas_gps",
  COORDENADAS_GPS_LATITUDE: "gps_latitude",
  COORDENADAS_GPS_LONGITUDE: "gps_longitude",
  COORDENADAS_GPS_ALTITUDE: "gps_altitude",
  COORDENADAS_GPS_PRECISION: "gps_precision",
  PROGRESIVAS: "progresivas",
  COORDENADA_X: "coor_x",
  COORDENADA_Y: "coor_y",
  ID_PROYECTO: "id_proyecto",
};

function mapearCoordenadas(raw, obj) {
  const rawNorm = {};
  for (const [k, v] of Object.entries(raw)) rawNorm[normalizeHeader(k)] = v;
  if (obj.coor_x != null && obj.coor_y != null) return;

  const rx = rawNorm["COORDENADA_X"];
  const ry = rawNorm["COORDENADA_Y"];

  const tryPair = (a, b) => {
    const ax = parseNumberFlexible(a);
    const by = parseNumberFlexible(b);
    if (ax != null && by != null) {
      obj.coor_x = ax;
      obj.coor_y = by;
      return true;
    }
    return false;
  };

  if (rx != null && ry != null && tryPair(rx, ry)) return;

  const trySplit = (val) => {
    if (val == null) return false;
    const s = String(val).trim();
    const parts = s.includes(",") ? s.split(",") : s.split(/\s+/);
    if (parts.length === 2) return tryPair(parts[0], parts[1]);
    return false;
  };

  if (rx != null && trySplit(rx)) return;
  if (ry != null && trySplit(ry)) return;

  if (obj.gps_latitude != null && obj.gps_longitude != null) {
    const lon = parseNumberFlexible(obj.gps_longitude);
    const lat = parseNumberFlexible(obj.gps_latitude);
    if (lon != null && lat != null) {
      obj.coor_x = lon;
      obj.coor_y = lat;
    }
  }
}

const normalizeRow = (raw, proyectoId, tramoId) => {
  const obj = {
    id_proyecto: parseInt(proyectoId, 10),
    id_tramo: tramoId != null ? parseInt(tramoId, 10) : undefined,
    __original_row_number: raw.__original_row_number,
  };

  if (raw.nombre_y_apellido && !raw.nombre_apellido)
    raw.nombre_apellido = raw.nombre_y_apellido;
  if (raw["N° DE C.I."] && !raw.ci) raw.ci = raw["N° DE C.I."];
  if (raw["N° DE TELÉFONO"] && !raw.telefono)
    raw.telefono = raw["N° DE TELÉFONO"];
  if (raw.negocio_familiar_o_no_familiar)
    raw.negocio_familiar = raw.negocio_familiar_o_no_familiar;

  const hasCaractPredio = Object.keys(raw).some((k) =>
    /CARACTER[ÍI]STICAS.*PREDIO/i.test(k)
  );
  if (hasCaractPredio && raw.ESPECIFICAR && !raw.especificar_predio) {
    raw.especificar_predio = raw.ESPECIFICAR;
  }

  const anyKeyActividad = Object.keys(raw).find((k) =>
    /REALIZA.*ACTIVIDAD.*ECONOMICA/i.test(k)
  );
  if (
    anyKeyActividad &&
    raw[anyKeyActividad] != null &&
    raw.realiza_actividad_economica == null
  ) {
    raw.realiza_actividad_economica = raw[anyKeyActividad];
  }

  for (const [key, value] of Object.entries(raw)) {
    if (["id_proyecto", "id_tramo", "__original_row_number"].includes(key))
      continue;
    const norm = normalizeHeader(key);
    if (IGNORE_HEADERS.has(norm)) continue;

    const target = header_map[norm] || toSnake(key);
    let final = value === "" ? null : value;

    if (BOOLEAN_FIELDS.has(target)) final = parseBoolean(final);
    else if (DATE_FIELDS.has(target)) final = excelSerialToDate(final);
    else if (NUMERIC_FIELDS.has(target)) final = parseNumberFlexible(final);
    else if (typeof final === "string") {
      const maybeBool = parseBoolean(final);
      if (maybeBool !== null) final = maybeBool;
    }

    if (target === "ci" && final != null) final = String(final).trim();
    obj[target] = final;
  }

  mapearCoordenadas(raw, obj);
  if (typeof obj.alcantarillado === "boolean" && obj.sistema_excretas == null) {
    obj.sistema_excretas = obj.alcantarillado;
  }
  return obj;
};

function formatValue(val) {
  if (val == null) return null;
  if (typeof val === "boolean") return val ? "SI" : "NO";
  return val;
}

/* =========================
   PERMISOS
========================= */
function getUserPerms() {
  try {
    const u = JSON.parse(localStorage.getItem("user") || "null");
    return Array.isArray(u?.perms) ? u.perms : [];
  } catch {
    return [];
  }
}
function canPerm(perms, p) {
  return Array.isArray(perms) && perms.includes(p);
}

/* =========================
   MODAL EDICION DINAMICO
========================= */
const READONLY_KEYS = new Set([
  "id_encuesta",
  "id_proyecto",
  "id_tramo",
  "geom",
  "geometry",
  "geojson",
  "created_at",
  "updated_at",
  "deleted_at",
]);

function guessFieldType(key, value) {
  if (READONLY_KEYS.has(key)) return "readonly";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";

  // fechas típicas
  if (String(key).toLowerCase().includes("fecha")) return "date";

  const s = value == null ? "" : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
  if (/^(true|false|si|sí|no)$/i.test(s)) return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(s)) return "number";

  // textos largos
  if (s.length > 80) return "textarea";
  return "text";
}

function prettyLabel(k) {
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/* =========================
   COMPONENTE
========================= */
export default function Encuestas() {
  const { id, tramoId } = useParams();
  const navigate = useNavigate();

  const perms = useMemo(() => getUserPerms(), []);
  const canUpdate = useMemo(() => canPerm(perms, "encuestas.update"), [perms]);

  const [file, setFile] = useState(null);
  const [previewRaw, setPreviewRaw] = useState([]);
  const [previewMapped, setPreviewMapped] = useState([]);
  const [importPayload, setImportPayload] = useState([]);
  const [encuestas, setEncuestas] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [importWarnings, setImportWarnings] = useState([]);
  const [localWarnings, setLocalWarnings] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // nombre del tramo
  const [nombreTramo, setNombreTramo] = useState("");

  // modal view/edit
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("view"); // "view" | "edit"
  const [encuestaSeleccionada, setEncuestaSeleccionada] = useState(null);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  // ---- cargar encuestas + nombre tramo
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(
          `${API_URL}/encuestas/proyecto/${id}/tramo/${tramoId}`,
          { headers: { ...authHeaders() } }
        );
        const data = await jsonOrRedirect401(r);
        if (!data) return;
        const rows = Array.isArray(data) ? data : data.data || [];
        setEncuestas(rows);
      } catch (err) {
        const msg = err.message || "No se pudieron cargar las encuestas.";
        setError(msg);
        Toast.fire({ icon: "error", title: msg });
      }
    })();

    (async () => {
      try {
        const r = await fetch(`${API_URL}/tramos/proyectos/${id}/tramos`, {
          headers: { ...authHeaders() },
        });
        const list = await jsonOrRedirect401(r);
        if (!list) return;
        const t = (Array.isArray(list) ? list : []).find(
          (x) => String(x.id_tramo) === String(tramoId)
        );
        if (t?.nombre_tramo) setNombreTramo(t.nombre_tramo);
      } catch {
        // silencio
      }
    })();
  }, [id, tramoId, mensaje]);

  // ---- abrir modal (view/edit) desde tabla o desde MAPA (global)
  const openEncuestaModal = async (encuesta, mode = "view") => {
    if (!encuesta) return;

    // Si me pasaron solo id_encuesta, traigo el detalle
    let full = encuesta;
    const idEnc = encuesta?.id_encuesta ?? encuesta?.id ?? null;

    try {
      if (idEnc && (mode === "edit" || Object.keys(encuesta).length < 10)) {
        const r = await fetch(`${API_URL}/encuestas/${idEnc}`, {
          headers: { ...authHeaders() },
        });
        const data = await jsonOrRedirect401(r);
        if (data) full = data?.row || data?.data?.row || data?.data || data;
      }
    } catch {
      // si falla igual abrimos con lo que haya
    }

    const fixed = {
      ...(full || {}),
      id_encuesta: idEnc ?? full?.id_encuesta,
      id_proyecto: full?.id_proyecto ?? Number(id),
      id_tramo: full?.id_tramo ?? Number(tramoId),
    };

    setEncuestaSeleccionada(fixed);
    setModalMode(mode === "edit" ? "edit" : "view");
    setFormData(fixed);
    setModalOpen(true);
  };

  // Exponer global para el MAPA
  useEffect(() => {
    window.__openEncuestaModal = openEncuestaModal;
    return () => {
      try {
        delete window.__openEncuestaModal;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tramoId]);

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEncuestaSeleccionada(null);
    setFormData({});
    setModalMode("view");
  };

  const handleChange = (key, type) => (e) => {
    if (type === "boolean") {
      setFormData((p) => ({ ...p, [key]: !!e.target.checked }));
      return;
    }
    let v = e.target.value;

    if (type === "number") {
      const n = parseNumberFlexible(v);
      setFormData((p) => ({ ...p, [key]: n }));
      return;
    }
    if (type === "date") {
      setFormData((p) => ({ ...p, [key]: v || null }));
      return;
    }

    setFormData((p) => ({ ...p, [key]: v }));
  };

  const guardarCambios = async () => {
    const idEnc = formData?.id_encuesta;
    if (!idEnc) return;

    if (!canUpdate) {
      Toast.fire({ icon: "error", title: "No tenés permiso para editar encuestas." });
      return;
    }

    // armamos payload sin keys readonly
    const payload = {};
    for (const [k, v] of Object.entries(formData || {})) {
      if (READONLY_KEYS.has(k)) continue;
      payload[k] = v;
    }

    setSaving(true);
    setError("");
    setMensaje("");
    try {
      const r = await fetch(`${API_URL}/encuestas/${idEnc}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await jsonOrRedirect401(r);
      if (!data) return;

      Toast.fire({ icon: "success", title: "Encuesta actualizada" });
      setMensaje("Encuesta actualizada correctamente.");

      // update local (optimista)
      setEncuestas((prev) =>
        prev.map((x) => (String(x.id_encuesta) === String(idEnc) ? { ...x, ...payload } : x))
      );

      closeModal();
    } catch (err) {
      const msg = err.message || "No se pudo actualizar la encuesta.";
      setError(msg);
      Toast.fire({ icon: "error", title: msg });
    } finally {
      setSaving(false);
    }
  };

  // ---- importación (igual que antes)
  const [useDebug, setUseDebug] = useState(false);

  const handleFileChange = async (e) => {
    setMensaje("");
    setError("");
    setImportWarnings([]);
    setLocalWarnings([]);
    setConfirmOpen(false);
    setPreviewRaw([]);
    setPreviewMapped([]);
    setImportPayload([]);

    const f = e.target.files[0];
    if (!f) return;
    setFile(f);

    try {
      const arrayBuffer = await f.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (!Array.isArray(raw) || !raw.length) {
        const msg =
          "El Excel no contiene filas válidas o el encabezado no está bien ubicado.";
        setError(msg);
        Toast.fire({ icon: "warning", title: msg });
        return;
      }

      const mappedRows = raw.map((row, idx) => {
        const withRowNum = { ...row, __original_row_number: idx + 2 };
        const normalized = normalizeRow(withRowNum, id, tramoId);

        const required = ["nombre_apellido", "ci", "tramo"];
        const missing = required.filter((f) => normalized[f] == null);
        if (missing.length) {
          normalized.__validation_missing = missing;
          setLocalWarnings((prev) => [
            ...prev,
            { row: normalized.__original_row_number, issue: `Faltan campos: ${missing.join(", ")}` },
          ]);
        }
        return normalized;
      });

      setPreviewRaw(raw.slice(0, 5));
      setPreviewMapped(mappedRows.slice(0, 5));
      setImportPayload(mappedRows);
      setConfirmOpen(true);

      Toast.fire({
        icon: "info",
        title: `Archivo "${f.name}" listo. Filas: ${mappedRows.length}.`,
      });
    } catch (err) {
      const msg = err.message || "Error al procesar el archivo Excel.";
      setError(msg);
      Toast.fire({ icon: "error", title: msg });
    }
  };

  const ejecutarImportacion = async () => {
    setError("");
    setMensaje("");
    setImportWarnings([]);
    if (!file) {
      const msg = "No hay archivo seleccionado.";
      setError(msg);
      Toast.fire({ icon: "warning", title: msg });
      return;
    }
    if (!importPayload.length) {
      const msg = "No hay datos mapeados para importar.";
      setError(msg);
      Toast.fire({ icon: "warning", title: msg });
      return;
    }

    setCargando(true);
    try {
      const chunkSize = 300;
      let totalInserted = 0,
        totalSkippedByTramo = 0,
        totalSkippedByCI = 0;
      let allWarnings = [];

      for (let i = 0; i < importPayload.length; i += chunkSize) {
        const batch = importPayload.slice(i, i + chunkSize);
        const url = `${API_URL}/encuestas/importar-json/${id}${
          useDebug ? "?debug=true" : ""
        }`;

        const res = await fetch(url, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ encuestas: batch }),
        });

        let data = {};
        try {
          data = await res.json();
        } catch {}

        const isSoftEmpty =
          data?.error === "Ninguna encuesta válida para insertar" ||
          data?.message ===
            "No se importó ninguna encuesta: todas estaban duplicadas por CI.";

        if (!res.ok && !isSoftEmpty) {
          const msg =
            data?.error ||
            data?.message ||
            `Error en batch ${i / chunkSize + 1}`;
          throw new Error(msg);
        }

        totalInserted += Number(data?.inserted ?? 0);
        totalSkippedByTramo += Number(data?.skippedByTramo ?? 0);
        totalSkippedByCI += Number(data?.skippedByCI ?? 0);

        if (Array.isArray(data?.warnings)) {
          allWarnings.push(
            ...data.warnings.map((w) => ({ ...w, batch: i / chunkSize + 1 }))
          );
        }
      }

      const summary =
        `Importación OK. Importadas: ${totalInserted}. ` +
        `Omitidas por TRAMO: ${totalSkippedByTramo}. ` +
        `Duplicadas por CI: ${totalSkippedByCI}.`;

      setMensaje(summary);
      Toast.fire({ icon: "success", title: summary });

      if (allWarnings.length) {
        setImportWarnings(allWarnings);
        Toast.fire({
          icon: "warning",
          title: `Importación con ${allWarnings.length} advertencias`,
        });
      }

      setFile(null);
      setConfirmOpen(false);
    } catch (err) {
      const msg = err.message || "Error en importación";
      setError(msg);
      Toast.fire({ icon: "error", title: msg });
    } finally {
      setCargando(false);
    }
  };

  const eliminarEncuestasDelTramo = async () => {
    setError("");
    setDeleting(true);
    try {
      const res = await fetch(
        `${API_URL}/encuestas/proyecto/${id}/tramo/${tramoId}`,
        { method: "DELETE", headers: { ...authHeaders() } }
      );
      const data = await jsonOrRedirect401(res);
      if (!data) return;

      const msg = `Se eliminaron ${data.deleted ?? 0} encuestas del tramo.`;
      setMensaje(msg);
      Toast.fire({ icon: "success", title: msg });
      setError("");
    } catch (err) {
      const msg = err.message || "Error al eliminar encuestas del tramo.";
      setError(msg);
      Toast.fire({ icon: "error", title: msg });
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  // render modal form dinámico (solo en edit)
  const renderEditFields = () => {
    const base = formData || {};
    const keys = Object.keys(base).filter((k) => !READONLY_KEYS.has(k));

    // ordena: primero campos "clave"
    const priority = [
      "nombre_apellido",
      "ci",
      "telefono",
      "ciudad",
      "barrio",
      "ocupacion",
      "percepcion",
      "afectacion",
      "tramo",
      "progresivas",
      "coor_x",
      "coor_y",
    ];
    keys.sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });

    return (
      <div className="d-grid gap-2">
        {keys.map((k) => {
          const v = base[k];
          const type = guessFieldType(k, v);
          if (type === "readonly") return null;

          return (
            <Form.Group key={k} className="mb-2">
              <Form.Label style={{ fontWeight: 700, fontSize: 13 }}>
                {prettyLabel(k)}
              </Form.Label>

              {type === "boolean" ? (
                <Form.Check
                  type="switch"
                  checked={!!v}
                  onChange={handleChange(k, "boolean")}
                  label={!!v ? "SI" : "NO"}
                />
              ) : type === "textarea" ? (
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={v ?? ""}
                  onChange={handleChange(k, "textarea")}
                />
              ) : (
                <Form.Control
                  type={type === "date" ? "date" : type === "number" ? "text" : "text"}
                  value={v ?? ""}
                  onChange={handleChange(k, type)}
                />
              )}
            </Form.Group>
          );
        })}
      </div>
    );
  };

  return (
    <Container className="mt-4">
      {/* Top bar */}
      <Row className="mb-3 align-items-center">
        <Col>
          <h4 className="mb-0">
            Encuestas del Tramo{" "}
            {nombreTramo ? `“${nombreTramo}”` : `#${tramoId}`}
          </h4>
        </Col>
        <Col className="text-end">
          <button
            type="button"
            className="btn btn-warning btn-sm w-auto d-inline-flex align-items-center gap-2 px-3 py-1 shadow-sm"
            onClick={() => navigate(`/proyectos/${id}/tramos`)}
          >
            ← Volver a Tramos
          </button>

          <button
            type="button"
            className="btn btn-ghost-danger ms-2"
            disabled={deleting}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            {deleting ? (
              <Spinner animation="border" size="sm" />
            ) : (
              "Eliminar encuestas del tramo"
            )}
          </button>
        </Col>
      </Row>

      {/* Toolbar de import */}
      <Form className="toolbar-enhanced">
        <Row className="align-items-end g-3 mb-3">
          <Col md={6}>
            <Form.Group controlId="formFile">
              <Form.Label>Seleccionar archivo Excel</Form.Label>
              <Form.Control type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Check
              type="switch"
              id="debug-switch"
              label="Debug"
              checked={useDebug}
              onChange={(e) => setUseDebug(e.target.checked)}
            />
          </Col>
          <Col md={4} className="text-end">
            <button
              type="button"
              className="btn-new-tramo"
              disabled={!confirmOpen || cargando}
              onClick={ejecutarImportacion}
            >
              {cargando ? "Importando…" : "Importar mapeado"}
            </button>
          </Col>
        </Row>
      </Form>

      {mensaje && <Alert variant="success">{mensaje}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}

      {/* Previews */}
      {confirmOpen && (
        <Row className="mb-4">
          <Col>
            <h5>Preview antes de importar</h5>

            <p>
              <strong>Raw (bruto):</strong>
            </p>
            <Table striped bordered size="sm">
              <thead>
                <tr>
                  {previewRaw[0] &&
                    Object.keys(previewRaw[0]).map((k) => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRaw.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td key={j}>{v?.toString?.()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>

            <p>
              <strong>Mapeado:</strong> (incluye <em>fila original</em> y validaciones)
            </p>
            <Table striped bordered size="sm">
              <thead>
                <tr>
                  {previewMapped[0] &&
                    Object.keys(previewMapped[0]).map((k) => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewMapped.map((row, i) => (
                  <tr key={i}>
                    {Object.entries(row).map(([k, v], j) => (
                      <td key={j}>
                        {typeof v === "boolean" ? (v ? "SI" : "NO") : (v ?? "").toString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Col>
        </Row>
      )}

      {(localWarnings.length > 0 || importWarnings.length > 0) && (
        <Alert variant="warning">
          <h6>Advertencias:</h6>
          <ul style={{ maxHeight: 250, overflowY: "auto" }}>
            {localWarnings.map((w, i) => (
              <li key={`local-${i}`}>
                Fila {w.row}: {w.issue}
              </li>
            ))}
            {importWarnings.map((w, i) => (
              <li key={`import-${i}`}>
                Fila {w.row} campo <strong>{w.field}</strong>: {w.issue}
                {w.batch !== undefined && <> (batch {w.batch})</>}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* TABLA */}
      <Table striped bordered hover size="sm">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>CI</th>
            <th>Teléfono</th>
            <th>Ciudad</th>
            <th style={{ width: 160 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {encuestas.map((enc) => (
            <tr key={enc.id_encuesta}>
              <td>{enc.nombre_apellido}</td>
              <td>{enc.ci}</td>
              <td>{enc.telefono}</td>
              <td>{enc.ciudad}</td>
              <td className="d-flex gap-2">
                <Button size="sm" onClick={() => openEncuestaModal(enc, "view")}>
                  Ver
                </Button>

                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={!canUpdate}
                  title={!canUpdate ? "Sin permiso encuestas.update" : "Editar"}
                  onClick={() => openEncuestaModal(enc, "edit")}
                >
                  Editar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* Confirmación eliminar por tramo */}
      <Modal
        show={confirmDeleteOpen}
        onHide={() => !deleting && setConfirmDeleteOpen(false)}
        centered
      >
        <Modal.Header closeButton={!deleting}>
          <Modal.Title>Eliminar encuestas del tramo</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Esta acción eliminará <strong>todas</strong> las encuestas del{" "}
          <strong>{nombreTramo || `#${tramoId}`}</strong> en el proyecto{" "}
          <strong>{id}</strong>. ¿Confirmás?
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setConfirmDeleteOpen(false)}
            disabled={deleting}
          >
            Cancelar
          </Button>
          <Button variant="danger" onClick={eliminarEncuestasDelTramo} disabled={deleting}>
            {deleting ? <Spinner animation="border" size="sm" /> : "Sí, eliminar"}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* MODAL VIEW/EDIT */}
      <Modal show={modalOpen} onHide={closeModal} size="lg" backdrop="static">
        <Modal.Header closeButton={!saving}>
          <Modal.Title>
            {modalMode === "edit" ? "Editar Encuesta" : "Datos de Encuesta"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {modalMode === "view" ? (
            <>
              {encuestaSeleccionada &&
                Object.entries(encuestaSeleccionada).map(([key, value]) => {
                  const formatted = formatValue(value);
                  if (formatted == null || formatted === "") return null;
                  return (
                    <p key={key} style={{ marginBottom: 6 }}>
                      <strong>{key}:</strong> {String(formatted)}
                    </p>
                  );
                })}
            </>
          ) : (
            <>
              {!canUpdate && (
                <Alert variant="danger">
                  No tenés permiso <strong>encuestas.update</strong>.
                </Alert>
              )}
              {renderEditFields()}
            </>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={closeModal} disabled={saving}>
            Cerrar
          </Button>

          {modalMode === "view" ? (
            <Button
              variant="outline-secondary"
              disabled={!canUpdate}
              title={!canUpdate ? "Sin permiso encuestas.update" : "Editar"}
              onClick={() => setModalMode("edit")}
            >
              Editar
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={guardarCambios}
              disabled={!canUpdate || saving}
            >
              {saving ? <Spinner animation="border" size="sm" /> : "Guardar cambios"}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </Container>
  );
}