"use strict";

/**
 * Helpers y constantes compartidas para el estilo visual del Dashboard de Informes.
 * Centralizado aquí para evitar dependencias circulares entre controladores.
 */

const MAP_KPI_DEFAULT_COLOR_HEX = "#6366f1"; // Indigo default

const MAP_KPI_CATEGORY_PALETTE = [
  "#6366f1", // Indigo 500
  "#10b981", // Emerald 500
  "#f59e0b", // Amber 500
  "#f43f5e", // Rose 500
  "#06b6d4", // Cyan 500
  "#8b5cf6", // Violet 500
  "#fb923c", // Orange 500
  "#3b82f6", // Blue 500
  "#22c55e", // Green 500
  "#64748b", // Slate 500 (Gris de contraste)
];

/**
 * Resuelve el color hexadecimal para un estado de semáforo.
 * @param {string} colorKey - 'verde', 'amarillo', 'naranja', 'rojo', 'gris'
 * @returns {string} HEX color
 */
function semaforoColorHexFromKey(colorKey) {
  const key = String(colorKey || "").trim().toLowerCase();
  if (key === "verde") return "#10b981"; // Emerald 500
  if (key === "amarillo") return "#facc15"; // Yellow 400
  if (key === "naranja") return "#f97316"; // Orange 500
  if (key === "rojo") return "#f43f5e"; // Rose 500
  if (key === "gris") return "#94a3b8"; // Slate 400
  return "#94a3b8";
}

module.exports = {
  MAP_KPI_DEFAULT_COLOR_HEX,
  MAP_KPI_CATEGORY_PALETTE,
  semaforoColorHexFromKey,
};
