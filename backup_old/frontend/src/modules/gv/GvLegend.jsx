import React from "react";
import { getPhaseHex } from "./gv_colors";

export default function GvLegend({ maxFases = 7 }) {
    const phases = [];
    for (let i = 0; i <= maxFases; i++) {
        phases.push(i);
    }

    const getPhaseText = (i, total) => {
        if (i === 0) return "Censo (sin docs)";
        if (i === 1) return "Documentación";
        if (i === total) return "Final";
        return `Intermedia`;
    };

    return (
        <div className="d-flex flex-wrap gap-2 text-sm mt-2 gv-legend">
            {phases.map((i) => {
                const bg = getPhaseHex(i, maxFases);
                const nameText = `F${i}: ${getPhaseText(i, maxFases)}`;

                return (
                    <div key={i} className="gv-legend-item d-flex align-items-center">
                        <span
                            className="gv-legend-color border shadow-sm"
                            style={{
                                backgroundColor: bg,
                                display: "inline-block",
                                width: "14px",
                                height: "14px",
                                borderRadius: "3px",
                                marginRight: "6px"
                            }}
                        ></span>
                        <small className="text-secondary">{nameText}</small>
                    </div>
                )
            })}
        </div>
    );
}
