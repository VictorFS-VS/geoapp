import React from "react";
import { Table, Badge, Button, OverlayTrigger, Tooltip } from "react-bootstrap";

const getClasificacionColor = (clasificacion) => {
  const c = String(clasificacion || "").toLowerCase();
  if (c.includes("crítico") || c.includes("critico")) return { bg: "danger", icon: "🔴", text: "CRÍTICO", dot: "🔴" };
  if (c.includes("alto") || c.includes("vulnerable")) return { bg: "danger", icon: "🟠", text: "ALTO", dot: "🟠" };
  if (c.includes("medio") || c.includes("alerta")) return { bg: "warning", icon: "🟡", text: "MEDIO", dot: "🟡" };
  if (c.includes("bajo") || c.includes("seguro")) return { bg: "success", icon: "🟢", text: "BAJO", dot: "🟢" };
  return { bg: "secondary", icon: "⚪", text: clasificacion || "N/D", dot: "⚪" };
};

const formatearFecha = (iso) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-PY", { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function InformesTableDiagnostico({
  informes,
  onSort,
  renderSortIcon,
  setIdRegistroSel,
  setShowScoringModal,
  handleGenerar,
  abrirVer,
  formulaActiva,
}) {
  return (
    <div className="table-responsive shadow-sm rounded border">
      <Table hover size="sm" className="mb-0 bg-white" style={{ tableLayout: 'fixed', minWidth: '1200px' }}>
        <thead className="table-light text-uppercase text-muted" style={{ fontSize: '0.7rem', letterSpacing: '0.05em' }}>
          <tr>
            <th style={{ width: '80px' }} className="ps-3 py-3">ID</th>
            <th 
              style={{ width: '100px', cursor: 'pointer' }} 
              className="text-center py-3" 
              onClick={() => onSort && onSort("score_total")}
            >
              Puntaje {renderSortIcon && renderSortIcon("score_total")}
            </th>
            <th style={{ width: '120px' }} className="text-center py-3">Autodiagnóstico</th>
            <th 
              style={{ width: '250px', cursor: 'pointer' }} 
              className="py-3"
              onClick={() => onSort && onSort("diferencia")}
            >
              Resultado Final {renderSortIcon && renderSortIcon("diferencia")}
            </th>
            <th style={{ width: '180px' }} className="py-3">Consultor</th>
            <th style={{ width: '140px' }} className="py-3">Fecha Revisión</th>
            <th style={{ width: '320px' }} className="text-center pe-3 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody style={{ fontSize: '0.85rem' }}>
          {informes.map((inf) => {
            const resps = inf.respuestas_clave || {};
            const autoData = getClasificacionColor(inf.clasificacion);
            const consultData = inf.resultado_consultor ? getClasificacionColor(inf.resultado_consultor) : null;
            const hayDiferencia = !!(inf.resultado_consultor && inf.resultado_consultor !== inf.clasificacion);
            
            let indicatorColor = "text-muted";
            let indicatorIcon = "bi-circle";
            if (inf.resultado_consultor) {
              indicatorColor = hayDiferencia ? "text-danger" : "text-success";
              indicatorIcon = hayDiferencia ? "bi-record-circle-fill" : "bi-check-circle-fill";
            }

            const isOutdated = 
              formulaActiva && 
              inf.version_formula != null && 
              Number(inf.version_formula) < Number(formulaActiva.version);

            return (
              <tr key={inf.id_informe}>
                <td className="ps-3 align-middle py-2">
                  <Badge bg="secondary" className="fw-normal">#{inf.id_informe}</Badge>
                </td>
                <td className="text-center fw-bold text-primary align-middle py-2">
                  <div className="d-flex flex-column align-items-center">
                    <span>{inf.score_total != null ? Number(inf.score_total).toFixed(1) : "-"}</span>
                    {isOutdated && (
                      <OverlayTrigger
                        placement="bottom"
                        overlay={<Tooltip>Resultados calculados con versión antigua de la fórmula (V{inf.version_formula}). Se recomienda volver a evaluar para aplicar reglas V{formulaActiva.version}.</Tooltip>}
                      >
                        <Badge bg="warning" text="dark" className="mt-1" style={{ fontSize: '0.6rem', cursor: 'help' }}>
                          <i className="bi bi-exclamation-triangle-fill me-1"></i>V{inf.version_formula}
                        </Badge>
                      </OverlayTrigger>
                    )}
                  </div>
                </td>
                <td className="text-center align-middle py-2">
                   <Badge bg={autoData.bg} className="px-2" style={{ minWidth: '70px' }}>{autoData.text}</Badge>
                </td>
                <td className="align-middle py-2">
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip>
                        {inf.manual_override ? `Evaluación Manual: ${consultData.text}` : `Cálculo Automático: ${autoData.text}`}
                        {hayDiferencia && " (DIFERENCIA DETECTADA)"}
                      </Tooltip>
                    }
                  >
                    <div className="d-flex align-items-center gap-2">
                      <i className={`bi ${indicatorIcon} ${indicatorColor} fs-5`}></i>
                      <div className={`px-2 py-1 rounded small fw-bold border shadow-sm ${
                        hayDiferencia 
                          ? 'bg-danger text-white border-danger animate-pulse' 
                          : inf.manual_override 
                            ? 'bg-warning text-dark border-warning' 
                            : 'bg-light text-muted border-secondary-subtle'
                      }`}>
                        {inf.manual_override ? consultData.text : autoData.text}
                      </div>
                    </div>
                  </OverlayTrigger>
                </td>
                <td className="text-truncate align-middle py-2" title={inf.evaluador_nombre}>
                  {inf.evaluador_nombre || <span className="text-muted opacity-50">-</span>}
                </td>
                <td className="text-muted align-middle py-2">
                  {formatearFecha(inf.fecha_manual_evaluacion || inf.fecha_revision_usuario)}
                </td>
                <td className="pe-3 align-middle py-2">
                  <div className="d-flex justify-content-center gap-2">
                    <Button 
                      variant="outline-primary" 
                      size="sm" 
                      className="py-1 px-2 shadow-sm" 
                      onClick={() => abrirVer(inf.id_informe)} 
                      title="Ver Informe"
                    >
                      <i className="bi bi-eye me-1"></i> Ver
                    </Button>
                    <Button 
                      variant="primary" 
                      size="sm" 
                      className="py-1 px-2 shadow-sm"
                      onClick={() => {
                        setIdRegistroSel(inf.id_registro);
                        setShowScoringModal(true);
                      }}
                      title="Panel de Auditoría"
                    >
                      <i className="bi bi-brain me-1"></i> Auditar
                    </Button>
                    <Button 
                      variant="outline-warning" 
                      size="sm" 
                      className="py-1 px-2 shadow-sm"
                      onClick={() => handleGenerar(inf.id_informe)}
                      title="Recalcular Scoring"
                    >
                      <i className="bi bi-arrow-repeat me-1"></i> Recalcular
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
