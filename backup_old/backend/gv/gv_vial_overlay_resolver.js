"use strict";

const pool = require("../db");
const proyectoJerarquiaModel = require("../models/proyecto_jerarquia.model");

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toSortedNumeric(values) {
  return Array.from(new Set((values || []).map((value) => toPositiveInt(value)).filter(Boolean))).sort(
    (a, b) => a - b
  );
}

function emptyResolution({ idProyecto, idProyectoTramo = null, idProyectoSubtramo = null }) {
  return {
    id_proyecto: toPositiveInt(idProyecto),
    requested_project_tramo_id: toPositiveInt(idProyectoTramo),
    requested_project_subtramo_id: toPositiveInt(idProyectoSubtramo),
    resolved_project_tramo_ids: [],
    resolved_project_subtramo_ids: [],
    resolved_vial_tramo_ids: [],
    resolved_vial_subtramo_ids: [],
    resolved_proxy_tramo_ids_from_subtramos: [],
    matched_project_ids: [],
    resolution_mode: "project",
    used_subtramo_fallback: false,
    resolution_source: "project_scope",
    has_direct_tramo_link: false,
    has_subtramo_candidates: false,
    overlay_feature_count: 0,
    coverage_status: "ok",
    coverage_reason: "project_scope",
    is_project_scope_fallback: false,
    is_global_tramo_fallback: false,
    warnings: [],
  };
}

function cloneResolution(resolution) {
  return {
    ...(resolution || {}),
    resolved_project_tramo_ids: toSortedNumeric(resolution?.resolved_project_tramo_ids),
    resolved_project_subtramo_ids: toSortedNumeric(resolution?.resolved_project_subtramo_ids),
    resolved_vial_tramo_ids: toSortedNumeric(resolution?.resolved_vial_tramo_ids),
    resolved_vial_subtramo_ids: toSortedNumeric(resolution?.resolved_vial_subtramo_ids),
    resolved_proxy_tramo_ids_from_subtramos: toSortedNumeric(
      resolution?.resolved_proxy_tramo_ids_from_subtramos
    ),
    matched_project_ids: toSortedNumeric(resolution?.matched_project_ids),
    warnings: Array.isArray(resolution?.warnings) ? [...resolution.warnings] : [],
  };
}

function finalizeResolutionCoverage({ resolution, overlayFeatureCount = 0 }) {
  const next = cloneResolution(resolution);
  const featureCount = Math.max(0, Number(overlayFeatureCount) || 0);
  const hasDirectTramoLink = next.resolved_vial_tramo_ids.length > 0;
  const hasSubtramoCandidates = next.resolved_vial_subtramo_ids.length > 0;

  next.overlay_feature_count = featureCount;
  next.has_direct_tramo_link = hasDirectTramoLink;
  next.has_subtramo_candidates = hasSubtramoCandidates;
  next.used_subtramo_fallback = false;
  next.is_project_scope_fallback = false;
  next.is_global_tramo_fallback = false;
  next.matched_project_ids = toSortedNumeric(next.matched_project_ids);

  if (next.resolution_mode === "project") {
    next.resolution_source = "project_scope";
    next.coverage_status = featureCount > 0 ? "ok" : "none";
    next.coverage_reason = "project_scope";
    return next;
  }

  if (featureCount > 0 && hasDirectTramoLink) {
    next.resolution_source = "tramo_directo";
    next.coverage_status = "ok";
    next.coverage_reason = "direct_tramo";
    return next;
  }

  if (!hasDirectTramoLink && hasSubtramoCandidates) {
    next.resolution_source = "subtramos_detectados_sin_resolucion_geom";
    next.coverage_status = "partial";
    next.coverage_reason = "missing_structural_join_from_subtramos";
    return next;
  }

  if (!hasDirectTramoLink && !hasSubtramoCandidates) {
    next.resolution_source = "sin_cobertura";
    next.coverage_status = "none";
    next.coverage_reason = "no_vial_links";
    return next;
  }

  next.resolution_source = "sin_cobertura";
  next.coverage_status = "none";
  next.coverage_reason = "direct_tramo_without_overlay";
  return next;
}

async function resolveProyectoToVialOverlayScope({
  idProyecto,
  idProyectoTramo = null,
  idProyectoSubtramo = null,
  db = pool,
}) {
  const proyectoId = toPositiveInt(idProyecto);
  const tramoId = toPositiveInt(idProyectoTramo);
  const subtramoId = toPositiveInt(idProyectoSubtramo);

  if (!proyectoId) {
    const err = new Error("idProyecto invalido");
    err.statusCode = 400;
    throw err;
  }

  const resolution = emptyResolution({
    idProyecto: proyectoId,
    idProyectoTramo: tramoId,
    idProyectoSubtramo: subtramoId,
  });

  if (subtramoId) {
    const subtramo = await proyectoJerarquiaModel.getProyectoSubtramoById(proyectoId, subtramoId, db);
    if (!subtramo) {
      const err = new Error("Subtramo del proyecto no encontrado");
      err.statusCode = 404;
      throw err;
    }

    resolution.resolution_mode = "direct_subtramo";
    resolution.resolved_project_subtramo_ids = [Number(subtramo.id_proyecto_subtramo)];
    resolution.resolved_project_tramo_ids = [Number(subtramo.id_proyecto_tramo)];
    resolution.resolved_vial_subtramo_ids = toSortedNumeric([subtramo.id_vial_subtramo]);
    resolution.resolved_vial_tramo_ids = toSortedNumeric([subtramo.id_vial_tramo]);
    resolution.has_direct_tramo_link = resolution.resolved_vial_tramo_ids.length > 0;
    resolution.has_subtramo_candidates = resolution.resolved_vial_subtramo_ids.length > 0;

    if (!resolution.resolved_vial_subtramo_ids.length) {
      resolution.warnings.push("Subtramo sin id_vial_subtramo directo.");
    }
    if (!resolution.resolved_vial_tramo_ids.length) {
      resolution.warnings.push("Subtramo sin id_vial_tramo padre resoluble.");
    }

    return resolution;
  }

  if (tramoId) {
    const tramo = await proyectoJerarquiaModel.getProyectoTramoById(proyectoId, tramoId, db);
    if (!tramo) {
      const err = new Error("Tramo del proyecto no encontrado");
      err.statusCode = 404;
      throw err;
    }

    resolution.resolved_project_tramo_ids = [Number(tramo.id_proyecto_tramo)];

    const directVialTramoIds = toSortedNumeric([tramo.id_vial_tramo]);
    if (directVialTramoIds.length) {
      resolution.resolution_mode = "direct_tramo";
      resolution.resolved_vial_tramo_ids = directVialTramoIds;
      resolution.has_direct_tramo_link = true;
      return resolution;
    }

    const subtramos = await proyectoJerarquiaModel.getProyectoSubtramosByTramoId(proyectoId, tramoId, db);
    const vialSubtramoIds = toSortedNumeric(subtramos.map((row) => row.id_vial_subtramo));

    resolution.resolved_project_subtramo_ids = toSortedNumeric(
      subtramos.map((row) => row.id_proyecto_subtramo)
    );
    resolution.resolved_vial_subtramo_ids = vialSubtramoIds;
    resolution.resolved_vial_tramo_ids = [];
    resolution.has_direct_tramo_link = false;
    resolution.has_subtramo_candidates = vialSubtramoIds.length > 0;

    if (vialSubtramoIds.length) {
      resolution.resolution_mode = "subtramos_detected_without_structural_overlay";
      resolution.warnings.push(
        "Tramo sin id_vial_tramo directo; se detectaron subtramos viales, pero no existe resolucion geometrica estructural."
      );
    } else {
      resolution.resolution_mode = "no_structural_coverage";
      resolution.warnings.push(
        "Tramo sin id_vial_tramo directo y sin subtramos con id_vial_subtramo."
      );
    }

    return resolution;
  }

  return resolution;
}

function buildFeatureCollection(rows, mapRowToFeature) {
  return {
    type: "FeatureCollection",
    features: (rows || []).map(mapRowToFeature).filter(Boolean),
  };
}

function parseGeoJson(geometry) {
  if (!geometry || typeof geometry !== "string") return null;
  try {
    return JSON.parse(geometry);
  } catch {
    return null;
  }
}

async function queryBloquesTramoRows({ proyectoId = null, tramoIds = [], db = pool }) {
  const candidateTramoIds = toSortedNumeric(tramoIds);
  if (proyectoId) {
    const result = await db.query(
      `SELECT gid, id_tramo, tramo_nombre, tramo_desc, id_proyecto,
              ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), 4326)) AS geometry
         FROM ema.bloques_tramo
        WHERE id_proyecto = $1
          AND geom IS NOT NULL
          ${candidateTramoIds.length ? "AND id_tramo = ANY($2::int[])" : ""}
        ORDER BY id_tramo ASC, gid ASC`,
      candidateTramoIds.length ? [proyectoId, candidateTramoIds] : [proyectoId]
    );
    return result.rows;
  }

  if (!candidateTramoIds.length) return [];

  const result = await db.query(
    `SELECT gid, id_tramo, tramo_nombre, tramo_desc, id_proyecto,
            ST_AsGeoJSON(ST_Transform(ST_MakeValid(geom), 4326)) AS geometry
       FROM ema.bloques_tramo
      WHERE id_tramo = ANY($1::int[])
        AND geom IS NOT NULL
      ORDER BY id_tramo ASC, id_proyecto ASC, gid ASC`,
    [candidateTramoIds]
  );
  return result.rows;
}

async function fetchOverlayTramosByResolution({ idProyecto, resolution, db = pool }) {
  const proyectoId = toPositiveInt(idProyecto);
  const vialTramoIds = toSortedNumeric(resolution?.resolved_vial_tramo_ids);
  const skipProjectFilter = resolution?.skip_project_filter === true;

  if (!proyectoId) {
    const err = new Error("idProyecto invalido");
    err.statusCode = 400;
    throw err;
  }

  let rows = [];
  let scopeMode = "project_full";

  if (resolution?.resolution_mode === "project") {
    rows = await queryBloquesTramoRows({ proyectoId, db });
  } else if (vialTramoIds.length) {
    scopeMode = skipProjectFilter ? "global_tramo_match" : "filtered_vial_tramos";
    rows = await queryBloquesTramoRows({
      proyectoId: skipProjectFilter ? null : proyectoId,
      tramoIds: vialTramoIds,
      db,
    });
  } else {
    scopeMode = "empty_no_structural_match";
  }

  return {
    scope_mode: scopeMode,
    feature_collection: buildFeatureCollection(rows, (row) => {
      const geometry = parseGeoJson(row.geometry);
      if (!geometry) return null;
      return {
        type: "Feature",
        geometry,
        properties: {
          gid: row.gid,
          id_tramo: row.id_tramo,
          id_proyecto: row.id_proyecto,
          tramo_nombre: row.tramo_nombre,
          tramo_desc: row.tramo_desc,
        },
      };
    }),
  };
}

async function fetchOverlayProgresivasByResolution({ idProyecto, resolution, db = pool }) {
  const proyectoId = toPositiveInt(idProyecto);
  if (!proyectoId) {
    const err = new Error("idProyecto invalido");
    err.statusCode = 400;
    throw err;
  }

  if (resolution?.resolution_mode !== "project") {
    return {
      scope_mode: "unresolved_filtered_scope",
      structural_filter_supported: false,
      feature_collection: { type: "FeatureCollection", features: [] },
      warning:
        "No existe en este backend una relacion estructural confirmada entre bloques_progresivas y el scope vial filtrado.",
    };
  }

  const { rows } = await db.query(
    `SELECT
       id_bloque,
       id,
       name,
       descripcion,
       id_proyecto,
       ST_AsGeoJSON(
         ST_Transform(
           ST_PointOnSurface(ST_MakeValid(geom)),
           4326
         )
       ) AS geometry
     FROM ema.bloques_progresivas
     WHERE id_proyecto = $1
       AND geom IS NOT NULL
     ORDER BY id_bloque ASC`,
    [proyectoId]
  );

  return {
    scope_mode: "project_full",
    structural_filter_supported: true,
    feature_collection: buildFeatureCollection(rows, (row) => {
      const geometry = parseGeoJson(row.geometry);
      if (!geometry) return null;
      return {
        type: "Feature",
        geometry,
        properties: {
          id_bloque: row.id_bloque,
          id: row.id,
          name: row.name,
          descripcion: row.descripcion,
          id_proyecto: row.id_proyecto,
        },
      };
    }),
  };
}

module.exports = {
  resolveProyectoToVialOverlayScope,
  fetchOverlayTramosByResolution,
  fetchOverlayProgresivasByResolution,
  finalizeResolutionCoverage,
};
