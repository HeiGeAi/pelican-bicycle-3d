import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

test('战场美术包完整且适合网页加载', () => {
  const names = ['battlefield', 'train', 'guard', 'sniper', 'barista', 'mechanic', 'walker', 'runner', 'brute', 'boss'];
  let bytes = 0;
  for (const name of names) {
    const path = resolve(`public/last-train-home/art/game/${name}.webp`);
    const data = readFileSync(path);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', `${name} is not WebP`);
    assert.equal(data.toString('ascii', 8, 12), 'WEBP', `${name} is not WebP`);
    bytes += statSync(path).size;
  }
  assert.ok(bytes < 1_000_000, `image bundle too large: ${bytes} bytes`);
});
