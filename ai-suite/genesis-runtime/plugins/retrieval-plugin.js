// Extracted from genesis-core's server/retrieval-domain.js (the self-contained RAG/vector-search
// engine) and server/observer-document-domain.js (the document-indexing layer built on top of it).
// The two Nova domains are combined into a single Genesis plugin: document-domain is a thin layer
// over retrieval-domain (it wraps it, adds HTML/email parsing, and a lexical/semantic document
// index) and splitting it into two plugins would only add capability-call overhead between two
// modules that always operate on the same chunk store and config.
//
// Two things were re-plumbed to fit the plugin contract instead of Nova's direct-import style:
//  - Ollama embedding calls (runOllamaEmbed) are replaced with the "brain:embed" capability. If no
//    model-provider plugin registers it, ingestion/search fail with a clear error instead of a crash.
//  - The Qdrant API key is no longer read from a config field in plain text; it is fetched through
//    the secrets plugin's "secrets:get" capability using a configurable handle (default
//    "retrieval/qdrant/api-key"), falling back to "" (no auth header) if the secrets plugin/handle
//    is absent.
//
// Document format support: text/markdown/json/csv/tsv/xml/html/plain source files are normalized
// with full fidelity (HTML is stripped to text, same entity-decoding + tag-to-newline rules as
// Nova). Email (.eml) is parsed with mailparser, same as Nova. PDF/DOC/DOCX/RTF are NOT parsed --
// Nova's PDF pipeline (pdf-parse/pdf-lib) was large and not central to proving the extraction
// pattern here, so those formats are stubbed as "binary, extraction not available yet" metadata
// records (same fallback shape Nova used for genuinely unsupported binaries). This can be revisited
// by adding pdf-parse and a normalizeDocumentContent branch for it.
//
// Nova/Observer-specific path-ignore rules (nova-observer workspace paths, "observer-output"
// artifact detection, watch-term/important-people config owned by another Nova domain) were not
// ported -- they were app-specific noise-filtering, not part of the generic retrieval/indexing
// engine. A generic ignore list (node_modules, .git, dist, build, coverage, etc.) is kept.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

let simpleParser = null;
try {
  ({ simpleParser } = await import("mailparser"));
} catch {
  simpleParser = null;
}

const STATE_SCHEMA_VERSION = 1;
const CHUNK_SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MAX_CHUNKS_PER_DOC = 64;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const DEFAULT_CONFIG = {
  qdrantUrl: "http://127.0.0.1:6333",
  collectionName: "genesis_chunks",
  workspaceKey: "genesis",
  qdrantApiKeyHandle: "retrieval/qdrant/api-key",
  syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  roots: [] // [{ id, rootPath, maxDepth, limit }]
};

const DOCUMENT_EXTENSIONS = [
  ".md", ".markdown", ".mdx", ".txt", ".log", ".json", ".jsonc", ".csv", ".tsv", ".xml",
  ".html", ".htm", ".xhtml", ".eml", ".yml", ".yaml", ".toml", ".ini",
  ".doc", ".docx", ".pdf", ".rtf"
];

const IGNORED_DIR_NAMES = new Set([
  ".git", "node_modules", "vendor", "dist", "build", ".next", ".nuxt", "coverage", ".cache"
]);

// ---------------------------------------------------------------------------
// Generic text/hash helpers (ported verbatim from retrieval-domain.js)
// ---------------------------------------------------------------------------

function compactWhitespace(value = "") {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashRef(value = "") {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function buildUuidFromSeed(seed = "") {
  const hex = crypto.createHash("sha1").update(String(seed || "")).digest("hex").slice(0, 32);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

function buildChunkPreview(text = "", maxChars = 220) {
  const compact = compactWhitespace(text).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function splitLongSegment(text = "", chunkSize = DEFAULT_CHUNK_SIZE) {
  const output = [];
  let cursor = 0;
  const source = compactWhitespace(text);
  while (cursor < source.length) {
    const maxEnd = Math.min(source.length, cursor + chunkSize);
    let end = maxEnd;
    if (maxEnd < source.length) {
      const window = source.slice(cursor, maxEnd);
      const preferredBreak = Math.max(
        window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("! "),
        window.lastIndexOf("? "), window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(" ")
      );
      if (preferredBreak >= Math.floor(chunkSize * 0.55)) {
        end = cursor + preferredBreak + 1;
      }
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) output.push(chunk);
    cursor = end;
  }
  return output;
}

// Sentence/paragraph-aware chunker: groups paragraphs up to chunkSize, carrying a small
// overlap forward so search results retain surrounding context.
function chunkDocumentText(text = "", {
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
  maxChunks = DEFAULT_MAX_CHUNKS_PER_DOC
} = {}) {
  const source = compactWhitespace(text);
  if (!source) return [];
  const normalizedChunkSize = Math.max(300, Number(chunkSize || DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE);
  const normalizedOverlap = Math.max(0, Math.min(Number(chunkOverlap || DEFAULT_CHUNK_OVERLAP) || DEFAULT_CHUNK_OVERLAP, Math.floor(normalizedChunkSize / 2)));
  const paragraphs = source.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const units = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= normalizedChunkSize) {
      units.push(paragraph);
      continue;
    }
    units.push(...splitLongSegment(paragraph, normalizedChunkSize));
  }

  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (!current || candidate.length <= normalizedChunkSize) {
      current = candidate;
      continue;
    }
    chunks.push(current.trim());
    if (chunks.length >= maxChunks) return chunks.slice(0, maxChunks);
    const overlapSeed = normalizedOverlap > 0 ? current.slice(Math.max(0, current.length - normalizedOverlap)).trim() : "";
    current = overlapSeed ? `${overlapSeed}\n\n${unit}` : unit;
    if (current.length > normalizedChunkSize) {
      const splitUnits = splitLongSegment(current, normalizedChunkSize);
      current = "";
      for (const splitUnit of splitUnits) {
        chunks.push(splitUnit);
        if (chunks.length >= maxChunks) return chunks.slice(0, maxChunks);
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.slice(0, maxChunks);
}

function buildPayloadFilter(filters = {}, workspaceKey = "") {
  const must = [];
  if (workspaceKey) must.push({ key: "workspace_key", match: { value: workspaceKey } });
  if (filters?.docId) must.push({ key: "doc_id", match: { value: String(filters.docId).trim() } });
  if (filters?.rootId) must.push({ key: "root_id", match: { value: String(filters.rootId).trim() } });
  if (filters?.sourcePath) must.push({ key: "source_path", match: { value: String(filters.sourcePath).trim() } });
  if (filters?.sourceType) must.push({ key: "source_type", match: { value: String(filters.sourceType).trim() } });
  return must.length ? { must } : null;
}

function extractQueryResults(body = {}) {
  if (Array.isArray(body?.result?.points)) return body.result.points;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.points)) return body.points;
  return [];
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ---------------------------------------------------------------------------
// Qdrant HTTP client (ported from retrieval-domain.js, unchanged behavior)
// ---------------------------------------------------------------------------

function createQdrantClient({ getUrl, getApiKey, fetchImpl = fetch } = {}) {
  function resolveBaseUrl() {
    return String((typeof getUrl === "function" ? getUrl() : "") || "").trim().replace(/\/+$/, "");
  }
  async function resolveApiKey() {
    return String((typeof getApiKey === "function" ? await getApiKey() : "") || "").trim();
  }
  async function request(method, pathname, body = undefined) {
    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      return { ok: false, status: 0, error: "Qdrant URL is not configured", body: null };
    }
    const headers = { "content-type": "application/json" };
    const apiKey = await resolveApiKey();
    if (apiKey) headers["api-key"] = apiKey;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message || "Failed to reach Qdrant"), body: null };
    }
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? "" : String(parsed?.status?.error || parsed?.error || `Qdrant returned ${response.status}`),
      body: parsed
    };
  }
  return {
    get baseUrl() { return resolveBaseUrl(); },
    getCollection: (collectionName) => request("GET", `/collections/${encodeURIComponent(collectionName)}`),
    createCollection: (collectionName, vectorSize) => request("PUT", `/collections/${encodeURIComponent(collectionName)}`, {
      vectors: { size: Math.max(1, Number(vectorSize || 0)), distance: "Cosine" },
      on_disk_payload: true
    }),
    upsertPoints: (collectionName, points) => request("PUT", `/collections/${encodeURIComponent(collectionName)}/points`, { points }),
    deletePointsByFilter: (collectionName, filter) => request("POST", `/collections/${encodeURIComponent(collectionName)}/points/delete`, { filter }),
    queryPoints: (collectionName, vector, { filter = null, limit = DEFAULT_SEARCH_LIMIT } = {}) => request(
      "POST",
      `/collections/${encodeURIComponent(collectionName)}/points/query`,
      { query: vector, limit: Math.max(1, Number(limit || DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT), with_payload: true, with_vector: false, ...(filter ? { filter } : {}) }
    ),
    request
  };
}

// ---------------------------------------------------------------------------
// Document normalization (ported/simplified from observer-document-domain.js)
// ---------------------------------------------------------------------------

function decodeBasicHtmlEntities(text = "") {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripHtmlToText(html = "") {
  return decodeBasicHtmlEntities(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isLikelyBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious > sample.length * 0.2;
}

function normalizeDocumentWhitespace(text = "") {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\x00/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function normalizeDocumentContent({ buffer, sourceLabel = "", contentType = "", sourceName = "" } = {}) {
  const mime = String(contentType || "").toLowerCase().split(";")[0].trim();
  const lowerName = String(sourceName || sourceLabel || "").toLowerCase();
  const ext = path.extname(lowerName);
  const warnings = [];
  const label = sourceLabel || sourceName || "(unknown)";

  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(String(buffer || ""), "utf8");
  if (!buffer.length) {
    return { kind: "empty", contentType: mime, text: "", warnings, sourceLabel: label };
  }
  if (buffer.length > DEFAULT_MAX_SOURCE_BYTES) {
    warnings.push(`source exceeded ${DEFAULT_MAX_SOURCE_BYTES} bytes and was not normalized`);
    return {
      kind: "oversized", contentType: mime,
      text: `Document metadata only.\nSource: ${label}\nBytes: ${buffer.length}\nReason: source too large for direct normalization.`,
      warnings, sourceLabel: label
    };
  }

  if ((mime === "message/rfc822" || ext === ".eml") && simpleParser) {
    try {
      const parsed = await simpleParser(buffer);
      const body = normalizeDocumentWhitespace(parsed.text || stripHtmlToText(parsed.html || ""));
      const text = [
        `Email subject: ${parsed.subject || "(no subject)"}`,
        parsed.from?.text ? `From: ${parsed.from.text}` : "",
        parsed.to?.text ? `To: ${parsed.to.text}` : "",
        body ? `Body:\n${body}` : "Body: (empty)"
      ].filter(Boolean).join("\n");
      return { kind: "email", contentType: mime || "message/rfc822", text, warnings, sourceLabel: label };
    } catch (error) {
      warnings.push(`email parsing fell back to plain text: ${error.message}`);
    }
  }

  // PDF/DOC/DOCX/RTF: not parsed in this port (see file header comment). Fall through to the
  // binary-metadata-only branch below via the extension/mime check rather than crashing.
  const unsupportedBinaryExt = [".pdf", ".doc", ".docx", ".rtf"];
  if (unsupportedBinaryExt.includes(ext) || mime === "application/pdf") {
    warnings.push(`${ext || mime} document extraction is not implemented in this plugin yet`);
    return {
      kind: "binary", contentType: mime || "application/octet-stream",
      text: `Document metadata only.\nSource: ${label}\nType: ${mime || ext || "binary"}\nBytes: ${buffer.length}\nReason: ${ext || mime} extraction is not available yet.`,
      warnings, sourceLabel: label
    };
  }

  const htmlLike = mime === "text/html" || mime === "application/xhtml+xml" || [".html", ".htm", ".xhtml"].includes(ext);
  const jsonLike = mime === "application/json" || [".json", ".jsonc"].includes(ext);
  const markdownLike = mime === "text/markdown" || [".md", ".markdown", ".mdx"].includes(ext);
  const csvLike = mime === "text/csv" || [".csv", ".tsv"].includes(ext);
  const xmlLike = mime === "application/xml" || mime === "text/xml" || [".xml", ".svg"].includes(ext);
  const textLike = mime.startsWith("text/") || markdownLike || jsonLike || csvLike || xmlLike
    || [".txt", ".log", ".yml", ".yaml", ".ini", ".toml", ".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".css", ".scss", ".sh", ".ps1"].includes(ext);

  if (!textLike && isLikelyBinaryBuffer(buffer)) {
    warnings.push("binary document type is not directly supported yet");
    return {
      kind: "binary", contentType: mime || "application/octet-stream",
      text: `Document metadata only.\nSource: ${label}\nType: ${mime || ext || "binary"}\nBytes: ${buffer.length}\nReason: binary document extraction is not available yet.`,
      warnings, sourceLabel: label
    };
  }

  let text = buffer.toString("utf8");
  let kind = "text";
  if (htmlLike) {
    kind = "html";
    text = stripHtmlToText(text);
  } else if (jsonLike) {
    kind = "json";
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { text = normalizeDocumentWhitespace(text); warnings.push("json formatting failed, using raw text"); }
  } else if (markdownLike) {
    kind = "markdown";
    text = normalizeDocumentWhitespace(text);
  } else if (csvLike) {
    kind = "table";
    text = normalizeDocumentWhitespace(text);
  } else if (xmlLike) {
    kind = "xml";
    text = normalizeDocumentWhitespace(text);
  } else {
    text = normalizeDocumentWhitespace(text);
  }

  return { kind, contentType: mime || (htmlLike ? "text/html" : textLike ? "text/plain" : ""), text, warnings, sourceLabel: label };
}

// ---------------------------------------------------------------------------
// Document signal extraction (ported from observer-document-domain.js; the
// Nova-specific "assistant primary path" / watch-term config was dropped)
// ---------------------------------------------------------------------------

function detectDocumentCategory({ relativePath = "", text = "", kind = "" } = {}) {
  const lower = `${relativePath}\n${text}`.toLowerCase();
  if (/\b(meeting|appointment|calendar|schedule|agenda|timeslot|booking)\b/.test(lower)) return "schedule";
  if (/\b(contract|agreement|terms|policy|nda)\b/.test(lower)) return "legal";
  if (kind === "email" || /\bfrom:|to:|email subject:\b/.test(lower)) return "mail";
  if (/\b(todo|task|follow up|follow-up|action items?|next step|handoff)\b/.test(lower)) return "action";
  if (/\b(notes|journal|memory|personal)\b/.test(lower)) return "notes";
  if (/\b(project|roadmap|todo|tasks|milestone|backlog|handoff)\b/.test(lower)) return "project";
  return "general";
}

function normalizeDateCandidate(raw = "") {
  const value = String(raw || "").trim();
  if (!value) return null;
  let parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
      const day = Number(slashMatch[1]);
      const month = Number(slashMatch[2]) - 1;
      const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
      parsed = new Date(year, month, day).getTime();
    }
  }
  if (!Number.isFinite(parsed)) return null;
  const iso = new Date(parsed);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

function compactTaskText(value = "", maxChars = 160) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function extractDocumentSignals({ text = "", relativePath = "", modifiedAt = 0 } = {}) {
  const normalizedText = normalizeDocumentWhitespace(String(text || ""));
  const compact = normalizedText.slice(0, 24000);
  const lower = `${relativePath}\n${compact}`.toLowerCase();
  const extension = path.extname(relativePath).toLowerCase();
  const lines = normalizedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line))?.replace(/^#{1,6}\s+/, "").trim()
    || lines.find(Boolean)
    || path.basename(relativePath || "document");
  const summary = compactTaskText(lines.find((line) => line && !/^[-*]\s/.test(line)) || heading, 200);

  const dueDates = [];
  const dateContextLines = lines
    .filter((line) => /\b(due|deadline|follow up|follow-up|review by|pay by|renew|meeting|appointment|schedule|invoice|bill)\b/i.test(line)
      || /\b(invoice|bill|calendar|meeting|appointment|renewal)\b/i.test(relativePath))
    .slice(0, 40);
  const dateValuePattern = /\b([A-Z][a-z]{2,8}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
  for (const line of dateContextLines) {
    for (const match of line.matchAll(dateValuePattern)) {
      const iso = normalizeDateCandidate(match[1] || match[0]);
      if (iso && !dueDates.includes(iso)) dueDates.push(iso);
      if (dueDates.length >= 6) break;
    }
    if (dueDates.length >= 6) break;
  }

  const contacts = [...new Set(
    [...compact.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((match) => String(match[0] || "").trim().toLowerCase())
  )].slice(0, 8);

  const actionCandidates = [];
  const candidateLines = lines
    .filter((line) => line.length <= 180)
    .filter((line) => !/[{}<>]/.test(line))
    .filter((line) => !/^\s*[-*]\s*$/.test(line))
    .slice(0, 120);
  for (const line of candidateLines) {
    const normalizedLine = line.replace(/^[-*]\s+/, "").trim();
    if (!normalizedLine) continue;
    if (!/\b(reply|send|pay|review|follow up|schedule|call|book|renew|todo|action|next step|need to)\b/i.test(normalizedLine)) continue;
    const action = compactTaskText(normalizedLine, 120);
    if (action && !actionCandidates.includes(action)) actionCandidates.push(action);
    if (actionCandidates.length >= 6) break;
  }

  let priority = 0;
  if (actionCandidates.length) priority += 2;
  if (dueDates.length) priority += 2;
  if (/\b(urgent|asap|important|immediately|overdue)\b/.test(lower)) priority += 2;
  if (modifiedAt && Date.now() - Number(modifiedAt || 0) < 24 * 60 * 60 * 1000) priority += 1;
  if ([".js", ".ts", ".tsx", ".jsx", ".json", ".html", ".htm", ".xml"].includes(extension)) priority -= 2;
  priority = Math.max(0, priority);

  return {
    heading: compactTaskText(heading, 160),
    summary,
    dueDates,
    contacts,
    actionCandidates,
    priority,
    category: detectDocumentCategory({ relativePath, text: compact, kind: "" })
  };
}

// ---------------------------------------------------------------------------
// Recursive file listing (ported from observer-opportunity-domain.js)
// ---------------------------------------------------------------------------

async function listRecursiveFiles(rootPath, { extensions = [], limit = 250, maxDepth = 5 } = {}) {
  const normalizedRoot = String(rootPath || "").trim();
  if (!normalizedRoot) return [];
  const allowed = new Set((extensions || []).map((value) => String(value || "").toLowerCase()).filter(Boolean));
  const matches = [];
  const queue = [{ path: normalizedRoot, depth: 0 }];
  while (queue.length && matches.length < limit) {
    const current = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (matches.length >= limit) break;
      const entryPath = path.join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (
          current.depth < maxDepth
          && !IGNORED_DIR_NAMES.has(entry.name.toLowerCase())
          && !entry.name.startsWith(".")
        ) {
          queue.push({ path: entryPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (allowed.size && !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      matches.push(entryPath);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const MANIFEST = {
  schemaVersion: 1,
  startupPriority: 100,
  permissions: {
    routes: true,
    uiPanels: false,
    data: true,
    capabilities: ["retrieval:search", "retrieval:ingest", "document:index", "document:search-summary"],
    hooks: [],
    runtimeContext: [],
    tools: []
  },
  compatibility: { coreApiMin: "1.0.0", coreApiMax: "" },
  dependencies: { requiredCapabilities: [], optionalCapabilities: ["brain:embed", "secrets:get"] },
  security: { isolation: "inprocess" }
};

export default function createRetrievalPlugin() {
  let api = null;
  let cachedConfig = null;
  let ensuredCollectionSize = 0;

  // ---- config ----

  async function loadConfig() {
    if (cachedConfig) return cachedConfig;
    const stored = await api.data.readJson("config", {});
    cachedConfig = { ...DEFAULT_CONFIG, ...(stored && typeof stored === "object" ? stored : {}) };
    return cachedConfig;
  }

  async function saveConfig(patch = {}) {
    const current = await loadConfig();
    cachedConfig = { ...current, ...patch };
    await api.data.writeJson("config", cachedConfig);
    ensuredCollectionSize = 0; // config may have changed the collection/URL; force re-check
    return cachedConfig;
  }

  const qdrant = createQdrantClient({
    getUrl: () => cachedConfig?.qdrantUrl || DEFAULT_CONFIG.qdrantUrl,
    getApiKey: async () => {
      const config = await loadConfig();
      const handle = String(config.qdrantApiKeyHandle || "").trim();
      if (!handle) return "";
      const getSecret = api?.getCapability?.("secrets:get");
      if (typeof getSecret !== "function") return "";
      try {
        return String((await getSecret({ handle })) || "");
      } catch {
        return "";
      }
    }
  });

  // ---- embedding (via brain:embed capability) ----

  async function embedTexts(texts = []) {
    const items = Array.isArray(texts) ? texts.map((value) => String(value || "").trim()).filter(Boolean) : [];
    if (!items.length) return { vectors: [], model: "" };
    const embed = api?.getCapability?.("brain:embed");
    if (typeof embed !== "function") {
      throw new Error("brain:embed capability is not available (no model-provider plugin is running)");
    }
    const vectors = [];
    let model = "";
    for (const text of items) {
      // model-provider-plugin.js's "brain:embed" capability takes { input } (matching Ollama's
      // /api/embed contract) and returns an array of embeddings, one per input item -- since we
      // send a single string here, that's an array containing exactly one vector.
      const result = await embed({ input: text });
      const vector = Array.isArray(result)
        ? (Array.isArray(result[0]) ? result[0] : result)
        : Array.isArray(result?.vector)
          ? result.vector
          : Array.isArray(result?.embedding)
            ? result.embedding
            : Array.isArray(result?.embeddings?.[0])
              ? result.embeddings[0]
              : null;
      if (!vector || !vector.length) {
        throw new Error("brain:embed returned an unexpected response shape (expected a vector array)");
      }
      vectors.push(vector);
      if (!model) model = String(result?.model || "").trim();
    }
    return { vectors, model };
  }

  // ---- vector-store state (doc registry: contentHash/chunkCount per docId) ----

  function createEmptyState(config) {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      collectionName: config.collectionName,
      workspaceKey: config.workspaceKey,
      lastSyncAt: 0,
      docs: {}
    };
  }

  async function loadState() {
    const config = await loadConfig();
    const raw = await api.data.readJson("state", null);
    if (!raw || typeof raw !== "object") return createEmptyState(config);
    return {
      schemaVersion: Number(raw.schemaVersion || 0),
      collectionName: String(raw.collectionName || "").trim(),
      workspaceKey: String(raw.workspaceKey || "").trim(),
      lastSyncAt: Number(raw.lastSyncAt || 0),
      docs: raw.docs && typeof raw.docs === "object" ? raw.docs : {}
    };
  }

  async function saveState(state) {
    await api.data.writeJson("state", state);
  }

  async function ensureCollection(config, vectorSize = 0) {
    const normalizedSize = Math.max(0, Number(vectorSize || 0));
    if (!normalizedSize) return { ok: false, error: "Vector size is required to bootstrap the Qdrant collection." };
    if (ensuredCollectionSize === normalizedSize) return { ok: true, collectionName: config.collectionName, vectorSize: ensuredCollectionSize };
    const existing = await qdrant.getCollection(config.collectionName);
    if (existing.ok) {
      ensuredCollectionSize = normalizedSize;
      return { ok: true, collectionName: config.collectionName, vectorSize: ensuredCollectionSize };
    }
    if (existing.status !== 404) return { ok: false, error: existing.error || "Unable to inspect Qdrant collection." };
    const created = await qdrant.createCollection(config.collectionName, normalizedSize);
    if (!created.ok) return { ok: false, error: created.error || "Unable to create Qdrant collection." };
    ensuredCollectionSize = normalizedSize;
    return { ok: true, collectionName: config.collectionName, vectorSize: ensuredCollectionSize };
  }

  async function deleteDocumentPoints(config, docId = "") {
    const filter = buildPayloadFilter({ docId }, config.workspaceKey);
    if (!filter) return { ok: false, error: "Document id is required for deletion." };
    const result = await qdrant.deletePointsByFilter(config.collectionName, filter);
    return { ok: result.ok, error: result.error || "" };
  }

  async function purgeWorkspaceIndex(config) {
    const filter = buildPayloadFilter({}, config.workspaceKey);
    if (!filter) return { ok: false, error: "Workspace key is required for purge." };
    const result = await qdrant.deletePointsByFilter(config.collectionName, filter);
    return { ok: result.ok, error: result.error || "" };
  }

  // Indexes a single normalized document (chunk, embed, upsert). Shared by direct path/text
  // ingestion and configured-root scanning. Returns "skipped" | "indexed" | "removed".
  async function indexOne({ config, state, docId, rootId = "adhoc", sourcePath = "", relativePath = "", sourceType = "text", title = "", text = "", modifiedAt = 0, force = false }) {
    const compactText = compactWhitespace(text);
    const contentHash = hashRef(`${sourceType}\n${compactText}`);
    const existing = state.docs[docId];
    if (!force && existing && existing.contentHash === contentHash && Number(existing.chunkSchemaVersion || 0) === CHUNK_SCHEMA_VERSION) {
      return { status: "skipped", docId, chunkCount: existing.chunkCount || 0 };
    }

    await deleteDocumentPoints(config, docId).catch(() => {});
    if (!compactText) {
      delete state.docs[docId];
      return { status: "removed", docId, chunkCount: 0 };
    }

    const chunks = chunkDocumentText(compactText);
    if (!chunks.length) {
      delete state.docs[docId];
      return { status: "removed", docId, chunkCount: 0 };
    }

    const embeddingResponse = await embedTexts(chunks);
    const vectors = embeddingResponse.vectors;
    if (!vectors.length || vectors.length !== chunks.length) {
      throw new Error("Embedding provider returned an unexpected vector count.");
    }
    const collectionReady = await ensureCollection(config, vectors[0]?.length || 0);
    if (!collectionReady.ok) throw new Error(collectionReady.error || "Unable to bootstrap the Qdrant collection.");

    const resolvedTitle = title || buildChunkPreview(compactText, 140) || relativePath || docId;
    const payloadBase = {
      schema_version: CHUNK_SCHEMA_VERSION,
      workspace_key: config.workspaceKey,
      doc_id: docId,
      root_id: rootId,
      source_path: sourcePath,
      relative_path: relativePath,
      source_type: sourceType,
      title: resolvedTitle,
      updated_at: Number(modifiedAt || Date.now()),
      content_hash: contentHash
    };
    const points = chunks.map((chunk, index) => ({
      id: buildUuidFromSeed(`${config.workspaceKey}|${docId}|${index}|${contentHash}`),
      vector: vectors[index],
      payload: { ...payloadBase, chunk_id: `${docId}:${index}`, chunk_index: index, chunk_total: chunks.length, text: chunk }
    }));
    const upserted = await qdrant.upsertPoints(config.collectionName, points);
    if (!upserted.ok) throw new Error(upserted.error || `Unable to index ${docId}.`);

    state.docs[docId] = {
      docId, rootId, path: sourcePath, relativePath, sourceType, title: resolvedTitle,
      contentHash, modifiedAt: Number(modifiedAt || Date.now()), chunkCount: chunks.length,
      chunkSchemaVersion: CHUNK_SCHEMA_VERSION, indexedAt: Date.now(), embeddingModel: embeddingResponse.model || ""
    };
    return { status: "indexed", docId, chunkCount: chunks.length };
  }

  async function scanConfiguredRoots({ config, state, force = false }) {
    const roots = (Array.isArray(config.roots) ? config.roots : [])
      .map((entry, index) => ({
        id: String(entry?.id || `root_${index + 1}`).trim(),
        rootPath: String(entry?.rootPath || "").trim(),
        maxDepth: Math.max(1, Number(entry?.maxDepth || 5) || 5),
        limit: Math.max(1, Number(entry?.limit || 250) || 250)
      }))
      .filter((entry) => entry.id && entry.rootPath);

    const summary = { indexed: 0, skipped: 0, removed: 0, chunks: 0, error: "" };
    const currentDocIds = new Set();

    for (const root of roots) {
      const files = await listRecursiveFiles(root.rootPath, { extensions: DOCUMENT_EXTENSIONS, limit: root.limit, maxDepth: root.maxDepth });
      for (const filePath of files) {
        let stats;
        try { stats = await fs.stat(filePath); } catch { continue; }
        if (!stats?.isFile?.()) continue;
        let raw;
        try { raw = await fs.readFile(filePath); } catch { continue; }
        let normalized;
        try {
          normalized = await normalizeDocumentContent({ buffer: raw, sourceLabel: filePath, sourceName: path.basename(filePath), contentType: "" });
        } catch { continue; }

        const relativePath = path.relative(root.rootPath, filePath).replace(/\\/g, "/");
        const docId = `${root.id}:${relativePath.toLowerCase()}`;
        currentDocIds.add(docId);
        try {
          const result = await indexOne({
            config, state, docId, rootId: root.id, sourcePath: filePath, relativePath,
            sourceType: normalized.kind || "text", text: normalized.text || "",
            modifiedAt: stats.mtimeMs, force
          });
          summary[result.status] += 1;
          summary.chunks += result.chunkCount || 0;
        } catch (error) {
          summary.error = String(error?.message || error || "indexing failed");
          return summary; // stop on embedding/qdrant failure, same as Nova's bootstrapError break
        }
      }
    }

    // Remove indexed docs that belong to a scanned root but no longer exist on disk.
    const scannedRootIds = new Set(roots.map((r) => r.id));
    for (const docId of Object.keys(state.docs || {})) {
      const entry = state.docs[docId];
      if (!scannedRootIds.has(entry?.rootId) || currentDocIds.has(docId)) continue;
      await deleteDocumentPoints(config, docId).catch(() => {});
      delete state.docs[docId];
      summary.removed += 1;
    }

    return summary;
  }

  async function retrievalIngest(args = {}) {
    const config = await loadConfig();
    const force = args.force === true;
    const state = await loadState();
    const results = { indexed: 0, skipped: 0, removed: 0, chunks: 0, errors: [] };

    const items = Array.isArray(args.items) ? args.items : [];
    for (const item of items) {
      const docId = String(item?.id || item?.docId || hashRef(item?.text || "")).trim();
      if (!docId) { results.errors.push("item is missing an id/text to hash"); continue; }
      try {
        const result = await indexOne({
          config, state, docId, rootId: String(item?.rootId || "adhoc"),
          sourcePath: String(item?.sourcePath || ""), relativePath: String(item?.relativePath || item?.title || docId),
          sourceType: String(item?.sourceType || "text"), title: String(item?.title || ""),
          text: String(item?.text || ""), modifiedAt: Number(item?.modifiedAt || Date.now()), force
        });
        results[result.status] += 1;
        results.chunks += result.chunkCount || 0;
      } catch (error) {
        results.errors.push(`${docId}: ${String(error?.message || error)}`);
      }
    }

    const paths = Array.isArray(args.paths) ? args.paths : [];
    for (const filePath of paths) {
      const resolvedPath = String(filePath || "").trim();
      if (!resolvedPath) continue;
      try {
        const stats = await fs.stat(resolvedPath);
        const raw = await fs.readFile(resolvedPath);
        const normalized = await normalizeDocumentContent({ buffer: raw, sourceLabel: resolvedPath, sourceName: path.basename(resolvedPath), contentType: "" });
        const docId = `adhoc:${resolvedPath.toLowerCase()}`;
        const result = await indexOne({
          config, state, docId, rootId: "adhoc", sourcePath: resolvedPath, relativePath: path.basename(resolvedPath),
          sourceType: normalized.kind || "text", text: normalized.text || "", modifiedAt: stats.mtimeMs, force
        });
        results[result.status] += 1;
        results.chunks += result.chunkCount || 0;
      } catch (error) {
        results.errors.push(`${resolvedPath}: ${String(error?.message || error)}`);
      }
    }

    if (args.scanRoots === true || (!items.length && !paths.length)) {
      const scanResult = await scanConfiguredRoots({ config, state, force });
      results.indexed += scanResult.indexed;
      results.skipped += scanResult.skipped;
      results.removed += scanResult.removed;
      results.chunks += scanResult.chunks;
      if (scanResult.error) results.errors.push(scanResult.error);
    }

    state.lastSyncAt = Date.now();
    await saveState(state);
    return { ok: results.errors.length === 0, ...results, totalDocuments: Object.keys(state.docs || {}).length, lastSyncAt: state.lastSyncAt };
  }

  async function retrievalSearch(args = {}) {
    const config = await loadConfig();
    const query = String(args.query || args.q || "").trim();
    if (!query) return { ok: true, query, collectionName: config.collectionName, matches: [] };

    let embeddingResponse;
    try {
      embeddingResponse = await embedTexts([query]);
    } catch (error) {
      return { ok: false, query, collectionName: config.collectionName, matches: [], error: String(error?.message || error) };
    }
    const vector = embeddingResponse.vectors[0];
    if (!vector?.length) {
      return { ok: false, query, collectionName: config.collectionName, matches: [], error: "Embedding provider returned no query vector." };
    }

    const collectionReady = await ensureCollection(config, vector.length);
    if (!collectionReady.ok) {
      return { ok: false, query, collectionName: config.collectionName, matches: [], error: collectionReady.error };
    }

    const response = await qdrant.queryPoints(config.collectionName, vector, {
      filter: buildPayloadFilter(args.filters || {}, config.workspaceKey),
      limit: Math.max(1, Number(args.limit || DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT)
    });
    if (!response.ok) {
      return { ok: false, query, collectionName: config.collectionName, matches: [], error: response.error || "Qdrant chunk search failed." };
    }

    const matches = extractQueryResults(response.body).map((entry) => ({
      id: String(entry?.id || "").trim(),
      score: Number(entry?.score || 0),
      payload: entry?.payload && typeof entry.payload === "object" ? entry.payload : {}
    }));
    return { ok: true, query, collectionName: config.collectionName, embeddingModel: embeddingResponse.model, matches };
  }

  async function clearWorkspaceIndex() {
    const config = await loadConfig();
    const purge = await purgeWorkspaceIndex(config);
    if (!purge.ok) return purge;
    await saveState(createEmptyState(config));
    return { ok: true, collectionName: config.collectionName };
  }

  async function getRetrievalStatus() {
    const config = await loadConfig();
    const state = await loadState();
    const docs = Object.values(state.docs || {});
    const statusMeta = {
      indexedDocumentCount: docs.length,
      indexedChunkCount: docs.reduce((total, entry) => total + Math.max(0, Number(entry?.chunkCount || 0)), 0),
      lastSyncAt: Number(state.lastSyncAt || 0),
      qdrantUrl: qdrant.baseUrl,
      collectionName: config.collectionName,
      workspaceKey: config.workspaceKey,
      hasEmbedCapability: typeof api?.getCapability?.("brain:embed") === "function"
    };
    if (!qdrant.baseUrl) {
      return { enabled: false, running: false, status: "unconfigured", error: "Qdrant URL is not configured.", ...statusMeta };
    }
    const response = await qdrant.getCollection(config.collectionName);
    if (response.ok) {
      return { enabled: true, running: true, status: "ok", collectionReady: true, error: "", ...statusMeta };
    }
    if (response.status === 404) {
      return { enabled: true, running: true, status: "missing_collection", collectionReady: false, error: "", ...statusMeta };
    }
    return { enabled: true, running: false, status: response.status || 0, collectionReady: false, error: response.error || "Qdrant is unavailable.", ...statusMeta };
  }

  // ---- document index (summary-level, non-vector metadata: headings, due dates, actions) ----

  async function loadDocumentIndex() {
    const raw = await api.data.readJson("document-index", null);
    if (!raw || typeof raw !== "object") return { lastScanAt: 0, entries: {} };
    return { lastScanAt: Number(raw.lastScanAt || 0), entries: raw.entries && typeof raw.entries === "object" ? raw.entries : {} };
  }

  async function saveDocumentIndex(index) {
    await api.data.writeJson("document-index", index);
  }

  async function documentIndex(args = {}) {
    const config = await loadConfig();
    const roots = (Array.isArray(args.roots) && args.roots.length ? args.roots : config.roots)
      .map((entry, index) => ({
        id: String(entry?.id || `root_${index + 1}`).trim(),
        rootPath: String(entry?.rootPath || "").trim(),
        maxDepth: Math.max(1, Number(entry?.maxDepth || 5) || 5),
        limit: Math.max(1, Number(entry?.limit || 250) || 250)
      }))
      .filter((entry) => entry.id && entry.rootPath);

    const previousIndex = await loadDocumentIndex();
    const nextEntries = {};
    const added = [];
    const changed = [];
    const allEntries = [];
    const now = Date.now();

    for (const root of roots) {
      const files = await listRecursiveFiles(root.rootPath, { extensions: DOCUMENT_EXTENSIONS, limit: root.limit, maxDepth: root.maxDepth });
      for (const filePath of files) {
        try {
          const stats = await fs.stat(filePath);
          if (!stats.isFile()) continue;
          const raw = await fs.readFile(filePath);
          const normalized = await normalizeDocumentContent({ buffer: raw, sourceLabel: filePath, sourceName: path.basename(filePath), contentType: "" });
          const relativePath = path.relative(root.rootPath, filePath).replace(/\\/g, "/");
          const signals = extractDocumentSignals({ text: normalized.text || "", relativePath, modifiedAt: Number(stats.mtimeMs || 0) });
          const checksum = hashRef(`${normalized.kind}\n${normalized.text || ""}`);
          const key = `${root.id}:${relativePath.toLowerCase()}`;
          const previous = previousIndex.entries?.[key];
          const entry = {
            id: key, rootId: root.id, path: filePath, relativePath, name: path.basename(filePath),
            extension: path.extname(filePath).toLowerCase(), size: Number(stats.size || 0), modifiedAt: Number(stats.mtimeMs || 0),
            scannedAt: now, kind: normalized.kind || "text", contentType: normalized.contentType || "", checksum,
            heading: signals.heading, summary: signals.summary, category: signals.category, dueDates: signals.dueDates,
            contacts: signals.contacts, actionCandidates: signals.actionCandidates, priority: Number(signals.priority || 0),
            warnings: Array.isArray(normalized.warnings) ? normalized.warnings : [],
            status: !previous ? "new" : previous.checksum !== checksum ? "changed" : "unchanged"
          };
          nextEntries[key] = entry;
          allEntries.push(entry);
          if (entry.status === "new") added.push(entry);
          else if (entry.status === "changed") changed.push(entry);
        } catch {
          continue;
        }
      }
    }

    const removed = Object.values(previousIndex.entries || {})
      .filter((entry) => entry?.id && !nextEntries[entry.id])
      .map((entry) => ({ id: entry.id, relativePath: entry.relativePath, rootId: entry.rootId }));

    const nextIndex = { lastScanAt: now, entries: nextEntries };
    await saveDocumentIndex(nextIndex);

    const sortByPriority = (list) => list.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0);
    });

    let ingestResult = null;
    if (args.ingest !== false) {
      ingestResult = await retrievalIngest({ scanRoots: true, force: args.force === true }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    }

    return {
      ok: true,
      totalDocuments: allEntries.length,
      newDocuments: added.length,
      changedDocuments: changed.length,
      removedDocuments: removed.length,
      topDocuments: sortByPriority(allEntries).slice(0, 12),
      lastScanAt: now,
      ingestResult
    };
  }

  async function searchIndexedDocuments(query = "", limit = 5) {
    const index = await loadDocumentIndex();
    const entries = Object.values(index.entries || {}).slice(0, 200);
    if (!entries.length) return { mode: "empty", matches: [] };

    const embed = api?.getCapability?.("brain:embed");
    if (typeof embed === "function") {
      try {
        const docTexts = entries.map((entry) => [entry.relativePath, entry.heading || "", entry.summary || "", (entry.actionCandidates || []).join("; ")].filter(Boolean).join("\n"));
        const [queryVector] = (await embedTexts([query])).vectors;
        const docVectors = (await embedTexts(docTexts)).vectors;
        const scored = entries.map((entry, index2) => ({ entry, score: cosineSimilarity(queryVector, docVectors[index2] || []) }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, Math.max(1, Math.min(limit, 8)));
        if (scored.length) return { mode: "semantic", matches: scored };
      } catch {
        // fall through to lexical search
      }
    }

    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 3);
    const scored = entries.map((entry) => {
      const haystack = `${entry.relativePath}\n${entry.heading || ""}\n${entry.summary || ""}\n${(entry.actionCandidates || []).join("\n")}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { entry, score };
    })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || Number(right.entry.priority || 0) - Number(left.entry.priority || 0))
      .slice(0, Math.max(1, Math.min(limit, 8)));
    return { mode: "lexical", matches: scored };
  }

  async function documentSearchSummary(args = {}) {
    const query = String(args.query || args.q || "").trim();
    if (!query) return { ok: true, query, lines: ["A query is required."] };

    const chunkResult = await retrievalSearch({ query, limit: Math.max(1, Number(args.limit || 5)) });
    if (chunkResult.ok && chunkResult.matches.length) {
      const lines = [`Found ${chunkResult.matches.length} relevant chunk${chunkResult.matches.length === 1 ? "" : "s"} for "${query}".`];
      for (const match of chunkResult.matches) {
        const payload = match.payload || {};
        const parts = [String(payload.relative_path || payload.source_path || payload.doc_id || "").trim()].filter(Boolean);
        if (Number.isFinite(match.score)) parts.push(`score: ${Number(match.score).toFixed(3)}`);
        const preview = compactTaskText(String(payload.text || "").replace(/\s+/g, " ").trim(), 180);
        if (preview) parts.push(preview);
        lines.push(`- ${compactTaskText(parts.join(" | "), 260)}`);
      }
      return { ok: true, query, mode: "chunk", lines };
    }

    const result = await searchIndexedDocuments(query, Math.max(1, Number(args.limit || 5)));
    if (!result.matches.length) {
      const reason = chunkResult.ok ? "no chunk or document index matches were found" : chunkResult.error;
      return { ok: true, query, mode: "none", lines: [`I couldn't find anything matching "${query}" (${reason}).`] };
    }
    const lines = [chunkResult.ok
      ? `No indexed chunks matched, so I used the summary-level document index for "${query}".`
      : `Chunk retrieval is unavailable (${chunkResult.error}), so I used the summary-level document index for "${query}".`];
    for (const match of result.matches) {
      const entry = match.entry;
      const parts = [entry.relativePath];
      if (entry.summary) parts.push(entry.summary);
      if (entry.actionCandidates?.length) parts.push(`actions: ${entry.actionCandidates.slice(0, 2).join("; ")}`);
      lines.push(`- ${compactTaskText(parts.join(" | "), 220)}`);
    }
    return { ok: true, query, mode: result.mode, lines };
  }

  return {
    id: "retrieval",
    name: "Retrieval",
    version: "0.1.0",
    description: "Vector-backed document retrieval (Qdrant + pluggable embeddings): chunking, indexing, semantic search, and a lightweight document index with due-date/action extraction.",
    manifest: MANIFEST,

    async init(pluginApi) {
      api = pluginApi;
      await loadConfig();

      api.provideCapability("retrieval:search", async (args = {}) => retrievalSearch(args));
      api.provideCapability("retrieval:ingest", async (args = {}) => retrievalIngest(args));
      api.provideCapability("document:index", async (args = {}) => documentIndex(args));
      api.provideCapability("document:search-summary", async (args = {}) => documentSearchSummary(args));
    },

    async registerRoutes({ app }) {
      app.get("/api/retrieval/status", async (_req, res) => {
        try {
          res.json({ ok: true, ...(await getRetrievalStatus()) });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read retrieval status") });
        }
      });

      app.get("/api/retrieval/config", async (_req, res) => {
        try {
          const config = await loadConfig();
          res.json({ ok: true, config: { ...config, qdrantApiKeyHandle: config.qdrantApiKeyHandle } });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read config") });
        }
      });

      app.post("/api/retrieval/config", async (req, res) => {
        try {
          const body = req.body || {};
          const patch = {};
          if (typeof body.qdrantUrl === "string") patch.qdrantUrl = body.qdrantUrl.trim();
          if (typeof body.collectionName === "string") patch.collectionName = body.collectionName.trim();
          if (typeof body.workspaceKey === "string") patch.workspaceKey = body.workspaceKey.trim();
          if (typeof body.qdrantApiKeyHandle === "string") patch.qdrantApiKeyHandle = body.qdrantApiKeyHandle.trim();
          if (Number.isFinite(Number(body.syncIntervalMs))) patch.syncIntervalMs = Number(body.syncIntervalMs);
          if (Array.isArray(body.roots)) patch.roots = body.roots;
          res.json({ ok: true, config: await saveConfig(patch) });
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "failed to update config") });
        }
      });

      app.post("/api/retrieval/search", async (req, res) => {
        try {
          res.json(await retrievalSearch(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "search failed") });
        }
      });

      app.post("/api/retrieval/ingest", async (req, res) => {
        try {
          res.json(await retrievalIngest(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "ingest failed") });
        }
      });

      app.post("/api/retrieval/clear", async (_req, res) => {
        try {
          res.json(await clearWorkspaceIndex());
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "clear failed") });
        }
      });

      app.post("/api/documents/index", async (req, res) => {
        try {
          res.json(await documentIndex(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "document index failed") });
        }
      });

      app.get("/api/documents/index", async (_req, res) => {
        try {
          const index = await loadDocumentIndex();
          const entries = Object.values(index.entries || {});
          res.json({
            ok: true,
            lastScanAt: index.lastScanAt,
            totalDocuments: entries.length,
            topDocuments: entries.sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 12)
          });
        } catch (err) {
          res.status(500).json({ ok: false, error: String(err?.message || err || "failed to read document index") });
        }
      });

      app.post("/api/documents/search-summary", async (req, res) => {
        try {
          res.json(await documentSearchSummary(req.body || {}));
        } catch (err) {
          res.status(400).json({ ok: false, error: String(err?.message || err || "document search failed") });
        }
      });
    }
  };
}
