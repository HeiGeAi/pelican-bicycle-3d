import * as THREE from 'three';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmtClock(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function setRangeFill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

/** Tiny 2D two-bone IK for the loader illustration. */
function ik2(hx, hy, tx, ty, l1, l2, bendSign) {
  const dx = tx - hx;
  const dy = ty - hy;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, l1 + l2 - 0.01);
  const a = Math.atan2(dy, dx);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const b = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const ang = a + b * bendSign;
  return [hx + Math.cos(ang) * l1, hy + Math.sin(ang) * l1];
}

export function createUI(handlers) {
  const els = {
    speed: $('#hud-speed'),
    cadence: $('#hud-cadence'),
    distance: $('#hud-distance'),
    laps: $('#hud-laps'),
    fish: $('#hud-fish'),
    clock: $('#hud-clock'),
    gaugeFill: $('#gauge-fill'),
    speedIn: $('#speed'),
    speedOut: $('#speed-out'),
    todIn: $('#tod'),
    todOut: $('#tod-out'),
    timelapse: $('#timelapse'),
    toast: $('#toast'),
    shot: $('#shot-label'),
    bubbles: $('#bubbles'),
    help: $('#help'),
    panel: $('#panel'),
    loader: $('#loader'),
    loadBar: $('#load-bar'),
    loadText: $('#load-text'),
    start: $('#start'),
    flash: $('#flash'),
    feedBtn: $('[data-action="feed"]'),
  };
  const gaugeLen = els.gaugeFill.getTotalLength();
  els.gaugeFill.style.strokeDasharray = `${gaugeLen}`;
  els.gaugeFill.style.strokeDashoffset = `${gaugeLen}`;

  // ---------- actions ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action) handlers.onAction?.(btn.dataset.action, btn);
    if (btn.dataset.cam) handlers.onCamera?.(btn.dataset.cam);
    if (btn.dataset.acc) {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      handlers.onAccessory?.(btn.dataset.acc, on);
    }
    if (btn.dataset.quality) handlers.onQuality?.(btn.dataset.quality);
    if (btn.dataset.time) {
      handlers.onTime?.(parseFloat(btn.dataset.time), true);
    }
  });
  els.speedIn.addEventListener('input', () => {
    setRangeFill(els.speedIn);
    els.speedOut.textContent = `${els.speedIn.value} km/h`;
    handlers.onSpeed?.(parseFloat(els.speedIn.value));
  });
  els.todIn.addEventListener('input', () => {
    setRangeFill(els.todIn);
    handlers.onTime?.(parseFloat(els.todIn.value), false);
  });
  els.timelapse.addEventListener('change', () => handlers.onTimelapse?.(els.timelapse.checked));
  setRangeFill(els.speedIn);
  setRangeFill(els.todIn);

  // ---------- keyboard ----------
  const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let kIdx = 0;
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    kIdx = k === konami[kIdx] ? kIdx + 1 : k === konami[0] ? 1 : 0;
    if (kIdx === konami.length) {
      kIdx = 0;
      handlers.onKey?.('konami', e);
      return;
    }
    if (k === 'Escape' && !els.help.hidden) {
      ui.toggleHelp(false);
      return;
    }
    if (e.repeat && !['w', 's', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    if ([' ', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    handlers.onKey?.(k, e);
  });

  let hudTimer = 0;
  let toastTimer = 0;
  let shotTimer = 0;
  const bubbles = [];
  const proj = new THREE.Vector3();

  // ---------- loader illustration ----------
  const la = {
    wr: $('#la-wheel-r'),
    wf: $('#la-wheel-f'),
    crank: $('#la-crank'),
    near: $('#la-leg-near'),
    far: $('#la-leg-far'),
    t: 0,
    running: true,
  };
  function animateLoader(now) {
    if (!la.running) return;
    const t = now / 1000;
    const wa = (t * 220) % 360;
    la.wr.setAttribute('transform', `translate(66 122) rotate(${wa})`);
    la.wf.setAttribute('transform', `translate(194 122) rotate(${wa})`);
    const ca = t * 3.2;
    const bbx = 116;
    const bby = 126;
    const px = bbx + Math.cos(ca) * 12;
    const py = bby + Math.sin(ca) * 12;
    const qx = bbx - Math.cos(ca) * 12;
    const qy = bby - Math.sin(ca) * 12;
    la.crank.setAttribute('x1', qx.toFixed(1));
    la.crank.setAttribute('y1', qy.toFixed(1));
    la.crank.setAttribute('x2', px.toFixed(1));
    la.crank.setAttribute('y2', py.toFixed(1));
    const hip = [101, 70];
    const [k1x, k1y] = ik2(hip[0], hip[1], px, py - 3, 34, 31, -1);
    const [k2x, k2y] = ik2(hip[0], hip[1], qx, qy - 3, 34, 31, -1);
    la.near.setAttribute('d', `M${hip[0]} ${hip[1]} L${k1x.toFixed(1)} ${k1y.toFixed(1)} L${px.toFixed(1)} ${(py - 3).toFixed(1)} l7 0`);
    la.far.setAttribute('d', `M${hip[0]} ${hip[1]} L${k2x.toFixed(1)} ${k2y.toFixed(1)} L${qx.toFixed(1)} ${(qy - 3).toFixed(1)} l7 0`);
    requestAnimationFrame(animateLoader);
  }
  requestAnimationFrame(animateLoader);

  const ui = {
    setLoading(p, text) {
      els.loadBar.style.width = `${Math.round(p * 100)}%`;
      els.loadBar.parentElement.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      if (text) els.loadText.textContent = text;
    },
    showStart(onStart) {
      els.loader.classList.add('ready');
      els.start.hidden = false;
      els.start.focus({ preventScroll: true });
      els.start.addEventListener('click', onStart, { once: true });
    },
    hideLoader() {
      els.loader.classList.add('gone');
      document.body.classList.add('started');
      setTimeout(() => {
        els.loader.remove();
        la.running = false;
      }, 900);
    },
    fatal(msg) {
      els.loadText.textContent = msg;
      els.loadBar.style.background = '#e2412e';
    },
    toast(msg, ms = 2600) {
      els.toast.textContent = msg;
      els.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
    },
    shotLabel(text) {
      els.shot.textContent = text;
      els.shot.classList.add('show');
      clearTimeout(shotTimer);
      shotTimer = setTimeout(() => els.shot.classList.remove('show'), 2200);
    },
    bubble(text, ms = 1600) {
      const el = document.createElement('div');
      el.className = 'bubble';
      el.textContent = text;
      els.bubbles.appendChild(el);
      bubbles.push({ el, t: 0, life: ms / 1000 });
      while (bubbles.length > 3) bubbles.shift().el.remove();
    },
    flash() {
      els.flash.classList.remove('go');
      void els.flash.offsetWidth;
      els.flash.classList.add('go');
    },
    pulse(action) {
      const b = $(`.actions [data-action="${action}"]`);
      if (!b) return;
      b.classList.add('pulse');
      setTimeout(() => b.classList.remove('pulse'), 140);
    },
    setCamera(mode) {
      $$('[data-cam]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cam === mode)));
    },
    setQuality(q) {
      $$('[data-quality]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.quality === q)));
    },
    setSound(on) {
      $('[data-action="sound"]').setAttribute('aria-pressed', String(on));
    },
    setMusic(on) {
      $('[data-action="music"]').setAttribute('aria-checked', String(on));
    },
    setAccessory(name, on) {
      const b = $(`[data-acc="${name}"]`);
      if (b) b.setAttribute('aria-pressed', String(on));
    },
    setSpeedTarget(kmh) {
      els.speedIn.value = String(Math.round(kmh));
      els.speedOut.textContent = `${Math.round(kmh)} km/h`;
      setRangeFill(els.speedIn);
    },
    setTime(h) {
      els.todIn.value = String(h);
      els.todOut.textContent = fmtClock(h);
      setRangeFill(els.todIn);
    },
    setTimelapse(on) {
      els.timelapse.checked = on;
    },
    togglePanel() {
      const open = !els.panel.classList.contains('open');
      els.panel.classList.toggle('open', open);
      $('[data-action="panel"]').setAttribute('aria-expanded', String(open));
    },
    toggleHelp(force) {
      const show = force ?? els.help.hidden;
      els.help.hidden = !show;
      if (show) els.help.querySelector('.close').focus({ preventScroll: true });
    },
    setFeedEnabled(on) {
      els.feedBtn.disabled = !on;
    },
    update(dt, s, camera, anchorWorld) {
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.1;
        const kmh = s.speed * 3.6;
        els.speed.textContent = kmh.toFixed(0);
        els.cadence.textContent = s.cadence.toFixed(0);
        els.distance.textContent = (s.distance / 1000).toFixed(2);
        els.laps.textContent = String(s.laps);
        els.fish.textContent = String(s.fish);
        els.clock.textContent = fmtClock(s.hours);
        els.gaugeFill.style.strokeDashoffset = `${gaugeLen * (1 - Math.min(kmh / 45, 1))}`;
        if (s.timelapse) {
          els.todIn.value = String(s.hours);
          setRangeFill(els.todIn);
        }
        els.todOut.textContent = fmtClock(s.hours);
      }
      if (bubbles.length) {
        proj.copy(anchorWorld).project(camera);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const visible = proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
        const x = (proj.x * 0.5 + 0.5) * w;
        const y = (-proj.y * 0.5 + 0.5) * h;
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i];
          b.t += dt;
          if (b.t > b.life) {
            b.el.remove();
            bubbles.splice(i, 1);
            continue;
          }
          const k = b.t / b.life;
          const pop = Math.min(1, b.t / 0.18);
          const scale = 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) + Math.sin(pop * Math.PI) * 0.08;
          const lift = 26 + k * 26 + (bubbles.length - 1 - i) * 40;
          b.el.style.opacity = visible ? String(Math.min(1, (1 - k) * 4)) : '0';
          b.el.style.transform = `translate(${x - 22}px, ${y - lift}px) translateY(-100%) scale(${scale.toFixed(3)})`;
        }
      }
    },
  };
  return ui;
}
