import type { PurchaseAnalytics } from "@/lib/analytics/buildPurchaseAnalytics";

type Props = {
  analytics: PurchaseAnalytics;
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

function formatRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Sin datos";
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function supplierPercent(total: number, max: number) {
  if (max <= 0 || total <= 0) return 0;
  return Math.min(100, Math.round((total / max) * 100));
}

function sourceLabel(mode: PurchaseAnalytics["exchangeRate"]["mode"]) {
  if (mode === "auto") return "Dolar observado";
  if (mode === "manual") return "Manual";
  if (mode === "fallback") return "Fallback";
  if (mode === "env") return "Entorno";
  return "Sin datos";
}

export function PurchaseAnalyticsDashboard({ analytics }: Props) {
  const rankedSuppliers = [...analytics.suppliers]
    .filter((supplier) => supplier.total > 0)
    .sort((a, b) => a.total - b.total);
  const maxSupplierTotal = Math.max(...rankedSuppliers.map((supplier) => supplier.total), 0);
  const costTotal = rankedSuppliers.reduce((sum, supplier) => sum + supplier.total, 0);
  const spreadProducts = [...analytics.products]
    .filter((product) => typeof product.spread === "number" && product.spread > 0)
    .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))
    .slice(0, 5);

  return (
    <section className="embudo-analytics-panel space-y-4 rounded-2xl p-5 sm:p-6">
      <div>
        <p className="embudo-kicker">Analitica de compra</p>
        <h3 className="mt-2 text-xl font-semibold text-white sm:text-2xl">Resumen post-proceso</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="embudo-analytics-card">
          <p className="embudo-analytics-label">Proveedores</p>
          <p className="embudo-analytics-value">{analytics.suppliers.length}</p>
          <p className="embudo-analytics-caption">Proveedores detectados</p>
        </article>
        <article className="embudo-analytics-card">
          <p className="embudo-analytics-label">Productos</p>
          <p className="embudo-analytics-value">{analytics.products.length}</p>
          <p className="embudo-analytics-caption">Productos comparados</p>
        </article>
        <article className="embudo-analytics-card">
          <p className="embudo-analytics-label">Mejor proveedor</p>
          <p className="embudo-analytics-value text-lg">
            {analytics.bestSupplier?.name ?? "Sin datos suficientes"}
          </p>
          <p className="embudo-analytics-caption">
            {analytics.bestSupplier ? formatClp(analytics.bestSupplier.total) : "Sin comparacion"}
          </p>
        </article>
        <article className="embudo-analytics-card">
          <p className="embudo-analytics-label">Advertencias</p>
          <p className="embudo-analytics-value">{analytics.warningsCount}</p>
          <p className="embudo-analytics-caption">Warnings detectados</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <article className="embudo-analytics-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-100">Total compra por proveedor</h4>
            <span className="text-xs text-slate-400">Basado en TOTAL por producto</span>
          </div>
          {rankedSuppliers.length > 0 ? (
            <div className="space-y-3">
              {rankedSuppliers.map((supplier) => {
                const width = supplierPercent(supplier.total, maxSupplierTotal);
                const share = costTotal > 0 ? (supplier.total / costTotal) * 100 : 0;
                return (
                  <div key={supplier.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>{supplier.name}</span>
                      <span>{formatClp(supplier.total)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-900/70">
                      <div className="embudo-analytics-bar h-full rounded-full" style={{ width: `${width}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {supplier.productsQuoted} productos cotizados · {share.toFixed(1)}% del costo total
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-300">Sin datos suficientes.</p>
          )}
        </article>

        <article className="embudo-analytics-card">
          <h4 className="text-sm font-semibold text-slate-100">Tipo de cambio usado</h4>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            <p>
              Fuente: <span className="font-semibold">{sourceLabel(analytics.exchangeRate.mode)}</span>
            </p>
            <p>
              Base: <span className="font-semibold">{formatRate(analytics.exchangeRate.baseRate)}</span>
            </p>
            <p>
              Margen: <span className="font-semibold">{formatRate(analytics.exchangeRate.margin)}</span>
            </p>
            <p>
              Aplicado:{" "}
              <span className="font-semibold text-cyan-200">
                {formatRate(analytics.exchangeRate.finalRate)} CLP/USD
              </span>
            </p>
            <p className="text-xs text-slate-400">Origen: {analytics.exchangeRate.source}</p>
          </div>
        </article>
      </div>

      <article className="embudo-analytics-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-100">Productos con mayor diferencia</h4>
          <span className="text-xs text-slate-400">
            {analytics.hasComparison ? "Comparacion activa" : "Solo un proveedor valido"}
          </span>
        </div>

        {spreadProducts.length > 0 ? (
          <ul className="space-y-2">
            {spreadProducts.map((product) => (
              <li
                key={`${product.item}-${product.name}`}
                className="rounded-lg border border-white/10 bg-slate-950/40 p-3"
              >
                <p className="text-sm font-medium text-slate-100">
                  {product.item}. {product.name}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Menor: {formatClp(product.bestTotal)} · Mayor: {formatClp(product.worstTotal)} · Diferencia:{" "}
                  <span className="font-semibold text-rose-200">{formatClp(product.spread)}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-300">Sin datos suficientes para comparar diferencias.</p>
        )}
      </article>
    </section>
  );
}
