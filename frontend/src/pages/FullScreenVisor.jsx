// src/pages/FullScreenVisor.jsx ✅ COMPLETO
// ✅ ModuloTramos pasa { id_tramo, label, feature } al padre
// ✅ tramoFilter ahora incluye:
//    - activeTramoId
//    - activeTramoLabel
//    - activeTramoKey
//    - activeTramoLabelNorm
//    - feature
// ✅ listo para que ModuloInformes filtre por pregunta/respuesta de tramo

import React, { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Modal, Button } from "react-bootstrap";

const ModuloPoligonos = React.lazy(() => import("@/map/modules/ModuloPoligonos"));
const ModuloInformes = React.lazy(() => import("@/map/modules/ModuloInformes"));
const ModuloTramos = React.lazy(() => import("@/map/modules/ModuloTramos"));
const ModuloEncuestas = React.lazy(() => import("@/map/modules/ModuloEncuestas"));

import { CensoChartsModal, InformeChartsModal } from "@/components/charts";
import { loadGoogleMapsApi } from "@/utils/loadGoogleMapsApi";
import "@/styles/visorFull.css";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* =========================
   AUTH HEADERS (JWT)
========================= */
function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* =========================
   LOG helper
========================= */
const DBG = false;
function log(...args) {
  if (!DBG) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}
function warn(...args) {
  if (!DBG) return;
  // eslint-disable-next-line no-console
  console.warn(...args);
}

/* =========================
   Helpers tramo
========================= */
function normalizeTramoKey(v) {
  if (v == null) return "";
  const s = String(v).trim().toLowerCase().replace(",", ".");
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

function normalizeTextLoose(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(",", ".");
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }

  componentDidCatch(err, info) {
    console.error("[ErrorBoundary]", this.props.name, err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="visor-full-error" style={{ whiteSpace: "pre-wrap" }}>
          ⚠️ Error en {this.props.name || "módulo"}:{" "}
          {this.state.err?.message || String(this.state.err || "Error")}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function FullScreenVisor() {
  const { id } = useParams();
  const idProyecto = Number(id);
  const navigate = useNavigate();

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);

  const userDisabledPuntosRef = useRef(false);
  const userDisabledEncuestasRef = useRef(false);

  const tramosUIRef = useRef(null);
  const hasTramosStickyRef = useRef(false);

  // ✅ tramo activo compartido
  const [activeTramoId, setActiveTramoId] = useState("");
  const [activeTramoLabel, setActiveTramoLabel] = useState("");
  const [activeTramoKey, setActiveTramoKey] = useState("");
  const [activeTramoFeature, setActiveTramoFeature] = useState(null);

  // ✅ solo tramo activo
  const [soloTramoActivo, setSoloTramoActivo] = useState(false);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  const [mapType, setMapType] = useState("hybrid");

  const [hasData, setHasData] = useState({
    capas: false,
    puntos: false,
    tramos: false,
    encuestas: false,
  });

  const [hasUso, setHasUso] = useState(false);

  const [capasPanelOpen, setCapasPanelOpen] = useState(true);
  const [capasEnabled, setCapasEnabled] = useState(true);

  const [puntosEnabled, setPuntosEnabled] = useState(false);
  const [puntosPanelOpen, setPuntosPanelOpen] = useState(false);

  const [encuestasEnabled, setEncuestasEnabled] = useState(false);
  const [encuestasPanelOpen, setEncuestasPanelOpen] = useState(false);

  const [tramosEnabled, setTramosEnabled] = useState(false);

  const [btnActive, setBtnActive] = useState({
    mapa: false,
    analisis: false,
    graficos: false,
  });

  const [showCensoCharts, setShowCensoCharts] = useState(false);
  const [showInformeCharts, setShowInformeCharts] = useState(false);
  const [showChartsChooser, setShowChartsChooser] = useState(false);

  const [chartsAvail, setChartsAvail] = useState({
    censoCharts: false,
    informeCharts: false,
  });

  const [informeIds, setInformeIds] = useState([]);
  const [plantilla, setPlantilla] = useState(null);
  const [plantillaId, setPlantillaId] = useState(null);
  const [chartsTitulo, setChartsTitulo] = useState("Centro de Control — Gráficos");

  const API_KEY =
    import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_GMAPS_API_KEY;
  const MAP_ID = String(import.meta.env.VITE_GOOGLE_MAP_ID || "").trim();

  /* =========================
     fetchInformeDetalle
  ========================= */
  const fetchInformeDetalle = useCallback(async (idInforme) => {
    const resp = await fetch(`${API_URL}/informes/${idInforme}`, {
      headers: { ...authHeaders() },
    });

    const ct = resp.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const data = isJson ? await resp.json() : null;

    if (!resp.ok || data?.ok === false) {
      const msg =
        data?.error ||
        data?.message ||
        (isJson ? `Error ${resp.status}` : await resp.text());
      throw new Error(msg || `Error ${resp.status}`);
    }

    if (Array.isArray(data?.rows)) return { rows: data.rows };
    if (Array.isArray(data?.data?.rows)) return { rows: data.data.rows };

    const preguntas = data?.preguntas || data?.data?.preguntas || [];
    const respuestas = data?.respuestas || data?.data?.respuestas || [];

    const mapResp = new Map();
    for (const r of respuestas) {
      const idp = r?.id_pregunta;
      if (!idp) continue;

      let v = "";
      if (r.valor_bool !== null && r.valor_bool !== undefined) {
        v = r.valor_bool ? "Sí" : "No";
      } else if (r.valor_json) {
        try {
          const parsed = JSON.parse(r.valor_json);
          v = Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
        } catch {
          v = String(r.valor_json);
        }
      } else if (r.valor_texto != null) {
        v = String(r.valor_texto);
      } else {
        v = "";
      }

      mapResp.set(idp, v);
    }

    const rows = (preguntas || []).map((p) => ({
      id_pregunta: p.id_pregunta,
      etiqueta: p.etiqueta || `Pregunta ${p.id_pregunta}`,
      valor: mapResp.get(p.id_pregunta) || "-",
    }));

    return { rows };
  }, []);

  /* =========================
     Init Google Maps
  ========================= */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setErr("");
        setReady(false);

        if (!API_KEY) {
          throw new Error("Falta VITE_GOOGLE_MAPS_KEY (o VITE_GMAPS_API_KEY) en tu .env");
        }

        await loadGoogleMapsApi(API_KEY);
        if (cancelled) return;

        const g = window.google;
        if (!g?.maps?.Map) {
          throw new Error("Google Maps cargó, pero window.google.maps.Map no existe.");
        }

        try {
          await g.maps.importLibrary("marker");
        } catch {}

        if (!mapDivRef.current) {
          throw new Error("mapDivRef no está listo (div del mapa no existe).");
        }

        mapDivRef.current.style.height = mapDivRef.current.style.height || "100vh";
        mapDivRef.current.style.width = mapDivRef.current.style.width || "100%";

        const map = new g.maps.Map(mapDivRef.current, {
          center: { lat: -25.3, lng: -57.6 },
          zoom: 7,
          mapTypeId: "hybrid",
          mapId: MAP_ID || undefined,
          clickableIcons: false,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
        });

        mapRef.current = map;

        try {
          map.setMapTypeId(mapType);
        } catch {}

        setReady(true);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Error inicializando Google Maps");
        warn("[MAP] error:", e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_KEY, MAP_ID]);

  useEffect(() => {
    const map = mapRef.current;
    const g = window.google;
    if (!ready || !map || !g?.maps) return;
    try {
      map.setMapTypeId(mapType);
    } catch (e) {
      warn("No se pudo cambiar mapTypeId:", e);
    }
  }, [mapType, ready]);

  const toggleMapType = useCallback(() => {
    setMapType((prev) => (prev === "hybrid" ? "roadmap" : "hybrid"));
    setBtnActive((p) => ({ ...p, mapa: true }));
    setTimeout(() => setBtnActive((p) => ({ ...p, mapa: false })), 600);
  }, []);

  const goToProjects = useCallback(() => navigate("/proyectos"), [navigate]);

  const goToAnalysis = useCallback(() => {
    if (!idProyecto) return;
    if (!hasUso) return;
    navigate(`/proyectos/${idProyecto}/analisis-ndvi`);
  }, [navigate, idProyecto, hasUso]);

  /* =========================
     BOTONES
  ========================= */
  const handleCapasClick = () => {
    if (!hasData.capas) return;
    setCapasPanelOpen((v) => !v);
    setCapasEnabled(true);
  };

  const handlePuntosClick = () => {
    if (!hasData.puntos) return;

    if (!puntosEnabled) {
      userDisabledPuntosRef.current = false;
      setPuntosEnabled(true);
      setPuntosPanelOpen(false);
      return;
    }

    setPuntosPanelOpen((v) => !v);
  };

  const openTramosModal = useCallback(() => {
    const ui = tramosUIRef.current;
    if (ui?.openTramos) return ui.openTramos();
    warn("ModuloTramos uiRef.openTramos no disponible.");
  }, []);

  const handleEncuestasClick = useCallback(() => {
    if (!hasData.encuestas) return;
    setEncuestasPanelOpen((v) => !v);
  }, [hasData.encuestas]);

  const handleInformeChartsInfo = useCallback((payload = {}) => {
    if (!payload) return;

    if (payload.open) {
      setChartsTitulo(payload.titulo || "Centro de Control — Gráficos");

      const ids =
        (Array.isArray(payload.informeIds) && payload.informeIds) ||
        (Array.isArray(payload.ids) && payload.ids) ||
        [];

      if (ids.length) setInformeIds(ids);

      if (payload.plantilla !== undefined) setPlantilla(payload.plantilla);
      if (payload.plantillaId !== undefined) setPlantillaId(payload.plantillaId);

      setShowInformeCharts(true);
    }
  }, []);

  const handleGraficosClick = useCallback(() => {
    const canCenso = !!chartsAvail.censoCharts;
    const canInforme = !!chartsAvail.informeCharts;

    setBtnActive((p) => ({ ...p, graficos: true }));
    setTimeout(() => setBtnActive((p) => ({ ...p, graficos: false })), 400);

    if (canCenso && !canInforme) return setShowCensoCharts(true);
    if (!canCenso && canInforme) return setShowInformeCharts(true);

    if (canCenso && canInforme) {
      setShowChartsChooser(true);
    }
  }, [chartsAvail]);

  /* =========================
     Reset por cambio proyecto
  ========================= */
  useEffect(() => {
    userDisabledPuntosRef.current = false;
    userDisabledEncuestasRef.current = false;

    hasTramosStickyRef.current = false;

    setPuntosEnabled(false);
    setPuntosPanelOpen(false);

    setEncuestasEnabled(false);
    setEncuestasPanelOpen(false);

    setActiveTramoId("");
    setActiveTramoLabel("");
    setActiveTramoKey("");
    setActiveTramoFeature(null);
    setSoloTramoActivo(false);

    setTramosEnabled(false);

    setShowCensoCharts(false);
    setShowInformeCharts(false);
    setShowChartsChooser(false);
    setChartsAvail({ censoCharts: false, informeCharts: false });
    setInformeIds([]);
    setPlantilla(null);
    setPlantillaId(null);
    setChartsTitulo("Centro de Control — Gráficos");

    setHasUso(false);

    setHasData({ capas: false, puntos: false, tramos: false, encuestas: false });

    try {
      tramosUIRef.current?.closeAll?.();
    } catch {}
  }, [idProyecto]);

  /* =========================
     onHasData handlers
  ========================= */
  const setHasPuntos = useCallback((v) => {
    const has = !!v;

    setHasData((p) => ({ ...p, puntos: has }));

    if (!has) {
      setPuntosEnabled(false);
      setPuntosPanelOpen(false);
      return;
    }

    setPuntosEnabled(true);
    setPuntosPanelOpen(false);
  }, []);

  const setHasCapas = useCallback((v) => {
    const has = !!v;

    setHasData((p) => ({ ...p, capas: has }));
    if (!has) {
      setCapasEnabled(false);
      setCapasPanelOpen(false);
    } else {
      setCapasEnabled(true);
    }
  }, []);

  const setHasUsos = useCallback((v) => {
    setHasUso(!!v);
  }, []);

  const setHasTramos = useCallback((v) => {
    const has = !!v;

    if (has) hasTramosStickyRef.current = true;

    setHasData((p) => ({ ...p, tramos: has || hasTramosStickyRef.current }));

    // ❌ ya no apagar puntos automáticamente cuando cargan tramos
    // if (has) {
    //   setPuntosEnabled(false);
    //   setPuntosPanelOpen(false);
    // }

    requestAnimationFrame(() => {
      const ui = tramosUIRef.current;
      if (ui?.getEnabled) {
        const en = !!ui.getEnabled();
        setTramosEnabled(en);
      }
    });
  }, []);

  const setHasEncuestas = useCallback((v) => {
    const has = !!v;
    setHasData((p) => ({ ...p, encuestas: has }));

    if (!has) {
      setEncuestasEnabled(false);
      setEncuestasPanelOpen(false);
    }
  }, []);

  const setHasCensoCharts = useCallback((v) => {
    setChartsAvail((p) => ({ ...p, censoCharts: !!v }));
  }, []);

  const setHasInformeCharts = useCallback(({ has, ids = [], plantilla, plantillaId } = {}) => {
    setChartsAvail((p) => ({ ...p, informeCharts: !!has }));
    setInformeIds(Array.isArray(ids) ? ids : []);
    setPlantilla(plantilla ?? null);
    setPlantillaId(plantillaId ?? null);
  }, []);

  /* =========================
     sync estado visual de tramos
  ========================= */
  useEffect(() => {
    if (!ready || !idProyecto) return;
    let t = null;

    const tick = () => {
      const ui = tramosUIRef.current;
      if (ui?.getEnabled) {
        const en = !!ui.getEnabled();
        setTramosEnabled(en);
      }
      t = setTimeout(tick, 800);
    };

    tick();
    return () => t && clearTimeout(t);
  }, [ready, idProyecto]);

  const anyPanelOpen = capasPanelOpen || puntosPanelOpen || encuestasPanelOpen;
  const canAnalisis = !!idProyecto && !!hasUso;
  const hasAnyCharts = !!chartsAvail.censoCharts || !!chartsAvail.informeCharts;

  /* =========================
     filtro compartido a informes
  ========================= */
  const tramoFilter = {
    enabled: !!soloTramoActivo && !!activeTramoKey && !!activeTramoFeature,
    activeTramoId,
    activeTramoLabel,
    activeTramoKey,
    activeTramoLabelNorm: normalizeTextLoose(activeTramoLabel),
    feature: activeTramoFeature,
  };

  return (
    <div className="visor-full-page" style={{ height: "100vh", width: "100%" }}>
      <div
        ref={mapDivRef}
        className="visor-full-map"
        style={{ height: "100vh", width: "100%" }}
      />

      {err && <div className="visor-full-error">⚠️ {err}</div>}

      {!Number.isFinite(idProyecto) || idProyecto <= 0 ? (
        <div className="visor-full-error">⚠️ id de proyecto inválido: "{String(id)}"</div>
      ) : null}

      {/* FAB */}
      <div className={`visor-fab ${anyPanelOpen ? "behind-panel" : ""}`}>
        {hasData.capas && (
          <button
            className={`fab-btn ${capasPanelOpen ? "active" : ""}`}
            onClick={handleCapasClick}
            title={capasPanelOpen ? "Ocultar panel de capas" : "Mostrar capas"}
          >
            <span className="fab-ico">🗺️</span>
            <span className="fab-txt">Capas</span>
          </button>
        )}

        {hasData.puntos && (
          <button
            className={`fab-btn ${puntosEnabled ? "active" : ""}`}
            onClick={handlePuntosClick}
            title={
              puntosEnabled
                ? puntosPanelOpen
                  ? "Ocultar panel (puntos siguen activos)"
                  : "Mostrar panel (puntos activos)"
                : "Activar puntos"
            }
          >
            <span className="fab-ico">📍</span>
            <span className="fab-txt">Puntos</span>
          </button>
        )}

        {hasData.tramos && (
          <button
            className={`fab-btn ${tramosEnabled ? "active" : ""}`}
            onClick={openTramosModal}
            title={tramosEnabled ? "Tramos (activos)" : "Tramos"}
          >
            <span className="fab-ico">🧩</span>
            <span className="fab-txt">Tramos</span>
          </button>
        )}

        {hasData.encuestas && (
          <button
            className={`fab-btn ${encuestasEnabled ? "active" : ""}`}
            onClick={handleEncuestasClick}
            title={encuestasEnabled ? "Censados (activos)" : "Censados"}
          >
            <span className="fab-ico">🧑‍💼</span>
            <span className="fab-txt">Censados</span>
          </button>
        )}

        <button
          className={`fab-btn ${btnActive.mapa ? "active" : ""}`}
          onClick={toggleMapType}
          title={mapType === "hybrid" ? "Cambiar a Normal" : "Cambiar a Satélite"}
        >
          <span className="fab-ico">🧭</span>
          <span className="fab-txt">{mapType === "hybrid" ? "Satélite" : "Normal"}</span>
        </button>

        {canAnalisis && (
          <button
            className={`fab-btn ${btnActive.analisis ? "active" : ""}`}
            onClick={() => {
              setBtnActive((p) => ({ ...p, analisis: true }));
              goToAnalysis();
              setTimeout(() => setBtnActive((p) => ({ ...p, analisis: false })), 600);
            }}
            title="Ir al análisis del proyecto"
          >
            <span className="fab-ico">📈</span>
            <span className="fab-txt">Análisis</span>
          </button>
        )}

        {hasAnyCharts && (
          <button
            className={`fab-btn ${btnActive.graficos ? "active" : ""}`}
            onClick={handleGraficosClick}
            title="Ver gráficos"
          >
            <span className="fab-ico">📊</span>
            <span className="fab-txt">Gráficos</span>
          </button>
        )}

        <button className="fab-btn" onClick={goToProjects} title="Volver a proyectos">
          <span className="fab-ico">📁</span>
          <span className="fab-txt">Proyectos</span>
        </button>
      </div>

      {/* MÓDULOS */}
      <Suspense fallback={null}>
        {ready && window.google && mapRef.current && idProyecto > 0 && (
          <ErrorBoundary name="ModuloPoligonos">
            <ModuloPoligonos
              google={window.google}
              map={mapRef.current}
              idProyecto={idProyecto}
              visible={capasEnabled}
              panelOpen={capasPanelOpen}
              onOpenChange={setCapasPanelOpen}
              onClose={() => setCapasPanelOpen(false)}
              onHasData={setHasCapas}
              onHasUsos={setHasUsos}
            />
          </ErrorBoundary>
        )}

        {ready && window.google && mapRef.current && idProyecto > 0 && (
          <ErrorBoundary name="ModuloInformes">
            <ModuloInformes
              google={window.google}
              map={mapRef.current}
              idProyecto={idProyecto}
              enabled={puntosEnabled}
              panelOpen={puntosPanelOpen}
              onPanelOpenChange={setPuntosPanelOpen}
              onDisable={() => {
                userDisabledPuntosRef.current = true;
                setPuntosEnabled(false);
                setPuntosPanelOpen(false);
              }}
              onHasData={setHasPuntos}
              onHasCharts={setHasInformeCharts}
              onChartsInfo={handleInformeChartsInfo}
              tramoFilter={tramoFilter}
            />
          </ErrorBoundary>
        )}

        {ready && window.google && mapRef.current && idProyecto > 0 && (
          <ErrorBoundary name="ModuloTramos">
            <ModuloTramos
              google={window.google}
              map={mapRef.current}
              idProyecto={idProyecto}
              visible={true}
              uiRef={tramosUIRef}
              onHasData={setHasTramos}
              onHasCharts={setHasCensoCharts}
              onSelectTramo={(idt, info) => {
                const idSel = idt != null && idt !== "" ? String(idt) : "";
                const label = info?.label || "";
                const key = normalizeTramoKey(label);
                const feature = info?.feature || null;

                setActiveTramoId(idSel);
                setSoloTramoActivo(!!idSel);

                setActiveTramoLabel(label);
                setActiveTramoKey(key);
                setActiveTramoFeature(feature);

                log("[TRAMOS] select:", {
                  id_tramo: idSel,
                  label,
                  key,
                  feature,
                });
              }}
              onClearTramo={() => {
                setActiveTramoId("");
                setSoloTramoActivo(false);
                setActiveTramoLabel("");
                setActiveTramoKey("");
                setActiveTramoFeature(null);
                log("[TRAMOS] clear");
              }}
            />
          </ErrorBoundary>
        )}

        {ready && window.google && mapRef.current && idProyecto > 0 && (
          <ErrorBoundary name="ModuloEncuestas">
            <ModuloEncuestas
              google={window.google}
              map={mapRef.current}
              idProyecto={idProyecto}
              visible={true}
              enabled={encuestasEnabled}
              onEnabledChange={(v) => {
                userDisabledEncuestasRef.current = !v;
                setEncuestasEnabled(!!v);
              }}
              panelOpen={encuestasPanelOpen}
              onPanelOpenChange={(v) => {
                setEncuestasPanelOpen(!!v);
              }}
              onDisable={() => {
                userDisabledEncuestasRef.current = true;
                setEncuestasEnabled(false);
                setEncuestasPanelOpen(false);
              }}
              onHasData={setHasEncuestas}
              activeTramoId={activeTramoId}
            />
          </ErrorBoundary>
        )}
      </Suspense>

      {/* CHOOSER: si hay Censo + Informe */}
      <Modal show={showChartsChooser} onHide={() => setShowChartsChooser(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>¿Qué gráficos querés ver?</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="d-grid gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setShowChartsChooser(false);
                setShowCensoCharts(true);
              }}
            >
              Gráficos de Censo (Tramos)
            </Button>

            <Button
              variant="success"
              onClick={() => {
                setShowChartsChooser(false);
                setShowInformeCharts(true);
              }}
            >
              Gráficos de Informe (Plantilla)
            </Button>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowChartsChooser(false)}>
            Cancelar
          </Button>
        </Modal.Footer>
      </Modal>

      <CensoChartsModal
        show={showCensoCharts}
        onHide={() => setShowCensoCharts(false)}
        idProyecto={idProyecto}
      />

      <InformeChartsModal
        show={showInformeCharts}
        onHide={() => setShowInformeCharts(false)}
        titulo={chartsTitulo}
        idProyecto={idProyecto}
        informeIds={informeIds}
        fetchInformeDetalle={fetchInformeDetalle}
        plantilla={plantilla}
        plantillaId={plantillaId}
      />
    </div>
  );
}
