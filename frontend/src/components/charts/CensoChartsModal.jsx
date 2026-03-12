// src/components MapChartsModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, Container, Row, Col, Card, Spinner } from "react-bootstrap";
import { Bar } from "react-chartjs-2";
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

const GEO = {
  primary: "#9EBE3E",
  primary700: "#2E5E3A",
  accent: "#D1AD32",
  bg: "#F3F6EA",
  card: "#FFFFFF",
  ink: "#1F2A1E",
  inkMuted: "#6B746A",
  grid: "rgba(0,0,0,.06)",
};

// Etiquetas para datos faltantes (solo UI)
const MISSING_LABEL = "No reportado";
const MISSING_BADGE = "NO REPORTADO";

const barFills = ["#8FB23E", "#2E5E3A", "#C0CF97", "#D1AD32", "#A7D7B3", "#B7B9AE"].map((c) => c + "E6");
const barBorders = ["#7AA02F", "#224A2E", "#9CAF7A", "#B8921F", "#7BB28F", "#8E9187"];
const pickColor  = (i) => barFills[i % barFills.length];
const pickBorder = (i) => barBorders[i % barBorders.length];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Normaliza -> "ALL" | "NORMAL" | "ESPECIAL" | "SINDATO"
const normClase = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

// ---------- helpers de dataset (con SUMA por proyecto+categoría) ----------
function buildBarByProyectoBase({
  rows,
  getProyectoName,
  categoryKey = "categoria",
  valueKey = "cantidad",
  filterByProyecto,
}) {
  const src = filterByProyecto(rows);
  if (!Array.isArray(src) || src.length === 0) return { labels: [], datasets: [] };

  // nombres de proyectos
  const proyectos = Array.from(new Set(src.map((it) => getProyectoName(it))));

  // categorías normalizadas (y “No reportado” si viene vacío)
  const categorias = Array.from(
    new Set(
      src.map((it) => {
        const raw = it[categoryKey];
        return raw == null || String(raw).trim() === "" ? MISSING_LABEL : String(raw);
      })
    )
  );

  // PRE-AGREGACIÓN: suma por (proyecto|categoría)
  const agg = new Map(); // key `${proyecto}||${cat}` -> total
  for (const it of src) {
    const p = getProyectoName(it);
    const c = it[categoryKey] == null || String(it[categoryKey]).trim() === "" ? MISSING_LABEL : String(it[categoryKey]);
    const key = `${p}||${c}`;
    const val = Number(it[valueKey] ?? it.cantidad ?? it.total ?? 0) || 0;
    agg.set(key, (agg.get(key) || 0) + val);
  }

  const datasets = categorias.map((cat, i) => ({
    label: cat,
    data: proyectos.map((p) => agg.get(`${p}||${cat}`) || 0),
    backgroundColor: pickColor(i),
    borderColor: pickBorder(i),
    borderWidth: 1.5,
    borderRadius: 8,
    barPercentage: 0.8,
    categoryPercentage: 0.7,
  }));

  return { labels: proyectos, datasets };
}

export default function MapChartsModal({ show, onHide, idProyecto }) {
  const [loading, setLoading] = useState(false);

  // filtros internos
  const [filtroTramo, setFiltroTramo] = useState("ALL");
  const [filtroClase, setFiltroClase] = useState("ALL"); // ALL | NORMAL | ESPECIAL | SINDATO

  // datasets
  const [tramosEncuestas, setTramosEncuestas] = useState([]);
  const [grafProyecto, setGrafProyecto] = useState([]);
  const [grafTramoAll, setGrafTramoAll] = useState([]);
  const [grafAfectacion, setGrafAfectacion] = useState([]);
  const [grafCaract, setGrafCaract] = useState([]);
  const [grafCond, setGrafCond] = useState([]);
  const [grafInteres, setGrafInteres] = useState([]);
  const [grafPercepcion, setGrafPercepcion] = useState([]);
  const [grafDocumento, setGrafDocumento] = useState([]);
  const [grafCiudad, setGrafCiudad] = useState([]);
  const [grafArraigo, setGrafArraigo] = useState([]);
  const [grafOcupacion, setGrafOcupacion] = useState([]);
  const [grafMedioSubs, setGrafMedioSubs] = useState([]);
  const [grafServicios, setGrafServicios] = useState([]);
  const [grafDiscapSalud, setGrafDiscapSalud] = useState([]);
  const [grafInstalacionesUso, setGrafInstalacionesUso] = useState([]);
  const [grafIngreso, setGrafIngreso] = useState([]);
  const [grafOrganizacion, setGrafOrganizacion] = useState([]);

  // control de concurrencia
  const abortRef = useRef(null);
  const requestKeyRef = useRef(0);

  // id proyecto efectivo
  const qsIdProyecto = (() => {
    try {
      const v = new URLSearchParams(window.location.search).get("id_proyecto");
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  })();
  const pathIdProyecto = (() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const maybe = Number(parts[parts.length - 1]);
    return Number.isFinite(maybe) ? maybe : null;
  })();
  const effectiveIdProyecto = idProyecto ?? qsIdProyecto ?? pathIdProyecto;

  // key para forzar remount de <Bar/>
  const chartKey = `${String(filtroClase)}|${String(filtroTramo)}|${String(effectiveIdProyecto ?? "")}`;

  useEffect(() => {
    if (!show || !effectiveIdProyecto) return;
    const token = localStorage.getItem("token");
    if (!token) return;

    // Cancela todo lo pendiente del filtro anterior
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // request key para ignorar respuestas viejas
    const myKey = ++requestKeyRef.current;

    setLoading(true);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const tramoActivo = filtroTramo !== "ALL" && filtroTramo != null ? Number(filtroTramo) : null;

    // Mapea a lo que espera el backend: "NORMAL" | "ESPECIAL" | "SIN DATO" | null
    const CLASE = normClase(filtroClase); // "ALL" | "NORMAL" | "ESPECIAL" | "SINDATO"
    const claseFilter =
      CLASE === "NORMAL"  ? "NORMAL"  :
      CLASE === "ESPECIAL"? "ESPECIAL":
      CLASE === "SINDATO" ? "SIN DATO" :
      null;

    const addQ = (path) => {
      const q = new URLSearchParams();
      q.set("id_proyecto", String(effectiveIdProyecto));
      if (tramoActivo) q.set("id_tramo", String(tramoActivo));
      if (claseFilter) q.set("tipo_clase", claseFilter);
      q.set("_", String(Date.now()));
      const url = `${path}?${q.toString()}`;
      console.debug("[Charts] GET", url);
      return url;
    };
    const addQOnlyProyecto = (path) => {
      const q = new URLSearchParams();
      q.set("id_proyecto", String(effectiveIdProyecto));
      if (claseFilter) q.set("tipo_clase", claseFilter);
      q.set("_", String(Date.now()));
      const url = `${path}?${q.toString()}`;
      console.debug("[Charts] GET", url);
      return url;
    };
    const safeJson = async (url) => {
      try {
        const r = await fetch(url, { headers, cache: "no-store", signal: ac.signal });
        if (!r.ok) throw new Error(r.statusText);
        const data = await r.json();
        return Array.isArray(data) ? data : data ?? [];
      } catch (e) {
        if (e.name === "AbortError") return null;
        console.warn("↪️ vacío por error en", url, e?.message || e);
        return [];
      }
    };

    (async () => {
      try {
        const [
          t,
          p,
          t2All,
          a,
          c,
          co,
          i,
          pe,
          doc,
          ciu,
          arr,
          ocu,
          med,
          serv,
          disc,
          inst,
          ing,
          org,
        ] = await Promise.all([
          safeJson(addQ(`${API_URL}/dashboard/tramos-por-proyecto`)),
          safeJson(addQ(`${API_URL}/dashboard/encuestas-por-proyecto`)),
          safeJson(addQOnlyProyecto(`${API_URL}/dashboard/encuestas-por-tramo`)),
          safeJson(addQ(`${API_URL}/dashboard/afectacion-por-tramo`)),
          safeJson(addQ(`${API_URL}/dashboard/caracteristicas-predio`)),
          safeJson(addQ(`${API_URL}/dashboard/condicion-ocupacion`)),
          safeJson(addQ(`${API_URL}/dashboard/interes-reubicacion`)),
          safeJson(addQ(`${API_URL}/dashboard/percepcion`)),
          safeJson(addQ(`${API_URL}/dashboard/posee-documento`)),
          safeJson(addQ(`${API_URL}/dashboard/ciudad`)),
          safeJson(addQ(`${API_URL}/dashboard/tiempo-arraigo`)),
          safeJson(addQ(`${API_URL}/dashboard/ocupacion-rubro`)),
          safeJson(addQ(`${API_URL}/dashboard/medio-subsistencia`)),
          safeJson(addQ(`${API_URL}/dashboard/predio-servicios`)),
          safeJson(addQ(`${API_URL}/dashboard/discapacidad-salud`)),
          safeJson(addQ(`${API_URL}/dashboard/instalaciones-uso`)),
          safeJson(addQ(`${API_URL}/dashboard/ingreso-mensual-categoria`)),
          safeJson(addQ(`${API_URL}/dashboard/pertenencia-organizacion`)),
        ]);

        if (requestKeyRef.current !== myKey) return;

        const s = (v) => (Array.isArray(v) ? v : []);
        const t2 = s(t2All).slice().sort((a, b) => Number(a.id_tramo) - Number(b.id_tramo));

        setTramosEncuestas(s(t));
        setGrafProyecto(s(p));
        setGrafTramoAll(t2);
        setGrafAfectacion(s(a));
        setGrafCaract(s(c));
        setGrafCond(s(co));
        setGrafInteres(s(i));
        setGrafPercepcion(s(pe));
        setGrafDocumento(s(doc));
        setGrafCiudad(s(ciu));
        setGrafArraigo(s(arr));
        setGrafOcupacion(s(ocu));
        setGrafMedioSubs(s(med));
        setGrafServicios(s(serv));
        setGrafDiscapSalud(s(disc));
        setGrafInstalacionesUso(s(inst));
        setGrafIngreso(s(ing));
        setGrafOrganizacion(s(org));
      } finally {
        if (requestKeyRef.current === myKey) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [show, filtroTramo, filtroClase, effectiveIdProyecto]);

  const getProyectoName = (it) =>
    it.proyecto || it.nombre_proyecto || (it.id_proyecto ? `Proyecto ${it.id_proyecto}` : "Proyecto");

  const filterByProyecto = (arr) =>
    effectiveIdProyecto ? arr.filter((it) => Number(it.id_proyecto) === Number(effectiveIdProyecto)) : arr;

  // Wrapper para usar el agregador base
  function buildBarByProyecto(arr, { categoryKey = "categoria", valueKey = "cantidad" } = {}) {
    return buildBarByProyectoBase({
      rows: arr,
      getProyectoName,
      categoryKey,
      valueKey,
      filterByProyecto,
    });
  }

  const normalizeArraigo = (arr) => {
    const src = filterByProyecto(arr);
    if (!Array.isArray(src)) return [];
    const bucket = (n) => {
      const x = Number(n);
      if (!isFinite(x)) return MISSING_LABEL;
      if (x <= 10) return "0 a 10 años";
      if (x <= 20) return "11 a 20 años";
      if (x <= 30) return "21 a 30 años";
      return "Más de 30 años";
    };
    return src.map((it) => {
      const rango = it.rango || bucket(it.anhos);
      return { ...it, categoria: rango, cantidad: it.cantidad ?? it.total ?? 0 };
    });
  };

  // datasets para gráficos
  const chartDataProyecto = buildBarByProyecto(
    grafProyecto.map((x) => ({ ...x, categoria: "Encuestas", cantidad: Number(x.total || 0) }))
  );

  const percepcionMap = (p) => {
    const k = String(p.opcion || "").toUpperCase();
    if (k === "VERDE") return "Buena recepción";
    if (k === "AMARILLO") return "Recepción neutra";
    if (k === "ROJO") return "Recepción conflictiva";
    return p.opcion || MISSING_LABEL;
  };
  const chartDataPercepcion = buildBarByProyecto(
    grafPercepcion.map((p) => ({ ...p, categoria: percepcionMap(p), cantidad: Number(p.cantidad || 0) }))
  );

  const chartDataAfect = buildBarByProyecto(
    grafAfectacion.map((a) => ({
      ...a,
      categoria: a.afectacion || MISSING_LABEL,
      cantidad: Number(a.total || a.cantidad || 0),
    }))
  );

  const chartDataCaract = buildBarByProyecto(
    grafCaract.map((a) => ({ ...a, categoria: a.caracteristicas_predio || MISSING_LABEL, cantidad: Number(a.cantidad || 0) }))
  );

  const chartDataCond = buildBarByProyecto(
    grafCond.map((a) => ({ ...a, categoria: a.condicion_ocupacion || MISSING_LABEL, cantidad: Number(a.cantidad || 0) }))
  );

  const chartDataInteres = buildBarByProyecto(
    grafInteres.map((i) => {
      const k = String(i.opcion || "").trim().toUpperCase();
      const cat = ["SI", "SÍ", "TRUE", "1", "T", "YES"].includes(k) ? "Sí" : ["NO", "FALSE", "0", "F"].includes(k) ? "No" : MISSING_LABEL;
      return { ...i, categoria: cat, cantidad: Number(i.cantidad || 0) };
    })
  );

  const chartDataDocumento = buildBarByProyecto(
    grafDocumento.map((d) => {
      const k = String(d.opcion || "").trim().toUpperCase();
      const cat = ["SI", "SÍ", "TRUE", "1"].includes(k) ? "Sí" : ["NO", "FALSE", "0"].includes(k) ? "No" : MISSING_LABEL;
      return { ...d, categoria: cat, cantidad: Number(d.cantidad || 0) };
    })
  );

  const chartDataCiudad = buildBarByProyecto(
    grafCiudad.map((d) => ({ ...d, categoria: d.ciudad || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );

  const chartDataArraigo = buildBarByProyecto(normalizeArraigo(grafArraigo));
  const chartDataOcupacion = buildBarByProyecto(
    grafOcupacion.map((d) => ({ ...d, categoria: d.ocupacion || d.rubro || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataMedioSubs = buildBarByProyecto(
    grafMedioSubs.map((d) => ({ ...d, categoria: d.medio_subsistencia || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataServicios = buildBarByProyecto(
    grafServicios.map((d) => ({ ...d, categoria: d.servicio || d.caracteristica || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataDiscapSalud = buildBarByProyecto(
    grafDiscapSalud.map((d) => ({ ...d, categoria: d.tipo || d.categoria || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataInstalacionesUso = buildBarByProyecto(
    grafInstalacionesUso.map((d) => ({ ...d, categoria: d.uso || d.instalacion || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataIngreso = buildBarByProyecto(
    grafIngreso.map((d) => ({ ...d, categoria: d.categoria_ingreso || d.segmento || MISSING_LABEL, cantidad: Number(d.cantidad || 0) }))
  );
  const chartDataOrganizacion = buildBarByProyecto(
    grafOrganizacion.map((d) => {
      const k = String(d.opcion || d.pertenece || "").trim().toUpperCase();
      const cat = ["SI", "SÍ", "TRUE", "1"].includes(k) ? "Sí" : ["NO", "FALSE", "0"].includes(k) ? "No" : MISSING_LABEL;
      return { ...d, categoria: cat, cantidad: Number(d.cantidad || 0) };
    })
  );

  // títulos dinámicos
  const tramoLabel = useMemo(() => {
    if (filtroTramo === "ALL" || filtroTramo == null) return null;
    const idNum = Number(filtroTramo);
    const t = grafTramoAll.find((x) => Number(x.id_tramo) === idNum);
    const label =
      t?.nombre_tramo || t?.tramo_nombre || t?.nombre || t?.descripcion || t?.tramo || null;
    return label || `Tramo ${idNum}`;
  }, [filtroTramo, grafTramoAll]);

  const CLASE_N = normClase(filtroClase);
  const claseBadge = ["NORMAL","ESPECIAL","SINDATO"].includes(CLASE_N)
    ? ` — ${CLASE_N === "SINDATO" ? MISSING_BADGE : CLASE_N}`
    : "";
  const tituloCensados = (tramoLabel ? `Censados por ${tramoLabel}` : "Censados por Proyecto") + claseBadge;

  // opciones de Chart
  const barOptionsWithLabels = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8, bottom: 24, left: 8, right: 8 } },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { color: GEO.ink, boxWidth: 12, usePointStyle: true, pointStyle: "rectRounded" },
        },
        datalabels: {
          anchor: "end",
          align: "end",
          offset: -6,
          clamp: true,
          clip: true,
          color: GEO.ink,
          backgroundColor: "rgba(255,255,255,.6)",
          borderRadius: 4,
          padding: { left: 4, right: 4, top: 1, bottom: 1 },
          font: { size: 11, weight: "bold" },
          formatter: (v) => (v ? v : ""),
        },
        tooltip: {
          backgroundColor: "#212922",
          borderColor: "rgba(255,255,255,.25)",
          borderWidth: 1,
          titleColor: "#fff",
          bodyColor: "#fff",
          callbacks: {
            title: (items) => items[0]?.label ?? "",
            label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}`,
          },
        },
      },
      scales: {
        x: { grid: { color: GEO.grid }, ticks: { color: GEO.inkMuted, maxRotation: 32, minRotation: 0 } },
        y: { beginAtZero: true, grace: "12%", grid: { color: GEO.grid }, ticks: { color: GEO.inkMuted } },
      },
    }),
    []
  );

  const titulo = "Centro de Control — Censados";

  return (
    <Modal show={show} onHide={onHide} fullscreen scrollable backdrop="static" keyboard>
      <Modal.Header className="geo-header">
        <Modal.Title className="mb-0 geo-title">{titulo}</Modal.Title>
        <Button size="sm" onClick={onHide} className="geo-btn-close ms-auto">
          Cerrar
        </Button>
      </Modal.Header>

      <Modal.Body style={{ background: GEO.bg }}>
        {loading ? (
          <div className="d-flex align-items-center justify-content-center py-5">
            <Spinner animation="border" role="status" className="me-2" />
            Cargando gráficos…
          </div>
        ) : (
          <Container fluid className="p-0">
            {/* KPIs + Selects */}
            <Row className="g-3 mb-4 align-items-center">
              <Col xs={12} sm={3}>
                <Card className="geo-kpi geo-kpi--olive">
                  <Card.Body className="d-flex align-items-center justify-content-between">
                    <div className="geo-kpi__title">Total Proyectos</div>
                    <div className="geo-kpi__value">{filterByProyecto(tramosEncuestas).length}</div>
                  </Card.Body>
                </Card>
              </Col>

              <Col xs={12} sm={3}>
                <Card className="geo-kpi geo-kpi--mustard">
                  <Card.Body className="d-flex align-items-center justify-content-between">
                    <div className="geo-kpi__title">Total Censados</div>
                    <div className="geo-kpi__value">
                      {filterByProyecto(tramosEncuestas).reduce(
                        (sum, p) => sum + (parseInt(p.total_encuestas, 10) || 0),
                        0
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </Col>

              <Col xs={12} sm={3}>
                <Card className="geo-kpi geo-kpi--moss">
                  <Card.Body className="d-flex align-items-center justify-content-between">
                    <div className="geo-kpi__title">Tramos cerrados</div>
                    <div className="geo-kpi__value">
                      {filterByProyecto(tramosEncuestas).reduce(
                        (s, p) => s + (parseInt(p.tramos_cerrados, 10) || 0),
                        0
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </Col>

              <Col xs={12} sm={3}>
                <Card className="geo-kpi geo-kpi--filter">
                  <Card.Body className="d-flex align-items-center justify-content-between">
                    <div className="geo-kpi__title">Tramo:</div>
                    <select
                      className="form-select form-select-sm geo-select-in-kpi"
                      value={String(filtroTramo)}
                      onChange={(e) => setFiltroTramo(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                    >
                      <option value="ALL">Todos</option>
                      {grafTramoAll.map((t) => (
                        <option key={t.id_tramo} value={t.id_tramo}>
                          {t.nombre_tramo ||
                            t.tramo_nombre ||
                            t.nombre ||
                            t.descripcion ||
                            t.tramo ||
                            `Tramo ${t.id_tramo}`}
                        </option>
                      ))}
                    </select>
                  </Card.Body>
                </Card>
              </Col>

              <Col xs={12} sm={3}>
                <Card className="geo-kpi geo-kpi--filter">
                  <Card.Body className="d-flex align-items-center justify-content-between">
                    <div className="geo-kpi__title">Clase:</div>
                    <select
                      className="form-select form-select-sm geo-select-in-kpi"
                      value={String(filtroClase)} // ALL | NORMAL | ESPECIAL | SINDATO
                      onChange={(e) => setFiltroClase(normClase(e.target.value))}
                    >
                      <option value="ALL">Todas</option>
                      <option value="NORMAL">Normal</option>
                      <option value="ESPECIAL">Especial</option>
                      <option value="SINDATO">No reportado</option>
                    </select>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 1 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 400 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">{tituloCensados}</h6>
                    <Bar key={`proy-${chartKey}`} data={chartDataProyecto} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 400 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Nivel de Riesgo{claseBadge}</h6>
                    <Bar key={`perc-${chartKey}`} data={chartDataPercepcion} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 2 */}
            <Row className="mb-4">
              <Col md={8}>
                <Card className="geo-card" style={{ height: 420 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Afectación por Proyecto{claseBadge}</h6>
                    <Bar key={`afec-${chartKey}`} data={chartDataAfect} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4}>
                <Card className="geo-card" style={{ height: 420 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Ciudad{claseBadge}</h6>
                    <Bar key={`ciud-${chartKey}`} data={chartDataCiudad} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 3 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Tiempo de Arraigo (rangos){claseBadge}</h6>
                    <Bar key={`arra-${chartKey}`} data={chartDataArraigo} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Ocupación / Rubro{claseBadge}</h6>
                    <Bar key={`ocup-${chartKey}`} data={chartDataOcupacion} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 4 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Medio de Subsistencia{claseBadge}</h6>
                    <Bar key={`subs-${chartKey}`} data={chartDataMedioSubs} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Características/Servicios del Predio{claseBadge}</h6>
                    <Bar key={`serv-${chartKey}`} data={chartDataServicios} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 5 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Discapacidad y Requerimientos Especiales{claseBadge}</h6>
                    <Bar key={`disc-${chartKey}`} data={chartDataDiscapSalud} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">
                      Otras Instalaciones en el Predio (Consumo/Venta/Otro){claseBadge}
                    </h6>
                    <Bar key={`inst-${chartKey}`} data={chartDataInstalacionesUso} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 6 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Condición de la Ocupación{claseBadge}</h6>
                    <Bar key={`cond-${chartKey}`} data={chartDataCond} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Ingreso Mensual Aproximado (categorías){claseBadge}</h6>
                    <Bar key={`ingr-${chartKey}`} data={chartDataIngreso} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 7 */}
            <Row className="mb-4">
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Pertenece a Comisión u Organización{claseBadge}</h6>
                    <Bar key={`orga-${chartKey}`} data={chartDataOrganizacion} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6}>
                <Card className="geo-card" style={{ height: 380 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Disposición a ser Reubicado{claseBadge}</h6>
                    <Bar key={`inter-${chartKey}`} data={chartDataInteres} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            {/* Línea 8 */}
            <Row className="mb-4">
              <Col>
                <Card className="geo-card" style={{ height: 350 }}>
                  <Card.Body className="geo-card__body">
                    <h6 className="geo-card__title">Documentación del Terreno{claseBadge}</h6>
                    <Bar key={`docs-${chartKey}`} data={chartDataDocumento} options={barOptionsWithLabels} />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Container>
        )}
      </Modal.Body>
    </Modal>
  );
}
