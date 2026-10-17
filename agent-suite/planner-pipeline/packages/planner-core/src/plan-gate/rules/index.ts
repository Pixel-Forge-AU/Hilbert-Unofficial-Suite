import type { PlanGateRule } from "../types.js";
import { acceptanceCriterionQualityRules } from "./acceptance-criterion-quality.js";
import { dependencyValidationRules } from "./dependency-validation.js";
import { implementationReadinessRules } from "./implementation-readiness.js";
import { referenceIntegrityRules } from "./reference-integrity.js";
import { stackCompatibilityRules } from "./stack-compatibility.js";
import { unresolvedDecisionRules } from "./unresolved-decisions.js";

export const PLAN_GATE_RULES: PlanGateRule[] = [
  ...referenceIntegrityRules,
  ...dependencyValidationRules,
  ...implementationReadinessRules,
  ...acceptanceCriterionQualityRules,
  ...unresolvedDecisionRules,
  ...stackCompatibilityRules
];
