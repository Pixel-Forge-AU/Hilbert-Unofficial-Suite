import {
  DEFAULT_SAFE_POLICY,
  type CompilationManifest,
  type RepositoryProfile,
} from "@implementation-orchestrator/contracts";

export function fixtureRepositoryProfile(overrides: Partial<RepositoryProfile> = {}): RepositoryProfile {
  return {
    repositoryUrl: "/tmp/fixture-repo",
    baseBranch: "main",
    commitSha: "a".repeat(40),
    cleanWorkingTree: true,
    languages: [{ name: "TypeScript/JavaScript", fileCount: 10 }],
    frameworks: [],
    packageManagers: [{ name: "npm", lockfile: "package-lock.json", workspaceRoot: "/tmp/fixture-repo" }],
    buildCommands: [{ label: "build", command: "npm run build", workingDirectory: "/tmp/fixture-repo", source: "package_script" }],
    testCommands: [{ label: "test", command: "npm run test", workingDirectory: "/tmp/fixture-repo", source: "package_script" }],
    lintCommands: [{ label: "lint", command: "npm run lint", workingDirectory: "/tmp/fixture-repo", source: "package_script" }],
    typecheckCommands: [
      { label: "typecheck", command: "npm run typecheck", workingDirectory: "/tmp/fixture-repo", source: "package_script" },
    ],
    migrationCommands: [],
    startCommands: [],
    directories: [],
    ciSystems: [],
    databaseSystems: [],
    environmentFiles: [],
    architectureMarkers: [],
    risks: [],
    unknowns: [],
    ...overrides,
  };
}

export function fixtureCompilationManifest(overrides: Partial<CompilationManifest> = {}): CompilationManifest {
  return {
    manifestId: "m1",
    manifestVersion: "1.0",
    name: "Fixture Manifest",
    features: [
      {
        id: "f-backend",
        name: "Backend API",
        description: "Implement the backend API endpoint.",
        priority: "essential",
        dependsOn: [],
        acceptanceCriteria: [{ id: "ac1", description: "API responds with 200", required: true }],
        testScenarios: [{ id: "ts1", description: "API integration test", required: true }],
      },
      {
        id: "f-frontend",
        name: "Frontend Page",
        description: "Build the UI page component.",
        priority: "essential",
        dependsOn: ["f-backend"],
        acceptanceCriteria: [{ id: "ac2", description: "Page renders data", required: true }],
        testScenarios: [{ id: "ts2", description: "Page renders correctly", required: true }],
      },
    ],
    phases: [{ id: "p1", name: "Phase One", order: 0, featureIds: ["f-backend", "f-frontend"], dependsOn: [] }],
    ...overrides,
  };
}

export function fixturePolicy() {
  return DEFAULT_SAFE_POLICY;
}
