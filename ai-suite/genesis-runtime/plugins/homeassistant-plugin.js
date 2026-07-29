// Pilot extraction: ported from genesis-core's server/observer-iot-domain.js and
// server/observer-iot-routes.js. Demonstrates converting a self-contained Nova domain
// module into a real Genesis plugin using only the compatibility interfaces the plugin
// host already exposes (data store, capabilities, hooks, routes, tools) — no core changes
// were needed to host this beyond the two Nova-specific assumptions fixed in lib/plugin-system.js
// (manifest duplication, tool "scope" vocabulary).
//
// Note on secrets: when the secrets plugin is enabled, the Home Assistant long-lived token
// is stored through its "secrets:set"/"secrets:get"/"secrets:delete" capabilities (only a
// handle is kept in this plugin's own scoped data store). If the secrets plugin is not
// enabled, this falls back to storing the token directly in plaintext JSON, same as before.

function normalizeInstanceId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function normalizeBaseUrl(value = "") {
  let raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function normalizeEntityId(value = "") {
  return String(value || "").trim().toLowerCase();
}

async function callHa(instance, { method = "GET", path = "/api/", body = null, timeoutMs = 15000 } = {}) {
  const baseUrl = String(instance?.baseUrl || "").trim().replace(/\/+$/, "");
  const token = String(instance?.token || "").trim();
  if (!baseUrl) throw new Error("Home Assistant base URL is not configured");
  if (!token) throw new Error("Home Assistant token is not configured");

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const bodyText = body != null ? JSON.stringify(body) : undefined;

  let response;
  try {
    response = await fetch(url, {
      method: String(method || "GET").trim().toUpperCase(),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: bodyText,
      signal: AbortSignal.timeout(Math.max(1000, Math.min(Number(timeoutMs || 15000), 120000)))
    });
  } catch (err) {
    throw new Error(`Home Assistant request failed: ${err.message}`);
  }

  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const msg = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`Home Assistant returned ${response.status}: ${msg}`);
  }
  return payload;
}

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 100,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: ["iot:call", "iot:raw-call"],
    hooks: [],
    runtimeContext: [],
    tools: ["iot_list_devices", "iot_get_state", "iot_call_service"]
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: ["secrets:get", "secrets:set", "secrets:delete", "secrets:build-handle"] },
  security: { isolation: "inprocess" }
};

export default function createHomeAssistantPlugin() {
  let api = null;

  async function hook(name, payload) {
    if (!api || typeof api.runHook !== "function") return payload;
    try {
      const result = await api.runHook(name, payload);
      return result !== undefined ? result : payload;
    } catch {
      return payload;
    }
  }

  async function loadRegistry() {
    return (await api.data.readJson("registry", { instances: [] })) || { instances: [] };
  }

  async function saveRegistry(state) {
    await api.data.writeJson("registry", state);
  }

  async function resolveInstance(instanceId = "") {
    const id = normalizeInstanceId(instanceId);
    const registry = await loadRegistry();
    const instance = registry.instances.find((entry) => entry.instanceId === id);
    if (!instance) throw new Error(`Home Assistant instance "${id}" is not configured`);
    if (instance.tokenHandle) {
      const getSecret = api.getCapability("secrets:get");
      if (typeof getSecret !== "function") {
        throw new Error(`Home Assistant instance "${id}"'s token is stored via the secrets plugin, which is not enabled`);
      }
      const token = await getSecret({ handle: instance.tokenHandle });
      if (!token) throw new Error(`Home Assistant instance "${id}" has no token stored for handle "${instance.tokenHandle}"`);
      return { ...instance, token };
    }
    return instance;
  }

  async function callHaForInstance(instanceId = "", options = {}) {
    const instance = await resolveInstance(instanceId);
    return callHa(instance, options);
  }

  async function listInstances() {
    const registry = await loadRegistry();
    return registry.instances.map(({ token, tokenHandle, ...rest }) => ({ ...rest, hasToken: Boolean(token || tokenHandle) }));
  }

  async function saveInstance(args = {}) {
    const instanceId = normalizeInstanceId(args.instanceId || args.id || "default");
    const baseUrl = normalizeBaseUrl(args.baseUrl || args.url || "");
    if (!baseUrl) throw new Error("baseUrl is required (e.g. http://homeassistant.local:8123)");
    const label = String(args.label || args.name || instanceId).trim().slice(0, 120) || instanceId;
    const providedToken = String(args.token || args.longLivedToken || "").trim();
    const registry = await loadRegistry();
    const existingIndex = registry.instances.findIndex((entry) => entry.instanceId === instanceId);
    const existing = existingIndex >= 0 ? registry.instances[existingIndex] : null;

    const setSecret = api.getCapability("secrets:set");
    const buildHandle = api.getCapability("secrets:build-handle");
    const secretsAvailable = typeof setSecret === "function" && typeof buildHandle === "function";

    let record;
    if (providedToken) {
      if (secretsAvailable) {
        const tokenHandle = buildHandle("homeassistant", instanceId, "token");
        await setSecret({ handle: tokenHandle, value: providedToken });
        record = { instanceId, label, baseUrl, tokenHandle };
      } else {
        console.warn(`[genesis] homeassistant plugin: secrets plugin is not enabled; storing instance "${instanceId}"'s token in plaintext`);
        record = { instanceId, label, baseUrl, token: providedToken };
      }
    } else if (existing?.tokenHandle) {
      record = { instanceId, label, baseUrl, tokenHandle: existing.tokenHandle };
    } else if (existing?.token) {
      record = { instanceId, label, baseUrl, token: existing.token };
    } else {
      throw new Error("token (long-lived access token) is required");
    }

    if (existingIndex >= 0) registry.instances[existingIndex] = record;
    else registry.instances.unshift(record);
    await saveRegistry(registry);
    const result = { instanceId, label, baseUrl, hasToken: true };
    await hook("iot:instance-saved", { instanceId, instance: result });
    return result;
  }

  async function removeInstance(args = {}) {
    const instanceId = normalizeInstanceId(args.instanceId || args.id || "");
    if (!instanceId) throw new Error("instanceId is required");
    const registry = await loadRegistry();
    const index = registry.instances.findIndex((entry) => entry.instanceId === instanceId);
    if (index < 0) throw new Error(`Instance "${instanceId}" not found`);
    const [removed] = registry.instances.splice(index, 1);
    await saveRegistry(registry);
    if (removed.tokenHandle) {
      const deleteSecret = api.getCapability("secrets:delete");
      if (typeof deleteSecret === "function") {
        await deleteSecret({ handle: removed.tokenHandle }).catch(() => {});
      }
    }
    await hook("iot:instance-removed", { instanceId: removed.instanceId });
    return { instanceId: removed.instanceId, label: removed.label };
  }

  async function testConnection(args = {}) {
    const instance = await resolveInstance(args.instanceId);
    const result = await callHa(instance, { path: "/api/", timeoutMs: Number(args.timeoutMs || 10000) });
    return {
      text: `Connected to Home Assistant at ${instance.baseUrl}. Version: ${result?.version || "unknown"}.`,
      version: result?.version,
      instance: { instanceId: instance.instanceId, label: instance.label, baseUrl: instance.baseUrl }
    };
  }

  async function listDevices(args = {}) {
    const instance = await resolveInstance(args.instanceId);
    const states = await callHa(instance, { path: "/api/states", timeoutMs: Number(args.timeoutMs || 20000) });
    const allStates = Array.isArray(states) ? states : [];
    const domain = String(args.domain || "").trim().toLowerCase();
    const filtered = domain
      ? allStates.filter((s) => String(s?.entity_id || "").startsWith(`${domain}.`))
      : allStates;

    const rawEntities = filtered.map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      friendly_name: s.attributes?.friendly_name,
      last_changed: s.last_changed
    }));

    const enriched = await hook("iot:list-devices:enrich", {
      instanceId: instance.instanceId,
      domain: domain || null,
      entities: rawEntities
    });

    const entities = Array.isArray(enriched?.entities) ? enriched.entities : rawEntities;
    return {
      text: `Found ${entities.length} entit${entities.length === 1 ? "y" : "ies"}${domain ? ` in domain "${domain}"` : ""} on ${instance.label || instance.instanceId}.`,
      entities
    };
  }

  async function getState(args = {}) {
    const entityId = normalizeEntityId(args.entityId || args.entity_id || "");
    if (!entityId) throw new Error("entityId is required");
    const instance = await resolveInstance(args.instanceId);
    const state = await callHa(instance, { path: `/api/states/${entityId}`, timeoutMs: Number(args.timeoutMs || 10000) });
    return {
      text: `${entityId} is ${state.state}${state.attributes?.friendly_name ? ` (${state.attributes.friendly_name})` : ""}.`,
      entity_id: state.entity_id,
      state: state.state,
      attributes: state.attributes || {},
      last_changed: state.last_changed,
      last_updated: state.last_updated
    };
  }

  async function callService(args = {}) {
    const serviceDomain = String(args.domain || args.serviceDomain || "").trim().toLowerCase();
    const service = String(args.service || "").trim().toLowerCase();
    if (!serviceDomain) throw new Error("domain is required (e.g. light, switch, climate)");
    if (!service) throw new Error("service is required (e.g. turn_on, turn_off)");
    const instance = await resolveInstance(args.instanceId);
    const entityId = normalizeEntityId(args.entityId || args.entity_id || "");
    const serviceData = args.serviceData && typeof args.serviceData === "object" ? args.serviceData : {};

    if (entityId) {
      const resolved = await hook("iot:resolve-target", {
        instanceId: instance.instanceId,
        target: entityId,
        entityIds: []
      });
      if (Array.isArray(resolved?.entityIds) && resolved.entityIds.length > 0) {
        const body = { ...serviceData, entity_id: resolved.entityIds };
        const beforePayload = await hook("iot:before-service-call", {
          instanceId: instance.instanceId,
          domain: serviceDomain,
          service,
          entityId,
          entityIds: resolved.entityIds,
          body,
          skip: false
        });
        if (beforePayload?.skip === true) {
          return beforePayload.skipResult || { text: `Service call ${serviceDomain}.${service} skipped by plugin.`, skipped: true };
        }
        const finalBody = beforePayload?.body && typeof beforePayload.body === "object" ? beforePayload.body : body;
        const result = await callHa(instance, {
          method: "POST",
          path: `/api/services/${serviceDomain}/${service}`,
          body: finalBody,
          timeoutMs: Number(args.timeoutMs || 15000)
        });
        const changed = Array.isArray(result) ? result.length : 0;
        const response = {
          text: `Called ${serviceDomain}.${service} on ${resolved.entityIds.length} entities. ${changed} state${changed === 1 ? "" : "s"} changed.`,
          domain: serviceDomain,
          service,
          entityIds: resolved.entityIds,
          statesChanged: Array.isArray(result) ? result.map((s) => s.entity_id) : []
        };
        await hook("iot:after-service-call", { instanceId: instance.instanceId, domain: serviceDomain, service, entityId, entityIds: resolved.entityIds, body: finalBody, result: response });
        return response;
      }
    }

    const body = { ...serviceData, ...(entityId ? { entity_id: entityId } : {}) };
    const beforePayload = await hook("iot:before-service-call", {
      instanceId: instance.instanceId,
      domain: serviceDomain,
      service,
      entityId,
      entityIds: entityId ? [entityId] : [],
      body,
      skip: false
    });
    if (beforePayload?.skip === true) {
      return beforePayload.skipResult || { text: `Service call ${serviceDomain}.${service} skipped by plugin.`, skipped: true };
    }
    const finalBody = beforePayload?.body && typeof beforePayload.body === "object" ? beforePayload.body : body;
    const finalEntityId = beforePayload?.entityId !== undefined ? beforePayload.entityId : entityId;

    const result = await callHa(instance, {
      method: "POST",
      path: `/api/services/${serviceDomain}/${service}`,
      body: finalBody,
      timeoutMs: Number(args.timeoutMs || 15000)
    });
    const changed = Array.isArray(result) ? result.length : 0;
    const response = {
      text: `Called ${serviceDomain}.${service}${finalEntityId ? ` on ${finalEntityId}` : ""}. ${changed} state${changed === 1 ? "" : "s"} changed.`,
      domain: serviceDomain,
      service,
      entity_id: finalEntityId || undefined,
      statesChanged: Array.isArray(result) ? result.map((s) => s.entity_id) : []
    };
    await hook("iot:after-service-call", { instanceId: instance.instanceId, domain: serviceDomain, service, entityId: finalEntityId, entityIds: finalEntityId ? [finalEntityId] : [], body: finalBody, result: response });
    return response;
  }

  return {
    id: "homeassistant",
    name: "Home Assistant",
    version: "0.1.0",
    description: "Connect Genesis to one or more Home Assistant instances: list devices, read state, and call services.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;

      api.provideCapability("iot:call", async (args = {}) => callService(args));
      // Raw HA access for other plugins/workers that need endpoints this module doesn't wrap.
      api.provideCapability("iot:raw-call", async ({ instanceId, ...options } = {}) => callHaForInstance(instanceId, options));

      api.registerTool({
        name: "iot_list_devices",
        description: "List Home Assistant devices/entities, optionally filtered by domain (e.g. light, switch).",
        parameters: {
          type: "object",
          properties: {
            instanceId: { type: "string" },
            domain: { type: "string" }
          }
        }
      });
      api.registerTool({
        name: "iot_get_state",
        description: "Get the current state of a single Home Assistant entity.",
        parameters: {
          type: "object",
          properties: {
            instanceId: { type: "string" },
            entityId: { type: "string" }
          },
          required: ["entityId"]
        }
      });
      api.registerTool({
        name: "iot_call_service",
        description: "Call a Home Assistant service (e.g. light.turn_on) on an entity.",
        parameters: {
          type: "object",
          properties: {
            instanceId: { type: "string" },
            domain: { type: "string" },
            service: { type: "string" },
            entityId: { type: "string" },
            serviceData: { type: "object" }
          },
          required: ["domain", "service"]
        },
        risk: "medium"
      });
    },

    async registerRoutes({ app }) {
      app.get("/api/iot/instances", async (_req, res) => {
        try {
          res.json({ ok: true, instances: await listInstances() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list instances") });
        }
      });

      app.post("/api/iot/instances", async (req, res) => {
        try {
          res.json({ ok: true, instance: await saveInstance(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save instance") });
        }
      });

      app.delete("/api/iot/instances/:instanceId", async (req, res) => {
        try {
          const instanceId = String(req.params?.instanceId || "").trim();
          if (!instanceId) {
            return res.status(400).json({ ok: false, error: "instanceId is required" });
          }
          res.json({ ok: true, removed: await removeInstance({ instanceId }) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove instance") });
        }
      });

      app.post("/api/iot/instances/:instanceId/test", async (req, res) => {
        try {
          const instanceId = String(req.params?.instanceId || "").trim();
          const result = await testConnection({ instanceId, ...(req.body || {}) });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "connection test failed") });
        }
      });

      app.get("/api/iot/instances/:instanceId/devices", async (req, res) => {
        try {
          const instanceId = String(req.params?.instanceId || "").trim();
          const result = await listDevices({ instanceId, domain: req.query?.domain });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to list devices") });
        }
      });

      app.get("/api/iot/instances/:instanceId/state/:entityId", async (req, res) => {
        try {
          const instanceId = String(req.params?.instanceId || "").trim();
          const entityId = String(req.params?.entityId || "").trim();
          const result = await getState({ instanceId, entityId });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to get state") });
        }
      });

      app.post("/api/iot/instances/:instanceId/service", async (req, res) => {
        try {
          const instanceId = String(req.params?.instanceId || "").trim();
          const result = await callService({ instanceId, ...(req.body || {}) });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "service call failed") });
        }
      });
    }
  };
}
