import React, { useEffect, useMemo, useState } from "react";
import { Button, Form, Modal, Table, Badge, Spinner, Alert, InputGroup } from "react-bootstrap";
import Swal from "sweetalert2";
import { PushCampaignsAPI } from "@/services/pushCampaigns.service";

const SCOPES = [
  { value: "GLOBAL", label: "Global (todos)" },
  { value: "CLIENTE", label: "Por Cliente (id_cliente)" },
  { value: "CONSULTOR", label: "Por Consultor (id_consultor)" },
  { value: "USERS", label: "Usuarios específicos (user_id)" },
  { value: "CARTERA_CLIENTE", label: "Cartera de Cliente Admin (admin_id)" },
  { value: "CARTERA_CONSULTOR", label: "Cartera de Consultor (consultor_id)" },
];

const ACTIONS = [
  { value: "NONE", label: "Sin acción (solo mostrar)" },
  { value: "OPEN_APP", label: "Abrir app (Dashboard)" },
  { value: "GO_ROUTE", label: "Ir a una pantalla (ruta)" },
  { value: "OPEN_PROJECT", label: "Abrir proyecto (ver_proyecto/:id)" },
];

function safeJSONParse(txt, fallback = {}) {
  try {
    const obj = JSON.parse(txt || "{}");
    return obj && typeof obj === "object" ? obj : fallback;
  } catch {
    return fallback;
  }
}

function prettyJSON(v) {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseIdsCSV(text) {
  const parts = String(text || "")
    .split(/[,;\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const ids = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n) && n > 0) ids.push(n);
  }
  return [...new Set(ids)];
}

function badgeStatus(st) {
  const s = String(st || "").toUpperCase();
  if (s === "SENT") return <Badge bg="success">SENT</Badge>;
  if (s === "SENDING") return <Badge bg="warning" text="dark">SENDING</Badge>;
  if (s === "FAILED") return <Badge bg="danger">FAILED</Badge>;
  if (s === "QUEUED") return <Badge bg="info">QUEUED</Badge>;
  return <Badge bg="secondary">DRAFT</Badge>;
}

// ------- opcional: búsqueda de usuarios para NO pegar IDs -------
async function searchUsers(q) {
  // Si no tenés endpoint, devolvemos vacío y listo.
  // Implementación esperada: GET /api/usuarios/search?q=...&limit=20
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/usuarios/search?q=${encodeURIComponent(q)}&limit=20`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default function PushCampaigns() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit | viewTargets
  const [active, setActive] = useState(null);

  const [saving, setSaving] = useState(false);

  // form campaña
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState("GLOBAL");

  // ✅ MODO AMIGABLE (sin JSON)
  const [simpleMode, setSimpleMode] = useState(true);
  const [action, setAction] = useState("NONE");
  const [route, setRoute] = useState("");
  const [projectId, setProjectId] = useState("");

  // ✅ MODO AVANZADO (JSON)
  const [dataJsonText, setDataJsonText] = useState("{\n  \"tipo\": \"campania\"\n}");

  // targets
  const [targetsText, setTargetsText] = useState(""); // fallback CSV
  const [targetsHelp, setTargetsHelp] = useState("");

  // ✅ selección de usuarios (scope USERS)
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]); // [{id, label}]
  const [searchingUsers, setSearchingUsers] = useState(false);

  const scopeMeta = useMemo(() => SCOPES.find((s) => s.value === scope), [scope]);

  async function reload() {
    setLoading(true);
    setErr("");
    try {
      const r = await PushCampaignsAPI.list();
      setRows(r?.rows || []);
    } catch (e) {
      setErr(e?.message || "Error cargando campañas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function resetForm() {
    setTitle("");
    setBody("");
    setScope("GLOBAL");

    setSimpleMode(true);
    setAction("NONE");
    setRoute("");
    setProjectId("");
    setDataJsonText("{\n  \"tipo\": \"campania\"\n}");

    setTargetsText("");
    setTargetsHelp("");

    setUserQuery("");
    setUserResults([]);
    setSelectedUsers([]);

    setActive(null);
    setMode("create");
  }

  function buildDataJsonFromSimple() {
    // Esto es lo que entiende tu app (podés ajustar)
    // tipo siempre "campania" para que el cliente entienda “es un aviso”
    const obj = { tipo: "campania" };

    if (action === "OPEN_APP") {
      obj.ruta = "Dashboard";
    } else if (action === "GO_ROUTE") {
      if (route.trim()) obj.ruta = route.trim();
    } else if (action === "OPEN_PROJECT") {
      const id = Number(projectId);
      if (Number.isFinite(id) && id > 0) {
        obj.ruta = `ver_proyecto/${id}`;
        obj.id_proyecto = id;
      }
    }

    return obj;
  }

  function parseDataJson() {
    if (simpleMode) return buildDataJsonFromSimple();

    const obj = safeJSONParse(dataJsonText, {});
    if (!obj || typeof obj !== "object") return {};
    return obj;
  }

  function getTargetsPayload(sc, ids) {
    const payload = { scope: sc };
    if (sc === "CLIENTE") payload.cliente_ids = ids;
    if (sc === "CONSULTOR") payload.consultor_ids = ids;
    if (sc === "USERS") payload.user_ids = ids;
    if (sc === "CARTERA_CLIENTE") payload.admin_cliente_ids = ids;
    if (sc === "CARTERA_CONSULTOR") payload.consultor_ids = ids;
    return payload;
  }

  async function openCreate() {
    resetForm();
    setOpen(true);
  }

  async function openEdit(c) {
    setMode("edit");
    setActive(c);
    setTitle(c.title || "");
    setBody(c.body || "");
    setScope((c.scope || "GLOBAL").toUpperCase());

    const dj = c.data_json || {};
    setDataJsonText(prettyJSON(dj));

    // Intentar “traducir” al modo simple
    const tipo = dj?.tipo || "campania";
    const ruta = dj?.ruta || "";
    setSimpleMode(true); // por defecto simple
    setAction(ruta?.startsWith("ver_proyecto/") ? "OPEN_PROJECT" : ruta ? "GO_ROUTE" : "NONE");
    setRoute(ruta || "");
    setProjectId(dj?.id_proyecto ? String(dj.id_proyecto) : "");

    setTargetsText("");
    setTargetsHelp("");
    setSelectedUsers([]);
    setOpen(true);
  }

  async function openTargets(c) {
    setMode("viewTargets");
    setActive(null);
    setSaving(true);
    setErr("");
    try {
      const r = await PushCampaignsAPI.get(c.id);
      setActive(r?.campaign || c);

      const camp = r?.campaign || c;
      setTitle(camp?.title || "");
      setBody(camp?.body || "");
      setScope((camp?.scope || "GLOBAL").toUpperCase());

      const dj = camp?.data_json || {};
      setDataJsonText(prettyJSON(dj));

      // targets existentes
      const t = r?.targets || [];
      const ids = t.map((x) => x.target_id).filter(Boolean);
      setTargetsText(ids.join(","));
      setTargetsHelp(`${t.length} destinatarios cargados`);

      // Si scope USERS, intentamos cargar selección visual
      if (String(camp?.scope || "").toUpperCase() === "USERS") {
        const sel = ids.map((id) => ({ id, label: `user_id #${id}` }));
        setSelectedUsers(sel);
      }

      setOpen(true);
    } catch (e) {
      Swal.fire("Error", e?.message || "No se pudo abrir detalle", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveCampaign() {
    setSaving(true);
    setErr("");
    try {
      const data_json = parseDataJson();

      if (!title.trim() || !body.trim()) throw new Error("Título y Mensaje son obligatorios.");

      // Validaciones amigables
      if (simpleMode && action === "OPEN_PROJECT") {
        const id = Number(projectId);
        if (!Number.isFinite(id) || id <= 0) throw new Error("Poné un ID de proyecto válido.");
      }

      if (!simpleMode) {
        // modo avanzado: validar que sea JSON (ya lo parsea)
        JSON.parse(dataJsonText || "{}");
      }

      if (mode === "create") {
        const r = await PushCampaignsAPI.create({
          title: title.trim(),
          body: body.trim(),
          scope,
          data_json,
        });

        const newId = r?.campaign?.id;

        if (newId && scope !== "GLOBAL") {
          let ids = [];

          if (scope === "USERS" && selectedUsers.length) {
            ids = selectedUsers.map((x) => x.id).filter(Boolean);
          } else {
            ids = parseIdsCSV(targetsText);
          }

          if (!ids.length) throw new Error("Este scope necesita destinatarios.");
          await PushCampaignsAPI.setTargets(newId, getTargetsPayload(scope, ids));
        } else if (newId && scope === "GLOBAL") {
          await PushCampaignsAPI.setTargets(newId, { scope: "GLOBAL" });
        }

        Swal.fire("OK", "Campaña creada", "success");
      } else if (mode === "edit") {
        if (!active?.id) throw new Error("Campaña inválida");
        await PushCampaignsAPI.update(active.id, {
          title: title.trim(),
          body: body.trim(),
          scope,
          data_json,
        });
        Swal.fire("OK", "Campaña actualizada", "success");
      }

      setOpen(false);
      await reload();
    } catch (e) {
      setErr(e?.message || "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  async function saveTargets() {
    setSaving(true);
    setErr("");
    try {
      if (!active?.id) throw new Error("Campaña inválida");

      if (scope === "GLOBAL") {
        await PushCampaignsAPI.setTargets(active.id, { scope: "GLOBAL" });
        Swal.fire("OK", "Targets guardados (GLOBAL)", "success");
        setTargetsHelp("GLOBAL: sin IDs");
      } else {
        let ids = [];
        if (scope === "USERS" && selectedUsers.length) {
          ids = selectedUsers.map((x) => x.id).filter(Boolean);
        } else {
          ids = parseIdsCSV(targetsText);
        }

        if (!ids.length) throw new Error("Elegí destinatarios o pegá IDs.");
        await PushCampaignsAPI.setTargets(active.id, getTargetsPayload(scope, ids));
        Swal.fire("OK", "Targets guardados", "success");
        setTargetsHelp(`${ids.length} destinatarios guardados`);
      }

      await reload();
    } catch (e) {
      setErr(e?.message || "Error guardando targets");
    } finally {
      setSaving(false);
    }
  }

  async function sendNow(c) {
    try {
      const confirm = await Swal.fire({
        title: "Enviar campaña",
        text: `¿Enviar ahora la campaña #${c.id}?`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Enviar",
        cancelButtonText: "Cancelar",
      });
      if (!confirm.isConfirmed) return;

      const r = await PushCampaignsAPI.send(c.id);
      Swal.fire("Enviado", `OK. successCount=${r?.result?.successCount ?? "?"}`, "success");
      await reload();
    } catch (e) {
      Swal.fire("Error", e?.message || "No se pudo enviar", "error");
    }
  }

  async function removeCampaign(c) {
    try {
      const confirm = await Swal.fire({
        title: "Eliminar campaña",
        text: `¿Eliminar campaña #${c.id}?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Eliminar",
        cancelButtonText: "Cancelar",
      });
      if (!confirm.isConfirmed) return;

      await PushCampaignsAPI.remove(c.id);
      Swal.fire("OK", "Eliminada", "success");
      await reload();
    } catch (e) {
      Swal.fire("Error", e?.message || "No se pudo eliminar", "error");
    }
  }

  // búsqueda usuarios (solo scope USERS)
  useEffect(() => {
    let alive = true;

    async function run() {
      if (scope !== "USERS") return;
      const q = userQuery.trim();
      if (q.length < 2) {
        setUserResults([]);
        return;
      }
      setSearchingUsers(true);
      const res = await searchUsers(q);
      if (!alive) return;

      const normalized = (res || []).map((u) => ({
        id: Number(u.id),
        label: `${u.username || ""} ${u.first_name || ""} ${u.last_name || ""}`.trim() || `user_id #${u.id}`,
      })).filter((x) => x.id > 0);

      setUserResults(normalized);
      setSearchingUsers(false);
    }

    run();
    return () => { alive = false; };
  }, [userQuery, scope]);

  function toggleSelectUser(u) {
    setSelectedUsers((prev) => {
      const exists = prev.some((x) => x.id === u.id);
      if (exists) return prev.filter((x) => x.id !== u.id);
      return [...prev, u];
    });
  }

  return (
    <div className="container my-4" style={{ maxWidth: 1100 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0">Centro de Control · Push Campaigns</h4>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Crear campañas y enviar push a GeoAppMobile (FCM).
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={reload} disabled={loading}>
            {loading ? "Cargando..." : "Refrescar"}
          </Button>
          <Button onClick={openCreate}>Nueva Campaña</Button>
        </div>
      </div>

      {err ? <Alert variant="danger">{err}</Alert> : null}

      <div className="card shadow-sm">
        <div className="card-body p-0">
          {loading ? (
            <div className="p-4 d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              <span>Cargando campañas...</span>
            </div>
          ) : (
            <Table striped hover responsive className="mb-0">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>ID</th>
                  <th>Título</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th style={{ width: 180 }}>Creada</th>
                  <th style={{ width: 260 }} className="text-end">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-4" style={{ opacity: 0.7 }}>
                      No hay campañas todavía.
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>
                        <div className="fw-semibold">{c.title}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          {String(c.body || "").slice(0, 80)}
                          {String(c.body || "").length > 80 ? "…" : ""}
                        </div>
                      </td>
                      <td><Badge bg="dark">{String(c.scope || "").toUpperCase()}</Badge></td>
                      <td>{badgeStatus(c.status)}</td>
                      <td style={{ fontSize: 13 }}>
                        {c.created_at ? new Date(c.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="text-end">
                        <div className="btn-group">
                          <Button size="sm" variant="outline-primary" onClick={() => openTargets(c)}>
                            Targets
                          </Button>
                          <Button size="sm" variant="outline-secondary" onClick={() => openEdit(c)}>
                            Editar
                          </Button>
                          <Button size="sm" variant="success" onClick={() => sendNow(c)}>
                            Enviar
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => removeCampaign(c)}>
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </div>
      </div>

      {/* MODAL */}
      <Modal show={open} onHide={() => setOpen(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {mode === "create"
              ? "Nueva Campaña"
              : mode === "edit"
              ? `Editar Campaña #${active?.id}`
              : `Targets · Campaña #${active?.id}`}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {err ? <Alert variant="danger">{err}</Alert> : null}

          <Form.Group className="mb-2">
            <Form.Label>Título</Form.Label>
            <Form.Control
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              placeholder="Ej: Aviso Global ✅"
            />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label>Mensaje</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={saving}
              placeholder="Texto de la notificación..."
            />
          </Form.Group>

          <div className="row">
            <div className="col-md-6">
              <Form.Group className="mb-2">
                <Form.Label>Destinatarios</Form.Label>
                <Form.Select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  disabled={saving || mode === "viewTargets"}
                >
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Form.Select>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  {scopeMeta?.label}
                </div>
              </Form.Group>
            </div>

            <div className="col-md-6">
              {/* ✅ Data_json amigable */}
              <div className="d-flex align-items-center justify-content-between">
                <Form.Label className="mb-1">Acción al tocar</Form.Label>
                <Form.Check
                  type="switch"
                  id="switch-advanced-json"
                  label={simpleMode ? "Modo simple" : "Modo avanzado (JSON)"}
                  checked={!simpleMode}
                  onChange={(e) => setSimpleMode(!e.target.checked)}
                  disabled={saving}
                />
              </div>

              {simpleMode ? (
                <div className="border rounded p-2">
                  <Form.Select value={action} onChange={(e) => setAction(e.target.value)} disabled={saving}>
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </Form.Select>

                  {action === "GO_ROUTE" ? (
                    <Form.Control
                      className="mt-2"
                      value={route}
                      onChange={(e) => setRoute(e.target.value)}
                      disabled={saving}
                      placeholder='Ej: "Projects" o "ver_proyecto/123"'
                    />
                  ) : null}

                  {action === "OPEN_PROJECT" ? (
                    <InputGroup className="mt-2">
                      <InputGroup.Text>ID Proyecto</InputGroup.Text>
                      <Form.Control
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        disabled={saving}
                        placeholder="Ej: 123"
                      />
                    </InputGroup>
                  ) : null}

                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                    Se genera automáticamente el <b>data_json</b> que usará la app.
                  </div>
                </div>
              ) : (
                <Form.Group className="mb-2">
                  <Form.Control
                    as="textarea"
                    rows={6}
                    value={dataJsonText}
                    onChange={(e) => setDataJsonText(e.target.value)}
                    disabled={saving}
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Avanzado: JSON libre. (Solo para admin técnico)
                  </div>
                </Form.Group>
              )}
            </div>
          </div>

          {/* Targets */}
          <div className="mt-2">
            <div className="d-flex align-items-center justify-content-between">
              <div className="fw-semibold">Targets</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{targetsHelp}</div>
            </div>

            {scope === "GLOBAL" ? (
              <Alert variant="secondary" className="mt-2 mb-0">
                GLOBAL no necesita IDs.
              </Alert>
            ) : scope === "USERS" ? (
              <div className="mt-2">
                <Form.Label style={{ fontSize: 13 }}>Buscar usuarios</Form.Label>
                <Form.Control
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  disabled={saving}
                  placeholder="Escribí 2+ letras... (username/nombre)"
                />
                {searchingUsers ? (
                  <div className="mt-2 d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" /> <span>Buscando...</span>
                  </div>
                ) : null}

                {userResults.length ? (
                  <div className="mt-2 border rounded p-2" style={{ maxHeight: 180, overflow: "auto" }}>
                    {userResults.map((u) => {
                      const checked = selectedUsers.some((x) => x.id === u.id);
                      return (
                        <Form.Check
                          key={u.id}
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectUser(u)}
                          label={`${u.label} (id: ${u.id})`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Si no aparece nada, igual podés pegar IDs abajo (modo compatibilidad).
                  </div>
                )}

                {selectedUsers.length ? (
                  <Alert variant="info" className="mt-2">
                    Seleccionados: {selectedUsers.map((x) => x.id).join(", ")}
                  </Alert>
                ) : null}

                <Form.Group className="mt-2">
                  <Form.Label style={{ fontSize: 13 }}>Compatibilidad: pegar user_id</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={targetsText}
                    onChange={(e) => setTargetsText(e.target.value)}
                    disabled={saving}
                    placeholder="Ej: 12, 15, 44"
                  />
                </Form.Group>
              </div>
            ) : (
              <Form.Group className="mt-2">
                <Form.Label style={{ fontSize: 13 }}>
                  Pegá IDs (separados por coma o espacios)
                </Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={targetsText}
                  onChange={(e) => setTargetsText(e.target.value)}
                  disabled={saving}
                  placeholder="Ej: 12, 15, 44"
                />
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  CLIENTE: id_cliente · CONSULTOR: id_consultor · CARTERA_CLIENTE: admin_id · CARTERA_CONSULTOR: consultor_id
                </div>
              </Form.Group>
            )}
          </div>

          {/* Preview técnico (para vos) */}
          <div className="mt-3" style={{ fontSize: 12, opacity: 0.8 }}>
            <div className="fw-semibold mb-1">Vista previa (data_json generado):</div>
            <pre className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {prettyJSON(parseDataJson())}
            </pre>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cerrar
          </Button>

          {mode === "viewTargets" ? (
            <Button onClick={saveTargets} disabled={saving}>
              {saving ? "Guardando..." : "Guardar Targets"}
            </Button>
          ) : (
            <Button onClick={saveCampaign} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </div>
  );
}
