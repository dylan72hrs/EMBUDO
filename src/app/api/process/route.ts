import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { consolidateQuotes } from "@/lib/normalize/consolidateQuotes";
import {
  generateComparisonExcel,
  type AdditionalEvaluationData,
  type SupplierEvaluationInput
} from "@/lib/excel/generateComparisonExcel";
import {
  getExchangeRate,
  parseExchangeRateValue,
  type ExchangeRateRequest
} from "@/lib/currency/getExchangeRate";
import { buildPurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";
import {
  extractQuotesFromN8n,
  getN8nDiagnostics,
  mapN8nDocumentsToQuotes,
  N8nExtractorError,
  type NormalizedN8nDocument
} from "@/lib/n8n/extractQuotesFromN8n";
import {
  ensureJobDirectories,
  ensureStorageLayout,
  jobPdfDir,
  jobUploadDir,
  saveUploadedFile,
  sanitizeFilename,
  templateExcelPath
} from "@/lib/utils/fileStorage";
import {
  MAX_PDF_FILE_SIZE_BYTES,
  MAX_PDF_FILE_SIZE_MB,
  MAX_QUOTES,
  MAX_TOTAL_UPLOAD_SIZE_BYTES,
  MAX_TOTAL_UPLOAD_SIZE_MB
} from "@/lib/uploadLimits";
import type { ParsedQuote } from "@/lib/validations/quoteSchemas";

export const runtime = "nodejs";
const PDF_MIME_TYPE = "application/pdf";

type DocumentKind = "quote" | "purchase_request" | "order" | "invoice" | "unknown";

type DocumentDiagnostic = {
  filename: string;
  typeDetected: string;
  status: "processed" | "omitted";
  reason: string;
  missing: string[];
  action: string;
};

type UploadedQuoteEntry = {
  id: string;
  originalFilename: string;
};

type PdfValidationResult = {
  isValid: boolean;
  warning?: string;
  reason?: string;
};

function fileNameKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function parseQuoteDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function validatePdfOnly(file: File): PdfValidationResult {
  const hasPdfExtension = /\.pdf$/i.test(file.name);
  const mimeType = file.type.trim().toLowerCase();

  if (!hasPdfExtension) {
    return {
      isValid: false,
      reason: `El archivo ${file.name} no es PDF. Solo se aceptan archivos PDF en esta version.`
    };
  }

  if (!mimeType) {
    return {
      isValid: true,
      warning: `El archivo ${file.name} no trae MIME; se acepto por extension .pdf.`
    };
  }

  if (mimeType !== PDF_MIME_TYPE) {
    return {
      isValid: false,
      reason: `El archivo ${file.name} tiene MIME ${mimeType}; solo se aceptan archivos PDF en esta version.`
    };
  }

  return { isValid: true };
}

function readExchangeRateRequest(formData: FormData): ExchangeRateRequest {
  const modeValue = formData.get("exchangeRateMode");
  const exchangeRateMode = modeValue === "manual" ? "manual" : "auto";
  const manualValue = formData.get("manualExchangeRateClpPerUsd");
  const manualExchangeRateClpPerUsd = typeof manualValue === "string" ? manualValue : undefined;
  const marginValue = formData.get("exchangeRateMarginClp");
  const exchangeRateMarginClp = typeof marginValue === "string" ? marginValue : undefined;

  return {
    exchangeRateMode,
    manualExchangeRateClpPerUsd,
    exchangeRateMarginClp
  };
}

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

function safeChoice(value: unknown) {
  const text = safeText(value);
  if (!text) return undefined;
  return normalizeText(text) === "no informado" ? undefined : text;
}

function parseBudget(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseSupplierEvaluations(value: unknown): SupplierEvaluationInput[] {
  if (!Array.isArray(value)) return [];
  const parsed: SupplierEvaluationInput[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const supplierName =
      safeText(record.supplierName) ?? safeText(record.supplier) ?? safeText(record.name);
    if (!supplierName) continue;

    parsed.push({
      supplierName,
      paymentCondition: safeText(record.paymentCondition) ?? safeText(record.paymentTerms),
      deliveryTime: safeText(record.deliveryTime),
      availability: safeText(record.availability),
      associatedCosts: safeText(record.associatedCosts) ?? safeText(record.shippingCost),
      creditStatus: safeChoice(record.creditStatus),
      providerEvaluation: safeChoice(record.providerEvaluation)
    });
  }

  return parsed;
}

function readAdditionalEvaluationData(formData: FormData): AdditionalEvaluationData | undefined {
  const raw = formData.get("additionalEvaluationData");
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const supplierEvaluations = parseSupplierEvaluations(parsed.supplierEvaluations);
    const additionalEvaluation: AdditionalEvaluationData = {
      awardCriteria: safeText(parsed.awardCriteria),
      awardResponsible: safeText(parsed.awardResponsible),
      buyerResponsible: safeText(parsed.buyerResponsible),
      urgency: safeChoice(parsed.urgency),
      budgetObjective: parseBudget(parsed.budgetObjective),
      supplierEvaluations
    };

    const hasContent =
      Boolean(additionalEvaluation.awardCriteria) ||
      Boolean(additionalEvaluation.awardResponsible) ||
      Boolean(additionalEvaluation.buyerResponsible) ||
      Boolean(additionalEvaluation.urgency) ||
      typeof additionalEvaluation.budgetObjective === "number" ||
      supplierEvaluations.length > 0;

    return hasContent ? additionalEvaluation : undefined;
  } catch {
    return undefined;
  }
}

function readAdditionalEvaluationDataFromN8n(
  raw: Record<string, unknown> | null | undefined
): AdditionalEvaluationData | undefined {
  if (!raw) return undefined;

  const primaryRows = parseSupplierEvaluations(raw.supplierEvaluations);
  const fallbackRows = parseSupplierEvaluations(raw.providerVariables);
  const supplierEvaluations = primaryRows.length > 0 ? primaryRows : fallbackRows;
  const additionalEvaluation: AdditionalEvaluationData = {
    awardCriteria: safeText(raw.awardCriteria) ?? safeText(raw.criterioAdjudicacion),
    awardResponsible: safeText(raw.awardResponsible) ?? safeText(raw.responsableAdjudicacion),
    buyerResponsible: safeText(raw.buyerResponsible) ?? safeText(raw.compradorResponsable),
    urgency: safeChoice(raw.urgency) ?? safeChoice(raw.gradoUrgencia),
    budgetObjective: parseBudget(raw.budgetObjective) ?? parseBudget(raw.presupuestoObjetivo),
    supplierEvaluations
  };

  const hasContent =
    Boolean(additionalEvaluation.awardCriteria) ||
    Boolean(additionalEvaluation.awardResponsible) ||
    Boolean(additionalEvaluation.buyerResponsible) ||
    Boolean(additionalEvaluation.urgency) ||
    typeof additionalEvaluation.budgetObjective === "number" ||
    supplierEvaluations.length > 0;

  return hasContent ? additionalEvaluation : undefined;
}

function mergeAdditionalEvaluationData(
  localData: AdditionalEvaluationData | undefined,
  n8nData: AdditionalEvaluationData | undefined
) {
  if (!localData) return n8nData;
  if (!n8nData) return localData;

  const localHasSupplierRows = localData.supplierEvaluations.some((row) =>
    Boolean(
      row.supplierName ||
        row.paymentCondition ||
        row.deliveryTime ||
        row.availability ||
        row.associatedCosts ||
        row.creditStatus ||
        row.providerEvaluation
    )
  );

  return {
    awardCriteria: localData.awardCriteria ?? n8nData.awardCriteria,
    awardResponsible: localData.awardResponsible ?? n8nData.awardResponsible,
    buyerResponsible: localData.buyerResponsible ?? n8nData.buyerResponsible,
    urgency: localData.urgency ?? n8nData.urgency,
    budgetObjective:
      typeof localData.budgetObjective === "number"
        ? localData.budgetObjective
        : n8nData.budgetObjective,
    supplierEvaluations: localHasSupplierRows
      ? localData.supplierEvaluations
      : n8nData.supplierEvaluations
  };
}

function kindLabel(kind: DocumentKind) {
  if (kind === "purchase_request") return "Solicitud OC / documento interno";
  if (kind === "order") return "Orden de compra";
  if (kind === "invoice") return "Factura";
  if (kind === "quote") return "Cotizacion";
  return "Desconocido";
}

function toDocumentDiagnostic(document: NormalizedN8nDocument): DocumentDiagnostic {
  return {
    filename: document.fileName,
    typeDetected: kindLabel(document.detectedType),
    status: document.status,
    reason: document.reason,
    missing: document.missing,
    action: document.action
  };
}

function userFacingWarnings(inputWarnings: string[]) {
  const mapped = inputWarnings
    .map((warning) => {
      const normalized = normalizeText(warning);
      if (normalized.includes("lista base") || normalized.includes("base provider")) return null;
      return warning.trim();
    })
    .filter((warning): warning is string => Boolean(warning));

  return [...new Set(mapped)];
}

function takeDocumentForFile(
  documents: NormalizedN8nDocument[],
  filename: string
): NormalizedN8nDocument | undefined {
  const target = fileNameKey(filename);
  const index = documents.findIndex((document) => fileNameKey(document.fileName) === target);
  if (index >= 0) {
    const [found] = documents.splice(index, 1);
    return found;
  }

  const unnamedIndex = documents.findIndex((document) => !safeText(document.fileName));
  if (unnamedIndex >= 0) {
    const [unnamed] = documents.splice(unnamedIndex, 1);
    return unnamed;
  }

  return documents.shift();
}

function createMissingDocumentDiagnostic(filename: string): DocumentDiagnostic {
  return {
    filename,
    typeDetected: "Desconocido",
    status: "omitted",
    reason: "No se recibio resultado del extractor n8n para este archivo.",
    missing: ["Respuesta valida de extraccion", "Tabla de productos extraida"],
    action: "Intenta nuevamente o contacta a TI para revisar el workflow de extraccion."
  };
}

async function createProcessingJob(originalFileCount: number) {
  return prisma.processingJob.create({
    data: {
      status: "processing",
      templateFilename: "template.xlsx",
      originalFileCount,
      warningsJson: "[]"
    }
  });
}

function n8nErrorResponse(error: N8nExtractorError) {
  if (error.code === "NOT_CONFIGURED") {
    return {
      statusCode: 500,
      message: error.message
    };
  }
  if (error.code === "AUTH") {
    return {
      statusCode: 502,
      message: "No se pudo autenticar con n8n. Revise la clave compartida entre Render y Azure."
    };
  }
  if (error.code === "TIMEOUT" || error.code === "NETWORK") {
    return {
      statusCode: 502,
      message: "No se pudo conectar con n8n. Revise que el workflow esté activo y que el webhook esté disponible."
    };
  }
  return {
    statusCode: 400,
    message: error.message || "No se encontraron cotizaciones validas."
  };
}

export async function POST(request: Request) {
  let jobId: string | undefined;
  const warnings: string[] = [];
  const diagnostics: DocumentDiagnostic[] = [];

  try {
    const formData = await request.formData();
    const quotes = formData.getAll("quotes").filter((file): file is File => file instanceof File);
    const exchangeRateRequest = readExchangeRateRequest(formData);
    const additionalEvaluation = readAdditionalEvaluationData(formData);

    if (
      exchangeRateRequest.exchangeRateMode === "manual" &&
      !parseExchangeRateValue(exchangeRateRequest.manualExchangeRateClpPerUsd)
    ) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: ["Tipo de cambio manual invalido."],
          documents: [],
          omittedFiles: [],
          message: "Tipo de cambio manual invalido.",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    await ensureStorageLayout();
    const officialTemplatePath = templateExcelPath();

    try {
      await access(officialTemplatePath);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: [
            "No se encontro la plantilla oficial en templates/template.xlsx o STORAGE_DIR/templates/template.xlsx"
          ],
          documents: [],
          omittedFiles: [],
          message:
            "No se encontro la plantilla oficial en templates/template.xlsx o STORAGE_DIR/templates/template.xlsx",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 500 }
      );
    }

    if (quotes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: ["Debes subir al menos una cotizacion en PDF."],
          documents: [],
          omittedFiles: [],
          message: "Debes subir al menos una cotizacion en PDF.",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    if (quotes.length > MAX_QUOTES) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: [`Maximo permitido: ${MAX_QUOTES} archivos.`],
          documents: [],
          omittedFiles: quotes.map((quote) => quote.name),
          message: `Maximo permitido: ${MAX_QUOTES} archivos.`,
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    const invalidPdfErrors: string[] = [];
    const omittedFiles: string[] = [];
    const totalUploadSize = quotes.reduce((sum, quote) => sum + quote.size, 0);

    for (const quote of quotes) {
      const pdfValidation = validatePdfOnly(quote);
      if (!pdfValidation.isValid) {
        invalidPdfErrors.push(pdfValidation.reason ?? "Solo se aceptan archivos PDF en esta version.");
        omittedFiles.push(quote.name);
      } else if (pdfValidation.warning) {
        warnings.push(pdfValidation.warning);
      }

      if (quote.size > MAX_PDF_FILE_SIZE_BYTES) {
        invalidPdfErrors.push(`El archivo ${quote.name} supera ${MAX_PDF_FILE_SIZE_MB} MB.`);
        omittedFiles.push(quote.name);
      }
    }

    if (totalUploadSize > MAX_TOTAL_UPLOAD_SIZE_BYTES) {
      invalidPdfErrors.push(
        `La carga total supera el máximo permitido de ${MAX_TOTAL_UPLOAD_SIZE_MB} MB. Sube menos PDFs o reduce el tamaño de los archivos.`
      );
      omittedFiles.push(...quotes.map((quote) => quote.name));
    }

    if (invalidPdfErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          message:
            totalUploadSize > MAX_TOTAL_UPLOAD_SIZE_BYTES
              ? `La carga total supera el máximo permitido de ${MAX_TOTAL_UPLOAD_SIZE_MB} MB. Sube menos PDFs o reduce el tamaño de los archivos.`
              : "Solo se aceptan archivos PDF en esta version.",
          errors: [...new Set(invalidPdfErrors)],
          warnings: userFacingWarnings(warnings),
          documents: [],
          omittedFiles: [...new Set(omittedFiles)],
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    const n8nDiagnostics = getN8nDiagnostics();
    console.info("[n8n] config", {
      webhookConfigured: n8nDiagnostics.n8nWebhookConfigured,
      apiKeyConfigured: n8nDiagnostics.n8nApiKeyConfigured,
      timeoutMs: n8nDiagnostics.n8nTimeoutMs,
      webhookHost: n8nDiagnostics.n8nWebhookHost
    });

    if (!n8nDiagnostics.n8nWebhookConfigured) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: [
            "Extractor n8n no configurado. Falta N8N_EXTRACT_WEBHOOK_URL en el entorno del servidor."
          ],
          documents: [],
          omittedFiles: quotes.map((quote) => quote.name),
          message:
            "Extractor n8n no configurado. Falta N8N_EXTRACT_WEBHOOK_URL en el entorno del servidor.",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 500 }
      );
    }

    if (!n8nDiagnostics.n8nApiKeyConfigured) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          errors: [
            "Extractor n8n no configurado. Falta N8N_EXTRACT_API_KEY en el entorno del servidor."
          ],
          documents: [],
          omittedFiles: quotes.map((quote) => quote.name),
          message:
            "Extractor n8n no configurado. Falta N8N_EXTRACT_API_KEY en el entorno del servidor.",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 500 }
      );
    }

    const job = await createProcessingJob(quotes.length);
    jobId = job.id;
    const activeJobId = job.id;
    await ensureJobDirectories(activeJobId);

    const templatePath = path.join(jobUploadDir(activeJobId), "template.xlsx");
    await copyFile(officialTemplatePath, templatePath);

    const uploadedQuotes: UploadedQuoteEntry[] = [];
    for (const quoteFile of quotes) {
      const filename = sanitizeFilename(quoteFile.name);
      const uploadedPath = path.join(jobPdfDir(activeJobId), filename);
      await saveUploadedFile(quoteFile, uploadedPath);

      const uploadedQuote = await prisma.uploadedQuote.create({
        data: {
          jobId: activeJobId,
          originalFilename: quoteFile.name,
          rawText: "",
          status: "processing"
        }
      });

      uploadedQuotes.push({ id: uploadedQuote.id, originalFilename: quoteFile.name });
    }

    const exchange = await getExchangeRate(exchangeRateRequest);
    const targetCurrency = process.env.TARGET_CURRENCY === "USD" ? "USD" : "CLP";
    console.info("[n8n] sending files", {
      filesCount: quotes.length,
      jobId: activeJobId,
      webhookHost: n8nDiagnostics.n8nWebhookHost
    });

    let n8nResponse;
    try {
      n8nResponse = await extractQuotesFromN8n({
        files: quotes,
        jobId: activeJobId,
        exchangeRateMode: exchangeRateRequest.exchangeRateMode === "manual" ? "manual" : "auto",
        exchangeRateBase: exchange.baseRate,
        exchangeRateMarginClp: exchange.margin,
        exchangeRateFinal: exchange.finalRate,
        targetCurrency,
        evaluationData: additionalEvaluation
      });
    } catch (error) {
      const normalizedError =
        error instanceof N8nExtractorError
          ? error
          : new N8nExtractorError(
              "NETWORK",
              "No se pudo conectar con n8n. Revise que el workflow esté activo y que el webhook esté disponible."
            );
      const errorPayload = n8nErrorResponse(normalizedError);
      const userMessage =
        normalizedError.code === "EXTRACT_FAILED"
          ? "No se pudo extraer la cotizacion desde n8n."
          : errorPayload.message;

      await prisma.processingJob.update({
        where: { id: activeJobId },
        data: {
          status: "error",
          warningsJson: JSON.stringify(
            userFacingWarnings([...warnings, normalizedError.message])
          )
        }
      });

      await prisma.uploadedQuote.updateMany({
        where: { jobId: activeJobId, status: "processing" },
        data: {
          status: "error",
          errorMessage: normalizedError.message
        }
      });

      return NextResponse.json(
        {
          jobId: activeJobId,
          ok: false,
          status: "error",
          errors: [userMessage],
          documents: [],
          omittedFiles: quotes.map((quote) => quote.name),
          message: userMessage,
          warnings: userFacingWarnings([...warnings, normalizedError.message]),
          documentDiagnostics: diagnostics
        },
        { status: errorPayload.statusCode }
      );
    }

    const mapped = mapN8nDocumentsToQuotes(n8nResponse);
    warnings.push(...mapped.warnings, ...n8nResponse.errors);
    const pendingDocuments = [...mapped.documentResults];
    const parsedQuotes: ParsedQuote[] = [];
    let omittedInvalidCount = 0;

    for (const uploaded of uploadedQuotes) {
      const document = takeDocumentForFile(pendingDocuments, uploaded.originalFilename);
      if (!document) {
        omittedInvalidCount += 1;
        const diagnostic = createMissingDocumentDiagnostic(uploaded.originalFilename);
        diagnostics.push(diagnostic);
        warnings.push(`Se omitio ${uploaded.originalFilename}: ${diagnostic.reason}`);
        await prisma.uploadedQuote.update({
          where: { id: uploaded.id },
          data: {
            status: "partial_error",
            errorMessage: diagnostic.reason
          }
        });
        continue;
      }

      diagnostics.push(toDocumentDiagnostic(document));
      warnings.push(...document.warnings);

      if (document.status === "processed" && document.parsedQuote) {
        parsedQuotes.push(document.parsedQuote);

        const rawText = document.parsedQuote.items
          .map((item) => item.rawLine ?? item.rawBlock ?? item.description)
          .filter(Boolean)
          .join("\n");

        await prisma.uploadedQuote.update({
          where: { id: uploaded.id },
          data: {
            supplierName: document.parsedQuote.supplierName,
            quoteNumber: document.parsedQuote.quoteNumber,
            quoteDate: parseQuoteDate(document.parsedQuote.quoteDate),
            rawText,
            parsedJson: JSON.stringify(document.parsedQuote),
            status: "completed"
          }
        });

        if (document.parsedQuote.items.length > 0) {
          await prisma.extractedItem.createMany({
            data: document.parsedQuote.items.map((item) => ({
              quoteId: uploaded.id,
              sourceItem: item.sourceItem === undefined ? null : String(item.sourceItem),
              description: item.description,
              normalizedProductKey: item.normalizedProductKey,
              quantity: item.quantity,
              unit: item.unit,
              currency: item.currency,
              unitPrice: item.unitPrice,
              total: item.total,
              confidence: item.confidence
            }))
          });
        }
      } else {
        omittedInvalidCount += 1;
        warnings.push(`Se omitio ${uploaded.originalFilename}: ${document.reason}`);
        await prisma.uploadedQuote.update({
          where: { id: uploaded.id },
          data: {
            supplierName: document.parsedQuote?.supplierName,
            quoteNumber: document.parsedQuote?.quoteNumber,
            quoteDate: parseQuoteDate(document.parsedQuote?.quoteDate),
            rawText: "",
            parsedJson: document.parsedQuote ? JSON.stringify(document.parsedQuote) : null,
            status: "partial_error",
            errorMessage: document.reason
          }
        });
      }
    }

    for (const document of pendingDocuments) {
      warnings.push(
        `El extractor n8n devolvio un documento no asociado a un archivo subido: ${document.fileName}.`
      );
    }

    if (parsedQuotes.length === 0) {
      const friendlyMessage = "No se encontraron cotizaciones validas";
      await prisma.processingJob.update({
        where: { id: activeJobId },
        data: {
          status: "error",
          warningsJson: JSON.stringify(userFacingWarnings(warnings))
        }
      });

      return NextResponse.json(
        {
          jobId: activeJobId,
          ok: false,
          status: "error",
          errors: ["No se encontraron cotizaciones validas."],
          documents: [],
          omittedFiles: quotes.map((quote) => quote.name),
          message:
            "Los archivos enviados no corresponden a cotizaciones de proveedores o no contienen una tabla reconocible de productos, cantidades, precios y moneda.",
          title: friendlyMessage,
          warnings: userFacingWarnings(warnings),
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    const mergedAdditionalEvaluation = mergeAdditionalEvaluationData(
      additionalEvaluation,
      readAdditionalEvaluationDataFromN8n(n8nResponse.evaluationData)
    );
    const consolidated = await consolidateQuotes(parsedQuotes, exchangeRateRequest, {
      exchangeRate: exchange
    });
    const generated = await generateComparisonExcel(templatePath, consolidated, activeJobId, {
      additionalEvaluation: mergedAdditionalEvaluation,
      omittedFilesCount: omittedInvalidCount > 0 ? omittedInvalidCount : undefined,
    });
    const allWarnings = userFacingWarnings([...new Set([...warnings, ...generated.warnings])]);
    const analytics = buildPurchaseAnalytics(consolidated, allWarnings.length);

    if (omittedInvalidCount > 0) {
      allWarnings.push(
        `Se genero la tabla con ${parsedQuotes.length} cotizacion${parsedQuotes.length > 1 ? "es" : ""} valida${
          parsedQuotes.length > 1 ? "s" : ""
        }. Se omitio ${omittedInvalidCount} archivo${omittedInvalidCount > 1 ? "s" : ""} porque no parecia${
          omittedInvalidCount > 1 ? "n" : ""
        } cotizacion de proveedor.`
      );
    }

    for (const item of consolidated.comparison) {
      await prisma.comparisonItem.create({
        data: {
          jobId: activeJobId,
          itemNumber: item.item,
          productName: item.product,
          quantity: item.quantity,
          unit: item.unit,
          matchingWarningsJson: JSON.stringify(item.matchingWarnings),
          supplierOffers: {
            create: Object.entries(item.offers).map(([supplierName, offer]) => ({
              supplierName,
              currency: offer.currency,
              unitPrice: offer.unitPrice,
              total: offer.total,
              confidence: offer.confidence
            }))
          }
        }
      });
    }

    await prisma.processingJob.update({
      where: { id: activeJobId },
      data: {
        status: "completed",
        outputExcelPath: generated.outputPath,
        warningsJson: JSON.stringify(allWarnings)
      }
    });

    return NextResponse.json({
      jobId: activeJobId,
      ok: true,
      status: "completed",
      suppliers: consolidated.suppliers.map((supplier) => supplier.name),
      itemsDetected:
        consolidated.cascadeBlocks && consolidated.cascadeBlocks.length > 0
          ? consolidated.cascadeBlocks.reduce((sum, block) => sum + block.items.length, 0)
          : consolidated.comparison.length,
      warnings: allWarnings,
      downloadUrl: `/api/download/${activeJobId}`,
      analytics,
      budgetObjective: mergedAdditionalEvaluation?.budgetObjective ?? null,
      documentDiagnostics: diagnostics,
      documents: mapped.documentResults
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    if (jobId) {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: "error",
          warningsJson: JSON.stringify(userFacingWarnings(warnings))
        }
      });
    }

    return NextResponse.json(
      {
        jobId,
        ok: false,
        status: "error",
        errors: ["Ocurrio un problema al procesar los archivos."],
        documents: [],
        omittedFiles: [],
        message: "Ocurrio un problema al procesar los archivos. Intenta nuevamente con cotizaciones legibles.",
        technicalMessage: message,
        warnings: userFacingWarnings(warnings),
        documentDiagnostics: diagnostics
      },
      { status: 500 }
    );
  }
}
