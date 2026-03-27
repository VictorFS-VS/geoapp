import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

const getAuthConfig = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

export const projectHomeApi = {
  getProjectHomeResumen: async ({ id_proyecto, id_plantilla }) => {
    const params = {};
    if (id_proyecto) params.id_proyecto = id_proyecto;
    if (id_plantilla) params.id_plantilla = id_plantilla;
    const config = { ...getAuthConfig(), params };
    const { data } = await axios.get(`${API_URL}/project-home/resumen`, config);
    return data;
  },
  getProjectHomeConfig: async ({ id_proyecto, id_plantilla }) => {
    const params = { id_proyecto };
    if (id_plantilla) params.id_plantilla = id_plantilla;
    const { data } = await axios.get(`${API_URL}/project-home/config`, {
      ...getAuthConfig(),
      params,
    });
    return data?.config || null;
  },
  saveProjectHomeConfig: async ({ projectId, plantillaId, payload, configId }) => {
    const body = {
      id_proyecto: projectId,
      id_plantilla: plantillaId ?? null,
      ...payload,
    };
    if (configId) {
      const { data } = await axios.put(`${API_URL}/project-home/config/${configId}`, body, getAuthConfig());
      return data?.config || null;
    }
    const { data } = await axios.post(`${API_URL}/project-home/config`, body, getAuthConfig());
    return data?.config || null;
  },
  getPlantillaMetadata: async ({ id_proyecto, id_plantilla }) => {
    const params = {};
    if (id_proyecto) params.id_proyecto = id_proyecto;
    if (id_plantilla) params.id_plantilla = id_plantilla;
    const { data } = await axios.get(`${API_URL}/project-home/resumen`, {
      ...getAuthConfig(),
      params,
    });
    return {
      field_summaries: Array.isArray(data?.field_summaries) ? data.field_summaries : [],
      temporal_sources: Array.isArray(data?.temporal_sources) ? data.temporal_sources : [],
    };
  },
};
