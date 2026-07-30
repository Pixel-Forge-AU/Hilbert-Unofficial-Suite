import * as THREE from "/vendor/three/build/three.module.js";
import { GLTFLoader } from "/vendor/three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "/vendor/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "/vendor/three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "/vendor/three/examples/jsm/postprocessing/ShaderPass.js";
import { OutlinePass } from "/vendor/three/examples/jsm/postprocessing/OutlinePass.js";
import { UnrealBloomPass } from "/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FilmPass } from "/vendor/three/examples/jsm/postprocessing/FilmPass.js";
import { RenderPixelatedPass } from "/vendor/three/examples/jsm/postprocessing/RenderPixelatedPass.js";
import { RGBShiftShader } from "/vendor/three/examples/jsm/shaders/RGBShiftShader.js";
import { VignetteShader } from "/vendor/three/examples/jsm/shaders/VignetteShader.js";

// This is the original monolith's public/avatar.js, unchanged except for two things
// required for it to talk to Genesis instead of Nova, marked "GENESIS:" at each site:
//   1. TAG_PATTERN: "nova:" -> "persona:" (the server's actual emitted tag prefix).
//   2. loadSavedAppAppearance(): fetches voice-avatar-plugin.js's /api/avatar/scene-config
//      instead of Nova's /api/app/config, and reshapes its field names into the same
//      appConfig shape reloadAppearance() already expects. Everything else — every
//      geometry value, color, light, preset number, and the whole speech-queue/tag/
//      public-API mechanism — is byte-identical to the source file.

// Names will not match, these were remapped due to incorrect naming in .glb
const DEFAULT_ANIMATION_CATALOG = [
  { emotion: "idle", clip: "Charged_Ground_Slam", label: "Idle" },
  { emotion: "calm", clip: "Cheer_with_Both_Hands_Up", label: "Calm idle" },
  { emotion: "agree", clip: "Talk_with_Left_Hand_Raised", label: "Agree" },
  { emotion: "angry", clip: "Head_Hold_in_Pain", label: "Angry stomp" },
  { emotion: "love", clip: "Agree_Gesture", label: "Big heart" },
  { emotion: "celebrate", clip: "Angry_Stomp", label: "Celebrate" },
  { emotion: "confused", clip: "Walking", label: "Confused" },
  { emotion: "dance", clip: "Idle_3", label: "Dance" },
  { emotion: "sass", clip: "Big_Heart_Gesture", label: "Hand on hip" },
  { emotion: "hurt", clip: "Scheming_Hand_Rub", label: "Hurt" },
  { emotion: "reflect", clip: "Idle_6", label: "Reflect" },
  { emotion: "run", clip: "Shrug", label: "Run" },
  { emotion: "scheme", clip: "Wave_One_Hand", label: "Scheme" },
  { emotion: "shrug", clip: "Confused_Scratch", label: "Shrug" },
  { emotion: "rant", clip: "Stand_Talking_Angry", label: "Angry talk" },
  { emotion: "passionate", clip: "Mirror_Viewing", label: "Passionate talk" },
  { emotion: "explain", clip: "FunnyDancing_01", label: "Explain" },
  { emotion: "walk", clip: "Hand_on_Hip_Gesture", label: "Walk" },
  { emotion: "wave", clip: "Talk_Passionately", label: "Wave" },
  { emotion: "slam", clip: "Running", label: "Ground slam" }
];

const DEFAULT_EMOTION_TO_CLIP = Object.fromEntries(
  DEFAULT_ANIMATION_CATALOG.map((entry) => [entry.emotion, entry.clip])
);
const DEFAULT_TALKING_CLIPS = [
  "Mirror_Viewing",
  "Talk_with_Left_Hand_Raised",
  "FunnyDancing_01"
];
const DEFAULT_IDLE_CLIP = DEFAULT_ANIMATION_CATALOG[0].clip;

// GENESIS: was /\[nova:(emotion|animation)=([^\]]+)\]/gi — renamed to match the server's
// actual annotateEmotion() output ("[persona:emotion=...]"), otherwise identical.
const TAG_PATTERN = /\[persona:(emotion|animation)=([^\]]+)\]/gi;

const canvas = document.getElementById("avatarCanvas");
const statusEl = document.getElementById("avatarStatus");
const emotionEl = document.getElementById("avatarEmotion");
const optionsEl = document.getElementById("avatarOptions");
const SKY_TEXTURE_CANDIDATES = [
  "/assets/skies/sky-pink.png",
  "/assets/skies/sky-rainbow.png",
  "/assets/skies/sky-red-blue.png",
  "/assets/skies/sky-red.png",
  "/assets/skies/sky-spooky-seamless.png",
  "/assets/skies/sky.png"
];
const SKY_TEXTURE_REPEAT = {
  x: -1.2,
  y: 1.08
};
const ROOM_TEXTURE_REPEAT = {
  backWall: [0.12, 0.22],
  sideWall: [1.3, 1.3],
  floor: [3.2, 3.2],
  ceiling: [2.2, 2.2],
  windowFrame: [1, 1]
};
const PROP_SLOT_LAYOUT = {
  backWallLeft: { position: new THREE.Vector3(-3.55, 0.02, -5.2), rotationY: 0, targetSize: 1.1 },
  backWallRight: { position: new THREE.Vector3(3.55, 0.02, -5.2), rotationY: 0, targetSize: 1.1 },
  wallLeft: { position: new THREE.Vector3(4.95, 0.02, -3.45), rotationY: -Math.PI / 2, targetSize: 1.1 },
  wallRight: { position: new THREE.Vector3(4.95, 0.02, -1), rotationY: -Math.PI / 2, targetSize: 1.1 },
  besideLeft: { position: new THREE.Vector3(-1.2, 0.02, -1.5), rotationY: 0.45, targetSize: 1.15 },
  besideRight: { position: new THREE.Vector3(1.6, 0.02, -1.9), rotationY: -0.35, targetSize: 1.15 },
  outsideLeft: { position: new THREE.Vector3(0, 0.02, -8.6), rotationY: 0.2, targetSize: 1.65 },
  outsideRight: { position: new THREE.Vector3(2.4, 0.02, -8.9), rotationY: -0.25, targetSize: 1.65 }
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  timer: new THREE.Timer(),
  mixer: null,
  model: null,
  actions: new Map(),
  activeAction: null,
  idleClip: DEFAULT_IDLE_CLIP,
  currentModelPath: "",
  reactionConfig: {
    catalog: DEFAULT_ANIMATION_CATALOG,
    emotionToClip: DEFAULT_EMOTION_TO_CLIP,
    talkingClips: DEFAULT_TALKING_CLIPS,
    idleClip: DEFAULT_IDLE_CLIP
  },
  clipQueue: [],
  speechQueue: [],
  isSpeaking: false,
  talkingIndex: 0,
  skyDome: null,
  roomShell: null,
  roomMaterials: null,
  propGroup: null,
  currentAppConfig: {},
  currentStylizationPreset: "none",
  composer: null,
  outlinePass: null,
  bloomPass: null,
  filmPass: null,
  rgbShiftPass: null,
  vignettePass: null,
  pixelPass: null,
  sceneAddons: new Set()
};

function buildReactionConfig(profile = {}) {
  const rawPaths = profile?.paths && typeof profile.paths === "object" ? profile.paths : {};
  const mergedPaths = {
    ...DEFAULT_EMOTION_TO_CLIP,
    ...Object.fromEntries(
      Object.entries(rawPaths)
        .map(([emotion, clip]) => [String(emotion || "").trim().toLowerCase(), String(clip || "").trim()])
        .filter(([emotion, clip]) => emotion && clip)
    )
  };
  const catalog = DEFAULT_ANIMATION_CATALOG.map((entry) => ({
    ...entry,
    clip: mergedPaths[entry.emotion] || entry.clip
  }));
  const knownEmotions = new Set(catalog.map((entry) => entry.emotion));
  Object.entries(mergedPaths)
    .filter(([emotion, clip]) => emotion && clip && !knownEmotions.has(emotion))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([emotion, clip]) => {
      catalog.push({
        emotion,
        clip,
        label: emotion
      });
    });
  const talkingClips = Array.isArray(profile?.talkingClips)
    ? profile.talkingClips.map((clip) => String(clip || "").trim()).filter(Boolean)
    : [];
  const idleClip = String(mergedPaths.idle || profile?.idleClip || DEFAULT_IDLE_CLIP).trim() || DEFAULT_IDLE_CLIP;
  return {
    catalog,
    emotionToClip: Object.fromEntries(catalog.map((entry) => [entry.emotion, entry.clip])),
    talkingClips: talkingClips.length ? talkingClips : DEFAULT_TALKING_CLIPS,
    idleClip
  };
}

function updateReactionConfig(appConfig = state.currentAppConfig, modelPath = state.currentModelPath || canvas?.dataset?.modelPath || "") {
  const normalizedModelPath = String(modelPath || "").trim();
  const mappings = appConfig?.reactionPathsByModel && typeof appConfig.reactionPathsByModel === "object"
    ? appConfig.reactionPathsByModel
    : {};
  const profile = normalizedModelPath && mappings[normalizedModelPath] && typeof mappings[normalizedModelPath] === "object"
    ? mappings[normalizedModelPath]
    : {};
  state.reactionConfig = buildReactionConfig(profile);
  state.idleClip = state.reactionConfig.idleClip;
  if (window.agentAvatar) {
    window.agentAvatar.options = { ...state.reactionConfig.emotionToClip };
  }
  populateOptions();
}

function firstAvailableClip(...candidates) {
  for (const candidate of candidates.flat()) {
    const clipName = String(candidate || "").trim();
    if (clipName && state.actions.has(clipName)) {
      return clipName;
    }
  }
  return state.actions.keys().next().value || DEFAULT_IDLE_CLIP;
}

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (material.map) {
    material.map.dispose();
  }
  material.dispose?.();
}

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function setEmotion(text) {
  if (emotionEl) {
    emotionEl.textContent = text;
  }
}

function renderFrame() {
  if (!state.renderer || !state.scene || !state.camera) {
    return;
  }
  if (state.composer) {
    state.composer.render();
    return;
  }
  state.renderer.render(state.scene, state.camera);
}

function buildSceneAddonContext() {
  return {
    THREE,
    scene: state.scene,
    camera: state.camera,
    renderer: state.renderer,
    model: state.model,
    canvas,
    renderFrame
  };
}

function initializeSceneAddon(addon) {
  if (!addon || typeof addon !== "object" || addon.__agentAvatarInitialized) {
    return;
  }
  if (!state.scene || !state.camera || !state.renderer) {
    return;
  }
  addon.__agentAvatarInitialized = true;
  try {
    addon.init?.(buildSceneAddonContext());
  } catch (error) {
    console.warn("avatar scene addon failed to initialize", error);
  }
}

function notifyAvatarModelChanged() {
  for (const addon of state.sceneAddons) {
    if (!addon || typeof addon !== "object") {
      continue;
    }
    initializeSceneAddon(addon);
    try {
      addon.onAvatarChanged?.(buildSceneAddonContext());
    } catch (error) {
      console.warn("avatar scene addon failed during avatar change", error);
    }
  }
}

function registerSceneAddon(addon) {
  if (!addon || typeof addon !== "object") {
    return () => {};
  }
  state.sceneAddons.add(addon);
  initializeSceneAddon(addon);
  return () => {
    state.sceneAddons.delete(addon);
    try {
      addon.dispose?.(buildSceneAddonContext());
    } catch (error) {
      console.warn("avatar scene addon failed to dispose", error);
    }
  };
}

function initPostProcessing() {
  if (!state.renderer || !state.scene || !state.camera || !canvas) {
    return;
  }
  const size = new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1);
  state.composer = new EffectComposer(state.renderer);
  state.composer.addPass(new RenderPass(state.scene, state.camera));

  state.pixelPass = new RenderPixelatedPass(1, state.scene, state.camera);
  state.pixelPass.enabled = false;
  state.composer.addPass(state.pixelPass);

  state.outlinePass = new OutlinePass(size, state.scene, state.camera);
  state.outlinePass.enabled = false;
  state.outlinePass.edgeStrength = 2.4;
  state.outlinePass.edgeGlow = 0.15;
  state.outlinePass.edgeThickness = 1.6;
  state.outlinePass.visibleEdgeColor.set(0x2d2019);
  state.outlinePass.hiddenEdgeColor.set(0x8a7566);
  state.composer.addPass(state.outlinePass);

  state.bloomPass = new UnrealBloomPass(size, 0.25, 0.55, 0.82);
  state.bloomPass.enabled = false;
  state.composer.addPass(state.bloomPass);

  state.filmPass = new FilmPass(0.42, 0.28, 648, false);
  state.filmPass.enabled = false;
  state.composer.addPass(state.filmPass);

  state.rgbShiftPass = new ShaderPass(RGBShiftShader);
  state.rgbShiftPass.enabled = false;
  state.rgbShiftPass.uniforms.amount.value = 0;
  state.composer.addPass(state.rgbShiftPass);

  state.vignettePass = new ShaderPass(VignetteShader);
  state.vignettePass.enabled = false;
  state.vignettePass.uniforms.offset.value = 1.0;
  state.vignettePass.uniforms.darkness.value = 1.0;
  state.composer.addPass(state.vignettePass);
}

function applyStylizationPreset(presetName = "none") {
  const preset = String(presetName || "none").trim().toLowerCase();
  state.currentStylizationPreset = preset;
  if (!state.renderer || !state.scene) {
    return;
  }
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1;
  state.scene.fog.color.setHex(0xe7cfc1);
  canvas.style.filter = "";
  if (state.pixelPass) state.pixelPass.enabled = false;
  if (state.outlinePass) state.outlinePass.enabled = false;
  if (state.bloomPass) state.bloomPass.enabled = false;
  if (state.filmPass) state.filmPass.enabled = false;
  if (state.rgbShiftPass) state.rgbShiftPass.enabled = false;
  if (state.vignettePass) state.vignettePass.enabled = false;

  if (preset === "dream") {
    state.renderer.toneMappingExposure = 1.06;
    state.scene.fog.color.setHex(0xf0d9d3);
    if (state.bloomPass) {
      state.bloomPass.enabled = true;
      state.bloomPass.strength = 0.38;
      state.bloomPass.radius = 0.58;
      state.bloomPass.threshold = 0.52;
    }
    if (state.rgbShiftPass) {
      state.rgbShiftPass.enabled = true;
      state.rgbShiftPass.uniforms.amount.value = 0.0005;
    }
    if (state.vignettePass) {
      state.vignettePass.enabled = true;
      state.vignettePass.uniforms.offset.value = 1.08;
      state.vignettePass.uniforms.darkness.value = 0.9;
    }
    return;
  }
  if (preset === "retro_vhs") {
    state.renderer.toneMappingExposure = 0.88;
    state.scene.fog.color.setHex(0xcab49d);
    if (state.filmPass) {
      state.filmPass.enabled = true;
      state.filmPass.uniforms.intensity.value = 0.52;
      state.filmPass.uniforms.grayscale.value = false;
    }
    if (state.rgbShiftPass) {
      state.rgbShiftPass.enabled = true;
      state.rgbShiftPass.uniforms.amount.value = 0.0022;
    }
    if (state.vignettePass) {
      state.vignettePass.enabled = true;
      state.vignettePass.uniforms.offset.value = 1.16;
      state.vignettePass.uniforms.darkness.value = 1.18;
    }
    return;
  }
  if (preset === "whimsical") {
    state.renderer.toneMappingExposure = 1.18;
    state.scene.fog.color.setHex(0xf7edf3);
    if (state.pixelPass) {
      state.pixelPass.enabled = true;
      state.pixelPass.setPixelSize(2);
      state.pixelPass.normalEdgeStrength = 0.08;
      state.pixelPass.depthEdgeStrength = 0.06;
    }
    if (state.bloomPass) {
      state.bloomPass.enabled = true;
      state.bloomPass.strength = 0.34;
      state.bloomPass.radius = 0.62;
      state.bloomPass.threshold = 0.6;
    }
    if (state.outlinePass) {
      state.outlinePass.enabled = true;
      state.outlinePass.edgeStrength = 0.7;
      state.outlinePass.edgeThickness = 0.9;
      state.outlinePass.visibleEdgeColor.set(0xf7d7e8);
      state.outlinePass.hiddenEdgeColor.set(0xf8f1ff);
    }
    return;
  }
  if (preset === "toon") {
    state.renderer.toneMappingExposure = 1.02;
    state.scene.fog.color.setHex(0xe8d7cb);
    if (state.pixelPass) {
      state.pixelPass.enabled = true;
      state.pixelPass.setPixelSize(2);
      state.pixelPass.normalEdgeStrength = 0.45;
      state.pixelPass.depthEdgeStrength = 0.35;
    }
    if (state.outlinePass) {
      state.outlinePass.enabled = true;
      state.outlinePass.edgeStrength = 3.4;
      state.outlinePass.edgeThickness = 1.8;
      state.outlinePass.visibleEdgeColor.set(0x241813);
    }
  }
}

function stripTags(text) {
  return String(text || "").replace(TAG_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanForSpeech(text) {
  return stripTags(text)
    .replace(/^\s*\*{0,2}\s*Access used:\*{0,2}\s.*$/gim, " ")
    .replace(/^\s*\*{0,2}\s*Tools used:\*{0,2}\s.*$/gim, " ")
    .replace(/^\s*\*{0,2}\s*Mounted paths used:\*{0,2}\s.*$/gim, " ")
    .replace(/^\s*\*{0,2}\s*URLs used:\*{0,2}\s.*$/gim, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    .replace(/[^\p{L}\p{N}\p{Zs}\n.,!?;:'"()/-]/gu, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDirectives(text) {
  let match;
  const directives = [];
  while ((match = TAG_PATTERN.exec(String(text || ""))) !== null) {
    directives.push({
      kind: match[1].toLowerCase(),
      value: match[2].trim()
    });
  }
  TAG_PATTERN.lastIndex = 0;
  return directives;
}

function clipNameForDirective(directive) {
  if (!directive) return state.idleClip;
  if (directive.kind === "animation") {
    return directive.value;
  }
  return state.reactionConfig.emotionToClip[directive.value.toLowerCase()] || state.idleClip;
}

function normalizedClipQueue(clipNames) {
  return (clipNames || []).filter((clipName) => clipName && clipName !== state.idleClip);
}

function getSpeakingClip() {
  const available = state.reactionConfig.talkingClips.filter((clipName) => state.actions.has(clipName));
  if (!available.length) {
    return state.idleClip;
  }
  const clip = available[state.talkingIndex % available.length];
  state.talkingIndex += 1;
  return clip;
}

function playSpeakingClip() {
  if (!state.isSpeaking) return;
  playClip(getSpeakingClip());
}

function queueClips(clipNames) {
  state.clipQueue = normalizedClipQueue(clipNames);
  if (state.clipQueue.length) {
    playClip(state.clipQueue.shift());
    return;
  }
  playClip(state.idleClip);
}

function populateOptions() {
  if (!optionsEl) return;
  optionsEl.innerHTML = state.reactionConfig.catalog.map((entry) =>
    `<span class="avatar-pill"><strong>${entry.emotion}</strong><span>${entry.label}</span><span>${entry.clip}</span></span>`
  ).join("");
}

function resizeRenderer() {
  if (!canvas || !state.renderer || !state.camera) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.composer?.setSize(width, height);
  if (state.outlinePass?.resolution) {
    state.outlinePass.resolution.set(width, height);
  }
}

function createWallWithWindow({
  width,
  height,
  windowWidth,
  windowHeight,
  sillHeight,
  material
}) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.lineTo(-width / 2, 0);

  const hole = new THREE.Path();
  const windowBottom = sillHeight;
  const windowLeft = -windowWidth / 2;
  hole.moveTo(windowLeft, windowBottom);
  hole.lineTo(windowLeft + windowWidth, windowBottom);
  hole.lineTo(windowLeft + windowWidth, windowBottom + windowHeight);
  hole.lineTo(windowLeft, windowBottom + windowHeight);
  hole.lineTo(windowLeft, windowBottom);
  shape.holes.push(hole);

  return new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
}

function createManagedStandardMaterial(color, extra = {}) {
  const material = new THREE.MeshStandardMaterial({ color, ...extra });
  material.userData.baseColor = color;
  return material;
}

function clearPropGroup() {
  if (!state.propGroup) {
    return;
  }
  state.propGroup.children.slice().forEach((child) => {
    state.propGroup.remove(child);
    child.traverse?.((node) => {
      if (node.isMesh) {
        node.geometry?.dispose?.();
        disposeMaterial(node.material);
      }
    });
  });
}

async function applyTextureToMaterial(material, texturePath, repeatX = 1, repeatY = 1) {
  if (!material) {
    return;
  }
  if (material.map) {
    material.map.dispose();
    material.map = null;
  }
  if (!texturePath) {
    material.color.setHex(material.userData.baseColor || 0xffffff);
    material.needsUpdate = true;
    return;
  }
  const texture = await loadTexture(texturePath);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  material.map = texture;
  material.color.setHex(0xffffff);
  material.needsUpdate = true;
}

async function applyRoomAppearance(appConfig = {}) {
  if (!state.roomMaterials) {
    return;
  }
  const roomTextures = appConfig?.roomTextures && typeof appConfig.roomTextures === "object" ? appConfig.roomTextures : {};
  await Promise.all([
    applyTextureToMaterial(state.roomMaterials.backWall, String(roomTextures.walls || "").trim(), ...ROOM_TEXTURE_REPEAT.backWall),
    applyTextureToMaterial(state.roomMaterials.sideWall, String(roomTextures.walls || "").trim(), ...ROOM_TEXTURE_REPEAT.sideWall),
    applyTextureToMaterial(state.roomMaterials.floor, String(roomTextures.floor || "").trim(), ...ROOM_TEXTURE_REPEAT.floor),
    applyTextureToMaterial(state.roomMaterials.ceiling, String(roomTextures.ceiling || "").trim(), ...ROOM_TEXTURE_REPEAT.ceiling),
    applyTextureToMaterial(state.roomMaterials.windowFrame, String(roomTextures.windowFrame || "").trim(), ...ROOM_TEXTURE_REPEAT.windowFrame)
  ]);
}

async function loadPropIntoSlot(loader, slotId, modelPath, scaleMultiplier = 1) {
  const slot = PROP_SLOT_LAYOUT[slotId];
  if (!slot || !modelPath || !state.propGroup) {
    return;
  }
  const gltf = await loader.loadAsync(modelPath);
  const prop = gltf.scene;
  prop.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(prop);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const normalizedScaleMultiplier = Math.max(0.2, Math.min(Number(scaleMultiplier || 1), 3));
  const scale = (slot.targetSize * normalizedScaleMultiplier) / maxDimension;
  prop.scale.setScalar(scale);
  prop.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(prop);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  prop.position.set(
    slot.position.x - scaledCenter.x,
    slot.position.y - scaledBox.min.y,
    slot.position.z - scaledCenter.z
  );
  prop.rotation.y = slot.rotationY;
  state.propGroup.add(prop);
}

async function loadAssignedProps(appConfig = {}) {
  if (!state.propGroup) {
    return;
  }
  clearPropGroup();
  const propSlots = appConfig?.propSlots && typeof appConfig.propSlots === "object" ? appConfig.propSlots : {};
  const loader = new GLTFLoader();
  for (const [slotId] of Object.entries(PROP_SLOT_LAYOUT)) {
    const slotConfig = propSlots?.[slotId];
    const modelPath = String((slotConfig && typeof slotConfig === "object" ? slotConfig.model : slotConfig) || "").trim();
    const scaleMultiplier = slotConfig && typeof slotConfig === "object" ? Number(slotConfig.scale || 1) : 1;
    if (!modelPath) {
      continue;
    }
    try {
      await loadPropIntoSlot(loader, slotId, modelPath, scaleMultiplier);
    } catch (error) {
      console.warn(`Failed to load prop for slot ${slotId}: ${error.message}`);
    }
  }
}

function createRoomShell() {
  if (!state.scene) {
    return;
  }
  if (state.roomShell) {
    state.scene.remove(state.roomShell);
  }

  const room = new THREE.Group();
  const roomWidth = 11.5;
  const roomDepth = 11.5;
  const roomHeight = 5.6;
  const halfWidth = roomWidth / 2;
  const halfDepth = roomDepth / 2;
  state.roomMaterials = {
    floor: createManagedStandardMaterial(0xcdb297, { roughness: 0.94 }),
    ceiling: createManagedStandardMaterial(0xf8f1e8, { roughness: 1 }),
    backWall: createManagedStandardMaterial(0xf4eadc, { roughness: 0.96, side: THREE.DoubleSide }),
    sideWall: createManagedStandardMaterial(0xf4eadc, { roughness: 0.96, side: THREE.DoubleSide }),
    windowFrame: createManagedStandardMaterial(0xe0ccb5, { roughness: 0.85 })
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), state.roomMaterials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  room.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), state.roomMaterials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  room.add(ceiling);

  const backWall = createWallWithWindow({
    width: roomWidth,
    height: roomHeight,
    windowWidth: 2.8,
    windowHeight: 2,
    sillHeight: 1.5,
    material: state.roomMaterials.backWall
  });
  backWall.position.set(0, 0, -halfDepth);
  room.add(backWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), state.roomMaterials.sideWall);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(halfWidth, roomHeight / 2, 0);
  room.add(rightWall);

  const windowFrameDepth = 0.08;
  const horizontalFrame = new THREE.BoxGeometry(2.96, 0.12, windowFrameDepth);
  const verticalFrame = new THREE.BoxGeometry(0.12, 2.12, windowFrameDepth);
  const mullion = new THREE.BoxGeometry(0.08, 2.02, windowFrameDepth * 0.9);
  const transom = new THREE.BoxGeometry(2.72, 0.08, windowFrameDepth * 0.9);
  const framePieces = [
    new THREE.Mesh(horizontalFrame, state.roomMaterials.windowFrame),
    new THREE.Mesh(horizontalFrame, state.roomMaterials.windowFrame),
    new THREE.Mesh(verticalFrame, state.roomMaterials.windowFrame),
    new THREE.Mesh(verticalFrame, state.roomMaterials.windowFrame),
    new THREE.Mesh(mullion, state.roomMaterials.windowFrame),
    new THREE.Mesh(transom, state.roomMaterials.windowFrame)
  ];
  framePieces[0].position.set(0, 1.5, -halfDepth + 0.03);
  framePieces[1].position.set(0, 3.5, -halfDepth + 0.03);
  framePieces[2].position.set(-1.4, 2.5, -halfDepth + 0.03);
  framePieces[3].position.set(1.4, 2.5, -halfDepth + 0.03);
  framePieces[4].position.set(0, 2.5, -halfDepth + 0.025);
  framePieces[5].position.set(0, 2.5, -halfDepth + 0.025);
  framePieces.forEach((piece) => room.add(piece));

  const sill = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 0.18), state.roomMaterials.windowFrame);
  sill.position.set(0, 1.46, -halfDepth + 0.1);
  room.add(sill);

  room.position.set(0, 0, 0);
  state.roomShell = room;
  state.scene.add(room);
  state.propGroup = new THREE.Group();
  state.scene.add(state.propGroup);
}

function frameModel(model) {
  if (!model || !state.camera) return;

  model.scale.setScalar(2);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const focusY = size.y * 0.78;

  model.position.set(-center.x - 0.55, -box.min.y, -center.z - 0.45);
  model.rotation.y = THREE.MathUtils.degToRad(-30);
  state.camera.position.set(-4.25, Math.max(2.2, size.y * 0.92), 4.25);
  state.camera.lookAt(-0.25, focusY, -0.85);
}

function playClip(clipName) {
  if (!state.mixer || !state.actions.size) return;
  const nextAction = state.actions.get(clipName) || state.actions.get(state.idleClip);
  if (!nextAction || state.activeAction === nextAction) return;

  const isIdle = clipName === state.idleClip || clipName === "Idle_6";
  nextAction.reset();
  nextAction.enabled = true;
  nextAction.clampWhenFinished = !isIdle;
  nextAction.setLoop(isIdle ? THREE.LoopRepeat : THREE.LoopOnce, isIdle ? Infinity : 1);
  nextAction.fadeIn(0.2).play();

  if (state.activeAction) {
    state.activeAction.fadeOut(0.2);
  }
  state.activeAction = nextAction;
  setEmotion(clipName);
}

function returnToIdle() {
  if (state.isSpeaking) {
    playSpeakingClip();
    return;
  }
  if (state.clipQueue.length) {
    playClip(state.clipQueue.shift());
    return;
  }
  if (state.activeAction && state.activeAction.getClip().name !== state.idleClip) {
    playClip(state.idleClip);
  }
}

function beginSpeech(clipNames = []) {
  state.isSpeaking = true;
  state.clipQueue = [];
  state.speechQueue = normalizedClipQueue(clipNames);
  playSpeakingClip();
}

function endSpeech() {
  state.isSpeaking = false;
  const pending = [...state.speechQueue];
  state.speechQueue = [];
  if (pending.length) {
    queueClips(pending);
    return;
  }
  returnToIdle();
}

function prepareResponseText(text) {
  const directives = extractDirectives(text);
  const clipNames = directives.map(clipNameForDirective);
  return {
    cleanText: stripTags(text),
    spokenText: cleanForSpeech(text),
    clipNames,
    directives,
    clipName: clipNames.at(-1) || state.idleClip,
    directive: directives.at(-1) || null
  };
}

function animate() {
  requestAnimationFrame(animate);
  state.timer.update();
  const delta = state.timer.getDelta();
  if (state.mixer) {
    state.mixer.update(delta);
  }
  if (state.skyDome && state.camera) {
    state.skyDome.position.copy(state.camera.position);
    state.skyDome.rotation.y += 0.00016;
  }
  for (const addon of state.sceneAddons) {
    initializeSceneAddon(addon);
    try {
      addon.update?.(delta, buildSceneAddonContext());
    } catch (error) {
      console.warn("avatar scene addon failed during update", error);
      state.sceneAddons.delete(addon);
    }
  }
  renderFrame();
}

function loadTexture(url) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadSkyDome() {
  if (!state.scene) {
    return;
  }
  if (state.skyDome) {
    state.scene.remove(state.skyDome);
    state.skyDome.geometry?.dispose?.();
    disposeMaterial(state.skyDome.material);
    state.skyDome = null;
  }
  const configuredPath = String(canvas?.dataset?.skyboxPath || "").trim();
  const candidates = configuredPath ? [configuredPath, ...SKY_TEXTURE_CANDIDATES] : SKY_TEXTURE_CANDIDATES;
  let texture = null;
  for (const candidate of candidates) {
    try {
      texture = await loadTexture(candidate);
      break;
    } catch {
      continue;
    }
  }
  if (!texture) {
    return;
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(SKY_TEXTURE_REPEAT.x, SKY_TEXTURE_REPEAT.y);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(64, 48, 32),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  skyDome.position.set(0, 5, 0);
  state.skyDome = skyDome;
  state.scene.add(skyDome);
}

function clearCurrentModel() {
  if (!state.scene || !state.model) {
    return;
  }
  state.scene.remove(state.model);
  state.model.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose?.();
      disposeMaterial(node.material);
    }
  });
  state.model = null;
  state.actions.clear();
  state.activeAction = null;
  state.mixer = null;
}

async function loadAvatarModel() {
  if (!state.scene) {
    return;
  }
  setStatus("Loading avatar...");
  clearCurrentModel();
  const loader = new GLTFLoader();
  const modelPath = canvas.dataset.modelPath || "/assets/characters/Nova.glb";
  state.currentModelPath = String(modelPath || "").trim();
  updateReactionConfig(state.currentAppConfig, state.currentModelPath);
  const gltf = await loader.loadAsync(modelPath);
  state.model = gltf.scene;
  state.scene.add(state.model);
  frameModel(state.model);

  state.mixer = new THREE.AnimationMixer(state.model);
  for (const clip of gltf.animations || []) {
    state.actions.set(clip.name, state.mixer.clipAction(clip));
  }
  state.mixer.addEventListener("finished", () => {
    window.setTimeout(returnToIdle, 120);
  });

  state.idleClip = firstAvailableClip(
    state.reactionConfig.idleClip,
    state.reactionConfig.emotionToClip.idle,
    DEFAULT_IDLE_CLIP
  );
  populateOptions();
  playClip(state.idleClip);
  notifyAvatarModelChanged();
  renderFrame();
  setStatus(`${state.actions.size} animations ready`);
}

async function reloadAppearance(appConfig = {}) {
  if (!canvas) {
    return;
  }
  state.currentAppConfig = {
    ...(state.currentAppConfig && typeof state.currentAppConfig === "object" ? state.currentAppConfig : {}),
    ...(appConfig && typeof appConfig === "object" ? appConfig : {})
  };
  if (appConfig.avatarModelPath) {
    canvas.dataset.modelPath = String(appConfig.avatarModelPath).trim();
  }
  state.currentModelPath = String(canvas.dataset.modelPath || state.currentModelPath || "").trim();
  updateReactionConfig(state.currentAppConfig, state.currentModelPath);
  canvas.dataset.skyboxPath = String(appConfig.backgroundImagePath || "").trim();
  applyStylizationPreset(
    appConfig.stylizationEffectPreset
      || appConfig.stylizationPreset
      || state.currentStylizationPreset
      || "none"
  );
  if (!state.scene) {
    return;
  }
  await loadSkyDome();
  await applyRoomAppearance(appConfig);
  await loadAssignedProps(appConfig);
  if (appConfig.avatarModelPath) {
    await loadAvatarModel();
  } else if (state.renderer && state.scene && state.camera) {
    renderFrame();
  }
}

// GENESIS: was `fetch("/api/app/config")` reading Nova's flat observer.config.json shape
// directly off `j.app`. voice-avatar-plugin.js exposes the same information shaped
// differently (nested under reactionClips/stylization, one global config rather than
// per-model), so this adapts the response into the exact appConfig shape
// reloadAppearance() above already expects — reloadAppearance itself is unchanged.
async function loadSavedAppAppearance() {
  const r = await fetch("/api/avatar/scene-config");
  const j = await r.json();
  if (!r.ok || !j.ok) {
    throw new Error(j.error || "failed to load saved avatar appearance");
  }
  const config = j.config || {};
  const modelPath = String(config.characterModelPath || "").trim();
  await reloadAppearance({
    avatarModelPath: modelPath,
    backgroundImagePath: config.backgroundImagePath || "",
    roomTextures: config.roomTextures || {},
    propSlots: config.propSlots || {},
    reactionPathsByModel: modelPath ? { [modelPath]: config.reactionClips || {} } : {},
    stylizationEffectPreset: config.stylization?.effectPreset || "none"
  });
}

async function init() {
  if (!canvas) return;

  state.timer.connect(document);
  state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.renderer.setClearColor(0xe2c6b7, 1);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.FogExp2(0xe7cfc1, 0.008);
  state.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  state.camera.position.set(-4.25, 2.4, 4.25);
  initPostProcessing();
  applyStylizationPreset(state.currentAppConfig?.stylizationPreset || "none");

  await loadSkyDome();
  createRoomShell();
  await applyRoomAppearance(state.currentAppConfig);
  await loadAssignedProps(state.currentAppConfig);

  const ambient = new THREE.AmbientLight(0xf1dfcf, 0.55);
  const hemi = new THREE.HemisphereLight(0xfbf1e2, 0xb89270, 1.15);
  const key = new THREE.DirectionalLight(0xfff3e5, 1.35);
  key.position.set(-1.8, 3.4, 2.1);
  const windowLight = new THREE.DirectionalLight(0xf3dcc7, 1.05);
  windowLight.position.set(0.2, 2.7, -5.6);
  const fill = new THREE.DirectionalLight(0xd9b59a, 0.45);
  fill.position.set(3.8, 1.8, 1.8);
  state.scene.add(ambient, hemi, key, windowLight, fill);

  setStatus("Loading avatar...");
  updateReactionConfig(state.currentAppConfig, canvas.dataset.modelPath || "/assets/characters/Nova.glb");
  await loadAvatarModel();
  await loadSavedAppAppearance();

  resizeRenderer();
  renderFrame();
  animate();
}

window.addEventListener("resize", resizeRenderer);

window.agentAvatar = {
  stripTags,
  cleanForSpeech,
  extractDirective(text) {
    return extractDirectives(text).at(-1) || null;
  },
  extractDirectives,
  prepareResponseText,
  applyResponseText(text) {
    const prepared = prepareResponseText(text);
    queueClips(prepared.clipNames);
    if (!prepared.directives.length) {
      setEmotion(state.idleClip);
      return { ...prepared, clipNames: [state.idleClip] };
    }
    return prepared;
  },
  beginSpeech,
  endSpeech,
  reloadAppearance,
  registerSceneAddon,
  getSceneContext: buildSceneAddonContext,
  options: { ...state.reactionConfig.emotionToClip },
  resizeRenderer
};

window.addEventListener("observer:app-config", (event) => {
  reloadAppearance(event.detail || {}).catch((error) => {
    setStatus(`Avatar failed: ${error.message}`);
    console.error(error);
  });
});

init().catch((error) => {
  setStatus(`Avatar failed: ${error.message}`);
  console.error(error);
});
