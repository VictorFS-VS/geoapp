// src/utils/alerts.js
import Swal from "sweetalert2";

// Estilo toast (arriba a la derecha)
const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2200,
  timerProgressBar: true,
});

/**
 * Convierte cualquier cosa a un texto “amigable”:
 * - string => devuelve tal cual
 * - {message} => devuelve message
 * - {error} => devuelve error
 * - {errors:[{message}]} => arma resumen corto
 * - Error => devuelve err.message
 * - fallback => "Ocurrió un error"
 */
function toMsg(input, fallback = "Ocurrió un error") {
  if (!input) return fallback;

  // Error nativo
  if (input instanceof Error) return input.message || fallback;

  // string
  if (typeof input === "string") return input;

  // objeto (response json)
  if (typeof input === "object") {
    const msg =
      input.message ||
      input.error ||
      input.msg ||
      input.mensaje ||
      null;

    if (msg) return String(msg);

    // Si viene errors: [{field,message}]
    if (Array.isArray(input.errors) && input.errors.length) {
      // Resumen corto: "campo: mensaje, campo2: mensaje2"
      const parts = input.errors
        .slice(0, 3)
        .map((e) => {
          const f = e?.field ? `${e.field}: ` : "";
          const m = e?.message || e?.msg || e?.mensaje || "";
          return (f + m).trim();
        })
        .filter(Boolean);

      if (parts.length) {
        return parts.join(" · ") + (input.errors.length > 3 ? " · ..." : "");
      }
    }

    // último recurso: stringify corto
    try {
      return JSON.stringify(input);
    } catch {
      return fallback;
    }
  }

  // cualquier otro tipo
  return fallback;
}

// -----------------------
// Toasts
// -----------------------
export const alerts = {
  toast: {
    success: (text = "Operación exitosa") =>
      Toast.fire({ icon: "success", title: toMsg(text, "Operación exitosa") }),

    error: (text = "Ocurrió un error") =>
      Toast.fire({ icon: "error", title: toMsg(text, "Ocurrió un error") }),

    info: (text = "Información") =>
      Toast.fire({ icon: "info", title: toMsg(text, "Información") }),

    warn: (text = "Atención") =>
      Toast.fire({ icon: "warning", title: toMsg(text, "Atención") }),
  },

  // -----------------------
  // Modales
  // -----------------------
  confirm: async ({
    title = "¿Confirmar?",
    text = "Esta acción no se puede deshacer",
    confirmButtonText = "Sí, continuar",
    cancelButtonText = "Cancelar",
    icon = "question",
  } = {}) => {
    const res = await Swal.fire({
      title,
      text,
      icon,
      showCancelButton: true,
      confirmButtonText,
      cancelButtonText,
      reverseButtons: true,
    });
    return res.isConfirmed;
  },

  confirmDelete: (text = "Esta acción no se puede deshacer") =>
    alerts.confirm({
      title: "¿Eliminar?",
      text,
      confirmButtonText: "Sí, eliminar",
      icon: "warning",
    }),

  // Overlay de carga
  loading: (title = "Procesando...") =>
    Swal.fire({
      title,
      allowEscapeKey: false,
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    }),

  close: () => Swal.close(),
};
