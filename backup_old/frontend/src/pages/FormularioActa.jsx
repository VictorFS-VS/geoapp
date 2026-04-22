// frontend/src/pages/FormularioActa.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { alerts } from '@/utils/alerts';

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat, toLonLat } from 'ol/proj';
import 'ol/ol.css';

const BASE    = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const API_URL = BASE.endsWith('/api') ? BASE : BASE + '/api';

/* ============ helpers ============ */
function getFilenameFromDisposition(cd, fallback) {
  try {
    if (!cd) return fallback;
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(cd);
    const raw = decodeURIComponent(m?.[1] || m?.[2] || '');
    return raw || fallback;
  } catch {
    return fallback;
  }
}
const getBearer = () => {
  const t = localStorage.getItem('token');
  return t?.startsWith('Bearer ') ? t : (t ? `Bearer ${t}` : null);
};
const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
};
const redirect401 = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.replace('/login');
};
const jsonOrRedirect401 = async (res) => {
  if (res.status === 401) { redirect401(); return null; }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export default function FormularioActa() {
  const { id } = useParams(); // id del proyecto
  const navigate = useNavigate();
  const abortRef = useRef(null);

  const [formData, setFormData] = useState({
    id_tramo: '',
    nombre_proyecto: '',
    tramo_proyecto: '',
    fecha_relevamiento: new Date().toISOString().slice(0, 10),
    nombre_arquitecto: '',
    matricula_arquitecto: '',
    direccion_predio: '',
    identificacion_catastral: '',
    nombre_propietario: '',
    cedula_propietario: '',
    contacto_propietario: '',
    tipo_cerramiento: '',
    revestimiento_fachada: '',
    estado_general_fachada: 'Bueno',
    lista_patologias_fachada: '',
    observaciones_fachada: '',
    material_vereda: '',
    estado_general_vereda: 'Bueno',
    lista_patologias_vereda: '',
    observaciones_vereda: '',
    tipo_estructura_visible: '',
    estado_elementos_estructurales: 'Bueno',
    observaciones_estructura: '',
    coordenada_x: '',
    coordenada_y: '',
    // NUEVOS
    progresivas: '',
    lado: '',
    observaciones_adicionales: '',
  });

  const [tramos, setTramos] = useState([]);
  const [loading, setLoading] = useState(false);

  const [galerias, setGalerias] = useState({
    fachada: [],
    vereda: [],
    estructura: [],
  });
  const [firmaPropietario, setFirmaPropietario] = useState(null);
  const [firmaArquitecto,  setFirmaArquitecto]  = useState(null);

  // refs para el mapa
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerLayerRef = useRef(null);

  /* cleanup previews/abort/map */
  useEffect(() => {
    return () => {
      ['fachada', 'vereda', 'estructura'].forEach(cat => {
        galerias[cat].forEach(item => URL.revokeObjectURL(item.previewUrl));
      });
      if (abortRef.current) abortRef.current.abort();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* inicializar mapa una sola vez */
  useEffect(() => {
    if (!mapRef.current) return;

    const markerSource = new VectorSource();
    const markerLayer = new VectorLayer({ source: markerSource });

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        markerLayer,
      ],
      view: new View({
        center: fromLonLat([-57.5, -25.3]), // centro genérico Paraguay
        zoom: 6,
      }),
    });

    // click en el mapa -> actualizar coordenadas
    map.on('click', (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate);
      setFormData(prev => ({
        ...prev,
        coordenada_x: lon.toFixed(6),
        coordenada_y: lat.toFixed(6),
      }));
    });

    mapInstanceRef.current = map;
    markerLayerRef.current  = markerLayer;

    return () => {
      map.setTarget(null);
    };
  }, []);

  /* cuando cambian las coordenadas en el form -> mover marcador + zoom */
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;

    const lon = parseFloat(formData.coordenada_x);
    const lat = parseFloat(formData.coordenada_y);
    const markerSource = markerLayer.getSource();
    markerSource.clear();

    if (!isNaN(lon) && !isNaN(lat)) {
      const feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
      });
      markerSource.addFeature(feature);
      map.getView().animate({
        center: fromLonLat([lon, lat]),
        zoom: 18,
        duration: 500,
      });
    }
  }, [formData.coordenada_x, formData.coordenada_y]);

  /* precarga proyecto + tramos + geolocalización */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/proyectos/${id}`, { headers: { ...authHeaders() } });
        const p = await jsonOrRedirect401(res);
        if (!p) return;
        setFormData(prev => ({ ...prev, nombre_proyecto: p.nombre || '' }));

        const tramosRes = await fetch(`${API_URL}/tramos/proyectos/${id}/tramos`, {
          headers: { ...authHeaders() }
        });
        const t = await jsonOrRedirect401(tramosRes);
        if (!t) return;

        setTramos(Array.isArray(t) ? t : []);
        if (Array.isArray(t) && t.length > 0) {
          setFormData(prev => ({
            ...prev,
            tramo_proyecto: t[0].nombre_tramo || '',
            id_tramo: t[0].id_tramo || ''
          }));
        }
      } catch (e) {
        console.error('Error precargando datos', e);
        alerts.toast.error('No se pudieron precargar los datos del proyecto/tramos.');
      }
    })();

    // geolocalización inicial para centrar mapa
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        setFormData(prev => ({
          ...prev,
          coordenada_x: pos.coords.longitude.toFixed(6),
          coordenada_y: pos.coords.latitude.toFixed(6),
        }));
      }, () => {});
    }
  }, [id]);

  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTramoChange = e => {
    const selected = tramos.find(t => String(t.id_tramo) === e.target.value);
    setFormData(prev => ({
      ...prev,
      tramo_proyecto: selected?.nombre_tramo || '',
      id_tramo: selected?.id_tramo || '',
    }));
  };

  const handleFirmaChange = (e) => {
    if (e.target.name === 'firma_propietario_img') {
      setFirmaPropietario(e.target.files[0]);
    } else if (e.target.name === 'firma_arquitecto_img') {
      setFirmaArquitecto(e.target.files[0]);
    }
  };

  const handleGaleriaChange = (categoria, e) => {
    const nuevosArchivos = Array.from(e.target.files).map(file => ({
      file,
      descripcion: '',
      previewUrl: URL.createObjectURL(file)
    }));
    setGalerias(prev => ({
      ...prev,
      [categoria]: [...prev[categoria], ...nuevosArchivos]
    }));
  };

  const handleDescripcionChange = (categoria, index, value) => {
    const galeriaActualizada = [...galerias[categoria]];
    galeriaActualizada[index].descripcion = value;
    setGalerias(prev => ({ ...prev, [categoria]: galeriaActualizada }));
  };

  const handleRemoveFoto = (categoria, index) => {
    const fotoARemover = galerias[categoria][index];
    URL.revokeObjectURL(fotoARemover.previewUrl);
    const galeriaActualizada = galerias[categoria].filter((_, i) => i !== index);
    setGalerias(prev => ({ ...prev, [categoria]: galeriaActualizada }));
  };

  const validateMinimum = () => {
    if (!formData.id_tramo) return 'Debe seleccionar un tramo válido.';
    if (!formData.nombre_propietario) return 'Debe ingresar el nombre del propietario.';
    if (!formData.direccion_predio) return 'Debe ingresar la dirección del predio.';
    return null;
  };

  const buildFormData = () => {
    const data = new FormData();
    Object.entries(formData).forEach(([k, v]) => {
      if (v !== undefined && v !== null) data.append(k, v);
    });
    for (const categoria of ['fachada', 'vereda', 'estructura']) {
      const arr = galerias[categoria];
      arr.forEach(item => data.append(`fotos_${categoria}`, item.file));
      arr.forEach(item => data.append(`descripciones_${categoria}`, item.descripcion || ''));
    }
    if (firmaPropietario) data.append('firma_propietario_img', firmaPropietario);
    if (firmaArquitecto)  data.append('firma_arquitecto_img',  firmaArquitecto);
    return data;
  };

  const downloadFromEndpoint = async (endpointUrl, fallbackName) => {
    const err = validateMinimum();
    if (err) { alerts.toast.warn(err); return; }

    setLoading(true);
    const data = buildFormData();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      alerts.loading('Generando archivo…');
      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers: { ...authHeaders() }, // no Content-Type (multipart)
        body: data,
        signal: ac.signal
      });

      if (res.status === 401) { alerts.close(); redirect401(); return; }

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (ct.includes('application/json')) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.detalle || json.error || json.message || `HTTP ${res.status}`);
        } else {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
      }

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition');
      const filename = getFilenameFromDisposition(cd, fallbackName);

      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      console.info(`Archivo descargado: ${filename}`);
      alerts.toast.success('Archivo generado y descargado correctamente.');
      navigate('/proyectos');
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Error en descarga:', e);
      alerts.toast.error('Error al generar archivo: ' + (e.message || 'desconocido'));
    } finally {
      alerts.close();
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleSubmitPDF = (e) => {
    e.preventDefault();
    downloadFromEndpoint(
      `${API_URL}/proyectos/${id}/actas-preconstruccion-pdf`,
      `ActaPreconstruccion_${id}.pdf`
    );
  };

  const handleGenerateDOCX = () => {
    downloadFromEndpoint(
      `${API_URL}/proyectos/${id}/actas-preconstruccion-docx`,
      `ActaPreconstruccion_${id}.docx`
    );
  };

  const renderGaleria = (categoria, titulo) => (
    <div className="mb-4">
      <h5 className="mb-3">{titulo}</h5>
      <input
        type="file"
        onChange={(e) => handleGaleriaChange(categoria, e)}
        className="form-control mb-2"
        multiple
        accept="image/*"
      />
      <div className="mt-2">
        {galerias[categoria].map((item, index) => (
          <div key={index} className="d-flex align-items-center mb-2 p-2 border rounded">
            <img
              src={item.previewUrl}
              alt="preview"
              style={{ width: 50, height: 50, objectFit: 'cover', marginRight: '10px' }}
            />
            <input
              type="text"
              placeholder="Añadir descripción..."
              value={item.descripcion}
              onChange={(e) => handleDescripcionChange(categoria, index, e.target.value)}
              className="form-control"
            />
            <button
              type="button"
              onClick={() => handleRemoveFoto(categoria, index)}
              className="btn btn-sm btn-danger ms-2"
            >
              X
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="container mt-4">
      <button className="btn btn-warning mb-3" onClick={() => navigate(`/proyectos`)}>
        ← Volver a Proyectos
      </button>
      <h2 className="mb-4">Acta de Preconstrucción (PDF / Word)</h2>

      <form onSubmit={handleSubmitPDF}>
        {/* Vinculación y ubicación */}
        <div className="card mb-4">
          <div className="card-header">Vinculación y ubicación</div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Tramo</label>
                <select
                  name="id_tramo"
                  value={formData.id_tramo}
                  onChange={handleTramoChange}
                  className="form-select"
                  required
                >
                  <option value="">-- Seleccionar tramo --</option>
                  {tramos.map(t => (
                    <option key={t.id_tramo} value={t.id_tramo}>
                      {t.nombre_tramo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-6 mb-3 d-flex align-items-end">
                <small className="text-muted">
                  El mapa se centra en tu ubicación (si el navegador la permite). Hacé click en el mapa
                  para seleccionar manualmente el punto del inmueble.
                </small>
              </div>
            </div>

            <div className="row">
              <div className="col-md-8 mb-3">
                <div
                  ref={mapRef}
                  style={{
                    width: '100%',
                    height: '320px',
                    borderRadius: '8px',
                    border: '1px solid #ddd',
                    overflow: 'hidden'
                  }}
                />
              </div>
              <div className="col-md-4 mb-3">
                <div className="mb-3">
                  <label className="form-label">Coordenada X (Longitud)</label>
                  <input
                    type="text"
                    name="coordenada_x"
                    value={formData.coordenada_x}
                    onChange={handleChange}
                    className="form-control"
                    placeholder="-57.XXXX"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Coordenada Y (Latitud)</label>
                  <input
                    type="text"
                    name="coordenada_y"
                    value={formData.coordenada_y}
                    onChange={handleChange}
                    className="form-control"
                    placeholder="-25.XXXX"
                  />
                </div>
                <small className="text-muted">
                  Podés ajustar las coordenadas a mano o haciendo click en el mapa.
                </small>
              </div>
            </div>
          </div>
        </div>

        {/* Datos Generales */}
        <div className="card mb-4">
          <div className="card-header">Datos Generales</div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Proyecto</label>
                <input type="text" value={formData.nombre_proyecto} className="form-control" readOnly />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Tramo (nombre)</label>
                <input
                  type="text"
                  name="tramo_proyecto"
                  value={formData.tramo_proyecto}
                  onChange={handleChange}
                  className="form-control"
                  readOnly
                />
              </div>

              <div className="col-md-4 mb-3">
                <label className="form-label">Progresivas</label>
                <input
                  type="text"
                  name="progresivas"
                  value={formData.progresivas}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-4 mb-3">
                <label className="form-label">Lado</label>
                <input
                  type="text"
                  name="lado"
                  value={formData.lado}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-4 mb-3">
                <label className="form-label">Fecha relevamiento</label>
                <input
                  type="date"
                  name="fecha_relevamiento"
                  value={formData.fecha_relevamiento}
                  onChange={handleChange}
                  className="form-control"
                  required
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Dirección del Predio</label>
                <input
                  type="text"
                  name="direccion_predio"
                  value={formData.direccion_predio}
                  onChange={handleChange}
                  className="form-control"
                  required
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Catastro (Finca – Padrón)</label>
                <input
                  type="text"
                  name="identificacion_catastral"
                  value={formData.identificacion_catastral}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Propietario/Ocupante</label>
                <input
                  type="text"
                  name="nombre_propietario"
                  value={formData.nombre_propietario}
                  onChange={handleChange}
                  className="form-control"
                  required
                />
              </div>
              <div className="col-md-3 mb-3">
                <label className="form-label">Cédula de Identidad</label>
                <input
                  type="text"
                  name="cedula_propietario"
                  value={formData.cedula_propietario}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-3 mb-3">
                <label className="form-label">Contacto (Teléfono/Email)</label>
                <input
                  type="text"
                  name="contacto_propietario"
                  value={formData.contacto_propietario}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Arquitecto a Cargo</label>
                <input
                  type="text"
                  name="nombre_arquitecto"
                  value={formData.nombre_arquitecto}
                  onChange={handleChange}
                  className="form-control"
                  required
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Matrícula Profesional</label>
                <input
                  type="text"
                  name="matricula_arquitecto"
                  value={formData.matricula_arquitecto}
                  onChange={handleChange}
                  className="form-control"
                  required
                />
              </div>
            </div>
          </div>
        </div>

        {/* Relevamiento técnico */}
        <div className="card mb-4">
          <div className="card-header">Relevamiento Técnico</div>
          <div className="card-body">
            <h5 className="mb-3">Fachada y Cerramiento</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Tipo de Cerramiento</label>
                <input
                  type="text"
                  name="tipo_cerramiento"
                  value={formData.tipo_cerramiento}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Revestimiento de Fachada</label>
                <input
                  type="text"
                  name="revestimiento_fachada"
                  value={formData.revestimiento_fachada}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Estado General Fachada</label>
                <select
                  name="estado_general_fachada"
                  value={formData.estado_general_fachada}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option>Bueno</option>
                  <option>Regular</option>
                  <option>Malo</option>
                </select>
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Patologías Existentes (Fachada)</label>
                <input
                  type="text"
                  name="lista_patologias_fachada"
                  value={formData.lista_patologias_fachada}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-12 mb-3">
                <label className="form-label">Observaciones Fachada</label>
                <textarea
                  name="observaciones_fachada"
                  value={formData.observaciones_fachada}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
            </div>
            <hr className="my-3" />
            <h5 className="mb-3">Vereda y Acceso</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Materialidad de Vereda</label>
                <input
                  type="text"
                  name="material_vereda"
                  value={formData.material_vereda}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Estado General Vereda</label>
                <select
                  name="estado_general_vereda"
                  value={formData.estado_general_vereda}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option>Bueno</option>
                  <option>Regular</option>
                  <option>Malo</option>
                </select>
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Patologías Existentes (Vereda)</label>
                <input
                  type="text"
                  name="lista_patologias_vereda"
                  value={formData.lista_patologias_vereda}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-12 mb-3">
                <label className="form-label">Observaciones Vereda</label>
                <textarea
                  name="observaciones_vereda"
                  value={formData.observaciones_vereda}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
            </div>
            <hr className="my-3" />
            <h5 className="mb-3">Estructura</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Tipo de Estructura Visible</label>
                <input
                  type="text"
                  name="tipo_estructura_visible"
                  value={formData.tipo_estructura_visible}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Estado Elementos Estructurales</label>
                <select
                  name="estado_elementos_estructurales"
                  value={formData.estado_elementos_estructurales}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option>Bueno</option>
                  <option>Regular</option>
                  <option>Malo</option>
                </select>
              </div>
              <div className="col-12 mb-3">
                <label className="form-label">Observaciones Estructura</label>
                <textarea
                  name="observaciones_estructura"
                  value={formData.observaciones_estructura}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Registros fotográficos */}
        <div className="card mb-4">
          <div className="card-header">Registros Fotográficos</div>
          <div className="card-body">
            {renderGaleria('fachada', 'Fachada')}
            <hr />
            {renderGaleria('vereda', 'Vereda')}
            <hr />
            {renderGaleria('estructura', 'Estructura')}
          </div>
        </div>

        {/* Observaciones adicionales */}
        <div className="card mb-4">
          <div className="card-header">Observaciones Adicionales</div>
          <div className="card-body">
            <textarea
              name="observaciones_adicionales"
              value={formData.observaciones_adicionales}
              onChange={handleChange}
              className="form-control"
              rows={3}
            />
          </div>
        </div>

        {/* Firmas */}
        <div className="card mb-4">
          <div className="card-header">Firmas</div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Firma del Propietario</label>
                <input
                  type="file"
                  name="firma_propietario_img"
                  onChange={handleFirmaChange}
                  className="form-control"
                  accept="image/*"
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Firma del Arquitecto</label>
                <input
                  type="file"
                  name="firma_arquitecto_img"
                  onChange={handleFirmaChange}
                  className="form-control"
                  accept="image/*"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Acción */}
        <div className="d-flex justify-content-end mb-4">
          <button
            type="button"
            className="btn btn-outline-primary me-2"
            disabled={loading}
            onClick={handleGenerateDOCX}
            title="Generar Word (.docx) con el mismo contenido"
          >
            {loading ? 'Generando…' : 'Generar y Descargar Word (.docx)'}
          </button>

          <button
            type="button"
            className="btn btn-secondary me-2"
            onClick={() => navigate(-1)}
            disabled={loading}
          >
            Cancelar
          </button>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Generando PDF...' : 'Generar y Descargar PDF'}
          </button>
        </div>
      </form>
    </div>
  );
}
