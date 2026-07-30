import * as THREE from "/vendor/three/build/three.module.js";
import { compactText, escapeHtml } from "/plugin-tab-shared.js";

const MAX_VISIBLE_WORKERS = 6;
const workerSpriteState = window.WorkerSpriteOverlay || (window.WorkerSpriteOverlay = {
  addon: null,
  cleanup: null,
  workers: [],
  taskWorkers: [],
  brainWorkers: [],
  waitingTasks: [],
  queuePressure: null,
  voiceState: { mode: "off" },
  cronState: { jobs: [] },
  interrupts: [],
  requestCapsules: [],
  thought: null,
  pluginLoad: null,
  root: null,
  refreshTimer: null,
  listenersStarted: false
});
workerSpriteState.requestCapsules = Array.isArray(workerSpriteState.requestCapsules) ? workerSpriteState.requestCapsules : [];


function hashText(value = "") {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function toTitleCase(value = "") {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function accentPaletteForKey(value = "") {
  const palettes = [
    { primary: 0x7dd3fc, soft: "#d8f4ff", ink: "#1a2c34" },
    { primary: 0xf9a8d4, soft: "#ffe0f2", ink: "#381f2f" },
    { primary: 0xfde68a, soft: "#fff3c5", ink: "#41351d" },
    { primary: 0x86efac, soft: "#defce8", ink: "#1f3527" },
    { primary: 0xc4b5fd, soft: "#ece7ff", ink: "#2d2550" },
    { primary: 0xfdba74, soft: "#ffe9d1", ink: "#442a1a" }
  ];
  return palettes[hashText(value) % palettes.length];
}

function hexToCss(value = 0xffffff) {
  return `#${Number(value).toString(16).padStart(6, "0")}`;
}

function pickTaskDisplayDescription(task = {}) {
  const description = compactText(task.projectWorkFocus || task.focus || task.description || task.message || task.notes || "", 96);
  if (description) {
    return description;
  }
  const projectTitle = compactText(task.projectName || task.projectTitle || "", 52);
  if (projectTitle) {
    return projectTitle;
  }
  const internalJobType = String(task.internalJobType || "").trim();
  if (internalJobType) {
    return compactText(toTitleCase(internalJobType), 52);
  }
  return "Active task";
}

function normalizeBusyTask(task = {}) {
  const id = String(task?.id || "").trim();
  if (!id) {
    return null;
  }
  const taskRef = String(task.codename || task.taskLabel || task.taskId || task.activeTaskCodename || "").trim();
  const description = pickTaskDisplayDescription(task);
  const projectName = String(task.projectName || task.projectTitle || "").trim();
  const roleName = String(task.projectWorkRoleName || task.roleName || "").trim();
  const status = String(task.status || "").trim();
  const brainLabel = compactText(task.brainLabel || task.requestedBrainLabel || task.requestedBrainId || "worker", 24);
  return {
    id,
    taskId: String(task.taskId || task.activeTaskId || "").trim(),
    label: compactText(taskRef || "Task", 48),
    description,
    projectName,
    projectWorkFocus: String(task.projectWorkFocus || task.focus || description || "").trim(),
    projectWorkRoleName: roleName,
    projectWorkRoleReason: String(task.projectWorkRoleReason || task.roleReason || "").trim(),
    status,
    summary: String(task.summary || task.resultSummary || task.reviewSummary || task.workerSummary || task.notes || "").trim(),
    brainLabel,
    accentKey: String(task.queueLane || task.endpointId || task.brainLabel || task.requestedBrainId || id).trim(),
    isRepair: Number(task.reshapeAttemptCount || 0) > 0
      || Boolean(task.failureClassification)
      || String(task.internalJobType || "").trim() === "escalation_review"
      || Boolean(String(task.previousTaskId || "").trim())
      || Boolean(String(task.escalationParentTaskId || "").trim()),
    startedAt: Number(task.startedAt || 0) || Date.now(),
    updatedAt: Number(task.updatedAt || 0) || Date.now()
  };
}

function normalizeBusyBrain(entry = {}) {
  const id = String(entry?.id || "").trim();
  if (!id) {
    return null;
  }
  const taskRef = String(entry.activeTaskCodename || entry.activeTaskId || "").trim();
  const lane = String(entry.queueLane || "").trim();
  const label = compactText(entry.label || id || "Worker", 24);
  const laneLabel = lane.replace(/^endpoint:/, "").replaceAll(":", " ");
  const displayDescription = compactText(
    entry.description || taskRef || (laneLabel ? `Busy on ${laneLabel}` : "Task running"),
    52
  );
  return {
    id: `brain:${id}`,
    taskId: String(entry.activeTaskId || "").trim(),
    label,
    description: displayDescription,
    brainLabel: compactText(label, 24),
    accentKey: String(entry.queueLane || entry.endpointId || entry.label || id).trim(),
    isRepair: false,
    startedAt: Number(entry.lastActivityAt || 0) || Date.now(),
    updatedAt: Date.now()
  };
}

function normalizeWaitingTask(task = {}) {
  const id = String(task?.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    label: compactText(String(task.codename || task.id || "Question").trim(), 40),
    description: compactText(String(task.questionForUser || task.message || "Waiting for your direction.").trim(), 56),
    accentKey: String(task.requestedBrainId || task.requestedBrainLabel || id).trim()
  };
}

function isBusyWorkerTask(task = {}) {
  const status = String(task?.status || "").trim().toLowerCase();
  if (status !== "in_progress") {
    return false;
  }
  const brainId = String(task?.requestedBrainId || task?.brainId || "").trim().toLowerCase();
  const brainLabel = String(task?.requestedBrainLabel || task?.brainLabel || "").trim().toLowerCase();
  return !brainId || brainId.includes("worker") || brainLabel.includes("worker");
}

function isBusyWorkerBrain(entry = {}) {
  const active = entry?.active === true || Number(entry?.inProgressCount || 0) > 0;
  if (!active) {
    return false;
  }
  const kind = String(entry?.kind || "").trim().toLowerCase();
  const id = String(entry?.id || "").trim().toLowerCase();
  const label = String(entry?.label || "").trim().toLowerCase();
  return kind === "worker" || id.includes("worker") || label.includes("worker");
}

function normalizeBusyEntry(entry = {}) {
  if (
    entry
    && typeof entry === "object"
    && typeof entry.id === "string"
    && typeof entry.description === "string"
    && typeof entry.brainLabel === "string"
  ) {
    return {
      ...entry,
      startedAt: Number(entry.startedAt || 0) || Date.now(),
      updatedAt: Number(entry.updatedAt || 0) || Date.now()
    };
  }
  return normalizeBusyTask(entry) || normalizeBusyBrain(entry);
}

function mergeWorkers() {
  const byKey = new Map();
  for (const worker of [...workerSpriteState.taskWorkers, ...workerSpriteState.brainWorkers]) {
    const normalized = normalizeBusyEntry(worker);
    if (!normalized) {
      continue;
    }
    const key = normalized.taskId ? `task:${normalized.taskId}` : normalized.id;
    byKey.set(key, {
      ...byKey.get(key),
      ...normalized
    });
  }
  workerSpriteState.workers = [...byKey.values()]
    .sort((left, right) => Number(left.startedAt || 0) - Number(right.startedAt || 0))
    .slice(0, MAX_VISIBLE_WORKERS);
  if (workerSpriteState.addon) {
    workerSpriteState.addon.sync(workerSpriteState.workers);
  }
  renderPanel();
}

function createTaskTexture(worker) {
  const canvas = document.createElement("canvas");
  canvas.width = 560;
  canvas.height = 190;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const palette = accentPaletteForKey(worker.accentKey || worker.id);
  const accent = hexToCss(palette.primary);
  const focusText = compactText(worker.projectWorkFocus || worker.description || "Working", 96);
  const projectText = compactText(worker.projectName || "", 38);
  const roleText = compactText(worker.projectWorkRoleName || "", 30);
  const statusText = compactText(String(worker.status || "in progress").replaceAll("_", " "), 18);
  const headerBits = [
    worker.label || "Task",
    worker.brainLabel || "worker",
    statusText
  ].filter(Boolean);
  const detailBits = [
    projectText ? `Project: ${projectText}` : "",
    roleText ? `Role: ${roleText}` : ""
  ].filter(Boolean);
  ctx.fillStyle = "rgba(27, 23, 20, 0.86)";
  roundRect(ctx, 18, 20, 524, 138, 28);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(70, 89, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.ink;
  ctx.font = "800 32px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(worker.isRepair ? "!" : "A", 70, 89);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255, 249, 240, 0.66)";
  ctx.font = "700 17px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(headerBits.join(" | "), 54), 112, 56);
  ctx.fillStyle = "#fff9f0";
  ctx.font = "800 23px ManropeLocal, Segoe UI, sans-serif";
  const focusLines = wrapCanvasText(ctx, focusText, 398, 2);
  focusLines.forEach((line, index) => {
    ctx.fillText(line, 112, 86 + index * 27);
  });
  ctx.fillStyle = "rgba(255, 249, 240, 0.78)";
  ctx.font = "700 16px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(detailBits.join(" | ") || "Project work", 58), 112, 142);
  if (worker.isRepair) {
    ctx.strokeStyle = "rgba(255, 246, 233, 0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(458, 22);
    ctx.lineTo(432, 58);
    ctx.lineTo(468, 92);
    ctx.lineTo(440, 156);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapCanvasText(ctx, value = "", maxWidth = 320, maxLines = 2) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) {
      break;
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  const lastIndex = lines.length - 1;
  if (lastIndex >= 0 && words.join(" ").length > lines.join(" ").length) {
    lines[lastIndex] = compactText(lines[lastIndex], Math.max(8, lines[lastIndex].length - 1));
  }
  return lines.length ? lines : ["Working"];
}

function disposeObject(object) {
  object.traverse?.((node) => {
    node.geometry?.dispose?.();
    const material = node.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        entry.map?.dispose?.();
        entry.dispose?.();
      });
    } else {
      material?.map?.dispose?.();
      material?.dispose?.();
    }
  });
}

function disposeGroupChildren(group) {
  if (!(group instanceof THREE.Group)) {
    return;
  }
  while (group.children.length) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    disposeObject(child);
  }
}

function updateSpriteTexture(sprite, texture) {
  if (!sprite?.material) {
    return;
  }
  const previous = sprite.material.map;
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
  if (previous && previous !== texture) {
    previous.dispose?.();
  }
}

function createWorkerGroup(worker) {
  const group = new THREE.Group();
  group.userData.workerId = worker.id;
  group.userData.seed = hashText(worker.id) / 997;
  group.userData.worker = { ...worker };

  const accent = accentPaletteForKey(worker.accentKey || worker.id).primary;
  const taskCard = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createTaskTexture(worker),
    transparent: true,
    depthWrite: false
  }));
  taskCard.position.set(0, 0, 0);
  taskCard.scale.set(1.14, 0.39, 1);
  group.add(taskCard);
  group.userData.taskCard = taskCard;

  const taskGlow = new THREE.PointLight(accent, 0.18, 2.6);
  taskGlow.position.set(0, 0.02, 0);
  group.add(taskGlow);
  group.userData.taskGlow = taskGlow;

  const workerOrbit = new THREE.Group();
  workerOrbit.userData.seed = group.userData.seed;
  group.userData.workerOrbit = workerOrbit;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 18, 14),
    new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.64,
      roughness: 0.4,
      metalness: 0.08
    })
  );
  core.position.set(0, 0, 0.02);
  workerOrbit.add(core);

  const wingMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff6f0,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const wingGeometry = new THREE.CircleGeometry(0.095, 24);
  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.scale.set(0.72, 1.16, 1);
  leftWing.position.set(-0.084, 0.034, -0.018);
  leftWing.rotation.set(0.2, 0.46, -0.42);
  const rightWing = leftWing.clone();
  rightWing.position.x = 0.084;
  rightWing.rotation.set(0.2, -0.46, 0.42);
  workerOrbit.add(leftWing, rightWing);

  const glow = new THREE.PointLight(accent, 0.32, 2.4);
  glow.position.set(0, 0.02, 0);
  workerOrbit.add(glow);
  group.userData.workerGlow = glow;
  group.add(workerOrbit);
  return group;
}

function applyWorkerToGroup(group, worker) {
  if (!group?.userData) {
    return;
  }
  const palette = accentPaletteForKey(worker.accentKey || worker.id);
  group.userData.worker = { ...worker };
  if (group.userData.taskCard) {
    updateSpriteTexture(group.userData.taskCard, createTaskTexture(worker));
  }
  if (group.userData.taskGlow) {
    group.userData.taskGlow.color.setHex(palette.primary);
  }
  if (group.userData.workerGlow) {
    group.userData.workerGlow.color.setHex(palette.primary);
  }
}

function createThoughtTexture(label = "?") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 250, 244, 0.92)";
  ctx.strokeStyle = "rgba(58, 47, 39, 0.42)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(128, 122, 78, 56, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(74, 178, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48, 212, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3a2f27";
  ctx.font = "800 96px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 130, 120);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createPluginLoadTexture(label = "...") {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 248, 235, 0.92)";
  ctx.strokeStyle = "rgba(133, 102, 59, 0.48)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(160, 160, 94, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8a6c2e";
  ctx.font = "800 84px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 160, 154);
  ctx.fillStyle = "rgba(58, 47, 39, 0.78)";
  ctx.font = "700 24px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText("Plugins", 160, 220);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createThoughtBubbleGroup() {
  const group = new THREE.Group();
  group.name = "worker-thought-bubble";
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createThoughtTexture("?"),
    transparent: true,
    opacity: 0.96,
    depthWrite: false
  }));
  bubble.scale.set(0.84, 0.84, 1);
  bubble.position.set(0, 0, 0);
  group.add(bubble);

  const glow = new THREE.PointLight(0xfff0c2, 0.4, 2.2);
  glow.position.set(0, 0.04, 0.02);
  group.add(glow);
  group.visible = false;
  return group;
}

function createPluginLoadGroup() {
  const group = new THREE.Group();
  group.name = "plugin-load-sigil";
  const sigil = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createPluginLoadTexture("..."),
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  }));
  sigil.scale.set(0.92, 0.92, 1);
  group.add(sigil);
  const glow = new THREE.PointLight(0xf6d78f, 0.42, 2.8);
  glow.position.set(0, 0.05, 0.06);
  group.add(glow);
  group.visible = false;
  return group;
}

function createWaitingTexture(entry = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 540;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  const palette = accentPaletteForKey(entry.accentKey || entry.id || "waiting");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 249, 240, 0.92)";
  roundRect(ctx, 18, 30, 504, 144, 34);
  ctx.fill();
  ctx.strokeStyle = hexToCss(palette.primary);
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = hexToCss(palette.primary);
  ctx.beginPath();
  ctx.arc(78, 102, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette.ink;
  ctx.font = "800 34px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("II", 78, 102);
  ctx.textAlign = "left";
  ctx.fillStyle = "#2e241d";
  ctx.font = "700 28px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(entry.description || "Waiting for your direction.", 46), 128, 90);
  ctx.fillStyle = "rgba(46, 36, 29, 0.72)";
  ctx.font = "600 18px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(entry.label || "Question", 46), 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createRingSpriteTexture(color = "#8ad4ff") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(128, 128, 84, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createQueueSlipTexture(color = "#f8d8a1") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,249,240,0.92)";
  roundRect(ctx, 18, 14, 92, 132, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "rgba(48,38,31,0.55)";
  ctx.fillRect(34, 44, 58, 6);
  ctx.fillRect(34, 62, 42, 6);
  ctx.fillRect(34, 80, 50, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createRequestCapsuleTexture(entry = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 168;
  const ctx = canvas.getContext("2d");
  const source = String(entry.source || "").trim().toLowerCase();
  const palette = accentPaletteForKey(entry.taskRef || entry.message || "queued-request");
  const accent = source === "voice" ? "#86efac" : hexToCss(palette.primary);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(20, 24, 500, 142);
  gradient.addColorStop(0, "rgba(24, 31, 36, 0.9)");
  gradient.addColorStop(1, "rgba(49, 39, 29, 0.88)");
  ctx.fillStyle = gradient;
  roundRect(ctx, 18, 22, 484, 114, 34);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(72, 78, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#17201c";
  ctx.font = "800 31px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(source === "voice" ? "V" : "Q", 72, 78);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255, 249, 240, 0.68)";
  ctx.font = "700 16px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(source === "voice" ? "Voice request queued" : "Request queued", 116, 55);
  ctx.fillStyle = "#fff9f0";
  ctx.font = "800 25px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(entry.taskRef || "Task queued", 34), 116, 86);
  ctx.fillStyle = "rgba(255, 249, 240, 0.74)";
  ctx.font = "700 16px ManropeLocal, Segoe UI, sans-serif";
  ctx.fillText(compactText(entry.message || "Worker queue handoff", 48), 116, 114);
  ctx.strokeStyle = "rgba(255, 249, 240, 0.38)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(414, 62);
  ctx.lineTo(456, 78);
  ctx.lineTo(414, 94);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createHandoffRailTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(54, 80, 586, 80);
  gradient.addColorStop(0, "rgba(134, 239, 172, 0)");
  gradient.addColorStop(0.18, "rgba(134, 239, 172, 0.52)");
  gradient.addColorStop(0.62, "rgba(125, 211, 252, 0.62)");
  gradient.addColorStop(1, "rgba(253, 230, 138, 0)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(58, 92);
  ctx.bezierCurveTo(178, 24, 350, 138, 584, 62);
  ctx.stroke();
  ctx.setLineDash([18, 18]);
  ctx.strokeStyle = "rgba(255, 249, 240, 0.36)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(72, 91);
  ctx.bezierCurveTo(196, 42, 360, 126, 564, 68);
  ctx.stroke();
  ctx.setLineDash([]);
  ["heard", "queued", "worker"].forEach((label, index) => {
    const x = 92 + index * 224;
    ctx.fillStyle = index === 0 ? "rgba(134, 239, 172, 0.92)" : index === 1 ? "rgba(125, 211, 252, 0.92)" : "rgba(253, 230, 138, 0.92)";
    ctx.beginPath();
    ctx.arc(x, index === 1 ? 78 : 86, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(34, 29, 24, 0.82)";
    ctx.font = "800 18px ManropeLocal, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x, index === 1 ? 78 : 86);
    ctx.fillStyle = "rgba(255, 249, 240, 0.74)";
    ctx.font = "700 15px ManropeLocal, Segoe UI, sans-serif";
    ctx.fillText(label, x, 124);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createCronTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,244,214,0.92)";
  ctx.beginPath();
  ctx.arc(80, 80, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(138,108,46,0.85)";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(80, 80);
  ctx.lineTo(80, 52);
  ctx.moveTo(80, 80);
  ctx.lineTo(104, 88);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createInterruptTexture(label = "!") {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 120;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,249,240,0.94)";
  roundRect(ctx, 16, 18, 188, 76, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(125,211,252,0.8)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#2f241f";
  ctx.font = "800 30px ManropeLocal, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 110, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createOverlayAddon() {
  const addon = {
    group: new THREE.Group(),
    thoughtBubble: createThoughtBubbleGroup(),
    pluginLoadBubble: createPluginLoadGroup(),
    waitingGroup: new THREE.Group(),
    queuePressureGroup: new THREE.Group(),
    requestCapsuleGroup: new THREE.Group(),
    cronGroup: new THREE.Group(),
    interruptGroup: new THREE.Group(),
    voiceHalo: null,
    completionBursts: [],
    sprites: new Map(),
    center: new THREE.Vector3(-0.6, 2.1, -0.55),
    elapsed: 0,
    scene: null,
    camera: null,
    canvas: null,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    hoveringWaiting: false,
    handlePointerMove: null,
    handlePointerDown: null,
    init({ scene, model, camera, canvas }) {
      this.scene = scene;
      this.camera = camera;
      this.canvas = canvas;
      this.group.name = "worker-sprites-overlay";
      scene.add(this.group);
      this.group.add(this.thoughtBubble);
      this.group.add(this.pluginLoadBubble);
      this.group.add(this.waitingGroup);
      this.group.add(this.queuePressureGroup);
      this.group.add(this.requestCapsuleGroup);
      this.group.add(this.cronGroup);
      this.group.add(this.interruptGroup);
      this.voiceHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: createRingSpriteTexture("#8ad4ff"),
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      }));
      this.voiceHalo.visible = false;
      this.group.add(this.voiceHalo);
      this.onAvatarChanged({ model });
      this.sync(workerSpriteState.workers);
      this.syncWaiting();
      this.syncQueuePressure();
      this.syncRequestCapsules();
      this.syncCron();
      this.syncInterrupts();
      this.handlePointerMove = (event) => {
        const hovering = this.hitTestWaiting(event).length > 0;
        if (hovering === this.hoveringWaiting) {
          return;
        }
        this.hoveringWaiting = hovering;
        if (this.canvas) {
          this.canvas.style.cursor = hovering ? "pointer" : "";
        }
      };
      this.handlePointerDown = (event) => {
        if (!this.hitTestWaiting(event).length) {
          return;
        }
        event.preventDefault();
        event.stopPropagation?.();
        startQuestionTimeFromSprite();
      };
      this.canvas?.addEventListener("pointermove", this.handlePointerMove);
      this.canvas?.addEventListener("pointerdown", this.handlePointerDown);
    },
    onAvatarChanged({ model }) {
      if (!model) {
        return;
      }
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      this.center.set(center.x + 0.2, Math.max(1.55, box.min.y + size.y * 0.72), center.z + 0.1);
    },
    sync(workers = []) {
      const normalizedWorkers = workers.map(normalizeBusyTask).filter(Boolean).slice(0, MAX_VISIBLE_WORKERS);
      const activeIds = new Set(normalizedWorkers.map((worker) => worker.id));
      for (const [workerId, group] of this.sprites) {
        if (!activeIds.has(workerId)) {
          this.group.remove(group);
          disposeObject(group);
          this.sprites.delete(workerId);
        }
      }
      normalizedWorkers.forEach((worker) => {
        if (this.sprites.has(worker.id)) {
          applyWorkerToGroup(this.sprites.get(worker.id), worker);
          return;
        }
        const group = createWorkerGroup(worker);
        this.sprites.set(worker.id, group);
        this.group.add(group);
      });
      this.group.visible = normalizedWorkers.length > 0;
      this.updateThoughtBubble();
      renderPanel();
    },
    syncWaiting() {
      disposeGroupChildren(this.waitingGroup);
      const waiting = workerSpriteState.waitingTasks.slice(0, 1);
      waiting.forEach((entry) => {
        const card = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createWaitingTexture(entry),
          transparent: true,
          depthWrite: false
        }));
        card.scale.set(1.18, 0.48, 1);
        this.waitingGroup.add(card);
        const ring = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createRingSpriteTexture(hexToCss(accentPaletteForKey(entry.accentKey || entry.id).primary)),
          transparent: true,
          opacity: 0.24,
          depthWrite: false
        }));
        ring.scale.set(0.9, 0.9, 1);
        ring.position.set(0, 0, -0.01);
        this.waitingGroup.add(ring);
      });
    },
    hitTestWaiting(event) {
      if (!this.canvas || !this.camera || !this.waitingGroup.children.length) {
        return [];
      }
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return [];
      }
      const clientX = Number(event?.clientX || 0);
      const clientY = Number(event?.clientY || 0);
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      return this.raycaster.intersectObjects(this.waitingGroup.children, true);
    },
    syncQueuePressure() {
      disposeGroupChildren(this.queuePressureGroup);
      const count = Math.max(0, Math.min(Number(workerSpriteState.queuePressure?.queuedCount || 0), 8));
      for (let index = 0; index < count; index += 1) {
        const slip = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createQueueSlipTexture("#f3c971"),
          transparent: true,
          opacity: 0.82,
          depthWrite: false
        }));
        slip.userData.index = index;
        slip.scale.set(0.24, 0.3, 1);
        this.queuePressureGroup.add(slip);
      }
    },
    syncRequestCapsules() {
      disposeGroupChildren(this.requestCapsuleGroup);
      const activeCapsules = workerSpriteState.requestCapsules
        .filter((entry) => Number(entry.expiresAt || 0) > Date.now())
        .slice(0, 4);
      if (activeCapsules.length) {
        const rail = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createHandoffRailTexture(),
          transparent: true,
          opacity: 0.82,
          depthWrite: false
        }));
        rail.userData.kind = "handoff-rail";
        rail.scale.set(1.72, 0.42, 1);
        this.requestCapsuleGroup.add(rail);
      }
      activeCapsules.forEach((entry, index) => {
        const capsule = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createRequestCapsuleTexture(entry),
          transparent: true,
          opacity: 0.96,
          depthWrite: false
        }));
        capsule.userData = {
          kind: "request-capsule",
          ...entry,
          index
        };
        capsule.scale.set(0.92, 0.3, 1);
        this.requestCapsuleGroup.add(capsule);
      });
    },
    syncCron() {
      disposeGroupChildren(this.cronGroup);
      const jobs = (workerSpriteState.cronState?.jobs || []).filter((job) => job?.enabled !== false).slice(0, 4);
      jobs.forEach((job, index) => {
        const glyph = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createCronTexture(),
          transparent: true,
          opacity: 0.88,
          depthWrite: false
        }));
        glyph.userData.index = index;
        glyph.scale.set(0.24, 0.24, 1);
        this.cronGroup.add(glyph);
      });
    },
    syncInterrupts() {
      disposeGroupChildren(this.interruptGroup);
      const activeInterrupts = workerSpriteState.interrupts.filter((entry) => Number(entry.expiresAt || 0) > Date.now()).slice(0, 3);
      activeInterrupts.forEach((entry, index) => {
        const badge = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createInterruptTexture(entry.label || "!"),
          transparent: true,
          opacity: 0.95,
          depthWrite: false
        }));
        badge.userData.index = index;
        badge.scale.set(0.34, 0.18, 1);
        this.interruptGroup.add(badge);
      });
    },
    updateThoughtBubble() {
      const thought = workerSpriteState.thought;
      const active = thought && Number(thought.expiresAt || 0) > Date.now();
      this.thoughtBubble.visible = Boolean(active);
      const pluginLoad = workerSpriteState.pluginLoad;
      const pluginActive = pluginLoad && Number(pluginLoad.expiresAt || 0) > Date.now();
      this.pluginLoadBubble.visible = Boolean(pluginActive);
      const hasWaiting = workerSpriteState.waitingTasks.length > 0;
      const hasQueuePressure = Number(workerSpriteState.queuePressure?.queuedCount || 0) > 0;
      const hasCron = (workerSpriteState.cronState?.jobs || []).some((job) => job?.enabled !== false);
      const hasInterrupt = workerSpriteState.interrupts.some((entry) => Number(entry.expiresAt || 0) > Date.now());
      const hasRequestCapsules = workerSpriteState.requestCapsules.some((entry) => Number(entry.expiresAt || 0) > Date.now());
      this.group.visible = this.sprites.size > 0 || Boolean(active) || Boolean(pluginActive) || hasWaiting || hasQueuePressure || hasRequestCapsules || hasCron || hasInterrupt || workerSpriteState.voiceState?.mode !== "off";
    },
    update(delta) {
      this.elapsed += Math.min(0.08, Math.max(0, Number(delta || 0)));
      this.updateThoughtBubble();
      const groups = [...this.sprites.values()];
      const count = Math.max(1, groups.length);
      groups.forEach((group, index) => {
        const seed = Number(group.userData.seed || 0);
        const angle = this.elapsed * (0.34 + (index % 3) * 0.045) + index * ((Math.PI * 2) / count) + seed;
        const radius = 1.36 + (index % 2) * 0.28;
        const bob = Math.sin(this.elapsed * 2.1 + seed) * 0.13;
        group.position.set(
          this.center.x + Math.cos(angle) * radius,
          this.center.y + bob + Math.sin(angle * 0.7) * 0.08,
          this.center.z + Math.sin(angle) * 0.34
        );
        group.rotation.y = Math.sin(this.elapsed * 0.8 + seed) * 0.08;
        const pulse = 1 + Math.sin(this.elapsed * 4.2 + seed) * 0.035;
        group.scale.setScalar(pulse);
        const workerOrbit = group.userData.workerOrbit;
        if (workerOrbit) {
          const workerAngle = -this.elapsed * (1.08 + (index % 2) * 0.14) + seed;
          workerOrbit.position.set(
            Math.cos(workerAngle) * 0.82,
            0.05 + Math.sin(workerAngle * 1.4) * 0.18,
            Math.sin(workerAngle) * 0.08 + 0.04
          );
          workerOrbit.rotation.z = Math.sin(this.elapsed * 6 + seed) * 0.12;
          workerOrbit.scale.setScalar(1 + Math.sin(this.elapsed * 5.8 + seed) * 0.08);
        }
      });
      this.waitingGroup.children.forEach((child, index) => {
        child.position.set(
          this.center.x - 0.2,
          this.center.y + 0.92 + Math.sin(this.elapsed * 1.8) * 0.06,
          this.center.z + 0.32 + index * -0.01
        );
        if (index === 1) {
          child.scale.setScalar(1 + Math.sin(this.elapsed * 3.2) * 0.06);
        }
      });
      this.queuePressureGroup.children.forEach((child, index) => {
        const offset = index * 0.16;
        child.position.set(
          this.center.x - 1.15 - (index % 2) * 0.14,
          0.76 + offset * 0.1 + Math.sin(this.elapsed * 1.6 + index) * 0.05,
          this.center.z + 0.18 + (index * 0.03)
        );
        child.rotation.z = Math.sin(this.elapsed * 1.2 + index) * 0.12;
      });
      const activeRequestCapsules = workerSpriteState.requestCapsules.filter((entry) => Number(entry.expiresAt || 0) > Date.now());
      const visibleCapsules = this.requestCapsuleGroup.children.filter((child) => child.userData?.kind === "request-capsule");
      if (activeRequestCapsules.length !== visibleCapsules.length) {
        this.syncRequestCapsules();
      }
      this.requestCapsuleGroup.children
        .filter((child) => child.userData?.kind === "handoff-rail")
        .forEach((child) => {
          child.position.set(
            this.center.x - 0.16,
            this.center.y + 0.62 + Math.sin(this.elapsed * 1.9) * 0.025,
            this.center.z + 0.16
          );
          child.rotation.z = Math.sin(this.elapsed * 0.8) * 0.035;
          child.material.opacity = 0.48 + Math.sin(this.elapsed * 2.6) * 0.08;
        });
      this.requestCapsuleGroup.children.filter((child) => child.userData?.kind === "request-capsule").forEach((child, index) => {
        const bornAt = Number(child.userData.bornAt || Date.now());
        const duration = Math.max(1000, Number(child.userData.expiresAt || 0) - bornAt);
        const progress = Math.max(0, Math.min(1, (Date.now() - bornAt) / duration));
        const ease = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const startX = this.center.x + 0.86;
        const endX = this.center.x - 1.16;
        child.position.set(
          startX + (endX - startX) * ease,
          this.center.y + 0.54 + index * 0.2 + Math.sin(this.elapsed * 3 + index) * 0.045,
          this.center.z + 0.28 - ease * 0.08
        );
        child.rotation.z = -0.08 + ease * 0.2;
        child.material.opacity = progress > 0.74 ? Math.max(0, (1 - progress) / 0.26) : 0.96;
        child.scale.setScalar(0.92 + Math.sin(this.elapsed * 5 + index) * 0.025);
      });
      this.cronGroup.children.forEach((child, index) => {
        const angle = this.elapsed * 0.28 + index * ((Math.PI * 2) / Math.max(1, this.cronGroup.children.length));
        child.position.set(
          this.center.x + Math.cos(angle) * 0.46,
          this.center.y + 1.22 + Math.sin(angle * 1.6) * 0.12,
          this.center.z - 0.22 + Math.sin(angle) * 0.06
        );
        child.rotation.z = -angle;
      });
      const interrupts = workerSpriteState.interrupts.filter((entry) => Number(entry.expiresAt || 0) > Date.now());
      if (interrupts.length !== this.interruptGroup.children.length) {
        this.syncInterrupts();
      }
      this.interruptGroup.children.forEach((child, index) => {
        child.position.set(
          this.center.x + 1.1,
          this.center.y + 1.12 - index * 0.22 + Math.sin(this.elapsed * 2 + index) * 0.03,
          this.center.z + 0.06
        );
      });
      if (this.voiceHalo) {
        const mode = String(workerSpriteState.voiceState?.mode || "off").trim();
        const colors = {
          passive: "#8ad4ff",
          listening: "#86efac",
          question_waiting: "#fde68a",
          unavailable: "#f9a8d4",
          off: "#8ad4ff"
        };
        const color = colors[mode] || "#8ad4ff";
        if (this.voiceHalo.userData.color !== color) {
          updateSpriteTexture(this.voiceHalo, createRingSpriteTexture(color));
          this.voiceHalo.userData.color = color;
        }
        this.voiceHalo.visible = mode !== "off" && mode !== "";
        this.voiceHalo.position.set(this.center.x, 1.1, this.center.z + 0.02);
        const size = mode === "listening" ? 2.6 : mode === "question_waiting" ? 2.45 : 2.3;
        this.voiceHalo.scale.set(size, size, 1);
        this.voiceHalo.material.opacity = mode === "listening"
          ? 0.34 + Math.sin(this.elapsed * 4.8) * 0.06
          : mode === "passive"
            ? 0.14 + Math.sin(this.elapsed * 2.4) * 0.03
          : 0.24;
      }
      const activeBursts = [];
      this.completionBursts.forEach((burst) => {
        if (Number(burst.expiresAt || 0) <= Date.now()) {
          burst.points.forEach((point) => {
            this.group.remove(point);
            disposeObject(point);
          });
          return;
        }
        activeBursts.push(burst);
      });
      this.completionBursts = activeBursts;
      this.completionBursts.forEach((burst) => {
        burst.points.forEach((point, index) => {
          const life = Math.max(0, Math.min(1, (burst.expiresAt - Date.now()) / burst.durationMs));
          point.position.set(
            burst.origin.x + Math.cos(index * 0.9 + this.elapsed * 4) * (1 - life) * 0.48,
            burst.origin.y + Math.sin(index * 1.3 + this.elapsed * 3.2) * (1 - life) * 0.28,
            burst.origin.z + Math.sin(index + this.elapsed * 2.6) * (1 - life) * 0.18
          );
          point.material.opacity = life;
        });
      });
      if (this.thoughtBubble.visible) {
        const bob = Math.sin(this.elapsed * 2.4) * 0.08;
        this.thoughtBubble.position.set(
          this.center.x + 0.1,
          this.center.y + 0.78 + bob,
          this.center.z + 0.08
        );
        this.thoughtBubble.scale.setScalar(1 + Math.sin(this.elapsed * 3.8) * 0.04);
      }
      if (this.pluginLoadBubble.visible) {
        const spin = this.elapsed * 0.9;
        this.pluginLoadBubble.position.set(
          this.center.x - 0.18,
          this.center.y + 0.98 + Math.sin(this.elapsed * 1.8) * 0.06,
          this.center.z - 0.02
        );
        this.pluginLoadBubble.rotation.z = spin * 0.45;
        this.pluginLoadBubble.scale.setScalar(1 + Math.sin(this.elapsed * 2.8) * 0.03);
      }
    },
    burstAt(origin = new THREE.Vector3(), color = 0xfde68a) {
      const points = [];
      const durationMs = 2200;
      for (let index = 0; index < 6; index += 1) {
        const point = new THREE.Sprite(new THREE.SpriteMaterial({
          map: createRingSpriteTexture(hexToCss(color)),
          transparent: true,
          opacity: 0.65,
          depthWrite: false
        }));
        point.scale.set(0.12, 0.12, 1);
        this.group.add(point);
        points.push(point);
      }
      this.completionBursts.push({
        origin: origin.clone(),
        expiresAt: Date.now() + durationMs,
        durationMs,
        points
      });
    },
    dispose() {
      if (this.canvas) {
        this.canvas.removeEventListener("pointermove", this.handlePointerMove);
        this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
        if (this.hoveringWaiting) {
          this.canvas.style.cursor = "";
        }
      }
      if (this.scene) {
        this.scene.remove(this.group);
      }
      this.completionBursts.forEach((burst) => {
        burst.points.forEach((point) => {
          this.group.remove(point);
          disposeObject(point);
        });
      });
      disposeObject(this.group);
      this.sprites.clear();
    }
  };
  return addon;
}

function ensureOverlayRegistered() {
  if (!window.agentAvatar || typeof window.agentAvatar.registerSceneAddon !== "function") {
    window.setTimeout(ensureOverlayRegistered, 250);
    return;
  }
  if (!workerSpriteState.addon) {
    workerSpriteState.addon = createOverlayAddon();
    workerSpriteState.cleanup = window.agentAvatar.registerSceneAddon(workerSpriteState.addon);
  }
  workerSpriteState.addon.sync(workerSpriteState.workers);
}

function setWorkers(workers = []) {
  workerSpriteState.taskWorkers = workers.map(normalizeBusyTask).filter(Boolean);
  mergeWorkers();
}

function setBrainWorkers(entries = []) {
  workerSpriteState.brainWorkers = entries.map(normalizeBusyBrain).filter(Boolean);
  mergeWorkers();
}

function setThoughtBubble(detail = {}) {
  const phase = String(detail?.phase || "started").trim().toLowerCase();
  const now = Date.now();
  if (phase === "started") {
    workerSpriteState.thought = {
      phase,
      brainLabel: compactText(detail.brainLabel || "Worker", 28),
      message: compactText(detail.message || "Direct worker handoff", 80),
      expiresAt: now + 18000
    };
  } else if (workerSpriteState.thought) {
    workerSpriteState.thought = {
      ...workerSpriteState.thought,
      phase,
      expiresAt: now + 2600
    };
  }
  if (workerSpriteState.addon) {
    workerSpriteState.addon.updateThoughtBubble();
  }
  renderPanel();
}

function setPluginLoadState(detail = {}) {
  const phase = String(detail?.phase || "started").trim().toLowerCase();
  const now = Date.now();
  if (phase === "started") {
    workerSpriteState.pluginLoad = {
      phase,
      message: "Loading plugins",
      expiresAt: now + 120000
    };
  } else if (phase === "completed") {
    workerSpriteState.pluginLoad = {
      phase,
      message: `${Number(detail?.pluginCount || 0)} plugins ready`,
      expiresAt: now + 2600
    };
  } else if (phase === "failed") {
    workerSpriteState.pluginLoad = {
      phase,
      message: "Plugin load failed",
      expiresAt: now + 6000
    };
  }
  if (workerSpriteState.addon) {
    workerSpriteState.addon.updateThoughtBubble();
  }
  renderPanel();
}

function setWaitingTasks(tasks = []) {
  workerSpriteState.waitingTasks = tasks.map(normalizeWaitingTask).filter(Boolean).slice(0, 2);
  workerSpriteState.addon?.syncWaiting();
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function setQueuePressure(detail = {}) {
  const queuedCount = Math.max(0, Number(detail?.queuedCount || 0));
  workerSpriteState.queuePressure = {
    queuedCount,
    activeRepairCount: Math.max(0, Number(detail?.activeRepairCount || 0)),
    failedCount: Math.max(0, Number(detail?.failedCount || 0)),
    at: Date.now()
  };
  workerSpriteState.addon?.syncQueuePressure();
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function setVoiceState(detail = {}) {
  workerSpriteState.voiceState = {
    mode: String(detail?.mode || "off").trim() || "off",
    listeningEnabled: detail?.listeningEnabled === true,
    wakeActive: detail?.wakeActive === true,
    questionWaiting: detail?.questionWaiting === true,
    at: Number(detail?.at || 0) || Date.now()
  };
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function setCronState(detail = {}) {
  workerSpriteState.cronState = {
    jobs: Array.isArray(detail?.jobs) ? detail.jobs : [],
    error: String(detail?.error || "").trim(),
    at: Number(detail?.at || 0) || Date.now()
  };
  workerSpriteState.addon?.syncCron();
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function pushInterrupt(detail = {}) {
  const label = compactText(String(detail?.label || detail?.shortLabel || "!").trim(), 10);
  const message = compactText(String(detail?.message || detail?.type || "Interrupt").trim(), 64);
  workerSpriteState.interrupts = [
    {
      label: label || "!",
      message,
      type: String(detail?.type || "event").trim(),
      expiresAt: Date.now() + Math.max(3000, Math.min(Number(detail?.durationMs || 7000), 15000))
    },
    ...workerSpriteState.interrupts.filter((entry) => Number(entry.expiresAt || 0) > Date.now())
  ].slice(0, 6);
  workerSpriteState.addon?.syncInterrupts();
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function pushRequestCapsule(detail = {}) {
  const taskRefs = Array.isArray(detail?.taskRefs)
    ? detail.taskRefs.map((value) => compactText(String(value || "").trim(), 36)).filter(Boolean)
    : [];
  const taskRef = taskRefs[0] || compactText(String(detail?.taskRef || "queued task").trim(), 36);
  const now = Date.now();
  workerSpriteState.requestCapsules = [
    {
      id: `request-${now}-${hashText(`${taskRef}|${detail?.message || ""}`)}`,
      taskRef,
      taskRefs,
      destinationLabel: compactText(String(detail?.destinationLabel || "worker").trim(), 26),
      message: compactText(String(detail?.message || "Queued request").trim(), 72),
      source: String(detail?.source || "intake").trim(),
      bornAt: now,
      expiresAt: now + 7000
    },
    ...workerSpriteState.requestCapsules.filter((entry) =>
      Number(entry.expiresAt || 0) > now
      && String(entry.taskRef || "") !== taskRef
    )
  ].slice(0, 6);
  workerSpriteState.addon?.syncRequestCapsules();
  workerSpriteState.addon?.updateThoughtBubble();
  renderPanel();
}

function startQuestionTimeFromSprite() {
  if (typeof window.ObserverApp?.replayWaitingQuestionThroughAvatar === "function") {
    return window.ObserverApp.replayWaitingQuestionThroughAvatar();
  }
  const questionTimeButton = document.getElementById("questionTimeBtn");
  questionTimeButton?.click?.();
  return Boolean(questionTimeButton);
}

function triggerCompletionBurst(task = {}, phase = "completed") {
  const addon = workerSpriteState.addon;
  if (!addon) {
    return;
  }
  const source = normalizeBusyTask(task);
  const workerIndex = Math.max(0, workerSpriteState.workers.findIndex((entry) => entry.id === source?.id));
  const origin = addon.center.clone().add(new THREE.Vector3(
    0.45 + (workerIndex % 3) * 0.18,
    0.2 + (workerIndex % 2) * 0.12,
    0.04
  ));
  const color = phase === "recovered"
    ? 0x86efac
    : phase === "escalated"
      ? 0xf9a8d4
      : 0xfde68a;
  addon.burstAt(origin, color);
}

function labelForObserverEvent(data = {}) {
  const type = String(data?.type || "").trim().toLowerCase();
  if (type.includes("mail")) {
    return "Mail";
  }
  if (type.includes("command")) {
    return "Cmd";
  }
  if (type.includes("webhook")) {
    return "Hook";
  }
  if (type.includes("wordpress")) {
    return "WP";
  }
  if (type.includes("cron")) {
    return "Cron";
  }
  return "Evt";
}

function shouldSurfaceObserverEvent(data = {}) {
  const type = String(data?.type || "").trim().toLowerCase();
  if (!type) {
    return false;
  }
  return type.includes("mail")
    || type.includes("command")
    || type.includes("webhook")
    || type.includes("wordpress")
    || type.includes("cron");
}

function handleTaskSnapshot(event) {
  const inProgress = Array.isArray(event?.detail?.inProgress) ? event.detail.inProgress : [];
  const waiting = Array.isArray(event?.detail?.waiting) ? event.detail.waiting : [];
  const queued = Array.isArray(event?.detail?.queued) ? event.detail.queued : [];
  const failed = Array.isArray(event?.detail?.failed) ? event.detail.failed : [];
  const summary = event?.detail?.repairMonitor?.summary && typeof event.detail.repairMonitor.summary === "object"
    ? event.detail.repairMonitor.summary
    : {};
  setWorkers(inProgress.filter(isBusyWorkerTask));
  setWaitingTasks(waiting);
  setQueuePressure({
    queuedCount: queued.length,
    activeRepairCount: Math.max(
      0,
      Number(summary.activeFollowUpCount || 0) + Number(summary.activeReviewCount || 0)
    ),
    failedCount: failed.length
  });
}

function handleBrainActivity(event) {
  const activity = Array.isArray(event?.detail?.brainActivity) ? event.detail.brainActivity : [];
  setBrainWorkers(activity.filter(isBusyWorkerBrain));
}

function handleTaskEvent(event) {
  const data = event?.detail || {};
  const task = data.task && typeof data.task === "object" ? data.task : null;
  if (!task || !task.id) {
    return;
  }
  if (["task.completed", "task.recovered", "task.escalated"].includes(String(data.type || ""))) {
    triggerCompletionBurst(task, String(data.type || "").replace(/^task\./, ""));
  }
  const nextWorkers = workerSpriteState.taskWorkers.filter((worker) => worker.id !== task.id);
  if (isBusyWorkerTask(task)) {
    nextWorkers.push(task);
  }
  workerSpriteState.taskWorkers = nextWorkers.map(normalizeBusyTask).filter(Boolean);
  mergeWorkers();
}

function handleDirectWorkerHandoff(event) {
  setThoughtBubble(event?.detail || {});
}

function handlePluginLoadState(event) {
  setPluginLoadState(event?.detail || {});
}

function handleVoiceState(event) {
  setVoiceState(event?.detail || {});
}

function handleCronState(event) {
  setCronState(event?.detail || {});
}

function handleObserverEvent(event) {
  const data = event?.detail && typeof event.detail === "object" ? event.detail : {};
  const eventType = String(data?.type || "");
  if (eventType === "intake.request_queued" || eventType === "worker-sprites.request-queued") {
    pushRequestCapsule(data);
    return;
  }
  if (!shouldSurfaceObserverEvent(data)) {
    return;
  }
  pushInterrupt({
    type: data.type,
    label: labelForObserverEvent(data),
    message: compactText(
      String(data?.message || data?.subject || data?.title || data?.detail || data?.type || "Interrupt").trim(),
      64
    )
  });
}

async function refreshBusyWorkers() {
  try {
    const r = await fetch("/api/worker-sprites/status");
    const j = await r.json();
    if (!r.ok || !j.ok) {
      throw new Error(j.error || "busy worker status unavailable");
    }
    setWorkers(Array.isArray(j.workers) ? j.workers : []);
  } catch {
    renderPanel("Status unavailable.");
  }
}

function renderPanel(message = "") {
  const root = workerSpriteState.root;
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const workers = workerSpriteState.workers;
  const thought = workerSpriteState.thought && Number(workerSpriteState.thought.expiresAt || 0) > Date.now()
    ? workerSpriteState.thought
    : null;
  const pluginLoad = workerSpriteState.pluginLoad && Number(workerSpriteState.pluginLoad.expiresAt || 0) > Date.now()
    ? workerSpriteState.pluginLoad
    : null;
  const waitingTasks = workerSpriteState.waitingTasks.slice(0, 1);
  const queuePressure = workerSpriteState.queuePressure || { queuedCount: 0, activeRepairCount: 0 };
  const voiceState = workerSpriteState.voiceState || { mode: "off" };
  const cronJobs = Array.isArray(workerSpriteState.cronState?.jobs)
    ? workerSpriteState.cronState.jobs.filter((job) => job?.enabled !== false)
    : [];
  const requestCapsules = workerSpriteState.requestCapsules.filter((entry) => Number(entry.expiresAt || 0) > Date.now()).slice(0, 2);
  const interrupts = workerSpriteState.interrupts.filter((entry) => Number(entry.expiresAt || 0) > Date.now()).slice(0, 2);
  root.innerHTML = `
    <section class="brain-editor-card">
      <div class="panel-head compact">
        <div>
          <h3>Active Workers</h3>
          <div class="panel-subtle">${message || `${workers.length} active worker${workers.length === 1 ? "" : "s"}.`}</div>
        </div>
        <button type="button" class="secondary" data-worker-sprites-refresh>Refresh</button>
      </div>
      <div class="stack-list">
        ${thought
          ? `<div class="brain-row">
              <div class="brain-row-actions">
                <strong>Direct handoff</strong>
                <span class="brain-pill">${escapeHtml(thought.brainLabel)}</span>
              </div>
              <div class="micro">${escapeHtml(thought.message)}</div>
            </div>`
          : ""}
        ${pluginLoad
          ? `<div class="brain-row">
              <div class="brain-row-actions">
                <strong>Plugin startup</strong>
                <span class="brain-pill">${escapeHtml(pluginLoad.phase)}</span>
              </div>
              <div class="micro">${escapeHtml(pluginLoad.message)}</div>
            </div>`
          : ""}
        ${waitingTasks.map((task) => `
          <div class="brain-row">
            <div class="brain-row-actions">
              <strong>Waiting for you</strong>
              <span class="brain-pill">${escapeHtml(task.label)}</span>
            </div>
            <div class="micro">${escapeHtml(task.description)}</div>
          </div>
        `).join("")}
        ${Number(queuePressure.queuedCount || 0) > 0
          ? `<div class="brain-row">
              <div class="brain-row-actions">
                <strong>Queue pressure</strong>
                <span class="brain-pill">${escapeHtml(String(queuePressure.queuedCount))} queued</span>
              </div>
              <div class="micro">${escapeHtml(`${Number(queuePressure.activeRepairCount || 0)} repair active.`)}</div>
            </div>`
          : ""}
        ${requestCapsules.map((entry) => `
          <div class="brain-row">
            <div class="brain-row-actions">
              <strong>Request handoff</strong>
              <span class="brain-pill">${escapeHtml(entry.taskRef || "queued")}</span>
            </div>
            <div class="micro">${escapeHtml(`${entry.source === "voice" ? "Voice" : "Intake"} -> ${entry.destinationLabel || "worker"}: ${entry.message || "Queued request"}`)}</div>
          </div>
        `).join("")}
        ${voiceState.mode && voiceState.mode !== "off"
          ? `<div class="brain-row">
              <div class="brain-row-actions">
                <strong>Voice</strong>
                <span class="brain-pill">${escapeHtml(voiceState.mode)}</span>
              </div>
              <div class="micro">${escapeHtml(voiceState.questionWaiting ? "A voice question is waiting." : "Passive listening visuals are active.")}</div>
            </div>`
          : ""}
        ${cronJobs.length
          ? `<div class="brain-row">
              <div class="brain-row-actions">
                <strong>Scheduled work</strong>
                <span class="brain-pill">${escapeHtml(String(cronJobs.length))} active</span>
              </div>
              <div class="micro">${escapeHtml(compactText(String(cronJobs[0]?.name || cronJobs[0]?.message || "Scheduled jobs active"), 64))}</div>
            </div>`
          : ""}
        ${interrupts.map((entry) => `
          <div class="brain-row">
            <div class="brain-row-actions">
              <strong>Interrupt</strong>
              <span class="brain-pill">${escapeHtml(entry.label)}</span>
            </div>
            <div class="micro">${escapeHtml(entry.message || entry.type || "Incoming event")}</div>
          </div>
        `).join("")}
        ${workers.length
          ? workers.map((worker) => `
            <div class="brain-row">
              <div class="brain-row-actions">
                <strong>${escapeHtml(worker.label)}</strong>
                <span class="brain-pill">${escapeHtml(worker.brainLabel)}</span>
              </div>
              <div class="micro">${escapeHtml(worker.description)}</div>
            </div>
          `).join("")
          : `<div class="panel-subtle">No worker activity right now.</div>`}
      </div>
    </section>
  `;
  root.querySelector("[data-worker-sprites-refresh]")?.addEventListener("click", refreshBusyWorkers);
}

function startListeners() {
  if (workerSpriteState.listenersStarted) {
    return;
  }
  workerSpriteState.listenersStarted = true;
  window.addEventListener("observer:task-snapshot", handleTaskSnapshot);
  window.addEventListener("observer:task-event", handleTaskEvent);
  window.addEventListener("observer:brain-activity", handleBrainActivity);
  window.addEventListener("observer:intake-worker-handoff", handleDirectWorkerHandoff);
  window.addEventListener("observer:plugin-load-state", handlePluginLoadState);
  window.addEventListener("observer:voice-state", handleVoiceState);
  window.addEventListener("observer:cron-state", handleCronState);
  window.addEventListener("observer:event", handleObserverEvent);
  workerSpriteState.refreshTimer = window.setInterval(refreshBusyWorkers, 15000);
}

export async function mountPluginTab({ root, observerApp }) {
  workerSpriteState.root = root;
  startListeners();
  ensureOverlayRegistered();
  renderPanel();
  observerApp?.refreshStatus?.();
  observerApp?.loadTaskQueue?.();
  observerApp?.loadCronJobs?.();
  await refreshBusyWorkers();
}

export async function refreshPluginTab({ observerApp } = {}) {
  renderPanel();
  observerApp?.refreshStatus?.();
  observerApp?.loadTaskQueue?.();
  observerApp?.loadCronJobs?.();
  await refreshBusyWorkers();
}
