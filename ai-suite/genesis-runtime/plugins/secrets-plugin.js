// Extracted from genesis-core's server/observer-secrets-service.js. The OS-keychain CRUD
// primitives are preserved almost verbatim; the "secrets catalog" aggregator from
// observer-config-secrets-domain.js was deliberately NOT ported — it worked by importing
// every other domain (mail, wordpress, iot, retrieval) directly to build one global status
// view, which is exactly the kind of cross-plugin coupling this extraction is meant to
// remove. Each plugin that owns secrets should report its own status via its own UI panel;
// this plugin only provides the primitive get/set/has/delete + handle-building capabilities.
import keytar from "keytar";

const SERVICE_NAME = "genesis-runtime";

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 10, // load early: many other plugins depend on secrets capabilities
  permissions: {
    routes: true,
    uiPanels: false,
    data: false,
    capabilities: ["secrets:get", "secrets:set", "secrets:has", "secrets:delete", "secrets:build-handle"],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: [] },
  security: { isolation: "inprocess" }
};

function normalizeSecretHandle(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function assertSecretHandle(value = "") {
  const handle = normalizeSecretHandle(value);
  if (!handle) {
    throw new Error("secret handle is required");
  }
  return handle;
}

async function setSecret(handle = "", value = "") {
  const normalizedHandle = assertSecretHandle(handle);
  const normalizedValue = String(value || "");
  if (!normalizedValue) {
    throw new Error("secret value is required");
  }
  await keytar.setPassword(SERVICE_NAME, normalizedHandle, normalizedValue);
  return { handle: normalizedHandle, hasSecret: true };
}

async function getSecret(handle = "") {
  const normalizedHandle = assertSecretHandle(handle);
  return keytar.getPassword(SERVICE_NAME, normalizedHandle);
}

async function hasSecret(handle = "") {
  return Boolean(String((await getSecret(handle)) || ""));
}

async function deleteSecret(handle = "") {
  const normalizedHandle = assertSecretHandle(handle);
  const deleted = await keytar.deletePassword(SERVICE_NAME, normalizedHandle);
  return { handle: normalizedHandle, deleted: deleted === true };
}

function buildHandle(...parts) {
  return assertSecretHandle(parts.map((part) => String(part || "").trim()).filter(Boolean).join("/"));
}

export default function createSecretsPlugin() {
  return {
    id: "secrets",
    name: "Secrets",
    version: "0.1.0",
    description: "OS-keychain-backed secret storage (via keytar) for plugins that need to store API keys, tokens, or passwords.",
    manifest: MANIFEST,

    async init(api) {
      api.provideCapability("secrets:get", async ({ handle } = {}) => getSecret(handle));
      api.provideCapability("secrets:set", async ({ handle, value } = {}) => setSecret(handle, value));
      api.provideCapability("secrets:has", async ({ handle } = {}) => hasSecret(handle));
      api.provideCapability("secrets:delete", async ({ handle } = {}) => deleteSecret(handle));
      api.provideCapability("secrets:build-handle", (...parts) => buildHandle(...parts));
    },

    async registerRoutes({ app }) {
      app.get("/api/secrets/:handle/status", async (req, res) => {
        try {
          const handle = String(req.params?.handle || "");
          res.json({ ok: true, handle: normalizeSecretHandle(handle), hasSecret: await hasSecret(handle) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to check secret status") });
        }
      });

      app.post("/api/secrets/:handle", async (req, res) => {
        try {
          const handle = String(req.params?.handle || "");
          const value = String(req.body?.value || "");
          res.json({ ok: true, ...(await setSecret(handle, value)) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to set secret") });
        }
      });

      app.delete("/api/secrets/:handle", async (req, res) => {
        try {
          const handle = String(req.params?.handle || "");
          res.json({ ok: true, ...(await deleteSecret(handle)) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to delete secret") });
        }
      });
    }
  };
}
