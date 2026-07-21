import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, "..", "public");
const background = [189, 93, 60, 255];
const foreground = [255, 250, 243, 255];

await mkdir(outputDir, { recursive: true });
for (const size of [192, 512]) {
  await writeFile(path.join(outputDir, `icon-${size}.png`), createIcon(size));
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const supersampling = 4;
  const shapes = [
    [148, 128, 364, 184, 28],
    [126, 150, 184, 270, 29],
    [148, 232, 356, 286, 27],
    [328, 256, 386, 362, 29],
    [148, 330, 364, 386, 28]
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let backgroundCoverage = 0;
      let foregroundCoverage = 0;
      for (let sy = 0; sy < supersampling; sy += 1) {
        for (let sx = 0; sx < supersampling; sx += 1) {
          const px = (x + (sx + 0.5) / supersampling) / scale;
          const py = (y + (sy + 0.5) / supersampling) / scale;
          if (insideRoundedRect(px, py, 0, 0, 512, 512, 112)) backgroundCoverage += 1;
          if (shapes.some((shape) => insideRoundedRect(px, py, ...shape))) foregroundCoverage += 1;
        }
      }
      const samples = supersampling * supersampling;
      const bgAlpha = backgroundCoverage / samples;
      const fgAlpha = foregroundCoverage / samples;
      const offset = (y * size + x) * 4;
      const visibleForeground = fgAlpha * bgAlpha;
      pixels[offset] = Math.round(background[0] * (1 - visibleForeground) + foreground[0] * visibleForeground);
      pixels[offset + 1] = Math.round(background[1] * (1 - visibleForeground) + foreground[1] * visibleForeground);
      pixels[offset + 2] = Math.round(background[2] * (1 - visibleForeground) + foreground[2] * visibleForeground);
      pixels[offset + 3] = Math.round(255 * bgAlpha);
    }
  }
  return encodePng(size, size, pixels);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius));
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
