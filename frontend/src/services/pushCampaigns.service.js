const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

function authHeaders() {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  const txt = await res.text().catch(() => "");
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const PushCampaignsAPI = {
  list: () => apiFetch("/push-campaigns"),
  get: (id) => apiFetch(`/push-campaigns/${id}`),
  create: (payload) =>
    apiFetch("/push-campaigns", { method: "POST", body: JSON.stringify(payload) }),
  update: (id, payload) =>
    apiFetch(`/push-campaigns/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  remove: (id) =>
    apiFetch(`/push-campaigns/${id}`, { method: "DELETE" }),
  setTargets: (id, payload) =>
    apiFetch(`/push-campaigns/${id}/targets`, { method: "POST", body: JSON.stringify(payload) }),
  send: (id) =>
    apiFetch(`/push-campaigns/${id}/send`, { method: "POST" }),
};
