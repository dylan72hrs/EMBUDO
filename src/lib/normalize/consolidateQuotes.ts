import { buildComparisonScope } from "@/lib/normalize/buildComparisonScope";
import { getExchangeRate, type ExchangeRateRequest } from "@/lib/currency/getExchangeRate";
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
};

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

function extractAssociatedCostsFromWarnings(warnings: string[]) {
  const costs: string[] = [];
  const seen = new Set<string>();

  for (const warning of warnings) {
    if (!ASSOCIATED_COST_PATTERN.test(warning)) continue;

    const typeMatch = warning.match(/incluye\s+(.+?)\s+por\s+/i);
    const normalizedType = typeMatch?.[1]?.trim() ?? "Costo asociado";
    const moneyMatch = warning.match(/(?:US\$|USD|CLP|\$)\s*\d[\d.,]*/i);
    const parsedAmount = moneyMatch ? parseMoney(moneyMatch[0]) : null;
    const label =
      typeof parsedAmount === "number" && Number.isFinite(parsedAmount)
        ? `${normalizedType}: ${formatClp(parsedAmount)}`
        : warning.trim();

    if (!seen.has(label)) {
      seen.add(label);
      costs.push(label);
    }
  }

  return costs;
}

function createSupplierSummaries(quotes: ParsedQuote[]) {
  const supplierMap = new Map<string, SupplierSummary>();

  for (const quote of quotes) {
    const associatedCosts = extractAssociatedCostsFromWarnings(quote.warnings);
    supplierMap.set(quote.supplierName, {
      name: quote.supplierName,
      paymentCondition: quote.paymentCondition,
      deliveryTime: quote.deliveryTime,
      associatedCosts: associatedCosts.length > 0 ? associatedCosts.join(" | ") : undefined
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
    unitPrice: item.unitPrice,
    total: item.total,
    confidence: item.confidence
  };

  if (item.currency === target) return normalizeOfferTotals(offer, quantity);

  if (item.currency === "UNKNOWN") {
    warnings.push(
      `${supplierName}: moneda no determinada para ${displayProductName(item.description)}; no se convierte a ${target}.`
    );
    return normalizeOfferTotals(offer, quantity);
  }

  if (!exchangeRateValue) {
    warnings.push(
      `No se pudo convertir ${displayProductName(item.description)} de ${supplierName} porque no hay tipo de cambio disponible.`
    );
    return offer;
  }

  if (
    (item.currency === "CLP" && target === "USD") ||
    (item.currency === "USD" && target === "CLP")
  ) {
    conversionTracker.applied = true;
    warnings.push(
      `${supplierName}: precios convertidos de ${item.currency} a ${target} usando tipo de cambio ${exchangeRateValue}.`
    );
    return normalizeOfferTotals(
      {
        ...offer,
        currency: target,
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
  exchangeRateRequest: ExchangeRateRequest = {}
): Promise<ConsolidatedComparison> {
  const scope = buildComparisonScope(quotes);
  const warnings = [...scope.warnings, ...quotes.flatMap((quote) => quote.warnings)];
  if (quotes.length === 1) {
    warnings.push("Solo se proceso una cotizacion valida; se genero tabla sin comparacion entre proveedores.");
  }

  const suppliers = createSupplierSummaries(quotes);
  const usedBySupplier = new Map<string, Set<ExtractedQuoteItem>>();
  const outputCurrency = targetCurrency();
  const requiresConversion = quotes.some((quote) =>
    quote.items.some((item) => isComparableProduct(item) && itemNeedsConversion(item, outputCurrency))
  );
  const exchange = await getExchangeRate(exchangeRateRequest);
  const conversionTracker: ConversionTracker = { applied: false };

  if (requiresConversion) {
    warnings.push(...exchange.warnings);
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
    if (outputCurrency === "CLP") {
      warnings.push(`Valores USD convertidos a CLP usando tipo de cambio final ${exchange.finalRate} CLP/USD.`);
    } else {
      warnings.push(`Valores convertidos a ${outputCurrency} usando tipo de cambio final ${exchange.finalRate} CLP/USD.`);
    }
  }

  for (const quote of quotes) {
    const hasTargetCurrency = quote.items.some((item) => item.currency === outputCurrency);
    if (hasTargetCurrency) {
      warnings.push(`${quote.supplierName}: precios ya venian en ${outputCurrency}.`);
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
