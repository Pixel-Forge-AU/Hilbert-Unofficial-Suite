import assert from "node:assert/strict";
import test from "node:test";
import { createAutoplanPlugin } from "./autoplan-plugin.js";

function containsNonAscii(value) {
  return /[^\x00-\x7F]/.test(JSON.stringify(value));
}

async function initPlugin() {
  const tools = [];
  const hooks = new Map();
  const capabilities = new Map();
  const plugin = createAutoplanPlugin();
  await plugin.init({
    registerTool(tool) {
      tools.push(tool);
    },
    provideCapability(name, provider) {
      capabilities.set(name, provider());
    },
    addHook(name, handler) {
      hooks.set(name, handler);
    }
  });
  return { plugin, tools, hooks, capabilities };
}

test("autoplan emits ASCII-safe prompt notes and tool metadata", async () => {
  const { tools, hooks } = await initPlugin();

  assert.equal(tools.length, 3);
  assert.equal(containsNonAscii(tools), false);

  const workerPrompt = await hooks.get("worker:prompt:build")({ lines: ["base"] });
  assert.equal(workerPrompt.lines[0], "base");
  assert.equal(containsNonAscii(workerPrompt.lines), false);

  const intakeTools = await hooks.get("intake:tools:list")({ tools: [] });
  assert.equal(intakeTools.tools.length, 3);
  assert.equal(containsNonAscii(intakeTools.tools), false);
});

test("autoplan tool results stay ASCII-safe", async () => {
  const { hooks } = await initPlugin();
  const callTool = hooks.get("intake:tool-call");

  const resolve = await callTool({
    name: "autoplan_resolve",
    args: { decision: "should i test this fix" }
  });
  assert.equal(resolve.handled, true);
  assert.equal(resolve.result.principle, "completeness");
  assert.equal(containsNonAscii(resolve.result), false);

  const principles = await callTool({
    name: "autoplan_principles",
    args: { abridged: true }
  });
  assert.equal(principles.handled, true);
  assert.equal(containsNonAscii(principles.result), false);

  const checklist = await callTool({
    name: "autoplan_checklist",
    args: { taskDescription: "fix bug in parser" }
  });
  assert.equal(checklist.handled, true);
  assert.equal(containsNonAscii(checklist.result), false);
});

