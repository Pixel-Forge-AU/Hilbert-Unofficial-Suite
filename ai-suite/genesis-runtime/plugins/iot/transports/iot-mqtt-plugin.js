/**
 * Plugin Name: IoT MQTT Transport
 * Plugin Slug: iot-mqtt
 * Description: MQTT broker transport for IoT. Lets agents publish messages and subscribe to topics
 *              on any MQTT broker (Mosquitto, EMQX, HiveMQ, etc.). Requires: npm install mqtt
 * Version: 1.0.0
 * Author: Nova Observer
 */

import fs from "node:fs/promises";
import pathModule from "node:path";
import { createMqttDomain } from "./lib/mqtt-domain.js";

const BROKER_REGISTRY_FILENAME = "iot-mqtt-brokers.json";

function normalizeBrokerId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

export function createIotMqttPlugin(options = {}) {
  const {
    pluginId = "iot-mqtt",
    pluginName = "IoT MQTT Transport",
    description = "MQTT broker transport for IoT device messaging."
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: false,
        data: true,
        tools: [
          "mqtt_list_brokers",
          "mqtt_save_broker",
          "mqtt_remove_broker",
          "mqtt_test_connection",
          "mqtt_publish",
          "mqtt_subscribe_once"
        ],
        capabilities: [
          "iot-mqtt.listBrokers",
          "iot-mqtt.saveBroker",
          "iot-mqtt.removeBroker",
          "iot-mqtt.testConnection",
          "iot-mqtt.publish",
          "iot-mqtt.subscribeOnce"
        ],
        hooks: [],
        runtimeContext: [
          "noteInteractiveActivity"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["secrets:get", "secrets:set", "secrets:has", "secrets:delete"]
      },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      const registryPath = api.data.path(BROKER_REGISTRY_FILENAME.replace(/\.json$/i, ""));

      // Secret storage is delegated to the secrets plugin's capabilities rather than the
      // Nova-era runtimeContext secret functions, which nothing in Genesis ever populates.
      const getSecretValue = async (handle = "") => {
        const getSecret = api.getCapability("secrets:get");
        return typeof getSecret === "function" ? String((await getSecret({ handle })) || "") : "";
      };
      const hasSecretValue = async (handle = "") => {
        const hasSecret = api.getCapability("secrets:has");
        return typeof hasSecret === "function" ? Boolean(await hasSecret({ handle })) : false;
      };
      const setSecretValue = async (handle = "", value = "") => {
        const setSecret = api.getCapability("secrets:set");
        if (typeof setSecret !== "function") {
          throw new Error("secrets plugin is not available to store the MQTT broker password");
        }
        return setSecret({ handle, value });
      };
      const deleteSecretValue = async (handle = "") => {
        const deleteSecret = api.getCapability("secrets:delete");
        if (typeof deleteSecret === "function") {
          await deleteSecret({ handle }).catch(() => {});
        }
      };

      let registryCache = null;

      function buildPasswordHandle(brokerId = "") {
        return `iot/mqtt/${normalizeBrokerId(brokerId)}/password`;
      }

      async function loadRegistry() {
        if (registryCache) return registryCache;
        try {
          const raw = await fs.readFile(registryPath, "utf8");
          const parsed = JSON.parse(raw);
          registryCache = { brokers: Array.isArray(parsed?.brokers) ? parsed.brokers : [] };
        } catch {
          registryCache = { brokers: [] };
        }
        return registryCache;
      }

      async function persistRegistry() {
        if (!registryPath || !fs) return;
        const state = await loadRegistry();
        const serialized = {
          brokers: state.brokers.map((b) => ({
            brokerId: b.brokerId,
            label: b.label,
            brokerUrl: b.brokerUrl,
            port: b.port,
            username: b.username,
            clientId: b.clientId,
            passwordHandle: b.passwordHandle
          }))
        };
        await fs.mkdir(pathModule.dirname(registryPath), { recursive: true });
        await fs.writeFile(registryPath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
      }

      async function getBrokerConfig(brokerId = "") {
        const id = normalizeBrokerId(brokerId);
        const registry = await loadRegistry();
        const broker = registry.brokers.find((b) => b.brokerId === id);
        if (!broker) return null;
        const password = await getSecretValue(broker.passwordHandle || buildPasswordHandle(id));
        return { ...broker, password: String(password || "").trim() };
      }

      async function listBrokersPublic() {
        const registry = await loadRegistry();
        return Promise.all(
          registry.brokers.map(async (b) => ({
            brokerId: b.brokerId,
            label: b.label,
            brokerUrl: b.brokerUrl,
            port: b.port,
            username: b.username,
            clientId: b.clientId,
            passwordHandle: b.passwordHandle,
            hasPassword: await hasSecretValue(b.passwordHandle || buildPasswordHandle(b.brokerId))
          }))
        );
      }

      async function saveBrokerRecord(args = {}) {
        const brokerId = normalizeBrokerId(args.brokerId || args.id || "default");
        const brokerUrl = String(args.brokerUrl || args.url || "").trim();
        if (!brokerUrl) throw new Error("brokerUrl is required (e.g. mqtt://homeassistant.local or mqtt://192.168.1.100:1883)");
        const label = String(args.label || brokerId).trim().slice(0, 120);
        const port = Number(args.port || 1883);
        const username = String(args.username || "").trim();
        const clientId = String(args.clientId || "").trim();
        const passwordHandle = buildPasswordHandle(brokerId);
        const providedPassword = String(args.password || "").trim();
        if (providedPassword) await setSecretValue(passwordHandle, providedPassword);
        const registry = await loadRegistry();
        const existing = registry.brokers.findIndex((b) => b.brokerId === brokerId);
        const record = { brokerId, label, brokerUrl, port, username, clientId, passwordHandle };
        if (existing >= 0) registry.brokers[existing] = record;
        else registry.brokers.unshift(record);
        await persistRegistry();
        return { ...record, hasPassword: await hasSecretValue(passwordHandle) };
      }

      async function removeBrokerRecord(args = {}) {
        const brokerId = normalizeBrokerId(args.brokerId || args.id || "");
        if (!brokerId) throw new Error("brokerId is required");
        const registry = await loadRegistry();
        const idx = registry.brokers.findIndex((b) => b.brokerId === brokerId);
        if (idx < 0) throw new Error(`MQTT broker "${brokerId}" not found`);
        const [removed] = registry.brokers.splice(idx, 1);
        await deleteSecretValue(removed.passwordHandle || buildPasswordHandle(brokerId));
        await persistRegistry();
        return { brokerId: removed.brokerId, label: removed.label };
      }

      const domain = createMqttDomain({ getBrokerConfig });

      if (typeof api.provideCapability === "function") {
        api.provideCapability("iot-mqtt.listBrokers", () => listBrokersPublic());
        api.provideCapability("iot-mqtt.saveBroker", (args) => saveBrokerRecord(args));
        api.provideCapability("iot-mqtt.removeBroker", (args) => removeBrokerRecord(args));
        api.provideCapability("iot-mqtt.testConnection", (args) => domain.testConnection(args));
        api.provideCapability("iot-mqtt.publish", (args) => domain.publish(args));
        api.provideCapability("iot-mqtt.subscribeOnce", (args) => domain.subscribeOnce(args));
      }

      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "mqtt_list_brokers", description: "List configured MQTT brokers.", scopes: ["worker"], risk: "normal" });
        api.registerTool({ name: "mqtt_save_broker", description: "Add or update an MQTT broker configuration.", scopes: ["worker"], risk: "high", parameters: { brokerId: "string", label: "string", brokerUrl: "string", port: "number", username: "string", password: "string", clientId: "string" } });
        api.registerTool({ name: "mqtt_remove_broker", description: "Remove a configured MQTT broker.", scopes: ["worker"], risk: "high", parameters: { brokerId: "string" } });
        api.registerTool({ name: "mqtt_test_connection", description: "Test connection to a configured MQTT broker.", scopes: ["worker"], risk: "normal", parameters: { brokerId: "string", timeoutMs: "number" } });
        api.registerTool({ name: "mqtt_publish", description: "Publish a message to an MQTT topic on a configured broker.", scopes: ["worker"], risk: "high", parameters: { brokerId: "string", topic: "string", payload: "string|object", qos: "number", retain: "boolean", timeoutMs: "number" } });
        api.registerTool({ name: "mqtt_subscribe_once", description: "Subscribe to an MQTT topic and return the next message received (one-shot, blocks until message arrives or waitMs expires).", scopes: ["worker"], risk: "normal", parameters: { brokerId: "string", topic: "string", waitMs: "number" } });
      }
    },

    async registerRoutes({ app, api }) {
      app.get("/api/iot/mqtt/brokers", async (_req, res) => {
        try {
          const listBrokers = api.getCapability("iot-mqtt.listBrokers");
          if (typeof listBrokers !== "function") return res.status(503).json({ ok: false, error: "iot-mqtt capability unavailable" });
          const brokers = await listBrokers();
          res.json({ ok: true, brokers });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed") });
        }
      });

      app.post("/api/iot/mqtt/brokers", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          if (typeof runtime?.noteInteractiveActivity === "function") runtime.noteInteractiveActivity();
          const saveBroker = api.getCapability("iot-mqtt.saveBroker");
          if (typeof saveBroker !== "function") return res.status(503).json({ ok: false, error: "iot-mqtt capability unavailable" });
          const broker = await saveBroker(req.body || {});
          res.json({ ok: true, broker });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed") });
        }
      });

      app.delete("/api/iot/mqtt/brokers/:brokerId", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          if (typeof runtime?.noteInteractiveActivity === "function") runtime.noteInteractiveActivity();
          const removeBroker = api.getCapability("iot-mqtt.removeBroker");
          if (typeof removeBroker !== "function") return res.status(503).json({ ok: false, error: "iot-mqtt capability unavailable" });
          const brokerId = String(req.params?.brokerId || "").trim();
          if (!brokerId) return res.status(400).json({ ok: false, error: "brokerId is required" });
          const removed = await removeBroker({ brokerId });
          res.json({ ok: true, removed });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed") });
        }
      });

      app.post("/api/iot/mqtt/brokers/:brokerId/test", async (req, res) => {
        try {
          const testConnection = api.getCapability("iot-mqtt.testConnection");
          if (typeof testConnection !== "function") return res.status(503).json({ ok: false, error: "iot-mqtt capability unavailable" });
          const brokerId = String(req.params?.brokerId || "").trim();
          const result = await testConnection({ brokerId, ...(req.body || {}) });
          res.json({ ok: true, ...result });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "connection test failed") });
        }
      });
    }
  };
}
