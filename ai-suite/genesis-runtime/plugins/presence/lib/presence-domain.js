import { compactText } from "../../../observer-general-utils.js";

const SETTINGS_KEY = "settings";
const OBSERVATIONS_KEY = "observations";
const PEOPLE_KEY = "people";
const THREADS_KEY = "threads";

const DEFAULT_SETTINGS = {
  enabled: true,
  captureInterim: false,
  autoQueueQuestions: true,
  autoCreateTodos: false,
  minimumTextLength: 8,
  retentionLimit: 300,
  threadWindowMs: 90_000,
  maxThreadObservations: 8
};


function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === "object" ? settings : {}),
    minimumTextLength: Math.max(1, Number(settings?.minimumTextLength || DEFAULT_SETTINGS.minimumTextLength) || DEFAULT_SETTINGS.minimumTextLength),
    retentionLimit: Math.max(50, Math.min(2000, Number(settings?.retentionLimit || DEFAULT_SETTINGS.retentionLimit) || DEFAULT_SETTINGS.retentionLimit)),
    threadWindowMs: Math.max(10_000, Math.min(10 * 60_000, Number(settings?.threadWindowMs || DEFAULT_SETTINGS.threadWindowMs) || DEFAULT_SETTINGS.threadWindowMs)),
    maxThreadObservations: Math.max(2, Math.min(30, Number(settings?.maxThreadObservations || DEFAULT_SETTINGS.maxThreadObservations) || DEFAULT_SETTINGS.maxThreadObservations))
  };
}

function normalizeSourceIdentity(sourceIdentity = {}) {
  const source = sourceIdentity && typeof sourceIdentity === "object" ? sourceIdentity : {};
  return {
    kind: String(source.kind || "voice").trim() || "voice",
    label: compactText(source.label || source.speakerLabel || source.email || "Unknown speaker", 80),
    speakerLabel: compactText(source.speakerLabel || source.label || "", 80),
    trustLevel: String(source.trustLevel || "unknown").trim() || "unknown",
    matchedProfileId: String(source.matchedProfileId || source.profileId || "").trim(),
    confidence: Number(source.confidence || source.matchScore || 0) || 0
  };
}

function inferObservationKinds(text = "") {
  const normalized = String(text || "").trim();
  const lower = normalized.toLowerCase();
  const kinds = [];
  if (/[?]\s*$/.test(normalized) || /^(who|what|when|where|why|how|can you|could you|do you know|is there|are there)\b/i.test(normalized)) {
    kinds.push("question");
  }
  if (/\b(meeting|minutes|agenda|attendees|action items?|standup|sync|call|discussion)\b/i.test(normalized)) {
    kinds.push("meeting");
  }
  if (/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\b\d{1,2}(?::\d{2})?\s*(am|pm)\b|deadline|due|appointment|calendar|schedule)\b/i.test(normalized)) {
    kinds.push("date");
  }
  if (/\b(todo|to do|remind me|remember to|follow up|action item|need to|please|can you|could you|we should|someone should|add a task)\b/i.test(normalized)) {
    kinds.push("request");
  }
  if (/\b(i think|i believe|apparently|they said|claim|claims|according to|it is true that|fact is|must be|always|never)\b/i.test(normalized)) {
    kinds.push("claim");
  }
  if (/\b(my name is|this is|i'm|i am|speaking is|with me is)\b/i.test(lower)) {
    kinds.push("person");
  }
  return kinds.length ? [...new Set(kinds)] : ["ambient"];
}

function buildSuggestedActions(kinds = [], text = "", sourceIdentity = {}) {
  const actions = [];
  if (kinds.includes("question")) {
    actions.push({
      type: "answer_question",
      status: "draft",
      title: "Answer heard question",
      text: compactText(text, 260)
    });
  }
  if (kinds.includes("meeting")) {
    actions.push({
      type: "meeting_minutes",
      status: "draft",
      title: "Keep meeting minutes",
      text: compactText(text, 260)
    });
  }
  if (kinds.includes("date")) {
    actions.push({
      type: "calendar_candidate",
      status: "draft",
      title: "Review calendar candidate",
      text: compactText(text, 260)
    });
  }
  if (kinds.includes("request")) {
    actions.push({
      type: "todo_candidate",
      status: "draft",
      title: "Review todo candidate",
      text: compactText(text, 260)
    });
  }
  if (kinds.includes("claim")) {
    actions.push({
      type: "claim_record",
      status: "draft",
      title: "Record claim",
      text: compactText(text, 260),
      sourceLabel: sourceIdentity.label || "Unknown speaker"
    });
  }
  if (kinds.includes("person")) {
    actions.push({
      type: "person_candidate",
      status: "draft",
      title: "Review speaker identity",
      text: compactText(text, 260),
      sourceLabel: sourceIdentity.label || "Unknown speaker"
    });
  }
  return actions;
}

function uniqueCompact(values = [], maxLength = 160) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = compactText(value, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(text);
  }
  return out;
}

function splitSentences(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|[;\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildThreadSummary(texts = []) {
  const sentences = uniqueCompact(texts.flatMap(splitSentences), 220);
  if (!sentences.length) {
    return "";
  }
  return compactText(sentences.slice(-5).join(" "), 700);
}

function extractQuestions(text = "") {
  const sentences = splitSentences(text);
  return uniqueCompact(sentences.filter((sentence) =>
    /[?]\s*$/.test(sentence)
    || /^(who|what|when|where|why|how|can you|could you|do you know|is there|are there)\b/i.test(sentence)
  ), 260);
}

function isMeaningfulQuestion(question = "", context = "") {
  const normalized = String(question || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase().replace(/[^\w\s']/g, " ").trim();
  const words = lower.split(/\s+/g).filter(Boolean);
  const lowSignal = new Set(["what", "why", "when", "where", "who", "how", "huh", "yeah", "okay", "ok", "right", "really", "again"]);
  if (words.length <= 2 && words.every((word) => lowSignal.has(word))) {
    return false;
  }
  const contentWords = words.filter((word) =>
    word.length >= 4
    && !["what", "when", "where", "with", "that", "this", "there", "about", "could", "would", "should", "please"].includes(word)
  );
  const contextWords = String(context || "").toLowerCase().split(/\s+/g).filter((word) => word.length >= 4);
  return contentWords.length >= 1 || (words.length >= 4 && contextWords.length >= 3);
}

function extractTaskNotes(text = "") {
  return splitSentences(text)
    .filter((sentence) => /\b(todo|to do|remind me|remember to|follow up|action item|need to|please|can you|could you|we should|someone should|add a task)\b/i.test(sentence))
    .map((sentence) => compactText(sentence, 180));
}

function extractEventNotes(text = "") {
  return splitSentences(text)
    .filter((sentence) =>
      /\b(meeting|agenda|standup|sync|call|appointment|calendar|schedule|deadline|due|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(am|pm)\b)\b/i.test(sentence)
    )
    .map((sentence) => compactText(sentence, 180));
}

function extractMentionNotes(text = "", sourceIdentity = {}) {
  const values = [];
  const sourceLabel = compactText(sourceIdentity?.label || "", 80);
  if (sourceLabel && !/^unknown speaker$/i.test(sourceLabel)) {
    values.push(sourceLabel);
  }
  const mentionMatches = String(text || "").match(/@[a-z0-9_.-]+|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
  for (const mention of mentionMatches) {
    if (!/^(I|The|This|That|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Presence|Unknown)$/i.test(mention)) {
      values.push(mention);
    }
  }
  return uniqueCompact(values, 80).slice(0, 12);
}

function extractClaimNotes(text = "") {
  return splitSentences(text)
    .filter((sentence) => /\b(i think|i believe|apparently|they said|claim|claims|according to|fact is|must be|always|never)\b/i.test(sentence))
    .map((sentence) => compactText(sentence, 180));
}

function buildThreadNotes(summary = "", sourceIdentity = {}) {
  const questions = extractQuestions(summary).filter((question) => isMeaningfulQuestion(question, summary));
  return {
    mentions: extractMentionNotes(summary, sourceIdentity),
    events: uniqueCompact(extractEventNotes(summary), 180).slice(0, 8),
    tasks: uniqueCompact(extractTaskNotes(summary), 180).slice(0, 8),
    questions: questions.slice(0, 6),
    claims: uniqueCompact(extractClaimNotes(summary), 180).slice(0, 8)
  };
}

function chooseBestQuestion(notes = {}, summary = "") {
  const candidates = Array.isArray(notes.questions) ? notes.questions : [];
  return candidates.find((question) => isMeaningfulQuestion(question, summary)) || "";
}

function threadId(now = Date.now(), sourceIdentity = {}) {
  const sourceKey = String(sourceIdentity?.matchedProfileId || sourceIdentity?.label || "unknown").trim().toLowerCase() || "unknown";
  return `presence-thread-${now}-${Math.abs([...sourceKey].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)).toString(36)}`;
}

function observationId(now = Date.now(), text = "") {
  let hash = 0;
  for (const char of String(text || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return `presence-${now}-${Math.abs(hash).toString(36)}`;
}

function sameRecentObservation(left = {}, right = {}) {
  return String(left.text || "").trim().toLowerCase() === String(right.text || "").trim().toLowerCase()
    && Math.abs(Number(left.observedAt || 0) - Number(right.observedAt || 0)) < 30_000;
}

function sameThreadSource(left = {}, sourceIdentity = {}) {
  const leftSource = left.sourceIdentity && typeof left.sourceIdentity === "object" ? left.sourceIdentity : {};
  const leftKey = String(leftSource.matchedProfileId || leftSource.label || "").trim().toLowerCase();
  const rightKey = String(sourceIdentity.matchedProfileId || sourceIdentity.label || "").trim().toLowerCase();
  return leftKey && rightKey && leftKey === rightKey;
}

export function createPresenceDomain({ data = null, runtime = {}, getCapability = () => null, broadcast = () => {} } = {}) {
  async function readSettings() {
    return normalizeSettings(data ? await data.readJson(SETTINGS_KEY, DEFAULT_SETTINGS) : DEFAULT_SETTINGS);
  }

  async function writeSettings(update = {}) {
    const next = normalizeSettings({ ...(await readSettings()), ...(update && typeof update === "object" ? update : {}) });
    if (data) {
      await data.writeJson(SETTINGS_KEY, next);
    }
    return next;
  }

  async function listObservations({ limit = 80 } = {}) {
    const saved = data ? await data.readJson(OBSERVATIONS_KEY, []) : [];
    return (Array.isArray(saved) ? saved : [])
      .sort((left, right) => Number(right.observedAt || 0) - Number(left.observedAt || 0))
      .slice(0, Math.max(1, Number(limit || 80) || 80));
  }

  async function listThreads({ limit = 30 } = {}) {
    const saved = data ? await data.readJson(THREADS_KEY, []) : [];
    return (Array.isArray(saved) ? saved : [])
      .sort((left, right) => Number(right.lastObservedAt || 0) - Number(left.lastObservedAt || 0))
      .slice(0, Math.max(1, Number(limit || 30) || 30));
  }

  async function listPeople() {
    const saved = data ? await data.readJson(PEOPLE_KEY, []) : [];
    return Array.isArray(saved) ? saved : [];
  }

  async function rememberPerson(sourceIdentity = {}, observation = {}) {
    if (!data || String(sourceIdentity.trustLevel || "unknown") !== "unknown") {
      return null;
    }
    const people = await listPeople();
    const key = String(sourceIdentity.matchedProfileId || sourceIdentity.label || "unknown").trim().toLowerCase();
    const existingIndex = people.findIndex((entry) => String(entry.key || "").trim().toLowerCase() === key);
    const nextPerson = {
      key,
      label: sourceIdentity.label || "Unknown speaker",
      trustLevel: "unknown",
      firstHeardAt: Number(people[existingIndex]?.firstHeardAt || observation.observedAt || Date.now()),
      lastHeardAt: Number(observation.observedAt || Date.now()),
      sampleCount: Math.max(1, Number(people[existingIndex]?.sampleCount || 0) + 1),
      latestObservationId: observation.id
    };
    const nextPeople = existingIndex >= 0
      ? people.map((entry, index) => index === existingIndex ? { ...entry, ...nextPerson } : entry)
      : [nextPerson, ...people];
    await data.writeJson(PEOPLE_KEY, nextPeople.slice(0, 200));
    return nextPerson;
  }

  async function maybeCreateTodo(observation = {}, settings = {}) {
    if (settings.autoCreateTodos !== true || !observation.kinds.includes("request")) {
      return null;
    }
    const addTodo = getCapability("todo.addItem");
    if (typeof addTodo !== "function") {
      return null;
    }
    const todo = await addTodo({
      title: compactText(observation.text, 140),
      notes: `Presence heard this from ${observation.sourceIdentity?.label || "Unknown speaker"}.`,
      source: "presence",
      createdBy: "nova",
      reference: observation.id
    });
    return todo || null;
  }

  async function maybeQueueQuestion(observation = {}, settings = {}, thread = {}) {
    const question = compactText(observation?.thread?.question || chooseBestQuestion(thread.notes || {}, thread.summary || observation.text), 320);
    if (settings.autoQueueQuestions !== true || !question || !isMeaningfulQuestion(question, thread.summary || observation.text)) {
      return null;
    }
    if (thread.queuedQuestion && String(thread.queuedQuestion.question || "").trim().toLowerCase() === question.toLowerCase()) {
      return null;
    }
    const createQueuedTask = typeof runtime.createQueuedTask === "function" ? runtime.createQueuedTask : null;
    if (!createQueuedTask) {
      return null;
    }
    return await createQueuedTask({
      message: [
        "Presence distilled a coherent question from passive voice context.",
        `Question: ${question}`,
        thread.summary ? `Context: ${thread.summary}` : "",
        Array.isArray(thread.notes?.mentions) && thread.notes.mentions.length ? `Key mentions: ${thread.notes.mentions.join(", ")}` : "",
        `Speaker: ${observation.sourceIdentity?.label || "Unknown speaker"} (${observation.sourceIdentity?.trustLevel || "unknown"})`,
        "Find the answer if possible. Keep the answer concise and suitable for verbal presentation."
      ].filter(Boolean).join("\n"),
      sessionId: "presence",
      requestedBrainId: "worker",
      internetEnabled: true,
      notes: "Presence queued a distilled heard question for answer synthesis.",
      taskMeta: {
        internalJobType: "presence_question",
        sourceIdentity: observation.sourceIdentity,
        presenceObservationId: observation.id,
        presenceThreadId: thread.id,
        distilledQuestion: question
      }
    });
  }

  async function mergeObservationIntoThread(observation = {}, settings = {}) {
    const existing = data ? await data.readJson(THREADS_KEY, []) : [];
    const threads = Array.isArray(existing) ? existing : [];
    const windowMs = Number(settings.threadWindowMs || DEFAULT_SETTINGS.threadWindowMs);
    const activeIndex = threads.findIndex((entry) =>
      sameThreadSource(entry, observation.sourceIdentity || {})
      && Math.abs(Number(observation.observedAt || 0) - Number(entry.lastObservedAt || 0)) <= windowMs
    );
    const previous = activeIndex >= 0 ? threads[activeIndex] : null;
    const previousObservations = Array.isArray(previous?.observations) ? previous.observations : [];
    const observations = [
      ...previousObservations,
      {
        id: observation.id,
        text: observation.text,
        kinds: observation.kinds,
        observedAt: observation.observedAt
      }
    ].slice(-Number(settings.maxThreadObservations || DEFAULT_SETTINGS.maxThreadObservations));
    const summary = buildThreadSummary(observations.map((entry) => entry.text));
    const notes = buildThreadNotes(summary, observation.sourceIdentity || {});
    const question = chooseBestQuestion(notes, summary);
    const nextThread = {
      id: previous?.id || threadId(observation.observedAt || Date.now(), observation.sourceIdentity || {}),
      source: observation.source,
      mode: observation.mode,
      sourceIdentity: observation.sourceIdentity,
      observations,
      summary,
      notes,
      question,
      firstObservedAt: Number(previous?.firstObservedAt || observation.observedAt || Date.now()),
      lastObservedAt: Number(observation.observedAt || Date.now()),
      updatedAt: Date.now(),
      queuedQuestion: previous?.queuedQuestion || null
    };
    const nextThreads = activeIndex >= 0
      ? threads.map((entry, index) => index === activeIndex ? nextThread : entry)
      : [nextThread, ...threads];
    if (data) {
      await data.writeJson(THREADS_KEY, nextThreads.slice(0, settings.retentionLimit));
    }
    return { thread: nextThread, threads: nextThreads };
  }

  async function observe(input = {}) {
    const settings = await readSettings();
    const text = compactText(input.text || input.transcript || "", 1000);
    const isFinal = input.isFinal !== false;
    if (!settings.enabled || !text || text.length < settings.minimumTextLength || (!isFinal && !settings.captureInterim)) {
      return { accepted: false, reason: "filtered", settings };
    }
    const now = Number(input.observedAt || input.at || Date.now()) || Date.now();
    const sourceIdentity = normalizeSourceIdentity(input.sourceIdentity || {});
    const kinds = inferObservationKinds(text);
    const observation = {
      id: observationId(now, text),
      text,
      kinds,
      source: String(input.source || "voice").trim() || "voice",
      mode: String(input.mode || "passive").trim() || "passive",
      isFinal,
      media: {
        audioAvailable: input.audioAvailable === true,
        videoAvailable: input.videoAvailable === true
      },
      sourceIdentity,
      suggestedActions: buildSuggestedActions(kinds, text, sourceIdentity),
      observedAt: now,
      createdAt: Date.now()
    };
    const existing = data ? await data.readJson(OBSERVATIONS_KEY, []) : [];
    const observations = Array.isArray(existing) ? existing : [];
    if (observations.some((entry) => sameRecentObservation(entry, observation))) {
      return { accepted: false, reason: "duplicate", settings };
    }
    const { thread } = await mergeObservationIntoThread(observation, settings);
    observation.thread = {
      id: thread.id,
      summary: thread.summary,
      notes: thread.notes,
      question: thread.question,
      observationCount: thread.observations.length,
      firstObservedAt: thread.firstObservedAt,
      lastObservedAt: thread.lastObservedAt
    };
    observation.suggestedActions = buildSuggestedActions(
      [...new Set([...kinds, ...(thread.question ? ["question"] : [])])],
      thread.summary || text,
      sourceIdentity
    );
    const todo = await maybeCreateTodo(observation, settings).catch((error) => ({ error: String(error?.message || error) }));
    const queuedTask = await maybeQueueQuestion(observation, settings, thread).catch((error) => ({ error: String(error?.message || error) }));
    if (queuedTask?.id && data) {
      const threads = await listThreads({ limit: settings.retentionLimit });
      const nextThreads = threads.map((entry) => entry.id === thread.id
        ? {
            ...entry,
            queuedQuestion: {
              question: thread.question,
              taskId: queuedTask.id,
              queuedAt: Date.now()
            }
          }
        : entry);
      await data.writeJson(THREADS_KEY, nextThreads);
    }
    const person = await rememberPerson(sourceIdentity, observation).catch(() => null);
    const savedObservation = {
      ...observation,
      effects: {
        todoId: String(todo?.id || "").trim(),
        queuedTaskId: String(queuedTask?.id || "").trim(),
        todoError: String(todo?.error || "").trim(),
        queuedTaskError: String(queuedTask?.error || "").trim(),
        personKey: String(person?.key || "").trim()
      }
    };
    if (data) {
      await data.writeJson(OBSERVATIONS_KEY, [savedObservation, ...observations].slice(0, settings.retentionLimit));
    }
    broadcast({ type: "presence.observed", observation: savedObservation, at: Date.now() });
    return { accepted: true, observation: savedObservation, thread: observation.thread, settings };
  }

  return {
    observe,
    readSettings,
    writeSettings,
    listObservations,
    listThreads,
    listPeople
  };
}
