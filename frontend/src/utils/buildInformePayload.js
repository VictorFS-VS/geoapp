// utils/buildInformePayload.js (o dentro de tu componente)
const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const isEmpty = (v) => {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
};

/**
 * Convierte un valor de formulario en el formato que tu backend suele esperar:
 * - boolean => valor_bool
 * - array (multiselect) => valor_json (JSON.stringify(array))
 * - number => valor_texto (string) o valor_json si preferís (acá lo mandamos como texto)
 * - string => valor_texto
 */
function normalizeRespuestaValue(raw) {
  // multiselect (checkbox group)
  if (Array.isArray(raw)) {
    const cleanArr = raw
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter((x) => x !== "");
    if (!cleanArr.length) return null;

    return {
      valor_bool: null,
      valor_texto: null,
      valor_json: JSON.stringify(cleanArr),
    };
  }

  // boolean
  if (typeof raw === "boolean") {
    return { valor_bool: raw, valor_texto: null, valor_json: null };
  }

  // string / number
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;

  return { valor_bool: null, valor_texto: s, valor_json: null };
}

/**
 * buildInformePayload
 * @param {Object} args
 * @param {number} args.id_proyecto
 * @param {number} args.id_plantilla
 * @param {string} args.titulo
 * @param {Object} args.respuestasByPregunta  // { [id_pregunta]: value } value puede ser string|bool|array
 * @param {Object|null} args.coords           // { lat, lng } o null
 */
export function buildInformePayload({
  id_proyecto,
  id_plantilla,
  titulo,
  respuestasByPregunta,
  coords,
}) {
  const pid = Number(id_proyecto) || null;
  const plantillaId = Number(id_plantilla) || null;

  // Coordenadas (números)
  const lat = toNum(coords?.lat);
  const lng = toNum(coords?.lng);

  // Armar respuestas
  const respuestas = [];
  const entries = Object.entries(respuestasByPregunta || {});

  for (const [idpStr, raw] of entries) {
    const id_pregunta = Number(idpStr);
    if (!id_pregunta) continue;

    // si es vacío, no mandamos
    if (isEmpty(raw)) continue;

    const normalized = normalizeRespuestaValue(raw);
    if (!normalized) continue;

    respuestas.push({
      id_pregunta,
      ...normalized,
    });
  }

  const payload = {
    id_proyecto: pid,
    id_plantilla: plantillaId,
    titulo: (titulo || "").trim() || null,

    // ✅ respuestas
    respuestas,

    // ✅ coordenadas (mandamos ambas variantes por compatibilidad)
    lat,
    lng,
    coor_lat: lat,
    coor_lng: lng,
  };

  // Limpieza final (quitar nulls innecesarios si querés)
  // (yo lo dejo así porque muchos backends aceptan null)
  return payload;
}
