const path = require('path');
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');

const svgPath = path.resolve(__dirname, '..', 'build', 'icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

const SIZES = [16, 32, 48, 64, 128, 256];
const BMP_MAX_SIZE = 48; // BMP for sizes <= this, PNG for larger

/** Render the SVG at a given pixel width, return PNG buffer. */
function renderPng(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

/** PNG Paeth predictor. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode 8-bit RGBA PNG to raw pixel buffer (all 5 filter types). */
function pngToRgba(pngBuf) {
  let offset = 8;
  let idatChunks = [];
  let width, height;

  while (offset < pngBuf.length) {
    const chunkLen = pngBuf.readUInt32BE(offset);
    const chunkType = pngBuf.toString('ascii', offset + 4, offset + 8);
    const chunkData = pngBuf.slice(offset + 8, offset + 8 + chunkLen);
    offset += 12 + chunkLen;
    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    }
  }

  const zlib = require('zlib');
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));

  const BPP = 4;
  const stride = width * BPP + 1;
  const pixels = Buffer.alloc(width * height * BPP);

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filter = raw[rowStart];

    for (let x = 0; x < width * BPP; x++) {
      const srcIdx = rowStart + 1 + x;
      const dstIdx = y * width * BPP + x;
      const curr = raw[srcIdx] || 0;

      const a = x >= BPP ? pixels[dstIdx - BPP] : 0;
      const b = y > 0 ? pixels[dstIdx - width * BPP] : 0;
      const c = (x >= BPP && y > 0) ? pixels[dstIdx - width * BPP - BPP] : 0;

      switch (filter) {
        case 0: pixels[dstIdx] = curr; break;
        case 1: pixels[dstIdx] = (curr + a) & 0xFF; break;
        case 2: pixels[dstIdx] = (curr + b) & 0xFF; break;
        case 3: pixels[dstIdx] = (curr + ((a + b) >> 1)) & 0xFF; break;
        case 4: pixels[dstIdx] = (curr + paeth(a, b, c)) & 0xFF; break;
        default: pixels[dstIdx] = curr;
      }
    }
  }

  return { width, height, rgba: pixels };
}

/** Convert RGBA pixels to BMP-format ICO image data (with AND mask). */
function rgbaToBmpIco(rgba, w, h) {
  const bmpH = h * 2;
  const paddedRow = ((w * 4) + 3) & ~3;
  const pixelData = Buffer.alloc(paddedRow * h);

  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (srcRow * w + x) * 4;
      const di = y * paddedRow + x * 4;
      pixelData[di]     = rgba[si + 2];
      pixelData[di + 1] = rgba[si + 1];
      pixelData[di + 2] = rgba[si];
      pixelData[di + 3] = rgba[si + 3];
    }
  }

  const maskRowBytes = ((w + 31) >> 5) * 4;
  const andMask = Buffer.alloc(maskRowBytes * h);

  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0);
  hdr.writeInt32LE(w, 4);
  hdr.writeInt32LE(bmpH, 8);
  hdr.writeUInt16LE(1, 12);
  hdr.writeUInt16LE(32, 14);
  hdr.writeUInt32LE(pixelData.length + andMask.length, 20);

  return Buffer.concat([hdr, pixelData, andMask]);
}

/** Assemble multi-image ICO from [{size, data}] entries. */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dataStart = 6 + 16 * count;
  let curOff = dataStart;
  const dirs = [];
  const blobs = [];

  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(curOff, 12);
    dirs.push(e);
    blobs.push(data);
    curOff += data.length;
  }

  return Buffer.concat([header, ...dirs, ...blobs]);
}

// --- Main ---
console.log('Reading SVG...');
const png256 = renderPng(256);
fs.writeFileSync(path.resolve(__dirname, '..', 'build', 'icon.png'), png256);
console.log(`PNG 256x256 (${png256.length} bytes)`);

console.log('Building ICO (BMP ≤48px, PNG >48px)...');
const icoEntries = SIZES.map((size) => {
  const pngBuf = renderPng(size);
  if (size <= BMP_MAX_SIZE) {
    const { width, height, rgba } = pngToRgba(pngBuf);
    const bmp = rgbaToBmpIco(rgba, width, height);
    console.log(`  ${size}x${size}: BMP (${bmp.length}B)`);
    return { size, data: bmp };
  }
  console.log(`  ${size}x${size}: PNG (${pngBuf.length}B)`);
  return { size, data: pngBuf };
});

const ico = buildIco(icoEntries);
const icoPath = path.resolve(__dirname, '..', 'build', 'icon.ico');
fs.writeFileSync(icoPath, ico);
console.log(`ICO → ${icoPath} (${ico.length} bytes, ${SIZES.length} sizes)`);
