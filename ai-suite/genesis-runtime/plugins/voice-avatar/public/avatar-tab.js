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

// Ported from the original monolith's public/avatar.js (1041 lines), generalized: the
// original hardcoded a bundled personal character asset (Nova.glb) with a specific
// animation-clip naming scheme, and a fallback list of bundled sky texture filenames.
// Neither exists in Genesis — voice-avatar-plugin.js's scene-config schema is already
// asset-agnostic (characterModelPath/propSlots/roomTextures are plain configurable
// strings, see the plugin's own header comment), and has no sky/background field at
// all, so the sky dome is dropped rather than reintroduced with invented config. This
// renders whatever the deployer configures — an empty config renders an empty room
// with lighting and postprocessing but no character, rather than failing.

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

// --- Three.js scene, adapted from avatar.js's init()/loadAvatarModel()/animate() ---
function createAvatarScene(canvas) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1420, 0.012);
  scene.background = new THREE.Color(0x0b0f1a);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  camera.position.set(-4.25, 2.4, 4.25);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0b0f1a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const ambient = new THREE.AmbientLight(0xcfd6ff, 0.5);
  const hemi = new THREE.HemisphereLight(0xe8e2ff, 0x201830, 1.0);
  const key = new THREE.DirectionalLight(0xfff3e5, 1.3);
  key.position.set(-1.8, 3.4, 2.1);
  const fill = new THREE.DirectionalLight(0xc8a96a, 0.4);
  fill.position.set(3.8, 1.8, 1.8);
  scene.add(ambient, hemi, key, fill);

  const roomWidth = 11.5;
  const roomDepth = 11.5;
  const roomHeight = 5.6;
  const roomMaterials = {
    floor: new THREE.MeshStandardMaterial({ color: 0x2a2035, roughness: 0.94 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x1c1626, roughness: 1 }),
    walls: new THREE.MeshStandardMaterial({ color: 0x241c30, roughness: 0.96, side: THREE.DoubleSide }),
    windowFrame: new THREE.MeshStandardMaterial({ color: 0xc8a96a, roughness: 0.6 })
  };
  Object.values(roomMaterials).forEach((mat) => { mat.userData.baseColor = mat.color.getHex(); });

  const room = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), roomMaterials.floor);
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), roomMaterials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  room.add(ceiling);
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), roomMaterials.walls);
  backWall.position.set(0, roomHeight / 2, -roomDepth / 2);
  room.add(backWall);
  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), roomMaterials.walls);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(roomWidth / 2, roomHeight / 2, 0);
  room.add(rightWall);
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), roomMaterials.walls);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-roomWidth / 2, roomHeight / 2, 0);
  room.add(leftWall);
  // A simple decorative trim standing in for the original's window-frame cutout geometry.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 0.08), roomMaterials.windowFrame);
  frame.position.set(0, 2.6, -roomDepth / 2 + 0.05);
  room.add(frame);
  scene.add(room);

  const propGroup = new THREE.Group();
  scene.add(propGroup);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = new THREE.Vector2(canvas.clientWidth || 1, canvas.clientHeight || 1);
  const pixelPass = new RenderPixelatedPass(1, scene, camera);
  pixelPass.enabled = false;
  composer.addPass(pixelPass);
  const outlinePass = new OutlinePass(size, scene, camera);
  outlinePass.enabled = false;
  outlinePass.edgeStrength = 2.4;
  outlinePass.edgeGlow = 0.15;
  outlinePass.edgeThickness = 1.6;
  outlinePass.visibleEdgeColor.set(0xc8a96a);
  outlinePass.hiddenEdgeColor.set(0x4b3d20);
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

  const state = {
    scene, camera, renderer, composer,
    roomMaterials, propGroup,
    pixelPass, outlinePass, bloomPass, filmPass, rgbShiftPass,
    mixer: null, model: null, actions: new Map(), activeAction: null,
    idleClip: "", reactionConfig: { emotionToClip: {}, talkingClips: [], idleClip: "" },
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
    model.position.set(-center.x - 0.55, -box.min.y, -center.z - 0.45);
    model.rotation.y = THREE.MathUtils.degToRad(-30);
    camera.position.set(-4.25, Math.max(2.2, size3.y * 0.92), 4.25);
    camera.lookAt(-0.25, size3.y * 0.78, -0.85);
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
    state.mixer.addEventListener("finished", () => window.setTimeout(() => playClip(state.idleClip), 120));
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
      applyOne(roomMaterials.walls, roomTextures.walls, 1.3, 1.3),
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

  // effectPreset drives the composer pass stack (real postprocessing, ported from
  // avatar.js's applyStylizationPreset). filterPreset is a lighter CSS-level look applied
  // directly to the canvas element — the two fields are independent in Genesis's
  // scene-config schema (unlike the original's single combined preset name), so both get
  // a real, distinct, visible effect rather than one silently doing nothing.
  function applyEffectPreset(name = "none") {
    const preset = String(name || "none").trim().toLowerCase();
    pixelPass.enabled = false;
    outlinePass.enabled = false;
    bloomPass.enabled = false;
    filmPass.enabled = false;
    rgbShiftPass.enabled = false;
    if (preset === "glow") {
      bloomPass.enabled = true;
      bloomPass.strength = 0.5; bloomPass.radius = 0.6; bloomPass.threshold = 0.7;
    } else if (preset === "dream") {
      bloomPass.enabled = true;
      bloomPass.strength = 0.38; bloomPass.radius = 0.58; bloomPass.threshold = 0.52;
      rgbShiftPass.enabled = true;
      rgbShiftPass.uniforms.amount.value = 0.0005;
    } else if (preset === "retro_vhs") {
      filmPass.enabled = true;
      filmPass.uniforms.intensity.value = 0.52;
      rgbShiftPass.enabled = true;
      rgbShiftPass.uniforms.amount.value = 0.0022;
    } else if (preset === "grain") {
      filmPass.enabled = true;
      filmPass.uniforms.intensity.value = 0.3;
    } else if (preset === "toon" || preset === "comic") {
      outlinePass.enabled = true;
      outlinePass.edgeStrength = preset === "comic" ? 3.4 : 2.4;
      outlinePass.edgeThickness = preset === "comic" ? 1.8 : 1.4;
    } else if (preset === "whimsical") {
      pixelPass.enabled = true;
      pixelPass.setPixelSize(2);
      bloomPass.enabled = true;
      bloomPass.strength = 0.34; bloomPass.radius = 0.62; bloomPass.threshold = 0.6;
      outlinePass.enabled = true;
    }
  }

  const CSS_FILTER_PRESETS = {
    none: "",
    soft: "blur(0.4px) brightness(1.05)",
    cinematic: "contrast(1.12) saturate(1.08)",
    noir: "grayscale(1) contrast(1.2)",
    vivid: "saturate(1.5)",
    haunted: "hue-rotate(210deg) contrast(1.15) brightness(0.85)",
    surveillance: "grayscale(0.8) brightness(1.1) contrast(1.05)",
    crystal: "saturate(1.25) brightness(1.08)",
    whimsical: "saturate(1.3) brightness(1.05)",
    toon: "saturate(1.4) contrast(1.1)",
    anime: "saturate(1.35) contrast(1.08) brightness(1.03)"
  };

  function applyFilterPreset(name = "none") {
    canvas.style.filter = CSS_FILTER_PRESETS[String(name || "none").trim().toLowerCase()] || "";
  }

  function animate() {
    state.animId = requestAnimationFrame(animate);
    state.timer.update();
    const delta = state.timer.getDelta();
    state.mixer?.update(delta);
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

  return { state, resize, playClip, loadModel, applyRoomTextures, loadProps, applyEffectPreset, applyFilterPreset, animate, dispose, renderFrame };
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
    await sceneCtl.applyRoomTextures(config.roomTextures || {});
    await sceneCtl.loadProps(config.propSlots || {});
    const reactionConfig = {
      emotionToClip: config.reactionClips?.paths || {},
      talkingClips: config.reactionClips?.talkingClips || [],
      idleClip: config.reactionClips?.idleClip || ""
    };
    const result = await sceneCtl.loadModel(config.characterModelPath || "", reactionConfig);
    return result;
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
        const clip = state.sceneConfig?.reactionClips?.paths?.[result.emotion] || "";
        if (clip) sceneCtl.playClip(clip);
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
