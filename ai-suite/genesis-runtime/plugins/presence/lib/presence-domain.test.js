import assert from "node:assert/strict";
import test from "node:test";
import { createPresenceDomain } from "./presence-domain.js";

function createMemoryData() {
  const store = new Map();
  return {
    async readJson(key, fallback) {
      if (!store.has(key)) {
        return fallback;
      }
      return JSON.parse(JSON.stringify(store.get(key)));
    },
    async writeJson(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    }
  };
}

test("presence condenses related fragments into a thread and keeps key notes", async () => {
  const queued = [];
  const domain = createPresenceDomain({
    data: createMemoryData(),
    runtime: {
      async createQueuedTask(task) {
        queued.push(task);
        return { id: `task-${queued.length}` };
      }
    }
  });

  const sourceIdentity = { label: "Derek", trustLevel: "known" };
  const first = await domain.observe({
    text: "Alpha launch meeting with Mia tomorrow.",
    sourceIdentity,
    observedAt: 100_000
  });
  const second = await domain.observe({
    text: "What time should we schedule it?",
    sourceIdentity,
    observedAt: 120_000
  });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(queued.length, 1);
  assert.match(queued[0].message, /Presence distilled a coherent question/);
  assert.match(queued[0].message, /Context: Alpha launch meeting with Mia tomorrow\. What time should we schedule it\?/);

  const threads = await domain.listThreads();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].observations.length, 2);
  assert.match(threads[0].summary, /Alpha launch meeting/);
  assert.deepEqual(threads[0].notes.questions, ["What time should we schedule it?"]);
  assert(threads[0].notes.events.some((note) => /meeting/i.test(note)));
  assert(threads[0].notes.mentions.includes("Mia"));
});

test("presence does not queue low-signal question fragments", async () => {
  const queued = [];
  const domain = createPresenceDomain({
    data: createMemoryData(),
    runtime: {
      async createQueuedTask(task) {
        queued.push(task);
        return { id: `task-${queued.length}` };
      }
    }
  });

  const result = await domain.observe({
    text: "What about it?",
    sourceIdentity: { label: "Derek", trustLevel: "known" },
    observedAt: 200_000
  });

  assert.equal(result.accepted, true);
  assert.equal(result.thread.question, "");
  assert.equal(queued.length, 0);
});

test("presence records task notes without auto-creating todos by default", async () => {
  const domain = createPresenceDomain({ data: createMemoryData() });
  const result = await domain.observe({
    text: "Please follow up with Sam about the design review notes.",
    sourceIdentity: { label: "Derek", trustLevel: "known" },
    observedAt: 300_000
  });

  assert.equal(result.accepted, true);
  assert(result.thread.notes.tasks.some((note) => /follow up with Sam/i.test(note)));
  assert.equal(result.observation.effects.todoId, "");
});
