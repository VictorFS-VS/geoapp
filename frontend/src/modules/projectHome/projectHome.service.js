import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

const extractEligibleKpiOptions = (secciones = []) => {
  const eligible = [];
  const seen = new Set();

  for (const seccion of Array.isArray(secciones) ? secciones : []) {
    for (const pregunta of Array.isArray(seccion?.preguntas) ? seccion.preguntas : []) {
      const id = Number(pregunta?.id_pregunta);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      if (pregunta?.resultable !== true && pregunta?.chartable !== true) continue;
      seen.add(id);
      eligible.push({
        id,
        label: pregunta?.etiqueta || `Pregunta ${id}`,
      });
    }
  }

  return eligible;
};

const buildFieldSummariesFromKpiOptions = (kpiOptions = []) =>
  (Array.isArray(kpiOptions) ? kpiOptions : []).map((option) => ({
    id_pregunta: option.id,
    etiqueta: option.label,
    summary_type: "counts",
    items: [{ label: "Disponible", value: 0 }],
  }));

const getAuthConfig = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
};

export const projectHomeApi = {
  getProjectHomeResumen: async ({ id_proyecto, id_plantilla, id_home_item, skip_temporal }) => {
    const params = {};
    if (id_proyecto) params.id_proyecto = id_proyecto;
    if (id_plantilla) params.id_plantilla = id_plantilla;
    if (id_home_item) params.id_home_item = id_home_item;
    if (skip_temporal === true) params.skip_temporal = true;
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
    const config = data?.config || null;
    const effectiveConfig = data?.effective_config || config || null;
    const sourceMode = data?.source_mode || (config ? "config" : "auto");
    return {
      config,
      effective_config: effectiveConfig,
      source_mode: sourceMode,
    };
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
    if (!id_plantilla) {
      return { field_summaries: [], temporal_sources: [], kpi_options: [] };
    }
    const params = {};
    if (id_proyecto) params.id_proyecto = id_proyecto;
    const { data } = await axios.get(`${API_URL}/informes-dashboard/plantillas/${Number(id_plantilla)}/metadata`, {
      ...getAuthConfig(),
      params,
    });
    const kpiOptions = extractEligibleKpiOptions(data?.secciones);
    return {
      field_summaries: buildFieldSummariesFromKpiOptions(kpiOptions),
      temporal_sources: Array.isArray(data?.temporal_sources) ? data.temporal_sources : [],
      kpi_options: kpiOptions,
    };
  },
  listHomeItems: async ({ id_proyecto, include_legacy }) => {
    const params = { id_proyecto };
    if (include_legacy === true) params.include_legacy = true;
    const { data } = await axios.get(`${API_URL}/project-home/items`, {
      ...getAuthConfig(),
      params,
    });
    return Array.isArray(data?.data) ? data.data : [];
  },
  createHomeItem: async (payload = {}) => {
    const { data } = await axios.post(`${API_URL}/project-home/items`, payload, getAuthConfig());
    return data?.data || null;
  },
  updateHomeItem: async (id_home_item, payload = {}) => {
    const { data } = await axios.put(
      `${API_URL}/project-home/items/${Number(id_home_item)}`,
      payload,
      getAuthConfig()
    );
    return data?.data || null;
  },
  disableHomeItem: async (id_home_item) => {
    const { data } = await axios.patch(
      `${API_URL}/project-home/items/${Number(id_home_item)}/disable`,
      {},
      getAuthConfig()
    );
    return data?.data || null;
  },
  setDefaultHomeItem: async (id_home_item) => {
    const { data } = await axios.patch(
      `${API_URL}/project-home/items/${Number(id_home_item)}/default`,
      {},
      getAuthConfig()
    );
    return data?.data || null;
  },
  reorderHomeItems: async ({ id_proyecto, items }) => {
    const { data } = await axios.patch(
      `${API_URL}/project-home/items/reorder`,
      { id_proyecto, items },
      getAuthConfig()
    );
    return Array.isArray(data?.data) ? data.data : [];
  },
};
