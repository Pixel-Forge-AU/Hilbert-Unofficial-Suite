/**
 * Plugin Name: Code Review
 * Plugin Slug: code-review
 * Description: Multi-pass code review with security pattern detection, quality analysis,
 *              diff-aware file categorization, and structured findings. Inspired by gstack's
 *              /review and /cso commands. Workers call these tools to get structured review
 *              data; the worker agent synthesizes the findings.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import {
  getDiffForReview,
  getStagedDiff,
  getRecentCommits,
  getCurrentBranch,
  analyzeSecurityPatterns,
  analyzeQualityPatterns,
  buildReviewReport,
  computeRiskLevel
} from "./lib/review-domain.js";

function analyzeAndReport(diff, stats) {
  const securityFindings = analyzeSecurityPatterns(diff);
  const qualityFindings = analyzeQualityPatterns(diff);
  const result = buildReviewReport({ diff, stats, securityFindings, qualityFindings });
  result.diffExcerpt = diff.length > 6000 ? diff.slice(0, 6000) + "\n[...truncated]" : diff;
  return result;
}

export function createCodeReviewPlugin(options = {}) {
  const {
    pluginId = "code-review",
    pluginName = "Code Review",
    description = "Multi-pass code review, security analysis, and quality checks."
  } = options;

  const TOOL_DEFINITIONS = [
    {
      name: "review_diff",
      description: "Run a structured multi-pass review of a git diff. Returns security findings, quality findings, file categorization, risk score, and a review checklist. Pass cwd pointing to the repo root.",
      scopes: ["worker"],
      parameters: {
        cwd: "string — absolute path to the git repo root",
        base: "string — base ref (default: HEAD~1)",
        head: "string — head ref (default: HEAD)",
        filePaths: "array of strings — optional: restrict review to specific files"
      }
    },
    {
      name: "review_staged",
      description: "Review only the currently staged changes (git diff --staged). Useful before committing.",
      scopes: ["worker"],
      parameters: {
        cwd: "string — absolute path to the git repo root"
      }
    },
    {
      name: "review_code_snippet",
      description: "Analyze a snippet of code (not a diff) for security and quality issues. Useful for reviewing a single file or function.",
      scopes: ["worker"],
      parameters: {
        code: "string (required) — the code to analyze",
        language: "string — hint for context (js, ts, py, go, etc.)"
      }
    },
    {
      name: "review_security_only",
      description: "Run only the security analysis pass on a diff or code snippet. Returns only security findings without quality analysis.",
      scopes: ["worker"],
      parameters: {
        cwd: "string — repo root (used to get diff if code not provided)",
        code: "string — code or diff text to analyze directly",
        base: "string", head: "string"
      }
    },
    {
      name: "review_get_context",
      description: "Get git context for a review: current branch, recent commits, and a summary of what changed. Useful as a first step before running review_diff.",
      scopes: ["worker"],
      parameters: {
        cwd: "string — absolute path to the git repo root",
        commitCount: "number — how many recent commits to include (default 10)"
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
        data: false,
        tools: TOOL_DEFINITIONS.map((t) => t.name),
        capabilities: ["code-review.analyze"],
        hooks: ["intake:tool-call", "queue:task-processed"],
        runtimeContext: ["coreTransactions"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("code-review.analyze", () => ({
          getDiffForReview,
          analyzeSecurityPatterns,
          analyzeQualityPatterns,
          buildReviewReport
        }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        try {
          let result;

          if (name === "review_diff") {
            const cwd = String(args.cwd || "").trim();
            if (!cwd) throw new Error("cwd is required");
            const { ok, diff, stats, error } = await getDiffForReview({
              cwd,
              base: String(args.base || "HEAD~1"),
              head: String(args.head || "HEAD"),
              filePaths: Array.isArray(args.filePaths) ? args.filePaths : []
            });
            if (!ok) throw new Error(error || "git diff failed");
            result = diff.trim() ? analyzeAndReport(diff, stats) : { empty: true, message: "No diff found between the specified refs." };

          } else if (name === "review_staged") {
            const cwd = String(args.cwd || "").trim();
            if (!cwd) throw new Error("cwd is required");
            const { ok, diff, stats, error } = await getStagedDiff({ cwd });
            if (!ok) throw new Error(error || "git diff --staged failed");
            result = diff.trim() ? analyzeAndReport(diff, stats) : { empty: true, message: "No staged changes found." };

          } else if (name === "review_code_snippet") {
            const code = String(args.code || "").trim();
            if (!code) throw new Error("code is required");
            const securityFindings = analyzeSecurityPatterns(code);
            const qualityFindings = analyzeQualityPatterns(code);
            result = {
              securityFindings,
              qualityFindings,
              summary: {
                criticalIssues: securityFindings.filter((f) => f.severity === "critical").length,
                highIssues: securityFindings.filter((f) => f.severity === "high").length,
                qualityWarnings: qualityFindings.filter((f) => f.severity === "warning").length,
                riskLevel: computeRiskLevel(securityFindings, qualityFindings)
              }
            };

          } else if (name === "review_security_only") {
            let codeToAnalyze = String(args.code || "").trim();
            if (!codeToAnalyze && args.cwd) {
              const cwd = String(args.cwd || "").trim();
              const { ok, diff } = await getDiffForReview({
                cwd,
                base: String(args.base || "HEAD~1"),
                head: String(args.head || "HEAD")
              });
              if (ok) codeToAnalyze = diff;
            }
            if (!codeToAnalyze) throw new Error("Provide code or cwd to get diff");
            const securityFindings = analyzeSecurityPatterns(codeToAnalyze);
            result = {
              securityFindings,
              criticalCount: securityFindings.filter((f) => f.severity === "critical").length,
              highCount: securityFindings.filter((f) => f.severity === "high").length,
              riskLevel: computeRiskLevel(securityFindings)
            };

          } else if (name === "review_get_context") {
            const cwd = String(args.cwd || "").trim();
            if (!cwd) throw new Error("cwd is required");
            const [branch, commits, diffResult] = await Promise.all([
              getCurrentBranch({ cwd }),
              getRecentCommits({ cwd, count: Number(args.commitCount || 10) }),
              getDiffForReview({ cwd, base: "HEAD~1", head: "HEAD" })
            ]);
            result = {
              branch,
              recentCommits: commits,
              pendingChanges: diffResult.ok && diffResult.diff.trim() ? {
                filesChanged: diffResult.stats.totalFiles,
                linesAdded: diffResult.stats.totalAdded,
                linesRemoved: diffResult.stats.totalRemoved,
                files: diffResult.stats.files.map((f) => f.path)
              } : null
            };
          }

          // Augment review results with autoplan blast-radius guidance when
          // recurring security patterns are found (occurrences > 1)
          if (result && !result.error && typeof api.getCapability === "function") {
            const autoplanCap = api.getCapability("autoplan.decision");
            if (autoplanCap) {
              const { resolveDecision } = autoplanCap;
              const allFindings = [
                ...(result.securityFindings ?? []),
                ...(result.qualityFindings ?? [])
              ].filter((f) => (f.occurrences ?? 1) > 1);
              if (allFindings.length > 0) {
                const blastRadius = resolveDecision(
                  "should i fix only the instance shown or fix everywhere",
                  `${allFindings.length} pattern(s) appear more than once`
                );
                result.autoplanGuidance = blastRadius;
              }
            }
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "review error") }
          };
        }
      });

      api.addHook("queue:task-processed", async (payload = {}) => {
        const taskId = String(payload?.taskId || "").trim();
        const status = String(payload?.status || "").trim();
        if (!taskId || status !== "completed") return payload;
        const coreTransactions = api.getRuntimeContext?.()?.coreTransactions || null;
        if (!coreTransactions) return payload;
        try {
          const transactions = await coreTransactions.listTransactionsForTask(taskId);
          const applied = Array.isArray(transactions)
            ? transactions.filter((t) => String(t.status || "").trim() === "applied")
            : [];
          if (applied.length >= 3) {
            void api.broadcast?.({
              type: "code_review.review_suggested",
              taskId,
              appliedCount: applied.length,
              changedPaths: applied.slice(-8).map((t) => String(t.target?.path || "").trim()).filter(Boolean),
              at: Date.now()
            });
          }
        } catch {
          // non-critical
        }
        return payload;
      });
    }
  };
}
