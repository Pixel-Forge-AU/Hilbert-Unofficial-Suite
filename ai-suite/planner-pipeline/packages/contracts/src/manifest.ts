import { z } from "zod";
import { assumptionSchema, text, textList, userProfileSchema } from "./common.js";
import { projectDefinitionSchema } from "./project.js";
import {
  architecturePlanSchema,
  creativeDirectionSchema,
  edgeCaseReportSchema,
  featureDefinitionSchema,
  scopePlanSchema,
  userJourneySchema,
  visualDirectionSchema
} from "./stages.js";

export const MANIFEST_VERSION = "1.0.0";

// --- Implementation plan -----------------------------------------------------

export const implementationPhaseSchema = z.object({
  id: text,
  name: text,
  goal: text,
  includedFeatureIds: textList,
  exitCriteria: textList.min(1)
});

export const workstreamSchema = z.object({
  id: text,
  name: text,
  description: text,
  phaseIds: textList
});

export const dependencyEdgeSchema = z.object({
  from: text,
  to: text,
  reason: text
});

export const repositoryEntrySchema = z.object({
  path: text,
  kind: z.enum(["directory", "file"]),
  purpose: text
});

export const fileResponsibilitySchema = z.object({
  path: text,
  responsibility: text,
  relatedFeatureIds: textList.default([])
});

export const databaseChangeSchema = z.object({
  id: text,
  change: text,
  phaseId: text,
  reversible: z.boolean()
});

export const releaseCheckpointSchema = z.object({
  id: text,
  name: text,
  afterPhaseId: text,
  verification: textList.min(1)
});

export const implementationPlanSchema = z.object({
  phases: z.array(implementationPhaseSchema).min(1),
  workstreams: z.array(workstreamSchema),
  dependencyGraph: z.array(dependencyEdgeSchema),
  proposedRepositoryStructure: z.array(repositoryEntrySchema).min(1),
  fileResponsibilities: z.array(fileResponsibilitySchema),
  databaseChanges: z.array(databaseChangeSchema),
  apiBuildOrder: textList,
  uiBuildOrder: textList,
  testBuildOrder: textList,
  releaseCheckpoints: z.array(releaseCheckpointSchema).min(1)
});
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;

// --- Quality, done, traceability ---------------------------------------------

export const qualityRequirementsSchema = z.object({
  performance: textList,
  accessibility: textList.min(1),
  security: textList.min(1),
  reliability: textList,
  compatibility: textList
});
export type QualityRequirements = z.infer<typeof qualityRequirementsSchema>;

export const definitionOfDoneItemSchema = z.object({
  id: text,
  item: text,
  verification: text
});
export type DefinitionOfDoneItem = z.infer<typeof definitionOfDoneItemSchema>;

export const unresolvedDecisionSchema = z.object({
  id: text,
  decision: text,
  options: textList.min(2),
  recommendation: text,
  blockedBy: text.default("awaiting stakeholder input")
});
export type UnresolvedDecision = z.infer<typeof unresolvedDecisionSchema>;

export const traceabilityEntrySchema = z.object({
  sourceRequirement: text,
  origin: z.enum(["brief", "constraint", "assumption", "implicit_requirement"]),
  featureIds: textList,
  journeyIds: textList,
  architectureIds: textList,
  acceptanceCriteriaIds: textList,
  testScenarioIds: textList
});
export type TraceabilityEntry = z.infer<typeof traceabilityEntrySchema>;

export const traceabilityMapSchema = z.object({
  entries: z.array(traceabilityEntrySchema).min(1),
  untracedItems: textList.default([])
});
export type TraceabilityMap = z.infer<typeof traceabilityMapSchema>;

// --- Compiler stage output (LLM-synthesised sections only) ---------------------

export const compilerSynthesisSchema = z.object({
  experiencePrinciples: textList.min(3),
  implementationPlan: implementationPlanSchema,
  qualityRequirements: qualityRequirementsSchema,
  definitionOfDone: z.array(definitionOfDoneItemSchema).min(5),
  unresolvedDecisions: z.array(unresolvedDecisionSchema),
  traceability: traceabilityMapSchema
});
export type CompilerSynthesis = z.infer<typeof compilerSynthesisSchema>;

// --- Full manifest -------------------------------------------------------------

export const buildManifestSchema = z.object({
  manifestVersion: z.literal(MANIFEST_VERSION),
  generatedAt: text,
  project: projectDefinitionSchema,
  productDirection: creativeDirectionSchema,
  users: z.array(userProfileSchema).min(1),
  experiencePrinciples: textList.min(3),
  journeys: z.array(userJourneySchema).min(1),
  features: z.array(featureDefinitionSchema).min(1),
  designSystem: visualDirectionSchema,
  architecture: architecturePlanSchema,
  edgeCases: edgeCaseReportSchema,
  scope: scopePlanSchema,
  implementationPlan: implementationPlanSchema,
  qualityRequirements: qualityRequirementsSchema,
  definitionOfDone: z.array(definitionOfDoneItemSchema).min(5),
  unresolvedDecisions: z.array(unresolvedDecisionSchema),
  assumptions: z.array(assumptionSchema),
  traceability: traceabilityMapSchema
});
export type BuildManifest = z.infer<typeof buildManifestSchema>;

export const MANDATORY_MANIFEST_SECTIONS = [
  "project",
  "productDirection",
  "users",
  "experiencePrinciples",
  "journeys",
  "features",
  "designSystem",
  "architecture",
  "edgeCases",
  "scope",
  "implementationPlan",
  "qualityRequirements",
  "definitionOfDone",
  "traceability"
] as const satisfies readonly (keyof BuildManifest)[];
