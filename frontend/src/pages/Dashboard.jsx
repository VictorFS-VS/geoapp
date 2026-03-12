// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
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

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

// Paleta suave
const pastelPalette = [
  "rgba(255, 159, 177, 0.4)",
  "rgba(159, 217, 255, 0.4)",
  "rgba(255, 223, 159, 0.4)",
  "rgba(178, 255, 178, 0.4)",
  "rgba(217, 178, 255, 0.4)",
  "rgba(255, 186, 217, 0.4)",
];
const pastelBorders = pastelPalette.map((c) => c.replace(/0\.4\)/, "0.8)"));

// ======= Helper: centra cuando hay 1 o 2 categorías =======
function padForCenter(chartData) {
  const L = chartData?.labels?.length || 0;
  if (L <= 2 && L > 0) {
    const labels = ["", ...chartData.labels, ""];
    const datasets = (chartData.datasets || []).map((ds) => ({
      ...ds,
      data: [0, ...(ds.data || []), 0],
    }));
    return { labels, datasets };
  }
  return chartData;
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [estadoData, setEstadoData] = useState([]);
  const [estadoNumericoData, setEstadoNumericoData] = useState([]);
  const [tipoEstudio, setTipoEstudio] = useState([]);
  const [resumen, setResumen] = useState({
    total: 0,
    evaluacion: 0,
    licencia: 0,
    diaProx: 0,
    resProx: 0,
  });
  const [anioSector, setAnioSector] = useState([]);
  const [anioEstudio, setAnioEstudio] = useState([]);
  const [anioImpacto, setAnioImpacto] = useState([]);

  const [loading, setLoading] = useState(true);

  const coloresPorEstado = {
    "1": "rgb(225, 70, 43)",
    "2": "rgb(242, 156, 15)",
    "3": "rgb(216, 200, 51)",
    "4": "rgb(156, 186, 57)",
    "5": "rgb(95, 171, 72)",
    "6": "rgb(25, 148, 107)",
    "7": "rgb(42, 139, 74)",
    "8": "rgb(31, 98, 35)",
    "9": "rgb(40, 101, 45)",
    "10": "rgb(71, 74, 243)",
  };

  const nombresPorEstado = {
    "1": "Ingreso de Proyecto EMA",
    "2": "Mesa de Entrada",
    "3": "Dirección DGCCARN",
    "4": "Geomática",
    "5": "Análisis Técnico",
    "6": "RIMA",
    "7": "DVIA",
    "8": "Dirección General",
    "9": "Licencia (DIA)",
    "10": "Resolución (A.A.)",
  };

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s/g, "");

  const estadoKeyMap = useMemo(() => {
    const base = Object.fromEntries(
      Object.entries(nombresPorEstado).map(([id, name]) => [normalize(name), id])
    );
    base["licenciadia"] = "10";
    base["licencia"] = "10";
    base["rimapublicacion"] = "6";
    base["rimaweb"] = "7";
    base["mesadeentrada"] = "2";
    base["direcciondgccarn"] = "3";
    base["direcciongeneral"] = "9";
    return base;
  }, []);

  const getEstadoIdFromLabel = (label) => estadoKeyMap[normalize(label)] || null;

  const toRgba = (rgb, a = 0.8) =>
    String(rgb).startsWith("rgb(")
      ? rgb.replace("rgb(", "rgba(").replace(")", `, ${a})`)
      : rgb;

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const handleAuthFail = () => {
      localStorage.removeItem("token");
      navigate("/login", { replace: true });
    };

    const normalizeRows = (data) => {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.rows)) return data.rows;
      return [];
    };

    const fetchJson = async (url) => {
      const res = await fetch(`${API_URL}${url}`, { headers });

      if (res.status === 401) {
        handleAuthFail();
        return null;
      }

      if (res.status === 403) {
        // ✅ no es auth fail, es falta de permiso
        console.warn("Sin permiso para:", url);
        return null;
      }

      if (!res.ok) throw new Error(`Error ${res.status} on ${url}`);
      return await res.json();
    };

    (async () => {
      try {
        setLoading(true);

        const [
          estado,
          estadoNumerico,
          tiposEstudio,
          anioSectorR,
          anioEstudioR,
          anioImpactoR,
          resumenR,
        ] = await Promise.all([
          fetchJson("/dashboard/estado"),
          fetchJson("/dashboard/estado-numerico"),
          fetchJson("/dashboard/tipos-estudio"),
          fetchJson("/dashboard/anio-sector"),
          fetchJson("/dashboard/anio-estudio"),
          fetchJson("/dashboard/anio-impacto"),
          fetchJson("/dashboard/resumen"),
        ]);

        if (!estado && !resumenR) return;

        setEstadoData(normalizeRows(estado));
        setEstadoNumericoData(normalizeRows(estadoNumerico));
        setTipoEstudio(normalizeRows(tiposEstudio));
        setAnioSector(normalizeRows(anioSectorR));
        setAnioEstudio(normalizeRows(anioEstudioR));
        setAnioImpacto(normalizeRows(anioImpactoR));

        setResumen({
          total: Number(resumenR?.total || 0),
          evaluacion: Number(resumenR?.evaluacion || 0),
          licencia: Number(resumenR?.licencia || 0),
          diaProx: Number(resumenR?.diaProx || 0),
          resProx: Number(resumenR?.resProx || 0),
        });
      } catch (err) {
        console.error("Error cargando datos del dashboard:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  // === DATASETS ===
  const pieData = useMemo(
    () => ({
      labels: tipoEstudio.map((e) => e.tipo_estudio),
      datasets: [
        {
          data: tipoEstudio.map((e) => parseInt(e.cantidad, 10) || 0),
          backgroundColor: pastelPalette.slice(0, 4),
          borderColor: pastelBorders.slice(0, 4),
          borderWidth: 1,
        },
      ],
    }),
    [tipoEstudio]
  );

  const barEstado = useMemo(
    () => ({
      labels: estadoData.map((e) => e.estado),
      datasets: [
        {
          label: "Proyectos",
          data: estadoData.map((e) => parseInt(e.cantidad, 10) || 0),
          backgroundColor: estadoData.map((e) => {
            const id = getEstadoIdFromLabel(e.estado);
            return id ? coloresPorEstado[id] : pastelPalette[1];
          }),
          borderColor: estadoData.map((e) => {
            const id = getEstadoIdFromLabel(e.estado);
            return id ? toRgba(coloresPorEstado[id], 0.8) : pastelBorders[1];
          }),
          borderWidth: 1,
        },
      ],
    }),
    [estadoData]
  );

  const estadosAgrupadosArray = useMemo(() => {
    const estadoAgrupado = {};
    (estadoNumericoData || []).forEach(({ estado, cantidad }) => {
      const clave = parseInt(estado, 10);
      if (!estadoAgrupado[clave]) {
        estadoAgrupado[clave] = {
          estado: clave,
          cantidad: 0,
          des_estado: nombresPorEstado[String(clave)] || `Estado ${clave}`,
        };
      }
      estadoAgrupado[clave].cantidad += parseInt(cantidad || 0, 10);
    });
    return Object.values(estadoAgrupado).sort((a, b) => a.estado - b.estado);
  }, [estadoNumericoData]);

  const barPorEstado = useMemo(
    () => ({
      labels: estadosAgrupadosArray.map((e) => e.des_estado),
      datasets: [
        {
          label: "Proyectos por Estado",
          data: estadosAgrupadosArray.map((e) => e.cantidad),
          backgroundColor: estadosAgrupadosArray.map(
            (e) => coloresPorEstado[String(e.estado)] || "#ccc"
          ),
          borderColor: estadosAgrupadosArray.map((e) =>
            toRgba(coloresPorEstado[String(e.estado)] || "#ccc", 0.8)
          ),
          borderWidth: 1,
        },
      ],
    }),
    [estadosAgrupadosArray]
  );

  const barAnioSector = useMemo(() => {
    const filtrado = (anioSector || []).filter(
      (e) => e.sector && String(e.sector).toLowerCase() !== "null"
    );
    const anios = [...new Set(filtrado.map((e) => e.anio))];
    const sectores = [...new Set(filtrado.map((e) => e.sector))];

    return {
      labels: anios,
      datasets: sectores.map((sector, i) => ({
        label: sector,
        data: anios.map(
          (anio) =>
            filtrado.find((e) => e.anio == anio && e.sector === sector)?.cantidad || 0
        ),
        backgroundColor: pastelPalette[i % pastelPalette.length],
        borderColor: pastelBorders[i % pastelBorders.length],
        borderWidth: 1,
      })),
    };
  }, [anioSector]);

  const barAnioEstudio = useMemo(() => {
    const uniqueAnios = [...new Set((anioEstudio || []).map((e) => e.anio))];
    const uniqueTipos = [...new Set((anioEstudio || []).map((e) => e.tipo_estudio))];

    return {
      labels: uniqueAnios,
      datasets: uniqueTipos.map((tipo, i) => ({
        label: tipo,
        data: uniqueAnios.map(
          (a) =>
            (anioEstudio || []).find((e) => e.anio == a && e.tipo_estudio === tipo)
              ?.cantidad || 0
        ),
        backgroundColor: pastelPalette[i % pastelPalette.length],
        borderColor: pastelBorders[i % pastelBorders.length],
        borderWidth: 1,
      })),
    };
  }, [anioEstudio]);

  const barAnioImpacto = useMemo(() => {
    const uniqueAnios = [...new Set((anioImpacto || []).map((e) => e.anio))];
    const uniqueImpactos = [...new Set((anioImpacto || []).map((e) => e.impacto))];

    return {
      labels: uniqueAnios,
      datasets: uniqueImpactos.map((impacto, i) => ({
        label: impacto,
        data: uniqueAnios.map(
          (a) =>
            (anioImpacto || []).find((e) => e.anio == a && e.impacto === impacto)
              ?.cantidad || 0
        ),
        backgroundColor: pastelPalette[i % pastelPalette.length],
        borderColor: pastelBorders[i % pastelBorders.length],
        borderWidth: 1,
      })),
    };
  }, [anioImpacto]);

  const barOptionsWithLabels = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 12, bottom: 30 } },
    elements: {
      bar: {
        categoryPercentage: 0.6,
        barPercentage: 0.9,
        maxBarThickness: 80,
        borderRadius: 6,
      },
    },
    plugins: {
      legend: { display: true, position: "bottom" },
      datalabels: {
        anchor: "end",
        align: "end",
        offset: -6,
        clamp: true,
        clip: true,
        color: "#000",
        font: { size: 12, weight: "600" },
        formatter: (v) => (v ? v : ""),
      },
    },
    scales: {
      x: { type: "category", offset: true, grid: { drawBorder: false, offset: true } },
      y: {
        beginAtZero: true,
        min: 0,
        grace: "15%",
        ticks: {
          stepSize: 1,
          precision: 0,
          callback: (v) => (Number.isInteger(v) ? v : ""),
        },
        grid: { drawBorder: false },
      },
    },
  };

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

  const stats = useMemo(
    () => [
      {
        icon: <FaFolderOpen size={24} className="text-white" />,
        title: "Total Proyectos",
        value: resumen.total || 0,
        subtitle: "Registrados en el sistema",
        color: "primary",
      },
      {
        icon: <FaTasks size={24} className="text-white" />,
        title: "En Evaluación",
        value: resumen.evaluacion || 0,
        subtitle: "Proyectos en proceso",
        color: "warning",
      },
      {
        icon: <FaChartLine size={24} className="text-white" />,
        title: "Con Licencia",
        value: resumen.licencia || 0,
        subtitle: "Finalizados con éxito",
        color: "success",
      },
    ],
    [resumen]
  );

  return (
    <Container fluid className="py-4">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <h4 className="mb-0">Centro de Control</h4>
      </div>

      {loading && <div className="text-muted small mb-3">Cargando dashboard...</div>}

      <Row className="g-4 mb-4">
        {stats.map((card, i) => (
          <Col md={4} key={i}>
            <Card className="shadow-sm border-0 rounded-4">
              <Card.Body className="d-flex align-items-center gap-3">
                <div
                  className={`bg-${card.color} p-3 rounded-circle d-flex align-items-center justify-content-center`}
                >
                  {card.icon}
                </div>
                <div className="ms-auto text-end">
                  <div className="text-muted small">{card.title}</div>
                  <div className="fw-bold fs-4">{card.value}</div>
                  <div className={`text-${card.color} small`}>{card.subtitle}</div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ✅ SIEMPRE visible y fija */}
      <Row className="mb-4">
        <Col>
          <AlertasProyectos />
        </Col>
      </Row>

      {/* ===== Lo demás queda igual ===== */}
      {/* Proyectos por Estado (agrupado numérico) */}
      <Row className="g-4 mt-4">
        <div
          className="d-flex justify-content-start align-items-center border rounded-3 p-2 bg-light text-center overflow-auto"
          style={{ whiteSpace: "nowrap", overflowX: "auto" }}
        >
          <div className="flex-grow-1 border-end p-2 small">INICIO DE PROCESO</div>

          <div className="step-box text-white small" style={{ backgroundColor: "rgb(225, 70, 43)" }}>
            1<br />Ingreso de <br />Proyecto EMA
          </div>
          <div className="step-box text-dark small" style={{ backgroundColor: "rgb(242, 156, 15)" }}>
            2<br />Mesa de <br />Entrada
          </div>
          <div className="step-box text-dark small" style={{ backgroundColor: "rgb(216, 200, 51)" }}>
            3<br />Dirección <br />DGCCARN
          </div>
          <div className="step-box text-dark small" style={{ backgroundColor: "rgb(156, 186, 57)" }}>
            4<br />Geomática
          </div>
          <div className="step-box text-dark small" style={{ backgroundColor: "rgb(95, 171, 72)" }}>
            5<br />Análisis <br />Técnico
          </div>
          <div className="step-box text-dark small" style={{ backgroundColor: "rgb(25, 148, 107)" }}>
            6<br />RIMA <br />(Publicación)
          </div>
          <div className="step-box text-white small" style={{ backgroundColor: "rgb(42, 139, 74)" }}>
            7<br />RIMA <br />(WEB)
          </div>
          <div className="step-box text-white small" style={{ backgroundColor: "rgb(31, 98, 35)" }}>
            8<br />DVIA
          </div>
          <div className="step-box text-white small" style={{ backgroundColor: "rgb(40, 101, 45)" }}>
            9<br />Dirección <br />General
          </div>
          <div className="step-box text-white small" style={{ backgroundColor: "rgb(71, 74, 243)" }}>
            10<br />Licencia <br />(DIA)
          </div>

          <div className="flex-grow-1 border-start p-2 small">FIN DE PROCESO</div>
        </div>

        <Col md={12}>
          <Card className="shadow-sm rounded-4" style={{ height: "450px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Bar data={barPorEstado} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Estado vs Tipos de estudio */}
      <Row className="g-4 mt-4">
        <Col md={9}>
          <Card className="shadow-sm rounded-4" style={{ height: "450px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Card.Title className="mb-3">Proyectos por Estado</Card.Title>
              <Bar data={barEstado} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>

        <Col md={3}>
          <Card className="shadow-sm rounded-4" style={{ height: "450px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Card.Title className="mb-3">Tipos de Estudio</Card.Title>
              <Pie data={pieData} options={pieOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Series por año */}
      <Row className="g-4 mt-4">
        <Col md={6}>
          <Card className="shadow-sm rounded-4" style={{ height: "350px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Card.Title className="mb-3">Proyectos por Año y Sector</Card.Title>
              <Bar data={padForCenter(barAnioSector)} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Card className="shadow-sm rounded-4" style={{ height: "350px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Card.Title className="mb-3">Proyectos por Año y Tipo de Estudio</Card.Title>
              <Bar data={padForCenter(barAnioEstudio)} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4 mt-4">
        <Col md={12}>
          <Card className="shadow-sm rounded-4" style={{ height: "380px" }}>
            <Card.Body style={{ position: "relative", height: "100%" }}>
              <Card.Title className="mb-3">Proyectos por Año y Tipo de Impacto Ambiental</Card.Title>
              <Bar data={padForCenter(barAnioImpacto)} options={barOptionsWithLabels} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
