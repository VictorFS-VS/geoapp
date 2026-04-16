// src/pages/InformesProyecto.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Table, Button, Badge, Spinner, Modal, Alert, Form } from "react-bootstrap";
import Swal from "sweetalert2";

import InformeModal from "@/components/InformeModal";
import ScoringResultPanel from "@/modules/diagnostico/ScoringResultPanel";
import ImportarFotosZipModal from "@/modules/informes/ImportarFotosZipModal";
import { useAuth } from "@/auth/AuthContext";
import { useInformesQuery } from "@/hooks/useInformesQuery";
import InformesTableOperativo from "@/components/informes/InformesTableOperativo";
import Pagination from "@/components/ui/Pagination";

function normalizeApiBase(base) {
  const b = String(base || "").trim();
  if (!b) return "";
  return b.endsWith("/api") ? b : b.replace(/\/+$/, "") + "/api";
}

const API_URL = normalizeApiBase(import.meta.env.VITE_API_URL) || "http://localhost:4000/api";
const PUBLIC_API_URL = normalizeApiBase(import.meta.env.VITE_PUBLIC_API_URL) || API_URL;

const authHeaders = () => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("jwt");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
};

const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
  width: 420,
  didOpen: (popup) => {
    popup.style.wordBreak = "break-word";
    popup.style.overflowWrap = "anywhere";
    popup.style.whiteSpace = "normal";
  },
});

function getFilenameFromContentDisposition(cd) {
  if (!cd) return "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);
  try {
    return decodeURIComponent(m?.[1] || m?.[2] || "");
  } catch {
    return m?.[1] || m?.[2] || "";
  }
}

async function downloadWithAuth(url, fallbackFilename) {
  const resp = await fetch(url, {
    method: "GET",
    headers: { ...authHeaders(), Accept: "*/*" },
  });

  if (!resp.ok) {
    const ct = resp.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    let msg = "";
    let data = null;

    if (isJson) {
      data = await resp.json().catch(() => null);
      msg = data?.error || data?.message || "";
    } else {
      msg = await resp.text().catch(() => "");
    }

    const err = new Error(`HTTP ${resp.status} ${msg}`.trim());
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  const blob = await resp.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  const cd = resp.headers.get("content-disposition") || "";
  const filename = getFilenameFromContentDisposition(cd) || fallbackFilename || "archivo";

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(blobUrl);
}

// ✅ storage key para pick global por proyecto+plantilla
function kmzPickStorageKey(idProyecto, idPlantillaFiltro) {
  const pl = idPlantillaFiltro ? String(idPlantillaFiltro) : "ALL";
  return `kmz_pick_global:p${idProyecto}:pl${pl}`;
}
function kmzPickByInformeKey(idInforme) {
  return `kmz_pick_informe:${idInforme}`;
}

// fallback perms desde localStorage.user (por si AuthContext aún está cargando)
function getUserPermsFromStorage() {
  try {
    const s = localStorage.getItem("user");
    if (!s) return [];
    const u = JSON.parse(s);

    const p = u?.perms ?? u?.permissions ?? u?.permisos ?? [];
    if (Array.isArray(p)) return p.map(String);
    if (typeof p === "string")
      return p
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

// chequeo de permiso robusto (AuthContext -> auth.user.perms -> localStorage)
function hasPerm(auth, code) {
  if (typeof auth?.hasPerm === "function") return !!auth.hasPerm(code);
  const permsAuth = auth?.user?.perms;
  if (Array.isArray(permsAuth)) return permsAuth.includes(code);
  const permsLS = getUserPermsFromStorage();
  return permsLS.includes(code);
}

function isAdminUser(auth) {
  const raw = auth?.user;
  const t = Number(raw?.tipo_usuario ?? raw?.group_id);
  if (t === 1) return true;
  try {
    const s = localStorage.getItem("user");
    if (!s) return false;
    const u = JSON.parse(s);
    const t2 = Number(u?.tipo_usuario ?? u?.group_id);
    return t2 === 1;
  } catch {
    return false;
  }
}

const InformesProyecto = () => {
  const { idProyecto } = useParams();
  const navigate = useNavigate();

  const auth = useAuth();
  const authLoading = !!auth?.loading;

  const [searchParams] = useSearchParams();
  const plantillaParam = searchParams.get("plantilla");

  const idPlantillaFiltro = useMemo(() => {
    if (!plantillaParam) return null;
    const n = Number(plantillaParam);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [plantillaParam]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const { informes, meta, loading, error, preguntasPlantilla, formulaActiva, cargarInformes } = useInformesQuery(idProyecto, idPlantillaFiltro, { search, page, limit });

  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [idInformeSel, setIdInformeSel] = useState(null);
  
  // Scroring Modal
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [idRegistroSel, setIdRegistroSel] = useState(null);

  const [downloading, setDownloading] = useState({
    pdf: false,
    docx: false,
    docxTabla: false,
    xlsx: false,
    kmz: false,
  });

  const [downloadingKmzByInforme, setDownloadingKmzByInforme] = useState({});

  // ✅ Modal choice KMZ
  const [kmzChoiceOpen, setKmzChoiceOpen] = useState(false);
  const [kmzChoiceInfo, setKmzChoiceInfo] = useState(null);
  const [kmzChoiceSelected, setKmzChoiceSelected] = useState(null);
  const [kmzChoiceScope, setKmzChoiceScope] = useState(null); // "proyecto" | "informe"
  const [kmzChoiceInformeId, setKmzChoiceInformeId] = useState(null);

  const kmzPickGlobalRef = useRef(null);

  const [showImportZip, setShowImportZip] = useState(false);
  const [evaluando, setEvaluando] = useState(false);

  const handleEjecutarEvaluacionMasiva = async () => {
    if (!idProyecto || !idPlantillaFiltro) return;

    const result = await Swal.fire({
      title: 'Evaluación de Fórmulas',
      text: `¿Desea ejecutar la evaluación de la fórmula "${formulaActiva?.nombre}" (Versión ${formulaActiva?.version}) sobre todos los informes de este proyecto?`,
      icon: 'info',
      showCancelButton: true,
      confirmButtonText: 'Sí, Ejecutar Ahora',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0d6efd'
    });

    if (!result.isConfirmed) return;

    try {
      setEvaluando(true);
      const res = await fetch(`${API_URL}/diagnostico/evaluar-plantilla`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          id_proyecto: idProyecto, 
          id_plantilla: idPlantillaFiltro 
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al procesar");

      const { stats } = json;
      Swal.fire({
        icon: 'success',
        title: 'Evaluación Completada',
        html: `
          <div class="text-start small">
            <p>Se procesaron <b>${stats.procesados}</b> registros.</p>
            <ul>
              <li class="text-primary">Con cambios: ${stats.con_cambios}</li>
              <li class="text-muted">Sin cambios: ${stats.sin_cambios}</li>
              <li class="text-warning">Ignorados (Override): ${stats.ignorados_override}</li>
              ${stats.errores > 0 ? `<li class="text-danger">Errores: ${stats.errores}</li>` : ''}
            </ul>
          </div>
        `
      });

      cargarInformes(); // Recargar tabla
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setEvaluando(false);
    }
  };

  useEffect(() => {
    if (!idProyecto) return;
    const key = kmzPickStorageKey(idProyecto, idPlantillaFiltro);
    const stored = localStorage.getItem(key);
    const n = stored ? Number(stored) : null;
    kmzPickGlobalRef.current = Number.isFinite(n) && n > 0 ? n : null;
  }, [idProyecto, idPlantillaFiltro]);

  // ✅ PERMISOS REALES
  const puedeEditar = useMemo(() => hasPerm(auth, "informes.update"), [auth?.user]);
  const puedeEliminar = useMemo(() => hasPerm(auth, "informes.delete"), [auth?.user]);
  const esAdmin = useMemo(() => isAdminUser(auth), [auth?.user]);

  // 👇 ya NO depende de admin
  const puedeEliminarAdmin = useMemo(() => esAdmin || puedeEliminar, [esAdmin, puedeEliminar]);

  // KMZ
  const puedeDescargarKmz = useMemo(() => hasPerm(auth, "informes.export"), [auth?.user]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allIds = useMemo(
    () => (informes || []).map((i) => Number(i.id_informe)).filter((n) => Number.isFinite(n) && n > 0),
    [informes]
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const headerCheckboxRef = useRef(null);

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedIds.length > 0 && !allSelected;
    }
  }, [selectedIds, allSelected]);

  useEffect(() => {
    if (!allIds.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => allIds.includes(id)));
  }, [allIds]);

  const formatearFecha = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleString("es-PY");
  };

  const getClasificacionColor = (clasificacion) => {
    const c = String(clasificacion || "").toLowerCase();
    if (c.includes("alto") || c.includes("vulnerable") || c.includes("crítico") || c.includes("critico")) return "danger";
    if (c.includes("medio") || c.includes("alerta")) return "warning";
    if (c.includes("bajo") || c.includes("seguro") || c.includes("bajo")) return "success";
    return "secondary";
  };

  const descargarPdfInforme = async (idInforme) => {
    try {
      const url = `${API_URL}/informes/${idInforme}/pdf`;
      await downloadWithAuth(url, `Informe_${idInforme}.pdf`);
    } catch (err) {
      console.error("Error descargando PDF individual:", err);
      Toast.fire({ icon: "error", title: "No se pudo descargar el PDF del informe." });
    }
  };

  const descargarKmzInforme = async (idInforme) => {
    if (!puedeDescargarKmz) {
      Toast.fire({ icon: "error", title: "No tiene permisos para descargar KMZ." });
      return;
    }

    try {
      setDownloadingKmzByInforme((m) => ({ ...m, [idInforme]: true }));
      const url = `${API_URL}/informe-kmz/informe/${idInforme}/kmz`;
      await downloadWithAuth(url, `Informe_${idInforme}.kmz`);
      Toast.fire({ icon: "success", title: "KMZ (informe) descargado." });
    } catch (err) {
      if (err?.status === 409 && err?.data?.needs_choice) {
        const payload = err.data;

        let pre = null;
        try {
          const stored = localStorage.getItem(kmzPickByInformeKey(idInforme));
          const n = stored ? Number(stored) : null;
          pre = Number.isFinite(n) && n > 0 ? n : null;
        } catch {}

        const cands = payload.candidates || [];
        const first = cands[0]?.id_pregunta ?? null;

        setKmzChoiceScope("informe");
        setKmzChoiceInformeId(Number(idInforme));
        setKmzChoiceInfo(payload);
        setKmzChoiceSelected(pre || first);
        setKmzChoiceOpen(true);
        return;
      }

      console.error("Error descargando KMZ informe:", err);
      Toast.fire({ icon: "error", title: err?.message || "No se pudo descargar el KMZ del informe." });
    } finally {
      setDownloadingKmzByInforme((m) => ({ ...m, [idInforme]: false }));
    }
  };

  const descargarProyecto = async (ext) => {
    try {
      setDownloading((s) => ({ ...s, [ext]: true }));

      const qs = idPlantillaFiltro ? `?plantilla=${idPlantillaFiltro}` : "";
      let url = "";
      let filename = "";

      if (ext === "xlsx") {
        url = `${API_URL}/informes/proyecto/${idProyecto}/export/excel${qs}`;
        filename = `Proyecto_${idProyecto}_Informes_KOBO${idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : ""}.xlsx`;
      } else {
        url = `${API_URL}/informes/proyecto/${idProyecto}/${ext}${qs}`;
        filename = `Informes_Proyecto_${idProyecto}${idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : ""}.${ext}`;
      }

      await downloadWithAuth(url, filename);
      Toast.fire({ icon: "success", title: `${ext.toUpperCase()} descargado.` });
    } catch (err) {
      console.error(`Error descargando ${ext}:`, err);
      Toast.fire({ icon: "error", title: `No se pudo descargar el ${ext.toUpperCase()}.` });
    } finally {
      setDownloading((s) => ({ ...s, [ext]: false }));
    }
  };

  const descargarProyectoDocx = async (modo) => {
    const key = modo === "tabla" ? "docxTabla" : "docx";
    try {
      setDownloading((s) => ({ ...s, [key]: true }));

      const params = new URLSearchParams();
      if (idPlantillaFiltro) params.set("plantilla", String(idPlantillaFiltro));
      if (modo === "tabla") params.set("modo", "tabla");
      const qs = params.toString() ? `?${params.toString()}` : "";

      const url = `${API_URL}/informes/proyecto/${idProyecto}/docx${qs}`;

      const suffixPlantilla = idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : "";
      const suffixModo = modo === "tabla" ? `_TABLA` : `_NORMAL`;
      const filename = `Informes_Proyecto_${idProyecto}${suffixPlantilla}${suffixModo}.docx`;

      await downloadWithAuth(url, filename);
      Toast.fire({
        icon: "success",
        title: modo === "tabla" ? "WORD (TABLA) descargado." : "WORD (NORMAL) descargado."
      });
    } catch (err) {
      console.error("Error descargando docx:", err);
      Toast.fire({ icon: "error", title: "No se pudo descargar el WORD." });
    } finally {
      setDownloading((s) => ({ ...s, [key]: false }));
    }
  };

  const descargarProyectoKmz = async () => {
    if (!puedeDescargarKmz) {
      Toast.fire({ icon: "error", title: "No tiene permisos para descargar KMZ." });
      return;
    }

    try {
      setDownloading((s) => ({ ...s, kmz: true }));

      const params = new URLSearchParams();
      if (idPlantillaFiltro) params.set("plantilla", String(idPlantillaFiltro));
      const qs = params.toString() ? `?${params.toString()}` : "";

      const url = `${API_URL}/informe-kmz/proyecto/${idProyecto}/kmz${qs}`;
      const filename = `Proyecto_${idProyecto}_Informes${idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : ""}.kmz`;

      await downloadWithAuth(url, filename);
      Toast.fire({ icon: "success", title: "KMZ (proyecto) descargado." });

      setKmzChoiceOpen(false);
      setKmzChoiceInfo(null);
      setKmzChoiceSelected(null);
      setKmzChoiceScope(null);
      setKmzChoiceInformeId(null);
    } catch (err) {
      if (err?.status === 409 && err?.data?.needs_choice) {
        const payload = err.data;
        const first = payload?.candidates?.[0]?.id_pregunta ?? null;
        const pre = kmzPickGlobalRef.current || null;

        setKmzChoiceScope("proyecto");
        setKmzChoiceInformeId(null);
        setKmzChoiceInfo(payload);
        setKmzChoiceSelected(pre || first);
        setKmzChoiceOpen(true);
        return;
      }

      console.error("Error descargando KMZ proyecto:", err);
      Toast.fire({ icon: "error", title: err?.message || "No se pudo generar KMZ." });
    } finally {
      setDownloading((s) => ({ ...s, kmz: false }));
    }
  };

  const confirmarKmzChoice = async () => {
    const idPreg = Number(kmzChoiceSelected);
    if (!idPreg) {
      Toast.fire({ icon: "error", title: "Elegí una coordenada para continuar." });
      return;
    }

    const scope = kmzChoiceScope;
    setKmzChoiceOpen(false);

    if (scope === "proyecto") {
      kmzPickGlobalRef.current = idPreg;
      try {
        localStorage.setItem(kmzPickStorageKey(idProyecto, idPlantillaFiltro), String(idPreg));
      } catch {}

      const params = new URLSearchParams();
      if (idPlantillaFiltro) params.set("plantilla", String(idPlantillaFiltro));
      params.set("pick", String(idPreg));

      const url = `${API_URL}/informe-kmz/proyecto/${idProyecto}/kmz?${params.toString()}`;
      const filename = `Proyecto_${idProyecto}_Informes${idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : ""}.kmz`;

      try {
        setDownloading((s) => ({ ...s, kmz: true }));
        await downloadWithAuth(url, filename);
        Toast.fire({ icon: "success", title: "KMZ (proyecto) descargado." });
      } catch (e) {
        Toast.fire({ icon: "error", title: e?.message || "No se pudo descargar el KMZ." });
      } finally {
        setDownloading((s) => ({ ...s, kmz: false }));
      }

      setKmzChoiceInfo(null);
      setKmzChoiceSelected(null);
      setKmzChoiceScope(null);
      setKmzChoiceInformeId(null);
      return;
    }

    if (scope === "informe") {
      const idInf = Number(kmzChoiceInformeId);
      if (!idInf) {
        Toast.fire({ icon: "error", title: "No se pudo determinar el informe." });
        return;
      }

      try {
        localStorage.setItem(kmzPickByInformeKey(idInf), String(idPreg));
      } catch {}

      try {
        setDownloadingKmzByInforme((m) => ({ ...m, [idInf]: true }));
        const url = `${API_URL}/informe-kmz/informe/${idInf}/kmz?pick=${encodeURIComponent(String(idPreg))}`;
        await downloadWithAuth(url, `Informe_${idInf}.kmz`);
        Toast.fire({ icon: "success", title: "KMZ (informe) descargado." });
      } catch (e) {
        Toast.fire({ icon: "error", title: e?.message || "No se pudo descargar el KMZ." });
      } finally {
        setDownloadingKmzByInforme((m) => ({ ...m, [idInf]: false }));
      }

      setKmzChoiceInfo(null);
      setKmzChoiceSelected(null);
      setKmzChoiceScope(null);
      setKmzChoiceInformeId(null);
    }
  };

  const limpiarKmzPickGlobal = () => {
    kmzPickGlobalRef.current = null;
    try {
      localStorage.removeItem(kmzPickStorageKey(idProyecto, idPlantillaFiltro));
    } catch {}
    Toast.fire({ icon: "success", title: "Selección KMZ global reiniciada." });
  };

  const copiarLinkKmzProyecto = async () => {
    const params = new URLSearchParams();
    if (idPlantillaFiltro) params.set("plantilla", String(idPlantillaFiltro));
    const pickGlobal = kmzPickGlobalRef.current;
    if (pickGlobal) params.set("pick", String(pickGlobal));
    const link = `${PUBLIC_API_URL}/informe-kmz/proyecto/${idProyecto}/kmz?${params.toString()}`;

    try {
      await navigator.clipboard.writeText(link);
      Toast.fire({ icon: "success", title: "Link KMZ copiado al portapapeles." });
    } catch {
      window.prompt("Copiá este link KMZ:", link);
    }
  };

  const abrirVer = (idInforme) => {
    setIdInformeSel(Number(idInforme));
    setShowViewModal(true);
  };

  const abrirEditar = (idInforme) => {
    if (!puedeEditar) {
      Toast.fire({ icon: "error", title: "No tiene permisos para editar informes." });
      return;
    }
    setIdInformeSel(Number(idInforme));
    setShowEditModal(true);
  };

  const eliminarInforme = async (idInforme) => {
    if (!puedeEliminarAdmin) {
      Toast.fire({ icon: "error", title: "No tiene permisos para eliminar informes." });
      return;
    }

    const result = await Swal.fire({
      icon: "warning",
      title: `¿Eliminar informe #${idInforme}?`,
      text: "Esta acción no se puede deshacer.",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#d33",
    });

    if (!result.isConfirmed) return;

    try {
      const resp = await fetch(`${API_URL}/informes/${idInforme}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Error ${resp.status}`);
      }

      await cargarInformes();
      Toast.fire({ icon: "success", title: "Informe eliminado correctamente." });
    } catch (err) {
      console.error("Error eliminando informe:", err);
      Toast.fire({ icon: "error", title: "No se pudo eliminar el informe." });
    }
  };



  const toggleSelection = (id) => {
    const n = Number(id);
    setSelectedIds(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  };

  const selectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const eliminarSeleccionados = async () => {
    if (!puedeEliminarAdmin) {
      Toast.fire({ icon: "error", title: "No tiene permisos para eliminar informes." });
      return;
    }
    if (!idPlantillaFiltro) {
      Toast.fire({ icon: "error", title: "Debe filtrar por plantilla para borrar en masa." });
      return;
    }
    if (selectedIds.length === 0) return;

    const result = await Swal.fire({
      icon: "warning",
      title: `¿Eliminar ${selectedIds.length} informes?`,
      text: `Plantilla #${idPlantillaFiltro}. Esta acción no se puede deshacer.`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#d33",
    });

    if (!result.isConfirmed) return;

    try {
      setBulkDeleting(true);
      const resp = await fetch(
        `${API_URL}/informes/proyecto/${idProyecto}/plantilla/${idPlantillaFiltro}/bulk-delete`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds }),
        }
      );

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Error ${resp.status}`);
      }

      setSelectedIds([]);
      await cargarInformes();
      Toast.fire({ icon: "success", title: "Informes eliminados correctamente." });
    } catch (err) {
      console.error("Error eliminando informes en masa:", err);
      Toast.fire({ icon: "error", title: err?.message || "No se pudo eliminar los informes." });
    } finally {
      setBulkDeleting(false);
    }
  };

  const eliminarTodosPlantilla = async () => {
    if (!puedeEliminarAdmin) {
      Toast.fire({ icon: "error", title: "No tiene permisos para eliminar informes." });
      return;
    }
    if (!idPlantillaFiltro) {
      Toast.fire({ icon: "error", title: "Debe filtrar por plantilla para borrar en masa." });
      return;
    }

    const total = informes?.length || 0;

    const result = await Swal.fire({
      icon: "warning",
      title: "¿Eliminar TODOS los informes de la plantilla?",
      text: `Plantilla #${idPlantillaFiltro}. Esta acción es irreversible${total ? ` y eliminará al menos ${total} registros cargados.` : "."}`,
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar todo",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#d33",
    });

    if (!result.isConfirmed) return;

    try {
      setBulkDeleting(true);
      const resp = await fetch(
        `${API_URL}/informes/proyecto/${idProyecto}/plantilla/${idPlantillaFiltro}/bulk-delete`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }
      );

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || `Error ${resp.status}`);
      }

      setSelectedIds([]);
      await cargarInformes();
      Toast.fire({
        icon: "success",
        title: `Informes eliminados correctamente (${data.deleted_count || 0}).`,
      });
    } catch (err) {
      console.error("Error eliminando todos los informes:", err);
      Toast.fire({ icon: "error", title: err?.message || "No se pudo eliminar los informes." });
    } finally {
      setBulkDeleting(false);
    }
  };

  const anyDownloading =
    downloading.pdf || downloading.docx || downloading.docxTabla || downloading.xlsx || downloading.kmz;

  const choiceCandidates = useMemo(() => {
    const c = kmzChoiceInfo?.candidates || [];
    const map = new Map();
    for (const it of c) {
      const k = `${it.id_pregunta}`;
      if (!map.has(k)) map.set(k, it);
    }
    return [...map.values()];
  }, [kmzChoiceInfo]);

  const modalTitle = useMemo(() => {
    if (kmzChoiceScope === "informe") return `Informe #${kmzChoiceInformeId} — Elegir coordenada`;
    return `Proyecto #${idProyecto} — Informe #${kmzChoiceInfo?.id_informe} — Elegir coordenada`;
  }, [kmzChoiceScope, kmzChoiceInformeId, idProyecto, kmzChoiceInfo]);

  const modalHint = useMemo(() => {
    if (kmzChoiceScope === "informe") {
      return (
        <>
          Se detectaron varias coordenadas posibles para este <b>informe</b>. Elegí cuál usar.
        </>
      );
    }
    return (
      <>
        Se detectaron varias coordenadas posibles. Elegí cuál usar para el KMZ.
        <br />
        <small>
          (Elección global por proyecto/plantilla. Tu selección queda guardada y preseleccionada.)
        </small>
      </>
    );
  }, [kmzChoiceScope]);

  return (
    <div className="container mt-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 className="mb-0">Informes dinámicos del proyecto #{idProyecto}</h4>
          <small className="text-muted">Listado de informes generados a partir de plantillas.</small>

          {authLoading && (
            <div className="mt-2">
              <Badge bg="secondary">Cargando permisos…</Badge>
            </div>
          )}

          {idPlantillaFiltro ? (
            <div className="mt-2">
              <Badge bg="info">Filtro: Plantilla #{idPlantillaFiltro}</Badge>
            </div>
          ) : null}
        </div>

        <div className="d-flex gap-2 flex-wrap justify-content-end">
          {puedeEliminarAdmin ? (
            <div className="d-flex align-items-center gap-2">
              <Badge bg={selectedIds.length ? "danger" : "secondary"}>
                Seleccionados: {selectedIds.length}
              </Badge>
              <Button
                variant="danger"
                disabled={!idPlantillaFiltro || selectedIds.length === 0 || bulkDeleting}
                onClick={eliminarSeleccionados}
                title={!idPlantillaFiltro ? "Debés filtrar por plantilla" : "Eliminar seleccionados"}
              >
                {bulkDeleting ? "Eliminando..." : "Eliminar seleccionados"}
              </Button>
              <Button
                variant="outline-danger"
                disabled={!idPlantillaFiltro || bulkDeleting}
                onClick={eliminarTodosPlantilla}
                title={!idPlantillaFiltro ? "Debés filtrar por plantilla" : "Eliminar todos los informes de la plantilla"}
              >
                {bulkDeleting ? "Eliminando..." : "Eliminar TODOS (plantilla)"}
              </Button>
            </div>
          ) : null}

          <Button variant="secondary" onClick={() => navigate(-1)}>
            Volver
          </Button>

          <Button
            variant="outline-primary"
            onClick={() => {
              const qp = new URLSearchParams();
              if (idProyecto) qp.set("id_proyecto", String(idProyecto));
              if (idPlantillaFiltro) qp.set("id_plantilla", String(idPlantillaFiltro));
              navigate(`/dashboardinformes?${qp.toString()}`);
            }}
          >
            Dashboard V2
          </Button>

          <div className="btn-group">
            <Button variant="outline-danger" onClick={() => descargarProyecto("pdf")} disabled={anyDownloading}>
              {downloading.pdf ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>📄 PDF</>
              )}
            </Button>

            <Button variant="outline-primary" onClick={() => descargarProyectoDocx("normal")} disabled={anyDownloading}>
              {downloading.docx ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>📝 Word</>
              )}
            </Button>

            <Button variant="outline-primary" onClick={() => descargarProyectoDocx("tabla")} disabled={anyDownloading}>
              {downloading.docxTabla ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>🧾 Word Tabla</>
              )}
            </Button>

            <Button variant="outline-success" onClick={() => descargarProyecto("xlsx")} disabled={anyDownloading}>
              {downloading.xlsx ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>📊 Excel</>
              )}
            </Button>

            {puedeDescargarKmz && (
              <Button variant="outline-dark" onClick={descargarProyectoKmz} disabled={anyDownloading}>
                {downloading.kmz ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />...
                  </>
                ) : (
                  <>🗺️ KMZ</>
                )}
              </Button>
            )}
          </div>

          {puedeDescargarKmz && (
            <Button variant="outline-secondary" onClick={copiarLinkKmzProyecto} disabled={anyDownloading}>
              🔗 Link KMZ
            </Button>
          )}

          <Button
            variant="outline-success"
            disabled={!idPlantillaFiltro || anyDownloading}
            onClick={() => setShowImportZip(true)}
            title={!idPlantillaFiltro ? "Debés filtrar por plantilla" : "Importación masiva de fotos via ZIP"}
          >
            📦 Importar Fotos (ZIP)
          </Button>

          {formulaActiva && (
            <Button
              variant="outline-primary"
              onClick={() => navigate(`/proyectos/${idProyecto}/diagnostico?plantilla=${idPlantillaFiltro}`)}
              title="Abrir panel de Autodiagnóstico"
            >
              <i className="bi bi-clipboard2-data"></i> Diagnóstico
            </Button>
          )}

          <Button variant="primary" onClick={() => navigate(`/proyectos/${idProyecto}/informes/nuevo`)}>
            ➕ Nuevo informe
          </Button>
        </div>
      </div>

      <div className="mb-3 d-flex gap-3 align-items-center">
        <Form.Control
          type="text"
          placeholder="Buscar por cualquier campo..."
          value={search}
          onChange={(e) => {
             setSearch(e.target.value);
             setPage(1); // Reset page on new search
          }}
          disabled={loading && !informes.length}
          style={{ maxWidth: '400px' }}
        />
      </div>

      {loading && (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" /> Cargando informes...
        </div>
      )}

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && !error && informes.length === 0 && search && (
        <Alert variant="info" className="text-center py-3 mt-3">
          Sin resultados para la búsqueda "{search}"
        </Alert>
      )}

      {!loading && !error && informes.length === 0 && !search && (
        <Alert variant="light" className="text-center text-muted border py-3 mt-3">
          No hay informes para mostrar en esta vista.
        </Alert>
      )}

      {!error && informes.length > 0 && (
        <>
          <InformesTableOperativo
            informes={informes}
            preguntasPlantilla={preguntasPlantilla}
            abrirVer={abrirVer}
            abrirEditar={abrirEditar}
            eliminarInforme={eliminarInforme}
            descargarPdfInforme={descargarPdfInforme}
            descargarKmzInforme={descargarKmzInforme}
            puedeEditar={puedeEditar}
            puedeEliminarAdmin={puedeEliminarAdmin}
            puedeDescargarKmz={puedeDescargarKmz}
            downloadingKmzByInforme={downloadingKmzByInforme}
            anyDownloading={anyDownloading}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
            onSelectAll={selectAll}
            allSelected={allSelected}
          />
          <Pagination 
            page={meta?.page || 1} 
            totalPages={meta?.total_pages || 1} 
            limit={limit}
            onLimitChange={(l) => {
                setLimit(l);
                setPage(1);
            }}
            totalItems={meta?.total || 0}
            onPageChange={setPage} 
          />
        </>
      )}

      <InformeModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        idInforme={idInformeSel}
        mode="view"
      />

      <InformeModal
        show={showEditModal}
        onHide={() => setShowEditModal(false)}
        idInforme={idInformeSel}
        mode="edit"
        onSaved={() => cargarInformes()}
      />

      <Modal 
        show={showScoringModal} 
        onHide={() => setShowScoringModal(false)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>Diagnóstico Detallado</Modal.Title>
        </Modal.Header>
        <Modal.Body className="bg-light">
          {idRegistroSel && <ScoringResultPanel idRegistro={idRegistroSel} canEditOverride={puedeEditar} />}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowScoringModal(false)}>Cerrar</Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={kmzChoiceOpen}
        onHide={() => {
          setKmzChoiceOpen(false);
          setKmzChoiceInfo(null);
          setKmzChoiceSelected(null);
          setKmzChoiceScope(null);
          setKmzChoiceInformeId(null);
        }}
        centered
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>{modalTitle}</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Alert variant="info" className="mb-3">
            {modalHint}
          </Alert>

          {choiceCandidates.length === 0 ? (
            <div className="text-muted">No se recibieron candidatos desde el backend.</div>
          ) : (
            <Form>
              {choiceCandidates.map((c) => {
                const label = `${c.etiqueta} — ${c.kind === "utm_xy" ? "X/Y" : "Lat/Lng"} — ${c.preview}`;
                return (
                  <Form.Check
                    key={`${c.id_pregunta}-${c.preview}`}
                    type="radio"
                    name="kmzChoice"
                    id={`kmzChoice_${c.id_pregunta}`}
                    label={label}
                    checked={Number(kmzChoiceSelected) === Number(c.id_pregunta)}
                    onChange={() => setKmzChoiceSelected(Number(c.id_pregunta))}
                    className="py-2"
                  />
                );
              })}
            </Form>
          )}
        </Modal.Body>

        <Modal.Footer className="justify-content-between">
          <div className="d-flex gap-2">
            {kmzChoiceScope === "proyecto" ? (
              <Button variant="outline-secondary" onClick={limpiarKmzPickGlobal}>
                Reiniciar elección global
              </Button>
            ) : (
              <span className="text-muted small">(Este selector aplica a este informe)</span>
            )}
          </div>

          <div className="d-flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setKmzChoiceOpen(false);
                setKmzChoiceInfo(null);
                setKmzChoiceSelected(null);
                setKmzChoiceScope(null);
                setKmzChoiceInformeId(null);
              }}
            >
              Cancelar
            </Button>

            <Button variant="primary" onClick={confirmarKmzChoice}>
              Usar esta
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

      <ImportarFotosZipModal
        show={showImportZip}
        onHide={() => {
          setShowImportZip(false);
          cargarInformes();
        }}
        idProyecto={idProyecto}
        idPlantilla={idPlantillaFiltro}
        preguntas={preguntasPlantilla}
      />
    </div>
  );
};

export default InformesProyecto;