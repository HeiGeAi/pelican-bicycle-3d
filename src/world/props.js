import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loftAlongCurve, cylinderBetween, paint } from '../lib/geometry.js';
import { mulberry32, smoothstep, lerp, clamp, TAU, createNoise2D } from '../lib/math.js';
import { glowTexture, signTexture } from '../lib/textures.js';
import { WORLD } from './island.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
export const windUniforms = { uTime: { value: 0 } };

function patchWind(mat, amp, scale, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float wph = dot(instanceMatrix[3].xz, vec2(0.21, 0.13));
      #else
        float wph = 0.0;
      #endif
      float wh = max(position.y, 0.0) * ${scale.toFixed(5)};
      float wk = wh * wh * ${amp.toFixed(5)};
      transformed.x += (sin(uTime * 1.3 + wph) + 0.4 * sin(uTime * 2.7 + wph * 1.9)) * wk;
      transformed.z += cos(uTime * 1.1 + wph * 1.3) * wk * 0.6;`
    );
  };
  mat.customProgramCacheKey = () => `wind-${key}`;
  return mat;
}

function nonIdx(g) {
  const r = g.index ? g.toNonIndexed() : g;
  if (!r.attributes.uv) r.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(r.attributes.position.count * 2), 2));
  return r;
}
function colored(g, color) {
  const r = nonIdx(g);
  paint(r, color);
  if (!r.attributes.normal) r.computeVertexNormals();
  return r;
}
function merge(list) {
  return mergeGeometries(list.map((g) => nonIdx(g)));
}

// ---------------------------------------------------------------- models
function palmGeometry(rand, height) {
  const parts = [];
  const lean = 0.6 + rand() * 0.9;
  const top = V(lean, height, 0);
  const curve = new THREE.CubicBezierCurve3(V(0, 0, 0), V(0.05, height * 0.35, 0), V(lean * 0.55, height * 0.7, 0), top);
  const dark = new THREE.Color(0x7a5a3a);
  const light = new THREE.Color(0x9c7a52);
  const trunk = loftAlongCurve(curve, 18, 8, (t) => lerp(0.2, 0.12, t) * (1 + 0.1 * Math.max(0, Math.sin(t * height * 11))), {
    side: V(0, 0, 1),
    capStart: false,
    capEnd: true,
    colorFn: (t, c) => c.copy(dark).lerp(light, Math.sin(t * height * 11) * 0.5 + 0.5),
  });
  parts.push(nonIdx(trunk));
  const tangentTop = curve.getTangentAt(1);
  // coconuts
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rand();
    const s = new THREE.SphereGeometry(0.13, 8, 6);
    s.translate(top.x + Math.cos(a) * 0.2, top.y - 0.25, top.z + Math.sin(a) * 0.2);
    parts.push(colored(s, 0x5a3d1e));
  }
  // fronds
  const fronds = 10;
  const leafA = new THREE.Color(0x2f7a34);
  const leafB = new THREE.Color(0x8cc94c);
  const leafOld = new THREE.Color(0xb7a64a);
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * TAU + rand() * 0.4;
    const dir = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-dir.z, 0, dir.x);
    const len = 2.6 + rand() * 0.9;
    const lift = 0.5 + rand() * 0.6;
    const droop = 0.9 + rand() * 0.9;
    const old = rand() < 0.15;
    const rachis = new THREE.QuadraticBezierCurve3(
      top.clone().addScaledVector(tangentTop, 0.1),
      top.clone().addScaledVector(dir, len * 0.45).add(V(0, lift, 0)),
      top.clone().addScaledVector(dir, len).add(V(0, lift - droop, 0))
    );
    const steps = 18;
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const p = rachis.getPoint(t);
      const tg = rachis.getTangent(t);
      const leafLen = (0.25 + 0.75 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7)) * 0.95;
      for (const s of [-1, 1]) {
        const out = side.clone().multiplyScalar(s).addScaledVector(tg, 0.55).add(V(0, -0.45 - t * 0.3, 0)).normalize();
        const tip = p.clone().addScaledVector(out, leafLen);
        const w = tg.clone().multiplyScalar(0.065);
        const base1 = p.clone().sub(w);
        const base2 = p.clone().add(w);
        const mid = p.clone().addScaledVector(out, leafLen * 0.45).add(V(0, 0.05, 0));
        const midA = mid.clone().sub(w);
        const midB = mid.clone().add(w);
        const tri = [base1, midA, base2, base2, midA, midB, midA, tip, midB];
        c.copy(old ? leafOld : leafA).lerp(old ? leafOld : leafB, t * 0.7 + rand() * 0.2);
        for (const v of tri) {
          pos.push(v.x, v.y, v.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const rg = new THREE.TubeGeometry(rachis, 8, 0.03, 4, false);
    parts.push(colored(rg, 0x55702e));
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  lg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  lg.computeVertexNormals();
  parts.push(lg);
  return mergeGeometries(parts);
}

function broadleafGeometry(rand, noise) {
  const parts = [];
  const h = 2.2 + rand() * 0.8;
  parts.push(colored(cylinderBetween(V(0, 0, 0), V(0.1, h + 0.4, 0), 0.22, 0.13, 7), 0x5a4a3c));
  const blobs = 3 + Math.floor(rand() * 2);
  const gA = new THREE.Color(0x3f8a36);
  const gB = new THREE.Color(0x77b24a);
  for (let b = 0; b < blobs; b++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const r = 1.4 + rand() * 0.9;
    const cx = (rand() - 0.5) * 1.6;
    const cy = h + 0.9 + rand() * 1.2;
    const cz = (rand() - 0.5) * 1.6;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = 1 + 0.22 * noise(x * 1.7 + b * 5, z * 1.7 + y);
      p.setXYZ(i, cx + x * r * n, cy + y * r * n * 0.85, cz + z * r * n);
    }
    const ng = nonIdx(g);
    ng.computeVertexNormals();
    const cols = new Float32Array(ng.attributes.position.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < ng.attributes.position.count; i++) {
      const y = ng.attributes.position.getY(i);
      c.copy(gA).lerp(gB, smoothstep(cy - r, cy + r, y) * 0.85 + rand() * 0.1);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    parts.push(ng);
  }
  return merge(parts);
}

function pineGeometry(rand) {
  const parts = [];
  const h = 5 + rand() * 3;
  parts.push(colored(cylinderBetween(V(0, 0, 0), V(0, h * 0.4, 0), 0.2, 0.14, 6), 0x5a3f28));
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = lerp(1.9, 0.6, t) * (0.9 + rand() * 0.2);
    const ch = h * 0.42;
    const cone = new THREE.ConeGeometry(r, ch, 8, 1);
    cone.translate(0, h * 0.25 + t * h * 0.62 + ch / 2, 0);
    parts.push(colored(cone, i % 2 ? 0x2f6b3a : 0x2a5f35));
  }
  return merge(parts);
}

function rockGeometry(rand, noise) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 1 + 0.28 * noise(x * 1.3, z * 1.3 + y * 0.9);
    p.setXYZ(i, x * n * 1.2, y * n * 0.75, z * n);
  }
  const ng = nonIdx(g);
  ng.computeVertexNormals();
  const cols = new Float32Array(ng.attributes.position.count * 3);
  const a = new THREE.Color(0x9a9286);
  const b = new THREE.Color(0x6a635a);
  const c = new THREE.Color();
  for (let i = 0; i < ng.attributes.position.count; i += 3) {
    c.copy(a).lerp(b, rand());
    for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return ng;
}

function grassTuftGeometry(rand) {
  const pos = [];
  const col = [];
  const base = new THREE.Color(0x3e7a2e);
  const tip = new THREE.Color(0xa9d46a);
  for (let b = 0; b < 5; b++) {
    const a = rand() * TAU;
    const r = rand() * 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.3 + rand() * 0.28;
    const w = 0.035 + rand() * 0.02;
    const bend = (rand() - 0.5) * 0.25;
    const ang = rand() * Math.PI;
    const dx = Math.cos(ang) * w;
    const dz = Math.sin(ang) * w;
    pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + bend, h, z + bend * 0.5);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  n.needsUpdate = true;
  return g;
}

function flowerGeometry() {
  const parts = [];
  const stem = cylinderBetween(V(0, 0, 0), V(0, 0.28, 0), 0.006, 0.006, 3);
  parts.push(colored(stem, 0x4d8a34));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const petal = new THREE.CircleGeometry(0.035, 6);
    petal.rotateX(-Math.PI / 2 + 0.3);
    petal.translate(0, 0, 0.03);
    petal.rotateY(a);
    petal.translate(0, 0.28, 0);
    parts.push(colored(petal, 0xffffff));
  }
  const center = new THREE.SphereGeometry(0.02, 6, 4);
  center.translate(0, 0.29, 0);
  parts.push(colored(center, 0xffd23a));
  return merge(parts);
}

// ---------------------------------------------------------------- placement
function scatter(rand, count, maxTries, test) {
  const out = [];
  for (let t = 0; t < maxTries && out.length < count; t++) {
    const x = (rand() - 0.5) * WORLD.size * 0.96;
    const z = (rand() - 0.5) * WORLD.size * 0.96;
    const r = test(x, z);
    if (r) out.push(r);
  }
  return out;
}

function instanced(geo, mat, items, { cast = false, receive = true, colors = null } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  items.forEach((it, i) => {
    e.set(it.tilt || 0, it.rot || 0, it.tilt2 || 0);
    q.setFromEuler(e);
    s.setScalar(it.scale || 1);
    if (it.sy) s.y *= it.sy;
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, colors(it, i));
  });
  mesh.count = items.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createProps(island, { grassDensity = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'props';
  const rand = mulberry32(2026);
  const noise = createNoise2D(mulberry32(77));
  const { heightAt, slopeAt, coastDist, roadDist, coastR, road } = island;
  const keepOut = [];
  const free = (x, z, r) => keepOut.every((k) => (k.x - x) ** 2 + (k.z - z) ** 2 > (k.r + r) ** 2);

  const updaters = [];
  const nightMats = [];

  // ---------- lighthouse on the cape ----------
  const capeR = coastR(WORLD.capeTheta) - 17;
  const lh = { x: Math.cos(WORLD.capeTheta) * capeR, z: Math.sin(WORLD.capeTheta) * capeR };
  lh.y = heightAt(lh.x, lh.z);
  keepOut.push({ x: lh.x, z: lh.z, r: 9 });
  const lighthouse = new THREE.Group();
  lighthouse.position.set(lh.x, lh.y - 0.3, lh.z);
  {
    const parts = [];
    const base = new THREE.CylinderGeometry(3.2, 3.5, 1.4, 20);
    base.translate(0, 0.7, 0);
    parts.push(colored(base, 0xd8d2c6));
    const tower = new THREE.CylinderGeometry(1.15, 1.75, 15, 28, 12, true);
    tower.translate(0, 1.4 + 7.5, 0);
    const tg = nonIdx(tower);
    const tc = new Float32Array(tg.attributes.position.count * 3);
    const red = new THREE.Color(0xd23b31);
    const white = new THREE.Color(0xf5f1ea);
    for (let i = 0; i < tg.attributes.position.count; i++) {
      const y = tg.attributes.position.getY(i) - 1.4;
      const c = Math.floor(y / 3.75) % 2 ? red : white;
      tc.set([c.r, c.g, c.b], i * 3);
    }
    tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    parts.push(tg);
    const gallery = new THREE.CylinderGeometry(1.75, 1.6, 0.3, 24);
    gallery.translate(0, 16.55, 0);
    parts.push(colored(gallery, 0x2c2f35));
    const rail = new THREE.TorusGeometry(1.7, 0.035, 5, 32);
    rail.rotateX(Math.PI / 2);
    rail.translate(0, 17.45, 0);
    parts.push(colored(rail, 0x2c2f35));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      parts.push(colored(cylinderBetween(V(Math.cos(a) * 1.7, 16.7, Math.sin(a) * 1.7), V(Math.cos(a) * 1.7, 17.45, Math.sin(a) * 1.7), 0.025, 0.025, 4), 0x2c2f35));
    }
    const roof = new THREE.ConeGeometry(1.2, 1.2, 20);
    roof.translate(0, 19.25, 0);
    parts.push(colored(roof, 0xc23329));
    const knob = new THREE.SphereGeometry(0.16, 10, 8);
    knob.translate(0, 19.95, 0);
    parts.push(colored(knob, 0x2c2f35));
    // keeper's cottage
    const hut = new THREE.BoxGeometry(4.5, 2.8, 3.4);
    hut.translate(4.8, 1.4, 1.5);
    parts.push(colored(hut, 0xf1ebe0));
    const hr = new THREE.ConeGeometry(3.4, 1.8, 4);
    hr.rotateY(Math.PI / 4);
    hr.scale(1.0, 1, 0.78);
    hr.translate(4.8, 3.7, 1.5);
    parts.push(colored(hr, 0xb8453a));
    const m = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    m.castShadow = true;
    m.receiveShadow = true;
    lighthouse.add(m);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.6, 20, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    glass.position.y = 17.5;
    lighthouse.add(glass);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 0.4 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), lampMat);
    lamp.position.y = 17.5;
    lighthouse.add(lamp);
    const winMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, emissive: 0xffb865, emissiveIntensity: 0 });
    for (const [x, z] of [[4.8 - 1.2, 1.5 + 1.71], [4.8 + 1.2, 1.5 + 1.71]]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), winMat);
      w.position.set(x, 1.6, z);
      lighthouse.add(w);
    }
    nightMats.push({ mat: winMat, day: 0, night: 2.2 });
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.88, 0.6) }, uIntensity: { value: 0 } },
      vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){ vAlong = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = edge * pow(vAlong, 2.2) * uIntensity; gl_FragColor = vec4(uColor * a, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const beams = new THREE.Group();
    beams.position.y = 17.5;
    for (const s of [0, Math.PI]) {
      const cone = new THREE.ConeGeometry(7, 90, 24, 1, true);
      cone.translate(0, -45, 0);
      cone.rotateZ(Math.PI / 2);
      const b = new THREE.Mesh(cone, beamMat);
      b.rotation.y = s;
      b.rotation.z = -0.04;
      b.frustumCulled = false;
      beams.add(b);
    }
    lighthouse.add(beams);
    const light = new THREE.PointLight(0xffd79a, 0, 60, 1.6);
    light.position.y = 17.5;
    lighthouse.add(light);
    updaters.push((dt, t, night) => {
      beams.rotation.y += dt * 0.55;
      beamMat.uniforms.uIntensity.value = night * 0.55;
      beams.visible = night > 0.02;
      lampMat.emissiveIntensity = 0.4 + night * 9;
      light.intensity = night * 400;
    });
  }
  group.add(lighthouse);

  // ---------- pier + huts + umbrellas near the pier ----------
  const pierTh = WORLD.pierTheta;
  const out = V(Math.cos(pierTh), 0, Math.sin(pierTh));
  const across = V(-out.z, 0, out.x);
  const pierStartR = coastR(pierTh) - 7;
  const pierLen = 72;
  {
    const deckY = 1.35;
    const plankGeo = new THREE.BoxGeometry(0.28, 0.07, 3.2);
    const planks = [];
    for (let i = 0; i < pierLen / 0.32; i++) {
      const r = pierStartR + i * 0.32;
      planks.push({ x: out.x * r, y: deckY, z: out.z * r, rot: -pierTh, scale: 1, sy: 1 });
    }
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x9a7350, roughness: 0.85 });
    const plankMesh = instanced(plankGeo, plankMat, planks, { cast: true, colors: (it, i) => new THREE.Color().setHSL(0.08, 0.35, 0.36 + ((i * 7919) % 13) / 110) });
    group.add(plankMesh);
    const railParts = [];
    for (let i = 0; i <= pierLen / 4; i++) {
      const r = pierStartR + i * 4;
      for (const s of [-1, 1]) {
        const x = out.x * r + across.x * 1.5 * s;
        const z = out.z * r + across.z * 1.5 * s;
        const gy = Math.min(heightAt(x, z), 0) - 1.5;
        railParts.push(cylinderBetween(V(x, gy, z), V(x, deckY + 1.0, z), 0.11, 0.11, 6));
      }
    }
    for (const s of [-1, 1]) {
      const a = V(out.x * pierStartR + across.x * 1.5 * s, deckY + 0.95, out.z * pierStartR + across.z * 1.5 * s);
      const b = V(out.x * (pierStartR + pierLen) + across.x * 1.5 * s, deckY + 0.95, out.z * (pierStartR + pierLen) + across.z * 1.5 * s);
      railParts.push(cylinderBetween(a, b, 0.05, 0.05, 5));
      railParts.push(cylinderBetween(a.clone().setY(deckY + 0.5), b.clone().setY(deckY + 0.5), 0.035, 0.035, 5));
    }
    const rails = new THREE.Mesh(merge(railParts), new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.9 }));
    rails.castShadow = true;
    group.add(rails);
    for (let i = 0; i < 16; i++) keepOut.push({ x: out.x * (pierStartR + i * 4.5), z: out.z * (pierStartR + i * 4.5), r: 3 });

    // huts
    const hutParts = [];
    const winParts = [];
    const pastel = [0xf29e8e, 0x8fd3d8, 0xf6d57a, 0xa9c98a, 0xc9a7e3];
    for (let i = 0; i < 5; i++) {
      const th = pierTh + 0.045 + i * 0.022;
      const r = coastR(th) - 13;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      const y = heightAt(x, z);
      const rot = -th + Math.PI / 2;
      const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), V(1, 1, 1));
      const body = new THREE.BoxGeometry(2.2, 2.3, 2.2);
      body.translate(0, 1.15, 0);
      const roof = new THREE.ConeGeometry(1.95, 1.2, 4);
      roof.rotateY(Math.PI / 4);
      roof.translate(0, 2.9, 0);
      const door = new THREE.BoxGeometry(0.8, 1.5, 0.05);
      door.translate(0, 0.75, 1.12);
      const stripe = new THREE.BoxGeometry(2.24, 0.25, 2.24);
      stripe.translate(0, 0.3, 0);
      for (const [g, c] of [[body, pastel[i]], [roof, 0xf7f2e8], [door, 0x5b4636], [stripe, 0xffffff]]) {
        const cg = colored(g, c);
        cg.applyMatrix4(m);
        hutParts.push(cg);
      }
      const win = new THREE.PlaneGeometry(0.55, 0.55);
      win.rotateY(Math.PI / 2);
      win.translate(1.115, 1.5, 0);
      const wg = nonIdx(win);
      wg.applyMatrix4(m);
      winParts.push(wg);
      keepOut.push({ x, z, r: 3 });
    }
    const huts = new THREE.Mesh(merge(hutParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    huts.castShadow = true;
    huts.receiveShadow = true;
    group.add(huts);
    const hutWinMat = new THREE.MeshStandardMaterial({ color: 0x33404f, emissive: 0xffc47a, emissiveIntensity: 0 });
    group.add(new THREE.Mesh(merge(winParts), hutWinMat));
    nightMats.push({ mat: hutWinMat, day: 0, night: 2.5 });

    // umbrellas + towels
    const uParts = [];
    const uCols = [[0xe8473a, 0xffffff], [0x2e9bd6, 0xffffff], [0xf5b62c, 0xffffff], [0x37b37e, 0xfff4d6]];
    for (let i = 0; i < 9; i++) {
      const th = pierTh - 0.03 - i * 0.03 + (rand() - 0.5) * 0.01;
      const r = coastR(th) - 6 - rand() * 6;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      if (!free(x, z, 1.5)) continue;
      const y = heightAt(x, z);
      const tilt = (rand() - 0.5) * 0.3;
      const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, rand() * TAU, tilt * 0.5)), V(1, 1, 1));
      const pole = colored(cylinderBetween(V(0, 0, 0), V(0, 2.3, 0), 0.03, 0.03, 5), 0xeeeeee);
      pole.applyMatrix4(m);
      uParts.push(pole);
      const can = new THREE.ConeGeometry(1.35, 0.55, 16, 1, true);
      can.translate(0, 2.3, 0);
      const cg = nonIdx(can);
      const cc = new Float32Array(cg.attributes.position.count * 3);
      const [ca, cb] = uCols[i % uCols.length].map((h) => new THREE.Color(h));
      for (let k = 0; k < cg.attributes.position.count; k += 3) {
        const cx = (cg.attributes.position.getX(k) + cg.attributes.position.getX(k + 1) + cg.attributes.position.getX(k + 2)) / 3;
        const cz = (cg.attributes.position.getZ(k) + cg.attributes.position.getZ(k + 1) + cg.attributes.position.getZ(k + 2)) / 3;
        const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / TAU) * 8);
        const c = seg % 2 ? ca : cb;
        for (let q = 0; q < 3; q++) cc.set([c.r, c.g, c.b], (k + q) * 3);
      }
      cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      cg.computeVertexNormals();
      cg.applyMatrix4(m);
      uParts.push(cg);
      const towel = colored(new THREE.BoxGeometry(0.8, 0.02, 1.7), uCols[(i + 1) % uCols.length][0]);
      towel.applyMatrix4(new THREE.Matrix4().compose(V(x + 1.1, y + 0.02, z + 0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * TAU, 0)), V(1, 1, 1)));
      uParts.push(towel);
      keepOut.push({ x, z, r: 2 });
    }
    const umbrellas = new THREE.Mesh(merge(uParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
    umbrellas.castShadow = true;
    group.add(umbrellas);
  }

  // ---------- street lamps along the road (sea side) ----------
  {
    const lampParts = [];
    const bulbs = [];
    const pools = [];
    const sample = { pos: V(0, 0, 0), tangent: V(0, 0, 0), right: V(0, 0, 0), curvature: 0, slope: 0 };
    const spacing = 34;
    const n = Math.floor(road.length / spacing);
    for (let i = 0; i < n; i++) {
      road.sample(i * spacing + 12, sample);
      const base = sample.pos.clone().addScaledVector(sample.right, WORLD.roadHalf + 0.75);
      base.y = heightAt(base.x, base.z);
      const m = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), sample.right.clone().negate()), V(1, 1, 1));
      const pole = cylinderBetween(V(0, 0, 0), V(0, 4.3, 0), 0.075, 0.055, 7);
      const arm = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V(0, 4.2, 0), V(0, 4.75, 0), V(0.95, 4.6, 0)), 10, 0.04, 5, false);
      const head = new THREE.CylinderGeometry(0.1, 0.26, 0.2, 10);
      head.translate(0.95, 4.5, 0);
      const foot = new THREE.CylinderGeometry(0.16, 0.2, 0.35, 8);
      foot.translate(0, 0.17, 0);
      for (const g of [pole, arm, head, foot]) {
        const cg = colored(g, 0x2d4a45);
        cg.applyMatrix4(m);
        lampParts.push(cg);
      }
      const bulbPos = V(0.95, 4.37, 0).applyMatrix4(m);
      bulbs.push({ x: bulbPos.x, y: bulbPos.y, z: bulbPos.z, scale: 1 });
      const poolPos = sample.pos.clone().addScaledVector(sample.right, WORLD.roadHalf - 0.2);
      pools.push({ x: poolPos.x, y: sample.pos.y + 0.06, z: poolPos.z, scale: 1 });
      keepOut.push({ x: base.x, z: base.z, r: 1 });
    }
    const lamps = new THREE.Mesh(merge(lampParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }));
    lamps.castShadow = true;
    group.add(lamps);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc878, emissiveIntensity: 0.1 });
    group.add(instanced(new THREE.SphereGeometry(0.12, 10, 8), bulbMat, bulbs, { receive: false }));
    nightMats.push({ mat: bulbMat, day: 0.1, night: 14 });
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)'), color: 0xffb867, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const poolGeo = new THREE.PlaneGeometry(7, 7);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMesh = instanced(poolGeo, poolMat, pools, { receive: false });
    poolMesh.renderOrder = 3;
    group.add(poolMesh);
    updaters.push((dt, t, night) => {
      poolMat.opacity = night * 0.55;
      poolMesh.visible = night > 0.02;
    });
  }

  // ---------- sign at the start ----------
  {
    const sample = { pos: V(0, 0, 0), tangent: V(0, 0, 0), right: V(0, 0, 0), curvature: 0, slope: 0 };
    road.sample(58, sample);
    const p = sample.pos.clone().addScaledVector(sample.right, -(WORLD.roadHalf + 2.2));
    p.y = heightAt(p.x, p.z);
    const sign = new THREE.Group();
    sign.position.copy(p);
    sign.quaternion.setFromUnitVectors(V(0, 0, 1), sample.tangent.clone().setY(0).normalize().negate());
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.9 });
    for (const x of [-1.1, 1.1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 2.6, 7), woodMat);
      post.position.set(x, 1.3, 0);
      post.castShadow = true;
      sign.add(post);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.4, 0.1), [woodMat, woodMat, woodMat, woodMat, new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.8 }), woodMat]);
    board.position.y = 1.85;
    board.castShadow = true;
    sign.add(board);
    group.add(sign);
    keepOut.push({ x: p.x, z: p.z, r: 2.5 });
  }

  // ---------- vegetation ----------
  const palmMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }), 0.32, 1 / 7.5, 'palm');
  const palmVariants = [palmGeometry(rand, 6.2), palmGeometry(rand, 7.4), palmGeometry(rand, 5.4)];
  const palmItems = scatter(rand, 96, 20000, (x, z) => {
    const d = coastDist(x, z);
    if (d < 3 || d > 34) return null;
    const h = heightAt(x, z);
    if (h < 0.5 || h > 7) return null;
    if (roadDist(x, z) < WORLD.roadHalf + 2.5 || slopeAt(x, z) > 0.35 || !free(x, z, 2.2)) return null;
    keepOut.push({ x, z, r: 2.4 });
    return { x, y: h - 0.1, z, rot: rand() * TAU, scale: 0.85 + rand() * 0.35 };
  });
  palmVariants.forEach((geo, vi) => {
    const items = palmItems.filter((_, i) => i % 3 === vi);
    group.add(instanced(geo, palmMat, items, { cast: true }));
  });

  const leafMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), 0.12, 1 / 5, 'tree');
  const broadGeos = [broadleafGeometry(rand, noise), broadleafGeometry(rand, noise)];
  const broadItems = scatter(rand, 170, 30000, (x, z) => {
    const d = coastDist(x, z);
    if (d < 40) return null;
    const h = heightAt(x, z);
    if (h < 3.5 || h > 30) return null;
    if (roadDist(x, z) < WORLD.roadHalf + 4 || slopeAt(x, z) > 0.55 || !free(x, z, 2.5)) return null;
    if (noise(x * 0.012, z * 0.012) < -0.25) return null;
    keepOut.push({ x, z, r: 2.6 });
    return { x, y: h - 0.2, z, rot: rand() * TAU, scale: 0.8 + rand() * 0.6 };
  });
  broadGeos.forEach((geo, vi) => group.add(instanced(geo, leafMat, broadItems.filter((_, i) => i % 2 === vi), { cast: true })));

  const pineMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), 0.1, 1 / 7, 'pine');
  const pineItems = scatter(rand, 120, 30000, (x, z) => {
    const h = heightAt(x, z);
    if (h < 12 || h > 48) return null;
    if (slopeAt(x, z) > 0.8 || !free(x, z, 2)) return null;
    keepOut.push({ x, z, r: 2 });
    return { x, y: h - 0.3, z, rot: rand() * TAU, scale: 0.75 + rand() * 0.6 };
  });
  group.add(instanced(pineGeometry(rand), pineMat, pineItems, { cast: true }));

  const bushMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 0.06, 1, 'bush');
  const bushGeo = (() => {
    const g = new THREE.IcosahedronGeometry(0.7, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const n = 1 + 0.25 * noise(p.getX(i) * 3, p.getZ(i) * 3 + p.getY(i));
      p.setXYZ(i, p.getX(i) * n, Math.max(p.getY(i), -0.2) * n * 0.8 + 0.35, p.getZ(i) * n);
    }
    return colored(g, 0xffffff);
  })();
  const bushItems = scatter(rand, 220, 20000, (x, z) => {
    const d = coastDist(x, z);
    if (d < 12) return null;
    const h = heightAt(x, z);
    if (h < 1.8 || h > 34) return null;
    const rd = roadDist(x, z);
    if (rd < WORLD.roadHalf + 1.6 || slopeAt(x, z) > 0.6 || !free(x, z, 0.9)) return null;
    return { x, y: h - 0.15, z, rot: rand() * TAU, scale: 0.6 + rand() * 0.9 };
  });
  group.add(instanced(bushGeo, bushMat, bushItems, { cast: true, colors: () => new THREE.Color().setHSL(0.26 + rand() * 0.08, 0.45 + rand() * 0.2, 0.28 + rand() * 0.12) }));

  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const rockItems = scatter(rand, 150, 40000, (x, z) => {
    const d = coastDist(x, z);
    const h = heightAt(x, z);
    const shore = d > -7 && d < 5;
    const capeZone = Math.abs(Math.atan2(z, x) - WORLD.capeTheta) < 0.14 && d < 30;
    const mountain = h > 20 && slopeAt(x, z) > 0.4;
    if (!shore && !capeZone && !mountain) return null;
    if (roadDist(x, z) < WORLD.roadHalf + 2 || !free(x, z, 1.2)) return null;
    return { x, y: h - 0.25, z, rot: rand() * TAU, tilt: (rand() - 0.5) * 0.5, scale: 0.4 + rand() * rand() * 2.6 };
  });
  group.add(instanced(rockGeometry(rand, noise), rockMat, rockItems, { cast: true }));

  // grass & flowers (instance order is shuffled so any prefix is a uniform subset)
  const grassMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 0.09, 1.9, 'grass');
  const grassItems = scatter(rand, 16000, 160000, (x, z) => {
    const rd = roadDist(x, z);
    const near = rd > WORLD.roadHalf + 0.6 && rd < 26;
    if (!near && rand() > 0.12) return null;
    if (rd <= WORLD.roadHalf + 0.6) return null;
    const h = heightAt(x, z);
    if (h < 2.2 || h > 36) return null;
    if (coastDist(x, z) < 18 || slopeAt(x, z) > 0.45) return null;
    return { x, y: h - 0.03, z, rot: rand() * TAU, scale: 0.7 + rand() * 0.7 };
  });
  const grass = instanced(grassTuftGeometry(rand), grassMat, grassItems, { receive: true, colors: () => new THREE.Color().setHSL(0.22 + rand() * 0.07, 0.5, 0.45 + rand() * 0.15) });
  grass.userData.full = grassItems.length;
  group.add(grass);

  const flowerMat = patchWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), 0.08, 3, 'flower');
  const flowerPalette = [0xffffff, 0xffd84a, 0xff8fb4, 0xb99bff, 0xff9a52, 0xff5f5f];
  const flowerItems = scatter(rand, 3200, 80000, (x, z) => {
    if (noise(x * 0.025 + 11, z * 0.025) < 0.15) return null;
    const rd = roadDist(x, z);
    if (rd < WORLD.roadHalf + 0.8 || rd > 30) return null;
    const h = heightAt(x, z);
    if (h < 2.4 || coastDist(x, z) < 20 || slopeAt(x, z) > 0.4) return null;
    return { x, y: h - 0.02, z, rot: rand() * TAU, scale: 0.8 + rand() * 0.6, c: flowerPalette[Math.floor(rand() * flowerPalette.length)] };
  });
  const flowers = instanced(flowerGeometry(), flowerMat, flowerItems, { receive: true, colors: (it) => new THREE.Color(it.c) });
  flowers.userData.full = flowerItems.length;
  group.add(flowers);

  // ---------- boats & buoys ----------
  const boats = [];
  {
    const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfbf7ee, roughness: 0.8, side: THREE.DoubleSide });
    const hullColors = [0xf2f0ea, 0x2f6fa8, 0xd8563f];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const hull = new THREE.SphereGeometry(1, 16, 8, 0, TAU, Math.PI / 2, Math.PI / 2);
      hull.scale(3.2, 1.1, 1.15);
      const deck = new THREE.CircleGeometry(1, 16);
      deck.rotateX(-Math.PI / 2);
      deck.scale(3.2, 1, 1.15);
      const stripe = new THREE.TorusGeometry(1, 0.05, 4, 24);
      stripe.rotateX(Math.PI / 2);
      stripe.scale(3.2, 1, 1.15);
      stripe.translate(0, -0.15, 0);
      const hg = merge([colored(hull, hullColors[i % 3]), colored(deck, 0xb88a5a), colored(stripe, 0xffffff)]);
      const hm = new THREE.Mesh(hg, hullMat);
      hm.castShadow = true;
      b.add(hm);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6), new THREE.MeshStandardMaterial({ color: 0xd9c7a5 }));
      mast.position.set(0.4, 3.5, 0);
      b.add(mast);
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0);
      sailShape.lineTo(0, 6.2);
      sailShape.quadraticCurveTo(-1.2, 3, -2.6, 0.2);
      sailShape.lineTo(0, 0);
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape, 8), sailMat);
      sail.position.set(0.35, 0.7, 0);
      b.add(sail);
      const jib = new THREE.Shape();
      jib.moveTo(0, 0);
      jib.lineTo(0, 5.2);
      jib.lineTo(2.3, 0.1);
      jib.lineTo(0, 0);
      const jm = new THREE.Mesh(new THREE.ShapeGeometry(jib), sailMat);
      jm.position.set(0.5, 0.8, 0.02);
      b.add(jm);
      const th = WORLD.pierTheta + 0.35 + i * 0.5 + rand() * 0.2;
      const r = coastR(th) + 55 + rand() * 90;
      b.userData = { th, r, speed: 0.004 + rand() * 0.004, phase: rand() * TAU };
      group.add(b);
      boats.push(b);
    }
    const buoyGeo = merge([colored(new THREE.SphereGeometry(0.45, 10, 8), 0xe03a2e), colored(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6).translate(0, 0.6, 0), 0xffffff)]);
    const buoyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(buoyGeo, buoyMat);
      const r = pierStartR + 20 + i * 9;
      m.position.set(out.x * r + across.x * (i % 2 ? 9 : -9), 0, out.z * r + across.z * (i % 2 ? 9 : -9));
      m.userData.phase = rand() * TAU;
      group.add(m);
      boats.push(m);
    }
    updaters.push((dt, t) => {
      for (const b of boats) {
        const u = b.userData;
        if (u.r) {
          u.th += dt * u.speed;
          b.position.set(Math.cos(u.th) * u.r, Math.sin(t * 0.9 + u.phase) * 0.15 + 0.05, Math.sin(u.th) * u.r);
          b.rotation.set(Math.sin(t * 0.7 + u.phase) * 0.06, -u.th - Math.PI / 2, Math.sin(t * 0.8 + u.phase) * 0.08);
        } else {
          b.position.y = Math.sin(t * 1.4 + u.phase) * 0.18 - 0.1;
          b.rotation.z = Math.sin(t * 1.1 + u.phase) * 0.15;
        }
      }
    });
  }

  // ---------- distant islands ----------
  {
    const parts = [];
    const dn = createNoise2D(mulberry32(9));
    for (let i = 0; i < 6; i++) {
      const a = 0.4 + i * 1.07 + rand() * 0.3;
      const d = 1300 + rand() * 900;
      const g = new THREE.ConeGeometry(120 + rand() * 160, 60 + rand() * 90, 18, 4);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const y = p.getY(k);
        const n = 1 + 0.25 * dn(x * 0.01 + i * 7, z * 0.01);
        p.setXYZ(k, x * n, y + 10, z * n);
      }
      g.scale(1.6, 1, 1);
      g.rotateY(rand() * TAU);
      g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
      parts.push(colored(g, 0x5d7d62));
    }
    const far = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    group.add(far);
  }

  return {
    group,
    lighthouse: new THREE.Vector3(lh.x, lh.y, lh.z),
    grass,
    flowers,
    setGrassDensity(k) {
      grass.count = Math.floor(grass.userData.full * clamp(k, 0, 1));
      flowers.count = Math.floor(flowers.userData.full * clamp(0.3 + k * 0.7, 0, 1));
    },
    update(dt, t, night) {
      windUniforms.uTime.value = t;
      for (const u of updaters) u(dt, t, night);
      for (const n of nightMats) n.mat.emissiveIntensity = lerp(n.day, n.night, night);
    },
    grassDensity,
  };
}
