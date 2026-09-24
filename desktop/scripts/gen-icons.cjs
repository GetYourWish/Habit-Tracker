const path = require('path');
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');

const SIZES = [16, 32, 48, 64, 128, 256];
const BMP_MAX = 48;
const ICONS_DIR = path.resolve(__dirname, '..', 'build', 'icons');

const ICONS = [
  { name: 'gradient', svg: 'gradient.svg' },
  { name: 'ember',   svg: 'ember.svg' },
];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngToRgba(pngBuf) {
  let off = 8, idats = [], w, h;
  while (off < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString('ascii', off + 4, off + 8);
    const data = pngBuf.slice(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idats.push(data);
  }
  const raw = require('zlib').inflateSync(Buffer.concat(idats));
  const BPP = 4, stride = w * BPP + 1;
  const px = Buffer.alloc(w * h * BPP);
  for (let y = 0; y < h; y++) {
    const rs = y * stride, filt = raw[rs];
    for (let x = 0; x < w * BPP; x++) {
      const si = rs + 1 + x, di = y * w * BPP + x, c = raw[si] || 0;
      const a = x >= BPP ? px[di - BPP] : 0;
      const b = y > 0 ? px[di - w * BPP] : 0;
      const cc = (x >= BPP && y > 0) ? px[di - w * BPP - BPP] : 0;
      switch (filt) {
        case 0: px[di] = c; break;
        case 1: px[di] = (c + a) & 0xFF; break;
        case 2: px[di] = (c + b) & 0xFF; break;
        case 3: px[di] = (c + ((a + b) >> 1)) & 0xFF; break;
        case 4: px[di] = (c + paeth(a, b, cc)) & 0xFF; break;
        default: px[di] = c;
      }
    }
  }
  return { w, h, rgba: px };
}

function rgbaToBmp(rgba, w, h) {
  const bmpH = h * 2, pRow = ((w * 4) + 3) & ~3;
  const pix = Buffer.alloc(pRow * h);
  for (let y = 0; y < h; y++) {
    const sr = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (sr * w + x) * 4, di = y * pRow + x * 4;
      pix[di] = rgba[si+2]; pix[di+1] = rgba[si+1]; pix[di+2] = rgba[si]; pix[di+3] = rgba[si+3];
    }
  }
  const mRow = ((w + 31) >> 5) * 4, mask = Buffer.alloc(mRow * h);
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(w, 4); hdr.writeInt32LE(bmpH, 8);
  hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14);
  hdr.writeUInt32LE(pix.length + mask.length, 20);
  return Buffer.concat([hdr, pix, mask]);
}

function buildIco(entries) {
  const h = Buffer.alloc(6); h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(entries.length, 4);
  let cur = 6 + 16 * entries.length;
  const dirs = [], blobs = [];
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(cur, 12);
    dirs.push(e); blobs.push(data); cur += data.length;
  }
  return Buffer.concat([h, ...dirs, ...blobs]);
}

for (const icon of ICONS) {
  const svgPath = path.join(ICONS_DIR, icon.svg);
  const svg = fs.readFileSync(svgPath, 'utf8');
  const entries = SIZES.map(size => {
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
    const png = r.render().asPng();
    if (size <= BMP_MAX) {
      const { w, h, rgba } = pngToRgba(png);
      return { size, data: rgbaToBmp(rgba, w, h) };
    }
    return { size, data: png };
  });
  const ico = buildIco(entries);
  const icoPath = path.join(ICONS_DIR, icon.name + '.ico');
  fs.writeFileSync(icoPath, ico);
  const png256 = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
  fs.writeFileSync(path.join(ICONS_DIR, icon.name + '.png'), png256);
  console.log(icon.name + ': ' + ico.length + ' bytes');
}
console.log('All icons generated.');
