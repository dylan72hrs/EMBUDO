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
    setScreen("upload");
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
          <div className="mx-auto mt-4 w-full max-w-4xl space-y-4 pb-6">
            <ProcessingSummary result={result} />
            {result?.analytics && <PurchaseAnalyticsDashboard analytics={result.analytics} />}
            <button
              type="button"
              onClick={resetFlow}
              className="embudo-secondary-btn h-10 rounded-xl px-5 text-sm font-semibold"
            >
              Procesar nuevas cotizaciones
            </button>
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
