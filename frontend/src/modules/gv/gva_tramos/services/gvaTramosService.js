const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : `${BASE}/api`;
const HOST_BASE = BASE.replace(/\/api\/?$/i, "");

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchInformesGeoLinks(payload = {}) {
  const url = `${API_URL}/informes-dashboard/geo-links`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload || {}),
  });

  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await resp.json() : null;

  if (!resp.ok || data?.ok === false) {
    const msg = data?.error || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

function toFeatureFromRow(row) {
  if (!row || typeof row !== "object") return null;

  let geom =
    row.geometry ??
    row.geom ??
    row.geojson ??
    row.GEOMETRY ??
    row.GEOM ??
    row.GEOJSON ??
    null;

  if (geom && typeof geom === "object" && geom.type === "Feature") return geom;
  if (!geom && row.type === "Feature" && row.geometry) return row;
  if (!geom) return null;

  if (typeof geom === "string") {
    try {
      geom = JSON.parse(geom);
    } catch {
      return null;
    }
  }

  if (geom?.type === "FeatureCollection") return null;
  if (geom?.type === "Feature" && geom.geometry) return geom;

  const props =
    row.properties && typeof row.properties === "object"
      ? row.properties
      : Object.fromEntries(
          Object.entries(row).filter(
            ([k]) =>
              !["geometry", "geom", "geojson", "GEOMETRY", "GEOM", "GEOJSON"].includes(k)
          )
        );

  return { type: "Feature", geometry: geom, properties: props };
}

function asFeatureCollection(payload) {
  if (!payload) return null;

  const p =
    payload?.geojson ||
    payload?.GeoJSON ||
    payload?.data?.geojson ||
    payload?.data?.GeoJSON ||
    payload?.data ||
    payload;

  if (!p) return null;

  if (p?.type === "FeatureCollection" && Array.isArray(p.features)) {
    const fixed = p.features
      .map((f) => (f?.type === "Feature" ? f : toFeatureFromRow(f)))
      .filter(Boolean);
    return { type: "FeatureCollection", features: fixed };
  }

  if (Array.isArray(p?.features)) {
    const fixed = p.features
      .map((f) => (f?.type === "Feature" ? f : toFeatureFromRow(f)))
      .filter(Boolean);
    return { type: "FeatureCollection", features: fixed };
  }

  if (Array.isArray(p?.rows)) {
    const feats = p.rows.map(toFeatureFromRow).filter(Boolean);
    return { type: "FeatureCollection", features: feats };
  }

  if (Array.isArray(p)) {
    const feats = p.map((x) => (x?.type === "Feature" ? x : toFeatureFromRow(x))).filter(Boolean);
    return { type: "FeatureCollection", features: feats };
  }

  return null;
}

function isLngLatPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return false;
  const lng = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

function geometryLooksWgs84(geom) {
  if (!geom?.coordinates) return false;

  const walk = (node) => {
    if (!Array.isArray(node)) return false;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      return isLngLatPair(node);
    }
    return node.every((child) => walk(child));
  };

  return walk(geom.coordinates);
}

function normalizeProgresivasFeatureCollection(fc) {
  const featureCollection =
    fc?.type === "FeatureCollection" && Array.isArray(fc.features)
      ? fc
      : { type: "FeatureCollection", features: [] };

  let dropped = 0;
  const features = featureCollection.features.filter((feature) => {
    const geom = feature?.geometry;
    if (!geom?.type || !geom?.coordinates) {
      dropped += 1;
      return false;
    }
    if (!geometryLooksWgs84(geom)) {
      dropped += 1;
      return false;
    }
    return true;
  });

  if (dropped > 0 && import.meta.env.DEV) {
    console.warn(
      `[gva_tramos] Progresivas descartadas por geometria fuera de rango: ${dropped}`
    );
  }

  return { type: "FeatureCollection", features };
}

async function fetchJson(url) {
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

export async function fetchInformeDetalle(idInforme) {
  if (!idInforme) throw new Error("idInforme es requerido");
  return fetchJson(`${API_URL}/informes/${Number(idInforme)}`);
}

export function resolveInformeFotoUrl(rutaArchivo) {
  if (!rutaArchivo) return "";
  const clean = String(rutaArchivo).trim().replace(/^\/+/, "");
  if (!clean) return "";
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.startsWith("api/uploads/")) return `${HOST_BASE}/${clean}`;
  if (clean.startsWith("uploads/")) return `${HOST_BASE}/${clean}`;
  return `${HOST_BASE}/uploads/${clean}`;
}

export async function fetchTramosGeojson(idProyecto) {
  if (!idProyecto) return null;
  const urls = [
    `${API_URL}/tramos/proyectos/${Number(idProyecto)}/tramos/geojson`,
    `${API_URL}/tramos/proyectos/${Number(idProyecto)}/tramos/geojson?limit=30000`,
  ];

  for (const url of urls) {
    const json = await fetchJson(url);
    const fc = asFeatureCollection(json);
    if (fc?.features?.length) return fc;
  }

  return { type: "FeatureCollection", features: [] };
}

export async function fetchProgresivasGeojson(idProyecto) {
  if (!idProyecto) return null;
  const url = `${API_URL}/mantenimiento/${Number(idProyecto)}/progresivas`;
  const json = await fetchJson(url);
  const fc = asFeatureCollection(json);
  return normalizeProgresivasFeatureCollection(fc);
}
