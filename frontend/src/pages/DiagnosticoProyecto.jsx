import React, { useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Badge, Spinner, Modal, Form, Alert } from "react-bootstrap";
import Swal from "sweetalert2";

import InformeModal from "@/components/InformeModal";
import ScoringResultPanel from "@/modules/diagnostico/ScoringResultPanel";
import DiagnosticoExportModal from "@/modules/diagnostico/DiagnosticoExportModal";
import { useAuth } from "@/auth/AuthContext";
import { useInformesQuery } from "@/hooks/useInformesQuery";
import InformesTableDiagnostico from "@/components/informes/InformesTableDiagnostico";
import Pagination from "@/components/ui/Pagination";

function normalizeApiBase(base) {
  const b = String(base || "").trim();
  if (!b) return "";
  return b.endsWith("/api") ? b : b.replace(/\/+$/, "") + "/api";
}

const API_URL = normalizeApiBase(import.meta.env.VITE_API_URL) || "http://localhost:4000/api";

const authHeaders = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

function hasPerm(auth, code) {
  if (typeof auth?.hasPerm === "function") return !!auth.hasPerm(code);
  const permsAuth = auth?.user?.perms;
  if (Array.isArray(permsAuth)) return permsAuth.includes(code);
  return false;
}

export default function DiagnosticoProyecto() {
  const { idProyecto } = useParams();
  const navigate = useNavigate();

  const auth = useAuth();
  const puedeEditar = useMemo(() => hasPerm(auth, "informes.update"), [auth?.user]);

  const [searchParams] = useSearchParams();
  const plantillaParam = searchParams.get("plantilla");

  const idPlantillaFiltro = useMemo(() => {
    if (!plantillaParam) return null;
    const n = Number(plantillaParam);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [plantillaParam]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortConfig, setSortConfig] = useState({ key: "fecha", dir: "desc" });
  const [showExportModal, setShowExportModal] = useState(false);

  const { informes, meta, loading, error, preguntasPlantilla, formulaActiva, cargarInformes } =
    useInformesQuery(idProyecto, idPlantillaFiltro, {
      search,
      page,
      limit,
      sort_by: sortConfig.key,
      sort_order: sortConfig.dir,
    });

  const nombrePlantillaActiva = useMemo(() => {
    const encontrada = Array.isArray(informes)
      ? informes.find((inf) => String(inf?.nombre_plantilla || "").trim())
      : null;
    return String(encontrada?.nombre_plantilla || "").trim();
  }, [informes]);

  const tituloPlantillaActiva = useMemo(() => {
    const nombre = String(nombrePlantillaActiva || "").trim();
    if (nombre) return nombre;
    if (Number.isFinite(Number(idPlantillaFiltro)) && Number(idPlantillaFiltro) > 0) {
      return `Plantilla #${idPlantillaFiltro}`;
    }
    return "Plantilla";
  }, [nombrePlantillaActiva, idPlantillaFiltro]);

  const contextoHeader = useMemo(() => {
    const totalInformes = Number(meta?.total || informes?.length || 0);
    const partes = [
      `Proyecto #${idProyecto}`,
      idPlantillaFiltro ? `Plantilla #${idPlantillaFiltro}` : "Sin plantilla",
      `${totalInformes} informe${totalInformes === 1 ? "" : "s"}`,
    ];

    return partes.join(" · ");
  }, [idProyecto, idPlantillaFiltro, informes?.length, meta?.total]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "desc" };
    });
  };

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) return <span className="text-muted opacity-25 ms-1">▲▼</span>;
    return sortConfig.dir === "asc" ? (
      <span className="ms-1 text-primary">▲</span>
    ) : (
      <span className="ms-1 text-primary">▼</span>
    );
  };

  const handleMarcarTodoRevisado = async () => {
    if (!idProyecto || !idPlantillaFiltro) return;
    const result = await Swal.fire({
      title: "Marcar todo como revisado",
      text: "¿Desea marcar todos los informes mostrados como revisados? Esto limpiará visualmente los indicadores de cambio.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sí, marcar todo",
      cancelButtonText: "Cancelar",
    });

    if (!result.isConfirmed) return;

    try {
      const resp = await fetch(`${API_URL}/diagnostico/reset-cambios`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id_proyecto: idProyecto, id_plantilla: idPlantillaFiltro }),
      });

      if (resp.ok) {
        Swal.fire("¡Listo!", "Todos los registros han sido marcados como revisados.", "success");
        cargarInformes();
      }
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "No se pudo completar la acción.", "error");
    }
  };

  const handleGenerar = async (idInforme) => {
    try {
      const res = await fetch(`${API_URL}/diagnostico/evaluar-individual/${idInforme}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.ok) {
        cargarInformes();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const [evaluando, setEvaluando] = useState(false);

  // Scroring Modal
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [idRegistroSel, setIdRegistroSel] = useState(null);

  // View Modal
  const [showViewModal, setShowViewModal] = useState(false);
  const [idInformeSel, setIdInformeSel] = useState(null);

  const handleEjecutarEvaluacionMasiva = async () => {
    if (!idProyecto || !idPlantillaFiltro) return;

    const result = await Swal.fire({
      title: "Evaluación de Fórmulas",
      text: `¿Desea ejecutar la evaluación de la fórmula "${formulaActiva?.nombre}" (Versión ${formulaActiva?.version}) sobre todos los informes de este proyecto?`,
      icon: "info",
      showCancelButton: true,
      confirmButtonText: "Sí, Ejecutar Ahora",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#0d6efd",
    });

    if (!result.isConfirmed) return;

    try {
      setEvaluando(true);
      const res = await fetch(`${API_URL}/diagnostico/evaluar-plantilla`, {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id_proyecto: idProyecto,
          id_plantilla: idPlantillaFiltro,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al procesar");

      const { stats } = json;
      Swal.fire({
        icon: "success",
        title: "Evaluación Completada",
        html: `
          <div class="text-start small">
            <p>Se procesaron <b>${stats.procesados}</b> registros.</p>
            <ul>
              <li class="text-primary">Con cambios: ${stats.con_cambios}</li>
              <li class="text-muted">Sin cambios: ${stats.sin_cambios}</li>
              <li class="text-warning">Ignorados (Override): ${stats.ignorados_override}</li>
              ${stats.errores > 0 ? `<li class="text-danger">Errores: ${stats.errores}</li>` : ""}
            </ul>
          </div>
        `,
      });

      cargarInformes();
    } catch (err) {
      Swal.fire("Error", err.message, "error");
    } finally {
      setEvaluando(false);
    }
  };

  const hayResultados = useMemo(() => {
    return (informes || []).some((inf) => inf.score_total != null);
  }, [informes]);

  const puedeExportarDiagnostico = Boolean(hayResultados);

  return (
    <div className="container mt-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 className="mb-0">{tituloPlantillaActiva}</h4>
          <small className="text-muted">{contextoHeader}</small>
        </div>

        <div className="d-flex gap-2 flex-wrap justify-content-end">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Volver
          </Button>

          {puedeExportarDiagnostico && (
            <Button
              variant="outline-success"
              onClick={() => setShowExportModal(true)}
              title="Configurar exportación de diagnóstico en Excel"
            >
              <i className="bi bi-file-earmark-excel"></i> Exportar Diagnóstico XLSX
            </Button>
          )}

          {formulaActiva && puedeEditar && (
            <Button
              variant="danger"
              disabled={evaluando}
              onClick={handleEjecutarEvaluacionMasiva}
              title={`Evaluar todos los registros usando la fórmula: ${formulaActiva.nombre} (V${formulaActiva.version})`}
            >
              <i className={evaluando ? "bi bi-arrow-repeat spin" : "bi bi-cpu"}></i>{" "}
              {evaluando ? "Evaluando..." : "Evaluar Masivo"}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-3 d-flex gap-3 align-items-center">
        <Form.Control
          type="text"
          placeholder="Buscar por cualquier campo..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          disabled={loading && !informes.length}
          style={{ maxWidth: "400px" }}
        />
      </div>

      {loading && (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" /> Cargando datos...
        </div>
      )}

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && !error && informes.length === 0 && search && (
        <Alert variant="info" className="text-center py-3 mt-3">
          Sin resultados para la búsqueda "{search}"
        </Alert>
      )}

      {!loading && !error && informes.length === 0 && !search && (
        <div className="text-center text-muted p-5 bg-light rounded border border-dashed mt-3">
          No hay informes o falta filtrar por plantilla.
        </div>
      )}

      {!loading && !error && informes.length > 0 && (
        <>
          <InformesTableDiagnostico
            informes={informes}
            onSort={handleSort}
            renderSortIcon={renderSortIcon}
            setIdRegistroSel={setIdRegistroSel}
            setShowScoringModal={setShowScoringModal}
            handleGenerar={handleGenerar}
            abrirVer={(id) => {
              setIdInformeSel(id);
              setShowViewModal(true);
            }}
            formulaActiva={formulaActiva}
          />
          <Pagination
            page={meta?.page || 1}
            totalPages={meta?.total_pages || 1}
            limit={limit}
            onLimitChange={(l) => {
              setLimit(l);
              setPage(1);
            }}
            totalItems={meta?.total || 0}
            onPageChange={setPage}
          />
        </>
      )}

      <InformeModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        idInforme={idInformeSel}
        mode="view"
      />

      <Modal show={showScoringModal} onHide={() => setShowScoringModal(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Diagnóstico Detallado</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-light">
          {idRegistroSel && <ScoringResultPanel idRegistro={idRegistroSel} canEditOverride={puedeEditar} />}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowScoringModal(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      <DiagnosticoExportModal
        show={showExportModal}
        onHide={() => setShowExportModal(false)}
        idProyecto={idProyecto}
        idPlantilla={idPlantillaFiltro}
        formulaActiva={formulaActiva}
        preguntasPlantilla={preguntasPlantilla}
      />
    </div>
  );
}
