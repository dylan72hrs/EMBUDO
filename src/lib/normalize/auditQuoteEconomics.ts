/**
 * auditQuoteEconomics.ts
 *
 * Auditoria economica por cotizacion, posterior a la extraccion (n8n o local)
 * y previa a la consolidacion. Hace que la comparacion sea defendible:
 *
 *  1. NETO SIN IVA como unica base de adjudicacion:
 *     - pricesIncludeVat=true -> lineas normalizadas a neto (÷1,19) con warning.
 *     - si la suma de lineas calza con el TOTAL BRUTO del documento y existe un
 *       subtotal neto explicito distinto, las lineas se reescalan al neto
 *       (evidencia documental, no invento) con warning + needsReview.
 *
 *  2. Descuentos:
 *     - lineas "DESCUENTO/DSCTO/DCTO" con monto se retiran de los productos y
 *       se aplican proporcionalmente a las lineas de la misma moneda ANTES de
 *       comparar (valueBasis "discounted_line", monto en discountApplied).
 *     - si no se puede aplicar con seguridad (moneda ambigua o monto >= suma),
 *       NO se aplica y se marca needsReview.
 *
 *  3. Medidas no son precios:
 *     - si un precio coincide con un numero que aparece como medida en la
 *       descripcion (210 cm, 19 mm, 210x60x19, 2,10 m...) o es un CLP
 *       implausiblemente bajo, y no hay evidencia que lo corrobore, el valor
 *       se anula (no se inventa) y la linea queda en revision manual.
 *
 *  4. Justificacion por item (valueBasis) + trazabilidad:
 *     - cada linea queda con valueBasis / netValueUsed / sourceValueRaw /
 *       discountApplied, y la cotizacion con un resumen [TRAZABILIDAD].
 *
 *  5. Reconciliacion contra subtotal neto explicito del documento:
 *     - si la suma de lineas difiere del subtotal neto declarado, se conserva
 *       la suma de lineas (fuente de verdad del Excel/web) y se marca
 *       needsReview con el detalle.
 */

import type {
  Currency,
  ExtractedQuoteItem,
  ParsedQuote,
  ValueBasis
} from "@/lib/validations/quoteSchemas";

export const CHILE_VAT_RATE = 0.19;

// Solo lineas que SON un descuento ("DESCUENTO 10%", "Dscto. especial"), no
// productos que mencionan la palabra ("Notebook con descuento incluido").
const DISCOUNT_LINE_PATTERN = /^\W*(?:\d+\s*%?\s*)?(descuento|dscto\.?|dcto\.?|nota de credito)\b/i;
const MEASUREMENT_UNITS =
  "(?:cm|cms|mm|mts?|m2|m3|kg|kgs|grs?|lts?|lt|pulg(?:adas)?|plg|hz|ah|kw|w|v|°)";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPositive(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function priceTolerance(reference: number) {
  return Math.max(2, Math.abs(reference) * 0.005);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatAmount(value: number, currency: Currency) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(value);
  }
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(value);
}

function itemQuantity(item: ExtractedQuoteItem) {
  return Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
}

function itemNetTotal(item: ExtractedQuoteItem): number | null {
  if (validPositive(item.total)) return item.total;
  if (validPositive(item.unitPrice)) return item.unitPrice * itemQuantity(item);
  return null;
}

/**
 * Numeros que aparecen como medidas/dimensiones en la descripcion o linea
 * original: "210 cm", "19mm", "2,10 m", "210x60x19", 'alto 14"'.
 */
export function measurementTokens(text: string): number[] {
  const tokens = new Set<number>();
  const normalized = text.toLowerCase();

  const unitPattern = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${MEASUREMENT_UNITS}\\b`, "gi");
  for (const match of normalized.matchAll(unitPattern)) {
    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value)) tokens.add(value);
  }

  const inchesPattern = /(\d+(?:[.,]\d+)?)\s*(?:"|'')/g;
  for (const match of normalized.matchAll(inchesPattern)) {
    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value)) tokens.add(value);
  }

  // Dimensiones tipo 210x60x19 o 60 x 40
  const dimsPattern = /(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))+/gi;
  for (const match of normalized.matchAll(dimsPattern)) {
    for (const part of match[0].split(/x/i)) {
      const value = Number(part.trim().replace(",", "."));
      if (Number.isFinite(value)) tokens.add(value);
    }
  }

  return [...tokens];
}

function matchesToken(value: number, tokens: number[]) {
  return tokens.some((token) => Math.abs(token - value) < 0.01);
}

/**
 * Un precio CLP de B2B bajo este umbral sin corroboracion es casi seguro una
 * medida, un codigo o una mala lectura del separador de miles.
 */
const CLP_IMPLAUSIBLE_UNIT_PRICE = 500;

type GuardResult = {
  item: ExtractedQuoteItem;
  dropped: boolean;
  warning?: string;
};

function guardMeasurementAsPrice(item: ExtractedQuoteItem, supplierName: string): GuardResult {
  const evidenceText = `${item.description} ${item.rawLine ?? ""} ${item.rawBlock ?? ""}`;
  const tokens = measurementTokens(evidenceText);
  const quantity = itemQuantity(item);

  const unitSuspicious =
    validPositive(item.unitPrice) &&
    (matchesToken(item.unitPrice, tokens) ||
      (item.currency === "CLP" && item.unitPrice < CLP_IMPLAUSIBLE_UNIT_PRICE));
  const totalSuspicious =
    validPositive(item.total) &&
    (matchesToken(item.total, tokens) ||
      (item.currency === "CLP" && item.total < CLP_IMPLAUSIBLE_UNIT_PRICE));

  if (!unitSuspicious && !totalSuspicious) return { item, dropped: false };

  // Evidencia corroborante: unitario y total existen, son consistentes entre
  // si (P.UNIT x CANT = TOTAL) y NO coinciden ambos con medidas.
  const consistentPair =
    validPositive(item.unitPrice) &&
    validPositive(item.total) &&
    Math.abs(item.unitPrice * quantity - item.total) <= priceTolerance(item.total) &&
    !(matchesToken(item.unitPrice, tokens) && matchesToken(item.total, tokens));

  const implausiblyLowClpTotal =
    item.currency === "CLP" && validPositive(item.total) && item.total < CLP_IMPLAUSIBLE_UNIT_PRICE;
  if (consistentPair && !implausiblyLowClpTotal) {
    return {
      item,
      dropped: false,
      warning: `${supplierName}: el precio de "${item.description}" coincide con una medida de la descripcion, pero P.UNIT x CANT = TOTAL lo corrobora; requiere revision manual.`
    };
  }

  // Sin corroboracion: no inventar. Se anulan los valores sospechosos.
  const cleanUnit = unitSuspicious ? null : item.unitPrice;
  const cleanTotal = totalSuspicious ? null : item.total;

  if (!validPositive(cleanUnit) && !validPositive(cleanTotal)) {
    return {
      item: { ...item, unitPrice: null, total: null, valueBasis: "manual_review" },
      dropped: true,
      warning: `${supplierName}: "${item.description}" descartado de la comparacion porque su valor (${
        item.unitPrice ?? item.total
      }) coincide con una medida/dimension de la descripcion y no hay precio justificable; requiere revision manual.`
    };
  }

  const total = validPositive(cleanTotal) ? cleanTotal : (cleanUnit as number) * quantity;
  return {
    item: {
      ...item,
      unitPrice: validPositive(cleanUnit) ? cleanUnit : total / quantity,
      total,
      valueBasis: validPositive(cleanTotal) ? "line_net" : "calculated_from_qty_unit",
      discountApplied: item.discountApplied
    },
    dropped: false,
    warning: `${supplierName}: valor sospechoso anulado en "${item.description}" (coincidia con una medida); se uso ${
      validPositive(cleanTotal) ? "el total neto de linea" : "P.UNIT x CANT"
    } como justificacion; requiere revision manual.`
  };
}

function assignValueBasis(item: ExtractedQuoteItem): ExtractedQuoteItem {
  if (item.valueBasis) {
    return { ...item, netValueUsed: itemNetTotal(item) ?? item.netValueUsed };
  }
  const quantity = itemQuantity(item);

  if (validPositive(item.total) && validPositive(item.unitPrice)) {
    const computed = item.unitPrice * quantity;
    const diff = item.total - computed;
    if (Math.abs(diff) <= priceTolerance(item.total)) {
      return { ...item, valueBasis: "line_net", netValueUsed: item.total };
    }
    if (diff < 0) {
      // Total explicito menor que P.UNIT x CANT: descuento de linea del PDF.
      return {
        ...item,
        valueBasis: "discounted_line",
        netValueUsed: item.total,
        discountApplied: round2(Math.abs(diff)),
        unitPrice: item.total / quantity
      };
    }
    return { ...item, valueBasis: "line_net", netValueUsed: item.total, unitPrice: item.total / quantity };
  }

  if (validPositive(item.total)) {
    return { ...item, valueBasis: "line_net", netValueUsed: item.total };
  }
  if (validPositive(item.unitPrice)) {
    return {
      ...item,
      valueBasis: "calculated_from_qty_unit",
      netValueUsed: item.unitPrice * quantity
    };
  }
  return { ...item, valueBasis: "manual_review" };
}

function extractDiscountLines(items: ExtractedQuoteItem[]) {
  const products: ExtractedQuoteItem[] = [];
  const discounts: Array<{ item: ExtractedQuoteItem; amount: number }> = [];

  for (const item of items) {
    const isDiscount =
      DISCOUNT_LINE_PATTERN.test(item.description) &&
      !/sin descuento/i.test(item.description);
    const amount = itemNetTotal(item);
    if (isDiscount && validPositive(amount)) {
      discounts.push({ item, amount });
    } else {
      products.push(item);
    }
  }

  return { products, discounts };
}

function applyGlobalDiscount(
  items: ExtractedQuoteItem[],
  discount: { amount: number; currency: Currency; description: string },
  supplierName: string,
  warnings: string[]
): { items: ExtractedQuoteItem[]; applied: boolean } {
  const targetItems = items.filter(
    (item) => item.currency === discount.currency && validPositive(itemNetTotal(item))
  );
  const targetSum = targetItems.reduce((sum, item) => sum + (itemNetTotal(item) ?? 0), 0);

  if (targetItems.length === 0 || discount.amount >= targetSum) {
    warnings.push(
      `[RIESGOS] ${supplierName}: descuento "${discount.description}" por ${formatAmount(
        discount.amount,
        discount.currency
      )} detectado pero no se pudo aplicar con seguridad (moneda o monto no calzan con las lineas); requiere revision manual.`
    );
    return { items, applied: false };
  }

  const factor = (targetSum - discount.amount) / targetSum;
  const adjusted = items.map((item) => {
    if (!targetItems.includes(item)) return item;
    const net = itemNetTotal(item) as number;
    const discounted = round2(net * factor);
    const quantity = itemQuantity(item);
    return {
      ...item,
      total: discounted,
      unitPrice: discounted / quantity,
      originalTotal: item.originalTotal ?? net,
      discountApplied: round2((item.discountApplied ?? 0) + (net - discounted)),
      valueBasis: "discounted_line" as ValueBasis,
      netValueUsed: discounted
    };
  });

  warnings.push(
    `[TRAZABILIDAD] ${supplierName}: descuento global "${discount.description}" por ${formatAmount(
      discount.amount,
      discount.currency
    )} aplicado proporcionalmente a ${targetItems.length} linea(s) ${discount.currency} antes de comparar (neto sin IVA).`
  );
  return { items: adjusted, applied: true };
}

function scaleItems(items: ExtractedQuoteItem[], factor: number, basis: ValueBasis) {
  return items.map((item) => {
    const net = itemNetTotal(item);
    if (!validPositive(net)) return item;
    const scaled = round2(net * factor);
    const quantity = itemQuantity(item);
    return {
      ...item,
      originalTotal: item.originalTotal ?? net,
      total: scaled,
      unitPrice: scaled / quantity,
      valueBasis: basis,
      netValueUsed: scaled
    };
  });
}

function itemsSumByCurrency(items: ExtractedQuoteItem[]) {
  const sums = new Map<Currency, number>();
  for (const item of items) {
    const net = itemNetTotal(item);
    if (!validPositive(net)) continue;
    sums.set(item.currency, (sums.get(item.currency) ?? 0) + net);
  }
  return sums;
}

function basisCounts(items: ExtractedQuoteItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const basis = item.valueBasis ?? "inferred";
    counts.set(basis, (counts.get(basis) ?? 0) + 1);
  }
  return [...counts.entries()].map(([basis, count]) => `${count} ${basis}`).join(", ");
}

export function auditQuoteEconomics(quote: ParsedQuote): ParsedQuote {
  const warnings: string[] = [];
  let needsReview = quote.needsReview === true;
  let items = quote.items.map((item) => ({ ...item }));
  let globalDiscountApplied = quote.globalDiscountApplied ?? 0;

  // ── 1. IVA incluido -> normalizar a neto ─────────────────────────────────
  if (quote.pricesIncludeVat) {
    items = scaleItems(items, 1 / (1 + CHILE_VAT_RATE), "inferred");
    warnings.push(
      `[RIESGOS] ${quote.supplierName}: los precios del documento incluian IVA; se normalizaron a neto (÷${(
        1 + CHILE_VAT_RATE
      ).toFixed(2)}) para comparar sin impuesto. Requiere revision manual.`
    );
    needsReview = true;
  }

  // ── 2. Guard de medidas/dimensiones como precio ──────────────────────────
  const guardedItems: ExtractedQuoteItem[] = [];
  for (const item of items) {
    const result = guardMeasurementAsPrice(item, quote.supplierName);
    if (result.warning) {
      warnings.push(`[RIESGOS] ${result.warning}`);
      needsReview = true;
    }
    if (!result.dropped) guardedItems.push(result.item);
  }
  items = guardedItems;

  // ── 3. Lineas de descuento global -> aplicar antes de comparar ───────────
  const { products, discounts } = extractDiscountLines(items);
  items = products;
  for (const discount of discounts) {
    const result = applyGlobalDiscount(
      items,
      {
        amount: discount.amount,
        currency: discount.item.currency,
        description: discount.item.description
      },
      quote.supplierName,
      warnings
    );
    items = result.items;
    if (result.applied) {
      globalDiscountApplied = round2(globalDiscountApplied + discount.amount);
    } else {
      needsReview = true;
    }
  }

  // ── 4. valueBasis + netValueUsed + sourceValueRaw por item ───────────────
  items = items.map((item) => {
    const withBasis = assignValueBasis(item);
    if (withBasis.valueBasis === "discounted_line" && !discounts.length && withBasis.discountApplied) {
      warnings.push(
        `[TRAZABILIDAD] ${quote.supplierName}: "${item.description}" usa el total neto explicito de linea (descuento de linea ${formatAmount(
          withBasis.discountApplied,
          item.currency
        )} respetado del PDF).`
      );
    }
    const rawEvidence = (item.rawLine ?? item.rawBlock ?? "").slice(0, 180);
    return {
      ...withBasis,
      sourceValueRaw: withBasis.sourceValueRaw ?? (rawEvidence.length > 0 ? rawEvidence : undefined)
    };
  });

  // ── 5. Reconciliacion contra subtotal/total explicitos del documento ─────
  const sums = itemsSumByCurrency(items);
  const docCurrency: Currency = quote.currency && quote.currency !== "UNKNOWN" ? quote.currency : "CLP";
  const singleCurrencySum = sums.size === 1 ? [...sums.values()][0] : null;
  const sumCurrency: Currency | null = sums.size === 1 ? [...sums.keys()][0] : null;
  const explicitNet = quote.quoteSubtotal ?? quote.subtotal;
  const explicitGross = quote.quoteTotal ?? quote.total;

  if (singleCurrencySum !== null && sumCurrency === docCurrency) {
    // Lineas extraidas en BRUTO: la suma calza con el total c/IVA y existe un
    // neto explicito distinto -> reescalar al neto documental.
    if (
      validPositive(explicitGross) &&
      validPositive(explicitNet) &&
      explicitNet < explicitGross &&
      Math.abs(singleCurrencySum - explicitGross) <= priceTolerance(explicitGross) &&
      Math.abs(singleCurrencySum - explicitNet) > priceTolerance(explicitNet)
    ) {
      items = scaleItems(items, explicitNet / singleCurrencySum, "subtotal_net");
      warnings.push(
        `[RIESGOS] ${quote.supplierName}: las lineas venian con IVA incluido (sumaban el total bruto ${formatAmount(
          explicitGross,
          docCurrency
        )}); se reescalaron al subtotal neto explicito del documento ${formatAmount(
          explicitNet,
          docCurrency
        )}. Requiere revision manual.`
      );
      needsReview = true;
    } else if (validPositive(explicitNet)) {
      const diff = Math.abs(singleCurrencySum - explicitNet);
      if (diff > Math.max(2, explicitNet * 0.01)) {
        warnings.push(
          `[RIESGOS] ${quote.supplierName}: la suma de lineas netas (${formatAmount(
            singleCurrencySum,
            docCurrency
          )}) difiere del subtotal neto declarado en el documento (${formatAmount(
            explicitNet,
            docCurrency
          )}); se adjudica con la suma de lineas y requiere revision manual.`
        );
        needsReview = true;
      }
    }
  }

  // Cruce defensivo con el auditor LLM (si n8n adjunto uno): solo se compara,
  // nunca se sobreescriben lineas con el valor del auditor.
  if (
    validPositive(quote.auditConfirmedNetSubtotal) &&
    singleCurrencySum !== null &&
    Math.abs(singleCurrencySum - quote.auditConfirmedNetSubtotal) >
      Math.max(2, quote.auditConfirmedNetSubtotal * 0.01)
  ) {
    warnings.push(
      `[RIESGOS] ${quote.supplierName}: el auditor LLM confirmo un subtotal neto de ${formatAmount(
        quote.auditConfirmedNetSubtotal,
        docCurrency
      )} que difiere de la suma de lineas usada (${formatAmount(
        singleCurrencySum,
        docCurrency
      )}); requiere revision manual.`
    );
    needsReview = true;
  }

  if (items.length === 0) {
    warnings.push(
      `[RIESGOS] ${quote.supplierName}: ninguna linea quedo con valor neto justificable tras la auditoria; cotizacion requiere revision manual.`
    );
    needsReview = true;
  }

  // ── 6. Resumen de trazabilidad por cotizacion ────────────────────────────
  const finalSums = itemsSumByCurrency(items);
  const sumText =
    [...finalSums.entries()].map(([currency, sum]) => formatAmount(sum, currency)).join(" + ") ||
    "sin lineas valorizadas";
  warnings.push(
    `[TRAZABILIDAD] ${quote.supplierName} (Cotizacion N° ${quote.quoteNumber ?? "s/n"}): base de adjudicacion = suma de lineas NETAS sin IVA (${sumText}); ${
      items.length
    } linea(s): ${basisCounts(items) || "-"}${
      globalDiscountApplied > 0 ? `; descuento global aplicado ${formatAmount(globalDiscountApplied, sumCurrency ?? docCurrency)}` : ""
    }${validPositive(explicitNet) ? `; subtotal neto documento: ${formatAmount(explicitNet, docCurrency)}` : "; documento sin subtotal neto explicito"}.`
  );

  return {
    ...quote,
    items,
    needsReview,
    globalDiscountApplied: globalDiscountApplied > 0 ? globalDiscountApplied : undefined,
    warnings: [...quote.warnings, ...warnings]
  };
}
