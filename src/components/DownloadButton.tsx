"use client";

import { useState } from "react";

type Props = {
  downloadUrl?: string;
  onFolioAssigned?: (folio: string) => void;
};

function extractFilename(contentDisposition: string | null) {
  if (!contentDisposition) return "tabla-comparativa.xlsx";
  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] ?? "tabla-comparativa.xlsx";
}

export function DownloadButton({ downloadUrl, onFolioAssigned }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!downloadUrl) return null;
  const safeDownloadUrl = downloadUrl;

  async function confirmAndDownload() {
    setIsIssuing(true);
    setErrorMessage("");

    try {
      const separator = safeDownloadUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${safeDownloadUrl}${separator}confirmIssue=true`, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? "No se pudo emitir el documento.");
      }

      const folio = response.headers.get("X-Document-Folio") ?? "";
      if (folio) onFolioAssigned?.(folio);

      const blob = await response.blob();
      const filename = extractFilename(response.headers.get("Content-Disposition"));
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setShowConfirm(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo descargar el archivo.");
    } finally {
      setIsIssuing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="inline-flex h-12 items-center justify-center rounded-md bg-cyan-300 px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
      >
        Descargar Excel
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="embudo-glass liquid-glass w-full max-w-md rounded-2xl p-6 text-white">
            <h3 className="text-xl font-semibold">Confirmar emision de documento</h3>
            <p className="mt-3 text-sm leading-6 text-slate-200">
              Al confirmar, se generara un folio correlativo para esta tabla comparativa y el documento
              quedara listo para descarga.
            </p>
            <p className="mt-3 text-sm font-medium text-white">
              Esta seguro de que va a firmar/emitir este documento?
            </p>

            {errorMessage && (
              <p className="mt-3 rounded-md border border-rose-300/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                {errorMessage}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={isIssuing}
                className="h-10 rounded-lg border border-slate-500 px-4 text-sm font-semibold text-slate-200 transition hover:bg-slate-800/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmAndDownload}
                disabled={isIssuing}
                className="embudo-primary-btn h-10 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isIssuing ? "Generando folio..." : "Confirmar y descargar Excel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
