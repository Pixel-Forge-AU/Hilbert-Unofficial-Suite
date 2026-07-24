import {
  EDGE_CASE_MINIMUMS,
  type ArchitecturePlan,
  type CompilerSynthesis,
  type ConceptGeneration,
  type CreativeDirection,
  type EdgeCaseCategory,
  type EdgeCaseFinding,
  type EdgeCaseReport,
  type FeatureExpansion,
  type IntentInterpretation,
  type PlanCritique,
  type PlanGateResult,
  type PlannerStageName,
  type ScopePlan,
  type StageOutputByName,
  type UxJourneyPlan,
  type VisualDirection
} from "@planner/contracts";

/**
 * Minimal but schema-valid outputs for every planner stage. Used to drive the
 * orchestrator end-to-end in integration tests without calling a real model.
 */

const intentInterpretation: IntentInterpretation = {
  projectGoal: "Build a searchable 3D parts library for a printing business.",
  problemStatement: "Customers cannot find printable parts quickly across a large catalogue.",
  targetUsers: [
    {
      id: "U001",
      name: "Hobbyist buyer",
      description: "A customer browsing parts on a phone in a hurry.",
      goals: ["Find a compatible part fast"],
      frustrations: ["Search returns irrelevant results"],
      technicalConfidence: "medium",
      primaryDevice: "mobile",
      accessibilityNeeds: []
    }
  ],
  businessObjectives: ["Increase parts catalogue conversion rate"],
  userObjectives: ["Find the right part in under a minute"],
  desiredEmotions: ["confident", "efficient"],
  hardConstraints: ["Must integrate with WordPress", "Must support more than 5000 parts"],
  softPreferences: ["Feels premium, not generic"],
  explicitRequirements: ["Searchable parts library", "Mobile support"],
  implicitRequirements: ["Fast search response under load"],
  nonGoals: ["Payment processing redesign"],
  assumptions: [
    {
      id: "A001",
      statement: "Parts data can be exported from the existing WordPress catalogue.",
      basis: "No alternative data source was mentioned in the brief.",
      confidence: "medium",
      impactIfWrong: "Would require a new data migration workstream."
    }
  ],
  unansweredQuestions: [
    {
      question: "Should search results be filterable by printer compatibility?",
      whyItMatters: "Affects the filter architecture and indexing strategy.",
      assumedAnswer: "Yes, printer compatibility is a first-class filter.",
      blocking: false
    }
  ],
  risksOfMisinterpretation: ["Treating this as a generic e-commerce search rather than a parts catalogue"],
  successSignals: ["Search-to-detail click-through rate improves"]
};

const conceptGeneration: ConceptGeneration = {
  concepts: [
    {
      id: "C001",
      name: "Reliable Catalogue",
      oneSentencePitch: "A dependable, fast parts search that just works.",
      coreHook: "Instant filtered search with zero dead ends.",
      targetExperience: "Calm, predictable, fast.",
      signatureInteractions: ["Type-ahead search with instant filter chips"],
      signatureFeatures: ["Faceted search", "Saved searches"],
      visualIdentity: "Clean industrial, high contrast, dense data tables.",
      technicalDifferentiators: ["Server-side faceted search index"],
      emotionalPayoff: "Relief at finding the right part immediately.",
      reasonsUsersRememberIt: ["It never returns zero results without a helpful suggestion"],
      risks: ["Feels utilitarian rather than delightful"],
      complexity: "medium"
    },
    {
      id: "C002",
      name: "Premium Workshop",
      oneSentencePitch: "A polished, editorial parts library that feels premium.",
      coreHook: "Cinematic part previews with 3D rotation.",
      targetExperience: "Premium, considered, trustworthy.",
      signatureInteractions: ["Interactive 3D part viewer"],
      signatureFeatures: ["3D preview", "Curated collections"],
      visualIdentity: "Editorial, generous whitespace, large imagery.",
      technicalDifferentiators: ["Client-side 3D model streaming"],
      emotionalPayoff: "Confidence in part quality before purchase.",
      reasonsUsersRememberIt: ["The 3D preview makes parts tangible before buying"],
      risks: ["3D asset pipeline adds significant build cost"],
      complexity: "high"
    },
    {
      id: "C003",
      name: "Playful Workbench",
      oneSentencePitch: "A playful, game-like way to browse parts by build.",
      coreHook: "Build your printer's 'loadout' from compatible parts.",
      targetExperience: "Fun, exploratory, rewarding.",
      signatureInteractions: ["Drag-and-drop loadout builder"],
      signatureFeatures: ["Loadout builder", "Compatibility badges"],
      visualIdentity: "Bright, illustrated, game-like iconography.",
      technicalDifferentiators: ["Real-time compatibility graph evaluation"],
      emotionalPayoff: "Delight at assembling a complete, compatible loadout.",
      reasonsUsersRememberIt: ["It turns shopping into a small game"],
      risks: ["Could feel unserious for professional buyers"],
      complexity: "high"
    },
    {
      id: "C004",
      name: "Ambitious Index",
      oneSentencePitch: "A technically ambitious semantic search over part geometry.",
      coreHook: "Search by shape or function, not just keyword.",
      targetExperience: "Powerful, precise, expert-grade.",
      signatureInteractions: ["Upload a reference shape to find similar parts"],
      signatureFeatures: ["Shape-similarity search", "Function tagging"],
      visualIdentity: "Technical, data-dense, precise typography.",
      technicalDifferentiators: ["Geometry embedding search index"],
      emotionalPayoff: "Feeling like an expert tool, not a toy store.",
      reasonsUsersRememberIt: ["It finds parts no keyword search could"],
      risks: ["Geometry search is a substantial R&D investment"],
      complexity: "extreme"
    },
    {
      id: "C005",
      name: "Strange Archive",
      oneSentencePitch: "A living archive where parts have provenance and stories.",
      coreHook: "Every part shows who printed it and what they built.",
      targetExperience: "Curious, communal, unexpected.",
      signatureInteractions: ["Part 'family tree' of remixes and builds"],
      signatureFeatures: ["Build provenance graph", "Community remix history"],
      visualIdentity: "Archival, annotated, hand-written accents.",
      technicalDifferentiators: ["Provenance graph linking parts to builds"],
      emotionalPayoff: "Wonder at the community history behind a part.",
      reasonsUsersRememberIt: ["It feels alive, not like a static catalogue"],
      risks: ["High complexity for uncertain commercial payoff"],
      complexity: "extreme"
    }
  ],
  spectrumNotes:
    "Concepts range from a safe, reliable catalogue through premium, playful, technically ambitious, and archival directions."
};

const creativeDirection: CreativeDirection = {
  selectedDirection: "Reliable Catalogue with Premium Workshop preview polish",
  directionRationale:
    "Combines dependable faceted search with a premium 3D preview to build trust without the cost of full geometry search.",
  experienceThesis: "Finding the right part should feel as fast as it feels trustworthy.",
  creativePrinciples: [
    "Search must never return a dead end",
    "Every part preview builds purchase confidence",
    "Mobile is the primary surface, not an afterthought"
  ],
  borrowedElements: [
    { fromConceptId: "C002", element: "3D part preview", whyItSurvives: "Directly builds purchase confidence" }
  ],
  signatureFeatures: [
    { id: "SF001", name: "Faceted search", whatMakesItMemorable: "Never a dead end", coreOrOptional: "core_identity" },
    { id: "SF002", name: "3D part preview", whatMakesItMemorable: "Tangible before buying", coreOrOptional: "optional_novelty" },
    { id: "SF003", name: "Saved searches", whatMakesItMemorable: "Fast return visits", coreOrOptional: "core_identity" }
  ],
  discardedIdeas: [
    { idea: "Shape-similarity search", sourceConceptId: "C004", reasonDiscarded: "Too costly for the first release" }
  ],
  designRisks: ["3D preview asset pipeline adds build time"],
  memorabilityTest: [
    "Would a user describe this as 'the search that always finds something'?",
    "Would a user remember the 3D preview specifically?",
    "Would a returning user recall a saved search?"
  ]
};

function flowStep(step: number) {
  return {
    step,
    actor: "Buyer",
    action: `Performs step ${step} of the search flow`,
    systemResponse: `System responds to step ${step}`,
    visibleOutcome: `Visible result of step ${step}`
  };
}

const featureExpansion: FeatureExpansion = {
  features: [
    {
      id: "F001",
      parentId: null,
      name: "Search",
      summary: "Faceted search across the parts catalogue.",
      purpose: "Let buyers find a compatible part quickly.",
      userValue: "Fast, confident discovery of the right part.",
      businessValue: "Higher conversion from search to purchase.",
      actors: ["Buyer"],
      entryPoints: ["Homepage search bar", "Category page search"],
      prerequisites: ["Parts catalogue indexed"],
      primaryFlow: [flowStep(1), flowStep(2), flowStep(3)],
      alternateFlows: [
        { name: "Zero-result recovery", trigger: "Search returns no matches", steps: [flowStep(1)], outcome: "User is offered broader suggestions" }
      ],
      states: [
        { state: "default", description: "Search bar at rest", userSees: "Empty search bar with placeholder", userCanDo: ["Type a query"], exitCondition: "User types" },
        { state: "loading", description: "Results loading", userSees: "Skeleton result rows", userCanDo: ["Cancel"], exitCondition: "Results arrive" },
        { state: "empty", description: "No results", userSees: "No matches message with suggestions", userCanDo: ["Clear filters"], exitCondition: "User clears a filter" },
        { state: "error", description: "Search failed", userSees: "Error message with retry", userCanDo: ["Retry"], exitCondition: "Retry succeeds" },
        { state: "success", description: "Results shown", userSees: "List of matching parts", userCanDo: ["Open a part", "Refine filters"], exitCondition: "User opens a part" },
        { state: "offline", description: "No connectivity", userSees: "Offline banner with cached results", userCanDo: ["View cached results"], exitCondition: "Connectivity restored" }
      ],
      dataRequirements: [{ entity: "Part", fields: ["id", "name", "compatibility"], source: "WordPress catalogue export", freshness: "hourly" }],
      permissions: [{ actor: "Buyer", capability: "Search parts", deniedBehaviour: "Not applicable, search is public" }],
      analyticsEvents: [{ name: "search_performed", trigger: "User submits a query", properties: ["queryLength", "resultCount"] }],
      failureModes: [{ failure: "Search index unavailable", cause: "Index service outage", userVisibleBehaviour: "Error state with retry", recovery: "Automatic retry with backoff" }],
      recoveryBehaviour: ["Automatic retry on transient failure"],
      mobileBehaviour: ["Filters collapse into a bottom sheet on mobile"],
      accessibilityBehaviour: ["Search results are announced via an ARIA live region"],
      privacyConsiderations: ["Search queries are not linked to personal data"],
      dependencies: [],
      acceptanceCriteria: [{ id: "AC001", criterion: "Search returns results within 300ms for 5000+ parts", measurement: "p95 latency under load test" }],
      testScenarios: [{ id: "TS001", name: "Search returns matches", given: "A catalogue of 5000 parts", when: "A buyer searches a known part name", then: "The part appears in the top 3 results", kind: "integration" }],
      openDecisions: ["Should search history be persisted across sessions?"]
    }
  ],
  featureTreeNotes: "Search (F001) is the root feature for this release; later releases add loadout building.",
  crossCuttingConcerns: ["Mobile-first responsive layout", "Accessibility of dynamic search results"]
};

const uxJourneyPlan: UxJourneyPlan = {
  journeys: [
    {
      id: "J001",
      name: "First-time part search",
      actor: "Hobbyist buyer",
      trigger: "Buyer needs a replacement part",
      entryPoint: "Homepage search bar",
      assumptions: ["Buyer arrives from a search engine"],
      steps: [
        { step: 1, location: "Homepage", userThought: "I need to find this part", userAction: "Types a query", systemResponse: "Shows live suggestions", featureIds: ["F001"] },
        { step: 2, location: "Search results", userThought: "Is this the right one?", userAction: "Opens a result", systemResponse: "Shows part detail", featureIds: ["F001"] }
      ],
      decisionPoints: [{ atStep: 1, decision: "Refine search or open first result", options: ["Refine", "Open"], defaultPath: "Open" }],
      emotionalCurve: [{ atStep: 1, emotion: "uncertain", designResponse: "Instant suggestions reduce uncertainty" }],
      confusionRisks: ["Too many filters shown at once on first visit"],
      recoveryPaths: [{ failure: "No results found", recoverySteps: ["Show broader suggestions", "Offer to clear filters"], worstCase: "Buyer leaves the site" }],
      completionSignal: "Buyer opens a part detail page",
      returnPath: "Back button returns to search results with filters intact",
      retentionOpportunity: "Offer to save this search",
      instrumentation: ["search_performed", "search_result_opened"]
    }
  ],
  orientationAnswers: {
    whatIsThis: "A search bar with immediate suggestions communicates purpose instantly.",
    whatCanIDoHere: "Filter chips and a search bar make available actions visible.",
    whatHappensNext: "Loading skeletons signal that results are coming.",
    didTheActionWork: "Result counts and highlighted matches confirm the search worked.",
    canIUndoIt: "Clearing filters and search is always one tap away.",
    whyAmIBlocked: "Zero-result states explain why nothing matched.",
    howDoIRecover: "Suggested broader searches are always offered on zero results.",
    howDoIContinueLater: "Saved searches let a buyer resume later."
  },
  personaCoverageNotes: "First-time and returning mobile buyers are covered by journey J001; further personas are addressed in feature states."
};

const visualDirection: VisualDirection = {
  visualConcept: "Industrial-premium: dense data with confident, generous imagery for previews.",
  visualPrinciples: [
    "Search results prioritise scanability over decoration",
    "Part imagery is always the largest element on a card",
    "Every interactive element has a visible focus state"
  ],
  visualAntiPatterns: [
    "Do not use decorative motion on result loading",
    "Do not hide filters behind more than one tap on mobile",
    "Do not use grey-on-grey text for secondary metadata"
  ],
  layoutSystem: {
    description: "12-column responsive grid with a fixed-width content column.",
    contentMaxWidth: "1180px",
    wideLayoutMaxWidth: "1440px",
    gridColumns: 12,
    mobileGutter: "16px",
    tabletGutter: "24px",
    desktopGutter: "32px",
    breakpoints: [
      { name: "mobile", minWidth: "0px" },
      { name: "desktop", minWidth: "1024px" }
    ]
  },
  typographySystem: {
    headingFont: "Inter",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    baseSizePx: 16,
    scaleRatio: 1.25,
    lineHeights: { body: 1.5, heading: 1.2 },
    weightRules: ["Headings use weight 600", "Body text uses weight 400"]
  },
  spacingSystem: {
    baseUnitPx: 4,
    spacingScale: [4, 8, 12, 16, 24, 32, 48, 64],
    usageRules: ["Card padding uses the 16px step", "Section gaps use the 48px step"]
  },
  colourRoles: [
    { role: "primary", value: "#1D4ED8", usage: "Primary actions", contrastNotes: "Meets 4.5:1 against white" },
    { role: "surface", value: "#FFFFFF", usage: "Card backgrounds", contrastNotes: "Base surface" },
    { role: "danger", value: "#DC2626", usage: "Error states", contrastNotes: "Meets 4.5:1 against white" },
    { role: "text-secondary", value: "#4B5563", usage: "Metadata text", contrastNotes: "Meets 4.5:1 against white" }
  ],
  componentDensity: "Comfortable density with 16px minimum touch targets on mobile.",
  shapeLanguage: { cornerRadii: [4, 8], borderRules: ["1px solid border on cards"], elevationRules: ["Cards use a 1dp shadow on hover"] },
  iconography: { style: "Outlined", strokeWidth: "1.5px", sizes: [16, 20, 24], library: "Lucide" },
  motionSystem: {
    personality: "Quick and functional, never decorative.",
    microInteractionDurationMs: [120, 180],
    panelTransitionDurationMs: [220, 280],
    easingRules: ["Use ease-out for entrances", "Use ease-in for exits"],
    forbiddenMotion: ["No parallax scrolling", "No bouncing loaders"]
  },
  responsiveRules: [
    { breakpoint: "mobile", rule: "Filters collapse into a bottom sheet" },
    { breakpoint: "desktop", rule: "Filters remain visible in a left sidebar" }
  ],
  darkModeRules: ["Surface colours invert to #111827 background"],
  reducedMotionRules: ["Disable panel transitions when prefers-reduced-motion is set"],
  loadingPresentation: ["Use skeleton rows matching final result card shape"],
  emptyStatePersonality: ["Empty states offer a concrete next action, never just an apology"],
  errorPresentation: ["Errors always include a retry action and a support link"],
  screenshotReviewChecklist: [
    "Text contrast meets 4.5:1 on all surfaces",
    "Touch targets are at least 44px on mobile",
    "Focus states are visible on every interactive element",
    "Empty and error states are visually distinct from loading",
    "Part imagery is not cropped awkwardly on any breakpoint"
  ]
};

const architecturePlan: ArchitecturePlan = {
  systemContext: "A search-first parts catalogue integrated with an existing WordPress site.",
  architecturalStyle: "Modular monolith with a dedicated search index service.",
  architecturalPrinciples: [
    "Search must be independently scalable from the WordPress origin",
    "All catalogue data flows through one ingestion pipeline",
    "Every API is documented and owned by exactly one module"
  ],
  modules: [
    { id: "M001", name: "Search Service", responsibility: "Serves faceted search queries", boundaries: "Owns the search index only", dependsOn: ["Catalogue Ingestion"], exposedInterfaces: ["GET /search"] }
  ],
  dataModels: [
    {
      name: "Part",
      purpose: "Represents a printable part in the catalogue",
      fields: [
        { name: "id", type: "string", required: true, notes: "Primary key" },
        { name: "name", type: "string", required: true, notes: "Display name" }
      ],
      relationships: ["belongs to Category"],
      indexes: ["name", "compatibility"],
      retention: "indefinite"
    }
  ],
  APIs: [
    { id: "API001", method: "GET", path: "/search", purpose: "Faceted search over parts", requestShape: "{ q: string, filters: object }", responseShape: "{ results: Part[] }", errors: ["400 invalid filter"], authRequired: false, owner: "Search Service" }
  ],
  events: [{ name: "part.indexed", emittedWhen: "A part is added or updated", payloadShape: "{ partId: string }", consumers: ["Search Service"] }],
  stateOwnership: [{ state: "search index", owner: "Search Service", rationale: "Only the search service writes to the index" }],
  backgroundJobs: [{ name: "catalogue-sync", trigger: "hourly schedule", behaviour: "Pulls updated parts from WordPress and reindexes them", failureHandling: "Retries with exponential backoff, alerts after 3 failures", schedule: "hourly" }],
  cachingStrategy: [{ data: "Popular search results", layer: "Redis", ttl: "5 minutes", invalidation: "On catalogue sync completion" }],
  authentication: { approach: "None required for public search", details: ["Search is a public, unauthenticated endpoint"] },
  authorization: { approach: "Role-based for admin catalogue management", roles: ["buyer", "admin"], rules: ["Only admins can trigger manual reindex"] },
  validationStrategy: ["All API input validated with schema validation at the edge"],
  errorHandlingStrategy: ["All errors return a structured error code and message"],
  observability: { logging: ["Structured JSON logs per request"], metrics: ["search_latency_ms", "search_zero_result_rate"], alerts: ["Alert when zero-result rate exceeds 20%"] },
  securityControls: [{ threat: "Search query injection into index backend", control: "Parameterized query builder, no raw query strings", layer: "Search Service" }],
  deploymentModel: { approach: "Containerized services behind a load balancer", environments: ["staging", "production"], steps: ["Build image", "Run migrations", "Deploy", "Smoke test"] },
  migrationStrategy: { approach: "Expand-and-contract schema migrations", steps: ["Add new columns nullable", "Backfill", "Enforce constraints"] },
  backupStrategy: { approach: "Nightly automated database snapshots", cadence: "nightly", restoreTest: "Monthly restore drill into a staging environment" },
  rollbackStrategy: { approach: "Blue-green deployment with instant traffic switch", steps: ["Route traffic back to previous version", "Investigate failure"] },
  testStrategy: { levels: ["unit", "integration", "e2e"], tooling: ["Vitest", "Testcontainers"], coverageExpectations: "Critical search paths covered by integration tests" },
  performanceTargets: [{ metric: "search p95 latency", target: "under 300ms", measurement: "Load test against 5000+ part catalogue" }],
  scalabilityRisks: ["Search index growth beyond single-node capacity"],
  architectureDecisions: [
    { id: "ADR001", decision: "Use a dedicated search index rather than direct WordPress queries", rationale: "WordPress database cannot serve faceted search at required latency", alternativesConsidered: ["Direct MySQL full-text search"], tradeoffs: ["Adds an ingestion pipeline to operate"], failureModes: ["Index falls out of sync with source data"], futureExtension: "Index can later support shape-similarity search" },
    { id: "ADR002", decision: "Public search API requires no authentication", rationale: "Search is a discovery surface intended for anonymous buyers", alternativesConsidered: ["Requiring account creation before search"], tradeoffs: ["Cannot personalize anonymous search results"], failureModes: ["Potential for scraping abuse"], futureExtension: "Add optional personalization for logged-in users" },
    { id: "ADR003", decision: "Cache popular search results in Redis", rationale: "Reduces repeated load on the search index for common queries", alternativesConsidered: ["No caching layer"], tradeoffs: ["Cache invalidation adds operational complexity"], failureModes: ["Stale cached results after a catalogue update"], futureExtension: "Move to a CDN-edge cache for global buyers" }
  ]
};

function edgeCaseFinding(category: EdgeCaseCategory, index: number): EdgeCaseFinding {
  return {
    id: `EC-${category}-${index}`,
    category,
    scenario: `${category} scenario ${index} affecting search`,
    trigger: `Trigger condition ${index} for ${category}`,
    expectedBehaviour: "The system degrades gracefully with a clear recovery path.",
    currentGap: "No explicit handling defined yet.",
    severity: index % 4 === 0 ? "high" : "medium",
    affectedFeatures: ["F001"],
    requiredMitigation: `Define explicit handling for ${category} case ${index}.`
  };
}

const edgeCaseReport: EdgeCaseReport = {
  findings: (Object.entries(EDGE_CASE_MINIMUMS) as [EdgeCaseCategory, number][]).flatMap(([category, minimum]) =>
    Array.from({ length: minimum }, (_, i) => edgeCaseFinding(category, i + 1))
  ),
  systemicRisks: ["Search reliability under catalogue growth beyond 5000 parts"],
  highestRiskAreas: ["Zero-result recovery", "Offline search behaviour"],
  missingRecoveryPatterns: ["No offline cached-results fallback defined for repeat searches"],
  requiredPlanChanges: [
    {
      section: "features.F001.states",
      problem: "No offline recovery state defined for search.",
      requiredChange: "Add an offline state showing cached results with a stale-data indicator.",
      responsibleStage: "feature_expander"
    }
  ]
};

const scopePlan: ScopePlan = {
  classifications: [
    { itemId: "F001", itemName: "Search", scopeClass: "essential", rationale: "Core value proposition of the product.", cheaperAlternative: null, isSignatureElement: true },
    { itemId: "SF002", itemName: "3D part preview", scopeClass: "delight", rationale: "Strong differentiator but not required for launch.", cheaperAlternative: "Static high-resolution photos", isSignatureElement: true }
  ],
  minimumCompleteProduct: ["F001"],
  recommendedFirstRelease: ["F001", "SF003"],
  premiumRelease: ["SF002"],
  experiments: ["Shape-similarity search prototype"],
  deferredItems: ["Build provenance graph"],
  rejectedItems: [],
  sequencingRationale: ["Search must ship before any premium preview feature since it is the core hook."],
  scopeRisks: ["3D preview asset pipeline could slip the premium release date"]
};

const compilerSynthesis: CompilerSynthesis = {
  experiencePrinciples: [
    "Search must never return a dead end",
    "Every part preview builds purchase confidence",
    "Mobile is the primary surface, not an afterthought"
  ],
  implementationPlan: {
    phases: [
      { id: "P1", name: "Foundation search", goal: "Ship faceted search over the full catalogue", includedFeatureIds: ["F001"], exitCriteria: ["Search returns results within 300ms p95 for 5000+ parts"] }
    ],
    workstreams: [{ id: "W1", name: "Search platform", description: "Search indexing and query API", phaseIds: ["P1"] }],
    dependencyGraph: [{ from: "Catalogue ingestion", to: "Search Service", reason: "Search indexes data produced by ingestion" }],
    proposedRepositoryStructure: [{ path: "apps/search-service", kind: "directory", purpose: "Search indexing and query API" }],
    fileResponsibilities: [{ path: "apps/search-service/src/index.ts", responsibility: "Search query handler", relatedFeatureIds: ["F001"] }],
    databaseChanges: [{ id: "DB1", change: "Add parts table with search indexes", phaseId: "P1", reversible: true }],
    apiBuildOrder: ["GET /search"],
    uiBuildOrder: ["Search bar", "Search results list"],
    testBuildOrder: ["Search API integration tests", "Search UI accessibility tests"],
    releaseCheckpoints: [{ id: "RC1", name: "Search MVP launch", afterPhaseId: "P1", verification: ["Load test passes at 5000+ parts", "Accessibility checklist passes"] }]
  },
  qualityRequirements: {
    performance: ["Search p95 latency under 300ms"],
    accessibility: ["Search results announced via ARIA live region"],
    security: ["No raw query strings passed to the search backend"],
    reliability: ["Search degrades to cached results on index outage"],
    compatibility: ["Supports the latest two versions of major mobile browsers"]
  },
  definitionOfDone: [
    { id: "DOD1", item: "Search returns results within performance targets", verification: "Load test report" },
    { id: "DOD2", item: "All UI states defined for search are implemented", verification: "Manual QA against state list" },
    { id: "DOD3", item: "Accessibility checklist passes for search", verification: "Automated + manual accessibility audit" },
    { id: "DOD4", item: "Offline recovery state is implemented", verification: "Manual QA with network throttling" },
    { id: "DOD5", item: "Search API documented via OpenAPI", verification: "OpenAPI schema review" }
  ],
  unresolvedDecisions: [
    { id: "UD1", decision: "Should search history persist across sessions?", options: ["Yes, persist per account", "No, session-only"], recommendation: "Session-only for the first release", blockedBy: "awaiting stakeholder input" }
  ],
  traceability: {
    entries: [
      {
        sourceRequirement: "Must work well on mobile",
        origin: "brief",
        featureIds: ["F001"],
        journeyIds: ["J001"],
        architectureIds: ["ADR001"],
        acceptanceCriteriaIds: ["AC001"],
        testScenarioIds: ["TS001"]
      }
    ],
    untracedItems: []
  }
};

const passingCritique: PlanCritique = {
  passed: true,
  overallScore: 93,
  categoryScores: {
    creativity: 90,
    completeness: 92,
    uxDefinition: 91,
    visualDefinition: 90,
    technicalDepth: 90,
    testability: 90,
    consistency: 92,
    feasibility: 91,
    accessibility: 88,
    resilience: 88
  },
  blockingIssues: [],
  majorIssues: [],
  minorIssues: [],
  contradictions: [],
  genericLanguageFindings: [],
  missingSections: [],
  revisionRequests: [],
  summary: "The plan is complete, concrete, and internally consistent."
};

export const failingCritique: PlanCritique = {
  ...passingCritique,
  passed: false,
  overallScore: 70,
  majorIssues: [
    {
      id: "CF001",
      sectionPath: "designSystem.motionSystem",
      problem: "Motion durations are unmeasured.",
      evidence: "microInteractionDurationMs was a placeholder range.",
      requiredChange: "Provide concrete millisecond values grounded in usability norms.",
      severity: "major",
      responsibleStage: "art_director"
    }
  ],
  revisionRequests: [
    {
      section: "designSystem.motionSystem",
      problem: "Motion durations are unmeasured.",
      requiredChange: "Provide concrete millisecond values grounded in usability norms.",
      responsibleStage: "art_director",
      severity: "major"
    }
  ],
  summary: "The plan is close but the visual motion system lacks concrete values."
};

const planGateResult: PlanGateResult = {
  decision: "passed",
  findings: [],
  errorCount: 0,
  warningCount: 0,
  noticeCount: 0,
  coverage: {
    essentialFeaturesWithAcceptanceCriteria: 1,
    essentialFeaturesWithTestScenarios: 1,
    requirementsWithTraceability: 1,
    featuresAssignedToImplementationPhase: 1
  },
  adjudicationUsed: false,
  summary: "The compiled manifest is internally consistent, fully referenced, and implementation-ready with no findings."
};

export const VALID_STAGE_OUTPUTS: StageOutputByName = {
  intent_interpreter: intentInterpretation,
  concept_generator: conceptGeneration,
  creative_director: creativeDirection,
  feature_expander: featureExpansion,
  ux_designer: uxJourneyPlan,
  art_director: visualDirection,
  systems_architect: architecturePlan,
  edge_case_hunter: edgeCaseReport,
  scope_challenger: scopePlan,
  specification_compiler: compilerSynthesis,
  plan_critic: passingCritique,
  plan_gate: planGateResult
};

export function validOutputFor(stage: PlannerStageName): StageOutputByName[PlannerStageName] {
  return VALID_STAGE_OUTPUTS[stage];
}
