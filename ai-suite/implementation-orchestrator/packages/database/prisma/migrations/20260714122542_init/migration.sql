-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('created', 'validating_manifest', 'inspecting_repository', 'compiling_tasks', 'validating_task_graph', 'preparing_workspace', 'running', 'verifying', 'remediating', 'release_gate', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'blocked', 'ready', 'leased', 'running', 'builder_completed', 'verifying', 'verification_failed', 'remediation_required', 'accepted', 'retry_scheduled', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskDependencyType" AS ENUM ('hard', 'soft', 'verification', 'artifact');

-- CreateEnum
CREATE TYPE "TaskAttemptType" AS ENUM ('initial', 'retry', 'remediation');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('transient', 'builder', 'verification', 'environment', 'manifest', 'policy', 'internal');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('active', 'expired', 'released', 'cancelled');

-- CreateEnum
CREATE TYPE "PolicyViolationSeverity" AS ENUM ('warning', 'blocking');

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'created',
    "manifestVersion" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "repositoryConfigJson" JSONB NOT NULL,
    "repositoryProfileJson" JSONB,
    "policyProfileId" TEXT NOT NULL,
    "builderProfileId" TEXT NOT NULL,
    "baseCommitSha" TEXT,
    "workflowBranch" TEXT,
    "workspacePath" TEXT,
    "compilerVersion" TEXT,
    "graphVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "externalTaskId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "phaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "builderProfile" TEXT NOT NULL,
    "contractJson" JSONB NOT NULL,
    "readyAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "dependencyType" "TaskDependencyType" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attempts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "attemptType" "TaskAttemptType" NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "builderId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureClass" "FailureClass",
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "builderResultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_leases" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptId" TEXT,
    "builderId" TEXT NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'active',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "task_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "resultJson" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "taskId" TEXT,
    "attemptId" TEXT,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "taskId" TEXT,
    "attemptId" TEXT,
    "artifactType" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_violations" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "taskId" TEXT,
    "ruleId" TEXT NOT NULL,
    "severity" "PolicyViolationSeverity" NOT NULL,
    "path" TEXT,
    "message" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflows_status_idx" ON "workflows"("status");

-- CreateIndex
CREATE INDEX "tasks_workflowId_status_idx" ON "tasks"("workflowId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workflowId_externalTaskId_key" ON "tasks"("workflowId", "externalTaskId");

-- CreateIndex
CREATE INDEX "task_dependencies_workflowId_idx" ON "task_dependencies"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_fromTaskId_toTaskId_dependencyType_key" ON "task_dependencies"("fromTaskId", "toTaskId", "dependencyType");

-- CreateIndex
CREATE INDEX "task_attempts_taskId_idx" ON "task_attempts"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_attempts_taskId_attemptNumber_key" ON "task_attempts"("taskId", "attemptNumber");

-- CreateIndex
CREATE INDEX "task_leases_taskId_status_idx" ON "task_leases"("taskId", "status");

-- CreateIndex
CREATE INDEX "verification_runs_taskId_idx" ON "verification_runs"("taskId");

-- CreateIndex
CREATE INDEX "workflow_events_workflowId_occurredAt_idx" ON "workflow_events"("workflowId", "occurredAt");

-- CreateIndex
CREATE INDEX "workflow_events_workflowId_eventType_idx" ON "workflow_events"("workflowId", "eventType");

-- CreateIndex
CREATE INDEX "artifacts_workflowId_idx" ON "artifacts"("workflowId");

-- CreateIndex
CREATE INDEX "artifacts_taskId_idx" ON "artifacts"("taskId");

-- CreateIndex
CREATE INDEX "policy_violations_workflowId_idx" ON "policy_violations"("workflowId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "task_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "task_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_violations" ADD CONSTRAINT "policy_violations_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_violations" ADD CONSTRAINT "policy_violations_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
