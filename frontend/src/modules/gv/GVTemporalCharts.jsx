import React, { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function buildDetalleSeries(detalle) {
  const series = Array.isArray(detalle?.series) ? detalle.series : [];
  const bucketMap = new Map();

  for (const s of series) {
    for (const d of s.data || []) {
      if (!bucketMap.has(d.bucket)) {
        bucketMap.set(d.bucket, d.label || d.bucket);
      }
    }
  }

  const bucketKeys = Array.from(bucketMap.keys()).sort((a, b) => a.localeCompare(b));
  const labels = bucketKeys.map((k) => bucketMap.get(k));

  const datasets = series.map((s, idx) => {
    const byBucket = new Map();
    for (const d of s.data || []) {
      byBucket.set(d.bucket, Number(d.count) || 0);
    }
    const data = bucketKeys.map((k) => byBucket.get(k) || 0);
    const color = idx % 2 === 0 ? "#2563eb" : "#f59e0b";
    return {
      label: s.label || s.key,
      data,
      backgroundColor: color,
    };
  });

  return { labels, datasets };
}

export default function GVTemporalCharts({
  avance,
  detalle,
  selectedCategoria,
  modoDetalle,
  onSelectCategoria,
  isFiltered,
  loadingAvance,
  loadingDetalle,
  errorAvance,
  errorDetalle,
}) {
  const [isAvanceOpen, setIsAvanceOpen] = useState(true);
  const [isDetalleOpen, setIsDetalleOpen] = useState(() => Boolean(selectedCategoria));

  useEffect(() => {
    if (selectedCategoria) {
      setIsDetalleOpen(true);
    }
  }, [selectedCategoria]);

  const buckets = Array.isArray(avance?.buckets) ? avance.buckets : [];
  const labels = buckets.map((b) => b.label || b.key);
  const mejoraData = buckets.map((b) => Number(b.mejora) || 0);
  const terrenoData = buckets.map((b) => Number(b.terreno) || 0);
  const totalBuckets = buckets.length;

  const avanceData = {
    labels,
    datasets: [
      { label: "Mejora", data: mejoraData, backgroundColor: "#2563eb" },
      { label: "Terreno", data: terrenoData, backgroundColor: "#f59e0b" },
    ],
  };

  const avanceOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" } },
    onClick: (_evt, elements) => {
      if (!elements || !elements.length) return;
      const idx = elements[0].datasetIndex;
      if (idx === 0 && onSelectCategoria) {
        onSelectCategoria("mejora");
        setIsDetalleOpen(true);
      }
      if (idx === 1 && onSelectCategoria) {
        onSelectCategoria("terreno");
        setIsDetalleOpen(true);
      }
    },
  };

  const detalleData = buildDetalleSeries(detalle);
  const totalSeries = Array.isArray(detalle?.series) ? detalle.series.length : 0;
  const detalleOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom" } },
  };

  return (
    <div className="d-flex flex-column gap-3">
      <div className="border rounded">
        <button
          type="button"
          className="btn btn-link text-decoration-none w-100 d-flex justify-content-between align-items-center px-2 py-2"
          onClick={() => setIsAvanceOpen((v) => !v)}
        >
          <span className="fw-semibold">
            {isAvanceOpen ? "v" : ">"} Avance por categoria
          </span>
          <span className="text-muted small">
            {totalBuckets > 0 ? `${totalBuckets} periodos` : "Sin datos"}
          </span>
        </button>
        {isAvanceOpen && (
          <div className="px-2 pb-2">
            {errorAvance && <div className="text-danger small mb-2">{errorAvance}</div>}
            {loadingAvance && <div className="text-muted small mb-2">Cargando...</div>}
            {!loadingAvance && !errorAvance && buckets.length === 0 ? (
              <div className="text-muted small">
                {isFiltered
                  ? "Sin datos para el rango y filtros actuales. Proba ajustar rango, tramo o subtramo."
                  : "Sin datos para el rango seleccionado. Proba ajustar el rango."}
              </div>
            ) : null}
            {!loadingAvance && !errorAvance && buckets.length > 0 ? (
              <div style={{ height: 180 }}>
                <Bar data={avanceData} options={avanceOptions} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="border rounded">
        <button
          type="button"
          className="btn btn-link text-decoration-none w-100 d-flex justify-content-between align-items-center px-2 py-2"
          onClick={() => setIsDetalleOpen((v) => !v)}
        >
          <span className="fw-semibold">
            {isDetalleOpen ? "v" : ">"} Detalle temporal ({modoDetalle})
          </span>
          <span className="text-muted small">
            {selectedCategoria
              ? `${selectedCategoria === "mejora" ? "Mejora" : "Terreno"} · ${totalSeries} series`
              : "Sin categoria"}
          </span>
        </button>
        {isDetalleOpen && (
          <div className="px-2 pb-2">
            {errorDetalle && <div className="text-danger small mb-2">{errorDetalle}</div>}
            {loadingDetalle && <div className="text-muted small mb-2">Cargando...</div>}
            {!loadingDetalle && !errorDetalle && detalleData.labels.length === 0 ? (
              <div className="text-muted small">
                {isFiltered
                  ? "Sin detalle para la categoria con los filtros actuales. Proba ajustar rango, tramo o subtramo."
                  : "Sin detalle disponible para la categoria. Proba seleccionar otra categoria."}
              </div>
            ) : null}
            {!loadingDetalle && !errorDetalle && detalleData.labels.length > 0 ? (
              <div style={{ height: 200 }}>
                <Bar data={detalleData} options={detalleOptions} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
