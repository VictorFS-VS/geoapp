// src/pages/DashboardTramos.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Row, Col, Card } from "react-bootstrap";
import { FaFolderOpen, FaTasks, FaChartLine } from "react-icons/fa";
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
import "../styles/Dashboard.css";
import AlertasProyectos from "@/components/AlertasProyectos";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels
);

/** ======================================
 * Config
 * =====================================*/
// 👉 Ajusta esta ruta si tu visor tiene otro path
const VISOR_ROUTE = "/visor-tramos";

// Asegura que el backend tenga /api por defecto
const API_BASE = (
  import.meta.env.VITE_API_URL || "http://localhost:4000/api"
).replace(/\/$/, "");

// Paleta
const pastelPalette = [
  "rgba(255, 159, 177, 0.4)",
  "rgba(159, 217, 255, 0.4)",
  "rgba(255, 223, 159, 0.4)",
  "rgba(178, 255, 178, 0.4)",
  "rgba(217, 178, 255, 0.4)",
  "rgba(255, 186, 217, 0.4)",
];
const pastelBorders = pastelPalette.map((c) => c.replace(/0\.4\)/, "0.8)"));

const coloresPercepcion = {
  "Buena recepción": "rgba(40, 167, 69, 0.4)",
  "Recepción neutra": "rgba(255, 193, 7, 0.4)",
  "Recepción conflictiva": "rgba(220, 53, 69, 0.4)",
};
const borderColoresPercepcion = {
  "Buena recepción": "rgba(40, 167, 69, 0.8)",
  "Recepción neutra": "rgba(255, 193, 7, 0.8)",
  "Recepción conflictiva": "rgba(220, 53, 69, 0.8)",
};

/** ======================================
 * Helpers
 * =====================================*/
function getUserFromStorage() {
  try {
    const s = localStorage.getItem("user");
    if (s) return JSON.parse(s);
  } catch {}
  try {
    const tk = localStorage.getItem("token");
    if (!tk) return null;
    const payload = JSON.parse(atob(tk.split(".")[1] || ""));
    return payload || null;
  } catch {}
  return null;
}

export default function DashboardTramos() {
  const navigate = useNavigate();

  // Estados
  const [tramosEncuestas, setTramosEncuestas] = useState([]);
  const [grafProyecto, setGrafProyecto] = useState([]);
  const [grafTramo, setGrafTramo] = useState([]); // ← incluye nombre de tramo desde backend
  const [grafAfectacion, setGrafAfectacion] = useState([]);
  const [grafCaract, setGrafCaract] = useState([]);
  const [grafCond, setGrafCond] = useState([]);
  const [grafInteres, setGrafInteres] = useState([]);
  const [grafPercepcion, setGrafPercepcion] = useState([]);

  // Fetch datos + redirección para tipo 12
  useEffect(() => {
    const token = localStorage.getItem("token");
    const user = getUserFromStorage();

    if (!token || !user) {
      navigate("/login", { replace: true });
      return;
    }

    // 👇 Quedarse solo en el visor si es CLIENTE_MAPS (12)
    if (Number(user.tipo_usuario) === 12) {
      navigate(VISOR_ROUTE, { replace: true });
      return;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    let cancelled = false;

    Promise.all([
      fetch(`${API_BASE}/dashboard/tramos-por-proyecto`, { headers }),
      fetch(`${API_BASE}/dashboard/encuestas-por-proyecto`, { headers }),
      fetch(`${API_BASE}/dashboard/encuestas-por-tramo`, { headers }),
      fetch(`${API_BASE}/dashboard/afectacion-por-tramo`, { headers }),
      fetch(`${API_BASE}/dashboard/caracteristicas-predio`, { headers }),
      fetch(`${API_BASE}/dashboard/condicion-ocupacion`, { headers }),
      fetch(`${API_BASE}/dashboard/interes-reubicacion`, { headers }),
      fetch(`${API_BASE}/dashboard/percepcion`, { headers }),
    ])
      .then((resps) =>
        Promise.all(
          resps.map(async (r) => {
            if (!r.ok) {
              const msg = await r.text().catch(() => r.statusText);
              throw new Error(`${r.status} ${r.url} :: ${msg}`);
            }
            return r.json();
          })
        )
      )
      .then(([t, p, t2, a, c, co, i, pe]) => {
        if (cancelled) return;
        setTramosEncuestas(Array.isArray(t) ? t : []);
        setGrafProyecto(Array.isArray(p) ? p : []);

        const t2Ordenado = (Array.isArray(t2) ? t2 : []).sort(
          (x, y) => Number(x.id_tramo) - Number(y.id_tramo)
        );
        setGrafTramo(t2Ordenado);

        setGrafAfectacion(Array.isArray(a) ? a : []);
        setGrafCaract(Array.isArray(c) ? c : []);
        setGrafCond(Array.isArray(co) ? co : []);
        setGrafInteres(Array.isArray(i) ? i : []);
        setGrafPercepcion(Array.isArray(pe) ? pe : []);
      })
      .catch((err) => {
        console.error("[DashboardTramos] fetch error:", err);
        // Si deseas forzar logout en 401/403, descomenta:
        // navigate("/login", { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Lookup de nombre de tramo
  const getTramoName = (id) => {
    const t = grafTramo.find((x) => Number(x.id_tramo) === Number(id));
    return t?.tramo_nombre || t?.nombre_tramo || t?.tramo || `Tramo ${id}`;
  };

  // Resumen
  const totalProyectos = tramosEncuestas.length;
  const totalEncuestados = tramosEncuestas.reduce(
    (sum, p) => sum + (parseInt(p.total_encuestas, 10) || 0),
    0
  );
  const totalTramosCerrados = tramosEncuestas.reduce(
    (sum, p) => sum + (parseInt(p.tramos_cerrados, 10) || 0),
    0
  );

  const resumenStats = [
    {
      icon: <FaFolderOpen size={24} className="text-white" />,
      title: "Total Proyectos",
      value: totalProyectos,
      subtitle: "Registrados en el sistema",
      color: "primary",
    },
    {
      icon: <FaTasks size={24} className="text-white" />,
      title: "Total Encuestados",
      value: totalEncuestados,
      subtitle: "Encuestas realizadas",
      color: "warning",
    },
    {
      icon: <FaChartLine size={24} className="text-white" />,
      title: "Tramos cerrados",
      value: totalTramosCerrados,
      subtitle: "Finalizados con éxito",
      color: "success",
    },
  ];

  // Opciones PIE con datalabels
  const pieOptionsWithLabels = {
    responsive: true,
    plugins: {
      legend: { display: true, position: "bottom" },
      datalabels: {
        color: "#333",
        font: { size: 12, weight: "600" },
        formatter: (v, ctx) => {
          const ary = ctx.chart.data.datasets[0].data || [];
          const total = ary.reduce((s, x) => s + Number(x || 0), 0) || 1;
          return ((Number(v) / total) * 100).toFixed(1) + "%";
        },
      },
    },
  };

  // Opciones BARRAS
  const barOptionsWithLabels = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 10, bottom: 30 } },
    plugins: {
      legend: { display: true, position: "bottom" },
      datalabels: {
        anchor: "end",
        align: "top",
        color: "#333",
        formatter: (v) => v,
        font: { size: 12 },
      },
    },
    scales: { x: { beginAtZero: true }, y: { beginAtZero: true } },
  };

  // Percepción (colores custom)
  const etiquetasPercepcion = grafPercepcion.map((p) => {
    const k = String(p.opcion || "").toUpperCase();
    if (k === "VERDE") return "Buena recepción";
    if (k === "AMARILLO") return "Recepción neutra";
    if (k === "ROJO") return "Recepción conflictiva";
    return p.opcion;
  });
  const datosPercepcion = grafPercepcion.map((p) => Number(p.cantidad || 0));
  const chartDataPercepPie = {
    labels: etiquetasPercepcion,
    datasets: [
      {
        data: datosPercepcion,
        backgroundColor: etiquetasPercepcion.map((lbl) => coloresPercepcion[lbl]),
        borderColor: etiquetasPercepcion.map((lbl) => borderColoresPercepcion[lbl]),
        borderWidth: 1,
      },
    ],
  };

  // Encuestas por Tramo
  const chartDataTramo = {
    labels: grafTramo.map((t) => getTramoName(t.id_tramo)),
    datasets: [
      {
        label: "Encuestas",
        data: grafTramo.map((t) => Number(t.total || 0)),
        backgroundColor: pastelPalette[1],
        borderColor: pastelBorders[1],
        borderWidth: 1,
      },
    ],
  };

  // Encuestas por Proyecto
  const chartDataProyecto = {
    labels: grafProyecto.map((p) => p.nombre_proyecto),
    datasets: [
      {
        label: "Encuestas",
        data: grafProyecto.map((p) => Number(p.total || 0)),
        backgroundColor: pastelPalette[0],
        borderColor: pastelBorders[0],
        borderWidth: 1,
      },
    ],
  };

  // Afectación – etiqueta con nombre de tramo
  const etiquetasAfect = Array.from(
    new Set(grafAfectacion.map((a) => `P${a.id_proyecto} - ${getTramoName(a.id_tramo)}`))
  );
  const tiposAfect = Array.from(new Set(grafAfectacion.map((a) => a.afectacion)));
  const chartDataAfect = {
    labels: etiquetasAfect,
    datasets: tiposAfect.map((tipo, i) => ({
      label: tipo,
      data: etiquetasAfect.map((lbl) => {
        const rec = grafAfectacion.find(
          (a) =>
            `P${a.id_proyecto} - ${getTramoName(a.id_tramo)}` === lbl &&
            a.afectacion === tipo
        );
        return rec ? Number(rec.total || 0) : 0;
      }),
      backgroundColor: pastelPalette[(i + 2) % pastelPalette.length],
      borderColor: pastelBorders[(i + 2) % pastelBorders.length],
      borderWidth: 1,
    })),
  };

  // Uso del Predio (por tramo)
  const tramoIdsCaract = Array.from(new Set(grafCaract.map((a) => a.id_tramo)));
  const labelsCaract = tramoIdsCaract.map(getTramoName);
  const tiposCaract = Array.from(new Set(grafCaract.map((a) => a.caracteristicas_predio)));
  const chartDataCaract = {
    labels: labelsCaract,
    datasets: tiposCaract.map((tipo, i) => ({
      label: tipo,
      data: tramoIdsCaract.map((id) => {
        const rec = grafCaract.find(
          (a) => Number(a.id_tramo) === Number(id) && a.caracteristicas_predio === tipo
        );
        return rec ? Number(rec.cantidad || 0) : 0;
      }),
      backgroundColor: pastelPalette[(i + 3) % pastelPalette.length],
      borderColor: pastelBorders[(i + 3) % pastelBorders.length],
      borderWidth: 1,
    })),
  };

  // Tipo de Ocupación (por tramo)
  const tramoIdsCond = Array.from(new Set(grafCond.map((a) => a.id_tramo)));
  const labelsCond = tramoIdsCond.map(getTramoName);
  const tiposCond = Array.from(new Set(grafCond.map((a) => a.condicion_ocupacion)));
  const chartDataCond = {
    labels: labelsCond,
    datasets: tiposCond.map((tipo, i) => ({
      label: tipo,
      data: tramoIdsCond.map((id) => {
        const rec = grafCond.find(
          (a) => Number(a.id_tramo) === Number(id) && a.condicion_ocupacion === tipo
        );
        return rec ? Number(rec.cantidad || 0) : 0;
      }),
      backgroundColor: pastelPalette[(i + 4) % pastelPalette.length],
      borderColor: pastelBorders[(i + 4) % pastelBorders.length],
      borderWidth: 1,
    })),
  };

  // Interés de reubicación (por si lo quieres como pie)
  const chartDataInteresPie = {
    labels: ["Sí", "No"],
    datasets: [
      {
        data: grafInteres.map((i) => Number(i.cantidad || 0)),
        backgroundColor: pastelPalette.slice(0, 2),
        borderColor: pastelBorders.slice(0, 2),
        borderWidth: 1,
      },
    ],
  };

  return (
    <Container fluid className="p-0">
      {/* Encabezado */}
      <div className="sticky-top bg-white" style={{ zIndex: 1020, padding: "1rem" }}>
        <h4 className="mb-3">Centro de Control</h4>
        <Row className="g-4 mb-4">
          {resumenStats.map((c, i) => {
            if (i === 1) {
              return (
                <Col xs={12} md={4} key={i}>
                  <Card className="shadow-sm border-0 rounded-4">
                    <Card.Body className="d-flex align-items-center gap-3">
                      <div className={`bg-${c.color} p-3 rounded-circle d-flex align-items-center justify-content-center`}>
                        {c.icon}
                      </div>
                      <div className="ms-auto text-end">
                        <div className="text-muted small">{c.title}</div>
                        <div className="fw-bold fs-4">{c.value}</div>
                        <div className={`text-${c.color} small`}>{c.subtitle}</div>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              );
            }
            return (
              <Col xs={0} sm={4} key={i} className="d-none d-sm-block">
                <Card className="shadow-sm border-0 rounded-4">
                  <Card.Body className="d-flex align-items-center gap-3">
                    <div className={`bg-${c.color} p-3 rounded-circle d-flex align-items-center justify-content-center`}>
                      {c.icon}
                    </div>
                    <div className="ms-auto text-end">
                      <div className="text-muted small">{c.title}</div>
                      <div className="fw-bold fs-4">{c.value}</div>
                      <div className={`text-${c.color} small`}>{c.subtitle}</div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>
      </div>

      {/* Gráficos */}
      <Row className="mb-4">
        <Col md={4}>
          <Card className="shadow-sm border-0 rounded-4" style={{ height: "400px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <h6 className="fw-bold">Nivel de riesgo</h6>
              <Pie data={chartDataPercepPie} options={pieOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
        <Col md={8}>
          <Card className="shadow-sm border-0 rounded-4" style={{ height: "400px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <h6 className="fw-bold">Encuestas por Tramo</h6>
              <Bar data={chartDataTramo} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col>
          <Card className="shadow-sm border-0 rounded-4" style={{ height: "350px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <h6 className="fw-bold">Afectación por franja de proyecto</h6>
              <Bar data={chartDataAfect} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col md={6}>
          <Card className="shadow-sm border-0 rounded-4" style={{ height: "300px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <h6 className="fw-bold">Uso del Predio</h6>
              <Bar data={chartDataCaract} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="shadow-sm border-0 rounded-4" style={{ height: "300px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <h6 className="fw-bold">Tipo de Ocupación</h6>
              <Bar data={chartDataCond} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
