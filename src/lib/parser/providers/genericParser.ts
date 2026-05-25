import { detectCurrency, detectCurrencyForLine } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import { linesOf, normalizeForSearch } from "@/lib/parser/providers/tableParserUtils";
import type { Currency, ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

type ParsedLineResult = {
  item?: ExtractedQuoteItem;
  warnings: string[];
};

type MoneyToken = {
  value: number;
  index: number;
};

const HEADER_PATTERNS = [
  /descripcion.*cant.*(?:unitario|precio|valor).*total/,
  /producto.*cant.*(?:unitario|precio|valor).*total/,
  /detalle.*cant.*(?:unitario|precio|valor).*total/,
  /articulo.*cant.*(?:unitario|precio|valor).*total/,
  /glosa.*cant.*(?:unitario|precio|valor).*total/,
  /codigo.*descripcion.*(?:und|uni|um|u\/m).*cant.*(?:precio|valor)/
];

const HARD_STOP_PATTERNS = [
  /^total\s*(?:neto|general|cotizacion|pagar)?\b/,
  /^sub\s*total\b/,
  /^subtotal\b/,
  /^neto\b/,
  /^iva\b/,
  /^i\.?v\.?a\b/,
  /^ila\b/,
  /^ahorro\b/,
  /^observaciones?\b/,
  /^firma\b/,
  /^pagina\b/,
  /^ejecutivo\b/,
  /^telefono\b/,
  /^fono\b/,
  /^mail\b/,
  /^email\b/,
  /^direccion\b/,
  /^rut\b/,
  /^cliente\b/,
  /^condici[oó]n\b/,
  /^forma de pago\b/,
  /^fecha\b/,
  /^vencimiento\b/,
  /^validez\b/,
  /^banco\b/
];

const LOGISTIC_PATTERNS =
  /\b(cobro log[ií]stico|log[ií]stica|logistico|logistica|logistic|flete|despacho|envio|env[ií]o|transporte|cargo despacho|cargo por despacho|costo despacho|costo de envio|costos de envio|servicio de entrega|delivery|shipping|freight|handling)\b/i;
const MONEY_PATTERN =
  /(?:US\$|USD|CLP|\$)\s*\d[\d.,]*|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d+[.,]\d{2}/gi;
const UNIT_TOKENS = "(?:UND|UNI|UN|U|CU|BOL|CJA|PQT|PACK|PAR|SET|LT|ML|KG|GR|DP|UM|U/M|EA|PCS?|UNIDADES?)";

function extractQuoteNumber(text: string) {
  return text.match(/(?:cotizaci[oó]n|quote|presupuesto|n[°ºo]\.?)[^\d]{0,12}([A-Z0-9-]{4,})/i)?.[1];
}

function extractDate(text: string) {
  const match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return undefined;
  const [, dd, mm, yyyy] = match;
  const fullYear = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${fullYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function extractField(text: string, label: string) {
  const regex = new RegExp(`${label}\\s*:?\\s*([^\\n\\r]+)`, "i");
  return text.match(regex)?.[1]?.trim();
}

function isSummaryOrMetadataLine(line: string) {
  const normalized = normalizeForSearch(line);
  return HARD_STOP_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasTableHeader(line: string) {
  const normalized = normalizeForSearch(line);
  return HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function parseQuantity(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUnit(value?: string) {
  if (!value) return "CU";
  const normalized = value.replace("/", "").toUpperCase().trim();
  if (["UN", "UND", "UNI", "UNIDADES", "UM", "U/M"].includes(normalized)) return "CU";
  return normalized;
}

function cleanDescriptionTokens(value: string) {
  return value
    .replace(/\b(ML|GR|KG|LT|CC)([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
    .replace(/\b(UNI|UND|CU|PQT|BOL|CJA|DP)([A-ZÁÉÍÓÚÑ])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMoneyTokens(line: string, documentCurrency: Currency): MoneyToken[] {
  const matches = [...line.matchAll(MONEY_PATTERN)];
  return matches
    .map((match) => {
      const raw = match[0];
      const value = parseMoney(raw);
      const hasCurrencyMarker = /US\$|USD|CLP|\$/i.test(raw);
      if (value === null || match.index === undefined) return null;
      if (!hasCurrencyMarker && documentCurrency === "UNKNOWN") return null;
      return { value, index: match.index };
    })
    .filter((token): token is MoneyToken => token !== null);
}

function parseQuantityTail(beforeAmounts: string) {
  const unitBeforeQuantity = beforeAmounts.match(
    new RegExp(`^(?<body>.+?)\\s+(?<unit>${UNIT_TOKENS})\\s+(?<qty>\\d+(?:[.,]\\d+)?)\\s*$`, "i")
  );
  if (unitBeforeQuantity?.groups) {
    const quantity = parseQuantity(unitBeforeQuantity.groups.qty);
    if (quantity) {
      return {
        beforeQuantity: unitBeforeQuantity.groups.body.trim(),
        quantity,
        unit: normalizeUnit(unitBeforeQuantity.groups.unit)
      };
    }
  }

  const quantityBeforeUnit = beforeAmounts.match(
    new RegExp(`^(?<body>.+?)\\s+(?<qty>\\d+(?:[.,]\\d+)?)\\s*(?<unit>${UNIT_TOKENS})\\s*$`, "i")
  );
  if (quantityBeforeUnit?.groups) {
    const quantity = parseQuantity(quantityBeforeUnit.groups.qty);
    if (quantity) {
      return {
        beforeQuantity: quantityBeforeUnit.groups.body.trim(),
        quantity,
        unit: normalizeUnit(quantityBeforeUnit.groups.unit)
      };
    }
  }

  const compactUnitQuantity = beforeAmounts.match(
    new RegExp(`^(?<body>.+?)(?<unit>${UNIT_TOKENS})\\s*(?<qty>\\d+(?:[.,]\\d+)?)\\s*$`, "i")
  );
  if (compactUnitQuantity?.groups) {
    const quantity = parseQuantity(compactUnitQuantity.groups.qty);
    if (quantity) {
      return {
        beforeQuantity: compactUnitQuantity.groups.body.trim(),
        quantity,
        unit: normalizeUnit(compactUnitQuantity.groups.unit)
      };
    }
  }

  return null;
}

function splitSourceAndDescription(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const sourceMatch = compact.match(/^([A-Z0-9][A-Z0-9._/-]{2,})\s+(.+)$/i);
  if (!sourceMatch) return { description: compact };

  const candidate = sourceMatch[1];
  const hasCodeEvidence = /\d/.test(candidate) || /[-_/]/.test(candidate);
  if (!hasCodeEvidence) return { description: compact };

  return {
    sourceItem: candidate,
    description: sourceMatch[2].trim()
  };
}

function toleranceFor(currency: Currency, expected: number) {
  if (currency === "CLP") return Math.max(2, expected * 0.002);
  return Math.max(0.05, expected * 0.002);
}

function parseItemLine(line: string, documentCurrency: Currency, inTableRegion: boolean): ParsedLineResult {
  const warnings: string[] = [];
  const normalizedLine = line.replace(/\s+/g, " ").trim();
  if (!normalizedLine || isSummaryOrMetadataLine(normalizedLine)) return { warnings };

  if (LOGISTIC_PATTERNS.test(normalizedLine)) {
    if (extractMoneyTokens(normalizedLine, documentCurrency).length > 0) {
      warnings.push(`Costo asociado detectado y omitido de productos comparables: ${normalizedLine}`);
    }
    return { warnings };
  }

  const moneyTokens = extractMoneyTokens(normalizedLine, documentCurrency);
  if (moneyTokens.length === 0) return { warnings };
  if (moneyTokens.length === 1 && !inTableRegion) return { warnings };

  const unitToken = moneyTokens.length >= 2 ? moneyTokens.at(-2) : moneyTokens.at(-1);
  const totalToken = moneyTokens.length >= 2 ? moneyTokens.at(-1) : undefined;
  if (!unitToken) return { warnings };

  const beforeAmounts = normalizedLine.slice(0, unitToken.index).trim();
  const parsedQuantity = parseQuantityTail(beforeAmounts);
  if (!parsedQuantity) {
    warnings.push(`Linea omitida porque no se pudo detectar cantidad con evidencia: ${normalizedLine}`);
    return { warnings };
  }

  const parsedDescription = splitSourceAndDescription(parsedQuantity.beforeQuantity);
  const description = cleanDescriptionTokens(parsedDescription.description);
  if (description.length < 4 || isSummaryOrMetadataLine(description)) return { warnings };

  const currency = detectCurrencyForLine(normalizedLine, documentCurrency);
  if (currency === "UNKNOWN") {
    warnings.push(`Linea omitida porque no se pudo determinar moneda con seguridad: ${normalizedLine}`);
    return { warnings };
  }

  const unitPrice = unitToken.value;
  const quantity = parsedQuantity.quantity;
  const unit = parsedQuantity.unit;
  let total = totalToken?.value ?? null;
  const expectedTotal = unitPrice * quantity;
  let confidence = totalToken ? 0.78 : 0.62;
  let originalTotal: number | null | undefined;

  if (total === null) {
    total = expectedTotal;
    warnings.push(`Total calculado porque no venia explicito en PDF para producto ${description}.`);
  } else if (Math.abs(total - expectedTotal) > toleranceFor(currency, expectedTotal)) {
    originalTotal = total;
    total = expectedTotal;
    confidence = 0.66;
    warnings.push(`Total corregido por inconsistencia matematica en producto ${description}.`);
  }

  return {
    item: {
      sourceItem: parsedDescription.sourceItem,
      description,
      normalizedProductKey: normalizeProductName(description),
      quantity,
      unit,
      currency,
      unitPrice,
      total,
      rawLine: normalizedLine,
      rawBlock: normalizedLine,
      extractionMethod: "parser generico estructural",
      originalTotal,
      confidence
    },
    warnings
  };
}

function collectCandidateLines(text: string) {
  const lines = linesOf(text);
  const headerIndex = lines.findIndex(hasTableHeader);
  if (headerIndex === -1) {
    return {
      lines,
      hasHeader: false
    };
  }

  const region: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (isSummaryOrMetadataLine(line)) break;
    region.push(line);
  }

  return {
    lines: region.length > 0 ? region : lines,
    hasHeader: true
  };
}

export function parseWithGenericParser(text: string, supplierName: string): ParsedQuote {
  const documentCurrency = detectCurrency(text);
  const warnings: string[] = [];
  const { lines, hasHeader } = collectCandidateLines(text);
  const items: ExtractedQuoteItem[] = [];
  const seenEvidence = new Set<string>();

  for (const line of lines) {
    const parsed = parseItemLine(line, documentCurrency, hasHeader);
    warnings.push(...parsed.warnings);
    if (!parsed.item) continue;
    if (seenEvidence.has(parsed.item.rawLine ?? parsed.item.description)) continue;
    seenEvidence.add(parsed.item.rawLine ?? parsed.item.description);
    items.push(parsed.item);
  }

  if (!hasHeader) {
    warnings.push("No se detecto encabezado de tabla; se aplico lectura estructural conservadora.");
  }

  if (documentCurrency === "UNKNOWN" && items.length === 0) {
    warnings.push(`No se pudo detectar moneda para ${supplierName}.`);
  }

  if (items.length === 0) {
    warnings.push(
      "Cotizacion detectada, pero no se pudo leer la tabla con seguridad: faltan datos verificables de cantidad, precio, total o moneda."
    );
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
