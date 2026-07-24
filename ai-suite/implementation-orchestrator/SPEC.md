# Implementation Orchestrator — Implementation Specification

## 1. Objective

Build a standalone Implementation Orchestrator service that accepts an approved planner manifest, compiles it into an executable task graph, dispatches tasks to builder agents, tracks execution state, runs deterministic verification, enforces policies, and produces a complete evidence trail.

The orchestrator must be intentionally simple and deterministic.

It must not:

* invent product features
* reinterpret the approved product direction
* make aesthetic judgements
* act as a conversational agent
* improvise workflow behaviour
* allow builders to approve their own work
* rely on a persistent LLM conversation for workflow state

The orchestrator should answer only:

> Given the current persisted state, available evidence, configured policies, and task dependencies, what deterministic transition is permitted next?

---

# 2. Initial Scope

The first release must support this pipeline:

```text
Approved Build Manifest
        ↓
Manifest Validation
        ↓
Repository Inspection
        ↓
Task Compiler
        ↓
Task Graph Validation
        ↓
Workflow Branch Creation
        ↓
Dependency-Based Task Execution
        ↓
Builder Result Capture
        ↓
Deterministic Verification
        ↓
Accept, Retry, Remediate, or Fail
        ↓
Workflow Completion
```

The first release does not require:

* specialist critic models
* visual quality review
* UX review
* release deployment
* automated pull-request creation
* advanced distributed scheduling
* dynamic model selection
* self-modifying policies

Design interfaces for those future systems without implementing placeholder functionality.

---

# 3. Core Principles

## 3.1 The orchestrator is the source of truth

Only the orchestrator may change workflow and task states.

External services return results or submit events. They do not directly update state.

## 3.2 Builders never approve their own work

A builder result indicating completion means only:

```text
builder_completed
```

It does not mean:

```text
accepted
```

Acceptance requires independent verification.

## 3.3 All state must be persistent

A process restart must not lose:

* workflow state
* task state
* dependencies
* execution attempts
* leases
* builder results
* verification evidence
* errors
* artifact references

## 3.4 All events must be idempotent

Duplicate event delivery must not cause:

* duplicate tasks
* duplicate retries
* repeated state transitions
* double artifact creation
* duplicate builder execution

## 3.5 Policies override model or builder requests

No builder, task compiler, or future critic may bypass configured execution policies.

---

# 4. Recommended Technology Stack

Use the following unless the existing repository already establishes alternatives.

## Backend

* TypeScript
* Node.js 22+
* Fastify
* PostgreSQL
* Prisma ORM
* Redis
* BullMQ
* Zod
* Pino
* OpenAPI

## Repository operations

* native Git command-line integration
* isolated working directories using Git worktrees
* Node child-process wrapper with timeouts and output limits

## Testing

* Vitest
* Fastify inject tests
* Testcontainers
* temporary Git repositories for integration tests
* fixture manifests and repository fixtures

## Monorepo

Use pnpm workspaces.

---

# 5. Repository Structure

```text
implementation-orchestrator/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── routes/
│   │   │   ├── plugins/
│   │   │   └── middleware/
│   │   └── package.json
│   │
│   └── worker/
│       ├── src/
│       │   ├── worker.ts
│       │   ├── processors/
│       │   └── schedulers/
│       └── package.json
│
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       ├── manifest.ts
│   │       ├── workflow.ts
│   │       ├── task.ts
│   │       ├── events.ts
│   │       ├── builder.ts
│   │       ├── verification.ts
│   │       ├── policies.ts
│   │       └── artifacts.ts
│   │
│   ├── database/
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── src/
│   │
│   ├── orchestrator-core/
│   │   └── src/
│   │       ├── state-machine/
│   │       ├── transition-engine.ts
│   │       ├── workflow-service.ts
│   │       ├── task-service.ts
│   │       ├── dependency-service.ts
│   │       ├── lease-service.ts
│   │       ├── retry-service.ts
│   │       ├── event-service.ts
│   │       └── policy-service.ts
│   │
│   ├── task-compiler/
│   │   └── src/
│   │       ├── compiler.ts
│   │       ├── compiler-context.ts
│   │       ├── feature-compiler.ts
│   │       ├── phase-compiler.ts
│   │       ├── verification-compiler.ts
│   │       ├── dependency-builder.ts
│   │       ├── task-splitter.ts
│   │       ├── task-normalizer.ts
│   │       └── validation/
│   │
│   ├── repository-inspector/
│   │   └── src/
│   │       ├── inspector.ts
│   │       ├── git-inspector.ts
│   │       ├── package-inspector.ts
│   │       ├── framework-inspector.ts
│   │       ├── command-detector.ts
│   │       └── repository-profile.ts
│   │
│   ├── builder-gateway/
│   │   └── src/
│   │       ├── adapter.ts
│   │       ├── gateway.ts
│   │       ├── openhands/
│   │       └── mock/
│   │
│   ├── verification-runner/
│   │   └── src/
│   │       ├── runner.ts
│   │       ├── command-runner.ts
│   │       ├── checks/
│   │       ├── result-normalizer.ts
│   │       └── evidence.ts
│   │
│   ├── workspace-manager/
│   │   └── src/
│   │       ├── manager.ts
│   │       ├── worktree.ts
│   │       ├── branch.ts
│   │       └── cleanup.ts
│   │
│   └── observability/
│
├── fixtures/
│   ├── manifests/
│   └── repositories/
│
├── docker-compose.yml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

# 6. Service Boundaries

The orchestrator service owns:

* workflow persistence
* task persistence
* task compilation
* DAG validation
* state transitions
* task readiness
* task leasing
* retries
* builder dispatch
* verification dispatch
* artifact references
* event processing
* policy enforcement
* workflow completion

The builder gateway owns:

* communication with OpenHands or another builder
* session creation
* task execution
* heartbeat forwarding
* cancellation
* result normalization

The verification runner owns:

* command execution
* deterministic checks
* evidence collection
* normalized verification results

The repository inspector owns:

* repository facts
* detected commands
* detected frameworks
* current Git state
* test and build capabilities

---

# 7. Workflow States

```ts
export type WorkflowStatus =
  | "created"
  | "validating_manifest"
  | "inspecting_repository"
  | "compiling_tasks"
  | "validating_task_graph"
  | "preparing_workspace"
  | "running"
  | "verifying"
  | "remediating"
  | "release_gate"
  | "completed"
  | "failed"
  | "cancelled";
```

Valid terminal states:

```text
completed
failed
cancelled
```

A terminal workflow may not transition back into an active state.

---

# 8. Task States

```ts
export type TaskStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "leased"
  | "running"
  | "builder_completed"
  | "verifying"
  | "verification_failed"
  | "remediation_required"
  | "accepted"
  | "retry_scheduled"
  | "failed"
  | "cancelled";
```

## Core transition rules

```text
pending
→ blocked or ready

blocked
→ ready only when all required dependencies are accepted

ready
→ leased

leased
→ running

running
→ builder_completed or retry_scheduled or failed

builder_completed
→ verifying

verifying
→ accepted or verification_failed

verification_failed
→ remediation_required, retry_scheduled, or failed

remediation_required
→ ready after a remediation task or retry attempt is created

retry_scheduled
→ ready after retry delay and policy checks

accepted
→ terminal task state

failed
→ terminal task state

cancelled
→ terminal task state
```

No transition may occur unless validated by the transition engine.

---

# 9. API Endpoints

## Create workflow

```http
POST /v1/workflows
```

Request:

```json
{
  "name": "Parts Library Build",
  "manifest": {},
  "repository": {
    "url": "git@github.com:example/project.git",
    "baseBranch": "main",
    "credentialReference": "github-default"
  },
  "policyProfile": "default-safe",
  "builderProfile": "openhands-local"
}
```

Response:

```json
{
  "workflowId": "wf_123",
  "status": "created"
}
```

## Get workflow

```http
GET /v1/workflows/:workflowId
```

Return:

* status
* current phase
* progress
* task totals by status
* retry totals
* active leases
* latest errors
* timestamps

## List tasks

```http
GET /v1/workflows/:workflowId/tasks
```

Support filters:

```text
status
featureId
phaseId
builderProfile
priority
```

## Get task

```http
GET /v1/workflows/:workflowId/tasks/:taskId
```

Return:

* task contract
* current state
* dependencies
* attempts
* builder results
* verification results
* artifact references
* transition history

## Pause workflow

```http
POST /v1/workflows/:workflowId/pause
```

Optional for the first release. If implemented, pausing must stop new leases but not corrupt active work.

## Resume workflow

```http
POST /v1/workflows/:workflowId/resume
```

## Cancel workflow

```http
POST /v1/workflows/:workflowId/cancel
```

Cancellation must:

* stop new leases
* request cancellation of active builders
* mark non-terminal tasks cancelled
* retain all evidence

## Retry task

```http
POST /v1/workflows/:workflowId/tasks/:taskId/retry
```

This manual endpoint must still enforce retry policies.

## Retrieve workflow artifacts

```http
GET /v1/workflows/:workflowId/artifacts
```

---

# 10. Manifest Ingestion

The orchestrator accepts only manifests that:

* pass the planner's Plan Gate
* use a supported manifest version
* contain a stable manifest ID
* contain essential features
* contain acceptance criteria
* contain implementation phases or enough structure for compilation
* contain traceability information
* contain verification requirements or defaults

Store the original manifest unchanged.

Create a content hash:

```text
SHA-256 of canonicalized manifest JSON
```

The hash must be stored on the workflow.

The orchestrator must reject manifest replacement after execution begins.

A new manifest requires a new workflow or explicit future revision support.

---

# 11. Repository Inspection

Before task compilation, inspect the target repository.

## Required facts

```ts
export interface RepositoryProfile {
  repositoryUrl: string;
  baseBranch: string;
  commitSha: string;
  cleanWorkingTree: boolean;
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: PackageManagerProfile[];
  buildCommands: DetectedCommand[];
  testCommands: DetectedCommand[];
  lintCommands: DetectedCommand[];
  typecheckCommands: DetectedCommand[];
  migrationCommands: DetectedCommand[];
  startCommands: DetectedCommand[];
  directories: DirectorySummary[];
  ciSystems: CiSystemProfile[];
  databaseSystems: string[];
  environmentFiles: string[];
  architectureMarkers: ArchitectureMarker[];
  risks: RepositoryRisk[];
  unknowns: string[];
}
```

## Deterministic inspection sources

Inspect:

* `package.json`
* workspace manifests
* lockfiles
* `composer.json`
* `pyproject.toml`
* `requirements.txt`
* `Cargo.toml`
* `go.mod`
* Docker files
* CI configuration
* test configuration
* lint configuration
* TypeScript configuration
* framework-specific files
* migration directories
* environment templates
* Git status
* Git branch
* current commit

Do not use an LLM for initial repository inspection.

---

# 12. Task Compiler Module

The Task Compiler converts the approved manifest and repository profile into an executable task graph.

It may use an LLM adapter in a future version, but the first version should be deterministic where practical.

The compiler must be a module inside the orchestrator codebase, not a separate deployable service.

## Compiler interface

```ts
export interface TaskCompiler {
  compile(input: TaskCompilerInput): Promise<CompiledTaskGraph>;
}
```

```ts
export interface TaskCompilerInput {
  manifest: BuildManifest;
  repository: RepositoryProfile;
  policy: ExecutionPolicy;
  compilerVersion: string;
}
```

```ts
export interface CompiledTaskGraph {
  graphVersion: string;
  compilerVersion: string;
  tasks: ExecutableTask[];
  dependencies: TaskDependency[];
  phases: ExecutionPhase[];
  coverage: CompilationCoverage;
  warnings: CompilerWarning[];
}
```

---

# 13. Compiler Responsibilities

The compiler must:

1. create tasks from implementation phases
2. create tasks from essential and high-value features
3. map acceptance criteria to tasks
4. map test scenarios to tasks
5. create explicit verification requirements
6. derive dependencies
7. assign task categories
8. assign builder profiles
9. assign execution limits
10. split oversized tasks
11. identify missing task coverage
12. create setup tasks where required
13. create migration tasks where required
14. create integration tasks where features cross module boundaries
15. create final verification tasks where necessary

The compiler must not:

* add product features
* remove essential features
* change creative direction
* change scope classifications
* substitute technologies without explicit rules
* silently ignore unsupported requirements

---

# 14. Executable Task Contract

```ts
export interface ExecutableTask {
  id: string;
  workflowId?: string;
  sourceFeatureIds: string[];
  sourceRequirementIds: string[];
  sourceAcceptanceCriteriaIds: string[];
  sourceTestScenarioIds: string[];
  phaseId: string;
  title: string;
  objective: string;
  category: TaskCategory;
  priority: TaskPriority;
  builderProfile: string;
  scope: TaskScope;
  repositoryContext: TaskRepositoryContext;
  dependencies: string[];
  acceptanceCriteria: TaskAcceptanceCriterion[];
  verification: TaskVerificationPlan;
  execution: TaskExecutionPolicy;
  policyConstraints: string[];
  expectedArtifacts: ExpectedArtifact[];
  tags: string[];
}
```

## Task category

```ts
export type TaskCategory =
  | "repository_setup"
  | "dependency"
  | "database"
  | "backend"
  | "api"
  | "frontend"
  | "integration"
  | "testing"
  | "documentation"
  | "infrastructure"
  | "migration"
  | "verification"
  | "remediation";
```

## Priority

```ts
export type TaskPriority =
  | "blocking"
  | "essential"
  | "high"
  | "normal"
  | "low";
```

## Scope

```ts
export interface TaskScope {
  included: string[];
  excluded: string[];
  likelyFiles: string[];
  allowedDirectories: string[];
  forbiddenDirectories: string[];
}
```

## Execution policy

```ts
export interface TaskExecutionPolicy {
  maxBuilderAttempts: number;
  maxRemediationCycles: number;
  timeoutSeconds: number;
  heartbeatIntervalSeconds: number;
  leaseDurationSeconds: number;
  allowNetworkAccess: boolean;
  allowDependencyChanges: boolean;
  allowSchemaChanges: boolean;
  requireCommit: boolean;
}
```

---

# 15. Task Splitting Rules

The compiler must split tasks that are too broad.

A task should normally represent:

* one coherent implementation outcome
* one independently verifiable change
* a bounded set of modules
* a manageable builder context
* a safe retry unit

## Split when a task contains more than one major concern

Example input:

```text
Implement account management.
```

Possible compiled tasks:

```text
Create account data model
Implement registration API
Implement login API
Implement session handling
Build account settings interface
Add account integration tests
```

## Split thresholds

Make thresholds configurable.

```yaml
taskCompiler:
  maxAcceptanceCriteriaPerTask: 8
  maxFeatureReferencesPerTask: 3
  maxLikelyFilesPerTask: 12
  maxEstimatedComplexity: 8
```

The compiler may issue a warning where deterministic splitting is uncertain.

It must never create a single task named:

```text
Build the complete application
```

---

# 16. Task Dependency Construction

Dependencies should come from:

* manifest feature dependencies
* implementation phase order
* architecture dependencies
* database-before-API rules
* API-before-UI integration rules
* setup-before-build rules
* migration-before-data-use rules
* shared-component dependencies
* explicit planner dependency edges

Example:

```text
repository setup
→ dependency installation
→ schema creation
→ migration
→ API implementation
→ UI implementation
→ integration testing
```

Dependency edges:

```ts
export interface TaskDependency {
  fromTaskId: string;
  toTaskId: string;
  type:
    | "hard"
    | "soft"
    | "verification"
    | "artifact";
  reason: string;
}
```

Only hard dependencies block readiness.

Soft dependencies affect scheduling preference but not task eligibility.

---

# 17. Task Graph Validation

The graph validator must check:

* unique task IDs
* no missing dependency targets
* no self-dependencies
* no hard dependency cycles
* every essential feature has task coverage
* every required acceptance criterion maps to a task
* every required test scenario maps to a task or verification plan
* every task has an execution policy
* every task has verification requirements
* every task belongs to a phase
* no essential task depends on a rejected or deferred-only task
* no task violates global execution policy
* repository setup exists where required
* database changes include migration handling
* destructive tasks are rejected unless policy allows them

Validation output:

```ts
export interface TaskGraphValidationResult {
  valid: boolean;
  errors: GraphFinding[];
  warnings: GraphFinding[];
  coverage: GraphCoverage;
}
```

The workflow may not enter `running` unless graph validation passes.

---

# 18. Compiler Coverage

```ts
export interface CompilationCoverage {
  essentialFeaturesCovered: number;
  highValueFeaturesCovered: number;
  acceptanceCriteriaCovered: number;
  testScenariosCovered: number;
  architectureModulesCovered: number;
  unresolvedItems: CompilerCoverageGap[];
}
```

Default minimums:

```yaml
compilerCoverage:
  essentialFeatures: 1.0
  essentialAcceptanceCriteria: 1.0
  requiredTestScenarios: 1.0
  highValueFeatures: 0.95
```

A value of `1.0` means 100% coverage.

---

# 19. Execution Policies

Policies must be configuration-driven.

```ts
export interface ExecutionPolicy {
  id: string;
  maxConcurrentTasks: number;
  maxConcurrentBuilders: number;
  requireCleanBaseBranch: boolean;
  requireWorkflowBranch: boolean;
  requireTaskCommits: boolean;
  allowParallelTasks: boolean;
  allowDestructiveMigrations: boolean;
  allowDependencyMajorUpgrades: boolean;
  allowPaidExternalServices: boolean;
  allowProductionDeployment: boolean;
  allowForcePush: boolean;
  allowSecretModification: boolean;
  allowedNetworkHosts: string[];
  forbiddenPaths: string[];
  globalRetryBudget: number;
  taskDefaults: TaskExecutionPolicy;
}
```

Default safe policy:

```yaml
id: default-safe

maxConcurrentTasks: 2
maxConcurrentBuilders: 2

requireCleanBaseBranch: true
requireWorkflowBranch: true
requireTaskCommits: true
allowParallelTasks: true

allowDestructiveMigrations: false
allowDependencyMajorUpgrades: false
allowPaidExternalServices: false
allowProductionDeployment: false
allowForcePush: false
allowSecretModification: false

globalRetryBudget: 12
```

---

# 20. Workspace Management

Each workflow must execute in an isolated Git worktree.

Example:

```text
/workspaces/wf_123/
```

Create a workflow branch:

```text
automation/wf_123
```

Task execution may occur:

* sequentially in the workflow worktree
* in isolated task worktrees for parallel tasks

For the first release, prefer sequential execution unless safe parallel merge handling is implemented.

## Workspace rules

* verify base branch exists
* verify expected base commit
* reject dirty source repositories when policy requires cleanliness
* never run builders directly against the user's primary checkout
* capture commit SHA before and after every task
* record changed files
* detect uncommitted changes after task completion
* clean up worktrees only after terminal workflow state and retention period

---

# 21. Builder Gateway

Create a generic adapter.

```ts
export interface BuilderAdapter {
  id: string;

  healthCheck(): Promise<BuilderHealth>;

  createSession(
    request: BuilderSessionRequest
  ): Promise<BuilderSession>;

  executeTask(
    session: BuilderSession,
    task: BuilderTaskRequest
  ): Promise<BuilderExecutionHandle>;

  getStatus(
    handle: BuilderExecutionHandle
  ): Promise<BuilderExecutionStatus>;

  cancel(
    handle: BuilderExecutionHandle
  ): Promise<void>;

  collectResult(
    handle: BuilderExecutionHandle
  ): Promise<BuilderResult>;
}
```

## Initial adapter

Implement:

```text
OpenHands adapter
```

Also implement:

```text
Mock builder adapter
```

The mock adapter is required for deterministic integration tests.

## Builder request

```ts
export interface BuilderTaskRequest {
  workflowId: string;
  task: ExecutableTask;
  workspacePath: string;
  repositoryProfile: RepositoryProfile;
  previousAttempts: BuilderAttemptSummary[];
  remediationInstructions?: RemediationInstruction[];
}
```

## Builder result

```ts
export interface BuilderResult {
  status:
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out";

  summary: string;
  changedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
  commandsRun: BuilderCommandRecord[];
  commitSha?: string;
  patchArtifactId?: string;
  transcriptArtifactId?: string;
  reportedTests: BuilderReportedTest[];
  warnings: string[];
  failure?: BuilderFailure;
}
```

Builder-reported tests are evidence only. Verification must rerun required checks independently.

---

# 22. Leases and Heartbeats

When a task is assigned, create a lease.

```ts
export interface TaskLease {
  id: string;
  taskId: string;
  builderId: string;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  status:
    | "active"
    | "expired"
    | "released"
    | "cancelled";
}
```

Rules:

* only one active lease per task
* a task cannot be leased unless it is `ready`
* an expired lease returns the task to retry evaluation
* late results from an expired lease must not overwrite newer attempts
* heartbeat updates must be idempotent
* leases must use database locking or equivalent transaction safety

---

# 23. Scheduler

The scheduler identifies runnable tasks.

A task is runnable when:

* status is `ready`
* all hard dependencies are `accepted`
* no active lease exists
* workflow status is `running`
* concurrency limit is not exceeded
* policy allows execution
* retry delay has elapsed
* global failure budget is not exceeded

Scheduling order:

1. blocking
2. essential
3. high
4. normal
5. low

Within the same priority:

1. earliest phase
2. highest number of dependents
3. oldest ready timestamp

Keep scheduling deterministic.

---

# 24. Deterministic Verification

After builder completion, run the task's verification plan.

```ts
export interface TaskVerificationPlan {
  checks: VerificationCheckDefinition[];
  requiredArtifactTypes: string[];
  passPolicy: VerificationPassPolicy;
}
```

## Initial check types

```ts
export type VerificationCheckType =
  | "git_cleanliness"
  | "changed_file_scope"
  | "install"
  | "build"
  | "typecheck"
  | "lint"
  | "unit_test"
  | "integration_test"
  | "migration_check"
  | "application_start"
  | "smoke_test"
  | "custom_command";
```

## Check definition

```ts
export interface VerificationCheckDefinition {
  id: string;
  type: VerificationCheckType;
  name: string;
  command?: string;
  workingDirectory?: string;
  timeoutSeconds: number;
  required: boolean;
  continueOnFailure: boolean;
  environmentReferences: string[];
  expectedExitCodes: number[];
}
```

## Verification result

```ts
export interface VerificationResult {
  taskId: string;
  attemptId: string;
  passed: boolean;
  checks: VerificationCheckResult[];
  artifacts: VerificationArtifactReference[];
  startedAt: string;
  completedAt: string;
}
```

A required check failure means the task cannot be accepted.

---

# 25. Verification Command Safety

Commands must come from:

* trusted repository scripts
* approved compiler-generated commands
* policy-approved custom checks

Do not execute arbitrary command strings returned by a builder without validation.

Implement:

* timeout
* maximum output size
* stdout capture
* stderr capture
* exit-code capture
* process-tree termination
* environment allowlist
* secret redaction
* working-directory restrictions

---

# 26. Changed-File Scope Verification

Compare changed files against:

* allowed directories
* forbidden directories
* likely file scope
* policy restrictions

Possible outcomes:

```text
pass
warning
fail
```

Fail when:

* secrets are modified
* forbidden directories are changed
* generated files are changed unexpectedly
* unrelated destructive deletions occur
* files outside the workflow workspace are modified

Do not fail merely because a necessary support file was changed outside the predicted list. Emit a warning unless policy forbids it.

---

# 27. Retry System

## Failure classes

```ts
export type FailureClass =
  | "transient"
  | "builder"
  | "verification"
  | "environment"
  | "manifest"
  | "policy"
  | "internal";
```

## Default handling

### Transient

Examples:

* provider timeout
* temporary network failure
* worker crash
* expired lease

Action:

* retry automatically with exponential backoff

### Builder failure

Examples:

* builder returns failure
* builder produces no patch
* builder exits unexpectedly

Action:

* retry if attempt budget remains
* otherwise fail task

### Verification failure

Examples:

* build fails
* tests fail
* lint fails
* scope verification fails

Action:

* create remediation attempt
* include deterministic failure evidence
* retry builder within remediation budget

### Environment failure

Examples:

* missing credential
* repository unavailable
* required service unavailable

Action:

* retry only if classified as temporary
* otherwise fail workflow with actionable error

### Manifest failure

Examples:

* missing required data
* impossible task graph
* unsupported requirement

Action:

* fail before builder execution

### Policy failure

Examples:

* destructive migration requested
* secret modification attempted
* production deployment attempted

Action:

* fail task or workflow immediately according to policy

---

# 28. Automatic Remediation in First Release

The first release does not require a separate remediation model.

For deterministic verification failures, create a bounded retry instruction.

Example:

```json
{
  "taskId": "TASK-F014-03",
  "attempt": 2,
  "failureClass": "verification",
  "failedChecks": [
    {
      "name": "typecheck",
      "exitCode": 2,
      "summary": "Property 'activeFilters' does not exist on type SearchState."
    }
  ],
  "instruction": "Correct the listed verification failures without expanding task scope. Preserve all passing behaviour and rerun the required checks."
}
```

The builder receives:

* original task
* previous result summary
* failed verification evidence
* exact retry limit
* explicit instruction not to expand scope

Future versions may replace this with a Remediation Service.

---

# 29. Event Model

```ts
export interface WorkflowEvent<TPayload = unknown> {
  id: string;
  type: WorkflowEventType;
  workflowId: string;
  taskId?: string;
  attemptId?: string;
  occurredAt: string;
  source: string;
  payload: TPayload;
}
```

## Event types

```text
workflow.created
workflow.manifest_validated
workflow.repository_inspection_started
workflow.repository_inspection_completed
workflow.task_compilation_started
workflow.task_compilation_completed
workflow.task_graph_validated
workflow.workspace_created
workflow.running
workflow.completed
workflow.failed
workflow.cancelled

task.created
task.blocked
task.ready
task.leased
task.started
task.heartbeat
task.builder_completed
task.builder_failed
task.verification_started
task.verification_completed
task.verification_failed
task.retry_scheduled
task.accepted
task.failed
task.cancelled

lease.acquired
lease.heartbeat
lease.expired
lease.released

artifact.created
policy.violation
```

Store all events in append-only form.

Use an event ID uniqueness constraint for idempotency.

---

# 30. Database Schema

Create at least these entities.

## Workflow

```text
id
name
status
manifestVersion
manifestHash
manifestJson
repositoryConfigJson
repositoryProfileJson
policyProfileId
builderProfileId
baseCommitSha
workflowBranch
workspacePath
compilerVersion
graphVersion
createdAt
startedAt
completedAt
failedAt
cancelledAt
failureCode
failureMessage
```

## Task

```text
id
workflowId
externalTaskId
status
phaseId
title
objective
category
priority
builderProfile
contractJson
readyAt
acceptedAt
failedAt
createdAt
updatedAt
```

## TaskDependency

```text
id
workflowId
fromTaskId
toTaskId
dependencyType
reason
```

## TaskAttempt

```text
id
taskId
attemptNumber
attemptType
status
builderId
startedAt
completedAt
failureClass
failureCode
failureMessage
builderResultJson
```

Attempt types:

```text
initial
retry
remediation
```

## TaskLease

```text
id
taskId
attemptId
builderId
status
acquiredAt
expiresAt
lastHeartbeatAt
releasedAt
```

## VerificationRun

```text
id
taskId
attemptId
status
passed
resultJson
startedAt
completedAt
```

## WorkflowEvent

```text
id
workflowId
taskId
attemptId
eventType
source
payloadJson
occurredAt
createdAt
```

## Artifact

```text
id
workflowId
taskId
attemptId
artifactType
storageProvider
storageKey
contentHash
sizeBytes
metadataJson
createdAt
```

## PolicyViolation

```text
id
workflowId
taskId
ruleId
severity
path
message
evidenceJson
createdAt
```

---

# 31. Artifact Handling

Store large artifacts outside PostgreSQL.

Initial local option:

```text
filesystem storage
```

Recommended development option:

```text
MinIO
```

Artifact types:

* manifest
* repository profile
* compiled task graph
* builder transcript
* builder patch
* command output
* test report
* verification log
* Git diff
* changed-file list
* workflow summary

Store metadata and references in PostgreSQL.

Every artifact must have a content hash.

---

# 32. Concurrency

The first release should default to sequential execution.

```yaml
maxConcurrentTasks: 1
maxConcurrentBuilders: 1
```

The schema and scheduler must support future parallelism.

Parallel execution may only be enabled when:

* tasks have no hard dependency relationship
* tasks use isolated worktrees
* merge handling is implemented
* conflicting file changes are detected
* failed merges have deterministic handling

Do not implement unsafe shared-worktree parallel execution.

---

# 33. Workflow Completion

A workflow completes when:

* every essential task is accepted
* every blocking task is accepted
* no active tasks remain
* no active leases remain
* no required verification is pending
* no terminal policy violation exists
* workflow retry budget is not exceeded

Optional or low-priority tasks may be excluded from the first release only if the manifest and policy explicitly allow it.

Completion output:

```ts
export interface WorkflowCompletionSummary {
  workflowId: string;
  status: "completed";
  manifestHash: string;
  baseCommitSha: string;
  finalCommitSha: string;
  acceptedTasks: number;
  skippedOptionalTasks: number;
  failedOptionalTasks: number;
  verificationSummary: VerificationSummary;
  artifactIds: string[];
  completedAt: string;
}
```

---

# 34. Workflow Failure

A workflow fails when:

* manifest validation fails
* repository inspection finds a blocking condition
* task graph validation fails
* an essential task reaches terminal failure
* global retry budget is exceeded
* workspace setup fails
* a blocking policy violation occurs
* an internal consistency rule is violated

Failure output must include:

* failure code
* failure class
* exact stage
* affected task where applicable
* evidence
* latest successful state
* suggested operator action

---

# 35. Observability

Log:

* workflow ID
* task ID
* attempt ID
* lease ID
* event ID
* transition
* duration
* builder profile
* verification check
* retry count
* failure class
* policy rule

Metrics:

```text
orchestrator_workflows_total
orchestrator_workflows_completed_total
orchestrator_workflows_failed_total
orchestrator_tasks_total
orchestrator_tasks_accepted_total
orchestrator_tasks_failed_total
orchestrator_task_attempts_total
orchestrator_active_leases
orchestrator_expired_leases_total
orchestrator_verification_runs_total
orchestrator_verification_failures_total
orchestrator_policy_violations_total
orchestrator_task_duration_seconds
orchestrator_workflow_duration_seconds
```

Do not log:

* secrets
* access tokens
* private keys
* complete environment values

---

# 36. Configuration

```dotenv
DATABASE_URL=
REDIS_URL=

WORKSPACE_ROOT=/workspaces
ARTIFACT_STORAGE_PROVIDER=filesystem
ARTIFACT_STORAGE_PATH=/artifacts

DEFAULT_POLICY_PROFILE=default-safe
DEFAULT_BUILDER_PROFILE=openhands-local

MAX_CONCURRENT_TASKS=1
MAX_CONCURRENT_BUILDERS=1

DEFAULT_TASK_TIMEOUT_SECONDS=1800
DEFAULT_LEASE_DURATION_SECONDS=2100
DEFAULT_HEARTBEAT_INTERVAL_SECONDS=30

DEFAULT_MAX_BUILDER_ATTEMPTS=3
DEFAULT_MAX_REMEDIATION_CYCLES=3
DEFAULT_GLOBAL_RETRY_BUDGET=12

REQUIRE_CLEAN_BASE_BRANCH=true
REQUIRE_WORKFLOW_BRANCH=true
REQUIRE_TASK_COMMITS=true

ALLOW_DESTRUCTIVE_MIGRATIONS=false
ALLOW_DEPENDENCY_MAJOR_UPGRADES=false
ALLOW_PRODUCTION_DEPLOYMENT=false
ALLOW_FORCE_PUSH=false
ALLOW_SECRET_MODIFICATION=false

LOG_LEVEL=info
STORE_BUILDER_TRANSCRIPTS=true
STORE_COMMAND_OUTPUT=true
```

---

# 37. Build Phases

## Phase 1: Foundation

Implement:

* monorepo
* Fastify API
* PostgreSQL
* Prisma
* Redis
* BullMQ
* workflow persistence
* task persistence
* event persistence
* Zod contracts
* health endpoints

## Phase 2: Manifest and repository handling

Implement:

* manifest ingestion
* manifest hashing
* manifest validation
* repository cloning
* Git inspection
* repository profile generation
* workspace manager
* workflow branch creation

## Phase 3: Task Compiler

Implement:

* compiler interface
* phase compilation
* feature compilation
* acceptance-criteria mapping
* test-scenario mapping
* dependency creation
* task splitting
* verification-plan generation
* compiler coverage
* graph validation

## Phase 4: State machine and scheduler

Implement:

* workflow transition engine
* task transition engine
* dependency readiness
* deterministic scheduler
* retry scheduling
* policy checks
* concurrency control

## Phase 5: Builder Gateway

Implement:

* generic builder adapter
* OpenHands adapter
* mock builder adapter
* leases
* heartbeats
* cancellation
* builder result persistence

## Phase 6: Verification

Implement:

* command runner
* build checks
* type checks
* lint
* unit tests
* integration tests
* changed-file scope checks
* Git cleanliness checks
* result persistence
* verification evidence

## Phase 7: Automatic retry loop

Implement:

* transient retry
* verification remediation attempt
* retry budgets
* terminal task failure
* terminal workflow failure

## Phase 8: Completion and operations

Implement:

* workflow completion summary
* failure summaries
* artifact retrieval
* OpenAPI documentation
* metrics
* Docker Compose
* CI tests

---

# 38. Testing Requirements

## Unit tests

Test:

* every valid and invalid state transition
* dependency readiness
* task priority ordering
* lease expiry
* retry decisions
* policy enforcement
* task splitting
* graph-cycle detection
* manifest coverage
* compiler coverage
* changed-file scope rules
* workflow completion logic

## Integration tests

Test:

1. valid manifest to completed workflow
2. invalid manifest rejection
3. repository inspection failure
4. task graph cycle rejection
5. builder success and verification success
6. builder success but verification failure
7. remediation retry success
8. remediation budget exhausted
9. builder timeout
10. expired lease
11. duplicate event processing
12. worker restart during active workflow
13. cancellation during builder execution
14. forbidden file modification
15. destructive migration policy violation
16. workflow retry budget exceeded
17. optional task failure without essential workflow failure
18. artifact persistence
19. task commit capture
20. stale builder result after lease expiry

Use mock builders for most tests.

Include at least one OpenHands adapter contract test that can be skipped when OpenHands is unavailable.

---

# 39. Acceptance Criteria

The Implementation Orchestrator is complete when:

1. It accepts an approved build manifest.

2. It persists the original manifest and content hash.

3. It inspects the target repository deterministically.

4. It compiles the manifest into bounded executable tasks.

5. It validates task graph integrity and coverage.

6. It refuses to execute an invalid task graph.

7. It creates an isolated workflow workspace and branch.

8. It schedules tasks only when hard dependencies are accepted.

9. It dispatches tasks through the builder adapter.

10. It tracks leases and heartbeats.

11. It handles expired leases safely.

12. It stores builder results and artifacts.

13. It independently reruns required verification checks.

14. It never accepts a task based only on a builder completion claim.

15. It creates bounded retry instructions from verification failures.

16. It enforces per-task and global retry limits.

17. It enforces execution policies.

18. It survives API and worker restarts without losing workflow state.

19. It processes duplicate events idempotently.

20. It produces a final workflow summary with commit and evidence references.

21. It exposes actionable failure details.

22. It includes unit and integration tests for all critical transitions.

23. It contains no stub task compiler, mock-only execution path, or placeholder verification stage in production code.

---

# 40. Definition of Done

The service is done when:

* Docker Compose starts PostgreSQL, Redis, API, worker, and optional MinIO
* database migrations run successfully
* a sample manifest can start a workflow
* a fixture repository can complete through the mock builder
* OpenHands configuration is documented
* the task compiler produces a validated DAG
* workflows survive worker restarts
* task leases expire and recover correctly
* verification failures trigger bounded remediation
* policy violations stop unsafe execution
* all state changes are auditable
* all major APIs are documented through OpenAPI
* CI runs unit and integration tests
* no external service may directly mutate workflow state
* no task can be accepted without verification evidence
* no builder may override policy
* no LLM is required for the workflow kernel to function

---

# 41. Initial Codex Instruction

Implement the Implementation Orchestrator described in this specification.

Start by inspecting the repository and preserving existing conventions where they do not conflict with the specification.

Implement the work in phases.

For each phase:

1. implement production functionality
2. add unit tests
3. add integration tests where relevant
4. run the tests
5. fix failures
6. update documentation
7. ensure the service remains runnable

Do not collapse task compilation, orchestration, builder execution, and verification into one agent loop.

Do not allow OpenHands or any builder to directly change workflow or task state.

Do not treat a builder completion response as task acceptance.

Do not execute arbitrary builder-provided shell commands without verification and policy checks.

Do not implement unsafe parallel execution against a shared worktree.

Do not leave placeholder adapters or mocked verification in the production path.

Prioritise:

1. contracts and persistence
2. deterministic state machines
3. repository inspection
4. Task Compiler
5. graph validation
6. workspace isolation
7. builder gateway
8. leases and retries
9. deterministic verification
10. completion and failure reporting
