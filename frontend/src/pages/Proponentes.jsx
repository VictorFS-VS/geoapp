// src/pages/Proponentes.jsx
import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { Plus } from "lucide-react";
import { Spinner } from "react-bootstrap";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   Helpers: auth + errores
   ========================= */
const authHeaders = () => {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function parseJsonSafe(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => null);
  }
  const txt = await res.text().catch(() => "");
  // si el backend devolvió texto con JSON (pasa a veces)
  try {
    return JSON.parse(txt);
  } catch {
    return txt ? { message: txt } : null;
  }
}

function extractApiMessage(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  return (
    payload.detail ||
    payload.message ||
    payload.error ||
    payload.msg ||
    payload?.errors?.[0]?.message ||
    ""
  );
}

function niceMessageFromStatus(status, payload) {
  const apiMsg = extractApiMessage(payload);

  if (status === 400) return apiMsg || "Datos inválidos. Verifique los campos obligatorios.";
  if (status === 401) return "Sesión expirada. Inicie sesión nuevamente.";
  if (status === 403) return apiMsg || "No tiene permisos para realizar esta acción.";
  if (status === 404) return apiMsg || "No encontrado.";
  if (status === 409) {
    // duplicados: PG 23505 manejado en backend
    // ejemplo: 'Ya existe la llave (id_cliente)=(29).'
    return apiMsg || "Ya existe un registro duplicado.";
  }
  if (status === 422) return apiMsg || "Validación fallida. Revise los datos.";
  if (status >= 500) return "Error del servidor. Intente nuevamente.";

  return apiMsg || "Ocurrió un error inesperado.";
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);

  // 401: redirigir
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.replace("/login");
    return { ok: false, status: 401, data: null, res };
  }

  const data = await parseJsonSafe(res);

  return {
    ok: res.ok,
    status: res.status,
    data,
    res,
  };
}

const toArray = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.data) ? x.data : x ? [x] : []);

export default function Proponentes() {
  const [clientes, setClientes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear");

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");

  const [tipoUsuario, setTipoUsuario] = useState(null);
  const [idCliente, setIdCliente] = useState(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [formData, setFormData] = useState({
    id_cliente: "",
    cedularuc: "",
    nombre: "",
    apellido: "",
    email: "",
    fecha_nac: "",
    sexo: "",
    tipo_persona: "",
    telefono: "",
    direccion: "",
    tipo_empresa: "",
    nacionalidad: "",
    rlegal_cedula: "",
    rlegal_nombre: "",
    rlegal_apellido: "",
    rlegal_sexo: "",
    dvi: "",
  });

  /* ---------- leer token ---------- */
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1] || ""));
        const tu = Number(payload?.tipo_usuario);
        setTipoUsuario(Number.isFinite(tu) ? tu : null);
        setIdCliente(payload?.id_cliente != null ? Number(payload.id_cliente) : null);
      } catch {}
    }
  }, []);

  /* ---------- cargar lista ---------- */
  useEffect(() => {
    if (tipoUsuario == null) return;
    cargarClientes(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, tipoUsuario]);

  async function cargarClientes(pagina = 1, filtro = "") {
    try {
      setLoading(true);

      let url;
      if (tipoUsuario === 9 || tipoUsuario === 10) {
        if (!idCliente) {
          setClientes([]);
          setPage(1);
          setTotalPages(1);
          return;
        }
        url = `${API_URL}/proponentes/${idCliente}`;
      } else {
        url = `${API_URL}/proponentes?page=${pagina}&limit=10&search=${encodeURIComponent(filtro)}`;
      }

      const { ok, status, data } = await apiFetch(url, { headers: authHeaders() });
      if (!ok) {
        const msg = niceMessageFromStatus(status, data);
        setClientes([]);
        setPage(1);
        setTotalPages(1);
        alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
        return;
      }

      if (tipoUsuario === 9 || tipoUsuario === 10) {
        setClientes(toArray(data));
        setPage(1);
        setTotalPages(1);
      } else {
        setClientes(toArray(data));
        setPage(data?.page || pagina || 1);
        setTotalPages(data?.totalPages || 1);
      }
    } catch (err) {
      console.error("Error al cargar clientes:", err);
      setClientes([]);
      setPage(1);
      setTotalPages(1);
      alerts?.toast?.error
        ? alerts.toast.error("No se pudieron cargar los clientes (error de red).")
        : console.error("No se pudieron cargar los clientes (error de red).");
    } finally {
      setLoading(false);
    }
  }

  /* ---------- modal / CRUD ---------- */
  const abrirModal = (nuevoModo, c = null) => {
    if ((nuevoModo === "crear" || nuevoModo === "editar") && tipoUsuario !== 1) return;

    if (nuevoModo === "crear") {
      setFormData({
        id_cliente: "",
        cedularuc: "",
        nombre: "",
        apellido: "",
        email: "",
        fecha_nac: "",
        sexo: "",
        tipo_persona: "",
        telefono: "",
        direccion: "",
        tipo_empresa: "",
        nacionalidad: "",
        rlegal_cedula: "",
        rlegal_nombre: "",
        rlegal_apellido: "",
        rlegal_sexo: "",
        dvi: "",
      });
    } else if (c) {
      const normalizado = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ""]));
      setFormData(normalizado);
    }

    setModo(nuevoModo);
    setModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    if (tipoUsuario !== 1) return;

    if (!formData.cedularuc || !formData.nombre || !formData.tipo_persona) {
      alerts?.toast?.warning
        ? alerts.toast.warning("Complete los obligatorios (Cédula/RUC, Nombre, Tipo Persona).")
        : console.warn("Complete los obligatorios (Cédula/RUC, Nombre, Tipo Persona).");
      return;
    }

    const datosLimpios = {
      ...formData,
      id_cliente: formData.id_cliente === "" ? null : parseInt(formData.id_cliente, 10),
      dvi: formData.dvi === "" ? null : parseInt(formData.dvi, 10),
      fecha_nac: formData.fecha_nac === "" ? null : formData.fecha_nac,
      rlegal_cedula: formData.rlegal_cedula === "" ? null : parseInt(formData.rlegal_cedula, 10),
      telefono: formData.telefono === "" ? null : parseInt(formData.telefono, 10),
      cedularuc: formData.cedularuc === "" ? null : parseInt(formData.cedularuc, 10),
    };

    const esEdicion = !!(formData.id_cliente && modo === "editar");
    const url = esEdicion ? `${API_URL}/proponentes/${formData.id_cliente}` : `${API_URL}/proponentes`;
    const method = esEdicion ? "PUT" : "POST";

    try {
      setSaving(true);

      const { ok, status, data } = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(datosLimpios),
      });

      if (!ok) {
        const msg = niceMessageFromStatus(status, data);

        // 🎯 Mensaje extra para el caso típico de secuencia desincronizada
        const detail = extractApiMessage(data);
        const pareceSecuencia = /id_cliente\)=\(/i.test(detail) || /cliente_pk/i.test(detail);
        const extra =
          status === 409 && pareceSecuencia
            ? " (Si pasa aun sin tocar ID, revisá la SECUENCIA del id_cliente en PostgreSQL)."
            : "";

        alerts?.toast?.error ? alerts.toast.error(msg + extra) : console.error(msg + extra);
        return;
      }

      setModalOpen(false);
      alerts?.toast?.success
        ? alerts.toast.success(esEdicion ? "Cliente actualizado correctamente." : "Cliente creado correctamente.")
        : console.info(esEdicion ? "Cliente actualizado correctamente." : "Cliente creado correctamente.");

      cargarClientes(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error
        ? alerts.toast.error("Error de red al guardar cliente.")
        : console.error("Error de red al guardar cliente.");
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async (id) => {
    if (tipoUsuario !== 1) return;
    if (!window.confirm("¿Eliminar este cliente?")) return;

    try {
      setDeletingId(id);

      const { ok, status, data } = await apiFetch(`${API_URL}/proponentes/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!ok) {
        const msg = niceMessageFromStatus(status, data);
        alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
        return;
      }

      alerts?.toast?.success
        ? alerts.toast.success("Cliente eliminado correctamente.")
        : console.info("Cliente eliminado correctamente.");

      cargarClientes(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error
        ? alerts.toast.error("Error de red al eliminar cliente.")
        : console.error("Error de red al eliminar cliente.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleBuscar = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const obtenerEtiqueta = (campo, valor) => {
    if (valor === "") return "Seleccione…";
    const etiquetas = {
      sexo: { F: "Femenino", M: "Masculino" },
      rlegal_sexo: { F: "Femenino", M: "Masculino" },
      tipo_persona: { F: "Física", J: "Jurídica" },
      tipo_empresa: { P: "Pública", R: "Privada" },
    };
    return etiquetas[campo]?.[valor] || valor;
  };

  const esSoloFicha = tipoUsuario === 9 || tipoUsuario === 10;

  const modalTitle = useMemo(() => {
    if (modo === "crear") return "Nuevo Cliente";
    if (modo === "editar") return "Editar Cliente";
    return "Ver Cliente";
  }, [modo]);

  return (
    <div className="container py-3">
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Clientes</h2>
        </div>

        <div className="pc-actions">
          {tipoUsuario === 1 && (
            <button className="pc-btn pc-btn-blue" onClick={() => abrirModal("crear")}>
              <Plus className="ico" /> Crear Cliente
            </button>
          )}
        </div>
      </div>

      {!esSoloFicha && (
        <div className="mb-3">
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nombre, apellido o RUC..."
            value={search}
            onChange={handleBuscar}
          />
        </div>
      )}

      <table className="table table-bordered table-hover">
        <thead className="table-primary">
          <tr>
            <th>Nombre</th>
            <th>Apellido</th>
            <th>RUC/Cédula</th>
            <th>Tipo Persona</th>
            <th style={{ width: 240 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="text-center">
                <Spinner animation="border" size="sm" className="me-2" />
                Cargando…
              </td>
            </tr>
          ) : clientes.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center">
                Sin resultados
              </td>
            </tr>
          ) : (
            clientes.map((c, index) => (
              <tr key={c.id_cliente ?? `cliente-${index}`}>
                <td>{c.nombre}</td>
                <td>{c.apellido}</td>
                <td>{c.cedularuc}</td>
                <td>{obtenerEtiqueta("tipo_persona", c.tipo_persona)}</td>
                <td>
                  <div className="btn-group btn-group-sm">
                    {tipoUsuario === 1 && (
                      <button
                        className="btn btn-warning"
                        onClick={() => abrirModal("editar", c)}
                        disabled={deletingId === c.id_cliente}
                      >
                        Editar
                      </button>
                    )}
                    {tipoUsuario === 1 && (
                      <button
                        className="btn btn-danger"
                        onClick={() => eliminar(c.id_cliente)}
                        disabled={deletingId === c.id_cliente}
                      >
                        {deletingId === c.id_cliente ? (
                          <>
                            <Spinner animation="border" size="sm" className="me-1" />
                            Eliminando…
                          </>
                        ) : (
                          "Eliminar"
                        )}
                      </button>
                    )}
                    <button
                      className="btn btn-info text-white"
                      onClick={() => abrirModal("ver", c)}
                      disabled={deletingId === c.id_cliente}
                    >
                      Ver
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {!esSoloFicha && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="btn-group">
            <button
              className="btn btn-outline-primary"
              disabled={page === 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              ◀ Anterior
            </button>
            <button
              className="btn btn-outline-primary"
              disabled={page === totalPages || loading}
              onClick={() => setPage(page + 1)}
            >
              Siguiente ▶
            </button>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={modalTitle}>
        <div className="row g-3">
          {[
            { label: "Cédula o RUC", name: "cedularuc" },
            { label: "Nombre", name: "nombre" },
            { label: "Apellido", name: "apellido" },
            { label: "Email", name: "email" },
            { label: "Fecha de Nacimiento", name: "fecha_nac", type: "date" },
            { label: "Sexo", name: "sexo", type: "select", options: ["", "F", "M"] },
            { label: "Tipo Persona", name: "tipo_persona", type: "select", options: ["", "F", "J"] },
            { label: "Teléfono", name: "telefono" },
            { label: "Dirección", name: "direccion" },
            { label: "Tipo Empresa", name: "tipo_empresa", type: "select", options: ["", "P", "R"] },
            { label: "Nacionalidad", name: "nacionalidad" },
            { label: "CI R. Legal", name: "rlegal_cedula" },
            { label: "Nombre R. Legal", name: "rlegal_nombre" },
            { label: "Apellido R. Legal", name: "rlegal_apellido" },
            { label: "Sexo R. Legal", name: "rlegal_sexo", type: "select", options: ["", "F", "M"] },
          ].map((field, i) => (
            <div className="col-md-6" key={i}>
              <label className="form-label">{field.label}</label>

              {field.type === "select" ? (
                <select
                  name={field.name}
                  className="form-select"
                  value={formData[field.name]}
                  onChange={handleChange}
                  disabled={modo === "ver" || tipoUsuario !== 1 || saving}
                >
                  {field.options.map((opt, j) => (
                    <option key={j} value={opt}>
                      {obtenerEtiqueta(field.name, opt)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type || "text"}
                  name={field.name}
                  className="form-control"
                  value={
                    field.type === "date"
                      ? formData[field.name]
                        ? String(formData[field.name]).split("T")[0]
                        : ""
                      : formData[field.name]
                  }
                  onChange={handleChange}
                  disabled={modo === "ver" || tipoUsuario !== 1 || saving}
                />
              )}
            </div>
          ))}

          {modo !== "ver" && tipoUsuario === 1 && (
            <div className="col-12 text-end">
              <button className="btn btn-primary" onClick={guardar} disabled={saving}>
                {saving ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Guardando…
                  </>
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
