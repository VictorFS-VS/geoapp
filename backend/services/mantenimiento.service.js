// services/mantenimiento.service.js
// ✅ COMPLETO + ACTUALIZADO
// ✅ FIX “ST_GeomFromGeoJSON(integer)” -> fuerza ::text en el placeholder
// ✅ SOPORTE: ema.bloque_expediente (y mejoras/terreno) con id_expediente
// ✅ SOPORTE NUEVO: KML / KMZ (via ogr2ogr y /vsizip/)
// ✅ FIX TRAMOS:
// - si no viene id_tramo en atributos, lo busca por nombre en ema.tramos
// - si coincide tramo_nombre / tramo_desc con ema.tramos.nombre_tramo_norm => guarda id_tramo
// ✅ DEVUELVE: número de filas insertadas (inserted) para que tu controller use addCount()

"use strict";

const path = require("path");
const pool = require("../db");
const { attachGdalSpawnError, spawnGdal } = require("../utils/gdal");

// =======
// Config
// =======
const DB_SRID = 32721;

// =====================
// Helpers (pick/geom)
// =====================
function pick(obj, ...keys) {
  if (!obj) return undefined;

  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];

    const ku = String(k).toUpperCase();
    const kl = String(k).toLowerCase();
    if (obj[ku] !== undefined && obj[ku] !== null) return obj[ku];
    if (obj[kl] !== undefined && obj[kl] !== null) return obj[kl];
  }

  const map = {};
  for (const realKey of Object.keys(obj)) map[String(realKey).toLowerCase()] = realKey;

  for (const k of keys) {
    const real = map[String(k).toLowerCase()];
    if (real && obj[real] !== undefined && obj[real] !== null) return obj[real];
  }
  return undefined;
}

function asText(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function asNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeTramoName(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

async function buscarIdTramoPorNombre(idProyecto, nombreRaw) {
  const nombre = String(nombreRaw || "").trim();
  if (!nombre) return null;

  const norm = normalizeTramoName(nombre);
  if (!norm) return null;

  const { rows } = await pool.query(
    `
    SELECT id_tramo
    FROM ema.tramos
    WHERE id_proyecto = $1
      AND nombre_tramo_norm = $2
    LIMIT 1
    `,
    [Number(idProyecto), norm]
  );

  return rows?.[0]?.id_tramo ?? null;
}

async function getOrCreateTramo(idProyecto, nombreTramoRaw) {
  const raw = String(nombreTramoRaw || "").trim();
  if (!raw) return null;

  const norm = normalizeTramoName(raw);

  const sql = `
    WITH ins AS (
      INSERT INTO ema.tramos (id_proyecto, nombre_tramo)
      VALUES ($1, $2)
      ON CONFLICT (id_proyecto, nombre_tramo_norm)
      DO UPDATE SET nombre_tramo = EXCLUDED.nombre_tramo
      RETURNING id_tramo
    )
    SELECT id_tramo FROM ins
    UNION ALL
    SELECT id_tramo
    FROM ema.tramos
    WHERE id_proyecto = $1
      AND nombre_tramo_norm = $3
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [Number(idProyecto), raw, norm]);
  return rows?.[0]?.id_tramo ?? null;
}

/**
 * ✅ FIX CLAVE:
 * - ST_GeomFromGeoJSON(($n)::text) para evitar que Postgres lo interprete como integer
 */
function geomExpr(paramIndex, srid = DB_SRID) {
  return `
    ST_SetSRID(
      ST_MakeValid(
        ST_Force2D(
          ST_GeomFromGeoJSON(($${paramIndex})::text)
        )
      ),
      ${srid}
    )
  `;
}

// ==============================
// Vector -> GeoJSON features (ogr2ogr)
// ✅ Soporta SHP, KML, GeoJSON, GPKG, etc.
// ==============================
function vectorToGeoJSONFeatures(inputPath, srid = DB_SRID) {
  return new Promise((resolve, reject) => {
    const args = [
      "-f",
      "GeoJSON",
      "/vsistdout/",
      inputPath,
      "-t_srs",
      `EPSG:${Number(srid)}`,
      "-skipfailures",
      "-explodecollections",
    ];

    const p = spawnGdal("ogr2ogr", args);
    attachGdalSpawnError(p, reject);

    let out = "";
    let err = "";

    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.stderr.on("data", (d) => (err += d.toString("utf8")));

    p.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`ogr2ogr GeoJSON falló (${code}): ${err || "sin detalle"}`));
      }
      let json;
      try {
        json = JSON.parse(out);
      } catch {
        return reject(new Error("No se pudo parsear el GeoJSON generado por ogr2ogr."));
      }
      const feats = Array.isArray(json?.features) ? json.features : [];
      resolve(feats.filter((f) => f && f.geometry));
    });
  });
}

// ==============================
// KMZ -> GeoJSON features
// ✅ Intenta varias rutas típicas usando /vsizip/
// ==============================
async function kmzToGeoJSONFeatures(kmzPath, srid = DB_SRID) {
  const base = path.basename(kmzPath, path.extname(kmzPath));

  const tries = [
    kmzPath,
    `/vsizip/${kmzPath}`,
    `/vsizip/${kmzPath}/doc.kml`,
    `/vsizip/${kmzPath}/${base}.kml`,
  ];

  let lastErr = null;

  for (const t of tries) {
    try {
      const feats = await vectorToGeoJSONFeatures(t, srid);
      if (feats.length) return feats;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("No se pudo leer el KMZ (no se encontraron features).");
}

// ==============================
// SHP/KML/KMZ -> GeoJSON features
// ==============================
async function anyToGeoJSONFeatures(filePath, srid = DB_SRID) {
  const ext = String(path.extname(filePath) || "").toLowerCase();
  if (ext === ".kmz") return kmzToGeoJSONFeatures(filePath, srid);
  return vectorToGeoJSONFeatures(filePath, srid);
}

// ==============================
// Tabla permitida (defensivo)
// ==============================
const ALLOWED_TABLES = new Set([
  "ema.poligono_proyecto",
  "ema.bloques_uso_actual",
  "ema.bloques_uso_alternativo",
  "ema.bloques_uso86",
  "ema.plano_proyecto",
  "ema.bloques_tramo",
  "ema.bloques_comu_ind",
  "ema.bloques_area_influensia",
  "ema.bloque_mejoras",
  "ema.bloque_terreno",
  "ema.bloque_expediente",
]);

/**
 * cargarShapefileEnProyecto
 * - ✅ AHORA: acepta SHP, KML y KMZ (además de lo anterior)
 * - Convierte a GeoJSON features
 * - Inserta row-by-row según tablaDestino
 * - Devuelve: inserted (número)
 *
 * @param {string} shpPath  (compat: puede ser .shp, .kml o .kmz)
 * @param {string} dbfPath (no se usa, pero lo dejás por compatibilidad)
 * @param {string} shxPath (no se usa, pero lo dejás por compatibilidad)
 * @param {string} tablaDestino
 * @param {number|string} idProyecto
 * @param {number|null} idExpediente
 * @returns {Promise<number>}
 */
async function cargarShapefileEnProyecto(shpPath, dbfPath, shxPath, tablaDestino, idProyecto, idExpediente = null) {
  if (!ALLOWED_TABLES.has(tablaDestino)) {
    throw new Error(`Tabla destino no permitida: ${tablaDestino}`);
  }

  const feats = await anyToGeoJSONFeatures(shpPath, DB_SRID);

  let inserted = 0;

  for (const feat of feats) {
    const props = feat.properties || {};
    const geom = feat.geometry;
    if (!geom) continue;

    const geomStr = JSON.stringify(geom);

    // =========================
    // POLIGONO PROYECTO
    // =========================
    if (tablaDestino === "ema.poligono_proyecto") {
      await pool.query(
        `
        INSERT INTO ema.poligono_proyecto (id_proyecto, geom)
        VALUES ($1, ${geomExpr(2)})
        `,
        [Number(idProyecto), geomStr]
      );
      inserted++;
      continue;
    }

    // =========================
    // USOS (id_colonia)
    // =========================
    if (["ema.bloques_uso_actual", "ema.bloques_uso_alternativo", "ema.bloques_uso86"].includes(tablaDestino)) {
      await pool.query(
        `
        INSERT INTO ${tablaDestino} (id_colonia, geom)
        VALUES ($1, ${geomExpr(2)})
        `,
        [Number(idProyecto), geomStr]
      );
      inserted++;
      continue;
    }

    // =========================
    // PLANO PROYECTO
    // =========================
    if (tablaDestino === "ema.plano_proyecto") {
      const categoria = asText(pick(props, "categoria", "CATEGORIA", "cat", "CAT"));
      const uso = asText(pick(props, "uso", "USO"));
      const area_m2 = asNum(pick(props, "area_m2", "AREA_M2", "area", "AREA"), 0);

      await pool.query(
        `
        INSERT INTO ema.plano_proyecto (id_proyecto, categoria, uso, area_m2, geom)
        VALUES ($1, $2, $3, $4, ${geomExpr(5)})
        `,
        [Number(idProyecto), categoria, uso, area_m2, geomStr]
      );
      inserted++;
      continue;
    }

    // =========================
    // TRAMOS
    // =========================
    if (tablaDestino === "ema.bloques_tramo") {
      const uso = asText(pick(props, "uso", "USO"));
      const area_m2 = asNum(pick(props, "area_m2", "AREA_M2", "area", "AREA"), 0);
      const porcentaje = asNum(pick(props, "porcentaje", "PORCENTAJE", "pct", "PCT"), 0);

      const tramo_nombre =
        asText(
          pick(
            props,
            "tramo_nombre",
            "TRAMO_NOMBRE",
            "nombre_tramo",
            "NOMBRE_TRAMO",
            "tramos",
            "TRAMOS",
            "name",
            "NAME"
          )
        ) || null;

      const tramo_desc =
        asText(
          pick(
            props,
            "tramo_desc",
            "TRAMO_DESC",
            "descripcion",
            "DESCRIPCION",
            "desc",
            "DESC",
            "description",
            "DESCRIPTION"
          )
        ) || null;

      let id_tramo = (() => {
        const v = Number(pick(props, "id_tramo", "ID_TRAMO"));
        return Number.isFinite(v) && v > 0 ? v : null;
      })();

      // ✅ Si no vino id_tramo en el archivo, intentar resolver por nombre
      if (!id_tramo) {
        const nombreParaMatch = tramo_nombre || tramo_desc || null;
        if (nombreParaMatch) {
          id_tramo = await buscarIdTramoPorNombre(idProyecto, nombreParaMatch);

          // opcional defensivo: si no existe en ema.tramos, lo crea
          if (!id_tramo) {
            id_tramo = await getOrCreateTramo(idProyecto, nombreParaMatch);
          }
        }
      }

      await pool.query(
        `
        INSERT INTO ema.bloques_tramo
          (id_tramo, uso, area_m2, porcentaje, tramo_desc, tramo_nombre, id_proyecto, geom)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, ${geomExpr(8)})
        `,
        [
          id_tramo,
          uso,
          area_m2,
          porcentaje,
          tramo_desc,
          tramo_nombre,
          Number(idProyecto),
          geomStr,
        ]
      );
      inserted++;
      continue;
    }

    // =========================
    // COMUNIDADES INDIGENAS
    // =========================
    if (tablaDestino === "ema.bloques_comu_ind") {
      const name = asText(pick(props, "name", "NAME", "nombre", "NOMBRE", "title", "TITLE")) || "COMU_INDI";
      const descripcion = asText(pick(props, "descripcion", "DESCRIPCION", "Description", "description", "desc", "DESC")) || "";

      await pool.query(
        `
        INSERT INTO ema.bloques_comu_ind (id_proyecto, name, descripcion, geom)
        VALUES ($1, $2, $3, ${geomExpr(4)})
        `,
        [Number(idProyecto), name, descripcion, geomStr]
      );
      inserted++;
      continue;
    }

    // =========================
    // AREA INFLUENSIA
    // =========================
    if (tablaDestino === "ema.bloques_area_influensia") {
      const name = asText(pick(props, "name", "NAME", "nombre", "NOMBRE", "title", "TITLE"));
      const descripcion = asText(pick(props, "descripcion", "DESCRIPCION", "Description", "description", "desc", "DESC"));

      await pool.query(
        `
        INSERT INTO ema.bloques_area_influensia (id_proyecto, name, descripcion, geom)
        VALUES ($1, $2, $3, ${geomExpr(4)})
        `,
        [Number(idProyecto), name, descripcion, geomStr]
      );
      inserted++;
      continue;
    }

    // =========================
    // MEJORAS / TERRENO / EXPEDIENTE (con id_expediente)
    // =========================
    if (["ema.bloque_mejoras", "ema.bloque_terreno", "ema.bloque_expediente"].includes(tablaDestino)) {
      const name = asText(pick(props, "name", "NAME", "nombre", "NOMBRE", "title", "TITLE")) || "";
      const descripcion = asText(pick(props, "descripcion", "DESCRIPCION", "Description", "description", "desc", "DESC")) || "";

      await pool.query(
        `
        INSERT INTO ${tablaDestino} (id_proyecto, id_expediente, name, descripcion, geom)
        VALUES ($1, $2, $3, $4, ${geomExpr(5)})
        `,
        [Number(idProyecto), idExpediente ? Number(idExpediente) : null, name, descripcion, geomStr]
      );
      inserted++;
      continue;
    }
  }

  return inserted;
}

module.exports = {
  cargarShapefileEnProyecto,
};
