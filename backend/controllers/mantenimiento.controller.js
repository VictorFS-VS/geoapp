// controllers/mantenimiento.controller.js
// ✅ COMPLETO + ACTUALIZADO (mantenimiento + export + endpoints)
// ✅ NUEVO (para Expedientes):
// - Devuelve { ok, inserted, byTable } para que el FRONT marque el check SOLO si inserted > 0
// - Si NO se insertó nada => responde 400 con ok:false / inserted:0
// ✅ FIX TRAMOS:
// - syncTramosConBloques ahora normaliza correctamente
// - resuelve id_tramo por nombre coincidente de forma consistente

const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const AdmZip = require("adm-zip");

let Unrar = null;
try {
  Unrar = require("node-unrar-js");
} catch {
  /* RAR opcional */
}

let tokml;
try {
  tokml = require("tokml");
} catch {
  tokml = null;
  console.error("Falta 'tokml' (npm i tokml)");
}

const { DOMParser } = require("@xmldom/xmldom");
const tj = require("@tmcw/togeojson");

const pool = require("../db");
const { cargarShapefileEnProyecto } = require("../services/mantenimiento.service");
const { crearNotificacion } = require("./notificaciones.controller");
const {
  applyGdalProcessEnv,
  attachGdalSpawnError,
  getConfiguredGdalData,
  getConfiguredProjData,
  isGdalSpawnError,
  spawnGdal,
} = require("../utils/gdal");

// ===========================
// FIX DEFINITIVO GDAL / PROJ
// ===========================
applyGdalProcessEnv(process.env);
const PROJ_DATA = getConfiguredProjData();
const GDAL_DATA = getConfiguredGdalData();

/* ===========================
   ✅ CRS: regla del sistema
   =========================== */
const DB_SRID = 32721; // BD
const OUT_SRID = 4326; // Visor / GeoJSON / KML/KMZ

// ✅ NUEVO: si un SHP viene sin .prj, asumimos este SRID como "origen"
const DEFAULT_INPUT_SRID = 32721;

// ✅ DEBUG opcional
const DEBUG_GEOM_POINTS = String(process.env.DEBUG_GEOM_POINTS || "").trim() === "1";

/* ===========================
   ✅ Helper: args --config GDAL/PROJ
   =========================== */
function gdalConfigArgs() {
  return [
    "--config",
    "PROJ_DATA",
    PROJ_DATA,
    "--config",
    "PROJ_LIB",
    PROJ_DATA,
    "--config",
    "GDAL_DATA",
    GDAL_DATA,
    "--config",
    "PROJ_NETWORK",
    "OFF",
  ];
}

/* ===========================
   Helpers generales
   =========================== */
function normalizeBaseForMatch(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function isExt(p, ext) {
  return path.extname(p).toLowerCase() === ext;
}
function isAny(p, exts) {
  return exts.includes(path.extname(p).toLowerCase());
}
function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const ents = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of ents) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out;
}

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

// ✅ evita overwrite en copias internas
function uniquePath(destDir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(destDir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  let i = 1;
  while (true) {
    const next = path.join(destDir, `${base}(${i})${ext}`);
    if (!fs.existsSync(next)) return next;
    i++;
  }
}

function copyWithUniqueName(src, destDir, filename) {
  ensureDir(destDir);
  const target = uniquePath(destDir, filename);
  fs.copyFileSync(src, target);
  return target;
}

/* ============================================================
   ✅ FIX PISADO: base única vs base lógica
   - baseUnique: "CARPETA__TRAMO"
   - logicalBase: "TRAMO" (lo que usamos para tabla/mapping)
   ============================================================ */
function splitUniqueBase(baseUpper) {
  const s = String(baseUpper || "").toUpperCase();
  if (!s.includes("__")) return { baseUnique: s, logicalBase: s, parentBase: null };
  const parts = s.split("__").filter(Boolean);
  const logicalBase = parts[parts.length - 1] || s;
  const parentBase = parts.slice(0, -1).join("__") || null;
  return { baseUnique: s, logicalBase, parentBase };
}

/* ============================================================
   ✅ Detectar extent con ogrinfo (si no hay PRJ)
   ============================================================ */
function ogrInfoExtent(shpPath) {
  return new Promise((resolve, reject) => {
    const args = [...gdalConfigArgs(), "-so", "-al", shpPath];
    const p = spawnGdal("ogrinfo", args);
    attachGdalSpawnError(p, reject);

    let out = "";
    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.on("close", () => {
      const m = out.match(
        /Extent:\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*-\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i
      );
      if (!m) return resolve(null);
      resolve({
        xMin: Number(m[1]),
        yMin: Number(m[2]),
        xMax: Number(m[3]),
        yMax: Number(m[4]),
        raw: out,
      });
    });
  });
}

async function guessInputSridIfNoPrj(shpPath, fallbackSrid) {
  const ext = await ogrInfoExtent(shpPath);
  if (!ext) return fallbackSrid;

  const maxAbsX = Math.max(Math.abs(ext.xMin), Math.abs(ext.xMax));
  const maxAbsY = Math.max(Math.abs(ext.yMin), Math.abs(ext.yMax));

  if (maxAbsX === 0 && maxAbsY === 0) return fallbackSrid;

  const looksLike4326 = maxAbsX <= 180 && maxAbsY <= 90;
  if (looksLike4326) return 4326;

  return 32721;
}

/* ===========================
   ✅ TRAMOS: getOrCreate por (id_proyecto + nombre_tramo_norm)
   =========================== */
async function getOrCreateTramoWithClient(client, idProyecto, nombreTramoRaw) {
  const raw = String(nombreTramoRaw || "").trim();
  if (!raw) return null;

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
    LIMIT 1;
  `;
  const { rows } = await client.query(sql, [Number(idProyecto), raw, normalizeTramoName(raw)]);
  return rows?.[0]?.id_tramo ?? null;
}

async function getOrCreateTramo(idProyecto, nombreTramoRaw) {
  const client = await pool.connect();
  try {
    return await getOrCreateTramoWithClient(client, idProyecto, nombreTramoRaw);
  } finally {
    client.release();
  }
}

/* ===========================
   ✅ Seguridad ZIP/RAR
   =========================== */
function safeJoin(baseDir, fileName) {
  const safeName = String(fileName || "").replace(/\\/g, "/");
  const target = path.normalize(path.join(baseDir, safeName));
  const baseNorm = path.normalize(baseDir + path.sep);
  if (!target.startsWith(baseNorm))
    throw new Error("Entrada comprimida inválida (path traversal).");
  return target;
}

function extractZipSafe(zipFile, outDir) {
  const zip = new AdmZip(zipFile);
  ensureDir(outDir);
  for (const entry of zip.getEntries()) {
    const rel = entry.entryName;
    const dest = safeJoin(outDir, rel);
    if (entry.isDirectory) {
      ensureDir(dest);
      continue;
    }
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, entry.getData());
  }
}

/* ===========================
   ✅ Conversión formatos → SHP
   =========================== */
const CONVERTIBLE_EXTS = new Set([".geojson", ".json", ".gpkg", ".gpx", ".gml", ".dxf", ".csv"]);

function ogrConvertToShp(inputPath, outDir, outBaseName) {
  return new Promise((resolve, reject) => {
    ensureDir(outDir);
    const outPath = path.join(outDir, `${outBaseName}.shp`);

    const args = [
      ...gdalConfigArgs(),
      "-f",
      "ESRI Shapefile",
      outPath,
      inputPath,
      "-overwrite",
      "-lco",
      "ENCODING=UTF-8",
      "-skipfailures",
    ];

    const p = spawnGdal("ogr2ogr", args);
    attachGdalSpawnError(p, reject);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString("utf8")));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ogr2ogr convert falló (${code}): ${err || "sin detalle"}`));
      resolve(outPath);
    });
  });
}

/* ============================================================
   ✅ SHP → SHP reproyectado a DB_SRID
   ============================================================ */
function ogrReprojectShpToDbSrid(shpPath, outDir, outBaseName, inputSrid = DEFAULT_INPUT_SRID, nlt = null) {
  return new Promise(async (resolve, reject) => {
    try {
      ensureDir(outDir);
      const outPath = path.join(outDir, `${outBaseName}.shp`);

      const prjPath = shpPath.replace(/\.shp$/i, ".prj");
      const hasPrj = fs.existsSync(prjPath);

      let sridToUse = Number(inputSrid) || DEFAULT_INPUT_SRID;
      if (!hasPrj) {
        sridToUse = await guessInputSridIfNoPrj(shpPath, sridToUse);
        console.log(`🧭 Sin .prj => asumimos EPSG:${sridToUse} para ${path.basename(shpPath)}`);
      }

      const args = [
        ...gdalConfigArgs(),
        "-f",
        "ESRI Shapefile",
        outPath,
        shpPath,
        "-overwrite",
        ...(hasPrj ? [] : ["-s_srs", `EPSG:${sridToUse}`]),
        "-t_srs",
        `EPSG:${DB_SRID}`,
        "-lco",
        "ENCODING=UTF-8",
        "-skipfailures",
        "-explodecollections",
      ];

      if (nlt) args.push("-nlt", "PROMOTE_TO_MULTI", "-nlt", nlt);

      const p = spawnGdal("ogr2ogr", args);
      attachGdalSpawnError(p, reject);
      let err = "";
      p.stderr.on("data", (d) => (err += d.toString("utf8")));
      p.on("close", (code) => {
        if (code !== 0) return reject(new Error(`ogr2ogr reproyect falló (${code}): ${err || "sin detalle"}`));
        resolve(outPath);
      });
    } catch (e) {
      reject(e);
    }
  });
}

const RX = {
  COM_INDI: /COMUNIDADES?_?INDI/i,
  POLI: /POLIGONO_?PROYECTO/i,
  U_ACT: /USO_?ACTUAL/i,
  U_ALT: /USO_?ALTERNATIVO/i,
  U_86: /USO_?(1986|86|1987|87)/i,
  TRAMO: /TRAMO(S)?/i,
  PROG: /PROGRESIVA(S)?/i,
  PLANO: /PLANO_?PROYECTO/i,
  EXTRA: /POLIGONOS?_?EXTRA/i,
  AREA_INF: /(AREA_?INFLU(ENCIA|ENSIA)?|AREAINFLU(ENCIA|ENSIA)?|INFLU(ENCIA|ENSIA)?)/i,

  // ✅ NUEVAS
  MEJORAS: /BLOQUES?_?MEJORAS|MEJORAS/i,
  TERRENO: /BLOQUES?_?TERRENOS?|TERRENOS?|TERRENO/i,

  // ✅ opcional si existe
  EXPEDIENTE: /BLOQUES?_?EXPEDIENTE|BLOQUE_?EXPEDIENTE|EXPEDIENTE/i,
};

function detectBufferDistFromName(name) {
  const s = String(name || "").toUpperCase();
  if (/\b1000\b/.test(s) || /(^|[^0-9])1000([^0-9]|$)/.test(s)) return 1000;
  if (/\b700\b/.test(s) || /(^|[^0-9])700([^0-9]|$)/.test(s)) return 700;
  if (/\b500\b/.test(s) || /(^|[^0-9])500([^0-9]|$)/.test(s)) return 500;
  return null;
}

function detectAreaInfluenciaDist(baseNorm) {
  const s = String(baseNorm || "");
  const m = s.match(/(^|_)(500|700|1000)(_|$)/);
  if (m) return Number(m[2]);
  const m2 = s.match(/(500|700|1000)/);
  if (m2) return Number(m2[1]);
  return null;
}

function semaforoAreaInfluencia(dist) {
  if (Number(dist) === 500) return { semaforo: "ROJO", color: "ROJO" };
  if (Number(dist) === 700) return { semaforo: "NARANJA", color: "NARANJA" };
  if (Number(dist) === 1000) return { semaforo: "VERDE", color: "VERDE" };
  return { semaforo: null, color: null };
}

// Setea metadata en la tabla si existen columnas compatibles
async function aplicarMetaAreaInfluencia(tablaFq, idProyecto, dist) {
  if (!dist) return;

  const { semaforo, color } = semaforoAreaInfluencia(dist);
  const [schema, table] = tablaFq.includes(".") ? tablaFq.split(".") : ["public", tablaFq];

  const { rows: cols } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    `,
    [schema, table]
  );

  const colset = new Set(cols.map((r) => String(r.column_name)));

  const colDist =
    ["distancia", "distancia_m", "radio", "radio_m", "buffer", "buffer_m", "buff_dist"].find((c) =>
      colset.has(c)
    ) || null;

  const colSem = ["semaforo", "semáforo", "estado", "nivel"].find((c) => colset.has(c)) || null;
  const colColor = ["color", "color_hex", "color_name"].find((c) => colset.has(c)) || null;

  const sets = [];
  const params = [Number(idProyecto)];
  let idx = 2;

  if (colDist) {
    sets.push(`${colDist} = CASE WHEN ${colDist} IS NULL OR ${colDist} = 0 THEN $${idx++} ELSE ${colDist} END`);
    params.push(Number(dist));
  }
  if (colSem && semaforo) {
    sets.push(`${colSem} = CASE WHEN ${colSem} IS NULL OR btrim(${colSem}::text) = '' THEN $${idx++} ELSE ${colSem} END`);
    params.push(semaforo);
  }
  if (colColor && color) {
    sets.push(`${colColor} = CASE WHEN ${colColor} IS NULL OR btrim(${colColor}::text) = '' THEN $${idx++} ELSE ${colColor} END`);
    params.push(color);
  }

  if (!sets.length) return;

  await pool.query(`UPDATE ${tablaFq} SET ${sets.join(", ")} WHERE id_proyecto = $1`, params);
}

function tablaPorBaseNorm(baseNorm) {
  if (baseNorm === "DOC" || baseNorm === "DOCUMENT" || baseNorm === "DOC_KML") return "ema.poligonos_extra";
  if (RX.POLI.test(baseNorm)) return "ema.poligono_proyecto";
  if (RX.U_ACT.test(baseNorm)) return "ema.bloques_uso_actual";
  if (RX.U_ALT.test(baseNorm)) return "ema.bloques_uso_alternativo";
  if (RX.U_86.test(baseNorm)) return "ema.bloques_uso86";
  if (RX.TRAMO.test(baseNorm)) return "ema.bloques_tramo";
  if (RX.PROG.test(baseNorm)) return "ema.bloques_progresivas";
  if (RX.PLANO.test(baseNorm)) return "ema.plano_proyecto";
  if (RX.COM_INDI.test(baseNorm)) return "ema.bloques_comu_ind";
  if (RX.AREA_INF.test(baseNorm)) return "ema.bloques_area_influensia";
  if (RX.EXTRA.test(baseNorm)) return "ema.poligonos_extra";

  // ✅ nuevas
  if (RX.MEJORAS.test(baseNorm)) return "ema.bloque_mejoras";
  if (RX.TERRENO.test(baseNorm)) return "ema.bloque_terreno";

  // ✅ opcional
  if (RX.EXPEDIENTE.test(baseNorm)) return "ema.bloque_expediente";

  return null;
}

/* ============================================================
   ✅ Forzar NLT por tabla (SHP)
   ============================================================ */
function nltForTable(tablaDestino) {
  if (tablaDestino === "ema.poligonos_extra") return null;
  if (tablaDestino === "ema.bloques_progresivas") return null;

  if (
    [
      "ema.poligono_proyecto",
      "ema.bloques_uso_actual",
      "ema.bloques_uso_alternativo",
      "ema.bloques_uso86",
      "ema.plano_proyecto",
      "ema.bloques_comu_ind",
      "ema.bloques_area_influensia",
      "ema.bloques_tramo",
      "ema.bloque_mejoras",
      "ema.bloque_terreno",
      "ema.bloque_expediente",
    ].includes(tablaDestino)
  )
    return "MULTIPOLYGON";

  return null;
}

function ogrInfoFeatureCount(shpPath) {
  return new Promise((resolve, reject) => {
    const args = [...gdalConfigArgs(), "-ro", "-so", "-al", shpPath];
    const p = spawnGdal("ogrinfo", args);
    attachGdalSpawnError(p, reject);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.stderr.on("data", (d) => (err += d.toString("utf8")));
    p.on("close", () => {
      const m = out.match(/Feature Count:\s*(\d+)/i);
      const n = m ? Number(m[1]) : null;
      resolve({ count: n, out, err });
    });
  });
}

/* ============================================================
   ✅ SHP → GeoJSON (4326/DB_SRID)
   ============================================================ */
function runOgr2OgrToStdoutSrid(shpPath, srid) {
  return new Promise((resolve, reject) => {
    const args = [
      ...gdalConfigArgs(),
      "-f",
      "GeoJSON",
      "/vsistdout/",
      shpPath,
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
      if (code !== 0) return reject(new Error(`ogr2ogr GeoJSON falló (${code}): ${err || "sin detalle"}`));
      resolve(out);
    });
  });
}

async function shpToGeoJSONFeaturesSrid(shpPath, srid) {
  const raw = await runOgr2OgrToStdoutSrid(shpPath, srid);
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("No se pudo parsear el GeoJSON generado por ogr2ogr.");
  }
  const feats = Array.isArray(json?.features) ? json.features : [];
  return feats.filter((f) => f && f.geometry);
}

/* ===========================
   ✅ Guardado seguro del buffer
   =========================== */
async function guardarBuffDistAreaInfluencia(idProyecto, distAI) {
  const v = Number(distAI);
  if (!Number.isFinite(v)) return;

  await pool.query(
    `
    UPDATE ema.bloques_area_influensia
       SET buff_dist = CASE
         WHEN buff_dist IS NULL OR buff_dist = 0 THEN $2
         ELSE buff_dist
       END
     WHERE id_proyecto = $1
    `,
    [Number(idProyecto), v]
  );
}

/* ===========================
   ✅ Sync tramos (para cargas SHP/KML)
   =========================== */
async function syncTramosConBloques(idProyecto) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: bloques } = await client.query(
      `
      SELECT gid,
             COALESCE(NULLIF(btrim(tramo_nombre), ''), NULLIF(btrim(tramo_desc), '')) AS nombre_raw,
             id_tramo
      FROM ema.bloques_tramo
      WHERE id_proyecto = $1
      `,
      [Number(idProyecto)]
    );

    const { rows: tramos } = await client.query(
      `
      SELECT id_tramo, nombre_tramo, nombre_tramo_norm
      FROM ema.tramos
      WHERE id_proyecto = $1
      `,
      [Number(idProyecto)]
    );

    const tramoMap = new Map();
    for (const t of tramos) {
      const key =
        String(t.nombre_tramo_norm || "").trim().toLowerCase() ||
        normalizeTramoName(t.nombre_tramo);
      if (key) tramoMap.set(key, t.id_tramo);
    }

    for (const b of bloques) {
      if (b.id_tramo && Number(b.id_tramo) > 0) continue;
      if (!b.nombre_raw) continue;

      const norm = normalizeTramoName(b.nombre_raw);
      if (!norm) continue;

      let idTramo = tramoMap.get(norm) || null;

      // si no existe en ema.tramos, lo crea para mantener consistencia
      if (!idTramo) {
        idTramo = await getOrCreateTramoWithClient(client, idProyecto, b.nombre_raw);
        if (idTramo) tramoMap.set(norm, idTramo);
      }

      if (!idTramo) continue;

      await client.query(
        `
        UPDATE ema.bloques_tramo
        SET id_tramo = $1
        WHERE gid = $2
          AND (id_tramo IS NULL OR id_tramo = 0)
        `,
        [idTramo, b.gid]
      );
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ syncTramosConBloques:", e);
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

/* ============================================================
   ✅ Inserción genérica desde KML (GeoJSON 4326) hacia tablas BD (DB_SRID)
   ============================================================ */
function normalizeText(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function getDescFromProps(props) {
  return normalizeText(pick(props, "descripcion", "DESCRIPCION", "Description", "description", "desc", "DESC")) || null;
}
function getNameFromProps(props) {
  return normalizeText(pick(props, "name", "Name", "NAME", "nombre", "NOMBRE", "title", "TITLE")) || null;
}

async function insertKmlFeatureToTable({ tabla, idProyecto, idExpediente, feat, tipoExtra, username }) {
  const props = feat.properties || {};
  const geom = feat.geometry;
  if (!geom) return false;

  const name = getNameFromProps(props) || null;
  const descripcion = getDescFromProps(props) || null;

  if (tabla === "ema.poligonos_extra") {
    await pool.query(
      `
      INSERT INTO ema.poligonos_extra
        (id_proyecto, tipo, nombre, descripcion, props, geom, created_by)
      VALUES
        ($1, $2, $3, $4, $5::jsonb,
         ST_Transform(
           ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($6))), ${OUT_SRID}),
           ${DB_SRID}
         ),
         $7)
      `,
      [
        Number(idProyecto),
        String(tipoExtra || "OTRO").toUpperCase(),
        String(name || "KML"),
        String(descripcion || ""),
        JSON.stringify(props || {}),
        JSON.stringify(geom),
        String(username || "Sistema"),
      ]
    );
    return true;
  }

  if (["ema.bloques_uso_actual", "ema.bloques_uso_alternativo", "ema.bloques_uso86"].includes(tabla)) {
    await pool.query(
      `
      INSERT INTO ${tabla} (id_colonia, geom)
      VALUES (
        $1,
        ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($2))), ${OUT_SRID})::geometry
      )`,
      [Number(idProyecto), JSON.stringify(geom)]
    );
    return true;
  }

  if (tabla === "ema.bloques_progresivas") {
    await pool.query(
      `
      INSERT INTO ema.bloques_progresivas (id_proyecto, name, descripcion, geom)
      VALUES (
        $1, $2, $3,
        ST_Transform(
          ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($4))), ${OUT_SRID}),
          ${DB_SRID}
        )
      )
      `,
      [Number(idProyecto), name || "", descripcion || "", JSON.stringify(geom)]
    );
    return true;
  }

  if (tabla === "ema.bloques_tramo") {
    const tramoNombre =
      normalizeText(
        pick(props, "tramo_nombre", "TRAMO_NOMBRE", "nombre_tramo", "NOMBRE_TRAMO", "tramo", "TRAMO", "name", "NAME")
      ) || name || null;

    const tramoDesc =
      normalizeText(
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
      ) || descripcion || null;

    let idTramo = (() => {
      const v = Number(pick(props, "id_tramo", "ID_TRAMO"));
      return Number.isFinite(v) && v > 0 ? v : null;
    })();

    if (!idTramo) {
      const nombreParaTramo = tramoNombre || tramoDesc;
      if (nombreParaTramo) {
        idTramo = await getOrCreateTramo(idProyecto, nombreParaTramo);
      }
    }

    await pool.query(
      `
      INSERT INTO ema.bloques_tramo
        (id_tramo, uso, area_m2, porcentaje, tramo_desc, tramo_nombre, id_proyecto, geom)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,
         ST_Transform(
           ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($8))), ${OUT_SRID}),
           ${DB_SRID}
         )
        )
      `,
      [
        idTramo,
        String(pick(props, "uso", "USO") || ""),
        Number(pick(props, "area_m2", "AREA_M2", "area") || 0),
        Number(pick(props, "porcentaje", "PORCENTAJE") || 0),
        tramoDesc || null,
        tramoNombre || null,
        Number(idProyecto),
        JSON.stringify(geom),
      ]
    );
    return true;
  }

  if (["ema.bloque_mejoras", "ema.bloque_terreno", "ema.bloque_expediente"].includes(tabla)) {
    await pool.query(
      `
      INSERT INTO ${tabla}
        (id_proyecto, id_expediente, name, descripcion, geom)
      VALUES
        ($1, $2, $3, $4,
         ST_Transform(
           ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($5))), ${OUT_SRID}),
           ${DB_SRID}
         )
        )
      `,
      [Number(idProyecto), idExpediente ? Number(idExpediente) : null, name, descripcion, JSON.stringify(geom)]
    );
    return true;
  }

  return false;
}

/* ============================================================
   ✅ MAIN: procesarArchivosMantenimiento
   ============================================================ */
async function procesarArchivosMantenimiento(req, res) {
  const { id } = req.params;

  function bodyLast(v) {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        const s = String(v[i] ?? "").trim();
        if (s) return s;
      }
      return "";
    }
    return String(v ?? "").trim();
  }

  try {
    const idExpediente = (() => {
      const raw =
        bodyLast(req.body?.id_expediente) ||
        bodyLast(req.body?.idExpediente) ||
        bodyLast(req.body?.id_expediente_fk) ||
        "";
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })();

    let mapping = {};
    try {
      const m = bodyLast(req.body?.mapping);
      if (m) mapping = JSON.parse(m);
    } catch {
      mapping = {};
    }

    let bufferByBaseNorm = {};
    try {
      const b = bodyLast(req.body?.bufferByBaseNorm);
      if (b) bufferByBaseNorm = JSON.parse(b);
    } catch {
      bufferByBaseNorm = {};
    }

    const tipoExtra = bodyLast(req.body?.tipoExtra);

    const inputSrid = (() => {
      const s = bodyLast(req.body?.inputSrid);
      const n = Number(s || DEFAULT_INPUT_SRID);
      return Number.isFinite(n) ? n : DEFAULT_INPUT_SRID;
    })();

    const ALLOWED_TABLES = new Set([
      "ema.poligono_proyecto",
      "ema.bloques_uso_actual",
      "ema.bloques_uso_alternativo",
      "ema.bloques_uso86",
      "ema.plano_proyecto",
      "ema.bloques_tramo",
      "ema.bloques_progresivas",
      "ema.bloques_comu_ind",
      "ema.poligonos_extra",
      "ema.bloques_area_influensia",

      // ✅ nuevas
      "ema.bloque_mejoras",
      "ema.bloque_terreno",

      // ✅ opcional
      "ema.bloque_expediente",
    ]);

    let defaultTabla = bodyLast(req.body?.defaultTabla);
    if (defaultTabla && !ALLOWED_TABLES.has(defaultTabla)) {
      console.warn("⚠️ defaultTabla inválida (ignorada):", defaultTabla);
      defaultTabla = "";
    }

    const enviados = Array.isArray(req.uploadedShapefiles) ? req.uploadedShapefiles : [];
    if (!enviados.length) {
      return res.status(400).json({ success: false, ok: false, inserted: 0, message: "No se subieron archivos." });
    }

    const baseDir = path.join(__dirname, "../uploads/mantenimiento", id);
    const inboxDir = path.join(baseDir, "_inbox");

    const workDir = path.join(baseDir, "_work", String(Date.now()));
    const shpDir = path.join(workDir, "shp");
    const shpDbDir = path.join(workDir, `shp_epsg_${DB_SRID}`);
    const extrDir = path.join(workDir, "extract");
    const kmlDir = path.join(workDir, "kml");

    ensureDir(inboxDir);
    ensureDir(shpDir);
    ensureDir(shpDbDir);
    ensureDir(extrDir);
    ensureDir(kmlDir);

    const inboxFiles = enviados.map((x) => x.path).filter((p) => fs.existsSync(p));

    /* =========================
       ✅ Contadores para FRONT
       ========================= */
    let procesados = 0; // compat
    let inserted = 0;
    const byTable = {};

    function addCount(tabla, n) {
      const v = Number(n) || 0;
      if (v <= 0) return;
      inserted += v;
      byTable[tabla] = (byTable[tabla] || 0) + v;
    }

    /* =========================
       1) Clasificar + extraer
       ========================= */
    for (const file of inboxFiles) {
      const ext = path.extname(file).toLowerCase();

      if (ext === ".zip" || ext === ".kmz") {
        try {
          const out = path.join(extrDir, path.basename(file, ext));
          ensureDir(out);
          extractZipSafe(file, out);
        } catch (e) {
          console.warn("Error al descomprimir ZIP/KMZ:", file, e);
        }
        continue;
      }

      if (ext === ".rar") {
        if (!Unrar) {
          return res.status(415).json({
            success: false,
            ok: false,
            inserted: 0,
            message: "RAR no soportado en servidor. Instale 'node-unrar-js'.",
          });
        }
        try {
          const data = fs.readFileSync(file);
          const extractor = Unrar.createExtractorFromData(data);
          const list = extractor.getFileList();
          const extracted = extractor.extract({
            files: list.fileHeaders.map((h) => h.name),
          });
          for (const f of extracted.files) {
            const dest = safeJoin(extrDir, f.fileHeader.name);
            ensureDir(path.dirname(dest));
            fs.writeFileSync(dest, Buffer.from(f.extraction));
          }
        } catch (e) {
          console.warn("Error al descomprimir RAR:", file, e);
        }
        continue;
      }

      if (ext === ".kml") {
        copyWithUniqueName(file, kmlDir, path.basename(file));
        continue;
      }

      if (CONVERTIBLE_EXTS.has(ext)) {
        const base = path.basename(file, ext);
        const outBase = normalizeBaseForMatch(base) || base;
        try {
          await ogrConvertToShp(file, shpDir, outBase);
        } catch (e) {
          if (isGdalSpawnError(e)) throw e;
          console.warn("Error convirtiendo a SHP:", file, e.message);
        }
        continue;
      }

      if (isAny(file, [".shp", ".dbf", ".shx", ".prj", ".cpg", ".sbn", ".sbx"])) {
        copyWithUniqueName(file, shpDir, path.basename(file));
        continue;
      }

      console.warn("Archivo ignorado (ext no manejada):", file);
    }

    /* =========================
       2) También lo extraído
       ========================= */
    const extractedFiles = walkFiles(extrDir);
    for (const file of extractedFiles) {
      const ext = path.extname(file).toLowerCase();

      if (ext === ".kml") {
        const parent = path.basename(path.dirname(file)) || "KML";
        const outSub = path.join(kmlDir, parent);
        ensureDir(outSub);
        copyWithUniqueName(file, outSub, path.basename(file));
        continue;
      }

      if (CONVERTIBLE_EXTS.has(ext)) {
        const base = path.basename(file, ext);
        const outBase = normalizeBaseForMatch(base) || base;
        try {
          await ogrConvertToShp(file, shpDir, outBase);
        } catch (e) {
          if (isGdalSpawnError(e)) throw e;
          console.warn("Error convirtiendo a SHP:", file, e.message);
        }
        continue;
      }

      // ✅ FIX PISADO: SHP extraído -> prefijo con carpeta padre
      if (isAny(file, [".shp", ".dbf", ".shx", ".prj", ".cpg", ".sbn", ".sbx"])) {
        const ext2 = path.extname(file).toLowerCase();
        const base2 = path.basename(file, ext2).toUpperCase();
        const parent = path.basename(path.dirname(file)) || "EXTR";

        if (base2 === "DOC" || base2 === "DOCUMENT") {
          const outBaseName = parent.toUpperCase();
          const outName = `${outBaseName}${ext2}`;
          copyWithUniqueName(file, shpDir, outName);
          continue;
        }

        const outBaseName = `${parent.toUpperCase()}__${base2}`;
        const outName = `${outBaseName}${ext2}`;
        copyWithUniqueName(file, shpDir, outName);
        continue;
      }
    }

    /* =========================
       3) Agrupar triadas
       ========================= */
    const shpFiles = walkFiles(shpDir).filter((p) => isAny(p, [".shp", ".dbf", ".shx"]));
    const grupos = {};
    for (const f of shpFiles) {
      const ext = path.extname(f).toLowerCase();
      const base = path.basename(f, ext).toUpperCase();
      if (!grupos[base]) grupos[base] = {};
      grupos[base][ext] = f;
    }

    /* =========================
       Notificaciones
       ========================= */
    const proyectoRes = await pool.query(
      `SELECT nombre, id_cliente, id_consultor FROM ema.proyectos WHERE gid = $1`,
      [id]
    );
    const nombreProyecto = proyectoRes.rows[0]?.nombre || "Proyecto desconocido";
    const idCliente = proyectoRes.rows[0]?.id_cliente || null;
    const idConsultor = proyectoRes.rows[0]?.id_consultor || null;

    let cargoTramos = false;
    const debugSets = [];

    const titulos = {
      "ema.poligono_proyecto": "Carga de polígonos",
      "ema.bloques_uso_actual": "Carga de uso actual",
      "ema.bloques_uso_alternativo": "Carga de uso alternativo",
      "ema.bloques_uso86": "Carga de uso 1986",
      "ema.plano_proyecto": "Carga de plano",
      "ema.bloques_tramo": "Carga de tramos",
      "ema.bloques_progresivas": "Carga de progresivas",
      "ema.bloques_comu_ind": "Carga de comunidades indígenas",
      "ema.poligonos_extra": "Carga de polígonos extra",
      "ema.bloques_area_influensia": "Carga de área de influencia",

      "ema.bloque_mejoras": "Carga de mejoras",
      "ema.bloque_terreno": "Carga de terrenos",
      "ema.bloque_expediente": "Carga de bloque expediente",
    };

    /* =========================
       4) Insert SHP
       ========================= */
    for (const baseUnique of Object.keys(grupos)) {
      const g = grupos[baseUnique];
      const tieneTrio = g[".shp"] && g[".dbf"] && g[".shx"];
      if (!tieneTrio) continue;

      const { logicalBase } = splitUniqueBase(baseUnique);
      const logicalNorm = normalizeBaseForMatch(logicalBase);
      const uniqueNorm = normalizeBaseForMatch(baseUnique);

      debugSets.push({
        baseUnique,
        logicalBase,
        uniqueNorm,
        logicalNorm,
        partes: { shp: !!g[".shp"], dbf: !!g[".dbf"], shx: !!g[".shx"] },
      });

      const forced =
        mapping?.[logicalNorm] ||
        mapping?.[logicalBase] ||
        mapping?.[String(logicalBase).toUpperCase()] ||
        mapping?.[uniqueNorm] ||
        mapping?.[baseUnique] ||
        mapping?.[String(baseUnique).toUpperCase()] ||
        null;

      const isDoc = logicalNorm === "DOC" || logicalNorm === "DOCUMENT" || logicalNorm === "DOC_KML";

      const tabla =
        forced ||
        (isDoc ? defaultTabla : null) ||
        tablaPorBaseNorm(logicalNorm) ||
        defaultTabla ||
        null;

      if (!tabla) continue;
      if (!ALLOWED_TABLES.has(tabla)) {
        console.warn("⚠️ tabla no permitida (ignorada):", tabla);
        continue;
      }

      let distAI = null;
      if (tabla === "ema.bloques_area_influensia") {
        const vFront = Number(bufferByBaseNorm && (bufferByBaseNorm[logicalNorm] || bufferByBaseNorm[uniqueNorm])) || 0;
        if (Number.isFinite(vFront) && vFront > 0) {
          distAI = vFront;
        } else {
          const v1 = detectBufferDistFromName(logicalBase);
          const v2 = detectBufferDistFromName(logicalNorm);
          const v3 = detectAreaInfluenciaDist(logicalNorm);
          distAI =
            (v1 && Number(v1) > 0 ? Number(v1) : null) ||
            (v2 && Number(v2) > 0 ? Number(v2) : null) ||
            (v3 && Number(v3) > 0 ? Number(v3) : null) ||
            null;
        }
      }

      let didInsert = false;

      try {
        if (tabla === "ema.poligonos_extra") {
          const outBase = `${baseUnique}_EPSG${DB_SRID}`;
          const shpDb = await ogrReprojectShpToDbSrid(g[".shp"], shpDbDir, outBase, inputSrid, null);
          const feats = await shpToGeoJSONFeaturesSrid(shpDb, OUT_SRID);

          let localCount = 0;
          for (const feat of feats) {
            const ok = await insertKmlFeatureToTable({
              tabla,
              idProyecto: id,
              idExpediente,
              feat,
              tipoExtra,
              username: req.user?.username || "Sistema",
            });
            if (ok) localCount++;
          }

          addCount(tabla, localCount);
          didInsert = localCount > 0;
        } else {
          const outBase = `${baseUnique}_EPSG${DB_SRID}`;
          const nlt = nltForTable(tabla);

          const fc = await ogrInfoFeatureCount(g[".shp"]);
          if (!fc.count || fc.count <= 0) {
            console.warn(`⚠️ SHP sin features: ${baseUnique} -> no se carga (Feature Count=${fc.count})`);
            continue;
          }

          const shpDb = await ogrReprojectShpToDbSrid(g[".shp"], shpDbDir, outBase, inputSrid, nlt);
          const dbfDb = shpDb.replace(/\.shp$/i, ".dbf");
          const shxDb = shpDb.replace(/\.shp$/i, ".shx");

          if (tabla === "ema.bloques_progresivas") {
            const feats = await shpToGeoJSONFeaturesSrid(shpDb, DB_SRID);

            let localCount = 0;
            for (const feat of feats) {
              const props = feat.properties || {};
              const geom = feat.geometry;
              if (!geom) continue;

              await pool.query(
                `
                INSERT INTO ema.bloques_progresivas (id_proyecto, name, descripcion, geom)
                VALUES ($1,$2,$3,
                  ST_SetSRID(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($4))), ${DB_SRID})
                )
                `,
                [Number(id), getNameFromProps(props) || "", getDescFromProps(props) || "", JSON.stringify(geom)]
              );

              localCount++;
            }

            addCount(tabla, localCount);
            didInsert = localCount > 0;
          } else {
            const result = await cargarShapefileEnProyecto(shpDb, dbfDb, shxDb, tabla, id, idExpediente);
            const count = typeof result === "number" ? result : Number(result?.inserted || 0);

            addCount(tabla, count);
            didInsert = count > 0;
          }
        }
      } catch (e) {
        if (isGdalSpawnError(e)) throw e;
        console.warn("❌ No se pudo reproyectar/cargar SHP:", baseUnique, e.message);
        didInsert = false;
      }

      if (didInsert) {
        procesados++;
        if (tabla === "ema.bloques_tramo") cargoTramos = true;

        if (tabla === "ema.bloques_area_influensia") {
          try {
            await guardarBuffDistAreaInfluencia(Number(id), distAI);
            await aplicarMetaAreaInfluencia("ema.bloques_area_influensia", Number(id), distAI);
          } catch (e) {
            console.warn("⚠️ No se pudo guardar/applicar buff_dist (SHP):", e.message);
          }
        }

        const titulo = titulos[tabla];
        if (titulo) {
          try {
            await crearNotificacion({
              proponenteId: idCliente,
              consultorId: idConsultor,
              id_proyecto: Number(id),
              titulo,
              mensaje: `Se cargaron datos en "${nombreProyecto}" (${logicalBase}).`,
              creado_por: req.user?.username || "Sistema",
              es_global: false,
            });
          } catch (e) {
            console.warn("Error notificando:", e);
          }
        }
      }
    }

    /* =========================
       5) KML (incluye KMZ descomprimido)
       ========================= */
    const kmlPaths = walkFiles(kmlDir).filter((p) => isExt(p, ".kml"));
    for (const kmlPath of kmlPaths) {
      const xml = fs.readFileSync(kmlPath, "utf8");
      const dom = new DOMParser().parseFromString(xml, "text/xml");
      const geo = tj.kml(dom);

      const baseFile = path.basename(kmlPath, ".kml").toUpperCase();
      const parentFolder = path.basename(path.dirname(kmlPath)).toUpperCase();

      const effectiveBase = baseFile === "DOC" ? parentFolder : baseFile;
      const baseNorm = normalizeBaseForMatch(effectiveBase);

      const forced = mapping?.[baseNorm] || mapping?.[effectiveBase] || mapping?.[String(effectiveBase).toUpperCase()] || null;

      const tabla =
        forced ||
        (baseNorm === "DOC" ? defaultTabla : null) ||
        tablaPorBaseNorm(baseNorm) ||
        defaultTabla ||
        null;

      if (!tabla) continue;
      if (!ALLOWED_TABLES.has(tabla)) continue;
      if (!geo?.features?.length) continue;

      let distAI = null;
      if (tabla === "ema.bloques_area_influensia") {
        const vFront = Number(bufferByBaseNorm && bufferByBaseNorm[baseNorm]) || 0;
        if (Number.isFinite(vFront) && vFront > 0) distAI = vFront;
        else {
          const v1 = detectBufferDistFromName(effectiveBase);
          const v2 = detectAreaInfluenciaDist(baseNorm);
          distAI =
            (v1 && Number(v1) > 0 ? Number(v1) : null) ||
            (v2 && Number(v2) > 0 ? Number(v2) : null) ||
            null;
        }
      }

      let insertedAny = false;

      for (const feat of geo.features) {
        const geom = feat.geometry;
        if (!geom) continue;

        if (DEBUG_GEOM_POINTS) {
          const coords = JSON.stringify(geom.coordinates || []);
          if (coords.length < 200) {
            console.log("⚠️ KML geom chica:", effectiveBase, "type=", geom.type, "len=", coords.length);
          }
        }

        const ok = await insertKmlFeatureToTable({
          tabla,
          idProyecto: id,
          idExpediente,
          feat,
          tipoExtra,
          username: req.user?.username || "Sistema",
        });

        if (ok) {
          insertedAny = true;
          procesados++;
          addCount(tabla, 1);
        }
      }

      if (insertedAny && tabla === "ema.bloques_tramo") cargoTramos = true;

      if (tabla === "ema.bloques_area_influensia") {
        try {
          await guardarBuffDistAreaInfluencia(Number(id), distAI);
          await aplicarMetaAreaInfluencia("ema.bloques_area_influensia", Number(id), distAI);
        } catch (e) {
          console.warn("⚠️ No se pudo guardar buff_dist (KML):", e.message);
        }
      }
    }

    /* =========================
       6) Sync tramos
       ========================= */
    let sync = null;
    if (cargoTramos) {
      sync = await syncTramosConBloques(id);
      if (!sync.ok) console.warn("⚠️ Sync tramos falló:", sync.error);
    }

    if (!inserted) {
      return res.status(400).json({
        success: false,
        ok: false,
        inserted: 0,
        byTable,
        message: "No se insertaron geometrías (datasets vacíos o no válidos).",
        debug: debugSets,
      });
    }

    return res.json({
      success: true,
      ok: true,
      inserted,
      byTable,
      message: "Mantenimiento ejecutado correctamente.",
      inputSrid_usado: inputSrid,
      defaultTabla_usada: defaultTabla || null,
      id_expediente_usado: idExpediente,
      sync_tramos: sync,
      tablesTouched: Object.keys(byTable),
    });
  } catch (err) {
    console.error("❌ Error en mantenimiento:", err);
    const status = Number(err?.statusCode) || 500;
    return res.status(status).json({
      success: false,
      ok: false,
      inserted: 0,
      message:
        status === 500 && isGdalSpawnError(err)
          ? "GDAL/OGR no está instalado o no es accesible en el servidor."
          : "Error al ejecutar mantenimiento.",
      detalle: err.message,
    });
  }
}

/* ============================================================
   Estado de capas por proyecto
   ============================================================ */
async function obtenerStatusCapas(req, res) {
  const { id } = req.params;
  try {
    const q = (sql, p) => pool.query(sql, p).then((r) => Number(r.rows[0].count) > 0);
    const resultados = {};
    resultados.POLIGONO_PROYECTO = await q("SELECT COUNT(*) FROM ema.poligono_proyecto WHERE id_proyecto = $1", [id]);
    resultados.USO_ACTUAL = await q("SELECT COUNT(*) FROM ema.bloques_uso_actual WHERE id_colonia = $1", [id]);
    resultados.USO_ALTERNATIVO = await q("SELECT COUNT(*) FROM ema.bloques_uso_alternativo WHERE id_colonia = $1", [id]);
    resultados.USO_1986 = await q("SELECT COUNT(*) FROM ema.bloques_uso86 WHERE id_colonia = $1", [id]);
    resultados.PLANO_PROYECTO = await q("SELECT COUNT(*) FROM ema.plano_proyecto WHERE id_proyecto = $1", [id]);
    resultados.TRAMO = await q("SELECT COUNT(*) FROM ema.bloques_tramo WHERE id_proyecto = $1", [id]);
    resultados.PROGRESIVA = await q("SELECT COUNT(*) FROM ema.bloques_progresivas WHERE id_proyecto = $1", [id]);
    resultados.COMUNIDADES_INDI = await q("SELECT COUNT(*) FROM ema.bloques_comu_ind WHERE id_proyecto = $1", [id]);
    resultados.AREA_INFLUENSIA = await q("SELECT COUNT(*) FROM ema.bloques_area_influensia WHERE id_proyecto = $1", [id]);
    resultados.POLIGONOS_EXTRA = await q("SELECT COUNT(*) FROM ema.poligonos_extra WHERE id_proyecto = $1", [id]);

    resultados.BLOQUE_MEJORAS = await q("SELECT COUNT(*) FROM ema.bloque_mejoras WHERE id_proyecto = $1", [id]);
    resultados.BLOQUE_TERRENO = await q("SELECT COUNT(*) FROM ema.bloque_terreno WHERE id_proyecto = $1", [id]);

    try {
      resultados.BLOQUE_EXPEDIENTE = await q("SELECT COUNT(*) FROM ema.bloque_expediente WHERE id_proyecto = $1", [id]);
    } catch {
      resultados.BLOQUE_EXPEDIENTE = false;
    }

    res.json(resultados);
  } catch (err) {
    console.error("❌ Error al obtener estado de capas:", err);
    res.status(500).json({ error: "Error al consultar estado de capas" });
  }
}

/* ============================================================
   Eliminar por proyecto en la tabla seleccionada
   ============================================================ */
async function eliminarPoligono(req, res) {
  const { tabla, id } = req.params;

  const tablasPermitidas = {
    poligono_proyecto: "ema.poligono_proyecto",
    bloques_uso_actual: "ema.bloques_uso_actual",
    bloques_uso_alternativo: "ema.bloques_uso_alternativo",
    bloques_uso86: "ema.bloques_uso86",
    plano_proyecto: "ema.plano_proyecto",
    bloques_tramo: "ema.bloques_tramo",
    bloques_progresivas: "ema.bloques_progresivas",
    bloques_comu_ind: "ema.bloques_comu_ind",
    bloques_area_influensia: "ema.bloques_area_influensia",
    poligonos_extra: "ema.poligonos_extra",

    bloque_mejoras: "ema.bloque_mejoras",
    bloque_terreno: "ema.bloque_terreno",
    bloque_expediente: "ema.bloque_expediente",
  };

  const columnasID = {
    poligono_proyecto: "id_proyecto",
    bloques_uso_actual: "id_colonia",
    bloques_uso_alternativo: "id_colonia",
    bloques_uso86: "id_colonia",
    plano_proyecto: "id_proyecto",
    bloques_tramo: "id_proyecto",
    bloques_progresivas: "id_proyecto",
    bloques_comu_ind: "id_proyecto",
    bloques_area_influensia: "id_proyecto",
    poligonos_extra: "id_proyecto",

    bloque_mejoras: "id_proyecto",
    bloque_terreno: "id_proyecto",
    bloque_expediente: "id_proyecto",
  };

  const tablaDestino = tablasPermitidas[tabla];
  const campo = columnasID[tabla];

  if (!tablaDestino) return res.status(400).json({ success: false, message: "Tabla no permitida" });

  try {
    await pool.query(`DELETE FROM ${tablaDestino} WHERE ${campo} = $1`, [id]);
    res.json({ success: true, message: "Datos eliminados correctamente" });
  } catch (err) {
    console.error("❌ Error al eliminar:", err);
    res.status(500).json({ success: false, message: "Error al eliminar" });
  }
}

/* ============================================================
   Exportar shapefiles crudos (ZIP) desde _inbox
   ============================================================ */
async function exportarShapefiles(req, res) {
  const { id } = req.params;
  const carpeta = path.join(__dirname, "..", "uploads", "mantenimiento", id, "_inbox");
  const nombreZip = `ShapeProyecto_${id}.zip`;

  if (!fs.existsSync(carpeta)) return res.status(404).json({ message: "No se encontraron archivos para exportar" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${nombreZip}`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", () => res.status(500).end());
  archive.pipe(res);
  archive.directory(carpeta, false);
  archive.finalize();
}

/* ============================================================
   Exportar KML / KMZ (transforma SIEMPRE a 4326)
   ============================================================ */
const TABLE_INFO = {
  poligono_proyecto: { fq: "ema.poligono_proyecto", idField: "id_proyecto" },
  bloques_uso_actual: { fq: "ema.bloques_uso_actual", idField: "id_colonia" },
  bloques_uso_alternativo: { fq: "ema.bloques_uso_alternativo", idField: "id_colonia" },
  bloques_uso86: { fq: "ema.bloques_uso86", idField: "id_colonia" },
  plano_proyecto: { fq: "ema.plano_proyecto", idField: "id_proyecto" },
  bloques_tramo: { fq: "ema.bloques_tramo", idField: "id_proyecto" },
  bloques_progresivas: { fq: "ema.bloques_progresivas", idField: "id_proyecto" },
  bloques_comu_ind: { fq: "ema.bloques_comu_ind", idField: "id_proyecto" },
  bloques_area_influensia: { fq: "ema.bloques_area_influensia", idField: "id_proyecto" },
  poligonos_extra: { fq: "ema.poligonos_extra", idField: "id_proyecto" },

  bloque_mejoras: { fq: "ema.bloque_mejoras", idField: "id_proyecto" },
  bloque_terreno: { fq: "ema.bloque_terreno", idField: "id_proyecto" },
  bloque_expediente: { fq: "ema.bloque_expediente", idField: "id_proyecto" },
};

const CAPA_TO_TABLE = {
  POLIGONO_PROYECTO: "poligono_proyecto",
  USO_ACTUAL: "bloques_uso_actual",
  USO_ALTERNATIVO: "bloques_uso_alternativo",
  USO_1986: "bloques_uso86",
  USO_1987: "bloques_uso86",
  USO_86: "bloques_uso86",
  USO_87: "bloques_uso86",
  PLANO_PROYECTO: "plano_proyecto",
  TRAMO: "bloques_tramo",
  PROGRESIVA: "bloques_progresivas",
  COMUNIDADES_INDI: "bloques_comu_ind",
  AREA_INFLUENSIA: "bloques_area_influensia",
  POLIGONOS_EXTRA: "poligonos_extra",

  BLOQUE_MEJORAS: "bloque_mejoras",
  BLOQUE_TERRENO: "bloque_terreno",
  BLOQUE_EXPEDIENTE: "bloque_expediente",
};

async function fetchFeaturesForTable(shortName, projectId) {
  const info = TABLE_INFO[shortName];
  if (!info) return [];

  const sql = `
    SELECT to_jsonb(t) - 'geom' AS props,
           ST_AsGeoJSON(ST_Transform(ST_MakeValid(t.geom), ${OUT_SRID})) AS geometry
    FROM (SELECT * FROM ${info.fq} WHERE ${info.idField} = $1) t
  `;
  const { rows } = await pool.query(sql, [projectId]);

  return rows
    .map((r) => ({
      type: "Feature",
      geometry: r.geometry ? JSON.parse(r.geometry) : null,
      properties: r.props || {},
    }))
    .filter((f) => !!f.geometry);
}

async function buildGeoJSONForLayers(id, capaKeys) {
  const keys = Array.isArray(capaKeys) && capaKeys.length ? capaKeys : Object.keys(CAPA_TO_TABLE);
  const features = [];
  for (const k of keys) {
    const short = CAPA_TO_TABLE[k];
    if (!short) continue;
    const layerFeatures = await fetchFeaturesForTable(short, id);
    for (const f of layerFeatures) f.properties = { capa: k, ...f.properties };
    features.push(...layerFeatures);
  }
  return { type: "FeatureCollection", features };
}

function toKML(fc) {
  if (!tokml) {
    const err = new Error("El servidor no tiene 'tokml' instalado.");
    err.status = 500;
    throw err;
  }
  return tokml(fc, {
    name: (props) =>
      props &&
      (props.nombre ||
        props.tramo_nombre ||
        props.uso ||
        props.capa ||
        props.name ||
        props.NAME ||
        "feature"),
  });
}

function parseCapasQuery(req) {
  return String(req.query.capas || req.query.layers || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function exportKML(req, res) {
  try {
    const { id } = req.params;
    const capas = parseCapasQuery(req);

    const fc = await buildGeoJSONForLayers(Number(id), capas);
    if (!fc.features.length) return res.status(404).json({ message: "No hay datos para las capas seleccionadas." });

    const kml = toKML(fc);
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Proyecto_${id}.kml"`);
    return res.send(kml);
  } catch (err) {
    console.error("❌ exportKML:", err);
    res.status(err.status || 500).json({ message: err.message || "Error al exportar KML" });
  }
}

async function exportKMZ(req, res) {
  try {
    const { id } = req.params;
    const capas = parseCapasQuery(req);

    const fc = await buildGeoJSONForLayers(Number(id), capas);
    if (!fc.features.length) return res.status(404).json({ message: "No hay datos para las capas seleccionadas." });

    const kml = toKML(fc);
    const zip = archiver("zip", { zlib: { level: 9 } });

    res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
    res.setHeader("Content-Disposition", `attachment; filename="Proyecto_${id}.kmz"`);

    zip.on("error", (e) => {
      throw e;
    });
    zip.pipe(res);
    zip.append(kml, { name: "doc.kml" });
    await zip.finalize();
  } catch (err) {
    console.error("❌ exportKMZ:", err);
    res.status(err.status || 500).json({ message: err.message || "Error al exportar KMZ" });
  }
}

/* ============================================================
   GeoJSON endpoints visores (SIEMPRE 4326)
   ============================================================ */
async function obtenerPlanoProyecto(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT gid, categoria, uso, area_m2,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.plano_proyecto
       WHERE id_proyecto = $1`,
      [id]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: { gid: r.gid, categoria: r.categoria, uso: r.uso, area_m2: r.area_m2 },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener plano del proyecto:", err);
    res.status(500).json({ message: "Error al obtener plano del proyecto" });
  }
}

async function obtenerTramos(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT gid, id_tramo, uso, area_m2, porcentaje, tramo_desc, tramo_nombre,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloques_tramo
       WHERE id_proyecto = $1`,
      [id]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: {
            gid: r.gid,
            id_tramo: r.id_tramo,
            uso: r.uso,
            area_m2: r.area_m2,
            porcentaje: r.porcentaje,
            tramo_desc: r.tramo_desc,
            tramo_nombre: r.tramo_nombre,
          },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener tramos:", err);
    res.status(500).json({ message: "Error al obtener tramos del proyecto" });
  }
}

async function obtenerProgresivas(req, res) {
  const rawId = String(req.params.id ?? "").trim();

  if (!/^[0-9]+$/.test(rawId)) {
    return res.status(400).json({ ok: false, error: "id_proyecto inválido o fuera de rango" });
  }

  const idProyecto = Number(rawId);

  if (!Number.isSafeInteger(idProyecto) || idProyecto <= 0 || idProyecto > 2147483647) {
    return res.status(400).json({ ok: false, error: "id_proyecto inválido o fuera de rango" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id_bloque,
        id,
        name,
        descripcion,
        id_proyecto,
        ST_AsGeoJSON(
          ST_Transform(
            ST_PointOnSurface(ST_MakeValid(geom)),
            ${OUT_SRID}
          )
        ) AS geometry
      FROM ema.bloques_progresivas
      WHERE id_proyecto = $1
        AND geom IS NOT NULL
      ORDER BY
        CASE
          WHEN regexp_replace(COALESCE(name, ''), '[^0-9+]', '', 'g') ~ '^[0-9]+\\+[0-9]+$'
          THEN split_part(regexp_replace(name, '[^0-9+]', '', 'g'), '+', 1)::bigint
          ELSE 999999::bigint
        END,
        CASE
          WHEN regexp_replace(COALESCE(name, ''), '[^0-9+]', '', 'g') ~ '^[0-9]+\\+[0-9]+$'
          THEN split_part(regexp_replace(name, '[^0-9+]', '', 'g'), '+', 2)::bigint
          ELSE 999999::bigint
        END,
        name
      `,
      [idProyecto]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: {
            id_bloque: r.id_bloque,
            id: r.id,
            name: r.name,
            descripcion: r.descripcion,
            id_proyecto: r.id_proyecto,
          },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener progresivas:", err);
    res.status(500).json({ message: "Error al obtener progresivas" });
  }
}

async function obtenerPoligonosExtra(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, tipo, nombre, descripcion, props,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.poligonos_extra
       WHERE id_proyecto = $1
       ORDER BY id DESC`,
      [Number(id)]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: {
            id: r.id,
            tipo: r.tipo,
            nombre: r.nombre,
            descripcion: r.descripcion,
            ...(r.props || {}),
          },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener poligonos extra:", err);
    res.status(500).json({ message: "Error al obtener poligonos extra" });
  }
}

async function obtenerBloqueMejoras(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, id_expediente, name, descripcion,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_mejoras
       WHERE id_proyecto = $1`,
      [Number(id)]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: { id: r.id, id_expediente: r.id_expediente, name: r.name, descripcion: r.descripcion },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener bloque_mejoras:", err);
    res.status(500).json({ message: "Error al obtener bloque_mejoras" });
  }
}

async function obtenerBloqueTerreno(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, id_expediente, name, descripcion,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), ${OUT_SRID})) AS geometry
       FROM ema.bloque_terreno
       WHERE id_proyecto = $1`,
      [Number(id)]
    );

    res.json({
      type: "FeatureCollection",
      features: rows
        .filter((r) => r.geometry)
        .map((r) => ({
          type: "Feature",
          geometry: JSON.parse(r.geometry),
          properties: { id: r.id, id_expediente: r.id_expediente, name: r.name, descripcion: r.descripcion },
        })),
    });
  } catch (err) {
    console.error("❌ Error al obtener bloque_terreno:", err);
    res.status(500).json({ message: "Error al obtener bloque_terreno" });
  }
}

/* ===========================
   Exports
   =========================== */
module.exports = {
  procesarArchivosMantenimiento,
  obtenerStatusCapas,
  eliminarPoligono,
  exportarShapefiles,
  exportKML,
  exportKMZ,
  obtenerPlanoProyecto,
  obtenerTramos,
  obtenerProgresivas,
  obtenerPoligonosExtra,
  obtenerBloqueMejoras,
  obtenerBloqueTerreno,
};
