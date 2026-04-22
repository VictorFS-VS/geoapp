// src/auth/authz.js
export function normalizeScope(v) {
  // soporta legacy si algún día vuelve "cartera"
  if (!v) return "none";
  if (v === "cartera") return "project";
  return v; // all | project | own | none
}

export function buildAuthz(user) {
  const perms = new Set(user?.perms || []);
  const scopes = user?.permsScope || {};

  const can = (perm) => perms.has(perm);

  const scopeOf = (perm) => normalizeScope(scopes?.[perm] || "none");

  /**
   * Evalúa scope sobre un recurso conocido.
   * Pasale lo que tengas disponible del item: { ownerId, projectId, allowedProjectIds }
   *
   * - all: ok
   * - project: requiere que el proyecto esté en allowedProjectIds (si lo tenés) o que matchee projectId (si lo comparás)
   * - own: requiere ownerId === user.id
   */
  const canOn = (perm, ctx = {}) => {
    if (!can(perm)) return false;
    const scope = scopeOf(perm);
    if (scope === "all") return true;
    if (scope === "none") return false;

    if (scope === "own") {
      if (!Number.isFinite(Number(ctx.ownerId))) return false;
      return Number(ctx.ownerId) === Number(user?.id);
    }

    if (scope === "project") {
      // si tenés allowedProjectIds desde backend: ideal
      if (Array.isArray(ctx.allowedProjectIds) && ctx.allowedProjectIds.length) {
        return ctx.projectId != null && ctx.allowedProjectIds.includes(Number(ctx.projectId));
      }
      // fallback: si no tenés cartera, no asumas true
      return false;
    }

    return false;
  };

  return { can, scopeOf, canOn };
}
