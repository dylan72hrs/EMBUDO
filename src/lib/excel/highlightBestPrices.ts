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

function isComparisonFill(fill: ExcelJS.Fill | undefined) {
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return false;
  if (!fill.fgColor?.argb) return false;
  return fill.fgColor.argb === "FFE2F0D9" || fill.fgColor.argb === "FFFCE4D6";
}

function clearComparisonFill(cell: ExcelJS.Cell) {
  if (hasFormula(cell) || !validPrice(cell.value)) return;
  if (isComparisonFill(cell.fill)) {
    cell.style = { ...cell.style, fill: undefined };
  }
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

    const rowCells = candidates.flatMap((candidate) => [
      worksheet.getCell(rowNumber, candidate.block.unitPriceColumn),
      worksheet.getCell(rowNumber, candidate.block.totalColumn)
    ]);

    if (candidates.length < 2) {
      for (const cell of rowCells) {
        clearComparisonFill(cell);
      }
      continue;
    }

    const lowest = Math.min(...candidates.map((candidate) => candidate.amount));
    const highest = Math.max(...candidates.map((candidate) => candidate.amount));

    for (const candidate of candidates) {
      const fill =
        candidate.amount === lowest
          ? WINNER_FILL
          : candidate.amount === highest
            ? LOSER_FILL
            : undefined;
      if (!fill) {
        clearComparisonFill(worksheet.getCell(rowNumber, candidate.block.unitPriceColumn));
        clearComparisonFill(worksheet.getCell(rowNumber, candidate.block.totalColumn));
        continue;
      }
      applyFill(worksheet.getCell(rowNumber, candidate.block.unitPriceColumn), fill);
      applyFill(worksheet.getCell(rowNumber, candidate.block.totalColumn), fill);
    }
  }
}
