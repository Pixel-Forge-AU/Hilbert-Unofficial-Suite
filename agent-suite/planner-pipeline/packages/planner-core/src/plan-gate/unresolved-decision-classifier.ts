import type { UnresolvedDecision, UnresolvedDecisionImpact } from "@planner/contracts";

export interface UnresolvedDecisionClassification {
  impact: UnresolvedDecisionImpact;
  ambiguous: boolean;
  matchedKeywords: string[];
}

const IMPLEMENTATION_BLOCKING_KEYWORDS = [
  "authentication",
  "auth provider",
  "database engine",
  "payment gateway",
  "payment processing",
  "encryption",
  "gdpr",
  "data residency",
  "hosting provider",
  "core architecture",
  "identity provider",
  "billing system"
];

const PHASE_BLOCKING_KEYWORDS = [
  "pricing model",
  "onboarding flow",
  "primary navigation",
  "api version",
  "third-party integration",
  "notification strategy",
  "release sequencing",
  "launch phase"
];

const INFORMATIONAL_KEYWORDS = [
  "copy",
  "icon",
  "colour",
  "color",
  "label text",
  "wording",
  "microcopy",
  "illustration",
  "tone of voice",
  "font choice"
];

const BORDERLINE_KEYWORDS = ["integration", "provider", "vendor", "migration", "compliance", "platform"];

function matchKeywords(haystack: string, keywords: string[]): string[] {
  const lower = haystack.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

export function classifyUnresolvedDecision(decision: UnresolvedDecision): UnresolvedDecisionClassification {
  const text = `${decision.decision} ${decision.options.join(" ")}`;

  const implementationBlocking = matchKeywords(text, IMPLEMENTATION_BLOCKING_KEYWORDS);
  if (implementationBlocking.length > 0) {
    return { impact: "implementation_blocking", ambiguous: false, matchedKeywords: implementationBlocking };
  }

  const phaseBlocking = matchKeywords(text, PHASE_BLOCKING_KEYWORDS);
  if (phaseBlocking.length > 0) {
    return { impact: "phase_blocking", ambiguous: false, matchedKeywords: phaseBlocking };
  }

  const informational = matchKeywords(text, INFORMATIONAL_KEYWORDS);
  if (informational.length > 0) {
    return { impact: "informational", ambiguous: false, matchedKeywords: informational };
  }

  const borderline = matchKeywords(text, BORDERLINE_KEYWORDS);
  if (borderline.length > 0) {
    return { impact: "task_local", ambiguous: true, matchedKeywords: borderline };
  }

  return { impact: "task_local", ambiguous: false, matchedKeywords: [] };
}
