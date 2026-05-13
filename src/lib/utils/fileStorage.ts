import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();

function configuredStorageDir() {
  const storageDir = process.env.STORAGE_DIR?.trim();
  return storageDir ? path.resolve(storageDir) : rootDir;
}

export function dataDir() {
  return path.join(configuredStorageDir(), "data");
}

export function uploadsDir() {
  return path.join(configuredStorageDir(), "uploads");
}

export function outputDir() {
  return path.join(configuredStorageDir(), "output");
}

export function templatesDir() {
  return path.join(configuredStorageDir(), "templates");
}

export function templateExcelPath() {
  return path.join(templatesDir(), "template.xlsx");
}

export function jobUploadDir(jobId: string) {
  return path.join(uploadsDir(), jobId);
}

export function jobPdfDir(jobId: string) {
  return path.join(jobUploadDir(jobId), "pdfs");
}

export function jobOutputDir(jobId: string) {
  return path.join(outputDir(), jobId);
}

export function outputExcelPath(jobId: string) {
  return path.join(jobOutputDir(jobId), "tabla-comparativa.xlsx");
}

export async function ensureStorageLayout() {
  await Promise.all([
    mkdir(dataDir(), { recursive: true }),
    mkdir(uploadsDir(), { recursive: true }),
    mkdir(outputDir(), { recursive: true }),
    mkdir(templatesDir(), { recursive: true })
  ]);

  const destinationTemplatePath = templateExcelPath();
  const repositoryTemplatePath = path.join(rootDir, "templates", "template.xlsx");

  try {
    await access(destinationTemplatePath);
    return;
  } catch {
    // The template is intentionally copied only when storage has no template yet.
  }

  if (path.resolve(destinationTemplatePath) === path.resolve(repositoryTemplatePath)) {
    return;
  }

  try {
    await access(repositoryTemplatePath);
    await copyFile(repositoryTemplatePath, destinationTemplatePath);
  } catch {
    // The process route reports a clear error if no usable template is available.
  }
}

export async function ensureJobDirectories(jobId: string) {
  await ensureStorageLayout();
  await mkdir(jobUploadDir(jobId), { recursive: true });
  await mkdir(jobPdfDir(jobId), { recursive: true });
  await mkdir(jobOutputDir(jobId), { recursive: true });
}

export async function saveUploadedFile(file: File, destinationPath: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, buffer);
}

export function sanitizeFilename(filename: string) {
  return filename.replace(/[^\w.\- ()]/g, "_");
}
