export const CREW = {
  guard: { name: '安保', role: '短距连射', cost: 5, damage: 4, interval: .38, range: 205, color: '#58d4d5' },
  sniper: { name: '档案员', role: '远距穿刺', cost: 7, damage: 15, interval: 1.35, range: 370, color: '#ffce68' },
  barista: { name: '咖啡师', role: '范围减速', cost: 8, damage: 5, interval: 1.4, range: 260, color: '#f29652' },
  mechanic: { name: '维修员', role: '持续修车', cost: 9, damage: 2, interval: .9, range: 155, color: '#b2ed8a' }
};

export const SLOTS = [
  { x: 205, y: 475 }, { x: 275, y: 475 },
  { x: 205, y: 545 }, { x: 275, y: 545 },
  { x: 205, y: 610 }, { x: 275, y: 610 }
];

const ENEMIES = {
  walker: { hp: 21, speed: 33, damage: 3, reward: 2, radius: 13, color: '#739c74' },
  runner: { hp: 15, speed: 55, damage: 2, reward: 3, radius: 10, color: '#b8ba6c' },
  brute: { hp: 60, speed: 23, damage: 6, reward: 5, radius: 18, color: '#8e7064' },
  boss: { hp: 310, speed: 17, damage: 12, reward: 20, radius: 30, color: '#a46163' }
};

function rngFactory(seed) {
  let n = seed >>> 0 || 1;
  return () => {
    n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
    return (n >>> 0) / 4294967296;
  };
}

function offers(random) {
  const ids = Object.keys(CREW);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}

export function createGame(seed = Date.now()) {
  const random = rngFactory(seed);
  return {
    status: 'ready', paused: false, wave: 1, waveElapsed: 0, elapsed: 0,
    hp: 100, maxHp: 100, credits: 14, kills: 0, score: 0,
    selected: null, offers: offers(random), slots: [{ id: 'guard', level: 1, cooldown: 0 }, null, null, null, null, null],
    enemies: [], effects: [], spawnClock: 1.1, hornCooldown: 0, bossSpawned: false,
    message: '选队员，再点车厢格位', random, nextEnemyId: 1
  };
}

export function startGame(state) {
  if (state.status !== 'ready') return false;
  state.status = 'playing'; state.message = '第一波来袭';
  return true;
}

export function selectCrew(state, id) {
  if (state.status !== 'playing' || state.paused || !state.offers.includes(id)) return false;
  state.selected = id;
  state.message = `已选${CREW[id].name}，点击空格部署，同类格位可升级`;
  return true;
}

export function placeCrew(state, index) {
  if (state.status !== 'playing' || state.paused || !state.selected || !Number.isInteger(index) || index < 0 || index >= SLOTS.length) return false;
  const config = CREW[state.selected];
  const current = state.slots[index];
  if (state.credits < config.cost) { state.message = '工牌不足'; return false; }
  if (current && (current.id !== state.selected || current.level >= 3)) { state.message = '只可在空格部署或合成同类队员'; return false; }
  state.credits -= config.cost;
  state.slots[index] = current ? { ...current, level: current.level + 1 } : { id: state.selected, level: 1, cooldown: 0 };
  state.message = current ? `${config.name}升到 ${current.level + 1} 级` : `${config.name}已上车`;
  return true;
}

export function reroll(state) {
  if (state.status !== 'playing' || state.paused || state.credits < 2) return false;
  state.credits -= 2;
  const previous = state.offers.join(',');
  for (let i = 0; i < 8; i++) {
    state.offers = offers(state.random);
    if (state.offers.join(',') !== previous) break;
  }
  state.selected = null; state.message = '招募名单已刷新';
  return true;
}

export function repair(state) {
  if (state.status !== 'playing' || state.paused || state.credits < 8 || state.hp >= state.maxHp) return false;
  state.credits -= 8; state.hp = Math.min(state.maxHp, state.hp + 24);
  state.message = '车体修复 24';
  return true;
}

export function horn(state) {
  if (state.status !== 'playing' || state.paused || state.hornCooldown > 0) return false;
  state.hornCooldown = 22;
  let hits = 0;
  for (const enemy of state.enemies) {
    if (Math.hypot(enemy.x - 240, enemy.y - 540) < 320) {
      enemy.hp -= 23; enemy.stun = .9; hits++;
      enemy.x += enemy.side * 25;
      state.effects.push({ kind: 'blast', x: enemy.x, y: enemy.y, life: .45 });
    }
  }
  state.effects.push({ kind: 'horn', x: 240, y: 540, life: .55 });
  state.message = hits ? `鸣笛震退 ${hits} 名感染者` : '鸣笛已响，附近没有目标';
  return true;
}

function spawn(state, kind) {
  const def = ENEMIES[kind];
  const side = state.random() < .5 ? -1 : 1;
  const y = 412 + state.random() * 255;
  state.enemies.push({ id: state.nextEnemyId++, kind, x: side < 0 ? -32 : 512, y,
    hp: def.hp, maxHp: def.hp, stun: 0, attackClock: .7, side, ...def });
}

function finishKills(state) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    if (enemy.hp > 0) continue;
    state.credits += enemy.reward; state.score += enemy.kind === 'boss' ? 100 : 10;
    state.kills++;
    state.effects.push({ kind: 'death', x: enemy.x, y: enemy.y, life: .42 });
    state.enemies.splice(i, 1);
  }
}

function attack(state, unit, slot, dt) {
  unit.cooldown -= dt;
  if (unit.id === 'mechanic' && unit.cooldown <= 0 && state.hp < state.maxHp) {
    state.hp = Math.min(state.maxHp, state.hp + unit.level);
    unit.cooldown = CREW.mechanic.interval;
  }
  if (unit.cooldown > 0) return;
  const def = CREW[unit.id];
  const nearby = state.enemies.filter(enemy => enemy.hp > 0 && Math.hypot(enemy.x - slot.x, enemy.y - slot.y) <= def.range)
    .sort((a, b) => Math.hypot(a.x - 240, a.y - 540) - Math.hypot(b.x - 240, b.y - 540));
  if (!nearby.length) return;
  const target = nearby[0];
  const damage = Math.round(def.damage * (1 + (unit.level - 1) * .6));
  target.hp -= damage;
  if (unit.id === 'barista') {
    target.slow = 1.8;
    for (const other of nearby.slice(1)) {
      if (Math.hypot(other.x - target.x, other.y - target.y) < 66) { other.hp -= Math.round(damage * .65); other.slow = 1.8; }
    }
  }
  if (unit.id === 'sniper') {
    const behind = nearby.find(e => e !== target && Math.abs(e.y - target.y) < 28);
    if (behind) behind.hp -= Math.round(damage * .45);
  }
  state.effects.push({ kind: 'shot', x: slot.x, y: slot.y - 10, toX: target.x, toY: target.y, color: def.color, life: .14 });
  unit.cooldown = def.interval / (1 + (unit.level - 1) * .14);
}

export function tick(state, rawDt) {
  if (state.status !== 'playing' || state.paused) return;
  const dt = Math.max(0, Math.min(rawDt, .1));
  state.elapsed += dt; state.waveElapsed += dt;
  state.hornCooldown = Math.max(0, state.hornCooldown - dt);
  state.effects = state.effects.filter(effect => (effect.life -= dt) > 0);
  if (state.wave === 3 && !state.bossSpawned && state.waveElapsed >= 13) {
    spawn(state, 'boss'); state.bossSpawned = true; state.message = '巨型感染者出现，准备鸣笛';
  }
  if (state.waveElapsed < 28) {
    state.spawnClock -= dt;
    if (state.spawnClock <= 0) {
      const roll = state.random();
      const kind = state.wave >= 2 && roll < .2 ? 'brute' : roll < .45 ? 'runner' : 'walker';
      spawn(state, kind);
      state.spawnClock += Math.max(.55, 1.12 - state.wave * .16) * (.78 + state.random() * .55);
    }
  }
  state.slots.forEach((unit, index) => { if (unit) attack(state, unit, SLOTS[index], dt); });
  finishKills(state);
  for (const enemy of state.enemies) {
    enemy.stun = Math.max(0, (enemy.stun || 0) - dt);
    enemy.slow = Math.max(0, (enemy.slow || 0) - dt);
    if (enemy.stun > 0) continue;
    const dx = 240 - enemy.x, dy = 540 - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 83) {
      const speed = enemy.speed * (enemy.slow > 0 ? .5 : 1);
      enemy.x += dx / distance * speed * dt;
      enemy.y += dy / distance * speed * dt;
    } else {
      enemy.attackClock -= dt;
      if (enemy.attackClock <= 0) {
        state.hp = Math.max(0, state.hp - enemy.damage);
        enemy.attackClock = 1;
        state.effects.push({ kind: 'hit', x: 240, y: 540, life: .26 });
      }
    }
  }
  if (state.hp <= 0) { state.status = 'lost'; state.message = '末班车失守'; return; }
  if (state.waveElapsed >= 28 && state.enemies.length === 0) {
    if (state.wave === 3) { state.status = 'won'; state.score += Math.round(state.hp) * 2; state.message = '下班成功'; }
    else { state.wave++; state.waveElapsed = 0; state.spawnClock = 1.1; state.credits += 10; state.hp = Math.min(state.maxHp, state.hp + 8); state.message = `第 ${state.wave} 波，补给 +10，车体 +8`; }
  }
}
