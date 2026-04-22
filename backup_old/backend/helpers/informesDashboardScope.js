"use strict";

/**
 * Build the shared visibility scope for Informes, matching listInformesByProyecto.
 * Caller must already filter by id_proyecto in the base query.
 */
function buildInformeVisibleScope({
  userId,
  isAdmin,
  plantillaId = null,
  startIndex = 1,
} = {}) {
  const params = [];
  let idx = startIndex;

  const userParamIndex = idx++;
  params.push(userId ?? null);

  const adminParamIndex = idx++;
  params.push(Boolean(isAdmin));

  let plantillaParamIndex = null;
  let whereSql = "";

  if (plantillaId !== null && String(plantillaId).trim() !== "") {
    const idPl = Number(plantillaId);
    if (Number.isFinite(idPl) && idPl > 0) {
      plantillaParamIndex = idx++;
      params.push(idPl);
      whereSql += ` AND i.id_plantilla = $${plantillaParamIndex} `;
    }
  }

  whereSql += `
    AND (
      $${adminParamIndex} = true
      OR p.id_creador = $${userParamIndex}
      OR (
        COALESCE(p.activo, true) = true
        AND pu.id_usuario IS NOT NULL
      )
    )
  `;

  return {
    whereSql,
    params,
    userParamIndex,
    adminParamIndex,
    plantillaParamIndex,
  };
}

module.exports = { buildInformeVisibleScope };
