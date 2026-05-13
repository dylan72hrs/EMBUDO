import { detectCurrency } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import {
  buildItem,
  findRegion,
  linesOf,
  normalizeForSearch
} from "@/lib/parser/providers/tableParserUtils";
import type { Currency, ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

const DESCRIPTION_STARTERS = [
  "dell",
  "logitech",
  "kensington",
  "razer",
  "jabra",
  "jbl",
  "samsung",
  "aoc",
  "xtech",
  "hp",
  "lenovo",
  "asus",
  "acer",
  "notebook",
  "monitor",
  "mouse",
  "teclado",
  "audifono",
  "audifonos",
  "cargador",
  "bateria",
  "adaptador",
  "docking",
  "soporte"
];

function extractQuoteNumber(text: string) {
  return text.match(/N[°º]\s*([A-Z0-9-]+)/i)?.[1];
}

function extractDate(text: string) {
  const match = text.match(/Fecha Cotización\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!match) return undefined;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function extractField(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*([^\\n\\r]+)`, "i"))?.[1]?.trim();
}

function bestEmbeddedPriceStart(rawUnit: string, rawTotal: string) {
  if (rawUnit.includes(".")) return { offset: 0, unit: rawUnit };

  const total = parseMoney(rawTotal);
  const [digits, decimals] = rawUnit.split(",");
  if (!total || !digits || !decimals) return { offset: 0, unit: rawUnit };
  if (digits.length <= 3 && !digits.startsWith("0")) return { offset: 0, unit: rawUnit };

  for (let offset = 1; offset < digits.length; offset += 1) {
    const suffix = digits.slice(offset);
    if (suffix.length > 1 && suffix.startsWith("0")) continue;
    const candidate = `${suffix},${decimals}`;
    const value = parseMoney(candidate);
    if (value && value <= total && Math.abs(total / value - Math.round(total / value)) < 0.001) {
      return { offset, unit: candidate };
    }
  }

  return { offset: 0, unit: rawUnit };
}

function pricePairMatches(tableText: string) {
  return [
    ...tableText.matchAll(
      /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g
    )
  ]
    .filter((match) => match.index !== undefined)
    .map((match) => {
      const corrected = bestEmbeddedPriceStart(match[1], match[2]);
      return {
        index: (match.index ?? 0) + corrected.offset,
        end: (match.index ?? 0) + match[0].length,
        unitPriceText: corrected.unit,
        totalText: match[2]
      };
    });
}

function findDescriptionStart(rest: string) {
  const normalizedRest = normalizeForSearch(rest);
  const positions = DESCRIPTION_STARTERS.map((starter) => normalizedRest.indexOf(starter))
    .filter((position) => position > 0)
    .sort((a, b) => a - b);

  return positions[0] ?? -1;
}

function splitCodeAndDescription(rest: string) {
  const start = findDescriptionStart(rest);
  if (start > 0) {
    return {
      code: rest
        .slice(0, start)
        .replace(/\bU\d+\b$/i, "")
        .replace(/\s+/g, "")
        .replace(/U\d+$/i, "")
        .trim(),
      description: rest.slice(start).trim()
    };
  }

  const fallback = rest.match(/^([A-Z0-9][A-Z0-9_\-/]{2,})\s+(.+)$/i);
  if (!fallback) return null;
  return {
    code: fallback[1].trim(),
    description: fallback[2].trim()
  };
}

function parseRowBody(
  rowBody: string,
  unitPrice: number | null,
  total: number | null
) {
  const compact = rowBody.replace(/\s+/g, " ").trim();
  const leadingDigits = compact.match(/^(\d{1,4})/)?.[1];
  if (!leadingDigits) return null;

  const candidates = [...Array(leadingDigits.length)].map((_, index) => {
    const quantityText = leadingDigits.slice(0, index + 1);
    return {
      quantity: Number(quantityText),
      rest: compact.slice(quantityText.length).trim()
    };
  });

  candidates.sort((a, b) => {
    const aMatchesTotal =
      unitPrice !== null && total !== null && Math.abs(unitPrice * a.quantity - total) < 0.01;
    const bMatchesTotal =
      unitPrice !== null && total !== null && Math.abs(unitPrice * b.quantity - total) < 0.01;

    if (aMatchesTotal !== bMatchesTotal) return aMatchesTotal ? -1 : 1;
    return a.quantity - b.quantity;
  });

  for (const candidate of candidates) {
    const parsed = splitCodeAndDescription(candidate.rest);
    if (!parsed?.description) continue;

    return {
      quantity: candidate.quantity > 0 ? candidate.quantity : 1,
      code: parsed.code,
      description: parsed.description
    };
  }

  return null;
}

function parseAdisTable(region: string[], currency: Currency) {
  const tableText = region.join(" ").replace(/\s+/g, " ").trim();
  const matches = pricePairMatches(tableText);
  const items: ExtractedQuoteItem[] = [];
  const warnings: string[] = [];
  let cursor = 0;

  for (const [index, match] of matches.entries()) {
    const matchIndex = match.index;
    const rowBody = tableText.slice(cursor, matchIndex);
    const unitPrice = parseMoney(match.unitPriceText);
    const total = parseMoney(match.totalText);
    const parsedRow = parseRowBody(rowBody, unitPrice, total);

    if (!parsedRow) {
      warnings.push(`ADIS: no se pudo interpretar una fila de producto cerca de "${rowBody.slice(0, 80)}".`);
      cursor = match.end;
      continue;
    }

    const item = buildItem(
      "ADIS",
      parsedRow.code || index + 1,
      parsedRow.description,
      parsedRow.quantity,
      unitPrice,
      total,
      currency,
      0.88
    );
    if (item) items.push(item);
    cursor = match.end;
  }

  return { items, warnings };
}

export function parseAdisQuote(text: string): ParsedQuote {
  const region = findRegion(
    linesOf(text),
    [/cantidad.*codigo.*descripcion.*precio.*total/],
    [/^observaciones/, /^total \(?dolar\)?/, /^total neto/, /^i\.?v\.?a/, /^total pagar/, /^[a-j]\)/]
  );
  const warnings: string[] = [];
  const documentCurrency = detectCurrency(text);

  if (region.length === 0) {
    warnings.push("ADIS: No se detectó una tabla de productos válida.");
  }

  const parsedTable = parseAdisTable(region, documentCurrency === "UNKNOWN" ? "USD" : documentCurrency);
  warnings.push(...parsedTable.warnings);

  return {
    supplierName: "ADIS",
    quoteNumber: extractQuoteNumber(text),
    quoteDate: extractDate(text),
    paymentCondition: extractField(text, "Término comercial") ?? "OC 30 DIAS",
    deliveryTime: extractField(text, "Modo envio") ?? "Terrestre",
    pricesIncludeVat: false,
    items: parsedTable.items,
    warnings
  };
}
