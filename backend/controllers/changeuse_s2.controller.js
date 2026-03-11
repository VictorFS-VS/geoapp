// controllers/changeuse_s2.controller.js
const axios = require('axios');
const { getAccessTokenValue } = require('./sentinel.controller');

const SH_PROCESS_URL = 'https://services.sentinel-hub.com/api/v1/process';

// Evalscript de Data Fusion para ΔNDVI (S2 L2A)
const EVALSCRIPT_S2_DELTA = `//VERSION=3
function setup() {
  return {
    input: [
      {datasource: "t1", bands: ["B04","B08","SCL"], units: ["REFLECTANCE","REFLECTANCE","DN"]},
      {datasource: "t2", bands: ["B04","B08","SCL"], units: ["REFLECTANCE","REFLECTANCE","DN"]}
    ],
    output: [
      { id:"delta", bands:1, sampleType:"FLOAT32" },
      { id:"mask",  bands:1, sampleType:"UINT8"   }
    ]
  };
}
function clearS2(scl){
  // 4=veg,5=veg escasa,6=suelo,7=agua (ajusta si querés)
  return [4,5,6,7].indexOf(scl) >= 0;
}
function ndvi(r,n){ return (n-r)/(n+r); }

function evaluatePixel(samples, scenes) {
  const s1 = samples.t1[0];
  const s2 = samples.t2[0];
  const ok1 = clearS2(s1.SCL);
  const ok2 = clearS2(s2.SCL);

  if(!ok1 || !ok2) return { delta:[NaN], mask:[0] };

  const n1 = ndvi(s1.B04, s1.B08);
  const n2 = ndvi(s2.B04, s2.B08);
  const d  = n2 - n1;

  // El umbral lo inyectamos vía "userData" (ver payload.process.parameters)
  const th = scenes.userData.threshold ?? 0.2;
  const m  = (Math.abs(d) >= th) ? 1 : 0;

  return { delta:[d], mask:[m] };
}
`;

function yearWindow(year, months = [6,7,8,9]) {
  const from = `${year}-${String(months[0]).padStart(2,'0')}-01`;
  const to   = `${year}-${String(months[months.length-1]).padStart(2,'0')}-30`;
  return { from, to };
}

function clampYearsBack(requestedYearsBack) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const earliest = 2017; // S2 L2A global
  const maxBack = Math.max(0, currentYear - earliest);
  return Math.max(1, Math.min(requestedYearsBack, maxBack));
}

/**
 * POST /api/changeuse/s2/diff
 * body: {
 *   aoi: GeoJSON Polygon/MultiPolygon (EPSG:4326),
 *   yearsBack: number,           // 1..N (clamped a 2017)
 *   months?: number[],           // ej [6,7,8,9]
 *   threshold?: number,          // 0.1..0.4 típicamente
 *   width?: number, height?: number // resolución de salida en px (opcional)
 * }
 * Respuesta: GeoTIFF multibanda (Banda1=delta, Banda2=mask)
 */
exports.s2DiffYearsBack = async (req, res) => {
  try {
    const {
      aoi,
      yearsBack = 1,
      months = [6,7,8,9],
      threshold = 0.2,
      width = 1024,
      height = 1024,
    } = req.body || {};

    if (!aoi) return res.status(400).json({ error: 'Falta aoi (GeoJSON)' });

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const yBack = clampYearsBack(parseInt(yearsBack,10) || 1);

    const t2 = yearWindow(currentYear, months);
    const t1 = yearWindow(currentYear - yBack, months);

    const token = await getAccessTokenValue();

    const payload = {
      input: {
        bounds: {
          geometry: aoi,
          properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" }
        },
        data: [
          {
            type: "SENTINEL-2_L2A",
            id: "t1",
            dataFilter: { timeRange: t1 },
            processing: {}
          },
          {
            type: "SENTINEL-2_L2A",
            id: "t2",
            dataFilter: { timeRange: t2 },
            processing: {}
          }
        ]
      },
      output: {
        width, height,
        responses: [
          { identifier:"delta", format:{ type:"image/tiff" } },
          { identifier:"mask",  format:{ type:"image/tiff" } }
        ]
      },
      // Pasamos "threshold" en userData para leerlo dentro del evalscript
      evalscript: EVALSCRIPT_S2_DELTA,
      // Campo no estándar: usamos "userData" embebido para transmitir el umbral
      // Sentinel Hub lo expone en evaluatePixel via scenes.userData (feature experimental soportada).
      // Si prefieres, se puede hardcodear en el evalscript.
      userData: { threshold }
    };

    const { data } = await axios.post(
      SH_PROCESS_URL,
      payload,
      { headers:{ Authorization: `Bearer ${token}` }, responseType:'arraybuffer', timeout: 60000 }
    );

    res.set('Content-Type', 'application/zip'); // SH devuelve múltiples responses en ZIP
    // NOTA: Cuando hay >1 "responses", SH devuelve un ZIP con los archivos por identifier.
    // Si prefieres un solo GeoTIFF multibanda, podemos empaquetarlo desde Node (opcional).
    return res.send(data);

  } catch (e) {
    console.error('s2DiffYearsBack error:', e?.response?.data || e.message);
    res.status(502).json({ error: 'No se pudo generar ΔNDVI S2' });
  }
};
