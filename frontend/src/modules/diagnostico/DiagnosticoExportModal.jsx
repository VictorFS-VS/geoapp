import React, { useEffect, useMemo, useState } from "react";
import { Accordion, Alert, Badge, Button, Form, Modal, Spinner } from "react-bootstrap";

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

function getFilenameFromContentDisposition(cd) {
  if (!cd) return "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);
  try {
    return decodeURIComponent(m?.[1] || m?.[2] || "");
  } catch {
    return m?.[1] || m?.[2] || "";
  }
}

function sanitizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const BASE_FIELDS = [
  { key: "id_informe", label: "id_informe", group: "Datos del informe" },
  { key: "fecha", label: "fecha", group: "Datos del informe" },
  { key: "plantilla", label: "plantilla", group: "Datos del informe" },
];

const DIAGNOSTIC_FIELDS = [
  { key: "id_registro", label: "id_registro", group: "Diagnóstico" },
  { key: "score_total", label: "score_total", group: "Diagnóstico" },
  { key: "clasificacion_auto", label: "clasificacion_auto", group: "Diagnóstico" },
  { key: "resultado_consultor", label: "resultado_consultor", group: "Diagnóstico" },
  { key: "resultado_final", label: "resultado_final", group: "Diagnóstico" },
  { key: "manual_comment", label: "manual_comment", group: "Diagnóstico" },
  { key: "fecha_manual_evaluacion", label: "fecha_manual_evaluacion", group: "Diagnóstico" },
  { key: "evaluador", label: "evaluador", group: "Diagnóstico" },
  { key: "cambio_detectado", label: "cambio_detectado", group: "Diagnóstico" },
  { key: "version_formula", label: "version_formula", group: "Diagnóstico" },
  { key: "descripcion_rango", label: "descripcion_rango", group: "Diagnóstico" },
];

const DEFAULT_BASE_FIELDS = BASE_FIELDS.map((f) => f.key);
const DEFAULT_DIAGNOSTIC_FIELDS = DIAGNOSTIC_FIELDS.map((f) => f.key);

function deriveSectionLabel(section, index) {
  return (
    section?.titulo ||
    section?.nombre ||
    section?.title ||
    section?.seccion_titulo ||
    section?.nombre_seccion ||
    `Sección ${index + 1}`
  );
}

function normalizeQuestionsFromSections(sections = [], flatQuestions = []) {
  const secs = Array.isArray(sections) ? sections : [];
  const flat = Array.isArray(flatQuestions) ? flatQuestions : [];

  if (secs.length) {
    return secs.map((sec, idx) => {
      const preguntas = Array.isArray(sec?.preguntas) ? sec.preguntas : [];
      return {
        id: sec?.id_seccion ?? sec?.id ?? `sec-${idx + 1}`,
        label: deriveSectionLabel(sec, idx),
        preguntas: preguntas.map((p, pIdx) => ({
          id_pregunta: Number(p.id_pregunta),
          label: p.etiqueta || p.label || p.nombre || `Pregunta ${pIdx + 1}`,
          key: p.key || p.etiqueta || p.label || String(p.id_pregunta),
          raw: p,
        })),
      };
    });
  }

  const grouped = new Map();
  flat.forEach((p, idx) => {
    const sectionId = p?.id_seccion ?? p?.seccion_id ?? p?.section_id ?? p?.grupo_id ?? "sin-seccion";
    const sectionLabel =
      p?.seccion_titulo ||
      p?.seccion ||
      p?.nombre_seccion ||
      p?.titulo_seccion ||
      p?.section_name ||
      p?.section ||
      "Sin sección";

    if (!grouped.has(String(sectionId))) {
      grouped.set(String(sectionId), {
        id: sectionId,
        label: sectionLabel,
        preguntas: [],
      });
    }
    grouped.get(String(sectionId)).preguntas.push({
      id_pregunta: Number(p.id_pregunta),
      label: p.etiqueta || p.label || p.nombre || `Pregunta ${idx + 1}`,
      key: p.key || p.etiqueta || p.label || String(p.id_pregunta),
      raw: p,
    });
  });

  return Array.from(grouped.values());
}

async function downloadBlobFromResponse(resp, fallbackFilename) {
  if (!resp.ok) {
    const ct = resp.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    let msg = "";

    if (isJson) {
      const data = await resp.json().catch(() => null);
      msg = data?.error || data?.message || "";
    } else {
      msg = await resp.text().catch(() => "");
    }

    throw new Error(`HTTP ${resp.status} ${msg}`.trim());
  }

  const blob = await resp.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const cd = resp.headers.get("content-disposition") || "";
  const filename = getFilenameFromContentDisposition(cd) || fallbackFilename || "diagnostico.xlsx";

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export default function DiagnosticoExportModal({
  show,
  onHide,
  idProyecto,
  idPlantilla,
  formulaActiva,
  preguntasPlantilla = [],
}) {
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [search, setSearch] = useState("");
  const [sections, setSections] = useState([]);
  const [selectedBaseFields, setSelectedBaseFields] = useState(DEFAULT_BASE_FIELDS);
  const [selectedDiagnosticFields, setSelectedDiagnosticFields] = useState(DEFAULT_DIAGNOSTIC_FIELDS);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [openSections, setOpenSections] = useState([]);

  useEffect(() => {
    if (!show || !idPlantilla) {
      setSections([]);
      setMetaError("");
      return;
    }

    let active = true;
    const fetchMeta = async () => {
      try {
        setLoadingMeta(true);
        setMetaError("");
        const resp = await fetch(`${API_URL}/informes/plantillas/${idPlantilla}`, {
          headers: authHeaders(),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        if (!active) return;
        const normalizedSections = normalizeQuestionsFromSections(data?.secciones || [], preguntasPlantilla);
        setSections(normalizedSections);
      } catch (err) {
        if (!active) return;
        setMetaError("No se pudo cargar la estructura de la plantilla.");
        setSections(normalizeQuestionsFromSections([], preguntasPlantilla));
      } finally {
        if (active) setLoadingMeta(false);
      }
    };

    fetchMeta();
    return () => {
      active = false;
    };
  }, [show, idPlantilla, preguntasPlantilla]);

  const allQuestionIds = useMemo(
    () => sections.flatMap((sec) => (sec.preguntas || []).map((q) => Number(q.id_pregunta)).filter(Boolean)),
    [sections]
  );

  useEffect(() => {
    if (!show) return;

    const uniqueQuestionIds = Array.from(new Set(allQuestionIds));
    setSelectedBaseFields(DEFAULT_BASE_FIELDS);
    setSelectedDiagnosticFields(DEFAULT_DIAGNOSTIC_FIELDS);
    setSelectedQuestionIds(uniqueQuestionIds);
    setOpenSections(sections.map((sec) => String(sec.id)));
    setSearch("");
    setExportError("");
  }, [show, allQuestionIds, sections]);

  const query = sanitizeText(search);

  const filteredBaseFields = useMemo(
    () =>
      BASE_FIELDS.filter((field) => {
        if (!query) return true;
        return [field.key, field.label, field.group].some((t) => sanitizeText(t).includes(query));
      }),
    [query]
  );

  const filteredDiagnosticFields = useMemo(
    () =>
      DIAGNOSTIC_FIELDS.filter((field) => {
        if (!query) return true;
        return [field.key, field.label, field.group].some((t) => sanitizeText(t).includes(query));
      }),
    [query]
  );

  const filteredSections = useMemo(() => {
    return sections
      .map((sec) => {
        const preguntas = (sec.preguntas || []).filter((q) => {
          if (!query) return true;
          return [sec.label, q.label, q.key, q.id_pregunta].some((t) => sanitizeText(t).includes(query));
        });
        return { ...sec, preguntas };
      })
      .filter((sec) => sec.preguntas.length > 0);
  }, [sections, query]);

  const selectedCount =
    selectedBaseFields.length + selectedDiagnosticFields.length + selectedQuestionIds.length;

  const setAllQuestionsSelected = () => setSelectedQuestionIds(Array.from(new Set(allQuestionIds)));

  const handleRestoreRecommended = () => {
    setSelectedBaseFields(DEFAULT_BASE_FIELDS);
    setSelectedDiagnosticFields(DEFAULT_DIAGNOSTIC_FIELDS);
    setSelectedQuestionIds(Array.from(new Set(allQuestionIds)));
    setExportError("");
  };

  const handleSelectAll = () => {
    setSelectedBaseFields(BASE_FIELDS.map((f) => f.key));
    setSelectedDiagnosticFields(DIAGNOSTIC_FIELDS.map((f) => f.key));
    setAllQuestionsSelected();
  };

  const handleClear = () => {
    setSelectedBaseFields([]);
    setSelectedDiagnosticFields([]);
    setSelectedQuestionIds([]);
  };

  const toggleSection = (sectionQuestionIds, checked) => {
    const ids = sectionQuestionIds.map(Number).filter(Boolean);
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev.map(Number));
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return Array.from(next);
    });
  };

  const isSectionSelected = (sectionQuestionIds) => {
    const ids = sectionQuestionIds.map(Number).filter(Boolean);
    if (!ids.length) return false;
    return ids.every((id) => selectedQuestionIds.includes(id));
  };

  const handleExport = async () => {
    if (!formulaActiva) {
      setExportError("No hay una fórmula activa para exportar diagnóstico.");
      return;
    }

    try {
      setExportBusy(true);
      setExportError("");

      const resp = await fetch(`${API_URL}/diagnostico/proyecto/${idProyecto}/export/excel`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: JSON.stringify({
          id_plantilla: idPlantilla,
          base_fields: selectedBaseFields,
          diagnostic_fields: selectedDiagnosticFields,
          question_ids: selectedQuestionIds,
        }),
      });

      const fecha = new Date().toISOString().split("T")[0];
      await downloadBlobFromResponse(resp, `diagnostico_proyecto_${idProyecto}_${fecha}.xlsx`);
      onHide?.();
    } catch (err) {
      setExportError(err?.message || "No se pudo generar el Excel de diagnóstico.");
    } finally {
      setExportBusy(false);
    }
  };

  const isEmpty = !loadingMeta && sections.length === 0 && preguntasPlantilla.length === 0;

  return (
    <Modal show={show} onHide={() => !exportBusy && onHide?.()} size="xl" centered scrollable>
      <Modal.Header closeButton={!exportBusy}>
        <div>
          <Modal.Title className="mb-1">Exportar diagnóstico</Modal.Title>
          <div className="text-muted small">Elegí qué datos incluir en el XLS.</div>
        </div>
      </Modal.Header>

      <Modal.Body className="bg-light">
        {exportError && (
          <Alert variant="danger" className="mb-3">
            {exportError}
          </Alert>
        )}

        {!formulaActiva && (
          <Alert variant="warning" className="mb-3">
            No hay una fórmula activa para esta plantilla. El export diagnóstico no está disponible.
          </Alert>
        )}

        {metaError && (
          <Alert variant="warning" className="mb-3">
            {metaError}
          </Alert>
        )}

        <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
          <Form.Control
            type="search"
            placeholder="Buscar por etiqueta o campo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 420 }}
            disabled={exportBusy}
          />

          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Badge bg="dark" className="px-3 py-2">
              {selectedCount} seleccionados
            </Badge>
            {idPlantilla ? <Badge bg="info">Plantilla #{idPlantilla}</Badge> : null}
          </div>
        </div>

        {loadingMeta && (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" className="me-2" />
            Cargando estructura de plantilla...
          </div>
        )}

        {!loadingMeta && isEmpty && (
          <Alert variant="secondary" className="mb-0">
            No hay preguntas disponibles para esta plantilla.
          </Alert>
        )}

        {!loadingMeta && !isEmpty && (
          <div className="d-flex flex-column gap-3">
            <div className="d-flex flex-wrap gap-2">
              <Button variant="outline-secondary" onClick={handleRestoreRecommended} disabled={exportBusy}>
                Restaurar recomendado
              </Button>
              <Button variant="outline-dark" onClick={handleSelectAll} disabled={exportBusy}>
                Seleccionar todo
              </Button>
              <Button variant="outline-danger" onClick={handleClear} disabled={exportBusy}>
                Limpiar selección
              </Button>
            </div>

            <div className="border rounded bg-white p-3">
              <div className="fw-semibold mb-2">Datos del informe</div>
              <div className="d-flex flex-wrap gap-2">
                {filteredBaseFields.map((field) => (
                  <Form.Check
                    key={field.key}
                    id={`diagnostico-base-${field.key}`}
                    type="checkbox"
                    label={field.label}
                    checked={selectedBaseFields.includes(field.key)}
                    onChange={(e) =>
                      setSelectedBaseFields((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, field.key]))
                          : prev.filter((k) => k !== field.key)
                      )
                    }
                    className="me-3"
                  />
                ))}
              </div>
            </div>

            <div className="border rounded bg-white p-3">
              <div className="fw-semibold mb-2">Diagnóstico</div>
              <div className="d-flex flex-wrap gap-2">
                {filteredDiagnosticFields.map((field) => (
                  <Form.Check
                    key={field.key}
                    id={`diagnostico-field-${field.key}`}
                    type="checkbox"
                    label={field.label}
                    checked={selectedDiagnosticFields.includes(field.key)}
                    onChange={(e) =>
                      setSelectedDiagnosticFields((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, field.key]))
                          : prev.filter((k) => k !== field.key)
                      )
                    }
                    className="me-3"
                  />
                ))}
              </div>
            </div>

            <div className="border rounded bg-white p-3">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div className="fw-semibold">Respuestas del informe</div>
                <Badge bg="secondary">{filteredSections.length} secciones</Badge>
              </div>

              <Accordion alwaysOpen activeKey={openSections} onSelect={(key) => {
                const eventKey = String(key);
                setOpenSections((prev) =>
                  prev.includes(eventKey)
                    ? prev.filter((k) => k !== eventKey)
                    : [...prev, eventKey]
                );
              }}>
                {filteredSections.map((section) => {
                  const questionIds = (section.preguntas || []).map((q) => Number(q.id_pregunta)).filter(Boolean);
                  const sectionKey = String(section.id);
                  const allSelected = isSectionSelected(questionIds);

                  return (
                    <Accordion.Item eventKey={sectionKey} key={sectionKey}>
                      <Accordion.Header>
                        <div
                          className="d-flex align-items-center justify-content-between w-100 gap-3 me-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="d-flex align-items-center gap-2">
                            <Form.Check
                              checked={allSelected}
                              onChange={(e) => toggleSection(questionIds, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                              id={`sec-check-${sectionKey}`}
                            />
                            <span className="fw-semibold">{section.label}</span>
                          </div>
                          <Badge bg="light" text="dark">
                            {questionIds.length} preguntas
                          </Badge>
                        </div>
                      </Accordion.Header>
                      <Accordion.Body className="bg-white">
                        <div className="row g-2">
                          {section.preguntas.map((q) => {
                            const visible = !query || [q.label, q.key, section.label].some((t) => sanitizeText(t).includes(query));
                            if (!visible) return null;

                            return (
                              <div className="col-12 col-md-6" key={q.id_pregunta}>
                                <Form.Check
                                  id={`q-${q.id_pregunta}`}
                                  type="checkbox"
                                  label={
                                    <span>
                                      <span className="fw-medium">{q.label}</span>
                                      <span className="text-muted ms-2 small">#{q.id_pregunta}</span>
                                    </span>
                                  }
                                  checked={selectedQuestionIds.includes(Number(q.id_pregunta))}
                                  onChange={(e) =>
                                    setSelectedQuestionIds((prev) =>
                                      e.target.checked
                                        ? Array.from(new Set([...prev, Number(q.id_pregunta)]))
                                        : prev.filter((id) => id !== Number(q.id_pregunta))
                                    )
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </Accordion.Body>
                    </Accordion.Item>
                  );
                })}
              </Accordion>
            </div>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="justify-content-between">
        <div className="text-muted small">
          {selectedCount} elementos seleccionados
        </div>
        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={() => !exportBusy && onHide?.()} disabled={exportBusy}>
            Cancelar
          </Button>
          <Button variant="success" onClick={handleExport} disabled={exportBusy || !formulaActiva}>
            {exportBusy ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Exportando...
              </>
            ) : (
              "Exportar XLS"
            )}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
