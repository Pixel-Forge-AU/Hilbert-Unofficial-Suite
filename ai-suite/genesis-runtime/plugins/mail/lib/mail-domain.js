import { ImapFlow } from "imapflow";

export function createMailDomain(context = {}) {
  const {
    observerSecrets,
    assessEmailSourceIdentity,
    inspectMailCommand,
    buildMailAgentPasswordHandle,
    getObserverConfig,
    process,
    fs,
    writeVolumeText,
    MAIL_WATCH_RULES_PATH,
    MAIL_QUARANTINE_LOG_PATH,
    DOCUMENT_RULES_PATH,
    PROMPT_MAIL_RULES_PATH,
    parseEveryToMs,
    compactTaskText,
    formatDateTimeForUser,
    formatTaskCodename,
    hashRef,
    listAllTasks,
    createWaitingTask,
    createQueuedTask,
    noteInteractiveActivity,
    normalizeSourceIdentityRecord,
    describeSourceTrust,
    findRecentDuplicateQueuedTask,
    buildFailureInvestigationTaskMessage,
    closeTaskRecord,
    normalizeTrustLevel = (value, fallback = "unknown") => String(value || fallback).trim().toLowerCase(),
    getAppTrustConfig = () => ({ emailCommandMinLevel: "trusted" }),
    getDocumentRulesState,
    setDocumentRulesState,
    getMailWatchRulesState,
    setMailWatchRulesState,
    getMailState,
    setMailPollInFlight,
    getMailPollInFlight,
    simpleParser,
    pluginManager,
    broadcastObserverEvent,
    broadcast,
    runMailWatchRulesNow,
    nodemailer,
    escapeRegex,
    ImapFlowClass = ImapFlow
  } = context;

  function getTrustLevelRank(level) {
    const normalized = normalizeTrustLevel(level);
    if (normalized === "trusted") return 2;
    if (normalized === "known") return 1;
    return 0;
  }

  function getSourceTrustPolicy(level = "unknown") {
    const trustLevel = normalizeTrustLevel(level, "unknown");
    if (trustLevel === "trusted") {
      return { trustLevel, canExecuteCommands: true, canRespond: true, canShareConfidential: true, requiresUserDecision: false, replyMode: "full" };
    }
    if (trustLevel === "known") {
      return { trustLevel, canExecuteCommands: false, canRespond: true, canShareConfidential: false, requiresUserDecision: false, replyMode: "safe_only" };
    }
    return { trustLevel, canExecuteCommands: false, canRespond: false, canShareConfidential: false, requiresUserDecision: true, replyMode: "none" };
  }

  let observerConfig = typeof getObserverConfig === "function"
    ? getObserverConfig()
    : (context?.observerConfig || {});
  const mailState = typeof getMailState === "function"
    ? getMailState()
    : (context?.mailState || {});
  let mailWatchRulesState = typeof getMailWatchRulesState === "function"
    ? getMailWatchRulesState()
    : (context?.mailWatchRulesState || {});
  let documentRulesState = typeof getDocumentRulesState === "function"
    ? getDocumentRulesState()
    : (context?.documentRulesState || {});
  let mailPollInFlight = typeof getMailPollInFlight === "function"
    ? getMailPollInFlight() === true
    : (context?.mailPollInFlight === true);

  function refreshObserverConfig() {
    if (typeof getObserverConfig === "function") {
      observerConfig = getObserverConfig() || {};
    }
    return observerConfig || {};
  }

  function refreshMailWatchRulesState() {
    if (typeof getMailWatchRulesState === "function") {
      mailWatchRulesState = getMailWatchRulesState() || {};
    }
    return mailWatchRulesState || {};
  }

  function commitMailWatchRulesState() {
    if (typeof setMailWatchRulesState === "function") {
      setMailWatchRulesState(mailWatchRulesState);
    }
  }

  function refreshDocumentRulesState() {
    if (typeof getDocumentRulesState === "function") {
      documentRulesState = getDocumentRulesState() || {};
    }
    return documentRulesState || {};
  }

  function commitDocumentRulesState() {
    if (typeof setDocumentRulesState === "function") {
      setDocumentRulesState(documentRulesState);
    }
  }

  function commitMailPollInFlight() {
    if (typeof setMailPollInFlight === "function") {
      setMailPollInFlight(mailPollInFlight === true);
    }
  }

async function migrateLegacyMailPassword(agentId, configuredPassword = "", configuredHandle = "") {
  const normalizedHandle = observerSecrets.normalizeSecretHandle(
    configuredHandle || (agentId ? buildMailAgentPasswordHandle(agentId) : "")
  );
  const directPassword = String(configuredPassword || "").trim();
  if (directPassword && normalizedHandle) {
    await observerSecrets.setSecret(normalizedHandle, directPassword);
  }
  return normalizedHandle;
}

async function resolveMailPassword(agentId, configuredHandle = "", configuredPassword = "") {
  const normalizedHandle = observerSecrets.normalizeSecretHandle(
    configuredHandle || (agentId ? buildMailAgentPasswordHandle(agentId) : "")
  );
  if (normalizedHandle) {
    const storedPassword = await observerSecrets.getSecret(normalizedHandle);
    if (String(storedPassword || "").trim()) {
      return String(storedPassword || "").trim();
    }
  }
  const directPassword = String(configuredPassword || "").trim();
  if (directPassword) {
    return directPassword;
  }
  const normalizedId = String(agentId || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
  if (!normalizedId) {
    return "";
  }
  return String(process.env[`OBSERVER_MAIL_${normalizedId}_PASSWORD`] || "").trim();
}

async function hasMailPassword(agent = {}) {
  const password = await resolveMailPassword(agent?.id, agent?.passwordHandle, agent?.password);
  return Boolean(String(password || "").trim());
}

async function resolveMailAuth(agent = {}) {
  const password = await resolveMailPassword(agent?.id, agent?.passwordHandle, agent?.password);
  return {
    user: String(agent?.user || agent?.email || "").trim(),
    pass: String(password || "").trim()
  };
}

function normalizeMailWatchRuleAction(value = "", fallback = "") {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  return ["trash", "archive", "forward", "keep"].includes(normalized) ? normalized : "";
}

function normalizeMailWatchRuleMatch(match = {}) {
  const normalized = match && typeof match === "object" ? match : {};
  const fromAddress = String(normalized.fromAddress || "").trim().toLowerCase();
  const fromDomain = String(normalized.fromDomain || "").trim().toLowerCase();
  const category = String(normalized.category || "").trim().toLowerCase();
  const automated = normalized.automated === true ? true : null;
  const subjectKeywords = Array.isArray(normalized.subjectKeywords)
    ? normalized.subjectKeywords.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const bodyKeywords = Array.isArray(normalized.bodyKeywords)
    ? normalized.bodyKeywords.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    fromAddress,
    fromDomain,
    category,
    automated,
    subjectKeywords,
    bodyKeywords
  };
}

function hasMailWatchRuleMatch(match = {}) {
  const normalized = normalizeMailWatchRuleMatch(match);
  return Boolean(
    normalized.fromAddress
    || normalized.fromDomain
    || normalized.category
    || normalized.automated === true
    || normalized.subjectKeywords.length
    || normalized.bodyKeywords.length
  );
}

function describeMailWatchRuleMatch(match = {}) {
  const normalized = normalizeMailWatchRuleMatch(match);
  const parts = [];
  if (normalized.fromAddress) {
    parts.push(`emails from ${normalized.fromAddress}`);
  } else if (normalized.fromDomain) {
    parts.push(`emails from ${normalized.fromDomain}`);
  }
  if (normalized.subjectKeywords.length) {
    parts.push(`subject mentions "${normalized.subjectKeywords.join('", "')}"`);
  }
  if (normalized.bodyKeywords.length) {
    parts.push(`body contains "${normalized.bodyKeywords.join('", "')}"`);
  }
  if (normalized.category) {
    parts.push(`classified as ${normalized.category}`);
  }
  if (normalized.automated === true) {
    parts.push("automated senders only");
  }
  return parts.join(", ");
}

function isExplicitMailWatchActionRule(rule = {}) {
  const ruleKind = String(rule?.ruleKind || "").trim().toLowerCase();
  return ruleKind === "message_action"
    && Boolean(normalizeMailWatchRuleAction(rule?.actionOnMatch))
    && hasMailWatchRuleMatch(rule?.match);
}

function buildMailWatchActionRuleFromMessage(message = {}, action = "trash") {
  const normalizedAction = normalizeMailWatchRuleAction(action, "trash") || "trash";
  const fromAddress = String(message?.fromAddress || "").trim().toLowerCase();
  const fromDomain = extractEmailDomain(fromAddress);
  const category = String(message?.triage?.category || "").trim().toLowerCase();
  const automated = message?.triage?.automated === true;
  const match = normalizeMailWatchRuleMatch({
    fromAddress,
    fromDomain: fromAddress ? "" : fromDomain,
    category,
    automated
  });
  if (!hasMailWatchRuleMatch(match)) {
    return null;
  }
  const matchDescription = describeMailWatchRuleMatch(match) || "similar email";
  const actionVerb = normalizedAction === "trash"
    ? "trash"
    : normalizedAction === "archive"
      ? "archive"
      : normalizedAction === "forward"
        ? "forward"
        : "keep";
  const messageId = String(message?.id || "").trim();
  return {
    id: `mail-rule-${hashRef([normalizedAction, match.fromAddress || match.fromDomain || "unknown", match.category || "any", match.automated === true ? "automated" : "mixed"].join("|"))}`,
    ruleKind: "message_action",
    actionOnMatch: normalizedAction,
    match,
    instruction: `Automatically ${actionVerb} ${matchDescription}.`,
    notifyEmail: String(resolveImplicitUserEmail() || "").trim(),
    autoForwardGood: false,
    trashDefiniteBad: false,
    promptUnsure: false,
    sendSummaries: false,
    every: "10m",
    everyMs: parseEveryToMs("10m"),
    promptEvery: "4h",
    promptEveryMs: parseEveryToMs("4h"),
    lastProcessedReceivedAt: Number(message?.receivedAt || 0),
    forwardedMessageIds: normalizedAction === "forward" && messageId ? [messageId] : [],
    resolvedUnsureMessageIds: messageId ? [messageId] : [],
    pendingUnsureMessageIds: []
  };
}

function buildMailWatchActionRuleFromMatch(match = {}, action = "trash") {
  const normalizedAction = normalizeMailWatchRuleAction(action, "trash") || "trash";
  const normalizedMatch = normalizeMailWatchRuleMatch(match);
  if (!hasMailWatchRuleMatch(normalizedMatch)) {
    return null;
  }
  const matchDescription = describeMailWatchRuleMatch(normalizedMatch) || "matching email";
  const actionVerb = normalizedAction === "trash" ? "trash"
    : normalizedAction === "archive" ? "archive"
    : normalizedAction === "forward" ? "forward"
    : "keep";
  const idParts = [
    normalizedAction,
    normalizedMatch.fromAddress || normalizedMatch.fromDomain || "any-sender",
    normalizedMatch.category || "any-cat",
    normalizedMatch.subjectKeywords.length ? normalizedMatch.subjectKeywords.join(",") : "no-keywords",
    normalizedMatch.automated === true ? "automated" : "mixed"
  ];
  return {
    id: `mail-rule-${hashRef(idParts.join("|"))}`,
    ruleKind: "message_action",
    actionOnMatch: normalizedAction,
    match: normalizedMatch,
    instruction: `Automatically ${actionVerb} ${matchDescription}.`,
    notifyEmail: String(resolveImplicitUserEmail() || "").trim(),
    autoForwardGood: false,
    trashDefiniteBad: false,
    promptUnsure: false,
    sendSummaries: false,
    every: "10m",
    everyMs: parseEveryToMs("10m"),
    promptEvery: "4h",
    promptEveryMs: parseEveryToMs("4h"),
    lastProcessedReceivedAt: 0,
    forwardedMessageIds: [],
    resolvedUnsureMessageIds: [],
    pendingUnsureMessageIds: []
  };
}

async function inferMailWatchRuleMatchFromDescription(answer = "", message = {}, action = "trash") {
  const lower = String(answer || "").trim().toLowerCase();
  // Only use LLM when the answer describes criteria beyond just "add a rule"
  const hasFilterDescription = /\b(filter|block|catch|rule for|emails? (about|from|selling|offering|promoting|with|that|mentioning)|subject.*contain|contain.*subject)\b/.test(lower)
    || /\b(all emails? (about|selling|offering|with|that|mentioning))\b/.test(lower);
  if (!hasFilterDescription) {
    return null;
  }
  const routing = getRoutingConfig();
  const plannerBrain = await choosePlannerRepairBrain(
    [String(routing.remoteTriageBrainId || "").trim(), "helper"].filter(Boolean),
    { preferRemote: true }
  ) || await getBrain("bitnet");
  if (!plannerBrain) {
    return null;
  }
  const messageSummary = summarizeMailForUser(message);
  const prompt = [
    `You are configuring an email filter rule. The user wants to ${action} emails matching a description.`,
    "IMPORTANT: The user may work in the same field the emails discuss. Distinguish emails that are OFFERING/SELLING a service from emails that are REQUESTING or DISCUSSING it.",
    "For example, 'filter emails selling web design' should NOT match a client asking to hire a web designer.",
    "Use bodyKeywords to capture the offer/sales intent (words like 'affordable', 'we offer', 'our services', 'upgrade your website', 'cheap', 'best price').",
    "Reply with JSON only.",
    'Schema: {"subjectKeywords":["..."],"bodyKeywords":["..."],"category":"","fromDomain":""}',
    "- subjectKeywords: 0-3 short phrases that should appear in the subject. Lowercase. Empty array if not helpful.",
    "- bodyKeywords: 0-4 short phrases that distinguish the INTENT described (e.g. offer/sales language vs request language). Lowercase. Empty array if not helpful.",
    "- category: one of: personal, promotion, notification, other, spam — or empty string.",
    "- fromDomain: only if the user specifically names a sender domain, otherwise empty string.",
    "If the description is too vague to extract useful keywords, return all empty/empty-array values.",
    "",
    `Email that prompted the question: ${messageSummary}`,
    `User instruction: ${String(answer || "").trim()}`
  ].join("\n");
  const result = await runOllamaJsonGenerate(plannerBrain.model, prompt, {
    timeoutMs: 30000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: plannerBrain.ollamaBaseUrl,
    options: isCpuQueueLane(plannerBrain) ? { num_gpu: 0 } : undefined,
    brainId: plannerBrain.id,
    leaseOwnerId: `mail-rule-infer:${Date.now()}`,
    leaseWaitMs: 2500
  });
  if (!result.ok) {
    return null;
  }
  try {
    const parsed = extractJsonObject(result.text);
    const subjectKeywords = Array.isArray(parsed?.subjectKeywords)
      ? parsed.subjectKeywords.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const bodyKeywords = Array.isArray(parsed?.bodyKeywords)
      ? parsed.bodyKeywords.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const category = String(parsed?.category || "").trim().toLowerCase();
    const fromDomain = String(parsed?.fromDomain || "").trim().toLowerCase();
    if (!subjectKeywords.length && !bodyKeywords.length && !category && !fromDomain) {
      return null;
    }
    const match = normalizeMailWatchRuleMatch({ subjectKeywords, bodyKeywords, category, fromDomain });
    return hasMailWatchRuleMatch(match) ? match : null;
  } catch {
    return null;
  }
}

function parseMailWatchRuleAnswerIntent(answer = "") {
  const lower = String(answer || "").trim().toLowerCase();
  if (!lower) {
    return {
      wantsRule: false,
      action: ""
    };
  }
  const explicitRulePhrase = /\b(add|create|make|save|remember)\b[\s\S]*\b(email|mail)\s+rule\b/.test(lower)
    || /\b(email|mail)\s+rule\b/.test(lower);
  const standingActionPhrase = /\b(always|from now on|going forward|future|every time)\b/.test(lower)
    && /\b(trash|archive|forward|keep)\b/.test(lower);
  const filterDescriptionPhrase = /\b(filter|block|catch)\b[\s\S]*\b(emails?|mail)\b/.test(lower)
    || /\b(rule (for|to|that))\b/.test(lower);
  const wantsRule = explicitRulePhrase || standingActionPhrase || filterDescriptionPhrase;
  const action = normalizeMailWatchRuleAction(
    parseMailWatchAnswerAction(answer)
    || (explicitRulePhrase || filterDescriptionPhrase ? "trash" : "")
  );
  return {
    wantsRule,
    action
  };
}

async function loadMailWatchRulesState() {
  try {
    const raw = await fs.readFile(MAIL_WATCH_RULES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    mailWatchRulesState = {
      sendSummariesEnabled: parsed?.sendSummariesEnabled !== false,
      rules: Array.isArray(parsed?.rules)
        ? parsed.rules.map((rule) => ({
            id: String(rule?.id || "").trim(),
            createdAt: Number(rule?.createdAt || 0),
            updatedAt: Number(rule?.updatedAt || 0),
            enabled: rule?.enabled !== false,
            ruleKind: String(rule?.ruleKind || (rule?.actionOnMatch ? "message_action" : "watch")).trim().toLowerCase() === "message_action" ? "message_action" : "watch",
            actionOnMatch: normalizeMailWatchRuleAction(rule?.actionOnMatch),
            match: normalizeMailWatchRuleMatch(rule?.match),
            every: String(rule?.every || "10m").trim() || "10m",
            everyMs: Number(rule?.everyMs || parseEveryToMs(rule?.every || "10m") || 10 * 60 * 1000),
            instruction: String(rule?.instruction || "").trim(),
            notifyEmail: String(rule?.notifyEmail || "").trim(),
            autoForwardGood: rule?.autoForwardGood !== false,
            trashDefiniteBad: rule?.trashDefiniteBad !== false,
            promptUnsure: rule?.promptUnsure !== false,
            sendSummaries: rule?.sendSummaries !== false,
            promptEvery: String(rule?.promptEvery || "4h").trim() || "4h",
            promptEveryMs: Number(rule?.promptEveryMs || parseEveryToMs(rule?.promptEvery || "4h") || 4 * 60 * 60 * 1000),
            lastCheckedAt: Number(rule?.lastCheckedAt || 0),
            lastProcessedReceivedAt: Number(rule?.lastProcessedReceivedAt || 0),
            lastPromptedAt: Number(rule?.lastPromptedAt || 0),
            forwardedMessageIds: Array.isArray(rule?.forwardedMessageIds)
              ? rule.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-2000)
              : [],
            resolvedUnsureMessageIds: Array.isArray(rule?.resolvedUnsureMessageIds)
              ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-500)
              : [],
            pendingUnsureMessageIds: Array.isArray(rule?.pendingUnsureMessageIds)
              ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
              : []
          })).filter((rule) => rule.id)
        : []
    };
  } catch {
    mailWatchRulesState = createInitialMailWatchRulesState();
  }
  commitMailWatchRulesState();
  await syncMailRulesDocumentFromState();
}

async function saveMailWatchRulesState() {
  refreshMailWatchRulesState();
  mailWatchRulesState = {
    sendSummariesEnabled: mailWatchRulesState?.sendSummariesEnabled !== false,
    rules: (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
      .map((rule) => ({
        id: String(rule?.id || "").trim(),
        createdAt: Number(rule?.createdAt || 0),
        updatedAt: Number(rule?.updatedAt || 0),
        enabled: rule?.enabled !== false,
        ruleKind: String(rule?.ruleKind || (rule?.actionOnMatch ? "message_action" : "watch")).trim().toLowerCase() === "message_action" ? "message_action" : "watch",
        actionOnMatch: normalizeMailWatchRuleAction(rule?.actionOnMatch),
        match: normalizeMailWatchRuleMatch(rule?.match),
        every: String(rule?.every || "10m").trim() || "10m",
        everyMs: Number(rule?.everyMs || parseEveryToMs(rule?.every || "10m") || 10 * 60 * 1000),
        instruction: String(rule?.instruction || "").trim(),
        notifyEmail: String(rule?.notifyEmail || "").trim(),
        autoForwardGood: rule?.autoForwardGood !== false,
        trashDefiniteBad: rule?.trashDefiniteBad !== false,
        promptUnsure: rule?.promptUnsure !== false,
        sendSummaries: rule?.sendSummaries !== false,
        promptEvery: String(rule?.promptEvery || "4h").trim() || "4h",
        promptEveryMs: Number(rule?.promptEveryMs || parseEveryToMs(rule?.promptEvery || "4h") || 4 * 60 * 60 * 1000),
        lastCheckedAt: Number(rule?.lastCheckedAt || 0),
        lastProcessedReceivedAt: Number(rule?.lastProcessedReceivedAt || 0),
        lastPromptedAt: Number(rule?.lastPromptedAt || 0),
        forwardedMessageIds: Array.isArray(rule?.forwardedMessageIds)
          ? rule.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-2000)
          : [],
        resolvedUnsureMessageIds: Array.isArray(rule?.resolvedUnsureMessageIds)
          ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-500)
          : [],
        pendingUnsureMessageIds: Array.isArray(rule?.pendingUnsureMessageIds)
          ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
          : []
      }))
      .filter((rule) => rule.id && rule.instruction)
  };
  commitMailWatchRulesState();
  await writeVolumeText(MAIL_WATCH_RULES_PATH, `${JSON.stringify(mailWatchRulesState, null, 2)}\n`);
  await syncMailRulesDocumentFromState();
}

function renderMailRulesDocument() {
  const rules = (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .slice()
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  const enabledRules = rules.filter((rule) => rule.enabled !== false);
  const disabledRules = rules.filter((rule) => rule.enabled === false);
  const lines = [
    "# MAIL-RULES.md",
    "",
    "Simple mail rules that Nova applies whenever mail is grabbed.",
    "This document is synced from the active mail-rule state.",
    "",
    `- Send unsure mail summaries: ${mailWatchRulesState?.sendSummariesEnabled !== false ? "yes" : "no"}`,
    "",
    "## Rules",
    ""
  ];
  if (!enabledRules.length) {
    lines.push("- No mail rules yet.");
  } else {
    for (const rule of enabledRules) {
      const summary = String(rule.instruction || "").trim()
        || (isExplicitMailWatchActionRule(rule)
          ? `Automatically ${normalizeMailWatchRuleAction(rule.actionOnMatch) || "handle"} ${describeMailWatchRuleMatch(rule.match) || "matching mail"}.`
          : "Watch copied mail.");
      lines.push(`- ${rule.id}: ${summary}`);
    }
  }
  if (disabledRules.length) {
    lines.push("");
    lines.push("## Disabled Rules");
    lines.push("");
    for (const rule of disabledRules) {
      const summary = String(rule.instruction || "").trim() || "Disabled mail rule.";
      lines.push(`- ${rule.id}: ${summary}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Rules run when mail is grabbed or polled.");
  lines.push("- Tell Nova a standing mailbox instruction in chat to create or update a rule.");
  return `${lines.join("\n").replace(/\s+$/, "")}\n`;
}

async function syncMailRulesDocumentFromState() {
  await writeVolumeText(PROMPT_MAIL_RULES_PATH, renderMailRulesDocument());
}

async function loadDocumentRulesState() {
  refreshDocumentRulesState();
  try {
    const raw = await fs.readFile(DOCUMENT_RULES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    documentRulesState = {
      watchTerms: Array.isArray(parsed?.watchTerms)
        ? parsed.watchTerms.map((value) => String(value || "").trim()).filter(Boolean)
        : documentRulesState.watchTerms,
      importantPeople: Array.isArray(parsed?.importantPeople)
        ? parsed.importantPeople.map((value) => String(value || "").trim()).filter(Boolean)
        : documentRulesState.importantPeople,
      preferredPathTerms: Array.isArray(parsed?.preferredPathTerms)
        ? parsed.preferredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.preferredPathTerms,
      ignoredPathTerms: Array.isArray(parsed?.ignoredPathTerms)
        ? parsed.ignoredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.ignoredPathTerms,
      ignoredFileNamePatterns: Array.isArray(parsed?.ignoredFileNamePatterns)
        ? parsed.ignoredFileNamePatterns.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
        : documentRulesState.ignoredFileNamePatterns
    };
  } catch {
    // keep defaults
  }
  commitDocumentRulesState();
}

async function saveDocumentRulesState() {
  refreshDocumentRulesState();
  const seededPeople = getMailAgents()
    .flatMap((agent) => [agent.label, agent.email, ...(Array.isArray(agent.aliases) ? agent.aliases : [])])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  documentRulesState = {
    watchTerms: Array.isArray(documentRulesState.watchTerms)
      ? [...new Set(documentRulesState.watchTerms.map((value) => String(value || "").trim()).filter(Boolean))]
      : [],
    importantPeople: Array.isArray(documentRulesState.importantPeople)
      ? [...new Set([...documentRulesState.importantPeople.map((value) => String(value || "").trim()).filter(Boolean), ...seededPeople])]
      : [...new Set(seededPeople)],
    preferredPathTerms: Array.isArray(documentRulesState.preferredPathTerms)
      ? [...new Set(documentRulesState.preferredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : [],
    ignoredPathTerms: Array.isArray(documentRulesState.ignoredPathTerms)
      ? [...new Set(documentRulesState.ignoredPathTerms.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : [],
    ignoredFileNamePatterns: Array.isArray(documentRulesState.ignoredFileNamePatterns)
      ? [...new Set(documentRulesState.ignoredFileNamePatterns.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))]
      : []
  };
  commitDocumentRulesState();
  await writeVolumeText(DOCUMENT_RULES_PATH, `${JSON.stringify(documentRulesState, null, 2)}\n`);
}

function getMailAgents() {
  refreshObserverConfig();
  return Object.values(observerConfig?.mail?.agents || {}).map((agent) => ({
    ...agent,
    id: String(agent.id || ""),
    label: String(agent.label || agent.id || "Agent"),
    aliases: Array.isArray(agent.aliases) ? agent.aliases.map((value) => String(value)).filter(Boolean) : [],
    email: String(agent.email || ""),
    user: String(agent.user || agent.email || ""),
    passwordHandle: observerSecrets.normalizeSecretHandle(agent.passwordHandle || "")
  }));
}

function getMailAgent(agentId = "") {
  refreshObserverConfig();
  const id = String(agentId || observerConfig?.mail?.activeAgentId || "").trim();
  if (!id) {
    return null;
  }
  return getMailAgents().find((agent) => agent.id === id) || null;
}

function getActiveMailAgent() {
  refreshObserverConfig();
  return getMailAgent(observerConfig?.mail?.activeAgentId);
}

async function hasImapCredentials(agent) {
  refreshObserverConfig();
  return Boolean(
    observerConfig?.mail?.enabled
    && observerConfig?.mail?.imap?.host
    && agent?.email
    && agent?.user
    && await hasMailPassword(agent)
  );
}

async function hasMailCredentials(agent) {
  return Boolean(
    await hasImapCredentials(agent)
    && observerConfig?.mail?.smtp?.host
  );
}

async function buildMailStatus(agent = getActiveMailAgent()) {
  refreshObserverConfig();
  refreshMailWatchRulesState();
  const recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
    .filter((entry) => entry.agentId === agent?.id)
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  const categoryCounts = {};
  let likelySpamCount = 0;
  let trustedSourceCount = 0;
  let knownSourceCount = 0;
  let commandReadyCount = 0;
  let commandReviewCount = 0;
  for (const message of recentMessages) {
    const category = String(message?.triage?.category || "other");
    categoryCounts[category] = Number(categoryCounts[category] || 0) + 1;
    if (message?.triage?.likelySpam) {
      likelySpamCount += 1;
    }
    const trustLevel = normalizeTrustLevel(message?.sourceIdentity?.trustLevel, "unknown");
    if (trustLevel === "trusted") {
      trustedSourceCount += 1;
    } else if (trustLevel === "known") {
      knownSourceCount += 1;
    }
    if (message?.command?.action === "auto_queue") {
      commandReadyCount += 1;
    } else if (["user_decision_required", "safe_reply_only"].includes(String(message?.command?.action || ""))) {
      commandReviewCount += 1;
    }
  }
  return {
    enabled: observerConfig?.mail?.enabled === true,
    activeAgentId: agent?.id || "",
    activeAgentLabel: agent?.label || "",
    activeAgentEmail: agent?.email || "",
    configured: Boolean(agent),
    ready: await hasImapCredentials(agent),
    sendReady: await hasMailCredentials(agent),
    hasPassword: agent ? await hasMailPassword(agent) : false,
    passwordHandle: String(agent?.passwordHandle || "").trim(),
    lastCheckAt: mailState.lastCheckAt || 0,
    lastError: mailState.lastError || "",
    recentMessageCount: recentMessages.length,
    likelySpamCount,
    trustedSourceCount,
    knownSourceCount,
    commandReadyCount,
    commandReviewCount,
    sendSummariesEnabled: mailWatchRulesState?.sendSummariesEnabled !== false,
    emailCommandMinLevel: getAppTrustConfig().emailCommandMinLevel,
    quarantinedCount: Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages.filter((entry) => entry.agentId === agent?.id).length : 0,
    categoryCounts
  };
}

async function withImapClient(agent, handler) {
  const auth = await resolveMailAuth(agent);
  const client = new ImapFlowClass({
    host: observerConfig.mail.imap.host,
    port: observerConfig.mail.imap.port,
    secure: observerConfig.mail.imap.secure !== false,
    auth,
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 60000
  });
  const handleClientError = (error) => {
    const message = String(error?.message || error || "IMAP connection error").trim();
    mailState.lastCheckAt = Date.now();
    mailState.lastError = message;
    if (typeof broadcast === "function") {
      broadcast(`[observer] mail IMAP connection error: ${message}`);
    }
  };
  if (typeof client.on === "function") {
    client.on("error", handleClientError);
  }
  try {
    await client.connect();
    return await handler(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout failures
    }
    if (typeof client.off === "function") {
      client.off("error", handleClientError);
    } else if (typeof client.removeListener === "function") {
      client.removeListener("error", handleClientError);
    }
  }
}

function sanitizeMailText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedReplyText(value = "") {
  const raw = sanitizeMailText(value);
  if (!raw) {
    return "";
  }
  const lines = raw.split("\n");
  const kept = [];
  const hasMeaningfulContent = () => kept.some((line) => String(line || "").trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    const trimmed = line.trim();
    const nextWindow = lines
      .slice(index, index + 5)
      .map((entry) => String(entry || "").trim())
      .join("\n");
    const startsQuotedThread = (
      /^>+/.test(trimmed)
      || /^[-_]{2,}\s*original message\s*[-_]{2,}$/i.test(trimmed)
      || /^on .+wrote:\s*$/i.test(trimmed)
      || (
        hasMeaningfulContent()
        && /^from:\s+/i.test(trimmed)
        && /^subject:\s+/im.test(nextWindow)
      )
    );
    if (startsQuotedThread && hasMeaningfulContent()) {
      break;
    }
    kept.push(line);
  }
  return sanitizeMailText(kept.join("\n")) || raw;
}

function normalizeHeaderValue(value = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeHeaderValue(entry)).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.value === "string") return value.value;
    if (Array.isArray(value.value)) return normalizeHeaderValue(value.value);
  }
  return String(value || "").trim();
}

function getParsedHeader(headers = null, name = "") {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!headers || !normalizedName) {
    return "";
  }
  if (typeof headers.get === "function") {
    return normalizeHeaderValue(headers.get(normalizedName) || headers.get(name));
  }
  if (typeof headers === "object") {
    const direct = headers[normalizedName] || headers[name];
    if (direct) {
      return normalizeHeaderValue(direct);
    }
    const matchKey = Object.keys(headers).find((key) => String(key || "").trim().toLowerCase() === normalizedName);
    return matchKey ? normalizeHeaderValue(headers[matchKey]) : "";
  }
  return "";
}

function extractEmailDomain(address = "") {
  const match = String(address || "").trim().toLowerCase().match(/@([^@\s>]+)$/);
  return match ? match[1].replace(/[),.;:]+$/g, "") : "";
}

function extractUrlHost(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return String(url.hostname || "").replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function getRegisteredDomain(host = "") {
  const normalized = String(host || "").trim().replace(/\.$/, "").toLowerCase();
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  const secondLevelSuffixes = new Set(["com.au", "net.au", "org.au", "co.uk", "org.uk", "ac.uk", "co.nz", "com.br"]);
  const suffix = parts.slice(-2).join(".");
  return secondLevelSuffixes.has(suffix) && parts.length >= 3
    ? parts.slice(-3).join(".")
    : parts.slice(-2).join(".");
}

function extractUrls(...values) {
  const urls = [];
  for (const value of values) {
    const text = String(value || "");
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of matches) {
      const cleaned = match.replace(/[)\],.;:!?]+$/g, "");
      if (cleaned) {
        urls.push(cleaned);
      }
    }
  }
  return [...new Set(urls)].slice(0, 30);
}

function hasHtmlLinkTextMismatch(html = "") {
  const source = String(html || "");
  if (!source || !/<a\b/i.test(source)) {
    return false;
  }
  const anchorPattern = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(source))) {
    const hrefHost = getRegisteredDomain(extractUrlHost(match[1]));
    const labelText = String(match[2] || "").replace(/<[^>]+>/g, " ");
    const visibleUrl = (labelText.match(/https?:\/\/[^\s"'<>]+/i) || [])[0];
    const labelHost = getRegisteredDomain(extractUrlHost(visibleUrl || labelText));
    if (hrefHost && labelHost && hrefHost !== labelHost) {
      return true;
    }
  }
  return false;
}

function mentionsProtectedBrand(value = "") {
  const text = String(value || "").toLowerCase();
  const brands = [
    { name: "microsoft", domains: ["microsoft.com", "office.com", "live.com", "outlook.com"] },
    { name: "google", domains: ["google.com", "gmail.com"] },
    { name: "apple", domains: ["apple.com", "icloud.com"] },
    { name: "paypal", domains: ["paypal.com"] },
    { name: "ato", domains: ["ato.gov.au"] },
    { name: "mygov", domains: ["my.gov.au"] },
    { name: "australia post", domains: ["auspost.com.au"] },
    { name: "amazon", domains: ["amazon.com", "amazon.com.au"] }
  ];
  return brands.find((brand) => text.includes(brand.name)) || null;
}

function isBrandDomainAllowed(domain = "", brand = null) {
  const registered = getRegisteredDomain(domain);
  return Boolean(brand?.domains?.some((allowed) => registered === allowed || registered.endsWith(`.${allowed}`)));
}

function identifyGitServiceMail({
  senderName = "",
  senderAddress = "",
  subjectText = "",
  bodyText = "",
  htmlText = "",
  headers = null
} = {}) {
  const address = String(senderAddress || "").trim().toLowerCase();
  const domain = getRegisteredDomain(extractEmailDomain(address));
  const combined = `${senderName}\n${address}\n${subjectText}\n${bodyText}\n${htmlText}`.toLowerCase();
  const listId = getParsedHeader(headers, "list-id").toLowerCase();
  const githubHeaders = [
    getParsedHeader(headers, "x-github-reason"),
    getParsedHeader(headers, "x-github-sender")
  ].join("\n").toLowerCase();
  const gitlabHeaders = [
    getParsedHeader(headers, "x-gitlab-project"),
    getParsedHeader(headers, "x-gitlab-sender")
  ].join("\n").toLowerCase();
  const autoSubmitted = getParsedHeader(headers, "auto-submitted").toLowerCase();
  const gitWorkSignal = /\b(pull request|merge request|issue|commit|repository|repo|review requested|checks? (?:failed|passed)|workflow|build|pipeline|deployment|dependabot|security advisory)\b/.test(combined);
  const notificationSignal = gitWorkSignal
    || /\bgithub\b/.test(`${listId}\n${githubHeaders}`)
    || /\bgitlab\b/.test(`${listId}\n${gitlabHeaders}`);

  if ((domain === "github.com" || address.endsWith("@users.noreply.github.com") || /\bgithub\.com\b/.test(listId)) && notificationSignal) {
    return { service: "github", reason: "github notification" };
  }
  if ((domain === "gitlab.com" || /\bgitlab\b/.test(`${listId}\n${gitlabHeaders}`)) && notificationSignal) {
    return { service: "gitlab", reason: "gitlab notification" };
  }
  if ((domain === "bitbucket.org" || domain === "atlassian.net" || domain === "atlassian.com") && /\b(bitbucket|pull request|repository|commit|pipeline)\b/.test(combined)) {
    return { service: "bitbucket", reason: "bitbucket notification" };
  }
  if ((domain === "codeberg.org" || domain === "sourcehut.org" || domain === "gitea.com") && gitWorkSignal) {
    return { service: "git", reason: "git service notification" };
  }
  if (domain === "microsoft.com" && /\b(azure devops|dev\.azure\.com|pull request|pipeline|repository)\b/.test(combined)) {
    return { service: "azure-devops", reason: "azure devops notification" };
  }
  if (notificationSignal && /\b(auto-generated|auto-replied)\b/.test(autoSubmitted) && /\b(git|github|gitlab|bitbucket)\b/.test(combined)) {
    return { service: "git", reason: "git service notification" };
  }
  return null;
}

function classifyMailMessage({
  fromName = "",
  fromAddress = "",
  to = [],
  subject = "",
  text = "",
  html = "",
  headers = null,
  replyTo = [],
  attachments = []
} = {}) {
  const senderName = String(fromName || "").trim();
  const senderAddress = String(fromAddress || "").trim().toLowerCase();
  const senderDomain = extractEmailDomain(senderAddress);
  const recipients = Array.isArray(to) ? to.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const replyToAddresses = Array.isArray(replyTo) ? replyTo.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const subjectText = String(subject || "").trim();
  const bodyText = compactTaskText(String(text || "").replace(/\s+/g, " ").trim(), 2400);
  const htmlText = compactTaskText(String(html || "").replace(/\s+/g, " ").trim(), 2400);
  const combined = `${senderName}\n${senderAddress}\n${subjectText}\n${bodyText}\n${htmlText}`.toLowerCase();
  const authenticationResults = getParsedHeader(headers, "authentication-results").toLowerCase();
  const gitService = identifyGitServiceMail({ senderName, senderAddress, subjectText, bodyText, htmlText, headers });
  const urls = extractUrls(bodyText, htmlText);
  const urlHosts = urls.map((url) => extractUrlHost(url)).filter(Boolean);
  const uniqueUrlDomains = [...new Set(urlHosts.map((host) => getRegisteredDomain(host)).filter(Boolean))];

  let spamScore = 0;
  const reasons = [];

  const addReason = (score, reason) => {
    spamScore += score;
    reasons.push(reason);
  };

  if (/\b(unsubscribe|view online|privacy policy|terms ?& ?conditions|help centre|manage preferences)\b/.test(combined)) {
    addReason(2, "bulk-marketing footer");
  }
  if (/\b(no traffic growth no pay|reply yes interested|special offer|limited time|flash deal|order now|buy now|discount|% off|sale)\b/.test(combined)) {
    addReason(2, "promotional language");
  }
  if (/\b(website review|marketing|seo|paid advertising|traffic growth|lead generation|digital marketing)\b/.test(combined)) {
    addReason(2, "cold marketing pitch");
  }
  if (/\b(kogan|seek|newsletter|store-news|noreply|no-reply|mailer-daemon)\b/.test(combined)) {
    addReason(1, "bulk sender pattern");
  }
  if (/\b(reply with no|if this is not of your interest|located in the below aussie cities)\b/.test(combined)) {
    addReason(2, "spam template phrasing");
  }
  if (senderAddress.endsWith(".my.id")) {
    addReason(3, "suspicious sender domain");
  }
  if (/\bxn--/.test(senderDomain) || /[^\x00-\x7F]/.test(senderDomain)) {
    addReason(2, "lookalike sender domain");
  }
  if (/\b(dkim|spf|dmarc)=(fail|softfail|permerror|temperror)\b/.test(authenticationResults)) {
    addReason(3, "failed sender authentication");
  }
  if (replyToAddresses.some((address) => extractEmailDomain(address) && extractEmailDomain(address) !== senderDomain)) {
    addReason(2, "reply-to domain mismatch");
  }
  if (/\b(verify your account|confirm your identity|wallet|crypto|seed phrase|gift card|payment failed|account suspended|unusual sign-in|click the link below|act now)\b/.test(combined)) {
    addReason(3, "phishing-style language");
  }
  if (/\b(urgent|immediate action|required today|final notice|overdue|account closure|legal action|wire transfer|bank transfer|eft|zelle|western union|remote access|anydesk|teamviewer|invoice attached|new payment details)\b/.test(combined)) {
    addReason(2, "scam urgency or payment language");
  }
  if (/\b(bit\.ly|tinyurl|t\.co|goo\.gl|rb\.gy)\b/.test(combined)) {
    addReason(2, "shortened-link pattern");
  }
  if (urlHosts.some((host) => /(^|\.)\d{1,3}(?:\.\d{1,3}){3}$/.test(host))) {
    addReason(2, "raw-ip link");
  }
  if (uniqueUrlDomains.length >= 4) {
    addReason(1, "many unrelated link domains");
  }
  if (hasHtmlLinkTextMismatch(html)) {
    addReason(3, "masked link destination");
  }
  if (/\b(microsoft|google|apple|paypal|bank|ato|australia post|mygov)\b/.test(combined) && /\b(verify|login|password|reset|suspended|security alert|click)\b/.test(combined)) {
    addReason(3, "brand impersonation pattern");
  }
  const protectedBrand = mentionsProtectedBrand(`${senderName}\n${subjectText}`);
  if (protectedBrand && senderDomain && !isBrandDomainAllowed(senderDomain, protectedBrand)) {
    addReason(3, "brand sender mismatch");
  }
  const riskyAttachments = (Array.isArray(attachments) ? attachments : []).filter((attachment) => {
    const filename = String(attachment?.filename || attachment?.name || "").trim().toLowerCase();
    const contentType = String(attachment?.contentType || "").trim().toLowerCase();
    return /\.(exe|scr|bat|cmd|com|js|jse|vbs|vbe|wsf|hta|ps1|iso|img|docm|xlsm|html?|zip|rar|7z)$/i.test(filename)
      || /\b(application\/x-msdownload|application\/x-msdos-program|text\/html)\b/.test(contentType);
  });
  if (riskyAttachments.length) {
    addReason(3, "risky attachment type");
  }
  if (/\b(invoice|refund|receipt|security alert|password reset|verification code)\b/.test(combined)) {
    addReason(-1, "transactional wording");
  }
  if (recipients.some((entry) => /\bhello@example\.com\b/.test(entry))) {
    addReason(1, "forwarded-to-user mailbox");
  }

  let category = "other";
  if (gitService) {
    category = "system";
  } else if (/\b(applied jobs|recruitment|job|seek|candidate|application)\b/.test(combined)) {
    category = "jobs";
  } else if (/\b(invoice|receipt|refund|order|payment|transaction|billing|renewal)\b/.test(combined)) {
    category = "transactional";
  } else if (/\b(marketing|seo|traffic growth|sale|discount|offer|promo|newsletter|advertis)\b/.test(combined)) {
    category = "promotion";
  } else if (/\b(hello|hi there|let me know|thanks|regards)\b/.test(combined) && !/\b(unsubscribe|sale|discount)\b/.test(combined)) {
    category = "personal";
  } else if (/\b(alert|warning|security|system|notification|update)\b/.test(combined)) {
    category = "system";
  }

  const automated = /\b(noreply|no-reply|newsletter|store-news)\b/.test(senderAddress) || /\bview online\b/.test(combined);
  const riskScoreBeforeTrustedAutomation = spamScore;
  const severeGitRisk = gitService && riskScoreBeforeTrustedAutomation >= 5 && reasons.some((reason) =>
    /\b(masked link destination|risky attachment type|raw-ip link|shortened-link pattern|reply-to domain mismatch|lookalike sender domain)\b/.test(String(reason || ""))
  );
  if (gitService) {
    spamScore = Math.min(Math.max(0, spamScore), 1);
    reasons.unshift(gitService.reason);
  }
  const likelySpam = !gitService && (spamScore >= 4 || (spamScore >= 3 && category === "promotion"));
  const phishingSignals = /\b(verify|password|login|security alert|suspended|click|payment failed|identity|seed phrase|gift card|remote access|new payment details)\b/.test(combined)
    || reasons.some((reason) => /authentication|masked link|brand sender|reply-to|lookalike|risky attachment/.test(reason));
  const likelyPhishing = (gitService ? severeGitRisk : spamScore >= 5)
    && category !== "promotion"
    && phishingSignals
    && !/\b(verification code|password reset requested by you)\b/.test(combined);
  if (category === "other" && automated && (likelySpam || /\b(sale|discount|offer|deal|promo)\b/.test(combined))) {
    category = "promotion";
  }
  const definitelyBad = likelyPhishing || (likelySpam && Number(spamScore || 0) >= 5 && ["promotion", "other"].includes(category));
  const autoReview = !(definitelyBad || (automated && category === "promotion"));
  const autoMoveDestination = definitelyBad ? "trash" : "";

  return {
    category,
    spamScore,
    likelySpam,
    likelyPhishing,
    automated,
    autoReview,
    autoMoveDestination,
    reasons: reasons.slice(0, 6),
    trustedAutomation: gitService ? {
      kind: "git_service",
      service: gitService.service
    } : null
  };
}

function resolveImplicitUserEmail() {
  refreshObserverConfig();
  const configured = String(observerConfig?.mail?.notifyEmail || "").trim();
  if (looksLikeEmailAddress(configured)) {
    return configured;
  }
  const recent = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const blocked = new Set(
    [
      getActiveMailAgent()?.email
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase())
  );
  const recipientScores = new Map();
  for (const message of recent) {
    const receivedAt = Number(message.receivedAt || 0);
    const recipients = Array.isArray(message.to) ? message.to : [];
    for (const recipient of recipients) {
      const email = String(recipient || "").trim();
      const key = email.toLowerCase();
      if (!email || blocked.has(key)) {
        continue;
      }
      const previous = recipientScores.get(key);
      recipientScores.set(key, {
        email,
        count: Number(previous?.count || 0) + 1,
        latestAt: Math.max(Number(previous?.latestAt || 0), receivedAt)
      });
    }
  }
  const bestRecipient = [...recipientScores.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.latestAt - left.latestAt;
    })[0];
  if (bestRecipient?.email) {
    return bestRecipient.email;
  }
  const incoming = recent
    .filter((message) => String(message.fromAddress || "").trim())
    .filter((message) => !blocked.has(String(message.fromAddress || "").trim().toLowerCase()))
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  return String(incoming[0]?.fromAddress || "").trim();
}

function mailAgentMatchesText(agent, text = "") {
  const patterns = [
    String(agent?.id || "").trim(),
    String(agent?.label || "").trim(),
    ...(Array.isArray(agent?.aliases) ? agent.aliases.map((value) => String(value).trim()) : [])
  ].filter(Boolean);
  return patterns.some((value) => new RegExp(`\\b${escapeRegex(value)}\\b`, "i").test(text));
}

function parseDirectMailRequest(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(send|email|mail)\b/.test(lower)) {
    return null;
  }
  const directEmailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const refersToUser = /\b(to me|email me|send me (?:an? )?(?:test )?email|send me mail|mail me)\b/i.test(text);
  const destinationEmail = directEmailMatch
    ? String(directEmailMatch[0]).trim()
    : refersToUser
      ? resolveImplicitUserEmail()
      : "";
  if (!destinationEmail) {
    return null;
  }
  const subjectMatch = text.match(/\bsubject\b[:\s]+["']?([^"'\n]+)["']?/i);
  const bodyMatch = text.match(/\b(?:that says|that said|saying|say|with(?: the)? message|message|body)\b[:\s]+["']?([\s\S]+?)["']?\s*$/i);
  const bareHiMatch = text.match(/\b(?:send|email|mail)\b[\s\S]*?\b(?:that says|that said|saying|say)\s+(.+)$/i);
  const body = sanitizeMailText(bodyMatch?.[1] || bareHiMatch?.[1] || "");
  const wantsTestEmail = /\btest email\b/i.test(text) || /\btest mail\b/i.test(text);
  const wantsReport = /\b(add|include|attach|with)\b[\s\S]*\b(report|summary|status update)\b/i.test(text)
    || /\b(send|email|mail)\b[\s\S]*\b(report|summary|status update)\b/i.test(text);
  return {
    toEmail: destinationEmail,
    subject: String(subjectMatch?.[1] || "").trim(),
    text: body,
    wantsTestEmail,
    wantsReport
  };
}

function parseStandingMailWatchRequest(message = "") {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(email|emails|mail|inbox)\b/.test(lower)) {
    return null;
  }
  if (!/\b(keep an eye on|watch|monitor|look out for|pay attention to|keep track of)\b/.test(lower)) {
    return null;
  }
  if (!/\b(let me know|tell me|notify me|flag|if i need to address|if anything needs my attention|if i should reply)\b/.test(lower)) {
    return null;
  }
  const notifyEmail = resolveImplicitUserEmail();
  const every = "10m";
  return {
    id: `mail-watch-${hashRef(text.replace(/\s+/g, " ").trim().toLowerCase())}`,
    every,
    everyMs: parseEveryToMs(every),
    instruction: text,
    notifyEmail,
    autoForwardGood: true,
    trashDefiniteBad: true,
    promptUnsure: true,
    sendSummaries: mailWatchRulesState?.sendSummariesEnabled !== false,
    promptEvery: "4h",
    promptEveryMs: parseEveryToMs("4h")
  };
}

function isValidNotifyEmail(value = "") {
  const email = String(value || "").trim();
  return looksLikeEmailAddress(email) && !/missing_/i.test(email);
}

function resolveMailWatchNotifyEmail(rule = {}) {
  const configured = String(rule?.notifyEmail || "").trim();
  if (isValidNotifyEmail(configured)) {
    return configured;
  }
  return String(resolveImplicitUserEmail() || "").trim();
}

function isDefinitelyGoodMail(message = {}) {
  const triage = message?.triage || {};
  const category = String(triage.category || "").trim().toLowerCase();
  if (triage.likelySpam || triage.likelyPhishing) {
    return false;
  }
  if (Number(triage.spamScore || 0) > 1) {
    return false;
  }
  return ["personal", "transactional", "jobs", "system"].includes(category);
}

function isDefinitelyBadMail(message = {}) {
  const triage = message?.triage || {};
  const category = String(triage.category || "").trim().toLowerCase();
  const spamScore = Number(triage.spamScore || 0);
  return triage.likelyPhishing === true
    || (triage.likelySpam === true && spamScore >= 5 && ["promotion", "other"].includes(category));
}

function isUnsafeMail(message = {}) {
  const triage = message?.triage || {};
  return triage.likelySpam === true || triage.likelyPhishing === true;
}

function getSafeMailSubject(message = {}) {
  return String(message?.subject || "(no subject)").replace(/\s+/g, " ").trim() || "(no subject)";
}

function buildTrashedMailNotice(_message = {}) {
  return "I trashed a spam message.";
}

function sanitizeMailForNotification(message = {}) {
  const triage = message?.triage || {};
  const safe = {
    id: String(message?.id || "").trim(),
    uid: Number(message?.uid || 0),
    agentId: String(message?.agentId || "").trim(),
    agentLabel: String(message?.agentLabel || "").trim(),
    agentEmail: String(message?.agentEmail || "").trim(),
    fromName: String(message?.fromName || message?.fromAddress || "Unknown sender").trim(),
    fromAddress: String(message?.fromAddress || "").trim(),
    to: Array.isArray(message?.to) ? message.to.map((entry) => String(entry || "").trim()).filter(Boolean) : [],
    subject: getSafeMailSubject(message),
    receivedAt: Number(message?.receivedAt || 0),
    source: String(message?.source || "").trim(),
    triage: {
      category: String(triage.category || "").trim(),
      spamScore: Number(triage.spamScore || 0),
      likelySpam: triage.likelySpam === true,
      likelyPhishing: triage.likelyPhishing === true,
      automated: triage.automated === true,
      autoReview: triage.autoReview !== false,
      autoMoveDestination: String(triage.autoMoveDestination || "").trim(),
      reasons: Array.isArray(triage.reasons) ? triage.reasons.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 6) : [],
      trustedAutomation: triage?.trustedAutomation && typeof triage.trustedAutomation === "object"
        ? {
            kind: String(triage.trustedAutomation.kind || "").trim(),
            service: String(triage.trustedAutomation.service || "").trim()
          }
        : null
    },
    sourceIdentity: message?.sourceIdentity && typeof message.sourceIdentity === "object"
      ? {
          kind: String(message.sourceIdentity.kind || "").trim(),
          label: String(message.sourceIdentity.label || "").trim(),
          email: String(message.sourceIdentity.email || "").trim(),
          trustLevel: normalizeTrustLevel(message.sourceIdentity.trustLevel, "unknown")
        }
      : null,
    text: "",
    rawText: ""
  };
  if (message?.command && typeof message.command === "object") {
    safe.command = {
      detected: message.command.detected === true,
      action: String(message.command.action || "").trim(),
      reason: String(message.command.reason || "").trim(),
      taskId: String(message.command.taskId || "").trim(),
      taskCodename: String(message.command.taskCodename || "").trim(),
      deduped: message.command.deduped === true,
      text: ""
    };
  }
  return safe;
}

function summarizeMailForUser(message = {}) {
  const triage = message?.triage || {};
  if (isUnsafeMail(message)) {
    const parts = [
      buildTrashedMailNotice(message)
    ];
    if (Array.isArray(triage.reasons) && triage.reasons.length) {
      parts.push(`Signals: ${triage.reasons.slice(0, 3).join(", ")}.`);
    }
    return parts.join("\n");
  }
  const parts = [
    `${formatDateTimeForUser(message.receivedAt)} from ${message.fromName || message.fromAddress || "Unknown sender"}`,
    `subject: ${message.subject || "(no subject)"}`
  ];
  if (triage.category) {
    parts.push(`category: ${triage.category}`);
  }
  if (Array.isArray(triage.reasons) && triage.reasons.length) {
    parts.push(`signals: ${triage.reasons.slice(0, 3).join(", ")}`);
  }
  const preview = compactTaskText(message.text || "", 260);
  if (preview) {
    parts.push(preview);
  }
  return parts.join("\n");
}

async function forwardMailToUser(message = {}, notifyEmail = "") {
  const destination = String(notifyEmail || "").trim();
  if (!looksLikeEmailAddress(destination)) {
    throw new Error("notifyEmail is not configured");
  }
  const triage = message?.triage || {};
  const text = [
    "Nova flagged this email as clearly worth your attention.",
    "",
    `From: ${message.fromName || message.fromAddress || "Unknown sender"} <${message.fromAddress || "unknown"}>`,
    `To: ${Array.isArray(message.to) && message.to.length ? message.to.join(", ") : "(unknown)"}`,
    `Received: ${formatDateTimeForUser(message.receivedAt)}`,
    `Subject: ${message.subject || "(no subject)"}`,
    triage.category ? `Category: ${triage.category}` : "",
    "",
    "Message:",
    String(message.text || "").trim() || "(no message body)"
  ].filter(Boolean).join("\n");
  return sendAgentMail({
    toEmail: destination,
    subject: `[Nova] ${message.subject || "(no subject)"}`,
    text
  });
}

async function sendUnsureMailDigest({ rule, messages = [] } = {}) {
  const notifyEmail = resolveMailWatchNotifyEmail(rule);
  if (!looksLikeEmailAddress(notifyEmail) || !messages.length) {
    return null;
  }
  const body = [
    "Nova needs direction on these uncertain emails.",
    "",
    "Please reply with what you want done, or tell Nova directly in chat.",
    "",
    ...messages.slice(0, 8).map((message, index) => [
      `${index + 1}.`,
      summarizeMailForUser(message)
    ].join("\n"))
  ].join("\n\n");
  return sendAgentMail({
    toEmail: notifyEmail,
    subject: `[Nova] Direction needed for ${messages.length} email${messages.length === 1 ? "" : "s"}`,
    text: body
  });
}

function getMailWatchRule(ruleId = "") {
  return (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .find((rule) => String(rule.id || "") === String(ruleId || "")) || null;
}

async function findMailWatchWaitingTask(ruleId = "") {
  const targetRuleId = String(ruleId || "").trim();
  if (!targetRuleId) {
    return null;
  }
  const { waiting } = await listAllTasks();
  return waiting.find((task) =>
    String(task.internalJobType || "") === "mail_watch_question"
    && String(task.mailWatchRuleId || "").trim() === targetRuleId
  ) || null;
}

function buildMailWatchSingleQuestion(message = {}) {
  const summary = summarizeMailForUser(message);
  return {
    message: [
      "Mail watch needs direction for 1 uncertain email.",
      "",
      `1. ${summary}`,
      "",
      `Tip: say "trash it and add an email rule" to remember that choice for similar mail.`
    ].join("\n"),
    questionForUser: [
      "I have 1 uncertain email that needs direction.",
      "What would you like me to do with it?",
      "",
      `1. ${summary}`,
      "",
      `Tip: you can say "trash it and add an email rule" if you want me to remember that decision for similar mail.`
    ].join("\n")
  };
}

function parseMailWatchAnswerAction(answer = "") {
  const lower = String(answer || "").trim().toLowerCase();
  if (!lower) {
    return "";
  }
  if (/\b(trash|delete|junk|bin|remove)\b/.test(lower)) {
    return "trash";
  }
  if (/\barchive\b/.test(lower)) {
    return "archive";
  }
  if (/\bforward\b|\bsend(?: it)? to me\b|\bemail(?: it)? to me\b/.test(lower)) {
    return "forward";
  }
  if (/\bkeep\b|\bleave\b|\bignore\b|\bdo nothing\b/.test(lower)) {
    return "keep";
  }
  return "";
}

async function inferMailWatchAnswerActionWithLlm(task, answer, messages = []) {
  const routing = getRoutingConfig();
  const plannerBrain = await choosePlannerRepairBrain(
    [String(routing.remoteTriageBrainId || "").trim(), "helper"].filter(Boolean),
    { preferRemote: true }
  ) || await getBrain("bitnet");
  const messageSummaries = (Array.isArray(messages) ? messages : [])
    .slice(0, 5)
    .map((message, index) => `${index + 1}. ${summarizeMailForUser(message)}`)
    .join("\n\n");
  const prompt = [
    "You are deciding how to apply a user's answer to a mail-watch follow-up question.",
    `Your name is ${getAgentPersonaName()}.`,
    "Reply with JSON only.",
    "Choose exactly one action from: trash, archive, forward, keep, unclear.",
    "Be conservative. Use unclear if the user answer is ambiguous or depends on per-message differences.",
    "Schema: {\"action\":\"trash|archive|forward|keep|unclear\",\"reason\":\"...\"}",
    "",
    `Original question: ${String(task.questionForUser || task.message || "").trim()}`,
    `User answer: ${String(answer || "").trim()}`,
    "",
    "Emails in question:",
    messageSummaries || "(none)"
  ].join("\n");
  const result = await runOllamaJsonGenerate(plannerBrain.model, prompt, {
    timeoutMs: 45000,
    keepAlive: MODEL_KEEPALIVE,
    baseUrl: plannerBrain.ollamaBaseUrl,
    options: isCpuQueueLane(plannerBrain) ? { num_gpu: 0 } : undefined,
    brainId: plannerBrain.id,
    leaseOwnerId: task?.id ? `task:${String(task.id).trim()}` : `mail-watch:${String(task?.sessionId || "Main").trim() || "Main"}`,
    leaseWaitMs: 2500
  });
  if (!result.ok) {
    return { action: "", reason: result.stderr || "planner inference failed" };
  }
  try {
    const parsed = extractJsonObject(result.text);
    const action = String(parsed.action || "").trim().toLowerCase();
    if (["trash", "archive", "forward", "keep"].includes(action)) {
      return {
        action,
        reason: compactTaskText(String(parsed.reason || "").trim(), 220)
      };
    }
    return {
      action: "",
      reason: compactTaskText(String(parsed.reason || "the answer was still ambiguous").trim(), 220)
    };
  } catch (error) {
    return { action: "", reason: error.message || "failed to parse planner answer" };
  }
}

async function handleMailWatchWaitingAnswer(task, answer, sessionId = "Main") {
  const ruleId = String(task.mailWatchRuleId || "").trim();
  const rule = getMailWatchRule(ruleId);
  if (!rule) {
    throw new Error("mail watch rule not found");
  }
  const pendingIds = Array.isArray(task.pendingUnsureMessageIds)
    ? task.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!pendingIds.length) {
    throw new Error("no pending unsure emails were attached to this question");
  }
  const recentMessages = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const messages = pendingIds
    .map((messageId) => recentMessages.find((entry) => String(entry.id || "").trim() === messageId))
    .filter(Boolean);
  if (!messages.length) {
    const currentPendingIds = Array.isArray(rule.pendingUnsureMessageIds)
      ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const currentMessages = currentPendingIds
      .map((messageId) => recentMessages.find((entry) => String(entry.id || "").trim() === messageId))
      .filter(Boolean);
    await closeTaskRecord(task, compactTaskText(
      currentMessages.length
        ? "Closed stale mail-watch question because the underlying unsure emails changed. A refreshed question will replace it."
        : "Closed stale mail-watch question because the original unsure emails are no longer available."
    , 260));
    if (currentMessages.length) {
      await reconcileMailWatchWaitingQuestions();
    }
    return {
      ...task,
      status: "closed",
      updatedAt: Date.now(),
      notes: currentMessages.length
        ? "Stale question replaced with a refreshed mail-watch prompt."
        : "Stale question cleared because the original messages are no longer available."
    };
  }
  const ruleIntent = parseMailWatchRuleAnswerIntent(answer);
  let action = ruleIntent.action || parseMailWatchAnswerAction(answer);
  let inferredReason = "";
  if (!action) {
    const inferred = await inferMailWatchAnswerActionWithLlm(task, answer, messages);
    action = inferred.action;
    inferredReason = inferred.reason || "";
  }
  if (!action) {
    throw new Error(`I couldn't tell whether you wanted me to trash, archive, forward, or keep that email.${inferredReason ? ` ${inferredReason}` : ""}`);
  }
  const notifyEmail = resolveMailWatchNotifyEmail(rule);
  const resolvedUnsureMessageIds = new Set(
    Array.isArray(rule.resolvedUnsureMessageIds)
      ? rule.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
  const createdMailRules = [];
  let forwardedCount = 0;
  let movedCount = 0;
  for (const message of messages) {
    const messageId = String(message.id || "").trim();
    if (action === "trash") {
      await moveAgentMail({ destination: "trash", messageId });
      movedCount += 1;
    } else if (action === "archive") {
      await moveAgentMail({ destination: "archive", messageId });
      movedCount += 1;
    } else if (action === "forward") {
      await forwardMailToUser(message, notifyEmail);
      forwardedCount += 1;
    }
  }
  const remainingPendingIds = (Array.isArray(rule.pendingUnsureMessageIds) ? rule.pendingUnsureMessageIds : [])
    .map((value) => String(value || "").trim())
    .filter((messageId) => !pendingIds.includes(messageId));
  for (const messageId of pendingIds) {
    resolvedUnsureMessageIds.add(messageId);
  }
  if (ruleIntent.wantsRule) {
    const inferredMatch = await inferMailWatchRuleMatchFromDescription(answer, messages[0] || {}, action).catch(() => null);
    if (inferredMatch) {
      const nextRuleRequest = buildMailWatchActionRuleFromMatch(inferredMatch, action);
      if (nextRuleRequest?.id) {
        const nextRule = await upsertMailWatchRule(nextRuleRequest);
        createdMailRules.push(nextRule);
      }
    } else {
      const seenRuleIds = new Set();
      for (const message of messages) {
        const nextRuleRequest = buildMailWatchActionRuleFromMessage(message, action);
        if (!nextRuleRequest?.id || seenRuleIds.has(nextRuleRequest.id)) {
          continue;
        }
        const nextRule = await upsertMailWatchRule(nextRuleRequest);
        seenRuleIds.add(nextRule.id);
        createdMailRules.push(nextRule);
      }
    }
  }
  await upsertMailWatchRule({
    ...rule,
    pendingUnsureMessageIds: remainingPendingIds,
    resolvedUnsureMessageIds: [...resolvedUnsureMessageIds],
    lastPromptedAt: Date.now()
  });
  const ruleSummary = createdMailRules.length
    ? ` Saved ${createdMailRules.length === 1 ? "an email rule" : `${createdMailRules.length} email rules`} so Nova will automatically ${action} ${createdMailRules.length === 1 ? (describeMailWatchRuleMatch(createdMailRules[0].match) || "similar mail") : "similar mail in future"}.`
    : "";
  await closeTaskRecord(task, compactTaskText(
    action === "forward"
      ? `User answered mail-watch question: forwarded ${forwardedCount} uncertain email${forwardedCount === 1 ? "" : "s"} and cleared the waiting prompt.${ruleSummary}`
      : action === "keep"
        ? `User answered mail-watch question: kept ${messages.length} uncertain email${messages.length === 1 ? "" : "s"} in the inbox and cleared the waiting prompt.${ruleSummary}`
        : `User answered mail-watch question: moved ${movedCount} uncertain email${movedCount === 1 ? "" : "s"} to ${action} and cleared the waiting prompt.${inferredReason ? ` Reason: ${inferredReason}` : ""}${ruleSummary}`
  , 260));
  return {
    ...task,
    status: "closed",
    handledAction: action,
    handledMessageCount: messages.length,
    createdMailRules,
    updatedAt: Date.now()
  };
}

async function reconcileMailWatchWaitingQuestions() {
  const rules = Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [];
  const recentMessages = Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [];
  const messageById = new Map(recentMessages.map((message) => [String(message.id || "").trim(), message]).filter(([id]) => id));
  for (const rule of rules) {
    if (rule?.enabled === false || rule?.promptUnsure === false) {
      continue;
    }
    const pendingIds = Array.isArray(rule?.pendingUnsureMessageIds)
      ? rule.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const existingWaitingTask = await findMailWatchWaitingTask(rule.id);
    if (!pendingIds.length) {
      if (existingWaitingTask) {
        await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because there are no pending unsure emails.");
      }
      continue;
    }
    const messages = pendingIds.map((id) => messageById.get(id)).filter(Boolean).slice(0, 1);
    if (!messages.length) {
      if (existingWaitingTask) {
        await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because the original unsure emails are no longer available.");
      }
      continue;
    }
    const nextPendingIds = messages.map((message) => String(message.id || "").trim()).filter(Boolean);
    const existingPendingIds = Array.isArray(existingWaitingTask?.pendingUnsureMessageIds)
      ? existingWaitingTask.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (existingWaitingTask) {
      const samePendingIds = existingPendingIds.length === nextPendingIds.length
        && existingPendingIds.every((value, index) => value === nextPendingIds[index]);
      if (samePendingIds) {
        continue;
      }
      await closeTaskRecord(existingWaitingTask, "Closed stale mail-watch question because the underlying unsure emails changed.");
    }
    const question = buildMailWatchSingleQuestion(messages[0]);
    await createWaitingTask({
      message: question.message,
      questionForUser: question.questionForUser,
      sessionId: "mail-watch-question",
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: [],
      forceToolUse: false,
      notes: `Recovered waiting question for uncertain mail from rule ${rule.id}.`,
      taskMeta: {
        internalJobType: "mail_watch_question",
        mailWatchRuleId: rule.id,
        pendingUnsureMessageIds: nextPendingIds
      }
    });
  }
}

async function upsertMailWatchRule(request = {}) {
  const now = Date.now();
  const existing = getMailWatchRule(request.id);
  const promptEvery = String(request.promptEvery || existing?.promptEvery || "4h").trim() || "4h";
  const ruleKind = String(request.ruleKind || existing?.ruleKind || (request.actionOnMatch || existing?.actionOnMatch ? "message_action" : "watch")).trim().toLowerCase() === "message_action"
    ? "message_action"
    : "watch";
  const actionOnMatch = normalizeMailWatchRuleAction(request.actionOnMatch || existing?.actionOnMatch);
  const match = normalizeMailWatchRuleMatch(request.match || existing?.match);
  const rule = {
    id: String(request.id || `mail-watch-${now}`).trim(),
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now,
    enabled: true,
    ruleKind,
    actionOnMatch,
    match,
    every: String(request.every || existing?.every || "10m").trim() || "10m",
    everyMs: Number(request.everyMs || existing?.everyMs || parseEveryToMs(request.every || existing?.every || "10m") || 10 * 60 * 1000),
    instruction: String(request.instruction || existing?.instruction || "").trim(),
    notifyEmail: String(request.notifyEmail || existing?.notifyEmail || resolveImplicitUserEmail() || "").trim(),
    autoForwardGood: request.autoForwardGood == null ? (existing?.autoForwardGood !== false) : request.autoForwardGood === true,
    trashDefiniteBad: request.trashDefiniteBad == null ? (existing?.trashDefiniteBad !== false) : request.trashDefiniteBad === true,
    promptUnsure: request.promptUnsure == null ? (existing?.promptUnsure !== false) : request.promptUnsure === true,
    sendSummaries: request.sendSummaries == null
      ? (existing?.sendSummaries == null ? (mailWatchRulesState?.sendSummariesEnabled !== false) : existing?.sendSummaries !== false)
      : request.sendSummaries === true,
    promptEvery,
    promptEveryMs: Number(request.promptEveryMs || existing?.promptEveryMs || parseEveryToMs(promptEvery) || 4 * 60 * 60 * 1000),
    lastCheckedAt: Number(request.lastCheckedAt || existing?.lastCheckedAt || 0),
    lastProcessedReceivedAt: Number(request.lastProcessedReceivedAt || existing?.lastProcessedReceivedAt || 0),
    lastPromptedAt: Number(request.lastPromptedAt || existing?.lastPromptedAt || 0),
    forwardedMessageIds: Array.isArray(request.forwardedMessageIds)
      ? request.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-2000)
      : Array.isArray(existing?.forwardedMessageIds)
        ? existing.forwardedMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-2000)
        : [],
    resolvedUnsureMessageIds: Array.isArray(request.resolvedUnsureMessageIds)
      ? request.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-500)
      : Array.isArray(existing?.resolvedUnsureMessageIds)
        ? existing.resolvedUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(-500)
        : [],
    pendingUnsureMessageIds: Array.isArray(request.pendingUnsureMessageIds)
      ? request.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
      : Array.isArray(existing?.pendingUnsureMessageIds)
        ? existing.pendingUnsureMessageIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 200)
        : []
  };
  const otherRules = (Array.isArray(mailWatchRulesState.rules) ? mailWatchRulesState.rules : [])
    .filter((entry) => String(entry.id || "") !== rule.id);
  mailWatchRulesState.rules = [...otherRules, rule]
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  await saveMailWatchRulesState();
  return rule;
}

function normalizeMailMessage(agent, uid, envelope, parsed, source = "imap") {
  const fromEntry = Array.isArray(envelope?.from) ? envelope.from[0] : null;
  const toEntries = Array.isArray(envelope?.to) ? envelope.to : [];
  const subject = String(parsed?.subject || envelope?.subject || "(no subject)").trim() || "(no subject)";
  const rawText = sanitizeMailText(parsed?.text || parsed?.html || "");
  const text = stripQuotedReplyText(rawText);
  const receivedAt = Number(envelope?.date ? new Date(envelope.date).getTime() : Date.now());
  const replyToEntries = Array.isArray(parsed?.replyTo?.value) ? parsed.replyTo.value : [];
  const sourceIdentity = assessEmailSourceIdentity({
    fromName: fromEntry?.name || "",
    fromAddress: fromEntry?.address || ""
  });
  const triage = classifyMailMessage({
    fromName: fromEntry?.name || "",
    fromAddress: fromEntry?.address || "",
    to: toEntries.map((entry) => entry?.address).filter(Boolean),
    subject,
    text,
    html: parsed?.html || "",
    headers: parsed?.headers,
    replyTo: replyToEntries.map((entry) => entry?.address).filter(Boolean),
    attachments: Array.isArray(parsed?.attachments) ? parsed.attachments : []
  });
  const command = inspectMailCommand({ subject, text });
  return {
    id: `${agent.id}:${uid}`,
    uid: Number(uid || 0),
    agentId: agent.id,
    agentLabel: agent.label,
    agentEmail: agent.email,
    fromName: fromEntry?.name || fromEntry?.address || "Unknown sender",
    fromAddress: fromEntry?.address || "",
    to: toEntries.map((entry) => entry?.address).filter(Boolean),
    subject,
    text,
    rawText,
    receivedAt,
    source,
    triage,
    sourceIdentity,
    command
  };
}

function mergeMailSourceIdentityRecords(primary = null, secondary = null) {
  const left = normalizeSourceIdentityRecord(primary, { preserveTrustLevel: true });
  const right = normalizeSourceIdentityRecord(secondary, { preserveTrustLevel: true });
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (left.kind !== right.kind) {
    return left;
  }
  const leftRank = getTrustLevelRank(left.trustLevel);
  const rightRank = getTrustLevelRank(right.trustLevel);
  const preferred = rightRank > leftRank ? right : left;
  const fallback = preferred === left ? right : left;
  return {
    ...fallback,
    ...preferred,
    label: String(preferred.label || fallback.label || "").trim(),
    email: String(preferred.email || fallback.email || "").trim().toLowerCase(),
    sourceId: String(preferred.sourceId || fallback.sourceId || "").trim(),
    matchedBy: String(preferred.matchedBy || fallback.matchedBy || "").trim()
  };
}

function resolveMailCommandSourceIdentity(message = {}) {
  const provided = normalizeSourceIdentityRecord(message?.sourceIdentity, { preserveTrustLevel: true });
  if (provided?.kind && provided.kind !== "email") {
    return provided;
  }
  const fromName = String(message?.fromName || "").trim();
  const fromAddress = String(message?.fromAddress || "").trim();
  if (!fromName && !fromAddress) {
    return provided;
  }
  const assessed = assessEmailSourceIdentity({ fromName, fromAddress });
  return mergeMailSourceIdentityRecords(provided, assessed) || provided || assessed || null;
}

function buildMailCommandRecord(commandStatus = {}, existingCommand = {}) {
  const existing = existingCommand && typeof existingCommand === "object" ? existingCommand : {};
  const status = commandStatus && typeof commandStatus === "object" ? commandStatus : {};
  return {
    detected: status.detected === true,
    text: String(status.text || existing.text || "").trim(),
    action: String(status.action || "").trim(),
    reason: String(status.reason || "").trim(),
    taskId: String(status.taskId || "").trim(),
    taskCodename: String(status.taskCodename || "").trim(),
    deduped: status.deduped === true
  };
}

function buildMailCommandReceiptText(message = {}, commandStatus = {}) {
  const trustLabel = trustLevelLabel(message?.sourceIdentity?.trustLevel);
  const action = String(commandStatus?.action || "").trim();
  const actionDetail = action === "auto_queue"
    ? `Action taken: queued this request for execution${commandStatus?.taskCodename ? ` as ${commandStatus.taskCodename}` : ""}.`
    : action === "safe_reply_only"
      ? "Action taken: confirmed receipt only. Nova did not execute the request because this sender is not fully trusted."
      : action === "user_decision_required"
        ? `Action taken: referred this request to the question system for user decision${commandStatus?.taskCodename ? ` as ${commandStatus.taskCodename}` : ""}.`
        : action === "blocked"
          ? "Action taken: blocked this request because the message was flagged as spam or phishing."
          : `Action taken: ${action || "recorded"}.`;
  const lines = [
    "Nova received your message.",
    "",
    actionDetail,
    `Source trust: ${trustLabel}.`
  ];
  if (action === "auto_queue") {
    lines.push("If the request is unclear during execution, Nova will refer it to the question system for user direction.");
  }
  if (commandStatus?.reason) {
    lines.push(`Reason: ${String(commandStatus.reason || "").trim()}`);
  }
  if (commandStatus?.text) {
    lines.push("");
    lines.push(`Request received: ${String(commandStatus.text || "").trim()}`);
  }
  return lines.join("\n");
}

async function sendMailCommandReceipt(message = {}, commandStatus = {}) {
  const toEmail = String(message?.fromAddress || message?.sourceIdentity?.email || "").trim();
  if (!looksLikeEmailAddress(toEmail)) {
    return {
      sent: false,
      error: "sender email is unavailable"
    };
  }
  try {
    await sendAgentMail({
      toEmail,
      subject: `Re: ${String(message?.subject || "(no subject)").trim() || "(no subject)"}`,
      text: buildMailCommandReceiptText(message, commandStatus)
    });
    return {
      sent: true,
      error: ""
    };
  } catch (error) {
    return {
      sent: false,
      error: String(error?.message || error || "receipt failed").trim()
    };
  }
}

async function finalizeMailCommandStatus(message = {}, commandStatus = {}) {
  const nextStatus = {
    ...commandStatus
  };
  if (nextStatus.action === "blocked" || isUnsafeMail(message)) {
    nextStatus.receiptSent = false;
    nextStatus.reason = `${String(nextStatus.reason || "").trim()} No receipt was sent for unsafe mail.`.trim();
  } else {
    const receipt = await sendMailCommandReceipt(message, nextStatus);
    nextStatus.receiptSent = receipt.sent === true;
    if (!receipt.sent && receipt.error) {
      nextStatus.reason = `${String(nextStatus.reason || "").trim()} Receipt confirmation failed: ${receipt.error}`.trim();
    }
  }
  const eventMail = nextStatus.action === "blocked" || isUnsafeMail(message)
    ? sanitizeMailForNotification(message)
    : { ...message };
  broadcastObserverEvent({
    type: "mail.command",
    mail: {
      ...eventMail,
      command: buildMailCommandRecord(
        nextStatus.action === "blocked" || isUnsafeMail(message) ? { ...nextStatus, text: "" } : nextStatus,
        nextStatus.action === "blocked" || isUnsafeMail(message) ? {} : message.command
      )
    }
  });
  return nextStatus;
}

function refreshRecentMailTrustForSource(sourceIdentity = {}) {
  const normalizedEmail = String(sourceIdentity?.email || "").trim().toLowerCase();
  if (!normalizedEmail || !Array.isArray(mailState.recentMessages) || !mailState.recentMessages.length) {
    return 0;
  }
  let updatedCount = 0;
  mailState.recentMessages = mailState.recentMessages.map((message) => {
    if (String(message?.fromAddress || "").trim().toLowerCase() !== normalizedEmail) {
      return message;
    }
    updatedCount += 1;
    const nextSourceIdentity = resolveMailCommandSourceIdentity({
      ...message,
      sourceIdentity
    }) || sourceIdentity || message.sourceIdentity;
    const inspectedCommand = inspectMailCommand(message);
    const nextCommandStatus = inspectedCommand.detected
      ? determineMailCommandAction({
          ...message,
          sourceIdentity: nextSourceIdentity,
          command: inspectedCommand
        })
      : null;
    return {
      ...message,
      sourceIdentity: nextSourceIdentity,
      command: nextCommandStatus
        ? buildMailCommandRecord(nextCommandStatus, inspectedCommand)
        : message.command
    };
  });
  return updatedCount;
}

function determineMailCommandAction(message = {}) {
  const command = message?.command && typeof message.command === "object"
    ? message.command
    : inspectMailCommand(message);
  if (!command.detected || !command.text) {
    return {
      detected: false,
      action: "",
      text: "",
      reason: ""
    };
  }
  const sourceIdentity = resolveMailCommandSourceIdentity(message) || {
    kind: "email",
    trustLevel: "unknown",
    label: String(message.fromName || message.fromAddress || "Unknown sender").trim()
  };
  const policy = getSourceTrustPolicy(sourceIdentity.trustLevel);
  if (message?.triage?.likelyPhishing || message?.triage?.likelySpam) {
    return {
      detected: true,
      action: "blocked",
      text: command.text,
      reason: "The email was flagged as spam or phishing."
    };
  }
  if (policy.requiresUserDecision) {
    return {
      detected: true,
      action: "user_decision_required",
      text: command.text,
      reason: "Unknown sources never execute commands. Nova referred the request to the user decision system."
    };
  }
  if (!policy.canExecuteCommands) {
    return {
      detected: true,
      action: "safe_reply_only",
      text: command.text,
      reason: "Known sources may receive a non-confidential acknowledgement, but they do not have authority to execute commands."
    };
  }
  return {
    detected: true,
    action: "auto_queue",
    text: command.text,
    reason: `${describeSourceTrust(sourceIdentity)} has full trust and may issue commands.`
  };
}

async function handleIncomingMailCommand(message = {}) {
  const resolvedSourceIdentity = resolveMailCommandSourceIdentity(message);
  if (resolvedSourceIdentity) {
    message.sourceIdentity = resolvedSourceIdentity;
  }
  const effectiveMessage = resolvedSourceIdentity
    ? { ...message, sourceIdentity: resolvedSourceIdentity }
    : { ...message };
  const commandStatus = determineMailCommandAction(effectiveMessage);
  if (!commandStatus.detected) {
    return commandStatus;
  }
  if (commandStatus.action === "safe_reply_only") {
    return finalizeMailCommandStatus(effectiveMessage, commandStatus);
  }
  if (commandStatus.action === "user_decision_required") {
    const { queued, waiting, inProgress } = await listAllTasks();
    const existingDecisionTask = [...queued, ...waiting, ...inProgress].find((task) =>
      String(task.sourceMessageId || "").trim() === String(effectiveMessage.id || "").trim()
      && String(task.sourceKind || "").trim() === "email"
    );
    if (existingDecisionTask) {
      return finalizeMailCommandStatus(effectiveMessage, {
        ...commandStatus,
        taskId: existingDecisionTask.id,
        taskCodename: existingDecisionTask.codename || formatTaskCodename(existingDecisionTask.id),
        deduped: true,
        reason: `${commandStatus.reason} Existing user-decision task already covers this message.`
      });
    }
    const decisionTask = await createWaitingTask({
      message: `Unknown email source requested: ${commandStatus.text}`,
      questionForUser: [
        `${describeSourceTrust(effectiveMessage.sourceIdentity)} sent an email command and is not trusted.`,
        `Subject: ${String(effectiveMessage.subject || "(no subject)").trim() || "(no subject)"}`,
        `Requested command: ${commandStatus.text}`,
        "",
        "How should Nova handle it? Reply with your decision, for example ignore it, answer manually, mark sender known, or mark sender trusted."
      ].join("\n"),
      sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
      requestedBrainId: "worker",
      intakeBrainId: "bitnet",
      internetEnabled: false,
      selectedMountIds: observerConfig.defaults.mountIds,
      forceToolUse: false,
      notes: `Waiting for user decision on unknown email command from ${describeSourceTrust(effectiveMessage.sourceIdentity)}.`,
      taskMeta: {
        sourceIdentity: normalizeSourceIdentityRecord({
          ...(effectiveMessage.sourceIdentity || {}),
          command: commandStatus
        }, { preserveTrustLevel: true }),
        sourceMessageId: String(effectiveMessage.id || "").trim(),
        sourceKind: "email",
        questionCategory: "source_trust_decision"
      }
    });
    return finalizeMailCommandStatus(effectiveMessage, {
      ...commandStatus,
      taskId: decisionTask.id,
      taskCodename: decisionTask.codename || formatTaskCodename(decisionTask.id),
      deduped: false
    });
  }
  if (commandStatus.action !== "auto_queue") {
    return finalizeMailCommandStatus(effectiveMessage, commandStatus);
  }
  const existingTask = await findRecentDuplicateQueuedTask({
    message: commandStatus.text,
    sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
    requestedBrainId: "worker",
    intakeBrainId: "bitnet"
  });
  if (existingTask) {
    return finalizeMailCommandStatus(effectiveMessage, {
      ...commandStatus,
      taskId: existingTask.id,
      taskCodename: existingTask.codename || formatTaskCodename(existingTask.id),
      deduped: true,
      reason: `Matched existing queued task ${existingTask.codename || existingTask.id}.`
    });
  }
  const task = await createQueuedTask({
    message: commandStatus.text,
    sessionId: `mail:${String(effectiveMessage.agentId || "nova").trim()}`,
    requestedBrainId: "worker",
    intakeBrainId: "bitnet",
    internetEnabled: true,
    selectedMountIds: observerConfig.defaults.mountIds,
    forceToolUse: true,
    requireWorkerPreflight: true,
    notes: `Queued from trusted email command sent by ${describeSourceTrust(effectiveMessage.sourceIdentity)}.`,
    taskMeta: {
      sourceIdentity: normalizeSourceIdentityRecord({
        ...(effectiveMessage.sourceIdentity || {}),
        command: commandStatus
      }, { preserveTrustLevel: true }),
      sourceMessageId: String(effectiveMessage.id || "").trim(),
      sourceKind: "email"
    }
  });
  return finalizeMailCommandStatus(effectiveMessage, {
    ...commandStatus,
    taskId: task.id,
    taskCodename: task.codename || formatTaskCodename(task.id),
    deduped: false
  });
}

async function loadMailQuarantineLog() {
  try {
    const raw = await fs.readFile(MAIL_QUARANTINE_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    mailState.quarantinedMessages = Array.isArray(parsed?.messages)
      ? parsed.messages.map((entry) => ({
          id: String(entry?.id || "").trim(),
          uid: Number(entry?.uid || 0),
          agentId: String(entry?.agentId || "").trim(),
          subject: String(entry?.subject || "").trim(),
          fromAddress: String(entry?.fromAddress || "").trim(),
          destination: String(entry?.destination || "").trim(),
          quarantinedAt: Number(entry?.quarantinedAt || 0),
          reasons: Array.isArray(entry?.reasons) ? entry.reasons.map((value) => String(value || "").trim()).filter(Boolean) : [],
          likelyPhishing: entry?.likelyPhishing === true,
          likelySpam: entry?.likelySpam === true
        })).filter((entry) => entry.id)
      : [];
  } catch {
    mailState.quarantinedMessages = [];
  }
}

async function saveMailQuarantineLog() {
  const messages = (Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages : [])
    .sort((a, b) => Number(b.quarantinedAt || 0) - Number(a.quarantinedAt || 0))
    .slice(0, 200);
  mailState.quarantinedMessages = messages;
  await writeVolumeText(MAIL_QUARANTINE_LOG_PATH, `${JSON.stringify({ messages }, null, 2)}\n`);
}

async function tryAutoQuarantineMailMessage(client, message) {
  const triage = message?.triage || {};
  const destination = String(triage.autoMoveDestination || "").trim().toLowerCase();
  if (!destination) {
    return { moved: false, destination: "" };
  }
  const specialUseFlag = destination === "archive" ? "\\Archive" : destination === "trash" ? "\\Trash" : "";
  if (!specialUseFlag) {
    return { moved: false, destination: "" };
  }
  const destinationPath = await resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing: true });
  if (!destinationPath) {
    return { moved: false, destination: "" };
  }
  const result = await client.messageMove(Number(message.uid || 0), destinationPath, { uid: true });
  if (result === false) {
    return { moved: false, destination: "" };
  }
  mailState.quarantinedMessages = [
    {
      id: String(message.id || "").trim(),
      uid: Number(message.uid || 0),
      agentId: String(message.agentId || "").trim(),
      subject: String(message.subject || "").trim(),
      fromAddress: String(message.fromAddress || "").trim(),
      destination,
      quarantinedAt: Date.now(),
      reasons: Array.isArray(triage.reasons) ? triage.reasons : [],
      likelyPhishing: triage.likelyPhishing === true,
      likelySpam: triage.likelySpam === true
    },
    ...(Array.isArray(mailState.quarantinedMessages) ? mailState.quarantinedMessages : []).filter((entry) => String(entry.id || "") !== String(message.id || ""))
  ].slice(0, 200);
  await saveMailQuarantineLog();
  return { moved: true, destination };
}

async function fetchRecentMessagesForAgent(agent, { limit = 10, minUid = 0, emitEvents = false, initializeOnly = false } = {}) {
  if (!await hasImapCredentials(agent)) {
    return [];
  }
  return withImapClient(agent, async (client) => {
    let fetchedMessages = [];
    let highestUid = Number(minUid || 0);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ all: true }, { uid: true });
      const sorted = [...allUids].sort((a, b) => a - b);
      highestUid = sorted.length ? sorted[sorted.length - 1] : Number(minUid || 0);
      const targetUids = initializeOnly
        ? sorted.slice(-Math.max(1, Math.min(Number(limit || 10), 20)))
        : sorted.filter((uid) => Number(uid) > Number(minUid || 0));
      if (targetUids.length) {
        for await (const msg of client.fetch(targetUids, { envelope: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source);
          fetchedMessages.push(normalizeMailMessage(agent, msg.uid, msg.envelope, parsed));
        }
      }
    } finally {
      lock.release();
    }

    fetchedMessages.sort((left, right) => Number(left.receivedAt || 0) - Number(right.receivedAt || 0));
    const messages = [];
    const quarantined = [];
    for (const message of fetchedMessages) {
      let workingMessage = message;
      if (typeof pluginManager?.runHook === "function") {
        try {
          const hookResult = await pluginManager.runHook("mail:message-received", {
            message: workingMessage,
            initializeOnly: initializeOnly === true,
            agentId: String(agent?.id || "").trim()
          });
          if (hookResult?.message && typeof hookResult.message === "object") {
            workingMessage = hookResult.message;
          }
        } catch {
          // Plugin hooks should never block mail processing.
        }
      }
      if (!initializeOnly) {
        const commandStatus = await handleIncomingMailCommand(workingMessage);
        if (commandStatus.detected) {
          workingMessage.command = {
            ...(workingMessage.command || {}),
            ...commandStatus
          };
        }
        const quarantineResult = await tryAutoQuarantineMailMessage(client, workingMessage);
        if (quarantineResult.moved) {
          quarantined.push({
            ...workingMessage,
            quarantinedTo: quarantineResult.destination
          });
          continue;
        }
      }
      messages.push(workingMessage);
    }

    if (initializeOnly) {
      mailState.highestUidByAgent[agent.id] = Number(highestUid || 0);
    } else if (highestUid > Number(mailState.highestUidByAgent[agent.id] || 0)) {
      mailState.highestUidByAgent[agent.id] = Number(highestUid || 0);
    }

    if (messages.length) {
      const existing = mailState.recentMessages.filter((entry) => entry.agentId !== agent.id);
      const merged = [...existing, ...mailState.recentMessages.filter((entry) => entry.agentId === agent.id), ...messages];
      const deduped = new Map();
      for (const message of merged) {
        deduped.set(message.id, message);
      }
      mailState.recentMessages = [...deduped.values()]
        .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0))
        .slice(0, 40);
    }
    if (quarantined.length) {
      mailState.recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
        .filter((entry) => !quarantined.some((item) => String(item.id || "") === String(entry.id || "")));
    }

    if (emitEvents && !initializeOnly) {
      for (const message of messages) {
        broadcastObserverEvent({
          type: "mail.message",
          mail: message
        });
      }
      for (const message of quarantined) {
        broadcastObserverEvent({
          type: "mail.quarantined",
          mail: {
            ...sanitizeMailForNotification(message),
            quarantinedTo: String(message?.quarantinedTo || "").trim(),
            notice: buildTrashedMailNotice(message)
          }
        });
      }
    }

    if (!initializeOnly) {
      await runMailWatchRulesNow({ source: "mail_grab" });
      await reconcileMailWatchWaitingQuestions();
    }

    mailState.lastCheckAt = Date.now();
    mailState.lastError = "";
    return messages;
  });
}

async function pollActiveMailbox({ emitEvents = true } = {}) {
  if (mailPollInFlight) {
    return [];
  }
  const agent = getActiveMailAgent();
  if (!await hasImapCredentials(agent)) {
    return [];
  }
  mailPollInFlight = true;
  commitMailPollInFlight();
  try {
    const knownUid = Number(mailState.highestUidByAgent[agent.id] || 0);
    if (!knownUid) {
      await fetchRecentMessagesForAgent(agent, { limit: 10, initializeOnly: true });
      return [];
    }
    return await fetchRecentMessagesForAgent(agent, { minUid: knownUid, emitEvents });
  } catch (error) {
    mailState.lastCheckAt = Date.now();
    mailState.lastError = error.message;
    broadcast(`[observer] mail poll error: ${error.message}`);
    return [];
  } finally {
    mailPollInFlight = false;
    commitMailPollInFlight();
  }
}

function looksLikeEmailAddress(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function sendAgentMail({ toEmail, subject, text }) {
  refreshObserverConfig();
  const fromAgent = getActiveMailAgent();
  const directEmail = String(toEmail || "").trim();
  if (!await hasMailCredentials(fromAgent)) {
    throw new Error("active mailbox is not fully configured");
  }
  if (!looksLikeEmailAddress(directEmail)) {
    throw new Error("destination mailbox is not configured");
  }
  const destinationEmail = directEmail;
  const destinationLabel = destinationEmail;
  const auth = await resolveMailAuth(fromAgent);
  const transporter = nodemailer.createTransport({
    host: observerConfig.mail.smtp.host,
    port: observerConfig.mail.smtp.port,
    secure: observerConfig.mail.smtp.secure === true,
    requireTLS: observerConfig.mail.smtp.requireTLS !== false,
    auth
  });
  const info = await transporter.sendMail({
    from: `"${fromAgent.label}" <${fromAgent.email}>`,
    to: `"${destinationLabel}" <${destinationEmail}>`,
    subject: String(subject || "").trim() || `Message from ${fromAgent.label}`,
    text: String(text || "").trim()
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    from: fromAgent.email,
    to: destinationEmail
  };
}

async function toolSendMail(args = {}) {
  const toEmail = String(args.toEmail || args.email || args.to || "").trim();
  const subject = String(args.subject || "").trim();
  const text = String(args.text || args.body || "").trim();
  if (!looksLikeEmailAddress(toEmail)) {
    throw new Error("toEmail is required");
  }
  if (!text) {
    throw new Error("text is required");
  }
  const result = await sendAgentMail({
    toEmail,
    subject,
    text
  });
  return {
    ...result,
    subject: subject || `Message from ${getActiveMailAgent()?.label || "Nova"}`,
    text
  };
}

function findRecentMailMatch({
  messageId = "",
  uid = 0,
  subjectContains = "",
  fromContains = "",
  latest = false
} = {}) {
  const activeAgentId = String(getActiveMailAgent()?.id || "").trim();
  const recent = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
    .filter((message) => String(message.agentId || "") === activeAgentId)
    .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
  if (!recent.length) {
    return null;
  }
  const normalizedMessageId = String(messageId || "").trim();
  if (normalizedMessageId) {
    return recent.find((message) => String(message.id || "").trim() === normalizedMessageId) || null;
  }
  const numericUid = Number(uid || 0);
  if (numericUid > 0) {
    return recent.find((message) => Number(message.uid || 0) === numericUid) || null;
  }
  const normalizedSubject = String(subjectContains || "").trim().toLowerCase();
  if (normalizedSubject) {
    return recent.find((message) => String(message.subject || "").toLowerCase().includes(normalizedSubject)) || null;
  }
  const normalizedFrom = String(fromContains || "").trim().toLowerCase();
  if (normalizedFrom) {
    return recent.find((message) => {
      const fromName = String(message.fromName || "").toLowerCase();
      const fromAddress = String(message.fromAddress || "").toLowerCase();
      return fromName.includes(normalizedFrom) || fromAddress.includes(normalizedFrom);
    }) || null;
  }
  if (latest || recent.length === 1) {
    return recent[0];
  }
  return null;
}

async function resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing = false } = {}) {
  const folders = await client.list();
  const direct = folders.find((folder) => String(folder.specialUse || "") === specialUseFlag);
  if (direct?.path) {
    return String(direct.path);
  }
  const fallbackNamesByUse = {
    "\\Trash": ["Trash", "Deleted Items", "Deleted Messages"],
    "\\Archive": ["Archive", "Archives", "All Mail"]
  };
  const fallbackNames = fallbackNamesByUse[specialUseFlag] || [];
  const fallback = folders.find((folder) => fallbackNames.some((name) => String(folder.path || "").toLowerCase() === name.toLowerCase()));
  if (fallback?.path) {
    return String(fallback.path).trim();
  }
  if (!createIfMissing || !fallbackNames.length) {
    return "";
  }
  const createPath = fallbackNames[0];
  try {
    await client.mailboxCreate(createPath);
  } catch {
    // ignore create failure here; we'll re-check below
  }
  const refreshedFolders = await client.list();
  const created = refreshedFolders.find((folder) => String(folder.path || "").toLowerCase() === createPath.toLowerCase());
  return String(created?.path || "").trim();
}

async function moveAgentMail({ destination = "trash", messageId = "", uid = 0, subjectContains = "", fromContains = "", latest = false } = {}) {
  const agent = getActiveMailAgent();
  if (!await hasImapCredentials(agent)) {
    throw new Error("active mailbox is not fully configured");
  }
  const targetMessage = findRecentMailMatch({ messageId, uid, subjectContains, fromContains, latest });
  if (!targetMessage) {
    throw new Error("matching recent email was not found");
  }
  const normalizedDestination = String(destination || "").trim().toLowerCase();
  const specialUseFlag = normalizedDestination === "archive" ? "\\Archive" : normalizedDestination === "trash" ? "\\Trash" : "";
  if (!specialUseFlag) {
    throw new Error("destination must be trash or archive");
  }
  return withImapClient(agent, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const destinationPath = await resolveSpecialUseMailbox(client, specialUseFlag, { createIfMissing: true });
      if (!destinationPath) {
        throw new Error(`${normalizedDestination} mailbox is not configured on the server`);
      }
      const result = await client.messageMove(Number(targetMessage.uid), destinationPath, { uid: true });
      mailState.recentMessages = (Array.isArray(mailState.recentMessages) ? mailState.recentMessages : [])
        .filter((message) => String(message.id || "") !== String(targetMessage.id || ""));
      mailState.lastCheckAt = Date.now();
      mailState.lastError = "";
      return {
        action: normalizedDestination,
        moved: Boolean(result !== false),
        destination: destinationPath,
        id: targetMessage.id,
        uid: Number(targetMessage.uid || 0),
        subject: String(targetMessage.subject || ""),
        fromAddress: String(targetMessage.fromAddress || "")
      };
    } finally {
      lock.release();
    }
  });
}

async function toolMoveMail(args = {}) {
  const destination = String(args.destination || args.action || "").trim().toLowerCase();
  const messageId = String(args.messageId || args.id || "").trim();
  const uid = Number(args.uid || 0);
  const subjectContains = String(args.subjectContains || args.subject || "").trim();
  const fromContains = String(args.fromContains || args.from || args.sender || "").trim();
  const latest = args.latest === true || String(args.latest || "").trim().toLowerCase() === "true";
  if (!destination) {
    throw new Error("destination is required");
  }
  const result = await moveAgentMail({
    destination,
    messageId,
    uid,
    subjectContains,
    fromContains,
    latest
  });
  return result;
}

  return {
    loadDocumentRulesState,
    saveDocumentRulesState,
    migrateLegacyMailPassword,
    resolveMailPassword,
    hasMailPassword,
    resolveMailAuth,
    loadMailWatchRulesState,
    saveMailWatchRulesState,
    getMailAgents,
    // Exposes the local in-memory mail state (recentMessages, lastCheckAt/lastError,
    // highestUidByAgent, ...) as a live accessor — mail-plugin.js's /api/mail/status route
    // expects a callable getMailState(), not the raw mailState object, matching the same
    // accessor convention as getObserverConfig/getMailWatchRulesState above. This was
    // simply never added, leaving that route permanently 503ing.
    getMailState: () => mailState,
    hasImapCredentials,
    hasMailCredentials,
    looksLikeEmailAddress,
    getActiveMailAgent,
    buildMailStatus,
    resolveMailWatchNotifyEmail,
    forwardMailToUser,
    sendUnsureMailDigest,
    getMailWatchRule,
    findMailWatchWaitingTask,
    buildMailWatchSingleQuestion,
    handleMailWatchWaitingAnswer,
    reconcileMailWatchWaitingQuestions,
    upsertMailWatchRule,
    resolveMailCommandSourceIdentity,
    buildMailCommandRecord,
    refreshRecentMailTrustForSource,
    classifyMailMessage,
    determineMailCommandAction,
    handleIncomingMailCommand,
    loadMailQuarantineLog,
    saveMailQuarantineLog,
    fetchRecentMessagesForAgent,
    pollActiveMailbox,
    sendAgentMail,
    moveAgentMail,
    toolSendMail,
    toolMoveMail,
    parseDirectMailRequest,
    parseStandingMailWatchRequest,
    isDefinitelyGoodMail,
    isDefinitelyBadMail,
    summarizeMailForUser,
    findRecentMailMatch,
    resolveSpecialUseMailbox,
    parseMailWatchRuleAnswerIntent,
    parseMailWatchAnswerAction,
    buildMailWatchActionRuleFromMessage,
    buildMailWatchActionRuleFromMatch,
    normalizeMailWatchRuleAction,
    normalizeMailWatchRuleMatch,
    hasMailWatchRuleMatch,
    describeMailWatchRuleMatch,
    isExplicitMailWatchActionRule
  };
}
