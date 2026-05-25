import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import { parseQuoteFromText } from "../src/lib/parser/parseQuoteFromText";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const structuredHeader = "Codigo Descripcion Unidad Cantidad Precio Unitario Total";

const genericStandard = `${structuredHeader}
123 PRODUCTO GENERICO MARCA X UNI 2 $10.000 $20.000`;

const genericCompact = `${structuredHeader}
123 PRODUCTO GENERICO MARCAUNI3 $10.000 $30.000`;

const genericNoQuantity = `${structuredHeader}
123 PRODUCTO GENERICO $10.000 $10.000`;

const genericLogistic = `${structuredHeader}
999 Cobro Logistico SIN MARCA UNI 1 $3.500 $3.500`;

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
WW00008 Cobro Logistico SIN MARCA UNI 1 $ 3.500 $ 3.500
Total Neto $ 44.618
IVA $ 8.477
Total $ 53.095`;

function parse(text: string, name: string) {
  return parseQuoteFromText(text, `${name}.pdf`);
}

function assertNoGluedQuantityTokens(parsedName: string, descriptions: string[]) {
  const forbidden = [/UNI\d+/i, /UND\d+/i, /SIN\s+MARCAUNI\d+/i, /GRNESCAFEUNI\d+/i];
  for (const description of descriptions) {
    for (const pattern of forbidden) {
      assert(!pattern.test(description), `${parsedName}: descripcion con tokens pegados: ${description}`);
    }
  }
}

async function main() {
  const standard = parse(genericStandard, "generic-standard");
  assert(standard.items.length === 1, "Caso 1: no se extrajo la linea estandar");
  assert(standard.items[0].quantity === 2, "Caso 1: cantidad incorrecta");
  assert(standard.items[0].unitPrice === 10000, "Caso 1: unitario incorrecto");
  assert(standard.items[0].total === 20000, "Caso 1: total incorrecto");

  const compact = parse(genericCompact, "generic-compact");
  assert(compact.items.length === 1, "Caso 2: no se extrajo la linea compactada");
  assert(compact.items[0].quantity === 3, "Caso 2: cantidad incorrecta");
  assert(compact.items[0].total === 30000, "Caso 2: total incorrecto");
  assert(/PRODUCTO GENERICO MARCA$/i.test(compact.items[0].description), "Caso 2: descripcion no quedo limpia");

  const noQuantity = parse(genericNoQuantity, "generic-no-quantity");
  assert(noQuantity.items.length === 0, "Caso 3: se extrajo una linea sin cantidad explicita");
  assert(
    noQuantity.warnings.some((warning) => /cantidad/i.test(warning)),
    "Caso 3: falta warning por cantidad sin evidencia"
  );

  const logistic = parse(genericLogistic, "generic-logistic");
  assert(logistic.items.length === 0, "Caso 4: costo logistico entro como producto");
  assert(
    logistic.warnings.some((warning) => /Costo asociado detectado/i.test(warning)),
    "Caso 4: falta warning de costo asociado"
  );

  const prisa = parse(prisaSample, "PRISA");
  const prisaCafe = prisa.items.find((item) => /cafe/i.test(item.description));
  assert(prisaCafe, "Caso 5: no se extrajo cafe PRISA");
  assert(prisaCafe.quantity === 3, "Caso 5: cantidad cafe PRISA incorrecta");
  assert(prisaCafe.unitPrice === 11722, "Caso 5: unitario cafe PRISA incorrecto");
  assert(prisaCafe.total === 35166, "Caso 5: total cafe PRISA incorrecto");

  const dimerc = parse(dimercSample, "Dimerc");
  const dimercCafe = dimerc.items.find((item) => /cafe/i.test(item.description));
  assert(dimercCafe, "Caso 6: no se extrajo cafe Dimerc");
  assert(dimercCafe.quantity === 3, "Caso 6: cantidad cafe Dimerc incorrecta");
  assert(dimercCafe.unitPrice === 12417, "Caso 6: unitario cafe Dimerc incorrecto");
  assert(dimercCafe.total === 37251, "Caso 6: total cafe Dimerc incorrecto");

  assertNoGluedQuantityTokens(
    "Casos 7",
    [...standard.items, ...compact.items, ...prisa.items, ...dimerc.items].map((item) => item.description)
  );

  const allDescriptions = [...prisa.items, ...dimerc.items].map((item) => item.description.toLowerCase());
  assert(!allDescriptions.some((description) => /iva|subtotal|total neto|total$/.test(description)), "Caso 8: linea de resumen entro como producto");

  const comparison = await consolidateQuotes([prisa, dimerc], {
    exchangeRateMode: "manual",
    manualExchangeRateClpPerUsd: 900
  });
  const cafeComparison = comparison.comparison.find((item) => /cafe/i.test(item.product));
  assert(cafeComparison?.offers.PRISA, "Comparacion: falta oferta PRISA para cafe");
  assert(cafeComparison?.offers.Dimerc, "Comparacion: falta oferta Dimerc para cafe");

  console.log("Parser generico validado: 8 casos estructurales + regresion PRISA/Dimerc OK.");
}

void main();
