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
  source: string;
  date: string;
};

const BCENTRAL_INDICATORS_URL =
  "https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx";
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
      warnings: ["Margen de tipo de cambio invalido; se uso margen por defecto 5 CLP."]
    };
  }

  return { margin, warnings: [] };
}

function formatRate(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildResult(
  baseRate: number,
  margin: number,
  mode: ExchangeRateResult["mode"],
  warnings: string[],
  source: string
): ExchangeRateResult {
  return {
    baseRate,
    margin,
    finalRate: baseRate + margin,
    mode,
    warnings,
    source,
    date: currentIsoDate()
  };
}

function parseChileanNumber(rawValue: string) {
  const compact = rawValue.replace(/\s/g, "");
  const normalized = compact.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractObservedDollar(html: string) {
  const labelPattern = /D[oó]lar\s+observado/i;
  const labelMatch = labelPattern.exec(html);
  if (!labelMatch || labelMatch.index < 0) return undefined;

  const slice = html.slice(labelMatch.index, labelMatch.index + 800);
  const valueMatch = /<label[^>]*>\s*([\d\.,]+)\s*<\/label>/i.exec(slice);
  if (!valueMatch) return undefined;

  return parseChileanNumber(valueMatch[1]);
}

async function fetchObservedDollarFromBcentral() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(BCENTRAL_INDICATORS_URL, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0"
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return undefined;

    const html = await response.text();
    return extractObservedDollar(html);
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
      throw new Error("Tipo de cambio manual invalido.");
    }

    const finalRate = manualRate + margin;
    return buildResult(
      manualRate,
      margin,
      "manual",
      [
        ...warnings,
        `Tipo de cambio manual: ${formatRate(manualRate)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
      ],
      "Manual"
    );
  }

  const observed = await fetchObservedDollarFromBcentral();
  if (observed) {
    const finalRate = observed + margin;
    return buildResult(
      observed,
      margin,
      "auto",
      [
        ...warnings,
        `Tipo de cambio automatico: dolar observado ${formatRate(observed)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
      ],
      "Banco Central"
    );
  }

  const envOverride = parsePositive(process.env.EXCHANGE_RATE_CLP_PER_USD);
  if (envOverride) {
    const finalRate = envOverride + margin;
    return buildResult(
      envOverride,
      margin,
      "env",
      [
        ...warnings,
        "No se pudo obtener dolar observado desde Banco Central.",
        `Se uso tipo de cambio de entorno ${formatRate(envOverride)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
      ],
      "Entorno"
    );
  }

  const fallback =
    parsePositive(process.env.FALLBACK_EXCHANGE_RATE_CLP_PER_USD) ??
    DEFAULT_FALLBACK_EXCHANGE_RATE_CLP_PER_USD;
  const finalRate = fallback + margin;

  return buildResult(
    fallback,
    margin,
    "fallback",
    [
      ...warnings,
      "No se pudo obtener dolar observado desde Banco Central.",
      `Se uso fallback ${formatRate(fallback)} + margen ${formatRate(margin)} = ${formatRate(finalRate)} CLP/USD.`
    ],
    "fallback"
  );
}
