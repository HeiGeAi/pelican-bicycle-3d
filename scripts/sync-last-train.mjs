import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source = process.argv[2];
if (!source) {
  throw new Error('Usage: node scripts/sync-last-train.mjs /absolute/path/to/last-train-home');
}

const from = resolve(source);
const to = resolve('public/last-train-home');
const files = ['index.html', 'src/engine.js', 'src/game.js', 'src/style.css', 'src/tokens.css'];
const documents = { 'GDD.md': 'docs/last-train-home-GDD.md', 'QA.md': 'docs/last-train-home-QA.md' };

for (const file of files) {
  mkdirSync(resolve(to, file, '..'), { recursive: true });
  copyFileSync(join(from, file), join(to, file));
}

for (const [file, target] of Object.entries(documents)) {
  copyFileSync(join(from, file), resolve(target));
}

console.log(`Synced ${files.length} game files and ${Object.keys(documents).length} documents from ${from}`);
