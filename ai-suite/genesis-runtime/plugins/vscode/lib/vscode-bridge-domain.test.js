import assert from "node:assert/strict";
import { createVSCodeBridgeDomain } from "./vscode-bridge-domain.js";

function createMemoryData() {
  const store = new Map();
  return {
    async readJson(key, fallback = null) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async writeJson(key, value) {
      store.set(key, value);
      return value;
    }
  };
}

async function run() {
  const data = createMemoryData();
  const transactions = new Map();
  const coreTransactions = {
    async proposeExternalEditTransaction(input) {
      const record = {
        id: `txn-${input.requestId}`,
        status: "proposed",
        input
      };
      transactions.set(record.id, record);
      return record;
    },
    async completeExternalTransaction(id, result) {
      const record = transactions.get(id);
      record.status = result.ok === false ? "failed" : "applied";
      record.result = result;
      return record;
    }
  };
  const domain = createVSCodeBridgeDomain({ data, coreTransactions });
  const pairing = await domain.getPairingInfo({ ip: "127.0.0.1" });
  assert.equal(typeof pairing.pairingToken, "string");
  assert.ok(pairing.pairingToken.length >= 32);

  const summary = await domain.upsertSnapshot({
    sessionId: "test",
    workspaceName: "Example",
    workspaceFolders: ["C:\\repo\\example"],
    activeEditor: {
      path: "C:\\repo\\example\\README.md",
      languageId: "markdown",
      text: "# Example\n"
    },
    files: [
      { path: "C:\\repo\\example\\README.md", type: "file" },
      { path: "C:\\repo\\example\\src", type: "directory" }
    ],
    diagnostics: [
      { path: "C:\\repo\\example\\src\\main.js", message: "Missing semicolon", severity: "warning" }
    ],
    git: {
      branch: "main",
      statusText: " M README.md",
      changedFiles: [{ path: "README.md", status: "modified" }]
    }
  }, pairing.pairingToken);
  assert.equal(summary.sessionId, "test");
  assert.equal(summary.activeFile, "C:/repo/example/README.md");

  const context = domain.getContext({ sessionId: "test" });
  assert.equal(context.connected, true);
  assert.equal(context.summary.workspaceName, "Example");

  const readme = domain.readFile({ sessionId: "test", path: "README.md" });
  assert.equal(readme.found, true);
  assert.match(readme.text, /# Example/);

  const diagnostics = domain.getDiagnostics({ sessionId: "test" });
  assert.equal(diagnostics.diagnostics.length, 1);

  const contextWithBadLimit = domain.getContext({ sessionId: "test", diagnosticLimit: "not-a-number" });
  assert.equal(contextWithBadLimit.diagnostics.length, 1);

  const filesWithBadLimit = domain.listFiles({ sessionId: "test", limit: "not-a-number" });
  assert.equal(filesWithBadLimit.files.length, 2);

  const readmeWithBadNumbers = domain.readFile({
    sessionId: "test",
    path: "README.md",
    offset: "not-a-number",
    maxChars: "also-bad"
  });
  assert.equal(readmeWithBadNumbers.found, true);
  assert.match(readmeWithBadNumbers.text, /# Example/);

  const diagnosticsWithBadLimit = domain.getDiagnostics({ sessionId: "test", limit: "not-a-number" });
  assert.equal(diagnosticsWithBadLimit.diagnostics.length, 1);

  const edit = await domain.requestEdit({
    sessionId: "test",
    path: "README.md",
    oldText: "# Example",
    newText: "# Example Project"
  });
  assert.equal(edit.queued, true);
  assert.match(edit.request.transactionId, /^txn-/);

  const pending = await domain.listPendingRequests({ sessionId: "test" }, pairing.pairingToken);
  assert.equal(pending.requests.length, 1);

  const completed = await domain.completeRequest(pending.requests[0].id, { ok: true }, pairing.pairingToken);
  assert.equal(completed.request.status, "completed");
  assert.equal(completed.request.transaction.status, "applied");

  const restored = createVSCodeBridgeDomain({ data });
  const restoredPending = await restored.listPendingRequests({ sessionId: "test" }, pairing.pairingToken);
  assert.equal(restoredPending.requests.length, 0);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
