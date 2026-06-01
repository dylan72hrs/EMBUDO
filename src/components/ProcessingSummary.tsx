import { DownloadButton } from "@/components/DownloadButton";
import type { PurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";

type DocumentDiagnostic = {
  filename: string;
  typeDetected: string;
  status: "processed" | "omitted";
  reason: string;
  missing: string[];
  action: string;
};

export type ProcessResult = {
  jobId?: string;
  folio?: string;
  status: "completed" | "error";
  suppliers?: string[];
  itemsDetected?: number;
  warnings: string[];
  downloadUrl?: string;
  message?: string;
  title?: string;
  analytics?: PurchaseAnalytics;
  budgetObjective?: number | null;
  documentDiagnostics?: DocumentDiagnostic[];
};

type Props = {
  result: ProcessResult | null;
  onFolioAssigned?: (folio: string) => void;
};

const WARNING_SECTIONS = [
  "TIPO DE CAMBIO",
  "CONVERSION DE MONEDAS",
  "LINEAS OMITIDAS",
  "RIESGOS"
] as const;

function groupWarnings(warnings: string[]) {
  const grouped = new Map<string, string[]>();
  for (const section of WARNING_SECTIONS) {
    grouped.set(section, []);
  }
  grouped.set("OTROS", []);

  for (const warning of warnings) {
    const match = warning.match(/^\[(.+?)\]\s*(.+)$/);
    if (!match) {
      grouped.get("OTROS")?.push(warning);
      continue;
    }

    const section = match[1].toUpperCase();
    const message = match[2].trim();
    if (grouped.has(section)) {
      grouped.get(section)?.push(message);
    } else {
      grouped.get("OTROS")?.push(warning);
    }
  }

  return grouped;
}

export function ProcessingSummary({ result, onFolioAssigned }: Props) {
  if (!result) return null;
  const diagnostics = result.documentDiagnostics ?? [];
  const omittedDocs = diagnostics.filter((doc) => doc.status === "omitted");
  const groupedWarnings = groupWarnings(result.warnings);

  if (result.status === "error") {
    return (
      <section className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-6 text-white">
        <h2 className="text-2xl font-semibold">{result.title ?? "No se encontraron cotizaciones validas"}</h2>
        <p className="mt-2 text-sm leading-6 text-rose-100">
          {result.message ??
            "Los archivos enviados no corresponden a cotizaciones de proveedores o no contienen una tabla reconocible de productos, cantidades, precios y moneda."}
        </p>
        {result.folio && (
          <p className="mt-2 text-xs font-semibold text-rose-100">Folio: {result.folio}</p>
        )}
        {omittedDocs.length > 0 && (
          <div className="mt-5 space-y-3">
            {omittedDocs.map((doc) => (
              <article
                key={`${doc.filename}-${doc.typeDetected}`}
                className="rounded-lg border border-rose-300/25 bg-slate-950/40 p-4"
              >
                <p className="text-sm font-semibold text-white">Archivo: {doc.filename}</p>
                <p className="mt-1 text-xs text-rose-100">Tipo detectado: {doc.typeDetected}</p>
                <p className="mt-2 text-xs text-rose-100">Motivo: {doc.reason}</p>
                <p className="mt-2 text-xs text-rose-100">Que le falta:</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-rose-100">
                  {doc.missing.map((item) => (
                    <li key={`${doc.filename}-${item}`}>{item}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-rose-100">Accion sugerida: {doc.action}</p>
              </article>
            ))}
            <div className="grid gap-2 rounded-lg border border-rose-200/20 bg-slate-950/45 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-100">Lo que subiste</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-100">
                  <li>Solicitud OC o documento interno</li>
                  <li>Total general e IVA</li>
                  <li>Servicios sin estructura de cotizacion comparable</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-100">
                  Lo que necesita la plataforma
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-100">
                  <li>Cotizacion de proveedor</li>
                  <li>Producto y cantidad</li>
                  <li>Precio unitario y total</li>
                  <li>Moneda y condiciones comerciales</li>
                </ul>
              </div>
            </div>
            <div className="rounded-lg border border-rose-200/20 bg-slate-950/45 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-100">
                Ejemplo de documento valido
              </p>
              <p className="mt-2 text-xs text-rose-100">Proveedor: Echave Turri</p>
              <p className="text-xs text-rose-100">Producto: Notebook Dell Pro 14</p>
              <p className="text-xs text-rose-100">Cantidad: 12</p>
              <p className="text-xs text-rose-100">Precio unitario: US$ 1,156.00</p>
              <p className="text-xs text-rose-100">Total: US$ 13,872.00</p>
            </div>
          </div>
        )}
        {result.warnings.length > 0 && (
          <details className="mt-5 rounded-lg border border-rose-300/20 bg-slate-950/40 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-rose-100">
              Ver warnings del proceso
            </summary>
            <ul className="mt-3 space-y-2 text-sm text-rose-100">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-6 rounded-xl border border-cyan-300/20 bg-slate-950/50 p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Tabla comparativa lista</h2>
          <p className="mt-2 text-sm text-slate-300">El Excel fue generado correctamente.</p>
          <p className="mt-2 text-xs font-semibold text-cyan-100">
            Folio: {result.folio ? result.folio : "Pendiente de emision"}
          </p>
        </div>
        <DownloadButton downloadUrl={result.downloadUrl} onFolioAssigned={onFolioAssigned} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-400">Proveedores detectados</p>
          <p className="mt-2 text-sm font-medium">{result.suppliers?.join(", ") || "Sin proveedores"}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-400">Requerimientos comparativos</p>
          <p className="mt-2 text-sm font-medium">{result.itemsDetected ?? 0}</p>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <details className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-amber-100">
            Ver advertencias
          </summary>
          <div className="mt-3 space-y-4 text-sm text-amber-100">
            {WARNING_SECTIONS.map((section) => {
              const entries = groupedWarnings.get(section) ?? [];
              if (entries.length === 0) return null;
              return (
                <div key={section}>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-200">
                    {section}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {entries.map((entry, index) => (
                      <li key={`${section}-${index}`}>{entry}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {(groupedWarnings.get("OTROS") ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-200">
                  OTROS
                </p>
                <ul className="mt-2 space-y-1.5">
                  {(groupedWarnings.get("OTROS") ?? []).map((entry, index) => (
                    <li key={`otros-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      {omittedDocs.length > 0 && (
        <details className="rounded-lg border border-sky-300/30 bg-sky-950/20 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-sky-100">
            Ver archivos omitidos (no eran cotizaciones validas)
          </summary>
          <div className="mt-3 space-y-3">
            {omittedDocs.map((doc) => (
              <article
                key={`${doc.filename}-${doc.typeDetected}`}
                className="rounded-lg border border-sky-300/25 bg-slate-950/35 p-3"
              >
                <p className="text-sm font-semibold text-white">{doc.filename}</p>
                <p className="mt-1 text-xs text-sky-100">Tipo detectado: {doc.typeDetected}</p>
                <p className="mt-1 text-xs text-sky-100">Motivo: {doc.reason}</p>
                <p className="mt-1 text-xs text-sky-100">Que hacer: {doc.action}</p>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
