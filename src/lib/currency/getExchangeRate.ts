export type ExchangeRateRequest = {
  exchangeRateMode?: "auto" | "manual";
  manualExchangeRateClpPerUsd?: string | number | null;
};

export type ExchangeRateResult = {
  baseRate: number;
  margin: number;
  finalRate: number;
  mode: "auto" | "manual" | "fallback" | "env";
  warnings: string[];
};

const MINDICADOR_DOLAR_URL = "https://mindicador.cl/api/dolar";
const DEFAULT_EXCHANGE_RATE_MARGIN_CLP = 5;
const DEFAULT_FALLBACK_EXCHANGE_RATE_CLP_PER_USD = 950;

function parsePositive(value?: string | number | null) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseMargin() {
  const rawMargin = process.env.EXCHANGE_RATE_MARGIN_CLP;
  if (rawMargin === undefined || rawMargin.trim() === "") {
    return { margin: DEFAULT_EXCHANGE_RATE_MARGIN_CLP, warnings: [] };
  }

  const margin = parsePositive(rawMargin);
  if (margin === undefined) {
    return {
      margin: DEFAULT_EXCHANGE_RATE_MARGIN_CLP,
      warnings: ["Margen de tipo de cambio inválido; se usó margen por defecto 5 CLP."]
    };
  }

  return { margin, warnings: [] };
}

function formatRate(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function buildResult(
  baseRate: number,
  margin: number,
  mode: ExchangeRateResult["mode"],
  warnings: string[]
): ExchangeRateResult {
  return {
    baseRate,
    margin,
    finalRate: baseRate + margin,
    mode,
    warnings
  };
}

async function fetchObservedDollar() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(MINDICADOR_DOLAR_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return undefined;

    const payload = (await response.json()) as {
      serie?: Array<{ valor?: number }>;
    };
    const observed = payload.serie?.[0]?.valor;
    return Number.isFinite(observed) && observed && observed > 0 ? observed : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseExchangeRateValue(value?: string | number | null) {
  return parsePositive(value);
}

export async function getExchangeRate(request: ExchangeRateRequest = {}): Promise<ExchangeRateResult> {
  const marginResult = parseMargin();
  const { margin } = marginResult;
  const warnings = [...marginResult.warnings];
  const requestedMode = request.exchangeRateMode === "manual" ? "manual" : "auto";

  if (requestedMode === "manual") {
    const manualRate = parsePositive(request.manualExchangeRateClpPerUsd);
    if (!manualRate) {
      throw new Error("Tipo de cambio manual inválido.");
    }

    const finalRate = manualRate + margin;
    return buildResult(manualRate, margin, "manual", [
      ...warnings,
      `Tipo de cambio manual: ${formatRate(manualRate)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
    ]);
  }

  const observed = await fetchObservedDollar();
  if (observed) {
    const finalRate = observed + margin;
    return buildResult(observed, margin, "auto", [
      ...warnings,
      `Tipo de cambio automático: dólar observado ${formatRate(observed)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
    ]);
  }

  const envOverride = parsePositive(process.env.EXCHANGE_RATE_CLP_PER_USD);
  if (envOverride) {
    const finalRate = envOverride + margin;
    return buildResult(envOverride, margin, "env", [
      ...warnings,
      `No se pudo obtener dólar observado; se usó tipo de cambio de entorno ${formatRate(envOverride)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
    ]);
  }

  const fallback =
    parsePositive(process.env.FALLBACK_EXCHANGE_RATE_CLP_PER_USD) ??
    DEFAULT_FALLBACK_EXCHANGE_RATE_CLP_PER_USD;
  const finalRate = fallback + margin;

  return buildResult(fallback, margin, "fallback", [
    ...warnings,
    `No se pudo obtener dólar observado; se usó fallback ${formatRate(fallback)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
  ]);
}
