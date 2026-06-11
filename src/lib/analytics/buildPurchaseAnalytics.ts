import type {
  AppliedExchangeRate,
  ComparisonItem,
  ConsolidatedComparison,
  SupplierOffer
} from "@/lib/validations/quoteSchemas";

export type SupplierRecommendation = "Mejor oferta" | "Comparable" | "Revisar" | "No comparable";

export type AnalyticsSupplier = {
  name: string;
  /** Total neto CLP comparable: la misma suma item por item que la fila TOTAL del Excel. */
  total: number;
  itemsQuoted: number;
  /** Participacion porcentual sobre el total neto evaluado. */
  share: number;
  /** Diferencia en CLP contra la mejor oferta. */
  deltaVsBest: number;
  warningsCount: number;
  needsReview: boolean;
  recommendation: SupplierRecommendation;
  totalBasis: "net";
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

export type SupplierComparableTotal = {
  name: string;
  total: number;
  itemsQuoted: number;
};

export type ComparableTotalsResult = {
  suppliers: SupplierComparableTotal[];
  totalItems: number;
  /** false cuando no existe una lista solicitada comun (modo cascada): la cobertura no es calculable. */
  coverageAvailable: boolean;
};

export type PurchaseAnalytics = {
  suppliers: AnalyticsSupplier[];
  products: AnalyticsProduct[];
  bestSupplier: { name: string; total: number } | null;
  worstSupplier: { name: string; total: number } | null;
  totalEvaluatedClp: number;
  savingsVsWorstClp: number | null;
  savingsVsWorstPct: number | null;
  itemsCompared: number;
  coverageAvailable: boolean;
  exchangeRate: {
    mode: AppliedExchangeRate["mode"] | "unknown";
    baseRate: number | null;
    margin: number | null;
    finalRate: number | null;
    source: string;
  };
  warningsCount: number;
  needsReviewCount: number;
  omittedFilesCount: number;
  hasComparison: boolean;
  singleSupplier: boolean;
};

const REVIEW_WARNING_PATTERN =
  /revisi[oó]n|moneda no determinada|no se pudo convertir|monedas? mixtas?|estimado desde lineas/i;

function safeQuantity(quantity: number) {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPositive(value: number | null | undefined): value is number {
  return finiteNumber(value) && value > 0;
}

export function isRealSupplierName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (/^[\d\s.,;:%$#°/-]+$/.test(trimmed)) return false;
  if (/^(proveedor|supplier|empresa|nombre)\s*\d*$/i.test(trimmed)) return false;
  return true;
}

function resolveOfferValues(offer: SupplierOffer | undefined, quantity: number) {
  if (!offer) return null;
  if (validPositive(offer.total)) {
    return {
      unitPrice: validPositive(offer.unitPrice) ? offer.unitPrice : offer.total / quantity,
      total: offer.total
    };
  }
  if (validPositive(offer.unitPrice)) {
    return {
      unitPrice: offer.unitPrice,
      total: offer.unitPrice * quantity
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

/**
 * Fuente de verdad unica para los totales por proveedor.
 *
 * Replica exactamente lo que escribe el Excel principal:
 *  - Modo cascada: suma item.total de cada bloque del proveedor
 *    (writeCascadePurchaseTotals), valores ya convertidos linea a linea a CLP.
 *  - Modo comparacion: suma los totales de las ofertas mostradas en la tabla
 *    (writePurchaseTotals).
 *
 * Nunca usa subtotales/totales del documento (offerNetTotalCLP), que pueden
 * estar inflados cuando la cotizacion tiene moneda mixta.
 */
export function computeSupplierComparableTotals(
  consolidated: ConsolidatedComparison
): ComparableTotalsResult {
  if (consolidated.cascadeBlocks && consolidated.cascadeBlocks.length > 0) {
    const suppliers = consolidated.suppliers.map((supplier, index) => {
      let total = 0;
      let itemsQuoted = 0;
      for (const block of consolidated.cascadeBlocks ?? []) {
        if (block.supplierIndex !== index) continue;
        for (const item of block.items) {
          itemsQuoted += 1;
          if (validPositive(item.total)) {
            total += item.total;
          } else if (validPositive(item.unitPrice)) {
            total += item.unitPrice * safeQuantity(item.quantity);
          }
        }
      }
      return { name: supplier.name, total, itemsQuoted };
    });

    const totalItems = new Set(
      consolidated.cascadeBlocks.flatMap((block) => block.items.map((item) => item.item))
    ).size;

    return { suppliers, totalItems, coverageAvailable: false };
  }

  const totalItems = consolidated.comparison.length;
  const suppliers = consolidated.suppliers.map((supplier) => {
    let total = 0;
    let itemsQuoted = 0;
    for (const item of consolidated.comparison) {
      const values = resolveOfferValues(item.offers[supplier.name], safeQuantity(item.quantity));
      if (!values || values.total <= 0) continue;
      total += values.total;
      itemsQuoted += 1;
    }
    return { name: supplier.name, total, itemsQuoted };
  });

  return { suppliers, totalItems, coverageAvailable: totalItems > 0 };
}

function supplierNeedsReview(supplierName: string, warnings: string[]) {
  const normalizedName = supplierName.trim().toLowerCase();
  if (!normalizedName) return false;
  return warnings.some(
    (warning) =>
      warning.toLowerCase().includes(normalizedName) && REVIEW_WARNING_PATTERN.test(warning)
  );
}

function supplierWarningsCount(supplierName: string, warnings: string[]) {
  const normalizedName = supplierName.trim().toLowerCase();
  if (!normalizedName) return 0;
  return warnings.filter((warning) => warning.toLowerCase().includes(normalizedName)).length;
}

/** Cuenta proveedores reales con advertencias que exigen revision manual. */
export function countSuppliersNeedingReview(
  consolidated: ConsolidatedComparison,
  extraWarnings: string[] = []
): number {
  const warnings = [...consolidated.warnings, ...extraWarnings];
  return consolidated.suppliers.filter(
    (supplier) => isRealSupplierName(supplier.name) && supplierNeedsReview(supplier.name, warnings)
  ).length;
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
  warnings: string[],
  options: { omittedFilesCount?: number } = {}
): PurchaseAnalytics {
  const comparableTotals = computeSupplierComparableTotals(consolidated);
  const validTotals = comparableTotals.suppliers.filter(
    (supplier) => isRealSupplierName(supplier.name) && supplier.total > 0
  );
  const ranked = [...validTotals].sort((a, b) => a.total - b.total);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const totalEvaluatedClp = ranked.reduce((sum, supplier) => sum + supplier.total, 0);

  const suppliers: AnalyticsSupplier[] = ranked.map((supplier) => {
    const needsReview = supplierNeedsReview(supplier.name, warnings);
    const isBest = best !== undefined && supplier.name === best.name;
    return {
      name: supplier.name,
      total: supplier.total,
      itemsQuoted: supplier.itemsQuoted,
      share: totalEvaluatedClp > 0 ? (supplier.total / totalEvaluatedClp) * 100 : 0,
      deltaVsBest: best ? supplier.total - best.total : 0,
      warningsCount: supplierWarningsCount(supplier.name, warnings),
      needsReview,
      recommendation: isBest ? "Mejor oferta" : needsReview ? "Revisar" : "Comparable",
      totalBasis: "net" as const
    };
  });

  const products = analyticsByProduct(
    consolidated.comparison,
    consolidated.suppliers.map((supplier) => supplier.name)
  );
  const exchangeRate = consolidated.exchangeRate;
  const hasComparison = ranked.length > 1;
  const savingsVsWorstClp = hasComparison && best && worst ? worst.total - best.total : null;

  return {
    suppliers,
    products,
    bestSupplier: best ? { name: best.name, total: best.total } : null,
    worstSupplier: hasComparison && worst ? { name: worst.name, total: worst.total } : null,
    totalEvaluatedClp,
    savingsVsWorstClp,
    savingsVsWorstPct:
      savingsVsWorstClp !== null && worst && worst.total > 0
        ? (savingsVsWorstClp / worst.total) * 100
        : null,
    itemsCompared: comparableTotals.totalItems,
    coverageAvailable: comparableTotals.coverageAvailable && ranked.length > 0,
    exchangeRate: {
      mode: exchangeRate?.mode ?? "unknown",
      baseRate: exchangeRate?.baseRate ?? null,
      margin: exchangeRate?.margin ?? null,
      finalRate: exchangeRate?.finalRate ?? null,
      source: exchangeRateSource(exchangeRate?.mode ?? "unknown")
    },
    warningsCount: warnings.length,
    needsReviewCount: suppliers.filter((supplier) => supplier.needsReview).length,
    omittedFilesCount: options.omittedFilesCount ?? 0,
    hasComparison,
    singleSupplier: ranked.length === 1
  };
}
