import { normalizeProductName } from "@/lib/normalize/normalizeProductName";

type UnsafeItem = {
  sourceItem?: unknown;
  description?: unknown;
  normalizedProductKey?: unknown;
  quantity?: unknown;
  unit?: unknown;
  currency?: unknown;
  unitPrice?: unknown;
  total?: unknown;
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

  return 1;
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

    items.push({
      sourceItem:
        typeof rawItem.sourceItem === "string" || typeof rawItem.sourceItem === "number"
          ? rawItem.sourceItem
          : undefined,
      description,
      normalizedProductKey:
        toOptionalString(rawItem.normalizedProductKey) ?? normalizeProductName(description),
      quantity: toPositiveQuantity(rawItem.quantity),
      unit: toOptionalString(rawItem.unit) ?? "CU",
      currency: toCurrency(rawItem.currency),
      unitPrice,
      total,
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
