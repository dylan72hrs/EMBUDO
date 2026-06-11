import path from "node:path";
import ExcelJS from "exceljs";
import { clearTemplateDynamicFields } from "@/lib/excel/clearTemplateDynamicFields";
import { highlightBestPrices, highlightCascadePrices, type CascadeRowItem } from "@/lib/excel/highlightBestPrices";
import { writeDashboardData, writeDashboardPanel } from "@/lib/excel/writeDashboard";
import { injectDashboardCharts, stripDashboardCharts } from "@/lib/excel/injectDashboardCharts";
import { TEMPLATE_MAP } from "@/lib/excel/templateMap";
import { outputExcelPath } from "@/lib/utils/fileStorage";
import type { ComparisonItem, ConsolidatedComparison, Currency, SupplierOffer } from "@/lib/validations/quoteSchemas";

type GenerateResult = {
  outputPath: string;
  warnings: string[];
};

type CascadeBlock = {
  supplierIndex: number;
  supplierName: string;
  items: Array<{
    item: number;
    product: string;
    quantity: number;
    unit: string;
    unitPrice: number | null;
    total: number | null;
    currency: Currency;
  }>;
};

type CascadeWriteResult = {
  footerRowOffset: number;
  finalDataRow: number;
  blocks: CascadeBlock[];
  rowItems: CascadeRowItem[];
};

export type SupplierEvaluationInput = {
  supplierName: string;
  paymentCondition?: string;
  deliveryTime?: string;
  availability?: string;
  associatedCosts?: string;
  creditStatus?: string;
  providerEvaluation?: string;
};

export type AdditionalEvaluationData = {
  awardCriteria?: string;
  awardResponsible?: string;
  buyerResponsible?: string;
  urgency?: string;
  budgetObjective?: number | null;
  supplierEvaluations: SupplierEvaluationInput[];
};

export type GenerateComparisonExcelOptions = {
  folio?: string;
  additionalEvaluation?: AdditionalEvaluationData;
  omittedFilesCount?: number;
  needsReviewCount?: number;
};

function writeFolioCell(worksheet: ExcelJS.Worksheet, folio: string) {
  const folioCell = worksheet.getCell(TEMPLATE_MAP.cells.folio);
  writeDynamicCell(folioCell, `Folio comparativa: ${folio.trim()}`);
  cloneCellStyle(folioCell);
  folioCell.font = { ...(folioCell.font ?? {}), bold: true, size: 9 };
  folioCell.alignment = { ...(folioCell.alignment ?? {}), horizontal: "left", vertical: "middle" };
}

function hasFormula(cell: ExcelJS.Cell) {
  const value = cell.value;
  return Boolean(
    cell.formula ||
      (value && typeof value === "object" && "formula" in value && typeof value.formula === "string")
  );
}

function writeIfNotFormula(cell: ExcelJS.Cell, value: ExcelJS.CellValue) {
  if (!hasFormula(cell)) {
    cell.value = value;
  }
}

function writeDynamicCell(cell: ExcelJS.Cell, value: ExcelJS.CellValue) {
  cloneCellStyle(cell);
  cell.value = value;
}

function cloneCellStyle(cell: ExcelJS.Cell) {
  cell.style = {
    ...cell.style,
    font: cell.style.font ? { ...cell.style.font } : undefined,
    alignment: cell.style.alignment ? { ...cell.style.alignment } : undefined,
    border: cell.style.border ? { ...cell.style.border } : undefined,
    fill: cell.style.fill ? { ...cell.style.fill } : undefined
  };
}

function applyCurrencyFormat(cell: ExcelJS.Cell, currency: Currency) {
  cloneCellStyle(cell);

  if (currency === "USD") {
    cell.numFmt = '"US$" #,##0.00';
    return;
  }

  if (currency === "CLP") {
    cell.numFmt = '"$" #,##0';
    return;
  }

  cell.numFmt = "General";
}

function normalizeText(value?: string) {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasText(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findRowByLabel(worksheet: ExcelJS.Worksheet, label: string, fallbackRow: number) {
  const normalizedTarget = normalizeLabel(label);
  for (let row = 1; row <= worksheet.rowCount; row += 1) {
    const rowValues = worksheet.getRow(row).values;
    const valuesArray = Array.isArray(rowValues) ? rowValues : [];
    const hasLabel = valuesArray.some((value) => normalizeLabel(value).includes(normalizedTarget));
    if (hasLabel) return row;
  }
  return fallbackRow;
}

function parseAssociatedCostsValue(value?: string) {
  if (!value) return null;
  const normalized = value.replace(/[^\d.,-]/g, "").replace(/\./g, "");
  const parsed = Number(normalized.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function applyBlockBorders(
  worksheet: ExcelJS.Worksheet,
  endRow: number = TEMPLATE_MAP.rows.associatedCosts
) {
  const mediumSide: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };

  for (const [index, block] of TEMPLATE_MAP.supplierBlocks.entries()) {
    const headerCell = worksheet.getCell(block.supplierNameCell);
    cloneCellStyle(headerCell);
    headerCell.alignment = { ...headerCell.alignment, horizontal: "center", vertical: "middle" };

    if (index % 2 === 1) {
      headerCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F1F1F" }
      };
    }

    for (let row = TEMPLATE_MAP.headerRows.supplierName; row <= endRow; row += 1) {
      const leftCell = worksheet.getCell(row, block.unitPriceColumn);
      const rightCell = worksheet.getCell(row, block.totalColumn);

      cloneCellStyle(leftCell);
      cloneCellStyle(rightCell);

      leftCell.border = {
        ...leftCell.border,
        left: mediumSide
      };

      rightCell.border = {
        ...rightCell.border,
        right: mediumSide
      };
    }
  }
}

function productRowHeight(description: string) {
  if (description.length > 220) return 72;
  if (description.length > 140) return 54;
  if (description.length > 90) return 40;
  return undefined;
}

function validPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizedQuantity(quantity: number) {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function normalizeOfferForQuantity(offer: SupplierOffer, quantity: number): SupplierOffer {
  if (validPositive(offer.unitPrice)) {
    return {
      ...offer,
      total: offer.unitPrice * quantity
    };
  }

  if (validPositive(offer.total)) {
    return {
      ...offer,
      unitPrice: offer.total / quantity
    };
  }

  return {
    ...offer,
    unitPrice: null,
    total: null
  };
}

function normalizeComparisonItems(items: ComparisonItem[]) {
  return items.map((item) => {
    const quantity = normalizedQuantity(item.quantity);
    return {
      ...item,
      quantity,
      offers: Object.fromEntries(
        Object.entries(item.offers).map(([supplierName, offer]) => [
          supplierName,
          normalizeOfferForQuantity(offer, quantity)
        ])
      )
    };
  });
}

function offerCurrency(offers: Array<SupplierOffer | undefined>): Currency {
  return offers.find((offer) => offer && offer.currency !== "UNKNOWN")?.currency ?? "CLP";
}

function resolvedOfferForRow(offer: SupplierOffer | undefined, quantity: number): SupplierOffer | undefined {
  if (!offer) return undefined;
  return normalizeOfferForQuantity(offer, quantity);
}

function shiftedTemplateRow(row: number, footerRowOffset: number) {
  return row + footerRowOffset;
}

function mergeRanges(worksheet: ExcelJS.Worksheet) {
  return [
    ...(((worksheet as unknown as { model: { merges?: string[] } }).model.merges ?? []) as string[])
  ];
}

function shiftedMergeRange(range: string, insertAtRow: number, insertedRows: number) {
  return range.replace(/(\$?[A-Z]+)(\$?)(\d+)/g, (cell, column: string, absolute: string, rowText: string) => {
    const row = Number(rowText);
    if (row < insertAtRow) return cell;
    return `${column}${absolute}${row + insertedRows}`;
  });
}

function copyProductRowStyle(
  worksheet: ExcelJS.Worksheet,
  sourceRowNumber: number,
  targetRowNumber: number
) {
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;

  const lastProductColumn =
    TEMPLATE_MAP.supplierBlocks[TEMPLATE_MAP.supplierBlocks.length - 1].totalColumn;
  for (let column = TEMPLATE_MAP.columns.item; column <= lastProductColumn; column += 1) {
    const sourceCell = worksheet.getCell(sourceRowNumber, column);
    const targetCell = worksheet.getCell(targetRowNumber, column);
    targetCell.style = sourceCell.style;
    cloneCellStyle(targetCell);
    targetCell.value = null;
  }
}

function insertStyledProductRows(worksheet: ExcelJS.Worksheet, rowCount: number) {
  if (rowCount <= 0) return;

  const insertAtRow = TEMPLATE_MAP.productEndRow + 1;
  const rangesToShift = mergeRanges(worksheet).filter((range) => {
    const firstCell = range.split(":")[0];
    return Number(worksheet.getCell(firstCell).row) >= insertAtRow;
  });

  for (const range of rangesToShift) {
    worksheet.unMergeCells(range);
  }

  worksheet.spliceRows(
    insertAtRow,
    0,
    ...Array.from({ length: rowCount }, () => [] as ExcelJS.CellValue[])
  );

  for (let index = 0; index < rowCount; index += 1) {
    copyProductRowStyle(worksheet, TEMPLATE_MAP.productEndRow, insertAtRow + index);
  }

  for (const range of rangesToShift) {
    worksheet.mergeCells(shiftedMergeRange(range, insertAtRow, rowCount));
  }
}

function cascadeLastItemRow(blocks: CascadeBlock[]) {
  let rowNumber = TEMPLATE_MAP.productStartRow;
  let lastItemRow = TEMPLATE_MAP.productStartRow - 1;

  for (const [blockIndex, block] of blocks.entries()) {
    for (const _item of block.items) {
      lastItemRow = rowNumber;
      rowNumber += 1;
    }

    if (blockIndex < blocks.length - 1) {
      rowNumber += 3;
    }
  }

  return lastItemRow;
}

function writeCascadeBlocks(
  worksheet: ExcelJS.Worksheet,
  cascadeBlocks: CascadeBlock[],
  suppliers: ConsolidatedComparison["suppliers"],
  options: { warnings: string[] }
): CascadeWriteResult {
  const blocks = cascadeBlocks.filter(
    (block) =>
      block.supplierIndex >= 0 &&
      block.supplierIndex < suppliers.length &&
      block.supplierIndex < TEMPLATE_MAP.supplierBlocks.length
  );
  const lastItemRow = cascadeLastItemRow(blocks);
  const finalDataRow = Math.max(TEMPLATE_MAP.rows.total, lastItemRow + 3);
  const footerRowOffset = finalDataRow - TEMPLATE_MAP.rows.total;

  insertStyledProductRows(worksheet, footerRowOffset);

  const rowItems: CascadeRowItem[] = [];
  let rowNumber = TEMPLATE_MAP.productStartRow;
  for (const [blockIndex, block] of blocks.entries()) {
    const ownerBlock = TEMPLATE_MAP.supplierBlocks[block.supplierIndex];

    for (const item of block.items) {
      const row = worksheet.getRow(rowNumber);
      writeDynamicCell(worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.item), item.item);

      const productCell = worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.product);
      writeDynamicCell(productCell, item.product);
      productCell.alignment = { ...productCell.alignment, wrapText: true, vertical: "middle" };
      row.height = productRowHeight(item.product) ?? row.height;

      writeDynamicCell(worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.quantity), item.quantity);
      writeDynamicCell(worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.unit), item.unit);

      for (const supplierBlock of TEMPLATE_MAP.supplierBlocks) {
        writeDynamicCell(worksheet.getCell(rowNumber, supplierBlock.unitPriceColumn), null);
        writeDynamicCell(worksheet.getCell(rowNumber, supplierBlock.totalColumn), null);
      }

      const unitPriceCell = worksheet.getCell(rowNumber, ownerBlock.unitPriceColumn);
      const totalCell = worksheet.getCell(rowNumber, ownerBlock.totalColumn);
      writeDynamicCell(unitPriceCell, item.unitPrice);
      writeDynamicCell(totalCell, item.total);
      applyCurrencyFormat(unitPriceCell, item.currency);
      applyCurrencyFormat(totalCell, item.currency);

      if (item.currency === "UNKNOWN") {
        options.warnings.push(`Moneda no determinada para ${item.product} - ${block.supplierName}`);
      }

      const cascadePrice = validPositive(item.total)
        ? item.total
        : validPositive(item.unitPrice)
          ? item.unitPrice
          : null;
      rowItems.push({
        supplierIndex: block.supplierIndex,
        itemNumber: item.item,
        rowNumber,
        price: cascadePrice,
        unitPriceColumn: ownerBlock.unitPriceColumn,
        totalColumn: ownerBlock.totalColumn,
      });

      rowNumber += 1;
    }

    if (blockIndex < blocks.length - 1) {
      rowNumber += 3;
    }
  }

  return {
    footerRowOffset,
    finalDataRow,
    blocks,
    rowItems,
  };
}

function writePurchaseTotals(
  worksheet: ExcelJS.Worksheet,
  items: ComparisonItem[],
  suppliers: ConsolidatedComparison["suppliers"],
  footerRowOffset = 0
) {
  for (const [supplierIndex, supplier] of suppliers.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const offers = items.map((item) => item.offers[supplier.name]);
    const total = offers.reduce((sum, offer) => sum + (validPositive(offer?.total) ? offer.total : 0), 0);
    if (total <= 0) continue;

    const totalRow = shiftedTemplateRow(TEMPLATE_MAP.rows.total, footerRowOffset);
    const unitSideCell = worksheet.getCell(totalRow, block.unitPriceColumn);
    const totalSideCell = worksheet.getCell(totalRow, block.totalColumn);
    const currency = offerCurrency(offers);

    writeDynamicCell(unitSideCell, total);
    writeDynamicCell(totalSideCell, total);
    applyCurrencyFormat(unitSideCell, currency);
    applyCurrencyFormat(totalSideCell, currency);
  }
}

function writeCascadePurchaseTotals(
  worksheet: ExcelJS.Worksheet,
  blocks: CascadeBlock[],
  footerRowOffset: number
) {
  const totalRow = shiftedTemplateRow(TEMPLATE_MAP.rows.total, footerRowOffset);
  const totalsBySupplier = new Map<number, number>();
  const currencyBySupplier = new Map<number, Currency>();

  for (const block of blocks) {
    const total = block.items.reduce(
      (sum, item) => sum + (validPositive(item.total) ? item.total : 0),
      0
    );
    totalsBySupplier.set(block.supplierIndex, (totalsBySupplier.get(block.supplierIndex) ?? 0) + total);
    const currency = block.items.find((item) => item.currency !== "UNKNOWN")?.currency;
    if (currency) currencyBySupplier.set(block.supplierIndex, currency);
  }

  for (const [supplierIndex, total] of totalsBySupplier.entries()) {
    if (total <= 0) continue;

    const supplierBlock = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const unitSideCell = worksheet.getCell(totalRow, supplierBlock.unitPriceColumn);
    const totalSideCell = worksheet.getCell(totalRow, supplierBlock.totalColumn);
    const currency = currencyBySupplier.get(supplierIndex) ?? "CLP";
    writeDynamicCell(unitSideCell, total);
    writeDynamicCell(totalSideCell, total);
    applyCurrencyFormat(unitSideCell, currency);
    applyCurrencyFormat(totalSideCell, currency);
  }
}

function matchSupplierEvaluation(
  supplierName: string,
  supplierEvaluations: SupplierEvaluationInput[]
): SupplierEvaluationInput | undefined {
  const normalizedSupplier = normalizeText(supplierName);
  let best: { score: number; value: SupplierEvaluationInput } | undefined;

  for (const evaluation of supplierEvaluations) {
    const normalizedCandidate = normalizeText(evaluation.supplierName);
    if (!normalizedCandidate) continue;

    let score = 0;
    if (normalizedSupplier === normalizedCandidate) score = 100;
    else if (normalizedSupplier.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedSupplier)) {
      score = 70;
    } else {
      const supplierTokens = normalizedSupplier.split(" ");
      const candidateTokens = normalizedCandidate.split(" ");
      const overlap = supplierTokens.filter((token) => candidateTokens.includes(token)).length;
      score = overlap * 20;
    }

    if (!best || score > best.score) {
      best = { score, value: evaluation };
    }
  }

  return best && best.score >= 40 ? best.value : undefined;
}

function compactAssociatedData(supplierEvaluation?: SupplierEvaluationInput) {
  if (!supplierEvaluation) return undefined;
  const parts: string[] = [];
  if (hasText(supplierEvaluation.associatedCosts)) parts.push(`Costos: ${supplierEvaluation.associatedCosts?.trim()}`);
  if (hasText(supplierEvaluation.availability)) parts.push(`Disponibilidad: ${supplierEvaluation.availability?.trim()}`);
  if (hasText(supplierEvaluation.providerEvaluation)) {
    parts.push(`Evaluacion proveedor: ${supplierEvaluation.providerEvaluation?.trim()}`);
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function writeAdditionalEvaluationData(
  worksheet: ExcelJS.Worksheet,
  suppliersToWrite: ConsolidatedComparison["suppliers"],
  additionalEvaluation: AdditionalEvaluationData | undefined,
  footerRowOffset = 0
) {
  if (!additionalEvaluation) return;

  const supplierEvaluations = additionalEvaluation.supplierEvaluations ?? [];
  const urgency = hasText(additionalEvaluation.urgency) ? additionalEvaluation.urgency?.trim() : undefined;
  const associatedCostsRow = findRowByLabel(
    worksheet,
    "COSTOS ASOCIADOS",
    shiftedTemplateRow(TEMPLATE_MAP.rows.associatedCosts, footerRowOffset)
  );

  for (const [supplierIndex, supplier] of suppliersToWrite.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const supplierEvaluation = matchSupplierEvaluation(supplier.name, supplierEvaluations);
    const associatedText = compactAssociatedData(supplierEvaluation);

    if (hasText(supplierEvaluation?.creditStatus)) {
      writeIfNotFormula(
        worksheet.getCell(shiftedTemplateRow(TEMPLATE_MAP.rows.credit, footerRowOffset), block.unitPriceColumn),
        supplierEvaluation?.creditStatus?.trim() ?? null
      );
    }

    if (hasText(supplierEvaluation?.paymentCondition)) {
      writeIfNotFormula(
        worksheet.getCell(
          shiftedTemplateRow(TEMPLATE_MAP.rows.paymentCondition, footerRowOffset),
          block.unitPriceColumn
        ),
        supplierEvaluation?.paymentCondition?.trim() ?? null
      );
    }

    if (hasText(supplierEvaluation?.deliveryTime)) {
      writeIfNotFormula(
        worksheet.getCell(
          shiftedTemplateRow(TEMPLATE_MAP.rows.deliveryTime, footerRowOffset),
          block.unitPriceColumn
        ),
        supplierEvaluation?.deliveryTime?.trim() ?? null
      );
    }

    if (urgency) {
      writeIfNotFormula(
        worksheet.getCell(shiftedTemplateRow(TEMPLATE_MAP.rows.urgency, footerRowOffset), block.unitPriceColumn),
        urgency
      );
    }

    if (associatedText) {
      writeIfNotFormula(worksheet.getCell(associatedCostsRow, block.unitPriceColumn), associatedText);
    }
  }

  if (hasText(additionalEvaluation.awardCriteria)) {
    const criteriaCell = worksheet.getCell(
      shiftedTemplateRow(TEMPLATE_MAP.rows.awardCriteria, footerRowOffset),
      3
    );
    const criteriaParts = [additionalEvaluation.awardCriteria?.trim()];
    if (typeof additionalEvaluation.budgetObjective === "number" && Number.isFinite(additionalEvaluation.budgetObjective)) {
      const formattedBudget = new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(additionalEvaluation.budgetObjective);
      criteriaParts.push(`Presupuesto objetivo: ${formattedBudget}`);
    }
    writeDynamicCell(criteriaCell, criteriaParts.filter(Boolean).join(" | "));
    cloneCellStyle(criteriaCell);
    criteriaCell.alignment = { ...criteriaCell.alignment, wrapText: true, vertical: "middle" };
  }

  if (hasText(additionalEvaluation.awardResponsible)) {
    writeDynamicCell(
      worksheet.getCell(shiftedTemplateRow(TEMPLATE_MAP.rows.awardResponsible, footerRowOffset), 3),
      additionalEvaluation.awardResponsible?.trim() ?? null
    );
  }

  if (hasText(additionalEvaluation.buyerResponsible)) {
    writeDynamicCell(
      worksheet.getCell(shiftedTemplateRow(TEMPLATE_MAP.rows.buyerResponsible, footerRowOffset), 3),
      additionalEvaluation.buyerResponsible?.trim() ?? null
    );
  }
}

export async function generateComparisonExcel(
  templatePath: string,
  data: ConsolidatedComparison,
  jobId: string,
  options: GenerateComparisonExcelOptions = {}
): Promise<GenerateResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const worksheet = workbook.getWorksheet(TEMPLATE_MAP.sheetName);
  if (!worksheet) {
    throw new Error(`No existe la hoja "${TEMPLATE_MAP.sheetName}" en la plantilla.`);
  }

  const warnings: string[] = [...data.warnings];
  const maxItems = TEMPLATE_MAP.productEndRow - TEMPLATE_MAP.productStartRow + 1;
  const maxSuppliers = TEMPLATE_MAP.supplierBlocks.length;
  const hasCascadeBlocks = Boolean(data.cascadeBlocks && data.cascadeBlocks.length > 0);
  const itemsToWrite = hasCascadeBlocks
    ? []
    : normalizeComparisonItems(data.comparison.slice(0, maxItems));
  const suppliersToWrite = data.suppliers.slice(0, maxSuppliers);

  if (!hasCascadeBlocks && data.comparison.length > maxItems) {
    warnings.push(
      `La plantilla permite ${maxItems} productos; ${data.comparison.length - maxItems} productos no fueron escritos.`
    );
  }

  if (data.suppliers.length > maxSuppliers) {
    const omitted = data.suppliers.slice(maxSuppliers).map((supplier) => supplier.name).join(", ");
    warnings.push(`La plantilla permite ${maxSuppliers} proveedores; no se agregaron: ${omitted}.`);
  }

  clearTemplateDynamicFields(worksheet);
  const cascadeResult =
    hasCascadeBlocks && data.cascadeBlocks
      ? writeCascadeBlocks(worksheet, data.cascadeBlocks, suppliersToWrite, { warnings })
      : undefined;
  const footerRowOffset = cascadeResult?.footerRowOffset ?? 0;
  const associatedCostsFallbackRow = shiftedTemplateRow(
    TEMPLATE_MAP.rows.associatedCosts,
    footerRowOffset
  );
  applyBlockBorders(worksheet, associatedCostsFallbackRow);
  const associatedCostsRow = findRowByLabel(
    worksheet,
    "COSTOS ASOCIADOS",
    associatedCostsFallbackRow
  );

  if (hasText(options.folio)) {
    writeFolioCell(worksheet, options.folio as string);
  }

  for (const [index, supplier] of suppliersToWrite.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[index];
    worksheet.getCell(block.supplierNameCell).value = supplier.name;
    writeIfNotFormula(
      worksheet.getCell(shiftedTemplateRow(TEMPLATE_MAP.rows.credit, footerRowOffset), block.unitPriceColumn),
      supplier.credit ?? null
    );
    writeIfNotFormula(
      worksheet.getCell(
        shiftedTemplateRow(TEMPLATE_MAP.rows.paymentCondition, footerRowOffset),
        block.unitPriceColumn
      ),
      supplier.paymentCondition ?? null
    );
    writeIfNotFormula(
      worksheet.getCell(
        shiftedTemplateRow(TEMPLATE_MAP.rows.deliveryTime, footerRowOffset),
        block.unitPriceColumn
      ),
      supplier.deliveryTime ?? null
    );
    writeDynamicCell(
      worksheet.getCell(associatedCostsRow, block.totalColumn),
      parseAssociatedCostsValue(supplier.associatedCosts) ?? supplier.associatedCosts ?? null
    );
    const associatedCell = worksheet.getCell(associatedCostsRow, block.totalColumn);
    if (typeof associatedCell.value === "number") {
      applyCurrencyFormat(associatedCell, "CLP");
    }
  }

  if (!hasCascadeBlocks) {
    for (const [index, item] of itemsToWrite.entries()) {
      const rowNumber = TEMPLATE_MAP.productStartRow + index;
      const row = worksheet.getRow(rowNumber);
      worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.item).value = item.item;
      const productCell = worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.product);
      productCell.value = item.product;
      cloneCellStyle(productCell);
      productCell.alignment = { ...productCell.alignment, wrapText: true, vertical: "middle" };
      row.height = productRowHeight(item.product) ?? row.height;
      worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.quantity).value = item.quantity;
      worksheet.getCell(rowNumber, TEMPLATE_MAP.columns.unit).value = item.unit || "CU";

      for (const [supplierIndex, supplier] of suppliersToWrite.entries()) {
        const offer = resolvedOfferForRow(item.offers[supplier.name], item.quantity);
        const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
        const unitPriceCell = worksheet.getCell(rowNumber, block.unitPriceColumn);
        const totalCell = worksheet.getCell(rowNumber, block.totalColumn);

        writeDynamicCell(unitPriceCell, offer?.unitPrice ?? null);
        writeDynamicCell(totalCell, offer?.total ?? null);

        if (offer) {
          applyCurrencyFormat(unitPriceCell, offer.currency);
          applyCurrencyFormat(totalCell, offer.currency);

          if (offer.currency === "UNKNOWN") {
            warnings.push(`Moneda no determinada para ${item.product} - ${supplier.name}`);
          }
        }
      }
    }
  }

  writeAdditionalEvaluationData(
    worksheet,
    suppliersToWrite,
    options.additionalEvaluation,
    footerRowOffset
  );

  for (const supplier of suppliersToWrite) {
    const supplierIndex = suppliersToWrite.indexOf(supplier);
    const currencies = hasCascadeBlocks
      ? new Set(
          (cascadeResult?.blocks ?? [])
            .filter((block) => block.supplierIndex === supplierIndex)
            .flatMap((block) => block.items)
            .map((item) => item.currency)
            .filter((currency): currency is Currency => currency !== "UNKNOWN")
        )
      : new Set(
          itemsToWrite
            .map((item) => item.offers[supplier.name]?.currency)
            .filter((currency): currency is Currency => Boolean(currency) && currency !== "UNKNOWN")
        );

    if (currencies.size > 1) {
      warnings.push(`Proveedor ${supplier.name} tiene monedas mixtas; total requiere revision.`);
    }
  }

  if (cascadeResult) {
    writeCascadePurchaseTotals(worksheet, cascadeResult.blocks, footerRowOffset);
    highlightCascadePrices(worksheet, cascadeResult.rowItems);
  } else {
    writePurchaseTotals(worksheet, itemsToWrite, suppliersToWrite);
    highlightBestPrices(worksheet, itemsToWrite, suppliersToWrite, TEMPLATE_MAP);
  }

  // ── Dashboard_Data sheet (hidden, feeds the native charts) ──────────────────
  const dashboardSupplierCount = writeDashboardData(workbook, data);

  // ── Executive panel to the right of the table (columns R+) ──────────────────
  writeDashboardPanel(worksheet, data, {
    omittedFilesCount: options.omittedFilesCount,
    needsReviewCount: options.needsReviewCount,
  });

  workbook.calcProperties.fullCalcOnLoad = true;

  const finalPath = outputExcelPath(jobId);
  await workbook.xlsx.writeFile(finalPath);

  // ── Inject RESUMEN sheet with native Excel charts ───────────────────────────
  const chartTemplatePath = path.join(process.cwd(), "templates", "dashboard_chart_template.xlsx");
  if (dashboardSupplierCount > 0) {
    await injectDashboardCharts(finalPath, chartTemplatePath, dashboardSupplierCount);
  }

  return {
    outputPath: path.normalize(finalPath),
    warnings
  };
}

export async function applyFolioToGeneratedExcel(excelPath: string, folio: string) {
  // ExcelJS crashes reading files that have injected chart sheets (chart anchors
  // in drawings are not handled by ExcelJS's drawing parser).
  // Solution: strip the RESUMEN chart sheet, let ExcelJS apply the folio, then
  // re-inject the charts.
  const chartTemplatePath = path.join(process.cwd(), "templates", "dashboard_chart_template.xlsx");
  const hadCharts = await stripDashboardCharts(excelPath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  const worksheet = workbook.getWorksheet(TEMPLATE_MAP.sheetName);
  if (!worksheet) {
    throw new Error(`No existe la hoja "${TEMPLATE_MAP.sheetName}" en la plantilla.`);
  }

  writeFolioCell(worksheet, folio);
  workbook.calcProperties.fullCalcOnLoad = true;
  await workbook.xlsx.writeFile(excelPath);

  if (hadCharts) {
    // Re-trim chart ranges to the real supplier rows in Dashboard_Data.
    let supplierCount = 0;
    const dashboardData = workbook.getWorksheet("Dashboard_Data");
    if (dashboardData) {
      for (let row = 2; row <= 7; row += 1) {
        const name = dashboardData.getCell(row, 1).value;
        if (typeof name === "string" && name.trim().length > 0) supplierCount += 1;
      }
    }
    await injectDashboardCharts(excelPath, chartTemplatePath, supplierCount);
  }
}
