import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source = process.argv[2];
if (!source) {
  throw new Error('Usage: node scripts/sync-last-train.mjs /absolute/path/to/last-train-home');
}

const from = resolve(source);
const to = resolve('public/last-train-home');
const files = ['index.html', 'cover.webp', 'src/engine.js', 'src/game.js', 'src/style.css', 'src/tokens.css'];
const documents = { 'GDD.md': 'docs/last-train-home-GDD.md', 'QA.md': 'docs/last-train-home-QA.md', 'ART.md': 'docs/last-train-home-ART.md' };

for (const file of files) {
  mkdirSync(resolve(to, file, '..'), { recursive: true });
  copyFileSync(join(from, file), join(to, file));
}

for (const [file, target] of Object.entries(documents)) {
  copyFileSync(join(from, file), resolve(target));
}

for (const file of readdirSync(join(from, 'art/game'))) {
  mkdirSync(join(to, 'art/game'), { recursive: true });
  copyFileSync(join(from, 'art/game', file), join(to, 'art/game', file));
}

const sourceArt = resolve('assets-source/last-train-home');
mkdirSync(sourceArt, { recursive: true });
for (const file of readdirSync(join(from, 'art/source'))) {
  copyFileSync(join(from, 'art/source', file), join(sourceArt, file));
}

const test = readFileSync(join(from, 'tests/engine.test.js'), 'utf8');
mkdirSync(resolve('tests'), { recursive: true });
writeFileSync(resolve('tests/last-train-home.test.js'), test.replace("'../src/engine.js'", "'../public/last-train-home/src/engine.js'"));

console.log(`Synced ${files.length} game files, 10 art images and ${Object.keys(documents).length} documents from ${from}`);
