-- Add persistent folio for generated comparison jobs
ALTER TABLE "ProcessingJob" ADD COLUMN "folio" TEXT;

-- Global yearly sequence for folio generation
CREATE TABLE "ComparisonSequence" (
    "year" INTEGER NOT NULL PRIMARY KEY,
    "current" INTEGER NOT NULL
);

-- Ensure folios are unique when present
CREATE UNIQUE INDEX "ProcessingJob_folio_key" ON "ProcessingJob"("folio");
