import * as THREE from "three";
import { GLTFLoader } from "/vendor/three/GLTFLoader.js";
import { OrbitControls } from "/vendor/three/OrbitControls.js";

const PIPELINES = [
  { id: "text-to-image", category: "Create", name: "Text > Image", mediaType: "image", workflowId: "z-image-turbo-fixed-ae-vae" },
  { id: "image-to-image", category: "Create", name: "Image Modify", mediaType: "image", workflowId: "image-to-image-omnigen2-edit" },
  { id: "text-to-video", category: "Create", name: "Text > Video", mediaType: "video", workflowId: "hunyuan-video-15-720p-text-to-video" },
  { id: "image-text-to-video", category: "Create", name: "Image > Video", mediaType: "video", workflowId: "hunyuan-video-15-720p-image-to-video" },
  { id: "ltx-text-to-video", category: "Create", name: "Fast Text Video", mediaType: "video", workflowId: "ltxv-095-text-to-video" },
  { id: "ltx-image-to-video", category: "Create", name: "Fast Image Video", mediaType: "video", workflowId: "ltxv-095-image-to-video" },
  { id: "start-end-image-to-video", category: "Create", name: "Start + End Video", mediaType: "video", workflowId: "start-end-image-to-video-wan-22" },
  { id: "video-sequence", category: "Create", name: "Video Sequence", mediaType: "video", workflowId: "start-end-image-to-video-wan-22", sequence: true },
  { id: "image-to-3d", category: "Create", name: "Image > 3D", mediaType: "model", workflowId: "image-to-3d-hunyuan3d" },
  { id: "text-to-3d", category: "Create", name: "Text > 3D", mediaType: "model", workflowId: "text-to-3d-local-zimage-hunyuan3d" },
  { id: "multi-image-to-3d", category: "Create", name: "Multi-Image > 3D", mediaType: "model", workflowId: "multi-image-to-3d-hunyuan3d" },
  { id: "image-upscale", category: "Enhance", name: "Image Upscale", mediaType: "image", workflowId: "image-upscale-basic" },
  { id: "video-upscale", category: "Enhance", name: "Video Upscale", mediaType: "video", workflowId: "video-upscale-gan" },
  { id: "remove-background", category: "Enhance", name: "Remove Background", mediaType: "image", workflowId: "remove-background-birefnet" },
  { id: "frame-interpolation", category: "Enhance", name: "Frame Interpolation", mediaType: "video", workflowId: "frame-interpolation" },
  { id: "image-inpaint", category: "Edit", name: "Image Inpaint", mediaType: "image", workflowId: "image-inpaint-flux-fill" },
  { id: "image-outpaint", category: "Edit", name: "Image Outpaint", mediaType: "image", workflowId: "image-outpaint-qwen-blueprint" },
  { id: "video-edit", category: "Edit", name: "Video Edit", mediaType: "video", workflowId: "video-edit-bernini-r" },
  { id: "video-inpaint", category: "Edit", name: "Video Inpaint", mediaType: "video", workflowId: "video-inpaint-void" },
  { id: "depth-map", category: "Analyze", name: "Depth Map", mediaType: "image", workflowId: "depth-map-depth-anything3" },
  { id: "pose-map", category: "Analyze", name: "Pose Map", mediaType: "image", workflowId: "pose-map-sdpose" },
  { id: "extract-video-frame", category: "Analyze", name: "Extract Video Frame", mediaType: "image", workflowId: "extract-video-frame-blueprint" },
];

const state = {
  pipelineId: initialPipelineId(),
  workflows: [],
  items: [],
  queue: { running: [], pending: [] },
  cancelling: new Set(),
  modelViewer: null,
};

const $ = (selector) => document.querySelector(selector);
const gallery = $("#gallery");
const latest = $("#latest");
const form = $("#generateForm");
const jobStatus = $("#jobStatus");
const workflowNav = $("#workflowNav");
const workflowFields = $("#workflowFields");
const progressFill = $("#progressFill");
const sequencePanel = $("#sequencePanel");
const sequenceList = $("#sequenceList");
const queuePanel = $("#queuePanel");

function initialPipelineId() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("pipeline") || params.get("pipelineId") || window.location.hash.replace(/^#/, "");
  return PIPELINES.some((pipeline) => pipeline.id === requested) ? requested : "text-to-image";
}

function activePipeline() {
  return PIPELINES.find((pipeline) => pipeline.id === state.pipelineId) || PIPELINES[0];
}

function workflowForPipeline(pipeline = activePipeline()) {
  if (!pipeline?.workflowId) return null;
  return state.workflows.find((workflow) => workflow.id === pipeline.workflowId) || null;
}

function mediaLabel(type) {
  if (type === "model") return "3D";
  return type ? type[0].toUpperCase() + type.slice(1) : "Output";
}

function setPipeline(pipelineId) {
  state.pipelineId = pipelineId;
  const pipeline = activePipeline();
  const workflow = workflowForPipeline(pipeline);

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.pipelineId === pipeline.id);
  });

  $("#modeLabel").textContent = mediaLabel(pipeline.mediaType);
  $("#modeTitle").textContent = pipeline.name;
  if (workflow?.ready) {
    $("#modeNote").textContent = `Using ${workflow.path.split("/").pop()} with ${workflow.control_count || 0} controls.`;
  } else {
    $("#modeNote").textContent = workflow?.provider_nodes?.length
      ? `Blocked: provider/API node ${workflow.provider_nodes.join(", ")}.`
      : pipeline.workflowId
        ? "Workflow file is present but not ready."
      : "Pipeline listed for planning. Workflow not wired yet.";
  }
  $("#generateButton").hidden = Boolean(pipeline.sequence);
  $("#generateButton").disabled = !workflow?.ready || Boolean(pipeline.sequence);
  renderPipelineFields(pipeline, workflow);
  renderSequencePanel(pipeline, workflow);
  renderGallery();
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    $("#comfyState").textContent = data.comfy ? "ComfyUI online" : "ComfyUI idle";
    $("#comfyUrl").textContent = data.comfy_url;
    $("#comfyDot").classList.toggle("online", data.comfy);
    if (data.workflows) {
      const hadWorkflows = state.workflows.length > 0;
      state.workflows = data.workflows;
      renderPipelineNav();
      if (!hadWorkflows) {
        setPipeline(state.pipelineId);
      } else {
        updateActiveNav();
        const pipeline = activePipeline();
        $("#generateButton").disabled = !workflowForPipeline(pipeline)?.ready || Boolean(pipeline.sequence);
      }
    }
  } catch (error) {
    $("#comfyState").textContent = "Studio offline";
    $("#comfyUrl").textContent = error.message;
    $("#comfyDot").classList.remove("online");
  }
  await refreshQueue();
}

async function refreshQueue() {
  try {
    const response = await fetch("/api/queue");
    if (!response.ok) throw new Error("Queue unavailable");
    const payload = await response.json();
    state.queue = {
      running: payload.running || [],
      pending: payload.pending || [],
    };
    if (payload.error && !state.queue.running.length && !state.queue.pending.length) {
      renderQueueState("Queue unavailable.");
      return;
    }
    renderQueue();
  } catch (error) {
    renderQueueState(error.message);
  }
}

function renderQueueState(message) {
  queuePanel.className = "queue-panel empty";
  queuePanel.innerHTML = `
    <div class="queue-panel-title">Queue</div>
    <div class="queue-panel-body">${escapeHtml(message)}</div>
  `;
}

function renderQueue() {
  const items = [...state.queue.running, ...state.queue.pending];
  queuePanel.innerHTML = "";
  queuePanel.className = items.length ? "queue-panel" : "queue-panel empty";
  const title = document.createElement("div");
  title.className = "queue-panel-title";
  title.textContent = "Queue";
  queuePanel.append(title);
  if (!items.length) {
    const body = document.createElement("div");
    body.className = "queue-panel-body";
    body.textContent = "No queued jobs.";
    queuePanel.append(body);
    return;
  }

  for (const item of items) {
    if (!item.prompt_id) continue;
    const row = document.createElement("div");
    row.className = "queue-item";
    const canceling = state.cancelling.has(item.prompt_id);
    row.innerHTML = `
      <div class="queue-copy">
        <strong>${escapeHtml(item.workflow || "Studio job")}</strong>
        <span>${item.state === "running" ? "Running" : `Queued ${item.position}`}</span>
      </div>
      <button type="button" class="queue-cancel" data-prompt-id="${escapeHtml(item.prompt_id)}" ${canceling ? "disabled" : ""}>${canceling ? "Canceling" : "Cancel"}</button>
    `;
    queuePanel.append(row);
  }
}

async function cancelPrompt(promptId) {
  if (!promptId || state.cancelling.has(promptId)) return;
  state.cancelling.add(promptId);
  renderQueue();
  try {
    const response = await fetch(`/api/cancel/${encodeURIComponent(promptId)}`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Cancel failed");
    }
    jobStatus.textContent = payload.cancelled ? "Cancel requested." : "That job is no longer queued.";
    await refreshQueue();
  } catch (error) {
    jobStatus.textContent = error.message;
  } finally {
    state.cancelling.delete(promptId);
    renderQueue();
  }
}

function updateActiveNav() {
  const pipeline = activePipeline();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.pipelineId === pipeline.id);
  });
}

function renderPipelineNav() {
  workflowNav.innerHTML = "";
  const categories = [...new Set(PIPELINES.map((pipeline) => pipeline.category))];
  for (const category of categories) {
    const heading = document.createElement("div");
    heading.className = "nav-heading";
    heading.textContent = category;
    workflowNav.append(heading);

    for (const pipeline of PIPELINES.filter((item) => item.category === category)) {
      const workflow = workflowForPipeline(pipeline);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-item";
      button.dataset.pipelineId = pipeline.id;
      button.innerHTML = `<span>${pipeline.name}</span><small>${workflow?.ready ? "Ready" : "Not wired"} · ${mediaLabel(pipeline.mediaType)}</small>`;
      button.addEventListener("click", () => setPipeline(pipeline.id));
      workflowNav.append(button);
    }
  }
}

function renderPipelineFields(pipeline, workflow) {
  workflowFields.innerHTML = "";
  if (!workflow?.ready) {
    workflowFields.innerHTML = `<div class="empty field-empty">No workflow is attached to this pipeline yet.</div>`;
    return;
  }

  const controls = workflow.controls || [];
  if (!controls.length) {
    workflowFields.innerHTML = `<div class="empty field-empty">No editable controls found in this workflow.</div>`;
    return;
  }

  if (pipeline.sequence) {
    const commonControls = controls.filter((control) => control.label !== "Prompt" && control.kind !== "file");
    if (!commonControls.length) {
      workflowFields.innerHTML = `<div class="empty field-empty">Sequence segments carry their own prompt and images.</div>`;
      return;
    }
    for (const control of commonControls) {
      workflowFields.append(renderControl(control));
    }
    return;
  }

  const promptControls = controls.filter((control) => control.kind === "textarea");
  const compactControls = controls.filter((control) => control.kind !== "textarea");

  for (const control of promptControls) {
    workflowFields.append(renderControl(control));
  }

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const control of compactControls) {
    grid.append(renderControl(control));
  }
  workflowFields.append(grid);
}

function renderSequencePanel(pipeline, workflow) {
  const usable = Boolean(pipeline?.sequence && workflow?.ready && promptControl(workflow) && sequenceImageControls(workflow).length >= 2);
  sequencePanel.hidden = !usable;
  $("#generateSequenceButton").disabled = !usable;
  if (!usable) {
    sequenceList.innerHTML = "";
    return;
  }
  renderSequenceRows(Number($("#sequenceCount").value) || 3, [], workflow);
}

function promptControl(workflow) {
  return (workflow?.controls || []).find((control) => control.kind === "textarea" && control.label === "Prompt")
    || (workflow?.controls || []).find((control) => control.kind === "textarea" && control.input === "text")
    || null;
}

function defaultSequencePrompts(workflow) {
  return promptControl(workflow)?.value || "";
}

function sequenceImageControls(workflow) {
  return (workflow?.controls || []).filter((control) => control.kind === "file" && control.node_type === "LoadImage");
}

function renderSequenceRows(count, outputs = [], workflow = workflowForPipeline(activePipeline())) {
  sequenceList.innerHTML = "";
  const [startControl, endControl] = sequenceImageControls(workflow);
  const prompt = promptControl(workflow);
  const defaultPrompt = defaultSequencePrompts(workflow);
  for (let index = 0; index < count; index += 1) {
    const output = outputs[index];
    const row = document.createElement("div");
    row.className = "sequence-card";
    row.dataset.segmentIndex = String(index);
    const status = output
      ? `<a href="${output.url}" target="_blank" rel="noreferrer">${output.filename || `Segment ${index + 1}`}</a>`
      : `<span class="sequence-status">Pending</span>`;
    row.innerHTML = `
      <div class="sequence-card-head">
        <span class="sequence-index">${index + 1}</span>
        <strong>Segment ${index + 1}</strong>
        <span class="sequence-status">${output ? "Done" : "Pending"}</span>
      </div>
      <label class="field">
        <span>Prompt</span>
        <textarea class="sequence-prompt" data-control-id="${prompt.id}" rows="4">${defaultPrompt}</textarea>
      </label>
      <div class="sequence-image-grid">
        ${renderSequenceImageField("Start image", startControl, index)}
        ${renderSequenceImageField("End image", endControl, index)}
      </div>
      <div class="sequence-output">${status}</div>
    `;
    sequenceList.append(row);
  }
}

function renderSequenceImageField(label, control, index) {
  const value = control?.value || "";
  return `
    <label class="field sequence-image-field">
      <span>${label}</span>
      <input class="sequence-file" type="file" accept="${control?.accept || "image/png,image/jpeg,image/webp,image/bmp"}" data-control-id="${control?.id || ""}" data-segment-index="${index}" />
      <input class="sequence-file-name" type="text" value="${escapeHtml(value)}" data-control-id="${control?.id || ""}" data-segment-index="${index}" placeholder="Existing ComfyUI input filename" />
    </label>
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function renderControl(control) {
  const label = document.createElement("label");
  label.className = control.kind === "textarea" || control.kind === "file" ? "field span" : "field";

  const span = document.createElement("span");
  span.textContent = control.label;
  label.append(span);

  if (control.kind === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.name = control.id;
    textarea.rows = control.label === "Prompt" ? 7 : 3;
    textarea.value = control.value ?? "";
    label.append(textarea);
    return label;
  }

  if (control.kind === "file") {
    const wrap = document.createElement("div");
    wrap.className = "file-control";

    const file = document.createElement("input");
    file.name = `${control.id}.__file`;
    file.type = "file";
    file.accept = control.accept || "image/png,image/jpeg,image/webp,image/bmp";
    file.dataset.target = control.id;

    const current = document.createElement("input");
    current.name = control.id;
    current.type = "text";
    current.value = control.value ?? "";
    current.placeholder = "Existing ComfyUI input filename";

    wrap.append(file, current);
    label.append(wrap);
    return label;
  }

  if (control.kind === "checkbox") {
    const input = document.createElement("input");
    input.name = control.id;
    input.type = "checkbox";
    input.value = "true";
    input.checked = Boolean(control.value);
    label.classList.add("check-field");
    label.append(input);
    return label;
  }

  const input = document.createElement("input");
  input.name = control.id;
  input.type = control.kind === "number" ? "number" : "text";
  input.value = control.input === "seed" || control.input === "noise_seed" ? "-1" : control.value ?? "";
  if (control.kind === "number") {
    input.step = Number.isInteger(Number(control.value)) ? "1" : "0.1";
  }
  label.append(input);
  return label;
}

async function refreshGallery() {
  const response = await fetch("/api/gallery");
  const data = await response.json();
  state.items = data.items || [];
  renderGallery();
}

function renderGallery() {
  const pipeline = activePipeline();
  const type = pipeline?.mediaType || "image";
  const items = state.items.filter((item) => item.type === type);
  gallery.innerHTML = "";
  if (!items.length) {
    disposeModelViewer();
    gallery.innerHTML = `<div class="empty">No ${mediaLabel(type).toLowerCase()} outputs yet.</div>`;
    latest.className = "latest empty";
    latest.textContent = "No outputs found yet.";
    $("#latestTitle").textContent = "Gallery";
    return;
  }

  renderLatest(items[0]);
  for (const item of items) {
    const tile = document.createElement("article");
    tile.className = "tile";
    tile.innerHTML = `${mediaMarkup(item, true)}<footer title="${item.name}">${item.name}</footer>`;
    tile.addEventListener("click", () => renderLatest(item));
    gallery.append(tile);
  }
}

function renderLatest(item) {
  disposeModelViewer();
  latest.className = "latest";
  $("#latestTitle").textContent = item.name;
  if (item.type === "model") {
    renderModelViewer(item);
    return;
  }
  latest.innerHTML = mediaMarkup(item, false);
}

function mediaMarkup(item, thumb) {
  if (item.type === "image") {
    return `<img src="${item.url}" alt="${item.name}" loading="${thumb ? "lazy" : "eager"}" />`;
  }
  if (item.type === "video") {
    return `<video src="${item.url}" ${thumb ? "muted" : "controls"}></video>`;
  }
  if (thumb) {
    return `<div class="model-thumb" aria-label="${item.name}"><span>3D</span></div>`;
  }
  return `<a class="model-file" href="${item.url}" download>${item.name}</a>`;
}

function renderModelViewer(item) {
  latest.innerHTML = `
    <div class="model-viewer">
      <canvas aria-label="${item.name} preview"></canvas>
      <div class="model-actions">
        <a class="model-file" href="${item.url}" download>Download GLB</a>
      </div>
    </div>
  `;

  const container = latest.querySelector(".model-viewer");
  const canvas = latest.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d100f);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(2.8, 1.8, 3.2);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x314039, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7fd4b7, 1.0);
  fill.position.set(-3, 2, -4);
  scene.add(fill);

  const grid = new THREE.GridHelper(4, 16, 0x334039, 0x1d2622);
  grid.position.y = -0.02;
  scene.add(grid);

  const resizeObserver = new ResizeObserver(() => resizeRenderer(renderer, camera, container));
  resizeObserver.observe(container);

  let frameId = null;
  const animate = () => {
    resizeRenderer(renderer, camera, container);
    controls.update();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };

  state.modelViewer = {
    controls,
    renderer,
    resizeObserver,
    scene,
    stop: () => {
      if (frameId) cancelAnimationFrame(frameId);
    },
  };

  new GLTFLoader().load(
    item.url,
    (gltf) => {
      const root = gltf.scene;
      scene.add(root);
      frameModel(root, camera, controls);
      animate();
    },
    undefined,
    (error) => {
      latest.innerHTML = `<a class="model-file" href="${item.url}" download>Could not preview ${item.name}. Download GLB</a>`;
      console.error(error);
    },
  );
}

function frameModel(root, camera, controls) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const distance = maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.position.set(distance * 0.9, distance * 0.65, distance * 1.15);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 100);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

function resizeRenderer(renderer, camera, container) {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const canvas = renderer.domElement;
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function disposeModelViewer() {
  const viewer = state.modelViewer;
  if (!viewer) return;
  viewer.stop();
  viewer.resizeObserver.disconnect();
  viewer.controls.dispose();
  viewer.scene.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
  viewer.renderer.dispose();
  state.modelViewer = null;
}

async function submitGeneration(event) {
  event.preventDefault();
  const pipeline = activePipeline();
  const workflow = workflowForPipeline(pipeline);
  if (!workflow?.ready) return;

  $("#generateButton").disabled = true;
  jobStatus.textContent = `Starting ${pipeline.name}...`;
  setProgress(8, false);

  try {
    const values = await collectFormValues();
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflow.id, values }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Generation failed");
    }
    const seedText = payload.seed === null || payload.seed === undefined ? "" : ` with seed ${payload.seed}`;
    jobStatus.textContent = `Queued ${pipeline.name}${seedText}. Rendering...`;
    setProgress(18, true);
    await refreshStatus();
    await refreshQueue();
    await waitForPrompt(payload.prompt_id, payload.media_type);
  } catch (error) {
    jobStatus.textContent = error.message;
    setProgress(0, false);
  } finally {
    $("#generateButton").disabled = !workflowForPipeline(activePipeline())?.ready;
  }
}

async function submitSequence() {
  const pipeline = activePipeline();
  const workflow = workflowForPipeline(pipeline);
  const prompt = promptControl(workflow);
  const [startControl, endControl] = sequenceImageControls(workflow);
  if (!pipeline.sequence || !workflow?.ready || !prompt || !startControl || !endControl) return;

  const segmentCount = Math.max(2, Math.min(12, Number($("#sequenceCount").value) || 2));
  const baseValues = await collectFormValues();
  const outputs = [];

  $("#generateButton").disabled = true;
  $("#generateSequenceButton").disabled = true;

  try {
    for (let index = 0; index < segmentCount; index += 1) {
      const values = { ...baseValues };
      const segmentValues = await collectSequenceSegmentValues(index, { prompt, startControl, endControl });
      Object.assign(values, segmentValues);
      jobStatus.textContent = `Queued segment ${index + 1} of ${segmentCount}.`;
      setProgress(Math.max(8, Math.round((index / segmentCount) * 90)), true);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: workflow.id,
          values,
          sequence: {
            index: index + 1,
            count: segmentCount,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Segment ${index + 1} failed`);
      }
      await refreshQueue();
      const output = await waitForPrompt(payload.prompt_id, payload.media_type, {
        label: `Segment ${index + 1} of ${segmentCount}`,
        progressStart: Math.round((index / segmentCount) * 90),
        progressEnd: Math.round(((index + 1) / segmentCount) * 90),
      });
      if (output) {
        outputs.push(output);
        updateSequenceRow(index, output);
      }
    }

    if ($("#sequenceStitch").checked && outputs.length > 1) {
      jobStatus.textContent = "Stitching sequence...";
      const response = await fetch("/api/stitch-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputs, workflow_id: workflow.id }),
      });
      const payload = await response.json();
      if (response.ok && payload.output) {
        await refreshGallery();
        renderLatest({ name: payload.output.filename, type: payload.output.type, url: payload.output.url });
        jobStatus.textContent = `Sequence complete: ${payload.output.filename}`;
      } else {
        jobStatus.textContent = payload.error || "Sequence complete. Stitching is not available.";
      }
    } else {
      await refreshGallery();
      jobStatus.textContent = `Sequence complete: ${outputs.length} segments.`;
    }
    setProgress(100, false);
  } catch (error) {
    jobStatus.textContent = error.message;
    setProgress(0, false);
  } finally {
    $("#generateButton").disabled = !workflowForPipeline(activePipeline())?.ready;
    $("#generateSequenceButton").disabled = !(activePipeline().mediaType === "video" && workflowForPipeline(activePipeline())?.ready);
  }
}

function updateSequenceRow(index, output) {
  const card = sequenceList.querySelector(`.sequence-card[data-segment-index="${index}"]`);
  if (!card) return;
  const status = card.querySelector(".sequence-card-head .sequence-status");
  const outputSlot = card.querySelector(".sequence-output");
  if (status) status.textContent = "Done";
  if (outputSlot) {
    outputSlot.innerHTML = `<a href="${output.url}" target="_blank" rel="noreferrer">${output.filename || `Segment ${index + 1}`}</a>`;
  }
}

async function collectFormValues() {
  const values = {};
  const fields = Array.from(form.elements);

  for (const field of fields) {
    if (!field.name || field.type === "submit") continue;
    if (field.type !== "file") {
      values[field.name] = field.type === "checkbox" ? (field.checked ? "true" : "false") : field.value;
    }
  }

  for (const field of fields.filter((item) => item.type === "file" && item.files.length)) {
    const target = field.dataset.target;
    jobStatus.textContent = `Uploading ${field.files[0].name}...`;
    setProgress(10, true);
    const payload = await uploadFile(field.files[0]);
    values[target] = payload.name;
    const textInput = form.elements[target];
    if (textInput) {
      textInput.value = payload.name;
    }
  }

  return values;
}

async function collectSequenceSegmentValues(index, controls) {
  const card = sequenceList.querySelector(`.sequence-card[data-segment-index="${index}"]`);
  if (!card) {
    throw new Error(`Segment ${index + 1} is missing.`);
  }
  const values = {};
  values[controls.prompt.id] = card.querySelector(".sequence-prompt")?.value || "";
  for (const control of [controls.startControl, controls.endControl]) {
    const fileInput = card.querySelector(`.sequence-file[data-control-id="${control.id}"]`);
    const textInput = card.querySelector(`.sequence-file-name[data-control-id="${control.id}"]`);
    if (fileInput?.files?.length) {
      jobStatus.textContent = `Uploading segment ${index + 1} ${control === controls.startControl ? "start" : "end"} image...`;
      const payload = await uploadFile(fileInput.files[0]);
      values[control.id] = payload.name;
      if (textInput) textInput.value = payload.name;
    } else {
      values[control.id] = textInput?.value || control.value || "";
    }
  }
  return values;
}

async function uploadFile(file) {
  const upload = new FormData();
  upload.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body: upload });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Upload failed");
  }
  return payload;
}

async function waitForPrompt(promptId, mediaType, options = {}) {
  const started = Date.now();
  const label = options.label || "Render";
  const progressStart = options.progressStart ?? 15;
  const progressEnd = options.progressEnd ?? 100;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 4 ? 2000 : 5000));
    const response = await fetch(`/api/progress/${encodeURIComponent(promptId)}`);
    const payload = await response.json();
    await refreshQueue();
    if (payload.state === "cancelled") {
      setProgress(0, false);
      throw new Error(`${label} canceled.`);
    }
    if (payload.completed) {
      await refreshGallery();
      const firstOutput = (payload.outputs || []).find((item) => item.type === mediaType);
      if (firstOutput) {
        renderLatest({ name: firstOutput.filename, type: firstOutput.type, url: firstOutput.url });
        return firstOutput;
      } else if (payload.status === "success") {
        const elapsed = payload.elapsed ? ` in ${formatElapsed(payload.elapsed * 1000)}` : "";
        jobStatus.textContent = `Finished${elapsed}, but no ${mediaLabel(mediaType).toLowerCase()} output was returned.`;
        setProgress(100, false);
        return null;
      }
      const elapsed = payload.elapsed ? ` in ${formatElapsed(payload.elapsed * 1000)}` : "";
      jobStatus.textContent = payload.status === "success" ? `Finished${elapsed}.` : `Finished with status: ${payload.status}`;
      setProgress(progressEnd, false);
      return null;
    }
    jobStatus.textContent = `${label}: ${progressText(payload, Date.now() - started)}`;
    if (payload.state === "queued") {
      setProgress(progressStart + Math.round((progressEnd - progressStart) * 0.2), true);
    } else if (payload.state === "running") {
      setProgress(progressStart + Math.round((progressEnd - progressStart) * 0.7), true);
    } else {
      setProgress(progressStart, true);
    }
  }
  jobStatus.textContent = "Still rendering. The gallery will show the file after ComfyUI finishes.";
  setProgress(75, true);
  return null;
}

function progressText(payload, elapsedMs) {
  if (payload.state === "queued") {
    return `Queued: position ${payload.queue_position} of ${payload.queue_remaining}. Elapsed ${formatElapsed(elapsedMs)}.`;
  }
  if (payload.state === "running") {
    return `Running. Elapsed ${formatElapsed(elapsedMs)}.`;
  }
  return `Waiting for ComfyUI. Elapsed ${formatElapsed(elapsedMs)}.`;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setProgress(width, running) {
  progressFill.style.width = `${width}%`;
  progressFill.classList.toggle("running", running);
}

$("#refreshGallery").addEventListener("click", refreshGallery);
queuePanel.addEventListener("click", (event) => {
  const button = event.target.closest(".queue-cancel");
  if (!button) return;
  cancelPrompt(button.dataset.promptId);
});
$("#generateSequenceButton").addEventListener("click", submitSequence);
$("#sequenceCount").addEventListener("input", () => renderSequenceRows(Number($("#sequenceCount").value) || 3));
form.addEventListener("submit", submitGeneration);

renderPipelineNav();
refreshStatus();
refreshGallery();
setInterval(refreshStatus, 5000);
