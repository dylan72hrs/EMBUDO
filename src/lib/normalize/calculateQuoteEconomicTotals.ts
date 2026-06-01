import { displayProductName } from "@/lib/normalize/normalizeProductName";
import { isAssociatedCostText } from "@/lib/parser/providers/tableParserUtils";
import type { Currency, ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

export type QuoteEconomicTotals = {
  itemsTotalCLP: number;
  associatedCostTotalCLP: number;
  explicitNetTotalCLP: number | null;
  explicitTaxCLP: number | null;
  explicitGrossTotalCLP: number | null;
  offerNetTotalCLP: number | null;
  offerGrossTotalCLP: number | null;
  totalsSource:
    | "explicit_quote_subtotal"
    | "explicit_subtotal"
    | "calculated_items_plus_associated_costs"
    | "unavailable";
  grossTotalsSource:
    | "explicit_quote_total"
    | "explicit_total"
    | "calculated_net_plus_tax"
    | "unavailable";
  includesAssociatedCosts: boolean;
  estimated: boolean;
  warnings: string[];
};

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function convertToClp(
  value: number | undefined,
  currency: Currency | undefined,
  exchangeRate: number | undefined,
  context: string,
  warnings: string[]
) {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (currency === "CLP") return value;
  if (currency === "USD") {
    if (!exchangeRate) {
      warnings.push(`${context}: no se pudo convertir USD a CLP porque no hay tipo de cambio disponible.`);
      return null;
    }
    return value * exchangeRate;
  }
  warnings.push(`${context}: moneda no determinada; no se uso para el total economico CLP.`);
  return null;
}

function itemTotal(item: ExtractedQuoteItem) {
  if (isPositive(item.total)) return item.total;
  if (isPositive(item.unitPrice) && Number.isFinite(item.quantity) && item.quantity > 0) {
    return item.unitPrice * item.quantity;
  }
  return undefined;
}

function isValuedComparableItem(item: ExtractedQuoteItem) {
  const description = `${item.description} ${item.rawLine ?? ""}`;
  if (isAssociatedCostText(description)) return false;
  if (/\b(subtotal|total neto|total general|iva|i\.v\.a|observaciones?)\b/i.test(description)) {
    return false;
  }
  return isPositive(item.total) || isPositive(item.unitPrice);
}

function explicitValueToClp(
  clpValue: number | undefined,
  rawValue: number | undefined,
  currency: Currency | undefined,
  exchangeRate: number | undefined,
  context: string,
  warnings: string[]
) {
  if (isPositive(clpValue)) return clpValue;
  return convertToClp(rawValue, currency, exchangeRate, context, warnings);
}

export function calculateQuoteEconomicTotals(
  quote: ParsedQuote,
  exchangeRateFinal: number | undefined
): QuoteEconomicTotals {
  const warnings: string[] = [];
  const documentCurrency = quote.currency ?? "UNKNOWN";

  const itemsTotalCLP = quote.items.reduce((sum, item) => {
    if (!isValuedComparableItem(item)) return sum;
    const converted = convertToClp(
      itemTotal(item),
      item.currency,
      exchangeRateFinal,
      `${quote.supplierName}: ${displayProductName(item.description)}`,
      warnings
    );
    return converted === null ? sum : sum + converted;
  }, 0);

  const associatedCostTotalCLP = (quote.associatedCosts ?? []).reduce((sum, cost) => {
    const converted =
      isPositive(cost.amountCLP)
        ? cost.amountCLP
        : convertToClp(
            cost.amount,
            cost.currency,
            exchangeRateFinal,
            `${quote.supplierName}: ${cost.description}`,
            warnings
          );
    return converted === null ? sum : sum + converted;
  }, 0);

  const explicitQuoteSubtotalCLP = explicitValueToClp(
    quote.quoteSubtotalCLP,
    quote.quoteSubtotal,
    documentCurrency,
    exchangeRateFinal,
    `${quote.supplierName}: subtotal de cotizacion`,
    warnings
  );
  const explicitSubtotalCLP = explicitValueToClp(
    undefined,
    quote.subtotal,
    documentCurrency,
    exchangeRateFinal,
    `${quote.supplierName}: subtotal`,
    warnings
  );
  const explicitNetTotalCLP = explicitQuoteSubtotalCLP ?? explicitSubtotalCLP;

  const explicitTaxCLP = explicitValueToClp(
    quote.quoteTaxCLP,
    quote.quoteTax ?? quote.tax,
    documentCurrency,
    exchangeRateFinal,
    `${quote.supplierName}: impuesto/IVA`,
    warnings
  );
  const explicitQuoteTotalCLP = explicitValueToClp(
    quote.quoteTotalCLP,
    quote.quoteTotal,
    documentCurrency,
    exchangeRateFinal,
    `${quote.supplierName}: total final`,
    warnings
  );
  const explicitTotalCLP = explicitValueToClp(
    undefined,
    quote.total,
    documentCurrency,
    exchangeRateFinal,
    `${quote.supplierName}: total`,
    warnings
  );
  const explicitGrossTotalCLP = explicitQuoteTotalCLP ?? explicitTotalCLP;

  let offerNetTotalCLP: number | null = null;
  let totalsSource: QuoteEconomicTotals["totalsSource"] = "unavailable";
  let estimated = false;
  let includesAssociatedCosts = false;

  if (explicitNetTotalCLP !== null) {
    offerNetTotalCLP = explicitNetTotalCLP;
    totalsSource = explicitQuoteSubtotalCLP !== null ? "explicit_quote_subtotal" : "explicit_subtotal";
    if (associatedCostTotalCLP > 0) {
      warnings.push(
        `${quote.supplierName}: costos asociados informados; se usa subtotal del documento como fuente principal para evitar doble conteo.`
      );
    }
  } else if (itemsTotalCLP > 0 || associatedCostTotalCLP > 0) {
    offerNetTotalCLP = itemsTotalCLP + associatedCostTotalCLP;
    totalsSource = "calculated_items_plus_associated_costs";
    includesAssociatedCosts = associatedCostTotalCLP > 0;
    estimated = true;
  }

  let offerGrossTotalCLP: number | null = null;
  let grossTotalsSource: QuoteEconomicTotals["grossTotalsSource"] = "unavailable";

  if (explicitGrossTotalCLP !== null) {
    offerGrossTotalCLP = explicitGrossTotalCLP;
    grossTotalsSource = explicitQuoteTotalCLP !== null ? "explicit_quote_total" : "explicit_total";
  } else if (offerNetTotalCLP !== null && explicitTaxCLP !== null) {
    offerGrossTotalCLP = offerNetTotalCLP + explicitTaxCLP;
    grossTotalsSource = "calculated_net_plus_tax";
    estimated = true;
  } else if (offerNetTotalCLP !== null) {
    warnings.push(
      `${quote.supplierName}: no se encontro total bruto explicito; se mantiene ranking economico en base neta.`
    );
  }

  return {
    itemsTotalCLP,
    associatedCostTotalCLP,
    explicitNetTotalCLP,
    explicitTaxCLP,
    explicitGrossTotalCLP,
    offerNetTotalCLP,
    offerGrossTotalCLP,
    totalsSource,
    grossTotalsSource,
    includesAssociatedCosts,
    estimated,
    warnings
  };
}
