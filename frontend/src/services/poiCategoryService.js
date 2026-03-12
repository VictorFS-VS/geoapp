// src/services/poiCategoryService.js
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function authHeaders(extra = {}) {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function parseJson(r) {
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!r.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function listPoiCategorias({ activa = "true" } = {}) {
  const r = await fetch(`${API_URL}/poi-categorias?activa=${encodeURIComponent(activa)}`, {
    headers: authHeaders(),
  });
  return parseJson(r);
}

export async function createPoiCategoria(payload) {
  const r = await fetch(`${API_URL}/poi-categorias`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJson(r);
}

export async function updatePoiCategoria(id, payload) {
  const r = await fetch(`${API_URL}/poi-categorias/${id}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJson(r);
}

export async function deletePoiCategoria(id) {
  const r = await fetch(`${API_URL}/poi-categorias/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseJson(r);
}

/* =========================================================
   ✅ NUEVO: Subir ícono de categoría
   POST /api/poi-categorias/upload-icon
   FormData: icon (file)
========================================================= */
export async function uploadPoiCategoriaIcon(file) {
  if (!file) throw new Error("No se recibió archivo");

  const fd = new FormData();
  fd.append("icon", file);

  const r = await fetch(`${API_URL}/poi-categorias/upload-icon`, {
    method: "POST",
    headers: authHeaders(), // NO agregues Content-Type, el browser lo setea con boundary
    body: fd,
  });

  const data = await parseJson(r);
  // tu backend devuelve { ok:true, url:"/uploads/poi_categorias/xxx.png" }
  return data?.url;
}
