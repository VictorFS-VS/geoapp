// controllers/sentinel.controller.js
const axios = require("axios");
const { PNG } = require("pngjs"); // npm i pngjs

// Cache en memoria
let cachedToken = null;
let tokenExpiresAt = 0;     // ms epoch
let renewTimer = null;
let inFlightPromise = null; // evita renovaciones paralelas

const RENEW_BUFFER_MS =
  (parseInt(process.env.SENTINEL_RENEW_BUFFER_SEC, 10) || 120) * 1000; // default 120s
const AXIOS_TIMEOUT_MS = parseInt(process.env.SENTINEL_HTTP_TIMEOUT_MS, 10) || 10000;

const SH_PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";
const SH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";

function getCreds() {
  const clientId = process.env.SENTINEL_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.SENTINEL_CLIENT_SECRET || process.env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciales Sentinel no configuradas (SENTINEL_CLIENT_ID/SECRET o CLIENT_ID/CLIENT_SECRET)"
    );
  }
  return { clientId, clientSecret };
}

async function fetchToken() {
  const { clientId, clientSecret } = getCreds();

  const resp = await axios.post(
    SH_TOKEN_URL,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: AXIOS_TIMEOUT_MS,
    }
  );

  return resp.data; // { access_token, expires_in, token_type }
}

function scheduleRenew(expiresInSec) {
  // Renovar un poco antes + pequeño jitter para no alinear con otros servicios
  const jitter = Math.floor(Math.random() * 5000); // 0-5s
  const renewIn = Math.max(10_000, expiresInSec * 1000 - RENEW_BUFFER_MS - jitter);

  if (renewTimer) clearTimeout(renewTimer);

  renewTimer = setTimeout(() => {
    fetchAndCache().catch((err) => {
      console.error("Error al renovar token Sentinel:", err.message);
      renewTimer = setTimeout(() => fetchAndCache().catch(() => {}), 30_000);
    });
  }, renewIn);
}

async function fetchAndCache() {
  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = (async () => {
    const data = await fetchToken();
    const now = Date.now();

    cachedToken = data.access_token;
    tokenExpiresAt = now + data.expires_in * 1000;

    scheduleRenew(data.expires_in);

    return {
      token: cachedToken,
      expiresInSec: data.expires_in,
      tokenType: data.token_type || "Bearer",
    };
  })();

  try {
    return await inFlightPromise;
  } finally {
    inFlightPromise = null;
  }
}

async function getAccessTokenValue() {
  const now = Date.now();
  const stillValid = cachedToken && now < tokenExpiresAt - 15_000;
  if (stillValid) return cachedToken;

  const { token } = await fetchAndCache();
  return token;
}

exports.getAccessTokenValue = getAccessTokenValue;

/** Endpoint público: ver token (debug) */
exports.getSentinelToken = async (req, res) => {
  try {
    const now = Date.now();
    const stillValid = cachedToken && now < tokenExpiresAt - 15_000;
    if (stillValid) {
      return res.json({ token: cachedToken, cached: true, expires_at: tokenExpiresAt });
    }
    const { token } = await fetchAndCache();
    return res.json({ token, cached: false, expires_at: tokenExpiresAt });
  } catch (err) {
    console.error("Token Sentinel error:", err?.response?.data || err.message);
    res.status(502).json({ error: "No se pudo obtener token de Sentinel" });
  }
};

exports.forceRefresh = async (req, res) => {
  try {
    const { token, expiresInSec } = await fetchAndCache();
    res.json({ token, cached: false, expires_in: expiresInSec, expires_at: tokenExpiresAt });
  } catch (err) {
    res.status(502).json({ error: "No se pudo renovar token" });
  }
};

exports.initSentinelTokenWarmup = async () => {
  try {
    await fetchAndCache();
    console.log("🔐 Token Sentinel inicializado y programado para renovación.");
  } catch (err) {
    console.error("No se pudo inicializar token Sentinel:", err.message);
  }
};

process.on("exit", () => {
  if (renewTimer) clearTimeout(renewTimer);
});

// -----------------------------
//   cloudPctAOI (FIX HEADERS)
// -----------------------------

/**
 * Calcula % de nubes SOLO sobre el AOI usando SCL (Sentinel-2 L2A).
 * POST /api/sentinel/cloudpct
 * body: { date, bbox, geometry, sampleWidth?, sampleHeight? }
 * - date: "YYYY-MM-DD"
 * - bbox: [minX,minY,maxX,maxY] (EPSG:4326) (opcional)
 * - geometry: GeoJSON Polygon/MultiPolygon (EPSG:4326) (requerido)
 */
exports.cloudPctAOI = async (req, res) => {
  try {
    const { date, bbox, geometry, sampleWidth = 256, sampleHeight = 256 } = req.body || {};

    if (!date) return res.status(400).json({ error: "Falta date (YYYY-MM-DD)" });
    if (!geometry) return res.status(400).json({ error: "Falta geometry (GeoJSON)" });

    // Normalizar geometry por si viene Feature / FeatureCollection
    let geom = geometry;
    if (geom?.type === "Feature") geom = geom.geometry;
    if (geom?.type === "FeatureCollection") geom = geom.features?.[0]?.geometry;

    if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) {
      return res.status(400).json({
        error: "geometry debe ser Polygon/MultiPolygon (o Feature/FeatureCollection con geometry válida)",
      });
    }

    const from = `${date}T00:00:00Z`;
    const to = `${date}T23:59:59Z`;

    const token = await getAccessTokenValue();

    const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["SCL", "dataMask"], units: ["DN", "DN"] }],
    output: { bands: 2, sampleType: "UINT8" }
  };
}
function isCloud(scl) {
  return scl === 8 || scl === 9 || scl === 10 || scl === 11;
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0];
  return [isCloud(s.SCL) ? 1 : 0, 1];
}
`;

    const payload = {
      input: {
        bounds: {
          ...(Array.isArray(bbox) && bbox.length === 4 ? { bbox } : {}),
          geometry: geom,
          properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: { from, to },
              mosaickingOrder: "mostRecent",
            },
          },
        ],
      },
      output: {
        width: Number(sampleWidth) || 256,
        height: Number(sampleHeight) || 256,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript,
    };

    const resp = await axios.post(SH_PROCESS_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // ✅ FIX CLAVE: Sentinel Hub no acepta "application/json, text/plain, */*" acá
        Accept: "image/png",
      },
      responseType: "arraybuffer",
      timeout: 60000,
      // (opcional) por si hay proxies raros
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const png = PNG.sync.read(Buffer.from(resp.data));
    const { data, width, height } = png;

    let valid = 0;
    let cloud = 0;

    // R=cloudMask, G=validMask
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];

      if (g > 0) {
        valid++;
        if (r > 0) cloud++;
      }
    }

    const cloudPct = valid > 0 ? +(cloud * 100 / valid).toFixed(2) : null;

    return res.json({
      date,
      cloud_pct: cloudPct,
      sample: { width, height, valid_pixels: valid, cloud_pixels: cloud },
    });
  } catch (err) {
    const status = err?.response?.status;
    let detail = err?.response?.data;

    try {
      if (detail && detail instanceof ArrayBuffer) detail = Buffer.from(detail).toString("utf8");
      else if (Buffer.isBuffer(detail)) detail = detail.toString("utf8");
    } catch {}

    console.error("cloudPctAOI error:", status, detail || err.message);

    return res.status(502).json({
      error: "No se pudo calcular cloud_pct AOI",
      sentinel_status: status || null,
      sentinel_detail: detail || null,
    });
  }
};
