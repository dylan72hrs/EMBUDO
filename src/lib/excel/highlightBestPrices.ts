import type ExcelJS from "exceljs";
import type { TEMPLATE_MAP } from "@/lib/excel/templateMap";
import type { ComparisonItem, SupplierSummary } from "@/lib/validations/quoteSchemas";

type TemplateMap = typeof TEMPLATE_MAP;

const WINNER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2F0D9" }
};

const LOSER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFCE4D6" }
};

function hasFormula(cell: ExcelJS.Cell) {
  const value = cell.value;
  return Boolean(
    cell.formula ||
      (value && typeof value === "object" && "formula" in value && typeof value.formula === "string")
  );
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function comparablePrice(item: ComparisonItem, supplierName: string) {
  const offer = item.offers[supplierName];
  if (!offer) return undefined;
  if (validPrice(offer.total)) return offer.total;
  if (validPrice(offer.unitPrice)) return offer.unitPrice;
  return undefined;
}

function applyFill(cell: ExcelJS.Cell, fill: ExcelJS.Fill) {
  if (hasFormula(cell) || !validPrice(cell.value)) return;
  cell.fill = fill;
}

export function highlightBestPrices(
  worksheet: ExcelJS.Worksheet,
  comparison: ComparisonItem[],
  suppliers: SupplierSummary[],
  templateMap: TemplateMap
) {
  const maxItems = templateMap.productEndRow - templateMap.productStartRow + 1;
  const itemsToHighlight = comparison.slice(0, maxItems);
  const suppliersToCheck = suppliers.slice(0, templateMap.supplierBlocks.length);

  for (const [itemIndex, item] of itemsToHighlight.entries()) {
    const rowNumber = templateMap.productStartRow + itemIndex;
    const candidates = suppliersToCheck.flatMap((supplier, supplierIndex) => {
      const amount = comparablePrice(item, supplier.name);
      if (amount === undefined) return [];

      return [
        {
          amount,
          block: templateMap.supplierBlocks[supplierIndex]
        }
      ];
    });

    if (candidates.length === 0) continue;

    const lowest = Math.min(...candidates.map((candidate) => candidate.amount));

    for (const candidate of candidates) {
      const fill = candidate.amount === lowest ? WINNER_FILL : LOSER_FILL;
      applyFill(worksheet.getCell(rowNumber, candidate.block.unitPriceColumn), fill);
      applyFill(worksheet.getCell(rowNumber, candidate.block.totalColumn), fill);
    }
  }
}
