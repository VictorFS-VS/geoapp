const Reg = require("../models/regencia.model");

/* =========================
   HELPERS: contrato vigente
   ========================= */

function todayYYYYMMDD() {
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

  const fin = String(contrato.fecha_fin || "").slice(0, 10);
  if (!fin) return false;

  return fin >= todayYYYYMMDD();
}

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
async function getContratoActivo(req, res) {
  try {
    const id_proyecto = parseInt(req.params.id_proyecto, 10);
    const contrato = await Reg.getContratoActivoPorProyecto(id_proyecto);
    return res.json(contrato);
  } catch (e) {
    console.error("getContratoActivo:", e);
    return res.status(500).json({ message: "Error obteniendo contrato activo" });
  }
}

async function listarContratos(req, res) {
  try {
    const id_proyecto = parseInt(req.params.id_proyecto, 10);
    const rows = await Reg.listarContratosPorProyecto(id_proyecto);
    return res.json(rows);
  } catch (e) {
    console.error("listarContratos:", e);
    return res.status(500).json({ message: "Error listando contratos" });
  }
}

async function crearContrato(req, res) {
  try {
    const { id_proyecto, fecha_inicio, fecha_fin, titulo, observacion } = req.body || {};
    if (!id_proyecto || !fecha_fin) {
      return res.status(400).json({ message: "id_proyecto y fecha_fin son obligatorios" });
    }

    const creado_por =
      req.user?.id ? `user:${req.user.id}` : "Sistema";

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
}

async function actualizarContrato(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await Reg.actualizarContrato(id, req.body || {});
    if (!row) return res.status(404).json({ message: "Contrato no encontrado" });
    return res.json(row);
  } catch (e) {
    console.error("actualizarContrato:", e);
    return res.status(500).json({ message: "Error actualizando contrato" });
  }
}

/* =========================
   ACTIVIDADES
   ========================= */
async function listarActividades(req, res) {
  try {
    const { id_proyecto, id_contrato, from, to, estado, tipo, q } = req.query || {};
    const rows = await Reg.listarActividades({
      id_proyecto: id_proyecto ? parseInt(id_proyecto, 10) : null,
      id_contrato: id_contrato ? parseInt(id_contrato, 10) : null,
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
}

async function getActividad(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await Reg.getActividad(id);
    if (!row) return res.status(404).json({ message: "Actividad no encontrada" });
    return res.json(row);
  } catch (e) {
    console.error("getActividad:", e);
    return res.status(500).json({ message: "Error obteniendo actividad" });
  }
}

async function crearActividad(req, res) {
  try {
    const body = req.body || {};

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

    const tipo = String(body.tipo || "").toUpperCase();

    const id_contrato =
      body.id_contrato !== undefined && body.id_contrato !== null && body.id_contrato !== ""
        ? parseInt(body.id_contrato, 10)
        : null;

    if (id_contrato !== null && !Number.isFinite(id_contrato)) {
      return res.status(400).json({ message: "id_contrato inválido" });
    }

    const check = await validarContratoParaRegencia({ id_proyecto, tipoActividad: tipo });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const creado_por =
      req.user?.id ? `user:${req.user.id}` : "Sistema";

    const row = await Reg.crearActividad({
      ...body,
      tipo,
      id_proyecto,
      id_contrato,
      creado_por,
      origen: body.origen || "MANUAL",
    });

    const lista =
      Array.isArray(body.responsables)
        ? body.responsables
        : body.responsables?.responsables;

    if (!Array.isArray(lista) || lista.length === 0) {
      if (req.user?.id) {
        await Reg.setResponsables(row.id, [
          { id_usuario: req.user.id, rol: "RESPONSABLE" },
        ]);
      }
    } else {
      await Reg.setResponsables(row.id, lista);
    }

    return res.json(row);
  } catch (e) {
    console.error("crearActividad:", e);
    return res.status(500).json({ message: "Error creando actividad" });
  }
}

async function actualizarActividad(req, res) {
  try {
    const id = parseInt(req.params.id, 10);

    const act = await Reg.getActividad(id);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

    const nuevoTipo = req.body?.tipo ? String(req.body.tipo).toUpperCase() : act.tipo;
    const id_proyecto = act.id_proyecto;

    const check = await validarContratoParaRegencia({
      id_proyecto,
      tipoActividad: nuevoTipo,
    });
    if (!check.ok) return res.status(409).json({ message: check.message });

    const row = await Reg.actualizarActividad(id, {
      ...req.body,
      tipo: nuevoTipo,
    });

    const lista =
      Array.isArray(req.body?.responsables)
        ? req.body.responsables
        : Array.isArray(req.body)
        ? req.body
        : null;

    if (Array.isArray(lista)) {
      await Reg.setResponsables(id, lista);
    }

    return res.json(row);
  } catch (e) {
    console.error("actualizarActividad:", e);
    return res.status(500).json({ message: "Error actualizando actividad" });
  }
}

async function setEstadoActividad(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { estado } = req.body || {};
    if (!estado) return res.status(400).json({ message: "estado es obligatorio" });

    const act = await Reg.getActividad(id);
    if (!act) return res.status(404).json({ message: "Actividad no encontrada" });

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
}

/* =========================
   RESPONSABLES
   ========================= */
async function listarResponsables(req, res) {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);
    const rows = await Reg.listarResponsables(id_actividad);
    return res.json(rows);
  } catch (e) {
    console.error("listarResponsables:", e);
    return res.status(500).json({ message: "Error listando responsables" });
  }
}

async function setResponsables(req, res) {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);

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
}

/* =========================
   ALERTAS
   ========================= */
async function generarAlertasEstandar(req, res) {
  try {
    const id_actividad = parseInt(req.params.id_actividad, 10);

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
}

async function generarVisitasMensuales(req, res) {
  try {
    const id_contrato = parseInt(req.params.id, 10);
    if (!Number.isFinite(id_contrato)) {
      return res.status(400).json({ message: "id contrato inválido" });
    }

    const body = req.body || {};

    if (!body.titulo || !String(body.titulo).trim()) {
      return res.status(400).json({ message: "titulo es obligatorio" });
    }

    const ocurrencias = Array.isArray(body.ocurrencias) ? body.ocurrencias : [];
    if (ocurrencias.length === 0) {
      return res.status(400).json({
        message: "ocurrencias es obligatorio y debe tener al menos un elemento",
      });
    }

    const ocurrenciasNormalizadas = ocurrencias.map((x) => ({
      week_of_month: Number(x.week_of_month),
      day_of_week: Number(x.day_of_week),
    }));

    const hayOcurrenciaInvalida = ocurrenciasNormalizadas.some(
      (x) =>
        !Number.isInteger(x.week_of_month) ||
        x.week_of_month < 1 ||
        x.week_of_month > 5 ||
        !Number.isInteger(x.day_of_week) ||
        x.day_of_week < 0 ||
        x.day_of_week > 6
    );

    if (hayOcurrenciaInvalida) {
      return res.status(400).json({
        message:
          "Hay ocurrencias inválidas. week_of_month debe estar entre 1 y 5, y day_of_week entre 0 y 6.",
      });
    }

    const creado_por =
      req.user?.id ? `user:${req.user.id}` : "Sistema";

    const result = await Reg.generarVisitasMensualesDesdeContrato({
      id_contrato,
      titulo: String(body.titulo).trim(),
      descripcion: body.descripcion ? String(body.descripcion).trim() : null,
      tipo: body.tipo ? String(body.tipo).trim().toUpperCase() : "VISITA",
      hour: Number.isFinite(+body.hour) ? +body.hour : 9,
      minute: Number.isFinite(+body.minute) ? +body.minute : 0,
      months_ahead: Number.isFinite(+body.months_ahead) ? +body.months_ahead : 12,
      business_days_only: body.business_days_only !== false,
      shift_if_weekend: body.shift_if_weekend || "NEXT_BUSINESS_DAY",
      ocurrencias: ocurrenciasNormalizadas,
      creado_por,
    });

    return res.json({
      ok: true,
      creadas: result.created ?? 0,
      omitidas: result.skipped ?? 0,
      total: (result.created ?? 0) + (result.skipped ?? 0),
      detalle: result.items || [],
    });
  } catch (e) {
    console.error("generarVisitasMensuales:", e);
    return res.status(500).json({
      message: e?.message || "Error generando visitas mensuales",
    });
  }
}

module.exports = {
  getContratoActivo,
  listarContratos,
  crearContrato,
  actualizarContrato,
  listarActividades,
  getActividad,
  crearActividad,
  actualizarActividad,
  setEstadoActividad,
  listarResponsables,
  setResponsables,
  generarAlertasEstandar,
  generarVisitasMensuales,
};