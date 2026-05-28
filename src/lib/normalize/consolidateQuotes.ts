import { buildComparisonScope } from "@/lib/normalize/buildComparisonScope";
import {
  getExchangeRate,
  type ExchangeRateRequest,
  type ExchangeRateResult
} from "@/lib/currency/getExchangeRate";
import { compareToBaseItem } from "@/lib/normalize/matchProducts";
import { displayProductName } from "@/lib/normalize/normalizeProductName";
import { parseMoney } from "@/lib/parser/parseMoney";
import { isAssociatedCostText } from "@/lib/parser/providers/tableParserUtils";
import type {
  ComparisonItem,
  ConsolidatedComparison,
  Currency,
  ExtractedQuoteItem,
  ParsedQuote,
  SupplierOffer,
  SupplierSummary
} from "@/lib/validations/quoteSchemas";

const SUPPLIER_ORDER = ["Echave Turri", "ADIS", "Tecno Mercado"];
const COST_KEYWORDS =
  "(?:cobro log[ií]stico|log[ií]stica|logistico|logistica|flete|despacho|env[ií]o|transporte|cargo despacho|cargo por despacho|costo despacho|costo de env[ií]o|costos de env[ií]o|servicio de entrega|delivery|shipping|freight|handling)";
const NON_PRODUCT_PATTERN = new RegExp(
  `\\b(${COST_KEYWORDS}|subtotal|total neto|total general|iva|ila|condici[oó]n de pago|observaciones?)\\b`,
  "i"
);
const ASSOCIATED_COST_PATTERN = new RegExp(`\\b${COST_KEYWORDS}\\b`, "i");

type WorkingRow = {
  seedItem: ExtractedQuoteItem;
  offers: ComparisonItem["offers"];
  matchingWarnings: string[];
};

type ConversionTracker = {
  applied: boolean;
  convertedPerSupplier: Map<string, number>;
};

type WarningSection = "TIPO DE CAMBIO" | "CONVERSION DE MONEDAS" | "LINEAS OMITIDAS" | "RIESGOS";

function formatWarning(section: WarningSection, message: string) {
  return `[${section}] ${message}`;
}

function supplierSort(a: SupplierSummary, b: SupplierSummary) {
  const aIndex = SUPPLIER_ORDER.indexOf(a.name);
  const bIndex = SUPPLIER_ORDER.indexOf(b.name);

  if (aIndex >= 0 || bIndex >= 0) {
    return (aIndex >= 0 ? aIndex : 100) - (bIndex >= 0 ? bIndex : 100);
  }

  return a.name.localeCompare(b.name);
}

function formatClp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

type AssociatedCostEntry = {
  type: string;
  amount: number;
};

function resolveAssociatedCostType(warning: string) {
  const lower = warning.toLowerCase();
  if (lower.includes("cobro log")) return "Cobro Logístico";
  if (lower.includes("logistic") || lower.includes("logistica") || lower.includes("logistico")) return "Logística";
  if (lower.includes("flete")) return "Flete";
  if (lower.includes("despacho")) return "Despacho";
  if (lower.includes("envio") || lower.includes("envío")) return "Envío";
  if (lower.includes("transporte")) return "Transporte";
  if (lower.includes("delivery")) return "Delivery";
  if (lower.includes("shipping")) return "Shipping";
  if (lower.includes("freight")) return "Freight";
  if (lower.includes("handling")) return "Handling";
  return "Costo asociado";
}

function extractAssociatedCostsFromWarnings(warnings: string[]) {
  const entries: AssociatedCostEntry[] = [];

  for (const warning of warnings) {
    if (!isAssociatedCostText(warning) && !ASSOCIATED_COST_PATTERN.test(warning)) continue;

    const moneyMatches = [...warning.matchAll(/(?:US\$|USD|CLP|\$)\s*\d[\d.,]*/gi)];
    const amountToken = moneyMatches.at(-1)?.[0];
    const parsedAmount = amountToken ? parseMoney(amountToken) : null;
    if (typeof parsedAmount !== "number" || !Number.isFinite(parsedAmount) || parsedAmount <= 0) continue;

    entries.push({
      type: resolveAssociatedCostType(warning),
      amount: parsedAmount
    });
  }

  if (entries.length === 0) {
    return {
      total: 0,
      details: [] as string[]
    };
  }

  const details = entries.map((entry) => `${entry.type} ${formatClp(entry.amount)}`);
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    total,
    details
  };
}

function isRawAssociatedCostWarning(warning: string) {
  return warning.toLowerCase().includes("costo asociado detectado y omitido de productos comparables");
}

function createSupplierSummaries(quotes: ParsedQuote[]) {
  const supplierMap = new Map<string, SupplierSummary>();

  for (const quote of quotes) {
    const associatedCosts = extractAssociatedCostsFromWarnings(quote.warnings);
    supplierMap.set(quote.supplierName, {
      name: quote.supplierName,
      paymentCondition: quote.paymentCondition,
      deliveryTime: quote.deliveryTime,
      associatedCosts: associatedCosts.total > 0 ? String(Math.round(associatedCosts.total)) : undefined
    });
  }

  return [...supplierMap.values()].sort(supplierSort);
}

function isComparableProduct(item: ExtractedQuoteItem) {
  const description = item.description.toLowerCase();
  if (NON_PRODUCT_PATTERN.test(description)) return false;
  if (isAssociatedCostText(item.description) || isAssociatedCostText(item.rawLine ?? "")) return false;
  if (!item.rawLine && !item.rawBlock) return false;
  return item.unitPrice !== null || item.total !== null;
}

function findBestOffer(
  baseItem: ExtractedQuoteItem,
  quote: ParsedQuote,
  usedItems: Set<ExtractedQuoteItem>
) {
  let best: { item: ExtractedQuoteItem; warning?: string; score: number } | undefined;

  for (const item of quote.items) {
    if (usedItems.has(item) || !isComparableProduct(item)) continue;
    const match = compareToBaseItem(baseItem, item);
    const score = match.quality === "high" ? 2 : match.quality === "medium" ? 1 : 0;

    if (score > 0 && (!best || score > best.score)) {
      best = { item, warning: match.warning, score };
    }
  }

  return best;
}

function targetCurrency(): Currency {
  return process.env.TARGET_CURRENCY === "USD" ? "USD" : "CLP";
}

function convertPrice(value: number | null, from: Currency, to: Currency, rate: number) {
  if (value === null || from === to) return value;
  if (from === "CLP" && to === "USD") return value / rate;
  if (from === "USD" && to === "CLP") return value * rate;
  return value;
}

function validPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function comparisonQuantity(quantity: number, itemNumber: number, warnings: string[]) {
  if (Number.isFinite(quantity) && quantity > 0) return quantity;
  warnings.push(`Cantidad invalida para item ${itemNumber}; se uso 1.`);
  return 1;
}

function normalizeOfferTotals(offer: SupplierOffer, quantity: number): SupplierOffer {
  if (validPositive(offer.unitPrice)) {
    return {
      ...offer,
      total: offer.unitPrice * quantity
    };
  }

  if (validPositive(offer.total)) {
    return {
      ...offer,
      unitPrice: offer.total / quantity
    };
  }

  return {
    ...offer,
    unitPrice: null,
    total: null
  };
}

function itemNeedsConversion(item: ExtractedQuoteItem, target: Currency) {
  return item.currency !== "UNKNOWN" && item.currency !== target;
}

function convertOfferToTarget(
  supplierName: string,
  item: ExtractedQuoteItem,
  target: Currency,
  quantity: number,
  exchangeRateValue: number | undefined,
  warnings: string[],
  conversionTracker: ConversionTracker
): SupplierOffer {
  const offer: SupplierOffer = {
    currency: item.currency,
    originalCurrency: item.currency,
    wasConverted: false,
    unitPrice: item.unitPrice,
    total: item.total,
    confidence: item.confidence
  };

  if (item.currency === target) return normalizeOfferTotals(offer, quantity);

  if (item.currency === "UNKNOWN") {
    warnings.push(
      formatWarning(
        "RIESGOS",
        `${supplierName}: moneda no determinada para ${displayProductName(item.description)}; no se aplico conversion.`
      )
    );
    return normalizeOfferTotals(offer, quantity);
  }

  if (!exchangeRateValue) {
    warnings.push(
      formatWarning(
        "RIESGOS",
        `No se pudo convertir ${displayProductName(item.description)} de ${supplierName} porque no hay tipo de cambio disponible.`
      )
    );
    return offer;
  }

  if (
    (item.currency === "CLP" && target === "USD") ||
    (item.currency === "USD" && target === "CLP")
  ) {
    conversionTracker.applied = true;
    conversionTracker.convertedPerSupplier.set(
      supplierName,
      (conversionTracker.convertedPerSupplier.get(supplierName) ?? 0) + 1
    );
    return normalizeOfferTotals(
      {
        ...offer,
        currency: target,
        wasConverted: true,
        exchangeRateUsed: exchangeRateValue,
        unitPrice: convertPrice(item.unitPrice, item.currency, target, exchangeRateValue),
        total: convertPrice(item.total, item.currency, target, exchangeRateValue)
      },
      quantity
    );
  }

  return normalizeOfferTotals(offer, quantity);
}

function attachQuoteOfferToRow(
  row: WorkingRow,
  quote: ParsedQuote,
  usedBySupplier: Map<string, Set<ExtractedQuoteItem>>,
  outputCurrency: Currency,
  exchangeRate: number | undefined,
  warnings: string[],
  conversionTracker: ConversionTracker
) {
  if (row.offers[quote.supplierName]) return;
  const usedItems = usedBySupplier.get(quote.supplierName) ?? new Set<ExtractedQuoteItem>();
  const best = findBestOffer(row.seedItem, quote, usedItems);
  if (!best) return;

  usedItems.add(best.item);
  usedBySupplier.set(quote.supplierName, usedItems);
  if (best.warning) row.matchingWarnings.push(`${quote.supplierName}: ${best.warning}`);

  row.offers[quote.supplierName] = convertOfferToTarget(
    quote.supplierName,
    best.item,
    outputCurrency,
    row.seedItem.quantity,
    exchangeRate,
    warnings,
    conversionTracker
  );
}

function tryAttachUnmatchedItemToExistingRows(
  rows: WorkingRow[],
  supplierName: string,
  item: ExtractedQuoteItem,
  outputCurrency: Currency,
  exchangeRate: number | undefined,
  warnings: string[],
  conversionTracker: ConversionTracker
) {
  for (const row of rows) {
    if (row.offers[supplierName]) continue;
    const match = compareToBaseItem(row.seedItem, item);
    if (match.quality === "none") continue;

    row.offers[supplierName] = convertOfferToTarget(
      supplierName,
      item,
      outputCurrency,
      row.seedItem.quantity,
      exchangeRate,
      warnings,
      conversionTracker
    );
    if (match.warning) row.matchingWarnings.push(`${supplierName}: ${match.warning}`);
    return true;
  }
  return false;
}

export async function consolidateQuotes(
  quotes: ParsedQuote[],
  exchangeRateRequest: ExchangeRateRequest = {},
  options: { exchangeRate?: ExchangeRateResult } = {}
): Promise<ConsolidatedComparison> {
  const scope = buildComparisonScope(quotes);
  const warnings: string[] = [
    ...scope.warnings,
    ...quotes.flatMap((quote) => quote.warnings).filter((warning) => !isRawAssociatedCostWarning(warning))
  ];
  if (quotes.length === 1) {
    warnings.push(
      formatWarning(
        "RIESGOS",
        "Solo se proceso una cotizacion valida; no existe comparacion entre multiples proveedores."
      )
    );
  }

  const suppliers = createSupplierSummaries(quotes);
  for (const quote of quotes) {
    const associatedCosts = extractAssociatedCostsFromWarnings(quote.warnings);
    if (associatedCosts.total <= 0) continue;
    warnings.push(
      formatWarning(
        "LINEAS OMITIDAS",
        `${quote.supplierName} incluye costos asociados: ${associatedCosts.details.join(", ")}. Total: ${formatClp(
          associatedCosts.total
        )}.`
      )
    );
  }
  const usedBySupplier = new Map<string, Set<ExtractedQuoteItem>>();
  const outputCurrency = targetCurrency();
  const requiresConversion = quotes.some((quote) =>
    quote.items.some((item) => isComparableProduct(item) && itemNeedsConversion(item, outputCurrency))
  );
  const exchange = options.exchangeRate ?? (await getExchangeRate(exchangeRateRequest));
  const conversionTracker: ConversionTracker = { applied: false, convertedPerSupplier: new Map() };

  if (requiresConversion) {
    warnings.push(...exchange.warnings.map((warning) => formatWarning("TIPO DE CAMBIO", warning)));
  }

  for (const quote of quotes) {
    usedBySupplier.set(quote.supplierName, new Set<ExtractedQuoteItem>());
  }

  const rows: WorkingRow[] = [];

  for (const baseItem of scope.baseItems.filter(isComparableProduct)) {
    const row: WorkingRow = {
      seedItem: baseItem,
      offers: {},
      matchingWarnings: []
    };

    for (const quote of quotes) {
      attachQuoteOfferToRow(
        row,
        quote,
        usedBySupplier,
        outputCurrency,
        exchange.finalRate,
        warnings,
        conversionTracker
      );
    }

    if (Object.keys(row.offers).length > 0) {
      rows.push(row);
    }
  }

  for (const quote of quotes) {
    const usedItems = usedBySupplier.get(quote.supplierName) ?? new Set<ExtractedQuoteItem>();

    for (const item of quote.items) {
      if (usedItems.has(item) || !isComparableProduct(item)) continue;

      const attached = tryAttachUnmatchedItemToExistingRows(
        rows,
        quote.supplierName,
        item,
        outputCurrency,
        exchange.finalRate,
        warnings,
        conversionTracker
      );
      if (attached) {
        usedItems.add(item);
        continue;
      }

      const independentRow: WorkingRow = {
        seedItem: item,
        offers: {
          [quote.supplierName]: convertOfferToTarget(
            quote.supplierName,
            item,
            outputCurrency,
            item.quantity,
            exchange.finalRate,
            warnings,
            conversionTracker
          )
        },
        matchingWarnings: [
          `${quote.supplierName}: producto agregado como fila independiente porque no tuvo equivalente seguro.`
        ]
      };
      usedItems.add(item);

      for (const otherQuote of quotes) {
        if (otherQuote.supplierName === quote.supplierName) continue;
        attachQuoteOfferToRow(
          independentRow,
          otherQuote,
          usedBySupplier,
          outputCurrency,
          exchange.finalRate,
          warnings,
          conversionTracker
        );
      }

      rows.push(independentRow);
    }

    usedBySupplier.set(quote.supplierName, usedItems);
  }

  const comparison: ComparisonItem[] = rows.map((row, index) => {
    const itemNumber = index + 1;
    const quantity = comparisonQuantity(row.seedItem.quantity, itemNumber, warnings);

    return {
      item: itemNumber,
      product: displayProductName(row.seedItem.description),
      quantity,
      unit: row.seedItem.unit || "CU",
      offers: row.offers,
      matchingWarnings: row.matchingWarnings
    };
  });

  if (requiresConversion && conversionTracker.applied) {
    warnings.push(
      formatWarning(
        "TIPO DE CAMBIO",
        `Tipo de cambio final aplicado: ${exchange.finalRate} CLP/USD = dolar base ${exchange.baseRate} + margen adicional ${exchange.margin}.`
      )
    );
  }

  for (const quote of quotes) {
    const comparableItems = quote.items.filter(isComparableProduct);
    const usdCount = comparableItems.filter((item) => item.currency === "USD").length;
    const clpCount = comparableItems.filter((item) => item.currency === "CLP").length;
    const unknownCount = comparableItems.filter((item) => item.currency === "UNKNOWN").length;
    const convertedCount = conversionTracker.convertedPerSupplier.get(quote.supplierName) ?? 0;

    if (usdCount > 0 && clpCount > 0) {
      warnings.push(
        formatWarning(
          "CONVERSION DE MONEDAS",
          `${quote.supplierName}: se detectaron productos en USD y CLP. Los productos en USD fueron convertidos a CLP (${convertedCount} conversiones) y los productos en CLP se mantuvieron sin conversion.`
        )
      );
    } else if (usdCount > 0) {
      warnings.push(
        formatWarning(
          "CONVERSION DE MONEDAS",
          `${quote.supplierName}: se detectaron ${usdCount} productos en USD. Se convirtieron a CLP usando el tipo de cambio final configurado.`
        )
      );
    } else if (clpCount > 0) {
      warnings.push(
        formatWarning(
          "CONVERSION DE MONEDAS",
          `${quote.supplierName}: productos detectados originalmente en CLP, sin conversion de moneda.`
        )
      );
    }

    if (unknownCount > 0) {
      warnings.push(
        formatWarning(
          "RIESGOS",
          `${quote.supplierName}: ${unknownCount} linea(s) con moneda no detectada requieren revision manual.`
        )
      );
    }
  }

  return {
    comparison,
    suppliers,
    warnings: [...new Set(warnings)],
    exchangeRate: {
      mode: exchange.mode,
      baseRate: exchange.baseRate,
      margin: exchange.margin,
      finalRate: exchange.finalRate
    }
  };
}
