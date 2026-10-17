-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "implementationPublishError" TEXT,
ADD COLUMN     "implementationPublishStatus" TEXT,
ADD COLUMN     "implementationPublishedAt" TIMESTAMP(3),
ADD COLUMN     "implementationTargetJson" JSONB,
ADD COLUMN     "implementationWorkflowId" TEXT;
