export const TEMPLATE_MAP = {
  sheetName: "TABLA COMPARATIVA",
  productStartRow: 8,
  productEndRow: 27,
  headerRows: {
    supplierName: 6,
    supplierSubheader: 7
  },
  columns: {
    item: 1,
    product: 2,
    quantity: 3,
    unit: 4
  },
  supplierBlocks: [
    {
      supplierNameCell: "E6",
      unitPriceColumn: 5,
      totalColumn: 6
    },
    {
      supplierNameCell: "G6",
      unitPriceColumn: 7,
      totalColumn: 8
    },
    {
      supplierNameCell: "I6",
      unitPriceColumn: 9,
      totalColumn: 10
    },
    {
      supplierNameCell: "K6",
      unitPriceColumn: 11,
      totalColumn: 12
    },
    {
      supplierNameCell: "M6",
      unitPriceColumn: 13,
      totalColumn: 14
    },
    {
      supplierNameCell: "O6",
      unitPriceColumn: 15,
      totalColumn: 16
    }
  ],
  rows: {
    total: 28,
    purchase: 29,
    credit: 31,
    paymentCondition: 32,
    deliveryTime: 33
  }
} as const;

export type TemplateMap = typeof TEMPLATE_MAP;
