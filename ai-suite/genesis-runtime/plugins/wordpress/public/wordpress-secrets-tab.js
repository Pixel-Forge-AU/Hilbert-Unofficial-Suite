import { escapeHtml as h } from "/plugin-tab-shared.js";

let wordpressSecretsRoot = null;
let observerAppRef = {};

function safeId(value = "") {
  return String(value || "").trim().replace(/[^a-z0-9_-]+/gi, "-");
}

function getElements(root = wordpressSecretsRoot) {
  if (!(root instanceof HTMLElement)) {
    return {};
  }
  return {
    hintEl: root.querySelector("#wordpressSecretsPluginHint"),
    listEl: root.querySelector("#wordpressSecretsPluginList")
  };
}

function ensureMarkup(root = wordpressSecretsRoot) {
  if (!(root instanceof HTMLElement) || root.dataset.wordpressSecretsMounted === "1") {
    return;
  }
  root.innerHTML = `
    <div class="brain-editor-card">
      <div class="panel-head">
        <div>
          <h3>WordPress Bridge Secrets</h3>
          <div class="panel-subtle">Per-site shared secrets used by the Nova WordPress bridge.</div>
        </div>
      </div>
      <div id="wordpressSecretsPluginHint" class="panel-subtle">Loading WordPress secrets...</div>
      <div id="wordpressSecretsPluginList" class="stack-list">Loading WordPress secrets...</div>
    </div>
  `;
  root.dataset.wordpressSecretsMounted = "1";
}

async function loadWordPressSecrets() {
  const { hintEl, listEl } = getElements();
  if (!(listEl instanceof HTMLElement)) {
    return;
  }
  if (hintEl) {
    hintEl.textContent = "Loading WordPress secrets...";
  }
  listEl.innerHTML = `<div class="panel-subtle">Loading WordPress secrets...</div>`;
  try {
    // /api/wordpress/sites already returns sharedSecretHandle/hasSecret/maskedSecret per
    // site (see wordpress-domain.js's listSites) — this used to also fetch the global
    // /api/secrets/catalog aggregator and merge the two, but that aggregator was
    // deliberately removed (see secrets-plugin.js's header) and this tab was never updated
    // to drop the now-dead fetch.
    const sitesResponse = await fetch("/api/wordpress/sites");
    const sitesPayload = await sitesResponse.json();
    if (!sitesResponse.ok || sitesPayload.ok === false) {
      throw new Error(sitesPayload.error || "failed to load WordPress sites");
    }
    const sites = Array.isArray(sitesPayload.sites) ? sitesPayload.sites : [];

    if (hintEl) {
      hintEl.textContent = sites.length
        ? `Tracking ${sites.length} WordPress bridge site${sites.length === 1 ? "" : "s"}.`
        : "No WordPress bridge sites are configured.";
    }

    const addFormId = "wordpressSecretsPluginAddForm";
    listEl.innerHTML = `
      ${sites.length
        ? sites.map((site) => {
          const handle = String(site.sharedSecretHandle || "").trim();
          const siteId = String(site.siteId || "").trim();
          const inputId = `wordpress-secret-input-${safeId(siteId || handle)}`;
          const editFormId = `wordpress-edit-form-${safeId(siteId || handle)}`;
          return `
            <div class="secret-card">
              <div class="panel-head compact">
                <div>
                  <strong>${h(site.label || siteId || "WordPress site")}</strong>
                  <div class="panel-subtle">${h(site.baseUrl || siteId || "")}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                  <span class="brain-pill ${site.hasSecret ? "tone-ok" : "tone-warn"}">${h(site.hasSecret ? "Stored" : "Missing")}</span>
                  <button class="secondary" type="button" data-wordpress-toggle-edit="${h(editFormId)}">Edit</button>
                  <button class="secondary" type="button" data-wordpress-remove-site="${h(siteId)}">Remove</button>
                </div>
              </div>
              <div class="micro"><strong>Handle:</strong> <code>${h(handle)}</code></div>
              <div class="controls secret-controls">
                <input id="${inputId}" type="password" placeholder="Enter WordPress shared secret" />
                <button class="secondary" type="button" data-wordpress-secret-store="${h(handle)}" data-wordpress-secret-input="${h(inputId)}">Store secret</button>
                <button class="secondary" type="button" data-wordpress-secret-clear="${h(handle)}">Clear secret</button>
              </div>
              <div id="${editFormId}" class="stack-list" style="display:none;margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
                <label class="stack-field"><strong>Label</strong><input type="text" data-wordpress-edit-field="label" value="${h(site.label || "")}" placeholder="My Blog" /></label>
                <label class="stack-field"><strong>Base URL</strong><input type="text" data-wordpress-edit-field="baseUrl" value="${h(site.baseUrl || "")}" placeholder="https://example.com" /></label>
                <label class="stack-field"><strong>Key ID</strong><input type="text" data-wordpress-edit-field="keyId" value="${h(site.keyId || "")}" placeholder="api-key-id" /></label>
                <label class="stack-field"><strong>Default status</strong>
                  <select data-wordpress-edit-field="defaultStatus">
                    ${["draft", "publish", "private", "pending", "future"].map((status) => `<option value="${status}"${site.defaultStatus === status ? " selected" : ""}>${status}</option>`).join("")}
                  </select>
                </label>
                <div class="controls">
                  <button class="secondary" type="button" data-wordpress-save-site="${h(siteId)}" data-wordpress-edit-form="${h(editFormId)}">Save changes</button>
                </div>
              </div>
            </div>
          `;
        }).join("")
        : `<div class="panel-subtle">No WordPress bridge sites are configured.</div>`
      }
      <div class="brain-editor-card" style="margin-top:8px;">
        <div class="panel-head compact">
          <div><strong>Add new site</strong></div>
          <button class="secondary" type="button" data-wordpress-toggle-edit="${addFormId}">Show form</button>
        </div>
        <div id="${addFormId}" class="stack-list" style="display:none;margin-top:8px;">
          <label class="stack-field"><strong>Label</strong><input type="text" data-wordpress-new-field="label" placeholder="My Blog" /></label>
          <label class="stack-field"><strong>Base URL</strong><input type="text" data-wordpress-new-field="baseUrl" placeholder="https://example.com" /></label>
          <label class="stack-field"><strong>Key ID</strong><input type="text" data-wordpress-new-field="keyId" placeholder="api-key-id" /></label>
          <label class="stack-field"><strong>Shared secret</strong><input type="password" data-wordpress-new-field="sharedSecret" placeholder="Bridge plugin shared secret" /></label>
          <label class="stack-field"><strong>Default status</strong>
            <select data-wordpress-new-field="defaultStatus">
              ${["draft", "publish", "private", "pending", "future"].map((status) => `<option value="${status}">${status}</option>`).join("")}
            </select>
          </label>
          <div class="controls">
            <button type="button" data-wordpress-add-site="true">Add site</button>
          </div>
        </div>
      </div>
    `;

    listEl.querySelectorAll("[data-wordpress-toggle-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const formId = String(button.getAttribute("data-wordpress-toggle-edit") || "").trim();
        const form = formId ? listEl.querySelector(`#${CSS.escape(formId)}`) : null;
        if (!(form instanceof HTMLElement)) {
          return;
        }
        const isHidden = form.style.display === "none";
        form.style.display = isHidden ? "" : "none";
        button.textContent = isHidden ? "Hide" : (formId === addFormId ? "Show form" : "Edit");
      });
    });

    listEl.querySelectorAll("[data-wordpress-secret-store]").forEach((button) => {
      button.addEventListener("click", async () => {
        const handle = String(button.getAttribute("data-wordpress-secret-store") || "").trim();
        const inputId = String(button.getAttribute("data-wordpress-secret-input") || "").trim();
        const input = inputId ? listEl.querySelector(`#${CSS.escape(inputId)}`) : null;
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
      });
    });

    listEl.querySelectorAll("[data-wordpress-secret-clear]").forEach((button) => {
      button.addEventListener("click", async () => {
        const handle = String(button.getAttribute("data-wordpress-secret-clear") || "").trim();
        if (!handle) {
          return;
        }
        await observerAppRef.clearSecretHandle?.(handle);
      });
    });

    listEl.querySelectorAll("[data-wordpress-remove-site]").forEach((button) => {
      button.addEventListener("click", async () => {
        const siteId = String(button.getAttribute("data-wordpress-remove-site") || "").trim();
        if (!siteId) {
          return;
        }
        const confirmed = typeof window === "undefined"
          || typeof window.confirm !== "function"
          || window.confirm(`Remove WordPress site "${siteId}"? This will also delete its stored secret.`);
        if (!confirmed) {
          return;
        }
        if (hintEl) {
          hintEl.textContent = `Removing site ${siteId}...`;
        }
        try {
          const response = await fetch(`/api/wordpress/sites/${encodeURIComponent(siteId)}`, { method: "DELETE" });
          const payload = await response.json();
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || "failed to remove site");
          }
          if (typeof observerAppRef.loadSecretsCatalog === "function") {
            await observerAppRef.loadSecretsCatalog();
          } else {
            await loadWordPressSecrets();
          }
        } catch (error) {
          if (hintEl) {
            hintEl.textContent = `Remove failed: ${error.message}`;
          }
        }
      });
    });

    listEl.querySelectorAll("[data-wordpress-save-site]").forEach((button) => {
      button.addEventListener("click", async () => {
        const siteId = String(button.getAttribute("data-wordpress-save-site") || "").trim();
        const formId = String(button.getAttribute("data-wordpress-edit-form") || "").trim();
        const form = formId ? listEl.querySelector(`#${CSS.escape(formId)}`) : null;
        if (!siteId || !(form instanceof HTMLElement)) {
          return;
        }
        const body = { siteId };
        form.querySelectorAll("[data-wordpress-edit-field]").forEach((field) => {
          const key = String(field.getAttribute("data-wordpress-edit-field") || "").trim();
          if (!key || !("value" in field)) {
            return;
          }
          body[key] = field.value;
        });
        if (hintEl) {
          hintEl.textContent = `Saving site ${siteId}...`;
        }
        try {
          const response = await fetch("/api/wordpress/sites", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          const payload = await response.json();
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || "failed to save site");
          }
          if (typeof observerAppRef.loadSecretsCatalog === "function") {
            await observerAppRef.loadSecretsCatalog();
          } else {
            await loadWordPressSecrets();
          }
        } catch (error) {
          if (hintEl) {
            hintEl.textContent = `Save failed: ${error.message}`;
          }
        }
      });
    });

    const addSiteBtn = listEl.querySelector("[data-wordpress-add-site='true']");
    if (addSiteBtn) {
      addSiteBtn.addEventListener("click", async () => {
        const body = {};
        listEl.querySelectorAll("[data-wordpress-new-field]").forEach((field) => {
          const key = String(field.getAttribute("data-wordpress-new-field") || "").trim();
          if (!key || !("value" in field)) {
            return;
          }
          body[key] = field.value;
        });
        const baseUrl = String(body.baseUrl || "").trim();
        const keyId = String(body.keyId || "").trim();
        const sharedSecret = String(body.sharedSecret || "").trim();
        if (!baseUrl || !keyId || !sharedSecret) {
          if (hintEl) {
            hintEl.textContent = "Base URL, Key ID, and shared secret are required.";
          }
          return;
        }
        if (hintEl) {
          hintEl.textContent = "Adding WordPress site...";
        }
        try {
          const response = await fetch("/api/wordpress/sites", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          const payload = await response.json();
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || "failed to add site");
          }
          if (typeof observerAppRef.loadSecretsCatalog === "function") {
            await observerAppRef.loadSecretsCatalog();
          } else {
            await loadWordPressSecrets();
          }
        } catch (error) {
          if (hintEl) {
            hintEl.textContent = `Add failed: ${error.message}`;
          }
        }
      });
    }
  } catch (error) {
    if (hintEl) {
      hintEl.textContent = `WordPress secrets failed: ${error.message}`;
    }
    listEl.innerHTML = `<div class="panel-subtle">WordPress secrets failed: ${h(error.message)}</div>`;
  }
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  wordpressSecretsRoot = root;
  observerAppRef = context?.observerApp && typeof context.observerApp === "object"
    ? context.observerApp
    : {};
  ensureMarkup(root);
  await loadWordPressSecrets();
}

export async function refreshPluginTab(context = {}) {
  if (context?.root instanceof HTMLElement) {
    wordpressSecretsRoot = context.root;
  }
  if (context?.observerApp && typeof context.observerApp === "object") {
    observerAppRef = context.observerApp;
  }
  ensureMarkup(wordpressSecretsRoot);
  await loadWordPressSecrets();
}
