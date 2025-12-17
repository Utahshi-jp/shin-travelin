/*
  Warnings:

  - A unique constraint covering the columns `[itineraryId,dayIndex,scenario]` on the table `ItineraryDay` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DayScenario" AS ENUM ('SUNNY', 'RAINY');

-- DropIndex
DROP INDEX "ItineraryDay_itineraryId_dayIndex_key";

-- AlterTable
ALTER TABLE "ItineraryDay" ADD COLUMN     "scenario" "DayScenario" NOT NULL DEFAULT 'SUNNY';

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryDay_itineraryId_dayIndex_scenario_key" ON "ItineraryDay"("itineraryId", "dayIndex", "scenario");
