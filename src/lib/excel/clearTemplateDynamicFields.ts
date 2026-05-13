import type ExcelJS from "exceljs";
import { TEMPLATE_MAP } from "@/lib/excel/templateMap";

const FIRST_DYNAMIC_COLUMN = TEMPLATE_MAP.columns.item;
const LAST_DYNAMIC_COLUMN =
  TEMPLATE_MAP.supplierBlocks[TEMPLATE_MAP.supplierBlocks.length - 1]?.totalColumn ?? 16;
const LOWER_COMPARISON_START_ROW = 44;

function clearValue(cell: ExcelJS.Cell) {
  cell.value = null;
}

function clearComparisonFill(cell: ExcelJS.Cell) {
  cell.style = {
    ...cell.style,
    fill: undefined
  };
}

function clearRangeValues(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number
) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      clearValue(worksheet.getCell(row, column));
    }
  }
}

function clearProductRows(worksheet: ExcelJS.Worksheet) {
  clearRangeValues(
    worksheet,
    TEMPLATE_MAP.productStartRow,
    TEMPLATE_MAP.productEndRow,
    FIRST_DYNAMIC_COLUMN,
    LAST_DYNAMIC_COLUMN
  );

  for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
    for (const block of TEMPLATE_MAP.supplierBlocks) {
      clearComparisonFill(worksheet.getCell(row, block.unitPriceColumn));
      clearComparisonFill(worksheet.getCell(row, block.totalColumn));
    }
  }
}

function clearSupplierHeaders(worksheet: ExcelJS.Worksheet) {
  for (const block of TEMPLATE_MAP.supplierBlocks) {
    clearValue(worksheet.getCell(block.supplierNameCell));
  }
}

function clearSupplierDynamicRows(worksheet: ExcelJS.Worksheet) {
  const rowsToClear = [
    TEMPLATE_MAP.rows.total,
    TEMPLATE_MAP.rows.purchase,
    TEMPLATE_MAP.rows.credit,
    TEMPLATE_MAP.rows.paymentCondition,
    TEMPLATE_MAP.rows.deliveryTime,
    34,
    35
  ];

  for (const row of rowsToClear) {
    clearRangeValues(worksheet, row, row, TEMPLATE_MAP.supplierBlocks[0].unitPriceColumn, LAST_DYNAMIC_COLUMN);
  }
}

function clearLowerDynamicSections(worksheet: ExcelJS.Worksheet) {
  worksheet.getCell("A37").value = "CRITERIO DE ADJUDICACIÓN:";
  clearRangeValues(worksheet, 39, 40, 3, LAST_DYNAMIC_COLUMN);

  const lastRow = Math.max(worksheet.rowCount, LOWER_COMPARISON_START_ROW);
  clearRangeValues(worksheet, LOWER_COMPARISON_START_ROW, lastRow, FIRST_DYNAMIC_COLUMN, LAST_DYNAMIC_COLUMN);
}

export function clearTemplateDynamicFields(worksheet: ExcelJS.Worksheet) {
  clearProductRows(worksheet);
  clearSupplierHeaders(worksheet);
  clearSupplierDynamicRows(worksheet);
  clearLowerDynamicSections(worksheet);
}
