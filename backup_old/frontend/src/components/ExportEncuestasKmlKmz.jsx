// src/components/ExportEncuestasKmlKmz.jsx
// RUTAS BACKEND:
//  - GET  /api/tramos/proyectos/:idProyecto/tramos
//  - GET  /api/encuestas/export/:tipo?proyecto=:idProyecto&tramo=:idTramo|all   (tipo = kml|kmz)

import React, { useEffect, useMemo, useState } from "react";
import { Form, Button, Spinner } from "react-bootstrap";
import { alerts } from "@/utils/alerts"; // ✅ NUEVO

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

const authHeaders = () => {
  const t =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const jsonOrTextError = async (res) => {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = ct.includes("application/json");
  if (res.ok) return isJson ? res.json() : res.text();
  // 401: logout suave
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    throw new Error("Sesión expirada. Inicie sesión nuevamente.");
  }
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
  const msg =
    (typeof payload === "object" && (payload.message || payload.error)) ||
    (typeof payload === "string" && payload) ||
    `HTTP ${res.status}`;
  throw new Error(msg);
};

export default function ExportEncuestasKmlKmz({ idProyecto }) {
  const pid = Number(idProyecto);

  const [tramos, setTramos] = useState([]);
  const [selTramo, setSelTramo] = useState("all");
  const [loadingTramos, setLoadingTramos] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!pid) return;

    async function load() {
      try {
        setLoadingTramos(true);
        const res = await fetch(`${API_URL}/tramos/proyectos/${pid}/tramos`, {
          headers: authHeaders(),
        });
        const data = await jsonOrTextError(res);
        setTramos(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setTramos([]);
        alerts.toast.warning(e?.message || "No se pudieron cargar los tramos.");
      } finally {
        setLoadingTramos(false);
      }
    }

    load();
  }, [pid]);

  const buildUrl = useMemo(() => {
    return (tipo) =>
      `${API_URL}/encuestas/export/${tipo}?proyecto=${pid}&tramo=${selTramo || "all"}`;
  }, [pid, selTramo]);

  const descargar = async (tipo) => {
    try {
      if (!pid) {
        alerts.toast.warning("Falta el ID del proyecto.");
        return;
      }

      setDownloading(true);

      const res = await fetch(buildUrl(tipo), {
        headers: authHeaders(),
      });

      if (res.status === 401) {
        await jsonOrTextError(res); // dispara error controlado
        return;
      }

      if (!res.ok) {
        // intenta leer json {error/message} si existe
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        const isJson = ct.includes("application/json");
        const err = isJson ? await res.json().catch(() => ({})) : {};
        const msg = err?.error || err?.message || "No se pudo exportar";
        alerts.toast.error(msg);
        return;
      }

      const blob = await res.blob();

      const tramoTxt = selTramo === "all" ? "ALL" : String(selTramo);
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);

      a.href = href;
      a.download = `Encuestas_${pid}_${tramoTxt}.${tipo}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);

      alerts.toast.success(`Exportación ${tipo.toUpperCase()} lista.`);
    } catch (e) {
      console.error(e);
      alerts.toast.error(e?.message || "Error al exportar.");
      if (String(e?.message || "").toLowerCase().includes("sesión expirada")) {
        window.location.replace("/login");
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="d-flex align-items-end gap-2 flex-wrap">
      <Form.Group className="me-2">
        <Form.Label className="mb-1">Tramo</Form.Label>

        <Form.Select
          size="sm"
          value={selTramo}
          onChange={(e) => setSelTramo(e.target.value)}
          style={{ minWidth: 220 }}
          disabled={loadingTramos || downloading}
        >
          <option value="all">Todos los tramos</option>
          {tramos.map((t) => (
            <option key={t.id_tramo} value={t.id_tramo}>
              {t.nombre_tramo}
            </option>
          ))}
        </Form.Select>

        {loadingTramos ? (
          <div className="small text-muted mt-1">
            <Spinner animation="border" size="sm" className="me-2" />
            Cargando tramos…
          </div>
        ) : null}
      </Form.Group>

      <div className="d-flex gap-2">
        <Button
          variant="outline-primary"
          size="sm"
          disabled={downloading || loadingTramos}
          onClick={() => descargar("kml")}
          title="Descargar KML (Google Earth)"
        >
          {downloading ? "…" : "⬇️ KML"}
        </Button>

        <Button
          variant="outline-success"
          size="sm"
          disabled={downloading || loadingTramos}
          onClick={() => descargar("kmz")}
          title="Descargar KMZ (comprimido)"
        >
          {downloading ? "…" : "⬇️ KMZ"}
        </Button>
      </div>
    </div>
  );
}
