import { z } from "zod";

export const CurrencySchema = z.enum(["USD", "CLP", "UNKNOWN"]);

export const ExtractedQuoteItemSchema = z.object({
  sourceItem: z.union([z.string(), z.number()]).optional(),
  description: z.string().min(1),
  normalizedProductKey: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1).default("CU"),
  currency: CurrencySchema,
  unitPrice: z.number().nonnegative().nullable(),
  total: z.number().nonnegative().nullable(),
  rawLine: z.string().optional(),
  rawBlock: z.string().optional(),
  lineCategory: z
    .enum([
      "PRODUCTO_COMPARABLE",
      "COSTO_ASOCIADO",
      "SERVICIO",
      "CONDICION_COMERCIAL",
      "GARANTIA",
      "ENVIO_DESPACHO_FLETE",
      "LINEA_INFORMATIVA",
      "LINEA_INVALIDA"
    ])
    .optional(),
  omissionReason: z.string().optional(),
  extractionMethod: z.string().optional(),
  originalTotal: z.number().nonnegative().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const AssociatedCostSchema = z.object({
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: CurrencySchema,
  amountCLP: z.number().nonnegative().optional(),
  isEstimated: z.boolean().optional()
});

export const ParsedQuoteSchema = z.object({
  supplierName: z.string().min(1),
  supplierRut: z.string().optional(),
  extractionSource: z.enum(["n8n", "local"]).optional(),
  currency: CurrencySchema.optional(),
  quoteNumber: z.string().optional(),
  quoteDate: z.string().optional(),
  subtotal: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  quoteSubtotal: z.number().nonnegative().optional(),
  quoteTax: z.number().nonnegative().optional(),
  quoteTotal: z.number().nonnegative().optional(),
  quoteSubtotalCLP: z.number().nonnegative().optional(),
  quoteTaxCLP: z.number().nonnegative().optional(),
  quoteTotalCLP: z.number().nonnegative().optional(),
  offerNetTotalCLP: z.number().nonnegative().optional(),
  offerGrossTotalCLP: z.number().nonnegative().optional(),
  associatedCosts: z.array(AssociatedCostSchema).optional(),
  paymentCondition: z.string().optional(),
  deliveryTime: z.string().optional(),
  pricesIncludeVat: z.boolean().default(false),
  items: z.array(ExtractedQuoteItemSchema),
  warnings: z.array(z.string()).default([])
});

export const SupplierSummarySchema = z.object({
  name: z.string(),
  paymentCondition: z.string().optional(),
  deliveryTime: z.string().optional(),
  credit: z.string().optional(),
  associatedCosts: z.string().optional(),
  offerNetTotalCLP: z.number().nonnegative().nullable().optional(),
  offerGrossTotalCLP: z.number().nonnegative().nullable().optional(),
  totalsSource: z.string().optional(),
  totalsEstimated: z.boolean().optional()
});

export const SupplierOfferSchema = z.object({
  currency: CurrencySchema,
  originalCurrency: CurrencySchema.optional(),
  wasConverted: z.boolean().optional(),
  exchangeRateUsed: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().nullable(),
  total: z.number().nonnegative().nullable(),
  confidence: z.number().min(0).max(1).default(0.5)
});

export const ComparisonItemSchema = z.object({
  item: z.number().int().positive(),
  product: z.string(),
  quantity: z.number(),
  unit: z.string(),
  offers: z.record(SupplierOfferSchema),
  matchingWarnings: z.array(z.string()).default([])
});

export const AppliedExchangeRateSchema = z.object({
  mode: z.enum(["auto", "manual", "fallback", "env"]),
  baseRate: z.number().positive(),
  margin: z.number().nonnegative(),
  finalRate: z.number().positive()
});

export const ConsolidatedComparisonSchema = z.object({
  comparison: z.array(ComparisonItemSchema),
  suppliers: z.array(SupplierSummarySchema),
  warnings: z.array(z.string()).default([]),
  exchangeRate: AppliedExchangeRateSchema.optional()
});

export type Currency = z.infer<typeof CurrencySchema>;
export type AssociatedCost = z.infer<typeof AssociatedCostSchema>;
export type ExtractedQuoteItem = z.infer<typeof ExtractedQuoteItemSchema>;
export type ParsedQuote = z.infer<typeof ParsedQuoteSchema>;
export type SupplierSummary = z.infer<typeof SupplierSummarySchema>;
export type SupplierOffer = z.infer<typeof SupplierOfferSchema>;
export type ComparisonItem = z.infer<typeof ComparisonItemSchema>;
export type ConsolidatedComparison = z.infer<typeof ConsolidatedComparisonSchema>;
export type AppliedExchangeRate = z.infer<typeof AppliedExchangeRateSchema>;
