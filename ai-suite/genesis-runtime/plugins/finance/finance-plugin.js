/**
 * Plugin Name: Finance Tracker
 * Plugin Slug: finance
 * Description: Adds optional finance ledger, summary views, and mail-sync routes for Observer.
 * Version: 1.1.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { createFinanceDomain } from "./lib/finance-domain.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createFinancePlugin(options = {}) {
  const {
    pluginId = "finance",
    pluginName = "Finance Tracker",
    description = "Optional finance tracker routes for ledger and mail-derived entries."
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.1.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: true,
        uiPanels: true,
        data: true,
        tools: [
          "get_finance_summary",
          "add_finance_entry",
          "get_finance_entries"
        ],
        capabilities: [
          "finance.listEntries",
          "finance.saveEntry",
          "finance.updateEntry",
          "finance.removeEntry",
          "finance.syncRecentMail"
        ],
        hooks: ["mail:message-received", "intake:tools:list", "intake:tool-call"],
        runtimeContext: ["noteInteractiveActivity", "getRecentMailMessages"]
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: ["mail.listRecentMessages"]
      },
      security: {
        isolation: "inprocess"
      }
    },
    async init(api) {
      if (!api.data) {
        return;
      }
      const domain = createFinanceDomain({
        dataApi: api.data,
        broadcast: (event) => api.broadcast(event)
      });

      api.provideCapability("finance.listEntries", () => domain.listEntries());
      api.provideCapability("finance.saveEntry", (entryInput = {}, optionsOverride = {}) =>
        domain.saveEntry(entryInput, optionsOverride)
      );
      api.provideCapability("finance.updateEntry", (entryId = "", patch = {}) =>
        domain.updateEntry(entryId, patch)
      );
      api.provideCapability("finance.removeEntry", (entryId = "") =>
        domain.removeEntry(entryId)
      );
      api.provideCapability("finance.syncRecentMail", async (messages = []) =>
        domain.syncEntriesFromRecentMail(messages)
      );
      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        tools.push(
          {
            name: "get_finance_summary",
            description: "Get a summary of tracked income, expenses, unpaid items, and financial year totals from the finance ledger."
          },
          {
            name: "add_finance_entry",
            description: "Add a manual finance entry to the ledger.",
            parameters: {
              title: "string",
              type: "income|expense",
              amount: "number",
              currency: "string",
              category: "string",
              counterparty: "string",
              occurredAt: "ISO datetime or YYYY-MM-DD",
              status: "paid|unpaid",
              notes: "string"
            }
          },
          {
            name: "get_finance_entries",
            description: "Get the full list of tracked finance entries, sorted by date.",
            parameters: { limit: "number" }
          }
        );
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        const handledResult = (result = null) => ({ ...payload, handled: true, result });

        if (name === "get_finance_summary") {
          const finance = await domain.listEntries();
          const { entries = [], summary = {}, financialYears = [] } = finance;
          const totalCount = Number(summary.trackedCount || entries.length || 0);
          if (!totalCount) {
            return handledResult({ text: "No finance entries have been recorded yet." });
          }
          const currency = entries[0]?.currency || "AUD";
          const income = Number(summary.totals?.income || 0).toFixed(2);
          const expense = Number(summary.totals?.expense || 0).toFixed(2);
          const net = Number(summary.totals?.net || 0).toFixed(2);
          const lines = [
            `${totalCount} finance entr${totalCount === 1 ? "y" : "ies"} tracked. Net: ${currency} ${net} (income ${currency} ${income}, expenses ${currency} ${expense}).`
          ];
          const currentFY = financialYears.find((fy) => fy.isCurrent) || financialYears[0];
          if (currentFY) {
            lines.push(`Current FY (${currentFY.label}): ${currentFY.entryCount} entr${currentFY.entryCount === 1 ? "y" : "ies"}, net ${currency} ${Number(currentFY.totals?.net || 0).toFixed(2)}.`);
          }
          const unpaid = entries.filter((e) => e.status === "unpaid" && e.type === "expense");
          if (unpaid.length) {
            lines.push(`Unpaid expenses: ${unpaid.slice(0, 4).map((e) => `${e.title}${e.amountDisplay ? " " + e.amountDisplay : ""}`).join(", ")}.`);
          }
          return handledResult({ text: lines.join("\n"), summary, financialYears });
        }

        if (name === "add_finance_entry") {
          const entry = await domain.saveEntry({
            title: args.title,
            type: args.type,
            amount: args.amount,
            currency: args.currency,
            category: args.category,
            counterparty: args.counterparty,
            occurredAt: args.occurredAt,
            status: args.status,
            notes: args.notes,
            sourceType: "manual"
          });
          return handledResult({
            text: `Added finance entry: ${entry.title}${entry.amountDisplay ? " " + entry.amountDisplay : ""} (${entry.type}, ${entry.status}).`,
            entry
          });
        }

        if (name === "get_finance_entries") {
          const finance = await domain.listEntries();
          const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));
          const entries = finance.entries.slice(0, limit);
          return handledResult({
            text: entries.length
              ? entries.map((e) => `- ${e.title}${e.amountDisplay ? " " + e.amountDisplay : ""} (${e.type}, ${e.status}, ${e.category})`).join("\n")
              : "No finance entries found.",
            entries,
            summary: finance.summary
          });
        }

        return payload;
      });

      api.addHook("mail:message-received", async (payload = {}) => {
        const message = payload?.message && typeof payload.message === "object"
          ? payload.message
          : null;
        if (!message) {
          return payload;
        }
        try {
          const synced = await domain.syncEntryFromMail(message);
          if (synced?.entry) {
            message.finance = {
              ...(message.finance || {}),
              entryId: synced.entry.id
            };
          }
        } catch {
          // Finance sync should never block mail processing.
        }
        return {
          ...payload,
          message
        };
      });

      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "finance-plugin-controls",
          title: "Finance Plugin Controls",
          description: "Enable or disable finance at runtime and inspect plugin state.",
          fields: [
            {
              id: "enabled",
              label: "Finance enabled",
              type: "checkbox",
              defaultValue: true
            }
          ],
          actions: [
            {
              id: "toggle-finance",
              label: "Apply",
              method: "POST",
              endpoint: "/api/plugins/finance/toggle",
              bodyFields: ["enabled"],
              expects: "json"
            },
            {
              id: "list-plugins",
              label: "Show plugin state",
              method: "GET",
              endpoint: "/api/plugins/list",
              expects: "json"
            }
          ]
        });
      }
      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "finance",
          title: "Finance",
          icon: "F",
          order: 35,
          scriptUrl: "/api/plugin-ui/finance/tab.js"
        });
      }
    },
    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/finance/tab.js", async (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "finance-tab.js"));
      });

      app.get("/api/finance/entries", async (req, res) => {
        try {
          const listEntries = api.getCapability("finance.listEntries");
          if (typeof listEntries !== "function") {
            return res.status(503).json({ ok: false, error: "finance capability is unavailable" });
          }
          const finance = await listEntries();
          res.json({ ok: true, ...finance });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to list finance entries") });
        }
      });

      app.post("/api/finance/entries", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const saveEntry = api.getCapability("finance.saveEntry");
          if (typeof saveEntry !== "function") {
            return res.status(503).json({ ok: false, error: "finance capability is unavailable" });
          }
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const entry = await saveEntry({
            title: req.body?.title,
            counterparty: req.body?.counterparty,
            type: req.body?.type,
            status: req.body?.status,
            category: req.body?.category,
            amount: req.body?.amount,
            currency: req.body?.currency,
            occurredAt: req.body?.occurredAt,
            sourceType: "manual",
            notes: req.body?.notes
          });
          res.json({ ok: true, entry, message: "Finance entry created." });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to create finance entry") });
        }
      });

      app.patch("/api/finance/entries/:entryId", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const updateEntry = api.getCapability("finance.updateEntry");
          if (typeof updateEntry !== "function") {
            return res.status(503).json({ ok: false, error: "finance capability is unavailable" });
          }
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const entryId = String(req.params?.entryId || "").trim();
          if (!entryId) {
            return res.status(400).json({ ok: false, error: "entryId is required" });
          }
          const entry = await updateEntry(entryId, req.body || {});
          res.json({ ok: true, entry, message: "Finance entry updated." });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed to update finance entry") });
        }
      });

      app.delete("/api/finance/entries/:entryId", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const removeEntry = api.getCapability("finance.removeEntry");
          if (typeof removeEntry !== "function") {
            return res.status(503).json({ ok: false, error: "finance capability is unavailable" });
          }
          if (typeof runtime.noteInteractiveActivity === "function") {
            runtime.noteInteractiveActivity();
          }
          const entryId = String(req.params?.entryId || "").trim();
          if (!entryId) {
            return res.status(400).json({ ok: false, error: "entryId is required" });
          }
          const removed = await removeEntry(entryId);
          if (!removed) {
            return res.status(404).json({ ok: false, error: "finance entry not found" });
          }
          res.json({ ok: true, message: "Finance entry removed." });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed to remove finance entry") });
        }
      });

      app.post("/api/finance/sync-mail", async (req, res) => {
        try {
          const listEntries = api.getCapability("finance.listEntries");
          const syncRecentMail = api.getCapability("finance.syncRecentMail");
          if (typeof listEntries !== "function" || typeof syncRecentMail !== "function") {
            return res.status(503).json({ ok: false, error: "finance capability is unavailable" });
          }
          const runtime = api.getRuntimeContext();
          const mailAvailable = typeof runtime.getRecentMailMessages === "function";
          const recentMessages = mailAvailable
            ? runtime.getRecentMailMessages()
            : [];
          const syncResult = await syncRecentMail(recentMessages);
          const finance = await listEntries();
          res.json({
            ok: true,
            syncedCount: Number(syncResult?.syncedCount || 0),
            removedCount: Number(syncResult?.removedCount || 0),
            unavailable: syncResult?.unavailable === true || !mailAvailable,
            ...finance
          });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "finance mail sync failed") });
        }
      });
    }
  };
}
