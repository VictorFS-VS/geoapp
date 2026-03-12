// src/pages/EditarProyecto.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Button, Row, Col, Container } from 'react-bootstrap';
import ProyectoTramosManager from '@/components/gv/ProyectoTramosManager';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const API_URL = BASE.endsWith('/api') ? BASE : BASE + '/api';

export default function EditarProyecto() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  const [formData, setFormData] = useState({
    nro_expediente: '',
    codigo: '',
    nombre: '',
    estado: '',
    tipo_estudio: '',
    tipo_proyecto: '',
    actividad: '',
    id_consultor: '',
    id_proponente: '',
    sector: '',
    fecha_inicio: '',
    fecha_final: '',
    fecha_registro: '',
    expediente_hidrico: '',
    coordenada_x: '',
    coordenada_y: '',
    departamento: '',
    distrito: '',
    barrio: '',
    descripcion: '',
    padron: '',
    cta_cte: '',
    finca: '',
    matricula: '',
    geom: '',
    catastro_target_total: ''
  });

  const [tiposEstudio, setTiposEstudio] = useState([]);
  const [tiposProyecto, setTiposProyecto] = useState([]);
  const [actividades, setActividades] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [proponentes, setProponentes] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [estados, setEstados] = useState([]);

  const [archivo, setArchivo] = useState(null);
  const [documentos, setDocumentos] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [nuevaActividad, setNuevaActividad] = useState('');

  // 1️⃣ Carga datos del proyecto
  const fetchProyecto = async () => {
    try {
      const res = await fetch(`${API_URL}/proyectos/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo cargar el proyecto');
      const data = await res.json();

      setFormData(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v == null ? '' : v])
        ),
        fecha_inicio: data.fecha_inicio?.split('T')[0] || '',
        fecha_final: data.fecha_final?.split('T')[0] || '',
        fecha_registro: data.fecha_registro?.split('T')[0] || '',
        sector: data.sector_proyecto || '',
        coordenada_x: data.coor_x || '',
        coordenada_y: data.coor_y || '',
        departamento: data.dpto || '',
        catastro_target_total: data.catastro_target_total != null ? String(data.catastro_target_total) : ''
      }));
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  // 2️⃣ Carga documentos existentes
  const fetchDocumentos = async () => {
    try {
      const res = await fetch(`${API_URL}/documentos/listar/${id}/otros`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo cargar documentos');
      const data = await res.json();
      setDocumentos(Array.isArray(data) ? data : []);
    } catch {
      setDocumentos([]);
    }
  };

  // 3️⃣ useEffect inicial: datos + selects
  useEffect(() => {
    fetchProyecto();
    fetchDocumentos();

    const headers = { Authorization: `Bearer ${token}` };
    const safeJson = async (res) => {
      const j = await res.json().catch(() => []);
      return Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : []);
    };

    Promise.all([
      fetch(`${API_URL}/conceptos/tipo-estudio`, { headers }).then(safeJson).then(setTiposEstudio),
      fetch(`${API_URL}/conceptos/tipo-proyecto`, { headers }).then(safeJson).then(setTiposProyecto),
      fetch(`${API_URL}/conceptos/actividad`, { headers }).then(safeJson).then(setActividades),
      fetch(`${API_URL}/conceptos/sector-proyecto`, { headers }).then(safeJson).then(setSectores),
      fetch(`${API_URL}/conceptos/proyecto-estado`, { headers }).then(safeJson).then(setEstados),
      fetch(`${API_URL}/consultores`, { headers })
        .then(r => r.json().catch(() => ({}))).then(d => setConsultores(Array.isArray(d?.data) ? d.data : [])),
      fetch(`${API_URL}/proponentes/dropdown`, { headers })
        .then(r => r.json().catch(() => ({}))).then(d => setProponentes(Array.isArray(d?.data) ? d.data : []))
    ]).catch(() => { /* silently ignore network errors */ });
  }, [id, token]);

  // Manejo general de inputs
  const handleChange = e => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // 4️⃣ Submit de edición
  const handleSubmit = async e => {
    e.preventDefault();
    try {
      const payload = {
        nombre: formData.nombre || null,
        codigo: formData.codigo || null,
        descripcion: formData.descripcion || null,
        expediente_hidrico: formData.expediente_hidrico || null,
        fecha_inicio: formData.fecha_inicio || null,
        fecha_final: formData.fecha_final || null,
        fecha_registro: formData.fecha_registro || null,
        tipo_estudio: formData.tipo_estudio || null,
        tipo_proyecto: formData.tipo_proyecto || null,
        actividad: formData.actividad || null,
        estado: formData.estado || null,
        id_consultor: formData.id_consultor ? parseInt(formData.id_consultor) : null,
        id_proponente: formData.id_proponente ? parseInt(formData.id_proponente) : null,
        sector_proyecto: formData.sector ? parseInt(formData.sector) : null,
        coor_x: formData.coordenada_x ? parseFloat(formData.coordenada_x) : null,
        coor_y: formData.coordenada_y ? parseFloat(formData.coordenada_y) : null,
        dpto: formData.departamento || null,
        distrito: formData.distrito || null,
        barrio: formData.barrio || null,
        padron: formData.padron ? parseInt(formData.padron) : null,
        cta_cte: formData.cta_cte || null,
        finca: formData.finca || null,
        matricula: formData.matricula || null,
        catastro_target_total: formData.catastro_target_total !== '' ? Number(formData.catastro_target_total) : null,
        geom: formData.geom || null
      };

      const res = await fetch(`${API_URL}/proyectos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Proyecto actualizado');
      navigate('/proyectos');
    } catch (err) {
      console.error(err);
      alert('Error al actualizar el proyecto');
    }
  };

  // 5️⃣ Subida de documento (express-fileupload)
  const subirDocumento = async () => {
    if (!archivo) return alert('Debe seleccionar un archivo');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('tipo_documento', 'otros');

      const res = await fetch(`${API_URL}/documentos/upload/${id}/otros`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message);
      alert(json.message || 'Documento subido');
      setArchivo(null);
      fetchDocumentos();
    } catch (err) {
      console.error(err);
      alert('Error al subir documento');
    }
  };

  // 6️⃣ Eliminación de documento
  const eliminarDocumento = async idArchivo => {
    if (!window.confirm('¿Eliminar este documento?')) return;
    try {
      const res = await fetch(`${API_URL}/documentos/eliminar/${idArchivo}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(await res.text());
      fetchDocumentos();
    } catch (err) {
      console.error(err);
      alert('Error al eliminar el documento');
    }
  };

  // (Opcional) lógica para añadir nueva actividad
  const agregarActividad = async () => {
    if (!nuevaActividad.trim()) return alert('Ingrese un nombre válido');
    try {
      const nuevoCodigo = (
        Math.max(...actividades.map(a => parseInt(a.concepto))) + 1
      ).toString();
      const nueva = {
        concepto: nuevoCodigo,
        nombre: nuevaActividad,
        tipoconcepto: 'ACTIVIDAD'
      };
      const res = await fetch(`${API_URL}/conceptos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nueva)
      });
      if (!res.ok) throw new Error(await res.text());
      setActividades(prev => [...prev, nueva]);
      setFormData(prev => ({ ...prev, actividad: nueva.concepto }));
      setNuevaActividad('');
      setShowModal(false);
      alert('Actividad añadida');
    } catch (err) {
      console.error(err);
      alert('Error al guardar actividad');
    }
  };

  // 1️⃣ Función para descargar
  const descargarDocumento = async (nombre) => {
    try {
      const res = await fetch(
        `${API_URL}/documentos/descargar/${id}/otros/${encodeURIComponent(nombre)}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!res.ok) throw new Error('No autorizado o archivo no existe');

      // Lee el blob del response
      const blob = await res.blob();
      // Crea URL temporal
      const url = window.URL.createObjectURL(blob);
      // Crea un enlace y simula click
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  return (
    <Container className="mt-5">
      <h2 className="mb-4">Editar Proyecto</h2>
      <Form onSubmit={handleSubmit}>

        {/* Primer bloque: expediente, estudio */}
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Nro Expediente</Form.Label>
              <Form.Control
                name="nro_expediente"
                value={formData.nro_expediente}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Tipo de Estudio</Form.Label>
              <Form.Select
                name="tipo_estudio"
                value={formData.tipo_estudio}
                onChange={handleChange}
              >
                <option value="">Seleccione Tipo Estudio</option>
                {tiposEstudio.map((t, i) => (
                  <option key={t.concepto} value={t.concepto}>
                    {t.concepto} - {t.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        {/* Código y tipo de proyecto */}
        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Código</Form.Label>
              <Form.Control
                name="codigo"
                value={formData.codigo}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Tipo de Proyecto</Form.Label>
              <Form.Select
                name="tipo_proyecto"
                value={formData.tipo_proyecto}
                onChange={handleChange}
              >
                <option value="">Seleccione Tipo Proyecto</option>
                {tiposProyecto.map(t => (
                  <option key={t.concepto} value={t.concepto}>
                    {t.concepto} - {t.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        {/* Nombre y actividad */}
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Nombre del Proyecto</Form.Label>
              <Form.Control
                name="nombre"
                value={formData.nombre}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Actividad</Form.Label>
              <div className="d-flex">
                <Form.Select
                  name="actividad"
                  value={formData.actividad}
                  onChange={handleChange}
                  className="me-2"
                >
                  <option value="">Seleccione Actividad</option>
                  {actividades.map(a => (
                    <option key={a.concepto} value={a.concepto}>
                      {a.concepto} - {a.nombre}
                    </option>
                  ))}
                </Form.Select>
                <Button variant="success" onClick={() => setShowModal(true)}>
                  + Añadir
                </Button>
              </div>
            </Form.Group>
          </Col>
        </Row>

        {/* Estado, consultor, proponente */}
        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Estado</Form.Label>
              <Form.Select
                name="estado"
                value={formData.estado}
                onChange={handleChange}
              >
                <option value="">Seleccione Estado</option>
                {estados.map(e => (
                  <option key={e.concepto} value={e.concepto}>
                    {e.concepto} - {e.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Consultor</Form.Label>
              <Form.Select
                name="id_consultor"
                value={formData.id_consultor}
                onChange={handleChange}
              >
                <option value="">Seleccione Consultor</option>
                {consultores.map(c => (
                  <option key={c.id_consultor} value={c.id_consultor}>
                    {c.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Proponente</Form.Label>
              <Form.Select
                name="id_proponente"
                value={formData.id_proponente}
                onChange={handleChange}
              >
                <option value="">Seleccione Proponente</option>
                {proponentes.map(p => (
                  <option key={p.id_proponente} value={p.id_proponente}>
                    {p.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        </Row>

        {/* Sector y fechas */}
        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Sector</Form.Label>
              <Form.Select
                name="sector"
                value={formData.sector}
                onChange={handleChange}
              >
                <option value="">Seleccione Sector</option>
                {sectores.map(s => (
                  <option key={s.concepto} value={s.concepto}>
                    {s.concepto} - {s.nombre}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Fecha Inicio</Form.Label>
              <Form.Control
                type="date"
                name="fecha_inicio"
                value={formData.fecha_inicio}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Fecha Final</Form.Label>
              <Form.Control
                type="date"
                name="fecha_final"
                value={formData.fecha_final}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        {/* Registro y expediente hídrico */}
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Fecha Registro</Form.Label>
              <Form.Control
                type="date"
                name="fecha_registro"
                value={formData.fecha_registro}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Expediente Hídrico</Form.Label>
              <Form.Control
                name="expediente_hidrico"
                value={formData.expediente_hidrico}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        {/* Coordenadas */}
        <Row className="mb-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>Coordenada X</Form.Label>
              <Form.Control
                name="coordenada_x"
                value={formData.coordenada_x}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Coordenada Y</Form.Label>
              <Form.Control
                name="coordenada_y"
                value={formData.coordenada_y}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        {/* Ubicación */}
        <Row className="mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Departamento</Form.Label>
              <Form.Control
                name="departamento"
                value={formData.departamento}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Distrito</Form.Label>
              <Form.Control
                name="distrito"
                value={formData.distrito}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Barrio</Form.Label>
              <Form.Control
                name="barrio"
                value={formData.barrio}
                onChange={handleChange}
              />
            </Form.Group>
          </Col>
        </Row>

        {/* Descripción */}
        <Form.Group className="mb-3">
          <Form.Label>Descripción</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            name="descripcion"
            value={formData.descripcion}
            onChange={handleChange}
          />
        </Form.Group>

        {/* Información catastral */}
        <fieldset className="border p-3 mb-3">
          <legend className="w-auto px-2">Información Catastral</legend>
          <Row>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Padrón</Form.Label>
                <Form.Control
                  name="padron"
                  value={formData.padron}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Cta. Cte.</Form.Label>
                <Form.Control
                  name="cta_cte"
                  value={formData.cta_cte}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Finca</Form.Label>
                <Form.Control
                  name="finca"
                  value={formData.finca}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Matrícula</Form.Label>
                <Form.Control
                  name="matricula"
                  value={formData.matricula}
                  onChange={handleChange}
                />
              </Form.Group>
            </Col>
          </Row>
        </fieldset>

        {/* Botones */}
        <div className="d-flex justify-content-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/proyectos')}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit">
            Guardar
          </Button>
        </div>
      </Form>

      {/* Documentos */}
      <div className="mt-5">
        <h4>📁 Documentación</h4>
        <div className="mb-3">
          <Form.Label>Subir archivo</Form.Label>
          <Form.Control type="file" onChange={e => setArchivo(e.target.files[0])} />
          <Button className="mt-2" onClick={subirDocumento}>
            Subir
          </Button>
        </div>
        <table className="table table-bordered">
          <thead>
            <tr><th>Nombre</th><th>Acción</th></tr>
          </thead>
          <tbody>
            {documentos.map(doc => (
              <tr key={doc.id_archivo}>
                <td>{doc.nombre_archivo}</td>
                <td>
                  <Button
                    size="sm"
                    variant="outline-success"
                    className="me-2"
                    onClick={() => descargarDocumento(doc.nombre_archivo)}
                  >
                    Descargar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => eliminarDocumento(doc.id_archivo)}
                  >
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5">
        <ProyectoTramosManager
          idProyecto={Number(id)}
          total={formData.catastro_target_total}
          onTotalChange={(value) =>
            setFormData((prev) => ({
              ...prev,
              catastro_target_total: value === null ? "" : String(value)
            }))
          }
        />
      </div>

      {/* Modal Nueva Actividad */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Nueva Actividad</h5>
                <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <Form.Group>
                  <Form.Label>Nombre</Form.Label>
                  <Form.Control
                    value={nuevaActividad}
                    onChange={e => setNuevaActividad(e.target.value)}
                    placeholder="Ingrese nombre de actividad"
                  />
                </Form.Group>
              </div>
              <div className="modal-footer">
                <Button variant="secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={agregarActividad}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}
