export function detectSupplier(text: string, fallbackFilename?: string) {
  const haystack = `${text}\n${fallbackFilename ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (haystack.includes("tecnomercado") || haystack.includes("tecno mercado")) {
    return "Tecno Mercado";
  }

  if (haystack.includes("echave") || haystack.includes("turri")) {
    return "Echave Turri";
  }

  if (/\badis\b/.test(haystack)) {
    return "ADIS";
  }

  const quoteHeader = text.match(/(?:proveedor|raz[oó]n social|empresa)\s*:?\s*([^\n\r]+)/i);
  if (quoteHeader?.[1]) return quoteHeader[1].trim().slice(0, 80);

  return "Proveedor no identificado";
}
