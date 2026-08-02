import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectsPlugin } from "./projects-plugin.js";

async function createRouteHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projects-plugin-fragments-"));
  const project = { name: "Novel Project", path: path.join(root, "Novel Project") };
  await fs.mkdir(project.path, { recursive: true });

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const context = {
    OBSERVER_OUTPUT_ROOT: root,
    OBSERVER_CONTAINER_OUTPUT_ROOT: root,
    fs,
    path,
    compactTaskText: (value = "", maxLength = 220) => String(value || "").trim().slice(0, maxLength),
    getObserverConfig: () => ({ projects: {} }),
    listContainerWorkspaceProjects: async () => [project],
    readTextFileIfExists: async (filePath = "") => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        return "";
      }
    },
    writeContainerTextFile: async (filePath = "", content = "") => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
  };
  const api = {
    getRuntimeContext: () => context,
    provideCapability: () => {},
    runHook: () => {},
    isEnabled: () => true
  };
  const plugin = createProjectsPlugin();
  await plugin.registerRoutes({ app, api });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(method, pathname, body = undefined) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    return { response, payload };
  }

  return {
    project,
    request,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

test("projects plugin fragment routes cover lifecycle, context, bundle, and prose chain", async (t) => {
  const harness = await createRouteHarness();
  t.after(() => harness.close());

  let result = await harness.request("POST", "/api/projects/fragments", {
    projectName: "Novel Project",
    fragment: {
      type: "guideline",
      name: "Voice",
      content: "Keep the voice tactile and exact.",
      placement: "system"
    }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.ok, true);
  const guidelineId = result.payload.fragment.id;

  result = await harness.request("POST", "/api/projects/fragments", {
    projectName: "Novel Project",
    fragment: {
      type: "character",
      name: "Mira",
      content: "Mira keeps watch over the station.",
      refs: [guidelineId]
    }
  });
  assert.equal(result.response.status, 200);
  const characterId = result.payload.fragment.id;

  result = await harness.request("POST", "/api/projects/fragments", {
    projectName: "Novel Project",
    fragment: {
      type: "prose",
      name: "Opening",
      content: "Mira waited beneath the station clock."
    }
  });
  assert.equal(result.response.status, 200);
  const proseId = result.payload.fragment.id;

  result = await harness.request("PUT", `/api/projects/fragments/${proseId}`, {
    projectName: "Novel Project",
    fragment: {
      content: "Mira waited beneath the cracked station clock."
    },
    reason: "route-test"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.fragment.version, 2);

  result = await harness.request("GET", `/api/projects/fragments?projectName=${encodeURIComponent("Novel Project")}&query=cracked%20station`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.fragments.length, 1);
  assert.equal(result.payload.fragments[0].id, proseId);

  result = await harness.request("GET", `/api/projects/fragments/${characterId}/refs?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.refs[0].id, guidelineId);
  assert.equal(result.payload.refs[0].found, true);

  result = await harness.request("GET", `/api/projects/fragments/${proseId}/versions?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.versions.length, 1);
  assert.equal(result.payload.versions[0].version, 1);

  result = await harness.request("POST", `/api/projects/fragments/${proseId}/versions/1/revert`, {
    projectName: "Novel Project"
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.fragment.content, "Mira waited beneath the station clock.");

  result = await harness.request("GET", `/api/projects/fragment-context?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.match(result.payload.text, /project-system-fragments/);
  assert.match(result.payload.text, /Keep the voice tactile and exact/);

  result = await harness.request("GET", `/api/projects/fragment-validation?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.ok, true);

  result = await harness.request("GET", `/api/projects/fragment-bundle?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.bundle._observer, "project-fragment-bundle");
  assert.ok(result.payload.bundle.fragments.length >= 3);

  result = await harness.request("GET", `/api/projects/fragment-chain?projectName=${encodeURIComponent("Novel Project")}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.chain.entries.length, 1);
  assert.equal(result.payload.chain.entries[0].active, proseId);
});
