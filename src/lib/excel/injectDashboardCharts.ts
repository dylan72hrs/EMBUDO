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

// ── main export ───────────────────────────────────────────────────────────────

export async function injectDashboardCharts(
  outputPath: string,
  templatePath: string
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

  // 7. Write new files into output ZIP
  outputZip.file(sheetPath,       tplSheet);
  outputZip.file(sheetRelsPath,   patchedSheetRels);
  outputZip.file(drawingPath,     tplDrawing);
  outputZip.file(drawingRelsPath, patchedDrawingRels);
  outputZip.file(chart1Path,      tplChart1);
  outputZip.file(chart2Path,      tplChart2);

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
