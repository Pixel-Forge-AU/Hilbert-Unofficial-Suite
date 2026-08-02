import { escapeHtml as h } from "/plugin-tab-shared.js";

function textContentFromHtml(value = "") {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(value || ""), "text/html");
    doc.querySelectorAll("style, script").forEach((node) => node.remove());
    return String(doc.body?.textContent || "").trim();
  } catch {
    return String(value || "").trim();
  }
}

async function api(path = "", options = {}) {
  const r = await fetch(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) {
    throw new Error(j.error || `request failed (${r.status})`);
  }
  return j;
}

function formatTimeLabel(observerApp, value) {
  if (typeof observerApp?.formatTime === "function") {
    return observerApp.formatTime(value);
  }
  if (!value) {
    return "Never";
  }
  return new Date(value).toLocaleTimeString();
}

function trustLevelLabel(observerApp, value = "") {
  if (typeof observerApp?.trustLevelLabel === "function") {
    return observerApp.trustLevelLabel(value);
  }
  return String(value || "trusted").trim() || "trusted";
}

function setMetricStatus(observerApp, el, text = "", tone = "") {
  if (!el) {
    return;
  }
  if (typeof observerApp?.setStatus === "function") {
    observerApp.setStatus(el, text, tone);
    return;
  }
  el.textContent = text;
  el.className = `metric-value ${tone || ""}`.trim();
}

function buildMailObservation(message = {}) {
  const fromLabel = String(message?.fromName || message?.fromAddress || "Someone").trim();
  const subject = String(message?.subject || "(no subject)").trim();
  const text = String(message?.text || "").replace(/\s+/g, " ").trim();
  const preview = text.slice(0, 220).trim();
  const trust = String(message?.sourceIdentity?.trustLevel || "unknown").trim();
  const command = message?.command?.detected
    ? ` Email command ${String(message.command.action || "detected").replaceAll("_", " ")}.`
    : "";
  return {
    displayText: preview
      ? `${fromLabel} sent a ${trust} message: ${subject}\n\n${preview}${command}`
      : `${fromLabel} sent a ${trust} message: ${subject}${command}`,
    spokenText: preview
      ? `New ${trust} message from ${fromLabel}. ${subject}. ${preview}${command}`
      : `New ${trust} message from ${fromLabel}. ${subject}.${command}`
  };
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  const observerApp = context?.observerApp || window.ObserverApp || {};
  if (!(root instanceof HTMLElement)) {
    return;
  }

  if (!root.dataset.mailPluginMounted) {
    root.innerHTML = `
      <div class="inspector">
        <div class="panel-head">
          <div>
            <h2>Agent Mail</h2>
            <div class="panel-subtle">IMAP inbox polling and SMTP handoff for agent-to-agent messages.</div>
          </div>
          <button id="mailPollBtn" class="secondary" type="button">Poll inbox</button>
        </div>

        <div class="run-meta mail-info-strip">
          <div class="mini"><strong>Mailbox</strong><span id="mailStatus">Checking</span></div>
          <div class="mini"><strong>Agent</strong><span id="mailAgent">-</span></div>
          <div class="mini"><strong>Destination</strong><span id="mailDestinationSummary">-</span></div>
          <div class="mini"><strong>Last check</strong><span id="mailCheckedAt">-</span></div>
        </div>

        <div class="hint" id="mailHint">Configure the active agent mailbox and store its password in the Nova secure keystore to enable polling.</div>

        <label class="toggle" style="margin-bottom: 10px;">
          <input type="checkbox" id="mailSummariesEnabled" checked />
          <span>
            <strong>Send email summaries</strong>
            <div class="micro">Controls whether Nova sends unsure-email summary digests.</div>
          </span>
        </label>

        <div class="controls">
          <input id="mailToEmail" placeholder="name@example.com" />
          <input id="mailSubject" placeholder="Subject" />
          <button id="mailSendBtn" class="secondary" type="button">Send</button>
        </div>
        <textarea id="mailBody" placeholder="Write an email message."></textarea>

        <div id="mailMessages" class="history-list mail-message-list">No mail messages yet.</div>
      </div>
    `;
    root.dataset.mailPluginMounted = "1";
  }

  const el = {
    status: root.querySelector("#mailStatus"),
    agent: root.querySelector("#mailAgent"),
    destination: root.querySelector("#mailDestinationSummary"),
    checkedAt: root.querySelector("#mailCheckedAt"),
    hint: root.querySelector("#mailHint"),
    toEmail: root.querySelector("#mailToEmail"),
    subject: root.querySelector("#mailSubject"),
    body: root.querySelector("#mailBody"),
    sendBtn: root.querySelector("#mailSendBtn"),
    pollBtn: root.querySelector("#mailPollBtn"),
    summariesEnabled: root.querySelector("#mailSummariesEnabled"),
    messages: root.querySelector("#mailMessages")
  };

  const renderMailMessages = (messages = []) => {
    if (!el.messages) {
      return;
    }
    if (!Array.isArray(messages) || !messages.length) {
      el.messages.innerHTML = `<div class="panel-subtle">No mail messages yet.</div>`;
      return;
    }
    el.messages.innerHTML = messages.map((message) => {
      const categoryText = `Category: ${String(message?.triage?.category || "other")}`;
      const flags = [
        message?.triage?.likelySpam ? "Likely spam" : "",
        message?.triage?.automated ? "Automated" : ""
      ].filter(Boolean).join(" | ");
      const heuristics = Array.isArray(message?.triage?.reasons) ? message.triage.reasons.join(", ") : "";
      const trustLevel = String(message?.sourceIdentity?.trustLevel || "unknown").trim();
      const trustText = `Source trust: ${trustLevel}`;
      const command = message?.command && message.command.detected
        ? `Command: ${String(message.command.action || "detected").replaceAll("_", " ")}${message.command.taskCodename ? ` (${message.command.taskCodename})` : ""}`
        : "";
      const messageId = String(message?.id || "").trim();
      const plainBody = textContentFromHtml(String(message?.html || message?.text || "")).trim() || "(empty message)";
      return `
        <article class="history-item">
          <div class="history-head">
            <strong>${h(message.subject || "(no subject)")}</strong>
            <span class="history-source">${h(formatTimeLabel(observerApp, message.receivedAt))}</span>
            <button type="button" class="secondary mail-delete-btn" data-message-id="${h(messageId)}">Delete</button>
          </div>
          <div class="micro">${h(message.fromName || message.fromAddress || "Unknown sender")} -> ${h((message.to || []).join(", ") || message.agentEmail || "")}</div>
          <div class="micro">${h(categoryText)}${flags ? ` | ${h(flags)}` : ""}</div>
          <div class="micro">${h(trustText)}${command ? ` | ${h(command)}` : ""}</div>
          ${heuristics ? `<div class="micro">${h(`Heuristics: ${heuristics}`)}</div>` : ""}
          <div class="history-body">${h(plainBody)}</div>
        </article>
      `;
    }).join("");
  };

  const loadMailStatus = async () => {
    try {
      const j = await api("/api/mail/status");
      const ready = Boolean(j.ready);
      setMetricStatus(observerApp, el.status, ready ? "Ready" : (j.enabled ? "Needs config" : "Disabled"), ready ? "tone-ok" : "tone-warn");
      if (el.agent) {
        el.agent.textContent = j.activeAgentLabel && j.activeAgentEmail
          ? `${j.activeAgentLabel} <${j.activeAgentEmail}>`
          : (j.activeAgentLabel || j.activeAgentEmail || "-");
      }
      if (el.destination) {
        el.destination.textContent = "Direct email";
      }
      if (el.checkedAt) {
        el.checkedAt.textContent = j.lastCheckAt ? formatTimeLabel(observerApp, j.lastCheckAt) : "Never";
      }
      if (el.hint) {
        el.hint.textContent = j.lastError
          ? j.lastError
          : (ready
            ? `Mailbox is configured. Showing ${Number(j.recentMessageCount || 0)} recent inbox ${Number(j.recentMessageCount || 0) === 1 ? "message" : "messages"}. Trusted sources: ${Number(j.trustedSourceCount || 0)}. Known sources: ${Number(j.knownSourceCount || 0)}. Email commands need ${trustLevelLabel(observerApp, j.emailCommandMinLevel || "trusted")}.`
            : "Store the active agent mailbox password in the Nova secure keystore to enable IMAP and SMTP.");
      }
      if (el.summariesEnabled) {
        el.summariesEnabled.checked = j.sendSummariesEnabled !== false;
        el.summariesEnabled.disabled = !ready;
      }
      if (el.toEmail) el.toEmail.disabled = !ready;
      if (el.subject) el.subject.disabled = !ready;
      if (el.body) el.body.disabled = !ready;
      if (el.sendBtn) el.sendBtn.disabled = !ready;
      if (el.pollBtn) el.pollBtn.disabled = !ready;
      renderMailMessages(Array.isArray(j.messages) ? j.messages : []);
      return j;
    } catch (error) {
      setMetricStatus(observerApp, el.status, "Unavailable", "tone-bad");
      if (el.agent) el.agent.textContent = "-";
      if (el.destination) el.destination.textContent = "-";
      if (el.checkedAt) el.checkedAt.textContent = "Error";
      if (el.hint) el.hint.textContent = `Mail status failed: ${error.message}`;
      if (el.summariesEnabled) {
        el.summariesEnabled.checked = true;
        el.summariesEnabled.disabled = true;
      }
      if (el.toEmail) el.toEmail.disabled = true;
      if (el.subject) el.subject.disabled = true;
      if (el.body) el.body.disabled = true;
      if (el.sendBtn) el.sendBtn.disabled = true;
      if (el.pollBtn) el.pollBtn.disabled = true;
      renderMailMessages([]);
      throw error;
    }
  };

  const pollMailInbox = async () => {
    const j = await api("/api/mail/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    await loadMailStatus();
    return j;
  };

  const sendMailMessage = async () => {
    const toEmail = String(el.toEmail?.value || "").trim();
    const subject = String(el.subject?.value || "").trim();
    const text = String(el.body?.value || "").trim();
    if (!toEmail || !text) {
      throw new Error("Enter a destination email and message.");
    }
    const j = await api("/api/mail/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toEmail, subject, text })
    });
    if (el.toEmail) el.toEmail.value = "";
    if (el.subject) el.subject.value = "";
    if (el.body) el.body.value = "";
    if (el.hint) el.hint.textContent = "Message sent.";
    await loadMailStatus();
    return j;
  };

  if (!root.dataset.mailPluginBound) {
    if (el.pollBtn) {
      el.pollBtn.addEventListener("click", async () => {
        el.pollBtn.disabled = true;
        if (el.hint) el.hint.textContent = "Polling mailbox...";
        try {
          const result = await pollMailInbox();
          if (el.hint) {
            el.hint.textContent = result.count
              ? `Found ${result.count} new ${result.count === 1 ? "message" : "messages"} since the last check.`
              : "No new messages.";
          }
        } catch (error) {
          if (el.hint) el.hint.textContent = `Mail poll failed: ${error.message}`;
        } finally {
          await loadMailStatus().catch(() => {});
        }
      });
    }

    if (el.sendBtn) {
      el.sendBtn.addEventListener("click", async () => {
        el.sendBtn.disabled = true;
        if (el.hint) el.hint.textContent = "Sending message...";
        try {
          await sendMailMessage();
        } catch (error) {
          if (el.hint) el.hint.textContent = `Mail send failed: ${error.message}`;
        } finally {
          await loadMailStatus().catch(() => {});
        }
      });
    }

    if (el.summariesEnabled) {
      el.summariesEnabled.addEventListener("change", async () => {
        const enabled = el.summariesEnabled.checked;
        el.summariesEnabled.disabled = true;
        if (el.hint) el.hint.textContent = enabled ? "Enabling email summaries..." : "Disabling email summaries...";
        try {
          await api("/api/mail/summary-setting", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled })
          });
          if (el.hint) el.hint.textContent = enabled ? "Email summaries enabled." : "Email summaries disabled.";
        } catch (error) {
          el.summariesEnabled.checked = !enabled;
          if (el.hint) el.hint.textContent = `Mail summary setting failed: ${error.message}`;
        } finally {
          await loadMailStatus().catch(() => {});
        }
      });
    }

    if (el.messages) {
      el.messages.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const button = target.closest(".mail-delete-btn");
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }
        const messageId = String(button.dataset.messageId || "").trim();
        if (!messageId) {
          if (el.hint) el.hint.textContent = "This message cannot be deleted because it has no message id.";
          return;
        }
        button.disabled = true;
        if (el.hint) el.hint.textContent = "Deleting message...";
        try {
          await api("/api/mail/move", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              destination: "trash",
              messageId
            })
          });
          if (el.hint) el.hint.textContent = "Message moved to trash.";
          await loadMailStatus();
        } catch (error) {
          button.disabled = false;
          if (el.hint) el.hint.textContent = `Mail delete failed: ${error.message}`;
        }
      });
    }

    root.dataset.mailPluginBound = "1";
  }

  observerApp.loadMailStatus = loadMailStatus;
  observerApp.pollMailInbox = pollMailInbox;
  observerApp.sendMailMessage = sendMailMessage;
  observerApp.buildMailObservation = buildMailObservation;

  if (!observerApp.__mailPluginRefreshIntervalMs) {
    observerApp.__mailPluginRefreshIntervalMs = 30_000;
    observerApp.__mailPluginRefreshTimer = window.setInterval(() => {
      observerApp.loadMailStatus?.().catch(() => {});
    }, observerApp.__mailPluginRefreshIntervalMs);
  }

  if (!observerApp.__mailPluginObserverEventsHookBound) {
    observerApp.__mailPluginObserverEventsHookBound = true;
    const observerEvents = new EventSource("/events/observer");
    observerEvents.onmessage = (ev) => {
      let data = null;
      try {
        data = JSON.parse(ev.data);
      } catch {
        data = null;
      }
      if (!data || data.type === "observer.connected") {
        return;
      }
      if (data.type === "mail.message" && data.mail) {
        const observation = buildMailObservation(data.mail);
        if (typeof observerApp.enqueueUpdate === "function") {
          observerApp.enqueueUpdate({
            source: "mail",
            title: "New mail",
            displayText: observation.displayText,
            spokenText: observation.spokenText,
            rawText: observation.displayText,
            status: "ok",
            brainLabel: data.mail.agentLabel || "Mail"
          }, { priority: true });
        }
        observerApp.loadMailStatus?.();
        return;
      }
      if (data.type === "mail.command" && data.mail) {
        const commandText = String(data.mail?.command?.text || "").trim();
        const actionText = String(data.mail?.command?.action || "detected").replaceAll("_", " ");
        if (typeof observerApp.enqueueUpdate === "function") {
          observerApp.enqueueUpdate({
            source: "mail",
            title: "Mail command",
            displayText: `${String(data.mail.fromName || data.mail.fromAddress || "Someone")} sent a mail command.\n\nAction: ${actionText}${commandText ? `\nCommand: ${commandText}` : ""}`,
            spokenText: typeof observerApp.annotateNovaEmotion === "function"
              ? observerApp.annotateNovaEmotion(`${String(data.mail.fromName || data.mail.fromAddress || "Someone")} sent a mail command. Action ${actionText}.`, "wave")
              : `${String(data.mail.fromName || data.mail.fromAddress || "Someone")} sent a mail command. Action ${actionText}.`,
            rawText: commandText,
            status: data.mail?.command?.action === "auto_queue" ? "queued" : "warn",
            brainLabel: data.mail.agentLabel || "Mail"
          }, { priority: true });
        }
        observerApp.loadMailStatus?.();
        return;
      }
      if (data.type === "mail.quarantined" && data.mail) {
        const notice = String(data.mail.notice || "I trashed a spam message.").trim();
        if (typeof observerApp.enqueueUpdate === "function") {
          observerApp.enqueueUpdate({
            source: "mail",
            title: "Mail trashed",
            displayText: notice,
            spokenText: notice,
            rawText: "",
            status: "warn",
            brainLabel: data.mail.agentLabel || "Mail"
          }, { priority: true });
        }
        observerApp.loadMailStatus?.();
      }
    };
  }

  await loadMailStatus().catch(() => {});
}
