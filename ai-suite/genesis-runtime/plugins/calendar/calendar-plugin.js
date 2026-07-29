/**
 * Plugin Name: Calendar
 * Plugin Slug: calendar
 * Description: Calendar and to-do UI tab packaged as an optional plugin.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCalendarDomain } from "./lib/calendar-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseTs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return Number(fallback || 0);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

async function withTransaction({ coreTransactions, taskId, toolCallId, proposal, getSuccessNotes, failureClass }, operation) {
  let txnId = "";
  if (coreTransactions && taskId) {
    const txn = await coreTransactions.proposeExternalSideEffectTransaction(proposal, { taskId, toolCallId }).catch(() => null);
    txnId = String(txn?.id || "").trim();
  }
  try {
    const result = await operation();
    if (txnId && coreTransactions) {
      const notes = typeof getSuccessNotes === "function" ? getSuccessNotes(result) : String(getSuccessNotes || "ok");
      coreTransactions.completeExternalTransaction(txnId, { ok: true, actor: "worker", notes }).catch(() => {});
    }
    return result;
  } catch (error) {
    if (txnId && coreTransactions) {
      coreTransactions.completeExternalTransaction(txnId, { ok: false, error: String(error?.message || ""), failureClass }).catch(() => {});
    }
    throw error;
  }
}

export function createCalendarPlugin(options = {}) {
  const {
    pluginId = "calendar",
    pluginName = "Calendar",
    description = "Calendar and to-do plugin UI."
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
        uiPanels: true,
        data: true,
        tools: [
          "get_calendar_summary",
          "find_calendar_events",
          "create_calendar_event",
          "update_calendar_event",
          "remove_calendar_event",
          "set_calendar_event_state"
        ],
        capabilities: [
          "subsystem:classify",
          "calendar.readEvents",
          "calendar.writeEvents",
          "calendar.listEvents",
          "calendar.saveEvent",
          "calendar.removeEvent",
          "calendar.findEventsByReference",
          "calendar.normalizeToolEventInput",
          "calendar.buildToolEventPatch",
          "calendar.summarizeEvent",
          "calendar.buildSummary",
          "calendar.runDueEvents",
          "todo.readState",
          "todo.writeState",
          "todo.listItems",
          "todo.addItem",
          "todo.setItemStatus",
          "todo.removeItem",
          "todo.buildSummaryLines",
          "todo.findByReference",
          "todo.maybeEmitReminder"
        ],
        hooks: [
          "intake:tools:list",
          "intake:tool-call",
          "runtime:startup",
          "runtime:tick:cron",
          "runtime:tick:5m"
        ],
        runtimeContext: [
          "noteInteractiveActivity",
          "answerWaitingTask",
          "findTaskById",
          "closeTaskRecord",
          "createQueuedTask",
          "listAllTasks",
          "getObserverConfig",
          "coreTransactions"
        ]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      const runtime = api.getRuntimeContext();
      const domain = createCalendarDomain({
        dataApi: api.data,
        broadcast: (event) => api.broadcast(event),
        runtime
      });
      api.provideCapability("calendar.readEvents", () => domain.readCalendarEvents());
      api.provideCapability("calendar.writeEvents", (events = []) => domain.writeCalendarEvents(events));
      api.provideCapability("calendar.listEvents", () => domain.listCalendarEvents());
      api.provideCapability("calendar.saveEvent", (eventInput = {}, options = {}) => domain.saveCalendarEvent(eventInput, options));
      api.provideCapability("calendar.removeEvent", (eventId = "") => domain.removeCalendarEvent(eventId));
      api.provideCapability("calendar.findEventsByReference", (reference = {}) => domain.findCalendarEventsByReference(reference));
      api.provideCapability("calendar.normalizeToolEventInput", (args = {}) => domain.normalizeCalendarToolEventInput(args, runtime?.getObserverConfig?.()?.defaults?.mountIds || []));
      api.provideCapability("calendar.buildToolEventPatch", (args = {}) => domain.buildCalendarToolEventPatch(args, runtime?.getObserverConfig?.()?.defaults?.mountIds || []));
      api.provideCapability("calendar.summarizeEvent", (event = {}) => domain.summarizeCalendarEvent(event));
      api.provideCapability("calendar.buildSummary", (options = {}) => domain.buildCalendarSummary(options));
      api.provideCapability("calendar.runDueEvents", () => domain.runDueEvents());
      api.provideCapability("todo.readState", () => domain.readTodoState());
      api.provideCapability("todo.writeState", (state = {}) => domain.writeTodoState(state));
      api.provideCapability("todo.listItems", () => domain.listTodoItems());
      api.provideCapability("todo.addItem", (payload = {}) => domain.addTodoItem(payload));
      api.provideCapability("todo.setItemStatus", (todoId = "", status = "completed", options = {}) =>
        domain.setTodoItemStatus(todoId, status, options)
      );
      api.provideCapability("todo.removeItem", (todoId = "", options = {}) => domain.removeTodoItem(todoId, options));
      api.provideCapability("todo.buildSummaryLines", (options = {}) => domain.buildTodoSummaryLines(options));
      api.provideCapability("todo.findByReference", (reference = "") => domain.findTodoItemByReference(reference));
      api.provideCapability("todo.maybeEmitReminder", (options = {}) => domain.maybeEmitTodoReminder(options));
      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "get_calendar_summary", description: "Get a summary of calendar events for today, tomorrow, this week, or upcoming events.", scopes: ["intake"], risk: "normal", parameters: { scope: "today|tomorrow|week|upcoming", limit: "number" } });
        api.registerTool({ name: "find_calendar_events", description: "Find calendar events by id, partial title, date (YYYY-MM-DD), or status.", scopes: ["intake"], risk: "normal", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } });
        api.registerTool({ name: "create_calendar_event", description: "Create a calendar event, optionally repeating and optionally configured as a Nova action.", scopes: ["intake"], risk: "normal", parameters: { title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } });
        api.registerTool({ name: "update_calendar_event", description: "Update an existing calendar event by eventId or by matching titleContains plus optional date.", scopes: ["intake"], risk: "normal", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } });
        api.registerTool({ name: "remove_calendar_event", description: "Remove a calendar event by eventId or by matching titleContains plus optional date.", scopes: ["intake"], risk: "normal", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD" } });
        api.registerTool({ name: "set_calendar_event_state", description: "Mark a calendar event active, completed, or cancelled by eventId or matching titleContains plus optional date.", scopes: ["intake"], risk: "normal", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } });
      }
      api.provideCapability("subsystem:classify", (payload = {}) => {
        const pathname = String(payload?.path || "").trim().toLowerCase();
        const existing = Array.isArray(payload?.subsystems)
          ? payload.subsystems.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
          : [];
        const next = new Set(existing);
        if (pathname.startsWith("/api/todos/") || pathname === "/api/todos") {
          next.add("todo");
        }
        if (pathname.startsWith("/api/calendar/") || pathname.startsWith("/api/plugin-ui/calendar/")) {
          next.add("calendar");
        }
        return [...next];
      });

      if (typeof api.addHook === "function") {
        api.addHook("runtime:startup", async (payload = {}) => {
          if (api.isEnabled?.() === true) {
            await domain.runDueEvents();
            await domain.maybeEmitTodoReminder({});
          }
          return payload;
        });
        api.addHook("runtime:tick:cron", async (payload = {}) => {
          if (api.isEnabled?.() === true) {
            await domain.runDueEvents();
          }
          return payload;
        });
        api.addHook("runtime:tick:5m", async (payload = {}) => {
          if (api.isEnabled?.() === true) {
            await domain.maybeEmitTodoReminder({});
          }
          return payload;
        });
      }

      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        tools.push(
          { name: "get_calendar_summary", description: "Get a summary of calendar events for today, tomorrow, this week, or upcoming events.", parameters: { scope: "today|tomorrow|week|upcoming", limit: "number" } },
          { name: "find_calendar_events", description: "Find calendar events by id, partial title, date (YYYY-MM-DD), or status.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } },
          { name: "create_calendar_event", description: "Create a calendar event, optionally repeating and optionally configured as a Nova action.", parameters: { title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } },
          { name: "update_calendar_event", description: "Update an existing calendar event by eventId or by matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", title: "string", startAt: "ISO datetime", endAt: "ISO datetime", allDay: "boolean", location: "string", description: "string", type: "personal|nova_action", repeatFrequency: "none|daily|weekly|monthly|yearly", repeatInterval: "number", actionEnabled: "boolean", actionMessage: "string", requestedBrainId: "string" } },
          { name: "remove_calendar_event", description: "Remove a calendar event by eventId or by matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD" } },
          { name: "set_calendar_event_state", description: "Mark a calendar event active, completed, or cancelled by eventId or matching titleContains plus optional date.", parameters: { eventId: "string", titleContains: "string", date: "YYYY-MM-DD", status: "active|completed|cancelled" } }
        );
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        const handledResult = (result = null) => ({ ...payload, handled: true, result });
        if (name === "get_calendar_summary") {
          const lines = await domain.buildCalendarSummary({
            scope: String(args.scope || "upcoming").trim().toLowerCase(),
            limit: Number(args.limit || 10) || 10
          });
          return handledResult({ text: lines.join("\n") });
        }
        if (name === "find_calendar_events") {
          const matches = await domain.findCalendarEventsByReference({
            eventId: String(args.eventId || "").trim(),
            titleContains: String(args.titleContains || "").trim(),
            date: String(args.date || "").trim(),
            status: String(args.status || "").trim()
          });
          return handledResult({
            text: matches.length
              ? matches.map((entry) => `- ${entry.id}: ${domain.summarizeCalendarEvent(entry)}`).join("\n")
              : "No matching calendar events found.",
            events: matches
          });
        }
        if (name === "create_calendar_event") {
          const nextEvent = domain.normalizeCalendarToolEventInput(args, runtime?.getObserverConfig?.()?.defaults?.mountIds || []);
          if (!nextEvent.title || !nextEvent.startAt) {
            throw new Error("create_calendar_event requires title and startAt");
          }
          const saved = await withTransaction({
            coreTransactions: runtime?.coreTransactions || null,
            taskId: String(args.taskContext?.taskId || "").trim(),
            toolCallId: String(args.toolCallId || "").trim(),
            proposal: {
              pluginId: "calendar", domain: "calendar", operation: "create_calendar_event", target: "calendar",
              summary: `Create calendar event: "${String(nextEvent.title || "").trim()}" at ${String(nextEvent.startAt || "").slice(0, 16)}`,
              irreversible: false, compensationPlan: "Remove the created event using remove_calendar_event.",
              requiresApproval: false, riskReasons: [],
              payload: { title: String(nextEvent.title || "").trim(), startAt: String(nextEvent.startAt || "").trim() }
            },
            getSuccessNotes: (r) => `Event created: ${r.id}`,
            failureClass: "create_failed"
          }, () => domain.saveCalendarEvent(nextEvent));
          return handledResult({
            text: `Created calendar event ${saved.id}: ${domain.summarizeCalendarEvent(saved)}.`,
            event: saved
          });
        }
        if (name === "update_calendar_event") {
          const matches = await domain.findCalendarEventsByReference({
            eventId: String(args.eventId || "").trim(),
            titleContains: String(args.titleContains || "").trim(),
            date: String(args.date || "").trim()
          });
          if (!matches.length) throw new Error("No matching calendar event found");
          if (matches.length > 1) throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
          const saved = await withTransaction({
            coreTransactions: runtime?.coreTransactions || null,
            taskId: String(args.taskContext?.taskId || "").trim(),
            toolCallId: String(args.toolCallId || "").trim(),
            proposal: {
              pluginId: "calendar", domain: "calendar", operation: "update_calendar_event", target: matches[0].id,
              summary: `Update calendar event ${matches[0].id}: "${String(matches[0].title || "").trim()}"`,
              irreversible: false, compensationPlan: "Restore the previous event state by calling update_calendar_event with the original field values.",
              requiresApproval: false, riskReasons: [],
              payload: { eventId: matches[0].id, title: String(matches[0].title || "").trim() }
            },
            getSuccessNotes: (r) => `Event updated: ${r.id}`,
            failureClass: "update_failed"
          }, () => {
            const patch = domain.buildCalendarToolEventPatch(args, runtime?.getObserverConfig?.()?.defaults?.mountIds || []);
            // Deep-merge the action so partial action patches (e.g. only actionMessage) don't clobber enabled/mountIds
            if (patch.action) patch.action = { ...matches[0].action, ...patch.action };
            return domain.saveCalendarEvent({ ...matches[0], ...patch });
          });
          return handledResult({
            text: `Updated calendar event ${saved.id}: ${domain.summarizeCalendarEvent(saved)}.`,
            event: saved
          });
        }
        if (name === "remove_calendar_event") {
          const matches = await domain.findCalendarEventsByReference({
            eventId: String(args.eventId || "").trim(),
            titleContains: String(args.titleContains || "").trim(),
            date: String(args.date || "").trim()
          });
          if (!matches.length) throw new Error("No matching calendar event found");
          if (matches.length > 1) throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
          await withTransaction({
            coreTransactions: runtime?.coreTransactions || null,
            taskId: String(args.taskContext?.taskId || "").trim(),
            toolCallId: String(args.toolCallId || "").trim(),
            proposal: {
              pluginId: "calendar", domain: "calendar", operation: "remove_calendar_event", target: matches[0].id,
              summary: `Remove calendar event ${matches[0].id}: "${String(matches[0].title || "").trim()}"`,
              irreversible: false, compensationPlan: "Recreate the removed event using create_calendar_event with the same title, startAt, and endAt.",
              requiresApproval: false, riskReasons: [],
              payload: { eventId: matches[0].id, title: String(matches[0].title || "").trim() }
            },
            getSuccessNotes: () => `Event removed: ${matches[0].id}`,
            failureClass: "remove_failed"
          }, () => domain.removeCalendarEvent(matches[0].id));
          return handledResult({
            text: `Removed calendar event ${matches[0].id}: ${domain.summarizeCalendarEvent(matches[0])}.`,
            removedEventId: matches[0].id
          });
        }
        if (name === "set_calendar_event_state") {
          const status = String(args.status || "").trim().toLowerCase();
          if (!["active", "completed", "cancelled"].includes(status)) {
            throw new Error("status must be active, completed, or cancelled");
          }
          const matches = await domain.findCalendarEventsByReference({
            eventId: String(args.eventId || "").trim(),
            titleContains: String(args.titleContains || "").trim(),
            date: String(args.date || "").trim()
          });
          if (!matches.length) throw new Error("No matching calendar event found");
          if (matches.length > 1) throw new Error(`Multiple calendar events matched: ${matches.map((entry) => entry.id).join(", ")}`);
          const now = Date.now();
          const saved = await withTransaction({
            coreTransactions: runtime?.coreTransactions || null,
            taskId: String(args.taskContext?.taskId || "").trim(),
            toolCallId: String(args.toolCallId || "").trim(),
            proposal: {
              pluginId: "calendar", domain: "calendar", operation: "set_calendar_event_state", target: matches[0].id,
              summary: `Mark calendar event ${matches[0].id} as ${status}: "${String(matches[0].title || "").trim()}"`,
              irreversible: false, compensationPlan: `Restore previous state by calling set_calendar_event_state with status: ${matches[0].status}.`,
              requiresApproval: false, riskReasons: [],
              payload: { eventId: matches[0].id, status }
            },
            getSuccessNotes: (r) => `Event ${r.id} marked ${status}`,
            failureClass: "state_change_failed"
          }, () => domain.saveCalendarEvent({
            ...matches[0],
            status,
            completedAt: status === "completed" ? now : 0,
            cancelledAt: status === "cancelled" ? now : 0
          }));
          return handledResult({
            text: `Marked calendar event ${saved.id} as ${status}.`,
            event: saved
          });
        }
        return payload;
      });

      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "calendar",
          title: "Calendar",
          icon: "C",
          order: 22,
          scriptUrl: "/api/plugin-ui/calendar/tab.js"
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/calendar/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "calendar-tab.js"));
      });

      app.get("/api/calendar/events", async (_req, res) => {
        try {
          const listEvents = api.getCapability("calendar.listEvents");
          if (typeof listEvents !== "function") {
            return res.status(503).json({ ok: false, error: "calendar capability is unavailable" });
          }
          const events = await listEvents();
          res.json({ ok: true, events });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list calendar events") });
        }
      });

      app.post("/api/calendar/events", async (req, res) => {
        try {
          const saveEvent = api.getCapability("calendar.saveEvent");
          if (typeof saveEvent !== "function") {
            return res.status(503).json({ ok: false, error: "calendar capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const payload = req.body && typeof req.body === "object" ? req.body : {};
          const startAt = parseTs(payload.startAt, 0);
          if (!startAt) {
            return res.status(400).json({ ok: false, error: "startAt is required" });
          }
          const savedEvent = await saveEvent({
            id: payload.id,
            title: payload.title,
            description: payload.description,
            location: payload.location,
            type: payload.type,
            status: payload.status,
            allDay: payload.allDay === true,
            startAt,
            endAt: parseTs(payload.endAt, 0),
            repeat: payload.repeat,
            action: payload.action
          });
          res.json({
            ok: true,
            event: savedEvent,
            message: payload.id ? "Calendar event updated." : "Calendar event created."
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to save calendar event") });
        }
      });

      app.post("/api/calendar/events/:eventId/state", async (req, res) => {
        try {
          const eventId = String(req.params?.eventId || "").trim();
          if (!eventId) {
            return res.status(400).json({ ok: false, error: "eventId is required" });
          }
          const status = String(req.body?.status || "").trim().toLowerCase();
          if (!["active", "completed", "cancelled"].includes(status)) {
            return res.status(400).json({ ok: false, error: "status must be active, completed, or cancelled" });
          }
          const readEvents = api.getCapability("calendar.readEvents");
          const saveEvent = api.getCapability("calendar.saveEvent");
          if (typeof readEvents !== "function" || typeof saveEvent !== "function") {
            return res.status(503).json({ ok: false, error: "calendar capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const existing = (await readEvents()).find((entry) => String(entry.id || "") === eventId);
          if (!existing) {
            return res.status(404).json({ ok: false, error: "calendar event not found" });
          }
          const now = Date.now();
          const event = await saveEvent({
            ...existing,
            status,
            completedAt: status === "completed" ? now : 0,
            cancelledAt: status === "cancelled" ? now : 0
          });
          res.json({ ok: true, event, message: `Calendar event marked ${status}.` });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to update calendar event state") });
        }
      });

      app.delete("/api/calendar/events/:eventId", async (req, res) => {
        try {
          const eventId = String(req.params?.eventId || "").trim();
          if (!eventId) {
            return res.status(400).json({ ok: false, error: "eventId is required" });
          }
          const removeEvent = api.getCapability("calendar.removeEvent");
          if (typeof removeEvent !== "function") {
            return res.status(503).json({ ok: false, error: "calendar capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const removed = await removeEvent(eventId);
          if (!removed) {
            return res.status(404).json({ ok: false, error: "calendar event not found" });
          }
          res.json({ ok: true, message: "Calendar event deleted." });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to delete calendar event") });
        }
      });

      app.get("/api/todos", async (_req, res) => {
        try {
          const listItems = api.getCapability("todo.listItems");
          if (typeof listItems !== "function") {
            return res.status(503).json({ ok: false, error: "todo capability is unavailable" });
          }
          const todos = await listItems();
          res.json({ ok: true, ...todos });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list todos") });
        }
      });

      app.post("/api/todos", async (req, res) => {
        try {
          const text = String(req.body?.text || "").trim();
          if (!text) {
            return res.status(400).json({ ok: false, error: "text is required" });
          }
          const addItem = api.getCapability("todo.addItem");
          if (typeof addItem !== "function") {
            return res.status(503).json({ ok: false, error: "todo capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const todo = await addItem({
            text,
            createdBy: String(req.body?.createdBy || "").trim().toLowerCase() === "nova" ? "nova" : "user",
            source: String(req.body?.source || "api").trim()
          });
          res.json({ ok: true, todo });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to add todo") });
        }
      });

      app.post("/api/todos/:todoId/state", async (req, res) => {
        try {
          const todoId = String(req.params?.todoId || "").trim();
          if (!todoId) {
            return res.status(400).json({ ok: false, error: "todoId is required" });
          }
          const setStatus = api.getCapability("todo.setItemStatus");
          if (typeof setStatus !== "function") {
            return res.status(503).json({ ok: false, error: "todo capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const result = await setStatus(todoId, String(req.body?.status || "completed").trim(), {
            completedBy: String(req.body?.completedBy || "user").trim(),
            sessionId: String(req.body?.sessionId || "Main").trim()
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update todo state") });
        }
      });

      app.post("/api/todos/:todoId/remove", async (req, res) => {
        try {
          const todoId = String(req.params?.todoId || "").trim();
          if (!todoId) {
            return res.status(400).json({ ok: false, error: "todoId is required" });
          }
          const removeItem = api.getCapability("todo.removeItem");
          if (typeof removeItem !== "function") {
            return res.status(503).json({ ok: false, error: "todo capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const result = await removeItem(todoId, {
            removedBy: String(req.body?.removedBy || "user").trim(),
            sessionId: String(req.body?.sessionId || "Main").trim()
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to remove todo") });
        }
      });
    }
  };
}
