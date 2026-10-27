import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = path.resolve("public/icons");
fs.mkdirSync(outDir, { recursive: true });

write("icon-192.png", 192, false);
write("icon-512.png", 512, false);
write("icon-maskable-512.png", 512, true);

function write(name, size, maskable) {
  const rgba = render(size, maskable);
  fs.writeFileSync(path.join(outDir, name), encodePng(size, size, rgba));
}

function render(size, maskable) {
  const scale = 4;
  const S = size * scale;
  const px = new Uint8ClampedArray(S * S * 4);
  fill(px, [20, 18, 16, 255]);
  const cx = S / 2;
  const cy = S * 0.5;
  const unit = S * (maskable ? 0.2 : 0.28);
  const amber = [240, 160, 90, 255];
  const mouth = [32, 24, 20, 255];
  const brick = [62, 50, 42, 255];
  fillCircle(px, S, cx, cy - unit * 0.05, unit * 1.05, amber);
  fillRect(px, S, cx - unit * 1.05, cy - unit * 0.05, unit * 2.1, unit * 1.2, amber);
  fillCircle(px, S, cx, cy + unit * 0.02, unit * 0.72, mouth);
  fillRect(px, S, cx - unit * 0.72, cy + unit * 0.02, unit * 1.44, unit * 1.05, mouth);
  fillRect(px, S, cx - unit * 1.22, cy + unit * 1.05, unit * 2.44, unit * 0.22, brick);
  fillCircle(px, S, cx, cy + unit * 0.72, unit * 0.38, [255, 106, 61, 255]);
  fillCircle(px, S, cx, cy + unit * 0.42, unit * 0.24, [255, 186, 96, 255]);
  fillCircle(px, S, cx - unit * 0.02, cy + unit * 0.22, unit * 0.12, [255, 236, 206, 255]);
  return downsample(px, S, size, scale);
}

function fill(px, color) {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = color[3];
  }
}

function fillRect(px, S, x, y, w, h, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(S, Math.ceil(x + w));
  const y1 = Math.min(S, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) set(px, S, xx, yy, color);
  }
}

function fillCircle(px, S, cx, cy, r, color) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(S, Math.ceil(cx + r));
  const y1 = Math.min(S, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) set(px, S, x, y, color);
    }
  }
}

function set(px, S, x, y, color) {
  const i = (y * S + x) * 4;
  px[i] = color[0];
  px[i + 1] = color[1];
  px[i + 2] = color[2];
  px[i + 3] = color[3];
}

function downsample(src, S, size, scale) {
  const out = Buffer.alloc(size * size * 4);
  const samples = scale * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * S + (x * scale + dx)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / samples);
      out[o + 1] = Math.round(g / samples);
      out[o + 2] = Math.round(b / samples);
      out[o + 3] = Math.round(a / samples);
    }
  }
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    raw[start] = 0;
    rgba.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([name, data])) >>> 0, 0);
  return Buffer.concat([length, name, data, crc]);
}
