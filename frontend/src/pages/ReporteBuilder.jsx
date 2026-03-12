// src/pages/ReporteBuilder.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Button,
  Spinner,
  Badge,
  Form,
  Accordion,
  Card,
  Row,
  Col,
  InputGroup,
  ProgressBar,
} from "react-bootstrap";
import Swal from "sweetalert2";
import { reportesApi } from "@/services/reportesService";

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2200,
  timerProgressBar: true,
  width: 460,
  didOpen: (popup) => {
    popup.style.wordBreak = "break-word";
    popup.style.overflowWrap = "anywhere";
    popup.style.whiteSpace = "normal";
  },
});

function ensureObjContenido(c) {
  if (c && typeof c === "object") return c;
  if (typeof c === "string") return { texto: c };
  if (c === null || c === undefined) return {};
  return { respuesta: c };
}

function toEditableString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export default function ReporteBuilder() {
  const { idReporte } = useParams();
  const nav = useNavigate();

  const rid = Number(idReporte);
  const ridOk = Number.isFinite(rid) && rid > 0;

  const [loading, setLoading] = useState(true);
  const [savingHeader, setSavingHeader] = useState(false);

  const [reporte, setReporte] = useState(null);
  const [secciones, setSecciones] = useState([]);
  const [bloques, setBloques] = useState([]);
  const [assets, setAssets] = useState([]);

  const [titulo, setTitulo] = useState("");

  // guías
  const [informeBase, setInformeBase] = useState(null);
  const [guiaAgregada, setGuiaAgregada] = useState(null);

  async function load() {
    if (!ridOk) {
      setReporte(null);
      setSecciones([]);
      setBloques([]);
      setAssets([]);
      setTitulo("");
      setInformeBase(null);
      setGuiaAgregada(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await reportesApi.getOne(rid);

      const fixedBloques = (data.bloques || []).map((b) => ({
        ...b,
        contenido: ensureObjContenido(b.contenido),
      }));

      setReporte(data.reporte || null);
      setSecciones(data.secciones || []);
      setBloques(fixedBloques);
      setAssets(data.assets || []);
      setTitulo(data.reporte?.titulo || "");

      setInformeBase(data.informe_base || null);
      setGuiaAgregada(data.guia_agregada || null);
    } catch (e) {
      setReporte(null);
      Swal.fire("Error", e.message || "No se pudo cargar el reporte", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // ✅ FIX: no quedarte en spinner infinito cuando la URL no trae idReporte
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idReporte]);

  const bloquesPorSeccion = useMemo(() => {
    const m = new Map();
    for (const s of secciones) m.set(s.id_reporte_seccion, []);
    for (const b of bloques) {
      const arr = m.get(b.id_reporte_seccion) || [];
      arr.push(b);
      m.set(b.id_reporte_seccion, arr);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort(
        (a, b) =>
          (a.orden || 0) - (b.orden || 0) ||
          (a.id_bloque - b.id_bloque)
      );
      m.set(k, arr);
    }
    return m;
  }, [secciones, bloques]);

  const guardarCabecera = async () => {
    if (!ridOk) return;

    setSavingHeader(true);
    try {
      const r = await reportesApi.updateHeader(rid, { titulo });
      setReporte(r.reporte);
      Toast.fire({ icon: "success", title: "Cabecera actualizada" });
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "No se pudo guardar" });
    } finally {
      setSavingHeader(false);
    }
  };

  const updateBloque = async (idBloque, patch) => {
    if (!ridOk) return;

    try {
      const res = await reportesApi.updateBloque(rid, idBloque, patch);
      const nb = {
        ...res.bloque,
        contenido: ensureObjContenido(res.bloque?.contenido),
      };
      setBloques((prev) => prev.map((x) => (x.id_bloque === idBloque ? nb : x)));
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "Error actualizando bloque" });
    }
  };

  const toggleOculto = (b) => updateBloque(b.id_bloque, { oculto: !b.oculto });

  const addTextoManual = async (idReporteSeccion) => {
    if (!ridOk) return;

    try {
      const res = await reportesApi.addBloqueManual(rid, idReporteSeccion, {
        tipo: "texto",
        etiqueta: "Texto",
        contenido: { texto: "" },
        orden: 9999,
      });
      const nb = { ...res.bloque, contenido: ensureObjContenido(res.bloque?.contenido) };
      setBloques((prev) => [...prev, nb]);
      Toast.fire({ icon: "success", title: "Bloque de texto agregado" });
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "No se pudo agregar bloque" });
    }
  };

  const deleteBloque = async (b) => {
    if (!ridOk) return;

    const ok = await Swal.fire({
      title: "Eliminar bloque",
      text: "Esto no afecta los informes. Solo elimina del reporte.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!ok.isConfirmed) return;

    try {
      await reportesApi.deleteBloque(rid, b.id_bloque);
      setBloques((prev) => prev.filter((x) => x.id_bloque !== b.id_bloque));
      Toast.fire({ icon: "success", title: "Bloque eliminado" });
    } catch (e) {
      Toast.fire({ icon: "error", title: e.message || "No se pudo eliminar" });
    }
  };

  // ✅ Loading
  if (loading) {
    return (
      <div className="container py-4 text-center">
        <Spinner /> <div className="mt-2">Cargando reporte...</div>
      </div>
    );
  }

  // ✅ Si URL está mal (ej: /proyectos/:id/reportes usando Builder)
  if (!ridOk) {
    return (
      <div className="container py-4">
        <div className="alert alert-warning">
          Ruta inválida: este editor requiere <b>/reportes/:idReporte</b>.
        </div>
        <Button variant="secondary" onClick={() => nav(-1)}>
          Volver
        </Button>
      </div>
    );
  }

  // ✅ No encontrado
  if (!reporte) {
    return (
      <div className="container py-4">
        <div className="alert alert-danger">Reporte no encontrado</div>
        <Button variant="secondary" onClick={() => nav(-1)}>
          Volver
        </Button>
      </div>
    );
  }

  const isAgregado = (reporte?.fuente || "") === "agregado";

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h3 className="mb-0">Reporte #{reporte.id_reporte}</h3>
          <div className="d-flex gap-2 align-items-center">
            <Badge bg={reporte.estado === "final" ? "success" : "warning"}>
              {reporte.estado || "borrador"}
            </Badge>
            <Badge bg="info">{reporte.fuente || "informe"}</Badge>
            <small className="text-muted">
              Proyecto: {reporte.id_proyecto} · Plantilla: {reporte.id_plantilla}
            </small>
          </div>
        </div>

        <div className="d-flex gap-2">
          <Button variant="secondary" onClick={() => nav(-1)}>
            Volver
          </Button>
          <Button variant="outline-secondary" onClick={load}>
            Recargar
          </Button>
        </div>
      </div>

      {/* ✅ GUIA */}
      {(informeBase || guiaAgregada) && (
        <Card className="mb-3">
          <Card.Body>
            <div className="d-flex align-items-start justify-content-between">
              <div>
                <div className="fw-semibold">
                  Guía del {isAgregado ? "reporte general" : "informe base"}
                </div>

                {!isAgregado && informeBase?.meta ? (
                  <div className="text-muted">
                    Informe #{informeBase.meta.id_informe} · {informeBase.meta.titulo || "-"} ·{" "}
                    {String(informeBase.meta.fecha_creado || "")}
                  </div>
                ) : null}

                {isAgregado && guiaAgregada ? (
                  <div className="text-muted">
                    Informes (censados): <b>{guiaAgregada.total_informes}</b> · Preguntas:{" "}
                    <b>{guiaAgregada.total_preguntas}</b> · Fotos: <b>{guiaAgregada.fotos}</b>
                  </div>
                ) : null}
              </div>

              <div className="text-end">
                <small className="text-muted d-block">Bloques en este reporte</small>
                <div className="fw-semibold">
                  {bloques.filter((b) => b.tipo === "pregunta").length} preguntas ·{" "}
                  {bloques.filter((b) => b.origen === "manual").length} manuales
                </div>
              </div>
            </div>

            <hr />

            {!isAgregado && informeBase ? (
              <>
                <Row className="g-2">
                  <Col md={3}>
                    <div className="text-muted">Preguntas plantilla</div>
                    <div className="fw-semibold">{informeBase.total_preguntas}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Respondidas</div>
                    <div className="fw-semibold">{informeBase.respondidas}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Vacías</div>
                    <div className="fw-semibold">{informeBase.vacias}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Fotos</div>
                    <div className="fw-semibold">{informeBase.fotos}</div>
                  </Col>
                </Row>

                <div className="mt-2">
                  <div className="d-flex justify-content-between">
                    <small className="text-muted">Completitud del informe</small>
                    <small className="text-muted">{informeBase.porcentaje}%</small>
                  </div>
                  <ProgressBar now={pct(informeBase.porcentaje)} />
                </div>
              </>
            ) : null}

            {isAgregado && guiaAgregada ? (
              <>
                <Row className="g-2">
                  <Col md={3}>
                    <div className="text-muted">Celdas totales</div>
                    <div className="fw-semibold">{guiaAgregada.total_celdas}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Respondidas</div>
                    <div className="fw-semibold">{guiaAgregada.respondidas}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Vacías</div>
                    <div className="fw-semibold">{guiaAgregada.vacias}</div>
                  </Col>
                  <Col md={3}>
                    <div className="text-muted">Fotos</div>
                    <div className="fw-semibold">{guiaAgregada.fotos}</div>
                  </Col>
                </Row>

                <div className="mt-2">
                  <div className="d-flex justify-content-between">
                    <small className="text-muted">Completitud global</small>
                    <small className="text-muted">{guiaAgregada.porcentaje}%</small>
                  </div>
                  <ProgressBar now={pct(guiaAgregada.porcentaje)} />
                </div>
              </>
            ) : null}
          </Card.Body>
        </Card>
      )}

      {/* Cabecera editable */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col md={9}>
              <Form.Label className="mb-1">Título del reporte</Form.Label>
              <Form.Control
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej: Reporte general – Proyecto 276"
              />
            </Col>
            <Col md={3} className="d-grid">
              <Button onClick={guardarCabecera} disabled={savingHeader}>
                {savingHeader ? (
                  <>
                    <Spinner size="sm" className="me-2" /> Guardando...
                  </>
                ) : (
                  "Guardar título"
                )}
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Builder por secciones */}
      <Accordion alwaysOpen>
        {secciones.map((s) => {
          const arr = bloquesPorSeccion.get(s.id_reporte_seccion) || [];
          return (
            <Accordion.Item key={s.id_reporte_seccion} eventKey={String(s.id_reporte_seccion)}>
              <Accordion.Header>
                <div className="d-flex w-100 justify-content-between align-items-center">
                  <span>{s.titulo}</span>
                  <small className="text-muted me-3">{arr.length} bloques</small>
                </div>
              </Accordion.Header>

              <Accordion.Body>
                <div className="d-flex justify-content-end mb-2">
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => addTextoManual(s.id_reporte_seccion)}
                  >
                    + Texto
                  </Button>
                </div>

                {arr.length === 0 ? (
                  <div className="text-muted">No hay bloques en esta sección.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {arr.map((bRaw) => {
                      const b = { ...bRaw, contenido: ensureObjContenido(bRaw.contenido) };
                      const modo =
                        b.contenido?.modo || (b.origen === "agregado" ? "agregado" : "normal");
                      const isAg = modo === "agregado";
                      const st = b.contenido?.stats;

                      return (
                        <Card key={b.id_bloque} className={b.oculto ? "opacity-50" : ""}>
                          <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                              <div>
                                <div className="fw-semibold">
                                  {b.etiqueta || "(sin etiqueta)"}{" "}
                                  <Badge bg="secondary" className="ms-2">
                                    {b.tipo}
                                  </Badge>
                                  {b.id_pregunta_origen ? (
                                    <Badge bg="light" text="dark" className="ms-2">
                                      Q#{b.id_pregunta_origen}
                                    </Badge>
                                  ) : null}
                                  {isAg ? (
                                    <Badge bg="dark" className="ms-2">
                                      agregado
                                    </Badge>
                                  ) : null}
                                </div>
                                <small className="text-muted">
                                  orden: {b.orden} · tipo_pregunta: {b.pregunta_tipo || "-"}
                                </small>
                              </div>

                              <div className="btn-group">
                                <Button
                                  size="sm"
                                  variant={b.oculto ? "outline-success" : "outline-warning"}
                                  onClick={() => toggleOculto(b)}
                                >
                                  {b.oculto ? "Mostrar" : "Ocultar"}
                                </Button>
                                {b.origen === "manual" && (
                                  <Button
                                    size="sm"
                                    variant="outline-danger"
                                    onClick={() => deleteBloque(b)}
                                  >
                                    Eliminar
                                  </Button>
                                )}
                              </div>
                            </div>

                            <hr />

                            {/* ✅ Vista agregada */}
                            {isAg ? (
                              <Row className="g-2">
                                <Col md={8}>
                                  <div className="mb-2">
                                    <div className="fw-semibold">Resumen estadístico</div>
                                    <div className="text-muted">
                                      Total censados: <b>{st?.total_informes ?? "-"}</b> · Respondidas:{" "}
                                      <b>{st?.respondidas ?? "-"}</b> · Vacías: <b>{st?.vacias ?? "-"}</b>
                                    </div>
                                  </div>

                                  {st?.distribucion && Object.keys(st.distribucion).length ? (
                                    <Card className="mb-2">
                                      <Card.Body className="py-2">
                                        <div className="fw-semibold mb-1">Distribución</div>
                                        <div className="d-flex flex-wrap gap-2">
                                          {Object.entries(st.distribucion)
                                            .sort((a, b) => (b[1] || 0) - (a[1] || 0))
                                            .slice(0, 10)
                                            .map(([k, v]) => (
                                              <Badge key={k} bg="light" text="dark">
                                                {k}: {v}
                                              </Badge>
                                            ))}
                                        </div>
                                      </Card.Body>
                                    </Card>
                                  ) : (
                                    <div className="text-muted mb-2">Sin distribución disponible.</div>
                                  )}

                                  {Array.isArray(st?.ejemplos) && st.ejemplos.length ? (
                                    <Card className="mb-2">
                                      <Card.Body className="py-2">
                                        <div className="fw-semibold mb-1">Ejemplos (muestras)</div>
                                        <ul className="mb-0">
                                          {st.ejemplos.slice(0, 6).map((x, idx) => (
                                            <li key={idx} className="text-muted">
                                              {x}
                                            </li>
                                          ))}
                                        </ul>
                                      </Card.Body>
                                    </Card>
                                  ) : null}

                                  <Form.Label className="mb-1">
                                    Texto de análisis / conclusión (editable)
                                  </Form.Label>
                                  <Form.Control
                                    as="textarea"
                                    rows={6}
                                    value={String(b.contenido?.texto ?? "")}
                                    onChange={(e) =>
                                      updateBloque(b.id_bloque, {
                                        contenido: { ...ensureObjContenido(b.contenido), texto: e.target.value },
                                      })
                                    }
                                    placeholder="Ej: Se observa una tendencia a..., se recomienda..."
                                  />
                                </Col>

                                <Col md={4}>
                                  <Form.Label className="mb-1">Observación / comentario</Form.Label>
                                  <Form.Control
                                    as="textarea"
                                    rows={6}
                                    value={String(b.contenido?.obs ?? "")}
                                    onChange={(e) =>
                                      updateBloque(b.id_bloque, {
                                        contenido: { ...ensureObjContenido(b.contenido), obs: e.target.value },
                                      })
                                    }
                                    placeholder="Observación técnica..."
                                  />

                                  <div className="mt-2">
                                    <Form.Label className="mb-1">Orden</Form.Label>
                                    <InputGroup>
                                      <Form.Control
                                        type="number"
                                        value={b.orden ?? 1}
                                        onChange={(e) =>
                                          updateBloque(b.id_bloque, { orden: Number(e.target.value || 1) })
                                        }
                                      />
                                    </InputGroup>
                                  </div>
                                </Col>
                              </Row>
                            ) : (
                              /* ✅ modo normal */
                              <Row className="g-2">
                                <Col md={8}>
                                  <Form.Label className="mb-1">Respuesta / contenido</Form.Label>

                                  {b.tipo === "texto" ? (
                                    <Form.Control
                                      as="textarea"
                                      rows={6}
                                      value={String(b.contenido?.texto ?? "")}
                                      onChange={(e) =>
                                        updateBloque(b.id_bloque, {
                                          contenido: { ...ensureObjContenido(b.contenido), texto: e.target.value },
                                        })
                                      }
                                      placeholder="Escribí texto del reporte..."
                                    />
                                  ) : (
                                    <Form.Control
                                      as="textarea"
                                      rows={6}
                                      value={toEditableString(b.contenido?.respuesta)}
                                      onChange={(e) =>
                                        updateBloque(b.id_bloque, {
                                          contenido: {
                                            ...ensureObjContenido(b.contenido),
                                            respuesta: e.target.value,
                                          },
                                        })
                                      }
                                      placeholder="Respuesta (texto o JSON)"
                                    />
                                  )}
                                </Col>

                                <Col md={4}>
                                  <Form.Label className="mb-1">Observación / comentario</Form.Label>
                                  <Form.Control
                                    as="textarea"
                                    rows={6}
                                    value={String(b.contenido?.obs ?? "")}
                                    onChange={(e) =>
                                      updateBloque(b.id_bloque, {
                                        contenido: { ...ensureObjContenido(b.contenido), obs: e.target.value },
                                      })
                                    }
                                    placeholder="Observación técnica..."
                                  />

                                  <div className="mt-2">
                                    <Form.Label className="mb-1">Orden</Form.Label>
                                    <InputGroup>
                                      <Form.Control
                                        type="number"
                                        value={b.orden ?? 1}
                                        onChange={(e) =>
                                          updateBloque(b.id_bloque, { orden: Number(e.target.value || 1) })
                                        }
                                      />
                                    </InputGroup>
                                  </div>
                                </Col>
                              </Row>
                            )}
                          </Card.Body>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </Accordion.Body>
            </Accordion.Item>
          );
        })}
      </Accordion>

      {assets?.length ? (
        <Card className="mt-3">
          <Card.Body>
            <div className="fw-semibold mb-2">Assets (imágenes del reporte)</div>
            <div className="text-muted">
              (La carga de imágenes la agregamos en el siguiente paso con un endpoint /upload)
            </div>
          </Card.Body>
        </Card>
      ) : null}
    </div>
  );
}
