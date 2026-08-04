// Generates app/public/og-image.png (1200x630) — the social-share card used by
// the Open Graph / Twitter meta tags in index.html. Re-run after changing the
// brand mark or copy:  node scripts/generate-og.mjs
//
// The mark is the REAL logo (brand/beehive-logo.png, extracted from the
// official beehive.ico), composited at its native 256px - no vector original
// exists. The card matches the product's actual white/amber identity; the
// purple gradient it replaces shared nothing with the interface, and a share
// card that does not match the site it opens reads as a phishing clone.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../public/og-image.png')
const logo = readFileSync(resolve(here, '../brand/beehive-logo.png'))

// A flat-top hexagon path centred at (0,0), radius r — for the faint honeycomb.
function hex(r) {
  const h = r * Math.sqrt(3) / 2
  const p = [[r, 0], [r / 2, h], [-r / 2, h], [-r, 0], [-r / 2, -h], [r / 2, -h]]
  return 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z'
}

const HEX = hex(90)
const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#fef3c7"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- faint honeycomb, top-right, in the brand amber -->
  <g fill="none" stroke="#f59e0b" stroke-opacity="0.16" stroke-width="3">
    <path d="${HEX}" transform="translate(1120,70)"/>
    <path d="${HEX}" transform="translate(1043,205)"/>
    <path d="${HEX}" transform="translate(1197,205)"/>
    <path d="${HEX}" transform="translate(1120,340)"/>
  </g>

  <!-- The real mark is composited into this tile by sharp. The tile is
       deliberately a white rounded square (the logo's own background is
       solid white), so against the amber wash it reads as an app icon
       rather than as an accidental white box. -->
  <rect x="110" y="157" width="316" height="316" rx="48" fill="#ffffff" stroke="#f59e0b" stroke-opacity="0.35" stroke-width="2"/>

  <!-- Copy. Deliberately carries no domain and no platform wording: this card
       has to stay correct across the dev host, the eventual official domain,
       and the iOS/Android store listings, so it names no URL and says "device"
       rather than "browser". -->
  <text x="460" y="272" font-family="${font}" font-size="84" font-weight="700" fill="#1e293b">Beehive Wallet</text>
  <text x="462" y="342" font-family="${font}" font-size="37" fill="#475569">Non-custodial Cosmos wallet with</text>
  <text x="462" y="388" font-family="${font}" font-size="37" fill="#475569">outgoing-transaction alarms</text>

  <g transform="translate(462,428)">
    <rect width="510" height="58" rx="29" fill="#f59e0b" fill-opacity="0.16"/>
    <circle cx="35" cy="29" r="7" fill="#f59e0b"/>
    <text x="60" y="38" font-family="${font}" font-size="27" font-weight="600" fill="#92400e">Your keys never leave your device</text>
  </g>
</svg>`

const bg = await sharp(Buffer.from(svg)).png().toBuffer()
// Native 256px, vertically centred in the left block - never upscaled.
await sharp(bg)
  .composite([{ input: logo, left: 140, top: 187 }])
  .png()
  .toFile(out)
console.log('wrote', out)
