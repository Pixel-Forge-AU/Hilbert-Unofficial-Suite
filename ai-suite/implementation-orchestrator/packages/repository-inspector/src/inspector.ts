import type { RepositoryConfig, RepositoryProfile, RepositoryRisk } from "@implementation-orchestrator/contracts";
import { readGitFacts } from "./git-facts.js";
import { detectLanguages, detectPackageManagers, readPackageJson } from "./package-inspector.js";
import { detectCommandsFromPackageJson } from "./command-detector.js";
import { detectFrameworksFromPackageJson } from "./framework-inspector.js";
import {
  detectArchitectureMarkers,
  detectCiSystems,
  detectEnvironmentFiles,
  summarizeDirectories,
} from "./filesystem-facts.js";

const DATABASE_DEPENDENCY_RULES: Array<{ dependency: string; system: string }> = [
  { dependency: "pg", system: "postgresql" },
  { dependency: "postgres", system: "postgresql" },
  { dependency: "mysql2", system: "mysql" },
  { dependency: "mysql", system: "mysql" },
  { dependency: "mongodb", system: "mongodb" },
  { dependency: "mongoose", system: "mongodb" },
  { dependency: "ioredis", system: "redis" },
  { dependency: "redis", system: "redis" },
  { dependency: "sqlite3", system: "sqlite" },
  { dependency: "better-sqlite3", system: "sqlite" },
  { dependency: "@prisma/client", system: "prisma-managed" },
];

export async function inspectRepository(
  workspacePath: string,
  repository: RepositoryConfig,
): Promise<RepositoryProfile> {
  const [gitFacts, packageJson, packageManagers, languageNames, ciSystems, architectureMarkers, environmentFiles, directories] =
    await Promise.all([
      readGitFacts(workspacePath),
      readPackageJson(workspacePath),
      detectPackageManagers(workspacePath),
      detectLanguages(workspacePath),
      detectCiSystems(workspacePath),
      detectArchitectureMarkers(workspacePath),
      detectEnvironmentFiles(workspacePath),
      summarizeDirectories(workspacePath),
    ]);

  const commands = detectCommandsFromPackageJson(packageJson, workspacePath);
  const frameworks = detectFrameworksFromPackageJson(packageJson);

  const dependencyNames = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
  const databaseSystems = [
    ...new Set(
      DATABASE_DEPENDENCY_RULES.filter((rule) => dependencyNames.has(rule.dependency)).map((rule) => rule.system),
    ),
  ];

  const risks: RepositoryRisk[] = [];
  if (!gitFacts.cleanWorkingTree) {
    risks.push({
      code: "dirty_working_tree",
      severity: "blocking",
      message: "The inspected workspace has uncommitted changes.",
    });
  }
  if (commands.testCommands.length === 0) {
    risks.push({
      code: "no_test_command",
      severity: "warning",
      message: "No test command was detected from package.json scripts.",
    });
  }
  if (commands.buildCommands.length === 0) {
    risks.push({
      code: "no_build_command",
      severity: "warning",
      message: "No build command was detected from package.json scripts.",
    });
  }

  const unknowns: string[] = [];
  if (packageManagers.length === 0 && languageNames.length === 0) {
    unknowns.push("No recognized package manager or language markers were found in the repository root.");
  }

  return {
    repositoryUrl: repository.url,
    baseBranch: repository.baseBranch,
    commitSha: gitFacts.commitSha,
    cleanWorkingTree: gitFacts.cleanWorkingTree,
    languages: languageNames.map((name) => ({ name, fileCount: 0 })),
    frameworks,
    packageManagers,
    buildCommands: commands.buildCommands,
    testCommands: commands.testCommands,
    lintCommands: commands.lintCommands,
    typecheckCommands: commands.typecheckCommands,
    migrationCommands: commands.migrationCommands,
    startCommands: commands.startCommands,
    directories,
    ciSystems,
    databaseSystems,
    environmentFiles,
    architectureMarkers,
    risks,
    unknowns,
  };
}
