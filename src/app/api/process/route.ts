import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { extractTextFromPdf } from "@/lib/pdf/extractTextFromPdf";
import { parseQuoteFromText } from "@/lib/parser/parseQuoteFromText";
import { consolidateQuotes } from "@/lib/normalize/consolidateQuotes";
import {
  generateComparisonExcel,
  type AdditionalEvaluationData,
  type SupplierEvaluationInput
} from "@/lib/excel/generateComparisonExcel";
import { parseExchangeRateValue, type ExchangeRateRequest } from "@/lib/currency/getExchangeRate";
import { buildPurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";
import {
  ensureJobDirectories,
  ensureStorageLayout,
  jobPdfDir,
  jobUploadDir,
  saveUploadedFile,
  sanitizeFilename,
  templateExcelPath
} from "@/lib/utils/fileStorage";
import type { ParsedQuote } from "@/lib/validations/quoteSchemas";

export const runtime = "nodejs";

const MAX_PDFS = 20;
const MAX_PDF_SIZE = 20 * 1024 * 1024;

type DocumentKind = "quote" | "purchase_request" | "order" | "invoice" | "unknown";

type DocumentDiagnostic = {
  filename: string;
  typeDetected: string;
  status: "processed" | "omitted";
  reason: string;
  missing: string[];
  action: string;
};

function isPdf(file: File) {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

function parseQuoteDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readExchangeRateRequest(formData: FormData): ExchangeRateRequest {
  const modeValue = formData.get("exchangeRateMode");
  const exchangeRateMode = modeValue === "manual" ? "manual" : "auto";
  const manualValue = formData.get("manualExchangeRateClpPerUsd");
  const manualExchangeRateClpPerUsd = typeof manualValue === "string" ? manualValue : undefined;

  return {
    exchangeRateMode,
    manualExchangeRateClpPerUsd
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function classifyUploadedDocument(text: string): DocumentKind {
  const normalized = normalizeText(text);
  const hasQuoteSignals =
    /(cotizacion|cotizaci[oó]n|propuesta comercial|presupuesto)/i.test(text) &&
    /(cantidad|cant\.|unitario|precio unitario|total|descripcion|descripci[oó]n)/i.test(text);
  const hasCurrencySignals = /(us\$|usd|clp|\$)/i.test(text);

  if (hasQuoteSignals && hasCurrencySignals) return "quote";

  const looksPurchaseRequest =
    /(solicitud orden de compra|solicitud oc|orden de compra|servicio: arriendo|sub total|iva|total clp)/i.test(
      normalized
    );
  if (looksPurchaseRequest) return "purchase_request";

  if (/(orden de compra|purchase order|oc nro|oc n[°o])/i.test(normalized)) return "order";
  if (/(factura|folio|sii|documento tributario)/i.test(normalized)) return "invoice";

  return "unknown";
}

function kindLabel(kind: DocumentKind) {
  if (kind === "purchase_request") return "Solicitud OC / documento interno";
  if (kind === "order") return "Orden de compra";
  if (kind === "invoice") return "Factura";
  if (kind === "quote") return "Cotizacion";
  return "Desconocido";
}

function invalidDocumentReason(kind: DocumentKind, looksLikeQuote: boolean) {
  if (looksLikeQuote) {
    return "El archivo parece una cotizacion, pero no se pudo leer correctamente la tabla de productos.";
  }
  if (kind === "purchase_request") {
    return "El documento contiene una solicitud de compra con valores internos, pero no una cotizacion de proveedor con estructura comparable.";
  }
  if (kind === "invoice") {
    return "El documento corresponde a una factura y no a una cotizacion de proveedor para comparar ofertas.";
  }
  if (kind === "order") {
    return "El documento corresponde a una orden de compra y no a una cotizacion de proveedor.";
  }
  return "No se detecto una estructura clara de cotizacion con productos, cantidades, precios unitarios, totales y moneda.";
}

function userFacingWarnings(inputWarnings: string[]) {
  const mapped = inputWarnings.map((warning) => {
    const normalized = normalizeText(warning);
    if (normalized.includes("no se detectaron lineas de productos")) {
      return "Se omitio un archivo porque no fue posible leer una tabla de productos valida.";
    }
    if (normalized.includes("no se pudo detectar moneda")) {
      return "Se omitio un archivo porque no fue posible identificar una moneda util para comparar.";
    }
    if (normalized.includes("revisar parser")) {
      return "Se omitio un archivo porque no se pudo interpretar como cotizacion valida.";
    }
    return warning;
  });

  return [...new Set(mapped)];
}

function buildInvalidDiagnostic(filename: string, kind: DocumentKind, looksLikeQuote: boolean): DocumentDiagnostic {
  return {
    filename,
    typeDetected: kindLabel(kind),
    status: "omitted",
    reason: invalidDocumentReason(kind, looksLikeQuote),
    missing: [
      "Proveedor cotizante identificable",
      "Productos con cantidad",
      "Precio unitario",
      "Total por item",
      "Moneda reconocible"
    ],
    action: looksLikeQuote
      ? "Revisa que el PDF no sea una imagen escaneada y que la tabla tenga productos, cantidades y precios visibles."
      : "Sube una cotizacion formal de proveedor (por ejemplo ADIS, Echave Turri o Tecno Mercado)."
  };
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
    const supplierName = safeText(record.supplierName);
    if (!supplierName) continue;

    parsed.push({
      supplierName,
      paymentCondition: safeText(record.paymentCondition),
      deliveryTime: safeText(record.deliveryTime),
      availability: safeText(record.availability),
      associatedCosts: safeText(record.associatedCosts),
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

async function createJobWithFolio(originalFileCount: number) {
  const year = new Date().getFullYear();

  return prisma.$transaction(async (tx) => {
    const sequence = await tx.comparisonSequence.upsert({
      where: { year },
      update: { current: { increment: 1 } },
      create: { year, current: 1 }
    });

    const folio = `TC-MD-${year}-${String(sequence.current).padStart(6, "0")}`;
    const job = await tx.processingJob.create({
      data: {
        folio,
        status: "processing",
        templateFilename: "template.xlsx",
        originalFileCount,
        warningsJson: "[]"
      }
    });

    return { job, folio };
  });
}

export async function POST(request: Request) {
  let jobId: string | undefined;
  let folio: string | undefined;
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
          status: "error",
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
          status: "error",
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
          status: "error",
          message: "Debes subir al menos una cotizacion PDF.",
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    if (quotes.length > MAX_PDFS) {
      return NextResponse.json(
        {
          status: "error",
          message: `Maximo permitido: ${MAX_PDFS} PDFs.`,
          warnings,
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    for (const quote of quotes) {
      if (!isPdf(quote)) {
        return NextResponse.json(
          {
            status: "error",
            message: `El archivo ${quote.name} no es PDF.`,
            warnings,
            documentDiagnostics: diagnostics
          },
          { status: 400 }
        );
      }
      if (quote.size > MAX_PDF_SIZE) {
        return NextResponse.json(
          {
            status: "error",
            message: `El archivo ${quote.name} supera 20 MB.`,
            warnings,
            documentDiagnostics: diagnostics
          },
          { status: 400 }
        );
      }
    }

    const created = await createJobWithFolio(quotes.length);
    jobId = created.job.id;
    folio = created.folio;
    const activeJobId = created.job.id;
    await ensureJobDirectories(activeJobId);

    const templatePath = path.join(jobUploadDir(activeJobId), "template.xlsx");
    await copyFile(officialTemplatePath, templatePath);

    const parsedQuotes: ParsedQuote[] = [];
    let omittedInvalidCount = 0;

    for (const quoteFile of quotes) {
      const filename = sanitizeFilename(quoteFile.name);
      const pdfPath = path.join(jobPdfDir(activeJobId), filename);
      await saveUploadedFile(quoteFile, pdfPath);

      const uploadedQuote = await prisma.uploadedQuote.create({
        data: {
          jobId: activeJobId,
          originalFilename: quoteFile.name,
          rawText: "",
          status: "processing"
        }
      });

      try {
        const rawText = await extractTextFromPdf(pdfPath);
        const parsed = parseQuoteFromText(rawText, quoteFile.name);
        const kind = classifyUploadedDocument(rawText);
        const looksLikeQuote = kind === "quote" || /cotiz/i.test(rawText);

        if (parsed.items.length === 0) {
          omittedInvalidCount += 1;
          diagnostics.push(buildInvalidDiagnostic(quoteFile.name, kind, looksLikeQuote));
          warnings.push(`Se omitio ${quoteFile.name}: este archivo no parece ser una cotizacion valida.`);

          await prisma.uploadedQuote.update({
            where: { id: uploadedQuote.id },
            data: {
              supplierName: parsed.supplierName,
              quoteNumber: parsed.quoteNumber,
              quoteDate: parseQuoteDate(parsed.quoteDate),
              rawText,
              parsedJson: JSON.stringify(parsed),
              status: "partial_error",
              errorMessage: "Archivo omitido: no parece cotizacion valida."
            }
          });

          continue;
        }

        parsedQuotes.push(parsed);
        diagnostics.push({
          filename: quoteFile.name,
          typeDetected: "Cotizacion",
          status: "processed",
          reason: "Cotizacion valida procesada correctamente.",
          missing: [],
          action: "Sin accion requerida."
        });

        await prisma.uploadedQuote.update({
          where: { id: uploadedQuote.id },
          data: {
            supplierName: parsed.supplierName,
            quoteNumber: parsed.quoteNumber,
            quoteDate: parseQuoteDate(parsed.quoteDate),
            rawText,
            parsedJson: JSON.stringify(parsed),
            status: "completed"
          }
        });

        if (parsed.warnings.length > 0) warnings.push(...parsed.warnings);

        if (parsed.items.length > 0) {
          await prisma.extractedItem.createMany({
            data: parsed.items.map((item) => ({
              quoteId: uploadedQuote.id,
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
      } catch {
        omittedInvalidCount += 1;
        diagnostics.push({
          filename: quoteFile.name,
          typeDetected: "Desconocido",
          status: "omitted",
          reason:
            "El archivo no pudo leerse correctamente como cotizacion. Puede estar escaneado como imagen o sin texto util.",
          missing: [
            "Texto legible en PDF",
            "Tabla de productos con cantidad y precios",
            "Moneda reconocible"
          ],
          action: "Sube una cotizacion de proveedor con texto seleccionable y tabla visible."
        });
        warnings.push(`Se omitio ${quoteFile.name}: no fue posible interpretarlo como cotizacion valida.`);
        await prisma.uploadedQuote.update({
          where: { id: uploadedQuote.id },
          data: {
            status: "error",
            errorMessage: "Archivo omitido por formato no compatible."
          }
        });
      }
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
          folio,
          status: "error",
          message:
            "Los archivos enviados no corresponden a cotizaciones de proveedores o no contienen una tabla reconocible de productos, cantidades, precios y moneda.",
          title: friendlyMessage,
          warnings: userFacingWarnings(warnings),
          documentDiagnostics: diagnostics
        },
        { status: 400 }
      );
    }

    const consolidated = await consolidateQuotes(parsedQuotes, exchangeRateRequest);
    const generated = await generateComparisonExcel(templatePath, consolidated, activeJobId, {
      folio,
      additionalEvaluation
    });
    const allWarnings = userFacingWarnings([...new Set([...warnings, ...generated.warnings])]);
    const analytics = buildPurchaseAnalytics(consolidated, allWarnings.length);

    if (omittedInvalidCount > 0) {
      allWarnings.push(
        `Se genero la tabla con ${parsedQuotes.length} cotizacion${parsedQuotes.length > 1 ? "es" : ""} valida${parsedQuotes.length > 1 ? "s" : ""}. Se omitio ${omittedInvalidCount} archivo${omittedInvalidCount > 1 ? "s" : ""} porque no parecia${omittedInvalidCount > 1 ? "n" : ""} cotizacion de proveedor.`
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
      folio,
      status: "completed",
      suppliers: consolidated.suppliers.map((supplier) => supplier.name),
      itemsDetected: consolidated.comparison.length,
      warnings: allWarnings,
      downloadUrl: `/api/download/${activeJobId}`,
      analytics,
      budgetObjective: additionalEvaluation?.budgetObjective ?? null,
      documentDiagnostics: diagnostics
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
        folio,
        status: "error",
        message: "Ocurrio un problema al procesar los archivos. Intenta nuevamente con cotizaciones legibles.",
        technicalMessage: message,
        warnings: userFacingWarnings(warnings),
        documentDiagnostics: diagnostics
      },
      { status: 500 }
    );
  }
}
