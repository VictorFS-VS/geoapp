import React from "react";
import { getPhaseHex, getPhaseBorderHex } from "./gv_colors";

export default function GvPhaseChip({ phaseIndex, phaseTotal = 7, label }) {
    const bg = getPhaseHex(phaseIndex, phaseTotal);
    const border = getPhaseBorderHex(phaseIndex) || bg;

    // Si el color de fondo es el oscuro de la paleta (F8, index 8, #111827), forzamos color blanco, sino negro o heredado
    const isDarkBg = bg === "#111827";

    return (
        <span
            className="badge rounded-pill border"
            style={{
                backgroundColor: bg,
                borderColor: border,
                color: isDarkBg ? "#ffffff" : "#000000",
                fontWeight: 500
            }}
        >
            {label}
        </span>
    );
}
