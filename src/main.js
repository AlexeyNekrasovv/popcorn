import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import RAPIER from '@dimforge/rapier3d-compat';

import {
  createKernelGeometry,
  createPopcornGeometry,
  createGlassGeometry,
  GLASS_INNER_R,
  GLASS_INNER_FLOOR,
  GLASS_HEIGHT,
} from './geometry.js';

const KERNEL_COUNT = 24;
const FIXED_DT = 1 / 60;

/* ------------------------------------------------------------------ *
 * Renderer / scene
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap was removed in r186 — PCFShadowMap is the replacement.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0.6, 1.2, 2.45);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.48, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 1.6;
controls.maxDistance = 5.2;
controls.minPolarAngle = 0.3;
controls.maxPolarAngle = 1.76;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.7;
controls.update();

/* ------------------------------------------------------------------ *
 * Post-processing: ambient occlusion
 * Contact darkening in the gaps between kernels and where they meet
 * the glass is what makes the pile read as solid objects instead of
 * floating coins.
 * ------------------------------------------------------------------ */

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));

const gtaoPass = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.blendIntensity = 1.35;
gtaoPass.updateGtaoMaterial({
  radius: 0.22,
  distanceExponent: 1.4,
  thickness: 1.0,
  scale: 1.0,
  samples: 16,
  distanceFallOff: 1.0,
  screenSpaceRadius: false,
});
gtaoPass.updatePdMaterial({
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
  radius: 6,
  radiusExponent: 1,
  rings: 2,
  samples: 16,
});
composer.addPass(gtaoPass);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ *
 * Lighting + environment
 * ------------------------------------------------------------------ */

const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = 0.2;

const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
keyLight.position.set(1.7, 3.3, 1.9);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 9;
keyLight.shadow.camera.left = -1.7;
keyLight.shadow.camera.right = 1.7;
keyLight.shadow.camera.top = 2.2;
keyLight.shadow.camera.bottom = -0.8;
keyLight.shadow.bias = -0.0009;
keyLight.shadow.normalBias = 0.016;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x9dc0ff, 0.35);
fillLight.position.set(-2.8, 1.6, -1.1);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xffcf96, 8, 6, 2);
rimLight.position.set(-1.15, 1.75, -1.55);
scene.add(rimLight);

const rimLight2 = new THREE.PointLight(0x8fb6ff, 5, 5, 2);
rimLight2.position.set(1.5, 1.2, -1.2);
scene.add(rimLight2);

const topLight = new THREE.SpotLight(0xffffff, 3.5, 6, 0.7, 0.6, 1.4);
topLight.position.set(0.5, 3.4, 0.7);
topLight.target.position.set(0, 0.3, 0);
scene.add(topLight, topLight.target);

/* ------------------------------------------------------------------ *
 * Backdrop + table
 * ------------------------------------------------------------------ */

const bgCanvas = document.createElement('canvas');
bgCanvas.width = 256;
bgCanvas.height = 256;
{
  const ctx = bgCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#15120f');
  g.addColorStop(0.55, '#2a231c');
  g.addColorStop(1.0, '#0c0a09');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  // a soft studio highlight behind the subject. The glass refracts it,
  // which is what makes the material read as glass rather than a hole.
  const hx = 176;
  const hy = 96;
  const rg = ctx.createRadialGradient(hx, hy, 2, hx, hy, 150);
  rg.addColorStop(0, 'rgba(255,238,210,0.60)');
  rg.addColorStop(0.35, 'rgba(255,226,188,0.20)');
  rg.addColorStop(1, 'rgba(255,226,188,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 256, 256);
}
const bgTex = new THREE.CanvasTexture(bgCanvas);
bgTex.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTex;

const tableTex = (() => {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#332b23';
  ctx.fillRect(0, 0, size, size);

  // large, low-contrast blotches: reads as a matte stone counter, not gravel
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 60 + Math.random() * 260;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = 8 + Math.random() * 12;
    g.addColorStop(0, `hsla(28, 14%, ${l}%, ${0.05 + Math.random() * 0.07})`);
    g.addColorStop(1, 'hsla(28, 14%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // fine grain, barely visible up close
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
})();

const table = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({
    map: tableTex,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
  })
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

// fake contact shadow, so the glass does not look pasted onto the floor
{
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.06, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.003;
  scene.add(blob);
}

// procedural grain for bump: starch and wax micro-relief, no assets
const bumpTex = (() => {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.8 + Math.random() * 6;
    const up = Math.random() > 0.5 ? 255 : 0;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${up},${up},${up},${0.05 + Math.random() * 0.11})`);
    g.addColorStop(1, `rgba(${up},${up},${up},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
})();

/* ------------------------------------------------------------------ *
 * Glass
 * ------------------------------------------------------------------ */

const glassGeo = createGlassGeometry();
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.02,
  transmission: 1,
  thickness: 0.55,
  ior: 1.52,
  dispersion: 0.45,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  attenuationColor: new THREE.Color(0xe6f3ff),
  attenuationDistance: 2.4,
  specularIntensity: 1,
  envMapIntensity: 1.5,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 1,
});

const glass = new THREE.Mesh(glassGeo, glassMat);
glass.castShadow = false;
glass.receiveShadow = false;
glass.renderOrder = 2;
scene.add(glass);

// The kernels sit on the inside of the glass floor, which is part of the
// transmissive mesh and cannot receive shadows. Without this invisible
// catcher the pile looks like it is hovering.
const shadowCatcher = new THREE.Mesh(
  new THREE.CircleGeometry(GLASS_INNER_R * 0.995, 64),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.45 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = GLASS_INNER_FLOOR + 0.001;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// fake cast shadow of the glass itself, offset away from the key light
{
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const castShadowBlob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  castShadowBlob.rotation.x = -Math.PI / 2;
  castShadowBlob.position.set(-0.22, 0.002, -0.28);
  scene.add(castShadowBlob);
}

/* ------------------------------------------------------------------ *
 * Physics
 * ------------------------------------------------------------------ */

await RAPIER.init();

const world = new RAPIER.World({ x: 0, y: -6.0, z: 0 });
world.timestep = FIXED_DT;

function buildStaticWorld() {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  // table top
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(14, 0.5, 14)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.85)
      .setRestitution(0.08),
    fixed
  );

  // glass floor (thick disc)
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.05, GLASS_INNER_R)
      .setTranslation(0, GLASS_INNER_FLOOR - 0.05, 0)
      .setFriction(0.75)
      .setRestitution(0.18),
    fixed
  );

  // glass wall: a ring of thin boxes. Convex colliders are far more
  // stable than a triangle mesh, and at 40 segments the polygon is
  // indistinguishable from the round glass for a 2 cm kernel.
  const N = 40;
  const wallH = GLASS_HEIGHT - GLASS_INNER_FLOOR;
  const wallT = 0.07;
  const halfLen = GLASS_INNER_R * Math.tan(Math.PI / N) * 1.12;
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    q.setFromAxisAngle(up, Math.PI / 2 - a);

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfLen, wallH / 2, wallT / 2)
        .setTranslation(
          Math.cos(a) * (GLASS_INNER_R + wallT / 2),
          GLASS_INNER_FLOOR + wallH / 2,
          Math.sin(a) * (GLASS_INNER_R + wallT / 2)
        )
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.45)
        .setRestitution(0.32),
      fixed
    );
  }
}

buildStaticWorld();

/* ------------------------------------------------------------------ *
 * Kernels
 * ------------------------------------------------------------------ */

const kernelGeo = createKernelGeometry();
const kernelPositions = kernelGeo.attributes.position.array;

const popcornGeos = Array.from({ length: 5 }, () => createPopcornGeometry());
const popcornHullPoints = popcornGeos.map((g) => g.attributes.position.array);

// kernels are not one uniform colour: real ones vary from pale straw
// to deep amber depending on the variety and how dry they are
const kernelMats = [0xefa92b, 0xd99420, 0xf3bb45, 0xc9851c, 0xe8a336].map(
  (color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.58,
      metalness: 0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.6,
      sheen: 0,
      envMapIntensity: 0.55,
      bumpMap: bumpTex,
      bumpScale: 0.004,
    })
);

const popcornMats = [0xfdf3e1, 0xf7e8cd, 0xfff8ec, 0xf2e0bd].map(
  (color) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.82,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.9,
      sheen: 0.5,
      sheenColor: new THREE.Color(0xffeccb),
      sheenRoughness: 0.7,
      envMapIntensity: 0.6,
      bumpMap: bumpTex,
      bumpScale: 0.03,
    })
);

const kernels = [];
const kernelMeshes = [];
let poppedCount = 0;

const counterEl = document.getElementById('poppedCount');
const totalEl = document.getElementById('totalCount');
totalEl.textContent = String(KERNEL_COUNT);

function randomInDisc(radius) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * radius;
  return { x: Math.cos(a) * d, z: Math.sin(a) * d };
}

function spawnKernels() {
  for (let i = 0; i < KERNEL_COUNT; i++) {
    const spot = randomInDisc(0.38);
    const y = 0.16 + Math.random() * 0.5;

    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      )
    );

    // every kernel gets its own tint: real ones run from pale straw
    // to deep amber, and a uniform colour is the #1 "plastic" tell
    const mat = kernelMats[i % kernelMats.length].clone();
    mat.color.setHSL(
      0.098 + (Math.random() - 0.5) * 0.02,
      0.88 + Math.random() * 0.1,
      0.27 + Math.random() * 0.1
    );
    mat.roughness = 0.52 + Math.random() * 0.2;
    mat.clearcoat = 0.04 + Math.random() * 0.12;

    const mesh = new THREE.Mesh(kernelGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const scale = 0.9 + Math.random() * 0.22;
    mesh.scale.setScalar(scale);
    mesh.position.set(spot.x, y, spot.z);
    mesh.quaternion.copy(quat);
    scene.add(mesh);
    kernelMeshes.push(mesh);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spot.x, y, spot.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinearDamping(0.12)
        .setAngularDamping(0.55)
        .setCcdEnabled(true)
    );

    let desc = RAPIER.ColliderDesc.convexHull(kernelPositions);
    if (!desc) desc = RAPIER.ColliderDesc.ball(0.085);

    const collider = world.createCollider(
      desc.setDensity(900).setFriction(0.62).setRestitution(0.24),
      body
    );

    kernels.push({
      body,
      collider,
      mesh,
      popcorn: null,
      popped: false,
      popT: 0,
      baseScale: scale,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Sound (synthesised, no assets)
 * ------------------------------------------------------------------ */

let audioCtx = null;
let noiseBuffer = null;

function initAudio() {
  if (audioCtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const len = Math.floor(audioCtx.sampleRate * 0.12);
    noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  } catch {
    audioCtx = null;
  }
}

function playPop() {
  if (!audioCtx || audioCtx.state === 'suspended') {
    try {
      audioCtx?.resume();
    } catch {}
  }
  if (!audioCtx || !noiseBuffer) return;

  const ctx = audioCtx;
  const t = ctx.currentTime;

  // low thump
  const osc = ctx.createOscillator();
  const g1 = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280 + Math.random() * 160, t);
  osc.frequency.exponentialRampToValueAtTime(64, t + 0.1);
  g1.gain.setValueAtTime(0.0001, t);
  g1.gain.exponentialRampToValueAtTime(0.22, t + 0.006);
  g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(g1).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.16);

  // husk crack
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2200 + Math.random() * 900, t);
  bp.Q.value = 1.1;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.16, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  src.connect(bp).connect(g2).connect(ctx.destination);
  src.start(t);
}

/* ------------------------------------------------------------------ *
 * Pop
 * ------------------------------------------------------------------ */

function popKernel(entry) {
  if (entry.popped) return;
  entry.popped = true;
  entry.popT = 0;

  entry.mesh.visible = false;

  const t = entry.body.translation();
  const r = entry.body.rotation();

  const gi = Math.floor(Math.random() * popcornGeos.length);
  const geo = popcornGeos[gi];
  const mesh = new THREE.Mesh(geo, popcornMats[Math.floor(Math.random() * popcornMats.length)]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
  mesh.scale.setScalar(0.45 * entry.baseScale);
  scene.add(mesh);
  entry.popcorn = mesh;

  // swap collider: a convex hull of the actual puff shape. A ball would
  // either float above the table or sink into it, because the shape is
  // lumpy and its outer lobes stick out well past its average radius.
  world.removeCollider(entry.collider, true);

  const src = popcornHullPoints[gi];
  const pts = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) pts[i] = src[i] * entry.baseScale;

  let desc = RAPIER.ColliderDesc.convexHull(pts);
  if (!desc) desc = RAPIER.ColliderDesc.ball(0.14 * entry.baseScale);

  entry.collider = world.createCollider(
    desc.setDensity(55).setFriction(0.95).setRestitution(0.08),
    entry.body
  );

  // popcorn is fluffy: it stops almost immediately instead of rolling away
  entry.body.setLinearDamping(0.28);
  entry.body.setAngularDamping(2.2);

  // the pop: a sharp upward kick with a random lateral lean. The tail
  // of the distribution is strong enough to clear the rim, so a few
  // pieces do fly out of the glass.
  const up = 1.5 + Math.pow(Math.random(), 1.6) * 4.6;
  const side = 0.5 + Math.random() * 1.1;
  const angle = Math.random() * Math.PI * 2;

  entry.body.setLinvel(
    {
      x: Math.cos(angle) * side,
      y: up,
      z: Math.sin(angle) * side,
    },
    true
  );

  entry.body.setAngvel(
    {
      x: (Math.random() - 0.5) * 11,
      y: (Math.random() - 0.5) * 11,
      z: (Math.random() - 0.5) * 11,
    },
    true
  );

  poppedCount++;
  counterEl.textContent = String(poppedCount);
  playPop();

  if (poppedCount === KERNEL_COUNT) {
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = 'Всё лопнуло. Нажми «Заново», чтобы повторить.';
  }
}

/* ------------------------------------------------------------------ *
 * Reset
 * ------------------------------------------------------------------ */

function resetGame() {
  for (const entry of kernels) {
    world.removeRigidBody(entry.body);
    scene.remove(entry.mesh);
    entry.mesh.material.dispose();
    if (entry.popcorn) scene.remove(entry.popcorn);
  }
  kernels.length = 0;
  kernelMeshes.length = 0;
  poppedCount = 0;
  counterEl.textContent = '0';
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'Вращай сцену мышью · кликни по зерну, чтобы оно лопнуло';
  spawnKernels();
}

document.getElementById('reset').addEventListener('click', resetGame);

/* ------------------------------------------------------------------ *
 * Picking
 * ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerDownAt = null;
let hovering = false;

function toNdc(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  return ndc;
}

function pickKernel(clientX, clientY) {
  raycaster.setFromCamera(toNdc(clientX, clientY), camera);
  const hits = raycaster.intersectObjects(kernelMeshes, false);
  if (!hits.length) return null;
  const mesh = hits[0].object;
  return kernels.find((k) => k.mesh === mesh && !k.popped) || null;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  initAudio();
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  renderer.domElement.classList.add('grabbing');
});

renderer.domElement.addEventListener('pointerup', (e) => {
  renderer.domElement.classList.remove('grabbing');

  if (!pointerDownAt) return;
  const moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
  const elapsed = performance.now() - pointerDownAt.t;
  pointerDownAt = null;

  if (moved > 7 || elapsed > 700) return; // that was a drag, not a click

  const entry = pickKernel(e.clientX, e.clientY);
  if (entry) popKernel(entry);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (pointerDownAt) return; // orbiting; don't fuse the cursor
  const entry = pickKernel(e.clientX, e.clientY);
  const wantPointer = Boolean(entry);
  if (wantPointer !== hovering) {
    hovering = wantPointer;
    renderer.domElement.classList.toggle('pointing', wantPointer);
  }
});

renderer.domElement.addEventListener('pointerleave', () => {
  hovering = false;
  renderer.domElement.classList.remove('pointing');
});

/* ------------------------------------------------------------------ *
 * Loop
 * ------------------------------------------------------------------ */

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

const timer = new THREE.Timer();
timer.connect(document);
let accumulator = 0;

function syncMeshes(dt) {
  for (const entry of kernels) {
    const t = entry.body.translation();
    const r = entry.body.rotation();
    const mesh = entry.popped ? entry.popcorn : entry.mesh;

    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);

    if (entry.popped && entry.popT < 1) {
      entry.popT = Math.min(1, entry.popT + dt / 0.17);
      const e = 1 - Math.pow(1 - entry.popT, 3);
      mesh.scale.setScalar((0.45 + 0.55 * e) * entry.baseScale);
    }
  }
}

function animate() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  accumulator += dt;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < 5) {
    world.step();
    accumulator -= FIXED_DT;
    steps++;
  }

  syncMeshes(dt);

  controls.update();
  composer.render();
  requestAnimationFrame(animate);
}

spawnKernels();
animate();

// debug handle (also handy for automated checks, where the tab is
// backgrounded and requestAnimationFrame is paused)
window.__game = {
  THREE,
  kernels,
  world,
  scene,
  camera,
  popKernel,
  resetGame,
  renderer,
  tick(frames = 60, dt = FIXED_DT) {
    for (let i = 0; i < frames; i++) {
      world.step();
      syncMeshes(dt);
    }
    controls.update();
    composer.render();
  },
  // physics only, no rendering — cheap enough to call in a per-frame loop
  sim(frames = 1, dt = FIXED_DT) {
    for (let i = 0; i < frames; i++) {
      world.step();
      syncMeshes(dt);
    }
  },
};

gateReady();

function gateReady() {
  const el = document.getElementById('loading');
  if (el) el.classList.add('hidden');
  window.__gameReady = true;
}
