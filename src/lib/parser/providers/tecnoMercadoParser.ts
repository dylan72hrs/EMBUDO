import { parseMoney } from "@/lib/parser/parseMoney";
import {
  buildItem,
  findRegion,
  linesOf
} from "@/lib/parser/providers/tableParserUtils";
import type { ParsedQuote } from "@/lib/validations/quoteSchemas";

function extractQuoteNumber(text: string) {
  return text.match(/N[º°]\s*de\s*Cotizaci[oó]n:\s*([A-Z0-9-]+)/i)?.[1];
}

function parseTecnoSegment(segment: string) {
  const priceMatches = [...segment.matchAll(/\$\s*([\d.]+)/g)];
  const unitPriceMatch = priceMatches.at(-2);
  const totalMatch = priceMatches.at(-1);
  if (!unitPriceMatch || !totalMatch || unitPriceMatch.index === undefined) return null;

  const unitPrice = parseMoney(unitPriceMatch[1]);
  const total = parseMoney(totalMatch[1]);
  const beforePrices = segment.slice(0, unitPriceMatch.index).trim();
  const quantityMatch = beforePrices.match(/(\d+)$/);
  if (!quantityMatch || quantityMatch.index === undefined) return null;

  const quantityDigits = quantityMatch[1];
  const quantity = Number(quantityDigits.at(-1) ?? "1");
  const before = `${beforePrices.slice(0, quantityMatch.index)}${quantityDigits.slice(0, -1)}`.trim();
  const itemMatch = before.match(/^(\d{1,2})\s*(.+)$/);
  if (!itemMatch) return null;

  return {
    sourceItem: itemMatch[1],
    description: itemMatch[2],
    quantity,
    unitPrice,
    total
  };
}

export function parseTecnoMercadoQuote(text: string): ParsedQuote {
  const region = findRegion(
    linesOf(text),
    [/item.*descripcion.*cantidad/, /precio unit/, /totales/],
    [/^total neto/, /^iva\b/, /^total$/, /^condiciones comerciales/, /^esperando que/, /^francisco/, /^fono/, /^email/]
  );
  const warnings: string[] = [];
  const items = [];

  if (region.length === 0) {
    warnings.push("Tecno Mercado: No se detectó una tabla de productos válida.");
  }

  const segments: string[] = [];
  let current: string[] = [];

  for (const line of region) {
    if (/^\d{1,2}$/.test(line) || /^\d{1,2}[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(line)) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) segments.push(current.join(" "));

  for (const segment of segments) {
    const parsed = parseTecnoSegment(segment.replace(/\s+/g, " "));
    if (!parsed) continue;

    if (/^env[ií]o$/i.test(parsed.description.trim())) {
      warnings.push("Tecno Mercado: Envío detectado y omitido de productos.");
      continue;
    }

    const item = buildItem(
      "Tecno Mercado",
      parsed.sourceItem,
      parsed.description,
      parsed.quantity,
      parsed.unitPrice,
      parsed.total,
      "CLP",
      0.9
    );
    if (item) items.push(item);
  }

  return {
    supplierName: "Tecno Mercado",
    quoteNumber: extractQuoteNumber(text),
    paymentCondition: text.match(/Forma de Pago:\s*([^\n\r]+)/i)?.[1]?.trim(),
    deliveryTime: text.match(/Plazo de Entrega:\s*([^\n\r]+)/i)?.[1]?.trim(),
    pricesIncludeVat: false,
    items,
    warnings
  };
}
