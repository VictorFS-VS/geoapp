import { apiFetch } from "../../services/api";

export async function gvGetDashboard(proyectoId, params = {}) {
    const qs = new URLSearchParams();
    if (proyectoId) qs.set("proyectoId", proyectoId);
    if (params.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
    if (params.fechaFin) qs.set("fechaFin", params.fechaFin);
    return await apiFetch(`/gv/catastro/dashboard?${qs.toString()}`);
}

export async function gvGetAvanceTemporal(params = {}) {
    const qs = new URLSearchParams();
    if (params.proyectoId) qs.set("proyectoId", params.proyectoId);
    if (params.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
    if (params.fechaFin) qs.set("fechaFin", params.fechaFin);
    if (params.granularidad) qs.set("granularidad", params.granularidad);
    if (params.tramoId) qs.set("tramoId", params.tramoId);
    if (params.subtramoId) qs.set("subtramoId", params.subtramoId);
    if (params.tipo) qs.set("tipo", params.tipo);
    return await apiFetch(`/gv/catastro/analytics/avance-temporal?${qs.toString()}`);
}

export async function gvGetDetalleTemporal(params = {}) {
    const qs = new URLSearchParams();
    if (params.proyectoId) qs.set("proyectoId", params.proyectoId);
    if (params.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
    if (params.fechaFin) qs.set("fechaFin", params.fechaFin);
    if (params.granularidad) qs.set("granularidad", params.granularidad);
    if (params.categoria) qs.set("categoria", params.categoria);
    if (params.modo) qs.set("modo", params.modo);
    if (params.tramoId) qs.set("tramoId", params.tramoId);
    if (params.subtramoId) qs.set("subtramoId", params.subtramoId);
    return await apiFetch(`/gv/catastro/analytics/detalle-temporal?${qs.toString()}`);
}

export async function gvGetEconomico(params = {}) {
    const qs = new URLSearchParams();
    if (params.proyectoId) qs.set("proyectoId", params.proyectoId);
    if (params.tramoId) qs.set("tramoId", params.tramoId);
    if (params.subtramoId) qs.set("subtramoId", params.subtramoId);
    if (params.tipo) qs.set("tipo", params.tipo);
    if (params.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
    if (params.fechaFin) qs.set("fechaFin", params.fechaFin);
    return await apiFetch(`/gv/catastro/analytics/economico?${qs.toString()}`);
}

export async function gvGetMap(proyectoId) {
    return await apiFetch(`/gv/catastro/map?proyectoId=${proyectoId}`);
}

export async function gvGetExpedienteEtapas(id, tipo) {
    return await apiFetch(`/expedientes/${id}/etapas/${tipo}`);
}

export async function gvGetExpedienteDocs(id) {
    // Replicamos la lógica de Expedientes.jsx: GET /api/expedientes/:id/documentos?carpeta=
    return await apiFetch(`/expedientes/${id}/documentos?carpeta=`);
}

export async function gvGetExpediente(expId) {
    return await apiFetch(`/expedientes/${expId}`);
}

export async function gvGetTramosCensales(proyectoId) {
    return await apiFetch(`/proyectos/${proyectoId}/tramos-censales`);
}

export async function gvGetSubtramosCensales(proyectoId, tramoId) {
    return await apiFetch(`/proyectos/${proyectoId}/tramos-censales/${tramoId}/subtramos`);
}
