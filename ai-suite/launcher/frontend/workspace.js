/* Workspace tab: a multitrack video editor backed by the Concat engine.
 *
 * The engine (via /api/workspace/*) is the only authority on the edit: every
 * change is sent as a command and the UI redraws from the view it returns.
 * The paused monitor shows Concat's exact composited frame; while playing,
 * it plays the source media under the playhead and says so, since that
 * ignores layering and effects.
 *
 * Relies on Studio's globals: showToast, escapeHtml, activateTab.
 */
(function () {
    'use strict';

    const API = '/api/workspace';
    const LAST_PROJECT_KEY = 'ai-suite:workspace-project';
    const MIN_PPS = 4;
    const MAX_PPS = 400;

    const state = {
        initialized: false,
        engineUp: false,
        projects: [],
        projectId: null,
        view: null,
        dirty: false,
        selected: null,
        playhead: 0,
        pps: 40,
        playing: false,
        playStartWall: 0,
        playStartTime: 0,
        frameAbort: null,
        frameTimer: null,
        frameUrl: null,
        frameKey: '',
        queue: Promise.resolve(),
        job: null,
        jobTimer: null,
        libraryItems: [],
        catalogue: null,
        captionJob: null,
        captionTimer: null,
        captionModels: null,
    };

    const $ = (sel) => document.querySelector(`#tab-workspace ${sel}`);

    // -- small helpers ----------------------------------------------------

    function toast(title, message, type) {
        if (typeof window.showToast === 'function') window.showToast(title, message || '', type || 'info');
    }

    function esc(value) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function storageGet(key) {
        try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }

    function storageSet(key, value) {
        try {
            if (value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
        } catch (_) { /* per-viewer convenience only */ }
    }

    async function api(method, path, body, isForm) {
        const options = { method, headers: {} };
        if (body !== undefined) {
            if (isForm) {
                options.body = body;
            } else {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
        }
        const response = await fetch(path.startsWith('/api/') ? path : `${API}${path}`, options);
        let data = null;
        try { data = await response.json(); } catch (_) { data = null; }
        if (!response.ok) {
            const error = new Error((data && data.error) || `Request failed (${response.status})`);
            error.code = data && data.code;
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function fmtTime(seconds, fps) {
        // SMPTE-style HH:MM:SS:FF timecode.
        const rate = Math.round(fps || 30);
        const frames = Math.round(Math.max(0, seconds || 0) * rate);
        const pad = (n) => String(n).padStart(2, '0');
        const f = frames % rate;
        const total = Math.floor(frames / rate);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(f)}`;
    }

    function fmtDuration(seconds) {
        if (!Number.isFinite(seconds)) return '';
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    }

    // -- view accessors -----------------------------------------------------

    function timeline() {
        const project = state.view && state.view.project;
        if (!project) return null;
        const list = project.timelines || [];
        return list.find((t) => t.id === project.activeTimelineId) || list[0] || null;
    }

    function fps() {
        const s = state.view && state.view.settings;
        return s && s.rateNum ? s.rateNum / (s.rateDen || 1) : 30;
    }

    function frameSize() {
        const s = (state.view && state.view.settings) || {};
        return { width: s.width || 1920, height: s.height || 1080 };
    }

    function mediaById(id) {
        return ((state.view && state.view.project.media) || []).find((m) => m.id === id) || null;
    }

    function clips() {
        const tl = timeline();
        return tl ? tl.clips || [] : [];
    }

    function clipKind(clip) {
        const media = mediaById(clip.mediaId);
        return (media && media.kind) || clip.kind || 'video';
    }

    function duration() {
        return clips().reduce((end, c) => Math.max(end, (c.start || 0) + (c.duration || 0)), 0);
    }

    // -- layout -------------------------------------------------------------

    function buildLayout() {
        const root = document.getElementById('tab-workspace');
        root.innerHTML = `
        <div class="ws">
            <div class="ws-banner" id="wsBanner" hidden>
                <span id="wsBannerText">The Workspace engine is not running.</span>
                <button class="btn btn-secondary" type="button" id="wsStartEngine">Start engine</button>
            </div>
            <div class="ws-toolbar">
                <select id="wsProjectSelect" aria-label="Project"></select>
                <button class="btn btn-secondary" type="button" id="wsNew">New</button>
                <button class="btn btn-secondary" type="button" id="wsRename">Rename</button>
                <button class="btn btn-secondary" type="button" id="wsDuplicate">Duplicate</button>
                <button class="btn btn-secondary" type="button" id="wsFromTemplate">From template…</button>
                <button class="btn btn-secondary" type="button" id="wsSaveTemplate">Save as template</button>
                <button class="btn btn-secondary" type="button" id="wsDelete">Delete</button>
                <span class="ws-toolbar-spacer"></span>
                <button class="btn btn-secondary" type="button" id="wsUndo" title="Undo (Ctrl+Z)">Undo</button>
                <button class="btn btn-secondary" type="button" id="wsRedo" title="Redo (Ctrl+Shift+Z)">Redo</button>
                <span class="ws-save-state" id="wsSaveState"></span>
                <button class="btn btn-secondary" type="button" id="wsSave" title="Save (Ctrl+S)">Save</button>
                <div class="ws-export-progress" id="wsExportProgress" hidden>
                    <progress id="wsExportBar" max="1" value="0"></progress>
                    <span id="wsExportText"></span>
                    <button class="btn btn-danger" type="button" id="wsExportCancel">Cancel</button>
                </div>
                <div class="ws-export-progress" id="wsCaptionProgress" hidden>
                    <progress id="wsCaptionBar" max="100" value="0"></progress>
                    <span id="wsCaptionText"></span>
                    <button class="btn btn-danger" type="button" id="wsCaptionCancel">Cancel</button>
                </div>
                <button class="btn btn-primary" type="button" id="wsExport">Export MP4</button>
                <span class="ws-engine" id="wsEngine">Engine: checking</span>
            </div>
            <div class="ws-body">
                <section class="ws-panel">
                    <div class="ws-panel-head">
                        <h4>Media</h4>
                        <span>
                            <button class="btn btn-secondary" type="button" id="wsAddLibrary">Library</button>
                            <button class="btn btn-secondary" type="button" id="wsUploadBtn">Upload</button>
                        </span>
                    </div>
                    <input type="file" id="wsUploadInput" accept="video/*,audio/*,image/*" hidden>
                    <ul class="ws-bin" id="wsBin"></ul>
                    <p class="ws-empty ws-kbd">Drag media onto a track, or double-click to add it at the playhead.</p>
                </section>
                <section class="ws-panel">
                    <div class="ws-monitor" id="wsMonitor">
                        <span class="ws-monitor-badge" id="wsBadge">No project</span>
                        <img id="wsFrame" alt="Preview frame at the playhead" hidden>
                        <video id="wsVideo" playsinline preload="auto" hidden></video>
                    </div>
                    <audio id="wsAudio" preload="auto"></audio>
                    <div class="ws-transport">
                        <button class="btn btn-secondary" type="button" id="wsToStart" title="Go to start (Home)">|&lt;</button>
                        <button class="btn btn-secondary" type="button" id="wsStepBack" title="Previous frame (Left)">&lt;</button>
                        <button class="btn btn-primary" type="button" id="wsPlay" title="Play / pause (Space)">Play</button>
                        <button class="btn btn-secondary" type="button" id="wsStepFwd" title="Next frame (Right)">&gt;</button>
                        <button class="btn btn-secondary" type="button" id="wsSplit" title="Split at playhead (S)">Split</button>
                        <button class="btn btn-secondary" type="button" id="wsRemove" title="Delete selected clip (Delete)">Delete clip</button>
                        <span class="ws-timecode" id="wsTimecode">00:00:00 / 00:00:00</span>
                    </div>
                </section>
                <section class="ws-panel ws-inspector" id="wsInspector"></section>
            </div>
            <section class="ws-timeline">
                <div class="ws-timeline-head">
                    <button class="btn btn-secondary" type="button" id="wsAddTitle">Add title</button>
                    <button class="btn btn-secondary" type="button" id="wsCaptions" title="Transcribe the selected clip's speech into captions">Captions…</button>
                    <button class="btn btn-secondary" type="button" id="wsAddTrack">Add track</button>
                    <label>Zoom <input type="range" id="wsZoom" min="0" max="100" value="45"></label>
                    <span class="ws-kbd">Drag clips to move, drag their edges to trim. Clips on one track can't overlap.</span>
                </div>
                <div class="ws-tracks-wrap">
                    <div class="ws-track-heads" id="wsTrackHeads"></div>
                    <div class="ws-scroll" id="wsScroll">
                        <div class="ws-canvas" id="wsCanvas"></div>
                    </div>
                </div>
            </section>
        </div>
        <dialog class="ws-dialog" id="wsDialog"></dialog>`;
    }

    function bindLayout() {
        $('#wsStartEngine').addEventListener('click', startEngine);
        $('#wsProjectSelect').addEventListener('change', (e) => switchProject(e.target.value));
        $('#wsNew').addEventListener('click', newProjectDialog);
        $('#wsRename').addEventListener('click', renameProject);
        $('#wsDuplicate').addEventListener('click', duplicateProject);
        $('#wsFromTemplate').addEventListener('click', templateGallery);
        $('#wsSaveTemplate').addEventListener('click', saveTemplateDialog);
        $('#wsCaptions').addEventListener('click', () => captionsDialog());
        $('#wsCaptionCancel').addEventListener('click', cancelCaptions);
        $('#wsDelete').addEventListener('click', deleteProject);
        $('#wsUndo').addEventListener('click', () => history('undo'));
        $('#wsRedo').addEventListener('click', () => history('redo'));
        $('#wsSave').addEventListener('click', saveProject);
        $('#wsExport').addEventListener('click', exportDialog);
        $('#wsExportCancel').addEventListener('click', cancelExport);
        $('#wsAddLibrary').addEventListener('click', libraryDialog);
        $('#wsUploadBtn').addEventListener('click', () => $('#wsUploadInput').click());
        $('#wsUploadInput').addEventListener('change', uploadSelected);
        $('#wsToStart').addEventListener('click', () => seek(0, true));
        $('#wsStepBack').addEventListener('click', () => seek(state.playhead - 1 / fps(), true));
        $('#wsStepFwd').addEventListener('click', () => seek(state.playhead + 1 / fps(), true));
        $('#wsPlay').addEventListener('click', togglePlay);
        $('#wsSplit').addEventListener('click', splitAtPlayhead);
        $('#wsRemove').addEventListener('click', removeSelected);
        $('#wsAddTrack').addEventListener('click', () => edit({ op: 'addTrack' }));
        $('#wsAddTitle').addEventListener('click', addTitle);
        $('#wsZoom').addEventListener('input', (e) => {
            const v = Number(e.target.value) / 100;
            state.pps = MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v);
            renderTimeline();
        });
        document.addEventListener('keydown', onKey);
        window.addEventListener('beforeunload', (event) => {
            if (state.dirty) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
        window.addEventListener('resize', () => { if (isActive()) requestFrame(true); });
    }

    function isActive() {
        const panel = document.getElementById('tab-workspace');
        return !!(panel && panel.classList.contains('active'));
    }

    // -- engine and projects -------------------------------------------------

    async function checkEngine() {
        let health;
        try {
            health = await api('GET', '/health');
        } catch (error) {
            health = { available: false, error: error.message };
        }
        state.engineUp = !!health.available;
        if (state.engineUp && !state.catalogue) {
            api('GET', '/catalogue').then((cat) => {
                state.catalogue = cat;
                renderInspector();
            }).catch(() => { /* effect menus stay hidden until it loads */ });
        }
        const chip = $('#wsEngine');
        chip.textContent = health.available ? `Engine: Concat ${health.concat}` : 'Engine: offline';
        chip.classList.toggle('is-up', !!health.available);
        $('#wsBanner').hidden = !!health.available;
        if (!health.available) {
            $('#wsBannerText').textContent = health.error || 'The Workspace engine is not running.';
            $('#wsStartEngine').hidden = health.code === 'version_mismatch';
        }
        renderControls();
        return state.engineUp;
    }

    async function startEngine() {
        const button = $('#wsStartEngine');
        button.disabled = true;
        button.textContent = 'Starting…';
        try {
            await api('POST', '/api/services/concat', { timeout: 60 });
        } catch (error) {
            toast('Could not start the Workspace engine', error.message, 'error');
        } finally {
            button.disabled = false;
            button.textContent = 'Start engine';
        }
        if (await checkEngine()) {
            if (state.projectId) await openProject(state.projectId);
            else await loadProjects(true);
        }
    }

    function handleError(title, error) {
        if (error && error.code === 'unavailable') {
            checkEngine();
        }
        toast(title, error ? error.message : '', 'error');
    }

    async function loadProjects(openRemembered) {
        try {
            const data = await api('GET', '/projects');
            state.projects = data.projects || [];
        } catch (error) {
            handleError('Could not list projects', error);
            state.projects = [];
        }
        renderProjectSelect();
        if (openRemembered && !state.projectId) {
            const remembered = storageGet(LAST_PROJECT_KEY);
            const target = state.projects.find((p) => p.id === remembered) || state.projects[0];
            if (target && state.engineUp) await openProject(target.id);
        }
    }

    function renderProjectSelect() {
        const select = $('#wsProjectSelect');
        const options = state.projects.map((p) =>
            `<option value="${esc(p.id)}"${p.id === state.projectId ? ' selected' : ''}>${esc(p.name)}</option>`);
        if (!state.projectId) options.unshift('<option value="" selected>Choose a project…</option>');
        if (!state.projects.length) options.splice(0, options.length, '<option value="">No projects yet</option>');
        select.innerHTML = options.join('');
    }

    async function openProject(projectId) {
        stopPlayback();
        try {
            const view = await api('GET', `/projects/${encodeURIComponent(projectId)}`);
            setView(view);
            state.projectId = projectId;
            state.selected = null;
            state.playhead = Math.min(state.playhead, duration());
            storageSet(LAST_PROJECT_KEY, projectId);
            renderProjectSelect();
            renderAll();
            requestFrame(true);
        } catch (error) {
            handleError('Could not open project', error);
            renderProjectSelect();
        }
    }

    function setView(view) {
        state.view = view;
        if (typeof view.dirty === 'boolean') state.dirty = view.dirty;
        if (state.selected && !clips().some((c) => c.id === state.selected)) state.selected = null;
    }

    function choice(title, message, buttons) {
        // Resolves with the chosen button's value; Escape resolves 'cancel'.
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>${esc(title)}</h3>
            <p>${esc(message)}</p>
            <div class="ws-dialog-actions">
                ${buttons.map((b) => `<button class="btn ${b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-secondary'}" type="button" data-value="${esc(b.value)}">${esc(b.label)}</button>`).join('')}
            </div>`;
        return new Promise((resolve) => {
            dialog.querySelectorAll('[data-value]').forEach((button) => {
                button.addEventListener('click', () => { dialog.close(); resolve(button.dataset.value); });
            });
            dialog.addEventListener('cancel', () => resolve('cancel'), { once: true });
            dialog.showModal();
        });
    }

    async function resolveUnsaved(action) {
        // Concat keeps unsaved edits in memory until the project is closed;
        // leaving a dirty project asks whether to keep them.
        if (!state.projectId || !state.dirty) return true;
        const name = (state.view.settings && state.view.settings.name) || 'this project';
        const answer = await choice('Unsaved changes', `Save changes to “${name}” before you ${action}?`, [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Discard changes', value: 'discard', danger: true },
            { label: 'Save', value: 'save', primary: true },
        ]);
        if (answer === 'cancel') return false;
        try {
            await api('POST', `/projects/${state.projectId}/close`, { save: answer === 'save' });
            state.dirty = false;
            return true;
        } catch (error) {
            handleError('Could not close the project', error);
            return false;
        }
    }

    async function switchProject(projectId) {
        if (!projectId || projectId === state.projectId) return;
        if (!(await resolveUnsaved('open another project'))) {
            renderProjectSelect();
            return;
        }
        await openProject(projectId);
    }

    function newProjectDialog() {
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>New Workspace project</h3>
            <form method="dialog" id="wsNewForm">
                <div class="ws-form-row"><label for="wsNewName">Name</label><input id="wsNewName" type="text" maxlength="80" value="Untitled edit" required></div>
                <div class="ws-form-row"><label for="wsNewFrame">Frame</label>
                    <select id="wsNewFrame">
                        <option value="1920x1080">1920 × 1080 (landscape HD)</option>
                        <option value="1080x1920">1080 × 1920 (vertical)</option>
                        <option value="1080x1080">1080 × 1080 (square)</option>
                        <option value="1280x720">1280 × 720</option>
                        <option value="3840x2160">3840 × 2160 (4K)</option>
                    </select></div>
                <div class="ws-form-row"><label for="wsNewFps">Frame rate</label>
                    <select id="wsNewFps"><option>24</option><option>25</option><option selected>30</option><option>60</option></select></div>
                <div class="ws-dialog-actions">
                    <button class="btn btn-secondary" value="cancel" type="submit" formnovalidate>Cancel</button>
                    <button class="btn btn-primary" value="create" type="submit">Create</button>
                </div>
            </form>`;
        dialog.addEventListener('close', async function onClose() {
            dialog.removeEventListener('close', onClose);
            if (dialog.returnValue !== 'create') return;
            const [width, height] = $('#wsNewFrame').value.split('x').map(Number);
            const name = $('#wsNewName').value.trim() || 'Untitled edit';
            if (!(await resolveUnsaved('create a new project'))) return;
            try {
                const view = await api('POST', '/projects', { name, width, height, fps: Number($('#wsNewFps').value) });
                await loadProjects(false);
                await openProject(view.id);
            } catch (error) {
                handleError('Could not create the project', error);
            }
        });
        dialog.returnValue = '';
        dialog.showModal();
        $('#wsNewName').select();
    }

    async function renameProject() {
        if (!state.projectId) return;
        const current = (state.view.settings && state.view.settings.name) || '';
        const name = window.prompt('Rename project', current);
        if (!name || name.trim() === current) return;
        try {
            setView(await api('POST', `/projects/${state.projectId}/save`, { name: name.trim() }));
            await loadProjects(false);
            renderAll();
        } catch (error) {
            handleError('Could not rename', error);
        }
    }

    async function duplicateProject() {
        if (!state.projectId) return;
        if (state.dirty) {
            const answer = await choice('Duplicate project', 'The copy is made from the saved project. Save your changes first?', [
                { label: 'Cancel', value: 'cancel' },
                { label: 'Copy last save', value: 'saved' },
                { label: 'Save and duplicate', value: 'save', primary: true },
            ]);
            if (answer === 'cancel') return;
            if (answer === 'save') {
                try {
                    setView(await api('POST', `/projects/${state.projectId}/save`, {}));
                } catch (error) {
                    handleError('Could not save', error);
                    return;
                }
            }
            if (!(await resolveUnsaved('open the copy'))) return;
        }
        try {
            const copy = await api('POST', `/projects/${state.projectId}/duplicate`, {});
            await loadProjects(false);
            await openProject(copy.id);
            toast('Project duplicated', copy.settings.name, 'success');
        } catch (error) {
            handleError('Could not duplicate', error);
        }
    }

    // -- templates -------------------------------------------------------------

    function saveTemplateDialog() {
        if (!state.projectId) return;
        const media = (state.view.project.media || []);
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>Save as template</h3>
            <p>Saves this edit's layout, titles, effects and timing so you can reuse it. Tick the media to leave as <strong>slots</strong>, filled with new footage each time; the rest is copied into the template.</p>
            <form method="dialog">
                <div class="ws-form-row"><label for="wsTplName">Name</label><input id="wsTplName" type="text" maxlength="80" value="${esc((state.view.settings.name || 'Untitled') + ' template')}" required></div>
                <ul class="ws-slot-pick">${media.length ? media.map((m) => `
                    <li><label><input type="checkbox" value="${esc(m.id)}"${m.kind !== 'audio' ? ' checked' : ''}>
                        <span class="ws-kind-dot ws-kind-${esc(m.kind)}"></span> ${esc(m.name)} <span class="ws-bin-meta">${esc(m.kind)}</span></label></li>`).join('')
                    : '<li class="ws-empty">This project has no media; the template will hold only titles and settings.</li>'}</ul>
                <div class="ws-dialog-actions">
                    <button class="btn btn-secondary" value="cancel" type="submit" formnovalidate>Cancel</button>
                    <button class="btn btn-primary" value="save" type="submit">Save template</button>
                </div>
            </form>`;
        dialog.addEventListener('close', async function onClose() {
            dialog.removeEventListener('close', onClose);
            if (dialog.returnValue !== 'save') return;
            const slots = [...dialog.querySelectorAll('.ws-slot-pick input:checked')].map((i) => i.value);
            const name = $('#wsTplName').value.trim();
            toast('Saving template', name, 'info');
            try {
                const template = await api('POST', `/projects/${state.projectId}/template`, { name, slots });
                setView(await api('GET', `/projects/${state.projectId}`));
                renderAll();
                toast('Template saved', `${template.name} · ${template.slots.length} slot${template.slots.length === 1 ? '' : 's'}`, 'success');
            } catch (error) {
                handleError('Could not save the template', error);
            }
        });
        dialog.returnValue = '';
        dialog.showModal();
    }

    async function templateGallery() {
        const dialog = $('#wsDialog');
        dialog.innerHTML = '<h3>New from template</h3><p class="ws-empty">Loading…</p>';
        dialog.showModal();
        let templates = [];
        try {
            templates = (await api('GET', '/templates')).templates || [];
        } catch (error) {
            dialog.close();
            handleError('Could not list templates', error);
            return;
        }
        dialog.innerHTML = `
            <h3>New from template</h3>
            ${templates.length ? `<ul class="ws-template-list">${templates.map((t) => `
                <li>
                    <button type="button" class="ws-template" data-template="${esc(t.id)}">
                        ${t.has_poster ? `<img src="${API}/templates/${esc(t.id)}/poster" alt="">` : '<span class="ws-template-blank"></span>'}
                        <span><strong>${esc(t.name)}</strong><br><span class="ws-bin-meta">${t.width}×${t.height} · ${t.slots.length} slot${t.slots.length === 1 ? '' : 's'}</span></span>
                    </button>
                    <button class="ws-icon-btn" type="button" data-template-delete="${esc(t.id)}" title="Delete template">×</button>
                </li>`).join('')}</ul>`
                : '<p>No templates yet. Open a project and use <strong>Save as template</strong>.</p>'}
            <div class="ws-dialog-actions"><button class="btn btn-secondary" type="button" data-close>Close</button></div>`;
        dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
        dialog.querySelectorAll('[data-template-delete]').forEach((button) => {
            button.addEventListener('click', async () => {
                if (!window.confirm('Delete this template? Projects made from it are kept.')) return;
                try {
                    await api('DELETE', `/templates/${button.dataset.templateDelete}`);
                    templateGallery();
                } catch (error) {
                    handleError('Could not delete the template', error);
                }
            });
        });
        dialog.querySelectorAll('[data-template]').forEach((button) => {
            button.addEventListener('click', () => fillTemplateDialog(templates.find((t) => t.id === button.dataset.template)));
        });
    }

    async function fillTemplateDialog(template) {
        const dialog = $('#wsDialog');
        dialog.innerHTML = `<h3>${esc(template.name)}</h3><p class="ws-empty">Loading your Library…</p>`;
        const items = await loadLibraryItems();
        const options = (kind) => {
            const fitting = items.filter((o) => o.media_type === kind || (kind === 'video' && o.media_type === 'image') || (kind === 'image' && o.media_type === 'video'));
            return fitting.map((o, i) => `<option value="${esc(libraryPath(o))}"${i === 0 ? ' selected' : ''}>${esc(o.filename)}</option>`).join('');
        };
        dialog.innerHTML = `
            <h3>${esc(template.name)}</h3>
            <p>Choose Library media for each slot. The new project keeps the template's timing, titles and effects.</p>
            <form method="dialog">
                <div class="ws-form-row"><label for="wsTplProject">Project name</label><input id="wsTplProject" type="text" maxlength="80" value="${esc(template.name.replace(/ template$/, ''))}"></div>
                ${template.slots.map((slot) => `
                    <div class="ws-form-row"><label>${esc(slot.name)}<br><span class="ws-bin-meta">${esc(slot.kind)} · ${esc(fmtDuration(slot.seconds))}</span></label>
                        <select data-slot="${esc(slot.mediaId)}">${options(slot.kind) || '<option value="">No matching Library items</option>'}</select></div>`).join('')}
                <div class="ws-dialog-actions">
                    <button class="btn btn-secondary" value="cancel" type="submit" formnovalidate>Cancel</button>
                    <button class="btn btn-primary" value="create" type="submit">Create project</button>
                </div>
            </form>`;
        if (!dialog.open) dialog.showModal();
        dialog.addEventListener('close', async function onClose() {
            dialog.removeEventListener('close', onClose);
            if (dialog.returnValue !== 'create') return;
            const fills = [...dialog.querySelectorAll('select[data-slot]')].map((select) => ({ mediaId: select.dataset.slot, source: 'output', path: select.value }));
            if (fills.some((f) => !f.path)) {
                toast('Every slot needs media', 'Add matching items to your Library first.', 'error');
                return;
            }
            if (!(await resolveUnsaved('open the new project'))) return;
            try {
                const view = await api('POST', `/templates/${template.id}/instantiate`, { name: $('#wsTplProject').value.trim(), fills });
                await loadProjects(false);
                await openProject(view.id);
                toast('Project created from template', view.settings.name, 'success');
            } catch (error) {
                handleError('Could not create the project', error);
            }
        });
        dialog.returnValue = '';
    }

    // -- captions ----------------------------------------------------------------

    async function captionsDialog(clipId) {
        if (!state.projectId) return;
        const sounding = clips().filter((c) => {
            const m = mediaById(c.mediaId);
            return m && (m.kind === 'audio' || (m.kind === 'video' && m.hasAudio !== false));
        });
        if (!sounding.length) {
            toast('Nothing to caption', 'Add a video or audio clip with sound first.', 'info');
            return;
        }
        if (!state.captionModels) {
            try {
                state.captionModels = (await api('GET', '/captions/models')).models || [];
            } catch (_) {
                state.captionModels = [];
            }
        }
        if (!state.captionModels.length) {
            toast('Speech recognition is not installed', 'See docs/SERVICES.md (Workspace captions).', 'error');
            return;
        }
        const chosen = clipId || (sounding.find((c) => c.id === state.selected) || sounding[0]).id;
        const modelLabel = { tiny: 'Tiny (fastest)', base: 'Base (fast)', small: 'Small (best)', 'tiny.en': 'Tiny, English', 'base.en': 'Base, English', 'small.en': 'Small, English' };
        const languages = [['auto', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
            ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['ru', 'Russian'], ['ar', 'Arabic']];
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>Make captions</h3>
            <p>Transcribes the clip's speech on this machine (nothing is uploaded) and adds each line as a title, all as one step you can undo.</p>
            <form method="dialog">
                <div class="ws-form-row"><label for="wsCapClip">Clip</label><select id="wsCapClip">
                    ${sounding.map((c) => `<option value="${esc(c.id)}"${c.id === chosen ? ' selected' : ''}>${esc(c.name)} · ${esc(fmtTime(c.start, fps()))}</option>`).join('')}</select></div>
                <div class="ws-form-row"><label for="wsCapModel">Accuracy</label><select id="wsCapModel">
                    ${state.captionModels.map((m) => `<option value="${esc(m)}"${m === 'small' ? ' selected' : ''}>${esc(modelLabel[m] || m)}</option>`).join('')}</select></div>
                <div class="ws-form-row"><label for="wsCapLang">Language</label><select id="wsCapLang">
                    ${languages.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
                <div class="ws-form-row"><label for="wsCapPlace">Placement</label><select id="wsCapPlace">
                    <option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></div>
                <div class="ws-form-row"><label for="wsCapSize">Size</label><select id="wsCapSize">
                    <option value="small">Small</option><option value="medium" selected>Medium</option><option value="large">Large</option></select></div>
                <div class="ws-form-row"><label for="wsCapBox">Background box</label><input id="wsCapBox" type="checkbox" checked></div>
                <div class="ws-dialog-actions">
                    <button class="btn btn-secondary" value="cancel" type="submit" formnovalidate>Cancel</button>
                    <button class="btn btn-primary" value="start" type="submit">Make captions</button>
                </div>
            </form>`;
        dialog.addEventListener('close', async function onClose() {
            dialog.removeEventListener('close', onClose);
            if (dialog.returnValue !== 'start') return;
            try {
                state.captionJob = await api('POST', `/projects/${state.projectId}/captions`, {
                    clipId: $('#wsCapClip').value, model: $('#wsCapModel').value, language: $('#wsCapLang').value,
                    placement: $('#wsCapPlace').value, size: $('#wsCapSize').value, box: $('#wsCapBox').checked,
                });
                renderCaptionProgress();
                pollCaptions();
            } catch (error) {
                handleError(error.code === 'busy' ? 'Captions are already running' : 'Could not start captions', error);
            }
        });
        dialog.returnValue = '';
        dialog.showModal();
    }

    function renderCaptionProgress() {
        const job = state.captionJob;
        const box = $('#wsCaptionProgress');
        box.hidden = !(job && job.status === 'running');
        if (!box.hidden) {
            $('#wsCaptionBar').value = job.percent || 0;
            $('#wsCaptionText').textContent = `Captions: ${job.stage || 'starting'}${job.stage === 'transcribing' ? ` ${job.percent || 0}%` : ''}`;
        }
        renderControls();
    }

    function pollCaptions() {
        clearTimeout(state.captionTimer);
        if (!state.captionJob) return;
        state.captionTimer = setTimeout(async () => {
            try {
                state.captionJob = await api('GET', `/jobs/${state.captionJob.id}`);
            } catch (error) {
                handleError('Lost track of the captions', error);
                state.captionJob = null;
                renderCaptionProgress();
                return;
            }
            renderCaptionProgress();
            const job = state.captionJob;
            if (job.status === 'running') {
                pollCaptions();
            } else if (job.status === 'done') {
                if (job.project === state.projectId) await openProject(state.projectId);
                toast(job.captions ? `Added ${job.captions} captions` : 'No speech found', job.captions ? 'Undo removes them all at once.' : 'Nothing was said in that clip.', job.captions ? 'success' : 'info');
            } else if (job.status !== 'cancelled') {
                toast('Captions failed', job.error || '', 'error');
            }
        }, 500);
    }

    async function cancelCaptions() {
        if (!state.captionJob) return;
        try {
            state.captionJob = await api('POST', `/jobs/${state.captionJob.id}/cancel`);
        } catch (error) {
            handleError('Could not cancel', error);
        }
    }

    async function deleteProject() {
        if (!state.projectId) return;
        const name = (state.view.settings && state.view.settings.name) || 'this project';
        const answer = await choice('Delete project', `Delete “${name}” and any media uploaded into it? Library items and finished exports are kept.`, [
            { label: 'Cancel', value: 'cancel' },
            { label: 'Delete project', value: 'delete', danger: true },
        ]);
        if (answer !== 'delete') return;
        try {
            await api('DELETE', `/projects/${state.projectId}`);
            storageSet(LAST_PROJECT_KEY, null);
            state.projectId = null;
            state.view = null;
            state.dirty = false;
            await loadProjects(true);
            renderAll();
        } catch (error) {
            handleError('Could not delete the project', error);
        }
    }

    async function saveProject() {
        if (!state.projectId) return;
        try {
            setView(await api('POST', `/projects/${state.projectId}/save`, {}));
            renderControls();
            toast('Saved', '', 'success');
        } catch (error) {
            handleError('Could not save', error);
        }
    }

    // -- edits ----------------------------------------------------------------

    const NOOP_HINTS = {
        moveClips: 'Clips on one track can’t overlap.',
        trimClip: 'The clip can’t be trimmed that way (it has a minimum length and its source has an end).',
        splitClips: 'Put the playhead inside the clip to split it.',
        addClip: 'The media could not be placed there.',
    };

    function edit(command) {
        // Serialise edits so a fast sequence of drags lands in order.
        state.queue = state.queue.then(async () => {
            if (!state.projectId) return null;
            try {
                const view = await api('POST', `/projects/${state.projectId}/edit`, { command });
                setView(view);
                if (!view.changed) toast('Nothing changed', NOOP_HINTS[command.op] || '', 'info');
                renderAll();
                if (!state.playing) requestFrame();
                return view;
            } catch (error) {
                handleError('Edit rejected', error);
                renderTimeline();
                return null;
            }
        });
        return state.queue;
    }

    async function history(which) {
        if (!state.projectId) return;
        try {
            setView(await api('POST', `/projects/${state.projectId}/${which}`));
            renderAll();
            if (!state.playing) requestFrame();
        } catch (error) {
            handleError(which === 'undo' ? 'Undo failed' : 'Redo failed', error);
        }
    }

    function splitAtPlayhead() {
        const t = state.playhead;
        const under = clips().filter((c) => t > c.start && t < c.start + c.duration);
        const ids = state.selected && under.some((c) => c.id === state.selected) ? [state.selected] : under.map((c) => c.id);
        if (!ids.length) {
            toast('Nothing to split', NOOP_HINTS.splitClips, 'info');
            return;
        }
        edit({ op: 'splitClips', clipIds: ids, time: t });
    }

    function removeSelected() {
        if (!state.selected) return;
        const id = state.selected;
        state.selected = null;
        edit({ op: 'removeClips', clipIds: [id] });
    }

    async function addTitle() {
        const view = await edit({ op: 'addTextClip', start: state.playhead, above: true, duration: 4, style: { content: 'Title' } });
        if (view && view.createdId) {
            state.selected = view.createdId;
            renderAll();
            const text = $('#wsInspector .ws-text-content');
            if (text) text.select();
        }
    }

    function addMediaAt(mediaId, trackId, start) {
        if (trackId) edit({ op: 'addClip', mediaId, trackId, start: Math.max(0, start) });
        else edit({ op: 'addClipAtFirstFree', mediaId, start: Math.max(0, start) });
    }

    // -- media ------------------------------------------------------------------

    async function libraryDialog() {
        if (!state.projectId) {
            toast('Open a project first', 'Create or choose a project, then add media to it.', 'info');
            return;
        }
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>Add from Library</h3>
            <input type="search" id="wsLibSearch" placeholder="Search by filename…" style="width:100%">
            <ul class="ws-library-list" id="wsLibList"><li class="ws-empty">Loading…</li></ul>
            <div class="ws-dialog-actions"><button class="btn btn-secondary" type="button" id="wsLibClose">Done</button></div>`;
        dialog.classList.add('is-wide');
        dialog.addEventListener('close', () => dialog.classList.remove('is-wide'), { once: true });
        dialog.showModal();
        $('#wsLibClose').addEventListener('click', () => dialog.close());
        $('#wsLibSearch').addEventListener('input', renderLibraryList);
        await loadLibraryItems();
        renderLibraryList();
    }

    async function loadLibraryItems() {
        // The caller's own and shared Library video, image and audio.
        try {
            const [mine, shared] = await Promise.all([
                api('GET', '/api/outputs?scope=mine&limit=500'),
                api('GET', '/api/outputs?scope=shared&limit=500'),
            ]);
            const seen = new Set();
            state.libraryItems = [...(mine.outputs || []), ...(shared.outputs || [])]
                .filter((o) => ['video', 'audio', 'image'].includes(o.media_type))
                .filter((o) => (seen.has(o.url) ? false : seen.add(o.url)));
        } catch (error) {
            state.libraryItems = [];
            handleError('Could not load the Library', error);
        }
        return state.libraryItems;
    }

    const libraryPath = (o) => (o.subfolder ? `${o.subfolder}/${o.filename}` : o.filename);

    function renderLibraryList() {
        const list = $('#wsLibList');
        if (!list) return;
        const query = ($('#wsLibSearch').value || '').toLowerCase();
        const items = state.libraryItems.filter((o) => !query || `${o.subfolder}/${o.filename}`.toLowerCase().includes(query)).slice(0, 200);
        if (!items.length) {
            list.innerHTML = '<li class="ws-empty">No video, audio or image items in your Library match.</li>';
            return;
        }
        // Thumbnails the way Library draws them: the image itself, or a muted
        // video showing its first frame. Sources load only once scrolled into
        // view, so a big Library does not fetch every file at once.
        list.innerHTML = items.map((o, i) => `
            <li><button type="button" data-index="${i}" title="${esc(libraryPath(o))}">
                <span class="ws-lib-thumb" data-thumb="${esc(o.url)}" data-kind="${esc(o.media_type)}">${o.media_type === 'audio' ? '<span class="ws-lib-audio">♪</span>' : ''}</span>
                <span class="ws-lib-name">${esc(o.filename)}</span>
                <span class="ws-bin-meta"><span class="ws-kind-dot ws-kind-${esc(o.media_type)}"></span> ${esc(o.media_type)}</span>
            </button></li>`).join('');
        const load = (slot) => {
            const url = slot.dataset.thumb;
            if (slot.dataset.kind === 'image') {
                slot.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy">`;
            } else if (slot.dataset.kind === 'video') {
                // #t nudges past a black first frame.
                slot.innerHTML = `<video src="${esc(url)}#t=0.5" muted playsinline preload="metadata"></video>`;
            }
        };
        const slots = list.querySelectorAll('.ws-lib-thumb[data-kind="image"], .ws-lib-thumb[data-kind="video"]');
        if ('IntersectionObserver' in window) {
            if (state.thumbObserver) state.thumbObserver.disconnect();
            state.thumbObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    load(entry.target);
                    state.thumbObserver.unobserve(entry.target);
                }
            }), { root: list, rootMargin: '200px' });
            slots.forEach((slot) => state.thumbObserver.observe(slot));
        } else {
            slots.forEach(load);
        }
        list.querySelectorAll('button[data-index]').forEach((button) => {
            button.addEventListener('click', async () => {
                const item = items[Number(button.dataset.index)];
                const path = item.subfolder ? `${item.subfolder}/${item.filename}` : item.filename;
                button.disabled = true;
                try {
                    setView(await api('POST', `/projects/${state.projectId}/import`, { source: 'output', path }));
                    renderAll();
                    toast('Added to media', item.filename, 'success');
                } catch (error) {
                    handleError('Could not import', error);
                } finally {
                    button.disabled = false;
                }
            });
        });
    }

    async function uploadSelected(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file || !state.projectId) return;
        const form = new FormData();
        form.append('file', file);
        toast('Uploading', file.name, 'info');
        try {
            setView(await api('POST', `/projects/${state.projectId}/upload`, form, true));
            renderAll();
            toast('Added to media', file.name, 'success');
        } catch (error) {
            handleError('Upload failed', error);
        }
    }

    // -- rendering ----------------------------------------------------------------

    function renderAll() {
        renderControls();
        renderBin();
        renderTimeline();
        renderInspector();
    }

    function renderControls() {
        const has = !!(state.projectId && state.view);
        const up = state.engineUp;
        $('#wsUndo').disabled = !(has && up && state.view.canUndo);
        $('#wsRedo').disabled = !(has && up && state.view.canRedo);
        ['#wsSave', '#wsRename', '#wsDuplicate', '#wsSaveTemplate', '#wsCaptions', '#wsExport', '#wsAddLibrary', '#wsUploadBtn', '#wsSplit', '#wsAddTrack', '#wsAddTitle', '#wsPlay', '#wsToStart', '#wsStepBack', '#wsStepFwd']
            .forEach((sel) => { $(sel).disabled = !(has && up); });
        $('#wsDelete').disabled = !has;
        $('#wsRemove').disabled = !(has && up && state.selected);
        $('#wsNew').disabled = !up;
        $('#wsFromTemplate').disabled = !up;
        const captioning = state.captionJob && state.captionJob.status === 'running';
        $('#wsCaptions').disabled = !(has && up) || captioning;
        const saveState = $('#wsSaveState');
        saveState.textContent = has ? (state.dirty ? 'Unsaved changes' : 'All changes saved') : '';
        saveState.classList.toggle('is-dirty', has && state.dirty);
        const exporting = state.job && ['running', 'queued', 'finishing'].includes(state.job.status);
        $('#wsExport').disabled = !(has && up) || exporting;
        renderTimecode();
    }

    function renderTimecode() {
        $('#wsTimecode').textContent = `${fmtTime(state.playhead, fps())} / ${fmtTime(duration(), fps())}`;
    }

    function renderBin() {
        const bin = $('#wsBin');
        const media = (state.view && state.view.project.media) || [];
        if (!state.projectId) {
            bin.innerHTML = '<li class="ws-empty">Create or choose a project to start editing.</li>';
            return;
        }
        if (!media.length) {
            bin.innerHTML = '<li class="ws-empty">No media yet. Add a Library item or upload a file.</li>';
            return;
        }
        bin.innerHTML = media.map((m) => `
            <li class="ws-bin-item${m.missing ? ' is-missing' : ''}" draggable="true" data-media="${esc(m.id)}"
                title="${esc(m.missing ? `${m.name} (file missing)` : m.name)}">
                <span class="ws-kind-dot ws-kind-${esc(m.kind)}"></span>
                <span class="ws-bin-name">${esc(m.name)}</span>
                <span class="ws-bin-meta">${m.missing ? 'missing' : esc(fmtDuration(m.duration))}</span>
            </li>`).join('');
        bin.querySelectorAll('[data-media]').forEach((item) => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/x-ws-media', item.dataset.media);
                e.dataTransfer.effectAllowed = 'copy';
            });
            item.addEventListener('dblclick', () => addMediaAt(item.dataset.media, null, state.playhead));
        });
    }

    function renderTimeline() {
        const heads = $('#wsTrackHeads');
        const canvas = $('#wsCanvas');
        const tl = timeline();
        if (!tl) {
            heads.innerHTML = '';
            canvas.innerHTML = '<p class="ws-empty" style="padding:0.75rem">The timeline appears here once a project is open.</p>';
            return;
        }
        const pps = state.pps;
        const scroll = $('#wsScroll');
        const total = Math.max(duration() + 10, scroll.clientWidth / pps);
        const width = Math.ceil(total * pps);

        // Concat stores the stack bottom first; draw it top-down, as editors do.
        const lanesTopDown = [...tl.tracks].reverse();
        heads.innerHTML = '<div class="ws-ruler-spacer"></div>' + lanesTopDown.map((track) => `
            <div class="ws-track-head" data-track="${esc(track.id)}">
                <span>${esc(track.id)}</span>
                <button class="ws-icon-btn${track.visible === false ? ' is-off' : ''}" type="button" data-flag="visible" title="Show or hide this track's picture">${track.visible === false ? 'Hidden' : 'Shown'}</button>
                <button class="ws-icon-btn${track.muted ? ' is-off' : ''}" type="button" data-flag="muted" title="Mute or unmute this track">${track.muted ? 'Muted' : 'Sound'}</button>
                <button class="ws-icon-btn" type="button" data-remove-track title="Remove track">×</button>
            </div>`).join('');

        // Ruler ticks: a major tick every `major` seconds, labelled.
        const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
        const major = steps.find((s) => s * pps >= 70) || 600;
        const minor = major / 5;
        let ticks = '';
        for (let t = 0; t <= total; t += minor) {
            const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
            ticks += `<div class="ws-tick${isMajor ? ' is-major' : ''}" style="left:${(t * pps).toFixed(1)}px"></div>`;
            if (isMajor) ticks += `<div class="ws-tick-label" style="left:${(t * pps).toFixed(1)}px">${esc(fmtDuration(t).replace('.0s', 's'))}</div>`;
        }

        const lanes = lanesTopDown.map((track) => {
            const laneClips = (tl.clips || []).filter((c) => c.trackId === track.id).map((c) => {
                const kind = clipKind(c);
                const tr = c.transitionIn;
                const mark = tr ? `<div class="ws-transition-mark" style="left:${(Math.max(0, c.start - tr.duration) * pps).toFixed(1)}px;width:${(Math.min(c.start, tr.duration) * pps).toFixed(1)}px"></div>` : '';
                return mark + `<div class="ws-clip ws-kind-${esc(kind)}${c.id === state.selected ? ' is-selected' : ''}" data-clip="${esc(c.id)}"
                    style="left:${(c.start * pps).toFixed(1)}px;width:${Math.max(4, c.duration * pps).toFixed(1)}px"
                    title="${esc(c.name)} · ${esc(fmtDuration(c.duration))}">
                    <span class="ws-handle ws-handle-start" data-edge="start"></span>
                    <span class="ws-clip-label">${esc(c.name)}</span>
                    ${c.id === state.selected ? allKeyPositions(c).map((a) => `<span class="ws-keymark" style="left:${(a * 100).toFixed(2)}%"></span>`).join('') : ''}
                    <span class="ws-handle ws-handle-end" data-edge="end"></span>
                </div>`;
            }).join('');
            return `<div class="ws-lane" data-track="${esc(track.id)}">${laneClips}</div>`;
        }).join('');

        canvas.style.width = `${width}px`;
        canvas.innerHTML = `<div class="ws-ruler" id="wsRuler">${ticks}</div>${lanes}<div class="ws-playhead" id="wsPlayhead"></div>`;
        positionPlayhead();
        bindTimeline();
    }

    function positionPlayhead() {
        const playhead = $('#wsPlayhead');
        if (playhead) playhead.style.left = `${state.playhead * state.pps}px`;
        renderTimecode();
    }

    // -- keyframes ---------------------------------------------------------
    // Concat keys a property at `at`, a fraction of the clip; each key's
    // ease is a cubic-bezier for the approach from the key before it.

    const EASES = { linear: [0, 0, 1, 1], in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], inOut: [0.42, 0, 0.58, 1] };
    const EASE_LABELS = { linear: 'Linear', in: 'Ease in', out: 'Ease out', inOut: 'Ease in and out' };

    function easeName(ease) {
        const points = Array.isArray(ease) ? ease : EASES[ease] || EASES.linear;
        return Object.keys(EASES).find((name) => EASES[name].every((v, i) => Math.abs(v - points[i]) < 1e-3)) || 'linear';
    }

    function bezier(points, u) {
        // y for x = u on the curve through (0,0), (x1,y1), (x2,y2), (1,1).
        const [x1, y1, x2, y2] = points;
        const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
        let lo = 0;
        let hi = 1;
        let t = u;
        for (let i = 0; i < 30; i += 1) {
            t = (lo + hi) / 2;
            if (at(x1, x2, t) < u) lo = t; else hi = t;
        }
        return at(y1, y2, t);
    }

    function clipPhase(clip) {
        // The playhead as a fraction of the clip, or null when outside it.
        if (!clip || state.playhead < clip.start || state.playhead > clip.start + clip.duration) return null;
        return Math.min(1, Math.max(0, (state.playhead - clip.start) / clip.duration));
    }

    function keysFor(clip, prop) {
        return (clip.keys || []).filter((k) => k.property === prop).sort((a, b) => a.at - b.at);
    }

    function effectKeys(entry, param) {
        return [...(((entry && entry.keys) || {})[param] || [])].sort((a, b) => a.at - b.at);
    }

    function keyNear(clip, keys, at) {
        if (at === null || at === undefined) return null;
        const tolerance = (0.5 / fps()) / Math.max(clip.duration, 1e-6);
        return keys.find((k) => Math.abs(k.at - at) <= tolerance) || null;
    }

    function keyAt(clip, prop, at) {
        return keyNear(clip, keysFor(clip, prop), at);
    }

    function allKeyPositions(clip) {
        // Every keyframe on the clip, its own and its effects', as fractions.
        const ats = (clip.keys || []).map((k) => k.at);
        (clip.videoEffects || []).forEach((entry) => Object.values(entry.keys || {}).forEach((run) => run.forEach((k) => ats.push(k.at))));
        return [...new Set(ats)].sort((a, b) => a - b);
    }

    function valueAt(clip, prop, at) {
        const constant = clip[prop] ?? (prop === 'scale' || prop === 'opacity' || prop === 'volume' ? 1 : 0);
        return interpolate(keysFor(clip, prop), constant, at);
    }

    function interpolate(keys, constant, at) {
        if (!keys.length) return constant;
        if (at <= keys[0].at) return keys[0].value;
        const last = keys[keys.length - 1];
        if (at >= last.at) return last.value;
        const i = keys.findIndex((k) => k.at > at);
        const a = keys[i - 1];
        const b = keys[i];
        const u = (at - a.at) / (b.at - a.at);
        const points = Array.isArray(b.ease) ? b.ease : EASES[b.ease] || EASES.linear;
        return a.value + (b.value - a.value) * bezier(points, u);
    }

    let inspectorFrame = 0;
    function refreshInspectorSoon() {
        // Keyed values follow the playhead; redraw at most once per frame.
        if (inspectorFrame) return;
        inspectorFrame = requestAnimationFrame(() => {
            inspectorFrame = 0;
            renderInspector();
        });
    }

    function renderInspector() {
        const panel = $('#wsInspector');
        const clip = clips().find((c) => c.id === state.selected);
        if (!clip) {
            const size = frameSize();
            panel.innerHTML = state.view ? `
                <h4>Project</h4>
                <dl>
                    <dt>Name</dt><dd>${esc(state.view.settings.name)}</dd>
                    <dt>Frame</dt><dd>${size.width} × ${size.height} @ ${+fps().toFixed(3)} fps</dd>
                    <dt>Length</dt><dd>${esc(fmtTime(duration(), fps()))}</dd>
                    <dt>Clips</dt><dd>${clips().length}</dd>
                </dl>
                <p class="ws-empty">Select a clip to see and change its properties.</p>
                <p class="ws-empty ws-kbd">Space play/pause · S split · Delete remove · ←/→ frame · Shift+←/→ second · Ctrl+Z / Ctrl+Shift+Z · Ctrl+S save</p>`
                : '<h4>Inspector</h4><p class="ws-empty">Nothing selected.</p>';
            return;
        }
        const kind = clipKind(clip);
        const visual = kind !== 'audio';
        const audible = kind === 'video' || kind === 'audio';
        const media = mediaById(clip.mediaId);
        const source = media && media.source;
        const sourceText = kind === 'text' ? 'Title' : !source ? '' : source.kind === 'output' ? `Library: ${source.path}`
            : source.kind === 'upload' ? `Uploaded: ${source.name}` : source.name || source.path || '';
        const range = (attr, label, min, max, step, value, digits = 2) => `
            <label>${esc(label)}<input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${value}"><output>${Number(value).toFixed(digits)}</output></label>`;
        const sections = [];

        sections.push(`
            <h4>${kind === 'text' ? 'Title' : 'Clip'}</h4>
            <dl>
                <dt>Name</dt><dd>${esc(clip.name)}</dd>
                <dt>Track</dt><dd>${esc(clip.trackId)}</dd>
                <dt>Start</dt><dd>${esc(fmtTime(clip.start, fps()))}</dd>
                <dt>Length</dt><dd>${esc(fmtDuration(clip.duration))}</dd>
                ${kind === 'text' ? '' : `<dt>Source in</dt><dd>${esc(fmtDuration(clip.sourceStart || 0))}</dd>
                <dt>Speed</dt><dd>${esc(String(clip.speed ?? 1))}×</dd>`}
                <dt>Source</dt><dd>${esc(sourceText)}${media && media.missing ? ' (missing)' : ''}</dd>
            </dl>`);

        if (kind === 'text' && clip.text) {
            const t = clip.text;
            const bg = /^#[0-9a-f]{6}/i.test(t.background || '') ? t.background.slice(0, 7) : '#000000';
            sections.push(`
                <div class="ws-section"><h5>Text</h5>
                <textarea class="ws-text-content" data-text-str="content" rows="3">${esc(t.content)}</textarea>
                ${range('data-text="fontSize"', 'Size', 0.02, 0.3, 0.005, t.fontSize ?? 0.09, 3)}
                <label>Colour<input type="color" data-text-str="color" value="${esc(t.color || '#ffffff')}"><span></span></label>
                <label>Weight<select data-text="fontWeight">
                    ${[[300, 'Light'], [400, 'Regular'], [700, 'Bold'], [900, 'Black']].map(([w, n]) => `<option value="${w}"${Math.round(t.fontWeight) === w ? ' selected' : ''}>${n}</option>`).join('')}
                </select><span></span></label>
                <label>Align<select data-text-str="align">
                    ${['left', 'center', 'right'].map((a) => `<option value="${a}"${t.align === a ? ' selected' : ''}>${a[0].toUpperCase()}${a.slice(1)}</option>`).join('')}
                </select><span></span></label>
                <label>Italic<input type="checkbox" data-text-bool="italic"${t.italic ? ' checked' : ''}><span></span></label>
                <label>Shadow<input type="checkbox" data-text-bool="shadow"${t.shadow ? ' checked' : ''}><span></span></label>
                <label>Background<input type="checkbox" data-text-bg${t.background ? ' checked' : ''}><input type="color" data-text-bg-color value="${esc(bg)}"></label>
                </div>`);
        }

        const at = clipPhase(clip);
        const keyRow = (prop, label, min, max, step, digits = 2) => {
            const value = valueAt(clip, prop, at === null ? 0 : at);
            const keys = keysFor(clip, prop);
            const here = at === null ? null : keyAt(clip, prop, at);
            const diamond = here ? '◆' : '◇';
            const tip = at === null ? 'Move the playhead into this clip to set a keyframe'
                : here ? 'Remove the keyframe here' : 'Add a keyframe here';
            return `
                <label class="ws-key-row">${esc(label)}<input type="range" data-key-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${Number(value).toFixed(digits)}</output>
                    <button class="ws-key${here ? ' is-on' : keys.length ? ' is-keyed' : ''}" type="button" data-key-toggle="${prop}" title="${tip}"${at === null ? ' disabled' : ''}>${diamond}</button></label>
                ${here ? `<div class="ws-key-detail">
                    <select data-key-ease="${prop}" title="How this keyframe is approached from the one before">
                        ${Object.keys(EASES).map((name) => `<option value="${name}"${easeName(here.ease) === name ? ' selected' : ''}>${EASE_LABELS[name]}</option>`).join('')}
                    </select></div>` : ''}
                ${keys.length ? `<div class="ws-key-detail"><span class="ws-kbd">${keys.length} keyframe${keys.length === 1 ? '' : 's'}</span>
                    <button class="ws-icon-btn" type="button" data-key-clear="${prop}">Clear</button></div>` : ''}`;
        };
        const anyKeys = allKeyPositions(clip).length > 0;

        if (visual) {
            sections.push(`
                <div class="ws-section"><h5>Position <button class="ws-icon-btn" type="button" data-transform-reset>Reset</button></h5>
                ${keyRow('scale', 'Scale', 0.05, 3, 0.01)}
                ${keyRow('offsetX', 'Horizontal', -1, 1, 0.01)}
                ${keyRow('offsetY', 'Vertical', -1, 1, 0.01)}
                ${keyRow('rotation', 'Rotation', -180, 180, 1, 0)}
                ${keyRow('opacity', 'Opacity', 0, 1, 0.01)}
                ${anyKeys ? `<div class="ws-key-nav">
                    <button class="ws-icon-btn" type="button" data-key-nav="prev">◂ Previous key</button>
                    <button class="ws-icon-btn" type="button" data-key-nav="next">Next key ▸</button></div>` : ''}
                <p class="ws-empty ws-kbd">◇ sets a keyframe at the playhead. Once a property has keyframes, moving its slider keys it at the playhead.</p>
                </div>`);
        }

        if (kind === 'video' || kind === 'image') {
            const crop = clip.crop || { left: 0, top: 0, right: 0, bottom: 0 };
            sections.push(`
                <div class="ws-section"><h5>Picture ${clip.crop ? '<button class="ws-icon-btn" type="button" data-crop-reset>Reset crop</button>' : ''}</h5>
                ${['left', 'top', 'right', 'bottom'].map((edge) => range(`data-crop="${edge}"`, `Crop ${edge}`, 0, 0.45, 0.005, crop[edge] || 0)).join('')}
                <label>Blend<select data-blend>
                    ${[['', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['add', 'Add'], ['lighten', 'Lighten'], ['darken', 'Darken']]
                        .map(([v, n]) => `<option value="${v}"${(clip.blend || '') === v || (v === '' && clip.blend === 'normal') ? ' selected' : ''}>${n}</option>`).join('')}
                </select><span></span></label>
                <label>Flip horizontal<input type="checkbox" data-flip="flipH"${clip.flipH ? ' checked' : ''}><span></span></label>
                <label>Flip vertical<input type="checkbox" data-flip="flipV"${clip.flipV ? ' checked' : ''}><span></span></label>
                </div>`);
        }

        sections.push(`
            <div class="ws-section"><h5>Fades${audible ? ' and sound' : ''}</h5>
            ${range('data-patch="fadeIn"', 'Fade in (s)', 0, Math.min(10, clip.duration), 0.05, clip.fadeIn ?? 0)}
            ${range('data-patch="fadeOut"', 'Fade out (s)', 0, Math.min(10, clip.duration), 0.05, clip.fadeOut ?? 0)}
            ${audible ? keyRow('volume', 'Volume', 0, 2, 0.01) : ''}
            ${audible ? `<label>Mute clip<input type="checkbox" data-patch-bool="muted"${clip.muted ? ' checked' : ''}><span></span></label>` : ''}
            </div>`);

        const cat = state.catalogue;
        if (visual && cat) {
            const current = clip.transitionIn;
            sections.push(`
                <div class="ws-section"><h5>Transition in</h5>
                <label>Style<select data-transition>
                    <option value="">None (hard cut)</option>
                    ${optionGroups(cat.transition, current && current.id)}
                </select><span></span></label>
                ${current ? range('data-transition-duration', 'Length (s)', 0.1, Math.max(0.1, Math.min(3, clip.duration)), 0.05, current.duration ?? 1) : ''}
                <p class="ws-empty ws-kbd">Plays in the seconds before this clip starts, revealing it over whatever is underneath. The clip's source needs that much footage before its in-point.</p>
                </div>`);
            sections.push(effectSection(clip, 'videoEffects', 'Picture effects', [['Effects', cat.effect], ['Looks', cat.filter]]));
        }
        if (audible && cat) {
            sections.push(effectSection(clip, 'filters', 'Audio effects', [['Audio', cat.audio]]));
        }
        if (audible && !(media && media.kind === 'video' && media.hasAudio === false)) {
            sections.push(`
                <div class="ws-section"><h5>Captions</h5>
                <button class="btn btn-secondary" type="button" data-captions>Make captions from this clip…</button>
                <p class="ws-empty ws-kbd">Transcribes the clip's speech on this machine and adds the words as titles.</p>
                </div>`);
        }
        panel.innerHTML = sections.join('');
        bindInspector(panel, clip);
    }

    function optionGroups(items, selectedId) {
        const groups = new Map();
        (items || []).forEach((item) => {
            const key = item.category || 'Other';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
        return [...groups].map(([name, list]) => `<optgroup label="${esc(name)}">${list.map((item) =>
            `<option value="${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>`).join('');
    }

    function catalogueEntry(id) {
        const cat = state.catalogue || {};
        for (const kind of ['effect', 'filter', 'audio', 'transition']) {
            const hit = (cat[kind] || []).find((item) => item.id === id);
            if (hit) return hit;
        }
        return null;
    }

    function effectSection(clip, chainKey, title, menus) {
        const chain = clip[chainKey] || [];
        const cards = chain.map((entry, index) => {
            const info = catalogueEntry(entry.id);
            const params = ((info && info.params) || []).map((p) => {
                const value = (entry.params || {})[p.key] ?? p.default;
                const attrs = `data-fx-chain="${chainKey}" data-fx-index="${index}" data-fx-param="${esc(p.key)}"`;
                if (p.type === 'bool') {
                    return `<label>${esc(p.label)}<input type="checkbox" ${attrs} data-fx-bool${value ? ' checked' : ''}><span></span></label>`;
                }
                if (p.type === 'enum') {
                    return `<label>${esc(p.label)}<select ${attrs}>${(p.values || []).map((v, i) =>
                        `<option value="${v}"${v === value ? ' selected' : ''}>${esc((p.labels || [])[i] ?? v)}</option>`).join('')}</select><span></span></label>`;
                }
                if (p.type !== 'float' && p.type !== 'int') return '';
                const step = p.step || (p.type === 'int' ? 1 : (p.max - p.min) / 100);
                const digits = p.type === 'int' || step >= 1 ? 0 : 2;
                if (chainKey !== 'videoEffects') {
                    return `<label>${esc(p.label)}<input type="range" ${attrs} min="${p.min}" max="${p.max}" step="${step}" value="${value}"><output>${Number(value).toFixed(digits)}${esc(p.unit || '')}</output></label>`;
                }
                // Picture effects can be keyframed, like the clip's own properties.
                const at = clipPhase(clip);
                const keys = effectKeys(entry, p.key);
                const here = keyNear(clip, keys, at);
                const shown = interpolate(keys, value, at === null ? 0 : at);
                const keyAttrs = `data-fx-index="${index}" data-fx-param="${esc(p.key)}"`;
                return `<label class="ws-key-row">${esc(p.label)}<input type="range" ${attrs} min="${p.min}" max="${p.max}" step="${step}" value="${shown}"><output>${Number(shown).toFixed(digits)}${esc(p.unit || '')}</output>
                        <button class="ws-key${here ? ' is-on' : keys.length ? ' is-keyed' : ''}" type="button" data-fx-key-toggle ${keyAttrs}
                            title="${at === null ? 'Move the playhead into this clip to set a keyframe' : here ? 'Remove the keyframe here' : 'Add a keyframe here'}"${at === null ? ' disabled' : ''}>${here ? '◆' : '◇'}</button></label>
                    ${here ? `<div class="ws-key-detail"><select data-fx-key-ease ${keyAttrs}>
                        ${Object.keys(EASES).map((name) => `<option value="${name}"${easeName(here.ease) === name ? ' selected' : ''}>${EASE_LABELS[name]}</option>`).join('')}
                        </select></div>` : ''}
                    ${keys.length ? `<div class="ws-key-detail"><span class="ws-kbd">${keys.length} keyframe${keys.length === 1 ? '' : 's'}</span>
                        <button class="ws-icon-btn" type="button" data-fx-key-clear ${keyAttrs}>Clear</button></div>` : ''}`;
            }).join('');
            return `
                <div class="ws-fx${entry.enabled === false ? ' is-off' : ''}">
                    <div class="ws-fx-head">
                        <input type="checkbox" data-fx-chain="${chainKey}" data-fx-index="${index}" data-fx-enable${entry.enabled === false ? '' : ' checked'} title="On / off">
                        <strong>${esc(info ? info.name : entry.id)}</strong>
                        <button class="ws-icon-btn" type="button" data-fx-chain="${chainKey}" data-fx-index="${index}" data-fx-remove title="Remove">×</button>
                    </div>
                    ${params}
                </div>`;
        }).join('');
        return `
            <div class="ws-section"><h5>${esc(title)}</h5>
            ${cards || '<p class="ws-empty ws-kbd">None yet.</p>'}
            <select data-fx-add="${chainKey}">
                <option value="">Add…</option>
                ${menus.map(([label, items]) => `<optgroup label="${esc(label)}">${(items || []).map((item) =>
                    `<option value="${esc(item.id)}" title="${esc(item.description || '')}">${esc(item.name)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            </div>`;
    }

    function bindInspector(panel, clip) {
        const patch = (fields) => edit({ op: 'updateClip', clipId: clip.id, patch: fields });
        const showValue = (input) => {
            const out = input.nextElementSibling;
            if (out && out.tagName === 'OUTPUT') {
                const unit = out.textContent.replace(/^[-\d.]+/, '');
                const digits = (out.textContent.split(/[^\d.-]/)[0].split('.')[1] || '').length;
                out.textContent = `${Number(input.value).toFixed(digits)}${unit}`;
            }
        };
        panel.querySelectorAll('input[type="range"]').forEach((input) => input.addEventListener('input', () => showValue(input)));

        panel.querySelectorAll('input[data-patch]').forEach((input) => {
            input.addEventListener('change', () => patch({ [input.dataset.patch]: Number(input.value) }));
        });
        panel.querySelectorAll('input[data-patch-bool]').forEach((input) => {
            input.addEventListener('change', () => patch({ [input.dataset.patchBool]: input.checked }));
        });

        // Titles: the engine fills unspecified style fields with defaults,
        // so every change sends the whole current style.
        const style = (changes) => patch({ text: { ...clip.text, ...changes } });
        panel.querySelectorAll('[data-text]').forEach((input) => {
            input.addEventListener('change', () => style({ [input.dataset.text]: Number(input.value) }));
        });
        panel.querySelectorAll('[data-text-str]').forEach((input) => {
            input.addEventListener('change', () => style({ [input.dataset.textStr]: input.value }));
        });
        panel.querySelectorAll('[data-text-bool]').forEach((input) => {
            input.addEventListener('change', () => style({ [input.dataset.textBool]: input.checked }));
        });
        const bgToggle = panel.querySelector('[data-text-bg]');
        const bgColor = panel.querySelector('[data-text-bg-color]');
        if (bgToggle && bgColor) {
            const applyBg = () => style({ background: bgToggle.checked ? `${bgColor.value}cc` : '' });
            bgToggle.addEventListener('change', applyBg);
            bgColor.addEventListener('change', () => { bgToggle.checked = true; applyBg(); });
        }

        const TRANSFORM_PROPS = ['scale', 'offsetX', 'offsetY', 'rotation'];
        const setConstant = (prop, value) => (TRANSFORM_PROPS.includes(prop)
            ? edit({ op: 'setClipTransform', clipId: clip.id, [prop]: value })
            : patch({ [prop]: value }));
        panel.querySelectorAll('input[data-key-prop]').forEach((input) => {
            input.addEventListener('change', () => {
                const prop = input.dataset.keyProp;
                const value = Number(input.value);
                if (!keysFor(clip, prop).length) {
                    setConstant(prop, value);
                    return;
                }
                const at = clipPhase(clip);
                if (at === null) {
                    toast('Playhead is outside this clip', 'This property is keyframed; move the playhead into the clip to change it.', 'info');
                    renderInspector();
                    return;
                }
                const here = keyAt(clip, prop, at);
                edit({ op: 'setClipKey', clipId: clip.id, property: prop, at: here ? here.at : at, value, ease: here ? here.ease : 'linear' });
            });
        });
        panel.querySelectorAll('[data-key-toggle]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const prop = button.dataset.keyToggle;
                const at = clipPhase(clip);
                if (at === null) return;
                const here = keyAt(clip, prop, at);
                if (here) edit({ op: 'clearClipKey', clipId: clip.id, property: prop, at: here.at });
                else edit({ op: 'setClipKey', clipId: clip.id, property: prop, at, value: valueAt(clip, prop, at), ease: 'linear' });
            });
        });
        panel.querySelectorAll('[data-key-clear]').forEach((button) => {
            button.addEventListener('click', () => edit({ op: 'clearClipKeys', clipId: clip.id, property: button.dataset.keyClear }));
        });
        panel.querySelectorAll('[data-key-ease]').forEach((select) => {
            select.addEventListener('change', () => {
                const prop = select.dataset.keyEase;
                const here = keyAt(clip, prop, clipPhase(clip));
                if (here) edit({ op: 'setClipKey', clipId: clip.id, property: prop, at: here.at, value: here.value, ease: select.value });
            });
        });
        panel.querySelectorAll('[data-key-nav]').forEach((button) => {
            button.addEventListener('click', () => {
                const times = allKeyPositions(clip).map((a) => clip.start + a * clip.duration);
                const eps = 0.5 / fps();
                const target = button.dataset.keyNav === 'next'
                    ? times.find((t) => t > state.playhead + eps)
                    : [...times].reverse().find((t) => t < state.playhead - eps);
                if (target !== undefined) seek(Math.min(target, clip.start + clip.duration - 1 / fps()), true);
            });
        });
        panel.querySelectorAll('[data-crop]').forEach((input) => {
            input.addEventListener('change', () => {
                const crop = { left: 0, top: 0, right: 0, bottom: 0, ...(clip.crop || {}) };
                crop[input.dataset.crop] = Number(input.value);
                patch({ crop });
            });
        });
        const cropReset = panel.querySelector('[data-crop-reset]');
        if (cropReset) cropReset.addEventListener('click', () => patch({ crop: null }));
        const blend = panel.querySelector('[data-blend]');
        if (blend) blend.addEventListener('change', () => patch({ blend: blend.value }));
        panel.querySelectorAll('[data-flip]').forEach((input) => {
            input.addEventListener('change', () => patch({ [input.dataset.flip]: input.checked }));
        });
        const captionsButton = panel.querySelector('[data-captions]');
        if (captionsButton) captionsButton.addEventListener('click', () => captionsDialog(clip.id));
        const reset = panel.querySelector('[data-transform-reset]');
        if (reset) {
            reset.addEventListener('click', () => edit({ op: 'setClipTransform', clipId: clip.id, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }));
        }

        const transition = panel.querySelector('[data-transition]');
        if (transition) {
            transition.addEventListener('change', () => {
                const duration = clip.transitionIn ? clip.transitionIn.duration : Math.min(1, clip.duration / 2);
                patch({ transitionIn: transition.value ? { id: transition.value, duration } : null });
            });
        }
        const transitionLength = panel.querySelector('[data-transition-duration]');
        if (transitionLength) {
            transitionLength.addEventListener('change', () => patch({ transitionIn: { id: clip.transitionIn.id, duration: Number(transitionLength.value) } }));
        }

        // Effect chains are replaced whole, as Concat's own inspector does.
        const chainOf = (key) => (clip[key] || []).map((e) => ({
            id: e.id,
            params: { ...(e.params || {}) },
            enabled: e.enabled !== false,
            ...(e.keys && Object.keys(e.keys).length ? { keys: JSON.parse(JSON.stringify(e.keys)) } : {}),
        }));
        panel.querySelectorAll('select[data-fx-add]').forEach((select) => {
            select.addEventListener('change', () => {
                if (!select.value) return;
                const key = select.dataset.fxAdd;
                patch({ [key]: [...chainOf(key), { id: select.value, params: {}, enabled: true }] });
            });
        });
        panel.querySelectorAll('[data-fx-remove]').forEach((button) => {
            button.addEventListener('click', () => {
                const key = button.dataset.fxChain;
                const chain = chainOf(key);
                chain.splice(Number(button.dataset.fxIndex), 1);
                patch({ [key]: chain });
            });
        });
        panel.querySelectorAll('[data-fx-enable]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.fxChain;
                const chain = chainOf(key);
                chain[Number(input.dataset.fxIndex)].enabled = input.checked;
                patch({ [key]: chain });
            });
        });
        panel.querySelectorAll('[data-fx-chain][data-fx-param]').forEach((input) => {
            input.addEventListener('change', () => {
                const key = input.dataset.fxChain;
                const index = Number(input.dataset.fxIndex);
                const param = input.dataset.fxParam;
                const value = input.hasAttribute('data-fx-bool') ? (input.checked ? 1 : 0) : Number(input.value);
                const keys = key === 'videoEffects' ? effectKeys((clip.videoEffects || [])[index], param) : [];
                if (keys.length) {
                    const at = clipPhase(clip);
                    if (at === null) {
                        toast('Playhead is outside this clip', 'This setting is keyframed; move the playhead into the clip to change it.', 'info');
                        renderInspector();
                        return;
                    }
                    const here = keyNear(clip, keys, at);
                    edit({ op: 'setEffectKey', clipId: clip.id, entry: index, key: param, at: here ? here.at : at, value, ease: here ? here.ease : 'linear' });
                    return;
                }
                const chain = chainOf(key);
                chain[index].params[param] = value;
                patch({ [key]: chain });
            });
        });
        const fxKeyTarget = (el) => {
            const index = Number(el.dataset.fxIndex);
            const param = el.dataset.fxParam;
            const entry = (clip.videoEffects || [])[index];
            const info = entry && catalogueEntry(entry.id);
            const spec = ((info && info.params) || []).find((p) => p.key === param);
            const constant = ((entry && entry.params) || {})[param] ?? (spec ? spec.default : 0);
            return { index, param, keys: effectKeys(entry, param), constant };
        };
        panel.querySelectorAll('[data-fx-key-toggle]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const at = clipPhase(clip);
                if (at === null) return;
                const { index, param, keys, constant } = fxKeyTarget(button);
                const here = keyNear(clip, keys, at);
                if (here) edit({ op: 'clearEffectKey', clipId: clip.id, entry: index, key: param, at: here.at });
                else edit({ op: 'setEffectKey', clipId: clip.id, entry: index, key: param, at, value: interpolate(keys, constant, at), ease: 'linear' });
            });
        });
        panel.querySelectorAll('[data-fx-key-ease]').forEach((select) => {
            select.addEventListener('change', () => {
                const { index, param, keys } = fxKeyTarget(select);
                const here = keyNear(clip, keys, clipPhase(clip));
                if (here) edit({ op: 'setEffectKey', clipId: clip.id, entry: index, key: param, at: here.at, value: here.value, ease: select.value });
            });
        });
        panel.querySelectorAll('[data-fx-key-clear]').forEach((button) => {
            button.addEventListener('click', () => {
                const { index, param } = fxKeyTarget(button);
                edit({ op: 'clearEffectKeys', clipId: clip.id, entry: index, key: param });
            });
        });
    }

    // -- timeline interaction --------------------------------------------------

    function timeAtClientX(clientX) {
        const canvas = $('#wsCanvas');
        const rect = canvas.getBoundingClientRect();
        return Math.max(0, (clientX - rect.left) / state.pps);
    }

    function laneAtClientY(clientY) {
        const lanes = [...document.querySelectorAll('#tab-workspace .ws-lane')];
        return lanes.find((lane) => {
            const r = lane.getBoundingClientRect();
            return clientY >= r.top && clientY < r.bottom;
        }) || null;
    }

    function snapTime(t, ignoreClipId) {
        // Snap to the playhead, zero, and other clips' edges within 8px.
        const threshold = 8 / state.pps;
        let best = t;
        let bestDistance = threshold;
        const candidates = [0, state.playhead];
        clips().forEach((c) => {
            if (c.id !== ignoreClipId) candidates.push(c.start, c.start + c.duration);
        });
        candidates.forEach((edge) => {
            const d = Math.abs(edge - t);
            if (d < bestDistance) { best = edge; bestDistance = d; }
        });
        return best;
    }

    function bindTimeline() {
        const ruler = $('#wsRuler');
        ruler.addEventListener('pointerdown', (e) => {
            ruler.setPointerCapture(e.pointerId);
            stopPlayback();
            seek(timeAtClientX(e.clientX), false);
            const move = (ev) => seek(timeAtClientX(ev.clientX), false);
            ruler.addEventListener('pointermove', move);
            ruler.addEventListener('pointerup', () => {
                ruler.removeEventListener('pointermove', move);
                requestFrame(true);
            }, { once: true });
        });

        document.querySelectorAll('#tab-workspace .ws-clip').forEach((el) => {
            el.addEventListener('pointerdown', (e) => onClipPointerDown(e, el));
        });

        document.querySelectorAll('#tab-workspace .ws-lane').forEach((lane) => {
            lane.addEventListener('dragover', (e) => {
                if (![...e.dataTransfer.types].includes('application/x-ws-media')) return;
                e.preventDefault();
                lane.classList.add('is-drop');
            });
            lane.addEventListener('dragleave', () => lane.classList.remove('is-drop'));
            lane.addEventListener('drop', (e) => {
                lane.classList.remove('is-drop');
                const mediaId = e.dataTransfer.getData('application/x-ws-media');
                if (!mediaId) return;
                e.preventDefault();
                addMediaAt(mediaId, lane.dataset.track, snapTime(timeAtClientX(e.clientX)));
            });
            lane.addEventListener('pointerdown', (e) => {
                if (e.target === lane) {
                    state.selected = null;
                    renderTimeline();
                    renderInspector();
                    renderControls();
                }
            });
        });

        document.querySelectorAll('#tab-workspace .ws-track-head').forEach((head) => {
            const trackId = head.dataset.track;
            const track = timeline().tracks.find((t) => t.id === trackId);
            head.querySelectorAll('[data-flag]').forEach((button) => {
                button.addEventListener('click', () => {
                    const flag = button.dataset.flag;
                    const value = flag === 'visible' ? track.visible === false : !track.muted;
                    edit({ op: 'setTrackFlag', trackId, flag, value });
                });
            });
            head.querySelector('[data-remove-track]').addEventListener('click', async () => {
                const count = clips().filter((c) => c.trackId === trackId).length;
                if (count) {
                    const answer = await choice('Remove track', `Remove ${trackId} and its ${count} clip${count === 1 ? '' : 's'}? You can undo this.`, [
                        { label: 'Cancel', value: 'cancel' },
                        { label: 'Remove track', value: 'remove', danger: true },
                    ]);
                    if (answer !== 'remove') return;
                }
                edit({ op: 'removeTrack', trackId });
            });
        });
    }

    function onClipPointerDown(e, el) {
        if (e.button !== 0) return;
        e.preventDefault();
        const clipId = el.dataset.clip;
        const clip = clips().find((c) => c.id === clipId);
        if (!clip) return;
        if (state.selected !== clipId) {
            state.selected = clipId;
            document.querySelectorAll('#tab-workspace .ws-clip').forEach((c) => c.classList.toggle('is-selected', c.dataset.clip === clipId));
            el.insertAdjacentHTML('beforeend', allKeyPositions(clip)
                .map((a) => `<span class="ws-keymark" style="left:${(a * 100).toFixed(2)}%"></span>`).join(''));
            document.querySelectorAll('#tab-workspace .ws-clip:not(.is-selected) .ws-keymark').forEach((m) => m.remove());
            renderInspector();
            renderControls();
        }
        const edge = e.target.dataset && e.target.dataset.edge;
        const startX = e.clientX;
        const pps = state.pps;
        let moved = false;
        let targetLane = null;
        el.setPointerCapture(e.pointerId);
        el.classList.add('is-dragging');

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 3 || (!edge && laneAtClientY(ev.clientY) !== el.parentElement)) moved = true;
            if (!moved) return;
            if (edge === 'start') {
                const delta = Math.min(dx / pps, clip.duration - 1 / 60);
                el.style.left = `${(clip.start + delta) * pps}px`;
                el.style.width = `${(clip.duration - delta) * pps}px`;
            } else if (edge === 'end') {
                el.style.width = `${Math.max(1 / 60, clip.duration + dx / pps) * pps}px`;
            } else {
                const start = snapTime(Math.max(0, clip.start + dx / pps), clipId);
                el.style.left = `${start * pps}px`;
                const lane = laneAtClientY(ev.clientY);
                document.querySelectorAll('#tab-workspace .ws-lane').forEach((l) => l.classList.toggle('is-drop', l === lane && lane !== el.parentElement));
                targetLane = lane;
            }
        };
        const onUp = (ev) => {
            el.removeEventListener('pointermove', onMove);
            el.classList.remove('is-dragging');
            document.querySelectorAll('#tab-workspace .ws-lane').forEach((l) => l.classList.remove('is-drop'));
            if (!moved) {
                // A click selects and puts the playhead where you clicked.
                stopPlayback();
                seek(timeAtClientX(ev.clientX), true);
                return;
            }
            const dx = ev.clientX - startX;
            if (edge) {
                const delta = Math.round((dx / pps) * 1000) / 1000;
                if (delta) edit({ op: 'trimClip', clipId, edge, delta });
                else renderTimeline();
            } else {
                const start = Math.round(snapTime(Math.max(0, clip.start + dx / pps), clipId) * 1000) / 1000;
                const trackId = (targetLane && targetLane.dataset.track) || clip.trackId;
                if (start !== clip.start || trackId !== clip.trackId) {
                    edit({ op: 'moveClips', moves: [{ clipId, start, trackId }] });
                } else {
                    renderTimeline();
                }
            }
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp, { once: true });
        el.addEventListener('pointercancel', () => { el.removeEventListener('pointermove', onMove); renderTimeline(); }, { once: true });
    }

    // -- preview -----------------------------------------------------------------

    function setBadge(text, kind, detail) {
        const badge = $('#wsBadge');
        badge.textContent = text;
        badge.title = detail || '';
        badge.className = `ws-monitor-badge is-${kind}`;
    }

    function seek(t, exact) {
        const end = Math.max(duration(), 0);
        state.playhead = Math.min(Math.max(0, t), end);
        positionPlayhead();
        if (!state.playing && state.selected) refreshInspectorSoon();
        if (state.playing) {
            state.playStartWall = performance.now();
            state.playStartTime = state.playhead;
            syncPlayback(true);
        } else {
            requestFrame(exact);
        }
    }

    function requestFrame(immediate) {
        // The exact frame from Concat, debounced while scrubbing; a newer
        // request aborts the one in flight.
        if (!state.projectId || !state.engineUp || state.playing) return;
        clearTimeout(state.frameTimer);
        state.frameTimer = setTimeout(fetchFrame, immediate ? 0 : 90);
    }

    async function fetchFrame() {
        const monitor = $('#wsMonitor');
        const size = frameSize();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let w = Math.min(1280, Math.round(monitor.clientWidth * dpr));
        let h = Math.round((w * size.height) / size.width);
        if (h > Math.round(monitor.clientHeight * dpr)) {
            h = Math.min(720, Math.round(monitor.clientHeight * dpr));
            w = Math.round((h * size.width) / size.height);
        }
        w = Math.max(16, w - (w % 2));
        h = Math.max(16, h - (h % 2));
        const t = state.playhead;
        const rev = state.view ? state.view.revision : 0;
        const key = `${state.projectId}:${rev}:${t.toFixed(3)}:${w}x${h}`;
        if (key === state.frameKey && !$('#wsFrame').hidden) {
            setBadge('Exact frame', 'exact');
            return;
        }
        if (state.frameAbort) state.frameAbort.abort();
        const controller = new AbortController();
        state.frameAbort = controller;
        setBadge('Rendering exact frame…', 'busy');
        try {
            const response = await fetch(`${API}/projects/${state.projectId}/frame?t=${t.toFixed(3)}&w=${w}&h=${h}&rev=${rev}`, { signal: controller.signal });
            if (!response.ok) {
                let message = `Preview failed (${response.status})`;
                try { message = (await response.json()).error || message; } catch (_) { /* not JSON */ }
                throw Object.assign(new Error(message), { code: response.status === 503 ? 'unavailable' : '' });
            }
            const blob = await response.blob();
            if (controller.signal.aborted || state.playing) return;
            if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
            state.frameUrl = URL.createObjectURL(blob);
            state.frameKey = key;
            const img = $('#wsFrame');
            img.src = state.frameUrl;
            img.hidden = false;
            $('#wsVideo').hidden = true;
            setBadge('Exact frame', 'exact');
        } catch (error) {
            if (error.name === 'AbortError') return;
            const missing = ((state.view && state.view.project.media) || []).some((m) => m.missing);
            setBadge(missing ? 'Preview unavailable: a source file is missing' : 'Preview unavailable', 'busy', error.message);
            if (error.code === 'unavailable') checkEngine();
        }
    }

    function togglePlay() {
        if (state.playing) stopPlayback();
        else startPlayback();
    }

    function startPlayback() {
        if (!state.view || !clips().length) return;
        if (state.playhead >= duration() - 1 / fps()) state.playhead = 0;
        if (state.frameAbort) state.frameAbort.abort();
        state.playing = true;
        state.playStartWall = performance.now();
        state.playStartTime = state.playhead;
        $('#wsPlay').textContent = 'Pause';
        setBadge('Approximate preview: source playback, no layering or effects', 'approx');
        syncPlayback(true);
        requestAnimationFrame(tick);
    }

    function stopPlayback() {
        if (!state.playing) return;
        state.playing = false;
        $('#wsPlay').textContent = 'Play';
        const video = $('#wsVideo');
        const audio = $('#wsAudio');
        video.pause();
        audio.pause();
        requestFrame(true);
    }

    function tick() {
        if (!state.playing) return;
        const t = state.playStartTime + (performance.now() - state.playStartWall) / 1000;
        if (t >= duration()) {
            state.playhead = duration();
            positionPlayhead();
            stopPlayback();
            return;
        }
        state.playhead = t;
        positionPlayhead();
        keepPlayheadVisible();
        syncPlayback(false);
        requestAnimationFrame(tick);
    }

    function keepPlayheadVisible() {
        const scroll = $('#wsScroll');
        const x = state.playhead * state.pps;
        if (x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - 40;
    }

    function activeClip(t, kinds) {
        // Concat lists lanes bottom first; the topmost visible clip wins.
        const tl = timeline();
        if (!tl) return null;
        for (const track of [...tl.tracks].reverse()) {
            if (kinds.includes('audio') ? track.muted : track.visible === false) continue;
            const clip = (tl.clips || []).find((c) => c.trackId === track.id && t >= c.start && t < c.start + c.duration && kinds.includes(clipKind(c)));
            if (clip) return { clip, track };
        }
        return null;
    }

    function syncElement(el, hit, t, force) {
        if (!hit) {
            if (!el.paused) el.pause();
            el.dataset.clip = '';
            return false;
        }
        const { clip } = hit;
        const media = mediaById(clip.mediaId);
        if (!media || media.missing) return false;
        const expected = (clip.sourceStart || 0) + (t - clip.start) * (clip.speed || 1);
        if (el.dataset.clip !== clip.id) {
            el.dataset.clip = clip.id;
            if (el.dataset.src !== media.url) {
                el.dataset.src = media.url;
                el.src = media.url;
            }
            force = true;
        }
        el.playbackRate = clip.speed || 1;
        if (force || Math.abs(el.currentTime - expected) > 0.3) {
            try { el.currentTime = expected; } catch (_) { /* not seekable yet */ }
        }
        if (el.paused) el.play().catch(() => {});
        return true;
    }

    function syncPlayback(force) {
        const t = state.playhead;
        const video = $('#wsVideo');
        const img = $('#wsFrame');
        const visual = activeClip(t, ['video', 'image']);
        if (visual && clipKind(visual.clip) === 'image') {
            const media = mediaById(visual.clip.mediaId);
            if (media && img.dataset.src !== media.url) {
                img.dataset.src = media.url;
                img.src = media.url;
                state.frameKey = '';
            }
            img.hidden = false;
            video.hidden = true;
            syncElement(video, null, t, force);
        } else {
            const playing = syncElement(video, visual, t, force);
            video.hidden = !playing;
            img.hidden = playing;
            if (playing) {
                const track = visual.track;
                video.muted = !!(track.muted || visual.clip.muted);
                video.volume = Math.min(1, visual.clip.volume ?? 1);
            }
        }
        const audible = activeClip(t, ['audio']);
        const audio = $('#wsAudio');
        if (syncElement(audio, audible, t, force)) {
            audio.muted = !!audible.clip.muted;
            audio.volume = Math.min(1, audible.clip.volume ?? 1);
        }
    }

    // -- export ----------------------------------------------------------------

    function exportDialog() {
        if (!state.projectId) return;
        const size = frameSize();
        const scaled = (h) => {
            const w = Math.round((size.width * h) / size.height);
            return `${w - (w % 2)}x${h}`;
        };
        const dialog = $('#wsDialog');
        dialog.innerHTML = `
            <h3>Export MP4</h3>
            <p>Renders the timeline with Concat and adds the file to your Library (Video). One export runs at a time.</p>
            <form method="dialog">
                <div class="ws-form-row"><label for="wsExpSize">Size</label>
                    <select id="wsExpSize">
                        <option value="">${size.width} × ${size.height} (timeline)</option>
                        ${size.height > 720 ? `<option value="${scaled(720)}">${scaled(720).replace('x', ' × ')}</option>` : ''}
                        ${size.height > 480 ? `<option value="${scaled(480)}">${scaled(480).replace('x', ' × ')}</option>` : ''}
                    </select></div>
                <div class="ws-form-row"><label for="wsExpPreset">Encode</label>
                    <select id="wsExpPreset">
                        <option value="medium">Balanced (smaller file)</option>
                        <option value="veryfast">Fast (quick draft)</option>
                    </select></div>
                <div class="ws-dialog-actions">
                    <button class="btn btn-secondary" value="cancel" type="submit">Cancel</button>
                    <button class="btn btn-primary" value="export" type="submit">Export</button>
                </div>
            </form>`;
        dialog.addEventListener('close', async function onClose() {
            dialog.removeEventListener('close', onClose);
            if (dialog.returnValue !== 'export') return;
            const body = { preset: $('#wsExpPreset').value };
            const sizeValue = $('#wsExpSize').value;
            if (sizeValue) {
                const [width, height] = sizeValue.split('x').map(Number);
                Object.assign(body, { width, height });
            }
            try {
                state.job = await api('POST', `/projects/${state.projectId}/export`, body);
                renderExport();
                pollJob();
            } catch (error) {
                handleError(error.code === 'busy' ? 'Another export is running' : 'Export could not start', error);
            }
        });
        dialog.returnValue = '';
        dialog.showModal();
    }

    function renderExport() {
        const box = $('#wsExportProgress');
        const job = state.job;
        const active = job && ['running', 'queued', 'finishing'].includes(job.status);
        box.hidden = !active;
        if (active) {
            const bar = $('#wsExportBar');
            if (job.total) {
                bar.max = job.total;
                bar.value = job.frame || 0;
            } else {
                bar.removeAttribute('value');
            }
            const stage = job.status === 'finishing' ? 'saving to Library'
                : job.total ? `${job.stage || 'rendering'} ${Math.round((100 * (job.frame || 0)) / job.total)}%` : 'starting';
            $('#wsExportText').textContent = `Export: ${stage}`;
            $('#wsExportCancel').disabled = job.status === 'finishing';
        }
        renderControls();
    }

    function pollJob() {
        clearTimeout(state.jobTimer);
        if (!state.job) return;
        state.jobTimer = setTimeout(async () => {
            try {
                state.job = await api('GET', `/jobs/${state.job.id}`);
            } catch (error) {
                handleError('Lost track of the export', error);
                state.job = null;
                renderExport();
                return;
            }
            renderExport();
            const status = state.job.status;
            if (['running', 'queued', 'finishing'].includes(status)) {
                pollJob();
            } else if (status === 'done') {
                exportFinished(state.job);
            } else if (status === 'cancelled') {
                toast('Export cancelled', '', 'info');
            } else {
                toast(status === 'interrupted' ? 'Export interrupted' : 'Export failed', state.job.error || '', 'error');
            }
        }, 700);
    }

    async function exportFinished(job) {
        const answer = await choice('Export finished', `“${job.project_name}” was saved to your Library as ${job.output.split('/').pop()}.`, [
            { label: 'Close', value: 'close' },
            { label: 'Open file', value: 'file' },
            { label: 'Show in Library', value: 'library', primary: true },
        ]);
        if (answer === 'file') {
            window.open(job.url, '_blank', 'noopener');
        } else if (answer === 'library' && typeof window.activateTab === 'function') {
            window.activateTab('library');
            document.querySelector('[data-media-tab="video"]')?.click();
        }
    }

    async function cancelExport() {
        if (!state.job) return;
        try {
            state.job = await api('POST', `/jobs/${state.job.id}/cancel`);
            renderExport();
        } catch (error) {
            handleError('Could not cancel', error);
        }
    }

    async function resumeJobs() {
        // An export keeps running across a page refresh; pick it back up.
        try {
            const data = await api('GET', '/jobs');
            const running = (data.jobs || []).find((j) => (j.kind || 'export') === 'export' && ['running', 'queued', 'finishing'].includes(j.status));
            if (running) {
                state.job = running;
                renderExport();
                pollJob();
            }
            const captioning = (data.jobs || []).find((j) => j.kind === 'captions' && j.status === 'running');
            if (captioning) {
                state.captionJob = captioning;
                renderCaptionProgress();
                pollCaptions();
            }
        } catch (_) { /* the panel works without job history */ }
    }

    // -- keyboard -------------------------------------------------------------

    function onKey(e) {
        if (!isActive() || !state.view) return;
        const target = e.target;
        if (target && (target.closest('input, textarea, select, dialog') || target.isContentEditable)) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key;
        if (mod && key.toLowerCase() === 'z') {
            e.preventDefault();
            history(e.shiftKey ? 'redo' : 'undo');
        } else if (mod && key.toLowerCase() === 'y') {
            e.preventDefault();
            history('redo');
        } else if (mod && key.toLowerCase() === 's') {
            e.preventDefault();
            saveProject();
        } else if (mod) {
            return;
        } else if (key === ' ') {
            e.preventDefault();
            togglePlay();
        } else if (key === 's' || key === 'S') {
            e.preventDefault();
            splitAtPlayhead();
        } else if (key === 'Delete' || key === 'Backspace') {
            if (state.selected) {
                e.preventDefault();
                removeSelected();
            }
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
            e.preventDefault();
            const step = e.shiftKey ? 1 : 1 / fps();
            seek(state.playhead + (key === 'ArrowLeft' ? -step : step), true);
        } else if (key === 'Home') {
            e.preventDefault();
            seek(0, true);
        }
    }

    // -- entry point -----------------------------------------------------------

    window.initWorkspaceTab = async function initWorkspaceTab() {
        if (!state.initialized) {
            state.initialized = true;
            buildLayout();
            bindLayout();
            renderAll();
            const up = await checkEngine();
            await loadProjects(up);
            resumeJobs();
            return;
        }
        // Returning to the tab: recheck the engine and refresh the open project.
        const up = await checkEngine();
        if (up && state.projectId) await openProject(state.projectId);
        else if (up) await loadProjects(true);
    };
})();
