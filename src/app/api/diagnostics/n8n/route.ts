import { NextResponse } from "next/server";
import { getN8nDiagnostics } from "@/lib/n8n/extractQuotesFromN8n";
import { MAX_PDF_FILE_SIZE_MB, MAX_TOTAL_UPLOAD_SIZE_MB } from "@/lib/uploadLimits";

export const runtime = "nodejs";

export async function GET() {
  const diagnostics = getN8nDiagnostics();

  return NextResponse.json({
    ...diagnostics,
    maxPdfFileSizeMb: MAX_PDF_FILE_SIZE_MB,
    maxTotalUploadSizeMb: MAX_TOTAL_UPLOAD_SIZE_MB
  });
}
