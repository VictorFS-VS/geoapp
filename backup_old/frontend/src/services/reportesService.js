// src/services/reportesService.js
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function authHeaders(extra = {}) {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const reportesApi = {
  // =========================
  // LISTADO
  // =========================
  listByProyecto: (idProyecto) =>
    apiFetch(`${API_URL}/reportes?proyecto=${idProyecto}`, {
      headers: authHeaders(),
    }),

  // =========================
  // CREACIÓN
  // =========================

  // modo viejo: desde último informe del proyecto
  createFromProyecto: (idProyecto) =>
    apiFetch(`${API_URL}/reportes/from-proyecto/${idProyecto}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    }),

  // modo viejo: desde un informe específico
  createFromInforme: (idInforme) =>
    apiFetch(`${API_URL}/reportes/from-informe/${idInforme}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    }),

  // ✅ NUEVO: REPORTE GENERAL AGREGADO
  createFromProyectoAgregado: (idProyecto, idPlantilla, titulo = null) => {
    const qs = new URLSearchParams();
    qs.set("id_plantilla", idPlantilla);
    if (titulo) qs.set("titulo", titulo);

    return apiFetch(
      `${API_URL}/reportes/from-proyecto-agregado/${idProyecto}?${qs.toString()}`,
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      }
    );
  },

  // =========================
  // BUILDER
  // =========================
  getOne: (idReporte) =>
    apiFetch(`${API_URL}/reportes/${idReporte}`, {
      headers: authHeaders(),
    }),

  updateHeader: (idReporte, payload) =>
    apiFetch(`${API_URL}/reportes/${idReporte}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {}),
    }),

  updateBloque: (idReporte, idBloque, payload) =>
    apiFetch(`${API_URL}/reportes/${idReporte}/bloques/${idBloque}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {}),
    }),

  addBloqueManual: (idReporte, idReporteSeccion, payload) =>
    apiFetch(`${API_URL}/reportes/${idReporte}/secciones/${idReporteSeccion}/bloques`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {}),
    }),

  deleteBloque: (idReporte, idBloque) =>
    apiFetch(`${API_URL}/reportes/${idReporte}/bloques/${idBloque}`, {
      method: "DELETE",
      headers: authHeaders(),
    }),

  // =========================
  // AYUDA: PLANTILLAS
  // =========================
  listPlantillasByProyecto: (idProyecto) =>
    apiFetch(`${API_URL}/informes/proyecto/${idProyecto}/por-plantilla`, {
      headers: authHeaders(),
    }),
};
