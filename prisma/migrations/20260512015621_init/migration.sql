-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "templateFilename" TEXT NOT NULL,
    "originalFileCount" INTEGER NOT NULL,
    "outputExcelPath" TEXT,
    "warningsJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UploadedQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "supplierName" TEXT,
    "quoteNumber" TEXT,
    "quoteDate" DATETIME,
    "rawText" TEXT NOT NULL,
    "parsedJson" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    CONSTRAINT "UploadedQuote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtractedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "sourceItem" TEXT,
    "description" TEXT NOT NULL,
    "normalizedProductKey" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "total" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    CONSTRAINT "ExtractedItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "UploadedQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComparisonItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "matchingWarningsJson" TEXT NOT NULL,
    CONSTRAINT "ComparisonItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comparisonItemId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "total" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    CONSTRAINT "SupplierOffer_comparisonItemId_fkey" FOREIGN KEY ("comparisonItemId") REFERENCES "ComparisonItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
