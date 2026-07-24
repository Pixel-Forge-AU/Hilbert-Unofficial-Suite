# Implementation Orchestrator

A deterministic orchestrator that compiles an approved build manifest into an
executable task graph, dispatches tasks to builder agents, verifies their
work independently, and produces a full evidence trail. See
[`SPEC.md`](./SPEC.md) for the full design.

This repository is being built in the phases described in the spec's
section 37. **All 8 phases are complete.** A workflow now recovers from
transient builder failures and verification failures on its own —
retrying with backoff, remediating with bounded instructions, and only
giving up (task and, if warranted, the whole workflow) once the configured
budgets are actually exhausted (Phase 7) — and now also reaches a genuine
terminal `completed` state with a real summary once every task is done,
can be cancelled on demand, persists artifacts to disk, and exposes
Prometheus metrics and an OpenAPI document (Phase 8, see below).

## What's implemented

### Phase 1 — Foundation

- A pnpm monorepo (`apps/*`, `packages/*`) with TypeScript project references.
- `packages/contracts` — Zod schemas and inferred types for manifests,
  workflows, tasks, events, builder results, verification, policies,
  artifacts, and repository profiles, plus pure workflow/task status
  transition tables and a canonical manifest-hashing utility.
- `packages/database` — the Prisma schema (Postgres) for every entity in
  spec section 30, with migrations.
- `apps/api` — a Fastify service exposing health checks and the workflow/task
  read/create endpoints from spec section 9 that make sense before the
  compiler exists.
- `apps/worker` — a BullMQ worker with a small job-name router.

### Phase 2 — Manifest and repository handling

- `packages/orchestrator-core` additions:
  - `ManifestValidationService` — validates a raw manifest against the Zod
    schema plus semantic rules (supported manifest version, at least one
    essential feature, essential features must carry acceptance criteria,
    phase/feature cross-references must resolve), returning errors vs.
    warnings.
  - `WorkflowService` gained `transitionStatus` (guarded by the pure
    `WORKFLOW_TRANSITIONS` table in `packages/contracts`), `markFailed`, and
    `recordRepositoryProfile`, so workflow state can only move along valid
    edges and every mutation is auditable.
- `packages/workspace-manager` — native `git` CLI wrapper (`runGit`, with
  timeout/output-size limits) plus `WorkspaceManager`: clones a repository
  into an isolated workspace, verifies a clean working tree, checks out the
  base branch, creates the `automation/<workflowId>` branch, and exposes
  `createTaskWorktree`/`removeTaskWorktree` primitives for future parallel
  task execution.
- `packages/repository-inspector` — deterministic, LLM-free repository
  inspection: git facts (commit SHA, branch, clean tree), package manager
  and language detection from lockfiles/manifests, build/test/lint/
  typecheck/migration/start command detection from `package.json` scripts,
  framework detection from dependencies, CI system / monorepo / env-file /
  database-system detection from the filesystem, and a `risks`/`unknowns`
  list (e.g. a dirty tree or a missing test command).
- `apps/worker`'s `workflow.process` job processor
  (`createWorkflowProcessProcessor`) ties it together: validate manifest →
  fail the workflow with `failureClass: "manifest"` on invalid input, or
  advance through `validating_manifest` → `inspecting_repository` (cloning
  and inspecting the repo; a clone failure fails the workflow with
  `failureClass: "environment"`) → `compiling_tasks`. It's idempotent:
  reprocessing a workflow that has already moved past `created` is a no-op.
  On success it enqueues a `workflow.compile` job to hand off to Phase 3.

### Phase 3 — Task Compiler

- `packages/task-compiler` — a deterministic (no LLM) compiler from
  `(BuildManifest, RepositoryProfile, ExecutionPolicy)` to a validated task
  graph:
  - **Setup tasks**: always a `dependency`-category "install dependencies"
    task; a `migration`-category task too, but only when the repository
    profile actually detected migration commands.
  - **Feature tasks**: one task per essential/high-value feature (optional
    features are never compiled, per spec section 13). Category is
    classified from the feature's name/description via keyword heuristics
    (`frontend`, `api`, `database`, `integration`, `testing`,
    `documentation`, `infrastructure`, defaulting to `backend`).
  - **Splitting**: a feature with more than `maxAcceptanceCriteriaPerTask`
    (default 8) acceptance criteria is split into `.partN` tasks chained
    with hard dependencies, and a compiler warning is recorded.
  - **Dependencies**: every feature task hard-depends on the setup task;
    `database`-category tasks hard-depend on the migration task; manifest
    `feature.dependsOn` edges become hard edges between tasks (correctly
    targeting the *last* part of a split feature); tasks in later manifest
    phases get *soft* phase-ordering edges against tasks in earlier phases
    (soft edges affect scheduling preference only, never readiness).
  - **Integration task**: created only when the graph has both a
    `frontend`-category and a `backend`/`api`/`database`-category task,
    hard-depending on all of them.
  - **Final verification task**: always created, hard-depending on every
    other task — the natural terminal node of the DAG.
  - **Verification plans**: built per task from the repository's *actually
    detected* commands (no invented commands) — `git_cleanliness` and
    `changed_file_scope` are always included; `build`/`typecheck`/
    `unit_test` are required if the repository has them; `lint` is included
    but non-blocking; `migration_check` is added for database/migration
    tasks when a migration command was detected.
  - `packages/task-compiler/src/validation/graph-validator.ts` —
    independently re-validates the compiled graph: unique task IDs, no
    missing/self dependency targets, no hard-dependency cycles (DFS over
    hard edges only), every task has a known phase and at least one
    verification check, a dependency-installation task always exists, a
    migration task exists whenever a database-category task exists, and
    the graph's *actual* coverage (recomputed independently, not trusted
    from the compiler's self-report) meets the configured minimums
    (100% essential-feature/acceptance-criteria/test-scenario coverage,
    95% high-value-feature coverage as a warning-only threshold).
- `packages/orchestrator-core` additions: `PolicyService` (resolves a
  `policyProfileId` like `"default-safe"` to the actual `ExecutionPolicy`),
  and `WorkflowService.getForCompilation`/`persistTaskGraph` (bulk-persists
  `Task` and `TaskDependency` rows inside one transaction, translating the
  compiler's string task IDs to internal row IDs; idempotent — skips
  entirely if tasks already exist for the workflow).
- `apps/worker`'s new `workflow.compile` job processor
  (`createWorkflowCompileProcessor`): compiles the graph, validates it, and
  either fails the workflow (`failureClass: "manifest"`, since an invalid
  graph traces back to manifest/coverage problems) or persists the tasks
  and advances the workflow `compiling_tasks` → `validating_task_graph` →
  `preparing_workspace` — as far as the pipeline goes until the scheduler
  (Phase 4) exists to actually run tasks. Every persisted task starts in
  `pending` status; deciding `blocked` vs. `ready` is the scheduler's job.

### Phase 4 — State machine and scheduler

- `packages/orchestrator-core` additions:
  - `TaskService.transitionTask` — the task-side counterpart to
    `WorkflowService.transitionStatus`: validates against the pure
    `TASK_TRANSITIONS` table, stamps `readyAt`/`acceptedAt`/`failedAt`, and
    records the corresponding event. A no-op if already at the target
    status (so redelivered jobs can't double-fire a transition).
  - `DependencyService.computeInitialReadiness` — right after a task graph
    is persisted, flips every `pending` task to `ready` (zero hard
    dependencies) or `blocked` (at least one). `recheckAfterAcceptance` —
    the propagation half: once a task is `accepted`, finds every task that
    hard-depends on it and flips it `blocked` → `ready` once *all* of its
    hard dependencies are accepted (not just this one). Not wired to
    anything yet, since nothing marks a task `accepted` until the
    verification runner (Phase 6) exists — the logic is real and covered
    directly by integration tests against a real database.
  - `LeaseService` — `acquireLease` takes a row lock (`SELECT ... FOR
    UPDATE` inside a transaction) before checking the task is `ready` and
    no active lease already exists, so concurrent scheduler ticks can't
    double-lease the same task; `heartbeat`/`release`/
    `findExpiredActiveLeases`/`markExpired` round out the lease lifecycle
    from spec section 22.
  - `RetryService` (`decideRetry`, `computeBackoffSeconds`) — pure,
    dependency-free functions implementing the attempt-budget and
    global-retry-budget checks from spec section 27, plus exponential
    backoff. Pure by design since there's no builder yet to actually retry
    (Phase 5+); the decision logic is fully unit-tested now so Phase 5-7
    can call it unchanged.
  - `scheduler.ts` — `orderTasksForScheduling` (priority → phase order →
    dependent count → ready-timestamp, per spec section 23) and
    `selectRunnableTasks` (applies concurrency capacity on top). Pure and
    exhaustively unit-tested; the DB-wired part lives in `apps/worker`.
- Database migration: added `Task.phaseOrder` (set at persist time from
  the compiler's `ExecutionPhase.order`) so the scheduler can sort by phase
  without re-deriving phase structure from the manifest at schedule time.
- `apps/worker/src/processors/workflow-prepare.ts` — new `workflow.prepare`
  job: runs `computeInitialReadiness`, transitions the workflow
  `preparing_workspace` → `running`, and enqueues `workflow.schedule`.
- `apps/worker/src/processors/workflow-schedule.ts` — new `workflow.schedule`
  job: loads `ready` tasks and hard-dependent counts, counts currently
  `leased`/`running` tasks against the resolved policy's
  `maxConcurrentTasks`, runs them through the pure scheduler, and calls
  `LeaseService.acquireLease` for each selection (silently skipping a task
  that another concurrent tick already grabbed, rather than failing the
  whole job).
- `apps/worker/src/processors/lease-sweep.ts` — a `lease.sweep` job
  registered as a **repeatable** BullMQ job (`LEASE_SWEEP_INTERVAL_MS`,
  default 30s) at worker startup: finds active leases past `expiresAt`,
  marks them expired, and returns the task to `ready` (if it was `leased`
  but never actually started) or runs it through `RetryService` (if it was
  `running`) to either schedule a retry or fail the task.
- `workflow.compile` now enqueues `workflow.prepare` after reaching
  `preparing_workspace`, closing the loop from manifest submission all the
  way to a leased, runnable task — with no builder to execute it yet.

### Phase 5 — Builder Gateway

- `packages/builder-gateway` implements the `BuilderAdapter` interface from
  spec section 21 (`healthCheck`, `createSession`, `executeTask`,
  `getStatus`, `cancel`, `collectResult`) plus a `BuilderGateway` that
  resolves the right adapter by `builderProfile` string, throwing
  `UnknownBuilderProfileError` for anything unregistered rather than
  silently falling back to something else:
  - `MockBuilderAdapter` — a deterministic, scriptable adapter (per-task
    scripts: `completed`/`failed`/`timed_out`, with an optional simulated
    delay). Registered under the `"mock"` builder profile. This is the
    same adapter the integration test suite uses, and it's real production
    code (spec section 21 requires it), not a test-only hack.
  - `OpenHandsAdapter` — a genuine HTTP client for the
    [OpenHands agent server](https://github.com/OpenHands/OpenHands) REST
    API (`POST /api/conversations` to start a session-scoped conversation
    against the task's actual workspace directory, `POST .../run`,
    `GET .../{id}` for status, `POST .../interrupt` to cancel), built by
    inspecting a live instance's real OpenAPI schema rather than guessed.
    Its `healthCheck()` has been verified against a real running agent
    server. It deliberately reports `changedFiles: []` from
    `collectResult()` — the orchestrator re-derives what actually changed
    from git itself rather than trusting the builder's self-report (spec
    section 3.2). Registered under `"openhands-local"` only when
    `OPENHANDS_BASE_URL`, `OPENHANDS_LLM_MODEL`, and `OPENHANDS_LLM_API_KEY`
    are all configured; otherwise that profile simply isn't registered.
- `LeaseService.heartbeat` now optionally extends `expiresAt`, so a
  long-running task's lease doesn't expire out from under it while the
  builder is still actively working.
- `apps/worker/src/processors/task-dispatch.ts` — the new `task.dispatch`
  job, enqueued by `workflow.schedule` right after a lease is acquired.
  Creates a `TaskAttempt` row, transitions the task `leased` → `running`,
  resolves the adapter for the task's `builderProfile`, starts execution,
  and polls `getStatus` (heartbeating the lease on every poll) until a
  terminal state or the task's own `execution.timeoutSeconds` elapses (at
  which point it cancels the execution and treats it as a timeout). It
  independently captures the git commit SHA before and after execution via
  `workspace-manager`'s `runGit` — stored in `TaskAttempt.builderResultJson`
  alongside the builder's own report, not trusting either report over the
  other. On completion it transitions the task to `builder_completed` and
  releases the lease; on failure or timeout it runs `RetryService.decideRetry`
  (attempt + global retry budgets) to either schedule a retry or fail the
  task, always releasing the lease either way. `builder_completed` is
  explicitly *not* `accepted` — nothing propagates dependency readiness from
  it, since that requires independent verification (Phase 6).

### Phase 6 — Deterministic Verification

- `packages/verification-runner` — runs a task's compiled
  `TaskVerificationPlan` for real, independently of the builder:
  - `command-runner.ts` implements every safety control from spec
    section 25: a hard timeout with genuine **process-tree** termination
    (`taskkill /T /F` on Windows, negative-PID `SIGKILL` on POSIX via a
    detached process group — verified in a test that starts a 5s command
    with a 1s timeout and confirms it's actually killed, not just
    abandoned), output truncation at a byte cap, an environment
    **allowlist** (only a minimal safe base set plus the check's own
    declared `environmentReferences` reach the child process — verified by
    a test that a non-allowlisted var does *not* leak through), secret
    **redaction** (any env var whose *name* looks secret-like has its
    *value* scrubbed from captured stdout/stderr before storage), and a
    working-directory check that rejects any path outside the task's
    workspace.
  - `checks/git-cleanliness.ts` — fails if `git status --porcelain` shows
    anything uncommitted.
  - `checks/changed-file-scope.ts` — diffs the actual working tree against
    the pre-execution commit SHA and classifies every changed file:
    forbidden directories or secret-looking filenames (`.env`, `id_rsa`,
    `*.pem`, `credentials.json`, ...) **fail** the check; files outside the
    task's predicted scope only **warn** (per spec section 26 — a
    necessary support-file edit shouldn't block acceptance); everything
    else passes.
  - `checks/command-check.ts` — runs every other check type (`build`,
    `typecheck`, `lint`, `unit_test`, `migration_check`, ...) through the
    command runner and compares the exit code against
    `expectedExitCodes`.
  - `runner.ts` — runs checks in order, stopping early only when a check
    fails *and* its `continueOnFailure` is false; overall pass/fail is
    computed from `passPolicy` (`all_required` vs. `all_checks`).
  - Commands only ever come from the compiler-generated
    `VerificationCheckDefinition`s (themselves derived from the
    repository's own detected `package.json` scripts) — never from
    anything a builder returns, per spec section 25.
- `apps/worker/src/processors/task-verify.ts` — the new `task.verify` job,
  enqueued by `task.dispatch` right after a task reaches `builder_completed`.
  Transitions the task to `verifying`, runs the plan against the same
  workspace the builder used, persists a `VerificationRun` row (the table
  already existed in the Phase 1 schema), and then:
  - **passes** → transitions to `accepted`, calls
    `DependencyService.recheckAfterAcceptance` to unblock dependents, and
    enqueues another `workflow.schedule` tick so newly-`ready` tasks get
    picked up immediately — this is what makes a whole workflow run itself
    to completion without any manual intervention between tasks.
  - **fails** → transitions to `verification_failed` (recording which
    checks failed and why via `evidence.ts`'s `summarizeFailedChecks`),
    then runs the same `RetryService.decideRetry` budget check used by
    builder failures to land on `remediation_required` (retries remain) or
    `failed` (budget exhausted).

### Phase 7 — Automatic retry loop

- Two new `Task` columns (migration): `retryEligibleAt` (when a
  `retry_scheduled` task's backoff elapses) and
  `remediationInstructionJson` (the bounded instruction waiting for the
  task's next attempt).
- `TaskService.transitionTask` gained an `extraData` parameter so a status
  transition and the fields it implies (e.g. `retryEligibleAt`) commit in
  the same update — no separate write that could get out of sync.
- `WorkflowService.evaluateFailureAfterTaskFailure` — called right after
  *every* terminal task failure (builder exhaustion, verification-budget
  exhaustion, and lease-expiry-during-`running` exhaustion — all three call
  sites), it implements spec section 34's workflow-failure conditions that
  Phase 7 owns: if the failed task is `essential` or `blocking` priority,
  the whole workflow fails immediately (`essential_task_failed`); otherwise
  if the task's failure pushed the workflow's total retry+remediation
  attempt count at or past `globalRetryBudget`, the workflow fails anyway
  (`global_retry_budget_exceeded`) even though the specific task wasn't
  essential. A no-op if the workflow is already terminal, so two tasks
  failing in the same tick can't double-fail it.
- **Transient retries** (builder failure, lease-expiry-during-`running`):
  unchanged in spirit from Phase 5/6, but now actually reactivate. On
  `retry_scheduled`, `retryEligibleAt` is set to `now + backoffSeconds`. The
  new `retry.sweep` job — a **repeatable** BullMQ job
  (`RETRY_SWEEP_INTERVAL_MS`, default 15s) — finds tasks whose backoff has
  elapsed, flips them back to `ready`, and enqueues `workflow.schedule` for
  every distinct workflow touched.
- **Verification remediation** (spec section 28): on a verification failure
  with remediation budget remaining, `task-verify.ts` now builds an actual
  `RemediationInstruction` (task ID, attempt number, the specific failed
  checks with their exit codes and summaries, and a fixed instruction not
  to expand scope), transitions `verification_failed` → `remediation_required`
  → **immediately** `ready` (no backoff — per spec section 8, remediation
  reactivates as soon as the instruction exists) with the instruction
  attached, and enqueues `workflow.schedule` right away. `task-dispatch.ts`
  reads and clears that instruction on the next attempt, forwards it as
  `BuilderTaskRequest.remediationInstructions`, and records the attempt as
  `attemptType: "remediation"` rather than `"retry"` — so remediation
  cycles are budgeted separately via `maxRemediationCycles`, not
  `maxBuilderAttempts` (a real distinction in spec section 14 that Phase 6
  had incorrectly conflated; fixed as part of this phase).
- Both budget checks (`maxBuilderAttempts` for builder failures,
  `maxRemediationCycles` for verification failures) now correctly count
  only same-kind prior attempts for the *task's own* budget, while the
  *workflow's* `globalRetryBudget` check still counts every retry and
  remediation attempt across the whole workflow, matching spec section 27.

### Phase 8 — Completion and Operations

- **Workflow completion.** `WorkflowService.evaluateCompletionAfterTaskAcceptance`
  is called after every terminal task outcome (acceptance, failure, or
  cancellation) from all three sites that can produce one
  (`task-verify.ts`, `task-dispatch.ts`, `lease-sweep.ts`). It's safe by
  construction: it only ever runs *after* `evaluateFailureAfterTaskFailure`
  has already had the chance to fail the workflow, so by the time it checks
  "are all tasks terminal with no active leases", an essential/blocking
  failure has already short-circuited the workflow to `failed`. When every
  task really is terminal, it independently re-derives the final commit SHA
  from git (not from a builder self-report), assembles a real
  `WorkflowCompletionSummary` (accepted/skipped/failed-optional task
  counts, base/final commit SHAs), persists it to
  `Workflow.completionSummaryJson`, transitions the workflow to
  `completed`, and records a `workflow.completed` event. A workflow with
  everything green no longer sits at `running` forever.
- **Cancellation.** `POST /v1/workflows/:workflowId/cancel` and
  `WorkflowService.cancel`: transitions the workflow to `cancelled`,
  cancels every task that isn't already terminal *and isn't currently
  `running`*, and marks any still-active leases `cancelled`. Deliberately
  does **not** touch `running` tasks directly — that would race the
  dispatch job that owns that task's lease and lifecycle. Instead,
  `task-dispatch.ts`'s poll loop checks the workflow's status on every
  iteration (alongside its existing heartbeat) and cooperatively cancels
  its own execution — calling `adapter.cancel()`, independently capturing
  the post-cancel commit SHA, and transitioning the task to `cancelled`
  itself — the moment it notices. No two writers ever touch the same
  running task.
- **Artifacts.** `packages/orchestrator-core`'s new `ArtifactService`
  writes content-addressed JSON (SHA-256, first 16 hex chars in the
  filename) to `ARTIFACT_STORAGE_PATH` on the local filesystem and records
  an `Artifact` row (the table already existed in the Phase 1 schema).
  `GET /v1/workflows/:workflowId/artifacts` lists them. Every terminal
  workflow outcome (`completed` or `failed`) stores a `workflow_summary`
  artifact — this is currently the only artifact type actually produced;
  builder transcripts, command output, and git diffs are captured inline
  in `TaskAttempt.builderResultJson`/`VerificationRun.resultJson` rather
  than as separate artifacts (a simplification, not a gap — see below).
  MinIO/S3 backends are not implemented; only `storageProvider:
  "filesystem"` exists, matching spec section 31's "initial local option."
- **Metrics.** `packages/observability` is a new framework-agnostic
  package: a single `prom-client` `Registry` with every counter/gauge/
  histogram named in spec section 35 (`orchestrator_workflows_total`,
  `..._tasks_accepted_total`, `..._task_attempts_total` labeled by
  `attempt_type`, `..._active_leases` as a gauge, `..._task_duration_seconds`
  and `..._workflow_duration_seconds` as histograms, etc.). Metrics are
  incremented at the call sites in `apps/api`'s routes and
  `apps/worker`'s job processors, not inside `orchestrator-core` — keeping
  that package free of any observability-framework dependency.
  `apps/api` exposes `GET /metrics`; `apps/worker` (which has no HTTP
  framework otherwise) gets a minimal `node:http` server on
  `METRICS_PORT` (default `9465`) exposing only `/metrics`. **Each process
  has its own in-memory registry** — a workflow's creation counter shows
  up on the API's `/metrics`, while its completion/task/verification
  counters show up on the worker's, matching how every other multi-process
  Prometheus deployment works (a scrape config points at both targets;
  nothing here aggregates them into one number).
- **OpenAPI.** `GET /openapi.json` serves a hand-authored OpenAPI 3.0
  document (`apps/api/src/openapi-document.ts`) describing every route
  actually implemented — health, metrics, and the full `/v1/workflows`
  surface including the new cancel/artifacts endpoints. It's kept honest
  by construction (written directly against the route table, not
  generated from guesses), but it is not wired to any runtime request
  validation — Zod schemas in `packages/contracts` remain the actual
  source of truth for request/response shapes.
- **CI.** `.github/workflows/ci.yml` runs on every push/PR: install
  (frozen lockfile), build, typecheck, and the full test suite (including
  the Testcontainers-backed integration tests — `ubuntu-latest` ships
  Docker, so no extra setup is needed).
- A few things named in the spec were deliberately left out of this
  increment rather than faked — see "What's deliberately not here yet"
  below.

## Running it

```bash
pnpm install
cp .env.example .env         # adjust ports/credentials if needed
docker compose up -d postgres redis
pnpm --filter @implementation-orchestrator/database run migrate
pnpm dev:api      # in one terminal
pnpm dev:worker   # in another
```

`docker compose up` (all services) will also build and run the API and
worker in containers. Note that `workflow.process` actually clones
`repository.url` with the system `git` — for a real remote you need working
credentials (SSH key / token) available to the worker process; for local
testing, point `repository.url` at a path to a local repository.

Set `builderProfile: "mock"` when creating a workflow to exercise the full
pipeline without any external dependency — the mock adapter always
"succeeds" instantly unless you configure it otherwise in code. To use a
real OpenHands agent server instead, set `builderProfile: "openhands-local"`
and configure `OPENHANDS_BASE_URL`, `OPENHANDS_LLM_MODEL`, and
`OPENHANDS_LLM_API_KEY` (see `.env.example`) — the worker only registers
that adapter when all three are present.

`apps/api` exposes `GET /metrics` (Prometheus) and `GET /openapi.json` on
its own port. `apps/worker` exposes its own `GET /metrics` on
`METRICS_PORT` (default `9465`) — the two processes track different
counters (see Phase 8 above), so point a Prometheus scrape config at both.

## Testing

```bash
pnpm build       # tsc -b across all packages, in dependency order
pnpm typecheck
pnpm test        # vitest: unit tests + Testcontainers-backed integration tests
```

148 tests across 30 files (1 test is skipped unless `OPENHANDS_BASE_URL`
is configured), including:

- `apps/api/src/app.integration.test.ts` — Testcontainers Postgres, real
  Prisma migrations, `fastify.inject` against the real API (no mocked
  database), plus direct `EventService` idempotency checks. Now also
  covers `GET /metrics` (real Prometheus exposition text),
  `GET /openapi.json`, `POST /v1/workflows/:id/cancel` (both the
  success path and 404-on-unknown-workflow), and
  `GET /v1/workflows/:id/artifacts`.
- `packages/workspace-manager/src/manager.test.ts` — real `git` operations
  against a locally created fixture repository (clone, branch, worktree,
  cleanup, and a real failure when the base branch doesn't exist).
- `packages/repository-inspector/src/inspector.test.ts` — a real fixture
  repo, asserting the assembled `RepositoryProfile` and its risk detection.
- `packages/task-compiler/src/compiler.test.ts` and
  `validation/graph-validator.test.ts` — category classification, task
  splitting, dependency derivation (including the split-feature-target
  fix), integration-task gating, coverage computation, and every graph
  validator failure code, driven directly against hand-built fixtures.
- `packages/orchestrator-core/src/scheduler.test.ts` and
  `retry-service.test.ts` — pure unit tests for scheduling order,
  concurrency-capacity selection, exponential backoff, and both retry-budget
  decision branches.
- `packages/orchestrator-core/src/scheduling.integration.test.ts` — task
  transitions (valid, invalid, idempotent no-op), initial readiness
  computation, post-acceptance dependency propagation, and the full lease
  lifecycle (acquire with row-locking, double-lease rejection, heartbeat,
  release, expiry detection) against a real database.
- `apps/worker/src/processors/workflow-process.integration.test.ts`,
  `workflow-compile.integration.test.ts`, `workflow-schedule.integration.test.ts`,
  and `task-dispatch.integration.test.ts` — the full pipeline against
  Testcontainers Postgres and a real git fixture, from workflow creation
  all the way through a `builder_completed` task, plus idempotent
  reprocessing and every failure path — including a real retry-scheduling
  decision, retry-budget exhaustion, and a genuine execution timeout
  (short `timeoutSeconds`, scripted mock delay, real cancel + failure).
- `packages/builder-gateway/src/mock/mock-adapter.test.ts` and
  `gateway.test.ts` — the mock adapter's full lifecycle (completed, scripted
  failure, cancellation, delayed completion, unknown-handle errors) and
  profile resolution/rejection.
- `packages/builder-gateway/src/openhands/openhands-adapter.contract.test.ts`
  — a live contract test, skipped via `describe.skipIf` when
  `OPENHANDS_BASE_URL` isn't set (spec section 38). Manually verified
  against a real running OpenHands agent server during development.
- `packages/verification-runner/src/command-runner.test.ts` — genuine
  process-tree kill-on-timeout, environment allowlisting (both directions:
  a var *not* on the list doesn't leak in, one *on* the list does), and
  secret redaction.
- `packages/verification-runner/src/checks/*.test.ts` and `runner.test.ts`
  — git-cleanliness and changed-file-scope checks (pass/warning/fail for
  in-scope, out-of-scope, forbidden, and secret-looking file changes)
  against real fixture repos, plus the runner's early-stop-vs-continue and
  `all_required`-vs-`all_checks` pass-policy logic.
- `apps/worker/src/processors/task-verify.integration.test.ts` — the full
  pipeline from workflow creation through a task reaching `accepted` with
  real verification checks actually executing and passing, confirming
  `DependencyService.recheckAfterAcceptance` correctly flips a dependent
  task `blocked` → `ready`, plus a verification failure that reactivates
  through `remediation_required` straight to `ready` with a real
  `RemediationInstruction` attached, and the budget-exhausted `failed`
  outcome.
- `packages/orchestrator-core/src/scheduling.integration.test.ts`'s new
  `evaluateFailureAfterTaskFailure` suite — an essential-priority task
  failure fails the workflow immediately; a low-priority task failure
  within budget leaves the workflow `running`; a low-priority task failure
  that pushes the *workflow's* total retry count over budget fails the
  workflow anyway; and it's a no-op once the workflow is already terminal.
- `apps/worker/src/processors/retry-sweep.integration.test.ts` — reactivates
  a task whose `retryEligibleAt` has passed, leaves one whose backoff
  hasn't elapsed alone, ignores a task not in `retry_scheduled` even with
  an eligible timestamp, and enqueues `workflow.schedule` exactly once per
  distinct workflow even when multiple tasks became eligible in the same
  sweep.
- `task-dispatch.integration.test.ts` also now asserts `retryEligibleAt` is
  actually set on `retry_scheduled` and that an essential task's exhausted
  failure correctly cascades to `workflow.status === "failed"` with
  `failureCode: "essential_task_failed"`.
- `packages/orchestrator-core/src/scheduling.integration.test.ts`'s new
  `evaluateCompletionAfterTaskAcceptance` suite — returns `null` (workflow
  stays `running`) while a task is non-terminal or an active lease
  remains, returns `null` for a workflow with zero tasks, marks the
  workflow `completed` with a correct `acceptedTasks`/`failedOptionalTasks`
  summary once every task is terminal with no active leases, and is a
  no-op once the workflow is already terminal.
- The same file's new `WorkflowService.cancel` suite — cancels every
  non-terminal, non-`running` task and transitions the workflow to
  `cancelled`; leaves a genuinely `running` task alone (so the dispatcher
  can cooperatively cancel it); marks active leases `cancelled` with a
  `releasedAt` timestamp; and is a no-op (doesn't touch a freshly-added
  task) once the workflow is already terminal.
- `packages/orchestrator-core/src/artifact-service.integration.test.ts` —
  `ArtifactService.storeJson` against a real temp directory and
  Testcontainers Postgres: writes content-addressed JSON that round-trips
  byte-for-byte, produces an identical hash/storage key for identical
  data, and correctly associates an artifact with a task and attempt when
  provided.
- `packages/observability/src/metrics.test.ts` — the Prometheus registry
  actually renders incremented counters (including per-label counts for
  `orchestrator_task_attempts_total`) and gauge values in its exposition
  output, and exposes the correct `text/plain` content type.

Every integration test uses a locally created git repository as the
"remote" (no network access or credentials needed) and a real ephemeral
Postgres — no mocked persistence anywhere in the suite.

Beyond the automated suite, all eight phases have been smoke-tested by
actually starting `apps/api` and `apps/worker` against real
(non-Testcontainers) Postgres/Redis containers and creating workflows over
HTTP. The Phase 7 smoke test is the most telling: a fixture repo whose
`test` script always fails produced a workflow where the setup task cycled
through verification failure → remediation → re-dispatch → re-verify
**four** times (initial attempt + all 3 remediation cycles, each firing
within a second, no manual intervention) before correctly giving up —
landing the task at `failed` and, because that task was `blocking`
priority, cascading to the whole workflow at `failed` with
`failureCode: "essential_task_failed"` and `retryCount: 3`, all visible
live via `GET /v1/workflows/:id`. A separate check confirmed
`OpenHandsAdapter.healthCheck()` genuinely connects to and correctly
parses the response from a real, independently-running OpenHands agent
server.

The Phase 8 smoke test exercised the same live API/worker pair with the
`mock` builder profile end to end: a workflow with an invalid manifest
correctly failed at `validating_manifest` with `failureCode:
"manifest_invalid"` and a populated `failureDetails`; a workflow pointed
at a nonexistent repository correctly failed at `inspecting_repository`
with `failureCode: "repository_unavailable"`; and a valid workflow ran to
genuine completion — all 3 compiled tasks reached `accepted`, the
workflow transitioned to `completed`, `GET /v1/workflows/:id` returned a
real `completionSummary` with matching base/final commit SHAs, a
`workflow_summary` artifact was written to disk under
`ARTIFACT_STORAGE_PATH` and listed via `GET /v1/workflows/:id/artifacts`,
and calling `POST /v1/workflows/:id/cancel` on the now-terminal workflow
correctly no-op'd. `GET /openapi.json` served the full route document,
and both processes' `GET /metrics` (the API's own port and the worker's
`METRICS_PORT`) showed the expected counters incremented on the process
that actually owns them — `orchestrator_workflows_total` on the API (it's
incremented at creation time in the route handler) and
`orchestrator_workflows_completed_total`/`orchestrator_tasks_total`/
`orchestrator_tasks_accepted_total`/`orchestrator_task_attempts_total`/
`orchestrator_verification_runs_total` on the worker (they're all
incremented from job processors).

## What's deliberately not here yet

Per the spec's phase plan, the following are out of scope for this
build and are simplifications rather than gaps that block later work:

- The manual `POST /v1/workflows/:workflowId/tasks/:taskId/retry`
  endpoint from spec section 9 — every retry/remediation cycle that
  exists today is automatic (Phase 7); there's no operator-triggered
  manual retry of a task that's already given up.
- Artifact storage beyond `workflow_summary` — builder transcripts,
  command output, and git diffs are still captured inline in
  `TaskAttempt.builderResultJson`/`VerificationRun.resultJson` rather than
  as separate content-addressed artifacts, and only the `filesystem`
  storage provider exists (no MinIO/S3 backend).
- No policy-level enforcement beyond concurrency and the two retry budgets
  yet — `ExecutionPolicy` fields like `allowDestructiveMigrations`,
  `allowSecretModification`, `allowedNetworkHosts`, and `forbiddenPaths`
  are defined and threaded through tasks, but nothing actively blocks a
  task for violating them or writes a `PolicyViolation` row (section 19's
  "policy checks" beyond the retry budget), so
  `orchestrator_policy_violations_total` is defined but always zero.
- The OpenHands adapter has not been exercised end-to-end (creating a real
  conversation and letting an LLM act) in automated tests — that would
  require real LLM credentials and a live agent server, and would be slow
  and non-deterministic. Only `healthCheck()` is verified live; the rest is
  implemented against the agent server's real, inspected OpenAPI schema.

`ExecutionPolicy`'s non-`default-safe` profiles, per-category builder
profile selection (all tasks currently use the workflow's single
`defaultBuilderProfile`), and `architectureModulesCovered` coverage (no
signal for it exists in the current manifest model) are simplifications
worth revisiting rather than gaps that block later phases.
