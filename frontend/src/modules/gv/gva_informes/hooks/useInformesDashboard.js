import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getResumen, getPlantillas, getPlantillaMetadata } from "../services/informesDashboardService";

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeDateString(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateOnly(value) {
  const normalized = normalizeDateString(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfMonth(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getDefaultDateRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    dateFrom: formatDateISO(from),
    dateTo: formatDateISO(now),
  };
}

function getOpenDateRange() {
  return {
    dateFrom: "",
    dateTo: "",
  };
}

function normalizeInteractiveValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getTemporalBucketRange(bucketStart, grouping) {
  const start = parseDateOnly(bucketStart);
  if (!start) return { dateFrom: "", dateTo: "" };
  const normalizedGrouping = String(grouping || "week").trim().toLowerCase();

  if (normalizedGrouping === "day") {
    const day = formatDateISO(start);
    return { dateFrom: day, dateTo: day };
  }

  if (normalizedGrouping === "month") {
    const end = endOfMonth(start);
    return {
      dateFrom: formatDateISO(start),
      dateTo: end ? formatDateISO(end) : formatDateISO(start),
    };
  }

  const end = addDays(start, 6);
  return {
    dateFrom: formatDateISO(start),
    dateTo: end ? formatDateISO(end) : formatDateISO(start),
  };
}

export function useInformesDashboard() {
  const [searchParams] = useSearchParams();
  const previousSelectedPlantillaIdRef = useRef(null);
  const initialRestoredPlantillaIdRef = useRef(null);
  const draftConfigByPlantillaRef = useRef({});
  const appliedConfigByPlantillaRef = useRef({});
  const visualConfigByPlantillaRef = useRef({});
  const appliedFiltersByPlantillaRef = useRef({});

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
  const [searchFieldIds, setSearchFieldIds] = useState(new Set());
  const [dateFieldId, setDateFieldId] = useState("__created_at");
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftTimeGrouping, setDraftTimeGrouping] = useState("week");
  const [draftSearchText, setDraftSearchText] = useState("");
  const [dynamicFilters, setDynamicFilters] = useState({});

  const [appliedPlantillaId, setAppliedPlantillaId] = useState(null);
  const [appliedPlantillaLabel, setAppliedPlantillaLabel] = useState("");
  const [appliedSelectedFieldIds, setAppliedSelectedFieldIds] = useState(new Set());
  const [appliedFilterFieldIds, setAppliedFilterFieldIds] = useState(new Set());
  const [appliedSearchFieldIds, setAppliedSearchFieldIds] = useState(new Set());
  const [appliedDateFieldId, setAppliedDateFieldId] = useState("__created_at");
  const [appliedDateFrom, setAppliedDateFrom] = useState("");
  const [appliedDateTo, setAppliedDateTo] = useState("");
  const [appliedTimeGrouping, setAppliedTimeGrouping] = useState("week");
  const [appliedSearchText, setAppliedSearchText] = useState("");
  const [appliedInteractiveFilters, setAppliedInteractiveFilters] = useState([]);
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
          structured_filterable: !!q?.structured_filterable,
          searchable: !!q?.searchable,
          chartable: !!q?.chartable,
          resultable: !!q?.resultable,
          dateable: !!q?.dateable,
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
    const selectedResultIds = selectedFieldIds;

    for (const field of availableFields) {
      if (field?.resultable) {
        results.push(field);
        continue;
      }
      if (field?.structured_filterable && !selectedResultIds.has(field.id_pregunta)) {
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
  }, [availableFields, selectedFieldIds]);

  const availableSearchFields = useMemo(() => {
    return availableFields.filter((f) => f.searchable);
  }, [availableFields]);

  const availableTemporalSources = useMemo(() => {
    const raw = Array.isArray(metadata?.temporal_sources) ? metadata.temporal_sources : [];
    const out = [];
    const seen = new Set();

    for (const src of raw) {
      const id = String(src?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: src?.label || (id === "__created_at" ? "Fecha de carga" : id),
        kind: src?.kind || (id === "__created_at" ? "created_at" : "field"),
        dateable: src?.dateable !== false,
        default: !!src?.default,
      });
    }

    if (!seen.has("__created_at")) {
      out.unshift({
        id: "__created_at",
        label: "Fecha de carga",
        kind: "created_at",
        dateable: true,
        default: true,
      });
    }

    return out;
  }, [metadata]);

  const buildDefaultDraftConfig = (fields) => {
    const resultableIds = fields
      .filter((f) => f?.resultable)
      .map((f) => f.id_pregunta);
    const defaults = getDefaultDateRange();

    return {
      selectedFieldIds: resultableIds,
      selectedFilterFieldIds: [],
      searchFieldIds: [],
      dateFieldId: "__created_at",
      dateFrom: defaults.dateFrom,
      dateTo: defaults.dateTo,
      timeGrouping: "week",
      searchText: "",
      dynamicFilters: {},
    };
  };

  const getStorageKey = (projectId, plantillaId) => {
    const pid = Number(projectId);
    const tid = Number(plantillaId);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(tid) || tid <= 0) {
      return "";
    }
    return `gva_informes_dashboard:${pid}:${tid}`;
  };

  const getLastTemplateStorageKey = (projectId) => {
    const pid = Number(projectId);
    if (!Number.isFinite(pid) || pid <= 0) return "";
    return `gva_informes_dashboard:last_template:${pid}`;
  };

  const readLastTemplate = (projectId) => {
    const key = getLastTemplateStorageKey(projectId);
    if (!key || typeof window === "undefined" || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  const writeLastTemplate = (projectId, plantillaId) => {
    const key = getLastTemplateStorageKey(projectId);
    const tid = Number(plantillaId);
    if (!key || !Number.isFinite(tid) || tid <= 0 || typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(key, String(tid));
    } catch {
      // best effort
    }
  };

  const readStoredConfig = (projectId, plantillaId) => {
    const key = getStorageKey(projectId, plantillaId);
    if (!key || typeof window === "undefined" || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const writeStoredConfig = (projectId, plantillaId, payload) => {
    const key = getStorageKey(projectId, plantillaId);
    if (!key || typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // best effort
    }
  };

  const sanitizePersistedConfig = (raw, fields, temporalSources) => {
    if (!raw || typeof raw !== "object") return null;

    const fieldsById = new Map(fields.map((f) => [f.id_pregunta, f]));
    const resultableIds = new Set(
      fields.filter((f) => f.resultable).map((f) => f.id_pregunta)
    );
    const structuredFilterableIds = new Set(
      fields.filter((f) => f.structured_filterable).map((f) => f.id_pregunta)
    );
    const searchableIds = new Set(
      fields.filter((f) => f.searchable).map((f) => f.id_pregunta)
    );
    const existingIds = new Set(fields.map((f) => f.id_pregunta));
    const temporalSourceIds = new Set(
      (Array.isArray(temporalSources) ? temporalSources : []).map((src) => String(src.id))
    );

    const selectedFieldIds = [
      ...new Set(
        (Array.isArray(raw.selectedFieldIds) ? raw.selectedFieldIds : [])
          .map((id) => Number(id))
          .filter((id) => resultableIds.has(id))
      ),
    ];
    const selectedFilterFieldIds = [
      ...new Set(
        (Array.isArray(raw.selectedFilterFieldIds) ? raw.selectedFilterFieldIds : [])
          .map((id) => Number(id))
          .filter((id) => structuredFilterableIds.has(id) && !selectedFieldIds.includes(id))
      ),
    ];
    const searchFieldIds = [
      ...new Set(
        (Array.isArray(raw.searchFieldIds) ? raw.searchFieldIds : [])
          .map((id) => Number(id))
          .filter((id) => searchableIds.has(id))
      ),
    ];
    const dateFieldId = temporalSourceIds.has(String(raw.dateFieldId))
      ? String(raw.dateFieldId)
      : "__created_at";
    const hasDateFrom = Object.prototype.hasOwnProperty.call(raw, "dateFrom");
    const hasDateTo = Object.prototype.hasOwnProperty.call(raw, "dateTo");
    const rawDateFrom = hasDateFrom ? raw.dateFrom : undefined;
    const rawDateTo = hasDateTo ? raw.dateTo : undefined;
    const defaults = getDefaultDateRange();
    let dateFrom = "";
    let dateTo = "";
    const dateFromExplicitlyEmpty =
      hasDateFrom && (rawDateFrom === "" || rawDateFrom === null || rawDateFrom === undefined);
    const dateToExplicitlyEmpty =
      hasDateTo && (rawDateTo === "" || rawDateTo === null || rawDateTo === undefined);
    const normalizedDateFrom =
      hasDateFrom && !dateFromExplicitlyEmpty ? normalizeDateString(rawDateFrom) : "";
    const normalizedDateTo =
      hasDateTo && !dateToExplicitlyEmpty ? normalizeDateString(rawDateTo) : "";
    const invalidDateFrom = hasDateFrom && !dateFromExplicitlyEmpty && !normalizedDateFrom;
    const invalidDateTo = hasDateTo && !dateToExplicitlyEmpty && !normalizedDateTo;
    const noSavedRange = !hasDateFrom && !hasDateTo;
    if (hasDateFrom) dateFrom = dateFromExplicitlyEmpty ? "" : normalizedDateFrom;
    if (hasDateTo) dateTo = dateToExplicitlyEmpty ? "" : normalizedDateTo;
    if (invalidDateFrom || invalidDateTo || noSavedRange) {
      dateFrom = defaults.dateFrom;
      dateTo = defaults.dateTo;
    }
    const timeGroupingRaw = String(raw.timeGrouping || "").trim().toLowerCase();
    const timeGrouping = ["day", "week", "month"].includes(timeGroupingRaw)
      ? timeGroupingRaw
      : "week";
    const searchText = String(raw.searchText || "").trim();

    const dynamicFilters = {};
    if (raw.dynamicFilters && typeof raw.dynamicFilters === "object") {
      for (const id of selectedFilterFieldIds) {
        const key = String(id);
        if (Object.prototype.hasOwnProperty.call(raw.dynamicFilters, key)) {
          const value = raw.dynamicFilters[key];
          if (value !== null && value !== undefined && value !== "") {
            dynamicFilters[key] = value;
          }
        }
      }
    }

    const fieldChartTypes = {};
    if (raw.fieldChartTypes && typeof raw.fieldChartTypes === "object") {
      for (const [idRaw, chartType] of Object.entries(raw.fieldChartTypes)) {
        const id = Number(idRaw);
        if (!existingIds.has(id)) continue;
        const value = String(chartType || "");
        if (["bar", "donut", "list", "traffic"].includes(value)) {
          fieldChartTypes[String(id)] = value;
        }
      }
    }

    const hasMeaningfulDraft =
      selectedFieldIds.length > 0 ||
      selectedFilterFieldIds.length > 0 ||
      searchFieldIds.length > 0 ||
      Object.keys(dynamicFilters).length > 0 ||
      dateFieldId !== "__created_at" ||
      !!dateFrom ||
      !!dateTo ||
      !!searchText ||
      timeGrouping !== "week";

    if (!hasMeaningfulDraft) return null;

    return {
      selectedFieldIds,
      selectedFilterFieldIds,
      searchFieldIds,
      dateFieldId,
      dateFrom,
      dateTo,
      timeGrouping,
      searchText,
      dynamicFilters,
      fieldChartTypes,
      showPercentages:
        typeof raw.showPercentages === "boolean" ? raw.showPercentages : undefined,
      fieldLabels: selectedFieldIds.map(
        (id) => fieldsById.get(id)?.etiqueta || `Pregunta ${id}`
      ),
    };
  };

  const buildAppliedSnapshot = ({
    plantillaId,
    fieldIds,
    filterFieldIds,
    searchIds,
    dateSourceId,
    filtersState,
    fields,
    plantillaNombre,
  }) => {
    const fieldsById = new Map();
    for (const f of fields) fieldsById.set(f.id_pregunta, f);

    const nextAppliedFields = new Set(
      [...fieldIds].filter((id) => fieldsById.get(id)?.resultable)
    );
    const nextAppliedFilterFields = new Set(
      [...filterFieldIds].filter(
        (id) =>
          fieldsById.get(id)?.structured_filterable &&
          !nextAppliedFields.has(id)
      )
    );
    const nextAppliedSearchFields = new Set(
      [...searchIds].filter((id) => fieldsById.get(id)?.searchable)
    );
    const nextDateFieldId = String(dateSourceId || "__created_at");
    const nextDynamic = {};
    for (const id of nextAppliedFilterFields) {
      const key = String(id);
      if (Object.prototype.hasOwnProperty.call(filtersState, key)) {
        nextDynamic[key] = filtersState[key];
      }
    }

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

    return {
      plantillaId: plantillaId || null,
      plantillaLabel:
        plantillaNombre || (plantillaId ? `Plantilla #${plantillaId}` : ""),
      selectedFieldIds: [...nextAppliedFields],
      selectedFilterFieldIds: [...nextAppliedFilterFields],
      searchFieldIds: [...nextAppliedSearchFields],
      dateFieldId: nextDateFieldId,
      dynamicFilters: nextDynamic,
      filtersPayload: payload,
      fieldLabels: labels,
      filtersSummary: summary,
    };
  };

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
          date_field_id: appliedDateFieldId,
          date_from: appliedDateFrom || undefined,
          date_to: appliedDateTo || undefined,
          time_grouping: appliedTimeGrouping,
          search_text: appliedSearchText || undefined,
          search_field_ids: Array.from(appliedSearchFieldIds || []),
          interactive_filters: appliedInteractiveFilters,
        });
        setData(resp);
      } catch (e) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    };
  }, [
    params,
    appliedFiltersPayload,
    appliedPlantillaId,
    appliedSelectedFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    appliedTimeGrouping,
    appliedSearchText,
    appliedSearchFieldIds,
    appliedInteractiveFilters,
  ]);

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
        if (tipo === "semaforo" && allowed.includes("traffic")) {
          def = "traffic";
        } else if (
          ["boolean", "si_no", "sino", "bool"].includes(tipo) &&
          allowed.includes("donut")
        ) {
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
          date_field_id: appliedDateFieldId,
          date_from: appliedDateFrom || undefined,
          date_to: appliedDateTo || undefined,
          time_grouping: appliedTimeGrouping,
          search_text: appliedSearchText || undefined,
          search_field_ids: Array.from(appliedSearchFieldIds || []),
          interactive_filters: appliedInteractiveFilters,
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
  }, [
    params,
    appliedFiltersPayload,
    appliedPlantillaId,
    appliedSelectedFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    appliedTimeGrouping,
    appliedSearchText,
    appliedSearchFieldIds,
    appliedInteractiveFilters,
  ]);

  useEffect(() => {
    const qpId =
      params.id_plantilla && Number.isFinite(params.id_plantilla)
        ? Number(params.id_plantilla)
        : null;

    if (qpId) {
      initialRestoredPlantillaIdRef.current = Number(qpId);
      setSelectedPlantillaId(qpId);
      return;
    }

    if (!params.id_proyecto || !Array.isArray(plantillas) || plantillas.length === 0) {
      return;
    }

    const validPlantillaIds = new Set(
      plantillas
        .map((p) => Number(p?.id_plantilla))
        .filter((id) => Number.isFinite(id) && id > 0)
    );

    if (selectedPlantillaId && validPlantillaIds.has(Number(selectedPlantillaId))) {
      return;
    }

    const storedTemplateId = readLastTemplate(params.id_proyecto);
    if (storedTemplateId && validPlantillaIds.has(Number(storedTemplateId))) {
      initialRestoredPlantillaIdRef.current = Number(storedTemplateId);
      setSelectedPlantillaId(Number(storedTemplateId));
    }
  }, [params.id_plantilla, params.id_proyecto, plantillas, selectedPlantillaId]);

  useEffect(() => {
    if (!params.id_proyecto || !selectedPlantillaId) return;
    writeLastTemplate(params.id_proyecto, selectedPlantillaId);
  }, [params.id_proyecto, selectedPlantillaId]);

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
    const previousId = previousSelectedPlantillaIdRef.current;
    if (
      previousId &&
      Number.isFinite(Number(previousId)) &&
      Number(previousId) > 0
    ) {
      draftConfigByPlantillaRef.current[String(previousId)] = {
        selectedFieldIds: [...selectedFieldIds],
        selectedFilterFieldIds: [...selectedFilterFieldIds],
        searchFieldIds: [...searchFieldIds],
        dateFieldId,
        dateFrom: draftDateFrom,
        dateTo: draftDateTo,
        timeGrouping: draftTimeGrouping,
        searchText: draftSearchText,
        dynamicFilters: { ...dynamicFilters },
      };
      appliedFiltersByPlantillaRef.current[String(previousId)] = {
        dateFrom: appliedDateFrom,
        dateTo: appliedDateTo,
        timeGrouping: appliedTimeGrouping,
        searchText: appliedSearchText,
      };
      visualConfigByPlantillaRef.current[String(previousId)] = {
        fieldChartTypes: { ...fieldChartTypes },
        showPercentages,
      };
    }
    previousSelectedPlantillaIdRef.current = selectedPlantillaId;
  }, [selectedPlantillaId, selectedFieldIds, selectedFilterFieldIds, searchFieldIds, dateFieldId, draftDateFrom, draftDateTo, draftTimeGrouping, draftSearchText, dynamicFilters, fieldChartTypes, showPercentages, appliedDateFrom, appliedDateTo, appliedTimeGrouping, appliedSearchText]);

  useEffect(() => {
    if (!selectedPlantillaId || !availableFields.length) return;

    const resultableIds = new Set(
      availableFields.filter((f) => f.resultable).map((f) => f.id_pregunta)
    );
    const structuredFilterableIds = new Set(
      availableFields.filter((f) => f.structured_filterable).map((f) => f.id_pregunta)
    );

    const rawLocalStored = readStoredConfig(params.id_proyecto, selectedPlantillaId);
    const localStored = sanitizePersistedConfig(
      rawLocalStored,
      availableFields,
      availableTemporalSources
    );
    const memoryStored = sanitizePersistedConfig(
      draftConfigByPlantillaRef.current[String(selectedPlantillaId)],
      availableFields,
      availableTemporalSources
    );
    const storedDraft =
      localStored ||
      memoryStored ||
      buildDefaultDraftConfig(availableFields);

    const nextSelectedFieldIds = [
      ...new Set(
        (storedDraft.selectedFieldIds || []).filter((id) => resultableIds.has(id))
      ),
    ];
    const nextSelectedFilterFieldIds = [
      ...new Set(
        (storedDraft.selectedFilterFieldIds || []).filter((id) =>
          structuredFilterableIds.has(id) && !nextSelectedFieldIds.includes(id)
        )
      ),
    ];
    const nextDynamicFilters = {};
    for (const id of nextSelectedFilterFieldIds) {
      const key = String(id);
      if (Object.prototype.hasOwnProperty.call(storedDraft.dynamicFilters || {}, key)) {
        nextDynamicFilters[key] = storedDraft.dynamicFilters[key];
      }
    }

    setSelectedFieldIds(new Set(nextSelectedFieldIds));
    setSelectedFilterFieldIds(new Set(nextSelectedFilterFieldIds));
    setSearchFieldIds(new Set(storedDraft.searchFieldIds || []));
    setDateFieldId(String(storedDraft.dateFieldId || "__created_at"));
    setDraftDateFrom(storedDraft.dateFrom || "");
    setDraftDateTo(storedDraft.dateTo || "");
    setDraftTimeGrouping(storedDraft.timeGrouping || "week");
    setDraftSearchText(storedDraft.searchText || "");
    setDynamicFilters(nextDynamicFilters);

    const visualStored =
      (rawLocalStored && typeof rawLocalStored === "object" ? rawLocalStored : null) ||
      visualConfigByPlantillaRef.current[String(selectedPlantillaId)] ||
      null;
    setFieldChartTypes(
      visualStored?.fieldChartTypes && typeof visualStored.fieldChartTypes === "object"
        ? { ...visualStored.fieldChartTypes }
        : {}
    );
    setShowPercentages(
      typeof visualStored?.showPercentages === "boolean"
        ? visualStored.showPercentages
        : true
    );

    const storedAppliedFilters =
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] || null;
    const hasStoredFilters =
      !!storedAppliedFilters || !!localStored || !!memoryStored || !!rawLocalStored;
    const appliedFiltersSource = storedAppliedFilters || (hasStoredFilters
      ? {
          dateFrom: storedDraft.dateFrom || "",
          dateTo: storedDraft.dateTo || "",
          timeGrouping: storedDraft.timeGrouping || "week",
          searchText: storedDraft.searchText || "",
        }
      : {
          ...getOpenDateRange(),
          timeGrouping: storedDraft.timeGrouping || "week",
          searchText: storedDraft.searchText || "",
        });

    setAppliedDateFrom(appliedFiltersSource.dateFrom || "");
    setAppliedDateTo(appliedFiltersSource.dateTo || "");
    setAppliedTimeGrouping(appliedFiltersSource.timeGrouping || "week");
    setAppliedSearchText(appliedFiltersSource.searchText || "");

    const restoredInitialPlantillaId = Number(initialRestoredPlantillaIdRef.current) || null;
    const shouldAutoApplyInitialTemplate =
      restoredInitialPlantillaId === Number(selectedPlantillaId) &&
      !appliedConfigByPlantillaRef.current[String(selectedPlantillaId)] &&
      (!appliedSelectedFieldIds || appliedSelectedFieldIds.size === 0) &&
      (!appliedFiltersPayload || appliedFiltersPayload.length === 0) &&
      (!appliedFieldLabels || appliedFieldLabels.length === 0);

    if (!shouldAutoApplyInitialTemplate) return;

    const initialApplied = buildAppliedSnapshot({
      plantillaId: selectedPlantillaId,
      fieldIds: nextSelectedFieldIds,
      filterFieldIds: nextSelectedFilterFieldIds,
      searchIds: storedDraft.searchFieldIds || [],
      dateSourceId: storedDraft.dateFieldId || "__created_at",
      filtersState: nextDynamicFilters,
      fields: availableFields,
      plantillaNombre: metadata?.plantilla?.nombre || "",
    });

    appliedConfigByPlantillaRef.current[String(selectedPlantillaId)] = initialApplied;
    appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
      dateFrom: appliedFiltersSource.dateFrom || "",
      dateTo: appliedFiltersSource.dateTo || "",
      timeGrouping: appliedFiltersSource.timeGrouping || "week",
      searchText: appliedFiltersSource.searchText || "",
    };
    setAppliedPlantillaId(initialApplied.plantillaId);
    setAppliedPlantillaLabel(initialApplied.plantillaLabel);
    setAppliedSelectedFieldIds(new Set(initialApplied.selectedFieldIds));
    setAppliedFilterFieldIds(new Set(initialApplied.selectedFilterFieldIds));
    setAppliedSearchFieldIds(new Set(initialApplied.searchFieldIds));
    setAppliedDateFieldId(initialApplied.dateFieldId);
    setAppliedDateFrom(appliedFiltersSource.dateFrom || "");
    setAppliedDateTo(appliedFiltersSource.dateTo || "");
    setAppliedTimeGrouping(appliedFiltersSource.timeGrouping || "week");
    setAppliedSearchText(appliedFiltersSource.searchText || "");
    setAppliedDynamicFilters({ ...initialApplied.dynamicFilters });
    setAppliedFiltersPayload(initialApplied.filtersPayload);
    setAppliedFieldLabels(initialApplied.fieldLabels);
    setAppliedFiltersSummary(initialApplied.filtersSummary);
    initialRestoredPlantillaIdRef.current = null;
  }, [selectedPlantillaId, availableFields, availableTemporalSources, metadata?.plantilla?.nombre, params.id_plantilla, appliedPlantillaId]);

  useEffect(() => {
    const projectId = params.id_proyecto;
    const plantillaId = appliedPlantillaId || selectedPlantillaId;
    if (!projectId || !plantillaId) return;

    const appliedFields = [...appliedSelectedFieldIds];
    const appliedFilters = [...appliedFilterFieldIds];
    const appliedDynamic = { ...appliedDynamicFilters };

    const hasAppliedConfig =
      appliedFields.length > 0 ||
      appliedFilters.length > 0 ||
      [...appliedSearchFieldIds].length > 0 ||
      Object.keys(appliedDynamic).length > 0 ||
      (appliedDateFieldId || "__created_at") !== "__created_at" ||
      !!appliedDateFrom ||
      !!appliedDateTo ||
      !!appliedSearchText ||
      (appliedTimeGrouping || "week") !== "week";

    if (!hasAppliedConfig) return;

    writeStoredConfig(projectId, plantillaId, {
      selectedFieldIds: appliedFields,
      selectedFilterFieldIds: appliedFilters,
      searchFieldIds: [...appliedSearchFieldIds],
      dateFieldId: appliedDateFieldId || "__created_at",
      dateFrom: appliedDateFrom || "",
      dateTo: appliedDateTo || "",
      timeGrouping: appliedTimeGrouping || "week",
      searchText: appliedSearchText || "",
      dynamicFilters: appliedDynamic,
      fieldChartTypes: { ...fieldChartTypes },
      showPercentages,
    });
  }, [
    params.id_proyecto,
    appliedPlantillaId,
    selectedPlantillaId,
    appliedSelectedFieldIds,
    appliedFilterFieldIds,
    appliedSearchFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    appliedTimeGrouping,
    appliedSearchText,
    appliedDynamicFilters,
    fieldChartTypes,
    showPercentages,
  ]);

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
    if (next) {
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
    if (!field?.structured_filterable) return;
    if (next && selectedFieldIds.has(pid)) return;
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

  const applyFilters = () => {
    const fieldsById = new Map();
    for (const f of availableFields) fieldsById.set(f.id_pregunta, f);
    const nextDynamic = {};
    const nextPayload = [];
    const nextSummary = [];
    for (const id of selectedFilterFieldIds) {
      const key = String(id);
      if (!Object.prototype.hasOwnProperty.call(dynamicFilters, key)) continue;
      const raw = dynamicFilters[key];
      if (raw === null || raw === undefined || raw === "") continue;
      nextDynamic[key] = raw;
      const f = fieldsById.get(id);
      nextPayload.push({ id_pregunta: id, tipo: f?.tipo || "", value: raw });

      let valLabel = String(raw);
      if (String(f?.tipo || "").toLowerCase().includes("bool")) {
        const s = String(raw).toLowerCase();
        if (s === "true" || s === "1" || s === "si" || s === "s") valLabel = "Si";
        if (s === "false" || s === "0" || s === "no" || s === "n") valLabel = "No";
      }
      nextSummary.push(`${f?.etiqueta || `Pregunta ${id}`}=${valLabel}`);
    }

    setAppliedDateFrom(draftDateFrom || "");
    setAppliedDateTo(draftDateTo || "");
    setAppliedTimeGrouping(draftTimeGrouping || "week");
    setAppliedSearchText(draftSearchText || "");
    setAppliedDynamicFilters(nextDynamic);
    setAppliedFiltersPayload(nextPayload);
    setAppliedFiltersSummary(nextSummary);
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: draftDateFrom || "",
        dateTo: draftDateTo || "",
        timeGrouping: draftTimeGrouping || "week",
        searchText: draftSearchText || "",
      };
    }
  };

  const clearAppliedDateFrom = () => {
    setAppliedDateFrom("");
    setDraftDateFrom("");
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: "",
        dateTo: appliedDateTo || "",
        timeGrouping: appliedTimeGrouping || "week",
        searchText: appliedSearchText || "",
      };
    }
  };

  const clearAppliedDateTo = () => {
    setAppliedDateTo("");
    setDraftDateTo("");
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: appliedDateFrom || "",
        dateTo: "",
        timeGrouping: appliedTimeGrouping || "week",
        searchText: appliedSearchText || "",
      };
    }
  };

  const clearAppliedSearchText = () => {
    setAppliedSearchText("");
    setDraftSearchText("");
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: appliedDateFrom || "",
        dateTo: appliedDateTo || "",
        timeGrouping: appliedTimeGrouping || "week",
        searchText: "",
      };
    }
  };

  const resetAppliedTimeGrouping = () => {
    setAppliedTimeGrouping("week");
    setDraftTimeGrouping("week");
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: appliedDateFrom || "",
        dateTo: appliedDateTo || "",
        timeGrouping: "week",
        searchText: appliedSearchText || "",
      };
    }
  };

  const clearFilters = () => {
    const defaults = getDefaultDateRange();
    const openRange = getOpenDateRange();
    setDraftDateFrom(defaults.dateFrom);
    setDraftDateTo(defaults.dateTo);
    setDraftTimeGrouping("week");
    setDraftSearchText("");
    setAppliedDateFrom(openRange.dateFrom);
    setAppliedDateTo(openRange.dateTo);
    setAppliedTimeGrouping("week");
    setAppliedSearchText("");
    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom: openRange.dateFrom,
        dateTo: openRange.dateTo,
        timeGrouping: "week",
        searchText: "",
      };
    }
  };

  const resetDraftFiltersFromApplied = () => {
    setDraftDateFrom(appliedDateFrom || "");
    setDraftDateTo(appliedDateTo || "");
    setDraftTimeGrouping(appliedTimeGrouping || "week");
    setDraftSearchText(appliedSearchText || "");
  };

  const addInteractiveFilter = ({ id_pregunta, label, tipo, value }) => {
    const pid = Number(id_pregunta);
    const val = String(value ?? "").trim();
    if (!Number.isFinite(pid) || pid <= 0 || !val) return;
    const t = String(tipo || "").trim().toLowerCase();
    const normalizedValue = normalizeInteractiveValue(val);
    setAppliedInteractiveFilters((prev) => {
      const existing = prev.find((f) => Number(f.id_pregunta) === pid);
      const currentValues = Array.isArray(existing?.values)
        ? existing.values
        : existing?.value !== undefined
        ? [existing.value]
        : [];
      const normalizedMap = new Map();
      for (const v of currentValues) {
        const norm = normalizeInteractiveValue(v);
        if (!norm) continue;
        if (!normalizedMap.has(norm)) normalizedMap.set(norm, v);
      }

      if (normalizedMap.has(normalizedValue)) {
        normalizedMap.delete(normalizedValue);
      } else {
        normalizedMap.set(normalizedValue, val);
      }

      const nextValues = Array.from(normalizedMap.values());

      const next = prev.filter((f) => Number(f.id_pregunta) !== pid);
      if (nextValues.length > 0) {
        next.push({
          id_pregunta: pid,
          label: label || existing?.label || `Pregunta ${pid}`,
          tipo: t || existing?.tipo || "",
          values: nextValues,
        });
      }
      return next;
    });
  };

  const removeInteractiveFilter = (id_pregunta) => {
    const pid = Number(id_pregunta);
    if (!Number.isFinite(pid) || pid <= 0) return;
    setAppliedInteractiveFilters((prev) =>
      prev.filter((f) => Number(f.id_pregunta) !== pid)
    );
  };

  const clearInteractiveFilterField = (id_pregunta) => {
    const pid = Number(id_pregunta);
    if (!Number.isFinite(pid) || pid <= 0) return;
    setAppliedInteractiveFilters((prev) =>
      prev.filter((f) => Number(f.id_pregunta) !== pid)
    );
  };

  const clearInteractiveFilters = () => {
    setAppliedInteractiveFilters([]);
  };

  const applyTemporalBucket = (bucket, groupingOverride) => {
    const { dateFrom, dateTo } = getTemporalBucketRange(
      bucket?.bucket_start,
      groupingOverride || appliedTimeGrouping || "week"
    );
    if (!dateFrom || !dateTo) return;

    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);

    if (selectedPlantillaId) {
      appliedFiltersByPlantillaRef.current[String(selectedPlantillaId)] = {
        dateFrom,
        dateTo,
        timeGrouping: appliedTimeGrouping || "week",
        searchText: appliedSearchText || "",
      };
    }
  };

  const isTemporalBucketActive = (bucket, groupingOverride) => {
    const { dateFrom, dateTo } = getTemporalBucketRange(
      bucket?.bucket_start,
      groupingOverride || appliedTimeGrouping || "week"
    );
    if (!dateFrom || !dateTo) return false;
    return appliedDateFrom === dateFrom && appliedDateTo === dateTo;
  };

  const isInteractiveValueActive = (id_pregunta, value) => {
    const pid = Number(id_pregunta);
    const val = normalizeInteractiveValue(value);
    if (!Number.isFinite(pid) || pid <= 0 || !val) return false;
    return appliedInteractiveFilters.some(
      (f) => {
        if (Number(f.id_pregunta) !== pid) return false;
        const values = Array.isArray(f.values)
          ? f.values
          : f.value !== undefined
          ? [f.value]
          : [];
        return values.some((v) => normalizeInteractiveValue(v) === val);
      }
    );
  };

  const toggleSearchFieldSelected = (id, next) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    const field = availableFields.find((f) => f.id_pregunta === pid);
    if (!field?.searchable) return;
    setSearchFieldIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(pid);
      else s.delete(pid);
      return s;
    });
  };

  const applyConfig = () => {
    const snapshot = buildAppliedSnapshot({
      plantillaId: selectedPlantillaId,
      fieldIds: [...selectedFieldIds],
      filterFieldIds: [...selectedFilterFieldIds],
      searchIds: [...searchFieldIds],
      dateSourceId: dateFieldId,
      filtersState: dynamicFilters,
      fields: availableFields,
      plantillaNombre: metadata?.plantilla?.nombre || "",
    });

    if (selectedPlantillaId) {
      draftConfigByPlantillaRef.current[String(selectedPlantillaId)] = {
        selectedFieldIds: [...selectedFieldIds],
        selectedFilterFieldIds: [...selectedFilterFieldIds],
        searchFieldIds: [...searchFieldIds],
        dateFieldId,
        dynamicFilters: { ...dynamicFilters },
      };
      appliedConfigByPlantillaRef.current[String(selectedPlantillaId)] = snapshot;
    }

    setAppliedPlantillaId(snapshot.plantillaId);
    setAppliedPlantillaLabel(snapshot.plantillaLabel);
    setAppliedSelectedFieldIds(new Set(snapshot.selectedFieldIds));
    setAppliedFilterFieldIds(new Set(snapshot.selectedFilterFieldIds));
    setAppliedSearchFieldIds(new Set(snapshot.searchFieldIds));
    setAppliedDateFieldId(snapshot.dateFieldId);
    setAppliedDynamicFilters({ ...snapshot.dynamicFilters });
    setAppliedFiltersPayload(snapshot.filtersPayload);
    setAppliedFieldLabels(snapshot.fieldLabels);
    setAppliedFiltersSummary(snapshot.filtersSummary);
  };

  const resetDraftFromApplied = () => {
    setSelectedPlantillaId(appliedPlantillaId || null);
    setSelectedFieldIds(new Set(appliedSelectedFieldIds));
    setSelectedFilterFieldIds(new Set(appliedFilterFieldIds));
    setSearchFieldIds(new Set(appliedSearchFieldIds));
    setDateFieldId(appliedDateFieldId || "__created_at");
    setDynamicFilters({ ...appliedDynamicFilters });
    resetDraftFiltersFromApplied();
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
    availableSearchFields,
    availableTemporalSources,
    groupedAvailableFields,
    selectedFieldIds,
    selectedFilterFieldIds,
    searchFieldIds,
    dateFieldId,
    dynamicFilters,
    activeFilterFields,
    activeFiltersPayload,
    appliedPlantillaId,
    appliedPlantillaLabel,
    appliedSelectedFieldIds,
    appliedSearchFieldIds,
    appliedDateFieldId,
    appliedDateFrom,
    appliedDateTo,
    appliedTimeGrouping,
    appliedSearchText,
    appliedInteractiveFilters,
    appliedFiltersPayload,
    appliedFieldLabels,
    appliedFiltersSummary,
    fieldSummaries: Array.isArray(data?.field_summaries) ? data.field_summaries : [],
    temporal: data?.temporal || null,
    fieldChartTypes,
    setFieldChartType,
    showPercentages,
    setShowPercentages,
    toggleFieldSelected,
    toggleFilterSelected,
    toggleSearchFieldSelected,
    setDateFieldId,
    draftDateFrom,
    draftDateTo,
    draftTimeGrouping,
    draftSearchText,
    setDraftDateFrom,
    setDraftDateTo,
    setDraftTimeGrouping,
    setDraftSearchText,
    setDynamicFilterValue,
    clearDynamicFilterValue,
    clearAllDynamicFilters,
    applyFilters,
    clearFilters,
    resetDraftFiltersFromApplied,
    isInteractiveValueActive,
    addInteractiveFilter,
    removeInteractiveFilter,
    clearInteractiveFilterField,
    clearInteractiveFilters,
    applyTemporalBucket,
    isTemporalBucketActive,
    clearAppliedDateFrom,
    clearAppliedDateTo,
    clearAppliedSearchText,
    resetAppliedTimeGrouping,
    applyConfig,
    resetDraftFromApplied,
  };
}
