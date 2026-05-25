import { displayProductName, normalizeText } from "@/lib/normalize/normalizeProductName";
import { extractProductAttributes, type ProductAttributes } from "@/lib/normalize/productAttributes";
import type { ExtractedQuoteItem } from "@/lib/validations/quoteSchemas";

export type MatchQuality = "none" | "medium" | "high";

export type MatchResult = {
  quality: MatchQuality;
  warning?: string;
};

function intersects(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

function sameDefined<T>(a: T | undefined, b: T | undefined) {
  return a !== undefined && b !== undefined && a === b;
}

function hasCriticalMismatch(base: ProductAttributes, candidate: ProductAttributes) {
  return (
    (base.ramGb !== undefined && candidate.ramGb !== undefined && base.ramGb !== candidate.ramGb) ||
    (base.storageGb !== undefined &&
      candidate.storageGb !== undefined &&
      base.storageGb !== candidate.storageGb) ||
    (base.screenInch !== undefined &&
      candidate.screenInch !== undefined &&
      base.screenInch !== candidate.screenInch) ||
    (base.watts !== undefined && candidate.watts !== undefined && base.watts !== candidate.watts)
  );
}

function processorMismatch(base: ProductAttributes, candidate: ProductAttributes) {
  if (base.processorTerms.length === 0 || candidate.processorTerms.length === 0) return false;
  return !intersects(base.processorTerms, candidate.processorTerms);
}

function osCompatible(base?: string, candidate?: string) {
  if (!base || !candidate) return false;
  return base === candidate || (base.startsWith("windows-11") && candidate.startsWith("windows-11"));
}

function notebookScore(base: ProductAttributes, candidate: ProductAttributes) {
  let score = 0;
  if (intersects(base.codes, candidate.codes)) score += 5;
  if (sameDefined(base.brand, candidate.brand)) score += 1;
  if (sameDefined(base.ramGb, candidate.ramGb)) score += 2;
  if (sameDefined(base.storageGb, candidate.storageGb)) score += 2;
  if (sameDefined(base.screenInch, candidate.screenInch)) score += 1;
  if (intersects(base.screenTerms, candidate.screenTerms)) score += 1;
  if (intersects(base.processorTerms, candidate.processorTerms)) score += 2;
  if (osCompatible(base.os, candidate.os)) score += 1;
  if (sameDefined(base.warrantyYears, candidate.warrantyYears)) score += 1;
  return score;
}

function accessoryScore(base: ProductAttributes, candidate: ProductAttributes) {
  let score = 0;
  if (intersects(base.codes, candidate.codes)) score += 5;
  if (intersects(base.models, candidate.models)) score += 3;
  if (sameDefined(base.brand, candidate.brand)) score += 1;
  if (sameDefined(base.watts, candidate.watts)) score += 2;
  if (sameDefined(base.screenInch, candidate.screenInch)) score += 2;
  if (sameDefined(base.refreshHz, candidate.refreshHz)) score += 1;
  if (intersects(base.screenTerms, candidate.screenTerms)) score += 1;
  if (intersects(base.connectors, candidate.connectors)) score += 1;
  return score;
}

function shortBaseName(description: string) {
  return displayProductName(description)
    .replace(/\s+P\/N\s+.*/i, "")
    .replace(/\s+\(Base de Fábrica.*$/i, "")
    .trim();
}

function comparableTokens(description: string) {
  const aliases: Record<string, string> = {
    inst: "instantaneo",
    instant: "instantaneo",
    selecc: "seleccion",
    seleccion: "seleccion",
    fin: "fina",
    fco: "frasco",
    liquida: "liquido",
    liquido: "liquido",
    uni: "unidad",
    und: "unidad"
  };

  return normalizeText(description)
    .split(" ")
    .map((token) => aliases[token] ?? token)
    .filter((token) => token.length > 2 && !/^\d{5,}$/.test(token));
}

function measurements(description: string) {
  const normalized = normalizeText(description);
  return [...normalized.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|cc|l|lt|gr|g|kg|un|und|uni)\b/g)].map(
    (match) => `${Number(match[1].replace(",", "."))}-${match[2].replace(/^gr$/, "g").replace(/^lt$/, "l")}`
  );
}

function hasMeasurementMismatch(baseDescription: string, candidateDescription: string) {
  const baseMeasurements = measurements(baseDescription);
  const candidateMeasurements = measurements(candidateDescription);
  if (baseMeasurements.length === 0 || candidateMeasurements.length === 0) return false;
  return !baseMeasurements.some((value) => candidateMeasurements.includes(value));
}

function genericTokenMatch(baseDescription: string, candidateDescription: string): MatchResult {
  if (hasMeasurementMismatch(baseDescription, candidateDescription)) return { quality: "none" };

  const baseTokens = comparableTokens(baseDescription);
  const candidateTokens = comparableTokens(candidateDescription);
  if (baseTokens.length < 3 || candidateTokens.length < 3) return { quality: "none" };

  const overlap = baseTokens.filter((token) => candidateTokens.includes(token));
  const overlapScore = overlap.length / Math.min(baseTokens.length, candidateTokens.length);
  const hasStrongOverlap = overlap.some((token) => token.length >= 5);

  if (overlap.length >= 4 && overlapScore >= 0.55 && hasStrongOverlap) {
    return { quality: "high" };
  }

  if (overlap.length >= 3 && overlapScore >= 0.45 && hasStrongOverlap) {
    return {
      quality: "medium",
      warning: `Producto similar detectado, revisar equivalencia: ${displayProductName(candidateDescription)} contra ${shortBaseName(
        baseDescription
      )}.`
    };
  }

  return { quality: "none" };
}

export function getStrongModelCode(description: string) {
  const attributes = extractProductAttributes(description);
  return attributes.codes[0];
}

export function classifyProduct(description: string) {
  const attributes = extractProductAttributes(description);
  return [attributes.family, attributes.brand, attributes.codes[0] ?? attributes.models[0]]
    .filter(Boolean)
    .join("-");
}

export function compareToBaseItem(baseItem: ExtractedQuoteItem, candidate: ExtractedQuoteItem): MatchResult {
  const baseText = normalizeText(baseItem.description);
  const candidateText = normalizeText(candidate.description);
  if (baseText === candidateText || baseItem.normalizedProductKey === candidate.normalizedProductKey) {
    return { quality: "high" };
  }

  const base = extractProductAttributes(
    `${baseItem.description} ${baseItem.sourceItem === undefined ? "" : baseItem.sourceItem}`
  );
  const candidateAttributes = extractProductAttributes(
    `${candidate.description} ${candidate.sourceItem === undefined ? "" : candidate.sourceItem}`
  );

  if (intersects(base.codes, candidateAttributes.codes)) {
    return { quality: "high" };
  }

  if (!base.family || !candidateAttributes.family || base.family !== candidateAttributes.family) {
    return genericTokenMatch(baseItem.description, candidate.description);
  }

  if (base.brand && candidateAttributes.brand && base.brand !== candidateAttributes.brand) {
    return { quality: "none" };
  }

  if (hasCriticalMismatch(base, candidateAttributes)) {
    return { quality: "none" };
  }

  if (base.family === "notebook") {
    const score = notebookScore(base, candidateAttributes);
    const hasMainSpecs =
      sameDefined(base.ramGb, candidateAttributes.ramGb) &&
      sameDefined(base.storageGb, candidateAttributes.storageGb);

    if (score >= 7 && !processorMismatch(base, candidateAttributes)) return { quality: "high" };

    if (hasMainSpecs && score >= 5) {
      const warningReason = processorMismatch(base, candidateAttributes)
        ? "revisar procesador"
        : "revisar especificaciones técnicas";
      return {
        quality: "medium",
        warning: `${displayProductName(candidate.description)} calzado con confianza media contra ${shortBaseName(
          baseItem.description
        )}; ${warningReason}.`
      };
    }

    return { quality: "none" };
  }

  const score = accessoryScore(base, candidateAttributes);
  if (score >= 5) return { quality: "high" };

  if (score >= 3 && !hasCriticalMismatch(base, candidateAttributes)) {
    return {
      quality: "medium",
      warning: `${displayProductName(candidate.description)} calzado con confianza media contra ${shortBaseName(
        baseItem.description
      )}; revisar especificaciones técnicas.`
    };
  }

  if (base.family === "audio" && candidateAttributes.family === "audio") {
    return {
      quality: "none",
      warning: `${displayProductName(candidate.description)} detectado como alternativa de audífono, no se agrega como fila nueva.`
    };
  }

  return { quality: "none" };
}
