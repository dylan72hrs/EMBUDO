export type ExchangeRateRequest = {
  exchangeRateMode?: "auto" | "manual";
  manualExchangeRateClpPerUsd?: string | number | null;
  exchangeRateMarginClp?: string | number | null;
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

// Source 1: Banco Central public HTML pages (no auth required)
const BCENTRAL_PUBLIC_URLS = [
  "https://www.bcentral.cl/indicadores-financieros/tipos-de-cambio-de-referencia",
  "https://si3.bcentral.cl/Indicadoresdiarios/secure/IndicadoresDiariosYM.aspx",
];

// Source 2: Mindicador.cl - Chilean public JSON API backed by Banco Central / CMF
const MINDICADOR_URL = "https://mindicador.cl/api/dolar";

const DEFAULT_EXCHANGE_RATE_MARGIN_CLP = 5;
const DEFAULT_FALLBACK_EXCHANGE_RATE_CLP_PER_USD = 950;

// ---- helpers ----------------------------------------------------------------

function parsePositive(value?: string | number | null) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value?: string | number | null) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  if (!normalized) return undefined;
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseMargin(requestMargin?: string | number | null) {
  if (requestMargin !== undefined && requestMargin !== null && String(requestMargin).trim() !== "") {
    const marginFromRequest = parseNonNegativeInteger(requestMargin);
    if (marginFromRequest === undefined) {
      return {
        margin: DEFAULT_EXCHANGE_RATE_MARGIN_CLP,
        warnings: ["Margen adicional invalido; se uso margen por defecto 5 CLP."]
      };
    }
    return { margin: marginFromRequest, warnings: [] };
  }

  const rawMargin = process.env.EXCHANGE_RATE_MARGIN_CLP;
  if (rawMargin === undefined || rawMargin.trim() === "") {
    return { margin: DEFAULT_EXCHANGE_RATE_MARGIN_CLP, warnings: [] };
  }

  const margin = parseNonNegativeInteger(rawMargin);
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

function extractObservedDollarFromHtml(html: string): number | undefined {
  const labelPattern = /D[o\u00f3]lar\s+observado/i;
  const labelMatch = labelPattern.exec(html);
  if (labelMatch && labelMatch.index >= 0) {
    const slice = html.slice(labelMatch.index, labelMatch.index + 1200);
    const labelValue = /<label[^>]*>\s*([\d\.,]+)\s*<\/label>/i.exec(slice);
    if (labelValue) {
      const parsed = parseChileanNumber(labelValue[1]);
      if (parsed) return parsed;
    }
    const spanValue = /<span[^>]*>\s*([\d\.,]+)\s*<\/span>/i.exec(slice);
    if (spanValue) {
      const parsed = parseChileanNumber(spanValue[1]);
      if (parsed) return parsed;
    }
    const bareValue = />\s*([\d]{3,4}[,.][ \d]{2,4})\s*</i.exec(slice);
    if (bareValue) {
      const parsed = parseChileanNumber(bareValue[1]);
      if (parsed && parsed > 100 && parsed < 9999) return parsed;
    }
  }
  return undefined;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json",
        "User-Agent": "Mozilla/5.0 (compatible; EMBUDO/1.0)"
      },
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok ? response : undefined;
  } catch {
    clearTimeout(timeout);
    return undefined;
  }
}

// ---- Source 1: Banco Central HTML -------------------------------------------

async function fetchFromBcentral(): Promise<number | undefined> {
  for (const url of BCENTRAL_PUBLIC_URLS) {
    try {
      const response = await fetchWithTimeout(url, 6000);
      if (!response) continue;
      const html = await response.text();
      const value = extractObservedDollarFromHtml(html);
      if (value) return value;
    } catch {
      // try next URL
    }
  }
  return undefined;
}

// ---- Source 2: Mindicador.cl JSON API ---------------------------------------

async function fetchFromMindicador(): Promise<number | undefined> {
  try {
    const response = await fetchWithTimeout(MINDICADOR_URL, 8000);
    if (!response) return undefined;

    const json = (await response.json()) as {
      serie?: Array<{ fecha?: string; valor?: number }>;
    };

    const serie = json?.serie;
    if (!Array.isArray(serie) || serie.length === 0) return undefined;

    const valor = serie[0]?.valor;
    if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) return valor;
    return undefined;
  } catch {
    return undefined;
  }
}

// ---- public helpers ---------------------------------------------------------

export function parseExchangeRateValue(value?: string | number | null) {
  return parsePositive(value);
}

// ---- main export ------------------------------------------------------------

export async function getExchangeRate(
  request: ExchangeRateRequest = {}
): Promise<ExchangeRateResult> {
  const marginResult = parseMargin(request.exchangeRateMarginClp);
  const { margin } = marginResult;
  const warnings = [...marginResult.warnings];
  const requestedMode = request.exchangeRateMode === "manual" ? "manual" : "auto";

  // Manual mode
  if (requestedMode === "manual") {
    const manualRate = parsePositive(request.manualExchangeRateClpPerUsd);
    if (!manualRate) throw new Error("Tipo de cambio manual invalido.");
    const finalRate = manualRate + margin;
    return buildResult(
      manualRate,
      margin,
      "manual",
      [
        ...warnings,
        `Tipo de cambio final: ${formatRate(finalRate)} CLP/USD = dolar base ${formatRate(manualRate)} + margen ${formatRate(margin)}.`
      ],
      "Manual"
    );
  }

  // Auto: Source 1 - Banco Central
  const bcentral = await fetchFromBcentral();
  if (bcentral) {
    const finalRate = bcentral + margin;
    return buildResult(
      bcentral,
      margin,
      "auto",
      [
        ...warnings,
        `Tipo de cambio final: ${formatRate(finalRate)} CLP/USD = dolar observado ${formatRate(bcentral)} + margen ${formatRate(margin)}.`
      ],
      "Banco Central"
    );
  }

  // Auto: Source 2 - Mindicador.cl
  const mindicador = await fetchFromMindicador();
  if (mindicador) {
    const finalRate = mindicador + margin;
    return buildResult(
      mindicador,
      margin,
      "auto",
      [
        ...warnings,
        "Dolar observado obtenido de Mindicador.cl (fuente oficial: Banco Central / CMF).",
        `Tipo de cambio final: ${formatRate(finalRate)} CLP/USD = dolar ${formatRate(mindicador)} + margen ${formatRate(margin)}.`
      ],
      "Mindicador (Banco Central)"
    );
  }

  // Auto: Source 3 - env var override
  const envOverride = parsePositive(process.env.EXCHANGE_RATE_CLP_PER_USD);
  if (envOverride) {
    const finalRate = envOverride + margin;
    return buildResult(
      envOverride,
      margin,
      "env",
      [
        ...warnings,
        "No se pudo obtener dolar observado de Banco Central ni Mindicador.",
        `Se uso dolar de entorno ${formatRate(envOverride)} CLP/USD + margen ${formatRate(margin)}. Final: ${formatRate(finalRate)}.`
      ],
      "Entorno"
    );
  }

  // Auto: Source 4 - hardcoded fallback
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
      "No se pudo obtener dolar observado automaticamente (Banco Central ni Mindicador).",
      `Se uso dolar de respaldo ${formatRate(fallback)} CLP/USD + margen ${formatRate(margin)}. Final: ${formatRate(finalRate)}.`
    ],
    "fallback"
  );
}
