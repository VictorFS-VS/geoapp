// frontend/src/pages/ListaActas.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { alerts } from "@/utils/alerts"; // ✅ integrar alert.js

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ===== Helpers auth / fetch / descarga ===== */
const getBearer = () => {
  const t = localStorage.getItem("token");
  return t?.startsWith("Bearer ") ? t : t ? `Bearer ${t}` : null;
};
const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
};
const redirect401 = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.replace("/login");
};
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    redirect401();
    return null;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};
function getFilenameFromDisposition(cd, fallback) {
  try {
    if (!cd) return fallback;
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
    const raw = decodeURIComponent(m?.[1] || m?.[2] || "");
    return raw || fallback;
  } catch {
    return fallback;
  }
}

export default function ListaActas() {
  const { id } = useParams(); // id proyecto
  const navigate = useNavigate();

  const [actas, setActas] = useState([]);
  const [loading, setLoading] = useState(true);

  // (antes: error/okMsg) -> ahora usamos alert.js
  // const [error, setError] = useState('');
  // const [okMsg, setOkMsg] = useState('');

  // Filtros
  const [filtroTramo, setFiltroTramo] = useState(""); // value del tramo (string)
  const [filtroProp, setFiltroProp] = useState(""); // texto propietario
  const [filtroDesde, setFiltroDesde] = useState(""); // yyyy-mm-dd
  const [filtroHasta, setFiltroHasta] = useState(""); // yyyy-mm-dd

  const fetchActas = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/proyectos/${id}/actas-preconstruccion`, {
        headers: { ...authHeaders() },
      });
      const data = await jsonOrRedirect401(res);
      if (!data) return; // ya redirigido si 401
      setActas(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setActas([]);
      alerts?.toast?.error
        ? alerts.toast.error("No se pudieron cargar las actas.")
        : console.error("No se pudieron cargar las actas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReimprimir = async (acta) => {
    if (!window.confirm("¿Reimprimir PDF de esta acta?")) return;

    try {
      const url = `${API_URL}/proyectos/${id}/actas-preconstruccion-pdf?id_acta=${acta.id_acta}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders() },
      });

      if (res.status === 401) {
        redirect401();
        return;
      }

      if (!res.ok) {
        let msg = "Error al reimprimir.";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const js = await res.json();
            msg = js?.detalle || js?.error || js?.message || msg;
          } else {
            msg = (await res.text()) || msg;
          }
        } catch {}
        alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const name = getFilenameFromDisposition(cd, `ActaPreconstruccion_${acta.id_acta}.pdf`);

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();

      alerts?.toast?.success
        ? alerts.toast.success(`PDF generado: ${name}`)
        : console.info(`PDF generado: ${name}`);
    } catch (e) {
      console.error(e);
      const msg = "Error al reimprimir: " + (e?.message || e);
      alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
    }
  };

  const handleEliminar = async (acta) => {
    if (!window.confirm(`¿Eliminar acta #${acta.id_acta}? Se borrarán también sus imágenes y firmas.`)) return;

    try {
      const res = await fetch(`${API_URL}/actas-preconstruccion/${acta.id_acta}`, {
        method: "DELETE",
        headers: { ...authHeaders() },
      });

      if (res.status === 401) {
        redirect401();
        return;
      }

      const js = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = js?.detalle || js?.error || js?.message || "No se pudo eliminar.";
        alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
        return;
      }

      alerts?.toast?.success
        ? alerts.toast.success(js?.message || "Acta eliminada correctamente.")
        : console.info(js?.message || "Acta eliminada correctamente.");

      await fetchActas();
    } catch (e) {
      console.error(e);
      const msg = "Error al eliminar: " + (e?.message || e);
      alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
    }
  };

  const handleEditar = (acta) => {
    navigate(`/proyectos/${id}/actas/${acta.id_acta}/editar`);
  };

  // Tramos únicos para el select
  const opcionesTramo = useMemo(() => {
    const set = new Set();
    actas.forEach((a) => {
      if (a.tramo_proyecto) set.add(a.tramo_proyecto);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [actas]);

  // Filtrado en cliente
  const actasFiltradas = useMemo(() => {
    return actas.filter((a) => {
      const okTramo = !filtroTramo || a.tramo_proyecto === filtroTramo;

      const okProp =
        !filtroProp ||
        (a.nombre_propietario || "").toLowerCase().includes(filtroProp.toLowerCase().trim());

      const fechaISO = a.fecha_relevamiento ? new Date(a.fecha_relevamiento) : null;
      const okDesde = !filtroDesde || (fechaISO && fechaISO >= new Date(filtroDesde + "T00:00:00"));
      const okHasta = !filtroHasta || (fechaISO && fechaISO <= new Date(filtroHasta + "T23:59:59"));

      return okTramo && okProp && okDesde && okHasta;
    });
  }, [actas, filtroTramo, filtroProp, filtroDesde, filtroHasta]);

  const limpiarFiltros = () => {
    setFiltroTramo("");
    setFiltroProp("");
    setFiltroDesde("");
    setFiltroHasta("");
  };

  return (
    <div className="container mt-4">
      <button className="btn btn-warning mb-3" onClick={() => navigate(`/proyectos`)}>
        ← Volver a Proyectos
      </button>

      <div className="d-flex align-items-center justify-content-between">
        <h2 className="mb-3">Actas de Preconstrucción</h2>
        <button className="btn btn-sm btn-outline-secondary" onClick={fetchActas} disabled={loading}>
          {loading ? "Cargando..." : "Refrescar"}
        </button>
      </div>

      {/* Filtros */}
      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-3">
              <label className="form-label mb-1">Tramo</label>
              <select
                className="form-select form-select-sm"
                value={filtroTramo}
                onChange={(e) => setFiltroTramo(e.target.value)}
              >
                <option value="">— Todos —</option>
                {opcionesTramo.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-md-3">
              <label className="form-label mb-1">Propietario</label>
              <input
                className="form-control form-control-sm"
                placeholder="Buscar por nombre…"
                value={filtroProp}
                onChange={(e) => setFiltroProp(e.target.value)}
              />
            </div>

            <div className="col-md-2">
              <label className="form-label mb-1">Fecha desde</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={filtroDesde}
                onChange={(e) => setFiltroDesde(e.target.value)}
              />
            </div>

            <div className="col-md-2">
              <label className="form-label mb-1">Fecha hasta</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={filtroHasta}
                onChange={(e) => setFiltroHasta(e.target.value)}
              />
            </div>

            <div className="col-md-2 d-flex align-items-end">
              <button className="btn btn-sm btn-outline-secondary me-2" onClick={limpiarFiltros}>
                Limpiar
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div>Cargando actas...</div>
      ) : actasFiltradas.length === 0 ? (
        <div>No hay actas que coincidan con el filtro.</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead className="table-dark">
              <tr>
                <th style={{ minWidth: 210 }}>Acciones</th>
                <th>ID</th>
                <th>Tramo</th>
                <th>Fecha</th>
                <th>Propietario</th>
                <th>Fotos Fachada</th>
                <th>Fotos Vereda</th>
                <th>Fotos Estructura</th>
                <th>Firmas</th>
              </tr>
            </thead>
            <tbody>
              {actasFiltradas.map((a) => (
                <tr key={a.id_acta}>
                  <td>
                    <div className="btn-group">
                      <button className="btn btn-sm btn-primary" onClick={() => handleEditar(a)}>
                        Editar
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleReimprimir(a)}>
                        Reimprimir
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleEliminar(a)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                  <td>{a.id_acta}</td>
                  <td>{a.tramo_proyecto || "-"}</td>
                  <td>{a.fecha_relevamiento ? new Date(a.fecha_relevamiento).toLocaleDateString() : "-"}</td>
                  <td>{a.nombre_propietario || "-"}</td>
                  <td>
                    {a.fotos_fachada > 0 ? (
                      <span className="badge bg-success">{a.fotos_fachada}</span>
                    ) : (
                      <span className="badge bg-secondary">0</span>
                    )}
                  </td>
                  <td>
                    {a.fotos_vereda > 0 ? (
                      <span className="badge bg-success">{a.fotos_vereda}</span>
                    ) : (
                      <span className="badge bg-secondary">0</span>
                    )}
                  </td>
                  <td>
                    {a.fotos_estructura > 0 ? (
                      <span className="badge bg-success">{a.fotos_estructura}</span>
                    ) : (
                      <span className="badge bg-secondary">0</span>
                    )}
                  </td>
                  <td>
                    {a.tiene_firma_propietario ? (
                      <span className="badge bg-success me-1" title="Firma del propietario cargada">
                        Propietario
                      </span>
                    ) : (
                      <span className="badge bg-warning me-1" title="Falta firma propietario">
                        P?
                      </span>
                    )}
                    {a.tiene_firma_arquitecto ? (
                      <span className="badge bg-success" title="Firma del arquitecto cargada">
                        Arquitecto
                      </span>
                    ) : (
                      <span className="badge bg-warning" title="Falta firma arquitecto">
                        A?
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-muted small">
            Mostrando {actasFiltradas.length} de {actas.length} actas.
          </div>
        </div>
      )}
    </div>
  );
}
