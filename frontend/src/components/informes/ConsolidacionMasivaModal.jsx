import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Form, Alert, Spinner, Badge, ListGroup } from "react-bootstrap";

const TEXTUAL_DEST_TYPES = new Set(["texto", "textarea", "text", "string", "short_text", "shorttext"]);
const IMAGE_TYPES = new Set(["imagen", "image", "foto", "galeria", "gallery", "photoupload", "vphoto", "archivo_imagen"]);

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function typeLabel(tipo) {
  const t = normalizeType(tipo);
  if (!t) return "-";
  const map = {
    texto: "texto",
    textarea: "texto largo",
    text: "texto",
    string: "texto",
    short_text: "texto corto",
    shorttext: "texto corto",
    select: "seleccion unica",
    radio: "opcion unica",
    select_single: "seleccion unica",
    multiselect: "seleccion multiple",
    checkbox: "casillas",
    select_multiple: "seleccion multiple",
    semaforo: "semaforo",
    numero: "numero",
    fecha: "fecha",
    boolean: "booleano",
    imagen: "imagen",
  };
  return map[t] || t;
}

function isTextualDestinationQuestion(p) {
  const tipo = normalizeType(p?.tipo);
  return TEXTUAL_DEST_TYPES.has(tipo);
}

function isAllowedSourceQuestion(p) {
  const tipo = normalizeType(p?.tipo);
  return !IMAGE_TYPES.has(tipo);
}

function sortBySelectionOrder(selectedIds) {
  return Array.isArray(selectedIds) ? selectedIds.map((id) => Number(id)).filter(Boolean) : [];
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = data?.error || data?.message || data?.raw || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function QuestionBadge({ tipo }) {
  return <Badge bg="light" text="dark" className="flex-shrink-0">{typeLabel(tipo)}</Badge>;
}

export default function ConsolidacionMasivaModal({
  show,
  onHide,
  idProyecto,
  idPlantilla,
  preguntas = [],
  API_URL,
  authHeaders,
  onApplied,
}) {
  const [sourceIds, setSourceIds] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [strategy, setStrategy] = useState("first_non_empty");
  const [overwriteMode, setOverwriteMode] = useState("empty_only");
  const [sourceSearch, setSourceSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");

  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [applyPhase, setApplyPhase] = useState("idle");
  const [applyStep, setApplyStep] = useState("idle");

  useEffect(() => {
    if (!show) return;
    setSourceIds([]);
    setTargetId("");
    setStrategy("first_non_empty");
    setOverwriteMode("empty_only");
    setSourceSearch("");
    setTargetSearch("");
    setPreview(null);
    setPreviewError("");
    setApplyError("");
    setApplyPhase("idle");
    setApplyStep("idle");
    setPreviewLoading(false);
    setApplyLoading(false);
  }, [show, idPlantilla]);

  const preguntasValidas = useMemo(() => (Array.isArray(preguntas) ? preguntas.filter(Boolean) : []), [preguntas]);

  const sourceMap = useMemo(() => {
    const m = new Map();
    for (const p of preguntasValidas) m.set(Number(p.id_pregunta), p);
    return m;
  }, [preguntasValidas]);

  const targetOptions = useMemo(() => {
    return preguntasValidas
      .filter((p) => isTextualDestinationQuestion(p) && !p?.es_unico)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || Number(a.id_pregunta) - Number(b.id_pregunta));
  }, [preguntasValidas]);

  const filteredTargetOptions = useMemo(() => {
    const search = normalizeSearch(targetSearch);
    return targetOptions.filter((p) => {
      if (!search) return true;
      const text = normalizeSearch([p.etiqueta, p.tipo, p.id_pregunta].filter(Boolean).join(" "));
      return text.includes(search);
    });
  }, [targetOptions, targetSearch]);

  const sourceOptions = useMemo(() => {
    const targetNumeric = Number(targetId);
    const search = normalizeSearch(sourceSearch);
    return preguntasValidas
      .filter((p) => isAllowedSourceQuestion(p))
      .filter((p) => !targetNumeric || Number(p.id_pregunta) !== targetNumeric)
      .filter((p) => {
        if (!search) return true;
        const text = normalizeSearch([p.etiqueta, p.tipo, p.id_pregunta].filter(Boolean).join(" "));
        return text.includes(search);
      })
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || Number(a.id_pregunta) - Number(b.id_pregunta));
  }, [preguntasValidas, targetId, sourceSearch]);

  const selectedSourceQuestions = useMemo(() => {
    return sortBySelectionOrder(sourceIds)
      .map((id) => sourceMap.get(Number(id)))
      .filter(Boolean);
  }, [sourceIds, sourceMap]);

  const targetQuestion = useMemo(() => {
    const id = Number(targetId);
    return Number.isFinite(id) ? sourceMap.get(id) || null : null;
  }, [sourceMap, targetId]);

  const canPreview = !!idProyecto && !!idPlantilla && !!targetId && sourceIds.length > 0 && !previewLoading && !applyLoading;
  const canApply = !!preview?.valid && !previewLoading && !applyLoading;

  useEffect(() => {
    if (!show) return;
    if (preview || previewError || applyError) {
      setPreview(null);
      setPreviewError("");
      setApplyError("");
      setApplyPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIds, targetId, strategy, overwriteMode]);

  useEffect(() => {
    if (!targetId) return;
    const targetNumeric = Number(targetId);
    setSourceIds((prev) => prev.filter((id) => Number(id) !== targetNumeric));
  }, [targetId]);

  const toggleSource = (id) => {
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setSourceIds((prev) => {
      const has = prev.includes(numeric);
      if (has) return prev.filter((x) => x !== numeric);
      return [...prev, numeric];
    });
  };

  const moveSource = (index, delta) => {
    setSourceIds((prev) => {
      const next = [...prev];
      const to = index + delta;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  };

  const removeSource = (id) => setSourceIds((prev) => prev.filter((x) => Number(x) !== Number(id)));

  const handlePreview = async () => {
    if (!canPreview) {
      setPreviewError("Selecciona origen y destino antes de generar la vista previa.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");
    setApplyError("");
    try {
      const data = await fetchJson(
        `${API_URL}/informes/proyecto/${idProyecto}/plantilla/${idPlantilla}/consolidacion/preview`,
        {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source_field_ids: sourceIds,
            target_field_id: Number(targetId),
            strategy,
            overwrite_mode: overwriteMode,
          }),
        }
      );

      setPreview(data);
      if (!data?.valid) {
        setPreviewError("La consolidacion no es valida con la configuracion actual.");
      }
    } catch (err) {
      setPreview(null);
      setPreviewError(err?.message || "No se pudo generar la vista previa.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenApplyConfirm = () => {
    console.info("[CONSOLIDACION_FRONT] click handleOpenApplyConfirm");
    console.info("[CONSOLIDACION_FRONT] contexto", {
      idProyecto,
      idPlantilla,
      sourceIds,
      targetId,
      strategy,
      overwriteMode,
      previewValid: !!preview?.valid,
    });

    if (!preview?.valid) {
      console.warn("[CONSOLIDACION_FRONT] abort: preview invalid");
      setApplyPhase("bloqueado");
      setApplyStep("idle");
      return;
    }

    console.info("[CONSOLIDACION_FRONT] inline confirmacion preparada");
    setApplyPhase("confirmando");
    setApplyStep("confirm");
    setApplyError("");
  };

  const handleApply = async () => {
    const applyUrl = `${API_URL}/informes/proyecto/${idProyecto}/plantilla/${idPlantilla}/consolidacion/apply`;
    const applyPayload = {
      source_field_ids: sourceIds,
      target_field_id: Number(targetId),
      strategy,
      overwrite_mode: overwriteMode,
    };

    console.info("[CONSOLIDACION_FRONT] click handleApply");
    console.info("[CONSOLIDACION_FRONT] contexto", {
      idProyecto,
      idPlantilla,
      sourceIds,
      targetId,
      strategy,
      overwriteMode,
      previewValid: !!preview?.valid,
    });

    if (!preview?.valid) {
      console.warn("[CONSOLIDACION_FRONT] abort: preview invalid");
      setApplyPhase("bloqueado");
      setApplyStep("idle");
      return;
    }

    if (applyStep !== "confirm") {
      console.warn("[CONSOLIDACION_FRONT] abort: confirmacion inline no activa");
      setApplyPhase("confirmando");
      setApplyStep("confirm");
      return;
    }

    console.info("[CONSOLIDACION_FRONT] antes de setApplyLoading(true)");
    setApplyPhase("aplicando");
    setApplyLoading(true);
    setApplyError("");

    console.info("[CONSOLIDACION_FRONT] antes de fetchJson", {
      method: "POST",
      url: applyUrl,
      idProyecto,
      idPlantilla,
      sourceFieldIds: sourceIds,
      targetFieldId: Number(targetId),
      strategy,
      overwriteMode,
      payload: applyPayload,
    });

    try {
      const data = await fetchJson(applyUrl, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(applyPayload),
      });

      console.info("[CONSOLIDACION_FRONT] success", data);
      setApplyPhase("exito");
      setApplyStep("idle");
      setApplyLoading(false);
      setPreview(null);
      setPreviewError("");
      setApplyError("");
      await Promise.resolve(onApplied?.(data));
      await new Promise((resolve) => setTimeout(resolve, 600));
      onHide?.();
    } catch (err) {
      console.error("[CONSOLIDACION_FRONT] error", err);
      setApplyPhase("error");
      setApplyError(err?.message || "No se pudo aplicar la consolidacion.");
    } finally {
      console.info("[CONSOLIDACION_FRONT] finally");
      setApplyLoading(false);
    }
  };

  const hasAnyQuestions = preguntasValidas.length > 0;
  const selectedTargetLabel = targetQuestion?.etiqueta || (targetId ? `Campo #${targetId}` : "");
  const targetSearchCount = filteredTargetOptions.length;
  const applyPhaseLabel = {
    idle: "",
    bloqueado: "La aplicacion quedo bloqueada por falta de vista previa valida.",
    confirmando: "Confirmacion lista. Verifica el resumen y confirma la aplicacion dentro del modal.",
    aplicando: "Aplicando consolidacion...",
    exito: "Consolidacion aplicada correctamente.",
    error: "La aplicacion encontro un error.",
  }[applyPhase];
  const applySummaryCount = preview?.summary?.with_changes ?? preview?.summary?.eligible ?? 0;
  const showInlineConfirm = applyStep === "confirm" && preview?.valid;

  return (
    <Modal
      show={show}
      onHide={applyLoading ? undefined : onHide}
      centered
      size="xl"
      scrollable
      backdrop="static"
      keyboard={!applyLoading}
    >
      <Modal.Header closeButton={!applyLoading}>
        <Modal.Title>Consolidacion masiva de respuestas</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {!hasAnyQuestions ? (
          <Alert variant="warning" className="mb-0">
            No hay preguntas cargadas para la plantilla activa.
          </Alert>
        ) : (
          <>
            <Alert variant="info" className="mb-3">
              Flujo guiado: primero elegi los campos origen, luego el destino, despues la configuracion y por ultimo la vista previa.
            </Alert>

            <div className="row g-3">
              <div className="col-lg-5">
                <div className="border rounded p-3 h-100">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <strong>1. Campos origen</strong>
                      <Badge bg="secondary">{sourceIds.length}</Badge>
                    </div>
                    <span className="text-muted small">El orden define la prioridad</span>
                  </div>

                  <div className="border rounded bg-light p-2 mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="fw-semibold small">Campos seleccionados</div>
                      <Badge bg="info">{selectedSourceQuestions.length}</Badge>
                    </div>

                    {selectedSourceQuestions.length === 0 ? (
                      <div className="text-muted small">Todavia no seleccionaste campos origen.</div>
                    ) : (
                      <ListGroup variant="flush" className="small">
                        {selectedSourceQuestions.map((p, index) => (
                          <ListGroup.Item
                            key={p.id_pregunta}
                            className="px-0 py-2 d-flex justify-content-between align-items-center gap-2"
                          >
                            <div className="min-w-0 flex-grow-1">
                              <div className="fw-semibold text-truncate" title={p.etiqueta}>
                                {index + 1}. {p.etiqueta}
                              </div>
                              <div className="text-muted text-truncate" title={typeLabel(p.tipo)}>
                                {typeLabel(p.tipo)}
                              </div>
                            </div>

                            <div className="btn-group btn-group-sm flex-shrink-0">
                              <Button
                                variant="outline-secondary"
                                disabled={index === 0}
                                onClick={() => moveSource(index, -1)}
                                title="Subir prioridad"
                              >
                                Subir
                              </Button>
                              <Button
                                variant="outline-secondary"
                                disabled={index === selectedSourceQuestions.length - 1}
                                onClick={() => moveSource(index, 1)}
                                title="Bajar prioridad"
                              >
                                Bajar
                              </Button>
                              <Button
                                variant="outline-danger"
                                onClick={() => removeSource(p.id_pregunta)}
                                title="Quitar campo"
                              >
                                Quitar
                              </Button>
                            </div>
                          </ListGroup.Item>
                        ))}
                      </ListGroup>
                    )}
                  </div>

                  <Form.Group className="mb-2">
                    <Form.Label className="small text-muted mb-1">Buscar campos origen</Form.Label>
                    <Form.Control
                      size="sm"
                      type="search"
                      value={sourceSearch}
                      placeholder="Filtrar por etiqueta, tipo o ID"
                      onChange={(e) => setSourceSearch(e.target.value)}
                    />
                    <div className="form-text">
                      {sourceOptions.length} campo{sourceOptions.length === 1 ? "" : "s"} visible
                    </div>
                  </Form.Group>

                  <div style={{ maxHeight: 320, overflow: "auto" }}>
                    {sourceOptions.map((p) => {
                      const id = Number(p.id_pregunta);
                      const checked = sourceIds.includes(id);
                      const disabled = !!targetId && Number(targetId) === id;
                      return (
                        <Form.Check
                          key={id}
                          type="checkbox"
                          className="mb-2"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSource(id)}
                          label={
                            <span className="d-inline-flex align-items-center gap-2 min-w-0">
                              <span className="fw-semibold text-truncate" title={p.etiqueta}>
                                {p.etiqueta}
                              </span>
                              <QuestionBadge tipo={p.tipo} />
                            </span>
                          }
                        />
                      );
                    })}
                    {sourceOptions.length === 0 && (
                      <div className="text-muted small">
                        {sourceSearch.trim()
                          ? "No hay campos origen que coincidan con la busqueda."
                          : "No hay campos origen compatibles."}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-lg-7">
                <div className="border rounded p-3 h-100">
                  <div className="mb-3">
                    <strong>2. Campo destino</strong>
                    <div className="small text-muted">
                      Elegi un campo textual compatible de la plantilla activa.
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <Form.Group>
                        <Form.Label className="small text-muted mb-1">Buscar campo destino</Form.Label>
                        <Form.Control
                          size="sm"
                          type="search"
                          value={targetSearch}
                          placeholder="Filtrar por etiqueta, tipo o ID"
                          onChange={(e) => setTargetSearch(e.target.value)}
                          className="mb-2"
                        />

                        <Form.Label>Campo destino textual</Form.Label>
                        <Form.Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                          <option value="">Selecciona un campo destino</option>
                          {filteredTargetOptions.map((p) => (
                            <option key={p.id_pregunta} value={p.id_pregunta}>
                              {p.etiqueta} ({typeLabel(p.tipo)})
                            </option>
                          ))}
                        </Form.Select>
                        <div className="form-text">
                          {targetSearchCount} campo{targetSearchCount === 1 ? "" : "s"} disponible{targetSearchCount === 1 ? "" : "s"}
                        </div>
                      </Form.Group>
                    </div>

                    <div className="col-md-6">
                      <Form.Group>
                        <Form.Label className="small text-muted mb-1">Destino seleccionado</Form.Label>
                        <div className="border rounded bg-light p-2 min-h-100">
                          {targetId ? (
                            <div className="d-flex flex-column gap-1">
                              <div className="fw-semibold text-truncate" title={selectedTargetLabel}>
                                {selectedTargetLabel}
                              </div>
                              <div className="d-flex flex-wrap gap-2">
                                <Badge bg="info">{typeLabel(targetQuestion?.tipo)}</Badge>
                                <Badge bg="secondary">Solo texto</Badge>
                              </div>
                            </div>
                          ) : (
                            <div className="text-muted small">Todavia no seleccionaste un destino.</div>
                          )}
                        </div>
                      </Form.Group>
                    </div>

                    <div className="col-12">
                      <div className="mb-2">
                        <strong>3. Configuracion</strong>
                      </div>
                    </div>

                    <div className="col-md-6">
                      <Form.Group>
                        <Form.Label>Estrategia</Form.Label>
                        <Form.Select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                          <option value="first_non_empty">Tomar el primer valor no vacio</option>
                          <option value="concat_with_comma">Concatenar con coma</option>
                        </Form.Select>
                      </Form.Group>
                    </div>

                    <div className="col-md-6">
                      <Form.Group>
                        <Form.Label>Sobrescritura</Form.Label>
                        <Form.Select value={overwriteMode} onChange={(e) => setOverwriteMode(e.target.value)}>
                          <option value="empty_only">Solo si esta vacio</option>
                          <option value="force">Sobrescribir siempre</option>
                        </Form.Select>
                      </Form.Group>
                    </div>

                    <div className="col-12 d-flex align-items-end">
                      <div className="d-flex gap-2 w-100">
                        <Button
                          variant="outline-secondary"
                          className="w-100"
                          onClick={() => {
                            setSourceIds([]);
                            setTargetId("");
                            setStrategy("first_non_empty");
                            setOverwriteMode("empty_only");
                            setSourceSearch("");
                            setTargetSearch("");
                            setPreview(null);
                            setPreviewError("");
                            setApplyError("");
                          }}
                          disabled={previewLoading || applyLoading}
                        >
                          Limpiar todo
                        </Button>

                        <Button
                          variant="primary"
                          className="w-100"
                          onClick={handlePreview}
                          disabled={!canPreview}
                        >
                          {previewLoading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Generando vista previa...
                            </>
                          ) : (
                            "Vista previa"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3">
              {applyPhase !== "idle" ? (
                <Alert variant="info" className="py-2 mb-3">
                  {applyPhaseLabel}
                </Alert>
              ) : null}

              {previewError ? <Alert variant="danger">{previewError}</Alert> : null}
              {applyError ? <Alert variant="danger">{applyError}</Alert> : null}

              {showInlineConfirm ? (
                <Alert variant="warning" className="mb-3">
                  <div className="fw-semibold mb-1">Confirmacion de aplicacion</div>
                  <div className="small mb-2">
                    Estas por consolidar <b>{applySummaryCount}</b> registro{applySummaryCount === 1 ? "" : "s"} usando la estrategia{" "}
                    <b>{strategy === "first_non_empty" ? "primer valor no vacio" : "concatenar con coma"}</b> y la sobrescritura{" "}
                    <b>{overwriteMode === "empty_only" ? "solo si esta vacio" : "sobrescribir siempre"}</b>.
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline-secondary"
                      onClick={() => {
                        setApplyStep("idle");
                        setApplyPhase("idle");
                        setApplyError("");
                      }}
                      disabled={applyLoading}
                    >
                      Volver
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleApply}
                      disabled={applyLoading || !preview?.valid}
                    >
                      {applyLoading ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Aplicando...
                        </>
                      ) : (
                        "Confirmar aplicacion"
                      )}
                    </Button>
                  </div>
                </Alert>
              ) : null}

              {preview ? (
                <div className="border rounded p-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <strong>4. Vista previa</strong>
                    <Badge bg={preview.valid ? "success" : "danger"}>
                      {preview.valid ? "Valida" : "Invalida"}
                    </Badge>
                  </div>

                  <div className="small text-muted mb-3">
                    Primero revisa el resumen general y luego los ejemplos antes de aplicar la consolidacion.
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-md-2"><Badge bg="secondary">Total: {preview.summary?.total_informes ?? 0}</Badge></div>
                    <div className="col-md-2"><Badge bg="info">Elegibles: {preview.summary?.eligible ?? 0}</Badge></div>
                    <div className="col-md-2"><Badge bg="success">Cambios: {preview.summary?.with_changes ?? 0}</Badge></div>
                    <div className="col-md-2"><Badge bg="warning" text="dark">Omitidos: {preview.summary?.skipped_target_has_value ?? 0}</Badge></div>
                    <div className="col-md-2"><Badge bg="dark">Sin fuente: {preview.summary?.skipped_no_source ?? 0}</Badge></div>
                    <div className="col-md-2"><Badge bg="danger">Conflictos: {preview.summary?.conflicts ?? 0}</Badge></div>
                  </div>

                  {Array.isArray(preview.errors) && preview.errors.length > 0 ? (
                    <Alert variant="warning" className="py-2">
                      {preview.errors.map((err, idx) => (
                        <div key={idx}>{err.message}</div>
                      ))}
                    </Alert>
                  ) : null}

                  <div className="mb-2">
                    <strong>Ejemplos</strong>
                  </div>

                  {Array.isArray(preview.examples) && preview.examples.length > 0 ? (
                    <div style={{ maxHeight: 260, overflow: "auto" }}>
                      <ListGroup>
                        {preview.examples.map((ex) => (
                          <ListGroup.Item key={ex.id_informe}>
                            <div className="d-flex justify-content-between gap-3">
                              <div style={{ minWidth: 110 }}>
                                <div className="fw-semibold">Informe #{ex.id_informe}</div>
                                <div className="small text-muted">
                                  Destino actual: {isBlank(ex.target_current_value) ? "-" : ex.target_current_value}
                                </div>
                              </div>
                              <div className="flex-grow-1">
                                <div className="small text-muted">Resultado de la vista previa</div>
                                <div className="fw-semibold">{ex.resolved_value || "-"}</div>
                              </div>
                              <div className="flex-grow-1">
                                <div className="small text-muted">Fuentes usadas</div>
                                <div className="small">
                                  {ex.sources_used?.map((src) => src.label).join(", ") || "-"}
                                </div>
                              </div>
                            </div>
                          </ListGroup.Item>
                        ))}
                      </ListGroup>
                    </div>
                  ) : (
                    <Alert variant="light" className="mb-0 py-2">
                      Genera una vista previa para validar compatibilidad y ver ejemplos antes de aplicar.
                    </Alert>
                  )}
                </div>
              ) : (
                <Alert variant="light" className="mb-0">
                  Genera una vista previa para validar compatibilidad y ver ejemplos antes de aplicar.
                </Alert>
              )}
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer className="justify-content-between">
        <div className="text-muted small">
          {applyPhaseLabel || (preview?.valid ? "Vista previa validada. Ya podes aplicar la consolidacion." : "Vista previa pendiente.")}
        </div>

        <div className="d-flex gap-2">
          <Button type="button" variant="secondary" onClick={onHide} disabled={applyLoading}>
            Cerrar
          </Button>
          <Button type="button" variant="primary" onClick={handleOpenApplyConfirm} disabled={!canApply}>
            Aplicar consolidacion
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
