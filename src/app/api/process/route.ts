import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { extractTextFromPdf } from "@/lib/pdf/extractTextFromPdf";
import { parseQuoteFromText } from "@/lib/parser/parseQuoteFromText";
import { consolidateQuotes } from "@/lib/normalize/consolidateQuotes";
import { generateComparisonExcel } from "@/lib/excel/generateComparisonExcel";
import { parseExchangeRateValue, type ExchangeRateRequest } from "@/lib/currency/getExchangeRate";
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

export async function POST(request: Request) {
  let jobId: string | undefined;
  const warnings: string[] = [];

  try {
    const formData = await request.formData();
    const quotes = formData.getAll("quotes").filter((file): file is File => file instanceof File);
    const exchangeRateRequest = readExchangeRateRequest(formData);

    if (
      exchangeRateRequest.exchangeRateMode === "manual" &&
      !parseExchangeRateValue(exchangeRateRequest.manualExchangeRateClpPerUsd)
    ) {
      return NextResponse.json(
        { status: "error", message: "Tipo de cambio manual inválido.", warnings },
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
          message: "No se encontró la plantilla oficial en templates/template.xlsx o STORAGE_DIR/templates/template.xlsx",
          warnings
        },
        { status: 500 }
      );
    }

    if (quotes.length === 0) {
      return NextResponse.json(
        { status: "error", message: "Debes subir al menos una cotización PDF.", warnings },
        { status: 400 }
      );
    }

    if (quotes.length > MAX_PDFS) {
      return NextResponse.json(
        { status: "error", message: `Máximo permitido: ${MAX_PDFS} PDFs.`, warnings },
        { status: 400 }
      );
    }

    for (const quote of quotes) {
      if (!isPdf(quote)) {
        return NextResponse.json(
          { status: "error", message: `El archivo ${quote.name} no es PDF.`, warnings },
          { status: 400 }
        );
      }
      if (quote.size > MAX_PDF_SIZE) {
        return NextResponse.json(
          { status: "error", message: `El archivo ${quote.name} supera 20 MB.`, warnings },
          { status: 400 }
        );
      }
    }

    const job = await prisma.processingJob.create({
      data: {
        status: "processing",
        templateFilename: "template.xlsx",
        originalFileCount: quotes.length,
        warningsJson: "[]"
      }
    });

    jobId = job.id;
    const activeJobId = job.id;
    await ensureJobDirectories(activeJobId);

    const templatePath = path.join(jobUploadDir(activeJobId), "template.xlsx");
    await copyFile(officialTemplatePath, templatePath);

    const parsedQuotes: ParsedQuote[] = [];

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
        const pdfWarnings = [...parsed.warnings];

        if (parsed.items.length === 0) {
          pdfWarnings.push(`${quoteFile.name}: PDF sin productos válidos; se omite de la comparación.`);
          warnings.push(...pdfWarnings);

          await prisma.uploadedQuote.update({
            where: { id: uploadedQuote.id },
            data: {
              supplierName: parsed.supplierName,
              quoteNumber: parsed.quoteNumber,
              quoteDate: parseQuoteDate(parsed.quoteDate),
              rawText,
              parsedJson: JSON.stringify(parsed),
              status: "partial_error",
              errorMessage: "PDF sin productos válidos."
            }
          });

          continue;
        }

        parsedQuotes.push(parsed);

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

        if (pdfWarnings.length > 0) warnings.push(...pdfWarnings);

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
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido al procesar PDF.";
        warnings.push(`${quoteFile.name}: ${message}`);
        await prisma.uploadedQuote.update({
          where: { id: uploadedQuote.id },
          data: {
            status: "error",
            errorMessage: message
          }
        });
      }
    }

    if (parsedQuotes.length === 0) {
      throw new Error("No se pudo procesar ninguna cotización PDF.");
    }

    const consolidated = await consolidateQuotes(parsedQuotes, exchangeRateRequest);
    const generated = await generateComparisonExcel(templatePath, consolidated, activeJobId);
    const allWarnings = [...new Set([...warnings, ...generated.warnings])];

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
      status: "completed",
      suppliers: consolidated.suppliers.map((supplier) => supplier.name),
      itemsDetected: consolidated.comparison.length,
      warnings: allWarnings,
      downloadUrl: `/api/download/${activeJobId}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    if (jobId) {
      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: "error",
          warningsJson: JSON.stringify(warnings)
        }
      });
    }

    return NextResponse.json(
      {
        jobId,
        status: "error",
        message,
        warnings
      },
      { status: 500 }
    );
  }
}
