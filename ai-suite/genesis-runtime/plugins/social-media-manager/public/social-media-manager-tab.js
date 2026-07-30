import { escapeHtml as socialEscape } from "/plugin-tab-shared.js";

async function socialFetch(path = "", options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `request failed (${response.status})`);
  }
  return payload;
}

function renderSocialList(container, items = [], renderer) {
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = `<div class="panel-subtle">Nothing tracked yet.</div>`;
    return;
  }
  container.innerHTML = items.map(renderer).join("");
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  if (!document.getElementById("socialMediaManagerStyles")) {
    const style = document.createElement("style");
    style.id = "socialMediaManagerStyles";
    style.textContent = `
      .smm-grid { display: grid; gap: 12px; }
      .smm-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
      .smm-list { display: grid; gap: 10px; }
      .smm-card { display: grid; gap: 8px; }
      .smm-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .smm-pill { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; font-size: 12px; background: rgba(255,255,255,0.55); }
      .smm-copy { white-space: pre-wrap; line-height: 1.45; }
      .smm-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .smm-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    `;
    document.head.appendChild(style);
  }

  if (!root.dataset.socialMediaManagerMounted) {
    root.innerHTML = `
      <section class="inspector smm-grid">
        <div class="panel-head">
          <div>
            <h2>Social Media Manager</h2>
            <div class="panel-subtle">Products, posting opportunities, draft posts, comment replies, and campaign reporting.</div>
          </div>
          <button id="smmRefresh" class="secondary" type="button">Refresh</button>
        </div>

        <div id="smmHint" class="hint">Loading social media manager...</div>

        <section class="status-strip">
          <div class="card"><div class="metric-label">Products</div><div id="smmProductsMetric" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Targets</div><div id="smmTargetsMetric" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Opportunities</div><div id="smmOppsMetric" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Posts</div><div id="smmPostsMetric" class="metric-value">0</div></div>
          <div class="card"><div class="metric-label">Pending Replies</div><div id="smmRepliesMetric" class="metric-value">0</div></div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Add Product</h3></div>
          <div class="smm-two">
            <input id="smmName" placeholder="Product name" />
            <input id="smmUrl" placeholder="Product URL" />
          </div>
          <div class="smm-two">
            <input id="smmAudience" placeholder="Target audience" />
            <input id="smmValue" placeholder="Value proposition" />
          </div>
          <textarea id="smmDescription" rows="3" placeholder="Description"></textarea>
          <div class="smm-two">
            <input id="smmKeywords" placeholder="Keywords, comma separated" />
            <button id="smmSaveProduct" type="button">Save Product</button>
          </div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Publishing Target</h3></div>
          <div class="smm-controls">
            <input id="smmTargetPlatform" placeholder="Platform, e.g. x" />
            <input id="smmTargetAccount" placeholder="Account ID" value="default" />
            <input id="smmTargetLabel" placeholder="Label" />
          </div>
          <div class="smm-controls">
            <input id="smmTargetComposer" placeholder="Composer URL" />
            <input id="smmTargetBody" placeholder="Body selector" />
            <input id="smmTargetSubmit" placeholder="Submit selector" />
          </div>
          <div class="smm-controls">
            <input id="smmTargetTitle" placeholder="Title selector (optional)" />
            <input id="smmTargetComment" placeholder="Comment selector (optional)" />
            <input id="smmTargetCommentText" placeholder="Comment text selector (optional)" />
          </div>
          <button id="smmSaveTarget" type="button">Save Target</button>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact">
            <h3>Publishing Targets</h3>
            <button id="smmMonitorPosts" class="secondary" type="button">Monitor Published</button>
          </div>
          <div id="smmTargets" class="smm-list">Loading...</div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Products</h3></div>
          <div id="smmProducts" class="smm-list">Loading...</div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Opportunities</h3></div>
          <div id="smmOpportunities" class="smm-list">Loading...</div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Drafts & Published Posts</h3></div>
          <div id="smmPosts" class="smm-list">Loading...</div>
        </section>

        <section class="brain-editor-card smm-grid">
          <div class="panel-head compact"><h3>Interactions</h3></div>
          <div id="smmInteractions" class="smm-list">Loading...</div>
        </section>
      </section>
    `;
    root.dataset.socialMediaManagerMounted = "1";
  }

  const hint = root.querySelector("#smmHint");
  const productsMetric = root.querySelector("#smmProductsMetric");
  const targetsMetric = root.querySelector("#smmTargetsMetric");
  const oppsMetric = root.querySelector("#smmOppsMetric");
  const postsMetric = root.querySelector("#smmPostsMetric");
  const repliesMetric = root.querySelector("#smmRepliesMetric");
  const productsEl = root.querySelector("#smmProducts");
  const targetsEl = root.querySelector("#smmTargets");
  const opportunitiesEl = root.querySelector("#smmOpportunities");
  const postsEl = root.querySelector("#smmPosts");
  const interactionsEl = root.querySelector("#smmInteractions");

  const load = async () => {
    hint.textContent = "Loading social media manager...";
    const payload = await socialFetch("/api/social-media/state");
    const summary = payload.summary || {};
    productsMetric.textContent = String(summary.products || 0);
    targetsMetric.textContent = String(summary.publishingTargets || 0);
    oppsMetric.textContent = String(summary.opportunities || 0);
    postsMetric.textContent = String(summary.posts || 0);
    repliesMetric.textContent = String(summary.needsReview || 0);

    renderSocialList(targetsEl, payload.publishingTargets || [], (target) => `
      <article class="card smm-card">
        <div class="smm-meta"><strong>${socialEscape(target.label || target.id)}</strong><span class="smm-pill">${socialEscape(target.platform)}</span><span class="smm-pill">${socialEscape(target.accountId)}</span></div>
        <div class="panel-subtle">${socialEscape(target.composerUrl || "No composer URL")}</div>
        <div class="panel-subtle">Body: ${socialEscape(target.bodySelector || "-")} &middot; Submit: ${socialEscape(target.submitSelector || "-")}</div>
      </article>
    `);

    renderSocialList(productsEl, payload.products || [], (product) => `
      <article class="card smm-card" data-smm-product-id="${socialEscape(product.id)}">
        <strong>${socialEscape(product.name)}</strong>
        <div class="panel-subtle">${socialEscape(product.audience || "No audience saved")}</div>
        <div>${socialEscape(product.valueProposition || product.description || "")}</div>
        <div class="smm-actions">
          <button class="secondary" type="button" data-smm-action="discover" data-product-id="${socialEscape(product.id)}">Find Places</button>
          <button class="secondary" type="button" data-smm-action="compose" data-product-id="${socialEscape(product.id)}">Draft Posts</button>
        </div>
      </article>
    `);

    renderSocialList(opportunitiesEl, (payload.opportunities || []).slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0)), (opp) => `
      <article class="card smm-card">
        <div class="smm-meta"><strong>${socialEscape(opp.platformName || opp.platform)}</strong><span class="smm-pill">${socialEscape(String(opp.score || 0))}/100</span><span class="smm-pill">${socialEscape(opp.risk || "medium")} risk</span></div>
        <div>${socialEscape(opp.title)}</div>
        <div class="panel-subtle">${socialEscape(opp.postingGuidance)}</div>
        ${opp.url ? `<a href="${socialEscape(opp.url)}" target="_blank" rel="noreferrer">Research link</a>` : ""}
      </article>
    `);

    renderSocialList(postsEl, payload.posts || [], (post) => `
      <article class="card smm-card">
        <div class="smm-meta"><strong>${socialEscape(post.platform || "social")}</strong><span class="smm-pill">${socialEscape(post.status)}</span></div>
        <div class="smm-copy">${socialEscape(post.body)}</div>
        ${post.publishedUrl ? `<a href="${socialEscape(post.publishedUrl)}" target="_blank" rel="noreferrer">Published post</a>` : ""}
        <div class="smm-actions">
          ${post.status !== "published" ? `<button class="secondary" type="button" data-smm-action="publish" data-post-id="${socialEscape(post.id)}">Publish</button>` : ""}
          ${post.status === "published" ? `<button class="secondary" type="button" data-smm-action="monitor-one" data-post-id="${socialEscape(post.id)}">Monitor</button>` : ""}
        </div>
      </article>
    `);

    renderSocialList(interactionsEl, payload.interactions || [], (interaction) => `
      <article class="card smm-card">
        <div class="smm-meta"><strong>${socialEscape(interaction.author || "Unknown")}</strong><span class="smm-pill">${socialEscape(interaction.sentiment)}</span><span class="smm-pill">${socialEscape(interaction.replyStatus)}</span></div>
        <div>${socialEscape(interaction.text)}</div>
        <div class="panel-subtle smm-copy">${socialEscape(interaction.replyDraft)}</div>
      </article>
    `);

    hint.textContent = "Social media manager loaded.";
  };

  if (!root.dataset.socialMediaManagerBound) {
    root.querySelector("#smmRefresh")?.addEventListener("click", () => load().catch((error) => {
      hint.textContent = `Refresh failed: ${error.message}`;
    }));

    root.querySelector("#smmSaveProduct")?.addEventListener("click", async () => {
      const button = root.querySelector("#smmSaveProduct");
      button.disabled = true;
      try {
        const name = String(root.querySelector("#smmName")?.value || "").trim();
        if (!name) throw new Error("Product name is required.");
        await socialFetch("/api/social-media/products", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            url: String(root.querySelector("#smmUrl")?.value || "").trim(),
            audience: String(root.querySelector("#smmAudience")?.value || "").trim(),
            valueProposition: String(root.querySelector("#smmValue")?.value || "").trim(),
            description: String(root.querySelector("#smmDescription")?.value || "").trim(),
            keywords: String(root.querySelector("#smmKeywords")?.value || "").trim()
          })
        });
        root.querySelector("#smmName").value = "";
        root.querySelector("#smmUrl").value = "";
        root.querySelector("#smmAudience").value = "";
        root.querySelector("#smmValue").value = "";
        root.querySelector("#smmDescription").value = "";
        root.querySelector("#smmKeywords").value = "";
        await load();
      } catch (error) {
        hint.textContent = `Save failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });

    root.querySelector("#smmSaveTarget")?.addEventListener("click", async () => {
      const button = root.querySelector("#smmSaveTarget");
      button.disabled = true;
      try {
        const platform = String(root.querySelector("#smmTargetPlatform")?.value || "").trim();
        const composerUrl = String(root.querySelector("#smmTargetComposer")?.value || "").trim();
        const bodySelector = String(root.querySelector("#smmTargetBody")?.value || "").trim();
        const submitSelector = String(root.querySelector("#smmTargetSubmit")?.value || "").trim();
        if (!platform || !composerUrl || !bodySelector || !submitSelector) {
          throw new Error("Platform, composer URL, body selector, and submit selector are required.");
        }
        await socialFetch("/api/social-media/publishing-targets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            platform,
            accountId: String(root.querySelector("#smmTargetAccount")?.value || "default").trim(),
            label: String(root.querySelector("#smmTargetLabel")?.value || "").trim(),
            composerUrl,
            bodySelector,
            submitSelector,
            titleSelector: String(root.querySelector("#smmTargetTitle")?.value || "").trim(),
            commentSelector: String(root.querySelector("#smmTargetComment")?.value || "").trim(),
            commentTextSelector: String(root.querySelector("#smmTargetCommentText")?.value || "").trim()
          })
        });
        hint.textContent = "Publishing target saved.";
        await load();
      } catch (error) {
        hint.textContent = `Target save failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });

    root.querySelector("#smmMonitorPosts")?.addEventListener("click", async () => {
      const button = root.querySelector("#smmMonitorPosts");
      button.disabled = true;
      try {
        const payload = await socialFetch("/api/social-media/posts/monitor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        hint.textContent = `Monitor complete: ${(payload.monitored || []).reduce((sum, entry) => sum + Number(entry.recordedCount || 0), 0)} new interactions.`;
        await load();
      } catch (error) {
        hint.textContent = `Monitor failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });

    root.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-smm-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.smmAction;
      button.disabled = true;
      try {
        if (action === "discover") {
          const productId = button.dataset.productId;
          if (!productId) return;
          await socialFetch("/api/social-media/opportunities/discover", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ productId })
          });
        }
        if (action === "compose") {
          const productId = button.dataset.productId;
          if (!productId) return;
          await socialFetch("/api/social-media/posts/compose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ productId, count: 3 })
          });
        }
        if (action === "publish") {
          const postId = button.dataset.postId;
          if (!postId) return;
          const payload = await socialFetch(`/api/social-media/posts/${encodeURIComponent(postId)}/publish`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({})
          });
          hint.textContent = payload.text || "Post published.";
        }
        if (action === "monitor-one") {
          const postId = button.dataset.postId;
          if (!postId) return;
          const payload = await socialFetch("/api/social-media/posts/monitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ postId })
          });
          hint.textContent = payload.text || "Post monitored.";
        }
        await load();
      } catch (error) {
        hint.textContent = `${action} failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });

    root.dataset.socialMediaManagerBound = "1";
  }

  await load().catch((error) => {
    hint.textContent = `Social media manager unavailable: ${error.message}`;
  });
}
