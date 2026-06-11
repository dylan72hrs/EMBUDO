/**
 * Injects a pre-built RESUMEN sheet (with native Excel bar charts) from a
 * dashboard_chart_template.xlsx into the already-written output Excel file.
 *
 * Strategy: both .xlsx files are ZIP archives.  We read both with jszip,
 * copy the RESUMEN sheet's XML files (worksheet, drawing, charts) into the
 * output ZIP under fresh names so they don't collide with existing files,
 * then patch workbook.xml / workbook.xml.rels / [Content_Types].xml.
 *
 * The chart XML references sheet data via sheet NAME ('Dashboard_Data'!…),
 * so as long as the output workbook has a sheet called "Dashboard_Data" the
 * charts will populate automatically when Excel opens the file.
 */

import * as fs from "node:fs/promises";
import JSZip from "jszip";

const CHART_SHEET_NAME = "RESUMEN";
const WORKSHEET_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

// ── helpers ──────────────────────────────────────────────────────────────────

function maxNumberedFiles(zip: JSZip, pattern: RegExp): number {
  let max = 0;
  zip.forEach((relPath) => {
    const m = relPath.match(pattern);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

function maxRId(relsXml: string): number {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

function maxSheetId(workbookXml: string): number {
  let max = 0;
  for (const m of workbookXml.matchAll(/sheetId="(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

async function readZipFile(zip: JSZip, name: string): Promise<string> {
  const f = zip.file(name);
  if (!f) throw new Error(`injectDashboardCharts: expected ${name} in ZIP`);
  return f.async("string");
}

/**
 * The template charts reference 'Dashboard_Data'!$A$2:$A$7 (6 supplier slots).
 * Trims the series end row so the charts only cover the real suppliers written
 * by writeDashboardData (no empty categories / zero bars).
 */
function trimChartRanges(chartXml: string, supplierCount: number): string {
  if (!Number.isInteger(supplierCount) || supplierCount < 1 || supplierCount >= 6) {
    return chartXml;
  }
  const lastRow = 1 + supplierCount;
  return chartXml.replace(/(\$[A-Z]+\$2:\$[A-Z]+\$)7/g, `$1${lastRow}`);
}

// ── main export ───────────────────────────────────────────────────────────────

export async function injectDashboardCharts(
  outputPath: string,
  templatePath: string,
  supplierCount?: number
): Promise<void> {
  // 1. Load both ZIPs
  const [outputBuf, templateBuf] = await Promise.all([
    fs.readFile(outputPath),
    fs.readFile(templatePath),
  ]);

  const [outputZip, templateZip] = await Promise.all([
    JSZip.loadAsync(outputBuf),
    JSZip.loadAsync(templateBuf),
  ]);

  // 2. Read output manifest files
  const [workbookXml, workbookRelsXml, contentTypesXml] = await Promise.all([
    readZipFile(outputZip, "xl/workbook.xml"),
    readZipFile(outputZip, "xl/_rels/workbook.xml.rels"),
    readZipFile(outputZip, "[Content_Types].xml"),
  ]);

  // Guard: don't inject twice
  if (workbookXml.includes(`name="${CHART_SHEET_NAME}"`)) return;

  // 3. Determine next-available slot numbers
  const nextSheet   = maxNumberedFiles(outputZip, /xl\/worksheets\/sheet(\d+)\.xml$/) + 1;
  const nextDrawing = maxNumberedFiles(outputZip, /xl\/drawings\/drawing(\d+)\.xml$/) + 1;
  const nextChart   = maxNumberedFiles(outputZip, /xl\/charts\/chart(\d+)\.xml$/) + 1;
  const nextRId     = maxRId(workbookRelsXml) + 1;
  const nextSheetId = maxSheetId(workbookXml) + 1;

  // 4. Target paths in the output ZIP
  const sheetPath        = `xl/worksheets/sheet${nextSheet}.xml`;
  const sheetRelsPath    = `xl/worksheets/_rels/sheet${nextSheet}.xml.rels`;
  const drawingPath      = `xl/drawings/drawing${nextDrawing}.xml`;
  const drawingRelsPath  = `xl/drawings/_rels/drawing${nextDrawing}.xml.rels`;
  const chart1Path       = `xl/charts/chart${nextChart}.xml`;
  const chart2Path       = `xl/charts/chart${nextChart + 1}.xml`;

  // 5. Read template files
  const [
    tplSheet,
    tplSheetRels,
    tplDrawing,
    tplDrawingRels,
    tplChart1,
    tplChart2,
  ] = await Promise.all([
    readZipFile(templateZip, "xl/worksheets/sheet2.xml"),
    readZipFile(templateZip, "xl/worksheets/_rels/sheet2.xml.rels"),
    readZipFile(templateZip, "xl/drawings/drawing1.xml"),
    readZipFile(templateZip, "xl/drawings/_rels/drawing1.xml.rels"),
    readZipFile(templateZip, "xl/charts/chart1.xml"),
    readZipFile(templateZip, "xl/charts/chart2.xml"),
  ]);

  // 6. Patch internal references to use new file names
  const patchedSheetRels = tplSheetRels
    .replace(/Target="[^"]*drawing1\.xml"/, `Target="/${drawingPath}"`);

  const patchedDrawingRels = tplDrawingRels
    .replace(/Target="[^"]*chart1\.xml"/, `Target="/${chart1Path}"`)
    .replace(/Target="[^"]*chart2\.xml"/, `Target="/${chart2Path}"`);

  // 7. Write new files into output ZIP (chart ranges trimmed to real suppliers)
  outputZip.file(sheetPath,       tplSheet);
  outputZip.file(sheetRelsPath,   patchedSheetRels);
  outputZip.file(drawingPath,     tplDrawing);
  outputZip.file(drawingRelsPath, patchedDrawingRels);
  outputZip.file(chart1Path,      trimChartRanges(tplChart1, supplierCount ?? 0));
  outputZip.file(chart2Path,      trimChartRanges(tplChart2, supplierCount ?? 0));

  // 8. Patch workbook.xml – add <sheet .../> before </sheets>
  const updatedWorkbook = workbookXml.replace(
    "</sheets>",
    `<sheet name="${CHART_SHEET_NAME}" sheetId="${nextSheetId}" r:id="rId${nextRId}"/></sheets>`
  );

  // 9. Patch workbook.xml.rels – add relationship before </Relationships>
  const updatedWorkbookRels = workbookRelsXml.replace(
    "</Relationships>",
    `<Relationship Id="rId${nextRId}" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet${nextSheet}.xml"/></Relationships>`
  );

  // 10. Patch [Content_Types].xml – add overrides before </Types>
  const newOverrides =
    `<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
    `<Override PartName="/${chart1Path}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
    `<Override PartName="/${chart2Path}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;

  const updatedContentTypes = contentTypesXml.replace("</Types>", `${newOverrides}</Types>`);

  // 11. Write patched manifests back
  outputZip.file("xl/workbook.xml",           updatedWorkbook);
  outputZip.file("xl/_rels/workbook.xml.rels", updatedWorkbookRels);
  outputZip.file("[Content_Types].xml",        updatedContentTypes);

  // 12. Re-pack and overwrite the output file
  const buffer = await outputZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(outputPath, buffer);
}

// ── strip helper ──────────────────────────────────────────────────────────────

/**
 * Removes the injected RESUMEN sheet (and its drawing/charts) from the output
 * file so ExcelJS can safely re-read it (ExcelJS crashes on chart anchors).
 * Returns true if charts were found and removed, false if nothing to strip.
 * After your ExcelJS operation, call injectDashboardCharts again to restore.
 */
export async function stripDashboardCharts(outputPath: string): Promise<boolean> {
  const buf = await fs.readFile(outputPath);
  const zip = await JSZip.loadAsync(buf);

  const [workbookXml, workbookRelsXml, contentTypesXml] = await Promise.all([
    readZipFile(zip, "xl/workbook.xml"),
    readZipFile(zip, "xl/_rels/workbook.xml.rels"),
    readZipFile(zip, "[Content_Types].xml"),
  ]);

  // Find RESUMEN sheet entry → grab its rId
  const sheetEntryMatch = workbookXml.match(
    /<sheet[^>]*name="RESUMEN"[^>]*r:id="(rId\d+)"[^>]*\/>/
  );
  if (!sheetEntryMatch) return false;

  const resumenRId = sheetEntryMatch[1];

  // Resolve sheet file from workbook.xml.rels
  const relMatch = workbookRelsXml.match(
    new RegExp(`Id="${resumenRId}"[^>]*Target="([^"]+)"`)
  );
  if (!relMatch) return false;

  const sheetTarget   = relMatch[1]; // e.g. "worksheets/sheet5.xml"
  const sheetNumMatch = sheetTarget.match(/sheet(\d+)\.xml$/);
  if (!sheetNumMatch) return false;

  const sheetNum      = sheetNumMatch[1];
  const sheetPath     = `xl/${sheetTarget}`;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNum}.xml.rels`;

  // Resolve drawing from sheet rels
  let drawingPath: string | null = null;
  let drawingNum: string | null  = null;
  const sheetRelsFile = zip.file(sheetRelsPath);
  if (sheetRelsFile) {
    const sheetRelsXml = await sheetRelsFile.async("string");
    const dm = sheetRelsXml.match(/Target="[^"]*drawings\/drawing(\d+)\.xml"/);
    if (dm) {
      drawingNum  = dm[1];
      drawingPath = `xl/drawings/drawing${drawingNum}.xml`;
    }
  }

  // Resolve charts from drawing rels
  const chartPaths: string[] = [];
  if (drawingNum) {
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingNum}.xml.rels`;
    const drawingRelsFile = zip.file(drawingRelsPath);
    if (drawingRelsFile) {
      const drawingRelsXml = await drawingRelsFile.async("string");
      for (const m of drawingRelsXml.matchAll(/Target="[^"]*charts\/(chart\d+\.xml)"/g)) {
        chartPaths.push(`xl/charts/${m[1]}`);
      }
      zip.remove(drawingRelsPath);
    }
  }

  // Remove injected files
  zip.remove(sheetPath);
  zip.remove(sheetRelsPath);
  if (drawingPath) zip.remove(drawingPath);
  for (const cp of chartPaths) zip.remove(cp);

  // Patch workbook.xml
  const updatedWorkbook = workbookXml.replace(
    /<sheet[^>]*name="RESUMEN"[^>]*\/>/g,
    ""
  );

  // Patch workbook.xml.rels
  const updatedWorkbookRels = workbookRelsXml.replace(
    new RegExp(`<Relationship[^>]*Id="${resumenRId}"[^>]*\\/>`),
    ""
  );

  // Patch [Content_Types].xml
  const pathsToRemove = [sheetPath, ...(drawingPath ? [drawingPath] : []), ...chartPaths];
  let updatedContentTypes = contentTypesXml;
  for (const p of pathsToRemove) {
    const escaped = p.replace(/\//g, "\\/");
    updatedContentTypes = updatedContentTypes.replace(
      new RegExp(`<Override[^>]*PartName="\/${escaped}"[^>]*\/>`),
      ""
    );
  }

  zip.file("xl/workbook.xml",            updatedWorkbook);
  zip.file("xl/_rels/workbook.xml.rels",  updatedWorkbookRels);
  zip.file("[Content_Types].xml",         updatedContentTypes);

  const cleaned = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(outputPath, cleaned);
  return true;
}
