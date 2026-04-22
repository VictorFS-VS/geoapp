import React, { useEffect, useRef, useState } from "react";
import "ol/ol.css";
import { Map, View } from "ol";
import GeoJSON from "ol/format/GeoJSON";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { OSM } from "ol/source";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";

const API_URL = import.meta.env.VITE_API_URL;

export default function MapaProyecto({ id }) {
  const mapRef = useRef();
  const [map, setMap] = useState(null);
  const [usoActualLayer, setUsoActualLayer] = useState(null);
  const [usoAlternativoLayer, setUsoAlternativoLayer] = useState(null);

  useEffect(() => {
    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        stroke: new Stroke({ color: "#006400", width: 2 }),
        fill: new Fill({ color: "rgba(0, 100, 0, 0.3)" })
      }),
    });

    const mapInstance = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        vectorLayer
      ],
      view: new View({
        center: [0, 0],
        zoom: 2
      })
    });

    fetch(`${API_URL}/proyectos/geom/${id}`, {
      headers: { Authorization: "Bearer " + localStorage.getItem("token") }
    })
      .then(res => res.json())
      .then(data => {
        const features = new GeoJSON().readFeatures(data, {
          featureProjection: 'EPSG:3857'
        });
        vectorSource.addFeatures(features);
        mapInstance.getView().fit(vectorSource.getExtent(), { padding: [20, 20, 20, 20] });
      });

    setMap(mapInstance);
  }, [id]);

  const toggleUsoActual = () => {
    if (!map) return;

    if (usoActualLayer) {
      map.removeLayer(usoActualLayer);
      setUsoActualLayer(null);
    } else {
      const usoSource = new VectorSource();
      fetch(`${API_URL}/proyectos/uso-actual/${id}`, {
        headers: { Authorization: "Bearer " + localStorage.getItem("token") }
      })
        .then(res => res.json())
        .then(data => {
          const features = new GeoJSON().readFeatures(data, {
            featureProjection: 'EPSG:3857'
          });
          usoSource.addFeatures(features);

          const nuevaCapa = new VectorLayer({
            source: usoSource,
            style: new Style({
              stroke: new Stroke({ color: "#00008B", width: 1 }),
              fill: new Fill({ color: "rgba(0, 0, 139, 0.2)" })
            }),
          });

          map.addLayer(nuevaCapa);
          setUsoActualLayer(nuevaCapa);
        });
    }
  };

  const toggleUsoAlternativo = () => {
    if (!map) return;

    if (usoAlternativoLayer) {
      map.removeLayer(usoAlternativoLayer);
      setUsoAlternativoLayer(null);
    } else {
      const usoAltSource = new VectorSource();
      fetch(`${API_URL}/proyectos/uso-alternativo/${id}`, {
        headers: { Authorization: "Bearer " + localStorage.getItem("token") }
      })
        .then(res => res.json())
        .then(data => {
          const features = new GeoJSON().readFeatures(data, {
            featureProjection: 'EPSG:3857'
          });
          usoAltSource.addFeatures(features);

          const nuevaCapa = new VectorLayer({
            source: usoAltSource,
            style: new Style({
              stroke: new Stroke({ color: "#FFA500", width: 1 }),
              fill: new Fill({ color: "rgba(255, 165, 0, 0.3)" }) // naranja semitransparente
            }),
          });

          map.addLayer(nuevaCapa);
          setUsoAlternativoLayer(nuevaCapa);
        });
    }
  };

  return (
    <>
      <div ref={mapRef} style={{ width: "100%", height: "500px" }}></div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={toggleUsoActual}
          className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
        >
          {usoActualLayer ? "Ocultar USO_ACTUAL" : "Mostrar USO_ACTUAL"}
        </button>

        <button
          onClick={toggleUsoAlternativo}
          className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
        >
          {usoAlternativoLayer ? "Ocultar USO_ALTERNATIVO" : "Mostrar USO_ALTERNATIVO"}
        </button>
      </div>
    </>
  );
}
