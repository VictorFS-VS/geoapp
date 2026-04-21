// controllers/proyectos.controller.js
// EMA Group – Proyectos (✅ FULL RBAC por permsScope; sin GROUPS ni hasRole)
//
// FIXES (este update):
// A) Validación de acceso por “cliente/proponente” usando COALESCE(id_proponente,id_cliente)
// B) Se elimina el reintento obtenerGeomProyecto(id, { transform:true }) porque NO existe en el modelo
// C) Se mantiene lógica de cartera con permisos cartera.admin.read / cartera.consultor.read
// D) ✅ FIX IMPORTANTE: scope_read = "project" ahora permite:
//    - ver proyectos por cartera (ids_proponentes)
//    - y/o ver proyectos propios del consultor (id_consultor = miIdConsultor)
//    => si no hay cartera pero sí id_consultor, igual ve sus proyectos.

"use strict";

const pool = require("../db");
const Proyecto = require("../models/proyecto.model");
const { crearNotificacion } = require("./notificaciones.controller");

/* ========= helpers errores pg ========= */
function mapPgError(err) {
  switch (err?.code) {
    case "23505":
      return { status: 409, message: "Ya existe un registro con esos datos." };
    case "23503":
      return { status: 409, message: "Referencia inválida (relación inexistente)." };
    case "23502":
      return { status: 422, message: "Faltan campos obligatorios." };
    case "22P02":
      return { status: 422, message: "Formato inválido en uno de los campos (número/ID)." };
    case "22007":
      return { status: 422, message: "Formato de fecha inválido." };
    default:
      return null;
  }
}

function toIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* =========================
   ✅ FULL RBAC helpers
========================= */

function getScope(user, ...permCodes) {
  const ps = user?.permsScope || {};
  for (const code of permCodes) {
    const v = String(ps?.[code] || "").trim().toLowerCase();
    if (v) return v;
  }
  return "none";
}

function hasPerm(user, code) {
  const perms = user?.perms || [];
  return Array.isArray(perms) && perms.includes(code);
}

/**
 * ✅ Cache simple de groups (para no hardcodear IDs)
 * Usamos name para decidir si un "all" es válido.
 */
const GROUP_CACHE = new Map(); // group_id -> { name, ts }
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;

async function getGroupName(groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return null;

  const now = Date.now();
  const cached = GROUP_CACHE.get(gid);
  if (cached && now - cached.ts < GROUP_CACHE_TTL_MS) return cached.name;

  try {
    const r = await pool.query("SELECT name FROM public.groups WHERE id = $1", [gid]);
    const name = r.rows?.[0]?.name || null;
    GROUP_CACHE.set(gid, { name, ts: now });
    return name;
  } catch {
    return null;
  }
}

async function normalizeReadScope(user, rawScope) {
  const scope = String(rawScope || "none").toLowerCase();
  if (scope !== "all") return scope;

  const groupName = await getGroupName(user?.group_id);
  const isAdminLike = groupName ? /admin/i.test(groupName) : false;

  // Si no parece admin, degradamos a "project" (más seguro)
  return isAdminLike ? "all" : "project";
}

/**
 * ✅ Cartera (clientes permitidos) usando permisos:
 * - cartera.admin.read      -> ema.cliente_admin_miembro
 * - cartera.consultor.read  -> ema.consultor_cliente_miembro
 *
 * Siempre incluye id_cliente si existe (para que CLIENTE vea lo suyo).
 */
async function getClientesPermitidosRBAC(user = {}) {
  const ids = new Set();

  const idCliente = user.id_cliente ? parseInt(user.id_cliente, 10) : null;
  const idConsultor = user.id_consultor ? parseInt(user.id_consultor, 10) : null;
  const userId = user.id ? parseInt(user.id, 10) : null;

  if (idCliente) ids.add(idCliente);

  // Cartera ADMIN (admin_id = users.id)
  if (hasPerm(user, "cartera.admin.read") && userId) {
    const rUser = await pool.query(
      "SELECT miembro_id FROM ema.cliente_admin_miembro WHERE admin_id = $1",
      [userId]
    );
    (rUser.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
  }

  // Compat legacy: admin_id = id_cliente
  if (hasPerm(user, "cartera.admin.read") && idCliente) {
    const rCliente = await pool.query(
      "SELECT miembro_id FROM ema.cliente_admin_miembro WHERE admin_id = $1",
      [idCliente]
    );
    (rCliente.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
  }

  // Cartera CONSULTOR
  if (hasPerm(user, "cartera.consultor.read") && idConsultor) {
    const rCons = await pool.query(
      "SELECT miembro_id FROM ema.consultor_cliente_miembro WHERE consultor_id = $1",
      [idConsultor]
    );
    (rCons.rows || []).forEach((r) => r.miembro_id && ids.add(Number(r.miembro_id)));
  }

  return ids.size ? Array.from(ids) : [];
}

/* ========= notificar ========= */
const notificar = async ({ idProyecto, creadoPor, id_proponente, id_consultor, titulo, mensaje }) => {
  try {
    const idP = toIntOrNull(idProyecto);
    if (!idP) return;

    await crearNotificacion({
      proponenteId: toIntOrNull(id_proponente),
      consultorId: toIntOrNull(id_consultor),
      id_proyecto: idP,
      titulo: String(titulo || "").trim() || "Notificación",
      mensaje: String(mensaje || "").trim() || "",
      creado_por: String(creadoPor || "Sistema"),
    });
  } catch (err) {
    console.error("Error al crear notificación:", err);
  }
};

/* ========= CRUD ========= */
const crearProyecto = async (req, res) => {
  try {
    const nuevo = await Proyecto.crearProyecto(req.body);

    const idProyecto = Number(nuevo?.gid ?? nuevo?.id_proyecto ?? nuevo?.id ?? 0);
    const { id_proponente, id_consultor, nombre } = req.body;
    const creadoPor = req.user?.username || req.user?.email || "Sistema";

    await notificar({
      idProyecto,
      creadoPor,
      id_proponente,
      id_consultor,
      titulo: "Proyecto creado",
      mensaje: `Se creó el proyecto "${nombre || ""}" correctamente.`,
    });

    return res.status(201).json({
      success: true,
      proyecto: {
        ...req.body,
        gid: idProyecto || nuevo?.gid,
        id_proyecto: idProyecto || nuevo?.id_proyecto,
      },
    });
  } catch (err) {
    console.error("Error al crear proyecto:", err);

    const mapped = mapPgError(err);
    if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });

    return res.status(500).json({ success: false, message: "Error al crear el proyecto" });
  }
};

const actualizarProyecto = async (req, res) => {
  const id = Number(req.params.id);

  try {
    const updated = await Proyecto.actualizarProyecto(id, req.body);
    if (!updated) return res.status(404).json({ success: false, message: "Proyecto no encontrado" });

    let datos = null;
    try {
      datos = await Proyecto.obtenerProyectoPorId(id);
    } catch (e) {
      console.warn("No se pudo obtenerProyectoPorId para notificación:", e?.message || e);
    }

    if (datos) {
      const { id_proponente, id_consultor, nombre } = datos;
      const creadoPor = req.user?.username || req.user?.email || "Sistema";

      await notificar({
        idProyecto: id,
        creadoPor,
        id_proponente,
        id_consultor,
        titulo: "Proyecto actualizado",
        mensaje: `Se modificó el proyecto "${nombre || ""}".`,
      });

      return res.json({ success: true, proyecto: datos });
    }

    return res.json({ success: true, message: "Proyecto actualizado correctamente." });
  } catch (err) {
    console.error("Error al actualizar proyecto:", err);

    const mapped = mapPgError(err);
    if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });

    return res.status(500).json({ success: false, message: "Error al actualizar el proyecto" });
  }
};

const eliminarProyectoController = async (req, res) => {
  const { id } = req.params;
  try {
    const datosPrevios = await Proyecto.obtenerProyectoPorId(id);
    if (!datosPrevios) return res.status(404).json({ success: false, message: "Proyecto no encontrado" });

    const force = String(req.query.force || "") === "1";
    const resultado = await Proyecto.eliminarProyecto(Number(id), { force });

    if (resultado.bloqueado) {
      return res.status(409).json({
        success: false,
        message: `No se puede eliminar el proyecto. Elimine primero: ${resultado.detalles.join(", ")}.`,
        detalles: resultado.detalles,
        dependencias: resultado.dependencias,
      });
    }
    if (resultado.notFound) return res.status(404).json({ success: false, message: "Proyecto no encontrado" });

    const { id_proponente, id_consultor, nombre } = datosPrevios;
    const creadoPor = req.user?.username || "Sistema";

    await notificar({
      idProyecto: Number(id),
      creadoPor,
      id_proponente,
      id_consultor,
      titulo: "Proyecto eliminado",
      mensaje: `Se eliminó el proyecto "${nombre}".`,
    });

    return res.json({ success: true, message: "Proyecto eliminado correctamente." });
  } catch (err) {
    console.error("Error al eliminar el proyecto:", err);
    return res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
};

/* ========= LISTAR / GETS ========= */
const listarProyectos = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;

  let {
    codigo = "",
    nombre = "",
    des_estado = "",
    proponente = "",
    fecha_inicio_desde = "",
    fecha_inicio_hasta = "",
    mode = "",
    alerta = "",
  } = req.query;

  codigo = String(codigo || "").trim();
  nombre = String(nombre || "").trim();
  des_estado = String(des_estado || "").trim();
  proponente = String(proponente || "").trim();
  fecha_inicio_desde = String(fecha_inicio_desde || "").trim();
  fecha_inicio_hasta = String(fecha_inicio_hasta || "").trim();

  mode = String(mode || "").trim().toLowerCase();
  alerta = String(alerta || "").trim().toLowerCase();

  const safeMode = mode === "activos" || mode === "licencia" ? mode : "";
  const safeAlerta = alerta === "dia" || alerta === "resolucion" ? alerta : "";

  if (fecha_inicio_desde && fecha_inicio_hasta) {
    const d1 = new Date(fecha_inicio_desde);
    const d2 = new Date(fecha_inicio_hasta);
    if (d1 > d2) {
      const tmp = fecha_inicio_desde;
      fecha_inicio_desde = fecha_inicio_hasta;
      fecha_inicio_hasta = tmp;
    }
  }

  try {

    let scope = getScope(req.user, "proyectos.read");
    scope = await normalizeReadScope(req.user, scope);

    if (scope === "none") {
      return res.status(403).json({ message: "Sin permiso proyectos.read" });
    }

    const miIdConsultor = req.user?.id_consultor ? parseInt(req.user.id_consultor, 10) : null;
    const miIdCliente = req.user?.id_cliente ? parseInt(req.user.id_cliente, 10) : null;

    const filtros = {
      codigo,
      nombre,
      des_estado,
      proponente,
      fecha_inicio_desde,
      fecha_inicio_hasta,
      mode: safeMode,
      alerta: safeAlerta,

      // usados por el modelo:
      ids_proponentes: undefined,
      id_consultor: undefined,
      or_consultor: false,
    };

    if (scope === "all") {
      // sin filtros por seguridad, trae todo
      filtros.ids_proponentes = undefined;
      filtros.id_consultor = undefined;
      filtros.or_consultor = false;
    } else if (scope === "own") {
      // solo "mis proyectos" (por consultor o por cliente)
      if (miIdConsultor) {
        filtros.id_consultor = miIdConsultor;
        filtros.or_consultor = false;
        filtros.ids_proponentes = undefined;
      } else if (miIdCliente) {
        filtros.ids_proponentes = [miIdCliente];
        filtros.id_consultor = undefined;
        filtros.or_consultor = false;
      } else {
        return res.json({ data: [], page: 1, totalPages: 1, totalItems: 0 });
      }
    } else if (scope === "project") {
      // ✅ FIX: project = cartera OR consultor propio
      const ids_proponentes = await getClientesPermitidosRBAC(req.user || {});
      const hasCartera = Array.isArray(ids_proponentes) && ids_proponentes.length > 0;

      // si es consultor, también puede ver sus proyectos aunque no tenga cartera cargada
      if (miIdConsultor) {
        filtros.id_consultor = miIdConsultor;
      }

      if (hasCartera) {
        filtros.ids_proponentes = ids_proponentes;
      }

      // si tiene ambos, el modelo debe aplicar OR
      // (id_proponente IN ids_proponentes) OR (id_consultor = miIdConsultor)
      filtros.or_consultor = Boolean(miIdConsultor) && hasCartera;

      // si NO tiene cartera y NO es consultor, no ve nada
      if (!hasCartera && !miIdConsultor) {
        return res.json({ data: [], page: 1, totalPages: 1, totalItems: 0 });
      }
    } else {
      return res.status(403).json({ message: `Scope inválido para proyectos.read: ${scope}` });
    }

    const totalResult = await Proyecto.contarProyectos(filtros);
    const total = parseInt(totalResult?.count, 10) || 0;

    const data = await Proyecto.obtenerProyectos({
      ...filtros,
      limit,
      offset,
    });

    return res.json({
      data,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      totalItems: total,
    });
  } catch (err) {
    console.error("Error al obtener proyectos:", err);
    return res.status(500).json({ message: "Error al obtener los proyectos" });
  }
};

/**
 * GET /api/proyectos/:id
 * ✅ FULL RBAC por permsScope["proyectos.read"]
 */
const obtenerProyectoPorId = async (req, res) => {
  const { id } = req.params;

  try {
    const proyecto = await Proyecto.obtenerProyectoPorId(id);
    if (!proyecto) return res.status(404).json({ error: "Proyecto no encontrado" });

    let scope = getScope(req.user, "proyectos.read", "proyectos.get");
    scope = await normalizeReadScope(req.user, scope);

    if (scope === "none") return res.status(403).json({ error: "Sin permiso proyectos.read" });
    if (scope === "all") return res.json(proyecto);

    const miIdConsultor = req.user?.id_consultor ? parseInt(req.user.id_consultor, 10) : null;
    const miIdCliente = req.user?.id_cliente ? parseInt(req.user.id_cliente, 10) : null;

    // ✅ FIX: cliente/proponente real del proyecto
    const idClienteProyecto = Number(proyecto.id_proponente || proyecto.id_cliente || 0) || null;
    const idConsultorProyecto = Number(proyecto.id_consultor || 0) || null;

    if (scope === "own") {
      if (miIdConsultor) {
        if (idConsultorProyecto && idConsultorProyecto === miIdConsultor) return res.json(proyecto);
        return res.status(404).json({ error: "Proyecto no encontrado" });
      }
      if (miIdCliente) {
        if (idClienteProyecto && idClienteProyecto === miIdCliente) return res.json(proyecto);
        return res.status(404).json({ error: "Proyecto no encontrado" });
      }
      return res.status(404).json({ error: "Proyecto no encontrado" });
    }

    if (scope === "project") {
      // ✅ FIX: si es consultor y es SU proyecto, permitir aunque no tenga cartera
      if (miIdConsultor && idConsultorProyecto && idConsultorProyecto === miIdConsultor) {
        return res.json(proyecto);
      }

      const clientesPermitidos = await getClientesPermitidosRBAC(req.user || {});
      if (!Array.isArray(clientesPermitidos) || clientesPermitidos.length === 0) {
        // ojo: acá NO bloqueamos consultor propio (ya lo permitimos arriba)
        return res.status(403).json({ error: "No tiene clientes asociados en su cartera" });
      }
      if (!idClienteProyecto || !clientesPermitidos.includes(Number(idClienteProyecto))) {
        return res.status(404).json({ error: "Proyecto no encontrado o fuera de su cartera" });
      }
      return res.json(proyecto);
    }

    return res.status(403).json({ error: `Scope inválido para proyectos.read: ${scope}` });
  } catch (err) {
    console.error("Error al obtener el proyecto:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

/* ===== Helpers GeoJSON ===== */
const rowsToFC = (rows = []) => ({
  type: "FeatureCollection",
  features: rows.map((row) => {
    const { geometry, ...props } = row;
    return { type: "Feature", geometry, properties: props };
  }),
});

/* ===== GEO / CAPAS ===== */

const obtenerGeomProyecto = async (req, res) => {
  const { id } = req.params;

  const toObj = (g) => {
    if (!g) return null;
    if (typeof g === "string") {
      try {
        return JSON.parse(g);
      } catch {
        return null;
      }
    }
    return g;
  };

  const firstCoord = (geom) => {
    try {
      const t = geom?.type;
      const c = geom?.coordinates;
      if (!t || !c) return null;

      if (t === "Polygon") return c?.[0]?.[0] ?? null;
      if (t === "MultiPolygon") return c?.[0]?.[0]?.[0] ?? null;
      if (t === "LineString") return c?.[0] ?? null;
      if (t === "MultiLineString") return c?.[0]?.[0] ?? null;
      if (t === "Point") return c ?? null;
      if (t === "MultiPoint") return c?.[0] ?? null;

      return null;
    } catch {
      return null;
    }
  };

  const looksLngLat4326 = (pt) =>
    Array.isArray(pt) &&
    typeof pt[0] === "number" &&
    typeof pt[1] === "number" &&
    Math.abs(pt[0]) <= 180 &&
    Math.abs(pt[1]) <= 90;

  const looksLatLngSwapped = (pt) =>
    Array.isArray(pt) &&
    typeof pt[0] === "number" &&
    typeof pt[1] === "number" &&
    Math.abs(pt[0]) <= 90 &&
    Math.abs(pt[1]) <= 180;

  const isProbablyUTM = (pt) =>
    Array.isArray(pt) &&
    typeof pt[0] === "number" &&
    typeof pt[1] === "number" &&
    (Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90);

  try {
    // ✅ el modelo ya devuelve ST_Transform(...,4326)
    const resultado = await Proyecto.obtenerGeomProyecto(id);

    const features = (resultado || [])
      .map((row) => {
        const geom = toObj(row.geometry);
        if (!geom) return null;
        return {
          type: "Feature",
          geometry: geom,
          properties: { gid: row.gid, id_proyecto: row.id_proyecto },
        };
      })
      .filter(Boolean);

    const f0 = features?.[0];
    const pt0 = firstCoord(f0?.geometry);

    const ok4326 = looksLngLat4326(pt0);
    const swapped = looksLatLngSwapped(pt0);
    const utm = isProbablyUTM(pt0);

    console.log("DEBUG /geom", {
      id,
      features: features.length,
      geomType: f0?.geometry?.type,
      firstCoord: pt0,
      ok4326,
      swapped,
      utm,
    });

    if (features.length > 0 && swapped) {
      console.warn("⚠️ Coordenadas parecen venir como [lat,lng]. Google Maps espera [lng,lat].");
    }

    return res.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("Error al obtener geometría del proyecto:", err);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

const obtenerPoligonosPorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const geojson = await Proyecto.obtenerPoligonosPorProyecto(id);
    if (!geojson || geojson.features.length === 0) {
      return res.status(404).json({ message: "No hay polígonos para este proyecto" });
    }
    return res.json(geojson);
  } catch (err) {
    console.error("Error al obtener polígonos:", err);
    return res.status(500).json({ message: "Error al obtener los polígonos" });
  }
};

const obtenerUsoActualPorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const fc = await Proyecto.obtenerUsoActualProyecto(id);
    return res.json(fc && fc.type === "FeatureCollection" ? fc : rowsToFC(fc || []));
  } catch (err) {
    console.error("Error al obtener uso actual:", err);
    return res.status(500).json({ message: "Error interno al obtener uso actual" });
  }
};

const obtenerUsoAlternativoPorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const fc = await Proyecto.obtenerUsoAlternativoProyecto(id);
    return res.json(fc && fc.type === "FeatureCollection" ? fc : rowsToFC(fc || []));
  } catch (err) {
    console.error("Error al obtener uso alternativo:", err);
    return res.status(500).json({ message: "Error interno al obtener uso alternativo" });
  }
};

const obtenerUso1986PorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const fc = await Proyecto.obtenerUso1986Proyecto(id);
    return res.json(fc && fc.type === "FeatureCollection" ? fc : rowsToFC(fc || []));
  } catch (err) {
    console.error("Error al obtener uso 1986:", err);
    return res.status(500).json({ message: "Error interno al obtener uso 1986" });
  }
};

const obtenerPlanoPorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const fc = await Proyecto.obtenerPlanoProyecto(id);
    return res.json(fc && fc.type === "FeatureCollection" ? fc : rowsToFC(fc || []));
  } catch (err) {
    console.error("Error al obtener plano del proyecto:", err);
    return res.status(500).json({ message: "Error interno al obtener plano del proyecto" });
  }
};

const obtenerAreaInfluenciaPorProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const fc = await Proyecto.obtenerAreaInfluenciaProyecto(id);
    return res.json(fc && fc.type === "FeatureCollection" ? fc : rowsToFC(fc || []));
  } catch (err) {
    console.error("Error al obtener área de influencia:", err);
    return res.status(500).json({ message: "Error interno al obtener área de influencia" });
  }
};

const obtenerPrimeroPorProponente = async (req, res) => {
  try {
    const idCliente = parseInt(req.params.idCliente, 10);
    if (!idCliente) return res.status(400).json({ error: "idCliente requerido" });

    const gid = await Proyecto.obtenerPrimerProyectoPorProponente(idCliente);
    if (!gid) return res.status(404).json({ error: "Sin proyectos para este proponente" });

    return res.json({ gid });
  } catch (err) {
    console.error("obtenerPrimeroPorProponente error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};

const obtenerCapasProyecto = async (req, res) => {
  const { id } = req.params;
  try {
    const capas = [];

    const usoAlt = await Proyecto.obtenerUsoAlternativoProyecto(id);
    const usoAltFC = usoAlt?.type === "FeatureCollection" ? usoAlt : rowsToFC(usoAlt || []);
    if (usoAltFC.features?.length) capas.push({ nombre: "Uso Alternativo", geojson: usoAltFC });

    const usoActual = await Proyecto.obtenerUsoActualProyecto(id);
    const usoActualFC = usoActual?.type === "FeatureCollection" ? usoActual : rowsToFC(usoActual || []);
    if (usoActualFC.features?.length) capas.push({ nombre: "Uso Actual", geojson: usoActualFC });

    const comInd = await Proyecto.obtenerComIndigenaProyecto(id);
    const comIndFC = comInd?.type === "FeatureCollection" ? comInd : rowsToFC(comInd || []);
    if (comIndFC.features?.length) capas.push({ nombre: "Comunidad Indígena", geojson: comIndFC });

    const areaInf = await Proyecto.obtenerAreaInfluenciaProyecto(id);
    const areaInfFC = areaInf?.type === "FeatureCollection" ? areaInf : rowsToFC(areaInf || []);
    if (areaInfFC.features?.length) capas.push({ nombre: "Área de Influencia", geojson: areaInfFC });

    const plano = await Proyecto.obtenerPlanoProyecto(id);
    const planoFC = plano?.type === "FeatureCollection" ? plano : rowsToFC(plano || []);
    if (planoFC.features?.length) capas.push({ nombre: "Plano del Proyecto", geojson: planoFC });

    const poligono = await Proyecto.obtenerPoligonosPorProyecto(id);
    if (poligono?.features?.length) capas.push({ nombre: "Poligono del Proyecto", geojson: poligono });

    return res.json(capas);
  } catch (err) {
    console.error("Error obtenerCapasProyecto:", err);
    return res.status(500).json({ message: "Error interno al obtener capas" });
  }
};

const obtenerHermanos = async (req, res) => {
  try {
    const gid = parseInt(req.params.id, 10);
    if (!Number.isFinite(gid) || gid <= 0) return res.status(400).json({ error: "id inválido" });

    const rows = await Proyecto.obtenerHermanosPorProyecto(gid);
    return res.json(rows || []);
  } catch (err) {
    console.error("obtenerHermanos:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};

const obtenerComIndigenaPorProyecto = async (req, res) => {
  try {
    const gid = parseInt(req.params.id, 10);
    if (!Number.isFinite(gid) || gid <= 0) return res.status(400).json({ message: "id inválido" });

    const resultado = await Proyecto.obtenerComIndigenaProyecto(gid);
    if (resultado && resultado.type === "FeatureCollection") return res.json(resultado);
    return res.json(rowsToFC(resultado || []));
  } catch (err) {
    console.error("Error al obtener comunidad indígena:", err);
    return res.status(500).json({ message: "Error interno al obtener comunidad indígena" });
  }
};

const actualizarEstadoProyectoController = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { etapa, si, fechas = {}, obs = null } = req.body || {};
    if (!id || !etapa || typeof si !== "boolean") {
      return res.status(400).json({ error: "Parámetros inválidos (id, etapa, si)" });
    }

    const scope = getScope(req.user, "proyectos.update", "proyectos.write");
    if (scope === "none") return res.status(403).json({ error: "Sin permiso para actualizar estado" });

    const usuario =
      req.user?.username || req.user?.email || (req.user?.id ? `user:${req.user.id}` : "api");

    const row = await Proyecto.actualizarEstadoProyecto(id, {
      etapa,
      si,
      fechas,
      obs,
      usuario,
    });
    if (!row) return res.status(404).json({ error: "Proyecto no encontrado" });

    return res.json(row);
  } catch (err) {
    console.error("Error al actualizar estado del proyecto:", err);
    return res.status(500).json({ error: "Error interno al actualizar estado del proyecto" });
  }
};

//APP EMA-Censo
const listarProyectosSelectMios = async (req, res) => {
  try {
    let scope = getScope(req.user, "proyectos.read");
    scope = await normalizeReadScope(req.user, scope);

    if (scope === "none") {
      return res.status(403).json({ message: "Sin permiso proyectos.read" });
    }

    const miIdConsultor = req.user?.id_consultor ? parseInt(req.user.id_consultor, 10) : null;
    const miIdCliente = req.user?.id_cliente ? parseInt(req.user.id_cliente, 10) : null;

    const where = [];
    const params = [];
    let idx = 1;

    if (scope === "all") {
      // sin filtro
    } else if (scope === "own") {
      if (miIdConsultor) {
        where.push(`p.id_consultor = $${idx++}`);
        params.push(miIdConsultor);
      } else if (miIdCliente) {
        where.push(`COALESCE(p.id_proponente, p.id_cliente) = $${idx++}`);
        params.push(miIdCliente);
      } else {
        return res.json([]);
      }
    } else if (scope === "project") {
      const idsProponentes = await getClientesPermitidosRBAC(req.user || {});
      const partes = [];

      if (Array.isArray(idsProponentes) && idsProponentes.length > 0) {
        partes.push(`COALESCE(p.id_proponente, p.id_cliente) = ANY($${idx++}::int[])`);
        params.push(idsProponentes);
      }

      if (miIdConsultor) {
        partes.push(`p.id_consultor = $${idx++}`);
        params.push(miIdConsultor);
      }

      if (!partes.length) {
        return res.json([]);
      }

      where.push(`(${partes.join(" OR ")})`);
    } else {
      return res.status(403).json({
        message: `Scope inválido para proyectos.read: ${scope}`,
      });
    }

    const sql = `
      SELECT
        p.gid AS id,
        COALESCE(NULLIF(TRIM(p.nombre), ''), CONCAT('Proyecto #', p.gid)) AS nombre
      FROM ema.proyectos p
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY nombre ASC, id ASC
    `;

    const { rows } = await pool.query(sql, params);

    return res.json(rows);
  } catch (err) {
    console.error("Error al listar proyectos select/mios:", err);
    return res.status(500).json({
      message: "Error al obtener proyectos del usuario",
    });
  }
};

module.exports = {
  crearProyecto,
  actualizarProyecto,
  eliminarProyectoController,
  eliminarProyecto: eliminarProyectoController,

  listarProyectos,
  obtenerProyectoPorId,

  obtenerGeomProyecto,
  obtenerPoligonosPorProyecto,
  obtenerUsoActualPorProyecto,
  obtenerUsoAlternativoPorProyecto,
  obtenerUso1986PorProyecto,
  obtenerPlanoPorProyecto,
  obtenerAreaInfluenciaPorProyecto,

  obtenerPrimeroPorProponente,
  obtenerCapasProyecto,
  //APP EMA-Censo
  listarProyectosSelectMios,

  obtenerPoligonosSmart: async (req, res) => {
    try {
      const gid = parseInt(req.params.id, 10);
      if (!gid) return res.status(400).json({ message: "Parámetro id inválido" });

      const emptyFC = { type: "FeatureCollection", features: [] };
      const idProponente = await Proyecto.obtenerProponenteDeProyecto(gid);

      if (!idProponente) {
        const fc = await Proyecto.obtenerPoligonosPorProyecto(gid);
        return res.json(fc?.features?.length ? fc : emptyFC);
      }

      const cant = await Proyecto.contarProyectosDeProponente(idProponente);
      if (cant > 1) {
        const fcAll = await Proyecto.obtenerPoligonosPorProponente(idProponente);
        return res.json(fcAll?.features?.length ? fcAll : emptyFC);
      } else {
        const fcOne = await Proyecto.obtenerPoligonosPorProyecto(gid);
        return res.json(fcOne?.features?.length ? fcOne : emptyFC);
      }
    } catch (err) {
      console.error("Error en obtenerPoligonosSmart:", err);
      return res.status(500).json({ message: "Error interno al obtener los polígonos" });
    }
  },

  obtenerHermanos,
  obtenerComIndigenaPorProyecto,
  actualizarEstadoProyectoController,
};