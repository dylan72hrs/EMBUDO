/**
 * Smoke test: verifica que la analitica web y el Excel principal usen la MISMA
 * fuente de verdad (totales item por item desde cascadeBlocks).
 *
 * Escenario 1 (Prueba 2 del plan): ADIS en USD + Tecno Mercado en CLP +
 * Echave Turri en moneda mixta con un quoteSubtotal "envenenado" que con el
 * codigo antiguo producia totales inflados (~$336.380.009).
 *
 * Escenario 2 (Prueba 1 del plan): solo ADIS -> advertencia de proveedor
 * unico, sin metricas falsas.
 *
 * Uso: npx tsx scripts/smoke-dashboard.ts
 */

import { mkdir, copyFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildPurchaseAnalytics } from "../src/lib/analytics/buildPurchaseAnalytics";
import { consolidateQuotes } from "../src/lib/normalize/consolidateQuotes";
import { generateComparisonExcel } from "../src/lib/excel/generateComparisonExcel";
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
  pricesIncludeVat: false,
  quoteSubtotal: 591,
  items: [
    item({ description: "Licencia software gestion flota", currency: "USD", quantity: 10, unitPrice: 35 }),
    item({ description: "Sensor telemetria industrial", currency: "USD", quantity: 2, unitPrice: 120.5 })
  ],
  warnings: []
};

const tecno: ParsedQuote = {
  supplierName: "Tecno Mercado",
  currency: "CLP",
  pricesIncludeVat: false,
  quoteSubtotal: 621000,
  items: [
    item({ description: "Licencia software gestion flota", currency: "CLP", quantity: 10, unitPrice: 46300 }),
    item({ description: "Sensor telemetria industrial", currency: "CLP", quantity: 2, unitPrice: 79000 })
  ],
  warnings: []
};

// Moneda mixta a nivel de items, sin moneda declarada a nivel documento.
// quoteSubtotal envenenado: con el codigo antiguo (offerNetTotalCLP via
// calculateQuoteEconomicTotals) ese subtotal podia convertirse con el dolar
// y producir totales inflados (~$336M).
const echave: ParsedQuote = {
  supplierName: "Comercial Echave Turri Limitada",
  pricesIncludeVat: false,
  quoteSubtotal: 352230,
  items: [
    item({ description: "Notebook Dell Pro 14", currency: "USD", quantity: 1, unitPrice: 1156 }),
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

async function scenarioMultiSupplier() {
  console.log("\n=== Escenario 1: ADIS (USD) + Tecno (CLP) + Echave (mixto) ===");
  const consolidated = await consolidateQuotes([adis, tecno, echave], {}, { exchangeRate: exchange });

  const jobId = "smoke-multi";
  const outputDirPath = path.join(process.cwd(), "output", jobId);
  await mkdir(outputDirPath, { recursive: true });
  const generated = await generateComparisonExcel(
    path.join(process.cwd(), "templates", "template.xlsx"),
    consolidated,
    jobId,
    { needsReviewCount: 1 }
  );

  const allWarnings = [...new Set([...consolidated.warnings, ...generated.warnings])];
  const analytics = buildPurchaseAnalytics(consolidated, allWarnings, { omittedFilesCount: 0 });

  // ── Totales esperados (item por item, convertidos linea a linea) ──────────
  const expected = new Map<string, number>([
    ["ADIS Grupo Tecnologico", 35 * 955 * 10 + 120.5 * 955 * 2],
    ["Tecno Mercado", 46300 * 10 + 79000 * 2],
    ["Comercial Echave Turri Limitada", 1156 * 955 * 1 + 79000]
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

  check("Mejor oferta = ADIS", analytics.bestSupplier?.name === "ADIS Grupo Tecnologico");
  check("hasComparison = true", analytics.hasComparison);
  check(
    "Ahorro = peor - mejor",
    analytics.savingsVsWorstClp !== null &&
      Math.abs(
        analytics.savingsVsWorstClp -
          (expected.get("Comercial Echave Turri Limitada")! - expected.get("ADIS Grupo Tecnologico")!)
      ) < 1
  );
  check(
    "Echave marcado para revision (moneda mixta)",
    analytics.suppliers.find((s) => s.name === "Comercial Echave Turri Limitada")?.needsReview === true
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
  }

  // ── Dashboard_Data: solo proveedores reales con totales correctos ─────────
  const dashboardData = workbook.getWorksheet("Dashboard_Data");
  check("Dashboard_Data existe", dashboardData !== undefined);
  if (dashboardData) {
    check("Dashboard_Data oculta", dashboardData.state === "hidden");
    for (let row = 2; row <= 4; row += 1) {
      const name = String(dashboardData.getCell(row, 1).value ?? "").trim();
      const total = numericCell(dashboardData.getCell(row, 2));
      const expectedTotal = expected.get(name);
      check(
        `Dashboard_Data fila ${row}: ${name || "(vacia)"}`,
        Boolean(name) && expectedTotal !== undefined && total !== undefined && Math.abs(total - Math.round(expectedTotal)) <= 1,
        `total=${total}`
      );
    }
    const ghostName = String(dashboardData.getCell(5, 1).value ?? "").trim();
    const ghostTotal = dashboardData.getCell(5, 2).value;
    check("Dashboard_Data sin filas basura (fila 5 vacia)", !ghostName && (ghostTotal === null || ghostTotal === undefined));
  }

  // ── Bloque ejecutivo en la hoja principal ──────────────────────────────────
  let panelFound = false;
  let matrixHasEchave = false;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const text = typeof cell.value === "string" ? cell.value : "";
      if (text.includes("PANEL EJECUTIVO DE COMPRAS")) panelFound = true;
      if (text === "Comercial Echave Turri Limitada") matrixHasEchave = true;
    });
  });
  check("Panel ejecutivo presente en hoja principal", panelFound);
  check("Matriz incluye a Echave", matrixHasEchave);

  // ── Charts: hoja RESUMEN inyectada y rangos recortados a 3 proveedores ────
  const zip = await JSZip.loadAsync(await fs.readFile(generated.outputPath));
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  check("Hoja RESUMEN inyectada", workbookXml.includes('name="RESUMEN"'));

  const chartFiles = Object.keys(zip.files).filter((name) => /xl\/charts\/chart\d+\.xml$/.test(name));
  check("Charts presentes", chartFiles.length >= 2);
  for (const chartFile of chartFiles) {
    const chartXml = await zip.file(chartFile)!.async("string");
    check(
      `${chartFile} apunta solo a 3 proveedores ($2:$4)`,
      chartXml.includes("$A$2:$A$4") && !chartXml.includes("$A$2:$A$7")
    );
  }

  // El Excel debe poder abrirse: XML bien formado en las partes patcheadas.
  for (const name of ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]) {
    const xml = await zip.file(name)!.async("string");
    check(`${name} bien formado`, /<\?xml/.test(xml) && !xml.includes("undefined"));
  }

  console.log(`\nWarnings generados (${allWarnings.length}):`);
  for (const warning of allWarnings.slice(0, 12)) console.log(`  - ${warning}`);
}

async function scenarioSingleSupplier() {
  console.log("\n=== Escenario 2: solo ADIS (proveedor unico) ===");
  const consolidated = await consolidateQuotes([adis], {}, { exchangeRate: exchange });
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
}

async function main() {
  await scenarioMultiSupplier();
  await scenarioSingleSupplier();

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
