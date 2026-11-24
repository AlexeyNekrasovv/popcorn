import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

const noise = new ImprovedNoise();

// Spherical UV projection. The shapes here are blobs generated in code,
// so there are no authored UVs — but a bump map still needs some. Polar
// distortion does not matter for isotropic grain noise.
export function applySphericalUVs(geo) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    uv[i * 2] = Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI + 0.5;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* ------------------------------------------------------------------ *
 * Corn kernel
 * A real kernel is a teardrop: sharp tip where it sat on the cob,
 * widest ~60% up, flattened in one axis, with a shallow concave
 * dent on the germ face and the beginning of the sprout at the top.
 * ------------------------------------------------------------------ */

// [radius, height] profile, revolved around Y. Height 0..1 = length.
// Narrow, tapered lower half + widest point ~65% up = a real kernel.
const KERNEL_PROFILE = [
  [0.000, 0.000],
  [0.040, 0.010],
  [0.082, 0.030],
  [0.130, 0.066],
  [0.186, 0.118],
  [0.246, 0.185],
  [0.306, 0.268],
  [0.360, 0.362],
  [0.404, 0.462],
  [0.436, 0.560],
  [0.452, 0.650],
  [0.450, 0.730],
  [0.430, 0.805],
  [0.390, 0.872],
  [0.322, 0.926],
  [0.230, 0.968],
  [0.120, 0.991],
  [0.000, 1.000],
];

export const KERNEL_LENGTH = 0.2;

export function createKernelGeometry() {
  const pts = KERNEL_PROFILE.map(
    ([r, y]) => new THREE.Vector2(r * 0.86, y) // slightly narrower than deep
  );

  let geo = new THREE.LatheGeometry(pts, 56);
  geo.scale(1, 1, 0.64); // kernels are flattened front-to-back
  geo.center();

  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    // organic surface irregularity (two octaves: dents + waxy grain)
    const n = noise.noise(v.x * 7.5 + 4.2, v.y * 7.5 + 1.7, v.z * 7.5 + 9.3);
    const n2 = noise.noise(v.x * 19 - 2.7, v.y * 19 + 6.1, v.z * 19 - 4.4);
    v.multiplyScalar(1 + n * 0.034 + n2 * 0.012);

    // concave germ face on +Z, strongest just below the middle
    const front = THREE.MathUtils.smoothstep(v.z, 0.015, 0.13);
    const band = Math.exp(-Math.pow((v.y - 0.10) / 0.30, 2));
    v.z -= front * band * 0.085;

    // the little sprout dimple at the very top
    const top = THREE.MathUtils.smoothstep(v.y, 0.30, 0.50);
    v.y -= top * 0.03 * Math.exp(-(v.x * v.x + v.z * v.z) / 0.02);

    pos.setXYZ(i, v.x, v.y, v.z);
  }

  const s = KERNEL_LENGTH;
  geo.scale(s, s, s);

  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  applySphericalUVs(geo);
  geo.computeVertexNormals();

  return geo;
}

/* ------------------------------------------------------------------ *
 * Popcorn
 * A cluster of noise-deformed lobes. Real popcorn is not one sphere:
 * it is a bunch of crumpled, semi-translucent puffs fused together.
 * ------------------------------------------------------------------ */

export function createPopcornGeometry() {
  const parts = [];

  const makeLobe = (radius, flatten, seed, detail = 2) => {
    let lobe = new THREE.IcosahedronGeometry(radius, detail);
    lobe.deleteAttribute('uv');
    lobe.deleteAttribute('normal');
    lobe = mergeVertices(lobe, 1e-4);

    const p = lobe.attributes.position;
    const v = new THREE.Vector3();
    // the fold field has to scale with lobe size, otherwise a small lobe
    // just shrinks uniformly instead of getting creased
    const foldFreq = 0.62 / radius;

    for (let j = 0; j < p.count; j++) {
      v.fromBufferAttribute(p, j);
      const n1 = noise.noise(
        v.x * foldFreq + seed,
        v.y * foldFreq + seed,
        v.z * foldFreq + seed
      );
      const n2 = noise.noise(v.x * 22 - seed, v.y * 22 + seed, v.z * 22 - seed);
      const n3 = noise.noise(v.x * 52 + seed, v.y * 52 - seed, v.z * 52 + seed);

      const fold = Math.exp(-Math.pow(n1 / 0.09, 2));

      v.multiplyScalar(1 + n2 * 0.05 + n3 * 0.03 - fold * 0.22);
      v.z *= flatten; // puffs are expanded flakes, not balls
      p.setXYZ(j, v.x, v.y, v.z);
    }

    lobe.computeVertexNormals();
    return lobe;
  };

  // Real popcorn is a shell of many small puffs, not a few big lobes and
  // not a solid ball: the lobes have to sit ON the surface and protrude,
  // otherwise they merge into one smooth mass and the bumps disappear.
  const lobes = 24 + Math.floor(Math.random() * 8);

  for (let i = 0; i < lobes; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));

    const radius = 0.045 + Math.random() * 0.038;
    const dist = 0.088 + Math.random() * 0.022;

    const lobe = makeLobe(radius, 0.42 + Math.random() * 0.38, i * 17.9 + 2.3, 2);
    lobe.rotateX(Math.random() * 6.28);
    lobe.rotateY(Math.random() * 6.28);
    lobe.rotateZ(Math.random() * 6.28);
    lobe.translate(dir.x * dist, dir.y * dist * 0.88, dir.z * dist);
    parts.push(lobe);
  }

  // a few crumbs sticking further out for a jagged edge
  for (let i = 0; i < 7; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const lobe = makeLobe(0.026 + Math.random() * 0.02, 0.85 + Math.random() * 0.3, i * 31.1 + 9.4, 2);
    lobe.translate(s * Math.cos(t) * 0.118, u * 0.105, s * Math.sin(t) * 0.118);
    parts.push(lobe);
  }

  let geo = mergeGeometries(parts, false);

  // final crumple pass across the whole cluster
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let j = 0; j < p.count; j++) {
    v.fromBufferAttribute(p, j);
    const n1 = noise.noise(v.x * 11 + 5.5, v.y * 11 + 2.2, v.z * 11 + 8.1);
    const n2 = noise.noise(v.x * 34 - 1.3, v.y * 34 + 4.4, v.z * 34 - 6.6);
    v.multiplyScalar(1 + n1 * 0.05 + n2 * 0.02);
    p.setXYZ(j, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  geo.center();
  geo.computeBoundingSphere();

  const s = 0.175 / geo.boundingSphere.radius;
  geo.scale(s, s, s);
  geo.computeBoundingSphere();
  applySphericalUVs(geo);

  return geo;
}

/* ------------------------------------------------------------------ *
 * Glass
 * Revolving a closed profile (outer bottom -> outer wall -> rim ->
 * inner wall -> inner floor) gives a real hollow vessel with thickness
 * instead of a single-sided cylinder.
 * ------------------------------------------------------------------ */

const GLASS_PROFILE = [
  [0.000, 0.012],
  [0.200, 0.013],
  [0.390, 0.015],
  [0.510, 0.019],
  [0.570, 0.030],
  [0.596, 0.070],
  [0.604, 0.280],
  [0.608, 1.000],
  [0.604, 1.082],
  [0.588, 1.120],
  [0.570, 1.112],
  [0.562, 1.080],
  [0.558, 0.280],
  [0.552, 0.090],
  [0.520, 0.074],
  [0.390, 0.070],
  [0.200, 0.068],
  [0.000, 0.067],
];

export function createGlassGeometry() {
  const pts = GLASS_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 112);
  geo.computeVertexNormals();
  return geo;
}

// collision dimensions, kept in sync with the profile above
export const GLASS_INNER_R = 0.552;
export const GLASS_INNER_FLOOR = 0.072;
export const GLASS_HEIGHT = 1.12;
