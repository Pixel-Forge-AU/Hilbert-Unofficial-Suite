import { escapeHtml as h } from "/plugin-tab-shared.js";

async function api(path = "", options = {}) {
  const r = await fetch(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

function fmtInput(ts = 0) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfMonth(ts = Date.now()) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function buildOccurrences(events, rangeStartMs, rangeEndMs) {
  const results = [];
  for (const ev of events) {
    const startAt = Number(ev.startAt || 0);
    if (!startAt) continue;
    const freq = String(ev.repeat?.frequency || "none");
    if (freq === "none") {
      if (startAt >= rangeStartMs && startAt <= rangeEndMs) {
        results.push({ ...ev, occurrenceAt: startAt });
      }
      continue;
    }
    if (freq === "daily" || freq === "weekly") {
      const intervalMs = freq === "weekly"
        ? Math.max(1, Number(ev.repeat?.interval || 1)) * 7 * 86400000
        : Math.max(1, Number(ev.repeat?.interval || 1)) * 86400000;
      let t = startAt;
      if (t < rangeStartMs) {
        const steps = Math.ceil((rangeStartMs - t) / intervalMs);
        t += steps * intervalMs;
      }
      while (t <= rangeEndMs) {
        results.push({ ...ev, occurrenceAt: t });
        t += intervalMs;
      }
    } else if (freq === "monthly") {
      const d0 = new Date(startAt);
      const step = Math.max(1, Number(ev.repeat?.interval || 1));
      let year = d0.getFullYear();
      let month = d0.getMonth();
      while (true) {
        const t = new Date(year, month, d0.getDate(), d0.getHours(), d0.getMinutes()).getTime();
        if (t > rangeEndMs) break;
        if (t >= rangeStartMs) results.push({ ...ev, occurrenceAt: t });
        month += step;
        if (month > 11) { year += Math.floor(month / 12); month = month % 12; }
      }
    } else if (freq === "yearly") {
      const d0 = new Date(startAt);
      const step = Math.max(1, Number(ev.repeat?.interval || 1));
      let year = d0.getFullYear();
      while (true) {
        const t = new Date(year, d0.getMonth(), d0.getDate(), d0.getHours(), d0.getMinutes()).getTime();
        if (t > rangeEndMs) break;
        if (t >= rangeStartMs) results.push({ ...ev, occurrenceAt: t });
        year += step;
      }
    }
  }
  return results;
}

function setSubtab(root, id = "daily") {
  root.dataset.calTab = id;
  root.querySelectorAll("[data-cal-subtab-target]").forEach((b) => b.classList.toggle("active", b.dataset.calSubtabTarget === id));
  root.querySelectorAll("[data-cal-subtab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.calSubtabPanel === id));
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  if (!document.getElementById("calendarPluginStyles")) {
    const s = document.createElement("style");
    s.id = "calendarPluginStyles";
    s.textContent = `
      .cal-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .cal-subtabs button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}
      .cal-subtabs button.active{background:var(--accent);color:#fff;border-color:transparent}
      [data-cal-subtab-panel]{display:none}[data-cal-subtab-panel].active{display:block}
      .cal-list{display:grid;gap:8px}.cal-item{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel);color:var(--ink)}
      .cal-actions{display:flex;gap:8px;flex-wrap:wrap}
      .cal-month-nav{display:flex;align-items:center;gap:12px;margin-bottom:10px}
      .cal-month-nav span{flex:1;text-align:center;font-weight:700}
      .cal-month-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
      .cal-month-head{text-align:center;font-size:.75em;font-weight:700;padding:4px 0;opacity:.6}
      .cal-month-cell{border:1px solid var(--border);border-radius:6px;padding:6px 4px;min-height:36px;font:inherit;font-size:.85em;background:var(--panel);color:var(--ink);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
      .cal-month-cell:empty{background:transparent;border-color:transparent;cursor:default}
      .cal-month-cell.today{border-color:var(--accent);font-weight:700}
      .cal-month-cell.selected{background:var(--accent);color:#fff;border-color:transparent}
      .cal-badge{font-size:.72em;line-height:1;margin-top:2px;opacity:.9}
      .cal-brain-row{margin-top:6px}
    `;
    document.head.appendChild(s);
  }

  if (!root.dataset.calendarMounted) {
    root.innerHTML = `
      <section class="inspector">
        <div class="panel-head">
          <div><h2>Calendar</h2><div class="panel-subtle">Plugin-owned calendar and to-do.</div></div>
          <div class="projects-actions">
            <button id="calRefreshBtn" class="secondary" type="button">Refresh</button>
            <button id="calNewBtn" type="button">New event</button>
          </div>
        </div>
        <div id="calHint" class="hint">Loading calendar...</div>
        <div class="cal-subtabs" role="tablist">
          <button class="active" type="button" data-cal-subtab-target="daily">Daily</button>
          <button type="button" data-cal-subtab-target="month">Month</button>
          <button type="button" data-cal-subtab-target="edit">Edit</button>
          <button type="button" data-cal-subtab-target="todo">To do</button>
        </div>

        <section class="brain-editor-card active" data-cal-subtab-panel="daily">
          <div id="calDayHead" class="panel-subtle">Today</div>
          <div id="calEvents" class="cal-list">Loading events...</div>
        </section>

        <section class="brain-editor-card" data-cal-subtab-panel="month">
          <div class="cal-month-nav">
            <button id="calMonthPrev" class="secondary" type="button">&lsaquo;</button>
            <span id="calMonthLabel"></span>
            <button id="calMonthNext" class="secondary" type="button">&rsaquo;</button>
          </div>
          <div id="calMonthGrid"></div>
        </section>

        <section class="brain-editor-card" data-cal-subtab-panel="edit">
          <div class="controls"><input id="calTitle" placeholder="Event title" /><select id="calType"><option value="personal">Personal</option><option value="nova_action">Nova action</option></select></div>
          <div class="controls"><input id="calStart" type="datetime-local" /><input id="calEnd" type="datetime-local" /></div>
          <div class="controls"><input id="calLocation" placeholder="Location" /><select id="calRepeat"><option value="none">No repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
          <textarea id="calDesc" placeholder="Details"></textarea>
          <div id="calBrainRow" class="cal-brain-row controls" style="display:none"><label style="font-size:.85em;opacity:.7">Brain</label><select id="calBrain"><option value="worker">Default worker</option></select></div>
          <div class="cal-actions"><button id="calSaveBtn" type="button">Save</button><button id="calDoneBtn" class="secondary" type="button">Mark complete</button><button id="calCancelBtn" class="secondary" type="button">Cancel</button><button id="calDeleteBtn" class="secondary" type="button">Delete</button></div>
        </section>

        <section class="brain-editor-card" data-cal-subtab-panel="todo">
          <div class="todo-compose"><textarea id="calTodoText" class="queue-answer-input" rows="2" placeholder="Add a to do item"></textarea><div class="queue-item-actions"><button id="calTodoAddBtn" type="button">Add item</button></div></div>
          <div id="calTodoHint" class="panel-subtle">Loading to do...</div>
          <div><strong>Open</strong><div id="calTodoOpen" class="cal-list">Loading...</div></div>
          <div><strong>Completed</strong><div id="calTodoDone" class="cal-list">Loading...</div></div>
        </section>
      </section>
    `;
    root.dataset.calendarMounted = "1";
  }

  const el = {
    hint: root.querySelector("#calHint"),
    dayHead: root.querySelector("#calDayHead"),
    events: root.querySelector("#calEvents"),
    title: root.querySelector("#calTitle"),
    type: root.querySelector("#calType"),
    start: root.querySelector("#calStart"),
    end: root.querySelector("#calEnd"),
    location: root.querySelector("#calLocation"),
    repeat: root.querySelector("#calRepeat"),
    desc: root.querySelector("#calDesc"),
    brain: root.querySelector("#calBrain"),
    brainRow: root.querySelector("#calBrainRow"),
    save: root.querySelector("#calSaveBtn"),
    done: root.querySelector("#calDoneBtn"),
    cancel: root.querySelector("#calCancelBtn"),
    del: root.querySelector("#calDeleteBtn"),
    todoText: root.querySelector("#calTodoText"),
    todoHint: root.querySelector("#calTodoHint"),
    todoOpen: root.querySelector("#calTodoOpen"),
    todoDone: root.querySelector("#calTodoDone"),
    refresh: root.querySelector("#calRefreshBtn"),
    addNew: root.querySelector("#calNewBtn"),
    todoAdd: root.querySelector("#calTodoAddBtn"),
    monthLabel: root.querySelector("#calMonthLabel"),
    monthGrid: root.querySelector("#calMonthGrid"),
    monthPrev: root.querySelector("#calMonthPrev"),
    monthNext: root.querySelector("#calMonthNext")
  };

  const state = {
    events: [],
    todos: { open: [], completed: [] },
    brains: [],
    activeId: "",
    selectedDay: dayKey(),
    monthAnchorMs: startOfMonth()
  };

  const populateBrains = (brains = []) => {
    state.brains = brains.filter((b) => b.kind === "worker" && b.toolCapable);
    if (!el.brain || !state.brains.length) return;
    el.brain.innerHTML = state.brains.map((b) => `<option value="${h(String(b.id || ""))}">${h(String(b.label || b.id || ""))}</option>`).join("");
  };

  const resetForm = () => {
    state.activeId = "";
    const s = new Date(); s.setHours(9, 0, 0, 0);
    const e = new Date(s.getTime() + 60 * 60 * 1000);
    el.title.value = ""; el.type.value = "personal"; el.start.value = fmtInput(s.getTime()); el.end.value = fmtInput(e.getTime());
    el.location.value = ""; el.repeat.value = "none"; el.desc.value = "";
    el.brain.value = state.brains[0]?.id || "worker";
    el.brainRow.style.display = "none";
  };

  const fillForm = (ev = null) => {
    if (!ev) return resetForm();
    state.activeId = String(ev.id || "");
    el.title.value = String(ev.title || ""); el.type.value = String(ev.type || "personal");
    el.start.value = fmtInput(Number(ev.startAt || 0)); el.end.value = fmtInput(Number(ev.endAt || 0));
    el.location.value = String(ev.location || ""); el.repeat.value = String(ev.repeat?.frequency || "none"); el.desc.value = String(ev.description || "");
    el.brain.value = String(ev.action?.requestedBrainId || state.brains[0]?.id || "worker");
    el.brainRow.style.display = el.type.value === "nova_action" ? "" : "none";
  };

  const renderEvents = () => {
    const selected = state.selectedDay;
    const dayStart = new Date(selected + "T00:00:00").getTime();
    const dayEnd = dayStart + 86400000 - 1;
    const todays = buildOccurrences(state.events, dayStart, dayEnd).filter((o) => dayKey(o.occurrenceAt) === selected);
    el.dayHead.textContent = `Agenda ${selected}`;

    const makeEventButtons = (list) => {
      const html = list.map((o) => `<button type="button" class="cal-item" data-cal-id="${h(String(o.id || ""))}"><strong>${h(String(o.title || "Untitled"))}</strong><div class="micro">${h(String(o.status || "active"))} &middot; ${h(String(o.type || "personal"))}</div></button>`).join("");
      el.events.innerHTML = html;
      el.events.querySelectorAll("[data-cal-id]").forEach((b) => b.addEventListener("click", () => {
        const ev = state.events.find((x) => String(x.id || "") === String(b.dataset.calId || ""));
        if (!ev) return;
        fillForm(ev);
        setSubtab(root, "edit");
      }));
    };

    if (todays.length) {
      makeEventButtons(todays);
      return;
    }

    // No events today — show upcoming events as a fallback
    const now = dayStart;
    const upcoming = state.events
      .filter((ev) => ev.status === "active" && Number(ev.nextOccurrenceAt || ev.startAt || 0) >= now)
      .sort((a, b) => Number(a.nextOccurrenceAt || a.startAt || 0) - Number(b.nextOccurrenceAt || b.startAt || 0))
      .slice(0, 10);

    if (!upcoming.length) {
      el.events.innerHTML = `<div class="panel-subtle">No events on this day.</div>`;
      return;
    }

    el.events.innerHTML = `<div class="panel-subtle" style="margin-bottom:8px">No events on this day. Upcoming:</div>`;
    const upcomingFrag = document.createElement("div");
    upcomingFrag.innerHTML = upcoming.map((o) => {
      const dateStr = new Date(Number(o.nextOccurrenceAt || o.startAt || 0)).toLocaleDateString();
      return `<button type="button" class="cal-item" data-cal-id="${h(String(o.id || ""))}"><strong>${h(String(o.title || "Untitled"))}</strong><div class="micro">${h(dateStr)} &middot; ${h(String(o.type || "personal"))}</div></button>`;
    }).join("");
    el.events.appendChild(upcomingFrag);
    el.events.querySelectorAll("[data-cal-id]").forEach((b) => b.addEventListener("click", () => {
      const ev = state.events.find((x) => String(x.id || "") === String(b.dataset.calId || ""));
      if (!ev) return;
      fillForm(ev);
      setSubtab(root, "edit");
    }));
  };

  const renderMonth = () => {
    const anchor = state.monthAnchorMs;
    const d = new Date(anchor);
    const year = d.getFullYear();
    const month = d.getMonth();
    el.monthLabel.textContent = d.toLocaleString("default", { month: "long", year: "numeric" });
    const rangeStart = new Date(year, month, 1).getTime();
    const rangeEnd = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
    const occurrences = buildOccurrences(state.events, rangeStart, rangeEnd);
    const eventsByDay = new Map();
    for (const o of occurrences) {
      const key = dayKey(o.occurrenceAt);
      if (!eventsByDay.has(key)) eventsByDay.set(key, []);
      eventsByDay.get(key).push(o);
    }
    const typeIcon = (type) => type === "nova_action" ? "⚡" : "📅";
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = dayKey(Date.now());
    const heads = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((n) => `<div class="cal-month-head">${n}</div>`).join("");
    const blanks = Array.from({ length: firstDow }, () => `<div class="cal-month-cell"></div>`).join("");
    const cells = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const key = dayKey(new Date(year, month, day).getTime());
      const sel = key === state.selectedDay ? " selected" : "";
      const isToday = key === todayKey ? " today" : "";
      const dayEvents = eventsByDay.get(key) || [];
      let badge = "";
      if (dayEvents.length === 1) {
        badge = `<span class="cal-badge">${typeIcon(dayEvents[0].type)}</span>`;
      } else if (dayEvents.length > 1) {
        const hasAction = dayEvents.some((o) => o.type === "nova_action");
        badge = `<span class="cal-badge">${hasAction ? "⚡" : "📅"} ${dayEvents.length}</span>`;
      }
      return `<button type="button" class="cal-month-cell${sel}${isToday}" data-day-key="${h(key)}">${day}${badge}</button>`;
    }).join("");
    el.monthGrid.innerHTML = `<div class="cal-month-grid">${heads}${blanks}${cells}</div>`;
    el.monthGrid.querySelectorAll("[data-day-key]").forEach((b) => b.addEventListener("click", () => {
      state.selectedDay = b.dataset.dayKey;
      setSubtab(root, "daily");
      renderEvents();
    }));
  };

  const renderTodos = () => {
    el.todoOpen.innerHTML = state.todos.open.length
      ? state.todos.open.map((t) => `<article class="cal-item"><strong>${h(String(t.text || ""))}</strong><div class="cal-actions"><button class="secondary" type="button" data-todo-done="${h(String(t.id || ""))}">Complete</button><button class="secondary" type="button" data-todo-rm="${h(String(t.id || ""))}">Remove</button></div></article>`).join("")
      : `<div class="panel-subtle">No open items.</div>`;
    el.todoDone.innerHTML = state.todos.completed.length
      ? state.todos.completed.slice(0, 30).map((t) => `<article class="cal-item"><strong>${h(String(t.text || ""))}</strong></article>`).join("")
      : `<div class="panel-subtle">No completed items.</div>`;
    el.todoHint.textContent = `${state.todos.open.length} open, ${state.todos.completed.length} completed.`;
  };

  const loadAll = async () => {
    const [c, t, r] = await Promise.all([
      api("/api/calendar/events"),
      api("/api/todos"),
      api("/api/runtime/options").catch(() => ({}))
    ]);
    state.events = Array.isArray(c.events) ? c.events : [];
    state.todos = { open: Array.isArray(t.open) ? t.open : [], completed: Array.isArray(t.completed) ? t.completed : [] };
    populateBrains(Array.isArray(r.brains) ? r.brains : []);
    renderEvents();
    renderMonth();
    renderTodos();
    el.hint.textContent = "Calendar loaded.";
  };

  if (!root.dataset.calendarBound) {
    root.querySelectorAll("[data-cal-subtab-target]").forEach((b) => b.addEventListener("click", () => {
      setSubtab(root, b.dataset.calSubtabTarget || "daily");
      if (b.dataset.calSubtabTarget === "month") renderMonth();
    }));
    el.refresh?.addEventListener("click", () => loadAll().catch((e) => (el.hint.textContent = `Refresh failed: ${e.message}`)));
    el.addNew?.addEventListener("click", () => { resetForm(); setSubtab(root, "edit"); el.hint.textContent = "Creating a new event."; });
    el.monthPrev?.addEventListener("click", () => {
      const d = new Date(state.monthAnchorMs);
      state.monthAnchorMs = startOfMonth(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime());
      renderMonth();
    });
    el.monthNext?.addEventListener("click", () => {
      const d = new Date(state.monthAnchorMs);
      state.monthAnchorMs = startOfMonth(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime());
      renderMonth();
    });
    el.type?.addEventListener("change", () => {
      el.brainRow.style.display = el.type.value === "nova_action" ? "" : "none";
    });
    el.save?.addEventListener("click", async () => {
      try {
        const startAt = Date.parse(String(el.start.value || "").trim());
        if (!Number.isFinite(startAt)) throw new Error("Start date/time is required");
        const isNovaAction = el.type.value === "nova_action";
        const result = await api("/api/calendar/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          id: state.activeId || undefined,
          title: el.title.value,
          type: el.type.value,
          startAt,
          endAt: Date.parse(String(el.end.value || "").trim()) || 0,
          location: el.location.value,
          description: el.desc.value,
          repeat: { frequency: el.repeat.value, interval: 1 },
          action: { enabled: isNovaAction, requestedBrainId: isNovaAction ? (el.brain.value || "worker") : "worker", message: "", internetEnabled: true, forceToolUse: true }
        }) });
        state.activeId = String(result.event?.id || "");
        const navigateTs = Number(result.event?.nextOccurrenceAt || result.event?.startAt || startAt);
        state.selectedDay = dayKey(navigateTs);
        await loadAll();
        setSubtab(root, "daily");
        el.hint.textContent = result.message || "Event saved.";
      } catch (e) { el.hint.textContent = `Save failed: ${e.message}`; }
    });
    el.done?.addEventListener("click", async () => {
      if (!state.activeId) return void (el.hint.textContent = "Select an event first.");
      const r = await api(`/api/calendar/events/${encodeURIComponent(state.activeId)}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      await loadAll(); el.hint.textContent = r.message || "Event marked completed.";
    });
    el.cancel?.addEventListener("click", async () => {
      if (!state.activeId) return void (el.hint.textContent = "Select an event first.");
      const r = await api(`/api/calendar/events/${encodeURIComponent(state.activeId)}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      await loadAll(); el.hint.textContent = r.message || "Event cancelled.";
    });
    el.del?.addEventListener("click", async () => {
      if (!state.activeId) return void (el.hint.textContent = "Select an event first.");
      const r = await api(`/api/calendar/events/${encodeURIComponent(state.activeId)}`, { method: "DELETE" });
      state.activeId = ""; await loadAll(); el.hint.textContent = r.message || "Event deleted.";
    });
    el.todoAdd?.addEventListener("click", async () => {
      const text = String(el.todoText.value || "").trim();
      if (!text) return void (el.todoHint.textContent = "Type a to do item first.");
      await api("/api/todos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, createdBy: "user", source: "ui" }) });
      el.todoText.value = ""; await loadAll();
    });
    root.addEventListener("click", async (evt) => {
      const t = evt.target;
      if (!(t instanceof Element)) return;
      const done = t.closest("[data-todo-done]"); const rm = t.closest("[data-todo-rm]");
      if (!(done instanceof HTMLElement) && !(rm instanceof HTMLElement)) return;
      const id = String(done?.dataset.todoDone || rm?.dataset.todoRm || "").trim();
      if (!id) return;
      if (done) await api(`/api/todos/${encodeURIComponent(id)}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed", completedBy: "user", sessionId: "Main" }) });
      else await api(`/api/todos/${encodeURIComponent(id)}/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ removedBy: "user", sessionId: "Main" }) });
      await loadAll();
    });
    root.dataset.calendarBound = "1";
  }

  setSubtab(root, root.dataset.calTab || "daily");
  resetForm();
  try { await loadAll(); } catch (e) { el.hint.textContent = `Calendar unavailable: ${e.message}`; }
  const app = context?.observerApp || {};
  app.registerPluginEventHandler?.("todo", (data) => {
    app.loadTaskQueue?.();
    if (data.type === "todo.created" && data.todo?.createdBy === "nova") {
      app.enqueueUpdate?.({
        source: "task",
        title: "To do added",
        displayText: `I added this to your to do list.\n\n${String(data.todo.text || "").trim()}`,
        spokenText: app.annotateNovaEmotion?.(`I added this to your to do list. ${String(data.todo.text || "").trim()}`, "shrug"),
        status: "waiting_for_user",
        brainLabel: "Nova"
      }, { priority: true });
    } else if (data.type === "todo.reminder") {
      app.enqueueUpdate?.({
        source: "task",
        title: "To do reminder",
        displayText: String(data.text || "You have open to do items."),
        spokenText: app.annotateNovaEmotion?.(String(data.text || "You have open to do items."), "shrug"),
        status: "waiting_for_user",
        brainLabel: "Nova"
      }, { priority: true });
    }
  });
}
