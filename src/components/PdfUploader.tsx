"use client";

import { useDropzone } from "react-dropzone";

type Props = {
  files: File[];
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
};

function formatSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function PdfUploader({ files, onFiles, onRemove }: Props) {
  const { getRootProps, getInputProps, isDragActive, fileRejections, open } = useDropzone({
    accept: {
      "application/pdf": [".pdf"]
    },
    multiple: true,
    maxFiles: 20,
    maxSize: 20 * 1024 * 1024,
    noClick: true,
    onDrop: (accepted) => {
      const merged = [...files, ...accepted].filter(
        (file, index, list) =>
          list.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index
      );
      onFiles(merged.slice(0, 20));
    }
  });

  return (
    <section className="space-y-3.5">
      <div
        {...getRootProps()}
        className={`group flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition ${
          isDragActive
            ? "border-cyan-300 bg-cyan-400/10 shadow-[0_0_0_4px_rgba(103,232,249,0.14)]"
            : "border-white/35 bg-slate-950/30 hover:border-cyan-200/80 hover:bg-slate-900/45"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/35 bg-slate-900/70 text-cyan-100 transition group-hover:border-cyan-300/70 group-hover:text-cyan-200">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden>
            <path
              d="M8 3.5h6l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.4 16h7.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8.4 13h7.2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">Arrastra tus cotizaciones PDF</h2>
        <p className="mt-1.5 max-w-md text-sm leading-6 text-white/82">
          Puedes subir hasta 20 archivos PDF, con un maximo de 20 MB por archivo.
        </p>
        <button
          type="button"
          onClick={open}
          className="mt-4 h-10 rounded-xl border border-cyan-200/45 bg-cyan-400/20 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/30 hover:text-white"
        >
          Anadir archivos
        </button>
      </div>

      {files.length > 0 && (
        <div className="rounded-2xl border border-white/20 bg-slate-950/40">
          <div className="flex items-center justify-between border-b border-slate-800/90 px-4 py-3">
            <p className="text-sm font-semibold text-white">Archivos seleccionados</p>
            <span className="rounded-full border border-white/20 bg-slate-900/80 px-3 py-1 text-xs text-white/80">
              {files.length} de 20
            </span>
          </div>
          <ul className="max-h-52 divide-y divide-slate-800/80 overflow-auto">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-xs font-bold text-cyan-200">
                  PDF
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatSize(file.size)} - Listo para procesar</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="rounded-lg px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fileRejections.length > 0 && (
        <p className="rounded-lg border border-rose-300/30 bg-rose-900/20 px-3 py-2 text-sm text-rose-200">
          Algunos archivos fueron rechazados por tipo o tamano.
        </p>
      )}
    </section>
  );
}
