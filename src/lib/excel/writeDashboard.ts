/**
 * writeDashboard.ts
 *
 * Two responsibilities:
 *
 *  1. writeDashboardData(workbook, data)
 *     Creates a HIDDEN sheet called "Dashboard_Data" in the workbook.
 *     The dashboard_chart_template.xlsx has two bar charts that reference
 *     this sheet by name, so once injectDashboardCharts() copies those charts
 *     into the output file they populate automatically.
 *     Returns the number of real supplier rows written so the chart ranges
 *     can be trimmed to the actual data.
 *
 *  2. writeDashboardSummary(worksheet, data, startRow, options?)
 *     Writes an executive dashboard block on the main sheet, below the
 *     comparison table: per-supplier scoring matrix + key figures +
 *     recommendation. Text/cells only — the native charts live in the
 *     injected RESUMEN sheet.
 *
 * Both use computeSupplierComparableTotals(), the SAME item-by-item source
 * of truth as the main comparison table (writeCascadePurchaseTotals), so the
 * dashboard never shows document-level totals that the table does not show.
 */

import type ExcelJS from "exceljs";
import {
  computeSupplierComparableTotals,
  isRealSupplierName,
  type SupplierComparableTotal
} from "@/lib/analytics/buildPurchaseAnalytics";
import type { ConsolidatedComparison } from "@/lib/validations/quoteSchemas";

// ── shared types ──────────────────────────────────────────────────────────────

export type DashboardOptions = {
  omittedFilesCount?: number;
  needsReviewCount?: number;
};

type DashboardStats = {
  stats: SupplierComparableTotal[];
  totalItems: number;
  coverageAvailable: boolean;
};

function realSupplierStats(data: ConsolidatedComparison): DashboardStats {
  const totals = computeSupplierComparableTotals(data);
  return {
    stats: totals.suppliers.filter(
      (supplier) => isRealSupplierName(supplier.name) && supplier.total > 0
    ),
    totalItems: totals.totalItems,
    coverageAvailable: totals.coverageAvailable
  };
}

// ── 1. Dashboard_Data sheet ───────────────────────────────────────────────────

/**
 * Creates (or replaces) a hidden sheet called "Dashboard_Data" with:
 *   Row 1: headers  (Proveedor | Total Neto CLP | Items Cotizados | Total Items)
 *   Rows 2-N: one row per REAL supplier (garbage/zero-total suppliers excluded)
 *
 * Returns the number of supplier rows written (0-6). The chart template
 * references rows 2-7; injectDashboardCharts() trims the ranges to this count.
 */
export function writeDashboardData(
  workbook: ExcelJS.Workbook,
  data: ConsolidatedComparison
): number {
  const { stats, totalItems } = realSupplierStats(data);

  // Remove existing sheet if present (re-run safety)
  const existing = workbook.getWorksheet("Dashboard_Data");
  if (existing) workbook.removeWorksheet(existing.id);

  if (stats.length === 0) return 0;

  const ws = workbook.addWorksheet("Dashboard_Data", {
    state: "hidden",
  });

  ws.getRow(1).values = ["Proveedor", "Total Neto CLP", "Items Cotizados", "Total Items"];

  const MAX_ROWS = 6;
  const rowsToWrite = Math.min(stats.length, MAX_ROWS);
  for (let i = 0; i < rowsToWrite; i++) {
    const stat = stats[i];
    ws.getRow(i + 2).values = [stat.name, Math.round(stat.total), stat.itemsQuoted, totalItems];
  }

  return rowsToWrite;
}

// ── 2. Executive dashboard block on the main sheet ────────────────────────────

const C = {
  titleBg:   "FF1F3864",
  titleFg:   "FFFFFFFF",
  headerBg:  "FF2E5496",
  headerFg:  "FFFFFFFF",
  labelBg:   "FFEDEDED",
  valueBg:   "FFFFFFFF",
  altRow:    "FFF5F7FA",
  bestBg:    "FFE2EFDA",
  bestFg:    "FF1E6B34",
  reviewBg:  "FFFFF2CC",
  reviewFg:  "FF7F6000",
  border:    "FFBFBFBF",
  neutralFg: "FF262626",
} as const;

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBorder(): Partial<ExcelJS.Border> {
  return { style: "thin", color: { argb: C.border } };
}

function allBorders() {
  const b = thinBorder();
  return { top: b, bottom: b, left: b, right: b };
}

function colLetter(col: number): string {
  let result = "";
  let c = col;
  while (c > 0) {
    const rem = (c - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    c = Math.floor((c - 1) / 26);
  }
  return result;
}

function mergeRow(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  colEnd: number
) {
  const ref = `${colLetter(colStart)}${row}:${colLetter(colEnd)}${row}`;
  try { ws.unMergeCells(ref); } catch { /* not merged */ }
  ws.mergeCells(ref);
}

function mergedTextRow(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  colEnd: number,
  text: string,
  opts: { bgArgb: string; fgArgb: string; bold?: boolean; fontSize?: number; align?: "left" | "center" }
) {
  mergeRow(ws, row, colStart, colEnd);
  const cell = ws.getCell(row, colStart);
  cell.value = text;
  cell.style = {
    fill: solidFill(opts.bgArgb),
    font: { bold: opts.bold ?? true, color: { argb: opts.fgArgb }, size: opts.fontSize ?? 10 },
    alignment: { horizontal: opts.align ?? "center", vertical: "middle" },
    border: allBorders(),
  };
  ws.getRow(row).height = 20;
}

function styledCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  opts: {
    bgArgb: string;
    fgArgb?: string;
    bold?: boolean;
    numFmt?: string;
    align?: "left" | "center" | "right";
  }
) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.style = {
    fill: solidFill(opts.bgArgb),
    font: { bold: opts.bold ?? false, color: { argb: opts.fgArgb ?? C.neutralFg }, size: 9 },
    alignment: { horizontal: opts.align ?? "left", vertical: "middle" },
    border: allBorders(),
    numFmt: opts.numFmt,
  };
  return cell;
}

const REVIEW_PATTERN =
  /revisi[oó]n|moneda no determinada|no se pudo convertir|monedas? mixtas?|estimado desde lineas/i;

function supplierNeedsReview(name: string, warnings: string[]) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return warnings.some(
    (warning) => warning.toLowerCase().includes(normalized) && REVIEW_PATTERN.test(warning)
  );
}

/**
 * Writes the executive dashboard block below the main comparison table:
 *
 *   PANEL EJECUTIVO DE COMPRAS
 *   ── scoring matrix: Proveedor | Total neto CLP | Cobertura | Dif. vs mejor |
 *      Revisión | Recomendación (best row in green, review rows in amber)
 *   ── key figures: mejor oferta, ahorro estimado, ítems, warnings, omitidos
 *   ── recommendation / risk line
 */
export function writeDashboardSummary(
  worksheet: ExcelJS.Worksheet,
  data: ConsolidatedComparison,
  startRow: number,
  options: DashboardOptions = {}
): void {
  const { stats, totalItems, coverageAvailable } = realSupplierStats(data);
  if (stats.length === 0) return;

  const colStart = 1;
  const colEnd   = 7; // A-G
  let row = startRow;

  const sorted = [...stats].sort((a, b) => a.total - b.total);
  const winner  = sorted[0];
  const loser   = sorted[sorted.length - 1];
  const savings = sorted.length > 1 ? loser.total - winner.total : null;
  const savingsPct = savings !== null && loser.total > 0 ? (savings / loser.total) * 100 : null;

  // ── Title ────────────────────────────────────────────────────────────────
  mergedTextRow(
    worksheet,
    row,
    colStart,
    colEnd,
    "PANEL EJECUTIVO DE COMPRAS — gráficos en hoja «RESUMEN»",
    { bgArgb: C.titleBg, fgArgb: C.titleFg, fontSize: 11 }
  );
  row += 1;

  // ── Scoring matrix ───────────────────────────────────────────────────────
  const headers = [
    "Proveedor",
    "Total neto CLP",
    "Ítems cotizados",
    "Cobertura",
    "Dif. vs mejor",
    "Revisión",
    "Recomendación",
  ];
  for (const [i, header] of headers.entries()) {
    styledCell(worksheet, row, colStart + i, header, {
      bgArgb: C.headerBg,
      fgArgb: C.headerFg,
      bold: true,
      align: "center",
    });
  }
  worksheet.getRow(row).height = 18;
  row += 1;

  for (const [i, stat] of sorted.entries()) {
    const isBest = stat.name === winner.name;
    const needsReview = supplierNeedsReview(stat.name, data.warnings);
    const baseBg = isBest ? C.bestBg : needsReview ? C.reviewBg : i % 2 === 0 ? C.valueBg : C.altRow;
    const accentFg = isBest ? C.bestFg : needsReview ? C.reviewFg : C.neutralFg;
    const delta = stat.total - winner.total;
    const coverageText = coverageAvailable
      ? `${stat.itemsQuoted}/${totalItems}`
      : "N/D";
    const recommendation = isBest ? "Mejor oferta" : needsReview ? "Revisar" : "Comparable";

    styledCell(worksheet, row, colStart, stat.name, { bgArgb: baseBg, bold: isBest });
    styledCell(worksheet, row, colStart + 1, Math.round(stat.total), {
      bgArgb: baseBg,
      bold: isBest,
      numFmt: '"$" #,##0',
      align: "right",
    });
    styledCell(worksheet, row, colStart + 2, stat.itemsQuoted, { bgArgb: baseBg, align: "center" });
    styledCell(worksheet, row, colStart + 3, coverageText, { bgArgb: baseBg, align: "center" });
    styledCell(worksheet, row, colStart + 4, delta > 0 ? Math.round(delta) : "—", {
      bgArgb: baseBg,
      numFmt: delta > 0 ? '"+$" #,##0' : undefined,
      align: "right",
    });
    styledCell(worksheet, row, colStart + 5, needsReview ? "Sí" : "No", {
      bgArgb: baseBg,
      fgArgb: needsReview ? C.reviewFg : C.neutralFg,
      bold: needsReview,
      align: "center",
    });
    styledCell(worksheet, row, colStart + 6, recommendation, {
      bgArgb: baseBg,
      fgArgb: accentFg,
      bold: true,
      align: "center",
    });
    worksheet.getRow(row).height = 16;
    row += 1;
  }

  row += 1; // spacer

  // ── Key figures ──────────────────────────────────────────────────────────
  const figures: Array<[string, string | number, string?]> = [];
  figures.push(["Proveedor más económico", winner.name]);
  figures.push(["Mejor oferta neta (CLP)", Math.round(winner.total), '"$" #,##0']);
  if (savings !== null && savings > 0) {
    figures.push([
      "Ahorro estimado vs. más caro",
      Math.round(savings),
      '"$" #,##0',
    ]);
    if (savingsPct !== null) {
      figures.push(["Ahorro estimado (%)", Number(savingsPct.toFixed(1)), '0.0"%"']);
    }
  }
  figures.push(["Total ítems comparados", totalItems]);
  figures.push(["Proveedores analizados", stats.length]);
  if (data.warnings.length > 0) {
    figures.push(["Advertencias generadas", data.warnings.length]);
  }
  if (typeof options.omittedFilesCount === "number" && options.omittedFilesCount > 0) {
    figures.push(["Archivos omitidos (inválidos)", options.omittedFilesCount]);
  }
  if (typeof options.needsReviewCount === "number" && options.needsReviewCount > 0) {
    figures.push(["Proveedores que requieren revisión", options.needsReviewCount]);
  }

  for (const [i, [label, value, numFmt]] of figures.entries()) {
    const bgValue = i % 2 === 0 ? C.valueBg : C.altRow;

    mergeRow(worksheet, row, colStart, colStart + 2);
    const labelCell = worksheet.getCell(row, colStart);
    labelCell.value = label;
    labelCell.style = {
      fill: solidFill(C.labelBg),
      font: { bold: true, color: { argb: C.neutralFg }, size: 9 },
      alignment: { horizontal: "left", vertical: "middle" },
      border: allBorders(),
    };

    mergeRow(worksheet, row, colStart + 3, colEnd);
    const valueCell = worksheet.getCell(row, colStart + 3);
    valueCell.value = value;
    valueCell.style = {
      fill: solidFill(bgValue),
      font: { color: { argb: C.neutralFg }, size: 9 },
      alignment: { horizontal: "left", vertical: "middle" },
      border: allBorders(),
      numFmt,
    };

    worksheet.getRow(row).height = 15;
    row += 1;
  }

  // ── Recommendation / risk line ───────────────────────────────────────────
  const recommendationText =
    sorted.length > 1
      ? `Recomendación: adjudicar a ${winner.name} (menor total neto comparable). Comparación válida solo para ítems comparables.`
      : "Riesgo: no existe comparación entre múltiples proveedores; se procesó una sola cotización válida.";
  mergedTextRow(worksheet, row, colStart, colEnd, recommendationText, {
    bgArgb: sorted.length > 1 ? C.bestBg : C.reviewBg,
    fgArgb: sorted.length > 1 ? C.bestFg : C.reviewFg,
    fontSize: 9,
    align: "left",
  });
}
