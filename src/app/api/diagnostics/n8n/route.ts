import { NextResponse } from "next/server";
import { getN8nDiagnostics } from "@/lib/n8n/extractQuotesFromN8n";

export const runtime = "nodejs";

export async function GET() {
  const diagnostics = getN8nDiagnostics();

  return NextResponse.json(diagnostics);
}
