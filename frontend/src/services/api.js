// src/services/api.js
const API_URL = import.meta.env.VITE_API_URL;

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  options.headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_URL}${path}`, options);

  if (res.status === 403 || res.status === 401) {
    // sesión inválida o caducada
    localStorage.removeItem('token');
    window.location.href = '/login';  // fuerza volver al login
    throw new Error('Sesión caducada');
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  return res.json();
}
