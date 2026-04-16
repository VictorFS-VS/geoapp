// backend/index.js  ✅ UNIFICADO / ORDENADO + RBAC por requirePerm
// - Convención: routers montados como /api/<modulo>
// - EXCEPCIONES:
//   - poi.routes se monta en /api (porque define /poi/* y /poi-categorias/*)
//   - proxy.routes se monta en /api (porque define /proxy)
//   - useChange.routes se monta en /api (porque define /use-change/*)
// - /api/uploads y /uploads quedan públicos para <img> (sin Authorization)
// - /api/informe-kmz PÚBLICO (sin token) para Google Earth
//
// ✅ NUEVO: /api/expedientes montado correctamente

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");

const app = express();
const port = process.env.PORT || 4000;

/* ───────────────── Errores globales ───────────────── */
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

/* ───────────────── CORS ───────────────── */
const ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.use(
  cors({
    origin: ORIGINS.length ? ORIGINS : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.options("*", cors());

/* ───────────────── Parsers ───────────────── */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

/* ───────────────── Estáticos públicos ───────────────── */
const uploadsPath = path.join(__dirname, "uploads");
const staticOpts = {
  etag: false,
  setHeaders: (res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  },
};

// ✅ compatibilidad antigua
app.use("/uploads", express.static(uploadsPath, staticOpts));
// ✅ compatibilidad con frontend actual
app.use("/api/uploads", express.static(uploadsPath, staticOpts));

/* ───────────────── Healthcheck / favicon ───────────────── */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);
app.get("/favicon.ico", (_req, res) => res.status(204).end());

/* ───────────────── Rutas públicas (ANTES del guard) ───────────────── */
const authRoutes = require("./routes/auth.routes");
app.use("/api/auth", authRoutes);

// ✅ Informes públicos SIN token (share links)
const informesPublicRoutes = require("./routes/informes.public.routes");
app.use("/api/informes-public", informesPublicRoutes);

// ✅ Avatar público (ANTES del guard)
const { getAvatar } = require("./controllers/usuarios.controller");
app.get("/api/usuarios/:id/avatar", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  return getAvatar(req, res, next);
});

/* ───────────────── Guardia global: SOLO verifyToken ───────────────── */
const { verifyToken } = require("./middlewares/auth.middleware");

// Public routes (no auth) — explícitas
const PUBLIC_NOAUTH = [
  { method: "GET", rx: /^\/api\/health$/i },
  { method: "GET", rx: /^\/favicon\.ico$/i },

  // auth (permitir TODOS los métodos)
  { method: "*", rx: /^\/api\/auth\/?/i },

  // avatar público
  { method: "GET", rx: /^\/api\/usuarios\/\d+\/avatar(?:\?.*)?$/i },

  // Informes públicos (share links)
  { method: "GET", rx: /^\/api\/informes-public\/[a-f0-9]{32,128}(?:\?.*)?$/i },
  {
    method: "POST",
    rx: /^\/api\/informes-public\/[a-f0-9]{32,128}\/enviar(?:\?.*)?$/i,
  },

  // ✅ KMZ Informes PÚBLICO para Google Earth (sin JWT)
  {
    method: "GET",
    rx: /^\/api\/informe-kmz\/(informe\/\d+\/kmz|proyecto\/\d+\/kmz)(?:\?.*)?$/i,
  },
];

// util
function reqUrl(req) {
  return req.originalUrl || req.url || "";
}

function isPublic(req) {
  const url = reqUrl(req);
  return PUBLIC_NOAUTH.some(
    (r) => (r.method === "*" || r.method === req.method) && r.rx.test(url)
  );
}

/**
 * ✅ Rutas que NO deben pasar por verifyToken porque son estáticos públicos
 */
function bypassGuardsForStatic(req) {
  const url = reqUrl(req);
  return url.startsWith("/uploads/") || url.startsWith("/api/uploads/");
}

/**
 * Guardia:
 * - si es público -> next
 * - si es estático -> next
 * - si no -> verifyToken
 */
app.use((req, res, next) => {
  if (isPublic(req)) return next();
  if (bypassGuardsForStatic(req)) return next();
  return verifyToken(req, res, next);
});

/* ───────────────── express-fileupload (solo multipart) ───────────────── */
const tmpDir = process.env.EFU_TMP_DIR || "C:\\temp\\ema_uploads";
try {
  fs.mkdirSync(tmpDir, { recursive: true });
} catch (e) {
  console.warn("⚠️ No se pudo crear EFU tmpDir:", tmpDir, e?.message);
}

const efu = fileUpload({
  useTempFiles: true,
  tempFileDir: tmpDir,
  createParentPath: true,

  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB por archivo
    files: 200, // cantidad máxima de archivos por request
  },

  abortOnLimit: true,
  responseOnLimit: "Archivo demasiado grande o demasiados archivos.",

  safeFileNames: true,
  preserveExtension: true,
  uploadTimeout: 10 * 60 * 1000, // 10 min
});

// ⛔ Rutas a omitir de express-fileupload (multer u otras)
const RX_SKIP_EFU = /^\/api\/usuarios\/\d+\/avatar(?:\?.*)?$/i;

app.use((req, res, next) => {
  const url = reqUrl(req);

  if (req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (bypassGuardsForStatic(req)) return next();
  if (RX_SKIP_EFU.test(url)) return next();

  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("multipart/form-data")) return next();

  return efu(req, res, next);
});

/* ───────────────── GDAL check ───────────────── */
const { checkGdal } = require("./utils/checkGdal");
const okGdal = checkGdal();
console.log("GDAL check:", okGdal ? "OK" : "NO");

if (process.env.NODE_ENV === "production" && !okGdal) {
  console.error("❌ GDAL es requerido en producción. Abortando inicio del servidor.");
  process.exit(1);
}

/* ───────────────── Import de routers protegidos ───────────────── */
const proyectosRoutes = require("./routes/proyectos.routes");
const mantenimientoRoutes = require("./routes/mantenimiento.routes");
const documentosRoutes = require("./routes/documentos.routes");
const conceptosRoutes = require("./routes/conceptos.routes");

const resolucionesRoutes = require("./routes/resoluciones.routes");
const declaracionesRoutes = require("./routes/declaraciones.routes");
const pgaRoutes = require("./routes/pga.routes");
const evaluacionesRoutes = require("./routes/evaluaciones.routes");
const regenciaRoutes = require("./routes/regencia.routes");

const consultoresRoutes = require("./routes/consultores.routes");
const proponentesRoutes = require("./routes/proponentes.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const groupsRoutes = require("./routes/groups.routes");
const notificacionesRoutes = require("./routes/notificaciones.routes");

const tramosRoutes = require("./routes/tramos.routes");
const jerarquiaRoutes = require("./routes/proyecto_jerarquia.routes"); // ✅ Jerarquía Tramos/Subtramos
const encuestasRoutes = require("./routes/encuestas.routes");

const actasRoutes = require("./routes/actas.routes");
const exportRoutes = require("./routes/export.routes");
const quejasReclamosRoutes = require("./routes/quejas_reclamos.routes");

const informeKmzRoutes = require("./routes/informeKmz.routes");

// ✅ RBAC (nuevo)
const rbacRoutes = require("./routes/rbac.routes");

const proxyRoutes = require("./routes/proxy.routes");
const sentinelRoutes = require("./routes/sentinel.routes");
const { initSentinelTokenWarmup } = require("./controllers/sentinel.controller");

const pushCampaignRoutes = require("./routes/pushCampaigns.routes");
const reportesRoutes = require("./routes/reportes.routes");
const informesRoutes = require("./routes/informes.routes");
const compartirRoutes = require("./routes/compartir.routes");
const aiRoutes = require("./routes/ai.routes");

const informesDashboardRoutes = require("./routes/informesDashboard.routes");
const projectHomeRoutes = require("./routes/projectHome.routes");
const projectHomeConfigRoutes = require("./routes/projectHomeConfig.routes");
const projectHomeItemRoutes = require("./routes/projectHomeItem.routes");

const poiRoutes = require("./routes/poi.routes");

// ✅ EXPEDIENTES (NUEVO)
const expedientesRoutes = require("./routes/expedientes.routes");

// ✅ GV (NUEVO)
const gvRoutes = require("./gv/gv_routes");

// ⚠️ Elegí UNO: useChange.routes O changeuse.routes
let useChangeRoutes;
try {
  useChangeRoutes = require("./routes/useChange.routes");
  console.log("✅ CARGADO: ./routes/useChange.routes");
} catch (e1) {
  console.warn("⚠️ FALLÓ: ./routes/useChange.routes ->", e1?.message || e1);

  try {
    useChangeRoutes = require("./routes/changeuse.routes");
    console.log("✅ CARGADO (fallback): ./routes/changeuse.routes");
  } catch (e2) {
    console.error("❌ FALLÓ TAMBIÉN el fallback:", e2?.message || e2);
    process.exit(1);
  }
}

/* ───────────────── Mount protegidos (UNIFICADO) ───────────────── */
app.use("/api/proyectos", proyectosRoutes);

// ✅ EXPEDIENTES (NUEVO)
app.use("/api/expedientes", expedientesRoutes);

// ✅ GV (NUEVO)
app.use("/api/gv", gvRoutes);

app.use("/api/mantenimiento", mantenimientoRoutes);
app.use("/api/documentos", documentosRoutes);
app.use("/api/conceptos", conceptosRoutes);

app.use("/api/resoluciones", resolucionesRoutes);
app.use("/api/declaraciones", declaracionesRoutes);
app.use("/api/pga", pgaRoutes);
app.use("/api/evaluaciones", evaluacionesRoutes);
app.use("/api/regencia", regenciaRoutes);

app.use("/api/consultores", consultoresRoutes);
app.use("/api/proponentes", proponentesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/groups", groupsRoutes);
app.use("/api/notificaciones", notificacionesRoutes);

app.use("/api/tramos", tramosRoutes);
app.use("/api", jerarquiaRoutes); // ✅ Jerarquía Tramos/Subtramos + catálogo vial
app.use("/api/encuestas", encuestasRoutes);

app.use("/api/actas", actasRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/quejas-reclamos", quejasReclamosRoutes);

// ✅ Informe KMZ (público controlado por el guard PUBLIC_NOAUTH de arriba)
app.use("/api/informe-kmz", informeKmzRoutes);

// ✅ RBAC (nuevo)
app.use("/api/rbac", rbacRoutes);

// ✅ proxy.routes define "/proxy" -> se monta en /api para que quede /api/proxy
app.use("/api", proxyRoutes);

// ✅ sentinel.routes
app.use("/api/sentinel", sentinelRoutes);

app.use("/api/push-campaigns", pushCampaignRoutes);

app.use("/api/reportes", reportesRoutes);
app.use("/api/informes", informesRoutes);
app.use("/api/compartir", compartirRoutes);

app.use("/api/informes-dashboard", informesDashboardRoutes);
app.use("/api/project-home", projectHomeRoutes);
app.use("/api/project-home", projectHomeConfigRoutes);
app.use("/api/project-home", projectHomeItemRoutes);

app.use("/api/ai", aiRoutes);

// ✅ POI
app.use("/api", poiRoutes);

// ✅ Diagnostico / Scoring Engine
const diagnosticoRoutes = require("./routes/diagnostico.routes");
app.use("/api/diagnostico", diagnosticoRoutes);

// ✅ Use Change
app.use("/api", useChangeRoutes);

function printRoutes(app) {
  const routes = [];
  app._router?.stack?.forEach((m) => {
    if (!m.route) return;
    const methods = Object.keys(m.route.methods)
      .map((x) => x.toUpperCase())
      .join(",");
    routes.push({ methods, path: m.route.path });
  });
  console.log("=== ROUTES ===");
  routes
    .filter((r) => String(r.path).includes("use-change"))
    .forEach((r) => console.log(r.methods, r.path));
  console.log("==============");
}

printRoutes(app);

/* ───────────────── Jobs (cron) ───────────────── */
try {
  require("./jobs/scheduleResolucionNotifications.job");
  console.log("⏱️ Jobs (cron) cargados: scheduleResolucionNotifications.job.js");
} catch (e) {
  console.warn(
    "⚠️ No se pudo cargar jobs/scheduleResolucionNotifications.job.js:",
    e?.message || e
  );
}

/* ───────────────── 404 ───────────────── */
app.use((req, res) => {
  res.status(404).json({
    message: "Ruta no encontrada",
    who: "INDEX_UNIFICADO",
    method: req.method,
    url: req.originalUrl || req.url,
  });
});

/* ───────────────── Error handler ───────────────── */
app.use((err, req, res, _next) => {
  console.error("💥 ERROR GLOBAL:", err);
  res.status(500).json({ message: "Error interno del servidor" });
});

/* ───────────────── Server ───────────────── */
app.listen(port, "0.0.0.0", async () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
  try {
    await initSentinelTokenWarmup();
  } catch (e) {
    console.error("No se pudo inicializar Sentinel token:", e);
  }
});
