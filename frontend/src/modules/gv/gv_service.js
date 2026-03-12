import { apiFetch } from "../../services/api";

export async function gvGetDashboard(proyectoId) {
    return await apiFetch(`/gv/catastro/dashboard?proyectoId=${proyectoId}`);
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
