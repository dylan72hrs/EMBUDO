import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import { parseQuoteFromText } from "../src/lib/parser/parseQuoteFromText";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const tableHeader = "Codigo Descripcion Unidad Cantidad Precio Unitario Total";

const genericStandard = `${tableHeader}
123 PRODUCTO GENERICO MARCA X UNI 2 $10.000 $20.000`;

const genericCompact = `${tableHeader}
123 PRODUCTO GENERICO MARCAUNI3 $10.000 $30.000`;

const genericNoQuantity = `${tableHeader}
123 PRODUCTO GENERICO $10.000 $10.000`;

const genericLogistic = `${tableHeader}
999 Cobro Logistico SIN MARCA UNI 1 $3.500 $3.500`;

const prisaSample = `PROVEEDORES INTEGRALES PRISA S.A.
COTIZACION 33098215
Codigo Descripcion UND Cantidad Precio Unitario Total
91703 ENDULZANTE IANSA CERO K STEVIA SENS 250 ML LIQUIDA UND 1 $2.911 $2.911
18576 AZUCAR 1 KL. COLISEO RUBIA BOL 1 $1.124 $1.124
16889 TE CAJA SUPREMO PREMIUM 100BOL CEYLAN PREMIUM C/NE CJA 1 $4.603 $4.603
89289 CAFE INST. NESCAFE FIN/SELECC.200 GR LIOFI/FCO VI UND 3 $11.722 $35.166
14278 GALLETA ARCOR MINI CONQUISTA 35 GR DP 1 $173 $173
36493 GALLETA COSTA FRAC CLASICA 110 GR. PQT 1 $615 $615
26125 GALLETA MCKAY TRITON VAINILLA 116 GR. PQT 1 $762 $762
71365 GALLETA COSTA SODA LINE 160 GR. UND 1 $849 $849
11252 GALLETA COSTA COCO 125 GRS. UND 1 $701 $701
85895 GALLETA OREO REGULAR X 108 GRS UND 1 $735 $735
12547 GALLETA COSTA MINI TUAREG X 48 GRS UND 1 $247 $247
Total Neto $47.023
IVA $8.934
Total $55.957`;

const dimercSample = `DIMERC cotizacion_11871712
Codigo Descripcion Marca Und Cantidad Precio Total
559247 AZUCAR RUBIA BOLSA 1 KG IANSA UNI 1 $ 3.867 $ 3.867
512334 ENDULZANTE STEVIA SENSACION 350 ML IANSA UNI 1 $ 3.490 $ 3.490
508297 CAFE INSTANTANEO TRADICION FINA SELECCION 200 GR NESCAFE UNI 3 $ 12.417 $ 37.251
448901 TE CEYLAN SUPREMO 100 BOLSAS SUPREMO UNI 1 $ 4.950 $ 4.950
444872 GALLETA TRITON VAINILLA 116 GR MCKAY UNI 1 $ 799 $ 799
444871 GALLETA SODA 160 GR COSTA UNI 1 $ 910 $ 910
444870 GALLETA OREO REGULAR 108 GR OREO UNI 1 $ 790 $ 790
444869 GALLETA MINI TUAREG 48 GR COSTA UNI 1 $ 289 $ 289
444868 GALLETA COSTA COCO 125 GR COSTA UNI 1 $ 739 $ 739
444867 GALLETA FRAC CLASICA 110 GR COSTA UNI 1 $ 659 $ 659
444866 BARRA CEREAL CHOCOLATE 25 GR COSTA UNI 2 $ 430 $ 860
WW00008 Cobro Logistico SIN MARCA UNI 1 $ 3.500 $ 3.500
Total Neto $ 54.204
IVA $ 10.299
Total $ 64.503`;

function parse(text: string, fileName: string) {
  return parseQuoteFromText(text, fileName);
}

function findByDescriptionToken<T extends { description: string }>(items: T[], token: string) {
  return items.find((item) => item.description.toLowerCase().includes(token.toLowerCase()));
}

function assertNoGluedQuantityTokens(parsedName: string, descriptions: string[]) {
  const forbidden = [/UNI\d+/i, /UND\d+/i, /SIN\s+MARCAUNI\d+/i, /GRNESCAFEUNI\d+/i];
  for (const description of descriptions) {
    for (const pattern of forbidden) {
      assert(!pattern.test(description), `${parsedName}: descripcion con tokens pegados: ${description}`);
    }
  }
}

function assertProductExistsInComparison(
  comparison: Awaited<ReturnType<typeof consolidateQuotes>>["comparison"],
  supplier: string,
  descriptionToken: string
) {
  const found = comparison.some((row) => {
    if (!row.offers[supplier]) return false;
    return row.product.toLowerCase().includes(descriptionToken.toLowerCase());
  });
  assert(found, `Comparacion: falta producto "${descriptionToken}" para ${supplier}`);
}

function approxEqual(a: number, b: number, tolerance = 2) {
  return Math.abs(a - b) <= tolerance;
}

async function main() {
  const standard = parse(genericStandard, "generic-standard.pdf");
  assert(standard.items.length === 1, "Caso 1: no se extrajo la linea estandar");
  assert(standard.items[0].quantity === 2, "Caso 1: cantidad incorrecta");
  assert(standard.items[0].unitPrice === 10000, "Caso 1: unitario incorrecto");
  assert(standard.items[0].total === 20000, "Caso 1: total incorrecto");

  const compact = parse(genericCompact, "generic-compact.pdf");
  assert(compact.items.length === 1, "Caso 2: no se extrajo la linea compactada");
  assert(compact.items[0].quantity === 3, "Caso 2: cantidad incorrecta");
  assert(compact.items[0].total === 30000, "Caso 2: total incorrecto");

  const noQuantity = parse(genericNoQuantity, "generic-no-quantity.pdf");
  assert(noQuantity.items.length === 0, "Caso 3: se extrajo una linea sin cantidad explicita");
  assert(
    noQuantity.warnings.some((warning) => /cantidad/i.test(warning)),
    "Caso 3: falta warning por cantidad sin evidencia"
  );

  const logistic = parse(genericLogistic, "generic-logistic.pdf");
  assert(logistic.items.length === 0, "Caso 4: costo logistico entro como producto");
  assert(
    logistic.warnings.some((warning) => /Costo asociado detectado/i.test(warning)),
    "Caso 4: falta warning de costo asociado"
  );

  const prisa = parse(prisaSample, "33098215.pdf");
  assert(prisa.supplierName === "PRISA", "PRISA: proveedor no identificado como PRISA");
  assert(prisa.items.length === 11, `PRISA: se esperaban 11 productos y se detectaron ${prisa.items.length}`);

  const prisaCafe = findByDescriptionToken(prisa.items, "CAFE INST");
  assert(prisaCafe, "PRISA: no se encontro cafe");
  assert(prisaCafe.quantity === 3, "PRISA: cantidad de cafe incorrecta");
  assert(prisaCafe.unitPrice === 11722, "PRISA: unitario de cafe incorrecto");
  assert(prisaCafe.total === 35166, "PRISA: total de cafe incorrecto");

  const prisaArcor = findByDescriptionToken(prisa.items, "ARCOR MINI CONQUISTA");
  assert(prisaArcor, "PRISA: no se encontro GALLETA ARCOR MINI CONQUISTA");
  assert(prisaArcor.quantity === 1, "PRISA: cantidad de ARCOR MINI CONQUISTA incorrecta");
  assert(prisaArcor.unit === "DP", "PRISA: unidad DP no detectada correctamente");
  assert(prisaArcor.unitPrice === 173, "PRISA: unitario de ARCOR MINI CONQUISTA incorrecto");
  assert(prisaArcor.total === 173, "PRISA: total de ARCOR MINI CONQUISTA incorrecto");

  const dimerc = parse(dimercSample, "cotizacion_11871712.pdf");
  assert(dimerc.supplierName === "Dimerc", "Dimerc: proveedor no identificado como Dimerc");
  assert(dimerc.items.length === 11, `Dimerc: se esperaban 11 productos y se detectaron ${dimerc.items.length}`);

  const dimercCafe = findByDescriptionToken(dimerc.items, "CAFE INSTANTANEO");
  assert(dimercCafe, "Dimerc: no se encontro cafe");
  assert(dimercCafe.quantity === 3, "Dimerc: cantidad de cafe incorrecta");
  assert(dimercCafe.unitPrice === 12417, "Dimerc: unitario de cafe incorrecto");
  assert(dimercCafe.total === 37251, "Dimerc: total de cafe incorrecto");
  assert(
    dimerc.warnings.some((warning) => /Costo asociado detectado/i.test(warning)),
    "Dimerc: falta warning por Cobro Logistico"
  );
  assert(
    !dimerc.items.some((item) => /cobro logistico|logistico/i.test(item.description)),
    "Dimerc: Cobro Logistico entro como producto comparable"
  );

  assertNoGluedQuantityTokens(
    "Casos 7",
    [...standard.items, ...compact.items, ...prisa.items, ...dimerc.items].map((item) => item.description)
  );

  const allDescriptions = [...prisa.items, ...dimerc.items].map((item) => item.description.toLowerCase());
  assert(
    !allDescriptions.some((description) => /(^|\s)(iva|subtotal|total neto|total general)(\s|$)/.test(description)),
    "Caso 8: linea de resumen entro como producto"
  );

  const comparison = await consolidateQuotes([prisa, dimerc], {
    exchangeRateMode: "manual",
    manualExchangeRateClpPerUsd: 900
  });

  const badWarning = comparison.warnings.find((warning) =>
    /producto extra no agregado a la comparacion/i.test(warning)
  );
  assert(!badWarning, "Consolidacion: existe warning legado de producto extra no agregado");

  assertProductExistsInComparison(comparison.comparison, "PRISA", "ENDULZANTE IANSA CERO K");
  assertProductExistsInComparison(comparison.comparison, "PRISA", "GALLETA ARCOR MINI CONQUISTA");
  assertProductExistsInComparison(comparison.comparison, "Dimerc", "BARRA CEREAL CHOCOLATE");

  const logisticRow = comparison.comparison.find((row) => /cobro logistico|logistico/i.test(row.product));
  assert(!logisticRow, "Consolidacion: Cobro Logistico aparecio como fila de producto");

  const prisaCafeRow = comparison.comparison.find(
    (row) => row.offers.PRISA && row.product.toLowerCase().includes("cafe")
  );
  assert(prisaCafeRow?.offers.PRISA?.unitPrice, "Consolidacion: no hay oferta cafe PRISA");
  assert(prisaCafeRow?.offers.PRISA?.total, "Consolidacion: no hay total cafe PRISA");
  assert(
    approxEqual(prisaCafeRow.offers.PRISA.unitPrice!, 11722),
    `Consolidacion: unitario cafe PRISA esperado 11722, actual ${prisaCafeRow.offers.PRISA.unitPrice}`
  );
  assert(
    approxEqual(prisaCafeRow.offers.PRISA.total!, 35166),
    `Consolidacion: total cafe PRISA esperado 35166, actual ${prisaCafeRow.offers.PRISA.total}`
  );

  const dimercCafeRow = comparison.comparison.find(
    (row) => row.offers.Dimerc && row.product.toLowerCase().includes("cafe")
  );
  assert(dimercCafeRow?.offers.Dimerc?.unitPrice, "Consolidacion: no hay oferta cafe Dimerc");
  assert(dimercCafeRow?.offers.Dimerc?.total, "Consolidacion: no hay total cafe Dimerc");
  assert(
    approxEqual(dimercCafeRow.offers.Dimerc.unitPrice!, 12417),
    `Consolidacion: unitario cafe Dimerc esperado 12417, actual ${dimercCafeRow.offers.Dimerc.unitPrice}`
  );
  assert(
    approxEqual(dimercCafeRow.offers.Dimerc.total!, 37251),
    `Consolidacion: total cafe Dimerc esperado 37251, actual ${dimercCafeRow.offers.Dimerc.total}`
  );

  console.log(
    "OK generic parser + consolidation: PRISA=11, Dimerc=11 (logistico excluido), union global valida y sin descartes de productos validos."
  );
}

void main();
