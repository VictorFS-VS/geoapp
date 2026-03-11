const express = require("express");
const axios = require("axios");
const { URL } = require("url");

const router = express.Router();

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

// Opcional: restringir hosts permitidos
const ALLOWLIST = new Set([
  "services.sentinel-hub.com",
  "gibs.earthdata.nasa.gov",
  "tiles.maps.eox.at",
  "ows.terrestris.de",
]);

router.get("/proxy", verifyToken, requirePerm("proxy.read"), async (req, res) => {
  try {
    const raw = req.query.url;
    if (!raw) return res.status(400).json({ error: "Missing url" });

    const target = decodeURIComponent(raw);
    const hostname = new URL(target).hostname;

    if (ALLOWLIST.size && !ALLOWLIST.has(hostname)) {
      return res.status(403).json({ error: "Host not allowed" });
    }

    const upstream = await axios.get(target, {
      responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000,
    });

    Object.entries(upstream.headers).forEach(([k, v]) => {
      if (k.toLowerCase() !== "transfer-encoding") res.setHeader(k, v);
    });

    res.status(upstream.status);
    upstream.data.pipe(res);
  } catch (err) {
    console.error("Proxy failed:", err?.message);
    const code = err?.response?.status || 502;
    res.status(code).json({ error: "Proxy failed" });
  }
});

module.exports = router;
