import type { CompilationAcceptanceCriterion } from "@implementation-orchestrator/contracts";

export function chunkAcceptanceCriteria(
  acceptanceCriteria: CompilationAcceptanceCriterion[],
  maxPerChunk: number,
): CompilationAcceptanceCriterion[][] {
  if (acceptanceCriteria.length <= maxPerChunk) {
    return [acceptanceCriteria];
  }
  const chunks: CompilationAcceptanceCriterion[][] = [];
  for (let i = 0; i < acceptanceCriteria.length; i += maxPerChunk) {
    chunks.push(acceptanceCriteria.slice(i, i + maxPerChunk));
  }
  return chunks;
}
