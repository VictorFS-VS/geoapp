import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getResumen, getPlantillas, getPlantillaMetadata } from "../services/informesDashboardService";

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function useInformesDashboard() {
  const [searchParams] = useSearchParams();

  const params = useMemo(() => {
    const idProyectoRaw =
      searchParams.get("id_proyecto") ||
      searchParams.get("idProyecto") ||
      "";
    const idPlantillaRaw = searchParams.get("id_plantilla") || "";
    const desde = searchParams.get("desde") || "";
    const hasta = searchParams.get("hasta") || "";
    const soloCerradosRaw = searchParams.get("solo_cerrados");

    const id_proyecto = toPositiveInt(idProyectoRaw);
    const id_plantilla = toPositiveInt(idPlantillaRaw);
    const solo_cerrados =
      soloCerradosRaw === null
        ? undefined
        : ["1", "true", "t", "si", "sí", "y", "yes"].includes(
            String(soloCerradosRaw).trim().toLowerCase()
          );

    return {
      id_proyecto,
      id_plantilla,
      desde: desde || undefined,
      hasta: hasta || undefined,
      solo_cerrados,
    };
  }, [searchParams]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const [plantillasLoading, setPlantillasLoading] = useState(false);
  const [plantillasError, setPlantillasError] = useState("");
  const [plantillas, setPlantillas] = useState([]);

  const [selectedPlantillaId, setSelectedPlantillaId] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState("");
  const [metadata, setMetadata] = useState(null);

  const [selectedFieldIds, setSelectedFieldIds] = useState(new Set());
  const [selectedFilterFieldIds, setSelectedFilterFieldIds] = useState(new Set());
  const [dynamicFilters, setDynamicFilters] = useState({});

  const [appliedPlantillaId, setAppliedPlantillaId] = useState(null);
  const [appliedPlantillaLabel, setAppliedPlantillaLabel] = useState("");
  const [appliedSelectedFieldIds, setAppliedSelectedFieldIds] = useState(new Set());
  const [appliedFilterFieldIds, setAppliedFilterFieldIds] = useState(new Set());
  const [appliedDynamicFilters, setAppliedDynamicFilters] = useState({});
  const [appliedFiltersPayload, setAppliedFiltersPayload] = useState([]);
  const [appliedFieldLabels, setAppliedFieldLabels] = useState([]);
  const [appliedFiltersSummary, setAppliedFiltersSummary] = useState([]);
  const [fieldChartTypes, setFieldChartTypes] = useState({});
  const [showPercentages, setShowPercentages] = useState(true);

  const availableFields = useMemo(() => {
    const secs = Array.isArray(metadata?.secciones) ? metadata.secciones : [];
    const out = [];
    for (const s of secs) {
      const preguntas = Array.isArray(s?.preguntas) ? s.preguntas : [];
      for (const q of preguntas) {
        const id = Number(q?.id_pregunta);
        if (!Number.isFinite(id) || id <= 0) continue;
        out.push({
          id_pregunta: id,
          etiqueta: q?.etiqueta || `Pregunta ${id}`,
          tipo: q?.tipo || "",
          opciones: Array.isArray(q?.opciones) ? q.opciones : [],
          filterable: !!q?.filterable,
          chartable: !!q?.chartable,
          resultable: !!q?.resultable,
          availability_label: q?.availability_label || "",
          seccion: s?.nombre || "Sin sección",
        });
      }
    }
    return out;
  }, [metadata]);

  const groupedAvailableFields = useMemo(() => {
    const results = [];
    const filterOnly = [];
    const unavailable = [];

    for (const field of availableFields) {
      if (field?.resultable) {
        results.push(field);
        continue;
      }
      if (field?.filterable) {
        filterOnly.push(field);
        continue;
      }
      unavailable.push(field);
    }

    return {
      results,
      filterOnly,
      unavailable,
    };
  }, [availableFields]);

  useEffect(() => {
    const resultableIds = new Set(
      availableFields.filter((f) => f.resultable).map((f) => f.id_pregunta)
    );

    setSelectedFieldIds((prev) => {
      const next = new Set([...prev].filter((id) => resultableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });

    setAppliedSelectedFieldIds((prev) => {
      const next = new Set([...prev].filter((id) => resultableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableFields]);

  const activeFilterFields = useMemo(() => {
    const ids = new Set(selectedFilterFieldIds);
    return availableFields.filter((f) => ids.has(f.id_pregunta));
  }, [availableFields, selectedFilterFieldIds]);

  const activeFiltersPayload = useMemo(() => {
    const out = [];
    for (const f of activeFilterFields) {
      const raw = dynamicFilters[String(f.id_pregunta)];
      if (raw === null || raw === undefined || raw === "") continue;
      out.push({
        id_pregunta: f.id_pregunta,
        tipo: f.tipo,
        value: raw,
      });
    }
    return out;
  }, [activeFilterFields, dynamicFilters]);

  useEffect(() => {
    if (!params.id_plantilla) return;
    setAppliedPlantillaId((prev) => (prev == null ? params.id_plantilla : prev));
  }, [params.id_plantilla]);

  const refetch = useMemo(() => {
    return async () => {
      if (!params.id_proyecto) return;
      setLoading(true);
      setError("");
      try {
        const selectedFieldsApplied = Array.from(appliedSelectedFieldIds || []);
        const resp = await getResumen({
          ...params,
          id_plantilla: appliedPlantillaId || params.id_plantilla,
          filters: appliedFiltersPayload,
          selected_fields: selectedFieldsApplied,
        });
        setData(resp);
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };
  }, [params, appliedFiltersPayload, appliedPlantillaId, appliedSelectedFieldIds]);

  useEffect(() => {
    const summaries = Array.isArray(data?.field_summaries) ? data.field_summaries : [];
    if (!summaries.length) {
      setFieldChartTypes({});
      return;
    }

    setFieldChartTypes((prev) => {
      const next = { ...prev };
      for (const fs of summaries) {
        if (!fs?.kpi_eligible) {
          delete next[String(fs.id_pregunta)];
          continue;
        }
        const allowed = Array.isArray(fs.allowed_chart_types)
          ? fs.allowed_chart_types
          : [];
        if (!allowed.length) continue;
        if (next[String(fs.id_pregunta)] && allowed.includes(next[String(fs.id_pregunta)])) {
          continue;
        }

        const tipo = String(fs.tipo || "").toLowerCase();
        let def = allowed[0];
        if (["boolean", "si_no", "sino", "bool"].includes(tipo) && allowed.includes("donut")) {
          def = "donut";
        } else if (
          ["select", "radio", "combo"].includes(tipo) &&
          allowed.includes("bar")
        ) {
          def = "bar";
        }
        next[String(fs.id_pregunta)] = def;
      }
      return next;
    });
  }, [data?.field_summaries]);

  const setFieldChartType = (id, chartType) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    const t = String(chartType || "");
    setFieldChartTypes((prev) => ({
      ...prev,
      [String(pid)]: t,
    }));
  };

  useEffect(() => {
    let cancelled = false;
    if (!params.id_proyecto) return;

    (async () => {
      setPlantillasLoading(true);
      setPlantillasError("");
      try {
        const resp = await getPlantillas(params.id_proyecto);
        const list =
          resp?.plantillas ||
          resp?.items ||
          resp?.rows ||
          resp?.data?.plantillas ||
          [];
        if (!cancelled) setPlantillas(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!cancelled) setPlantillasError(String(e?.message || e));
      } finally {
        if (!cancelled) setPlantillasLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id_proyecto]);

  useEffect(() => {
    let cancelled = false;
    if (!params.id_proyecto) return;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const selectedFieldsApplied = Array.from(appliedSelectedFieldIds || []);
        const resp = await getResumen({
          ...params,
          id_plantilla: appliedPlantillaId || params.id_plantilla,
          filters: appliedFiltersPayload,
          selected_fields: selectedFieldsApplied,
        });
        if (!cancelled) setData(resp);
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, appliedFiltersPayload, appliedPlantillaId, appliedSelectedFieldIds]);

  useEffect(() => {
    const qpId =
      params.id_plantilla && Number.isFinite(params.id_plantilla)
        ? Number(params.id_plantilla)
        : null;

    if (qpId) {
      setSelectedPlantillaId(qpId);
      return;
    }
  }, [params.id_plantilla]);

  useEffect(() => {
    let cancelled = false;
    if (!params.id_proyecto || !selectedPlantillaId) {
      setMetadata(null);
      return;
    }

    (async () => {
      setMetadataLoading(true);
      setMetadataError("");
      try {
        const resp = await getPlantillaMetadata(params.id_proyecto, selectedPlantillaId);
        if (!cancelled) setMetadata(resp);
      } catch (e) {
        if (!cancelled) setMetadataError(String(e?.message || e));
      } finally {
        if (!cancelled) setMetadataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id_proyecto, selectedPlantillaId]);

  useEffect(() => {
    setSelectedFieldIds(new Set());
    setSelectedFilterFieldIds(new Set());
    setDynamicFilters({});
  }, [selectedPlantillaId]);

  useEffect(() => {
    setDynamicFilters((prev) => {
      const next = {};
      for (const id of selectedFilterFieldIds) {
        const key = String(id);
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
          next[key] = prev[key];
        }
      }
      return next;
    });
  }, [selectedFilterFieldIds]);

  const toggleFieldSelected = (id, next) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    const field = availableFields.find((f) => f.id_pregunta === pid);
    if (next && !field?.resultable) return;
    setSelectedFieldIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(pid);
      else s.delete(pid);
      return s;
    });
    if (!next) {
      setSelectedFilterFieldIds((prev) => {
        const s = new Set(prev);
        s.delete(pid);
        return s;
      });
      setDynamicFilters((prev) => {
        const nextFilters = { ...prev };
        delete nextFilters[String(pid)];
        return nextFilters;
      });
    }
  };

  const toggleFilterSelected = (id, next) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    const field = availableFields.find((f) => f.id_pregunta === pid);
    if (!field?.filterable) return;
    setSelectedFilterFieldIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(pid);
      else s.delete(pid);
      return s;
    });
    if (!next) {
      setDynamicFilters((prev) => {
        const nextFilters = { ...prev };
        delete nextFilters[String(pid)];
        return nextFilters;
      });
    }
    if (next) {
      setSelectedFieldIds((prev) => {
        const s = new Set(prev);
        s.add(pid);
        return s;
      });
    }
  };

  const setDynamicFilterValue = (id, value) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    setDynamicFilters((prev) => ({
      ...prev,
      [String(pid)]: value,
    }));
  };

  const clearDynamicFilterValue = (id) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    setDynamicFilters((prev) => {
      const next = { ...prev };
      delete next[String(pid)];
      return next;
    });
  };

  const clearAllDynamicFilters = () => {
    setDynamicFilters({});
  };

  const applyConfig = () => {
    const fieldsById = new Map();
    for (const f of availableFields) fieldsById.set(f.id_pregunta, f);

    const nextAppliedFields = new Set(
      [...selectedFieldIds].filter((id) => fieldsById.get(id)?.resultable)
    );
    const nextAppliedFilterFields = new Set(selectedFilterFieldIds);
    const nextDynamic = { ...dynamicFilters };

    const labels = [];
    for (const id of nextAppliedFields) {
      const f = fieldsById.get(id);
      labels.push(f?.etiqueta || `Pregunta ${id}`);
    }

    const payload = [];
    const summary = [];
    for (const id of nextAppliedFilterFields) {
      const f = fieldsById.get(id);
      const raw = nextDynamic[String(id)];
      if (raw === null || raw === undefined || raw === "") continue;
      payload.push({ id_pregunta: id, tipo: f?.tipo || "", value: raw });

      let valLabel = String(raw);
      if (String(f?.tipo || "").toLowerCase().includes("bool")) {
        const s = String(raw).toLowerCase();
        if (s === "true" || s === "1" || s === "si" || s === "s") valLabel = "Si";
        if (s === "false" || s === "0" || s === "no" || s === "n") valLabel = "No";
      }
      summary.push(`${f?.etiqueta || `Pregunta ${id}`}=${valLabel}`);
    }

    const plantName =
      metadata?.plantilla?.nombre ||
      (selectedPlantillaId ? `Plantilla #${selectedPlantillaId}` : "");

    setAppliedPlantillaId(selectedPlantillaId || null);
    setAppliedPlantillaLabel(plantName);
    setAppliedSelectedFieldIds(nextAppliedFields);
    setAppliedFilterFieldIds(nextAppliedFilterFields);
    setAppliedDynamicFilters(nextDynamic);
    setAppliedFiltersPayload(payload);
    setAppliedFieldLabels(labels);
    setAppliedFiltersSummary(summary);
  };

  const resetDraftFromApplied = () => {
    setSelectedPlantillaId(appliedPlantillaId || null);
    setSelectedFieldIds(new Set(appliedSelectedFieldIds));
    setSelectedFilterFieldIds(new Set(appliedFilterFieldIds));
    setDynamicFilters({ ...appliedDynamicFilters });
  };

  return {
    params,
    data,
    loading,
    error,
    refetch,
    plantillas,
    plantillasLoading,
    plantillasError,
    selectedPlantillaId,
    setSelectedPlantillaId,
    metadata,
    metadataLoading,
    metadataError,
    availableFields,
    groupedAvailableFields,
    selectedFieldIds,
    selectedFilterFieldIds,
    dynamicFilters,
    activeFilterFields,
    activeFiltersPayload,
    appliedPlantillaId,
    appliedPlantillaLabel,
    appliedSelectedFieldIds,
    appliedFiltersPayload,
    appliedFieldLabels,
    appliedFiltersSummary,
    fieldSummaries: Array.isArray(data?.field_summaries) ? data.field_summaries : [],
    fieldChartTypes,
    setFieldChartType,
    showPercentages,
    setShowPercentages,
    toggleFieldSelected,
    toggleFilterSelected,
    setDynamicFilterValue,
    clearDynamicFilterValue,
    clearAllDynamicFilters,
    applyConfig,
    resetDraftFromApplied,
  };
}
