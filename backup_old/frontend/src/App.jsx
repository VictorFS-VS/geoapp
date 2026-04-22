/* =========================
   ✅ App.jsx (RBAC)
   - ProtectedRoute = solo autenticación
   - RequirePerm = autorización por permisos
   - Se elimina la dependencia de groups/roles para navegación principal
   ========================= */
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Modal, Alert, Button } from "react-bootstrap";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import CrearProyecto from "./pages/CrearProyecto";
import EditarProyecto from "./pages/EditarProyecto";
import VerProyecto from "./pages/VerProyecto";
import VisorProyecto from "./pages/VisorProyecto";
import Mantenimiento from "./pages/Mantenimiento";
import Resoluciones from "./pages/Resoluciones";
import Declaraciones from "./pages/Declaraciones";
import Pga from "./pages/Pga";
import EvaluacionProyecto from "./pages/Evaluaciones";
import ProyectoTabs from "./pages/ProyectoTabs";
import Consultores from "./pages/Consultores";
import Proponentes from "./pages/Proponentes";
import Conceptos from "./pages/Conceptos";
import Usuarios from "./pages/Usuarios";
import Grupos from "./pages/Grupos";
import FullScreenVisor from "./pages/FullScreenVisor";
import TodasLasNotificaciones from "./components/TodasLasNotificaciones";
import GestorNotificacionesAdmin from "./pages/GestorNotificacionesAdmin";
import Tramos from "./pages/Tramos";
import Encuestas from "./pages/Encuestas";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardTramos from "./pages/DashboardTramos";

import Expedientes from "./pages/Expedientes";
import GVCatastroDashboard from "./modules/gv/GVCatastroDashboard";
import GVADashboardInformes from "./modules/gv/gva_informes/GVADashboardInformes";
import RequirePerm from "./components/RequirePerm";
import PublicInforme from "./pages/PublicInforme";

import FormularioActa from "./pages/FormularioActa";
import ListaActas from "./pages/ListaActas";
import EditarActa from "./pages/EditarActa";

import InformePlantillaBuilder from "./pages/InformePlantillaBuilder";
import InformeDinamico from "./pages/InformeDinamico";
import InformesProyecto from "./pages/InformesProyecto";
import InformesProyectoPlantillas from "./pages/InformesProyectoPlantillas";

import EncuestasPorCliente from "@/pages/EncuestasPorCliente";
import AnalisisNDVI from "./views/AnalisisNDVI/AnalisisNDVI";
import PoiTramo from "@/pages/PoiTramo";
import HistorialNDVI from "@/views/HistorialNDVI/HistorialNDVI";
import UserMaps from "@/components/UserMaps";
import ProjectHomePage from "./modules/projectHome/ProjectHomePage";
import { ProjectProvider } from "./context/ProjectContext";

import { getUser } from "@/utils/auth";

// ✅ Regencia
import Regencia from "./pages/Regencia";
import RegenciaContratos from "./pages/RegenciaContratos";

// ✅ PUSH CAMPAIGNS
import PushCampaigns from "./pages/PushCampaigns";

// ✅ Reportes
import ReportesProyecto from "./pages/ReportesProyecto";
import ReporteBuilder from "./pages/ReporteBuilder";

/* =========================
   Helpers permisos
========================= */
function getUserPerms(u) {
  return Array.isArray(u?.perms) ? u.perms : [];
}

function hasPerm(u, code) {
  return getUserPerms(u).includes(code);
}

function hasAnyPerm(u, codes = []) {
  const perms = getUserPerms(u);
  return codes.some((c) => perms.includes(c));
}

/* =========================
   Permisos por módulo
   Ajustá los códigos si alguno difiere en tu backend
========================= */
const PERMS = {
  DASH_PROYECTOS: ["dashboard.proyectos.read"],
  DASH_TRAMOS: ["dashboard.encuestas.read"],

  PUSH: [
    "push_campaigns.read",
    "push_campaigns.create",
    "push_campaigns.send",
    "push_campaigns.update",
    "push_campaigns.delete",
  ],

  NOTIF_ADMIN: ["notificaciones.read.admin", "notificaciones.read"],
  NOTIF: ["notificaciones.read", "notificaciones.read.admin"],

  PROYECTOS: ["proyectos.read"],
  PROYECTOS_CREAR: ["proyectos.create"],
  PROYECTOS_EDITAR: ["proyectos.update"],
  PROYECTOS_VER: ["proyectos.read", "proyectos.view"],

  CONSULTOR_READ: ["consultores.read"],
  PROPONENTE_READ: ["proponentes.read"],

  EXPEDIENTES: [
    "expedientes.read",
    "expedientes.create",
    "expedientes.update",
    "expedientes.upload",
  ],

  MANTENIMIENTO: [
    "mantenimiento.read",
    "mantenimiento.create",
    "mantenimiento.update",
    "mantenimiento.import",
    "mantenimiento.export",
  ],

  PGA: ["pga.read", "pga.create", "pga.update", "pga.delete"],
  DECLARACIONES: ["declaraciones.read", "declaraciones.create", "declaraciones.update", "declaraciones.delete"],
  RESOLUCIONES: ["resoluciones.read", "resoluciones.create", "resoluciones.update", "resoluciones.delete"],
  EVALUACIONES: ["evaluaciones.read", "evaluaciones.create", "evaluaciones.update", "evaluaciones.delete"],

  REGENCIA: [
    "regencia.contratos.read",
    "regencia.actividades.read",
    "regencia.responsables.read",
  ],
  REGENCIA_CONTRATOS: [
    "regencia.contratos.read",
    "regencia.contratos.create",
    "regencia.contratos.update",
    "regencia.contratos.delete",
  ],

  TABS_PROYECTO: [
    "proyectos.read",
    "tramos.read",
    "encuestas.read",
    "informes.read",
    "expedientes.read",
  ],

  CONCEPTOS: ["conceptos.read", "conceptos.create", "conceptos.update", "conceptos.delete"],

  USUARIOS: ["usuarios.read", "usuarios.create", "usuarios.update", "usuarios.delete"],

  GRUPOS_RBAC: [
    "rbac.roles.read",
    "rbac.roles.create",
    "rbac.roles.update",
    "rbac.roles.delete",
    "rbac.role_perms.read",
    "rbac.role_perms.update",
    "rbac.user_roles.read",
    "rbac.user_roles.update",
    "roles.read",
    "roles.create",
    "roles.update",
    "roles.delete",
  ],

  TRAMOS: ["tramos.read", "tramos.create", "tramos.update", "tramos.delete"],
  ENCUESTAS: ["encuestas.read", "encuestas.create", "encuestas.update", "encuestas.delete", "encuestas.import"],
  POI: ["poi.read", "poi.create", "poi.update", "poi.delete"],

  ACTAS: ["actas.read", "actas.create", "actas.update", "actas.delete"],

  INFORMES_PLANTILLAS: [
    "informes.plantillas.read",
    "informes.plantillas.create",
    "informes.plantillas.update",
    "informes.plantillas.delete",
  ],

  INFORMES: [
    "informes.read",
    "informes.create",
    "informes.update",
    "informes.delete",
    "informes.dashboard.read",
    "informes.dashboard.charts.read",
  ],

  REPORTES: ["reportes.read", "reportes.create", "reportes.update", "reportes.delete"],

  NDVI: ["use_change.read", "use_change.create", "use_change.delete"],
};

/* =========================
   Redirect por permisos
========================= */
function canSeeDashboard(u) {
  return hasAnyPerm(u, [...PERMS.DASH_PROYECTOS, ...PERMS.DASH_TRAMOS]);
}

function canSeeMaps(u) {
  return hasAnyPerm(u, [
    ...PERMS.PROYECTOS,
    ...PERMS.TRAMOS,
    ...PERMS.ENCUESTAS,
    ...PERMS.POI,
  ]);
}

function ClienteVisorRedirect({ API_URL }) {
  const u = getUser();
  const tok = localStorage.getItem("token");
  const [to, setTo] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const idCliente = u?.id_cliente;
        if (!tok || !idCliente) return setTo("/proyectos");

        const res = await fetch(`${API_URL}/proyectos/primero-por-proponente/${idCliente}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });

        const j = res.ok ? await res.json() : null;
        const idProyecto = j?.gid ?? null;

        setTo(idProyecto ? `/visor-full/${idProyecto}` : "/proyectos");
      } catch {
        setTo("/proyectos");
      }
    })();
  }, [API_URL, tok, u]);

  if (!to) return null;
  return <Navigate to={to} replace />;
}

/* =========================
   FIX Vencimientos: dedupe en front
========================= */
const normalizeTxt = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const getProyectoIdFromNotif = (n) => {
  if (n?.id_proyecto != null) return Number(n.id_proyecto);
  const msg = normalizeTxt(n?.mensaje);
  const m = msg.match(/proyecto\s+(\d+)/i);
  return m ? Number(m[1]) : null;
};

const isResolucionVence = (n) => {
  const t = normalizeTxt(n?.titulo);
  return t.includes("resolucion") && t.includes("vence en");
};

const pickLatestPerProyecto = (items) => {
  const map = new Map();

  for (const n of items) {
    const pid =
      getProyectoIdFromNotif(n) ??
      `no-proyecto:${n?.id_notificacion ?? n?.id ?? Math.random()}`;

    const prev = map.get(pid);

    const dtN = n?.creado_en ? new Date(n.creado_en).getTime() : 0;
    const dtP = prev?.creado_en ? new Date(prev.creado_en).getTime() : 0;

    const idN = Number(n?.id_notificacion ?? n?.id ?? 0);
    const idP = Number(prev?.id_notificacion ?? prev?.id ?? 0);

    if (!prev || dtN > dtP || (dtN === dtP && idN > idP)) {
      map.set(pid, n);
    }
  }

  return Array.from(map.values());
};

const withDaysSorted = (items) =>
  items
    .map((n) => {
      const t = normalizeTxt(n?.titulo);
      const m = t.match(/vence en\s+(-?\d+)\s+dia/);
      const dias = m ? Number(m[1]) : null;
      return { ...n, _dias: dias };
    })
    .sort((a, b) => {
      const da = a._dias ?? 999999;
      const db = b._dias ?? 999999;
      return da - db;
    });

function App() {
  const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
  const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

  const decodeJWT = (token) => {
    try {
      const [, p] = token.split(".");
      return JSON.parse(atob(p));
    } catch {
      return null;
    }
  };

  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(() => {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  });

  const [reminders, setReminders] = useState([]);
  const [showReminderModal, setShowModal] = useState(false);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  };

  useEffect(() => {
    if (!token) return;
    const decoded = decodeJWT(token);
    if (!decoded || Date.now() >= decoded.exp * 1000) logout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchReminders = async (tok) => {
    try {
      const res = await fetch(`${API_URL}/notificaciones/todas`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) return;

      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];

      const due = arr.filter(isResolucionVence);
      const unique = pickLatestPerProyecto(due);
      const sorted = withDaysSorted(unique);

      if (sorted.length) {
        setReminders(sorted);
        setShowModal(true);
      }
    } catch (err) {
      console.error("Error trayendo recordatorios:", err);
    }
  };

  const handleLogin = (tok, usr) => {
    setToken(tok);
    setUser(usr);
    localStorage.setItem("token", tok);
    localStorage.setItem("user", JSON.stringify(usr));

    fetchReminders(tok);
  };

  const isLogged = Boolean(token && user);

  const redirectForLogged = () => {
    const u = user || getUser();

    if (canSeeDashboard(u)) return "/";
    if (canSeeMaps(u)) return "/cliente-visor";
    return "/";
  };

  const DashIndex = () => {
    const u = user || getUser();

    if (hasAnyPerm(u, PERMS.DASH_PROYECTOS)) return <Dashboard />;
    if (hasAnyPerm(u, PERMS.DASH_TRAMOS)) return <DashboardTramos />;
    if (canSeeMaps(u)) return <Navigate to="/cliente-visor" replace />;
    return <Dashboard />;
  };

  return (
    <ProjectProvider>
      <Router>
        <Routes>
        {/* ✅ PÚBLICA */}
        <Route path="/public-informe/:token" element={<PublicInforme />} />

        {/* Login */}
        <Route
          path="/login"
          element={
            !isLogged ? (
              <Login onLogin={handleLogin} />
            ) : (
              <Navigate to={redirectForLogged()} replace />
            )
          }
        />

        {/* Full screen */}
        <Route
          path="/historial-ndvi/:id"
          element={
            <ProtectedRoute>
              <RequirePerm anyOf={PERMS.NDVI} redirectTo="/">
                <HistorialNDVI />
              </RequirePerm>
            </ProtectedRoute>
          }
        />

        <Route
          path="/proyectos/:id/analisis-ndvi"
          element={
            <ProtectedRoute>
              <RequirePerm anyOf={PERMS.NDVI} redirectTo="/">
                <AnalisisNDVI />
              </RequirePerm>
            </ProtectedRoute>
          }
        />

        {/* App con Layout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <UserMaps>
                <Layout collapsed={false} toggleSidebar={() => {}} />
              </UserMaps>
            </ProtectedRoute>
          }
        >
          {/* INDEX */}
          <Route
            index
            element={
              <ProtectedRoute>
                <DashIndex />
              </ProtectedRoute>
            }
          />

          {/* Redirect visor cliente por permisos */}
          <Route
            path="cliente-visor"
            element={
              <ProtectedRoute>
                <RequirePerm
                  anyOf={[...PERMS.PROYECTOS, ...PERMS.TRAMOS, ...PERMS.ENCUESTAS, ...PERMS.POI]}
                  redirectTo="/"
                >
                  <ClienteVisorRedirect API_URL={API_URL} />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Push */}
          <Route
            path="push-campaigns"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PUSH} redirectTo="/">
                  <PushCampaigns />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Notificaciones admin */}
          <Route
            path="notificaciones-admin"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.NOTIF_ADMIN} redirectTo="/">
                  <GestorNotificacionesAdmin />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* visor-full */}
          <Route
            path="visor-full/:id"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={[...PERMS.PROYECTOS, ...PERMS.TRAMOS, ...PERMS.ENCUESTAS, ...PERMS.POI]} redirectTo="/">
                  <FullScreenVisor />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Dashboard tramos */}
          <Route
            path="dashboardtramos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.DASH_TRAMOS} redirectTo="/">
                  <DashboardTramos />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Dashboard informes v2 (base) */}
          <Route
            path="dashboardinformes"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES} redirectTo="/">
                  <GVADashboardInformes />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Proyectos */}
          <Route
            path="proyectos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROYECTOS} redirectTo="/">
                  <Projects />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Reportes */}
          <Route
            path="proyectos/:id/reportes"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.REPORTES} redirectTo="/proyectos">
                  <ReportesProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="reportes/:idReporte"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.REPORTES} redirectTo="/proyectos">
                  <ReporteBuilder />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* CRUD proyecto */}
          <Route
            path="proyectos/:id/editar"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROYECTOS_EDITAR} redirectTo="/proyectos">
                  <EditarProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:id/ver"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROYECTOS_VER} redirectTo="/proyectos">
                  <VerProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="crear-proyecto"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROYECTOS_CREAR} redirectTo="/proyectos">
                  <CrearProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* visor proyecto */}
          <Route
            path="visor/:id"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={[...PERMS.PROYECTOS, ...PERMS.TRAMOS, ...PERMS.ENCUESTAS]} redirectTo="/proyectos">
                  <VisorProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Expedientes */}
          <Route
            path="proyectos/:id/expedientes"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.EXPEDIENTES} redirectTo="/proyectos">
                  <Expedientes />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* GV Catastro */}
          <Route
            path="proyectos/:id/gv-catastro"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={["expedientes.read"]} redirectTo="/proyectos">
                  <GVCatastroDashboard />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Mantenimiento */}
          <Route
            path="proyectos/:id/mantenimiento"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.MANTENIMIENTO} redirectTo="/proyectos">
                  <Mantenimiento />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* PGA */}
          <Route
            path="proyectos/:id/pga"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PGA} redirectTo="/proyectos">
                  <Pga />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Declaraciones */}
          <Route
            path="proyectos/:id/declaraciones"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.DECLARACIONES} redirectTo="/proyectos">
                  <Declaraciones />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Resoluciones */}
          <Route
            path="proyectos/:id/resoluciones"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.RESOLUCIONES} redirectTo="/proyectos">
                  <Resoluciones />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Evaluaciones */}
          <Route
            path="proyectos/:id/evaluaciones"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.EVALUACIONES} redirectTo="/proyectos">
                  <EvaluacionProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Regencia */}
          <Route
            path="proyectos/:id/regencia"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.REGENCIA} redirectTo="/proyectos">
                  <Regencia />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:id/regencia/contratos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.REGENCIA_CONTRATOS} redirectTo="/proyectos">
                  <RegenciaContratos />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Tabs */}
          <Route
            path="proyectos/:id/tabs"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.TABS_PROYECTO} redirectTo="/proyectos">
                  <ProyectoTabs />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Catálogos */}
          <Route
            path="proyectos/consultores"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.CONSULTOR_READ} redirectTo="/proyectos">
                  <Consultores />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/proponentes"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROPONENTE_READ} redirectTo="/proyectos">
                  <Proponentes />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Configuración */}
          <Route
            path="configuracion/conceptos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.CONCEPTOS} redirectTo="/">
                  <Conceptos />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="configuracion/usuarios"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.USUARIOS} redirectTo="/">
                  <Usuarios />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="configuracion/grupos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.GRUPOS_RBAC} redirectTo="/">
                  <Grupos />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Notificaciones */}
          <Route
            path="notificaciones"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.NOTIF} redirectTo="/">
                  <TodasLasNotificaciones />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Tramos */}
          <Route
            path="proyectos/:id/tramos"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.TRAMOS} redirectTo="/proyectos">
                  <Tramos />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="encuestas/:id/:tramoId"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.ENCUESTAS} redirectTo="/proyectos">
                  <Encuestas />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyecto/:id/encuestas"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.ENCUESTAS} redirectTo="/proyectos">
                  <EncuestasPorCliente />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* POI */}
          <Route
            path="poi/:idProyecto/:idTramo"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.POI} redirectTo="/proyectos">
                  <PoiTramo />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:idProyecto/poi"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.POI} redirectTo="/proyectos">
                  <PoiTramo />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Actas */}
          <Route
            path="proyectos/:id/actas-preconstruccion"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.ACTAS} redirectTo="/proyectos">
                  <FormularioActa />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:id/actas"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.ACTAS} redirectTo="/proyectos">
                  <ListaActas />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:id/actas/:id_acta/editar"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.ACTAS} redirectTo="/proyectos">
                  <EditarActa />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          {/* Informes dinámicos */}
          <Route
            path="informes/plantillas"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES_PLANTILLAS} redirectTo="/">
                  <InformePlantillaBuilder />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:idProyecto/informes"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES} redirectTo="/proyectos">
                  <InformesProyectoPlantillas />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:idProyecto/informes/lista"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES} redirectTo="/proyectos">
                  <InformesProyecto />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:idProyecto/informes/nuevo"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES} redirectTo="/proyectos">
                  <InformeDinamico />
                </RequirePerm>
              </ProtectedRoute>
            }
          />

          <Route
            path="proyectos/:idProyecto/informes/:idInforme/editar"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.INFORMES} redirectTo="/proyectos">
                  <InformeDinamico />
                </RequirePerm>
              </ProtectedRoute>
            }
          />
          <Route
            path="project-home/:id_proyecto"
            element={
              <ProtectedRoute>
                <RequirePerm anyOf={PERMS.PROYECTOS} redirectTo="/proyectos">
                  <ProjectHomePage />
                </RequirePerm>
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Catch-all */}
        <Route
          path="*"
          element={isLogged ? <Navigate to="/" replace /> : <Navigate to="/login" replace />}
        />
        </Routes>

      {/* Modal Vencimientos */}
      <Modal show={showReminderModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>🚨 Aviso de Vencimiento</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {reminders.map((n) => (
            <Alert
              key={n.id_notificacion ?? n.id}
              variant="warning"
              className="d-flex justify-content-between align-items-center"
            >
              <div>
                <strong>{n.titulo}</strong>
                <div className="small">{n.mensaje}</div>
              </div>
            </Alert>
          ))}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowModal(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
      </Router>
    </ProjectProvider>
  );
}

export default App;
