// src/auth/Can.jsx
import React from "react";
import { useAuth } from "./AuthContext";

export default function Can({ perm, ctx, fallback = null, children }) {
  const { loading, can, canOn } = useAuth();

  if (loading) return null;

  const ok = ctx ? canOn(perm, ctx) : can(perm);
  return ok ? children : fallback;
}
