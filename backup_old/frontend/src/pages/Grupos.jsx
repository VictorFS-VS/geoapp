//src/pages/Grupos.jsx
import React, { useEffect, useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { Plus, Shield, Save, CheckSquare, Square, Layers } from "lucide-react";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ===== Helpers de auth + fetch ===== */
const getBearer = () => {
  const t = localStorage.getItem("token");
  return t?.startsWith("Bearer ") ? t : t ? `Bearer ${t}` : null;
};

const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
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
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
};

const SCOPES = [
  { value: "own", label: "own" },
  { value: "project", label: "project" },
  { value: "all", label: "all" },
];

/* ===== RBAC permisos para esta pantalla ===== */
const RBAC_GRUPOS_PERMS = [
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
];

function normalizePerms(perms) {
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
}

function hasAnyPerm(user, codes = []) {
  const perms = normalizePerms(user?.perms);
  return codes.some((c) => perms.includes(c));
}

export default function Grupos() {
  const [grupos, setGrupos] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear"); // crear | editar | ver
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [usuarioActual, setUsuarioActual] = useState(null);

  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    bgcolor: "#607D8B",
  });

  // ===== Modal permisos =====
  const [permsOpen, setPermsOpen] = useState(false);
  const [permsLoading, setPermsLoading] = useState(false);
  const [permsSaving, setPermsSaving] = useState(false);
  const [permSearch, setPermSearch] = useState("");
  const [allPerms, setAllPerms] = useState([]); // [{id,code,description}]
  const [rolePermsMap, setRolePermsMap] = useState({}); // { permission_id: scope }
  const [rolePermsRole, setRolePermsRole] = useState(null); // {id,name}

  /* 1) Usuario actual */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/usuarios/me`, {
          headers: { ...authHeaders() },
        });
        const js = await jsonOrRedirect401(res);
        if (!js) return;
        setUsuarioActual(js);
      } catch (e) {
        console.error(e);
        setUsuarioActual(null);
        alerts?.toast?.error?.("No se pudo obtener el usuario actual.");
      }
    })();
  }, []);

  const canAccessGrupos = useMemo(() => {
    return hasAnyPerm(usuarioActual, RBAC_GRUPOS_PERMS);
  }, [usuarioActual]);

  const canReadGrupos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.roles.read", "roles.read"]);
  }, [usuarioActual]);

  const canCreateGrupos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.roles.create", "roles.create"]);
  }, [usuarioActual]);

  const canUpdateGrupos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.roles.update", "roles.update"]);
  }, [usuarioActual]);

  const canDeleteGrupos = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.roles.delete", "roles.delete"]);
  }, [usuarioActual]);

  const canReadRolePerms = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.role_perms.read"]);
  }, [usuarioActual]);

  const canUpdateRolePerms = useMemo(() => {
    return hasAnyPerm(usuarioActual, ["rbac.role_perms.update"]);
  }, [usuarioActual]);

  /* 2) Listado de grupos (roles) */
  useEffect(() => {
    if (canReadGrupos) cargarGrupos(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadGrupos, page, search]);

  const cargarGrupos = async (pagina = 1, filtro = "") => {
    try {
      const res = await fetch(
        `${API_URL}/groups?page=${pagina}&limit=10&search=${encodeURIComponent(filtro)}`,
        {
          headers: { "Content-Type": "application/json", ...authHeaders() },
        }
      );
      const data = await jsonOrRedirect401(res);
      if (!data) return;

      setGrupos(data.data || []);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error(err);
      setGrupos([]);
      alerts?.toast?.error?.("No se pudieron cargar los grupos.");
    }
  };

  const abrirModal = (nuevoModo, grupo = null) => {
    if (nuevoModo === "crear" && !canCreateGrupos) {
      alerts?.toast?.warning?.("No tienes permiso para crear roles.");
      return;
    }

    if (nuevoModo === "editar" && !canUpdateGrupos) {
      alerts?.toast?.warning?.("No tienes permiso para editar roles.");
      return;
    }

    if (grupo) {
      setFormData({
        id: String(grupo.id ?? ""),
        name: grupo.name || "",
        description: grupo.description || "",
        bgcolor: grupo.bgcolor || "#607D8B",
      });
    } else {
      setFormData({
        id: "",
        name: "",
        description: "",
        bgcolor: "#607D8B",
      });
    }

    setModo(nuevoModo);
    setModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const guardar = async () => {
    if (!formData.name.trim()) {
      alerts?.toast?.warning?.("El nombre es obligatorio.");
      return;
    }

    const isEdit = !!formData.id;

    if (isEdit && !canUpdateGrupos) {
      alerts?.toast?.warning?.("No tienes permiso para editar roles.");
      return;
    }

    if (!isEdit && !canCreateGrupos) {
      alerts?.toast?.warning?.("No tienes permiso para crear roles.");
      return;
    }

    try {
      const url = formData.id ? `${API_URL}/groups/${formData.id}` : `${API_URL}/groups`;
      const method = formData.id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(formData),
      });

      const js = await jsonOrRedirect401(res);
      if (!js) return;

      alerts?.toast?.success?.(js?.message || "Grupo guardado correctamente.");
      setModalOpen(false);
      cargarGrupos(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "Error al guardar el grupo.");
    }
  };

  const eliminar = async (id) => {
    if (!canDeleteGrupos) {
      alerts?.toast?.warning?.("No tienes permiso para eliminar roles.");
      return;
    }

    if (Number(id) === 1) {
      alerts?.toast?.warning?.("No se puede eliminar el rol ADMIN.");
      return;
    }

    if (!window.confirm("¿Eliminar este grupo?")) return;

    try {
      const res = await fetch(`${API_URL}/groups/${id}`, {
        method: "DELETE",
        headers: { ...authHeaders() },
      });

      const js = await jsonOrRedirect401(res);
      if (!js) return;

      alerts?.toast?.success?.(js?.message || "Grupo eliminado correctamente.");
      cargarGrupos(page, search);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "Error al eliminar el grupo.");
    }
  };

  const handleBuscar = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  // ====== Permisos por rol ======
  const abrirPermisos = async (role) => {
    if (!canReadRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para ver permisos del rol.");
      return;
    }

    setRolePermsRole({ id: role.id, name: role.name });
    setPermsOpen(true);
    setPermSearch("");
    setPermsLoading(true);
    setRolePermsMap({});

    try {
      const [rAll, rRole] = await Promise.all([
        fetch(`${API_URL}/rbac/perms`, { headers: { ...authHeaders() } }),
        fetch(`${API_URL}/rbac/roles/${role.id}/perms`, { headers: { ...authHeaders() } }),
      ]);

      const all = await jsonOrRedirect401(rAll);
      const rolePerms = await jsonOrRedirect401(rRole);
      if (!all || !rolePerms) return;

      const permsArr = all?.data || all || [];
      setAllPerms(permsArr);

      const map = {};
      for (const it of rolePerms.data || []) {
        map[String(it.permission_id)] = it.scope;
      }
      setRolePermsMap(map);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "No se pudieron cargar permisos.");
      setPermsOpen(false);
    } finally {
      setPermsLoading(false);
    }
  };

  const togglePerm = (permId) => {
    if (!canUpdateRolePerms) return;

    const key = String(permId);
    setRolePermsMap((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = "all";
      return next;
    });
  };

  const changeScope = (permId, scope) => {
    if (!canUpdateRolePerms) return;

    const key = String(permId);
    setRolePermsMap((prev) => ({
      ...prev,
      [key]: scope,
    }));
  };

  const guardarPermisos = async () => {
    if (!rolePermsRole?.id) return;

    if (!canUpdateRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para actualizar permisos del rol.");
      return;
    }

    setPermsSaving(true);
    try {
      const items = Object.entries(rolePermsMap).map(([permission_id, scope]) => ({
        permission_id: Number(permission_id),
        scope,
      }));

      const res = await fetch(`${API_URL}/rbac/roles/${rolePermsRole.id}/perms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ items }),
      });

      const js = await jsonOrRedirect401(res);
      if (!js) return;

      alerts?.toast?.success?.("Permisos guardados.");
      setPermsOpen(false);
    } catch (e) {
      console.error(e);
      alerts?.toast?.error?.(e.message || "Error guardando permisos.");
    } finally {
      setPermsSaving(false);
    }
  };

  const filteredPerms = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return allPerms;

    return allPerms.filter((p) => {
      const s = `${p.code || ""} ${p.description || ""}`.toLowerCase();
      return s.includes(q);
    });
  }, [allPerms, permSearch]);

  // ===== Helpers masivos sobre permisos visibles =====
  const filteredPermIds = useMemo(
    () => filteredPerms.map((p) => String(p.id)),
    [filteredPerms]
  );

  const visibleCheckedCount = useMemo(() => {
    return filteredPermIds.filter((id) => !!rolePermsMap[id]).length;
  }, [filteredPermIds, rolePermsMap]);

  const allVisibleChecked =
    filteredPermIds.length > 0 && visibleCheckedCount === filteredPermIds.length;

  const someVisibleChecked =
    visibleCheckedCount > 0 && visibleCheckedCount < filteredPermIds.length;

  const marcarVisibles = (defaultScope = "all") => {
    if (!canUpdateRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para actualizar permisos del rol.");
      return;
    }

    if (!filteredPermIds.length) {
      alerts?.toast?.warning?.("No hay permisos visibles para marcar.");
      return;
    }

    setRolePermsMap((prev) => {
      const next = { ...prev };
      for (const id of filteredPermIds) {
        if (!next[id]) next[id] = defaultScope;
      }
      return next;
    });
  };

  const desmarcarVisibles = () => {
    if (!canUpdateRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para actualizar permisos del rol.");
      return;
    }

    if (!filteredPermIds.length) {
      alerts?.toast?.warning?.("No hay permisos visibles para desmarcar.");
      return;
    }

    setRolePermsMap((prev) => {
      const next = { ...prev };
      for (const id of filteredPermIds) {
        delete next[id];
      }
      return next;
    });
  };

  const cambiarScopeVisibles = (scope) => {
    if (!canUpdateRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para actualizar permisos del rol.");
      return;
    }

    if (!filteredPermIds.length) {
      alerts?.toast?.warning?.("No hay permisos visibles.");
      return;
    }

    setRolePermsMap((prev) => {
      const next = { ...prev };
      for (const id of filteredPermIds) {
        if (next[id]) next[id] = scope;
      }
      return next;
    });
  };

  const toggleTodosVisibles = () => {
    if (!canUpdateRolePerms) {
      alerts?.toast?.warning?.("No tienes permiso para actualizar permisos del rol.");
      return;
    }

    if (!filteredPermIds.length) {
      alerts?.toast?.warning?.("No hay permisos visibles.");
      return;
    }

    if (allVisibleChecked) desmarcarVisibles();
    else marcarVisibles("all");
  };

  if (!canAccessGrupos) {
    return (
      <div className="container py-4 text-center">
        <h4 className="text-danger">🚫 No tienes autorización para acceder a esta sección.</h4>
      </div>
    );
  }

  return (
    <div className="container py-3">
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Grupos / Roles</h2>
          <p className="pc-sub">Creá roles y asigná permisos con scope (own/project/all).</p>
        </div>

        <div className="pc-actions">
          {canCreateGrupos && (
            <button className="pc-btn pc-btn-blue" onClick={() => abrirModal("crear")}>
              <Plus className="ico" /> Crear Rol
            </button>
          )}
        </div>
      </div>

      <div className="mb-3">
        <input
          type="text"
          className="form-control"
          placeholder="Buscar por nombre o descripción…"
          value={search}
          onChange={handleBuscar}
          disabled={!canReadGrupos}
        />
      </div>

      <table className="table table-bordered table-hover align-middle">
        <thead className="table-primary">
          <tr>
            <th style={{ width: 80 }}>ID</th>
            <th>Nombre</th>
            <th>Descripción</th>
            <th style={{ width: 160 }}>Color</th>
            <th style={{ width: 280 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.id}>
              <td>{g.id}</td>
              <td>{g.name}</td>
              <td>{g.description}</td>
              <td>
                <div className="d-flex align-items-center gap-2">
                  <span
                    title={g.bgcolor}
                    style={{
                      display: "inline-block",
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      border: "1px solid #e0e0e0",
                      background: g.bgcolor,
                    }}
                  />
                  <code style={{ background: "#f6f8fa", padding: "2px 6px", borderRadius: 6 }}>
                    {g.bgcolor}
                  </code>
                </div>
              </td>
              <td>
                <div className="btn-group btn-group-sm">
                  {canReadRolePerms && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => abrirPermisos(g)}
                      title="Asignar permisos"
                    >
                      <Shield size={16} className="me-1" />
                      Permisos
                    </button>
                  )}

                  {canUpdateGrupos && (
                    <button className="btn btn-warning" onClick={() => abrirModal("editar", g)}>
                      Editar
                    </button>
                  )}

                  {canDeleteGrupos && (
                    <button className="btn btn-danger" onClick={() => eliminar(g.id)}>
                      Eliminar
                    </button>
                  )}

                  <button className="btn btn-info text-white" onClick={() => abrirModal("ver", g)}>
                    Ver
                  </button>
                </div>
              </td>
            </tr>
          ))}

          {grupos.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center text-muted py-4">
                No hay roles para mostrar.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="d-flex justify-content-between align-items-center mt-3">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="pc-pager-btns">
          <button
            className="pc-btn pc-btn-outline"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ◀ Anterior
          </button>
          <button
            className="pc-btn pc-btn-outline"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente ▶
          </button>
        </div>
      </div>

      {/* Modal ABM rol */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modo === "crear" ? "Nuevo Rol" : modo === "editar" ? "Editar Rol" : "Ver Rol"}
      >
        <div className="row g-3">
          <div className="col-md-7">
            <label className="form-label">Nombre del Rol</label>
            <input
              type="text"
              name="name"
              className="form-control"
              value={formData.name}
              onChange={handleChange}
              disabled={modo === "ver"}
            />
          </div>

          <div className="col-md-5">
            <label className="form-label">Color</label>
            <div className="d-flex gap-2">
              <input
                type="color"
                name="bgcolor"
                className="form-control form-control-color"
                value={formData.bgcolor}
                title="Elegir color"
                onChange={handleChange}
                disabled={modo === "ver"}
                style={{ width: 56, padding: 2 }}
              />
              <input
                type="text"
                name="bgcolor"
                className="form-control"
                value={formData.bgcolor}
                onChange={handleChange}
                disabled={modo === "ver"}
                placeholder="#607D8B"
              />
            </div>
          </div>

          <div className="col-12">
            <label className="form-label">Descripción</label>
            <textarea
              name="description"
              rows={3}
              className="form-control"
              value={formData.description}
              onChange={handleChange}
              disabled={modo === "ver"}
              placeholder="Breve descripción del rol/alcance…"
            />
          </div>

          {modo !== "ver" && (canCreateGrupos || canUpdateGrupos) && (
            <div className="col-12 text-end">
              <button className="btn btn-primary" onClick={guardar}>
                Guardar
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal permisos */}
      <Modal
        open={permsOpen}
        onClose={() => setPermsOpen(false)}
        title={
          rolePermsRole
            ? `Permisos del rol: ${rolePermsRole.name} (#${rolePermsRole.id})`
            : "Permisos"
        }
      >
        {permsLoading ? (
          <div className="alert alert-info py-2">Cargando permisos…</div>
        ) : (
          <>
            <div className="mb-3">
              <input
                className="form-control"
                placeholder="Buscar permiso por code o descripción…"
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
              />
            </div>

            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <button
                type="button"
                className={`btn btn-sm ${
                  allVisibleChecked
                    ? "btn-success"
                    : someVisibleChecked
                    ? "btn-warning"
                    : "btn-outline-success"
                }`}
                onClick={toggleTodosVisibles}
                title="Marca o desmarca solo los permisos visibles según el filtro actual"
                disabled={!canUpdateRolePerms}
              >
                {allVisibleChecked ? (
                  <>
                    <Square size={16} className="me-1" />
                    Desmarcar visibles
                  </>
                ) : (
                  <>
                    <CheckSquare size={16} className="me-1" />
                    Marcar visibles
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => marcarVisibles("all")}
                title="Marca los visibles con scope all"
                disabled={!canUpdateRolePerms}
              >
                <Layers size={16} className="me-1" />
                Marcar visibles = all
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => cambiarScopeVisibles("own")}
                title="Cambia a scope own solo los visibles ya marcados"
                disabled={!canUpdateRolePerms}
              >
                Scope visibles: own
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => cambiarScopeVisibles("project")}
                title="Cambia a scope project solo los visibles ya marcados"
                disabled={!canUpdateRolePerms}
              >
                Scope visibles: project
              </button>

              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => cambiarScopeVisibles("all")}
                title="Cambia a scope all solo los visibles ya marcados"
                disabled={!canUpdateRolePerms}
              >
                Scope visibles: all
              </button>

              <div className="ms-auto small text-muted">
                Visibles: <strong>{filteredPerms.length}</strong> | Marcados visibles:{" "}
                <strong>{visibleCheckedCount}</strong>
              </div>
            </div>

            <div className="table-responsive" style={{ maxHeight: 520, overflow: "auto" }}>
              <table className="table table-sm table-bordered align-middle">
                <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 70 }}>Activo</th>
                    <th>Permiso</th>
                    <th>Descripción</th>
                    <th style={{ width: 140 }}>Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPerms.map((p) => {
                    const enabled = !!rolePermsMap[String(p.id)];
                    const scope = rolePermsMap[String(p.id)] || "all";

                    return (
                      <tr key={p.id}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => togglePerm(p.id)}
                            disabled={!canUpdateRolePerms}
                          />
                        </td>
                        <td>
                          <code>{p.code}</code>
                        </td>
                        <td className="text-muted">{p.description || "-"}</td>
                        <td>
                          <select
                            className="form-select form-select-sm"
                            value={scope}
                            disabled={!enabled || !canUpdateRolePerms}
                            onChange={(e) => changeScope(p.id, e.target.value)}
                          >
                            {SCOPES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredPerms.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-3">
                        Sin permisos
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="d-flex justify-content-end gap-2 mt-3">
              <button className="btn btn-outline-secondary" onClick={() => setPermsOpen(false)}>
                Cerrar
              </button>
              <button
                className="btn btn-primary"
                onClick={guardarPermisos}
                disabled={permsSaving || !canUpdateRolePerms}
              >
                <Save size={16} className="me-1" />
                {permsSaving ? "Guardando…" : "Guardar permisos"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}