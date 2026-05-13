import { detectCurrencyForLine } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import type { Currency, ExtractedQuoteItem } from "@/lib/validations/quoteSchemas";

export function linesOf(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeForSearch(input: string) {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function findRegion(lines: string[], starts: RegExp[], stops: RegExp[]) {
  const startIndex = lines.findIndex((line) => starts.some((pattern) => pattern.test(normalizeForSearch(line))));
  if (startIndex === -1) return [];

  const region: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    const normalized = normalizeForSearch(line);
    if (stops.some((pattern) => pattern.test(normalized))) break;
    region.push(line);
  }

  return region;
}

export function buildItem(
  supplierName: string,
  sourceItem: string | number | undefined,
  description: string,
  quantity: number,
  unitPrice: number | null,
  total: number | null,
  currency: Currency,
  confidence: number
): ExtractedQuoteItem | null {
  const cleanDescription = description.replace(/\s+/g, " ").trim();
  if (!cleanDescription || (unitPrice === null && total === null)) return null;

  return {
    sourceItem,
    description: cleanDescription,
    normalizedProductKey: normalizeProductName(cleanDescription),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unit: "CU",
    currency,
    unitPrice,
    total,
    confidence
  };
}

export function parsePriceSuffix(segment: string, fallbackCurrency: Currency) {
  const currencyMatch = [...segment.matchAll(/US\$|USD|CLP|\$/gi)].at(-1);
  if (!currencyMatch || currencyMatch.index === undefined) return null;

  const currencyToken = currencyMatch[0];
  const beforeCurrency = segment.slice(0, currencyMatch.index);
  const afterCurrency = segment.slice(currencyMatch.index + currencyToken.length).trim();
  const quantityMatch = beforeCurrency.match(/(\d+)$/);
  if (!quantityMatch || quantityMatch.index === undefined) return null;

  const quantityDigits = quantityMatch[1];
  const priceMatch = afterCurrency.match(/([\d,]+\.\d{2})\s*([\d,]+\.\d{2})$/);
  if (!priceMatch) return null;

  const unitPrice = parseMoney(priceMatch[1]);
  const total = parseMoney(priceMatch[2]);
  const parsedQuantity = Number(quantityDigits);
  const quantity =
    unitPrice && total && parsedQuantity > 0 && Math.abs(unitPrice * parsedQuantity - total) < 0.01
      ? parsedQuantity
      : Number(quantityDigits.at(-1) ?? 1);
  const consumedDigits = String(quantity);
  const before = `${beforeCurrency.slice(0, quantityMatch.index)}${quantityDigits.slice(
    0,
    Math.max(0, quantityDigits.length - consumedDigits.length)
  )}`.trim();
  const currency = detectCurrencyForLine(currencyToken, fallbackCurrency);

  return {
    before,
    quantity,
    unitPrice,
    total,
    currency
  };
}
