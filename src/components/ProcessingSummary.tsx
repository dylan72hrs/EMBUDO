import { DownloadButton } from "@/components/DownloadButton";
import type { PurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";

export type ProcessResult = {
  jobId?: string;
  status: "completed" | "error";
  suppliers?: string[];
  itemsDetected?: number;
  warnings: string[];
  downloadUrl?: string;
  message?: string;
  analytics?: PurchaseAnalytics;
};

type Props = {
  result: ProcessResult | null;
};

export function ProcessingSummary({ result }: Props) {
  if (!result) return null;

  if (result.status === "error") {
    return (
      <section className="rounded-xl border border-rose-300/30 bg-rose-950/30 p-6 text-white">
        <h2 className="text-2xl font-semibold">No se pudo generar la tabla</h2>
        <p className="mt-2 text-sm leading-6 text-rose-100">
          {result.message ?? "Ocurrio un error inesperado durante el procesamiento."}
        </p>
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
        </div>
        <DownloadButton downloadUrl={result.downloadUrl} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-400">Proveedores detectados</p>
          <p className="mt-2 text-sm font-medium">{result.suppliers?.join(", ") || "Sin proveedores"}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4">
          <p className="text-xs uppercase text-slate-400">Productos detectados</p>
          <p className="mt-2 text-sm font-medium">{result.itemsDetected ?? 0}</p>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <details className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-amber-100">
            Ver advertencias
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-amber-100">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
