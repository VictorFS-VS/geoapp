// src/pages/EditarActa.jsx
// RUTAS BACKEND:
//  - GET  /api/actas-preconstruccion/:id_acta          (trae { acta, fotos })
//  - PUT  /api/actas-preconstruccion/:id_acta          (actualiza campos + fotos[] existentes: descripcion/orden)
//  - POST /api/proyectos/:id/actas-preconstruccion-pdf?id_acta=:id_acta   (reimprime PDF)
//
// Notas:
// - Este componente usa OpenLayers (OSM) para seleccionar coordenadas.
// - Alertas/toasts: usa el helper `alerts` (toast / confirm) como venís usando en el sistema.

import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";

import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat, toLonLat } from "ol/proj";
import "ol/ol.css";

import { alerts } from "@/utils/alerts"; // ✅ NUEVO

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ==== helpers auth/fetch ==== */
const authHeaders = () => {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const bearer = t?.startsWith("Bearer ") ? t : t ? `Bearer ${t}` : null;
  return bearer ? { Authorization: bearer } : {};
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
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = ct.includes("application/json");
  if (!res.ok) {
    const payload = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    const msg =
      (typeof payload === "object" && (payload.message || payload.error)) ||
      (typeof payload === "string" && payload) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return isJson ? res.json() : res.text();
};

/** Convierte ruta absoluta de Windows o relativa a una URL servible */
const buildPreviewUrl = (ruta_archivo) => {
  if (!ruta_archivo) return "";
  let p = String(ruta_archivo || "").replace(/\\/g, "/");
  const lower = p.toLowerCase();
  let rel = p;

  let idx = lower.indexOf("/uploads/");
  if (idx === -1) idx = lower.indexOf("uploads/");
  if (idx !== -1) rel = p.slice(idx);

  const base = BASE.replace(/\/+$/, "");
  return `${base}/${String(rel).replace(/^\/+/, "")}`;
};

export default function EditarActa() {
  const { id, id_acta } = useParams();
  const actaId = id_acta;
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    id_tramo: "",
    nombre_proyecto: "",
    tramo_proyecto: "",
    fecha_relevamiento: new Date().toISOString().slice(0, 10),
    nombre_arquitecto: "",
    matricula_arquitecto: "",
    direccion_predio: "",
    identificacion_catastral: "",
    nombre_propietario: "",
    cedula_propietario: "",
    contacto_propietario: "",
    tipo_cerramiento: "",
    revestimiento_fachada: "",
    estado_general_fachada: "Bueno",
    lista_patologias_fachada: "",
    observaciones_fachada: "",
    material_vereda: "",
    estado_general_vereda: "Bueno",
    lista_patologias_vereda: "",
    observaciones_vereda: "",
    tipo_estructura_visible: "",
    estado_elementos_estructurales: "Bueno",
    observaciones_estructura: "",
    coordenada_x: "",
    coordenada_y: "",
    progresivas: "",
    lado: "",
    observaciones_adicionales: "",
  });

  const [galerias, setGalerias] = useState({
    fachada: [],
    vereda: [],
    estructura: [],
  });

  const [firmaPropietario, setFirmaPropietario] = useState({
    existingUrl: "",
    file: null,
    previewUrl: "",
  });
  const [firmaArquitecto, setFirmaArquitecto] = useState({
    existingUrl: "",
    file: null,
    previewUrl: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // refs mapa
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerLayerRef = useRef(null);

  // inicializar mapa cuando ya cargó acta
  useEffect(() => {
    if (loading) return;
    if (!mapRef.current) return;

    // si ya existe el mapa, reatach y updateSize
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setTarget(mapRef.current);
      setTimeout(() => {
        try {
          mapInstanceRef.current.updateSize();
        } catch {}
      }, 100);
      return;
    }

    const markerSource = new VectorSource();
    const markerLayer = new VectorLayer({ source: markerSource });

    const map = new Map({
      target: mapRef.current,
      layers: [new TileLayer({ source: new OSM() }), markerLayer],
      view: new View({
        center: fromLonLat([-57.5, -25.3]),
        zoom: 6,
      }),
    });

    setTimeout(() => {
      try {
        map.updateSize();
      } catch {}
    }, 100);

    map.on("click", (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate);
      setFormData((prev) => ({
        ...prev,
        coordenada_x: lon.toFixed(6),
        coordenada_y: lat.toFixed(6),
      }));
    });

    mapInstanceRef.current = map;
    markerLayerRef.current = markerLayer;

    return () => {
      try {
        map.setTarget(null);
      } catch {}
    };
  }, [loading]);

  // cuando cambian coordenadas -> marcador + zoom
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;

    const lon = parseFloat(formData.coordenada_x);
    const lat = parseFloat(formData.coordenada_y);

    const markerSource = markerLayer.getSource();
    markerSource.clear();

    if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
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

  // Carga inicial acta + fotos
  useEffect(() => {
    if (!actaId) {
      setError("ID de acta inválido");
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/actas/actas-preconstruccion/${actaId}`, {
          headers: { ...authHeaders() },
        });
        const data = await jsonOrRedirect401(res);
        if (!data) return;

        const { acta, fotos } = data;

        // fotos -> galerías
        const agrupadas = { fachada: [], vereda: [], estructura: [] };
        (Array.isArray(fotos) ? fotos : []).forEach((f) => {
          const cat = f.categoria;
          if (!agrupadas[cat]) agrupadas[cat] = [];
          agrupadas[cat].push({
            id_foto: f.id_foto,
            descripcion: f.descripcion || "",
            orden: f.orden != null ? f.orden : 0,
            existing: true,
            ruta_archivo: f.ruta_archivo,
            previewUrl: buildPreviewUrl(f.ruta_archivo),
          });
        });
        setGalerias(agrupadas);

        // firmas existentes
        if (acta?.firma_propietario_path) {
          setFirmaPropietario((prev) => ({
            ...prev,
            existingUrl: buildPreviewUrl(acta.firma_propietario_path),
          }));
        }
        if (acta?.firma_arquitecto_path) {
          setFirmaArquitecto((prev) => ({
            ...prev,
            existingUrl: buildPreviewUrl(acta.firma_arquitecto_path),
          }));
        }

        // formData
        setFormData((prev) => ({
          ...prev,
          id_tramo: acta?.id_tramo || prev.id_tramo || "",
          nombre_proyecto: acta?.nombre_proyecto || prev.nombre_proyecto,
          tramo_proyecto: acta?.tramo_proyecto || prev.tramo_proyecto,
          fecha_relevamiento: acta?.fecha_relevamiento
            ? String(acta.fecha_relevamiento).slice(0, 10)
            : prev.fecha_relevamiento,
          nombre_arquitecto: acta?.nombre_arquitecto || "",
          matricula_arquitecto: acta?.matricula_arquitecto || "",
          direccion_predio: acta?.direccion_predio || "",
          identificacion_catastral: acta?.identificacion_catastral || "",
          nombre_propietario: acta?.nombre_propietario || "",
          cedula_propietario: acta?.cedula_propietario || "",
          contacto_propietario: acta?.contacto_propietario || "",
          tipo_cerramiento: acta?.tipo_cerramiento || "",
          revestimiento_fachada: acta?.revestimiento_fachada || "",
          estado_general_fachada: acta?.estado_general_fachada || "Bueno",
          lista_patologias_fachada: acta?.lista_patologias_fachada || "",
          observaciones_fachada: acta?.observaciones_fachada || "",
          material_vereda: acta?.material_vereda || "",
          estado_general_vereda: acta?.estado_general_vereda || "Bueno",
          lista_patologias_vereda: acta?.lista_patologias_vereda || "",
          observaciones_vereda: acta?.observaciones_vereda || "",
          tipo_estructura_visible: acta?.tipo_estructura_visible || "",
          estado_elementos_estructurales:
            acta?.estado_elementos_estructrurales ||
            acta?.estado_elementos_estructurales ||
            "Bueno",
          observaciones_estructura: acta?.observaciones_estructura || "",
          coordenada_x: acta?.coordenada_x || "",
          coordenada_y: acta?.coordenada_y || "",
          progresivas: acta?.progresivas || "",
          lado: acta?.lado || "",
          observaciones_adicionales: acta?.observaciones_adicionales || "",
        }));
      } catch (e) {
        console.error("Error cargando acta para editar:", e);
        const msg = "No se pudo cargar el acta: " + (e?.message || "Error desconocido");
        setError(msg);
        alerts.toast.error(msg);
        if (String(e?.message || "").toLowerCase().includes("sesión expirada")) {
          window.location.replace("/login");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [actaId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDescripcionChange = (categoria, index, value) => {
    setGalerias((prev) => {
      const copy = { ...prev };
      copy[categoria] = [...copy[categoria]];
      copy[categoria][index] = { ...copy[categoria][index], descripcion: value };
      return copy;
    });
  };

  const handleOrdenChange = (categoria, index, value) => {
    setGalerias((prev) => {
      const copy = { ...prev };
      copy[categoria] = [...copy[categoria]];
      copy[categoria][index] = { ...copy[categoria][index], orden: Number(value) };
      return copy;
    });
  };

  const handleGaleriaChange = (categoria, e) => {
    const nuevos = Array.from(e.target.files || []).map((file) => ({
      file,
      descripcion: "",
      orden: 0,
      existing: false,
      previewUrl: URL.createObjectURL(file),
    }));
    setGalerias((prev) => ({
      ...prev,
      [categoria]: [...prev[categoria], ...nuevos],
    }));
  };

  const handleRemoveFoto = (categoria, index) => {
    setGalerias((prev) => {
      const copy = { ...prev };
      const removed = copy[categoria][index];
      if (!removed?.existing && removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      copy[categoria] = copy[categoria].filter((_, i) => i !== index);
      return copy;
    });
  };

  // Firmas (solo preview)
  const handleFirmaChange = (e) => {
    const { name, files } = e.target;
    const file = files && files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (name === "firma_propietario_img") {
      if (firmaPropietario.previewUrl) URL.revokeObjectURL(firmaPropietario.previewUrl);
      setFirmaPropietario({
        existingUrl: firmaPropietario.existingUrl,
        file,
        previewUrl: url,
      });
    } else if (name === "firma_arquitecto_img") {
      if (firmaArquitecto.previewUrl) URL.revokeObjectURL(firmaArquitecto.previewUrl);
      setFirmaArquitecto({
        existingUrl: firmaArquitecto.existingUrl,
        file,
        previewUrl: url,
      });
    }
  };

  const handleGuardar = async (e) => {
    e && e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      // payload fotos existentes (desc/orden)
      const fotosPayload = [];
      Object.entries(galerias).forEach(([cat, arr]) => {
        (arr || []).forEach((f) => {
          if (f.existing) {
            fotosPayload.push({
              id_foto: f.id_foto,
              descripcion: f.descripcion,
              orden: f.orden,
            });
          }
        });
      });

      const payload = {
        nombre_propietario: formData.nombre_propietario || null,
        observaciones_fachada: formData.observaciones_fachada || null,
        observaciones_vereda: formData.observaciones_vereda || null,
        observaciones_estructura: formData.observaciones_estructura || null,
        fecha_relevamiento: formData.fecha_relevamiento || null,
        nombre_arquitecto: formData.nombre_arquitecto || null,
        matricula_arquitecto: formData.matricula_arquitecto || null,
        direccion_predio: formData.direccion_predio || null,
        identificacion_catastral: formData.identificacion_catastral || null,
        tipo_cerramiento: formData.tipo_cerramiento || null,
        revestimiento_fachada: formData.revestimiento_fachada || null,
        estado_general_fachada: formData.estado_general_fachada || null,
        lista_patologias_fachada: formData.lista_patologias_fachada || null,
        material_vereda: formData.material_vereda || null,
        estado_general_vereda: formData.estado_general_vereda || null,
        lista_patologias_vereda: formData.lista_patologias_vereda || null,
        tipo_estructura_visible: formData.tipo_estructura_visible || null,
        estado_elementos_estructurales: formData.estado_elementos_estructurales || null,
        coordenada_x: formData.coordenada_x || null,
        coordenada_y: formData.coordenada_y || null,
        progresivas: formData.progresivas || null,
        lado: formData.lado || null,
        observaciones_adicionales: formData.observaciones_adicionales || null,
        fotos: fotosPayload,
      };

      const res = await fetch(`${API_URL}/actas/actas-preconstruccion/${actaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });

      const data = await jsonOrRedirect401(res);
      if (!data) return;

      alerts.toast.success("Acta actualizada correctamente.");
      navigate(`/proyectos/${id}/actas`);
    } catch (e2) {
      console.error("Error guardando acta editada:", e2);
      const msg = "No se pudo guardar: " + (e2?.message || "Error desconocido");
      setError(msg);
      alerts.toast.error(msg);
      if (String(e2?.message || "").toLowerCase().includes("sesión expirada")) {
        window.location.replace("/login");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReimprimir = async () => {
    try {
      setSaving(true);

      const url = `${API_URL}/actas/proyectos/${id}/actas-preconstruccion-pdf?id_acta=${actaId}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders() },
      });

      if (res.status === 401) {
        redirect401();
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `ActaPreconstruccion_${id}_${actaId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      alerts.toast.success("PDF reimpreso correctamente.");
    } catch (e) {
      console.error("Error reimprimiendo PDF del acta:", e);
      alerts.toast.error("No se pudo reimprimir el PDF: " + (e?.message || "Error desconocido"));
      if (String(e?.message || "").toLowerCase().includes("sesión expirada")) {
        window.location.replace("/login");
      }
    } finally {
      setSaving(false);
    }
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
        disabled={saving}
      />
      <div className="mt-2">
        {galerias[categoria].map((item, index) => (
          <div key={index} className="d-flex align-items-center mb-2 p-2 border rounded">
            <div style={{ width: 50, height: 50, marginRight: 10 }}>
              {item.previewUrl && (
                <img
                  src={item.previewUrl}
                  alt="preview"
                  style={{ width: 50, height: 50, objectFit: "cover" }}
                />
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div className="mb-1">
                <input
                  type="text"
                  placeholder="Descripción"
                  value={item.descripcion}
                  onChange={(e) => handleDescripcionChange(categoria, index, e.target.value)}
                  className="form-control form-control-sm mb-1"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="form-label small me-1">Orden:</label>
                <input
                  type="number"
                  value={item.orden != null ? item.orden : 0}
                  onChange={(e) => handleOrdenChange(categoria, index, e.target.value)}
                  className="form-control form-control-sm"
                  style={{ width: 80, display: "inline-block" }}
                  disabled={saving}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleRemoveFoto(categoria, index)}
              className="btn btn-sm btn-danger ms-2"
              title="Quitar"
              disabled={saving}
            >
              X
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  if (loading) return <div className="container mt-4">Cargando acta…</div>;

  const firmaPropPreview = firmaPropietario.previewUrl || firmaPropietario.existingUrl;
  const firmaArqPreview = firmaArquitecto.previewUrl || firmaArquitecto.existingUrl;

  return (
    <div className="container mt-4">
      <h2 className="mb-4">Editar Acta de Preconstrucción</h2>
      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleGuardar}>
        {/* Datos Generales + mapa */}
        <div className="card mb-4">
          <div className="card-header">Datos Generales</div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Proyecto</label>
                <input type="text" value={formData.nombre_proyecto} className="form-control" readOnly />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label">Tramo</label>
                <input
                  type="text"
                  name="tramo_proyecto"
                  value={formData.tramo_proyecto}
                  onChange={handleChange}
                  className="form-control"
                  readOnly
                />
              </div>
            </div>

            <div className="row mb-2">
              <div className="col-md-12">
                <small className="text-muted">
                  El mapa se centra en las coordenadas guardadas en el acta (si existen). Hacé click en el mapa
                  para ajustar manualmente el punto del inmueble.
                </small>
              </div>
            </div>

            <div className="row">
              <div className="col-md-8 mb-3">
                <div
                  ref={mapRef}
                  style={{
                    width: "100%",
                    height: "320px",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                    overflow: "hidden",
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
                    disabled={saving}
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
                    disabled={saving}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label">Progresivas</label>
                  <input
                    type="text"
                    name="progresivas"
                    value={formData.progresivas}
                    onChange={handleChange}
                    className="form-control"
                    disabled={saving}
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label">Lado</label>
                  <input
                    type="text"
                    name="lado"
                    value={formData.lado}
                    onChange={handleChange}
                    className="form-control"
                    disabled={saving}
                  />
                </div>

                <small className="text-muted">Podés ajustar las coordenadas a mano o haciendo click en el mapa.</small>
              </div>
            </div>

            <div className="row mt-3">
              <div className="col-md-4 mb-3">
                <label className="form-label">Fecha relevamiento</label>
                <input
                  type="date"
                  name="fecha_relevamiento"
                  value={formData.fecha_relevamiento}
                  onChange={handleChange}
                  className="form-control"
                  required
                  disabled={saving}
                />
              </div>

              <div className="col-md-4 mb-3">
                <label className="form-label">Arquitecto a Cargo</label>
                <input
                  type="text"
                  name="nombre_arquitecto"
                  value={formData.nombre_arquitecto}
                  onChange={handleChange}
                  className="form-control"
                  required
                  disabled={saving}
                />
              </div>

              <div className="col-md-4 mb-3">
                <label className="form-label">Matrícula Profesional</label>
                <input
                  type="text"
                  name="matricula_arquitecto"
                  value={formData.matricula_arquitecto}
                  onChange={handleChange}
                  className="form-control"
                  required
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sección 1: Inmueble */}
        <div className="card mb-4">
          <div className="card-header">1. Datos del Inmueble Relevado</div>
          <div className="card-body">
            <div className="row">
              {[
                { label: "Dirección del Predio", name: "direccion_predio" },
                { label: "Identificación Catastral", name: "identificacion_catastral" },
                { label: "Propietario/Ocupante", name: "nombre_propietario" },
                { label: "Cédula de Identidad", name: "cedula_propietario" },
                { label: "Contacto (Teléfono/Email)", name: "contacto_propietario" },
              ].map(({ label, name }) => (
                <div className="col-md-6 mb-3" key={name}>
                  <label className="form-label">{label}</label>
                  <input
                    type="text"
                    name={name}
                    value={formData[name] || ""}
                    onChange={handleChange}
                    className="form-control"
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sección 2: Relevamiento técnico */}
        <div className="card mb-4">
          <div className="card-header">2. Relevamiento Técnico</div>
          <div className="card-body">
            {/* Fachada */}
            <h5 className="mb-3">2.1 Fachada y Cerramiento</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Tipo de Cerramiento</label>
                <input
                  type="text"
                  name="tipo_cerramiento"
                  value={formData.tipo_cerramiento}
                  onChange={handleChange}
                  className="form-control"
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Estado General Fachada</label>
                <select
                  name="estado_general_fachada"
                  value={formData.estado_general_fachada}
                  onChange={handleChange}
                  className="form-select"
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>

              <div className="col-12 mb-3">
                <label className="form-label">Observaciones Fachada</label>
                <textarea
                  name="observaciones_fachada"
                  value={formData.observaciones_fachada}
                  onChange={handleChange}
                  className="form-control"
                  disabled={saving}
                />
              </div>
            </div>

            <hr className="my-3" />

            {/* Vereda */}
            <h5 className="mb-3">2.2 Vereda y Acceso</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Materialidad de Vereda</label>
                <input
                  type="text"
                  name="material_vereda"
                  value={formData.material_vereda}
                  onChange={handleChange}
                  className="form-control"
                  disabled={saving}
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Estado General Vereda</label>
                <select
                  name="estado_general_vereda"
                  value={formData.estado_general_vereda}
                  onChange={handleChange}
                  className="form-select"
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>

              <div className="col-12 mb-3">
                <label className="form-label">Observaciones Vereda</label>
                <textarea
                  name="observaciones_vereda"
                  value={formData.observaciones_vereda}
                  onChange={handleChange}
                  className="form-control"
                  disabled={saving}
                />
              </div>
            </div>

            <hr className="my-3" />

            {/* Estructura */}
            <h5 className="mb-3">2.3 Estructura</h5>
            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label">Tipo de Estructura Visible</label>
                <input
                  type="text"
                  name="tipo_estructura_visible"
                  value={formData.tipo_estructura_visible}
                  onChange={handleChange}
                  className="form-control"
                  disabled={saving}
                />
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Estado Elementos Estructurales</label>
                <select
                  name="estado_elementos_estructurales"
                  value={formData.estado_elementos_estructurales}
                  onChange={handleChange}
                  className="form-select"
                  disabled={saving}
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
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Registro fotográfico */}
        <div className="card mb-4">
          <div className="card-header">3. Registro Fotográfico</div>
          <div className="card-body">
            {renderGaleria("fachada", "4.1 Fotos Fachada principal")}
            <hr />
            {renderGaleria("vereda", "4.2 Vereda y Acceso Peatonal/Vehicular")}
            <hr />
            {renderGaleria("estructura", "4.3 Estructura y Elementos Exteriores Visibles")}
          </div>
        </div>

        {/* Observaciones adicionales */}
        <div className="card mb-4">
          <div className="card-header">4. Observaciones Adicionales</div>
          <div className="card-body">
            <textarea
              name="observaciones_adicionales"
              value={formData.observaciones_adicionales}
              onChange={handleChange}
              className="form-control"
              rows={3}
              disabled={saving}
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
                  className="form-control mb-2"
                  accept="image/*"
                  disabled={saving}
                />
                {firmaPropPreview && (
                  <div className="border rounded p-2 text-center">
                    <img
                      src={firmaPropPreview}
                      alt="Firma propietario"
                      style={{ maxWidth: "100%", maxHeight: 120, objectFit: "contain" }}
                    />
                  </div>
                )}
              </div>

              <div className="col-md-6 mb-3">
                <label className="form-label">Firma del Arquitecto</label>
                <input
                  type="file"
                  name="firma_arquitecto_img"
                  onChange={handleFirmaChange}
                  className="form-control mb-2"
                  accept="image/*"
                  disabled={saving}
                />
                {firmaArqPreview && (
                  <div className="border rounded p-2 text-center">
                    <img
                      src={firmaArqPreview}
                      alt="Firma arquitecto"
                      style={{ maxWidth: "100%", maxHeight: 120, objectFit: "contain" }}
                    />
                  </div>
                )}
              </div>
            </div>

            <small className="text-muted">
              (Por ahora, las firmas se usan solo en la generación original del acta. Para que también se actualicen desde
              esta pantalla habría que ajustar el endpoint del backend para aceptar archivos.)
            </small>
          </div>
        </div>

        {/* Acción */}
        <div className="d-flex justify-content-end mb-4 gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)} disabled={saving}>
            Cancelar
          </button>

          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleReimprimir}
            disabled={saving}
          >
            Reimprimir PDF
          </button>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
