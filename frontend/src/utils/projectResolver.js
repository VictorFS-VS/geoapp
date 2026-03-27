function normalizeProjectId(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveProjectId({ params, query, context }) {
  const paramId = normalizeProjectId(params);
  if (paramId) return paramId;
  const queryId = normalizeProjectId(query);
  if (queryId) return queryId;
  const contextId = normalizeProjectId(context);
  return contextId;
}
