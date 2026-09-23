import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../lib/geometry.js';
import { createFishGeometry, fishMaterial } from '../lib/models.js';
import { mulberry32, TAU, clamp, smoothstep } from '../lib/math.js';
import { glowTexture } from '../lib/textures.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const flapUniforms = { uTime: { value: 0 } };

function prep(g, color) {
  const r = g.index ? g.toNonIndexed() : g;
  if (!r.attributes.uv) r.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(r.attributes.position.count * 2), 2));
  if (!r.attributes.normal) r.computeVertexNormals();
  paint(r, color);
  return r;
}

/** Wing: flat strip from root (z=root) to tip (z=span), chord shrinking, dark tip region. */
function wingGeometry(root, span, chord0, chord1, colIn, colOut, darkFrom, side, trailingDark = false) {
  const pos = [];
  const col = [];
  const segs = 8;
  const cIn = new THREE.Color(colIn);
  const cOut = new THREE.Color(colOut);
  const c = new THREE.Color();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const z0 = (root + (span - root) * t0) * side;
    const z1 = (root + (span - root) * t1) * side;
    const ch0 = chord0 + (chord1 - chord0) * t0;
    const ch1 = chord0 + (chord1 - chord0) * t1;
    const sweep0 = -t0 * t0 * 0.15;
    const sweep1 = -t1 * t1 * 0.15;
    const quads = trailingDark ? [[0, 0.5], [0.5, 1]] : [[0, 1]];
    for (const [a, b] of quads) {
      const x00 = sweep0 + ch0 * 0.4 - ch0 * a;
      const x01 = sweep0 + ch0 * 0.4 - ch0 * b;
      const x10 = sweep1 + ch1 * 0.4 - ch1 * a;
      const x11 = sweep1 + ch1 * 0.4 - ch1 * b;
      const dark = (t0 + t1) / 2 > darkFrom || (trailingDark && a > 0);
      c.copy(dark ? cOut : cIn);
      const tri = side > 0 ? [[x00, z0], [x01, z0], [x10, z1], [x10, z1], [x01, z0], [x11, z1]] : [[x00, z0], [x10, z1], [x01, z0], [x10, z1], [x11, z1], [x01, z0]];
      for (const [x, z] of tri) {
        pos.push(x, 0, z);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

function gullGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.2, 0.06, 0.06);
  const head = new THREE.SphereGeometry(0.05, 10, 8);
  head.translate(0.2, 0.03, 0);
  const beak = new THREE.ConeGeometry(0.014, 0.07, 6);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.27, 0.02, 0);
  const tail = new THREE.ConeGeometry(0.06, 0.14, 4);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 0.3, 1);
  tail.translate(-0.24, 0.0, 0);
  const parts = [prep(body, 0xf4f4f2), prep(head, 0xffffff), prep(beak, 0xf2c230), prep(tail, 0xdcdcdc)];
  for (const s of [-1, 1]) parts.push(wingGeometry(0.04, 0.62, 0.2, 0.1, 0xb9c0c8, 0x1e1f24, 0.8, s));
  return mergeGeometries(parts);
}

function flyingPelicanGeometry() {
  const body = new THREE.SphereGeometry(1, 14, 10);
  body.scale(0.55, 0.19, 0.18);
  const neck = new THREE.SphereGeometry(1, 10, 8);
  neck.scale(0.18, 0.11, 0.1);
  neck.translate(0.5, 0.08, 0);
  const head = new THREE.SphereGeometry(0.09, 10, 8);
  head.scale(1.2, 1, 0.9);
  head.translate(0.66, 0.12, 0);
  const bill = new THREE.ConeGeometry(0.035, 0.6, 6);
  bill.rotateZ(-Math.PI / 2 - 0.08);
  bill.scale(1, 0.6, 1.2);
  bill.translate(1.02, 0.07, 0);
  const pouch = new THREE.SphereGeometry(1, 8, 6);
  pouch.scale(0.22, 0.05, 0.04);
  pouch.translate(0.9, 0.01, 0);
  const tail = new THREE.ConeGeometry(0.12, 0.25, 5);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 0.3, 1);
  tail.translate(-0.62, 0.02, 0);
  const parts = [prep(body, 0xf7f2ec), prep(neck, 0xf7f2ec), prep(head, 0xffffff), prep(bill, 0xf1a73c), prep(pouch, 0xf6c04c), prep(tail, 0xf0ebe4)];
  for (const s of [-1, 1]) parts.push(wingGeometry(0.12, 1.55, 0.62, 0.32, 0xf7f3ee, 0x17171b, 0.72, s, true));
  return mergeGeometries(parts);
}

function flapMaterial(freq, amp, glide, root, key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = flapUniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float fph = 0.0;
      #ifdef USE_INSTANCING
        fph = dot(instanceMatrix[3].xyz, vec3(0.037, 0.011, 0.023));
      #endif
      float span = abs(position.z);
      float wing = step(${root.toFixed(3)} + 0.001, span);
      float side = sign(position.z);
      float gl = smoothstep(-0.2, 0.6, sin(uTime * ${glide.toFixed(3)} + fph * 3.0));
      float a = ${amp.toFixed(3)} * sin(uTime * ${freq.toFixed(3)} + fph * 6.0) * gl + 0.08;
      float r = max(span - ${root.toFixed(3)}, 0.0);
      float a2 = a * (1.0 + 0.8 * smoothstep(0.3, 1.0, r / ${(1).toFixed(3)}));
      transformed.y = position.y + wing * sin(a2) * r;
      transformed.z = mix(position.z, side * (${root.toFixed(3)} + cos(a2) * r), wing);`
    );
  };
  mat.customProgramCacheKey = () => `flap-${key}`;
  return mat;
}

export function createLife(scene, island) {
  const rand = mulberry32(31);
  const group = new THREE.Group();
  group.name = 'life';
  scene.add(group);

  // ---------- gulls ----------
  const gullCount = 16;
  const gulls = new THREE.InstancedMesh(gullGeometry(), flapMaterial(9, 0.75, 0.7, 0.04, 'gull'), gullCount);
  gulls.frustumCulled = false;
  group.add(gulls);
  const gullData = [];
  for (let i = 0; i < gullCount; i++) {
    const follow = i < 5;
    const th = rand() * TAU;
    const R = island.coastR(th) + (rand() - 0.3) * 40;
    gullData.push({
      follow,
      cx: Math.cos(th) * R,
      cz: Math.sin(th) * R,
      radius: follow ? 8 + rand() * 14 : 14 + rand() * 30,
      height: follow ? 9 + rand() * 9 : 10 + rand() * 22,
      speed: (0.25 + rand() * 0.25) * (rand() < 0.5 ? -1 : 1),
      phase: rand() * TAU,
      scale: 0.9 + rand() * 0.4,
    });
  }

  // ---------- pelican squadron (V formation) ----------
  const flockN = 7;
  const flock = new THREE.InstancedMesh(flyingPelicanGeometry(), flapMaterial(4.2, 0.45, 0.35, 0.12, 'pelican'), flockN);
  flock.frustumCulled = false;
  group.add(flock);

  // ---------- leaping fish ----------
  const fishGeo = createFishGeometry();
  const fishMat = fishMaterial();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.75, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const jumps = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(fishGeo, fishMat);
    f.scale.setScalar(0.42);
    f.visible = false;
    f.castShadow = true;
    const r1 = new THREE.Mesh(ringGeo, ringMat.clone());
    const r2 = new THREE.Mesh(ringGeo, ringMat.clone());
    r1.visible = r2.visible = false;
    r1.renderOrder = r2.renderOrder = 2;
    group.add(f, r1, r2);
    jumps.push({ fish: f, r1, r2, t: -1, p0: V(0, 0, 0), dir: V(1, 0, 0), dur: 1.1, h: 1.3, splashed: false, t2: -1 });
  }
  let nextJump = 3;

  // ---------- fireflies ----------
  const ffN = 90;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(ffN * 3);
  const ffSeed = new Float32Array(ffN);
  for (let i = 0; i < ffN; i++) {
    ffPos.set([(rand() - 0.5) * 60, 0.3 + rand() * 2.2, (rand() - 0.5) * 60], i * 3);
    ffSeed[i] = rand() * 100;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
  const ffMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glowTexture(64) }, uAlpha: { value: 0 }, uCenter: { value: V(0, 0, 0) }, uScale: { value: 400 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uScale; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.6 + aSeed) * 1.5; p.z += cos(uTime * 0.5 + aSeed * 1.3) * 1.5; p.y += sin(uTime * 0.9 + aSeed * 2.1) * 0.4;
        vec3 w = uCenter + mod(p - uCenter + 30.0, 60.0) - 30.0;
        w.y = uCenter.y + p.y;
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        vA = pow(max(0.0, sin(uTime * 1.7 + aSeed * 7.0)), 3.0);
        gl_PointSize = 0.35 * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uAlpha; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.0, 0.92, 0.45) * 3.0 * t.a * vA * uAlpha, 1.0); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  group.add(fireflies);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const flockDir = new THREE.Vector3();
  let flockTh = 0;
  const listeners = [];

  function launchJump(riderPos, right, camPos) {
    const j = jumps.find((k) => k.t < 0 && k.t2 < 0);
    if (!j) return;
    for (let tries = 0; tries < 12; tries++) {
      const dist = 18 + Math.random() * 45;
      const along = (Math.random() - 0.3) * 50;
      tmp.copy(riderPos).addScaledVector(right, dist);
      tmp.x += (Math.random() - 0.5) * 10 + along * right.z;
      tmp.z += (Math.random() - 0.5) * 10 - along * right.x;
      if (island.heightAt(tmp.x, tmp.z) < -1.2) {
        j.p0.set(tmp.x, 0, tmp.z);
        const a = Math.random() * TAU;
        j.dir.set(Math.cos(a), 0, Math.sin(a));
        j.t = 0;
        j.dur = 0.9 + Math.random() * 0.5;
        j.h = 0.9 + Math.random() * 0.9;
        j.splashed = false;
        j.fish.visible = true;
        splashAt(j, j.r1, j.p0);
        listeners.forEach((fn) => fn({ type: 'splash', pos: j.p0.clone(), dist: j.p0.distanceTo(camPos), big: false }));
        return;
      }
    }
  }
  function splashAt(j, ring, pos) {
    ring.position.set(pos.x, 0.03, pos.z);
    ring.visible = true;
    ring.userData.t = 0;
  }

  return {
    group,
    onEvent(fn) {
      listeners.push(fn);
    },
    update(dt, t, { riderPos, riderRight, camPos, night, viewportScale }) {
      flapUniforms.uTime.value = t;

      // gulls
      for (let i = 0; i < gullCount; i++) {
        const g = gullData[i];
        const ang = t * g.speed + g.phase;
        const cx = g.follow ? riderPos.x : g.cx;
        const cz = g.follow ? riderPos.z : g.cz;
        const baseY = g.follow ? Math.max(riderPos.y, 0) : 0;
        p.set(cx + Math.cos(ang) * g.radius, baseY + g.height + Math.sin(t * 0.7 + g.phase) * 1.5, cz + Math.sin(ang) * g.radius);
        // forward (+X) follows the circle tangent; bank toward the circle centre
        const sg = Math.sign(g.speed);
        e.set(0.35 * sg, Math.atan2(-sg * Math.cos(ang), -sg * Math.sin(ang)), 0);
        q.setFromEuler(e);
        s.setScalar(g.scale);
        m.compose(p, q, s);
        gulls.setMatrixAt(i, m);
      }
      gulls.instanceMatrix.needsUpdate = true;

      // pelican squadron: big loop around the island
      flockTh -= dt * 0.028;
      const R = 250;
      const cx = Math.cos(flockTh) * R;
      const cz = Math.sin(flockTh) * R;
      flockDir.set(Math.sin(flockTh), 0, -Math.cos(flockTh));
      const side = V(-flockDir.z, 0, flockDir.x);
      const yaw = Math.atan2(-flockDir.z, flockDir.x);
      for (let i = 0; i < flockN; i++) {
        const rank = Math.ceil(i / 2);
        const sgn = i === 0 ? 0 : i % 2 ? 1 : -1;
        p.set(cx, 52 + Math.sin(t * 0.5 + i) * 0.8, cz).addScaledVector(flockDir, -rank * 3.4).addScaledVector(side, sgn * rank * 3.0);
        e.set(0, yaw, Math.sin(t * 0.3 + i * 0.4) * 0.05);
        q.setFromEuler(e);
        s.setScalar(1.15);
        m.compose(p, q, s);
        flock.setMatrixAt(i, m);
      }
      flock.instanceMatrix.needsUpdate = true;

      // leaping fish
      nextJump -= dt;
      if (nextJump <= 0) {
        launchJump(riderPos, riderRight, camPos);
        nextJump = 3 + Math.random() * 5;
      }
      for (const j of jumps) {
        if (j.t >= 0) {
          j.t += dt;
          const k = j.t / j.dur;
          if (k >= 1) {
            j.t = -1;
            j.fish.visible = false;
            tmp.copy(j.p0).addScaledVector(j.dir, 1.8);
            splashAt(j, j.r2, tmp);
            listeners.forEach((fn) => fn({ type: 'splash', pos: tmp.clone(), dist: tmp.distanceTo(camPos), big: true }));
          } else {
            j.fish.position.copy(j.p0).addScaledVector(j.dir, k * 1.8);
            j.fish.position.y = 4 * j.h * k * (1 - k) - 0.1;
            const vy = 4 * j.h * (1 - 2 * k);
            const pitch = Math.atan2(vy, 1.8);
            j.fish.rotation.set(0, Math.atan2(-j.dir.z, j.dir.x), pitch * 0.9, 'YZX');
            j.fish.rotation.x = Math.sin(t * 25) * 0.25;
          }
        }
        for (const r of [j.r1, j.r2]) {
          if (!r.visible) continue;
          r.userData.t += dt;
          const k = r.userData.t / 1.4;
          if (k >= 1) {
            r.visible = false;
            continue;
          }
          r.scale.setScalar(0.25 + k * 2.2);
          r.material.opacity = (1 - k) * 0.7;
        }
      }

      // fireflies
      ffMat.uniforms.uTime.value = t;
      ffMat.uniforms.uCenter.value.copy(riderPos);
      ffMat.uniforms.uAlpha.value = smoothstep(0.3, 0.9, night);
      ffMat.uniforms.uScale.value = viewportScale;
      fireflies.visible = night > 0.3;
      gulls.visible = night < 0.85;
      flock.visible = night < 0.9;
    },
  };
}
