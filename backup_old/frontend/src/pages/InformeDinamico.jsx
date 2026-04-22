// src/pages/InformeDinamico.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { informesApi } from "@/services/informesService";
import Swal from "sweetalert2";
import GoogleMapaCoordenadas from "@/components/GoogleMapaCoordenadas"; // ✅

const MAX_FOTOS_POR_PREGUNTA = 4;

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

/* ───────────────────── Helpers JSON + Condicionales visible_if / required_if ───────────────────── */

const normTipo = (t) => String(t || "").toLowerCase().trim();

function safeJson(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === "object") return v; // ya es obj/array
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function isAnsweredByTipo(tipo, val) {
  const t = normTipo(tipo);

  switch (t) {
    case "multiselect":
      return Array.isArray(val) && val.length > 0;

    case "si_no":
      return val === true || val === false || val === "SI" || val === "NO";

    case "coordenadas":
      return Array.isArray(val) && val.length >= 2 && val[0] != null && val[1] != null;

    case "semaforo":
      // ✅ semáforo guarda VALUE (slug), no el color
      return typeof val === "string" && val.trim() !== "";

    default:
      return !(val == null || String(val).trim() === "");
  }
}

function normalizeForCompare(tipo, v) {
  const t = normTipo(tipo);

  if (t === "si_no") {
    if (v === "SI") return true;
    if (v === "NO") return false;
    if (typeof v === "boolean") return v;
    return v;
  }

  if (t === "numero") {
    if (v == null || v === "") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }

  // semáforo: comparamos por value (string) tal cual
  return v;
}

function evalCond(cond, respuestas, preguntasById) {
  if (!cond) return true;

  // ✅ Si viniera como string JSON
  const c = safeJson(cond, cond);

  if (!c) return true;
  if (typeof c !== "object") return true;

  // compuesto
  if (Array.isArray(c.all)) return c.all.every((x) => evalCond(x, respuestas, preguntasById));
  if (Array.isArray(c.any)) return c.any.some((x) => evalCond(x, respuestas, preguntasById));

  const id = c.id_pregunta;
  const op = String(c.op || "").toLowerCase();
  const expectedRaw = c.value;

  if (!id || !op) return true;

  const parent = preguntasById?.get?.(Number(id)) || null;
  const parentTipo = parent?.tipo;

  const actualRaw = respuestas?.[id];

  // truthy/falsy = “respondido” según tipo del padre
  if (op === "truthy") return isAnsweredByTipo(parentTipo, actualRaw);
  if (op === "falsy") return !isAnsweredByTipo(parentTipo, actualRaw);

  const actual = normalizeForCompare(parentTipo, actualRaw);
  const expected = normalizeForCompare(parentTipo, expectedRaw);

  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;

  if (op === "in") {
    if (Array.isArray(actualRaw)) return actualRaw.includes(expectedRaw);
    if (Array.isArray(expectedRaw)) return expectedRaw.includes(actualRaw);
    return false;
  }

  if (op === "not_in") {
    if (Array.isArray(actualRaw)) return !actualRaw.includes(expectedRaw);
    if (Array.isArray(expectedRaw)) return expectedRaw.includes(actualRaw) ? false : true;
    return true;
  }

  return true; // op desconocida no bloquea
}

function emptyValueForTipo(tipo) {
  const t = normTipo(tipo);
  if (t === "multiselect") return [];
  if (t === "si_no") return null;
  if (t === "coordenadas") return null;
  if (t === "semaforo") return "";
  return "";
}

/* ───────────────────── Opciones (select / multiselect / semaforo) ───────────────────── */

function normalizeSemaforoOptions(rawOptions) {
  const list = Array.isArray(rawOptions) ? rawOptions : [];

  return list
    .map((o) => {
      // Si alguien dejó strings (no ideal para semáforo), intentamos igual
      if (typeof o === "string") {
        const s = o.trim();
        if (!s) return null;
        return { value: s, label: s, color: "#e9ecef" };
      }

      if (o && typeof o === "object") {
        const value = String(o.value ?? "").trim();
        const label = String(o.label ?? o.text ?? value).trim();
        const color = String(o.color ?? "").trim();

        if (!value) return null;

        // Si no viene color, usamos un gris neutro (pero NO guardamos esto)
        return {
          value,
          label: label || value,
          color: color || "#e9ecef",
        };
      }

      return null;
    })
    .filter(Boolean);
}

/* ───────────────────── Inicializador de respuestas según plantilla ───────────────────── */

function buildInitialRespuestas(plantilla) {
  const inicial = {};
  (plantilla?.secciones || []).forEach((sec) => {
    (sec.preguntas || []).forEach((p) => {
      if (!(p.id_pregunta in inicial)) {
        inicial[p.id_pregunta] = emptyValueForTipo(p.tipo);
      }
    });
  });
  return inicial;
}

/* ───────────────────────────────────────────────────────────────────────── */

const InformeDinamico = () => {
  const { idProyecto } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const preIdPlantilla = searchParams.get("idPlantilla");

  const [plantillas, setPlantillas] = useState([]);
  const [plantillaSeleccionadaId, setPlantillaSeleccionadaId] = useState("");
  const [plantilla, setPlantilla] = useState(null);

  const [tituloInforme, setTituloInforme] = useState("");
  const [respuestas, setRespuestas] = useState({});
  const [fotosPorPregunta, setFotosPorPregunta] = useState({});

  const [creando, setCreando] = useState(false);
  const [idInformeCreado, setIdInformeCreado] = useState(null);

  // ✅ para resetear inputs type=file (son uncontrolled)
  const [filesResetKey, setFilesResetKey] = useState(0);

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

  // ✅ reset completo del formulario (mantiene la plantilla seleccionada)
  const resetFormulario = (plantillaActual = plantilla) => {
    setTituloInforme("");
    setRespuestas(buildInitialRespuestas(plantillaActual));
    setFotosPorPregunta({});
    setIdInformeCreado(null);
    setFilesResetKey((k) => k + 1);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      // noop
    }
  };

  // ================== Cargar plantillas ==================
  useEffect(() => {
    (async () => {
      try {
        const data = await informesApi.getPlantillas();
        const act = (data || []).filter((p) => p.activo !== false);
        setPlantillas(act);

        if (preIdPlantilla) {
          setPlantillaSeleccionadaId(String(preIdPlantilla));
        }
      } catch (e) {
        console.error("Error cargando plantillas", e);
        Toast.fire({ icon: "error", title: e?.message || "Error cargando plantillas" });
      }
    })();
  }, [preIdPlantilla]);

  // =========== Cuando elige plantilla, traemos estructura ===========
  useEffect(() => {
    if (!plantillaSeleccionadaId) {
      setPlantilla(null);
      setRespuestas({});
      setFotosPorPregunta({});
      setIdInformeCreado(null);
      return;
    }

    (async () => {
      try {
        const data = await informesApi.getPlantillaById(plantillaSeleccionadaId);

        // ✅ Normalizamos visible_if / required_if aunque vengan como string JSON
        const normalized = {
          ...data,
          secciones: (data.secciones || []).map((sec) => ({
            ...sec,
            visible_if: safeJson(sec.visible_if, sec.visible_if),
            required_if: safeJson(sec.required_if, sec.required_if),
            preguntas: (sec.preguntas || []).map((p) => ({
              ...p,
              tipo: normTipo(p.tipo),
              visible_if: safeJson(p.visible_if, p.visible_if),
              required_if: safeJson(p.required_if, p.required_if),
            })),
          })),
        };

        setPlantilla(normalized);

        setRespuestas(buildInitialRespuestas(normalized));
        setFotosPorPregunta({});
        setIdInformeCreado(null);
        setFilesResetKey((k) => k + 1); // también reset de file inputs al cambiar plantilla
      } catch (e) {
        console.error("Error cargando plantilla", e);
        Toast.fire({ icon: "error", title: e?.message || "Error cargando plantilla" });
      }
    })();
  }, [plantillaSeleccionadaId]);

  // ✅ flat preguntas + map por id (para evaluar condicionales)
  const allPreguntas = useMemo(() => {
    const list = [];
    (plantilla?.secciones || []).forEach((sec) => (sec.preguntas || []).forEach((p) => list.push(p)));
    return list;
  }, [plantilla]);

  const preguntasById = useMemo(() => {
    const m = new Map();
    allPreguntas.forEach((p) => m.set(Number(p.id_pregunta), p));
    return m;
  }, [allPreguntas]);

  const isVisible = (p, resp) => evalCond(p.visible_if, resp, preguntasById);

  const isRequiredNow = (p, resp) => {
    const base = !!p.obligatorio;
    const cond = p.required_if ? evalCond(p.required_if, resp, preguntasById) : false;
    return base || cond;
  };

  // ✅ limpieza automática (si deja de ser visible => vaciar respuesta + borrar fotos)
  useEffect(() => {
    if (!plantilla) return;
    if (!allPreguntas.length) return;

    let changed = false;
    const nextResp = { ...respuestas };
    const nextFotos = { ...fotosPorPregunta };

    for (const p of allPreguntas) {
      const idP = p.id_pregunta;
      const vis = isVisible(p, respuestas);
      const t = normTipo(p.tipo);

      if (!vis) {
        const emptyVal = emptyValueForTipo(t);
        const cur = nextResp[idP];

        const needClear =
          t === "multiselect"
            ? Array.isArray(cur) && cur.length > 0
            : t === "si_no"
              ? cur !== null
              : t === "coordenadas"
                ? Array.isArray(cur) && cur.length
                : !(cur == null || String(cur).trim() === "");

        if (needClear) {
          nextResp[idP] = emptyVal;
          changed = true;
        }

        if (nextFotos[idP] && nextFotos[idP].length) {
          delete nextFotos[idP];
          changed = true;
        }
      }
    }

    if (changed) {
      setRespuestas(nextResp);
      setFotosPorPregunta(nextFotos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respuestas, plantilla?.id_plantilla]);

  // ================== Manejo de respuestas ==================
  const handleChangeRespuesta = (idPregunta, tipo, value) => {
    const t = normTipo(tipo);

    setRespuestas((prev) => {
      const nuevo = { ...prev };

      if (t === "si_no") {
        if (value === "true") nuevo[idPregunta] = true;
        else if (value === "false") nuevo[idPregunta] = false;
        else nuevo[idPregunta] = null;
      } else if (t === "multiselect") {
        nuevo[idPregunta] = Array.isArray(value) ? value : [];
      } else if (t === "coordenadas") {
        nuevo[idPregunta] = Array.isArray(value) ? value : value; // coords o null
      } else {
        // semaforo / select / fecha / numero / texto
        nuevo[idPregunta] = value;
      }

      return nuevo;
    });
  };

  const handleFotosPreguntaChange = (idPregunta, e) => {
    let files = Array.from(e.target.files || []);
    if (files.length > MAX_FOTOS_POR_PREGUNTA) {
      Toast.fire({
        icon: "warning",
        title: `Solo se permiten hasta ${MAX_FOTOS_POR_PREGUNTA} fotos por pregunta.`,
      });
      files = files.slice(0, MAX_FOTOS_POR_PREGUNTA);
    }

    setFotosPorPregunta((prev) => ({
      ...prev,
      [idPregunta]: files,
    }));
  };

  // ───────────────────── Validación (obligatorio + required_if) ─────────────────────
  const validarObligatorios = () => {
    if (!plantilla) return { ok: true, faltantes: [] };

    const faltantes = [];
    const getValor = (idPreg) => respuestas[idPreg];

    (plantilla.secciones || []).forEach((sec) => {
      const secVisible = evalCond(sec.visible_if, respuestas, preguntasById);
      if (!secVisible) return;

      (sec.preguntas || []).forEach((p) => {
        if (!isVisible(p, respuestas)) return;

        const requiredNow = isRequiredNow(p, respuestas);
        if (!requiredNow) return;

        if (normTipo(p.tipo) === "imagen") {
          const fotos = fotosPorPregunta?.[p.id_pregunta] || [];
          if (fotos.length === 0) faltantes.push(p.etiqueta);
          return;
        }

        const val = getValor(p.id_pregunta);
        const vacio = !isAnsweredByTipo(p.tipo, val);
        if (vacio) faltantes.push(p.etiqueta);
      });
    });

    return { ok: faltantes.length === 0, faltantes };
  };

  // ================== Ver PDF con token ==================
  const handleVerPdf = async (id = idInformeCreado) => {
    if (!id) return;

    const token = localStorage.getItem("token");
    if (!token) {
      Toast.fire({ icon: "error", title: "Sesión no encontrada. Volvé a iniciar sesión." });
      return;
    }

    try {
      const resp = await fetch(`${API_URL}/informes/${id}/pdf`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        if (resp.status === 401) throw new Error("Sesión expirada o token inválido.");
        if (resp.status === 403) throw new Error("No tiene permisos para ver este PDF.");
        throw new Error("No se pudo generar el PDF.");
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      console.error("Error descargando PDF", e);
      Toast.fire({ icon: "error", title: e?.message || "Error al descargar el PDF" });
    }
  };

  // ================== Guardar informe ==================
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!plantilla || !plantilla.id_plantilla) {
      Toast.fire({ icon: "warning", title: "Seleccioná una plantilla primero" });
      return;
    }

    const { ok, faltantes } = validarObligatorios();
    if (!ok) {
      const htmlLista =
        '<ul style="text-align:left; margin:0; padding-left:1.2rem;">' +
        faltantes.map((f) => `<li>${f}</li>`).join("") +
        "</ul>";

      await Swal.fire({
        icon: "warning",
        title: "Faltan completar campos obligatorios",
        html: htmlLista,
        confirmButtonText: "Entendido",
      });
      return;
    }

    try {
      setCreando(true);

      // ✅ SOLO enviamos respuestas visibles
      const respuestasFiltradas = {};
      allPreguntas.forEach((p) => {
        if (!isVisible(p, respuestas)) return;
        respuestasFiltradas[p.id_pregunta] = respuestas[p.id_pregunta];
      });

      // ✅ fotos solo visibles
      const fotosFiltradas = {};
      Object.entries(fotosPorPregunta || {}).forEach(([idPreg, arr]) => {
        const p = preguntasById.get(Number(idPreg));
        if (!p) return;
        if (!isVisible(p, respuestas)) return;
        if ((arr || []).length) fotosFiltradas[idPreg] = arr;
      });

      const formData = new FormData();
      formData.append("id_plantilla", plantilla.id_plantilla);
      if (idProyecto) formData.append("id_proyecto", idProyecto);
      if (tituloInforme) formData.append("titulo", tituloInforme);

      formData.append("respuestas", JSON.stringify(respuestasFiltradas));

      Object.entries(fotosFiltradas).forEach(([idPreg, archivos]) => {
        (archivos || []).forEach((file) => {
          formData.append(`fotos_${idPreg}`, file);
        });
      });

      const resp = await informesApi.crearInforme(formData);
      const { ok: okResp, id_informe, message } = resp || {};

      if (!okResp) {
        Toast.fire({ icon: "error", title: message || "No se pudo crear el informe" });
        return;
      }

      setIdInformeCreado(id_informe);
      Toast.fire({ icon: "success", title: "Informe creado correctamente" });

      // ✅ limpiar para la siguiente carga (pero sin “perder” la chance de ver PDF)
      // Elegís acción:
      const r = await Swal.fire({
        icon: "success",
        title: "Guardado OK",
        text: "¿Qué querés hacer ahora?",
        showCancelButton: true,
        confirmButtonText: "🧹 Nuevo informe (limpiar)",
        cancelButtonText: "📄 Ver PDF",
        reverseButtons: true,
      });

      if (r.isConfirmed) {
        resetFormulario(plantilla);
      } else {
        // ver pdf y luego dejamos el formulario como está;
        // si querés limpiar igual después de ver, avisame y lo ajustamos.
        await handleVerPdf(id_informe);
      }
    } catch (e2) {
      console.error("Error creando informe", e2);
      Toast.fire({ icon: "error", title: e2?.message || "Error al guardar el informe" });
    } finally {
      setCreando(false);
    }
  };

  // ================== Render de controles ==================
  const parseOpciones = (pregunta) => {
    const raw = pregunta.opciones_json;
    if (!raw) return [];

    let data = raw;

    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch {
        return [];
      }
    }

    if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.options)) {
      return data.options;
    }

    if (Array.isArray(data)) return data;

    return [];
  };

  const renderControlPregunta = (pregunta) => {
    const t = normTipo(pregunta.tipo);
    const opciones = parseOpciones(pregunta);
    const val = respuestas[pregunta.id_pregunta];
    const fotosPregunta = fotosPorPregunta[pregunta.id_pregunta] || [];

    let controlRespuesta = null;

    switch (t) {
      case "imagen": {
        const requiredNow = isRequiredNow(pregunta, respuestas);

        controlRespuesta = (
          <div className="mt-1">
            <label className="form-label mb-1 small">
              Imagen(es) {requiredNow ? "(obligatorio)" : "(opcional)"} – máx. {MAX_FOTOS_POR_PREGUNTA}
            </label>

            <input
              key={`img-${filesResetKey}-${pregunta.id_pregunta}`}
              type="file"
              className="form-control form-control-sm"
              multiple
              accept="image/*"
              onChange={(e) => handleFotosPreguntaChange(pregunta.id_pregunta, e)}
            />

            {fotosPregunta.length > 0 && (
              <div className="mt-1 d-flex flex-wrap gap-2">
                {fotosPregunta.map((file, idx) => (
                  <div key={idx} className="border rounded" style={{ width: 70, height: 70, overflow: "hidden" }}>
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`preg-${pregunta.id_pregunta}-img-${idx}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
        break;
      }

      case "si_no":
        controlRespuesta = (
          <select
            className="form-select form-select-sm"
            value={val === null || val === undefined ? "" : val ? "true" : "false"}
            onChange={(e) => handleChangeRespuesta(pregunta.id_pregunta, "si_no", e.target.value)}
          >
            <option value="">Seleccione…</option>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        );
        break;

      case "select": {
        // ✅ soporta opciones string o {value,label}
        const opts = (opciones || [])
          .map((o) => {
            if (typeof o === "string") return { value: o, label: o };
            if (o && typeof o === "object") {
              const value = String(o.value ?? o.id ?? "").trim();
              const label = String(o.label ?? o.text ?? value).trim();
              if (!value) return null;
              return { value, label: label || value };
            }
            return null;
          })
          .filter(Boolean);

        controlRespuesta = (
          <select
            className="form-select form-select-sm"
            value={val || ""}
            onChange={(e) => handleChangeRespuesta(pregunta.id_pregunta, "select", e.target.value)}
          >
            <option value="">Seleccione…</option>
            {opts.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
        break;
      }

      // ✅ semáforo (nuevo formato {value,label,color})
      case "semaforo": {
        const opts = normalizeSemaforoOptions(opciones);

        const selected = typeof val === "string" ? val : "";
        const selectedOpt = opts.find((o) => o.value === selected) || null;
        const selectedColor = selectedOpt?.color || "";

        controlRespuesta = (
          <div>
            <div className="d-flex flex-wrap gap-2">
              {opts.map((o) => {
                const active = selected === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => handleChangeRespuesta(pregunta.id_pregunta, "semaforo", o.value)}
                    style={{
                      borderColor: o.color || undefined,
                      boxShadow: active ? "inset 0 0 0 2px rgba(255,255,255,.6)" : undefined,
                    }}
                    title={`${o.label} (${o.value})`}
                  >
                    <span
                      className="me-2 align-middle d-inline-block border rounded"
                      style={{
                        width: 14,
                        height: 14,
                        background: o.color || "#e9ecef",
                      }}
                    />
                    {o.label}
                  </button>
                );
              })}

              {/* Botón para limpiar */}
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => handleChangeRespuesta(pregunta.id_pregunta, "semaforo", "")}
                disabled={!selected}
                title="Quitar selección"
              >
                Limpiar
              </button>
            </div>

            <div className="mt-2 d-flex align-items-center gap-2 small text-muted">
              <span>Seleccionado:</span>
              <strong>{selectedOpt?.label || (selected ? selected : "—")}</strong>
              <span className="ms-2">Valor:</span>
              <code>{selected || "—"}</code>

              <span
                className="ms-2 border rounded"
                title={selectedColor || "Sin color"}
                style={{
                  width: 18,
                  height: 18,
                  background: selectedColor || "#e9ecef",
                }}
              />
            </div>
          </div>
        );
        break;
      }

      case "multiselect": {
        const selected = Array.isArray(val) ? val : [];
        const toggle = (opt) => {
          const next = selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt];
          handleChangeRespuesta(pregunta.id_pregunta, "multiselect", next);
        };

        controlRespuesta = (
          <div className="d-flex flex-column gap-1">
            {(opciones || []).map((opt, idx) => {
              const text = typeof opt === "string" ? opt : String(opt?.label ?? opt?.value ?? opt ?? "");
              const value = typeof opt === "string" ? opt : String(opt?.value ?? opt?.label ?? opt ?? "");
              if (!value) return null;

              return (
                <div className="form-check" key={idx}>
                  <input
                    type="checkbox"
                    className="form-check-input chk-round"
                    checked={selected.includes(value)}
                    onChange={() => toggle(value)}
                  />
                  <label className="form-check-label">{text}</label>
                </div>
              );
            })}
          </div>
        );
        break;
      }

      case "fecha":
        controlRespuesta = (
          <input
            type="date"
            className="form-control form-control-sm"
            value={val || ""}
            onChange={(e) => handleChangeRespuesta(pregunta.id_pregunta, "fecha", e.target.value)}
          />
        );
        break;

      case "numero":
        controlRespuesta = (
          <input
            type="number"
            className="form-control form-control-sm"
            value={val || ""}
            onChange={(e) => handleChangeRespuesta(pregunta.id_pregunta, "numero", e.target.value)}
          />
        );
        break;

      case "coordenadas":
        controlRespuesta = (
          <GoogleMapaCoordenadas
            value={Array.isArray(val) ? val : null}
            onChange={(coords) => handleChangeRespuesta(pregunta.id_pregunta, "coordenadas", coords)}
            height={260}
            readOnly={false}
            disabled={false}
          />
        );
        break;

      case "texto":
      default:
        controlRespuesta = (
          <textarea
            className="form-control form-control-sm"
            rows={2}
            value={val || ""}
            onChange={(e) => handleChangeRespuesta(pregunta.id_pregunta, "texto", e.target.value)}
          />
        );
        break;
    }

    return (
      <>
        {controlRespuesta}

        {/* ✅ permite_foto (para otros tipos), sin afectar a imagen */}
        {pregunta.permite_foto && t !== "imagen" && (
          <div className="mt-1">
            <label className="form-label mb-1 small">
              Foto(s) asociada(s) (opcional, máx. {MAX_FOTOS_POR_PREGUNTA})
            </label>
            <input
              key={`foto-${filesResetKey}-${pregunta.id_pregunta}`}
              type="file"
              className="form-control form-control-sm"
              multiple
              accept="image/*"
              onChange={(e) => handleFotosPreguntaChange(pregunta.id_pregunta, e)}
            />

            {fotosPregunta.length > 0 && (
              <>
                <div className="form-text">
                  {fotosPregunta.length} archivo{fotosPregunta.length > 1 ? "s" : ""} seleccionado
                  {fotosPregunta.length > 1 ? "s" : ""}.
                </div>
                <div className="mt-1 d-flex flex-wrap gap-2">
                  {fotosPregunta.map((file, idx) => (
                    <div key={idx} className="border rounded" style={{ width: 70, height: 70, overflow: "hidden" }}>
                      <img
                        src={URL.createObjectURL(file)}
                        alt={`preg-${pregunta.id_pregunta}-foto-${idx}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="container my-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div>
          <h2 className="mb-0">Informe dinámico</h2>
          {idProyecto && (
            <div className="text-muted small">
              Proyecto ID: <strong>{idProyecto}</strong>
            </div>
          )}
        </div>

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate("/proyectos")}>
            ← Proyectos
          </button>

          {idProyecto && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => navigate(`/proyectos/${idProyecto}/informes`)}
              title="Volver al listado agrupado por plantillas"
            >
              📄 Plantillas
            </button>
          )}
        </div>
      </div>

      <hr />

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label">Plantilla</label>
          <select
            className="form-select form-select-sm"
            value={plantillaSeleccionadaId}
            onChange={(e) => setPlantillaSeleccionadaId(e.target.value || "")}
          >
            <option value="">Seleccione una plantilla…</option>
            {plantillas.map((p) => (
              <option key={p.id_plantilla} value={p.id_plantilla}>
                {p.nombre}
              </option>
            ))}
          </select>
          <div className="form-text">
            Las plantillas se crean en el módulo <strong>“Diseñador de plantillas”</strong>.
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label">Título del informe (opcional)</label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={tituloInforme}
            onChange={(e) => setTituloInforme(e.target.value)}
            placeholder="Ej: Informe de proyecto..."
          />
        </div>

        {plantilla ? (
          <div className="mb-3">
            {plantilla.secciones
              ?.slice()
              .sort((a, b) => (a.orden || 0) - (b.orden || 0))
              .map((sec) => {
                const secVisible = evalCond(sec.visible_if, respuestas, preguntasById);
                if (!secVisible) return null;

                const preguntasOrdenadas = (sec.preguntas || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
                const preguntasVisibles = preguntasOrdenadas.filter((preg) => isVisible(preg, respuestas));

                if (preguntasVisibles.length === 0) return null;

                return (
                  <div key={sec.id_seccion} className="mb-3 border rounded p-2">
                    <h5 className="mb-2">
                      {sec.titulo} <span className="badge bg-light text-muted">orden {sec.orden}</span>
                    </h5>

                    {preguntasVisibles.map((preg) => {
                      const requiredNow = isRequiredNow(preg, respuestas);

                      return (
                        <div key={preg.id_pregunta} className="mb-3">
                          <label className="form-label mb-1">
                            {preg.etiqueta} {requiredNow && <span className="text-danger">*</span>}
                          </label>

                          {renderControlPregunta(preg)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="text-muted">Seleccioná una plantilla para ver las preguntas.</p>
        )}

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={creando || !plantillaSeleccionadaId}>
            {creando ? "Guardando…" : "Guardar informe"}
          </button>

          {/* ✅ botón manual por si querés limpiar cuando vos decidas */}
          {plantilla && (
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={() => resetFormulario(plantilla)}
              disabled={creando}
              title="Limpia el formulario (mantiene la plantilla seleccionada)"
            >
              Limpiar formulario
            </button>
          )}

          {idInformeCreado && (
            <button type="button" className="btn btn-outline-success btn-sm" onClick={() => handleVerPdf()}>
              Ver PDF generado
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default InformeDinamico;
