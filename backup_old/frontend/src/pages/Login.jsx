// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import logoNombre from "../img/Ema_Group_Nombre-removebg-preview.png";

function resolveApiBase() {
  const raw = (import.meta.env?.VITE_API_URL || "").trim();
  const base0 = raw !== "" ? raw : window.location.origin;
  let base = base0.replace(/\/+$/, "");
  if (!/\/api$/i.test(base)) base += "/api";
  return base;
}
const API_BASE = resolveApiBase();
const api = (p) => `${API_BASE}${p}`;
const authHeader = (t) => ({ Authorization: `Bearer ${t}` });

function canFromUser(user, perm) {
  const perms = user?.perms || [];
  return perms.includes(perm);
}

// ✅ CLIENTES reales (según tu screenshot): 7,9,10,11,12
function isCliente(user) {
  const t = Number(user?.tipo_usuario);
  return t === 7 || t === 9 || t === 10 || t === 11 || t === 12;
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const fetchPrimerProyectoPorProponente = async (token, idCliente) => {
    try {
      if (!idCliente) return null;
      const r = await fetch(api(`/proyectos/primero-por-proponente/${idCliente}`), {
        headers: { "Content-Type": "application/json", ...authHeader(token) },
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.gid ?? null; // 👈 este "gid" en tu caso es el id_proyecto
    } catch {
      return null;
    }
  };

  function pickLanding(user) {
    // ✅ CLIENTE: directo a visor-full/:id_proyecto
    if (isCliente(user)) return { mode: "clienteVisorFull" };

    // ✅ lógica normal (no cliente)
    if (canFromUser(user, "visor.tramos.read")) return { path: "/visor-tramo", mode: "visorTramo" };
    if (canFromUser(user, "proyectos.read")) return { path: "/proyectos", mode: "proyectos" };
    return { path: "/", mode: "home" };
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(api("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {}

      if (!res.ok) {
        setError(data?.error || "Error al iniciar sesión");
        return;
      }

      const { token, user } = data || {};
      if (!token || !user) {
        setError("Respuesta inválida del servidor");
        return;
      }

      // ✅ 1) Guardar sesión
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));

      // ✅ 2) Avisar al AuthProvider / Sidebar que cambió la sesión (sin F5)
      window.dispatchEvent(new Event("auth:changed"));

      // ✅ 3) callback
      onLogin?.(token, user);

      window.dispatchEvent(new Event("auth:changed"));

      const landing = pickLanding(user);

      // ✅ CLIENTE → /visor-full/:id_proyecto
      if (landing.mode === "clienteVisorFull") {
        const idProyecto = await fetchPrimerProyectoPorProponente(token, user?.id_cliente);

        if (idProyecto) {
          const path = `/visor-full/${idProyecto}`;
          navigate(path, { replace: true });

          // fallback por si el SPA no cambia
          setTimeout(() => {
            if (!location.pathname.includes(path)) window.location.replace(path);
          }, 60);
        } else {
          setError("No se encontró un proyecto asociado a su cuenta.");
        }
        return;
      }

      // ✅ visor tramo (no-cliente) que requiere gid automático (si lo seguís usando)
      if (landing.mode === "visorTramo") {
        const gid = await fetchPrimerProyectoPorProponente(token, user?.id_cliente);
        if (gid) {
          navigate(`/visor-tramo/${gid}`, { replace: true });
          setTimeout(() => {
            if (!location.pathname.includes(`/visor-tramo/${gid}`)) {
              window.location.replace(`/visor-tramo/${gid}`);
            }
          }, 60);
        } else {
          setError("No se encontró un tramo/proyecto asociado a su cuenta.");
        }
        return;
      }

      navigate(landing.path, { replace: true });
    } catch (err) {
      console.error(err);
      setError("Error de conexión con el servidor");
    }
  };

  return (
    <div className="login-container">
      <form onSubmit={handleSubmit} className="login-box">
        <img src={logoNombre} alt="EMA Group" className="login-logo" />
        <input
          type="text"
          placeholder="Usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button type="submit">Ingresar</button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}