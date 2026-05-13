export function parseMoney(input: string): number | null {
  const cleaned = input
    .replace(/(?:US\$|USD|CLP|\$)/gi, "")
    .replace(/[^\d.,-]/g, "")
    .trim();

  if (!cleaned) return null;
  if (cleaned.startsWith("-")) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    normalized =
      lastDot > lastComma
        ? cleaned.replace(/,/g, "")
        : cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const looksLikeThousands =
      parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    normalized = looksLikeThousands ? parts.join("") : cleaned;
  } else if (hasComma) {
    const parts = cleaned.split(",");
    const looksLikeThousands =
      parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
    normalized = looksLikeThousands ? parts.join("") : cleaned.replace(",", ".");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
