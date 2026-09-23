import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startGame, selectCrew, placeCrew, reroll, repair, horn, tick } from '../public/last-train-home/src/engine.js';

test('招募扣费、空格部署和同类合成遵守格位规则', () => {
  const game = createGame(1); startGame(game);
  const id = game.offers[0];
  const cost = { guard: 5, sniper: 7, barista: 8, mechanic: 9 }[id];
  assert.equal(selectCrew(game, id), true);
  assert.equal(placeCrew(game, 1), true);
  assert.equal(game.slots[1].id, id);
  assert.equal(game.credits, 14 - cost);
  game.credits = 30;
  assert.equal(placeCrew(game, 1), true);
  assert.equal(game.slots[1].level, 2);
  assert.equal(placeCrew(game, 1), true);
  assert.equal(game.slots[1].level, 3);
  assert.equal(placeCrew(game, 1), false);
  assert.equal(placeCrew(game, -1), false);
});

test('维修上限、费用与鸣笛冷却', () => {
  const game = createGame(2); startGame(game);
  assert.equal(repair(game), false);
  game.hp = 70;
  assert.equal(repair(game), true);
  assert.equal(game.hp, 94);
  assert.equal(game.credits, 6);
  assert.equal(horn(game), true);
  assert.equal(horn(game), false);
  game.maxHp = 10000; game.hp = 10000;
  for (let i = 0; i < 220; i++) tick(game, .1);
  assert.equal(game.hornCooldown, 0);
});

test('三波完整防守能通关，胜利只结算一次', () => {
  const game = createGame(3); startGame(game);
  game.slots = game.slots.map(() => ({ id: 'sniper', level: 3, cooldown: 0 }));
  for (let i = 0; i < 1300 && game.status === 'playing'; i++) tick(game, .1);
  assert.equal(game.status, 'won');
  assert.equal(game.wave, 3);
  assert.ok(game.kills > 30);
  const score = game.score;
  tick(game, .1);
  assert.equal(game.score, score);
});

test('失守后规则停止推进', () => {
  const game = createGame(4); startGame(game);
  game.slots = Array(6).fill(null);
  game.hp = 1;
  for (let i = 0; i < 900 && game.status === 'playing'; i++) tick(game, .1);
  assert.equal(game.status, 'lost');
  const elapsed = game.elapsed;
  tick(game, .1);
  assert.equal(game.elapsed, elapsed);
});

test('暂停期间不能消耗工牌或触发战斗操作', () => {
  const game = createGame(5); startGame(game);
  const id = game.offers[0];
  assert.equal(selectCrew(game, id), true);
  game.hp = 50;
  game.paused = true;
  const credits = game.credits;
  assert.equal(selectCrew(game, game.offers[1]), false);
  assert.equal(placeCrew(game, 1), false);
  assert.equal(reroll(game), false);
  assert.equal(repair(game), false);
  assert.equal(horn(game), false);
  tick(game, 1);
  assert.equal(game.credits, credits);
  assert.equal(game.hp, 50);
  assert.equal(game.elapsed, 0);
});
