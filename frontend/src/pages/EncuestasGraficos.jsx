// src/pages/EncuestasGraficos.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Container, Row, Col, Card, Form, Button, Spinner, Table, Alert
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

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels
);

const API_URL = import.meta.env.VITE_API_URL;

// Paleta pastel (como en tu Dashboard)
const pastelPalette = [
  "rgba(255, 159, 177, 0.5)", "rgba(255, 205, 86, 0.5)", "rgba(75, 192, 192, 0.5)",
  "rgba(153, 102, 255, 0.5)", "rgba(54, 162, 235, 0.5)", "rgba(201, 203, 207, 0.5)",
  "rgba(255, 99, 132, 0.5)", "rgba(255, 159, 64, 0.5)",  "rgba(66, 245, 172, 0.5)",
  "rgba(255, 102, 196, 0.5)", "rgba(102, 204, 255, 0.5)", "rgba(255, 204, 153, 0.5)"
];

const borderPalette = pastelPalette.map(c => c.replace(/0\.5\)/, '1)'));

export default function EncuestasGraficos() {
  const { id } = useParams(); // id del proyecto
  const token = localStorage.getItem("token");

  const [loading, setLoading] = useState(true);
  const [tramos, setTramos] = useState([]);
  const [campos, setCampos] = useState([]);

  const [tramoSel, setTramoSel] = useState("all");
  const [campoSel, setCampoSel] = useState(null);
  const [tipoGraf, setTipoGraf] = useState("bar"); // bar | pie
  const [fechaGrupo, setFechaGrupo] = useState("anio"); // anio | mes | dia (solo si campo=date)

  const [frecuencias, setFrecuencias] = useState(null);
  const [busyChart, setBusyChart] = useState(false);
  const [error, setError] = useState("");

  const headers = useMemo(() => {
    const h = { Authorization: token ? "Bearer " + token : undefined };
    return h;
  }, [token]);

  useEffect(() => {
    const fetchInit = async () => {
      try {
        setLoading(true);

        // 1) Tramos del proyecto
        const resTramos = await fetch(`${API_URL}/tramos/${id}`, { headers: headers });
        const tr = resTramos.ok ? await resTramos.json() : [];
        setTramos(tr);

        // 2) Campos graficables
        const resCampos = await fetch(`${API_URL}/encuestas/campos`, { headers: headers });
        const cs = resCampos.ok ? await resCampos.json() : [];
        setCampos(cs);

        // Selecciona un campo por defecto (ej: el primero)
        if (cs.length > 0) setCampoSel(cs[0].name);
      } catch (e) {
        console.error(e);
        setError("No se pudo cargar la configuración inicial.");
      } finally {
        setLoading(false);
      }
    };
    fetchInit();
  }, [id, headers]);

  const campoMeta = useMemo(
    () => campos.find(c => c.name === campoSel) || null,
    [campos, campoSel]
  );

  const canDateGroup = campoMeta?.type === "date";

  const handleGenerar = async () => {
    if (!campoSel) return;
    setError("");
    setBusyChart(true);
    try {
      const params = new URLSearchParams({
        id_proyecto: id,
        campo: campoSel,
      });
      if (tramoSel && tramoSel !== "all") params.set("id_tramo", tramoSel);
      if (canDateGroup) params.set("fecha_grupo", fechaGrupo);

      const res = await fetch(`${API_URL}/encuestas/frecuencias?` + params.toString(), {
        headers
      });
      if (!res.ok) throw new Error("Error al obtener frecuencias");
      const data = await res.json();
      setFrecuencias(data);
    } catch (e) {
      console.error(e);
      setError("Ocurrió un error al generar el gráfico.");
    } finally {
      setBusyChart(false);
    }
  };

  const chartData = useMemo(() => {
    if (!frecuencias?.data?.length) return null;

    const labels = frecuencias.data.map(d => d.label);
    const counts = frecuencias.data.map(d => d.count);

    return {
      labels,
      datasets: [
        {
          label: `${frecuencias?.campo?.label || "Pregunta"} (${frecuencias.total} registros)`,
          data: counts,
          backgroundColor: labels.map((_, i) => pastelPalette[i % pastelPalette.length]),
          borderColor: labels.map((_, i) => borderPalette[i % borderPalette.length]),
          borderWidth: 1,
        },
      ],
    };
  }, [frecuencias]);

  const chartOptions = useMemo(() => {
    const total = frecuencias?.total || 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = ctx.parsed;
              const pct = total ? ((val * 100) / total).toFixed(1) : 0;
              return `${val} (${pct}%)`;
            },
          },
        },
        datalabels: {
          anchor: "end",
          align: "top",
          formatter: (val, ctx) => {
            const total = frecuencias?.total || 0;
            if (!total) return '';
            const pct = ((val * 100) / total).toFixed(1);
            return `${pct}%`;
          },
          font: { weight: "bold" },
        },
      },
      scales: tipoGraf === "bar"
        ? {
            x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } },
            y: { beginAtZero: true },
          }
        : undefined,
    };
  }, [frecuencias, tipoGraf]);

  return (
    <Container fluid className="py-3">
      <Row>
        <Col>
          <h4>Gráficos de Encuestas por Proyecto</h4>
          <div className="text-muted">Proyecto ID: {id}</div>
        </Col>
      </Row>

      {error && (
        <Row className="mt-2">
          <Col><Alert variant="danger">{error}</Alert></Col>
        </Row>
      )}

      <Row className="mt-3">
        <Col md={3}>
          <Card className="mb-3">
            <Card.Body>
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Tramo</Form.Label>
                  <Form.Select value={tramoSel} onChange={(e) => setTramoSel(e.target.value)} disabled={loading}>
                    <option value="all">— Todos los tramos —</option>
                    {tramos.map(t => (
                      <option key={t.id_tramo} value={t.id_tramo}>
                        {t.nombre_tramo || `Tramo ${t.id_tramo}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Pregunta (Campo)</Form.Label>
                  <Form.Select value={campoSel || ''} onChange={(e) => setCampoSel(e.target.value)} disabled={loading}>
                    {campos.map(c => (
                      <option key={c.name} value={c.name}>
                        {c.label} {c.type ? `(${c.type})` : ''}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>

                {canDateGroup && (
                  <Form.Group className="mb-3">
                    <Form.Label>Agrupar fechas por</Form.Label>
                    <Form.Select value={fechaGrupo} onChange={(e) => setFechaGrupo(e.target.value)}>
                      <option value="anio">Año</option>
                      <option value="mes">Mes</option>
                      <option value="dia">Día</option>
                    </Form.Select>
                  </Form.Group>
                )}

                <Form.Group className="mb-3">
                  <Form.Label>Tipo de gráfico</Form.Label>
                  <Form.Select value={tipoGraf} onChange={(e) => setTipoGraf(e.target.value)}>
                    <option value="bar">Barras</option>
                    <option value="pie">Torta</option>
                  </Form.Select>
                </Form.Group>

                <div className="d-grid">
                  <Button onClick={handleGenerar} disabled={busyChart || loading}>
                    {busyChart ? <Spinner size="sm" /> : 'Generar gráfico'}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>

        <Col md={9}>
          <Card className="mb-3" style={{ minHeight: 420 }}>
            <Card.Body>
              {!chartData && (
                <div className="text-muted">
                  {loading ? "Cargando configuración..." : "Elige tramo y pregunta, luego presiona 'Generar gráfico'."}
                </div>
              )}
              {chartData && (
                <div style={{ height: 380 }}>
                  {tipoGraf === "bar" ? (
                    <Bar data={chartData} options={chartOptions} />
                  ) : (
                    <Pie data={chartData} options={chartOptions} />
                  )}
                </div>
              )}
            </Card.Body>
          </Card>

          {frecuencias?.data?.length > 0 && (
            <Card>
              <Card.Header>Tabla de frecuencias</Card.Header>
              <Card.Body>
                <Table striped bordered hover responsive>
                  <thead>
                    <tr>
                      <th>Valor</th>
                      <th>Cantidad</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frecuencias.data.map((r, i) => {
                      const pct = frecuencias.total ? ((r.count * 100) / frecuencias.total).toFixed(1) : 0;
                      return (
                        <tr key={i}>
                          <td>{r.label}</td>
                          <td>{r.count}</td>
                          <td>{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th>{frecuencias.total}</th>
                      <th>100%</th>
                    </tr>
                  </tfoot>
                </Table>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  );
}
