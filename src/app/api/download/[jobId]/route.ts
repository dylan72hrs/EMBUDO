import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { ensureStorageLayout, outputExcelPath } from "@/lib/utils/fileStorage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  await ensureStorageLayout();
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });

  if (!job || job.status !== "completed") {
    return NextResponse.json({ message: "Archivo no disponible." }, { status: 404 });
  }

  const file = await readFile(job.outputExcelPath ?? outputExcelPath(jobId));

  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="tabla-comparativa.xlsx"',
      "Cache-Control": "no-store"
    }
  });
}
