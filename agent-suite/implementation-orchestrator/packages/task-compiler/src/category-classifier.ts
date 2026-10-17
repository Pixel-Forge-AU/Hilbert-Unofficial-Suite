import type { CompilationFeature, TaskCategory, TaskScope } from "@implementation-orchestrator/contracts";

const CATEGORY_KEYWORD_RULES: Array<{ category: TaskCategory; pattern: RegExp }> = [
  { category: "database", pattern: /\b(migration|schema|database|db model|table)\b/i },
  { category: "frontend", pattern: /\b(ui|page|screen|component|frontend|view|form)\b/i },
  { category: "api", pattern: /\b(api|endpoint|route|controller)\b/i },
  { category: "integration", pattern: /\b(integration|end-to-end|e2e)\b/i },
  { category: "testing", pattern: /\b(test suite|testing|qa)\b/i },
  { category: "documentation", pattern: /\b(doc|documentation|readme)\b/i },
  { category: "infrastructure", pattern: /\b(infra|infrastructure|deploy|ci\/cd|pipeline)\b/i },
];

export function classifyFeatureCategory(feature: CompilationFeature): TaskCategory {
  const haystack = `${feature.name} ${feature.description}`;
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (rule.pattern.test(haystack)) {
      return rule.category;
    }
  }
  return "backend";
}

const LIKELY_FILES_BY_CATEGORY: Record<TaskCategory, string[]> = {
  repository_setup: ["package.json"],
  dependency: ["package.json"],
  database: ["prisma/**", "migrations/**", "src/models/**"],
  migration: ["prisma/**", "migrations/**"],
  backend: ["src/services/**", "src/lib/**"],
  api: ["src/routes/**", "src/controllers/**"],
  frontend: ["src/components/**", "src/pages/**", "src/app/**"],
  integration: ["tests/**", "src/**/*.test.ts"],
  testing: ["tests/**", "src/**/*.test.ts"],
  documentation: ["docs/**", "README.md"],
  infrastructure: ["docker-compose.yml", "Dockerfile", ".github/workflows/**"],
  verification: [],
  remediation: [],
};

function topLevelDirectory(globPattern: string): string {
  const segment = globPattern.split("/")[0];
  return segment ?? globPattern;
}

export function buildScopeForCategory(category: TaskCategory, forbiddenPaths: string[]): TaskScope {
  const likelyFiles = LIKELY_FILES_BY_CATEGORY[category] ?? [];
  const allowedDirectories = [...new Set(likelyFiles.map(topLevelDirectory))];
  return {
    included: [],
    excluded: [],
    likelyFiles,
    allowedDirectories,
    forbiddenDirectories: forbiddenPaths,
  };
}
