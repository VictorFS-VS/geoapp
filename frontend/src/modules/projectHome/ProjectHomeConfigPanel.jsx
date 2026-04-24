import { useEffect, useMemo, useState } from "react";
import { projectHomeApi } from "./projectHome.service";
import "./ProjectHomePage.css";

const KPI_OPTIONS = (fieldSummaries = []) =>
  (fieldSummaries || [])
    .filter((s) => s && s.summary_type === "counts" && Array.isArray(s.items) && s.items.length)
    .map((s) => ({
      id: s.id_pregunta,
      label: s.etiqueta,
    }));

const TIME_GROUPING_OPTIONS = [
  { id: "day", label: "Día" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
];

function buildTemporalOptions(sources = []) {
  const base = [{ id: "__created_at", label: "Fecha de carga" }];
  const extras = Array.isArray(sources)
    ? sources
        .filter((item) => item?.id && String(item.id) !== "__created_at")
        .map((item) => ({
          id: String(item.id),
          label: item.label || String(item.id),
        }))
    : [];
  return [...base, ...extras];
}

function getApiErrorMessage(err, fallback) {
  const msg =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback;
  return String(msg || fallback);
}

export default function ProjectHomeConfigPanel({
  projectId,
  plantillaId,
  onSaved,
  onClose,
  fieldSummaries,
  temporalSources = [],
  plantillas = [],
}) {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [primary, setPrimary] = useState("");
  const [secondaries, setSecondaries] = useState([]);
  const [preferredDateField, setPreferredDateField] = useState("__created_at");
  const [grouping, setGrouping] = useState("week");
  const [message, setMessage] = useState(null);
  const [selectedPlantilla, setSelectedPlantilla] = useState(plantillaId ?? null);
  const [localFieldSummaries, setLocalFieldSummaries] = useState(fieldSummaries || []);
  const [localTemporalSources, setLocalTemporalSources] = useState(temporalSources || []);
  const [incomingConfig, setIncomingConfig] = useState(null);

  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState("");
  const [itemsMessage, setItemsMessage] = useState(null);
  const [items, setItems] = useState([]);
  const [editorMode, setEditorMode] = useState("create");
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [itemMetaLoading, setItemMetaLoading] = useState(false);
  const [itemMetaError, setItemMetaError] = useState("");
  const [itemFieldSummaries, setItemFieldSummaries] = useState([]);
  const [itemTemporalSources, setItemTemporalSources] = useState([]);

  const emptyDraft = useMemo(() => ({
    id_home_item: null,
    id_plantilla: "",
    label: "",
    kpi_primary_field_id: "",
    kpi_secondary_field_ids: [],
    preferred_date_field_id: "__created_at",
    preferred_time_grouping: "week",
    is_default: false,
  }), []);

  const [itemDraft, setItemDraft] = useState(emptyDraft);

  const options = useMemo(() => KPI_OPTIONS(localFieldSummaries), [localFieldSummaries]);
  const itemKpiOptions = useMemo(() => KPI_OPTIONS(itemFieldSummaries), [itemFieldSummaries]);
  const temporalOptions = useMemo(() => buildTemporalOptions(localTemporalSources), [localTemporalSources]);
  const itemTemporalOptions = useMemo(() => buildTemporalOptions(itemTemporalSources), [itemTemporalSources]);

  const validGeneralKpiIds = useMemo(() => 
    new Set(options.map(opt => Number(opt.id)).filter(n => Number.isFinite(n) && n > 0)),
    [options]
  );

  const notifyHomeRefresh = (options = {}) => {
    if (typeof onSaved === "function") onSaved(options);
  };

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    setLoading(true);
    projectHomeApi
      .getProjectHomeConfig({ id_proyecto: projectId, id_plantilla: selectedPlantilla })
      .then((payload) => {
        if (!active) return;
        const persistedConfig = payload?.config ?? null;
        const effectiveConfig = payload?.effective_config ?? persistedConfig ?? null;

        setConfig(persistedConfig);
        setIncomingConfig(effectiveConfig);

        const configPlantillaId = effectiveConfig?.id_plantilla ? Number(effectiveConfig.id_plantilla) : null;
        if (configPlantillaId !== (selectedPlantilla ? Number(selectedPlantilla) : null)) {
           setSelectedPlantilla(configPlantillaId);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, selectedPlantilla]);

  useEffect(() => {
    let active = true;
    if (!projectId) return;

    if (!selectedPlantilla) {
      setLocalFieldSummaries([]);
      setLocalTemporalSources([]);
      return () => {
        active = false;
      };
    }

    const loadMetadata = async () => {
      setLocalFieldSummaries([]);
      setLocalTemporalSources([]);
      try {
        const metadata = await projectHomeApi.getPlantillaMetadata({
          id_proyecto: projectId,
          id_plantilla: selectedPlantilla || null,
        });
        if (!active) return;
        setLocalFieldSummaries(metadata.field_summaries);
        setLocalTemporalSources(metadata.temporal_sources);
      } catch (err) {
        console.error("projectHomeConfig metadata:", err);
      }
    };

    loadMetadata();
    return () => {
      active = false;
    };
  }, [projectId, selectedPlantilla]);

  useEffect(() => {
    if (!incomingConfig || !options || options.length === 0) return;

    if (incomingConfig.kpi_primary_field_id) {
      const match = options.find(opt => Number(opt.id) === Number(incomingConfig.kpi_primary_field_id));
      if (match) setPrimary(Number(match.id));
      else setPrimary("");
    } else {
      setPrimary("");
    }

    let secIds = incomingConfig.kpi_secondary_field_ids || [];
    if (typeof secIds === "string") {
      try { secIds = JSON.parse(secIds); } catch { secIds = []; }
    }
    const validSecs = (Array.isArray(secIds) ? secIds : [])
      .map(Number)
      .filter(id => options.some(opt => Number(opt.id) === id));
    setSecondaries(validSecs);

    if (incomingConfig.preferred_date_field_id) {
      const match = temporalOptions.find(opt => String(opt.id) === String(incomingConfig.preferred_date_field_id));
      if (match) setPreferredDateField(String(match.id));
      else setPreferredDateField("__created_at");
    }

    if (incomingConfig.preferred_time_grouping) {
      const match = TIME_GROUPING_OPTIONS.find(opt => String(opt.id) === String(incomingConfig.preferred_time_grouping));
      if (match) setGrouping(String(match.id));
      else setGrouping("week");
    }

    setIncomingConfig(null);
  }, [incomingConfig, options, temporalOptions]);

  const plantillaOptions = useMemo(() => {
    const list = Array.isArray(plantillas) ? plantillas : [];
    const seen = new Set();
    return list
      .map((p) => ({
        id: String(p?.id_plantilla ?? p?.id ?? ""),
        nombre: p?.nombre || `Plantilla ${p?.id_plantilla ?? p?.id ?? ""}`,
      }))
      .filter((opt) => {
        if (!opt.id || seen.has(opt.id)) return false;
        seen.add(opt.id);
        return true;
      });
  }, [plantillas]);

  const plantillaNameById = useMemo(() => {
    const map = new Map();
    for (const p of Array.isArray(plantillas) ? plantillas : []) {
      const id = p?.id_plantilla ?? p?.id ?? null;
      if (id === null || id === undefined) continue;
      const key = String(id);
      if (!key) continue;
      if (!map.has(key)) map.set(key, p?.nombre || `Plantilla ${key}`);
    }
    return map;
  }, [plantillas]);

  const usedPlantillaIds = useMemo(() => {
    const set = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      const id = Number(it?.id_plantilla);
      if (Number.isFinite(id) && id > 0) set.add(String(id));
    }
    return set;
  }, [items]);

  const availablePlantillaOptionsForCreate = useMemo(() => {
    return plantillaOptions.filter((opt) => opt.id && !usedPlantillaIds.has(String(opt.id)));
  }, [plantillaOptions, usedPlantillaIds]);

  const handlePlantillaChange = (event) => {
    const value = event.target.value;
    const nextPlantilla = value ? Number(value) : null;
    setSelectedPlantilla(nextPlantilla);
  };

  useEffect(() => {
    if (!selectedPlantilla) return;
    if (!Array.isArray(options) || options.length === 0) {
      setPrimary("");
      setSecondaries([]);
      return;
    }

    setPrimary((prev) => {
      const id = Number(prev);
      if (!id) return "";
      return validGeneralKpiIds.has(id) ? id : "";
    });

    setSecondaries((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const primaryId = Number(primary) || 0;
      const cleaned = Array.from(
        new Set(
          list
            .map((x) => Number(x))
            .filter((n) => validGeneralKpiIds.has(n) && (!primaryId || n !== primaryId))
        )
      ).slice(0, 2);
      return cleaned;
    });
  }, [options, selectedPlantilla, primary, validGeneralKpiIds]);

  const toggleSecondary = (id) => {
    setSecondaries((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const reloadItems = async () => {
    if (!projectId) return;
    setItemsLoading(true);
    setItemsError("");
    try {
      const rows = await projectHomeApi.listHomeItems({ id_proyecto: projectId });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setItems([]);
      setItemsError(getApiErrorMessage(err, "No se pudieron cargar los informes del Home."));
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    reloadItems();
  }, [projectId]);

  const startCreateItem = () => {
    setItemsMessage(null);
    setItemMetaError("");
    setEditorMode("create");
    setSelectedItemId(null);
    setItemDraft(emptyDraft);
    setItemFieldSummaries([]);
    setItemTemporalSources([]);
  };

  const startEditItem = (it) => {
    if (!it) return;
    setItemsMessage(null);
    setItemMetaError("");
    setEditorMode("edit");
    setSelectedItemId(Number(it.id_home_item));
    setItemDraft({
      id_home_item: Number(it.id_home_item),
      id_plantilla: it.id_plantilla == null ? "" : String(it.id_plantilla),
      label: it.label || "",
      kpi_primary_field_id: it.kpi_primary_field_id ?? "",
      kpi_secondary_field_ids: Array.isArray(it.kpi_secondary_field_ids) ? it.kpi_secondary_field_ids : [],
      preferred_date_field_id: it.preferred_date_field_id || "__created_at",
      preferred_time_grouping: it.preferred_time_grouping || "week",
      is_default: it.is_default === true,
    });
  };

  useEffect(() => {
    let active = true;
    if (!projectId) return;

    const plantillaIdForMeta = itemDraft?.id_plantilla ? Number(itemDraft.id_plantilla) : null;
    if (!plantillaIdForMeta) {
      setItemFieldSummaries([]);
      setItemTemporalSources([]);
      setItemMetaLoading(false);
      setItemMetaError("");
      return;
    }

    const load = async () => {
      setItemMetaLoading(true);
      setItemMetaError("");
      try {
        const metadata = await projectHomeApi.getPlantillaMetadata({
          id_proyecto: projectId,
          id_plantilla: plantillaIdForMeta,
        });
        if (!active) return;
        setItemFieldSummaries(metadata.field_summaries);
        setItemTemporalSources(metadata.temporal_sources);
      } catch (err) {
        if (!active) return;
        setItemFieldSummaries([]);
        setItemTemporalSources([]);
        setItemMetaError(getApiErrorMessage(err, "No se pudo cargar metadata de la plantilla."));
      } finally {
        if (active) setItemMetaLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [projectId, itemDraft?.id_plantilla]);

  const handleItemPrimaryChange = (value) => {
    const next = Number(value) || "";
    setItemDraft((prev) => {
      const sec = Array.isArray(prev.kpi_secondary_field_ids) ? prev.kpi_secondary_field_ids : [];
      return {
        ...prev,
        kpi_primary_field_id: next,
        kpi_secondary_field_ids: sec.filter((id) => Number(id) !== Number(next)),
      };
    });
  };

  const toggleItemSecondary = (id) => {
    const idNum = Number(id);
    if (!idNum) return;
    setItemDraft((prev) => {
      const current = Array.isArray(prev.kpi_secondary_field_ids) ? prev.kpi_secondary_field_ids : [];
      if (current.includes(idNum)) {
        return { ...prev, kpi_secondary_field_ids: current.filter((x) => x !== idNum) };
      }
      if (current.length >= 2) return prev;
      if (Number(prev.kpi_primary_field_id) === idNum) return prev;
      return { ...prev, kpi_secondary_field_ids: [...current, idNum] };
    });
  };

  const saveGeneralConfig = async () => {
    if (!projectId) return;
    const sanitizedPrimary = validGeneralKpiIds.has(Number(primary)) ? Number(primary) : null;
    const sanitizedSecondaries = Array.from(
      new Set(
        (Array.isArray(secondaries) ? secondaries : [])
          .map((value) => Number(value))
          .filter(
            (value) =>
              validGeneralKpiIds.has(value) &&
              (!sanitizedPrimary || value !== sanitizedPrimary)
          )
      )
    ).slice(0, 2);
    const payload = {
      kpi_primary_field_id: sanitizedPrimary,
      kpi_secondary_field_ids: sanitizedSecondaries,
      preferred_date_field_id: preferredDateField || null,
      preferred_time_grouping: grouping || null,
    };
    setLoading(true);
    setMessage(null);
    const targetPlantillaId = selectedPlantilla ?? null;
    try {
      await projectHomeApi.saveProjectHomeConfig({
        projectId,
        plantillaId: targetPlantillaId,
        payload,
        configId: config?.id_home_config,
      });
      setMessage({ type: "success", text: "Configuración guardada" });
      notifyHomeRefresh({ source: "general-config", closePanel: true });
    } catch (err) {
      setMessage({ type: "error", text: getApiErrorMessage(err, "Error al guardar configuración") });
    } finally {
      setLoading(false);
    }
  };

  const saveItemDraft = async () => {
    if (!projectId) return;
    setItemsMessage(null);

    const idPlantillaNum = itemDraft?.id_plantilla ? Number(itemDraft.id_plantilla) : null;
    if (editorMode === "create" && !idPlantillaNum) {
      setItemsMessage({ type: "error", text: "Seleccione una plantilla para crear el informe." });
      return;
    }

    const payload = {
      id_proyecto: projectId,
      ...(editorMode === "create" ? { id_plantilla: idPlantillaNum } : {}),
      label: itemDraft.label ? String(itemDraft.label) : null,
      kpi_primary_field_id: itemDraft.kpi_primary_field_id ? Number(itemDraft.kpi_primary_field_id) : null,
      kpi_secondary_field_ids: Array.isArray(itemDraft.kpi_secondary_field_ids) ? itemDraft.kpi_secondary_field_ids : [],
      preferred_date_field_id: itemDraft.preferred_date_field_id || "__created_at",
      preferred_time_grouping: itemDraft.preferred_time_grouping || "week",
      ...(editorMode === "create" ? { is_default: itemDraft.is_default === true } : {}),
    };

    setItemSaving(true);
    try {
      if (editorMode === "create") {
        const created = await projectHomeApi.createHomeItem(payload);
        setItemsMessage({ type: "success", text: "Informe creado" });
        await reloadItems();
        notifyHomeRefresh({ source: "home-items" });
        if (created?.id_home_item) startEditItem(created);
        else startCreateItem();
        return;
      }

      const updated = await projectHomeApi.updateHomeItem(itemDraft.id_home_item, payload);
      setItemsMessage({ type: "success", text: "Informe actualizado" });
      await reloadItems();
      notifyHomeRefresh({ source: "home-items" });
      if (updated?.id_home_item) startEditItem(updated);
    } catch (err) {
      const status = Number(err?.response?.status || 0);
      if (status === 409) {
        setItemsMessage({ type: "error", text: "Ya existe un informe activo para esa plantilla." });
      } else {
        setItemsMessage({ type: "error", text: getApiErrorMessage(err, "No se pudo guardar el informe.") });
      }
    } finally {
      setItemSaving(false);
    }
  };

  const setDefaultForItem = async (id_home_item) => {
    if (!id_home_item) return;
    setItemsMessage(null);
    setItemSaving(true);
    try {
      await projectHomeApi.setDefaultHomeItem(id_home_item);
      await reloadItems();
      notifyHomeRefresh({ source: "home-items" });
      setItemsMessage({ type: "success", text: "Informe marcado como default" });
    } catch (err) {
      setItemsMessage({ type: "error", text: getApiErrorMessage(err, "No se pudo marcar como default.") });
    } finally {
      setItemSaving(false);
    }
  };

  const disableHomeItem = async (id_home_item) => {
    if (!id_home_item) return;
    if (!confirm("¿Desactivar este informe?")) return;
    setItemsMessage(null);
    setItemSaving(true);
    try {
      await projectHomeApi.disableHomeItem(id_home_item);
      await reloadItems();
      notifyHomeRefresh({ source: "home-items" });
      if (Number(selectedItemId) === Number(id_home_item)) startCreateItem();
      setItemsMessage({ type: "success", text: "Informe desactivado" });
    } catch (err) {
      setItemsMessage({ type: "error", text: getApiErrorMessage(err, "No se pudo desactivar el informe.") });
    } finally {
      setItemSaving(false);
    }
  };

  const moveItem = async (id_home_item, direction) => {
    const idx = items.findIndex((x) => Number(x?.id_home_item) === Number(id_home_item));
    if (idx < 0) return;
    const nextIndex = direction === "up" ? idx - 1 : idx + 1;
    if (nextIndex < 0 || nextIndex >= items.length) return;

    const next = [...items];
    const tmp = next[idx];
    next[idx] = next[nextIndex];
    next[nextIndex] = tmp;

    const payload = next.map((row, i) => ({
      id_home_item: Number(row.id_home_item),
      sort_order: i + 1,
    }));

    setItemSaving(true);
    setItemsMessage(null);
    try {
      const reordered = await projectHomeApi.reorderHomeItems({ id_proyecto: projectId, items: payload });
      setItems(Array.isArray(reordered) ? reordered : next);
      notifyHomeRefresh({ source: "home-items" });
    } catch (err) {
      setItemsMessage({ type: "error", text: getApiErrorMessage(err, "No se pudo reordenar.") });
    } finally {
      setItemSaving(false);
    }
  };

  return (
    <div className="pc-modal-overlay">
      <div className="pc-modal-container" style={{ maxWidth: "1000px" }}>
        <div className="pc-modal-header">
          <h5>Personalizar Indicadores del Proyecto</h5>
          <button className="pc-modal-close" onClick={onClose} title="Cerrar">
             ×
          </button>
        </div>
        <div className="pc-modal-body">
          <div className="ph-config-panel">
            {loading && <div className="ph-status">Cargando...</div>}
            {message && (
              <div className={`ph-status ${message.type === "error" ? "ph-status-error" : ""}`}>
                {message.text}
              </div>
            )}

            {/* =========================================================
                Bloque A: Configuración general del Home (existente)
            ========================================================= */}
            <div
              className="ph-card"
              style={{
                padding: "0.85rem",
                borderRadius: "0.9rem",
                border: "1px solid #e5e7eb",
              }}
            >
              <div className="ph-card-title" style={{ marginBottom: "0.6rem" }}>
                Configuración general del Home
              </div>

              <div className="ph-form-row">
                <label>Plantilla principal</label>
                <select
                  value={selectedPlantilla != null ? String(selectedPlantilla) : ""}
                  onChange={handlePlantillaChange}
                >
                  <option value="">Automática</option>
                  {plantillaOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ph-form-row">
                <label>KPI principal</label>
                <select value={primary} onChange={(e) => setPrimary(Number(e.target.value) || "")}>
                  <option value="">(sin selección)</option>
                  {options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ph-form-row">
                <label>KPI secundarios (máx 2)</label>
                <div className="ph-checkbox-grid">
                  {options.map((opt) => (
                    <label key={opt.id} className="ph-checkbox">
                      <input
                        type="checkbox"
                        checked={secondaries.includes(opt.id)}
                        onChange={() => toggleSecondary(opt.id)}
                        disabled={secondaries.length >= 2 && !secondaries.includes(opt.id)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="ph-form-row">
                <label>Campo temporal</label>
                <select value={preferredDateField} onChange={(e) => setPreferredDateField(e.target.value)}>
                  {temporalOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ph-form-row">
                <label>Agrupación</label>
                <select value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                  {TIME_GROUPING_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="d-flex" style={{ gap: "0.5rem", marginTop: "1rem" }}>
                <button className="pc-btn pc-btn-green" disabled={loading} onClick={saveGeneralConfig}>
                  {loading ? "Guardando..." : "Guardar configuración inicial"}
                </button>
              </div>
            </div>

            {/* =========================================================
                Bloques B/C: Informes (Home items) - master/detail
            ========================================================= */}
            <div className="ph-informes-context-row" style={{ marginTop: "1.5rem" }}>
              {/* Bloque B: listado */}
              <div className="ph-right">
                <div
                  className="ph-card"
                  style={{
                    padding: "0.85rem",
                    borderRadius: "0.9rem",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div className="d-flex align-items-center justify-content-between" style={{ gap: "0.75rem" }}>
                    <div className="ph-card-title">Informes de Sección</div>
                    <button className="pc-btn pc-btn-outline pc-btn-small" onClick={startCreateItem} disabled={itemSaving}>
                      Nuevo
                    </button>
                  </div>

                  {itemsLoading && <div className="ph-status">Cargando informes...</div>}
                  {itemsError && <div className="ph-status ph-status-error">{itemsError}</div>}

                  {!itemsLoading && !itemsError && items.length === 0 && (
                    <div className="ph-kpi-empty">
                      No hay informes configurados.
                    </div>
                  )}

                  {!itemsLoading && !itemsError && items.length > 0 && (
                    <ul className="ph-kpi-items">
                      {items.map((it, idx) => {
                        const plantillaNombre =
                          it?.id_plantilla != null
                            ? plantillaNameById.get(String(it.id_plantilla)) || `Plantilla ${it.id_plantilla}`
                            : "Sin plantilla";
                        const title = (it?.label || "").trim() || plantillaNombre;
                        const isSelected = Number(selectedItemId) === Number(it.id_home_item);

                        return (
                          <li key={it.id_home_item} style={{ gap: "0.5rem", alignItems: "flex-start" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => startEditItem(it)}
                                  className="pc-btn pc-btn-light pc-btn-small"
                                  style={{ textAlign: "left" }}
                                  disabled={itemSaving}
                                >
                                  {title}
                                </button>
                                {it.is_default === true && <span className="ph-chip">Default</span>}
                              </div>
                              <div className="ph-kpi-meta">
                                Plantilla: {plantillaNombre} {" · "} Orden: {it.sort_order ?? idx + 1}
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <button
                                className="pc-btn pc-btn-outline pc-btn-small"
                                onClick={() => moveItem(it.id_home_item, "up")}
                                disabled={itemSaving || idx === 0}
                                title="Subir"
                              >
                                ↑
                              </button>
                              <button
                                className="pc-btn pc-btn-outline pc-btn-small"
                                onClick={() => moveItem(it.id_home_item, "down")}
                                disabled={itemSaving || idx === items.length - 1}
                                title="Bajar"
                              >
                                ↓
                              </button>
                              <button
                                className="pc-btn pc-btn-outline pc-btn-small"
                                onClick={() => disableHomeItem(it.id_home_item)}
                                disabled={itemSaving}
                                title="Desactivar"
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* Bloque C: editor */}
              <div className="ph-left">
                <div
                  className="ph-card"
                  style={{
                    padding: "0.85rem",
                    borderRadius: "0.9rem",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div className="ph-card-title">
                    {editorMode === "create" ? "Nuevo informe" : "Editar informe"}
                  </div>

                  {itemsMessage && (
                    <div className={`ph-status ${itemsMessage.type === "error" ? "ph-status-error" : ""}`}>
                      {itemsMessage.text}
                    </div>
                  )}

                  {itemMetaError && <div className="ph-status ph-status-error">{itemMetaError}</div>}
                  {itemMetaLoading && <div className="ph-status">Cargando metadata...</div>}

                  <div className="ph-form-row">
                    <label>Plantilla</label>
                    <select
                      value={itemDraft.id_plantilla}
                      onChange={(e) => setItemDraft((prev) => ({ ...prev, id_plantilla: e.target.value }))}
                      disabled={editorMode !== "create" || itemSaving}
                    >
                      <option value="">
                        {editorMode === "create" ? "(seleccionar)" : "(sin plantilla)"}
                      </option>
                      {(editorMode === "create" ? availablePlantillaOptionsForCreate : plantillaOptions).map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ph-form-row">
                    <label>Etiqueta personalizada</label>
                    <input
                      type="text"
                      value={itemDraft.label}
                      onChange={(e) => setItemDraft((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="Ej: Censo de Viviendas"
                      disabled={itemSaving}
                    />
                  </div>

                  <div className="ph-form-row">
                    <label>KPI Principal</label>
                    <select
                      value={itemDraft.kpi_primary_field_id}
                      onChange={(e) => handleItemPrimaryChange(e.target.value)}
                      disabled={itemSaving || itemMetaLoading}
                    >
                      <option value="">(sin selección)</option>
                      {itemKpiOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ph-form-row">
                    <label>KPIs Secundarios (máx 2)</label>
                    <div className="ph-checkbox-grid">
                      {itemKpiOptions.map((opt) => (
                        <label key={opt.id} className="ph-checkbox">
                          <input
                            type="checkbox"
                            checked={(itemDraft.kpi_secondary_field_ids || []).includes(Number(opt.id))}
                            onChange={() => toggleItemSecondary(opt.id)}
                            disabled={
                              itemSaving ||
                              itemMetaLoading ||
                              ((itemDraft.kpi_secondary_field_ids || []).length >= 2 &&
                                !(itemDraft.kpi_secondary_field_ids || []).includes(Number(opt.id))) ||
                              Number(itemDraft.kpi_primary_field_id) === Number(opt.id)
                            }
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="ph-form-row">
                    <label>Campo temporal</label>
                    <select
                      value={itemDraft.preferred_date_field_id}
                      onChange={(e) => setItemDraft((prev) => ({ ...prev, preferred_date_field_id: e.target.value }))}
                      disabled={itemSaving || itemMetaLoading}
                    >
                      {itemTemporalOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ph-form-row">
                    <label>Agrupación</label>
                    <select
                      value={itemDraft.preferred_time_grouping}
                      onChange={(e) => setItemDraft((prev) => ({ ...prev, preferred_time_grouping: e.target.value }))}
                      disabled={itemSaving || itemMetaLoading}
                    >
                      {TIME_GROUPING_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {editorMode === "create" && (
                     <div className="ph-form-row">
                      <label className="ph-checkbox">
                        <input
                          type="checkbox"
                          checked={itemDraft.is_default === true}
                          onChange={(e) => setItemDraft((prev) => ({ ...prev, is_default: e.target.checked }))}
                          disabled={itemSaving}
                        />
                        Marcar como default
                      </label>
                    </div>
                  )}

                  <div className="d-flex" style={{ gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                    <button className="pc-btn pc-btn-green" disabled={itemSaving} onClick={saveItemDraft}>
                      {itemSaving ? "Guardando..." : editorMode === "create" ? "Crear informe" : "Guardar cambios"}
                    </button>
                    {editorMode === "edit" && !itemDraft.is_default && (
                      <button
                        className="pc-btn pc-btn-outline"
                        disabled={itemSaving}
                        onClick={() => setDefaultForItem(itemDraft.id_home_item)}
                      >
                        Hacer default
                      </button>
                    )}
                    <button className="pc-btn pc-btn-outline" onClick={onClose} disabled={itemSaving} style={{ marginLeft: "auto" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
