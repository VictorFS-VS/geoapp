// src/services/regencia.service.js
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   AUTH HEADERS (JWT)
   ========================= */
function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.message || data?.error || msg;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

/* =========================
   ACTIVIDADES
   ========================= */
export function listarActividades({
  id_proyecto,
  id_contrato,
  estado,
  tipo,
  q,
  desde,
  hasta,
}) {
  const params = new URLSearchParams();

  if (id_proyecto) params.set("id_proyecto", String(id_proyecto));
  if (id_contrato) params.set("id_contrato", String(id_contrato));
  if (estado) params.set("estado", estado);
  if (tipo) params.set("tipo", tipo);
  if (q) params.set("q", q);
  if (desde) params.set("from", desde);
  if (hasta) params.set("to", hasta);

  const qs = params.toString();
  return apiFetch(`${API_URL}/regencia/actividades${qs ? `?${qs}` : ""}`);
}

export function crearActividad(payload) {
  return apiFetch(`${API_URL}/regencia/actividades`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function actualizarActividad(id, payload) {
  return apiFetch(`${API_URL}/regencia/actividades/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function cambiarEstadoActividad(id, estado) {
  return apiFetch(`${API_URL}/regencia/actividades/${id}/estado`, {
    method: "PUT",
    body: JSON.stringify({ estado }),
  });
}

/* =========================
   CONTRATOS
   ========================= */
export function obtenerContratoActivo(id_proyecto) {
  return apiFetch(`${API_URL}/regencia/contratos/${id_proyecto}/activo`);
}

export function listarContratos(id_proyecto) {
  return apiFetch(`${API_URL}/regencia/contratos/${id_proyecto}`);
}

export function crearContrato(payload) {
  return apiFetch(`${API_URL}/regencia/contratos`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function actualizarContrato(id, payload) {
  return apiFetch(`${API_URL}/regencia/contratos/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function generarVisitasMensuales(id_contrato, payload) {
  return apiFetch(`${API_URL}/regencia/contratos/${id_contrato}/generar-visitas`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* =========================
   RESPONSABLES
   ========================= */
export function listarResponsables(id_actividad) {
  return apiFetch(`${API_URL}/regencia/actividades/${id_actividad}/responsables`);
}

export function setResponsables(id_actividad, responsables = []) {
  return apiFetch(`${API_URL}/regencia/actividades/${id_actividad}/responsables`, {
    method: "POST",
    body: JSON.stringify({ responsables }),
  });
}

/* =========================
   ALERTAS
   ========================= */
export function generarAlertasEstandar(id_actividad) {
  return apiFetch(`${API_URL}/regencia/actividades/${id_actividad}/generar-alertas`, {
    method: "POST",
  });
}