import { useState, useEffect, useCallback } from 'react';

function normalizeApiBase(base) {
  const b = String(base || "").trim();
  if (!b) return "";
  return b.endsWith("/api") ? b : b.replace(/\/+$/, "") + "/api";
}

const API_URL = normalizeApiBase(import.meta.env.VITE_API_URL) || "http://localhost:4000/api";

const authHeaders = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

export function useInformesQuery(idProyecto, idPlantillaFiltro, options = {}) {
  const { search = "", page = 1, limit = 20, conDiagnostico, sort_by, sort_order } = options;

  const [informes, setInformes] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, total_pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [preguntasPlantilla, setPreguntasPlantilla] = useState([]);
  const [formulaActiva, setFormulaActiva] = useState(null);

  useEffect(() => {
    if (idPlantillaFiltro) {
      fetch(`${API_URL}/informes/plantillas/${idPlantillaFiltro}`, { headers: authHeaders() })
        .then(r => r.json())
        .then(d => {
          const allPreguntas = d.secciones ? d.secciones.flatMap(s => s.preguntas || []) : [];
          setPreguntasPlantilla(allPreguntas);
        })
        .catch(err => console.error("Error cargando preguntas de plantilla:", err));
      
      fetch(`${API_URL}/diagnostico/plantilla/${idPlantillaFiltro}`, { headers: authHeaders() })
        .then(r => r.json())
        .then(res => {
          if (res.ok && res.formula) setFormulaActiva(res.formula);
          else setFormulaActiva(null);
        })
        .catch(() => setFormulaActiva(null));
    } else {
      setPreguntasPlantilla([]);
      setFormulaActiva(null);
    }
  }, [idPlantillaFiltro]);

  const cargarInformes = useCallback(async () => {
    if (!idProyecto) return;
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ id_proyecto: idProyecto, page, limit });
      if (idPlantillaFiltro) params.append("id_plantilla", idPlantillaFiltro);
      if (search) params.append("search", search);
      if (conDiagnostico !== undefined) params.append("con_diagnostico", conDiagnostico);
      if (sort_by) params.append("sort_by", sort_by);
      if (sort_order) params.append("sort_order", sort_order);

      const resp = await fetch(`${API_URL}/informes/query?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      const data = await resp.json();
      setInformes(data.data || data.informes || []);
      if (data.meta) setMeta(data.meta);
    } catch (err) {
      console.error("Error cargando informes:", err);
      setError("No se pudieron cargar los informes.");
    } finally {
      setLoading(false);
    }
  }, [idProyecto, idPlantillaFiltro, search, page, limit, conDiagnostico, sort_by, sort_order]);

  useEffect(() => {
    // Debounce manual simple para la API (útil si el componente padre no debouncea el state 'search')
    const timeoutId = setTimeout(() => {
      cargarInformes();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [cargarInformes]);

  return {
    informes,
    meta,
    loading,
    error,
    preguntasPlantilla,
    formulaActiva,
    cargarInformes
  };
}
