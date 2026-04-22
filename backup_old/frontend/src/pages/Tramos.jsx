// src/pages/Tramos.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Modal from '@/components/Modal';
import ExportEncuestasPdf from '@/components/ExportEncuestasPdf';
import '@/styles/tramos.css';
import { alerts } from '@/utils/alerts'; // ✅ alert.js

const BASE    = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const API_URL = BASE.endsWith('/api') ? BASE : BASE + '/api';

/* ===== helpers auth / fetch ===== */
const authHeaders = () => {
  const t = localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login');
    return null;
  }
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).error || JSON.parse(msg).message || msg; } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
};

/* ===== normalizador para inputs controlados (evita value=null) ===== */
function normalizeTramo(t = {}) {
  return {
    id_tramo:      t.id_tramo ?? null,
    nombre_tramo:  t.nombre_tramo ?? '',
    ubicacion:     t.ubicacion ?? '',
    universo:      t.universo != null ? String(t.universo) : '',

    pk_inicio:     t.pk_inicio != null ? String(t.pk_inicio) : '',
    puntos_inicio: t.puntos_inicio != null ? String(t.puntos_inicio) : '',
    x_inicio:      t.x_inicio != null ? String(t.x_inicio) : '',
    y_inicio:      t.y_inicio != null ? String(t.y_inicio) : '',

    pk_final:      t.pk_final != null ? String(t.pk_final) : '',
    puntos_final:  t.puntos_final != null ? String(t.puntos_final) : '',
    x_final:       t.x_final != null ? String(t.x_final) : '',
    y_final:       t.y_final != null ? String(t.y_final) : '',
  };
}

export default function Tramos() {
  const { id } = useParams(); // gid del proyecto
  const navigate = useNavigate();

  const [tramos, setTramos] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState('crear');

  const [tipoUsuario, setTipoUsuario] = useState(null);

  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [deletingId, setDeletingId]   = useState(null);
  const [closingId, setClosingId]     = useState(null);
  const [exporting, setExporting]     = useState(false);

  // estado inicial seguro (sin nulls)
  const [formData, setFormData] = useState(() => normalizeTramo());

  useEffect(() => {
    cargarTramos();
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setTipoUsuario(payload.tipo_usuario);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function cargarTramos() {
    try {
      setListLoading(true);
      const res  = await fetch(`${API_URL}/tramos/proyectos/${id}/tramos`, { headers: authHeaders() });
      const data = await jsonOrRedirect401(res);
      if (!data) return;
      setTramos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setTramos([]);
      if (alerts?.toast?.error) alerts.toast.error('No se pudieron cargar los tramos.');
      else alert('No se pudieron cargar los tramos.');
    } finally {
      setListLoading(false);
    }
  }

  function abrirModal(accion, tramo = null) {
    setModo(accion);
    setFormData(
      tramo
        ? normalizeTramo(tramo)
        : normalizeTramo({
            id_tramo: null,
            nombre_tramo: '',
            ubicacion: '',
            universo: '',
            pk_inicio: '',
            puntos_inicio: '',
            x_inicio: '',
            y_inicio: '',
            pk_final: '',
            puntos_final: '',
            x_final: '',
            y_final: ''
          })
    );
    setModalOpen(true);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'nombre_tramo' ? value.toUpperCase() : value
    }));
  }

  const sanitize = v => (v === '' ? null : v);

  async function guardar() {
    setSaving(true);

    const url = formData.id_tramo
      ? `${API_URL}/tramos/${formData.id_tramo}`
      : `${API_URL}/tramos/proyectos/${id}/tramos`;
    const metodo = formData.id_tramo ? 'PUT' : 'POST';

    const payload = {
      nombre_tramo: (formData.nombre_tramo || '').toUpperCase(),
      ubicacion: formData.ubicacion || null,
      universo: sanitize(formData.universo),
      pk_inicio: sanitize(formData.pk_inicio),
      puntos_inicio: sanitize(formData.puntos_inicio),
      x_inicio: sanitize(formData.x_inicio),
      y_inicio: sanitize(formData.y_inicio),
      pk_final: sanitize(formData.pk_final),
      puntos_final: sanitize(formData.puntos_final),
      x_final: sanitize(formData.x_final),
      y_final: sanitize(formData.y_final)
    };

    try {
      const res = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload)
      });
      await jsonOrRedirect401(res);

      setModalOpen(false);
      if (alerts?.toast?.success) alerts.toast.success('Tramo guardado correctamente.');
      else alert('Tramo guardado correctamente.');

      cargarTramos();
    } catch (e) {
      console.error('Error guardando tramo:', e);
      const msg = e.message || 'Error al guardar tramo.';
      if (alerts?.toast?.error) alerts.toast.error(msg);
      else alert(msg);
    } finally {
      setSaving(false);
    }
  }

  async function eliminar(id_tramo) {
    if (tipoUsuario !== 1) return;
    if (!window.confirm('¿Seguro que desea eliminar este tramo?')) return;

    try {
      setDeletingId(id_tramo);
      const res = await fetch(`${API_URL}/tramos/${id_tramo}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await jsonOrRedirect401(res);

      if (alerts?.toast?.success) alerts.toast.success('Tramo eliminado correctamente.');
      else alert('Tramo eliminado correctamente.');

      cargarTramos();
    } catch (e) {
      console.error('Error eliminando tramo:', e);
      const msg = e.message || 'Error al eliminar el tramo.';
      if (alerts?.toast?.error) alerts.toast.error(msg);
      else alert(msg);
    } finally {
      setDeletingId(null);
    }
  }

  // ====== Exportar KML / KMZ (solo barra superior) ======
  function buildExportUrl(tipo, tramoValue) {
    const tramo = tramoValue ?? 'all';
    return `${API_URL}/encuestas/export/${tipo}?proyecto=${id}&tramo=${tramo}`;
  }

  async function descargar(tipo, tramoValue = 'all') {
    try {
      setExporting(true);
      const url = buildExportUrl(tipo, tramoValue);
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        let err = await res.text();
        try { err = JSON.parse(err).error || err; } catch {}
        throw new Error(err || `No se pudo exportar ${tipo.toUpperCase()}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const tramoTxt = tramoValue === 'all' ? 'ALL' : tramoValue;
      a.href = URL.createObjectURL(blob);
      a.download = `Encuestas_${id}_${tramoTxt}.${tipo}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);

      if (alerts?.toast?.success) alerts.toast.success(`Exportación ${tipo.toUpperCase()} generada.`);
      else alert(`Exportación ${tipo.toUpperCase()} generada.`);
    } catch (e) {
      console.error('Export error:', e);
      const msg = e.message || 'Error al exportar archivo.';
      if (alerts?.toast?.error) alerts.toast.error(msg);
      else alert(msg);
    } finally {
      setExporting(false);
    }
  }

  // permisos
  const puedeCrear    = [1, 8].includes(tipoUsuario);
  const puedeEditar   = [1, 8].includes(tipoUsuario);
  const puedeEliminar = tipoUsuario === 1;
  const puedeCerrar   = [1, 8].includes(tipoUsuario);
  const puedePOI      = [1, 8].includes(tipoUsuario);

  const estaCerrado = t =>
    t?.cerrado === true || (t?.estado ?? '').toString().toUpperCase() === 'CERRADO';

  async function cerrarTramo(id_tramo) {
    if (!puedeCerrar) return;
    if (!window.confirm('¿Desea cerrar este tramo? Esta acción no se puede editar por encuestas.')) return;

    try {
      setClosingId(id_tramo);
      const res = await fetch(`${API_URL}/tramos/${id_tramo}/cerrar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() }
      });
      await jsonOrRedirect401(res);

      if (alerts?.toast?.success) alerts.toast.success('Tramo cerrado correctamente.');
      else alert('Tramo cerrado correctamente.');

      cargarTramos();
    } catch (e) {
      console.error('Error cerrando tramo:', e);
      const msg = e.message || 'Error al cerrar el tramo.';
      if (alerts?.toast?.error) alerts.toast.error(msg);
      else alert(msg);
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="tramos-page">
      {/* Volver compacto amarillo */}
      <div className="mb-3">
        <button
          type="button"
          className="btn btn-warning btn-sm w-auto d-inline-flex align-items-center gap-2 px-3 py-1 shadow-sm"
          style={{ width: 'auto' }}
          onClick={() => navigate('/proyectos')}
        >
          ← Volver a Proyectos
        </button>
      </div>

      {/* Toolbar: PDF (izq) + Export KML/KMZ ALL (der) */}
      <div className="py-2 toolbar-enhanced">
        <ExportEncuestasPdf />

        <div className="export-earth">
          <span className="label">Exportar a Google Earth</span>
          <button
            className="btn btn-outline-primary btn-sm"
            disabled={exporting}
            onClick={() => descargar('kml', 'all')}
            title="Descargar KML (todas las encuestas)"
          >
            {exporting ? 'Generando…' : '📍 KML'}
          </button>
          <button
            className="btn btn-outline-success btn-sm"
            disabled={exporting}
            onClick={() => descargar('kmz', 'all')}
            title="Descargar KMZ (todas las encuestas)"
          >
            {exporting ? 'Generando…' : '📦 KMZ'}
          </button>
        </div>
      </div>

      <h2 className="title">Tramos del Proyecto {id}</h2>

      {listLoading && (
        <div className="alert alert-info py-2">Cargando tramos…</div>
      )}

      {/* Botón “Nuevo Tramo” pill y a la derecha */}
      <div className="mb-3 d-flex">
        {puedeCrear && (
          <button className="btn-new-tramo ms-auto" onClick={() => abrirModal('crear')}>
            <span className="me-1">➕</span> Nuevo Tramo
          </button>
        )}
      </div>

      {/* Grid de tarjetas */}
      <div className="tramos-grid">
        {tramos.map((t) => (
          <div className={`tramo-card ${estaCerrado(t) ? 'is-closed' : ''}`} key={t.id_tramo}>
            <div className="tramo-card__head">
              <h5 className="tramo-card__title">{t.nombre_tramo}</h5>
              {estaCerrado(t) && <span className="badge text-bg-secondary">CERRADO</span>}
            </div>

            <div className="tramo-card__meta">
              <div className="meta-row">
                <span className="meta-label">Ubicación:</span>
                <span className="meta-value">{t.ubicacion || '—'}</span>
              </div>
            </div>

            <div className="tramo-card__actions">
              {puedeEditar && (
                <button
                  className="btn btn-warning btn-sm"
                  onClick={() => abrirModal('editar', t)}
                  disabled={estaCerrado(t)}
                >
                  Editar
                </button>
              )}
              {puedeEliminar && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => eliminar(t.id_tramo)}
                  disabled={estaCerrado(t) || deletingId === t.id_tramo}
                >
                  {deletingId === t.id_tramo ? 'Eliminando…' : 'Eliminar'}
                </button>
              )}
              <button
                className="btn btn-info btn-sm text-white"
                onClick={() => abrirModal('ver', t)}
              >
                Ver
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/encuestas/${id}/${t.id_tramo}`, { state: { nombreTramo: t.nombre_tramo } })}
              >
                📋 Censo
              </button>

              {puedePOI && (
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => navigate(`/poi/${id}/${t.id_tramo}`, { state: { nombreTramo: t.nombre_tramo } })}
                  title="Gestionar puntos de interés del tramo"
                >
                  📍 POI
                </button>
              )}

              {puedeCerrar && !estaCerrado(t) && (
                <button
                  className="btn btn-outline-dark btn-sm"
                  onClick={() => cerrarTramo(t.id_tramo)}
                  disabled={closingId === t.id_tramo}
                >
                  {closingId === t.id_tramo ? 'Cerrando…' : '🔒 Cerrar'}
                </button>
              )}
            </div>
          </div>
        ))}

        {!listLoading && tramos.length === 0 && (
          <div className="empty-grid">No hay tramos para este proyecto.</div>
        )}
      </div>

      {/* Modal Crear/Editar/Ver Tramo */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modo === 'crear' ? 'Nuevo Tramo' : modo === 'editar' ? 'Editar Tramo' : 'Ver Tramo'}
      >
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">Nombre del tramo</label>
            <input
              type="text"
              name="nombre_tramo"
              className="form-control"
              value={formData.nombre_tramo}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Ubicación</label>
            <input
              type="text"
              name="ubicacion"
              className="form-control"
              value={formData.ubicacion}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Universo</label>
            <input
              type="number"
              name="universo"
              className="form-control"
              value={formData.universo}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">PK Inicio</label>
            <input
              type="text"
              name="pk_inicio"
              className="form-control"
              value={formData.pk_inicio}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Puntos Inicio</label>
            <input
              type="text"
              name="puntos_inicio"
              className="form-control"
              value={formData.puntos_inicio}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">X Inicio</label>
            <input
              type="text"
              name="x_inicio"
              className="form-control"
              value={formData.x_inicio}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Y Inicio</label>
            <input
              type="text"
              name="y_inicio"
              className="form-control"
              value={formData.y_inicio}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">PK Final</label>
            <input
              type="text"
              name="pk_final"
              className="form-control"
              value={formData.pk_final}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Puntos Final</label>
            <input
              type="text"
              name="puntos_final"
              className="form-control"
              value={formData.puntos_final}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">X Final</label>
            <input
              type="text"
              name="x_final"
              className="form-control"
              value={formData.x_final}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Y Final</label>
            <input
              type="text"
              name="y_final"
              className="form-control"
              value={formData.y_final}
              onChange={handleChange}
              disabled={modo === 'ver'}
            />
          </div>

          {modo !== 'ver' && (
            <div className="col-12 text-end">
              <button className="btn btn-primary" onClick={guardar} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
