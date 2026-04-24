import React, { useMemo, useState } from "react";
import { Modal, Button, Form, Alert, Spinner } from "react-bootstrap";
import Swal from "sweetalert2";

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  timer: 2600,
  showConfirmButton: false,
});

export default function ImportarExcelActualizarModal({
  show,
  onHide,
  idProyecto,
  idPlantilla,
  preguntas = [],
  secciones = [],
  API_URL,
  authHeaders,
  onImported,
}) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const [matchMode, setMatchMode] = useState("id_informe");
  const [excelMatchColumn, setExcelMatchColumn] = useState("id_informe");
  const [preguntaRef, setPreguntaRef] = useState("");

  const [destinationMode, setDestinationMode] = useState("nueva_pregunta");
  const [preguntaDestino, setPreguntaDestino] = useState("");
  const [seccionDestino, setSeccionDestino] = useState("");
  const [etiquetaNueva, setEtiquetaNueva] = useState("");
  const [tipoNuevaPregunta, setTipoNuevaPregunta] = useState("texto");

  const [columnas, setColumnas] = useState("");
  const [overwriteEmpty, setOverwriteEmpty] = useState(false);

  const preguntasNoImagen = useMemo(() => {
    return (preguntas || []).filter((p) => {
      const t = String(p?.tipo || "").trim().toLowerCase();
      return !["imagen", "foto", "galeria"].includes(t);
    });
  }, [preguntas]);

  const resetForm = () => {
    setFile(null);
    setLoading(false);
    setMatchMode("id_informe");
    setExcelMatchColumn("id_informe");
    setPreguntaRef("");
    setDestinationMode("nueva_pregunta");
    setPreguntaDestino("");
    setSeccionDestino("");
    setEtiquetaNueva("");
    setTipoNuevaPregunta("texto");
    setColumnas("");
    setOverwriteEmpty(false);
  };

  const closeModal = () => {
    if (loading) return;
    resetForm();
    onHide?.();
  };

  const handleSubmit = async () => {
    if (!file) {
      Toast.fire({ icon: "error", title: "Seleccioná un archivo Excel" });
      return;
    }

    const fileName = String(file?.name || "").toLowerCase().trim();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      Toast.fire({
        icon: "error",
        title: "Solo se permiten archivos .xlsx o .xls",
      });
      return;
    }

    if (!idProyecto || !idPlantilla) {
      Toast.fire({ icon: "error", title: "Falta proyecto o plantilla" });
      return;
    }

    if (!excelMatchColumn.trim()) {
      Toast.fire({ icon: "error", title: "Indicá la columna de cruce del Excel" });
      return;
    }

    const columnasList = columnas
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (!columnasList.length) {
      Toast.fire({ icon: "error", title: "Indicá al menos una columna a combinar" });
      return;
    }

    if (matchMode === "pregunta_referencia" && !preguntaRef) {
      Toast.fire({ icon: "error", title: "Seleccioná la pregunta referencia" });
      return;
    }

    if (destinationMode === "pregunta_existente" && !preguntaDestino) {
      Toast.fire({ icon: "error", title: "Seleccioná la pregunta destino" });
      return;
    }

    if (destinationMode === "nueva_pregunta") {
      if (!seccionDestino) {
        Toast.fire({ icon: "error", title: "Seleccioná la sección destino" });
        return;
      }
      if (!etiquetaNueva.trim()) {
        Toast.fire({ icon: "error", title: "Indicá el nombre de la nueva pregunta" });
        return;
      }
    }

    try {
      setLoading(true);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("match_mode", matchMode);
      formData.append("excel_match_column", excelMatchColumn.trim());

      if (matchMode === "pregunta_referencia") {
        formData.append("id_pregunta_referencia", String(preguntaRef));
      }

      formData.append("destination_mode", destinationMode);

      if (destinationMode === "pregunta_existente") {
        formData.append("id_pregunta_destino", String(preguntaDestino));
      } else {
        formData.append("id_seccion_destino", String(seccionDestino));
        formData.append("etiqueta_nueva_pregunta", etiquetaNueva.trim());
        formData.append("tipo_nueva_pregunta", tipoNuevaPregunta);
      }

      formData.append("excel_columns_source", JSON.stringify(columnasList));
      formData.append("overwrite_empty_only", overwriteEmpty ? "1" : "0");

      const headers = { ...(authHeaders?.() || {}) };
      delete headers["Content-Type"];
      delete headers["content-type"];

      const resp = await fetch(
        `${API_URL}/informes/proyecto/${idProyecto}/plantilla/${idPlantilla}/import-excel-update`,
        {
          method: "POST",
          headers,
          body: formData,
        }
      );

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        throw new Error(data.error || data.details || `Error ${resp.status}`);
      }

      await Swal.fire({
        icon: "success",
        title: "Importación completada",
        html: `
          <div style="text-align:left">
            <div><b>Informes plantilla:</b> ${data.total_informes_plantilla ?? 0}</div>
            <div><b>Filas Excel:</b> ${data.total_filas_excel ?? 0}</div>
            <div><b>Match encontrados:</b> ${data.total_match ?? 0}</div>
            <div><b>Actualizados:</b> ${data.total_actualizados ?? 0}</div>
            <div><b>No encontrados:</b> ${data.total_no_encontrados ?? 0}</div>
            <div><b>Omitidos por destino no vacío:</b> ${data.total_omitidos_destino_no_vacio ?? 0}</div>
            <hr />
            <div><b>Pregunta destino:</b> ${data?.pregunta_destino?.etiqueta || "-"}</div>
          </div>
        `,
      });

      onImported?.(data);
      closeModal();
    } catch (err) {
      console.error("Error importando Excel:", err);
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudo importar el Excel",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={closeModal} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Importar Excel y actualizar informes</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Alert variant="info" className="mb-3">
          Este proceso actualiza <b>todos los informes de la plantilla</b> usando una
          columna del Excel como referencia para encontrar el informe correcto.
        </Alert>

        <Form.Group className="mb-3">
          <Form.Label>Archivo Excel</Form.Label>
          <Form.Control
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="form-text">
            Se permiten archivos <b>.xlsx</b> y <b>.xls</b>.
          </div>
        </Form.Group>

        <div className="row g-3">
          <div className="col-md-6">
            <Form.Group>
              <Form.Label>Modo de cruce</Form.Label>
              <Form.Select
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value)}
              >
                <option value="id_informe">Por ID informe</option>
                <option value="pregunta_referencia">Por pregunta referencia</option>
              </Form.Select>
            </Form.Group>
          </div>

          <div className="col-md-6">
            <Form.Group>
              <Form.Label>Columna del Excel para cruce</Form.Label>
              <Form.Control
                type="text"
                value={excelMatchColumn}
                onChange={(e) => setExcelMatchColumn(e.target.value)}
                placeholder="Ej: id_informe, cedula, expediente"
              />
            </Form.Group>
          </div>

          {matchMode === "pregunta_referencia" && (
            <div className="col-12">
              <Form.Group>
                <Form.Label>Pregunta referencia</Form.Label>
                <Form.Select
                  value={preguntaRef}
                  onChange={(e) => setPreguntaRef(e.target.value)}
                >
                  <option value="">Seleccione una pregunta</option>
                  {preguntasNoImagen.map((p) => (
                    <option key={p.id_pregunta} value={p.id_pregunta}>
                      {p.etiqueta} (#{p.id_pregunta})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
          )}
        </div>

        <hr />

        <div className="row g-3">
          <div className="col-md-6">
            <Form.Group>
              <Form.Label>Destino</Form.Label>
              <Form.Select
                value={destinationMode}
                onChange={(e) => setDestinationMode(e.target.value)}
              >
                <option value="nueva_pregunta">Crear nueva pregunta</option>
                <option value="pregunta_existente">Usar pregunta existente</option>
              </Form.Select>
            </Form.Group>
          </div>

          {destinationMode === "pregunta_existente" ? (
            <div className="col-md-6">
              <Form.Group>
                <Form.Label>Pregunta destino</Form.Label>
                <Form.Select
                  value={preguntaDestino}
                  onChange={(e) => setPreguntaDestino(e.target.value)}
                >
                  <option value="">Seleccione una pregunta</option>
                  {preguntasNoImagen.map((p) => (
                    <option key={p.id_pregunta} value={p.id_pregunta}>
                      {p.etiqueta} (#{p.id_pregunta})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </div>
          ) : (
            <>
              <div className="col-md-6">
                <Form.Group>
                  <Form.Label>Sección destino</Form.Label>
                  <Form.Select
                    value={seccionDestino}
                    onChange={(e) => setSeccionDestino(e.target.value)}
                  >
                    <option value="">Seleccione una sección</option>
                    {secciones.map((s) => (
                      <option key={s.id_seccion} value={s.id_seccion}>
                        {s.titulo} (#{s.id_seccion})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-6">
                <Form.Group>
                  <Form.Label>Tipo nueva pregunta</Form.Label>
                  <Form.Select
                    value={tipoNuevaPregunta}
                    onChange={(e) => setTipoNuevaPregunta(e.target.value)}
                  >
                    <option value="texto">Texto</option>
                    <option value="numero">Número</option>
                    <option value="fecha">Fecha</option>
                    <option value="boolean">Booleano</option>
                    <option value="select">Select</option>
                    <option value="multiselect">Multiselect</option>
                    <option value="semaforo">Semáforo</option>
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-12">
                <Form.Group>
                  <Form.Label>Etiqueta de nueva pregunta</Form.Label>
                  <Form.Control
                    type="text"
                    value={etiquetaNueva}
                    onChange={(e) => setEtiquetaNueva(e.target.value)}
                    placeholder="Ej: Resultado combinado"
                  />
                </Form.Group>
              </div>
            </>
          )}
        </div>

        <hr />

        <Form.Group className="mb-3">
          <Form.Label>Columnas Excel a combinar</Form.Label>
          <Form.Control
            type="text"
            value={columnas}
            onChange={(e) => setColumnas(e.target.value)}
            placeholder="Ej: respuesta_1, respuesta_2, respuesta_3"
          />
          <div className="form-text">
            Se usará la <b>primera columna no vacía</b> entre las indicadas.
          </div>
        </Form.Group>

        <Form.Check
          type="switch"
          label="Actualizar solo si la pregunta destino está vacía"
          checked={overwriteEmpty}
          onChange={(e) => setOverwriteEmpty(e.target.checked)}
        />
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={closeModal} disabled={loading}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={loading}>
          {loading ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Importando...
            </>
          ) : (
            <>Importar Excel</>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}