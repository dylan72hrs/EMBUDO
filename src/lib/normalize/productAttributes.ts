import { normalizeText } from "@/lib/normalize/normalizeProductName";

export type ProductAttributes = {
  brand?: string;
  family?: string;
  codes: string[];
  models: string[];
  ramGb?: number;
  storageGb?: number;
  screenInch?: number;
  screenTerms: string[];
  refreshHz?: number;
  processorTerms: string[];
  os?: string;
  warrantyYears?: number;
  watts?: number;
  connectors: string[];
};

const BRANDS = [
  "dell",
  "logitech",
  "kensington",
  "samsung",
  "aoc",
  "xtech",
  "jabra",
  "jbl",
  "razer",
  "hp",
  "lenovo",
  "asus",
  "acer",
  "lg",
  "microsoft",
  "apple"
];

const MODEL_PHRASES = [
  "blackshark v2 x",
  "evolve2 50",
  "tune 110",
  "pro fit",
  "pro plus",
  "pro essentials"
];

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeCode(value: string) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function isStrongCode(value: string) {
  return !(
    /^\d+$/.test(value) ||
    /^\d+x\d+$/.test(value) ||
    /^\d{3,5}u$/.test(value) ||
    /^w11p?$/.test(value) ||
    /^ddr\d+$/.test(value) ||
    /^\d+(gb|tb|hz|w|in|yrs?)$/.test(value)
  );
}

function detectFamily(text: string) {
  if (/\b(notebook|laptop|portatil|probook|thinkpad|latitude)\b/.test(text)) return "notebook";
  if (/\bmonitor|pantalla\b/.test(text)) return "monitor";
  if (/\bmouse|raton\b/.test(text)) return "mouse";
  if (/\bteclado|keyboard\b/.test(text)) return "teclado";
  if (/\b(audifono|audifonos|headset|auricular|in ear|earbuds)\b/.test(text)) return "audio";
  if (/\b(cargador|adapter|adaptador ac|ac adapter|power adapter)\b/.test(text)) return "cargador";
  if (/\bbateria\b/.test(text)) return "bateria";
  if (/\b(adaptador|adapter|hub|dongle)\b/.test(text)) return "adaptador";
  if (/\b(docking|dock|replicador)\b/.test(text)) return "docking";
  if (/\b(soporte|base)\b/.test(text)) return "soporte";
  if (/\b\d{1,3}gb\b/.test(text) && /\b(w11|windows|ssd|tbssd|ultra|i[3579]|u[57])\b/.test(text)) {
    return "notebook";
  }
  return undefined;
}

function extractCodes(raw: string, text: string) {
  const explicitPn = [...raw.matchAll(/p\/?n\s*[:#-]?\s*([a-z0-9][a-z0-9_\-/]{2,})/gi)].map(
    (match) => match[1]
  );
  const general = [...text.matchAll(/\b[a-z]{0,5}\d[a-z0-9_-]{2,}\b/g)].map((match) => match[0]);
  const dashedNumbers = [...text.matchAll(/\b\d{3}-\d{3,}\b/g)].map((match) => match[0]);
  const phraseModels = MODEL_PHRASES.filter((phrase) => text.includes(phrase));

  return unique([...explicitPn, ...general, ...dashedNumbers, ...phraseModels].map(normalizeCode)).filter(
    isStrongCode
  );
}

function extractRamGb(text: string) {
  const explicit = text.match(/\bram\s*(\d{1,3})\s*gb\b/) ?? text.match(/\b(\d{1,3})\s*gb\s*(?:ddr|ram)\b/);
  if (explicit) return Number(explicit[1]);

  const compact = text.match(/\b(8|16|32|64|128)gb\b/);
  return compact ? Number(compact[1]) : undefined;
}

function extractStorageGb(text: string) {
  const tb = text.match(/\b(\d+(?:\.\d+)?)\s*tb\s*(?:ssd|hdd|disco)?\b/) ?? text.match(/\b(\d+)tbssd\b/);
  if (tb) return Number(tb[1]) * 1024;

  const gb =
    text.match(/\b(?:ssd|hdd|disco)\s*(\d{3,4})\s*gb\b/) ??
    text.match(/\b(\d{3,4})\s*gb\s*(?:ssd|hdd|disco)\b/) ??
    text.match(/\b(256|512)\s*(?:gb)?\s*w11\b/);
  return gb ? Number(gb[1]) : undefined;
}

function extractScreenInch(raw: string, text: string) {
  const rawMatch = raw.match(/\b(\d{2}(?:[.,]\d)?)\s*(?:"|in|inch|pulgadas?)\b/i);
  if (rawMatch) return Number(rawMatch[1].replace(",", "."));

  const textMatch = text.match(/\b(\d{2})(?:in|inch)\b/);
  return textMatch ? Number(textMatch[1]) : undefined;
}

function extractProcessorTerms(text: string) {
  const terms: string[] = [];
  if (/\bultra\s*5\b/.test(text) || /\bu5\b/.test(text)) terms.push("ultra-5");
  if (/\bultra\s*7\b/.test(text) || /\bu7\b/.test(text)) terms.push("ultra-7");
  const coreMatch = text.match(/\bi[3579]\b/);
  if (coreMatch) terms.push(coreMatch[0]);
  for (const match of text.matchAll(/\b\d{3,5}u\b/g)) terms.push(match[0]);
  return unique(terms);
}

export function extractProductAttributes(description: string): ProductAttributes {
  const text = normalizeText(description);
  const brand = BRANDS.find((candidate) => text.includes(candidate));
  const screenTerms = unique(["fhd", "wuxga", "ips", "uhd", "qhd"].filter((term) => text.includes(term)));
  const refresh = text.match(/\b(\d{2,3})\s*hz\b/);
  const warranty =
    text.match(/\b(\d+)\s*(?:anos|ano|yrs|years)\b/) ?? text.match(/\b(\d)yrs\b/);
  const watts = text.match(/\b(\d{2,3})\s*w\b/);
  const connectors = unique(
    [
      text.includes("usb c") ? "usb-c" : undefined,
      text.includes("usb a") ? "usb-a" : undefined,
      text.includes("hdmi") ? "hdmi" : undefined,
      text.includes("dual hdmi") ? "dual-hdmi" : undefined,
      text.includes("mini jack") ? "mini-jack" : undefined,
      text.includes("bluetooth") ? "bluetooth" : undefined
    ]
  );

  return {
    brand,
    family: detectFamily(text),
    codes: extractCodes(description, text),
    models: unique(MODEL_PHRASES.filter((phrase) => text.includes(phrase)).map(normalizeCode)),
    ramGb: extractRamGb(text),
    storageGb: extractStorageGb(text),
    screenInch: extractScreenInch(description, text),
    screenTerms,
    refreshHz: refresh ? Number(refresh[1]) : undefined,
    processorTerms: extractProcessorTerms(text),
    os: text.includes("windows 11 pro") || text.includes("w11p") ? "windows-11-pro" : text.includes("w11") || text.includes("windows 11") ? "windows-11" : undefined,
    warrantyYears: warranty ? Number(warranty[1]) : undefined,
    watts: watts ? Number(watts[1]) : undefined,
    connectors
  };
}
