import type { Currency } from "@/lib/validations/quoteSchemas";

export function detectCurrency(text: string): Currency {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized.includes("us$") || /\b(usd|dolar|dolares)\b/.test(normalized)) {
    return "USD";
  }

  if (normalized.trim() === "$" || /\b(clp|pesos? chilenos?|peso chileno)\b/.test(normalized)) {
    return "CLP";
  }

  if (/\$\s*\d{1,3}(?:\.\d{3})+(?:\D|$)/.test(text)) {
    return "CLP";
  }

  return "UNKNOWN";
}

export function detectCurrencyForLine(line: string, documentCurrency: Currency): Currency {
  const lineCurrency = detectCurrency(line);
  if (lineCurrency !== "UNKNOWN") return lineCurrency;
  return documentCurrency;
}
