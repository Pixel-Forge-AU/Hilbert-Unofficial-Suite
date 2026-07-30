import { compactText } from "../../../observer-general-utils.js";

function createCalendarEventId() {
  return `cal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseTs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) return Number(fallback || 0);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function normalizeRepeat(repeat = {}, { allowNone = true } = {}) {
  const frequency = String(repeat?.frequency || "none").trim().toLowerCase();
  const normalizedFrequency = ["none", "daily", "weekly", "monthly", "yearly"].includes(frequency) ? frequency : "none";
  const interval = Math.max(1, Math.min(Number(repeat?.interval || 1) || 1, 365));
  if (normalizedFrequency === "none" && !allowNone) return { frequency: "daily", interval };
  return { frequency: normalizedFrequency, interval };
}

function advanceOccurrence(startAt, repeat, occurrenceAt) {
  const normalizedRepeat = normalizeRepeat(repeat);
  if (normalizedRepeat.frequency === "none") return 0;
  const base = new Date(Number(occurrenceAt || startAt || 0));
  if (!Number.isFinite(base.getTime()) || base.getTime() <= 0) return 0;
  const next = new Date(base.getTime());
  if (normalizedRepeat.frequency === "daily") next.setDate(next.getDate() + normalizedRepeat.interval);
  else if (normalizedRepeat.frequency === "weekly") next.setDate(next.getDate() + (normalizedRepeat.interval * 7));
  else if (normalizedRepeat.frequency === "monthly") next.setMonth(next.getMonth() + normalizedRepeat.interval);
  else if (normalizedRepeat.frequency === "yearly") next.setFullYear(next.getFullYear() + normalizedRepeat.interval);
  return next.getTime();
}

function computeNextOccurrenceAt(event = {}, referenceNow = Date.now()) {
  const startAt = Number(event?.startAt || 0);
  const repeat = normalizeRepeat(event?.repeat);
  if (!startAt) return 0;
  if (repeat.frequency === "none") return startAt;
  const floor = Math.max(0, Number(referenceNow || 0));
  if (startAt >= floor) return startAt;
  // For fixed-length intervals (daily/weekly), jump directly to the first future occurrence
  if (repeat.frequency === "daily" || repeat.frequency === "weekly") {
    const stepMs = repeat.interval * (repeat.frequency === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000;
    const steps = Math.ceil((floor - startAt) / stepMs);
    return startAt + steps * stepMs;
  }
  // For variable-length intervals (monthly/yearly), iterate — bounded tightly by realistic calendar range
  let occurrenceAt = startAt;
  for (let i = 0; i < 200; i += 1) {
    const next = advanceOccurrence(startAt, repeat, occurrenceAt);
    if (!next || next <= occurrenceAt) break;
    occurrenceAt = next;
    if (occurrenceAt >= floor) return occurrenceAt;
  }
  return occurrenceAt;
}

function normalizeAction(action = {}, { mountIds = [] } = {}) {
  return {
    enabled: action?.enabled === true,
    message: compactText(String(action?.message || "").trim(), 4000),
    requestedBrainId: String(action?.requestedBrainId || "worker").trim() || "worker",
    internetEnabled: action?.internetEnabled !== false,
    forceToolUse: action?.forceToolUse === true,
    mountIds: Array.isArray(action?.mountIds) ? action.mountIds : mountIds
  };
}

function materializeCalendarEvent(event = {}, defaults = {}) {
  const startAt = parseTs(event.startAt, 0);
  const endAt = parseTs(event.endAt, 0);
  const repeat = normalizeRepeat(event.repeat);
  const status = ["active", "completed", "cancelled"].includes(String(event.status || "").trim().toLowerCase()) ? String(event.status || "").trim().toLowerCase() : "active";
  const action = normalizeAction(event.action, defaults);
  const nextOccurrenceAt = status === "active" ? Number(event.nextOccurrenceAt || computeNextOccurrenceAt({ startAt, repeat }, Date.now()) || 0) : 0;
  return {
    id: String(event.id || "").trim() || createCalendarEventId(),
    title: compactText(String(event.title || "").trim(), 160) || "Untitled event",
    description: compactText(String(event.description || "").trim(), 4000),
    location: compactText(String(event.location || "").trim(), 240),
    type: String(event.type || "personal").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal",
    status,
    allDay: event.allDay === true,
    startAt,
    endAt: endAt > startAt ? endAt : 0,
    repeat,
    action,
    createdAt: Number(event.createdAt || Date.now()),
    updatedAt: Number(event.updatedAt || Date.now()),
    completedAt: Number(event.completedAt || 0) || undefined,
    cancelledAt: Number(event.cancelledAt || 0) || undefined,
    nextOccurrenceAt,
    lastTriggeredAt: Number(event.lastTriggeredAt || 0) || undefined,
    lastQueuedOccurrenceAt: Number(event.lastQueuedOccurrenceAt || 0) || undefined,
    lastActionTaskId: String(event.lastActionTaskId || "").trim() || undefined
  };
}

function normalizeTodoItem(record = {}) {
  const now = Date.now();
  const status = String(record.status || "").trim().toLowerCase() === "completed" ? "completed" : "open";
  const text = compactText(String(record.text || "").trim(), 400);
  const fallbackId = `todo-${now}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    id: String(record.id || "").trim() || fallbackId,
    text,
    status,
    createdAt: Number(record.createdAt || now) || now,
    updatedAt: Number(record.updatedAt || record.createdAt || now) || now,
    completedAt: status === "completed" ? Number(record.completedAt || record.updatedAt || now) || now : 0,
    createdBy: String(record.createdBy || "").trim().toLowerCase() === "nova" ? "nova" : "user",
    source: compactText(String(record.source || "manual").trim(), 80),
    linkedTaskId: String(record.linkedTaskId || "").trim(),
    linkedTaskCodename: String(record.linkedTaskCodename || "").trim(),
    linkedQuestion: compactText(String(record.linkedQuestion || "").trim(), 1000),
    completionNote: compactText(String(record.completionNote || "").trim(), 1000),
    resumedTaskId: String(record.resumedTaskId || "").trim()
  };
}

function normalizeTodoState(state = {}) {
  const items = Array.isArray(state?.items) ? state.items.map((entry) => normalizeTodoItem(entry)).filter((entry) => entry.text) : [];
  const meta = state?.meta && typeof state.meta === "object" ? state.meta : {};
  return { version: 1, items, meta: { lastReminderAt: Number(meta.lastReminderAt || 0) || 0 } };
}

function sortTodoItems(items = []) {
  return [...items].sort((left, right) => {
    const leftOpen = String(left?.status || "") !== "completed";
    const rightOpen = String(right?.status || "") !== "completed";
    if (leftOpen !== rightOpen) return Number(rightOpen) - Number(leftOpen);
    const leftTs = Number(leftOpen ? (left?.updatedAt || left?.createdAt || 0) : (left?.completedAt || left?.updatedAt || left?.createdAt || 0));
    const rightTs = Number(rightOpen ? (right?.updatedAt || right?.createdAt || 0) : (right?.completedAt || right?.updatedAt || right?.createdAt || 0));
    return rightTs - leftTs;
  });
}

function summarizeCalendarEvent(event = {}) {
  const ts = Number(event.nextOccurrenceAt || event.startAt || 0);
  const when = event.allDay ? new Date(ts).toLocaleDateString() : new Date(ts).toLocaleString();
  return `${event.title || "Untitled event"} (${event.type === "nova_action" || event.action?.enabled ? "nova action" : "personal"}) on ${when}${event.location ? ` at ${event.location}` : ""}`;
}
function normalizeTodoReference(value = "") {
  return String(value || "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/[.?!]+$/g, "").trim();
}

function matchesCalendarEventReference(event = {}, reference = {}) {
  const eventId = String(reference?.eventId || "").trim();
  const titleContains = String(reference?.titleContains || "").trim().toLowerCase();
  const date = String(reference?.date || "").trim().slice(0, 10);
  const status = String(reference?.status || "").trim().toLowerCase();
  if (eventId && String(event.id || "").trim() !== eventId) return false;
  if (titleContains) {
    const haystack = `${String(event.title || "")} ${String(event.description || "")}`.toLowerCase();
    if (!haystack.includes(titleContains)) return false;
  }
  if (date && new Date(Number(event.nextOccurrenceAt || event.startAt || 0)).toISOString().slice(0, 10) !== date) return false;
  if (status && String(event.status || "").trim().toLowerCase() !== status) return false;
  return true;
}

function normalizeCalendarToolEventInput(args = {}, defaultMountIds = []) {
  const repeatFrequency = String(args.repeatFrequency || args.repeat?.frequency || "none").trim().toLowerCase();
  return {
    title: compactText(String(args.title || "").trim(), 160),
    description: compactText(String(args.description || "").trim(), 4000),
    location: compactText(String(args.location || "").trim(), 240),
    type: String(args.type || "").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal",
    allDay: args.allDay === true,
    startAt: parseTs(args.startAt, 0),
    endAt: parseTs(args.endAt, 0),
    repeat: {
      frequency: ["none", "daily", "weekly", "monthly", "yearly"].includes(repeatFrequency) ? repeatFrequency : "none",
      interval: Math.max(1, Math.min(Number(args.repeatInterval || args.repeat?.interval || 1) || 1, 365))
    },
    action: {
      enabled: args.actionEnabled === true || String(args.type || "").trim().toLowerCase() === "nova_action",
      message: compactText(String(args.actionMessage || args.action?.message || "").trim(), 4000),
      requestedBrainId: String(args.requestedBrainId || args.action?.requestedBrainId || "worker").trim() || "worker",
      internetEnabled: args.internetEnabled !== false,
      forceToolUse: args.forceToolUse === true,
      mountIds: Array.isArray(args.mountIds) ? args.mountIds : defaultMountIds
    }
  };
}

function buildCalendarToolEventPatch(args = {}, defaultMountIds = []) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(args, "title")) patch.title = compactText(String(args.title || "").trim(), 160);
  if (Object.prototype.hasOwnProperty.call(args, "description")) patch.description = compactText(String(args.description || "").trim(), 4000);
  if (Object.prototype.hasOwnProperty.call(args, "location")) patch.location = compactText(String(args.location || "").trim(), 240);
  if (Object.prototype.hasOwnProperty.call(args, "type")) patch.type = String(args.type || "").trim().toLowerCase() === "nova_action" ? "nova_action" : "personal";
  if (Object.prototype.hasOwnProperty.call(args, "allDay")) patch.allDay = args.allDay === true;
  if (Object.prototype.hasOwnProperty.call(args, "startAt")) patch.startAt = parseTs(args.startAt, 0);
  if (Object.prototype.hasOwnProperty.call(args, "endAt")) patch.endAt = parseTs(args.endAt, 0);
  if (Object.prototype.hasOwnProperty.call(args, "repeatFrequency") || Object.prototype.hasOwnProperty.call(args, "repeatInterval") || (args.repeat && typeof args.repeat === "object")) {
    const rawFrequency = String(args.repeatFrequency || args.repeat?.frequency || "none").trim().toLowerCase();
    patch.repeat = {
      frequency: ["none", "daily", "weekly", "monthly", "yearly"].includes(rawFrequency) ? rawFrequency : "none",
      interval: Math.max(1, Math.min(Number(args.repeatInterval || args.repeat?.interval || 1) || 1, 365))
    };
  }
  if (Object.prototype.hasOwnProperty.call(args, "actionEnabled") || Object.prototype.hasOwnProperty.call(args, "actionMessage") || Object.prototype.hasOwnProperty.call(args, "requestedBrainId") || Object.prototype.hasOwnProperty.call(args, "internetEnabled") || Object.prototype.hasOwnProperty.call(args, "forceToolUse") || Object.prototype.hasOwnProperty.call(args, "mountIds") || (args.action && typeof args.action === "object")) {
    patch.action = {
      enabled: args.actionEnabled === true || String(args.type || "").trim().toLowerCase() === "nova_action",
      message: compactText(String(args.actionMessage || args.action?.message || "").trim(), 4000),
      requestedBrainId: String(args.requestedBrainId || args.action?.requestedBrainId || "worker").trim() || "worker",
      internetEnabled: args.internetEnabled !== false,
      forceToolUse: args.forceToolUse === true,
      mountIds: Array.isArray(args.mountIds) ? args.mountIds : defaultMountIds
    };
  }
  return patch;
}

async function hasCalendarOccurrenceTask(runtime, eventId, occurrenceAt) {
  if (typeof runtime?.listAllTasks !== "function") return false;
  const sets = await runtime.listAllTasks();
  const merged = [
    ...(Array.isArray(sets?.queued) ? sets.queued : []),
    ...(Array.isArray(sets?.waiting) ? sets.waiting : []),
    ...(Array.isArray(sets?.inProgress) ? sets.inProgress : []),
    ...(Array.isArray(sets?.done) ? sets.done : []),
    ...(Array.isArray(sets?.failed) ? sets.failed : [])
  ];
  return merged.some((task) => String(task.calendarEventId || "").trim() === String(eventId || "").trim() && Number(task.calendarOccurrenceAt || 0) === Number(occurrenceAt || 0));
}
export function createCalendarDomain({ dataApi = null, broadcast = () => {}, runtime = {} } = {}) {
  const calendarKey = "calendar-events";
  const todoKey = "todo-list";
  const getDefaultMountIds = () => Array.isArray(runtime?.getObserverConfig?.()?.defaults?.mountIds) ? runtime.getObserverConfig().defaults.mountIds : [];

  async function readCalendarEvents() {
    const saved = dataApi ? await dataApi.readJson(calendarKey, []) : [];
    return (Array.isArray(saved) ? saved : []).filter((entry) => entry && typeof entry === "object").map((entry) => materializeCalendarEvent(entry, { mountIds: getDefaultMountIds() }));
  }

  async function writeCalendarEvents(events = []) {
    const normalized = (Array.isArray(events) ? events : []).filter((entry) => entry && typeof entry === "object").map((entry) => materializeCalendarEvent(entry, { mountIds: getDefaultMountIds() }));
    if (dataApi) await dataApi.writeJson(calendarKey, normalized);
    return normalized;
  }

  async function listCalendarEvents() {
    const events = await readCalendarEvents();
    return events.sort((left, right) => Number(left.nextOccurrenceAt || left.startAt || 0) - Number(right.nextOccurrenceAt || right.startAt || 0));
  }

  async function saveCalendarEvent(eventInput = {}, options = {}) {
    const events = await readCalendarEvents();
    const now = Date.now();
    const idx = events.findIndex((entry) => String(entry.id || "") === String(eventInput.id || ""));
    const existing = idx >= 0 ? events[idx] : null;
    const merged = materializeCalendarEvent({ ...(existing || {}), ...eventInput, createdAt: existing?.createdAt || now, updatedAt: now, nextOccurrenceAt: options.recomputeSchedule === false ? Number(eventInput.nextOccurrenceAt || existing?.nextOccurrenceAt || 0) : undefined }, { mountIds: getDefaultMountIds() });
    if (options.recomputeSchedule !== false) merged.nextOccurrenceAt = merged.status === "active" ? computeNextOccurrenceAt(merged, now) : 0;
    if (idx >= 0) events[idx] = merged; else events.push(merged);
    await writeCalendarEvents(events);
    return merged;
  }

  async function removeCalendarEvent(eventId = "") {
    const id = String(eventId || "").trim();
    if (!id) return false;
    const events = await readCalendarEvents();
    const filtered = events.filter((entry) => String(entry.id || "") !== id);
    if (filtered.length === events.length) return false;
    await writeCalendarEvents(filtered);
    return true;
  }

  async function readTodoState() { return normalizeTodoState(dataApi ? await dataApi.readJson(todoKey, {}) : {}); }
  async function writeTodoState(state = {}) { const normalized = normalizeTodoState(state); if (dataApi) await dataApi.writeJson(todoKey, normalized); return normalized; }

  async function listTodoItems() {
    const state = await readTodoState();
    const items = sortTodoItems(state.items);
    const open = items.filter((entry) => entry.status === "open");
    const completed = items.filter((entry) => entry.status === "completed");
    return { items, open, completed, meta: state.meta, summary: { openCount: open.length, completedCount: completed.length } };
  }

  async function addTodoItem({ text, createdBy = "user", source = "manual", linkedTaskId = "", linkedTaskCodename = "", linkedQuestion = "", completionNote = "" } = {}) {
    const normalizedText = compactText(String(text || "").trim(), 400);
    if (!normalizedText) throw new Error("todo text is required");
    const state = await readTodoState();
    const now = Date.now();
    const dup = state.items.find((entry) => entry.status === "open" && String(entry.text || "").trim().toLowerCase() === normalizedText.toLowerCase() && String(entry.linkedTaskId || "").trim() === String(linkedTaskId || "").trim());
    if (dup) return dup;
    const item = normalizeTodoItem({ id: `todo-${now}-${Math.random().toString(16).slice(2, 8)}`, text: normalizedText, status: "open", createdAt: now, updatedAt: now, createdBy, source, linkedTaskId, linkedTaskCodename, linkedQuestion, completionNote });
    state.items.push(item);
    await writeTodoState(state);
    broadcast({ type: "todo.created", todo: item });
    return item;
  }

  async function setTodoItemStatus(todoId = "", status = "completed", { completedBy = "user", sessionId = "Main" } = {}) {
    const id = String(todoId || "").trim();
    if (!id) throw new Error("todoId is required");
    const target = String(status || "").trim().toLowerCase() === "completed" ? "completed" : "open";
    const state = await readTodoState();
    const idx = state.items.findIndex((entry) => String(entry.id || "") === id);
    if (idx < 0) throw new Error("todo item not found");
    const current = normalizeTodoItem(state.items[idx]);
    const now = Date.now();
    let resumedTask = null;
    const next = { ...current, status: target, updatedAt: now, completedAt: target === "completed" ? now : 0 };
    if (target === "completed" && current.linkedTaskId && !current.resumedTaskId && typeof runtime.answerWaitingTask === "function") {
      try {
        resumedTask = await runtime.answerWaitingTask(current.linkedTaskId, current.completionNote || `User completed todo item: ${current.text}`, sessionId);
        next.resumedTaskId = String(resumedTask?.id || current.linkedTaskId).trim();
        next.source = compactText(`${current.source || "manual"} | completed by ${completedBy}`, 80);
      } catch (error) {
        next.source = compactText(`${current.source || "manual"} | resume failed: ${error?.message || error}`, 80);
      }
    }
    state.items[idx] = normalizeTodoItem(next);
    await writeTodoState(state);
    broadcast({ type: "todo.updated", todo: state.items[idx], resumedTask });
    return { todo: state.items[idx], resumedTask };
  }

  async function removeTodoItem(todoId = "", { removedBy = "user", sessionId = "Main" } = {}) {
    const id = String(todoId || "").trim();
    if (!id) throw new Error("todoId is required");
    const state = await readTodoState();
    const idx = state.items.findIndex((entry) => String(entry.id || "") === id);
    if (idx < 0) throw new Error("todo item not found");
    const [removed] = state.items.splice(idx, 1);
    let closedTask = null;
    if (removed?.linkedTaskId && removed?.status === "open" && typeof runtime.findTaskById === "function" && typeof runtime.closeTaskRecord === "function") {
      try {
        const linkedTask = await runtime.findTaskById(removed.linkedTaskId);
        if (linkedTask && String(linkedTask.status || "").trim() === "waiting_for_user") {
          closedTask = await runtime.closeTaskRecord(linkedTask, `Linked todo removed by ${removedBy} from session ${sessionId}.`);
        }
      } catch { closedTask = null; }
    }
    await writeTodoState(state);
    broadcast({ type: "todo.removed", todo: removed, closedTask });
    return { todo: removed, closedTask };
  }

  async function findCalendarEventsByReference(reference = {}) { return (await readCalendarEvents()).filter((event) => matchesCalendarEventReference(event, reference)); }

  async function buildCalendarSummary({ scope = "upcoming", limit = 10 } = {}) {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const todayStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    let start, end;
    if (scope === "today") {
      start = todayStart;
      end = todayStart + DAY_MS - 1;
    } else if (scope === "tomorrow") {
      start = todayStart + DAY_MS;
      end = todayStart + 2 * DAY_MS - 1;
    } else if (scope === "week") {
      start = todayStart;
      end = todayStart + 7 * DAY_MS - 1;
    } else {
      start = now;
      end = now + 30 * DAY_MS;
    }
    const events = (await readCalendarEvents())
      .filter((event) => {
        const ts = Number(event.nextOccurrenceAt || event.startAt || 0);
        return ts >= start && ts <= end && String(event.status || "") !== "cancelled";
      })
      .slice(0, Math.max(1, Math.min(Number(limit || 10), 30)));
    const scopeLabel = scope === "today" ? "today" : scope === "tomorrow" ? "tomorrow" : scope === "week" ? "this week" : "upcoming";
    if (!events.length) return [`No events ${scopeLabel}.`];
    return [`You have ${events.length} calendar event${events.length === 1 ? "" : "s"} ${scopeLabel}.`, ...events.map((event) => summarizeCalendarEvent(event))];
  }

  async function runDueEvents() {
    if (typeof runtime.createQueuedTask !== "function") return [];
    const events = await readCalendarEvents();
    const now = Date.now();
    const updated = [...events];
    const queued = [];
    for (let i = 0; i < updated.length; i += 1) {
      const event = updated[i];
      if (!event || event.status !== "active" || event.type !== "nova_action" || event.action?.enabled !== true || !Number(event.nextOccurrenceAt || 0) || Number(event.nextOccurrenceAt || 0) > now) continue;
      const occurrenceAt = Number(event.nextOccurrenceAt || 0);
      if (await hasCalendarOccurrenceTask(runtime, event.id, occurrenceAt)) continue;
      const fallbackMessage = `Calendar event action: ${event.title} at ${new Date(occurrenceAt).toLocaleString()}.`;
      const task = await runtime.createQueuedTask({
        message: String(event.action?.message || "").trim() || fallbackMessage,
        sessionId: "calendar",
        requestedBrainId: event.action?.requestedBrainId || "worker",
        intakeBrainId: "bitnet",
        internetEnabled: event.action?.internetEnabled !== false,
        selectedMountIds: Array.isArray(event.action?.mountIds) ? event.action.mountIds : getDefaultMountIds(),
        forceToolUse: event.action?.forceToolUse === true,
        notes: `Queued from calendar event "${event.title}".`,
        taskMeta: { internalJobType: "calendar_event_action", calendarEventId: event.id, calendarOccurrenceAt: occurrenceAt, calendarEventTitle: event.title }
      });
      queued.push(task);
      updated[i] = materializeCalendarEvent({ ...event, updatedAt: now, lastTriggeredAt: now, lastQueuedOccurrenceAt: occurrenceAt, lastActionTaskId: task.id, status: event.repeat?.frequency === "none" ? "completed" : event.status, completedAt: event.repeat?.frequency === "none" ? now : undefined, nextOccurrenceAt: event.repeat?.frequency === "none" ? 0 : computeNextOccurrenceAt({ startAt: event.startAt, repeat: event.repeat }, occurrenceAt + 1) }, { mountIds: getDefaultMountIds() });
    }
    if (queued.length) await writeCalendarEvents(updated);
    return queued;
  }

  async function buildTodoSummaryLines({ limit = 8 } = {}) {
    const { open, completed } = await listTodoItems();
    if (!open.length && !completed.length) return ["You do not have any personal to do items yet."];
    const lines = [open.length ? `You have ${open.length} open to do item${open.length === 1 ? "" : "s"}${completed.length ? ` and ${completed.length} completed.` : "."}` : `You have no open to do items${completed.length ? ` and ${completed.length} completed item${completed.length === 1 ? "" : "s"}.` : "."}`];
    for (const item of open.slice(0, Math.max(1, Number(limit || 8)))) lines.push(`- ${item.text}`);
    if (open.length > limit) lines.push(`- ${open.length - limit} more open item${open.length - limit === 1 ? "" : "s"}.`);
    return lines;
  }

  async function findTodoItemByReference(reference = "") {
    const normalized = normalizeTodoReference(reference).toLowerCase();
    if (!normalized) return null;
    const { items } = await listTodoItems();
    return items.find((entry) => String(entry.id || "").toLowerCase() === normalized)
      || items.find((entry) => String(entry.text || "").trim().toLowerCase() === normalized)
      || items.find((entry) => String(entry.text || "").trim().toLowerCase().includes(normalized))
      || null;
  }

  async function maybeEmitTodoReminder({ force = false, minIntervalMs = 60 * 60 * 1000 } = {}) {
    const state = await readTodoState();
    const open = state.items.filter((entry) => entry.status === "open");
    if (!open.length) return null;
    const now = Date.now();
    if (!force && now - Number(state.meta.lastReminderAt || 0) < Math.max(1, Number(minIntervalMs || 0))) return null;
    state.meta.lastReminderAt = now;
    await writeTodoState(state);
    const text = `You have ${open.length} open to do item${open.length === 1 ? "" : "s"}.`;
    broadcast({ type: "todo.reminder", text, summary: { openCount: open.length }, todos: open.slice(0, 3) });
    return { text, open };
  }

  return {
    parseTs,
    summarizeCalendarEvent,
    normalizeCalendarToolEventInput,
    buildCalendarToolEventPatch,
    readCalendarEvents,
    writeCalendarEvents,
    listCalendarEvents,
    saveCalendarEvent,
    removeCalendarEvent,
    findCalendarEventsByReference,
    buildCalendarSummary,
    runDueEvents,
    readTodoState,
    writeTodoState,
    listTodoItems,
    addTodoItem,
    setTodoItemStatus,
    removeTodoItem,
    buildTodoSummaryLines,
    findTodoItemByReference,
    maybeEmitTodoReminder
  };
}
