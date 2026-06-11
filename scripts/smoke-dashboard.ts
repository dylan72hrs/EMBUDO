/**
 * Smoke test: verifica que la analitica web y el Excel principal usen la MISMA
 * fuente de verdad (suma de lineas NETAS sin IVA desde cascadeBlocks), que la
 * auditoria economica sea defendible (descuentos aplicados, medidas no usadas
 * como precios, trazabilidad con folio) y que el dashboard Excel quede
 * correcto y abrible.
 *
 * Escenario 1: ADIS (USD) + Tecno (CLP con descuento global y una linea trampa
 * de medidas) + Echave (moneda mixta con descuento por linea y subtotal
 * envenenado). Incluye ciclo de folio (strip -> editar -> reinyectar charts).
 *
 * Escenario 2: solo ADIS -> advertencia de proveedor unico, sin metricas
 * falsas, sin donut.
 *
 * Escenario 3: auditoria unitaria (IVA incluido, lineas brutas reescaladas a
 * subtotal neto, cruce con auditor LLM).
 *
 * Uso: npx tsx scripts/smoke-dashboard.ts
 */

import { mkdir, copyFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildPurchaseAnalytics } from "../src/lib/analytics/buildPurchaseAnalytics";
import { auditQuoteEconomics } from "../src/lib/normalize/auditQuoteEconomics";
import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import {
  applyFolioToGeneratedExcel,
  generateComparisonExcel
} from "../src/lib/excel/generateComparisonExcel";
import { stripDashboardCharts } from "../src/lib/excel/injectDashboardCharts";
import { TEMPLATE_MAP } from "../src/lib/excel/templateMap";
import type { ExchangeRateResult } from "../src/lib/currency/getExchangeRate";
import type { ExtractedQuoteItem, ParsedQuote } from "../src/lib/validations/quoteSchemas";

const exchange: ExchangeRateResult = {
  baseRate: 950,
  margin: 5,
  finalRate: 955,
  mode: "manual",
  warnings: [],
  source: "smoke-test",
  date: "2026-06-11"
};

function item(partial: Partial<ExtractedQuoteItem> & Pick<ExtractedQuoteItem, "description" | "currency">): ExtractedQuoteItem {
  return {
    description: partial.description,
    normalizedProductKey: partial.description.toLowerCase().replace(/\s+/g, "-"),
    quantity: partial.quantity ?? 1,
    unit: partial.unit ?? "CU",
    currency: partial.currency,
    unitPrice: partial.unitPrice ?? null,
    total: partial.total ?? null,
    rawLine: partial.rawLine ?? partial.description,
    extractionMethod: "smoke",
    confidence: 0.9
  };
}

const adis: ParsedQuote = {
  supplierName: "ADIS Grupo Tecnologico",
  currency: "USD",
  quoteNumber: "OC-1142",
  pricesIncludeVat: false,
  quoteSubtotal: 591,
  items: [
    item({ description: "Licencia software gestion flota", currency: "USD", quantity: 10, unitPrice: 35 }),
    item({ description: "Sensor telemetria industrial", currency: "USD", quantity: 2, unitPrice: 120.5 })
  ],
  warnings: []
};

// Tecno: descuento global (linea DESCUENTO) + linea trampa con medidas usadas
// como precio (210x60x19 cm -> unitPrice 210). El subtotal del documento ya
// viene con el descuento aplicado (asi lo muestran los PDF reales).
const tecno: ParsedQuote = {
  supplierName: "Tecno Mercado",
  currency: "CLP",
  quoteNumber: "7788",
  pricesIncludeVat: false,
  quoteSubtotal: 558900,
  items: [
    item({ description: "Licencia software gestion flota", currency: "CLP", quantity: 10, unitPrice: 46300 }),
    item({ description: "Sensor telemetria industrial", currency: "CLP", quantity: 2, unitPrice: 79000 }),
    item({
      description: "Estante metalico 210x60x19 cm",
      rawLine: "Estante metalico 210x60x19 cm alto 210 cm",
      currency: "CLP",
      quantity: 1,
      unitPrice: 210
    }),
    item({ description: "DESCUENTO ESPECIAL", currency: "CLP", quantity: 1, total: 62100 })
  ],
  warnings: []
};

// Echave: moneda mixta + descuento POR LINEA (total neto explicito 1.100 <
// 1.156 x 1) + quoteSubtotal envenenado que con el codigo antiguo inflaba
// totales (~$336M).
const echave: ParsedQuote = {
  supplierName: "Comercial Echave Turri Limitada",
  quoteNumber: "423",
  pricesIncludeVat: false,
  quoteSubtotal: 352230,
  items: [
    item({ description: "Notebook Dell Pro 14", currency: "USD", quantity: 1, unitPrice: 1156, total: 1100 }),
    item({ description: "Soporte tecnico instalacion", currency: "CLP", quantity: 1, unitPrice: 79000 })
  ],
  warnings: []
};

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  OK  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function numericCell(cell: ExcelJS.Cell): number | undefined {
  const value = cell.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value && typeof value.result === "number") {
    return value.result;
  }
  return undefined;
}

async function readWithoutCharts(excelPath: string): Promise<ExcelJS.Workbook> {
  const strippedCopy = excelPath.replace(/\.xlsx$/, ".stripped.xlsx");
  await copyFile(excelPath, strippedCopy);
  await stripDashboardCharts(strippedCopy);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(strippedCopy);
  return workbook;
}

async function inspectCharts(excelPath: string) {
  const zip = await JSZip.loadAsync(await fs.readFile(excelPath));
  const chartFiles = Object.keys(zip.files)
    .filter((name) => /xl\/charts\/chart\d+\.xml$/.test(name))
    .sort();
  const styleFiles = Object.keys(zip.files).filter((name) => /xl\/charts\/style\d+\.xml$/.test(name));
  const colorsFiles = Object.keys(zip.files).filter((name) => /xl\/charts\/colors\d+\.xml$/.test(name));
  const charts: Array<{ name: string; xml: string }> = [];
  for (const name of chartFiles) {
    charts.push({ name, xml: await zip.file(name)!.async("string") });
  }
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  return { zip, charts, styleFiles, colorsFiles, workbookXml, contentTypes };
}

async function scenarioMultiSupplier() {
  console.log("\n=== Escenario 1: ADIS (USD) + Tecno (CLP, descuento+trampa) + Echave (mixto, dscto linea) ===");
  const auditedQuotes = [adis, tecno, echave].map((quote) => auditQuoteEconomics(quote));
  const consolidated = await consolidateQuotes(auditedQuotes, {}, { exchangeRate: exchange });

  const jobId = "smoke-multi";
  await mkdir(path.join(process.cwd(), "output", jobId), { recursive: true });
  const generated = await generateComparisonExcel(
    path.join(process.cwd(), "templates", "template.xlsx"),
    consolidated,
    jobId,
    { needsReviewCount: 2 }
  );

  const allWarnings = [...new Set([...consolidated.warnings, ...generated.warnings])];
  const analytics = buildPurchaseAnalytics(consolidated, allWarnings, { omittedFilesCount: 0 });

  // ── Totales esperados (lineas NETAS, descuentos aplicados antes de comparar)
  const expected = new Map<string, number>([
    ["ADIS Grupo Tecnologico", 35 * 955 * 10 + 120.5 * 955 * 2],            // 564.405
    ["Tecno Mercado", (463000 + 158000) * 0.9],                              // 558.900 (descuento global 10%)
    ["Comercial Echave Turri Limitada", 1100 * 955 + 79000]                  // 1.129.500 (total neto de linea respetado)
  ]);

  for (const [name, total] of expected.entries()) {
    const supplier = analytics.suppliers.find((entry) => entry.name === name);
    check(
      `Analitica web ${name} = ${total.toLocaleString("es-CL")}`,
      supplier !== undefined && Math.abs(supplier.total - total) < 1,
      `web=${supplier?.total}`
    );
  }

  const inflated = 352230 * 955;
  check(
    "Ningun total inflado por subtotal de documento (~$336M)",
    analytics.suppliers.every((supplier) => Math.abs(supplier.total - inflated) > 1000)
  );
  check(
    "Descuento global de Tecno aplicado antes de comparar",
    allWarnings.some((warning) => /descuento global .*aplicado proporcionalmente/i.test(warning))
  );
  check(
    "Descuento por linea de Echave respetado (total neto explicito)",
    allWarnings.some((warning) => /total neto explicito de linea/i.test(warning))
  );
  check(
    "Linea de medidas (210 cm) NO usada como precio",
    allWarnings.some((warning) => /coincide con una medida/i.test(warning)) &&
      analytics.suppliers.every((supplier) => supplier.total !== 210),
    JSON.stringify(allWarnings.filter((w) => /medida/i.test(w)))
  );
  check(
    "Tecno marcado needsReview (linea trampa anulada)",
    analytics.suppliers.find((s) => s.name === "Tecno Mercado")?.needsReview === true
  );
  check(
    "Echave marcado para revision (moneda mixta)",
    analytics.suppliers.find((s) => s.name === "Comercial Echave Turri Limitada")?.needsReview === true
  );
  check(
    "Trazabilidad por cotizacion en warnings",
    ["OC-1142", "7788", "423"].every((folio) =>
      allWarnings.some((warning) => warning.startsWith("[TRAZABILIDAD]") && warning.includes(folio))
    )
  );
  check(
    "Analitica expone folio por proveedor",
    analytics.suppliers.find((s) => s.name === "Tecno Mercado")?.quotationNumber === "7788" &&
      analytics.suppliers.find((s) => s.name === "Comercial Echave Turri Limitada")?.quotationNumber === "423"
  );

  // ── Excel: fila TOTAL de la tabla principal debe coincidir con la web ─────
  const workbook = await readWithoutCharts(generated.outputPath);
  const sheet = workbook.getWorksheet(TEMPLATE_MAP.sheetName);
  if (!sheet) throw new Error("No existe la hoja principal en el Excel generado.");

  for (const [index, supplier] of consolidated.suppliers.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[index];
    const excelTotal = numericCell(sheet.getCell(TEMPLATE_MAP.rows.total, block.totalColumn));
    const webTotal = analytics.suppliers.find((entry) => entry.name === supplier.name)?.total;
    check(
      `Excel TOTAL (${supplier.name}) coincide con analitica web`,
      excelTotal !== undefined && webTotal !== undefined && Math.abs(excelTotal - webTotal) < 1,
      `excel=${excelTotal} web=${webTotal}`
    );

    const folioText = String(sheet.getCell(5, block.unitPriceColumn).value ?? "");
    check(
      `Folio visible sobre la columna de ${supplier.name}`,
      supplier.quoteNumber !== undefined && folioText.includes(`Cotización N° ${supplier.quoteNumber}`),
      `celda fila5="${folioText}"`
    );
  }

  // ── Dashboard_Data: 16 columnas con folio, solo proveedores reales ────────
  const dashboardData = workbook.getWorksheet("Dashboard_Data");
  check("Dashboard_Data existe", dashboardData !== undefined);
  if (dashboardData) {
    check("Dashboard_Data oculta", dashboardData.state === "hidden");
    const headerRow = dashboardData.getRow(1).values as Array<unknown>;
    check(
      "Dashboard_Data headers Provider..Score..QuotationNumber",
      headerRow[1] === "Provider" && headerRow[15] === "Score" && headerRow[16] === "QuotationNumber",
      JSON.stringify(headerRow)
    );

    const folioByName = new Map([
      ["ADIS Grupo Tecnologico", "OC-1142"],
      ["Tecno Mercado", "7788"],
      ["Comercial Echave Turri Limitada", "423"]
    ]);
    let previousTotal = 0;
    for (let row = 2; row <= 4; row += 1) {
      const name = String(dashboardData.getCell(row, 1).value ?? "").trim();
      const total = numericCell(dashboardData.getCell(row, 2));
      const folio = String(dashboardData.getCell(row, 16).value ?? "").trim();
      const expectedTotal = expected.get(name);
      check(
        `Dashboard_Data fila ${row}: ${name || "(vacia)"} total+folio`,
        Boolean(name) &&
          expectedTotal !== undefined &&
          total !== undefined &&
          Math.abs(total - Math.round(expectedTotal)) <= 1 &&
          folio === folioByName.get(name),
        `total=${total} folio=${folio}`
      );
      check(`Dashboard_Data fila ${row} ordenada ascendente`, total !== undefined && total >= previousTotal);
      previousTotal = total ?? previousTotal;
    }
    const ghostName = String(dashboardData.getCell(5, 1).value ?? "").trim();
    check("Dashboard_Data sin filas basura (fila 5 vacia)", !ghostName);
  }

  // ── Panel ejecutivo: trazabilidad por cotizacion ──────────────────────────
  const panelTitle = String(sheet.getCell(2, 18).value ?? "");
  check("Panel ejecutivo en R2", panelTitle.includes("PANEL EJECUTIVO DE COMPRAS"), panelTitle);
  let traceHeader = false;
  let traceEchave = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = typeof cell.value === "string" ? cell.value : "";
      if (Number(cell.col) >= 18 && text.includes("TRAZABILIDAD POR COTIZACIÓN")) traceHeader = true;
      if (Number(cell.col) >= 18 && text.includes("Cotización N° 423")) traceEchave = true;
    });
  });
  check("Panel: bloque TRAZABILIDAD POR COTIZACIÓN", traceHeader);
  check("Panel: folio de Echave visible", traceEchave);

  // ── Hoja RESUMEN: 4 graficos nativos, rangos reales ───────────────────────
  const inspection = await inspectCharts(generated.outputPath);
  check("Hoja RESUMEN inyectada", inspection.workbookXml.includes('name="RESUMEN"'));
  check("4 graficos nativos", inspection.charts.length === 4, `found=${inspection.charts.length}`);
  for (const chart of inspection.charts) {
    check(
      `${chart.name} apunta solo a 3 proveedores ($2:$4)`,
      /\$[A-Z]+\$2:\$[A-Z]+\$4/.test(chart.xml) && !/\$[A-Z]+\$2:\$[A-Z]+\$7/.test(chart.xml)
    );
  }

  // ── Ciclo folio comparativa: strip -> editar -> reinyectar ────────────────
  await applyFolioToGeneratedExcel(generated.outputPath, "F-SMOKE-001");
  const afterFolio = await inspectCharts(generated.outputPath);
  check("Folio job: RESUMEN reinyectada", afterFolio.workbookXml.includes('name="RESUMEN"'));
  check("Folio job: 4 graficos restaurados", afterFolio.charts.length === 4, `found=${afterFolio.charts.length}`);

  for (const name of ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]) {
    const xml = await afterFolio.zip.file(name)!.async("string");
    check(`${name} bien formado`, /<\?xml/.test(xml) && !xml.includes("undefined"));
  }
}

async function scenarioSingleSupplier() {
  console.log("\n=== Escenario 2: solo ADIS (proveedor unico) ===");
  const consolidated = await consolidateQuotes([auditQuoteEconomics(adis)], {}, { exchangeRate: exchange });
  const analytics = buildPurchaseAnalytics(consolidated, consolidated.warnings, { omittedFilesCount: 0 });

  check("singleSupplier = true", analytics.singleSupplier);
  check("hasComparison = false", !analytics.hasComparison);
  check("Ahorro N/D (null)", analytics.savingsVsWorstClp === null);
  check(
    "Advertencia de proveedor unico presente",
    consolidated.warnings.some((warning) => warning.includes("no existe comparacion entre multiples proveedores"))
  );
  const adisTotal = analytics.suppliers[0];
  check(
    "ADIS convertido a CLP correctamente",
    adisTotal !== undefined && Math.abs(adisTotal.total - (35 * 955 * 10 + 120.5 * 955 * 2)) < 1,
    `total=${adisTotal?.total}`
  );
  check("Sin metricas falsas de cobertura (coverageAvailable=false)", !analytics.coverageAvailable);

  const jobId = "smoke-single";
  await mkdir(path.join(process.cwd(), "output", jobId), { recursive: true });
  const generated = await generateComparisonExcel(
    path.join(process.cwd(), "templates", "template.xlsx"),
    consolidated,
    jobId,
    {}
  );

  const inspection = await inspectCharts(generated.outputPath);
  check(
    "Donut removido con proveedor unico",
    inspection.charts.length === 3 && inspection.charts.every((chart) => !chart.xml.includes("doughnutChart")),
    `charts=${inspection.charts.length}`
  );
  for (const chart of inspection.charts) {
    check(
      `${chart.name} apunta a 1 proveedor ($2:$2)`,
      /\$[A-Z]+\$2:\$[A-Z]+\$2/.test(chart.xml) && !/\$[A-Z]+\$2:\$[A-Z]+\$7/.test(chart.xml)
    );
  }
}

function scenarioEconomicAudit() {
  console.log("\n=== Escenario 3: auditoria economica unitaria ===");

  // 3a. IVA incluido -> normalizar a neto (÷1,19)
  const vatQuote = auditQuoteEconomics({
    supplierName: "Ferreteria Bruta",
    currency: "CLP",
    pricesIncludeVat: true,
    items: [item({ description: "Taladro industrial", currency: "CLP", quantity: 1, total: 119000 })],
    warnings: []
  });
  const vatItem = vatQuote.items[0];
  check(
    "IVA incluido: linea normalizada a neto 100.000",
    vatItem !== undefined && Math.abs((vatItem.total ?? 0) - 100000) < 1,
    `total=${vatItem?.total}`
  );
  check("IVA incluido: needsReview = true", vatQuote.needsReview === true);

  // 3b. Lineas brutas que suman el total c/IVA -> reescalar al subtotal neto
  const grossQuote = auditQuoteEconomics({
    supplierName: "Distribuidora Bruta",
    currency: "CLP",
    pricesIncludeVat: false,
    quoteSubtotal: 100000,
    quoteTotal: 119000,
    items: [
      item({ description: "Caja herramientas", currency: "CLP", quantity: 1, total: 59500 }),
      item({ description: "Set destornilladores", currency: "CLP", quantity: 1, total: 59500 })
    ],
    warnings: []
  });
  const grossSum = grossQuote.items.reduce((sum, entry) => sum + (entry.total ?? 0), 0);
  check(
    "Lineas brutas reescaladas al subtotal neto (100.000)",
    Math.abs(grossSum - 100000) < 1,
    `sum=${grossSum}`
  );
  check(
    "Reescalado con valueBasis subtotal_net",
    grossQuote.items.every((entry) => entry.valueBasis === "subtotal_net")
  );
  check("Reescalado marca needsReview", grossQuote.needsReview === true);

  // 3c. Cruce con auditor LLM: subtotal confirmado difiere de la suma usada
  const auditMismatch = auditQuoteEconomics({
    supplierName: "Proveedor Auditado",
    currency: "CLP",
    pricesIncludeVat: false,
    auditConfirmedNetSubtotal: 90000,
    items: [item({ description: "Servicio mantencion", currency: "CLP", quantity: 1, total: 100000 })],
    warnings: []
  });
  check(
    "Auditor LLM discrepante genera warning + needsReview (sin sobreescribir)",
    auditMismatch.needsReview === true &&
      auditMismatch.items[0]?.total === 100000 &&
      auditMismatch.warnings.some((warning) => /auditor LLM confirmo un subtotal neto/i.test(warning))
  );

  // 3d. Justificacion por item: sin precio justificable -> fuera + review
  const measureOnly = auditQuoteEconomics({
    supplierName: "Muebles Vasquez",
    currency: "CLP",
    quoteNumber: "384",
    pricesIncludeVat: false,
    items: [
      item({ description: "Closet melamina 187x60x52 cm", currency: "CLP", quantity: 1, unitPrice: 187 }),
      item({ description: "Comoda 4 cajones", currency: "CLP", quantity: 2, unitPrice: 64990 })
    ],
    warnings: []
  });
  check(
    "Medida 187 anulada; solo queda la linea justificada",
    measureOnly.items.length === 1 && measureOnly.items[0]?.description === "Comoda 4 cajones",
    JSON.stringify(measureOnly.items.map((entry) => entry.description))
  );
  check(
    "Linea valida con valueBasis calculated_from_qty_unit",
    measureOnly.items[0]?.valueBasis === "calculated_from_qty_unit"
  );
  check("Trazabilidad menciona folio 384", measureOnly.warnings.some((warning) => warning.includes("384")));
}

async function main() {
  await scenarioMultiSupplier();
  await scenarioSingleSupplier();
  scenarioEconomicAudit();

  if (failures > 0) {
    console.error(`\n${failures} verificacion(es) fallaron.`);
    process.exit(1);
  }
  console.log("\nTodas las verificaciones pasaron.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
