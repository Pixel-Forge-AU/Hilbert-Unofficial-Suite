-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('queued', 'running', 'awaiting_revision', 'passed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "StageExecutionStatus" AS ENUM ('pending', 'running', 'completed', 'invalid_output', 'failed', 'superseded');

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "constraintsJson" JSONB NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'queued',
    "preferencesJson" JSONB NOT NULL,
    "contextJson" JSONB NOT NULL,
    "currentStage" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "revisionCycle" INTEGER NOT NULL DEFAULT 0,
    "maxRevisionCycles" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageExecution" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "stageVersion" TEXT NOT NULL,
    "status" "StageExecutionStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL,
    "inputJson" JSONB NOT NULL,
    "rawOutput" TEXT,
    "outputJson" JSONB,
    "summaryJson" JSONB,
    "modelProfile" TEXT,
    "tokenUsageJson" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorJson" JSONB,
    "supersedesExecutionId" TEXT,

    CONSTRAINT "StageExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Critique" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revisionCycle" INTEGER NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "categoryScoresJson" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "outputJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Critique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanInstruction" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "rerunFromStage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanArtifact" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plan_status_idx" ON "Plan"("status");

-- CreateIndex
CREATE INDEX "Plan_updatedAt_idx" ON "Plan"("updatedAt");

-- CreateIndex
CREATE INDEX "StageExecution_planId_stageName_status_idx" ON "StageExecution"("planId", "stageName", "status");

-- CreateIndex
CREATE INDEX "StageExecution_planId_createdAt_idx" ON "StageExecution"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "Critique_planId_revisionCycle_idx" ON "Critique"("planId", "revisionCycle");

-- CreateIndex
CREATE INDEX "PlanArtifact_planId_artifactType_version_idx" ON "PlanArtifact"("planId", "artifactType", "version");

-- AddForeignKey
ALTER TABLE "StageExecution" ADD CONSTRAINT "StageExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageExecution" ADD CONSTRAINT "StageExecution_supersedesExecutionId_fkey" FOREIGN KEY ("supersedesExecutionId") REFERENCES "StageExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Critique" ADD CONSTRAINT "Critique_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanInstruction" ADD CONSTRAINT "PlanInstruction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanArtifact" ADD CONSTRAINT "PlanArtifact_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
