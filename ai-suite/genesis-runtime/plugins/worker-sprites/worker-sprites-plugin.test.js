import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerSpritesPlugin } from "./worker-sprites-plugin.js";

test("worker sprites subscribes to queue task creation through the plugin hook protocol", async () => {
  const plugin = createWorkerSpritesPlugin();
  let registeredHook = null;
  const observerEvents = [];

  assert.deepEqual(plugin.manifest.permissions.hooks, ["queue:task-created"]);
  assert.ok(plugin.manifest.permissions.runtimeContext.includes("broadcastObserverEvent"));

  await plugin.init({
    provideCapability: () => {},
    registerUiNovaTab: () => {},
    getRuntimeContext: () => ({
      broadcastObserverEvent: (event) => observerEvents.push(event)
    }),
    addHook: (name, handler) => {
      registeredHook = { name, handler };
    }
  });

  assert.equal(registeredHook?.name, "queue:task-created");
  const payload = {
    taskId: "task-1",
    codename: "bright-signal-abcd",
    brainId: "worker",
    message: "Create a visual receipt."
  };
  const result = await registeredHook.handler(payload);

  assert.equal(result, payload);
  assert.equal(observerEvents.length, 1);
  assert.equal(observerEvents[0].type, "worker-sprites.request-queued");
  assert.equal(observerEvents[0].taskRef, "bright-signal-abcd");
});
