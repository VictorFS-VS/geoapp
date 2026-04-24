"use strict";

const pool = require("../../db");
const { getProjectHomeConfig } = require("./projectHomeConfig.service");

/**
 * Executive Aggregator Service
 */
async function getProjectHomeExecutiveResumen({ _req, id_proyecto }) {
  try {
    if (!id_proyecto) {
      console.warn("[HEALTH_EXEC] Missing id_proyecto");
      return null;
    }

    // 1. Get Project Config
    let configRow = null;
    try {
      configRow = await getProjectHomeConfig({ _req, id_proyecto });
      console.log("[HEALTH_EXEC] Config loaded:", { id_plantilla: configRow?.id_plantilla, kpi_primary_field_id: configRow?.kpi_primary_field_id });
    } catch (errConfig) {
      console.error("[HEALTH_EXEC] ERROR getting project config:", errConfig.message);
      // Continue with null config
      configRow = null;
    }

    const focusPlantillaId = configRow?.id_plantilla || null;
    const tramoFieldId = configRow?.kpi_primary_field_id || null;

    // 1.1 Resolve Plantilla Label if exists
    let focoLabel = "Plantilla Principal";
    if (focusPlantillaId) {
      try {
        const rP = await pool.query("SELECT nombre FROM ema.informe_plantilla WHERE id_plantilla = $1", [focusPlantillaId]);
        if (rP.rows[0]?.nombre) focoLabel = rP.rows[0].nombre;
      } catch (errPlant) {
        console.error("[HEALTH_EXEC] ERROR getting plantilla nombre:", errPlant.message);
      }
    }

    console.log("[HEALTH_EXEC] Starting atomic queries for id_proyecto:", id_proyecto);

    // 2. Atomic Queries Execution
    const [socioResult, catastroResult, quejasResult, projectInfoResult] = await Promise.allSettled([
      fetchSocioambientalHealth(id_proyecto, focusPlantillaId, tramoFieldId),
      fetchCatastroHealth(id_proyecto),
      fetchQuejasHealth(id_proyecto),
      fetchProjectBasics(id_proyecto)
    ]);

    const socioData = socioResult.status === "fulfilled" ? socioResult.value : { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
    const catastroData = catastroResult.status === "fulfilled" ? catastroResult.value : { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
    const quejasData = quejasResult.status === "fulfilled" ? quejasResult.value : { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
    const projectInfo = projectInfoResult.status === "fulfilled" ? projectInfoResult.value : { nombre: `Proyecto ${id_proyecto}` };

    if (socioResult.status === "rejected") {
      console.error("[HEALTH_EXEC] socioambiental fetch failed:", socioResult.reason?.message || socioResult.reason);
    }
    if (catastroResult.status === "rejected") {
      console.error("[HEALTH_EXEC] catastro fetch failed:", catastroResult.reason?.message || catastroResult.reason);
    }
    if (quejasResult.status === "rejected") {
      console.error("[HEALTH_EXEC] quejas fetch failed:", quejasResult.reason?.message || quejasResult.reason);
    }
    if (projectInfoResult.status === "rejected") {
      console.error("[HEALTH_EXEC] project basics fetch failed:", projectInfoResult.reason?.message || projectInfoResult.reason);
    }

    console.log("[HEALTH_EXEC] Query results:", {
      socio_total: socioData?.totalGlobal,
      catastro_total: catastroData?.totalGlobal,
      quejas_total: quejasData?.totalGlobal
    });

    if (socioData) {
      socioData.focoLabel = focoLabel;
    }

    return {
      ok: true,
      project: projectInfo,
      socioambiental: socioData,
      catastro: catastroData,
      quejas: quejasData
    };
  } catch (errMain) {
    console.error("[HEALTH_EXEC] CRITICAL ERROR in getProjectHomeExecutiveResumen:", errMain.message, errMain.stack);
    return {
      ok: false,
      error: errMain.message,
      project: null,
      socioambiental: { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null },
      catastro: { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null },
      quejas: { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null }
    };
  }
}

async function fetchProjectBasics(id_proyecto) {
  const r = await pool.query("SELECT gid AS id, nombre, tipo_estudio FROM ema.proyectos WHERE gid = $1", [id_proyecto]);
  return r.rows[0] || { id: id_proyecto, nombre: `Proyecto ${id_proyecto}`, tipo_estudio: null };
}

async function fetchLastActivity(tableName, id_proyecto, candidateColumns = []) {
  for (const columnName of candidateColumns) {
    try {
      const qLast = `SELECT MAX(${columnName}) as last_activity FROM ${tableName} WHERE id_proyecto = $1`;
      const rLast = await pool.query(qLast, [id_proyecto]);
      return rLast.rows[0]?.last_activity || null;
    } catch (err) {
      console.warn(`[HEALTH_CORE] ${tableName}.${columnName} not usable for last activity:`, err.message);
    }
  }
  return null;
}

async function fetchSocioambientalHealth(id_proyecto, focusId, tramoId) {
  try {
    console.log("[SOCIO_HEALTH] Starting for id_proyecto:", id_proyecto, "focusId:", focusId);
    
    // Total Global
    const qGlobal = "SELECT COUNT(*)::int as total FROM ema.informe WHERE id_proyecto = $1";
    console.log("[SOCIO_HEALTH] Executing global query:", qGlobal, "with param:", id_proyecto);
    const rGlobal = await pool.query(qGlobal, [id_proyecto]);
    const totalGlobal = rGlobal.rows[0]?.total || 0;
    console.log("[SOCIO_HEALTH] Global total:", totalGlobal);

    // Foco Local (selected plantilla)
    const qFoco = "SELECT COUNT(*)::int as total FROM ema.informe WHERE id_proyecto = $1 AND id_plantilla = $2";
    const rFoco = focusId ? await pool.query(qFoco, [id_proyecto, focusId]) : { rows: [{ total: totalGlobal }] };
    const totalFoco = rFoco.rows[0]?.total || 0;
    console.log("[SOCIO_HEALTH] Foco total:", totalFoco);

    // Desglose by Tramo (or primary KPI)
    let desglose = [];
    if (tramoId && totalFoco > 0) {
      const qDesglose = `
        SELECT 
          LOWER(TRIM(COALESCE(r.valor_texto, r.valor_json::text, 'Sin Datos'))) as label,
          COUNT(*)::int as valor
        FROM ema.informe_respuesta r
        JOIN ema.informe i ON i.id_informe = r.id_informe
        WHERE i.id_proyecto = $1 
          ${focusId ? "AND i.id_plantilla = $2" : ""}
          AND r.id_pregunta = $${focusId ? "3" : "2"}
          AND TRIM(COALESCE(r.valor_texto, r.valor_json::text, '')) <> ''
        GROUP BY label
        ORDER BY valor DESC
        LIMIT 5
      `;
      const params = focusId ? [id_proyecto, focusId, tramoId] : [id_proyecto, tramoId];
      try {
        const rDesglose = await pool.query(qDesglose, params);
        desglose = rDesglose.rows.map((row) => ({
          label: row.label,
          valor: row.valor,
          pct: totalFoco > 0 ? Math.round((row.valor / totalFoco) * 100) : 0,
        }));
      } catch (errDesglose) {
        console.error("[SOCIO_HEALTH] Desglose query failed:", errDesglose.message);
      }
    }

    // Last Activity - Normalizado a 'fecha_creado' según auditoría
    const lastActivity = await fetchLastActivity("ema.informe", id_proyecto, ["fecha_creado", "created_at", "creado_en"]);

    return {
      totalGlobal,
      foco: totalFoco,
      desglose,
      lastActivity,
    };
  } catch (err) {
    console.error("[SOCIO_HEALTH] FATAL ERROR:", err.message, err.stack);
    return { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
  }
}

async function fetchCatastroHealth(id_proyecto) {
  try {
    console.log("[CATASTRO_HEALTH] Starting for id_proyecto:", id_proyecto);
    
    const q = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE LOWER(TRIM(estado)) = 'listo_dbi')::int as validos,
        COUNT(*) FILTER (WHERE LOWER(TRIM(estado)) = 'en_proceso')::int as proceso,
        COUNT(*) FILTER (WHERE LOWER(TRIM(estado)) = 'fase_0')::int as pendientes
      FROM ema.expedientes
      WHERE id_proyecto = $1
    `;
    console.log("[CATASTRO_HEALTH] Executing query with id_proyecto:", id_proyecto);
    const r = await pool.query(q, [id_proyecto]);
    console.log("[CATASTRO_HEALTH] Query returned:", r.rows[0]);
    const row = r.rows[0] || { total: 0, validos: 0, proceso: 0, pendientes: 0 };

    const total = Number(row.total);
    const desglose = [
      { label: "Validados (DBI)", valor: row.validos },
      { label: "En Proceso", valor: row.proceso },
      { label: "Pendientes", valor: row.pendientes },
    ].map((d) => ({
      ...d,
      pct: total > 0 ? Math.round((d.valor / total) * 100) : 0,
    }));

    // Last Activity - Normalizado a 'creado_en' según auditoría
    const lastActivity = await fetchLastActivity("ema.expedientes", id_proyecto, ["created_at", "creado_en", "fecha_creado"]);

    return {
      totalGlobal: total,
      foco: row.validos,
      desglose,
      lastActivity,
    };
  } catch (err) {
    console.error("[CATASTRO_HEALTH] FATAL ERROR:", err.message, err.stack);
    return { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
  }
}

async function fetchQuejasHealth(id_proyecto) {
  try {
    console.log("[QUEJAS_HEALTH] Starting for id_proyecto:", id_proyecto);
    
    const q = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE estado IN ('abierto', 'en_proceso'))::int as abiertos,
        COUNT(*) FILTER (WHERE estado IN ('cerrado', 'respondido'))::int as cerrados
      FROM ema.quejas_reclamos
      WHERE id_proyecto = $1
    `;
    console.log("[QUEJAS_HEALTH] Executing query with id_proyecto:", id_proyecto);
    const r = await pool.query(q, [id_proyecto]);
    console.log("[QUEJAS_HEALTH] Query returned:", r.rows[0]);
    const row = r.rows[0] || { total: 0, abiertos: 0, cerrados: 0 };

    const total = Number(row.total);
    const desglose = [
      { label: "Pendientes", valor: row.abiertos },
      { label: "Cerradas", valor: row.cerrados },
    ].map((d) => ({
      ...d,
      pct: total > 0 ? Math.round((d.valor / total) * 100) : 0,
    }));

    // Last Activity - Normalizado a 'created_at' según auditoría
    const lastActivity = await fetchLastActivity("ema.quejas_reclamos", id_proyecto, ["created_at", "creado_en", "fecha_creado"]);

    return {
      totalGlobal: total,
      foco: row.abiertos,
      desglose,
      lastActivity,
    };
  } catch (err) {
    console.error("[QUEJAS_HEALTH] FATAL ERROR:", err.message, err.stack);
    return { totalGlobal: 0, foco: 0, desglose: [], lastActivity: null };
  }
}

module.exports = {
  getProjectHomeExecutiveResumen,
};
