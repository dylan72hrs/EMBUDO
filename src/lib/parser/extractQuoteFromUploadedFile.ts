import path from "node:path";
import { extractTextFromPdf } from "@/lib/pdf/extractTextFromPdf";
import { detectSupplier } from "@/lib/parser/detectSupplier";
import { parseQuoteFromText } from "@/lib/parser/parseQuoteFromText";
import { parseSpreadsheetQuote } from "@/lib/parser/providers/spreadsheetParser";
import type { ParsedQuote } from "@/lib/validations/quoteSchemas";

type SupportedQuoteFileKind = "pdf" | "xlsx" | "xls" | "docx" | "unknown";

export type UploadedQuoteExtraction = {
  parsed: ParsedQuote;
  rawText: string;
  warnings: string[];
  kind: SupportedQuoteFileKind;
  lookedScanned: boolean;
  quoteLike: boolean;
};

function extensionOf(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function detectSupportedQuoteFileKind(filename: string, mimeType?: string): SupportedQuoteFileKind {
  const extension = extensionOf(filename);
  const normalizedMime = (mimeType ?? "").toLowerCase();

  if (extension === ".pdf" || normalizedMime === "application/pdf") return "pdf";
  if (extension === ".xlsx") return "xlsx";
  if (extension === ".xls") return "xls";
  if (extension === ".docx") return "docx";
  return "unknown";
}

function likelyQuote(text: string) {
  return /(cotizacion|cotizaci[oó]n|quote|presupuesto)/i.test(text);
}

function hasSufficientExtractedText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.length >= 16;
}

async function extractTextFromDocx(filePath: string) {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    const warnings = result.messages.map((message) => message.message);
    return { text: result.value.trim(), warnings, available: true };
  } catch {
    return {
      text: "",
      warnings: [
        "Soporte DOCX no disponible en este entorno. Instale dependencia compatible para habilitar lectura de Word."
      ],
      available: false
    };
  }
}

async function tryOptionalOcrFallback(_filePath: string) {
  return {
    text: "",
    warnings: [
      "OCR fallback pendiente en este entorno. Para PDFs escaneados, suba PDF con texto seleccionable o una cotizacion en Excel."
    ]
  };
}

function parseSpreadsheet(filePath: string, originalFilename: string): ParsedQuote {
  const parsed = parseSpreadsheetQuote(filePath);
  const supplier = detectSupplier(parsed.items.map((item) => item.rawLine ?? item.description).join("\n"), originalFilename);
  return {
    ...parsed,
    supplierName: supplier
  };
}

export async function extractQuoteFromUploadedFile(
  filePath: string,
  originalFilename: string,
  mimeType?: string
): Promise<UploadedQuoteExtraction> {
  const kind = detectSupportedQuoteFileKind(originalFilename, mimeType);
  const warnings: string[] = [];

  if (kind === "xlsx" || kind === "xls") {
    const parsed = parseSpreadsheet(filePath, originalFilename);
    warnings.push("Archivo Excel detectado. Se usara como fuente de cotizacion.");
    return {
      parsed: { ...parsed, warnings: [...parsed.warnings, ...warnings] },
      rawText: parsed.items.map((item) => item.rawLine ?? item.description).join("\n"),
      warnings,
      kind,
      lookedScanned: false,
      quoteLike: true
    };
  }

  if (kind === "docx") {
    const docxText = await extractTextFromDocx(filePath);
    warnings.push(...docxText.warnings);
    if (!docxText.available || !docxText.text) {
      return {
        parsed: {
          supplierName: "Proveedor no identificado",
          items: [],
          pricesIncludeVat: false,
          warnings
        },
        rawText: docxText.text,
        warnings,
        kind,
        lookedScanned: false,
        quoteLike: false
      };
    }

    const parsed = parseQuoteFromText(docxText.text, originalFilename);
    return {
      parsed: { ...parsed, warnings: [...parsed.warnings, ...warnings] },
      rawText: docxText.text,
      warnings,
      kind,
      lookedScanned: false,
      quoteLike: likelyQuote(docxText.text)
    };
  }

  const pdfText = await extractTextFromPdf(filePath);
  let rawText = pdfText;
  let lookedScanned = false;
  let quoteLike = likelyQuote(rawText);

  if (!hasSufficientExtractedText(rawText)) {
    lookedScanned = true;
    const ocr = await tryOptionalOcrFallback(filePath);
    rawText = ocr.text.trim() || rawText;
    warnings.push(...ocr.warnings);
    quoteLike = quoteLike || likelyQuote(rawText);
  }

  const parsed = parseQuoteFromText(rawText, originalFilename);
  return {
    parsed: { ...parsed, warnings: [...parsed.warnings, ...warnings] },
    rawText,
    warnings,
    kind,
    lookedScanned,
    quoteLike
  };
}
