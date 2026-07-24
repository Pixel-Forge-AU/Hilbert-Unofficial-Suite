import type { DetectedFramework } from "@implementation-orchestrator/contracts";
import type { PackageJsonContents } from "./package-inspector.js";

const FRAMEWORK_RULES: Array<{ dependency: string; name: string; category: DetectedFramework["category"] }> = [
  { dependency: "next", name: "Next.js", category: "fullstack" },
  { dependency: "react", name: "React", category: "frontend" },
  { dependency: "vue", name: "Vue", category: "frontend" },
  { dependency: "svelte", name: "Svelte", category: "frontend" },
  { dependency: "@angular/core", name: "Angular", category: "frontend" },
  { dependency: "express", name: "Express", category: "backend" },
  { dependency: "fastify", name: "Fastify", category: "backend" },
  { dependency: "@nestjs/core", name: "NestJS", category: "backend" },
  { dependency: "koa", name: "Koa", category: "backend" },
  { dependency: "vitest", name: "Vitest", category: "testing" },
  { dependency: "jest", name: "Jest", category: "testing" },
  { dependency: "playwright", name: "Playwright", category: "testing" },
  { dependency: "cypress", name: "Cypress", category: "testing" },
  { dependency: "vite", name: "Vite", category: "build_tool" },
  { dependency: "webpack", name: "Webpack", category: "build_tool" },
  { dependency: "turbo", name: "Turborepo", category: "build_tool" },
];

export function detectFrameworksFromPackageJson(packageJson: PackageJsonContents | null): DetectedFramework[] {
  if (!packageJson) {
    return [];
  }
  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);

  return FRAMEWORK_RULES.filter((rule) => dependencyNames.has(rule.dependency)).map((rule) => ({
    name: rule.name,
    category: rule.category,
    detectedFrom: "package.json",
  }));
}
