import { NextResponse } from "next/server";
import { getExchangeRate } from "@/lib/currency/getExchangeRate";

export const runtime = "nodejs";

const BANCENTRAL_URL =
  "https://si3.bcentral.cl/Indicadoressiete/secure/Indicadoresdiarios.aspx";

function exchangeRateRequestFromUrl(url: string) {
  const searchParams = new URL(url).searchParams;
  const modeParam = searchParams.get("mode");
  const exchangeRateMode = modeParam === "manual" ? "manual" : "auto";
  const manualExchangeRateClpPerUsd = searchParams.get("manualExchangeRateClpPerUsd");
  return {
    exchangeRateMode,
    manualExchangeRateClpPerUsd
  } as const;
}

export async function GET(request: Request) {
  try {
    const rateRequest = exchangeRateRequestFromUrl(request.url);
    const rate = await getExchangeRate(rateRequest);

    return NextResponse.json({
      status: "ok",
      provider: "Banco Central",
      sourceUrl: BANCENTRAL_URL,
      baseRate: rate.baseRate,
      margin: rate.margin,
      finalRate: rate.finalRate,
      mode: rate.mode,
      warnings: rate.warnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo obtener el tipo de cambio.";
    return NextResponse.json(
      {
        status: "error",
        message,
        provider: "Banco Central",
        sourceUrl: BANCENTRAL_URL
      },
      { status: 400 }
    );
  }
}
