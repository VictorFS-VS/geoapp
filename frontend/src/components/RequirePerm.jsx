// src/components/RequirePerm.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

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
  return (codes || []).some((c) => hasPerm(auth, c));
}

/**
 * Uso:
 * <RequirePerm anyOf={["push_campaigns.read","push_campaigns.create"]}>
 *   <PushCampaigns />
 * </RequirePerm>
 */
export default function RequirePerm({ anyOf = [], allOf = [], children, redirectTo = "/" }) {
  const auth = useAuth();
  const location = useLocation();

  const okAny = anyOf?.length ? hasAnyPerm(auth, anyOf) : true;
  const okAll = allOf?.length ? allOf.every((p) => hasPerm(auth, p)) : true;

  if (!okAny || !okAll) {
    return <Navigate to={redirectTo} replace state={{ from: location.pathname }} />;
  }
  return children;
}