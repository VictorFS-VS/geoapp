import { useEffect, useMemo, useRef } from "react";

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPointItems(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const lat = toFiniteNumber(point?.lat);
      const lng = toFiniteNumber(point?.lng);
      const id = Number(point?.id_informe);
      if (!lat || !lng || !id) return null;
      return {
        ...point,
        id_informe: id,
        lat,
        lng,
      };
    })
    .filter(Boolean);
}

export default function GVAMapPointLayer({
  map,
  google,
  points,
  visible = true,
  activeId = null,
  onPointClick,
  onOpenPoint,
}) {
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const onPointClickRef = useRef(onPointClick);
  const onOpenPointRef = useRef(onOpenPoint);
  const items = useMemo(() => toPointItems(points), [points]);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
  }, [onPointClick]);

  useEffect(() => {
    onOpenPointRef.current = onOpenPoint;
  }, [onOpenPoint]);

  useEffect(() => {
    if (!map || !google?.maps?.Marker || !google?.maps?.InfoWindow) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    for (const marker of markersRef.current) {
      try {
        marker.setMap(null);
      } catch {}
    }
    markersRef.current = [];

    if (!visible || !items.length) {
      try {
        infoWindowRef.current.close();
      } catch {}
      return undefined;
    }

    const created = items.map((point) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: point.lat, lng: point.lng },
        title: point.titulo || `Informe #${point.id_informe}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: point.semaforo_color || "#2563eb",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: Number(activeId) === point.id_informe ? 999 : 100,
      });
      marker.__pointId = point.id_informe;

      marker.addListener("click", () => {
        const popup = document.createElement("div");
        popup.style.minWidth = "220px";
        popup.style.display = "flex";
        popup.style.flexDirection = "column";
        popup.style.gap = "6px";
        popup.style.padding = "2px";

        const title = document.createElement("div");
        title.style.fontWeight = "800";
        title.style.fontSize = "13px";
        title.textContent = point.titulo || `Informe #${point.id_informe}`;
        popup.appendChild(title);

        const metaRows = [
          ["ID", `#${point.id_informe}`],
          ["Fecha", point.fecha_creado ? String(point.fecha_creado).slice(0, 10) : "-"],
          ["Plantilla", point.nombre_plantilla || "-"],
        ];

        for (const [label, value] of metaRows) {
          const row = document.createElement("div");
          row.style.fontSize = "12px";
          row.innerHTML = `<strong>${label}:</strong> ${value}`;
          popup.appendChild(row);
        }

        const action = document.createElement("button");
        action.type = "button";
        action.textContent = "Ir al informe";
        action.style.marginTop = "4px";
        action.style.border = "1px solid #2563eb";
        action.style.background = "#2563eb";
        action.style.color = "#ffffff";
        action.style.borderRadius = "8px";
        action.style.padding = "6px 10px";
        action.style.fontSize = "12px";
        action.style.fontWeight = "700";
        action.style.cursor = "pointer";
        action.addEventListener("click", () => {
          onOpenPointRef.current?.(point);
        });
        popup.appendChild(action);

        infoWindowRef.current.setContent(popup);
        infoWindowRef.current.open({ map, anchor: marker });
        onPointClickRef.current?.(point);
      });

      return marker;
    });

    markersRef.current = created;

    return () => {
      for (const marker of created) {
        try {
          marker.setMap(null);
        } catch {}
      }
    };
  }, [map, google, items, visible, activeId]);

  useEffect(() => {
    for (const marker of markersRef.current) {
      const markerId = Number(marker?.__pointId) || null;
      try {
        marker.setZIndex(markerId && Number(activeId) === markerId ? 999 : 100);
      } catch {}
    }
  }, [activeId]);

  useEffect(() => {
    if (visible) return undefined;
    try {
      infoWindowRef.current?.close();
    } catch {}
    return undefined;
  }, [visible]);

  return null;
}
