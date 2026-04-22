// src/components/poi/ModalPoiCategoria.jsx
import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { Spinner } from "react-bootstrap";
import { alerts } from "@/utils/alerts";
import {
  listPoiCategorias,
  createPoiCategoria,
  updatePoiCategoria,
  deletePoiCategoria,
  uploadPoiCategoriaIcon,
} from "@/services/poiCategoryService";

const BUILTIN_ICON_KEYS = [
  "marker","pin","star","flag","info","warning","hospital","school","police",
  "shopping","tree","factory","home","building","church",
];

export default function ModalPoiCategoria({ open, onClose, onSaved }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [modalForm, setModalForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formErr, setFormErr] = useState(null);

  const [form, setForm] = useState({
    id: null,
    nombre: "",
    color: "#6c757d",
    icon_type: "builtin", // builtin | url | upload
    icon_key: "marker",
    icon_url: "",
    activo: true,
  });

  async function load() {
    setLoading(true);
    try {
      const resp = await listPoiCategorias({ activa: showInactive ? "all" : "true" });
      setRows(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error ? alerts.toast.error(e.message || "No se pudo cargar categorías.") : alert(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showInactive]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => (r.nombre || "").toLowerCase().includes(qq));
  }, [rows, q]);

  function openCreate() {
    setFormErr(null);
    setForm({
      id: null,
      nombre: "",
      color: "#6c757d",
      icon_type: "builtin",
      icon_key: "marker",
      icon_url: "",
      activo: true,
    });
    setModalForm(true);
  }

  function openEdit(r) {
    setFormErr(null);
    setForm({
      id: r.id,
      nombre: r.nombre || "",
      color: r.color || "#6c757d",
      icon_type: r.icon_type || "builtin",
      icon_key: r.icon_key || "marker",
      icon_url: r.icon_url || "",
      activo: !!r.activo,
    });
    setModalForm(true);
  }

  function onChange(e) {
    const { name, value, type, checked } = e.target;
    if (type === "checkbox") {
      setForm((p) => ({ ...p, [name]: checked }));
      return;
    }
    setForm((p) => ({ ...p, [name]: value }));
  }

  async function onUploadIcon(file) {
    if (!file) return;
    setFormErr(null);
    setUploading(true);
    try {
      const url = await uploadPoiCategoriaIcon({ file });
      setForm((p) => ({ ...p, icon_url: url, icon_type: "upload" }));
      alerts?.toast?.success ? alerts.toast.success("Ícono subido.") : console.info("Ícono subido");
    } catch (e) {
      console.error(e);
      setFormErr(e.message || "No se pudo subir el ícono");
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    try {
      setFormErr(null);
      setSaving(true);

      if (!form.nombre.trim()) throw new Error("Ingrese el nombre de la categoría");

      const payload = {
        nombre: form.nombre.trim(),
        color: form.color || "#6c757d",
        icon_type: form.icon_type,
        icon_key: form.icon_type === "builtin" ? form.icon_key : "marker",
        icon_url: form.icon_type === "url" || form.icon_type === "upload" ? (form.icon_url || null) : null,
        activo: !!form.activo,
      };

      if (form.id) await updatePoiCategoria(form.id, payload);
      else await createPoiCategoria(payload);

      setModalForm(false);
      alerts?.toast?.success ? alerts.toast.success("Categoría guardada.") : alert("Categoría guardada.");

      await load();
      onSaved?.(); // ✅ avisar al padre que recargue combos
    } catch (e) {
      console.error(e);
      setFormErr(e.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(r) {
    if (!window.confirm(`¿Eliminar categoría "${r.nombre}"?`)) return;
    try {
      await deletePoiCategoria(r.id);
      alerts?.toast?.success ? alerts.toast.success("Categoría eliminada.") : alert("Categoría eliminada.");
      await load();
      onSaved?.();
    } catch (e) {
      console.error(e);
      alerts?.toast?.error ? alerts.toast.error(e.message) : alert(e.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Categorías de POI">
      {/* Toolbar */}
      <div className="d-flex align-items-center gap-2 mb-3">
        <input
          className="form-control"
          style={{ maxWidth: 260 }}
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="form-check ms-2">
          <input
            className="form-check-input"
            type="checkbox"
            id="showInactiveCats"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="showInactiveCats">
            Ver inactivas
          </label>
        </div>

        <div className="ms-auto">
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            ➕ Nueva categoría
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="table-responsive">
        <table className="table table-bordered table-hover mb-0">
          <thead className="table-light">
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>Nombre</th>
              <th style={{ width: 110 }}>Color</th>
              <th style={{ width: 220 }}>Ícono</th>
              <th style={{ width: 90 }}>Activo</th>
              <th className="text-end" style={{ width: 180 }}>
                Acciones
              </th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Cargando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center">
                  Sin resultados
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    <span className="badge" style={{ background: r.color || "#6c757d", color: "#fff" }}>
                      {r.nombre}
                    </span>
                  </td>
                  <td><code>{r.color}</code></td>
                  <td>
                    {r.icon_type === "builtin"
                      ? `Builtin: ${r.icon_key || "marker"}`
                      : r.icon_url
                        ? `URL: ${r.icon_url}`
                        : "—"}
                  </td>
                  <td>{r.activo ? "Sí" : "No"}</td>
                  <td className="text-end">
                    <div className="btn-group btn-group-sm">
                      <button className="btn btn-warning" onClick={() => openEdit(r)}>Editar</button>
                      <button className="btn btn-danger" onClick={() => onDelete(r)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Sub-modal Form */}
      <Modal
        open={modalForm}
        onClose={() => setModalForm(false)}
        title={form.id ? "Editar categoría" : "Nueva categoría"}
      >
        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label">Nombre</label>
            <input className="form-control" name="nombre" value={form.nombre} onChange={onChange} />
          </div>

          <div className="col-md-4">
            <label className="form-label">Color</label>
            <input
              type="color"
              className="form-control form-control-color"
              name="color"
              value={form.color}
              onChange={onChange}
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Tipo de ícono</label>
            <select className="form-control" name="icon_type" value={form.icon_type} onChange={onChange}>
              <option value="builtin">Builtin (del sistema)</option>
              <option value="url">URL (ícono propio)</option>
              <option value="upload">Subir archivo (png/svg)</option>
            </select>
          </div>

          {form.icon_type === "builtin" ? (
            <div className="col-md-6">
              <label className="form-label">Ícono builtin</label>
              <select className="form-control" name="icon_key" value={form.icon_key} onChange={onChange}>
                {BUILTIN_ICON_KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          ) : form.icon_type === "url" ? (
            <div className="col-md-6">
              <label className="form-label">Icon URL</label>
              <input className="form-control" name="icon_url" value={form.icon_url} onChange={onChange} placeholder="https://.../icon.png" />
            </div>
          ) : (
            <div className="col-md-6">
              <label className="form-label">Subir ícono</label>
              <input
                type="file"
                accept="image/*,.svg"
                className="form-control"
                onChange={(e) => onUploadIcon(e.target.files?.[0])}
                disabled={uploading}
              />
              {uploading && (
                <small className="text-muted d-inline-flex align-items-center mt-1">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Subiendo…
                </small>
              )}
              {!!form.icon_url && <small className="text-muted d-block mt-1">Guardado como URL: {form.icon_url}</small>}
            </div>
          )}

          <div className="col-12">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" name="activo" id="catActivo" checked={form.activo} onChange={onChange} />
              <label className="form-check-label" htmlFor="catActivo">Activo</label>
            </div>
          </div>

          {formErr && (
            <div className="col-12">
              <div className="alert alert-danger py-2">{formErr}</div>
            </div>
          )}

          <div className="col-12 text-end">
            <button className="btn btn-primary" onClick={onSave} disabled={saving || uploading}>
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Guardando…
                </>
              ) : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
