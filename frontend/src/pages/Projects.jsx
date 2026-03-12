// src/pages/Projects.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ProyectoModal from '@/components/ui/ProyectoModal';
import ProyectoModalCliente from '@/components/ui/ProyectoModalCliente';
import '@/styles/ProyectosCliente.css';

import {
  Search, X, User2, Map as MapIcon, MoreHorizontal, Plus, FileSpreadsheet,
  CheckCircle2, Wrench, Clock
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const UI_PAGE_SIZE = 8;
const SERVER_PAGE_LIMIT = 100;
const ADMIN_ROLE_ID = 1;

// ✅ UNIFICADO: toda la app usa un solo visor
const RUTA_VISOR_FULL = (idProyecto) => `/visor-full/${idProyecto}`;

/* =================== helpers base =================== */
const normText = (s = '') =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const tituloCase = (s = '') =>
  s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const keyify = (s = '') =>
  normText(s).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');

const uniqBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter((i) => {
    const k = keyFn(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* =================== permisos desde /usuarios/me =================== */
function getRoleIds(user) {
  if (!Array.isArray(user?.role_ids)) return [];
  return user.role_ids
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

function isAdminUser(user) {
  const tipo = Number(user?.tipo_usuario);
  const groupId = Number(user?.group_id);
  const roles = getRoleIds(user);

  return tipo === ADMIN_ROLE_ID || groupId === ADMIN_ROLE_ID || roles.includes(ADMIN_ROLE_ID);
}

function hasUserPerm(user, perm) {
  if (isAdminUser(user)) return true;

  const perms = Array.isArray(user?.perms) ? user.perms : [];
  return perms.includes(perm);
}

/* =================== AGRUPAR POR PRIMERAS PALABRAS =================== */

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'para', 'por', 'con', 'sin']);

function cleanToken(t = '') {
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function tokenizeSimple(s = '') {
  return (s || '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Genera etiqueta a partir de las primeras N palabras.
 * - mode:
 *    - 'strict' => toma las primeras N palabras tal cual aparecen
 *    - 'smart'  => salta stopwords y números/códigos, toma N “significativas”
 * - cutAtDe: si true, corta en el primer "de|del" para evitar arrastrar lugares largos
 */
function firstWordsLabel(name = '', { words = 2, mode = 'smart', cutAtDe = true } = {}) {
  let raw = name || '';
  if (cutAtDe) {
    const m = raw.match(/^(.+?)(?:\s+de(l)?\b.*)?$/i);
    if (m && m[1]) raw = m[1];
  }

  const toks = tokenizeSimple(raw);
  let picked = [];

  if (mode === 'strict') {
    picked = toks.slice(0, words);
  } else {
    for (const w of toks) {
      const t = cleanToken(w).toLowerCase();
      if (STOPWORDS.has(t)) continue;
      if (/^[0-9]+$/.test(t)) continue;
      if (/^[a-z]{0,2}[0-9]{2,}$/i.test(t)) continue;
      picked.push(w);
      if (picked.length >= words) break;
    }
    if (picked.length === 0) picked = toks.slice(0, words);
  }

  const label = picked.join(' ').trim();
  return tituloCase(label || 'Otros');
}

/* Parámetros de agrupación */
const WORDS_COUNT = 2;
const WORDS_MODE = 'smart';
const CUT_AT_DE = true;

/* =================== componente =================== */
export default function ProyectosList() {
  const [proyectos, setProyectos] = useState([]);
  const [usuario, setUsuario] = useState(undefined);
  const [userReady, setUserReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const [filtroFamiliaKey, setFiltroFamiliaKey] = useState('all');
  const [codeQuery, setCodeQuery] = useState('');
  const [uiPage, setUiPage] = useState(1);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const hydratedRef = useRef(false);

  /* cargar usuario */
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUsuario(null);
      setUserReady(true);
      return;
    }

    fetch(`${API_URL}/usuarios/me`, {
      headers: { Authorization: 'Bearer ' + token }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsuario(data))
      .catch(() => setUsuario(null))
      .finally(() => setUserReady(true));
  }, []);

  /* cargar proyectos */
  useEffect(() => {
    if (!userReady) return;

    if (!usuario) {
      setFiltroFamiliaKey('all');
      setCodeQuery('');
      localStorage.removeItem('projListFilters');
      setProyectos([]);
      setUiPage(1);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const token = localStorage.getItem('token');

        const base = new URLSearchParams({ page: 1, limit: SERVER_PAGE_LIMIT });

        const firstRes = await fetch(`${API_URL}/proyectos?${base.toString()}`, {
          headers: { Authorization: 'Bearer ' + token }
        });

        if (!firstRes.ok) {
          console.error('Error al listar proyectos', firstRes.status);
          setProyectos([]);
          return;
        }

        const firstData = await firstRes.json();
        const totalPages = Math.max(1, firstData.totalPages || 1);

        let all = Array.isArray(firstData.data) ? [...firstData.data] : [];

        if (totalPages > 1) {
          const restParams = [];
          for (let p = 2; p <= totalPages; p++) {
            const params = new URLSearchParams(base);
            params.set('page', String(p));
            restParams.push(params);
          }

          const fetches = restParams.map((params) =>
            fetch(`${API_URL}/proyectos?${params.toString()}`, {
              headers: { Authorization: 'Bearer ' + token }
            })
              .then((r) => (r.ok ? r.json() : { data: [] }))
              .catch(() => ({ data: [] }))
          );

          const pages = await Promise.all(fetches);
          pages.forEach((d) => {
            if (Array.isArray(d.data)) all = all.concat(d.data);
          });
        }

        all = uniqBy(all, (x) => String(x.gid ?? 'x'));
        setProyectos(all);
      } catch (e) {
        console.error(e);
        setProyectos([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [usuario, userReady]);

  /* hidratar filtros desde URL/LS */
  useEffect(() => {
    let famKey = searchParams.get('fam') || undefined;
    let code = searchParams.get('code') || undefined;
    let pg = parseInt(searchParams.get('pg') || '1', 10);
    if (!Number.isFinite(pg) || pg < 1) pg = 1;

    if (!famKey && !code && (!searchParams.get('pg') || pg === 1)) {
      try {
        const saved = JSON.parse(localStorage.getItem('projListFilters') || '{}');
        if (saved.fam) famKey = saved.fam;
        if (saved.code) code = saved.code;
        if (saved.page && Number.isFinite(saved.page) && saved.page > 0) pg = saved.page;
      } catch {}
    }

    if (famKey) setFiltroFamiliaKey(famKey);
    if (code) setCodeQuery(code);
    setUiPage(pg);

    hydratedRef.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* persistir filtros en URL + LS */
  useEffect(() => {
    const params = {};
    if (filtroFamiliaKey && filtroFamiliaKey !== 'all') params.fam = filtroFamiliaKey;
    if (codeQuery && codeQuery.trim()) params.code = codeQuery.trim();
    params.pg = String(uiPage);

    setSearchParams(params);
    localStorage.setItem('projListFilters', JSON.stringify({
      fam: filtroFamiliaKey,
      code: codeQuery,
      page: uiPage
    }));
  }, [filtroFamiliaKey, codeQuery, uiPage, setSearchParams]);

  /* reset page on filters */
  useEffect(() => {
    if (!hydratedRef.current) return;
    setUiPage(1);
  }, [filtroFamiliaKey, codeQuery]);

  /* ===== permisos ===== */
  const canCreateProyecto = hasUserPerm(usuario, 'proyectos.create');
  const canReadProyecto = hasUserPerm(usuario, 'proyectos.read');
  const canExportProyecto = canReadProyecto;
  const canVerMapa = canReadProyecto;

  /* ===== etiqueta/familia por primeras palabras ===== */
  const familiaDeProyecto = (p) =>
    firstWordsLabel(p?.nombre || '', {
      words: WORDS_COUNT,
      mode: WORDS_MODE,
      cutAtDe: CUT_AT_DE,
    });

  /* buckets de familias */
  const familias = useMemo(() => {
    const buckets = new Map();
    for (const p of proyectos) {
      const name = familiaDeProyecto(p);
      const key = keyify(name);
      if (!buckets.has(key)) buckets.set(key, { key, name, count: 0 });
      buckets.get(key).count++;
    }
    return Array.from(buckets.values()).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
  }, [proyectos]);

  /* filtrado + orden */
  const proyectosFiltrados = useMemo(() => {
    const q = normText((codeQuery || '').replace(/^#/, ''));
    const list = proyectos.filter((p) => {
      if (filtroFamiliaKey !== 'all') {
        const famKey = keyify(familiaDeProyecto(p));
        if (famKey !== filtroFamiliaKey) return false;
      }
      if (q) {
        const nombre = normText(p.nombre || '');
        const codigo = normText(p.codigo || '');
        if (!(nombre.includes(q) || codigo.includes(q))) return false;
      }
      return true;
    });

    list.sort((a, b) =>
      (a.nombre || '').localeCompare(b.nombre || '', 'es', { numeric: true, sensitivity: 'base' })
    );
    return list;
  }, [proyectos, filtroFamiliaKey, codeQuery]);

  /* paginación UI */
  const uiTotalPages = Math.max(1, Math.ceil(proyectosFiltrados.length / UI_PAGE_SIZE));
  const displayedProjects = useMemo(() => {
    const start = (uiPage - 1) * UI_PAGE_SIZE;
    return proyectosFiltrados.slice(start, start + UI_PAGE_SIZE);
  }, [proyectosFiltrados, uiPage]);

  if (!userReady) return <div className="container mt-4">Cargando usuario…</div>;
  if (!usuario) return <div className="container mt-4">Iniciá sesión para ver tus proyectos.</div>;

  const isCliente = [9, 10, 11].includes(Number(usuario?.tipo_usuario));
  const ModalComponent = isCliente ? ProyectoModalCliente : ProyectoModal;

  const goMapa = (p) => {
    const gid = p?.gid;
    if (!gid) return;

    try {
      localStorage.setItem('proyectoActualId', String(gid));
      localStorage.setItem('proyectoSeleccionado', JSON.stringify({ gid }));
    } catch {}

    navigate(RUTA_VISOR_FULL(gid));
  };

  return (
    <div className="container py-3">
      <div className="pc-header">
        <div>
          <h2 className="pc-title">Listado de Proyectos</h2>
          <p className="pc-sub">Filtrá por <b>familia</b> y/o buscá por <b>código</b>.</p>
          {Number(usuario?.tipo_usuario) === 11 && (
            <p className="pc-sub" style={{ marginTop: -6 }}>
              Mostrando proyectos de tu <b>cartera de clientes</b>.
            </p>
          )}
        </div>

        <div className="pc-actions">
          {canCreateProyecto && (
            <button className="pc-btn pc-btn-green" onClick={() => navigate('/crear-proyecto')}>
              <Plus className="ico" /> Crear Proyecto
            </button>
          )}

          {canExportProyecto && (
            <button className="pc-btn pc-btn-outline" onClick={() => {}}>
              <FileSpreadsheet className="ico" /> Exportar Excel
            </button>
          )}
        </div>
      </div>

      <div
        className="pc-toolbar"
        style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'nowrap' }}
      >
        <div
          className="chip-row"
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
            scrollbarWidth: 'thin',
            flex: 1,
            WebkitOverflowScrolling: 'touch',
            maskImage:
              'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)'
          }}
        >
          <button
            className={`pc-btn pc-btn-outline ${filtroFamiliaKey === 'all' ? 'pc-btn-active' : ''}`}
            onClick={() => setFiltroFamiliaKey('all')}
            title="Ver todas las familias"
            style={{
              height: 42, lineHeight: '42px', borderRadius: 12, padding: '0 16px',
              whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto'
            }}
          >
            Todas
          </button>

          {familias.map((f) => (
            <button
              key={f.key}
              className={`pc-btn pc-btn-outline ${filtroFamiliaKey === f.key ? 'pc-btn-active' : ''}`}
              onClick={() => setFiltroFamiliaKey(f.key)}
              title={`Filtrar por: ${f.name}`}
              style={{
                height: 42, lineHeight: '42px', borderRadius: 12, padding: '0 16px',
                whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 0 auto'
              }}
            >
              {f.name} <span style={{ opacity: 0.7 }}>({f.count})</span>
            </button>
          ))}
        </div>

        <div className="pc-search" style={{ minWidth: 260, flex: '0 0 260px' }}>
          <Search className="pc-search-icon" />
          <input
            type="text"
            autoComplete="off"
            className="pc-search-input"
            placeholder="Código (#SMR08, SMR0) o nombre"
            value={codeQuery}
            onChange={(e) => setCodeQuery(e.target.value)}
          />
          {codeQuery && (
            <button
              type="button"
              className="pc-search-clear"
              title="Limpiar"
              aria-label="Limpiar búsqueda"
              onClick={() => setCodeQuery('')}
            >
              <X className="ico" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mt-3">Cargando proyectos…</div>
      ) : (
        <div className="proj-grid">
          {displayedProjects.map((p) => (
            <article key={p.gid} className="proj-card">
              <header className="proj-head">
                <div className="proj-title">{p.nombre || 'Proyecto sin nombre'}</div>
                {p.codigo && <div className="proj-code">#{p.codigo}</div>}
              </header>

              <div className="proj-meta">
                <EstadoBadge value={p.des_estado} />
                {p.proponente && (
                  <div className="proj-prop">
                    <User2 className="ico-sm" /> {p.proponente}
                  </div>
                )}
              </div>

              <div className="proj-actions">
                {canVerMapa && (
                  <button className="pc-btn pc-btn-blue pc-btn-map" onClick={() => goMapa(p)}>
                    <MapIcon className="ico" /> Ver mapa
                  </button>
                )}

                <ModalComponent proyecto={p}>
                  <button className="pc-btn pc-btn-light pc-btn-more">
                    <MoreHorizontal className="ico" /> Más
                  </button>
                </ModalComponent>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="pc-pager" role="group" aria-label="Paginación de proyectos">
        <span>Página {uiPage} de {uiTotalPages}</span>
        <div className="pc-pager-btns">
          <button
            className="pc-btn pc-btn-outline"
            disabled={uiPage === 1}
            onClick={() => setUiPage((p) => Math.max(1, p - 1))}
          >
            ◀ Anterior
          </button>
          <button
            className="pc-btn pc-btn-outline"
            disabled={uiTotalPages === 1 || uiPage === uiTotalPages}
            onClick={() => setUiPage((p) => Math.min(uiTotalPages, p + 1))}
          >
            Siguiente ▶
          </button>
        </div>
      </div>

      <div className="pc-footnote">
        Mostrando {displayedProjects.length} de {proyectosFiltrados.length} proyectos filtrados
        (página {uiPage}/{uiTotalPages}). Total cargados: {proyectos.length}.
      </div>
    </div>
  );
}

/* -------- badge de estado -------- */
function EstadoBadge({ value }) {
  const v = (value || '').toLowerCase();
  let cls = 'ok';
  let Icon = CheckCircle2;

  if (v.includes('pend')) {
    cls = 'warn';
    Icon = Clock;
  }
  if (v.includes('manten')) {
    cls = 'muted';
    Icon = Wrench;
  }

  return (
    <span className={`estado-badge ${cls}`}>
      <Icon className="ico-sm" />
      {value || '—'}
    </span>
  );
}