// src/utils/auth.js
// ✅ Auth helpers orientados a RBAC
// - Mantiene GROUPS por compatibilidad
// - Prioriza permisos sobre roles
// - Útil para Sidebar, RequirePerm, redirects y vistas

export const GROUPS = {
  ADMIN: 1,

  // SAAP
  SISTEMAS: 3,
  ADMINISTRADOR_SAAP: 6,
  CLIENTE_OFF_SAAP: 7,
  CONSULTOR_SAAP: 8,
  CLIENTE_SAAP: 9,

  // VIAL / MAPS
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,

  // Consultores extra
  BASE: 13,
  CONSULTOR_VIAL: 14,
  CONSULTOR_VIP: 15,
};

/* =========================================================
 * Compatibilidad legacy por grupos
 * ========================================================= */
export const CONSULTOR_ROLES = [
  GROUPS.CONSULTOR_SAAP,
  GROUPS.CONSULTOR_VIAL,
  GROUPS.CONSULTOR_VIP,
];

export const CLIENTE_ROLES = [
  GROUPS.CLIENTE_SAAP,
  GROUPS.CLIENTE_VIAL,
  GROUPS.CLIENTE_MAPS,
  GROUPS.CLIENTE_OFF_SAAP,
];

export const ALL_USERS = [
  GROUPS.ADMIN,
  GROUPS.ADMIN_CLIENTE,
  ...CONSULTOR_ROLES,
  ...CLIENTE_ROLES,
  GROUPS.SISTEMAS,
  GROUPS.ADMINISTRADOR_SAAP,
  GROUPS.BASE,
];

/* =========================================================
 * Storage / sesión
 * ========================================================= */
export const getToken = () =>
  localStorage.getItem("token") ||
  localStorage.getItem("access_token") ||
  localStorage.getItem("jwt") ||
  null;

export const isLoggedIn = () => !!getToken();

export const getUser = () => {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setUser = (user) => {
  try {
    localStorage.setItem("user", JSON.stringify(user || null));
  } catch {
    // noop
  }
};

export const clearAuth = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("access_token");
  localStorage.removeItem("jwt");
  localStorage.removeItem("user");
};

export const getTipoUsuario = () => {
  const u = getUser();
  return u?.tipo_usuario != null ? Number(u.tipo_usuario) : null;
};

export const getDefaultProyectoId = () => {
  const u = getUser();
  return u?.default_proyecto_id != null ? Number(u.default_proyecto_id) : null;
};

/* =========================================================
 * JWT helpers
 * ========================================================= */
export const decodeJWT = (token) => {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

export const getTipoUsuarioFromToken = () => {
  try {
    const token = getToken();
    const decoded = decodeJWT(token);
    const t = decoded?.tipo_usuario ?? decoded?.group_id ?? null;
    return t != null ? Number(t) : null;
  } catch {
    return null;
  }
};

/* =========================================================
 * Permisos RBAC
 * ========================================================= */

/**
 * Normaliza una lista de permisos que puede venir como:
 * - ["usuarios.read", "usuarios.update"]
 * - [{ code: "usuarios.read" }, { code: "usuarios.update" }]
 * - mezcla de ambos
 */
export const normalizePerms = (perms) => {
  if (!Array.isArray(perms)) return [];

  const out = [];
  for (const p of perms) {
    if (typeof p === "string" && p.trim()) {
      out.push(p.trim());
    } else if (p && typeof p === "object" && typeof p.code === "string" && p.code.trim()) {
      out.push(p.code.trim());
    }
  }

  return [...new Set(out)];
};

export const getUserPerms = (userArg = null) => {
  const u = userArg || getUser();
  return normalizePerms(u?.perms);
};

export const hasPerm = (code, userArg = null) => {
  if (!code) return false;
  return getUserPerms(userArg).includes(code);
};

export const hasAnyPerm = (codes = [], userArg = null) => {
  if (!Array.isArray(codes) || codes.length === 0) return false;
  const perms = getUserPerms(userArg);
  return codes.some((c) => perms.includes(c));
};

export const hasAllPerms = (codes = [], userArg = null) => {
  if (!Array.isArray(codes) || codes.length === 0) return false;
  const perms = getUserPerms(userArg);
  return codes.every((c) => perms.includes(c));
};

/* =========================================================
 * Helpers UI / navegación por permisos
 * ========================================================= */
export const canSeeDashboardProyectos = (userArg = null) =>
  hasPerm("dashboard.proyectos.read", userArg);

export const canSeeDashboardTramos = (userArg = null) =>
  hasPerm("dashboard.encuestas.read", userArg);

export const canSeeAnyDashboard = (userArg = null) =>
  hasAnyPerm(["dashboard.proyectos.read", "dashboard.encuestas.read"], userArg);

export const canAccessUsuarios = (userArg = null) =>
  hasAnyPerm(["usuarios.read", "usuarios.create", "usuarios.update", "usuarios.delete"], userArg);

export const canAccessConceptos = (userArg = null) =>
  hasAnyPerm(["conceptos.read", "conceptos.create", "conceptos.update", "conceptos.delete"], userArg);

export const canAccessGrupos = (userArg = null) =>
  hasAnyPerm(
    [
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
    userArg
  );

export const canAccessPushCampaigns = (userArg = null) =>
  hasAnyPerm(
    [
      "push_campaigns.read",
      "push_campaigns.create",
      "push_campaigns.send",
      "push_campaigns.update",
      "push_campaigns.delete",
    ],
    userArg
  );

export const canAccessInformesPlantillas = (userArg = null) =>
  hasAnyPerm(
    [
      "informes.plantillas.read",
      "informes.plantillas.create",
      "informes.plantillas.update",
      "informes.plantillas.delete",
    ],
    userArg
  );

/* =========================================================
 * Legacy por rol (compatibilidad temporal)
 * Ya no deberían gobernar el acceso principal
 * ========================================================= */
export const esAdmin = () => {
  const tipo = getTipoUsuario();
  const tipoToken = getTipoUsuarioFromToken();
  return tipo === GROUPS.ADMIN || tipoToken === GROUPS.ADMIN;
};

export const esAdminCliente = () => {
  const tipo = getTipoUsuario();
  const tipoToken = getTipoUsuarioFromToken();
  return tipo === GROUPS.ADMIN_CLIENTE || tipoToken === GROUPS.ADMIN_CLIENTE;
};

export const esConsultorSaap = () => getTipoUsuario() === GROUPS.CONSULTOR_SAAP;
export const esConsultorVial = () => getTipoUsuario() === GROUPS.CONSULTOR_VIAL;
export const esConsultorVip = () => getTipoUsuario() === GROUPS.CONSULTOR_VIP;
export const esConsultor = () => CONSULTOR_ROLES.includes(getTipoUsuario());

export const esClienteSaap = () => getTipoUsuario() === GROUPS.CLIENTE_SAAP;
export const esClienteVial = () => getTipoUsuario() === GROUPS.CLIENTE_VIAL;
export const esClienteMaps = () => getTipoUsuario() === GROUPS.CLIENTE_MAPS;
export const esClienteOffSaap = () => getTipoUsuario() === GROUPS.CLIENTE_OFF_SAAP;
export const esCliente = () => CLIENTE_ROLES.includes(getTipoUsuario());

export const puedeEliminar = (userArg = null) => {
  if (hasPerm("delete", userArg)) return true;
  if (hasAnyPerm(["usuarios.delete", "proyectos.delete", "conceptos.delete"], userArg)) return true;
  return !esCliente();
};

export const puedeEditar = (userArg = null) => {
  if (hasPerm("update", userArg)) return true;
  if (hasAnyPerm(["usuarios.update", "proyectos.update", "conceptos.update"], userArg)) return true;
  return !esCliente();
};

export const tieneRol = (roles = []) => {
  const tipo = getTipoUsuario();
  return tipo != null && roles.map(Number).includes(Number(tipo));
};