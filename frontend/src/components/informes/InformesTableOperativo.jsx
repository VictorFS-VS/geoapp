import React from "react";
import { Table, Badge, Button, Form } from "react-bootstrap";

const formatearFecha = (iso) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("es-PY", { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function InformesTableOperativo({
  informes,
  preguntasPlantilla,
  abrirVer,
  abrirEditar,
  eliminarInforme,
  descargarPdfInforme,
  puedeEditar,
  puedeEliminarAdmin,
  selectedIds = [],
  onToggleSelection,
  onSelectAll,
  allSelected = false,
}) {
  // Columnas fijas:
  // ID (80px), Plantilla (150px), Identificador (220px), Fecha (140px), Usuario (160px), Acciones (240px)
  
  const allVisible = preguntasPlantilla.filter(q => q.visible_en_listado);
  const visiblePreguntas = allVisible.slice(0, 1); // Limitamos a 1 para no romper el layout fijo en pantallas estándar

  return (
    <div className="table-responsive shadow-sm rounded border">
      <Table hover size="sm" className="mb-0 bg-white" style={{ tableLayout: 'fixed', minWidth: '1000px' }}>
        <thead className="table-light text-uppercase text-muted" style={{ fontSize: '0.7rem', letterSpacing: '0.05em' }}>
          <tr>
            <th style={{ width: '40px' }} className="ps-3 py-3 text-center">
              <Form.Check 
                type="checkbox" 
                checked={allSelected} 
                onChange={onSelectAll} 
              />
            </th>
            <th style={{ width: '80px' }} className="py-3">ID</th>
            <th style={{ width: '150px' }} className="py-3">Plantilla</th>
            <th style={{ width: '220px' }} className="py-3">Identificador</th>
            
            {visiblePreguntas.map(q => (
              <th key={q.id_pregunta} style={{ width: '150px' }} className="py-3">{q.etiqueta}</th>
            ))}

            <th style={{ width: '140px' }} className="py-3">Fecha</th>
            <th style={{ width: '160px' }} className="py-3">Usuario</th>
            <th style={{ width: '240px' }} className="text-center pe-3 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody style={{ fontSize: '0.85rem' }}>
          {informes.map((inf) => {
            const resps = inf.respuestas_clave || {};

            return (
              <tr key={inf.id_informe} className={selectedIds.includes(inf.id_informe) ? "table-active" : ""}>
                <td className="ps-3 align-middle text-center py-2">
                  <Form.Check 
                    type="checkbox" 
                    checked={selectedIds.includes(inf.id_informe)} 
                    onChange={() => onToggleSelection(inf.id_informe)} 
                  />
                </td>
                <td className="align-middle py-2">
                  <Badge bg="secondary" className="fw-normal">#{inf.id_informe}</Badge>
                </td>
                <td className="text-truncate align-middle py-2" title={inf.nombre_plantilla}>
                  {inf.nombre_plantilla}
                </td>
                <td className="fw-bold text-dark text-truncate align-middle py-2" style={{ maxWidth: '220px' }} title={Object.values(resps)[0]}>
                  {Object.values(resps)[0] || "-"}
                </td>

                {visiblePreguntas.map(q => (
                  <td key={q.id_pregunta} className="text-muted text-truncate align-middle py-2" title={resps[q.etiqueta]}>
                    {resps[q.etiqueta] || "-"}
                  </td>
                ))}

                <td className="text-muted align-middle py-2">
                  {formatearFecha(inf.fecha_creado)}
                </td>
                <td className="text-muted text-truncate align-middle py-2" title={inf.creado_por}>
                   <i className="bi bi-person me-1"></i> {inf.creado_por || "-"}
                </td>
                
                <td className="pe-3 align-middle py-2">
                  <div className="d-flex justify-content-center gap-1">
                    <Button variant="outline-primary" size="sm" className="py-1 px-2 border-0" onClick={() => abrirVer(inf.id_informe)}>
                      <i className="bi bi-eye"></i> <span className="d-none d-lg-inline">Ver</span>
                    </Button>
                    
                    {puedeEditar && (
                      <Button variant="outline-warning" size="sm" className="py-1 px-2 border-0" onClick={() => abrirEditar(inf.id_informe)}>
                        <i className="bi bi-pencil"></i> <span className="d-none d-lg-inline">Editar</span>
                      </Button>
                    )}

                    <Button variant="outline-secondary" size="sm" className="py-1 px-2 border-0" onClick={() => descargarPdfInforme(inf.id_informe)}>
                      <i className="bi bi-download"></i> <span className="d-none d-lg-inline">PDF</span>
                    </Button>

                    {puedeEliminarAdmin && (
                      <Button variant="danger" size="sm" className="py-1 px-2 shadow-sm" onClick={() => eliminarInforme(inf.id_informe)} title="Eliminar Informe">
                        <i className="bi bi-trash"></i>
                      </Button>
                    )}
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
