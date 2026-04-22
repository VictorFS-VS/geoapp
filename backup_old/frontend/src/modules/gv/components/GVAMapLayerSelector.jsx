import React from "react";

export default function GVAMapLayerSelector({
  layers = [],
  onToggleLayer,
  compact = true,
  disabled = false,
  className = "",
}) {
  const items = Array.isArray(layers) ? layers : [];

  if (!items.length) return null;

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? 6 : 8,
        alignItems: "center",
      }}
    >
      {items.map((layer) => {
        const key = String(layer?.key || "").trim();
        if (!key) return null;

        const visible = !!layer?.visible;
        const enabled = layer?.enabled !== false && !disabled;
        const label = layer?.label || key;
        const count =
          Number.isFinite(Number(layer?.count)) && Number(layer?.count) >= 0
            ? Number(layer.count)
            : null;

        return (
          <button
            key={key}
            type="button"
            disabled={!enabled}
            onClick={() => {
              if (!enabled || !onToggleLayer) return;
              onToggleLayer(key);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              border: visible ? "1px solid #0f172a" : "1px solid #dbe3ee",
              background: visible ? "#e2e8f0" : "#ffffff",
              color: visible ? "#0f172a" : "#334155",
              padding: compact ? "5px 10px" : "7px 12px",
              fontSize: compact ? 11 : 12,
              fontWeight: 700,
              cursor: enabled ? "pointer" : "not-allowed",
              opacity: enabled ? 1 : 0.55,
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
            title={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: visible ? "#0f172a" : "#cbd5e1",
                flex: "0 0 auto",
              }}
            />
            <span>{label}</span>
            {count !== null ? (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: visible ? "#ffffff" : "#f8fafc",
                  border: "1px solid #e2e8f0",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
