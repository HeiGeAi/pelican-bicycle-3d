import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32, smoothstep, clamp, lerp, wrapAngle, TAU } from '../lib/math.js';
import { roadTexture, detailNoiseTexture } from '../lib/textures.js';

export const WORLD = {
  size: 540,
  segments: 270,
  roadHalf: 2.9,
  capeTheta: 0.62,
  pierTheta: -2.3,
  seed: 923,
};

export function createIsland() {
  const rnd = mulberry32(WORLD.seed);
  const n1 = createNoise2D(rnd);
  const n2 = createNoise2D(rnd);
  const n3 = createNoise2D(rnd);
  const half = WORLD.size / 2;

  function coastBase(th) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    return 168 + 18 * n1(c * 1.2 + 3.1, s * 1.2 - 1.7) + 8 * n2(c * 2.7, s * 2.7);
  }
  function coastR(th) {
    return coastBase(th) + 40 * Math.exp(-((wrapAngle(th - WORLD.capeTheta) / 0.1) ** 2));
  }
  function coastDist(x, z) {
    return coastR(Math.atan2(z, x)) - Math.hypot(x, z);
  }
  function rawHeight(x, z) {
    const r = Math.hypot(x, z);
    const th = Math.atan2(z, x);
    const d = coastR(th) - r;
    if (d <= 0) return -12 * smoothstep(0, -75, d) + 0.3 * n3(x * 0.05, z * 0.05) * smoothstep(0, -8, d);
    const beach = 1.6 * smoothstep(0, 16, d);
    const inland = smoothstep(14, 60, d);
    const hills = (fbm(n1, x * 0.0085, z * 0.0085, 4) * 0.5 + 0.5) * 16;
    const ridges = (1 - Math.abs(fbm(n2, x * 0.016, z * 0.016, 3))) * 6;
    const mountain = 46 * Math.exp(-((r / 72) ** 2)) * (0.8 + 0.4 * fbm(n3, x * 0.02, z * 0.02, 3));
    const micro = fbm(n3, x * 0.07, z * 0.07, 2) * 0.35 * smoothstep(0, 12, d);
    const capeD = wrapAngle(th - WORLD.capeTheta);
    const cape = 7.5 * Math.exp(-((capeD / 0.085) ** 2)) * smoothstep(0, 16, d);
    return beach + inland * (hills + ridges * 0.6 + mountain) + micro + cape;
  }

  // ---------------- road loop (θ decreasing → sea on the rider's right) ----------------
  const NCP = 30;
  const cps = [];
  for (let i = 0; i < NCP; i++) {
    const th = -(i / NCP) * TAU;
    const r = coastBase(th) - 36 - 5 * Math.sin(th * 3 + 1.3);
    cps.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
  }
  const curve = new THREE.CatmullRomCurve3(cps, true, 'centripetal');
  const length = curve.getLength();
  const N = Math.ceil(length / 0.5);
  const ds = length / N;
  const spaced = curve.getSpacedPoints(N);
  let hs = new Float32Array(N);
  for (let i = 0; i < N; i++) hs[i] = rawHeight(spaced[i].x, spaced[i].z);
  for (let pass = 0; pass < 4; pass++) {
    const out = new Float32Array(N);
    const R = 56;
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += hs[(k + N) % N];
    for (let i = 0; i < N; i++) {
      out[i] = acc / (2 * R + 1);
      acc += hs[(i + R + 1) % N] - hs[(i - R + N) % N];
    }
    hs = out;
  }
  for (let i = 0; i < N; i++) hs[i] = Math.max(hs[i], 2.3);

  const P = new Float32Array((N + 1) * 3);
  const T = new Float32Array((N + 1) * 3);
  const K = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    P[i * 3] = spaced[k].x;
    P[i * 3 + 1] = hs[k];
    P[i * 3 + 2] = spaced[k].z;
  }
  const heading = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N;
    const b = (i + 1) % N;
    let tx = P[b * 3] - P[a * 3];
    let ty = P[b * 3 + 1] - P[a * 3 + 1];
    let tz = P[b * 3 + 2] - P[a * 3 + 2];
    const l = Math.hypot(tx, ty, tz);
    tx /= l;
    ty /= l;
    tz /= l;
    T[i * 3] = tx;
    T[i * 3 + 1] = ty;
    T[i * 3 + 2] = tz;
    heading[i] = Math.atan2(tz, tx);
  }
  T.copyWithin(N * 3, 0, 3);
  const kRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = heading[(i - 4 + N) % N];
    const b = heading[(i + 4) % N];
    kRaw[i] = wrapAngle(b - a) / (8 * ds);
  }
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -12; k <= 12; k++) acc += kRaw[(i + k + N) % N];
    K[i] = acc / 25;
  }
  K[N] = K[0];

  const road = {
    length,
    ds,
    N,
    P,
    T,
    sample(s, out) {
      s = ((s % length) + length) % length;
      const f = s / ds;
      const i = Math.min(Math.floor(f), N - 1);
      const t = f - i;
      const j = i + 1;
      out.pos.set(lerp(P[i * 3], P[j * 3], t), lerp(P[i * 3 + 1], P[j * 3 + 1], t), lerp(P[i * 3 + 2], P[j * 3 + 2], t));
      out.tangent.set(lerp(T[i * 3], T[j * 3], t), lerp(T[i * 3 + 1], T[j * 3 + 1], t), lerp(T[i * 3 + 2], T[j * 3 + 2], t)).normalize();
      out.right.set(-out.tangent.z, 0, out.tangent.x).normalize();
      out.curvature = lerp(K[i], K[j], t);
      out.slope = out.tangent.y;
      return out;
    },
  };

  // ---------------- distance-to-road field (1 m cells) ----------------
  const FN = WORLD.size;
  const rDist = new Float32Array(FN * FN).fill(1e6);
  const rH = new Float32Array(FN * FN);
  const RR = 18;
  for (let i = 0; i < N; i++) {
    const px = P[i * 3];
    const pz = P[i * 3 + 2];
    const h = P[i * 3 + 1];
    const cx = Math.floor(px + half);
    const cz = Math.floor(pz + half);
    for (let dz = -RR; dz <= RR; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= FN) continue;
      const wz = gz - half + 0.5 - pz;
      for (let dx = -RR; dx <= RR; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= FN) continue;
        const wx = gx - half + 0.5 - px;
        const d = Math.sqrt(wx * wx + wz * wz);
        const k = gz * FN + gx;
        if (d < rDist[k]) {
          rDist[k] = d;
          rH[k] = h;
        }
      }
    }
  }
  function roadLookup(x, z) {
    const gx = Math.floor(x + half);
    const gz = Math.floor(z + half);
    if (gx < 0 || gz < 0 || gx >= FN || gz >= FN) return { dist: 1e6, h: 0 };
    const k = gz * FN + gx;
    return { dist: rDist[k], h: rH[k] };
  }

  // ---------------- terrain heights ----------------
  const seg = WORLD.segments;
  const step = WORLD.size / seg;
  const VN = seg + 1;
  const grid = new Float32Array(VN * VN);
  for (let iz = 0; iz < VN; iz++) {
    const z = -half + iz * step;
    for (let ix = 0; ix < VN; ix++) {
      const x = -half + ix * step;
      let h = rawHeight(x, z);
      const ri = roadLookup(x, z);
      if (ri.dist < 16) {
        const w = 1 - smoothstep(WORLD.roadHalf + 0.9, WORLD.roadHalf + 11, ri.dist);
        h = lerp(h, ri.h - 0.14, w);
      }
      grid[iz * VN + ix] = h;
    }
  }
  function heightAt(x, z) {
    const fx = (x + half) / step;
    const fz = (z + half) / step;
    if (fx < 0 || fz < 0 || fx >= seg || fz >= seg) return -12;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = grid[iz * VN + ix];
    const b = grid[iz * VN + ix + 1];
    const c = grid[(iz + 1) * VN + ix];
    const d = grid[(iz + 1) * VN + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  function slopeAt(x, z) {
    const e = 1.5;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // ---------------- terrain mesh ----------------
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, grid[i]);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const C = {
    deepBed: new THREE.Color(0x7c8a73),
    bed: new THREE.Color(0xd9c79c),
    wet: new THREE.Color(0xc6ab7c),
    sand: new THREE.Color(0xf0dcae),
    grassA: new THREE.Color(0x76b152),
    grassB: new THREE.Color(0x4f8f3b),
    dry: new THREE.Color(0xb3b764),
    forest: new THREE.Color(0x3d7433),
    rock: new THREE.Color(0x938a7d),
    rockDark: new THREE.Color(0x6c655c),
    dirt: new THREE.Color(0xb49670),
    flowers: new THREE.Color(0xd8c35a),
  };
  const col = new THREE.Color();
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    const d = coastDist(x, z);
    const nA = n1(x * 0.03, z * 0.03);
    const nB = n2(x * 0.11, z * 0.11);
    if (h < -0.15) {
      col.copy(C.bed).lerp(C.deepBed, smoothstep(-0.2, -9, h));
    } else if (h < 0.4) {
      col.copy(C.wet);
    } else if (d < 22 && h < 2.7) {
      col.copy(C.sand).lerp(C.wet, smoothstep(0.9, 0.4, h) * 0.6);
      col.lerp(C.dry, smoothstep(1.9, 2.7, h) * 0.6);
    } else {
      col.copy(C.grassA).lerp(C.grassB, smoothstep(-0.4, 0.6, nA));
      col.lerp(C.dry, smoothstep(0.35, 0.8, nB) * 0.45);
      col.lerp(C.forest, smoothstep(9, 24, h) * 0.7);
      col.lerp(tmpC.copy(C.rock).lerp(C.rockDark, smoothstep(0, 1, nB)), smoothstep(0.22, 0.42, slope));
      col.lerp(C.rock, smoothstep(34, 44, h) * 0.8);
      col.lerp(C.sand, smoothstep(3.2, 2.6, h) * smoothstep(40, 22, d) * 0.5);
    }
    const ri = roadLookup(x, z);
    if (ri.dist < WORLD.roadHalf + 2.2 && h > 0.4) col.lerp(C.dirt, 1 - smoothstep(WORLD.roadHalf + 0.6, WORLD.roadHalf + 2.2, ri.dist));
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const detail = detailNoiseTexture(256, 5);
  detail.repeat.set(95, 95);
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.94, metalness: 0 });
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.receiveShadow = true;
  terrain.name = 'terrain';

  // ---------------- road mesh + curbs ----------------
  const roadMesh = buildRoadMesh(P, T, N, ds);

  // ---------------- water depth texture ----------------
  const DT = 256;
  const depthData = new Uint8Array(DT * DT);
  for (let j = 0; j < DT; j++) {
    for (let i = 0; i < DT; i++) {
      const x = -half + ((i + 0.5) / DT) * WORLD.size;
      const z = -half + ((j + 0.5) / DT) * WORLD.size;
      depthData[j * DT + i] = Math.round(clamp((heightAt(x, z) + 12) / 14, 0, 1) * 255);
    }
  }
  const depthTex = new THREE.DataTexture(depthData, DT, DT, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  const depthRect = new THREE.Vector4(-half, -half, WORLD.size, WORLD.size);

  return {
    terrain,
    roadMesh,
    road,
    heightAt,
    slopeAt,
    coastDist,
    coastR,
    rawHeight,
    roadDist: (x, z) => roadLookup(x, z).dist,
    depthTex,
    depthRect,
    noise: { n1, n2, n3 },
  };
}

function buildRoadMesh(P, T, N, ds) {
  const half = WORLD.roadHalf;
  const group = new THREE.Group();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    const x = P[k * 3];
    const y = P[k * 3 + 1] + 0.02;
    const z = P[k * 3 + 2];
    let rx = -T[k * 3 + 2];
    let rz = T[k * 3];
    const l = Math.hypot(rx, rz);
    rx /= l;
    rz /= l;
    pos.push(x - rx * half, y, z - rz * half, x + rx * half, y, z + rz * half);
    const v = (i * ds) / 8;
    uv.push(0, v, 1, v);
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = roadTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const roadM = new THREE.Mesh(g, mat);
  roadM.receiveShadow = true;
  group.add(roadM);

  // curbs: [inner-bottom, inner-top, outer-top, outer-bottom] per side
  const cp = [];
  const cc = [];
  const ci = [];
  const w = 0.24;
  const hgt = 0.07;
  const base = new THREE.Color(0xd9d4c8);
  const alt = new THREE.Color(0xc9c2b4);
  let vtx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const x = P[k * 3];
      const y = P[k * 3 + 1];
      const z = P[k * 3 + 2];
      let rx = -T[k * 3 + 2];
      let rz = T[k * 3];
      const l = Math.hypot(rx, rz);
      rx = (rx / l) * side;
      rz = (rz / l) * side;
      const e0 = half;
      const e1 = half + w;
      cp.push(x + rx * e0, y - 0.05, z + rz * e0);
      cp.push(x + rx * e0, y + hgt, z + rz * e0);
      cp.push(x + rx * e1, y + hgt, z + rz * e1);
      cp.push(x + rx * e1, y - 0.3, z + rz * e1);
      const c = Math.floor((i * ds) / 2) % 2 ? base : alt;
      for (let q = 0; q < 4; q++) cc.push(c.r, c.g, c.b);
      if (i < N) {
        const a = vtx + i * 4;
        const b = a + 4;
        for (let q = 0; q < 3; q++) {
          if (side > 0) ci.push(a + q, a + q + 1, b + q, a + q + 1, b + q + 1, b + q);
          else ci.push(a + q, b + q, a + q + 1, a + q + 1, b + q, b + q + 1);
        }
      }
    }
    vtx += (N + 1) * 4;
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
  cg.setIndex(ci);
  cg.computeVertexNormals();
  const curbs = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  curbs.receiveShadow = true;
  group.add(curbs);
  return group;
}
