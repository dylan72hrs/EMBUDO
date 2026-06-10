import type ExcelJS from "exceljs";
import type { TEMPLATE_MAP } from "@/lib/excel/templateMap";
import type { ComparisonItem, SupplierSummary } from "@/lib/validations/quoteSchemas";

type TemplateMap = typeof TEMPLATE_MAP;

export const WINNER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFC6EFCE" }
};

export const LOSER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" }
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
  return (
    fill.fgColor.argb === "FFC6EFCE" ||
    fill.fgColor.argb === "FFFFC7CE" ||
    // legacy values in case template already has old colors
    fill.fgColor.argb === "FFE2F0D9" ||
    fill.fgColor.argb === "FFFCE4D6"
  );
}

function clearComparisonFill(cell: ExcelJS.Cell) {
  if (hasFormula(cell) || !validPrice(cell.value)) return;
  if (isComparisonFill(cell.fill)) {
    cell.style = { ...cell.style, fill: undefined };
  }
}

export type CascadeRowItem = {
  supplierIndex: number;
  itemNumber: number;
  rowNumber: number;
  price: number | null;
  unitPriceColumn: number;
  totalColumn: number;
};

export function highlightCascadePrices(
  worksheet: ExcelJS.Worksheet,
  rowItems: CascadeRowItem[]
) {
  const byItem = new Map<number, CascadeRowItem[]>();
  for (const ri of rowItems) {
    if (!byItem.has(ri.itemNumber)) byItem.set(ri.itemNumber, []);
    byItem.get(ri.itemNumber)!.push(ri);
  }

  for (const entries of byItem.values()) {
    const valid = entries.filter((e) => validPrice(e.price));
    if (valid.length < 2) continue;

    const prices = valid.map((e) => e.price as number);
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);

    // All prices identical → nothing to highlight
    if (lowest === highest) continue;

    for (const entry of valid) {
      const fill =
        entry.price === lowest ? WINNER_FILL : entry.price === highest ? LOSER_FILL : undefined;
      if (!fill) continue;
      const unitCell = worksheet.getCell(entry.rowNumber, entry.unitPriceColumn);
      const totalCell = worksheet.getCell(entry.rowNumber, entry.totalColumn);
      applyFill(unitCell, fill);
      applyFill(totalCell, fill);
    }
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

    // All prices identical → clear any stale highlight, don't add new one
    if (lowest === highest) {
      for (const candidate of candidates) {
        clearComparisonFill(worksheet.getCell(rowNumber, candidate.block.unitPriceColumn));
        clearComparisonFill(worksheet.getCell(rowNumber, candidate.block.totalColumn));
      }
      continue;
    }

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
