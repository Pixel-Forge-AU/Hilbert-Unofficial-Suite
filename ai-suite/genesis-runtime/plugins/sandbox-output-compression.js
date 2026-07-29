// Ported faithfully from genesis-core's server/output-semantic-compression.js.
// Self-contained, no Nova-specific coupling, no external dependencies (regex-based
// heuristics only). Used by sandbox-plugin.js to turn raw shell/tool output into a
// denser "semantic map" summary before handing it back to a caller/LLM prompt.

// ============================================================================
// SEMANTIC EXTRACTION (Regex-based for code, heuristic for unstructured)
// ============================================================================

/**
 * Parse JavaScript/JSON output into semantic tokens.
 * Extracts: function definitions, class structures, imports, exports, errors.
 * Uses regex patterns instead of full AST parsing (no external AST parser needed).
 */
export function parseCodeAst(sourceCode = "") {
  const sanitized = String(sourceCode || "").trim();
  if (!sanitized) return { valid: false, tokens: [] };

  const tokens = extractRegexTokens(sanitized);

  return {
    valid: tokens.length > 0,
    tokens,
    ast: null // No full AST, but regex tokens provide semantic info
  };
}

function extractRegexTokens(code) {
  const tokens = [];

  // Function definitions
  (code.match(/(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g) || [])
    .slice(0, 10).forEach(match => {
      tokens.push({ type: 'function', name: match });
    });

  // Class definitions
  (code.match(/class\s+(\w+)/g) || []).forEach(match => {
    tokens.push({ type: 'class', name: match });
  });

  // Errors/throws
  if (/throw\s+new|Error\(|throw\s+/.test(code)) {
    tokens.push({ type: 'error', severity: 'critical' });
  }

  // Imports/exports (ESM and CommonJS)
  (code.match(/^\s*import\s+.+?from\s+['"][^'"]+['"]|require\(\s*['"][^'"]+['"]\s*\)/gm) || [])
    .slice(0, 10).forEach(match => {
      tokens.push({ type: 'import', name: match.trim() });
    });
  (code.match(/^\s*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+\w+|module\.exports\s*=/gm) || [])
    .slice(0, 10).forEach(match => {
      tokens.push({ type: 'export', name: match.trim() });
    });

  // Variable assignments
  (code.match(/(?:const|let|var)\s+(\w+)\s*=/g) || []).slice(0, 8).forEach(match => {
    tokens.push({ type: 'variable', name: match });
  });

  return tokens;
}

// ============================================================================
// SHELL OUTPUT ANALYSIS & COMPRESSION
// ============================================================================

/**
 * Analyzes and compresses shell command output.
 * Detects error patterns, extracts key info, removes noise.
 */
export function compressShellOutput(output = "", command = "") {
  const lines = String(output || "").split(/\r?\n/);
  const analysis = {
    raw: output,
    exitCode: 0,
    hasError: false,
    hasWarning: false,
    keyLines: [],
    errorPattern: null,
    executionTime: null,
    outputSize: output.length,
    lineCount: lines.length,
    density: 0 // Will calculate after extraction
  };

  // Error detection
  const errorPatterns = [
    /^Error:\s*(.+)/m,
    /^fatal:\s*(.+)/m,
    /^FAIL/m,
    /^\[ERR\]/m,
    /failed|exception|abort/i
  ];

  for (const pattern of errorPatterns) {
    const match = output.match(pattern);
    if (match) {
      analysis.hasError = true;
      analysis.errorPattern = match[1] || pattern.source;
      break;
    }
  }

  // Warning detection
  if (/^(WARN|WARNING):|deprecated|notice|⚠/m.test(output)) {
    analysis.hasWarning = true;
  }

  // Extract key lines (skip noise)
  const keyPatterns = [
    /^(>|✓|✗|➜|\[OK\]|\[FAIL\]|\d+\))\s+(.+)/, // Command indicators
    /^(Summary|Total|Result|Status|Output):\s*(.+)/i,
    /^(File|Dir|Changed|Added|Removed|Modified):\s*(.+)/i,
    /^\d+ (error|warning|test|file)s?/i,
    /\w+\.\w+:\d+:\d+/ // File positions
  ];

  for (const line of lines) {
    if (line.length > 180) continue; // Skip very long lines
    if (/^\s*$/.test(line)) continue; // Skip empty
    if (/^(npm|yarn|pnpm)(WARN|ERR)!/.test(line)) continue; // Skip noise

    let isKey = false;
    for (const pattern of keyPatterns) {
      if (pattern.test(line)) {
        isKey = true;
        break;
      }
    }

    if (isKey && analysis.keyLines.length < 12) {
      analysis.keyLines.push(line.trim());
    }
  }

  // Execution time extraction
  const timeMatch = output.match(/(?:real|user|sys|took|took|Duration:?)\s*[\d.]+[ms]+/i);
  if (timeMatch) {
    analysis.executionTime = timeMatch[0];
  }

  // Calculate information density
  const importantLines = analysis.keyLines.length + (analysis.errorPattern ? 1 : 0) + (analysis.executionTime ? 1 : 0);
  analysis.density = importantLines > 0 ? (importantLines / Math.max(1, lines.length / 2)) : 0;

  return analysis;
}

// ============================================================================
// SEMANTIC MAP BUILDING & COMPRESSION
// ============================================================================

/**
 * High-density semantic map representing tool/command output.
 * Preserves intent while removing textual noise.
 */
export function buildSemanticMap(toolOutput = "", toolName = "", context = {}) {
  const {
    command = "",
    outputType = "text", // 'text', 'json', 'code', 'file-list', etc.
    targetFile = "",
    expectation = "" // What was the tool supposed to do?
  } = context;

  const map = {
    tool: String(toolName || "").trim(),
    command: String(command || "").trim().substring(0, 200),
    type: outputType,
    timestamp: Date.now(),
    tokens: [],
    keyFindings: [],
    semanticSignature: "", // Hash of important content
    informationDensity: 0,
    semantic: {} // Tool-specific semantic extraction
  };

  // Detect output type if not specified
  if (!outputType || outputType === "text") {
    if (isJsonOutput(toolOutput)) {
      map.type = "json";
    } else if (isCodeOutput(toolOutput)) {
      map.type = "code";
    } else if (isFileListOutput(toolOutput)) {
      map.type = "file-list";
    } else if (isDiffOutput(toolOutput)) {
      map.type = "diff";
    }
  }

  // Route to appropriate semantic extractor
  switch (map.type) {
    case 'code':
      map.semantic = extractCodeSemantic(toolOutput);
      map.tokens = parseCodeAst(toolOutput).tokens;
      break;
    case 'json':
      map.semantic = extractJsonSemantic(toolOutput);
      break;
    case 'file-list':
      map.semantic = extractFileListSemantic(toolOutput);
      break;
    case 'diff':
      map.semantic = extractDiffSemantic(toolOutput);
      break;
    case 'log':
    case 'text':
    default:
      map.semantic = extractLogSemantic(toolOutput);
      break;
  }

  // Shell output compression
  const compressed = compressShellOutput(toolOutput, command);
  map.keyFindings = compressed.keyLines;
  map.hasError = compressed.hasError;
  map.errorPattern = compressed.errorPattern;
  map.executionTime = compressed.executionTime;
  map.informationDensity = Math.min(100, Math.round(compressed.density * 100));

  // Build semantic signature (content hash without noise)
  map.semanticSignature = buildSemanticSignature(map.semantic, map.keyFindings);

  return map;
}

function extractCodeSemantic(code = "") {
  const tokens = parseCodeAst(code).tokens;
  const lines = code.split(/\r?\n/);

  return {
    type: 'code',
    totalLines: lines.length,
    nonEmptyLines: lines.filter(l => /\S/.test(l)).length,
    complexity: tokens.filter(t => ['function', 'class', 'error'].includes(t.type)).length,
    functions: tokens.filter(t => t.type === 'function').map(t => t.name).filter(Boolean),
    classes: tokens.filter(t => t.type === 'class').map(t => t.name).filter(Boolean),
    errors: tokens.filter(t => t.type === 'error'),
    imports: tokens.filter(t => t.type === 'import').slice(0, 5),
    exports: tokens.filter(t => t.type === 'export'),
    hasTests: /describe|it\(|test\(/i.test(code),
    hasAsync: /async\s+|await\s+/i.test(code),
    style: detectCodeStyle(code)
  };
}

function extractJsonSemantic(json = "") {
  try {
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed || {});
    const depth = getJsonDepth(parsed);

    return {
      type: 'json',
      keys: keys.slice(0, 15),
      depth,
      itemCount: Array.isArray(parsed) ? parsed.length : 1,
      hasNulls: JSON.stringify(parsed).includes('null'),
      hasErrors: keys.some(k => /error|fail|exception/i.test(k)),
      structure: keys.map(k => ({ key: k, type: typeof parsed[k] })).slice(0, 10)
    };
  } catch (e) {
    return { type: 'json', error: 'parse_failed', message: e.message };
  }
}

function extractFileListSemantic(listing = "") {
  const lines = listing.split(/\r?\n/).filter(l => /\S/.test(l));
  const files = lines.filter(l => !l.endsWith('/'));
  const dirs = lines.filter(l => l.endsWith('/'));
  const extMap = {};

  files.forEach(f => {
    const ext = f.match(/\.(\w+)$/)?.[1] || 'none';
    extMap[ext] = (extMap[ext] || 0) + 1;
  });

  return {
    type: 'file-list',
    totalEntries: lines.length,
    fileCount: files.length,
    dirCount: dirs.length,
    extensions: Object.entries(extMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ext, count]) => ({ ext, count })),
    hasHiddenFiles: /^\./.test(listing),
    totalSize: estimateSize(listing)
  };
}

function extractDiffSemantic(diff = "") {
  const lines = diff.split(/\r?\n/);
  const added = lines.filter(l => l.startsWith('+')).length - 1; // Exclude +++
  const removed = lines.filter(l => l.startsWith('-')).length - 1; // Exclude ---
  const chunks = (diff.match(/@@ .+? @@/g) || []).length;

  return {
    type: 'diff',
    addedLines: added,
    removedLines: removed,
    totalChanges: added + removed,
    chunks,
    filesChanged: (diff.match(/^(---|\+\+\+)/gm) || []).length / 2,
    conflicted: /^(<<<<<|=====|>>>>>)/m.test(diff)
  };
}

function extractLogSemantic(log = "") {
  const lines = log.split(/\r?\n/);
  const levels = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
  const timestamps = [];
  const modules = new Set();

  lines.forEach(l => {
    if (/\[DEBUG\]/i.test(l)) levels.debug++;
    if (/\[INFO\]/i.test(l)) levels.info++;
    if (/\[WARN\]/i.test(l)) levels.warn++;
    if (/\[ERROR\]/i.test(l)) levels.error++;
    if (/\[FATAL\]/i.test(l)) levels.fatal++;

    const ts = l.match(/\d{2}:\d{2}:\d{2}/);
    if (ts) timestamps.push(ts[0]);

    const module = l.match(/\[(\w+)\]/);
    if (module) modules.add(module[1]);
  });

  return {
    type: 'log',
    totalLines: lines.length,
    levels: Object.fromEntries(Object.entries(levels).filter(([, v]) => v > 0)),
    modules: Array.from(modules).slice(0, 8),
    timeRange: timestamps.length >= 2
      ? { start: timestamps[0], end: timestamps[timestamps.length - 1] }
      : null,
    hasStackTrace: /at\s+\w+|stack|traceback/i.test(log),
    hasTimestamp: timestamps.length > 0
  };
}

function detectCodeStyle(code = "") {
  return {
    tabs: /^\t/.test(code),
    spaces: /^[ ]{2,}/.test(code),
    semicolons: /;/.test(code),
    quotes: /'/.test(code) ? 'single' : /"/.test(code) ? 'double' : 'none'
  };
}

function getJsonDepth(obj, depth = 0) {
  if (depth > 10) return 10;
  if (obj === null || typeof obj !== 'object') return depth;

  let maxDepth = depth;
  for (const value of Object.values(obj)) {
    const childDepth = getJsonDepth(value, depth + 1);
    maxDepth = Math.max(maxDepth, childDepth);
  }
  return maxDepth;
}

function estimateSize(text = "") {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function buildSemanticSignature(semantic = {}, keyFindings = []) {
  const essential = {
    ...semantic,
    keyFindings: keyFindings.slice(0, 3)
  };

  let content = JSON.stringify(essential);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============================================================================
// TYPE DETECTION HELPERS
// ============================================================================

function isJsonOutput(text = "") {
  const trimmed = String(text || "").trim();
  return (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
         (trimmed.endsWith('}') || trimmed.endsWith(']'));
}

function isCodeOutput(text = "") {
  const patterns = [
    /^\s*(function|const|class|import|export|async)\s+/m,
    /^\s*\/\//m, // Comments
    /\{[\s\S]*\}/,
    /\([\s\S]*\)/
  ];

  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) score++;
  }
  return score >= 2;
}

function isFileListOutput(text = "") {
  const lines = text.split(/\r?\n/);
  const pathLikeLines = lines.filter(l => /^[\w\-/.~]+(?:\/)?$/.test(l)).length;
  return pathLikeLines / lines.length > 0.7;
}

function isDiffOutput(text = "") {
  return /^(---|(\+\+\+)|@@)\s+/.test(text.split(/\r?\n/).join('\n'));
}

// ============================================================================
// DENSITY VALIDATION (TDD SUPPORT)
// ============================================================================

/**
 * Validates that compression preserves necessary information.
 * Returns false if density drops below threshold or critical info is lost.
 */
export function validateSemanticDensity(original = "", semantic = {}, minDensity = 50) {
  const checks = {
    densityMet: semantic.informationDensity >= minDensity,
    hasKeyFindings: (semantic.keyFindings || []).length > 0,
    semanticIntegrity: Boolean(semantic.semantic),
    errorPreserved: !/ERROR|FAIL|fail/.test(original) || semantic.hasError !== false,
    noiseRemoved: original.length > semantic.semantic ? true : false,
    tokenExtraction: (semantic.tokens || []).length > 0 || semantic.type !== 'code'
  };

  return {
    valid: Object.values(checks).filter(v => v).length >= 4,
    checks,
    score: Object.values(checks).filter(v => v).length / Object.keys(checks).length
  };
}

/**
 * Format semantic map for model consumption (inline).
 */
export function formatSemanticForModel(semanticMap = {}) {
  const parts = [];

  parts.push(`[${semanticMap.tool}:${semanticMap.type}]`);

  if (semanticMap.semantic?.functions?.length) {
    parts.push(`functions:${semanticMap.semantic.functions.join(',')}`);
  }

  if (semanticMap.semantic?.classes?.length) {
    parts.push(`classes:${semanticMap.semantic.classes.join(',')}`);
  }

  if (semanticMap.hasError) {
    parts.push(`ERROR:${semanticMap.errorPattern}`);
  }

  if (semanticMap.keyFindings?.length) {
    parts.push(`findings:[${semanticMap.keyFindings.slice(0, 2).join('|')}]`);
  }

  if (semanticMap.informationDensity) {
    parts.push(`density:${semanticMap.informationDensity}%`);
  }

  return parts.join(' ');
}

// ============================================================================
// SHELL RESULT COMPRESSION (Integration with Sandbox I/O)
// ============================================================================

/**
 * Compress a shell execution result (from runCommand).
 * Applies semantic compression to stdout/result and attaches metadata.
 */
export async function compressShellResult(result = {}, command = "", context = {}) {
  const {
    expectation = "",
    minDensity = 50,
    stripRaw = false
  } = context;

  // Extract output from various possible result formats
  const output = String(result?.stdout || result?.result || result?.output || "").trim();
  const stderr = String(result?.stderr || "").trim();

  // Build semantic map from the output
  const semantic = buildSemanticMap(output, 'shell_command', {
    command,
    outputType: 'text',
    expectation
  });

  // Format for model consumption
  const modelFormat = formatSemanticForModel(semantic);

  // Validation
  const validation = validateSemanticDensity(output, semantic, minDensity);

  // Return compression result
  return {
    semantic,
    modelFormat,
    validation,
    metadata: {
      originalLength: output.length,
      compressedLength: modelFormat.length,
      compressionRatio: (1 - modelFormat.length / Math.max(1, output.length)).toFixed(2),
      informationDensity: semantic.informationDensity,
      hasError: semantic.hasError,
      stderrPresent: stderr.length > 0
    }
  };
}

export default {
  parseCodeAst,
  compressShellOutput,
  buildSemanticMap,
  validateSemanticDensity,
  formatSemanticForModel,
  compressShellResult
};
