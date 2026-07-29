import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'public', 'pagedock-mark.svg');
const buildDirectory = path.join(projectRoot, 'build');
const svg = await readFile(sourcePath);
await mkdir(buildDirectory, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(sizes.map((size) => (
  sharp(svg).resize(size, size).png().toBuffer()
)));

await writeFile(path.join(buildDirectory, 'icon.png'), pngBuffers.at(-1));
await writeFile(path.join(buildDirectory, 'icon.ico'), await pngToIco(pngBuffers));
console.log(`Built PageDock icons: ${sizes.join(', ')}px`);
