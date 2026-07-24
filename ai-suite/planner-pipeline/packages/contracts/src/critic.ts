import { z } from "zod";
import { plannerStageNameSchema, text, textList } from "./common.js";

export const criticSeveritySchema = z.enum(["minor", "major", "blocking"]);

export const criticFindingSchema = z.object({
  id: text,
  sectionPath: text,
  problem: text,
  evidence: text,
  requiredChange: text,
  severity: criticSeveritySchema,
  responsibleStage: plannerStageNameSchema
});
export type CriticFinding = z.infer<typeof criticFindingSchema>;

export const contradictionSchema = z.object({
  sectionA: text,
  sectionB: text,
  conflict: text,
  suggestedResolution: text
});

export const genericLanguageFindingSchema = z.object({
  sectionPath: text,
  phrase: text,
  whyItIsGeneric: text,
  requiredConcreteReplacement: text
});

export const missingSectionSchema = z.object({
  sectionPath: text,
  whatIsMissing: text,
  responsibleStage: plannerStageNameSchema
});

export const revisionRequestSchema = z.object({
  section: text,
  problem: text,
  requiredChange: text,
  responsibleStage: plannerStageNameSchema,
  severity: criticSeveritySchema
});
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;

export const CRITIC_CATEGORIES = [
  "creativity",
  "completeness",
  "uxDefinition",
  "visualDefinition",
  "technicalDepth",
  "testability",
  "consistency",
  "feasibility",
  "accessibility",
  "resilience"
] as const;

const score = z.number().min(0).max(100);

export const categoryScoresSchema = z.object({
  creativity: score,
  completeness: score,
  uxDefinition: score,
  visualDefinition: score,
  technicalDepth: score,
  testability: score,
  consistency: score,
  feasibility: score,
  accessibility: score,
  resilience: score
});
export type CategoryScores = z.infer<typeof categoryScoresSchema>;

export const planCritiqueSchema = z.object({
  passed: z.boolean(),
  overallScore: score,
  categoryScores: categoryScoresSchema,
  blockingIssues: z.array(criticFindingSchema),
  majorIssues: z.array(criticFindingSchema),
  minorIssues: z.array(criticFindingSchema),
  contradictions: z.array(contradictionSchema),
  genericLanguageFindings: z.array(genericLanguageFindingSchema),
  missingSections: z.array(missingSectionSchema),
  revisionRequests: z.array(revisionRequestSchema),
  summary: text
});
export type PlanCritique = z.infer<typeof planCritiqueSchema>;

export interface QualityGateConfig {
  overallScore: number;
  minimumCategoryScore: number;
  maximumBlockingIssues: number;
  maximumMajorIssues: number;
  requireAllMandatorySections: boolean;
}

export const DEFAULT_QUALITY_GATE: QualityGateConfig = {
  overallScore: 92,
  minimumCategoryScore: 85,
  maximumBlockingIssues: 0,
  maximumMajorIssues: 3,
  requireAllMandatorySections: true
};

/**
 * Derive gate thresholds from a 1–10 strictness preference.
 * 1–3 prototype, 4–6 internal, 7–8 commercial, 9 premium, 10 hostile review.
 */
export function qualityGateForStrictness(
  strictness: number,
  targetQualityScore?: number
): QualityGateConfig {
  const clamped = Math.min(10, Math.max(1, Math.round(strictness)));
  const table: Record<number, QualityGateConfig> = {
    1: { overallScore: 60, minimumCategoryScore: 40, maximumBlockingIssues: 2, maximumMajorIssues: 12, requireAllMandatorySections: false },
    2: { overallScore: 65, minimumCategoryScore: 45, maximumBlockingIssues: 1, maximumMajorIssues: 10, requireAllMandatorySections: false },
    3: { overallScore: 70, minimumCategoryScore: 50, maximumBlockingIssues: 1, maximumMajorIssues: 8, requireAllMandatorySections: true },
    4: { overallScore: 75, minimumCategoryScore: 60, maximumBlockingIssues: 0, maximumMajorIssues: 7, requireAllMandatorySections: true },
    5: { overallScore: 80, minimumCategoryScore: 65, maximumBlockingIssues: 0, maximumMajorIssues: 6, requireAllMandatorySections: true },
    6: { overallScore: 84, minimumCategoryScore: 70, maximumBlockingIssues: 0, maximumMajorIssues: 5, requireAllMandatorySections: true },
    7: { overallScore: 88, minimumCategoryScore: 78, maximumBlockingIssues: 0, maximumMajorIssues: 4, requireAllMandatorySections: true },
    8: { overallScore: 90, minimumCategoryScore: 82, maximumBlockingIssues: 0, maximumMajorIssues: 4, requireAllMandatorySections: true },
    9: { overallScore: 92, minimumCategoryScore: 85, maximumBlockingIssues: 0, maximumMajorIssues: 3, requireAllMandatorySections: true },
    10: { overallScore: 95, minimumCategoryScore: 90, maximumBlockingIssues: 0, maximumMajorIssues: 1, requireAllMandatorySections: true }
  };
  const gate = { ...table[clamped]! };
  if (targetQualityScore !== undefined) {
    gate.overallScore = targetQualityScore;
  }
  return gate;
}
