import type { DetectedCommand } from "@implementation-orchestrator/contracts";
import type { PackageJsonContents } from "./package-inspector.js";

const SCRIPT_KEYWORD_RULES: Array<{ bucket: keyof CommandBuckets; keywords: RegExp }> = [
  { bucket: "buildCommands", keywords: /^build($|:)/ },
  { bucket: "testCommands", keywords: /^test($|:)/ },
  { bucket: "lintCommands", keywords: /^lint($|:)/ },
  { bucket: "typecheckCommands", keywords: /^(typecheck|type-check|tsc)($|:)/ },
  { bucket: "migrationCommands", keywords: /^(migrate|db:migrate)($|:)/ },
  { bucket: "startCommands", keywords: /^(start|dev)($|:)/ },
];

export interface CommandBuckets {
  buildCommands: DetectedCommand[];
  testCommands: DetectedCommand[];
  lintCommands: DetectedCommand[];
  typecheckCommands: DetectedCommand[];
  migrationCommands: DetectedCommand[];
  startCommands: DetectedCommand[];
}

export function detectCommandsFromPackageJson(
  packageJson: PackageJsonContents | null,
  workspacePath: string,
): CommandBuckets {
  const buckets: CommandBuckets = {
    buildCommands: [],
    testCommands: [],
    lintCommands: [],
    typecheckCommands: [],
    migrationCommands: [],
    startCommands: [],
  };

  const scripts = packageJson?.scripts ?? {};
  for (const scriptName of Object.keys(scripts)) {
    for (const rule of SCRIPT_KEYWORD_RULES) {
      if (rule.keywords.test(scriptName)) {
        buckets[rule.bucket].push({
          label: scriptName,
          command: `npm run ${scriptName}`,
          workingDirectory: workspacePath,
          source: "package_script",
        });
        break;
      }
    }
  }

  return buckets;
}
