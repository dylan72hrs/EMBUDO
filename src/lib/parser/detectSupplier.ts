function normalize(input: string) {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function domainNameFromEmail(text: string) {
  const emailDomain = text.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  if (!emailDomain || /masterdrilling|gmail|hotmail|outlook/i.test(emailDomain)) return undefined;
  return emailDomain.replace(/^www\./i, "").split(".")[0].trim().slice(0, 80);
}

export function detectSupplier(text: string, fallbackFilename?: string) {
  const haystack = normalize(`${text}\n${fallbackFilename ?? ""}`);

  if (haystack.includes("tecnomercado") || haystack.includes("tecno mercado")) {
    return "Tecno Mercado";
  }

  if (haystack.includes("echave") || haystack.includes("turri")) {
    return "Echave Turri";
  }

  if (/\badis\b/.test(haystack)) {
    return "ADIS";
  }

  if (haystack.includes("prisa.cl") || /\bprisa\b/.test(haystack) || haystack.includes("proveedores integrales prisa")) {
    return "PRISA";
  }

  if (haystack.includes("dimerc.cl") || /\bdimerc\b/.test(haystack)) {
    return "Dimerc";
  }

  const quoteHeader = text.match(/(?:proveedor|raz[oó]n social|empresa)\s*:?\s*([^\n\r]+)/i);
  if (quoteHeader?.[1] && !/master drilling/i.test(quoteHeader[1])) {
    return quoteHeader[1].trim().slice(0, 80);
  }

  return domainNameFromEmail(text) ?? "Proveedor no identificado";
}
