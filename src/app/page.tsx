"use client";

import { useEffect, useMemo, useState } from "react";
import { PdfUploader } from "@/components/PdfUploader";
import { ProcessingSummary, type ProcessResult } from "@/components/ProcessingSummary";

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

type Screen = "upload" | "confirm" | "processing" | "success" | "error";
type ExchangeRateMode = "auto" | "manual";
type ExchangeRateInfo = {
  status: "ok" | "error";
  baseRate?: number;
  margin?: number;
  finalRate?: number;
  mode?: "auto" | "manual" | "fallback" | "env";
  provider?: string;
  sourceUrl?: string;
  message?: string;
  warnings?: string[];
};

export default function Home() {
  const [quotes, setQuotes] = useState<File[]>([]);
  const [screen, setScreen] = useState<Screen>("upload");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [exchangeRateMode, setExchangeRateMode] = useState<ExchangeRateMode>("auto");
  const [manualExchangeRate, setManualExchangeRate] = useState("");
  const [exchangeRateError, setExchangeRateError] = useState("");
  const [exchangeRateInfo, setExchangeRateInfo] = useState<ExchangeRateInfo | null>(null);

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
  const automaticAppliedRate = exchangeRateInfo?.finalRate;
  const observedRate = exchangeRateInfo?.baseRate;
  const displayedAppliedRate = exchangeRateMode === "manual" ? manualFinalExchangeRate : automaticAppliedRate;

  useEffect(() => {
    let mounted = true;

    async function loadExchangeRate() {
      try {
        const response = await fetch("/api/exchange-rate");
        const payload = (await response.json()) as ExchangeRateInfo;
        if (!mounted) return;
        setExchangeRateInfo(payload);
      } catch {
        if (!mounted) return;
        setExchangeRateInfo({
          status: "error",
          message: "No se pudo cargar el dólar observado."
        });
      }
    }

    void loadExchangeRate();

    return () => {
      mounted = false;
    };
  }, []);

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
      setExchangeRateError("Ingresa el valor del dólar manual o cambia a automático.");
      return false;
    }

    if (!manualExchangeRateValue) {
      setExchangeRateError("El valor del dólar manual debe ser mayor que 0.");
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
          ? "El procesamiento tardó demasiado. Intenta con menos PDFs o revisa el formato."
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.20),_transparent_32%),linear-gradient(135deg,_#07111f_0%,_#111827_48%,_#172033_100%)] px-4 py-8 text-white">
      <section className="w-full max-w-5xl rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
        {screen === "upload" && (
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                Automatizacion documental
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal sm:text-4xl">
                Genera tu tabla comparativa
              </h1>
              <section className="mx-auto mt-5 max-w-2xl rounded-lg border border-slate-700 bg-slate-950/45 p-4 text-left">
                <h2 className="text-sm font-semibold text-white">Tipo de cambio USD</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label
                    className={`cursor-pointer rounded-md border p-3 transition ${
                      exchangeRateMode === "auto"
                        ? "border-cyan-300 bg-cyan-300/10"
                        : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
                    }`}
                  >
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
                    <span className="block text-sm font-semibold text-white">Automático</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-300">
                      Usar dólar observado del día + $5
                    </span>
                  </label>

                  <label
                    className={`cursor-pointer rounded-md border p-3 transition ${
                      exchangeRateMode === "manual"
                        ? "border-cyan-300 bg-cyan-300/10"
                        : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
                    }`}
                  >
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
                    <span className="block text-sm font-semibold text-white">Manual</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-300">
                      Ingresar dólar manual
                    </span>
                  </label>
                </div>

                {exchangeRateMode === "manual" ? (
                  <div className="mt-4">
                    <label className="text-sm font-medium text-slate-200" htmlFor="manualExchangeRate">
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
                        className="h-10 w-36 rounded-md border border-slate-600 bg-slate-950 px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300"
                      />
                      <span className="text-sm text-slate-300">CLP</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      Se sumarán automáticamente $5 al valor ingresado.
                    </p>
                    {manualFinalExchangeRate !== undefined && (
                      <p className="mt-2 text-sm font-semibold text-cyan-100">
                        Tipo de cambio final: {manualFinalExchangeRate} CLP/USD
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-xs leading-5 text-slate-300">
                    La app intentará usar el dólar observado actual y sumará $5.
                  </p>
                )}

                {exchangeRateError && <p className="mt-3 text-sm text-rose-200">{exchangeRateError}</p>}

                <section className="mt-4 rounded-md border border-slate-700 bg-slate-900/60 p-3">
                  <p className="text-xs text-slate-300">
                    Dólar observado hoy:{" "}
                    <span className="font-semibold text-slate-100">
                      {observedRate !== undefined ? observedRate : "No disponible"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    by: {exchangeRateInfo?.provider ?? "Banco Central"}
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Tipo de cambio aplicado:{" "}
                    <span className="font-semibold text-cyan-100">
                      {displayedAppliedRate !== undefined ? `${displayedAppliedRate} CLP/USD` : "No disponible"}
                    </span>
                  </p>
                  <a
                    href={
                      exchangeRateInfo?.sourceUrl ??
                      "https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx"
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs font-semibold text-cyan-200 underline decoration-cyan-200/50 underline-offset-2 hover:text-cyan-100"
                  >
                    Ver en Banco Central
                  </a>
                </section>
              </section>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Sube las cotizaciones PDF. La app usará automáticamente la plantilla oficial en
                templates/template.xlsx.
              </p>
            </div>

            <PdfUploader files={quotes} onFiles={setQuotes} onRemove={removeFile} />

            <button
              type="button"
              disabled={!canSubmit}
              onClick={goToConfirm}
              className="mt-6 h-12 w-full rounded-md bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            >
              Enviar cotizaciones
            </button>
          </div>
        )}

        {screen === "confirm" && (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/75 px-4">
            <div className="w-full max-w-md rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
              <h2 className="text-xl font-semibold">Confirmar envío</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Vas a procesar {quotes.length} cotizaciones. Verifica que no falte ningún archivo antes de
                continuar.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setScreen("upload")}
                  className="h-10 rounded-md border border-slate-600 px-4 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={processQuotes}
                  className="h-10 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
                >
                  Sí, procesar
                </button>
              </div>
            </div>
          </div>
        )}

        {screen === "processing" && (
          <div className="mx-auto max-w-2xl py-12 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
              Procesando cotizaciones
            </p>
            <h1 className="mt-3 text-3xl font-semibold">Estamos preparando el Excel</h1>
            <p className="mt-4 text-sm text-slate-300">{PROCESS_STEPS[stepIndex]}</p>
            <div className="mt-8 h-3 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-6 grid gap-2 text-left text-sm text-slate-300 sm:grid-cols-2">
              {PROCESS_STEPS.map((step, index) => (
                <div
                  key={step}
                  className={`rounded-md border px-3 py-2 ${
                    index <= stepIndex
                      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                      : "border-slate-700 bg-slate-950/40"
                  }`}
                >
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === "success" && (
          <div className="mx-auto max-w-3xl space-y-5">
            <ProcessingSummary result={result} />
            <button
              type="button"
              onClick={resetFlow}
              className="h-11 rounded-md border border-slate-600 px-5 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
            >
              Procesar nuevas cotizaciones
            </button>
          </div>
        )}

        {screen === "error" && (
          <div className="mx-auto max-w-3xl space-y-5">
            <ProcessingSummary result={result} />
            <button
              type="button"
              onClick={() => setScreen("upload")}
              className="h-11 rounded-md bg-white px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
            >
              Volver a intentar
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
