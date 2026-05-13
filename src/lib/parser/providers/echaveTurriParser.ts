import {
  buildItem,
  findRegion,
  linesOf,
  parsePriceSuffix
} from "@/lib/parser/providers/tableParserUtils";
import type { ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

function parseEchaveDate(text: string) {
  const match = text.match(/miércoles,\s*(\d{1,2})\s+de\s+mayo\s+de\s+(\d{4})/i);
  if (!match) return undefined;
  return `${match[2]}-05-${match[1].padStart(2, "0")}`;
}

export function parseEchaveTurriQuote(text: string): ParsedQuote {
  const region = findRegion(
    linesOf(text),
    [/descripcion de producto/],
    [/^total cotizacion/, /^condiciones comerciales/, /^los leones/, /^telefono/, /^firma/, /^pagina/]
  );
  const warnings: string[] = [];
  const items: ExtractedQuoteItem[] = [];

  if (region.length === 0) {
    warnings.push("Echave Turri: No se detectó una tabla de productos válida.");
  }

  let current: string[] = [];
  let sourceItem: string | undefined;

  const flush = () => {
    if (!sourceItem || current.length === 0) return;
    const segment = current.join(" ").replace(/\s+/g, " ");
    const parsed = parsePriceSuffix(segment, "UNKNOWN");
    if (!parsed) return;

    let description = parsed.before.replace(/^ITEM\s*/i, "").trim();
    if (/al d[ií]a de hoy|unidades disponibles/i.test(description)) {
      warnings.push("Echave Turri: línea de disponibilidad detectada y omitida.");
      return;
    }

    const item = buildItem(
      "Echave Turri",
      sourceItem,
      description,
      parsed.quantity,
      parsed.unitPrice,
      parsed.total,
      parsed.currency,
      0.9
    );
    if (item) items.push(item);
  };

  for (let index = 0; index < region.length; index += 1) {
    const line = region[index];
    const next = region[index + 1];

    if (/^\d{1,2}$/.test(line) && /^ITEM$/i.test(next ?? "")) {
      flush();
      sourceItem = line;
      current = [];
      index += 1;
      continue;
    }

    if (sourceItem) {
      current.push(line);
      if (parsePriceSuffix(current.join(" "), "UNKNOWN")) {
        flush();
        current = [];
        sourceItem = undefined;
      }
    }
  }
  flush();

  return {
    supplierName: "Echave Turri",
    quoteNumber: text.match(/N°\s*(\d+)/i)?.[1] ?? text.match(/\b(137039)\b/)?.[1],
    quoteDate: parseEchaveDate(text),
    paymentCondition: "Orden de Compra a 30 días",
    deliveryTime: "2 días hábiles",
    pricesIncludeVat: false,
    items,
    warnings
  };
}
