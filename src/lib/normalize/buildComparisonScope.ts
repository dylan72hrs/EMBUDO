import type { ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

const PREFERRED_BASE_SUPPLIERS = ["Echave Turri"];

function supplierRank(quote: ParsedQuote) {
  const preferredIndex = PREFERRED_BASE_SUPPLIERS.findIndex((name) => quote.supplierName === name);
  if (preferredIndex >= 0) return preferredIndex;
  return 100;
}

function isBaseCandidate(item: ExtractedQuoteItem) {
  const description = item.description.toLowerCase();
  if (/env[ií]o|despacho|flete|disponibilidad|stock|\btotal\b|\biva\b|i\.v\.a/.test(description)) {
    return false;
  }
  return item.unitPrice !== null || item.total !== null;
}

export type ComparisonScope = {
  baseSupplierName: string;
  baseItems: ExtractedQuoteItem[];
  warnings: string[];
};

export function buildComparisonScope(quotes: ParsedQuote[]): ComparisonScope {
  const sortedQuotes = [...quotes].sort((a, b) => {
    const rankDiff = supplierRank(a) - supplierRank(b);
    if (rankDiff !== 0) return rankDiff;
    return b.items.filter(isBaseCandidate).length - a.items.filter(isBaseCandidate).length;
  });

  const baseQuote = sortedQuotes.find((quote) => quote.items.some(isBaseCandidate));

  if (!baseQuote) {
    return {
      baseSupplierName: "Sin proveedor base",
      baseItems: [],
      warnings: ["No se pudo construir una lista base de productos."]
    };
  }

  return {
    baseSupplierName: baseQuote.supplierName,
    baseItems: baseQuote.items.filter(isBaseCandidate),
    warnings:
      baseQuote.supplierName === "Echave Turri"
        ? []
        : [`Se usó ${baseQuote.supplierName} como lista base porque Echave Turri no estaba disponible.`]
  };
}
