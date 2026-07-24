import {
  BuildManifestSchema,
  isSupportedManifestVersion,
  type BuildManifest,
} from "@implementation-orchestrator/contracts";
import { deriveCompilationManifest } from "./manifest-projection.js";

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: BuildManifest;
}

export class ManifestValidationService {
  validate(rawManifest: unknown): ManifestValidationResult {
    const parsed = BuildManifestSchema.safeParse(rawManifest);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`),
        warnings: [],
      };
    }

    const manifest = parsed.data;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!isSupportedManifestVersion(manifest.manifestVersion)) {
      errors.push(`Unsupported manifest version: ${manifest.manifestVersion}`);
    }

    if (manifest.planGate.decision === "rejected") {
      errors.push(`Manifest's plan gate decision is "rejected": ${manifest.planGate.summary}`);
    }

    const compilation = deriveCompilationManifest(manifest);

    const featureIds = new Set(compilation.features.map((feature) => feature.id));
    const essentialFeatures = compilation.features.filter((feature) => feature.priority === "essential");
    if (essentialFeatures.length === 0) {
      errors.push("Manifest must declare at least one essential feature.");
    }
    for (const feature of essentialFeatures) {
      if (feature.acceptanceCriteria.length === 0) {
        errors.push(`Essential feature "${feature.id}" has no acceptance criteria.`);
      }
    }
    for (const feature of compilation.features) {
      for (const dependencyId of feature.dependsOn) {
        if (!featureIds.has(dependencyId)) {
          errors.push(`Feature "${feature.id}" depends on unknown feature "${dependencyId}".`);
        }
      }
    }

    const phaseIds = new Set(compilation.phases.map((phase) => phase.id));
    for (const phase of compilation.phases) {
      for (const featureId of phase.featureIds) {
        if (!featureIds.has(featureId)) {
          errors.push(`Phase "${phase.id}" references unknown feature "${featureId}".`);
        }
      }
      for (const dependencyId of phase.dependsOn) {
        if (!phaseIds.has(dependencyId)) {
          errors.push(`Phase "${phase.id}" depends on unknown phase "${dependencyId}".`);
        }
      }
    }

    const referencedFeatureIds = new Set(compilation.phases.flatMap((phase) => phase.featureIds));
    for (const feature of compilation.features) {
      if (!referencedFeatureIds.has(feature.id)) {
        warnings.push(`Feature "${feature.id}" is not referenced by any implementation phase.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: errors.length === 0 ? manifest : undefined,
    };
  }
}
