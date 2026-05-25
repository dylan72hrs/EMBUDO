import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import { parseQuoteFromText } from "../src/lib/parser/parseQuoteFromText";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const prisaSample = `PROVEEDORES INTEGRALES PRISA S.A.
COTIZACION 33098215
Codigo Descripcion UND Cantidad Precio Unitario Total
91703 ENDULZANTE IANSA CERO K STEVIA SENS 250 ML LIQUIDA UND 1 $2.911 $2.911
89289 CAFE INST. NESCAFE FIN/SELECC.200 GR LIOFI/FCO VI UND 3 $11.722 $35.166
Total Neto $38.077
IVA $7.235
Total $45.312`;

const dimercSample = `DIMERC cotizacion_11871712
Codigo Descripcion UNI Cantidad Precio Unitario Total
559247 AZUCAR RUBIA BOLSA 1 KG IANSA UNI 1 $ 3.867 $ 3.867
508297 CAFE INSTANTANEO TRADICION FINA SELECCION 200 GR NESCAFE UNI 3 $ 12.417 $ 37.251
Cobro Logistico $ 3.500
Total Neto $ 44.618
IVA $ 8.477
Total $ 53.095`;

function assertParsedSample(name: string, text: string, expectedUnitPrice: number, expectedTotal: number) {
  const parsed = parseQuoteFromText(text, `${name}.pdf`);
  const cafe = parsed.items.find((item) => /cafe/i.test(item.description));

  assert(cafe, `${name}: no se extrajo cafe`);
  assert(parsed.items.every((item) => item.rawLine), `${name}: hay productos sin rawLine`);
  assert(cafe.quantity === 3, `${name}: cantidad de cafe incorrecta`);
  assert(cafe.currency === "CLP", `${name}: moneda de cafe incorrecta`);
  assert(cafe.unitPrice === expectedUnitPrice, `${name}: precio unitario de cafe incorrecto`);
  assert(cafe.total === expectedTotal, `${name}: total de cafe incorrecto`);
  assert(
    !parsed.items.some((item) => /iva|total neto|cobro logistico/i.test(item.description)),
    `${name}: una linea de resumen/logistica fue tomada como producto`
  );

  return parsed;
}

async function main() {
  const prisa = assertParsedSample("PRISA", prisaSample, 11722, 35166);
  const dimerc = assertParsedSample("Dimerc", dimercSample, 12417, 37251);
  assert(dimerc.warnings.some((warning) => /Costo asociado/i.test(warning)), "Dimerc: falta warning de costo asociado");

  const comparison = await consolidateQuotes([prisa, dimerc], {
    exchangeRateMode: "manual",
    manualExchangeRateClpPerUsd: 900
  });
  const cafe = comparison.comparison.find((item) => /cafe/i.test(item.product));

  assert(cafe?.offers.PRISA, "Comparacion: falta oferta PRISA para cafe");
  assert(cafe?.offers.Dimerc, "Comparacion: falta oferta Dimerc para cafe");
  assert(cafe.offers.PRISA.total === 35166, "Comparacion: total PRISA incorrecto");
  assert(cafe.offers.Dimerc.total === 37251, "Comparacion: total Dimerc incorrecto");

  console.log("Parser generico OK: PRISA, Dimerc, costos asociados y comparacion CLP validados.");
}

void main();
