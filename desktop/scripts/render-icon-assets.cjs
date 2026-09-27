#!/usr/bin/env node
// render-icon-assets.cjs — regenerates every raster icon asset from the
// source SVGs after the 2026-09-27 "Habit Loop" redesign:
//   desktop/build/icons/gradient.svg + ember.svg  (source of truth)
//     -> mobile/assets/icon.png          (1024, full mark on gradient bg)
//     -> mobile/assets/adaptive-icon.png  (1024, glyph-only foreground)
//     -> mobile/assets/splash.png         (1080, centered mark, transparent)
//     -> desktop/public/favicon.svg       (vector copy)
// Run from desktop/: node scripts/render-icon-assets.cjs
// (gen-icons.cjs separately produces the .ico/.png for both themes.)

const path = require('path')
const fs = require('fs')
const { Resvg } = require('@resvg/resvg-js')

const DESKTOP = path.resolve(__dirname, '..')
const REPO = path.resolve(DESKTOP, '..')
const ICONS_DIR = path.join(DESKTOP, 'build', 'icons')
const MOBILE_ASSETS = path.join(REPO, 'mobile', 'assets')

const gradientSvg = fs.readFileSync(path.join(ICONS_DIR, 'gradient.svg'), 'utf8')

// The glyph alone (loop + arrowheads + check), no background — reused for the
// adaptive-icon foreground where Android supplies its own background color.
const GLYPH = `
  <g fill="none" stroke="#0f766e" stroke-width="21" stroke-linecap="round">
    <path d="M 163 67.4 A 70 70 0 0 1 140.2 196.9"/>
    <path d="M 93 188.6 A 70 70 0 0 1 115.8 59.1"/>
  </g>
  <g fill="#0f766e">
    <path d="M 124.4 199.7 L 137.9 184.1 L 142.5 209.7 Z"/>
    <path d="M 131.6 56.3 L 118.1 71.9 L 113.5 46.3 Z"/>
  </g>
  <path d="M 101 132 L 122 153 L 162 107" fill="none" stroke="#0f766e"
        stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
`

function renderPng(svg, size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  fs.writeFileSync(out, png)
  console.log('wrote', path.relative(REPO, out), `(${(png.length / 1024).toFixed(0)} KB, ${size}px)`)
}

// 1. mobile/assets/icon.png — the full mark, 1024
renderPng(gradientSvg, 1024, path.join(MOBILE_ASSETS, 'icon.png'))

// 2. mobile/assets/adaptive-icon.png — glyph-only foreground inside the
// Android safe zone (center 66% of the canvas; glyph scaled to ~45%).
const adaptiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(2.35)">${GLYPH}</g>
</svg>`
renderPng(adaptiveSvg, 1024, path.join(MOBILE_ASSETS, 'adaptive-icon.png'))

// 3. mobile/assets/splash.png — centered mark on a transparent canvas
// (app.json supplies the #EEF2FF background behind it).
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <g transform="translate(190 190) scale(2.73)">
    <rect width="256" height="256" rx="58" fill="#2ee6a6"/>
    <rect width="256" height="256" rx="58" fill="#0a9fc4" fill-opacity="0.0"/>
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2ee6a6"/>
        <stop offset="55%" stop-color="#19cfae"/>
        <stop offset="100%" stop-color="#0a9fc4"/>
      </linearGradient>
    </defs>
    <rect width="256" height="256" rx="58" fill="url(#bg)"/>
    <g fill="none" stroke="#ffffff" stroke-width="21" stroke-linecap="round">
      <path d="M 163 67.4 A 70 70 0 0 1 140.2 196.9"/>
      <path d="M 93 188.6 A 70 70 0 0 1 115.8 59.1"/>
    </g>
    <g fill="#ffffff">
      <path d="M 124.4 199.7 L 137.9 184.1 L 142.5 209.7 Z"/>
      <path d="M 131.6 56.3 L 118.1 71.9 L 113.5 46.3 Z"/>
    </g>
    <path d="M 101 132 L 122 153 L 162 107" fill="none" stroke="#ffffff" stroke-width="22"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`
renderPng(splashSvg, 1080, path.join(MOBILE_ASSETS, 'splash.png'))

// 4. favicon — vector copy of the mark
fs.copyFileSync(path.join(ICONS_DIR, 'gradient.svg'), path.join(DESKTOP, 'public', 'favicon.svg'))
console.log('wrote desktop/public/favicon.svg')

console.log('icon assets regenerated.')
