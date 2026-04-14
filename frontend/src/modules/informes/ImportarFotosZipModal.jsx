// c:\geoapp\geoapp\frontend\src\modules\informes\ImportarFotosZipModal.jsx
import React, { useState, useMemo } from "react";
import { Modal, Button, Form, Spinner, Row, Col, Alert } from "react-bootstrap";
import { BsCloudUpload, BsCheckCircleFill, BsExclamationTriangleFill, BsXCircleFill, BsFileEarmarkZipFill, BsTrash } from "react-icons/bs";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const ImportarFotosZipModal = ({ show, onHide, idProyecto, idPlantilla, preguntas = [] }) => {
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState({ keyFieldId: "", targetFieldId: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Filters for Selects
  const keyFields = useMemo(() => 
    preguntas.filter(p => ["texto", "numero", "id_unico", "textarea", "select"].includes(String(p.tipo || "").toLowerCase())), 
    [preguntas]
  );
  const targetFields = useMemo(() => 
    preguntas.filter(p => {
      const t = String(p.tipo || "").toLowerCase();
      return t === "imagen" || t === "foto" || t === "archivo" || p.permite_foto;
    }), 
    [preguntas]
  );

  const reset = () => {
    setFile(null);
    setMapping({ keyFieldId: "", targetFieldId: "" });
    setLoading(false);
    setResult(null);
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f && f.name.endsWith(".zip")) setFile(f);
  };

  const handleImport = async () => {
    if (!file || !mapping.keyFieldId || !mapping.targetFieldId) return;

    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("id_plantilla", idPlantilla);
    fd.append("id_campo_llave", mapping.keyFieldId);
    fd.append("id_campo_destino", mapping.targetFieldId);

    try {
      const resp = await axios.post(`${API_URL}/informes/proyecto/${idProyecto}/import-photos-zip`, fd, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setResult(resp.data);
    } catch (err) {
      console.error(err);
      alert("Error crítico durante la importación.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={loading ? null : onHide} centered size="lg" onExited={reset}>
      <Modal.Header closeButton={!loading} className="border-0 pb-0 px-4">
        <Modal.Title className="fw-bold pt-3">Importación Masiva de Fotos (ZIP)</Modal.Title>
      </Modal.Header>

      <Modal.Body className="p-4 px-5">
        {!result ? (
          <div className="progressive-flow">
            {/* STEP 1: DROPZONE */}
            <div className={`dropzone-container mb-4 ${file ? 'file-loaded' : ''}`}>
              {!file ? (
                <label className="d-flex flex-column align-items-center p-5 border border-2 border-dashed rounded-4 cursor-pointer hover-bg-light transition-all" style={{ borderStyle: 'dashed !important' }}>
                  <BsCloudUpload size={48} className="text-primary mb-3" />
                  <span className="fw-semibold">Haz clic para subir o arrastra tu archivo .zip</span>
                  <span className="text-muted small">Lotes recomendados de hasta 150 fotos</span>
                  <input type="file" className="d-none" accept=".zip" onChange={handleFileChange} />
                </label>
              ) : (
                <div className="d-flex align-items-center p-4 bg-light rounded-4 border">
                  <BsFileEarmarkZipFill size={32} className="text-warning me-3" />
                  <div className="flex-grow-1">
                    <div className="fw-bold">{file.name}</div>
                    <div className="text-muted small">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                  <Button variant="link" className="text-danger" onClick={() => setFile(null)}>
                    <BsTrash size={20} />
                  </Button>
                </div>
              )}
            </div>

            {/* STEP 2: MAPPING (REVELACIÓN PROGRESIVA) */}
            {file && (
              <div className="mapping-container animate-fade-in mt-4">
                <hr className="my-4 opacity-10" />
                <h6 className="fw-bold mb-3">Configuración de Mapeo</h6>
                <Row>
                  <Col md={6} className="mb-3">
                    <Form.Label className="small text-muted fw-bold text-uppercase">Campo de búsqueda (Match)</Form.Label>
                    <Form.Select 
                      value={mapping.keyFieldId} 
                      onChange={e => setMapping(m => ({ ...m, keyFieldId: e.target.value }))}
                      className="form-control-lg border-2 shadow-sm"
                    >
                      <option value="">Selecciona campo...</option>
                      {keyFields.map(p => <option key={p.id_pregunta} value={p.id_pregunta}>{p.etiqueta}</option>)}
                    </Form.Select>
                    <div className="mt-1 text-muted small ms-1 italic">Pattern match en nombre de archivo (ID/Llave).</div>
                  </Col>
                  <Col md={6} className="mb-3">
                    <Form.Label className="small text-muted fw-bold text-uppercase">Campo destino (Fotos)</Form.Label>
                    <Form.Select 
                      value={mapping.targetFieldId} 
                      onChange={e => setMapping(m => ({ ...m, targetFieldId: e.target.value }))}
                      className="form-control-lg border-2 shadow-sm"
                    >
                      <option value="">Selecciona campo...</option>
                      {targetFields.map(p => <option key={p.id_pregunta} value={p.id_pregunta}>{p.etiqueta}</option>)}
                    </Form.Select>
                    <div className="mt-1 text-muted small ms-1 italic">Se guardará en ema.tumba y se concatenará aquí.</div>
                  </Col>
                </Row>
              </div>
            )}
          </div>
        ) : (
          /* STEP 3: RESULTS SCREEN */
          <div className="results-container text-center py-4 animate-scale-up">
            <h4 className="fw-bold mb-4">Resultado de la Importación</h4>
            <Row className="mb-4">
              <Col>
                <div className="p-3 bg-light rounded-4 border">
                  <BsCheckCircleFill className="text-success mb-2" size={24} />
                  <div className="h3 fw-bold m-0">{result.summary.matched}</div>
                  <div className="small text-muted fw-semibold">Matched</div>
                </div>
              </Col>
              <Col>
                <div className="p-3 bg-light rounded-4 border">
                  <BsExclamationTriangleFill className="text-warning mb-2" size={24} />
                  <div className="h3 fw-bold m-0">{result.summary.omitted_duplicates}</div>
                  <div className="small text-muted fw-semibold">Duplicados</div>
                </div>
              </Col>
              <Col>
                <div className="p-3 bg-light rounded-4 border">
                  <BsXCircleFill className="text-danger mb-2" size={24} />
                  <div className="h3 fw-bold m-0">{result.summary.orphans}</div>
                  <div className="small text-muted fw-semibold">Huérfanos</div>
                </div>
              </Col>
            </Row>

            <Alert variant="info" className="text-start rounded-4 border-0 bg-opacity-10 shadow-sm" style={{ backgroundColor: '#e7f3ff', color: '#0056b3' }}>
              <div className="small d-flex align-items-center">
                <i className="bi bi-info-circle-fill me-2"></i>
                <span>Se procesaron <b>{result.summary.total_files}</b> archivos. Las fotos ya son visibles en ema.tumba y el reporte.</span>
              </div>
            </Alert>

            <div className="text-end mt-5">
              <Button variant="outline-primary" className="fw-bold px-4 border-2" onClick={reset}>Importar otro ZIP</Button>
              <Button variant="primary" className="fw-bold px-4 ms-2 shadow-sm" onClick={onHide}>Finalizar y Cerrar</Button>
            </div>
          </div>
        )}
      </Modal.Body>

      {!result && (
        <Modal.Footer className="border-0 p-4 px-5 pt-0">
          <Button variant="link" className="text-muted text-decoration-none me-auto" onClick={onHide} disabled={loading}>Cancelar</Button>
          <Button 
            variant="primary" 
            onClick={handleImport} 
            disabled={loading || !file || !mapping.keyFieldId || !mapping.targetFieldId}
            className="px-5 py-2 fw-bold shadow-sm rounded-pill"
          >
            {loading ? <><Spinner animation="border" size="sm" className="me-2"/>Procesando...</> : "🚀 Iniciar Importación"}
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
};

export default ImportarFotosZipModal;
