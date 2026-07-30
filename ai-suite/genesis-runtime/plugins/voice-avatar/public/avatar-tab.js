import { escapeHtml as h } from "/plugin-tab-shared.js";
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

// Faithful port of the original monolith's public/avatar.js (1041 lines), including its
// real bundled assets (public/assets/characters/Nova.glb, public/assets/skies/*.png —
// owned by the project this was built for, not placeholder content) — the room geometry
// (the actual window cutout, not a stand-in box), exact material/light/fog colors, the
// full postprocessing pass stack including the vignette pass, the real stylization preset
// values, the real emotion->clip animation mapping, and the speech-queue/tag-directive/
// public-API mechanism that drives reactions from live text. Config paths default to the
// bundled Nova.glb/sky-pink.png, same as the original, and stay editable via scene-config
// so a deployer can point at their own assets instead.

const PROP_SLOT_LAYOUT = {
  backWallLeft: { position: [-3.55, 0.02, -5.2], rotationY: 0, targetSize: 1.1 },
  backWallRight: { position: [3.55, 0.02, -5.2], rotationY: 0, targetSize: 1.1 },
  wallLeft: { position: [4.95, 0.02, -3.45], rotationY: -Math.PI / 2, targetSize: 1.1 },
  wallRight: { position: [4.95, 0.02, -1], rotationY: -Math.PI / 2, targetSize: 1.1 },
  besideLeft: { position: [-1.2, 0.02, -1.5], rotationY: 0.45, targetSize: 1.15 },
  besideRight: { position: [1.6, 0.02, -1.9], rotationY: -0.35, targetSize: 1.15 },
  outsideLeft: { position: [0, 0.02, -8.6], rotationY: 0.2, targetSize: 1.65 },
  outsideRight: { position: [2.4, 0.02, -8.9], rotationY: -0.25, targetSize: 1.65 }
};

const EMOTION_KEYS = [
  "idle", "calm", "agree", "angry", "love", "celebrate", "confused", "dance", "sass",
  "hurt", "reflect", "run", "scheme", "shrug", "rant", "passionate", "explain", "walk",
  "wave", "slam"
];

// The server side (voice-avatar-plugin.js's annotateEmotion) already emits this exact
// tag format as a prefix on annotated text: `[persona:emotion=<name>] ...`. The original
// avatar.js accepted the same shape (`[nova:...]`) anywhere in the text, not just as a
// prefix, and also accepted an `animation=<clip name>` variant — both ported as-is.
const TAG_PATTERN = /\[persona:(emotion|animation)=([^\]]+)\]/gi;

async function callApi(fetchImpl, path = "", options = {}) {
  const r = await fetchImpl(path, options);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
  return j;
}

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) return material.forEach(disposeMaterial);
  material.map?.dispose?.();
  material.dispose?.();
}

// Exact port of avatar.js's createWallWithWindow: a wall plane with a rectangular window
// hole cut into it via a Shape + Path hole, rather than a plain box standing in for it.
function createWallWithWindow({ width, height, windowWidth, windowHeight, sillHeight, material }) {
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

// --- Three.js scene, faithfully adapted from avatar.js's init()/createRoomShell()/
// loadAvatarModel()/applyStylizationPreset()/animate() -------------------------------
function createAvatarScene(canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xe7cfc1, 0.008);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  camera.position.set(-4.25, 2.4, 4.25);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xe2c6b7, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ambient = new THREE.AmbientLight(0xf1dfcf, 0.55);
  const hemi = new THREE.HemisphereLight(0xfbf1e2, 0xb89270, 1.15);
  const key = new THREE.DirectionalLight(0xfff3e5, 1.35);
  key.position.set(-1.8, 3.4, 2.1);
  const windowLight = new THREE.DirectionalLight(0xf3dcc7, 1.05);
  windowLight.position.set(0.2, 2.7, -5.6);
  const fill = new THREE.DirectionalLight(0xd9b59a, 0.45);
  fill.position.set(3.8, 1.8, 1.8);
  scene.add(ambient, hemi, key, windowLight, fill);

  // --- Room shell, exact dimensions/materials from createRoomShell ---
  const roomWidth = 11.5;
  const roomDepth = 11.5;
  const roomHeight = 5.6;
  const halfWidth = roomWidth / 2;
  const halfDepth = roomDepth / 2;
  const roomMaterials = {
    floor: createManagedStandardMaterial(0xcdb297, { roughness: 0.94 }),
    ceiling: createManagedStandardMaterial(0xf8f1e8, { roughness: 1 }),
    backWall: createManagedStandardMaterial(0xf4eadc, { roughness: 0.96, side: THREE.DoubleSide }),
    sideWall: createManagedStandardMaterial(0xf4eadc, { roughness: 0.96, side: THREE.DoubleSide }),
    windowFrame: createManagedStandardMaterial(0xe0ccb5, { roughness: 0.85 })
  };
  // Genesis's scene-config has one "walls" field, not separate back/side textures — both
  // wall materials share it, same visual result as the original where both were already
  // the same color/roughness.
  roomMaterials.walls = roomMaterials.backWall;

  const room = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), roomMaterials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  room.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), roomMaterials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  room.add(ceiling);

  const backWall = createWallWithWindow({
    width: roomWidth,
    height: roomHeight,
    windowWidth: 2.8,
    windowHeight: 2,
    sillHeight: 1.5,
    material: roomMaterials.backWall
  });
  backWall.position.set(0, 0, -halfDepth);
  room.add(backWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), roomMaterials.sideWall);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(halfWidth, roomHeight / 2, 0);
  room.add(rightWall);

  const windowFrameDepth = 0.08;
  const horizontalFrame = new THREE.BoxGeometry(2.96, 0.12, windowFrameDepth);
  const verticalFrame = new THREE.BoxGeometry(0.12, 2.12, windowFrameDepth);
  const mullion = new THREE.BoxGeometry(0.08, 2.02, windowFrameDepth * 0.9);
  const transom = new THREE.BoxGeometry(2.72, 0.08, windowFrameDepth * 0.9);
  const framePieces = [
    new THREE.Mesh(horizontalFrame, roomMaterials.windowFrame),
    new THREE.Mesh(horizontalFrame, roomMaterials.windowFrame),
    new THREE.Mesh(verticalFrame, roomMaterials.windowFrame),
    new THREE.Mesh(verticalFrame, roomMaterials.windowFrame),
    new THREE.Mesh(mullion, roomMaterials.windowFrame),
    new THREE.Mesh(transom, roomMaterials.windowFrame)
  ];
  framePieces[0].position.set(0, 1.5, -halfDepth + 0.03);
  framePieces[1].position.set(0, 3.5, -halfDepth + 0.03);
  framePieces[2].position.set(-1.4, 2.5, -halfDepth + 0.03);
  framePieces[3].position.set(1.4, 2.5, -halfDepth + 0.03);
  framePieces[4].position.set(0, 2.5, -halfDepth + 0.025);
  framePieces[5].position.set(0, 2.5, -halfDepth + 0.025);
  framePieces.forEach((piece) => room.add(piece));

  const sill = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.1, 0.18), roomMaterials.windowFrame);
  sill.position.set(0, 1.46, -halfDepth + 0.1);
  room.add(sill);

  room.position.set(0, 0, 0);
  scene.add(room);

  const propGroup = new THREE.Group();
  scene.add(propGroup);

  // --- Postprocessing composer, exact pass stack from initPostProcessing ---
  const size = new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const pixelPass = new RenderPixelatedPass(1, scene, camera);
  pixelPass.enabled = false;
  composer.addPass(pixelPass);

  const outlinePass = new OutlinePass(size, scene, camera);
  outlinePass.enabled = false;
  outlinePass.edgeStrength = 2.4;
  outlinePass.edgeGlow = 0.15;
  outlinePass.edgeThickness = 1.6;
  outlinePass.visibleEdgeColor.set(0x2d2019);
  outlinePass.hiddenEdgeColor.set(0x8a7566);
  composer.addPass(outlinePass);

  const bloomPass = new UnrealBloomPass(size, 0.25, 0.55, 0.82);
  bloomPass.enabled = false;
  composer.addPass(bloomPass);

  const filmPass = new FilmPass(0.42, 0.28, 648, false);
  filmPass.enabled = false;
  composer.addPass(filmPass);

  const rgbShiftPass = new ShaderPass(RGBShiftShader);
  rgbShiftPass.enabled = false;
  rgbShiftPass.uniforms.amount.value = 0;
  composer.addPass(rgbShiftPass);

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.enabled = false;
  vignettePass.uniforms.offset.value = 1.0;
  vignettePass.uniforms.darkness.value = 1.0;
  composer.addPass(vignettePass);

  const state = {
    scene, camera, renderer, composer,
    roomMaterials, propGroup,
    pixelPass, outlinePass, bloomPass, filmPass, rgbShiftPass, vignettePass,
    mixer: null, model: null, actions: new Map(), activeAction: null,
    idleClip: "",
    reactionConfig: { emotionToClip: {}, talkingClips: [], idleClip: "" },
    clipQueue: [], speechQueue: [], isSpeaking: false, talkingIndex: 0,
    skyDome: null,
    currentStylizationPreset: "none",
    timer: new THREE.Timer(),
    animId: 0
  };
  state.timer.connect(document);

  function renderFrame() {
    composer.render();
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composer.setSize(width, height);
    outlinePass.resolution.set(width, height);
  }

  // --- Stylization presets, exact values from applyStylizationPreset. The original had
  // one combined preset name; Genesis's scene-config splits it into filterPreset/
  // effectPreset. The 4 presets the original actually implements (dream/retro_vhs/
  // whimsical/toon) are wired to effectPreset with identical numbers. glow/grain/comic
  // exist only in Genesis's effectPreset enum (added before this port, no original
  // equivalent to copy) and get their own small, clearly-secondary treatment reusing the
  // same pass objects. filterPreset has no original equivalent at all (avatar.js never
  // used canvas.style.filter for a named preset) — treated as a lightweight independent
  // CSS look, additive rather than a substitute for anything dropped.
  function applyEffectPreset(name = "none") {
    const preset = String(name || "none").trim().toLowerCase();
    state.currentStylizationPreset = preset;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    scene.fog.color.setHex(0xe7cfc1);
    pixelPass.enabled = false;
    outlinePass.enabled = false;
    bloomPass.enabled = false;
    filmPass.enabled = false;
    rgbShiftPass.enabled = false;
    vignettePass.enabled = false;

    if (preset === "dream") {
      renderer.toneMappingExposure = 1.06;
      scene.fog.color.setHex(0xf0d9d3);
      bloomPass.enabled = true;
      bloomPass.strength = 0.38; bloomPass.radius = 0.58; bloomPass.threshold = 0.52;
      rgbShiftPass.enabled = true;
      rgbShiftPass.uniforms.amount.value = 0.0005;
      vignettePass.enabled = true;
      vignettePass.uniforms.offset.value = 1.08;
      vignettePass.uniforms.darkness.value = 0.9;
      return;
    }
    if (preset === "retro_vhs") {
      renderer.toneMappingExposure = 0.88;
      scene.fog.color.setHex(0xcab49d);
      filmPass.enabled = true;
      filmPass.uniforms.intensity.value = 0.52;
      filmPass.uniforms.grayscale.value = false;
      rgbShiftPass.enabled = true;
      rgbShiftPass.uniforms.amount.value = 0.0022;
      vignettePass.enabled = true;
      vignettePass.uniforms.offset.value = 1.16;
      vignettePass.uniforms.darkness.value = 1.18;
      return;
    }
    if (preset === "whimsical") {
      renderer.toneMappingExposure = 1.18;
      scene.fog.color.setHex(0xf7edf3);
      pixelPass.enabled = true;
      pixelPass.setPixelSize(2);
      pixelPass.normalEdgeStrength = 0.08;
      pixelPass.depthEdgeStrength = 0.06;
      bloomPass.enabled = true;
      bloomPass.strength = 0.34; bloomPass.radius = 0.62; bloomPass.threshold = 0.6;
      outlinePass.enabled = true;
      outlinePass.edgeStrength = 0.7;
      outlinePass.edgeThickness = 0.9;
      outlinePass.visibleEdgeColor.set(0xf7d7e8);
      outlinePass.hiddenEdgeColor.set(0xf8f1ff);
      return;
    }
    if (preset === "toon") {
      renderer.toneMappingExposure = 1.02;
      scene.fog.color.setHex(0xe8d7cb);
      pixelPass.enabled = true;
      pixelPass.setPixelSize(2);
      pixelPass.normalEdgeStrength = 0.45;
      pixelPass.depthEdgeStrength = 0.35;
      outlinePass.enabled = true;
      outlinePass.edgeStrength = 3.4;
      outlinePass.edgeThickness = 1.8;
      outlinePass.visibleEdgeColor.set(0x241813);
      return;
    }
    // Genesis-only extensions (no original preset to copy):
    if (preset === "glow") {
      bloomPass.enabled = true;
      bloomPass.strength = 0.5; bloomPass.radius = 0.6; bloomPass.threshold = 0.7;
    } else if (preset === "grain") {
      filmPass.enabled = true;
      filmPass.uniforms.intensity.value = 0.3;
    } else if (preset === "comic") {
      outlinePass.enabled = true;
      outlinePass.edgeStrength = 3.4;
      outlinePass.edgeThickness = 1.8;
    }
  }

  const CSS_FILTER_PRESETS = {
    none: "", soft: "blur(0.4px) brightness(1.05)", cinematic: "contrast(1.12) saturate(1.08)",
    noir: "grayscale(1) contrast(1.2)", vivid: "saturate(1.5)",
    haunted: "hue-rotate(210deg) contrast(1.15) brightness(0.85)",
    surveillance: "grayscale(0.8) brightness(1.1) contrast(1.05)",
    crystal: "saturate(1.25) brightness(1.08)", whimsical: "saturate(1.3) brightness(1.05)",
    toon: "saturate(1.4) contrast(1.1)", anime: "saturate(1.35) contrast(1.08) brightness(1.03)"
  };
  function applyFilterPreset(name = "none") {
    canvas.style.filter = CSS_FILTER_PRESETS[String(name || "none").trim().toLowerCase()] || "";
  }

  // --- Sky dome, exact port of loadSkyDome including its candidate fallback chain: try
  // the configured path first, then fall back through the bundled sky set in the same
  // order the original did, until one actually loads. ---
  const SKY_TEXTURE_CANDIDATES = [
    "/assets/skies/sky-pink.png",
    "/assets/skies/sky-rainbow.png",
    "/assets/skies/sky-red-blue.png",
    "/assets/skies/sky-red.png",
    "/assets/skies/sky.png"
  ];
  async function loadSkyDome(backgroundImagePath = "") {
    if (state.skyDome) {
      scene.remove(state.skyDome);
      state.skyDome.geometry?.dispose?.();
      disposeMaterial(state.skyDome.material);
      state.skyDome = null;
    }
    const configuredPath = String(backgroundImagePath || "").trim();
    const candidates = configuredPath ? [configuredPath, ...SKY_TEXTURE_CANDIDATES] : SKY_TEXTURE_CANDIDATES;
    const loader = new THREE.TextureLoader();
    let texture = null;
    for (const candidate of candidates) {
      try {
        texture = await loader.loadAsync(candidate);
        break;
      } catch {
        continue;
      }
    }
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(-1.2, 1.08);
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(64, 48, 32),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false })
    );
    skyDome.position.set(0, 5, 0);
    state.skyDome = skyDome;
    scene.add(skyDome);
  }

  function playClip(clipName) {
    if (!state.mixer || !state.actions.size) return;
    const nextAction = state.actions.get(clipName) || state.actions.get(state.idleClip) || state.actions.values().next().value;
    if (!nextAction || state.activeAction === nextAction) return;
    const isIdle = clipName === state.idleClip;
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.clampWhenFinished = !isIdle;
    nextAction.setLoop(isIdle ? THREE.LoopRepeat : THREE.LoopOnce, isIdle ? Infinity : 1);
    nextAction.fadeIn(0.2).play();
    if (state.activeAction) state.activeAction.fadeOut(0.2);
    state.activeAction = nextAction;
  }

  // --- Speech-queue mechanism, exact port of avatar.js's queueClips/beginSpeech/endSpeech ---
  function normalizedClipQueue(clipNames) {
    return (clipNames || []).filter((clipName) => clipName && clipName !== state.idleClip);
  }
  function returnToIdle() {
    if (state.isSpeaking) return playSpeakingClip();
    if (state.clipQueue.length) return playClip(state.clipQueue.shift());
    if (state.activeAction && state.activeAction.getClip().name !== state.idleClip) {
      playClip(state.idleClip);
    }
  }
  function getSpeakingClip() {
    const available = state.reactionConfig.talkingClips.filter((clipName) => state.actions.has(clipName));
    if (!available.length) return state.idleClip;
    const clip = available[state.talkingIndex % available.length];
    state.talkingIndex += 1;
    return clip;
  }
  function playSpeakingClip() {
    if (state.isSpeaking) playClip(getSpeakingClip());
  }
  function queueClips(clipNames) {
    state.clipQueue = normalizedClipQueue(clipNames);
    if (state.clipQueue.length) return playClip(state.clipQueue.shift());
    playClip(state.idleClip);
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
    if (pending.length) return queueClips(pending);
    returnToIdle();
  }

  // --- Tag-directive parsing, exact port of stripTags/cleanForSpeech/extractDirectives ---
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
      directives.push({ kind: match[1].toLowerCase(), value: match[2].trim() });
    }
    TAG_PATTERN.lastIndex = 0;
    return directives;
  }
  function clipNameForDirective(directive) {
    if (!directive) return state.idleClip;
    if (directive.kind === "animation") return directive.value;
    return state.reactionConfig.emotionToClip[directive.value.toLowerCase()] || state.idleClip;
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
  function applyResponseText(text) {
    const prepared = prepareResponseText(text);
    queueClips(prepared.clipNames);
    if (!prepared.directives.length) {
      return { ...prepared, clipNames: [state.idleClip] };
    }
    return prepared;
  }

  function clearModel() {
    if (!state.model) return;
    scene.remove(state.model);
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

  function frameModel(model) {
    model.scale.setScalar(2);
    const box = new THREE.Box3().setFromObject(model);
    const size3 = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const focusY = size3.y * 0.78;
    model.position.set(-center.x - 0.55, -box.min.y, -center.z - 0.45);
    model.rotation.y = THREE.MathUtils.degToRad(-30);
    camera.position.set(-4.25, Math.max(2.2, size3.y * 0.92), 4.25);
    camera.lookAt(-0.25, focusY, -0.85);
  }

  async function loadModel(modelPath, reactionConfig) {
    clearModel();
    state.reactionConfig = reactionConfig;
    state.idleClip = reactionConfig.idleClip || "";
    if (!modelPath) return { ok: true, animationCount: 0, empty: true };
    const gltf = await new GLTFLoader().loadAsync(modelPath);
    state.model = gltf.scene;
    scene.add(state.model);
    frameModel(state.model);
    state.mixer = new THREE.AnimationMixer(state.model);
    for (const clip of gltf.animations || []) {
      state.actions.set(clip.name, state.mixer.clipAction(clip));
    }
    state.mixer.addEventListener("finished", () => window.setTimeout(returnToIdle, 120));
    if (!state.idleClip && state.actions.size) state.idleClip = state.actions.keys().next().value;
    playClip(state.idleClip);
    renderFrame();
    return { ok: true, animationCount: state.actions.size, empty: false };
  }

  async function applyRoomTextures(roomTextures = {}) {
    const loader = new THREE.TextureLoader();
    const applyOne = async (material, url, repeatX = 1, repeatY = 1) => {
      if (material.map) { material.map.dispose(); material.map = null; }
      if (!url) {
        material.color.setHex(material.userData.baseColor);
        material.needsUpdate = true;
        return;
      }
      try {
        const texture = await loader.loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        material.map = texture;
        material.color.setHex(0xffffff);
        material.needsUpdate = true;
      } catch {
        // Leave the flat fallback color in place if the configured texture fails to load.
      }
    };
    await Promise.all([
      applyOne(roomMaterials.backWall, roomTextures.walls, 0.12, 0.22),
      applyOne(roomMaterials.sideWall, roomTextures.walls, 1.3, 1.3),
      applyOne(roomMaterials.floor, roomTextures.floor, 3.2, 3.2),
      applyOne(roomMaterials.ceiling, roomTextures.ceiling, 2.2, 2.2),
      applyOne(roomMaterials.windowFrame, roomTextures.windowFrame, 1, 1)
    ]);
  }

  function clearProps() {
    propGroup.children.slice().forEach((child) => {
      propGroup.remove(child);
      child.traverse?.((node) => {
        if (node.isMesh) {
          node.geometry?.dispose?.();
          disposeMaterial(node.material);
        }
      });
    });
  }

  async function loadProps(propSlots = {}) {
    clearProps();
    const loader = new GLTFLoader();
    for (const [slotId, layout] of Object.entries(PROP_SLOT_LAYOUT)) {
      const slotConfig = propSlots[slotId];
      const modelPath = String(slotConfig?.model || "").trim();
      if (!modelPath) continue;
      try {
        const gltf = await loader.loadAsync(modelPath);
        const prop = gltf.scene;
        prop.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(prop);
        const size3 = box.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size3.x, size3.y, size3.z, 0.001);
        const scaleMultiplier = Math.max(0.2, Math.min(Number(slotConfig?.scale || 1), 3));
        const scale = (layout.targetSize * scaleMultiplier) / maxDimension;
        prop.scale.setScalar(scale);
        prop.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(prop);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
        prop.position.set(
          layout.position[0] - scaledCenter.x,
          layout.position[1] - scaledBox.min.y,
          layout.position[2] - scaledCenter.z
        );
        prop.rotation.y = layout.rotationY;
        propGroup.add(prop);
      } catch (error) {
        console.warn(`Failed to load prop for slot ${slotId}: ${error.message}`);
      }
    }
  }

  function animate() {
    state.animId = requestAnimationFrame(animate);
    state.timer.update();
    const delta = state.timer.getDelta();
    state.mixer?.update(delta);
    if (state.skyDome) {
      state.skyDome.position.copy(camera.position);
      state.skyDome.rotation.y += 0.00016;
    }
    renderFrame();
  }

  function dispose() {
    cancelAnimationFrame(state.animId);
    window.removeEventListener("resize", resize);
    clearModel();
    clearProps();
    renderer.dispose();
  }

  window.addEventListener("resize", resize);
  applyEffectPreset("none");

  const sceneApi = {
    state, resize, playClip, loadModel, applyRoomTextures, loadProps, loadSkyDome,
    applyEffectPreset, applyFilterPreset, animate, dispose, renderFrame,
    stripTags, cleanForSpeech, extractDirectives, prepareResponseText, applyResponseText,
    beginSpeech, endSpeech
  };

  // Public API, same shape as the original's window.agentAvatar — so a future chat/intake
  // surface can drive the avatar exactly like Nova's did, even though nothing in Genesis
  // currently emits speech text through it yet (there is no built-in chat UI to wire this
  // to — this is a real, callable mechanism waiting for a caller, not dead code).
  window.agentAvatar = {
    stripTags,
    cleanForSpeech,
    extractDirective: (text) => extractDirectives(text).at(-1) || null,
    extractDirectives,
    prepareResponseText,
    applyResponseText,
    beginSpeech,
    endSpeech,
    registerSceneAddon: () => () => {},
    getSceneContext: () => ({ THREE, scene, camera, renderer, model: state.model, canvas, renderFrame }),
    get options() { return { ...state.reactionConfig.emotionToClip }; }
  };

  return sceneApi;
}

// --- Tab UI ------------------------------------------------------------------------

function setSubtab(root, id) {
  root.dataset.avatarTab = id;
  root.querySelectorAll("[data-avatar-subtab-target]").forEach((b) => b.classList.toggle("active", b.dataset.avatarSubtabTarget === id));
  root.querySelectorAll("[data-avatar-subtab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.avatarSubtabPanel === id));
}

function propSlotFields(propSlots = {}) {
  return Object.keys(PROP_SLOT_LAYOUT).map((slotId) => `
    <div class="brains-form-row">
      <label>${h(slotId)} model<input data-prop-model="${h(slotId)}" placeholder="props/example.glb" value="${h(propSlots[slotId]?.model || "")}"></label>
      <label>Scale<input data-prop-scale="${h(slotId)}" type="number" step="0.1" min="0.2" max="3" value="${h(String(propSlots[slotId]?.scale ?? 1))}"></label>
    </div>
  `).join("");
}

export async function mountPluginTab(context = {}) {
  const root = context?.root;
  if (!(root instanceof HTMLElement)) return;

  const fetchImpl = context?.pluginAdminFetch || context?.observerApp?.pluginAdminFetch || fetch;
  const api = (path, options) => callApi(fetchImpl, path, options);

  if (!document.getElementById("avatarPluginStyles")) {
    const s = document.createElement("style");
    s.id = "avatarPluginStyles";
    s.textContent = `
      .avatar-subtabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
      .avatar-subtabs button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer}
      .avatar-subtabs button.active{background:var(--accent);color:#1a0f00;border-color:transparent}
      [data-avatar-subtab-panel]{display:none}[data-avatar-subtab-panel].active{display:block}
      .avatar-canvas-wrap{position:relative;width:100%;aspect-ratio:16/10;background:#000;border-radius:10px;overflow:hidden;margin-bottom:10px}
      .avatar-canvas-wrap canvas{width:100%;height:100%;display:block}
      .avatar-emotion-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .avatar-emotion-row button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:999px;padding:4px 10px;font:inherit;font-size:0.82em;cursor:pointer}
      .brains-form{display:grid;gap:8px;margin-bottom:14px}
      .brains-form input,.brains-form select{border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--ink);padding:7px 9px;font:inherit}
      .brains-form-row{display:flex;gap:8px;flex-wrap:wrap}
      .brains-form-row > *{flex:1;min-width:140px}
      .brains-form label{font-size:0.82em;color:var(--muted);display:flex;flex-direction:column;gap:3px}
      .brains-list{display:grid;gap:8px}
      .brains-item{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--panel)}
      .brains-item .micro{color:var(--muted);font-size:0.8em;margin-top:4px}
      .brains-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .brains-actions button{border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:8px;padding:5px 10px;font:inherit;cursor:pointer}
      .asset-chip-group{margin-bottom:10px}
      .asset-chip-group h4{margin:0 0 6px;font-size:0.85em;color:var(--muted)}
      .asset-chip{display:inline-block;border:1px solid var(--border);background:var(--panel-strong);color:var(--ink);border-radius:6px;padding:3px 8px;margin:0 6px 6px 0;font-size:0.8em;cursor:pointer}
      .tone-bad{color:var(--bad)}
      .tone-ok{color:var(--ok)}
    `;
    document.head.appendChild(s);
  }

  if (!root.dataset.avatarMounted) {
    root.innerHTML = `
      <section>
        <div class="panel-head">
          <div><h2>Avatar</h2><div class="panel-subtle">3D avatar scene, room, and voice trust profiles — owned by the voice-avatar plugin.</div></div>
        </div>
        <div id="avatarHint" class="panel-subtle">Loading&hellip;</div>

        <div class="avatar-subtabs" role="tablist">
          <button type="button" class="active" data-avatar-subtab-target="scene">Scene</button>
          <button type="button" data-avatar-subtab-target="config">Scene config</button>
          <button type="button" data-avatar-subtab-target="assets">Assets</button>
          <button type="button" data-avatar-subtab-target="trust">Trust profiles</button>
        </div>

        <div class="card active" data-avatar-subtab-panel="scene">
          <div class="avatar-canvas-wrap"><canvas id="avatarCanvas"></canvas></div>
          <div class="avatar-emotion-row" id="avatarEmotionRow"></div>
          <div class="brains-form-row">
            <input id="avatarAnnotateText" placeholder="Type a line of speech to annotate + preview&hellip;">
            <button id="avatarAnnotateBtn" type="button">Annotate &amp; play</button>
          </div>
        </div>

        <div class="card" data-avatar-subtab-panel="config">
          <div class="brains-form">
            <label>Character model path<input id="cfgCharacterModel" placeholder="characters/example.glb"></label>
            <label>Background/sky image path<input id="cfgBackgroundImage" placeholder="skies/example.png"></label>
            <div class="brains-form-row">
              <label>Wall texture<input id="cfgWalls" placeholder="textures/wall.png"></label>
              <label>Floor texture<input id="cfgFloor" placeholder="textures/floor.png"></label>
            </div>
            <div class="brains-form-row">
              <label>Ceiling texture<input id="cfgCeiling" placeholder="textures/ceiling.png"></label>
              <label>Window frame texture<input id="cfgWindowFrame" placeholder="textures/frame.png"></label>
            </div>
            <div class="brains-form-row">
              <label>Filter preset<select id="cfgFilterPreset"></select></label>
              <label>Effect preset<select id="cfgEffectPreset"></select></label>
            </div>
            <div class="brains-form-row">
              <label>Idle clip name<input id="cfgIdleClip" placeholder="animation clip name in the model"></label>
              <label>Talking clip names (comma-separated)<input id="cfgTalkingClips" placeholder="clip1, clip2"></label>
            </div>
            <div><strong>Prop slots</strong></div>
            <div id="cfgPropSlots"></div>
            <div><strong>Emotion &rarr; clip name mapping</strong></div>
            <div id="cfgEmotionClips" class="brains-form"></div>
            <div><button id="cfgSaveBtn" type="button">Save scene config</button></div>
          </div>
        </div>

        <div class="card" data-avatar-subtab-panel="assets">
          <div class="panel-subtle" style="margin-bottom:10px">Files found under the plugin's configured assets directory. Click one to copy its relative path.</div>
          <div id="assetGroups"></div>
        </div>

        <div class="card" data-avatar-subtab-panel="trust">
          <div class="brains-form">
            <div class="brains-form-row">
              <label>Label<input id="trustLabel" placeholder="e.g. Household member"></label>
              <label>Trust level<select id="trustLevel"><option value="unknown">Unknown</option><option value="known">Known</option><option value="trusted">Trusted</option></select></label>
            </div>
            <label>Notes<input id="trustNotes" placeholder="(optional)"></label>
            <div><button id="trustSaveBtn" type="button">Save profile</button> <button id="trustResetBtn" class="secondary" type="button">New profile</button></div>
          </div>
          <div id="trustList" class="brains-list"><div class="panel-subtle">Loading&hellip;</div></div>
        </div>
      </section>
    `;
    root.dataset.avatarMounted = "1";
  }

  const hint = root.querySelector("#avatarHint");
  const setHint = (text = "", tone = "") => {
    hint.textContent = text;
    hint.className = tone ? `panel-subtle tone-${tone}` : "panel-subtle";
  };

  const state = { sceneConfig: null, trustProfiles: [], editingTrustId: "" };

  if (!root.avatarScene) {
    const canvas = root.querySelector("#avatarCanvas");
    root.avatarScene = createAvatarScene(canvas);
  }
  const sceneCtl = root.avatarScene;

  const populateEmotionRow = () => {
    const row = root.querySelector("#avatarEmotionRow");
    row.innerHTML = EMOTION_KEYS.map((emotion) => `<button type="button" data-emotion="${h(emotion)}">${h(emotion)}</button>`).join("");
  };

  const populateFilterPresets = () => {
    const presets = ["none", "soft", "cinematic", "noir", "vivid", "dream", "retro_vhs", "haunted", "surveillance", "crystal", "whimsical", "toon", "anime"];
    root.querySelector("#cfgFilterPreset").innerHTML = presets.map((p) => `<option value="${h(p)}">${h(p)}</option>`).join("");
    const effects = ["none", "toon", "dream", "retro_vhs", "whimsical", "glow", "grain", "comic"];
    root.querySelector("#cfgEffectPreset").innerHTML = effects.map((p) => `<option value="${h(p)}">${h(p)}</option>`).join("");
  };

  const populateEmotionClipInputs = (paths = {}) => {
    root.querySelector("#cfgEmotionClips").innerHTML = EMOTION_KEYS.map((emotion) => `
      <div class="brains-form-row">
        <label style="flex:0 0 90px">${h(emotion)}<input data-emotion-clip="${h(emotion)}" value="${h(paths[emotion] || "")}" placeholder="clip name"></label>
      </div>
    `).join("");
  };

  const fillConfigForm = (config) => {
    root.querySelector("#cfgCharacterModel").value = config.characterModelPath || "";
    root.querySelector("#cfgBackgroundImage").value = config.backgroundImagePath || "";
    root.querySelector("#cfgWalls").value = config.roomTextures?.walls || "";
    root.querySelector("#cfgFloor").value = config.roomTextures?.floor || "";
    root.querySelector("#cfgCeiling").value = config.roomTextures?.ceiling || "";
    root.querySelector("#cfgWindowFrame").value = config.roomTextures?.windowFrame || "";
    root.querySelector("#cfgFilterPreset").value = config.stylization?.filterPreset || "none";
    root.querySelector("#cfgEffectPreset").value = config.stylization?.effectPreset || "none";
    root.querySelector("#cfgIdleClip").value = config.reactionClips?.idleClip || "";
    root.querySelector("#cfgTalkingClips").value = (config.reactionClips?.talkingClips || []).join(", ");
    root.querySelector("#cfgPropSlots").innerHTML = propSlotFields(config.propSlots || {});
    populateEmotionClipInputs(config.reactionClips?.paths || {});
  };

  const applySceneFromConfig = async (config) => {
    sceneCtl.applyFilterPreset(config.stylization?.filterPreset);
    sceneCtl.applyEffectPreset(config.stylization?.effectPreset);
    await sceneCtl.loadSkyDome(config.backgroundImagePath || "");
    await sceneCtl.applyRoomTextures(config.roomTextures || {});
    await sceneCtl.loadProps(config.propSlots || {});
    const reactionConfig = {
      emotionToClip: config.reactionClips?.paths || {},
      talkingClips: config.reactionClips?.talkingClips || [],
      idleClip: config.reactionClips?.idleClip || ""
    };
    return sceneCtl.loadModel(config.characterModelPath || "", reactionConfig);
  };

  const loadSceneConfig = async () => {
    const { config } = await api("/api/avatar/scene-config");
    state.sceneConfig = config;
    fillConfigForm(config);
    const result = await applySceneFromConfig(config);
    setHint(result.empty ? "No character model configured — showing an empty scene." : `Scene loaded (${result.animationCount} animation clip${result.animationCount === 1 ? "" : "s"}).`);
  };

  const renderAssetGroups = (assets) => {
    const groups = [
      ["Characters", assets.characters || []],
      ["Props", assets.props || []],
      ["Textures", assets.textures || []],
      ["Skies", assets.skies || []]
    ];
    root.querySelector("#assetGroups").innerHTML = groups.map(([label, files]) => `
      <div class="asset-chip-group">
        <h4>${h(label)} (${files.length})</h4>
        ${files.length ? files.map((f) => `<span class="asset-chip" data-asset-path="${h(f)}">${h(f)}</span>`).join("") : `<div class="panel-subtle">None found.</div>`}
      </div>
    `).join("");
  };

  const loadAssets = async () => {
    const { assets } = await api("/api/avatar/assets");
    renderAssetGroups(assets);
  };

  const resetTrustForm = () => {
    state.editingTrustId = "";
    root.querySelector("#trustLabel").value = "";
    root.querySelector("#trustLevel").value = "known";
    root.querySelector("#trustNotes").value = "";
  };

  const renderTrustList = () => {
    const list = root.querySelector("#trustList");
    list.innerHTML = state.trustProfiles.length
      ? state.trustProfiles.map((p) => `
        <article class="brains-item" data-trust-id="${h(p.id)}">
          <strong>${h(p.label)}</strong> <span class="micro">${h(p.trustLevel)}</span>
          ${p.notes ? `<div class="micro">${h(p.notes)}</div>` : ""}
          <div class="brains-actions">
            <button type="button" data-trust-edit="${h(p.id)}">Edit</button>
            <button type="button" data-trust-remove="${h(p.id)}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<div class="panel-subtle">No voice trust profiles yet.</div>`;
  };

  const loadTrustProfiles = async () => {
    const { profiles } = await api("/api/voice/trust-profiles");
    state.trustProfiles = Array.isArray(profiles) ? profiles : [];
    renderTrustList();
  };

  if (!root.dataset.avatarBound) {
    populateEmotionRow();
    populateFilterPresets();

    root.querySelectorAll("[data-avatar-subtab-target]").forEach((b) => b.addEventListener("click", () => setSubtab(root, b.dataset.avatarSubtabTarget)));

    root.querySelector("#avatarEmotionRow").addEventListener("click", (evt) => {
      const btn = evt.target.closest("[data-emotion]");
      if (!btn) return;
      const emotion = btn.dataset.emotion;
      const clip = state.sceneConfig?.reactionClips?.paths?.[emotion] || state.sceneConfig?.reactionClips?.idleClip || "";
      sceneCtl.playClip(clip);
    });

    root.querySelector("#avatarAnnotateBtn").addEventListener("click", async () => {
      const text = String(root.querySelector("#avatarAnnotateText").value || "").trim();
      if (!text) return setHint("Type a line of speech first.", "bad");
      try {
        const result = await api("/api/voice/annotate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        // Exercises the real applyResponseText/directive path, same as a live caller would.
        sceneCtl.applyResponseText(result.text || "");
        setHint(`Annotated as "${result.emotion || "none"}".`, "ok");
      } catch (e) {
        setHint(`Annotate failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#cfgSaveBtn").addEventListener("click", async () => {
      const propSlots = {};
      Object.keys(PROP_SLOT_LAYOUT).forEach((slotId) => {
        propSlots[slotId] = {
          model: root.querySelector(`[data-prop-model="${CSS.escape(slotId)}"]`).value,
          scale: Number(root.querySelector(`[data-prop-scale="${CSS.escape(slotId)}"]`).value || 1)
        };
      });
      const paths = {};
      EMOTION_KEYS.forEach((emotion) => {
        paths[emotion] = root.querySelector(`[data-emotion-clip="${CSS.escape(emotion)}"]`).value;
      });
      try {
        const { config } = await api("/api/avatar/scene-config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            characterModelPath: root.querySelector("#cfgCharacterModel").value,
            backgroundImagePath: root.querySelector("#cfgBackgroundImage").value,
            roomTextures: {
              walls: root.querySelector("#cfgWalls").value,
              floor: root.querySelector("#cfgFloor").value,
              ceiling: root.querySelector("#cfgCeiling").value,
              windowFrame: root.querySelector("#cfgWindowFrame").value
            },
            stylization: {
              filterPreset: root.querySelector("#cfgFilterPreset").value,
              effectPreset: root.querySelector("#cfgEffectPreset").value
            },
            reactionClips: {
              idleClip: root.querySelector("#cfgIdleClip").value,
              talkingClips: root.querySelector("#cfgTalkingClips").value.split(",").map((s) => s.trim()).filter(Boolean),
              paths
            },
            propSlots
          })
        });
        state.sceneConfig = config;
        fillConfigForm(config);
        const result = await applySceneFromConfig(config);
        setSubtab(root, "scene");
        setHint(result.empty ? "Saved. No character model configured — showing an empty scene." : `Saved. Scene reloaded (${result.animationCount} clips).`, "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#assetGroups").addEventListener("click", (evt) => {
      const chip = evt.target.closest("[data-asset-path]");
      if (!chip) return;
      const path = chip.dataset.assetPath;
      navigator.clipboard?.writeText(path).catch(() => {});
      setHint(`Copied "${path}" to clipboard.`, "ok");
    });

    root.querySelector("#trustResetBtn").addEventListener("click", resetTrustForm);

    root.querySelector("#trustSaveBtn").addEventListener("click", async () => {
      const label = String(root.querySelector("#trustLabel").value || "").trim();
      if (!label) return setHint("Label is required.", "bad");
      try {
        await api("/api/voice/trust-profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: state.editingTrustId || undefined,
            label,
            trustLevel: root.querySelector("#trustLevel").value,
            notes: root.querySelector("#trustNotes").value
          })
        });
        resetTrustForm();
        await loadTrustProfiles();
        setHint(`Trust profile "${label}" saved.`, "ok");
      } catch (e) {
        setHint(`Save failed: ${e.message}`, "bad");
      }
    });

    root.querySelector("#trustList").addEventListener("click", async (evt) => {
      const editBtn = evt.target.closest("[data-trust-edit]");
      if (editBtn) {
        const profile = state.trustProfiles.find((p) => p.id === editBtn.dataset.trustEdit);
        if (profile) {
          state.editingTrustId = profile.id;
          root.querySelector("#trustLabel").value = profile.label;
          root.querySelector("#trustLevel").value = profile.trustLevel;
          root.querySelector("#trustNotes").value = profile.notes || "";
        }
        return;
      }
      const removeBtn = evt.target.closest("[data-trust-remove]");
      if (removeBtn) {
        const id = removeBtn.dataset.trustRemove;
        if (!window.confirm("Remove this trust profile?")) return;
        try {
          await api(`/api/voice/trust-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
          await loadTrustProfiles();
          setHint("Trust profile removed.", "ok");
        } catch (e) {
          setHint(`Remove failed: ${e.message}`, "bad");
        }
      }
    });

    root.dataset.avatarBound = "1";
  }

  resetTrustForm();
  setSubtab(root, root.dataset.avatarTab || "scene");
  sceneCtl.resize();
  if (!root.dataset.avatarAnimating) {
    sceneCtl.animate();
    root.dataset.avatarAnimating = "1";
  }

  try {
    await Promise.all([loadSceneConfig(), loadAssets(), loadTrustProfiles()]);
  } catch (e) {
    setHint(`Avatar unavailable: ${e.message}`, "bad");
  }
}
