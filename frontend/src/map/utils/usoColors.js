// src/map/utils/usoColors.js

// ✅ Reglas de canonización (las tuyas)
export const CANON_RULES = [
  [/^uso\s*agri/i, "uso agricola"],
  [/^uso\s*ganad/i, "uso ganadero"],
  [/^uso\s*agropecu/i, "uso agropecuario"],
  [/^isletas?/i, "isletas"],
  [/^area\s+en\s+regeneracion(?:\s+para(?:\s*br)?)?/i, "area en regeneracion"],
  [/^zona\s+inundable/i, "zona inundable"],
  [/^cuerpo[s]?\s+de\s+agua/i, "cuerpos de agua"],
  [/^plantacion(?:es)?\s+forestal(?:es)?/i, "plantaciones forestales"],
  [/^bosques?\s+de\s+reserva\s+forestal\s+bajo\s+manejo/i, "bosques de reserva forestal bajo manejo"],
  [/^bosques?\s+excedentes?\s+de\s+reserva\s+forestal/i, "bosques excedentes de reserva forestal"],
  [/^bosques?\s+de\s+reserva\s+forestal/i, "bosques de reserva forestal"],
  [/^bosques?\s+protectores?\s+de\s+cauces?\s+hidric/i, "bosques protectores de cauces hidricos"],
  [/^zonas?\s+de\s+proteccion\s+de\s+cauces?\s+hidric/i, "zonas de proteccion de cauces hidricos"],
  [/^zona\s+de\s+restriccion/i, "zona de restriccion en margenes de cauces hidricos"],
  [/^(infraestructura)(\b| ?-)/i, "infraestructura"],
  [/^caminos?\s*cortafuego/i, "caminos cortafuego"],
  [/^barreras?\s+vivas?/i, "barreras vivas de proteccion"],
  [/^franjas?\s+de\s+separacion/i, "franjas de separacion"],
  [/^campo\s+natural/i, "campo natural"],
  [/^matorral(?:es)?/i, "matorrales"],
  [/^esteros?/i, "esteros"],
  [/^manantiales?/i, "manantiales"],
  [/^arrozales?/i, "arrozales"],
  [/^canales?/i, "canales"],
  [/^oleri[aá]/i, "oleria"],
  [/^galpon(?:es)?/i, "galpones"],
  [/^corrales?/i, "corrales"],
  [/^caminos?$/i, "caminos"],
  [/^area\s+de\s+acopio/i, "area de acopio"],
  [/^area\s+industrial/i, "area industrial"],
  [/^servicios?\s+ambientales?/i, "servicios ambientales"],
  [/^comunidades?\s+indigenas?/i, "comunidades indigenas"],
  [/^otros?\s+usos?/i, "otros usos"],
];

// ✅ Colores (los tuyos)
export const COLORS = {
  "bosques de reserva forestal": [38, 115, 0],
  "bosques excedentes de reserva forestal": [112, 168, 0],
  "bosques de reserva forestal bajo manejo": [92, 137, 68],
  "bosques protectores de cauces hidricos": [190, 232, 255],
  "zonas de proteccion de cauces hidricos": [122, 245, 202],
  "zona de restriccion en margenes de cauces hidricos": [0, 230, 169],
  "barreras vivas de proteccion": [230, 152, 0],
  "franjas de separacion": [230, 152, 0],
  "caminos cortafuego": [245, 202, 122],
  "area en regeneracion": [165, 245, 122],
  "area a reforestar": [137, 205, 102],
  "area silvestre protegida": [115, 76, 0],
  "uso agricola": [255, 255, 0],
  "uso ganadero": [205, 102, 153],
  "uso agropecuario": [255, 211, 127],
  arrozales: [255, 255, 190],
  canales: [0, 132, 168],
  "plantaciones forestales": [0, 168, 132],
  "uso silvopastoril": [163, 255, 115],
  "campo natural": [205, 245, 122],
  matorrales: [114, 137, 68],
  "cuerpos de agua": [0, 92, 230],
  esteros: [0, 169, 230],
  manantiales: [0, 76, 115],
  "zona inundable": [115, 223, 255],
  "cultivos ilegales": [169, 0, 230],
  "area invadida": [202, 122, 245],
  "area siniestrada": [230, 0, 169],
  loteamientos: [130, 130, 130],
  "contribucion inmobiliaria obligatoria": [115, 115, 0],
  "construcciones edilicias": [225, 225, 225],
  cementerio: [190, 210, 255],
  "area de destape": [205, 137, 102],
  oleria: [245, 122, 182],
  "area de prestamo": [215, 176, 158],
  arenera: [245, 245, 122],
  "area de nivelacion": [215, 215, 158],
  polvorin: [178, 178, 178],
  "planta trituradora": [230, 230, 0],
  "planta asfaltica": [115, 0, 0],
  "area de maniobra y estacionamiento": [255, 255, 255],
  caminos: [225, 190, 190],
  "pista de aterrizaje": [232, 190, 255],
  "estacion de servicio": [223, 115, 255],
  silo: [68, 79, 137],
  deposito: [122, 182, 245],
  "area de acopio": [102, 119, 205],
  corrales: [245, 202, 122],
  galpones: [68, 101, 137],
  "abastecimiento de agua": [190, 255, 232],
  canchadas: [205, 102, 102],
  puerto: [137, 68, 101],
  "area industrial": [255, 127, 127],
  infraestructura: [168, 0, 0],
  "fosa o trinchera": [168, 0, 132],
  "area de segregacion": [122, 142, 245],
  "pileta de agregar uso": [102, 205, 171],
  "area de servidumbre": [112, 68, 137],
  "resto de propiedad": [255, 255, 255],
  "servicios ambientales": [170, 255, 0],
  "comunidades indigenas": [137, 90, 68],
  "otros usos": [158, 187, 215],
  isletas: [152, 230, 0],
};

export const normKey = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const rgbCss = (rgb, a = 1) => {
  const [r, g, b] = rgb || [120, 120, 120];
  if (a >= 1) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${a})`;
};

export function canonicalizeCategory(raw) {
  const cleaned = normKey(raw);
  if (!cleaned) return { key: "sin-categoria", label: "Sin categoría" };

  for (const [re, key] of CANON_RULES) {
    if (re.test(raw || "")) return { key, label: key };
  }
  return { key: cleaned, label: cleaned };
}

export function getUsoLabelFromFeature(featureOrProps) {
  if (featureOrProps && typeof featureOrProps.getProperty === "function") {
    return (
      featureOrProps.getProperty("categoria") ||
      featureOrProps.getProperty("uso") ||
      featureOrProps.getProperty("clase") ||
      featureOrProps.getProperty("name") ||
      ""
    );
  }
  const p = featureOrProps?.properties || featureOrProps || {};
  return p.categoria || p.uso || p.clase || p.name || "";
}

/** ✅ UNIFICADO con tu app: token | access_token | jwt */
export function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("authToken");

  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** ✅ Acepta GeoJSON directo o envuelto en {ok:true,data:...} */
function unwrapGeoJSON(payload) {
  if (!payload) return null;
  if (payload.type && payload.features) return payload; // FeatureCollection
  if (payload.features && Array.isArray(payload.features)) return payload; // a veces sin type
  if (payload.ok === true && payload.data) return unwrapGeoJSON(payload.data);
  if (payload.data) return unwrapGeoJSON(payload.data);
  return null;
}

/** ✅ Igual que tu código anterior: prueba varias URLs y se queda con la que exista */
export async function fetchGeoJSONSmart(candidateUrls) {
  let lastErr = null;

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, { headers: { ...authHeaders() } });

      if (!resp.ok) {
        if (resp.status === 404) continue; // probar siguiente
        const txt = await resp.text().catch(() => "");
        throw new Error(txt || `HTTP ${resp.status}`);
      }

      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      const text = await resp.text();
      const json =
        ct.includes("json") || ct.includes("geo+json")
          ? JSON.parse(text || "null")
          : (() => {
              try {
                return JSON.parse(text || "null");
              } catch {
                return null;
              }
            })();

      const geo = unwrapGeoJSON(json);
      if (!geo) throw new Error("Respuesta inválida (no GeoJSON).");

      return { urlOk: url, data: geo };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("No se pudo obtener GeoJSON.");
}

export function getColorForUso(rawCategoria) {
  const { key, label } = canonicalizeCategory(rawCategoria);
  const rgb = COLORS[key] || [120, 120, 120];
  return { key, label, rgb };
}
