// src/auth/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { buildAuthz } from "./authz";

const AuthContext = createContext(null);

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function getToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt")
  );
}

function getUserFromStorage() {
  try {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  // ✅ arranca con lo que haya en localStorage (sin esperar /me)
  const [user, setUser] = useState(() => getUserFromStorage());
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = getToken();

    if (!token) {
      try { localStorage.removeItem("user"); } catch {}
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_URL}/usuarios/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        try { localStorage.removeItem("user"); } catch {}
        setUser(null);
        return;
      }

      const data = await res.json();
      const u = data?.user || data;

      const normalized = {
        ...u,
        perms: Array.isArray(u?.perms) ? u.perms : [],
        permsScope: u?.permsScope && typeof u.permsScope === "object" ? u.permsScope : {},
      };

      try {
        localStorage.setItem("user", JSON.stringify(normalized));
      } catch {}

      // ✅ importante: setear objeto NUEVO (ya lo hacés con normalized)
      setUser(normalized);
    } catch (e) {
      console.error("AuthProvider loadMe error:", e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    const onAuthChanged = () => loadMe();
    window.addEventListener("auth:changed", onAuthChanged);
    window.addEventListener("storage", onAuthChanged);
    return () => {
      window.removeEventListener("auth:changed", onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, [loadMe]);

  const authz = useMemo(() => buildAuthz(user), [user]);

  const value = useMemo(
    () => ({
      user,
      loading,
      reloadMe: loadMe,
      ...authz,
    }),
    [user, loading, loadMe, authz]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}