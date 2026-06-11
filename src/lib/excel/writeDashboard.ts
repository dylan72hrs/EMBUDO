/**
 * writeDashboard.ts
 *
 * Two responsibilities:
 *
 *  1. writeDashboardData(workbook, data)
 *     Creates a HIDDEN sheet called "Dashboard_Data" (15 columns incl. score,
 *     risk and recommendation). The native charts in the injected RESUMEN
 *     sheet reference this sheet by name. Returns the number of real supplier
 *     rows written so chart ranges can be trimmed to the actual data.
 *
 *  2. writeDashboardPanel(worksheet, data, options?)
 *     Writes an executive panel on the main TABLA COMPARATIVA sheet, to the
 *     RIGHT of the table (columns R+, beyond the template's 6 supplier blocks
 *     that end at column P). KPI cards, visual ranking, decision matrix,
 *     executive message and relevant warnings. Cells/text only — the native
 *     charts live in the injected RESUMEN sheet.
 *
 * Both use computeSupplierComparableTotals(), the SAME item-by-item source of
 * truth as the main comparison table (writeCascadePurchaseTotals) and the web
 * analytics, so every total shown matches the TOTAL row exactly.
 */

import type ExcelJS from "exceljs";
import {
  computeSupplierComparableTotals,
  isRealSupplierName
} from "@/lib/analytics/buildPurchaseAnalytics";
import type { ConsolidatedComparison } from "@/lib/validations/quoteSchemas";

// ── shared types ──────────────────────────────────────────────────────────────

export type DashboardOptions = {
  omittedFilesCount?: number;
  needsReviewCount?: number;
};

type SupplierStat = {
  name: string;
  quoteNumber: string | null;
  total: number;
  itemsQuoted: number;
  share: number;
  deltaVsBest: number;
  deltaVsBestPct: number;
  isBest: boolean;
  isMostExpensive: boolean;
  needsReview: boolean;
  warningsCount: number;
  recommendation: "Mejor oferta" | "Comparable" | "Revisar";
  riskLevel: "Bajo" | "Medio" | "Alto";
  score: number;
};

type DashboardStats = {
  stats: SupplierStat[];
  totalItems: number;
  coverageAvailable: boolean;
};

const REVIEW_PATTERN =
  /revisi[oó]n|moneda no determinada|no se pudo convertir|monedas? mixtas?|estimado desde lineas/i;

function supplierNeedsReview(name: string, warnings: string[]) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return warnings.some(
    (warning) => warning.toLowerCase().includes(normalized) && REVIEW_PATTERN.test(warning)
  );
}

function supplierWarningsCount(name: string, warnings: string[]) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return 0;
  return warnings.filter((warning) => warning.toLowerCase().includes(normalized)).length;
}

/**
 * Score ejecutivo 0-100: costo relativo + cobertura (si existe) + riesgo +
 * advertencias. Sin cobertura calculable se repondera (no se inventa 0/0).
 */
function computeScore(
  entry: { total: number; itemsQuoted: number; needsReview: boolean; warningsCount: number },
  bestTotal: number,
  coverageAvailable: boolean,
  totalItems: number
) {
  const costComponent = entry.total > 0 ? Math.min(1, bestTotal / entry.total) : 0;
  const riskComponent = entry.needsReview ? 0 : 1;
  const warningsComponent = Math.max(0, 1 - 0.15 * entry.warningsCount);

  if (coverageAvailable && totalItems > 0) {
    const coverageComponent = Math.min(1, entry.itemsQuoted / totalItems);
    return Math.round(
      100 * (0.5 * costComponent + 0.2 * coverageComponent + 0.2 * riskComponent + 0.1 * warningsComponent)
    );
  }
  return Math.round(100 * (0.6 * costComponent + 0.25 * riskComponent + 0.15 * warningsComponent));
}

function buildDashboardStats(data: ConsolidatedComparison): DashboardStats {
  const totals = computeSupplierComparableTotals(data);
  const real = totals.suppliers
    .filter((supplier) => isRealSupplierName(supplier.name) && supplier.total > 0)
    .sort((a, b) => a.total - b.total);

  if (real.length === 0) {
    return { stats: [], totalItems: totals.totalItems, coverageAvailable: totals.coverageAvailable };
  }

  const best = real[0];
  const worst = real[real.length - 1];
  const totalEvaluated = real.reduce((sum, supplier) => sum + supplier.total, 0);

  const stats: SupplierStat[] = real.map((supplier) => {
    const summary = data.suppliers.find((entry) => entry.name === supplier.name);
    const needsReview =
      supplierNeedsReview(supplier.name, data.warnings) || summary?.needsReview === true;
    const warningsCount = supplierWarningsCount(supplier.name, data.warnings);
    const isBest = supplier.name === best.name;
    const entry = {
      total: supplier.total,
      itemsQuoted: supplier.itemsQuoted,
      needsReview,
      warningsCount
    };

    return {
      name: supplier.name,
      quoteNumber: summary?.quoteNumber ?? null,
      total: supplier.total,
      itemsQuoted: supplier.itemsQuoted,
      share: totalEvaluated > 0 ? (supplier.total / totalEvaluated) * 100 : 0,
      deltaVsBest: supplier.total - best.total,
      deltaVsBestPct: best.total > 0 ? ((supplier.total - best.total) / best.total) * 100 : 0,
      isBest,
      isMostExpensive: real.length > 1 && supplier.name === worst.name,
      needsReview,
      warningsCount,
      recommendation: isBest ? "Mejor oferta" : needsReview ? "Revisar" : "Comparable",
      riskLevel: needsReview ? "Alto" : warningsCount > 0 ? "Medio" : "Bajo",
      score: computeScore(entry, best.total, totals.coverageAvailable, totals.totalItems)
    };
  });

  return { stats, totalItems: totals.totalItems, coverageAvailable: totals.coverageAvailable };
}

// ── 1. Dashboard_Data sheet ───────────────────────────────────────────────────

const DASHBOARD_DATA_HEADERS = [
  "Provider",
  "TotalNetCLP",
  "SharePercent",
  "QuotedItems",
  "ComparableItems",
  "CoveragePercent",
  "DifferenceVsBestCLP",
  "DifferenceVsBestPercent",
  "IsBestOffer",
  "IsMostExpensive",
  "NeedsReview",
  "WarningCount",
  "Recommendation",
  "RiskLevel",
  "Score",
  "QuotationNumber"
] as const;

/**
 * Creates (or replaces) the hidden "Dashboard_Data" sheet: one row per REAL
 * supplier (garbage/numeric/zero-total suppliers excluded), sorted by
 * TotalNetCLP ascending. No template residue: the sheet is dropped and
 * rebuilt on every run.
 *
 * Returns the number of supplier rows written (0-6). The chart template
 * references rows 2-7; injectDashboardCharts() trims the ranges to this count.
 */
export function writeDashboardData(
  workbook: ExcelJS.Workbook,
  data: ConsolidatedComparison
): number {
  const { stats, totalItems, coverageAvailable } = buildDashboardStats(data);

  // Remove existing sheet if present (re-run safety, no stale rows)
  const existing = workbook.getWorksheet("Dashboard_Data");
  if (existing) workbook.removeWorksheet(existing.id);

  if (stats.length === 0) return 0;

  const ws = workbook.addWorksheet("Dashboard_Data", { state: "hidden" });
  ws.getRow(1).values = [...DASHBOARD_DATA_HEADERS];

  const MAX_ROWS = 6;
  const rowsToWrite = Math.min(stats.length, MAX_ROWS);
  for (let i = 0; i < rowsToWrite; i++) {
    const stat = stats[i];
    ws.getRow(i + 2).values = [
      stat.name,
      Math.round(stat.total),
      Number(stat.share.toFixed(1)),
      stat.itemsQuoted,
      totalItems,
      coverageAvailable && totalItems > 0
        ? Number(((stat.itemsQuoted / totalItems) * 100).toFixed(1))
        : null,
      Math.round(stat.deltaVsBest),
      Number(stat.deltaVsBestPct.toFixed(1)),
      stat.isBest,
      stat.isMostExpensive,
      stat.needsReview,
      stat.warningsCount,
      stat.recommendation,
      stat.riskLevel,
      stat.score,
      stat.quoteNumber ?? ""
    ];
  }

  return rowsToWrite;
}

// ── 2. Executive panel on the main sheet (columns R+) ────────────────────────

const C = {
  titleBg:   "FF1F3864",
  titleFg:   "FFFFFFFF",
  headerBg:  "FF2E5496",
  headerFg:  "FFFFFFFF",
  cardBg:    "FFF2F6FC",
  cardLabel: "FF5B6B8C",
  valueBg:   "FFFFFFFF",
  altRow:    "FFF5F7FA",
  bestBg:    "FFE2EFDA",
  bestFg:    "FF1E6B34",
  reviewBg:  "FFFFF2CC",
  reviewFg:  "FF7F6000",
  worstFg:   "FFC0392B",
  border:    "FFBFBFBF",
  neutralFg: "FF262626",
  navy:      "FF2F5496",
} as const;

/** First panel column: R (18). The template's supplier blocks end at P (16). */
const PANEL_COL = 18;
const PANEL_WIDTH = 7; // R..X
const PANEL_START_ROW = 2;

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

function mergeRow(ws: ExcelJS.Worksheet, row: number, colStart: number, colEnd: number) {
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
    alignment: { horizontal: opts.align ?? "center", vertical: "middle", wrapText: true },
    border: allBorders(),
  };
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
    fontSize?: number;
  }
) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.style = {
    fill: solidFill(opts.bgArgb),
    font: {
      bold: opts.bold ?? false,
      color: { argb: opts.fgArgb ?? C.neutralFg },
      size: opts.fontSize ?? 9
    },
    alignment: { horizontal: opts.align ?? "left", vertical: "middle" },
    border: allBorders(),
    numFmt: opts.numFmt,
  };
  return cell;
}

function formatClp(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function kpiCard(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  label: string,
  value: string,
  caption: string,
  valueColor: string = C.navy
) {
  const colEnd = colStart + 1;
  mergedTextRow(ws, row, colStart, colEnd, label, {
    bgArgb: C.cardBg,
    fgArgb: C.cardLabel,
    bold: true,
    fontSize: 8,
  });
  mergedTextRow(ws, row + 1, colStart, colEnd, value, {
    bgArgb: C.valueBg,
    fgArgb: valueColor,
    bold: true,
    fontSize: 13,
  });
  mergedTextRow(ws, row + 2, colStart, colEnd, caption, {
    bgArgb: C.valueBg,
    fgArgb: C.cardLabel,
    bold: false,
    fontSize: 8,
  });
}

/**
 * Writes the executive panel to the right of the comparison table, starting
 * at column R row 2. Does not touch columns A-P (logo, headers, supplier
 * blocks, TOTAL row remain intact).
 */
export function writeDashboardPanel(
  worksheet: ExcelJS.Worksheet,
  data: ConsolidatedComparison,
  options: DashboardOptions = {}
): void {
  const { stats, totalItems, coverageAvailable } = buildDashboardStats(data);
  if (stats.length === 0) return;

  const colStart = PANEL_COL;
  const colEnd = PANEL_COL + PANEL_WIDTH - 1;
  let row = PANEL_START_ROW;

  const best = stats[0];
  const worst = stats[stats.length - 1];
  const hasComparison = stats.length > 1;
  const savings = hasComparison ? worst.total - best.total : null;
  const savingsPct = savings !== null && worst.total > 0 ? (savings / worst.total) * 100 : null;
  const totalEvaluated = stats.reduce((sum, stat) => sum + stat.total, 0);

  // Column widths for the panel area only (template widths cols 1-16 untouched)
  const widths = [24, 13, 13, 13, 9, 9, 14];
  for (let i = 0; i < PANEL_WIDTH; i++) {
    worksheet.getColumn(colStart + i).width = widths[i];
  }

  // ── Title ────────────────────────────────────────────────────────────────
  // Nota: el panel comparte filas con el encabezado y la tabla de la plantilla;
  // nunca se modifican alturas de fila (romperia el layout del logo/headers).
  mergedTextRow(worksheet, row, colStart, colEnd, "PANEL EJECUTIVO DE COMPRAS", {
    bgArgb: C.titleBg,
    fgArgb: C.titleFg,
    fontSize: 12,
  });
  row += 1;
  mergedTextRow(
    worksheet,
    row,
    colStart,
    colEnd,
    "Totales netos CLP item por item — misma fuente que la tabla y la web. Graficos en hoja «RESUMEN».",
    { bgArgb: C.headerBg, fgArgb: C.titleFg, bold: false, fontSize: 8 }
  );
  row += 2;

  // ── KPI cards (3 cards x 2 columns) ──────────────────────────────────────
  kpiCard(worksheet, row, colStart, "MEJOR OFERTA NETA", formatClp(best.total), best.name, C.bestFg);
  kpiCard(
    worksheet,
    row,
    colStart + 2,
    "AHORRO ESTIMADO",
    savings !== null ? formatClp(savings) : "N/D",
    savings !== null && savingsPct !== null
      ? `${savingsPct.toFixed(1)}% vs. mas caro`
      : "Requiere 2+ proveedores",
    savings !== null ? C.bestFg : C.cardLabel
  );
  kpiCard(
    worksheet,
    row,
    colStart + 4,
    "TOTAL EVALUADO",
    formatClp(totalEvaluated),
    `${stats.length} proveedor${stats.length > 1 ? "es" : ""} · ${totalItems} item${totalItems !== 1 ? "s" : ""}`,
    C.navy
  );
  styledCell(worksheet, row, colEnd, "", { bgArgb: C.cardBg });
  styledCell(worksheet, row + 1, colEnd, "", { bgArgb: C.valueBg });
  styledCell(worksheet, row + 2, colEnd, "", { bgArgb: C.valueBg });
  row += 4;

  // ── Visual ranking ───────────────────────────────────────────────────────
  mergedTextRow(worksheet, row, colStart, colEnd, "RANKING DE TOTAL NETO (CLP) — menor a mayor", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 9,
  });
  row += 1;

  const maxTotal = Math.max(...stats.map((stat) => stat.total));
  const BAR_MAX = 16;
  for (const stat of stats) {
    const barLength = maxTotal > 0 ? Math.max(1, Math.round((stat.total / maxTotal) * BAR_MAX)) : 1;
    const barColor = stat.isBest ? C.bestFg : stat.isMostExpensive ? C.worstFg : C.navy;
    const bg = stat.isBest ? C.bestBg : C.valueBg;

    mergeRow(worksheet, row, colStart, colStart + 1);
    styledCell(worksheet, row, colStart, stat.name, { bgArgb: bg, bold: stat.isBest });
    styledCell(worksheet, row, colStart + 2, Math.round(stat.total), {
      bgArgb: bg,
      bold: stat.isBest,
      numFmt: '"$" #,##0',
      align: "right",
    });
    mergeRow(worksheet, row, colStart + 3, colStart + 5);
    styledCell(worksheet, row, colStart + 3, "█".repeat(barLength), {
      bgArgb: bg,
      fgArgb: barColor,
      fontSize: 9,
    });
    styledCell(
      worksheet,
      row,
      colEnd,
      stat.isBest ? "Mejor oferta" : stat.isMostExpensive ? "Mas caro" : `${stat.share.toFixed(1)}%`,
      {
        bgArgb: bg,
        fgArgb: stat.isBest ? C.bestFg : stat.isMostExpensive ? C.worstFg : C.neutralFg,
        bold: stat.isBest || stat.isMostExpensive,
        align: "center",
        fontSize: 8,
      }
    );
    row += 1;
  }
  row += 1;

  // ── Decision matrix ──────────────────────────────────────────────────────
  mergedTextRow(worksheet, row, colStart, colEnd, "MATRIZ DE DECISION", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 9,
  });
  row += 1;

  const headers = ["Proveedor", "Total neto CLP", "Cobertura", "Dif. vs mejor", "Score", "Revision", "Recomendacion"];
  for (const [i, header] of headers.entries()) {
    styledCell(worksheet, row, colStart + i, header, {
      bgArgb: C.titleBg,
      fgArgb: C.headerFg,
      bold: true,
      align: "center",
      fontSize: 8,
    });
  }
  row += 1;

  for (const [i, stat] of stats.entries()) {
    const baseBg = stat.isBest ? C.bestBg : stat.needsReview ? C.reviewBg : i % 2 === 0 ? C.valueBg : C.altRow;
    const accentFg = stat.isBest ? C.bestFg : stat.needsReview ? C.reviewFg : C.neutralFg;

    styledCell(worksheet, row, colStart, stat.name, { bgArgb: baseBg, bold: stat.isBest });
    styledCell(worksheet, row, colStart + 1, Math.round(stat.total), {
      bgArgb: baseBg,
      bold: stat.isBest,
      numFmt: '"$" #,##0',
      align: "right",
    });
    styledCell(
      worksheet,
      row,
      colStart + 2,
      coverageAvailable ? `${stat.itemsQuoted}/${totalItems}` : `${stat.itemsQuoted} · N/D`,
      { bgArgb: baseBg, align: "center" }
    );
    styledCell(worksheet, row, colStart + 3, stat.deltaVsBest > 0 ? Math.round(stat.deltaVsBest) : "—", {
      bgArgb: baseBg,
      numFmt: stat.deltaVsBest > 0 ? '"+$" #,##0' : undefined,
      align: "right",
    });
    styledCell(worksheet, row, colStart + 4, stat.score, { bgArgb: baseBg, align: "center", bold: true });
    styledCell(worksheet, row, colStart + 5, stat.needsReview ? "Si" : "No", {
      bgArgb: baseBg,
      fgArgb: stat.needsReview ? C.reviewFg : C.neutralFg,
      bold: stat.needsReview,
      align: "center",
    });
    styledCell(worksheet, row, colStart + 6, stat.recommendation, {
      bgArgb: baseBg,
      fgArgb: accentFg,
      bold: true,
      align: "center",
      fontSize: 8,
    });
    row += 1;
  }
  row += 1;

  // ── Executive message ────────────────────────────────────────────────────
  mergedTextRow(worksheet, row, colStart, colEnd, "MENSAJE EJECUTIVO", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 9,
  });
  row += 1;

  const messages: Array<{ text: string; bg: string; fg: string }> = [];
  messages.push({
    text: `Proveedor con menor total neto: ${best.name} (${formatClp(best.total)}).`,
    bg: C.bestBg,
    fg: C.bestFg,
  });
  if (savings !== null && savingsPct !== null) {
    messages.push({
      text: `Ahorro estimado frente a la oferta mas cara: ${formatClp(savings)} (${savingsPct.toFixed(1)}%).`,
      bg: C.valueBg,
      fg: C.neutralFg,
    });
  } else {
    messages.push({
      text: "Riesgo: no existe comparacion entre multiples proveedores; se proceso una sola cotizacion valida.",
      bg: C.reviewBg,
      fg: C.reviewFg,
    });
  }
  const reviewCount =
    options.needsReviewCount ?? stats.filter((stat) => stat.needsReview).length;
  messages.push({
    text: `Revision requerida: ${reviewCount > 0 ? `Si (${reviewCount} proveedor${reviewCount > 1 ? "es" : ""})` : "No"}.`,
    bg: reviewCount > 0 ? C.reviewBg : C.valueBg,
    fg: reviewCount > 0 ? C.reviewFg : C.neutralFg,
  });
  if (typeof options.omittedFilesCount === "number" && options.omittedFilesCount > 0) {
    messages.push({
      text: `Archivos omitidos por no ser cotizaciones validas: ${options.omittedFilesCount}.`,
      bg: C.valueBg,
      fg: C.neutralFg,
    });
  }
  messages.push({
    text: "Comparacion valida solo para items comparables.",
    bg: C.valueBg,
    fg: C.cardLabel,
  });

  for (const message of messages) {
    mergedTextRow(worksheet, row, colStart, colEnd, message.text, {
      bgArgb: message.bg,
      fgArgb: message.fg,
      bold: false,
      fontSize: 8,
      align: "left",
    });
    row += 1;
  }
  row += 1;

  // ── Trazabilidad por cotizacion (folio -> valor neto usado) ─────────────
  mergedTextRow(worksheet, row, colStart, colEnd, "TRAZABILIDAD POR COTIZACIÓN", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 9,
  });
  row += 1;
  mergedTextRow(
    worksheet,
    row,
    colStart,
    colEnd,
    "Base de adjudicación: suma de líneas NETAS sin IVA, descuentos del PDF aplicados antes de comparar.",
    { bgArgb: C.cardBg, fgArgb: C.cardLabel, bold: false, fontSize: 8, align: "left" }
  );
  row += 1;
  for (const stat of stats) {
    mergedTextRow(
      worksheet,
      row,
      colStart,
      colEnd,
      `${stat.name} — Cotización N° ${stat.quoteNumber ?? "s/n"} — Valor neto usado: ${formatClp(
        Math.round(stat.total)
      )}${stat.needsReview ? " — Requiere revisión" : ""}`,
      {
        bgArgb: stat.needsReview ? C.reviewBg : C.valueBg,
        fgArgb: stat.needsReview ? C.reviewFg : C.neutralFg,
        bold: false,
        fontSize: 8,
        align: "left",
      }
    );
    row += 1;
  }
  row += 1;

  // ── Relevant warnings (top 5) ────────────────────────────────────────────
  const relevantWarnings = data.warnings
    .filter((warning) => REVIEW_PATTERN.test(warning) || /\[COSTOS ASOCIADOS\]/i.test(warning))
    .slice(0, 5);
  if (relevantWarnings.length > 0) {
    mergedTextRow(worksheet, row, colStart, colEnd, "ADVERTENCIAS RELEVANTES", {
      bgArgb: C.headerBg,
      fgArgb: C.headerFg,
      fontSize: 9,
    });
    row += 1;
    for (const warning of relevantWarnings) {
      mergedTextRow(worksheet, row, colStart, colEnd, warning.replace(/^\[[^\]]+\]\s*/, ""), {
        bgArgb: C.reviewBg,
        fgArgb: C.reviewFg,
        bold: false,
        fontSize: 8,
        align: "left",
      });
      row += 1;
    }
  }
}
