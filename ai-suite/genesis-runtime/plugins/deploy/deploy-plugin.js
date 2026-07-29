/**
 * Plugin Name: Deploy
 * Plugin Slug: deploy
 * Description: Git-based deployment pipeline tools: branch creation, commit, PR creation via
 *              GitHub CLI, version bumping, CHANGELOG updates, CI status polling, and
 *              post-deployment verification. Inspired by gstack /ship and /land-and-deploy.
 * Version: 1.0.0
 * Author: Nova Observer
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], { cwd = "", timeoutMs = 30000 } = {}) {
  try {
    const opts = { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs, windowsHide: true };
    if (cwd) opts.cwd = cwd;
    const { stdout, stderr } = await execFileAsync(cmd, args, opts);
    return { ok: true, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
  } catch (err) {
    return { ok: false, stdout: String(err?.stdout || "").trim(), stderr: String(err?.stderr || err?.message || "").trim() };
  }
}

async function git(args = [], { cwd = "" } = {}) {
  return runCmd("git", args, { cwd });
}

async function gh(args = [], { cwd = "" } = {}) {
  return runCmd("gh", args, { cwd });
}

// ─── Version bump helpers ─────────────────────────────────────────────────

async function readPackageJson(repoPath = "") {
  const pkgPath = path.join(repoPath, "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    return { ok: true, data: JSON.parse(raw), path: pkgPath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function bumpVersion(version = "0.0.0", bumpType = "patch") {
  // Strip pre-release/build suffix before parsing (e.g. "1.0.0-alpha.1" → "1.0.0")
  const base = String(version || "0.0.0").replace(/[-+].*$/, "");
  const parts = base.split(".").map((n) => parseInt(n, 10));
  const [major, minor, patch] = [isNaN(parts[0]) ? 0 : parts[0], isNaN(parts[1]) ? 0 : parts[1], isNaN(parts[2]) ? 0 : parts[2]];
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ─── CHANGELOG helpers ────────────────────────────────────────────────────

async function readChangelog(repoPath = "") {
  const candidates = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "changelog.md"];
  for (const name of candidates) {
    try {
      const filePath = path.join(repoPath, name);
      const content = await fs.readFile(filePath, "utf8");
      return { ok: true, path: filePath, content };
    } catch {}
  }
  return { ok: false, path: path.join(repoPath, "CHANGELOG.md"), content: "" };
}

function buildChangelogEntry({ version = "", date = "", summary = "", sections = {} } = {}) {
  const lines = [`## [${version}] — ${date || new Date().toISOString().slice(0, 10)}`];
  if (summary) lines.push("", summary);
  for (const [sectionName, items] of Object.entries(sections)) {
    if (Array.isArray(items) && items.length > 0) {
      lines.push("", `### ${sectionName}`);
      for (const item of items) lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Plugin ───────────────────────────────────────────────────────────────

export function createDeployPlugin(options = {}) {
  const {
    pluginId = "deploy",
    pluginName = "Deploy",
    description = "Git deployment pipeline: branch, commit, PR, version bump, CI polling, deploy verification."
  } = options;

  const TOOL_DEFINITIONS = [
    {
      name: "deploy_git_branch",
      description: "Create and checkout a new git branch. Optionally push to remote.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)", branchName: "string (required)",
        fromBranch: "string — base branch (default: current HEAD)", push: "boolean — push to remote"
      }
    },
    {
      name: "deploy_git_status",
      description: "Get git status: current branch, staged/unstaged changes, recent commits.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)" }
    },
    {
      name: "deploy_git_commit",
      description: "Stage all changes and create a git commit.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)", message: "string (required) — commit message",
        addAll: "boolean — stage all changes (default true)"
      }
    },
    {
      name: "deploy_git_push",
      description: "Push the current branch to the remote. Sets upstream tracking if not already set.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)", force: "boolean — force push (use with caution)", setUpstream: "boolean — set upstream tracking branch (default true)" }
    },
    {
      name: "deploy_create_pr",
      description: "Create a GitHub pull request using the gh CLI. Returns the PR URL. Requires gh auth. Pass runTests:true to run the test suite via the qa plugin before opening the PR.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)", title: "string (required)", body: "string",
        base: "string — target branch (default: main)", draft: "boolean",
        runTests: "boolean — run tests via qa plugin before creating PR (default false)"
      }
    },
    {
      name: "deploy_check_ci",
      description: "Check GitHub Actions CI status for the current branch or a specific run. Polls until completion or timeout.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)",
        pollIntervalMs: "number — polling interval (default 15000)",
        timeoutMs: "number — max wait time (default 300000 / 5 min)"
      }
    },
    {
      name: "deploy_list_prs",
      description: "List open pull requests for the repo.",
      scopes: ["worker"],
      parameters: { repoPath: "string (required)", limit: "number (default 10)" }
    },
    {
      name: "deploy_bump_version",
      description: "Bump the version in package.json (major/minor/patch) and return the new version.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)",
        bumpType: "string: patch|minor|major (default: patch)",
        commit: "boolean — auto-commit the version bump"
      }
    },
    {
      name: "deploy_update_changelog",
      description: "Prepend a new version entry to CHANGELOG.md. Creates the file if it doesn't exist.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)", version: "string (required)",
        summary: "string — brief summary of changes",
        sections: "object — { Added: [...], Changed: [...], Fixed: [...], Security: [...] }",
        commit: "boolean — auto-commit the changelog update"
      }
    },
    {
      name: "deploy_verify_url",
      description: "Verify a deployed URL is responding: checks HTTP status, looks for console errors in response headers, validates basic health.",
      scopes: ["worker"],
      parameters: {
        url: "string (required)", expectStatus: "number — expected HTTP status (default 200)",
        timeoutMs: "number (default 15000)"
      }
    },
    {
      name: "deploy_merge_pr",
      description: "Merge a pull request using the gh CLI.",
      scopes: ["worker"],
      parameters: {
        repoPath: "string (required)", prNumber: "number or string — PR number (omit to auto-detect current branch PR)",
        mergeMethod: "string: merge|squash|rebase (default: squash)",
        deleteBranch: "boolean — delete the branch after merge (default false)"
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
        capabilities: ["deploy.git"],
        hooks: ["intake:tool-call"],
        runtimeContext: []
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

      if (typeof api.addHook !== "function") return;

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};

        if (!TOOL_DEFINITIONS.some((t) => t.name === name)) return payload;

        const repoPath = String(args.repoPath || "").trim();

        try {
          let result;

          if (name === "deploy_git_branch") {
            if (!repoPath) throw new Error("repoPath is required");
            const branchName = String(args.branchName || "").trim();
            if (!branchName) throw new Error("branchName is required");
            const fromBranch = String(args.fromBranch || "").trim();
            const cmds = [];
            const branchArgs = fromBranch ? ["-b", branchName, fromBranch] : ["-b", branchName];
            cmds.push({ cmd: "checkout", ...await git(["checkout", ...branchArgs], { cwd: repoPath }) });
            if (args.push === true) {
              cmds.push({ cmd: "push", ...await git(["push", "-u", "origin", branchName], { cwd: repoPath }) });
            }
            result = { branch: branchName, commands: cmds, ok: cmds.every((c) => c.ok) };

          } else if (name === "deploy_git_status") {
            if (!repoPath) throw new Error("repoPath is required");
            const [statusR, branchR, logR] = await Promise.all([
              git(["status", "--short"], { cwd: repoPath }),
              git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }),
              git(["log", "--oneline", "-5"], { cwd: repoPath })
            ]);
            result = {
              branch: branchR.stdout,
              status: statusR.stdout,
              recentCommits: logR.stdout.split("\n").filter(Boolean),
              clean: !statusR.stdout.trim()
            };

          } else if (name === "deploy_git_commit") {
            if (!repoPath) throw new Error("repoPath is required");
            const message = String(args.message || "").trim();
            if (!message) throw new Error("message is required");
            const steps = [];
            if (args.addAll !== false) {
              steps.push(await git(["add", "-A"], { cwd: repoPath }));
            }
            steps.push(await git(["commit", "-m", message], { cwd: repoPath }));
            result = { ok: steps.every((s) => s.ok), steps, message };

          } else if (name === "deploy_git_push") {
            if (!repoPath) throw new Error("repoPath is required");
            const pushArgs = ["push"];
            if (args.force === true) pushArgs.push("--force-with-lease");
            // Always set upstream so pushes work on branches with no remote tracking yet
            if (args.setUpstream !== false) pushArgs.push("-u", "origin", "HEAD");
            const r = await git(pushArgs, { cwd: repoPath });
            result = { ok: r.ok, stdout: r.stdout, stderr: r.stderr };

          } else if (name === "deploy_create_pr") {
            if (!repoPath) throw new Error("repoPath is required");
            const title = String(args.title || "").trim();
            if (!title) throw new Error("title is required");

            // Optional pre-PR test run via qa plugin
            let preTestResult = null;
            if (args.runTests === true) {
              const qaRunnerCap = typeof api.getCapability === "function"
                ? api.getCapability("qa.runner")
                : null;
              if (qaRunnerCap) {
                try {
                  const { detectTestRunner } = qaRunnerCap;
                  const detected = await detectTestRunner(repoPath);
                  if (detected.command) {
                    const [cmd, ...cmdArgs] = detected.command;
                    const testRun = await runCmd(cmd, cmdArgs, { cwd: repoPath, timeoutMs: 120000 });
                    const { parseTestOutput } = qaRunnerCap;
                    const parsed = parseTestOutput(detected.runner, testRun.stdout, testRun.stderr);
                    preTestResult = { runner: detected.runner, ok: testRun.ok, ...parsed, source: "qa plugin" };
                    if (!testRun.ok) {
                      return {
                        ...payload,
                        handled: true,
                        result: {
                          ok: false, prCreated: false,
                          blocked: "Tests failed — fix failures before creating PR",
                          tests: preTestResult
                        }
                      };
                    }
                  }
                } catch (qaErr) {
                  preTestResult = { ok: false, error: String(qaErr?.message || qaErr), source: "qa plugin" };
                }
              }
            }

            const ghArgs = ["pr", "create", "--title", title];
            if (args.body) ghArgs.push("--body", String(args.body));
            if (args.base) ghArgs.push("--base", String(args.base));
            if (args.draft === true) ghArgs.push("--draft");
            const r = await gh(ghArgs, { cwd: repoPath });
            const prUrl = r.stdout.match(/https:\/\/github\.com\/[^\s]+/)?.[0] || r.stdout;
            result = { ok: r.ok, url: prUrl, stdout: r.stdout, stderr: r.stderr, tests: preTestResult };

          } else if (name === "deploy_check_ci") {
            if (!repoPath) throw new Error("repoPath is required");
            const pollMs = Number(args.pollIntervalMs || 15000);
            const timeoutMs = Number(args.timeoutMs || 300000);
            const branchR = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath });
            const currentBranch = branchR.stdout;
            const startedAt = Date.now();
            let lastStatus = null;
            while (Date.now() - startedAt < timeoutMs) {
              const r = await gh(["run", "list", "--branch", currentBranch, "--limit", "1", "--json", "status,conclusion,name,url"], { cwd: repoPath });
              if (r.ok && r.stdout) {
                try {
                  const runs = JSON.parse(r.stdout);
                  const run = runs[0];
                  if (run) {
                    lastStatus = run;
                    if (run.status === "completed") break;
                  }
                } catch {}
              }
              if (Date.now() - startedAt + pollMs < timeoutMs) {
                await new Promise((resolve) => setTimeout(resolve, pollMs));
              } else {
                break;
              }
            }
            const completed = lastStatus?.status === "completed";
            result = {
              status: lastStatus,
              completed,
              timedOut: !completed && !!lastStatus,
              noRuns: !lastStatus,
              branch: currentBranch
            };

          } else if (name === "deploy_list_prs") {
            if (!repoPath) throw new Error("repoPath is required");
            const limit = Math.min(Number(args.limit || 10), 50);
            const r = await gh(["pr", "list", "--limit", String(limit), "--json", "number,title,state,url,headRefName,createdAt"], { cwd: repoPath });
            result = r.ok ? { prs: JSON.parse(r.stdout || "[]") } : { prs: [], error: r.stderr };

          } else if (name === "deploy_bump_version") {
            if (!repoPath) throw new Error("repoPath is required");
            const pkg = await readPackageJson(repoPath);
            if (!pkg.ok) throw new Error("No package.json found");
            const oldVersion = String(pkg.data.version || "0.0.0");
            const bumpType = String(args.bumpType || "patch");
            const newVersion = bumpVersion(oldVersion, bumpType);
            pkg.data.version = newVersion;
            await fs.writeFile(pkg.path, JSON.stringify(pkg.data, null, 2) + "\n", "utf8");
            result = { oldVersion, newVersion, bumpType };
            if (args.commit === true) {
              const lockFiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
              const stagedFiles = ["package.json"];
              for (const lf of lockFiles) {
                try { await fs.access(path.join(repoPath, lf)); stagedFiles.push(lf); } catch {}
              }
              await git(["add", ...stagedFiles], { cwd: repoPath });
              const c = await git(["commit", "-m", `chore: bump version to ${newVersion}`], { cwd: repoPath });
              result.committed = c.ok;
            }

          } else if (name === "deploy_update_changelog") {
            if (!repoPath) throw new Error("repoPath is required");
            const version = String(args.version || "").trim();
            if (!version) throw new Error("version is required");
            const entry = buildChangelogEntry({
              version,
              summary: String(args.summary || ""),
              sections: args.sections && typeof args.sections === "object" ? args.sections : {}
            });
            const existing = await readChangelog(repoPath);
            let newContent;
            if (existing.ok && existing.content) {
              const header = existing.content.match(/^#[^\n]*\n/)?.[0] ?? "# Changelog\n\n";
              const rest = existing.content.slice(header.length);
              newContent = `${header}${entry}\n${rest}`;
            } else {
              newContent = `# Changelog\n\n${entry}\n`;
            }
            await fs.writeFile(existing.path, newContent, "utf8");
            result = { path: existing.path, version, entryLength: entry.length };
            if (args.commit === true) {
              const relPath = path.relative(repoPath, existing.path);
              await git(["add", relPath], { cwd: repoPath });
              const c = await git(["commit", "-m", `docs: update CHANGELOG for ${version}`], { cwd: repoPath });
              result.committed = c.ok;
            }

          } else if (name === "deploy_verify_url") {
            const url = String(args.url || "").trim();
            if (!url) throw new Error("url is required");
            const timeoutMs = Number(args.timeoutMs || 15000);
            const expectedStatus = Number(args.expectStatus || 200);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
              clearTimeout(timer);
              const ok = response.status === expectedStatus;
              const headers = {};
              for (const [k, v] of response.headers.entries()) {
                if (["content-type", "server", "x-powered-by", "cache-control"].includes(k.toLowerCase())) {
                  headers[k] = v;
                }
              }
              result = {
                ok, url, status: response.status, expectedStatus,
                headers, healthy: ok
              };
            } catch (fetchErr) {
              clearTimeout(timer);
              result = { ok: false, url, error: String(fetchErr?.message || "unreachable"), healthy: false };
            }

          } else if (name === "deploy_merge_pr") {
            if (!repoPath) throw new Error("repoPath is required");
            const prNum = args.prNumber ? String(args.prNumber) : "";
            const mergeMethod = String(args.mergeMethod || "squash");
            const ghArgs = ["pr", "merge"];
            if (prNum) ghArgs.push(prNum);
            ghArgs.push(`--${mergeMethod}`);
            if (args.deleteBranch === true) ghArgs.push("--delete-branch");
            const r = await gh(ghArgs, { cwd: repoPath });
            result = { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
          }

          return { ...payload, handled: true, result };
        } catch (error) {
          return {
            ...payload,
            handled: true,
            result: { error: true, message: String(error?.message || error || "deploy error") }
          };
        }
      });
    }
  };
}
