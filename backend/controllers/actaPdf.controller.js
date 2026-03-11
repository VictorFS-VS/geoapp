// backend/controllers/actaPdf.controller.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const pool = require('../db');

function safe(v) {
  return v ?? '';
}

const mimeFromExt = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const imagenBase64 = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn('[PDF] La imagen no existe en disco:', filePath);
      return '';
    }
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      console.warn('[PDF] La imagen está vacía:', filePath);
      return '';
    }
    const b = fs.readFileSync(filePath);
    const ext = path.extname(filePath).substring(1).toLowerCase();
    const mime = mimeFromExt[ext] || 'application/octet-stream';
    const base64 = b.toString('base64');
    const dataUri = `data:${mime};base64,${base64}`;
    console.log(`[PDF] Generado data URI para ${filePath}, longitud: ${dataUri.length}`);
    return dataUri;
  } catch (e) {
    console.warn('[PDF] Error leyendo imagen para convertir a base64:', filePath, e.message);
    return '';
  }
};

// 1. Listar actas de un proyecto ordenadas por tramo
async function listarActasPorProyecto(req, res) {
  const { id: id_proyecto } = req.params;
  try {
    const result = await pool.query(
      `
      SELECT 
        a.id_acta,
        a.tramo_proyecto,
        a.fecha_relevamiento,
        a.nombre_propietario,
        a.nombre_arquitecto,
        a.matricula_arquitecto,
        a.estado_elementos_estructurales,
        a.firma_propietario_path IS NOT NULL AS tiene_firma_propietario,
        a.firma_arquitecto_path IS NOT NULL AS tiene_firma_arquitecto,
        COUNT(f.id_foto) FILTER (WHERE f.categoria='fachada') AS fotos_fachada,
        COUNT(f.id_foto) FILTER (WHERE f.categoria='vereda') AS fotos_vereda,
        COUNT(f.id_foto) FILTER (WHERE f.categoria='estructura') AS fotos_estructura
      FROM ema.actas_preconstruccion a
      LEFT JOIN ema.actas_fotos f ON f.id_acta = a.id_acta
      WHERE a.id_proyecto = $1
      GROUP BY a.id_acta
      ORDER BY a.tramo_proyecto ASC, a.fecha_relevamiento DESC
      `,
      [id_proyecto]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando actas por proyecto:', err);
    res.status(500).json({ message: 'Error interno' });
  }
}

// 2. Obtener una acta y sus fotos
async function obtenerActa(req, res) {
  const { id_acta } = req.params;
  try {
    const actaRes = await pool.query(
      `SELECT * FROM ema.actas_preconstruccion WHERE id_acta = $1`,
      [id_acta]
    );
    if (actaRes.rows.length === 0) {
      return res.status(404).json({ message: 'Acta no encontrada' });
    }
    const fotosRes = await pool.query(
      `SELECT id_foto, categoria, descripcion, ruta_archivo, orden
         FROM ema.actas_fotos
        WHERE id_acta = $1
        ORDER BY categoria, orden`,
      [id_acta]
    );
    res.json({ acta: actaRes.rows[0], fotos: fotosRes.rows });
  } catch (err) {
    console.error('Error obteniendo acta:', err);
    res.status(500).json({ message: 'Error interno' });
  }
}

// 3. Actualizar acta (meta y fotos: actualizar + borrar)
async function actualizarActa(req, res) {
  const { id_acta } = req.params;

  // Lo que manda el front (EditarActa.jsx -> handleGuardar)
  const {
    nombre_propietario,
    observaciones_fachada,
    observaciones_vereda,
    observaciones_estructura,
    fecha_relevamiento,
    nombre_arquitecto,
    matricula_arquitecto,
    direccion_predio,
    identificacion_catastral,
    tipo_cerramiento,
    revestimiento_fachada,
    estado_general_fachada,
    lista_patologias_fachada,
    material_vereda,
    estado_general_vereda,
    lista_patologias_vereda,
    tipo_estructura_visible,
    estado_elementos_estructurales,
    coordenada_x,
    coordenada_y,
    progresivas,
    lado,
    observaciones_adicionales,
    fotos,             // [{ id_foto, descripcion, orden }, ...] existentes
    fotos_eliminadas,  // [id_foto1, id_foto2, ...] a eliminar
  } = req.body;

  const client = await pool.connect();
  let pathsToDelete = [];

  try {
    await client.query('BEGIN');

    // Actualizar campos principales del acta
    await client.query(
      `
      UPDATE ema.actas_preconstruccion
      SET nombre_propietario          = $1,
          observaciones_fachada       = $2,
          observaciones_vereda        = $3,
          observaciones_estructura    = $4,
          fecha_relevamiento          = $5,
          nombre_arquitecto           = $6,
          matricula_arquitecto        = $7,
          direccion_predio            = $8,
          identificacion_catastral    = $9,
          tipo_cerramiento            = $10,
          revestimiento_fachada       = $11,
          estado_general_fachada      = $12,
          lista_patologias_fachada    = $13,
          material_vereda             = $14,
          estado_general_vereda       = $15,
          lista_patologias_vereda     = $16,
          tipo_estructura_visible     = $17,
          estado_elementos_estructurales = $18,
          coordenada_x                = $19,
          coordenada_y                = $20,
          progresivas                 = $21,
          lado                        = $22,
          observaciones_adicionales   = $23,
          actualizado_en              = now()
      WHERE id_acta = $24
      `,
      [
        safe(nombre_propietario),
        safe(observaciones_fachada),
        safe(observaciones_vereda),
        safe(observaciones_estructura),
        fecha_relevamiento || null,
        safe(nombre_arquitecto),
        safe(matricula_arquitecto),
        safe(direccion_predio),
        safe(identificacion_catastral),
        safe(tipo_cerramiento),
        safe(revestimiento_fachada),
        safe(estado_general_fachada),
        safe(lista_patologias_fachada),
        safe(material_vereda),
        safe(estado_general_vereda),
        safe(lista_patologias_vereda),
        safe(tipo_estructura_visible),
        safe(estado_elementos_estructurales),
        coordenada_x || null,
        coordenada_y || null,
        safe(progresivas),
        safe(lado),
        safe(observaciones_adicionales),
        id_acta,
      ]
    );

    // Borrar fotos (BD + luego archivos físicos)
    if (Array.isArray(fotos_eliminadas) && fotos_eliminadas.length > 0) {
      // Primero obtenemos las rutas de archivo
      const fotosPathsRes = await client.query(
        `SELECT ruta_archivo
           FROM ema.actas_fotos
          WHERE id_acta = $1
            AND id_foto = ANY($2::int[])`,
        [id_acta, fotos_eliminadas]
      );
      pathsToDelete = fotosPathsRes.rows
        .map((r) => r.ruta_archivo)
        .filter(Boolean);

      await client.query(
        `DELETE FROM ema.actas_fotos
          WHERE id_acta = $1
            AND id_foto = ANY($2::int[])`,
        [id_acta, fotos_eliminadas]
      );
    }

    // Actualizar descripciones y orden de fotos existentes
    if (Array.isArray(fotos)) {
      for (const f of fotos) {
        if (!f.id_foto) continue;
        await client.query(
          `
          UPDATE ema.actas_fotos
             SET descripcion = $1,
                 orden       = $2
           WHERE id_foto     = $3
             AND id_acta     = $4
          `,
          [
            safe(f.descripcion),
            f.orden != null ? f.orden : 0,
            f.id_foto,
            id_acta,
          ]
        );
      }
    }

    await client.query('COMMIT');

    // Borrar archivos físicos en disco (fuera de la transacción)
    for (const p of pathsToDelete) {
      try {
        await fs.promises.rm(p, { force: true });
        console.log('[ACTA][DEL] Archivo de foto eliminado:', p);
      } catch (e) {
        console.warn('[ACTA][DEL] No se pudo eliminar archivo de foto:', p, e.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando acta:', err);
    res.status(500).json({ message: 'Error interno', detalle: err.message });
  } finally {
    client.release();
  }
}

// 4. Generar PDF: si viene id_acta en query se reconstruye, si no se crea nueva (como antes)
async function generarActaPDF(req, res) {
  const { id: id_proyecto } = req.params;
  const { id_acta: queryActaId } = req.query;
  const body = req.body;
  const { files } = req; // express-fileupload

  const client = await pool.connect();
  let id_acta;
  let esReimpresion = Boolean(queryActaId);

  try {
    await client.query('BEGIN');

    if (esReimpresion) {
      // Cargar acta existente
      const actaRes = await client.query(
        `SELECT * FROM ema.actas_preconstruccion WHERE id_acta = $1 AND id_proyecto = $2`,
        [queryActaId, id_proyecto]
      );
      if (actaRes.rows.length === 0) {
        throw new Error('Acta no encontrada para reimprimir');
      }
      const acta = actaRes.rows[0];
      id_acta = acta.id_acta;

      // No reescribimos nada salvo que se quiera actualizar firmas/fotos (opcional)
    } else {
      // Crear nueva acta
      const insertActaText = `
        INSERT INTO ema.actas_preconstruccion (
          id_proyecto, id_tramo, coordenada_x, coordenada_y,
          nombre_proyecto, tramo_proyecto, fecha_relevamiento, nombre_arquitecto, matricula_arquitecto,
          direccion_predio, identificacion_catastral, nombre_propietario, cedula_propietario, contacto_propietario,
          tipo_cerramiento, revestimiento_fachada, estado_general_fachada, lista_patologias_fachada, observaciones_fachada,
          material_vereda, estado_general_vereda, lista_patologias_vereda, observaciones_vereda,
          tipo_estructura_visible, estado_elementos_estructurales, observaciones_estructura
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,$9,
          $10,$11,$12,$13,$14,
          $15,$16,$17,$18,$19,
          $20,$21,$22,$23,
          $24,$25,$26
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
        safe(body.observaciones_estructura)
      ];
      const actaRes = await client.query(insertActaText, valuesActa);
      id_acta = actaRes.rows[0].id_acta;
    }

    // 2. Crear carpetas bajo convención proyectos/{id_proyecto}/actas/{id_acta}/...
    const baseDir = path.join(__dirname, '..', 'uploads', 'proyectos', String(id_proyecto), 'actas', String(id_acta));
    const firmasDir = path.join(baseDir, 'firmas');
    await fs.promises.mkdir(firmasDir, { recursive: true });

    // Solo si NO es reimpresión y vienen archivos, guardamos firmas y fotos nuevos
    if (!esReimpresion) {
      // Guardar firmas
      let firmaPropietarioPath = null;
      let firmaArquitectoPath = null;

      if (files?.firma_propietario_img) {
        const archivo = Array.isArray(files.firma_propietario_img)
          ? files.firma_propietario_img[0]
          : files.firma_propietario_img;
        const ext = path.extname(archivo.name) || '.jpg';
        firmaPropietarioPath = path.join(firmasDir, `firma_propietario${ext}`);
        await archivo.mv(firmaPropietarioPath);
        console.log('[PDF] Firma propietario guardada en:', firmaPropietarioPath);
      }

      if (files?.firma_arquitecto_img) {
        const archivo = Array.isArray(files.firma_arquitecto_img)
          ? files.firma_arquitecto_img[0]
          : files.firma_arquitecto_img;
        const ext = path.extname(archivo.name) || '.jpg';
        firmaArquitectoPath = path.join(firmasDir, `firma_arquitecto${ext}`);
        await archivo.mv(firmaArquitectoPath);
        console.log('[PDF] Firma arquitecto guardada en:', firmaArquitectoPath);
      }

      // Guardar fotos
      const categorias = ['fachada', 'vereda', 'estructura'];
      for (const cat of categorias) {
        const fotosField = `fotos_${cat}`;
        const descField = `descripciones_${cat}`;

        const fotosRaw = files?.[fotosField];
        if (!fotosRaw) continue;
        const fotosArray = Array.isArray(fotosRaw) ? fotosRaw : [fotosRaw];

        const descripcionesRaw = body[descField];
        let descripcionesArray = [];
        if (descripcionesRaw) {
          descripcionesArray = Array.isArray(descripcionesRaw) ? descripcionesRaw : [descripcionesRaw];
        }

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
          console.log(`[PDF] Foto ${cat} #${i + 1} guardada en:`, destino, 'desc:', descripcion);
        }
      }

      // Actualizar paths de firmas en la acta
      await client.query(
        `UPDATE ema.actas_preconstruccion
           SET firma_propietario_path = $1,
               firma_arquitecto_path  = $2,
               actualizado_en         = now()
         WHERE id_acta = $3`,
        [
          null, // se usa el path generado arriba si querés guardarlo también aquí
          null,
          id_acta
        ]
      );
    }

    // Commit de la creación o lectura previa
    await client.query('COMMIT');

    // === Obtener acta actual (para reimpresión o uso) ===
    const actaFinalRes = await pool.query(
      `SELECT * FROM ema.actas_preconstruccion WHERE id_acta = $1`,
      [id_acta]
    );
    if (actaFinalRes.rows.length === 0) throw new Error('Acta no encontrada después de commit');
    const actaFinal = actaFinalRes.rows[0];

    // === Construir sección de galerías ===
    const buildGaleriaSection = async (categoria, titulo) => {
      const fotosRes = await pool.query(
        `SELECT descripcion, ruta_archivo
           FROM ema.actas_fotos 
          WHERE id_acta = $1 AND categoria = $2
          ORDER BY orden ASC`,
        [id_acta, categoria]
      );
      let inner = '<p>No hay fotos.</p>';
      if (fotosRes.rows.length > 0) {
        inner = fotosRes.rows
          .map((row, idx) => {
            const ruta = row.ruta_archivo;
            const desc = safe(row.descripcion);
            const exists = fs.existsSync(ruta);
            if (!exists) console.warn(`[PDF] La foto registrada no existe en disco [${categoria}]:`, ruta);
            const imgSrc = exists ? imagenBase64(ruta) : '';
            return `
              <div style="margin-bottom:12px; border:1px solid #ccc; padding:8px;">
                <div><strong>Foto ${idx + 1}</strong></div>
                ${desc ? `<div><strong>Descripción:</strong> ${desc}</div>` : ''}
                <div>
                  ${
                    imgSrc
                      ? `<img src="${imgSrc}" style="max-width:300px; display:block; margin-top:4px; border:1px solid #888;" />`
                      : `<div style="color:red;">No se pudo cargar la imagen desde ${ruta}</div>`
                  }
                </div>
              </div>
            `;
          })
          .join('\n');
      }
      return `
        <div>
          <h3>${titulo}</h3>
          ${inner}
        </div>
      `;
    };

    const fachadaSection   = await buildGaleriaSection('fachada',   '4.1 Fotos Fachada principal');
    const veredaSection    = await buildGaleriaSection('vereda',    '4.2 Vereda y Acceso Peatonal/Vehicular');
    const estructuraSection= await buildGaleriaSection('estructura','4.3 Estructura y Elementos Exteriores Visibles');

    // Firmas y data para HTML
    const firmaPropietarioHtml = actaFinal.firma_propietario_path
      ? `<div style="width:48%; display:inline-block; vertical-align:top; margin-right:2%;">
          <div><strong>Firma del Propietario/Ocupante</strong></div>
          <div><img src="${imagenBase64(actaFinal.firma_propietario_path)}" style="max-width:200px; height:auto; margin:8px 0; border:1px solid #444;" /></div>
          <div>Aclaración: ${safe(actaFinal.nombre_propietario)}</div>
          <div>C.I. N°: ${safe(actaFinal.cedula_propietario)}</div>
        </div>`
      : `<div style="color:orange;">No hay firma del propietario cargada</div>`;

    const firmaArquitectoHtml = actaFinal.firma_arquitecto_path
      ? `<div style="width:48%; display:inline-block; vertical-align:top;">
          <div><strong>Firma del Profesional a Cargo</strong></div>
          <div><img src="${imagenBase64(actaFinal.firma_arquitecto_path)}" style="max-width:200px; height:auto; margin:8px 0; border:1px solid #444;" /></div>
          <div>Arq. ${safe(actaFinal.nombre_arquitecto)}</div>
          <div>Mat. Prof. N°: ${safe(actaFinal.matricula_arquitecto)}</div>
        </div>`
      : `<div style="color:orange;">No hay firma del arquitecto cargada</div>`;

    // HTML final
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Acta Preconstrucción</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 12px; padding: 30px; line-height:1.3; }
            h1 { font-size: 18px; margin-bottom: 5px; }
            h2 { font-size: 16px; margin-top: 25px; }
            h3 { font-size: 14px; margin-top: 15px; }
            .section { margin-bottom: 20px; }
            .meta { margin-bottom: 6px; }
            .signatures { display: flex; gap: 20px; margin-top: 10px; }
            hr { border: none; border-top: 1px solid #ddd; margin:15px 0; }
          </style>
        </head>
        <body>
          <h1>Acta de Relevamiento de Predios Vecinos - Etapa Pre-Constructiva</h1>

          <div class="section">
            <div class="meta"><strong>Proyecto:</strong> ${safe(actaFinal.nombre_proyecto)}</div>
            <div class="meta"><strong>Tramo:</strong> ${safe(actaFinal.tramo_proyecto)}</div>
            <div class="meta"><strong>Fecha:</strong> ${safe(actaFinal.fecha_relevamiento)}</div>
            <div class="meta"><strong>Arquitecto a Cargo:</strong> ${safe(actaFinal.nombre_arquitecto)}</div>
            <div class="meta"><strong>Matrícula Profesional:</strong> ${safe(actaFinal.matricula_arquitecto)}</div>
          </div>

          <div class="section">
            <h2>1. Datos del Inmueble Relevado</h2>
            <div class="meta"><strong>Dirección del Predio:</strong> ${safe(actaFinal.direccion_predio)}</div>
            <div class="meta"><strong>Identificación Catastral:</strong> ${safe(actaFinal.identificacion_catastral)}</div>
            <div class="meta"><strong>Propietario/Ocupante:</strong> ${safe(actaFinal.nombre_propietario)}</div>
            <div class="meta"><strong>Cédula de Identidad:</strong> ${safe(actaFinal.cedula_propietario)}</div>
            <div class="meta"><strong>Contacto:</strong> ${safe(actaFinal.contacto_propietario)}</div>
          </div>

          <div class="section">
            <h2>2. Relevamiento Técnico</h2>
            <h3>Fachada</h3>
            <div class="meta"><strong>Tipo de Cerramiento:</strong> ${safe(actaFinal.tipo_cerramiento)}</div>
            <div class="meta"><strong>Revestimiento:</strong> ${safe(actaFinal.revestimiento_fachada)}</div>
            <div class="meta"><strong>Estado:</strong> ${safe(actaFinal.estado_general_fachada)}</div>
            <div class="meta"><strong>Patologías:</strong> ${safe(actaFinal.lista_patologias_fachada)}</div>
            <div class="meta"><strong>Observaciones:</strong> ${safe(actaFinal.observaciones_fachada)}</div>

            <h3>Vereda</h3>
            <div class="meta"><strong>Materialidad:</strong> ${safe(actaFinal.material_vereda)}</div>
            <div class="meta"><strong>Estado:</strong> ${safe(actaFinal.estado_general_vereda)}</div>
            <div class="meta"><strong>Patologías:</strong> ${safe(actaFinal.lista_patologias_vereda)}</div>
            <div class="meta"><strong>Observaciones:</strong> ${safe(actaFinal.observaciones_vereda)}</div>

            <h3>Estructura</h3>
            <div class="meta"><strong>Tipo:</strong> ${safe(actaFinal.tipo_estructura_visible)}</div>
            <div class="meta"><strong>Estado:</strong> ${safe(actaFinal.estado_elementos_estructurales)}</div>
            <div class="meta"><strong>Observaciones:</strong> ${safe(actaFinal.observaciones_estructura)}</div>
          </div>

          <div class="section">
            <h2>3. Registro Fotográfico</h2>
            ${fachadaSection}
            ${veredaSection}
            ${estructuraSection}
          </div>

          <div class="section">
            <h2>4. Conformidad y Cierre</h2>
            <div class="signatures">
              ${firmaPropietarioHtml}
              ${firmaArquitectoHtml}
            </div>
          </div>
        </body>
      </html>
    `;

    // Debug HTML en disco
    try {
      const debugPath = path.join(__dirname, '..', 'tmp', `debug_acta_${id_proyecto}_${Date.now()}.html`);
      await fs.promises.mkdir(path.dirname(debugPath), { recursive: true });
      await fs.promises.writeFile(debugPath, html, 'utf-8');
      console.log('[PDF] HTML de depuración escrito en:', debugPath);
    } catch (e) {
      console.warn('[PDF] No se pudo escribir HTML de debug:', e.message);
    }

    // Generar PDF
    let browser;
    try {
      browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      try {
        const shotPath = path.join(__dirname, '..', 'tmp', `preview_acta_${id_proyecto}_${Date.now()}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        console.log('[PDF] Screenshot de la página generado para debug en:', shotPath);
      } catch (e) {
        console.warn('[PDF] No se pudo generar screenshot de debug:', e.message);
      }

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=ActaPreconstruccion_${id_proyecto}.pdf`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('[PDF] Error generando PDF:', err);
      res.status(500).json({ error: 'Error interno', detalle: err.message });
    } finally {
      if (browser) await browser.close();
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PDF] Error en generarActaPDF:', err);
    res.status(500).json({ error: 'Error interno', detalle: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  listarActasPorProyecto,
  obtenerActa,
  actualizarActa,
  generarActaPDF
};
