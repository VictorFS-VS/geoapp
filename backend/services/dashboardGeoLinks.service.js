"use strict";

const pool = require("../db");

function toSafeString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeTramoValue(value) {
  const raw = toSafeString(value);
  if (!raw) return null;
  let s = stripDiacritics(raw).toUpperCase();
  s = s.replace(/\bSUB\s*TRAMO\b/g, "");
  s = s.replace(/\bSUBTRAMO\b/g, "");
  s = s.replace(/\bTRAMO\b/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[_\-./\\]+/g, "");
  return s || null;
}

function normalizeSubtramoValue(value) {
  const raw = toSafeString(value);
  if (!raw) return null;
  let s = stripDiacritics(raw).toUpperCase();
  s = s.replace(/\bSUB\s*TRAMO\b/g, "");
  s = s.replace(/\bSUBTRAMO\b/g, "");
  s = s.replace(/\bTRAMO\b/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[_\-./\\]+/g, "");
  return s || null;
}

function normalizeProgresivaValue(value) {
  const raw = toSafeString(value);
  if (!raw) return null;
  let s = stripDiacritics(raw).toUpperCase();
  s = s.replace(/\bPROGRESIVA\b/g, "");
  s = s.replace(/\bPROG\b/g, "");
  s = s.replace(/\bPK\b/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[_/\\]+/g, "");
  if (!s) return null;

  const plusMatch = s.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return `${plusMatch[1]}+${plusMatch[2]}`;
  }

  const sepMatch = s.match(/(\d+)[\.,\s]+(\d+)/);
  if (sepMatch) {
    return `${sepMatch[1]}+${sepMatch[2]}`;
  }

  s = s.replace(/[-.]+/g, "");
  return s || null;
}

function emptyDim() {
  return {
    source_kind: null,
    source_ref: null,
    source_value: null,
    matched: false,
    match_mode: "none",
    resolved_id: null,
    resolved_aux_id: null,
    label: null,
    normalized_value: null,
  };
}

function buildEmptyLinkageResult(options = {}) {
  const overrides = options || {};
  const linkage = {
    tramo: { ...emptyDim(), ...(overrides.tramo || {}) },
    progresiva: { ...emptyDim(), ...(overrides.progresiva || {}) },
    subtramo: { ...emptyDim(), ...(overrides.subtramo || {}) },
  };

  const hasAnyMatch =
    !!linkage.tramo.matched || !!linkage.progresiva.matched || !!linkage.subtramo.matched;

  const meta = {
    source_type: overrides?.meta?.source_type ?? null,
    resolver_version: overrides?.meta?.resolver_version ?? "gva_tramos_v1",
    has_any_match: overrides?.meta?.has_any_match ?? hasAnyMatch,
  };

  return { linkage, meta };
}

function addIndex(map, key, id) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, id);
    return;
  }
  const prev = map.get(key);
  if (prev === null) return;
  if (String(prev) !== String(id)) {
    map.set(key, null);
  }
}

async function buildTramoCatalog({ idProyecto, db }) {
  const conn = db || pool;
  const { rows } = await conn.query(
    `
    SELECT id_tramo, nombre_tramo, ubicacion
    FROM ema.tramos
    WHERE id_proyecto = $1
    ORDER BY id_tramo ASC
    `,
    [idProyecto]
  );

  const byId = new Map();
  const byNormName = new Map();
  const byNormAlt = new Map();
  const entries = new Map();

  for (const r of rows || []) {
    const id = Number(r.id_tramo);
    if (!id) continue;
    const nombre = toSafeString(r.nombre_tramo);
    const ubicacion = toSafeString(r.ubicacion);
    const label = nombre || ubicacion || `Tramo ${id}`;

    entries.set(String(id), { id, nombre, ubicacion, label });
    byId.set(String(id), String(id));

    const normName = normalizeTramoValue(nombre);
    addIndex(byNormName, normName, String(id));

    const normAlt = normalizeTramoValue(ubicacion);
    addIndex(byNormAlt, normAlt, String(id));
  }

  return { byId, byNormName, byNormAlt, entries };
}

async function buildProgresivaCatalog({ idProyecto, db }) {
  const conn = db || pool;
  const { rows } = await conn.query(
    `
    SELECT id_bloque, id, name, descripcion
    FROM ema.bloques_progresivas
    WHERE id_proyecto = $1
    ORDER BY id_bloque ASC
    `,
    [idProyecto]
  );

  const byId = new Map();
  const byNormName = new Map();
  const byNormAlt = new Map();
  const entries = new Map();

  for (const r of rows || []) {
    const idBloque = Number(r.id_bloque);
    if (!idBloque) continue;
    const auxId = r.id != null ? String(r.id).trim() : null;
    const name = toSafeString(r.name);
    const descripcion = toSafeString(r.descripcion);
    const label = name || descripcion || `Progresiva ${idBloque}`;

    entries.set(String(idBloque), {
      id: String(idBloque),
      auxId,
      name,
      descripcion,
      label,
    });
    byId.set(String(idBloque), String(idBloque));

    if (auxId) {
      addIndex(byNormAlt, normalizeProgresivaValue(auxId), String(idBloque));
    }

    addIndex(byNormName, normalizeProgresivaValue(name), String(idBloque));
    addIndex(byNormAlt, normalizeProgresivaValue(descripcion), String(idBloque));
  }

  return { byId, byNormName, byNormAlt, entries };
}

async function buildSubtramoCatalog({ idProyecto, db }) {
  const conn = db || pool;
  const { rows } = await conn.query(
    `
    SELECT
      st.id_proyecto_subtramo,
      st.id_proyecto_tramo,
      st.descripcion,
      st.id_vial_subtramo
    FROM ema.proyecto_subtramos st
    JOIN ema.proyecto_tramos t ON t.id_proyecto_tramo = st.id_proyecto_tramo
    WHERE t.id_proyecto = $1
    ORDER BY st.id_proyecto_subtramo ASC
    `,
    [idProyecto]
  );

  const byId = new Map();
  const byNormName = new Map();
  const byNormAlt = new Map();
  const entries = new Map();

  for (const r of rows || []) {
    const id = Number(r.id_proyecto_subtramo);
    if (!id) continue;
    const descripcion = toSafeString(r.descripcion);
    const idVial = r.id_vial_subtramo != null ? String(r.id_vial_subtramo).trim() : null;
    const label = descripcion || `Subtramo ${id}`;

    entries.set(String(id), {
      id: String(id),
      idTramo: r.id_proyecto_tramo != null ? String(r.id_proyecto_tramo) : null,
      descripcion,
      idVial,
      label,
    });
    byId.set(String(id), String(id));

    addIndex(byNormName, normalizeSubtramoValue(descripcion), String(id));
    if (idVial) addIndex(byNormAlt, normalizeSubtramoValue(idVial), String(id));
  }

  return { byId, byNormName, byNormAlt, entries };
}

function matchFromCatalog({ rawValue, normalizedValue, catalog, labelKey = "label" }) {
  if (!rawValue && !normalizedValue) {
    return { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
  }

  const raw = toSafeString(rawValue);
  const norm = normalizedValue;

  if (raw && /^\d+$/.test(raw)) {
    const hit = catalog.byId.get(raw);
    if (hit) {
      const entry = catalog.entries.get(String(hit));
      return {
        matched: true,
        match_mode: "direct_id",
        resolved_id: String(hit),
        resolved_aux_id: null,
        label: entry?.[labelKey] || entry?.label || null,
      };
    }
  }

  if (norm) {
    const hit = catalog.byNormName.get(norm);
    if (hit && hit !== null) {
      const entry = catalog.entries.get(String(hit));
      return {
        matched: true,
        match_mode: "normalized_name",
        resolved_id: String(hit),
        resolved_aux_id: null,
        label: entry?.[labelKey] || entry?.label || null,
      };
    }

    const alt = catalog.byNormAlt.get(norm);
    if (alt && alt !== null) {
      const entry = catalog.entries.get(String(alt));
      return {
        matched: true,
        match_mode: "normalized_alt",
        resolved_id: String(alt),
        resolved_aux_id: null,
        label: entry?.[labelKey] || entry?.label || null,
      };
    }
  }

  return { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
}

function matchTramoValueToCatalog({ rawValue, normalizedValue, catalog }) {
  return matchFromCatalog({ rawValue, normalizedValue, catalog });
}

function matchSubtramoValueToCatalog({ rawValue, normalizedValue, catalog }) {
  return matchFromCatalog({ rawValue, normalizedValue, catalog });
}

function matchProgresivaValueToCatalog({ rawValue, normalizedValue, catalog }) {
  if (!rawValue && !normalizedValue) {
    return { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
  }

  const raw = toSafeString(rawValue);
  const norm = normalizedValue;

  if (raw && /^\d+$/.test(raw)) {
    const hit = catalog.byId.get(raw);
    if (hit) {
      const entry = catalog.entries.get(String(hit));
      return {
        matched: true,
        match_mode: "direct_id",
        resolved_id: String(hit),
        resolved_aux_id: entry?.auxId || null,
        label: entry?.label || null,
      };
    }
  }

  if (norm) {
    const hit = catalog.byNormName.get(norm);
    if (hit && hit !== null) {
      const entry = catalog.entries.get(String(hit));
      return {
        matched: true,
        match_mode: "normalized_name",
        resolved_id: String(hit),
        resolved_aux_id: entry?.auxId || null,
        label: entry?.label || null,
      };
    }
    const alt = catalog.byNormAlt.get(norm);
    if (alt && alt !== null) {
      const entry = catalog.entries.get(String(alt));
      return {
        matched: true,
        match_mode: "normalized_alt",
        resolved_id: String(alt),
        resolved_aux_id: entry?.auxId || null,
        label: entry?.label || null,
      };
    }
  }

  return { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
}

async function resolveInformesGeoLinks(params = {}) {
  const linkFields = params?.linkFields || {};
  const sourceValues = params?.sourceValues || {};
  const catalogs = params?.catalogs || null;
  const db = params?.db || pool;
  const idProyecto = params?.idProyecto || params?.id_proyecto || null;

  const tramoFieldId = linkFields?.tramo_field_id ?? null;
  const progresivaFieldId = linkFields?.progresiva_field_id ?? null;
  const subtramoFieldId = linkFields?.subtramo_field_id ?? null;

  const tramoRaw =
    tramoFieldId != null ? sourceValues?.[String(tramoFieldId)] ?? sourceValues?.[tramoFieldId] : null;
  const progRaw =
    progresivaFieldId != null
      ? sourceValues?.[String(progresivaFieldId)] ?? sourceValues?.[progresivaFieldId]
      : null;
  const subtramoRaw =
    subtramoFieldId != null
      ? sourceValues?.[String(subtramoFieldId)] ?? sourceValues?.[subtramoFieldId]
      : null;

  const tramoNorm = normalizeTramoValue(tramoRaw);
  const progNorm = normalizeProgresivaValue(progRaw);
  const subtramoNorm = normalizeSubtramoValue(subtramoRaw);

  const tramoCat =
    catalogs?.tramo || (idProyecto ? await buildTramoCatalog({ idProyecto, db }) : null);
  const progCat =
    catalogs?.progresiva || (idProyecto ? await buildProgresivaCatalog({ idProyecto, db }) : null);
  const subCat =
    catalogs?.subtramo || (idProyecto ? await buildSubtramoCatalog({ idProyecto, db }) : null);

  const tramoMatch =
    tramoCat && tramoNorm
      ? matchTramoValueToCatalog({ rawValue: tramoRaw, normalizedValue: tramoNorm, catalog: tramoCat })
      : { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
  const progMatch =
    progCat && progNorm
      ? matchProgresivaValueToCatalog({
          rawValue: progRaw,
          normalizedValue: progNorm,
          catalog: progCat,
        })
      : { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };
  const subMatch =
    subCat && subtramoNorm
      ? matchSubtramoValueToCatalog({
          rawValue: subtramoRaw,
          normalizedValue: subtramoNorm,
          catalog: subCat,
        })
      : { matched: false, match_mode: "none", resolved_id: null, resolved_aux_id: null, label: null };

  return buildEmptyLinkageResult({
    tramo: {
      source_kind: tramoFieldId != null ? "id_pregunta" : null,
      source_ref: tramoFieldId != null ? String(tramoFieldId) : null,
      source_value: toSafeString(tramoRaw),
      normalized_value: tramoNorm,
      ...tramoMatch,
    },
    progresiva: {
      source_kind: progresivaFieldId != null ? "id_pregunta" : null,
      source_ref: progresivaFieldId != null ? String(progresivaFieldId) : null,
      source_value: toSafeString(progRaw),
      normalized_value: progNorm,
      ...progMatch,
    },
    subtramo: {
      source_kind: subtramoFieldId != null ? "id_pregunta" : null,
      source_ref: subtramoFieldId != null ? String(subtramoFieldId) : null,
      source_value: toSafeString(subtramoRaw),
      normalized_value: subtramoNorm,
      ...subMatch,
    },
    meta: { source_type: "informes" },
  });
}

function resolveCatastroGeoLinks(params = {}) {
  const source = params?.sourceRecord || {};

  const tramoRaw =
    source?.id_tramo ?? source?.idTramo ?? source?.tramo ?? source?.TRAMO ?? null;
  const subtramoRaw =
    source?.id_sub_tramo ??
    source?.idSubTramo ??
    source?.subtramo ??
    source?.SUBTRAMO ??
    null;
  const progRaw =
    source?.progresiva ?? source?.PROGRESIVA ?? source?.pk ?? source?.PK ?? null;

  return buildEmptyLinkageResult({
    tramo: {
      source_kind: tramoRaw != null ? "record_field" : null,
      source_ref: tramoRaw != null ? "id_tramo" : null,
      source_value: toSafeString(tramoRaw),
      normalized_value: normalizeTramoValue(tramoRaw),
    },
    subtramo: {
      source_kind: subtramoRaw != null ? "record_field" : null,
      source_ref: subtramoRaw != null ? "id_sub_tramo" : null,
      source_value: toSafeString(subtramoRaw),
      normalized_value: normalizeSubtramoValue(subtramoRaw),
    },
    progresiva: {
      source_kind: progRaw != null ? "record_field" : null,
      source_ref: progRaw != null ? "progresiva" : null,
      source_value: toSafeString(progRaw),
      normalized_value: normalizeProgresivaValue(progRaw),
    },
    meta: { source_type: "catastro" },
  });
}

async function resolveDashboardGeoLinks(params = {}) {
  const sourceType = String(params?.sourceType || "").trim().toLowerCase();

  if (sourceType === "informes") {
    return resolveInformesGeoLinks(params);
  }
  if (sourceType === "catastro") {
    return resolveCatastroGeoLinks(params);
  }

  return buildEmptyLinkageResult({
    meta: { source_type: null },
  });
}

function collectResolvedIds(items = []) {
  const tramoIds = new Set();
  const progresivaIds = new Set();
  const subtramoIds = new Set();

  for (const it of items || []) {
    const l = it?.linkage || {};
    const t = l?.tramo?.resolved_id;
    const p = l?.progresiva?.resolved_id;
    const s = l?.subtramo?.resolved_id;
    if (t != null && String(t).trim() !== "") tramoIds.add(String(t));
    if (p != null && String(p).trim() !== "") progresivaIds.add(String(p));
    if (s != null && String(s).trim() !== "") subtramoIds.add(String(s));
  }

  const toSortedNumeric = (set) =>
    Array.from(set)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

  return {
    tramoIds: toSortedNumeric(tramoIds),
    progresivaIds: toSortedNumeric(progresivaIds),
    subtramoIds: toSortedNumeric(subtramoIds),
  };
}

async function buildInformesSubmapPayload({ idProyecto, items, db }) {
  const conn = db || pool;
  const { tramoIds, progresivaIds, subtramoIds } = collectResolvedIds(items);

  const tramos = [];
  if (tramoIds.length) {
    const { rows } = await conn.query(
      `
      SELECT id_tramo, id_proyecto, nombre_tramo, ubicacion
      FROM ema.tramos
      WHERE id_proyecto = $1
        AND id_tramo = ANY($2::int[])
      ORDER BY id_tramo ASC
      `,
      [idProyecto, tramoIds]
    );
    for (const r of rows || []) {
      tramos.push({
        id_tramo: Number(r.id_tramo),
        id_proyecto: Number(r.id_proyecto),
        label: toSafeString(r.nombre_tramo) || toSafeString(r.ubicacion) || `Tramo ${r.id_tramo}`,
      });
    }
  }

  const progresivas = [];
  if (progresivaIds.length) {
    const { rows } = await conn.query(
      `
      SELECT id_bloque, id, name, descripcion, id_proyecto
      FROM ema.bloques_progresivas
      WHERE id_proyecto = $1
        AND id_bloque = ANY($2::int[])
      ORDER BY id_bloque ASC
      `,
      [idProyecto, progresivaIds]
    );
    for (const r of rows || []) {
      const label = toSafeString(r.name) || toSafeString(r.descripcion) || `Progresiva ${r.id_bloque}`;
      progresivas.push({
        id_progresiva: Number(r.id_bloque),
        id_bloque: Number(r.id_bloque),
        id_proyecto: Number(r.id_proyecto),
        label,
      });
    }
  }

  const subtramos = [];
  if (subtramoIds.length) {
    const { rows } = await conn.query(
      `
      SELECT st.id_proyecto_subtramo, st.id_proyecto_tramo, st.descripcion, t.id_proyecto
      FROM ema.proyecto_subtramos st
      JOIN ema.proyecto_tramos t ON t.id_proyecto_tramo = st.id_proyecto_tramo
      WHERE t.id_proyecto = $1
        AND st.id_proyecto_subtramo = ANY($2::int[])
      ORDER BY st.id_proyecto_subtramo ASC
      `,
      [idProyecto, subtramoIds]
    );
    for (const r of rows || []) {
      subtramos.push({
        id_subtramo: Number(r.id_proyecto_subtramo),
        id_tramo: Number(r.id_proyecto_tramo),
        id_proyecto: Number(r.id_proyecto),
        label: toSafeString(r.descripcion) || `Subtramo ${r.id_proyecto_subtramo}`,
      });
    }
  }

  return {
    tramos,
    progresivas,
    subtramos,
    selection_summary: {
      tramo_ids: tramoIds,
      progresiva_ids: progresivaIds,
      subtramo_ids: subtramoIds,
    },
  };
}

module.exports = {
  resolveDashboardGeoLinks,
  resolveInformesGeoLinks,
  resolveCatastroGeoLinks,
  normalizeTramoValue,
  normalizeProgresivaValue,
  normalizeSubtramoValue,
  buildEmptyLinkageResult,
  buildTramoCatalog,
  buildProgresivaCatalog,
  buildSubtramoCatalog,
  matchTramoValueToCatalog,
  matchProgresivaValueToCatalog,
  matchSubtramoValueToCatalog,
  buildInformesSubmapPayload,
};
