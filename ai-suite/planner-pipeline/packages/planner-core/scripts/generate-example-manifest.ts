import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinition } from "@planner/contracts";
import { compileBuildManifest, manifestToMarkdown, manifestToYaml } from "../src/output-compiler.js";
import { VALID_STAGE_OUTPUTS } from "../test/fixtures/valid-stage-outputs.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(currentDir, "../../../examples");

const project: ProjectDefinition = {
  title: "Searchable 3D parts library",
  brief: "Build a searchable parts library for a 3D printing business.",
  constraints: ["Must integrate with WordPress", "Must support more than 5000 parts", "Must work well on mobile"],
  context: { existingStack: ["WordPress", "PHP", "JavaScript"], existingSystems: [], referenceNotes: [] },
  preferences: { strictness: 9, creativity: 9, detailLevel: 10, targetQualityScore: 92, maxRevisionCycles: 4 }
};

const manifest = compileBuildManifest(project, VALID_STAGE_OUTPUTS);

mkdirSync(examplesDir, { recursive: true });
writeFileSync(path.join(examplesDir, "sample-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(examplesDir, "sample-manifest.yaml"), manifestToYaml(manifest));
writeFileSync(path.join(examplesDir, "sample-manifest.md"), manifestToMarkdown(manifest) + "\n");

console.log(`Wrote sample manifest files to ${examplesDir}`);
