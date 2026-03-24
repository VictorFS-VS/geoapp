"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_OSGEO4W_ROOT = "C:\\OSGeo4W64";
const DEFAULT_OSGEO4W_BIN = path.join(DEFAULT_OSGEO4W_ROOT, "bin");
const DEFAULT_PROJ_DATA = path.join(DEFAULT_OSGEO4W_ROOT, "share", "proj");
const DEFAULT_GDAL_DATA = path.join(DEFAULT_OSGEO4W_ROOT, "apps", "gdal", "share", "gdal");

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function normalizePathForCompare(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function deleteEnvKeysByPrefix(targetEnv, prefixes) {
  const upperPrefixes = (prefixes || []).map((prefix) => String(prefix || "").toUpperCase());
  for (const key of Object.keys(targetEnv || {})) {
    const upperKey = String(key || "").toUpperCase();
    if (upperPrefixes.some((prefix) => upperKey.startsWith(prefix))) {
      delete targetEnv[key];
    }
  }
}

function prependPathEntry(currentPath, entry) {
  const normalizedEntry = String(entry || "").trim();
  if (!normalizedEntry) return currentPath || "";
  const parts = String(currentPath || "")
    .split(";")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const filtered = parts.filter((part) => normalizePathForCompare(part) !== normalizePathForCompare(normalizedEntry));
  return [normalizedEntry, ...filtered].join(";");
}

function isCommandUnderRoot(command, rootDir) {
  if (!command || !rootDir || !path.isAbsolute(command)) return false;
  const commandNorm = normalizePathForCompare(command);
  const rootNorm = normalizePathForCompare(rootDir);
  return commandNorm === rootNorm || commandNorm.startsWith(`${rootNorm}\\`);
}

function getConfiguredOsgeoRoot() {
  return firstNonEmpty(process.env.OSGEO4W_ROOT, process.env.OSGEO_ROOT, DEFAULT_OSGEO4W_ROOT);
}

function getConfiguredGdalBinDir() {
  return firstNonEmpty(process.env.GDAL_BIN, path.join(getConfiguredOsgeoRoot(), "bin"), DEFAULT_OSGEO4W_BIN);
}

function getConfiguredProjData() {
  return firstNonEmpty(process.env.PROJ_DATA, process.env.PROJ_LIB, path.join(getConfiguredOsgeoRoot(), "share", "proj"), DEFAULT_PROJ_DATA);
}

function getConfiguredGdalData() {
  return firstNonEmpty(process.env.GDAL_DATA, path.join(getConfiguredOsgeoRoot(), "share", "gdal"), DEFAULT_GDAL_DATA);
}

function applyGdalProcessEnv(targetEnv = process.env) {
  const projData = getConfiguredProjData();
  const gdalData = getConfiguredGdalData();
  targetEnv.PROJ_DATA = firstNonEmpty(targetEnv.PROJ_DATA, projData);
  targetEnv.PROJ_LIB = firstNonEmpty(targetEnv.PROJ_LIB, targetEnv.PROJ_DATA, projData);
  targetEnv.GDAL_DATA = firstNonEmpty(targetEnv.GDAL_DATA, gdalData);
  targetEnv.PROJ_NETWORK = firstNonEmpty(targetEnv.PROJ_NETWORK, "OFF");
  targetEnv.PROJ_DATABASE_PATH = firstNonEmpty(
    targetEnv.PROJ_DATABASE_PATH,
    path.join(targetEnv.PROJ_DATA || projData, "proj.db")
  );
  return targetEnv;
}

function applyCoherentRuntimeEnv(targetEnv, rootDir) {
  const runtimeRoot = path.resolve(String(rootDir || DEFAULT_OSGEO4W_ROOT));
  deleteEnvKeysByPrefix(targetEnv, ["PROJ", "GDAL"]);
  const projData = path.join(runtimeRoot, "share", "proj");
  const gdalData = path.join(runtimeRoot, "apps", "gdal", "share", "gdal");
  targetEnv.PROJ_DATA = projData;
  targetEnv.PROJ_LIB = projData;
  targetEnv.GDAL_DATA = gdalData;
  targetEnv.PROJ_DATABASE_PATH = path.join(projData, "proj.db");
  targetEnv.PROJ_NETWORK = "OFF";
  return targetEnv;
}

function envVarNameForTool(tool) {
  const normalized = String(tool || "").trim().toUpperCase();
  if (!normalized) return "";
  return `${normalized}_PATH`;
}

function toolExecutableName(tool) {
  const normalized = String(tool || "").trim();
  if (!normalized) return "";
  return process.platform === "win32" && !normalized.toLowerCase().endsWith(".exe")
    ? `${normalized}.exe`
    : normalized;
}

function resolveGdalBinary(tool) {
  const normalized = String(tool || "").trim();
  if (!normalized) {
    throw new Error("Herramienta GDAL/OGR no especificada.");
  }

  const explicitPath = firstNonEmpty(process.env[envVarNameForTool(normalized)]);
  const osgeoRoot = getConfiguredOsgeoRoot();
  const gdalBinDir = getConfiguredGdalBinDir();
  const executableName = toolExecutableName(normalized);

  const candidates = [
    explicitPath,
    gdalBinDir ? path.join(gdalBinDir, executableName) : "",
    osgeoRoot ? path.join(osgeoRoot, "bin", executableName) : "",
    path.join(DEFAULT_OSGEO4W_BIN, executableName),
    normalized,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      return { command: candidate, attemptedCandidates: candidates };
    }
    if (fs.existsSync(candidate)) {
      return { command: candidate, attemptedCandidates: candidates };
    }
  }

  return { command: normalized, attemptedCandidates: candidates };
}

function buildGdalSpawnEnv(baseEnv = process.env, resolvedCommand = "") {
  const env = { ...baseEnv };
  const configuredRoot = getConfiguredOsgeoRoot();
  let binDir = getConfiguredGdalBinDir();
  if (isCommandUnderRoot(resolvedCommand, configuredRoot)) {
    applyCoherentRuntimeEnv(env, configuredRoot);
    binDir = path.join(path.resolve(String(configuredRoot || DEFAULT_OSGEO4W_ROOT)), "bin");
  } else if (isCommandUnderRoot(resolvedCommand, DEFAULT_OSGEO4W_ROOT)) {
    applyCoherentRuntimeEnv(env, DEFAULT_OSGEO4W_ROOT);
    binDir = DEFAULT_OSGEO4W_BIN;
  } else {
    applyGdalProcessEnv(env);
  }

  if (binDir) {
    env.PATH = prependPathEntry(env.PATH || env.Path || "", binDir);
  }
  return env;
}

function createGdalSpawnError(error, tool, resolved) {
  const attemptedPath = resolved?.command || String(tool || "");
  const err = new Error(`GDAL/OGR no está instalado o no es accesible en el servidor (${attemptedPath}).`);
  err.code = error?.code || "GDAL_SPAWN_ERROR";
  err.statusCode = 500;
  err.tool = tool;
  err.attemptedPath = attemptedPath;
  err.attemptedCandidates = resolved?.attemptedCandidates || [];
  err.cause = error;
  return err;
}

function isGdalSpawnError(error) {
  return Boolean(
    error &&
      (error.code === "ENOENT" ||
        error.code === "GDAL_SPAWN_ERROR" ||
        (error.statusCode === 500 && error.tool && error.attemptedPath))
  );
}

function spawnGdal(tool, args = [], options = {}) {
  const resolved = resolveGdalBinary(tool);
  const env = buildGdalSpawnEnv(options.env || process.env, resolved.command);
  const pathPreview = String(env.PATH || env.Path || "")
    .split(";")
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  console.info("[gdal] spawn", {
    tool,
    command: resolved.command,
    PROJ_DATA: env.PROJ_DATA || "",
    PROJ_LIB: env.PROJ_LIB || "",
    GDAL_DATA: env.GDAL_DATA || "",
    PROJ_DATABASE_PATH: env.PROJ_DATABASE_PATH || "",
    PATH_HEAD: pathPreview,
  });
  const child = spawn(resolved.command, args, {
    windowsHide: true,
    ...options,
    env,
  });
  child.__gdal = {
    tool,
    command: resolved.command,
    attemptedCandidates: resolved.attemptedCandidates,
  };
  return child;
}

function attachGdalSpawnError(child, reject) {
  if (!child || typeof child.once !== "function") return;
  child.once("error", (error) => {
    reject(createGdalSpawnError(error, child.__gdal?.tool, child.__gdal));
  });
}

function checkGdalBinary(tool = "ogr2ogr") {
  const resolved = resolveGdalBinary(tool);
  const result = spawnSync(resolved.command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    env: buildGdalSpawnEnv(process.env, resolved.command),
  });

  if (result.error) {
    return {
      ok: false,
      tool,
      command: resolved.command,
      attemptedCandidates: resolved.attemptedCandidates,
      error: createGdalSpawnError(result.error, tool, resolved),
    };
  }

  return {
    ok: result.status === 0,
    tool,
    command: resolved.command,
    attemptedCandidates: resolved.attemptedCandidates,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

module.exports = {
  DEFAULT_OSGEO4W_ROOT,
  applyGdalProcessEnv,
  attachGdalSpawnError,
  buildGdalSpawnEnv,
  checkGdalBinary,
  createGdalSpawnError,
  DEFAULT_GDAL_DATA,
  getConfiguredGdalBinDir,
  getConfiguredGdalData,
  getConfiguredOsgeoRoot,
  getConfiguredProjData,
  isGdalSpawnError,
  resolveGdalBinary,
  spawnGdal,
};
