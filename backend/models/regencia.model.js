const pool = require("../db");

/* =========================
   CONTRATOS
   ========================= */
async function getContratoActivoPorProyecto(id_proyecto) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM ema.regencia_contratos
    WHERE id_proyecto=$1 AND estado='ACTIVO'
    ORDER BY fecha_fin DESC
    LIMIT 1
    `,
    [id_proyecto]
  );
  return rows[0] || null;
}

async function listarContratosPorProyecto(id_proyecto) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM ema.regencia_contratos
    WHERE id_proyecto=$1
    ORDER BY creado_en DESC, fecha_fin DESC
    `,
    [id_proyecto]
  );
  return rows;
}

async function crearContrato({ id_proyecto, fecha_inicio, fecha_fin, titulo, observacion, creado_por }) {
  await pool.query(
    `
    UPDATE ema.regencia_contratos
    SET estado='VENCIDO'
    WHERE id_proyecto=$1 AND estado='ACTIVO' AND fecha_fin < $2
    `,
    [id_proyecto, fecha_fin]
  );

  await pool.query(
    `
    UPDATE ema.regencia_contratos
    SET estado='CERRADO'
    WHERE id_proyecto=$1 AND estado='ACTIVO'
    `,
    [id_proyecto]
  );

  const { rows } = await pool.query(
    `
    INSERT INTO ema.regencia_contratos (id_proyecto, fecha_inicio, fecha_fin, estado, titulo, observacion, creado_por)
    VALUES ($1, $2, $3, 'ACTIVO', $4, $5, $6)
    RETURNING *
    `,
    [
      id_proyecto,
      fecha_inicio || null,
      fecha_fin,
      titulo || null,
      observacion || null,
      creado_por || null,
    ]
  );

  return rows[0];
}

async function actualizarContrato(id, { fecha_inicio, fecha_fin, estado, titulo, observacion, creado_por }) {
  const { rows } = await pool.query(
    `
    UPDATE ema.regencia_contratos
    SET
      fecha_inicio = COALESCE($2, fecha_inicio),
      fecha_fin    = COALESCE($3, fecha_fin),
      estado       = COALESCE($4, estado),
      titulo       = COALESCE($5, titulo),
      observacion  = COALESCE($6, observacion),
      creado_por   = COALESCE($7, creado_por)
    WHERE id=$1
    RETURNING *
    `,
    [
      id,
      fecha_inicio || null,
      fecha_fin || null,
      estado || null,
      titulo || null,
      observacion || null,
      creado_por || null,
    ]
  );
  return rows[0] || null;
}

/* =========================
   ACTIVIDADES
   ========================= */
async function listarActividades({ id_proyecto, id_contrato, from, to, estado, tipo, q }) {
  const params = [];
  let where = ` WHERE 1=1 `;

  if (id_proyecto) {
    params.push(id_proyecto);
    where += ` AND a.id_proyecto = $${params.length} `;
  }

  if (id_contrato) {
    params.push(id_contrato);
    where += ` AND a.id_contrato = $${params.length} `;
  }

  if (from) {
    params.push(from);
    where += ` AND a.inicio_at >= $${params.length} `;
  }

  if (to) {
    params.push(to);
    where += ` AND a.inicio_at <= $${params.length} `;
  }

  if (estado) {
    params.push(estado);
    where += ` AND a.estado = $${params.length} `;
  }

  if (tipo) {
    params.push(tipo);
    where += ` AND a.tipo = $${params.length} `;
  }

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (a.titulo ILIKE $${params.length} OR COALESCE(a.descripcion,'') ILIKE $${params.length}) `;
  }

  const { rows } = await pool.query(
    `
    SELECT a.*
    FROM ema.regencia_actividades a
    ${where}
    ORDER BY a.inicio_at ASC
    `,
    params
  );

  return rows;
}

async function getActividad(id) {
  const { rows } = await pool.query(
    `SELECT * FROM ema.regencia_actividades WHERE id=$1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function crearActividad(payload) {
  const {
    id_proyecto,
    id_contrato,
    titulo,
    descripcion,
    tipo,
    inicio_at,
    fin_at,
    estado,
    regla_recurrencia,
    creado_por,
    origen,
  } = payload;

  const { rows } = await pool.query(
    `
    INSERT INTO ema.regencia_actividades
      (id_proyecto, id_contrato, origen, titulo, descripcion, tipo, inicio_at, fin_at, estado, regla_recurrencia, creado_por)
    VALUES
      ($1,$2,COALESCE($3,'MANUAL'),$4,$5,$6,$7,$8,COALESCE($9,'PENDIENTE'),$10,$11)
    RETURNING *
    `,
    [
      id_proyecto,
      id_contrato || null,
      origen || "MANUAL",
      titulo,
      descripcion || null,
      tipo,
      inicio_at,
      fin_at || null,
      estado || null,
      regla_recurrencia || null,
      creado_por || null,
    ]
  );

  return rows[0];
}

async function actualizarActividad(id, payload) {
  const {
    titulo,
    descripcion,
    tipo,
    inicio_at,
    fin_at,
    estado,
    regla_recurrencia,
  } = payload;

  const { rows } = await pool.query(
    `
    UPDATE ema.regencia_actividades
    SET
      titulo            = COALESCE($2, titulo),
      descripcion       = COALESCE($3, descripcion),
      tipo              = COALESCE($4, tipo),
      inicio_at         = COALESCE($5, inicio_at),
      fin_at            = COALESCE($6, fin_at),
      estado            = COALESCE($7, estado),
      regla_recurrencia = COALESCE($8, regla_recurrencia)
    WHERE id=$1
    RETURNING *
    `,
    [
      id,
      titulo || null,
      descripcion || null,
      tipo || null,
      inicio_at || null,
      fin_at || null,
      estado || null,
      regla_recurrencia || null,
    ]
  );

  return rows[0] || null;
}

async function setEstadoActividad(id, nuevoEstado) {
  const realizada_at = nuevoEstado === "REALIZADA" ? "now()" : "NULL";
  const { rows } = await pool.query(
    `
    UPDATE ema.regencia_actividades
    SET estado=$2,
        realizada_at = ${realizada_at}
    WHERE id=$1
    RETURNING *
    `,
    [id, nuevoEstado]
  );
  return rows[0] || null;
}

/* =========================
   RESPONSABLES
   ========================= */
async function listarResponsables(id_actividad) {
  const { rows } = await pool.query(
    `
    SELECT
      rr.id,
      rr.id_actividad,
      rr.id_usuario,
      rr.id_consultor,
      rr.email_externo,
      rr.rol,

      u.username,
      u.first_name,
      u.last_name,
      u.email,

      c.nombre AS consultor_nombre,

      TRIM(
        COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')
      ) AS nombre_completo,

      COALESCE(
        NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.username,
        u.email,
        c.nombre,
        rr.email_externo
      ) AS nombre_mostrar

    FROM ema.regencia_responsables rr
    LEFT JOIN public.users u
      ON u.id = rr.id_usuario
    LEFT JOIN ema.consultores c
      ON c.id_consultor = rr.id_consultor
    WHERE rr.id_actividad = $1
    ORDER BY rr.id ASC
    `,
    [id_actividad]
  );
  return rows;
}

async function setResponsables(id_actividad, lista = []) {
  await pool.query(`DELETE FROM ema.regencia_responsables WHERE id_actividad=$1`, [id_actividad]);

  for (const r of lista) {
    await pool.query(
      `
      INSERT INTO ema.regencia_responsables (id_actividad, id_usuario, id_consultor, email_externo, rol)
      VALUES ($1,$2,$3,$4,COALESCE($5,'RESPONSABLE'))
      `,
      [
        id_actividad,
        r.id_usuario || null,
        r.id_consultor || null,
        r.email_externo || null,
        r.rol || null,
      ]
    );
  }

  return listarResponsables(id_actividad);
}

/* =========================
   ALERTAS y QUEUE
   ========================= */
async function crearAlertaYQueue({ id_actividad, modo="AUTO", offset_min, canal="IN_APP", activo=true }) {
  const { rows: alertRows } = await pool.query(
    `
    INSERT INTO ema.regencia_alertas (id_actividad, modo, offset_min, canal, activo)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *
    `,
    [id_actividad, modo, offset_min, canal, activo]
  );
  const alerta = alertRows[0];

  const { rows: actRows } = await pool.query(
    `SELECT inicio_at FROM ema.regencia_actividades WHERE id=$1 LIMIT 1`,
    [id_actividad]
  );
  if (!actRows[0]) return alerta;

  const { rows: qRows } = await pool.query(
    `
    INSERT INTO ema.regencia_alertas_queue (id_alerta, disparar_at, estado)
    VALUES (
      $1,
      (SELECT inicio_at + make_interval(mins => $2) FROM ema.regencia_actividades WHERE id=$3),
      'PENDIENTE'
    )
    RETURNING *
    `,
    [alerta.id, offset_min, id_actividad]
  );

  return { alerta, queue: qRows[0] };
}

async function generarAlertasEstandar(id_actividad) {
  const act = await getActividad(id_actividad);
  if (!act) return { created: 0, items: [] };

  let offsets = [];
  if (act.tipo === "VISITA") offsets = [-7 * 24 * 60];
  if (act.tipo === "ENTREGA_INFORME") offsets = [-3 * 24 * 60];
  if (act.tipo === "AUDITORIA") offsets = [-90 * 24 * 60];

  const items = [];
  for (const off of offsets) {
    const created = await crearAlertaYQueue({
      id_actividad,
      modo: "AUTO",
      offset_min: off,
      canal: "IN_APP",
      activo: true,
    });
    items.push(created);
  }
  return { created: items.length, items };
}

/* =========================
   HELPERS FECHAS
   ========================= */
function toDateOnlyISO(x) {
  if (!x) return null;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  const d = new Date(x);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(x).slice(0, 10);
}

function isWeekend(dateObj) {
  const day = dateObj.getDay();
  return day === 0 || day === 6;
}

function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + days);
  return d;
}

function shiftToBusinessDay(dateObj, shiftMode = "NEXT_BUSINESS_DAY") {
  let d = new Date(dateObj);
  if (!isWeekend(d)) return d;

  if (shiftMode === "PREV_BUSINESS_DAY") {
    while (isWeekend(d)) d = addDays(d, -1);
    return d;
  }

  while (isWeekend(d)) d = addDays(d, +1);
  return d;
}

function lastDayOfMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function buildMonthlyDate(baseISO, monthOffset, hour = 9, minute = 0) {
  const base = new Date(baseISO + "T00:00:00");
  const baseDay = base.getDate();

  const y = base.getFullYear();
  const m = base.getMonth();

  const targetMonth = m + monthOffset;
  const target = new Date(y, targetMonth, 1, hour, minute, 0, 0);

  const maxDay = lastDayOfMonth(target.getFullYear(), target.getMonth());
  const day = Math.min(baseDay, maxDay);

  target.setDate(day);
  return target;
}

/* =========================
   GENERADOR VISITAS
   ========================= */
async function generarVisitasMensualesDesdeContrato({
  id_contrato,
  seed_date,
  hour = 9,
  minute = 0,
  months_ahead = 12,
  business_days_only = true,
  shift_if_weekend = "NEXT_BUSINESS_DAY",
  creado_por = "Sistema",
}) {
  if (!id_contrato) throw new Error("Falta id_contrato");

  const { rows: cRows } = await pool.query(
    `
    SELECT id, id_proyecto, fecha_inicio, fecha_fin, estado
    FROM ema.regencia_contratos
    WHERE id=$1
    LIMIT 1
    `,
    [id_contrato]
  );
  const contrato = cRows[0];
  if (!contrato) throw new Error("Contrato no encontrado");
  if (contrato.estado !== "ACTIVO") return { created: 0, skipped: 0 };

  const contratoInicioISO = toDateOnlyISO(contrato.fecha_inicio) || null;
  const contratoFinISO = toDateOnlyISO(contrato.fecha_fin);
  if (!contratoFinISO) throw new Error("Contrato sin fecha_fin");

  const hoyISO = new Date().toISOString().slice(0, 10);
  const seedISO = toDateOnlyISO(seed_date) || hoyISO;

  const startISO = [hoyISO, contratoInicioISO, seedISO].filter(Boolean).sort().slice(-1)[0];

  const startDate = new Date(startISO + "T00:00:00");
  const endDate = new Date(contratoFinISO + "T23:59:59");

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < months_ahead; i++) {
    let dt = buildMonthlyDate(seedISO, i, hour, minute);

    if (business_days_only) {
      dt = shiftToBusinessDay(dt, shift_if_weekend);
    }

    if (dt < startDate) {
      skipped++;
      continue;
    }
    if (dt > endDate) {
      break;
    }

    const inicio_at = dt;
    const fin_at = null;

    const { rows: ins } = await pool.query(
      `
      INSERT INTO ema.regencia_actividades
        (id_proyecto, id_contrato, origen, titulo, descripcion, tipo, inicio_at, fin_at, estado, regla_recurrencia, creado_por)
      VALUES
        ($1, $2, 'AUTO', $3, $4, 'VISITA', $5, $6, 'PENDIENTE', $7, $8)
      ON CONFLICT (id_contrato, inicio_at, tipo)
        WHERE (origen = 'AUTO')
      DO NOTHING
      RETURNING id
      `,
      [
        contrato.id_proyecto,
        id_contrato,
        "Visita mensual de regencia",
        `Visita programada automáticamente (${dt.toLocaleString()}).`,
        inicio_at,
        fin_at,
        {
          kind: "MONTHLY",
          seed_date: seedISO,
          months_ahead,
          business_days_only,
          shift_if_weekend,
          hour,
          minute,
        },
        creado_por || null,
      ]
    );

    if (ins.length === 0) {
      skipped++;
      continue;
    }

    created++;

    try {
      await generarAlertasEstandar(ins[0].id);
    } catch (e) {
      console.warn("[Regencia] No se pudieron generar alertas estándar:", e.message);
    }
  }

  return { created, skipped };
}

module.exports = {
  getContratoActivoPorProyecto,
  listarContratosPorProyecto,
  crearContrato,
  actualizarContrato,
  listarActividades,
  getActividad,
  crearActividad,
  actualizarActividad,
  setEstadoActividad,
  generarVisitasMensualesDesdeContrato,
  listarResponsables,
  setResponsables,
  generarAlertasEstandar,
  crearAlertaYQueue,
};