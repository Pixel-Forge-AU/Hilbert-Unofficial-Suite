-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "completionSummaryJson" JSONB,
ADD COLUMN     "failureDetailsJson" JSONB;
