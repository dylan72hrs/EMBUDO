import type ExcelJS from "exceljs";
import type { ConsolidatedComparison } from "@/lib/validations/quoteSchemas";

// ── Color palette ──────────────────────────────────────────────────────────────
const C = {
  headerBg: "FF203864",
  headerFg: "FFFFFFFF",
  sectionBg: "FF2F5496",
  sectionFg: "FFFFFFFF",
  subheaderBg: "FFDAE3F3",
  subheaderFg: "FF203864",
  winnerBg: "FFC6EFCE",
  winnerFg: "FF375623",
  loserBg:  "FFFFC7CE",
  loserFg:  "FF9C0006",
  altRow:   "FFF5F5F5",
  border:   "FFBFBFBF",
  labelBg:  "FFEDEDED",
  valueBg:  "FFFFFFFF",
  neutralFg: "FF262626",
} as const;

type FillArg = ExcelJS.Fill & { type: "pattern"; pattern: "solid" };

function solidFill(argb: string): FillArg {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBorder(color = C.border): Partial<ExcelJS.Border> {
  return { style: "thin", color: { argb: color } };
}

function allBorders(color = C.border) {
  const side = thinBorder(color);
  return { top: side, bottom: side, left: side, right: side };
}

function styleCell(
  cell: ExcelJS.Cell,
  opts: {
    bgArgb?: string;
    fgArgb?: string;
    bold?: boolean;
    italic?: boolean;
    hAlign?: ExcelJS.Alignment["horizontal"];
    vAlign?: ExcelJS.Alignment["vertical"];
    wrapText?: boolean;
    numFmt?: string;
    borders?: boolean;
    fontSize?: number;
  }
) {
  cell.style = {
    ...cell.style,
    fill: opts.bgArgb ? solidFill(opts.bgArgb) : cell.style.fill,
    font: {
      ...(cell.style.font ?? {}),
      bold: opts.bold ?? cell.style.font?.bold ?? false,
      italic: opts.italic ?? false,
      color: opts.fgArgb ? { argb: opts.fgArgb } : (cell.style.font?.color ?? { argb: C.neutralFg }),
      size: opts.fontSize ?? cell.style.font?.size ?? 10,
    },
    alignment: {
      horizontal: opts.hAlign ?? "left",
      vertical: opts.vAlign ?? "middle",
      wrapText: opts.wrapText ?? false,
    },
    border: opts.borders !== false ? allBorders() : undefined,
    numFmt: opts.numFmt ?? cell.style.numFmt,
  };
}

function writeMergedTitle(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  colEnd: number,
  text: string,
  opts: { bgArgb: string; fgArgb: string; fontSize?: number; bold?: boolean }
) {
  const ref = `${colLetter(colStart)}${row}:${colLetter(colEnd)}${row}`;
  try { ws.unMergeCells(ref); } catch { /* not merged yet */ }
  ws.mergeCells(ref);
  const cell = ws.getCell(row, colStart);
  cell.value = text;
  styleCell(cell, {
    bgArgb: opts.bgArgb,
    fgArgb: opts.fgArgb,
    bold: opts.bold ?? true,
    hAlign: "center",
    vAlign: "middle",
    fontSize: opts.fontSize ?? 11,
    borders: true,
  });
  ws.getRow(row).height = 22;
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

// ── Data helpers ───────────────────────────────────────────────────────────────

type SupplierStat = {
  name: string;
  total: number;      // CLP total neto
  itemsQuoted: number;
};

function computeSupplierStats(data: ConsolidatedComparison): {
  stats: SupplierStat[];
  totalItems: number;
} {
  const supplierNames = data.suppliers.map((s) => s.name);

  if (data.cascadeBlocks && data.cascadeBlocks.length > 0) {
    const uniqueItems = new Set(data.cascadeBlocks.flatMap((b) => b.items.map((i) => i.item)));
    const totalItems = uniqueItems.size;

    const stats: SupplierStat[] = data.suppliers.map((supplier, idx) => {
      const blocks = data.cascadeBlocks!.filter((b) => b.supplierIndex === idx);
      const itemsQuoted = blocks.reduce((sum, b) => sum + b.items.length, 0);
      const total = blocks.reduce((sum, b) => {
        return sum + b.items.reduce((s, i) => {
          const v = typeof i.total === "number" && Number.isFinite(i.total) && i.total > 0
            ? i.total
            : typeof i.unitPrice === "number" && Number.isFinite(i.unitPrice) && i.unitPrice > 0
              ? i.unitPrice * (Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1)
              : 0;
          return s + v;
        }, 0);
      }, 0);

      const economicTotal =
        typeof supplier.offerNetTotalCLP === "number" && Number.isFinite(supplier.offerNetTotalCLP) && supplier.offerNetTotalCLP > 0
          ? supplier.offerNetTotalCLP
          : total;

      return { name: supplier.name, total: economicTotal, itemsQuoted };
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
      const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
      const lineTotal =
        typeof offer.total === "number" && Number.isFinite(offer.total) && offer.total > 0
          ? offer.total
          : typeof offer.unitPrice === "number" && Number.isFinite(offer.unitPrice) && offer.unitPrice > 0
            ? offer.unitPrice * qty
            : 0;
      if (lineTotal > 0) {
        totalSum += lineTotal;
        itemsQuoted += 1;
      }
    }

    const economicTotal =
      typeof supplier.offerNetTotalCLP === "number" && Number.isFinite(supplier.offerNetTotalCLP) && supplier.offerNetTotalCLP > 0
        ? supplier.offerNetTotalCLP
        : totalSum;

    return { name: supplier.name, total: economicTotal, itemsQuoted };
  });

  return { stats, totalItems };
}

function formatClp(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Main export ────────────────────────────────────────────────────────────────

export type DashboardOptions = {
  omittedFilesCount?: number;
  needsReviewCount?: number;
};

const COL_START = 1;  // Column A
const DATA_COLS = 5;  // A-E: Nº | Proveedor | Total CLP | Ítems | Cobertura

export function writeDashboard(
  worksheet: ExcelJS.Worksheet,
  data: ConsolidatedComparison,
  dashboardStartRow: number,
  options: DashboardOptions = {}
) {
  const { stats, totalItems } = computeSupplierStats(data);

  if (stats.length === 0) return;

  const colEnd = COL_START + DATA_COLS - 1;   // column E
  let row = dashboardStartRow;

  // ── Set column widths (only on first pass so we don't overwrite main table cols)
  worksheet.getColumn(COL_START).width = 5;     // Nº
  worksheet.getColumn(COL_START + 1).width = 30; // Proveedor
  worksheet.getColumn(COL_START + 2).width = 20; // Total
  worksheet.getColumn(COL_START + 3).width = 12; // Ítems
  worksheet.getColumn(COL_START + 4).width = 13; // Cobertura

  // ══════════════════════════════════════════════════════════════
  // MAIN TITLE
  // ══════════════════════════════════════════════════════════════
  writeMergedTitle(worksheet, row, COL_START, colEnd, "RESUMEN EJECUTIVO — ANÁLISIS DE COTIZACIONES", {
    bgArgb: C.headerBg,
    fgArgb: C.headerFg,
    fontSize: 12,
  });
  row += 1;

  // ══════════════════════════════════════════════════════════════
  // A. TOTAL NETO POR PROVEEDOR
  // ══════════════════════════════════════════════════════════════
  writeMergedTitle(worksheet, row, COL_START, colEnd, "A. TOTAL NETO POR PROVEEDOR", {
    bgArgb: C.sectionBg,
    fgArgb: C.sectionFg,
    fontSize: 10,
  });
  row += 1;

  // Column headers
  const headers = ["Nº", "Proveedor", "Total CLP", "Ítems", "Cobertura"];
  for (let c = 0; c < headers.length; c++) {
    const cell = worksheet.getCell(row, COL_START + c);
    cell.value = headers[c];
    styleCell(cell, {
      bgArgb: C.subheaderBg,
      fgArgb: C.subheaderFg,
      bold: true,
      hAlign: c === 0 ? "center" : c >= 2 ? "right" : "left",
      borders: true,
    });
  }
  worksheet.getRow(row).height = 18;
  row += 1;

  // Sort by total to rank (winner = min, loser = max)
  const validStats = stats.filter((s) => s.total > 0);
  const sorted = [...validStats].sort((a, b) => a.total - b.total);
  const minTotal = sorted[0]?.total ?? 0;
  const maxTotal = sorted[sorted.length - 1]?.total ?? 0;

  const firstDataRow = row;

  for (const [rankIdx, stat] of sorted.entries()) {
    const isWinner = stat.total === minTotal && validStats.length > 1;
    const isLoser = stat.total === maxTotal && validStats.length > 1;
    const bgArgb = isWinner ? C.winnerBg : isLoser ? C.loserBg : rankIdx % 2 === 1 ? C.altRow : C.valueBg;
    const fgArgb = isWinner ? C.winnerFg : isLoser ? C.loserFg : C.neutralFg;

    const originalIdx = stats.indexOf(stat);
    const coverage = totalItems > 0 ? `${stat.itemsQuoted}/${totalItems} (${Math.round((stat.itemsQuoted / totalItems) * 100)}%)` : `${stat.itemsQuoted}`;

    const rowData: [number | string, number?][] = [
      [rankIdx + 1],
      [stat.name],
      [stat.total],
      [stat.itemsQuoted],
      [coverage],
    ];

    for (let c = 0; c < rowData.length; c++) {
      const cell = worksheet.getCell(row, COL_START + c);
      cell.value = rowData[c][0];
      styleCell(cell, {
        bgArgb,
        fgArgb,
        hAlign: c === 0 ? "center" : c >= 2 ? "right" : "left",
        numFmt: c === 2 ? '"$" #,##0' : undefined,
        borders: true,
      });
    }

    // Mark winner/loser with label in supplier column
    if (isWinner || isLoser) {
      const labelCell = worksheet.getCell(row, COL_START + 1);
      const tag = isWinner ? " ★ MÁS ECONÓMICO" : " ▲ MÁS CARO";
      labelCell.value = `${stat.name}${tag}`;
    }

    worksheet.getRow(row).height = 16;
    row += 1;
  }

  // Suppliers with no prices
  for (const stat of stats) {
    if (stat.total > 0) continue;
    const bgArgb = C.altRow;
    const values = ["-", stat.name, "Sin precios válidos", stat.itemsQuoted, "-"];
    for (let c = 0; c < values.length; c++) {
      const cell = worksheet.getCell(row, COL_START + c);
      cell.value = values[c];
      styleCell(cell, {
        bgArgb,
        fgArgb: C.border,
        hAlign: c === 0 ? "center" : c >= 2 ? "right" : "left",
        italic: true,
        borders: true,
      });
    }
    worksheet.getRow(row).height = 16;
    row += 1;
  }

  row += 1; // gap

  // ══════════════════════════════════════════════════════════════
  // B. COBERTURA POR PROVEEDOR
  // ══════════════════════════════════════════════════════════════
  writeMergedTitle(worksheet, row, COL_START, colEnd, "B. COBERTURA POR PROVEEDOR", {
    bgArgb: C.sectionBg,
    fgArgb: C.sectionFg,
    fontSize: 10,
  });
  row += 1;

  const covHeaders = ["Nº", "Proveedor", "Ítems cotizados", "Total ítems", "Cobertura %"];
  for (let c = 0; c < covHeaders.length; c++) {
    const cell = worksheet.getCell(row, COL_START + c);
    cell.value = covHeaders[c];
    styleCell(cell, {
      bgArgb: C.subheaderBg,
      fgArgb: C.subheaderFg,
      bold: true,
      hAlign: c >= 2 ? "center" : "left",
      borders: true,
    });
  }
  worksheet.getRow(row).height = 18;
  row += 1;

  for (const [i, stat] of stats.entries()) {
    const pct = totalItems > 0 ? Math.round((stat.itemsQuoted / totalItems) * 100) : 0;
    const bgArgb = i % 2 === 0 ? C.valueBg : C.altRow;
    const covData = [i + 1, stat.name, stat.itemsQuoted, totalItems, `${pct}%`];
    for (let c = 0; c < covData.length; c++) {
      const cell = worksheet.getCell(row, COL_START + c);
      cell.value = covData[c];
      styleCell(cell, {
        bgArgb,
        hAlign: c === 0 ? "center" : c >= 2 ? "center" : "left",
        borders: true,
      });
    }
    worksheet.getRow(row).height = 16;
    row += 1;
  }

  row += 1; // gap

  // ══════════════════════════════════════════════════════════════
  // C. RESUMEN EJECUTIVO
  // ══════════════════════════════════════════════════════════════
  writeMergedTitle(worksheet, row, COL_START, colEnd, "C. RESUMEN EJECUTIVO", {
    bgArgb: C.sectionBg,
    fgArgb: C.sectionFg,
    fontSize: 10,
  });
  row += 1;

  const winner = sorted[0];
  const loser  = sorted[sorted.length - 1];
  const savings = winner && loser && sorted.length > 1 ? loser.total - winner.total : null;

  const summaryRows: Array<[string, string | number]> = [];

  if (winner) {
    summaryRows.push(["Proveedor más económico", winner.name]);
    summaryRows.push(["Total más bajo", winner.total]);
  }
  if (savings !== null && savings > 0) {
    summaryRows.push(["Ahorro estimado vs. más caro", savings]);
  }
  summaryRows.push(["Total ítems comparados", totalItems]);
  summaryRows.push(["Proveedores analizados", stats.length]);
  summaryRows.push(["Warnings generados", data.warnings.length]);

  if (typeof options.omittedFilesCount === "number") {
    summaryRows.push(["Archivos omitidos", options.omittedFilesCount]);
  }
  if (typeof options.needsReviewCount === "number") {
    summaryRows.push(["Documentos que requieren revisión", options.needsReviewCount]);
  }

  for (const [i, [label, value]] of summaryRows.entries()) {
    const bgLabel = C.labelBg;
    const bgValue = i % 2 === 0 ? C.valueBg : C.altRow;

    // Label (cols 1-2 merged)
    const labelRef = `${colLetter(COL_START)}${row}:${colLetter(COL_START + 1)}${row}`;
    try { worksheet.unMergeCells(labelRef); } catch { /* ok */ }
    worksheet.mergeCells(labelRef);
    const labelCell = worksheet.getCell(row, COL_START);
    labelCell.value = label;
    styleCell(labelCell, { bgArgb: bgLabel, bold: true, hAlign: "left", borders: true, fontSize: 9 });

    // Value (cols 3-5 merged)
    const valueRef = `${colLetter(COL_START + 2)}${row}:${colLetter(colEnd)}${row}`;
    try { worksheet.unMergeCells(valueRef); } catch { /* ok */ }
    worksheet.mergeCells(valueRef);
    const valueCell = worksheet.getCell(row, COL_START + 2);
    const isMonetary = typeof value === "number" && (label.toLowerCase().includes("total") || label.toLowerCase().includes("ahorro"));
    valueCell.value = value;
    styleCell(valueCell, {
      bgArgb: bgValue,
      hAlign: "left",
      borders: true,
      numFmt: isMonetary ? '"$" #,##0' : undefined,
      fontSize: 9,
    });

    worksheet.getRow(row).height = 16;
    row += 1;
  }
}
