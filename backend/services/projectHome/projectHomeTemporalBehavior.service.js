"use strict";

const DEFAULT_TEMPORAL_BEHAVIOR = "historical";
const VALID_TEMPORAL_BEHAVIORS = new Set([
  DEFAULT_TEMPORAL_BEHAVIOR,
  "current_period",
  "rolling_future",
  "rolling_past",
]);

const behaviorOverrides = new Map([
  // Agrega entradas específicas aquí cuando sepas que un campo temporal debe usar un behavior distinto.
  // ["nombre_del_campo_o_id", "rolling_future"],
]);

function normalizeTemporalBehavior(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return VALID_TEMPORAL_BEHAVIORS.has(normalized) ? normalized : null;
}

function getTemporalBehaviorForFieldId(fieldId) {
  if (fieldId === undefined || fieldId === null) return DEFAULT_TEMPORAL_BEHAVIOR;
  const candidate = behaviorOverrides.get(String(fieldId));
  return normalizeTemporalBehavior(candidate) || DEFAULT_TEMPORAL_BEHAVIOR;
}

function resolveTemporalBehavior({ fieldId, temporalSources, explicitBehavior } = {}) {
  const overrideValue = normalizeTemporalBehavior(explicitBehavior);
  if (overrideValue) return overrideValue;

  const sources = Array.isArray(temporalSources) ? temporalSources : [];
  const match = sources.find((s) => String(s?.id) === String(fieldId));
  const fromMetadata = normalizeTemporalBehavior(match?.temporal_behavior);
  if (fromMetadata) return fromMetadata;

  return getTemporalBehaviorForFieldId(fieldId);
}

module.exports = {
  DEFAULT_TEMPORAL_BEHAVIOR,
  VALID_TEMPORAL_BEHAVIORS,
  normalizeTemporalBehavior,
  getTemporalBehaviorForFieldId,
  resolveTemporalBehavior,
};
