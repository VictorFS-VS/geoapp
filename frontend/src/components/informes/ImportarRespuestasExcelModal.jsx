import React, { useEffect, useMemo, useState } from "react";
import { Modal, Button, Form, Alert, Spinner, Table, Badge } from "react-bootstrap";
import * as XLSX from "xlsx";

/* =========================
   Normalización fuerte
========================= */
function normKey(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

/* =========================
   Alias / Sinónimos
========================= */
const ALIAS = {
  [normKey("FECHA DE RELEVAMIENTO")]: normKey("FECHA DEL RELEVAMIENTO"),
  [normKey("FECHA DEL RELEVAMIENTO")]: normKey("FECHA DEL RELEVAMIENTO"),

  [normKey("NOMBRE Y APELLIDO")]: normKey("NOMBRE Y APELLIDO"),
  [normKey("Nombre y apellido")]: normKey("NOMBRE Y APELLIDO"),

  [normKey("NOMBRE DEL CENSISTA")]: normKey("NOMBRE DEL CENSISTA"),

  [normKey("N° DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("Nº DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("NRO DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("N DE TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("N TELEFONO")]: normKey("N DE TELEFONO"),
  [normKey("TELEFONO")]: normKey("N DE TELEFONO"),

  [normKey("N° DE C.I.")]: normKey("N DE CI"),
  [normKey("Nº DE C.I.")]: normKey("N DE CI"),
  [normKey("NRO DE CI")]: normKey("N DE CI"),
  [normKey("N DE CI")]: normKey("N DE CI"),
  [normKey("N CI")]: normKey("N DE CI"),
  [normKey("CEDULA")]: normKey("N DE CI"),
  [normKey("CEDULA DE IDENTIDAD")]: normKey("N DE CI"),

  [normKey("CUENTA CON CEDULA DE IDENTIDAD")]: normKey("CUENTA CON CEDULA DE IDENTIDAD"),

  [normKey("TIPO DE INMUEBLE")]: normKey("TIPO DE INMUEBLE"),
  [normKey("AFECTACION")]: normKey("AFECTACION"),

  [normKey("TRAMO")]: normKey("TRAMOS"),
  [normKey("TRAMOS")]: normKey("TRAMOS"),

  [normKey("CODIGO")]: normKey("CODIGO"),
  [normKey("CÓDIGO")]: normKey("CODIGO"),

  [normKey("CIUDAD")]: normKey("CIUDAD"),
  [normKey("BARRIO")]: normKey("BARRIO"),

  [normKey("ESPECIFICAR OTRO")]: normKey("ESPECIFICAR OTRO"),
  [normKey("ESPECIFIQUE OTRO")]: normKey("ESPECIFICAR OTRO"),
};

/* =========================
   Helpers: parsing Excel
========================= */
function pickFirstSheet(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error("El Excel no tiene hojas.");

  const sh = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sh, { defval: "" });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("El Excel no contiene filas válidas o el encabezado no está bien ubicado.");
  }

  return rows;
}

function parsePreguntaIdFromHeader(header) {
  const h = String(header || "").trim();

  const m1 = h.match(/^#\s*(\d+)\s*$/i);
  if (m1) return Number(m1[1]);

  const m2 = h.match(/^p\s*(\d+)\s*$/i);
  if (m2) return Number(m2[1]);

  const m3 = h.match(/id[_\s-]*pregunta[:\s-]*(\d+)/i);
  if (m3) return Number(m3[1]);

  const m4 = h.match(/pregunta[:\s-]*(\d+)/i);
  if (m4) return Number(m4[1]);

  return null;
}

/* =========================
   Similaridad (fuzzy)
========================= */
function tokensOf(s) {
  const nk = normKey(s);
  if (!nk) return [];
  return nk.split(" ").filter(Boolean);
}

function bigrams(s) {
  const t = normKey(s).replace(/\s+/g, " ");
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;

  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;

  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

function fuzzyScore(excelLabel, plantillaLabel) {
  const tok = jaccard(tokensOf(excelLabel), tokensOf(plantillaLabel));
  const bi = jaccard(bigrams(excelLabel), bigrams(plantillaLabel));
  const n1 = normKey(excelLabel);
  const n2 = normKey(plantillaLabel);
  const prefix = n1 && n2 && (n1.startsWith(n2) || n2.startsWith(n1)) ? 0.12 : 0;
  return 0.65 * tok + 0.35 * bi + prefix;
}

function getTopCandidates(excelCol, preguntasLista, max = 8) {
  const excelNorm = normKey(excelCol);
  if (!excelNorm) return [];

  const scored = (preguntasLista || [])
    .map((q) => {
      const label = q?.etiqueta || q?.titulo || "";
      const score = fuzzyScore(excelCol, label);
      return {
        id_pregunta: Number(q.id_pregunta),
        etiqueta: q?.etiqueta || q?.titulo || `#${q?.id_pregunta}`,
        score,
      };
    })
    .filter((x) => Number.isFinite(x.id_pregunta))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  const best = scored[0]?.score ?? 0;
  return best >= 0.18 ? scored : [];
}

/* =========================
   API helper
========================= */
async function apiSend(API_URL, authHeaders, path, method, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `Error HTTP ${res.status}`);
  return data;
}

/* =========================
   Match helpers
========================= */
function buildNormalizedVariants(raw) {
  const base = normKey(raw);
  const out = new Set();
  if (!base) return [];

  out.add(base);

  const aliased1 = ALIAS[base];
  if (aliased1) out.add(aliased1);

  const aliased2 = aliased1 ? ALIAS[aliased1] : null;
  if (aliased2) out.add(aliased2);

  out.add(base.replace(/\bde\b/g, "").replace(/\s+/g, " ").trim());
  out.add(base.replace(/\bdel\b/g, "").replace(/\s+/g, " ").trim());
  out.add(base.replace(/\bde\b/g, "").replace(/\bdel\b/g, "").replace(/\s+/g, " ").trim());

  if (aliased1) {
    out.add(aliased1.replace(/\bde\b/g, "").replace(/\s+/g, " ").trim());
    out.add(aliased1.replace(/\bdel\b/g, "").replace(/\s+/g, " ").trim());
    out.add(aliased1.replace(/\bde\b/g, "").replace(/\bdel\b/g, "").replace(/\s+/g, " ").trim());
  }

  return Array.from(out).filter(Boolean);
}

/* =========================
   GPS helpers
========================= */
function toNumberSafe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim();
  if (!s) return null;

  // soporta coma decimal
  const normalized = s.replace(",", ".");
  const n = Number(normalized);

  return Number.isFinite(n) ? n : null;
}

function isGpsLatitudeColumn(col) {
  const n = normKey(col);
  return (
    n.includes("coordenadas gps latitude") ||
    n.includes("coordenada gps latitude") ||
    n.includes("gps latitude") ||
    n.includes("gps latitud") ||
    n.endsWith(" latitude") ||
    n.endsWith(" latitud") ||
    n.includes(" latitude ") ||
    n.includes(" latitud ") ||
    n.includes("latitude") ||
    n.includes("latitud")
  );
}

function isGpsLongitudeColumn(col) {
  const n = normKey(col);
  return (
    n.includes("coordenadas gps longitude") ||
    n.includes("coordenada gps longitude") ||
    n.includes("gps longitude") ||
    n.includes("gps longitud") ||
    n.endsWith(" longitude") ||
    n.endsWith(" longitud") ||
    n.includes(" longitude ") ||
    n.includes(" longitud ") ||
    n.includes("longitude") ||
    n.includes("longitud")
  );
}

function findGpsColumns(headers = []) {
  let latCol = null;
  let lngCol = null;

  for (const h of headers) {
    if (!latCol && isGpsLatitudeColumn(h)) latCol = h;
    if (!lngCol && isGpsLongitudeColumn(h)) lngCol = h;
  }

  return { latCol, lngCol };
}

/* =========================
   Destinos
========================= */
function normalizeDestino(x, idx = 0) {
  const id_link = Number(x?.id_link ?? x?.id_share ?? x?.id ?? null);
  const id_proyecto = Number(x?.id_proyecto ?? x?.proyecto_id ?? null);

  return {
    key: String(x?.key ?? id_link ?? idx),
    id_link: Number.isFinite(id_link) && id_link > 0 ? id_link : null,
    id_proyecto: Number.isFinite(id_proyecto) && id_proyecto > 0 ? id_proyecto : null,
    titulo: x?.titulo || x?.nombre || x?.label || "",
    cerrado_en: x?.cerrado_en || null,
  };
}

function destinoLabel(d) {
  const parts = [];
  if (d?.id_link != null) parts.push(`Link #${d.id_link}`);
  if (d?.id_proyecto != null) parts.push(`Proyecto #${d.id_proyecto}`);
  if (d?.titulo) parts.push(d.titulo);
  return parts.join(" — ");
}

/* =========================
   Component
========================= */
export default function ImportarRespuestasExcelModal({
  show,
  onHide,
  API_URL,
  authHeaders,
  idProyecto,
  idPlantilla,
  nombrePlantilla,
  preguntasLista = [],
  linksDestino = [],
}) {
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const [previewRows, setPreviewRows] = useState([]);
  const [mapInfo, setMapInfo] = useState(null);

  const [excelRows, setExcelRows] = useState([]);
  const [rowsToCreate, setRowsToCreate] = useState([]);
  const [baseColMap, setBaseColMap] = useState([]);
  const [manualMap, setManualMap] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const destinos = useMemo(() => {
    return (linksDestino || [])
      .map((x, idx) => normalizeDestino(x, idx))
      .filter((x) => x.id_link && !x.cerrado_en);
  }, [linksDestino]);

  const [destinoKey, setDestinoKey] = useState("");

  useEffect(() => {
    if (!show) return;

    if (Number(idProyecto) > 0) {
      setDestinoKey("__PROYECTO_FIJO__");
      return;
    }

    if (destinos.length === 1) {
      setDestinoKey(destinos[0].key);
      return;
    }

    setDestinoKey("");
  }, [show, idProyecto, destinos]);

  const destinoSeleccionado = useMemo(() => {
    if (destinoKey === "__PROYECTO_FIJO__") {
      return {
        key: "__PROYECTO_FIJO__",
        id_link: null,
        id_proyecto: Number(idProyecto) || null,
        titulo: "",
      };
    }

    return destinos.find((d) => String(d.key) === String(destinoKey)) || null;
  }, [destinos, destinoKey, idProyecto]);

  const proyectoDestinoFinal = useMemo(() => {
    if (Number(idProyecto) > 0) return Number(idProyecto);
    return Number(destinoSeleccionado?.id_proyecto) || null;
  }, [idProyecto, destinoSeleccionado]);

  const preguntasById = useMemo(() => {
    const m = new Map();
    (preguntasLista || []).forEach((q) => m.set(Number(q.id_pregunta), q));
    return m;
  }, [preguntasLista]);

  const preguntaIdByEtiqueta = useMemo(() => {
    const m = new Map();

    (preguntasLista || []).forEach((q) => {
      const id = Number(q.id_pregunta);
      if (!Number.isFinite(id)) return;

      const raw = q.etiqueta || q.titulo || "";
      const variants = buildNormalizedVariants(raw);

      variants.forEach((k) => {
        if (k) m.set(k, id);
      });
    });

    return m;
  }, [preguntasLista]);

  const gpsPreguntaId = useMemo(() => {
    for (const q of preguntasLista || []) {
      const id = Number(q.id_pregunta);
      if (!Number.isFinite(id)) continue;

      const raw = q.etiqueta || q.titulo || "";
      const variants = buildNormalizedVariants(raw);

      if (
        variants.includes(normKey("COORDENADAS GPS")) ||
        variants.includes(normKey("COORDENADA GPS")) ||
        normKey(raw).includes(normKey("COORDENADAS GPS")) ||
        normKey(raw).includes(normKey("COORDENADA GPS"))
      ) {
        return id;
      }
    }
    return null;
  }, [preguntasLista]);

  const usedPreguntaIds = useMemo(() => {
    const s = new Set();

    (mapInfo?.colMap || []).forEach((c) => {
      if (c?.ok && Number.isFinite(Number(c.id_pregunta))) s.add(Number(c.id_pregunta));
    });

    Object.values(manualMap || {}).forEach((v) => {
      const id = Number(v);
      if (Number.isFinite(id)) s.add(id);
    });

    return s;
  }, [mapInfo, manualMap]);

  function resetAll() {
    setFile(null);
    setErr("");
    setPreviewRows([]);
    setMapInfo(null);
    setExcelRows([]);
    setRowsToCreate([]);
    setBaseColMap([]);
    setManualMap({});
    setRunning(false);
    setResult(null);
    setDestinoKey("");
  }

  function applyManualOverrides(colMapBase, manualMapState) {
    return (colMapBase || []).map((c) => {
      const forced = manualMapState?.[c.col];

      if (forced === "__AUTO__") return c;
      if (forced === undefined) return c;

      if (forced === "") {
        return { ...c, ok: false, id_pregunta: null, etiqueta: null, via: "manual_ignore" };
      }

      const id = Number(forced);
      if (Number.isFinite(id) && preguntasById.has(id)) {
        const q = preguntasById.get(id);
        return {
          ...c,
          ok: true,
          id_pregunta: id,
          etiqueta: q?.etiqueta || q?.titulo || `#${id}`,
          via: "manual_select",
        };
      }

      return c;
    });
  }

  function buildCreateRows(rows, colMapResolved) {
    const out = [];
    const pid = Number(proyectoDestinoFinal);

    if (!Number.isFinite(pid) || pid <= 0) return out;

    const headers = Object.keys(rows?.[0] || {});
    const { latCol, lngCol } = findGpsColumns(headers);

    for (let index = 0; index < rows.length; index++) {
      const r = rows[index];
      const respuestas = {};

      // Mapeo normal
      for (const cm of colMapResolved) {
        const idPreg = cm?.id_pregunta;
        if (!idPreg) continue;

        // Evitar que lat/lng se guarden como preguntas separadas
        if (latCol && cm.col === latCol) continue;
        if (lngCol && cm.col === lngCol) continue;

        const v = r[cm.col];
        if (v === "" || v === null || v === undefined) continue;

        respuestas[String(idPreg)] = v;
      }

      // Mapeo especial para COORDENADAS GPS => [lat, lng]
      if (gpsPreguntaId && latCol && lngCol) {
        const lat = toNumberSafe(r[latCol]);
        const lng = toNumberSafe(r[lngCol]);

        if (lat !== null && lng !== null) {
          respuestas[String(gpsPreguntaId)] = [lat, lng];
        }
      }

      if (Object.keys(respuestas).length > 0) {
        out.push({
          rowIndex: index + 1,
          id_proyecto: pid,
          id_plantilla: Number(idPlantilla),
          id_link: Number(destinoSeleccionado?.id_link) || null,
          respuestas,
        });
      }
    }

    return out;
  }

  function recalcFrom(base, manual, rows) {
    const resolved = applyManualOverrides(base, manual);
    const createRows = buildCreateRows(rows, resolved);

    setRowsToCreate(createRows);
    setMapInfo((mi) =>
      mi
        ? {
            ...mi,
            colMap: resolved,
            totalCreates: createRows.length,
          }
        : {
            colMap: resolved,
            totalRows: rows.length,
            totalCreates: createRows.length,
          }
    );
  }

  useEffect(() => {
    if (!excelRows.length || !baseColMap.length) return;
    recalcFrom(baseColMap, manualMap, excelRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinoKey, proyectoDestinoFinal]);

  async function onPickFile(e) {
    setErr("");
    setResult(null);
    setMapInfo(null);
    setExcelRows([]);
    setRowsToCreate([]);
    setBaseColMap([]);
    setManualMap({});
    setPreviewRows([]);

    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    try {
      if (!proyectoDestinoFinal) {
        throw new Error("Seleccioná primero un proyecto destino.");
      }

      const buf = await f.arrayBuffer();
      const rows = pickFirstSheet(buf);

      const keys = Object.keys(rows[0] || {});
      if (!keys.length) throw new Error("No detecté encabezados en la primera fila.");

      const colMap = keys.map((col) => {
        // GPS latitud
        if (isGpsLatitudeColumn(col)) {
          return {
            col,
            ok: !!gpsPreguntaId,
            id_pregunta: gpsPreguntaId,
            etiqueta: gpsPreguntaId ? "COORDENADAS GPS (latitud)" : null,
            via: gpsPreguntaId ? "gps_latitude_to_json" : "gps_latitude_no_question",
            excelNorm: normKey(col),
            lookupNorm: normKey(col),
            candidates: [],
          };
        }

        // GPS longitud
        if (isGpsLongitudeColumn(col)) {
          return {
            col,
            ok: !!gpsPreguntaId,
            id_pregunta: gpsPreguntaId,
            etiqueta: gpsPreguntaId ? "COORDENADAS GPS (longitud)" : null,
            via: gpsPreguntaId ? "gps_longitude_to_json" : "gps_longitude_no_question",
            excelNorm: normKey(col),
            lookupNorm: normKey(col),
            candidates: [],
          };
        }

        const explicitId = parsePreguntaIdFromHeader(col);
        if (explicitId && preguntasById.has(explicitId)) {
          const q = preguntasById.get(explicitId);
          return {
            col,
            ok: true,
            id_pregunta: explicitId,
            etiqueta: q?.etiqueta || `#${explicitId}`,
            via: "header_id",
            excelNorm: normKey(col),
            lookupNorm: normKey(col),
            candidates: [],
          };
        }

        const variants = buildNormalizedVariants(col);

        let byLabel = null;
        let matchedVariant = null;

        for (const v of variants) {
          const found = preguntaIdByEtiqueta.get(v);
          if (found && preguntasById.has(found)) {
            byLabel = found;
            matchedVariant = v;
            break;
          }
        }

        if (byLabel && preguntasById.has(byLabel)) {
          const q = preguntasById.get(byLabel);
          const excelNorm = normKey(col);
          const aliasDirect = ALIAS[excelNorm] || excelNorm;

          return {
            col,
            ok: true,
            id_pregunta: byLabel,
            etiqueta: q?.etiqueta || q?.titulo || col,
            via:
              matchedVariant && matchedVariant !== excelNorm
                ? matchedVariant === aliasDirect
                  ? "alias_etiqueta"
                  : "normalizado_etiqueta"
                : "etiqueta",
            excelNorm,
            lookupNorm: matchedVariant || excelNorm,
            candidates: [],
          };
        }

        const candidates = getTopCandidates(col, preguntasLista, 8);

        return {
          col,
          ok: false,
          id_pregunta: null,
          etiqueta: null,
          via: candidates.length ? "no_match_suggested" : "no_match",
          excelNorm: normKey(col),
          lookupNorm: normKey(col),
          candidates,
        };
      });

      const createRows = buildCreateRows(rows, colMap);

      setExcelRows(rows);
      setBaseColMap(colMap);
      setPreviewRows(rows.slice(0, 8));
      setMapInfo({
        colMap,
        totalRows: rows.length,
        totalCreates: createRows.length,
      });
      setRowsToCreate(createRows);
    } catch (e2) {
      setErr(e2.message || "Error al leer el Excel.");
    }
  }

  function onManualSelect(col, value) {
    setErr("");
    setResult(null);

    setManualMap((prev) => {
      const next = { ...prev };
      if (value === "__AUTO__") delete next[col];
      else next[col] = value;

      recalcFrom(baseColMap, next, excelRows);
      return next;
    });
  }

  async function ejecutar() {
    if (!proyectoDestinoFinal) {
      setErr("Seleccioná un proyecto destino.");
      return;
    }

    if (!rowsToCreate.length) {
      setErr("No hay filas válidas para importar.");
      return;
    }

    setErr("");
    setRunning(true);
    setResult(null);

    let ok = 0;
    let fail = 0;
    const errors = [];

    for (const row of rowsToCreate) {
      try {
        console.log("ROW A ENVIAR:", row);

        await apiSend(API_URL, authHeaders, `/informes`, "POST", {
          id_proyecto: row.id_proyecto,
          id_plantilla: row.id_plantilla,
          id_link: row.id_link,
          respuestas: row.respuestas,
        });

        ok += 1;
      } catch (ex) {
        fail += 1;
        errors.push({
          fila_excel: row.rowIndex,
          id_proyecto: row.id_proyecto,
          id_plantilla: row.id_plantilla,
          id_link: row.id_link,
          error: ex?.message || "Error",
        });
      }
    }

    setRunning(false);
    setResult({ ok, fail, errors: errors.slice(0, 30) });
  }

  const anyNoMatch = !!mapInfo?.colMap?.some((x) => !x.ok);

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
        <Modal.Title>Importar respuestas (Excel)</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {!idPlantilla ? (
          <Alert variant="warning" className="mb-0">
            Seleccioná una plantilla primero.
          </Alert>
        ) : !preguntasLista?.length ? (
          <Alert variant="warning" className="mb-0">
            La plantilla seleccionada no tiene preguntas.
          </Alert>
        ) : (
          <>
            <Alert variant="info" className="mb-3">
              <div className="fw-semibold mb-1">Importación por filas</div>
              <div className="small">
                Se creará un <b>informe nuevo por cada fila del Excel</b>.
                <br />
                Todos los informes nuevos se crearán con la plantilla:
                <br />
                <b>Plantilla:</b> {nombrePlantilla || `#${idPlantilla}`}
                <br />
                <br />
                El Excel <b>no necesita</b> columna <code>id_informe</code>.
              </div>
            </Alert>

            {Number(idProyecto) > 0 ? (
              <Alert variant="secondary" className="mb-3">
                <div className="fw-semibold mb-1">Destino de creación</div>
                <div className="small">
                  <div><b>id_proyecto:</b> {idProyecto}</div>
                  <div><b>id_plantilla:</b> {idPlantilla}</div>
                  <div><b>plantilla:</b> {nombrePlantilla || "-"}</div>
                </div>
              </Alert>
            ) : (
              <div className="mb-3">
                <Form.Label className="fw-semibold">Proyecto / link destino</Form.Label>
                <Form.Select
                  value={destinoKey}
                  onChange={(e) => setDestinoKey(e.target.value)}
                >
                  <option value="">Seleccionar destino...</option>
                  {destinos.map((d) => (
                    <option key={d.key} value={d.key}>
                      {destinoLabel(d)}
                    </option>
                  ))}
                </Form.Select>

                <div className="small text-muted mt-1">
                  Elegí a qué proyecto/link se van a asociar los informes nuevos.
                </div>

                {destinoSeleccionado ? (
                  <Alert variant="secondary" className="mt-2 mb-0">
                    <div className="fw-semibold mb-1">Destino seleccionado</div>
                    <div className="small">
                      <div><b>id_link:</b> {destinoSeleccionado.id_link ?? "-"}</div>
                      <div><b>id_proyecto:</b> {destinoSeleccionado.id_proyecto ?? "-"}</div>
                      <div><b>id_plantilla:</b> {idPlantilla}</div>
                      <div><b>plantilla:</b> {nombrePlantilla || "-"}</div>
                      {destinoSeleccionado.titulo ? (
                        <div><b>título:</b> {destinoSeleccionado.titulo}</div>
                      ) : null}
                    </div>
                  </Alert>
                ) : null}
              </div>
            )}

            <Form.Group>
              <Form.Label>Archivo Excel</Form.Label>
              <Form.Control type="file" accept=".xlsx,.xls" onChange={onPickFile} />
            </Form.Group>

            {file ? (
              <div className="small text-muted mt-2">
                Archivo: <b>{file.name}</b>
              </div>
            ) : null}

            {err ? (
              <Alert className="mt-2" variant="danger">
                {err}
              </Alert>
            ) : null}

            {mapInfo ? (
              <div className="mt-3">
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <Badge bg="primary">Filas Excel: {mapInfo.totalRows}</Badge>
                  <Badge bg="success">Informes a crear: {mapInfo.totalCreates}</Badge>
                  <Badge bg="dark">Proyecto: {proyectoDestinoFinal || "-"}</Badge>
                  <Badge bg="secondary">Plantilla: {idPlantilla}</Badge>
                  {destinoSeleccionado?.id_link ? (
                    <Badge bg="info">Link: {destinoSeleccionado.id_link}</Badge>
                  ) : null}
                  {gpsPreguntaId ? (
                    <Badge bg="warning" text="dark">GPS pregunta: #{gpsPreguntaId}</Badge>
                  ) : (
                    <Badge bg="warning" text="dark">No detecté pregunta GPS</Badge>
                  )}
                </div>

                {anyNoMatch ? (
                  <Alert variant="warning" className="mt-2">
                    Hay columnas <b>No match</b>. Podés asignarlas manualmente con el selector.
                  </Alert>
                ) : null}

                <div className="mt-2">
                  <div className="fw-semibold mb-1">Mapeo de columnas</div>
                  <div className="table-responsive">
                    <Table bordered size="sm" className="mb-0">
                      <thead>
                        <tr>
                          <th>Columna Excel</th>
                          <th>Estado</th>
                          <th>id_pregunta</th>
                          <th>Etiqueta</th>
                          <th>Cómo mapeó</th>
                          <th style={{ minWidth: 340 }}>Asignación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapInfo.colMap.map((c) => {
                          const currentValue =
                            manualMap?.[c.col] !== undefined
                              ? manualMap?.[c.col]
                              : c?.ok && c?.id_pregunta
                                ? String(c.id_pregunta)
                                : "";

                          return (
                            <tr key={c.col}>
                              <td>{c.col}</td>
                              <td>
                                {c.ok ? (
                                  <Badge bg="success">OK</Badge>
                                ) : (
                                  <Badge bg="warning" text="dark">
                                    No match
                                  </Badge>
                                )}
                              </td>
                              <td>{c.id_pregunta ?? "-"}</td>
                              <td>{c.etiqueta ?? "-"}</td>
                              <td className="text-muted small">{c.via}</td>

                              <td>
                                <Form.Select
                                  size="sm"
                                  value={currentValue}
                                  onChange={(e) => onManualSelect(c.col, e.target.value)}
                                >
                                  <option value="__AUTO__">↩ Restaurar automático</option>
                                  <option value="">Ignorar esta columna</option>

                                  {(() => {
                                    const current = Number(currentValue);
                                    const cand = (c.candidates || []).filter((opt) => {
                                      const id = Number(opt.id_pregunta);
                                      if (!Number.isFinite(id)) return false;
                                      if (id === current) return true;
                                      return !usedPreguntaIds.has(id);
                                    });

                                    return cand.length ? (
                                      <>
                                        <option value="" disabled>─────────────</option>
                                        {cand.map((opt) => (
                                          <option key={opt.id_pregunta} value={String(opt.id_pregunta)}>
                                            #{opt.id_pregunta} — {opt.etiqueta} (≈{Math.round(opt.score * 100)}%)
                                          </option>
                                        ))}
                                      </>
                                    ) : null;
                                  })()}

                                  {(() => {
                                    const current = Number(currentValue);
                                    const all = (preguntasLista || [])
                                      .map((q) => ({
                                        id: Number(q.id_pregunta),
                                        label: q.etiqueta || q.titulo || `#${q.id_pregunta}`,
                                      }))
                                      .filter((x) => Number.isFinite(x.id))
                                      .filter((x) => x.id === current || !usedPreguntaIds.has(x.id))
                                      .slice(0, 400);

                                    return all.length ? (
                                      <>
                                        <option value="" disabled>─────────────</option>
                                        {all.map((q) => (
                                          <option key={q.id} value={String(q.id)}>
                                            #{q.id} — {q.label}
                                          </option>
                                        ))}
                                      </>
                                    ) : null;
                                  })()}
                                </Form.Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                </div>

                {previewRows?.length ? (
                  <div className="mt-3">
                    <div className="fw-semibold mb-1">Vista previa (primeras filas)</div>
                    <pre style={{ maxHeight: 200, overflow: "auto" }}>
                      {JSON.stringify(previewRows, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {result ? (
              <Alert className="mt-3" variant={result.fail ? "warning" : "success"}>
                <div className="fw-semibold">Resultado</div>
                <div>
                  Informes creados: {result.ok} — Fallos: {result.fail}
                </div>
                {result.errors?.length ? (
                  <pre className="mt-2 mb-0" style={{ maxHeight: 160, overflow: "auto" }}>
                    {JSON.stringify(result.errors, null, 2)}
                  </pre>
                ) : null}
              </Alert>
            ) : null}
          </>
        )}
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

        <Button
          variant="primary"
          onClick={ejecutar}
          disabled={running || !rowsToCreate.length || !idPlantilla || !proyectoDestinoFinal}
        >
          {running ? (
            <>
              <Spinner size="sm" className="me-2" /> Importando...
            </>
          ) : (
            "Crear informes desde Excel"
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}