// src/views/FullScreenVisorEncuestasV2.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Navbar from "@/components/Navbar";
import { loadGoogleMapsApi } from "@/utils/loadGoogleMapsApi";
import { Spinner, Badge, Button, Modal, Form } from "react-bootstrap";
import "@/styles/FullScreenVisorTramo.theme.css";

import EncuestasChartsModal from "@/components/EncuestasChartsModal";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";
const HOST_BASE = BASE.replace(/\/api\/?$/i, "");

const GMAPS_API_KEY = import.meta.env.VITE_GMAPS_API_KEY;
const GMAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID;

const authHeaders = () => {
  const token = localStorage.getItem("token");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const fotoUrl = (ruta_archivo) => {
  if (!ruta_archivo) return "";
  const s = String(ruta_archivo).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;

  const clean = s.replace(/^\/+/, "");
  if (clean.startsWith("uploads/")) return `${HOST_BASE}/${clean}`;
  return `${HOST_BASE}/uploads/${clean}`;
};

const groupFotosByPregunta = (fotos = []) => {
  const m = {};
  for (const f of fotos || []) {
    const idp = Number(f?.id_pregunta);
    if (!idp) continue;
    if (!m[idp]) m[idp] = [];
    m[idp].push(f);
  }
  Object.values(m).forEach((arr) => arr.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
  return m;
};

export default function FullScreenVisorEncuestasV2() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const mapDivRef = useRef(null);
  const mapObjRef = useRef(null);
  const markersRef = useRef([]);

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const [counts, setCounts] = useState({ informes: 0 });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toggles, setToggles] = useState({ informes: true });

  // ✅ panel derecho
  const [rightOpen, setRightOpen] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);

  // ✅ detalle del informe
  const [verInformeOpen, setVerInformeOpen] = useState(false);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleData, setDetalleData] = useState(null);
  const [detalleError, setDetalleError] = useState(null);
  const [detalleIdInforme, setDetalleIdInforme] = useState(null);

  // ✅ modal fotos
  const [fotosModalOpen, setFotosModalOpen] = useState(false);

  // ✅ modal gráficos
  const [graficosModalOpen, setGraficosModalOpen] = useState(false);
  const [top10InformeIds, setTop10InformeIds] = useState([]);

  // ✅ plantillas del proyecto
  const [plantillasProyecto, setPlantillasProyecto] = useState([]);
  const [plantillasLoading, setPlantillasLoading] = useState(false);
  const [plantillasError, setPlantillasError] = useState(null);

  const plantillaQS = useMemo(() => searchParams.get("plantilla"), [searchParams]);
  const [plantillaSel, setPlantillaSel] = useState(plantillaQS || null);

  const [plantillaData, setPlantillaData] = useState(null);
  const [plantillaLoading, setPlantillaLoading] = useState(false);

  const [vista, setVista] = useState("hybrid");
  const toggleVista = () => {
    const map = mapObjRef.current;
    if (!map) return;
    const next = vista === "hybrid" ? "roadmap" : "hybrid";
    setVista(next);
    map.setMapTypeId(next);
  };

  const goToProjects = () => navigate("/proyectos");
  const goToProyecto = () => navigate(`/proyectos/${id}`);

  // ✅ cargar Google Maps
  useEffect(() => {
    let cancel = false;

    (async () => {
      try {
        await loadGoogleMapsApi(GMAPS_API_KEY);
        if (cancel) return;

        const g = window.google;
        if (!g?.maps) return;

        try {
          await g.maps.importLibrary("marker");
        } catch {}

        if (!mapDivRef.current) return;

        const map = new g.maps.Map(mapDivRef.current, {
          center: { lat: -25.3, lng: -57.6 },
          zoom: 7,
          mapId: GMAPS_MAP_ID || undefined,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          mapTypeId: "hybrid",
        });

        mapObjRef.current = map;
        setVista("hybrid");
        setReady(true);
      } catch (e) {
        console.error("Error cargando Google Maps:", e);
      }
    })();

    return () => {
      cancel = true;
      markersRef.current.forEach((m) => {
        if (!m) return;
        if ("map" in m) {
          try {
            m.map = null;
          } catch {}
        } else if (typeof m.setMap === "function") {
          m.setMap(null);
        }
      });
      markersRef.current = [];
      mapObjRef.current = null;
      setReady(false);
    };
  }, []);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => {
      if (!m) return;
      if ("map" in m) {
        try {
          m.map = null;
          return;
        } catch {}
      }
      if (typeof m.setMap === "function") m.setMap(null);
    });
    markersRef.current = [];
  };

  const fitToFeatures = (features) => {
    const g = window.google;
    const map = mapObjRef.current;
    if (!map || !features?.length || !g?.maps) return;

    const bounds = new g.maps.LatLngBounds();
    for (const f of features) {
      if (f?.geometry?.type !== "Point") continue;
      const [lng, lat] = f.geometry.coordinates || [];
      if (lat == null || lng == null) continue;
      bounds.extend(new g.maps.LatLng(lat, lng));
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds);
  };

  // toggle layer puntos
  useEffect(() => {
    if (!ready) return;
    const map = mapObjRef.current;

    markersRef.current.forEach((m) => {
      if (!m) return;

      if ("map" in m) {
        try {
          m.map = toggles.informes ? map : null;
          return;
        } catch {}
      }
      if (typeof m.setMap === "function") m.setMap(toggles.informes ? map : null);
    });
  }, [toggles.informes, ready]);

  const fetchGeoJSON = async (url) => {
    const resp = await fetch(url, { headers: { ...authHeaders() } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  };

  // ✅ abrir panel derecho al tocar un punto
  const openPointPanel = (props) => {
    setSelectedPoint(props);
    setRightOpen(true);

    setSidebarOpen(false);
    setGraficosModalOpen(false);
    setFotosModalOpen(false);

    setVerInformeOpen(false);
    setDetalleData(null);
    setDetalleError(null);
    setDetalleIdInforme(null);
  };

  // ✅ cargar lista de plantillas del proyecto (selector)
  const loadPlantillasProyecto = useCallback(async () => {
    setPlantillasLoading(true);
    setPlantillasError(null);
    try {
      const resp = await fetch(`${API_URL}/informes/proyecto/${id}/por-plantilla`, {
        headers: { ...authHeaders() },
      });
      const data = await resp.json();

      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Error ${resp.status}`);

      const list = Array.isArray(data?.plantillas)
        ? data.plantillas
        : Array.isArray(data)
        ? data
        : [];

      setPlantillasProyecto(list);

      const qs = plantillaQS ? String(plantillaQS) : "";
      const exists = qs && list.some((p) => String(p.id_plantilla) === qs);

      if (exists) {
        setPlantillaSel(qs);
      } else {
        const first = list[0]?.id_plantilla;
        const next = first ? String(first) : null;
        setPlantillaSel(next);

        if (next) {
          const sp = new URLSearchParams(searchParams);
          sp.set("plantilla", next);
          setSearchParams(sp, { replace: true });
        }
      }
    } catch (e) {
      console.error("loadPlantillasProyecto error:", e);
      setPlantillasProyecto([]);
      setPlantillasError(e?.message || "No se pudieron cargar las plantillas del proyecto.");
      setPlantillaSel(null);
    } finally {
      setPlantillasLoading(false);
    }
  }, [API_URL, id, plantillaQS, searchParams, setSearchParams]);

  useEffect(() => {
    loadPlantillasProyecto();
  }, [loadPlantillasProyecto]);

  // ✅ cargar plantilla por ID (tolerante)
  const fetchPlantillaById = useCallback(
    async (idPlantilla) => {
      if (!idPlantilla) return null;

      const resp = await fetch(`${API_URL}/informes/plantillas/${idPlantilla}`, {
        headers: { ...authHeaders() },
      });
      const data = await resp.json();

      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Error ${resp.status}`);
      return data;
    },
    [API_URL]
  );

  useEffect(() => {
    let cancel = false;

    const run = async () => {
      if (!plantillaSel) {
        setPlantillaData(null);
        return;
      }

      setPlantillaLoading(true);
      try {
        const obj = await fetchPlantillaById(plantillaSel);
        if (!cancel) setPlantillaData(obj);
      } catch (e) {
        console.error("fetchPlantillaById error:", e);
        if (!cancel) setPlantillaData(null);
      } finally {
        if (!cancel) setPlantillaLoading(false);
      }
    };

    run();
    return () => {
      cancel = true;
    };
  }, [plantillaSel, fetchPlantillaById]);

  const loadInformesPoints = async () => {
    const map = mapObjRef.current;
    if (!map) return;

    setLoading(true);
    try {
      clearMarkers();
      setCounts({ informes: 0 });

      const qs = plantillaSel ? `?plantilla=${encodeURIComponent(plantillaSel)}` : "";
      const url = `${API_URL}/informes/proyecto/${id}/puntos${qs}`;

      const data = await fetchGeoJSON(url);
      if (data?.ok === false) throw new Error(data?.error || "No se pudieron cargar los puntos.");

      const features = data.features || [];
      const g = window.google;

      const ids = features
        .map((f) => {
          const p = f?.properties || {};
          return Number(p.id_informe ?? p.idInforme ?? p.id ?? p.id_informe_fk);
        })
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 10);

      setTop10InformeIds(ids);

      const AdvancedMarker = g?.maps?.marker?.AdvancedMarkerElement;
      const created = [];

      for (const f of features) {
        if (f?.geometry?.type !== "Point") continue;
        const [lng, lat] = f.geometry.coordinates || [];
        const props = f.properties || {};

        const pos = { lat: toNum(lat), lng: toNum(lng) };
        if (pos.lat == null || pos.lng == null) continue;

        if (AdvancedMarker && g?.maps?.marker?.PinElement) {
          try {
            await g.maps.importLibrary("marker");
          } catch {}

          const pin = new g.maps.marker.PinElement({
            background: "#db1732ff",
            borderColor: "#ffffff",
            glyphColor: "#ffffff",
            glyph: "🗺️",
            scale: 1.1,
          });

          const m = new g.maps.marker.AdvancedMarkerElement({
            map: toggles.informes ? map : null,
            position: pos,
            content: pin.element,
            title: props.titulo || `Informe #${props.id_informe}`,
          });

          m.addListener("gmp-click", () => openPointPanel(props));
          created.push(m);
        } else if (AdvancedMarker) {
          const el = document.createElement("div");
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.borderRadius = "999px";
          el.style.background = "#2563eb";
          el.style.border = "3px solid #fff";
          el.style.boxShadow = "0 6px 16px rgba(0,0,0,.22)";

          const m = new AdvancedMarker({
            map: toggles.informes ? map : null,
            position: pos,
            content: el,
            title: props.titulo || `Informe #${props.id_informe}`,
          });

          m.addListener("gmp-click", () => openPointPanel(props));
          created.push(m);
        } else {
          const m = new g.maps.Marker({
            map: toggles.informes ? map : null,
            position: pos,
            title: props.titulo || `Informe #${props.id_informe}`,
          });
          m.addListener("click", () => openPointPanel(props));
          created.push(m);
        }
      }

      markersRef.current = created;
      setCounts({ informes: created.length });
      fitToFeatures(features);
    } catch (err) {
      console.error("loadInformesPoints error:", err);
      alert(err.message || "No se pudieron cargar los puntos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    loadInformesPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, plantillaSel]);

  // ✅ rows mínimos para gráficos (top10)
  const fetchInformeDetalleRows = useCallback(
    async (idInforme) => {
      const resp = await fetch(`${API_URL}/informes/${idInforme}`, {
        headers: { ...authHeaders() },
      });
      const data = await resp.json();
      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Error ${resp.status}`);

      const preguntas = data.preguntas || [];
      const respuestas = data.respuestas || [];

      const mapResp = new Map();
      for (const r of respuestas) {
        const idp = r?.id_pregunta;
        if (!idp) continue;

        let v = "";
        if (r.valor_bool !== null && r.valor_bool !== undefined) v = r.valor_bool ? "Sí" : "No";
        else if (r.valor_json) {
          try {
            const parsed = JSON.parse(r.valor_json);
            v = Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
          } catch {
            v = String(r.valor_json);
          }
        } else if (r.valor_texto != null) v = String(r.valor_texto);
        else v = "";

        mapResp.set(idp, v);
      }

      const rows = preguntas.map((p) => ({
        id_pregunta: p.id_pregunta,
        etiqueta: p.etiqueta || `Pregunta ${p.id_pregunta}`,
        valor: mapResp.get(p.id_pregunta) || "-",
      }));

      return { rows };
    },
    [API_URL]
  );

  // ✅ cargar detalle completo para panel derecho y fotos
  const loadDetalleInforme = async (idInforme) => {
    if (!idInforme) return;
    if (detalleIdInforme === idInforme && detalleData?.rows?.length) return;

    setDetalleLoading(true);
    setDetalleError(null);
    setDetalleData(null);

    try {
      const resp = await fetch(`${API_URL}/informes/${idInforme}`, { headers: { ...authHeaders() } });
      const data = await resp.json();
      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Error ${resp.status}`);

      const preguntas = data.preguntas || [];
      const respuestas = data.respuestas || [];
      const fotos = data.fotos || [];

      const preguntasById = new Map();
      for (const p of preguntas) preguntasById.set(Number(p.id_pregunta), p);

      const mapResp = new Map();
      for (const r of respuestas) {
        const idp = r?.id_pregunta;
        if (!idp) continue;

        let v = "";
        if (r.valor_bool !== null && r.valor_bool !== undefined) v = r.valor_bool ? "Sí" : "No";
        else if (r.valor_json) {
          try {
            const parsed = JSON.parse(r.valor_json);
            v = Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
          } catch {
            v = String(r.valor_json);
          }
        } else if (r.valor_texto != null) v = String(r.valor_texto);
        else v = "";

        mapResp.set(idp, v);
      }

      const rows = preguntas.map((p) => ({
        id_pregunta: p.id_pregunta,
        etiqueta: p.etiqueta || `Pregunta ${p.id_pregunta}`,
        valor: mapResp.get(p.id_pregunta) || "-",
      }));

      const fotosByPregunta = groupFotosByPregunta(fotos);
      const fotosCount = (fotos || []).length;

      setDetalleIdInforme(idInforme);
      setDetalleData({ rows, fotosByPregunta, preguntasById, fotosCount });
    } catch (e) {
      setDetalleError(e.message || "No se pudo cargar el detalle.");
    } finally {
      setDetalleLoading(false);
    }
  };

  const onClickVerInforme = async () => {
    const idInforme = selectedPoint?.id_informe;
    if (!idInforme) return;

    if (!verInformeOpen) {
      setVerInformeOpen(true);
      await loadDetalleInforme(idInforme);
      return;
    }
    setVerInformeOpen(false);
  };

  const onClickVerFotos = async () => {
    const idInforme = selectedPoint?.id_informe;
    if (!idInforme) return;

    if (!detalleData || detalleIdInforme !== idInforme) {
      await loadDetalleInforme(idInforme);
    }
    setFotosModalOpen(true);
  };

  const openGraficos = () => {
    setSidebarOpen(false);
    setRightOpen(false);
    setFotosModalOpen(false);

    setVerInformeOpen(false);
    setDetalleData(null);
    setDetalleError(null);
    setDetalleIdInforme(null);

    setGraficosModalOpen(true);
  };

  const onChangePlantilla = (nextId) => {
    const next = nextId ? String(nextId) : "";
    setPlantillaSel(next || null);

    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("plantilla", next);
    else sp.delete("plantilla");
    setSearchParams(sp, { replace: true });

    setRightOpen(false);
    setSelectedPoint(null);
    setGraficosModalOpen(false);
    setFotosModalOpen(false);
    setVerInformeOpen(false);
    setDetalleData(null);
    setDetalleError(null);
    setDetalleIdInforme(null);
  };

  const plantillaNombreSel = useMemo(() => {
    if (!plantillaSel) return "";
    const p = plantillasProyecto.find((x) => String(x.id_plantilla) === String(plantillaSel));
    return p?.nombre || `Plantilla ${plantillaSel}`;
  }, [plantillasProyecto, plantillaSel]);

  return (
    <div className="fsv-root">
      <div className="fsv-navbar">
        <Navbar />
      </div>

      <div className="fsv-map" ref={mapDivRef} />

      <div className="fsv-toolbar">
        <button
          onClick={() => {
            setGraficosModalOpen(false);
            setSidebarOpen((v) => !v);
          }}
          className="fsv-pill"
          title="Capas"
        >
          <span className="fsv-pill__icon">🗺️</span>
          <span className="fsv-pill__text">Capas</span>
        </button>

        <button onClick={toggleVista} className="fsv-pill" title={vista === "hybrid" ? "Vista Mapa" : "Vista Satélite"}>
          <span className="fsv-pill__icon">🛰️</span>
          <span className="fsv-pill__text">{vista === "hybrid" ? "Mapa" : "Satélite"}</span>
        </button>

        <button onClick={openGraficos} className="fsv-pill" title="Gráficos (Top 10)" disabled={!plantillaSel || plantillaLoading}>
          <span className="fsv-pill__icon">📊</span>
          <span className="fsv-pill__text">
            {!plantillaSel ? "Elegí plantilla" : plantillaLoading ? "Cargando…" : "Gráficos"}
          </span>
        </button>

        <button onClick={goToProjects} className="fsv-pill" title="Proyectos">
          <span className="fsv-pill__icon">↩</span>
          <span className="fsv-pill__text">Proyectos</span>
        </button>
      </div>

      <aside className={`fsv-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sb-hdr">
          <h3 className="sb-title">
            Puntos de informes{" "}
            {plantillaSel ? <Badge bg="secondary">{plantillaNombreSel}</Badge> : <Badge bg="warning">Sin plantilla</Badge>}
          </h3>
          <button className="sb-close" onClick={() => setSidebarOpen(false)} title="Cerrar">
            ✕
          </button>
        </div>

        <div className="fsv-sidebar__body">
          <button onClick={toggleVista} className="btn-alt">
            {vista === "hybrid" ? "Vista Mapa" : "Vista Satélite"}
          </button>

          <details className="sb-group" open>
            <summary className="sb-summary">Capas</summary>

            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Plantilla</div>

                {plantillasLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Spinner size="sm" />
                    <span style={{ fontSize: 13 }}>Cargando plantillas…</span>
                  </div>
                ) : plantillasError ? (
                  <div className="alert alert-danger" style={{ padding: 10, margin: 0 }}>
                    {plantillasError}
                    <div style={{ marginTop: 8 }}>
                      <button className="btn-main" onClick={loadPlantillasProyecto}>
                        🔄 Reintentar
                      </button>
                    </div>
                  </div>
                ) : plantillasProyecto.length <= 1 ? (
                  <div style={{ fontSize: 13, color: "#374151" }}>
                    {plantillasProyecto[0]?.nombre || "No hay plantillas para este proyecto."}
                  </div>
                ) : (
                  <Form.Select
                    size="sm"
                    value={plantillaSel || ""}
                    onChange={(e) => onChangePlantilla(e.target.value)}
                    style={{ borderRadius: 10 }}
                  >
                    {plantillasProyecto.map((p) => (
                      <option key={p.id_plantilla} value={p.id_plantilla}>
                        {p.nombre}
                      </option>
                    ))}
                  </Form.Select>
                )}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={!!toggles.informes}
                  onChange={() => setToggles((p) => ({ ...p, informes: !p.informes }))}
                />
                <span>📍 Puntos de informes</span>
              </label>

              <div style={{ fontSize: 13 }}>
                Total puntos: <b>{counts.informes}</b>
              </div>

              <div style={{ fontSize: 13 }}>
                Top 10 IDs: <b>{top10InformeIds.length}</b>
              </div>

              <button className="btn-main" onClick={loadInformesPoints} disabled={!plantillaSel}>
                🔄 Recargar
              </button>

              <button className="btn-ghost" onClick={goToProyecto}>
                Proyecto
              </button>

              {loading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Spinner size="sm" />
                  <span style={{ fontSize: 13 }}>Cargando puntos…</span>
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </aside>

      {/* ✅ PANEL DERECHO (DETALLE INFORME) */}
      {rightOpen ? (
        <aside className="fsv-rightpanel">
          <div className="rp-hdr">
            <p className="rp-eyebrow">Detalle</p>
            <h3 className="rp-title">
              {selectedPoint?.titulo || (selectedPoint?.id_informe ? `Informe #${selectedPoint.id_informe}` : "Punto")}
            </h3>
            <button className="rp-close" onClick={() => setRightOpen(false)} title="Cerrar">
              ✕
            </button>
          </div>

          {!selectedPoint ? (
            <div className="text-muted">Seleccioná un punto en el mapa.</div>
          ) : (
            <div style={{ fontSize: 14 }}>
              <div>
                <b>ID informe:</b> {selectedPoint.id_informe}
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant={verInformeOpen ? "primary" : "outline-primary"} onClick={onClickVerInforme}>
                  {verInformeOpen ? "Cerrar informe" : "Ver informe"}
                </Button>

                <Button size="sm" variant="outline-dark" onClick={onClickVerFotos} disabled={detalleLoading}>
                  📷 Ver fotos {typeof detalleData?.fotosCount === "number" ? `(${detalleData.fotosCount})` : ""}
                </Button>
              </div>

              {verInformeOpen ? (
                <>
                  <hr className="fsv-hr" />
                  {detalleLoading ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Spinner size="sm" />
                      <span>Cargando respuestas…</span>
                    </div>
                  ) : null}

                  {detalleError ? (
                    <div className="alert alert-danger" style={{ padding: 10 }}>
                      {detalleError}
                    </div>
                  ) : null}

                  {detalleData?.rows?.length ? (
                    <div style={{ maxHeight: "58vh", overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
                      <table className="table table-sm table-striped mb-0">
                        <thead style={{ position: "sticky", top: 0, background: "white", zIndex: 2 }}>
                          <tr>
                            <th style={{ width: "55%" }}>Pregunta</th>
                            <th>Respuesta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detalleData.rows.map((r) => (
                            <tr key={r.id_pregunta}>
                              <td style={{ fontWeight: 700 }}>{r.etiqueta}</td>
                              <td style={{ whiteSpace: "pre-wrap" }}>{r.valor}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </aside>
      ) : null}

      {/* ✅ MODAL FOTOS */}
      <Modal show={fotosModalOpen} onHide={() => setFotosModalOpen(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Fotos del informe</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detalleLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner size="sm" />
              <span>Cargando fotos…</span>
            </div>
          ) : null}

          {!detalleLoading && (!detalleData?.fotosByPregunta || Object.keys(detalleData.fotosByPregunta).length === 0) ? (
            <div className="text-muted">Este informe no tiene fotos.</div>
          ) : null}

          {!detalleLoading &&
            detalleData?.fotosByPregunta &&
            Object.entries(detalleData.fotosByPregunta).map(([idp, arr]) => {
              const p = detalleData?.preguntasById?.get?.(Number(idp));
              const titulo = p?.etiqueta ? p.etiqueta : `Pregunta ${idp}`;

              return (
                <div key={idp} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>{titulo}</div>

                  <div className="d-flex flex-wrap gap-2">
                    {(arr || []).map((f) => {
                      const idFoto = Number(f.id_foto || f.id);
                      const url = fotoUrl(f.ruta_archivo);

                      return (
                        <a
                          key={idFoto}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "block",
                            width: 170,
                            border: "1px solid #e5e7eb",
                            borderRadius: 10,
                            padding: 6,
                            background: "#fff",
                            textDecoration: "none",
                          }}
                          title="Abrir imagen"
                        >
                          <div style={{ width: "100%", height: 110, overflow: "hidden", borderRadius: 8 }}>
                            <img src={url} alt="foto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setFotosModalOpen(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ✅ MODAL GRÁFICOS */}
      <EncuestasChartsModal
        show={graficosModalOpen}
        onHide={() => setGraficosModalOpen(false)}
        titulo="Centro de Control — Gráficos"
        informeIds={top10InformeIds}
        fetchInformeDetalle={fetchInformeDetalleRows}
        plantilla={plantillaData}
        plantillaId={plantillaSel}
      />
    </div>
  );
}
