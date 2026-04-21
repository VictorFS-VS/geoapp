import React, { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";

function formatMoney(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n);
}

function formatNumber(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n);
}

function buildBarData(items, labelKey = "label", valueKey = "total_final", title = "") {
  const list = Array.isArray(items) ? items : [];
  const labels = list.map((r) => r[labelKey] || "-");
  const data = list.map((r) => Number(r[valueKey]) || 0);
  return {
    labels,
    datasets: [
      {
        label: title,
        data,
        backgroundColor: "#16a34a",
      },
    ],
  };
}

function KpiCard({ label, value }) {
  return (
    <div className="p-3 border rounded h-100">
      <div className="text-muted small">{label}</div>
      <div className="fs-6 fw-semibold">{value}</div>
    </div>
  );
}

export default function GVEconomicPanel({ data, loading, error, contextLabel }) {
  const totales = data?.totales || {};

  if (loading) return (
    <div className="card border-0 shadow-sm rounded-4 mt-4 gv-economic-section d-flex align-items-center justify-content-center" style={{ minHeight: "200px" }}>
      <div className="spinner-border text-primary opacity-25" role="status"></div>
    </div>
  );

  if (error) return (
    <div className="card border-0 shadow-sm rounded-4 mt-4 gv-economic-section gv-alert-soft">
      <i className="bi bi-exclamation-octagon-fill me-2"></i> Error al cargar datos económicos: {error}
    </div>
  );

  if (!data || !totales || Object.keys(totales).length === 0) return (
    <div className="card border-0 shadow-sm rounded-4 mt-4 gv-economic-section text-center py-5">
      <i className="bi bi-cash-stack display-4 text-muted opacity-25 mb-3"></i>
      <div className="text-secondary fw-medium">No hay datos económicos para esta selección.</div>
    </div>
  );

  return (
    <div className="mt-4 gv-economic-section">
      <div className="d-flex justify-content-between align-items-end mb-4 px-2">
        <div>
          <h4 className="fw-bold text-dark mb-1">Inversión de Notificaciones</h4>
          <p className="text-secondary small mb-0 fw-medium">Resumen Valorativo del Proyecto | {contextLabel || "Visión Global"}</p>
        </div>
        <div className="badge bg-white shadow-sm text-dark border-0 rounded-pill px-3 py-2 fw-bold small">
            Informe Económico
          <div className="gv-financial-card">
            <h6 className="gv-money-group-title mb-4 pb-2 border-bottom small fw-bold text-secondary text-uppercase" style={{ letterSpacing: "0.05em" }}>Valoración por Componente</h6>
            
            <div className="mb-4">
              <div className="gv-money-label">Mejoras Agroforestales (Parte A)</div>
              <div className="gv-money-value fs-4">{formatMoney(totales.total_parte_a)}</div>
              <div className="small text-muted mt-1">Fracción afectada y cultivos</div>
            </div>

            <div>
              <div className="gv-money-label">Mejoras Edilicias (Parte B)</div>
              <div className="gv-money-value fs-4">{formatMoney(totales.total_parte_b)}</div>
              <div className="small text-muted mt-1">Gastos de transferencia y estructuras</div>
            </div>
            
            <div className="mt-auto pt-4 border-top">
               <div className="d-flex justify-content-between align-items-center">
                  <span className="small text-secondary fw-medium">Expedientes con Avalúo:</span>
                  <span className="badge bg-primary bg-opacity-10 text-primary fw-bold rounded-pill px-2">{formatNumber(totales.expedientes_con_avaluo)}</span>
               </div>
            </div>
          </div>
        </div>

        {/* GRUPO B: RESUMEN MONETARIO (THE CORE) */}
        <div className="col-lg-4">
          <div className="gv-financial-card border-primary border-opacity-25" style={{ background: "#F1F5F9" }}>
            <h6 className="gv-money-group-title mb-4 pb-2 border-bottom border-primary border-opacity-10 small fw-bold text-primary text-uppercase" style={{ letterSpacing: "0.05em" }}>Resumen de Notificaciones</h6>
            
            <div className="mb-4">
              <div className="gv-money-label text-primary">Inversión Base</div>
              <div className="gv-money-value text-dark">{formatMoney(totales.total_base)}</div>
            </div>

            <div className="mb-4">
              <div className="gv-money-label text-primary d-flex justify-content-between">
                Incentivo Estratégico
                <span className="gv-incentive-badge">Bonificación</span>
              </div>
              <div className="gv-money-value text-dark">{formatMoney(totales.total_incentivo)}</div>
            </div>

            <div className="mt-auto pt-4 border-top border-primary border-opacity-10">
              <div className="gv-money-label text-primary fw-bolder">Total Final Invertido</div>
              <div className="gv-hero-total">{formatMoney(totales.total_final)}</div>
              <div className="small text-muted fw-medium mt-1">Monto total a ser liquidado</div>
            </div>
          </div>
        </div>

        {/* GRUPO C: INDICADORES DE EFICIENCIA */}
        <div className="col-lg-4">
          <div className="gv-financial-card">
            <h6 className="gv-money-group-title mb-4 pb-2 border-bottom small fw-bold text-secondary text-uppercase" style={{ letterSpacing: "0.05em" }}>Indicadores de Eficiencia</h6>
            
            <div className="mb-4">
              <div className="gv-money-label">Promedio Base por Expediente</div>
              <div className="gv-money-value fs-5">{formatMoney(totales.promedio_base_por_expediente_con_avaluo)}</div>
            </div>

            <div className="mb-4">
              <div className="gv-money-label">Promedio Final por Expediente</div>
              <div className="gv-money-value fs-5 text-primary">{formatMoney(totales.promedio_final_por_expediente_con_avaluo)}</div>
            </div>

            <div className="mt-auto p-3 bg-light rounded-3">
               <div className="d-flex align-items-center gap-2 mb-1">
                  <i className="bi bi-info-circle-fill text-primary"></i>
                  <span className="small fw-bold text-dark">Dato de Gestión</span>
               </div>
               <p className="mb-0 text-muted" style={{ fontSize: "0.75rem", lineHeight: "1.2" }}>
                  Métricas calculadas sobre el universo de expedientes con avalúo técnico validado.
               </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
