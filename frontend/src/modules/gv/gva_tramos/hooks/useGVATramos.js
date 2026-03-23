import { useEffect, useRef, useState } from "react";
import {
  fetchInformesGeoLinks,
  fetchProgresivasGeojson,
  fetchTramosGeojson,
} from "../services/gvaTramosService";

function safeString(value) {
  return typeof value === "string" ? value : "";
}

export function useGVATramos({ enabled, payload, cacheKey }) {
  const cacheRef = useRef(new Map());
  const inflightRef = useRef(new Map());
  const tramosCacheRef = useRef(new Map());
  const progresivasCacheRef = useRef(new Map());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tramosGeo, setTramosGeo] = useState(null);
  const [progresivasGeo, setProgresivasGeo] = useState(null);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [geometryError, setGeometryError] = useState("");

  const key = safeString(cacheKey);

  const load = async (force = false) => {
    if (!enabled || !key || !payload) return;

    if (!force && cacheRef.current.has(key)) {
      setData(cacheRef.current.get(key));
      return;
    }

    if (inflightRef.current.has(key)) {
      return;
    }

    setLoading(true);
    setError("");

    const promise = fetchInformesGeoLinks(payload)
      .then((resp) => {
        cacheRef.current.set(key, resp);
        setData(resp);
      })
      .catch((err) => {
        setError(String(err?.message || err));
      })
      .finally(() => {
        inflightRef.current.delete(key);
        setLoading(false);
      });

    inflightRef.current.set(key, promise);
    await promise;
  };

  useEffect(() => {
    if (!enabled || !key || !payload) return;
    if (cacheRef.current.has(key)) {
      setData(cacheRef.current.get(key));
      return;
    }
    const run = async () => {
      await load(false);
    };
    run();
  }, [enabled, key, payload]);

  useEffect(() => {
    if (!enabled || !payload?.id_proyecto) return;
    const projectId = Number(payload.id_proyecto);
    if (!projectId) return;

    const selection = data?.submapa?.selection_summary || {};
    const tramoIds = Array.isArray(selection.tramo_ids) ? selection.tramo_ids : [];
    const progresivaIds = Array.isArray(selection.progresiva_ids)
      ? selection.progresiva_ids
      : [];

    const needTramos = tramoIds.length > 0;
    const needProgresivas = progresivaIds.length > 0;

    if (!needTramos) {
      setTramosGeo(null);
    }
    if (!needProgresivas) {
      setProgresivasGeo(null);
    }

    if (!needTramos && !needProgresivas) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      setGeometryLoading(true);
      setGeometryError("");
      try {
        if (needTramos) {
          if (tramosCacheRef.current.has(projectId)) {
            setTramosGeo(tramosCacheRef.current.get(projectId));
          } else {
            const fc = await fetchTramosGeojson(projectId);
            if (!cancelled) {
              tramosCacheRef.current.set(projectId, fc);
              setTramosGeo(fc);
            }
          }
        }

        if (needProgresivas) {
          if (progresivasCacheRef.current.has(projectId)) {
            setProgresivasGeo(progresivasCacheRef.current.get(projectId));
          } else {
            const fc = await fetchProgresivasGeojson(projectId);
            if (!cancelled) {
              progresivasCacheRef.current.set(projectId, fc);
              setProgresivasGeo(fc);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setGeometryError(String(err?.message || err));
        }
      } finally {
        if (!cancelled) setGeometryLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [enabled, payload?.id_proyecto, data?.submapa?.selection_summary]);

  return {
    data,
    loading,
    error,
    refetch: () => load(true),
    cacheKey: key,
    tramosGeo,
    progresivasGeo,
    geometryLoading,
    geometryError,
  };
}
