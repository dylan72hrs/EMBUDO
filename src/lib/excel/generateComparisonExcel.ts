import path from "node:path";
import ExcelJS from "exceljs";
import { clearTemplateDynamicFields } from "@/lib/excel/clearTemplateDynamicFields";
import { highlightBestPrices } from "@/lib/excel/highlightBestPrices";
import { TEMPLATE_MAP } from "@/lib/excel/templateMap";
import { outputExcelPath } from "@/lib/utils/fileStorage";
import type { ComparisonItem, ConsolidatedComparison, Currency, SupplierOffer } from "@/lib/validations/quoteSchemas";

type GenerateResult = {
  outputPath: string;
  warnings: string[];
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
};

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

function applyBlockBorders(worksheet: ExcelJS.Worksheet) {
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

    for (let row = TEMPLATE_MAP.headerRows.supplierName; row <= TEMPLATE_MAP.rows.associatedCosts; row += 1) {
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

function writePurchaseTotals(
  worksheet: ExcelJS.Worksheet,
  items: ComparisonItem[],
  suppliers: ConsolidatedComparison["suppliers"]
) {
  for (const [supplierIndex, supplier] of suppliers.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const offers = items.map((item) => item.offers[supplier.name]);
    const total = offers.reduce((sum, offer) => sum + (validPositive(offer?.total) ? offer.total : 0), 0);
    if (total <= 0) continue;

    const unitSideCell = worksheet.getCell(TEMPLATE_MAP.rows.total, block.unitPriceColumn);
    const totalSideCell = worksheet.getCell(TEMPLATE_MAP.rows.total, block.totalColumn);
    const currency = offerCurrency(offers);

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
  additionalEvaluation: AdditionalEvaluationData | undefined
) {
  if (!additionalEvaluation) return;

  const supplierEvaluations = additionalEvaluation.supplierEvaluations ?? [];
  const urgency = hasText(additionalEvaluation.urgency) ? additionalEvaluation.urgency?.trim() : undefined;

  for (const [supplierIndex, supplier] of suppliersToWrite.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[supplierIndex];
    const supplierEvaluation = matchSupplierEvaluation(supplier.name, supplierEvaluations);
    const associatedText = compactAssociatedData(supplierEvaluation);

    if (hasText(supplierEvaluation?.creditStatus)) {
      writeIfNotFormula(
        worksheet.getCell(TEMPLATE_MAP.rows.credit, block.unitPriceColumn),
        supplierEvaluation?.creditStatus?.trim() ?? null
      );
    }

    if (hasText(supplierEvaluation?.paymentCondition)) {
      writeIfNotFormula(
        worksheet.getCell(TEMPLATE_MAP.rows.paymentCondition, block.unitPriceColumn),
        supplierEvaluation?.paymentCondition?.trim() ?? null
      );
    }

    if (hasText(supplierEvaluation?.deliveryTime)) {
      writeIfNotFormula(
        worksheet.getCell(TEMPLATE_MAP.rows.deliveryTime, block.unitPriceColumn),
        supplierEvaluation?.deliveryTime?.trim() ?? null
      );
    }

    if (urgency) {
      writeIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.urgency, block.unitPriceColumn), urgency);
    }

    if (associatedText) {
      writeIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.associatedCosts, block.unitPriceColumn), associatedText);
    }
  }

  if (hasText(additionalEvaluation.awardCriteria)) {
    const criteriaCell = worksheet.getCell(TEMPLATE_MAP.rows.awardCriteria, 3);
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
      worksheet.getCell(TEMPLATE_MAP.rows.awardResponsible, 3),
      additionalEvaluation.awardResponsible?.trim() ?? null
    );
  }

  if (hasText(additionalEvaluation.buyerResponsible)) {
    writeDynamicCell(
      worksheet.getCell(TEMPLATE_MAP.rows.buyerResponsible, 3),
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
  const itemsToWrite = normalizeComparisonItems(data.comparison.slice(0, maxItems));
  const suppliersToWrite = data.suppliers.slice(0, maxSuppliers);

  if (data.comparison.length > maxItems) {
    warnings.push(
      `La plantilla permite ${maxItems} productos; ${data.comparison.length - maxItems} productos no fueron escritos.`
    );
  }

  if (data.suppliers.length > maxSuppliers) {
    const omitted = data.suppliers.slice(maxSuppliers).map((supplier) => supplier.name).join(", ");
    warnings.push(`La plantilla permite ${maxSuppliers} proveedores; no se agregaron: ${omitted}.`);
  }

  clearTemplateDynamicFields(worksheet);
  applyBlockBorders(worksheet);

  if (hasText(options.folio)) {
    const folioCell = worksheet.getCell(TEMPLATE_MAP.cells.folio);
    writeDynamicCell(folioCell, `Folio comparativa: ${options.folio?.trim()}`);
    cloneCellStyle(folioCell);
    folioCell.font = { ...(folioCell.font ?? {}), bold: true, size: 9 };
    folioCell.alignment = { ...(folioCell.alignment ?? {}), horizontal: "left", vertical: "middle" };
  }

  for (const [index, supplier] of suppliersToWrite.entries()) {
    const block = TEMPLATE_MAP.supplierBlocks[index];
    worksheet.getCell(block.supplierNameCell).value = supplier.name;
    writeIfNotFormula(worksheet.getCell(TEMPLATE_MAP.rows.credit, block.unitPriceColumn), supplier.credit ?? null);
    writeIfNotFormula(
      worksheet.getCell(TEMPLATE_MAP.rows.paymentCondition, block.unitPriceColumn),
      supplier.paymentCondition ?? null
    );
    writeIfNotFormula(
      worksheet.getCell(TEMPLATE_MAP.rows.deliveryTime, block.unitPriceColumn),
      supplier.deliveryTime ?? null
    );
  }

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

  writeAdditionalEvaluationData(worksheet, suppliersToWrite, options.additionalEvaluation);

  for (const supplier of suppliersToWrite) {
    const currencies = new Set(
      itemsToWrite
        .map((item) => item.offers[supplier.name]?.currency)
        .filter((currency): currency is Currency => Boolean(currency) && currency !== "UNKNOWN")
    );

    if (currencies.size > 1) {
      warnings.push(`Proveedor ${supplier.name} tiene monedas mixtas; total requiere revision.`);
    }
  }

  writePurchaseTotals(worksheet, itemsToWrite, suppliersToWrite);
  highlightBestPrices(worksheet, itemsToWrite, suppliersToWrite, TEMPLATE_MAP);

  workbook.calcProperties.fullCalcOnLoad = true;

  const finalPath = outputExcelPath(jobId);
  await workbook.xlsx.writeFile(finalPath);

  return {
    outputPath: path.normalize(finalPath),
    warnings
  };
}
