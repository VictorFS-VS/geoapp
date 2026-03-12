import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { Plus } from "lucide-react";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   Helpers
========================= */
const toISODate = (v) => {
  if (!v) return "";
  const s = String(v);
  return s.includes("T") ? s.split("T")[0] : s;
};

const toNull = (v) => (v === "" || v === undefined ? null : v);

const toNumberOrNull = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sanitizePayload = (fd) => ({
  ...fd,
  tipoconcepto: fd.tipoconcepto ? String(fd.tipoconcepto).toUpperCase() : fd.tipoconcepto,
  desde: toNull(fd.desde),
  hasta: toNull(fd.hasta),
  numero: toNumberOrNull(fd.numero),
  porcentaje: toNumberOrNull(fd.porcentaje),
  monto: toNumberOrNull(fd.monto),
  rango1: toNumberOrNull(fd.rango1),
  rango2: toNumberOrNull(fd.rango2),
  rango3: toNumberOrNull(fd.rango3),
  descripcion: toNull(fd.descripcion),
  referencia: toNull(fd.referencia),
  clase: toNull(fd.clase),
});

function normalizePerms(perms) {
  if (!Array.isArray(perms)) return [];

  const out = [];
  for (const p of perms) {
    if (typeof p === "string" && p.trim()) {
      out.push(p.trim());
    } else if (p && typeof p === "object" && typeof p.code === "string" && p.code.trim()) {
      out.push(p.code.trim());
    }
  }

  return [...new Set(out)];
}

function hasAnyPerm(user, codes = []) {
  const perms = normalizePerms(user?.perms);
  return codes.some((c) => perms.includes(c));
}

export default function Conceptos() {
  const [conceptos, setConceptos] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear"); // crear | editar | ver
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [usuarioActual, setUsuarioActual] = useState(null);

  const [formData, setFormData] = useState({
    concepto: "",
    nombre: "",
    descripcion: "",
    tipoconcepto: "",
    desde: "",
    hasta: "",
    numero: "",
    porcentaje: "",
    monto: "",
    rango1: "",
    rango2: "",
    rango3: "",
    referencia: "",
    clase: "",
  });

  const token = localStorage.getItem("token");
  const bearer = token?.startsWith("Bearer ") ? token : token ? `Bearer ${token}` : null;

  const headers = {
    "Content-Type": "application/json",
    ...(bearer ? { Authorization: bearer } : {}),
  };

  /* ----- usuario actual ----- */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/usuarios/me`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const js = await res.json();
        setUsuarioActual(js);
      } catch (e) {
        console.error("Error /usuarios/me:", e);
        alerts?.toast?.error?.("No se pudo obtener el usuario actual.");
        setUsuarioActual(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ----- permisos RBAC ----- */
  const canAccessConceptos = useMemo(() => {
    return hasAnyPerm(usuarioActual, [
      "conceptos.read",
      "conceptos.create",
      "conceptos.update",
      "conceptos.delete",
    ]);
  }, [usuarioActual]);

  const canReadConceptos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["conceptos.read"]);
  }, [usuarioActual]);

  const canCreateConceptos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["conceptos.create"]);
  }, [usuarioActual]);

  const canUpdateConceptos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["conceptos.update"]);
  }, [usuarioActual]);

  const canDeleteConceptos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["conceptos.delete"]);
  }, [usuarioActual]);

  /* ----- listado ----- */
  useEffect(() => {
    if (canReadConceptos) {
      cargarConceptos(page, search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadConceptos, page, search]);

  const cargarConceptos = async (pagina = 1, filtro = "") => {
    try {
      const res = await fetch(
        `${API_URL}/conceptos?page=${pagina}&limit=10&search=${encodeURIComponent(filtro)}`,
        { headers }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConceptos(data?.data || []);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      console.error("Error listando conceptos:", e);
      alerts?.toast?.error?.("Error al listar conceptos.");
      setConceptos([]);
    }
  };

  /* ----- abm ----- */
  const abrirModal = (nuevoModo, concepto = null) => {
    if (nuevoModo === "crear" && !canCreateConceptos) {
      alerts?.toast?.warning?.("No tienes permiso para crear conceptos.");
      return;
    }

    if (nuevoModo === "editar" && !canUpdateConceptos) {
      alerts?.toast?.warning?.("No tienes permiso para editar conceptos.");
      return;
    }

    const normalizado = concepto
      ? Object.fromEntries(Object.entries(concepto).map(([k, v]) => [k, v ?? ""]))
      : {
          concepto: "",
          nombre: "",
          descripcion: "",
          tipoconcepto: "",
          desde: "",
          hasta: "",
          numero: "",
          porcentaje: "",
          monto: "",
          rango1: "",
          rango2: "",
          rango3: "",
          referencia: "",
          clase: "",
        };

    normalizado.desde = toISODate(normalizado.desde);
    normalizado.hasta = toISODate(normalizado.hasta);

    setModo(nuevoModo);
    setFormData(normalizado);
    setModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    if (!formData.concepto || !formData.tipoconcepto || !formData.nombre) {
      alerts?.toast?.warning?.("Complete los campos obligatorios: Concepto, Tipo y Nombre.");
      return;
    }

    const isEditar = modo === "editar";

    if (isEditar && !canUpdateConceptos) {
      alerts?.toast?.warning?.("No tienes permiso para editar conceptos.");
      return;
    }

    if (!isEditar && !canCreateConceptos) {
      alerts?.toast?.warning?.("No tienes permiso para crear conceptos.");
      return;
    }

    const url = isEditar
      ? `${API_URL}/conceptos/${encodeURIComponent(formData.concepto)}/${encodeURIComponent(formData.tipoconcepto)}`
      : `${API_URL}/conceptos`;

    const metodo = isEditar ? "PUT" : "POST";
    const payload = sanitizePayload(formData);

    try {
      const res = await fetch(url, {
        method: metodo,
        headers,
        body: JSON.stringify(payload),
      });

      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js?.error || js?.message || `HTTP ${res.status}`);

      alerts?.toast?.success?.(js?.message || "Guardado correctamente");

      setModalOpen(false);
      cargarConceptos(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "Error al guardar concepto");
    }
  };

  const eliminar = async (concepto, tipoconcepto) => {
    if (!canDeleteConceptos) {
      alerts?.toast?.warning?.("No tienes permiso para eliminar conceptos.");
      return;
    }

    if (!window.confirm("¿Eliminar este concepto?")) return;

    try {
      const url = `${API_URL}/conceptos/${encodeURIComponent(concepto)}/${encodeURIComponent(tipoconcepto)}`;
      const res = await fetch(url, { method: "DELETE", headers });
      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js?.error || js?.message || `HTTP ${res.status}`);

      alerts?.toast?.success?.(js?.message || "Eliminado correctamente");
      cargarConceptos(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "Error al eliminar concepto");
    }
  };

  const handleBuscar = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  /* ----- acceso ----- */
  if (!canAccessConceptos) {
    return (
      <div className="container py-4 text-center">
        <h4 className="text-danger">🚫 No tienes autorización para acceder a esta sección.</h4>
      </div>
    );
  }

  return (
    <div className="container py-3">
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Conceptos</h2>
          <p className="pc-sub">Catálogo de conceptos y tipos para parametrizar el sistema.</p>
        </div>

        <div className="pc-actions">
          {canCreateConceptos && (
            <button className="pc-btn pc-btn-blue" onClick={() => abrirModal("crear")}>
              <Plus className="ico" /> Crear Concepto
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <input
          type="text"
          className="form-control"
          placeholder="Buscar por concepto, nombre o tipo…"
          value={search}
          onChange={handleBuscar}
          disabled={!canReadConceptos}
        />
      </div>

      <table className="table table-bordered table-hover align-middle">
        <thead className="table-primary">
          <tr>
            <th style={{ width: 140 }}>Concepto</th>
            <th>Nombre</th>
            <th style={{ width: 180 }}>Tipo</th>
            <th style={{ width: 220 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(conceptos) &&
            conceptos.map((c) => (
              <tr key={c.gid || `${c.concepto}_${c.tipoconcepto}`}>
                <td>
                  <code>{c.concepto}</code>
                </td>
                <td>{c.nombre}</td>
                <td>{c.tipoconcepto}</td>
                <td>
                  <div className="btn-group btn-group-sm">
                    {canUpdateConceptos && (
                      <button className="btn btn-warning" onClick={() => abrirModal("editar", c)}>
                        Editar
                      </button>
                    )}

                    {canDeleteConceptos && (
                      <button
                        className="btn btn-danger"
                        onClick={() => eliminar(c.concepto, c.tipoconcepto)}
                      >
                        Eliminar
                      </button>
                    )}

                    <button className="btn btn-info text-white" onClick={() => abrirModal("ver", c)}>
                      Ver
                    </button>
                  </div>
                </td>
              </tr>
            ))}

          {(!conceptos || conceptos.length === 0) && (
            <tr>
              <td colSpan={4} className="text-center text-muted py-4">
                No hay conceptos para mostrar.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="d-flex justify-content-between align-items-center mt-3">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="pc-pager-btns">
          <button
            className="pc-btn pc-btn-outline"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ◀ Anterior
          </button>
          <button
            className="pc-btn pc-btn-outline"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente ▶
          </button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modo === "crear" ? "Nuevo Concepto" : modo === "editar" ? "Editar Concepto" : "Ver Concepto"}
      >
        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Código del Concepto</label>
            <input
              type="text"
              name="concepto"
              className="form-control"
              value={formData.concepto}
              onChange={handleChange}
              disabled={modo === "ver" || modo === "editar"}
              placeholder="p. ej. CN001"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Tipo de Concepto</label>
            <input
              type="text"
              name="tipoconcepto"
              className="form-control"
              value={formData.tipoconcepto}
              onChange={handleChange}
              disabled={modo === "ver" || modo === "editar"}
              placeholder="p. ej. IMPUESTO"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Nombre</label>
            <input
              type="text"
              name="nombre"
              className="form-control"
              value={formData.nombre}
              onChange={handleChange}
              disabled={modo === "ver"}
              placeholder="Nombre legible"
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Desde</label>
            <input
              type="date"
              name="desde"
              className="form-control"
              value={formData.desde || ""}
              onChange={handleChange}
              disabled={modo === "ver"}
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Hasta</label>
            <input
              type="date"
              name="hasta"
              className="form-control"
              value={formData.hasta || ""}
              onChange={handleChange}
              disabled={modo === "ver"}
            />
          </div>

          {[
            ["numero", "Número"],
            ["porcentaje", "Porcentaje"],
            ["monto", "Monto"],
          ].map(([name, label]) => (
            <div className="col-md-4" key={name}>
              <label className="form-label">{label}</label>
              <input
                type="number"
                step="any"
                name={name}
                className="form-control"
                value={formData[name] ?? ""}
                onChange={handleChange}
                disabled={modo === "ver"}
              />
            </div>
          ))}

          {[
            ["rango1", "Rango 1"],
            ["rango2", "Rango 2"],
            ["rango3", "Rango 3"],
          ].map(([name, label]) => (
            <div className="col-md-4" key={name}>
              <label className="form-label">{label}</label>
              <input
                type="number"
                step="any"
                name={name}
                className="form-control"
                value={formData[name] ?? ""}
                onChange={handleChange}
                disabled={modo === "ver"}
              />
            </div>
          ))}

          <div className="col-md-8">
            <label className="form-label">Referencia</label>
            <input
              type="text"
              name="referencia"
              className="form-control"
              value={formData.referencia}
              onChange={handleChange}
              disabled={modo === "ver"}
              placeholder="Referencia interna / nota"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Clase</label>
            <input
              type="text"
              name="clase"
              className="form-control"
              value={formData.clase}
              onChange={handleChange}
              disabled={modo === "ver"}
              placeholder="Clase / categoría"
            />
          </div>

          <div className="col-12">
            <label className="form-label">Descripción</label>
            <textarea
              name="descripcion"
              className="form-control"
              rows={3}
              value={formData.descripcion}
              onChange={handleChange}
              disabled={modo === "ver"}
              placeholder="Detalles del concepto…"
            />
          </div>

          {modo !== "ver" && (canCreateConceptos || canUpdateConceptos) && (
            <div className="col-12 text-end">
              <button className="btn btn-primary" onClick={guardar}>
                Guardar
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}