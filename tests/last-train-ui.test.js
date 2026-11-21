import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CREW, createGame, startGame } from '../public/last-train-home/src/engine.js';

const gameSource = fs.readFileSync(
  new URL('../public/last-train-home/src/game.js', import.meta.url),
  'utf8'
);

const slice = gameSource.slice(
  gameSource.indexOf('function readBestScore('),
  gameSource.indexOf('function togglePause(')
);

function createUiContext(initialBest = null) {
  const store = new Map();
  if (initialBest !== null) store.set('last-train-best', initialBest);
  const elements = new Map();
  const makeEl = () => ({
    textContent: '',
    disabled: false,
    className: '',
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    addEventListener() {},
    querySelector(sel) {
      if (!this._children) this._children = {};
      if (!this._children[sel]) this._children[sel] = { src: '', textContent: '' };
      return this._children[sel];
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
  });
  const shop = makeEl();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl());
    return elements.get(id);
  };
  const state = createGame(7);
  startGame(state);

  const ctx = vm.createContext({
    CREW,
    SLOTS: [],
    state,
    shop,
    slotControls: { children: [] },
    art: Object.fromEntries(Object.keys(CREW).map((id) => [id, { src: `${id}.webp` }])),
    shopSignature: '',
    shownEnd: false,
    lastMessage: '',
    $,
    setOverlay: () => {},
    beep: () => {},
    selectCrew: () => false,
    updateUI: () => {},
    document: {
      body: { classList: { toggle() {} } },
      createElement: () => makeEl(),
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  });

  vm.runInContext(slice, ctx);
  return { ctx, shop, $, store };
}

test('暂停与恢复时商店按钮的禁用状态会同步更新', () => {
  const { ctx, shop } = createUiContext();
  ctx.renderShop();
  assert.equal(shop.children.length, 3);
  assert.deepEqual(shop.children.map((b) => b.disabled), [false, false, false]);

  ctx.state.paused = true;
  ctx.renderShop();
  assert.deepEqual(shop.children.map((b) => b.disabled), [true, true, true]);

  ctx.state.paused = false;
  ctx.renderShop();
  assert.deepEqual(shop.children.map((b) => b.disabled), [false, false, false]);
});

test('损坏的本地最高分记录不会渲染或覆盖为 NaN', () => {
  for (const bad of ['corrupt', 'NaN', '-42', 'Infinity']) {
    const { ctx, $, store } = createUiContext(bad);
    assert.equal(ctx.readBestScore(), 0);
    ctx.state.status = 'won';
    ctx.state.score = 180;
    ctx.endIfNeeded();
    assert.equal($('best').textContent, 'BEST 180');
    assert.equal(store.get('last-train-best'), '180');
  }
});
