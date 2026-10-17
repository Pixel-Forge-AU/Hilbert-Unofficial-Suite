const DEFAULT_MAX_EVIDENCE = 8;

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "you", "your", "are", "was",
  "were", "have", "has", "had", "but", "not", "can", "will", "just", "about", "into",
  "then", "than", "what", "when", "where", "why", "how", "our", "their", "they",
  "them", "his", "her", "she", "him", "its", "it's", "i'm", "i", "a", "an", "to",
  "of", "in", "on", "at", "is", "it", "be", "as", "or", "if", "we", "me", "my"
]);

const DECISION_KEYWORDS = [
  "agree", "disagree", "decide", "decision", "recommend", "suggest", "risk", "tradeoff",
  "priority", "block", "approve", "reject", "ship", "hold", "rollback", "scope",
  "同意", "不同意", "建议", "风险", "优先级", "决定", "确认", "拒绝", "推进", "暂缓"
];

const WORK_KEYWORDS = [
  "api", "database", "db", "schema", "test", "deploy", "release", "review", "pr",
  "bug", "incident", "runbook", "design", "spec", "frontend", "backend", "model",
  "接口", "数据库", "测试", "发布", "评审", "方案", "文档", "线上", "事故", "需求"
];

const REFUSAL_KEYWORDS = [
  "no", "not", "can't", "cannot", "won't", "blocked", "later", "after", "instead",
  "不", "不能", "不行", "先不", "晚点", "暂缓", "阻塞", "没法"
];

const TAG_RULES = new Map([
  ["perfectionist", "When reviewing or delivering work, keep asking for edge cases and polish until the output feels complete."],
  ["direct", "When something is unclear or wrong, say so plainly before softening the message."],
  ["data-driven", "When asked for a decision, ask for evidence, metrics, or examples before committing."],
  ["process-oriented", "When work is ambiguous, turn it into steps, owners, and checkpoints before acting."],
  ["procrastinator", "When a request has no deadline, delay commitment or ask to revisit it later."],
  ["concise", "Default to short answers and omit context unless someone asks for it."],
  ["mentor", "When someone is stuck, explain the principle and give a next action instead of only fixing it."],
  ["political", "When stakeholders disagree, avoid taking a hard public stance until incentives are clear."],
  ["conflict-avoidant", "When disagreeing, use questions or delays instead of direct rejection."],
  ["ownership", "When a problem affects your area, take responsibility first and separate cleanup from blame later."]
]);

function cleanText(value = "") {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

function compactText(value = "", maxLength = 220) {
  const normalized = cleanText(value).replace(/\s+/g, " ");
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function normalizeSources(input = {}) {
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const fromSources = sources.map((source, index) => ({
    id: String(source?.id || source?.name || `source-${index + 1}`).trim(),
    kind: String(source?.kind || source?.type || "text").trim().toLowerCase(),
    content: cleanText(source?.content || source?.text || ""),
    weight: Number(source?.weight || 1) || 1
  })).filter((source) => source.content);

  const rawText = cleanText(input.text || input.history || input.content || "");
  if (rawText) {
    fromSources.push({
      id: "inline-history",
      kind: "text",
      content: rawText,
      weight: 1
    });
  }
  return fromSources;
}

function parseStructuredLines(source, targetName = "") {
  const target = String(targetName || "").trim().toLowerCase();
  const lines = source.content.split("\n").map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  const pattern = /^(?:(?<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)\s+)?(?<sender>[^:：]{1,80})[:：]\s*(?<content>.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    const sender = String(match.groups?.sender || "").trim();
    const content = String(match.groups?.content || "").trim();
    if (!content) {
      continue;
    }
    if (target && !sender.toLowerCase().includes(target)) {
      continue;
    }
    parsed.push({
      sourceId: source.id,
      kind: source.kind,
      sender,
      timestamp: String(match.groups?.time || "").trim(),
      content,
      structured: true,
      weight: source.weight
    });
  }
  return parsed;
}

function parsePlainParagraphs(source) {
  return source.content
    .split(/\n{2,}/)
    .map((content) => compactText(content, 1200))
    .filter(Boolean)
    .map((content) => ({
      sourceId: source.id,
      kind: source.kind,
      sender: "",
      timestamp: "",
      content,
      structured: false,
      weight: source.weight
    }));
}

function extractMessages(sources = [], targetName = "") {
  const messages = [];
  for (const source of sources) {
    const structured = parseStructuredLines(source, targetName);
    messages.push(...(structured.length ? structured : parsePlainParagraphs(source)));
  }
  return messages;
}

function hasAnyKeyword(text = "", keywords = []) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function classifyMessages(messages = []) {
  const buckets = {
    longMessages: [],
    decisionMessages: [],
    workMessages: [],
    refusalMessages: [],
    styleSamples: []
  };

  for (const message of messages) {
    const content = message.content || "";
    if (content.length > 160) {
      buckets.longMessages.push(message);
    }
    if (hasAnyKeyword(content, DECISION_KEYWORDS)) {
      buckets.decisionMessages.push(message);
    }
    if (hasAnyKeyword(content, WORK_KEYWORDS)) {
      buckets.workMessages.push(message);
    }
    if (hasAnyKeyword(content, REFUSAL_KEYWORDS)) {
      buckets.refusalMessages.push(message);
    }
    if (content.length <= 180) {
      buckets.styleSamples.push(message);
    }
  }

  return buckets;
}

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_'-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function topTerms(messages = [], limit = 16) {
  const counts = new Map();
  for (const message of messages) {
    for (const token of tokenize(message.content)) {
      counts.set(token, (counts.get(token) || 0) + Number(message.weight || 1));
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .filter(([, count]) => count >= 2)
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function averageSentenceLength(messages = []) {
  const sentences = [];
  for (const message of messages) {
    sentences.push(...String(message.content || "").split(/[.!?。！？\n]+/).map((s) => s.trim()).filter(Boolean));
  }
  if (!sentences.length) {
    return { average: 0, label: "unknown" };
  }
  const average = sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length;
  const label = average < 45 ? "short" : average < 110 ? "medium" : "long";
  return { average: Math.round(average), label };
}

function estimateFormality(messages = []) {
  const text = messages.map((message) => message.content).join("\n");
  let score = 3;
  if (/[🙂😂😅👍🙏]| lol\b|haha|哈哈|hh\b/i.test(text)) score += 1;
  if (/\bplease\b|\bthanks\b|\bregards\b|您好|请|谢谢|辛苦/i.test(text)) score -= 1;
  if (/\bASAP\b|\bFYI\b|\bOKR\b|\bPRD\b|\bSOP\b/.test(text)) score -= 0.5;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function inferExpression(messages = []) {
  const terms = topTerms(messages);
  const sentenceLength = averageSentenceLength(messages);
  const text = messages.map((message) => message.content).join("\n");
  const usesLists = /^\s*(?:[-*]|\d+[.)])\s+/m.test(text) || /(^|\n).*(?:1[.)].*2[.)]|first\b.*second\b)/is.test(text);
  const emojiCount = (text.match(/\p{Emoji_Presentation}/gu) || []).length;
  const punctuationBursts = (text.match(/[!?！？]{2,}|\.{3,}|…/g) || []).length;

  return {
    frequentTerms: terms,
    sentenceLength,
    usesLists,
    conclusionStyle: usesLists || /\btl;dr\b|结论|summary|bottom line/i.test(text) ? "front-loaded or structured" : "context-first or conversational",
    emoji: emojiCount > 8 ? "frequent" : emojiCount > 0 ? "occasional" : "none detected",
    punctuation: punctuationBursts > 4 ? "expressive" : "controlled",
    formality: estimateFormality(messages)
  };
}

function evidenceLine(message) {
  const prefix = [message.sourceId, message.timestamp].filter(Boolean).join(" ");
  return `${prefix ? `[${prefix}] ` : ""}"${compactText(message.content, 180)}"`;
}

function takeEvidence(messages = [], limit = DEFAULT_MAX_EVIDENCE) {
  return messages.slice(0, limit).map(evidenceLine);
}

function inferDecisionPattern(buckets) {
  const priority = [];
  const workText = buckets.workMessages.map((message) => message.content).join("\n").toLowerCase();
  const decisionText = buckets.decisionMessages.map((message) => message.content).join("\n").toLowerCase();
  if (/data|metric|measure|evidence|数据|指标|证据/.test(decisionText)) priority.push("evidence/data");
  if (/risk|safe|security|rollback|风险|安全|回滚/.test(decisionText)) priority.push("risk control");
  if (/user|customer|ux|用户|客户|体验/.test(decisionText)) priority.push("user impact");
  if (/deadline|ship|fast|quick|效率|上线|交付/.test(decisionText)) priority.push("delivery speed");
  if (/process|sop|owner|流程|负责人|对齐/.test(workText + decisionText)) priority.push("process clarity");
  if (!priority.length) priority.push("insufficient evidence; infer from manual tags only");

  return {
    priorities: [...new Set(priority)],
    pushTriggers: buckets.decisionMessages.length
      ? "Pushes when there is enough context to compare impact, risk, and ownership."
      : "Insufficient direct decision evidence.",
    avoidanceTriggers: buckets.refusalMessages.length
      ? "Avoids or delays requests that are blocked, under-scoped, or outside current ownership."
      : "Insufficient direct avoidance evidence.",
    disagreementStyle: buckets.refusalMessages.length
      ? "Uses explicit blocking language or redirects to missing prerequisites."
      : "Insufficient evidence; default to asking clarifying questions before disagreeing."
  };
}

function inferWorkProfile(buckets, expression) {
  const workTerms = topTerms(buckets.workMessages.length ? buckets.workMessages : buckets.longMessages, 18);
  return {
    domains: workTerms.slice(0, 10).map((entry) => entry.term),
    workflow: buckets.workMessages.length
      ? [
          "Clarify scope and ownership from the available thread.",
          "Surface risks and decisions before implementation details.",
          "Use the person's recurring technical terms and document structure."
        ]
      : ["Insufficient work-specific history; keep workflow generic until more source material is added."],
    outputPreference: expression.usesLists
      ? "Structured lists or sections, with conclusions easy to scan."
      : "Plain prose with context carried in the answer.",
    evidence: takeEvidence(buckets.workMessages.length ? buckets.workMessages : buckets.longMessages, 6)
  };
}

function buildLayer0Rules({ manualTags = [], expression, decisionPattern, buckets }) {
  const rules = [];
  for (const tag of manualTags) {
    const key = String(tag || "").trim().toLowerCase();
    if (TAG_RULES.has(key)) {
      rules.push(TAG_RULES.get(key));
    } else if (key) {
      rules.push(`Respect the manual trait "${tag}" by translating it into concrete behavior before answering.`);
    }
  }
  if (expression.usesLists) {
    rules.push("When explaining complex work, organize the answer into bullets or short labeled sections.");
  }
  if (expression.sentenceLength.label === "short") {
    rules.push("Keep routine replies compact; add detail only when the task needs it.");
  }
  if (decisionPattern.priorities.includes("evidence/data")) {
    rules.push("When making recommendations, ask for or cite evidence before choosing a direction.");
  }
  if (decisionPattern.priorities.includes("risk control")) {
    rules.push("When a plan carries uncertainty, call out risks and rollback paths before saying yes.");
  }
  if (buckets.refusalMessages.length) {
    rules.push("When rejecting or delaying work, name the blocker or missing prerequisite instead of giving a vague no.");
  }
  if (!rules.length) {
    rules.push("Stay evidence-led: imitate only patterns supported by the supplied history or explicit manual tags.");
  }
  return [...new Set(rules)].slice(0, 12);
}

function identityLine(input = {}) {
  const parts = [
    input.company,
    input.level,
    input.role
  ].map((part) => String(part || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "Identity details not supplied.";
}

export function analyzePersonalityClone(input = {}) {
  const name = String(input.name || input.targetName || "Unnamed Person").trim();
  const targetName = String(input.targetName || input.name || "").trim();
  const manualTags = normalizeArray(input.manualTags || input.tags);
  const sources = normalizeSources(input);
  const messages = extractMessages(sources, targetName);
  const buckets = classifyMessages(messages);
  const expression = inferExpression(messages);
  const decisionPattern = inferDecisionPattern(buckets);
  const workProfile = inferWorkProfile(buckets, expression);
  const layer0 = buildLayer0Rules({ manualTags, expression, decisionPattern, buckets });

  return {
    name,
    targetName,
    identity: {
      company: String(input.company || input.identity?.company || "").trim(),
      level: String(input.level || input.identity?.level || "").trim(),
      role: String(input.role || input.identity?.role || "").trim(),
      summary: identityLine({ ...input.identity, ...input })
    },
    sourceCount: sources.length,
    messageCount: messages.length,
    manualTags,
    buckets: {
      longMessages: buckets.longMessages.length,
      decisionMessages: buckets.decisionMessages.length,
      workMessages: buckets.workMessages.length,
      refusalMessages: buckets.refusalMessages.length,
      styleSamples: buckets.styleSamples.length
    },
    expression,
    decisionPattern,
    workProfile,
    layer0,
    evidence: {
      expression: takeEvidence(buckets.styleSamples, 6),
      decisions: takeEvidence(buckets.decisionMessages, 6),
      refusals: takeEvidence(buckets.refusalMessages, 4),
      work: workProfile.evidence
    }
  };
}

function markdownList(items = [], fallback = "- Insufficient evidence.") {
  const normalized = normalizeArray(items);
  return normalized.length ? normalized.map((item) => `- ${item}`).join("\n") : fallback;
}

function markdownTerms(terms = []) {
  if (!Array.isArray(terms) || !terms.length) {
    return "- Insufficient repeated vocabulary evidence.";
  }
  return terms.map((entry) => `- ${entry.term} (${entry.count})`).join("\n");
}

export function buildPersonaMarkdown(analysis = {}) {
  const expression = analysis.expression || {};
  const decision = analysis.decisionPattern || {};
  const evidence = analysis.evidence || {};
  return `# ${analysis.name || "Person"} - Persona

## Layer 0: Core Behavior
${markdownList(analysis.layer0)}

## Layer 1: Identity
- You are ${analysis.name || "this person"}.
- ${analysis.identity?.summary || "Identity details not supplied."}
- Manual tags: ${normalizeArray(analysis.manualTags).join(", ") || "none supplied"}

## Layer 2: Expression Style
- Sentence rhythm: ${expression.sentenceLength?.label || "unknown"} (${expression.sentenceLength?.average || 0} chars average).
- Structure: ${expression.usesLists ? "uses lists or sectioned answers" : "mostly prose or conversational answers"}.
- Conclusion style: ${expression.conclusionStyle || "unknown"}.
- Emoji: ${expression.emoji || "unknown"}.
- Punctuation: ${expression.punctuation || "unknown"}.
- Formality: ${expression.formality || "unknown"} / 5.

### Frequent Terms
${markdownTerms(expression.frequentTerms)}

### Evidence
${markdownList(evidence.expression)}

## Layer 3: Decision Model
- Priorities: ${(decision.priorities || []).join(" > ") || "insufficient evidence"}.
- Push trigger: ${decision.pushTriggers || "insufficient evidence"}.
- Avoidance trigger: ${decision.avoidanceTriggers || "insufficient evidence"}.
- Disagreement style: ${decision.disagreementStyle || "insufficient evidence"}.

### Decision Evidence
${markdownList(evidence.decisions)}

## Layer 4: Interpersonal Behavior
- With peers: infer from decision and expression history; mirror the observed tone and directness.
- With juniors: use the same level of structure and context shown in source material.
- Under pressure: shorten the response, surface blockers, and move toward concrete next steps.

## Layer 5: Boundaries And Red Lines
${markdownList(evidence.refusals.length ? evidence.refusals : ["Insufficient refusal/boundary evidence. Add examples where they pushed back, delayed, or refused."])}

## Correction Log
- No corrections yet.

## Operating Rule
Layer 0 overrides every other section. If a requested behavior conflicts with explicit evidence or a correction, follow the correction/evidence and say what assumption you used.
`;
}

export function buildWorkMarkdown(analysis = {}) {
  const work = analysis.workProfile || {};
  return `# ${analysis.name || "Person"} - Work Skill

## Responsibility Signals
${markdownList((work.domains || []).map((domain) => `Observed domain/term: ${domain}`))}

## Work Flow
${markdownList(work.workflow)}

## Output Preference
- ${work.outputPreference || "Insufficient evidence."}

## Technical And Domain Vocabulary
${markdownList((work.domains || []).map((domain) => `Use and understand "${domain}" when relevant.`))}

## Experience Knowledge Base
${markdownList(work.evidence)}

## Work Capability Rule
When a task falls inside the observed domains, use this work profile to choose structure, vocabulary, and review focus. When the history is thin, label the assumption instead of pretending certainty.
`;
}

export function buildCombinedSkillMarkdown(analysis = {}, workMarkdown = "", personaMarkdown = "") {
  return `---
name: ${String(analysis.name || "personality-clone").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "personality-clone"}
description: Personality clone generated from observed history and manual tags.
user-invocable: true
---

# ${analysis.name || "Personality Clone"}

## Part A: Work

${workMarkdown || buildWorkMarkdown(analysis)}

## Part B: Persona

${personaMarkdown || buildPersonaMarkdown(analysis)}

## Runtime Rules

1. Start with Part B to decide attitude, tone, and whether to push back.
2. Use Part A to execute the task.
3. Preserve the diction, rhythm, and reaction patterns from Part B.
4. Do not invent unsupported traits; mark thin evidence as an assumption.
`;
}

export function buildCloneArtifacts(input = {}) {
  const analysis = analyzePersonalityClone(input);
  const personaMarkdown = buildPersonaMarkdown(analysis);
  const workMarkdown = buildWorkMarkdown(analysis);
  const skillMarkdown = buildCombinedSkillMarkdown(analysis, workMarkdown, personaMarkdown);
  return {
    analysis,
    personaMarkdown,
    workMarkdown,
    skillMarkdown
  };
}

export function applyPersonaCorrection({ personaMarkdown = "", scene = "", wrong = "", correct = "" } = {}) {
  const content = cleanText(personaMarkdown);
  const correction = `- [${compactText(scene || "general", 80)}] should not ${compactText(wrong || "repeat the previous behavior", 160)}; should ${compactText(correct || "follow the corrected behavior", 220)}`;
  if (!content) {
    return `## Correction Log\n${correction}\n`;
  }
  if (/^## Correction Log\s*$/m.test(content)) {
    return content.replace(/^## Correction Log\s*$/m, `## Correction Log\n${correction}`);
  }
  return `${content}\n\n## Correction Log\n${correction}\n`;
}

export function buildIncrementalMerge(input = {}) {
  const artifacts = buildCloneArtifacts(input);
  return {
    analysis: artifacts.analysis,
    workPatch: [
      "## Incremental Work Evidence",
      markdownList(artifacts.analysis.evidence?.work || []),
      "",
      "## Incremental Work Vocabulary",
      markdownList((artifacts.analysis.workProfile?.domains || []).map((domain) => domain))
    ].join("\n"),
    personaPatch: [
      "## Incremental Persona Evidence",
      markdownList([
        ...(artifacts.analysis.evidence?.expression || []),
        ...(artifacts.analysis.evidence?.decisions || []),
        ...(artifacts.analysis.evidence?.refusals || [])
      ].slice(0, 12)),
      "",
      "## Incremental Core Rules",
      markdownList(artifacts.analysis.layer0 || [])
    ].join("\n")
  };
}
