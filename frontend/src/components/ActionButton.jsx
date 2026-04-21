import React from "react";
import { Button } from "react-bootstrap";

/**
 * ActionButton - Componente reutilizable para botones de acción con labels híbridos
 * 
 * Props:
 * - icon: string | JSX - Icono a mostrar (ej. "bi bi-pencil-square")
 * - label: string - Texto descriptivo del botón
 * - ariaLabel: string - Etiqueta para accesibilidad (lectores de pantalla)
 * - title: string - Tooltip que aparece en hover (respaldo si label no visible)
 * - onClick: function - Callback del click
 * - variant: string - Variante Bootstrap (outline-primary, outline-danger, etc.)
 * - size: string - Tamaño (sm, lg, etc.) - default: "sm"
 * - disabled: boolean - Si el botón está deshabilitado
 * - className: string - Clases CSS adicionales
 * 
 * Ejemplo:
 * <ActionButton
 *   icon="bi bi-pencil-square"
 *   label="Editar"
 *   ariaLabel="Editar pregunta"
 *   title="Editar esta pregunta"
 *   onClick={() => handleEdit()}
 *   variant="outline-primary"
 * />
 */
export default function ActionButton({
  icon,
  label,
  ariaLabel,
  title,
  onClick,
  variant = "outline-secondary",
  size = "sm",
  disabled = false,
  className = "",
}) {
  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel || label}
      title={title || label}
      className={`action-button-hybrid py-2 px-3 ${className}`}
    >
      {/* Icono siempre visible */}
      {typeof icon === "string" ? (
        <i className={`${icon} me-2`}></i>
      ) : (
        icon
      )}

      {/* Label: visible en lg+, hidden en md- */}
      <span className="action-button-label">
        {label}
      </span>
    </Button>
  );
}
