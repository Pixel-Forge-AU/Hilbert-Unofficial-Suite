// Mirrored from planner-pipeline packages/contracts/src/{common,project,stages,manifest}.ts —
// keep in sync manually. This is the wire-facing manifest shape accepted by POST /v1/workflows.
// It is deliberately NOT the shape @implementation-orchestrator/task-compiler consumes internally —
// see manifest-projection.ts (packages/orchestrator-core) for the derivation between the two, and
// compilation-manifest.ts for the narrow internal shape.
import { z } from "zod";
import { PlanGateResultSchema } from "./plan-gate.js";

const text = z.string().trim().min(1);
const textList = z.array(text);

export const MANIFEST_VERSION = "1.0.0";
export const SUPPORTED_MANIFEST_VERSIONS = ["1.0.0"] as const;
export function isSupportedManifestVersion(version: string): boolean {
  return (SUPPORTED_MANIFEST_VERSIONS as readonly string[]).includes(version);
}

// --- Common building blocks --------------------------------------------------

export const AssumptionSchema = z.object({
  id: text,
  statement: text,
  basis: text,
  confidence: z.enum(["low", "medium", "high"]),
  impactIfWrong: text
});

export const UserProfileSchema = z.object({
  id: text,
  name: text,
  description: text,
  goals: textList,
  frustrations: textList.default([]),
  technicalConfidence: z.enum(["low", "medium", "high"]).default("medium"),
  primaryDevice: text.default("desktop and mobile"),
  accessibilityNeeds: textList.default([])
});

export const SeveritySchema = z.enum(["low", "medium", "high", "blocking"]);

// --- Project ------------------------------------------------------------------

export const PlanContextSchema = z.object({
  existingStack: textList.default([]),
  existingSystems: textList.default([]),
  referenceNotes: textList.default([])
});

export const PlanPreferencesSchema = z.object({
  strictness: z.number().int().min(1).max(10).default(9),
  creativity: z.number().int().min(1).max(10).default(9),
  detailLevel: z.number().int().min(1).max(10).default(10),
  targetQualityScore: z.number().min(0).max(100).default(92),
  maxRevisionCycles: z.number().int().min(0).max(20).default(4)
});

export const ProjectDefinitionSchema = z.object({
  title: text,
  brief: text,
  constraints: textList,
  context: PlanContextSchema,
  preferences: PlanPreferencesSchema
});

// --- Creative direction (productDirection) -------------------------------------

export const SignatureFeatureSchema = z.object({
  id: text,
  name: text,
  whatMakesItMemorable: text,
  coreOrOptional: z.enum(["core_identity", "optional_novelty"])
});

export const CreativeDirectionSchema = z.object({
  selectedDirection: text,
  directionRationale: text,
  experienceThesis: text,
  creativePrinciples: textList.min(3),
  borrowedElements: z.array(z.object({ fromConceptId: text, element: text, whyItSurvives: text })),
  signatureFeatures: z.array(SignatureFeatureSchema).min(3),
  discardedIdeas: z.array(z.object({ idea: text, sourceConceptId: text.optional(), reasonDiscarded: text })).min(1),
  designRisks: textList,
  memorabilityTest: textList.min(3)
});

// --- Features -------------------------------------------------------------------

export const UiStateDefinitionSchema = z.object({
  state: z.enum([
    "default", "loading", "empty", "error", "disabled", "success",
    "partially_completed", "first_use", "returning_user", "offline", "stale_data", "permission_denied"
  ]),
  description: text,
  userSees: text,
  userCanDo: textList,
  exitCondition: text
});

export const FlowStepSchema = z.object({
  step: z.number().int().min(1),
  actor: text,
  action: text,
  systemResponse: text,
  visibleOutcome: text
});

export const UserFlowSchema = z.object({
  name: text,
  trigger: text,
  steps: z.array(FlowStepSchema).min(1),
  outcome: text
});

export const AcceptanceCriterionSchema = z.object({
  id: text,
  criterion: text,
  measurement: text
});

export const TestScenarioSchema = z.object({
  id: text,
  name: text,
  given: text,
  when: text,
  then: text,
  kind: z.enum(["unit", "integration", "e2e", "manual", "accessibility", "performance"])
});

export const FeatureDefinitionSchema = z.object({
  id: text,
  parentId: text.nullable().default(null),
  name: text,
  summary: text,
  purpose: text,
  userValue: text,
  businessValue: text,
  actors: textList.min(1),
  entryPoints: textList,
  prerequisites: textList,
  primaryFlow: z.array(FlowStepSchema).min(1),
  alternateFlows: z.array(UserFlowSchema),
  states: z.array(UiStateDefinitionSchema),
  dataRequirements: z.array(z.object({ entity: text, fields: textList, source: text, freshness: text.default("on demand") })),
  permissions: z.array(z.object({ actor: text, capability: text, deniedBehaviour: text })),
  analyticsEvents: z.array(z.object({ name: text, trigger: text, properties: textList.default([]) })),
  failureModes: z.array(z.object({ failure: text, cause: text, userVisibleBehaviour: text, recovery: text })),
  recoveryBehaviour: textList,
  mobileBehaviour: textList,
  accessibilityBehaviour: textList,
  privacyConsiderations: textList,
  dependencies: textList,
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  testScenarios: z.array(TestScenarioSchema).min(1),
  openDecisions: textList
});
export type FeatureDefinition = z.infer<typeof FeatureDefinitionSchema>;

// --- Journeys ---------------------------------------------------------------------

export const UserJourneySchema = z.object({
  id: text,
  name: text,
  actor: text,
  trigger: text,
  entryPoint: text,
  assumptions: textList,
  steps: z.array(z.object({
    step: z.number().int().min(1),
    location: text,
    userThought: text,
    userAction: text,
    systemResponse: text,
    featureIds: textList.default([])
  })).min(1),
  decisionPoints: z.array(z.object({ atStep: z.number().int().min(1), decision: text, options: textList.min(2), defaultPath: text })),
  emotionalCurve: z.array(z.object({ atStep: z.number().int().min(1), emotion: text, designResponse: text })),
  confusionRisks: textList,
  recoveryPaths: z.array(z.object({ failure: text, recoverySteps: textList.min(1), worstCase: text })).min(1),
  completionSignal: text,
  returnPath: text,
  retentionOpportunity: text.optional(),
  instrumentation: textList
});

// --- Visual direction (designSystem) ------------------------------------------------

export const VisualDirectionSchema = z.object({
  visualConcept: text,
  visualPrinciples: textList.min(3),
  visualAntiPatterns: textList.min(3),
  layoutSystem: z.object({
    description: text, contentMaxWidth: text, wideLayoutMaxWidth: text, gridColumns: z.number().int().min(1),
    mobileGutter: text, tabletGutter: text, desktopGutter: text,
    breakpoints: z.array(z.object({ name: text, minWidth: text })).min(2)
  }),
  typographySystem: z.object({
    headingFont: text, bodyFont: text, monoFont: text.optional(), baseSizePx: z.number(), scaleRatio: z.number(),
    lineHeights: z.record(z.number()), weightRules: textList
  }),
  spacingSystem: z.object({ baseUnitPx: z.number(), spacingScale: z.array(z.number()).min(4), usageRules: textList }),
  colourRoles: z.array(z.object({ role: text, value: text, usage: text, contrastNotes: text })).min(4),
  componentDensity: text,
  shapeLanguage: z.object({ cornerRadii: z.array(z.number()), borderRules: textList, elevationRules: textList }),
  iconography: z.object({ style: text, strokeWidth: text, sizes: z.array(z.number()), library: text }),
  illustrationDirection: text.optional(),
  imageryDirection: text.optional(),
  motionSystem: z.object({
    personality: text, microInteractionDurationMs: z.array(z.number()).length(2),
    panelTransitionDurationMs: z.array(z.number()).length(2), easingRules: textList, forbiddenMotion: textList
  }),
  responsiveRules: z.array(z.object({ breakpoint: text, rule: text })).min(2),
  darkModeRules: textList,
  reducedMotionRules: textList.min(1),
  loadingPresentation: textList.min(1),
  emptyStatePersonality: textList.min(1),
  errorPresentation: textList.min(1),
  screenshotReviewChecklist: textList.min(5)
});

// --- Architecture ---------------------------------------------------------------------

export const SystemModuleSchema = z.object({
  id: text, name: text, responsibility: text, boundaries: text, dependsOn: textList, exposedInterfaces: textList
});

export const ArchitectureDecisionSchema = z.object({
  id: text, decision: text, rationale: text, alternativesConsidered: textList.min(1),
  tradeoffs: textList.min(1), failureModes: textList, futureExtension: text
});

export const ArchitecturePlanSchema = z.object({
  systemContext: text,
  architecturalStyle: text,
  architecturalPrinciples: textList.min(3),
  modules: z.array(SystemModuleSchema).min(1),
  dataModels: z.array(z.object({
    name: text, purpose: text,
    fields: z.array(z.object({ name: text, type: text, required: z.boolean(), notes: text.default("") })).min(1),
    relationships: textList, indexes: textList, retention: text.default("indefinite")
  })).min(1),
  APIs: z.array(z.object({
    id: text, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), path: text, purpose: text,
    requestShape: text, responseShape: text, errors: textList, authRequired: z.boolean(), owner: text
  })).min(1),
  events: z.array(z.object({ name: text, emittedWhen: text, payloadShape: text, consumers: textList })),
  stateOwnership: z.array(z.object({ state: text, owner: text, rationale: text })),
  backgroundJobs: z.array(z.object({
    name: text, trigger: text, behaviour: text, failureHandling: text, schedule: text.default("on demand")
  })),
  cachingStrategy: z.array(z.object({ data: text, layer: text, ttl: text, invalidation: text })),
  authentication: z.object({ approach: text, details: textList }),
  authorization: z.object({ approach: text, roles: textList, rules: textList }),
  validationStrategy: textList.min(1),
  errorHandlingStrategy: textList.min(1),
  observability: z.object({ logging: textList, metrics: textList, alerts: textList }),
  securityControls: z.array(z.object({ threat: text, control: text, layer: text })).min(1),
  deploymentModel: z.object({ approach: text, environments: textList, steps: textList }),
  migrationStrategy: z.object({ approach: text, steps: textList }),
  backupStrategy: z.object({ approach: text, cadence: text, restoreTest: text }),
  rollbackStrategy: z.object({ approach: text, steps: textList }),
  testStrategy: z.object({ levels: textList, tooling: textList, coverageExpectations: text }),
  performanceTargets: z.array(z.object({ metric: text, target: text, measurement: text })).min(1),
  scalabilityRisks: textList,
  architectureDecisions: z.array(ArchitectureDecisionSchema).min(3)
});

// --- Edge cases ---------------------------------------------------------------------

export const EdgeCaseCategorySchema = z.enum(["behaviour", "data", "visual", "mobile", "accessibility", "security", "operations"]);

export const EdgeCaseReportSchema = z.object({
  findings: z.array(z.object({
    id: text, category: EdgeCaseCategorySchema, scenario: text, trigger: text, expectedBehaviour: text,
    currentGap: text, severity: SeveritySchema, affectedFeatures: textList, requiredMitigation: text
  })).min(1),
  systemicRisks: textList,
  highestRiskAreas: textList.min(1),
  missingRecoveryPatterns: textList,
  requiredPlanChanges: z.array(z.object({ section: text, problem: text, requiredChange: text, responsibleStage: text }))
});

// --- Scope ---------------------------------------------------------------------

export const SCOPE_CLASSES = ["essential", "high_value", "delight", "experimental", "future", "unnecessary"] as const;
export const ScopeClassSchema = z.enum(SCOPE_CLASSES);
export type ScopeClass = z.infer<typeof ScopeClassSchema>;

export const ScopeClassificationSchema = z.object({
  itemId: text,
  itemName: text,
  scopeClass: ScopeClassSchema,
  rationale: text,
  cheaperAlternative: text.nullable().default(null),
  isSignatureElement: z.boolean().default(false)
});

export const ScopePlanSchema = z.object({
  classifications: z.array(ScopeClassificationSchema).min(1),
  minimumCompleteProduct: textList.min(1),
  recommendedFirstRelease: textList.min(1),
  premiumRelease: textList,
  experiments: textList,
  deferredItems: textList,
  rejectedItems: textList,
  sequencingRationale: textList.min(1),
  scopeRisks: textList
});

// --- Implementation plan ---------------------------------------------------------------

export const ImplementationPhaseSchema = z.object({
  id: text,
  name: text,
  goal: text,
  includedFeatureIds: textList,
  exitCriteria: textList.min(1)
});
export type ImplementationPhase = z.infer<typeof ImplementationPhaseSchema>;

export const ImplementationPlanSchema = z.object({
  phases: z.array(ImplementationPhaseSchema).min(1),
  workstreams: z.array(z.object({ id: text, name: text, description: text, phaseIds: textList })),
  dependencyGraph: z.array(z.object({ from: text, to: text, reason: text })),
  proposedRepositoryStructure: z.array(z.object({ path: text, kind: z.enum(["directory", "file"]), purpose: text })).min(1),
  fileResponsibilities: z.array(z.object({ path: text, responsibility: text, relatedFeatureIds: textList.default([]) })),
  databaseChanges: z.array(z.object({ id: text, change: text, phaseId: text, reversible: z.boolean() })),
  apiBuildOrder: textList,
  uiBuildOrder: textList,
  testBuildOrder: textList,
  releaseCheckpoints: z.array(z.object({ id: text, name: text, afterPhaseId: text, verification: textList.min(1) })).min(1)
});
export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

// --- Quality, done, traceability ---------------------------------------------------------

export const QualityRequirementsSchema = z.object({
  performance: textList,
  accessibility: textList.min(1),
  security: textList.min(1),
  reliability: textList,
  compatibility: textList
});

export const DefinitionOfDoneItemSchema = z.object({ id: text, item: text, verification: text });

export const UnresolvedDecisionSchema = z.object({
  id: text,
  decision: text,
  options: textList.min(2),
  recommendation: text,
  blockedBy: text.default("awaiting stakeholder input")
});

export const TraceabilityEntrySchema = z.object({
  sourceRequirement: text,
  origin: z.enum(["brief", "constraint", "assumption", "implicit_requirement"]),
  featureIds: textList,
  journeyIds: textList,
  architectureIds: textList,
  acceptanceCriteriaIds: textList,
  testScenarioIds: textList
});

export const TraceabilityMapSchema = z.object({
  entries: z.array(TraceabilityEntrySchema).min(1),
  untracedItems: textList.default([])
});

// --- Full manifest -------------------------------------------------------------------------

export const BuildManifestSchema = z.object({
  // Implementation-orchestrator's own concept, synthesized at the publish boundary as the
  // upstream planner's plan id — not part of planner-pipeline's own manifest schema.
  manifestId: text,
  manifestVersion: text,
  generatedAt: text,
  project: ProjectDefinitionSchema,
  productDirection: CreativeDirectionSchema,
  users: z.array(UserProfileSchema).min(1),
  experiencePrinciples: textList.min(3),
  journeys: z.array(UserJourneySchema).min(1),
  features: z.array(FeatureDefinitionSchema).min(1),
  designSystem: VisualDirectionSchema,
  architecture: ArchitecturePlanSchema,
  edgeCases: EdgeCaseReportSchema,
  scope: ScopePlanSchema,
  implementationPlan: ImplementationPlanSchema,
  qualityRequirements: QualityRequirementsSchema,
  definitionOfDone: z.array(DefinitionOfDoneItemSchema).min(5),
  unresolvedDecisions: z.array(UnresolvedDecisionSchema),
  assumptions: z.array(AssumptionSchema),
  traceability: TraceabilityMapSchema,
  // Implementation-orchestrator's own enforcement point: the manifest is not accepted unless
  // it carries the upstream Plan Gate's decision (see ManifestValidationService).
  planGate: PlanGateResultSchema
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;
