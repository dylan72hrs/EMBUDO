"use client";

import { useDropzone } from "react-dropzone";

type Props = {
  file: File | null;
  onFile: (file: File | null) => void;
};

export function TemplateUploader({ file, onFile }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
    },
    multiple: false,
    onDrop: (accepted) => onFile(accepted[0] ?? null)
  });

  return (
    <section className="rounded border border-line bg-white p-4">
      <label className="block text-sm font-semibold">Subir plantilla TABLA COMPARATIVA ejemplo.xlsx</label>
      <div
        {...getRootProps()}
        className={`mt-3 flex min-h-28 cursor-pointer items-center justify-center rounded border border-dashed px-4 text-center text-sm ${
          isDragActive ? "border-accent bg-teal-50" : "border-line bg-paper"
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <span className="font-medium">{file.name}</span>
        ) : (
          <span>Arrastra la plantilla XLSX o selecciónala desde tu equipo.</span>
        )}
      </div>
    </section>
  );
}
