import React, { useState, useEffect, useMemo } from "react";
import { Card, Button, Form, Row, Col, Spinner, Alert, Accordion, Badge, Modal } from "react-bootstrap";
import { alerts } from "@/utils/alerts";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

export default function ProyectoTramosManager({ idProyecto, total = null, onTotalChange = () => {} }) {
    const rawToken = localStorage.getItem("token");
    const bearer = rawToken ? (rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`) : null;
    const auth = bearer ? { headers: { Authorization: bearer } } : {};

    const [tramos, setTramos] = useState([]);
    const [catalogoVial, setCatalogoVial] = useState([]);
    const [proyectoTotal, setProyectoTotal] = useState(null);
    const [proyectoTotalInput, setProyectoTotalInput] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [showWarn, setShowWarn] = useState(false);
    const [warnItems, setWarnItems] = useState([]);

    useEffect(() => {
        if (!idProyecto) return;
        cargarDatos();
        // eslint-disable-next-line
    }, [idProyecto]);

    useEffect(() => {
        const value =
            total === null || total === undefined || total === ""
                ? null
                : Number(total);
        const numeric = Number.isFinite(value) ? value : null;
        setProyectoTotal(numeric);
        setProyectoTotalInput(numeric !== null ? String(numeric) : "");
    }, [total]);

    const cargarDatos = async () => {
        setLoading(true);
        setErrorMsg("");
        try {
            const [resJerarquia, resCatalogo] = await Promise.all([
                fetch(`${API_URL}/proyectos/${idProyecto}/jerarquia-tramos`, auth),
                fetch(`${API_URL}/vial/tramos-catalogo`, auth)
            ]);

            if (!resJerarquia.ok) throw new Error("Error al cargar la jerarquía de tramos");

            const jerarquiaJson = await resJerarquia.json();
            setTramos(jerarquiaJson.tramos || []);

            if (resCatalogo.ok) {
                const catJson = await resCatalogo.json();
                setCatalogoVial(catJson.items || []);
            }
        } catch (err) {
            console.error(err);
            setErrorMsg(err.message || "Error de red al cargar tramos");
        } finally {
            setLoading(false);
        }
    };

    const doGuardar = async () => {
        setSaving(true);
        setErrorMsg("");
        try {
            alerts.loading("Guardando tramos...");
            const res = await fetch(`${API_URL}/proyectos/${idProyecto}/jerarquia-tramos`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...auth.headers },
                body: JSON.stringify({
                    tramos,
                    catastro_target_total: toNum(proyectoTotalInput)
                })
            });

            const data = await res.json().catch(() => ({}));
            alerts.close();

            if (!res.ok) throw new Error(data.message || "Error al guardar tramos");

            setTramos(data.tramos || []);
            alerts.toast.success("Tramos y subtramos guardados correctamente");
        } catch (err) {
            alerts.close();
            console.error(err);
            setErrorMsg(err.message || "Error al guardar");
            alerts.toast.error("No se pudieron guardar los tramos");
        } finally {
            setSaving(false);
        }
    };

    // --- Helpers locales ---
    const generateTempId = () => `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const agregarTramo = () => {
        setTramos(prev => [
            ...prev,
            {
                id_proyecto_tramo: generateTempId(),
                descripcion: "",
                cantidad_universo: "",
                id_vial_tramo: "",
                orden: 0,
                subtramos: []
            }
        ]);
    };

    const eliminarTramo = (tId) => {
        if (!window.confirm("¿Seguro que desea eliminar este tramo y todos sus subtramos?")) return;
        setTramos(prev => prev.filter(t => t.id_proyecto_tramo !== tId));
    };

    const actualizarTramoLocally = (tId, field, value) => {
        setTramos(prev => prev.map(t => {
            if (t.id_proyecto_tramo === tId) {
                return { ...t, [field]: value };
            }
            return t;
        }));
    };

    const agregarSubtramo = (tId) => {
        setTramos(prev => prev.map(t => {
            if (t.id_proyecto_tramo === tId) {
                return {
                    ...t,
                    subtramos: [
                        ...(t.subtramos || []),
                        {
                            id_proyecto_subtramo: generateTempId(),
                            descripcion: "",
                            cantidad_universo: "",
                            orden: 0
                        }
                    ]
                };
            }
            return t;
        }));
    };

    const eliminarSubtramo = (tId, sId) => {
        if (!window.confirm("¿Seguro que desea eliminar este subtramo?")) return;
        setTramos(prev => prev.map(t => {
            if (t.id_proyecto_tramo === tId) {
                return {
                    ...t,
                    subtramos: (t.subtramos || []).filter(s => s.id_proyecto_subtramo !== sId)
                };
            }
            return t;
        }));
    };

    const actualizarSubtramoLocally = (tId, sId, field, value) => {
        setTramos(prev => prev.map(t => {
            if (t.id_proyecto_tramo === tId) {
                return {
                    ...t,
                    subtramos: (t.subtramos || []).map(s => {
                        if (s.id_proyecto_subtramo === sId) {
                            return { ...s, [field]: value };
                        }
                        return s;
                    })
                };
            }
            return t;
        }));
    };

    const setTramoUniversoFromSubs = (tId) => {
        setTramos(prev => prev.map(t => {
            if (t.id_proyecto_tramo !== tId) return t;
            const suma = sumSubtramos(t.subtramos || []);
            if (suma === null) return t;
            return { ...t, cantidad_universo: suma };
        }));
    };

    const applyAllTramosFromSubs = () => {
        let next = null;
        setTramos(prev => {
            next = prev.map(t => {
                const suma = sumSubtramos(t.subtramos || []);
                if (suma === null) return t;
                return { ...t, cantidad_universo: suma };
            });
            return next;
        });
        return next;
    };

    const recalcProyectoTotal = async (value) => {
        const total = toNum(value);
        if (total === null) {
            alerts.toast.error("No hay valores numericos para recalcular el total");
            return;
        }
        setProyectoTotal(total);
        setProyectoTotalInput(String(total));
        onTotalChange(total);
        try {
            await fetch(`${API_URL}/proyectos/${idProyecto}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...auth.headers },
                body: JSON.stringify({ catastro_target_total: total })
            });
            alerts.toast.success("Total del proyecto actualizado");
        } catch (err) {
            console.error(err);
            alerts.toast.error("No se pudo actualizar el total del proyecto");
        }
    };

    const toNum = (v) => {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const sumSubtramos = (subs) => {
        const nums = (subs || []).map(s => toNum(s.cantidad_universo)).filter(n => n !== null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    };

    const sumTramos = useMemo(() => {
        const nums = tramos.map(t => toNum(t.cantidad_universo)).filter(n => n !== null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    }, [tramos]);

    const diffLabel = (a, b) => {
        if (a === null || b === null) return null;
        return a - b;
    };

    const badgeForDiff = (diff) => {
        if (diff === null) return <Badge bg="secondary">Sin dato</Badge>;
        if (diff === 0) return <Badge bg="success">OK</Badge>;
        return <Badge bg="warning" text="dark">Diferencia</Badge>;
    };

    const buildInconsistencias = () => {
        const issues = [];
        const totalTramos = sumTramos;
        if (proyectoTotal !== null && totalTramos !== null && proyectoTotal !== totalTramos) {
            issues.push({
                key: "proyecto",
                title: "Proyecto",
                esperado: proyectoTotal,
                calculado: totalTramos
            });
        }

        for (const t of tramos) {
            const tEsperado = toNum(t.cantidad_universo);
            const tCalc = sumSubtramos(t.subtramos || []);
            if (tEsperado !== null && tCalc !== null && tEsperado !== tCalc) {
                issues.push({
                    key: `tramo-${t.id_proyecto_tramo}`,
                    title: t.descripcion || "Tramo sin nombre",
                    esperado: tEsperado,
                    calculado: tCalc
                });
            }
        }
        return issues;
    };

    const handleGuardar = () => {
        const issues = buildInconsistencias();
        if (issues.length) {
            setWarnItems(issues);
            setShowWarn(true);
            return;
        }
        doGuardar();
    };

    if (loading) {
        return (
            <div className="py-4 text-center">
                <Spinner animation="border" role="status" size="sm" />
                <span className="ms-2">Cargando jerarquía de tramos...</span>
            </div>
        );
    }

    return (
        <div className="mt-5 mb-5" data-testid="gv-proyecto-tramos-manager">
            <Modal show={showWarn} onHide={() => setShowWarn(false)} centered>
                <Modal.Header closeButton>
                    <Modal.Title>Inconsistencias detectadas</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="mb-2">
                        Existen diferencias entre los valores cargados y las sumas por nivel.
                        Podés volver a modificar o guardar de todos modos.
                    </p>
                    <ul className="small mb-0">
                        {warnItems.map((it) => (
                            <li key={it.key}>
                                <strong>{it.title}:</strong> esperado {it.esperado} vs suma {it.calculado}
                            </li>
                        ))}
                    </ul>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowWarn(false)}>
                        Volver a modificar
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => {
                            setShowWarn(false);
                            doGuardar();
                        }}
                    >
                        Continuar y guardar
                    </Button>
                </Modal.Footer>
            </Modal>

            <hr className="my-5" />
            <div className="d-flex justify-content-between align-items-center mb-3">
                <h4 className="mb-0">🛣️ Tramos y Subtramos</h4>
                <div className="d-flex gap-2">
                    <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => recalcProyectoTotal(sumTramos)}
                        disabled={sumTramos === null || saving}
                    >
                        Recalcular total proyecto
                    </Button>
                    <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                            const next = applyAllTramosFromSubs();
                            if (next) {
                                const nums = next.map(t => toNum(t.cantidad_universo)).filter(n => n !== null);
                                const total = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
                                if (total !== null) recalcProyectoTotal(total);
                            }
                        }}
                        disabled={saving}
                    >
                        Recalcular todo desde subtramos
                    </Button>
                    <Button variant="success" size="sm" onClick={agregarTramo}>
                        + Agregar Tramo
                    </Button>
                </div>
            </div>

            {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

            <Card className="border-0 shadow-sm mb-3">
                <Card.Body className="py-2">
                    <Row className="align-items-center">
                        <Col md={4}>
                            <div className="small text-muted">Total esperado del proyecto</div>
                            <Form.Control
                                size="sm"
                                type="number"
                                value={proyectoTotalInput}
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    const numeric = toNum(raw);
                                    setProyectoTotalInput(raw);
                                    setProyectoTotal(numeric);
                                    onTotalChange(numeric);
                                }}
                                placeholder="Total esperado"
                            />
                        </Col>
                        <Col md={4}>
                            <div className="small text-muted">Suma actual de tramos</div>
                            <div className="fw-semibold">
                                {sumTramos !== null ? sumTramos : "—"}
                            </div>
                        </Col>
                        <Col md={4}>
                            <div className="small text-muted">Estado</div>
                            {badgeForDiff(diffLabel(proyectoTotal, sumTramos))}
                            {proyectoTotal !== null && sumTramos !== null ? (
                                <span className="ms-2 small text-muted">
                                    Diff: {diffLabel(proyectoTotal, sumTramos)}
                                </span>
                            ) : null}
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {!tramos.length ? (
                <Alert variant="info" className="text-center">
                    No hay tramos registrados para este proyecto. Pulse "Agregar Tramo" para comenzar.
                </Alert>
            ) : (
                <Accordion className="mb-4">
                    {tramos.map((tramo, tIndex) => {
                        const tId = tramo.id_proyecto_tramo;
                        const subs = tramo.subtramos || [];
                        const tramoUniverso = toNum(tramo.cantidad_universo);
                        const sumaSubs = sumSubtramos(subs);
                        const diffTramo = diffLabel(tramoUniverso, sumaSubs);

                        return (
                            <Accordion.Item eventKey={String(tIndex)} key={tId}>
                                <Accordion.Header>
                                    <div className="d-flex justify-content-between align-items-center w-100 pe-3">
                                        <span className="fw-bold">
                                            {tramo.descripcion || "Nuevo Tramo (Sin nombre)"}
                                        </span>
                                        <div className="d-flex gap-3 text-muted small align-items-center">
                                            {tramo.cantidad_universo ? <span>Universo: {tramo.cantidad_universo}</span> : null}
                                            <span>{subs.length} subtramo(s)</span>
                                            <span>Suma subtramos: {sumaSubs !== null ? sumaSubs : "—"}</span>
                                        </div>
                                    </div>
                                </Accordion.Header>
                                <Accordion.Body className="bg-light">
                                    <Card className="border-0 shadow-sm mb-3">
                                        <Card.Body>
                                            <Row className="mb-3">
                                                <Col md={5}>
                                                    <Form.Group>
                                                        <Form.Label className="small fw-semibold">Descripción del Tramo</Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            value={tramo.descripcion || ""}
                                                            onChange={e => actualizarTramoLocally(tId, "descripcion", e.target.value)}
                                                            placeholder="Ej: Tramo Principal Norte"
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={3}>
                                                    <Form.Group>
                                                        <Form.Label className="small fw-semibold">Cant. Universo</Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            value={tramo.cantidad_universo || ""}
                                                            onChange={e => actualizarTramoLocally(tId, "cantidad_universo", e.target.value)}
                                                            placeholder="1000"
                                                        />
                                                    </Form.Group>
                                                </Col>
                                                <Col md={4}>
                                                    <Form.Group>
                                                        <Form.Label className="small fw-semibold">Vial Tramo Asociado</Form.Label>
                                                        <Form.Select
                                                            size="sm"
                                                            value={tramo.id_vial_tramo || ""}
                                                            onChange={e => actualizarTramoLocally(tId, "id_vial_tramo", e.target.value)}
                                                        >
                                                            <option value="">Sin tramo vial</option>
                                                            {catalogoVial.map(c => (
                                                                <option key={c.id} value={c.id}>{c.descripcion}</option>
                                                            ))}
                                                        </Form.Select>
                                                    </Form.Group>
                                                </Col>
                                            </Row>
                                            <Row className="mb-2">
                                                <Col md={12} className="d-flex align-items-center gap-2">
                                                    <span className="small text-muted">Suma subtramos:</span>
                                                    <span className="fw-semibold">{sumaSubs !== null ? sumaSubs : "—"}</span>
                                                    {badgeForDiff(diffTramo)}
                                                    {tramoUniverso !== null && sumaSubs !== null ? (
                                                        <span className="small text-muted">Diff: {diffTramo}</span>
                                                    ) : null}
                                                </Col>
                                            </Row>
                                            <div className="text-end d-flex justify-content-end gap-2">
                                                <Button
                                                    variant="outline-primary"
                                                    size="sm"
                                                    onClick={() => {
                                                        if (sumaSubs === null) {
                                                            alerts.toast.error("No hay subtramos con universo para completar");
                                                            return;
                                                        }
                                                        setTramoUniversoFromSubs(tId);
                                                    }}
                                                >
                                                    Completar tramo desde subtramos
                                                </Button>
                                                <Button variant="outline-danger" size="sm" onClick={() => eliminarTramo(tId)}>
                                                    Eliminar Tramo
                                                </Button>
                                            </div>
                                        </Card.Body>
                                    </Card>

                                    {/* SUBTRAMOS */}
                                    <div className="px-2">
                                        <div className="d-flex justify-content-between align-items-center mb-2">
                                            <h6 className="mb-0 text-secondary">↳ Subtramos</h6>
                                            <Button variant="outline-success" size="sm" onClick={() => agregarSubtramo(tId)}>
                                                + Agregar Subtramo
                                            </Button>
                                        </div>

                                        {!subs.length ? (
                                            <div className="text-muted small fst-italic py-2">No hay subtramos.</div>
                                        ) : (
                                            subs.map((sub, sIndex) => {
                                                const sId = sub.id_proyecto_subtramo;
                                                return (
                                                    <Card key={sId} className="mb-2 border-primary border-opacity-25">
                                                        <Card.Body className="p-2">
                                                            <Row className="align-items-center">
                                                                <Col md={6}>
                                                                    <Form.Control
                                                                        size="sm"
                                                                        placeholder="Descripción Subtramo"
                                                                        value={sub.descripcion || ""}
                                                                        onChange={e => actualizarSubtramoLocally(tId, sId, "descripcion", e.target.value)}
                                                                    />
                                                                </Col>
                                                                <Col md={4}>
                                                                    <Form.Control
                                                                        size="sm"
                                                                        type="number"
                                                                        placeholder="Cant. Universo"
                                                                        value={sub.cantidad_universo || ""}
                                                                        onChange={e => actualizarSubtramoLocally(tId, sId, "cantidad_universo", e.target.value)}
                                                                    />
                                                                </Col>
                                                                <Col md={2} className="text-end">
                                                                    <Button variant="outline-danger" size="sm" onClick={() => eliminarSubtramo(tId, sId)} title="Eliminar subtramo">
                                                                        🗑️
                                                                    </Button>
                                                                </Col>
                                                            </Row>
                                                        </Card.Body>
                                                    </Card>
                                                );
                                            })
                                        )}
                                    </div>
                                </Accordion.Body>
                            </Accordion.Item>
                        );
                    })}
                </Accordion>
            )}

            {tramos.length > 0 && (
                <div className="d-flex justify-content-end mt-4">
                    <Button variant="primary" onClick={handleGuardar} disabled={saving}>
                        {saving ? <Spinner as="span" animation="border" size="sm" className="me-2" /> : "💾 "}
                        Guardar Jerarquía
                    </Button>
                </div>
            )}
        </div>
    );
}
