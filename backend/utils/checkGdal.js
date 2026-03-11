// backend/utils/checkGdal.js
const { spawnSync } = require("child_process");

function checkGdal() {
  try {
    const r = spawnSync("ogr2ogr", ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });

    // si el comando no existe / no se puede ejecutar
    if (r.error) {
      console.warn("[WARN] GDAL no disponible (ogr2ogr):", r.error.message);
      return false;
    }

    const out = String(r.stdout || "").trim();
    const err = String(r.stderr || "").trim();

    if (r.status === 0) {
      console.log("[OK] GDAL disponible:", out || err || "(sin salida)");
      return true;
    }

    console.warn("[WARN] GDAL respondió con error:", err || out || `(status=${r.status})`);
    return false;
  } catch (e) {
    console.warn("[WARN] GDAL no disponible:", e.message);
    return false;
  }
}

module.exports = { checkGdal };
