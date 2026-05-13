import type ExcelJS from "exceljs";
import { TEMPLATE_MAP } from "@/lib/excel/templateMap";

function hasFormula(cell: ExcelJS.Cell) {
  const value = cell.value;
  return Boolean(
    cell.formula ||
      (value && typeof value === "object" && "formula" in value && typeof value.formula === "string")
  );
}

function clearCellIfNotFormula(cell: ExcelJS.Cell) {
  if (!hasFormula(cell)) {
    cell.value = null;
  }
}

export function clearTemplateDynamicFields(worksheet: ExcelJS.Worksheet) {
  for (let row = TEMPLATE_MAP.productStartRow; row <= TEMPLATE_MAP.productEndRow; row += 1) {
    clearCellIfNotFormula(worksheet.getCell(row, TEMPLATE_MAP.columns.item));
    clearCellIfNotFormula(worksheet.getCell(row, TEMPLATE_MAP.columns.product));
    clearCellIfNotFormula(worksheet.getCell(row, TEMPLATE_MAP.columns.quantity));
    clearCellIfNotFormula(worksheet.getCell(row, TEMPLATE_MAP.columns.unit));

    for (const block of TEMPLATE_MAP.supplierBlocks) {
      clearCellIfNotFormula(worksheet.getCell(row, block.unitPriceColumn));
      clearCellIfNotFormula(worksheet.getCell(row, block.totalColumn));
    }
  }

  for (const block of TEMPLATE_MAP.supplierBlocks) {
    clearCellIfNotFormula(worksheet.getCell(block.supplierNameCell));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.purchase, block.unitPriceColumn));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.purchase, block.totalColumn));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.credit, block.unitPriceColumn));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.paymentCondition, block.unitPriceColumn));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.deliveryTime, block.unitPriceColumn));
    clearCellIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.total, block.unitPriceColumn));
  }
}
