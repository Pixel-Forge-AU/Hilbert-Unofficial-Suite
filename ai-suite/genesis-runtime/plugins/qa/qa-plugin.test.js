import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createQaPlugin } from "./qa-plugin.js";

async function createQaHookHarness() {
  const plugin = createQaPlugin();
  const tools = [];
  let intakeHook = null;

  await plugin.init({
    registerTool: (tool) => tools.push(tool),
    provideCapability: () => {},
    addHook: (name, handler) => {
      if (name === "intake:tool-call") {
        intakeHook = handler;
      }
    }
  });

  assert.ok(intakeHook);
  return { tools, intakeHook };
}

test("qa_run_tests uses explicit runner commands when auto-detection has no runner", async () => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "qa-plugin-runner-override-"));
  await fs.writeFile(path.join(repoPath, "package.json"), JSON.stringify({ name: "empty-runner-repo" }), "utf8");

  const { tools, intakeHook } = await createQaHookHarness();
  assert.ok(tools.some((tool) => tool.name === "qa_run_tests"));

  const payload = await intakeHook({
    name: "qa_run_tests",
    args: {
      repoPath,
      runner: "npm-test",
      timeoutMs: 10000
    }
  });

  assert.equal(payload.handled, true);
  assert.equal(payload.result.runner, "npm-test");
  assert.equal(payload.result.error, undefined);
  assert.equal(typeof payload.result.exitCode, "number");
});

