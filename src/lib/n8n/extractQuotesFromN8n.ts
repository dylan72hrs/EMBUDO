import { z } from "zod";
import { normalizeProductName } from "@/lib/normalize/normalizeProductName";
import { detectCurrency } from "@/lib/parser/detectCurrency";
import { parseMoney } from "@/lib/parser/parseMoney";
import { isAssociatedCostText } from "@/lib/parser/providers/tableParserUtils";
import type { AdditionalEvaluationData } from "@/lib/excel/generateComparisonExcel";
import type { Currency, ExtractedQuoteItem, ParsedQuote } from "@/lib/validations/quoteSchemas";

const DEFAULT_TIMEOUT_MS = 180_000;

type SupportedExtractorFileKind = "pdf" | "xlsx" | "xls" | "csv" | "txt" | "html" | "docx" | "unknown";
type N8nDocumentKind = "quote" | "purchase_request" | "order" | "invoice" | "unknown";

type N8nItem = {
  lineNumber?: string | number | null;
  sku?: string | null;
  description?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  unitPriceClp?: string | number | null;
  unitPriceCLP?: string | number | null;
  total?: string | number | null;
  totalClp?: string | number | null;
  totalCLP?: string | number | null;
  currency?: string | null;
  confidence?: string | number | null;
  rawLine?: string | null;
  sourceItem?: string | number | null;
};

export type N8nExtractInput = {
  files: File[];
  jobId: string;
  exchangeRateMode: "auto" | "manual";
  exchangeRateBase: number;
  exchangeRateMarginClp: number;
  exchangeRateFinal: number;
  targetCurrency: "CLP" | "USD";
  evaluationData?: AdditionalEvaluationData;
};

export type N8nDocumentResponse = {
  ok: boolean;
  valid: boolean | null;
  isValid: boolean | null;
  isValidQuotation: boolean | null;
  fileName: string;
  fileKind: string | null;
  detectedType: string;
  supplierName: string | null;
  supplierRut: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  supplier: {
    name: string | null;
    rut: string | null;
    confidence: number | null;
  } | null;
  currency: string | null;
  paymentTerms: string | null;
  deliveryTime: string | null;
  availability: string | null;
  shippingCost: string | number | null;
  items: N8nItem[];
  warnings: string[];
  sourceFileKind: string | null;
  contentLength: number | null;
  error: string | null;
};

export type N8nExtractResponse = {
  ok: boolean;
  source: string;
  exchange: {
    mode: string | null;
    baseRate: number | null;
    marginClp: number | null;
    finalRate: number | null;
    targetCurrency: string | null;
  } | null;
  evaluationData: Record<string, unknown> | null;
  summary: {
    totalDocuments: number | null;
    validQuotations: number | null;
    invalidDocuments: number | null;
    totalItems: number | null;
  } | null;
  documents: N8nDocumentResponse[];
  validDocuments: N8nDocumentResponse[];
  validQuotations: N8nDocumentResponse[];
  omittedFiles: Array<{ fileName?: string; reason?: string; [key: string]: unknown }>;
  warnings: string[];
  errors: string[];
};

export type NormalizedN8nDocument = {
  fileName: string;
  detectedType: N8nDocumentKind;
  status: "processed" | "omitted";
  parsedQuote?: ParsedQuote;
  warnings: string[];
  reason: string;
  action: string;
  missing: string[];
};

export type MapN8nResult = {
  parsedQuotes: ParsedQuote[];
  documentResults: NormalizedN8nDocument[];
  warnings: string[];
};

type N8nErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "NETWORK"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "EXTRACT_FAILED";

export class N8nExtractorError extends Error {
  code: N8nErrorCode;

  constructor(code: N8nErrorCode, message: string) {
    super(message);
    this.name = "N8nExtractorError";
    this.code = code;
  }
}

export type N8nDiagnostics = {
  n8nWebhookConfigured: boolean;
  n8nApiKeyConfigured: boolean;
  n8nTimeoutMs: number;
  n8nWebhookHost: string | null;
};

const N8nItemSchema = z
  .object({
    lineNumber: z.union([z.string(), z.number()]).optional().nullable(),
    sku: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    quantity: z.union([z.string(), z.number()]).optional().nullable(),
    unit: z.string().optional().nullable(),
    unitPrice: z.union([z.string(), z.number()]).optional().nullable(),
    unitPriceClp: z.union([z.string(), z.number()]).optional().nullable(),
    unitPriceCLP: z.union([z.string(), z.number()]).optional().nullable(),
    total: z.union([z.string(), z.number()]).optional().nullable(),
    totalClp: z.union([z.string(), z.number()]).optional().nullable(),
    totalCLP: z.union([z.string(), z.number()]).optional().nullable(),
    currency: z.string().optional().nullable(),
    confidence: z.union([z.string(), z.number()]).optional().nullable(),
    rawLine: z.string().optional().nullable(),
    sourceItem: z.union([z.string(), z.number()]).optional().nullable()
  })
  .passthrough();

const N8nDocumentSchema = z
  .object({
    ok: z.boolean().optional().default(true),
    valid: z.boolean().optional().nullable(),
    isValid: z.boolean().optional().nullable(),
    isValidQuotation: z.boolean().optional().nullable(),
    fileName: z.string().optional().default(""),
    fileKind: z.string().optional().nullable(),
    detectedType: z.string().optional().default("unknown"),
    supplierName: z.string().optional().nullable(),
    supplierRut: z.string().optional().nullable(),
    documentNumber: z.string().optional().nullable(),
    documentDate: z.string().optional().nullable(),
    supplier: z
      .object({
        name: z.string().optional().nullable(),
        rut: z.string().optional().nullable(),
        confidence: z.union([z.string(), z.number()]).optional().nullable()
      })
      .optional()
      .nullable(),
    currency: z.string().optional().nullable(),
    paymentTerms: z.string().optional().nullable(),
    deliveryTime: z.string().optional().nullable(),
    availability: z.string().optional().nullable(),
    shippingCost: z.union([z.string(), z.number()]).optional().nullable(),
    items: z.array(N8nItemSchema).optional().default([]),
    warnings: z.array(z.string()).optional().default([]),
    sourceFileKind: z.string().optional().nullable(),
    contentLength: z.union([z.string(), z.number()]).optional().nullable(),
    error: z.string().optional().nullable()
  })
  .passthrough();

const N8nResponseSchema = z
  .object({
    ok: z.boolean(),
    source: z.string().optional().default("n8n"),
    exchange: z
      .object({
        mode: z.string().optional().nullable(),
        baseRate: z.union([z.string(), z.number()]).optional().nullable(),
        marginClp: z.union([z.string(), z.number()]).optional().nullable(),
        finalRate: z.union([z.string(), z.number()]).optional().nullable(),
        targetCurrency: z.string().optional().nullable()
      })
      .optional()
      .nullable(),
    evaluationData: z.record(z.unknown()).optional().nullable(),
    summary: z
      .object({
        totalDocuments: z.union([z.string(), z.number()]).optional().nullable(),
        validQuotations: z.union([z.string(), z.number()]).optional().nullable(),
        invalidDocuments: z.union([z.string(), z.number()]).optional().nullable(),
        totalItems: z.union([z.string(), z.number()]).optional().nullable()
      })
      .optional()
      .nullable(),
    documents: z.array(N8nDocumentSchema).optional().default([]),
    validDocuments: z.array(N8nDocumentSchema).optional().default([]),
    validQuotations: z.array(N8nDocumentSchema).optional().default([]),
    omittedFiles: z.array(z.record(z.unknown())).optional().default([]),
    warnings: z.array(z.string()).optional().default([]),
    errors: z.array(z.string()).optional().default([])
  })
  .passthrough();

const NON_PRODUCT_HINTS =
  /\b(subtotal|total neto|total general|iva|ila|observaciones?|condicion(?:es)?(?: comerciales)?|forma de pago|validez)\b/i;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function safeText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseMoney(trimmed);
  if (parsed !== null && Number.isFinite(parsed) && parsed > 0) return parsed;
  const direct = Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(direct) && direct > 0 ? direct : undefined;
}

function parseNonNegativeNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseMoney(trimmed);
  if (parsed !== null && Number.isFinite(parsed) && parsed >= 0) return parsed;
  const direct = Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(direct) && direct >= 0 ? direct : undefined;
}

function parseCurrency(value: unknown, fallback?: string): Currency {
  const candidate = safeText(value);
  if (candidate) {
    const normalized = normalizeText(candidate);
    if (normalized === "usd" || normalized === "us$" || normalized.includes("dolar")) return "USD";
    if (normalized === "clp" || normalized === "$" || normalized.includes("peso")) return "CLP";
  }
  if (fallback) {
    return detectCurrency(fallback);
  }
  return "UNKNOWN";
}

function formatCostAmount(amount: number, currency: Currency) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

function normalizeDocumentKind(detectedType?: string): N8nDocumentKind {
  const normalized = normalizeText(detectedType ?? "");
  if (!normalized) return "unknown";
  if (normalized.includes("quotation") || normalized.includes("quote") || normalized.includes("cotizacion")) {
    return "quote";
  }
  if (
    normalized.includes("purchase_request") ||
    normalized.includes("solicitud oc") ||
    normalized.includes("solicitud orden de compra")
  ) {
    return "purchase_request";
  }
  if (normalized.includes("order") || normalized.includes("orden de compra")) return "order";
  if (normalized.includes("invoice") || normalized.includes("factura")) return "invoice";
  return "unknown";
}

function classifyLine(description: string) {
  const normalized = normalizeText(description);

  if (isAssociatedCostText(description)) {
    return {
      category: "ENVIO_DESPACHO_FLETE" as const,
      omit: true,
      reason: "Linea de envio/despacho/flete detectada."
    };
  }

  if (NON_PRODUCT_HINTS.test(normalized)) {
    return {
      category: "LINEA_INFORMATIVA" as const,
      omit: true,
      reason: "Linea informativa/comercial detectada."
    };
  }

  return {
    category: "PRODUCTO_COMPARABLE" as const,
    omit: false,
    reason: ""
  };
}

function itemConfidence(value: unknown) {
  const parsed = parseNonNegativeNumber(value);
  if (parsed === undefined) return 0.5;
  if (parsed > 1) return 1;
  return parsed;
}

function invalidDocumentReason(kind: N8nDocumentKind) {
  if (kind === "purchase_request") {
    return "Este archivo no parece ser una cotizacion valida. Fue clasificado como Solicitud OC / documento interno.";
  }
  if (kind === "invoice") {
    return "Este archivo no corresponde a una cotizacion valida (detectado como factura).";
  }
  if (kind === "order") {
    return "Este archivo corresponde a una orden de compra y no a una cotizacion de proveedor.";
  }
  return "Cotizacion detectada, pero el formato de tabla no pudo leerse con seguridad.";
}

function invalidDocumentAction(kind: N8nDocumentKind) {
  if (kind === "quote") {
    return "Revisa que el archivo tenga productos, cantidades, precio unitario, total y moneda visibles.";
  }
  return "Sube una cotizacion formal de proveedor con tabla de productos.";
}

function isExplicitValidQuotation(document: N8nDocumentResponse) {
  return (
    document.valid === true ||
    document.isValid === true ||
    document.isValidQuotation === true
  );
}

function derivedSupplierFromFilename(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "").trim();
  return baseName.length > 0 ? baseName : "Proveedor no identificado";
}

function mapDocumentToQuote(
  document: N8nDocumentResponse,
  options: { trustedFromN8n?: boolean } = {}
): NormalizedN8nDocument {
  const fileName = safeText(document.fileName) ?? "archivo-sin-nombre";
  const detectedType = normalizeDocumentKind(document.detectedType);
  const trustedDocument = options.trustedFromN8n || isExplicitValidQuotation(document);
  const docWarnings: string[] = [...document.warnings];
  if (document.error) docWarnings.push(document.error);
  const supplierName =
    safeText(document.supplierName ?? undefined) ??
    safeText(document.supplier?.name ?? undefined) ??
    (trustedDocument ? derivedSupplierFromFilename(fileName) : undefined);
  const supplierRut =
    safeText(document.supplierRut ?? undefined) ??
    safeText(document.supplier?.rut ?? undefined);

  if (!safeText(document.supplierName ?? undefined) && !safeText(document.supplier?.name ?? undefined) && supplierName) {
    docWarnings.push(
      `${supplierName}: n8n no entrego proveedor explicito; se uso nombre derivado del archivo para mantener la cotizacion procesable.`
    );
  }

  if ((!document.ok && !trustedDocument) || (detectedType !== "quote" && !trustedDocument) || !supplierName) {
    return {
      fileName,
      detectedType,
      status: "omitted",
      warnings: docWarnings,
      reason: invalidDocumentReason(detectedType),
      action: invalidDocumentAction(detectedType),
      missing: [
        "Proveedor cotizante identificable",
        "Productos con cantidad",
        "Precio unitario o total",
        "Moneda reconocible"
      ]
    };
  }

  const documentCurrency = parseCurrency(document.currency, document.currency ?? undefined);
  const quoteWarnings: string[] = [...docWarnings];
  const validItems: ExtractedQuoteItem[] = [];

  for (const [index, rawItem] of document.items.entries()) {
    const description = safeText(rawItem.description ?? undefined);
    const rawLine = safeText(rawItem.rawLine ?? undefined) ?? description;
    if (!description) {
      quoteWarnings.push(`${supplierName}: linea ${index + 1} omitida por descripcion vacia.`);
      continue;
    }

    const unitPriceInput =
      parseNonNegativeNumber(rawItem.unitPriceClp) ??
      parseNonNegativeNumber(rawItem.unitPriceCLP) ??
      parseNonNegativeNumber(rawItem.unitPrice);
    const totalInput =
      parseNonNegativeNumber(rawItem.totalClp) ??
      parseNonNegativeNumber(rawItem.totalCLP) ??
      parseNonNegativeNumber(rawItem.total);
    const quantity = parsePositiveNumber(rawItem.quantity);
    const classification = classifyLine(rawLine ?? description);

    if (classification.category === "ENVIO_DESPACHO_FLETE") {
      const amount = totalInput ?? unitPriceInput ?? parseNonNegativeNumber(document.shippingCost);
      if (amount && amount > 0) {
        const lineCurrency = parseCurrency(rawItem.currency, `${rawLine ?? ""} ${document.currency ?? ""}`);
        quoteWarnings.push(
          `Costo asociado detectado y omitido de productos comparables: ${description} ${formatCostAmount(
            amount,
            lineCurrency
          )}`
        );
      } else {
        quoteWarnings.push(`${supplierName}: ${description} omitida (${classification.reason}).`);
      }
      continue;
    }

    if (unitPriceInput === undefined && totalInput === undefined) {
      quoteWarnings.push(`${supplierName}: ${description} omitido por no tener precio unitario ni total valido.`);
      continue;
    }

    if (classification.omit && !trustedDocument) {
      quoteWarnings.push(`${supplierName}: ${description} omitida (${classification.reason}).`);
      continue;
    }

    let effectiveQuantity = quantity;
    if (!effectiveQuantity && trustedDocument && unitPriceInput !== undefined && totalInput !== undefined && unitPriceInput > 0) {
      const inferredQuantity = totalInput / unitPriceInput;
      if (Number.isFinite(inferredQuantity) && inferredQuantity > 0) {
        const roundedQuantity = Math.round(inferredQuantity);
        if (Math.abs(inferredQuantity - roundedQuantity) < 0.001 && roundedQuantity > 0) {
          effectiveQuantity = roundedQuantity;
          quoteWarnings.push(
            `${supplierName}: cantidad inferida para ${description} usando total / precio unitario entregados por n8n.`
          );
        }
      }
    }

    if (!effectiveQuantity) {
      quoteWarnings.push(
        `${supplierName}: ${description} omitido por no tener cantidad valida con evidencia suficiente.`
      );
      continue;
    }

    let unitPrice: number | null = null;
    let total: number | null = null;
    if (unitPriceInput !== undefined) {
      unitPrice = unitPriceInput;
      total = unitPriceInput * effectiveQuantity;
      if (totalInput !== undefined && Math.abs(totalInput - total) > 2) {
        quoteWarnings.push(
          `${supplierName}: total corregido para ${description} por inconsistencia matematica (P.UNIT x CANT).`
        );
      }
    } else if (totalInput !== undefined) {
      total = totalInput;
      unitPrice = effectiveQuantity > 0 ? totalInput / effectiveQuantity : null;
      quoteWarnings.push(
        `${supplierName}: precio unitario calculado para ${description} porque no venia explicito en el archivo.`
      );
    }

    const currency = parseCurrency(
      rawItem.currency,
      `${rawItem.currency ?? ""} ${rawLine ?? ""} ${document.currency ?? ""}`
    );
    if (currency === "UNKNOWN") {
      quoteWarnings.push(
        `${supplierName}: moneda no detectada con seguridad para ${description}; revisar manualmente.`
      );
    }

    validItems.push({
      sourceItem: rawItem.sourceItem ?? rawItem.lineNumber ?? index + 1,
      description,
      normalizedProductKey: normalizeProductName(description),
      quantity: effectiveQuantity,
      unit: safeText(rawItem.unit) ?? "CU",
      currency: currency === "UNKNOWN" ? documentCurrency : currency,
      unitPrice,
      total,
      rawLine: rawLine ?? description,
      rawBlock: rawLine ?? description,
      lineCategory: "PRODUCTO_COMPARABLE",
      extractionMethod: "n8n-openrouter-ai-agent-extractors",
      confidence: itemConfidence(rawItem.confidence)
    });
  }

  if (validItems.length === 0) {
    return {
      fileName,
      detectedType,
      status: "omitted",
      warnings: quoteWarnings,
      reason: "Cotizacion detectada, pero el formato de tabla no pudo leerse con seguridad.",
      action:
        "Revise que el documento tenga productos, cantidades, precio unitario, total y moneda claramente visibles.",
      missing: ["Productos validos extraibles", "Cantidad con evidencia", "Precio unitario/total valido"]
    };
  }

  const parsedQuote: ParsedQuote = {
    supplierName,
    supplierRut,
    extractionSource: "n8n",
    quoteNumber: safeText(document.documentNumber) ?? undefined,
    quoteDate: safeText(document.documentDate) ?? undefined,
    paymentCondition: safeText(document.paymentTerms),
    deliveryTime: safeText(document.deliveryTime),
    pricesIncludeVat: false,
    items: validItems,
    warnings: quoteWarnings
  };

  return {
    fileName,
    detectedType,
    status: "processed",
    parsedQuote,
    warnings: quoteWarnings,
    reason: "Cotizacion valida procesada correctamente.",
    action: "Sin accion requerida.",
    missing: []
  };
}

function parseSummaryValue(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapN8nDocument(document: z.infer<typeof N8nDocumentSchema>): N8nDocumentResponse {
  return {
    ok: document.ok,
    valid: document.valid ?? null,
    isValid: document.isValid ?? null,
    isValidQuotation: document.isValidQuotation ?? null,
    fileName: safeText(document.fileName) ?? "",
    fileKind: safeText(document.fileKind) ?? null,
    detectedType: safeText(document.detectedType) ?? "unknown",
    supplierName: safeText(document.supplierName) ?? null,
    supplierRut: safeText(document.supplierRut) ?? null,
    documentNumber: safeText(document.documentNumber) ?? null,
    documentDate: safeText(document.documentDate) ?? null,
    supplier: document.supplier
      ? {
          name: safeText(document.supplier.name) ?? null,
          rut: safeText(document.supplier.rut) ?? null,
          confidence: parseNonNegativeNumber(document.supplier.confidence) ?? null
        }
      : null,
    currency: safeText(document.currency) ?? null,
    paymentTerms: safeText(document.paymentTerms) ?? null,
    deliveryTime: safeText(document.deliveryTime) ?? null,
    availability: safeText(document.availability) ?? null,
    shippingCost:
      parseNonNegativeNumber(document.shippingCost) ??
      (safeText(document.shippingCost) ?? null),
    items: document.items as N8nItem[],
    warnings: document.warnings,
    sourceFileKind: safeText(document.sourceFileKind) ?? null,
    contentLength: parseSummaryValue(document.contentLength),
    error: safeText(document.error) ?? null
  };
}

function parseN8nResponse(payload: unknown): N8nExtractResponse {
  const parsed = N8nResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new N8nExtractorError(
      "INVALID_RESPONSE",
      "La respuesta del extractor n8n no tiene el formato esperado."
    );
  }

  const documents = parsed.data.documents.map(mapN8nDocument);
  const validDocuments = parsed.data.validDocuments.map(mapN8nDocument);
  const validQuotations = parsed.data.validQuotations.map(mapN8nDocument);
  const omittedFiles = parsed.data.omittedFiles.map((entry) => ({
    fileName: safeText(entry.fileName) ?? undefined,
    reason: safeText(entry.reason) ?? undefined
  }));

  return {
    ok: parsed.data.ok,
    source: parsed.data.source,
    exchange: parsed.data.exchange
      ? {
          mode: safeText(parsed.data.exchange.mode) ?? null,
          baseRate: parseSummaryValue(parsed.data.exchange.baseRate),
          marginClp: parseSummaryValue(parsed.data.exchange.marginClp),
          finalRate: parseSummaryValue(parsed.data.exchange.finalRate),
          targetCurrency: safeText(parsed.data.exchange.targetCurrency) ?? null
        }
      : null,
    evaluationData: parsed.data.evaluationData ?? null,
    summary: parsed.data.summary
      ? {
          totalDocuments: parseSummaryValue(parsed.data.summary.totalDocuments),
          validQuotations: parseSummaryValue(parsed.data.summary.validQuotations),
          invalidDocuments: parseSummaryValue(parsed.data.summary.invalidDocuments),
          totalItems: parseSummaryValue(parsed.data.summary.totalItems)
        }
      : null,
    documents,
    validDocuments,
    validQuotations,
    omittedFiles,
    warnings: parsed.data.warnings,
    errors: parsed.data.errors
  };
}

function webhookTimeoutMs() {
  const raw = process.env.N8N_EXTRACT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function webhookHost(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function getN8nDiagnostics(): N8nDiagnostics {
  const webhookUrl = process.env.N8N_EXTRACT_WEBHOOK_URL?.trim();
  const apiKey = process.env.N8N_EXTRACT_API_KEY?.trim();

  return {
    n8nWebhookConfigured: Boolean(webhookUrl),
    n8nApiKeyConfigured: Boolean(apiKey),
    n8nTimeoutMs: webhookTimeoutMs(),
    n8nWebhookHost: webhookHost(webhookUrl)
  };
}

export function detectSupportedExtractorFileKind(
  filename: string,
  mimeType?: string
): SupportedExtractorFileKind {
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
  const normalizedMime = (mimeType ?? "").toLowerCase();

  if (extension === ".pdf" || normalizedMime === "application/pdf") return "pdf";
  if (
    extension === ".xlsx" ||
    normalizedMime.includes("spreadsheetml") ||
    normalizedMime === "application/vnd.ms-excel.sheet.macroenabled.12"
  ) {
    return "xlsx";
  }
  if (extension === ".xls" || normalizedMime === "application/vnd.ms-excel") return "xls";
  if (extension === ".csv" || normalizedMime === "text/csv") return "csv";
  if (extension === ".txt" || normalizedMime === "text/plain") return "txt";
  if (extension === ".html" || extension === ".htm" || normalizedMime === "text/html") return "html";
  if (
    extension === ".docx" ||
    normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return "unknown";
}

export async function extractQuotesFromN8n(input: N8nExtractInput): Promise<N8nExtractResponse> {
  const webhookUrl = process.env.N8N_EXTRACT_WEBHOOK_URL?.trim();
  const apiKey = process.env.N8N_EXTRACT_API_KEY?.trim();

  if (!webhookUrl) {
    throw new N8nExtractorError(
      "NOT_CONFIGURED",
      "Extractor n8n no configurado. Falta N8N_EXTRACT_WEBHOOK_URL en el entorno del servidor."
    );
  }

  if (!apiKey) {
    throw new N8nExtractorError(
      "NOT_CONFIGURED",
      "Extractor n8n no configurado. Falta N8N_EXTRACT_API_KEY en el entorno del servidor."
    );
  }

  const formData = new FormData();
  formData.append("jobId", input.jobId);
  formData.append("exchangeRateMode", input.exchangeRateMode);
  formData.append("exchangeRateBase", String(input.exchangeRateBase));
  formData.append("exchangeRateMarginClp", String(input.exchangeRateMarginClp));
  formData.append("exchangeRateFinal", String(input.exchangeRateFinal));
  formData.append("targetCurrency", input.targetCurrency);
  formData.append("evaluationDataJson", JSON.stringify(input.evaluationData ?? {}));

  input.files.forEach((file, index) => {
    formData.append(`file_${index}`, file, file.name);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhookTimeoutMs());

  try {
    console.info("[n8n] sending request", {
      jobId: input.jobId,
      filesCount: input.files.length,
      webhookHost: webhookHost(webhookUrl),
      timeoutMs: webhookTimeoutMs()
    });

    const response = await fetch(webhookUrl, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new N8nExtractorError(
          "AUTH",
          "No se pudo autenticar con n8n. Revise la clave compartida entre Render y Azure."
        );
      }

      const message =
        typeof payload === "object" && payload && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `Extractor n8n respondio con estado ${response.status}.`;
      throw new N8nExtractorError("EXTRACT_FAILED", message);
    }

    const parsed = parseN8nResponse(payload);
    if (!parsed.ok) {
      const reason =
        parsed.errors[0] ??
        parsed.warnings[0] ??
        "El extractor n8n no pudo obtener cotizaciones validas.";
      throw new N8nExtractorError("EXTRACT_FAILED", reason);
    }

    return parsed;
  } catch (error) {
    if (error instanceof N8nExtractorError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new N8nExtractorError("TIMEOUT", "El extractor n8n supero el tiempo maximo de espera.");
    }
    throw new N8nExtractorError(
      "NETWORK",
      "No se pudo conectar con el extractor n8n. Intente nuevamente o contacte a TI."
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function mapN8nDocumentsToQuotes(response: N8nExtractResponse): MapN8nResult {
  const usesValidatedCollections =
    response.validQuotations.length > 0 || response.validDocuments.length > 0;
  const sourceDocuments =
    response.validQuotations.length > 0
      ? response.validQuotations.map((document) => ({
          ...document,
          detectedType:
            safeText(document.detectedType) && normalizeDocumentKind(document.detectedType) !== "unknown"
              ? document.detectedType
              : "quotation"
        }))
      : response.validDocuments.length > 0
      ? response.validDocuments
      : response.documents;
  const documentResults = sourceDocuments.map((document) =>
    mapDocumentToQuote(document, {
      trustedFromN8n: usesValidatedCollections || isExplicitValidQuotation(document)
    })
  );
  const parsedQuotes = documentResults
    .filter((document): document is NormalizedN8nDocument & { parsedQuote: ParsedQuote } =>
      document.status === "processed" && Boolean(document.parsedQuote)
    )
    .map((document) => document.parsedQuote);
  const omittedWarnings = response.omittedFiles
    .map((file) => {
      const filename = file.fileName?.trim();
      if (!filename) return undefined;
      return file.reason
        ? `Archivo omitido por n8n: ${filename}. ${file.reason}`
        : `Archivo omitido por n8n: ${filename}.`;
    })
    .filter((warning): warning is string => Boolean(warning));

  return {
    parsedQuotes,
    documentResults,
    warnings: [...response.warnings, ...omittedWarnings]
  };
}
