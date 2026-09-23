import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets-source/last-train-home');
const output = join(root, 'public/last-train-home/art/game');
mkdirSync(output, { recursive: true });

const assets = [
  ['battlefield', null, null, 84],
  ['train', [232, 32, 560, 1456], 256, 85],
  ['guard', [376, 236, 544, 876], 192, 86],
  ['sniper', [300, 232, 700, 896], 192, 86],
  ['barista', [360, 96, 704, 1056], 192, 86],
  ['mechanic', [208, 248, 752, 888], 192, 86],
  ['walker', [280, 248, 608, 928], 160, 86],
  ['runner', [204, 260, 724, 872], 160, 86],
  ['brute', [100, 128, 968, 1168], 192, 86],
  ['boss', [16, 88, 1120, 1224], 224, 86]
];

for (const [name, crop, width, quality] of assets) {
  const args = ['-quiet', '-q', String(quality), '-m', '6'];
  if (crop) args.push('-crop', ...crop.map(String));
  if (width) args.push('-resize', String(width), '0');
  args.push(join(source, `${name}.png`), '-o', join(output, `${name}.webp`));
  const result = spawnSync('cwebp', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`cwebp failed for ${name}: ${result.error?.message || result.stderr}`);
  }
}

console.log(`Built ${assets.length} game images in ${output}`);
