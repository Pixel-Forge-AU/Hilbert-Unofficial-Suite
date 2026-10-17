/**
 * Plugin Name: VS Code Bridge
 * Plugin Slug: vscode
 * Description: Local VS Code context bridge for Nova workspace awareness and approval-oriented file edits.
 * Version: 0.1.0
 * Author: Nova Observer
 * Observer UI Panel: No
 */

import { createVSCodeBridgeDomain } from "./lib/vscode-bridge-domain.js";

const TOOL_DEFINITIONS = [
  {
    name: "vscode_get_context",
    description: "Get the latest connected VS Code workspace context, including active file, open editors, diagnostics, and git summary.",
    scopes: ["worker"],
    risk: "normal",
    parameters: { sessionId: "string", includeOpenEditors: "boolean", diagnosticLimit: "number" }
  },
  {
    name: "vscode_list_files",
    description: "List files from the latest VS Code workspace snapshot. Use query to filter by path.",
    scopes: ["worker"],
    risk: "normal",
    parameters: { sessionId: "string", query: "string", limit: "number" }
  },
  {
    name: "vscode_read_file",
    description: "Read file contents supplied by VS Code for an open or included workspace file.",
    scopes: ["worker"],
    risk: "normal",
    parameters: { sessionId: "string", path: "string", offset: "number", maxChars: "number" }
  },
  {
    name: "vscode_get_diagnostics",
    description: "Get VS Code diagnostics/problems for the workspace or a matching path.",
    scopes: ["worker"],
    risk: "normal",
    parameters: { sessionId: "string", path: "string", limit: "number" }
  },
  {
    name: "vscode_git_status",
    description: "Get the git branch, status text, changed files, and diff summary supplied by VS Code.",
    scopes: ["worker"],
    risk: "normal",
    parameters: { sessionId: "string" }
  },
  {
    name: "vscode_request_edit",
    description: "Queue an edit request for the connected VS Code extension to show and apply after user approval.",
    scopes: ["worker"],
    risk: "high",
    parameters: { sessionId: "string", path: "string", oldText: "string", newText: "string", content: "string", instructions: "string", title: "string" }
  }
];

function sendRouteError(res, error) {
  const status = Number(error?.statusCode || error?.status || 500);
  res.status(status).json({
    ok: false,
    error: String(error?.message || error || "VS Code bridge error")
  });
}

export function createVSCodePlugin(options = {}) {
  const {
    pluginId = "vscode",
    pluginName = "VS Code Bridge",
    description = "Local VS Code context bridge for Nova."
  } = options;

  let domain = null;

  function getDomain(api) {
    if (!domain) {
      domain = createVSCodeBridgeDomain({
        data: api.data,
        coreTransactions: api.getRuntimeContext?.()?.coreTransactions || null
      });
    }
    return domain;
  }

  async function handleToolCall(api, payload = {}) {
    const name = String(payload?.name || "").trim();
    const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
      return payload;
    }
    const d = getDomain(api);
    try {
      let result = null;
      if (name === "vscode_get_context") result = d.getContext(args);
      if (name === "vscode_list_files") result = d.listFiles(args);
      if (name === "vscode_read_file") result = d.readFile(args);
      if (name === "vscode_get_diagnostics") result = d.getDiagnostics(args);
      if (name === "vscode_git_status") result = d.getGitStatus(args);
      if (name === "vscode_request_edit") result = await d.requestEdit(args);
      return { ...payload, handled: true, result };
    } catch (error) {
      return {
        ...payload,
        handled: true,
        result: {
          error: true,
          message: String(error?.message || error || "VS Code bridge tool failed")
        }
      };
    }
  }

  return {
    id: pluginId,
    name: pluginName,
    version: "0.1.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: false,
        data: true,
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
        capabilities: ["vscode.status"],
        hooks: ["intake:tool-call", "worker:prompt:build"],
        runtimeContext: ["coreTransactions"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },

    async init(api) {
      const d = getDomain(api);
      await d.ensureSettings();

      if (typeof api.registerTool === "function") {
        for (const tool of TOOL_DEFINITIONS) {
          api.registerTool(tool);
        }
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("vscode.status", () => d.getStatus());
      }

      if (typeof api.addHook === "function") {
        api.addHook("intake:tool-call", async (payload = {}) => handleToolCall(api, payload));
        api.addHook("worker:prompt:build", async (payload = {}) => {
          const status = d.getStatus();
          if (!status.connected) {
            return payload;
          }
          const lines = Array.isArray(payload?.lines) ? payload.lines.slice() : [];
          lines.push(
            "VS Code context is connected. For questions about the user's current editor, open files, project files, diagnostics, git state, or README/docs in the active project, use the vscode_* tools before falling back to the sandbox workspace.",
            "Use vscode_request_edit for real VS Code project edits; it queues an approval-oriented edit request for the extension instead of directly writing host files."
          );
          return { ...payload, lines };
        });
      }
    },

    async registerRoutes({ app, api }) {
      const d = getDomain(api);

      app.get("/api/vscode-bridge/status", async (_req, res) => {
        res.json({ ok: true, ...d.getStatus() });
      });

      app.get("/api/vscode-bridge/pairing", async (req, res) => {
        try {
          const pairing = await d.getPairingInfo(req);
          res.json({ ok: true, ...pairing });
        } catch (error) {
          sendRouteError(res, error);
        }
      });

      app.post("/api/vscode-bridge/snapshot", async (req, res) => {
        try {
          const summary = await d.upsertSnapshot(req.body || {}, d.getBearerToken(req));
          res.json({ ok: true, session: summary });
        } catch (error) {
          sendRouteError(res, error);
        }
      });

      app.get("/api/vscode-bridge/requests", async (req, res) => {
        try {
          const result = await d.listPendingRequests({ sessionId: req.query?.sessionId }, d.getBearerToken(req));
          res.json({ ok: true, ...result });
        } catch (error) {
          sendRouteError(res, error);
        }
      });

      app.post("/api/vscode-bridge/requests/:requestId/complete", async (req, res) => {
        try {
          const result = await d.completeRequest(String(req.params?.requestId || ""), req.body || {}, d.getBearerToken(req));
          res.json({ ok: true, ...result });
        } catch (error) {
          sendRouteError(res, error);
        }
      });
    }
  };
}

export default createVSCodePlugin;
