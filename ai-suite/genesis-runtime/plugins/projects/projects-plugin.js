/**
 * Plugin Name: Projects
 * Plugin Slug: projects
 * Description: Moves project configuration routes and Projects top-level tab into a plugin.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createProjectsRuntime } from "./lib/projects-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function requireRuntimeFn(runtime = {}, name = "") {
  const fn = runtime?.[name];
  return typeof fn === "function" ? fn : null;
}

function compactHookText(value = "", maxLength = 220) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

export function createProjectsPlugin(options = {}) {
  const {
    pluginId = "projects",
    pluginName = "Projects",
    description = "Projects configuration routes and dashboard tab."
  } = options;
  let rawProjectRuntime = null;
  let projectRuntime = null;
  const getRawProjectRuntime = (api) => {
    if (!rawProjectRuntime) {
      rawProjectRuntime = createProjectsRuntime(api.getRuntimeContext());
    }
    return rawProjectRuntime;
  };
  const getProjectRuntime = (api) => {
    if (!projectRuntime) {
      const runtime = getRawProjectRuntime(api);
      projectRuntime = {
        ...runtime,
        buildProjectPipelineCollection: (...args) => {
          void api.runHook?.("subsystem:pipeline:collection-build-started", {
            at: Date.now(),
            taskCount: Array.isArray(args?.[0]) ? args[0].length : 0
          });
          try {
            const collection = requireRuntimeFn(runtime, "buildProjectPipelineCollection")?.(...args);
            void api.runHook?.("subsystem:pipeline:collection-build-completed", {
              at: Date.now(),
              pipelineCount: collection && typeof collection === "object"
                ? Object.keys(collection).length
                : 0
            });
            return collection;
          } catch (error) {
            void api.runHook?.("subsystem:pipeline:collection-build-failed", {
              at: Date.now(),
              error: compactHookText(String(error?.message || error || "unknown error"), 220)
            });
            throw error;
          }
        },
        listProjectPipelines: (...args) => {
          void api.runHook?.("subsystem:projects:pipelines-list-started", {
            at: Date.now(),
            limit: Number(args?.[0]?.limit || 0) || 0
          });
          return Promise.resolve(requireRuntimeFn(runtime, "listProjectPipelines")?.(...args))
            .then((pipelines) => {
              void api.runHook?.("subsystem:projects:pipelines-list-completed", {
                at: Date.now(),
                pipelineCount: Array.isArray(pipelines) ? pipelines.length : 0
              });
              return pipelines;
            })
            .catch((error) => {
              void api.runHook?.("subsystem:projects:pipelines-list-failed", {
                at: Date.now(),
                error: compactHookText(String(error?.message || error || "unknown error"), 220)
              });
              throw error;
            });
        },
        getProjectPipelineTrace: (...args) => {
          void api.runHook?.("subsystem:projects:pipeline-trace-started", {
            at: Date.now(),
            taskId: compactHookText(String(args?.[0]?.taskId || "").trim(), 80),
            projectWorkKey: compactHookText(String(args?.[0]?.projectWorkKey || "").trim(), 120)
          });
          return Promise.resolve(requireRuntimeFn(runtime, "getProjectPipelineTrace")?.(...args))
            .then((pipeline) => {
              void api.runHook?.("subsystem:projects:pipeline-trace-completed", {
                at: Date.now(),
                found: Boolean(pipeline),
                projectWorkKey: compactHookText(String(pipeline?.projectWorkKey || args?.[0]?.projectWorkKey || "").trim(), 120),
                projectName: compactHookText(String(pipeline?.projectName || "").trim(), 120)
              });
              return pipeline;
            })
            .catch((error) => {
              void api.runHook?.("subsystem:projects:pipeline-trace-failed", {
                at: Date.now(),
                error: compactHookText(String(error?.message || error || "unknown error"), 220)
              });
              throw error;
            });
        }
      };
      if (typeof api.provideCapability === "function") {
        api.provideCapability("projects.runtime", () => projectRuntime, { priority: 10 });
        api.provideCapability("subsystem:classify", (payload = {}) => {
          const pathname = String(payload?.path || "").trim().toLowerCase();
          const existing = Array.isArray(payload?.subsystems)
            ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
            : [];
          const next = new Set(existing);
          if (pathname.startsWith("/api/projects/") || pathname.startsWith("/api/plugin-ui/projects/")) {
            next.add("projects");
            next.add("pipeline");
          }
          return [...next];
        });
      }
    }
    return projectRuntime;
  };

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: false,
        tools: [
          "get_project_status",
          "get_project_pipeline",
          "list_project_fragments",
          "get_project_fragment",
          "save_project_fragment",
          "get_project_fragment_context"
        ],
        capabilities: [
          "subsystem:classify",
          "projects.runtime"
        ],
        hooks: [
          "cron:definitions:list",
          "intake:tool-call",
          "intake:tools:list",
          "queue:task-processed",
          "runtime:startup",
          "runtime:tick:5m"
        ],
        runtimeContext: ["*"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      getProjectRuntime(api);
      const OPPORTUNITY_SCAN_SERIES_ID = "internal-opportunity-scan";
      const OPPORTUNITY_SCAN_ENSURE_INTERVAL_MS = 15 * 60 * 1000;
      let lastEnsureOpportunityScanAt = 0;
      const buildOpportunityScanDefinition = () => {
        const runtime = getRawProjectRuntime(api);
        const getProjectConfig = requireRuntimeFn(runtime, "getProjectConfig");
        const everyMs = Math.max(
          1000,
          Number(getProjectConfig?.()?.opportunityScanIntervalMs || 0) || 60_000
        );
        return {
          id: OPPORTUNITY_SCAN_SERIES_ID,
          name: "Idle workspace opportunity scan",
          message: "Idle workspace opportunity scan",
          everyMs
        };
      };
      const ensureOpportunityScanScheduledTask = async ({ force = false } = {}) => {
        if (api.isEnabled?.() !== true) {
          return;
        }
        const now = Date.now();
        if (!force && now - Number(lastEnsureOpportunityScanAt || 0) < OPPORTUNITY_SCAN_ENSURE_INTERVAL_MS) {
          return;
        }
        const ensureOpportunityScanJob = requireRuntimeFn(api.getRuntimeContext(), "ensureOpportunityScanJob");
        if (!ensureOpportunityScanJob) {
          return;
        }
        await ensureOpportunityScanJob();
        lastEnsureOpportunityScanAt = now;
      };
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "projects",
          title: "Projects",
          icon: "P",
          order: 12,
          scriptUrl: "/api/plugin-ui/projects/tab.js"
        });
      }
      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "get_project_status", description: "Get a summary of active workspace projects, or a named project's phase, TODOs, roles, and pipeline status.", scopes: ["intake"], risk: "normal", parameters: { limit: "number", projectName: "string" } });
        api.registerTool({ name: "get_project_pipeline", description: "Get the full task pipeline trace for a specific project by name or work key.", scopes: ["intake"], risk: "normal", parameters: { projectWorkKey: "string", taskId: "string" } });
        api.registerTool({ name: "list_project_fragments", description: "List typed writing fragments for a workspace project, optionally filtered by type or search query.", scopes: ["intake"], risk: "normal", parameters: { projectName: "string", type: "string", query: "string", limit: "number" } });
        api.registerTool({ name: "get_project_fragment", description: "Read the full content and metadata for one project writing fragment.", scopes: ["intake"], risk: "normal", parameters: { projectName: "string", fragmentId: "string" } });
        api.registerTool({ name: "save_project_fragment", description: "Create or update a typed project writing fragment such as prose, character, guideline, knowledge, note, summary, or marker.", scopes: ["intake"], risk: "write", parameters: { projectName: "string", fragmentId: "string", type: "string", name: "string", description: "string", content: "string", tags: "array", sticky: "boolean", placement: "string" } });
        api.registerTool({ name: "get_project_fragment_context", description: "Assemble sticky fragments, fragment shortlists, and recent prose for a workspace project into context blocks.", scopes: ["intake"], risk: "normal", parameters: { projectName: "string", proseLimit: "number", shortlistLimit: "number" } });
      }
      if (typeof api.addHook === "function") {
        api.addHook("intake:tools:list", async (payload = {}) => {
          const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
          tools.push(
            {
              name: "get_project_status",
              description: "Get a summary of active workspace projects, or a named project's phase, TODOs, roles, and pipeline status.",
              parameters: { limit: "number", projectName: "string" }
            },
            {
              name: "get_project_pipeline",
              description: "Get the full task pipeline trace for a specific project by name or work key.",
              parameters: { projectWorkKey: "string", taskId: "string" }
            },
            {
              name: "list_project_fragments",
              description: "List typed writing fragments for a workspace project, optionally filtered by type or search query.",
              parameters: { projectName: "string", type: "string", query: "string", limit: "number" }
            },
            {
              name: "get_project_fragment",
              description: "Read the full content and metadata for one project writing fragment.",
              parameters: { projectName: "string", fragmentId: "string" }
            },
            {
              name: "save_project_fragment",
              description: "Create or update a typed project writing fragment such as prose, character, guideline, knowledge, note, summary, or marker.",
              parameters: { projectName: "string", fragmentId: "string", type: "string", name: "string", description: "string", content: "string", tags: "array", sticky: "boolean", placement: "string" }
            },
            {
              name: "get_project_fragment_context",
              description: "Assemble sticky fragments, fragment shortlists, and recent prose for a workspace project into context blocks.",
              parameters: { projectName: "string", proseLimit: "number", shortlistLimit: "number" }
            }
          );
          return { ...payload, tools };
        });

        api.addHook("intake:tool-call", async (payload = {}) => {
          const name = String(payload?.name || "").trim();
          const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
          const handledResult = (result = null) => ({ ...payload, handled: true, result });
          const runtime = getProjectRuntime(api);

          if (name === "get_project_status") {
            const listProjectPipelines = requireRuntimeFn(runtime, "listProjectPipelines");
            if (!listProjectPipelines) {
              return handledResult({ text: "Project pipeline listing is unavailable." });
            }
            const normalizeProjectSearchText = (value = "") => String(value || "")
              .toLowerCase()
              .replace(/%20/g, " ")
              .replace(/[^a-z0-9]+/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            const compactProjectLine = (value = "", maxLength = 180) => compactHookText(String(value || ""), maxLength);
            const formatPanel = (panel = {}) => {
              const assessment = panel.assessment && typeof panel.assessment === "object" ? panel.assessment : {};
              const checklist = panel.checklist && typeof panel.checklist === "object" ? panel.checklist : {};
              const todo = checklist.todo && typeof checklist.todo === "object" ? checklist.todo : {};
              const roles = checklist.roles && typeof checklist.roles === "object" ? checklist.roles : {};
              const activeRoles = Array.isArray(panel.activeRoles) ? panel.activeRoles : [];
              const roleReports = Array.isArray(panel.roleReports) ? panel.roleReports : [];
              const pname = compactHookText(String(panel.name || panel.sourceName || "Unknown project"), 80);
              const lines = [`Project: ${pname}`];
              lines.push(`Phase: ${String(assessment.phaseLabel || "Unknown").trim()}${assessment.workstreamLabel ? ` (${assessment.workstreamLabel})` : ""}`);
              if (assessment.currentPriority) lines.push(`Priority: ${compactProjectLine(assessment.currentPriority, 220)}`);
              const openTodos = Array.isArray(todo.unchecked) ? todo.unchecked : [];
              const doneTodos = Array.isArray(todo.checked) ? todo.checked : [];
              lines.push(`TODOs: ${Number(todo.uncheckedCount || openTodos.length || 0)} open, ${Number(todo.checkedCount || doneTodos.length || 0)} done.`);
              for (const item of openTodos.slice(0, 6)) lines.push(`- [ ] ${compactProjectLine(item, 180)}`);
              const activeRoleLabels = activeRoles.slice(0, 6).map((entry) => {
                const roleName = String(entry?.name || entry || "").trim();
                const reason = String(entry?.reason || "").trim();
                return roleName ? `${roleName}${reason ? `: ${compactProjectLine(reason, 120)}` : ""}` : "";
              }).filter(Boolean);
              const selectedRoleLabels = roleReports
                .filter((entry) => entry?.selected || Number(entry?.uncheckedCount || 0) || Number(entry?.checkedCount || 0))
                .map((entry) => String(entry?.name || "").trim())
                .filter(Boolean)
                .slice(0, 6);
              lines.push(`Roles: ${activeRoleLabels.length ? activeRoleLabels.join("; ") : (selectedRoleLabels.length ? selectedRoleLabels.join(", ") : "No active roles recorded yet")}.`);
              const roleTaskLines = roleReports
                .flatMap((entry) => (Array.isArray(entry?.unchecked) ? entry.unchecked : []).map((task) => ({
                  role: String(entry?.name || "").trim(),
                  task: compactProjectLine(task, 170)
                })))
                .filter((entry) => entry.role && entry.task)
                .slice(0, 6);
              if (roleTaskLines.length) {
                lines.push(`Role tasks: ${Number(roles.uncheckedCount || roleTaskLines.length || 0)} open, ${Number(roles.checkedCount || 0)} done.`);
                for (const entry of roleTaskLines) lines.push(`- ${entry.role}: ${entry.task}`);
              }
              return lines;
            };
            const requestedProjectName = String(args.projectName || args.project || args.name || "").trim();
            if (requestedProjectName && typeof runtime.buildProjectSystemStatePayload === "function") {
              const state = await runtime.buildProjectSystemStatePayload().catch(() => null);
              const panels = Array.isArray(state?.projectPanels) ? state.projectPanels : [];
              const requested = normalizeProjectSearchText(requestedProjectName);
              const panel = panels.find((entry) => {
                const aliases = [
                  entry?.name,
                  entry?.sourceName,
                  entry?.key,
                  ...(Array.isArray(entry?.aliases) ? entry.aliases : [])
                ].map(normalizeProjectSearchText).filter(Boolean);
                return aliases.some((alias) => alias && (requested.includes(alias) || alias.includes(requested)));
              });
              if (panel) {
                return handledResult({ text: formatPanel(panel).join("\n"), project: panel });
              }
            }
            const limit = Math.max(1, Math.min(Number(args.limit || 16), 50));
            const pipelines = await listProjectPipelines({ limit });
            if (!Array.isArray(pipelines) || !pipelines.length) {
              return handledResult({ text: "No active workspace projects found." });
            }
            const lines = [`${pipelines.length} active project pipeline${pipelines.length === 1 ? "" : "s"}:`];
            for (const pipeline of pipelines) {
              const pname = compactHookText(String(pipeline.projectName || pipeline.projectWorkKey || pipeline.id || "Unknown"), 80);
              const taskCount = Number(pipeline.taskCount || pipeline.tasks?.length || 0);
              const status = compactHookText(String(pipeline.status || pipeline.phase || ""), 30);
              lines.push(`- ${pname}${status ? " [" + status + "]" : ""}${taskCount ? ": " + taskCount + " task" + (taskCount === 1 ? "" : "s") : ""}`);
            }
            return handledResult({ text: lines.join("\n"), pipelines });
          }

          if (name === "get_project_pipeline") {
            const getProjectPipelineTrace = requireRuntimeFn(runtime, "getProjectPipelineTrace");
            if (!getProjectPipelineTrace) {
              return handledResult({ text: "Project pipeline trace is unavailable." });
            }
            const trace = await getProjectPipelineTrace({
              projectWorkKey: String(args.projectWorkKey || "").trim(),
              taskId: String(args.taskId || "").trim()
            });
            if (!trace) {
              return handledResult({ text: "No project pipeline found matching that reference." });
            }
            const pname = compactHookText(String(trace.projectName || trace.projectWorkKey || "Unknown"), 80);
            const lines = [`Project: ${pname}`];
            if (trace.status) lines.push(`Status: ${trace.status}`);
            if (Array.isArray(trace.tasks)) {
              lines.push(`Tasks: ${trace.tasks.length}`);
              for (const task of trace.tasks.slice(0, 6)) {
                lines.push(`- ${task.codename || task.id}: ${compactHookText(task.message || "", 80)} [${task.status}]`);
              }
            }
            return handledResult({ text: lines.join("\n"), trace });
          }

          if (name === "list_project_fragments") {
            const listProjectFragments = requireRuntimeFn(runtime, "listProjectFragments");
            if (!listProjectFragments) {
              return handledResult({ text: "Project fragments are unavailable." });
            }
            const result = await listProjectFragments({
              projectName: String(args.projectName || args.project || "").trim(),
              type: String(args.type || "").trim(),
              query: String(args.query || "").trim(),
              limit: Math.max(1, Math.min(Number(args.limit || 40), 120))
            });
            const fragments = Array.isArray(result?.fragments) ? result.fragments : [];
            const projectName = compactHookText(String(result?.project?.name || args.projectName || "Project"), 80);
            if (!fragments.length) {
              return handledResult({ text: `No project fragments found for ${projectName}.`, fragments: [] });
            }
            const lines = [`${fragments.length} project fragment${fragments.length === 1 ? "" : "s"} for ${projectName}:`];
            for (const fragment of fragments.slice(0, 30)) {
              const label = compactHookText(String(fragment.name || fragment.id || "Fragment"), 80);
              const preview = compactHookText(String(fragment.description || fragment.content || "").trim(), 140);
              lines.push(`- ${fragment.id} (${fragment.type})${fragment.sticky ? " [sticky]" : ""}: ${label}${preview ? ` - ${preview}` : ""}`);
            }
            return handledResult({ text: lines.join("\n"), fragments });
          }

          if (name === "get_project_fragment") {
            const getProjectFragment = requireRuntimeFn(runtime, "getProjectFragment");
            if (!getProjectFragment) {
              return handledResult({ text: "Project fragments are unavailable." });
            }
            const result = await getProjectFragment({
              projectName: String(args.projectName || args.project || "").trim(),
              fragmentId: String(args.fragmentId || args.id || "").trim()
            });
            if (!result?.fragment) {
              return handledResult({ text: "Project fragment not found." });
            }
            const fragment = result.fragment;
            const lines = [
              `Fragment: ${fragment.id} (${fragment.type})`,
              `Name: ${fragment.name}`,
              fragment.description ? `Description: ${fragment.description}` : "",
              `Sticky: ${fragment.sticky ? "yes" : "no"} | Placement: ${fragment.placement}`,
              "",
              String(fragment.content || "")
            ].filter((line) => line !== "");
            return handledResult({ text: lines.join("\n"), fragment });
          }

          if (name === "save_project_fragment") {
            const createProjectFragment = requireRuntimeFn(runtime, "createProjectFragment");
            const updateProjectFragment = requireRuntimeFn(runtime, "updateProjectFragment");
            if (!createProjectFragment || !updateProjectFragment) {
              return handledResult({ text: "Project fragments are unavailable." });
            }
            const fragmentId = String(args.fragmentId || args.id || "").trim();
            const hasArg = (key) => Object.prototype.hasOwnProperty.call(args, key);
            const fragmentPayload = {};
            if (String(args.type || "").trim()) {
              fragmentPayload.type = String(args.type || "").trim();
            } else if (!fragmentId) {
              fragmentPayload.type = "note";
            }
            if (hasArg("name") || !fragmentId) {
              fragmentPayload.name = String(args.name || "").trim();
            }
            if (hasArg("description") || !fragmentId) {
              fragmentPayload.description = String(args.description || "").trim();
            }
            if (hasArg("content") || !fragmentId) {
              fragmentPayload.content = String(args.content || "");
            }
            if (Array.isArray(args.tags)) {
              fragmentPayload.tags = args.tags;
            }
            if (Array.isArray(args.refs)) {
              fragmentPayload.refs = args.refs;
            }
            if (String(args.placement || "").trim()) {
              fragmentPayload.placement = String(args.placement || "user").trim();
            }
            if (typeof args.sticky === "boolean") {
              fragmentPayload.sticky = args.sticky;
            }
            const result = fragmentId
              ? await updateProjectFragment({
                projectName: String(args.projectName || args.project || "").trim(),
                fragmentId,
                fragment: fragmentPayload,
                reason: "tool-save"
              })
              : await createProjectFragment({
                projectName: String(args.projectName || args.project || "").trim(),
                fragment: fragmentPayload
              });
            return handledResult({
              text: `Saved project fragment ${result.fragment.id} (${result.fragment.type}) for ${result.project.name}.`,
              fragment: result.fragment
            });
          }

          if (name === "get_project_fragment_context") {
            const buildProjectFragmentContext = requireRuntimeFn(runtime, "buildProjectFragmentContext");
            if (!buildProjectFragmentContext) {
              return handledResult({ text: "Project fragment context is unavailable." });
            }
            const result = await buildProjectFragmentContext({
              projectName: String(args.projectName || args.project || "").trim(),
              proseLimit: Number(args.proseLimit || 12),
              shortlistLimit: Number(args.shortlistLimit || 40)
            });
            return handledResult({
              text: result.text || "No project fragment context is available yet.",
              blocks: result.blocks,
              summary: result.summary
            });
          }

          return payload;
        });

        api.addHook("runtime:startup", async (payload = {}) => {
          await ensureOpportunityScanScheduledTask({ force: true });
          return payload;
        });
        api.addHook("runtime:tick:5m", async (payload = {}) => {
          await ensureOpportunityScanScheduledTask({ force: false });
          return payload;
        });
        api.addHook("queue:task-processed", async (payload = {}) => {
          const taskId = String(payload?.taskId || "").trim();
          const status = String(payload?.status || "").trim();
          const internalJobType = String(payload?.task?.internalJobType || "").trim();
          if (!taskId || status !== "completed") return payload;
          const coreTransactions = api.getRuntimeContext?.()?.coreTransactions || null;
          if (!coreTransactions) return payload;
          try {
            const transactions = await coreTransactions.listTransactionsForTask(taskId);
            const applied = Array.isArray(transactions)
              ? transactions.filter((t) => String(t.status || "").trim() === "applied")
              : [];
            if (applied.length) {
              const summary = applied.slice(-12).map((t) => {
                const op = String(t.operation || "").trim();
                const target = String(t.target?.path || t.target?.target || "").trim();
                return target ? `${op} ${target}` : op;
              }).filter(Boolean).join(", ");
              void api.broadcast?.({
                type: "projects.task_transaction_summary",
                taskId,
                internalJobType,
                appliedCount: applied.length,
                summary,
                at: Date.now()
              });
            }
          } catch {
            // non-critical; ignore errors from transaction ledger on task completion
          }
          return payload;
        });
        api.addHook("cron:definitions:list", async (payload = {}) => {
          if (api.isEnabled?.() !== true) {
            return payload;
          }
          const definitions = Array.isArray(payload?.definitions)
            ? payload.definitions.slice()
            : [];
          const hasOpportunityScanDefinition = definitions.some((entry) =>
            String(entry?.id || "").trim() === OPPORTUNITY_SCAN_SERIES_ID
          );
          if (!hasOpportunityScanDefinition) {
            definitions.push(buildOpportunityScanDefinition());
          }
          return {
            ...payload,
            definitions
          };
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/projects/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "projects-tab.js"));
      });

      app.get("/api/projects/config", async (_req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const buildProjectConfigPayload = requireRuntimeFn(runtime, "buildProjectConfigPayload");
          const buildProjectSystemStatePayload = requireRuntimeFn(runtime, "buildProjectSystemStatePayload");
          if (!buildProjectConfigPayload || !buildProjectSystemStatePayload) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          res.json({
            ok: true,
            ...buildProjectConfigPayload(),
            state: await buildProjectSystemStatePayload()
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load project configuration") });
        }
      });

      app.post("/api/projects/config", async (req, res) => {
        try {
          const runtime = {
            ...api.getRuntimeContext(),
            ...getProjectRuntime(api)
          };
          const getObserverConfig = requireRuntimeFn(runtime, "getObserverConfig")
            || (typeof api.getObserverConfig === "function" ? api.getObserverConfig : null);
          const setObserverConfig = requireRuntimeFn(runtime, "setObserverConfig");
          const normalizeProjectConfigInput = requireRuntimeFn(runtime, "normalizeProjectConfigInput");
          const saveObserverConfig = requireRuntimeFn(runtime, "saveObserverConfig");
          const buildProjectConfigPayload = requireRuntimeFn(runtime, "buildProjectConfigPayload");
          const buildProjectSystemStatePayload = requireRuntimeFn(runtime, "buildProjectSystemStatePayload");
          if (!getObserverConfig || !setObserverConfig || !normalizeProjectConfigInput || !saveObserverConfig || !buildProjectConfigPayload || !buildProjectSystemStatePayload) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }

          const payload = req.body && typeof req.body === "object" ? req.body : {};
          const nextProjects = payload?.projects && typeof payload.projects === "object" ? payload.projects : {};
          setObserverConfig({
            ...getObserverConfig(),
            projects: normalizeProjectConfigInput(nextProjects)
          });
          await saveObserverConfig();
          res.json({
            ok: true,
            message: "Project configuration saved.",
            ...buildProjectConfigPayload(),
            state: await buildProjectSystemStatePayload()
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to save project configuration") });
        }
      });

      app.get("/api/projects/state", async (_req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const buildProjectSystemStatePayload = requireRuntimeFn(runtime, "buildProjectSystemStatePayload");
          if (!buildProjectSystemStatePayload) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          res.json({
            ok: true,
            state: await buildProjectSystemStatePayload()
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load project state") });
        }
      });

      app.post("/api/projects/checklist/remove-item", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const removeProjectChecklistItem = requireRuntimeFn(runtime, "removeProjectChecklistItem");
          if (!removeProjectChecklistItem) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const filePath = String(req.body?.filePath || "").trim();
          const itemText = String(req.body?.itemText || "").trim();
          await removeProjectChecklistItem({ filePath, itemText });
          res.json({ ok: true });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to remove project checklist item") });
        }
      });

      app.post("/api/projects/checklist/add-role", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const addProjectRole = requireRuntimeFn(runtime, "addProjectRole");
          if (!addProjectRole) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const roleTaskPath = String(req.body?.roleTaskPath || "").trim();
          const roleName = String(req.body?.roleName || "").trim();
          const reason = String(req.body?.reason || "").trim();
          await addProjectRole({ roleTaskPath, roleName, reason });
          res.json({ ok: true });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to add project role") });
        }
      });

      app.post("/api/projects/checklist/remove-role", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const removeProjectRole = requireRuntimeFn(runtime, "removeProjectRole");
          if (!removeProjectRole) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const roleTaskPath = String(req.body?.roleTaskPath || "").trim();
          const roleName = String(req.body?.roleName || "").trim();
          await removeProjectRole({ roleTaskPath, roleName });
          res.json({ ok: true });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to remove project role") });
        }
      });

      app.post("/api/projects/workspace/abort", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const exportWorkspaceProjectToOutput = requireRuntimeFn(runtime, "exportWorkspaceProjectToOutput");
          const listContainerWorkspaceProjects = requireRuntimeFn(api.getRuntimeContext(), "listContainerWorkspaceProjects");
          if (!exportWorkspaceProjectToOutput || !listContainerWorkspaceProjects) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const projectName = String(req.body?.projectName || "").trim();
          if (!projectName) {
            return res.status(400).json({ ok: false, error: "projectName is required" });
          }
          const workspaceProjects = await listContainerWorkspaceProjects();
          const project = workspaceProjects.find(
            (p) => String(p?.name || "").trim().toLowerCase() === projectName.toLowerCase()
          );
          if (!project) {
            return res.status(404).json({ ok: false, error: `No workspace project found: ${projectName}` });
          }
          const result = await exportWorkspaceProjectToOutput(project, { ready: false });
          res.json({ ok: true, result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to abort project") });
        }
      });

      app.get("/api/projects/pipelines", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const listProjectPipelines = requireRuntimeFn(runtime, "listProjectPipelines");
          if (!listProjectPipelines) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const limit = Number(req.query.limit || 24);
          res.json({
            ok: true,
            pipelines: await listProjectPipelines({ limit })
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list project pipelines") });
        }
      });

      app.get("/api/projects/pipeline", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const getProjectPipelineTrace = requireRuntimeFn(runtime, "getProjectPipelineTrace");
          if (!getProjectPipelineTrace) {
            return res.status(503).json({ ok: false, error: "projects runtime context is unavailable" });
          }
          const taskId = String(req.query.taskId || "").trim();
          const projectWorkKey = String(req.query.projectWorkKey || "").trim();
          if (!taskId && !projectWorkKey) {
            return res.status(400).json({ ok: false, error: "taskId or projectWorkKey is required" });
          }
          const pipeline = await getProjectPipelineTrace({ taskId, projectWorkKey });
          if (!pipeline) {
            return res.status(404).json({ ok: false, error: "project pipeline not found" });
          }
          res.json({ ok: true, pipeline });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to load project pipeline") });
        }
      });

      app.get("/api/projects/fragments", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const listProjectFragments = requireRuntimeFn(runtime, "listProjectFragments");
          if (!listProjectFragments) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await listProjectFragments({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            type: String(req.query.type || "").trim(),
            query: String(req.query.query || "").trim(),
            includeArchived: String(req.query.includeArchived || "").trim() === "true",
            limit: Number(req.query.limit || 100)
          });
          res.json({ ok: true, project: result.project, fragments: result.fragments });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to list project fragments") });
        }
      });

      app.get("/api/projects/fragments/:fragmentId", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const getProjectFragment = requireRuntimeFn(runtime, "getProjectFragment");
          if (!getProjectFragment) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await getProjectFragment({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim()
          });
          if (!result.fragment) {
            return res.status(404).json({ ok: false, error: "fragment not found" });
          }
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to load project fragment") });
        }
      });

      app.get("/api/projects/fragments/:fragmentId/refs", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const getProjectFragmentRefs = requireRuntimeFn(runtime, "getProjectFragmentRefs");
          if (!getProjectFragmentRefs) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await getProjectFragmentRefs({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim()
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to load project fragment refs") });
        }
      });

      app.get("/api/projects/fragments/:fragmentId/versions", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const listProjectFragmentVersions = requireRuntimeFn(runtime, "listProjectFragmentVersions");
          if (!listProjectFragmentVersions) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await listProjectFragmentVersions({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim()
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment, versions: result.versions });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to load project fragment versions") });
        }
      });

      app.post("/api/projects/fragments", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const createProjectFragment = requireRuntimeFn(runtime, "createProjectFragment");
          if (!createProjectFragment) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await createProjectFragment({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            fragment: req.body?.fragment && typeof req.body.fragment === "object" ? req.body.fragment : req.body,
            addToChain: req.body?.addToChain !== false
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to create project fragment") });
        }
      });

      app.put("/api/projects/fragments/:fragmentId", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const updateProjectFragment = requireRuntimeFn(runtime, "updateProjectFragment");
          if (!updateProjectFragment) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await updateProjectFragment({
            projectName: String(req.body?.projectName || req.query.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim(),
            fragment: req.body?.fragment && typeof req.body.fragment === "object" ? req.body.fragment : req.body,
            reason: String(req.body?.reason || "api-update").trim()
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update project fragment") });
        }
      });

      app.post("/api/projects/fragments/:fragmentId/versions/:version/revert", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const revertProjectFragmentVersion = requireRuntimeFn(runtime, "revertProjectFragmentVersion");
          if (!revertProjectFragmentVersion) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await revertProjectFragmentVersion({
            projectName: String(req.body?.projectName || req.query.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim(),
            version: Number(req.params.version)
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to revert project fragment version") });
        }
      });

      app.patch("/api/projects/fragments/reorder", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const reorderProjectFragments = requireRuntimeFn(runtime, "reorderProjectFragments");
          if (!reorderProjectFragments) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await reorderProjectFragments({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            items: Array.isArray(req.body?.items) ? req.body.items : []
          });
          res.json({ ok: true, project: result.project, updated: result.updated });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to reorder project fragments") });
        }
      });

      app.post("/api/projects/fragments/:fragmentId/archive", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const archiveProjectFragment = requireRuntimeFn(runtime, "archiveProjectFragment");
          if (!archiveProjectFragment) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await archiveProjectFragment({
            projectName: String(req.body?.projectName || req.query.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim()
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to archive project fragment") });
        }
      });

      app.post("/api/projects/fragments/:fragmentId/restore", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const restoreProjectFragment = requireRuntimeFn(runtime, "restoreProjectFragment");
          if (!restoreProjectFragment) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await restoreProjectFragment({
            projectName: String(req.body?.projectName || req.query.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || req.query.projectPath || "").trim(),
            fragmentId: String(req.params.fragmentId || "").trim()
          });
          res.json({ ok: true, project: result.project, fragment: result.fragment });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to restore project fragment") });
        }
      });

      app.get("/api/projects/fragment-context", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const buildProjectFragmentContext = requireRuntimeFn(runtime, "buildProjectFragmentContext");
          if (!buildProjectFragmentContext) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await buildProjectFragmentContext({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            proseLimit: Number(req.query.proseLimit || 12),
            shortlistLimit: Number(req.query.shortlistLimit || 40)
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to build project fragment context") });
        }
      });

      app.get("/api/projects/fragment-validation", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const validateProjectFragments = requireRuntimeFn(runtime, "validateProjectFragments");
          if (!validateProjectFragments) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await validateProjectFragments({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim()
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to validate project fragments") });
        }
      });

      app.get("/api/projects/fragment-bundle", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const exportProjectFragmentBundle = requireRuntimeFn(runtime, "exportProjectFragmentBundle");
          if (!exportProjectFragmentBundle) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const bundle = await exportProjectFragmentBundle({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim(),
            includeArchived: String(req.query.includeArchived || "").trim() === "true"
          });
          res.json({ ok: true, bundle });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to export project fragment bundle") });
        }
      });

      app.post("/api/projects/fragment-bundle", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const importProjectFragmentBundle = requireRuntimeFn(runtime, "importProjectFragmentBundle");
          if (!importProjectFragmentBundle) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await importProjectFragmentBundle({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            bundle: req.body?.bundle && typeof req.body.bundle === "object" ? req.body.bundle : {},
            preserveIds: req.body?.preserveIds !== false,
            overwrite: req.body?.overwrite === true
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to import project fragment bundle") });
        }
      });

      app.get("/api/projects/fragment-chain", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const getProjectProseChain = requireRuntimeFn(runtime, "getProjectProseChain");
          if (!getProjectProseChain) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await getProjectProseChain({
            projectName: String(req.query.projectName || "").trim(),
            projectPath: String(req.query.projectPath || "").trim()
          });
          res.json({ ok: true, project: result.project, chain: result.chain });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to load project prose chain") });
        }
      });

      app.post("/api/projects/fragment-chain/variation", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const addProjectProseVariation = requireRuntimeFn(runtime, "addProjectProseVariation");
          if (!addProjectProseVariation) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await addProjectProseVariation({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            sectionIndex: Number(req.body?.sectionIndex),
            fragmentId: String(req.body?.fragmentId || "").trim()
          });
          res.json({ ok: true, project: result.project, chain: result.chain });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to add project prose variation") });
        }
      });

      app.post("/api/projects/fragment-chain/switch", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const switchActiveProjectProse = requireRuntimeFn(runtime, "switchActiveProjectProse");
          if (!switchActiveProjectProse) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await switchActiveProjectProse({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            sectionIndex: Number(req.body?.sectionIndex),
            fragmentId: String(req.body?.fragmentId || "").trim()
          });
          res.json({ ok: true, project: result.project, chain: result.chain });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to switch project prose variation") });
        }
      });

      app.post("/api/projects/fragment-chain/move", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const moveProjectProseSection = requireRuntimeFn(runtime, "moveProjectProseSection");
          if (!moveProjectProseSection) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await moveProjectProseSection({
            projectName: String(req.body?.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || "").trim(),
            fromIndex: Number(req.body?.fromIndex ?? req.body?.sectionIndex),
            toIndex: Number(req.body?.toIndex)
          });
          res.json({ ok: true, project: result.project, chain: result.chain });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to move project prose section") });
        }
      });

      app.delete("/api/projects/fragment-chain/:sectionIndex", async (req, res) => {
        try {
          const runtime = getProjectRuntime(api);
          const removeProjectProseSection = requireRuntimeFn(runtime, "removeProjectProseSection");
          if (!removeProjectProseSection) {
            return res.status(503).json({ ok: false, error: "project fragments runtime is unavailable" });
          }
          const result = await removeProjectProseSection({
            projectName: String(req.body?.projectName || req.query.projectName || "").trim(),
            projectPath: String(req.body?.projectPath || req.query.projectPath || "").trim(),
            sectionIndex: Number(req.params.sectionIndex),
            archiveFragments: String(req.body?.archiveFragments ?? req.query.archiveFragments ?? "").trim() === "true"
          });
          res.json({ ok: true, project: result.project, chain: result.chain, removed: result.removed });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to remove project prose section") });
        }
      });
    }
  };
}
