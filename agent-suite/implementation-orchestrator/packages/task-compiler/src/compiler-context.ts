import type {
  CompilationManifest,
  CompilerWarning,
  ExecutionPolicy,
  RepositoryProfile,
} from "@implementation-orchestrator/contracts";
import type { TaskCompilerConfig } from "./config.js";

export class CompilerContext {
  readonly warnings: CompilerWarning[] = [];

  constructor(
    readonly manifest: CompilationManifest,
    readonly repository: RepositoryProfile,
    readonly policy: ExecutionPolicy,
    readonly defaultBuilderProfile: string,
    readonly workflowBranch: string,
    readonly config: TaskCompilerConfig,
  ) {}

  warn(code: string, message: string, extra?: { taskId?: string; featureId?: string }): void {
    this.warnings.push({ code, message, taskId: extra?.taskId, featureId: extra?.featureId });
  }
}
