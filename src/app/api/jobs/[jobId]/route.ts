import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

type UploadedQuoteSummary = {
  originalFilename: string;
  supplierName: string | null;
  status: string;
  errorMessage: string | null;
};

type ComparisonItemSummary = {
  itemNumber: number;
  productName: string;
  quantity: number;
  unit: string;
  supplierOffers: unknown[];
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
    include: {
      uploadedQuotes: true,
      comparisonItems: {
        include: {
          supplierOffers: true
        },
        orderBy: {
          itemNumber: "asc"
        }
      }
    }
  });

  if (!job) {
    return NextResponse.json({ message: "Job no encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    templateFilename: job.templateFilename,
    originalFileCount: job.originalFileCount,
    warnings: JSON.parse(job.warningsJson || "[]") as string[],
    uploadedQuotes: job.uploadedQuotes.map((quote: UploadedQuoteSummary) => ({
      originalFilename: quote.originalFilename,
      supplierName: quote.supplierName,
      status: quote.status,
      errorMessage: quote.errorMessage
    })),
    comparisonItems: job.comparisonItems.map((item: ComparisonItemSummary) => ({
      item: item.itemNumber,
      product: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      offers: item.supplierOffers
    })),
    downloadUrl: job.outputExcelPath ? `/api/download/${job.id}` : null
  });
}
