import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ArchitectureMarker,
  CiSystemProfile,
  DirectorySummary,
} from "@implementation-orchestrator/contracts";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

const CI_MARKERS: Array<{ path: string; name: string }> = [
  { path: ".github/workflows", name: "GitHub Actions" },
  { path: ".gitlab-ci.yml", name: "GitLab CI" },
  { path: ".circleci/config.yml", name: "CircleCI" },
  { path: "Jenkinsfile", name: "Jenkins" },
  { path: "azure-pipelines.yml", name: "Azure Pipelines" },
];

export async function detectCiSystems(workspacePath: string): Promise<CiSystemProfile[]> {
  const detected: CiSystemProfile[] = [];
  for (const marker of CI_MARKERS) {
    if (await fileExists(path.join(workspacePath, marker.path))) {
      detected.push({ name: marker.name, configPath: marker.path });
    }
  }
  return detected;
}

const ARCHITECTURE_MARKERS: Array<{ path: string; name: string }> = [
  { path: "pnpm-workspace.yaml", name: "pnpm workspace monorepo" },
  { path: "turbo.json", name: "Turborepo monorepo" },
  { path: "nx.json", name: "Nx monorepo" },
  { path: "lerna.json", name: "Lerna monorepo" },
  { path: "docker-compose.yml", name: "Docker Compose" },
  { path: "Dockerfile", name: "Dockerized service" },
];

export async function detectArchitectureMarkers(workspacePath: string): Promise<ArchitectureMarker[]> {
  const detected: ArchitectureMarker[] = [];
  for (const marker of ARCHITECTURE_MARKERS) {
    if (await fileExists(path.join(workspacePath, marker.path))) {
      detected.push({ name: marker.name, path: marker.path });
    }
  }
  return detected;
}

const ENVIRONMENT_FILE_CANDIDATES = [".env.example", ".env.sample", ".env.template", ".env.dist"];

export async function detectEnvironmentFiles(workspacePath: string): Promise<string[]> {
  const detected: string[] = [];
  for (const candidate of ENVIRONMENT_FILE_CANDIDATES) {
    if (await fileExists(path.join(workspacePath, candidate))) {
      detected.push(candidate);
    }
  }
  return detected;
}

const IGNORED_TOP_LEVEL_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".turbo"]);

export async function summarizeDirectories(workspacePath: string): Promise<DirectorySummary[]> {
  const entries = await readdir(workspacePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !IGNORED_TOP_LEVEL_DIRECTORIES.has(entry.name))
    .map((entry) => ({ path: entry.name }));
}
