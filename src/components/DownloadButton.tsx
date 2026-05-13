type Props = {
  downloadUrl?: string;
};

export function DownloadButton({ downloadUrl }: Props) {
  if (!downloadUrl) return null;

  return (
    <a
      href={downloadUrl}
      className="inline-flex h-12 items-center justify-center rounded-md bg-cyan-300 px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
    >
      Descargar Excel
    </a>
  );
}
