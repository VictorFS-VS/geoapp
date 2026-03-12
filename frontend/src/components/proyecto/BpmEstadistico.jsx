//src/components/proyecto/BpmEstadistico.jsx
import React, { useMemo } from 'react';
import { Card } from 'react-bootstrap';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function daysBetween(a, b) {
  if (!a && !b) return 0;
  const A = a ? new Date(a) : new Date();
  const B = b ? new Date(b) : A;
  const ms = B - A;
  const d = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return isNaN(d) ? 0 : Math.max(1, d);
}

export default function BpmEstadistico({ evaluaciones = [] }) {
  // agrupamos por categoría y sumamos “duración” (fecha → fecha_final)
  const grouped = useMemo(() => {
    const g = {};
    evaluaciones.forEach(ev => {
      const key = ev.categoria || 'Sin categoría';
      const dur = daysBetween(ev.fecha, ev.fecha_final);
      g[key] = (g[key] || 0) + dur;
    });
    return g;
  }, [evaluaciones]);

  const labels = Object.keys(grouped);
  const values = labels.map(l => grouped[l]);

  const data = {
    labels,
    datasets: [
      {
        label: 'Días (duración acumulada)',
        data: values,
        borderWidth: 1
      }
    ]
  };

  const options = {
    indexAxis: 'y', // ← barras horizontales
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.parsed.x ?? ctx.parsed.y} días`
        }
      }
    },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0 } }
    }
  };

  return (
    <Card className="p-3" style={{ height: Math.max(240, labels.length * 44) }}>
      {labels.length ? (
        <Bar data={data} options={options} />
      ) : (
        <div className="text-center text-muted">No hay datos de evaluaciones para graficar.</div>
      )}
    </Card>
  );
}
