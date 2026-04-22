// src/pages/PoiTramo.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import Modal from "@/components/Modal";
import ModalPoiCategoria from "@/components/poi/ModalPoiCategoria"; // ✅ NUEVO
import { Container, Spinner } from "react-bootstrap";
import { alerts } from "@/utils/alerts";
import {
  listPoiByTramo,
  listPoiByProyecto,
  createPoi,
  updatePoi,
  deletePoi,
  uploadPoiPhoto,
  resolveImgUrl,
} from "@/services/poiService";
import { listPoiCategorias } from "@/services/poiCategoryService";
import "@/styles/tramos.css";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/** Badge por color de categoría */
function badgeStyleFromColor(color) {
  return {
    backgroundColor: color || "#6c757d",
    color: "#fff",
    fontWeight: 600,
  };
}

/** Fallback legacy: si venía categoria texto vieja */
function legacyToCategoriaId(categorias, legacyText) {
  if (!legacyText) return null;
  const up = String(legacyText).trim().toUpperCase();

  const foundByName = categorias.find((c) => String(c.nombre).trim().toUpperCase() === up);
  if (foundByName) return foundByName.id;

  const map = {
    ESCUELA: "Instituciones Educativas",
    SALUD: "Servicios Médicos",
    INSTITUCION: "Entes Estatales",
    OTRO: "Actividades sociales y recreativas",
  };
  const mapped = map[up];
  if (!mapped) return null;

  const found = categorias.find((c) => String(c.nombre).trim().toUpperCase() === mapped.toUpperCase());
  return found ? found.id : null;
}

export default function PoiTramo() {
  const { idProyecto, idTramo } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const isTramoMode = idTramo != null;

  const [rows, setRows] = useState([]);
  const [paging, setPaging] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // ✅ categorías desde BD
  const [catsLoading, setCatsLoading] = useState(false);
  const [categorias, setCategorias] = useState([]);

  // ✅ NUEVO: modal categorías
  const [catsModalOpen, setCatsModalOpen] = useState(false);

  // ✅ form ahora usa categoria_id
  const [form, setForm] = useState({
    id: null,
    categoria_id: null,
    titulo: "",
    descripcion: "",
    foto_url: "",
    lat: "",
    lng: "",
    atributos: {},
  });

  const [tituloPantalla, setTituloPantalla] = useState(() => {
    if (!isTramoMode) return `POI (Libres) — Proyecto ${idProyecto}`;
    const n = location.state?.nombreTramo;
    return n
      ? `POI del Tramo “${String(n).toUpperCase()}” — Proyecto ${idProyecto}`
      : `POI del Tramo ${idTramo} — Proyecto ${idProyecto}`;
  });

  async function fetchNombreTramo() {
    if (!isTramoMode) return;
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("token")}` };
      const r = await fetch(`${API_URL}/tramos/proyectos/${idProyecto}/tramos`, { headers });
      if (!r.ok) throw new Error(await r.text());
      const list = await r.json();
      const t = (Array.isArray(list) ? list : []).find((x) => String(x.id_tramo) === String(idTramo));
      const nombre = t?.nombre_tramo ? t.nombre_tramo : `Tramo ${idTramo}`;
      setTituloPantalla(`POI del Tramo “${String(nombre).toUpperCase()}” — Proyecto ${idProyecto}`);
    } catch {
      setTituloPantalla(`POI del Tramo ${idTramo} — Proyecto ${idProyecto}`);
    }
  }

  async function loadCategorias() {
    setCatsLoading(true);
    try {
      const resp = await listPoiCategorias({ activa: "true" });
      const list = Array.isArray(resp?.data) ? resp.data : [];
      setCategorias(list);
    } catch (e) {
      console.error(e);
      setCategorias([]);
      alerts?.toast?.error
        ? alerts.toast.error(e.message || "No se pudo cargar categorías.")
        : console.error(e.message);
    } finally {
      setCatsLoading(false);
    }
  }

  async function load(page = 1) {
    setLoading(true);
    try {
      let resp;
      if (isTramoMode) {
        resp = await listPoiByTramo(idTramo, { page, limit: 20 });
      } else {
        resp = await listPoiByProyecto(idProyecto, { page, limit: 20, tramo: "none" });
      }

      const data = Array.isArray(resp?.data) ? resp.data : [];

      const norm = data.map((r) => {
        const catName = r?.categoria_obj?.nombre || r?.categoria || "";
        const color = r?.categoria_obj?.color || "#6c757d";
        return { ...r, __catName: catName, __catColor: color };
      });

      setRows(norm);
      setPaging(resp.paging || { page, limit: 20, total: norm.length || 0 });
    } catch (e) {
      console.error(e);
      setRows([]);
      setPaging((p) => ({ ...p, total: 0 }));
      alerts?.toast?.error ? alerts.toast.error(e.message || "No se pudo cargar la lista.") : console.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategorias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(1);
    if (isTramoMode) {
      if (!location.state?.nombreTramo) fetchNombreTramo();
      else {
        const n = location.state.nombreTramo;
        setTituloPantalla(`POI del Tramo “${String(n).toUpperCase()}” — Proyecto ${idProyecto}`);
      }
    } else {
      setTituloPantalla(`POI (Libres) — Proyecto ${idProyecto}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProyecto, idTramo]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const qq = q.trim().toLowerCase();
    return rows.filter((r) => (r.titulo || "").toLowerCase().includes(qq));
  }, [rows, q]);

  function openCreate() {
    setFormErr(null);
    const defaultCatId = categorias[0]?.id ?? null;

    setForm({
      id: null,
      categoria_id: defaultCatId,
      titulo: "",
      descripcion: "",
      foto_url: "",
      lat: "",
      lng: "",
      atributos: {},
    });
    setModalOpen(true);
  }

  function openEdit(row) {
    setFormErr(null);

    const resolvedCatId =
      row?.categoria_id ??
      legacyToCategoriaId(categorias, row?.categoria) ??
      categorias[0]?.id ??
      null;

    setForm({
      id: row.id,
      categoria_id: resolvedCatId,
      titulo: row.titulo || "",
      descripcion: row.descripcion || "",
      foto_url: row.foto_url || "",
      lat: row.lat ?? "",
      lng: row.lng ?? "",
      atributos: row.atributos || {},
    });
    setModalOpen(true);
  }

  function onChange(e) {
    const { name, value } = e.target;

    if (name === "categoria_id") {
      setForm((prev) => ({ ...prev, categoria_id: value ? Number(value) : null }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function onUploadFile(file) {
    if (!file) return;
    setFormErr(null);
    setUploading(true);
    try {
      const url = await uploadPoiPhoto({
        id_proyecto: idProyecto,
        id_tramo: isTramoMode ? idTramo : null,
        file,
      });
      setForm((prev) => ({ ...prev, foto_url: url }));
      alerts?.toast?.success ? alerts.toast.success("Imagen subida correctamente.") : console.info("Imagen subida.");
    } catch (e) {
      const msg = e.message || "Error subiendo imagen";
      setFormErr(msg);
      alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
    } finally {
      setUploading(false);
    }
  }

  function validateLatLng(lat, lng) {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (Number.isNaN(la) || Number.isNaN(lo)) throw new Error("Lat/Lng inválidos");
    if (la < -90 || la > 90) throw new Error("Lat fuera de rango (-90 a 90)");
    if (lo < -180 || lo > 180) throw new Error("Lng fuera de rango (-180 a 180)");
    return { la, lo };
  }

  async function onSave() {
    try {
      setFormErr(null);
      setSaving(true);

      if (!form.titulo.trim()) throw new Error("Ingrese un título");
      if (form.lat === "" || form.lng === "") throw new Error("Ingrese Lat y Lng");
      const { la, lo } = validateLatLng(form.lat, form.lng);

      if (!form.categoria_id) throw new Error("Seleccione una categoría");

      const payload = {
        id_proyecto: Number(idProyecto),
        id_tramo: isTramoMode ? Number(idTramo) : null,
        categoria_id: form.categoria_id,
        titulo: form.titulo,
        descripcion: form.descripcion || null,
        foto_url: form.foto_url || null,
        lat: la,
        lng: lo,
        atributos: form.atributos || {},
      };

      if (form.id) await updatePoi(form.id, payload);
      else await createPoi(payload);

      setModalOpen(false);
      alerts?.toast?.success ? alerts.toast.success("POI guardado correctamente.") : console.info("POI guardado.");
      await load(paging.page);
    } catch (e) {
      console.error(e);
      const msg = e.message || "No se pudo guardar";
      setFormErr(msg);
      alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row) {
    if (!window.confirm(`¿Eliminar "${row.titulo}"?`)) return;
    setDeletingId(row.id);
    try {
      await deletePoi(row.id);
      alerts?.toast?.success ? alerts.toast.success("POI eliminado.") : console.info("POI eliminado.");
      await load(paging.page);
    } catch (e) {
      console.error(e);
      const msg = e.message || "No se pudo eliminar.";
      alerts?.toast?.error ? alerts.toast.error(msg) : console.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil((paging.total || 0) / (paging.limit || 20)));

  return (
    <div className="container py-4">
      {/* Volver */}
      <div className="mb-3 d-flex gap-2">
        <button
          type="button"
          className="btn btn-warning btn-sm w-auto d-inline-flex align-items-center gap-2 px-3 py-1 shadow-sm"
          onClick={() => (isTramoMode ? navigate(`/proyectos/${idProyecto}/tramos`) : navigate(`/proyectos/${idProyecto}`))}
        >
          ← Volver
        </button>

        {isTramoMode && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(`/proyectos/${idProyecto}/poi`)}
            title="POI libres del proyecto"
          >
            Ver POI libres
          </button>
        )}

        {!isTramoMode && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(`/proyectos/${idProyecto}/tramos`)}
            title="Volver a tramos"
          >
            Ir a Tramos
          </button>
        )}
      </div>

      {/* Toolbar */}
      <Container fluid className="py-2">
        <div className="toolbar-enhanced d-flex align-items-center gap-2">
          <h2 className="m-0">{tituloPantalla}</h2>

          <div className="ms-auto d-flex align-items-center gap-2">
            <input
              className="form-control"
              style={{ maxWidth: 260 }}
              placeholder="Buscar por título…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn-new-tramo" onClick={openCreate} disabled={catsLoading || categorias.length === 0}>
              <span className="me-1">➕</span> Nuevo POI
            </button>
          </div>
        </div>
      </Container>

      <table className="table table-bordered table-hover mt-3">
        <thead className="table-light">
          <tr>
            <th style={{ width: 100 }}>Foto</th>
            <th>Título</th>
            <th style={{ width: 240 }}>Categoría</th>
            <th style={{ width: 160 }}>Lat</th>
            <th style={{ width: 160 }}>Lng</th>
            <th className="text-end" style={{ minWidth: 220 }}>
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
                <td>
                  {r.foto_url ? (
                    <img
                      src={resolveImgUrl(r.foto_url)}
                      alt=""
                      style={{ width: 84, height: 56, objectFit: "cover", borderRadius: 6 }}
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>

                <td>{r.titulo}</td>

                <td>
                  <span className="badge" style={badgeStyleFromColor(r?.categoria_obj?.color || r.__catColor)}>
                    {r?.categoria_obj?.nombre || r.__catName || "—"}
                  </span>
                </td>

                <td>{r.lat}</td>
                <td>{r.lng}</td>

                <td className="text-end actions-cell">
                  <div className="btn-group btn-group-sm" role="group" aria-label="Acciones">
                    <button className="btn btn-warning" onClick={() => openEdit(r)} disabled={deletingId === r.id}>
                      Editar
                    </button>
                    <button className="btn btn-danger" onClick={() => onDelete(r)} disabled={deletingId === r.id}>
                      {deletingId === r.id ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-1" />
                          Eliminando…
                        </>
                      ) : (
                        "Eliminar"
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Paginación */}
      <div className="d-flex justify-content-end align-items-center gap-2">
        <span className="text-muted small">
          Página {paging.page} de {totalPages} — Total: {paging.total}
        </span>
        <button
          className="btn btn-outline-secondary btn-sm"
          disabled={paging.page <= 1 || loading}
          onClick={() => load(paging.page - 1)}
          title="Anterior"
        >
          ◀
        </button>
        <button
          className="btn btn-outline-secondary btn-sm"
          disabled={paging.page >= totalPages || loading}
          onClick={() => load(paging.page + 1)}
          title="Siguiente"
        >
          ▶
        </button>
      </div>

      {/* Modal Crear/Editar POI */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? "Editar POI" : "Nuevo POI"}>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">Categoría</label>

            {catsLoading ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                <span className="text-muted">Cargando categorías…</span>
              </div>
            ) : (
              <div className="d-flex gap-2">
                <select
                  name="categoria_id"
                  className="form-control"
                  value={form.categoria_id ?? ""}
                  onChange={onChange}
                >
                  <option value="" disabled>
                    Seleccionar…
                  </option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>

                {/* ✅ NUEVO: ABM categorías */}
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setCatsModalOpen(true)}
                  title="Administrar categorías"
                >
                  ⚙️
                </button>
              </div>
            )}
          </div>

          <div className="col-md-6">
            <label className="form-label">Título</label>
            <input
              className="form-control"
              name="titulo"
              value={form.titulo}
              onChange={onChange}
              placeholder="Ej.: Escuela / Comisaría / Puente…"
            />
          </div>

          <div className="col-12">
            <label className="form-label">Descripción (opcional)</label>
            <input className="form-control" name="descripcion" value={form.descripcion} onChange={onChange} />
          </div>

          <div className="col-md-6">
            <label className="form-label">Latitud (EPSG:4326)</label>
            <input
              type="number"
              step="0.0000001"
              className="form-control"
              name="lat"
              value={form.lat}
              onChange={onChange}
              placeholder="-25.2629"
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Longitud (EPSG:4326)</label>
            <input
              type="number"
              step="0.0000001"
              className="form-control"
              name="lng"
              value={form.lng}
              onChange={onChange}
              placeholder="-57.5139"
            />
          </div>

          <div className="col-12">
            <label className="form-label">Imagen</label>
            <input
              type="file"
              accept="image/*"
              className="form-control"
              onChange={(e) => onUploadFile(e.target.files?.[0])}
              disabled={uploading}
            />
            {uploading && (
              <small className="text-muted d-inline-flex align-items-center mt-1">
                <Spinner animation="border" size="sm" className="me-2" />
                Subiendo imagen…
              </small>
            )}
            <input
              type="text"
              className="form-control mt-2"
              name="foto_url"
              value={form.foto_url}
              onChange={onChange}
              placeholder="o pega una URL pública"
            />
            {form.foto_url && (
              <div className="mt-2">
                <img
                  src={resolveImgUrl(form.foto_url)}
                  alt="preview"
                  style={{ maxWidth: 280, maxHeight: 160, borderRadius: 8 }}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              </div>
            )}
          </div>

          {formErr && (
            <div className="col-12">
              <div className="alert alert-danger py-2">{formErr}</div>
            </div>
          )}

          <div className="col-12 text-end">
            <button className="btn btn-primary" onClick={onSave} disabled={saving || catsLoading}>
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Guardando…
                </>
              ) : form.id ? (
                "Guardar cambios"
              ) : (
                "Crear POI"
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ✅ NUEVO: Modal ABM Categorías */}
      <ModalPoiCategoria
        open={catsModalOpen}
        onClose={() => setCatsModalOpen(false)}
        onSaved={async () => {
          await loadCategorias();
          // si no hay categoría seleccionada, deja la primera
          setForm((p) => ({
            ...p,
            categoria_id: p.categoria_id ?? (categorias[0]?.id ?? null),
          }));
        }}
      />
    </div>
  );
}
