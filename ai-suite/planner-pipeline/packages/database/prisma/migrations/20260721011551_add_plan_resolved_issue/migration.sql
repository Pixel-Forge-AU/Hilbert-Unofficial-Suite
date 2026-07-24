-- CreateTable
CREATE TABLE "PlanResolvedIssue" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "requiredChange" TEXT NOT NULL,
    "responsibleStage" TEXT NOT NULL,
    "revisionCycle" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanResolvedIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanResolvedIssue_planId_responsibleStage_createdAt_idx" ON "PlanResolvedIssue"("planId", "responsibleStage", "createdAt");

-- AddForeignKey
ALTER TABLE "PlanResolvedIssue" ADD CONSTRAINT "PlanResolvedIssue_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
