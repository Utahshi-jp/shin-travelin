-- CreateEnum
CREATE TYPE "SpotCategory" AS ENUM ('FOOD', 'SIGHTSEEING', 'MOVE', 'REST', 'STAY', 'SHOPPING', 'OTHER');

-- Add new columns to capture rich spot context; keep them nullable for the backfill step
ALTER TABLE "Activity"
  ADD COLUMN "area" TEXT,
  ADD COLUMN "placeName" TEXT,
  ADD COLUMN "category" "SpotCategory" DEFAULT 'SIGHTSEEING',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "stayMinutes" INTEGER;

-- Backfill newly added columns using the legacy location/content fields
UPDATE "Activity"
SET
  "area" = COALESCE(NULLIF(btrim("location"), ''), 'エリア未設定'),
  "placeName" = NULL,
  "category" = 'SIGHTSEEING',
  "description" = COALESCE(NULLIF(btrim("content"), ''), '内容未設定');

-- Enforce non-null constraints now that the data has been migrated
ALTER TABLE "Activity"
  ALTER COLUMN "area" SET NOT NULL,
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "description" SET NOT NULL;

-- Drop columns that are no longer used
ALTER TABLE "Activity"
  DROP COLUMN "location",
  DROP COLUMN "content",
  DROP COLUMN "url";
