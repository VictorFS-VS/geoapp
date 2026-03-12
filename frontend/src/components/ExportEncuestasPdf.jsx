// src/components/ExportEncuestasPdf.jsx
// RUTAS BACKEND:
//  - GET /api/tramos/proyectos/:idProyecto/tramos
//  - GET /api/encuestas/proyecto/:idProyecto
//  - GET /api/encuestas/proyecto/:idProyecto/tramo/:idTramo
//    (opcional query) ?tipo=normal|especial
//
// Notas:
// - PDF: se genera en el frontend con jsPDF
// - Excel: requiere `npm i xlsx` (import dinámico)
//
// Alertas: usa el helper `alerts` (toast / confirm) como venís usando en el sistema.

import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Button, Form, Row, Col, Spinner } from "react-bootstrap";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { alerts } from "@/utils/alerts"; // ✅ NUEVO

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const API_URL = BASE.endsWith("/api") ? BASE : BASE + "/api";

// =============== Branding (opcional) ===============
const LOGO_DATAURL = null; // p.ej. "data:image/png;base64,AA...."
const BRAND_TITLE = "RED VIAL ESTRUCTURANTE_2025 | EMA GROUP";

// =============== Etiquetas legibles ===============
const HEADER_MAP = {
  // Identificación
  nombre_censista: "NOMBRE DEL CENSISTA",
  fecha_relevamiento: "FECHA DE RELEVAMIENTO",
  codigo: "CÓDIGO",
  tramo: "TRAMO",
  progresivas: "PROGRESIVAS",
  ciudad: "CIUDAD",
  barrio: "BARRIO",

  // Persona / hogar
  nombre_apellido: "NOMBRE Y APELLIDO",
  ci: "CÉDULA",
  telefono: "TELÉFONO",
  fecha_nacimiento: "FECHA DE NACIMIENTO",
  es_paraguayo: "ES PARAGUAYO/A",
  lugar_origen: "LUGAR DE ORIGEN",
  tiempo_arraigo: "TIEMPO DE ARRAIGO",
  especificar_anhos: "AÑOS DE ARRAIGO",

  // Actividad / economía
  realiza_actividad_economica: "ACTIVIDAD ECONÓMICA",
  ocupacion: "OCUPACIÓN",
  fuente_ingreso: "FUENTE DE INGRESO",
  ingreso_mensual: "INGRESO MENSUAL",
  egreso_mensual: "EGRESO MENSUAL",
  ingreso_mensual_comercio: "INGRESO MENSUAL (COMERCIO)",
  ingreso_mensual_microempresa: "INGRESO MENSUAL (MICROEMPRESA)",
  personal_negocio: "PERSONAL DEL NEGOCIO",
  negocio_familiar: "NEGOCIO FAMILIAR",
  fuente_ingreso_adicional: "FUENTE DE INGRESOS ADICIONAL",
  especificar_fuente_adicional: "ESPECIFICAR FUENTE ADICIONAL",

  // Demografía
  cant_personas: "PERSONAS EN EL HOGAR",
  menores_0_5: "MENORES 0-5",
  menores_18: "MENORES DE 18",
  adultos_18_64: "ADULTOS 18-64",
  adultos_65_mas: "ADULTOS 65 O MÁS",
  total_mujeres: "TOTAL MUJERES",
  total_hombres: "TOTAL HOMBRES",
  embarazadas: "EMBARAZADAS",
  personas_discapacidad: "PERSONAS CON DISCAPACIDAD",
  personas_req_esp_salud: "PERSONAS EQ. ESP. SALUD",
  familias_en_predio: "FAMILIAS EN EL PREDIO",

  // Vivienda / servicios
  caracteristicas_predio: "CARACTERÍSTICAS DEL PREDIO",
  especificar_predio: "ESPECIFICAR PREDIO",
  condicion_ocupacion: "CONDICIÓN OCUPACIÓN",
  condicion_ocupacion_detalle: "DETALLE CONDICIÓN OCUPACIÓN",
  posee_documento: "POSEE DOCUMENTO",
  cuenta_con_ci: "CUENTA CON CI",
  paredes: "PAREDES",
  especificar_otros_paredes: "OTRAS PAREDES",
  tipo_techo: "TIPO DE TECHO",
  especificar_otros_techo: "OTROS TECHOS",
  tipo_piso: "TIPO DE PISO",
  especificar_otros_piso: "OTROS PISOS",
  condicion_estructura: "CONDICIÓN ESTRUCTURA",
  energia_electrica: "ENERGÍA ELÉCTRICA",
  agua_potable: "AGUA POTABLE",
  alcantarillado: "ALCANTARILLADO",

  // Instalaciones / animales
  otras_instalaciones: "OTRAS INSTALACIONES",
  instalaciones_no_posee: "NO POSEE INSTALACIONES",
  instalaciones_huerta: "HUERTA",
  instalaciones_vivero: "VIVERO",
  instalaciones_corral: "CORRAL",
  instalaciones_otra_vivienda: "OTRA VIVIENDA",
  instalaciones_otros: "OTRAS",
  especificar_otras_instalaciones: "ESPECIFICAR INSTALACIONES",
  finalidad_instalacion: "FINALIDAD INSTALACIÓN",
  especificar_otras_finalidades: "OTRAS FINALIDADES",
  posee_animales: "POSEE ANIMALES (PROD.)",
  posee_animales_domesticos: "POSEE ANIMALES DOMÉSTICOS",
  animal_domestico_perro: "PERRO",
  animal_domestico_gato: "GATO",
  animal_domestico_ave: "AVES",
  animal_domestico_conejo: "CONEJO",
  animal_domestico_peces: "PECES",
  animal_domestico_tortuga: "TORTUGA",
  animal_domestico_otros: "OTROS DOMÉSTICOS",
  animal_domestico_especificar: "DETALLE ANIMAL DOMÉSTICO",

  // Percepción / notas
  percepcion: "PERCEPCIÓN",
  aspectos_positivos: "ASPECTOS POSITIVOS",
  interes_reubicacion: "INTERÉS REUBICACIÓN",
  observaciones: "OBSERVACIONES",

  // Geografía
  coordenadas_gps: "COORDENADAS GPS",
  gps_latitude: "GPS LAT",
  gps_longitude: "GPS LON",
  gps_altitude: "GPS ALT",
  gps_precision: "GPS PRECISIÓN",
  coor_x: "COORDENADA X",
  coor_y: "COORDENADA Y",

  // Otros
  afectacion: "AFECTACIÓN",
  tipo_inmueble: "TIPO DE INMUEBLE",
};

// =============== Agrupación por secciones (orden de columnas) ===============
const SECTIONS = [
  {
    title: "IDENTIFICACIÓN",
    keys: [
      "nombre_censista",
      "fecha_relevamiento",
      "codigo",
      "tramo",
      "progresivas",
      "ciudad",
      "barrio",
      "afectacion",
      "tipo_inmueble",
    ],
  },
  {
    title: "PERSONA / TITULAR",
    keys: [
      "nombre_apellido",
      "ci",
      "telefono",
      "fecha_nacimiento",
      "es_paraguayo",
      "lugar_origen",
      "tiempo_arraigo",
      "especificar_anhos",
    ],
  },
  {
    title: "DEMOGRAFÍA",
    keys: [
      "cant_personas",
      "familias_en_predio",
      "menores_0_5",
      "menores_18",
      "adultos_18_64",
      "adultos_65_mas",
      "total_mujeres",
      "total_hombres",
      "embarazadas",
      "personas_discapacidad",
      "personas_req_esp_salud",
    ],
  },
  {
    title: "VIVIENDA / SERVICIOS",
    keys: [
      "caracteristicas_predio",
      "especificar_predio",
      "condicion_ocupacion",
      "condicion_ocupacion_detalle",
      "posee_documento",
      "cuenta_con_ci",
      "paredes",
      "especificar_otros_paredes",
      "tipo_techo",
      "especificar_otros_techo",
      "tipo_piso",
      "especificar_otros_piso",
      "condicion_estructura",
      "energia_electrica",
      "agua_potable",
      "alcantarillado",
    ],
  },
  {
    title: "ACTIVIDAD E INGRESOS",
    keys: [
      "realiza_actividad_economica",
      "ocupacion",
      "fuente_ingreso",
      "ingreso_mensual",
      "egreso_mensual",
      "ingreso_mensual_comercio",
      "ingreso_mensual_microempresa",
      "personal_negocio",
      "negocio_familiar",
      "fuente_ingreso_adicional",
      "especificar_fuente_adicional",
    ],
  },
  {
    title: "INSTALACIONES / ANIMALES",
    keys: [
      "otras_instalaciones",
      "instalaciones_no_posee",
      "instalaciones_huerta",
      "instalaciones_vivero",
      "instalaciones_corral",
      "instalaciones_otra_vivienda",
      "instalaciones_otros",
      "especificar_otras_instalaciones",
      "finalidad_instalacion",
      "especificar_otras_finalidades",
      "posee_animales",
      "posee_animales_domesticos",
      "animal_domestico_perro",
      "animal_domestico_gato",
      "animal_domestico_ave",
      "animal_domestico_conejo",
      "animal_domestico_peces",
      "animal_domestico_tortuga",
      "animal_domestico_otros",
      "animal_domestico_especificar",
    ],
  },
  {
    title: "PERCEPCIÓN Y NOTAS",
    keys: ["percepcion", "aspectos_positivos", "interes_reubicacion", "observaciones"],
  },
  {
    title: "GEORREFERENCIACIÓN",
    keys: ["coordenadas_gps", "gps_latitude", "gps_longitude", "gps_altitude", "gps_precision", "coor_x", "coor_y"],
  },
];

// =============== Utilidades de formato ===============
const fmtDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};
const coerceBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return /^(si|sí|true|t|1|x)$/i.test(v.trim());
  return undefined;
};
const fmtBoolText = (v) => {
  const b = coerceBool(v);
  return b === undefined ? "" : b ? "Sí" : "No";
};
const isEmpty = (v) =>
  v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
const fmtValue = (key, val) => {
  if (
    typeof val === "boolean" ||
    /^(realiza_actividad_economica|energia_electrica|agua_potable|alcantarillado|posee_animales|posee_animales_domesticos)$/i.test(
      key
    )
  ) {
    return fmtBoolText(val);
  }
  if (/fecha/i.test(key)) return fmtDate(val);
  return String(val);
};

// =============== Banda de KPIs (solo PDF) ===============
function drawKpiBand(doc, startX, startY, contentW, items) {
  const perRow = 4;
  const gap = 8;
  const cardH = 44;
  const cardW = (contentW - gap * (perRow - 1)) / perRow;

  let y = startY;
  items.forEach((it, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) y += cardH + gap;
    const x = startX + col * (cardW + gap);

    doc.setDrawColor(14, 122, 122);
    doc.setFillColor(232, 247, 247);
    doc.roundedRect(x, y, cardW, cardH, 6, 6, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(14, 122, 122);
    doc.text(it.label.toUpperCase(), x + cardW / 2, y + 16, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(String(it.value), x + cardW / 2, y + 32, { align: "center" });

    doc.setFont("helvetica", "normal");
  });

  const usedRows = Math.ceil(items.length / perRow);
  return startY + usedRows * cardH + (usedRows - 1) * gap;
}

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

export default function ExportEncuestasPdf() {
  const { id: proyectoId } = useParams();
  const pid = Number(proyectoId);

  const [tramos, setTramos] = useState([]);
  const [tramoId, setTramoId] = useState("");
  const [tipo, setTipo] = useState(""); // '', 'normal', 'especial'

  const [loadingTramos, setLoadingTramos] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingXls, setGeneratingXls] = useState(false);

  // 1) Cargar tramos
  useEffect(() => {
    if (!pid) return;

    (async () => {
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
        if (String(e?.message || "").toLowerCase().includes("sesión expirada")) {
          window.location.replace("/login");
        }
      } finally {
        setLoadingTramos(false);
      }
    })();
  }, [pid]);

  // 2) Traer encuestas (con filtros tramo + tipo)
  const fetchEncuestas = async () => {
    const base = tramoId
      ? `${API_URL}/encuestas/proyecto/${pid}/tramo/${tramoId}`
      : `${API_URL}/encuestas/proyecto/${pid}`;

    const url = tipo ? `${base}?tipo=${encodeURIComponent(tipo)}` : base;

    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...authHeaders() },
    });
    const data = await jsonOrTextError(res);

    // algunas APIs devuelven {data:[]}
    const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return arr;
  };

  // 3) Generar PDF
  const handleDownloadPDF = async () => {
    try {
      setGeneratingPdf(true);
      const encuestas = await fetchEncuestas();

      if (!encuestas.length) {
        alerts.toast.info("No se encontraron encuestas con el filtro seleccionado.");
        return;
      }

      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = doc.internal.pageSize.width;
      const pageH = doc.internal.pageSize.height;
      const margin = 40;
      const contentW = pageW - margin * 2;

      encuestas.forEach((enc, idx) => {
        if (idx > 0) doc.addPage();

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);

        // --- Encabezado ---
        if (LOGO_DATAURL) {
          try {
            doc.addImage(LOGO_DATAURL, "PNG", margin, 18, 80, 28);
          } catch {}
        }
        doc.text(BRAND_TITLE, LOGO_DATAURL ? margin + 90 : margin, 30);
        doc.text(new Date().toLocaleString(), pageW - margin, 30, { align: "right" });
        doc.setDrawColor(14, 122, 122);
        doc.setLineWidth(1);
        doc.line(margin, 40, pageW - margin, 40);

        // --- Título / subtítulo ---
        doc.setFontSize(16);
        doc.setTextColor(14, 122, 122);
        doc.text(`Encuesta ID: ${enc.id_encuesta ?? "-"}`, margin, 70);
        doc.setFontSize(11);
        doc.setTextColor(80);

        const sub = [
          enc.codigo ? `Código ${enc.codigo}` : null,
          enc.tramo ? `Tramo ${enc.tramo}` : null,
          enc.progresivas ? `Progresivas ${enc.progresivas}` : null,
          enc.tipo_inmueble ? `Tipo ${enc.tipo_inmueble}` : null,
        ]
          .filter(Boolean)
          .join("  ·  ");

        if (sub) doc.text(sub, margin, 88);
        doc.setTextColor(0);

        // --- Banda de KPIs ---
        const kpis = [
          { label: "Personas", value: enc.cant_personas ?? "-" },
          { label: "Mujeres", value: enc.total_mujeres ?? "-" },
          { label: "Hombres", value: enc.total_hombres ?? "-" },
          { label: "Act. Econ.", value: fmtBoolText(enc.realiza_actividad_economica) },
          { label: "Energía", value: fmtBoolText(enc.energia_electrica) },
          { label: "Agua", value: fmtBoolText(enc.agua_potable) },
          { label: "Alcantar.", value: fmtBoolText(enc.alcantarillado) },
        ].filter((it) => String(it.value).trim() !== "");

        let cursorY = drawKpiBand(doc, margin, 105, contentW, kpis) + 18;

        // helper salto de página
        const ensureSpace = (needed = 120) => {
          if (cursorY + needed > pageH - 70) {
            doc.addPage();
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.text(BRAND_TITLE, margin, 30);
            doc.text(new Date().toLocaleString(), pageW - margin, 30, { align: "right" });
            doc.setDrawColor(220);
            doc.line(margin, 40, pageW - margin, 40);
            cursorY = 60;
          }
        };

        // --- Secciones con tablas 2 columnas ---
        SECTIONS.forEach((section) => {
          const rows = section.keys
            .filter((k) => Object.prototype.hasOwnProperty.call(enc, k) && !isEmpty(enc[k]))
            .map((k) => [HEADER_MAP[k] || k, fmtValue(k, enc[k])]);

          if (!rows.length) return;

          ensureSpace(80 + rows.length * 18);

          doc.setFillColor(232, 247, 247);
          doc.rect(margin, cursorY, contentW, 22, "F");
          doc.setFontSize(11);
          doc.setTextColor(14, 122, 122);
          doc.text(section.title, margin + 8, cursorY + 15);
          doc.setTextColor(0);
          cursorY += 28;

          autoTable(doc, {
            startY: cursorY,
            head: [["Título", "Respuesta"]],
            body: rows,
            margin: { left: margin, right: margin },
            tableWidth: contentW,
            columnStyles: {
              0: { cellWidth: contentW * 0.4 },
              1: { cellWidth: contentW * 0.6 },
            },
            styles: { fontSize: 10, cellPadding: 4, lineColor: [220, 220, 220] },
            headStyles: { fillColor: [200, 200, 200], textColor: [33, 33, 33] },
          });

          cursorY = doc.lastAutoTable.finalY + 16;
        });

        // --- Pie / paginación ---
        const pageCount = encuestas.length;
        doc.setDrawColor(220);
        doc.line(margin, pageH - 32, pageW - margin, pageH - 32);
        doc.setFontSize(10);
        doc.text(`Página ${idx + 1} de ${pageCount}`, pageW / 2, pageH - 16, { align: "center" });
      });

      // nombre sugerido según filtros
      const tramoTxt = tramoId ? `Tramo_${tramoId}` : "Todas";
      const tipoTxt = tipo ? `_${tipo}` : "";
      doc.save(`Encuestas_${pid}_${tramoTxt}${tipoTxt}.pdf`);

      alerts.toast.success("PDF generado correctamente.");
    } catch (err) {
      console.error(err);
      alerts.toast.error("Error al generar PDF: " + (err?.message || ""));
      if (String(err?.message || "").toLowerCase().includes("sesión expirada")) {
        window.location.replace("/login");
      }
    } finally {
      setGeneratingPdf(false);
    }
  };

  // 4) Generar Excel con autofiltro
  const handleDownloadExcel = async () => {
    try {
      setGeneratingXls(true);

      const XLSX = await import("xlsx");

      const encuestas = await fetchEncuestas();
      if (!encuestas.length) {
        alerts.toast.info("No se encontraron encuestas con el filtro seleccionado.");
        return;
      }

      // Orden de columnas = concatenación de todas las keys de SECTIONS
      const orderedKeys = SECTIONS.flatMap((s) => s.keys);
      // Encabezados visibles
      const headers = orderedKeys.map((k) => HEADER_MAP[k] || k.toUpperCase());

      // Filas
      const rows = encuestas.map((enc) =>
        orderedKeys.map((k) =>
          Object.prototype.hasOwnProperty.call(enc, k) && !isEmpty(enc[k]) ? fmtValue(k, enc[k]) : ""
        )
      );

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

      // Autofiltro en la fila 1
      const lastCol = XLSX.utils.encode_col(headers.length - 1);
      ws["!autofilter"] = { ref: `A1:${lastCol}1` };

      // Anchos de columna heurísticos
      ws["!cols"] = headers.map((h) => {
        const base = 12;
        const longHeader = Math.max(12, Math.min(40, String(h).length + 2));
        return { wch: Math.max(base, longHeader) };
      });

      // Congelar header (algunos visores lo soportan)
      // @ts-ignore
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Encuestas");

      const tramoTxt = tramoId ? `Tramo_${tramoId}` : "Todas";
      const tipoTxt = tipo ? `_${tipo}` : "";
      const filename = `Encuestas_${pid}_${tramoTxt}${tipoTxt}.xlsx`;

      XLSX.writeFile(wb, filename);
      alerts.toast.success("Excel generado correctamente.");
    } catch (err) {
      console.error(err);
      alerts.toast.error("Error al generar Excel: " + (err?.message || ""));
      if (String(err?.message || "").toLowerCase().includes("sesión expirada")) {
        window.location.replace("/login");
      }
    } finally {
      setGeneratingXls(false);
    }
  };

  return (
    <Form className="mb-4">
      <Row className="align-items-end g-2">
        <Col xs={12} sm={5}>
          <Form.Group controlId="selectTramo">
            <Form.Label>Seleccione Tramo</Form.Label>
            <Form.Select
              value={tramoId}
              onChange={(e) => setTramoId(e.target.value)}
              disabled={loadingTramos || generatingPdf || generatingXls}
            >
              <option value="">— Todas las encuestas —</option>
              {tramos.map((t) => (
                <option key={t.id_tramo} value={t.id_tramo}>
                  {t.nombre_tramo}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>

        <Col xs={12} sm={3}>
          <Form.Group controlId="selectTipoInmueble">
            <Form.Label>Tipo de inmueble</Form.Label>
            <Form.Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              disabled={generatingPdf || generatingXls}
            >
              <option value="">— Todos —</option>
              <option value="normal">Normales</option>
              <option value="especial">Especiales</option>
            </Form.Select>
          </Form.Group>
        </Col>

        <Col xs={12} sm={2}>
          <Button
            variant="primary"
            onClick={handleDownloadPDF}
            className="w-100"
            disabled={generatingPdf || generatingXls}
          >
            {generatingPdf ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Generando…
              </>
            ) : (
              "📄 PDF"
            )}
          </Button>
        </Col>

        <Col xs={12} sm={2}>
          <Button
            variant="success"
            onClick={handleDownloadExcel}
            className="w-100"
            disabled={generatingXls || generatingPdf}
          >
            {generatingXls ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Generando…
              </>
            ) : (
              "📊 EXC"
            )}
          </Button>
        </Col>
      </Row>
    </Form>
  );
}
