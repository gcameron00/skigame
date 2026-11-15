/*
 * Slalom mini-game — three.js edition.
 *
 * Same game as the original 2D canvas version: the skier heads down the
 * piste, gates come towards them, steer left/right to pass between the
 * inner poles. Gates cleared and missed are counted; there is no end and
 * no score to chase.
 *
 * three.js (r170) is vendored in ./vendor/three and is only fetched once
 * the game scrolls near the viewport, so the coming-soon message stays
 * light. If WebGL is unavailable the original 2D game (slalom-2d.js) is
 * loaded instead.
 *
 * The whole course sits in a `world` group tilted by SLOPE while the camera
 * and sky stay level, so the piste visibly falls away towards the valley.
 */

import { createAudio } from "./slalom-audio.js";

const $ = (id) => document.getElementById(id);

const canvas = $("slalom-canvas");
if (canvas) boot();

/* ------------------------------------------------------------------ */
/* Boot / fallback                                                     */
/* ------------------------------------------------------------------ */

async function boot() {
  const ui = {
    canvas,
    viewport: canvas.parentElement,
    startBtn: $("slalom-start"),
    pauseBtn: $("slalom-pause"),
    clearedEl: $("slalom-cleared"),
    missedEl: $("slalom-missed"),
    speedEl: $("slalom-speed"),
    speedWrap: $("slalom-speed-wrap"),
    overlay: $("slalom-overlay"),
    soundBtn: $("slalom-sound"),
  };

  setOverlay(ui, "Loading…");
  if (ui.startBtn) ui.startBtn.disabled = true;

  await nearViewport(canvas);

  let THREE;
  let renderer;
  try {
    THREE = await import("./vendor/three/three.module.js");
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch (err) {
    console.warn("Slalom: WebGL unavailable, using 2D version.", err);
    fallbackTo2D(ui);
    return;
  }

  createGame(THREE, renderer, ui);
}

function nearViewport(el) {
  return new Promise((resolve) => {
    if (!("IntersectionObserver" in window)) return resolve();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin: "300px 0px" }
    );
    io.observe(el);
  });
}

function fallbackTo2D(ui) {
  setOverlay(ui, null);
  if (ui.speedWrap) ui.speedWrap.hidden = true;
  if (ui.soundBtn) ui.soundBtn.hidden = true;
  if (ui.startBtn) ui.startBtn.disabled = false;
  const s = document.createElement("script");
  s.src = new URL("./slalom-2d.js", import.meta.url).href;
  document.body.appendChild(s);
}

function setOverlay(ui, text) {
  if (!ui.overlay) return;
  if (text) {
    ui.overlay.textContent = text;
    ui.overlay.hidden = false;
  } else {
    ui.overlay.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Game                                                                */
/* ------------------------------------------------------------------ */

function createGame(THREE, renderer, ui) {
  // ---- Tuning (units are roughly metres and seconds) ----
  const PISTE_HALF = 8; // half-width of the groomed piste
  const SKIER_LIMIT = PISTE_HALF - 0.45;
  const GATE_GAP_MIN = 3.6;
  const GATE_GAP_MAX = 5.0;
  const GATE_TIME_MIN = 1.15; // seconds between gates at current speed
  const GATE_TIME_MAX = 1.6;
  const SPEED_START = 15; // ≈ 54 km/h
  const SPEED_MAX = 24; // ≈ 86 km/h
  const SPEED_STEP = 0.3; // gained per gate cleared
  const SPEED_PENALTY = 2.5; // lost per gate missed
  const LAT_ACCEL = 40;
  const LAT_MAX = 9.5;
  const LAT_DAMPING = 9;
  const SPAWN_AHEAD = 150;
  const SCENERY_SPAN = 240;
  const SLOPE = 0.26; // ≈ 15° pitch of the piste

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");

  const audio = createAudio(canvas.closest(".game") || document);

  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const damp = (k, dt) => 1 - Math.exp(-k * dt);

  // ---- Renderer / scene ----
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 2 / 3, 0.3, 1100);
  const BASE_FOV = 56;

  // Everything on the piste lives in `world`, tilted downhill (ahead = −Z = lower).
  const world = new THREE.Group();
  world.rotation.x = -SLOPE;
  scene.add(world);
  world.updateMatrixWorld(true);

  const hemi = new THREE.HemisphereLight(0xdbe8ff, 0xffffff, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xe8f1ff, 40, 135);

  const palettes = {
    day: {
      skyTop: "#5d9be8",
      skyHorizon: "#e6f0ff",
      fog: 0xe6f0ff,
      hemiSky: 0xd6e6ff,
      hemiGround: 0xffffff,
      hemiI: 1.25,
      sun: 0xfff6e8,
      sunI: 2.1,
      mountain: 0xaabfdc,
      snowcap: 0xf2f6fd,
    },
    dusk: {
      skyTop: "#0b1430",
      skyHorizon: "#4a4f8a",
      fog: 0x2b3466,
      hemiSky: 0x8ea2ff,
      hemiGround: 0x2b3466,
      hemiI: 0.9,
      sun: 0xffc9a8,
      sunI: 1.4,
      mountain: 0x3d4880,
      snowcap: 0x9eaadb,
    },
  };

  // ---- Shared textures ----
  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Sky dome that follows the camera: level horizon, valley haze below it.
  const skyGeo = new THREE.SphereGeometry(1000, 32, 24);
  skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  function paintSky(p) {
    const top = new THREE.Color(p.skyTop);
    const hor = new THREE.Color(p.skyHorizon);
    const haze = new THREE.Color(p.fog);
    const pos = skyGeo.attributes.position;
    const col = skyGeo.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1000;
      if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.55));
      else c.copy(hor).lerp(haze, Math.min(1, -y * 10));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  function applyPalette() {
    const p = darkScheme.matches ? palettes.dusk : palettes.day;
    paintSky(p);
    scene.fog.color.set(p.fog);
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemiI;
    sun.color.set(p.sun);
    sun.intensity = p.sunI;
    paintMountains(p);
    requestRender();
  }

  // ---- Ground: groomed piste with corduroy, softer powder either side ----
  const GROUND_W = 90;
  const TILE_LEN = 20;
  const GROUND_TILES = 14;
  const groundTex = canvasTexture(1024, 256, (g, w, h) => {
    const toPx = (x) => ((x + GROUND_W / 2) / GROUND_W) * w;
    g.fillStyle = "#eef3fb";
    g.fillRect(0, 0, w, h);
    // powder speckle
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(190,205,230,0.35)" : "rgba(255,255,255,0.8)";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // piste band
    const l = toPx(-PISTE_HALF - 0.6);
    const r = toPx(PISTE_HALF + 0.6);
    const band = g.createLinearGradient(l, 0, r, 0);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.04, "#fbfdff");
    band.addColorStop(0.96, "#fbfdff");
    band.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = band;
    g.fillRect(l, 0, r - l, h);
    // corduroy
    for (let x = toPx(-PISTE_HALF); x < toPx(PISTE_HALF); x += 3) {
      g.fillStyle = "rgba(170,190,220,0.14)";
      g.fillRect(x, 0, 1, h);
    }
    // groomer seams
    for (let x = -PISTE_HALF; x <= PISTE_HALF; x += 4) {
      g.fillStyle = "rgba(150,170,205,0.25)";
      g.fillRect(toPx(x), 0, 2, h);
    }
  });
  groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(1, GROUND_TILES);
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_W, TILE_LEN * GROUND_TILES),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  // ---- Mountains across the valley (kept at "infinity" by following the camera) ----
  // Bases sit a few degrees below the horizon and fade into the valley haze;
  // peaks rise a few degrees above it. Between them and the end of the piste
  // is open haze, which is what makes the slope read as dropping away.
  const mountainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
  const mountains = new THREE.Group();
  const mountainGeos = [];
  [
    // [x, z, base below horizon, peak above horizon, radius]
    [-330, -820, 70, 60, 190],
    [-140, -880, 75, 85, 230],
    [60, -900, 75, 70, 210],
    [250, -860, 72, 92, 240],
    [440, -800, 68, 58, 190],
    [-520, -740, 64, 48, 170],
    [-20, -760, 66, 40, 150],
  ].forEach(([x, z, below, above, r], i) => {
    const h = below + above;
    const geo = new THREE.ConeGeometry(r, h, 6 + (i % 3), 6);
    // roughen the flanks so they aren't perfect cones
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y > h / 2 - 1) continue; // keep the apex sharp
      const j = 1 + (Math.sin(k * 12.9898 + i * 78.233) * 0.5) * 0.18;
      pos.setX(k, pos.getX(k) * j);
      pos.setZ(k, pos.getZ(k) * j);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    geo.userData.h = h;
    mountainGeos.push(geo);
    const m = new THREE.Mesh(geo, mountainMat);
    m.position.set(x, h / 2 - below, z);
    m.rotation.y = i * 1.3;
    mountains.add(m);
  });
  scene.add(mountains);

  function paintMountains(p) {
    const haze = new THREE.Color(p.fog);
    const rock = new THREE.Color(p.mountain);
    const snow = new THREE.Color(p.snowcap);
    const c = new THREE.Color();
    for (const geo of mountainGeos) {
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      const h = geo.userData.h;
      for (let k = 0; k < pos.count; k++) {
        const t = pos.getY(k) / h + 0.5; // 0 at the base, 1 at the peak
        if (t > 0.72) c.copy(snow);
        else c.copy(haze).lerp(rock, Math.pow(t / 0.72, 0.8));
        col.setXYZ(k, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
  }

  // ---- Trees (instanced) ----
  const TREE_COUNT = 110;
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6).translate(0, 0.4, 0);
  const lowerGeo = new THREE.ConeGeometry(1.2, 2.2, 7).translate(0, 1.6, 0);
  const upperGeo = new THREE.ConeGeometry(0.85, 1.8, 7).translate(0, 2.7, 0);
  const capGeo = new THREE.ConeGeometry(0.42, 0.75, 7).translate(0, 3.35, 0);
  const treeParts = [
    [trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5b3a24, flatShading: true })],
    [lowerGeo, new THREE.MeshLambertMaterial({ color: 0x1f5a3d, flatShading: true })],
    [upperGeo, new THREE.MeshLambertMaterial({ color: 0x2b6e4a, flatShading: true })],
    [capGeo, new THREE.MeshLambertMaterial({ color: 0xf8fbff, flatShading: true })],
  ].map(([geo, mat]) => {
    const m = new THREE.InstancedMesh(geo, mat, TREE_COUNT);
    m.castShadow = true;
    m.frustumCulled = false;
    world.add(m);
    return m;
  });
  const trees = [];
  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function placeTree(i, z) {
    const side = i % 2 ? 1 : -1;
    const t = trees[i] || (trees[i] = {});
    t.x = side * (PISTE_HALF + 2 + Math.pow(Math.random(), 1.6) * 26);
    t.z = z;
    const s = rand(0.75, 1.5);
    tmpPos.set(t.x, 0, t.z);
    tmpQuat.setFromAxisAngle(up, rand(0, Math.PI * 2));
    tmpScale.set(s, s * rand(0.9, 1.25), s);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    for (const part of treeParts) part.setMatrixAt(i, tmpMatrix);
  }

  // ---- Piste edge markers (instanced) ----
  const MARKER_GAP = 12;
  const MARKER_ROWS = Math.ceil(SCENERY_SPAN / MARKER_GAP);
  const markerMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6).translate(0, 0.65, 0),
    new THREE.MeshLambertMaterial({ color: 0xf97316 }),
    MARKER_ROWS * 2
  );
  markerMesh.castShadow = true;
  markerMesh.frustumCulled = false;
  world.add(markerMesh);
  const markers = [];
  function placeMarker(i, z) {
    const m = markers[i] || (markers[i] = {});
    m.x = (i % 2 ? 1 : -1) * (PISTE_HALF + 0.7);
    m.z = z;
    tmpMatrix.makeTranslation(m.x, 0, m.z);
    markerMesh.setMatrixAt(i, tmpMatrix);
  }

  function seedScenery(z0) {
    for (let i = 0; i < TREE_COUNT; i++) placeTree(i, z0 + 20 - (i / TREE_COUNT) * SCENERY_SPAN + rand(-2, 2));
    for (let i = 0; i < MARKER_ROWS * 2; i++) placeMarker(i, z0 + 20 - Math.floor(i / 2) * MARKER_GAP);
    treeParts.forEach((p) => (p.instanceMatrix.needsUpdate = true));
    markerMesh.instanceMatrix.needsUpdate = true;
  }

  function recycleScenery(camZ) {
    let treesMoved = false;
    for (let i = 0; i < TREE_COUNT; i++) {
      if (trees[i].z > camZ + 12) {
        placeTree(i, trees[i].z - SCENERY_SPAN);
        treesMoved = true;
      }
    }
    if (treesMoved) treeParts.forEach((p) => (p.instanceMatrix.needsUpdate = true));
    let markersMoved = false;
    for (let i = 0; i < markers.length; i++) {
      if (markers[i].z > camZ + 12) {
        placeMarker(i, markers[i].z - MARKER_ROWS * MARKER_GAP);
        markersMoved = true;
      }
    }
    if (markersMoved) markerMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- Skier ----
  const suitMat = new THREE.MeshLambertMaterial({ color: 0x2563eb, flatShading: true });
  const SUIT_COLOR = new THREE.Color(0x2563eb);
  const HIT_COLOR = new THREE.Color(0xf97316);
  const skier = buildSkier();
  world.add(skier.root);

  function limb(from, to, radius, mat, capsule) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = capsule
      ? new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 4, 8)
      : new THREE.CylinderGeometry(radius, radius, len, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    mesh.castShadow = true;
    return mesh;
  }

  function buildSkier() {
    const root = new THREE.Group(); // at the feet, facing -Z
    const body = new THREE.Group(); // everything above the boots (bobs)
    root.add(body);

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x0f172a, flatShading: true });
    const skiMat = new THREE.MeshLambertMaterial({ color: 0xdc2626, flatShading: true });
    const helmetMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc, flatShading: true });
    const goggleMat = new THREE.MeshLambertMaterial({ color: 0xfbbf24, emissive: 0x7c4a03, flatShading: true });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

    for (const sx of [-0.14, 0.14]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 1.75), skiMat);
      ski.position.set(sx, 0.02, -0.15);
      ski.castShadow = true;
      root.add(ski);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.22), skiMat);
      tip.position.set(sx, 0.07, -1.1);
      tip.rotation.x = 0.45;
      root.add(tip);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 0.3), darkMat);
      boot.position.set(sx, 0.14, 0);
      boot.castShadow = true;
      root.add(boot);

      // legs: ankle → knee → hip (knees well bent, racing stance)
      body.add(limb(V(sx, 0.22, 0), V(sx * 0.95, 0.6, -0.22), 0.075, suitMat));
      body.add(limb(V(sx * 0.95, 0.6, -0.22), V(sx * 0.8, 0.92, 0.08), 0.09, suitMat));
    }

    // torso, leaning forward
    body.add(limb(V(0, 0.92, 0.08), V(0, 1.34, -0.24), 0.17, suitMat, true));
    // white bib panel on the chest
    const bib = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.24, 0.02),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    bib.position.set(0, 1.12, -0.24);
    bib.rotation.x = -0.65;
    body.add(bib);

    // head + helmet + goggles
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), helmetMat);
    head.position.set(0, 1.55, -0.36);
    head.castShadow = true;
    body.add(head);
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.05), goggleMat);
    goggles.position.set(0, 1.55, -0.49);
    body.add(goggles);

    // arms: shoulder → elbow → hand, then poles tucked back
    for (const sx of [-1, 1]) {
      const sh = V(sx * 0.2, 1.3, -0.2);
      const el = V(sx * 0.3, 1.05, -0.42);
      const ha = V(sx * 0.24, 1.0, -0.62);
      body.add(limb(sh, el, 0.06, suitMat));
      body.add(limb(el, ha, 0.055, suitMat));
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), darkMat);
      glove.position.copy(ha);
      body.add(glove);
      const tipPos = V(sx * 0.36, 0.25, 0.5);
      body.add(limb(ha, tipPos, 0.015, poleMat));
    }

    return { root, body };
  }

  // ---- Gates ----
  const GATE_COLORS = [0xdc2626, 0x2563eb];
  const gateKits = GATE_COLORS.map((color) => {
    const hex = "#" + color.toString(16).padStart(6, "0");
    const tex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = hex;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(0, h * 0.62, w, h * 0.1);
    });
    return {
      color,
      pole: new THREE.MeshLambertMaterial({ color }),
      panel: new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }),
    };
  });
  const poleGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.85, 6).translate(0, 0.925, 0);
  const panelGeo = new THREE.PlaneGeometry(0.85, 0.72).translate(0, 1.2, 0);

  const gates = [];
  const gatePool = [];
  let gateColorIdx = 0;
  let lastGateZ = 0;
  let lastGateSide = 1;

  function buildGateSide(kit) {
    const side = new THREE.Group(); // pivot at the base, between its two poles
    for (const px of [-0.425, 0.425]) {
      const p = new THREE.Mesh(poleGeo, kit.pole);
      p.position.x = px;
      p.castShadow = true;
      side.add(p);
    }
    const panel = new THREE.Mesh(panelGeo, kit.panel);
    panel.castShadow = true;
    side.add(panel);
    side.userData = { ang: 0, vel: 0, out: 1 };
    return side;
  }

  function spawnGate(z) {
    const kitIdx = gateColorIdx++ % 2;
    let g = gatePool.findIndex((p) => p.kitIdx === kitIdx);
    g = g >= 0 ? gatePool.splice(g, 1)[0] : null;
    if (!g) {
      const kit = gateKits[kitIdx];
      const group = new THREE.Group();
      const left = buildGateSide(kit);
      const right = buildGateSide(kit);
      left.userData.out = -1;
      right.userData.out = 1;
      group.add(left, right);
      g = { group, left, right, kitIdx };
    }
    const gap = rand(GATE_GAP_MIN, GATE_GAP_MAX);
    const limit = PISTE_HALF - gap / 2 - 0.9;
    lastGateSide = Math.random() < 0.85 ? -lastGateSide : lastGateSide;
    g.cx = clamp(lastGateSide * rand(0.6, 5), -limit, limit);
    g.gap = gap;
    g.z = z;
    g.scored = false;
    g.left.position.x = -(gap / 2 + 0.425);
    g.right.position.x = gap / 2 + 0.425;
    for (const s of [g.left, g.right]) {
      s.userData.ang = 0;
      s.userData.vel = 0;
      s.rotation.set(0, 0, 0);
    }
    g.group.position.set(g.cx, 0, z);
    world.add(g.group);
    gates.push(g);
    lastGateZ = z;
  }

  function knock(side, strength) {
    side.userData.vel += strength;
    return true;
  }

  function updateGateSprings(dt) {
    for (const g of gates) {
      for (const s of [g.left, g.right]) {
        const u = s.userData;
        if (u.ang === 0 && u.vel === 0) continue;
        u.vel += (-70 * u.ang - 7 * u.vel) * dt;
        u.ang += u.vel * dt;
        if (Math.abs(u.ang) < 1e-4 && Math.abs(u.vel) < 1e-3) u.ang = u.vel = 0;
        s.rotation.x = u.ang; // tips downhill
        s.rotation.z = -u.out * u.ang * 0.35; // and a little outwards
      }
    }
  }

  // ---- Ski tracks (instanced ribbon segments) ----
  const TRACK_COUNT = 900;
  const tracks = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: 0xb7c7e2,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    TRACK_COUNT
  );
  tracks.frustumCulled = false;
  tracks.receiveShadow = true;
  world.add(tracks);
  let trackIdx = 0;
  const lastSkiPos = [new THREE.Vector3(), new THREE.Vector3()];
  let tracksPrimed = false;

  function clearTracks() {
    tmpMatrix.makeScale(0, 0, 0);
    for (let i = 0; i < TRACK_COUNT; i++) tracks.setMatrixAt(i, tmpMatrix);
    tracks.instanceMatrix.needsUpdate = true;
    tracksPrimed = false;
  }

  const skiPos = new THREE.Vector3();
  function layTracks(x, z, yaw) {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (let k = 0; k < 2; k++) {
      const off = k ? 0.14 : -0.14;
      skiPos.set(x + off * cos, 0.015, z - off * sin);
      if (tracksPrimed) {
        const dx = skiPos.x - lastSkiPos[k].x;
        const dz = skiPos.z - lastSkiPos[k].z;
        const len = Math.hypot(dx, dz);
        tmpPos.set((skiPos.x + lastSkiPos[k].x) / 2, 0.015, (skiPos.z + lastSkiPos[k].z) / 2);
        tmpQuat.setFromAxisAngle(up, Math.atan2(dx, dz));
        tmpScale.set(0.09, 1, len + 0.02);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        tracks.setMatrixAt(trackIdx, tmpMatrix);
        trackIdx = (trackIdx + 1) % TRACK_COUNT;
      }
      lastSkiPos[k].copy(skiPos);
    }
    tracksPrimed = true;
    tracks.instanceMatrix.needsUpdate = true;
  }

  // ---- Particles: snow spray + gate sparkles ----
  function dotTexture() {
    return canvasTexture(32, 32, (g, w) => {
      const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.7)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, w);
    });
  }
  const dot = dotTexture();

  const SPRAY_MAX = 320;
  const sprayPos = new Float32Array(SPRAY_MAX * 3);
  const sprayCol = new Float32Array(SPRAY_MAX * 3);
  const sprayVel = new Float32Array(SPRAY_MAX * 3);
  const sprayLife = new Float32Array(SPRAY_MAX);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
  sprayGeo.setAttribute("color", new THREE.BufferAttribute(sprayCol, 3));
  const spray = new THREE.Points(
    sprayGeo,
    new THREE.PointsMaterial({
      size: 0.2,
      map: dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    })
  );
  spray.frustumCulled = false;
  world.add(spray);
  let sprayNext = 0;
  const tmpColor = new THREE.Color();

  function emit(x, y, z, vx, vy, vz, color, life) {
    const i = sprayNext;
    sprayNext = (sprayNext + 1) % SPRAY_MAX;
    sprayPos.set([x, y, z], i * 3);
    sprayVel.set([vx, vy, vz], i * 3);
    tmpColor.set(color);
    sprayCol.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
    sprayLife[i] = life;
  }

  function updateSpray(dt) {
    for (let i = 0; i < SPRAY_MAX; i++) {
      if (sprayLife[i] <= 0) continue;
      sprayLife[i] -= dt;
      const j = i * 3;
      sprayVel[j + 1] -= 9 * dt;
      sprayPos[j] += sprayVel[j] * dt;
      sprayPos[j + 1] += sprayVel[j + 1] * dt;
      sprayPos[j + 2] += sprayVel[j + 2] * dt;
      if (sprayLife[i] <= 0 || sprayPos[j + 1] < 0) {
        sprayLife[i] = 0;
        sprayPos[j + 1] = -50; // park it out of sight
      }
    }
    sprayGeo.attributes.position.needsUpdate = true;
    sprayGeo.attributes.color.needsUpdate = true;
  }
  for (let i = 0; i < SPRAY_MAX; i++) sprayPos[i * 3 + 1] = -50;

  // ---- Falling snow ----
  const FLAKES = reducedMotion.matches ? 220 : 650;
  const BOX = { w: 44, h: 20, d: 60 };
  const flakePos = new Float32Array(FLAKES * 3);
  const flakeSpd = new Float32Array(FLAKES);
  for (let i = 0; i < FLAKES; i++) {
    flakePos[i * 3] = rand(-BOX.w / 2, BOX.w / 2);
    flakePos[i * 3 + 1] = rand(-BOX.h / 2, BOX.h / 2);
    flakePos[i * 3 + 2] = rand(-BOX.d, 10);
    flakeSpd[i] = rand(0.8, 2);
  }
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute("position", new THREE.BufferAttribute(flakePos, 3));
  const flakes = new THREE.Points(
    flakeGeo,
    new THREE.PointsMaterial({
      size: 0.14,
      map: dot,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    })
  );
  flakes.frustumCulled = false;
  scene.add(flakes);
  let windT = 0;

  function updateSnow(dt) {
    windT += dt;
    const wind = Math.sin(windT * 0.4) * 0.6;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < FLAKES; i++) {
      const j = i * 3;
      flakePos[j] += (wind + Math.sin(windT * 1.3 + i) * 0.3) * dt;
      flakePos[j + 1] -= flakeSpd[i] * dt;
      if (flakePos[j + 1] < cy - BOX.h / 2) flakePos[j + 1] += BOX.h;
      if (flakePos[j + 1] > cy + BOX.h / 2) flakePos[j + 1] -= BOX.h;
      // keep the flakes in a box that travels with the camera
      if (flakePos[j + 2] > cz + 10) flakePos[j + 2] -= BOX.d + 10;
      if (flakePos[j + 2] < cz - BOX.d) flakePos[j + 2] += BOX.d + 10;
      if (flakePos[j] > cx + BOX.w / 2) flakePos[j] -= BOX.w;
      if (flakePos[j] < cx - BOX.w / 2) flakePos[j] += BOX.w;
    }
    flakeGeo.attributes.position.needsUpdate = true;
  }

  // ---- Game state ----
  const state = {
    running: false,
    paused: false,
    x: 0,
    z: 0,
    vx: 0,
    ax: 0,
    lean: 0,
    yaw: 0,
    speed: SPEED_START,
    targetSpeed: SPEED_START,
    inputLeft: false,
    inputRight: false,
    pointerActive: false,
    pointerX: 0,
    cleared: 0,
    missed: 0,
    streak: 0,
    carve: 0,
    hitTimer: 0,
    shake: 0,
    lastTrackZ: 0,
    speedShown: -1,
    speedTimer: 0,
    idleT: 0,
  };

  function reset() {
    for (const g of gates) {
      world.remove(g.group);
      gatePool.push(g);
    }
    gates.length = 0;
    gateColorIdx = 0;
    Object.assign(state, {
      x: 0,
      z: 0,
      vx: 0,
      ax: 0,
      lean: 0,
      yaw: 0,
      speed: SPEED_START,
      targetSpeed: SPEED_START,
      cleared: 0,
      missed: 0,
      streak: 0,
      carve: 0,
      hitTimer: 0,
      shake: 0,
      lastTrackZ: 0,
    });
    lastGateZ = -45 + 0;
    spawnGate(-45);
    while (lastGateZ > -SPAWN_AHEAD) spawnGate(lastGateZ - gateSpacing());
    clearTracks();
    seedScenery(0);
    placeCamera(true);
    updateHud(true);
  }

  function gateSpacing() {
    return state.targetSpeed * rand(GATE_TIME_MIN, GATE_TIME_MAX);
  }

  function updateHud(force) {
    if (ui.clearedEl) ui.clearedEl.textContent = String(state.cleared);
    if (ui.missedEl) ui.missedEl.textContent = String(state.missed);
    const kmh = state.running ? Math.round(state.speed * 3.6) : 0;
    if (ui.speedEl && (force || kmh !== state.speedShown)) {
      ui.speedEl.textContent = String(kmh);
      state.speedShown = kmh;
    }
  }

  // ---- Simulation ----
  function step(dt) {
    // Steering input → lateral acceleration (same feel as the 2D version)
    let ax = 0;
    if (state.pointerActive) {
      const dx = state.pointerX - state.x;
      if (Math.abs(dx) > 0.05) ax = Math.sign(dx) * LAT_ACCEL * Math.min(1, Math.abs(dx) / 2.5);
    } else {
      const dir = (state.inputRight ? 1 : 0) - (state.inputLeft ? 1 : 0);
      ax = dir * LAT_ACCEL;
    }
    state.ax = ax;
    if (ax) state.vx += ax * dt;
    else state.vx *= Math.exp(-LAT_DAMPING * dt);
    state.vx = clamp(state.vx, -LAT_MAX, LAT_MAX);
    state.x += state.vx * dt;
    if (Math.abs(state.x) > SKIER_LIMIT) {
      if (Math.abs(state.vx) > 3) audio.play("edge");
      state.x = Math.sign(state.x) * SKIER_LIMIT;
      state.vx = 0;
    }

    state.speed += (state.targetSpeed - state.speed) * damp(1.5, dt);
    const prevZ = state.z;
    state.z -= state.speed * dt;

    // Judge gates as the skier crosses their line
    for (let i = gates.length - 1; i >= 0; i--) {
      const g = gates[i];
      if (!g.scored && prevZ > g.z && state.z <= g.z) {
        g.scored = true;
        const t = (prevZ - g.z) / (prevZ - state.z);
        const xAt = state.x - state.vx * dt * (1 - t);
        const half = g.gap / 2;
        const kit = gateKits[g.kitIdx];
        // brushing an inner pole knocks it (whether or not the gate counts)
        let knocked = false;
        if (Math.abs(xAt - (g.cx - half)) < 0.5) knocked = knock(g.left, 7);
        if (Math.abs(xAt - (g.cx + half)) < 0.5) knocked = knock(g.right, 7);
        if (knocked) audio.play("pole");
        if (Math.abs(xAt - g.cx) <= half) {
          state.cleared++;
          audio.play("gate", state.streak++);
          state.targetSpeed = Math.min(SPEED_MAX, state.targetSpeed + SPEED_STEP);
          for (let k = 0; k < 26; k++) {
            const s = k % 2 ? 1 : -1;
            emit(g.cx + s * half, rand(0.4, 1.8), g.z, s * rand(0.5, 2), rand(1, 4), -state.speed * rand(0.4, 0.8), kit.color, 0.9);
          }
        } else {
          state.missed++;
          state.streak = 0;
          audio.play("miss");
          state.targetSpeed = Math.max(SPEED_START, state.targetSpeed - SPEED_PENALTY);
          state.hitTimer = 0.45;
          if (!reducedMotion.matches) state.shake = 0.35;
          flashMiss();
        }
        updateHud();
      }
      if (g.z > state.z + 14) {
        world.remove(g.group);
        gates.splice(i, 1);
        gatePool.push(g);
      }
    }
    while (lastGateZ > state.z - SPAWN_AHEAD) spawnGate(lastGateZ - gateSpacing());

    // Pose: lean into the turn, skis point along the direction of travel
    const steer = ax / LAT_ACCEL;
    state.lean += (-steer * 0.28 - (state.vx / LAT_MAX) * 0.1 - state.lean) * damp(8, dt);
    state.yaw += (-Math.atan2(state.vx, state.speed) * 1.3 - state.yaw) * damp(10, dt);

    // Snow spray from the ski tails when carving
    const carve = Math.abs(steer) * (0.4 + Math.abs(state.vx) / LAT_MAX);
    state.carve = Math.min(1, carve);
    if (carve > 0.15) {
      const n = Math.ceil(carve * 3);
      const outward = -Math.sign(state.vx || steer);
      for (let k = 0; k < n; k++) {
        emit(
          state.x + rand(-0.2, 0.2),
          0.08,
          state.z + 0.35,
          outward * rand(1.5, 4) + state.vx * 0.3,
          rand(1, 3),
          -state.speed * rand(0.6, 0.9),
          0xffffff,
          0.6
        );
      }
    }

    // Tracks
    if (state.lastTrackZ - state.z > 0.4) {
      layTracks(state.x, state.z, state.yaw);
      state.lastTrackZ = state.z;
    }

    if (state.hitTimer > 0) state.hitTimer -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);

    state.speedTimer += dt;
    if (state.speedTimer > 0.2) {
      state.speedTimer = 0;
      updateHud();
    }
  }

  function poseSkier(dt) {
    const r = skier.root;
    r.position.set(state.x, 0, state.z);
    r.rotation.set(0, state.yaw, state.lean, "YXZ");
    if (state.running && !state.paused) {
      state.idleT += dt;
      skier.body.position.y = Math.sin(state.idleT * 9) * 0.015 - Math.abs(state.lean) * 0.12;
    }
    suitMat.color.copy(state.hitTimer > 0 && Math.floor(state.hitTimer * 14) % 2 === 0 ? HIT_COLOR : SUIT_COLOR);
  }

  // ---- Camera ----
  const camTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const camLocal = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lookWorld = new THREE.Vector3();
  const skierWorld = new THREE.Vector3();

  function placeCamera(snap, dt = 0) {
    camTarget.set(state.x * 0.7, 4.2, state.z + 8.4);
    lookTarget.set(state.x * 0.8, 2.4, state.z - 22);
    if (!state.running && !reducedMotion.matches) {
      // gentle drift while waiting to start
      camTarget.x += Math.sin(state.idleT * 0.5) * 1.2;
      camTarget.y += Math.sin(state.idleT * 0.35) * 0.3;
    }
    if (snap) {
      camLocal.copy(camTarget);
      look.copy(lookTarget);
    } else {
      camLocal.lerp(camTarget, damp(6, dt));
      camLocal.z = camTarget.z; // never lag behind down the hill
      look.lerp(lookTarget, damp(8, dt));
    }
    camera.position.copy(camLocal);
    world.localToWorld(camera.position);
    camera.lookAt(world.localToWorld(lookWorld.copy(look)));

    // widen the view a touch as speed builds
    const fov = BASE_FOV + (state.running ? ((state.speed - SPEED_START) / (SPEED_MAX - SPEED_START)) * 9 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (state.shake > 0) {
      const s = state.shake * 0.25;
      camera.position.x += rand(-s, s);
      camera.position.y += rand(-s, s);
    }

    // things that travel with the camera
    mountains.position.set(camera.position.x * 0.9, camera.position.y, camera.position.z);
    sky.position.copy(camera.position);
    ground.position.set(0, 0, Math.round(state.z / TILE_LEN) * TILE_LEN - 100);
    world.localToWorld(skierWorld.set(state.x, 0, state.z - 8));
    sun.target.position.copy(skierWorld);
    sun.position.set(skierWorld.x - 8, skierWorld.y + 18, skierWorld.z + 4);
    recycleScenery(camLocal.z);
  }

  // ---- Main loop ----
  let visible = true;
  let rafId = 0;
  let lastTs = 0;
  let needsRender = true;

  function requestRender() {
    needsRender = true;
    kick();
  }

  function kick() {
    if (!rafId && visible && !document.hidden) {
      lastTs = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  function frame(ts) {
    rafId = 0;
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;

    const live = state.running && !state.paused;
    if (live) step(dt);
    if (!state.paused) {
      if (!state.running) state.idleT += dt;
      updateSpray(dt);
      updateSnow(dt);
      updateGateSprings(dt);
    }
    poseSkier(dt);
    placeCamera(false, dt);
    audio.setMotion(
      live,
      (state.speed - SPEED_START) / (SPEED_MAX - SPEED_START),
      live ? state.carve : 0
    );
    renderer.render(scene, camera);
    needsRender = false;

    // keep animating unless paused (idle screen keeps the snow falling)
    if (!state.paused && visible && !document.hidden) {
      rafId = requestAnimationFrame(frame);
    }
  }

  // ---- Sizing ----
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) kick();
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.running && !state.paused) togglePause();
    else kick();
  });

  // ---- Controls ----
  function start() {
    if (state.running && !state.paused) return;
    audio.unlock();
    if (!state.running) {
      reset();
      state.running = true;
      audio.play("start");
    } else {
      audio.play("click");
    }
    state.paused = false;
    setOverlay(ui, null);
    if (ui.startBtn) ui.startBtn.disabled = true;
    if (ui.pauseBtn) {
      ui.pauseBtn.disabled = false;
      ui.pauseBtn.textContent = "Pause";
    }
    kick();
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    if (ui.pauseBtn) ui.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    setOverlay(ui, state.paused ? "Paused" : null);
    state.inputLeft = state.inputRight = false;
    if (state.paused) audio.setMotion(false, 0, 0);
    audio.play("click");
    if (!state.paused) kick();
    else requestRender();
  }

  let flashTimer = 0;
  function flashMiss() {
    const v = ui.viewport;
    if (!v) return;
    v.classList.remove("is-miss");
    void v.offsetWidth; // restart the CSS animation
    v.classList.add("is-miss");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => v.classList.remove("is-miss"), 500);
  }

  const LEFT_KEYS = ["ArrowLeft", "a", "A"];
  const RIGHT_KEYS = ["ArrowRight", "d", "D"];
  function syncSoundBtn() {
    if (!ui.soundBtn) return;
    ui.soundBtn.textContent = audio.muted ? "Sound off" : "Sound on";
    ui.soundBtn.setAttribute("aria-pressed", String(!audio.muted));
  }
  function toggleSound() {
    audio.unlock();
    audio.setMuted(!audio.muted);
    syncSoundBtn();
    audio.play("click");
  }
  if (ui.soundBtn) {
    ui.soundBtn.addEventListener("click", toggleSound);
    ui.soundBtn.hidden = false;
    syncSoundBtn();
  }

  document.addEventListener("keydown", (e) => {
    if ((e.key === "m" || e.key === "M") && state.running) {
      toggleSound();
      return;
    }
    if (!state.running) return;
    if (LEFT_KEYS.includes(e.key)) {
      state.inputLeft = true;
      e.preventDefault();
    } else if (RIGHT_KEYS.includes(e.key)) {
      state.inputRight = true;
      e.preventDefault();
    } else if (e.key === " " || e.key === "p" || e.key === "P") {
      togglePause();
      e.preventDefault();
    }
  });
  document.addEventListener("keyup", (e) => {
    if (LEFT_KEYS.includes(e.key)) state.inputLeft = false;
    else if (RIGHT_KEYS.includes(e.key)) state.inputRight = false;
  });

  // Pointer / touch: drag to steer towards the point on the snow
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(world.matrixWorld);
  const hit = new THREE.Vector3();
  function pointerToX(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    // project on to the snow just ahead of the skier
    ndc.y = Math.min(ndc.y, -0.1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      return clamp(world.worldToLocal(hit).x, -SKIER_LIMIT, SKIER_LIMIT);
    }
    return state.x;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!state.running) {
      start();
      return;
    }
    if (state.paused) return;
    state.pointerActive = true;
    state.pointerX = pointerToX(e);
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (state.pointerActive) state.pointerX = pointerToX(e);
  });
  function releasePointer(e) {
    state.pointerActive = false;
    if (e && e.pointerId != null && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  if (ui.startBtn) {
    ui.startBtn.addEventListener("click", start);
    ui.startBtn.disabled = false;
  }
  if (ui.pauseBtn) ui.pauseBtn.addEventListener("click", togglePause);

  if (darkScheme.addEventListener) darkScheme.addEventListener("change", applyPalette);

  // ---- Initial scene ----
  applyPalette();
  reset();
  state.running = false;
  updateHud(true);
  setOverlay(ui, "Press Start");
  resize();
  kick();

  if (new URLSearchParams(location.search).has("debug")) {
    window.__slalom = { state, scene, camera, start, togglePause, audio };
  }
}
