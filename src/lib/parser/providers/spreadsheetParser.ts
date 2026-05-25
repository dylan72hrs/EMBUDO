import path from "node:path";
import { detectCurrency, detectCurrencyForLine } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import type { Currency, ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";
import * as XLSX from "xlsx";

type HeaderMap = {
  description: number;
  quantity: number;
  unitPrice?: number;
  total?: number;
  unit?: number;
  code?: number;
};

const DESCRIPTION_HEADERS = ["descripcion", "producto", "detalle", "articulo", "item", "glosa"];
const QUANTITY_HEADERS = ["cantidad", "cant", "qty", "unidades"];
const UNIT_PRICE_HEADERS = ["precio unit", "precio unitario", "unitario", "p. unit", "valor unitario"];
const TOTAL_HEADERS = ["total", "importe", "valor total", "total linea", "subtotal linea"];
const UNIT_HEADERS = ["unidad", "und", "um", "u/m", "uni"];
const CODE_HEADERS = ["codigo", "cod", "sku", "ref", "item"];

const SUMMARY_LINE = /\b(total neto|subtotal|iva|ila|total general|total pagar|condicion de pago|observacion|nota legal)\b/i;
const LOGISTIC_LINE = /\b(cobro logistico|cobro logístico|flete|despacho|envio|envío|transporte)\b/i;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function isHeaderMatch(value: string, candidates: string[]) {
  const normalized = normalize(value);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function readNumberFromCell(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asText(value);
  if (!text) return null;
  const parsed = parseMoney(text);
  return parsed ?? null;
}

function detectHeader(rows: unknown[][]): { map: HeaderMap; headerRowIndex: number } | undefined {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 35); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const map: Partial<HeaderMap> = {};

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const text = asText(row[columnIndex]);
      if (!text) continue;
      if (map.description === undefined && isHeaderMatch(text, DESCRIPTION_HEADERS)) map.description = columnIndex;
      if (map.quantity === undefined && isHeaderMatch(text, QUANTITY_HEADERS)) map.quantity = columnIndex;
      if (map.unitPrice === undefined && isHeaderMatch(text, UNIT_PRICE_HEADERS)) map.unitPrice = columnIndex;
      if (map.total === undefined && isHeaderMatch(text, TOTAL_HEADERS)) map.total = columnIndex;
      if (map.unit === undefined && isHeaderMatch(text, UNIT_HEADERS)) map.unit = columnIndex;
      if (map.code === undefined && isHeaderMatch(text, CODE_HEADERS)) map.code = columnIndex;
    }

    if (
      map.description !== undefined &&
      map.quantity !== undefined &&
      (map.unitPrice !== undefined || map.total !== undefined)
    ) {
      return {
        map: map as HeaderMap,
        headerRowIndex: rowIndex
      };
    }
  }

  return undefined;
}

function parseLineItem(
  row: unknown[],
  map: HeaderMap,
  documentCurrency: Currency
): { item?: ExtractedQuoteItem; warnings: string[] } {
  const warnings: string[] = [];
  const description = asText(row[map.description]);
  if (!description || description.length < 3 || SUMMARY_LINE.test(description)) return { warnings };
  if (LOGISTIC_LINE.test(description)) {
    warnings.push(`Costo asociado detectado y omitido de productos comparables: ${description}`);
    return { warnings };
  }

  const rowText = row.map(asText).filter(Boolean).join(" ");
  const quantityRaw = readNumberFromCell(row[map.quantity]);
  const unitPriceRaw = map.unitPrice !== undefined ? readNumberFromCell(row[map.unitPrice]) : null;
  const totalRaw = map.total !== undefined ? readNumberFromCell(row[map.total]) : null;
  const currency = detectCurrencyForLine(rowText, documentCurrency);

  let quantity = quantityRaw;
  if ((quantity === null || quantity <= 0) && unitPriceRaw !== null) {
    quantity = 1;
    warnings.push(`Cantidad asumida en 1 por falta de evidencia explicita para producto ${description}.`);
  }

  if (quantity === null || quantity <= 0) {
    warnings.push(`Linea omitida por cantidad invalida: ${description}`);
    return { warnings };
  }

  if (unitPriceRaw === null && totalRaw === null) {
    warnings.push(`Linea omitida por falta de precio unitario y total: ${description}`);
    return { warnings };
  }

  let unitPrice = unitPriceRaw;
  let total = totalRaw;
  let originalTotal: number | null | undefined;

  if (unitPrice === null && total !== null) {
    unitPrice = total / quantity;
    warnings.push(`Precio unitario calculado porque no venia explicito en fuente para producto ${description}.`);
  }

  if (unitPrice !== null && total === null) {
    total = unitPrice * quantity;
    warnings.push(`Total calculado porque no venia explicito en fuente para producto ${description}.`);
  }

  if (unitPrice !== null && total !== null) {
    const expectedTotal = unitPrice * quantity;
    const tolerance = currency === "CLP" ? Math.max(2, expectedTotal * 0.002) : Math.max(0.05, expectedTotal * 0.002);
    if (Math.abs(total - expectedTotal) > tolerance) {
      originalTotal = total;
      total = expectedTotal;
      warnings.push(`Total corregido por inconsistencia matematica en producto ${description}.`);
    }
  }

  const code = map.code !== undefined ? asText(row[map.code]) : undefined;
  const unit = map.unit !== undefined ? asText(row[map.unit]) : "CU";

  return {
    item: {
      sourceItem: code || undefined,
      description,
      normalizedProductKey: normalizeProductName(description),
      quantity,
      unit: unit || "CU",
      currency,
      unitPrice,
      total,
      rawLine: rowText,
      rawBlock: rowText,
      extractionMethod: "parser planilla estructural",
      originalTotal,
      confidence: 0.8
    },
    warnings
  };
}

function buildSheetRows(workbook: XLSX.WorkBook) {
  const rowsBySheet: unknown[][] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    rowsBySheet.push(...rows);
  }
  return rowsBySheet;
}

export function parseSpreadsheetQuote(filePath: string): ParsedQuote {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const rows = buildSheetRows(workbook);
  const fullText = rows.flat().map(asText).filter(Boolean).join(" ");
  const documentCurrency = detectCurrency(fullText);
  const warnings: string[] = [];
  const items: ExtractedQuoteItem[] = [];

  const header = detectHeader(rows);
  if (!header) {
    warnings.push("Cotizacion detectada, pero no se pudo leer la tabla con seguridad.");
    return {
      supplierName: path.basename(filePath, path.extname(filePath)),
      quoteNumber: undefined,
      quoteDate: undefined,
      paymentCondition: undefined,
      deliveryTime: undefined,
      pricesIncludeVat: false,
      items,
      warnings
    };
  }

  let blankStreak = 0;
  for (let rowIndex = header.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const hasValues = row.some((value) => asText(value).length > 0);
    if (!hasValues) {
      blankStreak += 1;
      if (blankStreak >= 4) break;
      continue;
    }
    blankStreak = 0;

    const parsed = parseLineItem(row, header.map, documentCurrency);
    warnings.push(...parsed.warnings);
    if (parsed.item) {
      items.push(parsed.item);
    }
  }

  if (items.length === 0) {
    warnings.push("Cotizacion detectada, pero no se pudo leer la tabla con seguridad.");
  }

  return {
    supplierName: path.basename(filePath, path.extname(filePath)),
    quoteNumber: undefined,
    quoteDate: undefined,
    paymentCondition: undefined,
    deliveryTime: undefined,
    pricesIncludeVat: false,
    items,
    warnings
  };
}
