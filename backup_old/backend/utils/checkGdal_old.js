// backend/utils/checkGdal.js
const { checkGdalBinary } = require("./gdal");

function checkGdal() {
  try {
    const result = checkGdalBinary("ogr2ogr");

    if (!result.ok && result.error) {
      console.warn("[WARN] GDAL no disponible (ogr2ogr):", result.error.message);
      return false;
    }

    const out = String(result.stdout || "").trim();
    const err = String(result.stderr || "").trim();

    if (result.status === 0) {
      console.log("[OK] GDAL disponible:", out || err || "(sin salida)");
      return true;
    }

    console.warn("[WARN] GDAL respondió con error:", err || out || `(status=${result.status})`);
    return false;
  } catch (e) {
    console.warn("[WARN] GDAL no disponible:", e.message);
    return false;
  }
}

module.exports = { checkGdal };
