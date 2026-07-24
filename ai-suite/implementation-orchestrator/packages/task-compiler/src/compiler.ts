import type { CompiledTaskGraph, TaskCompilerInput } from "@implementation-orchestrator/contracts";
import { CompilerContext } from "./compiler-context.js";
import { DEFAULT_TASK_COMPILER_CONFIG, GRAPH_VERSION, type TaskCompilerConfig } from "./config.js";
import { compileFeatureTasks, compileSetupTasks } from "./feature-compiler.js";
import { compileFinalVerificationTask, compileIntegrationTask } from "./extra-task-compiler.js";
import { compilePhases } from "./phase-compiler.js";
import { buildDependencies, finalizeHardDependencies } from "./dependency-builder.js";
import { computeCoverage } from "./coverage.js";

export interface TaskCompiler {
  compile(input: TaskCompilerInput): Promise<CompiledTaskGraph>;
}

export class DeterministicTaskCompiler implements TaskCompiler {
  constructor(private readonly config: TaskCompilerConfig = DEFAULT_TASK_COMPILER_CONFIG) {}

  async compile(input: TaskCompilerInput): Promise<CompiledTaskGraph> {
    const context = new CompilerContext(
      input.manifest,
      input.repository,
      input.policy,
      input.defaultBuilderProfile,
      input.workflowBranch,
      this.config,
    );

    const setupTasks = compileSetupTasks(context);
    const featureTasks = compileFeatureTasks(context);
    const preIntegrationTasks = [...setupTasks, ...featureTasks];

    const integrationTask = compileIntegrationTask(context, featureTasks);
    const tasksBeforeFinal = integrationTask ? [...preIntegrationTasks, integrationTask] : preIntegrationTasks;

    const finalVerificationTask = compileFinalVerificationTask(
      context,
      tasksBeforeFinal.map((t) => t.id),
    );
    const allTasks = [...tasksBeforeFinal, finalVerificationTask];

    const phases = compilePhases(context, allTasks);
    const dependencies = buildDependencies(allTasks, phases);
    const finalizedTasks = finalizeHardDependencies(allTasks, dependencies);
    const coverage = computeCoverage(context.manifest, finalizedTasks);

    return {
      graphVersion: GRAPH_VERSION,
      compilerVersion: input.compilerVersion,
      tasks: finalizedTasks,
      dependencies,
      phases,
      coverage,
      warnings: context.warnings,
    };
  }
}
