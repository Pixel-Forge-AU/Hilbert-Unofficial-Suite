/**
 * Plugin Name: Security Audit
 * Plugin Slug: security-audit
 * Description: Multi-phase deep security audit covering secrets archaeology (git history),
 *              dependency CVE scanning, CI/CD pipeline analysis, OWASP Top 10 checklist,
 *              attack surface mapping, and LLM trust boundary checks. Inspired by gstack /cso.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import {
  detectStack,
  scanGitSecretsHistory,
  scanEnvFiles,
  scanDependencies,
  analyzeciPipeline,
  buildOwaspChecklist,
  mapAttackSurface,
  checkLlmSecurityPatterns,
  runFullAudit
} from "./lib/audit-domain.js";

export function createSecurityAuditPlugin(options = {}) {
  const {
    pluginId = "security-audit",
    pluginName = "Security Audit",
    description = "Multi-phase deep security auditing with git history, deps, CI/CD, OWASP, and LLM checks."
  } = options;

  const TOOL_DEFINITIONS = [
    {
      name: "security_audit_full",
      description: "Run a complete 8-phase security audit on a repository: stack detection, git history secrets scan, env file scan, dependency CVE scan, CI/CD pipeline analysis, OWASP Top 10 checklist, attack surface census, and LLM/AI security checks. Returns overall risk level and immediate action items.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repository root"
      }
    },
    {
      name: "security_scan_git_secrets",
      description: "Scan git commit history for accidentally committed secrets (API keys, tokens, passwords, private keys). Scans the last N commits across all branches.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo",
        maxCommits: "number — how many commits to scan (default 100)"
      }
    },
    {
      name: "security_scan_env_files",
      description: "Find all .env and config files in the repository and check if they contain real secrets (not placeholders) and whether they are git-tracked.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
      }
    },
    {
      name: "security_scan_dependencies",
      description: "Run dependency vulnerability scanning using npm audit (Node.js) or pip-audit (Python). Returns CVE counts by severity.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
      }
    },
    {
      name: "security_analyze_cicd",
      description: "Analyze CI/CD pipeline files (GitHub Actions, GitLab CI, Jenkins, CircleCI) for security misconfigurations: script injection, pull_request_target misuse, unpinned actions, pipe-to-shell patterns.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
      }
    },
    {
      name: "security_map_attack_surface",
      description: "Census all HTTP endpoints, background jobs, external connections, file system access, and environment variables used in the codebase. Useful for threat modeling.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
      }
    },
    {
      name: "security_check_llm",
      description: "Check for LLM/AI-specific security issues: prompt injection vulnerabilities, eval() with LLM output, tool call output used in shell, missing input length limits.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
      }
    },
    {
      name: "security_owasp_checklist",
      description: "Return the OWASP Top 10 checklist tailored to the project. Use as a manual verification guide after automated scanning.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string — optional, for context"
      }
    },
    {
      name: "security_detect_stack",
      description: "Detect the technology stack of a repository (languages, frameworks, CI/CD, IaC). Useful as a first step before targeted security analysis.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo"
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
        capabilities: ["security-audit.run"],
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
        api.provideCapability("security-audit.run", () => ({ runFullAudit }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        const repoPath = String(args.repoPath || "").trim();

        try {
          let result;

          if (name === "security_audit_full") {
            if (!repoPath) throw new Error("repoPath is required");
            result = await runFullAudit(repoPath);

          } else if (name === "security_scan_git_secrets") {
            if (!repoPath) throw new Error("repoPath is required");
            result = await scanGitSecretsHistory(repoPath, {
              maxCommits: Number(args.maxCommits || 100)
            });

          } else if (name === "security_scan_env_files") {
            if (!repoPath) throw new Error("repoPath is required");
            result = { files: await scanEnvFiles(repoPath) };

          } else if (name === "security_scan_dependencies") {
            if (!repoPath) throw new Error("repoPath is required");
            result = { ecosystems: await scanDependencies(repoPath) };

          } else if (name === "security_analyze_cicd") {
            if (!repoPath) throw new Error("repoPath is required");
            result = { issues: await analyzeciPipeline(repoPath) };

          } else if (name === "security_map_attack_surface") {
            if (!repoPath) throw new Error("repoPath is required");
            result = await mapAttackSurface(repoPath);

          } else if (name === "security_check_llm") {
            if (!repoPath) throw new Error("repoPath is required");
            result = { issues: await checkLlmSecurityPatterns(repoPath) };

          } else if (name === "security_owasp_checklist") {
            result = { checklist: buildOwaspChecklist(repoPath) };

          } else if (name === "security_detect_stack") {
            if (!repoPath) throw new Error("repoPath is required");
            result = await detectStack(repoPath);
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "security audit error") }
          };
        }
      });

      const SECURITY_SENSITIVE_PATTERNS = [
        /\.env($|\.)/i, /secret/i, /credential/i, /private.*key/i,
        /\.pem$/, /\.p12$/, /id_rsa/, /\.htpasswd/,
        /package(-lock)?\.json$/, /yarn\.lock$/, /Gemfile\.lock$/,
        /\.github\/workflows\//i, /Dockerfile/i, /docker-compose/i
      ];
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
          const sensitivePaths = applied
            .map((t) => String(t.target?.path || "").trim())
            .filter((p) => p && SECURITY_SENSITIVE_PATTERNS.some((re) => re.test(p)));
          if (sensitivePaths.length) {
            void api.broadcast?.({
              type: "security.sensitive_files_changed",
              taskId,
              sensitivePaths,
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
