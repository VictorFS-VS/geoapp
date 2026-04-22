import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { obtenerGeojsonProyecto } from "../services/proyectosService";
import Map from "ol/Map";
import View from "ol/View";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer";
import { OSM } from "ol/source";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Style, Fill, Stroke } from "ol/style";
import Overlay from "ol/Overlay";
import XYZ from "ol/source/XYZ";
import "ol/ol.css";
import "../styles/visor.css";
import { Select, MenuItem, FormControl, InputLabel } from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function normalizarTexto(texto) {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export default function VisorProyecto() {
  const { id } = useParams();
  const [geojson, setGeojson] = useState(null);
  const [visible, setVisible] = useState(true);
  const [visibleUsoActual, setVisibleUsoActual] = useState(false);
  const [visibleUsoAlternativo, setVisibleUsoAlternativo] = useState(false);
  const [fechasDisponibles, setFechasDisponibles] = useState([]);
  const [fechaSeleccionada, setFechaSeleccionada] = useState("");
  const [vistaMapa, setVistaMapa] = useState("OSM");

  const mapRef = useRef();
  const mapInstance = useRef(null);
  const vectorLayerRef = useRef(null);
  const usoActualLayerRef = useRef(null);
  const usoAlternativoLayerRef = useRef(null);
  const popupRef = useRef();

  const osmLayerRef = useRef();
  const satLayerRef = useRef();

  useEffect(() => {
    obtenerGeojsonProyecto(id)
      .then(setGeojson)
      .catch(console.error);
  }, [id]);

  useEffect(() => {
    if (!mapRef.current) return;

    osmLayerRef.current = new TileLayer({ source: new OSM(), visible: true });
    satLayerRef.current = new TileLayer({
      source: new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      }),
      visible: false
    });

    mapInstance.current = new Map({
      target: mapRef.current,
      layers: [osmLayerRef.current, satLayerRef.current],
      view: new View({ center: [0, 0], zoom: 2 })
    });

    const overlay = new Overlay({
      element: popupRef.current,
      autoPan: true,
      autoPanAnimation: { duration: 250 }
    });

    mapInstance.current.addOverlay(overlay);

    mapInstance.current.on("singleclick", (evt) => {
      let featureFound = false;

      mapInstance.current.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        if (!feature || featureFound) return;

        const props = feature.getProperties();
        const layerId = layer?.get('id');

        overlay.setPosition(evt.coordinate);

        if (layerId === 'poligono_proyecto') {
          popupRef.current.innerHTML = `
            <div>
              <strong>Código:</strong> ${props.codigo || "N/D"}<br/>
              <strong>Nombre:</strong> ${props.nombre || "N/D"}<br/>
              <strong>Área (m²):</strong> ${props.area_m2?.toLocaleString() || "N/D"}<br/>
              <strong>Proponente:</strong> ${props.propietari || "N/D"}<br/>
              <strong>Departamento:</strong> ${props.dpto || "N/D"}<br/>
              <strong>Distrito:</strong> ${props.dist || "N/D"}
            </div>`;
        } else if (layerId === 'uso_actual') {
          popupRef.current.innerHTML = `
            <div>
              <strong><u>Uso Actual</u></strong><br/>
              <strong>Uso:</strong> ${props.uso || "N/D"}<br/>
              <strong>Categoría:</strong> ${props.categoria || "N/D"}
            </div>`;
        } else if (layerId === 'uso_alternativo') {
          popupRef.current.innerHTML = `
            <div>
              <strong><u>Uso Alternativo</u></strong><br/>
              <strong>Uso:</strong> ${props.uso || "N/D"}<br/>
              <strong>Categoría:</strong> ${props.categoria || "N/D"}
            </div>`;
        }

        featureFound = true;
      });

      if (!featureFound) overlay.setPosition(undefined);
    });

    return () => mapInstance.current.setTarget(null);
  }, []);

  useEffect(() => {
    if (!geojson || !mapInstance.current) return;
    const features = new GeoJSON().readFeatures(geojson, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    const vectorLayer = new VectorLayer({
      source: new VectorSource({ features }),
      style: new Style({
        stroke: new Stroke({ color: "blue", width: 2 }),
        fill: new Fill({ color: "rgba(0,123,255,0.3)" })
      }),
      visible
    });
    vectorLayer.set('id', 'poligono_proyecto');

    vectorLayerRef.current = vectorLayer;
    mapInstance.current.addLayer(vectorLayer);
    const extent = vectorLayer.getSource().getExtent();
    if (extent.every(Number.isFinite)) {
      mapInstance.current.getView().fit(extent, { padding: [20, 20, 20, 20] });
    }
    return () => mapInstance.current.removeLayer(vectorLayer);
  }, [geojson]);

  useEffect(() => {
    if (vectorLayerRef.current) vectorLayerRef.current.setVisible(visible);
  }, [visible]);

  useEffect(() => {
    const cargar = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_URL}/proyectos/uso-actual/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        const agrupado = {};
        data.features.forEach((f) => {
          const fecha = f.properties.fecha_inicial || "Sin Fecha";
          if (!agrupado[fecha]) agrupado[fecha] = [];
          agrupado[fecha].push(f);
        });
        setFechasDisponibles(Object.keys(agrupado));
        setFechaSeleccionada(Object.keys(agrupado)[0]);
        window._featuresUsoActualPorFecha = agrupado;
      } catch (err) {
        console.error("Error al cargar uso actual:", err);
      }
    };
    cargar();
  }, []);

  useEffect(() => {
    if (!fechaSeleccionada || !visibleUsoActual) return;
    if (usoActualLayerRef.current) {
      mapInstance.current.removeLayer(usoActualLayerRef.current);
      usoActualLayerRef.current = null;
    }
    const features = new GeoJSON().readFeatures({
      type: "FeatureCollection",
      features: window._featuresUsoActualPorFecha[fechaSeleccionada]
    }, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    const layer = new VectorLayer({
      source: new VectorSource({ features }),
      style: feature => {
        const uso = normalizarTexto(feature.get("uso") || "");
        const color = estiloPorUso[uso] || [255, 0, 0];
        return new Style({
          stroke: new Stroke({ color: `rgb(${color.join(",")})`, width: 1 }),
          fill: new Fill({ color: `rgba(${color.join(",")}, 0.3)` })
        });
      }
    });
    layer.set('id', 'uso_actual');

    usoActualLayerRef.current = layer;
    mapInstance.current.addLayer(layer);
  }, [fechaSeleccionada, visibleUsoActual]);

  useEffect(() => {
    if (!mapInstance.current || !usoActualLayerRef.current) return;
    const layers = mapInstance.current.getLayers().getArray();
    if (visibleUsoActual && !layers.includes(usoActualLayerRef.current)) {
      mapInstance.current.addLayer(usoActualLayerRef.current);
    } else if (!visibleUsoActual && layers.includes(usoActualLayerRef.current)) {
      mapInstance.current.removeLayer(usoActualLayerRef.current);
    }
  }, [visibleUsoActual]);

  useEffect(() => {
    if (!mapInstance.current) return;
    if (usoAlternativoLayerRef.current) {
      mapInstance.current.removeLayer(usoAlternativoLayerRef.current);
      usoAlternativoLayerRef.current = null;
    }
    if (visibleUsoAlternativo) {
      const token = localStorage.getItem("token");
      fetch(`${API_URL}/proyectos/uso-alternativo/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          const features = new GeoJSON().readFeatures(data, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857"
          });
          const layer = new VectorLayer({
            source: new VectorSource({ features }),
            style: feature => {
              const uso = normalizarTexto(feature.get("uso") || "");
              const color = estiloPorUso[uso] || [255, 165, 0];
              return new Style({
                stroke: new Stroke({ color: `rgb(${color.join(",")})`, width: 1 }),
                fill: new Fill({ color: `rgba(${color.join(",")}, 0.3)` })
              });
            }
          });
          layer.set('id', 'uso_alternativo');
          usoAlternativoLayerRef.current = layer;
          mapInstance.current.addLayer(layer);
        })
        .catch(console.error);
    }
  }, [visibleUsoAlternativo, id]);

  const cambiarVistaMapa = () => {
    const nuevaVista = vistaMapa === "OSM" ? "SAT" : "OSM";
    osmLayerRef.current.setVisible(nuevaVista === "OSM");
    satLayerRef.current.setVisible(nuevaVista === "SAT");
    setVistaMapa(nuevaVista);
  };

  return (
    <div className="visor-container">
      <h2 className="visor-title">Visor del Proyecto {id}</h2>

      <div className="botones-visor mb-3 d-flex flex-wrap gap-2 align-items-center">
        <button
          className={`btn ${vistaMapa === "OSM" ? "btn-secondary" : "btn-success"}`}
          onClick={cambiarVistaMapa}
        >
          Cambiar a {vistaMapa === "OSM" ? "Satelital" : "Mapa"}
        </button>

        <button
          className={`btn btn-primary ${visible ? 'active' : ''}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Ocultar Polígono Proyecto" : "Mostrar Polígono Proyecto"}
        </button>

        <button
          className={`btn btn-primary ${visibleUsoAlternativo ? 'active' : ''}`}
          onClick={() => setVisibleUsoAlternativo(v => !v)}
        >
          {visibleUsoAlternativo ? "Ocultar Uso Alternativo" : "Mostrar Uso Alternativo"}
        </button>

        <button
          className={`btn btn-primary ${visibleUsoActual ? 'active' : ''}`}
          onClick={() => setVisibleUsoActual(v => !v)}
        >
          {visibleUsoActual ? "Ocultar Uso Actual" : "Mostrar Uso Actual"}
        </button>

        {fechasDisponibles.length > 1 && (
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>Filtrar por Fecha Uso Actual</InputLabel>
            <Select
              value={fechaSeleccionada}
              label="Filtrar por Fecha Uso Actual"
              onChange={(e) => setFechaSeleccionada(e.target.value)}
            >
              {fechasDisponibles.map((fecha) => (
                <MenuItem key={fecha} value={fecha}>{fecha}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </div>

      <div className="map-wrapper">
        <div ref={mapRef} className="mapa" />
        <div ref={popupRef} className="ol-popup" />
      </div>
    </div>
  );
}

const estiloPorUso = {
  "bosques de reserva forestal": [38, 115, 0],
  "isletas": [152, 230, 0],
  "palmares": [211, 255, 190],
  "bosques excedentes de reserva forestal": [112, 168, 0],
  "bosques de reserva forestal bajo manejo": [92, 137, 68],
  "bosques protectores de cauces hidricos": [190, 232, 255],
  "zonas de proteccion de cauces hidricos": [122, 245, 202],
  "zona de restriccion en margenes de cauces hidricos": [0, 230, 169],
  "barreras vivas de proteccion": [230, 152, 0],
  "franjas de separacion": [230, 152, 0],
  "caminos cortafuego": [245, 202, 122],
  "area en regeneracion": [165, 245, 122],
  "area a reforestar": [137, 205, 102],
  "area silvestre protegida": [115, 76, 0],
  "uso agricola": [255, 255, 0],
  "uso ganadero": [205, 102, 153],
  "uso agropecuario": [255, 211, 127],
  "arrozales": [255, 255, 190],
  "canales": [0, 132, 168],
  "plantaciones forestales": [0, 168, 132],
  "uso silvopastoril": [163, 255, 115],
  "campo natural": [205, 245, 122],
  "matorrales": [114, 137, 68],
  "cuerpos de agua": [0, 92, 230],
  "esteros": [0, 169, 230],
  "manantiales": [0, 76, 115],
  "zona inundable": [115, 223, 255],
  "cultivos ilegales": [169, 0, 230],
  "area invadida": [202, 122, 245],
  "area siniestrada": [230, 0, 169],
  "loteamientos": [130, 130, 130],
  "contribucion inmobiliaria obligatoria": [115, 115, 0],
  "construcciones edilicias": [225, 225, 225],
  "cementerio": [190, 210, 255],
  "area de destape": [205, 137, 102],
  "oleria": [245, 122, 182],
  "area de prestamo": [215, 176, 158],
  "arenera": [245, 245, 122],
  "area de nivelacion": [215, 215, 158],
  "polvorin": [178, 178, 178],
  "planta trituradora": [230, 230, 0],
  "planta asfaltica": [115, 0, 0],
  "area de maniobra y estacionamiento": [255, 255, 255],
  "caminos": [225, 190, 190],
  "pista de aterrizaje": [232, 190, 255],
  "estacion de servicio": [223, 115, 255],
  "silo": [68, 79, 137],
  "deposito": [122, 182, 245],
  "area de acopio": [102, 119, 205],
  "corrales": [245, 202, 122],
  "galpones": [68, 101, 137],
  "abastecimiento de agua": [190, 255, 232],
  "canchadas": [205, 102, 102],
  "puerto": [137, 68, 101],
  "area industrial": [255, 127, 127],
  "infraestructura": [168, 0, 0],
  "fosa o trinchera": [168, 0, 132],
  "area de segregacion": [122, 142, 245],
  "pileta de agregar uso": [102, 205, 171],
  "area de servidumbre": [112, 68, 137],
  "resto de propiedad": [255, 255, 255],
  "servicios ambientales": [170, 255, 0],
  "comunidades indigenas": [137, 90, 68],
  "otros usos": [158, 187, 215]
};
