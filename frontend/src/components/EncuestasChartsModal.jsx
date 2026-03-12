// src/components/EncuestasChartsModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Button,
  Container,
  Row,
  Col,
  Card,
  Spinner,
  Badge,
  Alert,
  Form,
  InputGroup,
} from "react-bootstrap";
import { Bar, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import "@/styles/MapChartsModal.theme.css";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, ChartDataLabels);

const PASTEL_COLORS = [
  "#A7D7C5",
  "#A9C5EB",
  "#F4D6A0",
  "#D9B7E8",
  "#F2B5B5",
  "#A7E3E1",
  "#B9B7F4",
  "#F7C7A6",
  "#D6C2B8",
  "#BFE6B8",
  "#BFE0F7",
  "#E6C7F2",
  "#E9E8A8",
  "#F4B7D1",
  "#C7D1D8",
];

const ALPHA_FILL = 0.72;
const ALPHA_BORDER = 0.95;

const hexToRgba = (hex, a = 1) => {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
};

const pickColors = (n) => Array.from({ length: n }, (_, i) => PASTEL_COLORS[i % PASTEL_COLORS.length]);

const norm = (v) => String(v ?? "").trim();

const isMissing = (v) => {
  const s = norm(v);
  return !s || s === "-" || s === "null" || s === "undefined";
};

const classifyValor = (raw) => {
  const v = norm(raw);
  if (isMissing(v)) return { kind: "missing", value: null };

  const lo = v.toLowerCase();
  if (lo === "si" || lo === "sí") return { kind: "boolean", value: "Sí" };
  if (lo === "no") return { kind: "boolean", value: "No" };

  const n = Number(v.replace(",", "."));
  if (Number.isFinite(n)) return { kind: "numeric", value: n };

  if (v.includes(",")) {
    const parts = v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return { kind: "multi", value: parts.length ? parts : [] };
  }

  return { kind: "categorical", value: v };
};

// ✅✅✅ Normalizador ROBUSTO (FIX)
const normalizePlantilla = (p) => {
  if (!p) return null;

  // 1) wrapper clásico
  if (p.ok && (Array.isArray(p.secciones) || Array.isArray(p.seccionesConPreguntas))) {
    return {
      ...(p.plantilla || {}),
      secciones: Array.isArray(p.secciones) ? p.secciones : p.seccionesConPreguntas,
    };
  }

  // 2) viene directo con secciones
  if (Array.isArray(p.secciones)) return p;

  // 3) viene directo con seccionesConPreguntas
  if (Array.isArray(p.seccionesConPreguntas)) {
    return { ...(p.plantilla || p), secciones: p.seccionesConPreguntas };
  }

  // 4) viene como { plantilla: {.., secciones:[..]} }
  if (p.plantilla && Array.isArray(p.plantilla.secciones)) return p.plantilla;

  // 5) viene como { plantilla: {..}, secciones:[..] } sin ok
  if (p.plantilla && Array.isArray(p.secciones)) return { ...p.plantilla, secciones: p.secciones };

  return null;
};

const isCoordLike = (meta) => {
  const etiqueta = norm(meta?.etiqueta).toLowerCase();
  const tipo = norm(meta?.tipo).toLowerCase();
  if (tipo.includes("ubic") || tipo.includes("gps") || tipo.includes("map")) return true;

  const needles = ["coorden", "coord", "lat", "lng", "longitud", "latitude", "ubicacion", "ubicación", "mapa", "gps"];
  return needles.some((k) => etiqueta.includes(k));
};

const isTextLike = (tipo) => {
  const t = norm(tipo).toLowerCase();
  // Ajustá si tenés nombres exactos (ej: "texto", "text", "textarea", "observacion", etc.)
  return t.includes("texto") || t.includes("text") || t.includes("textarea") || t.includes("observ");
};

function buildMetaFromPlantilla(plantillaRaw) {
  const plantilla = normalizePlantilla(plantillaRaw);

  const byId = new Map();
  const secOrder = new Map();

  if (!plantilla?.secciones?.length) return { byId, secOrder };

  for (const sec of plantilla.secciones) {
    const secTitulo = norm(sec.titulo || "Sin sección");
    const secOrden = Number(sec.orden ?? 0);
    if (!secOrder.has(secTitulo)) secOrder.set(secTitulo, secOrden);

    const preguntas = Array.isArray(sec.preguntas) ? sec.preguntas : [];
    for (const p of preguntas) {
      const id = Number(p.id_pregunta);
      if (!Number.isFinite(id)) continue;

      byId.set(id, {
        id_pregunta: id,
        etiqueta: norm(p.etiqueta),
        seccion: secTitulo,
        seccion_orden: secOrden,
        orden: Number(p.orden ?? 0),
        tipo: norm(p.tipo),
      });
    }
  }

  return { byId, secOrder };
}

function aggregateRows(informesRows, metaById) {
  const out = new Map();

  const ensure = (id) => {
    if (!out.has(id)) {
      const meta = metaById.get(id) || {};
      out.set(id, {
        id_pregunta: id,
        etiqueta: meta.etiqueta || `Pregunta ${id}`,
        seccion: meta.seccion || "Sin sección",
        seccion_orden: Number(meta.seccion_orden ?? 0),
        orden: Number(meta.orden ?? 0),
        tipo: meta.tipo || "",
        counts: new Map(),
        nums: [],
        texts: [], // ✅ NUEVO: respuestas texto crudas (para resumen)
      });
    }
    return out.get(id);
  };

  for (const inf of informesRows) {
    const rows = Array.isArray(inf?.rows) ? inf.rows : [];
    for (const r of rows) {
      const id = Number(r.id_pregunta);
      if (!Number.isFinite(id)) continue;

      const meta = metaById.get(id);
      if (!meta) continue;
      if (isCoordLike(meta)) continue;

      const a = ensure(id);
      const c = classifyValor(r.valor);

      if (c.kind === "missing") continue;

      // ✅ si la pregunta es texto, guardamos textos (y opcionalmente conteos)
      if (isTextLike(a.tipo)) {
        const s = norm(r.valor);
        if (!isMissing(s)) a.texts.push(s);
        continue;
      }

      if (c.kind === "numeric") {
        a.nums.push(c.value);
      } else if (c.kind === "multi") {
        for (const it of c.value) a.counts.set(it, (a.counts.get(it) || 0) + 1);
      } else {
        a.counts.set(c.value, (a.counts.get(c.value) || 0) + 1);
      }
    }
  }

  return Array.from(out.values());
}

function sortAgg(a, b) {
  const sa = Number(a.seccion_orden ?? 0);
  const sb = Number(b.seccion_orden ?? 0);
  if (sa !== sb) return sa - sb;

  const pa = Number(a.orden ?? 0);
  const pb = Number(b.orden ?? 0);
  if (pa !== pb) return pa - pb;

  return norm(a.etiqueta).localeCompare(norm(b.etiqueta), "es");
}

export default function EncuestasChartsModal({
  show,
  onHide,
  titulo = "Centro de Control — Gráficos",
  informeIds = [],
  fetchInformeDetalle,
  plantilla,
  plantillaId,
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [agg, setAgg] = useState([]);
  const [seleccion, setSeleccion] = useState([]);

  const [filtroTexto, setFiltroTexto] = useState("");
  const [soloSeleccionadas, setSoloSeleccionadas] = useState(false);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [secOpen, setSecOpen] = useState({});

  // ✅ NUEVO: filtros por tipo
  const [showTipoTexto, setShowTipoTexto] = useState(true);
  const [showTipoNum, setShowTipoNum] = useState(true);
  const [showTipoOpc, setShowTipoOpc] = useState(true);

  const plantillaNorm = useMemo(() => normalizePlantilla(plantilla), [plantilla]);
  const metaPack = useMemo(() => buildMetaFromPlantilla(plantilla), [plantilla]);
  const metaById = metaPack.byId;

  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!show) return;
      setErr(null);
      setLoading(true);

      try {
        if (!plantillaNorm?.secciones?.length) {
          setAgg([]);
          setSeleccion([]);
          setLoading(false);
          return;
        }

        const ids = (informeIds || []).filter(Boolean).slice(0, 10);
        if (!ids.length) {
          setAgg([]);
          setSeleccion([]);
          setLoading(false);
          return;
        }

        const concurrency = 4;
        const results = [];
        let idx = 0;

        const worker = async () => {
          while (idx < ids.length) {
            const my = ids[idx++];
            const data = await fetchInformeDetalle(my);
            results.push({ id_informe: my, rows: data?.rows || [] });
          }
        };

        await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
        if (cancel) return;

        const aggregated = aggregateRows(results, metaById).sort(sortAgg);

        setAgg(aggregated);

        // ✅ por defecto seleccionamos las que tengan “algo mostrable”
        const idsPreg = aggregated
          .filter((p) => {
            const isTxt = isTextLike(p.tipo);
            if (isTxt) return (p.texts?.length || 0) > 0;
            return (p.counts?.size || 0) > 0 || (p.nums?.length || 0) > 0;
          })
          .map((p) => p.id_pregunta);

        setSeleccion(idsPreg);

        // ✅ SECCIONES ARRANCAN ABIERTAS
        const sec = {};
        for (const p of aggregated) {
          const s = norm(p.seccion || "Sin sección");
          if (!(s in sec)) sec[s] = true; // <-- antes false
        }
        setSecOpen(sec);
      } catch (e) {
        if (!cancel) setErr(e?.message || "No se pudieron cargar los gráficos.");
      } finally {
        if (!cancel) setLoading(false);
      }
    };

    run();
    return () => {
      cancel = true;
    };
  }, [show, informeIds, fetchInformeDetalle, metaById, plantillaNorm]);

  const barOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "end",
          formatter: (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v) || "",
        },
      },
      scales: {
        y: { beginAtZero: true, grace: "12%" },
        x: { ticks: { maxRotation: 30, minRotation: 0 } },
      },
    }),
    []
  );

  const pieOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        datalabels: {
          formatter: (value, ctx) => {
            const dataArr = ctx?.chart?.data?.datasets?.[0]?.data || [];
            const total = dataArr.reduce((a, b) => a + (Number(b) || 0), 0);
            if (!total) return "";
            const pct = Math.round(((Number(value) || 0) / total) * 100);
            return pct ? `${pct}%` : "";
          },
        },
      },
    }),
    []
  );

  const toggleSeleccion = (id) => {
    setSeleccion((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const seleccionTodo = () => {
    const all = listaPreguntasBase.map((p) => p.id_pregunta);
    setSeleccion(all);
  };

  const limpiarSeleccion = () => setSeleccion([]);

  const listaPreguntasBase = useMemo(() => {
    // Solo “mostrables”: num/opc con data o texto con textos
    return agg
      .filter((p) => {
        const isTxt = isTextLike(p.tipo);
        if (isTxt) return (p.texts?.length || 0) > 0;
        return (p.counts?.size || 0) > 0 || (p.nums?.length || 0) > 0;
      })
      .slice()
      .sort(sortAgg)
      .map((p) => {
        const isTxt = isTextLike(p.tipo);
        const isNum = (p.nums?.length || 0) > 0;
        const badge = isTxt
          ? `txt: ${p.texts?.length || 0}`
          : isNum
          ? `num: ${p.nums.length}`
          : `opc: ${p.counts.size}`;
        return { ...p, _isTxt: isTxt, _isNum: isNum, badge };
      });
  }, [agg]);

  const listaPreguntas = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase();

    let out = listaPreguntasBase;

    // filtro texto por etiqueta
    if (q) out = out.filter((p) => (p.etiqueta || "").toLowerCase().includes(q));

    // filtros por tipo
    out = out.filter((p) => {
      if (p._isTxt) return showTipoTexto;
      if (p._isNum) return showTipoNum;
      return showTipoOpc;
    });

    if (soloSeleccionadas) out = out.filter((p) => seleccion.includes(p.id_pregunta));

    return out;
  }, [listaPreguntasBase, filtroTexto, soloSeleccionadas, seleccion, showTipoTexto, showTipoNum, showTipoOpc]);

  const chartsBySection = useMemo(() => {
    const map = new Map();

    for (const p of agg.slice().sort(sortAgg)) {
      if (!seleccion.includes(p.id_pregunta)) continue;

      const isTxt = isTextLike(p.tipo);
      const hasTxt = (p.texts?.length || 0) > 0;

      const hasNums = (p.nums?.length || 0) > 0;
      const hasCounts = (p.counts?.size || 0) > 0;

      // aplicar filtros por tipo también acá (para no renderizar lo oculto)
      if (isTxt && !showTipoTexto) continue;
      if (!isTxt && hasNums && !showTipoNum) continue;
      if (!isTxt && !hasNums && hasCounts && !showTipoOpc) continue;

      if (isTxt) {
        if (!hasTxt) continue;
      } else {
        if (!hasNums && !hasCounts) continue;
      }

      const sec = norm(p.seccion || "Sin sección");
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(p);
    }

    const buildTextCard = (p) => {
      const subtitle = `Orden ${p.orden} • ${p.tipo ? `Tipo: ${p.tipo}` : ""}`.trim();

      // Top respuestas por frecuencia (normalizamos espacios)
      const freq = new Map();
      for (const t of (p.texts || []).map((x) => norm(x)).filter((x) => !isMissing(x))) {
        freq.set(t, (freq.get(t) || 0) + 1);
      }

      const top = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const total = (p.texts || []).length;
      const unique = freq.size;

      return {
        id_pregunta: p.id_pregunta,
        etiqueta: p.etiqueta,
        subtitle,
        type: "text",
        total,
        unique,
        top,
      };
    };

    const buildChart = (p) => {
      const colors = pickColors(12);
      const subtitle = `Orden ${p.orden} • ${p.tipo ? `Tipo: ${p.tipo}` : ""}`.trim();

      // ✅ TEXTO: no se grafica, se resume
      if (isTextLike(p.tipo)) return buildTextCard(p);

      // NUMÉRICO -> barras (histograma simple)
      if ((p.nums?.length || 0) > 0) {
        const nums = p.nums.slice().filter((n) => Number.isFinite(n));
        if (!nums.length) return null;

        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const bins = 6;
        const step = max === min ? 1 : (max - min) / bins;

        const labels = [];
        const data = new Array(bins).fill(0);

        for (let i = 0; i < bins; i++) {
          const a = min + step * i;
          const b = i === bins - 1 ? max : min + step * (i + 1);
          labels.push(`${Math.round(a * 100) / 100}–${Math.round(b * 100) / 100}`);
        }

        for (const n of nums) {
          let idx = step === 0 ? 0 : Math.floor((n - min) / step);
          if (idx < 0) idx = 0;
          if (idx >= bins) idx = bins - 1;
          data[idx] += 1;
        }

        return {
          id_pregunta: p.id_pregunta,
          etiqueta: p.etiqueta,
          subtitle,
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "Cantidad",
                data,
                backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
                borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
                borderWidth: 1,
              },
            ],
          },
        };
      }

      // OPCIONES -> pie (Top 10)
      const entries = Array.from(p.counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (!entries.length) return null;

      const labels = entries.map(([k]) => k);
      const values = entries.map(([, v]) => v);

      return {
        id_pregunta: p.id_pregunta,
        etiqueta: p.etiqueta,
        subtitle,
        type: "pie",
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_FILL)),
              borderColor: labels.map((_, i) => hexToRgba(colors[i], ALPHA_BORDER)),
              borderWidth: 1,
            },
          ],
        },
      };
    };

    const sections = [];
    for (const [sec, itemsAgg] of map.entries()) {
      const items = itemsAgg
        .slice()
        .sort(sortAgg)
        .map(buildChart)
        .filter(Boolean);

      if (items.length) sections.push({ sec, items });
    }

    // mantenemos un orden estable por el orden de sección real (si querés estrictamente por seccion_orden,
    // podés reemplazar este sort por secOrder; pero así ya queda prolijo).
    sections.sort((a, b) => norm(a.sec).localeCompare(norm(b.sec), "es"));
    return sections;
  }, [agg, seleccion, showTipoTexto, showTipoNum, showTipoOpc]);

  return (
    <Modal show={show} onHide={onHide} fullscreen scrollable backdrop="static" keyboard>
      <Modal.Header className="geo-header">
        <Modal.Title className="mb-0 geo-title">
          {titulo}{" "}
          <Badge bg="secondary"> {(informeIds || []).filter(Boolean).slice(0, 10).length} informes</Badge>
          
        </Modal.Title>

        <Button
          size="sm"
          onClick={() => setSelectorOpen((v) => !v)}
          className="ms-2"
          style={{
            borderRadius: 10,
            fontWeight: 600,
            paddingInline: 14,
            background: selectorOpen ? "#2F3A3D" : "transparent",
            color: selectorOpen ? "#fff" : "#2F3A3D",
            border: "2px solid #2F3A3D",
          }}
          title="Mostrar/ocultar filtros"
        >
          {selectorOpen ? "Ocultar filtros" : "Filtros"}
        </Button>

        <Button size="sm" onClick={onHide} className="geo-btn-close ms-auto">
          Cerrar
        </Button>
      </Modal.Header>

      <Modal.Body style={{ background: "#F3F6EA" }}>
        {loading ? (
          <div className="d-flex align-items-center justify-content-center py-5">
            <Spinner animation="border" role="status" className="me-2" />
            Cargando datos y generando gráficos…
          </div>
        ) : err ? (
          <Alert variant="danger">{err}</Alert>
        ) : !plantillaNorm?.secciones?.length ? (
          <Alert variant="warning">
            No se recibió la <b>plantilla</b>. Para agrupar por título/orden de sección hay que pasar la plantilla al
            modal.
          </Alert>
        ) : (
          <Container fluid className="p-0">
            {/* ✅ PANEL FILTROS (colapsable) */}
            {selectorOpen && (
              <Card className="geo-card mb-3">
                <Card.Body className="geo-card__body">
                  <Row className="g-2 align-items-end">
                    <Col xs={12} md={4}>
                      <Form.Label className="mb-1">Buscar por etiqueta</Form.Label>
                      <InputGroup>
                        <Form.Control
                          value={filtroTexto}
                          onChange={(e) => setFiltroTexto(e.target.value)}
                          placeholder="Buscar..."
                        />
                        <Button variant="outline-secondary" onClick={() => setFiltroTexto("")}>
                          Limpiar
                        </Button>
                      </InputGroup>
                    </Col>

                    <Col xs={12} md={3}>
                      <Form.Check
                        type="switch"
                        id="soloSeleccionadas"
                        label="Mostrar solo seleccionadas"
                        checked={soloSeleccionadas}
                        onChange={(e) => setSoloSeleccionadas(e.target.checked)}
                      />
                      <div className="d-flex gap-2 mt-2">
                        <Button size="sm" variant="outline-primary" onClick={seleccionTodo}>
                          Seleccionar todo
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={limpiarSeleccion}>
                          Limpiar selección
                        </Button>
                      </div>
                    </Col>

                    <Col xs={12} md={5}>
                      <div className="d-flex flex-wrap gap-3">
                        <Form.Check
                          type="switch"
                          id="showTipoTexto"
                          label="Texto"
                          checked={showTipoTexto}
                          onChange={(e) => setShowTipoTexto(e.target.checked)}
                        />
                        <Form.Check
                          type="switch"
                          id="showTipoNum"
                          label="Numéricas"
                          checked={showTipoNum}
                          onChange={(e) => setShowTipoNum(e.target.checked)}
                        />
                        <Form.Check
                          type="switch"
                          id="showTipoOpc"
                          label="Opciones"
                          checked={showTipoOpc}
                          onChange={(e) => setShowTipoOpc(e.target.checked)}
                        />
                      </div>
                    </Col>
                  </Row>

                  <hr />

                  {/* checklist por sección/orden */}
                  <div style={{ maxHeight: 260, overflow: "auto" }}>
                    {listaPreguntas.length ? (
                      listaPreguntas.map((p) => {
                        const checked = seleccion.includes(p.id_pregunta);
                        return (
                          <div
                            key={p.id_pregunta}
                            className="d-flex align-items-center justify-content-between py-1"
                            style={{ borderBottom: "1px dashed rgba(0,0,0,.08)" }}
                          >
                            <Form.Check
                              type="checkbox"
                              id={`chk-${p.id_pregunta}`}
                              checked={checked}
                              onChange={() => toggleSeleccion(p.id_pregunta)}
                              label={
                                <span>
                                  <b style={{ marginRight: 8 }}>{p.seccion}</b>
                                  <span style={{ color: "#2D3B2F" }}>{p.etiqueta}</span>{" "}
                                  <span style={{ color: "#6B746A", fontSize: 12 }}>
                                    (ord {p.orden} • {p.badge})
                                  </span>
                                </span>
                              }
                            />
                            <Badge bg={p._isTxt ? "secondary" : p._isNum ? "primary" : "success"}>{p.badge}</Badge>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-muted">No hay resultados con ese filtro.</div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            )}

            {/* ✅ GRÁFICOS POR SECCIÓN */}
            <Row className="g-3 mb-3">
              {chartsBySection.length ? (
                chartsBySection.map(({ sec, items }) => {
                  const open = !!secOpen[sec];

                  return (
                    <Col key={sec} xs={12}>
                      <Card className="geo-card">
                        <Card.Body className="geo-card__body">
                          <div
                            role="button"
                            onClick={() => setSecOpen((p) => ({ ...p, [sec]: !p[sec] }))}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              cursor: "pointer",
                              userSelect: "none",
                              gap: 10,
                            }}
                          >
                            <div>
                              <h5 className="geo-card__title mb-0">{sec}</h5>
                              <div style={{ color: "#6B746A", fontSize: 12, marginTop: 4 }}>
                                {open ? "Minimizar sección" : "Expandir sección"} • {items.length} item(s)
                              </div>
                            </div>

                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                background: "rgba(255,255,255,.75)",
                                border: "1px solid rgba(0,0,0,.08)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform .15s ease",
                                fontSize: 18,
                              }}
                              title={open ? "Minimizar" : "Expandir"}
                            >
                              ▾
                            </div>
                          </div>

                          {open && (
                            <div className="mt-3">
                              <Row className="g-3">
                                {items.map((c) => (
                                  <Col key={c.id_pregunta} xs={12} md={6}>
                                    <Card className="geo-card" style={{ height: 430 }}>
                                      <Card.Body className="geo-card__body">
                                        <h6 className="geo-card__title">{c.etiqueta}</h6>

                                        {c.subtitle ? (
                                          <div style={{ color: "#6B746A", fontSize: 12, marginBottom: 6 }}>
                                            {c.subtitle}
                                          </div>
                                        ) : null}

                                        {/* ✅ TEXTO: resumen en vez de gráfico */}
                                        {c.type === "text" ? (
                                          <div
                                            style={{
                                              height: 340,
                                              overflow: "auto",
                                              background: "rgba(255,255,255,.6)",
                                              border: "1px solid rgba(0,0,0,.06)",
                                              borderRadius: 12,
                                              padding: 12,
                                            }}
                                          >
                                            <div className="d-flex gap-2 mb-2">
                                              <Badge bg="secondary">Respuestas: {c.total}</Badge>
                                              <Badge bg="dark">Únicas: {c.unique}</Badge>
                                            </div>

                                            {c.top?.length ? (
                                              <>
                                                <div style={{ fontWeight: 700, marginBottom: 6 }}>Respuestas</div>
                                                {c.top.map(([txt, n], i) => (
                                                  <div
                                                    key={`${txt}-${i}`}
                                                    className="d-flex justify-content-between"
                                                    style={{
                                                      padding: "6px 8px",
                                                      borderBottom: "1px dashed rgba(0,0,0,.08)",
                                                      gap: 12,
                                                    }}
                                                  >
                                                    <div style={{ color: "#2D3B2F" }}>{txt}</div>
                                                    <Badge bg="secondary">{n}</Badge>
                                                  </div>
                                                ))}
                                                <div className="text-muted mt-2" style={{ fontSize: 12 }}>
                                                  (Para texto libre, se muestra resumen en vez de gráfico.)
                                                </div>
                                              </>
                                            ) : (
                                              <div className="text-muted">Sin respuestas para resumir.</div>
                                            )}
                                          </div>
                                        ) : (
                                          <div style={{ height: 340 }}>
                                            {c.type === "bar" ? (
                                              <Bar data={c.data} options={barOptions} />
                                            ) : (
                                              <Pie data={c.data} options={pieOptions} />
                                            )}
                                          </div>
                                        )}
                                      </Card.Body>
                                    </Card>
                                  </Col>
                                ))}
                              </Row>
                            </div>
                          )}
                        </Card.Body>
                      </Card>
                    </Col>
                  );
                })
              ) : (
                <Col xs={12}>
                  <div className="text-muted">No hay items seleccionados (o no hay datos suficientes).</div>
                </Col>
              )}
            </Row>
          </Container>
        )}
      </Modal.Body>
    </Modal>
  );
}
