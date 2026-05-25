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

  const specificParsed = normalized.includes("adis")
    ? parseAdisQuote(text)
    : normalized.includes("tecno")
      ? parseTecnoMercadoQuote(text)
      : normalized.includes("echave") || normalized.includes("turri")
        ? parseEchaveTurriQuote(text)
        : undefined;

  const parsed =
    specificParsed && specificParsed.items.length > 0
      ? specificParsed
      : (() => {
          const genericParsed = parseWithGenericParser(text, supplier);
          if (specificParsed && genericParsed.items.length > 0) {
            return {
              ...genericParsed,
              supplierName: specificParsed.supplierName,
              quoteNumber: specificParsed.quoteNumber ?? genericParsed.quoteNumber,
              quoteDate: specificParsed.quoteDate ?? genericParsed.quoteDate,
              paymentCondition: specificParsed.paymentCondition ?? genericParsed.paymentCondition,
              deliveryTime: specificParsed.deliveryTime ?? genericParsed.deliveryTime,
              warnings: [
                ...specificParsed.warnings,
                `Se uso parser generico estructural como respaldo para ${specificParsed.supplierName}.`,
                ...genericParsed.warnings
              ]
            };
          }
          return genericParsed;
        })();

  return ParsedQuoteSchema.parse(sanitizeParsedQuote(parsed));
}
