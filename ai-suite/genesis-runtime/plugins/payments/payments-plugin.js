/**
 * Plugin Name: Payments
 * Plugin Slug: payments
 * Description: Policy-gated payment tools. Every payment runs through vendor allowlist, transaction cap, daily budget, and approval-threshold checks before dispatch.
 * Version: 1.0.0
 * Author: Nova Observer
 * Observer UI Panel: Yes
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPaymentsDomain } from "./lib/payments-domain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createPaymentsPlugin(options = {}) {
  const {
    pluginId = "payments",
    pluginName = "Payments",
    description = "Policy-gated payment tools with vendor allowlist, transaction cap, daily budget, and approval threshold."
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
          "process_payment",
          "get_payment_status",
          "list_payments",
          "get_payment_policy"
        ],
        capabilities: [
          "payments.processPayment",
          "payments.getTransaction",
          "payments.listTransactions",
          "payments.readPolicy",
          "payments.updatePolicy",
          "payments.checkPolicy"
        ],
        hooks: ["intake:tools:list", "intake:tool-call"],
        runtimeContext: ["noteInteractiveActivity"]
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
      if (!api.data) return;

      const domain = createPaymentsDomain({
        dataApi: api.data,
        broadcast: (event) => api.broadcast(event)
      });

      api.provideCapability("payments.processPayment", (args) => domain.processPayment(args));
      api.provideCapability("payments.getTransaction", (txId) => domain.getTransaction(txId));
      api.provideCapability("payments.listTransactions", (filters) => domain.listTransactions(filters));
      api.provideCapability("payments.readPolicy", () => domain.readPolicy());
      api.provideCapability("payments.updatePolicy", (patch) => domain.updatePolicy(patch));
      api.provideCapability("payments.checkPolicy", (amount, vendor, vendorRef, approvalOverride) =>
        domain.checkPolicy(amount, vendor, vendorRef, approvalOverride)
      );

      if (typeof api.registerTool === "function") {
        api.registerTool({
          name: "process_payment",
          description: "Make a payment to a vendor. Runs through policy checks (vendor allowlist, transaction cap, daily budget, approval threshold) before dispatching.",
          scopes: ["intake"],
          risk: "high",
          parameters: {
            amount: "number — payment amount",
            currency: "string — ISO currency code, e.g. USD",
            vendor: "string — vendor name",
            vendorRef: "string — vendor email, domain, or account reference",
            description: "string — what this payment is for",
            approvalOverride: "boolean — set true only after explicit human authorisation for amounts above the approval threshold"
          }
        });
        api.registerTool({
          name: "get_payment_status",
          description: "Look up the status and details of a specific payment transaction.",
          scopes: ["intake"],
          risk: "normal",
          parameters: { txId: "string — transaction ID returned by process_payment" }
        });
        api.registerTool({
          name: "list_payments",
          description: "List recent payment transactions with optional filters.",
          scopes: ["intake"],
          risk: "normal",
          parameters: {
            limit: "number — max results (default 20, max 200)",
            status: "string — filter by status: completed, rejected, failed, pending",
            vendor: "string — filter by vendor name or ref"
          }
        });
        api.registerTool({
          name: "get_payment_policy",
          description: "Read the current payment policy (daily budget cap, transaction cap, vendor allowlist, approval threshold). Check this before attempting a payment.",
          scopes: ["intake"],
          risk: "normal"
        });
      }

      api.addHook("intake:tools:list", async (payload = {}) => {
        const tools = Array.isArray(payload?.tools) ? payload.tools.slice() : [];
        tools.push(
          {
            name: "process_payment",
            description: "Make a payment to a vendor. Runs through policy checks (vendor allowlist, transaction cap, daily budget, approval threshold) before dispatching.",
            parameters: {
              amount: "number",
              currency: "string (ISO code, e.g. USD)",
              vendor: "string",
              vendorRef: "string (email, domain, or account ref)",
              description: "string",
              approvalOverride: "boolean (true only after explicit human authorisation)"
            }
          },
          {
            name: "get_payment_status",
            description: "Look up the status of a payment transaction.",
            parameters: { txId: "string" }
          },
          {
            name: "list_payments",
            description: "List recent payment transactions.",
            parameters: { limit: "number", status: "string", vendor: "string" }
          },
          {
            name: "get_payment_policy",
            description: "Read the current payment policy — check this before attempting a payment."
          }
        );
        return { ...payload, tools };
      });

      api.addHook("intake:tool-call", async (payload = {}) => {
        const name = String(payload?.name || "").trim();
        const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
        const handled = (result) => ({ ...payload, handled: true, result });

        if (name === "get_payment_policy") {
          const policy = await domain.readPolicy();
          const daily = await domain.getDailySpend();
          const lines = [
            `Payment plugin: ${policy.enabled ? "ENABLED" : "DISABLED"}.`,
            `Transaction cap: ${policy.transactionCap} ${policy.currency}.`,
            `Daily budget cap: ${policy.dailyBudgetCap} ${policy.currency} (${daily.toFixed(2)} spent today, ${Math.max(0, policy.dailyBudgetCap - daily).toFixed(2)} remaining).`,
            `Approval threshold: ${policy.requireApprovalAbove} ${policy.currency}.`,
            policy.vendorAllowlist.length
              ? `Vendor allowlist (${policy.vendorAllowlist.length}): ${policy.vendorAllowlist.join(", ")}.`
              : "Vendor allowlist: open (any vendor allowed).",
            `Processor mode: ${policy.processorMode || "stub"}.`
          ];
          return handled({ text: lines.join("\n"), policy, dailySpend: daily });
        }

        if (name === "process_payment") {
          const result = await domain.processPayment({
            amount: args.amount,
            currency: args.currency,
            vendor: args.vendor,
            vendorRef: args.vendorRef,
            description: args.description,
            approvalOverride: Boolean(args.approvalOverride),
            source: "agent"
          });

          if (!result.ok) {
            const prefix = result.status === "rejected" ? "Payment rejected" : "Payment failed";
            return handled({
              text: `${prefix}: ${result.reason || result.error || "unknown reason"}.${result.txId ? ` (txId: ${result.txId})` : ""}`,
              ...result
            });
          }

          return handled({
            text: `Payment completed. txId: ${result.txId}. Amount: ${result.amount} ${result.currency} to ${result.vendor}${result.processorRef ? ` (ref: ${result.processorRef})` : ""}.`,
            ...result
          });
        }

        if (name === "get_payment_status") {
          const txId = String(args.txId || "").trim();
          if (!txId) return handled({ text: "txId is required." });
          const tx = await domain.getTransaction(txId);
          if (!tx) return handled({ text: `Transaction ${txId} not found.` });
          const statusLine = tx.status === "rejected"
            ? `${tx.status} — ${tx.rejectionReason || "no reason recorded"}`
            : tx.status;
          return handled({
            text: `Transaction ${tx.id}: ${tx.amount} ${tx.currency} to ${tx.vendor} — ${statusLine}. Created: ${tx.createdAt}.`,
            transaction: tx
          });
        }

        if (name === "list_payments") {
          const { transactions, total, dailySpend } = await domain.listTransactions({
            limit: args.limit,
            status: args.status,
            vendor: args.vendor
          });
          if (!transactions.length) {
            return handled({ text: "No payment transactions found.", transactions: [], total: 0, dailySpend });
          }
          const lines = transactions.map(
            (tx) => `- [${tx.status.toUpperCase()}] ${tx.amount} ${tx.currency} → ${tx.vendor || tx.vendorRef || "unknown"} | ${tx.createdAt?.slice(0, 10)} | ${tx.id}`
          );
          return handled({
            text: `${transactions.length} of ${total} transaction(s). Daily spend: ${dailySpend.toFixed(2)}.\n${lines.join("\n")}`,
            transactions,
            total,
            dailySpend
          });
        }

        return payload;
      });

      if (typeof api.registerUiPanel === "function") {
        api.registerUiPanel({
          id: "payments-policy",
          title: "Payment Policy",
          description: "Configure payment policy limits. All agent payment calls are checked against these rules before dispatch.",
          fields: [
            { id: "enabled", label: "Payments enabled", type: "checkbox", defaultValue: false },
            { id: "dailyBudgetCap", label: "Daily budget cap", type: "text", defaultValue: "500" },
            { id: "transactionCap", label: "Per-transaction cap", type: "text", defaultValue: "100" },
            { id: "requireApprovalAbove", label: "Require approval above", type: "text", defaultValue: "50" },
            { id: "currency", label: "Base currency", type: "text", defaultValue: "USD" },
            { id: "processorMode", label: "Processor mode (stub / ...)", type: "text", defaultValue: "stub" }
          ],
          actions: [
            {
              id: "save-policy",
              label: "Save Policy",
              method: "POST",
              endpoint: "/api/payments/policy",
              bodyFields: ["enabled", "dailyBudgetCap", "transactionCap", "requireApprovalAbove", "currency", "processorMode"],
              expects: "json"
            },
            {
              id: "read-policy",
              label: "Read Policy",
              method: "GET",
              endpoint: "/api/payments/policy",
              expects: "json"
            }
          ]
        });
      }

      if (typeof api.registerUiTab === "function") {
        api.registerUiTab({
          id: "payments",
          title: "Payments",
          icon: "$",
          order: 36,
          scriptUrl: "/api/plugin-ui/payments/tab.js"
        });
      }
    },

    async registerRoutes({ app, api }) {
      app.get("/api/plugin-ui/payments/tab.js", (_req, res) => {
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "public", "payments-tab.js"));
      });

      app.get("/api/payments/policy", async (_req, res) => {
        try {
          const readPolicy = api.getCapability("payments.readPolicy");
          if (typeof readPolicy !== "function") {
            return res.status(503).json({ ok: false, error: "payments capability unavailable" });
          }
          const policy = await readPolicy();
          const dailySpend = await (api.getCapability("payments.listTransactions")?.({ limit: 1 }))
            .then((r) => r?.dailySpend ?? 0)
            .catch(() => 0);
          res.json({ ok: true, policy, dailySpend });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed") });
        }
      });

      app.post("/api/payments/policy", async (req, res) => {
        try {
          const runtime = api.getRuntimeContext();
          const updatePolicy = api.getCapability("payments.updatePolicy");
          if (typeof updatePolicy !== "function") {
            return res.status(503).json({ ok: false, error: "payments capability unavailable" });
          }
          if (typeof runtime.noteInteractiveActivity === "function") runtime.noteInteractiveActivity();

          const body = req.body || {};
          const patch = {};
          if ("enabled" in body) patch.enabled = body.enabled === true || body.enabled === "true" || body.enabled === "on";
          if ("dailyBudgetCap" in body) patch.dailyBudgetCap = Number(body.dailyBudgetCap);
          if ("transactionCap" in body) patch.transactionCap = Number(body.transactionCap);
          if ("requireApprovalAbove" in body) patch.requireApprovalAbove = Number(body.requireApprovalAbove);
          if ("currency" in body) patch.currency = String(body.currency || "").trim().toUpperCase();
          if ("processorMode" in body) patch.processorMode = String(body.processorMode || "stub").trim();
          if ("vendorAllowlist" in body) {
            patch.vendorAllowlist = Array.isArray(body.vendorAllowlist)
              ? body.vendorAllowlist
              : String(body.vendorAllowlist || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
          }

          const policy = await updatePolicy(patch);
          res.json({ ok: true, policy, message: "Payment policy updated." });
        } catch (error) {
          res.status(400).json({ ok: false, error: String(error?.message || error || "failed") });
        }
      });

      app.get("/api/payments/transactions", async (req, res) => {
        try {
          const listTransactions = api.getCapability("payments.listTransactions");
          if (typeof listTransactions !== "function") {
            return res.status(503).json({ ok: false, error: "payments capability unavailable" });
          }
          const result = await listTransactions({
            limit: Number(req.query.limit || 50),
            status: req.query.status || undefined,
            vendor: req.query.vendor || undefined
          });
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed") });
        }
      });

      app.get("/api/payments/transactions/:txId", async (req, res) => {
        try {
          const getTransaction = api.getCapability("payments.getTransaction");
          if (typeof getTransaction !== "function") {
            return res.status(503).json({ ok: false, error: "payments capability unavailable" });
          }
          const txId = String(req.params?.txId || "").trim();
          if (!txId) return res.status(400).json({ ok: false, error: "txId is required" });
          const tx = await getTransaction(txId);
          if (!tx) return res.status(404).json({ ok: false, error: "transaction not found" });
          res.json({ ok: true, transaction: tx });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed") });
        }
      });

      app.post("/api/payments/check-policy", async (req, res) => {
        try {
          const checkPolicy = api.getCapability("payments.checkPolicy");
          if (typeof checkPolicy !== "function") {
            return res.status(503).json({ ok: false, error: "payments capability unavailable" });
          }
          const body = req.body || {};
          const result = await checkPolicy(
            Number(body.amount),
            String(body.vendor || ""),
            String(body.vendorRef || ""),
            Boolean(body.approvalOverride)
          );
          res.json({ ok: true, ...result });
        } catch (error) {
          res.status(500).json({ ok: false, error: String(error?.message || error || "failed") });
        }
      });
    }
  };
}

export default createPaymentsPlugin;
