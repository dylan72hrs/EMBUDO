import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { applyFolioToGeneratedExcel } from "@/lib/excel/generateComparisonExcel";
import { ensureStorageLayout, outputExcelPath } from "@/lib/utils/fileStorage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

async function assignFolioIfNeeded(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const currentJob = await tx.processingJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, folio: true, outputExcelPath: true }
    });

    if (!currentJob || currentJob.status !== "completed") {
      return null;
    }

    if (currentJob.folio) {
      return currentJob;
    }

    const year = new Date().getFullYear();
    const sequence = await tx.comparisonSequence.upsert({
      where: { year },
      update: { current: { increment: 1 } },
      create: { year, current: 1 }
    });

    const folio = `TC-MD-${year}-${String(sequence.current).padStart(6, "0")}`;
    return tx.processingJob.update({
      where: { id: jobId },
      data: { folio },
      select: { id: true, status: true, folio: true, outputExcelPath: true }
    });
  });
}

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const confirmIssue = new URL(request.url).searchParams.get("confirmIssue") === "true";

  if (!confirmIssue) {
    return NextResponse.json(
      { message: "Debe confirmar la emision antes de descargar." },
      { status: 400 }
    );
  }

  await ensureStorageLayout();
  const job = await assignFolioIfNeeded(jobId);

  if (!job || job.status !== "completed") {
    return NextResponse.json({ message: "Archivo no disponible." }, { status: 404 });
  }

  if (job.folio) {
    await applyFolioToGeneratedExcel(job.outputExcelPath ?? outputExcelPath(jobId), job.folio);
  }

  const file = await readFile(job.outputExcelPath ?? outputExcelPath(jobId));
  const safeFolio = job.folio ? job.folio.replace(/[^\w\-]/g, "_") : null;
  const filename = safeFolio ? `tabla-comparativa-${safeFolio}.xlsx` : "tabla-comparativa.xlsx";

  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Document-Folio": job.folio ?? "",
      "Cache-Control": "no-store"
    }
  });
}
