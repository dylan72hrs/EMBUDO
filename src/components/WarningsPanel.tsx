type Props = {
  warnings: string[];
};

export function WarningsPanel({ warnings }: Props) {
  if (warnings.length === 0) return null;

  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-950">Advertencias</h2>
      <ul className="mt-2 space-y-1 text-sm text-amber-900">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}
