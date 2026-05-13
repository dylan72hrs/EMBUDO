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
    <section className="space-y-5">
      <div
        {...getRootProps()}
        className={`flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition ${
          isDragActive
            ? "border-cyan-300 bg-cyan-400/10 shadow-[0_0_0_4px_rgba(103,232,249,0.12)]"
            : "border-slate-600 bg-slate-950/45"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-2xl text-cyan-200">
          +
        </div>
        <h2 className="mt-5 text-xl font-semibold text-white">Arrastra tus cotizaciones PDF</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">
          Puedes subir hasta 20 archivos PDF, con un máximo de 20 MB por archivo.
        </p>
        <button
          type="button"
          onClick={open}
          className="mt-6 h-11 rounded-md bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
        >
          Añadir archivos
        </button>
      </div>

      {files.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-950/55">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <p className="text-sm font-semibold text-white">Archivos seleccionados</p>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
              {files.length} de 20
            </span>
          </div>
          <ul className="max-h-64 divide-y divide-slate-800 overflow-auto">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-800 text-xs font-bold text-cyan-200">
                  PDF
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatSize(file.size)} - Listo para procesar</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="rounded px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fileRejections.length > 0 && (
        <p className="text-sm text-rose-200">Algunos archivos fueron rechazados por tipo o tamaño.</p>
      )}
    </section>
  );
}
