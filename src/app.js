import * as THREE from 'three';
import './style.css';
import { createIsland } from './world/island.js';
import { createSky } from './world/sky.js';
import { createWater } from './world/water.js';
import { createProps } from './world/props.js';
import { createLife } from './world/life.js';
import { createRider } from './rider/rider.js';
import { createCameraDirector, SHOT_LABELS } from './camera.js';
import { createPost } from './fx/post.js';
import { createParticles } from './fx/particles.js';
import { createAudioEngine } from './audio/audio.js';
import { createUI } from './ui.js';
import { nextFrame, clamp } from './lib/math.js';
import { glowTexture } from './lib/textures.js';

const QUALITY = {
  low: { dpr: 1, shadow: 0, msaa: false, bloom: false, grass: 0.3 },
  medium: { dpr: 1.5, shadow: 1024, msaa: true, bloom: true, grass: 0.65 },
  high: { dpr: 2, shadow: 2048, msaa: true, bloom: true, grass: 1 },
};
const CAMERA_ORDER = ['chase', 'cinematic', 'orbit', 'pov'];
const CAMERA_NAMES = { chase: '追随镜头', cinematic: '电影镜头 · 自动切换机位', orbit: '环绕镜头 · 拖拽旋转 / 滚轮缩放', pov: '鹈鹕视角' };

function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  return coarse || small ? 'medium' : 'high';
}

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const state = {
    started: false,
    timelapse: false,
    targetKmh: 18,
    muted: false,
    music: true,
    party: false,
    quality: QUALITY[params.get('q')] ? params.get('q') : detectQuality(),
    dprScale: 1,
  };

  const actions = {};
  const ui = createUI({
    onAction: (a) => actions[a]?.(),
    onSpeed: (kmh) => setSpeed(kmh, false),
    onTime: (h, fromPreset) => setTime(h, fromPreset),
    onTimelapse: (on) => (state.timelapse = on),
    onCamera: (m) => setCamera(m),
    onAccessory: (name, on) => setAccessory(name, on),
    onQuality: (q) => setQuality(q),
    onKey: (k) => handleKey(k),
  });

  if (!hasWebGL2()) {
    ui.fatal('你的浏览器不支持 WebGL 2，无法显示 3D 场景。请换用新版 Chrome / Edge / Safari / Firefox。');
    return;
  }

  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const q0 = QUALITY[state.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q0.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 80, 260);
  camera.lookAt(0, 0, 0);

  const timings = {};
  let tMark = performance.now();
  const mark = (name) => {
    const now = performance.now();
    timings[name] = Math.round(now - tMark);
    tMark = now;
  };

  ui.setLoading(0.06, '正在让小岛从海里升起…');
  await nextFrame();
  mark('boot');
  const island = createIsland();
  scene.add(island.terrain, island.roadMesh);
  mark('island');

  ui.setLoading(0.3, '正在调配天空与海水…');
  await nextFrame();
  const sky = createSky(renderer, scene, { shadowSize: q0.shadow });
  const water = createWater(island);
  scene.add(water.mesh);
  mark('sky');

  ui.setLoading(0.42, '正在种下椰子树和野花…');
  await nextFrame();
  const props = createProps(island);
  props.setGrassDensity(q0.grass);
  scene.add(props.group);
  mark('props');

  ui.setLoading(0.64, '正在孵化鹈鹕、给轮胎打气…');
  await nextFrame();
  const rider = createRider(scene, island.road);
  rider.setTargetSpeed(0);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.8),
    new THREE.MeshBasicMaterial({ map: glowTexture(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.5)'), color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0.02, 0.025, 0);
  blob.renderOrder = 2;
  rider.rig.add(blob);
  const life = createLife(scene, island);
  const particles = createParticles(scene);
  const director = createCameraDirector(camera, canvas, rider, island);
  const post = createPost(renderer, scene, camera, q0);
  const audio = createAudioEngine();
  mark('rider');

  ui.setLoading(0.8, '正在编译着色器…');
  await nextFrame();

  // ---------- helpers ----------
  function viewportScale() {
    return renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  function applySize() {
    const q = QUALITY[state.quality];
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.dpr) * state.dprScale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    post.setSize(window.innerWidth, window.innerHeight);
  }
  function setSpeed(kmh, syncUI = true) {
    state.targetKmh = clamp(kmh, 0, 40);
    if (state.started) rider.setTargetSpeed(state.targetKmh / 3.6);
    if (syncUI) ui.setSpeedTarget(state.targetKmh);
  }
  function setTime(h, sync = true) {
    sky.setTime(h);
    if (sync) ui.setTime(sky.state.hours);
    else ui.setTime(h);
  }
  function setCamera(m) {
    director.setMode(m);
    ui.setCamera(m);
    ui.toast(CAMERA_NAMES[m], 1800);
  }
  function setAccessory(name, on) {
    const worn = (obj, fallback) => obj.userData.wanted ?? fallback;
    if (name === 'helmet') rider.pelican.setAccessories({ helmet: on, glasses: worn(rider.pelican.glasses, false) });
    if (name === 'glasses') rider.pelican.setAccessories({ helmet: worn(rider.pelican.helmet, true), glasses: on });
    if (name === 'scarf') {
      rider.scarf.setVisible(on);
      rider.scarf.reset();
    }
    ui.setAccessory(name, on);
  }
  function setQuality(name) {
    state.quality = name;
    state.dprScale = 1;
    const q = QUALITY[name];
    sky.setShadowSize(q.shadow);
    props.setGrassDensity(q.grass);
    post.setQuality(q);
    applySize();
    ui.setQuality(name);
    ui.toast({ low: '画质：流畅', medium: '画质：均衡', high: '画质：精美' }[name], 1400);
  }
  function takePhoto() {
    document.body.classList.add('photo');
    audio.shutter?.();
    post.render(0);
    canvas.toBlob((blob) => {
      if (blob) {
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        a.href = URL.createObjectURL(blob);
        a.download = `pelican-bicycle-${ts}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      ui.flash();
      setTimeout(() => document.body.classList.remove('photo'), 350);
      ui.toast('已保存截图 📸', 1800);
    }, 'image/png');
  }
  function toggleSound() {
    state.muted = !state.muted;
    audio.setMuted?.(state.muted);
    ui.setSound(!state.muted);
  }
  function toggleMusic() {
    state.music = !state.music;
    audio.setMusicEnabled?.(state.music);
    ui.setMusic(state.music);
  }
  function feed() {
    if (rider.feed()) ui.pulse('feed');
    else if (rider.state.basketLeft === 0) ui.toast('鱼篓空了，等渔夫补货…', 1600);
  }
  function hop() {
    if (rider.hop()) ui.pulse('hop');
  }

  Object.assign(actions, {
    bell: () => {
      rider.ringBell();
      ui.pulse('bell');
    },
    feed,
    hop,
    wave: () => {
      if (rider.wave()) ui.pulse('wave');
    },
    photo: takePhoto,
    sound: toggleSound,
    music: toggleMusic,
    help: () => ui.toggleHelp(),
    'help-close': () => ui.toggleHelp(false),
    fullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    },
    hide: () => document.body.classList.toggle('ui-hidden'),
    panel: () => ui.togglePanel(),
  });

  function handleKey(k) {
    if (!state.started) return;
    switch (k) {
      case 'w':
      case 'ArrowUp':
        setSpeed(state.targetKmh + 2);
        break;
      case 's':
      case 'ArrowDown':
        setSpeed(state.targetKmh - 2);
        break;
      case ' ':
        hop();
        break;
      case 'b':
        actions.bell();
        break;
      case 'f':
        feed();
        break;
      case 'e':
        actions.wave();
        break;
      case 'c':
        setCamera(CAMERA_ORDER[(CAMERA_ORDER.indexOf(director.mode) + 1) % CAMERA_ORDER.length]);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        setCamera(CAMERA_ORDER[Number(k) - 1]);
        break;
      case 't':
        state.timelapse = !state.timelapse;
        ui.setTimelapse(state.timelapse);
        ui.toast(state.timelapse ? '时间流逝：开' : '时间流逝：关', 1200);
        break;
      case 'n':
        setTime(sky.state.night > 0.5 ? 17.4 : 21.5);
        break;
      case 'g':
        setAccessory('glasses', !(rider.pelican.glasses.userData.wanted ?? false));
        break;
      case 'h':
        actions.hide();
        break;
      case 'p':
        takePhoto();
        break;
      case 'm':
        toggleSound();
        break;
      case '?':
      case '/':
        ui.toggleHelp();
        break;
      case 'konami':
        state.party = !state.party;
        if (state.party) {
          setAccessory('glasses', true);
          particles.confetti(rider.rig.position.clone().add(new THREE.Vector3(0, 2, 0)), rider.velocity, 220);
          audio.chime?.();
        } else {
          rider.bike.mats.frame.color.set(0x17a597);
        }
        ui.toast(state.party ? '🎉 派对模式！' : '派对结束', 2000);
        break;
    }
  }

  // ---------- events ----------
  const tmpV = new THREE.Vector3();
  const headPos = new THREE.Vector3();
  const lines = {
    bell: ['叮铃铃～', '借过借过！', '叮——'],
    clap: ['好吃！', '再来一条！', '嗝～', '鲜！'],
    wave: ['嗨～', '你好呀！', '看镜头！'],
    lap: ['又一圈！', '风好舒服～'],
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  rider.on('bell', () => {
    audio.bell?.();
    ui.bubble(pick(lines.bell));
  });
  rider.on('feed', () => audio.pop?.());
  rider.on('catch', () => {
    audio.billClap?.(1);
    rider.pelican.mouthWorld(tmpV);
    particles.sparkle(tmpV, 14);
  });
  rider.on('gulp', () => audio.gulp?.());
  rider.on('clap', (n) => {
    audio.billClap?.(3);
    rider.pelican.headWorld(tmpV);
    particles.hearts(tmpV.add(new THREE.Vector3(0, 0.15, 0)), 3);
    ui.bubble(pick(lines.clap));
    ui.setFeedEnabled(rider.state.basketLeft > 0);
    if (n === 1) ui.toast('第一条鱼下肚！鹈鹕的喉囊能装下好几升水', 2600);
  });
  rider.on('refill', () => {
    ui.toast('渔夫补货啦：车篮又装满了鱼', 2000);
    ui.setFeedEnabled(true);
  });
  rider.on('hop', () => audio.whoosh?.());
  rider.on('land', (impact) => {
    audio.thump?.();
    director.kick(Math.min(0.08, impact * 0.02));
    tmpV.copy(rider.rig.position);
    particles.dust(tmpV, rider.forward, 16, 1.2);
    if (Math.random() < 0.6) {
      rider.pelican.headWorld(headPos);
      particles.feather(headPos.add(new THREE.Vector3(0, -0.5, 0)), rider.velocity);
    }
  });
  rider.on('wave', () => {
    ui.bubble(pick(lines.wave));
    audio.whistle?.();
  });
  rider.on('lap', (n) => {
    audio.chime?.();
    tmpV.copy(rider.rig.position).add(new THREE.Vector3(0, 2.2, 0));
    particles.confetti(tmpV, rider.velocity, 160);
    ui.toast(`🎉 完成第 ${n} 圈！`, 2600);
    ui.bubble(pick(lines.lap));
  });
  life.onEvent((e) => {
    if (e.type !== 'splash') return;
    particles.splash(e.pos, e.big);
    const vol = clamp(1 - e.dist / 90, 0, 1);
    if (vol > 0.05) {
      tmpV.copy(e.pos).project(camera);
      audio.splash?.(vol * (e.big ? 1 : 0.6), clamp(tmpV.x, -1, 1));
    }
  });
  director.onShotChange = (name) => {
    if (director.mode === 'cinematic') ui.shotLabel(`镜头 · ${SHOT_LABELS[name]}`);
  };

  window.addEventListener('resize', applySize);
  document.addEventListener('visibilitychange', () => {
    if (!state.started) return;
    if (document.hidden) audio.suspend?.();
    else audio.resume?.();
  });

  // ---------- initial state ----------
  const initialTime = parseFloat(params.get('t'));
  setTime(Number.isFinite(initialTime) ? initialTime : 17.4);
  ui.setQuality(state.quality);
  ui.setSpeedTarget(state.targetKmh);
  rider.update(0.016, 0, { cameraPos: camera.position, heat: 0 });
  director.startIntro();
  sky.update(0.016, camera, rider.rig.position);
  applySize();
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    renderer.compile(scene, camera);
  }
  mark('compile');

  // ---------- loop ----------
  let last = performance.now();
  let time = 0;
  let perfAcc = 0;
  let perfFrames = 0;
  let perfSlow = 0;
  let perfFast = 0;
  function loop(now) {
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));
    time += dt;

    if (state.timelapse) sky.setTime(sky.state.hours + dt / 6);
    rider.night = sky.state.night;
    rider.update(dt, time, { cameraPos: camera.position, heat: sky.state.heat });
    if (state.started) director.update(dt, time);
    sky.update(dt, camera, rider.rig.position);
    water.update(dt, sky.state.palette, sky.state.night);
    props.update(dt, time, sky.state.night);
    const vs = viewportScale();
    life.update(dt, time, { riderPos: rider.rig.position, riderRight: rider.right, camPos: camera.position, night: sky.state.night, viewportScale: vs });
    particles.setViewportScale(vs);
    particles.update(dt);
    if (state.party) rider.bike.mats.frame.color.setHSL((time * 0.25) % 1, 0.75, 0.5);

    const st = rider.state;
    if (state.started) {
      audio.update?.({ dt, speed: st.speed, pedaling: st.pedaling, wheelOmega: st.speed / 0.31, airborne: st.airborne, night: sky.state.night, nearSea: 1 });
      rider.pelican.headWorld(headPos);
      headPos.y += 0.25;
      ui.update(dt, { speed: st.speed, cadence: st.cadenceRPM, distance: st.distance, laps: st.laps, fish: st.fishEaten, hours: sky.state.hours, timelapse: state.timelapse }, camera, headPos);
    }
    post.render(dt);

    // adaptive resolution
    perfAcc += rawDt;
    perfFrames++;
    if (perfAcc > 1) {
      const avg = perfAcc / perfFrames;
      perfAcc = 0;
      perfFrames = 0;
      if (state.started && !document.hidden) {
        perfSlow = avg > 0.026 ? perfSlow + 1 : 0;
        perfFast = avg < 0.0135 ? perfFast + 1 : 0;
        if (perfSlow >= 3 && state.dprScale > 0.6) {
          state.dprScale = Math.max(0.6, state.dprScale - 0.15);
          applySize();
          perfSlow = 0;
        } else if (perfFast >= 6 && state.dprScale < 1) {
          state.dprScale = Math.min(1, state.dprScale + 0.1);
          applySize();
          perfFast = 0;
        }
      }
    }
  }
  renderer.setAnimationLoop(loop);

  function inspect(view) {
    director.setMode('orbit');
    ui.setCamera('orbit');
    const p = rider.rig.position;
    const h = new THREE.Vector3();
    rider.pelican.headWorld(h);
    const c = director.controls;
    const f = rider.forward;
    const r = rider.right;
    const at = (base, fw, rt, upv) => base.clone().addScaledVector(f, fw).addScaledVector(r, rt).add(new THREE.Vector3(0, upv, 0));
    const views = {
      side: [at(p, 0, 3.1, 1.0), at(p, 0, 0, 0.95)],
      left: [at(p, 0, -3.1, 1.0), at(p, 0, 0, 0.95)],
      front: [at(p, 3.0, 1.3, 1.3), at(p, 0, 0, 1.0)],
      rear: [at(p, -3.2, 1.0, 1.6), at(p, 0, 0, 1.0)],
      head: [at(h, 0.32, 0.72, 0.02), at(h, 0.2, 0, -0.04)],
      face: [at(h, 0.95, 0.3, 0.05), at(h, 0.15, 0, -0.03)],
      feet: [at(p, 0.5, 1.2, 0.35), at(p, -0.05, 0, 0.3)],
      top: [at(p, 0.4, 0.3, 6.5), at(p, 0, 0, 0.5)],
      wide: [at(p, -25, 30, 16), at(p, 0, 0, 1.0)],
    };
    const v = views[view];
    if (!v) return;
    camera.position.copy(v[0]);
    director.setOrbitTarget(v[1]);
    c.update();
  }

  ui.setLoading(1, '准备就绪');
  const start = async () => {
    if (state.started) return;
    state.started = true;
    await audio.start?.();
    audio.setMuted?.(state.muted);
    audio.setMusicEnabled?.(state.music);
    ui.hideLoader();
    rider.state.distance = 0;
    rider.state.laps = 0;
    director.startIntro();
    setSpeed(state.targetKmh);
    const cam = params.get('cam');
    if (cam && CAMERA_ORDER.includes(cam)) setTimeout(() => setCamera(cam), 200);
    setTimeout(() => ui.toast('空格跳跃 · F 投喂 · C 切换镜头 · ? 查看全部操作', 4200), 3200);
    if (params.get('hideui') === '1') document.body.classList.add('ui-hidden');
  };
  if (params.get('autostart') === '1') {
    start().then(() => {
      if (params.get('skipintro') === '1') director.skipIntro();
      const sp = parseFloat(params.get('speed'));
      if (Number.isFinite(sp)) setSpeed(sp);
      const view = params.get('view');
      if (view) setTimeout(() => inspect(view), params.get('skipintro') === '1' ? 300 : 7000);
    });
  } else {
    ui.showStart(start);
  }

  window.__pelican = { timings, renderer, scene, camera, rider, director, sky, island, audio, state, setTime, setCamera, takePhoto, inspect };
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('load-text');
  if (el) el.textContent = `出错了：${err.message}`;
});
