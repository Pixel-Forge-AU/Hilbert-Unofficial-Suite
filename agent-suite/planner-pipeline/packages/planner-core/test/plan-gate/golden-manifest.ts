import type { BuildManifest, ProjectDefinition } from "@planner/contracts";
import { compileBuildManifest } from "../../src/output-compiler.js";
import { VALID_STAGE_OUTPUTS } from "../fixtures/valid-stage-outputs.js";

export const goldenProject: ProjectDefinition = {
  title: "Searchable 3D parts library",
  brief: "Build a searchable parts library for a 3D printing business.",
  constraints: ["Must integrate with WordPress", "Must support more than 5000 parts"],
  context: { existingStack: ["WordPress"], existingSystems: [], referenceNotes: [] },
  preferences: { strictness: 9, creativity: 9, detailLevel: 10, targetQualityScore: 92, maxRevisionCycles: 4 }
};

export function goldenManifest(): BuildManifest {
  return compileBuildManifest(goldenProject, VALID_STAGE_OUTPUTS);
}

export function cloneManifest(manifest: BuildManifest): BuildManifest {
  return JSON.parse(JSON.stringify(manifest)) as BuildManifest;
}
