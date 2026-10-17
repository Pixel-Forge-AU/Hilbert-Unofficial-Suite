/**
 * Security audit domain — multi-phase security scanning.
 * Covers: secrets archaeology, dependency scanning, attack surface mapping,
 * OWASP Top 10 pattern detection, CI/CD analysis, LLM trust boundary checks.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function runCmd(cmd, args = [], { cwd = "", timeoutMs = 30000 } = {}) {
  try {
    const opts = { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, windowsHide: true };
    if (cwd) opts.cwd = cwd;
    const { stdout, stderr } = await execFileAsync(cmd, args, opts);
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (err) {
    return { ok: false, stdout: String(err?.stdout || ""), stderr: String(err?.stderr || err?.message || "") };
  }
}

// ─── Phase 1: Stack detection ──────────────────────────────────────────────

export async function detectStack(repoPath = "") {
  const checks = [
    { file: "package.json", stack: "Node.js/JavaScript" },
    { file: "pyproject.toml", stack: "Python" },
    { file: "requirements.txt", stack: "Python" },
    { file: "Cargo.toml", stack: "Rust" },
    { file: "go.mod", stack: "Go" },
    { file: "pom.xml", stack: "Java/Maven" },
    { file: "build.gradle", stack: "Java/Gradle" },
    { file: "Gemfile", stack: "Ruby" },
    { file: "composer.json", stack: "PHP" },
    { file: "*.csproj", stack: ".NET" },
    { file: "Dockerfile", stack: "Docker" },
    { file: "docker-compose.yml", stack: "Docker Compose" },
    { file: ".github/workflows", stack: "GitHub Actions CI/CD" },
    { file: ".gitlab-ci.yml", stack: "GitLab CI/CD" },
    { file: "Jenkinsfile", stack: "Jenkins CI/CD" },
    { file: "terraform", stack: "Terraform IaC" },
    { file: "kubernetes", stack: "Kubernetes" }
  ];

  const detected = [];
  await Promise.all(checks.map(async ({ file, stack }) => {
    try {
      const target = path.join(repoPath, file.replace("*", "**"));
      await fs.access(target);
      detected.push(stack);
    } catch {}
  }));
  return { stacks: [...new Set(detected)] };
}

// ─── Phase 2: Secrets archaeology (git history) ────────────────────────────

const SECRET_PATTERNS_GIT = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Key", pattern: /[0-9a-zA-Z/+]{40}/g },
  { name: "Private Key PEM", pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: "GitHub Token", pattern: /(?:ghp_|ghs_|ghu_|github_pat_)[a-zA-Z0-9_]{20,}/g },
  { name: "Slack Token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "Stripe Key", pattern: /(?:sk_live_|pk_live_)[a-zA-Z0-9]{20,}/g },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "JWT Token", pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: "Database URL with credentials", pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/gi },
  { name: "Hardcoded password assignment", pattern: /(?:password|passwd|pwd)\s*=\s*['"][^'"]{6,}['"]/gi }
];

export async function scanGitSecretsHistory(repoPath = "", { maxCommits = 100 } = {}) {
  const result = await runCmd("git", ["log", `--oneline`, `-${maxCommits}`, "--all"], { cwd: repoPath });
  if (!result.ok) return { ok: false, error: "Not a git repo or git unavailable", findings: [] };

  // Get full diff log for scanning
  const diffResult = await runCmd("git", ["log", "-p", `--max-count=${Math.min(maxCommits, 50)}`, "--all"], { cwd: repoPath, timeoutMs: 60000 });
  const text = diffResult.stdout || "";

  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS_GIT) {
    const re = new RegExp(pattern.source, pattern.flags);
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) {
      findings.push({
        type: name,
        severity: name.includes("Private Key") || name.includes("AWS") ? "critical" : "high",
        occurrences: matches.length,
        note: "Found in git history — may require history rewrite (git-filter-repo) and credential rotation"
      });
    }
  }

  return { ok: true, findings, commitsScanned: result.stdout.split("\n").filter(Boolean).length };
}

// ─── Phase 3: .env and config file scanning ────────────────────────────────

export async function scanEnvFiles(repoPath = "") {
  const sensitivePatterns = [
    /(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|CREDENTIALS)\s*=\s*\S+/gi
  ];

  const envFiles = [];
  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (/^\.env(\..+)?$/.test(entry.name) || /\.(env|config)$/.test(entry.name)) {
          envFiles.push(fullPath);
        }
      }
    } catch {}
  }
  await walk(repoPath);

  const findings = [];
  for (const filePath of envFiles) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const relPath = path.relative(repoPath, filePath);
      const secretLines = [];
      for (const pattern of sensitivePatterns) {
        const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags))];
        for (const match of matches) {
          const key = match[0].split("=")[0].trim();
          if (!match[0].includes("EXAMPLE") && !match[0].includes("YOUR_") && !match[0].includes("placeholder")) {
            secretLines.push(key);
          }
        }
      }
      findings.push({
        file: relPath,
        isTracked: await isGitTracked(repoPath, relPath),
        potentialSecrets: secretLines,
        recommendation: secretLines.length > 0
          ? "Verify this file is in .gitignore and not committed to the repository"
          : "Appears clean"
      });
    } catch {}
  }
  return findings;
}

async function isGitTracked(repoPath = "", filePath = "") {
  const result = await runCmd("git", ["ls-files", "--error-unmatch", filePath], { cwd: repoPath });
  return result.ok;
}

// ─── Phase 4: Dependency vulnerability scanning ────────────────────────────

export async function scanDependencies(repoPath = "") {
  const findings = [];

  // Node.js — npm audit
  const packageJsonPath = path.join(repoPath, "package.json");
  try {
    await fs.access(packageJsonPath);
    const auditResult = await runCmd("npm", ["audit", "--json"], { cwd: repoPath, timeoutMs: 60000 });
    if (auditResult.stdout) {
      try {
        const audit = JSON.parse(auditResult.stdout);
        const vulns = audit?.vulnerabilities ?? audit?.advisories ?? {};
        const criticalCount = Object.values(vulns).filter((v) => v.severity === "critical").length;
        const highCount = Object.values(vulns).filter((v) => v.severity === "high").length;
        findings.push({
          ecosystem: "npm",
          vulnerabilities: Object.keys(vulns).length,
          critical: criticalCount,
          high: highCount,
          raw: Object.values(vulns).slice(0, 10).map((v) => ({
            name: v.name,
            severity: v.severity,
            via: Array.isArray(v.via) ? v.via.filter((x) => typeof x === "string") : []
          }))
        });
      } catch {
        findings.push({ ecosystem: "npm", note: "npm audit output could not be parsed" });
      }
    }
  } catch {}

  // Python — check for safety (pip-audit)
  const requirementsPath = path.join(repoPath, "requirements.txt");
  try {
    await fs.access(requirementsPath);
    const safetyResult = await runCmd("pip-audit", ["--requirement", "requirements.txt", "--format=json"], { cwd: repoPath, timeoutMs: 60000 });
    if (safetyResult.ok && safetyResult.stdout) {
      try {
        const audit = JSON.parse(safetyResult.stdout);
        findings.push({ ecosystem: "pip", vulnerabilities: Array.isArray(audit) ? audit.length : 0, raw: (Array.isArray(audit) ? audit : []).slice(0, 10) });
      } catch {}
    }
  } catch {}

  return findings;
}

// ─── Phase 5: CI/CD pipeline analysis ─────────────────────────────────────

export async function analyzeciPipeline(repoPath = "") {
  const issues = [];
  const ciPaths = [
    ".github/workflows",
    ".gitlab-ci.yml",
    "Jenkinsfile",
    ".circleci/config.yml",
    "bitbucket-pipelines.yml"
  ];

  for (const ciPath of ciPaths) {
    const fullPath = path.join(repoPath, ciPath);
    try {
      const stat = await fs.stat(fullPath);
      let content = "";
      if (stat.isDirectory()) {
        const files = await fs.readdir(fullPath);
        for (const file of files) {
          content += await fs.readFile(path.join(fullPath, file), "utf8").catch(() => "");
        }
      } else {
        content = await fs.readFile(fullPath, "utf8");
      }

      if (/\$\{\{.*?github\.event\..*?\}\}/g.test(content)) {
        issues.push({ file: ciPath, severity: "high", issue: "GitHub Actions: user-controlled event data used in workflow expressions — possible script injection" });
      }
      if (/on:\s*\n\s*pull_request_target/g.test(content)) {
        issues.push({ file: ciPath, severity: "high", issue: "pull_request_target with code checkout is dangerous — can give untrusted PRs access to secrets" });
      }
      if (/secrets\.\w+/g.test(content) && !/permissions:/g.test(content)) {
        issues.push({ file: ciPath, severity: "medium", issue: "Workflow uses secrets but no permissions block defined — consider principle of least privilege" });
      }
      if (/curl.*\|.*sh|wget.*\|.*sh/gi.test(content)) {
        issues.push({ file: ciPath, severity: "medium", issue: "Pipe-to-shell pattern detected in CI — supply chain risk if source is not pinned" });
      }
      if (!/uses:.*@[a-f0-9]{40}/g.test(content) && /uses:/g.test(content)) {
        issues.push({ file: ciPath, severity: "medium", issue: "GitHub Actions uses tags not SHA pins — consider pinning to commit SHA for supply chain security" });
      }
    } catch {}
  }
  return issues;
}

// ─── Phase 6: OWASP Top 10 checklist ──────────────────────────────────────

export function buildOwaspChecklist(repoPath = "") {
  return [
    { id: "A01", name: "Broken Access Control", check: "Verify authorization checks on all routes/resources; check for IDOR patterns; ensure principle of least privilege" },
    { id: "A02", name: "Cryptographic Failures", check: "Audit TLS configuration; verify sensitive data encryption at rest and in transit; check for weak algorithms" },
    { id: "A03", name: "Injection", check: "Parameterized queries for all DB access; input validation/sanitization; scan with review_diff for injection patterns" },
    { id: "A04", name: "Insecure Design", check: "Threat modeling for new features; verify trust boundaries; check for business logic flaws" },
    { id: "A05", name: "Security Misconfiguration", check: "Default credentials changed; debug endpoints disabled in production; security headers set; CORS configured" },
    { id: "A06", name: "Vulnerable Components", check: "Run scan_dependencies for known CVEs; audit dependency age; monitor for new vulnerabilities" },
    { id: "A07", name: "Identification & Auth Failures", check: "MFA support; brute-force protection; secure session management; password complexity/hashing" },
    { id: "A08", name: "Software & Data Integrity", check: "Verify CI/CD pipeline integrity; review third-party dependencies; check serialization/deserialization" },
    { id: "A09", name: "Security Logging & Monitoring", check: "Audit logs for security events; alerting on anomalies; log injection prevention; retention policy" },
    { id: "A10", name: "SSRF", check: "Validate and allowlist URLs for outbound requests; block private IP ranges; disable unnecessary URL schemes" }
  ];
}

// ─── Phase 7: Attack surface census ───────────────────────────────────────

export async function mapAttackSurface(repoPath = "") {
  const surface = {
    httpEndpoints: [],
    backgroundJobs: [],
    externalConnections: [],
    fileSystemAccess: [],
    envVarsReferenced: []
  };

  async function walkAndCollect(dir, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkAndCollect(fullPath, depth + 1);
        } else if (/\.(js|ts|mjs|cjs|py|rb|go|java|cs)$/.test(entry.name)) {
          const content = await fs.readFile(fullPath, "utf8").catch(() => "");
          const relPath = path.relative(repoPath, fullPath);

          const routeMatches = [...content.matchAll(/(?:app|router)\.(get|post|put|delete|patch|all)\s*\(['"`]([^'"`]+)/gi)];
          for (const m of routeMatches.slice(0, 20)) {
            surface.httpEndpoints.push({ method: m[1].toUpperCase(), path: m[2], file: relPath });
          }

          const jobMatches = [...content.matchAll(/(?:setInterval|setTimeout|schedule|cron|job)\s*\(/gi)];
          if (jobMatches.length) surface.backgroundJobs.push({ file: relPath, count: jobMatches.length });

          const fetchMatches = [...content.matchAll(/(?:fetch|axios|got|request|http\.get|https\.get)\s*\(/gi)];
          if (fetchMatches.length) surface.externalConnections.push({ file: relPath, count: fetchMatches.length });

          const fsMatches = [...content.matchAll(/(?:readFile|writeFile|unlink|mkdir|rmdir)\s*\(/gi)];
          if (fsMatches.length) surface.fileSystemAccess.push({ file: relPath, count: fsMatches.length });

          const envMatches = [...content.matchAll(/process\.env\.(\w+)/gi)];
          for (const m of envMatches) {
            if (!surface.envVarsReferenced.includes(m[1])) surface.envVarsReferenced.push(m[1]);
          }
        }
      }
    } catch {}
  }

  await walkAndCollect(repoPath);
  surface.httpEndpoints = surface.httpEndpoints.slice(0, 100);
  surface.envVarsReferenced = surface.envVarsReferenced.slice(0, 100).sort();
  return surface;
}

// ─── Phase 8: LLM/AI security checks ──────────────────────────────────────

export async function checkLlmSecurityPatterns(repoPath = "") {
  const issues = [];
  async function walkAndCheck(dir, depth = 0) {
    if (depth > 6) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkAndCheck(fullPath, depth + 1);
        } else if (/\.(js|ts|mjs|py)$/.test(entry.name)) {
          const content = await fs.readFile(fullPath, "utf8").catch(() => "");
          const relPath = path.relative(repoPath, fullPath);

          // Check for direct prompt injection vulnerability patterns
          if (/system\s*:\s*['"]\s*\$\{/.test(content) || /systemMessage.*\+.*req/.test(content)) {
            issues.push({ file: relPath, severity: "critical", issue: "Possible prompt injection — user input included in system prompt" });
          }
          // LLM output used for code execution
          if (/eval\s*\(.*(?:completion|response|output|llm|ai|gpt|claude)/gi.test(content)) {
            issues.push({ file: relPath, severity: "critical", issue: "LLM output passed to eval() — remote code execution risk" });
          }
          // Tool results trusted without validation
          if (/tool_call.*result.*exec|tool.*output.*shell/gi.test(content)) {
            issues.push({ file: relPath, severity: "high", issue: "LLM tool call output used in shell — validate before execution" });
          }
          // Missing input length limits
          if (/messages\s*\.push\s*\(.*content.*req/gi.test(content)) {
            issues.push({ file: relPath, severity: "medium", issue: "User input added to LLM messages without visible length validation — context overflow risk" });
          }
        }
      }
    } catch {}
  }
  await walkAndCheck(repoPath);
  return issues;
}

// ─── Full audit report builder ────────────────────────────────────────────

export async function runFullAudit(repoPath = "") {
  const phases = [];

  // Phase 1: Stack
  const stack = await detectStack(repoPath);
  phases.push({ phase: 1, name: "Stack Detection", result: stack });

  // Phase 2: Git secrets
  const gitSecrets = await scanGitSecretsHistory(repoPath);
  phases.push({ phase: 2, name: "Git History Secrets Scan", result: gitSecrets });

  // Phase 3: Env files
  const envFiles = await scanEnvFiles(repoPath);
  phases.push({ phase: 3, name: "Env File Scan", result: { files: envFiles } });

  // Phase 4: Dependencies
  const deps = await scanDependencies(repoPath);
  phases.push({ phase: 4, name: "Dependency Vulnerability Scan", result: { ecosystems: deps } });

  // Phase 5: CI/CD
  const ciIssues = await analyzeciPipeline(repoPath);
  phases.push({ phase: 5, name: "CI/CD Pipeline Analysis", result: { issues: ciIssues } });

  // Phase 6: OWASP
  const owasp = buildOwaspChecklist(repoPath);
  phases.push({ phase: 6, name: "OWASP Top 10 Checklist", result: { checklist: owasp } });

  // Phase 7: Attack surface
  const surface = await mapAttackSurface(repoPath);
  phases.push({ phase: 7, name: "Attack Surface Census", result: surface });

  // Phase 8: LLM security
  const llmIssues = await checkLlmSecurityPatterns(repoPath);
  phases.push({ phase: 8, name: "LLM/AI Security Checks", result: { issues: llmIssues } });

  // Score
  const criticalFindings = [
    ...gitSecrets.findings.filter((f) => f.severity === "critical"),
    ...ciIssues.filter((f) => f.severity === "critical" || f.severity === "high"),
    ...llmIssues.filter((f) => f.severity === "critical")
  ];
  const highFindings = [
    ...gitSecrets.findings.filter((f) => f.severity === "high"),
    ...envFiles.filter((f) => f.potentialSecrets?.length > 0 && f.isTracked),
    ...deps.flatMap((d) => new Array(d.critical || 0).fill({ source: "dependency" }))
  ];

  return {
    repoPath,
    at: new Date().toISOString(),
    overallRisk: criticalFindings.length > 0 ? "critical" : highFindings.length > 0 ? "high" : "medium",
    criticalFindingCount: criticalFindings.length,
    highFindingCount: highFindings.length,
    phases,
    immediateActions: [
      ...criticalFindings.map((f) => ({ priority: "critical", action: f.note || f.issue || f.description })),
      ...highFindings.slice(0, 5).map((f) => ({ priority: "high", action: f.note || f.issue || f.description }))
    ].filter((a) => a.action)
  };
}
