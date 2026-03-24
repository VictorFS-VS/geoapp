import { useEffect, useMemo, useRef, useState } from "react";

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function toPointItems(points, getPointInfo) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const info = getPointInfo(point);
      const lat = toFiniteNumber(info?.lat);
      const lng = toFiniteNumber(info?.lng);
      const id = Number(info?.id);
      if (!id || !isValidLatLng(lat, lng)) return null;
      return {
        raw: point,
        info,
        id,
        lat,
        lng,
      };
    })
    .filter(Boolean);
}

function buildMarkerContent(info, isActive) {
  const node = document.createElement("div");
  node.style.width = isActive ? "18px" : "16px";
  node.style.height = isActive ? "18px" : "16px";
  node.style.borderRadius = "999px";
  node.style.background = info?.color || "#2563eb";
  node.style.border = isActive ? "3px solid #0f172a" : "2px solid #ffffff";
  node.style.boxShadow = isActive
    ? "0 0 0 4px rgba(15, 23, 42, 0.18)"
    : "0 2px 10px rgba(15, 23, 42, 0.18)";
  node.style.boxSizing = "border-box";
  return node;
}

function buildLabelContent(text, isActive) {
  const node = document.createElement("div");
  node.textContent = text || "";
  node.style.pointerEvents = "none";
  node.style.padding = "3px 8px";
  node.style.borderRadius = "999px";
  node.style.background = "rgba(255,255,255,0.92)";
  node.style.border = isActive ? "1px solid #0f172a" : "1px solid #cbd5e1";
  node.style.color = "#0f172a";
  node.style.fontSize = "11px";
  node.style.fontWeight = isActive ? "800" : "700";
  node.style.whiteSpace = "nowrap";
  node.style.boxShadow = "0 6px 14px rgba(15, 23, 42, 0.18)";
  node.style.transform = "translate(12px, -8px)";
  return node;
}

export default function GVAMapPointLayer({
  map,
  google,
  points,
  visible = true,
  activeId = null,
  onPointClick,
  onOpenPoint,
  onPopupOpen,
  getPointInfo,
  getPointPopupState,
  onSelectPopupPhoto,
  showLabel = false,
  getPointLabel,
  labelMinZoom = 16,
  labelOffsetX = 12,
  labelOffsetY = -8,
  activeLabelOnly = false,
}) {
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const advancedMarkerCtorRef = useRef(undefined);
  const onPointClickRef = useRef(onPointClick);
  const onOpenPointRef = useRef(onOpenPoint);
  const onPopupOpenRef = useRef(onPopupOpen);
  const getPointPopupStateRef = useRef(getPointPopupState);
  const onSelectPopupPhotoRef = useRef(onSelectPopupPhoto);
  const openPopupEntryRef = useRef(null);
  const [zoom, setZoom] = useState(null);
  const infoAdapter = useMemo(() => {
    if (typeof getPointInfo === "function") return getPointInfo;
    const truncateText = (value, max = 110) => {
      const text = String(value || "").trim();
      if (!text) return "";
      return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
    };

    const buildSummaryRow = (point) => {
      const summaryLabel = String(point?.summary_label || "").trim();
      const summaryText = String(point?.summary_text || "").trim();
      if (summaryText) {
        return [summaryLabel || "Resumen", truncateText(summaryText)];
      }
      const fallbackTitle = String(point?.titulo || "").trim();
      if (fallbackTitle) {
        return ["Titulo", truncateText(fallbackTitle)];
      }
      const fallbackPlantilla = String(point?.nombre_plantilla || "").trim();
      if (fallbackPlantilla) {
        return ["Plantilla", truncateText(fallbackPlantilla)];
      }
      return null;
    };

    return (point) => ({
      id: Number(point?.id_informe),
      lat: point?.lat,
      lng: point?.lng,
      title: point?.titulo || `Informe #${point?.id_informe}`,
      color: point?.semaforo_color || "#16a34a",
      rows: [
        ["ID", `#${point?.id_informe ?? "-"}`],
        ["Fecha", point?.fecha_creado ? String(point.fecha_creado).slice(0, 10) : "-"],
        buildSummaryRow(point),
      ].filter(Boolean),
      actionLabel: "Ver informe completo",
    });
  }, [getPointInfo]);
  const items = useMemo(() => toPointItems(points, infoAdapter), [points, infoAdapter]);

  useEffect(() => {
    if (!map || !google) return undefined;
    const onZoomChanged = () => {
      try {
        setZoom(Number(map.getZoom?.() ?? null));
      } catch {}
    };
    const listener = map.addListener?.("zoom_changed", onZoomChanged);
    onZoomChanged();
    return () => {
      try {
        google.maps.event.removeListener(listener);
      } catch {}
    };
  }, [map, google]);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
  }, [onPointClick]);

  useEffect(() => {
    onOpenPointRef.current = onOpenPoint;
  }, [onOpenPoint]);

  useEffect(() => {
    onPopupOpenRef.current = onPopupOpen;
  }, [onPopupOpen]);

  useEffect(() => {
    getPointPopupStateRef.current = getPointPopupState;
  }, [getPointPopupState]);

  useEffect(() => {
    onSelectPopupPhotoRef.current = onSelectPopupPhoto;
  }, [onSelectPopupPhoto]);

  useEffect(() => {
    advancedMarkerCtorRef.current = undefined;
  }, [google]);

  useEffect(() => {
    let cancelled = false;

    const cleanupMarkers = () => {
      try {
        infoWindowRef.current?.close();
      } catch {}
      openPopupEntryRef.current = null;
      for (const entry of markersRef.current) {
        try {
          if (entry?.listener) {
            google?.maps?.event?.removeListener?.(entry.listener);
          }
        } catch {}
        try {
          if (entry?.marker) {
            if ("map" in entry.marker) entry.marker.map = null;
            else if (typeof entry.marker.setMap === "function") entry.marker.setMap(null);
          }
        } catch {}
        try {
          if (entry?.labelMarker) {
            if ("map" in entry.labelMarker) entry.labelMarker.map = null;
            else if (typeof entry.labelMarker.setMap === "function")
              entry.labelMarker.setMap(null);
          }
        } catch {}
      }
      markersRef.current = [];
    };

    const resolveAdvancedMarkerCtor = async () => {
      if (advancedMarkerCtorRef.current !== undefined) {
        return advancedMarkerCtorRef.current;
      }

      let ctor = google?.maps?.marker?.AdvancedMarkerElement || null;
      if (!ctor && typeof google?.maps?.importLibrary === "function") {
        try {
          const markerLib = await google.maps.importLibrary("marker");
          ctor = markerLib?.AdvancedMarkerElement || null;
        } catch {}
      }

      advancedMarkerCtorRef.current = ctor || null;
      return advancedMarkerCtorRef.current;
    };

    const buildPopupContent = (entry) => {
      const info = entry?.info || {};
      const popupState =
        typeof getPointPopupStateRef.current === "function"
          ? getPointPopupStateRef.current(entry?.raw, info) || {}
          : {};

      const popup = document.createElement("div");
      popup.style.minWidth = "220px";
      popup.style.maxWidth = "280px";
      popup.style.display = "flex";
      popup.style.flexDirection = "column";
      popup.style.gap = "6px";
      popup.style.padding = "2px";

      const title = document.createElement("div");
      title.style.fontWeight = "800";
      title.style.fontSize = "13px";
      title.textContent = info.title || `Item #${entry?.id || ""}`;
      popup.appendChild(title);

      const metaRows = Array.isArray(info.rows) ? info.rows : [];
      for (const [label, value] of metaRows) {
        const row = document.createElement("div");
        row.style.fontSize = "12px";
        row.innerHTML = `<strong>${label}:</strong> ${value}`;
        popup.appendChild(row);
      }

      if (popupState?.loadingPhotos) {
        const loadingNode = document.createElement("div");
        loadingNode.style.fontSize = "12px";
        loadingNode.style.color = "#6b7280";
        loadingNode.style.marginTop = "2px";
        loadingNode.textContent = "Cargando fotos...";
        popup.appendChild(loadingNode);
      } else {
        const photos = Array.isArray(popupState?.photos) ? popupState.photos : [];
        const activeIndex = Math.max(
          0,
          Math.min(Number(popupState?.activePhotoIndex) || 0, Math.max(photos.length - 1, 0))
        );

        if (photos.length === 0) {
          const emptyNode = document.createElement("div");
          emptyNode.style.fontSize = "12px";
          emptyNode.style.color = "#6b7280";
          emptyNode.style.marginTop = "2px";
          emptyNode.textContent = popupState?.photosError || "Sin fotos";
          popup.appendChild(emptyNode);
        } else {
          const activePhoto = photos[activeIndex] || photos[0];
          if (activePhoto?.url) {
            const mainImage = document.createElement("img");
            mainImage.src = activePhoto.url;
            mainImage.alt = activePhoto.descripcion || info.title || "Foto del informe";
            mainImage.style.width = "100px";
            mainImage.style.height = "100px";
            mainImage.style.objectFit = "cover";
            mainImage.style.borderRadius = "10px";
            mainImage.style.border = "1px solid #dbe3ee";
            mainImage.style.marginTop = "4px";
            mainImage.style.alignSelf = "flex-start";
            popup.appendChild(mainImage);
          }

          if (photos.length > 1) {
            const strip = document.createElement("div");
            strip.style.display = "flex";
            strip.style.gap = "6px";
            strip.style.overflowX = "auto";
            strip.style.paddingBottom = "2px";
            strip.style.marginTop = "2px";

            photos.forEach((photo, index) => {
              const thumb = document.createElement("img");
              thumb.src = photo?.url || "";
              thumb.alt = photo?.descripcion || `Miniatura ${index + 1}`;
              thumb.style.width = "34px";
              thumb.style.height = "34px";
              thumb.style.objectFit = "cover";
              thumb.style.borderRadius = "8px";
              thumb.style.border =
                index === activeIndex ? "2px solid #2563eb" : "1px solid #dbe3ee";
              thumb.style.cursor = "pointer";
              thumb.addEventListener("click", () => {
                onSelectPopupPhotoRef.current?.(entry.raw, index);
              });
              strip.appendChild(thumb);
            });

            popup.appendChild(strip);
          }
        }
      }

      const actionRow = document.createElement("div");
      actionRow.style.display = "flex";
      actionRow.style.gap = "6px";
      actionRow.style.flexWrap = "wrap";
      actionRow.style.marginTop = "4px";

      if (info.actionLabel && onOpenPointRef.current) {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = String(info.actionLabel);
        action.style.border = "1px solid #2563eb";
        action.style.background = "#2563eb";
        action.style.color = "#ffffff";
        action.style.borderRadius = "8px";
        action.style.padding = "6px 10px";
        action.style.fontSize = "12px";
        action.style.fontWeight = "700";
        action.style.cursor = "pointer";
        action.addEventListener("click", () => {
          onOpenPointRef.current?.(entry.raw);
        });
        actionRow.appendChild(action);
      }

      if (actionRow.childNodes.length > 0) {
        popup.appendChild(actionRow);
      }

      return popup;
    };

    const run = async () => {
      if (!map || !google?.maps?.InfoWindow || !visible || !items.length) {
        cleanupMarkers();
        return;
      }

      if (!infoWindowRef.current) {
        infoWindowRef.current = new google.maps.InfoWindow();
      }

      const AdvancedMarkerElement = await resolveAdvancedMarkerCtor();

      if (cancelled) return;
      cleanupMarkers();

      const created = items.map((entry) => {
        const isActive = Number(activeId) === entry.id;
        const info = entry.info || {};
        let marker = null;
        let isAdvanced = false;

        if (AdvancedMarkerElement) {
          marker = new AdvancedMarkerElement({
            map,
            position: { lat: entry.lat, lng: entry.lng },
            title: info.title || `Item #${entry.id}`,
            content: buildMarkerContent(info, isActive),
            zIndex: isActive ? 999 : 100,
          });
          isAdvanced = true;
        } else if (google?.maps?.Marker) {
          marker = new google.maps.Marker({
            map,
            position: { lat: entry.lat, lng: entry.lng },
            title: info.title || `Item #${entry.id}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: isActive ? 8 : 7,
              fillColor: info?.color || "#16a34a",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: isActive ? 3 : 2,
            },
            zIndex: isActive ? 999 : 100,
          });
        } else {
          if (import.meta.env.DEV) {
            console.warn("[gva_tramos] No hay Marker disponible para puntos.");
          }
          return null;
        }

        marker.__pointId = entry.id;
        marker.__pointData = entry;
        marker.__isAdvanced = isAdvanced;

        const handleClick = () => {
          const popup = buildPopupContent(entry);
          openPopupEntryRef.current = entry;
          infoWindowRef.current.setContent(popup);
          infoWindowRef.current.open({ map, anchor: marker });
          onPopupOpenRef.current?.(entry.raw);
          onPointClickRef.current?.(entry.raw);
        };

        let listener = null;
        if (typeof marker.addListener === "function") {
          const evt = isAdvanced ? "gmp-click" : "click";
          listener = marker.addListener(evt, handleClick);
        }

        return {
          id: entry.id,
          raw: entry.raw,
          info: entry.info,
          marker,
          labelMarker: null,
          listener,
          isAdvanced,
        };
      });
      markersRef.current = created.filter(Boolean);
    };

    run().catch((err) => {
      if (cancelled) return;
      console.error(err);
    });

    return () => {
      cancelled = true;
      cleanupMarkers();
    };
  }, [map, google, items, visible]);

  useEffect(() => {
    const openEntry = openPopupEntryRef.current;
    if (!visible || !openEntry || !infoWindowRef.current) return;
    try {
      const markerId = Number(openEntry?.marker?.__pointId) || null;
      if (!markerId) return;
      const pointEntry =
        markersRef.current.find((entry) => Number(entry?.marker?.__pointId) === markerId) || openEntry;
      if (!pointEntry?.marker) return;
      const popupState =
        typeof getPointPopupState === "function"
          ? getPointPopupState(pointEntry.raw, pointEntry.info)
          : null;
      if (!popupState) return;
      const popup = (() => {
        const info = pointEntry?.info || {};
        const state = popupState || {};
        const container = document.createElement("div");
        container.style.minWidth = "220px";
        container.style.maxWidth = "280px";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "6px";
        container.style.padding = "2px";

        const title = document.createElement("div");
        title.style.fontWeight = "800";
        title.style.fontSize = "13px";
        title.textContent = info.title || `Item #${pointEntry?.id || ""}`;
        container.appendChild(title);

        const metaRows = Array.isArray(info.rows) ? info.rows : [];
        for (const [label, value] of metaRows) {
          const row = document.createElement("div");
          row.style.fontSize = "12px";
          row.innerHTML = `<strong>${label}:</strong> ${value}`;
          container.appendChild(row);
        }

        if (state?.loadingPhotos) {
          const loadingNode = document.createElement("div");
          loadingNode.style.fontSize = "12px";
          loadingNode.style.color = "#6b7280";
          loadingNode.textContent = "Cargando fotos...";
          container.appendChild(loadingNode);
        } else {
          const photos = Array.isArray(state?.photos) ? state.photos : [];
          const activeIndex = Math.max(
            0,
            Math.min(Number(state?.activePhotoIndex) || 0, Math.max(photos.length - 1, 0))
          );
          if (!photos.length) {
            const emptyNode = document.createElement("div");
            emptyNode.style.fontSize = "12px";
            emptyNode.style.color = "#6b7280";
            emptyNode.textContent = state?.photosError || "Sin fotos";
            container.appendChild(emptyNode);
          } else {
            const activePhoto = photos[activeIndex] || photos[0];
            const mainImage = document.createElement("img");
            mainImage.src = activePhoto?.url || "";
            mainImage.alt = activePhoto?.descripcion || info.title || "Foto del informe";
            mainImage.style.width = "100px";
            mainImage.style.height = "100px";
            mainImage.style.objectFit = "cover";
            mainImage.style.borderRadius = "10px";
            mainImage.style.border = "1px solid #dbe3ee";
            mainImage.style.marginTop = "4px";
            mainImage.style.alignSelf = "flex-start";
            container.appendChild(mainImage);

            if (photos.length > 1) {
              const strip = document.createElement("div");
              strip.style.display = "flex";
              strip.style.gap = "6px";
              strip.style.overflowX = "auto";
              photos.forEach((photo, index) => {
                const thumb = document.createElement("img");
                thumb.src = photo?.url || "";
                thumb.alt = photo?.descripcion || `Miniatura ${index + 1}`;
                thumb.style.width = "34px";
                thumb.style.height = "34px";
                thumb.style.objectFit = "cover";
                thumb.style.borderRadius = "8px";
                thumb.style.border =
                  index === activeIndex ? "2px solid #2563eb" : "1px solid #dbe3ee";
                thumb.style.cursor = "pointer";
                thumb.addEventListener("click", () => {
                  onSelectPopupPhotoRef.current?.(pointEntry.raw, index);
                });
                strip.appendChild(thumb);
              });
              container.appendChild(strip);
            }
          }
        }

        const actionRow = document.createElement("div");
        actionRow.style.display = "flex";
        actionRow.style.gap = "6px";
        actionRow.style.flexWrap = "wrap";
        actionRow.style.marginTop = "4px";
        if (info.actionLabel && onOpenPointRef.current) {
          const action = document.createElement("button");
          action.type = "button";
          action.textContent = String(info.actionLabel);
          action.style.border = "1px solid #2563eb";
          action.style.background = "#2563eb";
          action.style.color = "#ffffff";
          action.style.borderRadius = "8px";
          action.style.padding = "6px 10px";
          action.style.fontSize = "12px";
          action.style.fontWeight = "700";
          action.style.cursor = "pointer";
          action.addEventListener("click", () => {
            onOpenPointRef.current?.(pointEntry.raw);
          });
          actionRow.appendChild(action);
        }
        if (actionRow.childNodes.length > 0) {
          container.appendChild(actionRow);
        }
        return container;
      })();
      infoWindowRef.current.setContent(popup);
      infoWindowRef.current.open({ map, anchor: pointEntry.marker });
      openPopupEntryRef.current = pointEntry;
    } catch {}
  }, [getPointPopupState, onSelectPopupPhoto, visible, map]);

  useEffect(() => {
    for (const entry of markersRef.current) {
      const marker = entry?.marker;
      const point = marker?.__pointData;
      const markerId = Number(marker?.__pointId) || null;
      const isActive = !!markerId && Number(activeId) === markerId;
      try {
        if (entry?.isAdvanced && marker) {
          marker.content = buildMarkerContent(point?.info || {}, isActive);
          marker.zIndex = isActive ? 999 : 100;
        } else if (marker) {
          marker.setZIndex?.(isActive ? 999 : 100);
          marker.setIcon?.({
            path: google?.maps?.SymbolPath?.CIRCLE,
            scale: isActive ? 8 : 7,
            fillColor: point?.info?.color || "#16a34a",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: isActive ? 3 : 2,
          });
        }
      } catch {}
      try {
        if (entry?.labelMarker) {
          const labelText =
            typeof getPointLabel === "function"
              ? getPointLabel(point?.raw, point?.info)
              : point?.info?.title || `Item #${markerId || ""}`;
          const showLabelNow =
            showLabel &&
            (!!labelText &&
              (isActive || (!activeLabelOnly && Number(zoom) >= Number(labelMinZoom))));
          if (!showLabelNow) {
            if ("map" in entry.labelMarker) entry.labelMarker.map = null;
            else if (typeof entry.labelMarker.setMap === "function")
              entry.labelMarker.setMap(null);
          } else {
            if ("map" in entry.labelMarker) entry.labelMarker.map = marker?.map || null;
            else if (typeof entry.labelMarker.setMap === "function")
              entry.labelMarker.setMap(marker?.map || null);
            if (entry.labelMarker?.content) {
              entry.labelMarker.content.textContent = labelText;
              entry.labelMarker.content.style.fontWeight = isActive ? "800" : "700";
              entry.labelMarker.content.style.borderColor = isActive ? "#0f172a" : "#cbd5e1";
            }
          }
        }
      } catch {}
    }
  }, [
    activeId,
    getPointLabel,
    showLabel,
    activeLabelOnly,
    labelMinZoom,
    zoom,
    google,
  ]);

  useEffect(() => {
    if (!visible) return;
    const AdvancedMarkerElement = advancedMarkerCtorRef.current ?? null;
    if (!AdvancedMarkerElement) return;

    for (const entry of markersRef.current) {
      const marker = entry?.marker;
      const point = marker?.__pointData;
      if (!marker || !point) continue;

      const markerId = Number(marker?.__pointId) || null;
      const isActive = !!markerId && Number(activeId) === markerId;
      const labelText =
        typeof getPointLabel === "function"
          ? getPointLabel(point?.raw, point?.info)
          : point?.info?.title || `Item #${markerId || ""}`;

      const showLabelNow =
        showLabel &&
        (!!labelText &&
          (isActive || (!activeLabelOnly && Number(zoom) >= Number(labelMinZoom))));

      if (!showLabelNow) {
        if (entry?.labelMarker) {
          try {
            entry.labelMarker.map = null;
          } catch {}
        }
        continue;
      }

      if (!entry.labelMarker) {
        const labelNode = buildLabelContent(labelText, isActive);
        labelNode.style.transform = `translate(${labelOffsetX}px, ${labelOffsetY}px)`;
        entry.labelMarker = new AdvancedMarkerElement({
          map,
          position: marker.position,
          content: labelNode,
          zIndex: isActive ? 998 : 150,
        });
        try {
          if (entry.labelMarker?.content) {
            entry.labelMarker.content.style.pointerEvents = "none";
          }
        } catch {}
      } else {
        try {
          if ("map" in entry.labelMarker) entry.labelMarker.map = marker?.map || null;
          else if (typeof entry.labelMarker.setMap === "function")
            entry.labelMarker.setMap(marker?.map || null);
          if (entry.labelMarker?.content) {
            entry.labelMarker.content.textContent = labelText;
            entry.labelMarker.content.style.fontWeight = isActive ? "800" : "700";
            entry.labelMarker.content.style.borderColor = isActive ? "#0f172a" : "#cbd5e1";
            entry.labelMarker.content.style.transform = `translate(${labelOffsetX}px, ${labelOffsetY}px)`;
          }
          if ("zIndex" in entry.labelMarker) {
            entry.labelMarker.zIndex = isActive ? 998 : 150;
          }
        } catch {}
      }
    }
  }, [
    visible,
    showLabel,
    getPointLabel,
    activeLabelOnly,
    labelMinZoom,
    labelOffsetX,
    labelOffsetY,
    zoom,
    activeId,
  ]);

  useEffect(() => {
    if (visible) return undefined;
    try {
      infoWindowRef.current?.close();
    } catch {}
    for (const entry of markersRef.current) {
      try {
        if (entry?.labelMarker) {
          if ("map" in entry.labelMarker) entry.labelMarker.map = null;
          else if (typeof entry.labelMarker.setMap === "function") {
            entry.labelMarker.setMap(null);
          }
        }
      } catch {}
      try {
        if (entry?.marker) {
          if ("map" in entry.marker) entry.marker.map = null;
          else if (typeof entry.marker.setMap === "function") {
            entry.marker.setMap(null);
          }
        }
      } catch {}
    }
    return undefined;
  }, [visible]);

  return null;
}
