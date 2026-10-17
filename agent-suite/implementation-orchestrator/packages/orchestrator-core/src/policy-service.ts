import { DEFAULT_SAFE_POLICY, type ExecutionPolicy } from "@implementation-orchestrator/contracts";

export class UnknownPolicyProfileError extends Error {
  constructor(policyProfileId: string) {
    super(`Unknown policy profile: ${policyProfileId}`);
    this.name = "UnknownPolicyProfileError";
  }
}

const POLICY_PROFILES: Record<string, ExecutionPolicy> = {
  "default-safe": DEFAULT_SAFE_POLICY,
};

export class PolicyService {
  resolve(policyProfileId: string): ExecutionPolicy {
    const policy = POLICY_PROFILES[policyProfileId];
    if (!policy) {
      throw new UnknownPolicyProfileError(policyProfileId);
    }
    return policy;
  }
}
