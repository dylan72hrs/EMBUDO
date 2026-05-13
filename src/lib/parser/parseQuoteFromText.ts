import { detectSupplier } from "@/lib/parser/detectSupplier";
import { parseAdisQuote } from "@/lib/parser/providers/adisParser";
import { parseEchaveTurriQuote } from "@/lib/parser/providers/echaveTurriParser";
import { parseWithGenericParser } from "@/lib/parser/providers/genericParser";
import { parseTecnoMercadoQuote } from "@/lib/parser/providers/tecnoMercadoParser";
import { sanitizeParsedQuote } from "@/lib/parser/sanitizeParsedQuote";
import { ParsedQuoteSchema } from "@/lib/validations/quoteSchemas";

export function parseQuoteFromText(text: string, filename?: string) {
  const supplier = detectSupplier(text, filename);
  const normalized = supplier.toLowerCase();

  const parsed = normalized.includes("adis")
    ? parseAdisQuote(text)
    : normalized.includes("tecno")
      ? parseTecnoMercadoQuote(text)
      : normalized.includes("echave") || normalized.includes("turri")
        ? parseEchaveTurriQuote(text)
        : parseWithGenericParser(text, supplier);

  return ParsedQuoteSchema.parse(sanitizeParsedQuote(parsed));
}
