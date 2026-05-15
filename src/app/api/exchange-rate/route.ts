import { NextResponse } from "next/server";
import { getExchangeRate, parseExchangeRateValue, type ExchangeRateRequest } from "@/lib/currency/getExchangeRate";

export const runtime = "nodejs";

function readExchangeRateRequest(url: URL): ExchangeRateRequest {
  const modeParam = url.searchParams.get("mode");
  const exchangeRateMode = modeParam === "manual" ? "manual" : "auto";
  const manualParam = url.searchParams.get("manualExchangeRateClpPerUsd");

  return {
    exchangeRateMode,
    manualExchangeRateClpPerUsd: manualParam
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exchangeRateRequest = readExchangeRateRequest(url);

  if (
    exchangeRateRequest.exchangeRateMode === "manual" &&
    !parseExchangeRateValue(exchangeRateRequest.manualExchangeRateClpPerUsd)
  ) {
    return NextResponse.json(
      {
        status: "error",
        message: "Tipo de cambio manual invalido."
      },
      { status: 400 }
    );
  }

  const exchangeRate = await getExchangeRate(exchangeRateRequest);
  const warning = exchangeRate.warnings.find((item) =>
    item.toLowerCase().includes("no se pudo obtener dolar observado")
  );

  return NextResponse.json({
    baseRate: exchangeRate.baseRate,
    margin: exchangeRate.margin,
    finalRate: exchangeRate.finalRate,
    source: exchangeRate.source,
    mode: exchangeRate.mode,
    date: exchangeRate.date,
    warning,
    warnings: exchangeRate.warnings
  });
}
