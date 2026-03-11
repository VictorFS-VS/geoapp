// jobs/scheduleResolucionNotifications.job.js
"use strict";

const cron = require("node-cron");
const { startOfDay, differenceInCalendarDays } = require("date-fns");
const pool = require("../db");
const { crearNotificacion } = require("../controllers/notificaciones.controller");

// ✅ REGENCIA: integrar jobs existentes
const { jobContratosVencidos } = require("./regenciaContratos.job");
const { jobDispararAlertas } = require("./regenciaAlertas.job");
const { jobGenerarVisitasMensuales } = require("./regenciaGenerateVisitas.job");

// ✅ Timezone Paraguay
const TZ = "America/Asuncion";

/* =========================
   LOCK (evita duplicados por 2 instancias)
========================= */
async function withJobLock(lockKey, fn) {
  const client = await pool.connect();
  try {
    const got = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [lockKey]);
    if (!got.rows?.[0]?.ok) {
      console.log("⏭️ [Job] Saltado: otra instancia ya lo está ejecutando");
      return;
    }
    await fn();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
    } catch {}
    client.release();
  }
}

/* =========================
   Helpers
========================= */
function fmtPyDate(dateObj) {
  try {
    return dateObj.toLocaleDateString("es-PY");
  } catch {
    return String(dateObj);
  }
}

function etiquetaNumeroGestion(nro, gestion, fallbackId) {
  const n = nro != null ? String(nro) : fallbackId != null ? String(fallbackId) : "";
  const g = gestion != null ? String(gestion) : "";
  return g ? `N°${n}/${g}` : `N°${n}`;
}

// ✅ nombre visible del proyecto (prioriza nombre, y opcional código)
function etiquetaProyecto(row) {
  const nombre = (row?.proyecto_nombre || "").trim();
  const codigo = (row?.proyecto_codigo || "").trim();

  if (nombre && codigo) return `${nombre} (${codigo})`;
  if (nombre) return nombre;
  if (codigo) return codigo;
  // fallback: id si no hay nada
  return `ID ${row?.id_proyecto}`;
}

/**
 * ✅ Upsert deduplicado para RESOLUCIONES:
 * - Busca existente aunque esté leída (para NO crear 175/176/177…)
 * - Si existe: UPDATE, y la vuelve NO leída
 * - Apaga duplicadas viejas (true/true)
 */
async function upsertNotificacionResolucion({
  id_proyecto,
  proponenteId,
  consultorId,
  titulo,
  mensaje,
  creado_por = "Sistema",
  es_global = false,
}) {
  const tLower = String(titulo || "").toLowerCase();

  const familia =
    tLower.includes("resolución") && tLower.includes("vencida")
      ? "RES_VENCIDA"
      : tLower.includes("resolución") && tLower.includes("vence en")
      ? "RES_VENCE"
      : null;

  // Si no encaja, crear normal
  if (!familia) {
    return crearNotificacion({
      proponenteId,
      consultorId,
      id_proyecto: parseInt(id_proyecto, 10),
      titulo,
      mensaje,
      creado_por,
      es_global,
    });
  }

  // ✅ Buscar existente del mismo tipo (aunque esté leída)
  const existing = await pool.query(
    `
    SELECT id
    FROM public.notificaciones
    WHERE id_proyecto = $1
      AND (
        ($2 = 'RES_VENCIDA' AND lower(titulo) LIKE 'resolución % vencida%')
        OR
        ($2 = 'RES_VENCE'  AND lower(titulo) LIKE 'resolución % vence en%')
      )
    ORDER BY creado_en DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [id_proyecto, familia]
  );

  if (existing.rowCount > 0) {
    const id = existing.rows[0].id;

    // ✅ Actualiza y vuelve no-leída
    await pool.query(
      `
      UPDATE public.notificaciones
         SET titulo = $2,
             mensaje = $3,
             creado_en = now(),
             leido_usuario = false,
             leido_consultor = false
       WHERE id = $1
      `,
      [id, titulo, mensaje]
    );

    // ✅ Apaga duplicadas viejas (dejar solo 1 por familia/proyecto)
    await pool.query(
      `
      UPDATE public.notificaciones
         SET leido_usuario = true,
             leido_consultor = true
       WHERE id_proyecto = $1
         AND id <> $2
         AND (
           ($3 = 'RES_VENCIDA' AND lower(titulo) LIKE 'resolución % vencida%')
           OR
           ($3 = 'RES_VENCE'  AND lower(titulo) LIKE 'resolución % vence en%')
         )
      `,
      [id_proyecto, id, familia]
    );

    return { id, updated: true };
  }

  // ✅ Si no existe: crea
  const created = await crearNotificacion({
    proponenteId,
    consultorId,
    id_proyecto: parseInt(id_proyecto, 10),
    titulo,
    mensaje,
    creado_por,
    es_global,
  });

  const newId = created?.id;

  // ✅ Apaga duplicadas viejas (por las dudas)
  if (newId) {
    await pool.query(
      `
      UPDATE public.notificaciones
         SET leido_usuario = true,
             leido_consultor = true
       WHERE id_proyecto = $1
         AND id <> $2
         AND (
           ($3 = 'RES_VENCIDA' AND lower(titulo) LIKE 'resolución % vencida%')
           OR
           ($3 = 'RES_VENCE'  AND lower(titulo) LIKE 'resolución % vence en%')
         )
      `,
      [id_proyecto, newId, familia]
    );
  }

  return created;
}

/**
 * ✅ DIA: avisos por hitos (180/150/120 y -90) — no spamean diario.
 * Dedupe por (proyecto + título).
 */
async function crearNotificacionDIAOnce({
  id_proyecto,
  proponenteId,
  consultorId,
  titulo,
  mensaje,
  creado_por = "Sistema",
  es_global = false,
}) {
  const existe = await pool.query(
    `
    SELECT 1 FROM public.notificaciones
    WHERE id_proyecto = $1 AND titulo = $2
    LIMIT 1
    `,
    [id_proyecto, titulo]
  );
  if (existe.rowCount > 0) return null;

  return crearNotificacion({
    proponenteId,
    consultorId,
    id_proyecto: parseInt(id_proyecto, 10),
    titulo,
    mensaje,
    creado_por,
    es_global,
  });
}

/* =========================
   CRON: 07:55 PY (Vencimientos + Regencia diaria)
========================= */
cron.schedule(
  "55 7 * * *",
  async () => {
    await withJobLock(901337, async () => {
      console.log("🔔 [Job] Comprobación de vencimientos iniciada…");

      try {
        const hoy = startOfDay(new Date());

        /** ----------------------------------
         *  RESOLUCIONES: vencidas y próximas
         * ---------------------------------- */
        const { rows: resoluciones } = await pool.query(`
          WITH latest_res AS (
            SELECT DISTINCT ON (id_proyecto)
              id_resoluciones,
              id_proyecto,
              nro_resolucion,
              gestion_resolucion,
              fecha_prox_vto_aa
            FROM ema.resoluciones
            WHERE fecha_prox_vto_aa IS NOT NULL
            ORDER BY id_proyecto, fecha_prox_vto_aa DESC
          )
          SELECT 
            lr.id_resoluciones      AS id_resolucion,
            lr.id_proyecto,
            lr.nro_resolucion,
            lr.gestion_resolucion,
            lr.fecha_prox_vto_aa    AS fecha_vto,
            p.id_proponente,
            p.id_consultor,
            p.nombre                AS proyecto_nombre,
            p.codigo                AS proyecto_codigo
          FROM latest_res lr
          JOIN ema.proyectos p ON p.gid = lr.id_proyecto
        `);

        console.log(`📄 [Resoluciones] Analizando ${resoluciones.length} resoluciones…`);

        for (const row of resoluciones) {
          const fechaVto = startOfDay(new Date(row.fecha_vto));
          const daysDiff = differenceInCalendarDays(fechaVto, hoy);

          const etiquetaRes = etiquetaNumeroGestion(
            row.nro_resolucion,
            row.gestion_resolucion,
            row.id_resolucion
          );

          const projLabel = etiquetaProyecto(row);

          let titulo = null;
          let mensaje = null;

          if (daysDiff < 0) {
            titulo = `Resolución ${etiquetaRes} vencida`;
            mensaje = `La resolución ${etiquetaRes} del proyecto ${projLabel} venció el ${fmtPyDate(fechaVto)}.`;
          } else if (daysDiff <= 183) {
            titulo = `Resolución ${etiquetaRes} vence en ${daysDiff} día${daysDiff === 1 ? "" : "s"}`;
            mensaje = `La resolución ${etiquetaRes} del proyecto ${projLabel} vence el ${fmtPyDate(fechaVto)}.`;
          } else {
            continue;
          }

          try {
            const result = await upsertNotificacionResolucion({
              proponenteId: row.id_proponente || null,
              consultorId: row.id_consultor || null,
              id_proyecto: parseInt(row.id_proyecto, 10),
              titulo,
              mensaje,
              creado_por: "Sistema",
              es_global: false,
            });

            if (result?.updated) {
              console.log(`♻️ [Resolución] Actualizada: "${titulo}" (proyecto ${row.id_proyecto})`);
            } else if (result) {
              console.log(`✅ [Resolución] Creada: "${titulo}" (proyecto ${row.id_proyecto})`);
            }
          } catch (e) {
            console.warn(
              `❌ Error creando/actualizando notificación de resolución para proyecto ${row.id_proyecto}:`,
              e?.message || e
            );
          }
        }

        /** ------------------------------------------
         *  DECLARACIONES DIA: hitos + aviso -90 (una sola vez)
         * ------------------------------------------ */
        const { rows: declaraciones } = await pool.query(`
          SELECT 
            d.id_declaracion,
            d.id_proyecto,
            d.nro_declaracion,
            d.gestion_declaracion,
            d.fecha_prox_vto_aa,
            p.id_proponente,
            p.id_consultor,
            p.nombre  AS proyecto_nombre,
            p.codigo  AS proyecto_codigo
          FROM ema.declaraciones d
          JOIN ema.proyectos p ON p.gid = d.id_proyecto
          WHERE d.fecha_prox_vto_aa IS NOT NULL
        `);

        console.log(`📄 [DIA] Analizando ${declaraciones.length} declaraciones…`);

        for (const d of declaraciones) {
          const fechaVto = startOfDay(new Date(d.fecha_prox_vto_aa));
          const diasRestantes = differenceInCalendarDays(fechaVto, hoy);

          // Si ya hay resolución, no mantener aviso “3 meses vencida”
          const { rowCount: tieneResolucion } = await pool.query(
            `
            SELECT 1
            FROM ema.resoluciones
            WHERE id_proyecto = $1
            LIMIT 1
            `,
            [d.id_proyecto]
          );

          const etiquetaDia = etiquetaNumeroGestion(
            d.nro_declaracion,
            d.gestion_declaracion,
            d.id_declaracion
          );

          const projLabel = etiquetaProyecto(d);

          let titulo = "";
          let mensaje = "";

          if (diasRestantes === 180) {
            titulo = `DIA ${etiquetaDia} vence en 6 meses`;
            mensaje = `La declaración DIA ${etiquetaDia} del proyecto ${projLabel} vence el ${fmtPyDate(fechaVto)}.`;
          } else if (diasRestantes === 150) {
            titulo = `DIA ${etiquetaDia} vence en 5 meses`;
            mensaje = `La declaración DIA ${etiquetaDia} del proyecto ${projLabel} vence el ${fmtPyDate(fechaVto)}.`;
          } else if (diasRestantes === 120) {
            titulo = `DIA ${etiquetaDia} vence en 4 meses`;
            mensaje = `La declaración DIA ${etiquetaDia} del proyecto ${projLabel} vence el ${fmtPyDate(fechaVto)}.`;
          } else if (diasRestantes <= -90 && tieneResolucion === 0) {
            titulo = `DIA ${etiquetaDia} vencida hace más de 3 meses`;
            mensaje = `La declaración DIA ${etiquetaDia} del proyecto ${projLabel} está vencida desde el ${fmtPyDate(
              fechaVto
            )} y aún no tiene una resolución.`;
          } else {
            continue;
          }

          try {
            const created = await crearNotificacionDIAOnce({
              proponenteId: d.id_proponente || null,
              consultorId: d.id_consultor || null,
              id_proyecto: parseInt(d.id_proyecto, 10),
              titulo,
              mensaje,
              creado_por: "Sistema",
              es_global: false,
            });

            if (created) {
              console.log(`✅ [DIA] Creada: "${titulo}" (proyecto ${d.id_proyecto})`);
            } else {
              console.log(`⏭️ [DIA] Ya existía: "${titulo}" (proyecto ${d.id_proyecto})`);
            }
          } catch (e) {
            console.warn(`❌ Error creando notificación de DIA para proyecto ${d.id_proyecto}:`, e?.message || e);
          }
        }

        /** ------------------------------------------
         *  REGENCIA: contratos vencidos
         * ------------------------------------------ */
        try {
          await jobContratosVencidos();
          console.log("🧾 [Regencia] Contratos vencidos procesados ✔️");
        } catch (e) {
          console.warn("❌ [Regencia] Error en jobContratosVencidos:", e?.message || e);
        }

        /** ------------------------------------------
         *  REGENCIA: generar visitas mensuales
         * ------------------------------------------ */
        try {
          await jobGenerarVisitasMensuales();
          console.log("🗓️ [Regencia] Visitas mensuales generadas ✔️");
        } catch (e) {
          console.warn("❌ [Regencia] Error en jobGenerarVisitasMensuales:", e?.message || e);
        }

        console.log("✅ Job completado con éxito ✔️");
      } catch (err) {
        console.error("❌ Error en el job de notificaciones:", err?.message || err);
      }
    });
  },
  { timezone: TZ }
);

/* =========================
   REGENCIA: cola alertas (cada 5 min)
   ✅ también con lock (evita doble disparo en cluster)
========================= */
cron.schedule(
  "*/5 * * * *",
  async () => {
    await withJobLock(901338, async () => {
      try {
        await jobDispararAlertas();
      } catch (err) {
        console.error("❌ Error en jobDispararAlertas (Regencia):", err?.message || err);
      }
    });
  },
  { timezone: TZ }
);