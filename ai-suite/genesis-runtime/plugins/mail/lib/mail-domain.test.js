import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createMailDomain } from "./mail-domain.js";

function createTestMailDomain({ mailState = {}, broadcasts = [] } = {}) {
  let pollInFlight = false;
  class ResettingImapFlow extends EventEmitter {
    async connect() {}

    async logout() {
      const error = new Error("read ECONNRESET");
      error.code = "ECONNRESET";
      this.emit("error", error);
    }

    async getMailboxLock() {
      return { release() {} };
    }

    async search() {
      return [];
    }
  }

  return {
    mailState,
    broadcasts,
    domain: createMailDomain({
      observerSecrets: {
        normalizeSecretHandle: (value = "") => String(value || "").trim(),
        getSecret: async () => ""
      },
      buildMailAgentPasswordHandle: (agentId = "") => `mail:${agentId}:password`,
      getObserverConfig: () => ({
        mail: {
          enabled: true,
          activeAgentId: "main",
          imap: {
            host: "imap.example.test",
            port: 993,
            secure: true
          },
          agents: {
            main: {
              id: "main",
              label: "Main",
              email: "main@example.test",
              user: "main@example.test",
              password: "test-password"
            }
          }
        }
      }),
      getMailState: () => mailState,
      setMailPollInFlight: (value) => {
        pollInFlight = value === true;
      },
      getMailPollInFlight: () => pollInFlight,
      getMailWatchRulesState: () => ({}),
      getDocumentRulesState: () => ({}),
      process,
      broadcast: (message) => broadcasts.push(String(message || "")),
      broadcastObserverEvent: () => {},
      runMailWatchRulesNow: async () => {},
      simpleParser: async () => ({}),
      ImapFlowClass: ResettingImapFlow,
      normalizeTrustLevel: (value = "unknown") => String(value || "unknown").trim().toLowerCase(),
      getAppTrustConfig: () => ({ emailCommandMinLevel: "trusted" }),
      compactTaskText: (value = "") => String(value || ""),
      escapeRegex: (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
  };
}

test("mail polling handles ImapFlow error events without throwing", async () => {
  const mailState = {
    highestUidByAgent: {},
    recentMessages: []
  };
  const { domain, broadcasts } = createTestMailDomain({ mailState });

  const messages = await domain.pollActiveMailbox({ emitEvents: false });

  assert.deepEqual(messages, []);
  assert.equal(mailState.lastError, "read ECONNRESET");
  assert.equal(broadcasts.some((entry) => entry.includes("read ECONNRESET")), true);
});
