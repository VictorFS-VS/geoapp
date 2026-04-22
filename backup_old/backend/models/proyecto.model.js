// server/models/proyecto.model.js
"use strict";

const pool = require("../db");

/* =========================
 * HELPERS
 * ========================= */

/** Cuenta filas de una tabla SOLO si existe (evita 42P01). */
async function countIfExists(tableFQN, whereCol, idValue) {
  const { rows } = await pool.query("SELECT to_regclass($1) AS oid", [tableFQN]);
  if (!rows?.[0]?.oid) return 0;
  const sql = `SELECT COUNT(*)::int AS c FROM ${tableFQN} WHERE ${whereCol} = $1`;
  const { rows: r2 } = await pool.query(sql, [idValue]);
  return r2?.[0]?.c || 0;
}

/** Chequea existencia de tabla/vista (evita 42P01). */
async function tableExists(tableFQN) {
  const { rows } = await pool.query("SELECT to_regclass($1) AS oid", [tableFQN]);
  return !!rows?.[0]?.oid;
}

/** ✅ Obtiene IDs de clientes miembro de la cartera del Admin_Cliente (tabla correcta). */
async function obtenerMiembrosDeAdminCliente(adminId) {
  const fqn = "ema.cliente_admin_miembro"; // <-- nombre real
  if (!(await tableExists(fqn))) return [];
  const { rows } = await pool.query(
    `SELECT miembro_id::int AS id FROM ${fqn} WHERE admin_id = $1`,
    [adminId]
  );
  return (rows || []).map((r) => r.id).filter(Number.isFinite);
}

/* =========================
 * CREAR
 * ========================= */
const crearProyecto = async (data) => {
  const {
    expediente,
    nombre,
    codigo,
    descripcion,
    fecha_inicio,
    fecha_final,
    tipo_estudio,
    actividad,
    expediente_hidrico,
    tipo_proyecto,
    id_consultor,
    id_proponente,
    sector_proyecto,
    estado,
    fecha_registro,
    coor_x,
    coor_y,
    dpto,
    distrito,
    barrio,
    padron,
    cta_cte,
    finca,
    matricula,
    geom,
    catastro_target_total,
  } = data;

  const campos = [
    "expediente",
    "nombre",
    "codigo",
    "descripcion",
    "fecha_inicio",
    "fecha_final",
    "tipo_estudio",
    "actividad",
    "expediente_hidrico",
    "tipo_proyecto",
    "id_consultor",
    "id_proponente",
    "sector_proyecto",
    "estado",
    "fecha_registro",
    "coor_x",
    "coor_y",
    "dpto",
    "distrito",
    "barrio",
    "padron",
    "cta_cte",
    "finca",
    "matricula",
    "catastro_target_total",
  ];

  const valores = [
    expediente || null,
    nombre,
    codigo,
    descripcion,
    fecha_inicio || null,
    fecha_final || null,
    tipo_estudio,
    actividad,
    expediente_hidrico,
    tipo_proyecto,
    id_consultor || null,
    id_proponente || null,
    sector_proyecto,
    estado,
    fecha_registro || null,
    coor_x || null,
    coor_y || null,
    dpto,
    distrito,
    barrio,
    padron,
    cta_cte,
    finca,
    matricula,
    catastro_target_total ?? null,
  ];

  let placeholders = valores.map((_, i) => `$${i + 1}`);
  if (geom) {
    campos.push("geom");
    placeholders.push(`ST_SetSRID(ST_GeomFromGeoJSON($${valores.length + 1}), 32721)`);
    valores.push(geom);
  }

  const sql = `
    INSERT INTO ema.proyectos (${campos.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING gid
  `;
  const { rows } = await pool.query(sql, valores);
  return rows[0];
};

/* =========================
 * ACTUALIZAR
 * ========================= */
const actualizarProyecto = async (id, data) => {
  const allowed = [
    "expediente",
    "nombre",
    "codigo",
    "descripcion",
    "fecha_inicio",
    "fecha_final",
    "tipo_estudio",
    "actividad",
    "expediente_hidrico",
    "tipo_proyecto",
    "id_consultor",
    "id_proponente",
    "sector_proyecto",
    "estado",
    "fecha_registro",
    "coor_x",
    "coor_y",
    "dpto",
    "distrito",
    "barrio",
    "padron",
    "cta_cte",
    "finca",
    "matricula",
    "catastro_target_total",
  ];

  const sets = [];
  const valores = [];
  let i = 1;

  for (const c of allowed) {
    if (!(c in data)) continue; // ✅ solo si vino en el body

    let v = data[c];
    if (typeof v === "string" && v.trim() === "") v = null;

    sets.push(`${c} = $${i++}`);
    valores.push(v ?? null);
  }

  // geom opcional
  if ("geom" in data && data.geom && String(data.geom).trim() !== "") {
    sets.push(`geom = ST_SetSRID(ST_GeomFromGeoJSON($${i++}), 32721)`);
    valores.push(data.geom);
  }

  if (!sets.length) {
    const { rows } = await pool.query(`SELECT gid FROM ema.proyectos WHERE gid = $1`, [id]);
    return rows[0] || null;
  }

  valores.push(id);

  const sql = `
    UPDATE ema.proyectos
       SET ${sets.join(", ")}
     WHERE gid = $${i}
     RETURNING gid
  `;

  const { rows } = await pool.query(sql, valores);
  return rows[0] || null;
};

/* =========================
 * LISTAR (v_proyectos_index + JOIN a proyectos para filtrar)
 * ========================= */

// ACEPTA: ids_proponentes (array<int>) para filtrar por cartera
// ✅ NUEVO: or_consultor (bool) para hacer OR entre consultor y cartera
// ✅ FIX: cartera por COALESCE(p.id_proponente, p.id_cliente)
const obtenerProyectos = async (f) => {
  const {
    codigo,
    nombre,
    des_estado,
    proponente,
    fecha_inicio_desde,
    fecha_inicio_hasta,
    id_proponente,
    id_consultor,
    ids_proponentes,
    or_consultor = false,
    limit,
    offset,
  } = f;

  const cond = [];
  const val = [];
  let i = 1;

  // filtros visibles (de la vista)
  if (codigo) {
    cond.push(`v.codigo ILIKE $${i}`);
    val.push(`%${codigo}%`);
    i++;
  }
  if (nombre) {
    cond.push(`v.nombre ILIKE $${i}`);
    val.push(`%${nombre}%`);
    i++;
  }
  if (des_estado) {
    cond.push(`v.des_estado = $${i}`);
    val.push(des_estado);
    i++;
  }
  if (proponente) {
    cond.push(`v.proponente = $${i}`);
    val.push(proponente);
    i++;
  }

  const tieneCartera = Array.isArray(ids_proponentes) && ids_proponentes.length > 0;

  // ✅ FIX: cartera compara contra COALESCE(id_proponente,id_cliente)
  const CAR_COL = "COALESCE(p.id_proponente, p.id_cliente)";

  if (or_consultor && id_consultor != null && tieneCartera) {
    // consultor ve: (asignados a él) OR (clientes de su cartera)
    cond.push(`(p.id_consultor = $${i} OR ${CAR_COL} = ANY($${i + 1}::int[]))`);
    val.push(id_consultor, ids_proponentes);
    i += 2;
  } else {
    if (id_consultor != null) {
      cond.push(`p.id_consultor = $${i}`);
      val.push(id_consultor);
      i++;
    }

    if (tieneCartera) {
      cond.push(`${CAR_COL} = ANY($${i}::int[])`);
      val.push(ids_proponentes);
      i++;
    } else if (id_proponente) {
      // ✅ también coherente con tu modelo “proponente = COALESCE(...)”
      cond.push(`${CAR_COL} = $${i}`);
      val.push(id_proponente);
      i++;
    }
  }

  if (fecha_inicio_desde) {
    cond.push(`v.fecha_inicio::date >= $${i}::date`);
    val.push(fecha_inicio_desde);
    i++;
  }
  if (fecha_inicio_hasta) {
    cond.push(`v.fecha_inicio::date <= $${i}::date`);
    val.push(fecha_inicio_hasta);
    i++;
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const sql = `
    SELECT v.gid, v.codigo, v.nombre, v.des_estado, v.consultor, v.proponente, v.fecha_inicio
    FROM ema.v_proyectos_index v
    JOIN ema.proyectos p ON p.gid = v.gid
    ${where}
    ORDER BY v.gid DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;
  val.push(limit, offset);

  const { rows } = await pool.query(sql, val);
  return rows;
};

const contarProyectos = async (f) => {
  const {
    codigo,
    nombre,
    des_estado,
    proponente,
    fecha_inicio_desde,
    fecha_inicio_hasta,
    id_proponente,
    id_consultor,
    ids_proponentes,
    or_consultor = false,
  } = f;

  const cond = [];
  const val = [];
  let i = 1;

  if (codigo) {
    cond.push(`v.codigo ILIKE $${i}`);
    val.push(`%${codigo}%`);
    i++;
  }
  if (nombre) {
    cond.push(`v.nombre ILIKE $${i}`);
    val.push(`%${nombre}%`);
    i++;
  }
  if (des_estado) {
    cond.push(`v.des_estado = $${i}`);
    val.push(des_estado);
    i++;
  }
  if (proponente) {
    cond.push(`v.proponente = $${i}`);
    val.push(proponente);
    i++;
  }

  const tieneCartera = Array.isArray(ids_proponentes) && ids_proponentes.length > 0;
  const CAR_COL = "COALESCE(p.id_proponente, p.id_cliente)";

  if (or_consultor && id_consultor != null && tieneCartera) {
    cond.push(`(p.id_consultor = $${i} OR ${CAR_COL} = ANY($${i + 1}::int[]))`);
    val.push(id_consultor, ids_proponentes);
    i += 2;
  } else {
    if (id_consultor != null) {
      cond.push(`p.id_consultor = $${i}`);
      val.push(id_consultor);
      i++;
    }

    if (tieneCartera) {
      cond.push(`${CAR_COL} = ANY($${i}::int[])`);
      val.push(ids_proponentes);
      i++;
    } else if (id_proponente) {
      cond.push(`${CAR_COL} = $${i}`);
      val.push(id_proponente);
      i++;
    }
  }

  if (fecha_inicio_desde) {
    cond.push(`v.fecha_inicio::date >= $${i}::date`);
    val.push(fecha_inicio_desde);
    i++;
  }
  if (fecha_inicio_hasta) {
    cond.push(`v.fecha_inicio::date <= $${i}::date`);
    val.push(fecha_inicio_hasta);
    i++;
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const sql = `
    SELECT COUNT(*) AS count
    FROM ema.v_proyectos_index v
    JOIN ema.proyectos p ON p.gid = v.gid
    ${where}
  `;

  const { rows } = await pool.query(sql, val);
  return rows[0];
};

/* =========================
 * GET BY ID
 * ========================= */
const obtenerProyectoPorId = async (id) => {
  const { rows } = await pool.query("SELECT * FROM ema.proyectos WHERE gid = $1", [id]);
  return rows[0];
};

/* =========================
 * GEOMETRÍAS/CAPAS
 * ========================= */
const obtenerGeomProyecto = async (idProyecto) => {
  const sql = `
    SELECT 
      gid,
      gid AS id_proyecto,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ema.proyectos
    WHERE gid = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [idProyecto]);
  return rows;
};

const obtenerPoligonosPorProyecto = async (idProyecto) => {
  const sql = `
    SELECT 
      pol.gid, pol.id_proyecto, pol.proyecto, pol.propietari, pol.dpto, pol.dist, pol.area_m2,
      p.codigo, p.nombre,
      ST_AsGeoJSON(ST_Transform(pol.geom, 4326))::json AS geometry
    FROM ema.poligono_proyecto pol
    LEFT JOIN ema.proyectos p ON p.gid = pol.id_proyecto
    WHERE pol.id_proyecto = $1
  `;
  const { rows } = await pool.query(sql, [idProyecto]);
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        id_proyecto: r.id_proyecto,
        proyecto: r.proyecto,
        propietari: r.propietari,
        dpto: r.dpto,
        dist: r.dist,
        area_m2: r.area_m2,
        codigo: r.codigo,
        nombre: r.nombre,
      },
    })),
  };
};

const obtenerUsoActualProyecto = async (id) => {
  const sql = `
    SELECT 
      gid,
      uso, 
      categoria,
      id_colonia AS id_proyecto,
      TO_CHAR(fecha_inicial, 'YYYY-MM-DD') AS fecha_inicial,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ema.bloques_uso_actual
    WHERE id_colonia = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        uso: r.uso,
        categoria: r.categoria,
        id_proyecto: r.id_proyecto,
        fecha_inicial: r.fecha_inicial,
      },
    })),
  };
};

const obtenerUsoAlternativoProyecto = async (id) => {
  const sql = `
    SELECT 
      gid, 
      uso, 
      categoria,
      id_colonia AS id_proyecto,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ema.bloques_uso_alternativo
    WHERE id_colonia = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        uso: r.uso,
        categoria: r.categoria,
        id_proyecto: r.id_proyecto,
      },
    })),
  };
};

const obtenerUso1986Proyecto = async (id) => {
  const sql = `
    SELECT 
      gid, 
      uso, 
      categorias, 
      sup_cat,
      id_colonia AS id_proyecto,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ema.bloques_uso86
    WHERE id_colonia = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        uso: r.uso,
        categorias: r.categorias,
        sup_cat: r.sup_cat,
        id_proyecto: r.id_proyecto,
      },
    })),
  };
};

const obtenerPlanoProyecto = async (id) => {
  const sql = `
    SELECT gid, uso, categoria, area_m2,
           ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ema.plano_proyecto
    WHERE id_proyecto = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        uso: r.uso,
        categoria: r.categoria,
        area_m2: r.area_m2,
      },
    })),
  };
};

const obtenerPrimerProyectoPorProponente = async (idCliente) => {
  const sql = `
    SELECT gid
    FROM ema.proyectos
    WHERE id_proponente = $1 OR id_cliente = $1
    ORDER BY fecha_registro DESC NULLS LAST, gid DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [idCliente]);
  return rows?.[0]?.gid || null;
};

/* ===== nuevas consultas: comunidades indígenas ===== */
const obtenerComIndigenaProyecto = async (id) => {
  const fqn = "ema.bloques_comu_ind";
  if (!(await tableExists(fqn))) {
    return { type: "FeatureCollection", features: [] };
  }

  const sql = `
    SELECT 
      id AS gid,
      id AS id_comunidad,
      'comunidades indigenas'::text AS categoria,
      id_proyecto,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ${fqn}
    WHERE id_proyecto = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        id_comunidad: r.id_comunidad,
        categoria: r.categoria,
        id_proyecto: r.id_proyecto,
      },
    })),
  };
};

/* =========================
 * DEPENDENCIAS + ELIMINAR
 * ========================= */
async function revisarDependencias(idProyecto) {
  const deps = {
    tramos: await countIfExists("ema.tramos", "id_proyecto", idProyecto),
    declaraciones: await countIfExists("ema.declaraciones", "id_proyecto", idProyecto),
    pga: await countIfExists("ema.pga", "id_proyecto", idProyecto),
    resoluciones: await countIfExists("ema.resoluciones", "id_proyecto", idProyecto),
    bloques_comu_ind: await countIfExists("ema.bloques_comu_ind", "id_proyecto", idProyecto),
    bloques_progresivas: await countIfExists("ema.bloques_progresivas", "id_proyecto", idProyecto),

    // Informes compartidos (SET NULL, no bloquea pero avisamos)
    informe_share_link: await countIfExists("ema.informe_share_link", "id_proyecto", idProyecto),
  };

  Object.keys(deps).forEach((k) => {
    if (!deps[k]) delete deps[k];
  });

  return deps;
}

async function eliminarProyecto(idProyecto, { force = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const deps = await revisarDependencias(idProyecto);
    const detalles = Object.entries(deps).map(([k, n]) => `${k} (${n})`);

    if (detalles.length && !force) {
      await client.query("ROLLBACK");
      return { bloqueado: true, detalles, dependencias: deps };
    }

    if (await tableExists("ema.tramos")) {
      await client.query(`DELETE FROM ema.tramos WHERE id_proyecto = $1`, [idProyecto]);
    }
    if (await tableExists("ema.resoluciones")) {
      await client.query(`DELETE FROM ema.resoluciones WHERE id_proyecto = $1`, [idProyecto]);
    }
    if (await tableExists("ema.pga")) {
      await client.query(`DELETE FROM ema.pga WHERE id_proyecto = $1`, [idProyecto]);
    }
    if (await tableExists("ema.declaraciones")) {
      await client.query(`DELETE FROM ema.declaraciones WHERE id_proyecto = $1`, [idProyecto]);
    }
    if (await tableExists("ema.bloques_comu_ind")) {
      await client.query(`DELETE FROM ema.bloques_comu_ind WHERE id_proyecto = $1`, [idProyecto]);
    }
    if (await tableExists("ema.bloques_progresivas")) {
      await client.query(`DELETE FROM ema.bloques_progresivas WHERE id_proyecto = $1`, [idProyecto]);
    }

    const { rowCount } = await client.query(`DELETE FROM ema.proyectos WHERE gid = $1`, [idProyecto]);

    if (!rowCount) {
      await client.query("ROLLBACK");
      return { bloqueado: false, notFound: true };
    }

    await client.query("COMMIT");
    return { bloqueado: false };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* =========================
 * HELPERS EXTRA (modelo)
 * ========================= */
const obtenerProponenteDeProyecto = async (gidProyecto) => {
  const sql = `
    SELECT COALESCE(id_proponente, id_cliente) AS id_proponente
    FROM ema.proyectos
    WHERE gid = $1
  `;
  const { rows } = await pool.query(sql, [gidProyecto]);
  return rows?.[0]?.id_proponente || null;
};

const contarProyectosDeProponente = async (idProponente) => {
  const sql = `
    SELECT COUNT(*)::int AS cant
    FROM ema.proyectos
    WHERE (id_proponente = $1 OR id_cliente = $1)
  `;
  const { rows } = await pool.query(sql, [idProponente]);
  return rows?.[0]?.cant || 0;
};

const obtenerPoligonosPorProponente = async (idProponente) => {
  const sql = `
    SELECT 
      pol.gid, pol.id_proyecto, pol.proyecto, pol.propietari, pol.dpto, pol.dist, pol.area_m2,
      p.codigo, p.nombre,
      ST_AsGeoJSON(ST_Transform(pol.geom, 4326))::json AS geometry
    FROM ema.poligono_proyecto pol
    JOIN ema.proyectos p ON p.gid = pol.id_proyecto
    WHERE (p.id_proponente = $1 OR p.id_cliente = $1)
  `;
  const { rows } = await pool.query(sql, [idProponente]);
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        id_proyecto: r.id_proyecto,
        proyecto: r.proyecto,
        propietari: r.propietari,
        dpto: r.dpto,
        dist: r.dist,
        area_m2: r.area_m2,
        codigo: r.codigo,
        nombre: r.nombre,
      },
    })),
  };
};

const obtenerHermanosPorProyecto = async (gidProyecto) => {
  const sql = `
    WITH proponente AS (
      SELECT COALESCE(id_proponente, id_cliente) AS id_prop
      FROM ema.proyectos
      WHERE gid = $1
    )
    SELECT
      p.gid AS id,
      p.gid AS id_proyecto,
      COALESCE(NULLIF(p.nombre,''), 'Proyecto '||p.gid) AS nombre
    FROM ema.proyectos p, proponente pr
    WHERE COALESCE(p.id_proponente, p.id_cliente) = pr.id_prop
    ORDER BY p.gid ASC
  `;
  const { rows } = await pool.query(sql, [gidProyecto]);
  return rows;
};

/* =========================
 * NUEVO: actualizar estado por etapa
 * ========================= */

const ESTADO_MAP = {
  mesa: { flag: "mesa_control", fechas: ["mesa_fecha_ini", "mesa_fecha_pago"], obs: "mesa_obs", usu: "mesa_usu_modif" },
  atec_ini: { flag: "atec_ini", fechas: ["atec_ini_fecha"], obs: "atec_ini_obs", usu: "atec_ini_usu_modif" },
  geomatica: { flag: "geomatica", fechas: ["geo_fecha_ini"], obs: "geo_obs", usu: "geo_usu_modif" },
  atecnico: { flag: "atecnico", fechas: ["atec_fecha_ini", "atec_fecha_fin"], obs: "atec_obs", usu: "atec_usu_modif" },
  rima_p: { flag: "rima_p", fechas: ["rima_p_fecha"], obs: "rima_p_obs", usu: "rima_p_usu_modif" },
  rima_w: { flag: "rima_w", fechas: ["rima_w_fecha"], obs: "rima_w_obs", usu: "rima_w_usu_modif" },
  diva: { flag: "diva", fechas: ["diva_fecha_ini"], obs: "diva_obs", usu: "diva_usu_modif" },
  dir_gen: { flag: "dir_gen", fechas: ["dir_gen_fecha_ini"], obs: "dir_gen_obs", usu: "dir_gen_usu_modif" },
  dia: { flag: "dia", fechas: ["dia_fecha"], obs: "dia_obs", usu: "dia_usu_modif" },
  resol: { flag: "resol", fechas: ["resol_fecha"], obs: "resol_obs", usu: "resol_usu_modif" },
  man: { flag: "man", fechas: ["man_fecha"], obs: "man_obs", usu: "man_usu_modif" },
  pga: { flag: "pga", fechas: ["pga_fecha"], obs: "pga_obs", usu: "pga_usu_modif" },
};

const actualizarEstadoProyecto = async (id, { etapa, si, fechas = {}, obs = null, usuario = "api" }) => {
  const cfg = ESTADO_MAP[etapa];
  if (!cfg) throw new Error("Etapa desconocida");

  const sets = [];
  const vals = [];
  let i = 1;

  sets.push(`${cfg.flag} = $${i++}`);
  vals.push(si ? "SI" : "N");

  for (const col of cfg.fechas || []) {
    sets.push(`${col} = $${i++}`);
    vals.push(fechas[col] || null);
  }

  if (cfg.obs) {
    sets.push(`${cfg.obs} = $${i++}`);
    vals.push(obs || null);
  }

  if (cfg.usu) {
    sets.push(`${cfg.usu} = $${i++}`);
    vals.push(usuario);
  }

  sets.push(`gid = $${i++}`);
  vals.push(id);

  const sql = `
    UPDATE ema.proyectos
       SET ${sets.slice(0, -1).join(", ")}
     WHERE ${sets.slice(-1)[0]}
     RETURNING gid, estado, des_estado;
  `;

  const { rows } = await pool.query(sql, vals);
  return rows?.[0] || null;
};

/* ===== NUEVO: área de influencia ===== */
const obtenerAreaInfluenciaProyecto = async (id) => {
  const fqn = "ema.bloques_area_influensia";
  if (!(await tableExists(fqn))) {
    return { type: "FeatureCollection", features: [] };
  }

  const sql = `
    SELECT
      id_area_influencia AS gid,
      id_area_influencia,
      id_proyecto,
      proyecto,
      propietari,
      dist,
      dpto,
      finca,
      padron,
      cta_cte,
      area_m2,
      buff_dist,
      orig_fid,
      ST_AsGeoJSON(ST_Transform(geom, 4326))::json AS geometry
    FROM ${fqn}
    WHERE id_proyecto = $1 AND geom IS NOT NULL
  `;
  const { rows } = await pool.query(sql, [id]);

  return {
    type: "FeatureCollection",
    features: (rows || []).map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        gid: r.gid,
        id_area_influencia: r.id_area_influencia,
        id_proyecto: r.id_proyecto,
        proyecto: r.proyecto,
        propietari: r.propietari,
        dist: r.dist,
        dpto: r.dpto,
        finca: r.finca,
        padron: r.padron,
        cta_cte: r.cta_cte,
        area_m2: r.area_m2,
        buff_dist: r.buff_dist,
        orig_fid: r.orig_fid,
      },
    })),
  };
};

module.exports = {
  crearProyecto,
  actualizarProyecto,
  obtenerProyectos,
  contarProyectos,
  obtenerProyectoPorId,
  obtenerGeomProyecto,
  obtenerPoligonosPorProyecto,
  obtenerUsoActualProyecto,
  obtenerUsoAlternativoProyecto,
  obtenerUso1986Proyecto,
  obtenerPlanoProyecto,
  obtenerPrimerProyectoPorProponente,
  revisarDependencias,
  eliminarProyecto,
  obtenerProponenteDeProyecto,
  contarProyectosDeProponente,
  obtenerPoligonosPorProponente,
  obtenerHermanosPorProyecto,
  obtenerComIndigenaProyecto,
  obtenerAreaInfluenciaProyecto,
  // NUEVO
  obtenerMiembrosDeAdminCliente,
  actualizarEstadoProyecto,
};