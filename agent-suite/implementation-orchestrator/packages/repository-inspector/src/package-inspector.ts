import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PackageManagerProfile } from "@implementation-orchestrator/contracts";

export interface PackageJsonContents {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readPackageJson(workspacePath: string): Promise<PackageJsonContents | null> {
  const packageJsonPath = path.join(workspacePath, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJsonContents;
}

const LOCKFILE_TO_MANAGER: Array<{ file: string; name: PackageManagerProfile["name"] }> = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "bun.lockb", name: "bun" },
  { file: "package-lock.json", name: "npm" },
];

export async function detectPackageManagers(workspacePath: string): Promise<PackageManagerProfile[]> {
  const detected: PackageManagerProfile[] = [];

  for (const { file, name } of LOCKFILE_TO_MANAGER) {
    if (await fileExists(path.join(workspacePath, file))) {
      detected.push({ name, lockfile: file, workspaceRoot: workspacePath });
    }
  }

  if (await fileExists(path.join(workspacePath, "requirements.txt"))) {
    detected.push({ name: "pip", lockfile: "requirements.txt", workspaceRoot: workspacePath });
  }
  if (await fileExists(path.join(workspacePath, "pyproject.toml"))) {
    detected.push({ name: "poetry", lockfile: "pyproject.toml", workspaceRoot: workspacePath });
  }
  if (await fileExists(path.join(workspacePath, "composer.json"))) {
    detected.push({ name: "composer", lockfile: "composer.lock", workspaceRoot: workspacePath });
  }
  if (await fileExists(path.join(workspacePath, "Cargo.toml"))) {
    detected.push({ name: "cargo", lockfile: "Cargo.lock", workspaceRoot: workspacePath });
  }
  if (await fileExists(path.join(workspacePath, "go.mod"))) {
    detected.push({ name: "go", lockfile: "go.sum", workspaceRoot: workspacePath });
  }

  return detected;
}

const LANGUAGE_MARKERS: Array<{ file: string; language: string }> = [
  { file: "package.json", language: "TypeScript/JavaScript" },
  { file: "requirements.txt", language: "Python" },
  { file: "pyproject.toml", language: "Python" },
  { file: "composer.json", language: "PHP" },
  { file: "Cargo.toml", language: "Rust" },
  { file: "go.mod", language: "Go" },
];

export async function detectLanguages(workspacePath: string): Promise<string[]> {
  const languages = new Set<string>();
  for (const { file, language } of LANGUAGE_MARKERS) {
    if (await fileExists(path.join(workspacePath, file))) {
      languages.add(language);
    }
  }
  if (await fileExists(path.join(workspacePath, "tsconfig.json"))) {
    languages.add("TypeScript/JavaScript");
  }
  return [...languages];
}
