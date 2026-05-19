import type { PurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";

type Props = {
  analytics: PurchaseAnalytics;
};

type PriceConsistency = {
  cheapest: number;
  middle: number;
  expensive: number;
  comparable: number;
};

function formatClp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Sin datos";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function percentage(value: number, total: number) {
  if (total <= 0 || value <= 0) return 0;
  return (value / total) * 100;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getCoverageClass(coverage: number) {
  return coverage < 70 ? "embudo-coverage-low" : "embudo-coverage-ok";
}

function createConsistencyMap(analytics: PurchaseAnalytics) {
  const map = new Map<string, PriceConsistency>();
  for (const supplier of analytics.suppliers) {
    map.set(supplier.name, { cheapest: 0, middle: 0, expensive: 0, comparable: 0 });
  }

  for (const product of analytics.products) {
    if (product.offers.length === 0) continue;
    const sorted = [...product.offers].sort((a, b) => a.total - b.total);
    const min = sorted[0]?.total;
    const max = sorted[sorted.length - 1]?.total;
    if (min === undefined || max === undefined) continue;

    for (const offer of sorted) {
      const stats = map.get(offer.supplier);
      if (!stats) continue;
      stats.comparable += 1;

      if (offer.total === min && offer.total === max) {
        stats.cheapest += 1;
        continue;
      }

      if (offer.total === min) {
        stats.cheapest += 1;
        continue;
      }

      if (offer.total === max) {
        stats.expensive += 1;
        continue;
      }

      stats.middle += 1;
    }
  }

  return map;
}

function optimizedOrderTotal(analytics: PurchaseAnalytics) {
  return analytics.products.reduce((sum, product) => {
    if (!product.offers.length) return sum;
    const min = Math.min(...product.offers.map((offer) => offer.total));
    return sum + min;
  }, 0);
}

export function PurchaseAnalyticsDashboard({ analytics }: Props) {
  const totalProducts = analytics.products.length;
  const suppliersByCost = [...analytics.suppliers]
    .filter((supplier) => supplier.total > 0)
    .sort((a, b) => a.total - b.total);
  const totalSpend = suppliersByCost.reduce((sum, supplier) => sum + supplier.total, 0);
  const maxSupplierSpend = Math.max(...suppliersByCost.map((supplier) => supplier.total), 0);
  const consistencyMap = createConsistencyMap(analytics);

  const optimizedTotal = optimizedOrderTotal(analytics);
  const referenceBudgetRaw =
    suppliersByCost.length > 0 ? suppliersByCost.reduce((sum, supplier) => sum + supplier.total, 0) / suppliersByCost.length : 0;
  const referenceBudget = referenceBudgetRaw > 0 ? referenceBudgetRaw : optimizedTotal;
  const savings = referenceBudget - optimizedTotal;
  const savingsPercent = referenceBudget > 0 ? percentage(savings, referenceBudget) : 0;
  const bulletProgress = referenceBudget > 0 ? clampPercent((optimizedTotal / referenceBudget) * 100) : 0;

  return (
    <section className="embudo-analytics-panel space-y-3 rounded-2xl p-4 sm:p-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="embudo-kicker">Analitica de compra</p>
          <h3 className="mt-1 text-base font-semibold text-white sm:text-lg">
            Previsualizacion y resumen de proceso generado
          </h3>
          <p className="text-[11px] text-white/75">Vista ejecutiva para Finanzas y Logistica</p>
        </div>
        <div className="text-right text-[10px] text-white/70">
          <p>{analytics.suppliers.length} proveedores</p>
          <p>{totalProducts} productos</p>
          <p>{analytics.warningsCount} advertencias</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <article className="embudo-analytics-card embudo-widget-card">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="embudo-widget-title">Concentracion de Gasto</h4>
            <span className="embudo-widget-meta">CLP por proveedor</span>
          </div>
          <div className="space-y-2">
            {suppliersByCost.map((supplier) => {
              const share = percentage(supplier.total, totalSpend);
              const width = maxSupplierSpend > 0 ? clampPercent((supplier.total / maxSupplierSpend) * 100) : 0;
              return (
                <div key={supplier.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-white/90">
                    <span className="truncate">{supplier.name}</span>
                    <span>{formatClp(supplier.total)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-900/75">
                    <div className="embudo-analytics-bar h-full rounded-full" style={{ width: `${width}%` }} />
                  </div>
                  <p className="text-[10px] text-white/70">{share.toFixed(1)}% del gasto total</p>
                </div>
              );
            })}
            {suppliersByCost.length === 0 && <p className="text-[11px] text-white/75">Sin datos suficientes.</p>}
          </div>
        </article>

        <article className="embudo-analytics-card embudo-widget-card">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="embudo-widget-title">Capacidad de Entrega</h4>
            <span className="embudo-widget-meta">Items cotizados / solicitados</span>
          </div>
          <div className="space-y-2">
            {analytics.suppliers.map((supplier) => {
              const coverage = totalProducts > 0 ? percentage(supplier.productsQuoted, totalProducts) : 0;
              return (
                <div key={supplier.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-white/90">
                    <span className="truncate">{supplier.name}</span>
                    <span>
                      {supplier.productsQuoted}/{totalProducts} ({coverage.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-900/75">
                    <div
                      className={`h-full rounded-full ${getCoverageClass(coverage)}`}
                      style={{ width: `${clampPercent(coverage)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="embudo-analytics-card embudo-widget-card">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="embudo-widget-title">Consistencia de Precios</h4>
            <span className="embudo-widget-meta">Verde barato / Amarillo medio / Rojo caro</span>
          </div>
          <div className="space-y-2">
            {analytics.suppliers.map((supplier) => {
              const stats = consistencyMap.get(supplier.name);
              const comparable = stats?.comparable ?? 0;
              const cheap = stats?.cheapest ?? 0;
              const middle = stats?.middle ?? 0;
              const expensive = stats?.expensive ?? 0;

              const cheapPct = comparable > 0 ? clampPercent((cheap / comparable) * 100) : 0;
              const middlePct = comparable > 0 ? clampPercent((middle / comparable) * 100) : 0;
              const expensivePct = comparable > 0 ? clampPercent((expensive / comparable) * 100) : 0;

              return (
                <div key={supplier.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-white/90">
                    <span className="truncate">{supplier.name}</span>
                    <span>
                      V:{cheap} A:{middle} R:{expensive}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-900/75">
                    <div className="embudo-segment-green" style={{ width: `${cheapPct}%` }} />
                    <div className="embudo-segment-yellow" style={{ width: `${middlePct}%` }} />
                    <div className="embudo-segment-red" style={{ width: `${expensivePct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="embudo-analytics-card embudo-widget-card">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="embudo-widget-title">Margen de Ahorro</h4>
            <span className="embudo-widget-meta">Orden optimizada vs presupuesto de referencia</span>
          </div>

          <div className="space-y-2 text-[11px] text-white/85">
            <p>Orden optimizada: {formatClp(optimizedTotal)}</p>
            <p>Presupuesto de referencia: {formatClp(referenceBudget)}</p>
            <div className="h-3 rounded-full bg-slate-900/75 p-[2px]">
              <div className="h-full rounded-full bg-slate-950/80">
                <div className="embudo-bullet-fill h-full rounded-full" style={{ width: `${bulletProgress}%` }} />
              </div>
            </div>
            <p className={savings >= 0 ? "text-emerald-200" : "text-rose-200"}>
              {savings >= 0 ? "Ahorro estimado" : "Sobre presupuesto estimado"}: {formatClp(Math.abs(savings))} (
              {Math.abs(savingsPercent).toFixed(1)}%)
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
