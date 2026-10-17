-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "remediationInstructionJson" JSONB,
ADD COLUMN     "retryEligibleAt" TIMESTAMP(3);
