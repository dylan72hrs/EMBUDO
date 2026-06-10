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
 *
 *  2. writeDashboardSummary(worksheet, data, startRow, options?)
 *     Writes a compact executive-summary text block on the main sheet
 *     (section C only — key figures, no fake chart tables).
 */

import type ExcelJS from "exceljs";
import type { ConsolidatedComparison } from "@/lib/validations/quoteSchemas";

// ── shared types ──────────────────────────────────────────────────────────────

export type DashboardOptions = {
  omittedFilesCount?: number;
  needsReviewCount?: number;
};

type SupplierStat = {
  name: string;
  total: number;
  itemsQuoted: number;
};

// ── data helpers ──────────────────────────────────────────────────────────────

function computeSupplierStats(data: ConsolidatedComparison): {
  stats: SupplierStat[];
  totalItems: number;
} {
  if (data.cascadeBlocks && data.cascadeBlocks.length > 0) {
    const uniqueItems = new Set(
      data.cascadeBlocks.flatMap((b) => b.items.map((i) => i.item))
    );
    const totalItems = uniqueItems.size;

    const stats: SupplierStat[] = data.suppliers.map((supplier, idx) => {
      const blocks = data.cascadeBlocks!.filter((b) => b.supplierIndex === idx);
      const itemsQuoted = blocks.reduce((sum, b) => sum + b.items.length, 0);
      const rawTotal = blocks.reduce(
        (sum, b) =>
          sum +
          b.items.reduce((s, i) => {
            const v =
              typeof i.total === "number" && Number.isFinite(i.total) && i.total > 0
                ? i.total
                : typeof i.unitPrice === "number" &&
                    Number.isFinite(i.unitPrice) &&
                    i.unitPrice > 0
                  ? i.unitPrice *
                    (Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1)
                  : 0;
            return s + v;
          }, 0),
        0
      );
      const total =
        typeof supplier.offerNetTotalCLP === "number" &&
        Number.isFinite(supplier.offerNetTotalCLP) &&
        supplier.offerNetTotalCLP > 0
          ? supplier.offerNetTotalCLP
          : rawTotal;

      return { name: supplier.name, total, itemsQuoted };
    });

    return { stats, totalItems };
  }

  // comparison mode
  const totalItems = data.comparison.length;
  const stats: SupplierStat[] = data.suppliers.map((supplier) => {
    let totalSum = 0;
    let itemsQuoted = 0;

    for (const item of data.comparison) {
      const offer = item.offers[supplier.name];
      if (!offer) continue;
      const qty =
        Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
      const lineTotal =
        typeof offer.total === "number" &&
        Number.isFinite(offer.total) &&
        offer.total > 0
          ? offer.total
          : typeof offer.unitPrice === "number" &&
              Number.isFinite(offer.unitPrice) &&
              offer.unitPrice > 0
            ? offer.unitPrice * qty
            : 0;
      if (lineTotal > 0) {
        totalSum += lineTotal;
        itemsQuoted += 1;
      }
    }

    const economicTotal =
      typeof supplier.offerNetTotalCLP === "number" &&
      Number.isFinite(supplier.offerNetTotalCLP) &&
      supplier.offerNetTotalCLP > 0
        ? supplier.offerNetTotalCLP
        : totalSum;

    return { name: supplier.name, total: economicTotal, itemsQuoted };
  });

  return { stats, totalItems };
}

// ── 1. Dashboard_Data sheet ───────────────────────────────────────────────────

/**
 * Creates (or replaces) a hidden sheet called "Dashboard_Data" with:
 *   Row 1: headers  (Proveedor | Total Neto CLP | Items Cotizados | Total Items)
 *   Rows 2-N: one row per supplier (up to 6, matching the chart template ranges)
 *
 * The charts in dashboard_chart_template.xlsx reference exactly these cells.
 */
export function writeDashboardData(
  workbook: ExcelJS.Workbook,
  data: ConsolidatedComparison
): void {
  const { stats, totalItems } = computeSupplierStats(data);
  if (stats.length === 0) return;

  // Remove existing sheet if present (re-run safety)
  const existing = workbook.getWorksheet("Dashboard_Data");
  if (existing) workbook.removeWorksheet(existing.id);

  const ws = workbook.addWorksheet("Dashboard_Data", {
    state: "hidden",
  });

  // Header row
  ws.getRow(1).values = ["Proveedor", "Total Neto CLP", "Items Cotizados", "Total Items"];

  // Data rows (template charts reference rows 2-7, i.e. up to 6 suppliers)
  const MAX_ROWS = 6;
  for (let i = 0; i < MAX_ROWS; i++) {
    const stat = stats[i];
    const row = ws.getRow(i + 2);
    if (stat) {
      row.values = [stat.name, stat.total > 0 ? stat.total : 0, stat.itemsQuoted, totalItems];
    } else {
      // Fill with empty so chart ranges are consistent
      row.values = ["", 0, 0, totalItems];
    }
  }
}

// ── 2. Exec summary text block ────────────────────────────────────────────────

const C = {
  headerBg:  "FF203864",
  headerFg:  "FFFFFFFF",
  labelBg:   "FFEDEDED",
  valueBg:   "FFFFFFFF",
  altRow:    "FFF5F5F5",
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

function mergedTextRow(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  colEnd: number,
  text: string,
  opts: { bgArgb: string; fgArgb: string; bold?: boolean; fontSize?: number }
) {
  const ref = `${colLetter(colStart)}${row}:${colLetter(colEnd)}${row}`;
  try { ws.unMergeCells(ref); } catch { /* not merged */ }
  ws.mergeCells(ref);
  const cell = ws.getCell(row, colStart);
  cell.value = text;
  cell.style = {
    fill: solidFill(opts.bgArgb),
    font: { bold: opts.bold ?? true, color: { argb: opts.fgArgb }, size: opts.fontSize ?? 10 },
    alignment: { horizontal: "center", vertical: "middle" },
    border: allBorders(),
  };
  ws.getRow(row).height = 20;
}

/**
 * Writes a compact executive summary text block below the main table.
 * Lists: winner, lowest total, savings vs. most expensive, item/supplier counts,
 * warnings, omitted files.
 *
 * This is text only — no fake bar charts.  The real charts live in the injected
 * RESUMEN sheet.
 */
export function writeDashboardSummary(
  worksheet: ExcelJS.Worksheet,
  data: ConsolidatedComparison,
  startRow: number,
  options: DashboardOptions = {}
): void {
  const { stats, totalItems } = computeSupplierStats(data);
  if (stats.length === 0) return;

  const colStart = 1;
  const colEnd   = 5; // A-E
  let row = startRow;

  // Title
  mergedTextRow(worksheet, row, colStart, colEnd, "RESUMEN EJECUTIVO — Ver hoja «RESUMEN» para gráficos", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 10,
  });
  row += 1;

  // Build summary key-value pairs
  const validStats = stats.filter((s) => s.total > 0);
  const sorted = [...validStats].sort((a, b) => a.total - b.total);
  const winner  = sorted[0];
  const loser   = sorted[sorted.length - 1];
  const savings = winner && loser && sorted.length > 1 ? loser.total - winner.total : null;

  const rows: Array<[string, string | number]> = [];
  if (winner) {
    rows.push(["Proveedor más económico", winner.name]);
    rows.push(["Total más bajo (CLP)", winner.total]);
  }
  if (savings !== null && savings > 0) {
    rows.push(["Ahorro estimado vs. más caro", savings]);
  }
  rows.push(["Total ítems comparados", totalItems]);
  rows.push(["Proveedores analizados", stats.length]);
  if (data.warnings.length > 0) {
    rows.push(["Warnings generados", data.warnings.length]);
  }
  if (typeof options.omittedFilesCount === "number") {
    rows.push(["Archivos omitidos (inválidos)", options.omittedFilesCount]);
  }
  if (typeof options.needsReviewCount === "number") {
    rows.push(["Documentos que requieren revisión", options.needsReviewCount]);
  }

  for (const [i, [label, value]] of rows.entries()) {
    const bgLabel = C.labelBg;
    const bgValue = i % 2 === 0 ? C.valueBg : C.altRow;
    const borders = allBorders();

    // Label: cols 1-2
    const labelRef = `${colLetter(colStart)}${row}:${colLetter(colStart + 1)}${row}`;
    try { worksheet.unMergeCells(labelRef); } catch { /* ok */ }
    worksheet.mergeCells(labelRef);
    const labelCell = worksheet.getCell(row, colStart);
    labelCell.value = label;
    labelCell.style = {
      fill: solidFill(bgLabel),
      font: { bold: true, color: { argb: C.neutralFg }, size: 9 },
      alignment: { horizontal: "left", vertical: "middle" },
      border: borders,
    };

    // Value: cols 3-5
    const valueRef = `${colLetter(colStart + 2)}${row}:${colLetter(colEnd)}${row}`;
    try { worksheet.unMergeCells(valueRef); } catch { /* ok */ }
    worksheet.mergeCells(valueRef);
    const valueCell = worksheet.getCell(row, colStart + 2);
    const isMonetary =
      typeof value === "number" &&
      (label.toLowerCase().includes("total") || label.toLowerCase().includes("ahorro"));
    valueCell.value = value;
    valueCell.style = {
      fill: solidFill(bgValue),
      font: { color: { argb: C.neutralFg }, size: 9 },
      alignment: { horizontal: "left", vertical: "middle" },
      border: borders,
      numFmt: isMonetary ? '"$" #,##0' : undefined,
    };

    worksheet.getRow(row).height = 15;
    row += 1;
  }
}
