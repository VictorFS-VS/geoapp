// backend/controllers/acta.controller.js

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
let sizeOf = require('image-size');
if (sizeOf?.default) sizeOf = sizeOf.default;

const puppeteer = require('puppeteer');
const archiver = require('archiver');
const mime = require('mime-types');

const pool = require('../db');
const { buildDocxFromHtml } = require('../services/docxFromHtml');

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
function safe(v) { return v ?? ''; }

function fileToDataUri(absPath) {
  if (!absPath) return null;
  try {
    const buf = fs.readFileSync(absPath);
    const b64 = buf.toString('base64');
    const ext = path.extname(absPath).slice(1).toLowerCase() || 'jpeg';
    const kind = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${kind};base64,${b64}`;
  } catch { return null; }
}

// Plantilla con el mismo layout/texto que el documento de referencia
function htmlTemplate(acta, fotos, firmas) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Acta de Preconstrucción</title>
<style>
  :root {
    --teal: #0e7a7a;
    --line: #dddddd;
    --muted:#666;
    --band: #eeeeee;
  }
  body { font-family: Arial, sans-serif; font-size: 12px; color:#222; line-height: 1.45; }
  h1 { font-size: 22px; color: var(--teal); letter-spacing: .5px; margin: 6px 0 4px; }
  .hr { border-top: 2px solid var(--teal); margin: 6px 0 16px; }
  .intro p { margin: 0 0 10px; text-align: justify; }
  .label { font-weight: bold; }
  .band { background: var(--band); padding: 4px 8px; font-weight: bold; color: var(--teal); }
  .sec { margin: 18px 0; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
  td.head { background: #fff; font-weight: bold; color:#111; }
  .kvrow td:first-child { width: 28%; font-weight: normal; color:#333; }
  .muted { color: var(--muted); }
  .gal { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0 4px; }
  .gal img { width: 100%; height: 140px; object-fit: cover; border: 1px solid #ccc; }
  .firma { height: 60px; object-fit: contain; border: 1px solid #ccc; padding: 3px; }
  .obs { min-height: 70px; }
  .right { text-align: right; }
</style>
</head>
<body>

  <div class="right"><span style="background:#f2f27a; padding:2px 6px;">LOGO EMPRESA</span></div>
  <h1>ACTA DE PRECONSTRUCCIÓN</h1>
  <div class="hr"></div>

  <div class="intro">
    <p>El presente documento constituye un Acta de Relevamiento de <span class="label">Pre-construcción</span>, cuyo objetivo es registrar de manera fehaciente el estado actual del inmueble colindante antes del inicio de la obra.</p>
    <p>Este registro detallado funciona como una salvaguarda transparente y equitativa para ambas partes. Por un lado, protege al propietario al ofrecerle un respaldo claro y documentado del estado original de su propiedad, facilitando la identificación y gestión de cualquier posible afectación futura. Por otro lado, permite a la parte constructora deslindar responsabilidades sobre daños o patologías ya existentes.</p>
    <p>El relevamiento se realiza mediante una inspección visual y un registro fotográfico, con el pleno consentimiento del propietario, quien acompaña y valida la información aquí consignada.</p>
  </div>

  <div class="sec">
    <div class="label" style="margin-top:10px;">Nombre del Arquitecto Responsable:</div>
    <div>${acta.nombre_arquitecto||''}</div>
  </div>

  <div class="sec">
    <div class="band">DATOS GENERALES</div>
    <table>
      <tr class="kvrow"><td class="head">Proyecto:</td><td>${acta.nombre_proyecto||''}</td></tr>
      <tr class="kvrow"><td>Tramo:</td><td>${acta.tramo_proyecto||''}</td></tr>
      <tr class="kvrow"><td>Coordenadas:</td><td>${(acta.coordenada_x||'')}${acta.coordenada_x?', ':''}${acta.coordenada_y||''}</td></tr>
      <tr class="kvrow"><td>Progresivas:</td><td>${acta.progresivas||''}</td></tr>
      <tr class="kvrow"><td>Lado:</td><td>${acta.lado||''}</td></tr>
      <tr class="kvrow"><td>Fecha relevamiento:</td><td>${acta.fecha_relevamiento||''}</td></tr>
      <tr class="kvrow"><td>Dirección:</td><td>${acta.direccion_predio||''}</td></tr>
      <tr class="kvrow"><td>Propietario:</td><td>${acta.nombre_propietario||''}</td></tr>
      <tr class="kvrow"><td>CI:</td><td>${acta.cedula_propietario||''}</td></tr>
      <tr class="kvrow"><td>Contacto:</td><td>${acta.contacto_propietario||''}</td></tr>
      <tr class="kvrow"><td>Catastro (Finca – Padrón):</td><td>${acta.identificacion_catastral||''}</td></tr>
    </table>
  </div>

  <div class="sec">
    <div class="band">FACHADA</div>
    <table>
      <tr class="kvrow"><td class="head">Cerramiento:</td><td>${acta.tipo_cerramiento||''}</td></tr>
      <tr class="kvrow"><td>Revestimiento:</td><td>${acta.revestimiento_fachada||''}</td></tr>
      <tr class="kvrow"><td>Estado:</td><td>${acta.estado_general_fachada||''}</td></tr>
      <tr class="kvrow"><td>Patologías:</td><td>${acta.lista_patologias_fachada||''}</td></tr>
      <tr class="kvrow"><td>Obs.:</td><td class="obs">${acta.observaciones_fachada||''}</td></tr>
    </table>
  </div>

  <div class="sec">
    <div class="band">VEREDA</div>
    <table>
      <tr class="kvrow"><td class="head">Material:</td><td>${acta.material_vereda||''}</td></tr>
      <tr class="kvrow"><td>Estado:</td><td>${acta.estado_general_vereda||''}</td></tr>
      <tr class="kvrow"><td>Patologías:</td><td>${acta.lista_patologias_vereda||''}</td></tr>
      <tr class="kvrow"><td>Obs.:</td><td class="obs">${acta.observaciones_vereda||''}</td></tr>
    </table>
  </div>

  <div class="sec">
    <div class="band">ESTRUCTURA</div>
    <table>
      <tr class="kvrow"><td class="head">Tipo:</td><td>${acta.tipo_estructura_visible||''}</td></tr>
      <tr class="kvrow"><td>Estado:</td><td>${acta.estado_elementos_estructurales||''}</td></tr>
      <tr class="kvrow"><td>Obs.:</td><td class="obs">${acta.observaciones_estructura||''}</td></tr>
    </table>
  </div>

  <div class="sec" style="text-align:center; font-weight:bold; color:var(--teal);">REGISTROS FOTOGRÁFICO</div>

  ${fotos.fachada?.length ? `
    <div class="sec"><div class="band">FACHADA</div>
      <div class="gal">
        ${fotos.fachada.map(f=>`<div><img src="${f.dataUri}"/><div class="muted">${f.descripcion||''}</div></div>`).join('')}
      </div>
    </div>` : `<div class="sec"><div class="band">FACHADA</div></div>`}

  ${fotos.vereda?.length ? `
    <div class="sec"><div class="band">VEREDA</div>
      <div class="gal">
        ${fotos.vereda.map(f=>`<div><img src="${f.dataUri}"/><div class="muted">${f.descripcion||''}</div></div>`).join('')}
      </div>
    </div>` : `<div class="sec"><div class="band">VEREDA</div></div>`}

  ${fotos.estructura?.length ? `
    <div class="sec"><div class="band">ESTRUCTURA</div>
      <div class="gal">
        ${fotos.estructura.map(f=>`<div><img src="${f.dataUri}"/><div class="muted">${f.descripcion||''}</div></div>`).join('')}
      </div>
    </div>` : `<div class="sec"><div class="band">ESTRUCTURA</div></div>`}

  <div class="sec">
    <div class="label">Observaciones Adicionales:</div>
    <div class="obs" style="border:1px solid var(--line); padding:8px; margin-top:6px;">${acta.observaciones_adicionales||''}</div>
  </div>

  <div class="sec">
    <table>
      <tr>
        <td class="head" style="width:50%;">Firma del propietario</td>
        <td class="head">Firma Arquitecto</td>
      </tr>
      <tr>
        <td style="height:70px;">${firmas.propietario ? `<img class="firma" src="${firmas.propietario}"/>` : ''}</td>
        <td>${firmas.arquitecto ? `<img class="firma" src="${firmas.arquitecto}"/>` : ''}</td>
      </tr>
    </table>
  </div>

</body>
</html>`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Crear acta + guardar archivos + insertar DB
// ───────────────────────────────────────────────────────────────────────────────
async function _crearActaYGuardarArchivos(client, id_proyecto, body, files) {
  const insertActaText = `
    INSERT INTO ema.actas_preconstruccion (
      id_proyecto, id_tramo, coordenada_x, coordenada_y,
      nombre_proyecto, tramo_proyecto, fecha_relevamiento, nombre_arquitecto, matricula_arquitecto,
      direccion_predio, identificacion_catastral, nombre_propietario, cedula_propietario, contacto_propietario,
      tipo_cerramiento, revestimiento_fachada, estado_general_fachada, lista_patologias_fachada, observaciones_fachada,
      material_vereda, estado_general_vereda, lista_patologias_vereda, observaciones_vereda,
      tipo_estructura_visible, estado_elementos_estructurales, observaciones_estructura,
      progresivas, lado, observaciones_adicionales
    ) VALUES (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,
      $10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,
      $20,$21,$22,$23,
      $24,$25,$26,
      $27,$28,$29
    ) RETURNING id_acta;
  `;

  const valuesActa = [
    id_proyecto,
    body.id_tramo,
    body.coordenada_x || null,
    body.coordenada_y || null,
    safe(body.nombre_proyecto),
    safe(body.tramo_proyecto),
    safe(body.fecha_relevamiento) || null,
    safe(body.nombre_arquitecto),
    safe(body.matricula_arquitecto),
    safe(body.direccion_predio),
    safe(body.identificacion_catastral),
    safe(body.nombre_propietario),
    safe(body.cedula_propietario),
    safe(body.contacto_propietario),
    safe(body.tipo_cerramiento),
    safe(body.revestimiento_fachada),
    safe(body.estado_general_fachada),
    safe(body.lista_patologias_fachada),
    safe(body.observaciones_fachada),
    safe(body.material_vereda),
    safe(body.estado_general_vereda),
    safe(body.lista_patologias_vereda),
    safe(body.observaciones_vereda),
    safe(body.tipo_estructura_visible),
    safe(body.estado_elementos_estructurales),
    safe(body.observaciones_estructura),
    safe(body.progresivas),
    safe(body.lado),
    safe(body.observaciones_adicionales),
  ];

  const actaRes = await client.query(insertActaText, valuesActa);
  const id_acta = actaRes.rows[0].id_acta;

  const baseDir = path.join(__dirname, '..', 'uploads', 'proyectos', String(id_proyecto), 'actas', String(id_acta));
  const firmasDir = path.join(baseDir, 'firmas');
  await fs.promises.mkdir(firmasDir, { recursive: true });

  let firmaPropietarioPath = null;
  let firmaArquitectoPath = null;

  if (files?.firma_propietario_img) {
    const archivo = Array.isArray(files.firma_propietario_img) ? files.firma_propietario_img[0] : files.firma_propietario_img;
    const ext = path.extname(archivo.name) || '.jpg';
    firmaPropietarioPath = path.join(firmasDir, `firma_propietario${ext}`);
    await archivo.mv(firmaPropietarioPath);
  }

  if (files?.firma_arquitecto_img) {
    const archivo = Array.isArray(files.firma_arquitecto_img) ? files.firma_arquitecto_img[0] : files.firma_arquitecto_img;
    const ext = path.extname(archivo.name) || '.jpg';
    firmaArquitectoPath = path.join(firmasDir, `firma_arquitecto${ext}`);
    await archivo.mv(firmaArquitectoPath);
  }

  const categorias = ['fachada', 'vereda', 'estructura'];
  for (const cat of categorias) {
    const fotosField = `fotos_${cat}`;
    const descField = `descripciones_${cat}`;
    const fotosRaw = files?.[fotosField];
    if (!fotosRaw) continue;
    const fotosArray = Array.isArray(fotosRaw) ? fotosRaw : [fotosRaw];

    const descripcionesRaw = body[descField];
    const descripcionesArray = descripcionesRaw
      ? (Array.isArray(descripcionesRaw) ? descripcionesRaw : [descripcionesRaw])
      : [];

    const fotosDir = path.join(baseDir, `fotos_${cat}`);
    await fs.promises.mkdir(fotosDir, { recursive: true });

    for (let i = 0; i < fotosArray.length; i++) {
      const foto = fotosArray[i];
      const ext = path.extname(foto.name) || '.jpg';
      const nombreArchivo = `${i + 1}${ext}`;
      const destino = path.join(fotosDir, nombreArchivo);
      await foto.mv(destino);
      const descripcion = descripcionesArray[i] || null;

      await client.query(
        `INSERT INTO ema.actas_fotos (id_acta, categoria, descripcion, ruta_archivo, orden)
         VALUES ($1, $2, $3, $4, $5)`,
        [id_acta, cat, descripcion, destino, i]
      );
    }
  }

  await client.query(
    `UPDATE ema.actas_preconstruccion
       SET firma_propietario_path = $1,
           firma_arquitecto_path = $2,
           actualizado_en = now()
     WHERE id_acta = $3`,
    [firmaPropietarioPath, firmaArquitectoPath, id_acta]
  );

  return { id_acta, baseDir, firmaPropietarioPath, firmaArquitectoPath };
}

// ───────────────────────────────────────────────────────────────────────────────
// PDF desde HTML (Puppeteer)
// ───────────────────────────────────────────────────────────────────────────────
async function generarActaPreconstruccionPDF(req, res) {
  const { id: id_proyecto } = req.params;
  const body = req.body;
  const { files } = req;
  const idActaReimp = req.query.id_acta ? Number(req.query.id_acta) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let id_acta;
    let firmaPropietarioPath = null;
    let firmaArquitectoPath = null;
    let actaDataForHtml = null;

    if (idActaReimp) {
      const actaRes = await client.query(
        `SELECT * FROM ema.actas_preconstruccion WHERE id_acta = $1`,
        [idActaReimp]
      );
      if (actaRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Acta no encontrada' });
      }
      const a = actaRes.rows[0];
      if (String(a.id_proyecto) !== String(id_proyecto)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El acta no pertenece al proyecto indicado' });
      }

      id_acta = a.id_acta;
      firmaPropietarioPath = a.firma_propietario_path || null;
      firmaArquitectoPath = a.firma_arquitecto_path || null;

      actaDataForHtml = {
        nombre_proyecto: safe(a.nombre_proyecto),
        tramo_proyecto: safe(a.tramo_proyecto),
        fecha_relevamiento: safe(a.fecha_relevamiento),
        nombre_arquitecto: safe(a.nombre_arquitecto),
        matricula_arquitecto: safe(a.matricula_arquitecto),
        direccion_predio: safe(a.direccion_predio),
        identificacion_catastral: safe(a.identificacion_catastral),
        nombre_propietario: safe(a.nombre_propietario),
        cedula_propietario: safe(a.cedula_propietario),
        contacto_propietario: safe(a.contacto_propietario),
        tipo_cerramiento: safe(a.tipo_cerramiento),
        revestimiento_fachada: safe(a.revestimiento_fachada),
        estado_general_fachada: safe(a.estado_general_fachada),
        lista_patologias_fachada: safe(a.lista_patologias_fachada),
        observaciones_fachada: safe(a.observaciones_fachada),
        material_vereda: safe(a.material_vereda),
        estado_general_vereda: safe(a.estado_general_vereda),
        lista_patologias_vereda: safe(a.lista_patologias_vereda),
        observaciones_vereda: safe(a.observaciones_vereda),
        tipo_estructura_visible: safe(a.tipo_estructura_visible),
        estado_elementos_estructurales: safe(a.estado_elementos_estructurales),
        observaciones_estructura: safe(a.observaciones_estructura),
        coordenada_x: safe(a.coordenada_x),
        coordenada_y: safe(a.coordenada_y),
        progresivas: safe(a.progresivas),
        lado: safe(a.lado),
        observaciones_adicionales: safe(a.observaciones_adicionales),
      };
    } else {
      const r = await _crearActaYGuardarArchivos(client, id_proyecto, body, files);
      id_acta = r.id_acta;
      firmaPropietarioPath = r.firmaPropietarioPath;
      firmaArquitectoPath = r.firmaArquitectoPath;

      actaDataForHtml = {
        nombre_proyecto: safe(body.nombre_proyecto),
        tramo_proyecto: safe(body.tramo_proyecto),
        fecha_relevamiento: safe(body.fecha_relevamiento),
        nombre_arquitecto: safe(body.nombre_arquitecto),
        matricula_arquitecto: safe(body.matricula_arquitecto),
        direccion_predio: safe(body.direccion_predio),
        identificacion_catastral: safe(body.identificacion_catastral),
        nombre_propietario: safe(body.nombre_propietario),
        cedula_propietario: safe(body.cedula_propietario),
        contacto_propietario: safe(body.contacto_propietario),
        tipo_cerramiento: safe(body.tipo_cerramiento),
        revestimiento_fachada: safe(body.revestimiento_fachada),
        estado_general_fachada: safe(body.estado_general_fachada),
        lista_patologias_fachada: safe(body.lista_patologias_fachada),
        observaciones_fachada: safe(body.observaciones_fachada),
        material_vereda: safe(body.material_vereda),
        estado_general_vereda: safe(body.estado_general_vereda),
        lista_patologias_vereda: safe(body.lista_patologias_vereda),
        observaciones_vereda: safe(body.observaciones_vereda),
        tipo_estructura_visible: safe(body.tipo_estructura_visible),
        estado_elementos_estructurales: safe(body.estado_elementos_estructurales),
        observaciones_estructura: safe(body.observaciones_estructura),
        coordenada_x: safe(body.coordenada_x),
        coordenada_y: safe(body.coordenada_y),
        progresivas: safe(body.progresivas),
        lado: safe(body.lado),
        observaciones_adicionales: safe(body.observaciones_adicionales),
      };
    }

    // Fotos desde DB
    const fotosRes = await client.query(
      `SELECT categoria, descripcion, ruta_archivo
         FROM ema.actas_fotos
        WHERE id_acta = $1
        ORDER BY categoria, orden`,
      [id_acta]
    );
    const fotos = { fachada: [], vereda: [], estructura: [] };
    for (const r of fotosRes.rows) {
      fotos[r.categoria].push({ descripcion: r.descripcion, dataUri: fileToDataUri(r.ruta_archivo) });
    }

    const firmas = {
      propietario: fileToDataUri(firmaPropietarioPath),
      arquitecto: fileToDataUri(firmaArquitectoPath),
    };

    const html = htmlTemplate(actaDataForHtml, fotos, firmas);
    await client.query('COMMIT');

    // Render PDF con setContent
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--font-render-hinting=medium']
    });

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(120000);
      await page.emulateMediaType('screen');
      await page.setContent(html, { waitUntil: 'load' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ActaPreconstruccion_${id_proyecto}_${id_acta}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } finally {
      await browser.close();
    }

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PDF][ERROR]', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: 'No se pudo generar/reimprimir el PDF', detalle: e.message });
  } finally {
    client.release();
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// DOCX desde el mismo HTML (html-to-docx)
// ───────────────────────────────────────────────────────────────────────────────
async function generarActaPreconstruccionDOCX(req, res) {
  const { id: id_proyecto } = req.params;
  const body = req.body;
  const { files } = req;
  const idActaReimp = req.query.id_acta ? Number(req.query.id_acta) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let id_acta;
    let firmaPropietarioPath = null;
    let firmaArquitectoPath = null;
    let actaDataForHtml = null;

    if (idActaReimp) {
      const actaRes = await client.query(
        `SELECT * FROM ema.actas_preconstruccion WHERE id_acta = $1`,
        [idActaReimp]
      );
      if (actaRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Acta no encontrada' });
      }
      const a = actaRes.rows[0];
      if (String(a.id_proyecto) !== String(id_proyecto)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El acta no pertenece al proyecto indicado' });
      }

      id_acta = a.id_acta;
      firmaPropietarioPath = a.firma_propietario_path || null;
      firmaArquitectoPath = a.firma_arquitecto_path || null;

      actaDataForHtml = {
        nombre_proyecto: a.nombre_proyecto || '',
        tramo_proyecto: a.tramo_proyecto || '',
        fecha_relevamiento: a.fecha_relevamiento || '',
        nombre_arquitecto: a.nombre_arquitecto || '',
        matricula_arquitecto: a.matricula_arquitecto || '',
        direccion_predio: a.direccion_predio || '',
        identificacion_catastral: a.identificacion_catastral || '',
        nombre_propietario: a.nombre_propietario || '',
        cedula_propietario: a.cedula_propietario || '',
        contacto_propietario: a.contacto_propietario || '',
        tipo_cerramiento: a.tipo_cerramiento || '',
        revestimiento_fachada: a.revestimiento_fachada || '',
        estado_general_fachada: a.estado_general_fachada || '',
        lista_patologias_fachada: a.lista_patologias_fachada || '',
        observaciones_fachada: a.observaciones_fachada || '',
        material_vereda: a.material_vereda || '',
        estado_general_vereda: a.estado_general_vereda || '',
        lista_patologias_vereda: a.lista_patologias_vereda || '',
        observaciones_vereda: a.observaciones_vereda || '',
        tipo_estructura_visible: a.tipo_estructura_visible || '',
        estado_elementos_estructurales: a.estado_elementos_estructurales || '',
        observaciones_estructura: a.observaciones_estructura || '',
        coordenada_x: a.coordenada_x || '',
        coordenada_y: a.coordenada_y || '',
        progresivas: a.progresivas || '',
        lado: a.lado || '',
        observaciones_adicionales: a.observaciones_adicionales || '',
      };
    } else {
      const r = await _crearActaYGuardarArchivos(client, id_proyecto, body, files);
      id_acta = r.id_acta;
      firmaPropietarioPath = r.firmaPropietarioPath;
      firmaArquitectoPath = r.firmaArquitectoPath;

      actaDataForHtml = {
        nombre_proyecto: body.nombre_proyecto || '',
        tramo_proyecto: body.tramo_proyecto || '',
        fecha_relevamiento: body.fecha_relevamiento || '',
        nombre_arquitecto: body.nombre_arquitecto || '',
        matricula_arquitecto: body.matricula_arquitecto || '',
        direccion_predio: body.direccion_predio || '',
        identificacion_catastral: body.identificacion_catastral || '',
        nombre_propietario: body.nombre_propietario || '',
        cedula_propietario: body.cedula_propietario || '',
        contacto_propietario: body.contacto_propietario || '',
        tipo_cerramiento: body.tipo_cerramiento || '',
        revestimiento_fachada: body.revestimiento_fachada || '',
        estado_general_fachada: body.estado_general_fachada || '',
        lista_patologias_fachada: body.lista_patologias_fachada || '',
        observaciones_fachada: body.observaciones_fachada || '',
        material_vereda: body.material_vereda || '',
        estado_general_vereda: body.estado_general_vereda || '',
        lista_patologias_vereda: body.lista_patologias_vereda || '',
        observaciones_vereda: body.observaciones_vereda || '',
        tipo_estructura_visible: body.tipo_estructura_visible || '',
        estado_elementos_estructurales: body.estado_elementos_estructurales || '',
        observaciones_estructura: body.observaciones_estructura || '',
        coordenada_x: body.coordenada_x || '',
        coordenada_y: body.coordenada_y || '',
        progresivas: body.progresivas || '',
        lado: body.lado || '',
        observaciones_adicionales: body.observaciones_adicionales || '',
      };
    }

    // Fotos y firmas
    const fotosRes = await client.query(
      `SELECT categoria, descripcion, ruta_archivo
         FROM ema.actas_fotos
        WHERE id_acta = $1
        ORDER BY categoria, orden`,
      [id_acta]
    );
    const fotos = { fachada: [], vereda: [], estructura: [] };
    for (const r of fotosRes.rows) {
      fotos[r.categoria].push({ descripcion: r.descripcion, dataUri: fileToDataUri(r.ruta_archivo) });
    }
    const firmas = {
      propietario: fileToDataUri(firmaPropietarioPath),
      arquitecto: fileToDataUri(firmaArquitectoPath),
    };

    const html = htmlTemplate(actaDataForHtml, fotos, firmas);
    await client.query('COMMIT');

    // HTML → DOCX
    const docxBuffer = await buildDocxFromHtml(html);
    const filename = `ActaPreconstruccion_${id_proyecto}_${id_acta}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', docxBuffer.length);
    return res.end(docxBuffer);

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[DOCX][ERROR]', e);
    return res.status(500).json({ error: 'No se pudo generar/reimprimir el DOCX', detalle: e.message });
  } finally {
    client.release();
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Deprecado (plantilla antigua)
// ───────────────────────────────────────────────────────────────────────────────
async function generarActaPreconstruccion(req, res) {
  return res.status(410).json({ error: 'Endpoint deprecado: usar /actas-preconstruccion-pdf o /actas-preconstruccion-docx' });
}

// ───────────────────────────────────────────────────────────────────────────────
// Eliminar acta + archivos
// ───────────────────────────────────────────────────────────────────────────────
async function eliminarActa(req, res) {
  const { id_acta } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actaRes = await client.query(
      `SELECT id_acta, id_proyecto, firma_propietario_path, firma_arquitecto_path
         FROM ema.actas_preconstruccion
        WHERE id_acta = $1`, [id_acta]
    );
    if (actaRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Acta no encontrada' });
    }
    const acta = actaRes.rows[0];

    const fotosRes = await client.query(
      `SELECT ruta_archivo FROM ema.actas_fotos WHERE id_acta = $1`, [id_acta]
    );
    const fotoPaths = fotosRes.rows.map(r => r.ruta_archivo).filter(Boolean);

    await client.query(`DELETE FROM ema.actas_fotos WHERE id_acta = $1`, [id_acta]);
    await client.query(`DELETE FROM ema.actas_preconstruccion WHERE id_acta = $1`, [id_acta]);

    await client.query('COMMIT');

    const baseDir = path.join(__dirname, '..', 'uploads', 'proyectos', String(acta.id_proyecto), 'actas', String(id_acta));
    try {
      await fs.promises.rm(baseDir, { recursive: true, force: true });
    } catch (e) {
      await Promise.allSettled([
        ...fotoPaths,
        acta.firma_propietario_path,
        acta.firma_arquitecto_path
      ].filter(Boolean).map(p => fs.promises.rm(p, { force: true })));
    }

    return res.json({ ok: true, id_acta: Number(id_acta) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[ACTA][DEL][ERROR]', e);
    return res.status(500).json({ error: 'No se pudo eliminar el acta', detalle: e.message });
  } finally {
    client.release();
  }
}

module.exports = {
  generarActaPreconstruccion,      // deprecado
  generarActaPreconstruccionPDF,   // PDF (setContent)
  generarActaPreconstruccionDOCX,  // DOCX (html-to-docx)
  eliminarActa,
};
