import { useEffect, useMemo, useRef } from "react";

function toIdString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function walkCoordinates(node, bounds) {
  if (!Array.isArray(node)) return false;
  let hasAny = false;

  if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
    const lng = Number(node[0]);
    const lat = Number(node[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      bounds.extend({ lat, lng });
      return true;
    }
    return false;
  }

  for (const child of node) {
    hasAny = walkCoordinates(child, bounds) || hasAny;
  }

  return hasAny;
}

function buildBounds(google, featureCollection) {
  if (!google?.maps?.LatLngBounds) return null;
  const bounds = new google.maps.LatLngBounds();
  let hasAny = false;

  for (const feature of featureCollection?.features || []) {
    hasAny = walkCoordinates(feature?.geometry?.coordinates, bounds) || hasAny;
  }

  return hasAny ? bounds : null;
}

function asFeatureCollection(data) {
  if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data;
  }
  return { type: "FeatureCollection", features: [] };
}

function featureProps(feature) {
  const props = {};
  try {
    feature.forEachProperty((v, k) => {
      props[k] = v;
    });
  } catch {}
  return props;
}

export default function GVAMapDataLayer({
  map,
  google,
  data,
  visible = true,
  getFeatureId,
  activeIds = [],
  defaultStyle = {},
  activeStyle = {},
  onFeatureClick,
  onDataBounds,
  zIndex,
}) {
  const layerRef = useRef(null);
  const clickListenerRef = useRef(null);
  const getFeatureIdRef = useRef(getFeatureId);
  const onFeatureClickRef = useRef(onFeatureClick);
  const featureCollection = useMemo(() => asFeatureCollection(data), [data]);
  const activeSet = useMemo(() => {
    const next = new Set();
    for (const id of Array.isArray(activeIds) ? activeIds : []) {
      const key = toIdString(id);
      if (key) next.add(key);
    }
    return next;
  }, [activeIds]);

  useEffect(() => {
    getFeatureIdRef.current = getFeatureId;
  }, [getFeatureId]);

  useEffect(() => {
    onFeatureClickRef.current = onFeatureClick;
  }, [onFeatureClick]);

  useEffect(() => {
    if (!map || !google?.maps?.Data) return;
    if (!layerRef.current) {
      layerRef.current = new google.maps.Data({ map: visible ? map : null });
    } else {
      layerRef.current.setMap(visible ? map : null);
    }

    if (!clickListenerRef.current) {
      clickListenerRef.current = layerRef.current.addListener("click", (event) => {
        if (!onFeatureClickRef.current) return;
        const props = featureProps(event.feature);
        const id = toIdString(getFeatureIdRef.current?.(props, event.feature));
        onFeatureClickRef.current({ id, props, feature: event.feature, event });
      });
    }

    return () => {
      if (clickListenerRef.current) {
        try {
          google.maps.event.removeListener(clickListenerRef.current);
        } catch {}
        clickListenerRef.current = null;
      }
      if (layerRef.current) {
        try {
          layerRef.current.setMap(null);
        } catch {}
        layerRef.current = null;
      }
    };
  }, [map, google, visible]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    layer.forEach((feature) => layer.remove(feature));
    if (visible && featureCollection.features.length > 0) {
      layer.addGeoJson(featureCollection);
    }

    if (typeof zIndex === "number") {
      layer.setStyle((feature) => {
        const props = featureProps(feature);
        const id = toIdString(getFeatureId?.(props, feature));
        const isActive = activeSet.has(id);
        return {
          ...defaultStyle,
          ...(isActive ? activeStyle : null),
          zIndex,
        };
      });
    }

    const bounds = visible ? buildBounds(google, featureCollection) : null;
    onDataBounds?.(bounds);
  }, [
    featureCollection,
    visible,
    google,
    getFeatureId,
    activeSet,
    defaultStyle,
    activeStyle,
    onDataBounds,
    zIndex,
  ]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    layer.setStyle((feature) => {
      const props = featureProps(feature);
      const id = toIdString(getFeatureId?.(props, feature));
      const isActive = activeSet.has(id);
      return {
        ...defaultStyle,
        ...(isActive ? activeStyle : null),
        ...(typeof zIndex === "number" ? { zIndex } : null),
      };
    });
  }, [activeSet, defaultStyle, activeStyle, getFeatureId, zIndex]);

  return null;
}
