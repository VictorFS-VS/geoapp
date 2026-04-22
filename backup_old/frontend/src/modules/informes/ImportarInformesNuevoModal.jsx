import React, { useMemo, useState } from "react";
import { Modal, Button, Form, Alert, Spinner, Table, Badge } from "react-bootstrap";
import * as XLSX from "xlsx";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_DEFAULT = BASE.endsWith("/api") ? BASE : BASE + "/api";

const UNIQUE_HINTS = [
  "id",
  "id_unico",
  "codigo",
  "uuid",
  "identificador",
  "folio",
  "nro_formulario",
  "nro formulario",
  "numero formulario",
];

const CHUNK_SIZE = 200;

export default function ImportarInformesNuevoModal({
  show,
  onHide,
  API_URL = API_DEFAULT,
  authHeaders = () => ({}),
  idProyecto,
  idPlantilla,
  nombrePlantilla,
  linksDestino = [],
}) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPrepare, setLoadingPrepare] = useState(false);
  const [err, setErr] = useState("");
  const [profile, setProfile] = useState(null);
  const [mappingByCol, setMappingByCol] = useState({});
  const [uniqueFieldId, setUniqueFieldId] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [destinoKey, setDestinoKey] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const preguntas = profile?.preguntas || [];
  const destinos = useMemo(() => {
    return (linksDestino || [])
      .map((d, idx) => ({
        key: String(d?.id_share ?? d?.id_link ?? d?.id ?? `dest_${idx}`),
        id_proyecto: Number(d?.id_proyecto) || null,
        id_link: d?.id_share ?? d?.id_link ?? d?.id ?? null,
        titulo: d?.titulo || d?.nombre || "",
      }))
      .filter((d) => d.id_proyecto);
  }, [linksDestino]);
  const destinoSeleccionado = useMemo(
    () => destinos.find((d) => d.key === destinoKey) || null,
    [destinos, destinoKey]
  );
  const effectiveProyectoId = Number(idProyecto) || Number(destinoSeleccionado?.id_proyecto) || null;

  const preguntasOpts = useMemo(() => {
    return (preguntas || [])
      .map((q) => ({
        id: Number(q.id_pregunta),
        label: q.etiqueta || q.titulo || `#${q.id_pregunta}`,
        tipo: q.tipo || "",
      }))
      .filter((x) => Number.isFinite(x.id));
  }, [preguntas]);

  function resetAll() {
    setFile(null);
    setRows([]);
    setErr("");
    setProfile(null);
    setMappingByCol({});
    setUniqueFieldId("");
    setPrepareResult(null);
    setRunResult(null);
    setDestinoKey("");
    setProgress({ current: 0, total: 0 });
  }

  async function onPickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setRows([]);
    setErr("");
    setProfile(null);
    setMappingByCol({});
    setUniqueFieldId("");
    setPrepareResult(null);
  }

  function applySuggestedMapping(suggested = []) {
    const next = {};
    for (const m of suggested) {
      if (m?.col && m?.ok && Number.isFinite(Number(m.id_pregunta))) {
        next[m.col] = String(m.id_pregunta);
      }
    }
    setMappingByCol(next);
  }

  async function runProfile() {
    if (!file) {
      setErr("Selecciona un archivo primero.");
      return;
    }
    if (!effectiveProyectoId || !idPlantilla) {
      setErr("Falta proyecto o plantilla.");
      return;
    }
    setErr("");
    setLoadingProfile(true);
    setPrepareResult(null);
    setRunResult(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) throw new Error("El Excel no tiene hojas.");
      const sheet = wb.Sheets[sheetName];
      const parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
        throw new Error("El Excel no contiene filas validas o el encabezado no esta bien ubicado.");
      }

      const headers = Object.keys(parsedRows[0] || {});
      const previewRows = parsedRows.slice(0, 20);

      const catRes = await fetch(`${API_URL}/informes/import-xlsx/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          id_plantilla: Number(idPlantilla),
          headers,
        }),
      });
      const catData = await catRes.json().catch(() => ({}));
      if (!catRes.ok || catData?.ok === false) {
        throw new Error(catData?.error || catData?.message || `Error HTTP ${catRes.status}`);
      }

      setRows(parsedRows);
      setProfile({
        ok: true,
        headers,
        previewRows,
        totalRows: parsedRows.length,
        preguntas: catData.preguntas || [],
        mappingSuggested: catData.mappingSuggested || [],
        uniqueFieldCandidates: catData.uniqueFieldCandidates || [],
        uniqueFieldSuggestedId: catData.uniqueFieldSuggestedId || null,
      });
      applySuggestedMapping(catData.mappingSuggested || []);
      if (catData.uniqueFieldSuggestedId) {
        setUniqueFieldId(String(catData.uniqueFieldSuggestedId));
      } else {
        setUniqueFieldId("");
      }
    } catch (e) {
      setErr(e?.message || "Error al analizar el Excel.");
    } finally {
      setLoadingProfile(false);
    }
  }

  function onChangeMapping(col, val) {
    setPrepareResult(null);
    setRunResult(null);
    setMappingByCol((prev) => ({
      ...prev,
      [col]: val,
    }));
  }

  function buildMappingPayload() {
    const arr = [];
    for (const [col, id] of Object.entries(mappingByCol || {})) {
      const n = Number(id);
      if (!Number.isFinite(n)) continue;
      arr.push({ col, id_pregunta: n });
    }
    return arr;
  }

  async function runPrepare() {
    if (!file) {
      setErr("Selecciona un archivo primero.");
      return;
    }
    if (!effectiveProyectoId || !idPlantilla) {
      setErr("Falta proyecto o plantilla.");
      return;
    }
    const mapping = buildMappingPayload();
    if (!mapping.length) {
      setErr("No hay columnas mapeadas.");
      return;
    }
    if (!rows.length) {
      setErr("No hay filas parseadas para preparar.");
      return;
    }

    setErr("");
    setLoadingPrepare(true);
    setPrepareResult(null);
    setRunResult(null);

    try {
      const body = {
        id_proyecto: Number(effectiveProyectoId),
        id_plantilla: Number(idPlantilla),
        headers: profile?.headers || [],
        previewRows: profile?.previewRows || [],
        totalRows: rows.length,
        mapping,
      };
      if (uniqueFieldId) body.id_pregunta_unicidad = Number(uniqueFieldId);

      const res = await fetch(`${API_URL}/informes/import-xlsx/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.message || `Error HTTP ${res.status}`);
      }

      setProfile((prev) => ({
        ...(prev || {}),
        preguntas: data.preguntas || [],
        mappingSuggested: data.mappingSuggested || [],
        uniqueFieldCandidates: data.uniqueFieldCandidates || [],
        uniqueFieldSuggestedId: data.uniqueFieldSuggestedId || null,
      }));
      applySuggestedMapping(data.mappingSuggested || []);
      if (data.uniqueFieldSuggestedId) {
        setUniqueFieldId(String(data.uniqueFieldSuggestedId));
      } else {
        setUniqueFieldId("");
      }
      setPrepareResult(data);
    } catch (e) {
      setErr(e?.message || "Error al preparar la importacion.");
    } finally {
      setLoadingPrepare(false);
    }
  }

  async function runImport() {
    if (!file) {
      setErr("Selecciona un archivo primero.");
      return;
    }
    if (!effectiveProyectoId || !idPlantilla) {
      setErr("Falta proyecto o plantilla.");
      return;
    }
    const mapping = buildMappingPayload();
    if (!mapping.length) {
      setErr("No hay columnas mapeadas.");
      return;
    }
    if (!uniqueFieldId) {
      setErr("Selecciona un campo unico para ejecutar.");
      return;
    }
    if (!rows.length) {
      setErr("No hay filas para importar.");
      return;
    }

    setErr("");
    setLoadingRun(true);
    setRunResult(null);
    setProgress({ current: 0, total: 0 });

    try {
      const totalRows = rows.length;
      const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);
      const summary = {
        totalRows,
        created: 0,
        updated: 0,
        skipped: 0,
        errored: 0,
        hiddenSkipped: 0,
        imageFieldSkippedByRule: 0,
        imagesDownloaded: 0,
        imagesSkipped: 0,
        imagesErrored: 0,
      };
      const rowsOut = [];

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunkIndex = Math.floor(i / CHUNK_SIZE);
        const chunk = rows.slice(i, i + CHUNK_SIZE);

        setProgress({ current: chunkIndex + 1, total: totalChunks });

        const body = {
          id_proyecto: Number(effectiveProyectoId),
          id_plantilla: Number(idPlantilla),
          mapping,
          id_pregunta_unicidad: Number(uniqueFieldId),
          rows: chunk,
          totalRows,
          chunkIndex,
          totalChunks,
        };

        const res = await fetch(`${API_URL}/informes/import-xlsx/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || data?.message || `Error HTTP ${res.status}`);
        }

        const s = data?.summary || {};
        summary.created += Number(s.created || 0);
        summary.updated += Number(s.updated || 0);
        summary.skipped += Number(s.skipped || 0);
        summary.errored += Number(s.errored || 0);
        summary.hiddenSkipped += Number(s.hiddenSkipped || 0);
        summary.imageFieldSkippedByRule += Number(s.imageFieldSkippedByRule || 0);
        summary.imagesDownloaded += Number(s.imagesDownloaded || 0);
        summary.imagesSkipped += Number(s.imagesSkipped || 0);
        summary.imagesErrored += Number(s.imagesErrored || 0);

        if (Array.isArray(data?.rows)) {
          rowsOut.push(...data.rows);
        }
      }

      const limit = 200;
      const finalRows = rowsOut.length > limit ? rowsOut.slice(0, limit) : rowsOut;

      setRunResult({
        ok: true,
        summary,
        rows: finalRows,
        rowsLimit: limit,
        rowsTruncated: rowsOut.length > limit,
      });
    } catch (e) {
      setErr(e?.message || "Error al ejecutar la importacion.");
    } finally {
      setLoadingRun(false);
    }
  }

  const headers = profile?.headers || [];
  const previewRows = profile?.previewRows || [];

  const uniqueSuggestions = useMemo(() => {
    const suggested = (profile?.uniqueFieldCandidates || []).map((c) => String(c.id_pregunta));
    const set = new Set(suggested);
    return preguntasOpts.filter((p) => set.has(String(p.id)));
  }, [profile, preguntasOpts]);

  const autoHint = useMemo(() => {
    const joined = headers.map((h) => String(h || "").toLowerCase()).join(" ");
    return UNIQUE_HINTS.some((k) => joined.includes(k));
  }, [headers]);

  return (
    <Modal
      show={show}
      onHide={() => {
        resetAll();
        onHide?.();
      }}
      centered
      size="xl"
    >
      <Modal.Header closeButton>
        <Modal.Title>Importar informes (nuevo canal)</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Alert variant="info" className="mb-3">
          <div className="fw-semibold mb-1">Importacion masiva (preview)</div>
          <div className="small">
            Proyecto: <b>{effectiveProyectoId || "-"}</b> · Plantilla:{" "}
            <b>{nombrePlantilla || `#${idPlantilla || "-"}`}</b>
          </div>
        </Alert>

        {loadingRun && progress.total > 0 ? (
          <Alert variant="secondary" className="py-2">
            Procesando lote {progress.current} de {progress.total}
          </Alert>
        ) : null}

        {!idProyecto ? (
          <Form.Group className="mb-3">
            <Form.Label>Proyecto / link destino</Form.Label>
            <Form.Select value={destinoKey} onChange={(e) => setDestinoKey(e.target.value)}>
              <option value="">Seleccionar destino...</option>
              {destinos.map((d) => (
                <option key={d.key} value={d.key}>
                  #{d.id_proyecto} {d.titulo ? `- ${d.titulo}` : ""}
                </option>
              ))}
            </Form.Select>
            <div className="small text-muted mt-1">
              Usa el id_proyecto real del link destino seleccionado.
            </div>
            {destinoSeleccionado ? (
              <div className="small text-muted mt-1">
                id_link: <b>{destinoSeleccionado.id_link || "-"}</b> · id_proyecto:{" "}
                <b>{destinoSeleccionado.id_proyecto}</b>
              </div>
            ) : null}
          </Form.Group>
        ) : null}

        <Form.Group className="mb-2">
          <Form.Label>Archivo XLS/XLSX</Form.Label>
          <Form.Control type="file" accept=".xlsx,.xls" onChange={onPickFile} />
        </Form.Group>

        {file ? (
          <div className="small text-muted mt-1">
            Archivo: <b>{file.name}</b>
          </div>
        ) : null}

        {err ? (
          <Alert className="mt-2" variant="danger">
            {err}
          </Alert>
        ) : null}

        <div className="d-flex gap-2 mt-3">
          <Button variant="primary" onClick={runProfile} disabled={loadingProfile || !file}>
            {loadingProfile ? <Spinner size="sm" className="me-2" /> : null}
            Analizar / Preview
          </Button>
        </div>

        {profile ? (
          <div className="mt-4">
            <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
              <Badge bg="primary">Filas: {profile.totalRows}</Badge>
              <Badge bg="secondary">Columnas: {headers.length}</Badge>
            </div>

            <div className="mb-3">
              <div className="fw-semibold mb-1">Campo para validar duplicados (opcional)</div>
              <Form.Select
                value={uniqueFieldId}
                onChange={(e) => setUniqueFieldId(e.target.value)}
              >
                <option value="">(Sin seleccionar)</option>
                {uniqueSuggestions.length ? (
                  uniqueSuggestions.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      #{p.id} - {p.label}
                    </option>
                  ))
                ) : null}
                {preguntasOpts.length ? (
                  <>
                    <option value="" disabled>
                      -------------
                    </option>
                    {preguntasOpts.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        #{p.id} - {p.label}
                      </option>
                    ))}
                  </>
                ) : null}
              </Form.Select>
              <div className="small text-muted mt-1">
                {autoHint
                  ? "Sugerencia automatica aplicada si encontro un campo tipo id/codigo."
                  : "No se detecto un campo evidente; seleccion opcional."}
              </div>
            </div>

            <div className="mb-3">
              <div className="fw-semibold mb-1">Mapping sugerido (editable)</div>
              <div className="table-responsive">
                <Table bordered size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>Columna Excel</th>
                      <th>Asignar a pregunta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((h) => {
                      const val = mappingByCol[h] ?? "";
                      return (
                        <tr key={h}>
                          <td>{h || "(sin encabezado)"}</td>
                          <td>
                            <Form.Select
                              size="sm"
                              value={val}
                              onChange={(e) => onChangeMapping(h, e.target.value)}
                            >
                              <option value="">Ignorar</option>
                              {preguntasOpts.map((p) => (
                                <option key={p.id} value={String(p.id)}>
                                  #{p.id} - {p.label}
                                </option>
                              ))}
                            </Form.Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </div>

            <div className="mb-3">
              <div className="fw-semibold mb-1">Preview (primeras filas)</div>
              <div className="table-responsive">
                <Table bordered size="sm" className="mb-0">
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={`${h}-${i}`}>{h || `COL_${i + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, idx) => (
                      <tr key={`row-${idx}`}>
                        {headers.map((h, i) => (
                          <td key={`${idx}-${i}`}>
                            {String(r?.[h] ?? "").slice(0, 120)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            <div className="d-flex gap-2">
              <Button
                variant="success"
                onClick={runPrepare}
                disabled={loadingPrepare || !file}
              >
                {loadingPrepare ? <Spinner size="sm" className="me-2" /> : null}
                Preparar importacion
              </Button>
              <Button
                variant="primary"
                onClick={runImport}
                disabled={loadingRun || !file}
              >
                {loadingRun ? <Spinner size="sm" className="me-2" /> : null}
                Ejecutar importacion
              </Button>
            </div>

            {prepareResult ? (
              <Alert className="mt-3" variant="success">
                <div className="fw-semibold">Preparacion OK</div>
                <div className="small">
                  Filas: {prepareResult.totalRows} · Columnas: {prepareResult.totalColumns} ·
                  Mapeadas: {prepareResult.totalMapped}
                </div>
                {prepareResult.columnasSinMatch?.length ? (
                  <div className="small mt-2">
                    Columnas sin match: {prepareResult.columnasSinMatch.join(", ")}
                  </div>
                ) : null}
              </Alert>
            ) : null}

            {runResult ? (
              <Alert className="mt-3" variant="secondary">
                <div className="fw-semibold">Resultado de ejecucion</div>
                <div className="small">
                  Total: {runResult.summary?.totalRows ?? 0} · Created:{" "}
                  {runResult.summary?.created ?? 0} · Updated:{" "}
                  {runResult.summary?.updated ?? 0} · Skipped:{" "}
                  {runResult.summary?.skipped ?? 0} · Errored:{" "}
                  {runResult.summary?.errored ?? 0}
                </div>
                <div className="small">
                  Imagenes - descargadas: {runResult.summary?.imagesDownloaded ?? 0} - saltadas:{" "}
                  {runResult.summary?.imagesSkipped ?? 0} - error:{" "}
                  {runResult.summary?.imagesErrored ?? 0}
                </div>
                <div className="small">
                  Reglas legacy - ocultas saltadas: {runResult.summary?.hiddenSkipped ?? 0} - imagen no persistida como respuesta:{" "}
                  {runResult.summary?.imageFieldSkippedByRule ?? 0}
                </div>
                {Array.isArray(runResult.rows) && runResult.rows.length ? (
                  <div className="table-responsive mt-2">
                    <Table bordered size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th>Fila</th>
                          <th>Accion</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runResult.rows.map((r, i) => (
                          <tr key={`${r.rowNumber}-${i}`}>
                            <td>{r.rowNumber}</td>
                            <td>{r.action}</td>
                            <td>
                              {r.id_informe
                                ? `id_informe ${r.id_informe}`
                                : r.reason || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                    {runResult.rowsTruncated ? (
                      <div className="small text-muted mt-1">
                        Detalle truncado a {runResult.rowsLimit} filas.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Modal.Body>

      <Modal.Footer>
        <Button
          variant="secondary"
          onClick={() => {
            resetAll();
            onHide?.();
          }}
        >
          Cerrar
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
