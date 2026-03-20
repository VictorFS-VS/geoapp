import React, { useState } from "react";
import { Modal, Button, Badge } from "react-bootstrap";
import { useInformesDashboard } from "./hooks/useInformesDashboard";

function traducirTipoCampo(tipo) {
  const t = String(tipo || "").trim().toLowerCase();
  if (["select", "combo", "radio"].includes(t)) return "seleccion";
  if (["boolean", "bool", "si_no", "sino", "yesno"].includes(t)) return "si/no";
  if (t === "semaforo") return "semaforo";
  if (["text", "texto", "textarea", "string"].includes(t)) return "texto";
  return t || "-";
}

function traducirTipoGrafico(tipo) {
  if (tipo === "bar") return "Barras";
  if (tipo === "donut") return "Dona";
  if (tipo === "list") return "Lista";
  return tipo;
}

export default function GVADashboardInformes() {
  const {
    params,
    data,
    loading,
    error,
    plantillas,
    plantillasLoading,
    plantillasError,
    selectedPlantillaId,
    setSelectedPlantillaId,
    metadataLoading,
    metadataError,
    availableFields,
    groupedAvailableFields,
    selectedFieldIds,
    selectedFilterFieldIds,
    dynamicFilters,
    activeFilterFields,
    activeFiltersPayload,
    appliedPlantillaLabel,
    appliedSelectedFieldIds,
    appliedFiltersPayload,
    appliedFieldLabels,
    appliedFiltersSummary,
    fieldSummaries,
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
  } = useInformesDashboard();

  const [showConfig, setShowConfig] = useState(false);

  const idProyecto = params?.id_proyecto;
  const kpis = data?.kpis || {};
  const geo = data?.geo || {};
  const plantillasResumen = Array.isArray(data?.plantillas) ? data.plantillas : [];

  const appliedFiltersCount = Array.isArray(appliedFiltersPayload)
    ? appliedFiltersPayload.length
    : 0;
  const appliedFieldsCount =
    appliedSelectedFieldIds && typeof appliedSelectedFieldIds.size === "number"
      ? appliedSelectedFieldIds.size
      : 0;

  if (!idProyecto) {
    return (
      <div style={{ padding: 20 }}>
        <h3>Dashboard Informes</h3>
        <div style={{ color: "#6b7280" }}>
          Falta <code>id_proyecto</code> en query param.
        </div>
      </div>
    );
  }

  const openConfig = () => {
    resetDraftFromApplied();
    setShowConfig(true);
  };

  const cancelConfig = () => {
    resetDraftFromApplied();
    setShowConfig(false);
  };

  const applyAndClose = () => {
    applyConfig();
    setShowConfig(false);
  };

  const headerStyle = {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
  };

  const statChip = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
  };

  const renderFieldRow = (f, mode) => {
    const selected = selectedFieldIds.has(f.id_pregunta);
    const filterSelected = selectedFilterFieldIds.has(f.id_pregunta);

    return (
      <li key={f.id_pregunta} style={{ marginBottom: 8 }}>
        <div>
          <b>{f.etiqueta}</b> - {traducirTipoCampo(f.tipo)}{" "}
          <span style={{ color: "#6b7280" }}>({f.seccion})</span>
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 3 }}>
          <Badge bg={mode === "results" ? "success" : mode === "filter" ? "warning" : "secondary"}>
            {f.availability_label || "Sin clasificacion"}
          </Badge>
        </div>

        {mode === "results" ? (
          <>
            <label style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => toggleFieldSelected(f.id_pregunta, e.target.checked)}
              />{" "}
              mostrar
            </label>
            {f.filterable ? (
              <label>
                <input
                  type="checkbox"
                  checked={filterSelected}
                  onChange={(e) => toggleFilterSelected(f.id_pregunta, e.target.checked)}
                />{" "}
                usar como filtro
              </label>
            ) : null}
          </>
        ) : null}

        {mode === "filter" ? (
          <label>
            <input
              type="checkbox"
              checked={filterSelected}
              onChange={(e) => toggleFilterSelected(f.id_pregunta, e.target.checked)}
            />{" "}
            usar como filtro
          </label>
        ) : null}
      </li>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={headerStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>Dashboard Informes</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Proyecto #{idProyecto}
            </div>
          </div>
          <Button variant="dark" onClick={openConfig}>
            Configurar
          </Button>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
          Formulario activo:{" "}
          <b>{appliedPlantillaLabel || "No seleccionado"}</b>
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "#374151",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showPercentages}
              onChange={(e) => setShowPercentages(e.target.checked)}
            />
            Mostrar porcentajes
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <span style={statChip}>Total informes: {kpis.total_informes ?? 0}</span>
          <span style={statChip}>Total plantillas: {kpis.total_plantillas ?? 0}</span>
          <span style={statChip}>Con geo: {geo.total_geo ?? 0}</span>
          <span style={statChip}>Sin geo: {geo.total_sin_geo ?? 0}</span>
          <span style={statChip}>Filtros activos: {appliedFiltersCount}</span>
          <span style={statChip}>Campos visibles: {appliedFieldsCount}</span>
        </div>
      </div>

      {loading ? (
        <div style={{ marginTop: 16 }}>Cargando resumen...</div>
      ) : error ? (
        <div style={{ marginTop: 16, color: "#b91c1c" }}>{error}</div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Resumen de configuracion aplicada
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(appliedFiltersSummary || []).map((t, idx) => (
            <Badge key={`f-${idx}`} bg="secondary">
              {t}
            </Badge>
          ))}
          {(appliedFieldLabels || []).map((t, idx) => (
            <Badge key={`c-${idx}`} bg="light" text="dark">
              {t}
            </Badge>
          ))}
          {!appliedFiltersSummary?.length && !appliedFieldLabels?.length ? (
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              No hay configuracion aplicada.
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Resultados</div>
        {appliedFieldsCount === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No hay campos visibles aplicados.
          </div>
        ) : fieldSummaries.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            No hay resultados para los campos seleccionados.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {fieldSummaries.map((fs) => {
              const isCounts = fs.summary_type === "counts";
              const isText = fs.summary_type === "text_basic";
              const allowed = Array.isArray(fs.allowed_chart_types)
                ? fs.allowed_chart_types
                : [];
              const isEligible = !!fs.kpi_eligible && allowed.length > 0;
              const chartType = fieldChartTypes[String(fs.id_pregunta)] || "list";
              const items = Array.isArray(fs.items) ? fs.items : [];
              const totalItems = items.reduce((acc, it) => acc + (Number(it.count) || 0), 0);
              const pctLabel = (count) =>
                totalItems > 0 ? `${((Number(count || 0) / totalItems) * 100).toFixed(1)}%` : "0.0%";
              return (
                <div
                  key={fs.id_pregunta}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fff",
                    minHeight: 260,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{fs.etiqueta}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                    Tipo: {traducirTipoCampo(fs.tipo)}
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 8 }}>
                    {fs.kpi_eligible ? "Apto para KPI" : "No apto para KPI"}
                  </div>

                  {isEligible ? (
                    <div
                      style={{
                        marginBottom: 8,
                        display: "flex",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {allowed.map((t) => {
                        const active = chartType === t;
                        return (
                          <button
                            key={`${fs.id_pregunta}-${t}`}
                            type="button"
                            onClick={() => setFieldChartType(fs.id_pregunta, t)}
                            style={{
                              border: active
                                ? "1px solid #111827"
                                : "1px solid #d1d5db",
                              background: active ? "#111827" : "#ffffff",
                              color: active ? "#ffffff" : "#374151",
                              borderRadius: 999,
                              padding: "4px 10px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                            title={`Ver como ${traducirTipoGrafico(t)}`}
                          >
                            {traducirTipoGrafico(t)}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {isCounts && chartType === "list" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((it, idx) => (
                        <div key={`${fs.id_pregunta}-l-${idx}`}>
                          <div
                            style={{
                              fontSize: 12,
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700 }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {isCounts && chartType === "bar" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((it, idx) => (
                        <div key={`${fs.id_pregunta}-b-${idx}`}>
                          <div
                            style={{
                              fontSize: 12,
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700 }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 6,
                              background: "#eef2f7",
                              borderRadius: 999,
                              overflow: "hidden",
                              marginTop: 2,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width:
                                  kpis.total_informes
                                    ? `${Math.min(
                                        100,
                                        (it.count / (kpis.total_informes || 1)) * 100
                                      )}%`
                                    : "0%",
                                background: "#111827",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {isCounts && chartType === "donut" ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        gap: 14,
                        alignItems: "center",
                        minHeight: 150,
                      }}
                    >
                      {(() => {
                        const donutItems = items.slice(0, 5);
                        const total = donutItems.reduce((acc, it) => acc + (it.count || 0), 0) || 1;
                        const colors = ["#111827", "#2563eb", "#16a34a", "#f97316", "#a855f7"];
                        let acc = 0;
                        const stops = donutItems.map((it, idx) => {
                          const pct = (it.count || 0) / total;
                          const start = acc;
                          acc += pct;
                          const color = colors[idx % colors.length];
                          return `${color} ${Math.round(start * 360)}deg ${Math.round(acc * 360)}deg`;
                        });
                        return (
                          <div
                            style={{
                              width: 110,
                              height: 110,
                              borderRadius: "50%",
                              background: `conic-gradient(${stops.join(", ")})`,
                              position: "relative",
                              display: "grid",
                              placeItems: "center",
                            }}
                            title={`Total: ${total}`}
                          >
                            <div
                              style={{
                                width: 54,
                                height: 54,
                                borderRadius: "50%",
                                background: "#fff",
                                display: "grid",
                                placeItems: "center",
                                fontSize: 11,
                                fontWeight: 800,
                                color: "#111827",
                              }}
                            >
                              {total}
                            </div>
                          </div>
                        );
                      })()}
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        {items.slice(0, 5).map((it, idx) => (
                          <div
                            key={`${fs.id_pregunta}-d-${idx}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              marginBottom: 4,
                            }}
                          >
                            <span>{it.label || "(sin valor)"}</span>
                            <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                              {it.count}
                              {showPercentages ? ` · ${pctLabel(it.count)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {isText ? (
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      <div>Con respuesta: {fs.non_empty_count ?? 0}</div>
                      <div style={{ marginTop: 6 }}>
                        {(fs.sample_values || []).map((v, idx) => (
                          <div key={`${fs.id_pregunta}-s-${idx}`}>{v}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Plantillas en resumen: {plantillasResumen.length}
        </div>
      </div>

      <Modal show={showConfig} onHide={cancelConfig} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Configurar dashboard</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Plantilla</div>
            {plantillasLoading ? (
              <div>Cargando plantillas...</div>
            ) : plantillasError ? (
              <div style={{ color: "#b91c1c" }}>{plantillasError}</div>
            ) : (
              <select
                value={selectedPlantillaId || ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSelectedPlantillaId(Number.isFinite(v) && v > 0 ? v : null);
                }}
              >
                <option value="">-- Seleccionar plantilla --</option>
                {plantillas.map((p) => (
                  <option key={p.id_plantilla} value={p.id_plantilla}>
                    {p.nombre || `Plantilla #${p.id_plantilla}`}
                  </option>
                ))}
              </select>
            )}
            {metadataLoading ? (
              <div style={{ marginTop: 6 }}>Cargando metadata...</div>
            ) : metadataError ? (
              <div style={{ marginTop: 6, color: "#b91c1c" }}>{metadataError}</div>
            ) : null}
          </div>

          {selectedPlantillaId && availableFields.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Campos disponibles</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Seleccionados: {selectedFieldIds.size} · Filtros:{" "}
                {selectedFilterFieldIds.size}
              </div>
              {groupedAvailableFields.results.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    Resultados disponibles
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.results.map((f) => renderFieldRow(f, "results"))}
                  </ul>
                </div>
              ) : null}

              {groupedAvailableFields.filterOnly.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    Solo filtro
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.filterOnly.map((f) => renderFieldRow(f, "filter"))}
                  </ul>
                </div>
              ) : null}

              {groupedAvailableFields.unavailable.length > 0 ? (
                <div style={{ marginTop: 10, opacity: 0.85 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    No disponibles en esta version
                  </div>
                  <ul style={{ marginTop: 6 }}>
                    {groupedAvailableFields.unavailable.map((f) => renderFieldRow(f, "none"))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedPlantillaId && activeFilterFields.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Filtros dinamicos</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                Activos: {activeFiltersPayload.length}
              </div>
              {activeFilterFields.map((f) => {
                const tipo = String(f.tipo || "").toLowerCase();
                const key = String(f.id_pregunta);
                const value = dynamicFilters[key] ?? "";
                const opciones = Array.isArray(f.opciones) ? f.opciones : [];
                const isSelect =
                  ["select", "radio", "combo"].includes(tipo) || opciones.length > 0;
                const isBool = tipo.includes("bool");

                return (
                  <div key={f.id_pregunta} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {f.etiqueta}{" "}
                      <span style={{ fontWeight: 400, color: "#6b7280" }}>
                        ({traducirTipoCampo(f.tipo)})
                      </span>
                    </div>

                    {isSelect ? (
                      <select
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                      >
                        <option value="">--</option>
                        {opciones.map((opt, idx) => (
                          <option key={`${f.id_pregunta}-${idx}`} value={opt}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    ) : isBool ? (
                      <select
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                      >
                        <option value="">--</option>
                        <option value="true">Si</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setDynamicFilterValue(f.id_pregunta, e.target.value)
                        }
                        placeholder="Ingresar texto"
                      />
                    )}

                    <button
                      type="button"
                      style={{ marginLeft: 8 }}
                      onClick={() => clearDynamicFilterValue(f.id_pregunta)}
                      disabled={value === "" || value === null || value === undefined}
                    >
                      Limpiar
                    </button>
                  </div>
                );
              })}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={clearAllDynamicFilters}
                  disabled={activeFiltersPayload.length === 0}
                >
                  Limpiar todos
                </button>
              </div>
            </div>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={cancelConfig}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={applyAndClose}>
            Aplicar
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
