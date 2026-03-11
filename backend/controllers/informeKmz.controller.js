// controllers/informeKmz.controller.js
"use strict";

/**
 * ✅ KMZ/KML export para INFORMES (por informe o por proyecto)
 * ✅ Si detecta 2+ coordenadas posibles => 409 needs_choice
 * ✅ Acepta ?pick=<id_pregunta> para elegir cuál coord usar
 * ✅ Incluye respuestas dentro del popup
 * ✅ Fotos por LINK PÚBLICO (/api/uploads/...) en vez de embebidas en el KMZ
 *
 * ✅ RBAC: valida scope por proyecto antes de exportar (own/all)
 */

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const proj4 = require("proj4");
const pool = require("../db");

// === carpeta uploads ABS (tu backend ya publica /uploads y /api/uploads) ===
const UPLOADS_ABS = path.join(__dirname, "..", "uploads");

// UTM 21S (Paraguay común).
const EPSG32721 = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";

/* ---------------- utils básicos ---------------- */
function toInt(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function looksLikeUploadPath(s) {
  if (!s) return false;
  const x = String(s).replace(/\\/g, "/");
  return x.includes("/uploads/") || x.startsWith("uploads/") || x.includes("/api/uploads/");
}

function toUploadsRelative(p) {
  let x = String(p).replace(/\\/g, "/").trim();
  if (!x) return null;

  if (x.startsWith("http://") || x.startsWith("https://")) {
    const idx = x.indexOf("/uploads/");
    const idx2 = x.indexOf("/api/uploads/");
    if (idx >= 0) x = x.slice(idx + "/uploads/".length);
    else if (idx2 >= 0) x = x.slice(idx2 + "/api/uploads/".length);
    else return null;
  } else {
    if (x.startsWith("/api/uploads/")) x = x.slice("/api/uploads/".length);
    else if (x.startsWith("/uploads/")) x = x.slice("/uploads/".length);
    else if (x.startsWith("uploads/")) x = x.slice("uploads/".length);
  }

  x = x.replace(/^\/+/, "");
  return x || null;
}

function safeJoinUploads(rel) {
  const clean = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.normalize(path.join(UPLOADS_ABS, clean));
  const base = path.normalize(UPLOADS_ABS + path.sep);
  if (!abs.startsWith(base)) return null;
  return abs;
}

/* ---------------- RBAC / SCOPE ---------------- */

/**
 * Lee scope para un permiso, default "all"
 * - si viene req.onlyMyProjects (CLIENTE_MAPS), forzamos own.
 */
function getPermScope(req, permCode) {
  if (req?.onlyMyProjects) return "own"; // jaula maps
  const m = req?.user?.permsScope || {};
  const s = m?.[permCode];
  return (s ? String(s) : "all").toLowerCase();
}

/**
 * ✅ Valida que el user pueda acceder a un proyecto (para scope "own").
 * Asume:
 * - clientes: req.user.id_cliente se compara con proyectos.id_proponente (y/o id_cliente si existe)
 * - consultores: req.user.id_consultor se compara con proyectos.id_consultor
 * - admin: siempre ok (y/o scope all)
 */
async function assertProyectoScope(req, idProyecto, permCode = "informes.export") {
  const idP = toInt(idProyecto, null);
  if (!idP) {
    const e = new Error("id_proyecto inválido");
    e.status = 400;
    throw e;
  }

  const scope = getPermScope(req, permCode);
  if (scope === "all") return true;

  // scope own => validar pertenencia
  const idCliente = req?.user?.id_cliente ? Number(req.user.id_cliente) : null;
  const idConsultor = req?.user?.id_consultor ? Number(req.user.id_consultor) : null;

  // Si no hay ningun vínculo, no autorizamos (scope own)
  if (!idCliente && !idConsultor) {
    const e = new Error("Sin alcance para este recurso (scope=own).");
    e.status = 403;
    throw e;
  }

  const q = `
    SELECT 1
    FROM ema.proyectos p
    WHERE p.id_proyecto = $1
      AND (
        -- cliente (en tu sistema normalmente es id_proponente)
        ($2::int IS NULL OR p.id_proponente = $2 OR (p.id_cliente IS NOT NULL AND p.id_cliente = $2))
      )
      AND (
        -- consultor
        ($3::int IS NULL OR p.id_consultor = $3)
      )
    LIMIT 1
  `;
  const r = await pool.query(q, [idP, idCliente, idConsultor]);
  if (r.rowCount > 0) return true;

  const e = new Error("No autorizado para exportar informes de este proyecto.");
  e.status = 403;
  throw e;
}

/* ---------------- coordenadas: parseo ---------------- */

// lat/lng desde objeto o array
function normalizeLngLat(obj) {
  if (!obj) return null;

  let lat = null, lng = null;

  if (Array.isArray(obj) && obj.length >= 2) {
    const a = Number(obj[0]);
    const b = Number(obj[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { lat = a; lng = b; } // [lat,lng]
      else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) { lat = b; lng = a; } // [lng,lat]
    }
  } else if (typeof obj === "object") {
    const candLat = obj.lat ?? obj.latitude ?? obj.Lat ?? obj.Latitude ?? null;
    const candLng =
      obj.lng ?? obj.lon ?? obj.long ?? obj.longitude ??
      obj.Lng ?? obj.Lon ?? obj.Longitude ?? null;

    if (candLat != null && candLng != null) {
      const a = Number(candLat);
      const b = Number(candLng);
      if (Number.isFinite(a) && Number.isFinite(b)) { lat = a; lng = b; }
    }
  }

  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

// {x,y} desde objeto
function normalizeXY(obj) {
  if (!obj || typeof obj !== "object") return null;
  const x = obj.x ?? obj.X ?? obj.easting ?? obj.Easting ?? null;
  const y = obj.y ?? obj.Y ?? obj.northing ?? obj.Northing ?? null;
  const xn = Number(x);
  const yn = Number(y);
  if (!Number.isFinite(xn) || !Number.isFinite(yn)) return null;

  const looksX = (n) => n >= 100000 && n <= 900000;
  const looksY = (n) => n >= 0 && n <= 10000000;

  if (!looksX(xn) || !looksY(yn)) return null;
  return { x: xn, y: yn };
}

// texto tipo: "465136;7210690" o "465136 7210690"
function parseXYFromText(input) {
  if (!input) return null;
  const s = String(input).trim();
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;

  let a = Number(nums[0]);
  let b = Number(nums[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const looksX = (n) => n >= 100000 && n <= 900000;
  const looksY = (n) => n >= 0 && n <= 10000000;

  let x = a, y = b;
  if (looksY(a) && looksX(b) && !looksX(a)) { x = b; y = a; }

  if (!looksX(x) || !looksY(y)) return null;
  return { x, y };
}

function utmToLatLng_32721(x, y) {
  const [lng, lat] = proj4(EPSG32721, "WGS84", [Number(x), Number(y)]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Extrae candidatos de coords de un valor cualquiera (json/text)
 * Devuelve array de { kind: "latlng"|"utm_xy", data: {lat,lng}|{x,y}, preview }
 */
function extractCoordCandidatesFromValue(value) {
  const out = [];
  if (value == null) return out;

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return out;

    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { return extractCoordCandidatesFromValue(JSON.parse(s)); } catch {}
    }

    // lat lng texto
    const nums = s.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2) {
      const a = Number(nums[0]);
      const b = Number(nums[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (Math.abs(a) <= 90 && Math.abs(b) <= 180) out.push({ kind: "latlng", data: { lat: a, lng: b }, preview: `${a}, ${b}` });
        else if (Math.abs(b) <= 90 && Math.abs(a) <= 180) out.push({ kind: "latlng", data: { lat: b, lng: a }, preview: `${b}, ${a}` });
      }
    }

    // utm texto
    const xy = parseXYFromText(s);
    if (xy) out.push({ kind: "utm_xy", data: xy, preview: `${xy.x};${xy.y}` });

    return out;
  }

  if (typeof value === "object") {
    const ll = normalizeLngLat(value);
    if (ll) out.push({ kind: "latlng", data: ll, preview: `${ll.lat}, ${ll.lng}` });

    const xy = normalizeXY(value);
    if (xy) out.push({ kind: "utm_xy", data: xy, preview: `${xy.x};${xy.y}` });

    if (Array.isArray(value)) {
      for (const it of value) out.push(...extractCoordCandidatesFromValue(it));
    } else {
      for (const k of Object.keys(value)) out.push(...extractCoordCandidatesFromValue(value[k]));
    }
  }

  return out;
}

/* ---------------- fotos + scan general ---------------- */
function deepScanForPhotosOnly(value, photosSet) {
  if (value == null) return;

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return;

    if (looksLikeUploadPath(s)) photosSet.add(s);

    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { deepScanForPhotosOnly(JSON.parse(s), photosSet); } catch {}
    }
    return;
  }

  if (typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const it of value) deepScanForPhotosOnly(it, photosSet);
    return;
  }

  for (const k of Object.keys(value)) deepScanForPhotosOnly(value[k], photosSet);
}

/* ---------------- KML helpers ---------------- */
function makeKml({ name, placemarks }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escXml(name || "Informe KMZ")}</name>
  ${placemarks.join("\n")}
</Document>
</kml>`;
}

function makePlacemarkPoint({ name, descriptionHtml, lng, lat, imageHrefs = [] }) {
  const imgs = imageHrefs.length
    ? `<div>${imageHrefs
        .map((h) => `<div style="margin-top:6px;"><img src="${escXml(h)}" style="max-width:420px;"/></div>`)
        .join("")}</div>`
    : "";

  const desc = `<![CDATA[
    <div style="font-family:Arial, sans-serif; font-size:12px;">
      ${descriptionHtml || ""}
      ${imgs}
    </div>
  ]]>`;

  return `
  <Placemark>
    <name>${escXml(name || "Punto")}</name>
    <description>${desc}</description>
    <Point><coordinates>${Number(lng)},${Number(lat)},0</coordinates></Point>
  </Placemark>`;
}

/* ---------------- formateo de respuestas ---------------- */
function formatValue(r) {
  if (r.valor_texto != null && String(r.valor_texto).trim() !== "") return String(r.valor_texto);
  if (r.valor_bool != null) return r.valor_bool ? "Sí" : "No";
  if (r.valor_json != null) {
    try { return typeof r.valor_json === "string" ? r.valor_json : JSON.stringify(r.valor_json); }
    catch { return String(r.valor_json); }
  }
  return "";
}

function buildRespuestasHtml(rows, maxItems = 120) {
  if (!rows?.length) return `<div><i>Sin respuestas</i></div>`;

  let out = "";
  let currentSec = null;
  let count = 0;

  for (const r of rows) {
    const val = formatValue(r);
    if (!val) continue;

    if (r.seccion !== currentSec) {
      if (currentSec !== null) out += `</table>`;
      currentSec = r.seccion || "Sin sección";
      out += `<div style="margin-top:10px;"><b>${escXml(currentSec)}</b></div>`;
      out += `<table style="width:100%; border-collapse:collapse; font-size:12px;">`;
    }

    out += `
      <tr>
        <td style="padding:4px; border-bottom:1px solid #ddd; width:45%;"><b>${escXml(r.etiqueta)}</b></td>
        <td style="padding:4px; border-bottom:1px solid #ddd;">${escXml(val)}</td>
      </tr>
    `;

    count++;
    if (count >= maxItems) {
      out += `</table><div style="margin-top:8px;"><i>Mostrando ${maxItems} respuestas (hay más).</i></div>`;
      return out;
    }
  }

  if (currentSec !== null) out += `</table>`;
  if (!out) return `<div><i>Sin respuestas</i></div>`;
  return out;
}

/* ---------------- DB Queries (tu esquema real) ---------------- */

// Header + proyecto (para validar scope)
async function fetchInformeHeaderWithProyecto(idInforme) {
  const q = `
    SELECT
      i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado, i.creado_por,
      p.id_proponente, p.id_consultor,
      p.id_cliente -- si existe en tu tabla; si no existe, Postgres va a tirar error
    FROM ema.informe i
    JOIN ema.proyectos p ON p.id_proyecto = i.id_proyecto
    WHERE i.id_informe = $1
    LIMIT 1
  `;
  try {
    const r = await pool.query(q, [idInforme]);
    return r.rows?.[0] || null;
  } catch (e) {
    // Si tu tabla ema.proyectos NO tiene id_cliente, reintentamos sin esa columna
    const q2 = `
      SELECT
        i.id_informe, i.id_proyecto, i.id_plantilla, i.titulo, i.fecha_creado, i.creado_por,
        p.id_proponente, p.id_consultor
      FROM ema.informe i
      JOIN ema.proyectos p ON p.id_proyecto = i.id_proyecto
      WHERE i.id_informe = $1
      LIMIT 1
    `;
    const r2 = await pool.query(q2, [idInforme]);
    return r2.rows?.[0] || null;
  }
}

async function fetchInformeRespuestasDetalladas(idInforme) {
  const q = `
    SELECT
      ir.id_pregunta,
      s.titulo AS seccion,
      s.orden  AS seccion_orden,
      p.etiqueta,
      p.tipo,
      p.orden AS pregunta_orden,
      ir.valor_texto,
      ir.valor_bool,
      ir.valor_json
    FROM ema.informe_respuesta ir
    JOIN ema.informe_pregunta p ON p.id_pregunta = ir.id_pregunta
    JOIN ema.informe_seccion  s ON s.id_seccion  = p.id_seccion
    WHERE ir.id_informe = $1
    ORDER BY s.orden ASC, p.orden ASC, ir.id_pregunta ASC
  `;
  const r = await pool.query(q, [idInforme]);
  return r.rows || [];
}

async function fetchInformeFotos(idInforme) {
  const q = `
    SELECT id_foto, ruta_archivo, descripcion, orden, id_pregunta
    FROM ema.informe_foto
    WHERE id_informe = $1
    ORDER BY orden ASC, id_foto ASC
  `;
  const r = await pool.query(q, [idInforme]);
  return r.rows || [];
}

async function fetchInformesByProyecto(idProyecto, idPlantilla = null) {
  const p = [idProyecto];
  let where = `WHERE id_proyecto = $1`;
  if (idPlantilla != null) {
    p.push(idPlantilla);
    where += ` AND id_plantilla = $2`;
  }

  const q = `
    SELECT id_informe, id_proyecto, id_plantilla, titulo, fecha_creado, creado_por
    FROM ema.informe
    ${where}
    ORDER BY fecha_creado DESC NULLS LAST, id_informe DESC
  `;
  const r = await pool.query(q, p);
  return r.rows || [];
}

/* ---------------- PUBLIC BASE (para links de fotos) ---------------- */

function getPublicApiBase(req) {
  const envBase =
    process.env.PUBLIC_API_URL ||
    process.env.PUBLIC_API_BASE ||
    process.env.PUBLIC_BASE_URL ||
    process.env.PUBLIC_URL;

  if (envBase && String(envBase).trim()) {
    let b = String(envBase).trim().replace(/\/+$/, "");
    if (!b.endsWith("/api")) b += "/api";
    return b;
  }

  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] || "").split(",")[0].trim() || req.get("host");
  if (!host) return "http://localhost:4000/api";

  return `${proto}://${host}`.replace(/\/+$/, "") + "/api";
}

function toPublicUploadsUrl(publicApiBase, rel) {
  const base = String(publicApiBase || "").replace(/\/+$/, "");
  const safeRel = String(rel || "").replace(/^\/+/, "");
  return `${base}/uploads/${encodeURI(safeRel)}`;
}

/* ---------------- builder ---------------- */

function dedupeCandidates(cands) {
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    const key =
      c.kind === "latlng"
        ? `latlng:${c.data.lat.toFixed(8)},${c.data.lng.toFixed(8)}`
        : `utm:${Math.round(c.data.x)},${Math.round(c.data.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function buildPlacemarksFromInforme(req, idInforme, opts = {}) {
  const pickIdPregunta = opts.pickIdPregunta ? toInt(opts.pickIdPregunta, null) : null;
  const publicApiBase = String(opts.publicApiBase || "").trim();

  const header = await fetchInformeHeaderWithProyecto(idInforme);
  if (!header) {
    const err = new Error("Informe no encontrado");
    err.status = 404;
    throw err;
  }

  // ✅ RBAC: validar alcance por proyecto ANTES de seguir
  await assertProyectoScope(req, header.id_proyecto, "informes.export");

  const respuestas = await fetchInformeRespuestasDetalladas(idInforme);
  const fotosDb = await fetchInformeFotos(idInforme);

  const candidatesByPregunta = [];
  const photosSet = new Set();

  for (const r of respuestas) {
    deepScanForPhotosOnly(r.valor_json, photosSet);
    deepScanForPhotosOnly(r.valor_texto, photosSet);

    const tipo = String(r.tipo || "").toLowerCase();
    const etiqLower = String(r.etiqueta || "").toLowerCase();
    if (tipo.includes("foto") || etiqLower.includes("foto")) {
      if (r.valor_texto) photosSet.add(String(r.valor_texto));
    }

    const local = [];
    local.push(...extractCoordCandidatesFromValue(r.valor_json));
    local.push(...extractCoordCandidatesFromValue(r.valor_texto));

    const uniqLocal = dedupeCandidates(local);
    for (const c of uniqLocal) {
      candidatesByPregunta.push({
        id_pregunta: r.id_pregunta,
        etiqueta: r.etiqueta,
        kind: c.kind,
        data: c.data,
        preview: c.preview,
      });
    }
  }

  if (!pickIdPregunta) {
    const byQ = new Map();
    for (const c of candidatesByPregunta) {
      const k = String(c.id_pregunta);
      if (!byQ.has(k)) byQ.set(k, []);
      byQ.get(k).push(c);
    }
    const manyQuestions = byQ.size >= 2;
    const anyMultiInSame = [...byQ.values()].some((arr) => arr.length >= 2);

    if (manyQuestions || anyMultiInSame) {
      const err = new Error("Se detectaron múltiples coordenadas posibles. Elegí cuál usar.");
      err.status = 409;
      err.payload = {
        needs_choice: true,
        id_informe: header.id_informe,
        candidates: candidatesByPregunta.map((c) => ({
          id_pregunta: c.id_pregunta,
          etiqueta: c.etiqueta,
          kind: c.kind,
          preview: c.preview,
        })),
        hint: "Reintentar con ?pick=<id_pregunta> para usar las coordenadas de esa pregunta.",
      };
      throw err;
    }
  }

  let chosen = null;
  if (pickIdPregunta) {
    const list = candidatesByPregunta.filter((c) => c.id_pregunta === pickIdPregunta);
    if (!list.length) {
      const err = new Error("La pregunta seleccionada no tiene coordenadas detectables.");
      err.status = 422;
      throw err;
    }
    chosen = list.find((x) => x.kind === "utm_xy") || list.find((x) => x.kind === "latlng") || list[0];
  } else {
    chosen = candidatesByPregunta[0] || null;
  }

  if (!chosen) {
    const err = new Error("El informe no tiene coordenadas detectables para exportar KMZ.");
    err.status = 422;
    throw err;
  }

  let ll = null;
  if (chosen.kind === "latlng") ll = chosen.data;
  else if (chosen.kind === "utm_xy") {
    ll = utmToLatLng_32721(chosen.data.x, chosen.data.y);
    if (!ll) {
      const err = new Error("No se pudo convertir X/Y a lat/lng (UTM).");
      err.status = 422;
      throw err;
    }
  }

  for (const f of fotosDb) {
    if (f?.ruta_archivo) photosSet.add(String(f.ruta_archivo));
  }

  const photoItems = [];
  for (const raw of photosSet) {
    const rel = toUploadsRelative(raw);
    if (!rel) continue;

    const abs = safeJoinUploads(rel);
    if (!abs) continue;
    if (!fs.existsSync(abs)) continue;

    const href = publicApiBase ? toPublicUploadsUrl(publicApiBase, rel) : null;
    if (!href) continue;

    photoItems.push({ raw, rel, abs, href });
  }

  const title = header.titulo || `Informe ${header.id_informe}`;

  const headerHtml = `
    <div><b>${escXml(title)}</b></div>
    <div>Informe ID: ${escXml(header.id_informe)}</div>
    <div>Proyecto ID: ${escXml(header.id_proyecto)}</div>
    <div>Plantilla ID: ${escXml(header.id_plantilla)}</div>
    <div>Fecha: ${escXml(header.fecha_creado ? new Date(header.fecha_creado).toLocaleString("es-PY") : "-")}</div>
    <div style="margin-top:6px;">
      <b>Coord usada:</b> ${escXml(chosen.etiqueta)} (${escXml(chosen.kind)}) → ${escXml(
        chosen.kind === "utm_xy" ? `${chosen.data.x};${chosen.data.y}` : `${ll.lat}, ${ll.lng}`
      )}
    </div>
    <hr/>
  `;

  const respuestasHtml = buildRespuestasHtml(respuestas, 120);
  const descHtml = `${headerHtml}${respuestasHtml}`;

  const placemarks = [
    makePlacemarkPoint({
      name: `${title}`,
      descriptionHtml: descHtml,
      lng: ll.lng,
      lat: ll.lat,
      imageHrefs: photoItems.slice(0, 12).map((p) => p.href),
    }),
  ];

  return { header, placemarks, photoItems };
}

/* ---------------- writer ---------------- */
async function streamKmzResponse(res, { fileName, kmlText }) {
  res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => {
    console.error("KMZ archive error:", err);
    try { res.status(500).end("Error creando KMZ"); } catch {}
  });

  archive.pipe(res);
  archive.append(kmlText, { name: "doc.kml" });

  // ✅ NO embebemos imágenes (se cargan por URL pública)
  await archive.finalize();
}

/* ---------------- handlers ---------------- */

async function kmzByInforme(req, res) {
  try {
    const idInforme = toInt(req.params.id, null);
    if (!idInforme) return res.status(400).json({ error: "id_informe inválido" });

    const pick = req.query.pick != null ? toInt(req.query.pick, null) : null;
    const publicApiBase = getPublicApiBase(req);

    const { header, placemarks } = await buildPlacemarksFromInforme(req, idInforme, {
      pickIdPregunta: pick,
      publicApiBase,
    });

    const name = header.titulo || `Informe_${header.id_informe}`;
    const kml = makeKml({ name, placemarks });

    const fileName = `Informe_${header.id_informe}.kmz`;
    return await streamKmzResponse(res, { fileName, kmlText: kml });
  } catch (e) {
    console.error("kmzByInforme error:", e);
    if (e.status === 409 && e.payload) return res.status(409).json(e.payload);
    return res.status(e.status || 500).json({ error: e.message || "Error generando KMZ" });
  }
}

async function kmzByProyecto(req, res) {
  try {
    const idProyecto = toInt(req.params.idProyecto, null);
    if (!idProyecto) return res.status(400).json({ error: "id_proyecto inválido" });

    // ✅ RBAC: validar alcance por proyecto ANTES de listar informes
    await assertProyectoScope(req, idProyecto, "informes.export");

    const idPlantilla = req.query.plantilla != null ? toInt(req.query.plantilla, null) : null;

    const informes = await fetchInformesByProyecto(idProyecto, idPlantilla);
    if (!informes.length) return res.status(404).json({ error: "No hay informes para el proyecto" });

    const pickGlobal = req.query.pick != null ? toInt(req.query.pick, null) : null;
    const publicApiBase = getPublicApiBase(req);

    const allPlacemarks = [];

    for (const inf of informes) {
      try {
        const built = await buildPlacemarksFromInforme(req, inf.id_informe, {
          pickIdPregunta: pickGlobal,
          publicApiBase,
        });
        for (const pm of built.placemarks) allPlacemarks.push(pm);
      } catch (e) {
        if (e.status === 409 && e.payload) {
          return res.status(409).json({
            needs_choice: true,
            scope: "proyecto",
            id_proyecto: idProyecto,
            id_informe: inf.id_informe,
            ...e.payload,
            hint: "Reintentar con ?pick=<id_pregunta> (global) para aplicar a todos los informes del proyecto.",
          });
        }
        // ignorar informes sin coords u otros errores puntuales
      }
    }

    if (!allPlacemarks.length) {
      return res.status(422).json({
        error: "No se detectaron coordenadas en los informes del proyecto para exportar KMZ.",
        id_proyecto: idProyecto,
      });
    }

    const kml = makeKml({
      name: `Proyecto ${idProyecto} - Informes`,
      placemarks: allPlacemarks,
    });

    const fileName = `Proyecto_${idProyecto}_Informes${idPlantilla ? `_Plantilla_${idPlantilla}` : ""}.kmz`;
    return await streamKmzResponse(res, { fileName, kmlText: kml });
  } catch (e) {
    console.error("kmzByProyecto error:", e);
    if (e.status === 409 && e.payload) return res.status(409).json(e.payload);
    return res.status(e.status || 500).json({ error: e.message || "Error generando KMZ" });
  }
}

module.exports = { kmzByInforme, kmzByProyecto };
