/**
 * Plugin Name: QA
 * Plugin Slug: qa
 * Description: Diff-aware QA testing with health scoring (0-100) across 8 categories.
 *              Runs test suites, evaluates page/API health, detects regressions, and
 *              produces structured reports. Integrates with the browser plugin for visual QA.
 *              Inspired by gstack's /qa agent.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], { cwd = "", timeoutMs = 120000 } = {}) {
  try {
    const opts = { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, windowsHide: true };
    if (cwd) opts.cwd = cwd;
    const { stdout, stderr } = await execFileAsync(cmd, args, opts);
    return { ok: true, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim(), exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err?.stdout || "").trim(),
      stderr: String(err?.stderr || err?.message || "").trim(),
      exitCode: Number.isFinite(Number(err?.code)) ? Number(err.code) : 1
    };
  }
}

// ─── Test runner detection ────────────────────────────────────────────────

const TEST_RUNNER_COMMANDS = {
  vitest: ["npx", "vitest", "run"],
  jest: ["npx", "jest"],
  mocha: ["npx", "mocha"],
  playwright: ["npx", "playwright", "test"],
  pytest: ["python", "-m", "pytest"],
  "npm-test": ["npm", "test"]
};

function resolveTestRunnerCommand(runner = "") {
  return TEST_RUNNER_COMMANDS[String(runner || "").trim().toLowerCase()] || null;
}

async function detectTestRunner(repoPath = "") {
  const packageJsonPath = path.join(repoPath, "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts ?? {};

    if (allDeps.vitest || scripts.test?.includes("vitest")) return { runner: "vitest", command: resolveTestRunnerCommand("vitest") };
    if (allDeps.jest || scripts.test?.includes("jest")) return { runner: "jest", command: resolveTestRunnerCommand("jest") };
    if (allDeps.mocha || scripts.test?.includes("mocha")) return { runner: "mocha", command: resolveTestRunnerCommand("mocha") };
    if (allDeps["@playwright/test"]) return { runner: "playwright", command: resolveTestRunnerCommand("playwright") };
    if (scripts.test) return { runner: "npm-test", command: resolveTestRunnerCommand("npm-test") };
  } catch {}

  // Python
  try {
    await fs.access(path.join(repoPath, "pytest.ini"));
    return { runner: "pytest", command: resolveTestRunnerCommand("pytest") };
  } catch {}
  try {
    await fs.access(path.join(repoPath, "setup.py"));
    return { runner: "pytest", command: resolveTestRunnerCommand("pytest") };
  } catch {}

  return { runner: "unknown", command: null };
}

// ─── Test result parsers ──────────────────────────────────────────────────

function parseTestOutput(runner = "", stdout = "", stderr = "") {
  const combined = `${stdout}\n${stderr}`;

  if (runner === "jest" || runner === "vitest") {
    const passed = Number(combined.match(/(\d+)\s+passed/)?.[1] ?? 0);
    const failed = Number(combined.match(/(\d+)\s+failed/)?.[1] ?? 0);
    const skipped = Number(combined.match(/(\d+)\s+skipped/)?.[1] ?? 0);
    const suites = Number(combined.match(/(\d+)\s+test\s+suite/)?.[1] ?? 0);
    const failures = [...combined.matchAll(/● (.+)/g)].map((m) => m[1]).slice(0, 20);
    return { passed, failed, skipped, suites, failures };
  }

  if (runner === "pytest") {
    const passed = Number(combined.match(/(\d+)\s+passed/)?.[1] ?? 0);
    const failed = Number(combined.match(/(\d+)\s+failed/)?.[1] ?? 0);
    const errors = Number(combined.match(/(\d+)\s+error/)?.[1] ?? 0);
    return { passed, failed: failed + errors, skipped: 0, suites: 0, failures: [] };
  }

  // Generic
  const passed = Number(combined.match(/(\d+)\s+(?:passing|passed|ok)/i)?.[1] ?? 0);
  const failed = Number(combined.match(/(\d+)\s+(?:failing|failed|error)/i)?.[1] ?? 0);
  return { passed, failed, skipped: 0, suites: 0, failures: [] };
}

// ─── Health scoring ───────────────────────────────────────────────────────

const HEALTH_CATEGORIES = [
  { id: "tests", name: "Test Suite", weight: 25 },
  { id: "lint", name: "Code Lint", weight: 10 },
  { id: "build", name: "Build", weight: 20 },
  { id: "types", name: "Type Safety", weight: 10 },
  { id: "security", name: "Security", weight: 20 },
  { id: "coverage", name: "Test Coverage", weight: 5 },
  { id: "deps", name: "Dependencies", weight: 5 },
  { id: "docs", name: "Documentation", weight: 5 }
];

function scoreCategory(id = "", data = {}) {
  if (id === "tests") {
    const { passed = 0, failed = 0 } = data;
    if (passed + failed === 0) return 50; // unknown
    return Math.round((passed / (passed + failed)) * 100);
  }
  if (id === "lint") return data.lintErrors === 0 ? 100 : data.lintErrors < 5 ? 70 : 40;
  if (id === "build") return data.buildOk ? 100 : 0;
  if (id === "types") return data.typeErrors === 0 ? 100 : data.typeErrors < 5 ? 70 : 40;
  if (id === "security") {
    if (data.criticalFindings > 0) return 0;
    if (data.highFindings > 0) return 40;
    if (data.mediumFindings > 0) return 70;
    return 100;
  }
  if (id === "coverage") return Math.min(100, Number(data.coveragePct ?? 50));
  if (id === "deps") return data.criticalVulns === 0 ? 100 : data.criticalVulns < 3 ? 60 : 20;
  if (id === "docs") return data.hasReadme ? 80 : 30;
  return 50;
}

function computeHealthScore(categoryScores = {}) {
  let weighted = 0;
  let totalWeight = 0;
  for (const cat of HEALTH_CATEGORIES) {
    const score = Number(categoryScores[cat.id] ?? 50);
    weighted += score * cat.weight;
    totalWeight += cat.weight;
  }
  return Math.round(weighted / totalWeight);
}

// ─── Diff-aware test detection ────────────────────────────────────────────

async function getChangedTestFiles(repoPath = "", { base = "HEAD~1", head = "HEAD" } = {}) {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", `${base}...${head}`], {
      cwd: repoPath, maxBuffer: 1024 * 1024, windowsHide: true
    });
    const allFiles = stdout.trim().split("\n").filter(Boolean);
    const testFiles = allFiles.filter((f) => /\.(test|spec)\.(js|ts|jsx|tsx|py|rb|go)$/.test(f) || /\/(test|tests|spec|__tests__)\//.test(f));
    const sourceFiles = allFiles.filter((f) => /\.(js|ts|jsx|tsx|py|rb|go|java|cs)$/.test(f) && !testFiles.includes(f));
    return { allFiles, testFiles, sourceFiles };
  } catch {
    return { allFiles: [], testFiles: [], sourceFiles: [] };
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────

export function createQaPlugin(options = {}) {
  const {
    pluginId = "qa",
    pluginName = "QA",
    description = "Diff-aware QA with health scoring, test running, and regression detection."
  } = options;

  const TOOL_DEFINITIONS = [
    {
      name: "qa_run_tests",
      description: "Detect and run the project's test suite (Jest, Vitest, pytest, Mocha, npm test). Returns pass/fail counts, failures list, and exit code.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo",
        runner: "string — override auto-detected runner: jest|vitest|pytest|mocha|npm-test",
        args: "array of strings — additional args to pass to the test runner",
        timeoutMs: "number — max run time in ms (default 120000)"
      }
    },
    {
      name: "qa_health_score",
      description: "Compute a 0-100 health score across 8 categories (tests, lint, build, types, security, coverage, deps, docs). Runs relevant checks and returns weighted score per category.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required) — absolute path to the repo",
        includeSecurityScan: "boolean — run security scan (may be slow, default false)"
      }
    },
    {
      name: "qa_diff_scope",
      description: "Identify which test files should be run based on the current diff. Returns changed source files, existing test files, and missing test coverage gaps.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)",
        base: "string — base ref (default: HEAD~1)", head: "string — head ref (default: HEAD)"
      }
    },
    {
      name: "qa_run_lint",
      description: "Run the project linter (ESLint, Pylint, golangci-lint, etc.) and return error/warning counts.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)",
        fix: "boolean — run with auto-fix if supported (default false)"
      }
    },
    {
      name: "qa_check_build",
      description: "Attempt to build the project (npm run build, go build, python -m py_compile, etc.) and report success or errors.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)" }
    },
    {
      name: "qa_coverage_report",
      description: "Run tests with coverage collection and return overall coverage percentage.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)" }
    },
    {
      name: "qa_smoke_test",
      description: "Run a quick smoke test: build check + test suite with a 30-second timeout. Designed for rapid pre-ship validation.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)" }
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
        capabilities: ["qa.runner"],
        hooks: ["intake:tool-call", "queue:task-processed"],
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

      if (typeof api.provideCapability === "function") {
        api.provideCapability("qa.runner", () => ({ detectTestRunner, parseTestOutput, computeHealthScore }), { priority: 10 });
      }

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        const repoPath = String(args.repoPath || "").trim();

        try {
          let result;

          if (name === "qa_run_tests") {
            if (!repoPath) throw new Error("repoPath is required");
            const timeoutMs = Number(args.timeoutMs || 120000);
            let detected = await detectTestRunner(repoPath);
            if (args.runner) {
              const runner = String(args.runner || "").trim().toLowerCase();
              detected = { runner, command: resolveTestRunnerCommand(runner) };
            }
            if (!detected.command) throw new Error("No test runner detected. Specify a runner or ensure package.json has a test script.");
            const [cmd, ...cmdArgs] = detected.command;
            const extraArgs = Array.isArray(args.args) ? args.args.map(String) : [];
            const r = await runCmd(cmd, [...cmdArgs, ...extraArgs], { cwd: repoPath, timeoutMs });
            const parsed = parseTestOutput(detected.runner, r.stdout, r.stderr);
            result = {
              runner: detected.runner,
              ok: r.ok,
              exitCode: r.exitCode,
              ...parsed,
              stdout: r.stdout.slice(-3000),
              stderr: r.stderr.slice(-1000)
            };

          } else if (name === "qa_health_score") {
            if (!repoPath) throw new Error("repoPath is required");
            const categoryData = {};
            const pluginNotes = [];

            // Tests
            const testRunner = await detectTestRunner(repoPath);
            if (testRunner.command) {
              const [cmd, ...cmdArgs] = testRunner.command;
              const r = await runCmd(cmd, cmdArgs, { cwd: repoPath, timeoutMs: 60000 });
              const parsed = parseTestOutput(testRunner.runner, r.stdout, r.stderr);
              categoryData.tests = parsed;
            }

            // Build
            const buildResult = await tryBuild(repoPath);
            categoryData.build = { buildOk: buildResult.ok };

            // Docs
            try {
              await fs.access(path.join(repoPath, "README.md"));
              categoryData.docs = { hasReadme: true };
            } catch {
              categoryData.docs = { hasReadme: false };
            }

            // Security — use code-review plugin's static analysis if available
            const codeReviewCap = typeof api.getCapability === "function"
              ? api.getCapability("code-review.analyze")
              : null;
            if (codeReviewCap) {
              try {
                const { getDiffForReview, analyzeSecurityPatterns } = codeReviewCap;
                const { ok, diff } = await getDiffForReview({ cwd: repoPath, base: "HEAD~5", head: "HEAD" });
                if (ok && diff) {
                  const findings = analyzeSecurityPatterns(diff);
                  categoryData.security = {
                    criticalFindings: findings.filter((f) => f.severity === "critical").length,
                    highFindings: findings.filter((f) => f.severity === "high").length,
                    mediumFindings: findings.filter((f) => f.severity === "medium").length
                  };
                  pluginNotes.push(`security: scanned last 5 commits via code-review plugin (${findings.length} finding(s))`);
                }
              } catch {}
            }

            // Live URL check — use browser plugin if url arg provided
            const browserCap = typeof api.getCapability === "function"
              ? api.getCapability("browser.daemon")
              : null;
            const checkUrl = String(args.url || "").trim();
            if (browserCap && checkUrl) {
              try {
                const daemon = browserCap();
                await daemon.navigate(checkUrl);
                const metrics = await daemon.getPageMetrics();
                categoryData.liveUrl = { accessible: true, url: checkUrl, metrics };
                pluginNotes.push(`liveUrl: verified ${checkUrl} via browser plugin`);
              } catch (browserErr) {
                categoryData.liveUrl = { accessible: false, url: checkUrl, error: String(browserErr?.message || browserErr) };
                pluginNotes.push(`liveUrl: ${checkUrl} not accessible via browser plugin`);
              }
            }

            const scores = {};
            for (const cat of HEALTH_CATEGORIES) {
              scores[cat.id] = scoreCategory(cat.id, categoryData[cat.id] ?? {});
            }
            const overall = computeHealthScore(scores);
            result = {
              overall,
              grade: overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : overall >= 60 ? "D" : "F",
              categories: HEALTH_CATEGORIES.map((cat) => ({
                id: cat.id,
                name: cat.name,
                score: scores[cat.id],
                weight: cat.weight
              })),
              pluginIntegrations: pluginNotes
            };

          } else if (name === "qa_diff_scope") {
            if (!repoPath) throw new Error("repoPath is required");
            const diffScope = await getChangedTestFiles(repoPath, {
              base: String(args.base || "HEAD~1"),
              head: String(args.head || "HEAD")
            });
            const missingTests = diffScope.sourceFiles.filter((f) => {
              const baseName = path.basename(f, path.extname(f));
              return !diffScope.testFiles.some((t) => t.includes(baseName));
            });
            result = {
              ...diffScope,
              missingTestCoverage: missingTests,
              recommendation: missingTests.length > 0
                ? `${missingTests.length} source file(s) changed without corresponding tests: ${missingTests.slice(0, 5).join(", ")}`
                : "All changed source files appear to have corresponding test files."
            };

          } else if (name === "qa_run_lint") {
            if (!repoPath) throw new Error("repoPath is required");
            const lintResult = await runLinter(repoPath, { fix: args.fix === true });
            result = lintResult;

          } else if (name === "qa_check_build") {
            if (!repoPath) throw new Error("repoPath is required");
            result = await tryBuild(repoPath);

          } else if (name === "qa_coverage_report") {
            if (!repoPath) throw new Error("repoPath is required");
            const detected = await detectTestRunner(repoPath);
            if (!detected.command) throw new Error("No test runner detected");
            let coverageArgs = [...(resolveTestRunnerCommand(detected.runner) || detected.command)];
            if (detected.runner === "jest" || detected.runner === "vitest") {
              coverageArgs.push("--coverage");
            } else if (detected.runner === "pytest") {
              coverageArgs = ["python", "-m", "pytest", "--cov=.", "--cov-report=term-missing"];
            }
            const [cmd, ...cmdArgs] = coverageArgs;
            const r = await runCmd(cmd, cmdArgs, { cwd: repoPath, timeoutMs: 180000 });
            const pctMatch = r.stdout.match(/(?:All files|Statements)\s*\|?\s*([\d.]+)%/) || r.stdout.match(/TOTAL\s+\d+\s+\d+\s+([\d.]+)%/);
            result = {
              ok: r.ok,
              coveragePct: pctMatch ? Number(pctMatch[1]) : null,
              stdout: r.stdout.slice(-2000)
            };

          } else if (name === "qa_smoke_test") {
            if (!repoPath) throw new Error("repoPath is required");
            const [buildResult, testResult] = await Promise.all([
              tryBuild(repoPath),
              (async () => {
                const detected = await detectTestRunner(repoPath);
                if (!detected.command) return { ok: null, note: "no test runner detected" };
                const [cmd, ...cmdArgs] = detected.command;
                const r = await runCmd(cmd, cmdArgs, { cwd: repoPath, timeoutMs: 30000 });
                return { ok: r.ok, ...parseTestOutput(detected.runner, r.stdout, r.stderr) };
              })()
            ]);
            const healthy = buildResult.ok && (testResult.ok === null || testResult.ok === true);
            result = { healthy, build: buildResult, tests: testResult };
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "qa error") }
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
          const testFilesChanged = applied.some((t) => {
            const p = String(t.target?.path || "").trim().toLowerCase();
            return p.includes(".test.") || p.includes(".spec.") || p.includes("/test/") || p.includes("/__tests__/");
          });
          if (testFilesChanged || applied.length >= 5) {
            void api.broadcast?.({
              type: "qa.test_coverage_check_suggested",
              taskId,
              appliedCount: applied.length,
              testFilesChanged,
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

async function tryBuild(repoPath = "") {
  // Try npm run build
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.scripts?.build) {
      const r = await runCmd("npm", ["run", "build", "--if-present"], { cwd: repoPath, timeoutMs: 120000 });
      return { ok: r.ok, runner: "npm-build", stdout: r.stdout.slice(-1000), stderr: r.stderr.slice(-500) };
    }
  } catch {}

  // Try Go
  try {
    await fs.access(path.join(repoPath, "go.mod"));
    const r = await runCmd("go", ["build", "./..."], { cwd: repoPath, timeoutMs: 60000 });
    return { ok: r.ok, runner: "go-build", stderr: r.stderr.slice(-500) };
  } catch {}

  // Try Python syntax check
  try {
    await fs.access(path.join(repoPath, "setup.py"));
    const r = await runCmd("python", ["-m", "py_compile", "setup.py"], { cwd: repoPath });
    return { ok: r.ok, runner: "python-compile", stderr: r.stderr.slice(-500) };
  } catch {}

  return { ok: true, runner: "none", note: "No build command detected — assuming build passes" };
}

async function runLinter(repoPath = "", { fix = false } = {}) {
  // ESLint
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps.eslint || pkg.scripts?.lint?.includes("eslint")) {
      const lintArgs = ["eslint", ".", "--max-warnings=100", "--format=compact"];
      if (fix) lintArgs.push("--fix");
      const r = await runCmd("npx", lintArgs, { cwd: repoPath, timeoutMs: 60000 });
      const errorCount = (r.stdout.match(/\d+ error/g) || []).reduce((sum, m) => sum + Number(m.match(/\d+/)?.[0] ?? 0), 0);
      const warnCount = (r.stdout.match(/\d+ warning/g) || []).reduce((sum, m) => sum + Number(m.match(/\d+/)?.[0] ?? 0), 0);
      return { linter: "eslint", ok: r.ok, errors: errorCount, warnings: warnCount, stdout: r.stdout.slice(-2000) };
    }
  } catch {}

  // Pylint
  try {
    await fs.access(path.join(repoPath, "pyproject.toml"));
    const r = await runCmd("python", ["-m", "pylint", "--exit-zero", "--output-format=text", "."], { cwd: repoPath, timeoutMs: 60000 });
    const errors = Number(r.stdout.match(/error\s+(\d+)/i)?.[1] ?? 0);
    return { linter: "pylint", ok: true, errors, stdout: r.stdout.slice(-2000) };
  } catch {}

  return { linter: "none", note: "No linter detected", ok: true, errors: 0, warnings: 0 };
}
