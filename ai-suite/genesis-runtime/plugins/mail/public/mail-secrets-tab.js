import { escapeHtml as h } from "/plugin-tab-shared.js";

let mailSecretsRoot = null;
let observerAppRef = {};

function safeId(value = "") {
  return String(value || "").trim().replace(/[^a-z0-9_-]+/gi, "-");
}

function getElements(root = mailSecretsRoot) {
  if (!(root instanceof HTMLElement)) {
    return {};
  }
  return {
    hintEl: root.querySelector("#mailSecretsPluginHint"),
    listEl: root.querySelector("#mailSecretsPluginList")
  };
}

function ensureMarkup(root = mailSecretsRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.mailSecretsMounted === "1") {
    return;
  }
  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>Mail Agent Passwords</h3>
          <div class="panel-subtle">Store IMAP and SMTP passwords per mail agent without writing them into config.</div>
        </div>
      </div>
      <div id="mailSecretsPluginHint" class="panel-subtle">Loading mail secrets...</div>
      <div id="mailSecretsPluginList" class="stack-list">Loading mail secrets...</div>
    </div>
  `;
  root.dataset.mailSecretsMounted = "1";
}

async function loadMailSecrets() {
  const { hintEl, listEl } = getElements();
  if (!(listEl instanceof HTMLElement)) {
    return;
  }
  if (hintEl) {
    hintEl.textContent = "Loading mail secrets...";
  }
  listEl.innerHTML = `<div class="panel-subtle">Loading mail secrets...</div>`;
  try {
    const response = await fetch("/api/secrets/catalog");
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "failed to load secrets catalog");
    }
    const catalog = payload.catalog && typeof payload.catalog === "object" ? payload.catalog : {};
    const mail = catalog.mail && typeof catalog.mail === "object" ? catalog.mail : { agents: [] };
    const mailAgents = Array.isArray(mail.agents) ? mail.agents : [];
    if (!mailAgents.length) {
      if (hintEl) {
        hintEl.textContent = "No mail agents are configured.";
      }
      listEl.innerHTML = `<div class="panel-subtle">No mail agents are configured.</div>`;
      return;
    }
    if (hintEl) {
      hintEl.textContent = `${mail.enabled ? "Mail is enabled." : "Mail is disabled."} Active agent: ${h(mail.activeAgentId || "(none)")}.`;
    }
    listEl.innerHTML = mailAgents.map((agent) => {
      const handle = String(agent.passwordHandle || "").trim();
      const inputId = `mail-secrets-input-${safeId(agent.id || handle || "agent")}`;
      const label = String(agent.label || agent.id || "Mail agent").trim() || "Mail agent";
      const sublabel = [agent.email || agent.user || agent.id || "", agent.active ? "active agent" : ""].filter(Boolean).join(" | ");
      return `
        <div class="secret-card">
          <div class="panel-head compact">
            <div>
              <strong>${h(label)}</strong>
              <div class="panel-subtle">${h(sublabel)}</div>
            </div>
            <span class="brain-pill ${agent.hasSecret ? "tone-ok" : "tone-warn"}">${h(agent.hasSecret ? "Stored" : "Missing")}</span>
          </div>
          <div class="micro"><strong>Handle:</strong> <code>${h(handle)}</code></div>
          <div class="controls secret-controls">
            <input id="${inputId}" type="password" placeholder="Enter mailbox password" />
            <button class="secondary" type="button" data-mail-secret-store="${h(handle)}" data-mail-secret-input="${inputId}">Store</button>
            <button class="secondary" type="button" data-mail-secret-clear="${h(handle)}">Clear</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-mail-secret-store]").forEach((button) => {
      button.addEventListener("click", async () => {
        const handle = String(button.getAttribute("data-mail-secret-store") || "").trim();
        const inputId = String(button.getAttribute("data-mail-secret-input") || "").trim();
        const input = inputId ? document.getElementById(inputId) : null;
        const value = String(input?.value || "");
        if (!handle || !value) {
          if (hintEl) {
            hintEl.textContent = "Choose a handle and enter a value first.";
          }
          return;
        }
        await observerAppRef.storeSecretHandle?.(handle, value);
        if (input) {
          input.value = "";
        }
        await loadMailSecrets();
      });
    });

    listEl.querySelectorAll("[data-mail-secret-clear]").forEach((button) => {
      button.addEventListener("click", async () => {
        const handle = String(button.getAttribute("data-mail-secret-clear") || "").trim();
        if (!handle) {
          return;
        }
        await observerAppRef.clearSecretHandle?.(handle);
        await loadMailSecrets();
      });
    });
  } catch (error) {
    if (hintEl) {
      hintEl.textContent = `Mail secrets failed: ${error.message}`;
    }
    listEl.innerHTML = `<div class="panel-subtle">Mail secrets failed: ${h(error.message)}</div>`;
  }
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  mailSecretsRoot = root;
  observerAppRef = context?.observerApp && typeof context.observerApp === "object"
    ? context.observerApp
    : {};
  ensureMarkup(root);
  await loadMailSecrets();
}

export async function refreshPluginTab(context = {}) {
  if (context?.root instanceof HTMLElement) {
    mailSecretsRoot = context.root;
  }
  if (context?.observerApp && typeof context.observerApp === "object") {
    observerAppRef = context.observerApp;
  }
  ensureMarkup(mailSecretsRoot);
  await loadMailSecrets();
}
