// Generates app/public/og-image.png (1200x630) — the social-share card used by
// the Open Graph / Twitter meta tags in index.html. Re-run after changing the
// brand mark or copy:  node scripts/generate-og.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../public/og-image.png')

// The beehive-cell mark from public/favicon.svg (viewBox 0 0 48 46), drawn solid
// white so it reads as a crisp silhouette on the purple background.
const MARK =
  'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'

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
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#4c1d95"/>
    </linearGradient>
    <radialGradient id="glow" cx="18%" cy="34%" r="70%">
      <stop offset="0" stop-color="#b28bff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#b28bff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- faint honeycomb, top-right -->
  <g fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3">
    <path d="${HEX}" transform="translate(1120,70)"/>
    <path d="${HEX}" transform="translate(1043,205)"/>
    <path d="${HEX}" transform="translate(1197,205)"/>
    <path d="${HEX}" transform="translate(1120,340)"/>
  </g>

  <!-- brand mark -->
  <circle cx="212" cy="315" r="128" fill="#ffffff" fill-opacity="0.10"/>
  <svg x="133" y="228" width="158" height="174" viewBox="0 0 48 46">
    <path fill="#ffffff" d="${MARK}"/>
  </svg>

  <!-- copy -->
  <text x="368" y="252" font-family="${font}" font-size="88" font-weight="700" fill="#ffffff">Beehive Wallet</text>
  <text x="370" y="322" font-family="${font}" font-size="37" fill="#ffffff" fill-opacity="0.92">Non-custodial Cosmos wallet with</text>
  <text x="370" y="368" font-family="${font}" font-size="37" fill="#ffffff" fill-opacity="0.92">outgoing-transaction alarms</text>

  <g transform="translate(370,406)">
    <rect width="512" height="58" rx="29" fill="#ffffff" fill-opacity="0.15"/>
    <circle cx="35" cy="29" r="7" fill="#facc15"/>
    <text x="60" y="38" font-family="${font}" font-size="27" font-weight="600" fill="#ffffff">Your keys never leave your browser</text>
  </g>

  <text x="370" y="520" font-family="${font}" font-size="29" font-weight="600" fill="#ffffff" fill-opacity="0.78">wallet.achumuamah.com</text>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(out)
console.log('wrote', out)
