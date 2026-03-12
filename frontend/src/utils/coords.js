export function normalizeCoordsValue(v) {
  if (v == null) return null;

  if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];

  if (typeof v === "object") {
    const lat = v.lat ?? v.latitude;
    const lng = v.lng ?? v.longitude ?? v.lon;
    if (lat != null && lng != null) return [lat, lng];
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (s) {
      const parts = s.split(/[,;| ]+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) return [parts[0], parts[1]];
    }
  }

  return null;
}

export function parseCoordsString(v) {
  const arr = normalizeCoordsValue(v);
  if (!arr || arr.length < 2) return null;
  const lat = Number(String(arr[0]).trim());
  const lng = Number(String(arr[1]).trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

export function coordsToString(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return "";
  const lat = Number(coords[0]);
  const lng = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat},${lng}`;
}
