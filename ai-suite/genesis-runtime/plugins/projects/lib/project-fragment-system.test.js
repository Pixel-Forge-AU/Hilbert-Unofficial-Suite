import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectFragmentSystem } from "./project-fragment-system.js";

test("project fragment system stores fragments, versions updates, and builds context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-fragments-"));
  const project = { name: "Novel Project", path: path.join(root, "Novel Project") };
  await fs.mkdir(project.path, { recursive: true });
  const system = createProjectFragmentSystem({
    fs,
    path,
    listContainerWorkspaceProjects: async () => [project]
  });

  const guideline = await system.createProjectFragment({
    projectName: "Novel Project",
    fragment: {
      type: "guideline",
      name: "Voice",
      description: "Narration rule",
      content: "Keep the narration close and sensory.",
      placement: "system"
    }
  });
  assert.equal(guideline.fragment.type, "guideline");
  assert.equal(guideline.fragment.sticky, true);

  const character = await system.createProjectFragment({
    projectName: "Novel Project",
    fragment: {
      type: "character",
      name: "Mira",
      description: "Station keeper",
      content: "Mira keeps watch over the old station.",
      refs: [guideline.fragment.id]
    }
  });
  const refs = await system.getProjectFragmentRefs({
    projectName: "Novel Project",
    fragmentId: character.fragment.id
  });
  assert.equal(refs.refs[0].id, guideline.fragment.id);
  assert.equal(refs.refs[0].found, true);
  assert.equal(refs.backRefs.length, 0);

  const prose = await system.createProjectFragment({
    projectName: "Novel Project",
    fragment: {
      type: "prose",
      name: "Opening",
      content: "Mira waited beneath the station clock."
    }
  });
  assert.match(prose.fragment.id, /^pr-/);

  const updated = await system.updateProjectFragment({
    projectName: "Novel Project",
    fragmentId: prose.fragment.id,
    fragment: {
      content: "Mira waited beneath the cracked station clock."
    },
    reason: "test-update"
  });
  assert.equal(updated.fragment.version, 2);
  assert.equal(updated.fragment.versions.length, 1);
  assert.equal(updated.fragment.versions[0].reason, "test-update");

  const reverted = await system.revertProjectFragmentVersion({
    projectName: "Novel Project",
    fragmentId: prose.fragment.id,
    version: 1
  });
  assert.equal(reverted.fragment.version, 3);
  assert.equal(reverted.fragment.content, "Mira waited beneath the station clock.");

  await system.updateProjectFragment({
    projectName: "Novel Project",
    fragmentId: prose.fragment.id,
    fragment: {
      content: "Mira waited beneath the cracked station clock."
    },
    reason: "restore-test-flow"
  });

  const alternate = await system.createProjectFragment({
    projectName: "Novel Project",
    fragment: {
      type: "prose",
      name: "Opening variation",
      content: "Mira waited under the clock while rain worried the roof."
    },
    addToChain: false
  });
  await system.addProjectProseVariation({
    projectName: "Novel Project",
    sectionIndex: 0,
    fragmentId: alternate.fragment.id
  });
  let chain = await system.getProjectProseChain({ projectName: "Novel Project" });
  assert.equal(chain.chain.entries[0].active, alternate.fragment.id);
  assert.equal(chain.chain.entries[0].fragments.length, 2);

  await system.switchActiveProjectProse({
    projectName: "Novel Project",
    sectionIndex: 0,
    fragmentId: prose.fragment.id
  });
  chain = await system.getProjectProseChain({ projectName: "Novel Project" });
  assert.equal(chain.chain.entries[0].active, prose.fragment.id);

  const secondSection = await system.createProjectFragment({
    projectName: "Novel Project",
    fragment: {
      type: "prose",
      name: "Second section",
      content: "The train arrived without a driver."
    }
  });
  chain = await system.getProjectProseChain({ projectName: "Novel Project" });
  assert.equal(chain.chain.entries.length, 2);
  assert.equal(chain.chain.entries[1].active, secondSection.fragment.id);

  await system.moveProjectProseSection({
    projectName: "Novel Project",
    fromIndex: 1,
    toIndex: 0
  });
  chain = await system.getProjectProseChain({ projectName: "Novel Project" });
  assert.equal(chain.chain.entries[0].active, secondSection.fragment.id);

  await system.removeProjectProseSection({
    projectName: "Novel Project",
    sectionIndex: 0
  });
  chain = await system.getProjectProseChain({ projectName: "Novel Project" });
  assert.equal(chain.chain.entries.length, 1);
  assert.equal(chain.chain.entries[0].active, prose.fragment.id);

  const listed = await system.listProjectFragments({
    projectName: "Novel Project",
    query: "cracked station"
  });
  assert.equal(listed.fragments.length, 1);
  assert.equal(listed.fragments[0].id, prose.fragment.id);

  const context = await system.buildProjectFragmentContext({
    projectName: "Novel Project"
  });
  assert.match(context.text, /project-system-fragments/);
  assert.match(context.text, /Keep the narration close and sensory/);
  assert.match(context.text, /cracked station clock/);
  assert.equal(context.summary.proseSectionCount, 1);

  const validation = await system.validateProjectFragments({ projectName: "Novel Project" });
  assert.equal(validation.ok, true);

  const bundle = await system.exportProjectFragmentBundle({ projectName: "Novel Project" });
  assert.equal(bundle._observer, "project-fragment-bundle");
  assert.ok(bundle.fragments.length >= 3);

  const importRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-fragments-import-"));
  const importProject = { name: "Imported Novel", path: path.join(importRoot, "Imported Novel") };
  await fs.mkdir(importProject.path, { recursive: true });
  const importSystem = createProjectFragmentSystem({
    fs,
    path,
    listContainerWorkspaceProjects: async () => [importProject]
  });
  const imported = await importSystem.importProjectFragmentBundle({
    projectName: "Imported Novel",
    bundle
  });
  assert.ok(imported.importedCount >= 3);
  const importedValidation = await importSystem.validateProjectFragments({ projectName: "Imported Novel" });
  assert.equal(importedValidation.ok, true);
});
