"use strict";

function sumCounts(items) {
  let total = 0;
  for (const it of Array.isArray(items) ? items : []) {
    total += Number(it?.count) || 0;
  }
  return total;
}

function toKey(summary) {
  const id = Number(summary?.id_pregunta);
  if (Number.isFinite(id) && id > 0) return `id:${id}`;
  const label = String(summary?.etiqueta || "").trim().toLowerCase();
  return label ? `label:${label}` : `ref:${String(summary?.variable || summary?.pregunta || "")}`;
}

function withTotals(list) {
  return list
    .filter((s) => s)
    .filter((s) => Array.isArray(s.items) && s.items.length > 0)
    .map((s) => ({ ...s, __total: sumCounts(s.items) }))
    .filter((s) => s.__total > 0);
}

function sortByTotal(list) {
  return list.sort((a, b) => {
    if (b.__total !== a.__total) return b.__total - a.__total;
    return String(a.etiqueta || "").localeCompare(String(b.etiqueta || ""), "es");
  });
}

function stripTotal(list) {
  return list.map((c) => {
    const { __total, ...rest } = c;
    return rest;
  });
}

/**
 * EXEC 2.3 - KPI selector for Project Home.
 *
 * Selection rules (simple and defensive):
 * - candidates: summary_type === "counts", 2..10 distinct, non-empty items, total>0
 * - primary: prefer tipo === "semaforo", else max total
 * - secondary: next 2 by total, excluding primary
 */
function selectProjectHomeKpis(fieldSummaries) {
  const list = Array.isArray(fieldSummaries) ? fieldSummaries : [];

  const strictCandidates = withTotals(
    list
      .filter((s) => s && s.summary_type === "counts")
      .filter(
        (s) => (Number(s.distinct_count) || 0) > 1 && (Number(s.distinct_count) || 0) <= 10
      )
  );

  const relaxedCandidates = withTotals(
    list
      .filter((s) => s && s.summary_type === "counts")
      .filter((s) => (Number(s.distinct_count) || 0) > 1)
  );

  const broadCandidates = withTotals(
    list.filter((s) => s && (Number(s.distinct_count) || 0) > 1)
  );

  sortByTotal(strictCandidates);
  sortByTotal(relaxedCandidates);
  sortByTotal(broadCandidates);

  const semaforo =
    strictCandidates.find((c) => String(c.tipo || "").toLowerCase() === "semaforo") || null;
  const primary =
    semaforo || strictCandidates[0] || relaxedCandidates[0] || broadCandidates[0] || null;

  const seen = new Set();
  if (primary) seen.add(toKey(primary));

  const secondaryPool = [];
  const addFrom = (arr) => {
    for (const item of arr) {
      const key = toKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      secondaryPool.push(item);
      if (secondaryPool.length >= 2) return;
    }
  };

  addFrom(strictCandidates);
  addFrom(relaxedCandidates);
  addFrom(broadCandidates);

  const secondary = stripTotal(secondaryPool);

  if (primary) {
    return { primary: stripTotal([primary])[0], secondary };
  }

  return { primary: null, secondary: [] };
}

module.exports = { selectProjectHomeKpis };
