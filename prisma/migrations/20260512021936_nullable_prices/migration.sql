-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExtractedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "sourceItem" TEXT,
    "description" TEXT NOT NULL,
    "normalizedProductKey" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPrice" REAL,
    "total" REAL,
    "confidence" REAL NOT NULL,
    CONSTRAINT "ExtractedItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "UploadedQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExtractedItem" ("confidence", "currency", "description", "id", "normalizedProductKey", "quantity", "quoteId", "sourceItem", "total", "unit", "unitPrice") SELECT "confidence", "currency", "description", "id", "normalizedProductKey", "quantity", "quoteId", "sourceItem", "total", "unit", "unitPrice" FROM "ExtractedItem";
DROP TABLE "ExtractedItem";
ALTER TABLE "new_ExtractedItem" RENAME TO "ExtractedItem";
CREATE TABLE "new_SupplierOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comparisonItemId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPrice" REAL,
    "total" REAL,
    "confidence" REAL NOT NULL,
    CONSTRAINT "SupplierOffer_comparisonItemId_fkey" FOREIGN KEY ("comparisonItemId") REFERENCES "ComparisonItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SupplierOffer" ("comparisonItemId", "confidence", "currency", "id", "supplierName", "total", "unitPrice") SELECT "comparisonItemId", "confidence", "currency", "id", "supplierName", "total", "unitPrice" FROM "SupplierOffer";
DROP TABLE "SupplierOffer";
ALTER TABLE "new_SupplierOffer" RENAME TO "SupplierOffer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
