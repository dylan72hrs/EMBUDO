import type { AnalyticsSupplier, PurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";

type Props = {
  analytics: PurchaseAnalytics;
  budgetObjective?: number | null;
};

const DONUT_COLORS = ["#4ad6ff", "#7c9bff", "#a78bfa", "#34d399", "#fbbf24", "#f87171"];

function formatClp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatClpCompact(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  if (Math.abs(value) < 1_000_000) return formatClp(value);
  return `$${new Intl.NumberFormat("es-CL", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value)}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/D";
  return `${value.toFixed(1)}%`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

type KpiCardProps = {
  label: string;
  value: string;
  caption?: string;
  tone?: "default" | "positive" | "warning" | "critical";
};

function KpiCard({ label, value, caption, tone = "default" }: KpiCardProps) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "critical"
          ? "text-rose-300"
          : "text-white";

  return (
    <article className="embudo-analytics-card">
      <p className="embudo-analytics-label">{label}</p>
      <p className={`mt-1.5 text-xl font-bold tracking-tight ${valueClass}`}>{value}</p>
      {caption && <p className="embudo-analytics-caption truncate">{caption}</p>}
    </article>
  );
}

function RecommendationChip({ recommendation }: { recommendation: AnalyticsSupplier["recommendation"] }) {
  const styles =
    recommendation === "Mejor oferta"
      ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-200"
      : recommendation === "Revisar"
        ? "border-amber-300/40 bg-amber-400/10 text-amber-200"
        : recommendation === "No comparable"
          ? "border-rose-300/40 bg-rose-400/10 text-rose-200"
          : "border-sky-300/40 bg-sky-400/10 text-sky-200";

  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${styles}`}>
      {recommendation}
    </span>
  );
}

function SpendDonut({ suppliers, total }: { suppliers: AnalyticsSupplier[]; total: number }) {
  const radius = 56;
  const strokeWidth = 17;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  const segments = suppliers.map((supplier, index) => {
    const fraction = total > 0 ? supplier.total / total : 0;
    const length = fraction * circumference;
    const segment = {
      name: supplier.name,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
      dasharray: `${length} ${circumference - length}`,
      dashoffset: -accumulated,
      share: supplier.share
    };
    accumulated += length;
    return segment;
  });

  return (
    <div className="flex flex-col items-center gap-3 xl:flex-row xl:items-center">
      <svg viewBox="0 0 150 150" className="h-40 w-40 shrink-0" role="img" aria-label="Distribucion del gasto por proveedor">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="rgba(15, 28, 55, 0.9)" strokeWidth={strokeWidth} />
        {segments.map((segment) => (
          <circle
            key={segment.name}
            cx="75"
            cy="75"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeDasharray={segment.dasharray}
            strokeDashoffset={segment.dashoffset}
            transform="rotate(-90 75 75)"
            strokeLinecap="butt"
          />
        ))}
        <text x="75" y="71" textAnchor="middle" fill="#f4f8ff" fontSize="13" fontWeight="700">
          {formatClpCompact(total)}
        </text>
        <text x="75" y="86" textAnchor="middle" fill="#95a4c6" fontSize="8">
          Total evaluado
        </text>
      </svg>
      <ul className="w-full space-y-1.5 text-[11px]">
        {segments.map((segment) => (
          <li key={segment.name} className="flex items-center gap-2 text-white/85">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />
            <span className="min-w-0 flex-1 truncate">{segment.name}</span>
            <span className="font-semibold text-white">{segment.share.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PurchaseAnalyticsDashboard({ analytics, budgetObjective }: Props) {
  const suppliers = analytics.suppliers;
  const best = analytics.bestSupplier;
  const worst = analytics.worstSupplier;
  const maxTotal = Math.max(...suppliers.map((supplier) => supplier.total), 0);

  const manualBudget =
    typeof budgetObjective === "number" && Number.isFinite(budgetObjective) && budgetObjective > 0
      ? budgetObjective
      : null;
  const usesManualBudget = manualBudget !== null;
  const savingsReferenceLabel = usesManualBudget ? "presupuesto objetivo" : "la oferta más cara";
  const savingsClp =
    manualBudget !== null && best ? manualBudget - best.total : analytics.savingsVsWorstClp;
  const savingsPct =
    manualBudget !== null && best
      ? ((manualBudget - best.total) / manualBudget) * 100
      : analytics.savingsVsWorstPct;

  if (suppliers.length === 0) {
    return (
      <section className="embudo-analytics-panel rounded-2xl p-4 sm:p-6">
        <p className="embudo-kicker">Panel ejecutivo de compras</p>
        <p className="mt-2 text-sm text-white/75">
          Sin datos suficientes para construir la analítica: no hay proveedores con totales netos comparables.
        </p>
      </section>
    );
  }

  return (
    <section className="embudo-analytics-panel space-y-4 rounded-2xl p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="embudo-kicker">Panel ejecutivo de compras</p>
          <h3 className="mt-1 text-lg font-semibold text-white sm:text-xl">
            Análisis comparativo de cotizaciones
          </h3>
          <p className="text-[11px] text-white/70">
            Totales netos CLP calculados ítem por ítem — misma fuente que la tabla comparativa Excel.
          </p>
        </div>
        <div className="text-right text-[10px] leading-4 text-white/65">
          {analytics.exchangeRate.finalRate !== null && (
            <p>
              Tipo de cambio aplicado: {analytics.exchangeRate.finalRate} CLP/USD ·{" "}
              {analytics.exchangeRate.source}
            </p>
          )}
          <p>Comparación válida solo para ítems comparables.</p>
        </div>
      </div>

      {analytics.singleSupplier && (
        <div className="rounded-xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-[12px] text-amber-100">
          Riesgo: se procesó una sola cotización válida. No existe comparación entre múltiples
          proveedores; los indicadores de ahorro no aplican.
        </div>
      )}

      {/* A. KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Proveedores válidos" value={String(suppliers.length)} caption={`${analytics.itemsCompared} ítems comparados`} />
        <KpiCard label="Total neto evaluado" value={formatClpCompact(analytics.totalEvaluatedClp)} caption={formatClp(analytics.totalEvaluatedClp)} />
        <KpiCard
          label="Mejor oferta neta"
          value={formatClpCompact(best?.total ?? null)}
          caption={best?.name ?? "Sin oferta válida"}
          tone="positive"
        />
        <KpiCard
          label={usesManualBudget ? "Ahorro vs presupuesto" : "Ahorro estimado"}
          value={analytics.hasComparison || usesManualBudget ? formatClpCompact(savingsClp) : "N/D"}
          caption={
            analytics.hasComparison || usesManualBudget
              ? `${formatPercent(savingsPct)} frente a ${savingsReferenceLabel}`
              : "Requiere más de un proveedor"
          }
          tone={typeof savingsClp === "number" && savingsClp < 0 ? "critical" : "positive"}
        />
        <KpiCard
          label="Revisión requerida"
          value={analytics.needsReviewCount > 0 ? `Sí · ${analytics.needsReviewCount}` : "No"}
          caption="Documentos con observaciones"
          tone={analytics.needsReviewCount > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Archivos omitidos"
          value={String(analytics.omittedFilesCount)}
          caption="No eran cotizaciones válidas"
          tone={analytics.omittedFilesCount > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Advertencias"
          value={String(analytics.warningsCount)}
          caption="Detalle en el resumen del proceso"
          tone={analytics.warningsCount > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Cobertura de cotización"
          value={analytics.coverageAvailable ? "Disponible" : "N/D"}
          caption={
            analytics.coverageAvailable
              ? "Ítems cotizados sobre solicitados"
              : "Sin lista de ítems solicitados común"
          }
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-5">
        {/* B. Ranking de gasto por proveedor */}
        <article className={`embudo-analytics-card ${analytics.hasComparison ? "xl:col-span-3" : "xl:col-span-5"}`}>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="embudo-widget-title">Ranking de total neto por proveedor</h4>
            <span className="embudo-widget-meta">CLP neto · menor a mayor</span>
          </div>
          <div className="space-y-3">
            {suppliers.map((supplier) => {
              const isBest = best !== null && supplier.name === best.name;
              const isWorst =
                analytics.hasComparison && worst !== null && supplier.name === worst.name;
              const width = maxTotal > 0 ? clampPercent((supplier.total / maxTotal) * 100) : 0;
              const barClass = isBest
                ? "embudo-coverage-ok"
                : isWorst
                  ? "embudo-coverage-low"
                  : "embudo-analytics-bar";

              return (
                <div key={supplier.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-2 text-white/90">
                      <span className="truncate">{supplier.name}</span>
                      {isBest && (
                        <span className="shrink-0 rounded-full border border-emerald-300/40 bg-emerald-400/10 px-1.5 text-[9px] font-semibold text-emerald-200">
                          Más económico
                        </span>
                      )}
                      {isWorst && (
                        <span className="shrink-0 rounded-full border border-rose-300/40 bg-rose-400/10 px-1.5 text-[9px] font-semibold text-rose-200">
                          Más caro
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold text-white">{formatClp(supplier.total)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-900/75">
                    <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(width, 2)}%` }} />
                  </div>
                  <p className="text-[10px] text-white/60">
                    {supplier.itemsQuoted} ítem{supplier.itemsQuoted === 1 ? "" : "s"} cotizado
                    {supplier.itemsQuoted === 1 ? "" : "s"}
                    {supplier.deltaVsBest > 0 ? ` · +${formatClp(supplier.deltaVsBest)} sobre la mejor oferta` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </article>

        {/* C. Distribución de gasto (solo con 2+ proveedores) */}
        {analytics.hasComparison && (
          <article className="embudo-analytics-card xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="embudo-widget-title">Distribución del gasto evaluado</h4>
              <span className="embudo-widget-meta">% participación</span>
            </div>
            <SpendDonut suppliers={suppliers} total={analytics.totalEvaluatedClp} />
          </article>
        )}
      </div>

      {/* D. Cobertura de cotización (solo si es calculable) */}
      {analytics.coverageAvailable && (
        <article className="embudo-analytics-card">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="embudo-widget-title">Cobertura de cotización</h4>
            <span className="embudo-widget-meta">Ítems cotizados / solicitados</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {suppliers.map((supplier) => {
              const coverage =
                analytics.itemsCompared > 0
                  ? clampPercent((supplier.itemsQuoted / analytics.itemsCompared) * 100)
                  : 0;
              return (
                <div key={supplier.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-white/90">
                    <span className="truncate">{supplier.name}</span>
                    <span>
                      {supplier.itemsQuoted}/{analytics.itemsCompared} ({coverage.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-900/75">
                    <div
                      className={`h-full rounded-full ${coverage < 70 ? "embudo-coverage-low" : "embudo-coverage-ok"}`}
                      style={{ width: `${coverage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {/* E. Matriz de decisión */}
      <article className="embudo-analytics-card overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="embudo-widget-title">Matriz de decisión</h4>
          <span className="embudo-widget-meta">Resumen para adjudicación</span>
        </div>
        <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/15 text-[10px] uppercase tracking-[0.08em] text-white/55">
              <th className="py-2 pr-3 font-semibold">Proveedor</th>
              <th className="py-2 pr-3 font-semibold">Total neto CLP</th>
              <th className="py-2 pr-3 font-semibold">Cobertura</th>
              <th className="py-2 pr-3 font-semibold">Dif. vs mejor</th>
              <th className="py-2 pr-3 font-semibold">Revisión</th>
              <th className="py-2 font-semibold">Recomendación</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.name} className="border-b border-white/5 text-white/90">
                <td className="max-w-[200px] py-2 pr-3 font-medium">
                  <span className="block truncate">{supplier.name}</span>
                  {supplier.quotationNumber && (
                    <span className="block text-[10px] font-normal text-white/55">
                      Cotización N° {supplier.quotationNumber}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 font-semibold text-white">{formatClp(supplier.total)}</td>
                <td className="py-2 pr-3">
                  {analytics.coverageAvailable
                    ? `${supplier.itemsQuoted}/${analytics.itemsCompared}`
                    : `${supplier.itemsQuoted} ítems · N/D`}
                </td>
                <td className="py-2 pr-3">
                  {supplier.deltaVsBest > 0 ? `+${formatClp(supplier.deltaVsBest)}` : "—"}
                </td>
                <td className="py-2 pr-3">
                  {supplier.needsReview ? (
                    <span className="font-semibold text-amber-300">Sí</span>
                  ) : (
                    <span className="text-white/65">No</span>
                  )}
                </td>
                <td className="py-2">
                  <RecommendationChip recommendation={supplier.recommendation} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      {/* F. Mensaje ejecutivo */}
      <article className="embudo-analytics-card">
        <h4 className="embudo-widget-title">Mensaje ejecutivo</h4>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-white/85">
          {best && (
            <li>
              Proveedor con menor total neto: <span className="font-semibold text-white">{best.name}</span>{" "}
              ({formatClp(best.total)}).
            </li>
          )}
          {analytics.hasComparison || usesManualBudget ? (
            <li>
              Ahorro estimado frente a {savingsReferenceLabel}:{" "}
              <span className={`font-semibold ${typeof savingsClp === "number" && savingsClp < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {formatClp(savingsClp)} ({formatPercent(savingsPct)})
              </span>
              .
            </li>
          ) : (
            <li>No existe comparación entre múltiples proveedores; ahorro estimado no aplica.</li>
          )}
          <li>
            Revisión requerida:{" "}
            <span className={`font-semibold ${analytics.needsReviewCount > 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {analytics.needsReviewCount > 0 ? `Sí (${analytics.needsReviewCount} proveedor${analytics.needsReviewCount > 1 ? "es" : ""})` : "No"}
            </span>
            .
          </li>
          <li>Comparación válida solo para ítems comparables.</li>
        </ul>
      </article>
    </section>
  );
}
