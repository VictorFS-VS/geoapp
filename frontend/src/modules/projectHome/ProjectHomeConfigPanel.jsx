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

const ProjectHomeConfigPanel = ({
  projectId,
  plantillaId,
  onSaved,
  fieldSummaries,
  temporalSources = [],
  plantillas = [],
  focus = null,
}) => {
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [primary, setPrimary] = useState("");
  const [secondaries, setSecondaries] = useState([]);
  const [preferredDateField, setPreferredDateField] = useState("__created_at");
  const [grouping, setGrouping] = useState("week");
  const [message, setMessage] = useState(null);
  const [selectedPlantilla, setSelectedPlantilla] = useState(
    plantillaId ?? focus?.id_plantilla ?? null
  );
  const [localFieldSummaries, setLocalFieldSummaries] = useState(fieldSummaries);
  const [localTemporalSources, setLocalTemporalSources] = useState(temporalSources);

  useEffect(() => {
    let active = true;
    if (!projectId) return;
    setLoading(true);
    projectHomeApi
      .getProjectHomeConfig({ id_proyecto: projectId, id_plantilla: plantillaId })
      .then((conf) => {
        if (!active) return;
        setConfig(conf);
        setPrimary(conf?.kpi_primary_field_id ?? "");
        setSecondaries(conf?.kpi_secondary_field_ids || []);
        setPreferredDateField(conf?.preferred_date_field_id || "__created_at");
        setGrouping(conf?.preferred_time_grouping || "week");
        setSelectedPlantilla(conf?.id_plantilla ?? focus?.id_plantilla ?? null);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, plantillaId]);

  useEffect(() => {
    setLocalFieldSummaries(fieldSummaries);
    setLocalTemporalSources(temporalSources);
  }, [fieldSummaries, temporalSources]);

  useEffect(() => {
    let active = true;
    if (!projectId) return;

    const loadMetadata = async () => {
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

  const options = useMemo(() => KPI_OPTIONS(localFieldSummaries), [localFieldSummaries]);

  const toggleSecondary = (id) => {
    setSecondaries((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const temporalOptions = useMemo(() => {
    const base = [{ id: "__created_at", label: "Fecha de carga" }];
    const extras = Array.isArray(localTemporalSources)
      ? localTemporalSources
          .filter((item) => item?.id && String(item.id) !== "__created_at")
          .map((item) => ({
            id: String(item.id),
            label: item.label || String(item.id),
          }))
      : [];
    return [...base, ...extras];
  }, [localTemporalSources]);

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

  const handlePlantillaChange = (event) => {
    const value = event.target.value;
    setSelectedPlantilla(value ? Number(value) : null);
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    const payload = {
      kpi_primary_field_id: primary || null,
      kpi_secondary_field_ids: secondaries,
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
      if (onSaved) onSaved();
    } catch (err) {
      setMessage({ type: "error", text: "Error al guardar configuración" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ph-config-panel">
      <h3>Configuración del panel</h3>
      {loading && <div className="ph-status">Cargando...</div>}
      {message && (
        <div className={`ph-status ${message.type === "error" ? "ph-status-error" : ""}`}>{message.text}</div>
      )}
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
          <option value="day">Día</option>
          <option value="week">Semana</option>
          <option value="month">Mes</option>
        </select>
      </div>
      <button className="pc-btn pc-btn-green" disabled={loading} onClick={handleSubmit}>
        {loading ? "Guardando..." : "Guardar configuración"}
      </button>
    </div>
  );
};

export default ProjectHomeConfigPanel;
