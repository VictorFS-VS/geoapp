"use strict";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STAGE_KEYS = {
  mejora: [
    "relevamiento",
    "documentacion",
    "plano_georef",
    "avaluo",
    "notif_conformidad",
    "documentacion_final",
  ],
  terreno: [
    "relevamiento",
    "documentacion",
    "plano_georef",
    "informe_pericial",
    "plantilla",
    "avaluo",
    "notif_conformidad",
    "documentacion_final",
  ],
};

function normalizeGranularity(value) {
  const v = String(value || "").toLowerCase().trim();
  if (v === "dia" || v === "day") return "dia";
  if (v === "semana" || v === "week") return "semana";
  if (v === "mes" || v === "month") return "mes";
  return "dia";
}

function toDateOrNull(raw) {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYmdUtc(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatDdMonUtc(d) {
  const dd = pad2(d.getUTCDate());
  const mon = MONTHS[d.getUTCMonth()];
  return `${dd} ${mon}`;
}

function formatMonYearUtc(d) {
  const mon = MONTHS[d.getUTCMonth()];
  return `${mon} ${d.getUTCFullYear()}`;
}

function getIsoWeekYear(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function getIsoWeekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function getBucketKey(rawDate, granularity) {
  const g = normalizeGranularity(granularity);
  const d = toDateOrNull(rawDate);
  if (!d) return null;

  if (g === "dia") return formatYmdUtc(d);

  if (g === "mes") {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
  }

  const { year, week } = getIsoWeekYear(d);
  return `${year}-W${pad2(week)}`;
}

function getBucketLabel(rawDate, granularity) {
  const g = normalizeGranularity(granularity);
  const d = toDateOrNull(rawDate);
  if (!d) return "";

  if (g === "dia") return formatDdMonUtc(d);

  if (g === "mes") return formatMonYearUtc(d);

  const start = getIsoWeekStart(d);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${formatDdMonUtc(start)} - ${formatDdMonUtc(end)}`;
}

function hasActiveStages(carpeta) {
  if (!carpeta || typeof carpeta !== "object") return false;
  return Object.values(carpeta).some((stage) => stage?.ok === true);
}

function inferTipoCarpeta(expediente) {
  const mejora = hasActiveStages(expediente?.carpeta_mejora);
  const terreno = hasActiveStages(expediente?.carpeta_terreno);

  if (mejora && !terreno) return "mejora";
  if (terreno && !mejora) return "terreno";
  if (mejora && terreno) return "legacy";
  return "sin_iniciar";
}

function getOrderedStageKeys(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  return STAGE_KEYS[t] ? [...STAGE_KEYS[t]] : [];
}

function humanizeStageKey(key) {
  const MAP = {
    relevamiento: "Relevamiento",
    documentacion: "Documentacion",
    plano_georef: "Plano georreferenciado",
    informe_pericial: "Informe pericial",
    plantilla: "Plantilla",
    avaluo: "Avaluo",
    notif_conformidad: "Notificacion y conformidad",
    documentacion_final: "Documentacion final",
  };
  if (MAP[key]) return MAP[key];
  return String(key || "")
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ")
    .trim();
}

module.exports = {
  normalizeGranularity,
  getBucketKey,
  getBucketLabel,
  inferTipoCarpeta,
  getOrderedStageKeys,
  humanizeStageKey,
};
