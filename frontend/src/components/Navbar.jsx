// src/components/Navbar.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaBars } from 'react-icons/fa';
import { Dropdown } from 'react-bootstrap';
import logo from '../img/Ema_Group_Logo.png';
import Notificaciones from './Notificaciones';

/** ✅ BASE (sin /api) y API_URL (con /api) como en el resto del proyecto */
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const API_URL = BASE.endsWith('/api') ? BASE : BASE + '/api';

/* ===== Helpers ===== */
const authHeaders = () => {
  const t =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('jwt');

  return t ? { Authorization: t.startsWith('Bearer ') ? t : `Bearer ${t}` } : {};
};

const jsonOrThrow = async (res) => {
  if (!res.ok) {
    let msg = await res.text();
    try { const j = JSON.parse(msg); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
};

// Placeholder liso sin letra
const DEFAULT_AVATAR = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="160" height="160" rx="80" fill="#adb5bd"/>
</svg>`)} `;

/* ===== Componente Avatar apto para LOGOS ===== */
function Avatar({ src, size = 28, onError, fit = 'contain', bg = '#fff' }) {
  const pad = size >= 64 ? 6 : size >= 48 ? 4 : 3;
  return (
    <span
      className="avatar-shell"
      style={{
        width: size,
        height: size,
        padding: pad,
        background: bg,
        borderRadius: '999px',
        display: 'inline-flex',
        boxShadow: '0 0 0 1px rgba(0,0,0,.12)'
      }}
    >
      <img
        src={src}
        alt="avatar"
        onError={onError}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          objectFit: fit,
          objectPosition: 'center',
          display: 'block'
        }}
      />
    </span>
  );
}

/* ===== Formatter robusto para fecha_creacion / created_on ===== */
const formatFecha = (v) => {
  if (!v && v !== 0) return '---';

  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
  if (Number.isFinite(n)) {
    const ms = n < 1e12 ? n * 1000 : n; // segundos → ms
    const d = new Date(ms);
    return isNaN(d) ? '---' : d.toLocaleDateString('es-ES');
  }
  const d = new Date(v);
  return isNaN(d) ? '---' : d.toLocaleDateString('es-ES');
};

export default function Navbar({ toggleSidebar }) {
  const navigate = useNavigate();

  const [usuario, setUsuario] = useState(null);
  const [imgOk, setImgOk] = useState(true);
  const [useController, setUseController] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef(null);

  /* ===== Cargar usuario (si falta fecha_creacion, refresca /me) ===== */
  useEffect(() => {
    const local = localStorage.getItem('user');
    const maybe = local ? JSON.parse(local) : null;
    const needRefresh = !maybe?.fecha_creacion;

    if (maybe && !needRefresh) {
      setUsuario(maybe);
    } else {
      fetch(`${API_URL}/usuarios/me`, { headers: authHeaders() })
        .then(jsonOrThrow)
        .then(u => { setUsuario(u); localStorage.setItem('user', JSON.stringify(u)); })
        .catch(() => setUsuario(null));
    }
  }, []);

  // Sync entre pestañas
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'user' && e.newValue) setUsuario(JSON.parse(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleLogout = () => {
    try { localStorage.removeItem('projListFilters'); } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('access_token');
      localStorage.removeItem('jwt');
      localStorage.removeItem('user');
      const url = new URL(window.location.href); url.search = '';
      window.history.replaceState({}, document.title, url.toString());
      window.location.replace('/login');
    }
  };

  /* ===== Avatar src (directo → controlador → placeholder) ===== */
  const version = usuario?.fecha_actualizacion
    ? new Date(usuario.fecha_actualizacion).getTime()
    : 0;

  /**
   * ✅ IMPORTANTE:
   * - /uploads es ESTÁTICO => se sirve desde BASE (sin /api)
   * - /usuarios/:id/avatar es endpoint => va por API_URL (con /api)
   */
  const directFile = usuario?.avatar
    ? `${BASE.replace(/\/+$/, '')}/uploads/avatars/${encodeURIComponent(usuario.avatar)}?v=${version}`
    : null;

  const controllerFile = usuario?.id
    ? `${API_URL}/usuarios/${usuario.id}/avatar?v=${version}&blank=1`
    : null;

  const candidateSrc = (!useController && directFile) ? directFile : (controllerFile || DEFAULT_AVATAR);
  const avatarSrc = imgOk ? candidateSrc : DEFAULT_AVATAR;

  /* ===== Handlers de avatar ===== */
  const onPickAvatar = () => fileRef.current?.click();

  const onFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(f.type)) {
      alert('Formato no permitido. Use PNG/JPG/WEBP/GIF/AVIF.');
      e.target.value = '';
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      alert('La imagen no debe superar 5MB.');
      e.target.value = '';
      return;
    }
    if (!usuario?.id) return;

    setSubiendo(true);
    try {
      const fd = new FormData();
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const safeName = f.name && f.name.includes('.') ? f.name : `avatar.${ext}`;
      fd.append('avatar', f, safeName);

      const r = await fetch(`${API_URL}/usuarios/${usuario.id}/avatar`, {
        method: 'POST', headers: authHeaders(), body: fd
      });
      await jsonOrThrow(r);

      const r2 = await fetch(`${API_URL}/usuarios/me`, { headers: authHeaders() });
      const me = await jsonOrThrow(r2);
      setUsuario(me);
      localStorage.setItem('user', JSON.stringify(me));

      setUseController(false);
      setImgOk(true);

      alert('Avatar actualizado.');
    } catch (err) {
      alert(err.message || 'No se pudo subir el avatar.');
    } finally {
      setSubiendo(false);
      e.target.value = '';
    }
  }, [usuario]);

  const onRemoveAvatar = useCallback(async () => {
    if (!usuario?.id) return;
    if (!confirm('¿Quitar avatar actual?')) return;
    try {
      const r = await fetch(`${API_URL}/usuarios/${usuario.id}/avatar`, {
        method: 'DELETE', headers: authHeaders()
      });
      await jsonOrThrow(r);

      const r2 = await fetch(`${API_URL}/usuarios/me`, { headers: authHeaders() });
      const me = await jsonOrThrow(r2);
      setUsuario(me);
      localStorage.setItem('user', JSON.stringify(me));

      setUseController(false);
      setImgOk(false);

      alert('Avatar eliminado.');
    } catch (e) {
      alert(e.message || 'No se pudo eliminar el avatar.');
    }
  }, [usuario]);

  return (
    <header className="navbar navbar-expand-lg fixed-top p-0 shadow" style={{ height: '60px', backgroundColor: '#aac440' }}>
      <div className="d-flex align-items-center" style={{ height: '60px' }}>
        <button className="btn text-white d-md-none ms-2 me-2" onClick={toggleSidebar}>
          <FaBars />
        </button>
        <div className="d-none d-md-flex justify-content-center align-items-center"
             style={{ width: '220px', backgroundColor: '#f4f9f4', height: '60px' }}>
          <img src={logo} alt="EMAGROUP" style={{ height: '70px', objectFit: 'contain', marginTop: 'auto' }} />
        </div>
      </div>

      <div className="d-flex align-items-center ms-auto me-3 gap-3 flex-nowrap">
        <div className="notification-icon"><Notificaciones /></div>

        <Dropdown align="end">
          <Dropdown.Toggle
            variant="light"
            className="d-flex align-items-center border-0 bg-transparent"
            id="dropdown-user"
          >
            <Avatar
              src={avatarSrc}
              size={28}
              fit="contain"
              onError={() => {
                if (!useController && directFile) setUseController(true);
                else setImgOk(false);
              }}
            />
            <span className="d-none d-sm-inline ms-2">
              {usuario?.username || 'Usuario'}
            </span>
          </Dropdown.Toggle>

          <Dropdown.Menu className="shadow mt-2">
            <div className="text-center p-3">
              <Avatar
                src={avatarSrc}
                size={64}
                fit="contain"
                onError={() => {
                  if (!useController && directFile) setUseController(true);
                  else setImgOk(false);
                }}
              />
              <div className="fw-bold mt-2">{usuario?.username || 'Usuario'}</div>
              <div className="text-muted small">Miembro desde {formatFecha(usuario?.fecha_creacion)}</div>
            </div>

            <Dropdown.Divider />
            <Dropdown.Item onClick={() => navigate('/configuracion/usuarios')}>👤 Perfil</Dropdown.Item>

            <Dropdown.Divider />
            <Dropdown.Item onClick={onPickAvatar} disabled={subiendo}>🖼️ Cambiar avatar…</Dropdown.Item>
            <Dropdown.Item onClick={onRemoveAvatar} disabled={subiendo}>🗑️ Quitar avatar</Dropdown.Item>

            <Dropdown.Divider />
            <Dropdown.Item className="text-danger" onClick={handleLogout}>🚪 Desconectarse</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

        {/* input oculto para subir desde el menú */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>
    </header>
  );
}
