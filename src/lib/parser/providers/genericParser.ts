import { detectCurrency, detectCurrencyForLine } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import { findRegion, linesOf } from "@/lib/parser/providers/tableParserUtils";
import type { ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

function extractQuoteNumber(text: string) {
  return text.match(/(?:cotizaci[oó]n|quote|presupuesto|n[°o]\.?)[^\d]{0,12}([A-Z0-9-]{4,})/i)?.[1];
}

function extractDate(text: string) {
  const match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  const fullYear = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${fullYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function extractField(text: string, label: string) {
  const regex = new RegExp(`${label}\\s*:?\\s*([^\n\r]+)`, "i");
  return text.match(regex)?.[1]?.trim();
}

function parseItemLine(
  line: string,
  documentCurrency: ReturnType<typeof detectCurrency>
): ExtractedQuoteItem | null {
  const moneyMatches = [...line.matchAll(/(?:US\$|USD|CLP|\$)?\s*\d[\d.,]*(?:\s*(?:USD|CLP))?/gi)];
  if (moneyMatches.length < 2) return null;

  const unitPriceText = moneyMatches[moneyMatches.length - 2]?.[0] ?? "";
  const totalText = moneyMatches[moneyMatches.length - 1]?.[0] ?? "";
  const unitPrice = parseMoney(unitPriceText);
  const total = parseMoney(totalText);
  if (unitPrice === null && total === null) return null;

  const beforeAmounts = line.slice(0, moneyMatches[moneyMatches.length - 2].index).trim();
  const sourceMatch = beforeAmounts.match(/^\s*(\d+)[.)-]?\s+/);
  const sourceItem = sourceMatch?.[1];
  const withoutSource = sourceMatch ? beforeAmounts.slice(sourceMatch[0].length).trim() : beforeAmounts;
  const qtyMatch = withoutSource.match(/\s(\d+(?:[.,]\d+)?)\s*(?:CU|UN|UND|UNID|EA|PCS?)?\s*$/i);
  const quantity = qtyMatch ? Number(qtyMatch[1].replace(",", ".")) : 1;
  const description = (qtyMatch ? withoutSource.slice(0, qtyMatch.index).trim() : withoutSource).replace(/\s{2,}/g, " ");

  if (description.length < 4) return null;

  return {
    sourceItem,
    description,
    normalizedProductKey: normalizeProductName(description),
    quantity,
    unit: "CU",
    currency: detectCurrencyForLine(line, documentCurrency),
    unitPrice,
    total,
    confidence: 0.45
  };
}

export function parseWithGenericParser(text: string, supplierName: string): ParsedQuote {
  const documentCurrency = detectCurrency(text);
  const warnings: string[] = [];
  const region = findRegion(
    linesOf(text),
    [
      /item.*descripcion.*cantidad.*precio.*total/,
      /item.*producto.*cantidad.*precio.*total/,
      /descripcion.*cantidad.*unitario.*total/
    ],
    [
      /^total neto/,
      /^iva\b/,
      /^total$/,
      /^total pagar/,
      /^condiciones comerciales/,
      /^observaciones/,
      /^fono/,
      /^email/,
      /^www\./,
      /^banco/,
      /^rut/
    ]
  );

  if (region.length === 0) {
    warnings.push("No se detectó una tabla de productos válida.");
  }

  const items = region
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseItemLine(line, documentCurrency))
    .filter((item): item is ExtractedQuoteItem => item !== null);

  if (documentCurrency === "UNKNOWN") {
    warnings.push(`No se pudo detectar moneda para ${supplierName}.`);
  }

  if (items.length === 0) {
    warnings.push(`No se detectaron líneas de productos para ${supplierName}; revisar parser.`);
  }

  return {
    supplierName,
    quoteNumber: extractQuoteNumber(text),
    quoteDate: extractDate(text),
    paymentCondition: extractField(text, "condici[oó]n de pago|forma de pago"),
    deliveryTime: extractField(text, "plazo de entrega|entrega"),
    pricesIncludeVat: /iva\s+incluido|incluye\s+iva/i.test(text),
    items,
    warnings
  };
}
