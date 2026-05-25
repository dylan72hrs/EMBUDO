import ExcelJS from "exceljs";
import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import { highlightBestPrices } from "../src/lib/excel/highlightBestPrices";
import { TEMPLATE_MAP } from "../src/lib/excel/templateMap";
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
const genericFlete = `${tableHeader}
999 Flete UNI 1 $10.000 $10.000`;
const genericDespacho = `${tableHeader}
999 Despacho $5.000`;
const genericEnvio = `${tableHeader}
999 Envío a sucursal UNI 1 $7.500 $7.500`;
const genericShipping = `${tableHeader}
999 Shipping USD 20`;

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

function assertCellNoFill(cell: ExcelJS.Cell, message: string) {
  assert(!cell.fill, message);
}

function assertCellFill(cell: ExcelJS.Cell, argb: string, message: string) {
  const fill = cell.fill;
  assert(fill && fill.type === "pattern" && fill.pattern === "solid", message);
  assert(fill.fgColor?.argb === argb, `${message} (argb esperado ${argb}, actual ${fill.fgColor?.argb})`);
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
    logistic.warnings.some((warning) => /Costo asociado detectado|COSTOS ASOCIADOS|incluye/i.test(warning)),
    "Caso 4: falta warning de costo asociado"
  );

  const flete = parse(genericFlete, "generic-flete.pdf");
  assert(flete.items.length === 0, "Caso 4b: Flete entro como producto");

  const despacho = parse(genericDespacho, "generic-despacho.pdf");
  assert(despacho.items.length === 0, "Caso 4c: Despacho entro como producto");

  const envio = parse(genericEnvio, "generic-envio.pdf");
  assert(envio.items.length === 0, "Caso 4d: Envio entro como producto");

  const shipping = parse(genericShipping, "generic-shipping.pdf");
  assert(shipping.items.length === 0, "Caso 4e: Shipping entro como producto");

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
    dimerc.warnings.some((warning) => /Costo asociado detectado|COSTOS ASOCIADOS|incluye/i.test(warning)),
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
  assert(
    !comparison.warnings.some((warning) => /lista base|base provider|base quote|echave turri no estaba disponible/i.test(warning)),
    "Consolidacion: se mostro warning tecnico de lista base"
  );
  assert(
    !comparison.warnings.some((warning) => /valores usd convertidos|tipo de cambio automatico/i.test(warning)),
    "Consolidacion: se mostro warning de conversion USD en caso 100% CLP"
  );

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

  const dimercSummary = comparison.suppliers.find((supplier) => supplier.name === "Dimerc");
  assert(dimercSummary, "Consolidacion: falta resumen de proveedor Dimerc");
  assert(
    typeof dimercSummary.associatedCosts === "string" && dimercSummary.associatedCosts.length > 0,
    "Consolidacion: Cobro Logistico no fue registrado como costo asociado del proveedor"
  );

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("TEST");
  const rowOne = TEMPLATE_MAP.productStartRow;
  const rowTwo = TEMPLATE_MAP.productStartRow + 1;
  const [blockA, blockB] = TEMPLATE_MAP.supplierBlocks;

  worksheet.getCell(rowOne, blockA.unitPriceColumn).value = 1000;
  worksheet.getCell(rowOne, blockA.totalColumn).value = 1000;
  worksheet.getCell(rowOne, blockB.unitPriceColumn).value = null;
  worksheet.getCell(rowOne, blockB.totalColumn).value = null;

  worksheet.getCell(rowTwo, blockA.unitPriceColumn).value = 1200;
  worksheet.getCell(rowTwo, blockA.totalColumn).value = 2400;
  worksheet.getCell(rowTwo, blockB.unitPriceColumn).value = 900;
  worksheet.getCell(rowTwo, blockB.totalColumn).value = 1800;

  highlightBestPrices(
    worksheet,
    [
      {
        item: 1,
        product: "Solo PRISA",
        quantity: 1,
        unit: "CU",
        offers: {
          PRISA: { currency: "CLP", unitPrice: 1000, total: 1000, confidence: 1 }
        },
        matchingWarnings: []
      },
      {
        item: 2,
        product: "PRISA vs Dimerc",
        quantity: 2,
        unit: "CU",
        offers: {
          PRISA: { currency: "CLP", unitPrice: 1200, total: 2400, confidence: 1 },
          Dimerc: { currency: "CLP", unitPrice: 900, total: 1800, confidence: 1 }
        },
        matchingWarnings: []
      }
    ],
    [{ name: "PRISA" }, { name: "Dimerc" }],
    TEMPLATE_MAP
  );

  assertCellNoFill(worksheet.getCell(rowOne, blockA.unitPriceColumn), "Highlight: fila con una sola oferta no debe quedar verde");
  assertCellNoFill(worksheet.getCell(rowOne, blockA.totalColumn), "Highlight: fila con una sola oferta no debe quedar roja/verde");
  assertCellFill(worksheet.getCell(rowTwo, blockA.totalColumn), "FFFCE4D6", "Highlight: mayor total debe quedar rojo");
  assertCellFill(worksheet.getCell(rowTwo, blockB.totalColumn), "FFE2F0D9", "Highlight: menor total debe quedar verde");

  console.log(
    "OK generic parser + consolidation + highlight: PRISA=11, Dimerc=11 (logistico excluido), union global valida y reglas de color correctas."
  );
}

void main();
