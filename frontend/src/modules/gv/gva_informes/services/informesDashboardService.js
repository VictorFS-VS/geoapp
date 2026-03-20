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
  if (params.desde) qp.set("desde", String(params.desde));
  if (params.hasta) qp.set("hasta", String(params.hasta));
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
