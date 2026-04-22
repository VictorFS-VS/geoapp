import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Modal from "@/components/Modal";
import { Plus } from "lucide-react";
import { FaUserCircle } from "react-icons/fa";
import Swal from "sweetalert2";
import { alerts } from "@/utils/alerts";
import { useAuth } from "@/auth/AuthContext";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

/* ===== helpers auth / fetch ===== */
const getBearer = () => {
  const t = localStorage.getItem("token") || localStorage.getItem("access_token") || localStorage.getItem("jwt");
  return t?.startsWith("Bearer ") ? t : t ? `Bearer ${t}` : null;
};
const authHeaders = () => {
  const b = getBearer();
  return b ? { Authorization: b } : {};
};

async function parseJson(res) {
  const txt = await res.text().catch(() => "");
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = null;
  }
  const msg = (data && (data.error || data.message)) || txt || `HTTP ${res.status}`;
  return { ok: res.ok, data, msg };
}

/* ======= Toast helper (página / modal) ======= */
const fireToast = ({ icon = "info", title = "", inModal = false, target = document.body, width } = {}) => {
  const map = { success: "success", error: "error", warning: "warning", info: "info" };
  const fn = alerts?.toast?.[map[icon] || "info"];
  if (typeof fn === "function") {
    fn(title);
    return;
  }
  Swal.fire({
    toast: true,
    icon,
    title,
    position: inModal ? "top" : "top-end",
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
    width: width || (inModal ? 520 : 420),
    target,
    didOpen: (popup) => {
      popup.style.wordBreak = "break-word";
      popup.style.overflowWrap = "anywhere";
      popup.style.whiteSpace = "normal";
    },
  });
};

export default function Usuarios() {
  const { user: usuarioActual, loading: authLoading, reloadMe } = useAuth();

  const [usuarios, setUsuarios] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState("crear"); // 'crear' | 'editar' | 'ver'
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");

  const [proponentes, setProponentes] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [roles, setRoles] = useState([]); // RBAC roles

  // RBAC: multi-roles
  const [userRoleIds, setUserRoleIds] = useState([]);
  const [primaryRoleId, setPrimaryRoleId] = useState("");

  // Cartera
  const [miembroToAdd, setMiembroToAdd] = useState("");

  // Toggle “cambiar contraseña”
  const [pwdMode, setPwdMode] = useState(false);
  const [pwdNonce, setPwdNonce] = useState("");

  // Estados
  const [mensaje, setMensaje] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [formData, setFormData] = useState({
    id: "",
    ip_address: "",
    username: "",
    password: "",
    confirmarPassword: "",
    salt: "",
    email: "",
    activation_code: "",
    forgotten_password_code: "",
    forgotten_password_time: "",
    remember_code: "",
    active: "",
    first_name: "",
    last_name: "",
    company: "",
    phone: "",
    tipo_usuario: "",
    id_cliente: "",
    id_consultor: "",
    miembros_cliente: [],
  });

  const [originalLock, setOriginalLock] = useState({
    tipo_usuario: "",
    id_cliente: "",
    id_consultor: "",
    miembros_cliente: [],
  });

  /* ===== Avatar ===== */
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarActual, setAvatarActual] = useState(null);
  const [avatarCargando, setAvatarCargando] = useState(false);

  /* ===== Ref toasts en modal ===== */
  const modalToastRef = useRef(null);
  const fireModal = (icon, title) =>
    fireToast({ icon, title, inModal: true, target: modalToastRef.current || document.body });

  /* =========================================================
     RBAC helpers
     ========================================================= */
  const perms = Array.isArray(usuarioActual?.perms) ? usuarioActual.perms : [];
  const permsScope = usuarioActual?.permsScope && typeof usuarioActual.permsScope === "object" ? usuarioActual.permsScope : {};

  const hasPerm = useCallback(
    (code) => {
      if (!code) return false;
      if (perms.includes(code)) return true;
      const [prefix] = String(code).split(".");
      if (perms.includes(`${prefix}.*`)) return true;
      if (perms.includes("*")) return true;
      return false;
    },
    [perms]
  );

  const scopeOf = useCallback(
    (code) => {
      const s = permsScope?.[code];
      if (!s && hasPerm(code)) return "all";
      return s || "none";
    },
    [permsScope, hasPerm]
  );

  const allows = useCallback(
    (code, needed) => {
      if (!hasPerm(code)) return false;
      const s = scopeOf(code);
      if (s === "all") return true;
      if (needed === "all") return s === "all";
      if (needed === "project") return s === "project" || s === "all";
      if (needed === "own") return s === "own" || s === "project" || s === "all";
      return false;
    },
    [hasPerm, scopeOf]
  );

  const canUsersReadAll = allows("usuarios.read", "all");
  const canUsersReadOwn = allows("usuarios.read", "own") || canUsersReadAll;

  const canUsersCreate = hasPerm("usuarios.create");
  const canUsersUpdateAll = allows("usuarios.update", "all");
  const canUsersUpdateOwn = allows("usuarios.update", "own") || canUsersUpdateAll;

  const canUsersDelete = hasPerm("usuarios.delete");

  const canABM = canUsersCreate || canUsersUpdateAll || canUsersUpdateOwn || canUsersDelete;

  const canAssignRoles =
    hasPerm("rbac.user_roles.update") || hasPerm("rbac.user_roles.read");

  const canCarteraReadAll =
    allows("cartera.read", "all") ||
    allows("cartera.consultor.read", "all") ||
    allows("cartera.admin.read", "all");

  const canCarteraReadOwn =
    allows("cartera.read", "own") ||
    allows("cartera.consultor.read", "own") ||
    allows("cartera.admin.read", "own") ||
    canCarteraReadAll;

  const canCarteraWriteAll =
    allows("cartera.write", "all") ||
    allows("cartera.consultor.write", "all") ||
    allows("cartera.admin.write", "all");

  const canCarteraWriteOwn =
    allows("cartera.write", "own") ||
    allows("cartera.consultor.write", "own") ||
    allows("cartera.admin.write", "own") ||
    canCarteraWriteAll;

  const myId = usuarioActual?.id ? String(usuarioActual.id) : null;

  const isClientReadOnly = !canABM;
  const onlySelf = !canUsersReadAll;

  /* ============ listar usuarios ============ */
  useEffect(() => {
    if (!authLoading && usuarioActual?.id) cargarUsuarios(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, usuarioActual?.id, page, search]);

  const cargarUsuarios = async (pagina = 1, filtro = "") => {
    try {
      setListLoading(true);
      setMensaje(null);

      if (onlySelf) {
        if (!canUsersReadOwn) {
          setUsuarios([]);
          setPage(1);
          setTotalPages(1);
          return;
        }
        const res = await fetch(`${API_URL}/usuarios/me`, { headers: authHeaders() });
        const { ok, data, msg } = await parseJson(res);
        if (!ok) throw new Error(msg);
        const u = data?.user || data;
        setUsuarios(u ? [u] : []);
        setPage(1);
        setTotalPages(1);
        return;
      }

      const url = `${API_URL}/usuarios?page=${pagina}&limit=10&search=${encodeURIComponent(filtro)}`;
      const res = await fetch(url, { headers: authHeaders() });
      const { ok, data, msg } = await parseJson(res);
      if (!ok) throw new Error(msg);
      setUsuarios(data?.data || []);
      setPage(data?.page || 1);
      setTotalPages(data?.totalPages || 1);
    } catch (e) {
      setUsuarios([]);
      setMensaje({ type: "danger", text: e.message || "No se pudieron cargar los usuarios." });
      alerts?.toast?.error?.(e.message || "No se pudieron cargar los usuarios.");
    } finally {
      setListLoading(false);
    }
  };

  /* ============ combos ============ */
  useEffect(() => {
    (async () => {
      try {
        if (!usuarioActual?.id) return;

        const rRoles = await fetch(`${API_URL}/rbac/roles?page=1&limit=500`, { headers: authHeaders() });
        const jRoles = await rRoles.json().catch(() => ({}));
        const rolesArr = Array.isArray(jRoles?.data) ? jRoles.data : (jRoles?.data?.data || []);
        setRoles(Array.isArray(rolesArr) ? rolesArr : []);

        const needCombos = canABM || canCarteraWriteOwn || canCarteraReadOwn;
        if (!needCombos) return;

        const [p1, p3] = await Promise.all([
          fetch(`${API_URL}/proponentes?page=1&limit=2000`, { headers: authHeaders() }),
          fetch(`${API_URL}/consultores?page=1&limit=2000`, { headers: authHeaders() }),
        ]);

        const d1 = await p1.json().catch(() => ({}));
        setProponentes(d1.data || []);
        const d3 = await p3.json().catch(() => ({}));
        setConsultores(d3.data || []);
      } catch (e) {
        console.error(e);
        setMensaje({ type: "warning", text: "No se pudieron cargar todas las listas auxiliares." });
        alerts?.toast?.warning?.("No se pudieron cargar todas las listas auxiliares.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioActual?.id, canABM, canCarteraWriteOwn, canCarteraReadOwn]);

  const roleNameById = (id) => {
    const rid = String(id ?? "");
    return roles.find((r) => String(r.id) === rid)?.name || "-";
  };

  const fetchUserRoles = async (userId) => {
    try {
      const res = await fetch(`${API_URL}/rbac/users/${userId}/roles`, { headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      const arr = Array.isArray(j?.data) ? j.data : [];
      const ids = arr.map((x) => String(x.role_id)).filter(Boolean);

      setUserRoleIds(ids);

      const legacy = String(formData.tipo_usuario || "");
      const primary = legacy && ids.includes(legacy) ? legacy : (ids[0] || "");
      setPrimaryRoleId(primary);

      return ids;
    } catch (e) {
      console.warn("fetchUserRoles:", e);
      setUserRoleIds([]);
      setPrimaryRoleId("");
      return [];
    }
  };

  const abrirModal = async (modoNuevo, usuario = null) => {
    const base = {
      id: "",
      ip_address: "",
      username: "",
      password: "",
      confirmarPassword: "",
      salt: "",
      email: "",
      activation_code: "",
      forgotten_password_code: "",
      forgotten_password_time: "",
      remember_code: "",
      active: "",
      first_name: "",
      last_name: "",
      company: "",
      phone: "",
      tipo_usuario: "",
      id_cliente: "",
      id_consultor: "",
      miembros_cliente: [],
    };

    setModo(modoNuevo);
    setMiembroToAdd("");
    setPwdNonce(String(Date.now()) + Math.random().toString(36).slice(2));
    setPwdMode(modoNuevo === "crear");
    setMensaje(null);

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    setAvatarFile(null);
    if (avatarActual) URL.revokeObjectURL(avatarActual);
    setAvatarActual(null);

    setUserRoleIds([]);
    setPrimaryRoleId("");

    if (usuario) {
      const armado = {
        ...base,
        ...Object.fromEntries(Object.entries(usuario).map(([k, v]) => [k, v ?? ""])),
        tipo_usuario: usuario.tipo_usuario?.toString() || "",
        id_cliente: usuario.id_cliente?.toString() || "",
        id_consultor: usuario.id_consultor?.toString() || "",
        password: "",
        confirmarPassword: "",
      };
      setFormData(armado);

      setOriginalLock({
        tipo_usuario: armado.tipo_usuario,
        id_cliente: armado.id_cliente,
        id_consultor: armado.id_consultor,
        miembros_cliente: [],
      });

      if (canAssignRoles && armado.id) {
        setTimeout(() => {
          fetchUserRoles(armado.id);
        }, 0);
      }

      const isSelf = myId && String(armado.id) === myId;
      const allowReadCartera =
        canCarteraReadAll || (isSelf && (canCarteraReadOwn || Boolean(armado.id_cliente || armado.id_consultor)));

      if (allowReadCartera && armado.id) {
        try {
          const res = await fetch(`${API_URL}/usuarios/${armado.id}/cartera`, { headers: authHeaders() });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            const cartera = (data?.data || []).map(String);
            setFormData((prev) => ({ ...prev, miembros_cliente: cartera }));
            setOriginalLock((prev) => ({ ...prev, miembros_cliente: cartera }));
          }
        } catch {}
      }

      if (armado.id) {
        try {
          const r = await fetch(`${API_URL}/usuarios/${armado.id}/avatar?bust=${Date.now()}`);
          if (r.ok) {
            const blob = await r.blob();
            setAvatarActual(URL.createObjectURL(blob));
          }
        } catch {}
      }
    } else {
      setFormData(base);
      setOriginalLock({ tipo_usuario: "", id_cliente: "", id_consultor: "", miembros_cliente: [] });

      if (canAssignRoles) {
        setUserRoleIds([]);
        setPrimaryRoleId("");
      }
    }

    setModalOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      if (modo === "ver") return prev;

      const perfilFields = new Set(["email", "first_name", "last_name", "phone", "company", "password", "confirmarPassword", "username"]);
      const isPerfil = perfilFields.has(name);
      const isAssign = ["tipo_usuario", "id_cliente", "id_consultor"].includes(name);

      const isSelf = myId && String(prev.id) === myId;

      if (!canABM) {
        if (!isSelf || !canUsersUpdateOwn) return prev;
        if (!isPerfil) return prev;
      }

      if (canABM && !canUsersUpdateAll) {
        if (!isSelf) return prev;
      }

      if (isAssign && !canUsersUpdateAll) return prev;

      if (name === "id_cliente") {
        return { ...prev, id_cliente: value, miembros_cliente: prev.miembros_cliente.filter((id) => id !== value) };
      }

      return { ...prev, [name]: value };
    });
  };

  /* ============ RBAC handlers ============ */
  const toggleRole = (rid) => {
    const id = String(rid);
    if (!canAssignRoles || modo === "ver") return;

    setUserRoleIds((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];

      let nextPrimary = String(primaryRoleId || "");

      if (next.length === 0) {
        nextPrimary = "";
      } else if (!nextPrimary || !next.includes(nextPrimary)) {
        nextPrimary = next[0];
      }

      setPrimaryRoleId(nextPrimary);
      setFormData((fd) => ({
        ...fd,
        tipo_usuario: nextPrimary || "",
      }));

      return next;
    });
  };

  const changePrimaryRole = (rid) => {
    if (!canAssignRoles || modo === "ver") return;
    const id = String(rid || "");
    setPrimaryRoleId(id);
    setFormData((fd) => ({ ...fd, tipo_usuario: id }));
  };

  /* ============ Avatar: handlers ============ */
  const handleAvatarChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(f.type)) {
      return fireModal("warning", "Formato no permitido. Use PNG, JPG, WEBP, GIF o AVIF.");
    }
    if (f.size > 5 * 1024 * 1024) {
      return fireModal("warning", "La imagen no debe superar 5MB.");
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const subirAvatar = async () => {
    if (!formData.id) return fireModal("info", "Primero guardá el usuario para obtener su ID.");
    if (!avatarFile) return fireModal("warning", "Elegí una imagen antes de subir.");
    setAvatarCargando(true);
    try {
      const fd = new FormData();
      const ext = (avatarFile.type?.split("/")[1] || "png").replace("jpeg", "jpg");
      const safeName = avatarFile.name && avatarFile.name.includes(".") ? avatarFile.name : `avatar.${ext}`;
      fd.append("avatar", avatarFile, safeName);

      const r = await fetch(`${API_URL}/usuarios/${formData.id}/avatar`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });

      const { ok, msg } = await parseJson(r);
      if (!ok) throw new Error(msg);

      fireToast({ icon: "success", title: "Avatar actualizado." });

      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setAvatarFile(null);

      const r2 = await fetch(`${API_URL}/usuarios/${formData.id}/avatar?bust=${Date.now()}`);
      if (r2.ok) {
        const blob = await r2.blob();
        if (avatarActual) URL.revokeObjectURL(avatarActual);
        setAvatarActual(URL.createObjectURL(blob));
      }

      if (myId && String(formData.id) === myId) {
        await reloadMe?.();
      }
    } catch (e) {
      fireModal("error", e.message || "No se pudo subir el avatar.");
    } finally {
      setAvatarCargando(false);
    }
  };

  const eliminarAvatar = async () => {
    if (!formData.id) return;
    setAvatarCargando(true);
    try {
      const r = await fetch(`${API_URL}/usuarios/${formData.id}/avatar`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const { ok, msg } = await parseJson(r);
      if (!ok) throw new Error(msg);

      fireToast({ icon: "success", title: "Avatar eliminado." });

      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setAvatarFile(null);

      const r2 = await fetch(`${API_URL}/usuarios/${formData.id}/avatar?bust=${Date.now()}`);
      if (r2.ok) {
        const blob = await r2.blob();
        if (avatarActual) URL.revokeObjectURL(avatarActual);
        setAvatarActual(URL.createObjectURL(blob));
      } else {
        if (avatarActual) URL.revokeObjectURL(avatarActual);
        setAvatarActual(null);
      }

      if (myId && String(formData.id) === myId) {
        await reloadMe?.();
      }
    } catch (e) {
      fireModal("error", e.message || "No se pudo eliminar el avatar.");
    } finally {
      setAvatarCargando(false);
    }
  };

  /* ============ helpers de cartera ============ */
  const labelCliente = (idStr) => {
    const c = proponentes.find((p) => p.id_cliente?.toString() === idStr?.toString());
    if (!c) return idStr;
    const nombre = [c.nombre, c.apellido].filter(Boolean).join(" ");
    return `${nombre || "(sin nombre)"} / RUC: ${c.cedularuc ?? "-"}`;
  };

  const proponentesDisponiblesParaAgregar = () => {
    const excluir = new Set([formData.id_cliente, ...(formData.miembros_cliente || [])].filter(Boolean).map(String));
    return proponentes.filter((p) => !excluir.has(String(p.id_cliente)));
  };

  const agregarMiembro = () => {
    if (!miembroToAdd) return;
    const id = miembroToAdd.toString();
    if (formData.miembros_cliente.includes(id)) return;
    setFormData((prev) => ({ ...prev, miembros_cliente: [...prev.miembros_cliente, id] }));
    setMiembroToAdd("");
  };

  const quitarMiembro = (id) => {
    setFormData((prev) => ({
      ...prev,
      miembros_cliente: prev.miembros_cliente.filter((m) => m !== id.toString()),
    }));
  };

  /* ============ guardar / eliminar ============ */
  const guardar = async () => {
    if (modo === "ver") return;

    const isSelf = myId && String(formData.id) === myId;

    if (!canABM) {
      if (!isSelf || !canUsersUpdateOwn) return fireModal("warning", "No tiene permisos para editar usuarios.");
    } else {
      if (!isSelf && modo !== "crear" && !canUsersUpdateAll) {
        return fireModal("warning", "No tiene permisos para editar otros usuarios.");
      }
      if (modo === "crear" && !canUsersCreate) {
        return fireModal("warning", "No tiene permisos para crear usuarios.");
      }
    }

    if (!formData.username || !formData.email) {
      return fireModal("warning", "Complete los campos obligatorios (usuario y email).");
    }

    if (modo === "crear" || (modo === "editar" && pwdMode)) {
      if (!formData.password || !formData.confirmarPassword) {
        return fireModal("warning", "Debe ingresar y confirmar la contraseña.");
      }
      if (formData.password.length < 6) return fireModal("warning", "La contraseña debe tener al menos 6 caracteres.");
      if (formData.password !== formData.confirmarPassword) return fireModal("warning", "Las contraseñas no coinciden.");
    }

    const selectedPrimaryRole =
      String(primaryRoleId || "") ||
      String(userRoleIds?.[0] || "") ||
      String(formData.tipo_usuario || "");

    if (modo === "crear" && !selectedPrimaryRole) {
      return fireModal("warning", "Debe seleccionar al menos un rol.");
    }

    const initialRoleId = selectedPrimaryRole ? parseInt(selectedPrimaryRole, 10) : undefined;

    const payload = {
      ...formData,
      group_id: Number.isFinite(initialRoleId) ? initialRoleId : undefined,
      tipo_usuario: Number.isFinite(initialRoleId)
        ? initialRoleId
        : (formData.tipo_usuario ? parseInt(formData.tipo_usuario, 10) : undefined),
      id_cliente: formData.id_cliente ? parseInt(formData.id_cliente, 10) : null,
      id_consultor: formData.id_consultor ? parseInt(formData.id_consultor, 10) : null,
      miembros_cliente: (formData.miembros_cliente || [])
        .map((x) => parseInt(x, 10))
        .filter(Number.isFinite),
    };

    delete payload.confirmarPassword;

    if (modo === "editar") {
      if (!pwdMode) {
        delete payload.password;
      } else {
        payload.cambiarPassword = true;
      }

      delete payload.group_id;
    }

    if (!canUsersUpdateAll) {
      payload.tipo_usuario = originalLock.tipo_usuario ? parseInt(originalLock.tipo_usuario, 10) : payload.tipo_usuario;
      payload.id_cliente = originalLock.id_cliente ? parseInt(originalLock.id_cliente, 10) : payload.id_cliente;
      payload.id_consultor = originalLock.id_consultor ? parseInt(originalLock.id_consultor, 10) : payload.id_consultor;

      const allowCarteraSelf =
        isSelf &&
        (canCarteraWriteOwn || Boolean(originalLock.id_cliente || originalLock.id_consultor || formData.id_cliente || formData.id_consultor));

      if (!allowCarteraSelf) {
        payload.miembros_cliente = (originalLock.miembros_cliente || []).map((x) => parseInt(x, 10)).filter(Number.isFinite);
      }
    }

    const url = formData.id ? `${API_URL}/usuarios/${formData.id}` : `${API_URL}/usuarios`;
    const method = formData.id ? "PUT" : "POST";

    try {
      setSaving(true);

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const j1 = await parseJson(res);
      if (!j1.ok) {
        fireModal("error", j1.msg);
        throw new Error(j1.msg);
      }

      if (canAssignRoles) {
        let userId = formData.id;
        if (!userId) {
          userId = j1?.data?.id || j1?.data?.data?.id || j1?.data?.data?.user_id || j1?.data?.user_id || null;
        }

        const uid = parseInt(userId, 10);
        if (Number.isFinite(uid) && (userRoleIds.length > 0 || primaryRoleId)) {
          const rb = await fetch(`${API_URL}/rbac/users/${uid}/roles`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              role_ids: userRoleIds.map((x) => parseInt(x, 10)).filter(Number.isFinite),
              primary_role_id: primaryRoleId ? parseInt(primaryRoleId, 10) : null,
            }),
          });

          const j2 = await parseJson(rb);
          if (!j2.ok) {
            fireToast({ icon: "warning", title: "Usuario guardado, pero falló asignación de roles RBAC." });
            console.warn("RBAC set roles error:", j2.msg);
          }
        }
      }

      setModalOpen(false);
      fireToast({ icon: "success", title: "Usuario guardado correctamente." });

      await cargarUsuarios(1, search);

      if (isSelf) {
        await reloadMe?.();
      }
    } catch (e) {
      console.error("Error al guardar usuario:", e);
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async (id) => {
    if (!canUsersDelete) return;
    if (!window.confirm("¿Eliminar este usuario?")) return;

    try {
      setDeletingId(id);
      const res = await fetch(`${API_URL}/usuarios/${id}`, { method: "DELETE", headers: authHeaders() });
      const { ok, msg } = await parseJson(res);
      if (!ok) {
        fireToast({ icon: "error", title: msg });
        throw new Error(msg);
      }
      fireToast({ icon: "success", title: "Usuario eliminado correctamente" });
      cargarUsuarios(page, search);
    } catch (e) {
      console.error("Error al eliminar usuario:", e);
      fireToast({ icon: "error", title: e.message || "Error al eliminar usuario." });
    } finally {
      setDeletingId(null);
    }
  };

  const handleBuscar = (e) => {
    if (onlySelf) return;
    setSearch(e.target.value);
    setPage(1);
  };

  const passName = useMemo(() => `np_${pwdNonce}`, [pwdNonce]);
  const passConfName = useMemo(() => `npc_${pwdNonce}`, [pwdNonce]);

  const targetHasCarteraIdentity = Boolean(formData.id_cliente || formData.id_consultor || (formData.miembros_cliente || []).length);

  const canEditCartera = useMemo(() => {
    const isSelf = myId && String(formData.id) === myId;
    if (canCarteraWriteAll && canUsersUpdateAll) return true;
    if (isSelf && (canCarteraWriteOwn || targetHasCarteraIdentity)) return true;
    if (
      canUsersUpdateAll &&
      (
        canCarteraWriteAll ||
        hasPerm("cartera.write") ||
        hasPerm("cartera.consultor.write") ||
        hasPerm("cartera.admin.write")
      )
    ) return true;
    return false;
  }, [myId, formData.id, canCarteraWriteAll, canUsersUpdateAll, canCarteraWriteOwn, targetHasCarteraIdentity, hasPerm]);

  const canSeeCartera = useMemo(() => {
    const isSelf = myId && String(formData.id) === myId;
    if (canCarteraReadAll) return true;
    if (isSelf && (canCarteraReadOwn || targetHasCarteraIdentity)) return true;
    if (canUsersUpdateAll && (hasPerm("cartera.read") || hasPerm("cartera.*"))) return true;
    return false;
  }, [myId, formData.id, canCarteraReadAll, canCarteraReadOwn, targetHasCarteraIdentity, canUsersUpdateAll, hasPerm]);

  const canSeeAssignments = canUsersUpdateAll;
  const disableRoleFields = modo === "ver" || !canAssignRoles;

  if (authLoading) {
    return <div className="container py-3"><div className="alert alert-info py-2">Cargando sesión…</div></div>;
  }

  return (
    <div className="container py-3">
      {mensaje && (
        <div className={`alert alert-${mensaje.type} alert-dismissible fade show`} role="alert">
          {mensaje.text}
          <button type="button" className="btn-close" aria-label="Close" onClick={() => setMensaje(null)} />
        </div>
      )}

      <div className="pc-header">
        <div>
          <h2 className="pc-title">Usuarios</h2>
        </div>
        <div className="pc-actions">
          {(canUsersCreate && canABM) && (
            <button className="pc-btn pc-btn-blue" onClick={() => abrirModal("crear")}>
              <Plus className="ico" /> Crear Usuario
            </button>
          )}
        </div>
      </div>

      {!onlySelf && (
        <div className="mb-3">
          <input
            type="text"
            className="form-control"
            placeholder="Buscar por nombre, apellido o usuario..."
            value={search}
            onChange={handleBuscar}
          />
        </div>
      )}

      {listLoading && <div className="alert alert-info py-2">Cargando usuarios…</div>}

      <table className="table table-bordered table-hover">
        <thead className="table-primary">
          <tr>
            <th>Usuario</th>
            <th>Nombre</th>
            <th>Apellido</th>
            <th>Email</th>
            <th>Teléfono</th>
            <th>Rol principal</th>
            <th>Activo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => {
            const uid = String(u.id);
            const isSelfRow = myId && uid === myId;

            const canEditThis =
              (isSelfRow && canUsersUpdateOwn) ||
              (canUsersUpdateAll);

            return (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.first_name}</td>
                <td>{u.last_name}</td>
                <td>{u.email}</td>
                <td>{u.phone}</td>
                <td>{roleNameById(u.tipo_usuario)}</td>
                <td>
                  {u.active === 1 ? (
                    <span className="badge bg-success">Activo</span>
                  ) : (
                    <span className="badge bg-secondary">Desactivado</span>
                  )}
                </td>
                <td>
                  <div className="btn-group btn-group-sm">
                    {canUsersUpdateAll && (
                      <button
                        className={`btn btn-${u.active === 1 ? "outline-secondary" : "outline-success"}`}
                        title={u.active === 1 ? "Desactivar" : "Activar"}
                        onClick={async () => {
                          try {
                            const nuevo = u.active === 1 ? 0 : 1;
                            const res = await fetch(`${API_URL}/usuarios/${u.id}`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json", ...authHeaders() },
                              body: JSON.stringify({ active: nuevo }),
                            });
                            const { ok, msg } = await parseJson(res);
                            if (!ok) throw new Error(msg);
                            fireToast({ icon: "success", title: `Usuario ${nuevo ? "activado" : "desactivado"}.` });
                            cargarUsuarios(page, search);
                          } catch (e) {
                            fireToast({ icon: "error", title: e.message || "No se pudo actualizar el estado." });
                          }
                        }}
                      >
                        {u.active === 1 ? "Desactivar" : "Activar"}
                      </button>
                    )}

                    {canEditThis && (
                      <button className="btn btn-warning" onClick={() => abrirModal("editar", u)}>
                        Editar
                      </button>
                    )}

                    {canUsersDelete && !isSelfRow && (
                      <button className="btn btn-danger" onClick={() => eliminar(u.id)} disabled={deletingId === u.id}>
                        {deletingId === u.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    )}

                    <button className="btn btn-info text-white" onClick={() => abrirModal("ver", u)}>
                      Ver
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          {usuarios.length === 0 && !listLoading && (
            <tr>
              <td colSpan={8} className="text-center text-muted">
                Sin resultados
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!onlySelf && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="pc-pager-btns">
            <button className="btn btn-outline-primary" disabled={page === 1} onClick={() => setPage(page - 1)}>
              ◀ Anterior
            </button>
            <button className="btn btn-outline-primary" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
              Siguiente ▶
            </button>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modo === "crear" ? "Nuevo Usuario" : modo === "editar" ? "Editar Usuario" : "Ver Usuario"}
      >
        <div ref={modalToastRef} style={{ position: "relative", minHeight: 0 }} aria-hidden="true" />

        <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          <input
            type="text"
            name="fake-user"
            autoComplete="username"
            style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, width: 0 }}
          />
          <input
            type="password"
            name="fake-pass"
            autoComplete="current-password"
            style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, width: 0 }}
          />

          <div className="row g-3">
            {[
              ["username", "Usuario"],
              ["email", "Email"],
              ["first_name", "Nombre"],
              ["last_name", "Apellido"],
              ["phone", "Teléfono"],
            ].map(([name, label]) => (
              <div className="col-md-6" key={name}>
                <label className="form-label">{label}</label>
                <input
                  type="text"
                  className="form-control"
                  name={name}
                  value={formData[name]}
                  onChange={handleChange}
                  disabled={modo === "ver" || (!canABM && !(myId && String(formData.id) === myId))}
                  autoComplete="off"
                />
              </div>
            ))}

            {canAssignRoles && (
              <>
                <div className="col-12">
                  <label className="form-label">Roles (multi)</label>
                  <div className="d-flex flex-wrap gap-2">
                    {roles.map((r) => {
                      const checked = userRoleIds.includes(String(r.id));
                      return (
                        <label
                          key={r.id}
                          className={`badge ${checked ? "bg-primary" : "bg-light text-dark"}`}
                          style={{ cursor: modo === "ver" ? "default" : "pointer", padding: "10px 12px" }}
                        >
                          <input
                            type="checkbox"
                            className="form-check-input me-2"
                            checked={checked}
                            onChange={() => toggleRole(r.id)}
                            disabled={disableRoleFields}
                            style={{ verticalAlign: "middle" }}
                          />
                          {r.name}
                        </label>
                      );
                    })}
                  </div>
                  <small className="text-muted d-block mt-1">
                    Seleccioná uno o más roles. El rol principal se usa como compat (tipo_usuario) si tu backend lo necesita.
                  </small>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Rol principal (compat)</label>
                  <select
                    className="form-select"
                    value={primaryRoleId}
                    onChange={(e) => changePrimaryRole(e.target.value)}
                    disabled={disableRoleFields || userRoleIds.length === 0}
                  >
                    <option value="">Seleccione...</option>
                    {userRoleIds.map((rid) => (
                      <option key={rid} value={rid}>
                        {roleNameById(rid)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Rol principal (texto)</label>
                  <input className="form-control" value={roleNameById(primaryRoleId || formData.tipo_usuario)} disabled readOnly />
                </div>
              </>
            )}

            {canSeeAssignments && (
              <>
                <div className="col-md-6">
                  <label className="form-label">Cliente</label>
                  <select
                    className="form-select"
                    name="id_cliente"
                    value={formData.id_cliente}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  >
                    <option value="">Seleccione...</option>
                    {proponentes.map((c) => (
                      <option key={c.id_cliente} value={String(c.id_cliente)}>
                        {c.nombre} {c.apellido} / RUC: {c.cedularuc}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Consultor</label>
                  <select
                    className="form-select"
                    name="id_consultor"
                    value={formData.id_consultor}
                    onChange={handleChange}
                    disabled={modo === "ver"}
                  >
                    <option value="">Seleccione...</option>
                    {consultores.map((c) => (
                      <option key={c.id_consultor} value={String(c.id_consultor)}>
                        {c.nombre} {c.apellido} / RUC: {c.cedularuc}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="col-12">
              <label className="form-label d-block">Avatar</label>
              <div className="d-flex align-items-center gap-3">
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "#eee",
                    flexShrink: 0,
                  }}
                >
                  {avatarPreview || avatarActual ? (
                    <img
                      src={avatarPreview || avatarActual}
                      alt="avatar"
                      width={64}
                      height={64}
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <FaUserCircle size={64} />
                  )}
                </div>

                <div className="flex-grow-1">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="form-control mb-2"
                    onChange={handleAvatarChange}
                    disabled={modo === "ver"}
                  />

                  <div className="btn-group">
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={subirAvatar}
                      disabled={!avatarFile || !formData.id || avatarCargando || modo === "ver"}
                    >
                      {avatarCargando ? "Subiendo…" : "Subir/Actualizar"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={eliminarAvatar}
                      disabled={!formData.id || avatarCargando || modo === "ver"}
                    >
                      Quitar
                    </button>
                  </div>

                  <small className="text-muted d-block mt-1">
                    Formatos: JPG/PNG/WEBP/GIF/AVIF · Máx 5MB. {modo === "crear" && "(Primero guardá el usuario para subir avatar)"}
                  </small>
                </div>
              </div>
            </div>

            {canSeeCartera && (
              <>
                <div className="col-12">
                  <hr />
                  <h6 className="mb-2">Cartera</h6>
                  <small className="text-muted">
                    Cualquier cliente o consultor puede tener cartera. Editar depende de permisos (o self).
                  </small>
                </div>

                <div className="col-md-8">
                  <label className="form-label">Agregar cliente a cartera</label>
                  <select
                    className="form-select"
                    value={miembroToAdd}
                    onChange={(e) => setMiembroToAdd(e.target.value)}
                    disabled={!canEditCartera || modo === "ver"}
                  >
                    <option value="">Seleccione un cliente...</option>
                    {proponentesDisponiblesParaAgregar().map((c) => (
                      <option key={c.id_cliente} value={String(c.id_cliente)}>
                        {c.nombre} {c.apellido} / RUC: {c.cedularuc}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4 d-flex align-items-end">
                  <button
                    className="btn btn-outline-primary w-100"
                    type="button"
                    onClick={agregarMiembro}
                    disabled={!canEditCartera || !miembroToAdd || modo === "ver"}
                  >
                    ➕ Agregar a cartera
                  </button>
                </div>

                <div className="col-12">
                  <label className="form-label d-block">Cartera seleccionada</label>
                  {formData.miembros_cliente.length === 0 ? (
                    <div className="text-muted">Aún no hay clientes en la cartera.</div>
                  ) : (
                    <div className="d-flex flex-wrap gap-2">
                      {formData.miembros_cliente.map((id) => (
                        <span
                          key={id}
                          className="badge bg-secondary d-flex align-items-center"
                          style={{ fontSize: "0.95rem" }}
                        >
                          {labelCliente(id)}
                          {canEditCartera && modo !== "ver" && (
                            <button
                              type="button"
                              className="btn-close btn-close-white ms-2"
                              aria-label="Quitar"
                              onClick={() => quitarMiembro(id)}
                              style={{ filter: "invert(1)" }}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <small className="text-muted d-block mt-1">
                    Estos clientes se usan para filtrar proyectos por cartera.
                  </small>
                </div>
              </>
            )}

            {modo !== "ver" && (
              <>
                {!pwdMode && modo === "editar" && (
                  <div className="col-12">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => {
                        setPwdMode(true);
                        setFormData((p) => ({ ...p, password: "", confirmarPassword: "" }));
                        setPwdNonce(String(Date.now()) + Math.random().toString(36).slice(2));
                      }}
                    >
                      Cambiar contraseña
                    </button>
                    <small className="text-muted ms-2">(ingresá una nueva clave si querés actualizarla)</small>
                  </div>
                )}

                {pwdMode && (
                  <>
                    <div className="col-md-6">
                      <label className="form-label">Contraseña</label>
                      <input
                        type="password"
                        className="form-control"
                        name={passName}
                        value={formData.password}
                        onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                        autoComplete="new-password"
                        spellCheck={false}
                        autoCorrect="off"
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Confirmar Contraseña</label>
                      <input
                        type="password"
                        className="form-control"
                        name={passConfName}
                        value={formData.confirmarPassword}
                        onChange={(e) => setFormData((p) => ({ ...p, confirmarPassword: e.target.value }))}
                        autoComplete="new-password"
                        spellCheck={false}
                        autoCorrect="off"
                      />
                    </div>
                  </>
                )}

                <div className="col-12 text-end">
                  <button className="btn btn-primary" onClick={guardar} disabled={saving}>
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}