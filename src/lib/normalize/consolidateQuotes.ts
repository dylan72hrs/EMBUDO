import { buildComparisonScope } from "@/lib/normalize/buildComparisonScope";
import { getExchangeRate, type ExchangeRateRequest } from "@/lib/currency/getExchangeRate";
import { compareToBaseItem } from "@/lib/normalize/matchProducts";
import { displayProductName } from "@/lib/normalize/normalizeProductName";
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

function supplierSort(a: SupplierSummary, b: SupplierSummary) {
  const aIndex = SUPPLIER_ORDER.indexOf(a.name);
  const bIndex = SUPPLIER_ORDER.indexOf(b.name);

  if (aIndex >= 0 || bIndex >= 0) {
    return (aIndex >= 0 ? aIndex : 100) - (bIndex >= 0 ? bIndex : 100);
  }

  return a.name.localeCompare(b.name);
}

function createSupplierSummaries(quotes: ParsedQuote[]) {
  const supplierMap = new Map<string, SupplierSummary>();

  for (const quote of quotes) {
    supplierMap.set(quote.supplierName, {
      name: quote.supplierName,
      paymentCondition: quote.paymentCondition,
      deliveryTime: quote.deliveryTime
    });
  }

  return [...supplierMap.values()].sort(supplierSort);
}

function findBestOffer(
  baseItem: ExtractedQuoteItem,
  quote: ParsedQuote,
  usedItems: Set<ExtractedQuoteItem>
) {
  let best: { item: ExtractedQuoteItem; warning?: string; score: number } | undefined;

  for (const item of quote.items) {
    if (usedItems.has(item)) continue;
    const match = compareToBaseItem(baseItem, item);
    const score = match.quality === "high" ? 2 : match.quality === "medium" ? 1 : 0;

    if (score > 0 && (!best || score > best.score)) {
      best = { item, warning: match.warning, score };
    }
  }

  return best;
}

function extraWarning(supplierName: string, item: ExtractedQuoteItem) {
  if (/aud[ií]fono|audifono|headset|jabra|razer|blackshark|h390|tune/i.test(item.description)) {
    return `${supplierName}: ${displayProductName(item.description)} detectado como alternativa de audífono, no se agrega como fila nueva.`;
  }

  return `Producto extra no agregado a la comparación: ${displayProductName(item.description)} - proveedor ${supplierName}`;
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

function convertOfferToTarget(
  supplierName: string,
  item: ExtractedQuoteItem,
  target: Currency,
  exchangeRateValue: number | undefined,
  warnings: string[]
): SupplierOffer {
  const offer: SupplierOffer = {
    currency: item.currency,
    unitPrice: item.unitPrice,
    total: item.total,
    confidence: item.confidence
  };

  if (item.currency === target) return offer;

  if (item.currency === "UNKNOWN") {
    warnings.push(
      `${supplierName}: moneda no determinada para ${displayProductName(item.description)}; no se convierte a ${target}.`
    );
    return offer;
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
    warnings.push(
      `${supplierName}: precios convertidos de ${item.currency} a ${target} usando tipo de cambio ${exchangeRateValue}.`
    );
    return {
      ...offer,
      currency: target,
      unitPrice: convertPrice(item.unitPrice, item.currency, target, exchangeRateValue),
      total: convertPrice(item.total, item.currency, target, exchangeRateValue)
    };
  }

  return offer;
}

export async function consolidateQuotes(
  quotes: ParsedQuote[],
  exchangeRateRequest: ExchangeRateRequest = {}
): Promise<ConsolidatedComparison> {
  const scope = buildComparisonScope(quotes);
  const warnings = [...scope.warnings, ...quotes.flatMap((quote) => quote.warnings)];
  if (quotes.length === 1) {
    warnings.push("Solo se procesó una cotización válida; se generó tabla sin comparación entre proveedores.");
  }
  const suppliers = createSupplierSummaries(quotes);
  const usedBySupplier = new Map<string, Set<ExtractedQuoteItem>>();
  const outputCurrency = targetCurrency();
  const exchange = await getExchangeRate(exchangeRateRequest);
  warnings.push(...exchange.warnings);
  if (outputCurrency === "CLP") {
    warnings.push(`Valores USD convertidos a CLP usando tipo de cambio final ${exchange.finalRate} CLP/USD.`);
  } else {
    warnings.push(`Valores convertidos a ${outputCurrency} usando tipo de cambio final ${exchange.finalRate} CLP/USD.`);
  }

  for (const quote of quotes) {
    usedBySupplier.set(quote.supplierName, new Set<ExtractedQuoteItem>());
  }

  const comparison: ComparisonItem[] = scope.baseItems.map((baseItem, index) => {
    const offers: ComparisonItem["offers"] = {};
    const matchingWarnings: string[] = [];

    for (const quote of quotes) {
      const usedItems = usedBySupplier.get(quote.supplierName) ?? new Set<ExtractedQuoteItem>();
      const best = findBestOffer(baseItem, quote, usedItems);
      if (!best) continue;

      usedItems.add(best.item);
      usedBySupplier.set(quote.supplierName, usedItems);
      if (best.warning) matchingWarnings.push(`${quote.supplierName}: ${best.warning}`);

      offers[quote.supplierName] = convertOfferToTarget(
        quote.supplierName,
        best.item,
        outputCurrency,
        exchange.finalRate,
        warnings
      );
    }

    return {
      item: index + 1,
      product: displayProductName(baseItem.description),
      quantity: baseItem.quantity,
      unit: baseItem.unit || "CU",
      offers,
      matchingWarnings
    };
  });

  for (const quote of quotes) {
    const hasTargetCurrency = quote.items.some((item) => item.currency === outputCurrency);
    if (hasTargetCurrency) {
      warnings.push(`${quote.supplierName}: precios ya venían en ${outputCurrency}.`);
    }

    const usedItems = usedBySupplier.get(quote.supplierName) ?? new Set<ExtractedQuoteItem>();
    for (const item of quote.items) {
      if (!usedItems.has(item)) {
        warnings.push(extraWarning(quote.supplierName, item));
      }
    }
  }

  return {
    comparison,
    suppliers,
    warnings: [...new Set(warnings)]
  };
}
