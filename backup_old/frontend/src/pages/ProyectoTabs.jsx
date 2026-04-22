// src/pages/ProyectoTabs.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Container, Spinner, Button } from 'react-bootstrap';
import BpmEstadistico from '@/components/proyecto/BpmEstadistico';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const API_URL = BASE.endsWith('/api') ? BASE : BASE + '/api';

// ✅ roles
const GROUPS = {
  ADMIN: 1,
  CONSULTOR: 8,
  CLIENTE: 9,
  CLIENTE_VIAL: 10,
  ADMIN_CLIENTE: 11,
  CLIENTE_MAPS: 12,
};

function getUserFromStorage() {
  try {
    const s = localStorage.getItem('user');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export default function ProyectoTabs() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = (searchParams.get('tab') || '').toLowerCase();

  const token = localStorage.getItem('token');

  // ✅ detectar cliente (solo lectura)
  const me = useMemo(() => getUserFromStorage(), []);
  const tipo = useMemo(() => Number(me?.tipo_usuario), [me]);
  const isClientReadOnly = useMemo(
    () => [GROUPS.CLIENTE, GROUPS.CLIENTE_VIAL, GROUPS.CLIENTE_MAPS].includes(tipo),
    [tipo]
  );

  const [loading, setLoading] = useState(false);
  const [evaluaciones, setEvaluaciones] = useState([]);

  useEffect(() => {
    let alive = true;

    const cargar = async () => {
      if (tab !== 'bpm') return; // sólo buscamos si vamos a graficar
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/evaluaciones/proyecto/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        const arr = Array.isArray(json?.evaluaciones)
          ? json.evaluaciones
          : (Array.isArray(json) ? json : []);
        if (alive) setEvaluaciones(arr);
      } catch (e) {
        console.error(e);
        if (alive) setEvaluaciones([]);
      } finally {
        if (alive) setLoading(false);
      }
    };

    cargar();
    return () => { alive = false; };
  }, [id, tab, token]);

  // Redirección suave para alias
  useEffect(() => {
    if (tab === 'evaluacion') {
      navigate(`/proyectos/${id}/evaluaciones`, { replace: true });
    }
  }, [tab, id, navigate]);

  return (
    <Container className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="mb-0">Proyecto #{id} — Secciones</h3>

        <div className="btn-group">
          <Button
            variant={tab === 'bpm' ? 'primary' : 'outline-primary'}
            onClick={() => navigate(`/proyectos/${id}/tabs?tab=bpm`)}
            size="sm"
          >
            BPM Estadístico
          </Button>

          <Button
            variant={tab === 'evaluacion' ? 'primary' : 'outline-primary'}
            onClick={() => navigate(`/proyectos/${id}/evaluaciones`)}
            size="sm"
          >
            Evaluaciones
          </Button>

          {/* ✅ cliente: NO ve "Volver a Editar" */}
          {!isClientReadOnly && (
            <Button
              variant="outline-secondary"
              onClick={() => navigate(`/proyectos/${id}/editar`)}
              size="sm"
            >
              Volver a Editar
            </Button>
          )}
        </div>
      </div>

      {tab === 'bpm' && (
        <>
          {loading ? (
            <div className="py-5 text-center">
              <Spinner animation="border" role="status" />
            </div>
          ) : (
            <BpmEstadistico evaluaciones={evaluaciones} />
          )}
        </>
      )}

      {!tab && (
        <div className="text-muted">
          Elegí una pestaña:{' '}
          <Link to={`/proyectos/${id}/tabs?tab=bpm`}>BPM Estadístico</Link> o{' '}
          <Link to={`/proyectos/${id}/evaluaciones`}>Evaluaciones</Link>.
        </div>
      )}
    </Container>
  );
}
