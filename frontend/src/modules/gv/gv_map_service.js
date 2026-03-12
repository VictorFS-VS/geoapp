import { apiFetch } from "../../services/api";

export async function fetchCatastroMap({ proyectoId, filters = {} }) {
    const params = new URLSearchParams()
    params.append("proyectoId", proyectoId)

    if (filters.tipo) params.append("tipo", filters.tipo)
    if (filters.fase !== undefined && filters.fase !== "") params.append("fase", filters.fase)
    if (filters.faseMin !== undefined && filters.faseMin !== "") params.append("faseMin", filters.faseMin)
    if (filters.faseMax !== undefined && filters.faseMax !== "") params.append("faseMax", filters.faseMax)
    if (filters.q !== undefined && filters.q !== "") params.append("q", filters.q)
    if (filters.tramo !== undefined && filters.tramo !== "") params.append("tramo", filters.tramo)
    if (filters.subtramo !== undefined && filters.subtramo !== "") params.append("subtramo", filters.subtramo)

    if (filters.hasPolygon !== undefined && filters.hasPolygon !== "") params.append("hasPolygon", filters.hasPolygon)
    if (filters.hasPoint !== undefined && filters.hasPoint !== "") params.append("hasPoint", filters.hasPoint)
    if (filters.hasDocs !== undefined && filters.hasDocs !== "") params.append("hasDocs", filters.hasDocs)
    if (filters.hasCI !== undefined && filters.hasCI !== "") params.append("hasCI", filters.hasCI)
    if (filters.hasDBI !== undefined && filters.hasDBI !== "") params.append("hasDBI", filters.hasDBI)

    return await apiFetch(`/gv/catastro/map?${params.toString()}`)
}
