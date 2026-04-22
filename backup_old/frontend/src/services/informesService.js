// src/services/informesService.js
import axios from "axios";

/**
 * BASE:
 * - Si VITE_API_URL = "http://localhost:4000"     => API_URL = "http://localhost:4000/api"
 * - Si VITE_API_URL = "http://localhost:4000/api" => API_URL = "http://localhost:4000/api"
 */
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

/* =========================
   AUTH (JWT)
   ========================= */
const getAuthConfig = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");

  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

export const informesApi = {
  /* =========================
     PLANTILLAS
     ========================= */
  getPlantillas: async () => {
    const { data } = await axios.get(`${API_URL}/informes/plantillas`, getAuthConfig());
    return data;
  },

  getPlantillaById: async (id) => {
    const { data } = await axios.get(`${API_URL}/informes/plantillas/${id}`, getAuthConfig());
    return data;
  },

  createPlantilla: async (payload) => {
    const { data } = await axios.post(`${API_URL}/informes/plantillas`, payload, getAuthConfig());
    return data;
  },

  updatePlantilla: async (id, payload) => {
    const { data } = await axios.put(`${API_URL}/informes/plantillas/${id}`, payload, getAuthConfig());
    return data;
  },

  deletePlantilla: async (id) => {
    const { data } = await axios.delete(`${API_URL}/informes/plantillas/${id}`, getAuthConfig());
    return data;
  },

  // ✅ NUEVO: hard delete plantilla (SOLO ADMIN, validado backend)
  hardDeletePlantilla: async (id) => {
    const { data } = await axios.delete(`${API_URL}/informes/plantillas/${id}/hard`, getAuthConfig());
    return data; // { ok: true }
  },

  /* =========================
     SECCIONES
     ========================= */
  createSeccion: async (idPlantilla, payload) => {
    const { data } = await axios.post(
      `${API_URL}/informes/plantillas/${idPlantilla}/secciones`,
      payload,
      getAuthConfig()
    );
    return data;
  },

  updateSeccion: async (idSeccion, payload) => {
    const { data } = await axios.put(`${API_URL}/informes/secciones/${idSeccion}`, payload, getAuthConfig());
    return data;
  },

  deleteSeccion: async (idSeccion) => {
    const { data } = await axios.delete(`${API_URL}/informes/secciones/${idSeccion}`, getAuthConfig());
    return data;
  },

  /* =========================
     PREGUNTAS
     ========================= */
  createPregunta: async (idSeccion, payload) => {
    const { data } = await axios.post(
      `${API_URL}/informes/secciones/${idSeccion}/preguntas`,
      payload,
      getAuthConfig()
    );
    return data;
  },

  updatePregunta: async (idPregunta, payload) => {
    const { data } = await axios.put(`${API_URL}/informes/preguntas/${idPregunta}`, payload, getAuthConfig());
    return data;
  },

  moverPregunta: async (idPregunta, payload) => {
    const { data } = await axios.put(`${API_URL}/informes/preguntas/${idPregunta}/mover`, payload, getAuthConfig());
    return data;
  },

  deletePregunta: async (idPregunta) => {
    const { data } = await axios.delete(`${API_URL}/informes/preguntas/${idPregunta}`, getAuthConfig());
    return data;
  },

  /* =========================
     SHARE LINKS (PRIVADO)
     ========================= */
  createShareLink: async (payload) => {
    const { data } = await axios.post(`${API_URL}/informes/share-links`, payload, getAuthConfig());
    return data; // { ok, share, publicUrl }
  },

  listShareLinksByPlantilla: async (idPlantilla) => {
    const { data } = await axios.get(
      `${API_URL}/informes/plantillas/${idPlantilla}/share-links`,
      getAuthConfig()
    );
    return data; // { ok, links:[] }
  },

  closeShareLink: async (idShare) => {
    const { data } = await axios.put(`${API_URL}/informes/share-links/${idShare}/cerrar`, {}, getAuthConfig());
    return data; // { ok, link }
  },

  // ✅ NUEVO: eliminar share link (privado)
  eliminarShareLink: async (idShare) => {
    const { data } = await axios.delete(`${API_URL}/informes/share-links/${idShare}`, getAuthConfig());
    return data; // { ok, id_share }
  },

  /* =========================
     INFORMES LLENADOS (PRIVADO)
     ========================= */

  /**
   * ✅ IMPORTANTE:
   * No seteamos "Content-Type: multipart/form-data" manualmente.
   * Axios pone el boundary correcto automáticamente.
   */
  crearInforme: async (formData) => {
    const auth = getAuthConfig();
    const { data } = await axios.post(`${API_URL}/informes`, formData, { ...auth });
    return data;
  },

  actualizarInforme: async (idInforme, formData) => {
    const auth = getAuthConfig();
    const { data } = await axios.put(`${API_URL}/informes/${idInforme}`, formData, { ...auth });
    return data;
  },

  getInforme: async (id) => {
    const { data } = await axios.get(`${API_URL}/informes/${id}`, getAuthConfig());
    return data;
  },

  /**
   * ✅ NUEVO (CLAVE PARA InformeChartsModal)
   * Devuelve SIEMPRE: { rows: [] }
   */
  getInformeDetalle: async (id) => {
    const { data } = await axios.get(`${API_URL}/informes/${id}`, getAuthConfig());

    if (Array.isArray(data?.rows)) return { rows: data.rows };
    if (Array.isArray(data?.detalle)) return { rows: data.detalle };
    if (Array.isArray(data?.respuestas)) return { rows: data.respuestas };

    if (Array.isArray(data?.data?.rows)) return { rows: data.data.rows };
    if (Array.isArray(data?.data?.detalle)) return { rows: data.data.detalle };
    if (Array.isArray(data?.data?.respuestas)) return { rows: data.data.respuestas };

    return { rows: [] };
  },

  getPdfBlob: async (idInforme) => {
    const auth = getAuthConfig();
    const { data } = await axios.get(`${API_URL}/informes/${idInforme}/pdf`, {
      ...auth,
      responseType: "blob",
    });
    return data;
  },

  getPdfUrl: (idInforme) => `${API_URL}/informes/${idInforme}/pdf`,

  /* =========================
     PÚBLICO (SIN TOKEN)
     ========================= */
  publicGetShareForm: async (token) => {
    const { data } = await axios.get(`${API_URL}/informes-public/${token}`);
    return data;
  },

  publicSubmitShareForm: async (token, formData) => {
    const { data } = await axios.post(`${API_URL}/informes-public/${token}/enviar`, formData);
    return data;
  },
};
