"use strict";

function toInt(v, fallback = null) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Pick a "focus" plantilla when the Home is requested without id_plantilla.
 * V1 rule: dominant plantilla by total_informes in rawResumen.plantillas.
 *
 * Returns:
 *   { id_plantilla, nombre, source: "auto_dominant" }
 * or null.
 */
function getProjectHomeFocusPlantilla(rawResumen) {
  const plantillas = Array.isArray(rawResumen?.plantillas) ? rawResumen.plantillas : [];
  if (!plantillas.length) return null;

  const normalized = plantillas
    .map((p) => ({
      id_plantilla: toInt(p?.id_plantilla, null),
      nombre: p?.nombre ?? null,
      total_informes: toInt(p?.total_informes, 0) || 0,
      ultimo: p?.ultimo ?? null,
    }))
    .filter((p) => p.id_plantilla && p.id_plantilla > 0 && p.total_informes > 0);

  if (!normalized.length) return null;

  normalized.sort((a, b) => {
    if (b.total_informes !== a.total_informes) return b.total_informes - a.total_informes;
    // deterministic tie-breakers (optional fields)
    const au = a.ultimo ? String(a.ultimo) : "";
    const bu = b.ultimo ? String(b.ultimo) : "";
    if (bu !== au) return bu.localeCompare(au);
    return a.id_plantilla - b.id_plantilla;
  });

  const top = normalized[0];
  return {
    id_plantilla: top.id_plantilla,
    nombre: top.nombre,
    source: "auto_dominant",
  };
}

module.exports = { getProjectHomeFocusPlantilla };

