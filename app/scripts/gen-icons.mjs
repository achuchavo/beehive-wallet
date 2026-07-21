// Generate PWA / apple-touch icons from public/favicon.svg.
// Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public', 'favicon.svg'))
const AR = 48 / 46 // logo viewBox aspect

async function gen(size, pad, out) {
  const inner = Math.round(size * (1 - pad * 2))
  let w = inner
  let h = Math.round(inner / AR)
  if (h > inner) {
    h = inner
    w = Math.round(inner * AR)
  }
  const logo = await sharp(svg, { density: 384 })
    .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const left = Math.round((size - w) / 2)
  const top = Math.round((size - h) / 2)
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(join(root, 'public', out))
  console.log('wrote', out, `${size}x${size}`)
}

// iOS home-screen icon (iOS ignores the manifest; needs this PNG, no transparency)
await gen(180, 0.14, 'apple-touch-icon.png')
// Manifest "any" icons
await gen(192, 0.14, 'pwa-192.png')
await gen(512, 0.14, 'pwa-512.png')
// Maskable: extra padding so nothing is cropped inside the safe zone
await gen(512, 0.22, 'pwa-maskable-512.png')
