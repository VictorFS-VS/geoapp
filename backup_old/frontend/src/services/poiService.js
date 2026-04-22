// src/services/poiService.js
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function authHeaders(extra = {}) {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

async function jsonOrThrow(res) {
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.replace("/login");
    return null;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const toArray = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.data) ? x.data : []);

/* =========================
 * LISTADOS
 * ========================= */

// POI por tramo
export async function listPoiByTramo(idTramo, { page = 1, limit = 20 } = {}) {
  const r = await fetch(`${API_URL}/poi/tramo/${idTramo}?page=${page}&limit=${limit}`, {
    headers: authHeaders(),
  });
  const j = await jsonOrThrow(r);
  return { data: toArray(j?.data), paging: j?.paging || { page, limit, total: 0 } };
}

// POI por proyecto (filtro: tramo=all|none|<id>)
export async function listPoiByProyecto(idProyecto, { page = 1, limit = 20, tramo = "all" } = {}) {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit), tramo: String(tramo) });
  const r = await fetch(`${API_URL}/poi/proyecto/${idProyecto}?${qs.toString()}`, {
    headers: authHeaders(),
  });
  const j = await jsonOrThrow(r);
  return { data: toArray(j?.data), paging: j?.paging || { page, limit, total: 0 } };
}

/* =========================
 * CRUD
 * ========================= */

export async function createPoi(payload) {
  const r = await fetch(`${API_URL}/poi`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(r);
}

export async function updatePoi(id, payload) {
  const r = await fetch(`${API_URL}/poi/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(r);
}

export async function deletePoi(id) {
  const r = await fetch(`${API_URL}/poi/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return jsonOrThrow(r);
}

/* =========================
 * UPLOAD FOTO
 * ========================= */

export async function uploadPoiPhoto({ id_proyecto, id_tramo, file }) {
  const fd = new FormData();
  fd.append("foto", file);
  fd.append("id_proyecto", String(id_proyecto));
  // ✅ id_tramo es opcional (libre)
  if (id_tramo != null && id_tramo !== "") fd.append("id_tramo", String(id_tramo));

  const r = await fetch(`${API_URL}/poi/upload`, {
    method: "POST",
    headers: authHeaders(), // NO content-type manual con FormData
    body: fd,
  });
  const j = await jsonOrThrow(r);
  return j?.url;
}

/* =========================
 * IMG URL resolver
 * ========================= */
export function resolveImgUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // si viene /uploads/...
  return `${BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}
