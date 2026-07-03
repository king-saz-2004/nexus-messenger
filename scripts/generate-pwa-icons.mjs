import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const sourcePath = path.join(rootDir, 'nexus-logo-source.png');
const logoOutputPath = path.join(rootDir, 'public', 'brand', 'logo', 'nexus-messenger-logo.png');
const iconsDir = path.join(rootDir, 'public', 'icons');
const maskableBackground = '#17212b';

const normalIcons = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];

const maskableIcons = [
  ['maskable-icon-192.png', 192],
  ['maskable-icon-512.png', 512]
];

const transparentBackground = { r: 0, g: 0, b: 0, alpha: 0 };

const isEdgeBackgroundPixel = (data, offset) => {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const brightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);

  return red >= 220 && green >= 220 && blue >= 220 && brightest - darkest <= 18;
};

const ensureSourceLogo = async () => {
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error('Missing ./nexus-logo-source.png. Place the official Nexus Messenger logo at the project root.');
  }
};

const createTransparentLogoBuffer = async () => {
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueueIfBackground = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;

    const index = y * width + x;
    if (visited[index]) return;

    const offset = index * channels;
    if (!isEdgeBackgroundPixel(data, offset)) return;

    visited[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueueIfBackground(x, 0);
    enqueueIfBackground(x, height - 1);
  }

  for (let y = 1; y < height - 1; y += 1) {
    enqueueIfBackground(0, y);
    enqueueIfBackground(width - 1, y);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;

    const x = index % width;
    const y = Math.floor(index / width);

    enqueueIfBackground(x + 1, y);
    enqueueIfBackground(x - 1, y);
    enqueueIfBackground(x, y + 1);
    enqueueIfBackground(x, y - 1);
  }

  for (let index = 0; index < totalPixels; index += 1) {
    if (!visited[index]) continue;
    const alphaOffset = index * channels + 3;
    data[alphaOffset] = 0;
  }

  return sharp(data, { raw: info }).png().toBuffer();
};

const writeNormalIcon = async (logoBuffer, filename, size) => {
  await sharp(logoBuffer)
    .resize(size, size, {
      fit: 'contain',
      background: transparentBackground,
      withoutEnlargement: false
    })
    .png()
    .toFile(path.join(iconsDir, filename));
};

const writeMaskableIcon = async (logoBuffer, filename, size) => {
  const safeLogoSize = Math.round(size * 0.72);
  const centeredLogo = await sharp(logoBuffer)
    .resize(safeLogoSize, safeLogoSize, {
      fit: 'contain',
      background: transparentBackground,
      withoutEnlargement: false
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: maskableBackground
    }
  })
    .composite([{ input: centeredLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(iconsDir, filename));
};

await ensureSourceLogo();
await fs.mkdir(path.dirname(logoOutputPath), { recursive: true });
await fs.mkdir(iconsDir, { recursive: true });
const transparentLogoBuffer = await createTransparentLogoBuffer();
await fs.writeFile(logoOutputPath, transparentLogoBuffer);
await Promise.all(normalIcons.map(([filename, size]) => writeNormalIcon(transparentLogoBuffer, filename, size)));
await Promise.all(maskableIcons.map(([filename, size]) => writeMaskableIcon(transparentLogoBuffer, filename, size)));

console.log('Generated Nexus Messenger PWA logo and icons.');
