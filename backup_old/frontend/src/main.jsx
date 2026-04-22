// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "bootstrap/dist/css/bootstrap.min.css";
import "sweetalert2/dist/sweetalert2.min.css";
import { hookConsoleToToasts } from "@/utils/consoleToasts";
import { registerSW } from "virtual:pwa-register";

// ✅ RBAC Provider
import { AuthProvider } from "@/auth/AuthContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

// ✅ Service Worker (PWA)
registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("✅ App lista para usar offline");
  },
  onNeedRefresh() {
    console.log("🔄 Hay una actualización disponible (recargá)");
  },
});

// ✅ Console → Toasts
hookConsoleToToasts({
  info: true,
  forward: {
    error: true,
    warn: false,
    log: false,
    info: false,
  },
  ignore: [/React Router Future Flag Warning/i, /relativeSplatPath/i],
  captureGlobal: true,
});