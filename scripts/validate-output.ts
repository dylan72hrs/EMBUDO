import ExcelJS from "exceljs";
import { TEMPLATE_MAP } from "../src/lib/excel/templateMap";

const args = process.argv.slice(2);
const outputPath = args.find((arg) => !arg.startsWith("--"));
const templatePath = args.find((arg) => !arg.startsWith("--") && arg !== outputPath) ?? "templates/template.xlsx";
const expectedProductsArg = args.find((arg) => arg.startsWith("--expected-products="));
const expectedProducts = expectedProductsArg ? Number(expectedProductsArg.split("=")[1]) : undefined;
const expectedCurrencyArg = args.find((arg) => arg.startsWith("--expected-currency="));
const expectedCurrency = expectedCurrencyArg?.split("=")[1]?.toUpperCase();
const manualBaseRateArg = args.find((arg) => arg.startsWith("--manual-base-rate="));
const manualBaseRate = manualBaseRateArg ? Number(manualBaseRateArg.split("=")[1]) : undefined;
const marginArg = args.find((arg) => arg.startsWith("--margin="));
const exchangeRateMargin = marginArg ? Number(marginArg.split("=")[1]) : undefined;
const sourceUsdArg = args.find((arg) => arg.startsWith("--source-usd="));
const sourceUsd = sourceUsdArg ? Number(sourceUsdArg.split("=")[1]) : 33;

const forbiddenProductTerms: Array<{ label: string; pattern: RegExp }> = [
  { label: "Los Leones", pattern: /los leones/i },
  { label: "Casa Matriz", pattern: /casa matriz/i },
  { label: "Fono", pattern: /(^|[^a-zÃ¡Ã©Ã­Ã³ÃºÃ±])fono([^a-zÃ¡Ã©Ã­Ã³ÃºÃ±]|$)/i },
  { label: "Telefono", pattern: /\btel[eÃ©]fono\b/i },
  { label: "miercoles", pattern: /mi[eÃ©]rcoles/i },
  { label: "Santiago", pattern: /\bsantiago\b/i },
  { label: "Personas naturales", pattern: /personas naturales/i },
  { label: "Pagina", pattern: /p[Ã¡a]gina/i },
  { label: "Condiciones Comerciales", pattern: /condiciones comerciales/i },
  { label: "Plazo de Entrega", pattern: /plazo de entrega/i },
  { label: "Email", pattern: /\bemail\b/i },
  { label: "www.", pattern: /www\./i },
  { label: "Banco", pattern: /\bbanco\b/i },
  { label: "Rut", pattern: /\brut\b|r\.u\.t\./i }
];

function fail(message: string): never {
  throw new Error(message);
}

function cellText(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("formula" in value) return "";
  }
  return String(value);
}

function comparableMerges(worksheet: ExcelJS.Worksheet) {
  return [...(((worksheet as unknown as { model: { merges?: string[] } }).model.merges ?? []) as string[])].sort();
}

function hasVisibleCurrencyFormat(cell: ExcelJS.Cell) {
  const format = cell.numFmt ?? "";
  return format.includes("US$") || format.includes("$");
}

function currencyFromFormat(cell: ExcelJS.Cell) {
  const format = cell.numFmt ?? "";
  if (format.includes("US$")) return "USD";
  if (format.includes("$")) return "CLP";
  return "UNKNOWN";
}

function hasCellContent(value: ExcelJS.CellValue) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasFormula(cell: ExcelJS.Cell) {
  const value = cell.value;
  return Boolean(
    cell.formula ||
      (value && typeof value === "object" && "formula" in value && typeof value.formula === "string")
  );
}

function numericCellValue(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    typeof value.result === "number" &&
    Number.isFinite(value.result)
  ) {
    return value.result;
  }
  return undefined;
}

function hasResidualPriceContent(cell: ExcelJS.Cell) {
  return hasFormula(cell) || hasCellContent(cell.value);
}

function compareWorksheetFormat(template: ExcelJS.Worksheet, output: ExcelJS.Worksheet) {
  const templateMerges = comparableMerges(template).join("|");
  const outputMerges = comparableMerges(output).join("|");
  if (templateMerges !== outputMerges) fail("Las celdas combinadas no coinciden con la plantilla.");

  for (let column = 1; column <= 16; column += 1) {
    if (template.getColumn(column).width !== output.getColumn(column).width) {
      fail(`El ancho de la columna ${column} no coincide con la plantilla.`);
    }
  }

  for (let row = 1; row <= 50; row += 1) {
    const isProductRow = row >= TEMPLATE_MAP.productStartRow && row <= TEMPLATE_MAP.productEndRow;
    if (!isProductRow && template.getRow(row).height !== output.getRow(row).height) {
      fail(`El alto de la fila ${row} no coincide con la plantilla.`);
    }
  }
}

function validateExpectedClpTotalRow(outputSheet: ExcelJS.Worksheet) {
  for (const block of TEMPLATE_MAP.supplierBlocks) {
    const totalCell = outputSheet.getCell(TEMPLATE_MAP.rows.total, block.totalColumn);
    if (/US\$/i.test(cellText(totalCell.value)) || /US\$/i.test(totalCell.numFmt ?? "")) {
      fail(`TOTAL contiene US$ en columna ${block.totalColumn}.`);
    }

    if (hasCellContent(totalCell.value) && currencyFromFormat(totalCell) !== "CLP") {
      fail(`TOTAL debe tener formato CLP en columna ${block.totalColumn}.`);
    }
  }
}

function validateOptionalManualConversion(numericPriceValues: number[]) {
  if (manualBaseRate === undefined && exchangeRateMargin === undefined) return;

  if (
    typeof manualBaseRate !== "number" ||
    typeof exchangeRateMargin !== "number" ||
    !Number.isFinite(manualBaseRate) ||
    !Number.isFinite(exchangeRateMargin) ||
    !Number.isFinite(sourceUsd)
  ) {
    fail("--manual-base-rate, --margin y --source-usd deben ser numeros validos.");
  }

  const finalRate = manualBaseRate + exchangeRateMargin;
  const expectedValue = Math.round(sourceUsd * finalRate);
  if (!numericPriceValues.some((value) => Math.round(value) === expectedValue)) {
    fail(`No se encontro conversion manual esperada: ${sourceUsd} USD * ${finalRate} = ${expectedValue} CLP.`);
  }
}

function validateNoResidualDynamicPrices(outputSheet: ExcelJS.Worksheet, supplierNames: string[]) {
  for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
    const product = cellText(outputSheet.getCell(row, TEMPLATE_MAP.columns.product).value).trim();

    for (const block of TEMPLATE_MAP.supplierBlocks) {
      const unitPriceCell = outputSheet.getCell(row, block.unitPriceColumn);
      const totalCell = outputSheet.getCell(row, block.totalColumn);

      if (!product && (hasResidualPriceContent(unitPriceCell) || hasResidualPriceContent(totalCell))) {
        fail("Se detectaron valores residuales en filas vacÃ­as de la plantilla.");
      }
    }
  }

  for (const [index, block] of TEMPLATE_MAP.supplierBlocks.entries()) {
    if (supplierNames[index]) continue;

    for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
      const unitPriceCell = outputSheet.getCell(row, block.unitPriceColumn);
      const totalCell = outputSheet.getCell(row, block.totalColumn);
      if (hasResidualPriceContent(unitPriceCell) || hasResidualPriceContent(totalCell)) {
        fail("Se detectaron valores residuales en columnas de proveedor no usado.");
      }
    }

    for (const row of [TEMPLATE_MAP.rows.total, TEMPLATE_MAP.rows.purchase]) {
      const unitPriceCell = outputSheet.getCell(row, block.unitPriceColumn);
      const totalCell = outputSheet.getCell(row, block.totalColumn);
      if (hasResidualPriceContent(unitPriceCell) || hasResidualPriceContent(totalCell)) {
        fail("Se detectaron valores residuales en columnas de proveedor no usado.");
      }
    }
  }
}

function validateLineTotalsAndPurchaseTotals(outputSheet: ExcelJS.Worksheet, supplierNames: string[]) {
  const supplierTotals = new Map<number, number>();
  const tolerance = 2;

  for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
    const product = cellText(outputSheet.getCell(row, TEMPLATE_MAP.columns.product).value).trim();
    if (!product) continue;

    const quantity = numericCellValue(outputSheet.getCell(row, TEMPLATE_MAP.columns.quantity));
    if (quantity === undefined || quantity <= 0) {
      fail(`Cantidad invÃ¡lida en fila ${row}; no se puede validar TOTAL.`);
    }

    for (const [supplierIndex, block] of TEMPLATE_MAP.supplierBlocks.entries()) {
      const supplierName = supplierNames[supplierIndex];
      if (!supplierName) continue;

      const unitPrice = numericCellValue(outputSheet.getCell(row, block.unitPriceColumn));
      const total = numericCellValue(outputSheet.getCell(row, block.totalColumn));

      if (unitPrice === undefined && total === undefined) continue;
      if (unitPrice !== undefined && total === undefined) {
        fail(`TOTAL vacÃ­o en fila ${row} proveedor ${supplierName}.`);
      }
      if (unitPrice === undefined || total === undefined) continue;

      const expected = unitPrice * quantity;
      if (Math.abs(total - expected) > tolerance) {
        fail(`TOTAL incorrecto en fila ${row} proveedor ${supplierName}: esperado P_UNIT Ã— CANT.`);
      }

      supplierTotals.set(supplierIndex, (supplierTotals.get(supplierIndex) ?? 0) + total);
    }
  }

  for (const [supplierIndex, expectedTotal] of supplierTotals.entries()) {
    const supplierName = supplierNames[supplierIndex];
    const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const purchaseCells = [
      outputSheet.getCell(TEMPLATE_MAP.rows.total, block.unitPriceColumn),
      outputSheet.getCell(TEMPLATE_MAP.rows.total, block.totalColumn)
    ];

    for (const purchaseCell of purchaseCells) {
      if (hasFormula(purchaseCell)) {
        fail(`TOTAL COMPRA no debe depender de fÃ³rmula sin valor visible para proveedor ${supplierName}.`);
      }

      const purchaseTotal = numericCellValue(purchaseCell);
      if (purchaseTotal === undefined) {
        fail(`TOTAL COMPRA vacÃ­o para proveedor ${supplierName}.`);
      }

      if (Math.abs(purchaseTotal - expectedTotal) > tolerance) {
        fail(`TOTAL COMPRA incorrecto para proveedor ${supplierName}: debe sumar los TOTAL por producto.`);
      }
    }
  }
}

async function main() {
  if (!outputPath) {
    fail(
      "Uso: npm run validate:output -- <output.xlsx> [templates/template.xlsx] [--expected-products=N] [--expected-currency=CLP|USD] [--manual-base-rate=900 --margin=5 --source-usd=33]"
    );
  }

  const templateWorkbook = new ExcelJS.Workbook();
  await templateWorkbook.xlsx.readFile(templatePath);
  const templateSheet = templateWorkbook.getWorksheet(TEMPLATE_MAP.sheetName);
  if (!templateSheet) fail(`No existe la hoja ${TEMPLATE_MAP.sheetName} en la plantilla.`);

  const outputWorkbook = new ExcelJS.Workbook();
  await outputWorkbook.xlsx.readFile(outputPath);
  const outputSheet = outputWorkbook.getWorksheet(TEMPLATE_MAP.sheetName);
  if (!outputSheet) fail(`No existe la hoja ${TEMPLATE_MAP.sheetName} en el Excel generado.`);

  compareWorksheetFormat(templateSheet, outputSheet);

  let productCount = 0;
  for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
    const product = cellText(outputSheet.getCell(row, TEMPLATE_MAP.columns.product).value).trim();
    const unit = cellText(outputSheet.getCell(row, TEMPLATE_MAP.columns.unit).value).trim();

    if (product) {
      productCount += 1;
      const productCell = outputSheet.getCell(row, TEMPLATE_MAP.columns.product);
      if (!productCell.alignment?.wrapText) {
        fail(`Producto sin ajuste de texto en fila ${row}.`);
      }
      for (const term of forbiddenProductTerms) {
        if (term.pattern.test(product)) {
          fail(`Producto basura detectado en fila ${row}: "${product}" contiene "${term.label}".`);
        }
      }
    }

    if (/USD|CLP|US\$|\$/i.test(unit)) fail(`UM contiene moneda en fila ${row}: "${unit}".`);
    if (unit && unit !== "CU") fail(`UM invalida en fila ${row}: "${unit}". Debe ser CU o vacio.`);

    for (const block of TEMPLATE_MAP.supplierBlocks) {
      const unitPriceCell = outputSheet.getCell(row, block.unitPriceColumn);
      const totalCell = outputSheet.getCell(row, block.totalColumn);
      const unitPrice = unitPriceCell.value;
      const total = totalCell.value;

      if (unitPrice === 0 || total === 0) {
        fail(`Oferta en cero detectada en fila ${row}, columnas ${block.unitPriceColumn}/${block.totalColumn}.`);
      }

      if (typeof unitPrice === "number" && !hasVisibleCurrencyFormat(unitPriceCell)) {
        fail(`Precio unitario sin formato de moneda visible en fila ${row}, columna ${block.unitPriceColumn}.`);
      }

      if (typeof total === "number" && !hasVisibleCurrencyFormat(totalCell)) {
        fail(`Total sin formato de moneda visible en fila ${row}, columna ${block.totalColumn}.`);
      }
    }
  }

  if (productCount > TEMPLATE_MAP.productEndRow - TEMPLATE_MAP.productStartRow + 1) {
    fail("El Excel tiene mas productos que la capacidad de la plantilla.");
  }

  if (expectedProducts !== undefined) {
    if (!Number.isInteger(expectedProducts) || expectedProducts < 0) {
      fail("--expected-products debe ser un numero entero valido.");
    }
    if (productCount !== expectedProducts) {
      fail(`Cantidad de productos invalida: esperado ${expectedProducts}, encontrado ${productCount}.`);
    }
  }

  if (expectedCurrency !== undefined && expectedCurrency !== "CLP" && expectedCurrency !== "USD") {
    fail("--expected-currency debe ser CLP o USD.");
  }

  const supplierNames = TEMPLATE_MAP.supplierBlocks.map((block) =>
    cellText(outputSheet.getCell(block.supplierNameCell).value).trim()
  );
  if (supplierNames.every((name) => !name)) fail("No hay proveedores escritos en los bloques de columnas.");
  validateNoResidualDynamicPrices(outputSheet, supplierNames);
  validateLineTotalsAndPurchaseTotals(outputSheet, supplierNames);

  if (expectedCurrency) {
    const numericPriceValues: number[] = [];

    for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
      const product = cellText(outputSheet.getCell(row, TEMPLATE_MAP.columns.product).value).trim();

      for (const block of TEMPLATE_MAP.supplierBlocks) {
        const unitPriceCell = outputSheet.getCell(row, block.unitPriceColumn);
        const totalCell = outputSheet.getCell(row, block.totalColumn);
        const unitPrice = unitPriceCell.value;
        const total = totalCell.value;

        if (expectedCurrency === "CLP") {
          for (const priceCell of [
            { label: "precio unitario", cell: unitPriceCell, value: unitPrice, column: block.unitPriceColumn },
            { label: "total", cell: totalCell, value: total, column: block.totalColumn }
          ]) {
            const text = cellText(priceCell.value);
            if (/US\$/i.test(text) || /US\$/i.test(priceCell.cell.numFmt ?? "")) {
              fail(`${priceCell.label} contiene US$ en fila ${row}, columna ${priceCell.column}.`);
            }

            if (product && hasCellContent(priceCell.value) && typeof priceCell.value !== "number") {
              fail(`${priceCell.label} debe ser numerico en CLP en fila ${row}, columna ${priceCell.column}.`);
            }

            if (typeof priceCell.value === "number") {
              numericPriceValues.push(priceCell.value);
            }
          }
        }

        if (typeof unitPrice === "number" && currencyFromFormat(unitPriceCell) !== expectedCurrency) {
          fail(`Formato de moneda invalido en fila ${row}, columna ${block.unitPriceColumn}: esperado ${expectedCurrency}.`);
        }

        if (typeof total === "number" && currencyFromFormat(totalCell) !== expectedCurrency) {
          fail(`Formato de moneda invalido en fila ${row}, columna ${block.totalColumn}: esperado ${expectedCurrency}.`);
        }
      }
    }

    if (expectedCurrency === "CLP") {
      validateExpectedClpTotalRow(outputSheet);
      validateOptionalManualConversion(numericPriceValues);
    }
  }

  console.log(`Validacion OK: ${productCount} productos, proveedores: ${supplierNames.filter(Boolean).join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
