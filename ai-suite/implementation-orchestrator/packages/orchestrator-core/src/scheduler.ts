import { TASK_PRIORITY_ORDER, type TaskPriority } from "@implementation-orchestrator/contracts";

export interface SchedulableTask {
  id: string;
  priority: TaskPriority;
  phaseOrder: number;
  dependentCount: number;
  readyAt: Date;
}

export function orderTasksForScheduling(tasks: SchedulableTask[]): SchedulableTask[] {
  return [...tasks].sort((a, b) => {
    const priorityDiff = TASK_PRIORITY_ORDER[a.priority] - TASK_PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    const phaseDiff = a.phaseOrder - b.phaseOrder;
    if (phaseDiff !== 0) {
      return phaseDiff;
    }
    const dependentDiff = b.dependentCount - a.dependentCount;
    if (dependentDiff !== 0) {
      return dependentDiff;
    }
    return a.readyAt.getTime() - b.readyAt.getTime();
  });
}

export interface SelectRunnableTasksInput {
  readyTasks: SchedulableTask[];
  currentlyActiveCount: number;
  maxConcurrentTasks: number;
}

export function selectRunnableTasks(input: SelectRunnableTasksInput): SchedulableTask[] {
  const capacity = Math.max(0, input.maxConcurrentTasks - input.currentlyActiveCount);
  if (capacity === 0) {
    return [];
  }
  return orderTasksForScheduling(input.readyTasks).slice(0, capacity);
}
