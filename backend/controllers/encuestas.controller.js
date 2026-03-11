const pool = require("../db");
const proj4 = require("proj4");
const mgrs = require("mgrs");
const archiver = require("archiver"); // <-- para KMZ (zip)

// ================== Proyecciones ==================
const UTM21S = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

// ================== Helpers generales ==================
const excelSerialToDate = (serial) => {
  if (serial === null || serial === undefined || serial === "") return null;
  const n = Number(serial);
  if (!isNaN(n)) {
    const utcDays = n - 25569;
    const ms = utcDays * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  const s = String(serial).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = yy.length === 2 ? (Number(yy) >= 70 ? "19" : "20") + yy : yy;
    const d = new Date(+yyyy, +mm - 1, +dd);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return s || null;
};

/**
 * ✅ FIX: parse numérico robusto para formatos:
 * - "1.234,56" -> 1234.56
 * - "1234,56"  -> 1234.56
 * - "1234.56"  -> 1234.56
 * - "12.34"    -> 12.34 (antes se rompía)
 */
function parseNumberFlexible(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  let s = String(v).trim();
  if (!s) return null;

  // quitar espacios
  s = s.replace(/\s+/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  // Caso típico ES: 1.234,56
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  }
  // Caso con solo coma: 1234,56
  else if (hasComma && !hasDot) {
    s = s.replace(/,/g, ".");
  }
  // Caso con solo punto: 1234.56 -> se deja tal cual
  // Caso sin separadores -> tal cual

  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

const parseBoolean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (["si", "sí", "s", "yes", "y", "true", "1", "✓", "x"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
};

function esUTM21SValido(x, y) {
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    x >= 200000 &&
    x <= 900000 &&
    y >= 7000000 &&
    y <= 8500000
  );
}

// ================== helpers de tramos ==================

// Obtiene un mapa id_tramo => nombre_tramo
async function obtenerMapeadoTramosPorId(clientOrPool, ids = []) {
  if (!ids.length) return {};
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const res = await clientOrPool.query(
    `SELECT id_tramo, nombre_tramo FROM ema.tramos WHERE id_tramo IN (${placeholders})`,
    ids
  );
  const map = {};
  res.rows.forEach((r) => {
    map[r.id_tramo] = r.nombre_tramo;
  });
  return map;
}

// Obtiene un mapa nombre_tramo normalizado => id_tramo (todos los proyectos)
async function obtenerMapeadoTramosPorNombre(clientOrPool, nombres = []) {
  if (!nombres.length) return {};
  const normalized = nombres.map((n) => String(n).trim().toLowerCase());
  const res = await clientOrPool.query(`SELECT id_tramo, nombre_tramo FROM ema.tramos`);
  const map = {};
  res.rows.forEach((r) => {
    const key = String(r.nombre_tramo).trim().toLowerCase();
    if (normalized.includes(key)) map[key] = r.id_tramo;
  });
  return map;
}

// Mapeo SOLO para tramos del proyecto indicado (por nombre)
async function obtenerMapeadoTramosPorProyectoYNombre(clientOrPool, id_proyecto, nombres = []) {
  if (!nombres.length) return {};
  const normalized = nombres.map((n) => String(n).trim().toLowerCase());
  const placeholders = normalized.map((_, i) => `$${i + 2}`).join(",");
  const sql = `
    SELECT id_tramo, lower(nombre_tramo) AS nombre_normalizado
    FROM ema.tramos
    WHERE id_proyecto = $1
      AND lower(nombre_tramo) IN (${placeholders})
  `;
  const params = [id_proyecto, ...normalized];
  const res = await clientOrPool.query(sql, params);
  const map = {};
  res.rows.forEach((r) => {
    map[r.nombre_normalizado] = r.id_tramo;
  });
  return map;
}

// ================== notificaciones y utilidades ==================
async function obtenerDestinatariosProyecto(id_proyecto) {
  const projRes = await pool.query(
    `SELECT id_cliente, id_consultor, nombre FROM ema.proyectos WHERE gid = $1`,
    [parseInt(id_proyecto, 10)]
  );
  return projRes.rows[0] || {};
}

async function fetchNotificaciones(req) {
  const { tipo_usuario, id_cliente, id_consultor } = req.user;
  const whereClauses = ["es_global = true"];
  const params = [];

  if (tipo_usuario === 8) {
    whereClauses.push("(id_consultor = $1 AND leido_consultor = false)");
    params.push(id_consultor);
  } else {
    whereClauses.push("(id_usuario = $1 AND leido_usuario = false)");
    params.push(id_cliente);
  }

  const sql = `
    SELECT id, titulo, mensaje, leido_usuario, leido_consultor,
           es_global, id_proyecto, creado_por, creado_en
    FROM public.notificaciones
    WHERE ${whereClauses.join(" OR ")}
    ORDER BY creado_en DESC
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function crearNotificacion({ id_proyecto, tipo, creado_por, req }) {
  try {
    const { id_cliente, id_consultor, nombre } = await obtenerDestinatariosProyecto(id_proyecto);
    const titulos = {
      creada: "Encuesta creada",
      actualizada: "Encuesta actualizada",
      eliminada: "Encuesta eliminada",
      importada: "Encuestas importadas",
    };
    const mensajes = {
      creada: `Se creó una nueva encuesta en el proyecto "${nombre || "desconocido"}".`,
      actualizada: `Se actualizó una encuesta en el proyecto "${nombre || "desconocido"}".`,
      eliminada: `Se eliminó una encuesta del proyecto "${nombre || "desconocido"}".`,
      importada: `Encuestas importadas al proyecto "${nombre || "desconocido"}".`,
    };

    await require("./notificaciones.controller").crearNotificacion({
      proponenteId: id_cliente || null,
      consultorId: id_consultor || null,
      id_proyecto: parseInt(id_proyecto, 10),
      titulo: titulos[tipo] || "Encuesta",
      mensaje: mensajes[tipo] || "",
      creado_por: creado_por || req.user?.username || "Sistema",
      es_global: false,
    });
  } catch (err) {
    console.warn("Error al notificar:", err);
  }
}

// ================== Controladores ==================

// Obtener encuestas (paginado + búsqueda + filtro por tramo)
const obtenerEncuestas = async (req, res) => {
  const p = parseInt(req.query.page ?? 1, 10);
  const l = parseInt(req.query.limit ?? 10, 10);
  const page = Number.isFinite(p) && p > 0 ? p : 1;
  const limit = Number.isFinite(l) && l > 0 ? l : 10;
  const offset = (page - 1) * limit;
  const search = req.query.search ?? "";
  const tramo = req.query.tramo ?? "";

  try {
    const filtros = [];
    const valores = [];

    if (search) {
      filtros.push(`(
        nombre_censista ILIKE $${valores.length + 1} OR
        tramo            ILIKE $${valores.length + 1} OR
        codigo           ILIKE $${valores.length + 1}
      )`);
      valores.push(`%${search}%`);
    }

    if (tramo) {
      filtros.push(`id_tramo = $${valores.length + 1}`);
      valores.push(tramo);
    }

    const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

    const totalQuery = `SELECT COUNT(*) FROM ema.encuestas ${where}`;
    const total = parseInt((await pool.query(totalQuery, valores)).rows[0].count, 10);

    const dataQuery = `
      SELECT *
      FROM ema.encuestas
      ${where}
      ORDER BY id_encuesta DESC
      LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}
    `;
    const result = await pool.query(dataQuery, [...valores, limit, offset]);

    res.json({
      data: result.rows,
      page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
    });
  } catch (error) {
    console.error("Error al obtener encuestas:", error);
    res.status(500).json({ error: "Error al obtener encuestas" });
  }
};

// Obtener una encuesta por ID
const obtenerEncuestaPorId = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM ema.encuestas WHERE id_encuesta = $1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Encuesta no encontrada" });
    res.json(rows[0]);
  } catch (error) {
    console.error("Error al obtener encuesta:", error);
    res.status(500).json({ error: "Error al obtener encuesta" });
  }
};

// Crear encuesta manual
const crearEncuesta = async (req, res) => {
  try {
    const allowedColsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='ema' AND table_name='encuestas'
    `);
    const allowedCols = new Set(allowedColsRes.rows.map((r) => r.column_name));
    const keys = Object.keys(req.body).filter((k) => allowedCols.has(k));
    if (!keys.length) return res.status(400).json({ error: "No hay campos válidos para crear encuesta" });
    const values = keys.map((k) => req.body[k]);

    const columnas = keys.map((k) => `"${k}"`).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

    await pool.query(`INSERT INTO ema.encuestas (${columnas}) VALUES (${placeholders})`, values);

    const id_proyecto = req.body.id_proyecto;
    try {
      if (id_proyecto) {
        await crearNotificacion({ id_proyecto, tipo: "creada", creado_por: req.user?.username, req });
      }
    } catch (notifErr) {
      console.warn("Error al notificar creación de encuesta:", notifErr);
    }

    const notifications = await fetchNotificaciones(req);
    res.status(201).json({
      success: true,
      message: "Encuesta creada correctamente",
      notifications,
    });
  } catch (error) {
    console.error("Error al crear encuesta:", error);
    res.status(500).json({ error: "Error al crear encuesta" });
  }
};

// Actualizar encuesta
const actualizarEncuesta = async (req, res) => {
  const { id } = req.params;
  try {
    const allowedColsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='ema' AND table_name='encuestas'
    `);
    const allowedCols = new Set(allowedColsRes.rows.map((r) => r.column_name));

    const keys = Object.keys(req.body).filter((k) => allowedCols.has(k));
    if (!keys.length) return res.status(400).json({ error: "No hay campos válidos para actualizar" });
    const values = keys.map((k) => req.body[k]);

    const updates = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const queryParams = [...values, id];

    const { rowCount } = await pool.query(
      `UPDATE ema.encuestas SET ${updates} WHERE id_encuesta = $${keys.length + 1}`,
      queryParams
    );

    if (!rowCount) return res.status(404).json({ error: "Encuesta no encontrada" });

    const encQ = await pool.query("SELECT id_proyecto FROM ema.encuestas WHERE id_encuesta = $1", [id]);
    const id_proyecto = encQ.rows[0]?.id_proyecto;
    if (id_proyecto) {
      await crearNotificacion({ id_proyecto, tipo: "actualizada", creado_por: req.user?.username, req });
    }

    const notifications = await fetchNotificaciones(req);
    res.json({
      success: true,
      message: "Encuesta actualizada correctamente",
      notifications,
    });
  } catch (error) {
    console.error("Error al actualizar encuesta:", error);
    res.status(500).json({ error: "Error al actualizar encuesta" });
  }
};

// Eliminar encuesta
const eliminarEncuesta = async (req, res) => {
  const { id } = req.params;
  try {
    const encQ = await pool.query("SELECT id_proyecto FROM ema.encuestas WHERE id_encuesta = $1", [id]);
    const id_proyecto = encQ.rows[0]?.id_proyecto;

    const { rowCount } = await pool.query("DELETE FROM ema.encuestas WHERE id_encuesta = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Encuesta no encontrada" });

    if (id_proyecto) {
      await crearNotificacion({ id_proyecto, tipo: "eliminada", creado_por: req.user?.username, req });
    }

    const notifications = await fetchNotificaciones(req);
    res.json({
      success: true,
      message: "Encuesta eliminada correctamente",
      notifications,
    });
  } catch (error) {
    console.error("Error al eliminar encuesta:", error);
    res.status(500).json({ error: "Error al eliminar encuesta" });
  }
};

// GET /encuestas/proyecto/:id_proyecto (con ?tipo=normal|especial|'' )
const obtenerEncuestasPorProyecto = async (req, res) => {
  const { id_proyecto } = req.params;
  const tipo = String(req.query.tipo || "").toLowerCase(); // '', 'normal', 'especial'

  try {
    const filtros = ["id_proyecto = $1"];
    const params = [id_proyecto];

    if (tipo === "especial") {
      filtros.push(`tipo_inmueble ILIKE '%ESPECIAL%'`);
    } else if (tipo === "normal") {
      filtros.push(`(tipo_inmueble ILIKE '%NORMAL%' OR tipo_inmueble IS NULL OR tipo_inmueble = '')`);
    }

    const sql = `
      SELECT *
      FROM ema.encuestas
      WHERE ${filtros.join(" AND ")}
      ORDER BY id_encuesta DESC
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error("Error al obtener encuestas por proyecto:", error);
    res.status(500).json({ error: "Error al obtener encuestas" });
  }
};

// Obtener por proyecto y tramo (con ?tipo=normal|especial|'')
const obtenerEncuestasPorProyectoYTramo = async (req, res) => {
  const { id_proyecto, id_tramo } = req.params;
  const tipo = String(req.query.tipo || "").toLowerCase(); // '', 'normal', 'especial'

  try {
    const filtros = ["id_proyecto = $1", "id_tramo = $2"];
    const params = [id_proyecto, id_tramo];

    if (tipo === "especial") {
      filtros.push(`tipo_inmueble ILIKE '%ESPECIAL%'`);
    } else if (tipo === "normal") {
      filtros.push(`(tipo_inmueble ILIKE '%NORMAL%' OR tipo_inmueble IS NULL OR tipo_inmueble = '')`);
    }

    const sql = `
      SELECT *
      FROM ema.encuestas
      WHERE ${filtros.join(" AND ")}
      ORDER BY id_encuesta DESC
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error("Error al obtener encuestas por proyecto y tramo:", error);
    res.status(500).json({ error: "Error al obtener encuestas" });
  }
};

// ================== Coordenadas para import ==================
function aplicarGPSyCoordenadas(raw, filtered, warnings, originalRow) {
  const setCoorIfValid = (x, y) => {
    if (esUTM21SValido(x, y)) {
      filtered.coor_x = x;
      filtered.coor_y = y;
      return true;
    }
    return false;
  };
  const tryLonLatToUtm = (lon, lat) => {
    try {
      const [x, y] = proj4(WGS84, UTM21S, [lon, lat]);
      return setCoorIfValid(x, y);
    } catch {
      return false;
    }
  };

  // 1) gps_lat / gps_lon
  if (
    (filtered.coor_x == null || filtered.coor_y == null) &&
    raw.gps_lat != null &&
    raw.gps_lon != null
  ) {
    const lat = parseNumberFlexible(raw.gps_lat);
    const lon = parseNumberFlexible(raw.gps_lon);
    if (lat != null && lon != null) {
      if (!tryLonLatToUtm(lon, lat)) {
        warnings.push({
          row: originalRow,
          field: "gps_lat/gps_lon",
          issue: `Par lon/lat inválido: ${lon},${lat}`,
        });
      }
    }
  }

  // 2) gps string o coordenadas_gps
  const gpsTxt = raw.gps || raw.coordenadas_gps;
  if ((filtered.coor_x == null || filtered.coor_y == null) && typeof gpsTxt === "string") {
    const txt = gpsTxt.trim();

    // 2.1 MGRS
    try {
      const [lon, lat] = mgrs.toPoint(txt);
      if (!tryLonLatToUtm(lon, lat)) {
        warnings.push({ row: originalRow, field: "gps", issue: `MGRS fuera de rango: ${txt}` });
      }
    } catch {
      // 2.2 "lon lat" o "x y"
      const parts = txt.split(/[\s,;]+/).filter(Boolean);
      if (parts.length === 2) {
        let a = parseNumberFlexible(parts[0]);
        let b = parseNumberFlexible(parts[1]);

        if (a != null && b != null) {
          if (setCoorIfValid(a, b) || setCoorIfValid(b, a)) {
            // utm directo
          } else if (!(tryLonLatToUtm(a, b) || tryLonLatToUtm(b, a))) {
            warnings.push({
              row: originalRow,
              field: "gps",
              issue: `Par de coordenadas ambiguo: "${txt}"`,
            });
          }
        }
      }
    }
  }

  // 3) coor_x / coor_y ya presentes
  if (
    (filtered.coor_x == null || filtered.coor_y == null) &&
    raw.coor_x != null &&
    raw.coor_y != null
  ) {
    const x = parseNumberFlexible(raw.coor_x);
    const y = parseNumberFlexible(raw.coor_y);
    if (!setCoorIfValid(x, y)) {
      if (!tryLonLatToUtm(x, y)) {
        warnings.push({
          row: originalRow,
          field: "coor_x/coor_y",
          issue: `Valores no válidos: ${raw.coor_x}, ${raw.coor_y}`,
        });
      }
    }
  }

  // Post-cast si quedaron como string
  if (filtered.coor_x != null && typeof filtered.coor_x === "string") {
    const px = parseFloat(filtered.coor_x.replace(/,/g, "."));
    if (!isNaN(px)) filtered.coor_x = px;
  }
  if (filtered.coor_y != null && typeof filtered.coor_y === "string") {
    const py = parseFloat(filtered.coor_y.replace(/,/g, "."));
    if (!isNaN(py)) filtered.coor_y = py;
  }
}

// ================== Importación desde JSON ==================
const importarEncuestasDesdeJSON = async (req, res) => {
  const { id: id_proyecto } = req.params;
  const encuestas = Array.isArray(req.body.encuestas) ? req.body.encuestas : [];

  if (!encuestas.length) {
    return res.status(400).json({ error: "No se recibieron encuestas para importar" });
  }

  const parsedProyecto = parseInt(id_proyecto, 10);
  if (isNaN(parsedProyecto)) {
    return res.status(400).json({ error: "id_proyecto inválido" });
  }

  // Helpers de CI
  const normalizarCI = (v) => (v == null ? "" : String(v).replace(/\D+/g, "").trim());
  const esSoloCeros = (digits) => !!digits && /^0+$/.test(digits);

  // Normalizador de texto para nombres de tramo
  const normalizeText = (s = "") =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

  // Índices de tramos por nombre (solo del proyecto)
  const buildTramoIndex = (tramosRows = []) => {
    const byName = {};
    const byDigits = {};
    tramosRows.forEach(({ id_tramo, nombre_tramo }) => {
      const norm = normalizeText(nombre_tramo);
      byName[norm] = id_tramo;
      byName[norm.replace(/\s+/g, "")] = id_tramo; // variante sin espacios
      const digits = (norm.match(/\d+/g) || []).join("");
      if (digits) byDigits[digits] = id_tramo;
    });
    return { byName, byDigits };
  };

  // ⚠️ Resolver siempre por TEXTO del Excel; si no hay texto, se omite.
  const resolveIdTramo = (row, tramoIndex) => {
    const txt =
      row.TRAMO ??
      row.tramo ??
      row.nombre_tramo ??
      row["NOMBRE TRAMO"] ??
      row["NOMBRE_TRAMO"];

    const norm = normalizeText(txt || "");
    if (!norm) return null;

    let id = tramoIndex.byName[norm] || tramoIndex.byName[norm.replace(/\s+/g, "")];
    if (!id) {
      const digits = (norm.match(/\d+/g) || []).join("");
      if (digits) id = tramoIndex.byDigits[digits] || null;
    }
    return id ?? null;
  };

  try {
    // columnas y tipos de la tabla
    const colRes = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'ema' AND table_name = 'encuestas'
    `);
    const validCols = new Set(colRes.rows.map((r) => r.column_name));
    const colTypeMap = {};
    colRes.rows.forEach((r) => {
      colTypeMap[r.column_name] = r.data_type;
    });

    // permitimos explícitamente estas dos (se construirán desde el backend)
    validCols.add("id_proyecto");
    validCols.add("id_tramo");

    const normalizedValid = {};
    [...validCols].forEach((c) => {
      const norm = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      normalizedValid[norm] = c;
    });

    const warnings = [];
    const strict = String(req.query.strict || "").toLowerCase() === "true";

    if (req.query.debug === "true") {
      console.log("DEBUG: payload encuestas (primeras 3):", JSON.stringify(encuestas.slice(0, 3), null, 2));
    }

    // Cargar tramos del proyecto e indexarlos
    const { rows: tramosRows } = await pool.query(
      "SELECT id_tramo, nombre_tramo FROM ema.tramos WHERE id_proyecto = $1",
      [parsedProyecto]
    );
    const tramoIndex = buildTramoIndex(tramosRows);

    // Normalización por fila
    const prepared = [];
    let skippedByTramo = 0;

    for (let rowIdx = 0; rowIdx < encuestas.length; rowIdx++) {
      const raw = encuestas[rowIdx];
      const originalRow = raw.__original_row_number || rowIdx + 2;

      // Resolver id_tramo SOLO por nombre de Excel
      const idTramoResuelto = resolveIdTramo(raw, tramoIndex);
      if (!idTramoResuelto) {
        skippedByTramo++;
        warnings.push({
          row: originalRow,
          field: "id_tramo",
          issue: `Tramo "${raw.TRAMO ?? raw.tramo ?? raw.nombre_tramo ?? ""}" no existe en este proyecto`,
        });
        continue; // se omite la fila
      }

      const filtered = { id_proyecto: parsedProyecto, id_tramo: idTramoResuelto };

      // Mapeo flexible de columnas
      for (let originalKey of Object.keys(raw)) {
        // ignorar id_tramo del payload y metacampos
        if (["id_proyecto", "id_tramo", "__original_row_number"].includes(originalKey)) continue;

        let key = originalKey;
        if (!validCols.has(key)) {
          const normKey = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (normalizedValid[normKey]) {
            key = normalizedValid[normKey];
          } else {
            continue; // columna no existe en tabla
          }
        }

        let valor = raw[originalKey];
        const colType = colTypeMap[key];

        // Fechas
        if (
          (colType === "date" || (colType && colType.startsWith && colType.startsWith("timestamp"))) &&
          valor != null
        ) {
          if (typeof valor === "number") {
            const conv = excelSerialToDate(valor);
            if (!conv) {
              warnings.push({ row: originalRow, field: key, issue: `Fecha serial inválida: ${valor}` });
              valor = null;
            } else {
              valor = conv;
            }
          } else if (typeof valor === "string") {
            const parsed = new Date(valor);
            if (!isNaN(parsed.getTime())) {
              valor = parsed.toISOString().split("T")[0];
            } else {
              warnings.push({ row: originalRow, field: key, issue: `Fecha no parseable: "${valor}"` });
              valor = null;
            }
          }
        }

        // Booleanos
        if (colType === "boolean") {
          if (typeof valor === "string") {
            const p = parseBoolean(valor);
            if (p === null) warnings.push({ row: originalRow, field: key, issue: `Booleano no reconocible: "${valor}"` });
            valor = p;
          } else if (typeof valor === "number") {
            valor = valor === 1;
          }
        }

        // ✅ Numéricos (FIX: sin código muerto)
        if (["numeric", "double precision", "real", "integer", "bigint", "smallint"].includes(colType) && valor != null) {
          valor = parseNumberFlexible(valor);
        }

        filtered[key] = valor;
      }

      // Coordenadas / GPS
      aplicarGPSyCoordenadas(raw, filtered, warnings, originalRow);

      prepared.push(filtered);
    }

    // Modo estricto: si hubo tramos inválidos, abortar
    if (strict && skippedByTramo > 0) {
      return res.status(400).json({
        success: false,
        inserted: 0,
        error: "Hay filas con TRAMO inexistente. No se insertó nada (modo estricto).",
        skippedByTramo,
        warnings,
      });
    }

    // Nada válido para insertar -> 200, no fatal
    if (!prepared.length || !prepared.some((p) => Object.keys(p).length > 2)) {
      return res.status(200).json({
        success: true,
        inserted: 0,
        message: "Ninguna encuesta válida para insertar",
        skippedByTramo,
        warnings,
      });
    }

    // Dedupe por CI (global)
    const tieneCI = Object.prototype.hasOwnProperty.call(colTypeMap, "ci");
    let preparedFiltrado = prepared;
    let skippedByCI = 0;

    if (tieneCI) {
      const yaVistosEnBatch = new Set();
      preparedFiltrado = prepared.filter((row) => {
        const ciDigits = normalizarCI(row.ci);
        if (!ciDigits || esSoloCeros(ciDigits)) return true;
        if (yaVistosEnBatch.has(ciDigits)) {
          skippedByCI++;
          return false;
        }
        yaVistosEnBatch.add(ciDigits);
        return true;
      });

      const { rows: existentes } = await pool.query(`
        SELECT DISTINCT regexp_replace(ci, '\\D', '', 'g') AS ci_norm
        FROM ema.encuestas
        WHERE ci IS NOT NULL
          AND regexp_replace(ci, '\\D', '', 'g') ~ '[1-9]'
      `);
      const existentesSet = new Set(existentes.map((r) => r.ci_norm));

      preparedFiltrado = preparedFiltrado.filter((row) => {
        const ciDigits = normalizarCI(row.ci);
        if (!ciDigits || esSoloCeros(ciDigits)) return true;
        if (existentesSet.has(ciDigits)) {
          skippedByCI++;
          return false;
        }
        return true;
      });
    }

    // Todo duplicado por CI -> 200, no fatal
    if (!preparedFiltrado.length) {
      const notifications = await fetchNotificaciones(req);
      return res.status(200).json({
        success: true,
        inserted: 0,
        message: "No se importó ninguna encuesta: todas estaban duplicadas por CI.",
        skippedByCI,
        skippedByTramo,
        notifications,
        warnings,
      });
    }

    // Inserción por lotes
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const BATCH_SIZE = 100;

      for (let i = 0; i < preparedFiltrado.length; i += BATCH_SIZE) {
        const batch = preparedFiltrado.slice(i, i + BATCH_SIZE);

        const allColsSet = new Set();
        batch.forEach((r) => Object.keys(r).forEach((k) => allColsSet.add(k)));
        const cols = [...allColsSet];

        const values = [];
        const placeholders = batch.map((row, rowIdx) => {
          const rowPlaceholders = cols.map((col, colIdx) => {
            values.push(row[col] !== undefined ? row[col] : null);
            return `$${rowIdx * cols.length + colIdx + 1}`;
          });
          return `(${rowPlaceholders.join(",")})`;
        });

        const insertSQL = `
          INSERT INTO ema.encuestas (${cols.map((c) => `"${c}"`).join(",")})
          VALUES ${placeholders.join(",")}
        `;
        await client.query(insertSQL, values);
      }

      await crearNotificacion({ id_proyecto: parsedProyecto, tipo: "importada", creado_por: req.user?.username, req });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("Error al insertar encuestas:", e);
      return res.status(500).json({ error: "Fallo al insertar encuestas", warnings });
    } finally {
      client.release();
    }

    const notifications = await fetchNotificaciones(req);
    res.json({
      success: true,
      inserted: preparedFiltrado.length,
      message: `${preparedFiltrado.length} encuestas importadas correctamente`,
      skippedByCI,
      skippedByTramo,
      notifications,
      warnings,
    });
  } catch (err) {
    console.error("Error en importarEncuestasDesdeJSON:", err);
    res.status(500).json({ error: "Error interno al importar encuestas" });
  }
};

// ================== GeoJSON de puntos ==================
const obtenerPuntosEncuestaPorProyecto = async (req, res) => {
  const { id_proyecto } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT
         e.id_encuesta,
         e.id_tramo,
         e.tramo AS tramo_texto,

         -- ✅ nombre oficial del tramo (para matchear con ModuloTramos)
         COALESCE(t.nombre_tramo, e.tramo) AS tramo_nombre,

         e.nombre_apellido,
         e.ocupacion,
         e.ingreso_mensual,
         e.ingreso_mensual_comercio,
         e.condicion_ocupacion,
         e.posee_documento,
         e.cant_personas,
         e.percepcion,
         e.interes_reubicacion,
         e.aspectos_positivos,
         e.observaciones,
         e.tipo_inmueble,

         CASE
           WHEN COALESCE(e.tipo_inmueble, '') ILIKE '%ESPECIAL%' THEN 'ESPECIAL'
           ELSE 'NORMAL'
         END AS tipo_inmueble_clase,

         e.coor_x, e.coor_y,
         e.gps_longitude, e.gps_latitude,

         e.ci, e.codigo
       FROM ema.encuestas e
       LEFT JOIN ema.tramos t
              ON t.id_tramo = e.id_tramo
       WHERE e.id_proyecto = $1
         AND (
           (e.coor_x IS NOT NULL AND e.coor_y IS NOT NULL) OR
           (e.gps_longitude IS NOT NULL AND e.gps_latitude IS NOT NULL)
         )`,
      [id_proyecto]
    );

    const features = rows
      .map((r) => {
        let lon, lat;

        if (r.coor_x != null && r.coor_y != null) {
          [lon, lat] = proj4(UTM21S, WGS84, [parseFloat(r.coor_x), parseFloat(r.coor_y)]);
        } else if (r.gps_longitude != null && r.gps_latitude != null) {
          lon = parseFloat(r.gps_longitude);
          lat = parseFloat(r.gps_latitude);
        } else {
          return null;
        }

        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            id: r.id_encuesta,
            id_encuesta: r.id_encuesta,

            // ✅ clave para el filtro
            id_tramo: r.id_tramo,
            tramo_nombre: r.tramo_nombre,

            // ✅ compat
            tramo: r.tramo_nombre,

            tramo_texto: r.tramo_texto,

            nombre: r.nombre_apellido,
            nombre_apellido: r.nombre_apellido,
            ocupacion: r.ocupacion,
            ingreso_mensual: r.ingreso_mensual,
            ingreso_mensual_comercio: r.ingreso_mensual_comercio,
            condicion_ocupacion: r.condicion_ocupacion,
            posee_documento: r.posee_documento,
            cant_personas: r.cant_personas,
            percepcion: r.percepcion,
            interes_reubicacion: r.interes_reubicacion,
            aspectos_positivos: r.aspectos_positivos,
            observaciones: r.observaciones,
            tipo_inmueble: r.tipo_inmueble,
            tipo_inmueble_clase: r.tipo_inmueble_clase,
            ci: r.ci,
            codigo: r.codigo,
          },
        };
      })
      .filter(Boolean);

    res.json({ type: "FeatureCollection", features });
  } catch (error) {
    console.error("❌ Error al obtener puntos de encuestas:", error);
    res.status(500).json({ error: "Error al obtener puntos de encuestas" });
  }
};

// ================== Conteo comisiones ==================
const comisionesPorProyecto = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.gid       AS id_proyecto,
         e.especificar_comision AS comision,
         COUNT(*)    AS cantidad
       FROM ema.encuestas e
       JOIN ema.proyectos p ON e.id_proyecto = p.gid
       WHERE e.especificar_comision IS NOT NULL
       GROUP BY p.gid, e.especificar_comision
       ORDER BY p.gid, e.especificar_comision;`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error al obtener comisiones por proyecto:", err);
    res.status(500).json({ error: "Error interno al obtener comisiones" });
  }
};

// ================== Eliminar encuestas por tramo ==================
const eliminarEncuestasPorProyectoYTramo = async (req, res) => {
  const { id_proyecto, id_tramo } = req.params;

  const pid = parseInt(id_proyecto, 10);
  const tid = parseInt(id_tramo, 10);
  if (isNaN(pid) || isNaN(tid)) {
    return res.status(400).json({ error: "Parámetros id_proyecto o id_tramo inválidos" });
  }

  try {
    const { rowCount: tramoExiste } = await pool.query(
      `SELECT 1 FROM ema.tramos WHERE id_tramo = $1 AND id_proyecto = $2`,
      [tid, pid]
    );
    if (!tramoExiste) {
      return res.status(404).json({ error: "El tramo no existe para este proyecto" });
    }

    const { rows: pre } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
         FROM ema.encuestas
        WHERE id_proyecto = $1 AND id_tramo = $2`,
      [pid, tid]
    );
    const toDelete = pre[0]?.cnt ?? 0;

    if (toDelete === 0) {
      return res.json({
        success: true,
        deleted: 0,
        message: "No había encuestas en ese tramo.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const del = await client.query(
        `DELETE FROM ema.encuestas
          WHERE id_proyecto = $1 AND id_tramo = $2`,
        [pid, tid]
      );

      await crearNotificacion({
        id_proyecto: pid,
        tipo: "eliminada",
        creado_por: req.user?.username,
        req,
      });

      await client.query("COMMIT");
      return res.json({
        success: true,
        deleted: del.rowCount,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("Error al eliminar encuestas por tramo:", e);
      return res.status(500).json({ error: "Error al eliminar encuestas por tramo" });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error en eliminarEncuestasPorProyectoYTramo:", error);
    return res.status(500).json({ error: "Error interno" });
  }
};

// -------- utils -------
const LABEL_OVERRIDES = {
  // Opcional: sobreescribe etiquetas puntuales (campo: "Etiqueta Deseada")
};

const toLabel = (s = "") =>
  LABEL_OVERRIDES[s] ||
  s
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const mapPgType = (t = "") => {
  const type = t.toLowerCase();
  if (type.includes("bool")) return "boolean";
  if (type.includes("date") || type.includes("timestamp")) return "date";
  if (type.includes("int") || type.includes("numeric") || type.includes("double") || type.includes("real")) return "number";
  return "text";
};

const ident = (name = "") => `"${String(name).replace(/"/g, '""')}"`;

// Cache liviano de campos válidos (10 min)
let _cacheCampos = null;
let _cacheAt = 0;
const TTL_MS = 10 * 60 * 1000;

async function getCamposValidos() {
  const now = Date.now();
  if (_cacheCampos && now - _cacheAt < TTL_MS) return _cacheCampos;

  const q = `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='ema' AND table_name='encuestas'
    ORDER BY ordinal_position
  `;
  const { rows } = await pool.query(q);

  const EXCLUIR = new Set(["id_encuesta", "id_proyecto", "id_tramo", "geom"]);

  const campos = rows
    .filter((r) => !EXCLUIR.has(r.column_name))
    .filter((r) => !r.column_name.startsWith("id_"))
    .filter((r) => !r.column_name.endsWith("_id"))
    .filter((r) => !/foto|image|imagen|archivo|pdf|doc|ruta/i.test(r.column_name))
    .map((r) => ({
      name: r.column_name,
      type: mapPgType(r.data_type),
      label: toLabel(r.column_name),
      pgType: r.data_type,
    }));

  _cacheCampos = campos;
  _cacheAt = now;
  return campos;
}

// GET /api/encuestas/campos
const camposEncuesta = async (req, res) => {
  try {
    const campos = await getCamposValidos();
    res.json(campos);
  } catch (err) {
    console.error("camposEncuesta error:", err);
    res.status(500).json({ error: "Error al obtener campos" });
  }
};

// GET /api/encuestas/frecuencias?id_proyecto=..&campo=..&id_tramo=..&fecha_grupo=anio|mes|dia
const frecuenciasEncuesta = async (req, res) => {
  try {
    const { id_proyecto, campo, id_tramo, fecha_grupo } = req.query;

    const parsedProyecto = parseInt(id_proyecto, 10);
    if (isNaN(parsedProyecto)) return res.status(400).json({ error: "id_proyecto inválido" });
    if (!campo) return res.status(400).json({ error: "campo es requerido" });

    const campos = await getCamposValidos();
    const meta = campos.find((c) => c.name === campo);
    if (!meta) return res.status(400).json({ error: "Campo no permitido" });

    const params = [parsedProyecto];
    const where = ["id_proyecto = $1"];

    if (id_tramo && id_tramo !== "all") {
      params.push(Number(id_tramo));
      where.push(`id_tramo = $${params.length}`);
    }

    let labelExpr = "";
    let orderExpr = "COUNT(*) DESC";

    if (meta.type === "date" && fecha_grupo) {
      const unit = fecha_grupo === "anio" ? "year" : fecha_grupo === "mes" ? "month" : "day";

      const truncExpr = `date_trunc('${unit}', ${ident(campo)})`;
      const fmt = fecha_grupo === "anio" ? "YYYY" : fecha_grupo === "mes" ? "YYYY-MM" : "YYYY-MM-DD";

      labelExpr = `TO_CHAR(${truncExpr}, '${fmt}')`;
      orderExpr = `${truncExpr} ASC`;
    } else if (meta.type === "boolean") {
      labelExpr = `CASE
        WHEN ${ident(campo)} IS TRUE  THEN 'Sí'
        WHEN ${ident(campo)} IS FALSE THEN 'No'
        ELSE 'Sin dato' END`;
    } else if (meta.type === "number") {
      // ✅ FIX: agrupar numéricos como categorías enteras (1,2,3…)
      labelExpr = `CASE
        WHEN ${ident(campo)} IS NULL THEN 'Sin dato'
        ELSE ((${ident(campo)}::numeric)::int)::text
      END`;
      orderExpr = `((${ident(campo)}::numeric)::int) ASC`;
    } else {
      labelExpr = `NULLIF(TRIM(${ident(campo)}::text), '')`;
    }

    const sql = `
      SELECT COALESCE(${labelExpr}, 'Sin dato') AS label, COUNT(*)::int AS count
      FROM ema.encuestas
      WHERE ${where.join(" AND ")}
      GROUP BY 1
      ORDER BY ${orderExpr}
      LIMIT 200
    `;

    const { rows } = await pool.query(sql, params);
    const total = rows.reduce((acc, r) => acc + r.count, 0);

    res.json({
      campo: { name: meta.name, label: meta.label, type: meta.type },
      data: rows,
      total,
    });
  } catch (err) {
    console.error("frecuenciasEncuesta error:", err);
    res.status(500).json({ error: "Error al obtener frecuencias" });
  }
};

// ================== EXPORT KML / KMZ ==================
const escapeXml = (s = "") =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function _fetchEncuestasConCoords({ id_proyecto, id_tramo = "all" }) {
  const params = [id_proyecto];
  const where = ["id_proyecto = $1"];

  if (id_tramo && id_tramo !== "all") {
    params.push(parseInt(id_tramo, 10));
    where.push(`id_tramo = $${params.length}`);
  }

  const sql = `
    SELECT
      id_encuesta, id_tramo, tramo, codigo, nombre_apellido,
      ocupacion, cant_personas, percepcion, observaciones,
      tipo_inmueble,
      coor_x, coor_y, gps_longitude, gps_latitude,
      ingreso_mensual, ingreso_mensual_comercio, condicion_ocupacion,
      posee_documento, interes_reubicacion, aspectos_positivos
    FROM ema.encuestas
    WHERE ${where.join(" AND ")} 
      AND (
        (coor_x IS NOT NULL AND coor_y IS NOT NULL) OR
        (gps_longitude IS NOT NULL AND gps_latitude IS NOT NULL)
      )
    ORDER BY id_encuesta DESC;
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

function _rowsToKml({ rows = [], nombreDoc = "Encuestas" }) {
  const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(nombreDoc)}</name>
  <Style id="pinBlue">
    <IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/blu-circle.png</href></Icon></IconStyle>
  </Style>
  <Style id="pinRed">
    <IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle>
  </Style>`;

  const kmlFooter = `</Document></kml>`;

  const feats = rows
    .map((r) => {
      // Convertir a WGS84 (lon/lat)
      let lon = null,
        lat = null;
      if (r.coor_x != null && r.coor_y != null) {
        const [LON, LAT] = proj4(UTM21S, WGS84, [Number(r.coor_x), Number(r.coor_y)]);
        lon = LON;
        lat = LAT;
      } else if (r.gps_longitude != null && r.gps_latitude != null) {
        lon = Number(r.gps_longitude);
        lat = Number(r.gps_latitude);
      }
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return "";

      const nombre = r.nombre_apellido || r.codigo || `Encuesta ${r.id_encuesta}`;
      const styleUrl = (r.tipo_inmueble || "").toUpperCase().includes("ESPECIAL") ? "#pinRed" : "#pinBlue";

      const descHtml = `<table border="1" cellpadding="3" cellspacing="0">
        <tr><th align="left">ID</th><td>${escapeXml(r.id_encuesta)}</td></tr>
        <tr><th align="left">Tramo</th><td>${escapeXml(r.tramo || "")}</td></tr>
        <tr><th align="left">Nombre</th><td>${escapeXml(r.nombre_apellido || "")}</td></tr>
        <tr><th align="left">Ocupación</th><td>${escapeXml(r.ocupacion || "")}</td></tr>
        <tr><th align="left">Personas</th><td>${escapeXml(r.cant_personas ?? "")}</td></tr>
        <tr><th align="left">Percepción</th><td>${escapeXml(r.percepcion || "")}</td></tr>
        <tr><th align="left">Tipo inmueble</th><td>${escapeXml(r.tipo_inmueble || "")}</td></tr>
        <tr><th align="left">Ingreso</th><td>${escapeXml(r.ingreso_mensual || r.ingreso_mensual_comercio || "")}</td></tr>
        <tr><th align="left">Cond. ocupación</th><td>${escapeXml(r.condicion_ocupacion || "")}</td></tr>
        <tr><th align="left">Documento</th><td>${escapeXml(r.posee_documento || "")}</td></tr>
        <tr><th align="left">Interés reubicación</th><td>${escapeXml(String(r.interes_reubicacion ?? ""))}</td></tr>
        <tr><th align="left">Aspectos positivos</th><td>${escapeXml(r.aspectos_positivos || "")}</td></tr>
        <tr><th align="left">Obs.</th><td>${escapeXml(r.observaciones || "")}</td></tr>
      </table>`;

      const extendedData = `
      <ExtendedData>
        <Data name="id_encuesta"><value>${escapeXml(r.id_encuesta)}</value></Data>
        <Data name="tramo"><value>${escapeXml(r.tramo || "")}</value></Data>
        <Data name="nombre_apellido"><value>${escapeXml(r.nombre_apellido || "")}</value></Data>
        <Data name="tipo_inmueble"><value>${escapeXml(r.tipo_inmueble || "")}</value></Data>
        <Data name="cant_personas"><value>${escapeXml(r.cant_personas ?? "")}</value></Data>
      </ExtendedData>`;

      return `
    <Placemark>
      <name>${escapeXml(nombre)}</name>
      <styleUrl>${styleUrl}</styleUrl>
      <description><![CDATA[${descHtml}]]></description>
      ${extendedData}
      <Point><coordinates>${lon},${lat},0</coordinates></Point>
    </Placemark>`;
    })
    .join("\n");

  return `${kmlHeader}\n${feats}\n${kmlFooter}`;
}

const exportEncuestasKml = async (req, res) => {
  try {
    const id_proyecto = parseInt(req.query.proyecto, 10);
    const tramo = req.query.tramo ?? "all";
    if (!Number.isFinite(id_proyecto)) {
      return res.status(400).json({ error: "Parámetro ?proyecto requerido" });
    }

    const rows = await _fetchEncuestasConCoords({ id_proyecto, id_tramo: tramo });
    if (!rows.length) {
      return res.status(404).json({ error: "No hay encuestas con coordenadas" });
    }

    const nombreDoc = `Encuestas_Proyecto_${id_proyecto}${tramo === "all" ? "" : "_Tramo_" + tramo}`;
    const kml = _rowsToKml({ rows, nombreDoc });

    const filename = `${nombreDoc}.kml`;
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml; charset=UTF-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(kml);
  } catch (err) {
    console.error("exportEncuestasKml error:", err);
    res.status(500).json({ error: "Error al exportar KML" });
  }
};

const exportEncuestasKmz = async (req, res) => {
  try {
    const id_proyecto = parseInt(req.query.proyecto, 10);
    const tramo = req.query.tramo ?? "all";
    if (!Number.isFinite(id_proyecto)) {
      return res.status(400).json({ error: "Parámetro ?proyecto requerido" });
    }

    const rows = await _fetchEncuestasConCoords({ id_proyecto, id_tramo: tramo });
    if (!rows.length) {
      return res.status(404).json({ error: "No hay encuestas con coordenadas" });
    }

    const nombreDoc = `Encuestas_Proyecto_${id_proyecto}${tramo === "all" ? "" : "_Tramo_" + tramo}`;
    const kml = _rowsToKml({ rows, nombreDoc });

    const filename = `${nombreDoc}.kmz`;
    res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (e) => {
      throw e;
    });
    archive.pipe(res);
    archive.append(kml, { name: "doc.kml" });
    await archive.finalize();
  } catch (err) {
    console.error("exportEncuestasKmz error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Error al exportar KMZ" });
  }
};

// GET /api/encuestas/informe/:id
const obtenerInformeEncuesta = async (req, res) => {
  const { id } = req.params;
  const id_encuesta = parseInt(id, 10);

  if (!Number.isFinite(id_encuesta)) {
    return res.status(400).json({ error: "id inválido" });
  }

  try {
    // 1) Traer encuesta base
    const q = await pool.query(`SELECT * FROM ema.encuestas WHERE id_encuesta = $1`, [id_encuesta]);

    if (!q.rowCount) {
      return res.status(404).json({ error: "Encuesta no encontrada" });
    }

    const e = q.rows[0];

    // 2) Fotos (URL primero, luego fallback)
    const fotos = [];
    const pushFoto = (ruta) => {
      if (!ruta) return;
      const s = String(ruta).trim();
      if (!s) return;
      if (fotos.some((f) => f.ruta_archivo === s)) return;
      fotos.push({ ruta_archivo: s });
    };

    pushFoto(e.foto_1_url || e.foto_1);
    pushFoto(e.foto_2_url || e.foto_2);
    pushFoto(e.foto_3_url || e.foto_3);

    // 3) Campos “válidos” para informe
    const campos = await getCamposValidos();

    const formatValue = (val, type) => {
      if (val === null || val === undefined) return "-";
      if (type === "boolean") return val === true ? "Sí" : "No";
      if (type === "date") {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      if (Array.isArray(val)) return val.join(", ");
      if (typeof val === "object") {
        try {
          return JSON.stringify(val);
        } catch {
          return String(val);
        }
      }
      const s = String(val).trim();
      return s === "" ? "-" : s;
    };

    const rowsFull = campos.map((c) => ({
      id_pregunta: c.name,
      etiqueta: c.label,
      valor: formatValue(e[c.name], c.type),
    }));

    const rows = rowsFull.filter((r) => r.valor !== "-" && r.valor !== "Sin dato");

    const fallback = [
      { id_pregunta: "codigo", etiqueta: "Código", valor: e.codigo ?? "-" },
      { id_pregunta: "nombre_apellido", etiqueta: "Nombre y Apellido", valor: e.nombre_apellido ?? "-" },
      { id_pregunta: "ocupacion", etiqueta: "Ocupación", valor: e.ocupacion ?? "-" },
      { id_pregunta: "tipo_inmueble", etiqueta: "Tipo inmueble", valor: e.tipo_inmueble ?? "-" },
      { id_pregunta: "percepcion", etiqueta: "Percepción", valor: e.percepcion ?? "-" },
    ].filter((r) => r.valor !== "-" && r.valor !== "" && r.valor != null);

    const rowsFinal = rows.length ? rows : fallback;

    return res.json({
      success: true,
      id_encuesta,
      codigo: e.codigo ?? null,
      nombre_apellido: e.nombre_apellido ?? null,
      ocupacion: e.ocupacion ?? null,
      tipo_inmueble: e.tipo_inmueble ?? null,
      percepcion: e.percepcion ?? null,
      rows: rowsFinal,
      data: rowsFinal,
      detalle: rowsFinal,
      rows_full: rowsFull,
      fotos,
      fotos_count: fotos.length,
    });
  } catch (err) {
    console.error("❌ Error obtenerInformeEncuesta:", err);
    return res.status(500).json({ error: "Error al obtener informe de encuesta" });
  }
};

module.exports = {
  obtenerEncuestas,
  obtenerEncuestaPorId,
  crearEncuesta,
  actualizarEncuesta,
  eliminarEncuesta,
  obtenerEncuestasPorProyecto,
  obtenerEncuestasPorProyectoYTramo,
  importarEncuestasDesdeJSON,
  obtenerPuntosEncuestaPorProyecto,
  comisionesPorProyecto,
  eliminarEncuestasPorProyectoYTramo,
  camposEncuesta,
  frecuenciasEncuesta,
  exportEncuestasKml,
  exportEncuestasKmz,
  obtenerInformeEncuesta,
};
