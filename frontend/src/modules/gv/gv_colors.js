export function getPhaseHex(phaseIndex, phaseTotal) {
    if (phaseIndex === 0) return "#ffffff";
    if (phaseIndex === 1) return "#facc15";
    if (phaseIndex === phaseTotal) return "#22c55e";

    const palette = ["#ef4444", "#3b82f6", "#a855f7", "#06b6d4", "#6b7280", "#ec4899", "#111827", "#f97316"];
    const paletteIndex = (phaseIndex - 2) % palette.length;
    return palette[Math.max(0, paletteIndex)] || "#9ca3af";
}

export function getPhaseBorderHex(phaseIndex) {
    if (phaseIndex === 0) return "#9ca3af";
    // En este contexto usamos el mismo hex pero en el chart añadiremos un border width
    // Aquí podemos llamar a la misma lógica de hex solo para el index provisto con phaseTotal alto para que no de verde prematuramente.
    // Pero lo ideal es simplemente que getPhaseBorderHex también requiera phaseTotal, 
    // O podemos exportarlo así si la regla dice "- si blanco -> '#9ca3af', caso contrario -> mismo color".
    return phaseIndex === 0 ? "#9ca3af" : null; // Se procesará en el GVCharts
}
