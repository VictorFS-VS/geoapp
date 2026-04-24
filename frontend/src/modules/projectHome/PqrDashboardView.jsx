import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Row, Col, Card, Spinner } from "react-bootstrap";
import { FaClock, FaBullhorn, FaCheckCircle, FaExclamationCircle } from "react-icons/fa";

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#64748b"];

export default function PqrDashboardView({ projectId, apiUrl, authHeader }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    async function fetchStats() {
      try {
        setLoading(true);
        const res = await fetch(`${apiUrl}/quejas-reclamos/stats?id_proyecto=${projectId}`, {
          headers: authHeader()
        });
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching PQR stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [projectId, apiUrl, authHeader]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" variant="primary" /></div>;
  if (!stats) return <div className="text-center py-5">No se pudieron cargar las estadísticas.</div>;

  const pieData = stats.estados.map(s => ({ name: s.estado.charAt(0).toUpperCase() + s.estado.slice(1), value: s.count }));
  const barData = stats.tipologias.map(t => ({ name: (t.tipologia || "Otros").substring(0, 15), count: t.count }));

  const total = stats.estados.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="pqr-dashboard-view">
      <Row className="g-4 mb-4">
        <Col md={4}>
          <Card className="ph-health-card" style={{ height: '100%' }}>
            <Card.Body>
              <div className="ph-health-header">
                <span className="ph-health-title">Total de Quejas</span>
                <span className="ph-health-badge" style={{ background: "#3b82f615", color: "#3b82f6" }}><FaBullhorn /></span>
              </div>
              <div className="ph-health-hero">
                <span className="ph-health-value">{total}</span>
                <span className="ph-health-label">Registros históricos</span>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="ph-health-card" style={{ height: '100%' }}>
            <Card.Body>
              <div className="ph-health-header">
                <span className="ph-health-title">Tiempo de Respuesta</span>
                <span className="ph-health-badge" style={{ background: "#8b5cf615", color: "#8b5cf6" }}><FaClock /></span>
              </div>
              <div className="ph-health-hero">
                <span className="ph-health-value">{stats.promedio_respuesta}</span>
                <span className="ph-health-label">Días promedio (Cierre)</span>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="ph-health-card" style={{ height: '100%' }}>
            <Card.Body>
              <div className="ph-health-header">
                <span className="ph-health-title">Eficiencia Social</span>
                <span className="ph-health-badge" style={{ background: "#22c55e15", color: "#22c55e" }}><FaCheckCircle /></span>
              </div>
              <div className="ph-health-hero">
                <span className="ph-health-value">
                  {total > 0 ? Math.round(((stats.estados.find(s => s.estado === 'cerrado')?.count || 0) / total) * 100) : 0}%
                </span>
                <span className="ph-health-label">Resolución de casos</span>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-4">
        <Col md={5}>
          <Card className="ph-card shadow-sm">
            <Card.Body>
              <div className="ph-card-title mb-4">Distribución por Estado</div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={7}>
          <Card className="ph-card shadow-sm">
            <Card.Body>
              <div className="ph-card-title mb-4">Motivos más frecuentes (Tipologías)</div>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={barData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
