import type {
  DetectedCommand,
  RepositoryProfile,
  TaskCategory,
  TaskExecutionPolicy,
  TaskVerificationPlan,
  VerificationCheckDefinition,
  VerificationCheckType,
} from "@implementation-orchestrator/contracts";

function builtInCheck(
  id: string,
  type: VerificationCheckType,
  name: string,
  timeoutSeconds: number,
): VerificationCheckDefinition {
  return {
    id,
    type,
    name,
    timeoutSeconds,
    required: true,
    continueOnFailure: false,
    environmentReferences: [],
    expectedExitCodes: [0],
  };
}

function commandCheck(
  id: string,
  type: VerificationCheckType,
  name: string,
  detected: DetectedCommand,
  timeoutSeconds: number,
  required: boolean,
): VerificationCheckDefinition {
  return {
    id,
    type,
    name,
    command: detected.command,
    workingDirectory: detected.workingDirectory,
    timeoutSeconds,
    required,
    continueOnFailure: !required,
    environmentReferences: [],
    expectedExitCodes: [0],
  };
}

export function buildVerificationPlan(
  category: TaskCategory,
  repository: RepositoryProfile,
  timeoutSeconds: number,
): TaskVerificationPlan {
  const checks: VerificationCheckDefinition[] = [
    builtInCheck("git-cleanliness", "git_cleanliness", "Git working tree cleanliness", 30),
    builtInCheck("changed-file-scope", "changed_file_scope", "Changed files stay within task scope", 30),
  ];

  const build = repository.buildCommands[0];
  if (build) {
    checks.push(commandCheck("build", "build", "Project builds successfully", build, timeoutSeconds, true));
  }
  const typecheck = repository.typecheckCommands[0];
  if (typecheck) {
    checks.push(commandCheck("typecheck", "typecheck", "Type checking passes", typecheck, timeoutSeconds, true));
  }
  const lint = repository.lintCommands[0];
  if (lint) {
    checks.push(commandCheck("lint", "lint", "Lint checks pass", lint, timeoutSeconds, false));
  }
  const test = repository.testCommands[0];
  if (test) {
    checks.push(commandCheck("unit-test", "unit_test", "Unit tests pass", test, timeoutSeconds, true));
  }
  if (category === "database" || category === "migration") {
    const migration = repository.migrationCommands[0];
    if (migration) {
      checks.push(
        commandCheck("migration-check", "migration_check", "Database migrations apply cleanly", migration, timeoutSeconds, true),
      );
    }
  }

  return {
    checks,
    requiredArtifactTypes: ["git_diff"],
    passPolicy: "all_required",
  };
}

export function buildExecutionPolicy(category: TaskCategory, taskDefaults: TaskExecutionPolicy): TaskExecutionPolicy {
  if (category === "database" || category === "migration") {
    return { ...taskDefaults, allowSchemaChanges: true };
  }
  return { ...taskDefaults };
}
