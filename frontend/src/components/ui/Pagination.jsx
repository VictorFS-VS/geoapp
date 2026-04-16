import React from 'react';
import { Button, Form } from 'react-bootstrap';

export default function Pagination({ 
    page, 
    totalPages, 
    limit, 
    onLimitChange, 
    totalItems = 0,
    maxVisiblePages = 5, 
    onPageChange 
}) {
  const handlePrev = () => {
    if (page > 1) onPageChange(page - 1);
  };

  const handleNext = () => {
    if (page < totalPages) onPageChange(page + 1);
  };

  const getPageNumbers = () => {
    if (totalPages <= 1) return [1];
    let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
    let endPage = startPage + maxVisiblePages - 1;

    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    const pages = [];
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mt-4 px-2 py-3 border-top bg-light-subtle rounded-bottom">
      
      {/* Información de totales */}
      <div className="text-muted small fw-medium">
        Mostrando página <span className="text-dark fw-bold">{page}</span> de <span className="text-dark fw-bold">{totalPages || 1}</span> {totalItems > 0 && `(${totalItems} registros totales)`}
      </div>

      {/* Controles Nav */}
      <div className="d-flex align-items-center gap-1">
        <Button 
          variant="outline-secondary" 
          size="sm" 
          onClick={handlePrev} 
          disabled={page <= 1}
          className="px-3"
        >
          <i className="bi bi-chevron-left"></i> Anterior
        </Button>

        <div className="d-none d-sm-flex gap-1 mx-2">
            {pages.map(p => (
            <Button
                key={p}
                variant={p === page ? "primary" : "outline-secondary"}
                size="sm"
                onClick={() => onPageChange(p)}
                style={{ minWidth: '34px' }}
                className={p === page ? "fw-bold shadow-sm" : "border-0 text-muted"}
            >
                {p}
            </Button>
            ))}
        </div>

        <Button 
          variant="outline-secondary" 
          size="sm" 
          onClick={handleNext} 
          disabled={page >= totalPages}
          className="px-3"
        >
          Siguiente <i className="bi bi-chevron-right"></i>
        </Button>
      </div>

      {/* Selector de registros por página */}
      {onLimitChange && (
        <div className="d-flex align-items-center gap-2">
            <span className="small text-muted text-nowrap">Mostrar:</span>
            <Form.Select 
                size="sm" 
                style={{ width: '85px' }} 
                value={limit}
                onChange={(e) => onLimitChange(Number(e.target.value))}
                className="bg-white border text-center fw-bold"
            >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
            </Form.Select>
        </div>
      )}
    </div>
  );
}
