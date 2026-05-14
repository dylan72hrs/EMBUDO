import type { AppliedExchangeRate, ComparisonItem, ConsolidatedComparison, SupplierOffer } from "@/lib/validations/quoteSchemas";

export type AnalyticsSupplier = {
  name: string;
  total: number;
  productsQuoted: number;
};

export type AnalyticsProductOffer = {
  supplier: string;
  unitPrice: number;
  total: number;
};

export type AnalyticsProduct = {
  item: number;
  name: string;
  quantity: number;
  offers: AnalyticsProductOffer[];
  bestSupplier: string | null;
  bestTotal: number | null;
  worstTotal: number | null;
  spread: number | null;
};

export type PurchaseAnalytics = {
  suppliers: AnalyticsSupplier[];
  products: AnalyticsProduct[];
  bestSupplier: { name: string; total: number } | null;
  exchangeRate: {
    mode: AppliedExchangeRate["mode"] | "unknown";
    baseRate: number | null;
    margin: number | null;
    finalRate: number | null;
    source: string;
  };
  warningsCount: number;
  hasComparison: boolean;
};

function safeQuantity(quantity: number) {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveOfferValues(offer: SupplierOffer | undefined, quantity: number) {
  if (!offer) return null;
  if (finiteNumber(offer.unitPrice)) {
    return {
      unitPrice: offer.unitPrice,
      total: offer.unitPrice * quantity
    };
  }
  if (finiteNumber(offer.total)) {
    return {
      unitPrice: quantity > 0 ? offer.total / quantity : offer.total,
      total: offer.total
    };
  }
  return null;
}

function exchangeRateSource(mode: AppliedExchangeRate["mode"] | "unknown") {
  if (mode === "auto") return "Banco Central";
  if (mode === "manual") return "Manual";
  if (mode === "env") return "Configuracion de entorno";
  if (mode === "fallback") return "Fallback";
  return "No disponible";
}

function analyticsByProduct(items: ComparisonItem[], supplierNames: string[]) {
  return items.map((item) => {
    const quantity = safeQuantity(item.quantity);
    const offers: AnalyticsProductOffer[] = [];

    for (const supplierName of supplierNames) {
      const values = resolveOfferValues(item.offers[supplierName], quantity);
      if (!values || values.total <= 0) continue;
      offers.push({
        supplier: supplierName,
        unitPrice: values.unitPrice,
        total: values.total
      });
    }

    const sortedTotals = [...offers].sort((a, b) => a.total - b.total);
    const best = sortedTotals[0];
    const worst = sortedTotals[sortedTotals.length - 1];

    return {
      item: item.item,
      name: item.product,
      quantity,
      offers,
      bestSupplier: best?.supplier ?? null,
      bestTotal: best?.total ?? null,
      worstTotal: worst?.total ?? null,
      spread: best && worst ? worst.total - best.total : null
    };
  });
}

export function buildPurchaseAnalytics(
  consolidated: ConsolidatedComparison,
  warningsCount: number
): PurchaseAnalytics {
  const supplierNames = consolidated.suppliers.map((supplier) => supplier.name);
  const products = analyticsByProduct(consolidated.comparison, supplierNames);
  const supplierTotals = new Map<string, { total: number; productsQuoted: number }>();

  for (const supplierName of supplierNames) {
    supplierTotals.set(supplierName, { total: 0, productsQuoted: 0 });
  }

  for (const product of products) {
    for (const offer of product.offers) {
      const stats = supplierTotals.get(offer.supplier);
      if (!stats) continue;
      stats.total += offer.total;
      stats.productsQuoted += 1;
    }
  }

  const suppliers = supplierNames.map((name) => {
    const stats = supplierTotals.get(name);
    return {
      name,
      total: stats?.total ?? 0,
      productsQuoted: stats?.productsQuoted ?? 0
    };
  });

  const ranked = suppliers.filter((supplier) => supplier.total > 0).sort((a, b) => a.total - b.total);
  const winner = ranked[0];
  const exchangeRate = consolidated.exchangeRate;

  return {
    suppliers,
    products,
    bestSupplier: winner ? { name: winner.name, total: winner.total } : null,
    exchangeRate: {
      mode: exchangeRate?.mode ?? "unknown",
      baseRate: exchangeRate?.baseRate ?? null,
      margin: exchangeRate?.margin ?? null,
      finalRate: exchangeRate?.finalRate ?? null,
      source: exchangeRateSource(exchangeRate?.mode ?? "unknown")
    },
    warningsCount,
    hasComparison: ranked.length > 1
  };
}
