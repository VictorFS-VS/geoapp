"use strict";

const express = require("express");
const router = express.Router();
const pool = require("../db");

const { verifyToken } = require("../middlewares/auth.middleware");
const { requirePerm } = require("../middlewares/requirePerm");

const shpwrite = require("shp-write"); // ZIP con SHP/DBF/SHX

router.use(verifyToken);

/* ================================
   UTILS
================================ */
function xmlEscape(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(s = "") {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* =========================================================
   KML
   POST /api/export/kml/geojson
========================================================= */
router.post(
  "/kml/geojson",
  requirePerm("export.read"),
  async (req, res) => {
    try {
      const fc = req.body?.featureCollection || req.body;
      const docName = xmlEscape(req.body?.name || "Export NDVI");

      if (!fc || !Array.isArray(fc.features)) {
        return res.status(400).json({ message: "FeatureCollection inválido" });
      }

      const raw = fc.features.filter(
        (f) =>
          f &&
          f.geometry &&
          ["Polygon", "MultiPolygon"].includes(f.geometry.type)
      );

      if (!raw.length) {
        return res
          .status(400)
          .json({ message: "No hay geometrías válidas" });
      }

      const { rows } = await pool.query(
        `
        WITH feats AS (
          SELECT
            row_number() OVER () AS idx,
            ST_SetSRID(ST_GeomFromGeoJSON((f->'geometry')::text), 4326) AS geom,
            (f->'properties')::jsonb AS props
          FROM jsonb_array_elements($1::jsonb->'features') AS f
        )
        SELECT
          idx,
          ST_AsKML(geom) AS kml_geom,
          props,
          COALESCE(
            NULLIF((props->>'area_ha')::numeric, NULL),
            ST_Area(geography(geom))/10000.0
          ) AS area_ha_calc
        FROM feats
        `,
        [{ type: "FeatureCollection", features: raw }]
      );

      const placemarks = rows
        .map((r) => {
          const props = r.props || {};
          const areaHa = Number(r.area_ha_calc || 0);
          const pName = xmlEscape(
            props.name || `Cambio ${r.idx} (${areaHa.toFixed(2)} ha)`
          );

          return `
          <Placemark>
            <name>${pName}</name>
            ${r.kml_geom}
          </Placemark>`;
        })
        .join("\n");

      const kml = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <name>${docName}</name>
          ${placemarks}
        </Document>
      </kml>`;

      const fileName = `ndvi-${slugify(docName)}_${nowStamp()}.kml`;

      res.setHeader(
        "Content-Type",
        "application/vnd.google-earth.kml+xml; charset=UTF-8"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      res.status(200).send(kml);
    } catch (err) {
      console.error("Error export KML:", err);
      res.status(500).json({ message: "Error al generar KML" });
    }
  }
);

/* =========================================================
   GEOJSON
========================================================= */
router.post(
  "/geojson",
  requirePerm("export.read"),
  async (req, res) => {
    try {
      const fc = req.body?.featureCollection || req.body;

      if (!fc || !Array.isArray(fc.features)) {
        return res.status(400).json({ message: "FeatureCollection inválido" });
      }

      const clean = {
        type: "FeatureCollection",
        features: fc.features.filter(
          (f) =>
            f &&
            f.geometry &&
            ["Polygon", "MultiPolygon"].includes(f.geometry.type)
        ),
      };

      const fileName = `export_${nowStamp()}.geojson`;

      res.setHeader("Content-Type", "application/geo+json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      res.status(200).send(JSON.stringify(clean));
    } catch (e) {
      console.error("Error export GeoJSON:", e);
      res.status(500).json({ message: "Error al generar GeoJSON" });
    }
  }
);

/* =========================================================
   SHAPEFILE
========================================================= */
router.post(
  "/shapefile",
  requirePerm("export.shapefile"),
  async (req, res) => {
    try {
      const fc = req.body?.featureCollection || req.body;

      if (!fc || !Array.isArray(fc.features)) {
        return res.status(400).json({ message: "FeatureCollection inválido" });
      }

      const safeFeatures = fc.features.filter(
        (f) =>
          f &&
          f.geometry &&
          ["Polygon", "MultiPolygon"].includes(f.geometry.type)
      );

      if (!safeFeatures.length) {
        return res.status(400).json({ message: "No hay geometrías válidas" });
      }

      const outFC = {
        type: "FeatureCollection",
        features: safeFeatures,
      };

      const zipAB = shpwrite.download(outFC, {}, true);

      const buffer =
        zipAB instanceof ArrayBuffer
          ? Buffer.from(zipAB)
          : Buffer.from(await zipAB.arrayBuffer());

      const fileName = `export_${nowStamp()}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      res.status(200).send(buffer);
    } catch (e) {
      console.error("Error export SHP:", e);
      res.status(500).json({ message: "Error al generar Shapefile" });
    }
  }
);

module.exports = router;
