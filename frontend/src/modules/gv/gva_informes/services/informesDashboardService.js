const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getResumen(params = {}) {
  const qp = new URLSearchParams();
  if (params.id_proyecto) qp.set("id_proyecto", String(params.id_proyecto));
  if (params.id_plantilla) qp.set("id_plantilla", String(params.id_plantilla));
  if (params.date_from) {
    qp.set("date_from", String(params.date_from));
  } else if (params.desde) {
    qp.set("date_from", String(params.desde));
  }
  if (params.date_to) {
    qp.set("date_to", String(params.date_to));
  } else if (params.hasta) {
    qp.set("date_to", String(params.hasta));
  }
  if (params.date_field_id) qp.set("date_field_id", String(params.date_field_id));
  if (params.time_grouping) qp.set("time_grouping", String(params.time_grouping));
  if (params.search_text && String(params.search_text).trim()) {
    qp.set("search_text", String(params.search_text).trim());
  }
  if (params.solo_cerrados !== undefined) {
    qp.set("solo_cerrados", params.solo_cerrados ? "1" : "0");
  }
  if (params.filters && Array.isArray(params.filters) && params.filters.length > 0) {
    try {
      qp.set("filters", JSON.stringify(params.filters));
    } catch (e) {
      throw new Error("No se pudo serializar filters");
    }
  }
  if (
    params.interactive_filters &&
    Array.isArray(params.interactive_filters) &&
    params.interactive_filters.length > 0
  ) {
    try {
      qp.set("interactive_filters", JSON.stringify(params.interactive_filters));
    } catch (e) {
      throw new Error("No se pudo serializar interactive_filters");
    }
  }
  if (
    params.search_field_ids &&
    Array.isArray(params.search_field_ids) &&
    params.search_field_ids.length > 0
  ) {
    try {
      qp.set("search_field_ids", JSON.stringify(params.search_field_ids));
    } catch (e) {
      throw new Error("No se pudo serializar search_field_ids");
    }
  }
  if (
    params.selected_fields &&
    Array.isArray(params.selected_fields) &&
    params.selected_fields.length > 0
  ) {
    try {
      qp.set("selected_fields", JSON.stringify(params.selected_fields));
    } catch (e) {
      throw new Error("No se pudo serializar selected_fields");
    }
  }

  // Configuración explícita para KPIs y comportamientos temporales
  if (params.kpi_primary_field_id) {
    qp.set("kpi_primary_field_id", String(params.kpi_primary_field_id));
  }
  if (params.kpi_secondary_field_ids && Array.isArray(params.kpi_secondary_field_ids)) {
    try {
      qp.set("kpi_secondary_field_ids", JSON.stringify(params.kpi_secondary_field_ids));
    } catch (e) {
      console.warn("getResumen: falló serialización kpi_secondary_field_ids", e);
    }
  }
  if (params.preferred_date_field_id) {
    qp.set("preferred_date_field_id", String(params.preferred_date_field_id));
  }
  if (params.preferred_time_grouping) {
    qp.set("preferred_time_grouping", String(params.preferred_time_grouping));
  }

  const url = `${API_URL}/informes-dashboard/resumen?${qp.toString()}`;
  const resp = await fetch(url, { headers: { ...authHeaders() } });

  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : null;

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function getPlantillas(id_proyecto) {
  const qp = new URLSearchParams();
  if (id_proyecto) qp.set("id_proyecto", String(id_proyecto));
  const url = `${API_URL}/informes-dashboard/plantillas?${qp.toString()}`;
  const resp = await fetch(url, { headers: { ...authHeaders() } });

  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : null;

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function getPlantillaMetadata(id_proyecto, idPlantilla) {
  const qp = new URLSearchParams();
  if (id_proyecto) qp.set("id_proyecto", String(id_proyecto));
  const url = `${API_URL}/informes-dashboard/plantillas/${Number(idPlantilla)}/metadata?${qp.toString()}`;
  const resp = await fetch(url, { headers: { ...authHeaders() } });

  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : null;

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}
