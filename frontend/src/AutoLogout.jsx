import { useEffect } from "react";
import { alerts } from "@/utils/alerts"; // ✅ correcto

export default function AutoLogout() {
  useEffect(() => {
    let timeout;

    const logout = () => {
      alerts.toast.warn("Sesión expirada por inactividad.");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setTimeout(() => (window.location.href = "/login"), 800);
    };

    const resetTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(logout, 4 * 60 * 60 * 1000);
    };

    const eventos = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    eventos.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));

    resetTimer();

    return () => {
      clearTimeout(timeout);
      eventos.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, []);

  return null;
}
