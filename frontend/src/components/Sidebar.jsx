import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FaHome,
  FaProjectDiagram,
  FaUserTie,
  FaUsers,
  FaFolder,
  FaCogs,
  FaList,
  FaShieldAlt,
  FaFileAlt,
  FaBell,
} from "react-icons/fa";

import { useAuth } from "@/auth/AuthContext";

/* =========================
   helpers
========================= */

function getUserPermsFromStorage() {
  try {
    const s = localStorage.getItem("user");
    if (!s) return [];
    const u = JSON.parse(s);
    return Array.isArray(u?.perms) ? u.perms : [];
  } catch {
    return [];
  }
}

function hasPerm(auth, code) {
  if (typeof auth?.hasPerm === "function") return !!auth.hasPerm(code);

  const permsAuth = auth?.user?.perms;
  if (Array.isArray(permsAuth)) return permsAuth.includes(code);

  const permsLS = getUserPermsFromStorage();
  return permsLS.includes(code);
}

function hasAnyPerm(auth, codes = []) {
  return codes.some((c) => hasPerm(auth, c));
}

export default function Sidebar({ collapsed, toggleSidebar }) {
  const location = useLocation();
  const yaColapzoRef = useRef(false);

  const auth = useAuth();
  const authLoading = !!auth?.loading;

  const [hovered, setHovered] = useState(false);
  const [esCelular, setEsCelular] = useState(window.innerWidth < 768);

  const [openSubmenu, setOpenSubmenu] = useState(() =>
    location.pathname.startsWith("/proyectos")
      ? "proyectos"
      : location.pathname.startsWith("/configuracion") ||
        location.pathname.startsWith("/informes") ||
        location.pathname.startsWith("/push-campaigns")
      ? "configuracion"
      : ""
  );

  const esMovil = () => window.innerWidth < 768;
  const isExpanded = !collapsed || hovered;

  useEffect(() => {
    const onResize = () => setEsCelular(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (location.pathname === "/") {
      setOpenSubmenu("");
    } else if (location.pathname.startsWith("/proyectos")) {
      setOpenSubmenu("proyectos");
    } else if (
      location.pathname.startsWith("/configuracion") ||
      location.pathname.startsWith("/informes") ||
      location.pathname.startsWith("/push-campaigns")
    ) {
      setOpenSubmenu("configuracion");
    }

    if (!yaColapzoRef.current && localStorage.getItem("colapsarSidebar") === "true") {
      if (!collapsed) toggleSidebar();
      localStorage.removeItem("colapsarSidebar");
      yaColapzoRef.current = true;
    }
  }, [location.pathname, collapsed, toggleSidebar]);

  const toggleSubmenu = (name) => setOpenSubmenu((prev) => (prev === name ? "" : name));

  const handleHomeClick = () => {
    setOpenSubmenu("");
    if (!collapsed && esMovil()) toggleSidebar();
  };

  const handleItemClick = () => {
    if (!collapsed && esMovil()) toggleSidebar();
  };

  if (esCelular && collapsed) return null;

  /* =========================
     PERMISOS RBAC
  ========================= */

  const canDashAmbiental = hasPerm(auth, "dashboard.proyectos.read");
  const canDashTramos = hasPerm(auth, "dashboard.encuestas.read");

  const canPlantillas = hasAnyPerm(auth, [
    "informes.plantillas.read",
    "informes.plantillas.create",
    "informes.plantillas.update",
    "informes.plantillas.delete",
  ]);

  const canUsuarios = hasAnyPerm(auth, [
    "usuarios.read",
    "usuarios.create",
    "usuarios.update",
    "usuarios.delete",
  ]);

  const canNotificaciones = hasPerm(auth, "notificaciones.read");
  const canNotificacionesAdmin = hasPerm(auth, "notificaciones.read.admin");

  const canPushCampaigns = hasAnyPerm(auth, [
    "push_campaigns.read",
    "push_campaigns.create",
    "push_campaigns.send",
    "push_campaigns.update",
    "push_campaigns.delete",
  ]);

  const pushEntryPath = "/push-campaigns";

  const canConceptos = hasAnyPerm(auth, [
    "conceptos.read",
    "conceptos.create",
    "conceptos.update",
    "conceptos.delete",
  ]);

  const canGrupos = hasAnyPerm(auth, [
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
  ]);

  const canVerModuloProyectos = hasAnyPerm(auth, [
    "proyectos.read",
    "consultores.read",
    "proponentes.read",
  ]);

  const mostrarAdministracion =
    canPlantillas ||
    canUsuarios ||
    canNotificaciones ||
    canNotificacionesAdmin ||
    canPushCampaigns ||
    canConceptos ||
    canGrupos;

  return (
    <aside
      className="bg-success text-white position-fixed start-0 h-100 d-flex flex-column"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: isExpanded ? "220px" : "60px",
        top: "60px",
        transition: "width 0.3s",
        zIndex: 1000,
        paddingTop: "1rem",
      }}
    >
      <nav className="nav flex-column px-2">
        {authLoading && (
          <div className="text-white-50 px-2 pb-2" style={{ fontSize: 12 }}>
            Cargando permisos...
          </div>
        )}

        {/* =========================
            TABLEROS
        ========================= */}

        {canDashAmbiental && (
          <NavLink
            to="/"
            onClick={handleHomeClick}
            className={({ isActive }) =>
              `nav-link text-white d-flex align-items-center gap-2 py-2 px-2 ${
                isActive ? "bg-dark rounded" : ""
              }`
            }
          >
            <FaHome />
            {isExpanded && <span>Tablero Pro Ambiental</span>}
          </NavLink>
        )}

        {canDashTramos && (
          <NavLink
            to="/dashboardtramos"
            onClick={handleHomeClick}
            className={({ isActive }) =>
              `nav-link text-white d-flex align-items-center gap-2 py-2 px-2 ${
                isActive ? "bg-dark rounded" : ""
              }`
            }
          >
            <FaHome />
            {isExpanded && <span>Tablero Tramos</span>}
          </NavLink>
        )}

        {/* =========================
            ADMINISTRACIÓN
        ========================= */}

        {mostrarAdministracion && (
          <>
            <div
              role="button"
              onClick={() => toggleSubmenu("configuracion")}
              className={`nav-link d-flex align-items-center gap-2 py-2 px-2 text-white ${
                openSubmenu === "configuracion" ? "bg-dark rounded" : ""
              }`}
            >
              <FaCogs />
              {isExpanded && <span>Administración</span>}
            </div>

            {isExpanded && openSubmenu === "configuracion" && (
              <div
                className="ps-3 border-start mt-2"
                style={{
                  borderColor: "rgba(255,255,255,0.3)",
                  backgroundColor: "#1b3a2f",
                  borderRadius: "6px",
                  padding: "0.5rem 0.25rem",
                }}
              >
                {canPushCampaigns && (
                  <NavLink
                    to={pushEntryPath}
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaBell />
                    <span>Notificaciones (Push)</span>
                  </NavLink>
                )}

                {canNotificacionesAdmin && (
                  <NavLink
                    to="/notificaciones-admin"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaBell />
                    <span>Gestionar Notificaciones</span>
                  </NavLink>
                )}

                {canUsuarios && (
                  <NavLink
                    to="/configuracion/usuarios"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaUserTie />
                    <span>Usuarios</span>
                  </NavLink>
                )}

                {canGrupos && (
                  <NavLink
                    to="/configuracion/grupos"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaShieldAlt />
                    <span>Grupos de Seguridad</span>
                  </NavLink>
                )}

                {canConceptos && (
                  <NavLink
                    to="/configuracion/conceptos"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaList />
                    <span>Conceptos</span>
                  </NavLink>
                )}

                {canPlantillas && (
                  <NavLink
                    to="/informes/plantillas"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaFileAlt />
                    <span>Plantillas informes</span>
                  </NavLink>
                )}
              </div>
            )}
          </>
        )}

        {/* =========================
            PROYECTOS
        ========================= */}

        {canVerModuloProyectos && (
          <>
            <div
              role="button"
              onClick={() => toggleSubmenu("proyectos")}
              className={`nav-link d-flex align-items-center gap-2 py-2 px-2 text-white ${
                openSubmenu === "proyectos" ? "bg-dark rounded" : ""
              }`}
            >
              <FaFolder />
              {isExpanded && <span>Proyectos EMA</span>}
            </div>

            {isExpanded && openSubmenu === "proyectos" && (
              <div
                className="ps-3 border-start mt-2"
                style={{
                  borderColor: "rgba(255,255,255,0.3)",
                  backgroundColor: "#1b3a2f",
                  borderRadius: "6px",
                  padding: "0.5rem 0.25rem",
                }}
              >
                {hasPerm(auth, "proyectos.read") && (
                  <NavLink
                    to="/proyectos"
                    end
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaProjectDiagram />
                    <span>Proyectos de Impacto Ambiental</span>
                  </NavLink>
                )}

                {hasPerm(auth, "consultores.read") && (
                  <NavLink
                    to="/proyectos/consultores"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaUserTie />
                    <span>Consultores</span>
                  </NavLink>
                )}

                {hasPerm(auth, "proponentes.read") && (
                  <NavLink
                    to="/proyectos/proponentes"
                    onClick={handleItemClick}
                    className={({ isActive }) =>
                      `nav-link text-white d-flex align-items-center gap-2 py-1 ${
                        isActive ? "bg-dark rounded" : ""
                      }`
                    }
                  >
                    <FaUsers />
                    <span>Proponentes</span>
                  </NavLink>
                )}
              </div>
            )}
          </>
        )}
      </nav>
    </aside>
  );
}