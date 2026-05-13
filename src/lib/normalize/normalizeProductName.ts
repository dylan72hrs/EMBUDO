const IMPORTANT_CODES = [
  "g91j0",
  "k75404ww",
  "k75404",
  "m170",
  "k120",
  "h390",
  "blackshark v2 x",
  "evolve2 50",
  "tune 110"
];

const STOPWORDS = new Set([
  "de",
  "del",
  "para",
  "con",
  "sin",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "por",
  "en",
  "usb",
  "wireless",
  "inalambrico",
  "negro",
  "gris",
  "espanol",
  "notebook"
]);

export function normalizeText(input: string) {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeProductName(description: string) {
  const normalized = normalizeText(description);

  if (normalized.includes("dell") && normalized.includes("g91j0")) {
    return "bateria-dell-g91j0";
  }

  if (
    normalized.includes("dell") &&
    (normalized.includes("la65nm190") || normalized.includes("65w"))
  ) {
    return "cargador-dell-65w";
  }

  if (
    normalized.includes("adaptador") &&
    normalized.includes("usb") &&
    normalized.includes("hdmi")
  ) {
    return "adaptador-usb-c-hdmi";
  }

  if (
    normalized.includes("kensington") &&
    (normalized.includes("pro fit") || normalized.includes("k75404"))
  ) {
    return "mouse-kensington-pro-fit";
  }

  if (normalized.includes("logitech") && normalized.includes("m170")) {
    return "mouse-logitech-m170";
  }

  if (normalized.includes("logitech") && normalized.includes("k120")) {
    return "teclado-logitech-k120";
  }

  for (const code of IMPORTANT_CODES) {
    const codeKey = normalizeText(code);
    if (normalized.includes(codeKey)) return codeKey.replace(/\s+/g, "-");
  }

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .slice(0, 8);

  return tokens.join("-");
}

export function displayProductName(description: string) {
  return description.replace(/\s+/g, " ").trim();
}
