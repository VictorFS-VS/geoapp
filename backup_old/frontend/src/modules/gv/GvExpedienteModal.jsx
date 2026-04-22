import React, { useEffect, useState } from "react";
import { Modal, Button, Row, Col, Badge, Spinner, Alert, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import { gvReadEtapas, gvReadDocs, gvInferTipo, gvReadExpediente } from "./gv_expediente_read";
import GvPhaseChip from "./GvPhaseChip";
import { resolveStageOrder, computePhaseMeta, isOk, humanizeKey } from "./gv_phase";

/**
 * GvExpedienteModal - Standalone modal for viewing expediente details.
 * No dependency on Expedientes.jsx.
 */
export default function GvExpedienteModal({ show, onHide, proyectoId, expedienteId, seedProps }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fullExp, setFullExp] = useState(null);
    const [etapas, setEtapas] = useState({});
    const [docsSummary, setDocsSummary] = useState(null);

    useEffect(() => {
        if (!show || !expedienteId) return;

        let isSubscribed = true;

        async function fetchAll() {
            try {
                setLoading(true);
                setError(null);

                const tipo = gvInferTipo(seedProps || {});

                const promises = [
                    gvReadDocs(expedienteId),
                    gvReadExpediente(expedienteId).catch(() => null)
                ];

                if (tipo) {
                    promises.push(gvReadEtapas(expedienteId, tipo));
                } else {
                    promises.push(Promise.resolve({}));
                }

                const [docs, exp, etap] = await Promise.all(promises);

                if (isSubscribed) {
                    setDocsSummary(docs);
                    setFullExp(exp);
                    setEtapas(etap || {});
                }
            } catch (err) {
                if (isSubscribed) setError("Error cargando detalles del expediente.");
            } finally {
                if (isSubscribed) setLoading(false);
            }
        }

        fetchAll();
        return () => { isSubscribed = false; };
    }, [show, expedienteId, seedProps]);

    const tipo = gvInferTipo(seedProps || {}) || (fullExp ? (String(fullExp.tipo_proyecto || "").toLowerCase().includes("terreno") ? "terreno" : "mejora") : "mejora");
    const stageKeys = resolveStageOrder(tipo);
    const phaseMeta = computePhaseMeta(etapas, stageKeys);

    return (
        <Modal show={show} onHide={onHide} size="lg" centered backdrop="static">
            <Modal.Header closeButton className="bg-light">
                <Modal.Title>
                    {seedProps?.codigo_exp ? `${seedProps.codigo_exp} — ` : ""}
                    Expediente #{expedienteId}
                </Modal.Title>
            </Modal.Header>

            <Modal.Body className="gv-modal-body" style={{ maxHeight: "75vh", overflowY: "auto" }}>
                {loading && !docsSummary ? (
                    <div className="text-center py-5">
                        <Spinner animation="border" variant="primary" />
                        <div className="mt-2 text-muted">Cargando datos...</div>
                    </div>
                ) : (
                    <>
                        {error && <Alert variant="danger">{error}</Alert>}

                        <Row className="mb-4 g-3">
                            <Col md={12}>
                                <div className="p-3 bg-white border rounded shadow-sm">
                                    <Row className="g-3">
                                        <Col sm={6}>
                                            <div className="gv-muted fw-bold">PROPIETARIO</div>
                                            <div className="fs-5">{fullExp?.propietario_nombre || seedProps?.propietario_nombre || "—"}</div>
                                        </Col>
                                        <Col sm={3}>
                                            <div className="gv-muted fw-bold">TRAMO</div>
                                            <div>{fullExp?.tramo || seedProps?.tramo || "—"}</div>
                                        </Col>
                                        <Col sm={3}>
                                            <div className="gv-muted fw-bold">SUBTRAMO</div>
                                            <div>{fullExp?.subtramo || seedProps?.subtramo || "—"}</div>
                                        </Col>
                                        <Col sm={6}>
                                            <div className="gv-muted fw-bold">TÉCNICO</div>
                                            <div>{fullExp?.tecnico || "—"}</div>
                                        </Col>
                                        <Col sm={6}>
                                            <div className="gv-muted fw-bold">FECHA RELEV.</div>
                                            <div>
                                                {fullExp?.fecha_relevamiento
                                                    ? String(fullExp.fecha_relevamiento).slice(0, 10)
                                                    : "—"}
                                            </div>
                                        </Col>
                                        <Col sm={6}>
                                            <div className="gv-muted fw-bold">TIPO</div>
                                            <Badge bg={tipo === "mejora" ? "info" : "warning"} className="text-dark">
                                                {tipo ? tipo.toUpperCase() : "DESCONOCIDO"}
                                            </Badge>
                                        </Col>
                                        <Col sm={6}>
                                            <div className="gv-muted fw-bold">FASE ACTUAL</div>
                                            <div className="d-flex align-items-center gap-2">
                                                <GvPhaseChip
                                                    phaseIndex={phaseMeta.faseIndex}
                                                    phaseTotal={phaseMeta.totalCount}
                                                    label={phaseMeta.faseLabel}
                                                />
                                                {phaseMeta.nextLabel && (
                                                    <span className="small">Siguiente: {phaseMeta.nextLabel}</span>
                                                )}
                                            </div>
                                        </Col>
                                    </Row>
                                </div>
                            </Col>
                        </Row>

                        <h6 className="mb-3 border-bottom pb-2">Estado de Carpetas (Etapas)</h6>
                        {!stageKeys.length ? (
                            <div className="text-muted small italic mb-4">No hay información de etapas para este tipo de expediente.</div>
                        ) : (
                            <Table size="sm" responsive className="mb-4 align-middle border rounded">
                                <thead className="table-light">
                                    <tr>
                                        <th className="text-center" style={{ width: 60 }}>OK</th>
                                        <th>Paso / Etapa</th>
                                        <th>Observación</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stageKeys.map(key => {
                                        const st = etapas[key] || { ok: false, obs: "" };
                                        const ok = isOk(st.ok);
                                        return (
                                            <tr key={key}>
                                                <td className="text-center">
                                                    {ok ? (
                                                        <span className="text-success fs-5">✓</span>
                                                    ) : (
                                                        <span className="text-muted opacity-50">○</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="fw-bold">{humanizeKey(key)}</div>
                                                </td>
                                                <td className="small text-muted fst-italic">
                                                    {st.obs || "—"}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        )}

                        <h6 className="mb-3 border-bottom pb-2">Documentación Cargada</h6>
                        <Row className="g-3 mb-2 text-center">
                            <Col xs={4}>
                                <div className="card p-2 bg-light border-0">
                                    <div className="gv-muted fw-bold">TOTAL</div>
                                    <div className="fs-4 fw-bold">{docsSummary?.totalFiles || 0}</div>
                                </div>
                            </Col>
                            <Col xs={4}>
                                <div className={`card p-2 border-0 ${docsSummary?.has_ci ? "bg-success text-white" : "bg-light text-muted"}`}>
                                    <div className="fw-bold">C.I.</div>
                                    <div className="fs-4">{docsSummary?.has_ci ? "✓" : "✖"}</div>
                                </div>
                            </Col>
                            <Col xs={4}>
                                <div className={`card p-2 border-0 ${docsSummary?.has_dbi ? "bg-success text-white" : "bg-light text-muted"}`}>
                                    <div className="fw-bold">DBI</div>
                                    <div className="fs-4">{docsSummary?.has_dbi ? "✓" : "✖"}</div>
                                </div>
                            </Col>
                        </Row>
                    </>
                )}
            </Modal.Body>

            <Modal.Footer className="bg-light gv-modal-footer">
                <Button variant="outline-secondary" onClick={onHide}>
                    Cerrar
                </Button>
                <Link
                    to={`/proyectos/${proyectoId}/expedientes?expId=${expedienteId}`}
                    className="btn btn-primary"
                    onClick={onHide}
                >
                    Ir al expediente completo
                </Link>
            </Modal.Footer>
        </Modal>
    );
}
