// URL del backend (.env) con fallback local
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Headers con token (si no hay token, solo devuelve extra)
function authHeaders(extra = {}) {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

// Fetch genérico con manejo de errores; si el body no es JSON válido, devuelve texto
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);

  // ✅ 404: colecciones vacías (capas)
  if (res.status === 404) return { type: "FeatureCollection", features: [] };

  // ✅ 409: conflicto esperado (dependencias). Devolvemos JSON sin throw.
  if (res.status === 409) {
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: false, status: 409, ...data };
  }

  // Otros no-ok => throw
  if (!res.ok) {
    let msg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const t = await res.text();
      msg = t || msg;
    } catch {}
    throw new Error(msg);
  }

  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}

/* ======= PROYECTOS / POLÍGONOS ======= */

/** Polígonos del proyecto puntual */
export async function obtenerGeojsonProyecto(id) {
  const url = `${API_URL}/proyectos/${id}/poligonos`;
  return fetchJSON(url, { headers: authHeaders() });
}

/** Polígonos "smart": si el proponente tiene 2+, devuelve todos */
export async function obtenerPoligonosSmart(id) {
  const url = `${API_URL}/proyectos/${id}/poligonos-smart`;
  return fetchJSON(url, { headers: authHeaders() });
}

/** Proyectos “hermanos” del mismo proponente */
export async function obtenerHermanos(id) {
  const url = `${API_URL}/proyectos/${id}/hermanos`;
  return fetchJSON(url, { headers: authHeaders() });
}

/* ======= CAPAS ======= */

export async function obtenerUsoActualProyecto(id) {
  const url = `${API_URL}/proyectos/uso-actual/${id}`;
  return fetchJSON(url, { headers: authHeaders() });
}

export async function obtenerUsoAlternativoProyecto(id) {
  const url = `${API_URL}/proyectos/uso-alternativo/${id}`;
  return fetchJSON(url, { headers: authHeaders() });
}

export async function obtenerUso1986Proyecto(id) {
  const url = `${API_URL}/proyectos/uso-1986/${id}`;
  return fetchJSON(url, { headers: authHeaders() });
}

/** Comunidad Indígena por proyecto */
export async function obtenerComIndigenaProyecto(id) {
  const url = `${API_URL}/proyectos/com-indigena/${id}`;
  return fetchJSON(url, { headers: authHeaders() });
}
/** Eliminar proyecto mas hijos */
export async function eliminarProyecto(id, { force = false } = {}) {
  const url = `${API_URL}/proyectos/${id}${force ? "?force=1" : ""}`;
  return fetchJSON(url, { method: "DELETE", headers: authHeaders() });
}

/* ======= LISTADO DE PROYECTOS (para Builder / selects) ======= */

/**
 * Lista proyectos paginados desde el backend:
 * GET /api/proyectos?page=1&limit=500&codigo=...&nombre=...&des_estado=...
 *
 * Devuelve lo que tu backend ya retorna: { data, page, totalPages, totalItems }
 */
export async function listarProyectos(params = {}) {
  const qs = new URLSearchParams();

  // defaults
  const page = params.page ?? 1;
  const limit = params.limit ?? 500;

  qs.set("page", String(page));
  qs.set("limit", String(limit));

  // filtros opcionales (solo si vienen)
  if (params.codigo) qs.set("codigo", params.codigo);
  if (params.nombre) qs.set("nombre", params.nombre);
  if (params.des_estado) qs.set("des_estado", params.des_estado);
  if (params.proponente) qs.set("proponente", params.proponente);

  const url = `${API_URL}/proyectos?${qs.toString()}`;
  return fetchJSON(url, { headers: authHeaders() });
}

/**
 * Lista “plana” para Select (id, codigo, nombre).
 * Importante: tu backend a veces usa gid como id.
 */
export async function listarProyectosParaSelect({ limit = 500 } = {}) {
  const res = await listarProyectos({ page: 1, limit });

  const arr = Array.isArray(res?.data) ? res.data
            : Array.isArray(res?.rows) ? res.rows
            : Array.isArray(res) ? res
            : [];

  return arr
    .map((p) => ({
      id: p.gid ?? p.id ?? p.id_proyecto,
      codigo: p.codigo ?? "",
      nombre: p.nombre ?? "",
      raw: p, // por si querés usar más campos
    }))
    .filter((x) => x.id != null);
}
