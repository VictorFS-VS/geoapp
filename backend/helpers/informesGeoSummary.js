"use strict";

function toNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isLatLng(lat, lng) {
  return (
    lat != null &&
    lng != null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function parseInformeLatLng(latRaw, lngRaw, ubicRaw) {
  if (ubicRaw) {
    const s = String(ubicRaw).trim();
    if (s) {
      try {
        const j = JSON.parse(s);

        if (Array.isArray(j) && j.length >= 2) {
          const a = toNum(j[0]);
          const b = toNum(j[1]);
          if (isLatLng(a, b)) return { lat: a, lng: b };
          if (isLatLng(b, a)) return { lat: b, lng: a };
        }

        if (j && typeof j === "object") {
          const lat = toNum(j.lat ?? j.latitude);
          const lng = toNum(j.lng ?? j.lon ?? j.longitude);
          if (isLatLng(lat, lng)) return { lat, lng };

          const lat2 = toNum(j.lng ?? j.lon ?? j.longitude);
          const lng2 = toNum(j.lat ?? j.latitude);
          if (isLatLng(lat2, lng2)) return { lat: lat2, lng: lng2 };
        }
      } catch {
        const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
        if (m) {
          const a = toNum(m[1]);
          const b = toNum(m[2]);
          if (isLatLng(a, b)) return { lat: a, lng: b };
          if (isLatLng(b, a)) return { lat: b, lng: a };
        }
      }
    }
  }

  const lat1 = toNum(latRaw);
  const lng1 = toNum(lngRaw);
  if (isLatLng(lat1, lng1)) return { lat: lat1, lng: lng1 };
  if (isLatLng(lng1, lat1)) return { lat: lng1, lng: lat1 };

  return null;
}

function computeInformeGeoSummary(rows = []) {
  const total = Array.isArray(rows) ? rows.length : 0;
  let total_geo = 0;

  for (const r of rows || []) {
    const ubicRaw = r?.ubic_map_json_text ?? r?.ubic_map_text;
    const parsed = parseInformeLatLng(r?.lat_raw, r?.lng_raw, ubicRaw);
    if (parsed) total_geo += 1;
  }

  const total_sin_geo = Math.max(0, total - total_geo);

  return {
    total_geo,
    total_sin_geo,
    hasGeo: total_geo > 0,
  };
}

module.exports = {
  parseInformeLatLng,
  computeInformeGeoSummary,
};
