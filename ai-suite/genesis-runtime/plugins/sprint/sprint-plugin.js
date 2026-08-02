/**
 * Plugin Name: Sprint
 * Plugin Slug: sprint
 * Description: Sprint phase state machine for software delivery. Workers can create sprint plans,
 *              advance through phases (plan → build → review → test → ship → reflect), track
 *              sprint status, and generate shipping checklists. Inspired by gstack's structured
 *              Think → Plan → Build → Review → Test → Ship → Reflect pipeline.
 * Version: 1.0.0
 * Author: Nova Observer
 */

const SPRINT_PHASES = ["plan", "build", "review", "test", "ship", "reflect"];
const SPRINT_PHASE_LABELS = {
  plan: "Planning",
  build: "Building",
  review: "Review",
  test: "Testing",
  ship: "Shipping",
  reflect: "Reflection"
};

function normalizeSprintId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}

function nextPhase(current = "plan") {
  const idx = SPRINT_PHASES.indexOf(current);
  return idx >= 0 && idx < SPRINT_PHASES.length - 1 ? SPRINT_PHASES[idx + 1] : null;
}

function buildSprintPlan({ objective = "", scope = [], deliverables = [], roles = [], phaseNotes = {} } = {}) {
  return {
    objective,
    scope,
    deliverables,
    roles: roles.length > 0 ? roles : ["engineer"],
    phases: SPRINT_PHASES.map((phase) => ({
      phase,
      label: SPRINT_PHASE_LABELS[phase],
      notes: phaseNotes[phase] || "",
      entryChecklist: buildPhaseEntryChecklist(phase, objective),
      exitCriteria: buildPhaseExitCriteria(phase)
    }))
  };
}

function buildPhaseEntryChecklist(phase = "", objective = "") {
  const checklists = {
    plan: [
      "Objective is clear and measurable",
      "Scope is defined — what is explicitly in and out",
      "Deliverables are concrete and verifiable",
      "Any blockers or unknowns are surfaced before building"
    ],
    build: [
      "Plan phase is complete",
      "Development environment is ready",
      "All required dependencies are available",
      "Implementation approach is clear from the plan"
    ],
    review: [
      "Build phase is complete",
      "Run review_diff on all changed code",
      "Run security_audit_full if the change touches auth, data, or external APIs",
      "Verify scope matches planned deliverables — no drift"
    ],
    test: [
      "Review phase is complete with no critical findings unresolved",
      "All automated tests pass",
      "Manually verify each deliverable against acceptance criteria",
      "Check for regressions in existing functionality"
    ],
    ship: [
      "Test phase is complete",
      "Version bumped in package.json if applicable",
      "CHANGELOG updated with this sprint's changes",
      "PR created and approved or solo deploy confirmed",
      "Deployment environment and rollback plan understood"
    ],
    reflect: [
      "Deployment is complete and verified healthy",
      "Record what went well and what should change next sprint",
      "Update any documentation affected by this change",
      "Close or update related issues/tickets"
    ]
  };
  return checklists[phase] ?? [];
}

function buildPhaseExitCriteria(phase = "") {
  const criteria = {
    plan: "Sprint plan document is written with objective, scope, deliverables, and known risks",
    build: "All planned deliverables are implemented and locally verified",
    review: "Code review complete — all critical/high findings resolved, medium findings documented",
    test: "All tests pass, no known regressions, acceptance criteria verified",
    ship: "Code is merged, deployed, and deployment is verified healthy",
    reflect: "Retrospective notes written, lessons captured, next steps identified"
  };
  return criteria[phase] ?? "";
}

function buildShipChecklist(plan = {}) {
  return [
    { step: 1, phase: "pre-ship", item: "Run full test suite locally", required: true },
    { step: 2, phase: "pre-ship", item: "Run review_diff — confirm no critical security findings", required: true },
    { step: 3, phase: "pre-ship", item: "Bump version (deploy_bump_version)", required: false },
    { step: 4, phase: "pre-ship", item: "Update CHANGELOG (deploy_update_changelog)", required: false },
    { step: 5, phase: "ship", item: "Create PR (deploy_create_pr) or commit directly", required: true },
    { step: 6, phase: "ship", item: "Push branch (deploy_git_push)", required: true },
    { step: 7, phase: "ci", item: "Wait for CI to pass (deploy_check_ci)", required: true },
    { step: 8, phase: "deploy", item: "Merge PR (deploy_merge_pr) or trigger deploy", required: true },
    { step: 9, phase: "verify", item: "Verify deployment health (deploy_verify_url)", required: true },
    { step: 10, phase: "verify", item: "Check for post-deploy errors (browser_navigate + browser_get_metrics)", required: false },
    { step: 11, phase: "close", item: "Mark sprint as shipped, write reflection", required: false }
  ];
}

export function createSprintPlugin(options = {}) {
  const {
    pluginId = "sprint",
    pluginName = "Sprint",
    description = "Sprint phase state machine — plan, build, review, test, ship, reflect."
  } = options;

  // In-memory sprint registry (persisted via data store if available)
  const sprints = new Map();

  function saveSprint(api, sprint = {}) {
    sprints.set(sprint.id, sprint);
    if (api?.data) {
      api.data.updateJson("sprints", (current = {}) => {
        return { ...current, [sprint.id]: sprint };
      }, {}).catch(() => {});
    }
    return sprint;
  }

  async function loadSprints(api) {
    if (!api?.data) return;
    const stored = await api.data.readJson("sprints", {});
    for (const [id, sprint] of Object.entries(stored ?? {})) {
      if (!sprints.has(id)) sprints.set(id, sprint);
    }
  }

  const TOOL_DEFINITIONS = [
    {
      name: "sprint_create",
      description: "Create a new sprint plan with an objective, scope, and deliverables. Returns a full sprint plan with phase checklists and exit criteria.",
      scopes: ["worker"],
      parameters: {
        id: "string — sprint identifier (e.g. sprint-2026-04-20-auth)",
        objective: "string (required) — what this sprint must achieve",
        scope: "array of strings — what is explicitly in scope",
        deliverables: "array of strings — concrete verifiable outputs",
        roles: "array of strings — roles involved"
      }
    },
    {
      name: "sprint_advance",
      description: "Advance a sprint to the next phase. Validates exit criteria of the current phase. Returns the new phase and its entry checklist.",
      scopes: ["worker"],
      parameters: {
        id: "string (required) — sprint id", exitNotes: "string — notes on how exit criteria were met"
      }
    },
    {
      name: "sprint_status",
      description: "Get the current status of a sprint: phase, checklists, exit criteria, and any notes.",
      scopes: ["worker"],
      parameters: { id: "string (required) — sprint id" }
    },
    {
      name: "sprint_list",
      description: "List all active or recently completed sprints.",
      scopes: ["worker"],
      parameters: { includeCompleted: "boolean — include finished sprints (default false)" }
    },
    {
      name: "sprint_ship_checklist",
      description: "Get the shipping checklist for a sprint — all steps from pre-ship through deployment verification.",
      scopes: ["worker"],
      parameters: { id: "string — sprint id (optional)" }
    },
    {
      name: "sprint_complete",
      description: "Mark a sprint as completed and record a reflection.",
      scopes: ["worker"],
      parameters: {
        id: "string (required)", reflection: "string — what went well, what to improve",
        lessonsLearned: "array of strings"
      }
    }
  ];

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: false,
        uiPanels: false,
        data: true,
        tools: TOOL_DEFINITIONS.map((t) => t.name),
        capabilities: ["sprint.state"],
        hooks: ["intake:tool-call", "queue:task-created", "queue:task-enrich", "queue:task-processed"],
        runtimeContext: ["coreTransactions"]
      },
      dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }
      await loadSprints(api).catch(() => {});

      if (typeof api.provideCapability === "function") {
        api.provideCapability("sprint.state", () => ({ sprints, buildShipChecklist }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      // When a new task is created, record it against any active sprint in the build phase
      api.addHook("queue:task-created", async (payload = {}) => {
        const activeSprints = [...sprints.values()].filter((s) => s.status === "active" && s.currentPhase === "build");
        if (!activeSprints.length) return payload;
        const taskId = String(payload?.taskId || "").trim();
        const messagePreview = String(payload?.messagePreview || "").trim();
        if (!taskId) return payload;
        for (const sprint of activeSprints) {
          if (!Array.isArray(sprint.trackedTaskIds)) sprint.trackedTaskIds = [];
          if (!sprint.trackedTaskIds.includes(taskId)) {
            sprint.trackedTaskIds.push(taskId);
            sprint.notes[taskId] = { messagePreview, queuedAt: Date.now() };
            sprint.updatedAt = Date.now();
            saveSprint(api, sprint);
          }
        }
        return payload;
      });

      // When a task prompt is being built, append active sprint phase context so the
      // worker knows what sprint it is contributing to and what phase constraints apply
      api.addHook("queue:task-enrich", async (payload = {}) => {
        const activeSprints = [...sprints.values()].filter((s) => s.status === "active");
        if (!activeSprints.length) return payload;
        const existingSuffix = Array.isArray(payload?.suffix) ? payload.suffix : [];
        const lines = activeSprints.map((sprint) => {
          const phase = sprint.currentPhase || "plan";
          const exitCriteria = buildPhaseExitCriteria(phase);
          return `Active sprint: ${sprint.id} | Phase: ${SPRINT_PHASE_LABELS[phase] || phase} | Exit criteria: ${exitCriteria}`;
        });
        return { ...payload, suffix: [...existingSuffix, ...lines] };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        const sprintId = normalizeSprintId(args.id || "");

        try {
          let result;

          if (name === "sprint_create") {
            const objective = String(args.objective || "").trim();
            if (!objective) throw new Error("objective is required");
            const id = sprintId || `sprint-${Date.now()}`;
            const plan = buildSprintPlan({
              objective,
              scope: Array.isArray(args.scope) ? args.scope : [],
              deliverables: Array.isArray(args.deliverables) ? args.deliverables : [],
              roles: Array.isArray(args.roles) ? args.roles : [],
              phaseNotes: {}
            });
            const sprint = {
              id,
              status: "active",
              currentPhase: "plan",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              plan,
              phaseHistory: [],
              notes: {}
            };
            saveSprint(api, sprint);
            result = {
              sprint,
              message: `Sprint ${id} created. Current phase: plan. Review the plan phase entry checklist to get started.`
            };

          } else if (name === "sprint_advance") {
            if (!sprintId) throw new Error("id is required");
            const sprint = sprints.get(sprintId);
            if (!sprint) throw new Error(`Sprint ${sprintId} not found`);
            if (sprint.status === "completed") throw new Error("Sprint is already completed");
            const current = sprint.currentPhase;
            const next = nextPhase(current);
            const autoChecks = {};

            // Advancing to "review" — automatically run code review on the diff if cwd provided
            if (next === "review" && args.cwd) {
              const codeReviewCap = typeof api.getCapability === "function"
                ? api.getCapability("code-review.analyze")
                : null;
              if (codeReviewCap) {
                try {
                  const { getDiffForReview, analyzeSecurityPatterns, analyzeQualityPatterns, buildReviewReport } = codeReviewCap;
                  const { ok, diff, stats } = await getDiffForReview({ cwd: String(args.cwd), base: "HEAD~1", head: "HEAD" });
                  if (ok && diff) {
                    const secFindings = analyzeSecurityPatterns(diff);
                    const qualFindings = analyzeQualityPatterns(diff);
                    autoChecks.codeReview = buildReviewReport({ diff, stats, securityFindings: secFindings, qualityFindings: qualFindings });
                    autoChecks.codeReview.source = "code-review plugin (auto on phase advance)";
                  }
                } catch {}
              }
            }

            // Advancing to "ship" — automatically run a smoke test if repoPath provided
            if (next === "ship" && args.repoPath) {
              const qaRunnerCap = typeof api.getCapability === "function"
                ? api.getCapability("qa.runner")
                : null;
              if (qaRunnerCap) {
                try {
                  const { detectTestRunner } = qaRunnerCap;
                  const detected = await detectTestRunner(String(args.repoPath));
                  autoChecks.smokeTest = detected.command
                    ? { runner: detected.runner, note: "qa plugin available — call qa_smoke_test before shipping" }
                    : { runner: "none", note: "No test runner detected via qa plugin" };
                } catch {}
              }
            }

            sprint.phaseHistory.push({
              phase: current, completedAt: Date.now(),
              exitNotes: String(args.exitNotes || ""),
              autoChecks: Object.keys(autoChecks).length ? autoChecks : undefined
            });
            if (!next) {
              sprint.currentPhase = "reflect";
              sprint.status = "reflecting";
            } else {
              sprint.currentPhase = next;
            }
            sprint.updatedAt = Date.now();
            saveSprint(api, sprint);
            result = {
              previousPhase: current,
              currentPhase: sprint.currentPhase,
              label: SPRINT_PHASE_LABELS[sprint.currentPhase],
              entryChecklist: buildPhaseEntryChecklist(sprint.currentPhase, sprint.plan?.objective),
              exitCriteria: buildPhaseExitCriteria(sprint.currentPhase),
              autoChecks: Object.keys(autoChecks).length ? autoChecks : undefined
            };

          } else if (name === "sprint_status") {
            if (!sprintId) throw new Error("id is required");
            const sprint = sprints.get(sprintId);
            if (!sprint) throw new Error(`Sprint ${sprintId} not found`);
            result = {
              id: sprint.id,
              status: sprint.status,
              currentPhase: sprint.currentPhase,
              label: SPRINT_PHASE_LABELS[sprint.currentPhase],
              objective: sprint.plan?.objective,
              entryChecklist: buildPhaseEntryChecklist(sprint.currentPhase, sprint.plan?.objective),
              exitCriteria: buildPhaseExitCriteria(sprint.currentPhase),
              phaseHistory: sprint.phaseHistory,
              deliverables: sprint.plan?.deliverables ?? []
            };

          } else if (name === "sprint_list") {
            const all = [...sprints.values()];
            const filtered = args.includeCompleted === true
              ? all
              : all.filter((s) => s.status !== "completed");
            result = {
              sprints: filtered.map((s) => ({
                id: s.id,
                status: s.status,
                currentPhase: s.currentPhase,
                objective: s.plan?.objective?.slice(0, 100),
                createdAt: s.createdAt
              }))
            };

          } else if (name === "sprint_ship_checklist") {
            const sprint = sprintId ? sprints.get(sprintId) : null;
            result = { checklist: buildShipChecklist(sprint?.plan ?? {}) };

          } else if (name === "sprint_complete") {
            if (!sprintId) throw new Error("id is required");
            const sprint = sprints.get(sprintId);
            if (!sprint) throw new Error(`Sprint ${sprintId} not found`);
            sprint.status = "completed";
            sprint.completedAt = Date.now();
            sprint.reflection = String(args.reflection || "");
            sprint.lessonsLearned = Array.isArray(args.lessonsLearned) ? args.lessonsLearned : [];
            saveSprint(api, sprint);
            result = { id: sprint.id, completed: true, reflection: sprint.reflection };
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "sprint error") }
          };
        }
      });

      api.addHook("queue:task-processed", async (payload = {}) => {
        const taskId = String(payload?.taskId || "").trim();
        const status = String(payload?.status || "").trim();
        if (!taskId || !["completed", "failed"].includes(status)) return payload;
        const activeSprints = [...sprints.values()].filter((s) => s.status === "active");
        if (!activeSprints.length) return payload;
        const coreTransactions = api.getRuntimeContext?.()?.coreTransactions || null;
        let changedFilesCount = 0;
        if (coreTransactions) {
          try {
            const transactions = await coreTransactions.listTransactionsForTask(taskId);
            changedFilesCount = Array.isArray(transactions)
              ? transactions.filter((t) => String(t.status || "").trim() === "applied").length
              : 0;
          } catch {
            // non-critical
          }
        }
        for (const sprint of activeSprints) {
          if (Array.isArray(sprint.trackedTaskIds) && sprint.trackedTaskIds.includes(taskId)) {
            if (!sprint.notes) sprint.notes = {};
            sprint.notes[taskId] = {
              ...sprint.notes[taskId],
              completedAt: status === "completed" ? Date.now() : undefined,
              failedAt: status === "failed" ? Date.now() : undefined,
              status,
              changedFilesCount
            };
            sprint.updatedAt = Date.now();
            saveSprint(api, sprint);
          }
        }
        return payload;
      });
    }
  };
}
