/**
 * Checks if a value is truthy in a robust way (supports strings like "true", "1", "yes").
 */
export function isOk(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        const s = value.toLowerCase().trim();
        return ["1", "true", "t", "yes", "y"].includes(s);
    }
    return false;
}

/**
 * Retorna las llaves ordenadas de las etapas según el tipo (CANON).
 * Debe coincidir con backend (gv_controller.js).
 */
export function getCanonStageKeys(tipo) {
    if (tipo === "mejora") {
        return [
            "documentacion",
            "plano_georef",
            "avaluo",
            "notif_conformidad",
            "documentacion_final",
        ];
    }
    if (tipo === "terreno") {
        return [
            "documentacion",
            "plano_georef",
            "informe_pericial",
            "plantilla",
            "avaluo",
            "notif_conformidad",
            "documentacion_final",
        ];
    }
    return [];
}

/**
 * Determina el orden de etapas. Por ahora solo usa el canon.
 */
export function resolveStageOrder(tipo, etapasObj = null) {
    return getCanonStageKeys(tipo);
}

/**
 * Computes phase metadata (index, label, next stage).
 */
export function computePhaseMeta(etapasObj, stageKeys) {
    let completed = 0;
    const stages = stageKeys || [];
    const totalCount = stages.length;

    for (const key of stages) {
        const val = etapasObj?.[key];
        // Soportamos {ok: true} o booleano directo
        const okVal = (val && typeof val === 'object') ? val.ok : val;

        if (isOk(okVal)) {
            completed++;
        } else {
            break;
        }
    }

    const faseIndex = completed;
    const fasePct = totalCount > 0 ? completed / totalCount : 0;

    let faseLabel = `F${faseIndex}`;
    if (totalCount > 0 && completed === totalCount) {
        faseLabel = "FINAL";
    }

    const nextKey = (totalCount > 0 && completed < totalCount) ? stages[completed] : null;

    return {
        completedCount: completed,
        totalCount,
        faseIndex,
        fasePct,
        faseLabel,
        nextKey,
        nextLabel: nextKey ? humanizeKey(nextKey) : null
    };
}

/**
 * Humanizes a key using a static map.
 */
export function humanizeKey(key) {
    if (!key) return "";

    const MAP = {
        documentacion: "Documentación",
        plano_georef: "Plano georreferenciado (polígono)",
        informe_pericial: "Informe pericial",
        plantilla: "Plantilla",
        avaluo: "Avalúo",
        notif_conformidad: "Notificación y conformidad",
        documentacion_final: "Documentación final"
    };

    if (MAP[key]) return MAP[key];

    // Fallback: Title Case
    return key
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
