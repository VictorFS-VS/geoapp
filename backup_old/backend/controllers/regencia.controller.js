// controllers/regencia.controller.js
const Reg = require("../models/regencia.model");

/* =========================
   HELPERS: contrato vigente
   ========================= */

function todayYYYYMMDD() {
  // fecha local del server en YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isContratoVigente(contrato) {
  if (!contrato) return false;
  const estado = String(contrato.estado || "").toUpperCase();
  if (estado !== "ACTIVO") return false;

  // contrato.fecha_fin es DATE en PG => suele venir "YYYY-MM-DD"
  const fin = String(contrato.fecha_fin || "").slice(0, 10);
  if (!fin) return false;

  // comparación lexicográfica sirve en formato YYYY-MM-DD
  return fin >= todayYYYYMMDD();
}

/**
 * Valida que el proyecto tenga contrato ACTIVO y vigente.
 * - Retorna { ok:true, contrato } o { ok:false, message }
 * - Excepción: si tipoActividad === 'CONTRATO' no bloquea
 */
async function validarContratoParaRegencia({ id_proyecto, tipoActividad }) {
  if (String(tipoActividad || "").toUpperCase() === "CONTRATO") {
    return { ok: true, contrato: null };
  }

  const contrato = await Reg.getContratoActivoPorProyecto(id_proyecto);
  if (!contrato) {
    return {
      ok: false,
      message:
        "Regencia bloqueada: el proyecto no tiene contrato ACTIVO. Cree o renueve el contrato para continuar.",
    };
  }

  if (!isContratoVigente(contrato)) {
    return {
      ok: false,
      message:
        `Regencia bloqueada: el contrato está vencido (fecha_fin: ${contrato.fecha_fin}). Renueve el contrato para continuar.`,
    };
  }

  return { ok: true, contrato };
}

/* =========================
   CONTRATOS
   ========================= */
exports.getContratoActivo = async (req, res) => {
  try {
    const id_proyecto = parseInt(req.params.id_proyecto, 10);
    const contrato = await Reg.getContratoActivoPorProyecto(id_proyecto);
    return res.json(contrato);
  } catch (e) {
    console.error("getContratoActivo:", e);
    return res.status(500).json({ message: "Error obteniendo contrato activo" });
  }
};

exports.listarContratos = async (req, res) => {
  try {
    const id_proyecto = parseInt(req.params.id_proyecto, 10);
    const rows = await Reg.listarContratosPorProyecto(id_proyecto);
    return res.json(rows);
  } catch (e) {
    console.error("listarContratos:", e);
    return res.status(500).json({ message: "Error listando contratos" });
  }
};

exports.crearContrato = async (req, res) => {
  try {
    const { id_proyecto, fecha_inicio, fecha_fin, titulo, observacion } = req.body || {};
    if (!id_proyecto || !fecha_fin) {
      return res.status(400).json({ message: "id_proyecto y fecha_fin son obligatorios" });
    }

    const creado_por =
      req.user?.username || req.user?.email || req.user?.id ? `user:${req.user?.id || ""}` : "Sistema";

    const row = await Reg.crearContrato({
      id_proyecto: parseInt(id_proyecto, 10),
      fecha_inicio,
      fecha_fin,
      titulo: titulo || null,
      observacion: observacion || null,
      creado_por,
    });

    return res.json(row);
  } catch (e) {
    console.error("crearContrato:", e);
    return res.status(500).json({ message: "Error creando contrato" });
  }
};

exports.actualizarContrato = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await Reg.actualizarContrato(id, req.body || {});
    if (!row) return res.status(404).json({ message: "Contrato no encontrado" });
    return res.json(row);
  } catch (e) {
    console.error("actualizarContrato:", e);
    return res.status(500).json({ message: "Error actualizando contrato" });
  }
};

/* =========================
   ACTIVIDADES
   ========================= */
exports.listarActividades = async (req, res) => {
  try {
    const { id_proyecto, id_contrato, from, to, estado, tipo, q } = req.query || {};
    const rows = await Reg.listarActividades({
      id_proyecto: id_proyecto ? parseInt(id_proyecto, 10) : null,
      id_contrato: id_contrato ? parseInt(id_contrato, 10) : null, // ✅ NUEVO
      from: from || null,
      to: to || null,
      estado: estado || null,
      tipo: tipo || null,
      q: q || null,
    });
    return res.json(rows);
  } catch (e) {
    console.error("listarActividades:", e);
    return res.status(500).json({ message: "Error listando actividades" });
  }
};

exports.getActividad = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await Reg.getActividad(id);
    if (!row) return res.status(404).json({ message: "Actividad no encontrada" });
    return res.json(row);
  } catch (e) {
    console.error("getActividad:", e);
    return res.status(500).json({ message: "Error obteniendo actividad" });
  }
};

exports.crearActividad = async (req, res) => {
  try {
    console.log("REQ.BODY crearActividad =>", req.body);

    const body = req.body || {};

    // ✅ requeridos
    const required = ["id_proyecto", "titulo", "tipo", "inicio_at"];
    for (const k of required) {
      if (!body[k]) {
        return res.status(400).json({ message: `Falta campo obligatorio: ${k}` });
      }
    }

    const id_proyecto = parseInt(body.id_proyecto, 10);
    if (!Number.isFinite(id_proyecto)) {
      return res.status(400).json({ message: "id_proyecto inválido" });
    }

    const tipo = body.tipo;

    // ✅ id_contrato (opcional pero recomendado para tu UI)
    const id_contrato =
      body.id_contrato !== undefined && body.id_contrato !== null && body.id_contrato !== ""
        ? parseInt(body.id_contrato, 10)
        : null;

    if (id_contrato !== null && !Number.isFinite(id_contrato)) {
      return res.status(400).json({ message: "id_contrato inválido" });
    }

    // ✅ BLOQUEO BACKEND por contrato vigente
    const check = await validarContratoParaRegencia({ id_proyecto, tipoActividad: tipo });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const creado_por =
      req.user?.username || req.user?.email || req.user?.id
        ? `user:${req.user?.id || ""}`
        : "Sistema";

    // ✅ Crear actividad (el model debe insertar id_contrato)
    const row = await Reg.crearActividad({
      ...body,
      id_proyecto,
      id_contrato, // ✅ importante
      creado_por,
      origen: body.origen || "MANUAL",
    });

    // ✅ Responsables: si no viene lista, setear responsable = usuario logueado
    const lista =
      Array.isArray(body.responsables) ? body.responsables : body.responsables?.responsables;

    if (!Array.isArray(lista) || lista.length === 0) {
      if (req.user?.id) {
        await Reg.setResponsables(row.id, [
          { id_usuario: req.user.id, rol: "RESPONSABLE" },
        ]);
      }
    } else {
      await Reg.setResponsables(row.id, lista);
    }

    // opcional: devolver también responsables
    // const responsables = await Reg.listarResponsables(row.id);
    // return res.json({ ...row, responsables });

    return res.json(row);
  } catch (e) {
    console.error("crearActividad:", e);
    return res.status(500).json({ message: "Error creando actividad" });
  }
};

exports.actualizarActividad = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    // ✅ obtener actividad actual para saber id_proyecto y tipo
    const act = await Reg.getActividad(id);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

    const nuevoTipo = (req.body && req.body.tipo) ? req.body.tipo : act.tipo;
    const id_proyecto = act.id_proyecto;

    // ✅ BLOQUEO BACKEND por contrato
    const check = await validarContratoParaRegencia({
      id_proyecto,
      tipoActividad: nuevoTipo,
    });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const row = await Reg.actualizarActividad(id, req.body || {});
    return res.json(row);
  } catch (e) {
    console.error("actualizarActividad:", e);
    return res.status(500).json({ message: "Error actualizando actividad" });
  }
};

exports.setEstadoActividad = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { estado } = req.body || {};
    if (!estado) return res.status(400).json({ message: "estado es obligatorio" });

    // ✅ obtener actividad actual para saber id_proyecto y tipo
    const act = await Reg.getActividad(id);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

    // ✅ BLOQUEO BACKEND por contrato
    const check = await validarContratoParaRegencia({
      id_proyecto: act.id_proyecto,
      tipoActividad: act.tipo,
    });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const row = await Reg.setEstadoActividad(id, estado);
    return res.json(row);
  } catch (e) {
    console.error("setEstadoActividad:", e);
    return res.status(500).json({ message: "Error cambiando estado" });
  }
};

/* =========================
   RESPONSABLES
   ========================= */
exports.listarResponsables = async (req, res) => {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);
    const rows = await Reg.listarResponsables(id_actividad);
    return res.json(rows);
  } catch (e) {
    console.error("listarResponsables:", e);
    return res.status(500).json({ message: "Error listando responsables" });
  }
};

exports.setResponsables = async (req, res) => {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);

    // ✅ opcional: también bloquear cambiar responsables si contrato vencido
    const act = await Reg.getActividad(id_actividad);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

    const check = await validarContratoParaRegencia({
      id_proyecto: act.id_proyecto,
      tipoActividad: act.tipo,
    });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const lista = Array.isArray(req.body) ? req.body : req.body?.responsables;
    if (!Array.isArray(lista)) {
      return res.status(400).json({ message: "Se esperaba un array de responsables" });
    }

    const rows = await Reg.setResponsables(id_actividad, lista);
    return res.json(rows);
  } catch (e) {
    console.error("setResponsables:", e);
    return res.status(500).json({ message: "Error guardando responsables" });
  }
};

/* =========================
   ALERTAS
   ========================= */
exports.generarAlertasEstandar = async (req, res) => {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);

    // ✅ opcional: bloquear generar alertas si contrato vencido
    const act = await Reg.getActividad(id_actividad);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

    const check = await validarContratoParaRegencia({
      id_proyecto: act.id_proyecto,
      tipoActividad: act.tipo,
    });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const result = await Reg.generarAlertasEstandar(id_actividad);
    return res.json(result);
  } catch (e) {
    console.error("generarAlertasEstandar:", e);
    return res.status(500).json({ message: "Error generando alertas estándar" });
  }
};

/* =========================
   NUEVO: GENERADOR DE VISITAS MENSUALES
   ========================= */
exports.generarVisitasMensuales = async (req, res) => {
  try {
    const id_contrato = parseInt(req.params.id, 10);
    if (!id_contrato) return res.status(400).json({ message: "id contrato inválido" });

    const body = req.body || {};
    const seed_date = body.seed_date;
    if (!seed_date) {
      return res
        .status(400)
        .json({ message: "seed_date es obligatorio (YYYY-MM-DD)" });
    }

    const created_by =
      req.user?.username || req.user?.email || req.user?.id
        ? `user:${req.user?.id || ""}`
        : "Sistema";

    const result = await Reg.generarVisitasMensualesDesdeContrato({
      id_contrato,
      seed_date,
      hour: Number.isFinite(+body.hour) ? +body.hour : 9,
      minute: Number.isFinite(+body.minute) ? +body.minute : 0,
      months_ahead: Number.isFinite(+body.months_ahead) ? +body.months_ahead : 12,
      business_days_only: body.business_days_only !== false,
      shift_if_weekend: body.shift_if_weekend || "NEXT_BUSINESS_DAY",
      creado_por: created_by,
    });

    return res.json(result);
  } catch (e) {
    console.error("generarVisitasMensuales:", e);
    return res.status(500).json({ message: "Error generando visitas mensuales" });
  }
};
