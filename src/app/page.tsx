"use client";

import { useEffect, useMemo, useState } from "react";
import { PdfUploader } from "@/components/PdfUploader";
import { ProcessingSummary, type ProcessResult } from "@/components/ProcessingSummary";
import { PurchaseAnalyticsDashboard } from "@/components/PurchaseAnalyticsDashboard";
import { CinematicBackground, type BackgroundMode } from "@/components/CinematicBackground";

const PROCESS_STEPS = [
  "Subiendo archivos...",
  "Leyendo PDFs...",
  "Detectando proveedores...",
  "Extrayendo productos y precios...",
  "Completando plantilla Excel...",
  "Generando archivo final..."
] as const;
const PROCESS_TIMEOUT_MS = 120_000;
const EXCHANGE_RATE_MARGIN_CLP = 5;
const EXCHANGE_RATE_REFRESH_MS = 60 * 60 * 1000;
const EXCHANGE_RATE_SOURCE_URL =
  "https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx";

type Screen = "upload" | "confirm" | "processing" | "success" | "error";
type ExchangeRateMode = "auto" | "manual";
type UrgencyOption = "No informado" | "Baja" | "Media" | "Alta" | "Critica";

type ProviderEvaluationFormRow = {
  id: string;
  supplierName: string;
  paymentCondition: string;
  deliveryTime: string;
  availability: string;
  associatedCosts: string;
  creditStatus: "No informado" | "Si" | "No" | "Por validar";
  providerEvaluation:
    | "No informado"
    | "Proveedor habitual"
    | "Proveedor nuevo"
    | "Por validar en SII"
    | "No recomendado";
};

type AdditionalEvaluationForm = {
  awardCriteria: string;
  awardResponsible: string;
  buyerResponsible: string;
  urgency: UrgencyOption;
  budgetObjective: string;
  supplierEvaluations: ProviderEvaluationFormRow[];
};
type ExchangeRateInfo = {
  status?: string;
  baseRate?: number;
  margin?: number;
  finalRate?: number;
  mode?: "auto" | "manual" | "fallback" | "env";
  source?: string;
  date?: string;
  warning?: string;
  warnings?: string[];
  message?: string;
  sourceUrl?: string;
};

function formatRate(value?: number) {
  if (value === undefined) return "No disponible";
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function createProviderEvaluationRow(): ProviderEvaluationFormRow {
  return {
    id: crypto.randomUUID(),
    supplierName: "",
    paymentCondition: "",
    deliveryTime: "",
    availability: "",
    associatedCosts: "",
    creditStatus: "No informado",
    providerEvaluation: "No informado"
  };
}

function hasAnyAdditionalData(data: AdditionalEvaluationForm) {
  if (
    data.awardCriteria.trim() ||
    data.awardResponsible.trim() ||
    data.buyerResponsible.trim() ||
    data.budgetObjective.trim() ||
    data.urgency !== "No informado"
  ) {
    return true;
  }

  return data.supplierEvaluations.some((row) =>
    [
      row.supplierName,
      row.paymentCondition,
      row.deliveryTime,
      row.availability,
      row.associatedCosts
    ].some((value) => value.trim().length > 0) || row.creditStatus !== "No informado" || row.providerEvaluation !== "No informado"
  );
}

export default function Home() {
  const [quotes, setQuotes] = useState<File[]>([]);
  const [screen, setScreen] = useState<Screen>("upload");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [exchangeRateMode, setExchangeRateMode] = useState<ExchangeRateMode>("auto");
  const [manualExchangeRate, setManualExchangeRate] = useState("");
  const [exchangeRateError, setExchangeRateError] = useState("");
  const [exchangeRateInfo, setExchangeRateInfo] = useState<ExchangeRateInfo | null>(null);
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [showAdditionalEvaluation, setShowAdditionalEvaluation] = useState(false);
  const [additionalEvaluation, setAdditionalEvaluation] = useState<AdditionalEvaluationForm>({
    awardCriteria: "",
    awardResponsible: "",
    buyerResponsible: "",
    urgency: "No informado",
    budgetObjective: "",
    supplierEvaluations: [createProviderEvaluationRow()]
  });

  const progress = useMemo(() => {
    if (screen === "success") return 100;
    if (screen !== "processing") return 0;
    return Math.min(92, 12 + stepIndex * 15);
  }, [screen, stepIndex]);

  const canSubmit = quotes.length > 0;
  const manualExchangeRateValue = useMemo(() => {
    const parsed = Number(manualExchangeRate.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }, [manualExchangeRate]);
  const manualFinalExchangeRate =
    manualExchangeRateValue === undefined ? undefined : manualExchangeRateValue + EXCHANGE_RATE_MARGIN_CLP;

  useEffect(() => {
    const controller = new AbortController();
    let intervalId: number | undefined;

    function buildParams() {
      const params = new URLSearchParams();
      params.set("mode", exchangeRateMode);
      if (exchangeRateMode === "manual" && manualExchangeRateValue !== undefined) {
        params.set("manualExchangeRateClpPerUsd", String(manualExchangeRateValue));
      }
      return params;
    }

    async function loadExchangeRate() {
      setExchangeRateLoading(true);
      try {
        const response = await fetch(`/api/exchange-rate?${buildParams().toString()}`, {
          signal: controller.signal
        });
        const payload = (await response.json()) as ExchangeRateInfo;
        if (!response.ok) {
          throw new Error(payload.message ?? "No se pudo obtener tipo de cambio.");
        }
        setExchangeRateInfo(payload);
      } catch {
        if (!controller.signal.aborted) {
          setExchangeRateInfo((previous) => previous ?? { message: "No se pudo cargar el dolar observado." });
        }
      } finally {
        if (!controller.signal.aborted) {
          setExchangeRateLoading(false);
        }
      }
    }

    void loadExchangeRate();
    intervalId = window.setInterval(() => {
      void loadExchangeRate();
    }, EXCHANGE_RATE_REFRESH_MS);

    return () => {
      controller.abort();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [exchangeRateMode, manualExchangeRateValue]);

  function removeFile(index: number) {
    setQuotes((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function resetFlow() {
    setQuotes([]);
    setResult(null);
    setStepIndex(0);
    setExchangeRateMode("auto");
    setManualExchangeRate("");
    setExchangeRateError("");
    setShowAdditionalEvaluation(false);
    setAdditionalEvaluation({
      awardCriteria: "",
      awardResponsible: "",
      buyerResponsible: "",
      urgency: "No informado",
      budgetObjective: "",
      supplierEvaluations: [createProviderEvaluationRow()]
    });
    setScreen("upload");
  }

  function updateAdditionalEvaluationField<K extends keyof AdditionalEvaluationForm>(
    key: K,
    value: AdditionalEvaluationForm[K]
  ) {
    setAdditionalEvaluation((current) => ({ ...current, [key]: value }));
  }

  function updateProviderEvaluationRow(
    rowId: string,
    key: keyof ProviderEvaluationFormRow,
    value: ProviderEvaluationFormRow[keyof ProviderEvaluationFormRow]
  ) {
    setAdditionalEvaluation((current) => ({
      ...current,
      supplierEvaluations: current.supplierEvaluations.map((row) =>
        row.id === rowId ? { ...row, [key]: value } : row
      )
    }));
  }

  function addProviderEvaluationRow() {
    setAdditionalEvaluation((current) => ({
      ...current,
      supplierEvaluations: [...current.supplierEvaluations, createProviderEvaluationRow()]
    }));
  }

  function removeProviderEvaluationRow(rowId: string) {
    setAdditionalEvaluation((current) => {
      const next = current.supplierEvaluations.filter((row) => row.id !== rowId);
      return {
        ...current,
        supplierEvaluations: next.length > 0 ? next : [createProviderEvaluationRow()]
      };
    });
  }

  function validateExchangeRateChoice() {
    if (exchangeRateMode === "auto") {
      setExchangeRateError("");
      return true;
    }

    if (!manualExchangeRate.trim()) {
      setExchangeRateError("Ingresa el valor del dolar manual o cambia a automatico.");
      return false;
    }

    if (!manualExchangeRateValue) {
      setExchangeRateError("El valor del dolar manual debe ser mayor que 0.");
      return false;
    }

    setExchangeRateError("");
    return true;
  }

  function goToConfirm() {
    if (!validateExchangeRateChoice()) return;
    setScreen("confirm");
  }

  async function processQuotes() {
    if (!validateExchangeRateChoice()) {
      setScreen("upload");
      return;
    }

    setScreen("processing");
    setResult(null);
    setStepIndex(0);

    const timer = window.setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, PROCESS_STEPS.length - 1));
    }, 850);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROCESS_TIMEOUT_MS);

    try {
      const formData = new FormData();
      for (const quote of quotes) {
        formData.append("quotes", quote);
      }
      formData.append("exchangeRateMode", exchangeRateMode);
      if (exchangeRateMode === "manual") {
        formData.append("manualExchangeRateClpPerUsd", manualExchangeRate);
      }
      if (hasAnyAdditionalData(additionalEvaluation)) {
        formData.append("additionalEvaluationData", JSON.stringify(additionalEvaluation));
      }

      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      const payload = (await response.json()) as ProcessResult;
      const nextScreen = response.ok && payload.status === "completed" ? "success" : "error";
      setResult(payload);
      setStepIndex(PROCESS_STEPS.length - 1);
      setScreen(nextScreen);
    } catch (error) {
      const timeoutMessage =
        error instanceof DOMException && error.name === "AbortError"
          ? "El procesamiento tardo demasiado. Intenta con menos PDFs o revisa el formato."
          : error instanceof Error
            ? error.message
            : "No se pudo contactar el servidor.";
      setResult({
        status: "error",
        message: timeoutMessage,
        warnings: []
      });
      setStepIndex(PROCESS_STEPS.length - 1);
      setScreen("error");
    } finally {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    }
  }

  const exchangeBase =
    exchangeRateMode === "manual" ? manualExchangeRateValue : exchangeRateInfo?.baseRate;
  const exchangeApplied =
    exchangeRateMode === "manual" ? manualFinalExchangeRate : exchangeRateInfo?.finalRate;
  const exchangeSourceUrl = exchangeRateInfo?.sourceUrl ?? EXCHANGE_RATE_SOURCE_URL;
  const exchangeProvider = exchangeRateInfo?.source ?? "Banco Central";
  const backgroundMode: BackgroundMode = screen === "processing" ? "processing" : screen === "success" ? "success" : "initial";

  return (
    <main className="relative min-h-screen overflow-hidden text-slate-100">
      <CinematicBackground mode={backgroundMode} />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-3 sm:px-6 sm:py-4">
        {screen === "upload" && (
          <section className="relative mt-0.5 flex-1 pb-16">
            <span className="embudo-online-badge embudo-online-floating">Online</span>
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="embudo-hero-title">
                Genera tu{" "}
                <span className="embudo-gradient-title" aria-label="tabla comparativa">
                  tabla comparativa
                </span>
              </h1>
              <p className="embudo-upload-subtitle mx-auto mt-2.5 max-w-xl text-sm leading-6 sm:text-[15px]">
                Sube cotizaciones PDF y obten un Excel listo para comparar proveedores, precios y
                condiciones.
              </p>
            </div>

            <div className="embudo-glass liquid-glass mx-auto mt-3.5 w-full max-w-[860px] rounded-3xl p-3.5 sm:p-4">
              <section className="rounded-2xl border border-white/15 bg-slate-950/30 p-3.5 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="embudo-upload-card-title text-xs font-semibold uppercase tracking-[0.08em]">
                    Tipo de cambio USD
                  </h2>
                  <span className="embudo-upload-card-meta text-[11px]">
                    {exchangeRateLoading ? "Actualizando..." : "Referencia diaria"}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={`embudo-option ${exchangeRateMode === "auto" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exchangeRateMode"
                      value="auto"
                      checked={exchangeRateMode === "auto"}
                      onChange={() => {
                        setExchangeRateMode("auto");
                        setExchangeRateError("");
                      }}
                      className="sr-only"
                    />
                    <span className="text-sm font-semibold">Automatico</span>
                    <span className="mt-1 block text-xs text-white/82">
                      Usar dolar observado del dia + $5
                    </span>
                  </label>

                  <label className={`embudo-option ${exchangeRateMode === "manual" ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="exchangeRateMode"
                      value="manual"
                      checked={exchangeRateMode === "manual"}
                      onChange={() => {
                        setExchangeRateMode("manual");
                        setExchangeRateError("");
                      }}
                      className="sr-only"
                    />
                    <span className="text-sm font-semibold">Manual</span>
                    <span className="mt-1 block text-xs text-white/82">Ingresar dolar manual</span>
                  </label>
                </div>

                {exchangeRateMode === "manual" && (
                  <div className="mt-4 rounded-xl border border-white/15 bg-slate-950/45 p-3.5">
                    <label className="text-sm font-medium text-white/92" htmlFor="manualExchangeRate">
                      1 USD =
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id="manualExchangeRate"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={manualExchangeRate}
                        onChange={(event) => {
                          setManualExchangeRate(event.target.value);
                          setExchangeRateError("");
                        }}
                        className="h-10 w-40 rounded-xl border border-slate-500 bg-slate-950/75 px-3 text-sm text-white outline-none transition focus:border-cyan-300"
                      />
                      <span className="text-sm text-white/85">CLP</span>
                    </div>
                    <p className="mt-2 text-xs text-white/80">
                      Se sumaran automaticamente $5 al valor ingresado.
                    </p>
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-cyan-200/35 bg-slate-950/36 p-3.5">
                  <p className="text-sm text-white/92">
                    Dolar observado hoy:{" "}
                    <span className="font-semibold text-white">{formatRate(exchangeBase)}</span>
                  </p>
                  <p className="mt-1 text-xs text-white/80">by: {exchangeProvider}</p>
                  <p className="mt-1 text-sm text-white/92">
                    Tipo de cambio aplicado:{" "}
                    <span className="font-semibold text-cyan-200">
                      {exchangeApplied !== undefined
                        ? `${formatRate(exchangeApplied)} CLP/USD`
                        : "No disponible"}
                    </span>
                  </p>
                  {exchangeRateInfo?.warning && (
                    <p className="mt-1 text-xs text-amber-200">{exchangeRateInfo.warning}</p>
                  )}
                  <a
                    href={exchangeSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
                  >
                    Ver en Banco Central
                  </a>
                </div>

                {exchangeRateError && (
                  <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
                    {exchangeRateError}
                  </p>
                )}
              </section>

              <div className="mt-3.5">
                <PdfUploader files={quotes} onFiles={setQuotes} onRemove={removeFile} />
              </div>

              <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/30 p-3.5">
                <button
                  type="button"
                  onClick={() => setShowAdditionalEvaluation((current) => !current)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">Datos adicionales de evaluacion</p>
                    <p className="mt-1 text-xs text-white/75">
                      Completa solo si deseas que estos datos aparezcan en la tabla comparativa final.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-cyan-200">
                    {showAdditionalEvaluation ? "Ocultar" : "Completar"}
                  </span>
                </button>

                {showAdditionalEvaluation && (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-white/85">
                        Responsable de la adjudicacion
                        <input
                          value={additionalEvaluation.awardResponsible}
                          onChange={(event) =>
                            updateAdditionalEvaluationField("awardResponsible", event.target.value)
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-300"
                          placeholder="Ej: Manuel / Logistica"
                        />
                      </label>
                      <label className="text-xs text-white/85">
                        Comprador responsable
                        <input
                          value={additionalEvaluation.buyerResponsible}
                          onChange={(event) =>
                            updateAdditionalEvaluationField("buyerResponsible", event.target.value)
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-300"
                          placeholder="Ej: Nombre del comprador"
                        />
                      </label>
                      <label className="text-xs text-white/85">
                        Grado de urgencia
                        <select
                          value={additionalEvaluation.urgency}
                          onChange={(event) =>
                            updateAdditionalEvaluationField("urgency", event.target.value as UrgencyOption)
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-300"
                        >
                          <option>No informado</option>
                          <option>Baja</option>
                          <option>Media</option>
                          <option>Alta</option>
                          <option>Critica</option>
                        </select>
                      </label>
                      <label className="text-xs text-white/85">
                        Presupuesto objetivo / referencia
                        <input
                          value={additionalEvaluation.budgetObjective}
                          onChange={(event) =>
                            updateAdditionalEvaluationField("budgetObjective", event.target.value)
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-white/20 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-300"
                          placeholder="Ej: 15000000"
                          inputMode="decimal"
                        />
                      </label>
                    </div>

                    <label className="block text-xs text-white/85">
                      Criterio de adjudicacion
                      <textarea
                        value={additionalEvaluation.awardCriteria}
                        onChange={(event) => updateAdditionalEvaluationField("awardCriteria", event.target.value)}
                        className="mt-1 min-h-20 w-full rounded-lg border border-white/20 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                        placeholder="Ej: Se adjudica por mejor precio, disponibilidad inmediata y cumplimiento tecnico."
                      />
                    </label>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/85">
                          Variables por proveedor
                        </p>
                        <button
                          type="button"
                          onClick={addProviderEvaluationRow}
                          className="h-8 rounded-lg border border-cyan-200/45 bg-cyan-400/20 px-3 text-xs font-semibold text-cyan-100"
                        >
                          Agregar proveedor
                        </button>
                      </div>

                      {additionalEvaluation.supplierEvaluations.map((row) => (
                        <article key={row.id} className="rounded-lg border border-white/15 bg-slate-900/55 p-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <input
                              value={row.supplierName}
                              onChange={(event) =>
                                updateProviderEvaluationRow(row.id, "supplierName", event.target.value)
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                              placeholder="Proveedor (Ej: ADIS)"
                            />
                            <input
                              value={row.paymentCondition}
                              onChange={(event) =>
                                updateProviderEvaluationRow(row.id, "paymentCondition", event.target.value)
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                              placeholder="Condicion de pago"
                            />
                            <input
                              value={row.deliveryTime}
                              onChange={(event) =>
                                updateProviderEvaluationRow(row.id, "deliveryTime", event.target.value)
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                              placeholder="Plazo de entrega"
                            />
                            <input
                              value={row.availability}
                              onChange={(event) =>
                                updateProviderEvaluationRow(row.id, "availability", event.target.value)
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                              placeholder="Disponibilidad"
                            />
                            <input
                              value={row.associatedCosts}
                              onChange={(event) =>
                                updateProviderEvaluationRow(row.id, "associatedCosts", event.target.value)
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                              placeholder="Costos asociados"
                            />
                            <select
                              value={row.creditStatus}
                              onChange={(event) =>
                                updateProviderEvaluationRow(
                                  row.id,
                                  "creditStatus",
                                  event.target.value as ProviderEvaluationFormRow["creditStatus"]
                                )
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300"
                            >
                              <option>No informado</option>
                              <option>Si</option>
                              <option>No</option>
                              <option>Por validar</option>
                            </select>
                            <select
                              value={row.providerEvaluation}
                              onChange={(event) =>
                                updateProviderEvaluationRow(
                                  row.id,
                                  "providerEvaluation",
                                  event.target.value as ProviderEvaluationFormRow["providerEvaluation"]
                                )
                              }
                              className="h-9 rounded-lg border border-white/20 bg-slate-900/70 px-3 text-xs text-white outline-none focus:border-cyan-300 sm:col-span-2 lg:col-span-2"
                            >
                              <option>No informado</option>
                              <option>Proveedor habitual</option>
                              <option>Proveedor nuevo</option>
                              <option>Por validar en SII</option>
                              <option>No recomendado</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => removeProviderEvaluationRow(row.id)}
                              className="h-9 rounded-lg border border-rose-300/40 bg-rose-900/30 px-3 text-xs font-semibold text-rose-100"
                            >
                              Quitar
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <button
                type="button"
                disabled={!canSubmit}
                onClick={goToConfirm}
                className="embudo-primary-btn mt-4 h-10 w-full text-sm font-semibold"
              >
                Enviar cotizaciones
              </button>
            </div>

            <div className="embudo-branding-corner" aria-hidden>
              <p className="embudo-branding-title">MASTER DRILLING</p>
              <p className="embudo-branding-subtitle">Área TI</p>
              <p className="embudo-kicker embudo-branding-kicker">Automatizacion inteligente</p>
            </div>
          </section>
        )}

        {screen === "confirm" && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 px-4">
            <div className="embudo-glass liquid-glass w-full max-w-md rounded-2xl p-6">
              <h2 className="text-xl font-semibold">Confirmar envio</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Vas a procesar {quotes.length} cotizaciones. Verifica que no falte ningun archivo antes de
                continuar.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setScreen("upload")}
                  className="h-10 rounded-lg border border-slate-500 px-4 text-sm font-semibold text-slate-200 transition hover:bg-slate-800/70"
                >
                  Volver
                </button>
                <button type="button" onClick={processQuotes} className="embudo-primary-btn h-10 px-4 text-sm">
                  Si, procesar
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "processing" && (
          <div className="mx-auto my-auto w-full max-w-3xl">
            <section className="embudo-glass liquid-glass rounded-3xl p-6 text-center sm:p-8">
              <p className="embudo-kicker">Procesamiento real</p>
              <h2 className="mt-2 text-3xl font-semibold">Estamos preparando el Excel</h2>
              <p className="mt-3 text-sm text-slate-300">{PROCESS_STEPS[stepIndex]}</p>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-900/70">
                <div className="embudo-progress h-full rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-6 grid gap-2 text-left text-sm text-slate-200 sm:grid-cols-2">
                {PROCESS_STEPS.map((step, index) => (
                  <div
                    key={step}
                    className={`rounded-lg border px-3 py-2 transition ${
                      index <= stepIndex
                        ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-100"
                        : "border-slate-700/80 bg-slate-900/45 text-slate-300"
                    }`}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {screen === "success" && (
          <div className="relative mx-auto mt-4 w-full max-w-4xl space-y-4 pb-10">
            <ProcessingSummary result={result} />
            {result?.analytics && (
              <PurchaseAnalyticsDashboard
                analytics={result.analytics}
                budgetObjective={result.budgetObjective}
              />
            )}
            <button
              type="button"
              onClick={resetFlow}
              className="embudo-secondary-btn h-10 rounded-xl px-5 text-sm font-semibold"
            >
              Procesar nuevas cotizaciones
            </button>
            <div className="embudo-success-branding" aria-hidden>
              <p className="embudo-branding-title">MASTER DRILLING</p>
            </div>
          </div>
        )}

        {screen === "error" && (
          <div className="mx-auto my-auto w-full max-w-4xl space-y-5">
            <ProcessingSummary result={result} />
            <button
              type="button"
              onClick={() => setScreen("upload")}
              className="embudo-primary-btn h-11 rounded-xl px-5 text-sm font-semibold"
            >
              Volver a intentar
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
