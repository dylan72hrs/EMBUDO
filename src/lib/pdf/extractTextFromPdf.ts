import { readFile } from "node:fs/promises";
import pdf from "pdf-parse";

export async function extractTextFromPdf(filePath: string) {
  const data = await readFile(filePath);
  const parsed = await pdf(data);
  return parsed.text.trim();
}
