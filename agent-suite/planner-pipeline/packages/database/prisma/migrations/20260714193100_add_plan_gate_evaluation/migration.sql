-- CreateTable
CREATE TABLE "PlanGateEvaluation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revisionCycle" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "noticeCount" INTEGER NOT NULL,
    "outputJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanGateEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanGateEvaluation_planId_revisionCycle_idx" ON "PlanGateEvaluation"("planId", "revisionCycle");

-- AddForeignKey
ALTER TABLE "PlanGateEvaluation" ADD CONSTRAINT "PlanGateEvaluation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
