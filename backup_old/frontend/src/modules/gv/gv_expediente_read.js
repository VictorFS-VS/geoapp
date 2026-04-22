import { apiFetch } from "../../services/api";

/**
 * Obtiene las etapas del expediente según el tipo (mejora/terreno).
 * GET /api/expedientes/{id}/etapas/{tipo}
 */
export async function gvReadEtapas(expedienteId, tipo) {
    if (!expedienteId || !tipo) return {};
    try {
        return await apiFetch(`/expedientes/${expedienteId}/etapas/${tipo}`);
    } catch (err) {
        // console.error(err);
        return {};
    }
}

/**
 * Obtiene el listado de documentos y normaliza indicadores.
 * GET /api/expedientes/{id}/documentos?carpeta={carpeta}
 */
export async function gvReadDocs(expedienteId, carpeta = "") {
    if (!expedienteId) return { totalFiles: 0, totalSubcarpetas: 0, has_ci: false, has_dbi: false, files: [] };

    try {
        const data = await apiFetch(`/expedientes/${expedienteId}/documentos?carpeta=${encodeURIComponent(carpeta)}`);
        const files = Array.isArray(data) ? data : [];

        const subcarpetas = new Set();
        let has_ci = false;
        let has_dbi = false;

        files.forEach(f => {
            if (f.subcarpeta) subcarpetas.add(f.subcarpeta);
            if (f.subcarpeta?.toLowerCase() === "ci") has_ci = true; // asunción basada en uso
            if (f.subcarpeta?.toLowerCase() === "dbi") has_dbi = true;
        });

        return {
            totalFiles: files.length,
            totalSubcarpetas: subcarpetas.size,
            has_ci,
            has_dbi,
            files
        };
    } catch (err) {
        return { totalFiles: 0, totalSubcarpetas: 0, has_ci: false, has_dbi: false, files: [] };
    }
}

/**
 * Infiere el tipo de expediente.
 */
export function gvInferTipo({ tipo, fase_total }) {
    if (tipo === "mejora" || tipo === "terreno") return tipo;
    const total = Number(fase_total || 0);
    if (total === 5) return "mejora";
    if (total === 7) return "terreno";
    return null;
}

/**
 * Calcula porcentaje de fase de forma segura.
 */
export function gvComputePhaseSafe({ fase_index, fase_total }) {
    const idx = Number(fase_index || 0);
    const total = Number(fase_total || 0);
    const pct = total > 0 ? (idx / total) * 100 : 0;

    return {
        fase_index: idx,
        fase_total: total,
        fase_pct: pct.toFixed(1)
    };
}

/**
 * Lee el expediente completo
 */
export async function gvReadExpediente(expId) {
    return await apiFetch(`/expedientes/${expId}`);
}
