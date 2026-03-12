import React, { useEffect, useState } from "react";
import { Bar, Pie } from "react-chartjs-2";

export default function DynamicEncuestaChart({ id_proyecto }) {
  const [allEncuestas, setAllEncuestas] = useState([]);
  const [tramos, setTramos] = useState([]);
  const [metric, setMetric] = useState("total"); // total | percepcion | interes
  const [tramoSel, setTramoSel] = useState("Todos");
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });

  // 1) Fetch geojson con todas las encuestas
  useEffect(() => {
    async function fetchData() {
      const res = await fetch(`${process.env.VITE_API_URL}/encuestas/mapa/${id_proyecto}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const geojson = await res.json();
      const feats = geojson.features.map(f => f.properties);
      setAllEncuestas(feats);
      setTramos([ "Todos", ...Array.from(new Set(feats.map(f => f.tramo))) ]);
    }
    fetchData();
  }, [id_proyecto]);

  // 2) Recalcula chartData al cambiar métrica o tramo
  useEffect(() => {
    const filtradas = tramoSel === "Todos"
      ? allEncuestas
      : allEncuestas.filter(f => f.tramo === tramoSel);

    let labels = [], data = [];
    if (metric === "total") {
      const byTramo = filtradas.reduce((acc,f) => {
        acc[f.tramo] = (acc[f.tramo]||0) + 1; return acc;
      }, {});
      labels = Object.keys(byTramo);
      data   = Object.values(byTramo);
    }
    else if (metric === "percepcion") {
      const byPerc = filtradas.reduce((acc,f) => {
        const p = f.percepcion.toUpperCase();
        acc[p] = (acc[p]||0) + 1; return acc;
      }, {});
      labels = Object.keys(byPerc);
      data   = Object.values(byPerc);
    }
    else if (metric === "interes") {
      const byInt = filtradas.reduce((acc,f) => {
        const k = f.interes_reubicacion ? "Sí" : "No";
        acc[k] = (acc[k]||0) + 1; return acc;
      }, {});
      labels = Object.keys(byInt);
      data   = Object.values(byInt);
    }

    setChartData({ labels, datasets: [{ label: metric, data }] });
  }, [metric, tramoSel, allEncuestas]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select value={metric} onChange={e => setMetric(e.target.value)}>
          <option value="total">Total por tramo</option>
          <option value="percepcion">Percepción</option>
          <option value="interes">Interés reubicación</option>
        </select>
        <select value={tramoSel} onChange={e => setTramoSel(e.target.value)}>
          {tramos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {metric === "total"
        ? <Bar data={chartData} options={{ responsive: true }} />
        : <Pie data={chartData} options={{ responsive: true, plugins: { legend: { position: "bottom" } } }} />
      }
    </div>
  );
}
