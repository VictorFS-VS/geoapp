import React from 'react';
import {
    Chart as ChartJS,
    ArcElement,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend
} from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import { getPhaseHex, getPhaseBorderHex } from './gv_colors';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function GVCharts({ dashboard, onCompositionSelect, onMejoraPhaseSelect, onTerrenoPhaseSelect, hierarchyBar }) {
    if (!dashboard) return null;

    const { by_tipo = {}, phases = {} } = dashboard;

    const pieData = {
        labels: ['Mejora', 'Terreno'],
        datasets: [
            {
                data: [by_tipo.mejora || 0, by_tipo.terreno || 0],
                backgroundColor: ['#3b82f6', '#facc15'],
                borderColor: ['#2563eb', '#eab308'],
                borderWidth: 1,
            },
        ],
    };

    const compositionLabels = ['mejora', 'terreno'];

    const pieOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
            legend: {
                position: 'bottom',
                onClick: (e, legendItem, legend) => {
                    const idx = legendItem.index;
                    const tipo = compositionLabels[idx];
                    if (tipo && onCompositionSelect) {
                        onCompositionSelect(tipo);
                    }
                }
            }
        },
        onClick: (event, elements) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            const tipo = compositionLabels[idx];
            if (tipo && onCompositionSelect) {
                onCompositionSelect(tipo);
            }
        },
        onHover: (event, chartElement) => {
            const target = event?.native?.target || event?.chart?.canvas;
            if (target) {
                target.style.cursor = chartElement[0] ? 'pointer' : 'default';
            }
        }
    };

    const buildBarData = (tipoData, title) => {
        // Si no hay datos (ej. proyecto vacío), hacemos fallback a array vacío de 0s
        // Para simplificar, si no hay array counts o es vacio, asumimos N=5 por ejemplo o 0
        const N = tipoData?.N || 0;
        let counts = tipoData?.counts || [];

        if (counts.length === 0 && N > 0) {
            counts = new Array(N + 1).fill(0);
        }

        const labels = counts.map((_, i) => (i === N && N > 0) ? 'FINAL' : `F${i}`);

        const bgColors = counts.map((_, i) => getPhaseHex(i, N));
        const borderColors = counts.map((_, i) => getPhaseBorderHex(i) || getPhaseHex(i, N));

        return {
            labels,
            datasets: [
                {
                    label: `Expedientes (${title})`,
                    data: counts,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                }
            ]
        };
    };

    const barMejoraData = buildBarData(phases.mejora, 'Mejora');
    const barTerrenoData = buildBarData(phases.terreno, 'Terreno');

    const hierarchyEnabled = !!hierarchyBar;
    const hierarchyLabels = Array.isArray(hierarchyBar?.labels) ? hierarchyBar.labels : [];
    const selectedIdxRaw = hierarchyEnabled && Number.isFinite(hierarchyBar?.selectedIndex) ? hierarchyBar.selectedIndex : null;
    const selectedIdx = selectedIdxRaw !== null && selectedIdxRaw >= 0 ? selectedIdxRaw : null;
    const hierarchyCensados = Array.isArray(hierarchyBar?.censados) ? hierarchyBar.censados : [];
    const hierarchyUniverso = Array.isArray(hierarchyBar?.universo) ? hierarchyBar.universo : [];
    const hierarchyPct = Array.isArray(hierarchyBar?.pct) ? hierarchyBar.pct : [];

    const censadosColors = hierarchyLabels.map((_, i) => {
        if (selectedIdx === null || selectedIdx === undefined) return "#f59e0b";
        return i === selectedIdx ? "#f59e0b" : "rgba(245, 158, 11, 0.35)";
    });

    const universoColors = hierarchyLabels.map((_, i) => {
        if (selectedIdx === null || selectedIdx === undefined) return "rgba(13, 110, 253, 0.45)";
        return i === selectedIdx ? "rgba(13, 110, 253, 0.85)" : "rgba(13, 110, 253, 0.2)";
    });

    const hierarchyData = hierarchyEnabled ? {
        labels: hierarchyLabels,
        datasets: [
            {
                label: "Avance (%)",
                data: hierarchyPct,
                backgroundColor: censadosColors,
                borderColor: "#f59e0b",
                borderWidth: 1,
            }
        ]
    } : null;

    const barOptionsBase = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            y: {
                beginAtZero: true,
                min: 0,
                max: 100,
                ticks: { stepSize: 10 }
            }
        },
        plugins: {
            legend: { display: false }
        }
    };

    const hierarchyOptions = {
        ...barOptionsBase,
        plugins: {
            legend: { display: false }
        },
        onClick: (event, elements) => {
            if (!hierarchyEnabled || !elements || !elements.length) return;
            const idx = elements[0].index;
            if (hierarchyBar?.onBarClick) hierarchyBar.onBarClick(idx);
        },
        interaction: {
            mode: "index",
            intersect: true,
        },
        onHover: (event, elements) => {
            const target = event?.native?.target || event?.chart?.canvas;
            if (target) {
                target.style.cursor = elements && elements.length ? "pointer" : "default";
            }
        },
    };

    const mejoraOptions = {
        ...barOptionsBase,
        onClick: (event, elements, chart) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            if (onMejoraPhaseSelect) onMejoraPhaseSelect(idx);
        },
        interaction: {
            mode: "index",
            intersect: true,
        },
        onHover: (event, elements) => {
            const target = event?.native?.target || event?.chart?.canvas;
            if (target) {
                target.style.cursor = elements && elements.length ? "pointer" : "default";
            }
        },
    };

    const terrenoOptions = {
        ...barOptionsBase,
        onClick: (event, elements, chart) => {
            if (!elements || !elements.length) return;
            const idx = elements[0].index;
            if (onTerrenoPhaseSelect) onTerrenoPhaseSelect(idx);
        },
        interaction: {
            mode: "index",
            intersect: true,
        },
        onHover: (event, elements) => {
            const target = event?.native?.target || event?.chart?.canvas;
            if (target) {
                target.style.cursor = elements && elements.length ? "pointer" : "default";
            }
        },
    };

    return (
        <div className="mt-4">
            {hierarchyEnabled && (
                <div className="row g-4 mb-4">
                    <div className="col-12">
                        <div className="card shadow-sm h-100">
                            <div className="card-body">
                                <h5 className="card-title text-center text-secondary mb-3">{hierarchyBar.title || "Jerarquía"}</h5>
                                <div className="gv-chartWrap gv-chart-box" style={{ minHeight: 260 }}>
                                    {hierarchyData && hierarchyData.labels.length > 0 ? (
                                        <Bar
                                            data={hierarchyData}
                                            options={hierarchyOptions}
                                        />
                                    ) : (
                                        <div className="d-flex h-100 align-items-center justify-content-center text-muted">
                                            Sin datos
                                        </div>
                                    )}
                                </div>
                                {hierarchyLabels.length > 0 && (
                                    <div className="mt-3 small">
                                        {hierarchyLabels.map((label, i) => {
                                            const cens = hierarchyCensados[i] ?? 0;
                                            const uni = hierarchyUniverso[i] ?? 0;
                                            const pct = hierarchyPct[i] ?? 0;
                                            const isActive = selectedIdx !== null && i === selectedIdx;
                                            return (
                                                <div key={`${label}-${i}`} className={`d-flex justify-content-between ${isActive ? "fw-semibold" : ""}`}>
                                                    <span>{label}</span>
                                                    <span>{cens} / {uni} ({pct.toFixed(1)}%)</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="row g-4">
                {/* Card 1: Composición */}
                <div className="col-md-4">
                    <div className="card shadow-sm h-100">
                        <div className="card-body">
                            <h5 className="card-title text-center text-secondary mb-3">Composición</h5>
                            <div className="gv-chartWrap gv-chartWrap--donut gv-chart-box">
                                <Pie
                                    data={pieData}
                                    options={pieOptions}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card 2: Fases — Mejora */}
                <div className="col-md-4">
                    <div className="card shadow-sm h-100">
                        <div className="card-body">
                            <h5 className="card-title text-center text-secondary mb-3">Fases — Mejora</h5>
                            <div className="gv-chartWrap gv-chart-box">
                                {barMejoraData && barMejoraData.labels.length > 0 ? (
                                    <Bar
                                        data={barMejoraData}
                                        options={mejoraOptions}
                                    />
                                ) : (
                                    <div className="d-flex h-100 align-items-center justify-content-center text-muted">
                                        Sin datos
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Card 3: Fases — Terreno */}
                <div className="col-md-4">
                    <div className="card shadow-sm h-100">
                        <div className="card-body">
                            <h5 className="card-title text-center text-secondary mb-3">Fases — Terreno</h5>
                            <div className="gv-chartWrap gv-chart-box">
                                {barTerrenoData && barTerrenoData.labels.length > 0 ? (
                                    <Bar
                                        data={barTerrenoData}
                                        options={terrenoOptions}
                                    />
                                ) : (
                                    <div className="d-flex h-100 align-items-center justify-content-center text-muted">
                                        Sin datos
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
