import Swal from 'sweetalert2';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
  width: 420,
  // Estilos inline para cortar textos/URLs largas (sin index.css)
  didOpen: (popup) => {
    popup.style.wordBreak = 'break-word';
    popup.style.overflowWrap = 'anywhere';
    popup.style.whiteSpace = 'normal';
  },
});

/** Stringify seguro y breve */
function fmt(arg) {
  try {
    if (arg instanceof Error) return arg.message || String(arg);
    if (typeof arg === 'object') {
      return JSON.stringify(arg, (_k, v) => (v instanceof Error ? v.message : v), 2);
    }
    return String(arg);
  } catch {
    return String(arg);
  }
}
function clamp(s, max = 500) {
  return s && s.length > max ? s.slice(0, max) + '…' : s;
}
function joinArgs(args) {
  return clamp(args.map(fmt).join(' '));
}

// Dedupe simple para StrictMode / duplicados rápidos
let lastKey = '';
let lastAt = 0;
function emit(icon, title) {
  const now = Date.now();
  const key = `${icon}|${title}`;
  if (key === lastKey && now - lastAt < 800) return;
  lastKey = key;
  lastAt = now;
  Toast.fire({ icon, title });
}

function matchAny(str, patterns = []) {
  return patterns.some((p) =>
    p instanceof RegExp ? p.test(str) : String(str).includes(String(p))
  );
}

/**
 * Intercepta console.* y errores globales para mostrar toasts.
 * @param {{
 *   info?: boolean,
 *   forward?: { error?: boolean, warn?: boolean, log?: boolean, info?: boolean },
 *   ignore?: Array<string|RegExp>,
 *   captureGlobal?: boolean
 * }} options
 * @returns {() => void} unhook
 */
export function hookConsoleToToasts({
  info = false,
  forward = { error: true, warn: false, log: false, info: false },
  ignore = [],
  captureGlobal = true,
} = {}) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  console.error = (...args) => {
    const msg = joinArgs(args);
    if (!matchAny(msg, ignore)) emit('error', msg);
    if (forward.error) original.error(...args);
  };

  console.warn = (...args) => {
    const msg = joinArgs(args);
    if (!matchAny(msg, ignore)) emit('warning', msg);
    if (forward.warn) original.warn(...args);
  };

  console.log = (...args) => {
    const msg = joinArgs(args);
    if (info && !matchAny(msg, ignore)) emit('info', msg);
    if (forward.log) original.log(...args);
  };

  console.info = (...args) => {
    const msg = joinArgs(args);
    if (info && !matchAny(msg, ignore)) emit('info', msg);
    if (forward.info) original.info(...args);
  };

  const onError = (event) => {
    const msg = event?.message || event?.error?.message || 'Error no controlado';
    if (!matchAny(msg, ignore)) emit('error', msg);
  };
  const onRejection = (event) => {
    const reason = event?.reason;
    const msg =
      (reason && (reason.message || (typeof reason === 'string' && reason))) ||
      'Promise rechazada sin manejar';
    if (!matchAny(String(msg), ignore)) emit('error', String(msg));
  };

  if (captureGlobal) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }

  // Restaurar
  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    console.info = original.info;
    if (captureGlobal) {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    }
  };
}
