// src/pages/Consultores.jsx
import React, { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { Plus } from "lucide-react";
import { alerts } from "@/utils/alerts"; // ✅ integrar alert.js

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

// Helper para headers auth actualizados
const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  const bearer = token?.startsWith("Bearer ") ? token : token ? `Bearer ${token}` : null;
  return bearer ? { Authorization: bearer } : {};
};

export default function Consultores() {
  const [consultores, setConsultores] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState(null);

  const [idConsultorUsuario, setIdConsultorUsuario] = useState(null);
  const [idClienteUsuario, setIdClienteUsuario] = useState(null);

  const [formData, setFormData] = useState({
    id_consultor: "",
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
    id_cliente: "",
  });

  // --- lee token una vez y guarda tipo + ids
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1] || ""));
      const tu = Number(payload?.tipo_usuario);
      setTipoUsuario(Number.isFinite(tu) ? tu : null);

      const ic = payload?.id_consultor != null ? Number(payload.id_consultor) : null;
      const idc = payload?.id_cliente != null ? Number(payload.id_cliente) : null;
      setIdConsultorUsuario(Number.isFinite(ic) ? ic : null);
      setIdClienteUsuario(Number.isFinite(idc) ? idc : null);
    } catch {
      // ignore
    }
  }, []);

  // --- carga según el tipo y sus ids
  useEffect(() => {
    if (tipoUsuario == null) return; // esperar a tener tipo
    cargarConsultores(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, tipoUsuario, idConsultorUsuario, idClienteUsuario]);

  const cargarConsultores = async (pagina = 1, filtro = "") => {
    try {
      const headers = getAuthHeaders();

      // 1) Consultor (8) → endpoint directo
      if (tipoUsuario === 8 && idConsultorUsuario) {
        try {
          const r = await fetch(`${API_URL}/consultores/${idConsultorUsuario}`, { headers });
          if (r.ok) {
            const row = await r.json();
            setConsultores(row ? [row] : []);
            setPage(1);
            setTotalPages(1);
            return;
          }
        } catch {
          // fallback abajo
        }
      }

      // 2) Cliente vial (10) → query por cliente (si backend soporta)
      if (tipoUsuario === 10 && idClienteUsuario) {
        try {
          const r = await fetch(`${API_URL}/consultores?by_cliente=${idClienteUsuario}`, { headers });
          if (r.ok) {
            const data = await r.json();
            const rows = Array.isArray(data) ? data : data.data || [];
            setConsultores(rows);
            setPage(1);
            setTotalPages(1);
            return;
          }
        } catch {
          // fallback abajo
        }
      }

      // 3) Default: pagina + filtro, con filtro adicional en front para 8/10
      const url = `${API_URL}/consultores?page=${pagina}&limit=10&search=${encodeURIComponent(filtro)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let rows = data.data || [];
      if (tipoUsuario === 8 && idConsultorUsuario) {
        rows = rows.filter((c) => Number(c.id_consultor) === idConsultorUsuario);
      }
      if (tipoUsuario === 10 && idClienteUsuario) {
        rows = rows.filter((c) => Number(c.id_cliente) === idClienteUsuario);
      }

      setConsultores(rows);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error("Error al cargar consultores:", err.message || err);
      alerts?.toast?.error
        ? alerts.toast.error("Error al cargar consultores.")
        : console.error("Error al cargar consultores.");
      setConsultores([]);
    }
  };

  const abrirModal = (modo, consultor = null) => {
    const datos = consultor
      ? Object.fromEntries(Object.entries(consultor).map(([k, v]) => [k, v ?? ""]))
      : {
          id_consultor: "",
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
          id_cliente: "",
        };
    setFormData(datos);
    setModo(modo);
    setModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    // Chequeo mínimo en front (si falta algo muestro toast de error)
    if (!formData.cedularuc || !formData.nombre || !formData.tipo_persona) {
      const msg = "Complete los campos obligatorios: Cédula/RUC, Nombre y Tipo de Persona.";
      alerts?.toast?.warning ? alerts.toast.warning(msg) : console.error(msg);
      return;
    }

    const datosLimpios = {
      ...formData,
      id_cliente: formData.id_cliente === "" ? null : parseInt(formData.id_cliente, 10),
      dvi: formData.dvi === "" ? null : parseInt(formData.dvi, 10),
      rlegal_cedula: formData.rlegal_cedula === "" ? null : parseInt(formData.rlegal_cedula, 10),
    };

    const url = formData.id_consultor ? `${API_URL}/consultores/${formData.id_consultor}` : `${API_URL}/consultores`;
    const method = formData.id_consultor ? "PUT" : "POST";

    try {
      const headers = { "Content-Type": "application/json", ...getAuthHeaders() };
      const res = await fetch(url, { method, headers, body: JSON.stringify(datosLimpios) });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        let msg = data.error || "Error al guardar consultor";

        if (data.fields && typeof data.fields === "object") {
          const detalleCampos = Object.entries(data.fields)
            .map(([_, texto]) => `• ${texto}`)
            .join("\n");
          if (detalleCampos) msg += "\n\n" + detalleCampos;
        }

        alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
        return;
      }

      alerts?.toast?.success
        ? alerts.toast.success(data.message || "Consultor guardado correctamente")
        : console.info(data.message || "Consultor guardado correctamente");

      setModalOpen(false);
      cargarConsultores(page, search);
    } catch (err) {
      console.error("Error al guardar consultor:", err.message || err);
      alerts?.toast?.error ? alerts.toast.error("Error al guardar consultor.") : console.error("Error al guardar consultor.");
    }
  };

  const eliminar = async (id) => {
    if (!window.confirm("¿Eliminar este consultor?")) return;
    try {
      const res = await fetch(`${API_URL}/consultores/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alerts?.toast?.error ? alerts.toast.error(data.error || "Error al eliminar consultor") : console.error(data.error || "Error al eliminar consultor");
        return;
      }

      alerts?.toast?.success
        ? alerts.toast.success(data.message || "Consultor eliminado correctamente")
        : console.info(data.message || "Consultor eliminado correctamente");

      cargarConsultores(page, search);
    } catch (err) {
      console.error("Error al eliminar consultor:", err.message || err);
      alerts?.toast?.error ? alerts.toast.error("Error al eliminar consultor.") : console.error("Error al eliminar consultor.");
    }
  };

  const handleBuscar = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  // Para 8/10 mostramos sólo su(s) registro(s). Ya filtramos arriba
  const displayedConsultores = consultores;
  const esRestringido = tipoUsuario === 8 || tipoUsuario === 10;

  return (
    <div className="container py-3">
      {/* Header estilo Projects/Usuarios */}
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Consultores</h2>
        </div>

        <div className="pc-actions">
          {tipoUsuario === 1 && (
            <button className="pc-btn pc-btn-blue" onClick={() => abrirModal("crear")}>
              <Plus className="ico" /> Crear Consultor
            </button>
          )}
        </div>
      </div>

      {/* Buscador: oculto si es consultor (8) o cliente vial (10) */}
      {!esRestringido && (
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
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {displayedConsultores.map((c) => (
            <tr key={c.id_consultor}>
              <td>{c.nombre}</td>
              <td>{c.apellido}</td>
              <td>{c.cedularuc}</td>
              <td>{c.tipo_persona === "F" ? "Física" : c.tipo_persona === "J" ? "Jurídica" : ""}</td>
              <td>
                <div className="btn-group btn-group-sm">
                  {(tipoUsuario === 1 || (tipoUsuario === 8 && Number(c.id_consultor) === idConsultorUsuario)) && (
                    <button className="btn btn-warning" onClick={() => abrirModal("editar", c)}>
                      Editar
                    </button>
                  )}
                  {tipoUsuario === 1 && (
                    <button className="btn btn-danger" onClick={() => eliminar(c.id_consultor)}>
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
          {displayedConsultores.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center">
                Sin registros
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Paginación: inútil para 8/10 porque verán 1 ficha */}
      {!esRestringido && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="btn-group">
            <button className="btn btn-outline-primary" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ◀ Anterior
            </button>
            <button className="btn btn-outline-primary" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Siguiente ▶
            </button>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modo === "crear" ? "Nuevo Consultor" : modo === "editar" ? "Editar Consultor" : "Ver Consultor"}
      >
        <div className="row g-3">
          {[
            ["cedularuc", "Cédula o RUC"],
            ["nombre", "Nombre"],
            ["apellido", "Apellido"],
            ["email", "Email"],
            ["fecha_nac", "Fecha de Nacimiento", "date"],
            ["sexo", "Sexo"],
            ["tipo_persona", "Tipo Persona"],
            ["telefono", "Teléfono"],
            ["direccion", "Dirección"],
            ["tipo_empresa", "Tipo Empresa"],
            ["nacionalidad", "Nacionalidad"],
            ["rlegal_cedula", "CI R. Legal"],
            ["rlegal_nombre", "Nombre R. Legal"],
            ["rlegal_apellido", "Apellido R. Legal"],
            ["rlegal_sexo", "Sexo R. Legal"],
            ["dvi", "Dígito Verificador"],
          ].map(([name, label, type = "text"]) => (
            <div className="col-md-6" key={name}>
              <label className="form-label">{label}</label>
              {["sexo", "rlegal_sexo", "tipo_persona", "tipo_empresa"].includes(name) ? (
                <select
                  name={name}
                  className="form-select"
                  value={formData[name] ?? ""}
                  onChange={handleChange}
                  disabled={modo === "ver"}
                >
                  <option value="">Seleccione...</option>
                  {name === "sexo" || name === "rlegal_sexo" ? (
                    <>
                      <option value="F">Femenino</option>
                      <option value="M">Masculino</option>
                    </>
                  ) : name === "tipo_persona" ? (
                    <>
                      <option value="F">Física</option>
                      <option value="J">Jurídica</option>
                    </>
                  ) : (
                    <>
                      <option value="P">Pública</option>
                      <option value="R">Privada</option>
                    </>
                  )}
                </select>
              ) : (
                <input
                  type={type}
                  name={name}
                  className="form-control"
                  value={type === "date" && formData[name] ? String(formData[name]).split("T")[0] : formData[name] ?? ""}
                  onChange={handleChange}
                  disabled={modo === "ver"}
                />
              )}
            </div>
          ))}

          {modo !== "ver" && (
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
