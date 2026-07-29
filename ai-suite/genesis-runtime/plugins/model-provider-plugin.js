// Ported from genesis-core's server/observer-brain-config.js, server/ollama-runtime-service.js,
// server/lib/brain-endpoint-health-domain.js, server/lib/brain-provider-endpoints.js, and
// server/lib/brain-registry-domain.js. This is the "brain" / model-provider plugin: it owns the
// registry of configured model endpoints ("brains" -- an Ollama or OpenAI-compatible model behind
// a base URL) and exposes generation, JSON generation, embeddings, health checks, and
// specialty-based brain selection as capabilities other plugins can call.
//
// Simplified vs. the Nova original (documented here rather than scattered in comments below):
//  - No task-queue integration. Nova's brain selection folded in live task-queue load, idle
//    worker snapshots, and a "helper shadow analysis" cache -- none of that exists in Genesis
//    core (no built-in task queue), so `brain:score-for-specialty` / `brain:choose-for-specialty`
//    are pure specialty-text scoring (+ optional health check), not load-aware scheduling.
//  - No docker-exec model listing. Nova listed models via `docker exec <container> ollama list`;
//    this plugin has no container assumption and lists models via the endpoint's own /api/tags.
//  - No agent-loop JSON envelope repair. `retryJsonEnvelope`, `debugJsonEnvelopeWithPlanner`, and
//    `replanRepeatedToolLoopWithPlanner` were specific to Nova's worker-decision envelope format
//    and its planner-repair-brain concept; only generic prompt/JSON/embedding generation is
//    exposed here. JSON extraction from a completion is still ported (fenced-code-block stripping
//    + balanced-brace scanning) but as a simpler, self-contained implementation.
//  - No brain warm-up-on-boot, no per-request keep-alive scheduling beyond passing `keepAlive`
//    through.
//  - Registry persistence: Nova read/wrote brains through a shared observer.config.json. Genesis
//    core has no shared config file, so the brain/endpoint registry here is this plugin's own
//    JSON data store (via api.data), with HTTP routes to view/edit it directly (see below).
//  - API keys for non-Ollama endpoints are never stored in this plugin's own JSON data store.
//    When an endpoint's baseUrl needs a key, the key is stored via the secrets plugin's
//    "secrets:set" capability (by a per-endpoint handle) and only the handle name -- never the
//    key value -- is persisted in the registry.
//
// This module talks to Ollama / OpenAI-compatible APIs over plain `fetch`. There is no live
// Ollama server in the environment this was written in, so the generation/embedding paths are
// untested against a real endpoint -- see the final report for details.

const DEFAULT_LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL_TEMPERATURE = 0.7;
const MAX_MODEL_TEMPERATURE = 1.5;
const OLLAMA_TRANSPORT_RETRY_COUNT = 2;
const OLLAMA_TRANSPORT_RETRY_DELAY_MS = 400;
const OLLAMA_EMPTY_RESPONSE_RETRY_COUNT = 1;
const ENDPOINT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const HEALTH_CACHE_TTL_MS = 5000;

const DEFAULT_BRAIN = {
  id: "default",
  label: "Default",
  kind: "general",
  model: "llama3.1",
  specialty: "general",
  description: "Default general-purpose local brain (edit via POST /api/brains).",
  toolCapable: true,
  enabled: true,
  queueLane: "",
  numGpu: null,
  endpointId: "local"
};

function waitMs(delayMs = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs || 0))));
}

function stripAnsi(text = "") {
  // eslint-disable-next-line no-control-regex
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function normalizeProviderId(value = "") {
  const normalized = String(value || "ollama").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (["openai", "openai-compatible", "openrouter", "lmstudio", "vllm"].includes(normalized)) {
    return "openai-compatible";
  }
  return normalized || "ollama";
}

function getDefaultProviderBaseUrl(provider = "ollama") {
  return normalizeProviderId(provider) === "ollama" ? DEFAULT_LOCAL_OLLAMA_BASE_URL : "https://api.openai.com/v1";
}

function normalizeProviderBaseUrl(value = "", provider = "ollama") {
  const raw = String(value || "").trim();
  if (!raw) return getDefaultProviderBaseUrl(provider);
  return (/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
}

function normalizeOllamaBaseUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_LOCAL_OLLAMA_BASE_URL;
  return (/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, "");
}

function normalizeBrainId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeEndpointId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

function toBrainLabel(modelName = "") {
  return String(modelName || "")
    .split(/[:/-]/)
    .filter(Boolean)
    .map((part) => (/^\d+b$/i.test(part) ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
}

function isCpuQueueLane(brain = {}) {
  const explicitLane = String(brain?.queueLane || "").trim().toLowerCase();
  if (explicitLane.includes("gpu")) return false;
  if (explicitLane.includes("cpu")) return true;
  const text = `${String(brain?.model || "").toLowerCase()} ${String(brain?.description || "").toLowerCase()} ${String(brain?.specialty || "").toLowerCase()}`;
  return /\bcpu\b/.test(text);
}

function getBrainQueueLane(brain = {}, endpointId = "local") {
  const explicit = String(brain?.queueLane || "").trim();
  if (explicit) return explicit;
  return isCpuQueueLane(brain) ? `endpoint:${endpointId}:cpu` : `endpoint:${endpointId}:gpu`;
}

function formatTransportError(error) {
  const message = String(error?.message || "failed to reach model endpoint").trim();
  const cause = String(error?.cause?.message || error?.cause?.code || "").trim();
  return cause && !message.toLowerCase().includes(cause.toLowerCase()) ? `${message} (${cause})` : message;
}

function isRetriableTransportError(error) {
  if (!error || error?.name === "AbortError") return false;
  const text = formatTransportError(error).toLowerCase();
  return ["fetch failed", "econnreset", "socket", "other side closed", "network", "und_err", "connect", "hang up", "terminated"]
    .some((token) => text.includes(token));
}

function normalizeGenerationOptions(options = {}) {
  const normalized = options && typeof options === "object" ? { ...options } : {};
  const requestedTemperature = Number(normalized.temperature);
  if (Number.isFinite(requestedTemperature)) {
    normalized.temperature = Math.min(Math.max(requestedTemperature, 0), MAX_MODEL_TEMPERATURE);
  } else {
    normalized.temperature = DEFAULT_MODEL_TEMPERATURE;
  }
  return normalized;
}

// Ported (simplified) from Ollama runtime service's extractJsonObject: strip a fenced code
// block if present, try a direct JSON.parse, then fall back to scanning for the first balanced
// {...} / [...] substring and parsing that.
function extractBalancedJsonSubstring(text = "") {
  const closers = { "{": "}", "[": "]" };
  for (let i = 0; i < text.length; i += 1) {
    const opener = text[i];
    const closer = closers[opener];
    if (!closer) continue;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) {
        if (escapeNext) escapeNext = false;
        else if (ch === "\\") escapeNext = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === opener) depth += 1;
      else if (ch === closer) {
        depth -= 1;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
  }
  return "";
}

function extractJsonObject(text = "") {
  const raw = stripAnsi(String(text || "")).replace(/<\/?think>/gi, "\n").trim();
  if (!raw) throw new Error("empty model response");
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to balanced-substring scan
  }
  const balanced = extractBalancedJsonSubstring(candidate);
  if (balanced) {
    try {
      return JSON.parse(balanced);
    } catch {
      // fall through
    }
  }
  throw new Error("model did not return valid JSON");
}

function scoreBrainForSpecialty(brain = {}, specialty = "general") {
  const normalizedSpecialty = String(specialty || "general").trim().toLowerCase();
  const brainSpecialty = String(brain?.specialty || "").trim().toLowerCase();
  const normalizedToken = normalizedSpecialty.replace(/[^a-z0-9_-]+/g, "");
  const text = [brain?.id, brain?.label, brain?.model, brain?.description, brainSpecialty]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  let score = 0;
  if (brainSpecialty === normalizedSpecialty) score += 100;
  if (brainSpecialty === "general") score += 20;
  if (normalizedSpecialty === "general" && brainSpecialty !== "retrieval") score += 10;
  if (normalizedToken && new RegExp(`\\b${normalizedToken}\\b`, "i").test(text)) score += 20;
  return score;
}

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 20, // load early: other plugins depend on this for LLM calls
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: [
      "brain:list",
      "brain:get",
      "brain:health",
      "brain:score-for-specialty",
      "brain:choose-for-specialty",
      "brain:generate",
      "brain:generate-json",
      "brain:embed",
      "brain:queue-lane"
    ],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: ["secrets:get", "secrets:set", "secrets:delete", "secrets:build-handle"] },
  security: { isolation: "inprocess" }
};

export default function createModelProviderPlugin() {
  let api = null;

  // --- GPU/endpoint lease queue (ported from ollama-runtime-service.js) --------------------
  const leaseStateByResource = new Map();

  function getLeaseState(resourceKey = "") {
    const key = String(resourceKey || "").trim();
    if (!key) return null;
    if (!leaseStateByResource.has(key)) {
      leaseStateByResource.set(key, { active: null, queue: [] });
    }
    return leaseStateByResource.get(key);
  }

  function pruneLeaseState(resourceKey = "") {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (state && !state.active && !state.queue.length) {
      leaseStateByResource.delete(key);
    }
  }

  function removeQueuedLeaseWaiter(resourceKey = "", waiter = null) {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (!state || !waiter) return;
    const index = state.queue.indexOf(waiter);
    if (index >= 0) state.queue.splice(index, 1);
    pruneLeaseState(key);
  }

  function releaseLease(resourceKey = "", token = null) {
    const key = String(resourceKey || "").trim();
    const state = key ? leaseStateByResource.get(key) : null;
    if (!state || !token || state.active !== token) return;
    state.active = null;
    while (state.queue.length) {
      const nextWaiter = state.queue.shift();
      if (!nextWaiter || nextWaiter.settled) continue;
      nextWaiter.settled = true;
      if (typeof nextWaiter.cleanup === "function") nextWaiter.cleanup();
      state.active = nextWaiter.token;
      nextWaiter.resolve({
        ok: true,
        waitMs: Date.now() - Number(nextWaiter.enqueuedAt || Date.now()),
        queued: true,
        release: () => releaseLease(key, nextWaiter.token)
      });
      return;
    }
    pruneLeaseState(key);
  }

  async function resolveLeaseResourceKey({ brainId = "", laneHint = "", baseUrl = DEFAULT_LOCAL_OLLAMA_BASE_URL, leaseScope = "auto" } = {}) {
    const scope = String(leaseScope || "auto").trim().toLowerCase();
    if (scope === "none") return "";
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const explicitLane = String(laneHint || "").trim();
    if (scope !== "endpoint" && explicitLane) return `lane:${explicitLane}`;
    const targetBrainId = String(brainId || "").trim();
    if (scope !== "endpoint" && targetBrainId) {
      const brain = await findBrainByIdExact(targetBrainId).catch(() => null);
      const derivedLane = brain ? String(brain.queueLane || "").trim() : "";
      if (derivedLane) return `lane:${derivedLane}`;
    }
    return `endpoint:${normalizedBaseUrl}`;
  }

  async function acquireLease({ resourceKey = "", ownerId = "", waitTimeoutMs = 0, signal = null } = {}) {
    const key = String(resourceKey || "").trim();
    if (!key) return { ok: true, waitMs: 0, queued: false, release: () => {} };
    const normalizedOwnerId = String(ownerId || "").trim();
    const state = getLeaseState(key);
    const activeOwnerId = String(state?.active?.ownerId || "").trim();
    if (normalizedOwnerId && activeOwnerId && activeOwnerId === normalizedOwnerId) {
      return { ok: false, busy: true, sameOwner: true, waitMs: 0 };
    }
    if (!state.active) {
      const token = { id: Symbol(key), ownerId: normalizedOwnerId, acquiredAt: Date.now() };
      state.active = token;
      return { ok: true, waitMs: 0, queued: false, release: () => releaseLease(key, token) };
    }
    const waiter = { token: { id: Symbol(key), ownerId: normalizedOwnerId, acquiredAt: 0 }, enqueuedAt: Date.now(), settled: false, resolve: null, cleanup: null };
    return new Promise((resolve) => {
      let timeoutId = null;
      const onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        waiter.cleanup?.();
        removeQueuedLeaseWaiter(key, waiter);
        resolve({ ok: false, aborted: true, waitMs: Date.now() - waiter.enqueuedAt });
      };
      waiter.cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      waiter.resolve = (value) => {
        waiter.token.acquiredAt = Date.now();
        resolve(value);
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (Number(waitTimeoutMs || 0) > 0) {
        timeoutId = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          waiter.cleanup?.();
          removeQueuedLeaseWaiter(key, waiter);
          resolve({ ok: false, busy: true, waitMs: Date.now() - waiter.enqueuedAt });
        }, Number(waitTimeoutMs));
      }
      state.queue.push(waiter);
    });
  }

  // --- Endpoint health (ported from brain-endpoint-health-domain.js) -----------------------
  // Cached per baseUrl (each entry carries its own checkedAt) rather than one shared
  // timestamp for the whole cache -- a shared timestamp meant checking one endpoint could
  // make a different, long-stale endpoint's cached result look fresh for up to
  // HEALTH_CACHE_TTL_MS past when it should have re-checked.
  let healthCache = { entries: {} };
  let endpointFailureState = {};

  function invalidateEndpointHealthCache(baseUrl) {
    delete healthCache.entries[normalizeOllamaBaseUrl(baseUrl)];
  }

  function markEndpointTransportFailure(baseUrl, error) {
    const key = normalizeOllamaBaseUrl(baseUrl);
    endpointFailureState[key] = { failedAt: Date.now(), error: formatTransportError(error) };
    invalidateEndpointHealthCache(baseUrl);
  }

  function clearEndpointTransportFailure(baseUrl) {
    const key = normalizeOllamaBaseUrl(baseUrl);
    if (endpointFailureState[key]) {
      delete endpointFailureState[key];
      invalidateEndpointHealthCache(baseUrl);
    }
  }

  function getEndpointTransportCooldown(baseUrl) {
    const key = normalizeOllamaBaseUrl(baseUrl);
    const failure = endpointFailureState[key];
    if (!failure) return null;
    const ageMs = Date.now() - Number(failure.failedAt || 0);
    if (ageMs >= ENDPOINT_FAILURE_COOLDOWN_MS) {
      delete endpointFailureState[key];
      return null;
    }
    return { ...failure, remainingMs: ENDPOINT_FAILURE_COOLDOWN_MS - ageMs };
  }

  async function inspectOllamaEndpoint(baseUrl = DEFAULT_LOCAL_OLLAMA_BASE_URL) {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const cooldown = getEndpointTransportCooldown(normalizedBaseUrl);
    if (cooldown) {
      return { ok: false, baseUrl: normalizedBaseUrl, status: 0, running: false, modelCount: 0, error: `Cooling down after transport failure: ${cooldown.error}` };
    }
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = null;
      let parsed = {};
      let lastError = "";
      for (const endpointPath of ["/api/tags", "/api/tag"]) {
        try {
          response = await fetch(`${normalizedBaseUrl}${endpointPath}`, { method: "GET", signal: controller.signal });
          try { parsed = await response.json(); } catch { parsed = {}; }
          if (response.ok) break;
          lastError = String(parsed?.error || `Ollama API returned ${response.status}`);
        } catch (error) {
          lastError = String(error?.message || "failed to reach Ollama API");
          if (controller.signal.aborted) throw error;
        }
      }
      if (!response) throw new Error(lastError || "failed to reach Ollama API");
      return {
        ok: response.ok,
        baseUrl: normalizedBaseUrl,
        status: response.status,
        running: response.ok,
        modelCount: Array.isArray(parsed?.models) ? parsed.models.length : 0,
        error: response.ok ? "" : String(parsed?.error || `Ollama API returned ${response.status}`)
      };
    } catch (error) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        status: 0,
        running: false,
        modelCount: 0,
        error: error?.name === "AbortError" ? `timeout after ${Math.round(timeoutMs / 1000)}s` : String(error?.message || "failed to reach Ollama API")
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolveApiKeyForHandle(handle = "") {
    const normalizedHandle = String(handle || "").trim();
    if (!normalizedHandle || !api) return "";
    const getSecret = api.getCapability("secrets:get");
    if (typeof getSecret !== "function") return "";
    try {
      return String((await getSecret({ handle: normalizedHandle })) || "").trim();
    } catch {
      return "";
    }
  }

  async function inspectProviderEndpoint(endpoint = {}) {
    const provider = normalizeProviderId(endpoint?.provider || "ollama");
    const baseUrl = normalizeProviderBaseUrl(endpoint?.baseUrl || endpoint?.ollamaBaseUrl || "", provider);
    if (provider === "ollama") {
      return { provider, ...(await inspectOllamaEndpoint(baseUrl)) };
    }
    const controller = new AbortController();
    const timeoutMs = 12000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const apiKey = await resolveApiKeyForHandle(endpoint?.apiKeyHandle);
      const headers = {};
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const response = await fetch(`${baseUrl}/models`, { method: "GET", headers, signal: controller.signal });
      let parsed = {};
      try { parsed = await response.json(); } catch { parsed = {}; }
      return {
        ok: response.ok,
        provider,
        baseUrl,
        status: response.status,
        running: response.ok,
        modelCount: Array.isArray(parsed?.data) ? parsed.data.length : 0,
        error: response.ok ? "" : String(parsed?.error?.message || parsed?.error || `Provider API returned ${response.status}`)
      };
    } catch (error) {
      return {
        ok: false,
        provider,
        baseUrl,
        status: 0,
        running: false,
        modelCount: 0,
        error: error?.name === "AbortError" ? `timeout after ${Math.round(timeoutMs / 1000)}s` : String(error?.message || "failed to reach provider API")
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getOllamaEndpointHealth(baseUrl = DEFAULT_LOCAL_OLLAMA_BASE_URL) {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const now = Date.now();
    const cached = healthCache.entries[normalizedBaseUrl];
    if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
      return cached.health;
    }
    const health = await inspectOllamaEndpoint(normalizedBaseUrl);
    healthCache.entries[normalizedBaseUrl] = { health, checkedAt: now };
    return health;
  }

  async function getEndpointHealth(brainOrEndpoint = {}) {
    const provider = normalizeProviderId(brainOrEndpoint?.provider || "ollama");
    const baseUrl = normalizeProviderBaseUrl(brainOrEndpoint?.baseUrl || brainOrEndpoint?.ollamaBaseUrl || "", provider);
    if (provider === "ollama") return getOllamaEndpointHealth(baseUrl);
    return inspectProviderEndpoint({ ...brainOrEndpoint, provider, baseUrl });
  }

  async function listOllamaModels(baseUrl = DEFAULT_LOCAL_OLLAMA_BASE_URL) {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const response = await fetch(`${normalizedBaseUrl}/api/tags`, { method: "GET", signal: AbortSignal.timeout(12000) });
    let parsed = {};
    try { parsed = await response.json(); } catch { parsed = {}; }
    if (!response.ok) throw new Error(String(parsed?.error || `Ollama API returned ${response.status}`));
    return Array.isArray(parsed?.models)
      ? parsed.models.map((entry) => ({ name: entry?.name || entry?.model || "", size: entry?.size || 0, modifiedAt: entry?.modified_at || "" })).filter((entry) => entry.name)
      : [];
  }

  async function runOllamaEmbed(model, input, { timeoutMs = 30000, baseUrl = DEFAULT_LOCAL_OLLAMA_BASE_URL } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${normalizeOllamaBaseUrl(baseUrl)}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input }),
        signal: controller.signal
      });
      let parsed = {};
      try { parsed = await response.json(); } catch { parsed = {}; }
      if (!response.ok) throw new Error(String(parsed?.error || `Ollama API returned ${response.status}`));
      const embeddings = Array.isArray(parsed?.embeddings) ? parsed.embeddings : Array.isArray(parsed?.embedding) ? [parsed.embedding] : [];
      return embeddings.filter((entry) => Array.isArray(entry) && entry.length);
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- Brain/endpoint registry (ported from brain-registry-domain.js), persisted via api.data
  function decorateBrain(brain = {}, endpoints = {}) {
    const endpointId = normalizeEndpointId(brain.endpointId || "local");
    const endpoint = endpoints[endpointId] || endpoints.local || { id: "local", label: "Local Ollama", provider: "ollama", baseUrl: DEFAULT_LOCAL_OLLAMA_BASE_URL, apiKeyHandle: "" };
    const provider = normalizeProviderId(endpoint.provider || "ollama");
    const baseUrl = normalizeProviderBaseUrl(endpoint.baseUrl || "", provider);
    const numGpu = brain.numGpu != null && Number.isInteger(Number(brain.numGpu)) ? Number(brain.numGpu) : null;
    return {
      id: normalizeBrainId(brain.id),
      label: String(brain.label || toBrainLabel(brain.id || "")).trim() || String(brain.id || ""),
      kind: String(brain.kind || "general").trim() || "general",
      model: String(brain.model || "").trim(),
      specialty: String(brain.specialty || "").trim().toLowerCase(),
      description: String(brain.description || "").trim(),
      toolCapable: brain.toolCapable !== false,
      enabled: brain.enabled !== false,
      numGpu,
      provider,
      endpointId,
      endpointLabel: String(endpoint.label || endpointId),
      baseUrl,
      ollamaBaseUrl: baseUrl,
      apiKeyHandle: String(endpoint.apiKeyHandle || "").trim(),
      remote: provider !== "ollama" || baseUrl !== DEFAULT_LOCAL_OLLAMA_BASE_URL,
      queueLane: getBrainQueueLane(brain, endpointId)
    };
  }

  async function loadRegistry() {
    const stored = await api.data.readJson("registry", null);
    const registryObject = stored && typeof stored === "object" ? stored : {};
    const endpoints = registryObject.endpoints && typeof registryObject.endpoints === "object" ? { ...registryObject.endpoints } : {};
    if (!endpoints.local) {
      endpoints.local = { id: "local", label: "Local Ollama", provider: "ollama", baseUrl: DEFAULT_LOCAL_OLLAMA_BASE_URL, apiKeyHandle: "" };
    }
    const brains = Array.isArray(registryObject.brains) && registryObject.brains.length ? registryObject.brains : [DEFAULT_BRAIN];
    return { endpoints, brains };
  }

  async function saveRegistry(state = {}) {
    await api.data.writeJson("registry", state);
  }

  async function listAvailableBrains({ includeDisabled = false } = {}) {
    const registry = await loadRegistry();
    return registry.brains
      .map((brain) => decorateBrain(brain, registry.endpoints))
      .filter((brain) => includeDisabled || brain.enabled);
  }

  async function findBrainByIdExact(brainId = "") {
    const target = normalizeBrainId(brainId);
    if (!target) return null;
    const brains = await listAvailableBrains({ includeDisabled: true });
    return brains.find((brain) => brain.id === target) || null;
  }

  async function getBrain(brainId = "") {
    const brains = await listAvailableBrains();
    return brains.find((brain) => brain.id === normalizeBrainId(brainId))
      || brains.find((brain) => brain.id === "default")
      || brains[0]
      || null;
  }

  async function listEndpoints() {
    const registry = await loadRegistry();
    return Object.values(registry.endpoints).map((endpoint) => ({
      id: endpoint.id,
      label: endpoint.label,
      provider: normalizeProviderId(endpoint.provider || "ollama"),
      baseUrl: normalizeProviderBaseUrl(endpoint.baseUrl || "", endpoint.provider || "ollama"),
      hasApiKey: Boolean(String(endpoint.apiKeyHandle || "").trim())
    }));
  }

  async function upsertEndpoint(input = {}) {
    const id = normalizeEndpointId(input.id || input.endpointId);
    const provider = normalizeProviderId(input.provider || "ollama");
    const baseUrl = normalizeProviderBaseUrl(input.baseUrl || "", provider);
    const registry = await loadRegistry();
    const existing = registry.endpoints[id] || {};
    let apiKeyHandle = String(existing.apiKeyHandle || "").trim();
    const apiKeyValue = String(input.apiKey || "").trim();
    if (apiKeyValue) {
      const buildHandle = api.getCapability("secrets:build-handle");
      const setSecret = api.getCapability("secrets:set");
      if (typeof buildHandle !== "function" || typeof setSecret !== "function") {
        throw new Error("secrets plugin is not available to store the endpoint API key");
      }
      apiKeyHandle = buildHandle("model-provider", "endpoint", id);
      await setSecret({ handle: apiKeyHandle, value: apiKeyValue });
    }
    const record = {
      id,
      label: String(input.label || existing.label || id).trim() || id,
      provider,
      baseUrl,
      apiKeyHandle
    };
    registry.endpoints[id] = record;
    await saveRegistry(registry);
    return { ...record, hasApiKey: Boolean(apiKeyHandle) };
  }

  async function removeEndpoint(endpointId = "") {
    const id = normalizeEndpointId(endpointId);
    if (id === "local") throw new Error("the local endpoint cannot be removed");
    const registry = await loadRegistry();
    const endpoint = registry.endpoints[id];
    if (!endpoint) throw new Error(`endpoint "${id}" not found`);
    const inUse = registry.brains.some((brain) => normalizeEndpointId(brain.endpointId || "local") === id);
    if (inUse) throw new Error(`endpoint "${id}" is still assigned to one or more brains`);
    delete registry.endpoints[id];
    await saveRegistry(registry);
    const apiKeyHandle = String(endpoint.apiKeyHandle || "").trim();
    if (apiKeyHandle) {
      const deleteSecret = api.getCapability("secrets:delete");
      if (typeof deleteSecret === "function") {
        await deleteSecret({ handle: apiKeyHandle }).catch(() => {});
      }
    }
    return { id };
  }

  async function upsertBrain(input = {}) {
    const id = normalizeBrainId(input.id);
    if (!id) throw new Error("id is required");
    const registry = await loadRegistry();
    const index = registry.brains.findIndex((brain) => normalizeBrainId(brain.id) === id);
    const existing = index >= 0 ? registry.brains[index] : {};
    const endpointId = normalizeEndpointId(input.endpointId || existing.endpointId || "local");
    if (!registry.endpoints[endpointId]) throw new Error(`endpoint "${endpointId}" is not configured`);
    const model = String(input.model ?? existing.model ?? "").trim();
    if (!model) throw new Error("model is required");
    const record = {
      id,
      label: String(input.label ?? existing.label ?? toBrainLabel(id)).trim() || toBrainLabel(id),
      kind: String(input.kind ?? existing.kind ?? "general").trim() || "general",
      model,
      specialty: String(input.specialty ?? existing.specialty ?? "").trim().toLowerCase(),
      description: String(input.description ?? existing.description ?? "").trim(),
      toolCapable: input.toolCapable !== undefined ? input.toolCapable === true : existing.toolCapable !== false,
      enabled: input.enabled !== undefined ? input.enabled !== false : existing.enabled !== false,
      queueLane: String(input.queueLane ?? existing.queueLane ?? "").trim(),
      numGpu: input.numGpu !== undefined ? (Number.isInteger(Number(input.numGpu)) ? Number(input.numGpu) : null) : (existing.numGpu ?? null),
      endpointId
    };
    if (index >= 0) registry.brains[index] = record;
    else registry.brains.push(record);
    await saveRegistry(registry);
    return decorateBrain(record, registry.endpoints);
  }

  async function removeBrain(brainId = "") {
    const id = normalizeBrainId(brainId);
    if (!id) throw new Error("id is required");
    const registry = await loadRegistry();
    const index = registry.brains.findIndex((brain) => normalizeBrainId(brain.id) === id);
    if (index < 0) throw new Error(`brain "${id}" not found`);
    const [removed] = registry.brains.splice(index, 1);
    await saveRegistry(registry);
    return { id: removed.id };
  }

  async function scoreBrainsForSpecialty(specialty = "general") {
    const brains = await listAvailableBrains();
    return brains
      .map((brain) => ({ brainId: brain.id, label: brain.label, specialty: brain.specialty, score: scoreBrainForSpecialty(brain, specialty) }))
      .sort((left, right) => right.score - left.score || left.brainId.localeCompare(right.brainId));
  }

  async function chooseBrainForSpecialty(specialty = "general", { requireHealthy = false } = {}) {
    const brains = await listAvailableBrains();
    const ranked = brains
      .map((brain) => ({ brain, score: scoreBrainForSpecialty(brain, specialty) }))
      .sort((left, right) => right.score - left.score || left.brain.id.localeCompare(right.brain.id));
    if (!requireHealthy) return ranked[0]?.brain || null;
    for (const entry of ranked) {
      const health = await getEndpointHealth(entry.brain).catch(() => null);
      if (health?.running) return entry.brain;
    }
    return ranked[0]?.brain || null;
  }

  // --- Generation client (ported from ollama-runtime-service.js) --------------------------
  async function resolveModelTarget({ model = "", baseUrl = "", provider = "", apiKeyHandle = "", brainId = "" } = {}) {
    let brain = null;
    const targetBrainId = String(brainId || "").trim();
    if (targetBrainId) {
      brain = await findBrainByIdExact(targetBrainId);
    }
    const resolvedProvider = normalizeProviderId(provider || brain?.provider || "ollama");
    const requestedBaseUrl = String(baseUrl || "").trim();
    const brainBaseUrl = String(brain?.baseUrl || brain?.ollamaBaseUrl || "").trim();
    const resolvedBaseUrl = requestedBaseUrl || brainBaseUrl || getDefaultProviderBaseUrl(resolvedProvider);
    return {
      provider: resolvedProvider,
      model: String(model || brain?.model || "").trim(),
      baseUrl: normalizeProviderBaseUrl(resolvedBaseUrl, resolvedProvider),
      apiKeyHandle: String(apiKeyHandle || brain?.apiKeyHandle || "").trim(),
      brain
    };
  }

  async function runOpenAiCompatibleGenerate(model, prompt, { timeoutMs = 120000, options = {}, baseUrl = "", signal = null, format = "", provider = "openai-compatible", apiKeyHandle = "" } = {}) {
    const normalizedOptions = normalizeGenerationOptions(options);
    const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl, provider);
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortExternal, { once: true });
    }
    const timeout = Number(timeoutMs || 0) > 0 ? setTimeout(() => controller.abort(), Number(timeoutMs)) : null;
    try {
      const apiKey = await resolveApiKeyForHandle(apiKeyHandle);
      const headers = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: String(prompt || "") }],
          temperature: normalizedOptions.temperature,
          stream: false,
          ...(format ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });
      let parsed = {};
      try { parsed = await response.json(); } catch { parsed = {}; }
      if (!response.ok) {
        return { ok: false, code: response.status, text: "", stderr: String(parsed?.error?.message || parsed?.error || `Provider API returned ${response.status}`), timedOut: false };
      }
      const responseText = stripAnsi(parsed?.choices?.[0]?.message?.content || parsed?.output_text || "");
      if (!responseText.trim()) {
        return { ok: false, code: 0, text: "", stderr: "empty model response", timedOut: false };
      }
      return { ok: true, code: response.status, text: responseText, stderr: "", timedOut: false };
    } catch (error) {
      const externallyAborted = Boolean(signal?.aborted);
      return {
        ok: false,
        code: error?.name === "AbortError" ? 124 : 0,
        text: "",
        stderr: error?.name === "AbortError"
          ? (externallyAborted ? "request aborted by caller" : `timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`)
          : formatTransportError(error),
        timedOut: error?.name === "AbortError" && !externallyAborted
      };
    } finally {
      if (signal) signal.removeEventListener("abort", abortExternal);
      if (timeout) clearTimeout(timeout);
    }
  }

  async function runOllamaGenerate(model, prompt, opts = {}) {
    const {
      timeoutMs = 120000,
      keepAlive = "",
      options: rawOptions = {},
      baseUrl = "",
      provider = "",
      apiKeyHandle = "",
      images = [],
      signal = null,
      format = "",
      brainId = "",
      laneHint = "",
      leaseOwnerId = "",
      leaseWaitMs = 0,
      leaseScope = "auto"
    } = opts;

    const target = await resolveModelTarget({ model, baseUrl, provider, apiKeyHandle, brainId });
    if (target.provider !== "ollama") {
      return runOpenAiCompatibleGenerate(target.model || model, prompt, {
        timeoutMs, options: rawOptions, baseUrl: target.baseUrl, signal, format,
        provider: target.provider, apiKeyHandle: target.apiKeyHandle
      });
    }

    const normalizedOptions = normalizeGenerationOptions(rawOptions);
    const normalizedBaseUrl = normalizeOllamaBaseUrl(target.baseUrl || baseUrl);
    if (normalizedOptions.num_gpu == null && target.brain && isCpuQueueLane(target.brain)) {
      normalizedOptions.num_gpu = 0;
    }
    const resourceKey = await resolveLeaseResourceKey({ brainId, laneHint, baseUrl: normalizedBaseUrl, leaseScope });

    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortExternal, { once: true });
    }
    const timeout = Number(timeoutMs || 0) > 0 ? setTimeout(() => controller.abort(), Number(timeoutMs)) : null;

    const lease = await acquireLease({ resourceKey, ownerId: leaseOwnerId, waitTimeoutMs: Number(leaseWaitMs || 0), signal: controller.signal });
    if (!lease.ok) {
      const externallyAborted = Boolean(signal?.aborted);
      const resourceLabel = String(resourceKey || normalizedBaseUrl).replace(/^lane:/, "").replace(/^endpoint:/, "");
      if (signal) signal.removeEventListener("abort", abortExternal);
      if (timeout) clearTimeout(timeout);
      if (lease.aborted) {
        return {
          ok: false, code: 124, text: "",
          stderr: externallyAborted ? "request aborted by caller" : `timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`,
          timedOut: !externallyAborted, busy: false, resourceKey, leaseWaitMs: Number(lease.waitMs || 0)
        };
      }
      return {
        ok: false, code: 0, text: "",
        stderr: lease.sameOwner ? `model resource ${resourceLabel} is already busy with this request` : `model resource ${resourceLabel} is busy`,
        timedOut: false, busy: true, resourceKey, leaseWaitMs: Number(lease.waitMs || 0)
      };
    }

    try {
      for (let attempt = 0; attempt <= OLLAMA_TRANSPORT_RETRY_COUNT; attempt += 1) {
        try {
          const response = await fetch(`${normalizedBaseUrl}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: target.model || model,
              prompt,
              stream: false,
              think: false,
              ...(format ? { format } : {}),
              ...(keepAlive ? { keep_alive: keepAlive } : {}),
              ...(Array.isArray(images) && images.length ? { images } : {}),
              options: normalizedOptions
            }),
            signal: controller.signal
          });
          let parsed = {};
          try { parsed = await response.json(); } catch { parsed = {}; }
          if (!response.ok) {
            return { ok: false, code: response.status, text: "", stderr: String(parsed?.error || `Ollama API returned ${response.status}`), timedOut: false };
          }
          const responseText = stripAnsi(parsed.response || "");
          if (!responseText.trim()) {
            if (attempt < OLLAMA_EMPTY_RESPONSE_RETRY_COUNT) {
              await waitMs(OLLAMA_TRANSPORT_RETRY_DELAY_MS * (attempt + 1));
              continue;
            }
            return { ok: false, code: 0, text: "", stderr: "empty model response", timedOut: false };
          }
          clearEndpointTransportFailure(normalizedBaseUrl);
          return { ok: true, code: response.status, text: responseText, stderr: "", timedOut: false };
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          const retriable = isRetriableTransportError(error);
          if (retriable && attempt < OLLAMA_TRANSPORT_RETRY_COUNT) {
            await waitMs(OLLAMA_TRANSPORT_RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
          markEndpointTransportFailure(normalizedBaseUrl, error);
          return { ok: false, code: 0, text: "", stderr: formatTransportError(error), timedOut: false };
        }
      }
      return { ok: false, code: 0, text: "", stderr: "failed to reach model endpoint", timedOut: false };
    } catch (error) {
      const externallyAborted = Boolean(signal?.aborted);
      return {
        ok: false,
        code: error?.name === "AbortError" ? 124 : 0,
        text: "",
        stderr: error?.name === "AbortError"
          ? (externallyAborted ? "request aborted by caller" : `timeout after ${Math.round(Number(timeoutMs || 0) / 1000)}s`)
          : formatTransportError(error),
        timedOut: error?.name === "AbortError" && !externallyAborted
      };
    } finally {
      if (signal) signal.removeEventListener("abort", abortExternal);
      if (timeout) clearTimeout(timeout);
      lease.release();
    }
  }

  async function runOllamaJsonGenerate(model, prompt, opts = {}) {
    return runOllamaGenerate(model, prompt, { ...opts, format: opts.format || "json" });
  }

  // --- Capability entry points --------------------------------------------------------------
  // Callers may pass a flat { prompt } or a chat-style { messages: [{role, content}, ...] } —
  // different plugins built independently against this capability converged on both shapes,
  // so accept either rather than forcing every caller onto one convention.
  function resolvePromptFromArgs(args = {}) {
    const direct = String(args.prompt || "").trim();
    if (direct) return direct;
    if (Array.isArray(args.messages)) {
      return args.messages
        .map((entry) => `${String(entry?.role || "user").trim()}: ${String(entry?.content || "").trim()}`)
        .filter((line) => !line.endsWith(": "))
        .join("\n\n")
        .trim();
    }
    return "";
  }

  async function generateForCapability(args = {}) {
    const prompt = resolvePromptFromArgs(args);
    if (!prompt) throw new Error("prompt (or messages) is required");
    return runOllamaGenerate(args.model, prompt, args);
  }

  async function generateJsonForCapability(args = {}) {
    const prompt = resolvePromptFromArgs(args);
    if (!prompt) throw new Error("prompt (or messages) is required");
    const result = await runOllamaJsonGenerate(args.model, prompt, args);
    if (!result.ok) return result;
    try {
      const json = extractJsonObject(result.text);
      return { ...result, json };
    } catch (error) {
      return { ...result, ok: false, stderr: `model returned invalid JSON: ${error.message}` };
    }
  }

  async function embedForCapability(args = {}) {
    const { brainId = "", model = "", input, baseUrl = "", timeoutMs = 30000 } = args;
    if (input === undefined || input === null) throw new Error("input is required");
    const target = await resolveModelTarget({ model, baseUrl, brainId });
    if (target.provider !== "ollama") {
      throw new Error(`embeddings are only supported for ollama-provider brains (resolved provider is "${target.provider}")`);
    }
    if (!target.model) throw new Error("model is required (directly or via brainId)");
    return runOllamaEmbed(target.model, input, { timeoutMs, baseUrl: target.baseUrl });
  }

  async function healthForCapability({ brainId = "", endpointId = "" } = {}) {
    if (brainId) {
      const brain = await findBrainByIdExact(brainId);
      if (!brain) throw new Error(`brain "${brainId}" not found`);
      return { brainId: brain.id, ...(await getEndpointHealth(brain)) };
    }
    const registry = await loadRegistry();
    const id = normalizeEndpointId(endpointId || "local");
    const endpoint = registry.endpoints[id];
    if (!endpoint) throw new Error(`endpoint "${id}" not found`);
    return { endpointId: id, ...(await getEndpointHealth(endpoint)) };
  }

  return {
    id: "model-provider",
    name: "Model Provider",
    version: "0.1.0",
    description: "Registry of Ollama / OpenAI-compatible model endpoints (\"brains\") plus generation, JSON generation, embeddings, health checks, and specialty-based brain selection.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;

      api.provideCapability("brain:list", async ({ includeDisabled = false } = {}) => listAvailableBrains({ includeDisabled }));
      api.provideCapability("brain:get", async ({ brainId } = {}) => getBrain(brainId));
      api.provideCapability("brain:health", async (args = {}) => healthForCapability(args));
      api.provideCapability("brain:score-for-specialty", async ({ specialty = "general" } = {}) => scoreBrainsForSpecialty(specialty));
      api.provideCapability("brain:choose-for-specialty", async ({ specialty = "general", requireHealthy = false } = {}) => chooseBrainForSpecialty(specialty, { requireHealthy }));
      api.provideCapability("brain:generate", async (args = {}) => generateForCapability(args));
      api.provideCapability("brain:generate-json", async (args = {}) => generateJsonForCapability(args));
      api.provideCapability("brain:embed", async (args = {}) => embedForCapability(args));
      api.provideCapability("brain:queue-lane", (brain = {}) => getBrainQueueLane(brain, brain?.endpointId || "local"));
    },

    async registerRoutes({ app }) {
      app.get("/api/brains", async (req, res) => {
        try {
          const includeDisabled = String(req.query?.includeDisabled || "").trim() === "true";
          res.json({ ok: true, brains: await listAvailableBrains({ includeDisabled }) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list brains") });
        }
      });

      app.post("/api/brains", async (req, res) => {
        try {
          res.json({ ok: true, brain: await upsertBrain(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save brain") });
        }
      });

      app.get("/api/brains/score", async (req, res) => {
        try {
          const specialty = String(req.query?.specialty || "general").trim() || "general";
          res.json({ ok: true, specialty, ranked: await scoreBrainsForSpecialty(specialty) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to score brains") });
        }
      });

      app.post("/api/brains/choose", async (req, res) => {
        try {
          const { specialty = "general", requireHealthy = false } = req.body || {};
          const brain = await chooseBrainForSpecialty(specialty, { requireHealthy: requireHealthy === true });
          res.json({ ok: true, brain });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to choose brain") });
        }
      });

      app.post("/api/brains/generate", async (req, res) => {
        try {
          res.json(await generateForCapability(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "generation failed") });
        }
      });

      app.post("/api/brains/generate-json", async (req, res) => {
        try {
          res.json(await generateJsonForCapability(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "JSON generation failed") });
        }
      });

      app.post("/api/brains/embed", async (req, res) => {
        try {
          const embeddings = await embedForCapability(req.body || {});
          res.json({ ok: true, embeddings });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "embedding failed") });
        }
      });

      app.get("/api/brains/endpoints", async (_req, res) => {
        try {
          res.json({ ok: true, endpoints: await listEndpoints() });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to list endpoints") });
        }
      });

      app.post("/api/brains/endpoints", async (req, res) => {
        try {
          res.json({ ok: true, endpoint: await upsertEndpoint(req.body || {}) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to save endpoint") });
        }
      });

      app.delete("/api/brains/endpoints/:endpointId", async (req, res) => {
        try {
          res.json({ ok: true, removed: await removeEndpoint(req.params?.endpointId) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove endpoint") });
        }
      });

      app.get("/api/brains/endpoints/:endpointId/health", async (req, res) => {
        try {
          res.json({ ok: true, ...(await healthForCapability({ endpointId: req.params?.endpointId })) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "health check failed") });
        }
      });

      app.get("/api/brains/endpoints/:endpointId/models", async (req, res) => {
        try {
          const registry = await loadRegistry();
          const id = normalizeEndpointId(req.params?.endpointId);
          const endpoint = registry.endpoints[id];
          if (!endpoint) throw new Error(`endpoint "${id}" not found`);
          if (normalizeProviderId(endpoint.provider) !== "ollama") {
            throw new Error("model listing is only supported for ollama-provider endpoints");
          }
          res.json({ ok: true, models: await listOllamaModels(endpoint.baseUrl) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to list models") });
        }
      });

      app.get("/api/brains/:brainId", async (req, res) => {
        try {
          const brain = await findBrainByIdExact(req.params?.brainId);
          if (!brain) return res.status(404).json({ ok: false, error: `brain "${req.params?.brainId}" not found` });
          res.json({ ok: true, brain });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to get brain") });
        }
      });

      app.delete("/api/brains/:brainId", async (req, res) => {
        try {
          res.json({ ok: true, removed: await removeBrain(req.params?.brainId) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to remove brain") });
        }
      });

      app.get("/api/brains/:brainId/health", async (req, res) => {
        try {
          res.json({ ok: true, ...(await healthForCapability({ brainId: req.params?.brainId })) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "health check failed") });
        }
      });
    }
  };
}
