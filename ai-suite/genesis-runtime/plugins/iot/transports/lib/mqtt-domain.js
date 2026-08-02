// Requires: npm install mqtt
// Lazy-imported so the plugin loads even if mqtt is not installed.

async function loadMqttClient() {
  try {
    const mod = await import("mqtt");
    return mod.default || mod;
  } catch {
    throw new Error("mqtt package is not installed. Run: npm install mqtt");
  }
}

function normalizeBrokerUrl(value = "", port = 1883) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^mqtt[s]?:\/\//i.test(raw)) raw = `mqtt://${raw}`;
  try {
    const parsed = new URL(raw);
    if (!parsed.port) parsed.port = String(port);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function createMqttDomain(context = {}) {
  const { getBrokerConfig = async () => null } = context;

  async function resolveBroker(brokerId = "") {
    const id = String(brokerId || "").trim() || "default";
    const cfg = await getBrokerConfig(id);
    if (!cfg) throw new Error(`MQTT broker "${id}" is not configured`);
    return cfg;
  }

  function buildConnectOptions(broker = {}) {
    const opts = { connectTimeout: 10000, reconnectPeriod: 0 };
    if (broker.username) opts.username = broker.username;
    if (broker.password) opts.password = broker.password;
    if (broker.clientId) opts.clientId = broker.clientId;
    return opts;
  }

  async function withClient(broker, fn, timeoutMs = 15000) {
    const mqtt = await loadMqttClient();
    const url = normalizeBrokerUrl(broker.brokerUrl, broker.port || 1883);
    if (!url) throw new Error("brokerUrl is required");
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, buildConnectOptions(broker));
      const cleanup = () => { try { client.end(true); } catch {} };
      const timer = setTimeout(() => { cleanup(); reject(new Error("MQTT operation timed out")); }, Math.max(2000, Number(timeoutMs || 15000)));
      client.once("error", (err) => { clearTimeout(timer); cleanup(); reject(err); });
      client.once("connect", async () => {
        try {
          const result = await fn(client);
          clearTimeout(timer);
          cleanup();
          resolve(result);
        } catch (err) {
          clearTimeout(timer);
          cleanup();
          reject(err);
        }
      });
    });
  }

  async function testConnection(args = {}) {
    const broker = await resolveBroker(args.brokerId);
    await withClient(broker, async () => {}, Number(args.timeoutMs || 10000));
    return {
      text: `Connected to MQTT broker at ${broker.brokerUrl}.`,
      brokerId: broker.brokerId,
      brokerUrl: broker.brokerUrl
    };
  }

  async function publish(args = {}) {
    const topic = String(args.topic || "").trim();
    if (!topic) throw new Error("topic is required");
    const payload = args.payload == null
      ? ""
      : typeof args.payload === "object"
        ? JSON.stringify(args.payload)
        : String(args.payload);
    const qos = [0, 1, 2].includes(Number(args.qos)) ? Number(args.qos) : 0;
    const retain = args.retain === true;
    const broker = await resolveBroker(args.brokerId);
    await withClient(broker, (client) => new Promise((resolve, reject) => {
      client.publish(topic, payload, { qos, retain }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }), Number(args.timeoutMs || 10000));
    return {
      text: `Published to ${topic} on ${broker.brokerId}.`,
      topic,
      payloadLength: payload.length,
      qos,
      retain
    };
  }

  async function subscribeOnce(args = {}) {
    const topic = String(args.topic || "").trim();
    if (!topic) throw new Error("topic is required");
    const waitMs = Math.max(1000, Math.min(Number(args.waitMs || 5000), 30000));
    const broker = await resolveBroker(args.brokerId);
    return withClient(broker, (client) => new Promise((resolve, reject) => {
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) return reject(err);
      });
      const timer = setTimeout(() => resolve({ topic, payload: null, timedOut: true }), waitMs);
      client.once("message", (receivedTopic, message) => {
        clearTimeout(timer);
        const raw = message.toString();
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ topic: receivedTopic, payload: parsed, raw, timedOut: false });
      });
    }), waitMs + 5000);
  }

  return { testConnection, publish, subscribeOnce };
}
