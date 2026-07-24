import { z } from "zod";
import {
  assumptionSchema,
  complexitySchema,
  planningQuestionSchema,
  severitySchema,
  text,
  textList,
  userProfileSchema
} from "./common.js";

// ---------------------------------------------------------------------------
// Stage 1: Intent Interpreter
// ---------------------------------------------------------------------------

export const intentInterpretationSchema = z.object({
  projectGoal: text,
  problemStatement: text,
  targetUsers: z.array(userProfileSchema).min(1),
  businessObjectives: textList.min(1),
  userObjectives: textList.min(1),
  desiredEmotions: textList,
  hardConstraints: textList,
  softPreferences: textList,
  explicitRequirements: textList.min(1),
  implicitRequirements: textList,
  nonGoals: textList,
  assumptions: z.array(assumptionSchema),
  unansweredQuestions: z.array(planningQuestionSchema),
  risksOfMisinterpretation: textList,
  successSignals: textList.min(1)
});
export type IntentInterpretation = z.infer<typeof intentInterpretationSchema>;

// ---------------------------------------------------------------------------
// Stage 2: Wild Concept Generator
// ---------------------------------------------------------------------------

export const productConceptSchema = z.object({
  id: text,
  name: text,
  oneSentencePitch: text,
  coreHook: text,
  targetExperience: text,
  signatureInteractions: textList.min(1),
  signatureFeatures: textList.min(1),
  visualIdentity: text,
  technicalDifferentiators: textList,
  emotionalPayoff: text,
  reasonsUsersRememberIt: textList.min(1),
  risks: textList,
  complexity: complexitySchema
});
export type ProductConcept = z.infer<typeof productConceptSchema>;

export const conceptGenerationSchema = z.object({
  concepts: z.array(productConceptSchema).min(5),
  spectrumNotes: text.describe(
    "How the concepts differ from each other across safety, polish, play, ambition and strangeness"
  )
});
export type ConceptGeneration = z.infer<typeof conceptGenerationSchema>;

// ---------------------------------------------------------------------------
// Stage 3: Creative Director
// ---------------------------------------------------------------------------

export const borrowedElementSchema = z.object({
  fromConceptId: text,
  element: text,
  whyItSurvives: text
});

export const signatureFeatureSchema = z.object({
  id: text,
  name: text,
  whatMakesItMemorable: text,
  coreOrOptional: z.enum(["core_identity", "optional_novelty"])
});

export const discardedIdeaSchema = z.object({
  idea: text,
  sourceConceptId: text.optional(),
  reasonDiscarded: text
});

export const creativeDirectionSchema = z.object({
  selectedDirection: text,
  directionRationale: text,
  experienceThesis: text,
  creativePrinciples: textList.min(3),
  borrowedElements: z.array(borrowedElementSchema),
  signatureFeatures: z.array(signatureFeatureSchema).min(3),
  discardedIdeas: z.array(discardedIdeaSchema).min(1),
  designRisks: textList,
  memorabilityTest: textList.min(3)
});
export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;

// ---------------------------------------------------------------------------
// Stage 4: Feature Expansion
// ---------------------------------------------------------------------------

export const UI_STATE_KINDS = [
  "default",
  "loading",
  "empty",
  "error",
  "disabled",
  "success",
  "partially_completed",
  "first_use",
  "returning_user",
  "offline",
  "stale_data",
  "permission_denied"
] as const;
export const uiStateKindSchema = z.enum(UI_STATE_KINDS);

export const uiStateDefinitionSchema = z.object({
  state: uiStateKindSchema,
  description: text,
  userSees: text,
  userCanDo: textList,
  exitCondition: text
});
export type UiStateDefinition = z.infer<typeof uiStateDefinitionSchema>;

export const flowStepSchema = z.object({
  step: z.number().int().min(1),
  actor: text,
  action: text,
  systemResponse: text,
  visibleOutcome: text
});
export type FlowStep = z.infer<typeof flowStepSchema>;

export const userFlowSchema = z.object({
  name: text,
  trigger: text,
  steps: z.array(flowStepSchema).min(1),
  outcome: text
});

export const dataRequirementSchema = z.object({
  entity: text,
  fields: textList,
  source: text,
  freshness: text.default("on demand")
});

export const permissionRequirementSchema = z.object({
  actor: text,
  capability: text,
  deniedBehaviour: text
});

export const analyticsEventSchema = z.object({
  name: text,
  trigger: text,
  properties: textList.default([])
});

export const failureModeSchema = z.object({
  failure: text,
  cause: text,
  userVisibleBehaviour: text,
  recovery: text
});

export const acceptanceCriterionSchema = z.object({
  id: text,
  criterion: text,
  measurement: text
});
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

export const testScenarioSchema = z.object({
  id: text,
  name: text,
  given: text,
  when: text,
  then: text,
  kind: z.enum(["unit", "integration", "e2e", "manual", "accessibility", "performance"])
});
export type TestScenario = z.infer<typeof testScenarioSchema>;

export const featureDefinitionSchema = z.object({
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
  primaryFlow: z.array(flowStepSchema).min(1),
  alternateFlows: z.array(userFlowSchema),
  states: z.array(uiStateDefinitionSchema),
  dataRequirements: z.array(dataRequirementSchema),
  permissions: z.array(permissionRequirementSchema),
  analyticsEvents: z.array(analyticsEventSchema),
  failureModes: z.array(failureModeSchema),
  recoveryBehaviour: textList,
  mobileBehaviour: textList,
  accessibilityBehaviour: textList,
  privacyConsiderations: textList,
  dependencies: textList,
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
  testScenarios: z.array(testScenarioSchema).min(1),
  openDecisions: textList
});
export type FeatureDefinition = z.infer<typeof featureDefinitionSchema>;

export const featureExpansionSchema = z.object({
  features: z.array(featureDefinitionSchema).min(1),
  featureTreeNotes: text,
  crossCuttingConcerns: textList
});
export type FeatureExpansion = z.infer<typeof featureExpansionSchema>;

// ---------------------------------------------------------------------------
// Stage 5: UX Journey Designer
// ---------------------------------------------------------------------------

export const journeyStepSchema = z.object({
  step: z.number().int().min(1),
  location: text,
  userThought: text,
  userAction: text,
  systemResponse: text,
  featureIds: textList.default([])
});
export type JourneyStep = z.infer<typeof journeyStepSchema>;

export const decisionPointSchema = z.object({
  atStep: z.number().int().min(1),
  decision: text,
  options: textList.min(2),
  defaultPath: text
});

export const emotionalMomentSchema = z.object({
  atStep: z.number().int().min(1),
  emotion: text,
  designResponse: text
});

export const recoveryPathSchema = z.object({
  failure: text,
  recoverySteps: textList.min(1),
  worstCase: text
});

export const userJourneySchema = z.object({
  id: text,
  name: text,
  actor: text,
  trigger: text,
  entryPoint: text,
  assumptions: textList,
  steps: z.array(journeyStepSchema).min(1),
  decisionPoints: z.array(decisionPointSchema),
  emotionalCurve: z.array(emotionalMomentSchema),
  confusionRisks: textList,
  recoveryPaths: z.array(recoveryPathSchema).min(1),
  completionSignal: text,
  returnPath: text,
  retentionOpportunity: text.optional(),
  instrumentation: textList
});
export type UserJourney = z.infer<typeof userJourneySchema>;

export const uxJourneyPlanSchema = z.object({
  journeys: z.array(userJourneySchema).min(1),
  orientationAnswers: z
    .object({
      whatIsThis: text,
      whatCanIDoHere: text,
      whatHappensNext: text,
      didTheActionWork: text,
      canIUndoIt: text,
      whyAmIBlocked: text,
      howDoIRecover: text,
      howDoIContinueLater: text
    })
    .describe("How the interface answers each orientation question, globally"),
  personaCoverageNotes: text
});
export type UxJourneyPlan = z.infer<typeof uxJourneyPlanSchema>;

// ---------------------------------------------------------------------------
// Stage 6: Visual Art Director
// ---------------------------------------------------------------------------

export const layoutSystemSchema = z.object({
  description: text,
  contentMaxWidth: text,
  wideLayoutMaxWidth: text,
  gridColumns: z.number().int().min(1),
  mobileGutter: text,
  tabletGutter: text,
  desktopGutter: text,
  breakpoints: z.array(z.object({ name: text, minWidth: text })).min(2)
});

export const typographySystemSchema = z.object({
  headingFont: text,
  bodyFont: text,
  monoFont: text.optional(),
  baseSizePx: z.number(),
  scaleRatio: z.number(),
  lineHeights: z.record(z.number()),
  weightRules: textList
});

export const spacingSystemSchema = z.object({
  baseUnitPx: z.number(),
  spacingScale: z.array(z.number()).min(4),
  usageRules: textList
});

export const colourRoleSchema = z.object({
  role: text,
  value: text,
  usage: text,
  contrastNotes: text
});

export const shapeLanguageSchema = z.object({
  cornerRadii: z.array(z.number()),
  borderRules: textList,
  elevationRules: textList
});

export const iconographyDirectionSchema = z.object({
  style: text,
  strokeWidth: text,
  sizes: z.array(z.number()),
  library: text
});

export const motionSystemSchema = z.object({
  personality: text,
  microInteractionDurationMs: z.array(z.number()).length(2),
  panelTransitionDurationMs: z.array(z.number()).length(2),
  easingRules: textList,
  forbiddenMotion: textList
});

export const responsiveRuleSchema = z.object({
  breakpoint: text,
  rule: text
});

export const visualDirectionSchema = z.object({
  visualConcept: text,
  visualPrinciples: textList.min(3),
  visualAntiPatterns: textList.min(3),
  layoutSystem: layoutSystemSchema,
  typographySystem: typographySystemSchema,
  spacingSystem: spacingSystemSchema,
  colourRoles: z.array(colourRoleSchema).min(4),
  componentDensity: text,
  shapeLanguage: shapeLanguageSchema,
  iconography: iconographyDirectionSchema,
  illustrationDirection: text.optional(),
  imageryDirection: text.optional(),
  motionSystem: motionSystemSchema,
  responsiveRules: z.array(responsiveRuleSchema).min(2),
  darkModeRules: textList,
  reducedMotionRules: textList.min(1),
  loadingPresentation: textList.min(1),
  emptyStatePersonality: textList.min(1),
  errorPresentation: textList.min(1),
  screenshotReviewChecklist: textList.min(5)
});
export type VisualDirection = z.infer<typeof visualDirectionSchema>;

// ---------------------------------------------------------------------------
// Stage 7: Systems Architect
// ---------------------------------------------------------------------------

export const systemModuleSchema = z.object({
  id: text,
  name: text,
  responsibility: text,
  boundaries: text,
  dependsOn: textList,
  exposedInterfaces: textList
});

export const dataModelFieldSchema = z.object({
  name: text,
  type: text,
  required: z.boolean(),
  notes: text.default("")
});

export const dataModelSchema = z.object({
  name: text,
  purpose: text,
  fields: z.array(dataModelFieldSchema).min(1),
  relationships: textList,
  indexes: textList,
  retention: text.default("indefinite")
});

export const apiDefinitionSchema = z.object({
  id: text,
  // Optional: a client-only project has no real HTTP endpoints, but internal module
  // interfaces are still worth recording here. Omit for a non-HTTP interface rather than
  // forcing a fabricated method (which previously caused a hard schema failure).
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  path: text,
  purpose: text,
  requestShape: text,
  responseShape: text,
  errors: textList,
  authRequired: z.boolean(),
  owner: text
});

export const eventDefinitionSchema = z.object({
  name: text,
  emittedWhen: text,
  payloadShape: text,
  consumers: textList
});

export const stateOwnershipRuleSchema = z.object({
  state: text,
  owner: text,
  rationale: text
});

export const backgroundJobSchema = z.object({
  name: text,
  trigger: text,
  behaviour: text,
  failureHandling: text,
  schedule: text.default("on demand")
});

export const cacheRuleSchema = z.object({
  data: text,
  layer: text,
  ttl: text,
  invalidation: text
});

export const architectureDecisionSchema = z.object({
  id: text,
  decision: text,
  rationale: text,
  alternativesConsidered: textList.min(1),
  tradeoffs: textList.min(1),
  failureModes: textList,
  futureExtension: text
});
export type ArchitectureDecision = z.infer<typeof architectureDecisionSchema>;

export const performanceTargetSchema = z.object({
  metric: text,
  target: text,
  measurement: text
});

export const securityControlSchema = z.object({
  threat: text,
  control: text,
  layer: text
});

export const architecturePlanSchema = z.object({
  systemContext: text,
  architecturalStyle: text,
  architecturalPrinciples: textList.min(3),
  modules: z.array(systemModuleSchema).min(1),
  dataModels: z.array(dataModelSchema).min(1),
  // No minimum, and defaulted rather than merely optional: a client-only project (no
  // backend/server) legitimately has zero APIs, and requiring at least one forced the model
  // to either fabricate a fake one (contradicting an explicit "no backend" constraint) or
  // omit the field entirely - which .array() alone still rejects as a missing required key.
  APIs: z.array(apiDefinitionSchema).default([]),
  events: z.array(eventDefinitionSchema),
  stateOwnership: z.array(stateOwnershipRuleSchema),
  backgroundJobs: z.array(backgroundJobSchema),
  cachingStrategy: z.array(cacheRuleSchema),
  authentication: z.object({ approach: text, details: textList }),
  authorization: z.object({ approach: text, roles: textList, rules: textList }),
  validationStrategy: textList.min(1),
  errorHandlingStrategy: textList.min(1),
  observability: z.object({ logging: textList, metrics: textList, alerts: textList }),
  securityControls: z.array(securityControlSchema).min(1),
  deploymentModel: z.object({ approach: text, environments: textList, steps: textList }),
  migrationStrategy: z.object({ approach: text, steps: textList }),
  backupStrategy: z.object({ approach: text, cadence: text, restoreTest: text }),
  rollbackStrategy: z.object({ approach: text, steps: textList }),
  testStrategy: z.object({ levels: textList, tooling: textList, coverageExpectations: text }),
  performanceTargets: z.array(performanceTargetSchema).min(1),
  scalabilityRisks: textList,
  architectureDecisions: z.array(architectureDecisionSchema).min(3)
});
export type ArchitecturePlan = z.infer<typeof architecturePlanSchema>;

// ---------------------------------------------------------------------------
// Stage 8: Edge-Case Hunter
// ---------------------------------------------------------------------------

export const EDGE_CASE_CATEGORIES = [
  "behaviour",
  "data",
  "visual",
  "mobile",
  "accessibility",
  "security",
  "operations"
] as const;
export const edgeCaseCategorySchema = z.enum(EDGE_CASE_CATEGORIES);
export type EdgeCaseCategory = z.infer<typeof edgeCaseCategorySchema>;

export const edgeCaseFindingSchema = z.object({
  id: text,
  category: edgeCaseCategorySchema,
  scenario: text,
  trigger: text,
  expectedBehaviour: text,
  currentGap: text,
  severity: severitySchema,
  affectedFeatures: textList,
  requiredMitigation: text
});
export type EdgeCaseFinding = z.infer<typeof edgeCaseFindingSchema>;

export const planChangeRequestSchema = z.object({
  section: text,
  problem: text,
  requiredChange: text,
  responsibleStage: z.enum([
    "intent_interpreter",
    "concept_generator",
    "creative_director",
    "feature_expander",
    "ux_designer",
    "art_director",
    "systems_architect",
    "edge_case_hunter",
    "scope_challenger",
    "specification_compiler"
  ])
});
export type PlanChangeRequest = z.infer<typeof planChangeRequestSchema>;

/** Minimum finding counts by category, per the specification. */
export const EDGE_CASE_MINIMUMS: Record<(typeof EDGE_CASE_CATEGORIES)[number], number> = {
  behaviour: 8,
  data: 4,
  visual: 4,
  mobile: 4,
  accessibility: 4,
  security: 4,
  operations: 4
};

export const edgeCaseReportSchema = z
  .object({
    findings: z.array(edgeCaseFindingSchema).min(1),
    systemicRisks: textList,
    highestRiskAreas: textList.min(1),
    missingRecoveryPatterns: textList,
    requiredPlanChanges: z.array(planChangeRequestSchema)
  })
  .superRefine((report, ctx) => {
    const counts = new Map<string, number>();
    for (const finding of report.findings) {
      counts.set(finding.category, (counts.get(finding.category) ?? 0) + 1);
    }
    for (const [category, minimum] of Object.entries(EDGE_CASE_MINIMUMS)) {
      const actual = counts.get(category) ?? 0;
      if (actual < minimum) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings"],
          message: `Category "${category}" has ${actual} finding(s) but requires at least ${minimum}.`
        });
      }
    }
  });
export type EdgeCaseReport = z.infer<typeof edgeCaseReportSchema>;

// ---------------------------------------------------------------------------
// Stage 9: Scope Challenger
// ---------------------------------------------------------------------------

export const SCOPE_CLASSES = [
  "essential",
  "high_value",
  "delight",
  "experimental",
  "future",
  "unnecessary"
] as const;
export const scopeClassSchema = z.enum(SCOPE_CLASSES);
export type ScopeClass = z.infer<typeof scopeClassSchema>;

export const scopeClassificationSchema = z.object({
  itemId: text,
  itemName: text,
  scopeClass: scopeClassSchema,
  rationale: text,
  cheaperAlternative: text.nullable().default(null),
  isSignatureElement: z.boolean().default(false)
});

export const scopePlanSchema = z.object({
  classifications: z.array(scopeClassificationSchema).min(1),
  minimumCompleteProduct: textList.min(1),
  recommendedFirstRelease: textList.min(1),
  premiumRelease: textList,
  experiments: textList,
  deferredItems: textList,
  rejectedItems: textList,
  sequencingRationale: textList.min(1),
  scopeRisks: textList
});
export type ScopePlan = z.infer<typeof scopePlanSchema>;
