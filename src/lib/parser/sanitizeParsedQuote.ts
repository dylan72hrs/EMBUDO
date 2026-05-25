import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import { parseMoney } from "@/lib/parser/parseMoney";

type UnsafeItem = {
  sourceItem?: unknown;
  description?: unknown;
  normalizedProductKey?: unknown;
  quantity?: unknown;
  unit?: unknown;
  currency?: unknown;
  unitPrice?: unknown;
  total?: unknown;
  rawLine?: unknown;
  rawBlock?: unknown;
  extractionMethod?: unknown;
  originalTotal?: unknown;
  confidence?: unknown;
};

type UnsafeParsedQuote = {
  supplierName?: unknown;
  quoteNumber?: unknown;
  quoteDate?: unknown;
  paymentCondition?: unknown;
  deliveryTime?: unknown;
  pricesIncludeVat?: unknown;
  items?: unknown;
  warnings?: unknown;
};

const ASSOCIATED_COST_LINE =
  /\b(cobro log[ií]stico|log[ií]stica|logistico|logistica|flete|despacho|env[ií]o|transporte|cargo despacho|cargo por despacho|costo despacho|costo de env[ií]o|costos de env[ií]o|servicio de entrega|delivery|shipping|freight|handling)\b/i;

function warningPrefix(supplierName: string, index: number) {
  return `${supplierName} item ${index + 1}`;
}

function toNullablePrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function toPositiveQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return null;
}

function toConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.4;
  return Math.min(1, Math.max(0, value));
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toCurrency(value: unknown) {
  return value === "USD" || value === "CLP" || value === "UNKNOWN" ? value : "UNKNOWN";
}

function extractAssociatedCostType(description: string) {
  const lower = description.toLowerCase();
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

function formatAmount(value: number, currency: "USD" | "CLP") {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function parseAssociatedAmount(rawLine: string | undefined, total: number | null, unitPrice: number | null) {
  if (typeof total === "number" && Number.isFinite(total) && total > 0) return total;
  if (typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice > 0) return unitPrice;
  if (!rawLine) return null;
  const moneyMatch = rawLine.match(/(?:US\$|USD|CLP|\$)\s*\d[\d.,]*/i);
  if (!moneyMatch) return null;
  return parseMoney(moneyMatch[0]);
}

export function sanitizeParsedQuote(parsed: UnsafeParsedQuote) {
  const supplierName = toOptionalString(parsed.supplierName) ?? "Proveedor no identificado";
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as UnsafeItem[]) : [];
  const items = [];

  for (const [index, rawItem] of rawItems.entries()) {
    const description = toOptionalString(rawItem.description);

    if (!description || description.length < 3) {
      warnings.push(`${warningPrefix(supplierName, index)} descartado: descripción inválida.`);
      continue;
    }

    const originalUnitPrice = rawItem.unitPrice;
    const originalTotal = rawItem.total;
    const unitPrice = toNullablePrice(originalUnitPrice);
    const total = toNullablePrice(originalTotal);
    const quantity = toPositiveQuantity(rawItem.quantity);
    const rawLine = toOptionalString(rawItem.rawLine);
    const rawBlock = toOptionalString(rawItem.rawBlock);
    const currency = toCurrency(rawItem.currency);

    if (ASSOCIATED_COST_LINE.test(description) || ASSOCIATED_COST_LINE.test(rawLine ?? "")) {
      const amount = parseAssociatedAmount(rawLine, total, unitPrice);
      const costType = extractAssociatedCostType(description);
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        const formatCurrency = currency === "USD" ? "USD" : "CLP";
        warnings.push(
          `${supplierName} incluye ${costType} por ${formatAmount(amount, formatCurrency)}; se registra en COSTOS ASOCIADOS y no como producto comparable.`
        );
      } else {
        warnings.push(
          `${supplierName} incluye ${costType}; se registra en COSTOS ASOCIADOS y no como producto comparable.`
        );
      }
      continue;
    }

    if (unitPrice === null && typeof originalUnitPrice === "number") {
      warnings.push(`${warningPrefix(supplierName, index)}: precio unitario inválido corregido a vacío.`);
    }

    if (total === null && typeof originalTotal === "number") {
      warnings.push(`${warningPrefix(supplierName, index)}: total inválido corregido a vacío.`);
    }

    if (unitPrice === null && total === null) {
      warnings.push(`${warningPrefix(supplierName, index)} descartado: no tiene precio unitario ni total válido.`);
      continue;
    }

    if (quantity === null) {
      warnings.push(`${warningPrefix(supplierName, index)} descartado: no tiene cantidad válida con evidencia.`);
      continue;
    }

    if (!rawLine && !rawBlock) {
      warnings.push(`${warningPrefix(supplierName, index)} descartado: sin evidencia de línea origen.`);
      continue;
    }

    items.push({
      sourceItem:
        typeof rawItem.sourceItem === "string" || typeof rawItem.sourceItem === "number"
          ? rawItem.sourceItem
          : undefined,
      description,
      normalizedProductKey:
        toOptionalString(rawItem.normalizedProductKey) ?? normalizeProductName(description),
      quantity,
      unit: toOptionalString(rawItem.unit) ?? "CU",
      currency,
      unitPrice,
      total,
      rawLine,
      rawBlock,
      extractionMethod: toOptionalString(rawItem.extractionMethod),
      originalTotal: toNullablePrice(rawItem.originalTotal),
      confidence: toConfidence(rawItem.confidence)
    });
  }

  if (rawItems.length > 0 && items.length === 0) {
    warnings.push(`${supplierName}: no quedaron productos válidos después del saneamiento.`);
  }

  return {
    supplierName,
    quoteNumber: toOptionalString(parsed.quoteNumber),
    quoteDate: toOptionalString(parsed.quoteDate),
    paymentCondition: toOptionalString(parsed.paymentCondition),
    deliveryTime: toOptionalString(parsed.deliveryTime),
    pricesIncludeVat: typeof parsed.pricesIncludeVat === "boolean" ? parsed.pricesIncludeVat : false,
    items,
    warnings
  };
}
