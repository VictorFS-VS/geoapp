import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Table, Button, Badge, Spinner, Modal, Alert, Form } from "react-bootstrap";
import Swal from "sweetalert2";

import InformeModal from "@/components/InformeModal";
import InformesTableOperativo from "@/components/informes/InformesTableOperativo";
import ImportarFotosZipModal from "@/modules/informes/ImportarFotosZipModal";
import { useAuth } from "@/auth/AuthContext";

function normalizeApiBase(base) {
  const b = String(base || "").trim();
  if (!b) return "";
  return b.endsWith("/api") ? b : b.replace(/\/+$/, "") + "/api";
}

const API_URL = normalizeApiBase(import.meta.env.VITE_API_URL) || "http://localhost:4000/api";
const PUBLIC_API_URL = normalizeApiBase(import.meta.env.VITE_PUBLIC_API_URL) || API_URL;
const USE_OPERATIVE_TABLE = true;

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

const fireSwalTop = (options) =>
  Swal.fire({
    target: document.body,
    heightAuto: false,
    allowOutsideClick: true,
    allowEscapeKey: true,
    ...options,
    didOpen: (popup) => {
      const container = Swal.getContainer();
      if (container) {
        container.style.zIndex = "3000";
      }
      if (typeof options.didOpen === "function") {
        options.didOpen(popup);
      }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kmzPickStorageKey(idProyecto, idPlantillaFiltro) {
  const pl = idPlantillaFiltro ? String(idPlantillaFiltro) : "ALL";
  return `kmz_pick_global:p${idProyecto}:pl${pl}`;
}

function kmzPickByInformeKey(idInforme) {
  return `kmz_pick_informe:${idInforme}`;
}

function getUserPermsFromStorage() {
  try {
    const s = localStorage.getItem("user");
    if (!s) return [];
    const u = JSON.parse(s);

    const p = u?.perms ?? u?.permissions ?? u?.permisos ?? [];
    if (Array.isArray(p)) return p.map(String);
    if (typeof p === "string") {
      return p
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

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

  const [informes, setInformes] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [listPage, setListPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, page: 1, limit: 20, total_pages: 1 });
  const [listSort, setListSort] = useState({ sortBy: "fecha", sortOrder: "desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [idInformeSel, setIdInformeSel] = useState(null);

  const [downloading, setDownloading] = useState({
    pdf: false,
    docx: false,
    docxTabla: false,
    xlsx: false,
    kmz: false,
    docxRange: false,
    docxTablaRange: false,
    docxSingleRange: false,
    docxTablaSingleRange: false,
  });

  const [downloadingKmzByInforme, setDownloadingKmzByInforme] = useState({});

  const [kmzChoiceOpen, setKmzChoiceOpen] = useState(false);
  const [kmzChoiceInfo, setKmzChoiceInfo] = useState(null);
  const [kmzChoiceSelected, setKmzChoiceSelected] = useState(null);
  const [kmzChoiceScope, setKmzChoiceScope] = useState(null);
  const [kmzChoiceInformeId, setKmzChoiceInformeId] = useState(null);

  const kmzPickGlobalRef = useRef(null);

  const [showImportZip, setShowImportZip] = useState(false);

  const [preguntasPlantilla, setPreguntasPlantilla] = useState([]);
  const [seccionesPlantilla, setSeccionesPlantilla] = useState([]);

  const [showWordConfig, setShowWordConfig] = useState(false);
  const [reopenWordConfigAfterSwalCancel, setReopenWordConfigAfterSwalCancel] = useState(false);

  const [wordConfig, setWordConfig] = useState({
    modo: "normal",
    incluirFotos: true,
    fotosEnTabla: false,
    maxFotos: 2,
    page: 1,
    limit: 10,
    preguntas: [],
    secciones: [],
    orderBy: "fecha",
    orderDir: "asc",
    orderPreguntaId: "",
  });

  const [wordRange, setWordRange] = useState({
    from: 1,
    to: 1,
  });

  useEffect(() => {
    if (idPlantillaFiltro) {
      fetch(`${API_URL}/informes/plantillas/${idPlantillaFiltro}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          const secciones = Array.isArray(d.secciones) ? d.secciones : [];
          const seccionesConPreguntas = secciones.filter(
            (s) => Array.isArray(s.preguntas) && s.preguntas.length > 0
          );
          const allPreguntas = seccionesConPreguntas.flatMap((s) => s.preguntas || []);

          setSeccionesPlantilla(seccionesConPreguntas);
          setPreguntasPlantilla(allPreguntas);

          setWordConfig((prev) => ({
            ...prev,
            preguntas: [],
            secciones: [],
            page: 1,
            limit: 10,
            orderPreguntaId: "",
          }));
        })
        .catch((err) => {
          console.error("Error cargando preguntas de plantilla:", err);
          setSeccionesPlantilla([]);
          setPreguntasPlantilla([]);
        });
    } else {
      setPreguntasPlantilla([]);
      setSeccionesPlantilla([]);
      setWordConfig((prev) => ({
        ...prev,
        preguntas: [],
        secciones: [],
        page: 1,
        limit: 10,
        orderPreguntaId: "",
      }));
    }
  }, [idPlantillaFiltro]);

  useEffect(() => {
    if (!idProyecto) return;
    const key = kmzPickStorageKey(idProyecto, idPlantillaFiltro);
    const stored = localStorage.getItem(key);
    const n = stored ? Number(stored) : null;
    kmzPickGlobalRef.current = Number.isFinite(n) && n > 0 ? n : null;
  }, [idProyecto, idPlantillaFiltro]);

  useEffect(() => {
    setListPage(1);
  }, [idPlantillaFiltro]);

  const puedeEditar = useMemo(() => hasPerm(auth, "informes.update"), [auth?.user]);
  const puedeEliminar = useMemo(() => hasPerm(auth, "informes.delete"), [auth?.user]);
  useMemo(() => isAdminUser(auth), [auth?.user]);
  const puedeEliminarAdmin = useMemo(() => puedeEliminar, [puedeEliminar]);
  const puedeDescargarKmz = useMemo(() => hasPerm(auth, "informes.export"), [auth?.user]);

  const informesAdaptados = useMemo(() => {
    return (informes || []).map((informe) => {
      const respuestasClave =
        informe &&
        informe.respuestas_clave &&
        typeof informe.respuestas_clave === "object" &&
        !Array.isArray(informe.respuestas_clave)
          ? informe.respuestas_clave
          : {};
      const fallbackTitulo = informe?.titulo || `Informe #${informe?.id_informe ?? "-"}`;
      const respuestasNormalizadas =
        Object.keys(respuestasClave).length > 0
          ? respuestasClave
          : {
              titulo: fallbackTitulo,
            };

      return {
        ...informe,
        nombre_plantilla: informe?.nombre_plantilla || informe?.id_plantilla || "-",
        fecha_creado: informe?.fecha_creado || informe?.fecha || informe?.created_at || null,
        creado_por: informe?.creado_por || "-",
        respuestas_clave: respuestasNormalizadas,
      };
    });
  }, [informes]);

  const onToggleSelection = useCallback((idInforme) => {
    const id = Number(idInforme);
    if (!Number.isFinite(id) || id <= 0) return;

    setSelectedIds((prev) => {
      const set = new Set(prev.map(Number));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }, []);

  const handleSortChange = useCallback((sortBy) => {
    if (!sortBy) return;
    setListSort((prev) => {
      const nextOrder = prev.sortBy === sortBy && prev.sortOrder === "asc" ? "desc" : "asc";
      return { sortBy, sortOrder: nextOrder };
    });
    setListPage(1);
  }, []);

  const cargarInformes = useCallback(async () => {
    if (!idProyecto) return;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("id_proyecto", String(idProyecto));
      if (idPlantillaFiltro) params.set("id_plantilla", String(idPlantillaFiltro));

      const search = String(searchText || "").trim();
      if (search) params.set("search", search);

      params.set("page", String(Math.max(1, Number(listPage || 1))));
      params.set("limit", "20");
      params.set("sort_by", String(listSort.sortBy || "fecha"));
      params.set("sort_order", String(listSort.sortOrder || "desc"));

      const resp = await fetch(`${API_URL}/informes/query?${params.toString()}`, {
        headers: authHeaders(),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      const data = await resp.json();
      setInformes(Array.isArray(data.informes) ? data.informes : Array.isArray(data.data) ? data.data : []);
      setListMeta(
        data?.meta && typeof data.meta === "object"
          ? {
              total: Number(data.meta.total) || 0,
              page: Number(data.meta.page) || 1,
              limit: Number(data.meta.limit) || 20,
              total_pages: Number(data.meta.total_pages) || 1,
            }
          : { total: 0, page: 1, limit: 20, total_pages: 1 }
      );
    } catch (err) {
      console.error("Error cargando informes:", err);
      setError("No se pudieron cargar los informes.");
      Toast.fire({ icon: "error", title: err?.message || "No se pudieron cargar los informes." });
    } finally {
      setLoading(false);
    }
  }, [idProyecto, idPlantillaFiltro, searchText, listPage, listSort.sortBy, listSort.sortOrder]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      cargarInformes();
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [cargarInformes]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allIds = useMemo(
    () => (informes || []).map((i) => Number(i.id_informe)).filter((n) => Number.isFinite(n) && n > 0),
    [informes]
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id));
  const onSelectAll = useCallback(() => {
    setSelectedIds(allSelected ? [] : allIds);
  }, [allSelected, allIds]);
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

  const totalRegistrosExport = useMemo(() => Number(listMeta.total || 0), [listMeta.total]);
  const totalPaginasListado = useMemo(
    () => Math.max(1, Number(listMeta.total_pages || 1)),
    [listMeta.total_pages]
  );

  useEffect(() => {
    setListPage((prev) => {
      const next = Math.min(Math.max(1, Number(prev || 1)), totalPaginasListado);
      return next === prev ? prev : next;
    });
  }, [totalPaginasListado]);

  const limitOptions = useMemo(() => {
    return wordConfig.incluirFotos ? [10, 20] : [10, 20, 50, 100];
  }, [wordConfig.incluirFotos]);

  const totalPaginasWord = useMemo(() => {
    const lim = Math.max(1, Number(wordConfig.limit || 10));
    return Math.max(1, Math.ceil(totalRegistrosExport / lim));
  }, [totalRegistrosExport, wordConfig.limit]);

  const rangoDesdeWord = useMemo(() => {
    if (totalRegistrosExport <= 0) return 0;
    const page = Math.max(1, Number(wordConfig.page || 1));
    const lim = Math.max(1, Number(wordConfig.limit || 10));
    return (page - 1) * lim + 1;
  }, [totalRegistrosExport, wordConfig.page, wordConfig.limit]);

  const rangoHastaWord = useMemo(() => {
    if (totalRegistrosExport <= 0) return 0;
    const page = Math.max(1, Number(wordConfig.page || 1));
    const lim = Math.max(1, Number(wordConfig.limit || 10));
    return Math.min(page * lim, totalRegistrosExport);
  }, [totalRegistrosExport, wordConfig.page, wordConfig.limit]);

  useEffect(() => {
    setWordConfig((prev) => {
      let newLimit = Number(prev.limit || 10);

      if (!limitOptions.includes(newLimit)) {
        newLimit = limitOptions[0];
      }

      const totalPages = Math.max(1, Math.ceil(totalRegistrosExport / newLimit));
      let newPage = Number(prev.page || 1);

      if (newPage > totalPages) newPage = totalPages;
      if (newPage < 1) newPage = 1;

      if (newLimit === prev.limit && newPage === prev.page) return prev;

      return {
        ...prev,
        limit: newLimit,
        page: newPage,
      };
    });
  }, [limitOptions, informes.length]);

  useEffect(() => {
    setWordRange((prev) => {
      let from = Number(prev.from || 1);
      let to = Number(prev.to || 1);

      if (from < 1) from = 1;
      if (to < 1) to = 1;
      if (from > totalPaginasWord) from = totalPaginasWord;
      if (to > totalPaginasWord) to = totalPaginasWord;
      if (to < from) to = from;

      if (from === prev.from && to === prev.to) return prev;
      return { from, to };
    });
  }, [totalPaginasWord]);

  const seccionesDisponibles = useMemo(() => {
    return (seccionesPlantilla || []).filter((sec) => Array.isArray(sec.preguntas) && sec.preguntas.length > 0);
  }, [seccionesPlantilla]);

  const preguntasDisponibles = useMemo(() => {
    return (preguntasPlantilla || []).filter(Boolean);
  }, [preguntasPlantilla]);

  const selectedSeccionesSet = useMemo(
    () => new Set((wordConfig.secciones || []).map(Number)),
    [wordConfig.secciones]
  );

  const preguntasFiltradasPorSeccion = useMemo(() => {
    if (!Array.isArray(preguntasDisponibles) || preguntasDisponibles.length === 0) return [];

    if (!wordConfig.secciones || wordConfig.secciones.length === 0) {
      return preguntasDisponibles;
    }

    return preguntasDisponibles.filter((preg) =>
      selectedSeccionesSet.has(Number(preg.id_seccion))
    );
  }, [preguntasDisponibles, selectedSeccionesSet, wordConfig.secciones]);

  useEffect(() => {
    const idsPreguntasValidas = new Set(preguntasFiltradasPorSeccion.map((p) => Number(p.id_pregunta)));
    const idsSeccionesValidas = new Set(seccionesDisponibles.map((s) => Number(s.id_seccion)));

    setWordConfig((prev) => {
      const preguntasPrev = Array.isArray(prev.preguntas) ? prev.preguntas : [];
      const seccionesPrev = Array.isArray(prev.secciones) ? prev.secciones : [];
      const orderPreguntaActual = Number(prev.orderPreguntaId || 0);

      const nuevasPreguntas = preguntasPrev.filter((id) => idsPreguntasValidas.has(Number(id)));
      const nuevasSecciones = seccionesPrev.filter((id) => idsSeccionesValidas.has(Number(id)));

      const orderPreguntaSigueValida =
        !orderPreguntaActual || idsPreguntasValidas.has(orderPreguntaActual);

      if (
        nuevasPreguntas.length === preguntasPrev.length &&
        nuevasSecciones.length === seccionesPrev.length &&
        orderPreguntaSigueValida
      ) {
        return prev;
      }

      return {
        ...prev,
        preguntas: nuevasPreguntas,
        secciones: nuevasSecciones,
        orderPreguntaId: orderPreguntaSigueValida ? prev.orderPreguntaId : "",
      };
    });
  }, [preguntasFiltradasPorSeccion, seccionesDisponibles]);

  const handleWordLimitChange = (value) => {
    const nuevoLimit = Number(value || 10);
    const limitSeguro = limitOptions.includes(nuevoLimit) ? nuevoLimit : limitOptions[0];
    const totalPages = Math.max(1, Math.ceil(totalRegistrosExport / limitSeguro));

    setWordConfig((prev) => ({
      ...prev,
      limit: limitSeguro,
      page: Math.min(Math.max(1, Number(prev.page || 1)), totalPages),
    }));

    setWordRange((prev) => {
      let from = Math.min(Math.max(1, Number(prev.from || 1)), totalPages);
      let to = Math.min(Math.max(1, Number(prev.to || 1)), totalPages);
      if (to < from) to = from;
      return { from, to };
    });
  };

  const handleWordPageChange = (value) => {
    const nuevaPagina = Number(value || 1);
    setWordConfig((prev) => ({
      ...prev,
      page: Math.min(Math.max(1, nuevaPagina), totalPaginasWord),
    }));
  };

  const handleRangeFromChange = (value) => {
    const from = Math.min(Math.max(1, Number(value || 1)), totalPaginasWord);
    setWordRange((prev) => {
      let to = Number(prev.to || from);
      if (to < from) to = from;
      if (to > totalPaginasWord) to = totalPaginasWord;
      return { from, to };
    });
  };

  const handleRangeToChange = (value) => {
    const toInput = Math.min(Math.max(1, Number(value || 1)), totalPaginasWord);
    setWordRange((prev) => {
      const from = Math.min(Math.max(1, Number(prev.from || 1)), totalPaginasWord);
      const to = Math.max(from, toInput);
      return { from, to };
    });
  };

  const goFirstPageWord = () => setWordConfig((prev) => ({ ...prev, page: 1 }));
  const goPrevPageWord = () => {
    setWordConfig((prev) => ({ ...prev, page: Math.max(1, Number(prev.page || 1) - 1) }));
  };
  const goNextPageWord = () => {
    setWordConfig((prev) => ({
      ...prev,
      page: Math.min(totalPaginasWord, Number(prev.page || 1) + 1),
    }));
  };
  const goLastPageWord = () => setWordConfig((prev) => ({ ...prev, page: totalPaginasWord }));

  const toggleIncluirFotos = (checked) => {
    const opciones = checked ? [10, 20] : [10, 20, 50, 100];
    setWordConfig((prev) => {
      let newLimit = Number(prev.limit || 10);
      if (!opciones.includes(newLimit)) {
        newLimit = 10;
      }

      const totalPages = Math.max(1, Math.ceil(totalRegistrosExport / newLimit));
      return {
        ...prev,
        incluirFotos: checked,
        fotosEnTabla: checked ? prev.fotosEnTabla : false,
        limit: newLimit,
        page: Math.min(Math.max(1, Number(prev.page || 1)), totalPages),
      };
    });

    const totalPages = Math.max(
      1,
      Math.ceil(totalRegistrosExport / (checked ? 10 : Math.max(1, Number(wordConfig.limit || 10))))
    );
    setWordRange((prev) => {
      let from = Math.min(Math.max(1, Number(prev.from || 1)), totalPages);
      let to = Math.min(Math.max(1, Number(prev.to || 1)), totalPages);
      if (to < from) to = from;
      return { from, to };
    });
  };

  const buildWordParams = (modoFinal, page = null) => {
    const params = new URLSearchParams();

    if (idPlantillaFiltro) params.set("plantilla", String(idPlantillaFiltro));
    params.set("modo", modoFinal);

    if (Array.isArray(wordConfig.preguntas) && wordConfig.preguntas.length > 0) {
      params.set("preguntas", wordConfig.preguntas.join(","));
    }

    if (Array.isArray(wordConfig.secciones) && wordConfig.secciones.length > 0) {
      params.set("secciones", wordConfig.secciones.join(","));
    }

    params.set("incluirFotos", wordConfig.incluirFotos ? "1" : "0");
    params.set("fotosEnTabla", wordConfig.fotosEnTabla ? "1" : "0");
    params.set("maxFotos", String(Math.max(0, Number(wordConfig.maxFotos || 0))));
    params.set("limit", String(Math.max(1, Number(wordConfig.limit || 10))));
    params.set("orderBy", String(wordConfig.orderBy || "fecha"));
    params.set("orderDir", String(wordConfig.orderDir || "asc"));

    if (wordConfig.orderBy === "pregunta" && wordConfig.orderPreguntaId) {
      params.set("orderPreguntaId", String(wordConfig.orderPreguntaId));
    }

    if (page != null) {
      params.set("page", String(page));
    }

    return params;
  };

  const askDownloadConfirmOutsideModal = async (options) => {
    setReopenWordConfigAfterSwalCancel(true);
    setShowWordConfig(false);

    await new Promise((resolve) => setTimeout(resolve, 180));

    const result = await fireSwalTop(options);

    if (!result.isConfirmed) {
      setShowWordConfig(true);
    }

    setReopenWordConfigAfterSwalCancel(false);
    return result;
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

  const descargarProyectoDocx = async (modoManual = null) => {
    const modoFinal = modoManual || wordConfig.modo || "normal";
    const key = modoFinal === "tabla" ? "docxTabla" : "docx";

    try {
      if (wordConfig.orderBy === "pregunta" && !wordConfig.orderPreguntaId) {
        Toast.fire({ icon: "error", title: "Elegí la pregunta para ordenar." });
        return;
      }

      setDownloading((s) => ({ ...s, [key]: true }));

      const params = buildWordParams(modoFinal, Math.max(1, Number(wordConfig.page || 1)));
      const qs = params.toString() ? `?${params.toString()}` : "";
      const url = `${API_URL}/informes/proyecto/${idProyecto}/docx${qs}`;

      const suffixPlantilla = idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : "";
      const suffixModo = modoFinal === "tabla" ? `_TABLA` : `_NORMAL`;
      const suffixLote = `_Lote_${Math.max(1, Number(wordConfig.page || 1))}`;
      const filename = `Informes_Proyecto_${idProyecto}${suffixPlantilla}${suffixLote}${suffixModo}.docx`;

      await downloadWithAuth(url, filename);

      Toast.fire({
        icon: "success",
        title: modoFinal === "tabla" ? "WORD (TABLA) descargado." : "WORD (NORMAL) descargado.",
      });

      setShowWordConfig(false);
    } catch (err) {
      console.error("Error descargando docx:", err);
      Toast.fire({ icon: "error", title: err?.message || "No se pudo descargar el WORD." });
    } finally {
      setDownloading((s) => ({ ...s, [key]: false }));
    }
  };

  const descargarRangoLotesWord = async (modoManual = null) => {
    const modoFinal = modoManual || wordConfig.modo || "normal";
    const key = modoFinal === "tabla" ? "docxTablaRange" : "docxRange";

    try {
      if (wordConfig.orderBy === "pregunta" && !wordConfig.orderPreguntaId) {
        Toast.fire({ icon: "error", title: "Elegí la pregunta para ordenar." });
        return;
      }

      if (!totalRegistrosExport || totalPaginasWord <= 0) {
        Toast.fire({ icon: "error", title: "No hay registros para exportar." });
        return;
      }

      const from = Math.min(Math.max(1, Number(wordRange.from || 1)), totalPaginasWord);
      const to = Math.min(Math.max(from, Number(wordRange.to || from)), totalPaginasWord);
      const totalLotes = to - from + 1;

      const labelOrden =
        wordConfig.orderBy === "pregunta"
          ? `pregunta #${wordConfig.orderPreguntaId} / ${wordConfig.orderDir}`
          : `${wordConfig.orderBy} / ${wordConfig.orderDir}`;

      const confirm = await askDownloadConfirmOutsideModal({
        icon: "question",
        title: "¿Descargar rango de lotes en varios archivos?",
        html: `
          <div style="text-align:left">
            <div><b>Total registros:</b> ${totalRegistrosExport}</div>
            <div><b>Registros por lote:</b> ${wordConfig.limit}</div>
            <div><b>Total páginas:</b> ${totalPaginasWord}</div>
            <div><b>Rango elegido:</b> ${from} a ${to}</div>
            <div><b>Cantidad de lotes:</b> ${totalLotes}</div>
            <div><b>Modo:</b> ${modoFinal === "tabla" ? "TABLA" : "NORMAL"}</div>
            <div><b>Orden:</b> ${labelOrden}</div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Sí, descargar",
        cancelButtonText: "Cancelar",
      });

      if (!confirm.isConfirmed) return;

      setDownloading((s) => ({ ...s, [key]: true }));

      for (let page = from; page <= to; page++) {
        const params = buildWordParams(modoFinal, page);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const url = `${API_URL}/informes/proyecto/${idProyecto}/docx${qs}`;

        const suffixPlantilla = idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : "";
        const suffixModo = modoFinal === "tabla" ? `_TABLA` : `_NORMAL`;
        const filename = `Informes_Proyecto_${idProyecto}${suffixPlantilla}_Lote_${page}_de_${totalPaginasWord}${suffixModo}.docx`;

        await downloadWithAuth(url, filename);

        Toast.fire({
          icon: "success",
          title: `Lote ${page} descargado`,
        });

        await sleep(900);
      }

      await fireSwalTop({
        icon: "success",
        title: "Descarga finalizada",
        text: `Se descargaron los lotes ${from} al ${to}.`,
      });
    } catch (err) {
      console.error("Error descargando rango de lotes:", err);
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudo descargar el rango de lotes.",
      });
    } finally {
      setDownloading((s) => ({ ...s, [key]: false }));
    }
  };

  const descargarRangoUnSoloWord = async (modoManual = null) => {
    const modoFinal = modoManual || wordConfig.modo || "normal";
    const key = modoFinal === "tabla" ? "docxTablaSingleRange" : "docxSingleRange";

    try {
      if (wordConfig.orderBy === "pregunta" && !wordConfig.orderPreguntaId) {
        Toast.fire({ icon: "error", title: "Elegí la pregunta para ordenar." });
        return;
      }

      if (!totalRegistrosExport || totalPaginasWord <= 0) {
        Toast.fire({ icon: "error", title: "No hay registros para exportar." });
        return;
      }

      const from = Math.min(Math.max(1, Number(wordRange.from || 1)), totalPaginasWord);
      const to = Math.min(Math.max(from, Number(wordRange.to || from)), totalPaginasWord);
      const totalLotes = to - from + 1;

      const maxLotesUnSoloWord = wordConfig.incluirFotos ? 20 : 80;
      if (totalLotes > maxLotesUnSoloWord) {
        Toast.fire({
          icon: "error",
          title: wordConfig.incluirFotos
            ? `Con fotos, el máximo para un solo Word es ${maxLotesUnSoloWord} lotes. Usá "Rango en varios Word".`
            : `El máximo para un solo Word es ${maxLotesUnSoloWord} lotes. Reduce el rango o usá "Rango en varios Word".`,
        });
        return;
      }

      const labelOrden =
        wordConfig.orderBy === "pregunta"
          ? `pregunta #${wordConfig.orderPreguntaId} / ${wordConfig.orderDir}`
          : `${wordConfig.orderBy} / ${wordConfig.orderDir}`;

      const confirm = await askDownloadConfirmOutsideModal({
        icon: "question",
        title: "¿Descargar rango en un solo Word?",
        html: `
          <div style="text-align:left">
            <div><b>Total registros:</b> ${totalRegistrosExport}</div>
            <div><b>Registros por lote:</b> ${wordConfig.limit}</div>
            <div><b>Total páginas:</b> ${totalPaginasWord}</div>
            <div><b>Rango elegido:</b> ${from} a ${to}</div>
            <div><b>Cantidad de lotes unidos:</b> ${totalLotes}</div>
            <div><b>Modo:</b> ${modoFinal === "tabla" ? "TABLA" : "NORMAL"}</div>
            <div><b>Orden:</b> ${labelOrden}</div>
            <div><b>Límite permitido:</b> ${maxLotesUnSoloWord} lotes</div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: "Sí, descargar",
        cancelButtonText: "Cancelar",
      });

      if (!confirm.isConfirmed) return;

      setDownloading((s) => ({ ...s, [key]: true }));

      const params = buildWordParams(modoFinal, null);
      params.set("fromPage", String(from));
      params.set("toPage", String(to));

      const qs = params.toString() ? `?${params.toString()}` : "";
      const url = `${API_URL}/informes/proyecto/${idProyecto}/docx-rango-unico${qs}`;

      const suffixPlantilla = idPlantillaFiltro ? `_Plantilla_${idPlantillaFiltro}` : "";
      const suffixModo = modoFinal === "tabla" ? `_TABLA` : `_NORMAL`;
      const filename = `Informes_Proyecto_${idProyecto}${suffixPlantilla}_Lotes_${from}_a_${to}${suffixModo}.docx`;

      await downloadWithAuth(url, filename);

      Toast.fire({
        icon: "success",
        title: "Word único descargado.",
      });
    } catch (err) {
      console.error("Error descargando un solo Word:", err);
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudo descargar el Word único del rango.",
      });
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

    const result = await fireSwalTop({
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
      Toast.fire({ icon: "error", title: err?.message || "No se pudo eliminar el informe." });
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

    const result = await fireSwalTop({
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
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: selectedIds }),
        }
      );

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Error ${resp.status}`);
      }

      setSelectedIds([]);
      await cargarInformes();

      Toast.fire({
        icon: "success",
        title: "Informes eliminados correctamente.",
      });
    } catch (err) {
      console.error("Error eliminando informes en masa:", err);
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudo eliminar los informes.",
      });
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

    const result = await fireSwalTop({
      icon: "warning",
      title: "¿Eliminar TODOS los informes de la plantilla?",
      text: `Plantilla #${idPlantillaFiltro}. Esta acción es irreversible${
        total ? ` y eliminará al menos ${total} registros cargados.` : "."
      }`,
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
          headers: {
            ...authHeaders(),
            "Content-Type": "application/json",
          },
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
      Toast.fire({
        icon: "error",
        title: err?.message || "No se pudo eliminar los informes.",
      });
    } finally {
      setBulkDeleting(false);
    }
  };

  const anyDownloading =
    downloading.pdf ||
    downloading.docx ||
    downloading.docxTabla ||
    downloading.xlsx ||
    downloading.kmz ||
    downloading.docxRange ||
    downloading.docxTablaRange ||
    downloading.docxSingleRange ||
    downloading.docxTablaSingleRange;

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

  const selectedPreguntasSet = useMemo(
    () => new Set((wordConfig.preguntas || []).map(Number)),
    [wordConfig.preguntas]
  );

  const isDownloadingRange = downloading[wordConfig.modo === "tabla" ? "docxTablaRange" : "docxRange"];
  const isDownloadingSingleRange =
    downloading[wordConfig.modo === "tabla" ? "docxTablaSingleRange" : "docxSingleRange"];

  const labelOrdenActual =
    wordConfig.orderBy === "pregunta"
      ? `pregunta #${wordConfig.orderPreguntaId || "-"} / ${wordConfig.orderDir}`
      : `${wordConfig.orderBy} / ${wordConfig.orderDir}`;

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

            <Button
              variant="outline-primary"
              onClick={() => {
                setWordConfig((prev) => ({ ...prev, modo: "normal" }));
                setShowWordConfig(true);
              }}
              disabled={anyDownloading}
            >
              {downloading.docx ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>📝 Word</>
              )}
            </Button>

            <Button
              variant="outline-primary"
              onClick={() => {
                setWordConfig((prev) => ({ ...prev, modo: "tabla" }));
                setShowWordConfig(true);
              }}
              disabled={anyDownloading}
            >
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

          <Button variant="primary" onClick={() => navigate(`/proyectos/${idProyecto}/informes/nuevo`)}>
            ➕ Nuevo informe
          </Button>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
        <Form.Group className="flex-grow-1" style={{ minWidth: 280 }}>
          <Form.Label className="small text-muted mb-1">Buscar por respuestas o por ID numérico</Form.Label>
          <Form.Control
            type="search"
            value={searchText}
            placeholder="Escribí texto de respuesta o un ID de informe..."
            onChange={(e) => {
              setSearchText(e.target.value);
              setListPage(1);
            }}
          />
        </Form.Group>

        <div className="d-flex gap-2">
          <Button
            variant="outline-secondary"
            onClick={() => {
              setSearchText("");
              setListPage(1);
            }}
            disabled={!searchText && listPage === 1}
          >
            Limpiar
          </Button>

          <Button variant="outline-secondary" onClick={() => cargarInformes()} disabled={loading}>
            Recargar
          </Button>
        </div>
      </div>

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="text-muted small">
          {loading
            ? "Cargando listado..."
            : `${totalRegistrosExport} informe${totalRegistrosExport === 1 ? "" : "s"} encontrados`}
          {searchText.trim() ? ` · búsqueda: "${searchText.trim()}"` : ""}
          {idPlantillaFiltro ? ` · plantilla #${idPlantillaFiltro}` : ""}
        </div>

        <div className="d-flex align-items-center gap-2">
          <Badge bg="secondary">
            Página {Math.min(listPage, totalPaginasListado)} de {totalPaginasListado}
          </Badge>
          <div className="btn-group btn-group-sm">
            <Button variant="outline-secondary" onClick={() => setListPage(1)} disabled={listPage <= 1 || loading}>
              «
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => setListPage((prev) => Math.max(1, Number(prev || 1) - 1))}
              disabled={listPage <= 1 || loading}
            >
              Anterior
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => setListPage((prev) => Math.min(totalPaginasListado, Number(prev || 1) + 1))}
              disabled={listPage >= totalPaginasListado || loading}
            >
              Siguiente
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => setListPage(totalPaginasListado)}
              disabled={listPage >= totalPaginasListado || loading}
            >
              »
            </Button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" /> Cargando informes...
        </div>
      )}

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && !error && informes.length === 0 && (
        <Alert variant="info" className="py-2">
          No se encontraron informes con los criterios actuales.
        </Alert>
      )}

      {!loading && !error && informes.length > 0 && USE_OPERATIVE_TABLE && (
        <InformesTableOperativo
          informes={informesAdaptados}
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
          onToggleSelection={onToggleSelection}
          onSelectAll={onSelectAll}
          allSelected={allSelected}
          headerCheckboxRef={headerCheckboxRef}
          sortBy={listSort.sortBy}
          sortOrder={listSort.sortOrder}
          onSortChange={handleSortChange}
        />
      )}

      {!loading && !error && informes.length > 0 && !USE_OPERATIVE_TABLE && (
        <Table striped bordered hover size="sm" responsive>
          <thead className="table-light">
            <tr>
              <th style={{ width: 48, textAlign: "center" }}>
                <Form.Check
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(allIds);
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                />
              </th>
              <th style={{ width: 80 }}>ID</th>
              <th>Plantilla</th>
              <th>Título</th>
              <th style={{ width: 180 }}>Fecha creado</th>
              <th style={{ width: 120 }}>Creado por</th>
              <th style={{ width: 340 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {informes.map((inf) => {
              const kmzLoading = !!downloadingKmzByInforme[inf.id_informe];

              return (
                <tr key={inf.id_informe}>
                  <td style={{ textAlign: "center" }}>
                    <Form.Check
                      type="checkbox"
                      checked={selectedSet.has(Number(inf.id_informe))}
                      onChange={(e) => {
                        const id = Number(inf.id_informe);
                        if (!id) return;
                        setSelectedIds((prev) => {
                          const set = new Set(prev);
                          if (e.target.checked) set.add(id);
                          else set.delete(id);
                          return Array.from(set);
                        });
                      }}
                    />
                  </td>
                  <td>
                    <Badge bg="secondary">{inf.id_informe}</Badge>
                  </td>
                  <td>{inf.nombre_plantilla || inf.id_plantilla}</td>
                  <td>{inf.titulo || "-"}</td>
                  <td>{formatearFecha(inf.fecha_creado)}</td>
                  <td>{inf.creado_por || "-"}</td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      <Button variant="primary" onClick={() => abrirVer(inf.id_informe)}>
                        Ver
                      </Button>

                      <Button variant="outline-secondary" onClick={() => descargarPdfInforme(inf.id_informe)}>
                        PDF
                      </Button>

                      {puedeDescargarKmz && (
                        <Button
                          variant="outline-dark"
                          onClick={() => descargarKmzInforme(inf.id_informe)}
                          disabled={kmzLoading || anyDownloading}
                        >
                          {kmzLoading ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />...
                            </>
                          ) : (
                            <>KMZ</>
                          )}
                        </Button>
                      )}

                      {puedeEditar && (
                        <Button variant="warning" onClick={() => abrirEditar(inf.id_informe)}>
                          Editar
                        </Button>
                      )}

                      {puedeEliminarAdmin && (
                        <Button variant="danger" onClick={() => eliminarInforme(inf.id_informe)}>
                          Eliminar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
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
        enforceFocus={false}
        restoreFocus={false}
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

      <Modal
        show={showWordConfig}
        onHide={() => {
          if (!reopenWordConfigAfterSwalCancel) setShowWordConfig(false);
        }}
        centered
        size="lg"
        enforceFocus={false}
        restoreFocus={false}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Exportar Word {wordConfig.modo === "tabla" ? "(Tabla)" : "(Normal)"}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="row g-3">
            <div className="col-md-4">
              <Form.Group>
                <Form.Label>Registros por lote</Form.Label>
                <Form.Select
                  value={wordConfig.limit}
                  onChange={(e) => handleWordLimitChange(e.target.value)}
                >
                  {limitOptions.map((n) => (
                    <option key={n} value={n}>
                      {n} por página
                    </option>
                  ))}
                </Form.Select>
                <div className="form-text">
                  {wordConfig.incluirFotos
                    ? "Modo seguro con fotos: máximo 20 por lote."
                    : "Sin fotos podés usar lotes más grandes."}
                </div>
              </Form.Group>
            </div>

            <div className="col-md-4">
              <Form.Group>
                <Form.Label>Lote / Página</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={totalPaginasWord}
                  value={wordConfig.page}
                  onChange={(e) => handleWordPageChange(e.target.value)}
                />
              </Form.Group>
            </div>

            <div className="col-md-4 d-flex align-items-end">
              <div className="w-100 d-flex gap-2">
                <Button
                  variant="outline-secondary"
                  className="w-100"
                  onClick={goPrevPageWord}
                  disabled={wordConfig.page <= 1}
                >
                  ← Anterior
                </Button>
                <Button
                  variant="outline-secondary"
                  className="w-100"
                  onClick={goNextPageWord}
                  disabled={wordConfig.page >= totalPaginasWord}
                >
                  Siguiente →
                </Button>
              </div>
            </div>

            <div className="col-md-4">
              <Form.Check
                type="switch"
                id="word_incluir_fotos"
                label="Incluir fotos"
                checked={wordConfig.incluirFotos}
                onChange={(e) => toggleIncluirFotos(e.target.checked)}
              />
            </div>

            <div className="col-md-4">
              <Form.Check
                type="switch"
                id="word_fotos_tabla"
                label="Fotos dentro de tabla"
                checked={wordConfig.fotosEnTabla}
                disabled={!wordConfig.incluirFotos || wordConfig.modo !== "tabla"}
                onChange={(e) =>
                  setWordConfig((prev) => ({
                    ...prev,
                    fotosEnTabla: e.target.checked,
                  }))
                }
              />
            </div>

            <div className="col-md-4">
              <Form.Group>
                <Form.Label>Máx. fotos por pregunta</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  value={wordConfig.maxFotos}
                  disabled={!wordConfig.incluirFotos}
                  onChange={(e) =>
                    setWordConfig((prev) => ({
                      ...prev,
                      maxFotos: Number(e.target.value || 0),
                    }))
                  }
                />
              </Form.Group>
            </div>

            <div className="col-md-4">
              <Form.Group>
                <Form.Label>Ordenar por</Form.Label>
                <Form.Select
                  value={wordConfig.orderBy}
                  onChange={(e) =>
                    setWordConfig((prev) => ({
                      ...prev,
                      orderBy: e.target.value,
                      orderPreguntaId: e.target.value === "pregunta" ? prev.orderPreguntaId : "",
                    }))
                  }
                >
                  <option value="fecha">Fecha de creación</option>
                  <option value="id">ID informe</option>
                  <option value="pregunta">Respuesta de una pregunta</option>
                </Form.Select>
              </Form.Group>
            </div>

            <div className="col-md-4">
              <Form.Group>
                <Form.Label>Dirección</Form.Label>
                <Form.Select
                  value={wordConfig.orderDir}
                  onChange={(e) =>
                    setWordConfig((prev) => ({
                      ...prev,
                      orderDir: e.target.value,
                    }))
                  }
                >
                  <option value="asc">Ascendente</option>
                  <option value="desc">Descendente</option>
                </Form.Select>
              </Form.Group>
            </div>

            <div className="col-md-4">
              {wordConfig.orderBy === "pregunta" && (
                <Form.Group>
                  <Form.Label>Pregunta para ordenar</Form.Label>
                  <Form.Select
                    value={wordConfig.orderPreguntaId || ""}
                    onChange={(e) =>
                      setWordConfig((prev) => ({
                        ...prev,
                        orderPreguntaId: e.target.value,
                      }))
                    }
                  >
                    <option value="">Seleccione una pregunta</option>
                    {preguntasFiltradasPorSeccion.map((preg) => (
                      <option key={preg.id_pregunta} value={preg.id_pregunta}>
                        {preg.etiqueta || `Pregunta ${preg.id_pregunta}`}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              )}
            </div>

            <div className="col-12">
              <Alert variant="info" className="mb-0">
                <div><strong>Total registros:</strong> {totalRegistrosExport}</div>
                <div><strong>Total páginas:</strong> {totalPaginasWord}</div>
                <div><strong>Rango actual:</strong> {rangoDesdeWord} - {rangoHastaWord}</div>
                <div><strong>Página actual:</strong> {wordConfig.page} de {totalPaginasWord}</div>
                <div><strong>Orden:</strong> {labelOrdenActual}</div>
              </Alert>
            </div>

            <div className="col-12">
              <div className="d-flex gap-2 flex-wrap">
                <Button
                  variant="outline-secondary"
                  onClick={goFirstPageWord}
                  disabled={wordConfig.page <= 1}
                >
                  ⏮ Primera
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={goPrevPageWord}
                  disabled={wordConfig.page <= 1}
                >
                  ◀ Anterior
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={goNextPageWord}
                  disabled={wordConfig.page >= totalPaginasWord}
                >
                  Siguiente ▶
                </Button>
                <Button
                  variant="outline-secondary"
                  onClick={goLastPageWord}
                  disabled={wordConfig.page >= totalPaginasWord}
                >
                  Última ⏭
                </Button>
              </div>
            </div>

            <div className="col-md-6">
              <Form.Group>
                <Form.Label>Desde lote</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={totalPaginasWord}
                  value={wordRange.from}
                  onChange={(e) => handleRangeFromChange(e.target.value)}
                />
              </Form.Group>
            </div>

            <div className="col-md-6">
              <Form.Group>
                <Form.Label>Hasta lote</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={totalPaginasWord}
                  value={wordRange.to}
                  onChange={(e) => handleRangeToChange(e.target.value)}
                />
              </Form.Group>
            </div>

            <div className="col-12">
              <Alert variant="warning" className="mb-0">
                <div><strong>Rango de descarga:</strong> {wordRange.from} a {wordRange.to}</div>
                <div><strong>Cantidad de lotes:</strong> {Math.max(0, Number(wordRange.to) - Number(wordRange.from) + 1)}</div>
                <div><strong>Límite para un solo Word:</strong> {wordConfig.incluirFotos ? 20 : 80} lotes</div>
              </Alert>
            </div>

            <div className="col-md-6">
              <Form.Group>
                <Form.Label>Filtrar por secciones</Form.Label>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    border: "1px solid #dee2e6",
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  {seccionesDisponibles.length === 0 ? (
                    <div className="text-muted small">No hay secciones disponibles.</div>
                  ) : (
                    seccionesDisponibles.map((sec) => (
                      <Form.Check
                        key={sec.id_seccion}
                        type="checkbox"
                        label={sec.titulo || `Sección ${sec.id_seccion}`}
                        checked={wordConfig.secciones.includes(Number(sec.id_seccion))}
                        onChange={(e) => {
                          const id = Number(sec.id_seccion);
                          setWordConfig((prev) => {
                            const nuevasSecciones = e.target.checked
                              ? [...prev.secciones, id]
                              : prev.secciones.filter((x) => x !== id);

                            const preguntasValidas = preguntasDisponibles
                              .filter((p) => {
                                if (nuevasSecciones.length === 0) return true;
                                return nuevasSecciones.includes(Number(p.id_seccion));
                              })
                              .map((p) => Number(p.id_pregunta));

                            const nuevaOrderPreguntaId =
                              prev.orderBy === "pregunta" &&
                              prev.orderPreguntaId &&
                              !preguntasValidas.includes(Number(prev.orderPreguntaId))
                                ? ""
                                : prev.orderPreguntaId;

                            return {
                              ...prev,
                              secciones: nuevasSecciones,
                              preguntas: prev.preguntas.filter((x) => preguntasValidas.includes(Number(x))),
                              orderPreguntaId: nuevaOrderPreguntaId,
                            };
                          });
                        }}
                      />
                    ))
                  )}
                </div>
              </Form.Group>
            </div>

            <div className="col-md-6">
              <Form.Group>
                <Form.Label>Filtrar por preguntas</Form.Label>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    border: "1px solid #dee2e6",
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  {preguntasFiltradasPorSeccion.length === 0 ? (
                    <div className="text-muted small">No hay preguntas disponibles.</div>
                  ) : (
                    preguntasFiltradasPorSeccion.map((preg) => (
                      <Form.Check
                        key={preg.id_pregunta}
                        type="checkbox"
                        label={preg.etiqueta || `Pregunta ${preg.id_pregunta}`}
                        checked={selectedPreguntasSet.has(Number(preg.id_pregunta))}
                        onChange={(e) => {
                          const id = Number(preg.id_pregunta);
                          setWordConfig((prev) => {
                            const nuevasPreguntas = e.target.checked
                              ? [...prev.preguntas, id]
                              : prev.preguntas.filter((x) => x !== id);

                            const nuevaOrderPreguntaId =
                              prev.orderBy === "pregunta" &&
                              prev.orderPreguntaId &&
                              Number(prev.orderPreguntaId) === id &&
                              !e.target.checked
                                ? ""
                                : prev.orderPreguntaId;

                            return {
                              ...prev,
                              preguntas: nuevasPreguntas,
                              orderPreguntaId: nuevaOrderPreguntaId,
                            };
                          });
                        }}
                      />
                    ))
                  )}
                </div>
              </Form.Group>
            </div>
          </div>

          <Alert variant="secondary" className="mt-3 mb-0">
            Esta exportación usa lote, secciones, preguntas y control de fotos. Para evitar saturación,
            con fotos el sistema limita automáticamente el tamaño del lote.
          </Alert>
        </Modal.Body>

        <Modal.Footer className="d-flex justify-content-between">
          <div className="text-muted small">
            Exportando {rangoDesdeWord} - {rangoHastaWord} de {totalRegistrosExport}
          </div>
          <div className="d-flex gap-2 flex-wrap justify-content-end">
            <Button variant="secondary" onClick={() => setShowWordConfig(false)}>
              Cancelar
            </Button>

            <Button
              variant="outline-primary"
              onClick={() => descargarRangoLotesWord(wordConfig.modo)}
              disabled={isDownloadingRange || anyDownloading}
            >
              {isDownloadingRange ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>Rango en varios Word</>
              )}
            </Button>

            <Button
              variant="outline-success"
              onClick={() => descargarRangoUnSoloWord(wordConfig.modo)}
              disabled={isDownloadingSingleRange || anyDownloading}
            >
              {isDownloadingSingleRange ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />...
                </>
              ) : (
                <>Rango en un solo Word</>
              )}
            </Button>

            <Button
              variant="primary"
              onClick={() => descargarProyectoDocx(wordConfig.modo)}
              disabled={anyDownloading}
            >
              Descargar Word
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
