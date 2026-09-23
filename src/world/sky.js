import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, smoothstep, mulberry32, createNoise2D } from '../lib/math.js';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const skyFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uGlow;
uniform float uNight;
uniform float uTime;
uniform float uSunDisk;
varying vec3 vDir;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h13(i), h13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 0.0)), h13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(h13(i + vec3(0.0, 0.0, 1.0)), h13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h13(i + vec3(0.0, 1.0, 1.0)), h13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(clamp(y, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uGround, smoothstep(0.0, -0.14, y));
  float sd = max(dot(d, uSunDir), 0.0);
  float band = exp(-abs(y) * 7.0);
  col += uSunColor * (pow(sd, 5.0) * 0.26 + pow(sd, 48.0) * 0.6) * uGlow;
  col += uSunColor * band * (0.2 + 0.55 * pow(sd, 3.0)) * uGlow * 0.32;
  float disk = smoothstep(0.99955, 0.99975, dot(d, uSunDir));
  col += uSunColor * disk * uSunDisk * smoothstep(-0.03, 0.02, y);
  if (uNight > 0.001) {
    vec3 sp = d * 230.0;
    vec3 cell = floor(sp);
    float h = h13(cell);
    vec3 f = fract(sp) - 0.5;
    float star = step(0.992, h) * smoothstep(0.28, 0.0, length(f));
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 5.0) + h * 40.0);
    vec3 sc = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.88, 0.72), fract(h * 91.0));
    float vis = uNight * smoothstep(0.02, 0.25, y);
    col += sc * star * tw * 3.0 * vis;
    float mw = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, 0.81))) * 3.0, 2.0));
    float cloudy = n3(d * 7.0) * 0.6 + n3(d * 21.0) * 0.4;
    col += vec3(0.1, 0.11, 0.19) * mw * vis * (0.35 + 0.9 * cloudy * cloudy);
    float md = dot(d, uMoonDir);
    float moon = smoothstep(0.99952, 0.99968, md);
    float crater = 0.82 + 0.18 * n3(d * 700.0);
    col += vec3(1.0, 0.96, 0.86) * moon * 5.0 * crater * uNight;
    col += vec3(0.42, 0.52, 0.85) * pow(max(md, 0.0), 80.0) * 0.45 * uNight;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Palette keyed by sun elevation (degrees).
const KEYS = [
  { e: -20, zenith: 0x030813, horizon: 0x0c1830, ground: 0x04070d, light: 0x8ea7ff, lightI: 0.65, hemiSky: 0x2a3d66, hemiGround: 0x0c1019, hemiI: 0.5, env: 0.4, exposure: 1.45, glow: 0.0, disk: 0, water: [0x0e3b4d, 0x04172a, 0x9fb7cf] },
  { e: -7, zenith: 0x13224a, horizon: 0x4a3f63, ground: 0x0e121c, light: 0x9aa9ff, lightI: 0.15, hemiSky: 0x3c4674, hemiGround: 0x151922, hemiI: 0.5, env: 0.5, exposure: 1.2, glow: 0.35, disk: 0, water: [0x1d4d60, 0x0a2238, 0xb9c3d6] },
  { e: -1, zenith: 0x28457f, horizon: 0xf08858, ground: 0x242c40, light: 0xff8040, lightI: 0.3, hemiSky: 0x7280ad, hemiGround: 0x3a2e28, hemiI: 0.55, env: 0.7, exposure: 1.1, glow: 1.6, disk: 24, water: [0x3fa5a6, 0x173e62, 0xffe6d2] },
  { e: 5, zenith: 0x3a66b0, horizon: 0xffb274, ground: 0x364459, light: 0xffa258, lightI: 3.0, hemiSky: 0x93a9d8, hemiGround: 0x6a5040, hemiI: 0.55, env: 0.8, exposure: 1.1, glow: 1.25, disk: 30, water: [0x46c2ba, 0x154e78, 0xfff2e4] },
  { e: 16, zenith: 0x3a78c8, horizon: 0xf0d8bc, ground: 0x475d74, light: 0xffd49c, lightI: 3.4, hemiSky: 0xb3cdef, hemiGround: 0x6a5a45, hemiI: 0.62, env: 0.9, exposure: 1.05, glow: 0.8, disk: 34, water: [0x3fd2c4, 0x0f5f8c, 0xf7fbff] },
  { e: 45, zenith: 0x2d6ccf, horizon: 0xb9d6ef, ground: 0x4d6883, light: 0xfff3e0, lightI: 3.6, hemiSky: 0xc2dbf5, hemiGround: 0x6f6048, hemiI: 0.7, env: 1.0, exposure: 1.0, glow: 0.5, disk: 36, water: [0x3ddbc9, 0x0e6593, 0xf7fbff] },
];
const COLOR_FIELDS = ['zenith', 'horizon', 'ground', 'light', 'hemiSky', 'hemiGround'];
const NUM_FIELDS = ['lightI', 'hemiI', 'env', 'exposure', 'glow', 'disk'];
const PRE = KEYS.map((k) => {
  const o = { e: k.e };
  for (const f of COLOR_FIELDS) o[f] = new THREE.Color(k[f]);
  for (const f of NUM_FIELDS) o[f] = k[f];
  o.water = k.water.map((h) => new THREE.Color(h));
  return o;
});

function evalPalette(elev, out) {
  let i = 0;
  while (i < PRE.length - 2 && elev > PRE[i + 1].e) i++;
  const a = PRE[i];
  const b = PRE[i + 1];
  let t = clamp((elev - a.e) / (b.e - a.e), 0, 1);
  t = t * t * (3 - 2 * t);
  for (const f of COLOR_FIELDS) out[f].copy(a[f]).lerp(b[f], t);
  for (const f of NUM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * t;
  for (let k = 0; k < 3; k++) out.water[k].copy(a.water[k]).lerp(b.water[k], t);
  return out;
}

function makeClouds() {
  const rand = mulberry32(42);
  const noise = createNoise2D(rand);
  const parts = [];
  for (let c = 0; c < 26; c++) {
    const ang = rand() * Math.PI * 2;
    const dist = 260 + rand() * 900;
    const cx = Math.cos(ang) * dist;
    const cz = Math.sin(ang) * dist;
    const cy = 120 + rand() * 140;
    const scale = 14 + rand() * 22;
    const blobs = 5 + Math.floor(rand() * 5);
    for (let b = 0; b < blobs; b++) {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        let y = p.getY(i);
        const z = p.getZ(i);
        const n = 1 + 0.18 * noise(x * 2.1 + b * 3.3 + c, z * 2.1 + y * 1.7);
        if (y < 0) y *= 0.35;
        p.setXYZ(i, x * n, y * n, z * n);
      }
      const r = scale * (0.55 + rand() * 0.55) * (b === 0 ? 1.25 : 1);
      g.scale(r * 1.25, r * 0.85, r);
      g.translate(cx + (rand() - 0.5) * scale * 2.6, cy + rand() * scale * 0.35, cz + (rand() - 0.5) * scale * 1.4);
      parts.push(g.index ? g.toNonIndexed() : g);
    }
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

export function createSky(renderer, scene, { shadowSize = 2048 } = {}) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: 1 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uSunDisk: { value: 30 },
  };
  const domeGeo = new THREE.SphereGeometry(1, 48, 24);
  const skyMat = new THREE.ShaderMaterial({ uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const dome = new THREE.Mesh(domeGeo, skyMat);
  dome.scale.setScalar(2600);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  const envScene = new THREE.Scene();
  const envMat = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uSunDisk: { value: 6 }, uNight: { value: 0 } }, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const envDome = new THREE.Mesh(domeGeo, envMat);
  envDome.scale.setScalar(50);
  envScene.add(envDome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = shadowSize > 0;
  sun.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024);
  const sc = sun.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2(0xffffff, 0.00085);

  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: new THREE.Color(0x000000), fog: true });
  const clouds = new THREE.Mesh(makeClouds(), cloudMat);
  clouds.name = 'clouds';
  scene.add(clouds);

  const pal = { water: [new THREE.Color(), new THREE.Color(), new THREE.Color()] };
  for (const f of COLOR_FIELDS) pal[f] = new THREE.Color();
  const state = {
    hours: 17.4,
    elev: 0,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    lightDir: new THREE.Vector3(),
    night: 0,
    heat: 0,
    palette: pal,
  };
  const lastEnvSun = new THREE.Vector3(0, -2, 0);
  let envTimer = 0;
  let forceEnv = true;

  function setTime(hours) {
    state.hours = ((hours % 24) + 24) % 24;
    const a = ((state.hours - 6) / 12) * Math.PI;
    const tilt = 0.5;
    state.sunDir.set(-Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt) + 0.18).normalize();
    state.moonDir.set(Math.cos(a) * 0.9, -Math.sin(a) * 0.85 + 0.12, -0.35).normalize();
    state.elev = THREE.MathUtils.radToDeg(Math.asin(state.sunDir.y));
    evalPalette(state.elev, pal);
    state.night = smoothstep(-2, -10, state.elev);
    state.heat = smoothstep(35, 55, state.elev);

    uniforms.uSunDir.value.copy(state.sunDir);
    uniforms.uMoonDir.value.copy(state.moonDir);
    uniforms.uZenith.value.copy(pal.zenith);
    uniforms.uHorizon.value.copy(pal.horizon);
    uniforms.uGround.value.copy(pal.ground);
    uniforms.uSunColor.value.copy(pal.light);
    if (state.elev < -3) uniforms.uSunColor.value.set(0xff8a4a);
    uniforms.uGlow.value = pal.glow;
    uniforms.uNight.value = state.night;
    uniforms.uSunDisk.value = pal.disk;

    const useMoon = state.elev < -4;
    state.lightDir.copy(useMoon ? state.moonDir : state.sunDir);
    if (!useMoon && state.lightDir.y < 0.03) state.lightDir.y = 0.03;
    state.lightDir.normalize();
    sun.color.copy(pal.light);
    sun.intensity = pal.lightI;
    hemi.color.copy(pal.hemiSky);
    hemi.groundColor.copy(pal.hemiGround);
    hemi.intensity = pal.hemiI;
    scene.fog.color.copy(pal.horizon);
    scene.environmentIntensity = pal.env;
    renderer.toneMappingExposure = pal.exposure;
    cloudMat.emissive.copy(pal.horizon).multiplyScalar(0.28);
    cloudMat.color.setRGB(1, 1, 1).lerp(pal.horizon, 0.15);
  }

  function regenerateEnv() {
    const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    lastEnvSun.copy(state.sunDir);
  }

  setTime(state.hours);

  return {
    state,
    sun,
    hemi,
    dome,
    clouds,
    uniforms,
    setTime,
    setShadowSize(size) {
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
    },
    update(dt, camera, focus) {
      uniforms.uTime.value += dt;
      dome.position.copy(camera.position);
      clouds.rotation.y += dt * 0.0035;
      const snap = 18 / (sun.shadow.mapSize.x || 1024);
      const fx = Math.round(focus.x / snap) * snap;
      const fz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(fx, focus.y, fz);
      sun.position.set(fx, focus.y, fz).addScaledVector(state.lightDir, 70);
      envTimer -= dt;
      if (forceEnv || (envTimer <= 0 && lastEnvSun.angleTo(state.sunDir) > 0.008)) {
        regenerateEnv();
        envTimer = 0.25;
        forceEnv = false;
      }
    },
  };
}
