// src/utils/loadGoogleMapsApi.js
let googleMapsApiPromise = null;

function isReady() {
  return !!(window.google?.maps?.Map);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyLoadError(err) {
  const msg = String(err?.message || err || "").toLowerCase();

  // Offline
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      code: "OFFLINE",
      userMessage: "Sin conexión a internet. Verificá tu red y reintentá.",
    };
  }

  // DNS / Name not resolved
  if (msg.includes("err_name_not_resolved") || msg.includes("name not resolved")) {
    return {
      code: "DNS",
      userMessage:
        "No se pudo resolver maps.googleapis.com (problema temporal de DNS/red). Probá recargar o revisar tu internet.",
    };
  }

  // Bloqueo/Adblock/CSP
  if (msg.includes("blocked") || msg.includes("csp") || msg.includes("content security")) {
    return {
      code: "BLOCKED",
      userMessage:
        "El navegador bloqueó la carga de Google Maps (CSP/AdBlock/Firewall). Probá desactivar bloqueadores o revisar políticas de red.",
    };
  }

  // Default
  return {
    code: "UNKNOWN",
    userMessage:
      "No se pudo cargar Google Maps. Probá recargar la página y verificar tu conexión.",
  };
}

function buildSrc({ apiKey, libraries, callbackName }) {
  const libs = Array.isArray(libraries) ? libraries.join(",") : String(libraries || "");
  return (
    `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
    (libs ? `&libraries=${encodeURIComponent(libs)}` : "") +
    `&v=weekly&loading=async&callback=${encodeURIComponent(callbackName)}`
  );
}

async function loadOnce({ apiKey, libraries = ["geometry"], timeoutMs = 12000 }) {
  // ✅ ya cargado
  if (isReady()) return window.google;

  // ✅ si ya existe script, esperá (pero con timeout)
  const existing = document.getElementById("gmaps-script");
  if (existing) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error("GMAPS_TIMEOUT_EXISTING_SCRIPT"));
      }, timeoutMs);

      const onLoad = () => {
        clearTimeout(t);
        if (isReady()) resolve(window.google);
        else reject(new Error("GMAPS_LOADED_BUT_NOT_READY"));
      };

      const onError = (e) => {
        clearTimeout(t);
        reject(e || new Error("GMAPS_SCRIPT_ERROR"));
      };

      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
    });
  }

  // ✅ script nuevo con callback único
  const callbackName = `__init_gmaps_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(window.google);
    };

    const finishReject = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e || new Error("GMAPS_SCRIPT_ERROR"));
    };

    // Timeout fuerte
    const t = setTimeout(() => finishReject(new Error("GMAPS_TIMEOUT")), timeoutMs);

    window[callbackName] = () => {
      clearTimeout(t);
      if (isReady()) finishResolve();
      else finishReject(new Error("GMAPS_CALLBACK_BUT_NOT_READY"));
    };

    const script = document.createElement("script");
    script.id = "gmaps-script";
    script.async = true;
    script.defer = true;
    script.src = buildSrc({ apiKey, libraries, callbackName });

    script.onerror = (e) => {
      clearTimeout(t);
      finishReject(e);
    };

    document.head.appendChild(script);
  });
}

export async function loadGoogleMapsApi(apiKeyParam, opts = {}) {
  const apiKey =
    apiKeyParam ||
    import.meta.env.VITE_GOOGLE_MAPS_KEY ||
    import.meta.env.VITE_GMAPS_API_KEY;

  if (!apiKey) {
    throw new Error("Falta apiKey para Google Maps");
  }

  if (isReady()) return window.google;
  if (googleMapsApiPromise) return googleMapsApiPromise;

  const {
    libraries = ["geometry", "marker"], // ✅ si usás AdvancedMarker, conviene incluir marker
    retries = 2,                        // ✅ total intentos = 1 + retries
    timeoutMs = 12000,                  // ✅ timeout por intento
    backoffMs = 700,                    // ✅ espera base entre intentos
  } = opts;

  googleMapsApiPromise = (async () => {
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const g = await loadOnce({ apiKey, libraries, timeoutMs });
        return g;
      } catch (e) {
        lastErr = e;

        // Permitir reintento: limpiar script si existe y quedó roto
        const s = document.getElementById("gmaps-script");
        if (s && !isReady()) {
          try { s.remove(); } catch {}
        }

        if (attempt < retries) {
          // backoff simple
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
      }
    }

    // Convertir a error “amigable”
    const info = classifyLoadError(lastErr);
    const err = new Error(info.userMessage);
    err.code = info.code;
    err.original = lastErr;
    throw err;
  })()
    .catch((e) => {
      // ✅ permitir reintento futuro
      googleMapsApiPromise = null;
      throw e;
    });

  return googleMapsApiPromise;
}