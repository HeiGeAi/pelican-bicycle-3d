import { CREW, SLOTS, createGame, startGame, selectCrew, placeCrew, reroll, repair, horn, tick } from './engine.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false });
const overlay = $('overlay');
const shop = $('shop');
const slotControls = $('slot-controls');
let state = createGame();
let speed = 1;
let soundOn = false;
let audioContext;
let last = performance.now();
let shownEnd = false;
let lastMessage = '';
let shopSignature = '';

function beep(freq = 250, duration = .06, gain = .035) {
  if (!soundOn) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const volume = audioContext.createGain();
    osc.type = 'square'; osc.frequency.value = freq;
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    osc.connect(volume).connect(audioContext.destination);
    osc.start(); osc.stop(audioContext.currentTime + duration);
  } catch { soundOn = false; $('sound-btn').textContent = '声音：关'; }
}

function pixelRect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function outline(x, y, w, h, color = '#282b25', line = 3) { ctx.strokeStyle = color; ctx.lineWidth = line; ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function label(text, x, y, size = 13, color = '#f7e7bb', align = 'left') { ctx.fillStyle = color; ctx.font = `bold ${size}px monospace`; ctx.textAlign = align; ctx.fillText(text, x, y); }

const rubble = Array.from({ length: 140 }, (_, i) => ({ x: (i * 173 + 43) % 480, y: (i * 227 + 17) % 720, w: (i % 4) + 2 }));

function drawGround() {
  pixelRect(0, 0, 480, 720, '#8e7654');
  pixelRect(0, 0, 142, 720, '#997b56'); pixelRect(337, 0, 143, 720, '#947752');
  for (const rock of rubble) {
    const y = (rock.y + state.elapsed * 38) % 720;
    pixelRect(rock.x, y, rock.w * 2, rock.w, rock.x % 3 ? '#a88a5c' : '#785f48');
  }
  pixelRect(149, 0, 182, 720, '#4e4e4a');
  pixelRect(158, 0, 164, 720, '#756957');
  for (let y = -55 + (state.elapsed * 45) % 70; y < 720; y += 70) {
    pixelRect(147, y, 186, 12, '#393f40'); pixelRect(153, y + 2, 174, 7, '#6d6354');
  }
  pixelRect(165, 0, 7, 720, '#a6b4a9'); pixelRect(308, 0, 7, 720, '#a6b4a9');
  pixelRect(168, 0, 3, 720, '#e3dbb5'); pixelRect(309, 0, 3, 720, '#e3dbb5');
  pixelRect(28, 63, 20, 13, '#584b40'); pixelRect(43, 53, 10, 20, '#6f5c4a');
  pixelRect(399, 123, 32, 15, '#61513f'); pixelRect(414, 112, 12, 21, '#765f47');
  pixelRect(41, 310, 27, 9, '#6a5945'); pixelRect(420, 364, 28, 12, '#6a5945');
}

function drawTrain() {
  const shake = state.effects.some(e => e.kind === 'hit') ? 2 : 0;
  ctx.save(); ctx.translate(shake, 0);
  pixelRect(140, 410, 200, 282, '#222d30');
  pixelRect(148, 421, 184, 262, '#62717a');
  pixelRect(158, 431, 164, 232, '#d16d34');
  pixelRect(169, 441, 142, 202, '#e78e3b');
  pixelRect(193, 386, 94, 52, '#3c4345');
  pixelRect(201, 376, 78, 62, '#bd592c');
  pixelRect(209, 390, 62, 35, '#ee9d46');
  pixelRect(218, 386, 44, 8, '#ffbd68');
  pixelRect(134, 472, 20, 71, '#465960'); pixelRect(326, 472, 20, 71, '#465960');
  pixelRect(134, 579, 20, 71, '#465960'); pixelRect(326, 579, 20, 71, '#465960');
  for (const slot of SLOTS) {
    pixelRect(slot.x - 23, slot.y - 24, 46, 47, '#564d42');
    pixelRect(slot.x - 19, slot.y - 20, 38, 39, '#263d44');
    outline(slot.x - 20, slot.y - 21, 40, 41, '#e3a14c', 3);
    if (state.selected && state.status === 'playing') outline(slot.x - 24, slot.y - 25, 48, 49, '#55f678', 1);
  }
  pixelRect(193, 650, 94, 40, '#263a40'); pixelRect(211, 658, 58, 14, '#6df0df');
  label('18:00', 240, 669, 11, '#0b2e2f', 'center');
  ctx.restore();
}

function drawCrew(unit, slot) {
  const color = CREW[unit.id].color;
  pixelRect(slot.x - 13, slot.y - 18, 26, 11, '#413325');
  pixelRect(slot.x - 10, slot.y - 20, 20, 18, '#d5b692');
  pixelRect(slot.x - 14, slot.y - 8, 28, 26, color);
  pixelRect(slot.x - 18, slot.y + 3, 8, 12, '#a47d59'); pixelRect(slot.x + 10, slot.y + 3, 8, 12, '#a47d59');
  pixelRect(slot.x - 5, slot.y - 10, 3, 3, '#272b27'); pixelRect(slot.x + 4, slot.y - 10, 3, 3, '#272b27');
  pixelRect(slot.x + 13, slot.y + 3, 16, 5, '#303439');
  if (unit.id === 'sniper') pixelRect(slot.x + 24, slot.y + 2, 12, 2, '#fcd86c');
  if (unit.id === 'barista') pixelRect(slot.x - 15, slot.y - 22, 30, 5, '#51372c');
  if (unit.id === 'mechanic') pixelRect(slot.x - 13, slot.y - 24, 26, 8, '#a6ce62');
  if (unit.level > 1) label(`★${unit.level}`, slot.x, slot.y - 28, 12, '#ffe58d', 'center');
}

function drawZombie(enemy) {
  const x = Math.round(enemy.x), y = Math.round(enemy.y), r = enemy.radius;
  pixelRect(x - r + 2, y + r - 1, r * 2, 5, 'rgba(42,38,35,.35)');
  pixelRect(x - r + 3, y - r, r * 2 - 6, r * 1.1, enemy.color);
  pixelRect(x - r + 5, y + 1, r * 2 - 10, r * 1.1, enemy.kind === 'boss' ? '#573d3a' : '#786b62');
  pixelRect(x - r - 3, y + 3, 7, r, enemy.color); pixelRect(x + r - 4, y + 3, 7, r, enemy.color);
  pixelRect(x - r + 7, y - 5, 4, 4, '#d8efe1'); pixelRect(x + 3, y - 5, 4, 4, '#d8efe1');
  pixelRect(x - r + 7, y + 10, 6, 9, '#414b48'); pixelRect(x + 2, y + 10, 6, 9, '#414b48');
  if (enemy.kind === 'runner') pixelRect(x - r + 1, y - r - 4, r * 2 - 2, 5, '#d4a45b');
  if (enemy.kind === 'brute' || enemy.kind === 'boss') {
    pixelRect(x - r, y - r - 9, r * 2, 5, '#352722');
    pixelRect(x - r, y - r - 9, Math.max(0, r * 2 * enemy.hp / enemy.maxHp), 5, '#ffb000');
  }
}

function drawEffects() {
  for (const effect of state.effects) {
    if (effect.kind === 'shot') {
      ctx.strokeStyle = effect.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(effect.x, effect.y); ctx.lineTo(effect.toX, effect.toY); ctx.stroke();
      pixelRect(effect.toX - 5, effect.toY - 5, 10, 10, '#fff2b6');
    } else if (effect.kind === 'horn') {
      ctx.strokeStyle = `rgba(149,255,178,${effect.life})`; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(effect.x, effect.y, 300 * (1 - effect.life / .55), 0, Math.PI * 2); ctx.stroke();
    } else if (effect.kind === 'death') pixelRect(effect.x - 13, effect.y - 13, 26, 26, '#b8d577');
    else if (effect.kind === 'hit') { ctx.strokeStyle = 'rgba(243,76,46,.7)'; ctx.lineWidth = 12; ctx.strokeRect(8, 8, 464, 704); }
    else if (effect.kind === 'blast') pixelRect(effect.x - 14, effect.y - 14, 28, 28, '#f2ecb2');
  }
}

function draw() {
  drawGround();
  for (const enemy of state.enemies) if (enemy.y < 515) drawZombie(enemy);
  drawTrain();
  state.slots.forEach((unit, index) => { if (unit) drawCrew(unit, SLOTS[index]); });
  for (const enemy of state.enemies) if (enemy.y >= 515) drawZombie(enemy);
  drawEffects();
  pixelRect(13, 14, 118, 34, 'rgba(13,23,17,.88)'); label(`击退 ${state.kills}`, 25, 38, 15, '#d5f5d0');
  pixelRect(349, 14, 118, 34, 'rgba(13,23,17,.88)'); label(`分数 ${state.score}`, 360, 38, 15, '#ffca68');
  if (state.selected && state.status === 'playing') {
    pixelRect(131, 692, 218, 20, 'rgba(13,23,17,.88)');
    label(`部署：${CREW[state.selected].name}`, 240, 707, 12, '#70ffa0', 'center');
  }
}

function setOverlay(title, text, button) {
  $('overlay-title').textContent = title;
  $('overlay-text').textContent = text;
  $('primary-btn').textContent = button;
  overlay.classList.remove('hidden');
}

function renderShop() {
  const signature = `${state.status}|${state.selected}|${state.offers.join(',')}`;
  if (signature === shopSignature) return;
  shopSignature = signature;
  shop.replaceChildren(...state.offers.map(id => {
    const item = CREW[id];
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'card' + (state.selected === id ? ' selected' : '');
    button.disabled = state.status !== 'playing';
    button.innerHTML = `<span class="card-name"></span><span class="card-role"></span><span class="card-cost"></span>`;
    button.querySelector('.card-name').textContent = item.name;
    button.querySelector('.card-role').textContent = item.role;
    button.querySelector('.card-cost').textContent = `${item.cost} 工牌`;
    button.addEventListener('click', () => { if (selectCrew(state, id)) { beep(360); updateUI(); } });
    return button;
  }));
}

function renderSlots() {
  SLOTS.forEach((slot, index) => {
    const button = slotControls.children[index];
    const unit = state.slots[index];
    button.disabled = state.status !== 'playing' || state.paused;
    button.setAttribute('aria-label', `车厢格位 ${index + 1}：${unit ? `${CREW[unit.id].name} ${unit.level} 级` : '空位'}`);
  });
}

function updateUI() {
  document.body.classList.toggle('game-active', state.status === 'playing' && !state.paused);
  $('wave').textContent = `${String(state.wave).padStart(2, '0')} / 03`;
  const secs = Math.floor(state.elapsed);
  $('time').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  $('hp').textContent = `${Math.ceil(state.hp)} / ${state.maxHp}`;
  $('credits').textContent = state.credits;
  $('wave-countdown').textContent = state.status === 'playing' ? (state.waveElapsed < 28 ? `冲击中 ${Math.ceil(28 - state.waveElapsed)}s` : '清理残敌') : '等待发车';
  $('wave-progress').style.width = `${Math.min(100, state.waveElapsed / 28 * 100)}%`;
  $('horn-cooldown').textContent = state.hornCooldown > 0 ? `${Math.ceil(state.hornCooldown)}s` : '就绪';
  $('horn-btn').disabled = state.status !== 'playing' || state.paused || state.hornCooldown > 0;
  $('repair-btn').disabled = state.status !== 'playing' || state.credits < 8 || state.hp >= state.maxHp;
  $('reroll-btn').disabled = state.status !== 'playing' || state.credits < 2;
  $('pause-btn').textContent = state.paused ? '继续' : '暂停';
  $('tip').textContent = state.message;
  if (lastMessage !== state.message) { lastMessage = state.message; if (state.status === 'won') beep(600, .2); }
  renderShop();
  renderSlots();
}

function endIfNeeded() {
  if (shownEnd || (state.status !== 'won' && state.status !== 'lost')) return;
  shownEnd = true;
  let best = state.score;
  try { best = Math.max(Number(localStorage.getItem('last-train-best') || 0), state.score); localStorage.setItem('last-train-best', String(best)); } catch { /* private mode */ }
  $('best').textContent = `BEST ${best}`;
  setOverlay(state.status === 'won' ? '准点下班成功' : '车体失守',
    `本局击退 ${state.kills} 名感染者，获得 ${state.score} 分。${state.status === 'won' ? '末班车穿过了最后一段封锁线。' : '调整队员组合，再守一次末班车。'}`,
    '重新发车');
}

function togglePause() {
  if (state.status !== 'playing') return;
  state.paused = !state.paused;
  if (state.paused) setOverlay('暂停运行', '车体和敌人都已冻结。检查招募计划后继续。', '继续战斗');
  else overlay.classList.add('hidden');
  updateUI();
}

$('primary-btn').addEventListener('click', () => {
  if (state.status === 'ready') startGame(state);
  else if (state.paused) state.paused = false;
  else if (state.status === 'won' || state.status === 'lost') { state = createGame(); startGame(state); shownEnd = false; }
  overlay.classList.add('hidden'); updateUI(); beep(460, .1);
});
$('pause-btn').addEventListener('click', togglePause);
$('horn-btn').addEventListener('click', () => { if (horn(state)) { beep(100, .24, .06); updateUI(); } });
$('repair-btn').addEventListener('click', () => { if (repair(state)) { beep(280); updateUI(); } });
$('reroll-btn').addEventListener('click', () => { if (reroll(state)) { beep(320); updateUI(); } });
$('speed-btn').addEventListener('click', () => { speed = speed === 1 ? 1.5 : 1; $('speed-btn').textContent = `速度 ×${speed}`; $('speed-btn').setAttribute('aria-pressed', String(speed > 1)); });
$('sound-btn').addEventListener('click', () => { soundOn = !soundOn; $('sound-btn').textContent = `声音：${soundOn ? '开' : '关'}`; $('sound-btn').setAttribute('aria-pressed', String(soundOn)); beep(440); });
canvas.addEventListener('pointerdown', event => {
  if (state.status !== 'playing' || state.paused) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  const index = SLOTS.findIndex(slot => Math.abs(slot.x - x) < 26 && Math.abs(slot.y - y) < 28);
  if (index >= 0) { if (placeCrew(state, index)) beep(510); updateUI(); }
});
SLOTS.forEach((slot, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.style.left = `${slot.x / 480 * 100}%`;
  button.style.top = `${slot.y / 720 * 100}%`;
  button.addEventListener('click', () => { if (placeCrew(state, index)) beep(510); updateUI(); });
  slotControls.append(button);
});
window.addEventListener('keydown', event => {
  if (event.code === 'Space') { event.preventDefault(); if (horn(state)) { beep(100, .24, .06); updateUI(); } }
  if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); togglePause(); }
});

try { $('best').textContent = `BEST ${Number(localStorage.getItem('last-train-best') || 0)}`; } catch { /* private mode */ }
updateUI(); draw();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (state.status === 'playing') {
    // Small fixed steps keep combat stable when a tab resumes after sleeping.
    const scaled = dt * speed;
    const steps = Math.ceil(scaled / .05);
    for (let i = 0; i < steps; i++) tick(state, scaled / steps);
    endIfNeeded();
  }
  draw();
  if (Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) updateUI();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
