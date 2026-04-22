// src/components/ModuloInformes.jsx
import React, { useMemo, useState } from "react";
import { Modal, Button, Form, Row, Col } from "react-bootstrap";
import { alerts } from "@/utils/alerts"; // ✅ NUEVO

const ETAPAS = [
  { key: "mesa", label: "Mesa de Entrada" },
  { key: "atec_ini", label: "Análisis Técnico (inicio DGCCARN)" },
  { key: "geomatica", label: "Geomática" },
  { key: "atecnico", label: "Análisis Técnico (proceso)" },
  { key: "rima_p", label: "RIMA (Publicación)" },
  { key: "rima_w", label: "RIMA (WEB)" },
  { key: "diva", label: "DVIA" },
  { key: "dir_gen", label: "Dirección General" },
  { key: "dia", label: "Licencia DIA" },
  { key: "resol", label: "Resoluciones (A.A.)" },
  { key: "man", label: "Registro Mantenimiento EMA" },
  { key: "pga", label: "Registro PGA EMA" },
];

// Config por etapa → qué columnas tocar
const CONFIG = {
  mesa: {
    flag: "mesa_control",
    fechas: [
      { col: "mesa_fecha_ini", label: "Fecha ingreso Mesa" },
      { col: "mesa_fecha_pago", label: "Fecha pago Mesa" },
    ],
    obs: "mesa_obs",
    usu: "mesa_usu_modif",
  },
  atec_ini: {
    flag: "atec_ini",
    fechas: [{ col: "atec_ini_fecha", label: "Fecha inicio análisis técnico" }],
    obs: "atec_ini_obs",
    usu: "atec_ini_usu_modif",
  },
  geometria: undefined, // reservado (no usado)
  geometrico: undefined, // reservado
  geomatica: {
    flag: "geomatica",
    fechas: [{ col: "geo_fecha_ini", label: "Fecha inicio Geomática" }],
    obs: "geo_obs",
    usu: "geo_usu_modif",
  },
  atecnico: {
    flag: "atecnico",
    fechas: [
      { col: "atec_fecha_ini", label: "Fecha inicio análisis técnico" },
      { col: "atec_fecha_fin", label: "Fecha fin análisis técnico" },
    ],
    obs: "atec_obs",
    usu: "atec_usu_modif",
  },
  rima_p: {
    flag: "rima_p",
    fechas: [{ col: "rima_p_fecha", label: "Fecha RIMA (Publicación)" }],
    obs: "rima_p_obs",
    usu: "rima_p_usu_modif",
  },
  rima_w: {
    flag: "rima_w",
    fechas: [{ col: "rima_w_fecha", label: "Fecha RIMA (WEB)" }],
    obs: "rima_w_obs",
    usu: "rima_w_usu_modif",
  },
  diva: {
    flag: "diva",
    fechas: [{ col: "diva_fecha_ini", label: "Fecha inicio DVIA" }],
    obs: "diva_obs",
    usu: "diva_usu_modif",
  },
  dir_gen: {
    flag: "dir_gen",
    fechas: [{ col: "dir_gen_fecha_ini", label: "Fecha inicio Dirección General" }],
    obs: "dir_gen_obs",
    usu: "dir_gen_usu_modif",
  },
  dia: {
    flag: "dia",
    fechas: [{ col: "dia_fecha", label: "Fecha Licencia DIA" }],
    obs: "dia_obs",
    usu: "dia_usu_modif",
  },
  resol: {
    flag: "resol",
    fechas: [{ col: "resol_fecha", label: "Fecha Resolución (A.A.)" }],
    obs: "resol_obs",
    usu: "resol_usu_modif",
  },
  man: {
    flag: "man",
    fechas: [{ col: "man_fecha", label: "Fecha Registro Mantenimiento EMA" }],
    obs: "man_obs",
    usu: "man_usu_modif",
  },
  pga: {
    flag: "pga",
    fechas: [{ col: "pga_fecha", label: "Fecha Registro PGA EMA" }],
    obs: "pga_obs",
    usu: "pga_usu_modif",
  },
};

export default function EstadoProyectoModal({
  show,
  onClose,
  proyectoId,
  defaultEtapa = "mesa",
  onSaved,
}) {
  const token = localStorage.getItem("token");
  const bearer = token?.startsWith("Bearer ")
    ? token
    : token
    ? `Bearer ${token}`
    : null;

  const [etapa, setEtapa] = useState(defaultEtapa);
  const cfg = useMemo(() => CONFIG[etapa] || {}, [etapa]);

  const [marcarSi, setMarcarSi] = useState(true); // 'SI' por defecto
  const [fechas, setFechas] = useState({});
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false); // ✅ NUEVO

  const handleFecha = (col, val) => setFechas((f) => ({ ...f, [col]: val }));

  const handleSubmit = async () => {
    try {
      if (!proyectoId) {
        alerts.toast.warning("Falta el ID del proyecto.");
        return;
      }

      // ✅ opcional: validar fechas si marcarSi = true
      if (marcarSi && Array.isArray(cfg.fechas) && cfg.fechas.length) {
        const faltan = cfg.fechas.filter((f) => !String(fechas[f.col] || "").trim());
        if (faltan.length) {
          alerts.toast.warning(
            `Complete: ${faltan.map((x) => x.label).join(", ")}.`
          );
          return;
        }
      }

      const payload = {
        etapa, // ej. 'mesa'
        si: !!marcarSi, // true => 'SI'
        obs: obs || null,
        fechas, // { mesa_fecha_ini: '2025-09-23', ... }
      };

      const base =
        import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

      setSaving(true);

      const res = await fetch(`${base}/api/proyectos/${proyectoId}/estado`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: bearer } : {}),
        },
        body: JSON.stringify(payload),
      });

      // ✅ 401: aviso + logout suave
      if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        alerts.toast.error("Sesión expirada. Inicie sesión de nuevo.");
        window.location.replace("/login");
        return;
      }

      // ✅ leer error como texto si no es ok
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }

      const json = await res.json(); // trae des_estado/estado actualizados
      onSaved?.(json);

      alerts.toast.success("Estado del proyecto actualizado.");
      onClose?.();
    } catch (e) {
      console.error(e);
      alerts.toast.error(e?.message || "No se pudo actualizar el estado del proyecto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={saving ? undefined : onClose} backdrop="static">
      <Modal.Header closeButton={!saving}>
        <Modal.Title>Cambiar estado del proyecto</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Etapa</Form.Label>
            <Form.Select
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              disabled={saving}
            >
              {ETAPAS.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Check
              type="switch"
              id="marcar-si"
              label='Marcar etapa como "SI"'
              checked={marcarSi}
              onChange={(e) => setMarcarSi(e.target.checked)}
              disabled={saving}
            />
            <Form.Text>
              Si está en “SI” y completas las fechas requeridas, actualizará el{" "}
              <b>estado</b>.
            </Form.Text>
          </Form.Group>

          <Row>
            {(cfg.fechas || []).map((f) => (
              <Col
                md={cfg.fechas.length > 1 ? 6 : 12}
                key={f.col}
                className="mb-3"
              >
                <Form.Group>
                  <Form.Label>{f.label}</Form.Label>
                  <Form.Control
                    type="date"
                    value={fechas[f.col] || ""}
                    onChange={(e) => handleFecha(f.col, e.target.value)}
                    disabled={saving}
                  />
                </Form.Group>
              </Col>
            ))}
          </Row>

          {cfg.obs && (
            <Form.Group>
              <Form.Label>Observación</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="(opcional)"
                disabled={saving}
              />
            </Form.Group>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
