/**
 * Code review domain — static analysis, diff parsing, pattern detection.
 * Returns structured findings. AI reasoning is left to the calling worker agent.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Security anti-patterns to detect
const SECURITY_PATTERNS = [
  { id: "sql-injection", severity: "critical", pattern: /(\bexec\b|\bexecute\b|\bquery\b)\s*\(.*\+.*(?:req\.|request\.|params\.|body\.|query\.)/gi, description: "Possible SQL injection — string concatenation in query context" },
  { id: "shell-injection", severity: "critical", pattern: /(?:exec|execSync|spawn|spawnSync|child_process)\s*\([^)]*(?:req\.|request\.|params\.|body\.|query\.|\$\{)/gi, description: "Possible shell injection — user input in exec/spawn" },
  { id: "eval-user-input", severity: "critical", pattern: /eval\s*\([^)]*(?:req\.|request\.|params\.|body\.|query\.|input)/gi, description: "eval() with user input — remote code execution risk" },
  { id: "hardcoded-secret", severity: "high", pattern: /(?:password|secret|api_key|apikey|token|private_key)\s*[:=]\s*['"`][^'"`]{8,}/gi, description: "Possible hardcoded secret or credential" },
  { id: "weak-crypto", severity: "high", pattern: /(?:md5|sha1)\s*\(/gi, description: "Weak cryptographic hash (MD5/SHA1) — use SHA-256 or better" },
  { id: "insecure-random", severity: "medium", pattern: /Math\.random\(\)/g, description: "Math.random() is not cryptographically secure — use crypto.randomBytes()" },
  { id: "prototype-pollution", severity: "high", pattern: /Object\.assign\s*\([^,)]+,\s*(?:req\.|request\.|params\.|body\.)/gi, description: "Possible prototype pollution — Object.assign with user input" },
  { id: "xss-innerhtml", severity: "high", pattern: /\.innerHTML\s*=\s*[^;]*(?:req\.|request\.|params\.|body\.|query\.|\$\{)/gi, description: "Possible XSS — innerHTML set with user-controlled data" },
  { id: "path-traversal", severity: "high", pattern: /(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream)\s*\([^)]*(?:req\.|request\.|params\.|body\.|query\.|\.\.\/)/, description: "Possible path traversal — file operations with user input" },
  { id: "missing-auth", severity: "info", pattern: /app\.(?:get|post|put|delete|patch)\s*\(['"\/][^'"]+['"]\s*,\s*(?:async\s*)?\s*\([^)]*\)\s*=>/g, description: "Route registered — confirm auth middleware is applied (may be global or router-level)" },
  { id: "llm-trust-boundary", severity: "medium", pattern: /(?:response|completion|output|result)\.(?:text|content|message)\s*[;,)]/gi, description: "LLM output used directly — validate before trusting in code paths" },
  { id: "cors-wildcard", severity: "medium", pattern: /cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/gi, description: "CORS wildcard origin — restricts to specific origins in production" }
];

// Code quality patterns
const QUALITY_PATTERNS = [
  { id: "async-sync-mix", severity: "warning", pattern: /(?:readFileSync|writeFileSync|execSync|spawnSync)\s*\(/g, description: "Synchronous I/O in what may be an async context" },
  { id: "loose-equality", severity: "warning", pattern: /[^!=<>!]==[^=]/g, description: "Loose equality (==) — prefer strict equality (===)" },
  { id: "console-log", severity: "info", pattern: /console\.(log|warn|error)\s*\(/g, description: "console.log/warn/error — consider structured logging" },
  { id: "todo-fixme", severity: "info", pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX)\b/gi, description: "TODO/FIXME comment — may indicate incomplete implementation" },
  { id: "magic-number", severity: "info", pattern: /(?<![.\w])\d{4,}(?![.\w])/g, description: "Magic number — consider extracting to a named constant" },
  { id: "callback-hell", severity: "warning", pattern: /\)\s*\{\s*\n(?:\s*[^\n]+\n){0,3}\s+\w+\s*\([^)]*function\s*\(/g, description: "Nested callbacks — consider async/await refactoring" },
  { id: "any-type", severity: "warning", pattern: /:\s*any\b/g, description: "TypeScript 'any' type — use specific types for type safety" },
  { id: "empty-catch", severity: "warning", pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g, description: "Empty catch block — errors are silently swallowed" }
];

async function runGit(cwd = "", args = []) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    return { ok: true, output: stdout };
  } catch (error) {
    return { ok: false, output: String(error?.stderr || error?.stdout || error?.message || "") };
  }
}

function detectPatternsInText(text = "", patterns = []) {
  const findings = [];
  for (const p of patterns) {
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) {
      findings.push({
        id: p.id,
        severity: p.severity,
        description: p.description,
        occurrences: matches.length,
        samples: matches.slice(0, 3).map((m) => m[0].slice(0, 120).trim())
      });
    }
  }
  return findings;
}

function parseDiffStats(diffText = "") {
  const lines = diffText.split("\n");
  const files = [];
  let currentFile = null;
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentFile) files.push(currentFile);
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = { path: match?.[2] ?? "", added: 0, removed: 0, hunks: 0 };
    } else if (line.startsWith("+++ b/")) {
      if (currentFile) currentFile.path = line.slice(6).trim();
    } else if (line.startsWith("@@")) {
      if (currentFile) currentFile.hunks++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      if (currentFile) currentFile.added++;
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      if (currentFile) currentFile.removed++;
      removed++;
    }
  }
  if (currentFile) files.push(currentFile);
  return { files, totalAdded: added, totalRemoved: removed, totalFiles: files.length };
}

function categorizeFiles(filePaths = []) {
  const categories = {
    source: [], tests: [], config: [], docs: [], migrations: [], assets: []
  };
  for (const filePath of filePaths) {
    const lower = filePath.toLowerCase();
    if (/\.(test|spec)\.(js|ts|jsx|tsx|py|rb|go|java)$/.test(lower)) {
      categories.tests.push(filePath);
    } else if (/\/(test|tests|spec|__tests__)\//.test(lower)) {
      categories.tests.push(filePath);
    } else if (/\.(json|yaml|yml|toml|ini|env|config\.[^/]+)$/.test(lower)) {
      categories.config.push(filePath);
    } else if (/\.(md|txt|rst|adoc)$/.test(lower)) {
      categories.docs.push(filePath);
    } else if (/\/migrations?\//.test(lower) || /\d{14}.*\.(js|ts|sql|rb)$/.test(lower)) {
      categories.migrations.push(filePath);
    } else if (/\.(png|jpg|jpeg|gif|svg|ico|woff|ttf|eot)$/.test(lower)) {
      categories.assets.push(filePath);
    } else {
      categories.source.push(filePath);
    }
  }
  return categories;
}

export function computeRiskLevel(securityFindings = [], qualityFindings = []) {
  if (securityFindings.some((f) => f.severity === "critical")) return "critical";
  if (securityFindings.some((f) => f.severity === "high")) return "high";
  if (securityFindings.some((f) => f.severity === "medium")) return "medium";
  if (qualityFindings.some((f) => f.severity === "warning")) return "low";
  return "clean";
}

export async function getDiffForReview({ cwd = "", base = "HEAD~1", head = "HEAD", filePaths = [] } = {}) {
  const args = ["diff", `${base}...${head}`, "--unified=3"];
  if (filePaths.length) args.push("--", ...filePaths);

  const diff = await runGit(cwd, args);
  if (!diff.ok) return { ok: false, error: diff.output, diff: "" };

  const stats = parseDiffStats(diff.output);
  return { ok: true, diff: diff.output, stats };
}

export async function getRecentCommits({ cwd = "", count = 10 } = {}) {
  const log = await runGit(cwd, ["log", `--oneline`, `-${count}`]);
  return log.ok ? log.output.trim().split("\n").filter(Boolean) : [];
}

export async function getCurrentBranch({ cwd = "" } = {}) {
  const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.ok ? result.output.trim() : "unknown";
}

export async function getStagedDiff({ cwd = "" } = {}) {
  const diff = await runGit(cwd, ["diff", "--staged", "--unified=3"]);
  if (!diff.ok) return { ok: false, error: diff.output, diff: "" };
  const stats = parseDiffStats(diff.output);
  return { ok: true, diff: diff.output, stats };
}

export function analyzeSecurityPatterns(diffOrCode = "") {
  return detectPatternsInText(diffOrCode, SECURITY_PATTERNS);
}

export function analyzeQualityPatterns(diffOrCode = "") {
  return detectPatternsInText(diffOrCode, QUALITY_PATTERNS);
}

export function buildReviewReport({ diff = "", stats = {}, securityFindings = [], qualityFindings = [] } = {}) {
  const criticalCount = securityFindings.filter((f) => f.severity === "critical").length;
  const highCount = securityFindings.filter((f) => f.severity === "high").length;
  const mediumCount = securityFindings.filter((f) => f.severity === "medium").length;
  const warningCount = qualityFindings.filter((f) => f.severity === "warning").length;

  const riskScore = criticalCount * 40 + highCount * 20 + mediumCount * 10 + warningCount * 5;
  const riskLevel = riskScore >= 40 ? "critical" : riskScore >= 20 ? "high" : riskScore >= 10 ? "medium" : riskScore > 0 ? "low" : "clean";

  const fileCategories = categorizeFiles((stats.files ?? []).map((f) => f.path));
  const testCoverage = fileCategories.source.length > 0
    ? Math.round((fileCategories.tests.length / (fileCategories.source.length + fileCategories.tests.length)) * 100)
    : null;

  return {
    summary: {
      riskLevel,
      riskScore,
      filesChanged: stats.totalFiles ?? 0,
      linesAdded: stats.totalAdded ?? 0,
      linesRemoved: stats.totalRemoved ?? 0,
      criticalIssues: criticalCount,
      highIssues: highCount,
      mediumIssues: mediumCount,
      qualityWarnings: warningCount,
      testFilesChanged: fileCategories.tests.length,
      estimatedTestCoverageOfDiff: testCoverage !== null ? `${testCoverage}%` : "unknown"
    },
    fileBreakdown: {
      source: fileCategories.source,
      tests: fileCategories.tests,
      config: fileCategories.config,
      docs: fileCategories.docs,
      migrations: fileCategories.migrations
    },
    securityFindings,
    qualityFindings,
    checklist: buildReviewChecklist(securityFindings, qualityFindings, fileCategories)
  };
}

function buildReviewChecklist(securityFindings = [], qualityFindings = [], fileCategories = {}) {
  const items = [];

  if (securityFindings.some((f) => f.id === "sql-injection")) items.push({ priority: "critical", check: "Verify all database queries use parameterized statements, not string concatenation" });
  if (securityFindings.some((f) => f.id === "shell-injection")) items.push({ priority: "critical", check: "Sanitize all inputs passed to child_process exec/spawn" });
  if (securityFindings.some((f) => f.id === "hardcoded-secret")) items.push({ priority: "critical", check: "Move hardcoded secrets to environment variables or a secrets manager" });
  if (securityFindings.some((f) => f.id === "xss-innerhtml")) items.push({ priority: "high", check: "Replace innerHTML with textContent or use a sanitization library (DOMPurify)" });
  if (securityFindings.some((f) => f.id === "path-traversal")) items.push({ priority: "high", check: "Validate and normalize file paths — restrict to allowed directories" });
  if (securityFindings.some((f) => f.id === "weak-crypto")) items.push({ priority: "high", check: "Replace MD5/SHA1 with SHA-256 or bcrypt for password hashing" });
  if (securityFindings.some((f) => f.id === "missing-auth")) items.push({ priority: "medium", check: "Confirm all new routes have appropriate authentication middleware" });

  if (qualityFindings.some((f) => f.id === "empty-catch")) items.push({ priority: "medium", check: "Empty catch blocks swallow errors — add logging or re-throw" });
  if (qualityFindings.some((f) => f.id === "async-sync-mix")) items.push({ priority: "medium", check: "Synchronous I/O can block the event loop — prefer async alternatives" });

  if (fileCategories.migrations?.length > 0) items.push({ priority: "high", check: "Database migrations detected — ensure they are reversible and tested" });
  if (fileCategories.source.length > 0 && fileCategories.tests.length === 0) {
    items.push({ priority: "medium", check: "Source changes without corresponding test changes — consider adding tests" });
  }

  items.push({ priority: "info", check: "Verify the diff implements exactly what was planned — no scope drift" });
  items.push({ priority: "info", check: "Confirm no debug/temporary code was accidentally included" });

  return items;
}
