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
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const totales = data?.totales || {};
  const groupByTipo = Array.isArray(data?.groupByTipo) ? data.groupByTipo : [];
  const groupByTramo = Array.isArray(data?.groupByTramo) ? data.groupByTramo : [];
  const groupBySubtramo = Array.isArray(data?.groupBySubtramo) ? data.groupBySubtramo : [];

  const tipoChart = useMemo(
    () => buildBarData(groupByTipo, "label", "total_final", "Total final"),
    [groupByTipo]
  );
  const tramoChart = useMemo(
    () => buildBarData(groupByTramo, "label", "total_final", "Total final"),
    [groupByTramo]
  );
  const subtramoTotals = useMemo(() => {
    return groupBySubtramo.reduce(
      (acc, item) => ({
        expedientes_total: acc.expedientes_total + (Number(item.expedientes_total) || 0),
        expedientes_con_avaluo: acc.expedientes_con_avaluo + (Number(item.expedientes_con_avaluo) || 0),
        total_parte_a: acc.total_parte_a + (Number(item.total_parte_a) || 0),
        total_parte_b: acc.total_parte_b + (Number(item.total_parte_b) || 0),
        total_base: acc.total_base + (Number(item.total_base) || 0),
        total_incentivo: acc.total_incentivo + (Number(item.total_incentivo) || 0),
        total_final: acc.total_final + (Number(item.total_final) || 0),
      }),
      {
        expedientes_total: 0,
        expedientes_con_avaluo: 0,
        total_parte_a: 0,
        total_parte_b: 0,
        total_base: 0,
        total_incentivo: 0,
        total_final: 0,
      }
    );
  }, [groupBySubtramo]);

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="mb-0">Panel economico</h5>
          {loading && <span className="text-muted small">Cargando...</span>}
        </div>

        {error && <div className="text-danger small mb-3">{error}</div>}

        {!loading && !error && (!data || !totales) && (
          <div className="text-muted small">Sin datos economicos disponibles.</div>
        )}

        {!!data && (
          <>
            {contextLabel && (
              <div className="text-muted small mb-3">{contextLabel}</div>
            )}
            <div className="row g-3 mb-3">
              <div className="col-md-3"><KpiCard label="Expedientes totales" value={formatNumber(totales.expedientes_total)} /></div>
              <div className="col-md-3"><KpiCard label="Expedientes con avaluo" value={formatNumber(totales.expedientes_con_avaluo)} /></div>
              <div className="col-md-3"><KpiCard label="Total Mejoras agroforestales / Fraccion afectada (Parte A)" value={formatMoney(totales.total_parte_a)} /></div>
              <div className="col-md-3"><KpiCard label="Total Mejoras edilicias / Gastos de transferencia (Parte B)" value={formatMoney(totales.total_parte_b)} /></div>
              <div className="col-md-4"><KpiCard label="Total base" value={formatMoney(totales.total_base)} /></div>
              <div className="col-md-4"><KpiCard label="Total incentivo" value={formatMoney(totales.total_incentivo)} /></div>
              <div className="col-md-4"><KpiCard label="Total final" value={formatMoney(totales.total_final)} /></div>
              <div className="col-md-6"><KpiCard label="Promedio base por expediente con avaluo" value={formatMoney(totales.promedio_base_por_expediente_con_avaluo)} /></div>
              <div className="col-md-6"><KpiCard label="Promedio final por expediente con avaluo" value={formatMoney(totales.promedio_final_por_expediente_con_avaluo)} /></div>
            </div>

            <div className="border rounded">
              <button
                type="button"
                className="btn btn-link text-decoration-none w-100 d-flex justify-content-between align-items-center px-3 py-2"
                onClick={() => setIsDetailOpen((v) => !v)}
              >
                <span className="fw-semibold">{isDetailOpen ? "v" : ">"} Detalle economico</span>
                <span className="text-muted small">
                  {groupByTipo.length} tipos / {groupByTramo.length} tramos / {groupBySubtramo.length} subtramos
                </span>
              </button>

              {isDetailOpen && (
                <div className="px-3 pb-3">
                  <div className="text-muted small mb-3">
                    A = Mejoras agroforestales / Fraccion afectada. B = Mejoras edilicias / Gastos de transferencia.
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">Total final por tipo</div>
                        {groupByTipo.length === 0 ? (
                          <div className="text-muted small">Sin datos por tipo.</div>
                        ) : (
                          <div style={{ height: 220 }}>
                            <Bar data={tipoChart} options={{ responsive: true, maintainAspectRatio: false }} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="col-md-6">
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">Total final por tramo</div>
                        {groupByTramo.length === 0 ? (
                          <div className="text-muted small">Sin datos por tramo.</div>
                        ) : (
                          <div style={{ height: 220 }}>
                            <Bar data={tramoChart} options={{ responsive: true, maintainAspectRatio: false }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {groupBySubtramo.length > 0 && (
                    <div className="mt-3">
                      <div className="fw-semibold mb-2">Subtramos</div>
                      <div className="table-responsive">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Subtramo</th>
                              <th className="text-end">Expedientes</th>
                              <th className="text-end">Con avaluo</th>
                              <th className="text-end">A</th>
                              <th className="text-end">B</th>
                              <th className="text-end">Base</th>
                              <th className="text-end">Incentivo</th>
                              <th className="text-end">Final</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupBySubtramo.map((r) => (
                              <tr key={`${r.id_sub_tramo}-${r.label}`}>
                                <td>{r.label}</td>
                                <td className="text-end">{formatNumber(r.expedientes_total)}</td>
                                <td className="text-end">{formatNumber(r.expedientes_con_avaluo)}</td>
                                <td className="text-end">{formatMoney(r.total_parte_a)}</td>
                                <td className="text-end">{formatMoney(r.total_parte_b)}</td>
                                <td className="text-end">{formatMoney(r.total_base)}</td>
                                <td className="text-end">{formatMoney(r.total_incentivo)}</td>
                                <td className="text-end">{formatMoney(r.total_final)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="table-light fw-semibold">
                              <td>Totales</td>
                              <td className="text-end">{formatNumber(subtramoTotals.expedientes_total)}</td>
                              <td className="text-end">{formatNumber(subtramoTotals.expedientes_con_avaluo)}</td>
                              <td className="text-end">{formatMoney(subtramoTotals.total_parte_a)}</td>
                              <td className="text-end">{formatMoney(subtramoTotals.total_parte_b)}</td>
                              <td className="text-end">{formatMoney(subtramoTotals.total_base)}</td>
                              <td className="text-end">{formatMoney(subtramoTotals.total_incentivo)}</td>
                              <td className="text-end">{formatMoney(subtramoTotals.total_final)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
