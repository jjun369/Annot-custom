import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'public', 'pagedock-mark.svg');
const buildDirectory = path.join(projectRoot, 'build');
const svg = await readFile(sourcePath);
await mkdir(buildDirectory, { recursive: true });
const execFileAsync = promisify(execFile);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(sizes.map((size) => (
  sharp(svg).resize(size, size).png().toBuffer()
)));

await writeFile(path.join(buildDirectory, 'icon.png'), pngBuffers.at(-1));
await writeFile(path.join(buildDirectory, 'icon.ico'), await pngToIco(pngBuffers));

if (process.platform === 'darwin') {
  const iconsetDirectory = path.join(buildDirectory, 'icon.iconset');
  await rm(iconsetDirectory, { recursive: true, force: true });
  await mkdir(iconsetDirectory, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(
      path.join(iconsetDirectory, `icon_${size}x${size}.png`),
      await sharp(svg).resize(size, size).png().toBuffer(),
    );
    await writeFile(
      path.join(iconsetDirectory, `icon_${size}x${size}@2x.png`),
      await sharp(svg).resize(size * 2, size * 2).png().toBuffer(),
    );
  }
  await execFileAsync('iconutil', [
    '--convert', 'icns',
    '--output', path.join(buildDirectory, 'icon.icns'),
    iconsetDirectory,
  ]);
  await rm(iconsetDirectory, { recursive: true, force: true });
}

console.log(`Built PageDock icons: ${sizes.join(', ')}px${process.platform === 'darwin' ? ' + icns' : ''}`);
